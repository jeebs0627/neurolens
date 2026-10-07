const assert = require('node:assert/strict');
const N = require('./newbiz-core.js');

/* 1) 고정 72 bpm 합성 영상 → POS 로 72 bpm 근처 복원 */
{
  const frames = N.synthFrames(0, 30000, () => 72, { seed: 3 });
  const sig = N.buildBvp(frames);
  const pk = N.spectralPeak(sig.bvp, sig.fs);
  assert.ok(Math.abs(pk.bpm - 72) < 2, `bpm ${pk.bpm}`);
  assert.equal(N.quality(pk.snrDb), 'good');
  const live = N.liveHr(frames);
  assert.ok(Math.abs(live.bpm - 72) <= 2, `live ${live.bpm}`);
}

/* 2) 잡음만 있으면 품질이 good 이 아니어야 한다 */
{
  const frames = N.synthFrames(0, 20000, () => 72, { seed: 5 }).map(f => ({ ...f, r: 175 + (f.r - 175) * 0, g: 118 + Math.sin(f.t) * 2, b: 98 + Math.cos(f.t * 1.7) * 2 }));
  const sig = N.buildBvp(frames);
  const pk = N.spectralPeak(sig.bvp, sig.fs);
  assert.notEqual(N.quality(pk.snrDb), 'good', `noise snr ${pk.snrDb}`);
}

/* 3) 분당 6회 호흡에 맞춰 심박이 ±6 bpm 출렁이면 호흡 동조 진폭이 잡힌다 */
{
  const frames = N.synthFrames(0, 60000, t => 70 + 6 * Math.sin(2 * Math.PI * 0.1 * t / 1000), { seed: 11, noise: 0.1 });
  const sig = N.buildBvp(frames);
  const list = N.ibis(N.beats(sig, 0, 60000, 70));
  assert.ok(list.length > 50, `ibis ${list.length}`);
  const c = N.breathingCoupling(list);
  assert.ok(c.ampBpm > 5, `amp ${c.ampBpm}`);
  assert.ok(c.ratio > 0.3, `ratio ${c.ratio}`);
  /* 출렁임이 없으면 진폭이 훨씬 작다 */
  const flat = N.synthFrames(0, 60000, () => 70, { seed: 11, noise: 0.1 });
  const c2 = N.breathingCoupling(N.ibis(N.beats(N.buildBvp(flat), 0, 60000, 70)));
  assert.ok(c2.ampBpm < c.ampBpm / 2, `flat amp ${c2.ampBpm}`);
}

/* 4) 시선 회귀: 특징이 화면 좌표와 선형 관계면 복원 */
{
  const samples = [];
  for (let i = 0; i < 9; i++) for (let k = 0; k < 15; k++) {
    const x = 100 + (i % 3) * 400, y = 100 + Math.floor(i / 3) * 300;
    const u = 0.3 + x / 4000 + (Math.random() - 0.5) * 0.002, v = -0.05 + y / 9000;
    samples.push({ x, y, f: { u, v, yaw: 0.01 * Math.random(), pitch: 0.01 * Math.random(), cx: 0.5, cy: 0.5 + 0.001 * Math.random() } });
  }
  const m = N.fitGaze(samples);
  const p = N.predictGaze(m, { u: 0.3 + 500 / 4000, v: -0.05 + 400 / 9000, yaw: 0.005, pitch: 0.005, cx: 0.5, cy: 0.5 });
  assert.ok(Math.abs(p.x - 500) < 60 && Math.abs(p.y - 400) < 60, JSON.stringify(p));
}

