'use strict';
const assert=require('node:assert/strict');
const N=require('./newbiz-core.js'),B=require('./newbiz-battery.js'),S=N.Signal,R=require('./newbiz-research.js');
const passed=[];
function test(name,fn){fn();passed.push(name);console.log('PASS',name);}
test('Dim skin survives without admitting clipped/black patches',()=>{
  const pixels=rgb=>Uint8ClampedArray.from(Array.from({length:100},()=>[...rgb,255]).flat());
  assert.ok(S.skinPixels(pixels([28,22,18])).n===100);
  assert.equal(S.skinPixels(pixels([2,2,2])),null);
  assert.equal(S.skinPixels(pixels([255,255,255])),null);
});
const pulse=N.synthFrames(0,32000,()=>72,{fps:12,noise:.04,seed:121});
test('12 fps pulse remains usable with an unavailable forehead and changing cheek availability',()=>{
  const frames=pulse.map(f=>({...f,rr:[null,f.rr[1],f.t>15000?null:f.rr[2]]}));
  const before=JSON.stringify(frames),sig=N.buildBvp(frames),wins=N.hrWindows(sig);
  assert.ok(wins.length>=20);assert.ok(Math.abs(N.median(wins.map(w=>w.bpm))-72)<3);
  assert.ok(sig.chans.length===2);assert.ok(sig.coverage>.95);assert.equal(JSON.stringify(frames),before);
});
test('A 100 ms missing interval is bounded and marked as recovered',()=>{
  const frames=N.synthFrames(0,22000,()=>78,{noise:.03,seed:5}).filter(f=>!(f.t>10000&&f.t<10100));
  const sig=N.buildBvp(frames),wins=N.hrWindows(sig);
  assert.ok(sig.recoveredFraction>0 && sig.recoveredFraction<.03);
  assert.ok(Math.abs(N.median(wins.map(w=>w.bpm))-78)<3);
  const beats=N.beats(sig,0,22000,78);assert.ok(!beats.some(t=>t>9500&&t<10700));
});
test('A long gap creates no interpolated pulse or HR window crossing the gap',()=>{
  const frames=N.synthFrames(0,42000,()=>72,{noise:.04}).filter(f=>f.t<15000||f.t>19000);
  const sig=N.buildBvp(frames),wins=N.hrWindows(sig);
  assert.ok(wins.length>10);assert.ok(!wins.some(w=>w.t>10000&&w.t<24000));
  assert.ok(Number.isNaN(sig.bvp[Math.round((17000-sig.t0)*sig.fs/1000)]));
});
test('An isolated RGB impulse is repaired without rewriting captured data',()=>{
  const frames=N.synthFrames(0,22000,()=>72,{noise:.01,rois:false});
  const f=frames[300];f.r+=40;f.g+=40;f.b+=40;
  const raw=f.r,sig=N.buildBvp(frames);assert.equal(f.r,raw);assert.ok(sig.recoveredFraction>0);
  assert.ok(Math.abs(N.median(N.hrWindows(sig).map(w=>w.bpm))-72)<3);
});
test('Eye measurements are retained when PPG is unavailable at 12 fps',()=>{
  const frames=N.synthFrames(0,60000,()=>72,{fps:12}).map(f=>({...f,ok:false,ppgOk:false,eyeOk:true,faceOk:true}));
  const eye=B.eyeStats(frames,0,60000);assert.ok(eye&&eye.coverage>.95);assert.equal(N.buildBvp(frames),null);
});
test('Per-eye calibration tolerates a corrupted opposite eye and preserves pose terms',()=>{
  const rows=[];
  for(let i=0;i<250;i++){
    const u=(i%10)/9,v=(Math.floor(i/10)%5)/4,yaw=Math.sin(i)*.03,pitch=Math.cos(i)*.02;
    const f={u,v,yaw,pitch,cx:.5,cy:.5,eyes:{left:{u,v,q:.9},right:{u:u*.8+.1,v:v*.9,q:.7}}};
    rows.push({f,x:1000*u+100*yaw,y:600*v+100*pitch});
  }
  const model=N.fitGaze(rows);assert.ok(model.eyes.left&&model.eyes.right);
  const f={...rows[134].f,eyes:{...rows[134].f.eyes,right:{u:8,v:8,q:0}}};
  const g=N.predictGaze(model,f);assert.equal(g.mode,'left');assert.ok(Math.abs(g.x-rows[134].x)<5);assert.ok(Math.abs(g.y-rows[134].y)<5);
  const heldOut=[21,48,102,129].map(i=>({...rows[i],fs:Array.from({length:5},()=>rows[i].f)}));
  N.validateGazeEyes(model,heldOut,1000,600);assert.equal(model.eyes.left.validation.grade,'good');
  model.eyes.left.validation={grade:'poor',errPct:40};
  assert.equal(N.predictGaze(model,f),null,'failed eye validation cannot become a monocular measurement');
  assert.equal(N.predictGaze(model,{...f,eyes:{left:{u:0,v:0,q:0},right:{u:0,v:0,q:0}}}),null);
});
test('Eye-local coordinates compensate roll and tolerate one degenerate eye contour',()=>{
  const lm=Array.from({length:478},()=>({x:.5,y:.5}));
  const set=(i,x,y)=>lm[i]={x,y};
  [[234,.2,.5],[454,.8,.5],[10,.5,.2],[152,.5,.8],[1,.5,.5],
   [33,.25,.4],[133,.45,.4],[159,.35,.38],[145,.35,.42],[362,.55,.4],[263,.75,.4],[386,.65,.38],[374,.65,.42]].forEach(p=>set(...p));
  for(let i=468;i<478;i++)set(i,i<473?.36:.66,.41);
  const base=N.faceFeatures(lm),angle=.18;
  const rotated=lm.map(p=>({x:.5+(p.x-.5)*Math.cos(angle)-(p.y-.5)*Math.sin(angle),y:.5+(p.x-.5)*Math.sin(angle)+(p.y-.5)*Math.cos(angle)}));
  const f=N.faceFeatures(rotated);assert.ok(Math.abs(f.eyes.left.v-base.eyes.left.v)<1e-9);
  set(33,.4,.4);set(133,.4,.4);const one=N.faceFeatures(lm);
  assert.ok(Number.isFinite(one.u));assert.equal(one.eyes.right.q,0);assert.ok(one.eyes.left.q>0);
});
test('Saccade steps are preserved, low-quality spikes corrected, no latency gap synthesis',()=>{
  const step=[0,0,0,400,400,400].map((x,i)=>({t:i*33,x,y:0,q:.9}));
  assert.deepEqual(S.cleanGaze(step).map(p=>p.x),step.map(p=>p.x));
  const spike=[{t:0,x:100,y:20,q:1},{t:33,x:800,y:600,q:.2},{t:66,x:102,y:20,q:1}];
  const clean=S.cleanGaze(spike);assert.ok(clean[1].recovered);assert.equal(clean[1].rawX,800);assert.equal(clean[1].x,101);
  const vertical=S.cleanGaze(spike.map(p=>({...p,x:100})));assert.equal(vertical[1].y,20);assert.equal(vertical[1].rawY,600);
  const gap=[0,33,66,166,199,232].map(t=>({t,x:100,y:20}));assert.equal(S.cleanGaze(gap).length,6);
  assert.equal(S.cleanGaze(gap,{task:'pursuit'}).length,7);
  assert.equal(S.cleanGaze([...gap,{t:500,x:101,y:20}],{task:'pursuit'}).length,8);
  const lowFps=Array.from({length:50},(_,i)=>({t:i*1000/12,x:100,y:20}));
  assert.equal(S.cleanGaze(lowFps,{task:'pursuit'}).length,50,'ordinary low-fps intervals are not missing data');
});
test('Blink intervals are not repaired or counted as observed dwell',()=>{
  const s=S.cleanGaze([{t:0,x:100,y:20},{t:50,x:100,y:20,bl:true},{t:100,x:100,y:20}],{task:'dwell'});
  assert.equal(s.length,2);assert.equal(S.timeCoverage(s,0,100),0);
});
test('Research export keeps ROI positions, independent modality flags and raw provenance',()=>{
  const packed=R.packFrames([{t:10,ok:false,faceOk:true,eyeOk:true,rr:[null,[1,2,3],null],source:'observed',skinQ:.2}]);
  assert.deepEqual(packed.rr[0],[null,null,null,100,200,300,null,null,null]);
  assert.deepEqual(packed.faceOk,[1]);assert.deepEqual(packed.ok,[0]);assert.equal(packed.source[0],'observed');
});
console.log(`${passed.length} recovery tests passed (synthetic fixtures; no human accuracy claim).`);
