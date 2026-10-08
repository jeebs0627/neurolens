/* 합성 세션 fixture 생성기 (SYNTHETIC · 테스트 전용 · 운영 업로드 경로 없음)
 * 실제 브라우저 패커(newbiz-research.js pack)와 보정 파이프라인 재구성(session_adapter.reconstructPipeline)을 그대로 써서
 * v3(nl-research-3, core 2.3, 라벨 수집 포함)와 legacy(v2 형식, core 2.2) 세션 JSON 을 만든다.
 * 합성 피험자: 눈 특징 → 화면 좌표 사이에 모든 피험자가 공유하는 비선형 왜곡(잔차 모델이 배울 구조) + 피험자별 무작위 affine + 잡음.
 * meta.synthetic=true · code 'SYN-…' 로 격리한다. 성능 보고서에서 실측과 섞지 않는다.
 * 실행: node tools/colab/fixtures.cjs <out dir> [--sessions=6] [--seed=1] [--legacy=2] */
'use strict';
const fs = require('fs'), path = require('path');
const A = require('./session_adapter.cjs');
const N = require(path.join(A.ROOT, 'newbiz-core.js')), R = require(path.join(A.ROOT, 'newbiz-research.js')), L = require(path.join(A.ROOT, 'condition-labels.js'));
const finite = Number.isFinite;

function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }
const gauss = rnd => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

/* 합성 피험자: 표적(x,y) → 눈 특징 (표적 정보는 특징을 만들 때만 쓰고 기록에는 들어가지 않는다) */
function subject(rnd, W, H) {
  const gainU = 0.5 + 0.15 * rnd(), gainV = 0.25 + 0.1 * rnd(), biasU = (rnd() - .5) * .04, biasV = (rnd() - .5) * .03, noise = 0.004 + 0.004 * rnd();
  const head = { yaw: (rnd() - .5) * .04, pitch: (rnd() - .5) * .04, cx: 0.5 + (rnd() - .5) * .05, cy: 0.5 + (rnd() - .5) * .05, fw: 0.28 + 0.04 * rnd() };
  return {
    noise, head,
    feature(x, y, t) {
      const nx = x / W - 0.5, ny = y / H - 0.5;
      /* 공유 왜곡: 가장자리 압축(tanh) + 세로-가로 교차항 — 릿지 2차 모델이 완전히 잡지 못하는 구조 */
      const u = 0.5 + biasU + gainU * (Math.tanh(1.6 * nx) / Math.tanh(0.8)) * 0.5 + 0.03 * ny * nx + noise * gauss(rnd);
      const v = biasV + gainV * ny + 0.06 * nx * nx * Math.sign(ny + 0.1) + 0.015 * Math.sin(t / 900) + noise * 0.7 * gauss(rnd);
      const open = 0.3 - 0.06 * ny + 0.004 * gauss(rnd);
      /* 얼굴 중심 잡음은 MediaPipe 실측 수준(프레임 폭의 ~0.05%)으로 둔다 — 라벨 창 선택의 머리 움직임 기준(2.5%/100ms)을 합성 잡음이 넘지 않게 */
      const f = { u, v, yaw: head.yaw + 0.002 * gauss(rnd), pitch: head.pitch + 0.002 * gauss(rnd), cx: head.cx + 0.0005 * gauss(rnd), cy: head.cy + 0.0005 * gauss(rnd), fw: head.fw, fh: head.fw * 1.3, open,
        eyes: { left: { u: u + 0.01, v: v - 0.005, open, q: 0.75 + 0.1 * rnd() }, right: { u: u - 0.01, v: v + 0.005, open, q: 0.75 + 0.1 * rnd() } } };
      return f;
    },
  };
}
/* 합성 랜드마크(478점 중 눈·홍채 22점만): eyeUV 를 역산해 기록된 u·v·open 과 일치하는 기하를 만든다. 이미지가 아니라 좌표다 */
const LM_IDX = [33, 133, 159, 145, 468, 469, 470, 471, 472, 362, 263, 386, 374, 473, 474, 475, 476, 477];
function landmarkRow(tRel, f) {
  const row = [Math.round(tRel)], q = v => Math.round(v * 1e4);
  const eye = (ax, ay, L, e) => { const icx = ax + e.u * L, icy = ay + e.v * L, pts = { outer: [ax, ay], inner: [ax + L, ay], top: [ax + L / 2, ay - e.open * L / 2], bot: [ax + L / 2, ay + e.open * L / 2], iris: [[icx, icy], [icx + .002, icy], [icx - .002, icy], [icx, icy + .002], [icx, icy - .002]] }; return pts; };
  const R = eye(0.30, 0.42, 0.10, f.eyes.right), Lf = eye(0.60, 0.42, 0.10, f.eyes.left);
  const put = (pt) => row.push(q(pt[0]), q(pt[1]));
  put(R.outer); put(R.inner); put(R.top); put(R.bot); R.iris.forEach(put); put(Lf.outer); put(Lf.inner); put(Lf.top); put(Lf.bot); Lf.iris.forEach(put);
  return row;
}
function frameOf(t, f, extra = {}) {
  const eyeQ = Math.max(f.eyes.left.q, f.eyes.right.q);
  return { t, ok: true, ppgOk: true, skinOk: true, faceOk: true, eyeOk: true, gazeOk: true, skinQ: .6, eyeQ, qLeft: f.eyes.left.q, qRight: f.eyes.right.q, uLeft: f.eyes.left.u, vLeft: f.eyes.left.v, uRight: f.eyes.right.u, vRight: f.eyes.right.v,
    source: 'observed', roiAge: 0, exposureGain: 1, cx: f.cx, cy: f.cy, fw: f.fw, open: f.open, blink: 0.04, lookV: null, frown: .05, smile: .1, u: f.u, v: f.v, yaw: f.yaw, pitch: f.pitch, lag: 22, r: 150, g: 110, b: 95, lum: 115, rr: [[150, 110, 95], [148, 109, 94], [151, 111, 96]], rq: [.6, .6, .6], clockSource: 'capture', intervalMs: 33, ...extra };
}