/* 5) 자유 보기 지표 */
{
  const W = 1000, mk = (emoSide, segs) => {
    const samples = []; let t = 0;
    segs.forEach(([ms, x]) => { for (const end = t + ms; t < end; t += 33) samples.push({ t, x }); });
    return { kind: 'neg', emoSide, onset: 0, end: t, samples };
  };
  const stuck = N.trialStats(mk('L', [[3500, 200]]), W);
  assert.equal(stuck.emoShare, 1); assert.equal(stuck.first, 'emo');
  const avoid = N.trialStats(mk('L', [[300, 200], [3200, 800]]), W);
  assert.ok(avoid.emoShare < 0.15); assert.ok(avoid.firstVisitMs >= 250 && avoid.firstVisitMs <= 400, String(avoid.firstVisitMs));
  const lost = N.trialStats(mk('L', [[3500, 500]]), W);   // 가운데만 봄 → 무효
  assert.equal(lost.valid, false);
}

/* 6) 전체 분석: 스트레스 때 심박 상승 + 부정 자극 응시 편향 → 복합 과부하형 */
{
  const ph = { baseline: { start: 0, end: 60000 }, neu: { start: 60000, end: 90000 }, neg: { start: 90000, end: 120000 }, pos: { start: 120000, end: 150000 }, stress: { start: 150000, end: 195000 }, recovery: { start: 195000, end: 255000 } };
  const hrAt = t => t < 90000 ? 68 : t < 150000 ? 72 : t < 195000 ? 80 : 80 - Math.min(10, (t - 195000) / 3000) + 4 * Math.sin(2 * Math.PI * 0.1 * t / 1000);
  const frames = N.synthFrames(0, 255000, hrAt, { seed: 21, noise: 0.15 });
  const W = 1200, trials = [];
  ['neu', 'neg', 'pos'].forEach((kind, bi) => {
    for (let i = 0; i < 7; i++) {
      const onset = ph[kind].start + i * 4200, end = onset + 3500, emoSide = i % 2 ? 'L' : 'R';
      const emoX = emoSide === 'L' ? 300 : 900, otherX = emoSide === 'L' ? 900 : 300;
      const share = kind === 'neg' ? 0.75 : 0.5, samples = [];
      for (let t = onset; t < end; t += 33) samples.push({ t, x: (t - onset) < 3500 * share ? emoX : otherX });
      trials.push({ kind, emoSide, onset, end, samples });
    }
  });
  const r = N.analyze({ frames, phases: ph, trials, screenW: W, calibration: { grade: 'good', errPct: 7 }, checkin: { tension: 2, valence: 6 } });
  assert.ok(Math.abs(r.hr.baseline.bpm - 68) < 3, `base ${r.hr.baseline.bpm}`);
  assert.ok(r.stressDelta >= 8 && r.stressDelta <= 15, `stress ${r.stressDelta}`);
  assert.ok(r.recovery > 50, `recovery ${r.recovery}`);
  assert.ok(Math.abs(r.gaze.attentionBias - 0.25) < 0.05, `bias ${r.gaze.attentionBias}`);
  assert.equal(r.profile.code, 'overload');
  assert.equal(r.mismatch.kind, 'body-hidden');
  assert.ok(r.blink.all > 5 && r.blink.all < 30, `blink ${r.blink.all}`);
  assert.ok(r.timeline.length > 200);

  /* 보정 실패면 부분 측정 */
  const r2 = N.analyze({ frames, phases: ph, trials, screenW: W, calibration: { grade: 'poor' }, checkin: null });
  assert.equal(r2.profile.code, 'partial');
}

/* 영점 조정: 축별 기울기·이동 복원, 과보정 제한 */
{
  const pts = [[200, 150], [1240, 150], [1240, 750], [200, 750], [720, 450]].map(([x, y]) => ({ x, y, gx: 0.85 * x + 60, gy: 1.1 * y - 30 }));
  const A = N.fitAffine(pts);
  pts.forEach(p => { const g = N.applyAffine(A, { x: p.gx, y: p.gy }); assert.ok(Math.abs(g.x - p.x) < 1 && Math.abs(g.y - p.y) < 1); });
  const wild = N.fitAffine(pts.map(p => ({ ...p, gx: 0.3 * p.x })));
  assert.equal(wild.x.a, 2.2);                                    // 상관이 높으면(r≥0.8) 넓은 상한 2.2
  const noisy = N.fitAffine(pts.map((p, i) => ({ ...p, gx: 0.3 * p.x + [0, 300, -300, 280, -260][i] })));
  assert.ok(noisy.x.r < 0.8 && noisy.x.a >= 0.75 && noisy.x.a <= 1.35); // 상관이 낮으면 기본 범위 0.75~1.35
  assert.equal(N.fitAffine(pts.slice(0, 2)), null);
}

