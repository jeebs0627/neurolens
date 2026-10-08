/* 기존 엔진 baseline 재현 (Node · 저장소 밖 로컬 파일만 읽음 · 네트워크 없음)
 * 세션 JSON(tools/colab export 또는 tools/newbiz_research_export.py 결과)마다 현재 엔진(newbiz-core.js)으로
 *   (a) v3 기록 snapshot 의 최종 개인 모델          → fidelity 'snapshot'
 *   (b) 보정 표본으로 다시 돌린 파이프라인(선택용·최종)  → fidelity 'replayed' (v3 와 함께 있으면 digest 비교로 재현성 보고)
 * 을 만들고, 보정 프레임·과제 프레임·(v3) 라벨 프레임의 프레임별 baseline 예측을 JSON 으로 쓴다.
 * 출력은 engine_prediction 이며 정답이 아니다. 과제 표본의 기록값(rx,ry)은 payload 에 그대로 있으므로 덮어쓰지 않는다.
 * 실행: node tools/colab/baseline_predict.cjs <session.json | dir> --out <dir> [--no-replay] */
'use strict';
const fs = require('fs'), path = require('path');
const A = require('./session_adapter.cjs');
const N = require(path.join(A.ROOT, 'newbiz-core.js'));
const args = process.argv.slice(2), src = args.find(a => !a.startsWith('--')), out = (args.find(a => a.startsWith('--out=')) || '').slice(6) || (args[args.indexOf('--out') + 1] || null);
if (!src || !out) { console.error('usage: node tools/colab/baseline_predict.cjs <session.json|dir> --out <dir> [--no-replay]'); process.exit(2); }
const files = fs.statSync(src).isDirectory() ? fs.readdirSync(src).filter(f => f.endsWith('.json')).map(f => path.join(src, f)) : [src];
fs.mkdirSync(out, { recursive: true });
const summary = [];
for (const file of files) {
  let S;
  try { S = A.loadSession(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (e) { summary.push({ file: path.basename(file), ok: false, error: e.message }); continue; }
  const result = { code: S.code, schema: S.schema, core: S.core, engine: N.VERSION, W: S.W, H: S.H, flags: S.flags, featureSource: S.featureSource, fits: {}, predictions: {} };
  const fits = [];
  if (S.snapshot && S.snapshot.model) {
    const fit = A.modelFromSnapshot(S.snapshot); const d = A.pipelineDigest(fit);
    result.fits.snapshot = { digest: d, recordedFinalDigest: S.digests?.final || null, digestMatchesRecorded: S.digests?.final ? d === S.digests.final : null, note: 'final personal model recorded by the browser (after refit with fine points)' };
    fits.push(['snapshot', fit]);
  }
  if (!args.includes('--no-replay')) {
    try {
      const rp = A.reconstructPipeline(N, S);
      if (rp && rp.ok) {
        result.fits.replaySelection = { digest: A.pipelineDigest(rp.selection), key: rp.selection.key, fineHeldOut: rp.fineHeldOut, stage2: rp.stage2, samples: rp.samples, note: 'candidate chosen on untouched fine points; honest residuals on fine targets come from this fit' };
        result.fits.replayFinal = { digest: A.pipelineDigest(rp.final), refitApplied: rp.refitApplied, matchesRecordedFinal: S.digests?.final ? A.pipelineDigest(rp.final) === S.digests.final : null, matchesRecordedSelection: S.digests?.selection ? A.pipelineDigest(rp.selection) === S.digests.selection : null };
        fits.push(['replaySelection', rp.selection], ['replayFinal', rp.final]);
      } else result.fits.replay = { ok: false, reason: rp ? rp.reason : 'no-targets-or-screen', samples: rp?.samples || null };
    } catch (e) { result.fits.replay = { ok: false, error: String(e.message || e) }; }
  }
  for (const [name, fit] of fits) {
    result.predictions[name] = { calibrationFrames: A.predictFrames(N, fit, S, S.calibrationFrames, { drift: false }), frames: A.predictFrames(N, fit, S, S.frames) };
  }
  /* fidelity: snapshot 과 replay 가 모두 있으면 과제 프레임 예측 일치(중앙값 <3px · p95 <10px)로 재현성을 확인한다. 기록 특징이 양자화돼 계수가 비트 단위로 같지는 않다 */
  if (result.predictions.snapshot && result.predictions.replayFinal) {
    const byT = new Map(result.predictions.replayFinal.frames.map(p => [p.tc, p]));
    const d = result.predictions.snapshot.frames.map(p => { const q = byT.get(p.tc); return q ? Math.hypot(p.bx - q.bx, p.by - q.by) : NaN; }).filter(Number.isFinite).sort((a, b) => a - b);
    result.replayAgreement = d.length ? { frames: d.length, medianPx: d[Math.floor(d.length / 2)], p95Px: d[Math.floor(d.length * .95)] } : null;
  }
  const agree = result.replayAgreement && result.replayAgreement.medianPx < 3 && result.replayAgreement.p95Px < 10;
  result.fidelity = result.fits.snapshot ? (agree ? 'snapshot+replay-verified' : 'snapshot') : result.fits.replaySelection ? 'replayed' : 'unavailable';
  const dest = path.join(out, (S.code || path.basename(file, '.json')) + '.baseline.json');
  fs.writeFileSync(dest, JSON.stringify(result));
  summary.push({ file: path.basename(file), ok: true, fidelity: result.fidelity, fits: Object.keys(result.fits), calibrationFrames: S.calibrationFrames.length, frames: S.frames.length, flags: S.flags });
}
fs.writeFileSync(path.join(out, '_baseline_summary.json'), JSON.stringify({ engine: N.VERSION, generatedAt: new Date().toISOString(), sessions: summary }, null, 2));
console.log(JSON.stringify({ engine: N.VERSION, sessions: summary.length, ok: summary.filter(s => s.ok).length, fidelity: Object.fromEntries(['snapshot+replay-verified', 'snapshot', 'replayed', 'unavailable'].map(k => [k, summary.filter(s => s.fidelity === k).length])) }));
