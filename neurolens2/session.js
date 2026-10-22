import {Camera} from './camera.js';
const C=globalThis.NL2,E=globalThis.NL2Experience,$=id=>document.getElementById(id);
const sideName={left:'왼쪽',right:'오른쪽'};
const icon=(kind)=>({attention:'◒',disengage:'↗',reward:'◯ □',load:'2 + 3',calibration:'◎',preload:'＋',baseline:'＋',recovery:'＋',wrap:'✓'})[kind];

export class Session {
  constructor({manifest,onComplete,onCancel}){
    this.manifest=manifest;this.onComplete=onComplete;this.onCancel=onCancel;
    this.events=new AbortController();this.clock=new E.PhaseClock();this.gate=new E.ReadinessGate();this.state='idle';this.generation=0;
    const on=(el,type,fn)=>el.addEventListener(type,fn,{signal:this.events.signal});
    on($('session'),'click',e=>{const b=e.target.closest('[data-action]');if(b&&!b.disabled)this.action(b.dataset.action);});
    on($('session'),'pointerdown',e=>{const b=e.target.closest('[data-response]');if(b&&!b.disabled&&e.isPrimary!==false&&e.button===0){e.preventDefault();this.respond(b.dataset.response,e,e.pointerType==='touch'?'touch':'pointer');}});
    on($('session'),'click',e=>{const b=e.target.closest('[data-response]');if(b&&!b.disabled&&e.detail===0)this.respond(b.dataset.response,e,'keyboard-button');});
    on(window,'keydown',e=>{
      if(!this.busy||e.repeat||e.altKey||e.ctrlKey||e.metaKey||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;
      const side={ArrowLeft:'left',ArrowRight:'right',Digit1:'left',Digit2:'right',Numpad1:'left',Numpad2:'right'}[e.code];
      if(side){e.preventDefault();this.respond(side,e,'keyboard');}
    });
    on($('stop'),'click',()=>this.stop('원할 때 다시 시작할 수 있습니다.'));
    on(document,'visibilitychange',()=>{if(document.hidden)this.interrupt('다른 탭으로 이동해 관측이 중단됐습니다.');});
    on(window,'blur',()=>this.interrupt('검사 창에서 벗어나 관측이 중단됐습니다.'));
    on(window,'resize',()=>{if(this.state==='active'&&this.bounds&&E.changedGeometry(this.bounds,$('stage').getBoundingClientRect()))this.interrupt('검사 화면 크기가 바뀌었습니다. 창 크기를 정한 뒤 다시 맞춰주세요.');});
    on(window,'pagehide',()=>this.cleanup());
  }
  get busy(){return !['idle','done'].includes(this.state);}
  async start(options){
    this.cleanup();const gen=++this.generation;
    this.options=options;this.state='setup';this.started=performance.now();this.setupStarted=this.started;this.practiceLog=[];this.inputChecks=new Set();this.gate.reset();this.latest=null;this.device={width:0,height:0,fps:0,trackId:'behavior'};this.calibrationAttempts=[];this.packet=null;this.phaseIndex=0;this.level=1;this.lastQualityAt=0;this.sequence=0;this.cameraConnecting=false;this.cameraError='';
    document.body.classList.add('in-session');$('session-progress').value=0;$('remaining').textContent=String(C.schedule(options.protocol,options.focus).at(-1).end/1000);$('session-progress').max=Number($('remaining').textContent);$('timer-label').textContent='초 측정';$('session-status').textContent='';$('frame-count').textContent='0';$('cal-grade').textContent='준비 전';$('wall-time').textContent='0초';
    $('camera-video').closest('.camera-frame').hidden=options.behavior;$('camera-video').hidden=options.behavior;$('camera-placeholder').hidden=!options.behavior;$('quality').textContent=options.behavior?'행동 과제 모드':'카메라 연결 전';
    this.renderSetup();this.lastTick=performance.now();this.raf=requestAnimationFrame(t=>this.tick(t));
    try{await this.preload();if(gen!==this.generation)return;this.assetsReady=true;this.refreshSetup();}
    catch(e){if(gen===this.generation){this.cameraError=e.message;this.refreshSetup();}}
  }
  async preload(){
    this.assetsReady=false;
    const files=[...new Set(this.manifest.pairs.filter(p=>p.form===this.options.form).flatMap(p=>[p.emotion.file,p.neutral.file]))];
    await Promise.all(files.map(file=>new Promise((resolve,reject)=>{const img=new Image(),timer=setTimeout(()=>reject(Error('그림 준비에 시간이 걸립니다. 연결을 확인하고 다시 시작해주세요.')),15000);img.onload=()=>{clearTimeout(timer);resolve();};img.onerror=()=>{clearTimeout(timer);reject(Error('검사 그림을 불러오지 못했습니다.'));};img.src='/neurolens2/stimuli/'+file;})));
  }
  header(title,step,action,mode){$('phase-name').textContent=title;$('phase-counter').textContent=step;$('instruction').textContent=action;$('task-instruction').textContent=action;$('interaction-mode').textContent=mode;$('session-status').textContent='';}
  content(html){$('task-content').innerHTML=html;}
  hideResponses(){ $('response-buttons').hidden=true; }
  renderSetup(){
    $('session').dataset.state='setup';this.header('나에게 맞는 측정 환경','준비 1 / 3 · 환경 확인',this.options.behavior?'두 방향의 입력이 잘 되는지 확인합니다.':'얼굴을 중앙에 맞추고, 입력이 잘 되는지 확인합니다.','아직 측정하지 않습니다');this.hideResponses();
    const checks=E.readiness(null).checks;
    this.content(`<div class="preflight"><p class="eyebrow">A GOOD START</p><h3>${this.options.behavior?'입력부터 가볍게 확인할게요':'얼굴과 화면을 맞춰볼까요?'}</h3><p>${this.options.behavior?'아래 두 방향을 한 번씩 눌러주세요.':'화면을 눈높이에 두고, 카메라에서 팔 길이 정도 떨어져 앉아주세요.<br>실제 거리는 재지 않고 화면 속 얼굴 크기로 안내합니다.'}</p>
      ${this.options.behavior?'':`<button class="secondary connect-camera" data-action="connect">카메라 연결하기</button><div class="readiness-list">${checks.map(c=>`<div data-check="${c.id}"><span class="check-dot">○</span><span>${c.label}</span><small>확인 전</small></div>`).join('')}</div><div class="steady-track"><i id="steady-progress"></i></div><p id="camera-guidance" class="readiness-message" role="status">카메라 연결을 누르면 이 화면에서 자세를 안내합니다.</p>`}
      <div class="input-check"><span class="micro-label">입력 확인 · 두 방향을 모두 눌러보세요</span><div class="practice-keys"><button data-response="left">← 왼쪽</button><button data-response="right">오른쪽 →</button></div><p id="input-check-status" role="status">키보드 ← → / 숫자 1·2 / 화면 버튼을 사용할 수 있습니다.</p></div>
      <button class="primary setup-next" data-action="practice" disabled>자세와 입력을 확인해주세요 <span>→</span></button><p class="hint">환경 준비와 연습 시간은 검사 시간에 포함되지 않습니다.</p></div>`);
  }
  async connect(){
    if(this.cameraConnecting||this.state!=='setup')return;
    this.camera?.stop();this.gate.reset();this.latest=null;this.cameraError='';this.cameraConnecting=true;this.refreshSetup();const gen=this.generation;
    const camera=new Camera($('camera-video'),f=>{if(gen===this.generation&&this.camera===camera)this.receive(f);},message=>{if(gen!==this.generation)return;if(this.state==='setup'){this.cameraError=message;this.refreshSetup();}else this.interrupt(message);});this.camera=camera;
    try{this.device=await camera.start();if(gen!==this.generation){camera.stop();return;}}
    catch(e){if(gen===this.generation){this.cameraError=e.name==='NotAllowedError'?'카메라 사용이 허용되지 않았습니다. 주소창의 카메라 권한을 확인한 뒤 다시 연결해주세요.':e.message;}}
    finally{if(gen===this.generation){this.cameraConnecting=false;this.refreshSetup();}}
  }
  refreshSetup(){
    if(this.state!=='setup')return;
    const q=this.gate.value(performance.now()),cameraOK=this.options.behavior||q.stable,inputs=this.inputChecks.size===2;
    $('quality').textContent=this.options.behavior?'행동 과제 모드':this.cameraError?'카메라 연결 확인 필요':this.cameraConnecting?'카메라 준비 중':q.stable?'촬영 준비 완료':this.camera?'얼굴·자세 확인 중':'카메라 연결 전';
    const connect=$('task-content').querySelector('[data-action="connect"]');if(connect){connect.disabled=this.cameraConnecting;connect.textContent=this.cameraConnecting?'카메라 권한과 모델을 준비합니다…':this.cameraError?'카메라 다시 연결':this.camera?'카메라 다시 맞추기':'카메라 연결하기';}
    for(const c of q.checks){const row=$('task-content').querySelector(`[data-check="${c.id}"]`);if(row){row.classList.toggle('passed',c.ok);row.querySelector('.check-dot').textContent=c.ok?'✓':'○';row.querySelector('small').textContent=c.ok?'좋아요':'조정 필요';}}
    if($('steady-progress'))$('steady-progress').style.width=q.progress*100+'%';
    if($('camera-guidance'))$('camera-guidance').textContent=this.cameraError||(!this.camera? '카메라 연결을 눌러주세요.':q.stable?'자세가 안정됐습니다. 아래 입력 확인 후 계속하세요.':q.hint);
    const next=$('task-content').querySelector('[data-action="practice"]');if(next){next.disabled=!cameraOK||!inputs||!this.assetsReady;next.innerHTML=(cameraOK&&inputs&&this.assetsReady?'좋아요, 방법을 익혀볼게요':!inputs?'왼쪽과 오른쪽 입력을 확인해주세요':!cameraOK?'얼굴 위치를 잠시 유지해주세요':'검사 그림을 준비합니다…')+' <span>→</span>';}
  }
  receive(frame){
    this.latest=frame;
    if(this.state==='setup'){this.gate.update(frame);return;}
    if(this.state!=='active'||!this.packet)return;
    const sample=this.clock.sample(frame.t);if(!sample)return;
    if(this.packet.frames.length>=12000){this.interrupt('영상 기록 상한에 도달했습니다.');return;}
    this.packet.frames.push({...frame,...sample,wallT:frame.t-this.started});
    if(this.phase.kind==='calibration'&&this.currentCal&&frame.fresh&&frame.face&&!frame.blink&&C.finite(frame.eye)&&sample.t-this.currentCal.shownAt>500){this.packet.calibrationPoints.push({raw:frame.eye,yaw:frame.yaw,centerX:frame.centerX,centerY:frame.centerY,faceWidth:frame.faceWidth,roll:frame.roll,target:this.currentCal.target,split:this.currentCal.split,t:sample.t,point:this.currentCal.index});}
  }
  action(action){
    if(action==='connect')return this.connect();
    if(action==='practice'&&this.state==='setup'&&this.assetsReady&&this.inputChecks.size===2&&(this.options.behavior||this.gate.value(performance.now()).stable)){this.practices=[...new Set(C.schedule(this.options.protocol,this.options.focus).map(p=>p.kind).filter(k=>['attention','disengage','reward','load'].includes(k)))];this.practiceIndex=0;this.showPractice();}
    else if(action==='try-practice'&&this.state==='practice-intro')this.beginPractice();
    else if(action==='practice-next'&&this.state==='practice-done'){this.practiceIndex++;this.showPractice();}
    else if(action==='begin'&&this.state==='ready')this.begin();
    else if(action==='phase-begin'&&this.state==='brief')this.countdown(()=>this.beginPhase(performance.now()));
    else if(action==='cal-continue'&&this.state==='cal-review'){this.phaseIndex++;this.phase=this.packet.phases[this.phaseIndex];this.beginPhase(performance.now());}
    else if(action==='cal-retry'&&this.state==='cal-review'&&this.calibrationAttempts.length<3){this.packet.frames=[];this.packet.calibrationPoints=[];this.countdown(()=>this.beginPhase(performance.now()));}
  }
  showPractice(){
    this.practiceTrial=0;this.activeTrial=null;
    if(this.practiceIndex>=this.practices.length){this.state='ready';this.header('준비가 끝났습니다','준비 3 / 3 · 시작 확인',this.options.behavior?'편안한 상태부터 시작해, 연습한 과제로 이어집니다.':'시작하면 먼저 움직이는 점을 따라 시선을 맞춥니다.','설명은 단계마다 다시 표시됩니다');this.hideResponses();this.content(`<div class="guide-card"><div class="guide-symbol">✓</div><p class="eyebrow">READY WHEN YOU ARE</p><h3>이제 편안하게 시작해요.</h3><p>${this.options.behavior?'카메라 없이 버튼 반응만 관찰합니다.':'머리는 편안하게 두고, 화면의 안내를 따라주세요.'}<br>보기만 하는 단계에서는 버튼이 나타나지 않습니다.</p><div class="duration-pill">실제 측정 ${C.schedule(this.options.protocol,this.options.focus).at(-1).end/1000}초 <span>설명 시간 별도</span></div><button class="primary" data-action="begin">${this.options.behavior?'편안한 상태부터 시작':'시선 맞추기부터 시작'} <span>→</span></button></div>`);return;}
    this.practiceKind=this.practices[this.practiceIndex];const g=E.guides[this.practiceKind];this.state='practice-intro';$('session').dataset.state='practice';this.header(g.title,`연습 ${this.practiceIndex+1} / ${this.practices.length} · 결과에 포함되지 않음`,g.action,g.mode);this.hideResponses();
    this.content(`<div class="guide-card"><div class="guide-symbol">${icon(this.practiceKind)}</div><p class="eyebrow">LET’S TRY IT ONCE</p><h3>${g.title}</h3><p class="guide-action">${g.action}</p><p>${g.why}</p><div class="instruction-rule">${this.practiceKind==='attention'?'누르지 않아도 정상입니다.':'← → 키 · 숫자 1·2 · 화면 선택지를 사용할 수 있어요.'}</div><button class="primary" data-action="try-practice">짧게 연습하기 <span>→</span></button></div>`);
  }
  beginPractice(){this.state='practice';this.practiceStarted=performance.now();this.practiceFeedback='';this.practiceResponded=false;this.renderKey='';this.renderPractice(0);}
  renderPractice(dt){
    const kind=this.practiceKind,target=kind==='disengage'?2100:500,state=dt<500?'fixation':kind==='disengage'&&dt<target?'cue':'choice';
    if(kind==='attention'&&dt>=4200){this.completePractice();return;}
    if(this.practiceResponded)return;
    const key='practice-'+this.practiceTrial+'-'+state;if(key===this.renderKey)return;this.renderKey=key;
    if(state==='fixation'){this.content('<span class="fixation">+</span><p class="stage-caption">가운데를 보며 잠시 기다려주세요.</p>');this.hideResponses();return;}
    if(kind==='attention'){this.content('<div class="sample-pair"><div class="sample-scene scene-one"><span>☀</span><i></i></div><div class="sample-scene scene-two"><span>☁</span><i></i></div></div><p class="stage-caption">두 그림을 자연스럽게 보세요 · 누르지 않습니다</p>');this.hideResponses();return;}
    if(kind==='disengage'&&state==='cue'){this.content(`<div class="practice-cue ${this.practiceTrial?'right':'left'}">▧<small>이 그림을 보세요</small></div>`);this.hideResponses();return;}
    this.practiceTargetAt=performance.now();
    if(kind==='disengage'){const side=this.practiceTrial?'left':'right';this.practiceCorrect=side;this.content(`<button class="target-choice ${side}" data-response="${side}" aria-label="${sideName[side]} 원 선택"><span>○</span></button>`);this.responses('← 왼쪽 원','오른쪽 원 →');}
    else if(kind==='reward'){this.content(this.rewardChoices());this.responses('← 원 선택','네모 선택 →');}
    else{this.practiceCorrect=this.practiceTrial?'left':'right';const values=this.practiceTrial?[9,7]:[4,5];this.content(this.mathChoices(this.practiceTrial?'5 + 4':'2 + 3',values));this.responses('← '+values[0],values[1]+' →');}
    $('response-feedback').textContent='지금 선택해보세요.';
  }
  completePractice(){this.state='practice-done';this.hideResponses();this.practiceLog.push({kind:this.practiceKind,completed:true,trials:this.practiceTrial+1});this.content(`<div class="guide-card"><div class="success-mark">✓</div><h3>${this.practiceKind==='attention'?'그대로 바라보면 됩니다.':'잘하셨어요. 입력이 확인됐습니다.'}</h3><p>${this.practiceKind==='attention'?'본 검사에서도 두 그림을 자유롭게 바라보세요.<br>정답이나 선택 버튼은 없습니다.':'본 검사에서도 같은 방법으로 응답해주세요.<br>선택한 항목에 확인 표시가 나타납니다.'}</p><button class="primary" data-action="practice-next">${this.practiceIndex+1===this.practices.length?'준비 마치기':'다음 방법 익히기'} <span>→</span></button></div>`);}
  async begin(){
    if(!this.options.behavior&&(!this.latest||performance.now()-this.latest.t>1000||!E.readiness(this.latest).ok)){this.state='setup';this.gate.reset();this.renderSetup();this.refreshSetup();return;}
    this.state='starting';const gen=this.generation;
    const rect=$('stage').getBoundingClientRect(),deviceKey=await this.options.deviceHash(JSON.stringify([this.device.trackId,this.device.width,this.device.height,Math.round(this.device.fps||0),Math.round(rect.width),Math.round(rect.height),navigator.userAgent]));if(gen!==this.generation)return;
    const {protocol,focus,form,participant,recommendation,behavior}=this.options,seed=crypto.getRandomValues(new Uint32Array(1))[0],phases=C.schedule(protocol,focus);
    this.packet={schema:C.SCHEMA,engine:C.VERSION,id:crypto.randomUUID(),createdAt:new Date().toISOString(),participant,protocol,focus,form,seed,deviceKey,device:{width:this.device.width,height:this.device.height,fps:this.device.fps},captureMode:behavior?'behavior':'webcam',origin:'observed',status:'aborted',elapsed:0,phases,trials:C.makeTrials(phases,this.manifest,seed,form),frames:[],calibrationPoints:[],calibration:C.fitCalibration([]),events:[],segments:[],practice:this.practiceLog,stimuliVersion:this.manifest.version,stimuliStatus:this.manifest.status,recommendation,timing:{preparationMs:performance.now()-this.started,guidanceMs:0,clock:'phase-anchored performance clock; frame-presentation callbacks and input event timestamps; camera exposure timestamp unavailable'}};
    this.phaseIndex=0;this.phase=phases[0];this.countdown(()=>this.beginPhase(performance.now()));
  }
  currentGuide(){return this.options.behavior&&this.phase.kind==='calibration'?{title:'편안하게 준비하기',action:'화면을 편안하게 바라보세요. 잠시 후 연습한 과제가 시작됩니다.',mode:'보기만 하기'}:E.guides[this.phase.kind];}
  countdown(next){this.state='countdown';this.countdownStart=performance.now();this.afterCountdown=next;this.hideResponses();this.renderKey='';this.header('곧 시작합니다','준비 완료 · 3초 후 시작',this.currentGuide().action,this.currentGuide().mode);}
  beginPhase(wallTime){
    this.state='active';$('session').dataset.state='active';this.phase=this.packet.phases[this.phaseIndex];this.clock.start(this.phase,wallTime);this.segment={phase:this.phase.id,wallStart:wallTime-this.started,activeStart:this.phase.start};this.packet.segments.push(this.segment);this.bounds=$('stage').getBoundingClientRect();this.renderKey='';this.activeTrial=null;this.currentCal=null;this.pendingOnset=null;this.lastTick=performance.now();
    const g=this.currentGuide();this.header(g.title,`${this.phaseIndex+1} / ${this.packet.phases.length} · ${this.options.behavior?'행동 관찰':'본 검사'}`,g.action,g.mode);$('timer-label').textContent='초 남음';this.event('phase',{phase:this.phase.id});this.drawTask(this.phase.start);
  }
  endPhase(now){
    const wallEnd=this.clock.anchor+this.phase.end-this.phase.start;this.packet.elapsed=this.phase.end;this.segment.wallEnd=wallEnd-this.started;this.clock.pause();this.hideResponses();this.pendingOnset=null;
    if(this.phase.kind==='calibration'&&!this.options.behavior){this.packet.calibration=C.fitCalibration(this.packet.calibrationPoints);this.calibrationAttempts.push({grade:this.packet.calibration.grade,error:this.packet.calibration.error,points:this.packet.calibrationPoints.map(p=>({...p}))});this.packet.calibrationAttempts=this.calibrationAttempts;$('cal-grade').textContent=this.packet.calibration.grade;this.state='cal-review';this.guidanceStart=now;const valid=this.packet.calibration.grade!=='G0';this.header(valid?'시선 준비가 됐습니다':'시선을 한 번 더 맞춰볼까요?','시선 확인 · 측정 시간 정지',valid?'시선 위치를 확인했습니다. 계속하면 편안한 상태부터 관찰합니다.':'움직이는 점을 눈으로 따라주세요. 고개와 창 크기는 그대로 유지합니다.',valid?'준비 완료':'다시 맞추기 권장');this.content(`<div class="guide-card"><div class="guide-symbol">${valid?'◎':'↺'}</div><h3>${valid?'좋습니다. 본 과제로 이어갈게요.':'시선 위치가 아직 충분히 맞지 않았습니다.'}</h3><p>${valid?'시선과 행동 반응을 구분해 기록합니다.':'다시 맞추거나, 시선 지표 없이 행동·영상 관찰을 이어갈 수 있습니다.'}</p>${!valid&&this.calibrationAttempts.length<3?'<button class="primary" data-action="cal-retry">한 번 더 맞추기 <span>↺</span></button>':''}<button class="${valid?'primary':'secondary'}" data-action="cal-continue">${valid?'편안한 상태 관찰 시작':'시선 지표 없이 계속'}</button></div>`);return;}
    this.phaseIndex++;if(this.phaseIndex>=this.packet.phases.length){this.finish('completed','안내된 모든 과제를 마쳤습니다.');return;}
    this.phase=this.packet.phases[this.phaseIndex];
    if(['attention','disengage','reward','preload'].includes(this.phase.kind)){this.state='brief';this.guidanceStart=now;const g=this.currentGuide();this.header(g.title,`다음 단계 ${this.phaseIndex+1} / ${this.packet.phases.length} · 안내 중`,g.action,g.mode);this.content(`<div class="guide-card"><div class="guide-symbol">${icon(this.phase.kind)}</div><p class="eyebrow">NEXT UP</p><h3>${g.title}</h3><p class="guide-action">${g.action}</p><p>${g.why}</p><button class="primary" data-action="phase-begin">이해했어요, 시작하기 <span>→</span></button><p class="hint">설명을 읽는 동안 측정 시간은 흐르지 않습니다.</p></div>`);}
    else this.beginPhase(wallEnd);
  }
  event(type,extra={}){if(this.packet&&this.packet.events.length<3000)this.packet.events.push({t:this.packet.elapsed,wallT:performance.now()-this.started,type,...extra});}
  tick(now){
    if(!this.busy)return;
    try{
      $('wall-time').textContent=Math.floor((now-this.started)/1000)+'초';
      if(this.state==='setup'&&now-this.lastQualityAt>100){this.lastQualityAt=now;this.refreshSetup();}
      if(this.state==='practice')this.renderPractice(now-this.practiceStarted);
      if(this.state==='countdown'){const left=3-Math.floor((now-this.countdownStart)/1000);if(left<=0){if(this.guidanceStart){this.packet.timing.guidanceMs+=now-this.guidanceStart;this.guidanceStart=null;}this.afterCountdown();}else if(this.renderKey!=='count-'+left){this.renderKey='count-'+left;this.content(`<div class="countdown-number">${left}</div><p class="stage-caption">${this.currentGuide().action}</p>`);}}
      if(this.state==='active'){
        const elapsed=this.clock.elapsed(now);this.packet.elapsed=elapsed;
        if(now-this.lastTick>1500){this.interrupt('화면이 잠시 멈춰 정확한 시간을 유지할 수 없었습니다.');return;}
        if(this.activeTrial&&now-this.lastTick>150)this.activeTrial.presentationInvalid=true;
        if(elapsed>=this.phase.end)this.endPhase(now);else{this.confirmOnset(now);this.drawTask(elapsed);this.refreshResponses(elapsed);}
        $('remaining').textContent=String(Math.ceil((this.packet.phases.at(-1).end-this.packet.elapsed)/1000));$('session-progress').value=this.packet.elapsed/1000;
        if(now-this.lastQualityAt>500){this.lastQualityAt=now;$('frame-count').textContent=String(this.packet.frames.filter(f=>f.face).length);$('quality').textContent=this.options.behavior?'행동 반응 관찰 중':!this.latest?.face?'얼굴을 카메라 중앙에 맞춰주세요':Math.abs(this.latest.yaw)>.14?'정면을 편안하게 봐주세요':'영상 신호 수집 중';}
      }
      this.lastTick=now;this.raf=requestAnimationFrame(t=>this.tick(t));
    }catch(e){this.interrupt('화면 처리 중 문제가 발생했습니다. '+e.message);}
  }
  submitOnset(trial,field,t){this.pendingOnset={trial,field,submitted:t,wall:performance.now()};}
  confirmOnset(now){
    const p=this.pendingOnset;if(!p||!this.clock.active)return;this.pendingOnset=null;now=Math.max(now,p.wall);const sample=this.clock.sample(now);if(!sample||sample.t>=p.trial.end)return;
    p.trial[p.field]=sample.t;p.trial.presentationDelayMs=Math.max(p.trial.presentationDelayMs||0,Math.max(0,now-p.wall));if(now-p.wall>100)p.trial.presentationInvalid=true;
    this.event('presentation',{trial:p.trial.id,field:p.field,submittedAt:p.submitted,presentedAt:sample.t,delayMs:Math.max(0,now-p.wall)});
    if(p.field==='shownAt'&&['reward','load'].includes(p.trial.kind))p.trial.targetAt=sample.t;
  }
  drawTask(t){
    const kind=this.phase.kind;
    if(kind==='calibration'){
      this.hideResponses();if(this.options.behavior){if(this.renderKey!=='behavior-cal'){this.renderKey='behavior-cal';this.content('<div class="guide-card"><div class="guide-symbol">＋</div><h3>잠시 편안하게 준비하세요.</h3><p>다음 단계에서는 화면 안내에 맞춰 응답합니다.</p></div>');$('cal-grade').textContent='카메라 미사용';}return;}
      const i=Math.min(4,Math.floor((t-this.phase.start)/((this.phase.end-this.phase.start)/5))),targets=[.2,.8,.5,.32,.68];if(this.renderKey!=='cal-'+i){this.renderKey='cal-'+i;this.currentCal={index:i,target:targets[i],split:i<3?'train':'holdout',shownAt:t};this.content(`<span class="target-dot" style="left:${targets[i]*100}%"><i></i></span><p class="cal-caption">점만 눈으로 따라보세요 · ${i+1} / 5<br><small>머리는 움직이지 않고 편안하게 유지합니다.</small></p>`);this.event('calibration-target',this.currentCal);}return;
    }
    if(!['attention','disengage','reward','load'].includes(kind)){this.hideResponses();if(this.renderKey!==kind){this.renderKey=kind;this.content(`<span class="fixation">${kind==='wrap'?'✓':'+'}</span><p class="stage-caption">${kind==='recovery'?'잘하셨어요. 이제 편안히 쉬세요.':kind==='wrap'?'관측을 마치고 결과를 준비합니다.':'가운데 +를 편안하게 바라보세요.'}</p>`);}return;}
    const trial=this.packet.trials.find(x=>x.phase===this.phase.id&&t>=x.start&&t<x.end);if(!trial){this.hideResponses();if(this.renderKey!=='rest'){this.renderKey='rest';this.content('<span class="fixation">+</span><p class="stage-caption">곧 다음 단계로 이어집니다.</p>');}return;}
    if(this.activeTrial?.id!==trial.id){this.activeTrial=trial;trial.enteredAt=t;this.pendingOnset=null;if(kind==='load'){trial.difficulty=this.level;trial.a+=(this.level-1)*3;trial.operation='+';trial.answer=trial.a+trial.b;trial.correctSide=trial.side;}}
    const state=E.trialView(trial,t),key=trial.id+'-'+state;if(key===this.renderKey)return;this.renderKey=key;
    if(state==='fixation'){this.hideResponses();this.content('<span class="fixation">+</span><p class="stage-caption">다음 화면을 기다려주세요.</p>');return;}
    const pair=this.manifest.pairs.find(p=>p.id===trial.pairId),src=file=>'/neurolens2/stimuli/'+encodeURIComponent(file);
    if(kind==='attention'){const left=trial.side==='left'?pair.emotion:pair.neutral,right=trial.side==='right'?pair.emotion:pair.neutral;this.content(`<div class="stim-pair"><img src="${src(left.file)}" alt="왼쪽 과제 그림" draggable="false"><img src="${src(right.file)}" alt="오른쪽 과제 그림" draggable="false"></div><p class="stage-caption">자연스럽게 바라보세요 · 누르지 않습니다</p>`);this.hideResponses();this.submitOnset(trial,'shownAt',t);}
    else if(kind==='disengage'){
      if(state==='cue'){this.content(`<img class="cue-image ${trial.side}" src="${src(pair.emotion.file)}" alt="먼저 바라볼 그림" draggable="false"><p class="stage-caption">지금은 그림을 보세요 · 원이 나올 때까지 기다립니다</p>`);this.hideResponses();this.submitOnset(trial,'shownAt',t);}
      else{const side=trial.side==='left'?'right':'left';this.content(`<button class="target-choice ${side}" data-response="${side}" aria-label="${sideName[side]} 원 선택"><span>○</span></button>`);this.responses('← 왼쪽','오른쪽 →');this.submitOnset(trial,'targetAt',t);}
    }else if(kind==='reward'){this.content(this.rewardChoices());this.responses('← 원 선택','네모 선택 →');this.submitOnset(trial,'shownAt',t);}
    else{const wrong=trial.answer+(trial.b%2?1:-1)*(this.level+1),values=trial.correctSide==='left'?[trial.answer,wrong]:[wrong,trial.answer];this.content(this.mathChoices(trial.a+' + '+trial.b,values));this.responses('← '+values[0],values[1]+' →');this.submitOnset(trial,'shownAt',t);}
  }
  rewardChoices(){return '<div class="choice-grid"><button class="shape-choice" data-response="left" aria-label="왼쪽 원 선택"><i class="circle-shape"></i><span>← 원</span></button><button class="shape-choice" data-response="right" aria-label="오른쪽 네모 선택"><i class="square-shape"></i><span>네모 →</span></button></div>';}
  mathChoices(question,values){return `<div class="math-question">${question} <span>= ?</span></div><div class="choice-grid"><button class="number-choice" data-response="left" aria-label="왼쪽 답 ${values[0]} 선택"><small>←</small>${values[0]}</button><button class="number-choice" data-response="right" aria-label="오른쪽 답 ${values[1]} 선택">${values[1]}<small>→</small></button></div>`;}
  responses(left,right){$('response-buttons').hidden=false;const buttons=$('response-buttons').querySelectorAll('[data-response]');buttons[0].textContent=left;buttons[1].textContent=right;buttons.forEach(b=>{b.classList.remove('selected');b.disabled=false;});$('response-feedback').textContent='키보드 ← → · 숫자 1·2 · 화면 선택지';}
  refreshResponses(t){
    const trial=this.activeTrial;if(!trial||$('response-buttons').hidden)return;
    const ready=E.responseDecision(trial,t).ok;
    for(const b of $('session').querySelectorAll('[data-response]'))b.disabled=!ready;
    if(trial.responseAt===undefined)$('response-feedback').textContent=ready?'지금 선택하세요 · ← → / 1·2 / 화면 버튼':'화면이 준비되면 선택할 수 있습니다.';
  }
  feedback(side,message){for(const b of $('session').querySelectorAll('[data-response]')){b.classList.toggle('selected',b.dataset.response===side);}if(!$('response-buttons').hidden)$('response-feedback').textContent=message;}
  respond(side,event,inputMethod){
    if(this.state==='setup'){this.inputChecks.add(side);const b=$('task-content').querySelector(`[data-response="${side}"]`);b?.classList.add('selected');$('input-check-status').textContent=sideName[side]+' 입력 확인 ✓'+(this.inputChecks.size===2?' · 두 방향 모두 준비됐습니다.':' · 반대쪽도 눌러보세요.');this.refreshSetup();return;}
    if(this.state==='practice'){
      if(this.practiceKind==='attention'||this.practiceResponded||performance.now()-this.practiceStarted<500)return;
      if(this.practiceKind==='disengage'&&performance.now()-this.practiceStarted<2100)return;
      if(['disengage','load'].includes(this.practiceKind)&&side!==this.practiceCorrect){this.feedback(side,'방향을 다시 확인해보세요. 정답 쪽을 한 번 더 눌러주세요.');return;}
      this.practiceResponded=true;this.feedback(side,sideName[side]+' 입력 확인 ✓');this.content(`<div class="guide-card"><div class="success-mark">✓</div><h3>${sideName[side]} 선택이 확인됐습니다.</h3><p>본 검사에서도 선택하면 확인 표시가 나타납니다.</p></div>`);const gen=this.generation;clearTimeout(this.practiceTimer);this.practiceTimer=setTimeout(()=>{if(gen!==this.generation||this.state!=='practice')return;if(['disengage','load'].includes(this.practiceKind)&&this.practiceTrial===0){this.practiceTrial++;this.beginPractice();}else this.completePractice();},850);return;
    }
    if(this.state!=='active')return;
    const now=performance.now(),stamp=E.eventTime(event.timeStamp,now,performance.timeOrigin),sample=this.clock.sample(stamp.time);if(!sample)return;
    const trial=this.activeTrial,result=E.responseDecision(trial,sample.t,stamp.lag);
    if(!result.ok){this.event('input-rejected',{reason:result.reason,trial:trial?.id||null,inputMethod});if(result.reason==='input-delayed')$('response-feedback').textContent='입력이 늦게 전달됐습니다. 이번 반응은 분석에서 제외합니다.';else if(result.reason==='already-answered')$('response-feedback').textContent='선택은 이미 기록됐습니다 ✓ 다음 화면을 기다려주세요.';return;}
    trial.choice=side;trial.responseAt=sample.t;trial.inputMethod=inputMethod;trial.inputLagMs=stamp.lag;trial.inputClockFallback=stamp.fallback;
    let message=sideName[side]+' 선택 기록 ✓';
    if(trial.kind==='reward'){trial.win=trial.rewardDraw<(side===trial.rich?.7:.3);message=trial.win?'선택 기록 ✓ · 보상 +1':'선택 기록 ✓ · 이번에는 보상이 없어요';}
    if(trial.kind==='disengage')trial.correct=side!==trial.side;
    if(trial.kind==='load'){trial.correct=side===trial.correctSide;if(trial.correct&&sample.t-trial.targetAt<2000)this.level=Math.min(5,this.level+1);else if(!trial.correct)this.level=Math.max(1,this.level-1);}
    this.feedback(side,message);this.event('response',{trial:trial.id,side,inputMethod,eventT:sample.t,dispatchLagMs:stamp.lag});
  }
  interrupt(reason){if(['active','brief','cal-review','countdown'].includes(this.state)&&this.packet)this.finish('aborted',reason);}
  stop(reason){if(this.packet)return this.finish('aborted',reason);this.cleanup();this.state='idle';this.onCancel();}
  cleanup(){++this.generation;cancelAnimationFrame(this.raf);clearTimeout(this.practiceTimer);this.camera?.stop();this.camera=null;this.clock.pause();document.body.classList.remove('in-session');}
  async finish(outcome,reason){
    if(this.state==='finishing'||!this.packet)return;const now=performance.now();if(this.state==='active')this.packet.elapsed=this.clock.elapsed(now);if(outcome==='completed')this.packet.elapsed=this.packet.phases.at(-1).end;
    if(this.segment&&!this.segment.wallEnd)this.segment.wallEnd=now-this.started;
    this.state='finishing';this.cleanup();this.packet.status=outcome;this.packet.stopReason=reason;this.packet.timing.totalMs=now-this.started;this.packet.timing.guidanceMs=Math.max(0,this.packet.timing.totalMs-this.packet.timing.preparationMs-this.packet.elapsed);this.packet.calibration=C.fitCalibration(this.packet.calibrationPoints);this.event(outcome,{reason});
    this.header(outcome==='completed'?'측정을 마쳤습니다':'측정이 중단됐습니다','기록 확인 중',outcome==='completed'?'참여해주셔서 감사합니다. 관측한 근거를 정리합니다.':reason,'카메라는 꺼졌습니다');this.hideResponses();this.content('<div class="guide-card"><div class="loading-ring"></div><h3>관측한 내용을 정리하고 있습니다.</h3><p>응답과 영상 신호의 품질을 확인합니다.</p></div>');
    try{await this.onComplete(this.packet);}finally{this.state='done';}
  }
  async destroy(){if(this.busy&&this.packet)await this.finish('aborted','관리자 세션을 종료했습니다.');this.cleanup();this.state='idle';this.events.abort();}
}
