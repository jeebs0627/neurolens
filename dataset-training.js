/* 학습 파이프라인 상태 (dataset.html · 06): 불러온 연구 세션의 라벨 등급·적격성 집계, 모델 registry(active/shadow/candidates/history), release policy,
 * 다음 Colab 작업 안내. 값은 기록 그대로이며 정확도 검증이 아니다. 학습 실행 자체는 Colab/로컬 CLI 에서 일어나고 여기서는 결과 파일(registry)만 읽는다.
 * 원자료는 내려받지 않는다(목록의 meta/audit 만 사용). */
(function () {
  'use strict';
  const $ = id => document.getElementById(id), esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const NB = ['01_dataset_audit', '02_train_gaze_residual', '03_train_rppg_quality', '04_release_candidate'];
  const colab = nb => `https://colab.research.google.com/github/jeebs0627/neurolens/blob/main/notebooks/${nb}.ipynb`;
  let state = { rows: [], allowed: false }, registry = null, policy = null, loadError = null;
  const date = v => (v ? new Date(v).toLocaleString('ko-KR') : '미기록');

  /* 세션 1건의 학습 관점 요약 (원자료 없이 meta/audit 만으로) */
  function classify(r) {
    const m = r.meta || {}, a = r.audit || {}, schema = m.schema || 'nl-research-1', kind = m.sessionKind || a.sessionKind || 'condition';
    const labels = a.gazeLabels || null, ref = r.reference_review || a.reference || null;
    const refGrade = !ref ? 'none' : ref.status === 'paired' ? 'paired' : ref.status === 'exploratory' ? 'exploratory' : 'no-overlap';
    const cal = a.gaze?.calibration || null, hasCal = !!cal && cal.errPct != null;
    const reasons = [];
    if (m.demo) reasons.push('demo');
    if (!hasCal) reasons.push('no-calibration');
    if (schema !== 'nl-research-3') reasons.push('legacy-schema:' + schema + ' (표적 구간 backfill · 잔차 보정 미기록)');
    if (!m.subjectKey) reasons.push('no-subject-key (사람 단위 분리 불가)');
    if (a.outcome && a.outcome !== 'complete') reasons.push('outcome:' + a.outcome);
    /* 라벨 수집 세션은 유효 라벨이 있으면 보정 요약(errPct)이 비어 있어도 적격(라벨 창이 지도 자료). 그 밖에는 보정 결과가 있어야 표적 라벨이 있다 */
    const hasLabels = !!(labels && labels.valid > 0);
    if (hasLabels) { const i = reasons.indexOf('no-calibration'); if (i >= 0) reasons.splice(i, 1); }
    const gaze = m.demo ? 'demo' : (hasCal || hasLabels) ? (reasons.some(x => x.startsWith('legacy')) ? 'eligible-legacy-backfill' : 'eligible') : 'unlabeled-only';
    const rppg = m.demo ? 'demo' : refGrade === 'paired' ? 'eligible' : refGrade === 'exploratory' ? 'needs-sync' : 'unlabeled-only';
    return { kind, schema, core: a.versions?.core || m.versions?.core || '?', labels, refGrade, gaze, rppg, reasons, subject: m.subjectKey || null, synthetic: !!m.synthetic, at: r.created_at };
  }
  function aggregate(rows) {
    const C = rows.map(classify).filter(c => !c.synthetic), by = (f) => { const o = {}; C.forEach(c => { const k = f(c); o[k] = (o[k] || 0) + 1; }); return o; };
    return { n: C.length, kind: by(c => c.kind), gaze: by(c => c.gaze), rppg: by(c => c.rppg), schema: by(c => c.schema), core: by(c => c.core), ref: by(c => c.refGrade),
      labelSessions: C.filter(c => c.labels && c.labels.valid).length, labelsValid: C.reduce((s, c) => s + (c.labels?.valid || 0), 0), labelsTrain: C.reduce((s, c) => s + (c.labels?.train || 0), 0), labelsHoldout: C.reduce((s, c) => s + (c.labels?.holdout || 0), 0),
      holdoutBroken: C.filter(c => c.labels && c.labels.holdoutPipelineUnchanged === false).length, subjects: new Set(C.map(c => c.subject).filter(Boolean)).size, noSubject: C.filter(c => !c.subject).length,
      reasons: (() => { const o = {}; C.forEach(c => c.reasons.forEach(x => { o[x] = (o[x] || 0) + 1; })); return o; })(), latest: C.map(c => c.at).filter(Boolean).sort().at(-1) || null, synthetic: rows.length - C.length, rows: C };
  }
  function nextJob(agg) {
    const P = policy?.gaze_residual, R = policy?.rppg_quality;
    const out = [];
    if (!state.allowed) return ['연구 관리자로 로그인하면 불러온 세션 범위의 적격성·라벨 집계가 표시됩니다.'];
    if (!agg.n) return ['불러온 세션이 없습니다. 02 실측 검토에서 서버 새로고침 후 다시 보세요.'];
    const eligible = (agg.gaze.eligible || 0) + (agg.gaze['eligible-legacy-backfill'] || 0), groups = agg.subjects || eligible;
    if (P) {
      if (eligible < P.minTrainGroups + P.minValGroups + P.minLockedTestGroups) out.push(`시선 잔차: 적격 세션 ${eligible}건 · 정책 최소(학습 ${P.minTrainGroups} + 검증 ${P.minValGroups} + 평가 ${P.minLockedTestGroups} 그룹)에 미달 → 다음 Colab 실행은 insufficient_data 로 끝납니다. /condition?mode=gaze-label 수집을 늘리세요.`);
      else out.push(`시선 잔차: 적격 세션 ${eligible}건(그룹 ${groups}) → 01 감사 → 02 학습을 실행할 수 있습니다. 결과가 정책을 통과해야 candidate 가 됩니다.`);
      if (agg.noSubject) out.push(`subjectKey 없는 세션 ${agg.noSubject}건: 세션 단위 분할만 가능. 사람 단위 일반화 주장은 할 수 없습니다.`);
      if (agg.labelsHoldout) out.push(`라벨 수집 최종 holdout 표적 ${agg.labelsHoldout}개(eval_only · 학습 제외 · 보고용)${agg.holdoutBroken ? ` · 평가 블록 중 보정 변경 감지 ${agg.holdoutBroken}건(해당 holdout 무효)` : ''}.`);
    }
    if (R) {
      const paired = agg.rppg.eligible || 0;
      out.push(paired < R.minPairedSessions ? `rPPG 선택기: 검증된(paired) 기준 세션 ${paired}건 < ${R.minPairedSessions} → insufficient_reference_labels. 탐색적(exploratory) ${agg.rppg['needs-sync'] || 0}건은 02 실측 검토에서 동기화 근거를 검증해 paired 로 바꿔야 라벨이 됩니다.` : `rPPG 선택기: paired ${paired}건 → 03 학습 가능.`);
    }
    return out;
  }
  function render() {
    const pane = $('pane-training'); if (!pane) return;
    const agg = aggregate(state.rows);
    const reg = registry, act = reg?.active, sh = reg?.shadow, cands = reg?.candidates || [], hist = reg?.history || [];
    $('trainingInventory').innerHTML = `<h3>불러온 세션의 라벨 등급·적격성 <small class="muted">목록 meta/audit 기준 · 원자료 미열람 · 불러온 범위 한정${agg.synthetic ? ` · 합성 ${agg.synthetic}건 제외` : ''}</small></h3>
      <div class="workflow-counts"><span>세션 <b>${agg.n}</b></span><span>라벨 수집 세션 <b>${agg.labelSessions}</b></span><span>유효 라벨 표적 <b>${agg.labelsValid}</b></span><span>학습 역할 <b>${agg.labelsTrain}</b></span><span>최종 holdout(eval_only) <b>${agg.labelsHoldout}</b></span><span>기준 paired <b>${agg.ref.paired || 0}</b></span><span>기준 exploratory <b>${agg.ref.exploratory || 0}</b></span><span>subjectKey <b>${agg.subjects}</b></span></div>
      <div class="table-wrap"><table><thead><tr><th>과제</th><th>eligible</th><th>eligible (legacy backfill)</th><th>needs-sync</th><th>unlabeled-only</th><th>demo</th></tr></thead><tbody>
      <tr><td>시선 잔차</td><td>${agg.gaze.eligible || 0}</td><td>${agg.gaze['eligible-legacy-backfill'] || 0}</td><td>—</td><td>${agg.gaze['unlabeled-only'] || 0}</td><td>${agg.gaze.demo || 0}</td></tr>
      <tr><td>rPPG 품질 선택기</td><td>${agg.rppg.eligible || 0}</td><td>—</td><td>${agg.rppg['needs-sync'] || 0}</td><td>${agg.rppg['unlabeled-only'] || 0}</td><td>${agg.rppg.demo || 0}</td></tr></tbody></table></div>
      <p class="muted">라벨 출처: explicit_target_confirmed(라벨 수집 모드 · proxy) · calibration_target · free_click_weak(학습·평가 제외) · engine_prediction(정답 아님) · reference_eyetracker 0건. 제외·주의 사유: ${Object.entries(agg.reasons).map(([k, v]) => `${esc(k)} ${v}`).join(' · ') || '없음'}</p>
      <p class="muted">세션 종류 ${esc(JSON.stringify(agg.kind))} · 스키마 ${esc(JSON.stringify(agg.schema))} · core ${esc(JSON.stringify(agg.core))} · 최근 세션 ${esc(date(agg.latest))}</p>`;
    $('trainingNext').innerHTML = `<h3>다음 Colab 작업</h3><ul>${nextJob(agg).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      <p>${NB.map(nb => `<a class="button" target="_blank" rel="noopener" href="${colab(nb)}">${esc(nb)} ↗</a>`).join(' ')}</p>
      <p class="muted">Colab 은 활성 런타임에서만 실행되는 배치입니다(무인 스케줄러·상시 서버 아님). 끊기면 같은 노트북을 다시 열어 이어서 실행합니다. 실행 결과(스냅샷·run 상태·보고서)는 Drive 의 neurolens-training/work 에, 후보 모델은 검토된 commit 으로만 저장소에 들어옵니다.</p>`;
    const entry = (label, e) => e ? `<tr><td>${esc(label)}</td><td><code>${esc(e.id)}</code> v${esc(e.version)}<small>${esc(e.kind)} · ${esc(e.state || label)}</small></td><td>${esc(e.sha256 ? e.sha256.slice(0, 16) + '…' : '—')}</td><td>${esc(e.approvedBy || '—')}<small>${esc(date(e.approvedAt || e.createdAt))}</small></td><td>${e.report ? esc(e.report) : '—'}</td></tr>` : `<tr><td>${esc(label)}</td><td colspan="4" class="muted">없음 — 기존 엔진(In_mind core 파이프라인)이 유일한 시선 추정기</td></tr>`;
    $('trainingRegistry').innerHTML = `<h3>모델 registry <small class="muted">${reg ? `갱신 ${esc(date(reg.updatedAt))} · 정책 ${esc(policy?.version || '?')}` : loadError ? esc(loadError) : '불러오는 중'}</small></h3>
      <div class="table-wrap"><table><thead><tr><th>역할</th><th>모델</th><th>SHA-256</th><th>승인</th><th>보고서</th></tr></thead><tbody>${entry('active', act)}${entry('shadow', sh)}${cands.map(c => entry('candidate', c)).join('')}</tbody></table></div>
      <p class="muted">trained ≠ candidate ≠ active. 승격은 release policy 통과 + shadow 실기기 확인 + 승인된 canary 뒤 사람이 registry 를 수정한 commit 으로만 일어나며, 세션 중에는 바뀌지 않습니다. 해시는 전송 무결성 확인이며 서명 체계는 아직 없습니다(미검증 항목).</p>
      <details><summary>승인·rollback 이력 ${hist.length}건</summary><ul class="notes">${hist.slice().reverse().map(h => `<li><b>${esc(h.event)}</b> · ${esc(date(h.at))} · ${esc(h.actor || '')}<p>${esc(h.reason || h.note || h.id || '')}</p></li>`).join('') || '<li class="muted">없음</li>'}</ul></details>`;
    const lastVal = hist.filter(h => /validated|canary|shadow/.test(h.event)).at(-1);
    $('trainingValidation').innerHTML = `<h3>검증 상태</h3><ul>
      <li>마지막 실측 검증: <b>${lastVal ? esc(date(lastVal.at)) + ' · ' + esc(lastVal.event) : '없음'}</b></li>
      <li>미검증 항목: 실기기 ONNX Runtime Web 로드·지연(desktop/저사양) · 외부 eye tracker 기준 정확도 · 사카드 잠복기/추적 지연 개선 · IBI/HRV(HR-only 기준) · 모델 서명 체계 · Colab 실제 실행(자료 접근 후)</li>
      <li>정책 최소량(시선): 학습 ${policy?.gaze_residual?.minTrainGroups ?? '?'} 그룹 · 검증 ${policy?.gaze_residual?.minValGroups ?? '?'} · 평가 ${policy?.gaze_residual?.minLockedTestGroups ?? '?'} · 창 ${policy?.gaze_residual?.minTrainWindows ?? '?'} · 중앙 오차 개선 ≥ ${policy ? Math.round(policy.gaze_residual.minRelativeGainMedian * 100) : '?'}% · P95 비율 ≤ ${policy?.gaze_residual?.maxP95Ratio ?? '?'} · coverage 감소 ≤ ${policy?.gaze_residual?.maxCoverageDropPp ?? '?'}%p</li>
      <li>정책 최소량(rPPG): paired 세션 ${policy?.rppg_quality?.minPairedSessions ?? '?'} · epoch ${policy?.rppg_quality?.minPairedEpochs ?? '?'} · 동기화 ≤ ${policy?.rppg_quality?.maxSyncUncertaintyMs ?? '?'}ms</li></ul>
      <p class="muted">숫자 임계값은 공학적 초기값이며 임상 기준이 아닙니다. 코드 변경·프롬프트·학습 완료 이벤트는 정확도 검증이 아닙니다.</p>`;
  }
  async function loadFiles() {
    try { const r = await fetch('model-registry.json', { cache: 'no-store' }); if (!r.ok) throw Error('HTTP ' + r.status); registry = await r.json(); if (registry.schema !== 'nl-model-registry-1') throw Error('registry schema'); } catch (e) { loadError = 'registry 불러오기 실패: ' + e.message; }
    try { const r = await fetch('release_policy.json', { cache: 'no-store' }); if (r.ok) policy = await r.json(); } catch (_) {}
    render();
  }
  window.NLDatasetTraining = { update(next) { state = { ...state, ...next }; render(); }, classify, aggregate };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadFiles); else loadFiles();
})();
