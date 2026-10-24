'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const authScript=`window.supabase={createClient:()=>({auth:{
 getSession:async()=>({data:{session:window.fixtureSignedIn?{user:{id:'fixture-user',email:'fixture@example.invalid'},access_token:'fixture-token'}:null}}),
 getUser:async()=>({data:{user:window.fixtureSignedIn?{id:'fixture-user',email:'fixture@example.invalid'}:null}}),
 onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})
}})};`;
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost'),name=url.pathname==='/'?'index.html':url.pathname==='/condition'?'condition.html':decodeURIComponent(url.pathname.slice(1));
 const file=path.resolve(root,name);
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
 res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.json':'application/json'})[path.extname(file)]||'application/octet-stream'});
 fs.createReadStream(file).pipe(res);
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  const launch={headless:true};
  if(process.env.VERCEL&&process.platform==='linux'){
   const {default:portable}=await import('@sparticuz/chromium');
   launch.args=portable.args;launch.executablePath=await portable.executablePath();
  }else if(process.platform==='win32'&&fs.existsSync(edge))launch.executablePath=edge;
  browser=await chromium.launch(launch);
  const base='http://127.0.0.1:'+server.address().port;
  async function open(signedIn=false){
   const context=await browser.newContext();
   await context.addInitScript(value=>{window.fixtureSignedIn=value;window.cameraCalls=0;navigator.mediaDevices.getUserMedia=async()=>{window.cameraCalls++;throw Error('fixture camera');};},signedIn);
   const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
   await page.route('**/*',route=>route.request().url().includes('@supabase/supabase-js@2/')?
    route.fulfill({contentType:'application/javascript',body:authScript}):route.request().url().startsWith(base)?route.continue():route.abort());
   return {context,page,errors};
  }
  const guest=await open();
  await guest.page.goto(base+'/condition');await guest.page.click('#goCheckin');
  await guest.page.waitForURL(url=>url.pathname==='/'&&url.searchParams.get('next')==='/condition');
  await guest.page.locator('#authModal.open').waitFor();
  assert.equal(await guest.page.evaluate(()=>window.cameraCalls),0);
  assert.deepEqual(guest.errors,[]);
  console.log('PASS anonymous measurement redirects to login before camera access');
  const member=await open(true);
  await member.page.goto(base+'/?next=%2Fcondition#login');await member.page.waitForURL(base+'/condition');
  await member.page.click('#goCheckin');await member.page.locator('#sCheckin').waitFor({state:'visible'});
  assert.deepEqual(member.errors,[]);
  console.log('PASS signed-in return path resumes the condition check-in');
  await guest.page.goto(base+'/condition?collect=rppg');
  await guest.page.waitForURL(url=>url.pathname==='/'&&url.searchParams.has('next'));
  assert.equal(await guest.page.evaluate(()=>window.cameraCalls),0);
  await guest.page.goto(base+'/condition?sim=fatigue');await guest.page.locator('#sReport').waitFor({state:'visible'});
  assert.ok((await guest.page.locator('#sReport').innerText()).length>100);
  await member.page.goto(base+'/?next=https%3A%2F%2Fexample.invalid#login');
  assert.equal(new URL(member.page.url()).origin,base);
  console.log('PASS collection camera gate, public synthetic sample and external-return rejection');
  const transport=await open();let sessions=0,generations=0;
  await transport.page.route('**/api/ai-session',route=>{sessions++;return route.fulfill({json:{ok:true}});});
  await transport.page.route('**/gemini',async route=>{generations++;await new Promise(r=>setTimeout(r,30));return route.fulfill({json:{text:'fixture summary'}});});
  await transport.page.goto(base+'/report.html?legacy=1');
  // The page has no result, so call the transport with an explicit synthetic request.
  const texts=await transport.page.evaluate(async()=>Promise.all(Array.from({length:20},async()=>{
   const response=await NLAI.fetch('/gemini',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"mbti":"ENFP"}'});return (await response.json()).text;
  })));
  assert.equal(sessions,1);assert.equal(generations,1);assert.equal(texts.length,20);
  assert.ok(texts.every(text=>text==='fixture summary'));
  console.log('PASS 20 concurrent browser requests share one session and one generation');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
