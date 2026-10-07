'use strict';
const assert=require('node:assert/strict'),N=require('./newbiz-core.js'),F=N.Fusion;
const passed=[];
function test(name,fn){fn();passed.push(name);console.log('PASS',name);}
function rgbPulse(ms,bpm=72){
  const frames=[];
  for(let t=0;t<=ms;t+=1000/30){
    const p=Math.sin(2*Math.PI*bpm*t/60000);
    const rgb=[160*(1+.018*p),110*(1+.03*p),90*(1+.002*p)];
    frames.push({t,ok:true,r:rgb[0],g:rgb[1],b:rgb[2],rr:[rgb.slice(),rgb.slice(),rgb.slice()],rq:[.8,.8,.8],skinQ:.8});
  }return frames;
}
test('CHROM recovers an observed chromatic pulse suppressed by POS',()=>{
  const frames=rgbPulse(24000),sig=N.buildBvp(frames),wins=N.hrWindows(sig).filter(w=>w.usable);
  assert.ok(wins.length>10);assert.ok(wins.some(w=>w.methods.includes('chrom')));
  assert.ok(Math.abs(N.median(wins.map(w=>w.bpm))-72)<2);
  const pos=sig.candidates.filter(c=>c.method==='pos'),legacy=N.hrWindows({...sig,candidates:pos}).filter(w=>w.usable);
  assert.ok(legacy.length<wins.length,'complementary colour projection must add usable observations');
  assert.deepEqual(N.beats(sig,0,24000,72),[],'a rescued HR must not create beat timing from near-zero POS data');
});
test('Short observed bursts accumulate without crossing losses or extending the test',()=>{
  const frames=N.synthFrames(0,40000,()=>78,{noise:.04}).map(f=>({...f,ok:f.t%10000<7800}));
  const sig=N.buildBvp(frames),wins=N.hrWindows(sig),summary=N.phaseHr(wins,0,40000);
  assert.ok(wins.some(w=>w.windowSec===6));assert.ok(summary.validSeconds>20);
  assert.ok(Math.abs(summary.bpm-78)<3);assert.ok(summary.validSeconds<=32);
  for(const w of wins)assert.ok(Math.floor(w.start/10000)===Math.floor(w.end/10000));
});
test('Overlapping windows cannot inflate elapsed evidence or effective duration',()=>{
  const w={start:0,end:10000,t:5000,bpm:72,snr:5,confidence:.8,usable:true};
  const s=F.summarize(Array.from({length:50},()=>({...w})),0,10000);
  assert.equal(s.validSeconds,10);assert.equal(s.effectiveSeconds,8);assert.equal(s.coverage,1);
});
test('Multiple methods on one region do not create spatial corroboration',()=>{
  const c={roi:'right-cheek',bpm:72,snr:-4,period:.6,recovered:0,pixelQ:1,weight:.7};
  const single=F.fuse(['pos','chrom','green'].map(method=>({...c,method})));
  assert.equal(single.n,1);assert.equal(single.usable,false);
  const multi=F.fuse([{...c,method:'pos'},{...c,roi:'left-cheek',method:'chrom'}]);
  assert.equal(multi.usable,true);assert.equal(multi.status,'supported');assert.equal(multi.quality,'fair');
});
test('A phase uses complete in-phase windows and keeps real HR changes',()=>{
  const frames=N.synthFrames(0,50000,t=>t<25000?66:108,{noise:.04}),sig=N.buildBvp(frames);
  const a=N.hrWindows(sig,10,1,{start:0,end:24000}),b=N.hrWindows(sig,10,1,{start:26000,end:50000});
  assert.ok(a.every(w=>w.end<=24000));assert.ok(b.every(w=>w.start>=26000));
  assert.ok(Math.abs(N.phaseHr(a,0,24000).bpm-66)<3);assert.ok(Math.abs(N.phaseHr(b,26000,50000).bpm-108)<3);
  assert.equal(N.phaseHr([{start:19000,end:29000,t:24000,bpm:90,snr:5,usable:true}],0,25000).bpm,null);
});
test('Flat video and absent skin never produce an accepted pulse',()=>{
  const frames=rgbPulse(20000).map(f=>({...f,r:160,g:110,b:90,rr:[[160,110,90],[160,110,90],[160,110,90]]}));
  assert.equal(N.measureEvidence(frames,0,20000).bpm,null);
  assert.equal(N.measureEvidence(frames.map(f=>({...f,ok:false})),0,20000).bpm,null);
  const light=frames.map(f=>{const k=1+.03*Math.sin(2*Math.PI*1.2*f.t/1000),rgb=[160*k,110*k,90*k];return {...f,r:rgb[0],g:rgb[1],b:rgb[2],rr:[rgb,rgb,rgb]};});
  assert.equal(N.measureEvidence(light,0,20000).bpm,null,'achromatic periodic brightness alone is not a pulse');
});
test('Lighting discontinuities retain clean sections without spanning the transition',()=>{
  const frames=rgbPulse(40000),sig=N.buildBvp(frames),wins=N.hrWindows(sig,10,1,{jumps:[20000]});
  assert.ok(wins.some(w=>w.end<19250));assert.ok(wins.some(w=>w.start>20750));
  assert.ok(wins.every(w=>w.end<=19250||w.start>=20750));
});
function weakPulse(sec,{fps=14,noise=.6,amp=1,hr=75,seed=3}={}){
  let x=seed;const rand=()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/4294967296;},gauss=()=>{let u=0;for(let i=0;i<6;i++)u+=rand();return u-3;};
  const out=[];let ph=0;
  for(let t=0;t<=sec*1000;){const dt=1000/fps*(1+(rand()-.5)*.3);ph+=2*Math.PI*hr/60*dt/1000;const p=amp*(Math.sin(ph)+.35*Math.sin(2*ph-.8));
    const ch=k=>{const n=noise*1.7*(1+.4*k);return [175+.25*p+n*gauss(),118+.6*p+n*gauss(),98+.15*p+n*gauss()];},rr=[ch(0),ch(1),ch(2)];
    out.push({t,ok:true,rr,r:(rr[0][0]+rr[1][0]+rr[2][0])/3,g:(rr[0][1]+rr[1][1]+rr[2][1])/3,b:(rr[0][2]+rr[1][2]+rr[2][2])/3});t+=dt;}
  return out;
}
test('Pooled spectrum promotes a consistent weak pulse but never a pulse-free recording',()=>{
  const ok=N.measureEvidence(weakPulse(30,{fps:22,noise:.6,seed:5}),0,30000);
  assert.ok(ok.pooled&&ok.pooled.windows>=2,'independent windows are pooled');
  assert.equal(ok.status,'measured');assert.equal(ok.quality,'good');assert.ok(Math.abs(ok.bpm-75)<3);
  for(let seed=1;seed<=12;seed++){
    const e=N.measureEvidence(weakPulse(30,{amp:0,seed,noise:seed%2?.6:1}),0,30000);
    assert.notEqual(e.status,'measured',`pulse-free seed ${seed}`);assert.ok(!(e.pooled&&e.pooled.accepted));
  }
});
test('Sub-span summaries reuse the parent phase windows and stay inside the sub-span',()=>{
  const frames=weakPulse(40,{fps:14,noise:.8,seed:9}),sig=N.buildBvp(frames),parent=N.hrWindows(sig,10,1,{start:0,end:40000});
  const late=N.phaseHr(parent,20000,40000),alone=N.phaseHr(N.hrWindows(sig,10,1,{start:20000,end:40000}),20000,40000);
  assert.ok(late.n>=alone.n,'parent context never loses windows');
  assert.ok(parent.filter(w=>w.usable&&w.start>=20000&&w.end<=40000).length===late.n,'only windows wholly inside the late half count');
  assert.ok(Math.abs(late.bpm-75)<4);
});
console.log(`${passed.length} fusion/evidence tests passed.`);
