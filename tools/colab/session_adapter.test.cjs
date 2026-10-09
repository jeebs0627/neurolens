'use strict';
/* session adapter · baseline 재현 · fixture 테스트 (합성) */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), { execFileSync } = require('node:child_process');
const A = require('./session_adapter.cjs'), F = require('./fixtures.cjs');
const N = require(path.join(A.ROOT, 'newbiz-core.js'));
let passed = 0; const test = (n, fn) => { fn(); passed++; console.log('PASS', n); };

const v3 = F.makeSession({ seed: 11, legacy: false }), v2 = F.makeSession({ seed: 12, legacy: true });

test('v3 session decodes: canonical clock, calibration frames before t0, roles/ids from targetsV2, recorded pursuit metadata, labels, snapshot digest', () => {
  const S = A.loadSession(v3);
  assert.equal(S.schema, 'nl-research-3'); assert.equal(S.core, +N.VERSION.match(/core ([\d.]+)/)[1]); /* 픽스처는 현재 엔진으로 만든다 */ assert.ok(S.frames.length > 200 && S.calibrationFrames.length > 500);
  assert.ok(S.calibrationFrames.every(f => f.tc < 0), 'calibration frames precede recording start (negative canonical time)');
  assert.ok(Math.abs(S.frames[0].tc) < 1, 'first recorded frame defines t0');
  assert.ok(S.targets.every(t => t.id && !t.inferredBackfill && t.uncertaintyMs === 0));
  assert.deepEqual([...new Set(S.targets.map(t => t.kind))].sort(), ['fine', 'fix9', 'val', 'zone']);
  assert.equal(S.targets.filter(t => t.role === 'train').length, 9); assert.equal(S.targets.filter(t => t.kind === 'fine').length, 8);
  assert.equal(S.pursuit.sources.frequency, 'recorded'); assert.equal(S.pursuit.sources.lag, 'recorded'); assert.ok(Math.abs(S.pursuit.fx - 3 / 18) < 1e-9);
  assert.ok(S.labels && S.labels.labels.length === 25); assert.ok(S.snapshot && S.digests.final);
  assert.ok(!S.flags.includes('targets-v1-inferred-windows'));
  const fit = A.modelFromSnapshot(S.snapshot); assert.equal(A.pipelineDigest(fit), S.digests.final, 'snapshot digest reproduces the recorded final digest');
});

test('legacy v2 session: windows back-filled with explicit flags, fine points inferred from val order, pursuit parsed from path, lag assumed', () => {
  const S = A.loadSession(v2);
  assert.equal(S.schema, 'nl-research-2'); assert.equal(S.core, 2.2);
  assert.ok(S.flags.includes('targets-v1-inferred-windows')); assert.ok(S.flags.includes('pursuit-frequency-parsed-from-path')); assert.ok(S.flags.includes('pursuit-lag-assumed'));
  assert.ok(S.targets.every(t => t.inferredBackfill && t.uncertaintyMs === 300));
  assert.equal(S.targets.filter(t => t.kind === 'fine').length, 8); assert.equal(S.targets.filter(t => t.role === 'internal').length, 9);
  assert.equal(S.pursuit.fx, 0.12); assert.equal(S.pursuit.fy, 0.08); assert.equal(S.pursuit.lagMs, 120); assert.equal(S.pursuit.sources.lag, 'legacy-assumed-120ms');
  assert.equal(S.snapshot, null); assert.equal(S.labels, null);
  assert.ok(S.flags.includes('vertical-feature-recomputed-from-landmarks'), 'core < 2.3 vertical feature is recomputed from landmarks (corner axis)');
  assert.ok(S.lmap && S.lmap.size > 500);
  const rp = A.reconstructPipeline(N, S); assert.ok(rp.ok, rp.reason); assert.ok(rp.fineHeldOut.errPct < 20, 'legacy replay with recomputed features: ' + rp.fineHeldOut.errPct);
  const noLm = A.loadSession({ ...v2, payload: { ...v2.payload, landmarks: null } }); assert.ok(noLm.flags.includes('legacy-lid-v-no-landmarks')); assert.equal(A.reconstructPipeline(N, noLm).ok, false, 'no landmarks → cannot rebuild current-engine features → explicit failure, not a silent fallback');
  const noPath = A.loadSession({ ...v2, payload: { ...v2.payload, calibration: { ...v2.payload.calibration, pursuit: { t0: 0, sec: 12.5, W: 1, H: 1 } } }, meta: { ...v2.meta, versions: {} } });
  assert.equal(noPath.pursuit.sources.frequency, 'unknown-core-assumed-legacy'); assert.equal(noPath.pursuit.fx, 0.12);
});

