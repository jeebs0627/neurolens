/* 현장 실측 분석 (Node · 저장소 밖 로컬 원자료만 읽음 · 결과는 집계만 출력)
 * v3 세션마다
 *   1) 보정: 기록 snapshot 재현 · 표적 종류별 오차(가로/세로) · 정밀 8점 held-out
 *   2) 드리프트: 지시 응시(가운데 점)·암묵 응시 기록(telemetry.drift)의 측정 치우침을 보정 후 경과 시간·머리 자세 변화와 비교
 *   3) 알려진 표적에 대한 현장 오차: 원형 추적(x,y 정답)·속도 단계(x 정답)에서 기존 엔진 좌표(rx,ry)와 shadow 모델 좌표(sx,sy)를 같은 표본으로 비교
 *   4) 머리 자세 변화로 세로 치우침을 설명할 수 있는지(세션 내 선형 회귀, leave-one-out)
 *   5) 타이밍(rAF onset 이 요청보다 앞서는 비율) · 카메라(프레임 간격·추론 지연)
 * 실행: node tools/colab/field_analysis.cjs <sessions dir> [--since=2026-10-08] [--out=report.json] */
'use strict';
const fs = require('fs'), path = require('path');
const A = require('./session_adapter.cjs');
const N = require(path.join(A.ROOT, 'newbiz-core.js'));
const finite = Number.isFinite, med = a => { const s = a.filter(finite).sort((x, y) => x - y); return s.length ? s[(s.length - 1) >> 1] / 2 + s[s.length >> 1] / 2 : NaN; };
const mean = a => { const v = a.filter(finite); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN; };
const q = (a, p) => { const s = a.filter(finite).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] : NaN; };
const r1 = v => (finite(v) ? Math.round(v * 10) / 10 : null);
const args = process.argv.slice(2), dir = args.find(a => !a.startsWith('--')), since = (args.find(a => a.startsWith('--since=')) || '--since=').slice(8), outPath = (args.find(a => a.startsWith('--out=')) || '').slice(6);

function sampleRows(p, block) { const cols = p.sampleColumns, ix = k => cols.indexOf(k); return (block || []).map(r => ({ t: r[ix('t')], rx: r[ix('rx')], ry: r[ix('ry')], x: r[ix('x')], y: r[ix('y')], px: ix('px') >= 0 ? r[ix('px')] : null, py: ix('py') >= 0 ? r[ix('py')] : null, sx: ix('sx') >= 0 ? r[ix('sx')] : null, sy: ix('sy') >= 0 ? r[ix('sy')] : null, bl: r[ix('blink')], q: r[ix('quality_x1000')] })); }
const LAG = 120;   // 과제 표적 위상 지연(가정 · 기록 없음)