/* One Euro: 머물 때 떨림을 크게 줄이고, 큰 이동은 0.3초 안에 따라간다 */
{
  const f = N.oneEuro({ minCutoff: 0.6, beta: 0.004 });
  let seed = 3; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  const still = [], out = [];
  for (let i = 0; i < 90; i++) { const x = 500 + 40 * rnd(); still.push(x); out.push(f(x, i * 33)); }
  const sd = a => { const m = a.reduce((s, v) => s + v, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length); };
  assert.ok(sd(out.slice(30)) < sd(still.slice(30)) * 0.35, `jitter ${sd(out.slice(30))} vs ${sd(still.slice(30))}`);
  let y = 0;
  for (let i = 90; i < 100; i++) y = f(1100 + 40 * rnd(), i * 33);
  assert.ok(y > 1000, `follow ${y}`);
}

/* 다중 영역 rPPG: 한 영역의 리듬성 잡음이 전체 평균 채널을 망가뜨려도, 깨끗한 두 볼 영역의 일치로 심박을 지킨다 */
{
  const frames = N.synthFrames(0, 30000, () => 75, { seed: 9, noise: 0.15 });
  let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  /* 1.6Hz(96bpm) 리듬성 움직임 잡음(예: 눈썹·앞머리 움직임) — 색 성분이 맞지 않아 POS 로도 지워지지 않는다. 이마만 오염 */
  const art = f => { const n = 2.2 * Math.sin(2 * Math.PI * 1.6 * f.t / 1000) + 0.3 * rnd(); return [1.6 * n, -1.2 * n, 0.4 * n]; };
  const bad = frames.map(f => { const a = art(f); return { ...f, r: f.r + a[0] * 0.6, g: f.g + a[1] * 0.6, b: f.b + a[2] * 0.6, rr: [f.rr[0].map((x, i) => x + a[i]), f.rr[1], f.rr[2]] }; });
  const only = N.hrWindows(N.buildBvp(bad.map(f => ({ ...f, rr: undefined }))));
  const fused = N.hrWindows(N.buildBvp(bad));
  const good = w => w.filter(x => Math.abs(x.bpm - 75) <= 3).length / w.length;
  assert.ok(good(fused) >= 0.9 && good(only) < 0.5, `fused ${good(fused)} vs single ${good(only)}`);
}

/* 시선 커서 보조: 표적 반경보다 크게(화면 폭 7.5%) 어긋나고 떨리는 시선도 2초 안에 표적 반경에 안정적으로 들어온다 */
{
  const W = 1440, H = 900, T = { x: 1000, y: 300 }, R = W * 0.065;
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  const off = { x: -0.075 * W, y: 0.03 * H };
  const plain = N.oneEuro({ minCutoff: 0.6, beta: 0.004 }), plainY = N.oneEuro({ minCutoff: 0.6, beta: 0.004 });
  const gc = N.gazeCursor({ W, H });
  let inA = 0, inP = 0, path = [];
  for (let i = 0; i < 90; i++) {
    const t = i * 33, raw = { x: T.x + off.x + 45 * rnd(), y: T.y + off.y + 35 * rnd() };
    const a = gc.step(raw, t, T), p = { x: plain(raw.x, t), y: plainY(raw.y, t) };
    if (i >= 30) { if (Math.hypot(a.x - T.x, a.y - T.y) <= R) inA++; if (Math.hypot(p.x - T.x, p.y - T.y) <= R) inP++; path.push(a); }
  }
  assert.ok(inA >= 55 && inA > inP, `assisted ${inA}/60 vs plain ${inP}/60`);
  assert.ok(gc.bias.x > 10 && gc.bias.y < -5, `bias ${gc.bias.x.toFixed(1)},${gc.bias.y.toFixed(1)}`);
  const jit = Math.max(...path.map(q => q.x)) - Math.min(...path.map(q => q.x));
  assert.ok(jit < 40, `jitter ${jit}`);
  /* 속도 제한: 한 프레임에 화면 절반을 뛰는 시선도 커서는 0.9W/s 이내로 이동 */
  const g2 = N.gazeCursor({ W, H }); g2.step({ x: 100, y: 450 }, 0); const j = g2.step({ x: 1300, y: 450 }, 33);
  assert.ok(j.x - 100 <= 0.9 * W * 0.033 + 1, `clamped ${j.x}`);
}

