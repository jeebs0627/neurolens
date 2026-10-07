/* 시선 보정 실측 재생 벤치마크 (연구 원자료 · 저장소 밖 로컬 파일만 읽음)
 * 세션 JSON(tools/newbiz_research_export.py 결과의 payload, 또는 같은 구조)을 받아, 보정 표본을 telemetry.calibrationFrames + calibration.targets 로
 * 다시 만들고 보정 파이프라인(condition.html calibrate() 과 같은 순서, 커서 과제 제외)을 돌린 뒤
 *   (a) 학습에 쓰지 않은 4단계 정밀 보정 8점의 오차(화면 폭 %) · (b) 과제 오차: 원형 추적(x·y 정답)·속도 단계(x 정답), payload.frames 특징으로 예측
 * 를 잰다. 기록된 프레임 특징의 v 는 기록 당시 엔진(눈꺼풀 중점 기준)이라, 현재 엔진(core 2.3, 눈꼬리 축 기준)은 payload.landmarks 로 v 를 다시 계산해 평가한다(vref 'corner').
 * 실행: node tools/gaze_replay.cjs <세션 폴더> [variant,...] [--ref=이전커밋(기본 9e3eccd)]
 * 2026-10-07 결과(13세션): old 정밀 11.5% / 원형 13.1% (세로 15.4%H) → new 9.6% / 9.8% (세로 8.9%H), 영점 뒤 10.6 → 6.9% */
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2), SESS = args.find(a => !a.startsWith('--') && fs.existsSync(a) && fs.statSync(a).isDirectory());
if (!SESS) { console.error('usage: node tools/gaze_replay.cjs <sessions dir> [variants] [--ref=commit]'); process.exit(1); }
const ref = (args.find(a => a.startsWith('--ref=')) || '--ref=9e3eccd').slice(6), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-old-'));
for (const f of ['newbiz-core.js', 'condition-signal.js', 'condition-fusion.js']) fs.writeFileSync(path.join(tmp, f), execFileSync('git', ['show', ref + ':' + f], { cwd: ROOT }));
const NEW = require(ROOT + '/newbiz-core.js'), OLD = require(path.join(tmp, 'newbiz-core.js'));
const finite = Number.isFinite, median = a => NEW.median(a), mean = a => NEW.mean(a);

