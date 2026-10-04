/* Deterministic synthetic comparison, not a human/clinical accuracy study.
 * node tools/condition_fusion_benchmark.cjs [--write]
 * Baseline is the preceding webcam-recovery commit; git history is required. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),N=require('../newbiz-core.js');
const baselineRef='a7e980b',source=execFileSync('git',['show',baselineRef+':newbiz-core.js'],{cwd:root,encoding:'utf8'});
const sandbox={module:{exports:{}},require:()=>require('../condition-signal.js')};vm.runInNewContext(source,sandbox);const old=sandbox.module.exports;
const duration=40000,rows=[];
function measure(core,frames,isNew){
  const sig=core.buildBvp(frames),wins=core.hrWindows(sig).filter(w=>isNew?w.usable:w.snr>=-2);
  const intervals=wins.map(w=>({...w,start:w.start??w.t-5000,end:w.end??w.t+5000,confidence:w.confidence??.65}));
  const support=N.Fusion.support(intervals,0,duration);
  return {usableSeconds:+support.seconds.toFixed(1),windows:wins.length,medianBpm:wins.length?+N.median(wins.map(w=>w.bpm)).toFixed(2):null,wins};
}
for(const seed of [5,19,47,101,509]){
  const base=N.synthFrames(0,duration,()=>72,{seed,noise:.1});
  let state=seed;const rnd=()=>{state=state*16807%2147483647;return state/2147483647-.5;};
  const cases={
    clean:base,
    low_fps:N.synthFrames(0,duration,()=>72,{seed,noise:.1,fps:12}),
    weak:N.synthFrames(0,duration,()=>72,{seed,noise:1.2}),
    forehead_missing:base.map(f=>({...f,rr:[null,f.rr[1],f.rr[2]]})),
    interrupted:base.map(f=>({...f,ok:f.t%10000<7800})),
    chrom_rescue:base.map(f=>{const p=Math.sin(2*Math.PI*72*f.t/60000),rgb=[160*(1+.018*p),110*(1+.03*p),90*(1+.002*p)];return {...f,r:rgb[0],g:rgb[1],b:rgb[2],rr:[rgb.slice(),rgb.slice(),rgb.slice()]};}),
    flat:base.map(f=>({...f,r:160,g:110,b:90,rr:[[160,110,90],[160,110,90],[160,110,90]]})),
    noise:base.map(f=>({...f,r:175+30*rnd(),g:118+30*rnd(),b:98+30*rnd(),rr:[0,1,2].map(()=>[175+30*rnd(),118+30*rnd(),98+30*rnd()])})),
    quiet_noise:base.map(f=>({...f,r:175+1.2*rnd(),g:118+1.2*rnd(),b:98+1.2*rnd(),rr:[0,1,2].map(()=>[175+1.2*rnd(),118+1.2*rnd(),98+1.2*rnd()])}))
  };
  for(const [scenario,frames] of Object.entries(cases)){
    const truth=['flat','noise','quiet_noise'].includes(scenario)?null:72;
    const summarize=r=>{const {wins,...summary}=r;return {...summary,maeBpm:truth&&wins.length?+N.mean(wins.map(w=>Math.abs(w.bpm-truth))).toFixed(2):null};};
    rows.push({scenario,seed,partition:seed>100?'synthetic-holdout':'development',groundTruthBpm:truth,baseline:summarize(measure(old,frames,false)),current:summarize(measure(N,frames,true))});
  }
}
const result={kind:'synthetic-regression',baselineRef,algorithm:N.Fusion.VERSION,recordSeconds:duration/1000,
  limitations:['No human webcam recordings or clinical reference sensor.','Noise/flat acceptance is reported explicitly.','ROI mean RGB fixtures do not model all camera/skin/lighting effects.'],rows};
if(process.argv.includes('--write'))fs.writeFileSync(path.join(root,'CONDITION_FUSION_BENCHMARK.json'),JSON.stringify(result,null,2)+'\n');
console.table(rows.map(r=>({case:r.scenario,seed:r.seed,oldSec:r.baseline.usableSeconds,newSec:r.current.usableSeconds,oldMAE:r.baseline.maeBpm,newMAE:r.current.maeBpm})));
if(rows.some(r=>r.scenario==='flat'&&r.current.usableSeconds>0))throw new Error('Flat input produced accepted evidence');
if(rows.some(r=>r.scenario.includes('noise')&&r.current.usableSeconds>0))throw new Error('Noise-only control produced accepted evidence');
