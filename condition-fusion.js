/* Evidence fusion for casual webcam acquisition. Weights are engineering scores,
 * not clinical probabilities. Methods sharing pixels never count as independent ROIs. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory;
  if(root)root.NLFusionFactory=factory;
})(typeof globalThis!=='undefined'?globalThis:null,function(N){
  'use strict';
  const VERSION='condition-fusion-4',finite=Number.isFinite;
  // 'aggregate'(전체 피부 평균)와 'combined'(영역 파형 합성)는 영역들과 픽셀을 공유하므로 독립 영역으로 세지 않는다
  const SHARED=new Set(['aggregate','combined']),physicalRoi=p=>!SHARED.has(p.roi);
  const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
  function weightedQuantile(rows,key,q=.5){
    const sorted=rows.filter(r=>finite(r[key])&&r.weight>0).slice().sort((a,b)=>a[key]-b[key]);
    const total=sorted.reduce((s,r)=>s+r.weight,0);let sum=0;
    for(const r of sorted){sum+=r.weight;if(sum>=q*total)return r[key];}
    return null;
  }
  function periodicity(x,fs){
    const m=N.mean(Array.from(x));let best={r:0,bpm:null};
    for(let lag=Math.ceil(fs/3);lag<=Math.floor(fs/.7)&&lag<x.length/2;lag++){
      let xy=0,xx=0,yy=0;
      for(let i=lag;i<x.length;i++){const a=x[i]-m,b=x[i-lag]-m;xy+=a*b;xx+=a*a;yy+=b*b;}
      const r=xx*yy>1e-20?xy/Math.sqrt(xx*yy):0;
      if(r>best.r+.015)best={r,bpm:60*fs/lag};
    }
    return best;
  }
  /* 지정한 박동 주기(lag)에서의 자기상관: 유도 후보가 그 영역 파형 안에서 실제로 반복되는지 확인한다 */
  function periodAt(x,fs,bpm){
    const m=N.mean(Array.from(x)),L=Math.round(60*fs/bpm);let best=0;
    for(let lag=Math.max(1,L-1);lag<=L+1&&lag<x.length/2;lag++){
      let xy=0,xx=0,yy=0;
      for(let i=lag;i<x.length;i++){const a=x[i]-m,b=x[i-lag]-m;xy+=a*b;xx+=a*a;yy+=b*b;}
      best=Math.max(best,xx*yy>1e-20?xy/Math.sqrt(xx*yy):0);
    }
    return best;
  }
  /* 영역 합성 + 유도 검증 (DistancePPG: Kumar et al., 2015 의 SNR 가중 결합):
   * 약한 신호에서는 영역마다 잡음 피크가 제각각 최대가 되어 '영역 불일치'로 창이 버려진다. 영역 파형(같은 추정법)을 표준화해
   * 각자의 SNR 로 가중 합하면 독립 잡음은 상쇄되고 공통 맥박은 남는다. 합성 파형의 주파수가 자기상관과도 맞을 때만,
   * 그 주파수 ±0.1Hz 에서 각 영역이 가진 근거(스펙트럼 SNR·그 주기의 자기상관)를 후보로 더한다.
   * 값을 만들지 않는다: 영역 후보는 각 영역 자료에서 잰 것이고, 채택은 기존 융합 기준(2영역 이상·주기성·SNR)을 그대로 거친다 */
  function guided(rows,fs,opt={}){
    const out=[];
    for(const method of ['pos','chrom']){
      const set=rows.filter(r=>r.method===method&&physicalRoi(r));
      if(set.length<2)continue;
      const len=Math.min(...set.map(r=>r.seg.length)),comb=new Float64Array(len);
      for(const r of set){
        const a=Array.from(r.seg.subarray(0,len)),m=N.mean(a),sd=N.std(a)||1,w=clamp((r.pk.snrDb+10)/16,.05,1)*(.5+.5*r.pixelQ);
        for(let i=0;i<len;i++)comb[i]+=w*(a[i]-m)/sd;
      }
      const pkC=N.spectralPeak(comb,fs);if(!pkC||pkC.snrDb<(opt.guideSnr??-2))continue;
      const acC=periodicity(comb,fs);if(!acC.bpm||Math.abs(acC.bpm-pkC.bpm)>6||acC.r<(opt.guideR??.3))continue;
      out.push({roi:'combined',method,bpm:pkC.bpm,snr:pkC.snrDb,period:acC.r,recovered:N.mean(set.map(r=>r.recovered)),pixelQ:N.mean(set.map(r=>r.pixelQ)),
        weight:.3*(.2+.8*clamp((pkC.snrDb+10)/16))*(.25+.75*acC.r),_wave:comb,guided:true});
      const f=pkC.bpm/60;
      for(const r of set){
        if(Math.abs(r.pk.bpm-pkC.bpm)<=1.5)continue;                       // 이미 같은 주파수가 그 영역의 최대 피크
        const g=N.spectralPeak(r.seg,fs,Math.max(.7,f-.1),Math.min(3,f+.1));if(!g)continue;
        const period=periodAt(r.seg,fs,g.bpm);
        out.push({roi:r.roi,method,bpm:g.bpm,snr:g.snrDb,period,recovered:r.recovered,pixelQ:r.pixelQ,
          weight:.85*(.2+.8*clamp((g.snrDb+10)/16))*(.25+.75*period)*(.5+.5*r.pixelQ)*(1-r.recovered),_wave:r.seg,guided:true});
      }
    }
    return out;
  }
  function fuse(candidates){
    if(!candidates.length)return null;
    let best=null;
    for(const center of candidates){
      const cluster=candidates.filter(p=>Math.abs(p.bpm-center.bpm)<=5),groups=new Map();
      for(const p of cluster){
        const key=p.roi,old=groups.get(key);
        if(!old||p.weight>old.weight)groups.set(key,p);
      }
      const rows=[...groups.values()],score=rows.reduce((s,p)=>s+p.weight,0);
      if(!best||score>best.score)best={rows,cluster,score};
    }
    const rows=best.rows,rois=rows.filter(physicalRoi),spatial=rois.length||1;
    const physical=rois.length?rois:rows;
    const coherence=[];
    for(let i=0;i<physical.length;i++)for(let j=0;j<i;j++){
      const a=physical[i]._wave,b=physical[j]._wave;if(!a||!b)continue;
      const ma=N.mean(Array.from(a)),mb=N.mean(Array.from(b));let xy=0,xx=0,yy=0;
      for(let k=0;k<Math.min(a.length,b.length);k++){const x=a[k]-ma,y=b[k]-mb;xy+=x*y;xx+=x*x;yy+=y*y;}
      coherence.push(xx*yy>1e-20?Math.abs(xy/Math.sqrt(xx*yy)):0);
    }
    const spatialCoherence=coherence.length?N.median(coherence):null;
    const methods=[...new Set(best.cluster.filter(p=>p.period>=.35&&p.snr>=-7&&physical.some(r=>r.roi===p.roi)).map(p=>p.method))];
    const bpm=weightedQuantile(physical,'bpm');
    const avg=key=>physical.reduce((s,p)=>s+p[key]*p.weight,0)/physical.reduce((s,p)=>s+p.weight,0);
    const snr=avg('snr'),period=avg('period'),recovered=avg('recovered'),pixelQ=avg('pixelQ');
    const strongestByRoi=new Map();
    candidates.forEach(p=>strongestByRoi.set(p.roi,Math.max(strongestByRoi.get(p.roi)||0,p.weight)));
    const agreement=best.score/[...strongestByRoi.values()].reduce((a,b)=>a+b,0);
    const spread=Math.sqrt(avgSquared(physical,bpm));
    const corroborated=spatial>=2&&agreement>=.5&&period>=.4&&snr>=-7;
    const single=spatial===1&&agreement>=.5&&period>=.55&&snr>=-1&&(methods.length>=2||snr>=3);
    const usable=(corroborated||single)&&methods.some(m=>m!=='green')&&(spatialCoherence===null||spatialCoherence>=.25);
    const recoverable=spatial>=2&&agreement>=.5&&period>=.25&&snr>=-7&&methods.some(m=>m!=='green');
    const confidence=clamp((.3+.4*clamp((snr+7)/13)+.3*period)*(.65+.35*agreement)*(.65+.35*pixelQ)*(1-recovered)*(spatial>=2?1:.8));
    return {bpm,snr,period,spatialCoherence,candidateConfidence:confidence,recoverable,confidence:usable?confidence:Math.min(confidence,.29),usable,
      quality:usable?(snr>=3&&confidence>=.65?'good':'fair'):'poor',
      status:usable?(snr>=3?'measured':'supported'):'uncertain',recovered,agreement,spread,
      regions:physical.map(p=>p.roi),methods,n:physical.length,
      reason:usable?null:agreement<.5?'conflicting-regions':'weak-periodicity',
      alternatives:candidates.map(({roi,method,bpm,snr,period,weight,pixelQ,recovered,_wave,guided})=>{
        const value={roi,method,bpm,snr,period,weight,pixelQ,recovered};if(guided)value.guided=true;Object.defineProperty(value,'_wave',{value:_wave});return value;
      })};
  }
  function avgSquared(rows,m){const den=rows.reduce((s,r)=>s+r.weight,0);return rows.reduce((s,r)=>s+r.weight*(r.bpm-m)**2,0)/den;}
  function windows(sig,winSec=10,stepSec=1,opt={}){
    if(!sig)return [];
    const {fs,t0,bvp}=sig,step=Math.max(1,Math.round(stepSec*fs));
    const lower=finite(opt.start)?Math.max(0,Math.ceil((opt.start-t0)*fs/1000)):0;
    const upper=finite(opt.end)?Math.min(bvp.length,Math.floor((opt.end-t0)*fs/1000)+1):bvp.length;
    const sources=sig.candidates||[{roi:'aggregate',method:'pos',wave:bvp,repairs:sig.repaired}];
    const out=[];
    for(let s=lower;s+6*fs<=upper;s+=step){
      let chosen=null;
      // Weak but continuous observations can gain frequency resolution with a longer window.
      // This uses already captured data; the test duration and phase boundaries stay fixed.
      for(const sec of [...new Set([winSec,16,6])].filter(v=>v>=6)){
        const wl=Math.round(sec*fs);if(s+wl>upper)continue;
        const start=t0+s*1000/fs,end=t0+(s+wl-1)*1000/fs;
        if((opt.jumps||[]).some(t=>start<t+750&&end>t-750))continue;
        const candidates=[],raw=[];
        for(const c of sources){
          const seg=c.wave.subarray(s,s+wl);
          if(!seg.every(finite)||N.std(Array.from(seg))<1e-9)continue;
          // Large frame-to-frame colour-ratio jumps are optical artefacts, not a weak pulse.
          // Common brightness changes cancel in the ratios; small noisy observations remain usable.
          if(c.jitter&&N.mean(Array.from(c.jitter.subarray(s,s+wl)))>.08)continue;
          const recovered=c.repairs?c.repairs.subarray(s,s+wl).reduce((a,b)=>a+b,0)/wl:0;
          if(recovered>.25)continue;
          const pk=N.spectralPeak(seg,fs);if(!pk)continue;
          const ac=periodicity(seg,fs),peaks=[pk];
          // Resolve a doubled spectral peak only when a full-period candidate is also observed.
          if(ac.r>.65&&ac.bpm&&Math.abs(pk.bpm/ac.bpm-2)<.15){
            const half=N.spectralPeak(seg,fs,Math.max(.7,ac.bpm/60-.08),Math.min(3,ac.bpm/60+.08));
            if(half)peaks.push(half);
          }
          const pixelQ=c.quality?N.mean(Array.from(c.quality.subarray(s,s+wl))):1;
          raw.push({roi:c.roi,method:c.method,seg,pk,pixelQ,recovered});
          for(const p of peaks){
            const agreement=ac.bpm?clamp(1-Math.abs(ac.bpm-p.bpm)/15):0;
            const period=ac.r*(.45+.55*agreement);
            const weight=(c.roi==='aggregate'&&sources.some(p=>p.roi!=='aggregate')?.3:1)*(.2+.8*clamp((p.snrDb+10)/16))*(.25+.75*period)*(.5+.5*pixelQ)*(1-recovered);
            candidates.push({roi:c.roi,method:c.method,bpm:p.bpm,snr:p.snrDb,period,recovered,pixelQ,weight,_wave:seg});
          }
        }
        if(opt.guided!==false)candidates.push(...guided(raw,fs,opt));
        const fused=fuse(candidates);if(!fused)continue;
        if(sec<8&&fused.period<.55){fused.usable=false;fused.recoverable=false;fused.quality='poor';fused.status='uncertain';fused.confidence=Math.min(fused.confidence,.29);fused.reason='short-window-ambiguity';}
        const result={...fused,start,end,t:(start+end)/2,windowSec:sec};
        if(!chosen||(!chosen.usable&&result.usable)||result.confidence>chosen.confidence+.12||(result.usable&&sec>chosen.windowSec&&result.confidence>=chosen.confidence-.04))chosen=result;
        if(result.usable&&(result.snr>=3||sec===16))break;
      }
      if(chosen)out.push(chosen);
    }
    // Weak support must recur at a distinct time, or have strong spatial/period evidence.
    // This changes acceptance, never the measured BPM or an actual rapid transition.
    return track(out.map(w=>{
      if(!w.usable){
        const nearby=out.filter(v=>Math.abs(v.t-w.t)<=16000);
        const matches=(v,bpm)=>v.alternatives.filter(p=>physicalRoi(p)&&p.snr>=-7&&p.period>=.2&&Math.abs(p.bpm-bpm)<=5);
        let accumulated=null;
        for(const anchor of w.alternatives.filter(p=>p.method!=='green')){
          const current=matches(w,anchor.bpm);
          if(new Set(current.map(p=>p.roi)).size<2)continue;
          const agreeing=nearby.filter(v=>new Set(matches(v,anchor.bpm).map(p=>p.roi)).size>=2);
          // Distinct epochs span at least ten seconds, not just repeated algorithms on one clip.
          if(agreeing.length<4||Math.max(...agreeing.map(v=>v.t))-Math.min(...agreeing.map(v=>v.t))<10000)continue;
          const candidate=fuse(current);
          if(candidate&&candidate.spatialCoherence>=.3&&candidate.methods.some(m=>m!=='green')&&(!accumulated||candidate.candidateConfidence>accumulated.candidateConfidence))accumulated=candidate;
        }
        if(accumulated)return {...w,...accumulated,alternatives:w.alternatives,usable:true,quality:'fair',status:'supported',confidence:accumulated.candidateConfidence*.9,reason:'accumulated-weak-evidence'};
      }
      if(!w.usable&&w.recoverable&&w.windowSec>=10&&w.spatialCoherence>=.3){
        const same=out.filter(v=>v.recoverable&&v.windowSec>=10&&Math.abs(v.t-w.t)<=16000&&Math.abs(v.bpm-w.bpm)<=5);
        if(same.length>=4&&Math.max(...same.map(v=>v.t))-Math.min(...same.map(v=>v.t))>=10000)
          return {...w,usable:true,quality:'fair',status:'supported',confidence:w.candidateConfidence*.9,reason:'accumulated-weak-evidence'};
      }
      if(!w.usable||w.snr>=3||(w.n>=3&&w.period>=.7))return w;
      const supported=out.some(v=>v!==w&&v.usable&&Math.abs(v.t-w.t)>=1800&&Math.abs(v.t-w.t)<=12000&&Math.abs(v.bpm-w.bpm)<=8);
      return supported?w:{...w,usable:false,quality:'poor',status:'uncertain',confidence:Math.min(w.confidence,.29),reason:'unconfirmed-weak-window'};
    }).sort((a,b)=>a.t-b.t));
  }
  /* 시간 연속성 추적(tracked): 심박은 몇 초 사이에 크게 뛰지 않는다는 생리적 연속성을 이용한다.
   * 채택 기준에 못 미친 창이라도, 그 창 안에서 실제로 관측된 색차 기반(POS·CHROM) 후보 주파수 가운데
   * ① 앞뒤 20초 안 확실한 창들의 흐름(시간 가중 중앙값)에서 6bpm 이내인 것이 있으면, 또는
   * ② 확실한 창이 없을 때는 앞뒤 8초 안 이웃 창 3개 이상이 5bpm 안에서 일치하고 두 피부 영역 이상이 같은 후보를 지지하면
   * 그 후보로 받아들인다. 값을 새로 만들지 않고, 관측된 후보 중 하나를 고를 뿐이다. 원래 값(rawBpm)과 보정 근거를 남긴다 */
  function track(rows){
    const sure=rows.filter(w=>w.usable&&finite(w.bpm));
    const wmed=list=>{const s=list.slice().sort((a,b)=>a.bpm-b.bpm),tot=s.reduce((a,v)=>a+v.weight,0);let acc=0;for(const v of s){acc+=v.weight;if(acc>=tot/2)return v.bpm;}return null;};
    /* 국소 심박 사전값: 창마다 색차 후보(POS·CHROM, SNR≥-8)를 1bpm 칸에 가중치로 쌓고, 앞뒤 30초를 합쳐 ±3bpm 질량이 가장 큰 곳을 찾는다.
     * 잡음 피크는 시점마다 흩어지고 맥박은 한 곳에 쌓인다. 균등 분포 기대치의 3배 이상이고 서로 다른 10초 구간 3곳 이상이 지지할 때만 쓴다 */
    const LO=40,NB=141,hist=rows.map(w=>{const h=new Float64Array(NB);(w.alternatives||[]).forEach(p=>{if(p.method!=='green'&&!p.guided&&finite(p.bpm)&&p.snr>=-8&&p.weight>0){const b=Math.round(p.bpm)-LO;if(b>=0&&b<NB)h[b]+=p.weight;}});return h;});
    const localPrior=t=>{
      const idx=rows.map((v,i)=>i).filter(i=>Math.abs(rows[i].t-t)<=30000);if(idx.length<12)return null;
      const sum=new Float64Array(NB);idx.forEach(i=>{for(let b=0;b<NB;b++)sum[b]+=hist[i][b];});
      const total=sum.reduce((a,b)=>a+b,0);if(!(total>0))return null;
      let bb=-1,bm=0;for(let b=0;b<NB;b++){let m=0;for(let k=Math.max(0,b-3);k<=Math.min(NB-1,b+3);k++)m+=sum[k];if(m>bm){bm=m;bb=b;}}
      if(bm<3*total*7/NB)return null;
      const epochs=new Set(idx.filter(i=>{let m=0;for(let k=Math.max(0,bb-3);k<=Math.min(NB-1,bb+3);k++)m+=hist[i][k];return m>0;}).map(i=>Math.floor(rows[i].t/10000)));
      return epochs.size>=3?bb+LO:null;
    };
    return rows.map(w=>{
      if(w.usable||!finite(w.bpm))return w;
      const near=sure.filter(v=>Math.abs(v.t-w.t)<=20000);
      let ref=null,anchored=false,viaPrior=false;
      if(near.length>=2){ref=wmed(near.map(v=>({bpm:v.bpm,weight:1/(1+Math.abs(v.t-w.t)/5000)})));anchored=true;}
      else{
        // 1초 간격으로 겹친 이웃 창끼리의 일치는 같은 자료의 같은 잡음 피크일 수 있어(합성 실험: 심박 62 에서 77~95 채택) 쓰지 않는다.
        // 대신 앞뒤 30초 창들의 관측 후보가 서로 다른 10초 구간 3곳 이상에서 한 주파수에 모이는 경우(국소 심박 사전값)만 기준으로 쓴다
        const pr=localPrior(w.t);if(pr!==null){ref=pr;viaPrior=true;}
      }
      if(ref===null)return w;
      const cands=(w.alternatives||[]).filter(p=>p.method!=='green'&&finite(p.bpm)&&p.snr>=-8&&p.period>=.15);
      const pick=cands.slice().sort((a,b)=>Math.abs(a.bpm-ref)-Math.abs(b.bpm-ref))[0];
      if(!pick||Math.abs(pick.bpm-ref)>6)return w;
      const rois=new Set(cands.filter(p=>Math.abs(p.bpm-pick.bpm)<=5&&physicalRoi(p)).map(p=>p.roi)).size;
      if(!anchored&&(rois<2||Math.abs(pick.bpm-ref)>4))return w;
      const confidence=clamp(.3+.05*rois+.015*(pick.snr+8),.3,.55)*(anchored?1:.85);
      return {...w,bpm:pick.bpm,rawBpm:w.bpm,usable:true,quality:'fair',status:'tracked',confidence,reason:'temporal-continuity',
        correction:{kind:'temporal-continuity',reference:Math.round(ref*10)/10,anchored,prior:viaPrior,differenceBpm:Math.round((pick.bpm-ref)*10)/10,regions:rois,method:pick.method}};
    });
  }
  // Integrate support on unique time intervals. Overlapping windows add no extra seconds.
  function support(rows,start,end){
    const events=[];
    rows.forEach((w,i)=>{const a=Math.max(start,w.start??w.t),b=Math.min(end,w.end??w.t);if(b>a){events.push({t:a,i,on:true},{t:b,i,on:false});}});
    events.sort((a,b)=>a.t-b.t);const active=new Map(),weights=new Map();let seconds=0,effective=0,last=null;
    for(const ev of events){
      if(last!==null&&ev.t>last&&active.size){
        const dt=(ev.t-last)/1000;seconds+=dt;
        const list=[...active.keys()],best=list.reduce((a,b)=>(rows[a].confidence??.65)>=(rows[b].confidence??.65)?a:b);
        const q=rows[best].confidence??.65;effective+=dt*q;
        weights.set(best,(weights.get(best)||0)+dt*q);
      }
      if(ev.on)active.set(ev.i,true);else active.delete(ev.i);last=ev.t;
    }
    return {seconds,effective,weighted:[...weights].map(([i,weight])=>({...rows[i],weight}))};
  }
  function summarize(wins,start,end){
    const inside=wins.filter(w=>(w.start??w.t)>=start-.01&&(w.end??w.t)<=end+.01&&finite(w.bpm));
    const valid=inside.filter(w=>w.usable??w.snr>=-2),s=support(valid,start,end);
    const empty={bpm:null,snr:null,quality:'none',n:0,validSeconds:0,effectiveSeconds:0,coverage:0,confidence:0,spreadBpm:null,rangeBpm:null,recovered:0,status:'unavailable',candidateWindows:inside.length};
    if(!valid.length){
      /* 약한 신호(weak-signal): 후보 창은 있으나 채택 기준에 못 미친 경우 버리지 않고, 두 영역 이상이 동의한 창들로
       * 낮은 신뢰도의 추정치를 따로 보고한다. 판정용 품질은 'poor'로 두고(판정에서 제외), 보정 근거를 함께 남긴다 */
      // 색차 기반 추정법(POS·CHROM)이 함께 지지한 창만: 밝기만 깜빡이는 화면·조명은 색차에서 상쇄되므로 맥박으로 오인하지 않는다
      const weak=inside.filter(w=>(w.methods||[]).some(m=>m!=='green')&&(w.recoverable||(w.agreement>=.5&&w.snr>=-7&&(w.regions||[]).length>=2)));
      if(!weak.length)return empty;
      const sw=support(weak.map(w=>({...w,confidence:Math.min(.29,w.candidateConfidence??w.confidence??.2)})),start,end);
      const rowsW=sw.weighted.length?sw.weighted:weak.map(w=>({...w,weight:.2}));
      const bpmW=weightedQuantile(rowsW,'bpm'),spreadW=Math.sqrt(avgSquared(rowsW,bpmW));
      const snrW=rowsW.reduce((a,r)=>a+(r.snr||0)*r.weight,0)/rowsW.reduce((a,r)=>a+r.weight,0);
      const consistent=spreadW<=6&&weak.length>=3;
      return {...empty,bpm:bpmW,snr:snrW,quality:consistent?'fair':'poor',n:weak.length,validSeconds:sw.seconds,effectiveSeconds:sw.effective,
        coverage:clamp(sw.seconds/Math.max(.001,(end-start)/1000)),confidence:Math.min(consistent?.45:.29,sw.seconds?sw.effective/sw.seconds:.2),
        spreadBpm:spreadW,status:'weak-signal',candidateWindows:inside.length,
        correction:{kind:'weak-signal-recovery',rule:consistent?'≥3 windows, ≥2 skin regions agreeing, spread ≤6 bpm':'regions agree but windows inconsistent',windows:weak.length}};
    }
    // Legacy callers may provide only window centres; retain their existing summary contract.
    const rows=s.weighted.length?s.weighted:valid.map(w=>({...w,weight:w.confidence??.65}));
    const avg=key=>rows.reduce((a,r)=>a+(r[key]||0)*r.weight,0)/rows.reduce((a,r)=>a+r.weight,0);
    const bpm=weightedQuantile(rows,'bpm'),snr=avg('snr'),confidence=s.seconds?s.effective/s.seconds:avg('confidence')||.65;
    const spread=Math.sqrt(avgSquared(rows,bpm)),range=[weightedQuantile(rows,'bpm',.1),weightedQuantile(rows,'bpm',.9)];
    return {bpm,snr,quality:snr>=3&&confidence>=.65?'good':'fair',n:valid.length,
      validSeconds:s.seconds,effectiveSeconds:s.effective,coverage:clamp(s.seconds/Math.max(.001,(end-start)/1000)),
      confidence,spreadBpm:spread,rangeBpm:range,recovered:avg('recovered'),
      status:s.seconds<10||snr<3?'limited':'measured',candidateWindows:inside.length,
      methods:[...new Set(valid.flatMap(w=>w.methods||['pos']))],regions:[...new Set(valid.flatMap(w=>w.regions||[]))]};
  }
  return {VERSION,windows,fuse,support,summarize,periodicity};
});
