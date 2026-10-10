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
    const mono = (b, tag) => { const s = b.dir === 'low' ? 1 : -1; assert.ok(b.best * s < b.ok * s && b.ok * s < b.concern * s && b.concern * s < b.worst * s, `band ${i.key}${tag}`); };
    if (i.band.dir === 'mid') { mono(i.band.up, ' up'); mono(i.band.down, ' down'); assert.equal(i.band.up.best, i.band.down.best); } else mono(i.band, '');
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
  const r0 = B.saccadeTrial(tr, W, null);                       // 보정 없이: 약한 반응으로만 잡히고 잠복기는 쓰지 않는다
  assert.ok(!r0.valid || (r0.weak && r0.lat === null), JSON.stringify(r0));
  const r = B.saccadeTrial(tr, W, cal);
  assert.equal(r.valid, true); assert.equal(r.error, false); assert.equal(r.weak, false); assert.ok(r.lat > 200 && r.lat < 300);
  /* 블록 중심 보정: 보정 뒤 머리가 움직여 응시점이 화면 폭의 20%만큼 옮겨 가도, 같은 블록 시행들의 중심으로 판정한다 */
  const shift = 200, mkS = (side, i) => {
    const t2 = { type: 'anti', side, onset: 0, end: 1200, samples: [] };
    for (let t = -500; t <= 1200; t += 33) t2.samples.push({ t, x: 560 + shift + (t >= 260 ? (side === 'R' ? -A : A) : 0) + (i % 3 - 1) });
    return t2;
  };
  const block = Array.from({ length: 8 }, (_, i) => mkS(i % 2 ? 'L' : 'R', i));
  assert.equal(B.saccadeTrial(block[0], W, cal).reason, 'offcenter');           // 보정 중심만 쓰면 버려지던 시행
  const st = B.saccadeStats([...block.map(t => ({ ...t, type: 'pro', side: t.side === 'R' ? 'L' : 'R' })), ...block], W, true, cal);
  assert.equal(st.anti.valid, 8); assert.equal(st.anti.errorRate, 0);
  /* 단발 튐(한 프레임)은 반응으로 잡지 않는다 */
  const spike = { type: 'pro', side: 'R', onset: 0, end: 1200, samples: [] };
  for (let t = -500; t <= 1200; t += 33) spike.samples.push({ t, x: 560 + (t >= 297 && t < 330 ? 90 : 0) + (t >= 600 ? A : 0) });
  const rs = B.saccadeTrial(spike, W, cal);
  assert.ok(rs.valid && rs.lat > 560, `spike lat ${rs.lat}`);
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

