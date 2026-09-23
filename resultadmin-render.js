/* Administrator preview rendering. Keep changes here until the report is approved. */
function renderAdminHolland(h) {
  const code = String(h?.['유형'] || '').toUpperCase().replace(/[^RIASEC]/g, '');
  const card = document.getElementById('rHollandCard');
  if (!code) { card.style.display = 'none'; return; }
  card.style.display = '';
  const ranks = {};
  [...code].forEach((letter, index) => { if (!(letter in ranks)) ranks[letter] = index + 1; });
  document.getElementById('rHollandChip').innerHTML = `<span class="hc-code">${esc(code)}</span><span class="hc-name">${esc(h['유형명'] || '')}</span>`;
  document.getElementById('rHollandDesc').innerHTML = `시선행동 측정과 설문을 종합한 결과, 회원님의 직업 흥미는 <b>${[...code].map(letter => esc(RIASEC[letter]?.n || letter)).join(' → ')}</b> 순으로 나타났습니다. 색상과 크기로 1순위 흥미를 강조했습니다.`;
  const rankColors = ['#E8890C', '#7483A5', '#B47A53'];
  const orderedTypes = [...'RIASEC'].sort((a, b) => (ranks[a] || 9) - (ranks[b] || 9));
  document.getElementById('rRiasec').innerHTML = orderedTypes.map(letter => {
    const type = RIASEC[letter], rank = ranks[letter];
    return `<div class="ri-cell ${rank ? 'on' : 'off'} ${rank === 1 ? 'rank-one' : ''}" style="--rc:${type.c}">
      ${rank && rank <= 3 ? `<span class="badge-rk" style="background:${rankColors[rank - 1]}">${rank}순위${rank === 1 ? ' · 주흥미' : ''}</span>` : ''}
      <div class="ric">${letter}</div><div class="rin">${type.n}</div><div class="rie">${type.e}</div><div class="rid">${type.d}</div></div>`;
  }).join('');
}

function adminJobLinks(name) {
  const q = encodeURIComponent(name);
  const links = [
    ['고용24', `https://www.work24.go.kr/wk/a/b/1200/retriveDtlEmpSrchList.do?srcKeyword=${q}`],
    ['사람인', `https://www.saramin.co.kr/zf_user/search?searchword=${q}`],
    ['잡코리아', `https://www.jobkorea.co.kr/Search/?stext=${q}`],
  ];
  return `<div class="joblinks">${links.map(([label, url]) => `<a href="${url}" target="_blank" rel="noopener noreferrer nofollow" title="${esc(name)} 채용 검색 · ${label}">${label}</a>`).join('')}</div>`;
}

function renderAdminFit(jobs) {
  const colors = ['#1E5AF0', '#6C4CE0', '#0FA47A'];
  document.getElementById('rPodium').innerHTML = jobs.slice(0, 3).map((job, index) => `
    <div class="fitc f${index + 1}" style="--gc:${colors[index]}">
      <span class="rank-chip">${index + 1}순위${index === 0 ? ' · BEST FIT' : ''}</span>
      <div class="gauge" data-gv="${Math.min(100, Math.max(0, job.score)).toFixed(1)}"><span class="gval">${job.score.toFixed(1)}<small>/ 100</small></span></div>
      <span class="job">${esc(job.name)}</span><div class="delta">${index === 0 ? '나에게 가장 잘 맞는 직무' : `1순위와 <b>-${(jobs[0].score - job.score).toFixed(1)}점</b> 차이`}</div>
      ${adminJobLinks(job.name)}
    </div>`).join('');
  const rest = jobs.slice(3), high = jobs[0]?.score || 100, low = jobs.at(-1)?.score || 0;
  const spread = Math.max(high - low, .001);
  document.getElementById('rJobs').innerHTML = rest.map((job, index) => `
    <div class="jrow"><span class="rk">${index + 4}위</span><label title="${esc(job.name)}">${esc(job.name)}</label>
      <div class="track"><i class="fill" data-w="${(18 + 82 * (job.score - low) / spread).toFixed(1)}%" style="background:linear-gradient(90deg,#7290DD,#A8B9E9)"></i></div>
      <span class="sc">${job.score.toFixed(1)}</span></div>`).join('') +
    (jobs.length ? '<p class="jobs-note">상위 1~3위 직무의 배지를 누르면 각 채용 사이트에서 해당 직무를 검색합니다.</p>' : '');
}

