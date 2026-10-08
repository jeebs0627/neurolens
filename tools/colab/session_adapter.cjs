/* 연구 세션 JSON 공통 adapter (Node · tools 전용 · 저장소 밖 로컬 파일만 읽는다)
 *   · v1/v2/v3 payload 해석: frames / telemetry.calibrationFrames(각자 t0) / landmarks / calibration.targets(+targetsV2·rounds) / pursuit 메타 / gazeLabels / reference
 *   · canonical session clock: payload.t0 기준 ms (frames.t0·calibrationFrames.t0 는 각자 원점이라 변환한다)
 *   · 과거 자료의 빠진 값은 ‘버전별 명시적 legacy fallback’으로 채우고 flags 에 남긴다. 기록에 없는 값을 기록된 것처럼 쓰지 않는다
 *   · 개인 시선 파이프라인 재구성: v3 snapshot(기록) 또는 replay(condition.html calibrate() 순서, 커서 과제 제외). 둘 다 있으면 digest 를 비교해 fidelity 를 보고한다
 * 사용: tools/colab/baseline_predict.cjs · tools/gaze_replay.cjs · nlcolab(baseline.py 가 호출) */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const finite = Number.isFinite;
const Labels = require(path.join(ROOT, 'condition-labels.js'));

/* ---------- 버전 ---------- */
function coreVersionNumber(meta) {
  const m = /core\s+(\d+(?:\.\d+)?)/.exec(String(meta?.versions?.core || ''));
  return m ? parseFloat(m[1]) : null;
}
const LEGACY_PURSUIT = { pre23: { fx: 0.12, fy: 0.08, sec: 12.5, ax: 0.38, ay: 0.34, lagMs: 120 }, v23: { fx: 3 / 18, fy: 2 / 18, sec: 18, ax: 0.38, ay: 0.34, lagMs: 120 } };

