import {Camera} from './camera.js';
import {Store} from './storage.js';
const C=globalThis.NL2,$=id=>document.getElementById(id);
const names={calibration:'시선 맞추기',baseline:'편안한 상태',attention:'정서 주의',disengage:'주의 전환',reward:'보상 선택',preload:'부하 전 기준',load:'짧은 집중',recovery:'회복 관찰',wrap:'마무리'};
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(x,d=1)=>Number.isFinite(x)?x.toFixed(d):'—';
async function hash(text){const buffer=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return [...new Uint8Array(buffer)].map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,24);}
function download(packet){const blob=new Blob([JSON.stringify(packet)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='in-mind-2-'+packet.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function compute(packet){return new Promise((resolve,reject)=>{const worker=new Worker(new URL('./analysis-worker.js',import.meta.url));const timer=setTimeout(()=>{worker.terminate();reject(Error('분석 시간 초과'));},30000);
  worker.onmessage=({data})=>{clearTimeout(timer);worker.terminate();data.error?reject(Error(data.error)):resolve(data.result);};worker.onerror=()=>{clearTimeout(timer);worker.terminate();reject(Error('분석 작업자 오류'));};worker.postMessage({id:packet.id,packet});});}

export async function mount({access,verify,logout}){
  const events=new AbortController(),store=new Store(access.scope);let persist=true,history=[],packet=null,camera=null,running=false,preparing=false,finishing=false,raf=0,sessionStart=0,wallStart=0,lastTick=0,lastQuality=0,renderKey='',activeTrial=null,currentCal=null,currentPhase=null,lastSecond=-1,generation=0,manifest,displayed=null,level=1;
  const on=(node,type,fn)=>node.addEventListener(type,fn,{signal:events.signal});
  try{await store.open();history=await store.list();}catch{$('storage-status').textContent='저장소 사용 불가 · 결과 JSON을 내보내세요';persist=false;}
  manifest=await fetch('/neurolens2/stimuli/manifest.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw Error('자극 목록을 불러오지 못했습니다.');return r.json();});
  $('access-label').textContent=access.mode==='local-owner'?'LOCAL ADMIN':'ADMIN';
  try{$('participant').value=localStorage.getItem('neurolens2-participant-code')||'research-01';}catch{$('participant').value='research-01';}
  function show(id){for(const panel of document.querySelectorAll('.panel'))panel.hidden=panel.id!==id;for(const b of document.querySelectorAll('[data-nav]'))b.classList.toggle('active',b.dataset.nav===id);window.scrollTo(0,0);}
  function status(message,error=false){$('setup-status').textContent=message;$('setup-status').classList.toggle('error',error);}
  function controls(enabled){for(const el of document.querySelectorAll('.topbar button:not(#logout),#start,#demo,#import'))el.disabled=!enabled;}
  async function scopedHistory(){const participant=await hash(access.scope+':'+$('participant').value.trim());return history.filter(h=>h.participant===participant);}
  async function recommendation(){const hs=await scopedHistory(),r=C.recommend(hs);$('recommendation').textContent=$('protocol').value==='first180'?'첫 측정은 주의·전환·보상·회복을 차례로 관찰합니다.':`추천: ${names[r.kind]} · 최근 유효 시행이 적은 축부터 관찰합니다.`;}
  async function preloadImages(form){const paths=[...new Set(manifest.pairs.filter(p=>p.form===form).flatMap(p=>[p.emotion.file,p.neutral.file]))];await Promise.all(paths.map(file=>new Promise((resolve,reject)=>{const img=new Image();const t=setTimeout(()=>reject(Error('자극 준비 시간이 초과되었습니다.')),15000);img.onload=()=>{clearTimeout(t);resolve();};img.onerror=()=>{clearTimeout(t);reject(Error('자극 이미지를 불러오지 못했습니다.'));};img.src='/neurolens2/stimuli/'+file;})));}
  function receive(frame){
    if(!running)return;
    const t=frame.t-sessionStart;if(t<0||t>packet.phases.at(-1).end)return;
    const phase=packet.phases.find(p=>t>=p.start&&t<p.end);if(!phase)return;
    if(packet.frames.length>=12000){finish('aborted','프레임 상한 초과');return;}
    packet.frames.push({...frame,t,phase:phase.id});
    if(phase.kind==='calibration'&&currentCal&&frame.fresh&&frame.face&&!frame.blink&&C.finite(frame.eye)&&t-currentCal.shownAt>450){
      packet.calibrationPoints.push({raw:frame.eye,yaw:frame.yaw,target:currentCal.target,split:currentCal.split,t,point:currentCal.index});
    }
    if(t-lastQuality>500){lastQuality=t;$('frame-count').textContent=String(packet.frames.filter(f=>f.face).length);
      $('quality').textContent=!frame.face?'얼굴 위치를 확인하세요':frame.eyePixels<16?'눈 해상도 부족':Math.abs(frame.yaw)>.15?'정면을 바라보세요':frame.blink?'눈깜박임 제외 중':'영상 관측 중';}
  }
  async function start(){
    if(running||preparing||finishing)return;
    const code=$('participant').value.trim();if(!code){status('연구 참여 코드를 입력하세요.',true);return;}
    const gen=++generation;preparing=true;controls(false);wallStart=performance.now();status('권한과 자극을 준비하고 있습니다…');
    try{
      await verify();if(gen!==generation)return;
      try{localStorage.setItem('neurolens2-participant-code',code);}catch{}
      const hs=await scopedHistory(),behavior=$('behavior-only').checked,protocol=$('protocol').value;
      let focus=$('focus').value==='auto'?C.recommend(hs).kind:$('focus').value;
      if(behavior&&focus==='attention')focus='disengage';
      const form=Math.floor(Date.now()/86400000)%2?'A':'B',seed=crypto.getRandomValues(new Uint32Array(1))[0],phases=C.schedule(protocol,focus);
      await preloadImages(form);if(gen!==generation)return;
      show('session');$('phase-name').textContent='카메라와 모델 준비';$('phase-counter').textContent='PREPARING · 검사 시간에 포함되지 않음';
      $('instruction').textContent='화면 중앙에 얼굴을 두고 준비가 끝날 때까지 기다리세요.';$('remaining').textContent=String(phases.at(-1).end/1000);$('session-progress').max=phases.at(-1).end/1000;$('session-progress').value=0;
      $('task-content').innerHTML='<div><div class="fixation">○</div><h3>측정을 준비합니다</h3><p>카메라 모델과 자극을 먼저 준비합니다.</p></div>';
      $('response-buttons').hidden=true;$('camera-video').hidden=behavior;$('camera-placeholder').hidden=!behavior;$('session-status').textContent='';
      let device={width:0,height:0,fps:0,trackId:'behavior'};
      if(!behavior){camera=new Camera($('camera-video'),receive,message=>{if(running)finish('aborted',message);else status(message,true);});device=await camera.start();}
      if(gen!==generation){camera?.stop();return;}
      const rect=$('stage').getBoundingClientRect(),deviceKey=await hash(JSON.stringify([device.trackId,device.width,device.height,Math.round(device.fps||0),Math.round(rect.width),Math.round(rect.height),navigator.userAgent]));
      if(gen!==generation){camera?.stop();return;}
      packet={schema:C.SCHEMA,engine:C.VERSION,id:crypto.randomUUID(),createdAt:new Date().toISOString(),participant:await hash(access.scope+':'+code),
        protocol,focus,form,seed,deviceKey,device:{width:device.width,height:device.height,fps:device.fps},captureMode:behavior?'behavior':'webcam',origin:'observed',
        status:'aborted',elapsed:0,phases,trials:C.makeTrials(phases,manifest,seed,form),frames:[],calibrationPoints:[],calibration:C.fitCalibration([]),events:[],
        stimuliVersion:manifest.version,stimuliStatus:manifest.status,recommendation:C.recommend(hs),timing:{preparationMs:performance.now()-wallStart,clock:'performance.now; video callback timestamps, not exposure timestamps'}};
      preparing=false;running=true;renderKey='';activeTrial=null;currentCal=null;currentPhase=null;level=1;lastSecond=-1;lastQuality=0;
      sessionStart=performance.now();lastTick=sessionStart;packet.events.push({t:0,type:'start'});status('');raf=requestAnimationFrame(tick);
    }catch(e){camera?.stop();preparing=false;controls(true);show('overview');status(e.message+' 웹캠 없이 테스트하려면 행동 과제 모드를 선택하세요.',true);}
  }
  function tick(now){
    try{advance(now);}catch(e){finish('aborted','화면 처리 오류로 측정을 중단했습니다: '+e.message);}
  }
  function advance(now){
    if(!running)return;
    const {elapsed,phase,finished}=C.sessionPosition(packet.phases,now,sessionStart);packet.elapsed=elapsed;
    if(now-lastTick>1800){finish('aborted','화면 처리 지연으로 시간 연속성이 끊겼습니다.');return;}lastTick=now;
    if(finished){finish('completed','시간 예산 완료');return;}
    if(currentPhase?.id!==phase.id){
      if(currentPhase?.kind==='calibration'){packet.calibration=C.fitCalibration(packet.calibrationPoints);$('cal-grade').textContent=packet.captureMode==='behavior'?'해당 없음':packet.calibration.grade;}
      currentPhase=phase;currentCal=null;activeTrial=null;renderKey='';packet.events.push({t:elapsed,type:'phase',phase:phase.id});
      $('phase-name').textContent=names[phase.kind];$('phase-counter').textContent=`${String(packet.phases.indexOf(phase)+1).padStart(2,'0')} / ${packet.phases.length} · ${packet.captureMode==='behavior'?'BEHAVIOR':'CAMERA + BEHAVIOR'}`;
      $('instruction').textContent=instructions(phase.kind);$('response-buttons').hidden=!['attention','disengage','reward','load'].includes(phase.kind);
    }
    const sec=Math.floor(elapsed/1000);if(sec!==lastSecond){lastSecond=sec;$('remaining').textContent=String(Math.ceil((packet.phases.at(-1).end-elapsed)/1000));$('session-progress').value=elapsed/1000;$('wall-time').textContent=Math.round((now-wallStart)/1000)+'초';}
    renderTask(phase,elapsed);raf=requestAnimationFrame(tick);
  }
  function instructions(kind){return {calibration:'머리를 고정하고 움직이는 점만 눈으로 바라보세요.',baseline:'중앙의 +를 편안하게 바라보세요. 호흡을 억지로 바꾸지 마세요.',preload:'다음 과제 전의 기준 상태를 관찰합니다.',attention:packet.calibration.grade==='G0'?'자연스럽게 두 그림을 보고, 더 눈길이 간 쪽을 선택하세요. 시선 지표는 보류됩니다.':'두 그림을 자연스럽게 바라보세요. 선택 버튼은 누르지 않아도 됩니다.',disengage:'그림을 보다가 반대쪽 원이 나타나면 바라보고 그 방향의 키를 누르세요.',reward:'왼쪽 원 또는 오른쪽 사각형을 골라 보상을 찾아보세요.',load:'계산의 정답이 있는 방향을 누르세요. 난이도가 반응에 맞춰 조절됩니다.',recovery:'중앙의 +를 편안하게 바라보며 쉬세요.',wrap:'이제 수치 기록과 채택 근거를 분석합니다.'}[kind];}
  function renderTask(phase,t){
    if(phase.kind==='calibration'){
      if(packet.captureMode==='behavior'){if(renderKey!=='behavior-cal'){renderKey='behavior-cal';$('task-content').innerHTML='<div><h3>반응 준비</h3><p>← → 키 또는 화면 아래 버튼으로 답합니다.<br>다음 과제의 안내를 따라주세요.</p></div>';$('quality').textContent='카메라 사용 안 함';}return;}
      const i=Math.min(4,Math.floor((t-phase.start)/((phase.end-phase.start)/5))),targets=[.2,.8,.5,.32,.68];
      if(renderKey!=='cal-'+i){renderKey='cal-'+i;currentCal={index:i,target:targets[i],split:i<3?'train':'holdout',shownAt:t};packet.events.push({t,type:'calibration-target',...currentCal});$('task-content').innerHTML=`<span class="target-dot" style="left:${targets[i]*100}%"></span><p class="cal-caption">${i<3?'점 따라보기':'독립 검증점 확인'} · ${i+1} / 5</p>`;}return;
    }
    if(!['attention','disengage','reward','load'].includes(phase.kind)){
      if(renderKey!==phase.kind){renderKey=phase.kind;$('task-content').innerHTML=`<span class="fixation">+</span><p>${phase.kind==='wrap'?'측정이 끝나갑니다.':'중앙을 편안하게 바라보세요.'}</p>`;}return;
    }
    const trial=packet.trials.find(x=>x.phase===phase.id&&t>=x.start&&t<x.end);if(!trial){if(renderKey!=='rest'){renderKey='rest';$('task-content').innerHTML='<span class="fixation">+</span>';}return;}
    const dt=t-trial.start;
    if(activeTrial?.id!==trial.id){activeTrial=trial;trial.enteredAt=t;if(trial.kind==='load'){trial.difficulty=level;trial.a+=level-1;trial.operation=level>=3?'×':'+';trial.answer=trial.operation==='×'?trial.a*trial.b:trial.a+trial.b;trial.correctSide=trial.side;}}
    let state=dt<400?'fix':'stim';if(trial.kind==='disengage'&&dt>=1300)state='target';
    const key=trial.id+'-'+state;if(key===renderKey)return;renderKey=key;
    if(state==='fix'){$('task-content').innerHTML='<span class="fixation">+</span>';return;}
    if(!C.finite(trial.shownAt))trial.shownAt=t;
    const pair=manifest.pairs.find(p=>p.id===trial.pairId),image=file=>'/neurolens2/stimuli/'+encodeURIComponent(file);
    if(trial.kind==='attention'){
      const left=trial.side==='left'?pair.emotion:pair.neutral,right=trial.side==='right'?pair.emotion:pair.neutral;
      $('task-content').innerHTML=`<div class="stim-pair"><img src="${image(left.file)}" alt="왼쪽 과제 이미지" draggable="false"><img src="${image(right.file)}" alt="오른쪽 과제 이미지" draggable="false"></div>`;
    }else if(trial.kind==='disengage'){
      if(state==='target'){trial.targetAt=t;$('task-content').innerHTML=`<span class="target-symbol" style="left:${trial.side==='left'?80:20}%">○</span>`;}
      else $('task-content').innerHTML=`<img class="cue-image ${trial.side}" src="${image(pair.emotion.file)}" alt="바라볼 과제 이미지" draggable="false">`;
    }else if(trial.kind==='reward'){
      trial.targetAt=t;$('task-content').innerHTML='<div class="reward-shapes"><span></span><span></span></div><div class="reward-feedback" id="reward-feedback">어느 쪽을 고를까요?</div>';
    }else{
      trial.targetAt=t;const wrong=trial.answer+(trial.b%2?1:-1)*(level+1),options=trial.correctSide==='left'?[trial.answer,wrong]:[wrong,trial.answer];
      $('task-content').innerHTML=`<div class="math-question">${trial.a} ${trial.operation} ${trial.b} = ?</div><div class="math-options"><span>← ${options[0]}</span><span>${options[1]} →</span></div><p>난이도 ${level}</p>`;
    }
    packet.events.push({t,type:'task-render',trial:trial.id,state});
  }
  function respond(side){
    if(!running||!activeTrial)return;const t=performance.now()-sessionStart,trial=activeTrial;
    if(t>=trial.end||trial.responseAt!==undefined||!C.finite(trial.shownAt)||t<trial.shownAt+100)return;
    if(trial.kind==='disengage'&&(!C.finite(trial.targetAt)||t<trial.targetAt+100))return;
    trial.choice=side;trial.responseAt=t;
    if(trial.kind==='reward'){trial.win=trial.rewardDraw<(side===trial.rich?.7:.3);$('reward-feedback').textContent=trial.win?'보상 +1':'다음 선택을 기다립니다';}
    if(trial.kind==='disengage')trial.correct=side!==(trial.side);
    if(trial.kind==='load'){trial.correct=side===trial.correctSide;if(trial.correct&&t-trial.targetAt<1800)level=Math.min(5,level+1);else if(!trial.correct)level=Math.max(1,level-1);}
    packet.events.push({t,type:'response',trial:trial.id,side});
  }
  async function finish(outcome,reason){
    if(finishing)return;
    ++generation;
    if(preparing){preparing=false;camera?.stop();controls(true);show('overview');status('측정 준비를 취소했습니다.');return;}
    if(!running)return;
    running=false;finishing=true;cancelAnimationFrame(raf);camera?.stop();activeTrial=null;currentCal=null;
    packet.elapsed=Math.min(performance.now()-sessionStart,packet.phases.at(-1).end);packet.status=outcome;packet.stopReason=reason;
    packet.timing.totalMs=performance.now()-wallStart;packet.events.push({t:packet.elapsed,type:outcome,reason});packet.calibration=C.fitCalibration(packet.calibrationPoints);
    $('response-buttons').hidden=true;$('phase-name').textContent='관측 근거 분석 중';$('task-content').innerHTML='<div><h3>관측 근거를 연결하고 있습니다</h3><p>시선 교정, 독립 시간 창, 시행별 반응을 확인합니다.</p></div>';
    try{packet.result=await compute(packet);await save(packet);renderResults(packet);}catch(e){$('session-status').textContent='분석 실패: '+e.message;const b=document.createElement('button');b.className='secondary';b.textContent='수치 기록 내보내기';b.onclick=()=>download(packet);$('session-status').append(b);}
    finally{finishing=false;controls(true);}
  }
  async function save(p){if(persist){try{await store.put(p);}catch{persist=false;$('storage-status').textContent='저장 실패 · JSON을 내보내세요';}}history=[p,...history.filter(h=>h.id!==p.id)];}
  function renderResults(p){
    displayed=p;show('results');const r=p.result,trend=C.longitudinal(p,history),sourceLabel={gaze:'시선',behavior:'행동','camera-rgb':'영상 RGB'};
    const usable=r.features.filter(f=>f.usable).length,valid=r.windows.filter(w=>w.bpm!==null);
    $('results').innerHTML=`<div class="results-head"><div><p class="eyebrow">SESSION / ${esc(p.createdAt.slice(0,10))}</p><h1>이번 관측의 결과</h1><p>${p.origin==='synthetic'?'합성 신호로 실행한 엔진 검증입니다. 실제 사람의 결과가 아닙니다.':p.origin==='imported'?'가져온 기록에서 다시 계산했습니다. 개인 기준선에는 반영하지 않습니다.':'나를 이해하기 위한 반복 관측의 한 지점입니다.'}</p><div class="badge-line"><span class="tag ${p.origin!=='observed'?'badge-warn':''}">${esc(p.origin.toUpperCase())}</span><span class="tag">${p.status==='completed'?'시간 예산 완료':'중단된 측정'}</span><span class="tag">${esc(p.protocol)} / ${esc(p.form)}</span></div></div><div class="actions"><button id="export-result" class="secondary">기록 내보내기</button><button id="new-session" class="secondary">새 측정</button></div></div>
      ${p.status==='aborted'?`<div class="note">중단 사유: ${esc(p.stopReason)}. 개인 기준선에는 포함되지 않습니다.</div>`:''}
      <div class="summary-strip"><div><strong>${esc(p.calibration.grade)}</strong><p>시선 검증 등급 · 오차 ${fmt(p.calibration.error===null?null:p.calibration.error*100)}%p</p></div><div><strong>${usable}개 지표</strong><p>최소 관측 기준을 통과한 탐색 지표</p></div><div><strong>${fmt(p.elapsed/1000,0)}초</strong><p>검사 / 준비 ${fmt(p.timing?.preparationMs/1000,0)}초 별도</p></div></div>
      <div class="note">${p.captureMode==='behavior'?'행동 관찰 모드입니다. 시선·생리 지표는 산출하지 않습니다. ':''}정서 자극의 타당도와 임상적 관련성은 아직 검증되지 않았습니다. 아래 값은 과제에서 관찰한 반응이며 불안·우울·자아탄력성의 진단 점수가 아닙니다.${r.qualityFlags.length?' 중앙 주시 검증에서 편향이 감지되어 이후 시선 지표를 보류했습니다.':''}</div>
      <div class="feature-grid">${r.features.map(f=>`<section class="card feature-card"><h3>${esc(f.label)}</h3><div class="feature-value">${f.usable?fmt(f.value,f.unit==='ms'?0:1):'보류'}<small>${f.usable?esc(f.unit):''}</small></div><p>${f.usable&&f.interval?`시행 간 변동 구간 ${fmt(Math.max(f.unit==='%'?0:-Infinity,f.interval[0]))}–${fmt(Math.min(f.unit==='%'?100:Infinity,f.interval[1]))} ${esc(f.unit)}`:'수치의 해석은 반복 관측 후 검토합니다.'}</p><p>유효 ${f.n} ${f.id==='pulse'?'창':'시행'} · ${esc(f.reason)}</p><span class="tag">${sourceLabel[f.source]}</span></section>`).join('')}</div>
      <section class="results-section card"><h2>부하 후 회복</h2><div class="feature-value">${r.recovery.value===null?'보류':fmt(r.recovery.value)}<small>${r.recovery.value===null?'':'%'}</small></div><p>${esc(r.recovery.reason)}</p>${pulseChart(r.windows)}<p class="hint">12초 창은 서로 겹치지 않고 단계 경계를 넘지 않습니다. 회복률은 상승량이 후보 오차보다 클 때만 잠정 산출합니다. 회복 속도를 성격이나 자아탄력성으로 바꾸지 않습니다.</p></section>
      <section class="results-section"><h2>나의 이전 관측과 비교</h2><p>${esc(trend.rule)}</p>${trend.days<3?`<div class="empty">비교 가능한 이전 날짜 ${trend.days}일 / 최소 3일<br>지금은 개인 기준선을 모으는 단계입니다.</div>`:`<div class="table-wrap"><table><thead><tr><th>지표</th><th>초기 기준</th><th>최근 기준</th><th>이번 차이</th><th>관찰</th></tr></thead><tbody>${trend.changes.map(c=>`<tr><td>${esc(c.label)}</td><td>${fmt(c.baseline)} ${esc(c.unit)}</td><td>${fmt(c.rolling)} ${esc(c.unit)}</td><td>${fmt(c.difference)} ${esc(c.unit)}</td><td>${esc(c.flag)} · ${c.n}일</td></tr>`).join('')}</tbody></table></div>`}</section>
      <section class="results-section"><h2>측정 근거와 채택 이력</h2><p>유효 심박 창 ${valid.length} / ${r.windows.length} · 관측 종류 ${r.evidence.independentModalities} · ${esc(r.evidence.note)}</p><div class="table-wrap"><table><thead><tr><th>단계 / 시간</th><th>채택 후보</th><th>공간 지지</th><th>채택·보류 이유</th></tr></thead><tbody>${r.windows.map(w=>`<tr><td>${esc(names[w.phase]||w.phase)}<br>${w.start/1000}–${w.end/1000}초</td><td>${w.bpm===null?'보류':fmt(w.bpm)+' ± '+fmt(w.halfWidth)+' bpm'}</td><td>${w.adopted.length} ROI / 카메라 1개</td><td>${esc(w.reason)}${w.candidates.length?`<details><summary>후보 ${w.candidates.length}개 추적</summary>${w.candidates.map(c=>`<p>${esc(c.roi)} · ${c.method}: ${fmt(c.bpm)} bpm / 실제 ${c.observedFrames}프레임 / ${c.eligible?'품질 통과':'보류'}<br><small>${esc(c.parent)}</small></p>`).join('')}</details>`:''}</td></tr>`).join('')||'<tr><td colspan="4">유효 길이의 영상 창이 없습니다.</td></tr>'}</tbody></table></div><p class="hint">± 값은 주파수 분해능과 ROI 차이로 정한 후보 폭입니다. 임상 오차 또는 95% 신뢰구간이 아닙니다.</p></section>
      <section class="results-section card"><h2>다음 관측 제안</h2><p>${esc(names[C.recommend(history.filter(h=>h.participant===p.participant)).kind])}를 우선 관찰합니다. ${esc(C.recommend([]).reason)}</p><p class="hint">산출 보류: ${r.withheld.map(esc).join(' · ')}. 기록은 JSON으로 내보내 재계산할 수 있습니다.</p></section>`;
    on($('export-result'),'click',()=>download(p));on($('new-session'),'click',()=>{show('overview');recommendation();});
  }
  function pulseChart(windows){const a=windows.filter(w=>w.bpm!==null);if(!a.length)return '';
    const maxT=Math.max(...windows.map(w=>w.end)),lo=Math.min(...a.map(w=>w.bpm))-8,hi=Math.max(...a.map(w=>w.bpm))+8;
    return `<svg class="spark" viewBox="0 0 800 110" role="img" aria-label="독립 시간 창별 심박 후보. 빈 구간은 연결하지 않습니다."><line x1="20" y1="90" x2="780" y2="90" stroke="#dce4db"/>${a.map(w=>{const x=20+760*(w.start+w.end)/2/maxT,y=85-65*(w.bpm-lo)/(hi-lo),dy=65*w.halfWidth/(hi-lo);return `<line x1="${x}" x2="${x}" y1="${y-dy}" y2="${y+dy}" stroke="#9eb9a2"/><circle cx="${x}" cy="${y}" r="4" fill="#245b4f"/><text x="${x}" y="105" text-anchor="middle" fill="#617773" font-size="9">${w.start/1000}s</text>`;}).join('')}</svg>`;
  }
  function renderHistory(){show('history');$('history').innerHTML=`<div class="results-head"><div><p class="eyebrow">YOUR RESEARCH LOG</p><h1>누적 관측 기록</h1><p>이 관리자 범위의 브라우저 저장소에 ${history.length}개 기록이 있습니다.</p></div></div>${!history.length?'<div class="empty">첫 관측을 시작하면 여기에 기록됩니다.</div>':`<div class="table-wrap"><table><thead><tr><th>일시</th><th>참여 코드 해시</th><th>유형</th><th>시간 / 상태</th><th>보기</th></tr></thead><tbody>${history.map(p=>`<tr><td>${esc(new Date(p.createdAt).toLocaleString('ko-KR'))}</td><td>${esc(p.participant.slice(0,8))}</td><td>${esc(p.origin)} / ${esc(p.protocol)}</td><td>${fmt(p.elapsed/1000,0)}초 / ${esc(p.status)}</td><td><button data-record="${esc(p.id)}">결과</button><button data-remove="${esc(p.id)}" class="danger">삭제</button></td></tr>`).join('')}</tbody></table></div>`}<div class="note">서로 다른 참여 코드·장치·과제 형식은 기준선에서 분리됩니다. 가져온 기록과 합성 기록도 실제 기준선에 포함하지 않습니다. 데이터는 이 브라우저를 지우면 사라지므로 필요한 기록은 내보내세요.</div>`;
    for(const b of $('history').querySelectorAll('[data-record]'))on(b,'click',()=>renderResults(history.find(p=>p.id===b.dataset.record)));
    for(const b of $('history').querySelectorAll('[data-remove]'))on(b,'click',async()=>{if(b.dataset.armed!=='yes'){b.dataset.armed='yes';b.textContent='다시 눌러 삭제';return;}const id=b.dataset.remove;if(persist)await store.remove(id);history=history.filter(p=>p.id!==id);renderHistory();});
  }
  function renderMethods(){show('methods');$('methods').innerHTML=`<div class="results-head"><div><p class="eyebrow">EXPLAINABLE BY CONSTRUCTION</p><h1>결과를 만드는 원리</h1><p>관측 → 품질 확인 → 후보 비교 → 개인 변화. 각 단계는 기록으로 재현합니다.</p></div></div><div class="method-grid">
      <section class="card"><h3>01 · 교정과 검증을 분리</h3><p>세 지점의 시선으로 수평 위치를 보정합니다. 이후 두 지점은 보정식에 넣지 않고 오차만 평가합니다. 화면 너비 대비 평균 절대 오차 12% 이하 G2, 22% 이하 G1, 그 외 G0입니다. 이는 초기 공학 기준이며 정밀 안구추적기 성능을 뜻하지 않습니다.</p><p>깜박임, 머리 자세 변화, 오래된 관측과 AOI 경계의 모호한 표본은 시선 근거에서 제외합니다. G0일 때 시선 결과를 만들지 않습니다.</p></section>
      <section class="card"><h3>02 · 같은 영상의 증거 중복 제거</h3><p>이마와 양 볼의 RGB에서 공개 POS·CHROM 방법을 비교합니다. 같은 ROI의 알고리즘 둘은 독립 센서가 아닙니다. 픽셀 영역이 겹치는 ROI도 지지 수를 늘리지 않습니다. 공간적으로 분리된 두 영역 이상이 합의해야 심박 후보를 채택합니다.</p><p>12초의 겹치지 않는 창, 실제 관측 연속성, 조명 혼입, 영역 간 편차를 확인합니다. HRV와 임상 수준의 심박 정확도는 아직 주장하지 않습니다.</p></section>
      <section class="card"><h3>03 · 정서를 과제 반응으로 관찰</h3><p>위협·슬픔·긍정 이미지의 체류 비율, 자극에서 시선을 떼는 시간, 수동 반응 시간, 보상 선택, 부하 후 회복을 분리해서 기록합니다. 시선과 버튼 반응을 하나의 지표로 섞지 않습니다.</p><p>자극 세트는 잠정 상태입니다. 짧은 시행의 수치가 불안, 우울 또는 자아탄력성을 직접 측정한다고 해석하지 않습니다. 해당 관련성은 향후 반복 연구에서 평가합니다.</p></section>
      <section class="card"><h3>04 · 비교 가능한 날짜만 누적</h3><p>같은 참여 코드·카메라·화면 크기·프로토콜·과제·A/B 형식·엔진의 이전 날짜만 기준선 후보로 씁니다. 같은 날의 반복은 하루 한 기록으로 처리합니다. 첫 7개 날짜와 최근 7개 날짜를 따로 유지합니다.</p><p>현재 자동 과제 선택은 유효 관측 수에 따른 탐색 규칙입니다. 학습된 진단 모델이나 검증된 정보량 최적화로 표시하지 않습니다.</p></section>
      <section class="card"><h3>05 · 저장과 재현</h3><p>영상·음성·얼굴 원본은 저장하지 않습니다. 시각, ROI 평균 RGB, 품질, 교정 관측, 과제 사건과 반응만 전용 IndexedDB에 기록합니다. JSON을 가져올 때 저장된 점수를 신뢰하지 않고 다시 교정하고 분석합니다.</p><p>합성·가져온 기록은 개인 기준선에서 제외됩니다. 운영 검사 페이지, 운영 결과 테이블과 실행 상태를 공유하지 않습니다.</p></section>
      <section class="card"><h3>06 · 다음 검증 단계</h3><ol><li>실제 얼굴·조명·피부색·장치별 수집 및 재검사 평가</li><li>공개 RGB-PPG 자료의 피험자 분리 비교</li><li>기준 장비 확보 후 동시 측정 오차 검증</li><li>정서 척도·반복 관측과의 관련성 평가</li><li>회복 개입 무작위 비교와 개인 효과 모델</li></ol><p>현재 코드는 이 연구를 위한 관측·추적·재현 기반을 제공합니다. 데이터 없이 정확도 수치나 진단 성능을 만들어내지 않습니다.</p></section></div><div class="note">핵심 독자 구현: 시간 예산에 맞춘 과제 제어, 교정 검증과 품질에 따른 근거 보류, 후보의 원천 추적 및 중복 지지 제거, 비교 조건을 고정한 종단 분석. 공개 얼굴 모델과 POS·CHROM 자체를 독자 발명으로 주장하지 않습니다.</div>`;}
  async function importRecord(event){const file=event.target.files?.[0];event.target.value='';if(!file)return;if(file.size>8*1024*1024){status('8MB 이하의 수치 기록만 가져올 수 있습니다.',true);return;}
    controls(false);try{await verify();const p=C.validate(JSON.parse(await file.text()));p.sourceId=p.id;p.id=crypto.randomUUID();p.origin='imported';p.result=await compute(p);await save(p);renderResults(p);}catch(e){status('기록을 가져오지 못했습니다: '+e.message,true);show('overview');}finally{controls(true);}}
  async function demo(){controls(false);status('합성 수치 기록을 생성하고 엔진을 재현합니다…');try{await verify();const {makeFixture}=await import('./fixture.js');const p=makeFixture(manifest);p.result=await compute(p);await save(p);renderResults(p);status('');}catch(e){status(e.message,true);}finally{controls(true);}}
  for(const b of document.querySelectorAll('[data-nav]'))on(b,'click',()=>{if(running||preparing||finishing)return;if(b.dataset.nav==='history')renderHistory();else if(b.dataset.nav==='methods')renderMethods();else{show('overview');recommendation();}});
  on($('start'),'click',start);on($('stop'),'click',()=>finish('aborted','관리자가 중단했습니다.'));on($('logout'),'click',logout);on($('import'),'change',importRecord);on($('demo'),'click',demo);
  on($('protocol'),'change',recommendation);on($('participant'),'change',recommendation);
  for(const b of document.querySelectorAll('[data-response]'))on(b,'click',()=>respond(b.dataset.response));
  on(window,'keydown',e=>{if(running&&!e.repeat&&['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();respond(e.key==='ArrowLeft'?'left':'right');}});
  on(document,'visibilitychange',()=>{if(document.hidden&&running)finish('aborted','탭이 가려져 관측을 중단했습니다.');});
  on(window,'blur',()=>{if(running)finish('aborted','다른 창으로 이동하여 관측을 중단했습니다.');});
  on(window,'resize',()=>{if(running)finish('aborted','화면 크기가 바뀌어 교정 조건이 달라졌습니다.');});
  on(window,'pagehide',()=>{camera?.stop();cancelAnimationFrame(raf);});
  show('overview');recommendation();
  return {async destroy(){++generation;if(running)await finish('aborted','관리자 세션 종료');camera?.stop();running=false;preparing=false;events.abort();cancelAnimationFrame(raf);store.close();}};
}
