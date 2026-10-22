/* Experimental chest-motion observation. No respiratory rate is inferred from HR. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.NL2Respiration=api;})(typeof self!=='undefined'?self:globalThis,function(){
  'use strict';
  const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
  function detrend(a){const m=mean(a),center=(a.length-1)/2;let cov=0,den=0;for(let i=0;i<a.length;i++){cov+=(i-center)*(a[i]-m);den+=(i-center)**2;}return a.map((v,i)=>v-m-cov/(den||1)*(i-center));}
  const sd=a=>{const m=mean(a);return Math.sqrt(mean(a.map(v=>(v-m)**2)));};
  function correlation(a,b){const x=detrend(a),y=detrend(b);let cross=0,xx=0,yy=0;for(let i=0;i<x.length;i++){cross+=x[i]*y[i];xx+=x[i]**2;yy+=y[i]**2;}return xx&&yy?cross/Math.sqrt(xx*yy):0;}
  function peak(a){const x=detrend(a),bins=[];for(let rate=4;rate<=40;rate+=.25){let re=0,im=0;for(let i=0;i<x.length;i++){const v=x[i]*(.5-.5*Math.cos(2*Math.PI*i/(x.length-1))),p=2*Math.PI*rate/60*i/10;re+=v*Math.cos(p);im+=v*Math.sin(p);}bins.push({rate,power:re*re+im*im});}const best=bins.reduce((a,b)=>a.power>b.power?a:b);return {...best,concentration:bins.filter(b=>Math.abs(b.rate-best.rate)<=2).reduce((s,b)=>s+b.power,0)/bins.reduce((s,b)=>s+b.power,0)};}
  function windowEvidence(frames,start,end,phase){
    const base={phase,start,end,rate:null,reason:'가슴 움직임 관측 없음',source:'chest-optical-flow',experimental:true};
    if(end-start<30000)return {...base,reason:'자연 호흡 관찰 30초 미만'};
    const seen=new Set(),all=frames.filter(f=>f.phase===phase&&f.t>=start&&f.t<end&&!seen.has(f.t)&&seen.add(f.t));
    const rows=all.filter(f=>f.face&&(f.motion||0)<.045&&Math.abs(f.yaw||0)<.23&&(f.geometryAge||0)<180&&f.resp?.valid&&['left','right','background','head'].every(k=>Number.isFinite(f.resp[k])));
    if(rows.length<200||rows.length/Math.max(1,all.length)<.85||rows[0].t>start+250||rows.at(-1).t<end-250)return {...base,reason:'가슴 영역·옷의 질감·연속 관측이 충분하지 않음',observedFrames:rows.length};
    if(rows.some((f,i)=>i&&(f.t-rows[i-1].t>250||f.resp.epoch!==rows[0].resp.epoch)))return {...base,reason:'가슴 추적 중단 또는 자세 변경'};
    const signals={left:[],right:[],background:[],head:[]};let j=0;
    for(let t=start+250;t<=end-250;t+=100){while(j<rows.length-2&&rows[j+1].t<t)j++;const a=rows[j],b=rows[j+1],w=(t-a.t)/(b.t-a.t);for(const k of Object.keys(signals))signals[k].push(a.resp[k]+w*(b.resp[k]-a.resp[k]));}
    const left=detrend(signals.left),right=detrend(signals.right),a=peak(left),b=peak(right),rate=(a.rate+b.rate)/2,amplitude=Math.min(sd(left),sd(right));
    if(rate<8||rate>30)return {...base,reason:'연구 관측 범위(8–30회/분) 밖의 후보'};
    if(amplitude<.12||amplitude>8)return {...base,reason:'호흡 후보의 움직임 크기가 너무 작거나 큼'};
    if(Math.abs(a.rate-b.rate)>1.5||correlation(left,right)<.7||Math.min(a.concentration,b.concentration)<.5)return {...base,reason:'가슴 좌우의 주기 합의 부족'};
    if(rate*(end-start)/60000<4)return {...base,reason:'자연 호흡 후보가 4주기 미만'};
    for(const key of ['background','head'])if(sd(detrend(signals[key]))>amplitude*.5&&Math.abs(correlation(left,signals[key]))>.65)return {...base,reason:key==='head'?'고개 움직임과 겹쳐 호흡 분리 보류':'배경 움직임과 겹쳐 호흡 분리 보류'};
    const half=left.length>>1;if(Math.abs(peak(left.slice(0,half)).rate-peak(left.slice(half)).rate)>3)return {...base,reason:'앞뒤 호흡 주기 불일치'};
    return {...base,rate,halfWidth:Math.max(60/((end-start)/1000),Math.abs(a.rate-b.rate)/2),reason:'가슴 좌우 주기 합의 · 연구 관측',observedFrames:rows.length,cycles:rate*(end-start)/60000,waveform:left.filter((_,i)=>i%2===0).map(v=>v/amplitude),waveformHz:5};
  }
  function analyze(frames,phases,elapsed){return phases.filter(p=>['baseline','recovery'].includes(p.kind)&&p.end<=elapsed&&p.end-p.start>=30000).map(p=>windowEvidence(frames,p.start,p.end,p.id));}
  return {detrend,correlation,peak,windowEvidence,analyze};
});
