import {art} from './visuals.js';
const W=globalThis.NL2Wellbeing;
const steps=[
  {group:'phq',title:'최근 2주, 마음은 어땠나요?',intro:'지난 2주 동안 아래의 어려움을 얼마나 자주 겪었나요?',note:'PHQ-4 · 우울감과 불안 관련 어려움의 빈도를 확인하는 4문항입니다.',labels:['전혀 없었다','며칠 있었다','절반 이상 있었다','거의 매일 있었다']},
  {group:'now',title:'지금 이 순간을 짚어볼게요.',intro:'지금 느끼는 긴장과 활력을 각각 골라주세요.',note:'0은 가장 적은 상태, 10은 가장 큰 상태입니다. 정답은 없습니다.'},
  {group:'resources',title:'나를 회복시키는 힘은 어디에 있나요?',intro:'오늘의 나를 떠올리며, 각 문장에 얼마나 동의하는지 골라주세요.',note:'회복 자원 체크 · 자아탄력성의 진단 척도가 아닌, 돌봄 계획을 위한 자체 문항입니다.',labels:['전혀 아니다','별로 아니다','반반이다','대체로 그렇다','매우 그렇다']}
];
export function collectCheckin(container,signal){return new Promise(resolve=>{
  const events=new AbortController(),answers={},context={sleep:'unknown',caffeine:'unknown',exercise:'unknown'};let step=0,settled=false;
  const finish=value=>{if(settled)return;settled=true;events.abort();signal.removeEventListener('abort',cancel);resolve(value);};
  const cancel=()=>finish(undefined);signal.addEventListener('abort',cancel,{once:true});
  if(signal.aborted){cancel();return;}
  function render(){const s=steps[step];container.innerHTML=`<div class="checkin-shell"><div class="checkin-top"><span class="eyebrow">MY MIND CHECK-IN</span><button class="quiet" data-checkin="cancel">검사 시작으로 돌아가기</button></div><div class="checkin-steps" aria-label="마음 체크인 진행">${steps.map((s,i)=>`<span class="${i===step?'current':i<step?'done':''}">${String(i+1).padStart(2,'0')} · ${['최근의 마음','지금의 느낌','회복 자원'][i]}</span>`).join('')}</div><div class="checkin-heading">${art(step===0?'mind':step===1?'recovery':'disengage')}<div><p class="eyebrow">${step+1} / 3 · 마음 체크인</p><h1>${s.title}</h1><p>${s.intro}</p></div></div><p class="checkin-note">${s.note}</p><div class="checkin-questions">${W.items.filter(q=>q.group===s.group).map((q,i)=>`<fieldset class="checkin-item" data-id="${q.id}"><legend><span>${i+1}</span>${q.text}</legend>${q.ends?`<div class="scale-ends"><span>0 · ${q.ends[0]}</span><span>10 · ${q.ends[1]}</span></div>`:''}<div class="checkin-options ${q.max===10?'number-scale':''}">${Array.from({length:q.max+1},(_,n)=>`<label><input type="radio" name="${q.id}" value="${n}" ${answers[q.id]===n?'checked':''}><span>${q.max===10?n:s.labels[n]}</span></label>`).join('')}</div></fieldset>`).join('')}</div>${step===1?`<details class="context-check"><summary>오늘의 검사 조건 남기기 · 선택 사항</summary><p class="hint">수면·카페인·운동은 반응에 영향을 줄 수 있어 같은 조건끼리 비교합니다. 마음 점수에는 더하지 않습니다.</p><div class="context-fields">${[
      ['sleep','지난밤 수면',[['unknown','기록하지 않음'],['usual','평소와 비슷함'],['short','평소보다 적음'],['long','평소보다 많음']]],
      ['caffeine','최근 2시간 카페인',[['unknown','기록하지 않음'],['no','섭취하지 않음'],['yes','섭취함']]],
      ['exercise','최근 30분 격한 운동',[['unknown','기록하지 않음'],['no','하지 않음'],['yes','했음']]]
    ].map(([id,label,options])=>`<label>${label}<select data-context="${id}">${options.map(([v,text])=>`<option value="${v}" ${context[id]===v?'selected':''}>${text}</option>`).join('')}</select></label>`).join('')}</div></details>`:''}<div class="checkin-footer"><button class="secondary" data-checkin="back" ${step===0?'disabled':''}>이전</button><p id="checkin-progress" role="status"></p><button class="primary" data-checkin="next">${step===2?'환경 준비로 이어가기':'다음으로'} <span>→</span></button></div><button class="quiet skip-checkin" data-checkin="skip">체크인 전체 건너뛰기</button><p class="hint">약 40–60초, 사람마다 다를 수 있습니다. 생략하면 정서 부담·회복 자원 점수 없이 과제 결과만 제공합니다.</p></div>`;update();window.scrollTo(0,0);}
  function update(){const questions=W.items.filter(q=>q.group===steps[step].group),n=questions.filter(q=>answers[q.id]!==undefined).length;container.querySelector('[data-checkin=next]').disabled=n!==questions.length;container.querySelector('#checkin-progress').textContent=`${n} / ${questions.length}개 응답`;}
  container.addEventListener('change',e=>{if(e.target.matches('[data-context]'))context[e.target.dataset.context]=e.target.value;if(e.target.matches('input[type=radio]')){answers[e.target.name]=Number(e.target.value);update();}},{signal:events.signal});
  container.addEventListener('click',e=>{const b=e.target.closest('[data-checkin]');if(!b||b.disabled)return;const action=b.dataset.checkin;
    if(action==='skip')finish(null);else if(action==='cancel')cancel();else if(action==='back'){step--;render();}else if(action==='next'){
      if(W.items.filter(q=>q.group===steps[step].group).some(q=>answers[q.id]===undefined))return;
      if(step===2)finish({version:W.VERSION,answers,context,completedAt:new Date().toISOString(),language:'ko',wording:'nl2-ko-1'});else{step++;render();}
    }
  },{signal:events.signal});render();
});}
