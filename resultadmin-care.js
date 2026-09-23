/* Check-in and measurement interpretation shared by the preview and live result. */
(async () => {
  'use strict';
  const $ = id => document.getElementById(id);
  const param = new URLSearchParams(location.search);
  const runId = param.get('run');
  const savedId = param.get('id');
  let run = null;
  if (runId) {
    try { run = JSON.parse(localStorage.getItem('nlAdminRun:' + runId) || 'null'); } catch (_) {}
    if (!run || run.id !== runId || !run.checkin || !run.result) {
      location.replace('indexadmin.html');
      return;
    }
  }
  if (!run && param.get('source')==='live') {
    let record=null;
    try {
      if(savedId){
        if(!window.NLAuth?.enabled || !await NLAuth.getUser())throw Error('로그인이 필요합니다.');
        const row=await NLAuth.getResult(savedId);
        if(!row)throw Error('저장된 결과를 찾을 수 없습니다.');
        record={result:row.result,resultAt:row.created_at,id:row.id,savedId:row.id};
      } else {
        const last=JSON.parse(localStorage.getItem('nlLastResult')||'null');
        if(last?.savedId && window.NLAuth?.enabled){
          if(!await NLAuth.getUser())throw Error('로그인이 필요합니다.');
          const row=await NLAuth.getResult(last.savedId);
          if(!row)throw Error('저장된 결과를 찾을 수 없습니다.');
          record={result:row.result,resultAt:row.created_at,id:row.id,savedId:row.id};
        } else if(last?.result)record={result:last.result,resultAt:last.ts,id:'LOCAL',savedId:null};
      }
      if(!record?.result)throw Error('표시할 검사 결과가 없습니다.');
      /* 사전 체크인 없이 저장된 이전 결과도 같은 리포트 형식으로 보여 주고, 감정 카드만 숨긴다 */
      run={...record,checkin:record.result.__nlCheckin||null,live:true};
    } catch(error){
      document.body.innerHTML='<main style="max-width:600px;margin:15vh auto;padding:28px;font:16px/1.7 sans-serif"><h1>결과를 불러오지 못했습니다</h1><p></p><a href="index.html">메인으로 돌아가기</a></main>';
      document.querySelector('main p').textContent=error.message;return;
    }
  }
  const sampleCheckin = {moods:['excited','anxious'],issue:'career',energy:4,valence1to9:7,expectation:'yes',worry:'yes'};
  const result = run ? run.result : SAMPLE;
  const checkin = run ? run.checkin : sampleCheckin;
  const isSample = !run || !!run.sample;
  if(run?.live || param.get('sample')==='1'){
    document.querySelector('.preview-chip').style.display='none';
    document.querySelector('footer p').textContent=run?.live?'AX오픈랩 · NeuroLens — 검사 결과 리포트':'AX오픈랩 · NeuroLens — 샘플 결과 리포트';
  }
  const hasCheckin = !!checkin;
  let analysis = null;
  if (hasCheckin) {
    try { analysis = NLCarePreview.analyze(checkin,result); }
    catch (error) { $('careAiStatus').textContent='사전 체크인 형식을 확인해 주세요.';console.error(error);return; }
  } else {
    $('emotionCard').hidden = true;
  }
  /* 교차 분석 3종 — 일관성 · 적성×흥미 매트릭스 · 특성 조합 케어 (report-insights.js) */
  let insights = { consistency:null, matrix:null, care:null };
  try {
    insights = NLInsights.renderAll(result, { consistency:$('rConsistency'), matrix:$('rMatrix'), care:$('rTraitCare') });
  } catch (error) { console.error('교차 분석 렌더 실패:', error); }
  if (!insights.consistency) $('rConsistencyCard').hidden = true;
  if (!insights.matrix) $('rMatrixCard').hidden = true;
  if (!insights.care) $('rTraitCareCard').hidden = true;

  const formatDate = date => {const d=new Date(date);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  const addFact = (mount, label, value) => {const chip=document.createElement('span');chip.className='fact';const left=document.createElement('span');left.className='label';left.textContent=label;const right=document.createElement('span');right.className='value';right.textContent=value;chip.append(left,right);mount.appendChild(chip);};
  const text = (id,value) => {$(id).textContent=value;};
  const care = analysis ? analysis.checkin : null;
  const signals = analysis ? analysis.signals : NLCarePreview.normalizeResult(result);
  function renderEmotionScore() {
    if (!care) return;
    const current = Date.now();
    const metric = NLEmotionScore.calculateEmotionScore({
      checkin:care,
      signals,
      checkinAt:run ? (run.createdAt || result.__nlCheckinAt) : current - 60_000,
      resultAt:run ? run.resultAt : current,
      now:current,
    });
    const ready = metric.status === 'ok';
    text('emotionScoreValue',ready ? String(metric.score) : '—');
    text('emotionScoreNote',ready ? '지금 기분의 쾌·불쾌 자기평가' :
      metric.status === 'expired_checkin' ? '지난 체크인 결과입니다. 오늘 다시 체크인해 주세요.' :
      metric.status === 'needs_valence' ? '이전 체크인에는 현재 기분 점수가 없습니다.' :
      '점수 산출에 필요한 체크인 정보를 확인해 주세요.');
    $('emotionIndex').classList.toggle('unavailable',!ready);
  }
  if(!run){
    document.querySelector('.quality').textContent='정보 없음';
    document.querySelector('.hero-copy').textContent='가상 체크인과 샘플 결과로 오늘의 감정 상태 및 성향 리포트 구성을 미리 살펴보세요.';
    text('sampleDay','샘플 결과');
  }

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
    document.querySelector('.hero-badge.sample').textContent=isSample?'SAMPLE · 가상 데이터':'실측 데이터';
    text('sampleDay',hasCheckin?'사전 체크인 연결':'검사 결과');
    text('sampleDate',formatDate(run.resultAt||Date.now()));
    document.querySelector('.hero-meta .meta-row:nth-of-type(3) b').textContent=run.live?'NL-'+String(run.savedId||run.id).slice(0,8).toUpperCase():'ADMIN-'+run.id.slice(0,8).toUpperCase();
    document.querySelector('.hero-meta .meta-row:nth-of-type(4) b').textContent=[name,p['연령대']].filter(Boolean).join(' · ');
    document.querySelector('.quality').textContent=signals.gaze.quality ? ({high:'GOOD',mid:'MID',low:'LOW'})[signals.gaze.quality] : '정보 없음';
    document.querySelector('.hero-copy').textContent=hasCheckin?'검사 전 체크인과 시선행동·설문 결과를 연결했습니다. 오늘의 감정 상태와 성향을 한 리포트에서 살펴보세요.':'시선행동·설문 결과로 나의 성향과 관심 패턴, 세 검사의 일관성과 성향 조합 케어를 살펴보세요.';
    const validTraits=TRAITS.map(trait=>({name:trait.key,value:big[trait.key+'_백분위']==null?NaN:Number(big[trait.key+'_백분위'])})).filter(item=>Number.isFinite(item.value)).sort((a,b)=>b.value-a.value);
    const keywords=document.querySelectorAll('.keyword');
    keywords.forEach((el,index)=>{const item=validTraits[index];el.querySelector('small').textContent=item?'BIG FIVE '+(index+1):'REPORT';el.querySelector('b').textContent=item?`${item.name} ${item.value.toFixed(0)} 백분위`:index===0?'측정된 성향을 살펴보세요':index===1?`유형 ${r.MBTI||'정보 없음'}`:jobs[0]?`직무 후보 ${jobs[0].name}`:'제공된 항목을 확인해 주세요';});
    const intro=`${name} 님의 검사 결과에서 ${r.MBTI?`${r.MBTI} 유형`: '성격 유형 정보'}${validTraits.length?`, ${validTraits[0].name} ${validTraits[0].value.toFixed(0)} 백분위`:''}가 확인되었습니다. 이는 자기이해를 위한 참고 정보입니다.`;
    const second=jobs[0]?`직무적합도 상위 항목은 ${jobs[0].name}(${jobs[0].score.toFixed(1)}점)입니다. 흥미유형과 함께 관심이 향하는 분야를 살펴보세요.`:'직무적합도 정보가 제공되지 않았습니다.';
    const third='오늘의 감정 상태는 검사 전 체크인과 확인된 결과를 교차해 따로 설명합니다. 성격·흥미 결과만으로 현재 감정을 단정하지 않습니다.';
    document.querySelector('.deep-copy .copy-preview').textContent=intro;
    const body=document.querySelector('.deep-copy .copy-body');body.replaceChildren();[intro,second,third].forEach(value=>{const p=document.createElement('p');p.textContent=value;body.appendChild(p);});
  }

  function renderFacts() {
    const mount=$('careCheckinFacts');mount.replaceChildren();
    care.moods.forEach(value=>addFact(mount,'기분',NLCarePreview.MOODS[value]));
    addFact(mount,'고민',NLCarePreview.ISSUES[care.issue]);
    addFact(mount,'컨디션',care.energy+'/5');
    if(care.valence1to9!=null)addFact(mount,'지금 기분',care.valence1to9+'/9');
    addFact(mount,'기대',NLCarePreview.ANSWERS[care.expectation]);
    addFact(mount,'걱정',NLCarePreview.ANSWERS[care.worry]);
    const support=$('careSupport');
    if(signals.screening==='borderline'||signals.screening==='high'){
      support.hidden=false;support.replaceChildren();
      const b=document.createElement('b');b.textContent='전문가와 상의할 수 있는 선택지를 먼저 확인해 주세요.';
      const p=document.createElement('span');p.textContent='명시된 선별 구간은 진단이 아닙니다. 불편감이 이어지거나 일상에 영향을 준다면 전문기관의 평가와 도움을 받는 것이 좋습니다.';
      support.append(b,p);
    }
  }

  function fallbackInterpretation() {
    const moodNames=care.moods.map(value=>NLCarePreview.MOODS[value]).join('·');
    const primary=analysis.primary;
    const first=`지금 ${moodNames} 기분을 느끼고 계시는군요. ${NLCarePreview.ISSUES[care.issue]}에 마음이 쓰이고, 컨디션은 5점 중 ${care.energy}점이라고 답해 주셨어요. 여러 감정이 함께 있어도 괜찮습니다.`;
    const second=primary?`${primary.why} 이것은 현재 상태를 이해하는 하나의 단서이며, 원인이나 진단을 뜻하지 않습니다.`:'제공된 검사 결과에서 이 체크인과 확실히 연결되는 조합은 아직 적습니다. 답변 자체를 출발점으로 삼아 천천히 살펴볼까요?';
    const elevated=signals.screening==='borderline'||signals.screening==='high';
    const pattern=insights.care&&insights.care[0]&&insights.care[0].id!=='balanced'?insights.care[0]:null;
    const third=pattern?`평소 성향에서는 '${pattern.title}'(${pattern.pattern}) 패턴이 보여요. 오늘의 감정을 돌볼 때 아래 성향 조합 케어 처방도 함께 참고해 보세요.`:'';
    return {summary:first+'\n\n'+second+(third?'\n\n'+third:''),direction:elevated?'전문기관이나 믿을 수 있는 사람과 현재 상태를 나눌 선택지를 먼저 살펴보기':primary?primary.direction:'현재 컨디션에 맞는 부담 없는 휴식이나 짧은 기록부터 시작하기',firstStep:elevated?'오늘 믿을 수 있는 사람에게 지금 상태를 한 문장으로 전해볼까요?':care.energy<=2?'오늘은 2분만 쉬면서 몸과 마음의 상태를 한 문장으로 적어볼까요?':'오늘 가능한 작은 행동 하나를 골라 천천히 실천해 볼까요?'};
  }
  function showInterpretation(data,status) {
    const body=$('careAiSummary');body.replaceChildren();String(data.summary||'').split(/\n\s*\n/).filter(Boolean).forEach(value=>{const p=document.createElement('p');p.textContent=value.trim();body.appendChild(p);});
    text('careAiPreview',String(data.summary||'').replace(/\s+/g,' ').trim());
    text('careAiDirection',data.direction||'');text('careAiStep',data.firstStep||'');text('careAiStatus',status);
  }
  let aiRequested=false;
  async function generateInterpretation() {
    if(aiRequested)return;aiRequested=true;
    $('careAiRetry').hidden=true;
    showInterpretation(fallbackInterpretation(),'사전 체크인과 확인된 검사 항목을 조합했습니다. 맞춤 해석을 생성하고 있어요…');
    try{
      const response=await fetch('/api/care-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({checkin:care,signals,matchedIds:analysis.matched.map(item=>item.id),traitPatterns:(insights.care||[]).map(item=>item.id)})});
      if(!response.ok)throw Error(`HTTP ${response.status}`);
      const data=await response.json();
      if(typeof data.summary!=='string'||typeof data.direction!=='string'||typeof data.firstStep!=='string')throw Error('invalid response');
      showInterpretation(data,'Neurolens Generated');
      $('careAiBadge').textContent='✦ Neurolens Generated';
    }catch(error){console.warn('CARE 해석 생성 실패:',error);text('careAiStatus','기본 해설 표시 중 · AI 서비스 연결을 확인해 주세요.');$('careAiRetry').hidden=false;aiRequested=false;}
  }

  async function generateProfileSummary(r){
    const cacheKey='nlProfileSummary:v3:'+(run?.savedId||run?.id||'sample');
    const summary=document.querySelector('.deep-copy');
    const paint=value=>{
      const paragraphs=String(value).split(/\n\s*\n/).map(part=>part.trim()).filter(Boolean);
      summary.querySelector('.copy-preview').textContent=paragraphs.join(' ');
      const body=summary.querySelector('.copy-body');body.replaceChildren();
      paragraphs.forEach(part=>{const p=document.createElement('p');p.textContent=part;body.appendChild(p);});
      $('profileAiBadge').textContent='✦ Neurolens Generated';
      text('profileAiStatus','검사 결과 기반 AI 특징 총평');
    };
    try{
      const cached=sessionStorage.getItem(cacheKey);
      if(cached){paint(cached);return;}
    }catch(_){}
    const big=r.BIG5||{};
    const payload={
      name:r['시험자정보']?.['시험자명']||'',gender:r['시험자정보']?.['성별']||'',age:r['시험자정보']?.['연령대']||'',
      mbti:r.MBTI||'',mbtiName:MBTI_DESC[String(r.MBTI||'').toUpperCase()]?.n||'',
      big5:TRAITS.map(trait=>{const raw=big[trait.key+'_백분위'];const n=raw==null||raw===''?null:Number(raw);return Number.isFinite(n)?n:null;}),
      holland:r['직업흥미유형']?.['유형']||'',hollandName:r['직업흥미유형']?.['유형명']||'',
      jobs:(Array.isArray(r['직무적합도'])?r['직무적합도']:[]).slice(0,5).map(job=>({name:job['직업'],score:Number(job['점수'])})).filter(job=>job.name&&Number.isFinite(job.score)),
      consistency:insights.consistency?{score:insights.consistency.score,label:insights.consistency.level.label,
        axes:insights.consistency.axes.slice(0,10).map(axis=>({pair:axis.pair,verdict:axis.verdict}))}:null,
      matrix:insights.matrix?{core:insights.matrix.quad.core.map(job=>job.name).slice(0,5),skill:insights.matrix.quad.skill.map(job=>job.name).slice(0,5),
        interest:insights.matrix.quad.interest.map(job=>job.name).slice(0,5)}:null,
    };
    text('profileAiStatus','검사 결과 기반 특징 총평을 생성하고 있습니다…');
    try{
      const response=await fetch('/gemini',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      if(!response.ok)throw Error(`HTTP ${response.status}`);
      const data=await response.json();
      if(typeof data.text!=='string'||!data.text.trim())throw Error('빈 응답');
      paint(data.text.trim());
      try{sessionStorage.setItem(cacheKey,data.text.trim());}catch(_){}
      if(runId){run.profileSummary=data.text.trim();localStorage.setItem('nlAdminRun:'+runId,JSON.stringify(run));}
    }catch(error){console.warn('특징 총평 생성 실패:',error);text('profileAiStatus','기본 특징 해설 표시 중 · AI 서비스 연결을 확인해 주세요.');}
  }

  renderReport(result);
  if(hasCheckin){
    renderEmotionScore();
    renderFacts();showInterpretation(fallbackInterpretation(),'사전 체크인과 확인된 검사 항목을 조합했습니다.');
    $('careAiRetry').addEventListener('click',generateInterpretation);
    generateInterpretation();
  }
  generateProfileSummary(result);
  document.querySelectorAll('[data-desktop-open]').forEach(el=>{el.open=!matchMedia('(max-width:680px)').matches;});
  requestAnimationFrame(()=>document.getElementById('result').classList.add('ready'));
  if(run?.live && runId){
    if(care){result.__nlCheckin=care;result.__nlCheckinAt=run.createdAt;}
    const stamp={ts:run.resultAt||Date.now(),savedId:run.savedId||null,result};
    localStorage.setItem('nlLastResult',JSON.stringify(stamp));
    try{
      const user=window.NLAuth?.enabled ? await NLAuth.getUser() : null;
      if(user && !run.savedId){
        const id=await NLAuth.saveResult(result);
        if(id){run.savedId=id;stamp.savedId=id;localStorage.setItem('nlAdminRun:'+runId,JSON.stringify(run));localStorage.setItem('nlLastResult',JSON.stringify(stamp));}
      }
      if(!user && window.NLAuth?.enabled){
        const notice=document.createElement('p');notice.className='guest-notice';
        notice.innerHTML='이 결과는 현재 브라우저에만 보관됩니다. <a href="index.html#signup">가입하고 계정에 저장하기 →</a>';
        document.querySelector('.hero-badges').after(notice);
      }
    }catch(error){console.warn('검사 결과 계정 저장 실패:',error);}
  }
})();