/* 6-0) SART 순서: 원판 비율 유지 + 3 연속 금지·앞에 반응 숫자 2개 이상·전반/후반 균등 */
for (const n of [54, 108, 225]) for (const r of [() => 0, () => 0.5, () => 0.999, Math.random]) {
  const seq = B.sartSequence(n, r), idx = seq.map((d, i) => (d === 3 ? i : -1)).filter(i => i >= 0);
  assert.equal(seq.length, n);
  const k = B.sartCount(n), go = [1, 2, 4, 5, 6, 7, 8, 9];
  assert.equal(idx.length, k, 'nogo count'); assert.ok(k / n > 1 / 9 + 0.05 && k / n < 1 / 9 + 0.10, `nogo ratio ${k / n}`);
  go.forEach((d, j) => assert.equal(seq.filter(x => x === d).length, Math.floor((n - k) / 8) + (j < (n - k) % 8 ? 1 : 0), `digit ${d} count`));
  assert.ok(idx.every((i, k) => i >= 2 && (k === 0 || i - idx[k - 1] >= 3)), `spacing ${idx}`);
  assert.ok(Math.abs(idx.filter(i => i < n / 2).length - idx.filter(i => i >= n / 2).length) <= 1, `halves ${idx}`);
}
/* 실패 직전 가속: 실패 직전 반응이 평소보다 빠르면 양수 */
{
  const seq = B.sartSequence(108, () => 0.5);
  const trials = seq.map((digit, i) => ({ digit, onset: i * 1150, rt: digit === 3 ? 300 : (seq.slice(i + 1, i + 5).includes(3) ? 300 : 400) }));
  const s = B.sartStats({ trials });
  assert.equal(s.commits, s.nogo);
  assert.ok(s.preErrorSpeedup >= 40, `speedup ${s.preErrorSpeedup}`);   // 3 비율 18%: 반응 시행의 절반가량이 실패 직전 창에 들어가 전체 평균과의 차가 100ms 의 절반 수준
}
/* 6) SART: 억제 실패·누락·변동성 */
{
  const seq = B.sartSequence(90, () => 0.5);
  assert.equal(seq.filter(d => d === 3).length, B.sartCount(90));
  const trials = seq.map((digit, i) => ({ digit, onset: i * 1150, rt: digit === 3 ? (i % 2 ? 300 : null) : (i % 40 === 0 ? null : 350 + (i % 5) * 20) }));
  const s = B.sartStats({ trials });
  assert.equal(s.nogo, B.sartCount(90));
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
    // fatigue 연결은 각성 + (집중 조절 또는 정서) 표시가 조건 — 합성 피로 페르소나의 집중 조절은 경계(≈70)라 조건이 설 때만 요구한다(battery 1.8: 방향 전환 지연 반영으로 한 시드 69→71)
    const flagged = k => SEV[r.battery.domains[k].status] >= 1, SEV = B.SEV;
    e.paths.filter(k => k !== 'fatigue' || (flagged('alert') && (flagged('control') || flagged('emotion')))).forEach(k => assert.ok(I.pathways.some(x => x.key === k), `${p}/${seed}: 연결 ${k} 없음 (${I.pathways.map(x => x.key)})`));
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

/* 10) PHQ: PHQ-2 선별 → PHQ-8, 상담 안내, 측정 영역 대조 */
{
  assert.equal(B.phqScore({}), null);
  const low = B.phqScore({ phq: [1, 1] });
  assert.equal(low.phq2, 2); assert.equal(low.screen, false); assert.equal(low.phq8, null); assert.equal(low.consult, false);
  const high = B.phqScore({ phq: [2, 2, 2, 3, 0, 1, 2, 0] });
  assert.equal(high.screen, true); assert.equal(high.phq8, 12); assert.equal(high.band, '중간'); assert.equal(high.consult, true);
  assert.equal(B.phqScore({ phq: [2, 1, 1, 1] }).phq8, null);          // 추가 문항 미완료면 PHQ-8 없음
  assert.equal(B.PHQ.items.length, 8);                                   // 9번(자해) 문항은 넣지 않는다
  const dom = { emotion: { status: 'ok' }, alert: { status: 'concern' }, control: { status: 'na' } };
  const L = B.phqLinks(high, dom);
  assert.equal(L.find(x => x.domain === 'alert').kind, 'both');
  assert.equal(L.find(x => x.domain === 'emotion').kind, 'self');
  assert.equal(L.find(x => x.label === '집중 곤란').kind, 'na');
  const r = B.run(B.simulate('fatigue'));
  assert.equal(r.battery.care[0].domain, 'safety');
  const html = checkReport(r, 'phq');
  assert.ok(html.includes('PHQ-8') && html.includes('상담 권장'));
  assert.ok(!/우울증/.test(html.split('id="r-app"')[0]));      // 본문에 진단명 없음 (참고문헌 제목은 예외)
  const none = B.simulate('balanced'); none.checkin.phq = null;
  assert.ok(checkReport(B.run(none), 'phq-skip').includes('응답하지 않았어요'));
}

/* 11) MIST: 덧셈·뺄셈만, 난이도별 항 수·자릿수, 답은 0~9 정수이고 식을 계산하면 답과 같다 · 제한 시간 적응 */
{
  let seed = 5; const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let lv = 1; lv <= 5; lv++) for (let i = 0; i < 300; i++) {
    const q = B.mistProblem(lv, rand);
    assert.ok(Number.isInteger(q.ans) && q.ans >= 0 && q.ans <= 9, `L${lv} ${q.text}=${q.ans}`);
    const v = Function(`return ${q.text.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-')}`)();
    assert.equal(v, q.ans, `L${lv} ${q.text}`);
    assert.ok(!/[×÷]/.test(q.text), `L${lv} 덧셈·뺄셈만`);
    const nums = q.text.split(/ [+−] /).map(Number);
    assert.equal(nums.length, { 1: 2, 2: 3, 3: 2, 4: 2, 5: 3 }[lv], `L${lv} 항 수 ${q.text}`);
    if (lv >= 3) assert.ok(nums.some(n => n >= 10) && q.text.includes('−'), `L${lv} 두 자리 + 뺄셈 ${q.text}`);
  }
  for (let i = 0; i < 300; i++) {                     // 고난도(6): 두 자리 3항 ± 한 자리, 답은 0~9이고 식과 일치
    const q = B.mistProblem(6, rand), v = Function(`return ${q.text.replace(/−/g, '-')}`)();
    assert.ok(q.hard && q.ans >= 0 && q.ans <= 9 && v === q.ans && q.text.split(/ [+−] /).length === 4, `L6 ${q.text}`);
  }
  assert.ok(B.PROTOCOL.stress.hardAt.length >= 1 && B.PROTOCOL.stress.hardAt.length <= 2);
  assert.equal(B.mistNext(4000, true), 3680);
  assert.equal(B.mistNext(4000, false), 4480);
  assert.equal(B.mistNext(B.PROTOCOL.stress.minMs, true), B.PROTOCOL.stress.minMs);
  assert.equal(B.mistStart([2000, 2400, 2200]), 1980);                     // 연습 정답 평균 × 0.9
  assert.equal(B.mistStart([2000]), B.PROTOCOL.stress.limitMs);             // 정답이 부족하면 기본값
  /* 가중 계단법: 응답 시간이 일정한 사람(약 2초 ± 잡음)은 정답률 약 60%에 수렴한다 */
  {
    let limit = 4000, ok = 0, n = 0, seed = 3;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 400; i++) { const rt = 2000 * Math.exp((rnd() - 0.5) * 0.6), hit = rt <= limit; if (i >= 50) { n++; ok += hit; } limit = B.mistNext(limit, hit); }
    assert.ok(Math.abs(ok / n - 0.6) < 0.06, `staircase accuracy ${ok / n}`);
  }
}

