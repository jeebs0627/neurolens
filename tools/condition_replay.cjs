/* 실측 원자료 재생: 연구 패키지(nl-research-2/3 payload) + 세션 요약 메타 → 엔진 입력(rec) 복원 → NLBattery.run
 * 원자료는 training/raw/<code>.json (git·배포 제외), 메타는 training/raw/_meta.json ({code: {meta, calibration, checkin, steps, ...}})
 * 받는 법(읽기 전용): newbiz_research_chunks 를 idx 순으로 string_agg → base64 → gzip → JSON 을 <code>.json 으로, 같은 세션의
 *   newbiz_research_sessions.meta · summary->calibration · summary->checkin · summary->dataset->tests(status) 를 _meta.json 으로.
 *   재현 확인(2026-10-10): NLR-9A27… 재생 결과가 저장된 리포트와 지표 25개·검사 신뢰도·종합 76% 까지 일치
 * 사용: const R = require('./tools/condition_replay.cjs'); const rec = R.load(code); const res = R.run(rec[, B])
 * 실행: node tools/condition_replay.cjs [이전 커밋]  — 세션별 검사 신뢰도(현재 엔진 vs 이전 커밋) 표
 *       node tools/condition_replay.cjs --promote  — 참고 지표 판정 격상 기준 점검(아래 PROMOTE) */
const fs = require('fs'), path = require('path');
const RAW = path.join(__dirname, '..', 'training', 'raw');

function unpackFrames(F) {
  if (!F || !Array.isArray(F.t)) return [];
  const sc = F.scale || {};
  return F.t.map((t, i) => {
    const f = { t };
    for (const [k, s] of Object.entries(sc)) {
      if (k === 'rr' || k === 'rq' || !F[k]) continue;
      const v = F[k][i];
      f[k] = Number.isFinite(v) ? v / s : null;
    }
    const rr = F.rr && F.rr[i];
    if (rr) f.rr = [0, 1, 2].map(j => { const c = rr.slice(j * 3, j * 3 + 3); return c.length === 3 && c.every(Number.isFinite) ? c.map(v => v / 100) : null; });
    if (F.rq && F.rq[i]) f.rq = F.rq[i].map(v => Number.isFinite(v) ? v / 1000 : 0);
    for (const k of ['clockSource', 'source', 'reason']) if (F[k]) f[k] = F[k][i];
    return f;
  });
}
function unpackSamples(rows, cols) {
  const ix = Object.fromEntries(cols.map((c, i) => [c, i]));
  const g = (r, c) => ix[c] === undefined ? undefined : r[ix[c]];
  return (rows || []).map(r => {
    const p = { t: g(r, 't'), x: g(r, 'x'), y: g(r, 'y'), rx: g(r, 'rx'), ry: g(r, 'ry'), bl: !!g(r, 'blink') };
    const q = g(r, 'quality_x1000'); if (Number.isFinite(q)) p.q = q / 1000;
    const m = g(r, 'eyeMode'); if (m) p.mode = m;
    const lag = g(r, 'inferenceLagMs'); if (Number.isFinite(lag)) p.lag = lag;
    for (const k of ['px', 'py', 'sx', 'sy', 'bx', 'by']) { const v = g(r, k); if (Number.isFinite(v)) p[k] = v; }
    return p;
  });
}
function toRec(P, M) {
  const cols = P.sampleColumns || ['t', 'x', 'y', 'rx', 'ry', 'blink', 'quality_x1000', 'eyeMode', 'inferenceLagMs'];
  const S = rows => unpackSamples(rows, cols);
  const pu = P.pursuit;
  const screen = (P.calibration && (P.calibration.viewport || P.calibration.screen)) || (M.meta && M.meta.screen) || {};
  return {
    frames: unpackFrames(P.frames),
    phases: Object.fromEntries(Object.entries(P.phases || {}).map(([k, v]) => [k, { start: v[0], end: v[1] }])),
    hidden: (P.hidden || []).map(([a, b]) => ({ start: a, end: b })),
    trials: (P.freeview || []).map(tr => ({ kind: tr.kind, sub: tr.sub, emoSide: tr.emoSide, emoId: tr.emoId, neuId: tr.neuId, onset: tr.onset, end: tr.end, samples: S(tr.s) })),
    saccade: P.saccade && P.saccade.length ? P.saccade.map(tr => ({ type: tr.type, side: tr.side, practice: !!tr.practice, onset: tr.onset, end: tr.end, cal: tr.cal || null, samples: S(tr.s) })) : null,
    saccadeCal: P.saccadeCal || null,
    pursuit: pu ? { version: pu.version, t0: pu.t0, cx: pu.cx, amp: pu.amp, freq: pu.freq, dur: pu.dur, samples: S(pu.s),
      ...(pu.levels ? { levels: pu.levels.map(b => ({ freq: b.freq, t0: b.t0, dur: b.dur, samples: S(b.s) })) } : {}),
      ...(pu.reversal ? { reversal: { ...pu.reversal, s: undefined, samples: S(pu.reversal.s) } } : {}),
      ...(pu.circle ? { circle: { ...pu.circle, s: undefined, samples: S(pu.circle.s) } } : {}) } : null,
    pvt: P.pvt ? { falseStarts: P.pvt.falseStarts, durationMs: P.pvt.durationMs, trials: P.pvt.trials.map(([onset, rt]) => ({ onset, rt })) } : null,
    sart: P.sart ? { trials: P.sart.trials.map(([digit, onset, rt]) => ({ digit, onset, rt })) } : null,
    stressScore: P.stress || null,
    steps: M.steps || null,
    screenW: screen.w || screen.vw || 1440,
    calibration: M.calibration || null,
    checkin: M.checkin || {},
    demo: false, mode: M.meta && M.meta.mode,
  };
}
let META = null;
function load(code) {
  META = META || JSON.parse(fs.readFileSync(path.join(RAW, '_meta.json'), 'utf8'));
  const P = JSON.parse(fs.readFileSync(path.join(RAW, code + '.json'), 'utf8'));
  return toRec(P, META[code] || {});
}
const codes = () => fs.readdirSync(RAW).filter(f => /^NLR-.*\.json$/.test(f)).map(f => f.slice(0, -5));
const run = (rec, B = require('../newbiz-battery.js')) => B.run(rec);
module.exports = { load, codes, run, toRec, unpackFrames, unpackSamples, meta: () => META };

