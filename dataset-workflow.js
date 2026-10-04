(function(root){
  'use strict';
  const VERSION='dataset-improvement-1',esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const is=(n,event)=>n.body?.workflow===VERSION&&(!event||n.body.event===event);
  const statuses={reviewing:'후속 검증 대기',implemented:'조치 적용 · 정확도 미검증',validated:'연구자 검증 기록',dismissed:'보류'};
  const drafts=new Map(),messages=new Map(),busy=new Set();
  function cases(row){
    const notes=row.annotations||[];
    return notes.filter(n=>is(n,'memo')).map(memo=>{
      const linked=notes.filter(n=>is(n)&&n.body.memoId===memo.id);
      const prompts=linked.filter(n=>is(n,'prompt')),results=linked.filter(n=>is(n,'result')),summaries=linked.filter(n=>is(n,'summary'));
      const latestResult=results.at(-1),review=linked.filter(n=>is(n,'review')&&n.body.resultId===latestResult?.id).at(-1);
      return {memo,linked,prompts,results,summaries,latestResult,review,status:review?.body.status||'reviewing'};
    });
  }
  function textDownload(text,name){const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function ai(row,operation,sourceId){
    if(row.local)throw Error('AI 작업은 서버에 저장된 검사에서 사용할 수 있습니다.');
    const {data,error}=await NLAuth.client.auth.getSession();
    if(error||!data.session?.access_token)throw Error('연구 관리자 계정으로 다시 로그인하세요.');
    const response=await fetch('/api/neurolens_dataset',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+data.session.access_token},body:JSON.stringify({operation,sessionId:row.id,sourceId})});
    let value;try{value=await response.json();}catch(_){throw Error('AI 서버 응답을 확인하지 못했습니다. 배포 상태를 확인하세요.');}
    if(!response.ok)throw Error(value.error||'AI 요청 실패');
    if(!value.annotation?.id||!is(value.annotation,operation))throw Error('AI 기록 응답 형식이 올바르지 않습니다.');
    row.annotations=row.annotations||[];
    if(!row.annotations.some(n=>n.id===value.annotation.id))row.annotations.push(value.annotation);
    return value;
  }
  function mount(host,row,hooks){
    const current=cases(row),draft=drafts.get(row.id)||{};
    const tell=hooks.tell;
    hooks={...hooks,tell:(message,error=false)=>{messages.set(row.id,{message,error});tell(message,error);const status=host.querySelector('[data-workflow-status]');if(status){status.textContent=message;status.classList.toggle('error',error);}}};
    const testOptions='<option value="session">검사 전체</option>'+Object.entries(NLDataset.LABELS).map(([k,v])=>`<option value="${k}">${esc(v)}</option>`).join('');
    host.innerHTML=`<div class="workflow-head"><p class="eyebrow">MEMO → PROMPT → ACTION → VALIDATION</p><h3>내 메모와 알고리즘 개선</h3><p>측정 결과에 관찰한 문제와 보정 지표를 연결하세요. 프롬프트를 개발 AI에 전달하고, 작업 결과를 돌아와 붙여넣으면 해당 메모의 조치란에 요약이 쌓입니다.</p><p class="muted">AI 버튼을 누르면 해당 검사의 수치 요약·메모·관련 개발 기록을 Google Gemini에 전송합니다. 영상·원시 프레임·계정 정보는 보내지 않습니다. 메모에 개인정보나 비밀 키를 넣지 마세요.</p></div>
      <p class="notice workflow-status ${messages.get(row.id)?.error?'error':''}" data-workflow-status role="status" aria-live="polite">${esc(messages.get(row.id)?.message||'메모를 저장한 뒤 AI 개선 프롬프트를 만들 수 있습니다.')}</p>
      <form class="stack subpanel" id="memoForm"><div class="grid"><label>메모 제목<input id="memoTitle" maxlength="160" required placeholder="예: 안경 착용 시 시선 튐"></label><label>대상 검사<select id="memoTarget">${testOptions}</select></label></div><label>관찰한 상황과 개선 요청<textarea id="memoText" maxlength="6000" required placeholder="조명, 안경·모자 착용, 움직임, 실제 경험과 결과의 차이, 개선할 사항"></textarea></label><label>보정할 지표와 기대 결과<textarea id="memoMetrics" maxlength="2000" required placeholder="예: 시선 흔들림·유효 표본 비율. 부분 가림에서 사용 가능한 구간을 더 유지하고 싶음."></textarea></label><label>재검증 방법·관련 검사 코드<input id="memoValidation" maxlength="2000" placeholder="예: 같은 기기에서 안경 착용 전후 비교, 기준 장비 동시 측정"></label><button class="primary">메모 저장</button><p class="muted">${row.local?'로컬 메모는 내보내기로 보관하세요. AI 생성은 서버 검사에서 사용할 수 있습니다.':'메모와 조치는 추가 이력으로 저장됩니다.'}</p></form>
      <div class="workflow-cases">${current.map(c=>caseHTML(c,row.local)).join('')||'<p class="muted">저장한 메모가 여기에 표시됩니다.</p>'}</div>`;
    const by=id=>host.querySelector('#'+id),fields=()=>host.querySelectorAll('input[id],textarea[id],select[id]');
    fields().forEach(el=>{if(Object.hasOwn(draft,el.id))el.value=draft[el.id];});
    function remember(){const values={};fields().forEach(el=>values[el.id]=el.value);drafts.set(row.id,values);}
    host.oninput=remember;host.onchange=remember;
    function clear(ids){const values=drafts.get(row.id)||{};ids.forEach(id=>delete values[id]);drafts.set(row.id,values);}
    async function work(task){
      if(busy.has(row.id))return;remember();busy.add(row.id);host.querySelectorAll('button').forEach(b=>b.disabled=true);
      try{await task();}catch(e){hooks.tell(e.message,true);}finally{busy.delete(row.id);hooks.changed(row);}
    }
    by('memoForm').onsubmit=e=>{e.preventDefault();const body={workflow:VERSION,event:'memo',title:by('memoTitle').value.trim(),target:by('memoTarget').value,note:by('memoText').value.trim(),metrics:by('memoMetrics').value.trim(),validationPlan:by('memoValidation').value.trim(),engineVersion:row.audit?.versions||row.meta?.versions,status:'reviewing'};
      if(!body.title||!body.note||!body.metrics)return hooks.tell('제목·관찰 내용·보정 지표를 입력하세요.',true);
      work(async()=>{await hooks.save(row,'action',body);clear(['memoTitle','memoTarget','memoText','memoMetrics','memoValidation']);hooks.tell('메모를 저장했습니다. AI 개선 프롬프트를 만들 수 있습니다.');});};
    host.querySelectorAll('[data-prompt]').forEach(button=>button.onclick=()=>work(async()=>{hooks.tell('Gemini가 측정 근거와 메모로 개선 프롬프트를 작성하고 있습니다…');await ai(row,'prompt',button.dataset.prompt);hooks.tell('개선 프롬프트를 저장했습니다. 복사해서 개발 AI에 전달하세요.');}));
    host.querySelectorAll('[data-copy]').forEach(button=>button.onclick=async()=>{const note=row.annotations.find(n=>n.id===button.dataset.copy);try{await navigator.clipboard.writeText(note.body.text);hooks.tell('개선 프롬프트를 복사했습니다.');}catch(_){textDownload(note.body.text,'neurolens-improvement-prompt.txt');hooks.tell('클립보드 대신 프롬프트 파일을 다운로드했습니다.');}});
    host.querySelectorAll('[data-prompt-download]').forEach(button=>button.onclick=()=>{const note=row.annotations.find(n=>n.id===button.dataset.promptDownload);textDownload(note.body.text,'neurolens-improvement-prompt.txt');});
    host.querySelectorAll('[data-result-form]').forEach(form=>form.onsubmit=e=>{
      e.preventDefault();const memoId=form.dataset.resultForm,read=key=>form.querySelector('[name="'+key+'"]').value.trim();
      const body={workflow:VERSION,event:'result',memoId,promptId:read('promptId'),note:read('report'),evidence:read('evidence'),fromVersion:read('fromVersion'),toVersion:read('toVersion'),observedMetrics:read('observedMetrics'),followup:read('followup'),status:'reviewing',reportedBy:'researcher'};
      if(!body.note)return hooks.tell('개발 AI의 작업 결과 원문을 입력하세요.',true);
      work(async()=>{const result=await hooks.save(row,'action',body);clear(Array.from(form.querySelectorAll('[id]'),el=>el.id));hooks.tell('개발 결과 원문을 저장했습니다. Gemini 조치 요약을 작성하고 있습니다…');await ai(row,'summary',result.id);hooks.tell('해당 메모의 조치란에 요약을 저장했습니다. 후속 검증을 기록하세요.');});
    });
    host.querySelectorAll('[data-summary]').forEach(button=>button.onclick=()=>work(async()=>{hooks.tell('저장된 개발 결과를 요약하고 있습니다…');await ai(row,'summary',button.dataset.summary);hooks.tell('조치 요약을 저장했습니다.');}));
    host.querySelectorAll('[data-review-form]').forEach(form=>form.onsubmit=e=>{
      e.preventDefault();const read=k=>form.querySelector('[name="'+k+'"]').value.trim(),body={workflow:VERSION,event:'review',memoId:form.dataset.reviewForm,resultId:read('resultId'),status:read('status'),note:read('review'),evidence:read('evidence'),followup:read('followup'),humanVerified:read('status')==='validated'};
      if(!body.note||(['implemented','validated'].includes(body.status)&&!body.evidence))return hooks.tell('검토 내용과 적용·검증 근거를 입력하세요.',true);
      work(async()=>{await hooks.save(row,'action',body);clear(Array.from(form.querySelectorAll('[id]'),el=>el.id));hooks.tell('연구자 검토와 후속 과제를 이력에 추가했습니다.');});
    });
    if(busy.has(row.id))host.querySelectorAll('button').forEach(b=>b.disabled=true);
  }
  function caseHTML(c,local){
    const m=c.memo,id=m.id,prompt=c.prompts.at(-1),result=c.latestResult,summary=c.summaries.filter(n=>n.body.resultId===result?.id).at(-1);
    const prefix='wf-'+id+'-',disabled=local?'disabled':'';
    return `<article class="improvement-case"><div class="toolbar"><h3>${esc(m.body.title)}</h3><span class="pill">${esc(statuses[c.status])}</span></div><p class="muted">${esc(NLDataset.LABELS[m.body.target]||'검사 전체')} · ${esc(m.created_at)} · 메모 ${esc(id)}</p><p class="memo-content">${esc(m.body.note)}</p><p><b>보정 지표·기대 결과</b><br>${esc(m.body.metrics)}</p><p><b>검증 계획</b><br>${esc(m.body.validationPlan||'미기록')}</p>
      <div class="tools"><button data-prompt="${esc(id)}" ${disabled}>${prompt?'최신 측정 근거로 프롬프트 확인·생성':'AI 개선 프롬프트 만들기'}</button>${prompt?`<button data-copy="${esc(prompt.id)}">프롬프트 복사</button><button data-prompt-download="${esc(prompt.id)}">프롬프트 파일</button>`:''}</div>
      ${prompt?`<details><summary>개선 프롬프트 · ${esc(prompt.body.provenance?.model||'모델 미기록')}</summary><pre>${esc(prompt.body.text)}</pre><small>입력 SHA-256: ${esc(prompt.body.inputHash)}</small></details>`:''}
      <div class="action-summary"><h4>이 메모의 조치란</h4>${summary?`<p class="memo-content">${esc(summary.body.text)}</p><p class="muted">AI 요약 · ${esc(summary.created_at)} · 원문 결과 ${esc(result.id)} · 연구자 검토와 별도</p>`:result?'<p>개발 결과 원문은 저장되어 있습니다. 조치 요약을 생성하거나 다시 시도하세요.</p>':'<p class="muted">개발 AI의 작업 결과를 등록하면 여기에 조치 요약이 남습니다.</p>'}${result?`<button data-summary="${esc(result.id)}" ${disabled}>조치 요약 ${summary?'다시 확인':'생성·재시도'}</button>`:''}${c.review?`<p><b>${esc(statuses[c.status])}</b> · ${esc(c.review.body.note)}</p><p>근거: ${esc(c.review.body.evidence||'미기록')}</p><p>후속: ${esc(c.review.body.followup||'미기록')}</p>`:''}</div>
      ${prompt&&!local?`<details ${result?'':'open'}><summary>개발 결과 등록 · AI 요약</summary><form class="stack" data-result-form="${esc(id)}"><label>사용한 프롬프트<select name="promptId" id="${prefix}prompt">${[...c.prompts].reverse().map(p=>`<option value="${esc(p.id)}">${esc(p.created_at)} · ${esc(p.id)}</option>`).join('')}</select></label><label>개발 AI의 작업 결과 원문<textarea name="report" id="${prefix}report" maxlength="24000" required placeholder="변경 내용, 수정 파일, 수행한 검증과 결과, 남은 한계를 붙여넣으세요."></textarea></label><label>커밋·PR·실험·검증 근거<input name="evidence" id="${prefix}evidence" maxlength="2000"></label><div class="grid"><label>변경 전 엔진 버전<input name="fromVersion" id="${prefix}from" maxlength="160"></label><label>변경 후 엔진 버전<input name="toVersion" id="${prefix}to" maxlength="160"></label></div><label>실제로 확인한 전후 지표<textarea name="observedMetrics" id="${prefix}metrics" maxlength="4000" placeholder="표본 수·조건·단위·기준 장비 여부 포함. 없으면 미측정으로 기록"></textarea></label><label>후속 과제·재검사 코드<textarea name="followup" id="${prefix}followup" maxlength="2000"></textarea></label><button class="primary">원문 저장 후 AI 조치 요약</button></form></details>`:''}
      ${result?`<details><summary>후속 검증·진행 상태 기록</summary><form class="stack" data-review-form="${esc(id)}"><label>검토할 개발 결과<select name="resultId" id="${prefix}reviewResult">${[...c.results].reverse().map(r=>`<option value="${esc(r.id)}">${esc(r.created_at)} · ${esc(r.body.toVersion||'버전 미기록')}</option>`).join('')}</select></label><label>상태<select name="status" id="${prefix}status">${Object.entries(statuses).map(([k,v])=>`<option value="${k}">${esc(v)}</option>`).join('')}</select></label><label>검토 내용<textarea name="review" id="${prefix}review" maxlength="4000" required></textarea></label><label>근거·검증 범위<input name="evidence" id="${prefix}reviewEvidence" maxlength="2000" placeholder="적용·검증 상태에는 필수. 실측/합성 여부, 조건, 표본 수, 실험 ID"></label><label>다음 조치·추적 검사 코드<input name="followup" id="${prefix}reviewFollowup" maxlength="2000"></label><button>검토 이력 추가</button></form></details>`:''}
      <details><summary>이 메모의 전체 이력 ${c.linked.length}건</summary>${c.linked.map(n=>`<div class="history-event"><b>${esc(({prompt:'개선 프롬프트',result:'개발 결과 원문',summary:'AI 조치 요약',review:'연구자 검토'})[n.body.event]||n.body.event)}</b> · ${esc(n.created_at)}<pre>${esc(n.body.text||n.body.note)}</pre><details><summary>연결·버전·근거</summary><pre>${esc(JSON.stringify(n.body,null,2))}</pre></details></div>`).join('')}</details></article>`;
  }
  function ledger(host,rows,onSelect){
    const all=rows.flatMap(row=>cases(row).map(c=>({...c,row}))),results=all.filter(c=>c.latestResult),verified=all.filter(c=>c.status==='validated');
    host.innerHTML=`<p class="muted">불러온 검사 ${rows.length}건의 이력 · 검증은 연구자 기록 상태이며 임상 정확도 인증이 아닙니다.</p><div class="workflow-counts"><span>개선 메모 <b>${all.length}</b></span><span>프롬프트 연결 <b>${all.filter(c=>c.prompts.length).length}</b></span><span>개발 결과 연결 <b>${results.length}</b></span><span>전후 지표 기록 <b>${results.filter(c=>c.latestResult.body.observedMetrics).length}</b></span><span>연구자 검증 기록 <b>${verified.length}</b></span></div><div class="table-wrap"><table><thead><tr><th>검사·메모</th><th>보정 지표</th><th>엔진 변경</th><th>진행·후속 과제</th></tr></thead><tbody>${all.map(c=>`<tr><td><button data-ledger-session="${esc(c.row.id)}">${esc(c.row.code)}</button><br>${esc(c.memo.body.title)}</td><td>${esc(c.memo.body.metrics)}</td><td>${esc(c.latestResult?.body.fromVersion||'미기록')} → ${esc(c.latestResult?.body.toVersion||'미기록')}<small>${esc(c.latestResult?.body.evidence||'근거 미기록')}</small></td><td>${esc(statuses[c.status])}<small>${esc(c.review?.body.followup||c.latestResult?.body.followup||c.memo.body.validationPlan)}</small></td></tr>`).join('')||'<tr><td colspan="4">저장된 개선 메모가 없습니다.</td></tr>'}</tbody></table></div><p class="muted">이 지표는 재현 가능한 연구 근거의 축적 정도를 보여줍니다. 메모 수나 AI 요약 수를 정확도 향상 또는 특허성으로 해석하지 않습니다.</p>`;
    host.querySelectorAll('[data-ledger-session]').forEach(b=>b.onclick=()=>onSelect(rows.find(r=>r.id===b.dataset.ledgerSession)));
  }
  root.NLDatasetWorkflow={VERSION,mount,ledger,cases,clearDrafts:()=>{drafts.clear();messages.clear();}};
})(typeof globalThis!=='undefined'?globalThis:this);
