(function(){
  'use strict';
  const D=NLDataset,$=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=(v,n=1)=>Number.isFinite(v)?v.toFixed(n):'—',pct=v=>Number.isFinite(v)?(v*100).toFixed(0)+'%':'—';
  let rows=[],selected=null,allowed=false,cursor=null,source='none',loading=false,ledgerLoaded=false;
  const tell=(message,error=false)=>{$('message').textContent=message;$('message').classList.toggle('error',error);};
  async function rpc(fn,args={}){if(!NLAuth.client)throw Error('서버 연결 설정을 확인하세요.');const {data,error}=await NLAuth.client.rpc(fn,args);if(error)throw Error(error.message||'서버 요청 실패');return data;}
  function download(value,name){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function normalize(input,index){
    const audit=input.audit||input.summary?.dataset||null;
    const row={id:input.id||'local-'+index+'-'+crypto.randomUUID(),code:input.code||audit?.attemptId||'로컬 기록',created_at:input.created_at||audit?.measuredAt||input.meta?.measuredAt,meta:input.meta||{},audit,
      annotations:Array.isArray(input.annotations)?input.annotations:[],reference_review:input.reference_review||null,payload:input.payload||null,local:true};
    if(audit&&audit.schema!==D.VERSION)throw Error('지원하지 않는 dataset 스키마입니다.');
    if(audit&&(!Array.isArray(audit.tests)||!Array.isArray(audit.actions)))throw Error('검사·조치 기록 형식을 확인하세요.');
    if(!audit&&!input.payload&&!input.summary)throw Error('연구 내보내기 JSON 또는 dataset 기록이 필요합니다.');return row;
  }
  function filtered(){return rows.filter(r=>{
    const a=r.audit,key=$('testFilter').value,outcome=$('outcomeFilter').value,version=$('versionFilter').value,q=$('search').value.trim().toLowerCase();
    return (!q||r.code.toLowerCase().includes(q))&&(!version||(a?.versions?.core||r.meta.versions?.core)===version)&&(!key||a?.tests.some(t=>t.key===key&&!['off','not-started'].includes(t.status)))&&(!outcome||(outcome==='complete'?a?.outcome==='complete':a&&a.outcome!=='complete'));
  });}
  function effectiveAudit(row){const ref=[...(row.annotations||[])].reverse().find(n=>n.kind==='reference')?.body?.comparison||row.reference_review;return row.audit?{...row.audit,reference:ref||row.audit.reference}:null;}
  function render(){
    NLDatasetWorkspace.update({rows,allowed,source});window.NLDatasetLab?.update({rows,allowed,annotate:(r,b)=>annotate(r,'action',b,true)});window.NLDatasetTraining?.update({rows,allowed});
    if(ledgerLoaded)NLDatasetWorkflow.ledger($('workflowLedger'),rows,r=>select(r).catch(e=>tell(e.message,true)));
    else $('workflowLedger').textContent='집계를 누르면 현재 불러온 검사들의 개선 이력을 조회합니다.';
    const visible=filtered(),audits=visible.map(effectiveAudit).filter(Boolean),c=D.cohort(audits);
    $('metrics').innerHTML=[['기록된 시도',c.attempts+'건','현재 필터·불러온 범위'],['검사 완료율',pct(c.completionRate),'중단·실패 포함'],['기준 비교 세션',c.pairedSessions+'건','탐색적 '+c.exploratorySessions+'건 별도'],['기준 비교 MAE',fmt(c.sessionMeanMae)+' bpm','세션별 평균 · 미검증 제외'],['자동 검토 후보',c.pendingActions+'건','누적 후보 · 완료 건 포함']].map(([a,b,c])=>`<div class="metric"><small>${a}</small><strong>${b}</strong><small>${c}</small></div>`).join('');
    $('sessions').innerHTML=visible.length?visible.map(r=>`<tr><td><button data-session="${esc(r.id)}">${esc(r.code)}</button><small>${esc(r.created_at?new Date(r.created_at).toLocaleString('ko-KR'):'시각 미기록')}</small></td><td>${esc(r.audit?.outcome||'이전 형식')}<small>${r.local?'로컬 파일':'연구 서버'}</small></td><td>${fmt(r.audit?.acquisition?.fps)}</td><td>${referenceText(effectiveAudit(r)?.reference)}</td><td>${r.audit?.actions?.length??'—'}건</td><td>${esc(r.audit?.versions?.core||r.meta.versions?.core||'미기록')}</td></tr>`).join(''):'<tr><td colspan="6" class="empty">표시할 기록이 없습니다. 서버 연결 또는 연구 JSON 가져오기를 사용하세요.</td></tr>';
    $('sessions').querySelectorAll('[data-session]').forEach(b=>b.onclick=()=>select(rows.find(r=>r.id===b.dataset.session)).catch(e=>tell(e.message,true)));
    $('sourceLabel').textContent=source==='server'?`연구 서버 · ${rows.length}건 불러옴 · 집계는 불러온 범위에 한정` :source==='local'?`로컬 연구 파일 · ${rows.length}건 · 서버에 전송하지 않음`:'아직 불러온 기록이 없습니다.';
  }
  function referenceText(ref){return !ref?'기준값 없음':ref.status==='paired'?`비교 ${fmt(ref.metrics?.mae)} bpm`:ref.status==='exploratory'?`탐색적 ${fmt(ref.metrics?.mae)} bpm`:'동시 유효 구간 없음';}
  function comparisonSummary(row){
    const replay=[...(row.annotations||[])].reverse().find(n=>n.kind==='replay')?.body,ref=effectiveAudit(row)?.reference;
    const entries=replay?[['저장 엔진',replay.before,replay.beforeSeconds],['현재 엔진',replay.after,replay.afterSeconds]]:ref?[['저장 엔진',ref,null]]:[];
    return entries.length?'<h3>비교 요약</h3><div class="table-wrap"><table><thead><tr><th>엔진</th><th>비교 구간</th><th>MAE</th><th>95% 절대오차</th><th>기준 구간 대비 활용률</th></tr></thead><tbody>'+entries.map(([label,c])=>`<tr><td>${label}<small>${esc(c?.status||'정확도 미검증')}</small></td><td>${c?.metrics?.pairs??'—'}</td><td>${fmt(c?.metrics?.mae)} bpm</td><td>${fmt(c?.metrics?.p95AbsoluteError)} bpm</td><td>${pct(c?.acceptedFraction)}</td></tr>`).join('')+'</tbody></table></div><p class="muted">동일한 10초 구간으로 비교합니다. 95% 절대오차는 관측 오차의 백분위이며 신뢰구간이 아닙니다.</p>':'';
  }
  function versions(){const old=$('versionFilter').value,values=[...new Set(rows.map(r=>r.audit?.versions?.core||r.meta.versions?.core).filter(Boolean))];$('versionFilter').innerHTML='<option value="">전체 버전</option>'+values.map(v=>`<option>${esc(v)}</option>`).join('');$('versionFilter').value=values.includes(old)?old:'';}
  async function load(more=false){
    if(!allowed)throw Error('등록된 연구 관리자 권한이 필요합니다.');if(loading)return;loading=true;
    try{const next=await rpc('dataset_list',{p_before:more?cursor?.created_at:null,p_before_id:more?cursor?.id:null,p_limit:50});
      if(!Array.isArray(next))throw Error('서버 응답 형식을 확인하세요.');
      rows=more?[...rows,...next.filter(r=>!rows.some(v=>v.id===r.id))]:next;rows.forEach(r=>r.local=false);cursor=next.at(-1)||cursor;source='server';selected=null;ledgerLoaded=false;$('detail').hidden=true;$('more').hidden=next.length<50;versions();render();tell('연구 기록을 불러왔습니다. 자동 기록은 검토 전 관측 근거입니다.');
      await loadLedger();
    }finally{loading=false;}
  }
  async function access(){
    allowed=false;$('refresh').disabled=true;$('loginForm').hidden=true;
    try{const u=await NLAuth.getUser();$('logout').hidden=!u;
      if(!u){$('accessStatus').textContent='연구 관리자 계정으로 로그인하세요. 로컬 파일과 내 전송 관리는 로그인 없이 사용할 수 있습니다.';$('loginForm').hidden=false;return;}
      allowed=await rpc('dataset_access');$('accessStatus').textContent=allowed?'연구 관리자 권한이 확인되었습니다.':'이 계정은 연구 관리자 목록에 등록되지 않았습니다.';$('refresh').disabled=!allowed;
      if(allowed)await load();
    }catch(e){$('accessStatus').textContent='연구 서버 연결을 확인하지 못했습니다. dataset SQL 적용·권한 등록 상태를 확인하세요. '+e.message;}
  }
  async function payload(row){
    if(row.payload)return row.payload;if(row.local)throw Error('원자료가 없는 요약 파일입니다. 원본 연구 세션 JSON을 가져오세요.');
    const detail=await rpc('dataset_detail',{p_session:row.id,p_payload:true});
    if(!Array.isArray(detail.chunks)||detail.chunks.length!==detail.chunkCount||detail.chunks.some((c,i)=>c.idx!==i))throw Error('원자료 조각 수·순서를 확인하지 못했습니다.');
    const bin=atob(detail.chunks.map(c=>c.data).join('')),bytes=Uint8Array.from(bin,c=>c.charCodeAt(0));
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
    if(hash!==detail.sha256)throw Error('원자료 무결성 검사에 실패했습니다.');
    const text=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();row.payload=JSON.parse(text);return row.payload;
  }
  async function select(row){
    if(!row)return;selected=row;
    NLDatasetWorkspace.activate('measurements');
    if(!row.local){const detail=await rpc('dataset_detail',{p_session:row.id});if(selected!==row)return;row.annotations=detail.annotations||[];}
    renderDetail();$('detail').scrollIntoView({behavior:'smooth',block:'start'});
  }
  const statusLabel=s=>({proposed:'검토 후보',reviewing:'검토 중',implemented:'조치 적용',validated:'검증 완료',dismissed:'보류'}[s]||s);
  function renderDetail(){
    const row=selected,a=effectiveAudit(row);$('detail').hidden=false;
    const notes=row.annotations||[],lastAction=key=>notes.filter(n=>n.kind==='action'&&n.body?.actionKey===key).at(-1)?.body?.status||'proposed';
    const tests=a?.tests||[],actions=a?.actions||[];
    $('detail').innerHTML=`<div class="toolbar"><div><p class="eyebrow">SESSION EVIDENCE</p><h2>${esc(row.code)}</h2><p class="muted">${esc(a?.outcome||'이전 형식')} · ${esc(a?.versions?.core||row.meta.versions?.core||'버전 미기록')} · ${row.local?'로컬 검토':'연구 서버'}</p></div><button id="exportOne">기록·검토 이력 내보내기</button></div>
      <div id="improvementWorkflow"></div>
      <h3>검사별 측정 근거</h3><div class="table-wrap"><table><thead><tr><th>검사</th><th>상태</th><th>관측</th><th>심박 활용</th><th>지표·결과</th></tr></thead><tbody>${tests.map(t=>`<tr><td>${esc(t.label)}</td><td>${esc(t.status)}</td><td>${t.acquisition.frames} 프레임<small>${fmt(t.acquisition.fps)} fps</small></td><td>${t.pulse?`${fmt(t.pulse.bpm)} bpm<small>${fmt(t.pulse.validSeconds)}초 · ${esc(t.pulse.status)}</small>`:'—'}</td><td>${t.indicators.map(i=>`${esc(i.label||i.key)}: ${fmt(i.value)} ${esc(i.unit||'')}${i.excluded?' (해석 제외)':''}`).join('<br>')||'—'}</td></tr>`).join('')||'<tr><td colspan="5">이전 기록에는 검사별 dataset 요약이 없습니다. 원자료 재분석을 사용할 수 있습니다.</td></tr>'}</tbody></table></div>
      <h3>자동 후속 과제</h3><div class="table-wrap"><table><thead><tr><th>영역·우선순위</th><th>근거</th><th>후속 조치</th><th>검토 상태</th></tr></thead><tbody>${actions.map(x=>`<tr><td>${esc(D.LABELS[x.test]||x.test)}<small>${esc(x.priority)} · ${esc(x.ruleVersion)}</small></td><td>${esc(JSON.stringify(x.evidence))}</td><td>${esc(x.next)}</td><td>${esc(statusLabel(lastAction(x.key)))}</td></tr>`).join('')||'<tr><td colspan="4">자동 생성된 과제가 없습니다. 정확도 검증 완료를 뜻하지 않습니다.</td></tr>'}</tbody></table></div>
      <div class="grid"><div class="subpanel"><h3>조치·진단 해석 보정 기록</h3><form class="stack" id="noteForm"><label>대상 과제<select id="actionKey"><option value="general">일반 검토</option>${actions.map(x=>`<option value="${esc(x.key)}">${esc(x.test+' · '+x.next)}</option>`).join('')}</select></label><div class="grid"><label>기록 종류<select id="noteKind"><option value="action">후속 조치</option><option value="correction">진단 해석 보정 제안</option></select></label><label>진행 상태<select id="noteStatus"><option value="reviewing">검토 중</option><option value="implemented">조치 적용</option><option value="validated">검증 완료</option><option value="dismissed">보류</option></select></label></div><label>실측 근거·조치·다음 검증<textarea id="noteText" maxlength="4000" required placeholder="어떤 측정 근거로 무엇을 조치했는지, 후속 검증을 함께 기록하세요."></textarea></label><label>검증 근거 / 커밋 / 실험 ID<input id="noteEvidence" maxlength="1000" placeholder="적용·검증 완료 시 필수"></label><button class="primary">이력 추가</button><p class="muted">원본 측정값과 진단 결과는 덮어쓰지 않습니다.</p></form></div>
      <div class="subpanel"><h3>기준 심박 비교</h3><p>${referenceText(a?.reference)}</p><form class="stack" id="referenceForm"><label>기준 CSV<input type="file" id="referenceFile" accept=".csv,text/csv" required></label><p class="muted">헤더 t_ms,bpm,quality · quality는 0 또는 1. 시각은 기준 장비의 ms입니다. 보정 후 0ms는 이 세션 원자료 첫 프레임입니다.</p><label>장비·측정 출처<input id="referenceSource" maxlength="200" required placeholder="기준 센서 종류와 기록 방법"></label><div class="grid"><label>시각 오프셋(ms)<input id="offset" type="number" value="0" step="any" required></label><label>시계 드리프트(ppm)<input id="drift" type="number" value="0" step="any" min="-5000" max="5000" required></label></div><label>동기화 오차 상한(ms, 모르면 비워두기)<input id="syncError" type="number" min="0" step="any"></label><label>정렬 근거<input id="syncNote" maxlength="500" required placeholder="동시 시작 표식, 장비 기록 시각 등"></label><label><input id="refVerified" type="checkbox"> 기준 장비와 동기화 근거를 검토함</label><button class="primary">동일 구간 비교·기록</button></form><p class="muted">겹치지 않는 구간을 비교합니다. 100ms 이하의 동기화 근거와 장비 검토가 없으면 탐색적으로 표시합니다. 이 기준은 공학적 초기값입니다.</p><button id="replay">현재 엔진으로 재분석·비교</button><div id="comparison"></div></div></div>
      <h3>누적 검토 이력</h3><ul class="notes">${notes.map(n=>`<li><b>${esc(n.kind)} · ${esc(n.created_at||'')}</b><p>${esc(n.body?.note||n.body?.source||'수치 비교 기록')}</p><details><summary>근거 보기</summary><pre>${esc(JSON.stringify(n.body,null,2))}</pre></details></li>`).join('')||'<li class="muted">아직 검토 이력이 없습니다.</li>'}</ul>
      <details><summary>획득·시선·반응시간 계측 및 해석 상태</summary><pre>${esc(JSON.stringify({acquisition:a?.acquisition,timing:a?.timing,gaze:a?.gaze,interpretation:a?.interpretation},null,2))}</pre></details>`;
    $('exportOne').onclick=()=>download(exportRow(row),'dataset-'+row.code+'.json');
    NLDatasetWorkflow.mount($('improvementWorkflow'),row,{tell,save:(r,k,b)=>annotate(r,k,b,true),changed:r=>{render();if(selected===r)renderDetail();}});
    $('comparison').innerHTML=comparisonSummary(row);
    $('noteForm').onsubmit=async e=>{e.preventDefault();const status=$('noteStatus').value,evidence=$('noteEvidence').value.trim();if(['implemented','validated'].includes(status)&&!evidence){tell('적용·검증 완료에는 실험 또는 변경 근거를 입력하세요.',true);return;}
      await runButton(e.submitter,()=>annotate(row,$('noteKind').value,{actionKey:$('actionKey').value,status,note:$('noteText').value.trim(),evidence,engineVersion:a?.versions,ruleVersion:D.VERSION}));};
    $('referenceForm').onsubmit=async e=>{e.preventDefault();await runButton(e.submitter,async()=>{
      const file=$('referenceFile').files[0];if(file.size>10e6)throw Error('기준 CSV는 10MB 이하로 준비하세요.');
      const reference={source:$('referenceSource').value.trim(),verified:$('refVerified').checked,sync:{offsetMs:Number($('offset').value),driftPpm:Number($('drift').value),uncertaintyMs:$('syncError').value===''?null:Number($('syncError').value),method:$('syncNote').value.trim()},samples:D.parseCSV(await file.text())};
      const p=await payload(row);if(!p.pulseEvidence?.windows)throw Error('이 기록에는 저장된 맥파 후보가 없습니다. 현재 엔진 재분석을 먼저 실행하세요.');
      const comparison=D.compare(p.pulseEvidence.windows,reference,{start:p.frames.t[0],end:p.frames.t.at(-1)});row.reference=reference;
      await annotate(row,'reference',{source:reference.source,note:'기준 심박 동시 구간 비교',reference,comparison,ruleVersion:D.VERSION});
    });};
    $('replay').onclick=e=>runButton(e.currentTarget,()=>replay(row));
  }
  const exportRow=r=>({id:r.id,code:r.code,created_at:r.created_at,meta:r.meta,audit:r.audit,reference_review:r.reference_review,annotations:r.annotations||[]});
  async function annotate(row,kind,body,silent=false){
    if(new TextEncoder().encode(JSON.stringify(body)).length>500000)throw Error('검토 기록이 너무 큽니다. 기준 CSV를 해당 검사 시간으로 줄여 주세요.');
    const id=row.local?crypto.randomUUID():await rpc('dataset_annotate',{p_session:row.id,p_kind:kind,p_body:body});
    const annotation={id,kind,body,created_at:new Date().toISOString()};
    row.annotations=row.annotations||[];row.annotations.push(annotation);
    if(!silent){render();if(selected===row)renderDetail();tell(row.local?'로컬 검토 이력을 추가했습니다. 내보내기로 저장하세요.':'서버에 검토 이력을 추가했습니다. 원본 결과는 유지됩니다.');}
    return annotation;
  }
  async function runButton(button,work){button.disabled=true;try{await work();}catch(e){tell(e.message,true);}finally{button.disabled=false;}}
  async function replay(row){
    const p=await payload(row);tell('숫자 원자료를 현재 엔진으로 재분석하고 있습니다…');
    const result=await new Promise((resolve,reject)=>{const w=new Worker('dataset-replay-worker.js'),timer=setTimeout(()=>{w.terminate();reject(Error('재분석 제한 시간을 초과했습니다.'));},180000);const done=()=>{clearTimeout(timer);w.terminate();};w.onerror=e=>{done();reject(Error(e.message));};w.onmessage=({data:m})=>{done();m.error?reject(Error(m.error)):resolve(m);};w.postMessage({frames:p.frames,hidden:p.hidden});});
    const ref=row.reference||[...(row.annotations||[])].reverse().find(n=>n.kind==='reference')?.body.reference||p.reference;
    const bounds={start:p.frames.t[0],end:p.frames.t.at(-1)},before=ref&&p.pulseEvidence?D.compare(p.pulseEvidence.windows,ref,bounds):null,after=ref?D.compare(result.windows,ref,bounds):null;
    const support=ws=>{const spans=ws.filter(w=>w.usable&&Number.isFinite(w.start)&&Number.isFinite(w.end)).sort((a,b)=>a.start-b.start);let end=-Infinity,ms=0;for(const w of spans){ms+=Math.max(0,w.end-Math.max(end,w.start));end=Math.max(end,w.end);}return ms/1000;};
    await annotate(row,'replay',{note:'동일 원자료 엔진 비교 · 기준 신호 없는 결과는 정확도 미검증',from:row.meta.versions,to:{core:result.version,fusion:result.fusion},before:before&&{...before,pairs:undefined},after:after&&{...after,pairs:undefined},beforeSeconds:p.pulseEvidence?support(p.pulseEvidence.windows):null,afterSeconds:support(result.windows),ruleVersion:D.VERSION});
    if(!p.pulseEvidence)row.payload={...p,pulseEvidence:{version:result.fusion,windows:result.windows}};
  }
  async function local(){
    try{const pending=await NLResearchStore.all();let old=[];try{old=JSON.parse(localStorage.getItem('nlNewbiz:research')||'[]');}catch(_){}
      $('localRows').innerHTML=pending.map(r=>`<div><span>${esc(r.code||r.id)}<small class="muted"> · ${esc(r.status)}${r.error?' · '+esc(r.error):''}</small></span><span>${r.pk?`<button data-download="${esc(r.id)}">내 기록 다운로드</button> `:''}<button data-remove="${esc(r.id)}">${r.serverId?'제출 철회':'대기 기록 삭제'}</button></span></div>`).join('')+old.filter(r=>!pending.some(p=>p.serverId===r.id)).map((r,i)=>`<div><span>${esc(r.code)} · 제출됨</span><button data-old="${i}">제출 철회</button></div>`).join('');
      if(!$('localRows').innerHTML)$('localRows').innerHTML='<p class="muted">이 기기에 전송 대기·철회 기록이 없습니다.</p>';
      $('localRows').querySelectorAll('[data-download]').forEach(b=>b.onclick=()=>{const r=pending.find(x=>x.id===b.dataset.download);download(r.pk,'research-'+r.id+'.json');});
      $('localRows').querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{if(confirm('이 기록을 삭제/철회할까요? 서버에 제출된 원자료와 연결된 조치 이력도 삭제됩니다.'))runButton(b,async()=>{await NLResearchStore.withdraw(b.dataset.remove);await local();});});
      const oldVisible=old.filter(r=>!pending.some(p=>p.serverId===r.id));
      $('localRows').querySelectorAll('[data-old]').forEach(b=>b.onclick=()=>{if(!confirm('제출한 연구 데이터를 철회할까요?'))return;runButton(b,async()=>{const r=oldVisible[Number(b.dataset.old)],cfg=NL_SUPABASE;const response=await fetch(cfg.url+'/rest/v1/rpc/newbiz_research_withdraw',{method:'POST',headers:{apikey:cfg.anonKey,Authorization:'Bearer '+cfg.anonKey,'Content-Type':'application/json'},body:JSON.stringify({p_session:r.id,p_token:r.token})});if(!response.ok)throw Error('철회 요청 실패');await response.json();localStorage.setItem('nlNewbiz:research',JSON.stringify(old.filter(x=>x.id!==r.id)));await local();});});
    }catch(e){$('localRows').textContent='이 브라우저의 연구 저장소에 접근하지 못했습니다: '+e.message;}
  }
  $('testFilter').insertAdjacentHTML('beforeend',Object.entries(D.LABELS).map(([k,v])=>`<option value="${k}">${v}</option>`).join(''));
  ['testFilter','outcomeFilter','versionFilter','search'].forEach(id=>$(id).oninput=render);
  $('refresh').onclick=e=>runButton(e.currentTarget,()=>load());$('more').onclick=e=>runButton(e.currentTarget,()=>load(true));
  async function loadLedger(){const snapshot=rows;for(let i=0;i<snapshot.length;i+=4){await Promise.all(snapshot.slice(i,i+4).map(async row=>{if(!row.local){const detail=await rpc('dataset_detail',{p_session:row.id});row.annotations=detail.annotations||[];}}));}if(rows===snapshot){ledgerLoaded=true;render();}}
  $('loadWorkflowLedger').onclick=e=>runButton(e.currentTarget,async()=>{await loadLedger();tell('불러온 검사 범위의 개선 이력을 집계했습니다.');});
  $('export').onclick=e=>runButton(e.currentTarget,async()=>{const current=filtered();for(const row of current)if(!row.local){const detail=await rpc('dataset_detail',{p_session:row.id});row.annotations=detail.annotations||[];}download({schema:D.VERSION,exportedAt:new Date().toISOString(),scope:'loaded-records',records:current.map(exportRow)},'condition-dataset.json');});
  $('import').onchange=async e=>{try{const files=Array.from(e.target.files);if(files.reduce((s,f)=>s+f.size,0)>100e6)throw Error('가져올 파일의 합계는 100MB 이하로 준비하세요.');const loaded=[];for(const file of files){const v=JSON.parse(await file.text());for(const r of v.records||[v])loaded.push(normalize(r,loaded.length));}rows=loaded;source='local';selected=null;$('detail').hidden=true;$('more').hidden=true;versions();render();tell('로컬 연구 기록을 불러왔습니다. 저장할 검토 이력은 내보내기를 사용하세요.');}catch(err){tell(err.message,true);}finally{e.target.value='';}};
  $('loginForm').onsubmit=e=>{e.preventDefault();runButton(e.submitter,async()=>{await NLAuth.signIn($('email').value,$('password').value);$('password').value='';await access();});};
  $('logout').onclick=async()=>{await NLAuth.signOut();rows=[];selected=null;source='none';ledgerLoaded=false;NLDatasetWorkflow.clearDrafts();$('detail').hidden=true;render();await access();};
  $('retryLocal').onclick=e=>runButton(e.currentTarget,async()=>{await NLResearchStore.flush();await local();tell('전송을 재시도했습니다. 각 기록의 상태를 확인하세요.');});
  window.addEventListener('nl-research-change',local);window.addEventListener('online',()=>NLResearchStore.flush().then(local).catch(e=>tell(e.message,true)));
  fetch('dataset-engine-log.json').then(r=>{if(!r.ok)throw Error('log unavailable');return r.json();}).then(log=>{$('engineLog').innerHTML=log.entries.map(e=>`<h3>${esc(e.date)} · ${esc(e.version)}</h3><p><b>${esc(e.status)}</b> · ${esc(e.change)}</p><p class="muted">${esc(e.evidence)}</p><p>후속: ${esc(e.next)}</p>`).join('');}).catch(()=>{$('engineLog').textContent='개발 이력을 불러오지 못했습니다.';});
  NLDatasetWorkspace.init({tell,select:r=>select(r).catch(e=>tell(e.message,true)),promote:async(row,task)=>{
    const existing=(row.annotations||[]).find(n=>n.body?.workflow===NLDatasetWorkflow.VERSION&&n.body.event==='memo'&&(task.type==='code'?n.body.releaseTaskId===task.id:n.body.sourceActionKey===task.action?.key));
    const target={pulse:'baseline',gaze:'pursuit',measurement:'session',research:'research'}[task.domain]||'session';
    const memo=existing||await annotate(row,'action',{workflow:NLDatasetWorkflow.VERSION,event:'memo',title:task.title,target,note:task.rationale,metrics:task.metrics||task.validationPlan,validationPlan:task.validationPlan,
      sourceActionKey:task.action?.key,releaseTaskId:task.type==='code'?task.id:null,releaseSha:task.entry?.sha||null,codePrompt:task.type==='code'?task.prompt:null,
      engineVersion:row.audit?.versions||row.meta?.versions,status:'reviewing'},true);
    await select(row);tell('실측 개선 메모에 연결했습니다. Gemini 프롬프트를 작성합니다…');
    try{await NLDatasetWorkflow.generatePrompt(row,memo.id);tell('실측 근거와 개발 과제를 연결한 프롬프트를 저장했습니다.');}finally{render();if(selected===row)renderDetail();}
  }});
  render();local();access();
})();