/* 보정 프로토콜(condition.html 과 같은 순서·시간): fix9 → pursuit(18s) → val4 → zone5 → fine8 */
function synthesizeCalibration(subj, W, H, rnd, t, cf, calibLog, round = 1) {
  const DT = 1000 / 30, targets = calibLog.targets;
  let id = targets.length;
  const show = (x, y, kind, dwellMs, from) => {
    const tg = { t, x, y, kind, id: 'C' + String(++id).padStart(2, '0'), round }; targets.push(tg);
    for (let k = 0; k < dwellMs / DT; k++) { const tt = t + k * DT, f = subj.feature(x, y, tt); cf.push(frameOf(tt, f)); calibLog._lm.push([tt, f]); }
    tg.sampleStart = t + from; tg.sampleEnd = t + dwellMs; tg.offset = t + dwellMs; tg.samples = Math.round(dwellMs / DT); tg.kept = tg.samples; t += dwellMs + 150;
  };
  for (const fy of [0.14, 0.5, 0.88]) for (const fx of [0.08, 0.5, 0.92]) show(fx * W, fy * H, 'fix9', 2900, 650);
  const sec = 18, FX = 3 / sec, FY = 2 / sec, t0 = t + 900, LAG = 120, pos = tt => ({ x: W * (0.5 + 0.38 * Math.sin(2 * Math.PI * FX * tt / 1000)), y: H * (0.5 + 0.34 * Math.sin(2 * Math.PI * FY * tt / 1000 + Math.PI / 2)) });
  for (let tt = t0; tt < t0 + sec * 1000; tt += DT) { const p = pos(tt - t0 - LAG), f = subj.feature(p.x, p.y, tt); cf.push(frameOf(tt, f)); calibLog._lm.push([tt, f]); }
  calibLog.pursuit = { t0, sec, W, H, fx: FX, fy: FY, ax: 0.38, ay: 0.34, phaseY: Math.PI / 2, lagMs: LAG, sampleFrom: 1000, sampleTo: sec * 1000, weight: 0.5, round, path: `x=W*(0.5+0.38*sin(2pi*${FX.toFixed(4)}*t)), y=H*(0.5+0.34*sin(2pi*${FY.toFixed(4)}*t+pi/2)), t in s from t0` };
  t = t0 + sec * 1000 + 300;
  for (const [fx, fy] of [[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]]) show(fx * W, fy * H, 'val', 1300, 500);
  for (const [fx, fy] of [[0.5, 0.5], [0.2, 0.22], [0.8, 0.22], [0.8, 0.8], [0.2, 0.8]]) show(fx * W, fy * H, 'zone', 1300, 500);
  for (const [fx, fy] of [[0.12, 0.5], [0.88, 0.5], [0.5, 0.12], [0.5, 0.88], [0.32, 0.38], [0.68, 0.62], [0.36, 0.8], [0.64, 0.22]]) show(fx * W, fy * H, 'fine', 1300, 500);
  return t;
}

