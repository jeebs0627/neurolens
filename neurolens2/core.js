/* IN MIND 2.0 research engine. Pure, deterministic, no I/O. */
(function (root, factory) {
  const api = factory(); if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NL2 = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';
  const VERSION = 'nl2-2.3.0', SCHEMA = 'nl2-packet-1';
  const legacyProtocols = {
    first180: [['calibration',18],['baseline',12],['attention',36],['disengage',24],['reward',18],['preload',20],['load',20],['recovery',28],['wrap',4]],
    daily60: [['calibration',10],['baseline',12],['focus',24],['recovery',10],['wrap',4]],
    daily90: [['calibration',12],['baseline',20],['focus',30],['recovery',24],['wrap',4]],
    weekly180: [['calibration',18],['baseline',22],['focus',48],['preload',20],['load',24],['recovery',44],['wrap',4]]
  };
  const protocols = {
    first180: [['calibration',18],['baseline',12],['attention',36],['disengage',27],['reward',24],['preload',12],['load',24],['recovery',24],['wrap',3]],
    daily60: legacyProtocols.daily60,
    daily90: [['calibration',14],['baseline',12],['focus',36],['recovery',24],['wrap',4]],
    weekly180: [['calibration',18],['baseline',18],['focus',48],['preload',18],['load',30],['recovery',44],['wrap',4]]
  };
  const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
  const finite = x => typeof x === 'number' && Number.isFinite(x);
  const mean = a => a.length ? a.reduce((s,x)=>s+x,0)/a.length : null;
  function median(a) { if (!a.length) return null; const b=[...a].sort((x,y)=>x-y),i=b.length>>1;return b.length%2?b[i]:(b[i-1]+b[i])/2; }
  function sd(a) { if(a.length<2)return 0;const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1)); }
  function rng(seed) { let a=seed>>>0;return ()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;}; }
  function shuffle(a,r) { const b=[...a];for(let i=b.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[b[i],b[j]]=[b[j],b[i]];}return b; }
  function schedule(name,focus='attention',version=VERSION) {
    const plans=version==='nl2-2.0.0'?legacyProtocols:protocols;
    if(!protocols[name]||!['attention','disengage','reward'].includes(focus))throw Error('invalid-protocol');
    let t=0;return plans[name].map(([kind,duration])=>({id:kind,start:t,end:(t+=duration*1000),kind:kind==='focus'?focus:kind}));
  }
  function sessionPosition(phases, frameTime, startedAt) {
    if(!finite(frameTime)||!finite(startedAt)||!phases.length)throw Error('invalid-session-clock');
    // A first rAF callback can carry the frame's timestamp from before start().
    const end=phases.at(-1).end,elapsed=clamp(frameTime-startedAt,0,end),finished=elapsed>=end;
    const phase=finished?null:phases.find(p=>elapsed>=p.start&&elapsed<p.end);
    if(!finished&&!phase)throw Error('invalid-session-schedule');
    return {elapsed,phase,finished};
  }
  function makeTrials(phases, manifest, seed, form) {
    const r=rng(seed),trials=[];
    for(const phase of phases){
      if(!['attention','disengage','reward','load'].includes(phase.kind))continue;
      const step=phase.kind==='disengage'?4500:4000,count=Math.floor((phase.end-phase.start)/step);
      const categories=['threat','dysphoric','positive'];
      const order=shuffle(Array.from({length:count},(_,i)=>categories[i%3]),r),sides=Array(count);let imbalance=0;
      for(const category of categories){const indices=order.map((c,i)=>c===category?i:-1).filter(i=>i>=0),moreLeft=imbalance===0?r()>.5:imbalance<0;
        const group=shuffle(indices.map((_,i)=>(i%2===0)===moreLeft?'left':'right'),r);indices.forEach((index,i)=>{sides[index]=group[i];imbalance+=group[i]==='left'?1:-1;});}
      const banks=Object.fromEntries(categories.map(c=>[c,shuffle(manifest.pairs.filter(p=>p.form===form&&p.category===c),r)]));
      const used=Object.fromEntries(categories.map(c=>[c,0]));
      for(let i=0;i<count;i++){
        const category=order[i],bank=banks[category],pair=bank[used[category]++%bank.length];
        if(!pair&&['attention','disengage'].includes(phase.kind))throw Error('stimuli-missing');
        trials.push({id:phase.id+'-'+i,phase:phase.id,kind:phase.kind,start:phase.start+i*step,end:phase.start+(i+1)*step,
          side:sides[i],category,pairId:pair?.id||null,rich:seed%2?'left':'right',rewardDraw:r(),a:2+Math.floor(r()*8),b:1+Math.floor(r()*8),difficulty:1});
      }
    }
    return trials;
  }
  function fitCalibration(points) {
    const train=points.filter(p=>p.split==='train'&&finite(p.raw)&&finite(p.target)), hold=points.filter(p=>p.split==='holdout'&&finite(p.raw)&&finite(p.target));
    const empty={grade:'G0',reason:'교정 관측 부족',slope:null,intercept:null,error:null,trainN:train.length,holdoutN:hold.length};
    if(train.length<18||hold.length<10||new Set(train.map(p=>p.target)).size<3||new Set(hold.map(p=>p.target)).size<2)return empty;
    const trainTargets=[...new Set(train.map(p=>p.target))],holdTargets=[...new Set(hold.map(p=>p.target))];
    if([...trainTargets.map(target=>train.filter(p=>p.target===target).length),...holdTargets.map(target=>hold.filter(p=>p.target===target).length)].some(n=>n<6))return {...empty,reason:'검증 지점별 관측 부족'};
    // Give each target equal weight. High camera FPS at one target must not dominate calibration.
    const centres=trainTargets.map(target=>({target,raw:median(train.filter(p=>p.target===target).map(p=>p.raw))}));
    const mx=mean(centres.map(p=>p.raw)),my=mean(centres.map(p=>p.target));
    const v=centres.reduce((s,p)=>s+(p.raw-mx)**2,0);
    if(v/centres.length<.000025)return {...empty,reason:'시선 이동 범위 부족'};
    const slope=centres.reduce((s,p)=>s+(p.raw-mx)*(p.target-my),0)/v,intercept=my-slope*mx;
    const error=mean(holdTargets.map(target=>mean(hold.filter(p=>p.target===target).map(p=>Math.abs(slope*p.raw+intercept-p.target)))));
    const grade=error<=.12?'G2':error<=.22?'G1':'G0';
    return {...empty,grade,reason:grade==='G0'?'독립 검증점 오차 초과':'훈련에 쓰지 않은 검증점 평가',slope,intercept,error,
      yaw:median(train.map(p=>p.yaw||0)),yawRange:.12,
      centerX:median(train.map(p=>p.centerX).filter(finite)),centerY:median(train.map(p=>p.centerY).filter(finite)),faceWidth:median(train.map(p=>p.faceWidth).filter(finite)),roll:median(train.map(p=>p.roll).filter(finite))};
  }
  // Probability-like spatial weights; not a calibrated posterior or diagnostic probability.
  function gaze(frame,cal) {
    if(!cal||cal.grade==='G0'||!frame.fresh||!frame.face||!finite(frame.eye)||frame.blink||Math.abs((frame.yaw||0)-cal.yaw)>cal.yawRange)return null;
    if(finite(cal.centerX)&&(!finite(frame.centerX)||Math.abs(frame.centerX-cal.centerX)>.08))return null;
    if(finite(cal.centerY)&&(!finite(frame.centerY)||Math.abs(frame.centerY-cal.centerY)>.08))return null;
    if(finite(cal.faceWidth)&&(!finite(frame.faceWidth)||frame.faceWidth/cal.faceWidth<.8||frame.faceWidth/cal.faceWidth>1.2))return null;
    if(finite(cal.roll)&&(!finite(frame.roll)||Math.abs(frame.roll-cal.roll)>.08))return null;
    const x=cal.intercept+cal.slope*frame.eye,err=Math.max(.05,cal.error);
    return {x,left:clamp((.42-x)/err+.5,0,1),right:clamp((x-.58)/err+.5,0,1)};
  }
  function interval(values) {
    if(!values.length)return {value:null,n:0,interval:null};
    const m=mean(values),se=sd(values)/Math.sqrt(values.length),df=values.length-1;
    const critical=[0,12.706,4.303,3.182,2.776,2.571,2.447,2.365,2.306,2.262,2.228,2.201,2.179,2.160,2.145,2.131,2.120,2.110,2.101,2.093,2.086,2.080,2.074,2.069,2.064,2.060,2.056,2.052,2.048,2.045,2.042];
    const width=(critical[Math.min(df,30)]||1.96)*se;
    return {value:m,n:values.length,interval:values.length>=3?[m-width,m+width]:null,intervalMethod:'Student-t; independent-trial normal-mean approximation, not diagnostic certainty'};
  }
  function driftFlags(packet){
    if(packet.calibration.grade==='G0')return [];
    const flags=[];
    for(const phase of packet.phases.filter(p=>['baseline','preload','recovery'].includes(p.kind))){
      for(let t=phase.start+1000;t+2000<=Math.min(phase.end,packet.elapsed);t+=2000){
        const xs=packet.frames.filter(f=>f.t>=t&&f.t<t+2000&&f.phase===phase.id).map(f=>gaze(f,packet.calibration)).filter(Boolean).map(g=>g.x);
        if(xs.length>=15&&Math.abs(median(xs)-.5)>.20){flags.push({t:t+2000,phase:phase.id,type:'gaze-drift',deviation:median(xs)-.5,reason:'중앙 주시 검증에서 위치 편향이 지속됨'});break;}
      }
    }
    return flags;
  }
  function taskEvidence(packet) {
    const flags=driftFlags(packet),cutoff=flags.length?Math.min(...flags.map(f=>f.t)):Infinity;
    const frames=packet.frames.filter(f=>f.t<cutoff),cal=packet.calibration,rows=[];
    for(const trial of packet.trials){
      if(!finite(trial.shownAt)||trial.shownAt>trial.start+750||trial.end>packet.elapsed||trial.presentationInvalid||trial.inputLagMs>150)continue;
      const fs=frames.filter(f=>f.fresh&&f.t>=trial.shownAt&&f.t<trial.end&&f.phase===trial.phase);
      if(trial.kind==='attention'){
        let negative=0,observed=0;
        for(let i=0;i<fs.length-1;i++){
          const f=fs[i],g=gaze(f,cal),dt=fs[i+1].t-f.t;
          if(!g||!fs[i+1].fresh||dt<=0||dt>180||f.t<trial.shownAt+500)continue;
          const total=g.left+g.right;if(total<.7)continue;
          observed+=dt;negative+=dt*(trial.side==='left'?g.left:g.right)/total;
        }
        if(observed>=900)rows.push({kind:'attention',category:trial.category,value:negative/observed,observedMs:observed,trial:trial.id,source:'gaze'});
        if(['left','right'].includes(trial.choice))rows.push({kind:'attentionChoice',category:trial.category,value:trial.choice===trial.side?1:0,trial:trial.id,source:'behavior'});
      }
      if(trial.kind==='disengage'&&finite(trial.targetAt)){
        const initial=fs.filter(f=>f.t>=trial.targetAt-450&&f.t<trial.targetAt).map(f=>gaze(f,cal)).filter(Boolean);
        const cued=initial.length>=2&&mean(initial.map(g=>g[trial.side]))>.7;
        let run=[];
        for(const f of fs.filter(f=>f.t>=trial.targetAt)){
          const g=gaze(f,cal),other=trial.side==='left'?'right':'left';
          if(!g||g[other]<.7||(run.length&&f.t-run.at(-1)>180))run=[];
          if(g&&g[other]>=.7)run.push(f.t);
          if(cued&&run.length>=3){rows.push({kind:'disengage',category:trial.category,value:run[0]-trial.targetAt,trial:trial.id,source:'gaze'});break;}
        }
      }
      if(['disengage','load'].includes(trial.kind)&&finite(trial.responseAt)&&finite(trial.targetAt)&&trial.responseAt>=trial.targetAt+100&&trial.responseAt<trial.end)
        rows.push({kind:trial.kind==='load'?'load':'manualRT',value:trial.responseAt-trial.targetAt,correct:trial.correct===true,trial:trial.id,source:'behavior',difficulty:trial.difficulty,inputMethod:trial.inputMethod||'legacy'});
      if(trial.kind==='reward'&&['left','right'].includes(trial.choice))rows.push({kind:'reward',value:trial.choice===trial.rich?1:0,win:!!trial.win,choice:trial.choice,trial:trial.id,source:'behavior'});
    }
    const out=[];
    for(const category of ['threat','dysphoric','positive']){
      const a=rows.filter(r=>r.kind==='attention'&&r.category===category);
      out.push({id:'attention-'+category,label:({threat:'위협 자극 주의 비율',dysphoric:'슬픔 자극 주의 비율',positive:'긍정 자극 주의 비율'})[category],
        ...interval(a.map(r=>100*r.value)),unit:'%',source:'gaze',reason:a.length<3?'해석에 필요한 유효 시행 부족':'시행별 정서 자극 체류 비율 평균',usable:a.length>=3});
      const choices=rows.filter(r=>r.kind==='attentionChoice'&&r.category===category);
      if(choices.length)out.push({id:'choice-'+category,label:({threat:'위협 이미지 선택률',dysphoric:'슬픔 이미지 선택률',positive:'긍정 이미지 선택률'})[category],
        ...interval(choices.map(r=>100*r.value)),unit:'%',source:'behavior',usable:choices.length>=3,reason:'자발적 버튼 선택의 기술 통계. 시선 체류 지표와 구별'});
    }
    for(const [kind,label,unit,min] of [['disengage','시선 전환 시간','ms',4],['manualRT','버튼 전환 시간','ms',4],['load','계산 반응 시간','ms',4],['reward','보상 선택 비율','%',6]]){
      const a=rows.filter(r=>r.kind===kind&&(!['load','manualRT'].includes(kind)||r.correct));
      out.push({id:kind,label,...interval(a.map(r=>r.value*(kind==='reward'?100:1))),unit,source:kind==='disengage'?'gaze':'behavior',
        usable:a.length>=min,reason:kind==='reward'?'짧은 선택 과제의 기술 통계; 보상 학습률 추정 아님':a.length<min?'해석에 필요한 유효 시행 부족':kind==='load'?'난이도 구성과 함께 보는 정답 반응 평균':'유효 시행의 평균과 시행 간 변동',
        contextKey:['load','manualRT'].includes(kind)?'inputs:'+JSON.stringify([...new Set(a.map(r=>r.inputMethod))].sort())+(kind==='load'?';levels:'+JSON.stringify([1,2,3,4,5].map(level=>a.filter(r=>r.difficulty===level).length)):''):undefined,
        details:kind==='load'?{attempts:rows.filter(r=>r.kind==='load').length,correct:a.length}:undefined});
    }
    return {features:out,rows,flags};
  }
  function recovery(windows) {
    const valid=phase=>windows.filter(w=>w.phase===phase&&w.bpm!==null);
    const base=valid('preload'),load=valid('load'),rec=valid('recovery');
    if(!base.length||!load.length||!rec.length)return {value:null,reason:'부하 전·중·회복의 독립 창 부족'};
    const b=mean(base.map(w=>w.bpm)),l=mean(load.map(w=>w.bpm)),last=rec.at(-1),rise=l-b;
    const error=Math.max(...[...base,...load,last].map(w=>w.halfWidth||3))*2;
    if(rise<=error)return {value:null,reason:'부하 상승량이 후보 불확실성보다 작아 회복률 보류',rise,error};
    return {value:100*(l-last.bpm)/rise,unit:'%',rise,error,reason:'(부하 심박 − 마지막 회복 심박) / (부하 심박 − 부하 전 심박)',
      interval:null,provisional:true};
  }
  function analyze(packet,pulse) {
    const tasks=taskEvidence(packet),windows=pulse&&packet.captureMode!=='behavior'?pulse.analyze(packet.frames,packet.phases).filter(w=>w.end<=packet.elapsed):[];
    const valid=windows.filter(w=>w.bpm!==null),hr=interval(valid.map(w=>w.bpm));
    const features=[...tasks.features,{id:'pulse',label:'관측 심박 후보',...hr,interval:null,unit:'bpm',source:'camera-rgb',usable:valid.length>0,
      contextKey:'windows:'+valid.map(w=>w.phase+':'+w.start).join(','),
      reason:valid.length?'독립 시간 창의 중앙 후보를 요약; HRV·진단 점수로 변환하지 않음':'영상 품질·길이 또는 ROI 일치 기준 미달'}];
    const groups=[...new Set(features.filter(f=>f.usable).map(f=>f.source==='behavior'?'behavior':'camera'))];
    return {engine:VERSION,features,rows:tasks.rows,windows,recovery:recovery(windows),
      evidence:{sourceGroups:groups,independentModalities:groups.length,note:'시선과 맥파는 같은 카메라에 의존하며 별도 독립 모달리티로 합산하지 않음'},
      calibration:packet.calibration,complete:packet.status==='completed',experimentalStimuli:true,
      qualityFlags:tasks.flags,
      withheld:['불안·우울 진단 확률','자아탄력성 점수','HRV / LF-HF','검증되지 않은 종합 마음 점수']};
  }
  const observed=p=>p.origin==='observed'&&p.purpose!=='evaluation'&&p.status==='completed';
  const localDay=p=>/^\d{4}-\d{2}-\d{2}$/.test(p.localDate||'')?p.localDate:p.createdAt.slice(0,10);
  function contextKey(p){return ['sleep','caffeine','exercise'].map(k=>p.checkin?.context?.[k]||'unknown').join(':');}
  function compatible(a,b){return ['engine','participant','protocol','focus','captureMode','form','deviceKey','stimuliVersion'].every(k=>a[k]===b[k])&&a.calibration?.grade===b.calibration?.grade&&contextKey(a)===contextKey(b);}
  function longitudinal(current,history) {
    const valid=observed(current)?history.filter(h=>h.id!==current.id&&h.createdAt<current.createdAt&&observed(h)&&compatible(current,h)):[];
    const days=new Map();for(const h of valid.sort((a,b)=>a.createdAt.localeCompare(b.createdAt))){const day=localDay(h);if(day!==localDay(current))days.set(day,h);}
    const all=[...days.values()],base=all.slice(0,7),rolling=all.slice(-7),changes=[];
    for(const f of current.result.features.filter(f=>f.usable)){
      const vals=base.map(h=>h.result.features.find(x=>x.id===f.id&&x.usable&&x.contextKey===f.contextKey)?.value).filter(finite);
      const trend=rolling.map(h=>h.result.features.find(x=>x.id===f.id&&x.usable&&x.contextKey===f.contextKey)?.value).filter(finite);
      const m=median(vals),mad=median(vals.map(x=>Math.abs(x-m))),noise=Math.max(f.unit==='ms'?30:f.unit==='bpm'?4:5,(mad||0)*1.4826);
      changes.push({id:f.id,label:f.label,n:vals.length,baseline:vals.length>=3?m:null,rolling:trend.length>=3?median(trend):null,
        difference:vals.length>=3?f.value-m:null,unit:f.unit,flag:vals.length>=3&&Math.abs(f.value-m)>2*noise?'평소 변동 폭 밖':'판정 보류',noise});
    }
    return {days:all.length,changes,rule:'같은 과제·자극 버전·형식·장치·참여 코드·기록된 수면/카페인/운동 조건의 이전 현지 날짜만 비교. 미기록 조건은 통제된 것으로 보지 않습니다. 계산 난이도와 심박 채택 창도 일치해야 합니다. 운영 점검은 제외합니다.'};
  }
  function recommend(history) {
    const candidates=['attention','disengage','reward'].map(kind=>{
      const features=history.filter(observed).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||'')).slice(0,14).flatMap(h=>h.result?.features||[])
        .filter(f=>f.usable&&(kind==='attention'?f.id.startsWith('attention'):f.id===kind));
      const n=features.reduce((s,f)=>s+f.n,0);return {kind,n,priority:1/Math.sqrt(1+n)};
    }).sort((a,b)=>b.priority-a.priority);
    return {kind:candidates[0].kind,candidates,reason:'최근 14회 중 유효 시행이 적은 정서 축을 우선하는 탐색 규칙. 검증된 EIG 최적화 모델은 아님.'};
  }
  function validate(p) {
    if(!p||p.schema!==SCHEMA||![VERSION,'nl2-2.2.0','nl2-2.1.0','nl2-2.0.0'].includes(p.engine))throw Error('지원하지 않는 기록 버전');
    if(p.purpose!==undefined&&!['personal','evaluation'].includes(p.purpose))throw Error('기록 목적이 올바르지 않습니다.');
    if(p.checkinOnly!==undefined&&typeof p.checkinOnly!=='boolean')throw Error('체크인 전용 기록 형식 오류');
    if(p.checkinOnly&&(p.elapsed!==0||p.status!=='aborted'||p.trials?.length||p.frames?.length))throw Error('체크인 전용 기록에 과제 측정이 섞였습니다.');
    const walk=(x,depth=0)=>{if(depth>12)throw Error('기록 중첩 초과');if(x&&typeof x==='object'){for(const k of Object.keys(x)){if(['__proto__','constructor','prototype','access_token','refresh_token','password'].includes(k))throw Error('허용되지 않는 기록 필드');walk(x[k],depth+1);}}else if(typeof x==='number'&&!finite(x))throw Error('잘못된 수치');};walk(p);
    if(!['observed','synthetic','imported'].includes(p.origin)||!['completed','aborted'].includes(p.status)||!protocols[p.protocol]||!finite(p.elapsed)||p.elapsed<0||p.elapsed>181000)throw Error('잘못된 세션 정보');
    if(!Array.isArray(p.frames)||p.frames.length>12000||!Array.isArray(p.trials)||p.trials.length>100||!Array.isArray(p.phases)||p.phases.length>12)throw Error('기록 크기 초과');
    for(const k of ['id','participant','createdAt','deviceKey','focus','captureMode','form'])if(typeof p[k]!=='string'||p[k].length>160)throw Error('필수 기록 필드 누락');
    if(!/^\d{4}-\d{2}-\d{2}T/.test(p.createdAt))throw Error('잘못된 날짜');
    const expected=schedule(p.protocol,p.focus,p.engine);
    if(JSON.stringify(p.phases)!==JSON.stringify(expected))throw Error('프로토콜 시간표 불일치');
    let t=-1;
    for(const f of p.frames){if(!finite(f.t)||f.t<t||f.t<0||f.t>p.elapsed+250||!expected.some(ph=>ph.id===f.phase))throw Error('잘못된 프레임 시간');t=f.t;
      if(f.rois&&(!Array.isArray(f.rois)||f.rois.length>3))throw Error('잘못된 ROI');
      for(const r of f.rois||[]){if(!r||typeof r.id!=='string'||!Array.isArray(r.rgb)||r.rgb.length!==3||!r.rgb.every(v=>finite(v)&&v>=0&&v<=255)||!Array.isArray(r.box)||r.box.length!==4||!r.box.every(finite))throw Error('잘못된 ROI 값');}
    }
    const trialIds=new Set();
    for(const trial of p.trials){const phase=expected.find(ph=>ph.id===trial.phase&&ph.kind===trial.kind);
      if(!phase||!finite(trial.start)||!finite(trial.end)||trial.end<=trial.start||trial.start<phase.start||trial.end>phase.end||typeof trial.id!=='string'||trialIds.has(trial.id)||!['attention','disengage','reward','load'].includes(trial.kind))throw Error('잘못된 시행');
      trialIds.add(trial.id);
    }
    if(!Array.isArray(p.calibrationPoints)||p.calibrationPoints.length>3000)throw Error('잘못된 교정 기록');
    // Never trust serialized calibration or results. Refit only from recorded holdout-tagged samples.
    p.calibration=fitCalibration(p.calibrationPoints);return p;
  }
  return {VERSION,SCHEMA,protocols,clamp,finite,mean,median,sd,rng,shuffle,schedule,sessionPosition,makeTrials,fitCalibration,gaze,interval,driftFlags,taskEvidence,recovery,analyze,observed,localDay,contextKey,compatible,longitudinal,recommend,validate};
});
