/* Admin-only check-in × measurement interpretation. No clinical cut-offs are inferred. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NLCarePreview = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const MOODS = { calm:'평온', happy:'행복', joyful:'기쁨', excited:'설렘', thrilled:'신남', anxious:'불안', tense:'긴장', irritable:'짜증', sad:'슬픔', lonely:'외로움', empty:'공허함', depressed:'우울', overwhelmed:'막막함', low:'가라앉음', flat:'무기력' };
  const ISSUES = { relationship:'관계', career:'진로·학업', task:'학업·과업', growth:'자기계발', health:'건강', finance:'재정', change:'변화 적응', none:'아직 모르겠음' };
  const ANSWERS = { yes:'있어요', no:'없어요', unsure:'잘 모르겠어요' };
  const SCORE_KEYS = { O:'개방성', C:'성실성', E:'외향성', A:'친화성', N:'신경성' };
  const RIASEC = 'RIASEC';
  const high = n => n != null && n >= 65;
  const low = n => n != null && n <= 40;
  const lowMood = c => ['low','flat','sad','lonely','empty','depressed','overwhelmed'].some(value=>c.moods.includes(value));
  const mood = (c, ...names) => names.some(name => c.moods.includes(name));
  const lowEnergy = c => c.energy <= 2;
  const elevated = s => s.screening === 'borderline' || s.screening === 'high';

  function number(value) {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
  }
  function first(...values) { return values.find(value => value != null && value !== ''); }
  function level(value) {
    const v = String(value ?? '').trim().toLowerCase();
    if (['high','높음','높음군','위험','위험군'].includes(v)) return 'high';
    if (['low','낮음','낮음군','정상','낮은 구간'].includes(v)) return 'low';
    if (['borderline','경계','경계군','주의'].includes(v)) return 'borderline';
    return null;
  }
  function gazeLevel(value) {
    // Raw gaze scores have no documented cut-offs in the current payload.
    if (typeof value === 'number') return null;
    const v = String(value ?? '').trim().toLowerCase();
    if (['high','good','높음','좋음'].includes(v)) return 'high';
    if (['low','poor','낮음','저하','나쁨'].includes(v)) return 'low';
    if (['mid','medium','보통'].includes(v)) return 'mid';
    return null;
  }
  function normalizeCheckin(raw) {
    if (!raw || !Array.isArray(raw.moods)) return null;
    const moods = [...new Set(raw.moods)].filter(value => Object.hasOwn(MOODS, value));
    const energy = Number(raw.energy);
    const hasValence = raw.valence1to9 != null && raw.valence1to9 !== '';
    const valence = hasValence ? Number(raw.valence1to9) : null;
    const issue = String(raw.issue || '');
    const expectation = String(raw.expectation || '');
    const worry = String(raw.worry || '');
    if (!moods.length || !Object.hasOwn(ISSUES, issue) || !Number.isInteger(energy) || energy < 1 || energy > 5 || !Object.hasOwn(ANSWERS, expectation) || !Object.hasOwn(ANSWERS, worry) || (hasValence && (!Number.isInteger(valence) || valence < 1 || valence > 9))) return null;
    return { moods, issue, energy, expectation, worry, ...(hasValence ? { valence1to9:valence } : {}) };
  }
  function normalizeResult(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const b = r.BIG5 || {};
    const h = r['직업흥미유형'] || {};
    const gaze = r.gazeMetrics || r['시선지표'] || r.gaze || {};
    const screening = r.depressionScreening || r['우울스크리닝'] || r.EARP || r['정서적어려움가능성'] || {};
    const scoreObject = h.scores || h['점수'] || r.RIASEC || {};
    const big5 = {};
    Object.entries(SCORE_KEYS).forEach(([letter, korean]) => { big5[letter] = number(first(b[korean + '_백분위'], b[letter])); });
    const riasec = {};
    [...RIASEC].forEach(letter => { riasec[letter] = number(scoreObject[letter]); });
    const quality = gazeLevel(first(gaze.quality, gaze.trackingQuality, r.trackingQuality, r.measurement?.quality));
    const focus = gazeLevel(first(gaze.focus, gaze.attention, gaze['집중도']));
    const exploration = gazeLevel(first(gaze.exploration, gaze.exploratoryFixation, gaze['탐색응시']));
    const band = level(first(screening.band, screening.level, screening['구간'], screening['수준'], typeof screening === 'string' ? screening : null));
    return { big5, riasec, hollandCode: String(h['유형'] || '').toUpperCase().replace(/[^RIASEC]/g, '').slice(0, 3),
      gaze:{ quality, focus, exploration }, screening:band, screeningUnclassified:!band && first(screening.score, screening['점수'], typeof r.EARP === 'number' ? r.EARP : null) != null,
      mbti:String(r.MBTI || '').toUpperCase().slice(0, 4) };
  }

  // Every rule explicitly lists the measurement fields it needs. Missing fields never become zero.
  const RULES = [
    {id:1,title:'휴식·측정환경 확인',direction:'짧은 휴식과 마이크로 브레이크, 측정 품질이 낮다면 재측정',priority:30,needs:['gazeFocusOrQuality'],when:(c,s)=>lowEnergy(c) && (s.gaze.focus==='low' || s.gaze.quality==='low'),why:'에너지가 낮고 집중 또는 추적 신호도 낮게 나왔습니다. 추적 품질 저하만으로 피로를 단정할 수는 없습니다.'},
    {id:2,title:'작은 실행부터 시작',direction:'과업을 5분 단위로 나누고 완료 기준을 한 가지로 정하기',priority:35,needs:['C'],when:(c,s)=>lowMood(c) && low(s.big5.C) && c.issue==='task',why:'가라앉은 기분, 과업 고민, 상대적으로 낮은 성실성 점수가 함께 있습니다.'},
    {id:3,title:'진로 탐색의 초점 좁히기',direction:'RIASEC 상위 흥미를 기준으로 직무 후보를 2개까지 좁히기',priority:35,needs:['O','E'],when:(c,s)=>high(s.big5.O) && high(s.big5.E) && c.issue==='career',why:'개방성과 외향성이 높고 진로를 고민하고 있습니다. 탐색을 돕되 선택이 어렵다고 단정하지 않습니다.'},
    {id:4,title:'관계 속 감정 돌보기',direction:'감정 기록과 짧은 호흡, 대화 전 마음을 정리할 시간 마련',priority:55,needs:['N'],when:(c,s)=>high(s.big5.N) && mood(c,'anxious','irritable') && c.issue==='relationship',why:'관계 고민, 불안·짜증 자기보고, 높은 신경성 점수가 겹칩니다.'},
    {id:5,title:'관계 에너지 방식 확인',direction:'혼자 회복할 시간과 부담 없는 연결 중 편한 쪽을 선택해 보기',priority:30,needs:['E','S'],when:(c,s)=>low(s.big5.E) && low(s.riasec.S) && c.issue==='relationship',why:'낮은 외향성과 사회형 흥미, 관계 고민이 함께 있습니다. 내향적 선호와 관계 소진은 이 정보만으로 구분할 수 없습니다.'},
    {id:6,title:'성장 에너지 활용',direction:'작은 도전 하나를 골라 실행 가능한 목표로 적기',priority:25,needs:['exploration'],when:(c,s)=>s.gaze.exploration==='high' && c.energy>=4 && c.issue==='growth',why:'높은 에너지와 자기계발 관심, 탐색 응시 신호가 함께 있습니다.'},
    {id:7,title:'변화에 천천히 적응',direction:'변화 내용을 작은 단계로 나누고 예측 가능한 일정을 만들기',priority:40,needs:['O'],when:(c,s)=>low(s.big5.O) && mood(c,'tense') && c.issue==='change',why:'변화 적응 고민과 긴장 자기보고, 낮은 개방성 점수가 겹칩니다.'},
    {id:8,title:'정서적 지원을 우선 살피기',direction:'신뢰할 수 있는 사람이나 전문기관에 상태를 이야기하고 셀프케어는 보조로 활용',priority:90,needs:['screening'],when:(c,s)=>elevated(s) && lowMood(c) && c.energy===1,why:'명시된 선별 경계·높음 구간과 저조한 기분, 매우 낮은 에너지가 함께 있습니다. 진단을 뜻하지 않습니다.'},
    {id:9,title:'오늘의 기분을 가볍게 돌보기',direction:'부담 없는 산책·휴식 등 작은 무드 부스트 시도',priority:25,needs:['screening'],when:(c,s)=>s.screening==='low' && lowMood(c) && c.energy>=3,why:'선별 낮음 구간이면서 현재 기분은 가라앉았고 에너지는 보통 이상입니다. 지속 기간은 알 수 없습니다.'},
    {id:10,title:'원인 탐색부터 시작',direction:'오늘 에너지를 소모한 순간을 한 문장으로 기록하기',priority:30,needs:[],when:c=>c.issue==='none' && lowEnergy(c),why:'에너지가 낮지만 고민 영역을 아직 고르지 않았습니다.'},
    {id:11,title:'기대와 에너지의 속도 맞추기',direction:'하고 싶은 일의 첫 단계를 작게 정하고 휴식 시간을 먼저 확보',priority:35,needs:[],when:c=>c.expectation==='yes' && c.worry==='no' && lowEnergy(c),why:'기대하는 일은 있지만 컨디션은 낮다고 답했습니다.'},
    {id:12,title:'무관심 신호를 함께 살피기',direction:'흥미·기대의 변화를 혼자 판단하지 말고 전문기관과 상의하기',priority:100,needs:['screening'],when:(c,s)=>c.expectation==='no' && c.worry==='no' && elevated(s),why:'기대와 걱정이 없다고 답했고 선별 구간이 경계·높음입니다. 이 정보만으로 무쾌감증을 판단하지 않습니다.'},
    {id:13,title:'전환기 마음 정리',direction:'기대하는 점과 걱정되는 점을 각각 적어 의사결정 기준 만들기',priority:40,needs:[],when:c=>c.expectation==='yes' && c.worry==='yes' && c.issue==='career',why:'진로 고민과 기대·걱정이 동시에 있다고 답했습니다.'},
    {id:14,title:'관계 속 내 몫도 챙기기',direction:'상대에게 해줄 일과 내가 감당할 수 있는 선을 분리해 적기',priority:40,needs:['A'],when:(c,s)=>c.worry==='yes' && c.issue==='relationship' && high(s.big5.A),why:'관계 걱정과 높은 친화성 점수가 함께 있습니다. 과잉 배려 여부는 추가 대화가 필요합니다.'},
    {id:15,title:'과업 기준을 부드럽게 조정',direction:'오늘의 충분한 기준을 먼저 정하고 완료 후 쉬기',priority:40,needs:['C'],when:(c,s)=>c.worry==='yes' && c.issue==='task' && high(s.big5.C),why:'과업 걱정과 높은 성실성 점수가 겹칩니다. 완벽주의라고 단정하지 않습니다.'},
    {id:16,title:'새 도전의 긍정 자원',direction:'궁금한 주제 하나를 짧게 탐구하고 다음 행동 정하기',priority:25,needs:['O','I'],when:(c,s)=>c.expectation==='yes' && high(s.big5.O) && high(s.riasec.I),why:'기대감과 높은 개방성·탐구형 흥미 점수가 함께 있습니다.'},
    {id:17,title:'가벼운 변화로 활력 찾기',direction:'부담 없는 새 자극이나 짧은 활동을 하나 시도',priority:25,needs:['screening'],when:(c,s)=>c.expectation==='no' && c.worry==='no' && lowEnergy(c) && s.screening==='low',why:'기대·걱정이 없고 에너지가 낮지만 선별 구간은 낮음입니다. 12번과 구분해 보조적으로 해석합니다.'},
    {id:18,title:'복합 감정의 속도 조절',direction:'그라운딩과 감정 이름 붙이기로 기대·걱정을 따로 다루기',priority:45,needs:['N'],when:(c,s)=>c.expectation==='yes' && c.worry==='yes' && high(s.big5.N),why:'기대와 걱정이 동시에 있고 신경성 점수가 높습니다.'},
  ];
  const needValue = (key,s) => key==='gazeFocusOrQuality' ? s.gaze.focus != null || s.gaze.quality != null
    : key==='screening' ? s.screening != null
    : key==='exploration' ? s.gaze.exploration != null
    : key==='S' || key==='I' ? s.riasec[key] != null : s.big5[key] != null;

  function analyze(checkinInput, resultInput) {
    const checkin = normalizeCheckin(checkinInput);
    if (!checkin) throw new Error('사전 체크인 응답이 완전하지 않습니다.');
    const signals = normalizeResult(resultInput);
    const all = RULES.map(rule => {
      const missing = rule.needs.filter(key => !needValue(key,signals));
      const matched = !missing.length && !!rule.when(checkin,signals);
      return {id:rule.id,title:rule.title,direction:rule.direction,why:rule.why,priority:rule.priority,matched,missing};
    });
    const matched = all.filter(item => item.matched).sort((a,b) => b.priority-a.priority || a.id-b.id);
    return {checkin,signals,matched,all,primary:matched[0] || null};
  }
  return { MOODS,ISSUES,ANSWERS,RULES,normalizeCheckin,normalizeResult,analyze };
});
