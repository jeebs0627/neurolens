/* Numeric-only replay, isolated from the page and original saved report. */
importScripts('condition-signal.js','condition-fusion.js','newbiz-core.js');
self.onmessage=({data:p})=>{
  try{
    const frames=p.frames;if(!frames||!Array.isArray(frames.t)||frames.t.length>150000)throw Error('재분석 프레임 범위를 확인하세요.');
    const F=frames.t.map((t,i)=>{const f={t};for(const [k,s] of Object.entries(frames.scale||{})){if(k==='rr'||k==='rq')continue;const v=frames[k]?.[i];f[k]=Number.isFinite(v)?v/s:null;}
      const rr=frames.rr?.[i];f.rr=rr?[0,1,2].map(j=>{const c=rr.slice(j*3,j*3+3);return c.length===3&&c.every(Number.isFinite)?c.map(v=>v/100):null;}):undefined;
      f.rq=frames.rq?.[i]?.map(v=>Number.isFinite(v)?v/1000:0);
      if((p.hidden||[]).some(([a,b])=>t>=a-500&&t<=b+1500)){f.ok=false;f.ppgOk=false;}return f;
    });
    const windows=NLNewbiz.hrWindows(NLNewbiz.buildBvp(F),10,1,{jumps:NLNewbiz.lumJumps(F)});
    self.postMessage({version:NLNewbiz.VERSION,fusion:NLNewbiz.Fusion.VERSION,windows:windows.map(({start,end,t,bpm,snr,usable,confidence,status})=>({start,end,t,bpm,snr,usable,confidence,status}))});
  }catch(e){self.postMessage({error:String(e.message||e)});}
};
