/* 측정 환경 메모 (데이터 수집 페이지 · condition.html 수집 모드 · dataset 검사별 누적이 함께 쓴다).
 * 검사마다 기기·화면·카메라·조명 같은 조건을 짧게 남겨, 보정 근거와 학습 자료를 조건별로 나눠 볼 수 있게 한다.
 * 값은 이 목록의 키와 선택지만 받고 글자 수를 자른다(로컬 저장소·서버 기록 모두 신뢰하지 않는 입력으로 다룬다) */
(function (root) {
  'use strict';
  const FIELDS = [
    { key: 'device', label: '기기', options: ['데스크톱', '노트북', '태블릿', '스마트폰'] },
    { key: 'screenIn', label: '화면 크기(인치)', number: true },
    { key: 'camera', label: '카메라', options: ['내장 웹캠', '외장 웹캠', '휴대폰 전면'] },
    { key: 'light', label: '조명', options: ['밝은 실내등', '자연광', '어두운 실내', '역광·창가'] },
    { key: 'glasses', label: '안경', options: ['없음', '안경', '콘택트렌즈'] },
    { key: 'posture', label: '자세', options: ['책상에 앉음', '기기 거치대', '손에 듦', '서서'] },
    { key: 'note', label: '메모', text: true, max: 300 },
  ];
  function clean(v) {
    if (!v || typeof v !== 'object') return null;
    const out = {};
    for (const f of FIELDS) {
      const x = v[f.key];
      if (f.number) { const n = Number(x); if (x !== '' && x != null && Number.isFinite(n) && n >= 3 && n <= 120) out[f.key] = Math.round(n * 10) / 10; }
      else if (f.options) { if (f.options.includes(x)) out[f.key] = x; }
      else if (typeof x === 'string' && x.trim()) out[f.key] = x.trim().slice(0, f.max);
    }
    return Object.keys(out).length ? out : null;
  }
  const text = v => { v = clean(v); return v ? FIELDS.filter(f => v[f.key] != null && f.key !== 'note').map(f => f.number ? v[f.key] + '″' : v[f.key]).concat(v.note ? [v.note] : []).join(' · ') : ''; };
  /* 폼 필드 HTML (값은 호출하는 쪽에서 채운다) */
  const formHtml = (idPrefix) => FIELDS.map(f => `<label>${f.label}${f.options ? `<select name="${f.key}" id="${idPrefix}${f.key}"><option value="">선택 안 함</option>${f.options.map(o => `<option>${o}</option>`).join('')}</select>`
    : f.number ? `<input name="${f.key}" id="${idPrefix}${f.key}" type="number" min="3" max="120" step="0.1" inputmode="decimal" placeholder="예: 24">`
    : `<input name="${f.key}" id="${idPrefix}${f.key}" maxlength="${f.max}" placeholder="예: 오후 3시, 창문 왼쪽, 모니터 위 웹캠">`}</label>`).join('');
  const read = form => clean(Object.fromEntries(FIELDS.map(f => [f.key, form.elements[f.key]?.value ?? ''])));
  const fill = (form, v) => { v = clean(v) || {}; FIELDS.forEach(f => { const el = form.elements[f.key]; if (el) el.value = v[f.key] ?? ''; }); };
  const STORE = 'nlCollect:env';
  const load = () => { try { return clean(JSON.parse(localStorage.getItem(STORE) || 'null')); } catch (_) { return null; } };
  const save = v => { try { localStorage.setItem(STORE, JSON.stringify(clean(v))); } catch (_) {} };
  const api = { FIELDS, clean, text, formHtml, read, fill, load, save };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NLCollectEnv = api;
})(typeof window !== 'undefined' ? window : null);
