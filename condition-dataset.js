/* Research evidence, never ground-truth labels generated from our own predictions. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.NLDataset=api;})(typeof globalThis!=='undefined'?globalThis:null,function(){
  'use strict';
  const VERSION='condition-dataset-1',finite=Number.isFinite;
  const mean=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
  const quantile=(a,q)=>{const s=a.filter(finite).sort((x,y)=>x-y);return s.length?s[Math.round((s.length-1)*q)]:null;};
  const round=v=>finite(v)?Math.round(v*1000)/1000:null;
  const stats=a=>({n:a.filter(finite).length,median:round(quantile(a,.5)),p95:round(quantile(a,.95))});
  const LABELS={calibration:'시선 보정',baseline:'안정 기준선',pvt:'각성·반응',sart:'지속 주의·억제',pursuit:'시선 추적',saccade:'사카드',freeview:'정서 주의',stress:'압박 과제',recovery:'회복 호흡'};
  const KEYS={pvt:/^(pvt|perclos|blinkDur)/,sart:/^(sart|motion)/,pursuit:/^(pursuit|circ)/,saccade:/^anti/,freeview:/^(bias|lateNeg|firstNeg|posBias|negHr)/,stress:/^stress/,recovery:/^(recovery|coupling|resp)/};
  function coverage(rows,start,end){let ms=0;for(let i=1;i<rows.length;i++){const a=rows[i-1].t,b=rows[i].t;if(b>a&&b-a<=200)ms+=Math.max(0,Math.min(end,b)-Math.max(start,a));}return end>start?ms/(end-start):0;}
  function acquisition(frames){
    const F=frames.filter(f=>finite(f.t)).slice().sort((a,b)=>a.t-b.t),dt=F.slice(1).map((f,i)=>f.t-F[i].t).filter(v=>v>0),span=F.length>1?F.at(-1).t-F[0].t:0;
    const lum=F.map(f=>f.lum).filter(finite),gain=F.map(f=>f.exposureGain).filter(finite),eyes=F.filter(f=>finite(f.qLeft)&&finite(f.qRight));
    const clocks={};F.forEach(f=>{const k=f.clockSource||'unknown';clocks[k]=(clocks[k]||0)+1;});
    const pose=F.filter(f=>[f.cx,f.cy,f.fw].every(finite)&&f.fw>0),motion=pose.slice(1).flatMap((f,i)=>{const p=pose[i],dt=f.t-p.t;return dt>0&&dt<=200?[Math.hypot(f.cx-p.cx,f.cy-p.cy)/f.fw*100000/dt]:[];});
    let lumJumps=0;for(let i=1;i<F.length;i++)if(F[i].t-F[i-1].t<=200&&finite(F[i].lum)&&finite(F[i-1].lum)&&Math.abs(F[i].lum-F[i-1].lum)>12)lumJumps++;
    return {frames:F.length,durationSec:round(span/1000),fps:span?round((F.length-1)*1000/span):null,intervalMs:stats(dt),gapsOver200ms:dt.filter(v=>v>200).length,
      captureDelayMs:stats(F.map(f=>f.captureDelayMs)),callbackLateMs:stats(F.map(f=>f.callbackLateMs)),inferenceLagMs:stats(F.map(f=>f.lag)),roiAgeMs:stats(F.map(f=>f.roiAge)),
      luminance:stats(lum),dimFraction:lum.length?round(lum.filter(v=>v<40).length/lum.length):null,illuminationJumps:lumJumps,inferenceGain:stats(gain),clockSources:clocks,
      monocularFraction:eyes.length?round(eyes.filter(f=>(f.qLeft>.035)!==(f.qRight>.035)).length/eyes.length):null,
      skinCoverage:span?round(coverage(F.filter(f=>f.ppgOk??f.ok),F[0].t,F.at(-1).t)):0,
      observedEyeFrames:eyes.length,eyeQuality:stats(eyes.map(f=>Math.max(f.qLeft,f.qRight))),leftEyeQuality:stats(eyes.map(f=>f.qLeft)),rightEyeQuality:stats(eyes.map(f=>f.qRight)),headMotionPctPerSec:stats(motion),
      regions:[0,1,2].map(k=>({region:['forehead','cheek-1','cheek-2'][k],observedFrames:F.filter(f=>f.rr?.[k]?.every(finite)).length,quality:stats(F.map(f=>f.rq?.[k]))}))};
  }
  function actions(audit){
    const out=[],add=(key,test,priority,evidence,next)=>out.push({key,test,priority,evidence,next,status:'proposed',ruleVersion:VERSION});
    if(audit.outcome!=='complete')add('incomplete','session','high',{outcome:audit.outcome},'중단 단계와 오류·획득 경로를 재현하고 완료 실패 원인을 확인');
    const a=audit.acquisition;
    if(a.gapsOver200ms||a.intervalMs.p95>100)add('frame-gaps','capture','high',{gaps:a.gapsOver200ms,p95Ms:a.intervalMs.p95},'프레임 누락·추론 지연을 분리해 재현하고 동일 시간의 유효 관측량 비교');
    if(a.dimFraction>.3||a.illuminationJumps>3)add('lighting','capture','medium',{dimFraction:a.dimFraction,jumps:a.illuminationJumps},'저조도와 노출 변화를 구분해 피부 영역·추정법별 오차 비교');
    if((a.clockSources.callback||0)||(a.clockSources.unknown||0))add('clock-fallback','capture','medium',a.clockSources,'촬영 시각 미제공 구간의 지연 불확실성 평가');
    if(a.monocularFraction>.2)add('one-eye','gaze','medium',{fraction:a.monocularFraction},'반사·가림 조건에서 단안 보정 오차와 활용률 비교');
    if(audit.timing.onsetDelayMs.p95>50||audit.timing.inputDispatchMs.p95>50)add('timing-delay','response','high',audit.timing,'자극 예약 지연과 입력 처리 지연을 확인; 물리적 화면 지연과 구분');
    for(const t of audit.tests){
      if(['off','not-started'].includes(t.status))continue;
      if(t.pulse&&(!finite(t.pulse.bpm)||t.pulse.coverage<.5))add('pulse-support:'+t.key,t.key,'medium',{coverage:t.pulse.coverage,seconds:t.pulse.validSeconds},'짧은 유효 구간과 추정법별 후보를 기준 장비로 비교');
      if(t.indicators.some(i=>i.excluded))add('partial:'+t.key,t.key,'medium',{excluded:t.indicators.filter(i=>i.excluded).map(i=>i.key)},'제외 원인을 검토하고 활용 가능한 부분 지표를 유지');
    }
    if(!audit.reference||!audit.reference.metrics?.pairs)add('reference-needed','pulse','medium',{status:audit.reference?.status||'missing'},'기준 장비 동시 측정 또는 동기화 근거가 있는 기준 CSV 연결');
    else if(audit.reference.metrics.mae>5)add('reference-error','pulse','high',{mae:audit.reference.metrics.mae,pairs:audit.reference.metrics.pairs},'기준 신호 품질과 시간 정렬을 먼저 확인한 뒤 보정 후보 비교');
    if(audit.reference?.status==='exploratory')add('reference-provenance','pulse','medium',{sync:audit.reference.sync,source:audit.reference.source},'기준 장비와 동기화 불확실성을 검증한 뒤 정확도 평가에 포함');
    return out;
  }
  function build(rec,res=null,opt={}){
    const F=[...(rec.telemetry?.calibrationFrames||[]),...(rec.frames||[])],t0=finite(rec.startedAt)?rec.startedAt:(F[0]?.t??0),end=finite(rec.endedAt)?rec.endedAt:(F.at(-1)?.t??t0),hidden=rec.hidden||[];
    const visible=F.filter(f=>!hidden.some(h=>f.t>=h.start-500&&f.t<=(h.end??end)+1500));
    const b=res?.battery,events=rec.telemetry?.stimuli||[];
    const tests=Object.keys(LABELS).map(key=>{
      const step=rec.steps?.[key],span=rec.telemetry?.steps?.[key]||rec.phases?.[key];
      const start=span?.start,stop=span?.end??end,rows=finite(start)?visible.filter(f=>f.t>=start&&f.t<=stop):[];
      const phase=res?.evidence?.phases?.[key];
      return {key,label:LABELS[key],status:step?.status||'not-started',start:finite(start)?start-t0:null,end:finite(start)?stop-t0:null,
        acquisition:acquisition(rows),pulse:phase||null,indicators:(b?.indicators||[]).filter(i=>KEYS[key]?.test(i.key)).map(i=>({key:i.key,label:i.label,value:i.value,unit:i.unit,r:i.r,excluded:!!i.excluded,status:i.status}))};
    });
    const audit={schema:VERSION,attemptId:rec.attemptId||null,outcome:opt.outcome||rec.outcome||'complete',errorCode:opt.errorCode||rec.errorCode||null,
      measuredAt:rec.measuredAt||null,protocol:rec.lab?{kind:'lab',steps:rec.lab}:{kind:'full'},durationSec:round(Math.max(0,end-t0)/1000),versions:{core:res?.version||null,battery:b?.version||null,fusion:res?.evidence?.version||null},
      acquisition:acquisition(visible),timing:{onsetDelayMs:stats(events.map(e=>e.onset-e.requested)),inputDispatchMs:stats((rec.telemetry?.inputs||[]).map(e=>e.dispatchMs)),stimuli:events.length,physicalDisplayLatency:'unmeasured'},
      gaze:{calibration:rec.calibration?{grade:rec.calibration.grade,errPct:rec.calibration.errPct,samples:rec.calibration.samples,shadow:rec.calibration.fine?.shadow||null}:null,evaluation:rec.calibLog?.evaluation||null,drift:(rec.telemetry?.drift||[]).map(d=>({...d,t:d.t-t0})),validation:'model-selection-or-internal; not independent ground truth'},
      tests,interpretation:{status:'not-externally-validated',domains:b?Object.fromEntries(Object.entries(b.domains).map(([k,d])=>[k,{score:d.score,status:d.status,confidence:d.confidence}])):{}},
      hiddenSeconds:round(hidden.reduce((s,h)=>s+Math.max(0,(h.end??end)-h.start),0)/1000),reference:null};
    if(rec.reference?.samples?.length&&res?.evidence?.windows){
      audit.reference=compare(res.evidence.windows.map(w=>({...w,start:w.start-t0,end:w.end-t0})),{...rec.reference,samples:rec.reference.samples.map(p=>({...p,t:p.t-t0}))},{start:(rec.frames?.[0]?.t??t0)-t0,end:(rec.frames?.at(-1)?.t??end)-t0});
    }
    audit.actions=actions(audit);return audit;
  }
  function parseCSV(text){
    const lines=String(text).replace(/^\uFEFF/,'').trim().split(/\r?\n/);if(lines.length<3||lines.length>100001)throw Error('CSV는 헤더와 2~100000개 표본이 필요합니다.');
    const head=lines.shift().split(',').map(s=>s.trim());if(head.join(',')!=='t_ms,bpm,quality')throw Error('CSV 헤더: t_ms,bpm,quality');
    const samples=lines.map((l,i)=>{const c=l.split(',').map(s=>s.trim());if(c.length!==3||c.some(s=>s===''))throw Error('CSV '+(i+2)+'행의 열을 확인하세요.');const [t,bpm,quality]=c.map(Number);if(![t,bpm,quality].every(finite)||bpm<20||bpm>250||![0,1].includes(quality))throw Error('CSV '+(i+2)+'행: 시각·심박·품질(0/1)을 확인하세요.');return {t,bpm,quality};});
    for(let i=1;i<samples.length;i++)if(samples[i].t<=samples[i-1].t)throw Error('CSV 시각은 중복 없이 증가해야 합니다.');return samples;
  }
  function align(samples,sync){
    const {offsetMs=0,driftPpm=0}=sync||{};
    if(!finite(offsetMs)||!finite(driftPpm)||Math.abs(driftPpm)>5000)throw Error('동기화 오프셋 또는 드리프트 범위를 확인하세요.');
    return samples.map(s=>({...s,t:s.t*(1+driftPpm/1e6)+offsetMs}));
  }
  function anchors(a,b){
    if(!a||!b||![a.referenceMs,a.sessionMs,b.referenceMs,b.sessionMs].every(finite)||b.referenceMs<=a.referenceMs)throw Error('서로 다른 두 동기화 표식이 필요합니다.');
    const scale=(b.sessionMs-a.sessionMs)/(b.referenceMs-a.referenceMs);
    const sync={offsetMs:a.sessionMs-a.referenceMs*scale,driftPpm:(scale-1)*1e6};align([],sync);return sync;
  }
  function intervalReference(samples,start,end){
    let area=0,ms=0;
    for(let i=1;i<samples.length;i++){
      const a=samples[i-1],b=samples[i],dt=b.t-a.t;
      if(a.quality!==1||b.quality!==1||dt<=0||dt>2500)continue;
      const l=Math.max(start,a.t),r=Math.min(end,b.t);if(r<=l)continue;
      const value=t=>a.bpm+(b.bpm-a.bpm)*(t-a.t)/dt;area+=(value(l)+value(r))/2*(r-l);ms+=r-l;
    }
    return {bpm:ms?area/ms:null,coverage:end>start?ms/(end-start):0};
  }
  function metrics(pairs,threshold=5){
    if(!pairs.length)return {pairs:0,mae:null,rmse:null,bias:null,p95AbsoluteError:null,withinTolerance:null,toleranceBpm:threshold};
    const e=pairs.map(p=>p.bpm-p.referenceBpm);
    return {pairs:e.length,mae:round(mean(e.map(Math.abs))),rmse:round(Math.sqrt(mean(e.map(v=>v*v)))),bias:round(mean(e)),p95AbsoluteError:round(quantile(e.map(Math.abs),.95)),withinTolerance:round(e.filter(v=>Math.abs(v)<=threshold).length/e.length),toleranceBpm:threshold};
  }
  function estimateInterval(windows,start,end){
    const rows=windows.filter(w=>(w.usable??w.snr>=-2)&&finite(w.bpm)&&w.start<end&&w.end>start);
    const edges=[...new Set([start,end,...rows.flatMap(w=>[Math.max(start,w.start),Math.min(end,w.end)])])].sort((a,b)=>a-b);
    let ms=0,weighted=0,total=0,quality=0;
    for(let i=1;i<edges.length;i++){const a=edges[i-1],b=edges[i],active=rows.filter(w=>w.start<=a&&w.end>=b).sort((x,y)=>(y.confidence??.65)-(x.confidence??.65));
      if(!active.length)continue;const w=active[0],q=w.confidence??.65,dt=b-a;ms+=dt;quality+=dt*q;weighted+=dt*q*w.bpm;total+=dt*q;
    }
    return {bpm:total?weighted/total:null,coverage:end>start?ms/(end-start):0,confidence:ms?quality/ms:0};
  }
  function compare(windows,reference,bounds={}){
    const sync=reference.sync||{offsetMs:0,driftPpm:0,uncertaintyMs:null,method:'receipt-time'};
    const raw=reference.samples||[];
    if(raw.some((s,i)=>![s.t,s.bpm].every(finite)||s.bpm<20||s.bpm>250||![0,1].includes(s.quality)||(i&&s.t<=raw[i-1].t)))throw Error('기준 표본의 시각·범위·품질을 확인하세요.');
    const samples=align(raw,sync);let eligible=0;
    const pairs=[];
    // Fixed disjoint ten-second epochs shared across engine versions. Reference-observed
    // epochs with NO pulse output remain in the denominator. Overlap adds no sample count.
    const valid=windows.filter(w=>finite(w.start)&&finite(w.end)&&w.end>w.start);
    const start=finite(bounds.start)?bounds.start:(valid.length?Math.min(...valid.map(w=>w.start)):0),end=finite(bounds.end)?bounds.end:(valid.length?Math.max(...valid.map(w=>w.end)):start);
    if(end-start>7200000)throw Error('비교 범위는 2시간 이하여야 합니다.');
    for(let t=start;t+10000<=end+1;t+=10000){
      const ref=intervalReference(samples,t,t+10000);if(ref.coverage<.8)continue;eligible++;
      const w=estimateInterval(valid,t,t+10000);if(w.coverage<.8||!finite(w.bpm))continue;
      pairs.push({start:t,end:t+10000,bpm:w.bpm,referenceBpm:ref.bpm,confidence:w.confidence,error:round(w.bpm-ref.bpm)});
    }
    const verified=reference.verified===true&&finite(sync.uncertaintyMs)&&sync.uncertaintyMs>=0&&sync.uncertaintyMs<=100;
    return {status:pairs.length?(verified?'paired':'exploratory'):'no-overlap',source:reference.source||'unspecified',verified:reference.verified===true,sync,bounds:{start,end},epochSeconds:10,
      metrics:metrics(pairs),eligibleWindows:eligible,acceptedFraction:eligible?round(pairs.length/eligible):null,
      riskCoverage:[0,.5,.65,.8].map(c=>{const use=pairs.filter(p=>p.confidence>=c);return {minConfidence:c,coverage:eligible?round(use.length/eligible):null,...metrics(use)};}),pairs};
  }
  function cohort(rows){
    const completed=rows.filter(r=>r.outcome==='complete'),paired=rows.filter(r=>r.reference?.status==='paired'&&r.reference.metrics.pairs);
    return {attempts:rows.length,completed:completed.length,completionRate:rows.length?round(completed.length/rows.length):null,
      pairedSessions:paired.length,exploratorySessions:rows.filter(r=>r.reference?.status==='exploratory').length,
      sessionMeanMae:round(mean(paired.map(r=>r.reference.metrics.mae))),within5BpmSessions:paired.filter(r=>r.reference.metrics.p95AbsoluteError<=5).length,
      accurateYield:rows.length?round(paired.filter(r=>r.reference.metrics.p95AbsoluteError<=5).length/rows.length):null,
      // This is evaluated yield among recorded, consented attempts, not population diagnostic accuracy.
      scope:'loaded-consented-attempts',pendingActions:rows.reduce((s,r)=>s+(r.actions||[]).length,0)};
  }
  return {VERSION,LABELS,acquisition,build,actions,parseCSV,align,anchors,compare,metrics,cohort};
});
