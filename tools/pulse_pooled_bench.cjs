/* 통합 스펙트럼(pooled) 판정 기준 벤치마크 (합성 신호 · 사람 정확도 주장 아님)
 * ① 무맥박(맥파 진폭 0) 합성 영상에서 통합 스펙트럼 SNR 분포 → 위양성 상한으로 POOLED_SNR 기준을 정한다
 * ② 약한 맥박에서 구간 상태(measured 비율)·bpm 오차를 본다
 * 조건: 카메라 14fps(2026-10-07 실측 NLR-D2B1…: LG gram i3 전체 13.9fps)와 22fps, 구간 30·40초
 * 실행: node tools/pulse_pooled_bench.cjs */
const N = require('../newbiz-core.js');
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }
function frames(sec, { fps, seed, noise, amp, hr }) {
  const rand = rng(seed), gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += rand(); return u - 3; };
  const out = []; let phase = 0, t = 0;
  while (t <= sec * 1000) {
    const dt = 1000 / fps * (1 + (rand() - 0.5) * 0.3);
    phase += 2 * Math.PI * (hr + 3 * Math.sin(t / 6000)) / 60 * dt / 1000;
    const p = amp * (Math.sin(phase) + 0.35 * Math.sin(2 * phase - 0.8)), drift = 2 * Math.sin(t / 9000);
    const ch = k => { const n2 = noise * 1.7 * (1 + 0.4 * k); return [175 + drift + 0.25 * p + n2 * gauss(), 118 + drift * 0.8 + 0.6 * p + n2 * gauss(), 98 + drift * 0.7 + 0.15 * p + n2 * gauss()]; };
    const rr = [ch(0), ch(1), ch(2)];
    out.push({ t, ok: true, rr, r: (rr[0][0] + rr[1][0] + rr[2][0]) / 3, g: (rr[0][1] + rr[1][1] + rr[2][1]) / 3, b: (rr[0][2] + rr[1][2] + rr[2][2]) / 3 });
    t += dt;
  }
  return out;
}
const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
const nulls = [], rows = [];
let seed = 1;
for (const fps of [14, 22]) for (const sec of [30, 40]) for (const noise of [0.6, 1.0, 1.4]) {
  for (let i = 0; i < 17; i++) {
    const ev = N.measureEvidence(frames(sec, { fps, seed: seed++, noise, amp: 0, hr: 75 }), 0, sec * 1000);
    if (ev.pooled) nulls.push({ fps, sec, noise, snr: ev.pooled.snrDb, k: ev.pooled.windows, status: ev.status });
  }
}
const ns = nulls.map(r => r.snr);
console.log(`무맥박: 통합 스펙트럼 계산된 구간 ${nulls.length}건 (창 2개 이상 채택된 경우만) · SNR 최댓값 ${q(ns, 1)?.toFixed(2)} · 99% ${q(ns, .99)?.toFixed(2)} · 95% ${q(ns, .95)?.toFixed(2)} dB · 'measured' ${nulls.filter(r => r.status === 'measured').length}건`);
for (const fps of [14, 22]) for (const [noise, amp] of [[0.6, 1], [1.0, 1], [1.4, 1], [1.0, 0.6], [1.4, 0.6]]) {
  const r = { fps, noise, amp, n: 0, pooled: [], measured: 0, limited: 0, err: [] };
  for (let i = 0; i < 12; i++) {
    const hr = 62 + (i * 7) % 40, ev = N.measureEvidence(frames(30, { fps, seed: 1000 + seed++, noise, amp, hr }), 0, 30000);
    r.n++; if (ev.status === 'measured') r.measured++; else if (ev.status === 'limited') r.limited++;
    if (ev.pooled) r.pooled.push(ev.pooled.snrDb); if (ev.bpm !== null) r.err.push(Math.abs(ev.bpm - hr));
  }
  rows.push({ fps, 잡음: noise, 진폭: amp, 구간: r.n, measured: r.measured, limited: r.limited, '통합SNR 중앙값': q(r.pooled, .5)?.toFixed(2) ?? '—', '통합SNR 10%': q(r.pooled, .1)?.toFixed(2) ?? '—', 'bpm 오차 중앙값': q(r.err, .5)?.toFixed(1) ?? '—', 'bpm 오차 최대': q(r.err, 1)?.toFixed(1) ?? '—' });
}
console.table(rows);