function decodeFrames(F) {
  if (!F || !F.t) return [];
  const sc = F.scale, out = [];
  for (let i = 0; i < F.t.length; i++) {
    const f = { t: F.t0 + F.t[i] };
    for (const k of Object.keys(sc)) { if (k === 'rr' || k === 'rq' || !F[k]) continue; const v = F[k][i]; f[k] = v == null ? null : v / sc[k]; }
    f.gazeOk = !!f.gazeOk; f.eyes = { left: { u: f.uLeft, v: f.vLeft, q: f.qLeft ?? 0 }, right: { u: f.uRight, v: f.vRight, q: f.qRight ?? 0 } };
    out.push(f);
  }
  return out;
}
/* landmark rows -> map(round(t_abs)) -> sparse lm (478) */
function landmarkMap(p) {
  const L = p.landmarks; if (!L) return null;
  const idx = L.idx, times = [], lms = [];
  for (const r of L.rows) { const lm = new Array(478); for (let k = 0; k < idx.length; k++) lm[idx[k]] = { x: r[1 + 2 * k] / L.scale, y: r[2 + 2 * k] / L.scale }; times.push(p.t0 + r[0]); lms.push(lm); }
  /* nearest row within 3 ms (both clocks were rounded separately) */
  return { get(t) { let lo = 0, hi = times.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid] < t) lo = mid + 1; else hi = mid; } let best = lo, d = Math.abs(times[lo] - t); if (lo > 0 && Math.abs(times[lo - 1] - t) < d) { best = lo - 1; d = Math.abs(times[lo - 1] - t); } return d <= 3 ? lms[best] : undefined; }, size: times.length };
}
const LM = { rOuter: 33, rInner: 133, rTop: 159, rBot: 145, rIris: 468, lInner: 362, lOuter: 263, lTop: 386, lBot: 374, lIris: 473 };
/* eye-local features from landmarks with a selectable vertical reference: 'lid' (current) or 'corner' */
function eyeUV(lm, a, b, top, bot, iris, vref) {
  const A = lm[a], B = lm[b], T = lm[top], Bo = lm[bot]; if (!A || !B || !T || !Bo) return null;
  if (A.x > B.x) [a, b] = [b, a];
  const ax = lm[a].x, ay = lm[a].y, bx = lm[b].x, by = lm[b].y, dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, L = Math.sqrt(L2);
  let icx = 0, icy = 0; for (let k = 0; k < 5; k++) { const q = lm[iris + k]; if (!q) return null; icx += q.x; icy += q.y; } icx /= 5; icy /= 5;
  const u = ((icx - ax) * dx + (icy - ay) * dy) / L2;
  const midX = vref === 'corner' ? (ax + bx) / 2 : (T.x + Bo.x) / 2, midY = vref === 'corner' ? (ay + by) / 2 : (T.y + Bo.y) / 2;
  const v = (-(icx - midX) * dy + (icy - midY) * dx) / L2;
  const open = Math.hypot(Bo.x - T.x, Bo.y - T.y) / L;
  return { u, v, open };
}
function altFeature(f, lm, vref) {
  if (!lm) return null;
  const R = eyeUV(lm, LM.rOuter, LM.rInner, LM.rTop, LM.rBot, LM.rIris, vref), Lf = eyeUV(lm, LM.lInner, LM.lOuter, LM.lTop, LM.lBot, LM.lIris, vref);
  const ok = e => e && [e.u, e.v, e.open].every(finite) && e.u > -.25 && e.u < 1.25 && Math.abs(e.v) < .5;
  const use = [R, Lf].filter(ok); if (!use.length) return null;
  const g = { ...f, u: mean(use.map(e => e.u)), v: mean(use.map(e => e.v)), ...(ok(Lf) ? { uLeft: Lf.u, vLeft: Lf.v } : {}), ...(ok(R) ? { uRight: R.u, vRight: R.v } : {}), eyes: { left: { ...f.eyes.left, ...(ok(Lf) ? { u: Lf.u, v: Lf.v } : {}) }, right: { ...f.eyes.right, ...(ok(R) ? { u: R.u, v: R.v } : {}) } } };
  return g;
}

function loadSession(file) {
  const p = JSON.parse(fs.readFileSync(file, 'utf8')), c = p.calibration;
  const W = c.screen.w, H = c.screen.h, cf = decodeFrames(p.telemetry.calibrationFrames), lmap = landmarkMap(p);
  const targets = c.targets.map(t => ({ t: p.t0 + t[0], x: t[1], y: t[2], kind: t[3] }));
  const fix9 = targets.filter(t => t.kind === 'fix9'), vals = targets.filter(t => t.kind === 'val'), zone = targets.filter(t => t.kind === 'zone');
  const val4 = vals.slice(0, 4), fine8 = vals.slice(4);
  const next = t => { const i = targets.indexOf(t); return i + 1 < targets.length ? targets[i + 1].t : t.t + 3000; };
  const within = (a, b) => cf.filter(f => f.gazeOk && f.t >= a && f.t < b);
  const pt = (t, from, to) => ({ x: t.x, y: t.y, fs: within(t.t + from, Math.min(t.t + to, next(t))) });
  const s9 = fix9.map(t => pt(t, 650, 2900));
  const pu = c.pursuit, t0 = p.t0 + pu.t0, pos = tt => ({ x: W * (0.5 + 0.38 * Math.sin(2 * Math.PI * 0.12 * tt / 1000)), y: H * (0.5 + 0.34 * Math.sin(2 * Math.PI * 0.08 * tt / 1000 + Math.PI / 2)) });
  const sp = within(t0 + 1000, t0 + pu.sec * 1000).map(f => ({ ...pos(f.t - t0 - 120), f, w: 0.5 }));
  const task = decodeFrames(p.frames);
  const circle = p.pursuit && p.pursuit.circle ? { ...p.pursuit.circle, t0: p.t0 + p.pursuit.circle.t0 } : null;
  const levels = (p.pursuit && p.pursuit.levels || []).map(l => ({ ...l, t0: p.t0 + l.t0 }));
  return { code: path.basename(file).slice(4, 8), W, H, s9, sp, val: val4.map(t => pt(t, 500, 2500)), zc: zone.map(t => pt(t, 500, 2500)), fp: fine8.map(t => pt(t, 500, 2500)), task, circle, levels, levAmp: p.pursuit && p.pursuit.amp, lmap, drift: p.telemetry.drift || [] };
}

