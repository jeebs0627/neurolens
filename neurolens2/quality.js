/* Observation audit: coverage and evidence sufficiency are not accuracy scores. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.NL2Quality=api;})(typeof self!=='undefined'?self:globalThis,function(){
  'use strict';
  const finite=Number.isFinite;
  const labels={ready:'관찰 가능',limited:'제한적 관찰',withheld:'해석 보류',absent:'이번에는 미측정'};
  const personal=p=>p.origin==='observed'&&p.purpose!=='evaluation';
  const day=p=>/^\d{4}-\d{2}-\d{2}$/.test(p.localDate||'')?p.localDate:String(p.createdAt||'').slice(0,10);
  function assess(p){
    const trials=p.trials||[],result=p.result||{},rows=result.rows||[],windows=result.windows||[];
    const planned=trials.filter(t=>['disengage','load','reward'].includes(t.kind));
    const shown=planned.filter(t=>finite(t.shownAt)&&t.end<=p.elapsed);
    const valid=shown.filter(t=>t.shownAt<=t.start+750&&!t.presentationInvalid&&!(t.inputLagMs>150));
    const answered=valid.filter(t=>finite(t.targetAt)&&finite(t.responseAt)&&t.responseAt>=t.targetAt+100&&t.responseAt<t.end);
    const checkin=['interest','lowMood','anxiety','worry','tension','energy','agency','support','rest'].filter(k=>Number.isInteger(p.checkin?.answers?.[k])).length;
    const camera=!p.checkinOnly&&['webcam','synthetic'].includes(p.captureMode),synthetic=p.origin==='synthetic'||p.captureMode==='synthetic';
    const hasGaze=camera&&trials.some(t=>['attention','disengage'].includes(t.kind));
    const gazeRows=rows.filter(r=>r.source==='gaze'),pulse=windows.filter(w=>finite(w.bpm));
    const drift=(result.qualityFlags||[]).some(f=>f.type==='gaze-drift');
    const channels=[
      {id:'checkin',label:'내가 답한 마음',state:checkin===9?'ready':checkin?'limited':'absent',count:`${checkin}/9문항`,reason:checkin===9?'응답한 빈도와 현재 느낌을 읽습니다.':'응답하지 않은 마음 상태를 과제 점수로 채우지 않습니다.'},
      {id:'behavior',label:'선택·집중 반응',state:!planned.length?'absent':answered.length<4?'withheld':valid.length<shown.length||answered.length<valid.length?'limited':'ready',count:`${answered.length}/${valid.length} 응답`,reason:`완료·표시 확인 ${shown.length}회 중 품질 제외 ${shown.length-valid.length}회, 무응답 ${valid.length-answered.length}회입니다.`},
      {id:'gaze',label:'그림과 시선',state:!hasGaze?'absent':p.calibration?.grade==='G0'||!gazeRows.length?'withheld':drift||gazeRows.length<6?'limited':'ready',count:hasGaze?`${gazeRows.length}개 유효 시행`:'미측정',reason:!hasGaze?'카메라 또는 시선 과제가 포함되지 않았습니다.':p.calibration?.grade==='G0'?'시선 교정 기준을 통과하지 못했습니다.':drift?'중앙 주시 위치 변화 이후의 시선은 제외했습니다.':'시행 수와 그림별 차이를 함께 봅니다. 시선 비율은 감정 점수가 아닙니다.'},
      {id:'pulse',label:'심박 관찰',state:!camera?'absent':pulse.length===0?'withheld':pulse.length<3||pulse.length<windows.length?'limited':'ready',count:camera?`${pulse.length}/${windows.length}창 채택`:'미측정',reason:!camera?'이번 검사에서는 심박을 측정하지 않았습니다.':pulse.length?'서로 다른 시간 창에서 채택한 심박 후보입니다. 기준 장비 정확도는 별도 검증이 필요합니다.':'얼굴 조명·움직임·연속 관측 또는 영역 합의가 충분하지 않았습니다.'}
    ].map(c=>({...c,status:(synthetic?'합성 예시 · ':'')+labels[c.state]}));
    if(p.engine==='nl2-2.4.0'){
      const breathing=result.breathing||[],accepted=breathing.filter(w=>finite(w.rate));
      const state=!camera||!breathing.length?'absent':accepted.length?'limited':'withheld';
      channels.push({id:'respiration',label:'호흡 움직임 · 연구',state,status:(synthetic?'합성 예시 · ':'')+labels[state],count:camera?`${accepted.length}/${breathing.length}구간 채택`:'미측정',reason:accepted.length?'가슴 좌우 움직임이 일치한 연구 후보입니다. 임상 호흡수 검증은 아직 없습니다.':breathing[0]?.reason||'완료된 30초 자연 호흡 관측이 없습니다.'});
    }
    const issues=[];
    if(p.status!=='completed')issues.push({code:'interrupted',text:'검사 중단',action:'중단 이유를 확인하고, 준비되면 같은 검사로 다시 시작하세요.'});
    if(shown.length>valid.length)issues.push({code:'timing',text:'표시·입력 품질 제외',action:'다른 작업을 닫고 창 크기를 유지한 상태에서 다시 확인하세요.'});
    if(valid.length>answered.length)issues.push({code:'omissions',text:'응답 누락',action:'연습에서 좌우 입력을 확인하고, 빠르기보다 정확하게 응답하세요.'});
    if(hasGaze&&p.calibration?.grade==='G0')issues.push({code:'calibration',text:'시선 교정 미통과',action:'눈높이·거리·조명을 맞춘 뒤 시선 교정을 다시 해보세요.'});
    if(drift)issues.push({code:'drift',text:'시선 위치 변화',action:'고개와 화면 위치를 유지하고 다음 검사에서 다시 교정하세요.'});
    if(camera&&p.captureMode==='webcam'&&!pulse.length)issues.push({code:'pulse',text:'심박 근거 부족',action:'정면 조명을 확보하고 말하거나 움직이지 않은 상태로 다시 관찰하세요.'});
    if(planned.length&&answered.length<4)issues.push({code:'few-trials',text:'유효 응답 부족',action:'이번 반응은 개별 기록으로 남기고 같은 검사에서 다시 확인하세요.'});
    return {channels,issues,review:issues.length>0,checkin,planned:planned.length,shown:shown.length,valid:valid.length,answered:answered.length,excluded:shown.length-valid.length,omissions:valid.length-answered.length,
      next:issues[0]?.action||'같은 참여 코드와 비슷한 시간·환경으로 다른 날짜의 기록을 모으세요.',
      note:'품질 표시는 관측의 이용 가능성입니다. 진단 정확도나 건강 등급이 아닙니다.'};
  }
  function cohort(history,today){
    const records=history.filter(p=>personal(p)&&!p.checkinOnly),completed=records.filter(p=>p.status==='completed'),participants=new Map();
    for(const p of records){if(!participants.has(p.participant))participants.set(p.participant,new Set());if(p.status==='completed')participants.get(p.participant).add(day(p));}
    const eligible=[...participants.values()].filter(days=>[...days].some(d=>d<today));
    return {records:records.length,completed:completed.length,review:records.filter(p=>assess(p).review).length,participants:participants.size,
      returnEligible:eligible.length,returned:eligible.filter(days=>days.size>=2).length,excluded:history.length-records.length,
      completionRate:records.length?Math.round(completed.length/records.length*100):null,
      cameraRecords:records.filter(p=>p.captureMode==='webcam').length,pulseRecords:records.filter(p=>p.captureMode==='webcam'&&(p.result?.windows||[]).some(w=>finite(w.bpm))).length};
  }
  function csv(history){
    const header=['session_id','participant_hash','local_date','origin','purpose','protocol','capture_mode','engine','status','active_seconds','total_seconds','checkin_answered','valid_trials','responses','omissions','timing_excluded','gaze_grade','pulse_accepted','pulse_windows','review_reasons'];
    // Spreadsheet cells must remain text even if an imported ID begins with a formula prefix.
    const cell=value=>'"'+String(value??'').replace(/^[\s]*[=+@-]/,m=>"'"+m).replace(/"/g,'""')+'"';
    const rows=history.map(p=>{const q=assess(p),w=p.result?.windows||[];return [p.id,p.participant,day(p),p.origin,p.purpose||'personal',p.protocol,p.captureMode,p.result?.engine||p.engine,p.status,Math.round(p.elapsed/1000),finite(p.timing?.totalMs)?Math.round(p.timing.totalMs/1000):'',q.checkin,q.valid,q.answered,q.omissions,q.excluded,p.calibration?.grade,w.filter(x=>finite(x.bpm)).length,w.length,q.issues.map(x=>x.code).join('|')];});
    return '\uFEFF'+[header,...rows].map(row=>row.map(cell).join(',')).join('\r\n');
  }
  function diagnostics(p){
    const frames=p.frames||[],gaps=frames.slice(1).map((f,i)=>f.phase===frames[i].phase?f.t-frames[i].t:null).filter(v=>finite(v)&&v>0),sorted=[...gaps].sort((a,b)=>a-b),median=sorted.length?sorted[Math.floor(sorted.length/2)]:null;
    const count=predicate=>frames.filter(predicate).length;
    const windows=p.result?.windows||[],reasons={};for(const w of windows)if(w.bpm===null)reasons[w.reason]=(reasons[w.reason]||0)+1;
    return {frames:frames.length,fps:median?Math.round(1000/median):null,largeGaps:gaps.filter(x=>x>200).length,
      faceCoverage:frames.length?Math.round(count(f=>f.face)/frames.length*100):null,
      roiCoverage:frames.length?Math.round(count(f=>(f.rois||[]).filter(r=>r.coverage>=.65).length>=2)/frames.length*100):null,
      pulseAccepted:windows.filter(w=>finite(w.bpm)).length,pulsePlanned:windows.length,reasons};
  }
  return {labels,personal,day,assess,cohort,csv,diagnostics};
});
