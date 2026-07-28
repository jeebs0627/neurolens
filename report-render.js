/* =========================================================================
 * NeuroLens Report Render — 리포트 공용 렌더 모듈
 *
 * report.html(실제 리포트)과 result.html(샘플 리포트)에 복붙되어 있던
 * esc / TRAITS / RIASEC / MBTI_DESC / renderRadar / renderHolland /
 * renderBig5Legend / renderFit / renderSumTags 를 한 곳으로 모았다.
 * (복사본 간 버전 차이 — 레이더 NaN 가드 유무 — 를 이 파일로 통일)
 *
 * 사용: <script src="report-render.js"></script> 후 전역 함수로 호출.
 * 대상 엘리먼트 ID는 두 페이지가 동일하다:
 *   rRadar · rBig5 · rPodium · rJobs · rHollandCard/Chip/Desc · rRiasec · rSumTags
 * ========================================================================= */

function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);}

/* ---------- Big5 요인 정의 ---------- */
const TRAITS = [
  { key:'개방성', color:'#1E5AF0' },
  { key:'성실성', color:'#0FA47A' },
  { key:'외향성', color:'#E8890C' },
  { key:'친화성', color:'#6C4CE0' },
  { key:'신경성', color:'#E0446A' },
];

/* ---------- MBTI 해설 사전 ---------- */
const MBTI_DESC = {
  ISTJ:{n:'청렴결백한 논리주의자',d:'사실에 근거해 신중하고 책임감 있게 행동하는 유형입니다. 체계와 규칙을 중시하며, 맡은 일은 끝까지 완수하는 신뢰의 아이콘입니다.',k:['체계적','책임감','신중함','실용주의']},
  ISFJ:{n:'용감한 수호자',d:'따뜻하고 헌신적이며 주변 사람을 세심하게 배려하는 유형입니다. 조용하지만 강한 책임감으로 공동체를 지탱합니다.',k:['헌신','배려','성실','안정 지향']},
  INFJ:{n:'선의의 옹호자',d:'깊은 통찰력과 확고한 신념을 지닌 이상주의자입니다. 사람과 세상에 의미 있는 변화를 만들고자 하는 조용한 열정이 있습니다.',k:['통찰력','이상주의','공감','신념']},
  INTJ:{n:'용의주도한 전략가',d:'독립적 사고와 장기적 비전으로 목표를 설계하는 전략가형입니다. 지적 호기심이 강하고 효율과 논리를 중시합니다.',k:['전략적','독립적','분석력','비전']},
  ISTP:{n:'만능 재주꾼',d:'상황을 냉철하게 관찰하고 손으로 문제를 해결하는 실용주의자입니다. 위기 상황에서 침착하게 최적의 해법을 찾아냅니다.',k:['문제해결','유연함','관찰력','실행력']},
  ISFP:{n:'호기심 많은 예술가',d:'온화하고 감성이 풍부하며 자신만의 미적 감각으로 세상을 경험하는 유형입니다. 자유로운 환경에서 잠재력이 빛납니다.',k:['감성','온화함','미적 감각','자유로움']},
  INFP:{n:'열정적인 중재자',d:'깊은 내면 가치와 상상력을 지닌 이상주의자입니다. 진정성을 중요하게 여기며 사람들의 가능성을 믿고 응원합니다.',k:['진정성','상상력','공감','가치 지향']},
  INTP:{n:'논리적인 사색가',d:'지적 탐구 자체를 즐기는 아이디어 뱅크입니다. 복잡한 개념을 분석하고 새로운 관점으로 재구성하는 데 탁월합니다.',k:['논리','탐구심','창의적 사고','객관성']},
  ESTP:{n:'모험을 즐기는 사업가',d:'에너지가 넘치고 현실 감각이 뛰어난 행동파입니다. 순간의 기회를 포착하고 과감하게 실행하는 승부사 기질이 있습니다.',k:['행동력','현실 감각','대담함','순발력']},
  ESFP:{n:'자유로운 영혼의 연예인',d:'밝은 에너지로 주변을 즐겁게 만드는 분위기 메이커입니다. 현재를 충실히 즐기며 사람들과의 교류에서 힘을 얻습니다.',k:['사교성','긍정 에너지','즉흥성','표현력']},
  ENFP:{n:'재기발랄한 활동가',d:'열정과 창의력으로 새로운 가능성을 탐색하는 유형입니다. 사람에 대한 진심 어린 관심으로 깊은 유대감을 형성합니다.',k:['열정','창의력','친화력','호기심']},
  ENTP:{n:'뜨거운 논쟁을 즐기는 변론가',d:'지적 도전과 브레인스토밍을 즐기는 혁신가입니다. 고정관념에 도전하며 기발한 아이디어로 판을 바꿉니다.',k:['혁신','토론','기지','도전정신']},
  ESTJ:{n:'엄격한 관리자',d:'체계와 질서를 세우고 조직을 효율적으로 이끄는 타고난 관리자입니다. 명확한 기준과 실행력으로 결과를 만들어냅니다.',k:['리더십','조직력','결단력','효율']},
  ESFJ:{n:'사교적인 외교관',d:'타인의 필요를 민감하게 읽고 조화로운 관계를 만드는 유형입니다. 협력과 소속감을 중시하며 공동체에 헌신합니다.',k:['협력','친절','조화','책임감']},
  ENFJ:{n:'정의로운 사회운동가',d:'사람들의 성장을 돕고 공동의 목표로 이끄는 카리스마 있는 멘토형입니다. 공감과 설득의 힘으로 변화를 만듭니다.',k:['카리스마','공감','성장 지원','설득력']},
  ENTJ:{n:'대담한 통솔자',d:'명확한 비전과 추진력으로 목표를 향해 조직을 이끄는 지도자형입니다. 도전적인 문제일수록 강한 에너지를 발휘합니다.',k:['통솔력','추진력','전략','자신감']},
};

