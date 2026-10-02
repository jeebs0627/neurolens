const assert = require('node:assert/strict');
const N = require('./newbiz-core.js');
const B = require('./newbiz-battery.js');
const R = require('./newbiz-report.js');

/* 1) 점수 환산: 기준점(100/70/40/0)과 방향 */
{
  const low = { dir: 'low', best: 0, ok: 3, concern: 7, worst: 16 };
  assert.equal(B.scoreOf(0, low), 100); assert.equal(B.scoreOf(3, low), 70); assert.equal(B.scoreOf(7, low), 40); assert.equal(B.scoreOf(20, low), 0);
  assert.equal(B.statusOf(B.scoreOf(3, low)), 'ok'); assert.equal(B.statusOf(B.scoreOf(5, low)), 'watch'); assert.equal(B.statusOf(B.scoreOf(8, low)), 'concern');
  const high = { dir: 'high', best: 1, ok: 0.8, concern: 0.6, worst: 0.2 };
  assert.equal(B.scoreOf(1.1, high), 100); assert.equal(B.scoreOf(0.8, high), 70); assert.equal(B.scoreOf(0.6, high), 40);
  assert.ok(B.scoreOf(0.7, high) > 40 && B.scoreOf(0.7, high) < 70);
  /* 모든 지표에 근거 문헌과 단조 기준점이 있어야 한다 */
  B.INDICATORS.forEach(i => {
    assert.ok(i.refs.length && i.refs.every(k => B.REFS[k]), `refs ${i.key}`);
    const b = i.band, s = b.dir === 'low' ? 1 : -1;
    assert.ok(b.best * s < b.ok * s && b.ok * s < b.concern * s && b.concern * s < b.worst * s, `band ${i.key}`);
  });
  Object.values(B.MODULES).forEach(m => assert.ok(m.refs.every(k => B.REFS[k])));
  Object.values(B.CARE_PLAN).forEach(t => t.items.forEach(it => assert.ok(it.refs.every(k => B.REFS[k]))));
}

/* 2) PVT-B: 355ms 경과 기준, 100ms 미만은 조기 반응, 무반응은 경과 */
{
  const trials = [250, 260, 270, 400, 500, 280, 290, 80, null, 300].map((rt, i) => ({ onset: i * 4000, rt }));
  const s = B.pvtStats({ trials, falseStarts: 2, durationMs: 60000 });
  assert.equal(s.lapses, 3);            // 400, 500, null
  assert.equal(s.falseStarts, 3);       // 자극 전 2 + 80ms 1
  assert.equal(s.lapsesPer3, 9);
  assert.equal(s.medianRt, 285);
  assert.equal(B.pvtStats({ trials: trials.slice(0, 3), durationMs: 60000 }), null);
}

/* 3) PERCLOS: 졸린 눈꺼풀이면 높고 깜빡임이 길다 */
{
  const alert = N.synthFrames(0, 90000, () => 70, { seed: 3, eyeAt: () => ({ blinkMs: 150, drowsy: 0 }) });
  const drowsy = N.synthFrames(0, 90000, () => 70, { seed: 3, eyeAt: () => ({ blinkMs: 280, drowsy: 0.15 }) });
  const a = B.eyeStats(alert, 0, 90000), d = B.eyeStats(drowsy, 0, 90000);
  assert.ok(a.perclos < 8, `alert perclos ${a.perclos}`);
  assert.ok(d.perclos > 15, `drowsy perclos ${d.perclos}`);
  assert.ok(d.blinkMs > a.blinkMs + 60, `blink ${a.blinkMs} → ${d.blinkMs}`);
  assert.ok(d.longPerMin > a.longPerMin);
  assert.equal(B.eyeStats(alert, 0, 10000), null);    // 20초 미만은 판정 안 함
}

