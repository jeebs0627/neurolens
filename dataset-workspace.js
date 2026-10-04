(function(root){
  'use strict';
  const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels={pulse:'맥파·융합',gaze:'시선·획득',measurement:'검사·해석',research:'데이터·연구'};
  const safeURL=url=>{try{const u=new URL(url);return u.protocol==='https:'&&['github.com','vercel.com','neurolens-xi.vercel.app'].includes(u.hostname)?u.href:null;}catch(_){return null;}};
  let ledger={entries:[]},state={rows:[],allowed:false},hooks={},taskLimit=12,releaseLimit=15,loading=false;
  const date=v=>v?new Date(v).toLocaleString('ko-KR'):'미기록';
  function activate(view){
    if(!['work','measurements','releases','validation'].includes(view))view='work';
    document.querySelectorAll('.workspace-pane').forEach(p=>p.hidden=p.id!=='pane-'+view);
    document.querySelectorAll('[data-view]').forEach(b=>{if(b.dataset.view===view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  }
  function domain(target){return ['pulse','baseline','recovery'].includes(target)?'pulse':['gaze','capture','calibration','pursuit','saccade'].includes(target)?'gaze':target==='research'?'research':'measurement';}
  function privateCases(){return state.rows.flatMap(row=>NLDatasetWorkflow.cases(row).map(c=>({...c,row})));}
  function tasks(){
    const cases=privateCases(),out=cases.map(c=>({id:'memo-'+c.memo.id,type:'memo',domain:domain(c.memo.body.target),title:c.memo.body.title,
      rationale:c.memo.body.note,validationPlan:c.memo.body.validationPlan,metrics:c.memo.body.metrics,prompt:c.prompts.at(-1)?.body.text||'',
      generator:c.prompts.length?'gemini':'pending',row:c.row,memo:c.memo,review:c.review,
      status:({reviewing:'개발·검증 대기',implemented:'조치 적용 · 검증 대기',validated:'연구자 검증 기록',dismissed:'보류'})[c.status]}));
    for(const row of state.rows)for(const action of row.audit?.actions||[]){
      if(cases.some(c=>c.row.id===row.id&&c.memo.body.sourceActionKey===action.key))continue;
      const title=action.next,prompt=`NeuroLens 실측 후속 검토\n검사 코드: ${row.code}\n대상: ${action.test}\n관측 근거: ${JSON.stringify(action.evidence)}\n요청: ${title}\n현재 엔진 ${JSON.stringify(row.audit.versions)}의 관련 코드를 확인하라. 유효 신호 활용량과 오차를 함께 평가하고 없는 정답이나 정상값을 만들지 말라. 관련 검사·메모와 변경 커밋·전후 지표를 dataset에 기록하라.`;
      out.push({id:'observation-'+row.id+'-'+action.key,type:'observation',domain:domain(action.test),title,rationale:JSON.stringify(action.evidence),validationPlan:title,prompt,generator:'rule',row,action,status:'실측 자동 검토 후보'});
    }
    const linked=new Set(ledger.entries.flatMap(e=>e.linkedTaskIds||[]));
    for(const entry of ledger.entries)for(const task of entry.tasks||[]){
      const related=cases.filter(c=>c.memo.body.releaseTaskId===task.id);
      out.push({...task,type:'code',entry,related,status:linked.has(task.id)?'후속 코드 연결 · 실측 검증 필요':related.length?'실측 메모 연결됨':'후속 검토 후보'});
    }
    return out;
  }
  function render(){
    const all=tasks(),cases=privateCases(),ai=ledger.entries.filter(e=>e.analysisState==='generated'),pending=ledger.entries.filter(e=>e.domains?.length&&e.analysisState!=='generated');
    $('evolutionStats').innerHTML=[['실측 개선 메모',cases.length,'불러온 검사 범위'],['코드 변경 기록',ledger.entries.length,'GitHub SHA 기준'],['Gemini 분석 완료',ai.length,`분석 대기·재시도 ${pending.length}건`],['연구자 검증 기록',cases.filter(c=>c.status==='validated').length,'검증 범위는 근거에서 확인']].map(([a,b,c])=>`<div class="metric"><small>${a}</small><strong>${b}</strong><small>${c}</small></div>`).join('');
    const source=$('taskSource').value,scope=$('taskDomain').value,query=$('taskSearch').value.toLowerCase().trim();
    const visible=all.filter(t=>(!source||t.type===source)&&(!scope||t.domain===scope)&&(!query||[t.title,t.rationale,t.metrics,t.id,t.entry?.sha].join(' ').toLowerCase().includes(query)));
    $('boardSummary').textContent=`현재 조건 ${visible.length}개 과제 · 실측 후보는 관측 근거이며 자동 확정 진단이 아닙니다.`;
    $('workBoard').innerHTML=visible.slice(0,taskLimit).map(taskCard).join('')||'<p class="empty">표시할 과제가 없습니다. 연구자 로그인 후 실측 기록을 불러오거나 GitHub 기록을 확인하세요.</p>';
    $('moreTasks').hidden=visible.length<=taskLimit;
    $('workBoard').querySelectorAll('[data-open-session]').forEach(b=>b.onclick=()=>hooks.select(state.rows.find(r=>r.id===b.dataset.openSession)));
    $('workBoard').querySelectorAll('[data-copy-task]').forEach(b=>b.onclick=async()=>{const t=all.find(t=>t.id===b.dataset.copyTask);try{await navigator.clipboard.writeText(t.prompt);hooks.tell('개발 프롬프트를 복사했습니다.');}catch(_){download(t.prompt,t.id+'.txt');hooks.tell('프롬프트 파일을 다운로드했습니다.');}});
    $('workBoard').querySelectorAll('[data-promote]').forEach(b=>b.onclick=async()=>{const task=all.find(t=>t.id===b.dataset.promote),card=b.closest('.task-card'),id=card.querySelector('[data-link-session]')?.value,row=task.row||state.rows.find(r=>r.id===id);if(!row)return hooks.tell('연결할 실측 검사를 선택하세요.',true);b.disabled=true;try{await hooks.promote(row,task);}catch(e){hooks.tell(e.message,true);}finally{b.disabled=false;}});
    releases(cases);metrics(cases);
  }
  function taskCard(t){
    const source={memo:'내 개선 메모',observation:'실측 자동 후보',code:'코드 변경 후속'}[t.type];
    const sessions=state.rows.filter(r=>!r.local);
    return `<article class="task-card"><div class="task-tags"><span>${esc(source)}</span><span>${esc(labels[t.domain]||t.domain)}</span></div><h3>${esc(t.title)}</h3><p class="task-rationale">${esc(t.rationale)}</p><p class="muted">${esc(t.status)}${t.entry?' · '+esc(t.entry.sha.slice(0,8)):''}${t.row?' · '+esc(t.row.code):''}</p><details><summary>검증 계획·개발 프롬프트</summary><p>${esc(t.validationPlan||t.metrics||'미기록')}</p><p class="muted">${t.generator==='gemini'?'Gemini 작성 · 검토 필요':t.generator==='rule'?'규칙 기반 기본 프롬프트 · Gemini 보완 대기':'Gemini 프롬프트 생성 대기'}</p><pre>${esc(t.prompt||'해당 검사 메모에서 AI 개선 프롬프트를 생성하세요.')}</pre></details><div class="tools">${t.prompt?`<button data-copy-task="${esc(t.id)}">프롬프트 복사</button>`:''}${t.row?`<button data-open-session="${esc(t.row.id)}">실측·메모 열기</button>`:''}</div>
      ${t.type==='observation'?`<button data-promote="${esc(t.id)}" ${!state.allowed||t.row.local?'disabled':''}>개선 메모 등록·AI 프롬프트</button>`:''}
      ${t.type==='code'?`<div class="task-link"><label>검증에 사용할 실측<select data-link-session aria-label="연결할 실측 검사"><option value="">검사 선택</option>${sessions.map(r=>`<option value="${esc(r.id)}">${esc(r.code)}</option>`).join('')}</select></label><button data-promote="${esc(t.id)}" ${!state.allowed?'disabled':''}>실측에 연결·AI 프롬프트</button></div><p class="muted">연결된 개선 메모 ${t.related.length}건 · 개인 데이터는 공개 저장소에 전송하지 않습니다.</p>`:''}</article>`;
  }
  function eventLabel(e){
    const states={success:'성공',failure:'실패',error:'오류',pending:'대기',queued:'대기',in_progress:'진행 중',inactive:'비활성'};
    return (e.type==='deployment'?`${e.production?'운영 배포':'배포'} · ${e.environment||'환경 미기록'}`:`${e.context||'GitHub'} 체크`)+': '+(states[e.state]||e.state);
  }
  function releases(cases){
    $('releaseScope').textContent=`${ledger.entries.length}개 코드 커밋 · 갱신 ${date(ledger.updatedAt)} · 배포 상태는 최신 12개 커밋과 수신한 배포 이벤트에서 수집`;
    $('releaseTimeline').innerHTML=ledger.entries.slice(0,releaseLimit).map(entry=>{
      const explicit=cases.filter(c=>c.memo.body.releaseSha===entry.sha||[...(c.row.annotations||[])].some(n=>n.body?.memoId===c.memo.id&&new RegExp('\\b'+entry.sha.slice(0,7)+'[a-f0-9]{0,33}\\b').test(n.body?.evidence||'')));
      const events=entry.deploymentEvents||[],latest=events.at(-1),url=safeURL(entry.url);
      return `<article class="release-entry"><div class="release-marker"></div><div class="toolbar"><h3>${url?`<a href="${esc(url)}" target="_blank" rel="noopener">${esc(entry.sha.slice(0,8))}</a>`:esc(entry.sha.slice(0,8))} · ${esc(entry.subject)}</h3><small>${esc(date(entry.committedAt))}</small></div><p>${esc(entry.analysis?.summary||'변경 파일을 수집했습니다. 영향과 정확도 개선 여부는 아직 검증하지 않았습니다.')}</p><div class="task-tags">${(entry.domains||[]).map(d=>`<span>${esc(labels[d])}</span>`).join('')}<span>${esc(latest?eventLabel(latest):'배포 상태 미확인')}</span><span>${entry.analysisState==='generated'?'Gemini 분석 완료':entry.analysisState==='not-applicable'?'일반 코드 변경':'AI 분석 대기·재시도'}</span></div><p class="muted">후속 과제 ${entry.tasks?.length||0}개 · 연결 실측 메모 ${explicit.length}건${entry.linkedTaskIds?.length?' · 후속 코드 표식 '+esc(entry.linkedTaskIds.join(', ')):''}</p><details><summary>변경 파일·배포 증거·분석 출처</summary><ul>${entry.files.map(f=>`<li>${esc(f.path)} <small>+${f.additions??'—'} / −${f.deletions??'—'}</small></li>`).join('')}</ul><p class="muted">${entry.patchTruncated?'diff 발췌에 생략이 있습니다.':''} ${entry.filesTruncated?'변경 파일 목록에 생략이 있습니다.':''}</p>${events.map(e=>`<p>${esc(eventLabel(e))} · ${esc(date(e.at))}${safeURL(e.url)?` · <a href="${esc(safeURL(e.url))}" target="_blank" rel="noopener">원문</a>`:''}</p>`).join('')||'<p>배포 이벤트 미확인</p>'}<pre>${esc(JSON.stringify({analysisState:entry.analysisState,attempts:entry.analysisAttempts,error:entry.analysisError,sourceHash:entry.analysis?.evidenceHash,provenance:entry.analysis?.provenance},null,2))}</pre></details></article>`;
    }).join('')||'<p class="empty">코드 변경 이력을 불러오고 있습니다.</p>';
    $('moreReleases').hidden=ledger.entries.length<=releaseLimit;
  }
  function metrics(cases){
    const linked=cases.filter(c=>c.memo.body.releaseSha),reports=cases.filter(c=>c.latestResult),verified=cases.filter(c=>c.status==='validated');
    $('accumulationMetrics').innerHTML=`<h3>재현 가능한 개선 근거</h3><div class="workflow-counts"><span>실측·코드 직접 연결 <b>${linked.length}</b></span><span>개발 결과 원문 <b>${reports.length}</b></span><span>전후 버전 기재 <b>${reports.filter(c=>c.latestResult.body.fromVersion&&c.latestResult.body.toVersion).length}</b></span><span>연구자 검증 근거 <b>${verified.length}</b></span><span>배포 이벤트 기록 <b>${ledger.entries.reduce((n,e)=>n+(e.deploymentEvents||[]).filter(v=>v.type==='deployment').length,0)}</b></span></div><p class="muted">실측·코드 직접 연결은 연결 버튼으로 등록한 메모 수입니다. 숫자가 많다는 이유로 측정 정확도나 기술적 독점성을 확정하지 않습니다.</p>`;
    $('validationQueue').innerHTML=cases.filter(c=>c.status!=='dismissed').map(c=>`<div class="validation-row"><button data-validate-session="${esc(c.row.id)}">${esc(c.row.code)} · ${esc(c.memo.body.title)}</button><p>${esc(c.review?.body.followup||c.latestResult?.body.followup||c.memo.body.validationPlan||'후속 검증 계획을 기록하세요.')}</p></div>`).join('')||'<p class="muted">연결된 실측 개선 메모가 없습니다. 개발 과제에서 실측을 연결하세요.</p>';
    $('validationQueue').querySelectorAll('[data-validate-session]').forEach(b=>b.onclick=()=>hooks.select(state.rows.find(r=>r.id===b.dataset.validateSession)));
  }
  function download(text,name){const u=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
  async function read(url){const r=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('HTTP '+r.status);const v=await r.json();if(v.schema!=='dataset-evolution-1'||!Array.isArray(v.entries))throw Error('invalid ledger');return v;}
  async function refresh(){
    if(loading)return;loading=true;$('syncEvolution').disabled=true;
    try{
      let origin='배포본';try{const local=await read('dataset-evolution-log.json');if(!ledger.updatedAt||local.updatedAt>=ledger.updatedAt)ledger=local;}catch(_){}
      render();
      try{const latest=await read('https://raw.githubusercontent.com/jeebs0627/neurolens/main/dataset-evolution-log.json?v='+Math.floor(Date.now()/60000));if(!ledger.updatedAt||latest.updatedAt>=ledger.updatedAt){ledger=latest;origin='GitHub 기록';}}catch(_){origin='배포본 · GitHub 최신 기록 연결 대기';}
      $('evolutionStatus').textContent=`${origin} · ${date(ledger.updatedAt)} · push·배포 이벤트 및 30분 주기 자동 동기화. 새로고침은 수집된 기록을 조회합니다.`;render();
    }finally{loading=false;$('syncEvolution').disabled=false;}
  }
  function init(options){
    hooks=options;document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>activate(b.dataset.view));
    ['taskSource','taskDomain','taskSearch'].forEach(id=>$(id).oninput=()=>{taskLimit=12;render();});
    $('moreTasks').onclick=()=>{taskLimit+=12;render();};$('moreReleases').onclick=()=>{releaseLimit+=15;render();};$('syncEvolution').onclick=refresh;
    activate(location.hash==='#local'?'measurements':location.hash.slice(1)||'work');
    refresh();setInterval(()=>{if(!document.hidden)refresh();},120000);
  }
  root.NLDatasetWorkspace={init,activate,update:value=>{state=value;render();},eventLabel};
})(globalThis);
