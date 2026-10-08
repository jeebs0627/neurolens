/* 학습·모델 대시보드 (dataset.html · 06)
 * 근거 파일: training-ledger.json(학습 배치 실행마다 비민감 집계 1건) · model-registry.json(active/shadow/candidates/history) · release_policy.json ·
 * 불러온 세션 목록의 meta.gazeModel(검사 시작 시 고정한 모델의 실제 작동 기록) 와 audit.gazeLabels(라벨 수).
 * 원칙: 값은 기록 그대로. ‘개선도’는 같은 정책 아래 같은 지표의 실행 간 변화일 뿐이며 실행 1회면 추세를 말하지 않는다. 오차는 표적 proxy 기준(px) 이고 외부 eye tracker 정확도가 아니다.
 * 원자료는 내려받지 않는다(목록 메타만 사용). 모든 삽입 값은 esc() 로 이스케이프한다. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id), finite = Number.isFinite;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const NB = ['01_dataset_audit', '02_train_gaze_residual', '03_train_rppg_quality', '04_release_candidate'];
  const colab = nb => `https://colab.research.google.com/github/jeebs0627/neurolens/blob/main/notebooks/${nb}.ipynb`;
  const date = v => (v ? new Date(v).toLocaleString('ko-KR') : '미기록'), short = v => (v ? new Date(v).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }) : '—');
  const f1 = v => (finite(v) ? (Math.round(v * 10) / 10).toString() : '—'), pct = v => (finite(v) ? (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%' : '—');
  let state = { rows: [], allowed: false }, registry = null, policy = null, ledger = null, loadError = [];

  /* ---------- 세션 목록 집계 (meta/audit 만) ---------- */
  function classify(r) {
    const m = r.meta || {}, a = r.audit || {}, schema = m.schema || 'nl-research-1', kind = m.sessionKind || a.sessionKind || 'condition';
    const labels = a.gazeLabels || null, ref = r.reference_review || a.reference || null;
    const refGrade = !ref ? 'none' : ref.status === 'paired' ? 'paired' : ref.status === 'exploratory' ? 'exploratory' : 'no-overlap';
    const cal = a.gaze?.calibration || null, hasCal = !!cal && cal.errPct != null, hasLabels = !!(labels && labels.valid > 0);
    const reasons = [];
    if (m.demo) reasons.push('demo');
    if (!hasCal && !hasLabels) reasons.push('no-calibration');
    if (schema !== 'nl-research-3') reasons.push('legacy-schema:' + schema);
    if (!m.subjectKey) reasons.push('no-subject-key');
    if (a.outcome && a.outcome !== 'complete') reasons.push('outcome:' + a.outcome);
    const gaze = m.demo ? 'demo' : (hasCal || hasLabels) ? (schema !== 'nl-research-3' ? 'eligible-legacy-backfill' : 'eligible') : 'unlabeled-only';
    const rppg = m.demo ? 'demo' : refGrade === 'paired' ? 'eligible' : refGrade === 'exploratory' ? 'needs-sync' : 'unlabeled-only';
    const gm = m.gazeModel || null;
    return { kind, schema, core: a.versions?.core || m.versions?.core || '?', labels, refGrade, gaze, rppg, reasons, subject: m.subjectKey || null, synthetic: !!m.synthetic, at: r.created_at, model: gm ? { id: gm.id, mode: gm.mode || 'off', reason: gm.reason, latency: gm.latency?.meanMs ?? null, inferred: gm.inferred || 0, dropped: gm.dropped || 0 } : null };
  }
  function aggregate(rows) {
    const C = rows.map(classify).filter(c => !c.synthetic), by = f => { const o = {}; C.forEach(c => { const k = f(c); o[k] = (o[k] || 0) + 1; }); return o; };
    const withModel = C.filter(c => c.model && c.model.mode !== 'off');
    return { n: C.length, kind: by(c => c.kind), gaze: by(c => c.gaze), rppg: by(c => c.rppg), schema: by(c => c.schema), ref: by(c => c.refGrade), modelMode: by(c => (c.model ? c.model.mode : 'unrecorded')),
      labelSessions: C.filter(c => c.labels && c.labels.valid).length, labelsValid: C.reduce((s, c) => s + (c.labels?.valid || 0), 0), labelsHoldout: C.reduce((s, c) => s + (c.labels?.holdout || 0), 0), subjects: new Set(C.map(c => c.subject).filter(Boolean)).size, noSubject: C.filter(c => !c.subject).length,
      modelSessions: withModel.length, modelLatency: withModel.length ? withModel.reduce((s, c) => s + (c.model.latency || 0), 0) / withModel.length : null, modelInferred: withModel.reduce((s, c) => s + c.model.inferred, 0), modelDropped: withModel.reduce((s, c) => s + c.model.dropped, 0),
      latest: C.map(c => c.at).filter(Boolean).sort().at(-1) || null, synthetic: rows.length - C.length };
  }

  /* ---------- 작은 SVG 차트 (외부 라이브러리 없음) ---------- */
  function lineChart(series, opt = {}) {
    const W = opt.width || 560, H = opt.height || 200, P = { l: 44, r: 12, t: 14, b: 28 };
    const pts = series.flatMap(s => s.values.filter(finite));
    if (!pts.length) return `<div class="chart-empty">${esc(opt.empty || '기록 없음')}</div>`;
    const n = Math.max(...series.map(s => s.values.length)), ymax = Math.max(...pts) * 1.1 || 1, ymin = opt.zero ? 0 : Math.min(...pts) * 0.9;
    const x = i => P.l + (n === 1 ? (W - P.l - P.r) / 2 : i * (W - P.l - P.r) / (n - 1)), y = v => P.t + (H - P.t - P.b) * (1 - (v - ymin) / (ymax - ymin || 1));
    const ticks = [0, .5, 1].map(k => ymin + (ymax - ymin) * k);
    const grid = ticks.map(v => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="#E3E7EE"/><text x="${P.l - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#7C869B">${esc(f1(v))}</text>`).join('');
    const xl = (opt.labels || []).map((l, i) => `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#7C869B">${esc(l)}</text>`).join('');
    const lines = series.map(s => { const d = s.values.map((v, i) => (finite(v) ? `${x(i).toFixed(1)},${y(v).toFixed(1)}` : null)).filter(Boolean); return `<polyline fill="none" stroke="${esc(s.color)}" stroke-width="2" points="${d.join(' ')}"/>` + s.values.map((v, i) => (finite(v) ? `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.5" fill="${esc(s.color)}"><title>${esc(s.name)} · ${esc(f1(v))}</title></circle>` : '')).join(''); }).join('');
    const legend = series.map((s, i) => `<g transform="translate(${P.l + (i % 2) * 260},${H + 4 + Math.floor(i / 2) * 12})"><rect width="10" height="3" y="-7" fill="${esc(s.color)}"/><text x="14" font-size="10" fill="#4A5672">${esc(s.name)}</text></g>`).join('');
    return `<svg viewBox="0 0 ${W} ${H + 30}" width="100%" role="img" aria-label="${esc(opt.aria || '추세 차트')}">${grid}${xl}${lines}${legend}</svg>`;
  }

  /* ---------- 렌더 ---------- */
  function statusCards(agg) {
    const act = registry?.active, sh = registry?.shadow, runs = ledger?.runs || [], last = runs.at(-1);
    const modelState = act ? ['작동 중 (active)', `${act.id} v${act.version}`, 'ok'] : sh ? ['그림자 작동 (shadow)', `${sh.id} v${sh.version} · 출력 기록만, 측정에 미적용`, 'warn'] : ['꺼짐', '등록된 모델 없음 — 기존 엔진(In_mind core 파이프라인)만 사용', 'off'];
    const field = agg.modelSessions ? `${agg.modelSessions}세션에서 모델 추론 기록 (평균 ${f1(agg.modelLatency)}ms · 추론 ${agg.modelInferred} · 건너뜀 ${agg.modelDropped})` : `불러온 ${agg.n}세션 중 모델이 켜진 세션 0 (모드: ${JSON.stringify(agg.modelMode)})`;
    const g = last?.gaze, gate = g?.gate;
    const cards = [
      ['딥러닝 모델 작동 상태', modelState[0], modelState[1], modelState[2]],
      ['현장 작동 기록', agg.modelSessions ? `${agg.modelSessions} 세션` : '0 세션', field, agg.modelSessions ? 'ok' : 'off'],
      ['최근 학습 실행', last ? date(last.at) : '없음', last ? `${g ? g.status : '—'} · 선택 ${g?.chosen || '—'} · gate ${gate ? (gate.pass ? '통과' : '실패: ' + gate.failed.join(', ')) : '—'}` : '학습 배치가 아직 원장을 올리지 않음', last ? (gate?.pass ? 'ok' : 'warn') : 'off'],
      ['학습 데이터', last ? `${last.data.sessions} 세션` : `${agg.n} 세션(목록)`, last ? `적격 ${last.data.eligibleGaze} · 라벨 세션 ${last.data.labelSessions} · 사람 키 ${last.data.subjects} · 기준 심박 paired ${last.data.referencePaired}` : '원장 없음', 'neutral'],
    ];
    return `<div class="dash-cards">${cards.map(([t, v, s, cls]) => `<div class="dash-card ${esc(cls)}"><small>${esc(t)}</small><strong>${esc(v)}</strong><span>${esc(s)}</span></div>`).join('')}</div>`;
  }
  const bestOf = r => { const m = r.gaze.models || {}; const k = r.gaze.chosen && m[r.gaze.chosen] ? r.gaze.chosen : Object.keys(m).find(n => n.startsWith('mlp')) || Object.keys(m)[0]; return k ? { name: k, ...m[k] } : null; };
  function trendSection() {
    const runs = (ledger?.runs || []).filter(r => r.gaze && !r.gaze.synthetic);
    if (!runs.length) return `<h3>개선 추세</h3><p class="muted">학습 실행 기록이 없습니다. Colab/CLI 배치가 끝나면 <code>python -m nlcolab publish-ledger</code> 로 비민감 집계를 원장에 올리고 commit 하면 여기에 쌓입니다.</p>`;
    const labels = runs.map(r => short(r.at));
    const val = lineChart([{ name: '기존 엔진 (val)', color: '#7C88A2', values: runs.map(r => r.gaze.baseline?.val?.medianPx) }, { name: '선택 모델 (val)', color: '#1F4FD8', values: runs.map(r => bestOf(r)?.val?.medianPx) }, { name: '기존 엔진 (locked test)', color: '#B7BFCD', values: runs.map(r => r.gaze.baseline?.lockedTest?.medianPx) }, { name: '선택 모델 (locked test)', color: '#C9577A', values: runs.map(r => bestOf(r)?.lockedTest?.medianPx) }], { labels, zero: true, aria: '실행별 중앙 오차(px)' });
    const data = lineChart([{ name: '세션', color: '#7C88A2', values: runs.map(r => r.data.sessions) }, { name: '적격 세션', color: '#1F4FD8', values: runs.map(r => r.data.eligibleGaze) }, { name: '라벨 수집 세션', color: '#2F9E6A', values: runs.map(r => r.data.labelSessions) }, { name: '사람 키', color: '#C9577A', values: runs.map(r => r.data.subjects) }], { labels, zero: true, aria: '실행별 데이터 규모' });
    const rows = runs.map(r => { const b = bestOf(r), g = r.gaze; const gain = b?.val && g.baseline?.val ? 1 - b.val.medianPx / g.baseline.val.medianPx : NaN, lg = b?.lockedTest && g.baseline?.lockedTest ? 1 - b.lockedTest.medianPx / g.baseline.lockedTest.medianPx : NaN, tg = b?.temporalTest && g.baseline?.temporalTest ? 1 - b.temporalTest.medianPx / g.baseline.temporalTest.medianPx : NaN;
      return `<tr><td>${esc(date(r.at))}<small>${esc((r.snapshot || '').slice(0, 10))} · 정책 ${esc(r.policyVersion || '—')}</small></td><td>${esc(r.data.sessions)} / ${esc(r.data.eligibleGaze)} / ${esc(r.data.labelSessions)} / ${esc(r.data.subjects)}</td><td>${esc(f1(g.baseline?.val?.medianPx))}</td><td>${esc(g.chosen)}<small>${esc(b ? f1(b.val?.medianPx) : '—')} px · ${esc(pct(gain))}</small></td><td>${esc(pct(lg))}<small>${esc(f1(b?.lockedTest?.medianPx))} vs ${esc(f1(g.baseline?.lockedTest?.medianPx))}</small></td><td>${esc(pct(tg))}</td><td>${g.gate ? (g.gate.pass ? '통과' : '실패') : '—'}<small>${esc(g.gate ? g.gate.failed.join(', ') : '')}</small></td><td>${esc(g.status)}${g.candidate ? '<small>' + esc(g.candidate) + '</small>' : ''}</td></tr>`; }).join('');
    const multi = runs.length >= 2;
    return `<h3>개선 추세 <small class="muted">실행 ${esc(runs.length)}회 · 같은 정책 아래 같은 지표의 실행 간 변화만 ‘개선’으로 읽는다${multi ? '' : ' · 실행 1회는 추세가 아니라 기준점'}</small></h3>
      <div class="dash-grid"><div><p class="muted">중앙 오차(px, 작을수록 좋음) — val 은 모델 선택용, locked test 는 학습·선택에 쓰지 않은 세션</p>${val}</div><div><p class="muted">데이터 규모 — 사람 키가 늘어야 사람 단위 평가가 가능하다</p>${data}</div></div>
      <div class="table-wrap"><table><thead><tr><th>실행</th><th>세션 / 적격 / 라벨 / 사람</th><th>기존 엔진 val px</th><th>선택 모델 (val)</th><th>locked test 개선</th><th>temporal 개선</th><th>gate</th><th>상태</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="muted">오차는 보정·라벨 표적 proxy 기준이며 외부 eye tracker 정확도가 아니다. val 개선이 locked/temporal 에서 재현되지 않으면 모델은 등록되지 않는다(정책 ${esc(policy?.version || '')}).</p>`;
  }
  function lastRunDetail() {
    const r = (ledger?.runs || []).filter(x => x.gaze && !x.gaze.synthetic).at(-1); if (!r) return '';
    const g = r.gaze, models = Object.entries(g.models || {});
    const row = (name, m) => m ? `<tr><td>${esc(name)}</td><td>${esc(m.params ?? '—')}</td><td>${esc(f1(m.val?.medianPx))} / ${esc(f1(m.val?.p95Px))}</td><td>${esc(f1(m.lockedTest?.medianPx))} / ${esc(f1(m.lockedTest?.p95Px))}</td><td>${esc(f1(m.temporalTest?.medianPx))} / ${esc(f1(m.temporalTest?.p95Px))}</td><td>${esc(m.val?.byRegion ? Object.entries(m.val.byRegion).map(([k, v]) => `${k} ${f1(v)}`).join(' · ') : '—')}</td><td>${m.parity === undefined ? '—' : m.parity ? 'ok' : '불일치'}</td></tr>` : '';
    const rp = r.rppg;
    return `<h3>최근 실행 상세 <small class="muted">${esc(date(r.at))} · 엔진 ${esc(r.engine || '')} · 분할 ${esc(g.groupKey)} 단위</small></h3>
      <div class="table-wrap"><table><thead><tr><th>모델</th><th>파라미터</th><th>val 중앙/P95 px</th><th>locked 중앙/P95</th><th>temporal 중앙/P95</th><th>val 영역별 중앙</th><th>ONNX parity</th></tr></thead><tbody>${row('기존 엔진 (baseline)', { params: 0, ...g.baseline })}${models.map(([k, m]) => row(k, m)).join('')}</tbody></table></div>
      <div class="workflow-counts">${Object.entries(g.splits || {}).map(([k, v]) => `<span>${esc(k)} <b>${esc(v.groups)}g · ${esc(v.windows)}창 · ${esc(v.records)}</b></span>`).join('')}</div>
      ${g.bootstrap && g.bootstrap.groups ? `<p class="muted">그룹 bootstrap(val) 개선 중앙값 ${esc(pct(g.bootstrap.medianGain))}, 95% CI ${esc(pct(g.bootstrap.ci95[0]))} ~ ${esc(pct(g.bootstrap.ci95[1]))}, 그룹 ${esc(g.bootstrap.groups)}</p>` : ''}
      <p>rPPG 선택기: <b>${esc(rp ? rp.status : '—')}</b>${rp ? ` · paired 세션 ${esc(rp.pairedSessions)} · epoch ${esc(rp.pairedEpochs)} · exploratory 행 ${esc(rp.exploratoryRows)}` : ''}</p>
      ${r.limitations ? `<details><summary>한계·주의</summary><ul>${r.limitations.map(l => `<li>${esc(l)}</li>`).join('')}</ul></details>` : ''}`;
  }
  function registrySection() {
    const reg = registry, act = reg?.active, sh = reg?.shadow, cands = reg?.candidates || [], hist = reg?.history || [];
    const entry = (label, e) => e ? `<tr><td>${esc(label)}</td><td><code>${esc(e.id)}</code> v${esc(e.version)}<small>${esc(e.kind)} · ${esc(e.state || label)}${e.maxState ? ' · 최대 ' + esc(e.maxState) : ''}</small></td><td>${esc(e.sha256 ? e.sha256.slice(0, 16) + '…' : '—')}</td><td>${esc(e.approvedBy || '—')}<small>${esc(date(e.approvedAt || e.createdAt))}</small></td></tr>` : `<tr><td>${esc(label)}</td><td colspan="3" class="muted">없음</td></tr>`;
    return `<h3>모델 registry <small class="muted">${reg ? `갱신 ${esc(date(reg.updatedAt))} · 정책 ${esc(policy?.version || '?')}` : esc(loadError.join(' · ') || '불러오는 중')}</small></h3>
      <div class="table-wrap"><table><thead><tr><th>역할</th><th>모델</th><th>SHA-256</th><th>승인</th></tr></thead><tbody>${entry('active', act)}${entry('shadow', sh)}${cands.map(c => entry('candidate', c)).join('')}</tbody></table></div>
      <p class="muted">trained ≠ candidate ≠ active. 승격은 release policy 통과 + shadow 실기기 확인 + 승인된 canary 뒤 사람이 registry 를 수정한 commit 으로만 일어나며 세션 중에는 바뀌지 않습니다.</p>
      <details><summary>승인·rollback 이력 ${esc(hist.length)}건</summary><ul class="notes">${hist.slice().reverse().map(h => `<li><b>${esc(h.event)}</b> · ${esc(date(h.at))} · ${esc(h.actor || '')}<p>${esc(h.reason || h.note || h.id || '')}</p></li>`).join('') || '<li class="muted">없음</li>'}</ul></details>`;
  }
  function nextSection(agg) {
    const P = policy?.gaze_residual, R = policy?.rppg_quality, last = (ledger?.runs || []).at(-1), out = [];
    if (!state.allowed) out.push('연구 관리자로 로그인하면 불러온 세션 범위의 적격성·라벨·현장 작동 집계가 표시됩니다.');
    if (P) {
      const subjects = last ? last.data.subjects : agg.subjects, labels = last ? last.data.labelSessions : agg.labelSessions;
      if (subjects < 3) out.push(`사람 키 보유 세션 ${subjects}건: 사람 단위 평가가 불가능합니다. 서로 다른 사람 3명 이상이 각자 브라우저에서 /condition?mode=gaze-label 을 진행해야 다음 실행에서 person-disjoint 평가와 prospective holdout 이 생깁니다.`);
      if (labels < P.minValGroups + P.minLockedTestGroups) out.push(`라벨 수집 세션 ${labels}건: 정책 최소(검증 ${P.minValGroups} + 평가 ${P.minLockedTestGroups} 그룹)에 미달.`);
      if (last?.gaze?.gate && !last.gaze.gate.pass) out.push(`최근 실행 gate 실패 항목: ${last.gaze.gate.failed.join(', ')} → 같은 자료로 재실행해도 결과는 같습니다. 자료가 바뀌면 스냅샷이 감지해 재학습합니다.`);
    }
    if (R) { const paired = last ? last.data.referencePaired : (agg.rppg.eligible || 0); out.push(paired < R.minPairedSessions ? `rPPG: 검증된 기준 심박 세션 ${paired} < ${R.minPairedSessions} → insufficient_reference_labels. BLE 장비 연결 또는 기준 CSV+동기화 검증이 필요합니다.` : `rPPG: paired ${paired} → 03 학습 가능.`); }
    return `<h3>다음 작업</h3><ul>${out.map(x => `<li>${esc(x)}</li>`).join('')}</ul><p>${NB.map(nb => `<a class="button" target="_blank" rel="noopener" href="${esc(colab(nb))}">${esc(nb)} ↗</a>`).join(' ')}</p>
      <p class="muted">Colab 은 활성 런타임에서만 실행되는 배치입니다. 배치가 끝나면 <code>publish-ledger</code> 로 원장을 갱신하고 commit 하면 이 화면이 갱신됩니다.</p>`;
  }
  function render() {
    const pane = $('pane-training'); if (!pane) return;
    const agg = aggregate(state.rows);
    $('trainingStatus').innerHTML = statusCards(agg);
    $('trainingTrend').innerHTML = trendSection();
    $('trainingDetail').innerHTML = lastRunDetail();
    $('trainingInventory').innerHTML = `<h3>불러온 세션 집계 <small class="muted">목록 meta/audit 기준 · 원자료 미열람 · 불러온 범위 한정${agg.synthetic ? ` · 합성 ${esc(agg.synthetic)}건 제외` : ''}</small></h3>
      <div class="workflow-counts"><span>세션 <b>${esc(agg.n)}</b></span><span>라벨 수집 세션 <b>${esc(agg.labelSessions)}</b></span><span>유효 라벨 표적 <b>${esc(agg.labelsValid)}</b></span><span>최종 holdout(eval_only) <b>${esc(agg.labelsHoldout)}</b></span><span>기준 paired <b>${esc(agg.ref.paired || 0)}</b></span><span>사람 키 <b>${esc(agg.subjects)}</b></span><span>모델 켜진 세션 <b>${esc(agg.modelSessions)}</b></span></div>
      <div class="table-wrap"><table><thead><tr><th>과제</th><th>eligible</th><th>eligible (legacy backfill)</th><th>needs-sync</th><th>unlabeled-only</th><th>demo</th></tr></thead><tbody>
      <tr><td>시선 잔차</td><td>${esc(agg.gaze.eligible || 0)}</td><td>${esc(agg.gaze['eligible-legacy-backfill'] || 0)}</td><td>—</td><td>${esc(agg.gaze['unlabeled-only'] || 0)}</td><td>${esc(agg.gaze.demo || 0)}</td></tr>
      <tr><td>rPPG 품질 선택기</td><td>${esc(agg.rppg.eligible || 0)}</td><td>—</td><td>${esc(agg.rppg['needs-sync'] || 0)}</td><td>${esc(agg.rppg['unlabeled-only'] || 0)}</td><td>${esc(agg.rppg.demo || 0)}</td></tr></tbody></table></div>
      <p class="muted">세션 종류 ${esc(JSON.stringify(agg.kind))} · 스키마 ${esc(JSON.stringify(agg.schema))} · 모델 모드 ${esc(JSON.stringify(agg.modelMode))} · 최근 세션 ${esc(date(agg.latest))}</p>`;
    $('trainingNext').innerHTML = nextSection(agg);
    $('trainingRegistry').innerHTML = registrySection();
  }
  async function loadFiles() {
    const get = async (url, schema) => { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw Error(url + ' HTTP ' + r.status); const v = await r.json(); if (schema && v.schema !== schema) throw Error(url + ' schema'); return v; };
    try { registry = await get('model-registry.json', 'nl-model-registry-1'); } catch (e) { loadError.push('registry: ' + e.message); }
    try { policy = await get('release_policy.json'); } catch (e) { loadError.push('policy: ' + e.message); }
    try { ledger = await get('training-ledger.json', 'nl-training-ledger-1'); } catch (e) { ledger = null; loadError.push('ledger: ' + e.message); }
    render();
  }
  window.NLDatasetTraining = { update(next) { state = { ...state, ...next }; render(); }, classify, aggregate, lineChart };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadFiles); else loadFiles();
})();
