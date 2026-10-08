/* 시선 보정 실측 재생 벤치마크 (연구 원자료 · 저장소 밖 로컬 파일만 읽음)
 * 세션 JSON(tools/colab 내보내기 또는 tools/newbiz_research_export.py 결과; payload 만 있는 파일도 허용)을 받아 보정 표본을
 * telemetry.calibrationFrames + calibration 표적 기록으로 다시 만들고, 보정 파이프라인(condition.html calibrate() 순서, 커서 과제 제외)을 돌린 뒤
 *   (a) 선택 모델이 학습에 쓰지 않은 정밀 보정 8점의 오차(화면 폭 %) · (b) 과제 오차: 원형 추적(x·y 정답)·속도 단계(x 정답)
 * 를 잰다. 입력 해석·표적 구간·추적 보정 메타(주파수·진폭·지연·표본 구간)는 tools/colab/session_adapter.cjs 가 기록 메타데이터에서 읽는다:
 *   v3 는 기록값, 그 전은 path 문자열 → 버전별 legacy 표 순으로 채우고 flags 로 ‘unknown/assumed’ 를 표시한다. 고정 0.12/0.08Hz·120ms 를 모든 자료에 적용하지 않는다.
 * 기록된 v 가 눈꺼풀 기준인 core<2.3 자료는 payload.landmarks 로 눈꼬리 기준 v 를 다시 계산한다(없으면 그 세션은 재생 불가로 보고).
 * 실행: node tools/gaze_replay.cjs <세션 폴더> [variant,...] [--ref=이전커밋(기본 9e3eccd)]
 * 2026-10-07 결과(13세션, 이전 하드코딩 버전): old 정밀 11.5% / 원형 13.1% (세로 15.4%H) → new 9.6% / 9.8% (세로 8.9%H), 영점 뒤 10.6 → 6.9% */
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
const A = require('./colab/session_adapter.cjs');
const ROOT = A.ROOT;
const args = process.argv.slice(2), SESS = args.find(a => !a.startsWith('--') && fs.existsSync(a) && fs.statSync(a).isDirectory());
if (!SESS) { console.error('usage: node tools/gaze_replay.cjs <sessions dir> [variants] [--ref=commit]'); process.exit(1); }
const ref = (args.find(a => a.startsWith('--ref=')) || '--ref=9e3eccd').slice(6), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-old-'));
for (const f of ['newbiz-core.js', 'condition-signal.js', 'condition-fusion.js']) fs.writeFileSync(path.join(tmp, f), execFileSync('git', ['show', ref + ':' + f], { cwd: ROOT }));
const NEW = require(ROOT + '/newbiz-core.js'), OLD = require(path.join(tmp, 'newbiz-core.js'));
const finite = Number.isFinite, median = a => NEW.median(a), mean = a => NEW.mean(a);

/* 과제 평가: payload.frames 특징으로 원형(x,y)·속도 단계(x) 정답과 비교. 원형/단계 표적 위상 지연은 기록이 없으므로 120ms 를 명시적 가정으로 둔다 */
const TASK_LAG = { ms: 120, source: 'assumed (not recorded in any payload version)' };
function taskEval(N, S, fit) {
  if (!fit) return null;
  const { W, H } = S, p = S.payload, pred = f => { const g = N.predictGaze(fit.model, f); if (!g) return null; return N.applyResidual(fit.resid, N.applyAffine(fit.affine, g)); };
  const rows = [], task = S.frames.map(S.feat).filter(Boolean);
  const circle = p.pursuit && p.pursuit.circle ? p.pursuit.circle : null, levels = (p.pursuit && p.pursuit.levels) || [];
  if (circle) for (const f of task) { if (!f.gazeOk || f.tc < circle.t0 + 1500 || f.tc > circle.t0 + circle.dur) continue; const g = pred(f); if (!g) continue; const a = 2 * Math.PI * circle.freq * (f.tc - circle.t0 - TASK_LAG.ms) / 1000 - Math.PI / 2; rows.push({ kind: 'circle', gx: g.x, gy: g.y, x: circle.cx + circle.r * Math.cos(a), y: circle.cy + circle.r * Math.sin(a) }); }
  for (const l of levels) for (const f of task) { if (!f.gazeOk || f.tc < l.t0 + 1500 || f.tc > l.t0 + l.dur) continue; const g = pred(f); if (!g) continue; rows.push({ kind: 'level', gx: g.x, gy: g.y, x: W / 2 + (p.pursuit.amp || 0.32 * W) * Math.sin(2 * Math.PI * l.freq * (f.tc - l.t0 - TASK_LAG.ms) / 1000), y: H / 2 }); }
  const summarize = R => { if (R.length < 20) return null; const dx = R.map(r => r.gx - r.x), dy = R.map(r => r.gy - r.y), mx = median(dx), my = median(dy); return { n: R.length, raw: mean(R.map(r => Math.hypot(r.gx - r.x, r.gy - r.y))) / W * 100, zeroed: mean(R.map(r => Math.hypot(r.gx - r.x - mx, r.gy - r.y - my))) / W * 100, biasX: mx / W * 100, biasY: my / H * 100, hy: mean(dy.map(v => Math.abs(v - my))) / H * 100, hx: mean(dx.map(v => Math.abs(v - mx))) / W * 100 }; };
  return { circle: summarize(rows.filter(r => r.kind === 'circle')), level: summarize(rows.filter(r => r.kind === 'level')) };
}

