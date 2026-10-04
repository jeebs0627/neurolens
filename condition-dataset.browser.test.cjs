'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright'),N=require('./newbiz-core.js'),D=require('./condition-dataset.js'),R=require('./newbiz-research.js');
const root=__dirname,frames=N.synthFrames(0,30000,()=>72,{noise:.05});
const rec={attemptId:'a0000000-0000-0000-0000-000000000001',startedAt:0,endedAt:30000,outcome:'complete',measuredAt:'2026-10-04T12:00:00Z',frames,phases:{baseline:{start:0,end:30000}},steps:{baseline:{status:'done'}},mode:'quick',checkin:{phq:[3,3]},demo:false};
const windows=N.hrWindows(N.buildBvp(frames)),phase=N.phaseHr(windows,0,30000);
const res={version:N.VERSION,hr:{baseline:phase},evidence:{version:N.Fusion.VERSION,windows,phases:{baseline:phase}},battery:{version:'test-battery',steps:rec.steps,integrated:{pathways:[],mismatches:[]},domains:{},indicators:[],qc:{},phq:{phq2:6}}};
const consent={research:true,phq:false,at:'2026-10-04T12:00:00Z'},pk=R.pack(rec,res,consent);
const sessions=new Map();let failChunk=true,beginCount=0,annotateCount=0,migration=true;
const auth=`window.NLAuth={getUser:async()=>localStorage.datasetTestRole==='reviewer'?{id:'reviewer'}:null,signOut:async()=>{localStorage.removeItem('datasetTestRole')},signIn:async()=>{localStorage.datasetTestRole='reviewer'},client:{rpc:async(fn,args={})=>{const r=await fetch(NL_SUPABASE.url+'/rest/v1/rpc/'+fn,{method:'POST',headers:{'Content-Type':'application/json','x-test-role':localStorage.datasetTestRole||''},body:JSON.stringify(args)});const data=await r.json();return r.ok?{data}:{error:{message:data.error}};}}};`;
const server=http.createServer((req,response)=>{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep)){response.writeHead(403).end();return;}try{let body=fs.readFileSync(file);if(file.endsWith('condition.html'))body=Buffer.from(body.toString().replace(/<\/script>\s*<\/body>/,'window.__condition={S,researchSubmit,datasetCheckpoint,nextFrame,recordInput,liveRecord};</script></body>'));response.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css'})[path.extname(file)]||'application/octet-stream');response.end(body);}catch(_){response.writeHead(404).end();}});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({executablePath:process.env.CONDITION_EDGE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  try{
    const context=await browser.newContext(),errors=[];context.setDefaultTimeout(20000);context.setDefaultNavigationTimeout(20000);
    await context.route('**/auth.js',r=>r.fulfill({contentType:'text/javascript',body:auth}));
    await context.route('**/supabase.min.js',r=>r.fulfill({contentType:'text/javascript',body:''}));
    await context.route('**.supabase.co/rest/v1/rpc/**',async route=>{
      const fn=route.request().url().split('/').at(-1),p=route.request().postDataJSON(),reviewer=route.request().headers()['x-test-role']==='reviewer';let data=true,status=200;
      if(['dataset_access','dataset_list','dataset_detail','dataset_annotate'].includes(fn)&&!reviewer){data={error:'forbidden'};status=403;}
      else if(fn==='dataset_access')data=true;
      else if(fn==='dataset_research_begin'){if(!migration){status=404;data={error:'migration-missing'};}else{beginCount++;let row=sessions.get(p.p_attempt);if(!row){row={id:p.p_attempt,code:'NLR-TEST01',created_at:'2026-10-04T12:00:00Z',status:'uploading',chunks:[],annotations:[],meta:p.p_meta,audit:p.p_summary.dataset};sessions.set(p.p_attempt,row);}else if(row.status!=='complete')row.chunks=[];data={session_id:row.id,code:row.code,status:row.status};}}
      else if(fn==='newbiz_research_begin'){const id=p.p_meta.attemptId,row={id,code:'NLR-LEGACY',status:'uploading',chunks:[],annotations:[],meta:p.p_meta,audit:p.p_summary.dataset};sessions.set(id,row);data={session_id:id,code:row.code,upload_token:'c'.repeat(48)};}
      else if(fn==='newbiz_research_chunk'){if(failChunk){failChunk=false;status=503;data={error:'offline-fixture'};}else sessions.get(p.p_session).chunks[p.p_idx]={idx:p.p_idx,data:p.p_data};}
      else if(fn==='newbiz_research_finish'){const row=sessions.get(p.p_session);Object.assign(row,{status:'complete',sha256:p.p_sha256,chunkCount:p.p_chunks});}
      else if(fn==='dataset_list')data=[...sessions.values()].filter(r=>r.status==='complete').map(({id,code,created_at,meta,audit})=>({id,code,created_at,meta,audit}));
      else if(fn==='dataset_detail')data={...sessions.get(p.p_session),chunks:p.p_payload?sessions.get(p.p_session).chunks:null};
      else if(fn==='dataset_annotate'){annotateCount++;sessions.get(p.p_session).annotations.push({id:'note-'+annotateCount,kind:p.p_kind,body:p.p_body,created_at:new Date().toISOString()});data='note-'+annotateCount;}
      else if(fn==='newbiz_research_withdraw'){data=sessions.delete(p.p_session);}
      await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
    });
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'/condition.html');await page.waitForFunction(()=>window.__condition);
    const noConsent=await page.evaluate(async({rec,res})=>{await __condition.researchSubmit(rec,res);return (await NLResearchStore.all()).length;},{rec,res});assert.equal(noConsent,0);
    await page.evaluate(async({rec,res,consent})=>{Object.assign(__condition.S,{attemptId:rec.attemptId});await __condition.researchSubmit({...rec,researchConsent:consent},res);},{rec,res,consent});
    let local=await page.evaluate(()=>NLResearchStore.all());assert.equal(local[0].status,'pending');assert.equal(local[0].pk.summary.checkin.phq,undefined);assert.equal(sessions.size,1);
    await page.reload();await page.evaluate(()=>NLResearchStore.flush());assert.equal(sessions.size,1);assert.equal(beginCount,2);
    local=await page.evaluate(()=>NLResearchStore.all());assert.ok(local[0].pk===null,JSON.stringify({status:local[0].status,error:local[0].error}));
    console.log('PASS consent exclusion, completed-attempt capture, durable retry after reload, idempotent identity, raw outbox cleanup');
    const demo=await page.evaluate(async({rec,res,consent})=>{await __condition.researchSubmit({...rec,attemptId:'demo',demo:true,researchConsent:consent},res);return (await NLResearchStore.all()).length;},{rec,res,consent});assert.equal(demo,1);
    await context.route('https://raw.githubusercontent.com/**',r=>r.abort());
    await page.goto(base+'/dataset.html#measurements');await page.waitForFunction(()=>document.querySelector('#loginForm').hidden===false);assert.equal(await page.locator('#sessions button').count(),0);
    await page.evaluate(()=>localStorage.datasetTestRole='reviewer');await page.reload();await page.locator('[data-session]').first().click();await page.locator('#noteForm').waitFor();
    await page.locator('#noteText').fill('프레임 누락 재현 · 버전 비교 후 후속 검증');await page.locator('#noteForm button').click();await page.waitForFunction(()=>document.querySelector('.notes').textContent.includes('프레임 누락 재현'));assert.equal(annotateCount,1);
    const csv='t_ms,bpm,quality\n'+Array.from({length:31},(_,i)=>`${i*1000},72,1`).join('\n');
    await page.locator('#referenceFile').setInputFiles({name:'reference.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});await page.locator('#referenceSource').fill('Fixture contact sensor');await page.locator('#syncNote').fill('Fixture shared-clock marker');await page.locator('#syncError').fill('10');await page.locator('#refVerified').check();await page.locator('#referenceForm button').click();
    await page.waitForFunction(()=>document.querySelector('.notes').textContent.includes('기준 심박 동시 구간 비교'));
    const comparison=sessions.get(rec.attemptId).annotations.at(-1).body.comparison;assert.ok(comparison.metrics.mae<1);assert.ok(comparison.metrics.pairs>=2);assert.equal(comparison.status,'paired');
    await page.locator('#replay').click();await page.waitForFunction(()=>document.querySelector('.notes').textContent.includes('동일 원자료 엔진 비교'),null,{timeout:60000});assert.equal(sessions.get(rec.attemptId).annotations.at(-1).kind,'replay');
    await page.screenshot({path:path.join(process.env.TEMP||root,'condition-dataset-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(process.env.TEMP||root,'condition-dataset-mobile.png'),fullPage:true});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    console.log('PASS reviewer page, append-only actions, verified hash decode, reference import, fixed-epoch comparison, worker replay, responsive layout');
    const localPk={...pk,code:'NLR-LOCAL'};await page.locator('#import').setInputFiles({name:'session.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(localPk))});await page.locator('[data-session]').click();
    await page.locator('#noteText').fill('<img src=x onerror=alert(1)>');await page.locator('#noteForm button').click();assert.equal(await page.locator('.notes img').count(),0);assert.equal(annotateCount,3);
    await page.evaluate(async()=>{await NLResearchStore.withdraw('a0000000-0000-0000-0000-000000000001');});assert.equal(sessions.size,0);assert.equal((await page.evaluate(()=>NLResearchStore.all())).length,0);
    const interrupted=await page.evaluate(async({pk,consent})=>{
      pk.meta.attemptId='b0000000-0000-0000-0000-000000000001';pk.meta.outcome='recording';pk.summary.dataset.attemptId=pk.meta.attemptId;pk.summary.dataset.outcome='recording';
      await NLResearchStore.save(pk,consent,{draft:true});await NLResearchStore.flush();const active=(await NLResearchStore.get(pk.meta.attemptId)).status;
      await new Promise((resolve,reject)=>{const r=indexedDB.open('nl-condition-research-v1',1);r.onsuccess=()=>{const tx=r.result.transaction('outbox','readwrite'),s=tx.objectStore('outbox'),q=s.get(pk.meta.attemptId);q.onsuccess=()=>{q.result.updatedAt=Date.now()-11*60000;s.put(q.result);};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);};});
      await NLResearchStore.flush();return {active,status:(await NLResearchStore.get(pk.meta.attemptId)).status};
    },{pk,consent});assert.deepEqual(interrupted,{active:'draft',status:'sent'});assert.equal(sessions.values().next().value.audit.outcome,'interrupted');
    await page.evaluate(()=>NLResearchStore.withdraw('b0000000-0000-0000-0000-000000000001'));assert.equal(sessions.size,0);
    migration=false;
    const legacy=await page.evaluate(async({pk,consent})=>{pk.meta.attemptId='c0000000-0000-0000-0000-000000000001';pk.summary.dataset.attemptId=pk.meta.attemptId;await NLResearchStore.save(pk,consent);await NLResearchStore.flush();const r=await NLResearchStore.get(pk.meta.attemptId);return {status:r.status,legacy:r.legacy};},{pk,consent});
    assert.deepEqual(legacy,{status:'sent',legacy:true});assert.equal(sessions.size,1);await page.evaluate(()=>NLResearchStore.withdraw('c0000000-0000-0000-0000-000000000001'));
    assert.deepEqual(errors,[]);console.log('PASS local-only import, escaped notes, participant withdrawal');
    console.log('PASS active draft remains local; stale checkpoint becomes interrupted attempt');
    console.log('PASS existing research collection continues before reviewer migration');
  }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
