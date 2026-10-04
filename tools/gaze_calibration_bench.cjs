/* 시선 보정 합성 벤치마크 (합성 특징 · 사람 정확도 주장 아님)
 * 웹캠 시선의 알려진 약점을 흉내 낸다: 세로 홍채 이동(v)은 작고 잡음이 크며, 눈꺼풀 열림(open)은 세로 시선과 함께 변하고,
 * 화면 가장자리에서 비선형이 생기며, 검사 중 머리가 내려가 세로 영점이 어긋난다.
 * 비교: ① 기존 특징 ② + 눈꺼풀 열림 ③ ②+잔차 보정 ④ 머리 이동 후 자동 영점 유지 유무
 * 실행: node tools/gaze_calibration_bench.cjs */
const N = require('../newbiz-core.js');
const W = 1536, H = 864;
let seed = 7; const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
function feat(x, y, shift = 0) {
  const nx = x / W - 0.5, ny = y / H - 0.5;
  return {
    u: 0.5 + 0.11 * nx + 0.05 * nx * Math.abs(nx) + 0.007 * gauss(),          // 가장자리 비선형
    v: 0.02 * ny + 0.012 * gauss() + shift * 0.01,                            // 약한 세로 신호
    open: 0.30 - 0.07 * ny + 0.006 * gauss() - shift * 0.02,                  // 눈꺼풀: 아래를 보면 작아짐
    yaw: 0.002 * gauss(), pitch: 0.003 * gauss() + shift * 0.02, cx: 0.5 + 0.002 * gauss(), cy: 0.5 + 0.002 * gauss() + shift * 0.03,
  };
}
const pts = (list, n) => list.map(([fx, fy]) => ({ x: fx * W, y: fy * H, fs: Array.from({ length: n }, () => feat(fx * W, fy * H)) }));
const s9 = [];
for (const fy of [0.14, 0.5, 0.88]) for (const fx of [0.08, 0.5, 0.92]) for (let i = 0; i < 25; i++) s9.push({ x: fx * W, y: fy * H, f: feat(fx * W, fy * H) });
const val = pts([[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]], 12), zc = pts([[0.5, 0.5], [0.2, 0.22], [0.8, 0.22], [0.8, 0.8], [0.2, 0.8]], 12);
const fine = pts([[0.12, 0.5], [0.88, 0.5], [0.5, 0.12], [0.5, 0.88], [0.32, 0.38], [0.68, 0.62], [0.36, 0.8], [0.64, 0.22]], 12);
const predAt = (m, A, R, p) => { const g = p.fs.map(f => N.applyResidual(R, N.applyAffine(A, N.predictGaze(m, f)))).filter(Boolean); return { x: p.x, y: p.y, gx: N.median(g.map(q => q.x)), gy: N.median(g.map(q => q.y)) }; };
const evalOn = (m, A, R) => N.gazeAccuracy(fine.map(p => predAt(m, A, R, p)), W, H).errPct;
const rows = [];
const m0 = N.fitGaze(s9, 0.5, { open: false }), A0 = N.fitAffine([...val, ...zc].map(p => predAt(m0, null, null, p)));
rows.push({ 조건: '① 기존 특징(u,v,자세)', '새 위치 8곳 오차(%)': evalOn(m0, A0, null) });
const m1 = N.fitGaze(s9), A1 = N.fitAffine([...val, ...zc].map(p => predAt(m1, null, null, p)));
rows.push({ 조건: '② + 눈꺼풀 열림', '새 위치 8곳 오차(%)': evalOn(m1, A1, null) });
const R1 = N.fitResidual([...val, ...zc].map(p => predAt(m1, A1, null, p)), W, H);
rows.push({ 조건: '③ ② + 잔차 보정', '새 위치 8곳 오차(%)': evalOn(m1, A1, R1) });
console.log('[보정 단계 · 학습에 쓰지 않은 새 위치 8곳으로 평가]'); console.table(rows);
/* 머리 이동(세로 영점 어긋남) 후 측정: 자동 영점 유지(응시점 7번, 25%씩) 유무 */
const shifted = pts([[0.5, 0.5], [0.3, 0.3], [0.7, 0.7], [0.2, 0.8], [0.8, 0.2]], 12).map(p => ({ ...p, fs: p.fs.map(() => feat(p.x, p.y, 1)) }));
const err = drift => N.gazeAccuracy(shifted.map(p => { const q = predAt(m1, A1, R1, p); return { ...q, gx: q.gx - drift.dx, gy: q.gy - drift.dy }; }), W, H).errPct;
let drift = { dx: 0, dy: 0 };
const center = predAt(m1, A1, R1, { x: W / 2, y: H / 2, fs: Array.from({ length: 12 }, () => feat(W / 2, H / 2, 1)) });
const before = err(drift);
for (let i = 0; i < 7; i++) { drift = { dx: drift.dx + 0.25 * (center.gx - W / 2 - drift.dx), dy: drift.dy + 0.25 * (center.gy - H / 2 - drift.dy) }; }
console.log('\n[검사 중 머리 위치가 바뀐 뒤 · 같은 모델]'); console.table([{ 조건: '자동 영점 유지 없음', '오차(%)': before }, { 조건: '응시점 7번 자동 영점 유지', '오차(%)': err(drift) }]);
