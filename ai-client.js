/* Shared AI transport: HttpOnly server sessions, authenticated calls and pending-result reuse. */
(function(root){
  'use strict';
  let ready=null;
  const pending=new Map();
  async function session(signal){
    if(!ready)ready=fetch('/api/ai-session',{method:'POST',credentials:'same-origin',signal})
      .then(async response=>{if(!response.ok)throw Error((await response.json()).error||'ai_session_unavailable');})
      .catch(error=>{ready=null;throw error;});
    return ready;
  }
  async function run(url,options){
    await session(options.signal);
    const headers=new Headers(options.headers||{});
    if(root.NLAuth?.client){
      const result=await root.NLAuth.client.auth.getSession();
      const token=result.data?.session?.access_token;
      if(token)headers.set('Authorization','Bearer '+token);
    }
    let renewed=false;
    for(let count=0;count<40;count++){
      const response=await fetch(url,{...options,headers,credentials:'same-origin'});
      if(response.status===401&&!renewed){
        const body=await response.clone().json().catch(()=>({}));
        if(body.code==='ai_session_required'){ready=null;await session(options.signal);renewed=true;continue;}
      }
      if(response.status!==202)return response;
      await new Promise((resolve,reject)=>{
        const signal=options.signal;
        const abort=()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));};
        const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},2000);
        if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
      });
    }
    throw Error('generation_timeout');
  }
  root.NLAI={fetch:async(url,options={})=>{
    const key=url+':'+String(options.body||'');
    // Requests with individual cancellation retain their own signal.
    if(options.signal)return run(url,options);
    if(!pending.has(key))pending.set(key,run(url,options).finally(()=>pending.delete(key)));
    return (await pending.get(key)).clone();
  }};
})(window);
