/* Browser integration: synthetic camera and deterministic inference; --real also
 * smoke-tests the actual pinned MediaPipe/WASM worker on an existing stimulus image. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const root=__dirname;
const lm=Array.from({length:478},()=>({x:.5,y:.5,z:0}));
for(const [i,x,y] of [[234,.25,.5],[454,.75,.5],[10,.5,.18],[152,.5,.85],[1,.5,.515],[151,.5,.3],[50,.35,.6],[280,.65,.6],
 [33,.32,.43],[133,.44,.43],[159,.38,.415],[145,.38,.445],[362,.56,.43],[263,.68,.43],[386,.62,.415],[374,.62,.445]])lm[i]={x,y,z:0};
for(let i=468;i<478;i++)lm[i]={x:i<473?.38:.62,y:.43,z:0};
const mock=`export const FilesetResolver={forVisionTasks:async()=>({})};export const FaceLandmarker={createFromOptions:async()=>({detectForVideo(){const end=performance.now()+90;while(performance.now()<end){};return {faceLandmarks:[${JSON.stringify(lm)}],faceBlendshapes:[{categories:[]}]};},close(){}})};`;
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost'),file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  try{let body=fs.readFileSync(file);if(url.pathname==='/condition.html')body=Buffer.from(body.toString().replace(/<\/script>\s*<\/body>/,'window.__condition={S,processResult,liveRecord};</script></body>'));
    const type={'.html':'text/html; charset=utf-8','.js':'text/javascript','.jpg':'image/jpeg','.json':'application/json'}[path.extname(file)]||'application/octet-stream';
    res.writeHead(200,{'Content-Type':type});res.end(body);
  }catch(e){res.writeHead(404).end();}
});
async function main(){
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({executablePath:process.env.CONDITION_EDGE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  try{
    const context=await browser.newContext();
    await context.route('**/vision_bundle.mjs',r=>r.fulfill({status:200,contentType:'text/javascript',headers:{'Access-Control-Allow-Origin':'*'},body:mock}));
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      const c=document.createElement('canvas');c.width=640;c.height=480;const ctx=c.getContext('2d');
      setInterval(()=>{ctx.fillStyle='rgb(28,22,18)';ctx.fillRect(0,0,640,480);},33);
      navigator.mediaDevices.getUserMedia=async()=>c.captureStream(30);
    });
    await page.goto(base+'/condition.html');
    await page.waitForFunction(()=>window.__condition);
    await page.evaluate(()=>{document.querySelector('#camStart').click();document.querySelector('#sSetup').hidden=false;});
    await page.waitForFunction(()=>window.__condition.S.camera?.info.inferred>=10);
    const result=await page.evaluate(()=>({info:{...__condition.S.camera.info},frames:__condition.S.buf,enabled:!document.querySelector('#goRun').disabled}));
    assert.equal(result.info.backend,'worker');assert.ok(result.info.captured>result.info.inferred*1.5);
    assert.ok(result.frames.some(f=>f.ppgOk&&f.r<45));assert.ok(result.frames.some(f=>f.faceOk&&f.exposureGain>1));
    assert.ok(result.enabled,'slow inference must not block starting the whole test');
    console.log('PASS worker capture/inference separation, dim RGB retention, enhanced landmarks, casual setup entry',result.info);
    const partial=await page.evaluate(lm=>{
      const {S,processResult}=__condition,fr={t:performance.now(),ok:false};let seen=0;
      S.onFeature=()=>seen++;
      processResult(fr,{result:{faceLandmarks:[lm]},skin:{n:0,q:0,rr:[null,null,null],rois:[]},eyes:{left:.8,right:0},gain:1},{feature:S.onFeature});
      return {face:fr.faceOk,eye:fr.eyeOk,gaze:fr.gazeOk,skin:fr.ppgOk,seen};
    },lm);
    assert.deepEqual(partial,{face:true,eye:true,gaze:true,skin:false,seen:1});
    console.log('PASS unavailable skin and one occluded eye retain gaze calibration samples');
    const support=await page.evaluate(()=>new Promise((resolve,reject)=>{
      const worker=new Worker('condition-analysis-worker.js'),timer=setTimeout(()=>{worker.terminate();reject(new Error('numeric analysis timeout'));},15000);
      worker.onerror=e=>{clearTimeout(timer);worker.terminate();reject(new Error(e.message));};
      worker.onmessage=({data:m})=>{clearTimeout(timer);worker.terminate();m.error?reject(new Error(m.error)):resolve(m.evidence);};
      worker.postMessage({id:1,key:'baseline',start:0,end:20000,frames:NLNewbiz.synthFrames(0,20000,()=>72,{noise:.05})});
    }));
    assert.ok(support.validSeconds>15);assert.ok(Math.abs(support.bpm-72)<3);
    console.log('PASS numeric analysis worker accumulates unique support independently of video capture');
    await page.evaluate(()=>__condition.S.camera.fallback('test-worker-failure'));
    await page.waitForFunction(()=>__condition.S.camera.info.backend==='main-thread');
    const before=await page.evaluate(()=>__condition.S.camera.info.inferred);
    await page.waitForFunction(n=>__condition.S.camera.info.inferred>n+2,before);
    console.log('PASS worker failure falls back and continues capture');
    await page.evaluate(()=>__condition.S.camera.stop());assert.deepEqual(errors,[]);await context.close();
    if(process.argv.includes('--real')){
      const real=await browser.newPage();real.on('pageerror',e=>errors.push(e.message));
      await real.goto(base+'/condition.html');await real.waitForFunction(()=>window.NLCamera);
      const actual=await real.evaluate(async base=>{
        const image=new Image();image.src=base+'/newbiz-stim/B/pos_person_07.jpg';await image.decode();
        const c=document.createElement('canvas');c.width=640;c.height=480;const ctx=c.getContext('2d');ctx.drawImage(image,0,0,640,480);
        const v=document.createElement('video');v.muted=true;v.srcObject=c.captureStream(15);await v.play();
        let faces=0,frames=0;
        const camera=new NLCamera(v,{base:'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14',model:'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task',
          loadFallback:async()=>{throw new Error('Real worker failed');},onFrame:()=>null,onResult:(_,p)=>{frames++;if(p.result.faceLandmarks?.length)faces++;}});
        await camera.init();
        const until=performance.now()+25000;
        while(frames<3 && performance.now()<until && camera.info.backend==='worker'){camera.capture();await new Promise(r=>setTimeout(r,300));}
        const info={...camera.info,faces,results:frames};camera.stop();v.srcObject.getTracks().forEach(t=>t.stop());return info;
      },base);
      console.log('Real worker diagnostics',actual);
      assert.equal(actual.backend,'worker');assert.ok(actual.results>=2);assert.ok(actual.faces>=1);
      console.log('PASS real MediaPipe worker/WASM/image inference',actual);assert.deepEqual(errors,[]);await real.close();
    }
  }finally{await browser.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);server.close();process.exitCode=1;});