function renderAdminSumTags(mbti, values, jobs, holland) {
  const best = TRAITS[values.indexOf(Math.max(...values))];
  const tags = [];
  if (mbti) tags.push(['16 Personalities', mbti, '#6C4CE0']);
  if (values.some(value => value > 0)) tags.push(['BIG5 TOP1', best.key, '#1E5AF0']);
  if (jobs[0]) tags.push(['직무적합 TOP1', jobs[0].name, '#0FA47A']);
  if (holland?.['유형']) tags.push(['흥미유형', holland['유형'] + (holland['유형명'] ? ' · ' + holland['유형명'] : ''), '#E8890C']);
  document.getElementById('rSumTags').innerHTML = tags.map(([label, value, color]) => `<span class="stag" style="--tc:${color}"><i>${label}</i><b>${esc(value)}</b></span>`).join('');
}

function renderAdminBig5Insight(values) {
  const ranking = TRAITS.map((trait, index) => ({ name: trait.key, value: values[index] })).sort((a, b) => b.value - a.value);
  document.getElementById('rBig5Insight').innerHTML = `<b>프로파일에서 읽히는 특징</b>가장 높은 요인은 <strong>${esc(ranking[0].name)} ${ranking[0].value.toFixed(0)}</strong>, 가장 낮은 요인은 <strong>${esc(ranking.at(-1).name)} ${ranking.at(-1).value.toFixed(0)}</strong>입니다. 다섯 요인을 함께 보며 자신의 평소 행동과 비교해 보세요.`;
}

async function renderAdminMbti(mbti) {
  const type = String(mbti || '').toUpperCase();
  const info = MBTI_DESC[type];
  const target = document.getElementById('rMbtiDetail');
  if (!info || !/^[EI][NS][TF][JP]$/.test(type)) {
    target.innerHTML = '<p>유효한 유형 결과가 없습니다.</p>';
    return;
  }
  document.getElementById('rMbtiChip').textContent = type;
  document.getElementById('rMbtiName').textContent = info.n;
  document.getElementById('rMbtiShort').textContent = info.d;
  document.getElementById('rMbtiKeywords').innerHTML = info.k.map(word => `<span>#${esc(word)}</span>`).join('');
  const dimensions = [
    type[0] === 'E' ? '사람과 교류하며 생각을 발전시키는 편' : '혼자 생각을 정리하며 에너지를 회복하는 편',
    type[1] === 'N' ? '가능성과 큰 흐름에 먼저 주목하는 편' : '구체적인 사실과 경험을 먼저 살피는 편',
    type[2] === 'T' ? '판단할 때 논리와 기준을 중시하는 편' : '판단할 때 관계와 가치를 함께 고려하는 편',
    type[3] === 'J' ? '계획과 결론이 분명할 때 편안한 편' : '선택지를 열어 두고 유연하게 움직이는 편',
  ];
  const fallback = `${info.d} ${dimensions[0]}이며 ${dimensions[1]}입니다. ${dimensions[2]}이고 ${dimensions[3]}입니다. ${info.k.slice(0, 2).join('·')} 같은 강점을 살릴 수 있는 환경을 탐색해 보세요. 이 유형은 성향을 이해하는 참고 자료이며, 개인의 능력이나 미래를 정해 주지는 않습니다.`;
  target.innerHTML = `<p>${esc(fallback)}</p><p class="source">유형별 기본 해설 · 상세 생성 중</p>`;
  try {
    const response = await fetch('/api/mbti-preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mbti: type }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!data.text || typeof data.text !== 'string') throw new Error('empty interpretation');
    target.replaceChildren();
    data.text.split(/\n\s*\n/).filter(Boolean).forEach(paragraph => {
      const p = document.createElement('p'); p.textContent = paragraph.trim(); target.appendChild(p);
    });
    const source = document.createElement('p'); source.className = 'source'; source.textContent = 'Neurolens Generated'; target.appendChild(source);
  } catch (error) {
    console.warn('MBTI 상세 해설 생성 실패:', error);
    target.querySelector('.source').textContent = '유형별 기본 해설 · 실시간 생성 연결을 확인해 주세요';
  }
}
