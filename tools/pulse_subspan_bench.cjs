/* 하위 구간 심박 요약 벤치마크 (합성 전체 세션 · 사람 정확도 주장 아님)
 * B.simulate 세션의 피부색 신호에 잡음을 더하고 14fps 로 솎아(2026-10-07 실측 NLR-D2B1…: LG gram i3, 단계별 7~13fps) 이전 엔진(HEAD)과 비교한다.
 * 보는 것: 회복 후반·압박·정서 블록 구간의 상태와 오차, 심박 지표(정서 자극 심박 반응·압박 심박 반응·심박 회복률·회복 후 잔여 심박)의 판정 제외 여부
 * 실행: node tools/pulse_subspan_bench.cjs [이전 커밋=HEAD] */
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
const ref = process.argv[2] || 'HEAD', root = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-old-'));
for (const f of ['newbiz-core.js', 'condition-signal.js', 'condition-fusion.js', 'newbiz-battery.js']) fs.writeFileSync(path.join(dir, f), execFileSync('git', ['show', ref + ':' + f], { cwd: root }));
const OLD = require(path.join(dir, 'newbiz-battery.js')), NEW = require('../newbiz-battery.js');
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }
function degrade(rec, { fps, noise, seed }) {
  const rand = rng(seed), gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += rand(); return u - 3; };
  let last = -Infinity; const frames = [];
  for (const f of rec.frames) {
    if (f.t - last < 1000 / fps * (0.85 + 0.3 * rand())) continue; last = f.t;
    const g = { ...f, r: f.r + noise * gauss(), g: f.g + noise * gauss(), b: f.b + noise * gauss() };
    if (f.rr) g.rr = f.rr.map((c, k) => c.map(v => v + noise * 1.7 * (1 + 0.4 * k) * gauss()));
    frames.push(g);
  }
  return { ...rec, frames };
}
const keys = ['negHr', 'stressDelta', 'recovery', 'recoveryResid'], rows = [], sum = { old: 0, neu: 0 };
let n = 0;
for (const noise of [0.4, 0.8]) for (let s = 1; s <= 4; s++) {
  const base = NEW.simulate('balanced', { mode: 'quick', seed: 7000 + s }), rec = degrade(base, { fps: 14, noise, seed: s });
  const o = OLD.run(rec), c = NEW.run(rec), ex = r => keys.filter(k => { const i = r.battery.indicators.find(x => x.key === k); return i && i.excluded; }).length;
  const st = (r, k) => r.hr[k] ? `${r.hr[k].status}/${Math.round(r.hr[k].bpm ?? NaN)}` : '—';
  rows.push({ 잡음: noise, seed: s, '이전 회복후반': st(o, 'recoveryLate'), '현재 회복후반': st(c, 'recoveryLate'), '이전 압박': st(o, 'stress'), '현재 압박': st(c, 'stress'), '이전 중립': st(o, 'neu'), '현재 중립': st(c, 'neu'), '이전 제외(4개 중)': ex(o), '현재 제외(4개 중)': ex(c) });
  sum.old += ex(o); sum.neu += ex(c); n++;
}
console.table(rows);
console.log(`심박 지표 판정 제외 합계: 이전 ${sum.old}/${n * 4} → 현재 ${sum.neu}/${n * 4}`);
fs.rmSync(dir, { recursive: true, force: true });