/* 호흡수: 얼굴 상하 미세 움직임으로 분당 6회·15회 호흡을 구분, 잡음만 있으면 '뚜렷한 리듬 없음' */
{
  const r6 = N.respiration(N.synthFrames(0, 60000, () => 70, { seed: 3, breathAt: t => 0.004 * Math.sin(2 * Math.PI * 0.1 * t / 1000) }), 0, 60000);
  const r15 = N.respiration(N.synthFrames(0, 60000, () => 70, { seed: 3, breathAt: t => 0.004 * Math.sin(2 * Math.PI * 0.25 * t / 1000) }), 0, 60000);
  const r0 = N.respiration(N.synthFrames(0, 60000, () => 70, { seed: 3 }), 0, 60000);
  assert.ok(r6.clear && Math.abs(r6.bpm - 6) < 0.8, JSON.stringify(r6));
  assert.ok(r15.clear && Math.abs(r15.bpm - 15) < 1, JSON.stringify(r15));
  assert.equal(r0.clear, false);
}

/* 조명 급변 감지 */
{
  const fr = N.synthFrames(0, 30000, () => 70, { seed: 4 }).map(f => ({ ...f, lum: f.t > 15000 ? 150 : 120 }));
  const j = N.lumJumps(fr);
  assert.equal(j.length, 1); assert.ok(Math.abs(j[0] - 15000) < 2100);
}

/* 보정 중 머리가 시선을 따라 조금 움직이면(cy가 표적 y와 상관) 모델이 cy를 배워, 이후 자세가 2%만 내려가도 시선이 화면 밖으로 튀었다(2026-10-04 실측 회귀) */
{
  const W = 1920, H = 1080, S = [];
  let k = 0;
  for (const fy of [0.14, 0.5, 0.88]) for (const fx of [0.08, 0.5, 0.92]) for (let i = 0; i < 20; i++, k++) {
    const n = Math.sin(k * 12.9898) * 0.5;
    S.push({ x: fx * W, y: fy * H, f: { u: 0.5 + (fx - 0.5) * 0.15 + n * 0.004, v: -0.015 + (fy - 0.5) * 0.02 + n * 0.003, yaw: (fx - 0.5) * 0.004, pitch: 0.05 + (fy - 0.5) * 0.004, cx: 0.51 + (fx - 0.5) * 0.003, cy: 0.56 + (fy - 0.5) * 0.004, open: 0.4 } });
  }
  const m = N.fitGaze(S);
  const center = N.predictGaze(m, { u: 0.5, v: -0.015, yaw: 0, pitch: 0.05, cx: 0.51, cy: 0.58, open: 0.4 });
  assert.ok(center.y > -0.25 * H && center.y < 1.25 * H, 'gaze y stays on screen after a 2% posture shift: ' + Math.round(center.y));
}

console.log('newbiz-core tests passed');

