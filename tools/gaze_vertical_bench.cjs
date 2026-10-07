/* 세로 시선 보정 벤치마크 (합성 특징 · 사람 정확도 주장 아님)
 * 실측 양상(2026-10-07 NLR-541B…·그림자 비교 7세션)을 흉내 낸다: 아래를 볼수록 홍채 세로 이동(v)이 눈꺼풀에 가려 눌리고(기울기 ≈0.5),
 * 눈 모양 점수(lookDown·lookUp)는 세로 방향을 따라간다. 화면 1536×864, 보정 순서는 condition.html 과 같다(9점 → 검증·영점 → 정밀 8점 평가).
 * 이전 엔진(HEAD: 세로 ×0.6·중앙값 오차, 기울기 0.75~1.35, 위아래 점수 후보 없음)과 현재 엔진을 학습에 쓰지 않은 8점의 세로 오차로 비교한다.
 * 실행: node tools/gaze_vertical_bench.cjs [이전 커밋=HEAD] */
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
const ref = process.argv[2] || 'HEAD', root = path.join(__dirname, '..'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-old-'));
for (const f of ['newbiz-core.js', 'condition-signal.js', 'condition-fusion.js']) fs.writeFileSync(path.join(dir, f), execFileSync('git', ['show', ref + ':' + f], { cwd: root }));
const OLD = require(path.join(dir, 'newbiz-core.js')), NEW = require('../newbiz-core.js');
const W = 1536, H = 864;
function make(seed) {
  let s = seed; const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  const g = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  return (x, y) => {
    const nx = x / W - 0.5, ny = y / H - 0.5, down = Math.max(0, ny);
    return { u: 0.5 + 0.11 * nx + 0.04 * nx * Math.abs(nx) + 0.007 * g(),
      v: 0.02 * ny - 0.011 * down + 0.008 * g(),                                  // 아래쪽은 홍채가 가려 세로 이동이 절반으로
      open: 0.30 - 0.05 * ny + 0.008 * g(), lookDown: Math.max(0, 0.9 * ny + 0.15 + 0.06 * g()), lookUp: Math.max(0, -0.9 * ny + 0.05 + 0.06 * g()),
      lookV: -1.8 * ny + 0.1 * g(), yaw: 0.002 * g(), pitch: 0.003 * g(), cx: 0.5 + 0.002 * g(), cy: 0.5 + 0.002 * g() };
  };
}
function run(N, feat, isNew) {
  const pts = (list, n) => list.map(([fx, fy]) => ({ x: fx * W, y: fy * H, fs: Array.from({ length: n }, () => feat(fx * W, fy * H)) }));
  const s9 = []; for (const fy of [0.14, 0.5, 0.88]) for (const fx of [0.08, 0.5, 0.92]) for (let i = 0; i < 14; i++) s9.push({ x: fx * W, y: fy * H, f: feat(fx * W, fy * H) });
  const val = pts([[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]], 14), zc = pts([[0.5, 0.5], [0.2, 0.22], [0.8, 0.22], [0.8, 0.8], [0.2, 0.8]], 14);
  const fp = pts([[0.12, 0.5], [0.88, 0.5], [0.5, 0.12], [0.5, 0.88], [0.32, 0.38], [0.68, 0.62], [0.36, 0.8], [0.64, 0.22]], 14);
  const at = (m, A, p) => { const q = p.fs.map(f => N.applyAffine(A, N.predictGaze(m, f))).filter(Boolean); return { x: p.x, y: p.y, gx: N.median(q.map(v => v.x)), gy: N.median(q.map(v => v.y)) }; };
  const feat2 = l => l.flatMap(p => p.fs.map(f => ({ x: p.x, y: p.y, f })));
  const train = [...s9, ...feat2(val), ...feat2(zc)], cand = [];
  const add = (key, m, extra) => { if (m) cand.push({ key, m, A: N.fitAffine([...val, ...zc].map(p => at(m, null, p))), extra }); };
  add('기본', N.fitGaze(train));
  const m3 = N.fitGaze(train, 0.5, { extra: ['lookV'] }); if (m3 && m3.keys.includes('lookV')) add('lookV', m3, ['lookV']);
  if (isNew) { const m4 = N.fitGaze(train, 0.5, { extra: ['lookUp', 'lookDown'] }); if (m4 && m4.keys.includes('lookDown')) add('위아래', m4, ['lookUp', 'lookDown']); }
  cand.forEach(c => { c.acc = N.gazeAccuracy(fp.map(p => at(c.m, c.A, p)), W, H); });
  const b = N.pickCalibration(cand), pr = fp.map(p => at(b.m, b.A, p)), bottom = pr.filter(p => p.y > H * 0.6);
  const my = l => l.reduce((s, p) => s + Math.abs(p.gy - p.y), 0) / l.length;
  return { chosen: b.key, vErr: my(pr), vBottom: my(bottom), hErr: pr.reduce((s, p) => s + Math.abs(p.gx - p.x), 0) / pr.length };
}
const rows = []; const sum = { o: 0, n: 0, ob: 0, nb: 0 };
for (let seed = 1; seed <= 10; seed++) {
  const o = run(OLD, make(seed * 97), false), n = run(NEW, make(seed * 97), true);
  rows.push({ seed, '이전 선택': o.chosen, '이전 세로오차px': Math.round(o.vErr), '이전 아래쪽px': Math.round(o.vBottom), '현재 선택': n.chosen, '현재 세로오차px': Math.round(n.vErr), '현재 아래쪽px': Math.round(n.vBottom), '현재 가로오차px': Math.round(n.hErr), '이전 가로오차px': Math.round(o.hErr) });
  sum.o += o.vErr; sum.n += n.vErr; sum.ob += o.vBottom; sum.nb += n.vBottom;
}
console.table(rows);
console.log(`평균 세로 오차: 이전 ${Math.round(sum.o / 10)}px → 현재 ${Math.round(sum.n / 10)}px · 화면 아래쪽 점: 이전 ${Math.round(sum.ob / 10)}px → 현재 ${Math.round(sum.nb / 10)}px (화면 높이 ${H}px)`);
fs.rmSync(dir, { recursive: true, force: true });
