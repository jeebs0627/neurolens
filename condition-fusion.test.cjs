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
console.log(`${passed.length} fusion/evidence tests passed.`);