/* 4) 사카드: 방향·잠복기·교정·예측성 반응 */
{
  const W = 1000, mk = (type, side, moves) => {
    const samples = [];
    for (let t = -500; t <= 1000; t += 33) {
      let x = 500;
      moves.forEach(([at, to]) => { if (t >= at) x = to; });
      samples.push({ t, x });
    }
    return { type, side, onset: 0, end: 1000, samples };
  };
  const ok = B.saccadeTrial(mk('anti', 'R', [[250, 150]]), W);
  assert.equal(ok.valid, true); assert.equal(ok.error, false); assert.ok(ok.lat >= 220 && ok.lat <= 290, `lat ${ok.lat}`);   // 30fps 샘플링 → ±33ms
  const err = B.saccadeTrial(mk('anti', 'R', [[180, 850], [420, 150]]), W);
  assert.equal(err.error, true); assert.equal(err.corrected, true);
  const pro = B.saccadeTrial(mk('pro', 'L', [[200, 150]]), W);
  assert.equal(pro.error, false);
  assert.equal(B.saccadeTrial(mk('anti', 'R', [[30, 150]]), W).reason, 'anticip');
  assert.equal(B.saccadeTrial(mk('anti', 'R', []), W).reason, 'noresp');
  /* 보정 실패면 판정 제외 */
  const trials = Array.from({ length: 10 }, (_, i) => mk('anti', i % 2 ? 'L' : 'R', [[260, i % 2 ? 850 : 150]]));
  assert.equal(B.saccadeStats(trials, W, true).anti.errorRate, 0);
  assert.equal(B.saccadeStats(trials, W, false).ok, false);
}

/* 4b) 개인 보정: 진폭이 작게(15%) 추정되고 중심이 치우친 시선도 보정하면 판정된다 */
{
  const W = 1000, A = 0.35 * 0.15 * W, cal = { xL: 560 - A, xC: 560, xR: 560 + A };
  const tr = { type: 'anti', side: 'R', onset: 0, end: 1200, samples: [] };
  for (let t = -500; t <= 1200; t += 33) tr.samples.push({ t, x: t >= 260 ? 560 - A : 560, bl: t === -170 });
  assert.equal(B.saccadeTrial(tr, W, null).valid, false);
  const r = B.saccadeTrial(tr, W, cal);
  assert.equal(r.valid, true); assert.equal(r.error, false);
}

/* 5) 원활 추적: 이득·지연 복원 */
{
  const W = 1200, t0 = 0, amp = 400, cx = 600, freq = 0.25, dur = 20000, samples = [];
  for (let t = 0; t <= dur; t += 33) samples.push({ t, x: cx + 0.75 * amp * Math.sin(2 * Math.PI * freq * (t - 120) / 1000) + (Math.random() - 0.5) * 20 });
  const p = B.pursuitStats({ t0, cx, amp, freq, dur, samples, W });
  assert.equal(p.ok, true);
  assert.ok(Math.abs(p.gain - 0.75) < 0.05, `gain ${p.gain}`);
  assert.ok(Math.abs(p.lagMs - 120) <= 20, `lag ${p.lagMs}`);
  assert.ok(p.errPct < 2, `err ${p.errPct}`);
}

/* 6) SART: 억제 실패·누락·변동성 */
{
  const seq = B.sartSequence(90, () => 0.5);
  assert.equal(seq.filter(d => d === 3).length, 10);
  const trials = seq.map((digit, i) => ({ digit, onset: i * 1150, rt: digit === 3 ? (i % 2 ? 300 : null) : (i % 40 === 0 ? null : 350 + (i % 5) * 20) }));
  const s = B.sartStats({ trials });
  assert.equal(s.nogo, 10);
  assert.ok(s.commission > 0.3 && s.commission < 0.7, `com ${s.commission}`);
  assert.ok(s.omission > 0 && s.omission < 0.05, `om ${s.omission}`);
  assert.ok(s.cv > 0 && s.cv < 0.1, `cv ${s.cv}`);
}