test('pipeline reconstruction is deterministic and agrees with the browser-recorded snapshot within feature quantisation tolerance', () => {
  const S = A.loadSession(v3), rp = A.reconstructPipeline(N, S);
  assert.ok(rp.ok, rp.reason); assert.ok(rp.samples.pursuit >= 60);
  assert.ok(rp.fineHeldOut.n === 8 && rp.fineHeldOut.errPct < 15, 'synthetic subject calibrates: fine held-out ' + rp.fineHeldOut.errPct + '%');
  const again = A.reconstructPipeline(N, S); assert.equal(A.pipelineDigest(again.final), A.pipelineDigest(rp.final), 'deterministic');
  /* 기록 특징은 ×1e4 로 양자화돼 있어 재생 계수가 비트 단위로 같을 수는 없다 → 예측 일치로 fidelity 를 잰다 */
  const snap = A.modelFromSnapshot(S.snapshot), P1 = A.predictFrames(N, snap, S, S.frames), P2 = A.predictFrames(N, rp.final, S, S.frames);
  const byT = new Map(P2.map(p => [p.tc, p])), d = P1.map(p => { const q = byT.get(p.tc); return q ? Math.hypot(p.bx - q.bx, p.by - q.by) : NaN; }).filter(Number.isFinite).sort((a, b) => a - b);
  assert.ok(d.length > 200); assert.ok(d[Math.floor(d.length / 2)] < 3 && d[Math.floor(d.length * .95)] < 10, `replay vs snapshot: median ${d[Math.floor(d.length / 2)].toFixed(2)}px p95 ${d[Math.floor(d.length * .95)].toFixed(2)}px`);
  assert.equal(rp.selection.coreVersion, N.VERSION);
});

test('per-frame baseline predictions carry raw/affine/resid coordinates, drift, allowlisted features and no target data', () => {
  const S = A.loadSession(v3), fit = A.modelFromSnapshot(S.snapshot), P = A.predictFrames(N, fit, S, S.frames);
  assert.ok(P.length > 200);
  const keys = Object.keys(P[0]); assert.ok(['tc', 'px', 'py', 'ax', 'ay', 'bx', 'by', 'mode', 'driftDx', 'u', 'v', 'eyeQ'].every(k => keys.includes(k)));
  assert.ok(!keys.some(k => /target|click|label/i.test(k)));
  /* 기록된 과제 표본(rx,ry)과 재현한 bx,by 가 같은 프레임에서 일치해야 한다 (같은 snapshot, drift 0) */
  const rows = v3.payload.pursuit.circle.s, cols = v3.payload.sampleColumns, ti = cols.indexOf('t'), rxi = cols.indexOf('rx');
  const byT = new Map(P.map(p => [Math.round(p.tc), p]));
  let matched = 0, maxDiff = 0; for (const r of rows) { const p = byT.get(r[ti]); if (!p) continue; matched++; maxDiff = Math.max(maxDiff, Math.abs(p.bx - r[rxi])); }
  assert.ok(matched > 100 && maxDiff <= 1, `recorded rx vs reproduced bx: matched ${matched}, max diff ${maxDiff}px (quantised to 1px)`);
});

test('baseline_predict CLI writes per-session files with fidelity classification (synthetic dir)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-fixture-')), out = path.join(dir, 'baseline');
  execFileSync('node', [path.join(__dirname, 'fixtures.cjs'), dir, '--sessions=3', '--seed=21', '--legacy=1'], { cwd: A.ROOT });
  const log = JSON.parse(execFileSync('node', [path.join(__dirname, 'baseline_predict.cjs'), path.join(dir, 'sessions'), '--out', out], { cwd: A.ROOT, encoding: 'utf8' }).trim().split('\n').pop());
  assert.equal(log.sessions, 3); assert.equal(log.ok, 3); assert.equal(log.fidelity['snapshot+replay-verified'], 2, JSON.stringify(log)); assert.equal(log.fidelity.replayed, 1);
  const files = fs.readdirSync(out).filter(f => f.endsWith('.baseline.json')); assert.equal(files.length, 3);
  const one = JSON.parse(fs.readFileSync(path.join(out, files[0]), 'utf8')); assert.ok(one.predictions.snapshot || one.predictions.replaySelection); assert.equal(one.engine, N.VERSION);
  assert.ok(fs.existsSync(path.join(dir, 'FIXTURE_SYNTHETIC.json')));
  fs.rmSync(dir, { recursive: true, force: true });
});

console.log(passed + ' session adapter tests passed.');
