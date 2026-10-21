/* CI regression runner. Real UI actions and wall time; no app clock or scoring bypass. */
const {chromium}=require('playwright'),{spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'output','neurolens2'),python=process.env.NL2_PYTHON||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
fs.mkdirSync(out,{recursive:true});
async function server(){const child=spawn(python,['-X','utf8',path.join(__dirname,'neurolens2_preview.py'),'--port','0'],{cwd:root,stdio:['ignore','pipe','pipe']});const state=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('preview timeout')),10000);child.stdout.on('data',d=>{text+=d;try{const value=JSON.parse(text.split('\n')[0]);clearTimeout(timer);resolve(value);}catch{}});child.on('error',reject);});return {child,state};}
(async()=>{
 let browser;const servers=[],reports=[],errors=[],requests=[];
 const pass=text=>{reports.push(text);console.log('PASS: '+text);};
 try{
  browser=await chromium.launch({executablePath:process.env.NL2_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  async function open(){const s=await server();servers.push(s);const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));return {...s,context,page};}
  const main=await open(),page=main.page;
  await page.goto(main.state.url);await page.locator('#app').waitFor({state:'visible'});assert.equal(new URL(page.url()).hash,'');pass('local administrator bootstrap removes the single-use ticket');
  await page.locator('#participant').fill('ci-guided-v21');
  await page.getByText('관리자 검증 도구',{exact:true}).click();await page.click('#demo');await page.locator('#export-result').waitFor();
  async function exportPacket(name){const pending=page.waitForEvent('download');await page.click('#export-result');const download=await pending,file=path.join(out,name);await download.saveAs(file);return JSON.parse(fs.readFileSync(file));}
  const synthetic=await exportPacket('synthetic-session.json');assert.equal(synthetic.origin,'synthetic');assert.ok(synthetic.result.windows.some(w=>w.bpm!==null));
  await page.click('#new-session');await page.locator('#import').setInputFiles(path.join(out,'synthetic-session.json'));await page.locator('#export-result').waitFor();const replay=await exportPacket('replayed-session.json');assert.equal(replay.origin,'imported');assert.deepEqual(replay.result,synthetic.result);pass('analysis worker and JSON replay preserve synthetic provenance and results');
  await page.click('#new-session');await page.check('#behavior-only');await page.selectOption('#protocol','first180');await page.click('#start');
  await page.locator('[data-action="practice"]').waitFor();assert.ok(await page.locator('[data-action="practice"]').isDisabled());
  await page.keyboard.press('ArrowLeft');await page.locator('#task-content [data-response="right"]').click();await page.locator('[data-action="practice"]').click();
  async function practice(kind){await page.locator('[data-action="try-practice"]').click();if(kind==='attention'){await page.locator('[data-action="practice-next"]').waitFor();}
   if(kind==='disengage'){await page.getByRole('button',{name:'오른쪽 원 선택',exact:true}).click();await page.getByRole('button',{name:'왼쪽 원 선택',exact:true}).waitFor();await page.keyboard.press('ArrowLeft');}
   if(kind==='reward')await page.getByRole('button',{name:'오른쪽 네모 선택',exact:true}).click();
   if(kind==='load'){await page.getByRole('button',{name:'오른쪽 답 5 선택',exact:true}).click();await page.getByRole('button',{name:'왼쪽 답 9 선택',exact:true}).waitFor();await page.keyboard.press('1');}
   await page.locator('[data-action="practice-next"]').click();}
  for(const kind of ['attention','disengage','reward','load'])await practice(kind);
  assert.equal(await page.locator('#remaining').innerText(),'180');pass('input check and all four mandatory practices complete without consuming measurement budget');
  await page.locator('[data-action="begin"]').click();
  // Respond through the visible choices. Briefs pause the measurement clock.
  const deadline=Date.now()+300000;let answerNumber=0;
  while(!await page.locator('#export-result').isVisible()){
   assert.ok(Date.now()<deadline,'guided full-session timeout');
   const brief=page.locator('[data-action="phase-begin"]');
   if(await brief.isVisible()){const before=await page.locator('#remaining').innerText();await page.waitForTimeout(300);assert.equal(await page.locator('#remaining').innerText(),before);await brief.click();}
   const choices=page.locator('#task-content [data-response]:enabled');
   if(await choices.count()){
    let choice=choices.first();const question=page.locator('.math-question');
    if(await question.isVisible()){const [a,b]=(await question.innerText()).match(/\d+/g).map(Number);choice=choices.filter({hasText:String(a+b)});}
    if(answerNumber++%2){const side=await choice.getAttribute('data-response');await page.keyboard.press(side==='left'?'ArrowLeft':'ArrowRight');}else await choice.click();
   }
   await page.waitForTimeout(80);
  }
  const measured=await exportPacket('behavior-session-v21.json');
  assert.equal(measured.status,'completed');assert.equal(measured.elapsed,180000);assert.equal(measured.frames.length,0);assert.equal(measured.practice.length,4);assert.equal(measured.segments.length,9);
  assert.ok(measured.timing.guidanceMs>=12000);assert.ok(measured.trials.filter(t=>t.responseAt!==undefined).length>=15);
  assert.ok(measured.trials.some(t=>t.inputMethod==='pointer'));assert.ok(measured.trials.some(t=>t.inputMethod==='keyboard'));assert.ok(measured.result.features.find(f=>f.id==='pulse').value===null);
  pass('180-second real-time guided session completes; direct and keyboard choices recorded; no invented camera evidence');
  await page.screenshot({path:path.join(out,'ci-results-v21.png'),fullPage:true});
  await page.click('#new-session');await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(out,'ci-mobile-v21.png'),fullPage:true});pass('390px layout has no horizontal overflow');
  await page.setViewportSize({width:1440,height:1000});await page.uncheck('#behavior-only');await page.click('#start');
  await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowRight');assert.ok(await page.locator('[data-action="practice"]').isDisabled());await page.click('#stop');pass('camera mode cannot proceed on input checks alone');
  const blank=await open();await blank.page.addInitScript(()=>{window.__fixtureStopped=false;navigator.mediaDevices.getUserMedia=async()=>{const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;const ctx=canvas.getContext('2d');ctx.fillStyle='#888';ctx.fillRect(0,0,640,480);const stream=canvas.captureStream(30),track=stream.getVideoTracks()[0],stop=track.stop.bind(track);track.stop=()=>{window.__fixtureStopped=true;stop();};return stream;};});
  await blank.page.goto(blank.state.url);await blank.page.locator('#app').waitFor({state:'visible'});await blank.page.click('#start');await blank.page.locator('[data-action="connect"]').click();await blank.page.locator('[data-action="connect"]').filter({hasText:'카메라 다시 맞추기'}).waitFor({timeout:45000});await blank.page.waitForTimeout(2500);assert.ok(await blank.page.locator('[data-action="practice"]').isDisabled());await blank.page.click('#stop');assert.ok(await blank.page.evaluate(()=>window.__fixtureStopped));await blank.context.close();pass('real vision worker rejects a blank camera and releases the track on cancellation');
  await page.click('#logout');await page.locator('#auth').waitFor({state:'visible'});assert.equal((await page.request.get(new URL('/api/neurolens2',main.state.url).href)).status(),401);pass('logout revokes administrator access');
  assert.ok(requests.some(url=>url.includes('face_landmarker.task')));const operating=requests.filter(url=>/\/(condition(?:-lite)?\/|condition\.html|auth\.js|api\/(neurolens_dataset|rppg|condition_lite)|supabase-config\.js)/.test(url));assert.deepEqual(operating,[]);assert.deepEqual(errors,[]);pass('no operating modules requested and no unhandled browser errors');
  fs.writeFileSync(path.join(out,'browser-test-results-v21.json'),JSON.stringify({engine:'nl2-2.1.0',passed:reports.length,reports,errors},null,2));
 }finally{await browser?.close();for(const s of servers)s.child.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