/* 12) NL-QC: PVT 기기 지연 보정 · 수행 타당도 */
{
  const rts = Array.from({ length: 40 }, (_, i) => 290 + (i % 10) * 12);       // 가장 빠른 10% ≈ 290ms → 보정 60ms(상한)
  const s = B.pvtStats({ trials: rts.map((rt, i) => ({ onset: i * 4000, rt })), falseStarts: 0, durationMs: 180000 });
  assert.equal(s.offset, 60); assert.equal(s.lapseMs, 415); assert.equal(s.medianRt, s.rawMedianRt - 60);
  assert.equal(s.lapses, 0);                                                    // 기준이 415ms 로 늘어 380ms 대 반응은 경과가 아님
  const spam = B.pvtStats({ trials: rts.map((rt, i) => ({ onset: i * 4000, rt })), falseStarts: 25, durationMs: 180000 });
  assert.ok(spam.invalid);
  const seq = B.sartSequence(54, () => 0.3);
  const lazy = B.sartStats({ trials: seq.map((digit, i) => ({ digit, onset: i, rt: i % 3 ? null : 400 })) });
  assert.ok(lazy.invalid);
  const r = B.run(B.simulate('balanced'));
  r.battery.indicators.forEach(i => { if (i.value !== null) assert.ok(i.r >= 0 && i.r <= 1, `r ${i.key}`); });
  assert.ok(['A', 'B'].includes(r.battery.qc.grade));
  /* PVT 를 무작위로 누르면 각성 지표가 판정에서 빠진다 */
  const rec = B.simulate('fatigue'); rec.pvt.falseStarts = 80;
  const rr = B.run(rec);
  assert.ok(rr.battery.indicators.filter(i => i.key.startsWith('pvtL') || i.key === 'pvtMedian').every(i => i.excluded));
  assert.ok(rr.battery.qc.excluded.length >= 2);
  checkReport(rr, 'pvt-invalid');
}

