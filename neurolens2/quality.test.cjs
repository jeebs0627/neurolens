const test=require('node:test'),assert=require('node:assert/strict'),Q=require('./quality.js'),C=require('./core.js'),W=require('./wellbeing.js'),P=require('./pulse.js');
const packet=(extra={})=>({schema:C.SCHEMA,engine:C.VERSION,id:'test',participant:'p',origin:'observed',status:'completed',protocol:'daily60',focus:'disengage',form:'A',captureMode:'behavior',deviceKey:'d',createdAt:'2026-10-22T00:00:00Z',localDate:'2026-10-22',elapsed:60000,calibrationPoints:[],calibration:{grade:'G0'},frames:[],trials:[],phases:C.schedule('daily60','disengage'),result:{windows:[],features:[],rows:[],qualityFlags:[]},...extra});
const trial=i=>({id:'t'+i,kind:'load',start:i*3000,end:(i+1)*3000,shownAt:i*3000+510,targetAt:i*3000+510,responseAt:i*3000+1010,correct:true});
test('display gate blocks 1fps throttling before measurement, recovers at 60fps and detects sustained in-test lag',()=>{
 const {DisplayGate}=require('./experience.js'),g=new DisplayGate();for(let t=0;t<=5000;t+=1000)g.update(t);assert.equal(g.value(5000).stable,false);assert.equal(g.value(5000).fps,1);assert.ok(g.slowStreak>=3);
 for(let t=5016;t<8000;t+=16)g.update(t);assert.equal(g.value(g.last).stable,true);assert.equal(g.value(g.last+300).stable,false);
 for(let n=0;n<3;n++)g.update(g.last+180);assert.equal(g.slowStreak,3);assert.equal(g.value(g.last).stable,false);
});
test('quality separates an unmeasured camera from failed camera and audits omissions and timing',()=>{
 const p=packet({trials:Array.from({length:6},(_,i)=>trial(i))});delete p.trials[0].responseAt;p.trials[1].inputLagMs=200;
 const q=Q.assess(p);assert.equal(q.answered,4);assert.equal(q.valid,5);assert.equal(q.omissions,1);assert.equal(q.excluded,1);assert.equal(q.review,true);assert.equal(q.channels.find(c=>c.id==='pulse').state,'absent');
 assert.equal(Q.assess({...p,captureMode:'webcam'}).channels.find(c=>c.id==='pulse').state,'withheld');
 const demo=Q.assess(packet({captureMode:'synthetic',origin:'synthetic',result:{windows:[{bpm:72},{bpm:73},{bpm:72}]}}));assert.equal(demo.channels.find(c=>c.id==='pulse').state,'ready');assert.match(demo.channels.find(c=>c.id==='pulse').status,/합성 예시/);
 assert.equal(Q.assess(packet({trials:[{...trial(0),shownAt:undefined}]})).review,true);
 const late=packet({trials:[{...trial(0),shownAt:2000,presentationInvalid:true}]});assert.equal(W.behavioral(late,'load').shown,1);assert.equal(W.behavioral(late,'load').excluded,1);assert.equal(W.behavioral(late,'load').eligible,0);
});
test('cohort excludes evaluation, synthetic and imported sessions; return denominator has prior-day completions',()=>{
 const list=[packet({id:'a',localDate:'2026-10-21'}),packet({id:'b'}),packet({id:'new',participant:'new'}),packet({id:'qa',purpose:'evaluation'}),packet({id:'syn',origin:'synthetic'}),packet({id:'im',origin:'imported'}),packet({id:'bad',participant:'bad',status:'aborted'})];
 const c=Q.cohort(list,'2026-10-22');assert.equal(c.records,4);assert.equal(c.completed,3);assert.equal(c.returnEligible,1);assert.equal(c.returned,1);assert.equal(c.excluded,3);assert.equal(c.completionRate,75);
 assert.equal(Q.cohort([packet({checkinOnly:true,status:'aborted',elapsed:0})],'2026-10-22').records,0);
});
test('quality export preserves CSV fields but neutralizes formula prefixes and omits emotional scores',()=>{
 const out=Q.csv([packet({id:'=1+1',participant:' @SUM(1,1)',checkin:{answers:{tension:8}}})]);
 assert.ok(out.startsWith('\uFEFF'));assert.ok(out.includes('"\'=1+1"'));assert.ok(out.includes('"\' @SUM(1,1)"'));assert.ok(!out.includes('tension'));assert.ok(out.includes('review_reasons'));
});
test('small samples retain uncertainty: six successes do not imply a guaranteed 100% ability',()=>{
 const b=W.behavioral(packet({trials:Array.from({length:6},(_,i)=>trial(i))}),'load');assert.equal(b.accuracy,100);assert.ok(b.accuracyInterval[0]>60&&b.accuracyInterval[0]<62);assert.ok(Math.abs(b.accuracyInterval[1]-100)<1e-8);assert.equal(W.wilson(0,0),null);
 const ci=C.interval([10,20,30]);assert.ok(ci.interval[0]<0&&ci.interval[1]>40);assert.equal(C.interval([10,20]).interval,null);
});
test('latest fourteen records drive recommendation regardless of storage order; QA never contributes',()=>{
 const records=Array.from({length:20},(_,i)=>packet({createdAt:new Date(Date.UTC(2026,9,i+1)).toISOString(),result:{features:[{id:i<6?'attention-threat':'reward',usable:true,n:3}]}}));
 const actual=C.recommend(records);assert.equal(actual.kind,'attention');assert.deepEqual(actual,C.recommend([...records].reverse()));assert.equal(actual.candidates.find(x=>x.kind==='reward').n,42);
 assert.deepEqual(actual,C.recommend([...records,packet({purpose:'evaluation',result:{features:[{id:'attention-threat',usable:true,n:999}]}})]));
});
test('personal baseline uses local dates, matching context and excludes current or historical evaluations',()=>{
 const current=packet({id:'now',checkin:{context:{sleep:'usual'}}});
 const previous=packet({id:'old',createdAt:'2026-10-21T16:00:00Z',localDate:'2026-10-22',checkin:{context:{sleep:'usual'}}});
 assert.equal(C.longitudinal(current,[previous]).days,0);
 const prior={...previous,localDate:'2026-10-21',createdAt:'2026-10-21T00:00:00Z'};
 assert.equal(C.longitudinal(current,[prior]).days,1);assert.equal(C.longitudinal(current,[{...prior,checkin:{context:{sleep:'short'}}}]).days,0);
 assert.equal(C.longitudinal({...current,purpose:'evaluation'},[prior]).days,0);assert.equal(C.longitudinal(current,[{...prior,purpose:'evaluation'}]).days,0);
});
test('unknown conditions remain explicit and operational evaluations cannot contaminate daily check-in history',()=>{
 const checkin={version:W.VERSION,answers:{tension:4,energy:6},completedAt:'2026-10-22T00:00:00Z',context:{sleep:'unknown',caffeine:'no',exercise:'yes'}};
 assert.equal(W.validate(checkin),checkin);assert.throws(()=>W.validate({...checkin,context:{sleep:'perfect'}}));assert.throws(()=>W.validate({...checkin,context:[]}));
 const now=packet({id:'now',checkin}),prior=packet({id:'qa',createdAt:'2026-10-21T00:00:00Z',localDate:'2026-10-21',purpose:'evaluation',checkin});
 assert.deepEqual(W.historySeries(now,[prior]).map(x=>x.id),['now']);
});
test('aborted sessions do not acquire future pulse windows or trial events outside their phase',()=>{
 const p=packet({engine:'nl2-2.3.0',phases:C.schedule('first180','attention','nl2-2.3.0'),status:'aborted',elapsed:35000,captureMode:'webcam'});const windows=C.analyze(p,P).windows;assert.equal(windows.length,1);assert.ok(windows.every(w=>w.end<=35000));assert.equal(C.analyze({...p,captureMode:'behavior'},P).windows.length,0);
 const phase=p.phases.find(p=>p.kind==='disengage'),t={...trial(0),phase:phase.id,kind:'disengage',start:phase.start-1,end:phase.start+1000};
 assert.throws(()=>C.validate({...p,trials:[t]}));assert.throws(()=>C.validate({...p,purpose:'clinical-proof'}));
 const checkinOnly=packet({checkinOnly:true,status:'aborted',elapsed:0});assert.equal(C.validate(checkinOnly).checkinOnly,true);assert.equal(C.observed(checkinOnly),false);assert.throws(()=>C.validate({...checkinOnly,status:'completed'}));assert.throws(()=>C.validate({...checkinOnly,elapsed:10}));
});
test('camera cancellation resolves pending permission and a late old stream cannot erase a newer preview',async()=>{
 const fs=require('node:fs'),src=fs.readFileSync(require('node:path').join(__dirname,'camera.js'),'utf8');
 const {Camera}=await import('data:text/javascript;base64,'+Buffer.from(src).toString('base64'));
 const original=Object.getOwnPropertyDescriptor(globalThis,'navigator');let resolveMedia,stopped=0;
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:()=>new Promise(r=>resolveMedia=r)}}});
 try{const current={newPreview:true},video={srcObject:current},cam=new Camera(video,()=>{},()=>{}),promise=cam.start();cam.stop();await assert.rejects(promise,/취소/);resolveMedia({getTracks:()=>[{stop(){stopped++;}}]});await new Promise(r=>setImmediate(r));assert.equal(stopped,1);assert.equal(video.srcObject,current);}finally{if(original)Object.defineProperty(globalThis,'navigator',original);else delete globalThis.navigator;}
});