/* apply a feature transform to every sample/frame */
function transform(S, fn) {
  const tp = list => list.map(p => ({ ...p, fs: p.fs.map(f => fn(f)).filter(Boolean) }));
  return { ...S, s9: tp(S.s9), val: tp(S.val), zc: tp(S.zc), fp: tp(S.fp), sp: S.sp.map(s => { const f = fn(s.f); return f ? { ...s, f } : null; }).filter(Boolean), task: S.task.map(f => fn(f)).filter(Boolean) };
}

/* pipeline mirroring condition.html calibrate() (without the cursor task) */
function pipeline(N, S, opt = {}) {
  const LAM = opt.lambda ?? 0.5, FO = opt.fitOpt || {};
  const { W, H } = S, flat = l => l.flatMap(p => p.fs.map(f => ({ x: p.x, y: p.y, f })));
  const robust = l => l.map(p => ({ ...p, fs: N.robustFeatures(p.fs) }));
  const s9 = flat(robust(S.s9)), sp = opt.pursuit === false ? [] : S.sp.map(s => ({ ...s, w: opt.pw ?? 0.5 })), val = robust(S.val), zc = robust(S.zc), fp = robust(S.fp);
  const at = (m, A, R, p) => { const g = p.fs.map(f => N.applyResidual(R, N.applyAffine(A, N.predictGaze(m, f)))).filter(q => q && finite(q.x) && finite(q.y)); return g.length >= 4 ? { x: p.x, y: p.y, gx: median(g.map(q => q.x)), gy: median(g.map(q => q.y)) } : { x: p.x, y: p.y, gx: null, gy: null }; };
  const acc = pts => N.gazeAccuracy(pts, W, H);
  const cands = [{ key: '9점', m: N.fitGaze(s9, LAM, FO) }, { key: '9점+추적', m: sp.length >= 60 ? N.fitGaze([...s9, ...sp], LAM, FO) : null }].filter(c => c.m)
    .map(c => { const pick = opt.pick9 ? [...val, ...zc] : val; N.validateGazeEyes(c.m, pick, W, H); return { ...c, acc: acc(pick.map(p => at(c.m, null, null, p))) }; }).filter(c => c.acc.errPct !== null).sort((a, b) => a.acc.errPct - b.acc.errPct);
  if (!cands.length) return null;
  let model = cands[0].m, affine = null, resid = null;
  const pairs = [...val, ...zc].map(p => at(model, null, null, p));
  const A = N.fitAffine(pairs);
  const loo = () => { const ok = pairs.filter(p => finite(p.gx)); if (ok.length < 5) return null; return acc(ok.map((p, i) => { const Ai = N.fitAffine(ok.filter((_, j) => j !== i)); const g = N.applyAffine(Ai, { x: p.gx, y: p.gy }); return { x: p.x, y: p.y, gx: g.x, gy: g.y }; })); };
  const after = loo();
  if (A && after && after.errPct !== null && after.errPct < cands[0].acc.errPct) affine = A;
  const stage2 = { model: cands[0].key, modelErr: cands[0].acc.errPct, affine: !!affine };
  if (!fp.length || opt.fine === false) return { model, affine, resid, stage2, fine: null, finalFit: { model, affine, resid } };
  const train = [...s9, ...flat(val), ...flat(zc)];
  const m2 = N.fitGaze(train, LAM, FO); if (m2) N.validateGazeEyes(m2, val, W, H);
  const cand = [{ key: '기존 보정', model, A: affine, R: null }];
  if (m2) cand.push({ key: '재학습', model: m2, A: N.fitAffine([...val, ...zc].map(p => at(m2, null, null, p))), R: null });
  if (opt.lookV !== false) { const m3 = N.fitGaze(train, LAM, { ...FO, extra: ['lookV'] }); if (m3 && m3.keys.includes('lookV')) { N.validateGazeEyes(m3, val, W, H); cand.push({ key: '재학습·lookV', model: m3, A: N.fitAffine([...val, ...zc].map(p => at(m3, null, null, p))), R: null, extra: ['lookV'] }); } }
  cand.slice().forEach(c0 => {
    const pr = [...val, ...zc].map(p => at(c0.model, c0.A, null, p));
    const R = opt.residual === false ? null : N.fitResidual(pr, W, H); if (R) cand.push({ ...c0, key: c0.key + '+잔차', R });
    if (opt.local && N.fitLocalResidual) { const RL = N.fitLocalResidual(pr, W, H); if (RL) cand.push({ ...c0, key: c0.key + '+국소', R: RL }); }
  });
  cand.forEach(c => { c.acc = acc(fp.map(p => at(c.model, c.A, c.R, p))); });
  const ok = cand.filter(c => c.acc.errPct !== null).sort((a, b) => a.acc.errPct - b.acc.errPct);
  const b0 = N.pickCalibration ? N.pickCalibration(ok) : ok[0];
  /* final refit with fine points included (as live) */
  let final = { model: b0.model, affine: b0.A, resid: b0.R };
  if (!opt.noFinalRefit) {
    const pts = [...val, ...zc, ...fp];
    const mF = b0.key.startsWith('재학습') ? (N.fitGaze([...train, ...flat(fp)], LAM, { ...FO, extra: b0.extra || [] }) || b0.model) : b0.model;
    if (mF !== b0.model) N.validateGazeEyes(mF, val, W, H);
    const AF = N.fitAffine(pts.map(p => at(mF, null, null, p))) || b0.A;
    const RF = b0.R ? (b0.R.kind === 'local' ? N.fitLocalResidual : N.fitResidual)(pts.map(p => at(mF, AF, null, p)), W, H) : null;
    const eB = acc(pts.map(p => at(b0.model, b0.A, b0.R, p))), eF = acc(pts.map(p => at(mF, AF, RF, p)));
    if (eF.errPct !== null && eB.errPct !== null && eF.errPct <= eB.errPct) final = { model: mF, affine: AF, resid: RF };
  }
  /* honest held-out numbers: fine-point error of the chosen candidate; equal-weight mean distance regardless of engine metric */
  const held = fp.map(p => at(b0.model, b0.A, b0.R, p)).filter(p => finite(p.gx));
  const dist = held.map(p => Math.hypot(p.gx - p.x, p.gy - p.y) / W * 100), hx = held.map(p => Math.abs(p.gx - p.x) / W * 100), hy = held.map(p => Math.abs(p.gy - p.y) / H * 100);
  return { ...final, stage2, fine: { chosen: b0.key, held: dist.length ? mean(dist) : null, hx: mean(hx), hy: mean(hy), n: held.length, cands: ok.slice(0, 4).map(c => c.key + ' ' + c.acc.errPct) }, finalFit: final };
}