/* 시선 화면 밖 가속 억제 (2026-10-05): ① 제곱항 모델이 보정 범위 밖에서 1차로 이어지는지 ② 화면 밖 압축이 화면 안은 그대로, 밖은 단조·유계인지 */
{
  const samples = [];
  for (let i = 0; i < 200; i++) {
    const u = 0.35 + 0.3 * (i % 20) / 19, v = 0.4 + 0.2 * Math.floor(i / 20) / 9;
    const f = { u, v, yaw: 0, pitch: 0, cx: 0.5, cy: 0.5, open: 0.3 };
    samples.push({ f, x: 1440 * (u - 0.35) / 0.3 + 300 * (u - 0.5) ** 2 * 10, y: 900 * (v - 0.4) / 0.2 });
  }
  const m = N.fitGaze(samples);
  assert.ok(m && m.quad && m.zr, 'quad model with range');
  const at = u => N.predictGaze(m, { u, v: 0.5, yaw: 0, pitch: 0, cx: 0.5, cy: 0.5, open: 0.3 }).x;
  /* 범위 안 예측은 연장 전과 같다(같은 입력에서 zr 를 빼도 동일) */
  const inside = N.predictGaze({ ...m, zr: null }, { u: 0.5, v: 0.5, yaw: 0, pitch: 0, cx: 0.5, cy: 0.5, open: 0.3 }).x;
  assert.ok(Math.abs(at(0.5) - inside) < 1e-6, 'inside range unchanged');
  /* 범위 밖: 같은 간격 이동에 같은 변화(2차 차분 ≈ 0), 연장 전에는 가속 */
  const d2 = (fn, a, h) => fn(a + 2 * h) - 2 * fn(a + h) + fn(a);
  const old = u => N.predictGaze({ ...m, zr: null }, { u, v: 0.5, yaw: 0, pitch: 0, cx: 0.5, cy: 0.5, open: 0.3 }).x;
  assert.ok(Math.abs(d2(at, 0.7, 0.05)) < 1e-6, `linear beyond range ${d2(at, 0.7, 0.05)}`);
  assert.ok(Math.abs(d2(old, 0.7, 0.05)) > 1, 'old model accelerates');
  /* 화면 밖 압축 */
  const W = 1440, H = 900, sb = x => N.softBound({ x, y: 450 }, W, H).x;
  assert.equal(sb(700), 700); assert.equal(sb(0), 0); assert.equal(sb(W), W);
  assert.ok(sb(W + 100) < W + 100 && sb(W + 100) > W + 90, 'gentle near edge');
  assert.ok(sb(W + 5000) < W + 0.35 * W + 1e-9 && sb(W + 5000) > sb(W + 1000), 'bounded and monotonic');
  assert.ok(sb(-5000) > -0.35 * W - 1e-9, 'bounded left');
  console.log('PASS gaze: quadratic tangent extension beyond calibration range, soft off-screen bound');
}

/* 심박 수집 안정화 (2026-10-05): ① 몇 초마다 생기는 짧은 프레임 누락(≤0.6초)은 보간해 창을 살린다
 * ② 머리 움직임 구간(얼굴 위치 흔들림)은 창 안에서 비워 흔들림 주파수를 심박으로 잡지 않는다 */
{
  const gaps = N.synthFrames(0, 60000, () => 72, { noise: 1.2, seed: 2 }).filter(x => !((x.t % 7000) < 450));
  const g = N.measureEvidence(gaps, 0, 60000);
  assert.ok(g.validSeconds >= 40 && Math.abs(g.bpm - 72) < 2, `gaps: ${g.validSeconds}s ${g.bpm}`);
  const mov = N.synthFrames(0, 60000, () => 70, { noise: 1.2, seed: 2 }).map(x => { const on = (x.t % 9000) < 1500, m = on ? 3 * Math.sin(x.t / 90) : 0;
    return { ...x, cx: x.cx + (on ? 0.03 * Math.sin(x.t / 90) : 0), g: x.g + m, rr: x.rr.map((c, i) => [c[0] + m * .6, c[1] + m * (1 + .3 * i), c[2] + m * .4]) }; });
  assert.ok(N.motionBursts(mov).length >= 6, 'motion bursts detected');
  const m = N.measureEvidence(mov, 0, 60000);
  assert.ok(Math.abs(m.bpm - 70) < 2, `motion: ${m.bpm}`);
  assert.equal(N.motionBursts(N.synthFrames(0, 30000, () => 70, { noise: 0.5, seed: 3 })).length, 0, 'still face has no bursts');
  console.log('PASS pulse: short frame gaps bridged, head-motion bursts blanked');
}

