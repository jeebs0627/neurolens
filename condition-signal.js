/* Webcam recovery primitives. No target positions or physiological priors are used.
 * Quality values are engineering weights, not calibrated probabilities. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NLSignal = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = 'condition-signal-1';
  const finite = Number.isFinite, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const median = a => { const s = a.filter(finite).sort((a,b)=>a-b); return s.length ? (s[(s.length-1)>>1]+s[s.length>>1])/2 : NaN; };

  function patch(ctx, box) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const x = clamp(Math.round(box.x), 0, W), y = clamp(Math.round(box.y), 0, H);
    const w = Math.min(W-x, Math.round(box.w)), h = Math.min(H-y, Math.round(box.h));
    return w >= 3 && h >= 3 ? ctx.getImageData(x,y,w,h).data : null;
  }
  function skinPixels(d) {
    if (!d) return null;
    const pixels = [];
    for (let i=0;i<d.length;i+=4) {
      const r=d[i],g=d[i+1],b=d[i+2], sum=r+g+b, lum=.299*r+.587*g+.114*b;
      // Broad chromaticity envelope tolerates dim skin; geometry supplies the skin prior.
      if (lum < 8 || Math.max(r,g,b)>=250 || sum===0) continue;
      const cr=r/sum,cg=g/sum;
      if (cr<.29 || cr>.57 || cg<.23 || cg>.43 || b/sum>.39) continue;
      pixels.push({r,g,b,lum,cr,cg});
    }
    if(pixels.length<12) return null;
    const cr=median(pixels.map(p=>p.cr)),cg=median(pixels.map(p=>p.cg));
    const lum=median(pixels.map(p=>p.lum)),mad=median(pixels.map(p=>Math.abs(p.lum-lum)));
    const use=pixels.filter(p=>Math.abs(p.cr-cr)<.055 && Math.abs(p.cg-cg)<.045 && Math.abs(p.lum-lum)<=Math.max(10,3*mad));
    if(use.length<12) return null;
    const rgb=['r','g','b'].map(k=>use.reduce((s,p)=>s+p[k],0)/use.length);
    const q=clamp(use.length/(d.length/4),0,1)*clamp(lum/45,.15,1);
    return {rgb,n:use.length,q,lum};
  }
  function sampleSkin(ctx,lm) {
    if(!lm || lm.length<468) return {n:0,rr:[null,null,null],rq:[0,0,0],rois:[],q:0};
    const W=ctx.canvas.width,H=ctx.canvas.height;
    const P=i=>({x:lm[i].x*W,y:lm[i].y*H});
    const fw=Math.hypot(P(454).x-P(234).x,P(454).y-P(234).y);
    const boxes=[[151,.30,.11],[50,.16,.14],[280,.16,.14]].map(([i,w,h])=>({x:P(i).x-fw*w/2,y:P(i).y-fw*h/2,w:fw*w,h:fw*h}));
    const per=boxes.map(b=>skinPixels(patch(ctx,b)));
    // A dark/covered forehead cannot replace either observed cheek channel.
    const rr=per.map(p=>p?p.rgb:null),rq=per.map(p=>p?p.q:0);
    const sum=rq.reduce((a,b)=>a+b,0),n=per.reduce((s,p)=>s+(p?p.n:0),0);
    const rgb=[0,1,2].map(k=>sum ? per.reduce((s,p)=>s+(p?p.rgb[k]*p.q:0),0)/sum : NaN);
    return {r:rgb[0],g:rgb[1],b:rgb[2],rr,rq,n,q:sum/3,
      lum:.299*rgb[0]+.587*rgb[1]+.114*rgb[2],rois:boxes.map(b=>({x:b.x/W,y:b.y/H,w:b.w/W,h:b.h/H}))};
  }
  function eyeQuality(ctx,lm,indices) {
    const pts=indices.map(i=>lm[i]);
    if(pts.some(p=>!p || !finite(p.x) || !finite(p.y))) return 0;
    const xs=pts.map(p=>p.x*ctx.canvas.width),ys=pts.map(p=>p.y*ctx.canvas.height);
    const w=Math.max(...xs)-Math.min(...xs);
    const d=patch(ctx,{x:Math.min(...xs)-w*.1,y:Math.min(...ys)-w*.15,w:w*1.2,h:Math.max(...ys)-Math.min(...ys)+w*.3});
    if(!d || w<5) return 0;
    const l=[];let glare=0;
    for(let i=0;i<d.length;i+=4){l.push(.299*d[i]+.587*d[i+1]+.114*d[i+2]);if(Math.min(d[i],d[i+1],d[i+2])>235)glare++;}
    const m=median(l),spread=median(l.map(v=>Math.abs(v-m)));
    return clamp(m/40,.1,1)*clamp(spread/8,.15,1)*clamp(1-glare/l.length*2,0,1);
  }
  // Camera exposure correction is for landmark inference ONLY; never for RGB/PPG.
  function exposureGain(ctx) {
    const {width:W,height:H}=ctx.canvas;
    const d=ctx.getImageData(Math.floor(W*.2),Math.floor(H*.15),Math.max(1,Math.floor(W*.6)),Math.max(1,Math.floor(H*.7))).data;
    const l=[];for(let i=0;i<d.length;i+=64)l.push(.299*d[i]+.587*d[i+1]+.114*d[i+2]);
    const m=median(l); return m>=8 && m<55 ? clamp(55/m,1,2.5) : 1;
  }
  function enhance(ctx,gain) {
    if(gain<=1.05)return;
    const im=ctx.getImageData(0,0,ctx.canvas.width,ctx.canvas.height),d=im.data;
    for(let i=0;i<d.length;i+=4)for(let c=0;c<3;c++)d[i+c]=Math.min(255,d[i+c]*gain);
    ctx.putImageData(im,0,0);
  }
  function timeCoverage(samples,start,end,maxGap=200) {
    let ms=0;
    for(let i=1;i<samples.length;i++) {
      const a=samples[i-1],b=samples[i],dt=b.t-a.t;
      if(dt>0 && dt<=maxGap && !b.breakBefore)ms+=Math.max(0,Math.min(end,b.t)-Math.max(start,a.t));
    }
    return clamp(ms/Math.max(1,end-start),0,1);
  }
  function cleanGaze(samples,opt={}) {
    const W=opt.W||1440,task=opt.task||'saccade';
    const input=(samples||[]).filter(p=>finite(p.t)).slice().sort((a,b)=>a.t-b.t);
    const cadence=median(input.slice(1).map((p,i)=>p.t-input[i].t).filter(dt=>dt>0&&dt<=200))||33;
    const out=[];
    for(let i=0;i<input.length;i++){
      const p=input[i];
      if(p.bl || p.q===0)continue;
      const x=finite(p.rx)?p.rx:p.x,y=finite(p.ry)?p.ry:p.y;
      if(!finite(x))continue;
      let z={...p,x,y,rawX:x,rawY:y,q:p.q??1,recovered:false,breakBefore:i>0 && (input[i-1].bl || input[i-1].q===0)};
      const a=input[i-1],b=input[i+1],ax=a&&(finite(a.rx)?a.rx:a.x),bx=b&&(finite(b.rx)?b.rx:b.x);
      const ay=a&&(finite(a.ry)?a.ry:a.y),by=b&&(finite(b.ry)?b.ry:b.y),hasY=[ay,by,y].every(finite);
      // Only an isolated low-quality excursion, bounded by close observations, is repaired.
      if(a&&b&&!a.bl&&!b.bl && b.t-a.t<=160 && finite(ax)&&finite(bx) && Math.hypot(ax-bx,hasY?ay-by:0)<W*.035 && Math.hypot(x-(ax+bx)/2,hasY?y-(ay+by)/2:0)>W*.15 && z.q<.55){
        const k=(p.t-a.t)/(b.t-a.t);z.x=ax+(bx-ax)*k;z.recovered=true;z.q*=.5;z.reason='isolated-spike';
        if(finite(ay)&&finite(by))z.y=ay+(by-ay)*k;
      }
      const prev=out[out.length-1];
      // Do not invent saccade onset/latency or bridge blinks. Gap fill is only for dwell/pursuit.
      if(task!=='saccade' && prev && i>0 && input[i-1].t===prev.t && !prev.recovered && !z.recovered && p.t-prev.t>Math.max(65,cadence*1.6) && p.t-prev.t<=120 && Math.abs(z.x-prev.x)<W*.035 && finite(z.y)&&finite(prev.y)&&Math.abs(z.y-prev.y)<W*.035){
        out.push({t:(prev.t+p.t)/2,x:(prev.x+z.x)/2,y:(prev.y+z.y)/2,q:Math.min(prev.q,z.q)*.5,recovered:true,reason:'short-gap'});
      }
      if(!prev || z.t>prev.t)out.push(z);
    }
    return out;
  }
  return {VERSION,sampleSkin,skinPixels,eyeQuality,exposureGain,enhance,timeCoverage,cleanGaze};
});