/* 참고 지표 → 판정 지표 격상 기준(2026-10-10): ① 꾸준함 — 측정된 세션의 80% 이상에서 신뢰도 r ≥ 0.8
 * ② 새 정보 — 이미 판정에 쓰는 지표와 |상관| < 0.7(중복이면 같은 것을 두 번 센다) ③ 타당성 — 값의 90% 이상이 생리적으로 가능한 범위.
 * 셋 다 통과해야 격상 후보. 범위는 문헌·과제 정의에서: d′ 0~4.65(오경보·적중 1/(2n) 보정 상한), 방향 전환 지연 80~500ms, 속도 유지율 0.2~1.05(빠를수록 이득이 오르지 않음) */
const PROMOTE = { sartDprime: v => v >= 0 && v <= 4.65, ...require('../newbiz-battery.js').ADMIT.plausible };   // 세션별 자격 심사(battery 1.8 ADMIT)와 같은 범위
function promotionReport(B = require('../newbiz-battery.js')) {
  const corr = (a, b) => { const p = a.map((v, i) => [v, b[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y)); if (p.length < 5) return NaN; const n = p.length, mx = p.reduce((s, v) => s + v[0], 0) / n, my = p.reduce((s, v) => s + v[1], 0) / n; let sxy = 0, sxx = 0, syy = 0; p.forEach(([x, y]) => { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }); return sxy / Math.sqrt(sxx * syy); };
  const V = {};
  for (const code of codes()) { let rec; try { rec = load(code); } catch (e) { continue; } if (!rec.sart) continue; for (const i of run(rec, B).battery.indicators) (V[i.key] = V[i.key] || []).push({ v: i.value, r: i.r, ref: i.ref }); }
  return Object.entries(PROMOTE).map(([k, plaus]) => {
    const all = V[k] || [], m = all.filter(x => Number.isFinite(x.v)), steady = m.filter(x => x.r >= 0.8).length / (m.length || 1), valid = m.filter(x => plaus(x.v)).length / (m.length || 1);
    const scored = Object.keys(V).filter(o => !PROMOTE[o] && V[o].some(x => !x.ref)), overlap = scored.map(o => [o, corr(all.map(x => x.v), V[o].map(x => x.v))]).filter(x => Number.isFinite(x[1])).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]))[0] || ['—', 0];
    return { key: k, measured: `${m.length}/${all.length}`, steady: Math.round(steady * 100), valid: Math.round(valid * 100), overlap: `${overlap[0]} ${overlap[1].toFixed(2)}`, promote: steady >= 0.8 && valid >= 0.9 && Math.abs(overlap[1]) < 0.7 };
  });
}
module.exports.promotionReport = promotionReport;

if (require.main === module && process.argv.includes('--promote')) { console.table(promotionReport()); process.exit(0); }
if (require.main === module) {
  const ref = process.argv[2];
  let OLD = null;
  if (ref) {
    const os = require('os'), { execFileSync } = require('child_process'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-old-'));
    for (const f of ['newbiz-core.js', 'condition-signal.js', 'condition-fusion.js', 'newbiz-battery.js', 'condition-reference.js']) { try { fs.writeFileSync(path.join(dir, f), execFileSync('git', ['show', ref + ':' + f], { cwd: path.join(__dirname, '..') })); } catch (e) { /* 그 커밋에 없는 파일 */ } }
    OLD = require(path.join(dir, 'newbiz-battery.js'));
  }
  const rows = [], sum = {};
  const stepR = res => Object.fromEntries((res.battery.qc.steps || []).map(s => [s.key, s.r]));
  for (const code of codes()) {
    const rec = load(code), c = run(rec), o = OLD ? run(rec, OLD) : null;
    const rc = stepR(c), ro = o ? stepR(o) : {};
    const row = { code: code.slice(4, 10), conf: c.battery.qc.confidence + (o ? ` (${o.battery.qc.confidence})` : '') };
    for (const k of ['baseline', 'saccade', 'stress', 'pvt', 'pursuit', 'freeview']) { row[k] = (rc[k] ?? '—') + (o ? ` (${ro[k] ?? '—'})` : ''); (sum[k] = sum[k] || []).push([rc[k], ro[k]]); }
    for (const k of ['alert', 'control', 'emotion', 'autonomic']) (sum['영역 ' + k] = sum['영역 ' + k] || []).push([c.battery.domains[k].confidence, o && o.battery.domains[k].confidence]);
    (sum['종합'] = sum['종합'] || []).push([c.battery.qc.confidence, o && o.battery.qc.confidence]);
    rows.push(row);
  }
  console.table(rows);
  const mean = a => a.length ? Math.round(a.reduce((s, v) => s + v, 0) / a.length * 100) : null;
  console.log(Object.entries(sum).map(([k, v]) => `${k} 평균 ${mean(v.map(x => x[0]).filter(Number.isFinite))}%${OLD ? ` (이전 ${mean(v.map(x => x[1]).filter(Number.isFinite))}%)` : ''}`).join(' · '));
}