/* task evaluation on payload.frames: circle (x,y) and horizontal levels (x, y=H/2) */
function taskEval(N, S, fit) {
  if (!fit) return null;
  const { W, H } = S, pred = f => { const g = N.predictGaze(fit.model, f); if (!g) return null; return N.applyResidual(fit.resid, N.applyAffine(fit.affine, g)); };
  const rows = [];
  if (S.circle) { const c = S.circle; for (const f of S.task) { if (!f.gazeOk || f.t < c.t0 + 1500 || f.t > c.t0 + c.dur) continue; const g = pred(f); if (!g) continue; const a = 2 * Math.PI * c.freq * (f.t - c.t0 - 120) / 1000 - Math.PI / 2; rows.push({ kind: 'circle', gx: g.x, gy: g.y, x: c.cx + c.r * Math.cos(a), y: c.cy + c.r * Math.sin(a) }); } }
  for (const l of S.levels) for (const f of S.task) { if (!f.gazeOk || f.t < l.t0 + 1500 || f.t > l.t0 + l.dur) continue; const g = pred(f); if (!g) continue; rows.push({ kind: 'level', gx: g.x, gy: g.y, x: S.W / 2 + (S.levAmp || 0.32 * W) * Math.sin(2 * Math.PI * l.freq * (f.t - l.t0 - 120) / 1000), y: H / 2 }); }
  const summarize = R => { if (R.length < 20) return null; const dx = R.map(r => r.gx - r.x), dy = R.map(r => r.gy - r.y), mx = median(dx), my = median(dy); return { n: R.length, raw: mean(R.map(r => Math.hypot(r.gx - r.x, r.gy - r.y))) / W * 100, zeroed: mean(R.map(r => Math.hypot(r.gx - r.x - mx, r.gy - r.y - my))) / W * 100, biasX: mx / W * 100, biasY: my / H * 100, hy: mean(dy.map(v => Math.abs(v - my))) / H * 100, hx: mean(dx.map(v => Math.abs(v - mx))) / W * 100 }; };
  return { circle: summarize(rows.filter(r => r.kind === 'circle')), level: summarize(rows.filter(r => r.kind === 'level')) };
}