/* ---------- 프레임 ---------- */
function decodeFrames(F, payloadT0 = null) {
  if (!F || !Array.isArray(F.t)) return [];
  const sc = F.scale || {}, out = [], origin = finite(F.t0) ? F.t0 : 0, base = finite(payloadT0) ? payloadT0 : origin;
  for (let i = 0; i < F.t.length; i++) {
    const t = origin + F.t[i], f = { t, tc: t - base, i };   // t: 기록 원점(performance.now) 절대값 · tc: payload.t0 기준 canonical ms
    for (const k of Object.keys(sc)) { if (k === 'rr' || k === 'rq' || !F[k]) continue; const v = F[k][i]; f[k] = v == null ? null : v / sc[k]; }
    for (const k of ['faceOk', 'eyeOk', 'skinOk', 'ppgOk', 'gazeOk', 'ok']) if (k in f) f[k] = !!f[k];
    f.clockSource = F.clockSource ? F.clockSource[i] : null; f.source = F.source ? F.source[i] : null; f.reason = F.reason ? F.reason[i] : null;
    f.eyes = { left: { u: f.uLeft, v: f.vLeft, q: f.qLeft ?? 0 }, right: { u: f.uRight, v: f.vRight, q: f.qRight ?? 0 } };
    out.push(f);
  }
  return out;
}
/* landmark rows(t rel to payload.t0) → 최근접(≤3ms) 조회 */
function landmarkMap(p) {
  const L = p.landmarks; if (!L || !Array.isArray(L.rows) || !L.rows.length) return null;
  const idx = L.idx, times = [], lms = [];
  for (const r of L.rows) { const lm = new Array(478); for (let k = 0; k < idx.length; k++) lm[idx[k]] = { x: r[1 + 2 * k] / L.scale, y: r[2 + 2 * k] / L.scale }; times.push(r[0]); lms.push(lm); }
  return { size: times.length, get(tc) { let lo = 0, hi = times.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid] < tc) lo = mid + 1; else hi = mid; } let best = lo, d = Math.abs(times[lo] - tc); if (lo > 0 && Math.abs(times[lo - 1] - tc) < d) { best = lo - 1; d = Math.abs(times[lo - 1] - tc); } return d <= 3 ? lms[best] : undefined; } };
}
const LM = { rOuter: 33, rInner: 133, rTop: 159, rBot: 145, rIris: 468, lInner: 362, lOuter: 263, lTop: 386, lBot: 374, lIris: 473 };
/* 눈 기준 좌표 (vref 'corner' = core 2.3 눈꼬리 축 · 'lid' = 이전 눈꺼풀 중점) — 랜드마크에서 다시 계산 */
function eyeUV(lm, a, b, top, bot, iris, vref) {
  const A = lm[a], B = lm[b], T = lm[top], Bo = lm[bot]; if (!A || !B || !T || !Bo) return null;
  if (A.x > B.x) [a, b] = [b, a];
  const ax = lm[a].x, ay = lm[a].y, bx = lm[b].x, by = lm[b].y, dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, L = Math.sqrt(L2);
  let icx = 0, icy = 0; for (let k = 0; k < 5; k++) { const q = lm[iris + k]; if (!q) return null; icx += q.x; icy += q.y; } icx /= 5; icy /= 5;
  const u = ((icx - ax) * dx + (icy - ay) * dy) / L2;
  const midX = vref === 'corner' ? (ax + bx) / 2 : (T.x + Bo.x) / 2, midY = vref === 'corner' ? (ay + by) / 2 : (T.y + Bo.y) / 2;
  const v = (-(icx - midX) * dy + (icy - midY) * dx) / L2, open = Math.hypot(Bo.x - T.x, Bo.y - T.y) / L;
  return { u, v, open };
}
function recomputeFeature(f, lm, vref = 'corner') {
  if (!lm) return null;
  const R = eyeUV(lm, LM.rOuter, LM.rInner, LM.rTop, LM.rBot, LM.rIris, vref), Lf = eyeUV(lm, LM.lInner, LM.lOuter, LM.lTop, LM.lBot, LM.lIris, vref);
  const ok = e => e && [e.u, e.v, e.open].every(finite) && e.u > -.25 && e.u < 1.25 && Math.abs(e.v) < .5;
  const use = [R, Lf].filter(ok); if (!use.length) return null;
  const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
  return { ...f, u: mean(use.map(e => e.u)), v: mean(use.map(e => e.v)), ...(ok(Lf) ? { uLeft: Lf.u, vLeft: Lf.v } : {}), ...(ok(R) ? { uRight: R.u, vRight: R.v } : {}), eyes: { left: { ...f.eyes.left, ...(ok(Lf) ? { u: Lf.u, v: Lf.v } : {}) }, right: { ...f.eyes.right, ...(ok(R) ? { u: R.u, v: R.v } : {}) } }, featureSource: 'landmarks-' + vref };
}