function makeSession(opt) {
  const { seed, legacy = false, W = 1536, H = 864, labels = true, withReference = true, hr = 68 } = opt, rnd = rng(seed), subj = subject(rnd, W, H);
  const startedAt = 1000 + rnd() * 50, attemptId = `${seed.toString(16).padStart(8, '0')}-0000-4000-8000-${String(seed).padStart(12, '0')}`;
  const calibLog = { screen: { w: W, h: H }, targets: [], rounds: [{ round: 1, start: startedAt + 500, end: null, outcome: 'accepted' }], _lm: [] }, cf = [];
  let t = synthesizeCalibration(subj, W, H, rnd, startedAt + 500, cf, calibLog);
  calibLog.rounds[0].end = t;
  /* 개인 모델: 실제 엔진의 파이프라인 재구성으로 맞춘다 (브라우저 calibrate() 와 같은 순서) */
  const tmp = { W, H, t0: 0, calibrationFrames: cf.map(f => ({ ...f, tc: f.t, eyes: { left: { u: f.uLeft, v: f.vLeft, q: f.qLeft }, right: { u: f.uRight, v: f.vRight, q: f.qRight } } })), feat: f => f, targets: calibLog.targets.map(tg => ({ ...tg, role: tg.kind === 'fix9' ? 'train' : tg.kind === 'fine' ? 'holdout-then-refit' : 'internal', onset: tg.t })), pursuit: { ...calibLog.pursuit }, telemetry: null };
  const rp = A.reconstructPipeline(N, tmp);
  if (!rp || !rp.ok) throw Error('fixture calibration failed: ' + (rp && rp.reason));
  const fit = rp.final, S = { model: fit.model, affine: fit.affine, resid: fit.resid, drift: { dx: 0, dy: 0 }, coreVersion: N.VERSION };
  calibLog.model = { key: rp.stage2.model, quad: !!fit.model.quad, coefficients: fit.model }; calibLog.affine = fit.affine; calibLog.resid = fit.resid;
  calibLog.snapshot = L.pipelineSnapshot(S); calibLog.digests = { selection: A.pipelineDigest(rp.selection), selectionKey: rp.selection.key, refitApplied: rp.refitApplied, final: L.pipelineDigest(S) };
  calibLog.fine = { chosen: rp.selection.key, before: null, after: rp.fineHeldOut.errPct, points: rp.fineHeldOut.n };
  calibLog.evaluation = { kind: 'internal-model-selection', synthetic: true };
  const predict = f => { const p = N.predictGaze(fit.model, f), g = N.applyResidual(fit.resid, N.applyAffine(fit.affine, p)); return { p, g }; };
  /* 기록 단계: 원형 추적(10초) + 라벨 수집(v3) — frames 는 기록 시작부터 */
  const frames = [], DT = 1000 / 30, phases = {}, steps = { calibration: { status: 'done' } }, telemetry = { clock: { monotonic: 'performance.now', timeOrigin: 0, start: startedAt, segments: [] }, steps: { calibration: { start: startedAt + 500, end: t } }, stimuli: [], inputs: [], drift: [], layout: [], calibrationFrames: cf };
  t += 1500;
  const circle = { t0: t, cx: W / 2, cy: H / 2, r: 0.17 * W, freq: 0.4, dur: 10000, samples: [] };
  phases.pursuit = { start: t, end: t + circle.dur }; telemetry.steps.pursuit = { start: t, end: t + circle.dur }; steps.pursuit = { status: 'done' };
  for (let tt = t; tt < t + circle.dur; tt += DT) {
    const a = 2 * Math.PI * circle.freq * (tt - t - 120) / 1000 - Math.PI / 2, x = circle.cx + circle.r * Math.cos(a), y = circle.cy + circle.r * Math.sin(a), f = subj.feature(x, y, tt);
    const fr = frameOf(tt, f, { r: 150 + 0.6 * Math.sin(2 * Math.PI * hr / 60 * tt / 1000), g: 110 + 0.9 * Math.sin(2 * Math.PI * hr / 60 * tt / 1000) }); frames.push(fr); calibLog._lm.push([tt, f]);
    const { p, g } = predict(f); circle.samples.push({ t: tt, x: g.x, y: g.y, rx: g.x, ry: g.y, px: p.x, py: p.y, bl: false, q: fr.eyeQ, mode: p.mode || 'both', lag: 22 });
  }
  t += circle.dur + 500;
  const rec = { attemptId, startedAt, endedAt: null, outcome: 'complete', errorCode: null, telemetry, reference: null, researchConsent: { version: R.CONSENT_VERSION, research: true, phq: false, at: new Date(2026, 9, 7, 10, 0, 0).toISOString() },
    sessionKind: legacy || !labels ? 'condition' : 'gaze-label', coreVersion: legacy ? 'In_mind core 2.2' : N.VERSION, gazeModel: null,
    frames, phases, trials: [], pursuit: { version: 2, cx: W / 2, amp: 0.32 * W, levels: [], reversal: null, samples: [], circle }, saccade: null, saccadeCal: null, pvt: null, sart: null, stressScore: null, steps, screenW: W, calibration: { grade: 'good', errPct: rp.fineHeldOut.errPct, samples: 300 },
    checkin: {}, demo: false, mode: 'quick', resized: false, stimMode: 'schematic', stimForm: null, measuredAt: new Date(2026, 9, 7, 10, 5, 0).toISOString(), capture: { version: 'condition-camera-6', backend: 'main-thread' }, lab: null, hidden: [], landmarks: { idx: [468, 473], rows: [] }, calibLog };
  /* v3 라벨 수집: 표적을 바라보고 확인. 라벨 좌표는 표적 중심. 창은 확인 500~200ms 전 */
  if (labels && !legacy) {
    const plan = L.planTargets({ seed: seed * 7 + 1 }), log = L.createEventLog(() => t), G = { schema: L.SCHEMA, version: L.VERSION, config: { ...L.DEFAULT_CONFIG, counts: plan.counts }, plan, viewport: { coordinateSpace: 'css-client', vw: W, vh: H, dpr: 1 }, clock: { monotonic: 'performance.now' }, pipeline: { atStart: L.pipelineDigest(S) }, events: log.events, labels: [], holdout: null, stage: { W, H } };
    telemetry.steps.gazeLabel = { start: t, end: null }; steps.gazeLabel = { status: 'done' };
    let holdoutStarted = false;
    for (const tg of plan.targets) {
      if (tg.role === 'holdout' && !holdoutStarted) { holdoutStarted = true; G.holdout = { beginAt: t, digestBefore: L.pipelineDigest(S), targets: plan.targets.filter(x => x.role === 'holdout').map(x => x.id) }; log.push('holdout-begin', { t, digest: G.holdout.digestBefore }); }
      const x = tg.nx * W, y = tg.ny * H, shownAt = t, dwell = 1300 + 600 * rnd(), ring = [];
      for (let tt = shownAt; tt < shownAt + dwell; tt += DT) { const f = subj.feature(x, y, tt), fr = frameOf(tt, f); frames.push(fr); calibLog._lm.push([tt, f]); const { p, g } = predict(f); ring.push({ t: tt, fr, f, pred: { x: p.x, y: p.y, mode: p.mode || 'both' }, base: { x: g.x, y: g.y } }); }
      const confirmAt = shownAt + dwell;
      log.push('shown', { t: shownAt, targetId: tg.id, attempt: 1, role: tg.role, x, y, nx: tg.nx, ny: tg.ny });
      const win = L.selectWindow({ frames: ring.map(r => ({ t: r.t, gazeOk: true, faceOk: true, blink: r.fr.blink, cx: r.fr.cx, cy: r.fr.cy, fw: r.fr.fw, eyeQ: r.fr.eyeQ })), shownAt, confirmAt, config: G.config });
      const chosen = new Set(win.frameTimes);
      const label = { targetId: tg.id, role: tg.role, attempt: 1, shownAt, confirmAt, x, y, nx: tg.nx, ny: tg.ny, confirm: { type: 'pointerdown', pointerType: 'mouse', isTrusted: true, dispatchMs: 3 }, window: win.window, dwellMs: win.dwellMs, frameTimes: win.frameTimes, dwellConfidence: win.dwellConfidence, status: win.keep ? 'valid' : 'rejected', rejectReasons: win.reasons, excluded: win.excluded, stats: win.stats, labelSource: 'explicit_target_confirmed', coordinateSpace: 'css-client',
        frames: ring.filter(r => chosen.has(r.t)).map(r => ({ t: r.t, px: r.pred.x, py: r.pred.y, ax: null, ay: null, bx: r.base.x, by: r.base.y, mode: r.pred.mode, drift: { dx: 0, dy: 0 }, lag: 22, u: r.f.u, v: r.f.v, uLeft: r.f.eyes.left.u, vLeft: r.f.eyes.left.v, uRight: r.f.eyes.right.u, vRight: r.f.eyes.right.v, qLeft: r.f.eyes.left.q, qRight: r.f.eyes.right.q, open: r.f.open, yaw: r.f.yaw, pitch: r.f.pitch, cx: r.f.cx, cy: r.f.cy, fw: r.f.fw, blink: r.fr.blink, eyeQ: r.fr.eyeQ })) };
      log.push('confirm', { t: confirmAt, targetId: tg.id, attempt: 1, window: { keep: win.keep, reasons: win.reasons, frameTimes: win.frameTimes, dwellConfidence: win.dwellConfidence, window: win.window } });
      G.labels.push(label); t = confirmAt + 250;
    }
    G.holdout.endAt = t; G.holdout.digestAfter = L.pipelineDigest(S); G.holdout.pipelineUnchanged = true;
    const rows = G.labels.filter(l => l.role === 'holdout' && l.status === 'valid').map(l => ({ x: l.x, y: l.y, gx: N.median(l.frames.map(f => f.bx)), gy: N.median(l.frames.map(f => f.by)) }));
    G.holdout.proxyError = { targets: rows.length, ...N.gazeAccuracy(rows, W, H), note: 'synthetic proxy' };
    G.effective = log.effective(); G.summary = R.labelSummary(G); telemetry.steps.gazeLabel.end = t; rec.gazeLabels = G;
  }
  if (withReference) rec.reference = { source: 'ble-heart-rate', verified: false, sync: { offsetMs: 0, driftPpm: 0, uncertaintyMs: null, method: 'notification-receipt' }, samples: Array.from({ length: Math.floor((t - frames[0].t) / 1000) }, (_, i) => ({ t: frames[0].t + i * 1000 + 300, bpm: Math.round(hr + 2 * Math.sin(i / 7)), quality: 1, contact: true })), events: [] };
  rec.endedAt = t;
  /* 심박 근거(evidence)는 실제 엔진으로 */
  let res = null;
  try { const windows = N.hrWindows(N.buildBvp(frames)); res = { version: rec.coreVersion, evidence: { version: N.Fusion.VERSION, windows, phases: { pursuit: N.phaseHr(windows, phases.pursuit.start, phases.pursuit.end) } }, hr: { baseline: null }, battery: null }; } catch (_) { res = null; }
  rec.landmarks = { idx: LM_IDX, rows: calibLog._lm.map(([tt, f]) => landmarkRow(tt, f)) }; delete calibLog._lm;
  const pk = R.pack(rec, res, rec.researchConsent, { ua: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36 SYNTHETIC', screen: { w: W, h: H, vw: W, vh: H }, camera: { w: 640, h: 480 }, dpr: 1, tz: -540, app: 'condition', viewport: { coordinateSpace: 'css-client', vw: W, vh: H, dpr: 1 }, subjectKey: ('syn' + seed).padEnd(32, '0').slice(0, 32).replace(/[^0-9a-f]/g, 'a'), subjectKeySource: 'synthetic' });
  pk.meta.synthetic = true; pk.meta.versions.core = rec.coreVersion;
  if (legacy) {
    /* v2 형식으로 되돌린다: targetsV2/rounds/resid/snapshot/digests/gazeLabels/sampleColumns 확장 제거, path 만 남긴 pursuit(fx/fy 없음), core 2.2 */
    pk.meta.schema = 'nl-research-2'; pk.payload.schema = 'nl-research-2'; delete pk.meta.sessionKind; delete pk.meta.viewport; delete pk.meta.gazeModel; delete pk.meta.subjectKey; delete pk.meta.subjectKeySource;
    const c = pk.payload.calibration; delete c.targetsV2; delete c.rounds; delete c.resid; delete c.snapshot; delete c.digests; delete c.fine;
    c.targets = c.targets.map(x => [x[0], x[1], x[2], x[3] === 'fine' ? 'val' : x[3]]);
    c.pursuit = { t0: c.pursuit.t0, sec: 12.5, W, H, path: 'x=W*(0.5+0.38*sin(2pi*0.12*t)), y=H*(0.5+0.34*sin(2pi*0.08*t+pi/2)), t in s from t0' };
    pk.payload.sampleColumns = pk.payload.sampleColumns.slice(0, 9); pk.payload.pursuit.circle.s = pk.payload.pursuit.circle.s.map(r => r.slice(0, 9));
    delete pk.payload.gazeLabels; pk.payload.telemetry.clock = { timeOrigin: 0, start: startedAt }; delete pk.payload.telemetry.layout;
    if (pk.summary.dataset) { delete pk.summary.dataset.gazeLabels; delete pk.summary.dataset.sessionKind; } delete pk.summary.gazeLabels;
  }
  const code = 'SYN-' + seed.toString(36).toUpperCase().padStart(6, '0');
  return { code, created_at: new Date(2026, 9, 7, 10, 5, 0).toISOString(), consent: rec.researchConsent, meta: pk.meta, summary: pk.summary, payload: pk.payload, annotations: [], synthetic: true, id: attemptId };
}

if (require.main === module) {
  const args = process.argv.slice(2), out = args.find(a => !a.startsWith('--')), n = +((args.find(a => a.startsWith('--sessions=')) || '--sessions=6').slice(11)), seed0 = +((args.find(a => a.startsWith('--seed=')) || '--seed=1').slice(7)), legacy = +((args.find(a => a.startsWith('--legacy=')) || '--legacy=2').slice(9));
  if (!out) { console.error('usage: node tools/colab/fixtures.cjs <out dir> [--sessions=6] [--seed=1] [--legacy=2]'); process.exit(2); }
  fs.mkdirSync(path.join(out, 'sessions'), { recursive: true });
  const made = [];
  for (let i = 0; i < n; i++) { const s = makeSession({ seed: seed0 + i, legacy: i >= n - legacy, labels: true, withReference: i % 2 === 0 }); fs.writeFileSync(path.join(out, 'sessions', s.code + '.json'), JSON.stringify(s)); made.push({ code: s.code, schema: s.payload.schema, core: s.meta.versions.core, labels: !!s.payload.gazeLabels, reference: !!s.payload.reference }); }
  fs.writeFileSync(path.join(out, 'FIXTURE_SYNTHETIC.json'), JSON.stringify({ synthetic: true, note: 'synthetic sessions for code/shape/exception tests only; never report as human performance; never upload', sessions: made, generatedAt: new Date().toISOString() }, null, 2));
  console.log(JSON.stringify({ out, sessions: made }));
}
module.exports = { makeSession, subject, rng };