/* 13) NL-QC: 신뢰도 가중 · 수렴 원칙 · 잠정 */
{
  const I = (key, primary, score, r = 1, extra = {}) => ({ key, domain: 'alert', primary, value: 1, score, status: B.statusOf(score), r, borderline: false, excluded: false, ...extra });
  /* 단 하나의 지표만 저하이고 그 지표가 경계면 ‘관리 필요’를 ‘주의’로 낮춘다 */
  const one = B.aggregateDomain('alert', [I('a', true, 10, 1, { borderline: true }), I('b', false, 80)]);
  assert.equal(one.status, 'watch'); assert.ok(one.notes.some(n => n.includes('수렴 원칙')));
  /* 두 지표가 함께 저하면 그대로 */
  assert.equal(B.aggregateDomain('alert', [I('a', true, 10), I('b', false, 30)]).status, 'concern');
  /* 고신뢰 핵심 지표 하나가 관리 필요면 평균이 양호해도 주의 */
  assert.equal(B.aggregateDomain('alert', [I('a', true, 30), I('b', true, 100), I('c', true, 100), I('d', false, 100)]).status, 'watch');
  /* 신뢰도가 낮은 지표는 덜 반영되고, 전체 신뢰도가 낮으면 잠정 */
  const w = B.aggregateDomain('alert', [I('a', true, 0, 0.35), I('b', true, 100, 1)]);
  assert.ok(w.score > 70, `weighted ${w.score}`);
  const t = B.aggregateDomain('alert', [I('a', true, 80, 0.4), I('b', true, null, null, { value: null })]);
  assert.equal(t.tentative, true);
}

/* 15) 자율신경: 압박 반응이 오차보다 작으면 회복률은 해당 없음, 회복 후반이 약하면 전체 구간으로, 기준선이 약하면 과제 직전 구간을 기준으로 */
{
  const rec = B.simulate('balanced'); 
  const r = B.run(rec);
  assert.ok(r.recoveryResid !== null);
  assert.ok(r.battery.indicators.find(i => i.key === 'recoveryResid').value !== null);
  /* 압박 반응이 1bpm 뿐인 사람: 회복률은 없고 잔여 심박은 있다 */
  const P0 = B.PERSONAS.balanced.hr.stress;
  B.PERSONAS.balanced.hr.stress = 1;
  const small = B.run(B.simulate('balanced'));
  B.PERSONAS.balanced.hr.stress = P0;
  // core 2.5: 압박 상승이 오차와 구분되지 않으면 회복률은 '해당 없음'(측정 실패가 아님 — 영역 분모에서 빠짐), 회복은 잔여 심박이 판정한다
  assert.equal(small.recovery, null, `small reaction recovery ${small.recovery}`);
  assert.equal(small.recoveryNA && small.recoveryNA.reason, 'no-stress-rise');
  const recInd = small.battery.indicators.find(i => i.key === 'recovery');
  assert.ok(recInd.notApplicable && recInd.value === null);
  assert.ok(small.recoveryResid !== null && small.battery.domains.autonomic.status !== 'na');
  assert.ok(small.battery.domains.autonomic.notes.some(n => n.includes('회복률은 계산하지 않았어요')));
  /* 회복 후반 신호가 망가져도 회복 구간 전체로 대신 계산 */
  const rec3 = B.simulate('control'), rp = rec3.phases.recovery, mid = (rp.start + rp.end) / 2;
  let sd3 = 9; const rnd3 = () => { sd3 = (sd3 * 16807) % 2147483647; return sd3 / 2147483647 - 0.5; };
  rec3.frames = rec3.frames.map(f => (f.t >= mid && f.t <= rp.end ? { ...f, r: 175 + 30 * rnd3(), g: 118 + 30 * rnd3(), b: 98 + 30 * rnd3(), rr: [0, 1, 2].map(() => [175 + 30 * rnd3(), 118 + 30 * rnd3(), 98 + 30 * rnd3()]) } : f));
  const r3 = B.run(rec3);
  assert.ok(r3.recovery !== null, `whole-window fallback ${r3.recoverySrc}`);
  /* 기준선 구간 신호를 잡음으로 망가뜨리면 과제 직전 구간이 기준이 된다 */
  const rec2 = B.simulate('overload'), bl = rec2.phases.baseline;
  let sd = 5; const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647 - 0.5; };
  rec2.frames = rec2.frames.map(f => f.t >= bl.start && f.t <= bl.end ? { ...f, r: 175 + 30 * rnd(), g: 118 + 30 * rnd(), b: 98 + 30 * rnd(), rr: [0, 1, 2].map(() => [175 + 30 * rnd(), 118 + 30 * rnd(), 98 + 30 * rnd()]) } : f);
  const r2 = B.run(rec2);
  assert.equal(r2.hrRef, 'pre');
  assert.ok(r2.stressDelta > 8, `delta ${r2.stressDelta}`);
  checkReport(r2, 'pre-ref');
}

