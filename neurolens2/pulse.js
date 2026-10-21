/* Physically motivated POS + CHROM comparison, with explicit candidate provenance.
 * Public methods are not claimed as NeuroLens inventions. Acceptance/lineage is separate. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.NL2Pulse=api;})(typeof self!=='undefined'?self:globalThis,function(){
  'use strict';
  const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
  const sd=a=>{const m=mean(a);return Math.sqrt(mean(a.map(v=>(v-m)**2)));};
  const median=a=>{const b=[...a].sort((x,y)=>x-y);return b.length?b[Math.floor(b.length/2)]:null;};
  function overlap(a,b){const x=Math.max(0,Math.min(a[0]+a[2],b[0]+b[2])-Math.max(a[0],b[0])),y=Math.max(0,Math.min(a[1]+a[3],b[1]+b[3])-Math.max(a[1],b[1]));return x*y/Math.max(1e-9,Math.min(a[2]*a[3],b[2]*b[3]));}
  function detrend(a){const n=a.length,m=mean(a),x=(n-1)/2;let cov=0,v=0;for(let i=0;i<n;i++){cov+=(i-x)*(a[i]-m);v+=(i-x)**2;}const slope=cov/(v||1);return a.map((z,i)=>z-m-slope*(i-x));}
  function spectrum(signal,fs=20){
    const data=detrend(signal),n=data.length,amplitude=sd(data);
    if(!Number.isFinite(amplitude)||amplitude<1e-6)return null;
    const samples=data.map((v,i)=>v*(.5-.5*Math.cos(2*Math.PI*i/(n-1))));
    const bins=[];
    for(let hz=.7;hz<=3.3;hz+=.025){let re=0,im=0;for(let i=0;i<n;i++){const p=2*Math.PI*hz*i/fs;re+=samples[i]*Math.cos(p);im+=samples[i]*Math.sin(p);}bins.push({hz,power:re*re+im*im});}
    const peak=bins.reduce((a,b)=>b.power>a.power?b:a),total=bins.reduce((s,b)=>s+b.power,0);
    const concentration=bins.filter(b=>Math.abs(b.hz-peak.hz)<=.10).reduce((s,b)=>s+b.power,0)/total;
    const alternatives=bins.filter((b,i)=>i>0&&i<bins.length-1&&b.power>bins[i-1].power&&b.power>bins[i+1].power&&Math.abs(b.hz-peak.hz)>.12).sort((a,b)=>b.power-a.power).slice(0,2).map(b=>({bpm:b.hz*60,relative:b.power/peak.power}));
    return {bpm:peak.hz*60,concentration,amplitude,alternatives};
  }
  function signals(rgb){
    const means=[0,1,2].map(c=>mean(rgb.map(r=>r[c])));
    if(means.some(m=>m<8))return null;
    const norm=rgb.map(r=>r.map((v,c)=>v/means[c]-1));
    const px=norm.map(r=>r[1]-r[2]),py=norm.map(r=>r[1]+r[2]-2*r[0]);
    const cx=norm.map(r=>3*r[0]-2*r[1]),cy=norm.map(r=>1.5*r[0]+r[1]-1.5*r[2]);
    if(sd(py)<1e-8||sd(cy)<1e-8)return null;
    return {POS:px.map((v,i)=>v+sd(px)/sd(py)*py[i]),CHROM:cx.map((v,i)=>v-sd(cx)/sd(cy)*cy[i])};
  }
  function resample(rows,start,end){
    if(rows.length<90||rows[0].t>start+200||rows.at(-1).t<end-200)return null;
    for(let i=1;i<rows.length;i++)if(rows[i].t-rows[i-1].t>200)return null;
    const rgb=[];let i=0;
    // Interpolated points feed the spectrum only; they never increase observed support.
    for(let t=start+200;t<end-200;t+=50){while(i<rows.length-2&&rows[i+1].t<t)i++;
      const a=rows[i],b=rows[i+1];if(!b||t<a.t||t>b.t)return null;const w=(t-a.t)/(b.t-a.t||1);rgb.push(a.rgb.map((v,c)=>v+(b.rgb[c]-v)*w));}
    return rgb;
  }
  function windowEvidence(frames,start,end,phase){
    const seen=new Set(),selected=frames.filter(f=>{if(f.t<start||f.t>=end||f.phase!==phase||seen.has(f.t))return false;seen.add(f.t);return true;}), candidates=[],adopted=[];
    const base={start,end,phase,bpm:null,halfWidth:null,reason:'유효 관측 부족',candidates,adopted,
      source:{modality:'camera',frameRange:[selected[0]?.t??null,selected.at(-1)?.t??null],observedFrames:selected.length}};
    if(selected.length<90)return base;
    const face=selected.filter(f=>f.face&&Math.abs(f.yaw||0)<.23&&(f.motion||0)<.045&&(f.geometryAge||0)<180);
    if(face.length/selected.length<.85)return {...base,reason:'얼굴·움직임·추적 연속성 기준 미달'};
    const ids=[...new Set(face.flatMap(f=>(f.rois||[]).map(r=>r.id)))];
    for(const id of ids){
      const rows=face.map(f=>{const r=f.rois?.find(x=>x.id===id);return r&&r.coverage>=.65?{t:f.t,...r}:null;}).filter(Boolean);
      const rgb=resample(rows,start,end);if(!rgb)continue;
      const s=signals(rgb);if(!s)continue;
      const methodResults=[];
      for(const method of ['POS','CHROM']){
        const p=spectrum(s[method]);if(!p)continue;
        const c={id:phase+'-'+start+'-'+id+'-'+method,roi:id,method,...p,observedFrames:rows.length,observedSpanMs:rows.at(-1).t-rows[0].t,
          box:[0,1,2,3].map(k=>median(rows.map(r=>r.box[k]))),parent:phase+':'+start+':camera:'+id,eligible:p.concentration>=.35};
        candidates.push(c);if(c.eligible)methodResults.push(c);
      }
      if(methodResults.length<2||Math.abs(methodResults[0].bpm-methodResults[1].bpm)>7.5)continue;
      const c={roi:id,bpm:mean(methodResults.map(c=>c.bpm)),box:methodResults[0].box,parents:methodResults.map(c=>c.id)};
      // Different algorithms over the same pixels never become independent support.
      if(adopted.some(a=>a.roi===c.roi||overlap(a.box,c.box)>.20))continue;
      adopted.push(c);
    }
    if(adopted.length<2)return {...base,reason:'서로 겹치지 않는 ROI 2개에서 POS·CHROM 합의 부족'};
    const bpm=median(adopted.map(c=>c.bpm)),spread=Math.max(...adopted.map(c=>c.bpm))-Math.min(...adopted.map(c=>c.bpm));
    if(spread>8)return {...base,reason:'얼굴 영역 간 주파수 불일치'};
    // Background pulsation at the same frequency is a confound, never corroboration.
    const bg=selected.filter(f=>Number.isFinite(f.background));
    if(bg.length>=90){const p=spectrum(bg.map(f=>f.background),1000/median(bg.slice(1).map((f,i)=>f.t-bg[i].t)));
      if(p&&p.amplitude>1.5&&p.concentration>.5&&Math.abs(p.bpm-bpm)<8)return {...base,reason:'배경 밝기와 동일한 주기: 조명 혼입 의심'};}
    return {...base,bpm,halfWidth:Math.max(60/((end-start)/1000)/2,spread/2,3),reason:'공간이 분리된 ROI 합의 채택',
      supportRegions:adopted.length,independentModalities:1,intervalMeaning:'주파수 분해능·ROI 편차의 공학적 후보 폭; 통계적 신뢰구간 아님'};
  }
  function analyze(frames,phases){const out=[];for(const phase of phases){if(['calibration','wrap'].includes(phase.kind))continue;
    for(let t=phase.start;t+12000<=phase.end;t+=12000)out.push(windowEvidence(frames,t,t+12000,phase.id));}return out;}
  return {overlap,detrend,spectrum,signals,resample,windowEvidence,analyze};
});
