/* Offline reference benchmark. Never downloads datasets or substitutes synthetic labels for references. */
const fs=require('node:fs'),path=require('node:path'),C=require('../neurolens2/core.js'),P=require('../neurolens2/pulse.js');
function summary(rows,total){
 const errors=rows.map(r=>r.predicted-r.reference),subjects=[...new Set(rows.map(r=>r.subject))];
 const perSubject=subjects.map(subject=>{const a=rows.filter(r=>r.subject===subject);return {subject,n:a.length,mae:C.mean(a.map(r=>Math.abs(r.predicted-r.reference))),bias:C.mean(a.map(r=>r.predicted-r.reference))};});
 const mean=C.mean(errors),std=C.sd(errors);let interval=null;
 if(subjects.length>=5){const random=C.rng(51121),boot=[];for(let i=0;i<2000;i++)boot.push(C.mean(subjects.map(()=>perSubject[Math.floor(random()*subjects.length)].mae)));boot.sort((a,b)=>a-b);interval=[boot[50],boot[1949]];}
 return {scheduledReferencedWindows:total,acceptedWindows:rows.length,coverage:total?rows.length/total:null,subjects:subjects.length,
   macroMAE:C.mean(perSubject.map(s=>s.mae)),microMAE:C.mean(errors.map(Math.abs)),rmse:errors.length?Math.sqrt(C.mean(errors.map(x=>x*x))):null,
   bias:mean,descriptiveAgreement:errors.length>1?[mean-1.96*std,mean+1.96*std]:null,
   subjectBootstrapMAE95:interval,perSubject};
}
function evaluate(manifest,load){
 if(manifest.schema!=='nl2-benchmark-1'||!Array.isArray(manifest.sessions)||!manifest.sessions.length)throw Error('Expected nl2-benchmark-1 with sessions');
 const memberships=new Map(),rows={fused:[],POS:[],CHROM:[]},excluded=[],kinds=new Set();let total=0;
 for(const item of manifest.sessions){
   if(!item.subject||!item.dataset||!['train','dev','test'].includes(item.split))throw Error('Each row needs dataset, subject and explicit split');
   const subject=item.dataset+':'+item.subject,previous=memberships.get(subject);
   if(previous&&previous!==item.split)throw Error('Subject leakage across splits: '+subject);memberships.set(subject,item.split);
   if(!['reference-device','synthetic'].includes(item.referenceKind))throw Error('Explicit referenceKind is required');
 }
 for(const item of manifest.sessions.filter(s=>s.split===(manifest.evaluateSplit||'test'))){
   const packet=C.validate(load(item.packet)),reference=load(item.reference),subject=item.dataset+':'+item.subject;
   if(!Array.isArray(reference)||reference.some(r=>!C.finite(r.t)||!C.finite(r.bpm)||r.bpm<30||r.bpm>240))throw Error('Reference must be [{t: milliseconds, bpm: numeric}], 30..240 bpm');
   if(item.referenceKind==='reference-device'&&(packet.origin!=='observed'||packet.captureMode!=='webcam'))throw Error('Real reference evaluation requires an observed webcam packet');
   kinds.add(item.referenceKind);const windows=P.analyze(packet.frames,packet.phases).filter(w=>w.end<=packet.elapsed);
   for(const w of windows){const refs=reference.filter(r=>r.t>=w.start&&r.t<w.end).sort((a,b)=>a.t-b.t);
     if(refs.length<6||refs.at(-1).t-refs[0].t<9000){excluded.push({session:item.packet,start:w.start,reason:'reference-coverage'});continue;}
     total++;const truth=C.mean(refs.map(r=>r.bpm));
     const add=(name,predicted)=>{if(C.finite(predicted))rows[name].push({subject,session:item.packet,start:w.start,end:w.end,predicted,reference:truth});};
     add('fused',w.bpm);
     for(const method of ['POS','CHROM']){const candidate=w.candidates.find(c=>c.method===method&&c.roi==='forehead');add(method,candidate?.eligible?candidate.bpm:null);}
   }
 }
 if(kinds.size>1)throw Error('Synthetic and real reference datasets must be evaluated in separate reports');
 return {schema:'nl2-benchmark-result-1',engine:C.VERSION,kind:[...kinds][0]||'no-data',split:manifest.evaluateSplit||'test',
   status:total?'evaluated':'no-reference-coverage',metrics:Object.fromEntries(Object.entries(rows).map(([name,a])=>[name,summary(a,total)])),excluded,rows,
   interpretation:'Coverage is reported alongside error. Macro MAE weights subjects equally. Bootstrap resamples subjects, not overlapping frames. Synthetic accuracy is not human or clinical validity.'};
}
if(require.main===module){
 try{const input=process.argv[2],output=process.argv[3];if(!input||!output)throw Error('Usage: node tools/neurolens2_benchmark.cjs manifest.json result.json');
   const filename=path.resolve(input),manifest=JSON.parse(fs.readFileSync(filename,'utf8')),base=path.dirname(filename);
   const result=evaluate(manifest,name=>{if(typeof name!=='string'||!name.endsWith('.json'))throw Error('Only local JSON inputs are accepted');return JSON.parse(fs.readFileSync(path.resolve(base,name),'utf8'));});
   fs.writeFileSync(path.resolve(output),JSON.stringify(result,null,2));console.log(JSON.stringify({status:result.status,kind:result.kind,metrics:result.metrics},null,2));
 }catch(e){console.error(e.message);process.exitCode=1;}
}
module.exports={evaluate,summary};