/* 14) 좌우 균형 가중: 오른쪽만 보는 사람이 정서 자극 위치와 무관하게 편향으로 잡히지 않는다 */
{
  const W = 1000, mk = (side, emoSide) => ({ kind: 'neg', emoSide, onset: 0, end: 3000, samples: Array.from({ length: 90 }, (_, i) => ({ t: i * 33, x: side === 'R' ? 800 : 200 })) });
  const trials = [mk('R', 'R'), mk('R', 'R'), mk('R', 'R'), mk('R', 'L'), mk('R', 'L')];   // 정서 자극이 오른쪽 3회 · 왼쪽 2회, 시선은 늘 오른쪽
  const b = N.blockStats(trials, W);
  assert.equal(b.balanced, true); assert.equal(b.emoShare, 0.5);
}

/* 16) 화면 이탈 구간: 겹친 PVT·SART 시행은 빠지고 PVT 시간도 그만큼 줄어든다 */
{
  const rec = B.simulate('balanced'), ph = rec.phases.pvt;
  const base = B.run(B.simulate('balanced'));
  rec.hidden = [{ start: ph.start + 30000, end: ph.start + 60000 }];
  const r = B.run(rec);
  assert.ok(r.battery.pvt.n < base.battery.pvt.n, `pvt n ${r.battery.pvt.n} vs ${base.battery.pvt.n}`);
  assert.ok(r.battery.pvt.durationMin < base.battery.pvt.durationMin);
  assert.ok(r.battery.qc.hidden && r.battery.qc.hidden.dropped > 0);
  checkReport(r, 'hidden');
}

/* 17) 공명 호흡 순응: 호흡이 분당 15회로 뚜렷하면 호흡 동조 지표를 판정에서 뺀다 */
{
  const rec = B.simulate('control');
  const r0 = B.run(rec);
  assert.equal(r0.battery.qc.breath.off, false);
  const rr = rec.phases.recovery;
  rec.frames = rec.frames.map(f => (f.t >= rr.start && f.t <= rr.end ? { ...f, cy: 0.5 + 0.004 * Math.sin(2 * Math.PI * 0.25 * f.t / 1000) } : f));
  const r = B.run(rec), cp = r.battery.indicators.find(i => i.key === 'coupling');
  assert.equal(r.battery.qc.breath.off, true);
  assert.ok(cp.excluded || cp.value === null);
  assert.ok(r.battery.domains.autonomic.notes.some(n => n.includes('호흡 동조 지표는 판정에서')));
}

/* 18) 측정 맥락: 짧은 수면 + 각성 저하 → 맥락 해석, 최근 카페인 + 각성 양호 → 과대 추정 가능성 */
{
  const fl = s => k => s.includes(k);
  assert.ok(B.contextNotes({ sleep: '5to6' }, null, fl(['alert'])).some(c => c.key === 'sleep-short-low'));
  assert.ok(B.contextNotes({ caffeine: 'lt1' }, null, fl([])).some(c => c.key === 'caffeine-ok'));
  assert.equal(B.contextNotes({ sleep: '7to8', caffeine: 'gt6' }, '2026-10-03T01:00:00Z', fl([])).length, 0);
  const r = B.run(B.simulate('fatigue'));
  assert.ok(r.battery.integrated.context.some(c => c.key === 'sleep-short-low'));
  const html = checkReport(r, 'context');
  assert.ok(html.includes('오늘의 측정 환경') && html.includes('점수 구성'));
}

