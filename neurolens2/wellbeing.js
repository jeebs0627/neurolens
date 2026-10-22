/* Transparent self-report scoring and behavioral summaries. No camera-to-diagnosis conversion. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.NL2Wellbeing=api;})(typeof self!=='undefined'?self:globalThis,function(){
  'use strict';
  const VERSION='mind-checkin-1',finite=x=>typeof x==='number'&&Number.isFinite(x);
  const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
  function quantile(a,q){if(!a.length)return null;const s=[...a].sort((a,b)=>a-b),i=(s.length-1)*q;return s[Math.floor(i)]+(s[Math.ceil(i)]-s[Math.floor(i)])*(i%1);}
  const items=[
    {id:'interest',group:'phq',text:'일 또는 여가 활동을 하는 데 흥미나 즐거움을 느끼지 못함',max:3},
    {id:'lowMood',group:'phq',text:'기분이 가라앉거나, 우울하거나, 희망이 없음',max:3},
    {id:'anxiety',group:'phq',text:'초조하거나 불안하거나 조마조마하게 느껴짐',max:3},
    {id:'worry',group:'phq',text:'걱정하는 것을 멈추거나 조절할 수 없음',max:3},
    {id:'tension',group:'now',text:'지금 몸과 마음의 긴장은 어느 정도인가요?',max:10,ends:['전혀 긴장하지 않음','매우 긴장됨']},
    {id:'energy',group:'now',text:'지금 일상을 이어갈 활력은 어느 정도인가요?',max:10,ends:['활력이 거의 없음','활력이 충분함']},
    {id:'agency',group:'resources',text:'어려움이 생겨도 내가 할 수 있는 작은 행동을 정할 수 있다.',max:4},
    {id:'support',group:'resources',text:'마음이 벅찰 때 연락할 사람이나 도움받을 곳이 있다.',max:4},
    {id:'rest',group:'resources',text:'나를 쉬게 해주는 활동을 알고, 오늘 실천할 여지가 있다.',max:4}
  ];
  const sources=[
    {label:'PHQ-4 원 도구와 채점',url:'https://www.nih.gov/node/21506'},
    {label:'PHQ-4 채점 구간',url:'https://scholar.harvard.edu/files/bettina.hoeppner/files/phq-4.pdf'},
    {label:'한국어 PHQ-4 연구와 해석의 한계',url:'https://pmc.ncbi.nlm.nih.gov/articles/PMC7851451/'},
    {label:'자가 돌봄과 전문적인 도움 · NIMH',url:'https://www.nimh.nih.gov/health/topics/caring-for-your-mental-health'},
    {label:'PHQ·GAD 사용 안내 · Pfizer',url:'https://www.pfizer.com/news/press-release/press-release-detail/pfizer_to_offer_free_public_access_to_mental_health_assessment_tools_to_improve_diagnosis_and_patient_care'}
  ];
  function validate(checkin){
    if(checkin===undefined||checkin===null)return null;
    if(checkin.version!==VERSION||!checkin.answers||Array.isArray(checkin.answers)||typeof checkin.answers!=='object')throw Error('마음 체크인 기록 형식이 올바르지 않습니다.');
    if(typeof checkin.completedAt!=='string'||!Number.isFinite(Date.parse(checkin.completedAt)))throw Error('마음 체크인 시각이 올바르지 않습니다.');
    for(const [id,v] of Object.entries(checkin.answers)){const item=items.find(q=>q.id===id);if(!item||!Number.isInteger(v)||v<0||v>item.max)throw Error('마음 체크인 응답 범위를 확인해주세요.');}
    if(checkin.context!==undefined){
      if(!checkin.context||Array.isArray(checkin.context)||typeof checkin.context!=='object')throw Error('검사 조건 형식을 확인해주세요.');
      const choices={sleep:['unknown','usual','short','long'],caffeine:['unknown','yes','no'],exercise:['unknown','yes','no']};
      for(const [key,value] of Object.entries(checkin.context))if(!choices[key]?.includes(value))throw Error('검사 조건 값을 확인해주세요.');
    }
    return checkin;
  }
  function score(checkin){
    validate(checkin);const a=checkin?.answers||{},complete=ids=>ids.every(id=>Number.isInteger(a[id])),sum=ids=>complete(ids)?ids.reduce((s,id)=>s+a[id],0):null;
    const phq4=sum(['interest','lowMood','anxiety','worry']),depression=sum(['interest','lowMood']),anxiety=sum(['anxiety','worry']);
    const grade=phq4===null?null:phq4<=2?0:phq4<=5?1:phq4<=8?2:3;
    const resourceSum=sum(['agency','support','rest']),resources=resourceSum===null?null:Math.round(resourceSum/12*100);
    return {phq4,depression,anxiety,grade,gradeLabel:grade===null?'체크인 없음':['낮은 수준','가벼운 수준','중간 수준','높은 수준'][grade],
      tension:a.tension??null,energy:a.energy??null,resources,resourceItems:['agency','support','rest'].map(id=>({id,value:a[id]??null})),
      resourceLabel:resources===null?'체크인 없음':resources<34?'도움을 보탤 때':resources<67?'기반을 쌓는 중':'활용할 자원 있음',
      method:'PHQ-4: 네 응답 합계 0–12. 회복 자원: 자체 3문항 합계 ÷ 12 × 100. 긴장·활력: 단일 자기평가 0–10. 서로 합산하지 않음.'};
  }
  function wilson(success,total){
    if(!total)return null;
    const z=1.96,p=success/total,d=1+z*z/total,center=(p+z*z/(2*total))/d,half=z*Math.sqrt(p*(1-p)/total+z*z/(4*total*total))/d;
    return [Math.max(0,(center-half)*100),Math.min(100,(center+half)*100)];
  }
  function behavioral(packet,kind){
    const planned=packet.trials.filter(t=>t.kind===kind),shown=planned.filter(t=>finite(t.shownAt)&&t.end<=packet.elapsed);
    const eligible=shown.filter(t=>t.shownAt<=t.start+750&&!t.presentationInvalid&&!(t.inputLagMs>150));
    const answered=eligible.filter(t=>finite(t.responseAt)&&finite(t.targetAt)&&t.responseAt>=t.targetAt+100&&t.responseAt<t.end);
    const correct=answered.filter(t=>t.correct===true),rts=(kind==='reward'?answered:correct).map(t=>t.responseAt-t.targetAt);
    const enough=eligible.length>=4,accuracy=eligible.length&&kind!=='reward'?Math.round(correct.length/eligible.length*100):null;
    return {kind,planned:planned.length,shown:shown.length,eligible:eligible.length,answered:answered.length,correct:correct.length,omissions:eligible.length-answered.length,excluded:shown.length-eligible.length,
      accuracy,accuracyInterval:kind==='reward'?null:wilson(correct.length,eligible.length),coverage:eligible.length?Math.round(answered.length/eligible.length*100):null,medianRT:quantile(rts,.5),iqr:rts.length>=4?[quantile(rts,.25),quantile(rts,.75)]:null,
      wins:answered.filter(t=>t.win===true).length,usable:enough&&answered.length>=4,
      points:shown.map((t,i)=>({i:i+1,rt:answered.includes(t)?t.responseAt-t.targetAt:null,correct:t.correct===true,excluded:!eligible.includes(t),difficulty:t.difficulty??null,win:t.win===true})),
      note:!planned.length?'이번 검사에는 포함되지 않았습니다.':!eligible.length?'표시·입력 시간 품질을 통과한 완료 시행이 없습니다.':!enough?'시행이 적어 이번 응답만 참고합니다.':'정답률은 무응답을 포함한 유효 시행 기준입니다. 사람들과 비교한 백분위가 아닙니다.'};
  }
  function validatePacket(packet){
    validate(packet.checkin);
    if(packet.careTasks!==undefined){
      if(!packet.careTasks||Array.isArray(packet.careTasks)||typeof packet.careTasks!=='object')throw Error('돌봄 체크 기록 형식이 올바르지 않습니다.');
      for(const [id,value] of Object.entries(packet.careTasks))if(!['support','reset','move','rest','connect','return'].includes(id)||typeof value!=='boolean')throw Error('돌봄 체크 기록을 확인해주세요.');
    }
    if(packet.careObservations!==undefined){
      if(!Array.isArray(packet.careObservations)||packet.careObservations.length>20)throw Error('돌봄 관찰 기록 형식이 올바르지 않습니다.');
      for(const c of packet.careObservations)if(!c||!['breathing','grounding'].includes(c.kind)||c.seconds!==60||typeof c.completedAt!=='string'||!Number.isFinite(Date.parse(c.completedAt))||[c.before,c.after].some(v=>v!==null&&(!Number.isInteger(v)||v<0||v>10)))throw Error('돌봄 관찰 값의 범위를 확인해주세요.');
    }
    return packet;
  }
  function care(s){
    const actions=[];
    if((s.phq4!==null&&s.phq4>=6)||(s.depression!==null&&s.depression>=3)||(s.anxiety!==null&&s.anxiety>=3))actions.push({id:'support',when:'이번 주',title:'상담으로 더 자세히 확인하기',why:'최근 2주 응답에서 추가 확인이 필요한 신호가 있습니다. 과제 성적이 좋아도 이 신호를 지우지 않습니다.',how:'정신건강의학과 또는 정신건강복지센터에 최근 기분과 일상의 어려움을 함께 이야기해보세요. 이 리포트를 가져가도 좋습니다.'});
    actions.push(s.tension!==null&&s.tension>=6?{id:'reset',when:'지금 · 1분',title:'속도를 낮추고 숨 고르기',why:`현재 긴장을 ${s.tension}/10으로 표현했습니다.`,how:'발바닥 감각을 느끼고 어깨를 풀어보세요. 편안한 만큼만 숨을 쉬고, 호흡에 집중하기 불편하면 주변에서 보이는 물건 세 가지를 찾아보세요.'}:{id:'reset',when:'지금 · 1분',title:'잠깐 멈춰 내 감각 확인하기',why:'짧은 쉼을 오늘의 돌봄 시작점으로 삼아보세요.',how:'발바닥이 닿는 곳과 어깨의 힘을 느껴보세요. 숨을 억지로 깊게 쉬지 않아도 됩니다.'});
    if((s.energy!==null&&s.energy<=3)||(s.depression!==null&&s.depression>=2))actions.push({id:'move',when:'오늘 · 5–10분',title:'부담 없는 활동 하나 정하기',why:'활력이나 즐거움이 줄었다는 응답을 참고한 제안입니다.',how:'가능한 범위에서 잠깐 걷기, 창가에서 쉬기, 좋아하는 음악 한 곡 듣기 중 하나만 골라보세요.'});
    else actions.push({id:'rest',when:'오늘 저녁',title:'회복할 시간을 미리 남겨두기',why:'내게 맞는 휴식과 수면 리듬을 지키는 데 초점을 둡니다.',how:'오늘 미뤄도 되는 일 하나를 정하고, 평소 잠드는 시간에 맞춰 화면에서 쉬는 시간을 마련해보세요.'});
    if(Number.isInteger(s.resourceItems.find(x=>x.id==='support')?.value)&&s.resourceItems.find(x=>x.id==='support').value<=1)actions.push({id:'connect',when:'오늘',title:'혼자 버티지 않을 연결 만들기',why:'도움받을 곳이 충분하지 않다고 답했습니다.',how:'연락할 사람 한 명 또는 이용할 상담 기관 하나를 적어보세요. 당장 모든 이야기를 꺼낼 필요는 없습니다.'});
    actions.push({id:'return',when:'다음 관찰',title:'내일, 비슷한 시간에 다시 보기',why:'오늘의 긴장·활력은 여러 날의 흐름에서 더 잘 이해할 수 있습니다.',how:'같은 참여 코드로 짧게 확인하세요. 최근 2주 설문은 관찰 기간이 겹치므로 하루 차이를 치료 효과로 해석하지 않습니다.'});
    return actions;
  }
  function analyze(packet,result){
    const s=score(packet.checkin),tasks=['disengage','load','reward'].map(k=>behavioral(packet,k)),validWindows=result.windows.filter(w=>finite(w.bpm));
    const attention=['threat','dysphoric','positive'].map(k=>result.features.find(f=>f.id==='attention-'+k)).filter(Boolean);
    const headline=s.phq4>=6&&s.phq4!==null?'마음의 부담을 혼자 견디지 않아도 됩니다.':s.tension>=6&&s.tension!==null?'지금은 잠깐, 긴장을 내려놓을 때예요.':s.resources!==null&&s.resources<34?'회복을 도울 작은 자원부터 채워보세요.':s.phq4!==null?'오늘의 마음을 알고, 내 리듬을 이어가세요.':'오늘의 반응을 기록했습니다.';
    const story=s.phq4===null?'마음 체크인 응답이 없어 우울감·불안 관련 점수는 없습니다. 아래에는 실제 과제에서 관찰한 반응을 정리했습니다.':`최근 2주 정서 부담은 ${s.phq4}/12점, ${s.gradeLabel}입니다. ${s.phq4>=6?'가까운 시일에 전문가와 일상의 어려움을 함께 확인해보길 권합니다.':'이 점수는 스스로 답한 어려움의 빈도입니다. 낮은 점수라도 불편함이 지속되면 도움을 받아도 좋습니다.'}`;
    const modalities={selfReport:Object.keys(packet.checkin?.answers||{}).length,gaze:attention.filter(f=>f.usable).length,behavior:tasks.filter(t=>t.usable).length,pulse:validWindows.length};
    return {version:VERSION,self:s,tasks,attention,headline,story,actions:care(s),modalities,
      quality:{frames:packet.frames.length,faceFrames:packet.frames.filter(f=>f.face).length,pulseAccepted:validWindows.length,pulseTotal:result.windows.length,calibration:packet.calibration.grade,complete:packet.status==='completed'},
      physiology:[packet.phases?.some(p=>p.id==='preload')?'preload':'baseline','load','recovery'].map(phase=>({phase,bpm:quantile(validWindows.filter(w=>w.phase===phase).map(w=>w.bpm),.5),n:validWindows.filter(w=>w.phase===phase).length})),
      distinction:'느낀 마음과 과제 반응은 서로 다른 정보입니다. 심박·시선·반응속도로 설문 점수를 올리거나 낮추지 않습니다.'};
  }
  function historySeries(current,history){
    const days=new Map(),same=current.origin==='observed'&&current.purpose!=='evaluation';
    for(const p of [...history,current].filter(p=>p.participant===current.participant&&p.createdAt<=current.createdAt&&(p.status==='completed'||p.checkinOnly===true)&&(same?p.origin==='observed'&&p.purpose!=='evaluation':p.id===current.id)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt))){
      let s;try{s=score(p.checkin);}catch{continue;}if(s.tension===null&&s.energy===null)continue;
      const date=new Date(p.createdAt),day=p.localDate&&/^\d{4}-\d{2}-\d{2}$/.test(p.localDate)?p.localDate:[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');days.set(day,{day,tension:s.tension,energy:s.energy,id:p.id});
    }
    return [...days.values()].slice(-7);
  }
  return {VERSION,items,sources,validate,validatePacket,score,behavioral,care,analyze,historySeries,quantile,wilson};
});