const VARIANTS = {
  old: { N: OLD, opt: {} },                       // 이전 엔진(--ref) · 현재 adapter 특징(core<2.3 는 눈꼬리 기준으로 재계산)
  new: { N: NEW, opt: {} },                       // 현재 엔진
  new_nopursuit: { N: NEW, opt: { pursuit: false } },
  new_nofine: { N: NEW, opt: { fine: false } },
};
const want = args.filter(a => VARIANTS[a]).length ? args.filter(a => VARIANTS[a]) : ['old', 'new'];
const files = fs.readdirSync(SESS).filter(f => f.endsWith('.json')).map(f => path.join(SESS, f));
const results = {}, skipped = [];
for (const file of files) {
  let S; try { S = A.loadSession(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (e) { skipped.push({ file: path.basename(file), why: e.message }); continue; }
  if (!S.targets.some(t => t.kind === 'fine')) { skipped.push({ file: path.basename(file), why: 'no fine targets' }); continue; }
  if (S.flags.includes('legacy-lid-v-no-landmarks')) { skipped.push({ file: path.basename(file), why: 'core<2.3 without landmarks: vertical feature not reconstructible' }); continue; }
  for (const name of want) {
    const V = VARIANTS[name];
    let r; try { r = A.reconstructPipeline(V.N, S, V.opt); } catch (e) { r = null; console.log(name, S.code, 'ERR', e.message); }
    if (!r || !r.ok) { console.log(name, S.code, 'pipeline', r ? r.reason : 'null'); continue; }
    const te = taskEval(V.N, S, r.final);
    (results[name] = results[name] || []).push({ code: String(S.code || path.basename(file)).slice(0, 12), model: r.stage2.model, chosen: r.selection.key, held: r.fineHeldOut?.errPct, hx: r.fineHeldOut?.hx, hy: r.fineHeldOut?.hy, circ: te?.circle?.raw, circZ: te?.circle?.zeroed, circHy: te?.circle?.hy, lev: te?.level?.raw, levZ: te?.level?.zeroed, bx: te?.circle?.biasX, by: te?.circle?.biasY, pursuitSrc: S.pursuit ? S.pursuit.sources.frequency + '/' + S.pursuit.sources.lag : 'none', flags: S.flags.join(',') });
  }
}
const r1 = v => (finite(v) ? Math.round(v * 10) / 10 : '—');
for (const name of want) {
  if (!results[name]) continue;
  console.log(`\n=== ${name}`);
  console.table(results[name].map(r => ({ code: r.code, model: r.model, chosen: r.chosen, 'fine held%': r1(r.held), hx: r1(r.hx), hy: r1(r.hy), 'circle raw%': r1(r.circ), 'circle zeroed%': r1(r.circZ), 'circle hy%': r1(r.circHy), 'level raw%': r1(r.lev), 'level zeroed%': r1(r.levZ), 'bias x/y%': `${r1(r.bx)}/${r1(r.by)}`, 'pursuit meta': r.pursuitSrc })));
  const m = k => r1(mean(results[name].map(r => r[k]).filter(finite)));
  console.log(`${name} MEAN: fine ${m('held')} (hx ${m('hx')} hy ${m('hy')}) · circle raw ${m('circ')} zeroed ${m('circZ')} hy ${m('circHy')} · level raw ${m('lev')} zeroed ${m('levZ')}`);
}
if (skipped.length) console.log('\nskipped:', JSON.stringify(skipped));
console.log(`\ntask target lag: ${TASK_LAG.ms}ms (${TASK_LAG.source}) · pursuit calibration metadata per session is shown in the 'pursuit meta' column (recorded | parsed-from-path | legacy-table | unknown-core-assumed-legacy / recorded | legacy-assumed-120ms)`);
fs.rmSync(tmp, { recursive: true, force: true });
