/* Admin-only live result and care preview. Production result.html is unchanged. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const param = new URLSearchParams(location.search);
  const runId = param.get('run');
  let run = null;
  if (runId) {
    try { run = JSON.parse(localStorage.getItem('nlAdminRun:' + runId) || 'null'); } catch (_) {}
    if (!run || run.id !== runId || !run.checkin || !run.result) {
      location.replace('indexadmin.html');
      return;
    }
  }
  const sampleCheckin = {moods:['excited','anxious'],issue:'career',energy:4,expectation:'yes',worry:'yes'};
  const result = run ? run.result : SAMPLE;
  const checkin = run ? run.checkin : sampleCheckin;
  const isSample = !run || !!run.sample;
  $('careDataType').textContent = isSample ? ' · SAMPLE DATA' : ' · MEASURED DATA';
  let analysis;
  try { analysis = NLCarePreview.analyze(checkin,result); }
  catch (error) { $('careAiStatus').textContent='사전 체크인 형식을 확인해 주세요.';console.error(error);return; }

  const formatDate = date => {const d=new Date(date);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  const addFact = (mount, value) => {const span=document.createElement('span');span.textContent=value;mount.appendChild(span);};
  const text = (id,value) => {$(id).textContent=value;};
  const care = analysis.checkin, signals = analysis.signals;

  function renderReport(r) {
    if (!run) return; // The standalone resultadmin sample is already rendered by its original preview.
    const big = r.BIG5 || {};
    const values = TRAITS.map(trait => {const raw=big[trait.key+'_백분위'];const n=raw==null||raw===''?NaN:Number(raw);return Number.isFinite(n)&&n>=0&&n<=100?n:null;});
    const jobs = (Array.isArray(r['직무적합도'])?r['직무적합도']:[]).map(job=>({name:String(job['직업']||''),score:Number(job['점수'])})).filter(job=>job.name && Number.isFinite(job.score)).sort((a,b)=>b.score-a.score);
    const holland = r['직업흥미유형'] || {};
    const hasCompleteBig5=values.every(value=>value!==null);
    document.getElementById('rBig5').closest('details').hidden=!hasCompleteBig5;
    if(hasCompleteBig5){renderRadar(values);renderBig5Legend(values);renderAdminBig5Insight(values);}
    document.getElementById('rPodium').closest('details').hidden=!jobs.length;
    renderAdminFit(jobs);renderAdminHolland(holland);renderAdminSumTags(r.MBTI,hasCompleteBig5?values:[],jobs,holland);renderAdminMbti(r.MBTI);
    requestAnimationFrame(()=>requestAnimationFrame(()=>{$('result').querySelectorAll('[data-w]').forEach(el=>el.style.width=el.dataset.w);$('result').querySelectorAll('.gauge[data-gv]').forEach(el=>el.style.setProperty('--gv',el.dataset.gv));}));
    const p=r['시험자정보']||{}, name=String(p['시험자명']||'검사자');
    document.querySelector('.hero-badge.sample').textContent=isSample?'SAMPLE · 가상 데이터':'실측 데이터 · 관리자 테스트';
    text('sampleDay','사전 체크인 연결');
    text('sampleDate',formatDate(run.resultAt||Date.now()));
    document.querySelector('.hero-meta .meta-row:nth-of-type(3) b').textContent='ADMIN-'+run.id.slice(0,8).toUpperCase();
    document.querySelector('.hero-meta .meta-row:nth-of-type(4) b').textContent=[name,p['연령대']].filter(Boolean).join(' · ');
    document.querySelector('.quality').textContent=signals.gaze.quality ? ({high:'GOOD',mid:'MID',low:'LOW'})[signals.gaze.quality] : '정보 없음';
    document.querySelector('.hero-copy').textContent='검사 전 체크인과 시선행동·설문 결과를 연결했습니다. REPORT에서 성향을 확인하고 CARE에서 오늘의 감정 상태를 살펴보세요.';
    const validTraits=TRAITS.map((trait,index)=>({name:trait.key,value:Number(big[trait.key+'_백분위'])})).filter(item=>Number.isFinite(item.value)).sort((a,b)=>b.value-a.value);
    const keywords=document.querySelectorAll('.keyword');
    keywords.forEach((el,index)=>{const item=validTraits[index];el.querySelector('small').textContent=item?'BIG FIVE '+(index+1):'REPORT';el.querySelector('b').textContent=item?`${item.name} ${item.value.toFixed(0)} 백분위`:index===0?'측정된 성향을 살펴보세요':index===1?`유형 ${r.MBTI||'정보 없음'}`:jobs[0]?`직무 후보 ${jobs[0].name}`:'제공된 항목을 확인해 주세요';});
    const intro=`${name} 님의 검사 결과에서 ${r.MBTI?`${r.MBTI} 유형`: '성격 유형 정보'}${validTraits.length?`, ${validTraits[0].name} ${validTraits[0].value.toFixed(0)} 백분위`:''}가 확인되었습니다. 이는 자기이해를 위한 참고 정보입니다.`;
    const second=jobs[0]?`직무적합도 상위 항목은 ${jobs[0].name}(${jobs[0].score.toFixed(1)}점)입니다. 흥미유형과 함께 관심이 향하는 분야를 살펴보세요.`:'직무적합도 정보가 제공되지 않았습니다.';
    const third='CARE 영역에서는 검사 전 사전 체크인과 결과를 교차해 오늘의 감정 상태와 웰니스 방향을 따로 설명합니다. 성격·흥미 결과로 현재 감정을 단정하지 않습니다.';
    document.querySelector('.deep-copy .copy-preview').textContent=intro;
    const body=document.querySelector('.deep-copy .copy-body');body.replaceChildren();[intro,second,third].forEach(value=>{const p=document.createElement('p');p.textContent=value;body.appendChild(p);});
  }

  function renderFacts() {
    const pre=$('careCheckinFacts'), meas=$('careMeasureFacts');pre.replaceChildren();meas.replaceChildren();
    addFact(pre,'기분 · '+care.moods.map(value=>NLCarePreview.MOODS[value]).join(' · '));
    addFact(pre,'고민 · '+NLCarePreview.ISSUES[care.issue]);
    addFact(pre,'컨디션 · '+care.energy+'/5');
    addFact(pre,'기대 · '+NLCarePreview.ANSWERS[care.expectation]);
    addFact(pre,'걱정 · '+NLCarePreview.ANSWERS[care.worry]);
    Object.entries({O:'개방성',C:'성실성',E:'외향성',A:'친화성',N:'신경성'}).forEach(([key,label])=>{if(signals.big5[key]!=null)addFact(meas,label+' '+signals.big5[key]);});
    if(signals.hollandCode)addFact(meas,'RIASEC · '+signals.hollandCode);
    for(const key of ['I','S'])if(signals.riasec[key]!=null)addFact(meas,`RIASEC ${key} · ${signals.riasec[key]}`);
    if(signals.gaze.quality)addFact(meas,'추적품질 · '+signals.gaze.quality);
    if(signals.gaze.focus)addFact(meas,'집중 신호 · '+signals.gaze.focus);
    if(signals.gaze.exploration)addFact(meas,'탐색 응시 · '+signals.gaze.exploration);
    if(signals.screening)addFact(meas,'선별 구간 · '+({low:'낮음',borderline:'경계',high:'높음'})[signals.screening]);
    if(signals.screeningUnclassified)addFact(meas,'선별 수치 · 구간 기준 미제공');
    if(!meas.children.length)addFact(meas,'해석 가능한 검사 지표가 없습니다.');
  }

  function renderMatches() {
    const mount=$('careMatched');mount.replaceChildren();
    if (!analysis.matched.length) {
      const item=document.createElement('article');item.className='care-match primary';item.innerHTML='<span class="case-no">교차 조합 없음</span><h3>오늘은 체크인 응답을 중심으로 살펴봅니다</h3><p>제공된 검사 항목으로 확정할 수 있는 교차 신호가 없습니다. 추가 수치를 추정하지 않습니다.</p>';mount.appendChild(item);
    }
    analysis.matched.forEach((item,index)=>{
      const card=document.createElement('article');card.className='care-match'+(index===0?' primary':'');
      const num=document.createElement('span');num.className='case-no';num.textContent=`조합 ${String(item.id).padStart(2,'0')}${index===0?' · 우선 인사이트':''}`;
      const title=document.createElement('h3');title.textContent=item.title;
      const why=document.createElement('p');why.textContent=item.why;
      const direction=document.createElement('strong');direction.textContent='케어 방향 · '+item.direction;
      card.append(num,title,why,direction);mount.appendChild(card);
    });
    const rules=$('careRuleList');rules.replaceChildren();
    const missingLabels={O:'개방성',C:'성실성',E:'외향성',A:'친화성',N:'신경성',I:'RIASEC 탐구형 점수',S:'RIASEC 사회형 점수',gazeFocusOrQuality:'집중·추적 신호',exploration:'탐색 응시',screening:'명시된 선별 구간'};
    analysis.all.forEach(item=>{
      const row=document.createElement('div');row.className='care-rule'+(item.matched?' matched':item.missing.length?' missing':'');
      const no=document.createElement('span');no.className='number';no.textContent=String(item.id).padStart(2,'0');
      const main=document.createElement('div');const title=document.createElement('b');title.textContent=item.title;const why=document.createElement('p');why.textContent=item.why;main.append(title,why);
      const state=document.createElement('span');state.className='state';state.textContent=item.matched?'이번 결과와 일치':item.missing.length?'자료 없음 · '+item.missing.map(key=>missingLabels[key]||key).join(', '):'이번 결과와 불일치';
      row.append(no,main,state);rules.appendChild(row);
    });
    const missing=analysis.all.filter(item=>item.missing.length).length;
    text('careMissingNote',`${analysis.matched.length}개 조합 일치 · ${missing}개 조합은 필요한 측정값 없음`);
    const support=$('careSupport');
    if(signals.screening==='borderline'||signals.screening==='high'){
      support.hidden=false;support.replaceChildren();const b=document.createElement('b');b.textContent='전문가와 상의할 수 있는 선택지를 먼저 확인해 주세요.';const p=document.createElement('span');p.textContent='명시된 선별 구간은 진단이 아닙니다. 불편감이 이어지거나 일상에 영향을 준다면 전문기관의 평가와 도움을 받는 것이 좋습니다.';support.append(b,p);
    }
  }

  function fallbackInterpretation() {
    const moodNames=care.moods.map(value=>NLCarePreview.MOODS[value]).join('·');
    const primary=analysis.primary;
    const first=`지금 ${moodNames} 기분을 느끼고 계시는군요. ${NLCarePreview.ISSUES[care.issue]}에 마음이 쓰이고, 컨디션은 5점 중 ${care.energy}점이라고 답해 주셨어요. 여러 감정이 함께 있어도 괜찮습니다.`;
    const second=primary?`${primary.why} 이것은 현재 상태를 이해하는 하나의 단서이며, 원인이나 진단을 뜻하지 않습니다.`:'제공된 검사 결과에서 이 체크인과 확실히 연결되는 조합은 아직 적습니다. 답변 자체를 출발점으로 삼아 천천히 살펴볼까요?';
    const elevated=signals.screening==='borderline'||signals.screening==='high';
    return {summary:first+'\n\n'+second,direction:elevated?'전문기관이나 믿을 수 있는 사람과 현재 상태를 나눌 선택지를 먼저 살펴보기':primary?primary.direction:'현재 컨디션에 맞는 부담 없는 휴식이나 짧은 기록부터 시작하기',firstStep:elevated?'오늘 믿을 수 있는 사람에게 지금 상태를 한 문장으로 전해볼까요?':care.energy<=2?'오늘은 2분만 쉬면서 몸과 마음의 상태를 한 문장으로 적어볼까요?':'오늘 가능한 작은 행동 하나를 골라 천천히 실천해 볼까요?'};
  }
  function showInterpretation(data,status) {
    const body=$('careAiSummary');body.replaceChildren();String(data.summary||'').split(/\n\s*\n/).filter(Boolean).forEach(value=>{const p=document.createElement('p');p.textContent=value.trim();body.appendChild(p);});
    text('careAiDirection',data.direction||'');text('careAiStep',data.firstStep||'');text('careAiStatus',status);
  }
  let aiRequested=false;
  async function generateInterpretation() {
    if(aiRequested)return;aiRequested=true;
    $('careAiRetry').hidden=true;
    showInterpretation(fallbackInterpretation(),'사전 체크인과 확인된 검사 항목을 조합했습니다. 맞춤 해석을 생성하고 있어요…');
    try{
      const response=await fetch('/api/care-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({checkin:care,signals,matchedIds:analysis.matched.map(item=>item.id)})});
      if(!response.ok)throw Error(`HTTP ${response.status}`);
      const data=await response.json();
      if(typeof data.summary!=='string'||typeof data.direction!=='string'||typeof data.firstStep!=='string')throw Error('invalid response');
      showInterpretation(data,'Neurolens Generated · gemini-3.6-flash');
      $('careAiBadge').textContent='✦ Neurolens Generated';
    }catch(error){console.warn('CARE 해석 생성 실패:',error);text('careAiStatus','기본 해설 표시 중 · AI 서비스 연결을 확인해 주세요.');$('careAiRetry').hidden=false;aiRequested=false;}
  }

  renderReport(result);renderFacts();renderMatches();showInterpretation(fallbackInterpretation(),'사전 체크인과 확인된 검사 항목을 조합했습니다.');
  const tabs=[...document.querySelectorAll('.module-tab')];
  function showModule(module){document.body.classList.toggle('care-active',module==='care');tabs.forEach(tab=>{const active=tab.dataset.target===module;tab.classList.toggle('active',active);if(active)tab.setAttribute('aria-current','page');else tab.removeAttribute('aria-current');});window.scrollTo({top:0,behavior:'instant'});if(module==='care')generateInterpretation();}
  tabs.forEach(tab=>tab.addEventListener('click',()=>showModule(tab.dataset.target)));
  $('careAiRetry').addEventListener('click',generateInterpretation);
  document.querySelector('[data-scroll-care]').addEventListener('click',()=>showModule('care'));
  if(param.get('tab')==='care')showModule('care');
  document.querySelectorAll('[data-desktop-open]').forEach(el=>{el.open=!matchMedia('(max-width:680px)').matches;});
})();