/* ---------- 세션 로드 ---------- */
function loadSession(obj, opt = {}) {
  const full = obj && obj.payload ? obj : { payload: obj, meta: obj?.meta || {}, code: obj?.code || null, annotations: [] };
  const p = full.payload, meta = full.meta || {}, flags = [], warnings = [];
  if (!p || !finite(p.t0)) throw Error('payload.t0 missing');
  const schema = p.schema || 'nl-research-1', core = coreVersionNumber(meta);
  const frames = decodeFrames(p.frames, p.t0);
  const cfRaw = p.telemetry?.calibrationFrames;
  const calibrationFrames = cfRaw && finite(cfRaw.t0) ? decodeFrames(cfRaw, p.t0) : [];
  if (frames.length && Math.abs((p.frames.t0 || p.t0) - p.t0) > 1) flags.push('frames-t0-differs-from-payload-t0');
  if (!cfRaw) flags.push('no-calibration-frames');
  const c = p.calibration || null, W = c?.screen?.w ?? meta.screen?.vw ?? null, H = c?.screen?.h ?? meta.screen?.vh ?? null;
  /* 랜드마크 기반 특징 재계산: core < 2.3 은 기록된 v 가 눈꺼풀 기준이라 현재 엔진에 맞게 눈꼬리 기준으로 다시 잰다 */
  const lmap = landmarkMap(p);
  const needCorner = core !== null && core < 2.3;
  let featureSource = 'recorded';
  const feat = f => { if (!needCorner) return f; const g = recomputeFeature(f, lmap ? lmap.get(f.tc) : null, 'corner'); return g; };
  if (needCorner) { if (lmap) { featureSource = 'landmarks-corner (recorded v was lid-based)'; flags.push('vertical-feature-recomputed-from-landmarks'); } else { featureSource = 'recorded-lid-based (incompatible with core 2.3 vertical axis)'; flags.push('legacy-lid-v-no-landmarks'); } }
  /* 표적: v3 targetsV2 우선, 없으면 [t,x,y,kind] 에서 역할·구간을 추정(backfill 표시) */
  let targets = [], rounds = [];
  if (c) {
    if (Array.isArray(c.targetsV2) && c.targetsV2.length) {
      targets = c.targetsV2.map(t => ({ id: t.id, round: t.round ?? 1, kind: t.kind, role: t.role, x: t.x, y: t.y, onset: t.onset, offset: t.offset, sampleStart: t.sampleStart ?? null, sampleEnd: t.sampleEnd ?? null, samples: t.samples, kept: t.kept, inferredBackfill: false, uncertaintyMs: 0 }));
      rounds = (c.rounds || []).map(r => ({ ...r }));
    } else if (Array.isArray(c.targets)) {
      flags.push('targets-v1-inferred-windows');
      const raw = c.targets.map((x, i) => ({ i, t: x[0], x: x[1], y: x[2], kind: x[3] }));
      /* round 추정: fix9 블록이 다시 시작되면 새 round */
      let round = 0, prevKind = null, valCount = {};
      for (const r of raw) {
        if (r.kind === 'fix9' && prevKind !== 'fix9') { round++; valCount[round] = 0; rounds.push({ round, start: r.t, end: null, inferred: true }); }
        r.round = Math.max(1, round); prevKind = r.kind;
        if (rounds.length) rounds[rounds.length - 1].end = r.t + 3000;
      }
      targets = raw.map((r, i) => {
        const next = raw[i + 1], nextT = next ? next.t : r.t + 3000;
        let role, kind = r.kind, from, to, unc = 300;
        if (r.kind === 'click') { role = 'weak'; from = 500; to = 2500; }   // 삭제된 클릭 보정 실험(core 2.1~2.2): weak 라벨, 학습·평가 제외
        else if (r.kind === 'fix9') { role = 'train'; from = 650; to = 2900; }
        else if (r.kind === 'zone') { role = 'internal'; from = 500; to = 2500; }
        else { valCount[r.round] = (valCount[r.round] || 0) + 1; if (valCount[r.round] <= 4) { role = 'internal'; } else { role = 'holdout-then-refit'; kind = 'fine'; } from = 500; to = 2500; }
        return { id: 'C' + String(i + 1).padStart(2, '0'), round: r.round, kind, role, x: r.x, y: r.y, onset: r.t, offset: Math.min(nextT, r.t + to), sampleStart: r.t + from, sampleEnd: Math.min(nextT, r.t + to), samples: null, kept: null, inferredBackfill: true, backfillMethod: r.kind === 'fix9' ? 'cal9:+650..+2900|next' : r.kind === 'click' ? 'click-calibration:weak' : 'calCollect:+500..+2500|next', uncertaintyMs: unc };
      });
    }
  }
  /* 추적 보정 메타: v3 는 fx/fy/lagMs 기록. 그 전은 path 문자열에서 주파수를 읽고, 그마저 없으면 버전별 legacy 표를 쓴다(unknown 표시) */
  let pursuit = null;
  if (c?.pursuit) {
    const pu = c.pursuit, legacy = core !== null && core >= 2.3 ? LEGACY_PURSUIT.v23 : LEGACY_PURSUIT.pre23;
    const fromPath = s => { const m = /sin\(2pi\*([0-9.]+)\*t\)\)/.exec(String(s || '')), n = /sin\(2pi\*([0-9.]+)\*t\+pi\/2\)/.exec(String(s || '')); return { fx: m ? parseFloat(m[1]) : null, fy: n ? parseFloat(n[1]) : null }; };
    const parsed = fromPath(pu.path);
    const fx = finite(pu.fx) ? pu.fx : parsed.fx ?? legacy.fx, fy = finite(pu.fy) ? pu.fy : parsed.fy ?? legacy.fy;
    const src = finite(pu.fx) ? 'recorded' : parsed.fx !== null ? 'parsed-from-path' : (core === null ? 'unknown-core-assumed-legacy' : 'legacy-table');
    pursuit = { t0: pu.t0, sec: finite(pu.sec) ? pu.sec : legacy.sec, W: pu.W, H: pu.H, fx, fy, ax: finite(pu.ax) ? pu.ax : legacy.ax, ay: finite(pu.ay) ? pu.ay : legacy.ay, phaseY: finite(pu.phaseY) ? pu.phaseY : Math.PI / 2,
      lagMs: finite(pu.lagMs) ? pu.lagMs : legacy.lagMs, sampleFrom: finite(pu.sampleFrom) ? pu.sampleFrom : 1000, sampleTo: finite(pu.sampleTo) ? pu.sampleTo : (finite(pu.sec) ? pu.sec : legacy.sec) * 1000, weight: finite(pu.weight) ? pu.weight : 0.5,
      sources: { frequency: src, lag: finite(pu.lagMs) ? 'recorded' : 'legacy-assumed-120ms', amplitude: finite(pu.ax) ? 'recorded' : 'legacy-constant' }, round: pu.round ?? null };
    if (src !== 'recorded') flags.push('pursuit-frequency-' + src);
    if (!finite(pu.lagMs)) flags.push('pursuit-lag-assumed');
  }
  /* 기준 심박: payload.reference(BLE) + annotations(kind=reference) 중 마지막 유효 연결. 이력은 보존 */
  const refNotes = (full.annotations || []).filter(n => n.kind === 'reference' && n.body?.reference?.samples).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const reference = refNotes.length ? { ...refNotes.at(-1).body.reference, source: refNotes.at(-1).body.reference.source || 'annotation-csv', annotationId: refNotes.at(-1).id, history: refNotes.map(n => ({ id: n.id, at: n.created_at, status: n.body.comparison?.status || null })) } : p.reference ? { ...p.reference, source: p.reference.source || 'ble-heart-rate', annotationId: null, history: [] } : null;
  const labels = p.gazeLabels || null;
  const snapshot = c?.snapshot || null;
  return { code: full.code || meta.attemptId || null, schema, core, meta, W, H, t0: p.t0, frames, calibrationFrames, lmap, feat, featureSource, targets, rounds, pursuit, reference, labels, calibration: c, snapshot, digests: c?.digests || null, hidden: p.hidden || [], telemetry: p.telemetry || null, flags, warnings, payload: p };
}

