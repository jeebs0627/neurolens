/* 검사별 실측 누적 (dataset.html · 05): 불러온 연구 세션의 검사 단계 기록(audit.tests)을 검사마다 모아
 * 세션별 표와 엔진 버전별 요약(중앙값·사분위)을 보여 준다. '이 검사만 실측하기'는 condition.html?lab=<검사> 로 연결된다.
 * 연구 실측(protocol.kind = 'lab', 고른 단계만)과 전체 검사 기록을 함께 쓴다. 값은 저장된 기록 그대로이며 정답 비교가 아니다 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id), finite = Number.isFinite;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TESTS = { calibration: '시선 보정', baseline: '안정 기준선 (심박)', pursuit: '원활 추적', saccade: '사카드', freeview: '정서 보기', pvt: 'PVT 각성', sart: 'SART 지속 주의', stress: '압박 과제 (심박)', recovery: '회복 호흡 (심박)' };
  const q = (a, p) => { const s = a.filter(finite).sort((x, y) => x - y); return s.length ? s[Math.round((s.length - 1) * p)] : null; };
  const f = (v, n = 1) => finite(v) ? (Math.abs(v) >= 100 ? Math.round(v) : +v.toFixed(n)) : '—';
  let state = { rows: [], allowed: false, annotate: null };

  const protocolOf = r => r.audit?.protocol || r.meta?.protocol || {};
  /* 데이터 수집 페이지(datacollection.html)에서 온 기록은 'collect' 로 따로 묶는다 */
  const kindOf = r => (protocolOf(r).collect ? 'collect' : protocolOf(r).kind || 'full');
  /* 측정 환경 메모: dataset 에서 고친 최신 메모(action · event 'env') → 수집 때 적은 메모 순 */
  const envOf = r => [...(r.annotations || [])].reverse().find(n => n.kind === 'action' && n.body?.event === 'env')?.body?.env || protocolOf(r).collect?.env || null;
  const ENV = window.NLCollectEnv;
  const GROUPS = { core: ['엔진 버전', r => coreOf(r)], ...Object.fromEntries((ENV ? ENV.FIELDS.filter(f => f.options) : []).map(f => [f.key, [f.label, r => envOf(r)?.[f.key] || '미기록']])) };
  const coreOf = r => r.audit?.versions?.core || r.meta?.versions?.core || '버전 미기록';
  /* 한 세션의 한 검사에서 뽑는 값: 보정 오차 · 심박(유효 시간·SNR) · 수집 품질 · 지표 */
  function metrics(r, key) {
    const t = r.audit.tests.find(x => x.key === key), a = t.acquisition || {}, out = {};
    if (key === 'calibration') {
      const c = r.audit.gaze?.calibration, sh = c?.shadow;
      out['보정 오차 %'] = c?.errPct;
      /* 그림자 비교: 세로 시선 점수(lookV)를 더한 모델 vs 기본 모델 — 같은 학습 자료, 처음 보는 정밀 보정 점 */
      out['세로 점수 채택'] = c && 'lookV' in c ? (c.lookV ? 1 : 0) : undefined;
      if (c?.shadow2) out['세로 오차 +위·아래 %H'] = c.shadow2.withExtra?.hy;
      if (sh) { out['세로 오차 기본 %H'] = sh.base?.hy; out['세로 오차 +lookV %H'] = sh.withExtra?.hy; out['세로 r 기본'] = sh.base?.ry; out['세로 r +lookV'] = sh.withExtra?.ry; out['전체 오차 기본 %'] = sh.base?.errPct; out['전체 오차 +lookV %'] = sh.withExtra?.errPct; }
    }
    if (t.pulse) { out['심박 bpm'] = t.pulse.bpm; out['SNR dB'] = t.pulse.snr; out['유효 초'] = t.pulse.validSeconds; out['신뢰 반영 초'] = t.pulse.effectiveSeconds; }
    out['카메라 fps'] = a.fps; out['눈 품질'] = a.eyeQuality?.median; out['머리 움직임 p95'] = a.headMotionPctPerSec?.p95;
    (t.indicators || []).forEach(i => { out[i.label + (i.unit ? ` (${i.unit})` : '')] = i.excluded ? { v: i.value, excluded: true, r: i.r } : { v: i.value, r: i.r }; });
    return { status: t.status, values: out };
  }
  const val = x => (x && typeof x === 'object' ? x.v : x);
  const KIND_LABEL = { collect: '데이터 수집', lab: '연구 실측', full: '전체 검사' };

  function render() {
    const pane = $('pane-lab');
    if (!pane) return;
    const key = $('labTest').value, kind = $('labKind').value;
    $('labRun').href = 'condition.html?lab=' + encodeURIComponent(key);
    const [gLabel, groupOf] = GROUPS[$('labGroup').value] || GROUPS.core;
    if (!state.allowed) { $('labSummary').innerHTML = '<p class="muted">연구 관리자로 로그인하면 서버의 실측 기록을 검사별로 모아 보여 줍니다.</p>'; $('labTable').innerHTML = ''; return; }
    const rows = state.rows.filter(r => r.audit?.tests?.some(t => t.key === key && !['off', 'not-started'].includes(t.status)) && (!kind || kindOf(r) === kind))
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    if (!rows.length) { $('labSummary').innerHTML = `<p class="muted">불러온 기록 중 ‘${esc(TESTS[key])}’ 실측이 없습니다. ‘이 검사만 실측하기’로 바로 측정해 누적하세요.</p>`; $('labTable').innerHTML = ''; return; }
    const M = rows.map(r => ({ r, ...metrics(r, key) })), cols = [...new Set(M.flatMap(m => Object.keys(m.values)))];
    /* 묶음별 요약: 엔진 버전(변경 전후) 또는 측정 환경 메모(기기·카메라·조명…)로 같은 검사를 나눠 본다 (세션 수가 적으면 참고만) */
    const byVer = {};
    M.forEach(m => { (byVer[groupOf(m.r)] = byVer[groupOf(m.r)] || []).push(m); });
    const sumHead = `<tr><th>${esc(gLabel)}</th><th>세션</th>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr>`;
    const sumRows = Object.entries(byVer).map(([v, list]) => `<tr><td>${esc(v)}</td><td>${list.length}</td>${cols.map(c => {
      const xs = list.map(m => m.values[c]).filter(x => x && !(typeof x === 'object' && x.excluded)).map(val).filter(finite);
      return `<td>${xs.length ? `${f(q(xs, .5))}<small class="muted"> [${f(q(xs, .25))}~${f(q(xs, .75))}] n${xs.length}</small>` : '—'}</td>`;
    }).join('')}</tr>`).join('');
    $('labSummary').innerHTML = `<h3>${esc(gLabel)}별 요약 <small class="muted">중앙값 [사분위] · 판정 제외 지표는 빼고 집계</small></h3><div class="table-wrap"><table><thead>${sumHead}</thead><tbody>${sumRows}</tbody></table></div>`;
    $('labTable').innerHTML = `<thead><tr><th>측정 시각</th><th>코드</th><th>기록</th><th>측정 환경 메모</th><th>엔진</th><th>상태</th>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${M.map(m => `<tr>
      <td>${esc(m.r.created_at ? new Date(m.r.created_at).toLocaleString('ko-KR') : '—')}</td><td>${esc(m.r.code)}</td><td>${KIND_LABEL[kindOf(m.r)] || '전체 검사'}</td>
      <td class="env-cell">${esc(ENV ? ENV.text(envOf(m.r)) : '') || '<span class="muted">미기록</span>'} ${state.annotate ? `<button type="button" data-env="${esc(m.r.id)}">메모</button>` : ''}</td><td>${esc(coreOf(m.r))}</td><td>${esc(m.status)}</td>
      ${cols.map(c => { const x = m.values[c]; if (x == null) return '<td>—</td>'; const v = val(x);
        return typeof x === 'object' ? `<td${x.excluded ? ' class="muted" title="신뢰도가 낮아 판정에서 제외"' : ''}>${f(v, 2)}${x.excluded ? ' · 제외' : ''}${finite(x.r) ? `<small class="muted"> r${f(x.r, 2)}</small>` : ''}</td>` : `<td>${f(v)}</td>`; }).join('')}</tr>`).join('')}</tbody>`;
  }

  /* 측정 환경 메모 편집: 원래 기록은 두고 dataset 주석(action · event 'env')을 덧붙인다. 가장 최근 메모가 표에 쓰인다 */
  function editEnv(row) {
    const dlg = $('envDialog'), form = $('envEdit');
    $('envDialogCode').textContent = row.code;
    ENV.fill(form, envOf(row));
    form.onsubmit = async e => {
      e.preventDefault();
      if (e.submitter?.value === 'cancel') { dlg.close(); return; }
      const env = ENV.read(form), btn = e.submitter;
      btn.disabled = true;
      try { await state.annotate(row, { event: 'env', env, note: '측정 환경 메모: ' + (ENV.text(env) || '비움') }); dlg.close(); render(); }
      catch (err) { alert('메모를 저장하지 못했습니다: ' + err.message); }
      finally { btn.disabled = false; }
    };
    dlg.showModal();
  }
  function init() {
    $('labTest').innerHTML = Object.entries(TESTS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
    $('labGroup').innerHTML = Object.entries(GROUPS).map(([k, [l]]) => `<option value="${k}">${esc(l)}</option>`).join('');
    if (ENV) $('envEdit').insertAdjacentHTML('afterbegin', ENV.formHtml('envd-'));
    ['labTest', 'labKind', 'labGroup'].forEach(id => { $(id).onchange = render; });
    $('labTable').onclick = e => { const b = e.target.closest('[data-env]'); if (b) editEnv(state.rows.find(r => r.id === b.dataset.env)); };
    render();
  }
  window.NLDatasetLab = { update(next) { state = { ...state, ...next }; render(); }, TESTS };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