function analyze(obj) {
  const S = A.loadSession(obj), p = S.payload, W = S.W, H = S.H, out = { code: String(obj.code).slice(0, 8), device: `${obj.meta.client?.os}/${obj.meta.client?.browser} ${W}x${H} dpr${obj.meta.dpr}`, mode: obj.meta.mode, gazeModel: obj.meta.gazeModel?.mode || 'off' };
  /* 1) 보정 */
  const fit = S.snapshot ? A.modelFromSnapshot(S.snapshot) : null;
  const T = S.targets.filter(t => t.round === Math.max(...S.targets.map(x => x.round || 1)));
  const at = (m, t) => { const fs = S.calibrationFrames.filter(f => f.gazeOk && f.tc >= t.sampleStart && f.tc < t.sampleEnd).map(S.feat).filter(Boolean); const g = fs.map(f => N.applyResidual(m.resid, N.applyAffine(m.affine, N.predictGaze(m.model, f)))).filter(v => v && finite(v.x)); return g.length >= 4 ? { dx: med(g.map(v => v.x)) - t.x, dy: med(g.map(v => v.y)) - t.y, n: g.length } : null; };
  const rp = A.reconstructPipeline(N, S);
  if (rp && rp.ok) {
    const byKind = {};
    for (const t of T) { const e = at(rp.selection, t); if (!e) continue; (byKind[t.kind] = byKind[t.kind] || []).push(e); }
    out.calibration = { recorded: { errPct: obj.summary?.calibration?.errPct, grade: obj.summary?.calibration?.grade, chosen: rp.selection.key, refit: rp.refitApplied }, fineHeldOut: rp.fineHeldOut,
      selectionErrByKind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, { n: v.length, hxPctW: r1(mean(v.map(e => Math.abs(e.dx))) / W * 100), hyPctH: r1(mean(v.map(e => Math.abs(e.dy))) / H * 100), biasXpx: r1(mean(v.map(e => e.dx))), biasYpx: r1(mean(v.map(e => e.dy))) }])),
      snapshotReplayAgree: fit ? (() => { const P1 = A.predictFrames(N, fit, S, S.frames.slice(0, 3000)), P2 = A.predictFrames(N, rp.final, S, S.frames.slice(0, 3000)), m = new Map(P2.map(x => [x.tc, x])); const d = P1.map(x => { const y = m.get(x.tc); return y ? Math.hypot(x.bx - y.bx, x.by - y.by) : NaN; }); return { medianPx: r1(med(d)), p95Px: r1(q(d, .95)) }; })() : null };
  }
  /* 2) 드리프트 기록 */
  const calEnd = Math.max(...T.map(t => t.offset || t.onset));
  const dr = (p.telemetry?.drift || []).filter(d => finite(d.measuredDx));
  const pose0 = (() => { const fs = S.calibrationFrames.filter(f => f.gazeOk && finite(f.cy)); return { cx: med(fs.map(f => f.cx)), cy: med(fs.map(f => f.cy)), fw: med(fs.map(f => f.fw)), pitch: med(fs.map(f => f.pitch)), yaw: med(fs.map(f => f.yaw)), v: med(fs.map(f => S.feat(f)?.v)) }; })();
  const poseAt = t => { const fs = S.frames.filter(f => f.gazeOk && f.tc >= t - 1500 && f.tc <= t); if (fs.length < 4) return null; return { cx: med(fs.map(f => f.cx)) - pose0.cx, cy: med(fs.map(f => f.cy)) - pose0.cy, fw: med(fs.map(f => f.fw)) / pose0.fw - 1, pitch: med(fs.map(f => f.pitch)) - pose0.pitch, yaw: med(fs.map(f => f.yaw)) - pose0.yaw }; };
  const D = dr.map(d => ({ t: d.t, min: (d.t - calEnd) / 60000, src: d.source, dx: d.measuredDx, dy: d.measuredDy, applied: d.applied, pose: poseAt(d.t) })).filter(d => d.pose);
  const instr = D.filter(d => /instructed/.test(d.src));
  out.drift = { events: D.length, instructed: instr.length, applied: D.filter(d => d.applied).length, rejectedInstructed: instr.filter(d => !d.applied).length,
    measuredMedian: { dxPctW: r1(med(D.map(d => d.dx)) / W * 100), dyPctH: r1(med(D.map(d => d.dy)) / H * 100) }, measuredAbsP90: { dxPctW: r1(q(D.map(d => Math.abs(d.dx)), .9) / W * 100), dyPctH: r1(q(D.map(d => Math.abs(d.dy)), .9) / H * 100) },
    byPhase: ['early', 'late'].map((k, i) => { const half = D.filter(d => (i === 0) === (d.min < med(D.map(x => x.min)))); return { phase: k, n: half.length, dyPctH: r1(med(half.map(d => d.dy)) / H * 100), dxPctW: r1(med(half.map(d => d.dx)) / W * 100) }; }),
    poseChange: { cyMedian: r1(med(D.map(d => d.pose.cy * 1000))), fwPctMedian: r1(med(D.map(d => d.pose.fw * 100))), pitchMedian: r1(med(D.map(d => d.pose.pitch * 1000))) } };
  /* 4) 머리 자세 변화 → 세로/가로 치우침 회귀 (LOO) */
  const loo = (key, feats) => { if (D.length < 8) return null; const X = D.map(d => [1, ...feats.map(f => d.pose[f])]), y = D.map(d => d[key]); const pred = D.map((_, i) => { const Xi = X.filter((_, j) => j !== i), yi = y.filter((_, j) => j !== i); const k = X[0].length, A2 = Array.from({ length: k }, () => new Array(k).fill(0)), b = new Array(k).fill(0); Xi.forEach((r, n) => { for (let a = 0; a < k; a++) { b[a] += r[a] * yi[n]; for (let c = 0; c < k; c++) A2[a][c] += r[a] * r[c]; } }); for (let a = 1; a < k; a++) A2[a][a] += 1e-6 * Xi.length; const w = solve(A2, b); return w ? w.reduce((s, v, a) => s + v * X[i][a], 0) : NaN; }); const base = y.map((_, i) => mean(y.filter((_, j) => j !== i))); const e = y.map((v, i) => Math.abs(v - pred[i])), eb = y.map((v, i) => Math.abs(v - base[i])); return { n: D.length, looMaePx: r1(mean(e)), constMaePx: r1(mean(eb)), gain: r1((1 - mean(e) / mean(eb)) * 100) }; };
  out.poseExplainsDrift = { dy_by_cy_pitch_fw: loo('dy', ['cy', 'pitch', 'fw']), dx_by_cx_yaw: loo('dx', ['cx', 'yaw']), note: 'leave-one-out MAE of a per-session linear model vs constant offset; gain>0 means head pose explains the drift' };
  /* 3) 알려진 표적: 원형 추적·속도 단계 */
  const pu = p.pursuit || {}, rows = [];
  if (pu.circle) { const c = pu.circle; for (const s of sampleRows(p, c.s)) { if (s.bl || s.t < c.t0 + 1500 || s.t > c.t0 + c.dur) continue; const a = 2 * Math.PI * c.freq * (s.t - c.t0 - LAG) / 1000 - Math.PI / 2; rows.push({ k: 'circle', tx: c.cx + c.r * Math.cos(a), ty: c.cy + c.r * Math.sin(a), ...s }); } }
  for (const l of pu.levels || []) for (const s of sampleRows(p, l.s)) { if (s.bl || s.t < l.t0 + 1500 || s.t > l.t0 + l.dur) continue; rows.push({ k: 'level', tx: (pu.cx ?? W / 2) + pu.amp * Math.sin(2 * Math.PI * l.freq * (s.t - l.t0 - LAG) / 1000), ty: null, ...s }); }
  const err = (rs, xk, yk) => { const v = rs.filter(r => finite(r[xk]) && (r.ty === null || finite(r[yk]))); const ex = v.map(r => r[xk] - r.tx), ey = v.filter(r => r.ty !== null).map(r => r[yk] - r.ty); const mx = med(ex), my = med(ey); return { n: v.length, hxPctW: r1(mean(ex.map(Math.abs)) / W * 100), hyPctH: ey.length ? r1(mean(ey.map(Math.abs)) / H * 100) : null, biasXPctW: r1(mx / W * 100), biasYPctH: ey.length ? r1(my / H * 100) : null, zeroedHxPctW: r1(mean(ex.map(e => Math.abs(e - mx))) / W * 100), zeroedHyPctH: ey.length ? r1(mean(ey.map(e => Math.abs(e - my))) / H * 100) : null }; };
  const both = rows.filter(r => finite(r.sx));
  out.knownTargets = { samples: rows.length, withShadow: both.length,
    engine: { circle: err(rows.filter(r => r.k === 'circle'), 'rx', 'ry'), level: err(rows.filter(r => r.k === 'level'), 'rx', 'ry') },
    engineSameSamples: both.length ? { circle: err(both.filter(r => r.k === 'circle'), 'rx', 'ry'), level: err(both.filter(r => r.k === 'level'), 'rx', 'ry') } : null,
    shadow: both.length ? { circle: err(both.filter(r => r.k === 'circle'), 'sx', 'sy'), level: err(both.filter(r => r.k === 'level'), 'sx', 'sy') } : null,
    shadowMinusEngineMedianPx: both.length ? r1(med(both.map(r => Math.hypot(r.sx - r.rx, r.sy - r.ry)))) : null };
  /* 5) 타이밍·카메라 */
  const st = p.telemetry?.stimuli || [], del = st.map(s => s.onset - s.requested);
  const fi = S.frames.map(f => f.intervalMs).filter(finite), lag = S.frames.map(f => f.lag).filter(finite);
  out.timing = { stimuli: st.length, onsetBeforeRequestPct: r1(del.filter(v => v < 0).length / Math.max(1, del.length) * 100), onsetDelayMedianMs: r1(med(del)), onsetDelayMinMs: r1(Math.min(...del)) };
  out.camera = { fps: r1(1000 / med(fi)), intervalP95: r1(q(fi, .95)), inferLagMedian: r1(med(lag)), inferLagP95: r1(q(lag, .95)), lock: obj.meta.capture?.lock ? (obj.meta.capture.lock.applied ? 'applied' : 'failed: ' + obj.meta.capture.lock.reason) : 'none' };
  return out;
}
function solve(A, y) { const n = y.length, M = A.map((r, i) => [...r, y[i]]); for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]]; if (Math.abs(M[c][c]) < 1e-12) return null; for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; } } return M.map((r, i) => r[n] / r[i]); }

const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => path.join(dir, f));
const report = [];
for (const f of files) { const o = JSON.parse(fs.readFileSync(f, 'utf8')); if (since && String(o.created_at) < since) continue; if (o.payload?.schema !== 'nl-research-3') continue; try { report.push(analyze(o)); } catch (e) { report.push({ code: String(o.code).slice(0, 8), error: e.message }); } }
report.sort((a, b) => a.code.localeCompare(b.code));
if (outPath) fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
