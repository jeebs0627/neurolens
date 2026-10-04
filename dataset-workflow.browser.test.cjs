'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{randomUUID}=require('node:crypto');
const {chromium}=require('playwright');
const root=__dirname,sessionId=randomUUID(),otherId=randomUUID(),version='dataset-improvement-1';
const rows=[sessionId,otherId].map((id,i)=>({id,code:'NLR-WORKFLOW-'+i,created_at:'2026-10-04T12:00:00Z',meta:{versions:{core:'fixture-1'}},audit:null,annotations:[]}));
const codeSha='d'.repeat(40),codeTask='evo-'+codeSha.slice(0,12)+'-pulse';
const evolution={schema:'dataset-evolution-1',updatedAt:'2026-10-04T12:00:00Z',entries:[{sha:codeSha,subject:'Improve pulse filtering',committedAt:'2026-10-04T12:00:00Z',url:'https://github.com/jeebs0627/neurolens/commit/'+codeSha,files:[{path:'newbiz-core.js',additions:4,deletions:2}],domains:['pulse'],analysisState:'pending',linkedTaskIds:[],tasks:[{id:codeTask,domain:'pulse',title:'저조도 활용량·오차 검증',rationale:'필터 변경 관측',validationPlan:'기준 센서 동시 측정',prompt:'구현과 검증을 수행하라. Dataset-Task: '+codeTask,generator:'rule'}],deploymentEvents:[{key:'check-1',type:'commit-status',context:'Vercel',state:'success',at:'2026-10-04T12:00:00Z'},{key:'deploy-1',type:'deployment',environment:'Preview',production:false,state:'success',at:'2026-10-04T12:01:00Z'}]}]};
let aiCalls=0,failPrompt=true,failSummary=true,slowPrompt=false;
const auth=`window.NLAuth={getUser:async()=>({id:'reviewer'}),signOut:async()=>{},client:{auth:{getSession:async()=>({data:{session:{access_token:'fixture.jwt.token'}}})},rpc:async(fn,args={})=>{const r=await fetch('/test-rpc/'+fn,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)});return {data:await r.json()}}}};`;
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  function reply(value,status=200){res.writeHead(status,{'Content-Type':'application/json'}).end(JSON.stringify(value));}
  if(req.method==='POST'){
    let text='';for await(const chunk of req)text+=chunk;const b=JSON.parse(text),row=rows.find(r=>r.id===(b.p_session||b.sessionId));
    if(url.pathname.startsWith('/test-rpc/')){
      const fn=url.pathname.split('/').at(-1);
      if(fn==='dataset_access')return reply(true);
      if(fn==='dataset_list')return reply(rows.map(({annotations,...r})=>r));
      if(fn==='dataset_detail')return reply(row);
      if(fn==='dataset_annotate'){const n={id:randomUUID(),kind:b.p_kind,body:b.p_body,created_at:new Date().toISOString()};row.annotations.push(n);return reply(n.id);}
    }
    if(url.pathname==='/api/neurolens_dataset'){
      aiCalls++;assert.equal(req.headers.authorization,'Bearer fixture.jwt.token');assert.deepEqual(Object.keys(b).sort(),['operation','sessionId','sourceId']);
      if(b.operation==='prompt'&&failPrompt){failPrompt=false;return reply({error:'fixture prompt quota failure'},502);}
      if(b.operation==='summary'&&failSummary){failSummary=false;return reply({error:'fixture summary quota failure'},502);}
      if(slowPrompt)await new Promise(r=>setTimeout(r,400));
      const source=row.annotations.find(n=>n.id===b.sourceId),memoId=b.operation==='prompt'?source.id:source.body.memoId;
      const n={id:randomUUID(),kind:'action',created_at:new Date().toISOString(),body:{workflow:version,event:b.operation,sourceId:source.id,memoId,resultId:b.operation==='summary'?source.id:null,promptId:source.body.promptId,provenance:{model:'gemini-3.6-flash'},inputHash:'fixture-sha',text:b.operation==='prompt'?'측정 근거와 메모를 사용해 안경 반사 문제를 개선하라.':'필터 변경을 보고함. 합성 검증만 실시. 실측 정확도는 미검증.',status:'reviewing',humanVerified:false}};
      row.annotations.push(n);return reply({annotation:n});
    }
    return reply({error:'not found'},404);
  }
  const file=path.resolve(root,'.'+url.pathname);if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
  try{res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html; charset=utf-8','.css':'text/css'})[path.extname(file)]||'application/json');res.end(fs.readFileSync(file));}catch(_){res.writeHead(404).end();}
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({executablePath:process.env.CONDITION_EDGE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1360,height:950}}),page=await context.newPage(),errors=[];
    context.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
    await context.route('**/supabase.min.js',r=>r.fulfill({contentType:'text/javascript',body:''}));
    await context.route('**/auth.js',r=>r.fulfill({contentType:'text/javascript',body:auth}));
    await context.route('**/dataset-evolution-log.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(evolution)}));
    await page.goto('http://127.0.0.1:'+server.address().port+'/dataset.html#measurements');
    await page.locator(`[data-session="${sessionId}"]`).click();
    await page.locator('#memoTitle').fill('안경 반사 <img src=x onerror=alert(1)>');await page.locator('#memoTarget').selectOption('pursuit');
    await page.locator('#memoText').fill('저조도에서 시선이 튀었음. 부분 신호도 활용하고 싶음.');await page.locator('#memoMetrics').fill('시선 유효 구간 / 기준 장비 오차');await page.locator('#memoValidation').fill('같은 기기에서 안경 착용 전후 재측정');
    await page.locator('#memoForm button').click();await page.locator('[data-prompt]').waitFor();
    const memo=rows[0].annotations[0];assert.equal(memo.body.event,'memo');assert.equal(await page.locator('.improvement-case img').count(),0);
    await page.locator('[data-prompt]').click();await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('prompt quota failure'));
    assert.equal(rows[0].annotations.length,1);assert.equal(await page.locator('[data-copy]').count(),0);
    await page.locator('[data-prompt]').click();await page.locator('[data-copy]').waitFor();
    let form=page.locator('[data-result-form]');await form.locator('[name=report]').fill('안경 반사 시 후보 가중치를 조정. 합성 시험 통과.');await form.locator('[name=evidence]').fill('fixture commit 1234567');await form.locator('[name=fromVersion]').fill('v1');await form.locator('[name=toVersion]').fill('v2');await form.locator('[name=observedMetrics]').fill('합성 활용률 55% → 70%. 사람 정확도 미측정');await form.locator('[name=followup]').fill('실측 10회, 안경 착용 전후 비교');
    await form.locator('button').click();await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('summary quota failure'));
    assert.equal(rows[0].annotations.filter(n=>n.body.event==='result').length,1);assert.equal(await page.locator('[name=report]').inputValue(),'');
    await page.locator('[data-summary]').click();await page.waitForFunction(()=>document.querySelector('.action-summary').textContent.includes('실측 정확도는 미검증'));
    const result=rows[0].annotations.find(n=>n.body.event==='result'),summary=rows[0].annotations.find(n=>n.body.event==='summary');
    assert.equal(summary.body.resultId,result.id);assert.equal(summary.body.memoId,memo.id);assert.equal(summary.body.humanVerified,false);
    await page.getByText('후속 검증·진행 상태 기록',{exact:true}).click();const review=page.locator('[data-review-form]');
    await review.locator('[name=status]').selectOption('validated');await review.locator('[name=review]').fill('합성 회귀 범위만 검증함');await review.locator('button').click();
    await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('근거를 입력'));assert.equal(rows[0].annotations.filter(n=>n.body.event==='review').length,0);
    await review.locator('[name=evidence]').fill('fixture synthetic-test-01; 인간 대상 미검증');await review.locator('[name=followup]').fill('실측 NLR-NEXT 재검사');await review.locator('button').click();
    await page.waitForFunction(()=>document.querySelector('.action-summary').textContent.includes('synthetic-test-01'));
    await page.locator('[data-view=work]').click();await page.locator('#loadWorkflowLedger').click();await page.waitForFunction(()=>document.querySelector('#workflowLedger').textContent.includes('v1 → v2'));
    assert.ok((await page.locator('#workflowLedger').innerText()).includes('NLR-NEXT'));
    await page.reload();await page.locator(`[data-session="${sessionId}"]`).click();await page.locator('.action-summary').waitFor();assert.ok((await page.locator('.action-summary').innerText()).includes('synthetic-test-01'));
    const downloadPromise=page.waitForEvent('download');await page.locator('#exportOne').click();const download=await downloadPromise;
    const exported=JSON.parse(fs.readFileSync(await download.path(),'utf8'));assert.equal(exported.annotations.length,5);assert.equal(exported.annotations[0].id,memo.id);
    await page.screenshot({path:path.join(process.env.TEMP,'dataset-workflow-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(process.env.TEMP,'dataset-workflow-mobile.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    slowPrompt=true;await page.locator('[data-prompt]').click();await page.locator(`[data-session="${otherId}"]`).click();await page.locator('#memoForm').waitFor();await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('프롬프트를 저장'));
    assert.equal(rows[1].annotations.length,0);assert.ok((await page.locator('#detail').innerText()).includes('NLR-WORKFLOW-1'));assert.equal(await page.locator('.improvement-case').count(),0);
    await page.locator('[data-view=work]').click();await page.locator('#taskSource').selectOption('code');await page.locator('[data-link-session]').selectOption(otherId);await page.locator('[data-promote]').click();await page.locator('[data-copy]').waitFor();
    const linkedMemo=rows[1].annotations.find(n=>n.body.event==='memo');assert.equal(linkedMemo.body.releaseTaskId,codeTask);assert.equal(linkedMemo.body.releaseSha,codeSha);assert.ok(linkedMemo.body.codePrompt.includes(codeTask));
    await page.locator('[data-view=work]').click();await page.locator('[data-link-session]').selectOption(otherId);await page.locator('[data-promote]').click();await page.locator('[data-copy]').waitFor();assert.equal(rows[1].annotations.filter(n=>n.body.event==='memo').length,1);
    await page.locator('[data-view=releases]').click();assert.ok((await page.locator('#releaseTimeline').innerText()).includes('배포 · Preview: 성공'));assert.ok(!(await page.locator('#releaseTimeline').innerText()).includes('운영 배포'));
    await page.locator('[data-view=validation]').click();assert.ok((await page.locator('#accumulationMetrics').innerText()).includes('실측·코드 직접 연결 1'));
    await page.locator('[data-view=work]').click();await page.locator('#taskSource').selectOption('');await page.setViewportSize({width:1360,height:950});await page.screenshot({path:path.join(process.env.TEMP,'dataset-workspace-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(process.env.TEMP,'dataset-workspace-mobile.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.locator('[data-view=measurements]').click();
    const callsBefore=aiCalls;
    await page.locator('#import').setInputFiles({name:'local.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({summary:{},annotations:rows[0].annotations}))});await page.locator('[data-session]').click();assert.equal(await page.locator('[data-prompt]').isDisabled(),true);assert.equal(await page.locator('[data-summary]').isDisabled(),true);assert.equal(aiCalls,callsBefore);
    assert.deepEqual(errors,[]);console.log('PASS memo → prompt → result → summary → verified review; provider failure recovery, durable links, export, session switching, local-only guard, XSS and mobile layout');
  }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
