/* 심박 회귀 재현 벤치마크 (합성 신호 · 사람 정확도 주장 아님)
 * 실측 세션(2026-10 dataset memo e6cb18d9)의 수집 조건을 흉내 낸다:
 *   - 카메라 22fps, 얼굴 추론은 일부 프레임에서만(초당 약 7.4회) → 나머지 프레임의 피부 영역 위치는 묵은 값
 *   - 피부 영역 위치 나이(ROI age) 중앙값 ≈175ms, 95백분위 ≈290ms
 * 변경 전 규칙: 위치 나이 > 180ms 이면 피부 영역을 버림(ppgOk=false)
 * 변경 후 규칙: 600ms까지 쓰고 나이에 따라 품질만 낮춤 (condition-camera.js)
 * 출력: 구간별 심박 커버리지·후보 창 수·추정 BPM 오차 (기준 = 합성 심박)
 * 실행: node tools/condition_regression_bench.cjs */
const N = require('../newbiz-core.js');
const rand = (s => () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; })(20261005);
function roiAge() {                       // 로그정규 근사: 중앙값 175ms, p95 ≈ 290ms
  const z = Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
  return Math.exp(Math.log(175) + 0.31 * z);
}
function run(label, gate, inferRate) {
  const rows = [];
  for (const [phase, sec, hr] of [['baseline', 35, 72], ['stress', 47, 88], ['recovery', 44, 76]]) {
    const frames = N.synthFrames(0, sec * 1000, t => hr + 2 * Math.sin(t / 7000), { fps: 22, seed: Math.round(sec * hr), noise: 0.45 });
    let total = 0, kept = 0;
    const out = frames.map(f => {
      total++;
      const fresh = rand() < inferRate, age = fresh ? 20 + rand() * 40 : roiAge();
      const w = gate(age);
      if (w <= 0) return { ...f, ok: false, ppgOk: false };
      kept++;
      return { ...f, ppgOk: true, skinQ: w, rq: [w, w, w] };
    });
    const ev = N.measureEvidence(out, 0, sec * 1000);
    rows.push({ phase, frames: total, usedFrames: kept, coverage: Math.round((ev.coverage || 0) * 100), candidateWindows: ev.candidateWindows ?? 0, status: ev.status, bpm: ev.bpm === null ? null : Math.round(ev.bpm), truth: hr, errBpm: ev.bpm === null ? null : Math.round(Math.abs(ev.bpm - hr) * 10) / 10, confidence: Math.round((ev.confidence || 0) * 100) / 100 });
  }
  console.log(`\n[${label}]`);
  console.table(rows);
  return rows;
}
const before = age => (age <= 180 ? (age <= 80 ? 1 : 0.6) : 0);
const after = age => (age <= 100 ? 1 : age <= 600 ? 1 - (age - 100) / 650 : 0);
run('변경 전 · 워커 추론 초당 7.4회 · 위치 나이 >180ms 버림', before, 7.4 / 22);
run('변경 후(완화만) · 같은 추론 빈도 · 600ms까지 가중', after, 7.4 / 22);
run('변경 후(주 스레드 추론) · 프레임마다 추론 · 600ms까지 가중', after, 0.95);