/* 19) 점수 분해: 기여의 합 = 영역 점수, 비중 합 = 100%, 저하 지표에는 다음 단계 목표 */
{
  const r = B.run(B.simulate('fatigue'));
  B.DOMAIN_KEYS.forEach(k => {
    const d = r.battery.domains[k], ex = d.explain;
    if (d.score === null) return;
    assert.ok(Math.abs(ex.reduce((s, e) => s + e.points, 0) - d.score) <= 1.2, `${k} sum`);
    assert.ok(Math.abs(ex.reduce((s, e) => s + e.share, 0) - 100) <= 2, `${k} share`);
    ex.filter(e => e.status !== 'ok').forEach(e => assert.ok(e.next && /이하|이상/.test(e.next.text), `${k} next`));
  });
}

/* 20) 연구 데이터 패키지: PHQ 는 별도 동의 때만, 시계열은 정수 양자화, 복원 가능한 배율 */
{
  const RS = require('./newbiz-research.js');
  const rec = B.simulate('overload'), res = B.run(rec);
  const no = RS.pack(rec, res, { research: true, phq: false }, {});
  assert.ok(!('phq' in no.summary.checkin) && no.summary.phq === null);
  const yes = RS.pack(rec, res, { research: true, phq: true }, {});
  assert.ok(Array.isArray(yes.summary.checkin.phq) && yes.summary.phq.phq8 !== null);
  const F = no.payload.frames;
  assert.equal(F.t.length, rec.frames.length);
  assert.ok(F.r.every(v => v === null || Number.isInteger(v)));
  assert.ok(Math.abs(F.r[10] / RS.FRAME_COLS.r - rec.frames[10].r) < 0.01);
  assert.ok(JSON.stringify(no.summary).length < 200000 && JSON.stringify(no.meta).length < 30000);
  assert.equal(RS.browserFamily('Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/141.0 Safari/537.36').browser, 'chrome');
}

/* 21) 통합 리포트 본문: 쉬운 이름 · 점수 구성 · 케어 체크 · 부록 분리, 본문에 인용·전문 용어·AI 표기 없음, 예시 해설 고정 */
for (const p of Object.keys(B.PERSONAS)) {
  const r = B.run(B.simulate(p, { seed: 7 }));
  const h = R.render(r, { history: [] }), body = h.split('id="r-app"')[0];
  assert.ok(!/undefined|NaN/.test(h) && !h.includes('[object'), `${p}: 잘못된 값`);
  ['또렷함', '집중 조절', '마음의 시선', '몸의 회복력', '점수 구성', '나를 위한 케어 플랜', 'data-todo', '부록'].forEach(n => assert.ok(h.includes(n), `${p}: ${n}`));
  // 제품 이름 '마인드 AI 컨디션'(2026-10-05 개명)만 예외 — 그 밖의 AI 표기는 본문에 없어야 한다
  assert.ok(!/class="cite"|PERCLOS|사카드|SART|rPPG|[^A-Za-z]AI[^A-Za-z]|Gemini|gemini/.test(body.replaceAll('마인드 AI 컨디션', '마인드 컨디션')), `${p}: 본문에 인용·전문 용어·AI 표기`);
  assert.ok(Array.isArray(R.SAMPLE_SUMMARY[p]) && R.SAMPLE_SUMMARY[p].length >= 4, `${p}: 예시 해설`);
}
assert.ok(R.render(B.run(B.simulate('overload', { seed: 7 })), {}).includes('감정/스트레스 과부하형'));

console.log('newbiz-battery tests passed');