/* ---------- 파이프라인 재구성 ---------- */
function modelFromSnapshot(snap) {
  if (!snap || !snap.model) return null;
  const m = { ...snap.model }; if (m.eyes) { m.eyes = {}; for (const side of ['left', 'right']) if (snap.model.eyes[side]) m.eyes[side] = { ...snap.model.eyes[side] }; }
  return { model: m, affine: snap.affine || null, resid: snap.resid || null, drift: snap.drift || { dx: 0, dy: 0 }, coreVersion: snap.coreVersion || null, gazeModel: snap.gazeModel || null };
}
const within = (S, a, b) => S.calibrationFrames.filter(f => f.gazeOk && f.tc >= a && f.tc < b).map(S.feat).filter(Boolean);
/* condition.html calibrate() 순서(커서 과제 제외)로 보정 표본을 다시 만들어 ‘선택용(selection)’과 ‘최종 refit(final)’ 모델을 모두 돌려준다 */
function reconstructPipeline(N, S, opt = {}) {
  const { W, H } = S; if (!finite(W) || !finite(H) || !S.targets.length) return null;
  const LAM = opt.lambda ?? 0.5, round = opt.round ?? Math.max(...S.targets.map(t => t.round || 1));
  const T = S.targets.filter(t => (t.round || 1) === round);
  const pt = t => ({ x: t.x, y: t.y, fs: within(S, t.sampleStart ?? t.onset + 500, t.sampleEnd ?? t.offset ?? t.onset + 2500) });
  const fix9 = T.filter(t => t.kind === 'fix9').map(pt), val = T.filter(t => t.role === 'internal' && t.kind !== 'zone').map(pt), zc = T.filter(t => t.kind === 'zone').map(pt), fp = T.filter(t => t.kind === 'fine').map(pt);
  const flat = l => l.flatMap(p => p.fs.map(f => ({ x: p.x, y: p.y, f }))), robust = l => l.map(p => ({ ...p, fs: N.robustFeatures(p.fs) }));
  const s9 = flat(robust(fix9));
  let sp = [];
  if (S.pursuit && opt.pursuit !== false) {
    const pu = S.pursuit, t0 = pu.t0, pos = tt => ({ x: W * (0.5 + pu.ax * Math.sin(2 * Math.PI * pu.fx * tt / 1000)), y: H * (0.5 + pu.ay * Math.sin(2 * Math.PI * pu.fy * tt / 1000 + pu.phaseY)) });
    sp = within(S, t0 + pu.sampleFrom, t0 + pu.sampleTo).map(f => ({ ...pos(f.tc - t0 - pu.lagMs), f, w: pu.weight }));
  }
  const at = (m, A, R, p) => { const g = p.fs.map(f => N.applyResidual(R, N.applyAffine(A, N.predictGaze(m, f)))).filter(q => q && finite(q.x) && finite(q.y)); return g.length >= 4 ? { x: p.x, y: p.y, gx: N.median(g.map(q => q.x)), gy: N.median(g.map(q => q.y)) } : { x: p.x, y: p.y, gx: null, gy: null }; };
  const acc = pts => N.gazeAccuracy(pts, W, H), valR = robust(val), zcR = robust(zc), fpR = robust(fp);
  const cands = [{ key: '9점', m: N.fitGaze(s9, LAM) }, { key: '9점+추적', m: sp.length >= 60 ? N.fitGaze([...s9, ...sp], LAM) : null }].filter(c => c.m)
    .map(c => { N.validateGazeEyes(c.m, valR, W, H); return { ...c, acc: acc(valR.map(p => at(c.m, null, null, p))) }; }).filter(c => c.acc.errPct !== null).sort((a, b) => a.acc.errPct - b.acc.errPct);
  if (!cands.length) return { ok: false, reason: 'no-candidate-model', samples: { fix9: s9.length, pursuit: sp.length, val: valR.length, zone: zcR.length, fine: fpR.length } };
  let model = cands[0].m, affine = null;
  const pairs = [...valR, ...zcR].map(p => at(model, null, null, p)), A = N.fitAffine(pairs);
  const loo = () => { const ok = pairs.filter(p => finite(p.gx)); if (ok.length < 5) return null; return acc(ok.map((p, i) => { const Ai = N.fitAffine(ok.filter((_, j) => j !== i)); const g = N.applyAffine(Ai, { x: p.gx, y: p.gy }); return { x: p.x, y: p.y, gx: g.x, gy: g.y }; })); };
  const after = loo(); if (A && after && after.errPct !== null && after.errPct < cands[0].acc.errPct) affine = A;
  const stage2 = { model: cands[0].key, modelErr: cands[0].acc.errPct, affine: !!affine, pursuitSamples: sp.length };
  const coreVersion = S.meta?.versions?.core || null;
  if (!fpR.length) { const fit = { model, affine, resid: null, drift: { dx: 0, dy: 0 }, coreVersion }; return { ok: true, round, stage2, selection: { ...fit, key: cands[0].key }, final: fit, refitApplied: false, fineHeldOut: null }; }
  const train = [...s9, ...flat(valR), ...flat(zcR)], m2 = N.fitGaze(train, LAM); if (m2) N.validateGazeEyes(m2, valR, W, H);
  const cand = [{ key: '기존 보정', model, A: affine, R: null }];
  if (m2) cand.push({ key: '전체 표본 재학습', model: m2, A: N.fitAffine([...valR, ...zcR].map(p => at(m2, null, null, p))), R: null });
  cand.slice().forEach(c0 => { const pr = [...valR, ...zcR].map(p => at(c0.model, c0.A, null, p)); const R = N.fitResidual(pr, W, H); if (R) cand.push({ ...c0, key: c0.key + ' + 잔차 보정', R }); });
  cand.forEach(c => { c.acc = acc(fpR.map(p => at(c.model, c.A, c.R, p))); });
  const ok = cand.filter(c => c.acc.errPct !== null).sort((a, b) => a.acc.errPct - b.acc.errPct);
  if (!ok.length) return { ok: false, reason: 'no-fine-evaluable-candidate' };
  const b0 = N.pickCalibration(ok);
  const selection = { model: b0.model, affine: b0.A, resid: b0.R, drift: { dx: 0, dy: 0 }, coreVersion, key: b0.key, fineErrPct: b0.acc.errPct };
  let final = { model: b0.model, affine: b0.A, resid: b0.R, drift: { dx: 0, dy: 0 }, coreVersion }, refitApplied = false;
  const pts = [...valR, ...zcR, ...fpR];
  const mF = b0.key.startsWith('전체') ? (N.fitGaze([...train, ...flat(fpR)], LAM) || b0.model) : b0.model;
  if (mF !== b0.model) N.validateGazeEyes(mF, valR, W, H);
  const AF = N.fitAffine(pts.map(p => at(mF, null, null, p))) || b0.A, RF = b0.R ? N.fitResidual(pts.map(p => at(mF, AF, null, p)), W, H) : null;
  const eB = acc(pts.map(p => at(b0.model, b0.A, b0.R, p))), eF = acc(pts.map(p => at(mF, AF, RF, p)));
  if (eF.errPct !== null && eB.errPct !== null && eF.errPct <= eB.errPct) { final = { model: mF, affine: AF, resid: RF, drift: { dx: 0, dy: 0 }, coreVersion }; refitApplied = true; }
  return { ok: true, round, stage2, selection, final, refitApplied, fineHeldOut: { n: fpR.length, errPct: b0.acc.errPct, hx: b0.acc.hx, hy: b0.acc.hy, note: 'selection-model error on untouched fine points; final model saw them' }, samples: { fix9: s9.length, pursuit: sp.length, val: valR.length, zone: zcR.length, fine: fpR.length } };
}
/* digest 는 브라우저(condition.html)가 기록한 것과 같은 입력(model·affine·resid·drift·coreVersion·gazeModel)으로 만든다 */
const pipelineDigest = fit => Labels.pipelineDigest({ model: fit.model, affine: fit.affine, resid: fit.resid, drift: fit.drift || { dx: 0, dy: 0 }, coreVersion: fit.coreVersion || null, gazeModel: fit.gazeModel || null });
/* drift 이력(telemetry.drift, applied=true)으로 시각 t 의 영점 — 보정 직후는 0 */
function driftAt(S, tc) {
  let d = { dx: 0, dy: 0 };
  for (const e of (S.telemetry?.drift || [])) { if (!e.applied || !finite(e.t) || e.t > tc) continue; if (finite(e.dx) && finite(e.dy)) d = { dx: e.dx, dy: e.dy }; }
  return d;
}
/* 프레임별 baseline 예측: px,py(원출력) · ax,ay(affine) · bx,by(잔차까지 = 기존 엔진 분석 좌표, drift 제외) · mode */
function predictFrames(N, fit, S, frames, opt = {}) {
  const out = [];
  for (const f0 of frames) {
    if (!f0.gazeOk) continue;
    const f = S.feat(f0); if (!f) continue;
    const pred = N.predictGaze(fit.model, f); if (!pred || !finite(pred.x) || !finite(pred.y)) continue;
    const gA = N.applyAffine(fit.affine, pred), gB = N.applyResidual(fit.resid, gA), d = opt.drift === false ? { dx: 0, dy: 0 } : driftAt(S, f0.tc);
    out.push({ tc: f0.tc, px: pred.x, py: pred.y, ax: gA.x, ay: gA.y, bx: gB.x, by: gB.y, mode: pred.mode || 'both', driftDx: d.dx, driftDy: d.dy, u: f.u, v: f.v, uLeft: f.eyes?.left?.u, vLeft: f.eyes?.left?.v, uRight: f.eyes?.right?.u, vRight: f.eyes?.right?.v, qLeft: f.eyes?.left?.q, qRight: f.eyes?.right?.q, open: f.open, yaw: f.yaw, pitch: f.pitch, cx: f.cx, cy: f.cy, fw: f.fw, blink: f.blink, eyeQ: f.eyeQ, lag: f.lag, featureSource: f.featureSource || 'recorded' });
  }
  return out;
}

module.exports = { ROOT, coreVersionNumber, LEGACY_PURSUIT, decodeFrames, landmarkMap, eyeUV, recomputeFeature, loadSession, modelFromSnapshot, reconstructPipeline, pipelineDigest, driftAt, predictFrames };
