/* 약한 심박 신호 벤치마크 (합성 신호 · 사람 정확도 주장 아님)
 * 잡음을 키우고 짧은 움직임 잡음 구간을 섞은 합성 영상 신호에서, 이전 엔진(Git 기준 커밋)과 현재 엔진의
 * 구간별 심박 커버리지·추정 오차를 비교한다. 실행: node tools/pulse_weak_signal_bench.cjs [이전 커밋=HEAD]
 * 정답 = 합성에 넣은 심박. 커버리지 = 심박 값이 받아들여진 시간 / 구간 길이 */
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
const ref = process.argv[2] || 'HEAD';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-old-'));
for (const f of ['newbiz-core.js', 'condition-signal.js', 'condition-fusion.js']) fs.writeFileSync(path.join(dir, f), execFileSync('git', ['show', ref + ':' + f], { cwd: path.join(__dirname, '..') }));
const OLD = require(path.join(dir, 'newbiz-core.js')), NEW = require('../newbiz-core.js');
let seed = 11; const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
const rows = [];
for (const [label, noise, bursts] of [['보통 잡음', 0.6, 2], ['강한 잡음', 1.0, 4], ['매우 강한 잡음', 1.4, 6]]) {
  for (const [phase, sec, hr] of [['baseline', 35, 72], ['stress', 47, 88], ['recovery', 44, 76]]) {
    const frames = NEW.synthFrames(0, sec * 1000, t => hr + 3 * Math.sin(t / 6000), { fps: 22, seed: Math.round(sec * hr * noise), noise });
    /* 움직임 잡음: 1~2초짜리 구간에 큰 색 흔들림을 넣는다 */
    const marks = Array.from({ length: bursts }, () => rnd() * sec * 1000);
    frames.forEach(f => { if (marks.some(m => f.t >= m && f.t < m + 1200)) { const k = 6 * Math.sin(f.t / 90); f.r += k; f.g += k * 0.8; f.b += k * 0.6; if (f.rr) f.rr = f.rr.map(c => c.map(v => v + k)); } });
    const o = OLD.measureEvidence(frames, 0, sec * 1000), n = NEW.measureEvidence(frames, 0, sec * 1000);
    const pct = v => Math.round((v || 0) * 100), err = e => (e.bpm === null ? '—' : Math.round(Math.abs(e.bpm - hr) * 10) / 10);
    rows.push({ 잡음: label, 구간: phase, '이전 커버리지%': pct(o.coverage), '이전 오차bpm': err(o), '현재 커버리지%': pct(n.coverage), '현재 오차bpm': err(n), 현재상태: n.status });
  }
}
console.table(rows);
fs.rmSync(dir, { recursive: true, force: true });