/* 7) 시뮬레이션 피험자 → 의도한 통합 해석 + 리포트 무결성 */
function checkReport(r, label) {
  const html = R.render(r, { history: [] });
  assert.ok(!/undefined|NaN|\[object/.test(html), `${label}: 잘못된 값 노출`);
  const cited = new Set([...html.matchAll(/<sup class="cite">\[([^\]]+)\]<\/sup>/g)].flatMap(m => m[1].split(',').flatMap(x => {
    const [a, b] = x.split('–').map(Number); return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a];
  })));
  const listed = [...html.matchAll(/<li id="ref-(\d+)">/g)].map(m => +m[1]);
  assert.ok(listed.length >= 10, `${label}: 참고문헌 ${listed.length}`);
  assert.deepEqual(listed, listed.map((_, i) => i + 1), `${label}: 참고문헌 번호 연속`);
  cited.forEach(n => assert.ok(n >= 1 && n <= listed.length, `${label}: 인용 [${n}] 누락`));
  assert.equal(cited.size, listed.length, `${label}: 인용되지 않은 문헌`);
  ['bioStart', 'again', 'printBtn', 'dl'].forEach(id => assert.ok(html.includes(`id="${id}"`)));
  return html;
}
const expect = {
  balanced: { code: 'balanced', paths: [] },
  fatigue: { code: 'alert', paths: ['fatigue'], mismatch: 'sleep-unaware' },
  control: { code: 'control', paths: ['nvi'] },
  overload: { code: ['autonomic', 'emotion'], paths: ['perseverative'], mismatch: 'tension-body-hidden' },   // 두 영역 모두 '관리 필요' → 1·2순위를 나눠 가짐
};
for (const [p, e] of Object.entries(expect)) {
  for (const seed of [20261002, 7, 99]) {
    const r = B.run(B.simulate(p, { seed, measuredAt: '2026-10-02T10:00:00.000Z' }));
    const I = r.battery.integrated;
    if (Array.isArray(e.code)) { assert.ok(e.code.includes(I.code) && e.code.includes(I.secondary), `${p}/${seed}: ${I.code}/${I.secondary}`); }
    else assert.equal(I.code, e.code, `${p}/${seed}: ${I.code}`);
    e.paths.forEach(k => assert.ok(I.pathways.some(x => x.key === k), `${p}/${seed}: 연결 ${k} 없음 (${I.pathways.map(x => x.key)})`));
    if (e.mismatch) assert.ok(I.mismatches.some(m => m.key === e.mismatch), `${p}/${seed}: 불일치 ${e.mismatch}`);
    B.DOMAIN_KEYS.forEach(k => assert.notEqual(r.battery.domains[k].status, 'na', `${p}: ${k} 미측정`));
    assert.ok(r.battery.care.length >= 1 && r.battery.care[0].items.length === 3);
    checkReport(r, `${p}/${seed}`);
  }
}

/* 8) 모듈 일부만 선택 · 빠른 측정 */
{
  const r = B.run(B.simulate('fatigue', { mode: 'quick', include: { oculo: false, sustain: false } }));
  assert.equal(r.battery.saccade, null); assert.equal(r.battery.sart, null);
  assert.equal(r.battery.domains.control.status, 'na');
  assert.equal(r.battery.steps.saccade.status, 'off');
  assert.equal(r.battery.integrated.code, 'alert');
  checkReport(r, 'partial');
  const only = B.run(B.simulate('balanced', { include: { core: false, oculo: false, sustain: false } }));
  assert.equal(only.battery.integrated.code, 'insufficient');
  checkReport(only, 'insufficient');
}

/* 9) 실측에서 단계를 건너뛴 경우: 구간·데이터가 빠져도 분석·리포트가 동작 */
{
  const rec = B.simulate('control');
  ['pvt', 'stress', 'recovery', 'neu', 'neg', 'pos'].forEach(k => delete rec.phases[k]);
  Object.assign(rec, { pvt: null, trials: [], stressScore: null, demo: false, sim: null, calibration: { grade: 'good', errPct: 8 } });
  rec.steps = { ...rec.steps, pvt: { status: 'skipped' }, freeview: { status: 'skipped' }, stress: { status: 'skipped' }, recovery: { status: 'skipped' }, saccade: { status: 'done' }, pursuit: { status: 'done' }, sart: { status: 'done' }, baseline: { status: 'done' } };
  const r = B.run(rec);
  assert.equal(r.battery.domains.alert.status, 'na');
  assert.equal(r.battery.domains.emotion.status, 'na');
  assert.equal(r.quality.gazeOk, false);           // 자유 보기 없이 시선 판정 통과하면 안 됨
  assert.equal(r.battery.integrated.code, 'insufficient');   // 측정 영역 1개 (주의 통제)
  const html = checkReport(r, 'skipped');
  assert.ok(html.includes('건너뜀'));
}

console.log('newbiz-battery tests passed');
