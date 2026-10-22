// Synthetic fixture, intentionally labelled at every entry point. No normal-user baseline.
export function makeFixture(manifest){
  const C=globalThis.NL2,seed=24681,phases=C.schedule('first180','attention'),trials=C.makeTrials(phases,manifest,seed,'A'),points=[];
  for(const [i,target] of [.2,.8,.5,.32,.68].entries())for(let n=0;n<20;n++)points.push({raw:.2+.4*target+Math.sin(n)*.001,target,split:i<3?'train':'holdout',yaw:0,t:i*3600+500+n*100,point:i});
  const frames=[];
  for(let t=0;t<180000;t+=100){const phase=phases.find(p=>t>=p.start&&t<p.end);if(!phase)continue;const bpm=phase.id==='load'?87:phase.id==='recovery'?78:72;
    const trial=trials.find(x=>t>=x.start&&t<x.end);let x=.5;
    if(trial?.kind==='attention'){const emotional=(t-trial.start-1000)%3000<({threat:1800,dysphoric:1500,positive:2100}[trial.category]);x=(emotional?trial.side==='left':trial.side==='right')?.2:.8;}
    if(trial?.kind==='disengage')x=(t<trial.start+2450?trial.side==='left':trial.side==='right')?.2:.8;
    const wave=Math.sin(2*Math.PI*bpm/60*t/1000);frames.push({t,phase:phase.id,face:true,fresh:true,eye:.2+.4*x,yaw:0,blink:false,motion:0,geometryAge:0,background:90,
      rois:['forehead','left-cheek','right-cheek'].map((id,i)=>({id,coverage:1,box:[.2+i*.2,.3,.1,.07],rgb:[115+.24*wave,90+.9*wave,70+.16*wave]}))});}
  for(const trial of trials){trial.inputMethod='synthetic';trial.shownAt=trial.start+510;if(trial.kind==='disengage'){trial.targetAt=trial.start+2110;trial.responseAt=trial.targetAt+350;trial.correct=true;trial.choice=trial.side==='left'?'right':'left';}
    if(trial.kind==='reward'){trial.targetAt=trial.shownAt;trial.choice=trial.rich;trial.responseAt=trial.shownAt+400;trial.win=true;}
    if(trial.kind==='load'){trial.targetAt=trial.shownAt;trial.responseAt=trial.shownAt+700;trial.correct=true;}}
  return {schema:C.SCHEMA,engine:C.VERSION,id:crypto.randomUUID(),createdAt:new Date().toISOString(),localDate:new Date().toLocaleDateString('sv-SE'),participant:'synthetic-fixture',protocol:'first180',focus:'attention',form:'A',seed,
    checkin:{version:'mind-checkin-1',completedAt:new Date().toISOString(),language:'ko',wording:'nl2-ko-1',answers:{interest:1,lowMood:2,anxiety:2,worry:1,tension:7,energy:4,agency:2,support:3,rest:1}},
    deviceKey:'synthetic',device:{width:640,height:480,fps:10},captureMode:'synthetic',origin:'synthetic',status:'completed',elapsed:180000,phases,trials,frames,calibrationPoints:points,
    calibration:C.fitCalibration(points),events:[],stimuliVersion:manifest.version,stimuliStatus:'provisional',timing:{preparationMs:0,totalMs:180000},stopReason:'합성 엔진 검증'};
}