/* 시선 커서 응시 고정 (2026-10-05): 같은 잡음에서 떨림은 절반 이하, 다른 곳으로 옮기면 0.15초 안에 따라간다 */
{
  let sd = 5; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647, ga = () => { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return u - 3; };
  const W = 1440, H = 900, run = opt => {
    const gc = N.gazeCursor({ W, H, ...opt }), jit = [], reach = [];
    [[300, 250], [1100, 300], [1150, 700], [400, 650]].forEach(([x, y], k) => {
      const out = []; let hit = null;
      for (let t = k * 1500; t < k * 1500 + 1500; t += 33) { const o = gc.step({ x: x + 0.03 * W * ga(), y: y + 0.03 * W * ga() }, t, null); out.push({ t, o }); if (hit === null && Math.hypot(o.x - x, o.y - y) < 0.04 * W) hit = t - k * 1500; }
      const st = out.filter(p => p.t >= k * 1500 + 400), mx = N.mean(st.map(p => p.o.x)), my = N.mean(st.map(p => p.o.y));
      jit.push(Math.sqrt(N.mean(st.map(p => (p.o.x - mx) ** 2 + (p.o.y - my) ** 2)))); if (k) reach.push(hit ?? 1500);
    });
    return { jit: N.mean(jit), reach: N.mean(reach) };
  };
  const a = run({ lock: false }), b = run({});
  assert.ok(b.jit < a.jit * 0.5, `jitter ${b.jit.toFixed(1)} vs ${a.jit.toFixed(1)}`);
  assert.ok(b.reach <= 150, `reach ${b.reach}`);
  console.log('PASS gaze cursor fixation lock: jitter halved, responsive to new fixations');
}

/* 그림자 비교 (2026-10-05): 추가 특징(lookV)이 세로 정보를 담으면 처음 보는 점의 세로 오차가 줄고, 잡음이면 줄지 않는다 */
{
  let sd = 11; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647, ga = () => { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return u - 3; };
  const W = 1440, H = 900;
  const feat = (x, y, informative) => ({ u: 0.35 + 0.3 * x / W + 0.004 * ga(), v: 0.45 + 0.04 * y / H + 0.03 * ga(), yaw: 0.002 * ga(), pitch: 0.002 * ga(), cx: 0.5, cy: 0.5 + 0.002 * ga(), open: 0.3 + 0.01 * ga(),
    lookV: informative ? 0.6 - 1.2 * y / H + 0.05 * ga() : 0.2 * ga() });
  const run = informative => {
    const grid = (fx, fy) => ({ x: fx * W, y: fy * H });
    const train = []; for (let i = 0; i < 160; i++) { const p = grid(0.1 + 0.8 * rnd(), 0.1 + 0.8 * rnd()); train.push({ ...p, f: feat(p.x, p.y, informative) }); }
    const pts = arr => arr.map(([fx, fy]) => { const p = grid(fx, fy); return { ...p, fs: Array.from({ length: 12 }, () => feat(p.x, p.y, informative)) }; });
    const fitPts = pts([[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7], [0.5, 0.5], [0.2, 0.22], [0.8, 0.22], [0.8, 0.8], [0.2, 0.8]]);
    const evalPts = pts([[0.12, 0.5], [0.88, 0.5], [0.5, 0.12], [0.5, 0.88], [0.32, 0.38], [0.68, 0.62], [0.36, 0.8], [0.64, 0.22]]);
    return N.compareGazeFeatures({ train, fitPts, evalPts, W, H, extra: ['lookV'] });
  };
  const good = run(true), noise = run(false);
  assert.ok(good.withExtra && good.withExtra.hy < good.base.hy * 0.7 && good.withExtra.ry > good.base.ry, `informative lookV: ${JSON.stringify(good)}`);
  assert.ok(noise.withExtra && noise.withExtra.hy > noise.base.hy * 0.8, `noise lookV: ${JSON.stringify(noise)}`);
  console.log('PASS shadow comparison: informative lookV lowers vertical error, noise does not', `(세로 오차 ${good.base.hy}→${good.withExtra.hy}%H · 잡음 ${noise.base.hy}→${noise.withExtra.hy}%H)`);
}

