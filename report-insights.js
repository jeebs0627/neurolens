/* NeuroLens Report Insights — 현재 제공되는 검사 값(MBTI·Big5 백분위·RIASEC 코드·직무적합도)만으로
 * 만드는 교차 분석 3종. 새로운 측정값을 추정하지 않으며 모두 비진단 참고 정보다.
 *   1) consistency  — 세 검사 간 일관성 (MBTI ↔ Big5 ↔ RIASEC ↔ 직무)
 *   2) careerMatrix — 적성(직무적합도) × 흥미(RIASEC) 2×2 매트릭스
 *   3) traitCare    — Big5 특성 조합 기반 케어 처방
 * 브라우저에서는 window.NLInsights, Node 테스트에서는 module.exports 로 쓴다. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NLInsights = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const TRAIT_KEYS = ['개방성', '성실성', '외향성', '친화성', '신경성'];
  const RIASEC_NAME = { R:'현실형', I:'탐구형', A:'예술형', S:'사회형', E:'진취형', C:'관습형' };
  const MARGIN = 10;          // 50 ± 10 백분위는 어느 쪽으로도 단정하지 않는 중간대
  const HIGH = 65, LOW = 40;  // 특성 조합 판단 기준 (care-preview.js 와 동일, 임상 기준 아님)

  function pct(value) {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
  }
  function normalize(r) {
    const src = r && typeof r === 'object' ? r : {};
    const b = src.BIG5 || {};
    const big5 = {};
    TRAIT_KEYS.forEach(key => { big5[key] = pct(b[key + '_백분위']); });
    const mbti = String(src.MBTI || '').toUpperCase().trim();
    const holland = String((src['직업흥미유형'] || {})['유형'] || '').toUpperCase().replace(/[^RIASEC]/g, '').slice(0, 3);
    const jobs = (Array.isArray(src['직무적합도']) ? src['직무적합도'] : [])
      .map(j => ({ name: String((j && j['직업']) || '').trim(), score: Number(j && j['점수']) }))
      .filter(j => j.name && Number.isFinite(j.score))
      .sort((a, b2) => b2.score - a.score);
    return { big5, mbti: /^[EI][NS][TF][JP]$/.test(mbti) ? mbti : '', holland, jobs };
  }

  /* ---------- 직무명 → RIASEC 추정 (키워드 기반 · 표기가 없는 직무는 '미분류') ---------- */
  const JOB_KEYWORDS = [
    ['A', /디자인|디자이너|작가|예술|미술|음악|작곡|연기|배우|영상|PD|피디|크리에이터|카피|광고|콘텐츠|일러스트|사진|애니메이|패션|웹툰|큐레이터|방송/i],
    ['I', /연구|분석|과학|개발자|엔지니어|프로그래머|데이터|의사|약사|수의|통계|AI|인공지능|소프트웨어|개발|화학|생물|물리|수학|기술자|탐구/i],
    ['S', /교사|교육|강사|상담|복지|간호|치료사|코치|HR|인사|보육|사회|케어|돌봄|트레이너|청소년|코디네이터|서비스/i],
    ['E', /마케팅|마케터|영업|경영|기획|창업|관리자|매니저|컨설턴트|전략|CEO|대표|세일즈|MD|머천다이저|홍보|PR|정치|변호사|중개|투자/i],
    ['C', /회계|세무|사무|행정|은행|재무|경리|비서|감사|공무원|법무|총무|품질|관리원|편집|사서|보험|금융|계리/i],
    ['R', /기계|정비|건설|건축|전기|운전|조종|농업|요리|조리|셰프|제빵|목공|용접|설비|현장|소방|경찰|군인|스포츠|운동|항공|선박|제조|기술직/i],
  ];
  function jobRiasec(name) {
    const letters = [];
    JOB_KEYWORDS.forEach(([letter, re]) => { if (re.test(name) && !letters.includes(letter)) letters.push(letter); });
    return letters;
  }

  /* ---------- 1) 세 검사 간 일관성 ---------- */
  // MBTI 네 축은 Big5 요인과 강하게 대응한다 (McCrae & Costa, 1989).
  const MBTI_AXES = [
    { idx:0, trait:'외향성', hi:'E', lo:'I', hiTx:'사람과의 교류에서 에너지를 얻는 편', loTx:'혼자만의 시간에서 에너지를 회복하는 편' },
    { idx:1, trait:'개방성', hi:'N', lo:'S', hiTx:'가능성과 아이디어에 먼저 주목하는 편', loTx:'구체적 사실과 경험을 먼저 살피는 편' },
    { idx:2, trait:'친화성', hi:'F', lo:'T', hiTx:'관계와 가치를 함께 고려해 판단하는 편', loTx:'논리와 기준을 중심으로 판단하는 편' },
    { idx:3, trait:'성실성', hi:'J', lo:'P', hiTx:'계획과 마무리가 분명할 때 편안한 편', loTx:'선택지를 열어 두고 유연하게 움직이는 편' },
  ];
  // RIASEC 흥미와 Big5 의 대표 연관 (Barrick, Mount & Gupta, 2003). R 은 뚜렷한 연관이 없어 제외.
  const HOLLAND_TRAIT = { I:['개방성'], A:['개방성'], S:['외향성','친화성'], E:['외향성'], C:['성실성'] };

  function verdictOf(value, expectHigh) {
    if (value == null) return null;
    if (Math.abs(value - 50) < MARGIN) return 'neutral';
    return (value >= 50) === expectHigh ? 'match' : 'differ';
  }

  function consistency(result) {
    const r = normalize(result);
    const axes = [];
    if (r.mbti) {
      MBTI_AXES.forEach(ax => {
        const letter = r.mbti[ax.idx], value = r.big5[ax.trait];
        const v = verdictOf(value, letter === ax.hi);
        if (!v) return;
        const big5Side = value >= 50 ? ax.hiTx : ax.loTx;
        axes.push({ group:'MBTI × Big5', pair:`${letter} ↔ ${ax.trait}`, left:`MBTI ${letter}`, right:`${ax.trait} ${Math.round(value)}`, verdict:v,
          note: v === 'match' ? `두 검사 모두 '${letter === ax.hi ? ax.hiTx : ax.loTx}'으로 나타났어요.`
              : v === 'neutral' ? `${ax.trait}이 중간대(${Math.round(value)})라 상황에 따라 양쪽 모습이 모두 나타날 수 있어요.`
              : `유형은 ${letter}인데 ${ax.trait} 점수는 '${big5Side}'에 가까워요. 상황에 따라 다르게 드러나는 면일 수 있어요.` });
      });
    }
    [...new Set(r.holland.slice(0, 2))].forEach((letter, i) => {
      (HOLLAND_TRAIT[letter] || []).forEach(trait => {
        const value = r.big5[trait];
        const v = value == null ? null : value >= 50 ? 'match' : value <= LOW ? 'differ' : 'neutral';
        if (!v) return;
        axes.push({ group:'RIASEC × Big5', pair:`${letter} ↔ ${trait}`, left:`${i + 1}순위 흥미 ${letter}·${RIASEC_NAME[letter]}`, right:`${trait} ${Math.round(value)}`, verdict:v,
          note: v === 'match' ? `${RIASEC_NAME[letter]} 흥미와 ${trait} 성향이 같은 방향을 가리켜요.`
              : v === 'neutral' ? `${RIASEC_NAME[letter]} 흥미에 비해 ${trait}은 보통 수준이에요.`
              : `${RIASEC_NAME[letter]} 활동을 좋아하지만 ${trait}은 낮은 편이라, 흥미를 나만의 방식으로 풀어가는 타입일 수 있어요.` });
      });
    });
    if (r.holland && r.jobs.length) {
      const top = r.jobs.slice(0, 3).map(j => ({ ...j, letters: jobRiasec(j.name) })).filter(j => j.letters.length);
      if (top.length) {
        const hit = top.filter(j => j.letters.some(l => r.holland.includes(l)));
        const v = hit.length === top.length ? 'match' : hit.length ? 'neutral' : 'differ';
        axes.push({ group:'RIASEC × 직무', pair:'흥미 ↔ 상위 직무', left:`흥미 ${r.holland}`, right:`상위 직무 ${hit.length}/${top.length} 일치`, verdict:v,
          note: v === 'match' ? '적합도 상위 직무가 모두 흥미 유형과 같은 계열이에요.'
              : v === 'neutral' ? `${hit.map(j => j.name).join('·')}은 흥미와 맞닿고, 나머지는 성향 적합도가 더 크게 작용했어요.`
              : '상위 직무가 흥미 계열과 달라요. 잘할 수 있는 일과 좋아하는 일을 나눠 살펴볼 만해요.' });
      }
    }
    if (!axes.length) return null;
    const count = { match:0, neutral:0, differ:0 };
    axes.forEach(a => { count[a.verdict]++; });
    const score = Math.round((count.match + count.neutral * 0.5) / axes.length * 100);
    const level = score >= 75 ? { key:'clear', label:'뚜렷한 일관성', text:'세 검사가 같은 방향을 가리키고 있어요. 지금 결과는 평소의 나를 비교적 선명하게 보여줍니다.' }
      : score >= 50 ? { key:'mostly', label:'대체로 일관', text:'큰 흐름은 일치하고, 몇몇 영역은 상황에 따라 다르게 드러나요. 다른 부분이 오히려 나를 더 입체적으로 설명해 줍니다.' }
      : { key:'multi', label:'다면적 프로파일', text:'검사마다 다른 모습이 보여요. 역할·환경에 따라 성향을 유연하게 바꿔 쓰는 편일 수 있어요. 재측정으로 추세를 확인해 보세요.' };
    return { score, level, count, axes };
  }

  /* ---------- 2) 적성 × 흥미 2×2 매트릭스 ---------- */
  function careerMatrix(result) {
    const r = normalize(result);
    if (!r.jobs.length || !r.holland) return null;
    const sorted = r.jobs.map(j => j.score).sort((a, b) => a - b);
    const median = sorted[Math.floor((sorted.length - 1) / 2)];
    const weight = letter => { const i = r.holland.indexOf(letter); return i < 0 ? 0 : 3 - i; }; // 1순위 3 · 2순위 2 · 3순위 1
    const quad = { core:[], skill:[], interest:[], later:[] }, unknown = [];
    r.jobs.forEach(j => {
      const letters = jobRiasec(j.name);
      if (!letters.length) { unknown.push(j); return; }
      const w = Math.max(...letters.map(weight));
      const item = { name:j.name, score:j.score, letters, interest:w };
      const fitHigh = j.score >= median, interestHigh = w >= 2;
      quad[fitHigh ? (interestHigh ? 'core' : 'skill') : (interestHigh ? 'interest' : 'later')].push(item);
    });
    if (unknown.length === r.jobs.length) return null;
    return { median, holland:r.holland, quad, unknown };
  }

  /* ---------- 3) 특성 조합 기반 케어 처방 ---------- */
  // 단일 점수가 아니라 두 요인의 '조합'이 일상의 패턴을 더 잘 설명한다는 성격 연구에 기반한 휴리스틱.
  // id 는 api/care-preview.py 의 TRAIT_PATTERNS 와 같아야 한다 (AI 총평에 화이트리스트로 전달).
  const CARE_RULES = [
    { id:'worryDelay', priority:90, when:t => t.N >= HIGH && t.C <= LOW, title:'걱정 → 미루기 고리 끊기',
      pattern:t => `신경성 ${t.N} · 성실성 ${t.C}`, why:'걱정이 커질수록 시작이 늦어지고, 미뤄진 일이 다시 걱정을 키우기 쉬운 조합이에요.',
      routine:{ name:'5분 착수 + 걱정 예약', min:5, steps:['가장 미뤄둔 일을 딱 5분만 시작하기', '떠오르는 걱정은 메모해 두고 저녁 10분 "걱정 시간"에 몰아서 보기'] } },
    { id:'quietStress', priority:85, when:t => t.N >= HIGH && t.E <= LOW, title:'혼자 삭이는 스트레스 풀기',
      pattern:t => `신경성 ${t.N} · 외향성 ${t.E}`, why:'긴장을 잘 느끼지만 밖으로 꺼내기보다 혼자 삭이는 경향이 겹쳐요. 작은 표현 창구가 도움이 돼요.',
      routine:{ name:'감정 한 줄 기록 + 가벼운 연결', min:3, steps:['지금 감정에 이름 붙여 한 줄로 적기', '편한 사람 한 명에게 안부 메시지 하나 보내기'] } },
    { id:'perfectTension', priority:80, when:t => t.N >= HIGH && t.C >= HIGH, title:'완벽주의 긴장 낮추기',
      pattern:t => `신경성 ${t.N} · 성실성 ${t.C}`, why:'높은 기준과 예민함이 함께 있어, 잘 해내면서도 스스로를 몰아붙이기 쉬운 조합이에요.',
      routine:{ name:'"충분한 기준" 정하기', min:3, steps:['오늘 할 일마다 80% 완료 기준을 미리 적기', '끝낸 뒤 나에게 친구처럼 한 문장 건네기'] } },
    { id:'overCare', priority:70, when:t => t.N >= HIGH && t.A >= HIGH, title:'관계 속 내 몫 지키기',
      pattern:t => `신경성 ${t.N} · 친화성 ${t.A}`, why:'상대의 감정에 민감하고 배려가 깊어, 내 마음보다 상대를 먼저 챙기다 지치기 쉬워요.',
      routine:{ name:'경계 문장 연습', min:3, steps:['"오늘은 여기까지 할게요" 같은 문장 하나 정해 두기', '부탁을 받으면 바로 답하지 않고 한 번 호흡하기'] } },
    { id:'ideaFinish', priority:60, when:t => t.O >= HIGH && t.C <= LOW, title:'아이디어를 결과로 잇기',
      pattern:t => `개방성 ${t.O} · 성실성 ${t.C}`, why:'새로운 아이디어는 풍부하지만 마무리까지 가는 에너지는 적게 쓰는 조합이에요.',
      routine:{ name:'마감 체크리스트', min:5, steps:['진행 중인 아이디어 중 하나만 고르기', '"완료"의 모습을 체크리스트 3줄로 적고 첫 줄 끝내기'] } },
    { id:'energyScatter', priority:55, when:t => t.E >= HIGH && t.C <= LOW, title:'흩어지는 에너지 모으기',
      pattern:t => `외향성 ${t.E} · 성실성 ${t.C}`, why:'활동 에너지는 크지만 여러 곳으로 분산되기 쉬운 조합이에요.',
      routine:{ name:'하루 1순위 정하기', min:2, steps:['아침에 오늘 꼭 끝낼 일 1개만 적기', '약속·연락 전에 1순위 진행 여부 확인하기'] } },
    { id:'changeLoad', priority:50, when:t => t.C >= HIGH && t.O <= LOW, title:'변화 부담 줄이기',
      pattern:t => `성실성 ${t.C} · 개방성 ${t.O}`, why:'익숙한 루틴에서 안정감을 얻는 만큼, 갑작스러운 변화에 부담을 느끼기 쉬워요.',
      routine:{ name:'작은 변화 실험', min:5, steps:['일상에서 부담 없는 변화 1개 고르기(새 길로 걷기 등)', '해본 뒤 느낌을 한 줄로 기록하기'] } },
    { id:'innerRecharge', priority:45, when:t => t.E <= LOW && t.O >= HIGH, title:'혼자 몰입하는 회복 시간',
      pattern:t => `외향성 ${t.E} · 개방성 ${t.O}`, why:'사람보다 생각과 탐구 속에서 에너지를 회복하는 조합이에요. 몰입 시간을 의도적으로 지켜주세요.',
      routine:{ name:'15분 몰입 블록', min:15, steps:['알림을 끄고 관심 주제 하나에 15분 몰입하기', '떠오른 생각을 세 줄로 남기기'] } },
    { id:'leadListen', priority:40, when:t => t.E >= HIGH && t.A <= LOW, title:'주도력에 경청 더하기',
      pattern:t => `외향성 ${t.E} · 친화성 ${t.A}`, why:'추진력과 주장이 뚜렷한 조합이라, 의견 충돌이 생길 때 상대의 속도를 챙기면 힘이 더 커져요.',
      routine:{ name:'3초 경청 루틴', min:2, steps:['대화에서 상대 말이 끝난 뒤 3초 기다리기', '"그렇게 생각한 이유가 궁금해요" 한 번 묻기'] } },
    { id:'stableBase', priority:30, when:t => t.N <= LOW && (t.E >= 50 || t.C >= 50), title:'안정 자원 단단히 하기',
      pattern:t => `신경성 ${t.N}` + (t.E >= 50 ? ` · 외향성 ${t.E}` : ` · 성실성 ${t.C}`), why:'정서가 안정적이고 회복 자원이 있는 조합이에요. 지금의 좋은 흐름을 기록으로 굳혀 두세요.',
      routine:{ name:'감사 3줄', min:3, steps:['오늘 좋았던 순간 3가지 적기', '그중 하나를 만든 나의 행동 찾기'] } },
  ];
  const FALLBACK = { id:'balanced', priority:0, title:'균형 잡힌 프로파일 유지하기', pattern:() => '다섯 요인 모두 중간대',
    why:'특정 요인이 두드러지지 않는 고른 프로파일이에요. 상황에 맞춰 유연하게 반응할 수 있는 자원이 됩니다.',
    routine:{ name:'하루 컨디션 한 줄', min:2, steps:['오늘 에너지를 0~10점으로 적기', '점수를 올려준 일 하나를 기억해 두기'] } };

  function traitCare(result) {
    const r = normalize(result);
    const t = { O:r.big5['개방성'], C:r.big5['성실성'], E:r.big5['외향성'], A:r.big5['친화성'], N:r.big5['신경성'] };
    if (Object.values(t).some(v => v == null)) return null;
    Object.keys(t).forEach(k => { t[k] = Math.round(t[k]); });
    const hits = CARE_RULES.filter(rule => rule.when(t)).sort((a, b) => b.priority - a.priority).slice(0, 3);
    const list = hits.length ? hits : [FALLBACK];
    return list.map(rule => ({ id:rule.id, title:rule.title, pattern:rule.pattern(t), why:rule.why, routine:rule.routine }));
  }

  /* ---------- 렌더 (esc 는 report-render.js 공용 함수) ---------- */
  const html = s => (typeof esc === 'function' ? esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]));
  const VERDICT = { match:['일치','ok'], neutral:['중간대','mid'], differ:['다른 면','diff'] };

  function renderConsistency(el, data) {
    if (!el) return;
    if (!data) { el.innerHTML = '<p class="ins-empty">일관성을 비교할 검사 항목이 충분하지 않습니다.</p>'; return; }
    el.innerHTML = `
      <div class="cs-head">
        <div class="cs-score cs-${data.level.key}" style="--cs:${data.score}"><b>${data.score}</b><small>/ 100</small></div>
        <div class="cs-sum"><span class="cs-level">${html(data.level.label)}</span><p>${html(data.level.text)}</p>
          <div class="cs-count"><span class="ok">일치 ${data.count.match}</span><span class="mid">중간대 ${data.count.neutral}</span><span class="diff">다른 면 ${data.count.differ}</span></div></div>
      </div>
      <div class="cs-rows">${data.axes.map(a => `
        <div class="cs-row">
          <span class="cs-group">${html(a.group)}</span>
          <span class="cs-pair"><b>${html(a.left)}</b><i>↔</i><b>${html(a.right)}</b></span>
          <span class="cs-chip ${VERDICT[a.verdict][1]}">${VERDICT[a.verdict][0]}</span>
          <p class="cs-note">${html(a.note)}</p>
        </div>`).join('')}</div>
      <p class="ins-foot">MBTI 네 축과 Big5 요인의 대응(McCrae &amp; Costa), RIASEC 흥미와 Big5의 연관(Barrick 외) 연구를 바탕으로 한 참고 비교입니다. 백분위 40~60은 중간대로 봅니다.</p>`;
  }

  const QUAD = [
    ['core', '핵심 후보', '적성 ↑ · 흥미 ↑', '잘 맞고 좋아하는 일 — 먼저 깊이 탐색해 보세요.'],
    ['skill', '역량 활용형', '적성 ↑ · 흥미 ↓', '성향은 잘 맞지만 흥미는 덜한 일 — 흥미 요소를 더하면 강점이 돼요.'],
    ['interest', '흥미 탐색형', '적성 ↓ · 흥미 ↑', '좋아하지만 적합도는 낮은 일 — 취미·프로젝트로 먼저 경험해 보세요.'],
    ['later', '보류', '적성 ↓ · 흥미 ↓', '지금은 우선순위를 낮춰도 좋은 일이에요.'],
  ];
  function renderMatrix(el, data) {
    if (!el) return;
    if (!data) { el.innerHTML = '<p class="ins-empty">흥미유형 또는 직무 정보가 부족해 매트릭스를 만들 수 없습니다.</p>'; return; }
    const chip = j => `<span class="mx-job"><b>${html(j.name)}</b><small>${j.score.toFixed(1)}점 · ${j.letters.join('')}</small></span>`;
    el.innerHTML = `
      <div class="mx-grid">${[QUAD[0], QUAD[1], QUAD[2], QUAD[3]].map(([k, name, sub, tip]) => `
        <div class="mx-cell mx-${k}">
          <div class="mx-title"><b>${name}</b><small>${sub}</small></div>
          <div class="mx-jobs">${data.quad[k].length ? data.quad[k].map(chip).join('') : '<span class="mx-none">해당 직무 없음</span>'}</div>
          <p class="mx-tip">${tip}</p>
        </div>`).join('')}</div>
      ${data.unknown.length ? `<p class="ins-foot">흥미 계열을 분류하지 못한 직무: ${data.unknown.map(j => html(j.name)).join(', ')}</p>` : ''}
      <p class="ins-foot">적합도는 제공된 직무 중 중앙값(${data.median.toFixed(1)}점) 이상을 '높음'으로, 흥미는 직무 계열이 나의 흥미 코드 ${html(data.holland)}의 1·2순위와 겹치면 '높음'으로 봅니다. 직무 계열은 직무명으로 추정한 참고값입니다.</p>`;
  }

  function renderTraitCare(el, list) {
    if (!el) return;
    if (!list) { el.innerHTML = '<p class="ins-empty">Big5 다섯 요인이 모두 있어야 조합 처방을 만들 수 있습니다.</p>'; return; }
    el.innerHTML = `<div class="tc-grid">${list.map((c, i) => `
      <article class="tc-card${i === 0 ? ' primary' : ''}">
        <div class="tc-top"><span class="tc-no">${i === 0 ? '우선 처방' : '처방 ' + (i + 1)}</span><span class="tc-pattern">${html(c.pattern)}</span></div>
        <h4>${html(c.title)}</h4>
        <p class="tc-why">${html(c.why)}</p>
        <div class="tc-routine"><div class="tc-rname"><b>${html(c.routine.name)}</b><small>${c.routine.min}분</small></div>
          <ol>${c.routine.steps.map(s => `<li>${html(s)}</li>`).join('')}</ol></div>
      </article>`).join('')}</div>
      <p class="ins-foot">두 성격 요인의 조합(백분위 ${HIGH} 이상 높음 · ${LOW} 이하 낮음)으로 고른 비진단 웰니스 루틴입니다. 불편감이 이어지면 전문가와 상의해 주세요.</p>`;
  }

  function renderAll(result, mounts) {
    const data = { consistency:consistency(result), matrix:careerMatrix(result), care:traitCare(result) };
    renderConsistency(mounts.consistency, data.consistency);
    renderMatrix(mounts.matrix, data.matrix);
    renderTraitCare(mounts.care, data.care);
    return data;
  }

  return { jobRiasec, consistency, careerMatrix, traitCare, renderAll, CARE_IDS:CARE_RULES.map(r => r.id).concat(FALLBACK.id) };
});
