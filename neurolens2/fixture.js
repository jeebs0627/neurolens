// Synthetic fixture, intentionally labelled at every entry point. No normal-user baseline.
export function makeFixture(manifest){
  const C=globalThis.NL2,seed=24681,phases=C.schedule('first180','attention'),trials=C.makeTrials(phases,manifest,seed,'A'),points=[];
  for(const [i,target] of [.2,.8,.5,.32,.68].entries())for(let n=0;n<20;n++)points.push({raw:.2+.4*target+Math.sin(n)*.001,target,split:i<3?'train':'holdout',yaw:0,t:i*3600+500+n*100,point:i});
  const frames=[];
  for(let t=0;t<180000;t+=100){const phase=phases.find(p=>t>=p.start&&t<p.end);if(!phase)continue;const bpm=phase.id==='load'?87:phase.id==='recovery'?78:72;
    const wave=Math.sin(2*Math.PI*bpm/60*t/1000);frames.push({t,phase:phase.id,face:true,fresh:true,eye:.2+.4*(Math.sin(t/1300)>.1?.2:.8),yaw:0,blink:false,motion:0,geometryAge:0,background:90,
      rois:['forehead','left-cheek','right-cheek'].map((id,i)=>({id,coverage:1,box:[.2+i*.2,.3,.1,.07],rgb:[115+.24*wave,90+.9*wave,70+.16*wave]}))});}
  for(const trial of trials){trial.shownAt=trial.start+410;if(trial.kind==='disengage'){trial.targetAt=trial.start+1310;trial.responseAt=trial.targetAt+350;trial.correct=true;trial.choice=trial.side==='left'?'right':'left';}
    if(trial.kind==='reward'){trial.targetAt=trial.shownAt;trial.choice=trial.rich;trial.responseAt=trial.shownAt+400;trial.win=true;}
    if(trial.kind==='load'){trial.targetAt=trial.shownAt;trial.responseAt=trial.shownAt+700;trial.correct=true;}}
  return {schema:C.SCHEMA,engine:C.VERSION,id:crypto.randomUUID(),createdAt:new Date().toISOString(),participant:'synthetic-fixture',protocol:'first180',focus:'attention',form:'A',seed,
    deviceKey:'synthetic',device:{width:640,height:480,fps:10},captureMode:'synthetic',origin:'synthetic',status:'completed',elapsed:180000,phases,trials,frames,calibrationPoints:points,
    calibration:C.fitCalibration(points),events:[],stimuliVersion:manifest.version,stimuliStatus:'provisional',timing:{preparationMs:0,totalMs:180000},stopReason:'합성 엔진 검증'};
}
