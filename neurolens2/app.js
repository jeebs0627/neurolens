import {Session} from './session.js';
import {Store} from './storage.js';
import {collectCheckin} from './checkin.js';
import {reportHTML,bindReport,downloadReport} from './report.js';
import {art} from './visuals.js';
const C=globalThis.NL2,$=id=>document.getElementById(id);
const names={calibration:'시선 맞추기',baseline:'편안한 상태',attention:'정서 주의',disengage:'주의 전환',reward:'보상 선택',preload:'부하 전 기준',load:'짧은 집중',recovery:'회복 관찰',wrap:'마무리'};
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(x,d=1)=>Number.isFinite(x)?x.toFixed(d):'—';
async function hash(text){const buffer=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return [...new Uint8Array(buffer)].map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,24);}
function download(packet){const blob=new Blob([JSON.stringify(packet)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='in-mind-2-'+packet.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function compute(packet){return new Promise((resolve,reject)=>{const worker=new Worker(new URL('./analysis-worker.js',import.meta.url));const timer=setTimeout(()=>{worker.terminate();reject(Error('분석 시간 초과'));},30000);
  worker.onmessage=({data})=>{clearTimeout(timer);worker.terminate();data.error?reject(Error(data.error)):resolve(data.result);};worker.onerror=()=>{clearTimeout(timer);worker.terminate();reject(Error('분석 작업자 오류'));};worker.postMessage({id:packet.id,packet});});}

export async function mount({access,verify,logout}){
  const events=new AbortController(),store=new Store(access.scope);let persist=true,history=[],packet=null,preparing=false,manifest,displayed=null,session,reportCleanup;
  const on=(node,type,fn)=>node.addEventListener(type,fn,{signal:events.signal});
  try{await store.open();history=await store.list();}catch{$('storage-status').textContent='저장소 사용 불가 · 결과 JSON을 내보내세요';persist=false;}
  manifest=await fetch('/neurolens2/stimuli/manifest.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw Error('자극 목록을 불러오지 못했습니다.');return r.json();});
  $('access-label').textContent=access.mode==='local-owner'?'LOCAL ADMIN':'ADMIN';
  try{$('participant').value=localStorage.getItem('neurolens2-participant-code')||'research-01';}catch{$('participant').value='research-01';}
  function show(id){if(id!=='results'){reportCleanup?.();reportCleanup=null;}for(const panel of document.querySelectorAll('.panel'))panel.hidden=panel.id!==id;for(const b of document.querySelectorAll('[data-nav]'))b.classList.toggle('active',b.dataset.nav===id);window.scrollTo(0,0);}
  function status(message,error=false){$('setup-status').textContent=message;$('setup-status').classList.toggle('error',error);}
  function controls(enabled){for(const el of document.querySelectorAll('.topbar button:not(#logout),#start,#demo,#demo-report,#import'))el.disabled=!enabled;}
  async function scopedHistory(){const participant=await hash(access.scope+':'+$('participant').value.trim());return history.filter(h=>h.participant===participant);}
  async function recommendation(){const hs=await scopedHistory(),r=C.recommend(hs);$('recommendation').textContent=$('protocol').value==='first180'?'처음이라면 전체 검사를 권합니다. 환경 확인과 연습 후, 보기·방향 전환·선택·집중·회복을 차례로 경험합니다.':$('protocol').value==='daily60'?'짧은 검사는 방향 전환 또는 선택 과제를 중심으로 관찰합니다. 준비와 설명 시간은 별도입니다.':`오늘의 관찰: ${names[r.kind]} · 준비와 짧은 연습 후 시작합니다.`;}
  session=new Session({manifest,onCancel(){controls(true);show('overview');status('준비를 마치고 다시 시작할 수 있습니다.');},async onComplete(p){
    packet=p;
    try{p.result=await compute(p);await save(p);renderResults(p);}catch(e){$('session-status').textContent='결과 정리 중 문제가 발생했습니다: '+e.message;const b=document.createElement('button');b.className='secondary';b.textContent='수치 기록 내보내기';b.onclick=()=>download(p);$('session-status').append(b);}finally{controls(true);}
  }});
  async function start(){
    if(session.busy||preparing)return;
    const code=$('participant').value.trim();if(!code){status('참여 코드를 입력해주세요.',true);return;}
    preparing=true;controls(false);status('접근 권한을 확인합니다…');
    try{await verify();try{localStorage.setItem('neurolens2-participant-code',code);}catch{}
      const hs=await scopedHistory(),behavior=$('behavior-only').checked,protocol=$('protocol').value;
      let focus=$('focus').value==='auto'?C.recommend(hs).kind:$('focus').value;
      if((behavior||protocol==='daily60')&&focus==='attention')focus='disengage';
      const participant=await hash(access.scope+':'+code),form=Math.floor(Date.now()/86400000)%2?'A':'B';
      show('checkin');status('');const checkin=await collectCheckin($('checkin'),events.signal);
      if(events.signal.aborted)return;
      if(checkin===undefined){controls(true);show('overview');return;}
      show('session');await session.start({participant,protocol,focus,form,behavior,checkin,recommendation:C.recommend(hs),deviceHash:hash});
    }catch(e){controls(true);show('overview');status(e.message,true);}finally{preparing=false;}
  }
  async function save(p){if(persist){try{await store.put(p);}catch{persist=false;$('storage-status').textContent='저장 실패 · JSON을 내보내세요';}}history=[p,...history.filter(h=>h.id!==p.id)];}
  function renderResults(p){
    reportCleanup?.();displayed=p;show('results');$('results').innerHTML=reportHTML(p,history);
    reportCleanup=bindReport($('results'),p,{save,signal:events.signal});
    on($('export-result'),'click',()=>download(p));
    on($('print-report'),'click',()=>window.print());
    on($('download-report'),'click',async()=>{const b=$('download-report');b.disabled=true;try{await downloadReport($('results'),p);b.textContent='리포트 저장 완료 ✓';}catch(e){b.textContent=e.message;}finally{b.disabled=false;}});
    on($('new-session'),'click',()=>{show('overview');recommendation();});
  }
  function renderHistory(){show('history');$('history').innerHTML=`<div class="results-head"><div><p class="eyebrow">YOUR RESEARCH LOG</p><h1>누적 관측 기록</h1><p>이 관리자 범위의 브라우저 저장소에 ${history.length}개 기록이 있습니다.</p></div></div>${!history.length?'<div class="empty">첫 관측을 시작하면 여기에 기록됩니다.</div>':`<div class="table-wrap"><table><thead><tr><th>일시</th><th>참여 코드 해시</th><th>유형</th><th>시간 / 상태</th><th>보기</th></tr></thead><tbody>${history.map(p=>`<tr><td>${esc(new Date(p.createdAt).toLocaleString('ko-KR'))}</td><td>${esc(p.participant.slice(0,8))}</td><td>${esc(p.origin)} / ${esc(p.protocol)}</td><td>${fmt(p.elapsed/1000,0)}초 / ${esc(p.status)}</td><td><button data-record="${esc(p.id)}">결과</button><button data-remove="${esc(p.id)}" class="danger">삭제</button></td></tr>`).join('')}</tbody></table></div>`}<div class="note">서로 다른 참여 코드·장치·과제 형식은 기준선에서 분리됩니다. 가져온 기록과 합성 기록도 실제 기준선에 포함하지 않습니다. 데이터는 이 브라우저를 지우면 사라지므로 필요한 기록은 내보내세요.</div>`;
    for(const b of $('history').querySelectorAll('[data-record]'))on(b,'click',()=>renderResults(history.find(p=>p.id===b.dataset.record)));
    for(const b of $('history').querySelectorAll('[data-remove]'))on(b,'click',async()=>{if(b.dataset.armed!=='yes'){b.dataset.armed='yes';b.textContent='다시 눌러 삭제';return;}const id=b.dataset.remove;if(persist)await store.remove(id);history=history.filter(p=>p.id!==id);renderHistory();});
  }
  function renderMethods(){show('methods');$('methods').innerHTML=`<div class="results-head"><div><p class="eyebrow">EXPLAINABLE BY CONSTRUCTION</p><h1>결과를 만드는 원리</h1><p>관측 → 품질 확인 → 후보 비교 → 개인 변화. 각 단계는 기록으로 재현합니다.</p></div></div><div class="method-grid">
      <section class="card"><h3>01 · 교정과 검증을 분리</h3><p>세 지점의 시선으로 수평 위치를 보정합니다. 이후 두 지점은 보정식에 넣지 않고 오차만 평가합니다. 화면 너비 대비 평균 절대 오차 12% 이하 G2, 22% 이하 G1, 그 외 G0입니다. 이는 초기 공학 기준이며 정밀 안구추적기 성능을 뜻하지 않습니다.</p><p>준비 화면에서 한 사람의 얼굴, 얼굴 크기·중앙 위치·자세·빛이 2초간 안정적인지 확인합니다. 깜박임, 교정 이후 얼굴 위치·크기·기울기 변화, 오래된 관측과 AOI 경계의 모호한 표본은 시선 근거에서 제외합니다. G0일 때 시선 결과를 만들지 않습니다.</p></section>
      <section class="card"><h3>02 · 같은 영상의 증거 중복 제거</h3><p>이마와 양 볼의 RGB에서 공개 POS·CHROM 방법을 비교합니다. 같은 ROI의 알고리즘 둘은 독립 센서가 아닙니다. 픽셀 영역이 겹치는 ROI도 지지 수를 늘리지 않습니다. 공간적으로 분리된 두 영역 이상이 합의해야 심박 후보를 채택합니다.</p><p>12초의 겹치지 않는 창, 실제 관측 연속성, 신호의 주기 반복성과 경쟁 주파수, 배경 조명 혼입을 확인합니다. 한 얼굴 영역이 오염돼도 다른 두 영역이 유일하게 합의하면 그 둘만 채택합니다. 비슷하게 지지되는 조합이 여러 개면 보류합니다. HRV와 임상 수준의 심박 정확도는 아직 주장하지 않습니다.</p></section>
      <section class="card"><h3>03 · 정서를 과제 반응으로 관찰</h3><p>위협·슬픔·긍정 이미지의 체류 비율, 자극에서 시선을 떼는 시간, 수동 반응 시간, 보상 선택, 부하 후 회복을 분리해서 기록합니다. 시선과 버튼 반응을 하나의 지표로 섞지 않습니다.</p><p>자극 세트는 잠정 상태입니다. 짧은 시행의 수치가 불안, 우울 또는 자아탄력성을 직접 측정한다고 해석하지 않습니다. 해당 관련성은 향후 반복 연구에서 평가합니다.</p></section>
      <section class="card"><h3>04 · 비교 가능한 날짜만 누적</h3><p>같은 참여 코드·카메라·화면 크기·프로토콜·과제·A/B 형식·엔진과 입력 방식·난이도 조건을 만족하는 이전 날짜만 기준선 후보로 씁니다. 같은 날의 반복은 하루 한 기록으로 처리합니다. 첫 7개 날짜와 최근 7개 날짜를 따로 유지합니다.</p><p>현재 자동 과제 선택은 유효 관측 수에 따른 탐색 규칙입니다. 학습된 진단 모델이나 검증된 정보량 최적화로 표시하지 않습니다.</p></section>
      <section class="card"><h3>05 · 저장과 재현</h3><p>영상·음성·얼굴 원본은 저장하지 않습니다. 시각, ROI 평균 RGB, 품질, 교정 관측, 과제 사건과 반응만 전용 IndexedDB에 기록합니다. 준비·연습·설명과 실제 측정의 시계를 분리합니다. 표시 프레임 콜백과 입력 사건 시각을 기록하고, 화면 정체나 전달 지연이 큰 반응은 분석에서 제외합니다. 디스플레이의 실제 발광 시각과 카메라 노출 시각까지 측정하는 장비 검증은 별도입니다. JSON을 가져올 때 저장된 점수를 신뢰하지 않고 다시 교정하고 분석합니다.</p><p>합성·가져온 기록은 개인 기준선에서 제외됩니다. 운영 검사 페이지, 운영 결과 테이블과 실행 상태를 공유하지 않습니다.</p></section>
      <section class="card"><h3>06 · 마음 체크인과 돌봄</h3><p>PHQ-4의 네 응답을 0–12점으로 합산해 최근 2주 정서 부담 구간을 표시합니다. 우울감·불안 소계는 추가 확인 신호로만 읽습니다. 현재 긴장·활력은 0–10 자기평가, 회복 자원은 자체 3문항 합계 ÷ 12 × 100입니다. 생리·행동 지표와 합쳐 진단 점수를 만들지 않습니다. 각 리포트에서 원 도구와 연구 출처, 산식을 확인할 수 있습니다.</p><p>돌봄은 응답에 따른 공개 규칙으로 제안합니다. 1분 쉬기와 전후 긴장 기록은 본인이 느낀 경험이며 개입 효과의 증명이 아닙니다.</p></section><section class="card"><h3>07 · 다음 검증 단계</h3><ol><li>실제 얼굴·조명·피부색·장치별 수집 및 재검사 평가</li><li>공개 RGB-PPG 자료의 피험자 분리 비교</li><li>기준 장비 확보 후 동시 측정 오차 검증</li><li>정서 척도·반복 관측과의 관련성 평가</li><li>회복 개입 무작위 비교와 개인 효과 모델</li></ol><p>현재 코드는 이 연구를 위한 관측·추적·재현 기반을 제공합니다. 데이터 없이 정확도 수치나 진단 성능을 만들어내지 않습니다.</p></section></div><div class="note">핵심 독자 구현: 시간 예산에 맞춘 과제 제어, 교정 검증과 품질에 따른 근거 보류, 후보의 원천 추적 및 중복 지지 제거, 비교 조건을 고정한 종단 분석. 공개 얼굴 모델과 POS·CHROM 자체를 독자 발명으로 주장하지 않습니다.</div>`;}
  async function importRecord(event){const file=event.target.files?.[0];event.target.value='';if(!file)return;if(file.size>8*1024*1024){status('8MB 이하의 수치 기록만 가져올 수 있습니다.',true);return;}
    controls(false);try{await verify();const p=C.validate(JSON.parse(await file.text()));p.sourceId=p.id;p.id=crypto.randomUUID();p.origin='imported';p.result=await compute(p);await save(p);renderResults(p);}catch(e){status('기록을 가져오지 못했습니다: '+e.message,true);show('overview');}finally{controls(true);}}
  async function demo(){controls(false);status('합성 수치 기록을 생성하고 엔진을 재현합니다…');try{await verify();const {makeFixture}=await import('./fixture.js');const p=makeFixture(manifest);p.result=await compute(p);await save(p);renderResults(p);status('');}catch(e){status(e.message,true);}finally{controls(true);}}
  for(const b of document.querySelectorAll('[data-nav]'))on(b,'click',()=>{if(session.busy||preparing)return;if(b.dataset.nav==='history')renderHistory();else if(b.dataset.nav==='methods')renderMethods();else{show('overview');recommendation();}});
  on($('start'),'click',start);on($('logout'),'click',logout);on($('import'),'change',importRecord);on($('demo'),'click',demo);on($('demo-report'),'click',demo);
  on($('protocol'),'change',recommendation);on($('participant'),'change',recommendation);
  for(const node of document.querySelectorAll('[data-art]'))node.innerHTML=art(node.dataset.art);
  show('overview');recommendation();
  return {async destroy(){await session.destroy();events.abort();store.close();}};
}