/* 보정 후보 선택 (2026-10-05): 세로 점수 후보는 기존 최선보다 0.5%p·10% 이상 좋을 때만 — 실측 4세션의 그림자 비교 값으로 확인 */
{
  const C = (key, e, extra) => ({ key, acc: { errPct: e }, ...(extra ? { extra: ['lookV'] } : {}) });
  const pick = (base, look) => N.pickCalibration([C('기존', base), C('세로 점수', look, true)]).key;
  assert.equal(pick(6.3, 4.4), '세로 점수', 'FD03: 6.3 → 4.4 adopts lookV');
  assert.equal(pick(5.9, 7.1), '기존', '4479 keeps base');
  assert.equal(pick(4.1, 5.6), '기존', 'DBFE keeps base');
  assert.equal(pick(8.2, 9.3), '기존', '04E7 (other laptop) keeps base');
  assert.equal(pick(4.1, 3.8), '기존', 'marginal gain (0.3%p) is not enough');
  assert.equal(N.pickCalibration([C('a', 5), C('b', 4)]).key, 'b', 'plain candidates: smallest error');
  console.log('PASS calibration pick: lookV only with a clear held-out gain');
}

/* 세션 심박 흐름 보정 (2026-10-05): 약한 구간의 튀는 값·빈 구간은 흐름으로 잇고, 충분히 측정된 구간은 그대로 둔다 */
{
  const wins = []; for (let t = 0; t <= 120000; t += 1000) if (t < 40000 || t > 56000) wins.push({ t, bpm: 85 + Math.sin(t / 20000), usable: true, confidence: 0.5 });
  const tr = N.sessionTrend(wins), g = tr.phase(42000, 54000);
  assert.ok(g && Math.abs(g.bpm - 85) < 2, `gap trend ${g && g.bpm}`);
  const weak = N.repairPhase({ bpm: 55.2, n: 2, status: 'weak-signal', quality: 'poor' }, g);
  assert.ok(weak.status === 'inferred' && weak.rawBpm === 55.2 && Math.abs(weak.bpm - 85) < 2 && weak.confidence <= 0.3, 'weak outlier repaired');
  const none = N.repairPhase({ bpm: null, n: 0, status: 'unavailable', quality: 'none' }, g);
  assert.ok(none.status === 'inferred' && none.rawBpm === null, 'missing phase inferred');
  const solid = { bpm: 70, n: 15, status: 'measured', quality: 'good' };
  assert.equal(N.repairPhase(solid, g), solid, 'well-measured phase kept even if it differs');
  const agree = { bpm: 88, n: 2, status: 'weak-signal', quality: 'poor' };
  assert.equal(N.repairPhase(agree, g), agree, 'weak phase that agrees with trend kept');
  assert.equal(tr.phase(0, 0), null);
  console.log('PASS session trend: weak outliers and missing phases inferred, solid phases kept');
}
{
  /* 2026-10-06 실측 NLR-64E98B3E…: 22fps 안팎(30fps 중 1~2프레임씩 자주 빠짐)인데 창이 'frame-gaps'로 통째로 버려졌다.
   * 150ms 이하 공백은 맥파(≤3Hz) 모양을 보존하므로 보간 표시하지 않는다 — 30% 프레임 누락에서도 심박을 받아들여야 한다 */
  let s = 9; const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  const frames = N.synthFrames(0, 40000, () => 80, { fps: 30, seed: 3, noise: 1 }).filter(() => rnd() >= 0.3);
  const e = N.measureEvidence(frames, 0, 40000);
  assert.ok(e.coverage > 0.8 && Math.abs(e.bpm - 80) < 3, `dropped frames: coverage ${e.coverage} bpm ${e.bpm}`);
  console.log('PASS frame drops: short gaps (≤150ms) kept as measured pulse');
}
