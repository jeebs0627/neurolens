/* Durable, consent-only outbox. No raw camera images; no administrator credential. */
(function(root){
  'use strict';
  const DB='nl-condition-research-v1',STORE='outbox',RECEIPTS='nlNewbiz:research';let opening;
  const open=()=>opening||(opening=new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE,{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>{opening=null;reject(r.error);};}));
  async function transaction(mode,fn){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,mode),req=fn(tx.objectStore(STORE));tx.oncomplete=()=>resolve(req?.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('local-storage-aborted'));});}
  const all=()=>transaction('readonly',s=>s.getAll()),get=id=>transaction('readonly',s=>s.get(id)),put=v=>transaction('readwrite',s=>s.put(v)),remove=id=>transaction('readwrite',s=>s.delete(id));
  const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(24)),v=>v.toString(16).padStart(2,'0')).join('');
  function receipts(){try{return JSON.parse(localStorage.getItem(RECEIPTS)||'[]');}catch(_){return [];}}
  async function saveRecord(pk,consent,{draft=false}={}){
    if(consent?.research!==true||pk.meta?.demo)throw Error('research-consent-required');
    const id=pk.meta.attemptId;if(!id)throw Error('attempt-id-required');
    const old=await get(id);if(old?.status==='sent'||old?.status==='withdrawing')return old;
    if(draft&&old&&old.status!=='draft')return old;
    const rows=await all();if(!old&&rows.filter(r=>r.pk&&r.status!=='sent').length>=20)throw Error('연구 전송 대기 저장소가 가득 찼습니다. dataset.html에서 내 대기 기록을 확인해 주세요.');
    const row={...old,id,token:old?.token||randomToken(),pk,consent,status:draft?'draft':'pending',updatedAt:Date.now(),createdAt:old?.createdAt||Date.now(),error:null};
    await put(row);return row;
  }
  const save=(...args)=>navigator.locks?navigator.locks.request(DB,()=>saveRecord(...args)):saveRecord(...args);
  async function rpc(fn,body){
    const cfg=root.NL_SUPABASE,ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),20000);
    try{if(!cfg?.url||!cfg.anonKey)throw Error('research-server-not-configured');
      const r=await fetch(cfg.url+'/rest/v1/rpc/'+fn,{method:'POST',headers:{'Content-Type':'application/json',apikey:cfg.anonKey,Authorization:'Bearer '+cfg.anonKey},body:JSON.stringify(body),signal:ctl.signal});
      if(!r.ok){const error=Error(fn+' HTTP '+r.status);error.status=r.status;throw error;}return await r.json();
    }finally{clearTimeout(timer);}
  }
  let flushing=null;
  async function process(){
    const result=[];
    for(const snapshot of await all()){
      let row=await get(snapshot.id);if(!row||row.status==='sent'||row.status==='withdrawing')continue;
      if(row.status==='draft'){
        if(Date.now()-row.updatedAt<10*60*1000)continue;
        row.pk.summary.dataset.outcome='interrupted';row.pk.summary.dataset.actions=root.NLDataset.actions(row.pk.summary.dataset);
        row.pk.meta.outcome='interrupted';row.status='pending';await put(row);
      }
      // Old unsent biometric payloads expire locally; nothing is silently sent after this window.
      if(Date.now()-row.createdAt>7*86400000){row.error='보관 기한 초과 · 로컬 원자료 삭제됨';row.pk=null;row.status='expired';await put(row);continue;}
      if(row.status==='expired')continue;
      try{
        const enc=await root.NLResearch.encode(row.pk.payload);
        const meta={...row.pk.meta,payloadBytes:enc.bytes,rawBytes:enc.rawBytes};let start;
        try{start=await rpc('dataset_research_begin',{p_attempt:row.id,p_token:row.token,p_consent:row.consent,p_meta:meta,p_summary:row.pk.summary});}
        catch(e){
          if(e.status!==404)throw e;
          // Preserve existing collection while the reviewer migration is being deployed.
          // A persisted legacy receipt is always reused, never duplicated on retry.
          if(row.serverId&&row.legacy)start={session_id:row.serverId,code:row.code,status:'uploading'};
          else{const old=await rpc('newbiz_research_begin',{p_consent:row.consent,p_meta:meta,p_summary:row.pk.summary});row.token=old.upload_token;row.legacy=true;start={...old,status:'uploading'};}
        }
        row.serverId=start.session_id;row.code=start.code;await put(row);
        if(start.status!=='complete'){
          for(let i=0;i<enc.chunks.length;i++)await rpc('newbiz_research_chunk',{p_session:row.serverId,p_token:row.token,p_idx:i,p_data:enc.chunks[i]});
          await rpc('newbiz_research_finish',{p_session:row.serverId,p_token:row.token,p_chunks:enc.chunks.length,p_bytes:enc.bytes,p_sha256:enc.sha256});
        }
        row.status='sent';row.error=null;row.bytes=enc.bytes;
        // Retain only a receipt after sending. Browser data cannot expose the central dataset.
        row.pk=null;await put(row);
        try{const list=receipts().filter(v=>v.id!==row.serverId);list.unshift({id:row.serverId,code:row.code,token:row.token,at:row.consent.at});localStorage.setItem(RECEIPTS,JSON.stringify(list.slice(0,50)));}catch(_){}
        result.push({id:row.id,status:'sent',code:row.code});
      }catch(e){row.error=String(e.message||e);row.status='pending';await put(row);result.push({id:row.id,status:'pending',error:row.error});}
    }
    root.dispatchEvent?.(new Event('nl-research-change'));return result;
  }
  function flush(){if(flushing)return flushing;flushing=(navigator.locks?navigator.locks.request(DB,process):process()).finally(()=>{flushing=null;});return flushing;}
  async function withdraw(id){
    // The same lock as uploads avoids deletion racing with an in-flight begin/finish.
    const work=async()=>{const row=await get(id);if(!row)return;
      if(row.serverId)await rpc('newbiz_research_withdraw',{p_session:row.serverId,p_token:row.token});
      await remove(id);try{localStorage.setItem(RECEIPTS,JSON.stringify(receipts().filter(r=>r.id!==row.serverId)));}catch(_){}
    };
    return navigator.locks?navigator.locks.request(DB,work):work();
  }
  root.NLResearchStore={save,all,get,flush,withdraw};
})(typeof window!=='undefined'?window:globalThis);