/* ---------- 직업흥미유형 (Holland RIASEC) ---------- */
const RIASEC = {
  R:{n:'현실형',e:'Realistic',    c:'#5B7A99',d:'도구·기계를 다루는 구체적이고 실제적인 활동을 선호'},
  I:{n:'탐구형',e:'Investigative',c:'#1E5AF0',d:'분석적이고 호기심이 많아 연구와 탐험을 즐김'},
  A:{n:'예술형',e:'Artistic',     c:'#E0446A',d:'창의적이고 자유로운 표현과 개방된 환경을 선호'},
  S:{n:'사회형',e:'Social',       c:'#0FA47A',d:'사람들을 돕고 가르치는 역할에서 보람을 느낌'},
  E:{n:'기업형',e:'Enterprising', c:'#E8890C',d:'리더십과 영향력을 발휘해 목표 달성을 추구'},
  C:{n:'관습형',e:'Conventional', c:'#6C4CE0',d:'체계적이고 질서 정연한 정확한 작업을 선호'},
};

function renderHolland(h){
  const card=document.getElementById('rHollandCard');
  const code=String((h&&h['유형'])||'').toUpperCase().replace(/[^RIASEC]/g,'');
  if(!code){card.style.display='none';return;}
  card.style.display='';
  const rank={};
  [...code].forEach((ch,i)=>{if(!(ch in rank))rank[ch]=i+1;});
  document.getElementById('rHollandChip').innerHTML=
    `<span class="hc-code">${esc(code)}</span><span class="hc-name">${esc(h['유형명']||'')}</span>`;
  const names=[...code].map(ch=>RIASEC[ch]?RIASEC[ch].n:ch);
  document.getElementById('rHollandDesc').innerHTML=
    `시선행동 측정과 설문을 종합한 결과, 회원님의 직업 흥미는 <b>${names.map(esc).join(' → ')}</b> 순의 조합으로 나타났습니다. 아래 6가지 유형 중 강조된 카드가 회원님의 흥미 프로파일입니다.`;
  const rkStyle=['linear-gradient(135deg,#F2A93B,#E8890C)','linear-gradient(135deg,#8E9AB8,#6E7C9E)','linear-gradient(135deg,#CE9469,#B4744A)'];
  const rkLabel=['1순위 · 주흥미','2순위','3순위'];
  document.getElementById('rRiasec').innerHTML=[...'RIASEC'].map(ch=>{
    const t=RIASEC[ch],rk=rank[ch];
    return `
    <div class="ri-cell ${rk?'on':'off'}" style="--rc:${t.c}">
      ${rk&&rk<=3?`<span class="badge-rk" style="background:${rkStyle[rk-1]}">${rkLabel[rk-1]}</span>`:''}
      <div class="ric">${ch}</div>
      <div class="rin">${t.n}</div>
      <div class="rie">${t.e}</div>
      <div class="rid">${t.d}</div>
    </div>`;
  }).join('');
}

