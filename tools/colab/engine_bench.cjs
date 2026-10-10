/* 엔진 설정 재생 벤치 (Node · 로컬 원자료만 · 집계만 출력)
 * 모든 세션(정밀 보정 8점이 있는 세션)에서 condition.html calibrate() 순서를 재생해 설정 후보를 비교한다.
 *   held-out: 선택 모델이 쓰지 않은 정밀 8점 오차(가로 %W · 세로 %H) · 정밀 점 세로 이득(gy 대 y 기울기)
 *   task:     원형 추적(x,y 정답, 120ms 지연 가정)에서 최종 모델 + 기록된 영점(drift) 좌표의 오차 · 세로 이득
 * 판단은 held-out(정밀 8점) 우선, task 는 보조. 같은 세션 집합·같은 표본에서 비교한다.
 * 실행: node tools/colab/engine_bench.cjs <sessions dir> [--out=bench.json] */
'use strict';
const fs = require('fs'), path = require('path');
const A = require('./session_adapter.cjs');
const N = require(path.join(A.ROOT, 'newbiz-core.js'));
const finite = Number.isFinite, med = a => { const s = a.filter(finite).sort((x, y) => x - y); return s.length ? (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2 : NaN; };
const mean = a => { const v = a.filter(finite); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN; };
const slope = (x, y) => { const n = x.length; if (n < 4) return NaN; const mx = mean(x), my = mean(y); let a = 0, b = 0; for (let i = 0; i < n; i++) { a += (x[i] - mx) * (y[i] - my); b += (x[i] - mx) ** 2; } return a / b; };
const r1 = v => (finite(v) ? Math.round(v * 100) / 100 : null);

function variant(fitOpt = {}, affOpt = {}, pipeOpt = {}) {
  const Nv = Object.create(N);
  Nv.fitGaze = (s, l, o = {}) => N.fitGaze(s, l, { ...o, ...fitOpt });
  Nv.fitAffine = (p, o = {}) => N.fitAffine(p, { ...o, ...affOpt });
  return { N: Nv, pipeOpt };
}
const VARIANTS = {
  base: variant(),
  v_ridge_050: variant({ keyRidge: { v: 0.5 } }),
  v_ridge_025: variant({ keyRidge: { v: 0.25 } }),
  v_ridge_010: variant({ keyRidge: { v: 0.1 } }),
  v_open_025: variant({ keyRidge: { v: 0.25, open: 0.25 } }),
  quad_ridge_050: variant({ quadRidge: 0.5 }),
  affY_180: variant({}, { maxSlopeY: 1.8 }),
  v025_affY180: variant({ keyRidge: { v: 0.25 } }, { maxSlopeY: 1.8 }),
  lambda_025: variant({}, {}, { lambda: 0.25 }),
  aggregate: variant({}, {}, { aggregate: true }),
  aggregate_cap6: variant({}, {}, { aggregate: true, aggregateCap: 6 }),
  aggregate_bin400: variant({}, {}, { aggregate: true, pursuitBinMs: 400 }),
  /* 축 교차 수축: 가로 모델의 세로 특징(v·open·v²·uv), 세로 모델의 가로 특징(u·u²·uv)을 더 강하게 수축 */
  cross_10: variant({ axisRidge: { x: { v: 10, open: 10, v2: 10, uv: 10 }, y: { u: 10, u2: 10, uv: 10 } } }),
  cross_100: variant({ axisRidge: { x: { v: 100, open: 100, v2: 100, uv: 100 }, y: { u: 100, u2: 100, uv: 100 } } }),
  crossX_10: variant({ axisRidge: { x: { v: 10, open: 10, v2: 10, uv: 10 } } }),
  crossX_100: variant({ axisRidge: { x: { v: 100, open: 100, v2: 100, uv: 100 } } }),
};
const ONLY = (process.argv.find(a => a.startsWith('--variants=')) || '').slice(11).split(',').filter(Boolean);
if (ONLY.length) for (const k of Object.keys(VARIANTS)) if (k !== 'base' && !ONLY.includes(k)) delete VARIANTS[k];

function evalSession(obj, V) {
  const S = A.loadSession(obj);
  const rp = A.reconstructPipeline(V.N, S, V.pipeOpt);
  if (!rp || !rp.ok || !rp.fineHeldOut) return null;
  const { W, H } = S, T = S.targets.filter(t => t.round === rp.round && t.kind === 'fine');
  /* 정밀 점 정지 표적: 선택 모델 */
  const pts = T.map(t => { const fs = S.calibrationFrames.filter(f => f.gazeOk && f.tc >= t.sampleStart && f.tc < t.sampleEnd).map(S.feat).filter(Boolean); const g = fs.map(f => V.N.applyResidual(rp.selection.resid, V.N.applyAffine(rp.selection.affine, V.N.predictGaze(rp.selection.model, f)))).filter(v => v && finite(v.x)); return g.length >= 4 ? { x: t.x, y: t.y, gx: med(g.map(v => v.x)), gy: med(g.map(v => v.y)) } : null; }).filter(Boolean);
  const out = { code: String(obj.code).slice(0, 8), held: rp.fineHeldOut.errPct, hx: mean(pts.map(p => Math.abs(p.gx - p.x))) / W * 100, hy: mean(pts.map(p => Math.abs(p.gy - p.y))) / H * 100, gainY: slope(pts.map(p => p.y), pts.map(p => p.gy)), gainX: slope(pts.map(p => p.x), pts.map(p => p.gx)) };
  /* 원형 추적 과제: 최종 모델 + 기록된 영점 */
  const c = S.payload.pursuit && S.payload.pursuit.circle;
  if (c) {
    const P = A.predictFrames(V.N, rp.final, S, S.frames.filter(f => f.tc >= c.t0 + 1500 && f.tc <= c.t0 + c.dur));
    const R = P.map(r => { const a = 2 * Math.PI * c.freq * (r.tc - c.t0 - 120) / 1000 - Math.PI / 2; return { tx: c.cx + c.r * Math.cos(a), ty: c.cy + c.r * Math.sin(a), gx: r.bx - r.driftDx, gy: r.by - r.driftDy }; });
    if (R.length >= 20) { out.cHx = mean(R.map(r => Math.abs(r.gx - r.tx))) / W * 100; out.cHy = mean(R.map(r => Math.abs(r.gy - r.ty))) / H * 100; out.cGainY = slope(R.map(r => r.ty), R.map(r => r.gy)); out.cGainX = slope(R.map(r => r.tx), R.map(r => r.gx)); }
  }
  return out;
}

const args = process.argv.slice(2), dir = args.find(a => !a.startsWith('--')), outPath = (args.find(a => a.startsWith('--out=')) || '').slice(6);
const sessions = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))).filter(o => o.payload && !(o.meta || {}).synthetic);
const res = {};
for (const [name, V] of Object.entries(VARIANTS)) {
  res[name] = [];
  for (const o of sessions) { let r = null; try { r = evalSession(o, V); } catch (e) { r = null; } if (r) res[name].push(r); }
}
/* 공통 세션 집합에서만 비교 */
const common = res.base.map(r => r.code).filter(c => Object.values(res).every(list => list.some(r => r.code === c)));
const summary = {};
for (const [name, list] of Object.entries(res)) {
  const L = list.filter(r => common.includes(r.code)), today = L.filter(r => ['NLR-8700', 'NLR-7AB5', 'NLR-A730', 'NLR-6168'].includes(r.code));
  const agg = rows => ({ n: rows.length, held: r1(mean(rows.map(r => r.held))), hx: r1(mean(rows.map(r => r.hx))), hy: r1(mean(rows.map(r => r.hy))), gainY: r1(med(rows.map(r => r.gainY))), gainX: r1(med(rows.map(r => r.gainX))), circleN: rows.filter(r => finite(r.cHy)).length, cHx: r1(mean(rows.map(r => r.cHx))), cHy: r1(mean(rows.map(r => r.cHy))), cGainY: r1(med(rows.map(r => r.cGainY))) });
  summary[name] = { all: agg(L), today: agg(today) };
}
/* 세션별 승패(held-out) */
const wins = {};
for (const name of Object.keys(res)) { if (name === 'base') continue; let w = 0, l = 0; for (const c of common) { const b = res.base.find(r => r.code === c), v = res[name].find(r => r.code === c); if (v.held < b.held - 0.2) w++; else if (v.held > b.held + 0.2) l++; } wins[name] = { better: w, worse: l, same: common.length - w - l }; }
const report = { generatedAt: new Date().toISOString(), engine: N.VERSION, sessions: common.length, summary, winsVsBaseOnHeldOut: wins, perSession: res };
if (outPath) fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ sessions: common.length, summary, winsVsBaseOnHeldOut: wins }, null, 1));