/* 원활 추적 2판 (2026-10-05): 속도 단계 + 불규칙 방향 전환 */
{
  /* ① 반응 지연: 합성 반응 = lag + 90ms(balanced 170 · fatigue 240) — 추정 중앙값이 ±40ms 안 */
  for (const [p, truth] of [['balanced', 170], ['fatigue', 240]]) {
    const r = B.run(B.simulate(p)).battery, lat = r.indicators.find(i => i.key === 'pursuitLatency');
    assert.ok(Math.abs(lat.value - truth) <= 40, `${p} latency ${lat.value} vs ${truth}`);
    assert.ok(lat.ci && lat.ci[0] < lat.value && lat.value < lat.ci[1], `${p} latency ci`);
  }
  /* ② 참고 지표 자격 심사(battery 1.8): 신뢰도·타당 범위를 통과하면 판정에 들어가고(값을 지우면 점수가 바뀜), d′ 는 들어가지 않는다 */
  const rec = B.simulate('balanced'), full = B.run(rec).battery, base = full.domains.control.score;
  const lat0 = full.indicators.find(i => i.key === 'pursuitLatency');
  assert.ok(lat0.admitted && !lat0.ref && lat0.r >= B.ADMIT.minR, `latency admitted r=${lat0.r}`);
  assert.ok(full.indicators.find(i => i.key === 'sartDprime').ref, 'd′ stays reference (function of commission·omission)');
  const noRev = B.run({ ...rec, pursuit: { ...rec.pursuit, reversal: null } }).battery;
  assert.equal(noRev.indicators.find(i => i.key === 'pursuitLatency').value, null);
  assert.ok(noRev.domains.control.measured === full.domains.control.measured - 1, 'admitted ref indicator counted in domain');
  assert.ok(!B.ADMIT.plausible.pursuitSpeed(1.2) && B.ADMIT.plausible.pursuitLatency(215), 'plausible ranges');
  /* ③ 머리 동조: 얼굴 회전이 표적을 그대로 따라가면 이득 신뢰도가 낮아져 판정에서 빠진다 */
  const lv = rec.pursuit.levels, tgt = t => { const b = lv.filter(x => t >= x.t0).at(-1) || lv[0]; return Math.sin(2 * Math.PI * b.freq * (t - b.t0) / 1000); };
  const a0 = lv[0].t0, a1 = lv.at(-1).t0 + lv.at(-1).dur;
  const headRec = { ...rec, frames: rec.frames.map(f => f.t >= a0 && f.t <= a1 ? { ...f, yaw: 0.08 * tgt(f.t), faceOk: true } : f) };
  const hg = B.run(headRec).battery.indicators.find(i => i.key === 'pursuitGain'), g0 = B.run(rec).battery.indicators.find(i => i.key === 'pursuitGain');
  assert.ok(hg.r < g0.r && hg.excluded, `head-follow lowers gain reliability ${hg.r} vs ${g0.r}`);
  /* ④ 1판(좌우 0.25Hz) 기록도 그대로 분석된다 */
  const W = rec.screenW, cx = W / 2, amp = 0.36 * W, t0 = lv[0].t0, dur = 24000, samples = [];
  for (let t = t0; t <= t0 + dur; t += 33) samples.push({ t, x: cx + 0.9 * amp * Math.sin(2 * Math.PI * 0.25 * (t - 80 - t0) / 1000) });
  const legacy = B.run({ ...rec, pursuit: { t0, cx, amp, freq: 0.25, dur, samples, circle: rec.pursuit.circle } }).battery.indicators.find(i => i.key === 'pursuitGain');
  assert.ok(Math.abs(legacy.value - 0.9) < 0.05, `legacy gain ${legacy.value}`);
  /* ⑤ 소요 시간: 표준(quick) 약 26초, 정밀(full) 약 44초 (원형 제외) */
  assert.ok(Math.abs(B.pursuitSec(B.DUR.quick) - 26) <= 3 && Math.abs(B.pursuitSec(B.DUR.full) - 45) <= 3, `${B.pursuitSec(B.DUR.quick)} ${B.pursuitSec(B.DUR.full)}`);
  console.log('PASS pursuit v2: reversal latency, ref indicator admission, head-follow reliability, legacy v1 record, duration');
}

/* SART 신호탐지 (2026-10-05): d′ 가 응답 성향과 분리되는지 — 같은 억제 실패율이라도 반응 숫자를 자주 놓치면 d′ 가 낮다 */
{
  const seq = B.sartSequence(108, () => 0.5), mk = (failNogo, missGo) => seq.map((digit, i) => ({ digit, onset: i * 1150, rt: digit === 3 ? (i % 10 < failNogo ? 300 : null) : (i % 20 < missGo ? null : 380) }));
  const a = B.sartStats({ trials: mk(4, 0) }), b = B.sartStats({ trials: mk(4, 3) });
  assert.ok(Math.abs(a.commission - b.commission) < 0.15, 'similar commission');
  assert.ok(a.dprime > b.dprime + 0.4, `d′ separates go misses ${a.dprime} vs ${b.dprime}`);
  assert.ok(a.criterion < b.criterion, 'criterion more liberal when pressing everything');
  const perfect = B.sartStats({ trials: mk(0, 0) });
  assert.ok(Number.isFinite(perfect.dprime) && perfect.dprime > 3, `log-linear keeps finite d′ ${perfect.dprime}`);
  const r = B.run(B.simulate('balanced')).battery.indicators.find(i => i.key === 'sartDprime');
  assert.ok(r.ref && Number.isFinite(r.value), 'reference indicator present');
  console.log('PASS SART signal detection: d′ and criterion');
}