/* ---------- Big5 레이더 (NaN 가드 포함 버전으로 통일) ---------- */
function renderRadar(values){
  const size=300,cx=size/2,cy=size/2+6,R=104;
  const pt=(i,r)=>{const a=-Math.PI/2+i*2*Math.PI/5;return[cx+r*Math.cos(a),cy+r*Math.sin(a)];};
  const poly=r=>Array.from({length:5},(_,i)=>pt(i,r).map(v=>v.toFixed(1)).join(',')).join(' ');
  const valPoly=values.map((v,i)=>pt(i,R*Math.max(.04,v/100)).map(x=>x.toFixed(1)).join(',')).join(' ');
  let svg=`<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="radGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1E5AF0" stop-opacity=".55"/>
      <stop offset="55%" stop-color="#6C4CE0" stop-opacity=".45"/>
      <stop offset="100%" stop-color="#0FA47A" stop-opacity=".4"/>
    </linearGradient>
    <filter id="radShadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#1E5AF0" flood-opacity=".28"/>
    </filter>
  </defs>`;
  [1,.8,.6,.4,.2].forEach((f,idx)=>{svg+=`<polygon points="${poly(R*f)}" fill="${idx===0?'#F7FAFF':'none'}" stroke="#DCE5F7" stroke-width="1"/>`;});
  for(let i=0;i<5;i++){const[x,y]=pt(i,R);svg+=`<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#DCE5F7" stroke-width="1"/>`;}
  svg+=`<polygon points="${valPoly}" fill="url(#radGrad)" stroke="#4A5FE0" stroke-width="2.5" stroke-linejoin="round" filter="url(#radShadow)"/>`;
  values.forEach((v,i)=>{
    const[x,y]=pt(i,R*Math.max(.04,v/100));
    svg+=`<circle cx="${x}" cy="${y}" r="5" fill="${TRAITS[i].color}" stroke="#fff" stroke-width="2.5"/>`;
    const[lx,ly]=pt(i,R+26);
    svg+=`<text x="${lx}" y="${ly-4}" text-anchor="middle" font-family="Noto Sans KR" font-size="12.5" font-weight="700" fill="#0B1B3F">${TRAITS[i].key}</text>
          <text x="${lx}" y="${ly+11}" text-anchor="middle" font-family="Sora" font-size="11" font-weight="800" fill="${TRAITS[i].color}">${isNaN(v)?'-':v.toFixed(0)}</text>`;
  });
  svg+=`</svg>`;
  document.getElementById('rRadar').innerHTML=svg;
}

/* ---------- Big5 범례 (레이더 옆 막대 리스트) ---------- */
function renderBig5Legend(values){
  document.getElementById('rBig5').innerHTML=TRAITS.map((t,i)=>`
    <div class="rl-row">
      <span class="sw" style="background:${t.color}"></span>
      <label>${t.key}</label>
      <div class="mini"><i data-w="${values[i].toFixed(1)}%" style="background:${t.color}"></i></div>
      <span class="vv" style="color:${t.color}">${values[i].toFixed(1)}</span>
    </div>`).join('');
}

/* ---------- 직무적합도 (TOP3 포디움 + 4위 이하 리스트) ---------- */
function renderFit(jobs){
  const gaugeColors=['#1E5AF0','#6C4CE0','#0FA47A'];
  const rankLabels=['1위 · BEST FIT','2위','3위'];
  document.getElementById('rPodium').innerHTML=jobs.slice(0,3).map((j,i)=>{
    const delta=i===0?'나에게 가장 잘 맞는 직무':`1위와 <b>-${(jobs[0].score-j.score).toFixed(1)}점</b> 차이`;
    return `
    <div class="fitc f${i+1}" style="--gc:${gaugeColors[i]}">
      <span class="rank-chip">${rankLabels[i]}</span>
      <div class="gauge" data-gv="${Math.min(100,Math.max(0,j.score)).toFixed(1)}">
        <span class="gval">${j.score.toFixed(1)}<small>/ 100</small></span>
      </div>
      <div class="job">${esc(j.name)}</div>
      <div class="delta">${delta}</div>
    </div>`;
  }).join('');
  const rest=jobs.slice(3);
  const rMax=jobs.length?jobs[0].score:100, rMin=jobs.length?jobs[jobs.length-1].score:0;
  const span=Math.max(rMax-rMin,.001);
  const fillColor=s=>s>=rMax*.85?'linear-gradient(90deg,#1E5AF0,#4A7DFF)'
                 :s>=rMax*.7?'linear-gradient(90deg,#6C4CE0,#8E75EE)'
                 :'linear-gradient(90deg,#93A9E8,#B9C8F2)';
  document.getElementById('rJobs').innerHTML=rest.map((j,i)=>`
    <div class="jrow">
      <span class="rk">${i+4}위</span>
      <label title="${esc(j.name)}">${esc(j.name)}</label>
      <div class="track"><i class="fill" data-w="${(18+82*(j.score-rMin)/span).toFixed(1)}%" style="background:${fillColor(j.score)}"></i></div>
      <span class="sc">${j.score.toFixed(1)}</span>
    </div>`).join('');
}

/* ---------- 총평 상단 요약 태그: MBTI · Big5 TOP1 · 직무적합 TOP1 · 흥미유형 ---------- */
function renderSumTags(mbti,values,jobs,holland){
  const hiTrait=TRAITS[values.indexOf(Math.max(...values))];
  const sumTags=[];
  if(mbti) sumTags.push({lb:'MBTI',v:mbti,c:'#6C4CE0'});
  if(values.some(v=>v>0)) sumTags.push({lb:'BIG5 TOP1',v:hiTrait.key,c:'#1E5AF0'});
  if(jobs[0]) sumTags.push({lb:'직무적합 TOP1',v:jobs[0].name,c:'#0FA47A'});
  if(holland&&holland['유형']) sumTags.push({lb:'흥미유형',v:holland['유형']+(holland['유형명']?'·'+holland['유형명']:''),c:'#E8890C'});
  document.getElementById('rSumTags').innerHTML=sumTags.map(t=>
    `<span class="stag" style="--tc:${t.c}"><i>${t.lb}</i><b>${esc(t.v)}</b></span>`).join('');
}
