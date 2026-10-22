/* Participant instructions and timing rules shared by the controller and tests. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.NL2Experience=api;})(typeof self!=='undefined'?self:globalThis,function(){
  'use strict';
  const guides={
    calibration:{title:'시선 맞추기',action:'머리는 편안하게 고정하고, 점만 눈으로 따라보세요.',mode:'눈으로만 따라보기',why:'화면의 어느 쪽을 보는지 맞추는 준비 과정입니다.'},
    baseline:{title:'편안하게 바라보기',action:'가운데 +를 편안하게 바라보세요. 아무것도 누르지 않습니다.',mode:'보기만 하기',why:'과제를 시작하기 전의 편안한 상태를 관찰합니다.'},
    attention:{title:'두 그림 바라보기',action:'두 그림을 자연스럽게 보세요. 정답도, 눌러야 할 버튼도 없습니다.',mode:'보기만 하기',why:'어떤 그림에 시선이 머무는지 관찰합니다. 한 쌍은 약 4초 동안 보입니다.'},
    disengage:{title:'원으로 시선 옮기기',action:'먼저 그림을 보세요. 반대쪽에 원이 나오면 원을 보고 그 방향을 누르세요.',mode:'원이 나온 방향 누르기',why:'그림에서 다른 위치로 주의를 옮기는 과제입니다. 그림이 있을 때는 기다리세요.'},
    reward:{title:'나의 선택 이어가기',action:'왼쪽 원과 오른쪽 네모 중 하나를 고르세요. 선택 후 보상을 확인합니다.',mode:'원 또는 네모 선택하기',why:'정답을 맞히는 문제가 아닙니다. 보상을 참고해 다음 선택을 해보세요.'},
    preload:{title:'집중과 회복 준비',action:'가운데 +를 바라보세요. 잠시 후 덧셈 문제, 그다음 휴식으로 이어집니다.',mode:'지금은 보기만 하기',why:'편안한 상태 → 짧은 덧셈 → 휴식을 끊김 없이 이어서 관찰합니다.'},
    load:{title:'짧게 집중하기',action:'화면의 정답 숫자를 클릭하세요. 키보드는 ← 또는 1이 왼쪽, → 또는 2가 오른쪽입니다.',mode:'정답이 있는 쪽 선택',why:'빠르기보다 정확하게 답해주세요. 반응에 따라 숫자의 크기가 조절됩니다.'},
    recovery:{title:'편안하게 회복하기',action:'과제가 끝났습니다. 가운데 +를 바라보며 편하게 쉬세요.',mode:'누르지 않고 쉬기',why:'호흡을 일부러 바꾸지 말고 평소처럼 쉬면 됩니다.'},
    wrap:{title:'측정 마무리',action:'잘 마치셨습니다. 잠시만 편안하게 기다려주세요.',mode:'곧 결과가 나옵니다',why:'수치 기록의 품질과 응답을 확인합니다.'}
  };
  function readiness(frame){
    const f=frame||{},light=f.luminance;
    const checks=[
      {id:'face',label:'한 사람의 얼굴',ok:f.faceCount===1&&f.detected===true,hint:f.faceCount>1?'화면에는 한 사람만 보이게 해주세요.':'얼굴 전체가 카메라에 보이게 해주세요.'},
      {id:'distance',label:'얼굴 크기·거리',ok:f.faceWidth>=.22&&f.faceWidth<=.53&&f.eyePixels>=18,hint:f.faceWidth>.53?'카메라에서 조금 멀어져 주세요.':'카메라에 조금 더 가까이 와주세요.'},
      {id:'center',label:'중앙 위치',ok:Math.abs((f.centerX??0)-.5)<.16&&Math.abs((f.centerY??0)-.5)<.20,hint:'얼굴을 타원 안쪽 중앙에 맞춰주세요.'},
      {id:'pose',label:'정면·안정된 자세',ok:Math.abs(f.yaw??1)<.14&&Math.abs(f.roll??1)<.12&&(f.motion??1)<.018,hint:'고개를 바로 하고 카메라 정면을 편안하게 보세요.'},
      {id:'light',label:'얼굴에 닿는 빛',ok:Number.isFinite(light)&&light>=25&&light<=235&&(f.rois||[]).filter(r=>r.coverage>=.4).length>=2,hint:'정면의 빛을 밝게 하고 강한 역광을 피해 주세요.'}
    ];
    const failed=checks.find(x=>!x.ok);return {checks,ok:!failed,hint:failed?.hint||'좋습니다. 이 자세를 잠시 유지해주세요.'};
  }
  class ReadinessGate{
    constructor(){this.reset();}
    reset(){this.since=null;this.last=null;this.count=0;this.result=readiness(null);}
    update(frame){if(!frame.fresh)return this.value(frame.t);const result=readiness(frame);if(!result.ok||this.last!==null&&(frame.t<=this.last||frame.t-this.last>250)){this.since=null;this.count=0;}if(result.ok){if(this.since===null)this.since=frame.t;this.count++;}this.last=frame.t;this.result=result;return this.value(frame.t);}
    value(now){const fresh=this.last!==null&&now-this.last<=500,held=this.since===null?0:Math.max(0,Math.min(1,(now-this.since)/2000));return {...this.result,stable:fresh&&this.result.ok&&held===1&&this.count>=20,progress:fresh&&this.result.ok?held:0};}
  }
  class DisplayGate{
    constructor(){this.reset();}
    reset(){this.times=[];this.last=null;this.slowStreak=0;}
    update(now){
      if(this.last!==null){const dt=now-this.last;this.slowStreak=dt>150?this.slowStreak+1:0;}
      this.last=now;this.times.push(now);this.times=this.times.filter(t=>now-t<=2200);return this.value(now);
    }
    value(now){
      const gaps=this.times.slice(1).map((t,i)=>t-this.times[i]),span=this.times.length?this.times.at(-1)-this.times[0]:0;
      const ordered=[...gaps].sort((a,b)=>a-b),median=ordered[Math.floor(ordered.length/2)],fresh=this.last!==null&&now-this.last<=200;
      return {stable:fresh&&span>=1500&&gaps.length>=20&&median<=50&&Math.max(...gaps)<=150,fps:median>0?Math.round(1000/median):null,slowStreak:this.slowStreak};
    }
  }
  class PhaseClock{
    constructor(){this.pause();}
    start(phase,wallTime){this.phase=phase;this.anchor=wallTime;this.active=true;}
    pause(){this.active=false;}
    elapsed(now){return this.phase?Math.max(this.phase.start,Math.min(this.phase.end,this.phase.start+now-this.anchor)):0;}
    sample(now){if(!this.active||now<this.anchor||now>=this.anchor+this.phase.end-this.phase.start)return null;return {t:this.phase.start+now-this.anchor,phase:this.phase.id};}
  }
  function trialView(trial,t){const dt=t-trial.start;if(dt<500)return 'fixation';if(trial.kind==='disengage')return dt<2100?'cue':'target';return 'choice';}
  function eventTime(stamp,now,timeOrigin){const normalized=stamp>1e12?stamp-timeOrigin:stamp;return Number.isFinite(normalized)&&normalized>0&&normalized<=now+5?{time:Math.min(now,normalized),lag:Math.max(0,now-normalized),fallback:false}:{time:now,lag:0,fallback:true};}
  function responseDecision(trial,t,lag=0){
    if(!trial||trial.kind==='attention')return {ok:false,reason:'watch-only'};
    if(trial.responseAt!==undefined)return {ok:false,reason:'already-answered'};
    if(t>=trial.end)return {ok:false,reason:'too-late'};
    if(!Number.isFinite(trial.targetAt)||t<trial.targetAt+100)return {ok:false,reason:'not-ready'};
    if(lag>150)return {ok:false,reason:'input-delayed'};
    return {ok:true};
  }
  function changedGeometry(before,after){return Math.abs(before.width-after.width)>Math.max(4,before.width*.02)||Math.abs(before.height-after.height)>Math.max(4,before.height*.02);}
  return {guides,readiness,ReadinessGate,DisplayGate,PhaseClock,trialView,eventTime,responseDecision,changedGeometry};
});