/* battery 1.6: 빠른 모드 중립 블록(≈14초)에서는 정서 자극 심박 반응을 '해당 없음'으로 두고(영역 분모 제외) 표준 모드에서는 판정한다.
 * 사카드(방향 판정)는 카메라 15fps 에서도 신뢰도를 깎지 않는다(실측 솎기: 7fps 에서도 방향 판정 97.6% 일치) */
{
  const q = B.run(B.simulate('balanced', { mode: 'quick', seed: 11 })).battery, f = B.run(B.simulate('balanced', { mode: 'full', seed: 11 })).battery;
  const nq = q.indicators.find(i => i.key === 'negHr'), nf = f.indicators.find(i => i.key === 'negHr');
  assert.ok(nq.notApplicable && nq.notApplicable.reason === 'neutral-block-too-short' && nq.value === null, 'quick negHr n/a');
  assert.ok(!nf.notApplicable, 'full negHr scored');
  const rec = B.simulate('balanced', { mode: 'quick', seed: 12 }), sp = rec.phases.saccade;
  let last = -Infinity;
  rec.frames = rec.frames.filter(fr => { if (fr.t < sp.start || fr.t > sp.end) return true; if (fr.t - last < 1000 / 16) return false; /* 30fps 합성 → 두 장에 한 장(15fps) */ last = fr.t; return true; });
  const r = B.run(rec).battery.qc.steps.find(s => s.key === 'saccade').r;
  assert.ok(r >= 0.95, `saccade r at 15fps ${r}`);
  console.log('PASS battery 1.6: quick-mode negHr not applicable, saccade direction reliability not penalised at 15fps');
}

/* battery 1.7: 정서 보기 반분 안정성은 시행 수로 기대되는 우연 차이를 넘을 때만 신뢰도를 낮춘다 */
{
  const r0 = B.simulate('balanced', { mode: 'full', seed: 21 }), W = r0.screenW || 1440;   /* 부정 시행 24개 — 4개(빠른 모드)로는 완전한 교대도 우연과 구분되지 않는다 */
  const fv = rec => B.run(rec).battery.qc.steps.find(s => s.key === 'freeview').r;
  const normal = fv(r0);
  /* 홀수 시행은 내내 부정 사진, 짝수 시행은 내내 반대쪽만 본다 → 반분 차이 1.0 (우연으로 설명 안 됨) */
  let k = 0;
  const split = { ...r0, trials: r0.trials.map(t => { if (t.kind !== 'neg') return t; const emo = k++ % 2 === 0; const x = (t.emoSide === 'L') === emo ? W * 0.25 : W * 0.75; return { ...t, samples: t.samples.map(p => ({ ...p, x, rx: x })) }; }) };
  const unstable = fv(split);
  assert.ok(normal >= 0.85, `normal freeview r ${normal}`);
  assert.ok(unstable < normal - 0.1, `unstable freeview r ${unstable} vs ${normal}`);
  console.log(`PASS battery 1.7: split-half penalty only beyond chance (normal ${normal}, unstable ${unstable})`);
}

/* battery 1.8: 회복률 오차 범위(델타법) · 수렴 원칙에서 같은 측정값(회복 후반 심박) 지표는 근거 1개 */
{
  const r = B.run(B.simulate('overload', { seed: 7 })).battery, rv = r.indicators.find(i => i.key === 'recovery'), rr = r.indicators.find(i => i.key === 'recoveryResid');
  assert.equal(rv.src, rr.src, 'recovery·recoveryResid share source');
  if (Number.isFinite(rv.value)) assert.ok(rv.ci && rv.ci[0] < rv.value && rv.value < rv.ci[1], `recovery ci ${rv.ci}`);
  console.log('PASS battery 1.8: recovery CI, shared-source convergence');
}