const VARIANTS = {
  old: { N: OLD, opt: {} },                                   // 이전 엔진 · 기록된(눈꺼풀 기준) v
  old_corner: { N: OLD, opt: {}, vref: 'corner' },           // 이전 엔진 · 눈꼬리 기준 v
  new: { N: NEW, opt: { lookV: false }, vref: 'corner' },    // 현재 엔진(core 2.3 파이프라인)
  new_nopursuit: { N: NEW, opt: { lookV: false, pursuit: false }, vref: 'corner' },
  new_nofine: { N: NEW, opt: { lookV: false, fine: false }, vref: 'corner' },
  new_nores: { N: NEW, opt: { lookV: false, residual: false }, vref: 'corner' },
};
const want = args.filter(a => VARIANTS[a]).length ? args.filter(a => VARIANTS[a]) : ['old', 'new'];
const files = fs.readdirSync(SESS).filter(f => f.endsWith('.json')).map(f => path.join(SESS, f));
const results = {};
for (const file of files) {
  const S0 = loadSession(file);
  if (!S0.fp.length) continue;
  for (const name of want) {
    const V = VARIANTS[name]; if (!V) continue;
    let S = S0;
    if (V.vref) { const lmap = S0.lmap; S = transform(S0, f => altFeature(f, lmap.get(f.t), V.vref)); }
    if (V.vref) { const n0 = S0.s9.reduce((a, p) => a + p.fs.length, 0), n1 = S.s9.reduce((a, p) => a + p.fs.length, 0); if (n1 < n0 * 0.8) console.log(`${name} ${S0.code}: landmark match ${n1}/${n0} fix9 frames`); }
    let r; try { r = pipeline(V.N, S, V.opt); } catch (e) { r = null; console.log(name, S0.code, 'ERR', e.message); }
    if (!r) console.log(name, S0.code, 'pipeline null');
    const te = r ? taskEval(V.N, S, r.finalFit) : null;
    (results[name] = results[name] || []).push({ code: S0.code, model: r?.stage2.model, chosen: r?.fine?.chosen, held: r?.fine?.held, hx: r?.fine?.hx, hy: r?.fine?.hy, circ: te?.circle?.raw, circZ: te?.circle?.zeroed, circHy: te?.circle?.hy, lev: te?.level?.raw, levZ: te?.level?.zeroed, bx: te?.circle?.biasX, by: te?.circle?.biasY });
  }
}
const r1 = v => (finite(v) ? Math.round(v * 10) / 10 : '—');
for (const name of want) {
  if (!results[name]) continue;
  console.log(`\n=== ${name}`);
  console.table(results[name].map(r => ({ code: r.code, model: r.model, chosen: r.chosen, 'fine held%': r1(r.held), hx: r1(r.hx), hy: r1(r.hy), 'circle raw%': r1(r.circ), 'circle zeroed%': r1(r.circZ), 'circle hy%': r1(r.circHy), 'level raw%': r1(r.lev), 'level zeroed%': r1(r.levZ), 'bias x/y%': `${r1(r.bx)}/${r1(r.by)}` })));
  const m = k => r1(mean(results[name].map(r => r[k]).filter(finite)));
  console.log(`${name} MEAN: fine ${m('held')} (hx ${m('hx')} hy ${m('hy')}) · circle raw ${m('circ')} zeroed ${m('circZ')} hy ${m('circHy')} · level raw ${m('lev')} zeroed ${m('levZ')}`);
}

fs.rmSync(tmp, { recursive: true, force: true });
