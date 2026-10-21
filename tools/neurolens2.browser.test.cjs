/* Integration tests use a real Edge browser. Camera fixture is test-only and never shipped as a bypass. */
const {chromium}=require('playwright'),{spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'output','neurolens2'),python=process.env.NL2_PYTHON||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
fs.mkdirSync(out,{recursive:true});
async function launchServer(){const child=spawn(python,['-X','utf8',path.join(__dirname,'neurolens2_preview.py'),'--port','0'],{cwd:root,stdio:['ignore','pipe','pipe']});
  const state=await new Promise((resolve,reject)=>{let data='';const timer=setTimeout(()=>reject(Error('preview timeout')),10000);child.stdout.on('data',d=>{data+=d;const line=data.split('\n')[0];try{const state=JSON.parse(line);clearTimeout(timer);resolve(state);}catch{}});child.once('error',reject);});return {child,state};}
(async()=>{
 const reports=[],servers=[],errors=[],requests=[];let browser;
 const record=reports.push.bind(reports);reports.push=(message)=>{console.log('PASS: '+message);return record(message);};
 try{
  browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  async function open(options={}){const server=await launchServer();servers.push(server);const context=await browser.newContext({viewport:{width:1440,height:1080},acceptDownloads:true,...options});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));return {server,context,page};}
  const {server,context,page}=await open();
  await page.goto(server.state.url);await page.locator('#app').waitFor({state:'visible'});
  assert.equal(new URL(page.url()).hash,'');assert.ok(!await page.locator('#auth').isVisible());
  await page.screenshot({path:path.join(out,'01-studio-desktop.png'),fullPage:true});reports.push('single-use local admin bootstrap; ticket removed from URL');
  await page.click('#demo');await page.locator('#export-result').waitFor({state:'visible'});
  assert.match(await page.locator('#results').innerText(),/SYNTHETIC/);
  const dl=page.waitForEvent('download');await page.click('#export-result');const exported=await dl;const exportPath=path.join(out,'synthetic-session.json');await exported.saveAs(exportPath);
  const p=JSON.parse(fs.readFileSync(exportPath));assert.ok(p.result.windows.some(w=>w.bpm!==null));assert.equal(p.origin,'synthetic');
  await page.screenshot({path:path.join(out,'02-evidence-desktop.png'),fullPage:true});reports.push('real analysis worker computes synthetic pulse and exports complete provenance');
  await page.click('#new-session');await page.locator('#import').setInputFiles(exportPath);await page.locator('#results').waitFor({state:'visible'});
  const dl2=page.waitForEvent('download');await page.click('#export-result');const imported=await dl2;const importedPath=path.join(out,'replayed-session.json');await imported.saveAs(importedPath);const replay=JSON.parse(fs.readFileSync(importedPath));
  assert.equal(replay.origin,'imported');assert.deepEqual(p.result,replay.result);reports.push('export/import recomputes identical result; imported origin is quarantined from baseline');
  await page.click('#new-session');await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'03-studio-mobile.png'),fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.click('[data-nav="methods"]');assert.match(await page.locator('#methods').innerText(),/독자 구현/);await page.screenshot({path:path.join(out,'04-methods-mobile.png'),fullPage:true});reports.push('mobile 390px layout and explanatory method page');
  await page.click('[data-nav="overview"]');await page.setViewportSize({width:1440,height:1080});
  // The bundled Playwright clock stalls on this host. Drive only the app's animation
  // clock from the test realm; no production query parameter or bypass is introduced.
  async function installClock(){await page.evaluate(()=>{const now=performance.now.bind(performance),raf=window.requestAnimationFrame,cancel=window.cancelAnimationFrame;let time=now(),seq=0;const pending=new Map();window.__frameQueue=pending;
    Object.defineProperty(performance,'now',{configurable:true,value:()=>time});window.requestAnimationFrame=fn=>{pending.set(++seq,fn);return seq;};window.cancelAnimationFrame=id=>pending.delete(id);
    window.__advance=ms=>{const end=time+ms;while(time<end){time=Math.min(time+16,end);const batch=[...pending.values()];pending.clear();batch.forEach(fn=>fn(time));}};
    window.__restoreClock=()=>{Object.defineProperty(performance,'now',{configurable:true,value:now});window.requestAnimationFrame=raf;window.cancelAnimationFrame=cancel;pending.clear();};});}
  async function beginVirtual(){await installClock();await page.locator('#start').dispatchEvent('click');await page.waitForFunction(()=>window.__frameQueue.size>0,{},{polling:100});await page.evaluate(()=>window.__advance(16));}
  async function advance(ms){await page.evaluate(ms=>window.__advance(ms),ms);}
  async function endVirtual(){await page.evaluate(()=>window.__restoreClock());await page.locator('#export-result').waitFor({state:'visible'});}
  await page.check('#behavior-only');await page.selectOption('#protocol','daily60');await page.selectOption('#focus','reward');await beginVirtual();
  await advance(22500);
  for(let i=0;i<8;i++){await advance(350);await page.keyboard.press('ArrowLeft');await advance(i===7?500:2650);}
  await advance(16000);await endVirtual();
  const dl3=page.waitForEvent('download');await page.click('#export-result');const measured=await dl3;const behaviorPath=path.join(out,'behavior-session.json');await measured.saveAs(behaviorPath);const behavior=JSON.parse(fs.readFileSync(behaviorPath));
  assert.equal(behavior.status,'completed');assert.equal(behavior.elapsed,60000);assert.equal(behavior.frames.length,0);assert.equal(behavior.result.features.find(f=>f.id==='reward').n,8);assert.equal(behavior.result.features.find(f=>f.id==='pulse').value,null);
  reports.push('60-second interactive session finishes within budget; 8 responses; no fabricated camera evidence');
  await page.click('#new-session');await page.selectOption('#protocol','first180');await beginVirtual();await advance(180100);await endVirtual();assert.match(await page.locator('#results').innerText(),/시간 예산 완료/);reports.push('full 180-second protocol completes through all nine phases');
  await page.click('#new-session');await page.selectOption('#protocol','daily60');await beginVirtual();await advance(2000);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await endVirtual();assert.match(await page.locator('#results').innerText(),/중단된 측정/);reports.push('focus loss aborts session instead of resuming with invalid timing');
  await page.click('#logout');await page.locator('#auth').waitFor({state:'visible'});assert.equal((await page.request.get(new URL('/api/neurolens2',server.state.url).href)).status(),401);reports.push('logout revokes local session');await context.close();
  const cameraTest=await open();
  await cameraTest.page.addInitScript(()=>{const streamState={stops:0};window.__fixtureCamera=streamState;
    navigator.mediaDevices.getUserMedia=async()=>{const c=document.createElement('canvas');c.width=640;c.height=480;const ctx=c.getContext('2d');let active=true;const draw=()=>{if(!active)return;ctx.fillStyle='#888';ctx.fillRect(0,0,640,480);requestAnimationFrame(draw);};draw();const stream=c.captureStream(30);const track=stream.getVideoTracks()[0],stop=track.stop.bind(track);track.stop=()=>{active=false;streamState.stops++;stop();};return stream;};});
  await cameraTest.page.goto(cameraTest.server.state.url);await cameraTest.page.locator('#app').waitFor({state:'visible'});await cameraTest.page.click('#start');
  await cameraTest.page.locator('#phase-counter').filter({hasText:'01 /'}).waitFor({timeout:45000});await cameraTest.page.locator('#quality').filter({hasText:'얼굴 위치'}).waitFor({timeout:15000});
  await cameraTest.page.screenshot({path:path.join(out,'05-camera-worker.png'),fullPage:true});await cameraTest.page.click('#stop');await cameraTest.page.locator('#export-result').waitFor({state:'visible'});assert.ok(await cameraTest.page.evaluate(()=>window.__fixtureCamera.stops>0));
  assert.ok(requests.some(url=>url.includes('vision_wasm_internal.wasm')||url.includes('vision_wasm_nosimd_internal.wasm')));assert.ok(requests.some(url=>url.includes('face_landmarker.task')));reports.push('vendored MediaPipe actually loads in a worker; blank video is rejected; camera track stops');await cameraTest.context.close();
  const denial=await open();await denial.page.addInitScript(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('denied','NotAllowedError');};});await denial.page.goto(denial.server.state.url);await denial.page.locator('#app').waitFor({state:'visible'});await denial.page.click('#start');await denial.page.locator('#setup-status').filter({hasText:'행동 과제 모드'}).waitFor();assert.ok(await denial.page.locator('#start').isEnabled());reports.push('camera denial restores setup with explicit behavioral fallback');await denial.context.close();
  const publicContext=await browser.newContext();const publicPage=await publicContext.newPage();await publicPage.goto(new URL('/neurolens2.html',server.state.url).href);await publicPage.locator('#auth-status').filter({hasText:'로그인'}).waitFor();assert.ok(!await publicPage.locator('#app').isVisible());reports.push('unauthenticated browser cannot enter the research UI');await publicContext.close();
  const operating=requests.filter(url=>/\/(condition(?:-lite)?\/|condition\.html|auth\.js|api\/(neurolens_dataset|rppg|condition_lite)|supabase-config\.js)/.test(url));assert.deepEqual(operating,[]);assert.deepEqual(errors,[]);reports.push('no operational page/module/API requests and no browser JS errors');
  fs.writeFileSync(path.join(out,'browser-test-results.json'),JSON.stringify({passed:reports.length,reports,errors,operationalRequests:operating},null,2));console.log(JSON.stringify({passed:reports.length,reports},null,2));
 }finally{await browser?.close();for(const {child} of servers)child.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
