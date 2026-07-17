/* =========================================================================
 * NeuroLens Care — Phase 1 MVP (측정에서 실천으로)
 *  - 신호→루틴 정적 매핑 (측정 결과 연동 '처방')
 *  - 결과 페이지 처방 3종 카드
 *  - 카카오 알림톡 D1~D7 체크인 (웹 폼, 발송 백엔드는 Phase 1 이후 연동)
 *  - 마음 포인트 적립 / 출석(7일 여정) / 자비 스트릭
 *  - EARP 고위험 안전모드 (게이미피케이션 제거 + 전문 자원 우선)
 *
 * 사용: NLCare.render(containerEl, resultData|null, opts)
 *   opts = {
 *     storageKey : localStorage 키 (기본 'nlCareJourney')
 *     demo       : true면 시연용 데모 컨트롤 표시 (하루 이동/리셋/고위험 토글)
 *     onRemeasure: D7 재측정 버튼 콜백 (미지정 시 데모 재측정)
 *   }
 * ========================================================================= */
(function () {
'use strict';

/* ---------- 5분 케어 루틴 라이브러리 (근거 기반) ---------- */
var ROUTINES = {
  sigh: {
    icon:'🌬️', name:'주기적 한숨 호흡 90초', min:2, ev:'생리적 한숨 · Stanford 2023',
    desc:'날숨을 들숨의 2배로 길게 내쉬는 호흡으로 흥분된 신경계를 빠르게 진정시킵니다.',
    steps:['코로 짧게 두 번 들이마시기','입으로 길게(들숨의 2배) 내쉬기','같은 리듬으로 90초 반복'],
  },
  ground54321: {
    icon:'🖐️', name:'5-4-3-2-1 감각 그라운딩', min:3, ev:'감각 그라운딩 기법',
    desc:'지금 이 순간의 감각으로 주의를 되돌려 불안의 소용돌이에서 빠져나옵니다.',
    steps:['보이는 것 5가지 말하기','들리는 것 4가지 · 만져지는 것 3가지','냄새 2가지 · 맛 1가지 찾기'],
  },
  thoughtLabel: {
    icon:'🏷️', name:'생각 라벨링 + 걱정 시간 예약', min:5, ev:'ACT 인지적 탈융합 · 자극 통제',
    desc:'"나는 ~라는 생각을 하고 있다"로 생각과 거리를 두고, 걱정은 정해진 시간에만 합니다.',
    steps:['떠오르는 걱정을 "나는 ~라는 생각을 하고 있다"로 3회 쓰기','오늘 저녁 7시, 10분 "걱정 시간" 예약하기','걱정이 다시 오면 "예약해 뒀어"라고 말해주기'],
  },
  microBA: {
    icon:'⚡', name:'2분 마이크로 행동활성화', min:2, ev:'행동활성화(BA)',
    desc:'의욕은 행동 뒤에 옵니다. 가장 작은 다음 행동 1개를 정해 즉시 실행합니다.',
    steps:['미뤄둔 일에서 "2분이면 되는 가장 작은 조각" 1개 고르기','타이머 2분 켜고 바로 시작','끝나면 스스로에게 "시작했다"고 말해주기'],
  },
  connectMsg: {
    icon:'💌', name:'연결 마이크로 액션', min:3, ev:'사회적 처방',
    desc:'한 사람에게 안부 메시지 1통. 연결감은 가장 빠른 회복 자원입니다.',
    steps:['떠오르는 한 사람 고르기','"문득 생각나서 연락했어" 한 줄 보내기','답장이 없어도 보낸 것 자체가 완료'],
  },
  selfCompassion: {
    icon:'💚', name:'자기자비 브레이크', min:3, ev:'Neff 자기자비',
    desc:'자기비판의 순간, 나를 친구처럼 대하는 3문장을 소리 내어 읽습니다.',
    steps:['"지금 나는 힘든 순간에 있다"','"누구나 이런 순간을 겪는다"','"나 자신에게 친절하자" — 천천히 낭독'],
  },
  gratitude: {
    icon:'🙏', name:'감사 3가지 + 내일 기대 1가지', min:4, ev:'긍정심리학 · Seligman',
    desc:'안정된 지금의 상태를 더 단단하게 만드는 기록 루틴입니다.',
    steps:['오늘 감사한 것 3가지 적기','내일 기대되는 것 1가지 적기','잠들기 전 한 번 다시 읽기'],
  },
  /* 학생 트랙 */
  examAnxiety: {
    icon:'✍️', name:'시험 전 불안 쏟아내기 3분', min:3, ev:'Ramirez & Beilock · Science 2011',
    desc:'시험 직전 불안을 글로 쏟아내면 작업기억이 풀려 성적이 오르는 것이 검증된 기법입니다.',
    steps:['시험/과제 직전 종이를 꺼내기','지금 느끼는 걱정을 3분간 검열 없이 쓰기','다 쓴 종이는 접어서 치우기'],
  },
  focusReset: {
    icon:'👀', name:'수업 집중 리셋 (20-20-20)', min:2, ev:'시선 이완 · 주의 회복',
    desc:'45분 공부 후 20피트(6m) 밖을 20초 바라보고 2분 스탠딩 스트레칭으로 시선과 주의를 리셋합니다.',
    steps:['창밖 먼 곳을 20초 바라보기','일어서서 목·어깨 스트레칭 2분','물 한 모금 마시고 다시 시작'],
  },
  morningIfThen: {
    icon:'🌤️', name:'아침 감정 예보 + if-then 계획', min:3, ev:'실행의도(Implementation Intention)',
    desc:'오늘의 감정 날씨를 예보하고, 힘든 순간의 대응을 미리 한 문장으로 정해둡니다.',
    steps:['오늘 내 감정 날씨 고르기 (맑음/흐림/비…)','"만약 ~하면 → ~한다" 계획 1개 쓰기','예: "쉬는 시간에 짜증나면 → 물 마시러 간다"'],
  },
  /* 성인/감정노동 트랙 */
  roleOff: {
    icon:'🎭', name:'퇴근 전 역할 벗기 의식', min:4, ev:'표면행위 회복 · 감정노동 연구',
    desc:'오늘 억누른 감정 1개에 이름을 붙이고 한숨 호흡으로 "역할"을 벗고 퇴근합니다.',
    steps:['오늘 억누른 감정 1개 라벨링 ("나는 ~을 참았다")','한숨 호흡 5회 (날숨 길게)','"오늘의 역할은 여기까지" 선언하기'],
  },
  dmnWalk: {
    icon:'🚶', name:'점심 5분 디폴트모드 산책', min:5, ev:'주의회복이론(ART)',
    desc:'폰 없이 5분 걷기. 목적 없는 주의가 소진된 집중력을 회복시킵니다.',
    steps:['폰은 자리에 두고 나가기','5분간 천천히 걷기','눈에 들어오는 것들을 그냥 바라보기'],
  },
  boundary: {
    icon:'🛡️', name:'경계 설정 루틴', min:4, ev:'자기주장 훈련',
    desc:'오늘 거절하지 못한 것 1개를 기록하고, 다음번에 쓸 대안 문장을 만들어 둡니다.',
    steps:['오늘 거절하지 못한 것 1개 적기','"~는 어렵지만 ~는 가능해요" 대안 문장 만들기','소리 내어 한 번 연습하기'],
  },
};

var TRACK_FILL = {
  student: ['examAnxiety','focusReset','morningIfThen'],
  adult:   ['roleOff','dmnWalk','boundary'],
};

/* ---------- 신호 → 루틴 정적 매핑 ---------- */
function pct(b, key) {
  var v = parseFloat(b && b[key + '_백분위']);
  return isNaN(v) ? null : Math.min(100, Math.max(0, v));
}
function detectEarp(r) {
  if (!r) return null;
  var cand = r.EARP || r.earp || r['정서적어려움가능성'] || r['정서신호'];
  if (cand == null) return null;
  if (typeof cand === 'object') cand = cand['수준'] || cand.level || cand['점수'] || cand.score;
  var n = parseFloat(cand);
  if (!isNaN(n)) return n; // 백분위/점수
  var s = String(cand);
  if (/높|high|위험/i.test(s)) return 85;
  if (/중간|mid/i.test(s)) return 55;
  return 20;
}
/* 결과 r → { track, signals, rx:[3개], rxWhy:{id:{badge,why}}, highRisk } */
function mapSignals(r) {
  var b = (r && r.BIG5) || {};
  var p = (r && r['시험자정보']) || {};
  var age = String(p['연령대'] || '');
  var track = /^1|10대|청소년|학생/.test(age) ? 'student' : 'adult';
  var N = pct(b, '신경성'), C = pct(b, '성실성'), E = pct(b, '외향성');
  var earp = detectEarp(r);
  var signals = [], rx = [], rxWhy = {};

  function add(badge, why, ids) {
    signals.push({ badge: badge, why: why });
    ids.forEach(function (id) {
      if (rx.indexOf(id) < 0) { rx.push(id); rxWhy[id] = { badge: badge, why: why }; }
    });
  }
  if (earp != null && earp >= 70)
    add('정서 신호(EARP) 높음', '시선행동에서 정서적 어려움 신호가 높게 관찰되어, 신경계를 빠르게 진정시키는 루틴을 처방했어요.', ['sigh','ground54321']);
  if (N != null && N >= 65)
    add('신경성 높음 (백분위 ' + N.toFixed(0) + ')', '걱정이 반복되기 쉬운 프로파일이라, 생각과 거리를 두는 루틴을 처방했어요.', ['thoughtLabel']);
  if (N != null && N >= 75)
    add('자기비판 신호', '스스로에게 엄격해지기 쉬운 상태라, 나를 친구처럼 대하는 루틴을 더했어요.', ['selfCompassion']);
  if (C != null && C <= 50)
    add('성실성 낮음 (백분위 ' + C.toFixed(0) + ')', '실행 에너지가 낮게 측정되어, 가장 작은 행동부터 시작하는 루틴을 처방했어요.', ['microBA']);
  if (E != null && E <= 40)
    add('외향성 낮음 (백분위 ' + E.toFixed(0) + ')', '고립감이 쌓이기 쉬운 시기라, 부담 없는 연결 루틴을 처방했어요.', ['connectMsg']);
  if (signals.length === 0)
    add('안정 상태', '전반적으로 안정적인 신호예요. 지금의 상태를 더 단단하게 만드는 루틴을 처방했어요.', ['gratitude']);
  else if (rx.length < 3 && rx.indexOf('gratitude') < 0) {
    rx.push('gratitude');
    rxWhy.gratitude = { badge: '컨디션 다지기', why: '신호 케어와 함께, 오늘의 안정적인 부분을 더 단단하게 만들어주는 보완 루틴이에요.' };
  }

  var trackBadge = track === 'student' ? '학생 트랙 추천' : '직장인 트랙 추천';
  var trackWhy = track === 'student'
    ? '학생 생활 리듬(수업·시험)에 맞춰 함께 처방되는 트랙 루틴이에요.'
    : '일과 감정노동에서 회복하는 데 효과적인 트랙 루틴이에요.';
  TRACK_FILL[track].forEach(function (id) {
    if (rx.length < 3 && rx.indexOf(id) < 0) { rx.push(id); rxWhy[id] = { badge: trackBadge, why: trackWhy }; }
  });
  rx = rx.slice(0, 3);
  return { track: track, signals: signals, rx: rx, rxWhy: rxWhy, highRisk: earp != null && earp >= 85 };
}

/* ---------- 마음 컨디션 지수 (condIndex) ----------
 * 기준선(trait): 웰빙 메타분석 가중치 — 정서안정(100-N) 중심, 개방성 제외.
 * 오늘 상태(state): 체크인 에너지 60% + 이모지 정서가 40% + 루틴 보너스.
 * 오늘 지수 = 기준선 50% + 오늘 상태 50% (체크인 전엔 기준선만 표시)
 * ※ 검증된 심리척도가 아닌 비진단 참고 지표. */
var EMOJI_VAL = { '😄':90, '🙂':75, '😐':50, '😟':35, '😢':25, '😠':30, '😴':40 };

function computeBaseline(r) {
  var b = (r && r.BIG5) || {};
  var N = pct(b,'신경성'), E = pct(b,'외향성'), C = pct(b,'성실성'), A = pct(b,'친화성');
  if (N == null || E == null || C == null || A == null) return null;
  var earp = detectEarp(r);
  var stab = 100 - N, score;
  if (earp != null) score = .35*stab + .25*(100-earp) + .15*E + .125*C + .125*A;
  else              score = .50*stab + .20*E  + .15*C  + .15*A;
  return { score: Math.round(score), stab: Math.round(stab), earp: earp == null ? null : Math.round(earp) };
}

function stateScore(ck) {
  if (!ck || ck.energy == null) return null;
  var val = EMOJI_VAL[ck.emoji] != null ? EMOJI_VAL[ck.emoji] : 50;
  var bonus = Math.min(6, (ck.routines ? ck.routines.length : 0) * 3);
  return Math.round(Math.min(100, .6*ck.energy + .4*val + bonus));
}

function condIndex(s) {
  if (!s || !s.base) return null;
  var d = curDay(s);
  var ck = (d >= 1 && d <= 6) ? s.checkins[d] : null;
  var st = stateScore(ck);
  return {
    today: st == null ? s.base.score : Math.round(.5*s.base.score + .5*st),
    base: s.base.score, state: st, day: d, checked: st != null,
  };
}

/* D0(기준선) + 체크인 있는 날의 지수 시계열 */
function trendSeries(s) {
  if (!s.base) return [];
  var pts = [{ d: 0, v: s.base.score }];
  for (var i = 1; i <= 6; i++) {
    var st = stateScore(s.checkins[i]);
    if (st != null) pts.push({ d: i, v: Math.round(.5*s.base.score + .5*st) });
  }
  return pts;
}

/* ---------- 상태 (localStorage) ---------- */
var KEY = 'nlCareJourney';
function blankState() {
  return { v:1, startedAt:null, track:'adult', name:'', signals:[], rx:[],
    rxWhy:{}, base:null, channel:null, checkins:{}, routineDone:{}, points:0, ledger:[],
    leavesUsed:{ month:'', n:0 }, remeasured:false, highRisk:false, demoOffset:0 };
}
function load(key) {
  try {
    var s = JSON.parse(localStorage.getItem(key));
    if (s && s.v === 1) return s;
  } catch (_) {}
  return blankState();
}
function save(key, s) { try { localStorage.setItem(key, JSON.stringify(s)); } catch (_) {} }

function dstr(d) {
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function today(s) { // demoOffset 반영한 "오늘"
  var d = new Date();
  d.setDate(d.getDate() + (s.demoOffset || 0));
  return d;
}
function curDay(s) { // D0~ (여정 시작 전 = -1)
  if (!s.startedAt) return -1;
  var t0 = new Date(s.startedAt + 'T00:00:00');
  var diff = Math.floor((today(s).setHours(0,0,0,0) - t0.getTime()) / 86400000);
  return Math.max(0, diff);
}
function addPoints(s, label, delta) {
  if (s.highRisk) return; // 안전모드: 게이미피케이션 중지
  s.points += delta;
  s.ledger.unshift({ t: Date.now(), label: label, delta: delta });
  if (s.ledger.length > 30) s.ledger.length = 30;
}

/* 자비 스트릭: D1~어제까지 미기록일은 잎사귀(월 2회)로 자동 커버 */
function attendance(s) {
  var d = curDay(s), out = [], leafBudget = 2, month = dstr(today(s)).slice(0,7);
  if (s.leavesUsed.month !== month) { s.leavesUsed = { month: month, n: 0 }; }
  var leavesLeft = leafBudget - s.leavesUsed.n, streak = 0;
  for (var i = 1; i <= 6; i++) {
    var st;
    if (d < 0 || i > d) st = 'upcoming';
    else if (s.checkins[i]) st = 'done';
    else if (i === d) st = 'today';
    else if (leavesLeft > 0) { st = 'leaf'; leavesLeft--; }
    else st = 'rest';
    out.push(st);
  }
  for (var j = out.length - 1; j >= 0; j--) {
    if (out[j] === 'upcoming' || out[j] === 'today') continue;
    if (out[j] === 'done' || out[j] === 'leaf') streak++; else break;
  }
  var leavesUsedNow = (leafBudget - s.leavesUsed.n) - leavesLeft;
  return { days: out, streak: streak, leavesLeft: leavesLeft, leavesUsedNow: leavesUsedNow };
}

/* ---------- 스타일 ---------- */
var CSS = '\
.nlc{--c-ink:var(--ink,#0B1B3F);--c-ink2:var(--ink2,#2A3651);--c-gray:var(--gray,#5B6478);--c-gray2:var(--gray2,#8A93A8);--c-line:var(--line,#E4E9F4);--c-blue:var(--blue,#1E5AF0);--c-bsoft:var(--blue-soft,#EEF3FF);--c-bline:var(--blue-line,#C9D8FF);--c-green:var(--green,#0FA47A);--c-gsoft:var(--green-soft,#EAF7F2);--c-violet:var(--violet,#6C4CE0);--c-vsoft:var(--violet-soft,#F1EDFD);--c-amber:var(--amber,#E8890C);--c-rose:var(--rose,#E0446A);font-family:var(--font-kr,"Noto Sans KR",sans-serif);color:var(--c-ink)}\
.nlc *{box-sizing:border-box}\
.nlc .ncard{background:#fff;border:1px solid var(--c-line);border-radius:20px;padding:28px 32px;margin-bottom:20px;box-shadow:0 2px 10px rgba(11,27,63,.05)}\
@media(max-width:600px){.nlc .ncard{padding:22px 18px}}\
.nlc .ncard>h3{font-size:12px;font-family:var(--font-num,Sora,sans-serif);font-weight:700;letter-spacing:.12em;color:var(--c-blue);margin:0 0 18px;text-transform:uppercase;display:flex;align-items:center;gap:8px;flex-wrap:wrap}\
.nlc .ncard>h3::before{content:"";width:16px;height:2px;background:linear-gradient(135deg,#1E5AF0,#4A7DFF);border-radius:2px}\
.nlc .wellness-tag{font-size:9.5px;font-weight:800;letter-spacing:.1em;color:var(--c-green);background:var(--c-gsoft);border:1px solid #BFE8D9;border-radius:10px;padding:2px 10px}\
.nlc .live-tag{font-size:9.5px;font-weight:800;letter-spacing:.1em;color:#fff;background:linear-gradient(135deg,#0FA47A,#3EC49E);border-radius:10px;padding:2px 10px}\
/* 오늘의 컨디션 지수 */\
.nlc .cond-flex{display:flex;gap:26px;align-items:center;flex-wrap:wrap}\
.nlc .cond-ring{--cv:0;position:relative;width:116px;height:116px;border-radius:50%;background:conic-gradient(#1E5AF0,#6C4CE0 calc(var(--cv)*1%),#EBF0FA 0);display:grid;place-items:center;flex:none;transition:--cv 1.2s cubic-bezier(.2,.7,.2,1)}\
.nlc .cond-ring::before{content:"";position:absolute;inset:10px;background:#fff;border-radius:50%;box-shadow:inset 0 2px 6px rgba(11,27,63,.06)}\
.nlc .cond-ring .cv{position:relative;font-family:var(--font-num,Sora,sans-serif);font-weight:800;font-size:31px;color:var(--c-blue);line-height:1;text-align:center}\
.nlc .cond-ring .cv small{display:block;font-size:9px;font-weight:600;color:var(--c-gray2);letter-spacing:.08em;margin-top:3px}\
.nlc .cond-info{flex:1;min-width:230px}\
.nlc .cond-sent{font-size:13.5px;color:var(--c-ink2);line-height:1.75}\
.nlc .cond-chips{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px;align-items:center}\
.nlc .cond-chips span{font-size:11px;font-weight:700;color:var(--c-gray);background:#F4F7FD;border:1px solid var(--c-line);border-radius:11px;padding:4px 11px}\
.nlc .cond-chips span.up{color:var(--c-green);background:var(--c-gsoft);border-color:#BFE8D9}\
.nlc .cond-chips span.dn{color:var(--c-rose);background:#FDF0F3;border-color:#F2C9D4}\
.nlc .spark{margin-top:18px;border-top:1px dashed var(--c-line);padding-top:14px}\
.nlc .spark svg{width:100%;max-width:520px;height:auto;display:block;margin:0 auto}\
.nlc .spark-note{font-size:11px;color:var(--c-gray2);text-align:center;margin-top:6px}\
/* 처방 카드 */\
.nlc .rx-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}\
@media(max-width:680px){.nlc .rx-grid{grid-template-columns:1fr}}\
.nlc .rx{border:1px solid var(--c-line);border-radius:16px;padding:18px 16px 14px;background:#F8FAFE;display:flex;flex-direction:column;gap:10px;position:relative;transition:border-color .2s,transform .2s}\
.nlc .rx:hover{border-color:var(--c-bline);transform:translateY(-2px)}\
.nlc .rx.done{background:var(--c-gsoft);border-color:#BFE8D9}\
.nlc .rx .sig{display:inline-flex;align-self:flex-start;font-size:10.5px;font-weight:800;color:var(--c-violet);background:var(--c-vsoft);border-radius:10px;padding:3px 10px;letter-spacing:.02em}\
.nlc .rx .ttl{display:flex;gap:10px;align-items:flex-start}\
.nlc .rx .ttl .ic{font-size:24px;line-height:1.2;flex:none}\
.nlc .rx .ttl b{font-size:14.5px;font-weight:800;line-height:1.45}\
.nlc .rx .meta{display:flex;gap:6px;flex-wrap:wrap}\
.nlc .rx .meta span{font-size:10.5px;font-weight:700;color:var(--c-gray);background:#fff;border:1px solid var(--c-line);border-radius:9px;padding:2px 8px}\
.nlc .rx .why{font-size:12px;color:var(--c-gray);line-height:1.6;flex:1}\
.nlc .rx details{font-size:12px;color:var(--c-ink2)}\
.nlc .rx details summary{cursor:pointer;font-weight:700;color:var(--c-blue);font-size:12px;list-style:none}\
.nlc .rx details summary::before{content:"▸ "}.nlc .rx details[open] summary::before{content:"▾ "}\
.nlc .rx ol{margin:8px 0 0;padding-left:18px}.nlc .rx ol li{margin-bottom:4px;line-height:1.55}\
.nlc .rx .doit{width:100%;font-family:inherit;font-size:13px;font-weight:800;color:var(--c-blue);background:var(--c-bsoft);border:1px solid var(--c-bline);border-radius:11px;padding:10px 0;cursor:pointer;transition:all .15s}\
.nlc .rx .doit:hover{background:#E2EBFF}\
.nlc .rx .doit.ok{color:var(--c-green);background:#fff;border-color:#BFE8D9;cursor:default}\
/* 여정 스트립 */\
.nlc .journey{display:flex;gap:6px;align-items:flex-start;justify-content:space-between;margin:6px 0 14px}\
.nlc .jd{flex:1;text-align:center;min-width:0}\
.nlc .jd .dot{width:34px;height:34px;margin:0 auto 6px;border-radius:50%;display:grid;place-items:center;font-size:14px;font-weight:800;background:#F1F4FB;border:2px solid var(--c-line);color:var(--c-gray2)}\
.nlc .jd.done .dot{background:linear-gradient(135deg,#1E5AF0,#4A7DFF);border-color:transparent;color:#fff}\
.nlc .jd.leaf .dot{background:var(--c-gsoft);border-color:#BFE8D9}\
.nlc .jd.today .dot{border-color:var(--c-blue);color:var(--c-blue);background:#fff;box-shadow:0 0 0 4px rgba(30,90,240,.15);animation:nlcPulse 1.8s ease-in-out infinite}\
@keyframes nlcPulse{0%,100%{box-shadow:0 0 0 4px rgba(30,90,240,.15)}50%{box-shadow:0 0 0 7px rgba(30,90,240,.07)}}\
.nlc .jd .lb{font-size:10px;font-weight:700;color:var(--c-gray2);font-family:var(--font-num,Sora,sans-serif);white-space:nowrap}\
.nlc .jd.today .lb{color:var(--c-blue)}\
.nlc .streak-line{display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:12.5px;color:var(--c-gray);background:#F8FAFE;border:1px dashed var(--c-line);border-radius:12px;padding:10px 14px}\
.nlc .streak-line b{color:var(--c-green)}\
/* 체크인 폼 */\
.nlc .emoji-row{display:flex;gap:8px;flex-wrap:wrap;margin:4px 0 16px}\
.nlc .emo{font-size:24px;width:48px;height:48px;border-radius:14px;border:2px solid var(--c-line);background:#fff;cursor:pointer;transition:all .15s;display:grid;place-items:center;padding:0}\
.nlc .emo:hover{transform:translateY(-2px)}\
.nlc .emo.sel{border-color:var(--c-blue);background:var(--c-bsoft);box-shadow:0 4px 12px rgba(30,90,240,.18)}\
.nlc .fld-label{font-size:13px;font-weight:800;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center}\
.nlc .fld-label small{font-weight:600;color:var(--c-gray2);font-size:11px}\
.nlc input[type=range]{width:100%;accent-color:var(--c-blue);margin:2px 0 4px}\
.nlc .energy-scale{display:flex;justify-content:space-between;font-size:10.5px;color:var(--c-gray2);margin-bottom:14px}\
.nlc .chk-routines{display:flex;flex-direction:column;gap:8px;margin-bottom:16px}\
.nlc .chk-routines label{display:flex;gap:10px;align-items:center;font-size:13px;font-weight:600;background:#F8FAFE;border:1px solid var(--c-line);border-radius:11px;padding:10px 12px;cursor:pointer}\
.nlc .chk-routines input{width:17px;height:17px;accent-color:var(--c-green)}\
.nlc .btn-main2{display:inline-flex;align-items:center;justify-content:center;gap:8px;width:100%;font-family:inherit;font-size:15px;font-weight:800;color:#fff;background:linear-gradient(135deg,#1E5AF0 0%,#6C4CE0 100%);border:none;border-radius:13px;padding:14px 0;cursor:pointer;box-shadow:0 10px 24px rgba(60,80,230,.28);transition:transform .15s}\
.nlc .btn-main2:hover{transform:translateY(-2px)}\
.nlc .btn-main2:disabled{opacity:.5;cursor:not-allowed;transform:none}\
.nlc .btn-line{display:inline-flex;align-items:center;justify-content:center;gap:7px;font-family:inherit;font-size:12.5px;font-weight:700;color:var(--c-gray);background:#fff;border:1px solid var(--c-line);border-radius:20px;padding:8px 16px;cursor:pointer;transition:all .15s}\
.nlc .btn-line:hover{color:var(--c-blue);border-color:var(--c-bline);background:var(--c-bsoft)}\
/* 알림톡 등록 폼 */\
.nlc .kko-form{display:grid;grid-template-columns:1fr 1fr;gap:12px}\
@media(max-width:600px){.nlc .kko-form{grid-template-columns:1fr}}\
.nlc .kko-form .full{grid-column:1/-1}\
.nlc .kko-form input[type=tel],.nlc .kko-form select{width:100%;font-family:inherit;font-size:14px;padding:11px 14px;border:1px solid var(--c-line);border-radius:11px;background:#fff;color:var(--c-ink)}\
.nlc .kko-form input:focus,.nlc .kko-form select:focus{outline:2px solid var(--c-bline)}\
.nlc .consents{display:flex;flex-direction:column;gap:7px}\
.nlc .consents label{display:flex;gap:9px;align-items:flex-start;font-size:12.5px;color:var(--c-ink2);cursor:pointer;line-height:1.5}\
.nlc .consents input{width:16px;height:16px;margin-top:2px;accent-color:var(--c-blue)}\
.nlc .kko-preview{background:#FDF7E3;border:1px solid #F3E2AD;border-radius:14px;padding:14px 16px;font-size:12.5px;line-height:1.7;color:#5C4A12}\
.nlc .kko-preview b{display:block;margin-bottom:2px}\
.nlc .kko-done{display:flex;gap:12px;align-items:center;background:var(--c-gsoft);border:1px solid #BFE8D9;border-radius:14px;padding:14px 16px;font-size:13px;font-weight:600;color:var(--c-ink2)}\
.nlc .kko-done .ic{font-size:22px}\
/* 포인트 */\
.nlc .pt-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:12px}\
.nlc .pt-head .bal{font-family:var(--font-num,Sora,sans-serif);font-size:32px;font-weight:800;color:var(--c-violet)}\
.nlc .pt-head .bal small{font-size:14px}\
.nlc .pt-rules{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}\
.nlc .pt-rules span{font-size:11px;font-weight:700;color:var(--c-gray);background:#F4F7FD;border:1px solid var(--c-line);border-radius:11px;padding:4px 11px}\
.nlc .pt-log{list-style:none;margin:0 0 14px;padding:0;font-size:12.5px}\
.nlc .pt-log li{display:flex;justify-content:space-between;gap:10px;padding:7px 2px;border-top:1px dashed var(--c-line);color:var(--c-ink2)}\
.nlc .pt-log li b{color:var(--c-violet);font-family:var(--font-num,Sora,sans-serif);flex:none}\
.nlc .pt-ex{display:flex;gap:8px;flex-wrap:wrap}\
/* 인사이트/부스터 */\
.nlc .insight{display:flex;gap:12px;align-items:flex-start;background:linear-gradient(135deg,#F6F8FF,#FBF9FF);border:1px solid var(--c-bline);border-radius:14px;padding:14px 16px;font-size:13px;line-height:1.65;color:var(--c-ink2);margin-top:14px}\
.nlc .insight .ic{font-size:20px;flex:none}\
/* D7 */\
.nlc .delta-box{display:flex;gap:20px;align-items:center;flex-wrap:wrap;margin-top:6px}\
.nlc .delta-num{font-family:var(--font-num,Sora,sans-serif);font-size:36px;font-weight:800;color:var(--c-blue)}\
.nlc .delta-num small{font-size:13px;color:var(--c-green);font-weight:700;margin-left:6px}\
.nlc .paywall{margin-top:14px;border:1px dashed #C9D2E6;border-radius:14px;padding:14px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;justify-content:space-between;background:#FAFBFF}\
.nlc .paywall .tx{font-size:12.5px;color:var(--c-gray);line-height:1.6}\
.nlc .paywall .tx b{color:var(--c-ink);display:block;font-size:13.5px}\
.nlc .btn-violet{display:inline-flex;align-items:center;gap:8px;font-family:inherit;font-size:13.5px;font-weight:800;color:#fff;background:linear-gradient(135deg,#6C4CE0,#8E75EE);border:none;border-radius:12px;padding:11px 22px;cursor:pointer;box-shadow:0 8px 20px rgba(108,76,224,.3)}\
/* 안전모드 */\
.nlc .safety{background:linear-gradient(135deg,#FFF9F5,#FFF4F1);border:1.5px solid #F5C9B8;border-radius:20px;padding:26px 30px;margin-bottom:20px}\
.nlc .safety h4{font-size:16px;font-weight:900;margin:0 0 8px;color:#B4441F}\
.nlc .safety p{font-size:13.5px;color:#7A4A35;line-height:1.75;margin:0 0 14px}\
.nlc .safety .lines{display:flex;gap:10px;flex-wrap:wrap}\
.nlc .safety .lines a{display:inline-flex;flex-direction:column;gap:2px;text-decoration:none;background:#fff;border:1px solid #F0D5C9;border-radius:13px;padding:10px 18px;color:#B4441F;font-weight:800;font-size:14px}\
.nlc .safety .lines a small{font-size:11px;font-weight:600;color:#A3705C}\
/* 데모 바 & 토스트 & 공통 */\
.nlc .demo-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;border:1px dashed #F3DCB5;background:#FDF8EC;border-radius:14px;padding:10px 14px;margin-bottom:16px;font-size:11.5px;color:#8A6A1F}\
.nlc .demo-bar b{font-family:var(--font-num,Sora,sans-serif);letter-spacing:.08em;font-size:10px}\
.nlc .demo-bar button{font-family:inherit;font-size:11.5px;font-weight:700;border:1px solid #EBD9A8;background:#fff;color:#8A6A1F;border-radius:9px;padding:5px 12px;cursor:pointer}\
.nlc .disc{font-size:11.5px;color:var(--c-gray2);margin-top:10px;line-height:1.6}\
.nlc .nlc-toast{position:fixed;left:50%;bottom:30px;transform:translateX(-50%) translateY(20px);background:#0B1B3F;color:#fff;font-size:13.5px;font-weight:600;border-radius:14px;padding:13px 24px;box-shadow:0 14px 34px rgba(11,27,63,.35);opacity:0;pointer-events:none;transition:opacity .3s,transform .3s;z-index:9999;white-space:nowrap}\
.nlc .nlc-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}\
';

/* ---------- 유틸 ---------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
  });
}
var EMOJIS = ['😄','🙂','😐','😟','😢','😠','😴'];

/* ---------- 렌더러 ---------- */
function Care(container, result, opts) {
  this.el = container;
  this.opts = opts || {};
  this.key = this.opts.storageKey || KEY;
  this.state = load(this.key);

  if (result) { // 새 결과 수신 → 신호 매핑 갱신 (여정 진행 중이면 처방은 유지)
    var m = mapSignals(result);
    var s = this.state;
    s.name = (result['시험자정보'] || {})['시험자명'] || s.name || '';
    s.track = m.track;
    if (!s.startedAt || !s.rx.length) { s.signals = m.signals; s.rx = m.rx; s.rxWhy = m.rxWhy; }
    s.base = computeBaseline(result) || s.base;
    s.highRisk = m.highRisk;
    save(this.key, s);
  }
  if (!document.getElementById('nlcStyle')) {
    var st = document.createElement('style');
    st.id = 'nlcStyle'; st.textContent = CSS;
    document.head.appendChild(st);
  }
  this.bind();
  this.paint();
}

Care.prototype.save = function () { save(this.key, this.state); };

Care.prototype.toast = function (msg) {
  var t = this.el.querySelector('.nlc-toast');
  if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(this._tt);
  this._tt = setTimeout(function () { t.classList.remove('show'); }, 2400);
};

/* ----- 부분 HTML ----- */
Care.prototype.htmlDemoBar = function () {
  if (!this.opts.demo) return '';
  var s = this.state;
  return '<div class="demo-bar"><b>DEMO 컨트롤 · 시연용</b>'
    + '<button data-act="demo-next">하루 이동 (지금 D' + Math.max(0, curDay(s)) + (s.startedAt ? '' : ' 시작 전') + ')</button>'
    + '<button data-act="demo-risk">' + (s.highRisk ? '안전모드 해제' : '고위험 안전모드 보기') + '</button>'
    + '<button data-act="demo-reset">여정 리셋</button></div>';
};

Care.prototype.htmlSafety = function () {
  return '<div class="safety">'
    + '<h4>지금은 루틴보다, 곁의 도움이 먼저예요</h4>'
    + '<p>이번 측정에서 정서적 어려움 신호가 높게 관찰되었습니다. 혼자 견디지 않아도 됩니다. '
    + '아래 창구는 24시간 열려 있고, 원하시면 전문 상담 연계를 도와드릴게요. '
    + '(본 결과는 의료적 진단이 아닌 참고 신호입니다)</p>'
    + '<div class="lines">'
    + '<a href="tel:1393">자살예방상담 1393<small>24시간 · 무료</small></a>'
    + '<a href="tel:1577-0199">정신건강위기상담 1577-0199<small>24시간</small></a>'
    + '<a href="tel:1388">청소년 상담 1388<small>24시간</small></a>'
    + '<a href="#" data-act="counsel">전문가 상담 연결 요청 →<small>NeuroLens 연계</small></a>'
    + '</div></div>';
};

/* 오늘의 마음 컨디션 지수 카드 (① 상단 카드 + ③ 7일 추세) */
Care.prototype.htmlIndex = function () {
  var s = this.state;
  if (s.highRisk || !s.base) return '';
  var ci = condIndex(s);
  var d = ci.day;
  var ck = ci.checked ? s.checkins[d] : null;

  var sent;
  if (ci.checked)
    sent = '기준선 <b>' + ci.base + '점</b>에 오늘 체크인(에너지 ' + ck.energy + ' · ' + ck.emoji + ')을 반영한 오늘의 지수예요.';
  else if (d >= 1 && d <= 6)
    sent = '아직 오늘 체크인 전이라 <b>기준선 값</b>이에요. 30초 체크인이 반영되면 바로 갱신돼요.';
  else
    sent = '이번 측정(Big5' + (s.base.earp != null ? '·EARP' : '') + ')로 계산한 나의 <b>마음 컨디션 기준선</b>이에요. 7일 여정 동안 매일 체크인으로 갱신돼요.';

  var pts = trendSeries(s);
  var deltaChip = '';
  if (pts.length >= 2) {
    var diff = pts[pts.length - 1].v - pts[pts.length - 2].v;
    deltaChip = diff === 0 ? '<span>직전 기록과 같음</span>'
      : '<span class="' + (diff > 0 ? 'up' : 'dn') + '">' + (diff > 0 ? '▲ +' : '▼ ') + diff + ' 직전 기록 대비</span>';
  }
  var cta = (!ci.checked && d >= 1 && d <= 6)
    ? '<button class="btn-line" data-act="goto-checkin">✍ 30초 체크인 하러 가기</button>' : '';

  return '<div class="ncard"><h3>Today · 오늘의 마음 컨디션 <span class="wellness-tag">비진단 참고 지표</span></h3>'
    + '<div class="cond-flex">'
    + '<div class="cond-ring" data-cv="' + ci.today + '"><span class="cv">' + ci.today + '<small>/ 100</small></span></div>'
    + '<div class="cond-info"><div class="cond-sent">' + sent + '</div>'
    + '<div class="cond-chips"><span>기준선 ' + ci.base + '</span><span>오늘 상태 ' + (ci.state == null ? '—' : ci.state) + '</span>' + deltaChip + cta + '</div>'
    + '</div></div>'
    + this.htmlSpark(pts, d)
    + '</div>';
};

/* 7일 추세 스파크라인 (D0 기준선 → 체크인 지수) */
Care.prototype.htmlSpark = function (pts, d) {
  var W = 340, X0 = 24, XS = (W - 2 * X0) / 7;
  var xi = function (day) { return X0 + day * XS; };
  var yi = function (v) { return 76 - v * .56; };
  var line = '', area = '', dots = '', labels = '';
  if (pts.length >= 2) {
    var path = pts.map(function (p, i) { return (i ? 'L' : 'M') + xi(p.d).toFixed(1) + ' ' + yi(p.v).toFixed(1); }).join(' ');
    area = '<path d="' + path + ' L' + xi(pts[pts.length - 1].d).toFixed(1) + ' 76 L' + xi(pts[0].d).toFixed(1) + ' 76 Z" fill="url(#nlcTG)"/>';
    line = '<path d="' + path + '" fill="none" stroke="#1E5AF0" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';
  }
  pts.forEach(function (p, i) {
    var last = i === pts.length - 1;
    dots += '<circle cx="' + xi(p.d).toFixed(1) + '" cy="' + yi(p.v).toFixed(1) + '" r="' + (last ? 5.5 : 4) + '" fill="' + (last ? '#1E5AF0' : '#93A9E8') + '" stroke="#fff" stroke-width="2"/>'
         +  '<text x="' + xi(p.d).toFixed(1) + '" y="' + (yi(p.v) - 10).toFixed(1) + '" text-anchor="middle" font-family="Sora" font-size="10" font-weight="' + (last ? '800' : '700') + '" fill="' + (last ? '#1E5AF0' : '#8A93A8') + '">' + p.v + '</text>';
  });
  for (var i = 0; i <= 7; i++) {
    var isToday = d >= 0 && Math.min(d, 7) === i;
    labels += '<text x="' + xi(i).toFixed(1) + '" y="93" text-anchor="middle" font-family="Sora" font-size="9.5" font-weight="' + (isToday ? '800' : '600') + '" fill="' + (isToday ? '#1E5AF0' : '#B7C0D4') + '">D' + i + '</text>';
  }
  var note = pts.length < 2 ? '<div class="spark-note">체크인이 쌓일수록 7일 추세선이 그려져요</div>' : '';
  return '<div class="spark"><svg viewBox="0 0 ' + W + ' 99" xmlns="http://www.w3.org/2000/svg">'
    + '<defs><linearGradient id="nlcTG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#1E5AF0" stop-opacity=".22"/><stop offset="100%" stop-color="#1E5AF0" stop-opacity="0"/></linearGradient></defs>'
    + '<line x1="' + X0 + '" y1="76" x2="' + xi(7) + '" y2="76" stroke="#E4E9F4" stroke-width="1"/>'
    + area + line + dots + labels + '</svg>' + note + '</div>';
};

Care.prototype.htmlRx = function () {
  var s = this.state, self = this;
  var todayKey = dstr(today(s));
  var doneToday = s.routineDone[todayKey] || [];
  var cards = s.rx.map(function (id, i) {
    var r = ROUTINES[id]; if (!r) return '';
    var done = doneToday.indexOf(id) >= 0;
    var sig = (s.rxWhy && s.rxWhy[id]) || { badge: '추천 루틴', why: '당신의 트랙에 맞춰 추가된 루틴이에요.' };
    return '<div class="rx' + (done ? ' done' : '') + '">'
      + '<span class="sig">' + esc(sig.badge) + '</span>'
      + '<div class="ttl"><span class="ic">' + r.icon + '</span><b>' + esc(r.name) + '</b></div>'
      + '<div class="meta"><span>⏱ ' + r.min + '분</span><span>근거 · ' + esc(r.ev) + '</span><span class="wellness-tag">웰니스 참고 활동</span></div>'
      + '<div class="why">' + esc(sig.why) + '</div>'
      + '<details><summary>따라하기</summary><ol>' + r.steps.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ol></details>'
      + (s.highRisk
          ? ''
          : '<button class="doit' + (done ? ' ok' : '') + '" data-act="routine" data-id="' + id + '"' + (done ? ' disabled' : '') + '>'
            + (done ? '✓ 오늘 완료 (+20p)' : '지금 5분 실천하기 · +20p') + '</button>')
      + '</div>';
  }).join('');
  var who = s.name ? esc(s.name) + '님의 ' : '';
  return '<div class="ncard"><h3>Care Rx · ' + who + '측정 신호 기반 오늘의 처방 3종'
    + '<span class="live-tag">SIGNAL-MATCHED</span></h3>'
    + '<div class="rx-grid">' + cards + '</div>'
    + '<p class="disc">위 루틴은 시선행동 측정 신호와 연동해 자동 처방된 <b>웰니스 참고 활동</b>이며, 의료적 진단·치료를 대체하지 않습니다.</p>'
    + '</div>';
};

Care.prototype.htmlKakaoForm = function () {
  var s = this.state;
  var isStudent = s.track === 'student';
  return '<div class="ncard"><h3>7-Day Challenge · 7일 실천 여정 시작하기</h3>'
    + '<p style="font-size:13.5px;color:var(--c-ink2);line-height:1.75;margin:0 0 16px">'
    + '오늘이 <b>D0</b>입니다. 카카오 알림톡으로 매일 30초 체크인 링크를 보내드려요. '
    + '7일 뒤 재측정으로 <b>내 정서 신호가 얼마나 달라졌는지</b> 확인할 수 있어요.</p>'
    + '<form class="kko-form" data-act-form="kko">'
    + '<div><div class="fld-label">휴대폰 번호</div><input type="tel" name="phone" placeholder="010-0000-0000" autocomplete="off" required></div>'
    + '<div><div class="fld-label">알림 받을 시간</div><select name="slot">'
    + '<option value="08:00">아침 8시</option><option value="12:30">점심 12시 30분</option><option value="20:00" selected>저녁 8시</option>'
    + '</select></div>'
    + '<div class="full consents">'
    + '<label><input type="checkbox" name="c1" required><span>[필수] 개인정보 수집·이용 동의 — 체크인 알림 발송 목적, 여정 종료 시 파기</span></label>'
    + '<label><input type="checkbox" name="c2" required><span>[필수] 카카오 알림톡 수신 동의 (D1~D7, 하루 1회)</span></label>'
    + (isStudent ? '<label><input type="checkbox" name="c3" required><span>[필수] 보호자 동의 — 만 14세 미만/청소년은 보호자 동의 후 이용할 수 있어요</span></label>' : '')
    + '</div>'
    + '<div class="full"><button type="submit" class="btn-main2">🌱 7일 챌린지 시작하기 — D1 알림톡 받기</button></div>'
    + '</form>'
    + '<div class="kko-preview" style="margin-top:14px"><b>💬 내일 받게 될 알림톡 미리보기</b>'
    + '[NeuroLens] ' + esc(s.name || '회원') + '님, D1 체크인 시간이에요 🌱 감정 이모지 1탭 + 에너지 슬라이더, 딱 30초면 끝나요. 오늘의 처방 루틴도 함께 확인해 보세요. → 체크인 바로가기</div>'
    + '<p class="disc">알림톡 발송 서버 연동 전에는 등록 정보가 브라우저에만 저장됩니다 (Phase 1 웹 폼).</p>'
    + '</div>';
};

Care.prototype.htmlJourney = function () {
  var s = this.state, d = curDay(s), at = attendance(s);
  var labels = ['D0','D1','D2','D3','D4','D5','D6','D7'];
  var slots = [];
  slots.push({ st: d === 0 ? 'today' : 'done', tx: '📋' });          // D0 = 검사+등록
  at.days.forEach(function (st, i) {
    var tx = st === 'done' ? '✓' : st === 'leaf' ? '🍃' : st === 'today' ? (i+1) : st === 'rest' ? '·' : (i+1);
    slots.push({ st: st, tx: tx });
  });
  slots.push({ st: d >= 7 ? (s.remeasured ? 'done' : 'today') : 'upcoming', tx: '🏁' }); // D7
  var strip = slots.map(function (sl, i) {
    return '<div class="jd ' + sl.st + '"><div class="dot">' + sl.tx + '</div><div class="lb">' + labels[i] + '</div></div>';
  }).join('');

  var streakLine = s.highRisk ? '' :
    '<div class="streak-line">🌱 이어가기 <b>' + at.streak + '일</b>'
    + '<span>🍃 쉬어가기 잎사귀 ' + at.leavesLeft + '/2 남음 — 하루 놓쳐도 잎사귀가 대신 지켜줘요. 끊김은 벌점이 아니에요.</span></div>';

  var insight = '';
  if (d >= 3 && !s.highRisk) {
    var keys = Object.keys(s.checkins);
    if (keys.length >= 2) {
      var minD = null, minE = 101;
      keys.forEach(function (k) {
        var e = s.checkins[k].energy;
        if (e != null && e < minE) { minE = e; minD = k; }
      });
      if (minD != null) {
        insight = '<div class="insight"><span class="ic">💡</span><span><b>중간 인사이트</b> — 이번 여정에서 <b>D' + minD
          + '</b>의 에너지(' + minE + ')가 가장 낮았어요. 그런 날엔 90초 한숨 호흡 같은 짧은 루틴이 특히 효과적이에요. '
          + '이런 패턴 데이터가 쌓이면 Coaching Agent가 당신만의 케어 타이밍을 학습합니다.</span></div>';
      }
    }
  }
  return '<div class="ncard"><h3>Journey · 7일 실천 여정' + (d >= 0 ? ' — 오늘은 D' + Math.min(d,7) : '') + '</h3>'
    + '<div class="journey">' + strip + '</div>' + streakLine + insight + '</div>';
};

Care.prototype.htmlCheckin = function () {
  var s = this.state, d = curDay(s);
  if (d < 1 || d > 6) return '';
  var done = s.checkins[d];
  if (done) {
    return '<div class="ncard"><h3>Check-in · D' + d + ' 데일리 체크인</h3>'
      + '<div class="kko-done"><span class="ic">' + esc(done.emoji) + '</span>'
      + '<span>오늘 체크인 완료! 에너지 ' + done.energy + ' · 루틴 ' + done.routines.length + '개 실천'
      + (s.highRisk ? '' : ' · <b style="color:var(--c-violet)">+10p 적립</b>') + '<br>'
      + '<small style="color:var(--c-gray2)">내일 ' + (s.channel ? '알림톡으로' : '') + ' 다시 만나요. 기록이 쌓일수록 리포트가 정확해져요.</small></span></div></div>';
  }
  var routineChecks = s.rx.map(function (id) {
    var r = ROUTINES[id]; if (!r) return '';
    return '<label><input type="checkbox" name="rt" value="' + id + '"><span>' + r.icon + ' ' + esc(r.name) + '</span></label>';
  }).join('');
  return '<div class="ncard"><h3>Check-in · D' + d + ' 데일리 체크인 <span class="live-tag">30초 컷</span></h3>'
    + '<form data-act-form="checkin">'
    + '<div class="fld-label">① 지금 마음은? <small>이모지 1탭</small></div>'
    + '<div class="emoji-row">' + EMOJIS.map(function (e) {
        return '<button type="button" class="emo" data-act="emoji" data-e="' + e + '">' + e + '</button>';
      }).join('') + '</div>'
    + '<div class="fld-label">② 오늘 에너지 <small><span data-ref="energyVal">50</span> / 100</small></div>'
    + '<input type="range" name="energy" min="0" max="100" value="50">'
    + '<div class="energy-scale"><span>방전</span><span>보통</span><span>충전 완료</span></div>'
    + '<div class="fld-label">③ 오늘 실천한 루틴 <small>선택</small></div>'
    + '<div class="chk-routines">' + routineChecks + '</div>'
    + '<button type="submit" class="btn-main2" disabled>체크인 완료' + (s.highRisk ? '' : ' · +10p') + '</button>'
    + '</form></div>';
};

Care.prototype.htmlD7 = function () {
  var s = this.state, d = curDay(s);
  if (d < 7) return '';
  var body;
  if (!s.remeasured) {
    body = '<p style="font-size:13.5px;color:var(--c-ink2);line-height:1.75;margin:0 0 16px">'
      + '7일 여정을 완주하셨어요! 이제 <b>1분 미니 재측정</b>으로 D0 대비 정서 신호가 얼마나 달라졌는지 확인해 보세요.'
      + (s.highRisk ? '' : ' 재측정 시 <b>+100p</b>가 적립됩니다.') + '</p>'
      + '<button class="btn-main2" data-act="remeasure" style="width:auto;padding:14px 34px">👁 1분 미니 재측정 시작' + (s.highRisk ? '' : ' · +100p') + '</button>';
  } else {
    var pts = trendSeries(s);
    var first = pts[0], last = pts[pts.length - 1];
    var delta = (first && last) ? last.v - first.v : 0;
    var sign = delta >= 0 ? '+' : '';
    var range = (first && last) ? 'D0 기준선 ' + first.v + ' → 최근 지수 ' + last.v : '기록 없음';
    body = '<div class="delta-box">'
      + '<div><div class="delta-num">' + sign + delta + '<small>' + (delta >= 0 ? '▲' : '▼') + ' ' + range + '</small></div>'
      + '<p style="font-size:13px;color:var(--c-gray);margin:6px 0 0;line-height:1.7">마음 컨디션 지수로 본 7일 변화 요약이에요(무료). '
      + '정서 신호(EARP) 델타, Big5 변화, 시선 지표 비교가 담긴 <b>상세 변화 리포트</b>는 구독으로 열람할 수 있어요.</p></div></div>'
      + '<div class="paywall"><div class="tx"><b>🔒 상세 변화 리포트 · D0 → D7 전체 델타</b>'
      + '정서 신호 변화 그래프 · 시선 지표 비교 · 다음 7일 맞춤 처방</div>'
      + '<button class="btn-violet" data-act="subscribe">계속 추적하기 — 구독 시작 →</button></div>';
  }
  return '<div class="ncard"><h3>D7 · 재확인 — 나의 7일 변화</h3>' + body + '</div>';
};

Care.prototype.htmlPoints = function () {
  var s = this.state;
  if (s.highRisk) return '';
  var log = s.ledger.slice(0, 5).map(function (l) {
    return '<li><span>' + esc(l.label) + '</span><b>+' + l.delta + 'p</b></li>';
  }).join('') || '<li><span>아직 적립 내역이 없어요 — 첫 루틴 실천으로 시작해 보세요</span><b></b></li>';
  return '<div class="ncard"><h3>Points · 마음 포인트</h3>'
    + '<div class="pt-head"><span class="bal">' + s.points + '<small> p</small></span>'
    + '<span style="font-size:12px;color:var(--c-gray2)">포인트는 유료 리포트·구독 할인으로 교환돼요</span></div>'
    + '<div class="pt-rules"><span>데일리 체크인 +10p</span><span>루틴 실천 +20p</span><span>D7 재측정 +100p</span></div>'
    + '<ul class="pt-log">' + log + '</ul>'
    + '<div class="pt-ex">'
    + '<button class="btn-line" data-act="exchange" data-cost="150" data-name="유료 리포트 2,000원 할인권">150p → 리포트 2,000원 할인</button>'
    + '<button class="btn-line" data-act="exchange" data-cost="300" data-name="구독 첫 달 30% 할인권">300p → 구독 첫 달 30% 할인</button>'
    + '</div></div>';
};

/* ----- 전체 페인트 ----- */
Care.prototype.paint = function () {
  var s = this.state, d = curDay(s);
  var idx = this.htmlIndex();
  if (this.opts.indexEl) { // ① 결과 페이지 상단 마운트
    this.opts.indexEl.innerHTML = idx ? '<div class="nlc">' + idx + '</div>' : '';
    idx = '';
  }
  var html = '<div class="nlc">' + this.htmlDemoBar();
  if (s.highRisk) html += this.htmlSafety();
  html += idx;
  html += this.htmlRx();
  if (!s.startedAt) html += this.htmlKakaoForm();
  else {
    html += this.htmlJourney();
    if (s.channel && d === 0) {
      html += '<div class="ncard"><h3>Check-in · D0 등록 완료</h3><div class="kko-done"><span class="ic">✅</span>'
        + '<span>알림톡 등록이 끝났어요 (' + esc(s.channel.slot) + ' · ' + esc(s.channel.phone) + '). '
        + '내일부터 D1 체크인 링크가 도착합니다. 오늘은 처방 루틴 하나만 가볍게 실천해 보세요.</span></div></div>';
    }
    html += this.htmlCheckin();
    html += this.htmlD7();
  }
  html += this.htmlPoints();
  html += '<p class="disc" style="text-align:center">NeuroLens Care는 비진단적 웰니스 보조 서비스입니다 · 위기 시 1393 (24시간)</p>';
  html += '<div class="nlc-toast"></div></div>';
  this.el.innerHTML = html;

  /* 링 게이지 채움 애니메이션 */
  var roots = [this.el];
  if (this.opts.indexEl) roots.push(this.opts.indexEl);
  requestAnimationFrame(function () { requestAnimationFrame(function () {
    roots.forEach(function (rt) {
      rt.querySelectorAll('.cond-ring[data-cv]').forEach(function (el) {
        el.style.setProperty('--cv', el.getAttribute('data-cv'));
      });
    });
  }); });
};

/* ----- 이벤트 (위임, 1회 바인딩 — 본문 + 상단 지수 마운트) ----- */
Care.prototype.bind = function () {
  this.bindTo(this.el);
  if (this.opts.indexEl) this.bindTo(this.opts.indexEl);
};

Care.prototype.bindTo = function (root) {
  if (root._nlcBound) return;
  root._nlcBound = true;
  var self = this;

  root.addEventListener('input', function (e) {
    if (e.target.name === 'energy') {
      var v = self.el.querySelector('[data-ref="energyVal"]');
      if (v) v.textContent = e.target.value;
    }
  });

  root.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var act = btn.getAttribute('data-act');
    var s = self.state;

    if (act === 'goto-checkin') {
      e.preventDefault();
      var f = self.el.querySelector('[data-act-form="checkin"]');
      if (f) f.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (act === 'emoji') {
      self.el.querySelectorAll('.emo').forEach(function (b) { b.classList.remove('sel'); });
      btn.classList.add('sel');
      var submit = self.el.querySelector('[data-act-form="checkin"] button[type=submit]');
      if (submit) submit.disabled = false;
      return;
    }
    if (act === 'routine') {
      e.preventDefault();
      var id = btn.getAttribute('data-id');
      var k = dstr(today(s));
      s.routineDone[k] = s.routineDone[k] || [];
      if (s.routineDone[k].indexOf(id) < 0) {
        s.routineDone[k].push(id);
        addPoints(s, '루틴 실천 · ' + (ROUTINES[id] ? ROUTINES[id].name : id), 20);
        self.save(); self.paint();
        self.toast('🌱 루틴 실천 완료! +20p 적립');
      }
      return;
    }
    if (act === 'remeasure') {
      e.preventDefault();
      if (!s.remeasured) {
        s.remeasured = true;
        addPoints(s, 'D7 미니 재측정 완료', 100);
        self.save();
        if (typeof self.opts.onRemeasure === 'function') {
          self.paint(); self.toast('👁 재측정을 시작합니다 · +100p 적립');
          self.opts.onRemeasure();
        } else {
          self.paint(); self.toast('👁 재측정 완료(데모) · +100p 적립');
        }
      }
      return;
    }
    if (act === 'exchange') {
      e.preventDefault();
      var cost = parseInt(btn.getAttribute('data-cost'), 10);
      var name = btn.getAttribute('data-name');
      if (s.points >= cost) {
        s.points -= cost;
        s.ledger.unshift({ t: Date.now(), label: '교환 · ' + name, delta: -cost });
        self.save(); self.paint();
        self.toast('🎟 ' + name + ' 발급! (데모 — 결제 연동 예정)');
      } else {
        self.toast('포인트가 ' + (cost - s.points) + 'p 부족해요 — 오늘 체크인으로 채워보세요!');
      }
      return;
    }
    if (act === 'subscribe') { e.preventDefault(); self.toast('✦ 구독은 정식 버전에서 열려요 — 상세 델타 리포트가 준비 중!'); return; }
    if (act === 'counsel')   { e.preventDefault(); self.toast('상담 연계 요청이 접수되는 기능은 준비 중이에요. 지금 도움이 필요하면 1393에 전화해 주세요.'); return; }
    if (act === 'demo-next') { e.preventDefault(); s.demoOffset = (s.demoOffset || 0) + 1; self.save(); self.paint(); return; }
    if (act === 'demo-risk') { e.preventDefault(); s.highRisk = !s.highRisk; self.save(); self.paint(); return; }
    if (act === 'demo-reset') {
      e.preventDefault();
      var keep = { signals: s.signals, rx: s.rx, rxWhy: s.rxWhy, base: s.base, track: s.track, name: s.name };
      self.state = blankState();
      self.state.signals = keep.signals; self.state.rx = keep.rx; self.state.rxWhy = keep.rxWhy;
      self.state.base = keep.base; self.state.track = keep.track; self.state.name = keep.name;
      self.save(); self.paint(); self.toast('여정을 리셋했어요 (데모)');
      return;
    }
  });

  root.addEventListener('submit', function (e) {
    var form = e.target.closest('[data-act-form]');
    if (!form) return;
    e.preventDefault();
    var s = self.state;
    var kind = form.getAttribute('data-act-form');

    if (kind === 'kko') {
      var phone = form.phone.value.trim();
      if (!/^01[0-9][- ]?\d{3,4}[- ]?\d{4}$/.test(phone)) { self.toast('휴대폰 번호 형식을 확인해 주세요'); return; }
      s.channel = { phone: phone, slot: form.slot.options[form.slot.selectedIndex].text, ts: Date.now() };
      s.startedAt = dstr(today(s));
      self.save(); self.paint();
      self.toast('🌱 7일 챌린지 시작! 내일 D1 알림톡으로 만나요');
      return;
    }
    if (kind === 'checkin') {
      var emo = self.el.querySelector('.emo.sel');
      if (!emo) { self.toast('지금 마음을 이모지로 골라주세요'); return; }
      var d = curDay(s);
      var routines = Array.prototype.slice.call(form.querySelectorAll('input[name=rt]:checked')).map(function (c) { return c.value; });
      s.checkins[d] = { emoji: emo.getAttribute('data-e'), energy: parseInt(form.energy.value, 10), routines: routines, ts: Date.now() };
      addPoints(s, 'D' + d + ' 데일리 체크인', 10);
      var k = dstr(today(s));
      s.routineDone[k] = s.routineDone[k] || [];
      routines.forEach(function (id) {
        if (s.routineDone[k].indexOf(id) < 0) {
          s.routineDone[k].push(id);
          addPoints(s, '루틴 실천 · ' + (ROUTINES[id] ? ROUTINES[id].name : id), 20);
        }
      });
      self.save(); self.paint();
      var ciNow = condIndex(s); /* ② 체크인 완료 → 즉시 갱신된 지수를 알림 */
      self.toast(s.highRisk
        ? '오늘의 기록을 남겼어요. 잘하고 있어요.'
        : '✅ D' + d + ' 체크인 완료! +' + (10 + routines.length * 20) + 'p' + (ciNow ? ' · 오늘 지수 ' + ciNow.today + '점' : ''));
      return;
    }
  });
};

/* 링 게이지 conic 전환 애니메이션용 커스텀 프로퍼티 등록 */
if (window.CSS && CSS.registerProperty) {
  try { CSS.registerProperty({ name: '--cv', syntax: '<number>', initialValue: 0, inherits: false }); } catch (_) {}
}

/* ---------- 공개 API ---------- */
window.NLCare = {
  render: function (el, result, opts) {
    if (!el) return null;
    return new Care(el, result || null, opts || {});
  },
  hasJourney: function (storageKey) {
    var s = load(storageKey || KEY);
    return !!(s.startedAt || s.rx.length);
  },
  /* 오늘의 마음 컨디션 지수 — {today, base, state, day, checked} | null */
  condIndex: function (storageKey) {
    return condIndex(load(storageKey || KEY));
  },
};
})();
