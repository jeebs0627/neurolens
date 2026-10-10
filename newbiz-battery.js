/* NeuroLens NewBiz — 통합 자기조절 배터리 (newbiz.html 전용, 운영 서비스와 무관).
 * newbiz-core.js 의 신호처리 위에서 검사별 채점 → 4개 영역 → 통합 해석 → 케어 정렬까지 담당한다.
 *
 * 통합 틀: 주의 네트워크(경계·정향·실행 통제; Petersen & Posner, 2012) × 신경내장 통합 모델(Thayer & Lane, 2000).
 *   각성(alert)      PVT-B + PERCLOS                 → 경계 네트워크
 *   주의 통제(control) 안티사카드 + 원활 추적 + SART    → 실행 통제 네트워크
 *   정서 주의(emotion) 정서 자유 보기 (기존 MVP)        → 정서 자극 정향
 *   자율신경(autonomic) 압박 과제 · 공명 호흡 rPPG (기존) → 신경내장 조절
 * 영역 사이의 연결(피로 게이팅·주의 통제 이론·신경내장 통합·지속 인지)을 통합 해석 규칙으로 쓴다.
 *
 * 검사·지표마다 근거 문헌(REFS)과 판정 기준(INDICATORS)을 한곳에 둔다. 참고 범위는 문헌 보고 범위를
 * 웹캠·브라우저 환경에 맞춘 잠정값이며(파일럿 규준 수립 전), 의학적 진단이 아닌 웰니스 참고 지표다.
 * 브라우저: window.NLBattery · Node 테스트: module.exports */
(function (root, factory) {
  const core = typeof module === 'object' && module.exports ? require('./newbiz-core.js') : root && root.NLNewbiz;
  const api = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NLBattery = api;
})(typeof window !== 'undefined' ? window : null, function (N) {
  'use strict';

  const VERSION = 'In_mind battery 1.8';   // 1.8 (2026-10-10): 참고 지표 세션별 자격 심사(ADMIT — 신뢰도·타당 범위를 통과한 세션만 판정 반영), 방향 전환 지연 신뢰도 유효/프로토콜 횟수, 속도 유지율 머리 동조 감점, 회복률·PVT 조기 반응 오차 범위, 수렴 원칙에서 같은 측정값 지표는 1개로 · 1.7 (2026-10-10): 정서 보기 반분 안정성 감점을 우연 기대(z>2) 초과일 때만 · 1.6 (2026-10-10): 사카드 신뢰도 fps 기준 24→12(방향 판정, 실측 솎기 검증) · 압박 상승이 오차보다 작으면 회복률 ‘해당 없음’(분모 제외) · 1.5 (2026-10-09): PVT 자극을 검은 바탕·흰 숫자로(이전 연회색·붉은 숫자 — 1.4 이하 PVT 반응시간과 직접 비교 금지) · 1.4 (2026-10-05): SART 변별력 d′·응답 기준 · 1.3: 정밀도 기준 심박 신뢰도 · 1.2: 원활 추적 2판(속도 단계·불규칙 방향 전환·머리 동조) · 1.1: SART 3 비율 +7%p, 압박 전 30초 쉬기 삭제
  const finite = v => typeof v === 'number' && Number.isFinite(v);
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const round = (x, d = 0) => finite(x) ? Math.round(x * 10 ** d) / 10 ** d : null;
  const { mean, median, std, quantile } = N;

  /* ---------- 근거 문헌 ---------- */
  const REFS = {
    posner: 'Petersen SE, Posner MI. The attention system of the human brain: 20 years after. Annu Rev Neurosci. 2012;35:73–89.',
    thayerLane: 'Thayer JF, Lane RD. A model of neurovisceral integration in emotion regulation and dysregulation. J Affect Disord. 2000;61(3):201–216.',
    thayer: 'Thayer JF, Hansen AL, Saus-Rose E, Johnsen BH. Heart rate variability, prefrontal neural function, and cognitive performance: the neurovisceral integration perspective on self-regulation, adaptation, and health. Ann Behav Med. 2009;37(2):141–153.',
    limDinges: 'Lim J, Dinges DF. A meta-analysis of the impact of short-term sleep deprivation on cognitive variables. Psychol Bull. 2010;136(3):375–389.',
    yoo: 'Yoo SS, Gujar N, Hu P, Jolesz FA, Walker MP. The human emotional brain without sleep — a prefrontal amygdala disconnect. Curr Biol. 2007;17(20):R877–R878.',
    act: 'Eysenck MW, Derakshan N, Santos R, Calvo MG. Anxiety and cognitive performance: attentional control theory. Emotion. 2007;7(2):336–353.',
    derakshan: 'Derakshan N, Ansari TL, Hansard M, Shoker L, Eysenck MW. Anxiety, inhibition, efficiency, and effectiveness: an investigation using the antisaccade task. Exp Psychol. 2009;56(1):48–55.',
    brosschot: 'Brosschot JF, Gerin W, Thayer JF. The perseverative cognition hypothesis: a review of worry, prolonged stress-related physiological activation, and health. J Psychosom Res. 2006;60(2):113–124.',
    dinges85: 'Dinges DF, Powell JW. Microcomputer analyses of performance on a portable, simple visual RT task during sustained operations. Behav Res Methods Instrum Comput. 1985;17(6):652–655.',
    basnerB: 'Basner M, Mollicone D, Dinges DF. Validity and sensitivity of a brief psychomotor vigilance test (PVT-B) to total and partial sleep deprivation. Acta Astronaut. 2011;69(11–12):949–959.',
    basner: 'Basner M, Dinges DF. Maximizing sensitivity of the psychomotor vigilance test (PVT) to sleep loss. Sleep. 2011;34(5):581–591.',
    wierwille: 'Wierwille WW, Ellsworth LA, Wreggit SS, Fairbanks RJ, Kirn CL. Research on vehicle-based driver status/performance monitoring: development, validation, and refinement of algorithms for detection of driver drowsiness. NHTSA Final Report DOT HS 808 247; 1994.',
    dingesGrace: 'Dinges DF, Grace R. PERCLOS: A valid psychophysiological measure of alertness as assessed by psychomotor vigilance. FHWA Tech Brief FHWA-MCRT-98-006; 1998.',
    caffier: 'Caffier PP, Erdmann U, Ullsperger P. Experimental evaluation of eye-blink parameters as a drowsiness measure. Eur J Appl Physiol. 2003;89(3–4):319–325.',
    phq9: 'Kroenke K, Spitzer RL, Williams JBW. The PHQ-9: validity of a brief depression severity measure. J Gen Intern Med. 2001;16(9):606–613.',
    phq2: 'Kroenke K, Spitzer RL, Williams JBW. The Patient Health Questionnaire-2: validity of a two-item depression screener. Med Care. 2003;41(11):1284–1292.',
    phq8: 'Kroenke K, Strine TW, Spitzer RL, Williams JBW, Berry JT, Mokdad AH. The PHQ-8 as a measure of current depression in the general population. J Affect Disord. 2009;114(1–3):163–173.',
    phqKr: '박승진, 최혜라, 최지혜, 김건우, 홍진표. 한글판 우울증 선별도구(Patient Health Questionnaire-9, PHQ-9)의 신뢰도와 타당도. Anxiety and Mood. 2010;6(2):119–124.',
    levis: 'Levis B, Sun Y, He C, et al. Accuracy of the PHQ-2 alone and in combination with the PHQ-9 for screening to detect major depression: systematic review and individual participant data meta-analysis. JAMA. 2020;323(22):2290–2300.',
    kss: 'Åkerstedt T, Gillberg M. Subjective and objective sleepiness in the active individual. Int J Neurosci. 1990;52(1–2):29–37.',
    vanDongen: 'Van Dongen HPA, Maislin G, Mullington JM, Dinges DF. The cumulative cost of additional wakefulness: dose-response effects on neurobehavioral functions and sleep physiology from chronic sleep restriction and total sleep deprivation. Sleep. 2003;26(2):117–126.',
    hallett: 'Hallett PE. Primary and secondary saccades to goals defined by instructions. Vision Res. 1978;18(10):1279–1296.',
    munoz: 'Munoz DP, Everling S. Look away: the anti-saccade task and the voluntary control of eye movement. Nat Rev Neurosci. 2004;5(3):218–229.',
    antoniades: 'Antoniades C, Ettinger U, Gaymard B, et al. An internationally standardised antisaccade protocol. Vision Res. 2013;84:1–5.',
    lencer: 'Lencer R, Trillenberg P. Neurophysiology and neuroanatomy of smooth pursuit in humans. Brain Cogn. 2008;68(3):219–228.',
    maruta: 'Maruta J, Suh M, Niogi SN, Mukherjee P, Ghajar J. Visual tracking synchronization as a metric for concussion screening. J Head Trauma Rehabil. 2010;25(4):293–305.',
    robertson: 'Robertson IH, Manly T, Andrade J, Baddeley BT, Yiend J. ‘Oops!’: performance correlates of everyday attentional failures in traumatic brain injured and normal subjects. Neuropsychologia. 1997;35(6):747–758.',
    rosvold: 'Rosvold HE, Mirsky AF, Sarason I, Bransome ED, Beck LH. A continuous performance test of brain damage. J Consult Psychol. 1956;20(5):343–350.',
    kofler: 'Kofler MJ, Rapport MD, Sarver DE, et al. Reaction time variability in ADHD: a meta-analytic review of 319 studies. Clin Psychol Rev. 2013;33(6):795–811.',
    teicher: 'Teicher MH, Ito Y, Glod CA, Barber NI. Objective measurement of hyperactivity and attentional problems in ADHD. J Am Acad Child Adolesc Psychiatry. 1996;35(3):334–342.',
    armstrong: 'Armstrong T, Olatunji BO. Eye tracking of attention in anxiety and depression: a meta-analytic review and synthesis. Clin Psychol Rev. 2012;32(8):704–723.',
    kreibig: 'Kreibig SD. Autonomic nervous system activity in emotion: a review. Biol Psychol. 2010;84(3):394–421.',
    dedovic: 'Dedovic K, Renwick R, Mahani NK, Engert V, Lupien SJ, Pruessner JC. The Montreal Imaging Stress Task: using functional imaging to investigate the effects of perceiving and processing psychosocial stress in the human brain. J Psychiatry Neurosci. 2005;30(5):319–325.',
    lehrer: 'Lehrer PM, Gevirtz R. Heart rate variability biofeedback: how and why does it work? Front Psychol. 2014;5:756.',
    taskForce: 'Task Force of the European Society of Cardiology and the North American Society of Pacing and Electrophysiology. Heart rate variability: standards of measurement, physiological interpretation and clinical use. Circulation. 1996;93(5):1043–1065.',
    pos: 'Wang W, den Brinker AC, Stuijk S, de Haan G. Algorithmic principles of remote PPG. IEEE Trans Biomed Eng. 2017;64(7):1479–1491.',
    mediapipe: 'Kartynnik Y, Ablavatski A, Grishchenko I, Grundmann M. Real-time facial surface geometry from monocular video on mobile GPUs. CVPR Workshop on Computer Vision for AR/VR; 2019. arXiv:1907.06724.',
    webcamET: 'Semmelmann K, Weigelt S. Online webcam-based eye tracking in cognitive science: a first look. Behav Res Methods. 2018;50(2):451–465.',
    larsen: 'Larsen JT, Norris CJ, Cacioppo JT. Effects of positive and negative affect on electromyographic activity over zygomaticus major and corrugator supercilii. Psychophysiology. 2003;40(5):776–785.',
    mogg: 'Mogg K, Bradley BP, Miles F, Dixon R. Time course of attentional bias for threat scenes: testing the vigilance-avoidance hypothesis. Cogn Emot. 2004;18(5):689–700.',
    winer: 'Winer ES, Salem T. Reward devaluation: dot-probe meta-analytic evidence of avoidance of positive information in depressed persons. Psychol Bull. 2016;142(1):18–78.',
    kellough: 'Kellough JL, Beevers CG, Ellis AJ, Wells TT. Time course of selective attention in clinically depressed young adults: an eye tracking study. Behav Res Ther. 2008;46(11):1238–1243.',
    waechter: 'Waechter S, Nelson AL, Wright C, Hyatt A, Oakman J. Measuring attentional bias to threat: reliability of dot probe and eye movement indices. Cognit Ther Res. 2014;38(3):313–333.',
    kurdi: 'Kurdi B, Lozano S, Banaji MR. Introducing the Open Affective Standardized Image Set (OASIS). Behav Res Methods. 2017;49(2):457–470.',
    marchewka: 'Marchewka A, Żurawski Ł, Jednoróg K, Grabowska A. The Nencki Affective Picture System (NAPS): introduction to a novel, standardized, wide-range, high-quality, realistic picture database. Behav Res Methods. 2014;46(2):596–610.',
    sam: 'Bradley MM, Lang PJ. Measuring emotion: the Self-Assessment Manikin and the semantic differential. J Behav Ther Exp Psychiatry. 1994;25(1):49–59.',
    garfinkel: 'Garfinkel SN, Seth AK, Barrett AB, Suzuki K, Critchley HD. Knowing your own heart: distinguishing interoceptive accuracy from interoceptive awareness. Biol Psychol. 2015;104:65–74.',
    trauer: 'Trauer JM, Qian MY, Doyle JS, Rajaratnam SMW, Cunnington D. Cognitive behavioral therapy for chronic insomnia: a systematic review and meta-analysis. Ann Intern Med. 2015;163(3):191–204.',
    brooks: 'Brooks A, Lack L. A brief afternoon nap following nocturnal sleep restriction: which nap duration is most recuperative? Sleep. 2006;29(6):831–840.',
    tang: 'Tang YY, Hölzel BK, Posner MI. The neuroscience of mindfulness meditation. Nat Rev Neurosci. 2015;16(4):213–225.',
    hillman: 'Hillman CH, Erickson KI, Kramer AF. Be smart, exercise your heart: exercise effects on brain and cognition. Nat Rev Neurosci. 2008;9(1):58–65.',
    hakamata: 'Hakamata Y, Lissek S, Bar-Haim Y, et al. Attention bias modification treatment: a meta-analysis toward the establishment of novel treatment for anxiety. Biol Psychiatry. 2010;68(11):982–990.',
    cristea: 'Cristea IA, Kok RN, Cuijpers P. Efficacy of cognitive bias modification interventions in anxiety and depression: meta-analysis. Br J Psychiatry. 2015;206(1):7–16.',
    borkovec: 'Borkovec TD, Wilkinson L, Folensbee R, Lerman C. Stimulus control applications to the treatment of worry. Behav Res Ther. 1983;21(3):247–251.',
    goessl: 'Goessl VC, Curtiss JE, Hofmann SG. The effect of heart rate variability biofeedback training on stress and anxiety: a meta-analysis. Psychol Med. 2017;47(15):2578–2586.',
    jennings: 'Jennings JR, Kamarck T, Stewart C, Eddy M, Johnson P. Alternate cardiovascular baseline assessment techniques: vanilla or resting baseline. Psychophysiology. 1992;29(6):742–750.',
    piferi: 'Piferi RL, Kline KA, Younger J, Lawler KA. An alternative approach for achieving cardiovascular baseline: viewing an aquatic video. Int J Psychophysiol. 2000;37(2):207–217.',
    kirschbaum: 'Kirschbaum C, Pirke KM, Hellhammer DH. The ‘Trier Social Stress Test’ — a tool for investigating psychobiological stress responses in a laboratory setting. Neuropsychobiology. 1993;28(1–2):76–81.',
    shaffer: 'Shaffer F, Meehan ZM. A practical guide to resonance frequency assessment for heart rate variability biofeedback. Front Neurosci. 2020;14:570400.',
    pfeuffer: 'Pfeuffer K, Vidal M, Turner J, Bulling A, Gellersen H. Pursuit calibration: making gaze calibration less tedious and more flexible. Proc ACM UIST. 2013:261–270.',
    casiez: 'Casiez G, Roussel N, Vogel D. 1€ filter: a simple speed-based low-pass filter for noisy input in interactive systems. Proc ACM CHI. 2012:2527–2530.',
    wesensten: 'Wesensten NJ, Belenky G, Kautz MA, Thorne DR, Reichardt RM, Balkin TJ. Maintaining alertness and performance during sleep deprivation: modafinil versus caffeine. Psychopharmacology. 2002;159(3):238–247.',
    blatter: 'Blatter K, Cajochen C. Circadian rhythms in cognitive performance: methodological constraints, protocols, theoretical underpinnings. Physiol Behav. 2007;90(2–3):196–208.',
    nunnally: 'Nunnally JC, Bernstein IH. Psychometric Theory. 3rd ed. New York: McGraw-Hill; 1994.',
    hedge: 'Hedge C, Powell G, Sumner P. The reliability paradox: why robust cognitive tasks do not produce reliable individual differences. Behav Res Methods. 2018;50(3):1166–1186.',
    jacobson: 'Jacobson NS, Truax P. Clinical significance: a statistical approach to defining meaningful change in psychotherapy research. J Consult Clin Psychol. 1991;59(1):12–19.',
    zaccaro: 'Zaccaro A, Piarulli A, Laurino M, et al. How breath-control can change your life: a systematic review on psycho-physiological correlates of slow breathing. Front Hum Neurosci. 2018;12:353.',
  };

  /* ---------- 프로토콜 (문헌 패러다임을 웹캠·브라우저용으로 단축) ---------- */
  const PROTOCOL = {
    pvt: { isiMin: 1000, isiMax: 4000, lapseMs: 355, falseMs: 100, timeoutMs: 3000 },          // PVT-B (Basner et al., 2011)
    sart: { digitMs: 250, maskMs: 900, mask: false, nogo: 3, nogoBoost: 0.07, sizes: [48, 72, 94, 100, 120] },   // nogoBoost: 3의 비율을 원판 1/9(11.1%)에서 +7%p(약 18%) — 거부 시행 수를 늘려 억제 실패율의 신뢰도를 높인다 (2026-10-05 운영 결정)   // SART (Robertson et al., 1997) — 마스크 대신 빈 화면 (아래 MODULES 참고)
    saccade: { fixMin: 1000, fixMax: 2000, targetMs: 1200, gapMs: 400, ecc: 0.35, window: 1000 }, // 단계 패러다임 (Antoniades et al., 2013 참고)
    /* 원활 추적 2판(2026-10-05): ① 속도 단계 — 같은 진폭(화면 폭의 ampL)으로 0.2·0.35·0.5Hz 사인 추적(단계마다 정수 주기라 끝이 가운데)
     * ② 불규칙 방향 전환 — 등속(speed, 화면 폭/초)으로 움직이다 gapMin~gapMax 무작위 시점에 반전(Rashbass, 1961; Barnes, 2008).
     * freq·amp 는 1판(좌우 0.25Hz) 기록 재분석용으로 남긴다 */
    pursuit: { freq: 0.25, amp: 0.36, skipMs: 1500, levels: [0.2, 0.35, 0.5], ampL: 0.32,
      rev: { speed: 0.35, gapMin: 700, gapMax: 1500, lo: 0.14, hi: 0.86, pre: 400, post: 700 } },
    /* 원형 추적 (Maruta et al., 2010): 원을 그리며 도는 점을 따라간다. 수평·수직 추적과 예측적 동기화를 함께 본다 */
    circle: { freq: 0.4, r: 0.17, skipMs: 1200 },
    /* 사카드 판정: 응답 기준은 개인 시선 진폭의 40%, 단발성 튐을 막기 위해 다음 표본도 기준의 70% 이상 같은 쪽이어야 한다.
     * 기준을 넘지 못하면 진폭의 25% 로 한 번 더 찾고(약한 반응), 방향만 판정에 쓰고 잠복기에는 쓰지 않는다 */
    saccadeRule: { thr: 0.4, weak: 0.25, sustain: 0.7, offcenter: 0.8 },                                            // 수평 정현파 추적
    perclos: { closure: 0.8, blink: 0.5 },                                                       // P80 (Wierwille et al., 1994)
    /* MIST (Dedovic et al., 2005): 난이도 1~5 무작위, 답은 항상 0~9 한 자리.
     * 시작 제한 시간 = 연습 문제 정답 평균 시간 × 0.9 (원판 규칙). 이후 정답마다 8% 단축·오답/시간 초과마다 12% 연장 —
     * 가중 계단법(Kaernbach, 1991)이라 정답률 약 60%로 수렴한다(0.08×0.6 = 0.12×0.4). 실패 경험이 압박이 되는 구간 */
    stress: { limitMs: 4000, minMs: 1200, maxMs: 6500, down: 0.08, up: 0.12, startFactor: 0.9, practice: 4, practiceMs: 8000, target: 0.8, hardAt: [0.35, 0.72] },
    /* 개인 기기 지연 보정: 가장 빠른 10% 반응이 이 값보다 느린 만큼을 입력·표시 지연으로 보고 빼 준다 (상한 maxMs) */
    latency: { fastRef: 210, maxMs: 60, minTrials: 10 },
  };
  /* ---------- 보정·품질 원칙 (NL-QC) ----------
   * 1) 신뢰도 가중: 지표마다 신호 품질·유효 시행으로 신뢰도 r(0~1)을 매기고, 영역 점수는 (핵심 2배 가중 × r) 가중 평균. r < minR 이면 판정 제외
   * 2) 측정 오차 띠: 시행 수에서 표준오차를 구해 95% 구간이 판정 경계에 걸치면 ‘경계’로 표시 (Jacobson & Truax, 1991)
   * 3) 수렴 원칙: ‘관리 필요’는 서로 다른 지표 2개 이상이 저하를 가리키거나, 경계가 아닌 고신뢰 핵심 지표일 때만. 아니면 ‘주의’로 낮춘다
   * 4) 수행 타당도: 무작위 누르기·무반응 같은 비순응 패턴이면 그 검사를 판정에서 뺀다
   * 5) 개인 기준 보정: 심박은 본인 기준선 대비, 시선은 좌우 균형 가중·개인 시선 진폭, 반응시간은 기기 지연 보정 */
  /* minR: 이 신뢰도 아래만 판정에서 뺀다. 0.3 → 0.2로 낮춰, 약하지만 근거가 있는 지표는 버리지 않고 낮은 가중으로 반영한다(점수 기여 = 가중 × 신뢰도) */
  /* 참고 지표(ref) 세션별 자격 심사: 전체 세션 기준 격상(tools/condition_replay.cjs --promote)은 못 넘었어도, 이 세션에서
   * 신뢰도 r ≥ minR 이고 값이 생리적으로 가능한 범위 안이면 보조 지표(가중 1)로 판정에 넣는다. 범위가 없는 지표는 넣지 않는다:
   * d′ 는 억제 실패·누락 두 판정 지표의 함수라(빠른 모드 실측 21세션에서 억제 실패와 1:1) 넣으면 같은 정보를 두 번 센다.
   * 범위 근거: 방향 전환 지연 80~500ms(Lencer), 속도 유지율 0.2~1.05(빠를수록 이득은 오르지 않는다 — >1 은 느린 단계 머리 동조의 흔적) */
  const ADMIT = { minR: 0.6, plausible: { pursuitLatency: v => v >= 80 && v <= 500, pursuitSpeed: v => v > 0.2 && v <= 1.05 } };
  const QC = { version: 'In_mind QC 2.0', minR: 0.2, tentative: 0.45, hrQ: { good: 1, fair: 0.65, poor: 0.25, none: 0 }, pvtFalseMax: 20, sartOmitMax: 0.5 };
  const DUR = {
    /* fv: 정서 사진 모드의 블록별 시행 수 (중립-중립 · 부정[위협+슬픔] · 긍정), trials: 도식 자극 모드의 블록별 시행 수 */
    full:  { baseline: 60, pursuit: [2, 3, 4], reversals: 16, circle: 15, pro: 8, anti: 20, practice: 2, trials: 7, fv: { neu: 6, neg: 24, pos: 12 }, pvt: 180, pvtPractice: 3, sart: 108, sartPractice: 18, stress: 60, recovery: 60 },
    /* 표준(약 8분, 기본값) — 각 과제의 최소 신뢰 수준을 지키며 측정 시간을 8분 안팎으로 맞춘 구성 */
    quick: { baseline: 30, pursuit: [1, 2, 2], reversals: 10, circle: 10, pro: 4, anti: 10, practice: 1, trials: 4, fv: { neu: 3, neg: 8, pos: 4 }, pvt: 90, pvtPractice: 2, sart: 54, sartPractice: 9, stress: 40, recovery: 40 },
  };

  const MODULES = {
    alert: {
      title: '또렷함 검사', tests: 'PVT-B 정신운동 경계 과제 + PERCLOS 눈꺼풀 분석', domain: 'alert', min: { full: 3.5, quick: 2 },
      paradigm: '무작위 간격(1~4초)으로 나타나는 숫자 카운터에 최대한 빨리 반응한다. 수면 부족·피로에 가장 민감한 행동 지표로 확립된 PVT의 3분 단축형(PVT-B)이며, 같은 시간 동안 웹캠으로 눈꺼풀이 80% 이상 닫힌 시간 비율(PERCLOS)을 함께 잰다.',
      limits: '브라우저·키보드 입력 지연(약 20~60ms)이 반응시간에 더해진다. PERCLOS는 개인별 눈 열림 범위로 정규화한 근사값이며 안경 반사·조명에 영향을 받는다.',
      refs: ['dinges85', 'basnerB', 'basner', 'wierwille', 'dingesGrace', 'caffier'],
    },
    oculo: {
      title: '눈 움직임 조절', tests: '원활 추적 + 프로·안티사카드', domain: 'control', min: { full: 2.5, quick: 1.5 },
      paradigm: '좌우로 움직이는 점을 눈으로 따라가는 원활 추적과, 주변에 나타난 점을 보거나(프로사카드) 반대쪽을 보는(안티사카드) 과제다. 안티사카드는 반사적 시선을 억제하는 전전두 실행 통제를 직접 반영한다.',
      limits: '웹캠 시선은 정확도 약 1~2°, 30fps라 잠복기는 ±33ms 해상도의 참고값이다. 사카드 직전 좌·중·우 응시로 개인별 시선 진폭을 재고 그 40%를 반응 기준으로 삼아, 고정 기준보다 유효 시행을 크게 늘렸다. 판정에는 시선 방향(오류율)처럼 웹캠으로도 안정적인 지표를 주로 쓴다.',
      refs: ['hallett', 'munoz', 'antoniades', 'lencer', 'maruta', 'webcamET'],
    },
    sustain: {
      title: '지속 집중', tests: 'SART 반응 억제 과제 + 머리 움직임', domain: 'control', min: { full: 3, quick: 1.7 },
      paradigm: '숫자 1~9가 빠르게(250ms 제시 + 900ms 빈 화면, 1.15초 간격) 나타날 때 3을 제외한 모든 숫자에 반응한다. 지속 주의와 반응 억제의 실패(일상적 주의 실수)를 측정하는 연속수행검사(CPT) 계열 과제이며, 수행 중 머리 움직임을 웹캠으로 함께 기록한다.',
      limits: '자극 간격(1.15초)·숫자 크기 5단계·본 시행 중 정오 피드백 없음은 원판 그대로다. 원판의 마스크(원 안의 ×)는 ‘틀렸다’는 표시로 오인되기 쉬워 빈 화면으로 바꿨으며, 마스크가 없으면 과제가 다소 쉬워질 수 있어 억제 실패율 기준은 파일럿에서 재설정한다. 또한 원판(225시행)을 108시행(표준)·63시행(빠른 측정)으로 단축했다. 본 시행 전 연습(표준 18시행)에서만 정오 피드백을 주며, 본 시행에서는 정오와 무관한 입력 확인 표시만 보인다. 머리 움직임은 얼굴 랜드마크 이동량이며 적외선 동작 분석(QbTest류)보다 해상도가 낮다.',
      refs: ['robertson', 'rosvold', 'kofler', 'teicher'],
    },
    core: {
      title: '마음·몸 반응', tests: '정서 자유 보기 + MIST 암산 압박 + 분당 6회 공명 호흡', domain: 'emotion · autonomic', min: { full: 4.5, quick: 2.8 },
      paradigm: '정서-중립 사진 쌍(위협·슬픔·긍정 vs 내용이 맞춰진 중립 사진)을 자유롭게 보는 동안의 시선 체류(주의 편향), MIST 방식 암산(난이도 1~5 무작위 · 덧셈·뺄셈 · 답 0~9 · 수행에 따라 줄어드는 제한 시간 · 목표 정답률 막대) 중 심박 반응, 공명 주파수 호흡 중 심박 회복과 호흡-심박 동조를 rPPG(POS)로 측정한다.',
      limits: 'rPPG는 조명·움직임에 민감하며 HRV(RMSSD)는 30fps 한계로 참고값이다. MIST 원판의 거짓 평균 비교(기만) 대신 실제 목표 정답률(80%)과 비교하며, 시간은 1분으로 단축했다. 정서 사진 세트가 없으면 밝기를 맞춘 도식 얼굴·단어로 대체하며, 이 경우 표준화 사진 자극보다 강도가 약하다.',
      refs: ['armstrong', 'dedovic', 'kirschbaum', 'lehrer', 'pos', 'mediapipe'],
    },
  };

  const DOMAIN_KEYS = ['alert', 'control', 'emotion', 'autonomic'];
  const HIER = ['alert', 'autonomic', 'control', 'emotion'];
  /* name = 결과지에 보이는 쉬운 이름 · pro = 전문 용어(부제로 함께 표시) */
  const DOMAINS = {
    alert: { name: '또렷함', pro: '각성', en: 'Alertness', network: '경계 네트워크', what: '피곤하지 않고 깨어 있는 정도 — 모든 집중의 바탕이 되는 기본 에너지', refs: ['posner', 'limDinges'], modules: ['alert'] },
    control: { name: '집중 조절', pro: '주의 통제', en: 'Focus control', network: '실행 통제 네트워크', what: '충동적으로 반응하지 않고, 하려던 일에 집중을 유지하는 힘', refs: ['posner', 'munoz', 'robertson'], modules: ['oculo', 'sustain'] },
    emotion: { name: '마음의 시선', pro: '정서 주의', en: 'Emotional attention', network: '정서 자극 정향', what: '불편하거나 기쁜 정보에 눈과 마음이 얼마나 끌리고 머무는지', refs: ['armstrong', 'act'], modules: ['core'] },
    autonomic: { name: '몸의 회복력', pro: '자율신경 조절', en: 'Body recovery', network: '신경내장 조절', what: '긴장할 때 몸(심박)이 얼마나 반응하고, 다시 편안해지는 힘', refs: ['thayerLane', 'dedovic'], modules: ['core'] },
  };

  /* ---------- 지표 정의: band = 좋음 기준점(best) · 양호 한계(ok) · 주의 한계(concern) · 최저점(worst) ---------- */
  const BAND = (dir, best, ok, concern, worst) => ({ dir, best, ok, concern, worst });
  /* 양쪽 범위(mid): 기준값보다 크면 up, 작으면 down 범위로 판정. 정서 자극 응시처럼 ‘너무 많이 봄’과 ‘지나친 회피’가 모두 신호일 때 쓴다 */
  const BAND_MID = (up, down) => ({ dir: 'mid', up, down, best: up.best, ok: up.ok, concern: up.concern, worst: up.worst });
  const bandSide = (b, v) => (b.dir !== 'mid' ? b : v >= b.up.best ? b.up : b.down);
  const INDICATORS = [
    { key: 'pvtLapses', domain: 'alert', w: 2, label: 'PVT 경과 반응 (lapse)', unit: '회/3분', d: 1, band: BAND('low', 0, 3, 7, 16), refs: ['basnerB', 'basner'],
      desc: '355ms 이상 늦은 반응과 무반응의 3분 환산 횟수. PVT에서 각성 저하에 가장 민감한 지표', get: a => a.pvt && a.pvt.lapsesPer3 },
    { key: 'pvtMedian', domain: 'alert', w: 2, label: 'PVT 반응시간 중앙값', unit: 'ms', d: 0, band: BAND('low', 250, 330, 400, 600), refs: ['dinges85', 'basner'],
      desc: '자극 후 반응까지의 중앙값. 브라우저 입력 지연이 포함된 값', get: a => a.pvt && a.pvt.medianRt },
    { key: 'perclos', domain: 'alert', w: 2, label: 'PERCLOS (P80)', unit: '%', d: 1, band: BAND('low', 2, 8, 15, 35), refs: ['wierwille', 'dingesGrace'],
      desc: 'PVT 중 눈꺼풀이 80% 이상 닫혀 있던 시간 비율', get: a => a.eye && a.eye.perclos },
    { key: 'blinkDur', domain: 'alert', w: 1, label: '평균 깜빡임 지속', unit: 'ms', d: 0, band: BAND('low', 120, 300, 450, 800), refs: ['caffier'],
      desc: '졸릴수록 깜빡임이 길어진다. 30fps 해상도(±33ms)', get: a => a.eye && a.eye.blinkMs },
    { key: 'pvtFalse', domain: 'alert', w: 1, label: 'PVT 조기 반응', unit: '회/3분', d: 1, band: BAND('low', 0, 3, 6, 12), refs: ['basner'],
      desc: '자극 전 또는 100ms 미만 반응. 피로를 보상하려는 과잉 반응에서 늘어난다', get: a => a.pvt && a.pvt.falsePer3 },

    { key: 'antiError', domain: 'control', w: 2, label: '안티사카드 방향 오류', unit: '%', d: 0, band: BAND('low', 5, 25, 40, 80), refs: ['munoz', 'antoniades'],
      desc: '반대쪽을 봐야 할 때 표적 쪽으로 먼저 시선이 간 비율. 반사적 반응 억제의 직접 지표', get: a => a.saccade && a.saccade.ok ? a.saccade.anti.errorRate * 100 : null },
    { key: 'sartCommission', domain: 'control', w: 2, label: 'SART 억제 실패', unit: '%', d: 0, band: BAND('low', 10, 40, 60, 90), refs: ['robertson'],
      desc: '숫자 3에서 멈추지 못한 비율. 일상적 주의 실수와 관련', get: a => a.sart && a.sart.commission * 100, count: a => a.sart ? `${a.sart.commits}/${a.sart.nogo}회` : null },
    { key: 'sartDprime', domain: 'control', w: 1, ref: true, label: 'SART 변별력 (d′)', unit: '', d: 2, band: BAND('high', 4, 3, 2.2, 1), refs: ['robertson'],
      desc: '반응 숫자에는 누르고 3에서는 멈추는 구분 능력(신호탐지 d′). 억제 실패율과 달리 빨리 누르는 응답 성향의 영향을 덜 받는다 — 참고 지표',
      get: a => a.sart && !a.sart.invalid ? a.sart.dprime : null, count: a => a.sart && finite(a.sart.criterion) ? `응답 기준 c ${a.sart.criterion}` : null },
    { key: 'sartCv', domain: 'control', w: 2, label: '반응시간 변동성 (CV)', unit: '', d: 2, band: BAND('low', 0.12, 0.25, 0.35, 0.6), refs: ['kofler'],
      desc: '반응시간 표준편차 ÷ 평균. 주의가 순간순간 흔들리는 정도', get: a => a.sart && a.sart.cv },
    { key: 'sartOmission', domain: 'control', w: 1, label: 'SART 누락', unit: '%', d: 1, band: BAND('low', 0, 5, 10, 30), refs: ['robertson'],
      desc: '반응해야 할 숫자를 놓친 비율', get: a => a.sart && a.sart.omission * 100 },
    { key: 'pursuitGain', domain: 'control', w: 1, label: '원활 추적 이득', unit: '', d: 2, band: BAND('high', 1, 0.8, 0.6, 0.2), refs: ['lencer'],
      desc: '표적 움직임 대비 시선 움직임의 크기 (1.0 = 정확한 추적)', get: a => a.pursuit && a.pursuit.ok ? a.pursuit.gain : null },
    { key: 'pursuitErr', domain: 'control', w: 1, label: '추적 동기화 오차', unit: '%', d: 1, band: BAND('low', 3, 8, 14, 30), refs: ['maruta'],
      desc: '추적 중 시선-표적 오차의 흔들림(SD, 화면 폭 대비). 주의 동기화 지표', get: a => a.pursuit && a.pursuit.ok ? a.pursuit.errPct : null },
    /* 원활 추적 2판 참고 지표(ref): 웹캠 규준이 없어 기본은 값·오차 범위만 보여 주고, 세션별 자격 심사(ADMIT)를 넘으면 보조 지표로 판정에 넣는다 */
    { key: 'pursuitLatency', domain: 'control', w: 1, ref: true, label: '방향 전환 반응 지연', unit: 'ms', d: 0, band: BAND('low', 180, 280, 360, 600), refs: ['lencer'],
      desc: '예고 없이 방향을 바꾼 점을 시선이 따라 꺾기까지 걸린 시간(반전 여러 번의 중앙값). 예측이 아닌 반응적 추적의 순발력 — 참고 지표', get: a => a.reversal && a.reversal.ok ? a.reversal.latencyMs : null,
      count: a => a.reversal ? `${a.reversal.valid}/${a.reversal.n}회` : null },
    { key: 'pursuitSpeed', domain: 'control', w: 1, ref: true, label: '추적 속도 유지율', unit: '', d: 2, band: BAND('high', 1, 0.85, 0.7, 0.4), refs: ['lencer'],
      desc: '빠른 단계(0.5Hz) 이득 ÷ 느린 단계(0.2Hz) 이득. 같은 측정 안의 비율이라 보정 축척 오차가 상쇄된다 — 참고 지표', get: a => a.pursuit && a.pursuit.ok ? a.pursuit.speedKeep : null },
    { key: 'circErr', domain: 'control', w: 1, label: '원형 추적 동기화 오차', unit: '%', d: 1, band: BAND('low', 4, 10, 17, 35), refs: ['maruta'],
      desc: '원을 그리며 도는 점을 따라갈 때 시선-표적 2차원 오차의 SD (화면 폭 대비). 주의 동기화·예측적 추적 지표', get: a => a.circle && a.circle.ok ? a.circle.errPct : null },
    { key: 'motion', domain: 'control', w: 1, label: '과제 중 머리 움직임', unit: '%/초', d: 1, band: BAND('low', 0.4, 1.5, 3, 6), refs: ['teicher'],
      desc: 'SART 중 얼굴 폭 대비 1초당 이동량', get: a => a.sartMotion },

    { key: 'bias', domain: 'emotion', w: 2, label: '부정 자극 응시 비율', unit: '%', d: 0, band: BAND_MID(BAND('low', 50, 58, 65, 85), BAND('high', 50, 40, 32, 15)), refs: ['armstrong', 'waechter'],
      desc: '부정-중립 쌍에서 부정 쪽을 본 시간 비율 (50% = 균형). 너무 높으면 몰입, 너무 낮으면 회피 경향', get: a => a.gazeOk && finite(a.attentionBias) ? (a.attentionBias + 0.5) * 100 : null },
    { key: 'lateNeg', domain: 'emotion', w: 2, label: '부정 자극 유지 응시 (1.5초 이후)', unit: '%', d: 0, band: BAND_MID(BAND('low', 50, 58, 66, 85), BAND('high', 50, 38, 30, 12)), refs: ['armstrong', 'kellough'],
      desc: '사진이 뜨고 1.5초가 지난 뒤에도 부정 쪽에 머문 시간 비율. 유지 주의(벗어나기 어려움)의 지표', get: a => a.gazeOk && finite(a.lateNeg) ? a.lateNeg * 100 : null },
    { key: 'firstNeg', domain: 'emotion', w: 1, label: '첫 시선 부정 비율', unit: '%', d: 0, band: BAND('low', 50, 60, 72, 95), refs: ['armstrong'],
      desc: '자극이 뜬 뒤 시선이 먼저 부정 자극으로 간 비율 (초기 정향·경계)', get: a => a.gazeOk && finite(a.firstNeg) ? a.firstNeg * 100 : null },
    { key: 'posBias', domain: 'emotion', w: 1, label: '긍정 자극 응시 비율', unit: '%', d: 0, band: BAND('high', 58, 50, 42, 28), refs: ['armstrong', 'winer'],
      desc: '긍정-중립 쌍에서 긍정 쪽을 본 시간 비율. 낮을수록 기쁜 정보에서 멀어지는 경향', get: a => a.gazeOk && finite(a.positivity) ? (a.positivity + 0.5) * 100 : null },
    { key: 'negHr', domain: 'emotion', w: 1, label: '정서 자극 심박 반응', unit: 'bpm', d: 1, band: BAND('low', 0, 3, 6, 12), refs: ['kreibig'],
      desc: '부정 블록 − 중립 블록 심박', get: a => a.negDelta },

    { key: 'stressDelta', domain: 'autonomic', w: 2, label: '압박 심박 반응', unit: 'bpm', d: 1, band: BAND('low', 2, 6, 12, 25), refs: ['dedovic'],
      desc: '제한 시간 암산 − 기준선 심박. 과도한 반응 여부만 판정한다', get: a => a.stressDelta },
    { key: 'recovery', domain: 'autonomic', w: 2, src: 'recoveryLate', label: '심박 회복률', unit: '%', d: 0, band: BAND('high', 100, 50, 20, -20), refs: ['thayer'],
      desc: '압박으로 오른 심박이 호흡 후 되돌아온 비율. 1 − (회복 후반 − 기준) ÷ (압박 정점 − 기준). 압박 상승이 측정 오차(max 3bpm, 2×SE)보다 작으면 정의되지 않아 계산하지 않는다', get: a => a.recovery },
    { key: 'recoveryResid', domain: 'autonomic', w: 1, src: 'recoveryLate', label: '회복 후 잔여 심박', unit: 'bpm', d: 1, band: BAND('low', 0, 3, 7, 15), refs: ['thayer'],
      desc: '호흡 구간 후반 심박 − 기준 심박. 압박 반응이 작아 회복률을 계산할 수 없을 때도 회복을 판정한다', get: a => a.recoveryResid },
    { key: 'coupling', domain: 'autonomic', w: 1, label: '공명 호흡 심박 동조', unit: 'bpm', d: 1, band: BAND('high', 8, 3, 1.5, 0), refs: ['lehrer'],
      desc: '분당 6회 호흡에 맞춰 심박이 출렁인 폭. 미주신경성 조절의 대리 지표', get: a => a.coupling },
  ];

  /* 기준점 (best 100 · ok 70 · concern 40 · worst 0) 사이 선형 보간 */
  function scoreOf(v, b) {
    if (b.dir === 'mid') return scoreOf(v, bandSide(b, v));
    const s = b.dir === 'low' ? 1 : -1, x = v * s;
    const P = [[b.best * s, 100], [b.ok * s, 70], [b.concern * s, 40], [b.worst * s, 0]];
    if (x <= P[0][0]) return 100;
    if (x >= P[3][0]) return 0;
    for (let i = 0; i < 3; i++) {
      if (x <= P[i + 1][0]) return P[i][1] + (x - P[i][0]) / (P[i + 1][0] - P[i][0]) * (P[i + 1][1] - P[i][1]);
    }
    return 0;
  }
  const statusOf = sc => !finite(sc) ? 'na' : sc >= 70 ? 'ok' : sc >= 40 ? 'watch' : 'concern';
  const STATUS = { ok: '양호', watch: '주의', concern: '관리 필요', na: '측정 안 됨' };
  const SEV = { na: -1, ok: 0, watch: 1, concern: 2 };
  function rangeText(ind) {
    const b = ind.band, f = v => (ind.d >= 2 ? v.toFixed(2) : String(v)) + (ind.unit && ind.unit !== '' && ind.unit.length <= 3 ? ind.unit : '');
    if (b.dir === 'mid') return `양호 ${f(b.down.ok)}~${f(b.up.ok)} · 주의 ${f(b.down.concern)}~${f(b.up.concern)} · 그 밖은 관리 필요`;
    return b.dir === 'low'
      ? `양호 ≤ ${f(b.ok)} · 주의 ≤ ${f(b.concern)} · 관리 필요 > ${f(b.concern)}`
      : `양호 ≥ ${f(b.ok)} · 주의 ≥ ${f(b.concern)} · 관리 필요 < ${f(b.concern)}`;
  }

  /* ---------- 검사별 분석 ---------- */
  /* PVT-B: trials [{onset, rt|null}] + falseStarts(자극 전 반응 수) + durationMs
   * 기기 지연 보정(NL-QC 5): 가장 빠른 10% 반응이 기준(210ms)보다 느린 만큼(상한 60ms)을 키보드·화면 지연으로 보고
   * 중앙값에서 빼고 경과 반응 기준(355ms)에 더한다. 시행이 10개 미만이면 보정하지 않는다. */
  function pvtStats(pvt) {
    if (!pvt || !Array.isArray(pvt.trials) || pvt.trials.length < 5) return null;
    const P = PROTOCOL.pvt, Lc = PROTOCOL.latency, min = (pvt.durationMs || 0) / 60000;
    const rts = pvt.trials.filter(t => finite(t.rt) && t.rt >= P.falseMs).map(t => t.rt);
    if (min < 0.5 || rts.length < 5) return null;
    const sorted = [...rts].sort((a, b) => a - b), k = Math.max(1, Math.round(sorted.length * 0.1));
    const fast10 = mean(sorted.slice(0, k));
    const offset = rts.length >= Lc.minTrials ? Math.round(clamp(fast10 - Lc.fastRef, 0, Lc.maxMs)) : 0;
    const lapseMs = P.lapseMs + offset;
    const early = pvt.trials.filter(t => finite(t.rt) && t.rt < P.falseMs).length;
    const timeouts = pvt.trials.filter(t => !finite(t.rt)).length;
    const lapses = rts.filter(rt => rt >= lapseMs).length + timeouts;
    const falseStarts = (pvt.falseStarts || 0) + early;
    const falsePer3 = round(falseStarts * 3 / min, 1);
    const invalid = falsePer3 > QC.pvtFalseMax ? `자극 전 반응이 너무 많아요 (3분당 ${falsePer3}회) — 무작위로 누른 것으로 보여 판정에서 뺐어요` : null;
    return {
      n: pvt.trials.length, valid: rts.length, medianRt: round(median(rts) - offset), rawMedianRt: round(median(rts)), offset, lapseMs, meanSpeed: round(mean(rts.map(r => 1000 / Math.max(100, r - offset))), 2),
      lapses, timeouts, falseStarts, lapsesPer3: round(lapses * 3 / min, 1), falsePer3, invalid,
      slow10: round(mean(sorted.slice(-k))), fast10: round(fast10), durationMin: round(min, 1),
      rts: pvt.trials.map(t => finite(t.rt) ? Math.round(t.rt) : null),
    };
  }

  /* 눈꺼풀: 개인별 눈 열림 범위(상위 10% = 뜬 눈, 하위 2% = 감은 눈)로 정규화한 닫힘 정도로 PERCLOS(P80)·깜빡임 지속 */
  function eyeStats(frames, start, end) {
    if (!(end - start >= 20000)) return null;
    const all = (frames || []).filter(f => (f.eyeOk ?? f.ok) && finite(f.open));
    if (all.length < 100) return null;
    const opens = all.map(f => f.open);
    const openRef = quantile(opens, 0.9), closedRef = Math.min(quantile(opens, 0.02), openRef * 0.45);
    if (!(openRef > closedRef)) return null;
    const s = all.filter(f => f.t >= start && f.t <= end);
    if (s.length < 60) return null;
    const cl = f => clamp((openRef - f.open) / (openRef - closedRef), 0, 1);
    let closedT = 0, tot = 0, on = null, longN = 0;
    const blinks = [];
    for (let i = 0; i < s.length; i++) {
      const gap=i+1<s.length?s[i+1].t-s[i].t:0;
      if(i>0 && s[i].t-s[i-1].t>200)on=null;
      const dt=gap<=200?gap:0, c=cl(s[i]);
      tot += dt;
      if (c >= PROTOCOL.perclos.closure) closedT += dt;
      if (c >= PROTOCOL.perclos.blink) { if (on === null) on = s[i].t; }
      else if (on !== null) { const d = s[i].t - on; if (d >= 50 && d <= 500) blinks.push(d); else if (d > 500) longN++; on = null; }
    }
    const min = tot / 60000;
    if (!(min > 0)) return null;
    return { coverage: round(N.Signal.timeCoverage(s,start,end), 2), perclos: round(closedT / tot * 100, 1), blinkMs: blinks.length >= 3 ? round(mean(blinks)) : null, blinkRate: round(blinks.length / min, 1), longPerMin: round(longN / min, 1), minutes: round(min, 1) };
  }

  /* 사카드 1시행: 응시점 기준선 대비 첫 이탈의 방향·잠복기.
   * cal = {xL, xC, xR}: 사카드 직전 좌·중·우 응시로 잰 개인별 시선 위치. 있으면 판정 기준을 그 사람의 시선 진폭에 맞춘다
   * (웹캠 회귀는 실제 눈 움직임보다 진폭을 작게 추정하는 경우가 많아, 화면 폭 기준 고정 임계값은 반응을 놓친다). */
  function saccadeThreshold(sd, W, cal, frac = PROTOCOL.saccadeRule.thr) {
    const amp = cal ? Math.abs(cal.xR - cal.xL) / 2 : null;
    if (finite(amp) && amp >= W * 0.05) return clamp(Math.max(frac * amp, 2.5 * sd), W * 0.02, 0.7 * amp);
    return clamp(3 * sd, W * 0.06 * frac / 0.4, W * 0.18);
  }
  /* 웹캠 시선 정리: 깜빡임 제외 → 3점 중앙값(단발 튐 제거). 평균 필터는 사카드 계단을 흐려 잠복기를 앞당기므로 쓰지 않는다 */
  function cleanGaze(samples) { return N.Signal.cleanGaze(samples,{task:'saccade'}); }
  /* 응시 기준점: 표적 직전 400ms(부족하면 700ms) 중앙값 */
  function preFix(tr) {
    if (!finite(tr.onset)) return null;
    const s = cleanGaze(tr.samples);
    let pre = s.filter(p => p.t >= tr.onset - 400 && p.t <= tr.onset + 60).map(p => p.x);
    if (pre.length < 3) pre = s.filter(p => p.t >= tr.onset - 700 && p.t <= tr.onset + 60).map(p => p.x);
    return pre.length >= 3 ? { s, x0: median(pre), sd: std(pre) || 0 } : null;
  }
  /* 사카드 1시행: 응시점 기준선 대비 첫 이탈의 방향·잠복기.
   * cal = {xL, xC, xR}: 그 블록 직전 좌·중·우 응시로 잰 개인 시선 위치 (시행에 tr.cal 이 있으면 그것을 우선).
   * center: 같은 블록 시행들의 응시점 중앙값 — 블록 사이 머리 이동·드리프트로 보정 당시 중심과 달라져도 시행을 버리지 않는다 */
  function saccadeTrial(tr, W, cal, center) {
    const R = PROTOCOL.saccadeRule;
    cal = tr.cal || cal;
    if (!finite(tr.onset)) return { valid: false, reason: 'nodata' };
    const F = preFix(tr);
    if (!F) return { valid: false, reason: 'nofix' };
    const { s, x0, sd } = F;
    const amp = cal ? Math.abs(cal.xR - cal.xL) / 2 : W * 0.35;
    const c = finite(center) ? center : cal && finite(cal.xC) ? cal.xC : W / 2;
    if (Math.abs(x0 - c) > Math.max(W * 0.15, amp * R.offcenter)) return { valid: false, reason: 'offcenter' };
    const post = s.filter(p => p.t > tr.onset + 60 && p.t <= Math.min(finite(tr.end) ? tr.end : Infinity, tr.onset + PROTOCOL.saccade.window));
    const find = thr => {
      for (let i = 0; i < post.length; i++) {
        const d = post[i].x - x0;
        if (Math.abs(d) < thr) continue;
        const nx = post[i + 1];
        if (nx && Math.sign(nx.x - x0) === Math.sign(d) && Math.abs(nx.x - x0) >= thr * R.sustain) return i;
        if (!nx) return i;
      }
      return -1;
    };
    let thr = saccadeThreshold(sd, W, cal), hit = find(thr), weak = false;
    if (hit < 0) {
      thr = Math.max(saccadeThreshold(sd, W, cal, R.weak), 2 * sd);
      hit = find(thr); weak = hit >= 0;
    }
    if (hit < 0) return { valid: false, reason: 'noresp' };
    const p = post[hit], q = hit > 0 ? post[hit - 1] : null;
    let t = p.t;
    if (q) { const a = Math.abs(q.x - x0), b = Math.abs(p.x - x0); if (b > a) t = q.t + (thr - a) / (b - a) * (p.t - q.t); }
    const lat = t - tr.onset;
    if (lat < 80) return { valid: false, reason: 'anticip' };
    const dir = p.x > x0 ? 1 : -1, tdir = tr.side === 'R' ? 1 : -1, want = tr.type === 'anti' ? -tdir : tdir;
    const error = dir !== want;
    const corrected = error && post.slice(hit + 1).some(z => (z.x - x0) * want >= thr);
    return { valid: true, lat: weak ? null : lat, weak, error, corrected };
  }
  /* 블록(같은 type)별 응시점 중앙값 */
  function blockCenters(trials) {
    const out = {};
    ['pro', 'anti'].forEach(type => {
      const x = trials.filter(t => t.type === type).map(preFix).filter(Boolean).map(f => f.x0);
      out[type] = x.length >= 4 ? median(x) : null;
    });
    return out;
  }
  const REASON_KO = { nofix: '응시 표본 부족', offcenter: '가운데를 보지 않음', noresp: '시선 이동 없음', anticip: '표적 전 이동', nodata: '기록 없음' };
  /* 측정 중 품질 확인용: 블록의 유효 시행 비율과 방향 정확도 */
  function saccadeQuick(trials, W, cal) {
    const T = trials || [], C = blockCenters(T);
    const r = T.map(t => ({ type: t.type, r: saccadeTrial(t, W, cal, C[t.type]) })), v = r.filter(x => x.r.valid);
    const reasons = {};
    r.filter(x => !x.r.valid).forEach(x => { reasons[x.r.reason] = (reasons[x.r.reason] || 0) + 1; });
    return { n: r.length, valid: v.length, validRate: r.length ? v.length / r.length : 0, accuracy: v.length ? v.filter(x => !x.r.error).length / v.length : null, reasons };
  }
  function saccadeStats(trials, W, calOk = true, cal = null) {
    const T = (trials || []).filter(t => !t.practice);
    if (!T.some(t => t.type === 'anti')) return null;
    const C = blockCenters(T);
    const res = T.map(t => ({ type: t.type, r: saccadeTrial(t, W, cal, C[t.type]) }));
    const grp = type => {
      const all = res.filter(x => x.type === type), v = all.filter(x => x.r.valid), err = v.filter(x => x.r.error);
      const reasons = {};
      all.filter(x => !x.r.valid).forEach(x => { reasons[x.r.reason] = (reasons[x.r.reason] || 0) + 1; });
      return { n: all.length, valid: v.length, weak: v.filter(x => x.r.weak).length, errors: err.length, corrected: err.filter(x => x.r.corrected).length, latency: round(median(v.filter(x => !x.r.error && finite(x.r.lat)).map(x => x.r.lat))), reasons };
    };
    const pro = grp('pro'), anti = grp('anti');
    pro.accuracy = pro.valid ? round(1 - pro.errors / pro.valid, 2) : null;
    anti.errorRate = anti.valid ? round(anti.errors / anti.valid, 3) : null;
    anti.correctedRate = anti.errors ? round(anti.corrected / anti.errors, 2) : null;
    /* 판정 조건: 보정 성공 + 안티사카드 유효 시행 절반 이상(최소 6) + 프로사카드 방향 정확도 70% 이상(시선 신호가 방향을 구분하는지 확인) */
    const why = g => Object.entries(g.reasons).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${REASON_KO[k] || k} ${n}`).join(' · ');
    let reason = null;
    if (!calOk) reason = '시선 보정이 불안정해 방향 판정을 하지 않았어요';
    else if (anti.valid < Math.max(6, anti.n * 0.5)) reason = `유효 시행이 부족해요 (${anti.valid}/${anti.n}${why(anti) ? ` · 판정 불가 사유: ${why(anti)}` : ''})`;
    else if (pro.valid >= 3 && pro.accuracy < 0.7) reason = `프로사카드 방향 정확도가 낮아(${Math.round(pro.accuracy * 100)}%) 시선 신호를 신뢰하기 어려워요`;
    return {
      pro, anti, ok: !reason, reason, centers: C,
      cost: finite(pro.latency) && finite(anti.latency) ? anti.latency - pro.latency : null,
      trials: res.map(x => ({ type: x.type, valid: x.r.valid, weak: !!x.r.weak, error: !!x.r.error, corrected: !!x.r.corrected, lat: round(x.r.lat), reason: x.r.reason || null })),
    };
  }

  function corr(a, b) {
    const ma = mean(a), mb = mean(b);
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < a.length; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
    return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
  }
  /* 추적 과제용 시선 평활: 표적은 0.25~0.4Hz로 천천히 움직이므로, 그보다 훨씬 빠른 프레임 단위 떨림(웹캠 추정 잡음)은
   * 5표본 중앙값 → 250ms 이동 평균으로 지운다(0.4Hz 원형 표적에서 진폭 손실 1% 미만). 원자료는 그대로 두고 분석용 사본만 만든다 */
  function smoothTrack(s, key) {
    const m5 = s.map((z, i) => { const w = s.slice(Math.max(0, i - 2), i + 3).map(q => q[key]); return median(w); });
    return s.map((z, i) => { const w = []; for (let j = i; j >= 0 && z.t - s[j].t <= 125; j--) w.push(m5[j]); for (let j = i + 1; j < s.length && s[j].t - z.t <= 125; j++) w.push(m5[j]); return mean(w); });
  }
  /* 원활 추적 소요 시간(초, 원형 제외): 속도 단계(단계별 주기 수 ÷ 주파수) + 방향 전환(평균 간격 × 횟수). 1판 기록은 초 그대로 */
  function pursuitSec(d) {
    const P = PROTOCOL.pursuit;
    return Array.isArray(d.pursuit) ? Math.round(d.pursuit.reduce((s, c, i) => s + c / P.levels[i], 0) + (d.reversals || 0) * (P.rev.gapMin + P.rev.gapMax) / 2000 + 1) : d.pursuit;
  }
  /* 사인 표적 회귀: 최적 지연(0~500ms)에서 시선 = 절편 + 이득 × 표적. 이득·상관·잔차 SD(화면 폭 대비) */
  function fitTrack(s, tgt, W) {
    const g = smoothTrack(s, 'x');
    let best = null;
    for (let L = 0; L <= 500; L += 10) { const tg = s.map(z => tgt(z.t - L)), r = corr(tg, g); if (!best || r > best.r) best = { L, r, tg }; }
    const mt = mean(best.tg), mg = mean(g);
    let cov = 0, vt = 0;
    for (let i = 0; i < g.length; i++) { cov += (best.tg[i] - mt) * (g[i] - mg); vt += (best.tg[i] - mt) ** 2; }
    const gain = cov / vt, resid = g.map((v, i) => v - (mg + gain * (best.tg[i] - mt)));
    return { gain, r: best.r, lagMs: best.L, errPct: std(resid) / W * 100, g };
  }
  /* 머리 동조: 과제 중 얼굴 회전(yaw)이 표적과 함께 움직인 정도(|상관|). 머리가 점을 따라 돌면 눈 자체는 덜 움직이는데,
   * 시선 모델은 머리 자세 특징을 강하게 수축해 두어(HEAD_RIDGE) 시선 이동 폭이 작게 잡힌다 → 이득이 낮아 보일 수 있다 */
  function headFollow(frames, tgt, a, b) {
    const f = (frames || []).filter(x => x.t >= a && x.t <= b && finite(x.yaw) && (x.faceOk ?? x.ok));
    if (f.length < 30) return null;
    return round(Math.abs(corr(f.map(x => tgt(x.t)), f.map(x => x.yaw))), 2);
  }
  /* 원활 추적 2판 · 속도 단계: 단계별 이득과 전 단계를 이은 대표 이득(pursuitGain 의 값). 속도 유지율 = 0.5Hz 이득 ÷ 0.2Hz 이득 —
   * 같은 측정 안의 비율이라 보정 축척 오차(화면 대비 시선 폭이 전체적으로 작게·크게 잡힌 것)가 상쇄된다 */
  function ladderStats(p, frames, calOk = true) {
    const P = PROTOCOL.pursuit, W = p.W, skip = P.skipMs;
    const tgtOf = b => t => p.cx + p.amp * Math.sin(2 * Math.PI * b.freq * (t - b.t0) / 1000);
    const lv = p.levels.map((b, i) => {
      const s = N.Signal.cleanGaze(b.samples, { task: 'pursuit', W }).filter(z => z.t >= b.t0 + (i ? 400 : skip) && z.t <= b.t0 + b.dur);
      const cov = N.Signal.timeCoverage(s, b.t0 + (i ? 400 : skip), b.t0 + b.dur);
      if (s.length < 30) return { freq: b.freq, ok: false, coverage: round(cov, 2) };
      const f = fitTrack(s, tgtOf(b), W);
      return { freq: b.freq, ok: f.r >= 0.35, gain: round(f.gain, 2), r: round(f.r, 2), lagMs: f.lagMs, errPct: round(f.errPct, 1), coverage: round(cov, 2), s, tgt: tgtOf(b) };
    });
    const use = lv.filter(l => l.s);
    const t0 = p.levels[0].t0, end = p.levels.at(-1).t0 + p.levels.at(-1).dur;
    const tgtAll = t => { const b = p.levels.filter(x => t >= x.t0).at(-1) || p.levels[0]; return tgtOf(b)(t); };
    const hf = headFollow(frames, tgtAll, t0, end);
    const coverage = round(mean(lv.map(l => l.coverage || 0)), 2);
    const out = { version: 2, levels: lv.map(({ s, tgt, ...l }) => l), headFollow: hf, coverage, ruleVersion: 'pursuit-ladder-1' };
    const all = use.flatMap(l => l.s);
    if (all.length < 60) return { ...out, ok: false, reason: '시선 표본이 부족해요' };
    const f = fitTrack(all, tgtAll, W);
    const first = lv[0], last = lv.at(-1);
    out.speedKeep = first.ok && last.ok && first.gain > 0.2 ? round(last.gain / first.gain, 2) : null;
    const step = Math.max(1, Math.floor(all.length / 240));
    out.trace = all.filter((_, i) => i % step === 0).map(z => ({ t: round((z.t - t0) / 1000, 2), g: round((z.x - p.cx) / p.amp, 3), tg: round((tgtAll(z.t) - p.cx) / p.amp, 3) }));
    let reason = null;
    if (!calOk) reason = '시선 보정이 불안정해 추적 지표를 판정하지 않았어요';
    else if (coverage < 0.5) reason = '얼굴·시선 인식 구간이 부족해요';
    else if (f.r < 0.35) reason = `시선이 표적과 거의 함께 움직이지 않았어요 (r=${f.r.toFixed(2)})`;
    return { ...out, ok: !reason, reason, gain: round(f.gain, 2), lagMs: f.lagMs, r: round(f.r, 2), errPct: round(f.errPct, 1) };
  }
  /* 원활 추적 2판 · 불규칙 방향 전환: 반전마다 [-pre, +post]ms 시선(보정 좌표, 안정화 전)에 '꺾인 두 직선'을 맞춰 꺾인 시각 − 반전 시각 = 반응 지연.
   * 반전 전·후 기울기가 각각 표적 방향과 같고 표적 속도의 30% 이상일 때만(실제로 따라간 반전만) 쓴다. 대표값은 중앙값 */
  function reversalStats(rv, W, calOk = true) {
    if (!rv || !Array.isArray(rv.turns) || !rv.turns.length) return null;
    const P = PROTOCOL.pursuit.rev, v = rv.speed;
    const s = N.Signal.cleanGaze(rv.samples, { task: 'pursuit', W });
    const ev = rv.turns.filter(u => u.kind === 'random').map(u => {
      const w = s.filter(z => z.t > u.t - P.pre && z.t < u.t + P.post);
      if (w.length < 10) return null;
      let best = null;
      for (let k = 0; k <= 500; k += 10) {
        const tk = u.t + k, A = w.filter(z => z.t < tk), Bq = w.filter(z => z.t >= tk);
        if (A.length < 3 || Bq.length < 3) continue;
        const fit = q => { const mt = mean(q.map(z => z.t)), mx = mean(q.map(z => z.x)); let sxy = 0, sxx = 0; q.forEach(z => { sxy += (z.t - mt) * (z.x - mx); sxx += (z.t - mt) ** 2; }); const b = sxy / sxx; return { b, sse: q.reduce((a2, z) => a2 + (z.x - (mx + b * (z.t - mt))) ** 2, 0) }; };
        const fa = fit(A), fb = fit(Bq), sse = fa.sse + fb.sse;
        if (!best || sse < best.sse) best = { k, sse, ba: fa.b * 1000, bb: fb.b * 1000 };
      }
      if (!best) return null;
      const followed = Math.sign(best.ba) === u.from && Math.sign(best.bb) === -u.from && Math.abs(best.ba) >= 0.3 * v && Math.abs(best.bb) >= 0.3 * v;
      return followed ? best.k : null;
    });
    const lat = ev.filter(finite), n = rv.turns.filter(u => u.kind === 'random').length;
    const res = { n, valid: lat.length, latencyMs: lat.length ? Math.round(median(lat)) : null, iqrMs: lat.length >= 4 ? [Math.round(quantile(lat, 0.25)), Math.round(quantile(lat, 0.75))] : null, ruleVersion: 'pursuit-reversal-1' };
    const reason = !calOk ? '시선 보정이 불안정해 반응 지연을 판정하지 않았어요' : lat.length < 6 ? `따라간 방향 전환이 ${lat.length}회뿐이라 반응 지연을 판정하지 않았어요` : null;
    return { ...res, ok: !reason, reason };
  }
  /* 원활 추적: 최적 지연(0~500ms)에서의 이득(기울기)과 이득 보정 후 잔차 SD */
  function pursuitStats(p, calOk = true) {
    if (!p || !Array.isArray(p.samples) || !finite(p.t0)) return null;
    const { t0, cx, amp, freq, dur, W } = p, skip = PROTOCOL.pursuit.skipMs;
    const tgt = t => cx + amp * Math.sin(2 * Math.PI * freq * (t - t0) / 1000);
    const s = N.Signal.cleanGaze(p.samples,{task:'pursuit',W}).filter(z => z.t >= t0 + skip && z.t <= t0 + dur);
    const coverage = round(N.Signal.timeCoverage(s,t0+skip,t0+dur),2);
    if (s.length < 60) return { ok: false, reason: '시선 표본이 부족해요', coverage };
    const g = smoothTrack(s, 'x');
    let best = null;
    for (let L = 0; L <= 500; L += 10) {
      const tg = s.map(z => tgt(z.t - L)), r = corr(tg, g);
      if (!best || r > best.r) best = { L, r, tg };
    }
    const mt = mean(best.tg), mg = mean(g);
    let cov = 0, vt = 0;
    for (let i = 0; i < g.length; i++) { cov += (best.tg[i] - mt) * (g[i] - mg); vt += (best.tg[i] - mt) ** 2; }
    const gain = cov / vt, icpt = mg - gain * mt;
    const resid = g.map((v, i) => v - (icpt + gain * best.tg[i]));
    const errPct = std(resid) / W * 100;
    const step = Math.max(1, Math.floor(s.length / 240));
    const trace = s.filter((_, i) => i % step === 0).map(z => ({ t: round((z.t - t0) / 1000, 2), g: round((z.x - cx) / amp, 3), tg: round((tgt(z.t) - cx) / amp, 3) }));
    let reason = null;
    if (!calOk) reason = '시선 보정이 불안정해 추적 지표를 판정하지 않았어요';
    else if (coverage < 0.5) reason = '얼굴·시선 인식 구간이 부족해요';
    else if (best.r < 0.35) reason = `시선이 표적과 거의 함께 움직이지 않았어요 (r=${best.r.toFixed(2)})`;
    return { ok: !reason, reason, gain: round(gain, 2), lagMs: best.L, r: round(best.r, 2), errPct: round(errPct, 1), coverage, trace };
  }

  /* 원형 추적: 표적 (cx + r·cosθ, cy + r·sinθ), θ = 2πf·t − π/2 (위에서 시작해 시계 방향).
   * 최적 지연(0~400ms)에서 축별로 이득·영점을 맞춘 뒤 남는 2차원 오차의 SD(화면 폭 대비)를 동기화 오차로 쓴다 (Maruta et al., 2010) */
  function circleStats(c, W, calOk = true) {
    if (!c || !Array.isArray(c.samples) || !finite(c.t0)) return null;
    const { t0, cx, cy, r, freq, dur } = c, skip = PROTOCOL.circle.skipMs;
    const tgt = t => { const a = 2 * Math.PI * freq * (t - t0) / 1000 - Math.PI / 2; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
    const s = N.Signal.cleanGaze(c.samples,{task:'pursuit',W}).filter(z => z.t >= t0 + skip && z.t <= t0 + dur && finite(z.x) && finite(z.y));
    const coverage = round(N.Signal.timeCoverage(s,t0+skip,t0+dur),2);
    if (s.length < 50) return { ok: false, reason: '시선 표본이 부족해요', coverage };
    /* 떨림 평활 후, 첫 맞춤의 잔차가 3 MAD를 넘는 표본(순간 튐·깜빡임 직후)을 빼고 다시 맞춘다 */
    let gx = smoothTrack(s, 'x'), gy = smoothTrack(s, 'y');
    let best = null;
    for (let L = 0; L <= 400; L += 10) {
      const tp = s.map(z => tgt(z.t - L)), rx = corr(tp.map(p => p[0]), gx), ry = corr(tp.map(p => p[1]), gy);
      if (!best || rx + ry > best.rx + best.ry) best = { L, rx, ry, tp };
    }
    const fit = (tv, gv) => { const mt = mean(tv), mg = mean(gv); let cov = 0, vt = 0; for (let i = 0; i < gv.length; i++) { cov += (tv[i] - mt) * (gv[i] - mg); vt += (tv[i] - mt) ** 2; } const k = cov / vt; return { k, res: gv.map((v, i) => v - (mg + k * (tv[i] - mt))) }; };
    let fx = fit(best.tp.map(p => p[0]), gx), fy = fit(best.tp.map(p => p[1]), gy);
    {
      const e = fx.res.map((v, i) => Math.hypot(v, fy.res[i])), me = median(e), mad = median(e.map(v => Math.abs(v - me))) || 1;
      const keep = e.map(v => v <= me + 3 * 1.4826 * mad);
      if (keep.filter(Boolean).length >= 40) {
        const sel = a => a.filter((_, i) => keep[i]), tp = sel(best.tp);
        fx = fit(tp.map(p => p[0]), sel(gx)); fy = fit(tp.map(p => p[1]), sel(gy));
      }
    }
    const errPct = Math.sqrt(std(fx.res) ** 2 + std(fy.res) ** 2) / W * 100;
    const step = Math.max(1, Math.floor(s.length / 200));
    const trace = s.map((z, i) => ({ x: gx[i], y: gy[i] })).filter((_, i) => i % step === 0).map(z => ({ x: round((z.x - cx) / r, 2), y: round((z.y - cy) / r, 2) }));
    let reason = null;
    if (!calOk) reason = '시선 보정이 불안정해 원형 추적 지표를 판정하지 않았어요';
    else if (coverage < 0.5) reason = '얼굴·시선 인식 구간이 부족해요';
    else if (best.rx < 0.35 || best.ry < 0.15) reason = `시선이 원을 따라 움직이지 않았어요 (가로 r=${best.rx.toFixed(2)} · 세로 r=${best.ry.toFixed(2)})`;
    return { ok: !reason, reason, gainX: round(fx.k, 2), gainY: round(fy.k, 2), lagMs: best.L, rx: round(best.rx, 2), ry: round(best.ry, 2), errPct: round(errPct, 1), coverage, trace };
  }

  /* MIST 방식 암산 (Dedovic et al., 2005) — 덧셈·뺄셈만, 답은 항상 0~9 한 자리. 난이도는 수의 자릿수와 항 수로 올린다.
   *   1: 한 자리 2항 (7 − 3)    2: 한 자리 3항 (8 − 5 + 4)    3: 두 자리 − 한 자리 (14 − 9)
   *   4: 두 자리 2항 (47 − 39)   5: 두 자리 2항 ± 한 자리 (52 − 46 + 3)
   * 정답률이 너무 낮으면 압박 대신 포기가 일어나므로, 계산 단계는 최대 2번으로 묶는다 */
  function mistProblem(level, rand = Math.random) {
    const ri = (a, b) => a + Math.floor(rand() * (b - a + 1));
    /* 6: 고난도 — 두 자리 3항 ± 한 자리 (64 − 29 − 31 + 2). 매 측정에 1~2문제를 반드시 넣어 실패 경험(사회평가적 압박)을 만든다 */
    if (level === 6) {
      for (let tries = 0; tries < 5000; tries++) {
        const a = ri(41, 98), b = ri(12, 59), c = ri(12, 49), d = ri(1, 9), sb = rand() < 0.5 ? 1 : -1, sd = rand() < 0.5 ? 1 : -1;
        const ans = a - b + sb * c + sd * d;
        if (ans >= 0 && ans <= 9 && a - b > 0) return { level, hard: true, text: `${a} − ${b} ${sb > 0 ? '+' : '−'} ${c} ${sd > 0 ? '+' : '−'} ${d}`, ans };
      }
      return { level, hard: true, text: '73 − 48 − 19 + 1', ans: 7 };
    }
    const LV = { 1: ['n1', 'n1'], 2: ['n1', 'n1', 'n1'], 3: ['n2', 'n1'], 4: ['n2', 'n2'], 5: ['n2', 'n2', 'n1'] }[level] || ['n1', 'n1'];
    for (let tries = 0; tries < 600; tries++) {
      const nums = LV.map(k => (k === 'n1' ? ri(1, 9) : ri(11, level >= 4 ? 69 : 39)));
      const signs = nums.map((_, i) => (i === 0 ? 1 : rand() < 0.5 ? 1 : -1));
      if (level >= 3 && !signs.includes(-1)) continue;                      // 두 자리 문제는 뺄셈을 하나 이상 포함
      let ans = 0, text = '', ok = true;
      for (let i = 0; i < nums.length; i++) {
        ans += signs[i] * nums[i];
        if (i > 0 && ans < 0 && level <= 2) ok = false;                     // 쉬운 문제는 중간값이 음수가 되지 않게
        text += i === 0 ? String(nums[i]) : ` ${signs[i] > 0 ? '+' : '−'} ${nums[i]}`;
      }
      if (ok && ans >= 0 && ans <= 9) return { level, text, ans };
    }
    const a = ri(0, 9), b = ri(0, 9 - a);
    return { level, text: `${a} + ${b}`, ans: a + b };
  }
  /* MIST 제한 시간: 정답이면 8% 단축, 오답·시간 초과면 12% 연장 (정답률 약 60%로 수렴) */
  function mistNext(limit, ok) {
    const P = PROTOCOL.stress;
    return ok ? Math.max(P.minMs, Math.round(limit * (1 - P.down))) : Math.min(P.maxMs, Math.round(limit * (1 + P.up)));
  }
  /* 시작 제한 시간: 연습 정답 응답 시간 평균 × 0.9. 정답이 2개 미만이면 기본값 */
  function mistStart(rts) {
    const P = PROTOCOL.stress, v = (rts || []).filter(finite);
    return v.length >= 2 ? clamp(Math.round(mean(v) * P.startFactor), P.minMs, P.maxMs) : P.limitMs;
  }

  /* SART: trials [{digit, onset, rt|null}] — 응답 창은 숫자+빈 화면 1150ms */
  /* 3의 비율 = 1/9 + nogoBoost(반올림), 나머지 반응 숫자 8개는 같은 수. 순서는 무작위. 다만 3은 연속으로 나오지 않고 앞에 반응 숫자가 2개 이상 오며,
   * 전반·후반에 같은 수로 나눈다 — 위치에 따른 우연한 변동(예: 후반 3연속)을 줄여 적은 거부 시행에서도 비교가 안정적이게 */
  function sartCount(n) { return Math.round(n * (1 / 9 + (PROTOCOL.sart.nogoBoost || 0))); }
  function sartSequence(n, rand = Math.random) {
    const nogo = PROTOCOL.sart.nogo, k = sartCount(n), goDigits = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter(d => d !== nogo);
    const go = Array.from({ length: n - k }, (_, i) => goDigits[i % goDigits.length]);
    for (let i = go.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [go[i], go[j]] = [go[j], go[i]]; }
    const places = new Set(), halves = [[0, Math.floor(n / 2), Math.ceil(k / 2)], [Math.floor(n / 2), n, Math.floor(k / 2)]];
    for (const [a, b, m] of halves) {
      if (!m) continue;
      const slack = Math.max(0, (b - a) - 2 - 3 * (m - 1) - 1);                     // 구간 시작 뒤 2칸, 3끼리 최소 3칸 간격
      const s = Array.from({ length: m }, () => Math.floor(rand() * (slack + 1))).sort((x, y) => x - y);
      s.forEach((v, i) => places.add(Math.min(b - 1, a + 2 + 3 * i + v)));
    }
    let gi = 0;
    return Array.from({ length: n }, (_, i) => (places.has(i) ? nogo : go[gi++ % go.length]));
  }
  /* 표준정규 역함수 (Acklam 근사, 상대오차 < 1.2e-9) */
  function zInv(p) {
    const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239],
      b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572],
      c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783],
      d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416], pl = 0.02425;
    if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    if (p > 1 - pl) return -zInv(1 - p);
    const q = p - 0.5, r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  function sartStats(sart) {
    const T = sart && Array.isArray(sart.trials) ? sart.trials : [];
    if (T.length < 18) return null;
    const nogo = T.filter(t => t.digit === PROTOCOL.sart.nogo), go = T.filter(t => t.digit !== PROTOCOL.sart.nogo);
    if (nogo.length < 2 || go.length < 10) return null;
    const rts = go.filter(t => finite(t.rt) && t.rt >= 100).map(t => t.rt);
    const m = mean(rts), sd = std(rts);
    const omission = go.filter(t => !finite(t.rt)).length / go.length;
    /* 실패 전 가속 (Robertson et al., 1997; Cheyne et al., 2009): 억제 실패 직전 반응 4개가 평소(반응 시행 평균)보다 얼마나 빨랐는지.
     * 거부 시행 수보다 훨씬 많은 반응 시행을 쓰므로 실패율보다 안정적이다. 양수 = 실패 직전에 빨라짐(자동 반응) */
    const pre = [];
    T.forEach((t, i) => { if (t.digit === PROTOCOL.sart.nogo && finite(t.rt)) T.slice(Math.max(0, i - 4), i).forEach(p => { if (p.digit !== PROTOCOL.sart.nogo && finite(p.rt) && p.rt >= 100) pre.push(p.rt); }); });
    const commits = nogo.filter(t => finite(t.rt)).length, hits = go.filter(t => finite(t.rt)).length;
    /* 신호탐지 (Stanislaw & Todorov, 1999; 로그-선형 보정 Hautus, 1995): 반응 숫자에 누른 비율 H, 3에 누른 비율 F.
     * 변별력 d′ = z(H) − z(F) — 억제 실패율만 보면 '빨리 누르는 응답 성향'과 '멈추지 못함'이 섞인다(Helton, 2009; Seli et al., 2012).
     * 응답 기준 c = −(z(H) + z(F))/2, 음수일수록 '일단 누르는' 쪽 */
    const zH = zInv((hits + 0.5) / (go.length + 1)), zF = zInv((commits + 0.5) / (nogo.length + 1));
    return {
      n: T.length, nogo: nogo.length, go: go.length, commits, dprime: round(zH - zF, 2), criterion: round(-(zH + zF) / 2, 2),
      preErrorSpeedup: pre.length >= 4 && rts.length >= 10 ? round(m - mean(pre)) : null,
      invalid: omission > QC.sartOmitMax ? `반응해야 할 숫자의 ${Math.round(omission * 100)}%에 반응하지 않았어요 — 과제를 따라가지 못한 것으로 보여 판정에서 뺐어요` : null,
      commission: round(commits / nogo.length, 3),
      omission: round(omission, 3),
      meanRt: round(m), sdRt: round(sd), cv: rts.length >= 10 ? round(sd / m, 3) : null,
      rts: T.map(t => ({ rt: finite(t.rt) ? Math.round(t.rt) : null, nogo: t.digit === PROTOCOL.sart.nogo })),
    };
  }

  /* ---------- 통합 해석 ---------- */
  const HEAD = {
    alert: { title: '피로 회복 우선형', lead: '모든 집중의 바탕인 또렷함(각성)이 낮게 측정됐어요. 피곤하면 집중과 감정 조절도 함께 흔들리기 때문에, 다른 결과보다 먼저 수면과 휴식으로 기본 에너지를 되찾는 것이 우선이에요.' },
    control: { title: '집중 흔들림형', lead: '충동을 누르고 하려던 일에 집중을 붙잡아 두는 힘(주의 통제)이 낮았어요. 피곤해서라기보다, 집중을 조절하는 힘 자체에 부담이 쌓인 패턴이에요.' },
    emotion: { title: '마음 쏠림형', lead: '불편한 정보에 눈과 마음이 먼저 가고 오래 머무는 경향(정서 주의 편향)이 두드러졌어요. 걱정이나 곱씹는 생각이 조용히 에너지를 쓰고 있을 수 있어요.' },
    autonomic: { title: '몸 긴장형', lead: '긴장되는 상황에서 심박이 크게 오르거나 다시 편안해지는 데 시간이 걸렸어요(자율신경 조절). 마음보다 몸이 먼저, 그리고 오래 긴장하는 패턴이에요.' },
    balanced: { title: '균형 조절형', lead: '측정한 네 가지가 모두 참고 범위 안이었어요. 또렷함·집중 조절·마음의 시선·몸의 회복력이 균형을 이루고 있어요. 지금 상태를 나의 기준으로 남겨 두면 나중의 변화를 민감하게 알아챌 수 있어요.' },
    insufficient: { title: '통합 해석 보류', lead: '측정된 영역이 2개 미만이라 영역 사이의 관계를 해석하지 않았어요. 측정된 지표만 참고하고, 가능한 검사를 더 포함해 다시 측정해 보세요.' },
  };
  const PATHWAYS = {
    fatigue: { title: '피로가 집중·마음을 끌어내림 (피로 게이팅)', refs: ['limDinges', 'yoo'],
      text: w => `또렷함이 낮은 상태에서 ${w}도 함께 낮았어요. 수면 부족은 주의 통제와 정서 조절 수행을 함께 떨어뜨리는 것으로 알려져 있어, 이번 결과의 일부는 피로의 영향일 수 있습니다. 충분히 쉰 뒤 같은 시간대에 재측정하면 두 원인을 구분할 수 있어요.` },
    act: { title: '불편한 정보에 끌림 ↔ 멈추는 힘 약해짐 (주의 통제 이론)', refs: ['act', 'derakshan'],
      text: () => '부정 자극으로 주의가 쏠리는 경향과 반응 억제의 약화가 함께 나타났어요. 주의 통제 이론은 불안이 목표 지향적 주의(억제 기능)를 약화시키고 자극 주도적 주의를 강화한다고 설명합니다. 정서 편향과 주의 통제를 함께 다루는 케어가 효율적이에요.' },
    nvi: { title: '집중 조절 ↔ 몸의 회복력이 함께 낮음 (신경내장 통합)', refs: ['thayerLane', 'thayer'],
      text: () => '집중 조절과 몸의 회복력이 함께 낮았어요. 신경내장 통합 모델은 전전두엽의 억제 회로가 인지 통제와 미주신경성 심장 조절을 함께 담당한다고 봅니다. 호흡·심박 조절 훈련이 주의 통제에도 도움이 될 수 있는 근거입니다.' },
    perseverative: { title: '곱씹는 생각 ↔ 오래가는 몸의 긴장 (지속 인지 가설)', refs: ['brosschot', 'armstrong'],
      text: () => '부정 정보에 머무는 주의와 큰 신체 반응·느린 회복이 함께 나타났어요. 지속 인지 가설은 걱정·반추가 스트레스성 생리 활성을 연장시킨다고 설명합니다. 반추를 줄이는 개입과 신체 이완을 함께 권합니다.' },
  };
  const CARE_PLAN = {
    alert: { title: '피로 회복 트랙', goal: '또렷함을 먼저 되찾아 다른 영역을 정확히 다시 봅니다.',
      items: [
        { text: '2주간 기상 시각을 ±30분 안에 고정하고, 잠자리에서 깨어 있는 시간을 줄이기 (CBT-I의 수면 제한·자극 조절 원리)', refs: ['trauer'] },
        { text: '오후 졸림이 심한 날 10분 이내 짧은 낮잠 (15시 이전)', refs: ['brooks'] },
        { text: '고집중 작업 전 3분 PVT로 상태 확인 — 경과 반응이 ‘주의’ 이상이면 작업 순서를 조정', refs: ['basnerB'] },
      ], kpi: 'PVT 경과 반응 3분당 3회 이하 · PERCLOS 8% 이하', remeasure: '같은 시간대에 2~3일 간격 또는 매주 · 2주 뒤 첫 측정과 비교' },
    control: { title: '집중력 트랙', goal: '충동을 멈추는 힘과 집중을 유지하는 힘을 키웁니다.',
      items: [
        { text: '마음챙김 주의 훈련 하루 10분 (호흡에 주의를 두고, 벗어나면 알아차려 되돌리기)', refs: ['tang'] },
        { text: '중강도 유산소 운동 주 3회 30분 — 실행 기능 향상 근거가 가장 일관된 생활 개입', refs: ['hillman'] },
        { text: '알림을 끄고 25분 단일 과제 블록으로 일하기 (주의 전환 비용 줄이기)', refs: [] },
      ], kpi: 'SART 억제 실패 40% 이하 · 반응시간 변동성 0.25 이하 · 안티사카드 오류 25% 이하', remeasure: '2~3일 간격 또는 매주 · 4주 뒤 첫 측정과 비교' },
    emotion: { title: '마음 전환 트랙', goal: '불편한 정보에서 마음을 떼어내는 유연성을 키웁니다.',
      items: [
        { text: '주의 전환 연습 하루 2분 — 부정 자극 반대편 표적에 반응하는 주의 편향 수정(ABM) 형식. 효과 크기는 작게 보고되므로 다른 루틴과 병행', refs: ['hakamata', 'cristea'] },
        { text: '걱정 시간 정하기 — 반추를 하루 정해진 15분으로 모으기', refs: ['borkovec'] },
        { text: '생각 라벨링: “나는 지금 ~라는 생각을 하고 있다”로 거리 두기', refs: ['tang'] },
      ], kpi: '부정 자극 응시 58% 이하', remeasure: '2~3일 간격 또는 매주 · 2주 뒤 첫 측정과 비교' },
    autonomic: { title: '몸 이완 트랙', goal: '긴장 뒤 심박이 빨리 편안해지는 회복력을 키웁니다.',
      items: [
        { text: '분당 6회 공명 호흡 하루 2회 5분 (들숨 5초 · 날숨 5초)', refs: ['lehrer', 'zaccaro'] },
        { text: '4주 심박 바이오피드백 — 호흡 중 심박이 출렁이는 폭을 키우는 연습', refs: ['goessl'] },
        { text: '긴장된 일정 직후 90초 몸 스캔으로 회복 구간 만들기', refs: [] },
      ], kpi: '압박 심박 반응 6bpm 이하 또는 회복률 50% 이상 · 호흡 동조 3bpm 이상', remeasure: '2~3일 간격 또는 매주 · 2주 뒤 첫 측정과 비교' },
    balanced: { title: '유지 관리 트랙', goal: '지금의 균형을 개인 기준선으로 남깁니다.',
      items: [
        { text: '같은 시간대에 2~3일 간격 또는 매주 측정해 개인 기준선 쌓기', refs: [] },
        { text: '분당 6회 호흡은 긴장된 일정 전후에만 3분', refs: ['zaccaro'] },
        { text: '수면 규칙성 유지 — 각성은 다른 모든 영역의 토대', refs: ['limDinges'] },
      ], kpi: '모든 영역 양호 유지', remeasure: '전체 측정 · 2~3일 간격 또는 매주' },
  };

  function domainNames(keys) { return keys.map(k => DOMAINS[k].name).join('·'); }

  function integrate(domains, indicators, base, checkin) {
    const st = k => domains[k].status;
    const fl = k => SEV[st(k)] >= 1;
    const measured = DOMAIN_KEYS.filter(k => st(k) !== 'na');
    const flagged = measured.filter(fl).sort((x, y) => (domains[x].tentative ? 1 : 0) - (domains[y].tentative ? 1 : 0) || SEV[st(y)] - SEV[st(x)] || domains[x].score - domains[y].score || HIER.indexOf(x) - HIER.indexOf(y));
    let primary = flagged[0] || null;
    /* 피로 게이팅: 각성이 가장 심한 영역과 같은 수준이면 각성을 먼저 다룬다 (Lim & Dinges, 2010) */
    if (primary && primary !== 'alert' && fl('alert') && !domains.alert.tentative && SEV[st('alert')] >= SEV[st(primary)]) primary = 'alert';
    const secondary = flagged.filter(k => k !== primary)[0] || null;
    const code = measured.length < 2 ? 'insufficient' : primary || 'balanced';

    const ind = key => indicators.find(i => i.key === key);
    const inhibitionWeak = SEV[ind('antiError').status] >= 1 || SEV[ind('sartCommission').status] >= 1;
    const pathways = [];
    if (fl('alert') && (fl('control') || fl('emotion'))) pathways.push({ key: 'fatigue', ...PATHWAYS.fatigue, text: PATHWAYS.fatigue.text(domainNames(['control', 'emotion'].filter(fl))) });
    if (fl('emotion') && inhibitionWeak) pathways.push({ key: 'act', ...PATHWAYS.act, text: PATHWAYS.act.text() });
    if (fl('control') && fl('autonomic')) pathways.push({ key: 'nvi', ...PATHWAYS.nvi, text: PATHWAYS.nvi.text() });
    if (fl('emotion') && fl('autonomic')) pathways.push({ key: 'perseverative', ...PATHWAYS.perseverative, text: PATHWAYS.perseverative.text() });

    /* 자기보고 ↔ 실측 불일치: 긴장(내수용 인식) · 졸림(주관적 졸림의 과소평가) */
    const mismatches = [];
    if (base.mismatch) mismatches.push({ key: 'tension-' + base.mismatch.kind, title: '느끼는 긴장 ↔ 몸의 반응', text: base.mismatch.text, refs: ['garfinkel'], aligned: base.mismatch.kind === 'aligned' });
    const kss = checkin && finite(checkin.kss) ? checkin.kss : null;
    if (kss !== null && st('alert') !== 'na') {
      if (kss <= 5 && fl('alert')) mismatches.push({ key: 'sleep-unaware', title: '느끼는 졸림 ↔ 실제 또렷함', text: `스스로 느끼는 졸림(KSS ${kss}/9)은 크지 않았지만 각성 지표는 저하돼 있었어요. 수면이 부족하면 주관적 졸림은 일찍 적응해 버리지만 수행 저하는 계속 쌓이는 것으로 알려져 있어, 느낌보다 측정을 기준으로 휴식을 계획하는 것이 안전해요.`, refs: ['vanDongen', 'kss'] });
      else if (kss >= 7 && !fl('alert')) mismatches.push({ key: 'sleep-subjective', title: '느끼는 졸림 ↔ 실제 또렷함', text: `졸림을 크게 느꼈지만(KSS ${kss}/9) 각성 수행은 참고 범위 안이었어요. 지루함·의욕 저하 같은 요인이 졸림으로 느껴지고 있을 수 있어요.`, refs: ['kss'] });
      else mismatches.push({ key: 'sleep-aligned', title: '느끼는 졸림 ↔ 실제 또렷함', text: `스스로 느끼는 졸림(KSS ${kss}/9)과 각성 수행이 대체로 일치했어요.`, refs: ['kss'], aligned: true });
    }

    return { code, ...HEAD[code], primary: code === 'insufficient' ? null : primary, secondary: code === 'insufficient' ? null : secondary, measured, flagged, pathways, mismatches };
  }

  /* ---------- 측정 맥락: 어젯밤 수면 · 마지막 카페인 · 측정 시각 ----------
   * 각성 지표(PVT·PERCLOS)는 수면량, 카페인, 하루 중 시각의 영향을 크게 받는다 (Van Dongen et al., 2003; Wesensten et al., 2002;
   * Blatter & Cajochen, 2007). 점수를 바꾸지 않고, 결과를 ‘일시적 상태’로 볼지 ‘지속 패턴’으로 볼지 해석을 돕는다 */
  const CONTEXT = {
    sleep: { lt5: '5시간 미만', '5to6': '5~6시간', '6to7': '6~7시간', '7to8': '7~8시간', gt8: '8시간 이상' },
    caffeine: { none: '오늘 안 마심', lt1: '1시간 이내', '1to3': '1~3시간 전', '3to6': '3~6시간 전', gt6: '6시간 이상 전' },
  };
  function contextNotes(checkin, measuredAt, fl) {
    const c = checkin || {}, out = [];
    const short = c.sleep === 'lt5' || c.sleep === '5to6', recentCaf = c.caffeine === 'lt1' || c.caffeine === '1to3';
    if (CONTEXT.sleep[c.sleep]) {
      if (short && fl('alert')) out.push({ key: 'sleep-short-low', title: '어젯밤 수면 ↔ 또렷함 저하', text: `어젯밤 수면이 ${CONTEXT.sleep[c.sleep]}이었어요. 이번 각성 저하의 상당 부분은 하룻밤 수면 부족의 영향일 수 있어요. 충분히 잔 다음 날 같은 시간대에 다시 재 보면 일시적인 상태인지 지속되는 패턴인지 구분할 수 있어요.`, refs: ['vanDongen', 'limDinges'] });
      else if (short) out.push({ key: 'sleep-short-ok', title: '어젯밤 수면 ↔ 또렷함 유지', text: `수면이 ${CONTEXT.sleep[c.sleep]}으로 짧았지만 각성 수행은 유지됐어요. 다만 수면 부족은 며칠 쌓이면 수행이 계단식으로 떨어지는 것으로 알려져 있어 오늘은 무리하지 않는 편이 좋아요.`, refs: ['vanDongen'] });
      else if (fl('alert')) out.push({ key: 'sleep-ok-low', title: '어젯밤 수면 ↔ 또렷함 저하', text: `수면 시간(${CONTEXT.sleep[c.sleep]})은 부족하지 않았는데 각성이 낮게 나왔어요. 수면의 질, 측정 시각, 피로 누적을 함께 살펴볼 필요가 있어요.`, refs: ['limDinges'] });
    }
    if (CONTEXT.caffeine[c.caffeine] && recentCaf) {
      out.push({ key: fl('alert') ? 'caffeine-low' : 'caffeine-ok', title: '최근 카페인', text: fl('alert')
        ? `카페인을 ${CONTEXT.caffeine[c.caffeine]}에 마셨는데도 각성이 낮게 나왔어요. 카페인이 가린 피로가 더 클 수 있어 휴식이 우선이에요.`
        : `카페인을 ${CONTEXT.caffeine[c.caffeine]}에 마셨어요. 카페인은 반응 속도와 경계 수행을 일시적으로 끌어올리므로, 이번 각성 결과는 평소보다 좋게 나왔을 수 있어요. 재측정은 카페인 조건을 맞춰 주세요.`, refs: ['wesensten'] });
    }
    const d = measuredAt ? new Date(measuredAt) : null, hr = d && !isNaN(d) ? d.getHours() : null;
    if (hr !== null && fl('alert') && ((hr >= 13 && hr < 16) || hr >= 23 || hr < 7)) {
      out.push({ key: 'time-dip', title: '측정 시각', text: hr >= 13 && hr < 16 ? '오후 1~4시는 생체리듬상 각성이 잠시 떨어지는 시간대예요. 같은 결과라도 오전에 다시 재면 차이가 날 수 있어요.' : '늦은 밤·이른 새벽은 생체리듬상 각성이 가장 낮은 시간대예요. 낮 시간대 재측정과 비교해 보세요.', refs: ['blatter'] });
    }
    return out;
  }

  /* ---------- 설명 가능성: 영역 점수 분해 + 판정 경계까지의 거리 ----------
   * 영역 점수 = Σ (가중치 × 신뢰도 × 지표 점수) / Σ (가중치 × 신뢰도) 이므로, 지표별 기여(점)를 그대로 나눠 보여 줄 수 있다 */
  function explainDomain(k, indicators) {
    const m = indicators.filter(i => i.domain === k && i.value !== null && !i.excluded && !i.ref);
    const wsum = m.reduce((s, i) => s + (i.primary ? 2 : 1) * i.r, 0);
    if (!(wsum > 0)) return [];
    return m.map(i => {
      const share = (i.primary ? 2 : 1) * i.r / wsum;
      return { key: i.key, label: i.label, status: i.status, share: round(share * 100), points: round(share * i.score, 1), score: i.score, value: i.value, unit: i.unit, d: i.d, next: i.next || null };
    }).sort((a, b) => b.share - a.share);
  }
  /* 지금 판정보다 한 단계 좋아지려면 지표가 얼마여야 하는가 */
  function nextBand(ind, v) {
    const b = bandSide(ind.band, v), st = statusOf(scoreOf(v, b));
    if (st === 'ok') return null;
    const target = st === 'concern' ? b.concern : b.ok;
    return { to: st === 'concern' ? 'watch' : 'ok', target, text: `${ind.d >= 2 ? target.toFixed(2) : target}${ind.unit || ''} ${b.dir === 'low' ? '이하' : '이상'}이면 ‘${STATUS[st === 'concern' ? 'watch' : 'ok']}’` };
  }

  /* 정서 사진 모드: 부정 블록 안의 위협·슬픔 자극을 따로 집계 (불안은 위협, 우울은 슬픔 자극 편향과 관련; Armstrong & Olatunji, 2012) */
  function emoSub(rec, W, gazeOk) {
    if (!gazeOk) return [];
    const out = [];
    [['threat', '위협 자극 응시 비율'], ['dysphoric', '슬픔·상실 자극 응시 비율']].forEach(([sub, label]) => {
      const st = (rec.trials || []).filter(t => t.kind === 'neg' && t.sub === sub).map(t => N.trialStats(t, W)).filter(x => x.valid);
      if (st.length >= 3) out.push({ label, value: round(mean(st.map(x => x.emoShare)) * 100), unit: '%', refs: sub === 'dysphoric' ? ['armstrong', 'kellough'] : ['armstrong'] });
    });
    return out;
  }

  /* ---------- 최근 2주 자기보고: PHQ-2 → (3점 이상) PHQ-8 ----------
   * 문구: 환자 건강 질문지-9 한국어판 (© 2005 Pfizer; 허가 없이 사용 가능). 9번(자해 사고) 문항은 위기 대응 체계 없이
   * 비대면으로 묻지 않도록 제외한 PHQ-8 을 쓴다 (Kroenke et al., 2009). 2단계 실시: Levis et al., 2020.
   * 점수는 영역 점수에 섞지 않고, 측정 영역과의 대조와 케어 우선순위(상담 안내)에만 쓴다. */
  const PHQ = {
    stem: '지난 2주 동안, 아래 나열되는 증상들에 얼마나 자주 시달렸습니까?',
    options: ['전혀 아니다', '여러 날 동안', '일주일 이상', '거의 매일'],
    items: [
      '일 또는 여가 활동을 하는 데 흥미나 즐거움을 느끼지 못함',
      '기분이 가라앉거나, 우울하거나, 희망이 없음',
      '잠이 들거나 계속 잠을 자는 것이 어려움, 또는 잠을 너무 많이 잠',
      '피곤하다고 느끼거나 기운이 거의 없음',
      '입맛이 없거나 과식을 함',
      '자신을 부정적으로 봄 - 혹은 자신이 실패자라고 느끼거나 자신 또는 가족을 실망시킴',
      '신문을 읽거나 텔레비전 보는 것과 같은 일에 집중하는 것이 어려움',
      '다른 사람들이 주목할 정도로 너무 느리게 움직이거나 말을 함. 또는 반대로 평상시보다 많이 움직여서, 너무 안절부절 못하거나 들떠 있음',
    ],
    screenCut: 3,                        // PHQ-2 ≥ 3 → 나머지 6문항 (Kroenke et al., 2003)
    bands: [[4, '낮음'], [9, '가벼움'], [14, '중간'], [19, '높음'], [24, '매우 높음']],   // PHQ-8 0–24 구간 (Kroenke et al., 2009)
    consultCut: 10,                      // PHQ-8 ≥ 10 → 전문가 상담 안내 (Kroenke et al., 2009; 한국판 절단점 10, 박승진 외, 2010)
    copyright: '환자 건강 질문지(PHQ) © Pfizer Inc. · 허가 없이 사용 가능 (phqscreeners.com) · 한국어판 문항을 바탕으로 질문·선택지 표현을 자연스럽게 다듬음 (점수 0~3 동일) · 9번 문항 제외(PHQ-8)',
  };
  /* 문항 ↔ 측정 영역 연결 (자기보고와 객관 측정의 대조) */
  const PHQ_LINKS = [
    { items: [0, 1], domain: 'emotion', label: '흥미 저하 · 우울감', measure: '정서 주의 (부정·슬픔 자극 체류)' },
    { items: [2, 3], domain: 'alert', label: '수면 문제 · 피로', measure: '각성 (PVT · PERCLOS)' },
    { items: [6], domain: 'control', label: '집중 곤란', measure: '주의 통제 (SART · 안티사카드)' },
    { items: [7], domain: 'control', label: '느려짐 · 안절부절', measure: '주의 통제 (반응 속도 · 머리 움직임)' },
  ];
  function phqScore(checkin) {
    const a = checkin && Array.isArray(checkin.phq) ? checkin.phq : null;
    if (!a || !finite(a[0]) || !finite(a[1])) return null;
    const phq2 = a[0] + a[1];
    const full = a.length >= 8 && a.slice(0, 8).every(finite);
    const phq8 = full ? a.slice(0, 8).reduce((x, y) => x + y, 0) : null;
    const band = phq8 === null ? null : PHQ.bands.find(([hi]) => phq8 <= hi)[1];
    return { items: a.slice(0, 8), phq2, screen: phq2 >= PHQ.screenCut, phq8, band, consult: phq8 !== null && phq8 >= PHQ.consultCut };
  }
  const LINK_TEXT = {
    both: '스스로 느끼는 어려움과 측정 결과가 함께 나타났어요.',
    self: '스스로는 어려움을 느끼지만 측정에서는 드러나지 않았어요. 부담감이 실제 수행보다 앞서 있을 수 있어요.',
    measure: '스스로 느끼는 어려움은 크지 않았지만 측정에서는 저하가 보였어요. 자각보다 먼저 나타나는 신호일 수 있어요.',
    none: '자기보고와 측정 모두 두드러지지 않았어요.',
    na: '연결된 측정 영역이 측정되지 않았어요.',
  };
  function phqLinks(phq, domains) {
    if (!phq) return [];
    return PHQ_LINKS.map(L => {
      const vals = L.items.map(i => phq.items[i]);
      if (!vals.every(finite)) return null;
      const self = Math.max(...vals) >= 2;                 // '일주일 이상' 이상
      const d = domains[L.domain], measured = !!d && d.status !== 'na', low = measured && SEV[d.status] >= 1;
      const kind = !measured ? 'na' : self && low ? 'both' : self ? 'self' : low ? 'measure' : 'none';
      return { ...L, score: vals.reduce((x, y) => x + y, 0), max: vals.length * 3, self, kind, text: LINK_TEXT[kind], status: measured ? d.status : 'na' };
    }).filter(Boolean);
  }
  const SAFETY_TRACK = {
    domain: 'safety', title: '전문가 상담 연결', goal: '최근 2주 기분 부담이 높게 보고됐어요. 측정 기반 루틴보다 먼저 전문가와 이야기해 보기를 권합니다.',
    items: [
      { text: '가까운 정신건강복지센터나 정신건강의학과에서 상담 받아 보기 — 이 결과지를 함께 보여 주면 도움이 돼요', refs: ['phq8'] },
      { text: '힘든 마음이 급하게 커지면 언제든 정신건강 위기상담 109 (24시간)', refs: [] },
      { text: '상담과 함께 아래 루틴을 무리하지 않는 선에서 병행하기', refs: [] },
    ],
    kpi: '2~4주 후 같은 문항으로 다시 확인', remeasure: '자기보고 + 전체 측정 · 2~3일 간격 또는 매주',
  };

  /* NL-QC 1·3) 신뢰도 가중 영역 점수 + 수렴 원칙.
   * list = 그 영역의 지표들 [{primary, value, score, status, r, borderline, excluded}] */
  function aggregateDomain(k, indicators) {
    const list = indicators.filter(i => i.domain === k && !i.ref && !i.notApplicable), m = list.filter(i => i.value !== null && !i.excluded);
    const prim = list.filter(i => i.primary), mp = prim.filter(i => i.value !== null && !i.excluded);
    const wAll = list.reduce((s, i) => s + (i.primary ? 2 : 1), 0) || 1;
    const conf = round(m.reduce((s, i) => s + (i.primary ? 2 : 1) * i.r, 0) / wAll, 2);
    const d = { key: k, ...DOMAINS[k], measured: m.length, total: list.length, coverage: prim.length ? round(mp.length / prim.length, 2) : 0, partial: mp.length < prim.length, confidence: m.length ? conf : 0, notes: [] };
    if (!m.length) return { ...d, score: null, status: 'na', tentative: false };
    const wsum = m.reduce((s, i) => s + (i.primary ? 2 : 1) * i.r, 0);
    const score = m.reduce((s, i) => s + i.score * (i.primary ? 2 : 1) * i.r, 0) / wsum;
    let status = statusOf(score);
    const firm = i => !i.borderline && i.r >= 0.8;
    if (status === 'ok' && mp.some(i => i.status === 'concern' && firm(i))) { status = 'watch'; d.notes.push('핵심 지표 하나가 ‘관리 필요’여서 평균이 양호해도 ‘주의’로 표시했어요'); }
    if (status === 'concern') {
      const support = new Set(m.filter(i => SEV[i.status] >= 1).map(i => i.src || i.key)).size;   // 같은 측정값에서 나온 지표(회복률·잔여 심박)는 근거 1개
      if (support < 2 && !mp.some(i => i.status === 'concern' && firm(i))) { status = 'watch'; d.notes.push('저하를 가리키는 지표가 하나뿐이라 수렴 원칙에 따라 ‘주의’로 낮췄어요'); }
    }
    const tentative = d.confidence < QC.tentative;
    if (tentative) d.notes.push(`측정 신뢰도가 낮아(${Math.round(d.confidence * 100)}%) 잠정 결과로만 보세요`);
    return { ...d, score: round(score), status, tentative };
  }

  /* ---------- 전체 분석 ----------
   * rec = core 기록(frames, phases, trials, calibration, checkin, screenW, demo) + {pursuit, saccade, pvt, sart, steps, stressScore, sim}
   * phases 에는 실제로 끝까지 수행한 구간만 담는다 (건너뛴 구간은 지운 상태로 전달). */
  function run(rec) {
    /* NL-QC 6) 화면이 가려졌던 구간(탭 전환·창 전환)과 겹친 시행은 판정에서 뺀다 */
    const hidden = (rec.hidden || []).filter(h => finite(h.start) && finite(h.end) && h.end > h.start);
    const hid = t => hidden.some(h => t >= h.start - 500 && t <= h.end + 1500);
    let dropped = 0;
    if (hidden.length) {
      const keep = arr => (arr || []).filter(t => { const bad = hid(t.onset); if (bad) dropped++; return !bad; });
      const overlap = (a, b) => hidden.reduce((s, h) => s + Math.max(0, Math.min(b, h.end) - Math.max(a, h.start)), 0);
      rec = { ...rec, frames: (rec.frames||[]).map(f=>hid(f.t)?{...f,ok:false,ppgOk:false,eyeOk:false,faceOk:false}:f), trials: keep(rec.trials), saccade: rec.saccade ? keep(rec.saccade) : rec.saccade, sart: rec.sart ? { ...rec.sart, trials: keep(rec.sart.trials) } : rec.sart };
      if (rec.pvt && rec.phases && rec.phases.pvt) rec.pvt = { ...rec.pvt, trials: keep(rec.pvt.trials), durationMs: Math.max(0, rec.pvt.durationMs - overlap(rec.phases.pvt.start, rec.phases.pvt.end)) };
      if (rec.pursuit) rec.pursuit = { ...rec.pursuit, samples: (rec.pursuit.samples || []).filter(z => !hid(z.t)),
        ...(rec.pursuit.levels ? { levels: rec.pursuit.levels.map(b => ({ ...b, samples: b.samples.filter(z => !hid(z.t)) })) } : {}),
        ...(rec.pursuit.reversal ? { reversal: { ...rec.pursuit.reversal, samples: rec.pursuit.reversal.samples.filter(z => !hid(z.t)) } } : {}), ...(rec.pursuit.circle ? { circle: { ...rec.pursuit.circle, samples: rec.pursuit.circle.samples.filter(z => !hid(z.t)) } } : {}) };
    }
    const base = N.analyze(rec);
    const ph = rec.phases || {};
    const span = k => ph[k] && finite(ph[k].start) && finite(ph[k].end) ? [ph[k].start, ph[k].end] : null;
    const frames = rec.frames || [], face = frames.filter(f => f.faceOk ?? f.ok), W = rec.screenW;
    const cal = rec.calibration, calOk = !!cal && (cal.grade === 'good' || cal.grade === 'fair');

    const pvt = pvtStats(rec.pvt);
    const eye = span('pvt') ? eyeStats(frames, ...span('pvt')) : null;
    const eyeBase = span('baseline') ? eyeStats(frames, ...span('baseline')) : null;
    const saccade = saccadeStats(rec.saccade, W, calOk, rec.saccadeCal || null);
    const pursuit = rec.pursuit && rec.pursuit.levels ? ladderStats({ W, ...rec.pursuit }, frames, calOk) : pursuitStats(rec.pursuit ? { W, ...rec.pursuit } : null, calOk);
    const reversal = rec.pursuit && rec.pursuit.reversal ? reversalStats(rec.pursuit.reversal, W, calOk) : null;
    const circle = circleStats(rec.pursuit && rec.pursuit.circle, W, calOk);
    const sart = sartStats(rec.sart);
    const sartMotion = span('sart') ? N.motionIndex(face, ...span('sart')) : null;

    const a = { pvt, eye, saccade, pursuit, reversal, circle, sart, sartMotion, gazeOk: base.quality.gazeOk, attentionBias: base.gaze.attentionBias, firstNeg: base.gaze.firstNeg, lateNeg: base.gaze.lateNeg, positivity: base.gaze.positivity,
      negDelta: base.negDelta, stressDelta: base.stressDelta, recovery: base.recovery, recoveryResid: base.recoveryResid, coupling: base.coupling ? base.coupling.ampBpm : null };

    /* NL-QC 1) 지표별 신뢰도 r · 2) 표준오차 */
    const negSt = (rec.trials || []).filter(t => t.kind === 'neg').map(t => N.trialStats(t, W)).filter(x => x.valid);
    const negN = (rec.trials || []).filter(t => t.kind === 'neg').length;
    const posSt = (rec.trials || []).filter(t => t.kind === 'pos').map(t => N.trialStats(t, W)).filter(x => x.valid);
    const posN = (rec.trials || []).filter(t => t.kind === 'pos').length;
    /* NL-QC 7) 단계별 카메라 프레임 수: 시선 지표는 12fps 이상에서 온전히, 그 아래는 비례(하한 0.25배).
     * battery 1.6 (사카드 24→12, 추적·정서 보기 15→12): 실측 19세션 시선 표본을 솎아 fps 를 절반(약 7fps)으로 낮춰도
     * 사카드 방향 판정 97.6%(1,190시행), 정서 응시 비율 판정 33/34·긍정 34/34·유지 응시 30/34, 추적 오차 19/19·원형 추적 29/29 가 같았다.
     * fps 에 민감한 것은 잠복기(1/3 로 솎으면 |차| 중앙 36ms)인데 잠복기는 판정에 쓰지 않는다 */
    const fpsOf = k => { const sp = span(k); if (!sp) return null; const n = frames.filter(f => (f.faceOk ?? f.ok) && f.t >= sp[0] && f.t <= sp[1]).length; return n / Math.max(1, (sp[1] - sp[0]) / 1000); };
    const fpsF = k => { const v = fpsOf(k); return v === null ? 1 : clamp(v / 12, 0.25, 1); };
    const sartFrames = span('sart') ? N.Signal.timeCoverage(face,...span('sart')) : 0;
    /* 구간 심박 신뢰도: 이전 식(창 신뢰도 × 유효 시간 × (1−보간))에 정밀도 기준을 더해 큰 쪽을 쓴다.
     * 정밀도 = 1 − SE/5bpm, SE = 창 간 퍼짐 ÷ √(독립 10초 창 수) — 창 하나하나는 약해도 많은 창이 1~2bpm 안에서 일치하면 구간 평균은 정밀하다
     * (2026-10-05 실측 NLR-4950…: 기준선 15창·퍼짐 1.6bpm, 압박 28창·1.4bpm 인데 이전 식으로는 0.31). 약한 신호는 절반, 창 3개 미만은 0.3 상한,
     * 세션 흐름으로 이어 낸 값(inferred)은 그 신뢰도(≤0.3) 그대로, 구간 차이 지표에서 한쪽이 inferred 면 다시 절반(infF) */
    const hqOld = q => (q.confidence ?? QC.hrQ[q.quality] ?? 0) * (finite(q.effectiveSeconds) ? clamp(q.effectiveSeconds/12,.65,1) : 1) * (1-(q.recovered||0));
    const hq = q => {
      if (!q || q.bpm === null) return 0;
      if (q.status === 'inferred') return q.confidence || 0;
      if (!finite(q.spreadBpm) || !finite(q.effectiveSeconds)) return hqOld(q);
      const se = Math.max(0.5, q.spreadBpm) / Math.sqrt(Math.max(1, q.effectiveSeconds / 10));
      // 1초 간격으로 겹친 창들은 같은 자료라 오답도 함께 '일치'한다(합성 검증: 유효 13초·창 3~4개가 퍼짐 0.4~1.5bpm 인데 21~30bpm 틀림).
      // 그래서 정밀도는 겹치지 않는 관측이 쌓일수록만 믿는다: 유효 8초 이하 0 → 25초 이상 1
      let r = clamp(1 - se / 5, 0, 1) * clamp(((q.validSeconds || 0) - 8) / 17, 0, 1) * (1 - 0.5 * (q.recovered || 0));
      if (q.status === 'weak-signal') r *= 0.5;
      if ((q.n || 0) < 3) r = Math.min(r, 0.3);
      return Math.max(hqOld(q), r);
    };
    const refHr = base.hrRef === 'pre' ? base.hr.pre : base.hr.baseline;
    const infF = (...qs) => qs.some(q => q && q.status === 'inferred') ? 0.5 : 1;
    /* NL-QC 8) 공명 호흡 순응: 카메라로 잰 호흡 리듬이 뚜렷한데 분당 6회(0.1Hz)에서 벗어나 있으면 호흡 동조 지표를 판정하지 않는다
     * (따라 하지 않은 사람의 ‘동조 약함’을 조절력 부족으로 오해하지 않기 위해) */
    const resp = base.resp, breathOff = !!(resp && resp.clear && Math.abs(resp.hz - 0.1) > 0.03);
    /* 반분 안정성(홀·짝 시행 부정 응시 비율 차): 시행 수로 기대되는 우연 차이(SD_D = 시행 SD × √(4/n))의 2배를 넘을 때만 신뢰도를 낮춘다.
     * battery 1.7: 이전 고정 기준(0.08 초과부터 감점)은 실측 17세션 중 10세션을 깎았는데, 관측 차이는 순수 우연 기대와 같았다
     * (z 평균 0.67 · 우연만으로 ≈0.80 · z>2 는 1세션). 표본 불확실성은 이미 오차 띠(SE·95% 구간)로 표시되므로 신뢰도에서 다시 깎지 않는다 */
    const halfF = () => {
      const g = base.gaze.halfGapNeg, v = negSt.map(x => x.emoShare).filter(finite);
      if (!finite(g) || v.length < 4) return 1;
      const sdD = Math.max(0.05, std(v) * Math.sqrt(4 / v.length));
      return clamp(1 - (g / sdD - 2) / 2, 0.5, 1);
    };
    const rOf = {
      pvt: () => pvt && !pvt.invalid ? clamp(pvt.valid / 30, 0, 1) : 0,
      eye: () => eye ? clamp((eye.coverage - 0.4) / 0.4, 0, 1) : 0,
      anti: () => saccade && saccade.ok ? clamp((saccade.anti.valid - saccade.anti.weak * 0.5) / Math.max(8, saccade.anti.n * 0.8), 0, 1) * fpsF('saccade') : 0,
      sart: () => sart && !sart.invalid ? clamp(sart.n / 54, 0, 1) : 0,
      pursuit: () => pursuit && pursuit.ok ? clamp(pursuit.coverage / 0.8, 0, 1) * clamp((pursuit.r - 0.3) / 0.4, 0.25, 1) * fpsF('pursuit') : 0,
      circle: () => circle && circle.ok ? clamp(circle.coverage / 0.8, 0, 1) * clamp((Math.min(circle.rx, circle.ry + 0.25) - 0.3) / 0.4, 0.25, 1) * fpsF('pursuit') : 0,
      motion: () => clamp((sartFrames - 0.4) / 0.4, 0, 1),
      gaze: () => a.gazeOk && negN ? clamp(negSt.length / negN / 0.8, 0, 1) * fpsF('neg') * halfF() : 0,
      gazePos: () => a.gazeOk && posN ? clamp(posSt.length / posN / 0.8, 0, 1) * fpsF('pos') : 0,
    };
    /* 머리 동조 감점: 이득과 속도 유지율(느린 단계에서 머리가 더 따라 돌아 >1 이 됨)에 같이 쓴다 */
    const headF = () => pursuit && finite(pursuit.headFollow) ? clamp(1 - (pursuit.headFollow - 0.3) / 0.4, 0.15, 1) : 1;
    const REL = {
      pvtLapses: rOf.pvt, pvtMedian: rOf.pvt, pvtFalse: () => pvt ? clamp(pvt.valid / 30, 0, 1) : 0, perclos: rOf.eye, blinkDur: rOf.eye,
      antiError: rOf.anti, sartCommission: () => sart && !sart.invalid ? clamp(sart.nogo / 12, 0, 1) : 0, sartCv: rOf.sart,   // 억제 실패는 거부 시행(3) 수로 신뢰도를 정한다: 빠른 모드 6회면 1회가 17%p sartOmission: () => sart ? clamp(sart.n / 54, 0, 1) : 0,
      /* 이득은 머리가 표적을 따라 돌수록(머리 동조 |r| 0.3→0.7) 신뢰도를 낮춘다 — 눈 대신 머리가 움직이면 시선 폭이 작게 잡힌다 */
      pursuitGain: () => rOf.pursuit() * headF(), pursuitErr: rOf.pursuit, circErr: rOf.circle, motion: rOf.motion,
      pursuitSpeed: () => rOf.pursuit() * headF(), sartDprime: () => sart && !sart.invalid ? clamp(sart.nogo / 12, 0, 1) : 0, pursuitLatency: () => reversal && reversal.ok ? clamp(reversal.valid / Math.max(10, reversal.n), 0, 1) * fpsF('pursuit') : 0,   // 프로토콜 10회 기준(이전 /12 는 10/10 이어도 0.83)
      bias: rOf.gaze, lateNeg: rOf.gaze, firstNeg: rOf.gaze, posBias: rOf.gazePos, negHr: () => Math.min(hq(base.hr.neu), hq(base.hr.neg)) * infF(base.hr.neu, base.hr.neg),
      stressDelta: () => Math.min(hq(refHr), hq(base.hr.stress)) * infF(refHr, base.hr.stress), recovery: () => Math.min(hq(base.hr.stress), hq(base.hr.recoveryLate)) * infF(base.hr.stress, base.hr.recoveryLate),   // 압박 반응이 오차보다 작으면 회복률 자체를 계산하지 않는다(core recoveryNA)
      recoveryResid: () => Math.min(hq(refHr), hq(base.hr.recoveryLate)) * infF(refHr, base.hr.recoveryLate), coupling: () => (breathOff ? 0 : hq(base.hr.recovery) * (base.coupling && base.coupling.ratio < 0.3 ? 0.3 : 1)),   // 0.1Hz 대역 비율이 낮으면 진폭은 박동 시각 잡음일 가능성이 커 판정에서 사실상 뺀다(minR 아래)
    };
    const hrSe = q => q && finite(q.bpm) && finite(q.spreadBpm) ? Math.max(0.5, q.spreadBpm) / Math.sqrt(Math.max(1, (q.effectiveSeconds || q.validSeconds || 10) / 10)) : null;
    const hrDiffSe = (a1, b1) => { const x = hrSe(a1), y = hrSe(b1); return finite(x) && finite(y) ? Math.hypot(x, y) : null; };
    const binSe = (p, n) => { if (!(n > 0) || !finite(p)) return null; const q = (p * n + 2) / (n + 4); return Math.sqrt(q * (1 - q) / (n + 4)) * 100; };   // Agresti–Coull
    const SE = {
      pvtLapses: () => pvt ? Math.sqrt(Math.max(1, pvt.lapses)) * 3 / Math.max(0.5, pvt.durationMin) : null,
      pvtFalse: () => pvt ? Math.sqrt(Math.max(1, pvt.falseStarts)) * 3 / Math.max(0.5, pvt.durationMin) : null,   // 빠른 모드 90초: 1건 차이가 3분 환산 2회
      /* 회복률 = 1 − (L − B)/(P − B) 의 델타법 오차(L 회복 후반·B 기준·P 압박 정점, 각각 구간 심박 SE) */
      recovery: () => { const L = base.recoverySrc === 'whole' ? base.hr.recovery : base.hr.recoveryLate, P = base.hr.stressPeak, sL = hrSe(L), sB = hrSe(refHr), sP = hrSe(base.hr.stress);
        if (![sL, sB, sP, P].every(finite) || !refHr) return null; const rise = P - refHr.bpm; if (!(rise > 0)) return null;
        return 100 * Math.hypot(sL / rise, (L.bpm - P) / rise ** 2 * sB, (L.bpm - refHr.bpm) / rise ** 2 * sP); },
      antiError: () => saccade && saccade.ok ? binSe(saccade.anti.errorRate, saccade.anti.valid) : null,
      sartCommission: () => sart ? binSe(sart.commission, sart.nogo) : null,
      /* 심박 차이 지표의 오차: 구간별 창 간 퍼짐(spreadBpm) ÷ √(독립 10초 창 수). 신뢰도가 낮아 판정에서 빠져도 값과 범위는 함께 남긴다 */
      negHr: () => hrDiffSe(base.hr.neu, base.hr.neg), stressDelta: () => hrDiffSe(refHr, base.hr.stress), recoveryResid: () => hrDiffSe(refHr, base.hr.recoveryLate),
      pursuitLatency: () => reversal && reversal.iqrMs ? (reversal.iqrMs[1] - reversal.iqrMs[0]) / 1.35 * 1.25 / Math.sqrt(reversal.valid) : null,   // 중앙값 표준오차 ≈ 1.25·σ/√n
      sartOmission: () => sart ? binSe(sart.omission, sart.go) : null,
      bias: () => negSt.length >= 3 ? std(negSt.map(x => x.emoShare)) / Math.sqrt(negSt.length) * 100 : null,
      lateNeg: () => { const v = negSt.map(x => x.lateShare).filter(finite); return v.length >= 3 ? std(v) / Math.sqrt(v.length) * 100 : null; },
      posBias: () => posSt.length >= 3 ? std(posSt.map(x => x.emoShare)) / Math.sqrt(posSt.length) * 100 : null,
      firstNeg: () => { const f = negSt.filter(x => x.first); return f.length ? binSe(f.filter(x => x.first === 'emo').length / f.length, f.length) : null; },
    };
    /* 해당 없음(측정 실패가 아님): 정의상 계산할 수 없는 지표는 영역 점수·신뢰도의 분모에서 뺀다 */
    /* negHr: 빠른 모드의 중립 블록(3시행 ≈ 14초)은 독립 10초 창 2개를 만들 수 없어 심박 차이를 정의할 수 없다(실측 19세션 중 18세션 r<0.5) —
     * 프로토콜상 측정하지 않는 지표로 둔다. 중립 블록이 20초 이상(표준 모드)이면 그대로 판정한다 */
    const neuSec = span('neu') ? (span('neu')[1] - span('neu')[0]) / 1000 : null;
    const NA = { recovery: base.recoveryNA || null, negHr: finite(neuSec) && neuSec < 20 ? { reason: 'neutral-block-too-short', sec: round(neuSec, 0) } : null };
    const indicators = INDICATORS.map(ind => {
      const raw = NA[ind.key] ? null : ind.get(a), has = finite(raw), v = has ? round(raw, ind.d) : null, sc = has ? scoreOf(v, ind.band) : null;
      const r = has ? round(REL[ind.key] ? REL[ind.key]() : 1, 2) : null;
      const se = has && SE[ind.key] ? SE[ind.key]() : null;
      const ci = finite(se) ? [round(v - 1.96 * se, ind.d), round(v + 1.96 * se, ind.d)] : null;
      const cuts = ind.band.dir === 'mid' ? [ind.band.up.ok, ind.band.up.concern, ind.band.down.ok, ind.band.down.concern] : [ind.band.ok, ind.band.concern];
      const borderline = !!ci && cuts.some(cut => ci[0] < cut && cut < ci[1]);
      const excluded = has && r < QC.minR;
      const notApplicable = !!NA[ind.key];
      const admitted = !!ind.ref && has && !excluded && r >= ADMIT.minR && !!ADMIT.plausible[ind.key] && ADMIT.plausible[ind.key](v);
      return { key: ind.key, domain: ind.domain, ref: !!ind.ref && !admitted, ...(ind.ref ? { admitted } : {}), src: ind.src || ind.key, label: ind.label, unit: ind.unit, d: ind.d, refs: ind.refs, desc: ind.desc, primary: ind.w === 2,
        value: v, count: has && ind.count ? ind.count(a) : null, score: excluded ? null : round(sc), status: excluded ? 'na' : statusOf(sc), range: rangeText(ind), r, ci, borderline: !excluded && borderline, excluded, ...(notApplicable ? { notApplicable: NA[ind.key] } : {}),
        next: has && !excluded ? nextBand(ind, v) : null };
    });

    const domains = {};
    DOMAIN_KEYS.forEach(k => { domains[k] = aggregateDomain(k, indicators); });
    /* SART 속도-정확성: 억제 실패가 많아도 응답 기준이 매우 관대하고(c < −0.6) 반응이 빠르면(평균 < 330ms) '빨리 누르는 전략'의 몫이 크다 */
    if (sart && !sart.invalid && sart.commission >= 0.4 && finite(sart.criterion) && sart.criterion < -0.6 && sart.meanRt < 330 && domains.control.status !== 'na')
      domains.control.notes.push(`SART에서 숫자 3을 놓친 비율이 높지만 반응이 빠르고(평균 ${sart.meanRt}ms) ‘일단 누르는’ 쪽이었어요(응답 기준 c ${sart.criterion}). 실패의 일부는 주의 저하보다 빠르게 누르는 전략에서 왔을 수 있어요 · 변별력 d′ ${sart.dprime}`);
    if (domains.autonomic.status !== 'na') {
      if (base.hrRef === 'pre') domains.autonomic.notes.push(base.hr.pre.context === 'pre-task-rest' ? '압박 과제 직전 30초 안정 구간의 심박을 비교 기준으로 썼어요 (몇 분 전 기준선보다 바로 직전 상태가 더 정확한 비교라서)' : base.hr.pre.context === 'pre-task-instructions' ? '안정 기준선의 심박 신호가 약해, 압박 과제 직전 안내 구간을 비교 기준으로 썼어요' : '안정 기준선의 심박 신호가 약해, 압박 과제 직전 구간을 비교 기준으로 썼어요');
      const PH = { baseline: '안정 기준선', neu: '정서 보기(중립)', neg: '정서 보기(부정)', pos: '정서 보기(긍정)', stress: '압박 과제', recovery: '회복 호흡', recoveryLate: '회복 후반' };
      const inferred = Object.keys(PH).filter(k => base.hr[k] && base.hr[k].status === 'inferred');
      if (inferred.length) domains.autonomic.notes.push(`${inferred.map(k => PH[k]).join(' · ')} 구간은 심박 신호가 약해, 앞뒤 구간의 심박 흐름으로 이어 추정했어요(신뢰도 낮게 반영)`);
      if (breathOff) domains.autonomic.notes.push(`호흡 구간에서 카메라로 잰 호흡이 분당 ${resp.bpm}회로, 안내한 6회와 달라 호흡 동조 지표는 판정에서 뺐어요. 다음에는 원의 속도에 맞춰 천천히 호흡해 주세요`);
      else if (resp && resp.clear) domains.autonomic.notes.push(`호흡 구간에서 분당 ${resp.bpm}회 호흡이 확인돼 안내한 공명 호흡(6회)을 따른 것으로 봤어요`);
      if (base.recoveryNA) domains.autonomic.notes.push(`압박 때 심박 상승(${base.recoveryNA.riseBpm}bpm)이 측정 오차로 구분되는 크기(${base.recoveryNA.needBpm}bpm)보다 작아 회복률은 계산하지 않았어요 — 회복은 ‘회복 후 잔여 심박’으로 봤어요`);
      if (base.recoverySrc === 'whole') domains.autonomic.notes.push('호흡 구간 후반 신호가 약해 호흡 구간 전체 심박으로 회복률을 계산했어요');
      if (base.recovery === null && !base.recoveryNA) domains.autonomic.notes.push(`심박 회복률을 계산하지 못했어요 — ${!refHr || refHr.quality === 'poor' || refHr.quality === 'none' ? '기준 심박' : base.hr.stressPeak === null ? '압박 구간 심박' : '호흡 구간 심박'} 신호가 약했어요. 밝은 조명에서 움직임을 줄이면 잡혀요`);
    }

    const integrated = integrate(domains, indicators, base, rec.checkin);
    integrated.context = contextNotes(rec.checkin, rec.measuredAt, k => domains[k] && SEV[domains[k].status] >= 1);
    DOMAIN_KEYS.forEach(k => { domains[k].explain = explainDomain(k, indicators); });
    const care = [integrated.primary, integrated.secondary].filter(Boolean).map((k, i) => ({ domain: k, rank: i + 1, ...CARE_PLAN[k] }));
    if (!care.length) care.push({ domain: 'balanced', rank: 1, ...CARE_PLAN.balanced });
    const phq = phqScore(rec.checkin), links = phqLinks(phq, domains);
    if (phq && phq.consult) care.unshift({ ...SAFETY_TRACK, rank: 0 });

    /* NL-QC 요약: 검사별 신뢰도 · 제외 사유 · 보정 내역 */
    const measuredD = DOMAIN_KEYS.filter(k => domains[k].status !== 'na');
    const overall = measuredD.length ? round(mean(measuredD.map(k => domains[k].confidence)), 2) : 0;
    /* 진행했는데 판정하지 못한 영역이 있으면 등급 상한을 둔다: 측정된 영역 평균만 보면 한 영역이 통째로 빠져도 A가 나온다 */
    const DOMAIN_STEPS = { alert: ['pvt'], control: ['pursuit', 'saccade', 'sart'], emotion: ['freeview'], autonomic: ['stress', 'recovery'] };
    const ran = k => !rec.steps || DOMAIN_STEPS[k].some(s => rec.steps[s] && (rec.steps[s].status === 'done' || rec.steps[s].status === 'input'));
    const lostD = DOMAIN_KEYS.filter(k => domains[k].status === 'na' && ran(k));
    const capGrade = (g, lost) => (lost >= 2 ? (g < 'C' ? 'C' : g) : lost === 1 ? (g < 'B' ? 'B' : g) : g);
    const stepQ = (key, label, r, note) => ({ key, label, r: finite(r) ? round(r, 2) : null, note: note || null });
    const qc = {
      version: QC.version, pulseEvidence: base.evidence?.phases || null, acquisition: rec.capture || null, signals: { captured: frames.length, face: face.length, eyes: frames.filter(f=>f.eyeOk??f.ok).length, skin: frames.filter(f=>f.ppgOk??f.ok).length, monocular: [...(rec.saccade||[]),...(rec.trials||[]),...(rec.pursuit?[rec.pursuit,...(rec.pursuit.levels||[]),...(rec.pursuit.reversal?[rec.pursuit.reversal]:[])]:[])].flatMap(t=>t.samples||[]).filter(p=>p.mode==='left'||p.mode==='right').length }, confidence: overall, grade: capGrade(overall >= 0.8 ? 'A' : overall >= 0.6 ? 'B' : overall >= QC.tentative ? 'C' : 'D', lostD.length), lostDomains: lostD,
      steps: [
        stepQ('baseline', '안정 기준선 · 심박', hq(base.hr.baseline), base.hr.baseline.quality === 'poor' ? '심박 신호가 약해 기준선 비교가 제한돼요' : null),
        rec.pvt ? stepQ('pvt', 'PVT-B · PERCLOS', Math.min(rOf.pvt(), eye ? rOf.eye() : 1), pvt && pvt.invalid) : null,
        rec.saccade ? stepQ('saccade', '프로·안티사카드', rOf.anti(), saccade && (saccade.reason || (saccade.anti.weak ? `약한 반응으로 판정한 시행 ${saccade.anti.weak}회 (방향만 사용)` : null))) : null,
        rec.pursuit ? stepQ('pursuit', '원활 추적', rOf.pursuit(), pursuit && pursuit.reason) : null,
        rec.pursuit && rec.pursuit.circle ? stepQ('circle', '원형 추적', rOf.circle(), circle && circle.reason) : null,
        rec.sart ? stepQ('sart', 'SART', rOf.sart(), sart && sart.invalid) : null,
        (rec.trials || []).length ? stepQ('freeview', '정서 자유 보기', rOf.gaze(), a.gazeOk ? null : '시선 신호가 부족해 정서 주의 지표를 판정하지 않았어요') : null,
        rec.stressScore ? stepQ('stress', '압박 과제 · 회복', Math.max(REL.stressDelta(), REL.recoveryResid()), base.stressDelta === null ? '압박 구간 심박 신호가 약해 압박 반응을 계산하지 못했어요' : null) : null,
      ].filter(Boolean),
      latency: pvt ? { offset: pvt.offset, lapseMs: pvt.lapseMs, fast10: pvt.fast10 } : null,
      sideBalanced: !!(base.gaze.blocks && base.gaze.blocks.neg && base.gaze.blocks.neg.balanced),
      hrRef: base.hrRef, calib: cal && !cal.sim && !cal.mouse ? { errPct: cal.errPct, before: cal.before ?? null, model: cal.model || null, affine: !!cal.affine, control: cal.control || null } : null,
      borderline: indicators.filter(i => i.borderline).map(i => i.label),
      excluded: indicators.filter(i => i.excluded).map(i => i.label),
      downgraded: DOMAIN_KEYS.filter(k => domains[k].notes.some(n => n.includes('수렴 원칙'))),
      hidden: hidden.length ? { n: hidden.length, sec: round(hidden.reduce((x, h) => x + h.end - h.start, 0) / 1000, 1), dropped } : null,
      /* fps = 얼굴 인식이 된 프레임 수/초(시선 지표 신뢰도용). 심박 단계는 인식을 일부러 초당 10~15회로 줄이므로 이 값이 낮게 보인다 —
       * 카메라가 실제로 받은 프레임(심박 표본)은 captureFps 로 따로 남긴다(2026-10-07 실측 NLR-B8F9…: 압박 fps 7.4 · captureFps 20.7) */
      fps: Object.fromEntries(['baseline', 'pursuit', 'saccade', 'neg', 'pvt', 'sart', 'stress', 'recovery'].map(k => [k, fpsOf(k) === null ? null : round(fpsOf(k), 1)]).filter(x => x[1] !== null)),
      captureFps: Object.fromEntries(['baseline', 'pursuit', 'saccade', 'neg', 'pvt', 'sart', 'stress', 'recovery'].map(k => { const sp = span(k); if (!sp) return [k, null]; const n = frames.filter(f => f.t >= sp[0] && f.t <= sp[1]).length; return [k, round(n / Math.max(1, (sp[1] - sp[0]) / 1000), 1)]; }).filter(x => x[1] !== null)),
      lightJumps: base.lightJumps || 0, breath: resp ? { bpm: resp.bpm, clear: resp.clear, src: resp.src, off: breathOff } : null,
    };

    const pv = (x, k, s = 1, dd = 0) => x && finite(x[k]) ? round(x[k] * s, dd) : null;
    const info = {
      alert: [
        { label: 'PVT 반응 속도 (1/RT 평균)', value: pv(pvt, 'meanSpeed', 1, 2), unit: '/초', refs: ['basner'] },
        { label: '가장 느린 10% 반응', value: pv(pvt, 'slow10'), unit: 'ms', refs: ['basner'] },
        { label: '기기 지연 보정 (보정 전 중앙값)', value: pvt && pvt.offset ? `−${pvt.offset}ms (${pvt.rawMedianRt})` : null, unit: '', refs: ['basner'] },
        { label: '깜빡임 빈도 (PVT 중)', value: pv(eye, 'blinkRate', 1, 1), unit: '회/분', refs: ['caffier'] },
        { label: '0.5초 넘는 눈감김', value: pv(eye, 'longPerMin', 1, 1), unit: '회/분', refs: ['caffier'] },
        { label: '기준선 PERCLOS', value: pv(eyeBase, 'perclos', 1, 1), unit: '%', refs: ['wierwille'] },
      ],
      control: [
        { label: '프로사카드 방향 정확도', value: saccade && finite(saccade.pro.accuracy) ? round(saccade.pro.accuracy * 100) : null, unit: '%', refs: ['hallett'] },
        { label: '프로사카드 잠복기', value: saccade ? saccade.pro.latency : null, unit: 'ms', refs: ['hallett'] },
        { label: '안티사카드 잠복기 (정반응)', value: saccade ? saccade.anti.latency : null, unit: 'ms', refs: ['munoz'] },
        { label: '안티사카드 오류 자기 교정', value: saccade && finite(saccade.anti.correctedRate) ? round(saccade.anti.correctedRate * 100) : null, unit: '%', refs: ['munoz'] },
        { label: '추적 지연', value: pursuit && pursuit.ok ? pursuit.lagMs : null, unit: 'ms', refs: ['lencer'] },
        { label: '원형 추적 이득 (가로 · 세로)', value: circle && circle.ok ? `${circle.gainX} · ${circle.gainY}` : null, unit: '', refs: ['maruta'] },
        { label: '원형 추적 지연', value: circle && circle.ok ? circle.lagMs : null, unit: 'ms', refs: ['maruta'] },
        { label: 'SART 평균 반응시간', value: pv(sart, 'meanRt'), unit: 'ms', refs: ['robertson'] },
        { label: 'SART 실패 직전 가속 (평소 대비)', value: pv(sart, 'preErrorSpeedup'), unit: 'ms', refs: ['robertson'] },
        { label: '기준선 머리 움직임', value: base.motion.baseline, unit: '%/초', refs: ['teicher'] },
      ],
      emotion: [
        ...emoSub(rec, W, base.quality.gazeOk),
        { label: '부정 자극 첫 체류', value: base.quality.gazeOk ? base.gaze.dwellNeg : null, unit: 'ms', refs: ['armstrong'] },
        { label: '부정 자극까지 걸린 시간 (첫 도달)', value: base.quality.gazeOk ? base.gaze.latencyNeg : null, unit: 'ms', refs: ['armstrong'] },
        { label: '불편한 사진 재방문 (시행당)', value: base.quality.gazeOk ? base.gaze.revisitsNeg : null, unit: '회', refs: ['armstrong'] },
        { label: '불편한 사진 한 번 응시 길이 (중앙값)', value: base.quality.gazeOk ? base.gaze.glanceNeg : null, unit: 'ms', refs: ['armstrong', 'kellough'] },
        { label: '기쁜 사진 미소 반응 (중립 대비)', value: base.exprPos, unit: '×100', refs: ['larsen'] },
        { label: '불편한 사진 깜빡임 변화 (중립 대비)', value: base.blinkEmo, unit: '회/분', refs: ['larsen'] },
        { label: '사진 사이 시선 전환 (시행당)', value: base.quality.gazeOk ? base.gaze.switches : null, unit: '회', refs: ['mogg'] },
        { label: '시간 흐름별 부정 응시 (0–1 · 1–2 · 2–3 · 3초+)', value: base.quality.gazeOk && base.gaze.binsNeg ? base.gaze.binsNeg.map(v => (finite(v) ? Math.round(v * 100) : '—')).join(' · ') : null, unit: '%', refs: ['mogg', 'kellough'] },
        { label: '반분 안정성 (홀·짝 시행 응시 비율 차)', value: base.quality.gazeOk && finite(base.gaze.halfGapNeg) ? round(base.gaze.halfGapNeg * 100, 1) : null, unit: '%p', refs: ['waechter'] },
        { label: '부정 블록 찌푸림 변화', value: base.exprNeg, unit: '×100', refs: [] },
      ],
      autonomic: [
        { label: '안정 시 심박', value: base.hr.baseline.bpm, unit: 'bpm', refs: ['pos'] },
        { label: '심박 변동 RMSSD (참고)', value: base.hrv, unit: 'ms', refs: ['taskForce'] },
        { label: '압박 과제 정답률', value: rec.stressScore && rec.stressScore.total ? round(rec.stressScore.correct / rec.stressScore.total * 100) : null, unit: '%', refs: ['dedovic'] },
      ],
    };

    return {
      ...base, phaseTimes: ph, stressScore: rec.stressScore || null, stimMode: rec.stimMode || 'schematic', stimForm: rec.stimForm || null, stimStatus: rec.stimStatus || null, mode: rec.mode || null, resized: !!rec.resized,
      battery: { version: VERSION, qc, pvt, eye, eyeBase, saccade, pursuit, reversal, circle, sart, sartMotion, indicators, info, domains, integrated, care, phq, phqLinks: links, steps: rec.steps || {}, sim: rec.sim || null },
    };
  }

  /* ---------- 시뮬레이션 피험자 (카메라 없는 검증용) ----------
   * 페르소나별로 생리 신호(합성 영상 프레임)와 과제 반응을 만들어 리포트 전 과정을 검증한다. 결과에는 반드시 ‘시뮬레이션’ 표시. */
  const PERSONAS = {
    balanced: { label: '균형 조절 (대조)', checkin: { valence: 6, tension: 2, energy: 4, kss: 3, focus: 4, sleep: '7to8', caffeine: '3to6', phq: [0, 1] },
      hr: { base: 68, task: 1, neg: 1, stress: 5, rec: 0.9, coup: 9 }, eye: { blinkMs: 150, drowsy: 0 }, motion: { base: 0.6, sart: 0.8 },
      pvt: { mu: 282, sd: 28, lapse: 0.01, early: 0.01 }, anti: { err: 0.14, corr: 0.85, lat: 285, pro: 195 },
      pursuit: { gain: 0.93, lag: 80, noise: 0.025 }, sart: { com: 0.28, om: 0.01, rt: 360, cv: 0.18 }, bias: 0.52, first: 0.5, pos: 0.56, math: 0.85 },
    fatigue: { label: '수면 부족 · 피로', checkin: { valence: 5, tension: 2, energy: 2, kss: 4, focus: 3, sleep: '5to6', caffeine: 'none', phq: [1, 2, 3, 3, 1, 1, 2, 1] },
      hr: { base: 65, task: 1, neg: 1.5, stress: 5, rec: 0.75, coup: 7 }, eye: { blinkMs: 260, drowsy: 0.12 }, motion: { base: 0.7, sart: 1.0 },
      pvt: { mu: 318, sd: 55, lapse: 0.12, early: 0.05 }, anti: { err: 0.3, corr: 0.7, lat: 320, pro: 220 },
      pursuit: { gain: 0.72, lag: 150, noise: 0.05 }, sart: { com: 0.56, om: 0.1, rt: 430, cv: 0.36 }, bias: 0.54, first: 0.52, pos: 0.5, math: 0.7 },
    control: { label: '주의 통제 부하', checkin: { valence: 5, tension: 3, energy: 4, kss: 3, focus: 3, sleep: '6to7', caffeine: '1to3', phq: [1, 1] },
      hr: { base: 72, task: 2, neg: 1, stress: 7, rec: 0.42, coup: 3.2 }, eye: { blinkMs: 150, drowsy: 0 }, motion: { base: 0.8, sart: 3.4 },
      pvt: { mu: 288, sd: 40, lapse: 0.03, early: 0.06 }, anti: { err: 0.5, corr: 0.6, lat: 300, pro: 190 },
      pursuit: { gain: 0.86, lag: 90, noise: 0.04 }, sart: { com: 0.66, om: 0.04, rt: 330, cv: 0.37 }, bias: 0.53, first: 0.52, pos: 0.54, math: 0.75 },
    overload: { label: '정서·신체 과부하', checkin: { valence: 4, tension: 2, energy: 3, kss: 5, focus: 4, sleep: '6to7', caffeine: 'gt6', phq: [2, 2, 1, 2, 1, 2, 1, 1] },
      hr: { base: 76, task: 2, neg: 4.5, stress: 13, rec: 0.12, coup: 1.2 }, eye: { blinkMs: 170, drowsy: 0.01 }, motion: { base: 0.7, sart: 1.2 },
      pvt: { mu: 300, sd: 40, lapse: 0.04, early: 0.02 }, anti: { err: 0.36, corr: 0.7, lat: 310, pro: 200 },
      pursuit: { gain: 0.88, lag: 90, noise: 0.03 }, sart: { com: 0.45, om: 0.03, rt: 370, cv: 0.26 }, bias: 0.72, first: 0.7, pos: 0.47, math: 0.65 },
  };

  function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }

  function simulate(personaKey = 'balanced', opt = {}) {
    const P = PERSONAS[personaKey] || PERSONAS.balanced, D = DUR[opt.mode === 'quick' ? 'quick' : 'full'];
    const inc = { core: true, alert: true, oculo: true, sustain: true, ...(opt.include || {}) };
    const rand = rng(opt.seed || 20261002), gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += rand(); return (u - 3) * 1.414; };
    const W = opt.W || 1440, cx = W / 2;
    const ph = {}, trials = [], saccade = [];
    const sacCal = { xL: cx - 0.3 * W, xC: cx + 0.02 * W, xR: cx + 0.3 * W };   // 웹캠 회귀처럼 진폭이 줄고 중심이 약간 치우친 상태
    let t = 1000;
    const seg = (k, ms) => { ph[k] = { start: t, end: t + ms }; t += ms + 3000; };

    seg('baseline', D.baseline * 1000);
    let pursuit = null;
    if (inc.oculo) {
      /* 원활 추적 2판: 속도 단계(빠를수록 이득이 조금씩 떨어짐) + 불규칙 방향 전환(반응 지연 = lag + 90ms) + 원형 */
      /* 원활 추적 합성은 별도 난수열(rand2): 다른 과제 합성값의 난수 흐름을 1판과 같게 유지한다 */
      let rs = 12345;
      const rand2 = () => (rs = (rs * 16807) % 2147483647) / 2147483647, gauss2 = () => { let u = 0; for (let k = 0; k < 6; k++) u += rand2(); return u - 3; };
      const p = PROTOCOL.pursuit, amp = p.ampL * W, t0 = t, levels = [];
      let tc = t0;
      p.levels.forEach((freq, i) => {
        const dur = D.pursuit[i] / freq * 1000, g = P.pursuit.gain * (1 - 0.18 * i * (1 - P.pursuit.gain)), samples = [];
        for (let s2 = tc; s2 <= tc + dur; s2 += 33) { const x = cx + g * amp * Math.sin(2 * Math.PI * freq * (s2 - P.pursuit.lag - tc) / 1000) + P.pursuit.noise * W * gauss2(); samples.push({ t: s2, x, rx: x }); }
        levels.push({ freq, t0: tc, dur, samples }); tc += dur;
      });
      const v = p.rev.speed * W, turns = [], react = P.pursuit.lag + 90;
      let x = cx, dir = 1, tx = tc, nextT = tc + p.rev.gapMin + rand2() * (p.rev.gapMax - p.rev.gapMin), gz = cx;
      while (turns.length < D.reversals) {
        tx += 10; x += dir * v * 0.01;
        if (tx >= nextT || x > p.rev.hi * W || x < p.rev.lo * W) { turns.push({ t: tx, x, from: dir, kind: tx >= nextT ? 'random' : 'edge' }); dir = -dir; nextT = tx + p.rev.gapMin + rand2() * (p.rev.gapMax - p.rev.gapMin); }
      }
      const rEnd = tx + 800, tgtR = q => { let px = cx, pd = 1, pt = tc; for (const u of turns) { if (u.t > q) break; px = u.x; pd = -u.from; pt = u.t; } return px + pd * v * (q - pt) / 1000; };
      const rsS = [];
      for (let s2 = tc; s2 <= rEnd; s2 += 33) { gz += (tgtR(s2 - react) - gz) * Math.min(1, 33 / 60); const xx = gz + P.pursuit.noise * W * gauss2(); rsS.push({ t: s2, x: xx, rx: xx }); }
      seg('pursuit', rEnd - t0); t = t0;
      const pc = PROTOCOL.circle, c0 = rEnd + 800, cdur = (D.circle || 10) * 1000, rr = pc.r * W, cy = (opt.H || 900) / 2, cs = [];
      for (let s2 = c0; s2 <= c0 + cdur; s2 += 33) { const ang = 2 * Math.PI * pc.freq * (s2 - P.pursuit.lag - c0) / 1000 - Math.PI / 2; cs.push({ t: s2, x: cx + P.pursuit.gain * rr * Math.cos(ang) + P.pursuit.noise * 1.2 * W * gauss(), y: cy + P.pursuit.gain * 0.9 * rr * Math.sin(ang) + P.pursuit.noise * 1.6 * W * gauss() }); }
      pursuit = { version: 2, cx, amp, levels, reversal: { t0: tc, end: rEnd, speed: v, turns, samples: rsS }, circle: { t0: c0, cx, cy, r: rr, freq: pc.freq, dur: cdur, samples: cs } };
      ph.pursuit.end = c0 + cdur; t = ph.pursuit.end + 3000;
      ph.saccade = { start: t };
      const S = PROTOCOL.saccade;
      const block = (type, n) => {
        for (let i = 0; i < n; i++) {
          const side = i % 2 ? 'L' : 'R', fix = S.fixMin + rand() * (S.fixMax - S.fixMin), onset = t + fix, end = onset + S.targetMs;
          const tdir = side === 'R' ? 1 : -1, want = type === 'anti' ? -tdir : tdir;
          const err = rand() < (type === 'anti' ? P.anti.err : 0.03);
          const lat = Math.max(110, err ? P.anti.pro + 15 + 30 * gauss() : (type === 'anti' ? P.anti.lat : P.anti.pro) + 35 * gauss());
          const corrected = err && rand() < P.anti.corr;
          const samples = [];
          for (let s = t; s <= end; s += 33) {
            const dtm = s - onset;
            let pos = 0;
            if (dtm >= lat) {
              const first = (err ? -want : want) * S.ecc * W * Math.min(1, (dtm - lat) / 50);
              pos = corrected && dtm >= lat + 230 ? want * S.ecc * W * Math.min(1, (dtm - lat - 230) / 50) : first;
            }
            samples.push({ t: s, x: sacCal.xC + pos * 0.86 + 0.018 * W * gauss() });
          }
          saccade.push({ type, side, onset, end, samples });
          t = end + S.gapMs;
        }
      };
      block('pro', D.pro); t += 3000; block('anti', D.anti);
      ph.saccade.end = t; t += 3000;
    }
    if (inc.core) {
      ['neu', 'neg', 'pos'].forEach(kind => {
        ph[kind] = { start: t };
        for (let i = 0; i < D.trials; i++) {
          const onset = t + 700, end = onset + 3500, emoSide = i % 2 ? 'L' : 'R';
          const share = kind === 'neg' ? P.bias : kind === 'pos' ? P.pos : 0.5, firstEmo = rand() < (kind === 'neg' ? P.first : 0.5);
          const emoX = emoSide === 'L' ? W * 0.25 : W * 0.75, othX = emoSide === 'L' ? W * 0.75 : W * 0.25, samples = [];
          for (let s = onset; s < end; s += 33) {
            const f = (s - onset) / 3500;
            const onEmo = firstEmo ? f < share : f >= 1 - share;
            samples.push({ t: s, x: (onEmo ? emoX : othX) + 0.02 * W * gauss() });
          }
          trials.push({ kind, emoSide, onset, end, samples, ...(kind === 'neg' ? { sub: i % 2 ? 'threat' : 'dysphoric' } : {}) });
          t = end;
        }
        ph[kind].end = t;
      });
      t += 3000;
    }
    let pvt = null;
    if (inc.alert) {
      seg('pvt', D.pvt * 1000);
      const Q = PROTOCOL.pvt, list = [];
      let s = ph.pvt.start, falseStarts = 0;
      while (s < ph.pvt.end - 1500) {
        s += Q.isiMin + rand() * (Q.isiMax - Q.isiMin);
        if (rand() < P.pvt.early) { falseStarts++; s += 1000; continue; }
        let rt = rand() < P.pvt.lapse ? 360 + rand() * 900 : P.pvt.mu + P.pvt.sd * gauss();
        rt = Math.max(150, rt);
        if (rt > Q.timeoutMs) rt = null;
        list.push({ onset: s, rt });
        s += (rt || Q.timeoutMs) + 700;
      }
      pvt = { trials: list, falseStarts, durationMs: D.pvt * 1000 };
    }
    let sart = null;
    if (inc.sustain) {
      const Q = PROTOCOL.sart, n = D.sart, seq = sartSequence(n, rand), list = [];
      ph.sart = { start: t };
      seq.forEach(digit => {
        let rt = null;
        if (digit === Q.nogo) { if (rand() < P.sart.com) rt = Math.max(150, P.sart.rt * 0.85 + 50 * gauss()); }
        else if (rand() >= P.sart.om) rt = clamp(P.sart.rt + P.sart.cv * P.sart.rt * gauss(), 150, 1100);
        list.push({ digit, onset: t, rt });
        t += Q.digitMs + Q.maskMs;
      });
      ph.sart.end = t; t += 3000;
      sart = { trials: list };
    }
    let stressScore = null;
    if (inc.core) {
      seg('stress', D.stress * 1000);
      seg('recovery', D.recovery * 1000);
      const total = Math.round(D.stress / 2.6);
      stressScore = { correct: Math.round(total * P.math), total };
    }
    const tEnd = t;

    const H = P.hr, inP = (k, x) => ph[k] && x >= ph[k].start && x < ph[k].end;
    const hrAt = x => {
      if (inP('baseline', x)) return H.base;
      if (inP('neg', x)) return H.base + H.task + H.neg;
      if (inP('stress', x)) return H.base + H.stress * Math.min(1, (x - ph.stress.start) / 12000);
      if (inP('recovery', x)) {
        const r = ph.recovery, half = (r.end - r.start) / 2;
        return H.base + H.stress - H.rec * H.stress * Math.min(1, (x - r.start) / half) + H.coup / 2 * Math.sin(2 * Math.PI * 0.1 * (x - r.start) / 1000);
      }
      return H.base + H.task;
    };
    const frames = N.synthFrames(0, tEnd, hrAt, {
      seed: (opt.seed || 7) + 11, noise: 0.15,
      eyeAt: () => P.eye,
      motionAt: x => (inP('sart', x) ? P.motion.sart : P.motion.base) / 0.8,
      breathAt: x => 0.003 * Math.sin(2 * Math.PI * (inP('recovery', x) ? 0.1 : 0.25) * x / 1000),
      frownAt: x => (inP('neg', x) ? 0.05 + (P.bias > 0.6 ? 0.05 : 0.015) : 0.05),
    });

    const done = { status: 'sim' }, off = { status: 'off' };
    const steps = {
      baseline: done, pursuit: inc.oculo ? done : off, saccade: inc.oculo ? done : off, freeview: inc.core ? done : off,
      pvt: inc.alert ? done : off, sart: inc.sustain ? done : off, stress: inc.core ? done : off, recovery: inc.core ? done : off,
    };
    return {
      frames, phases: ph, trials, pursuit, saccade: inc.oculo ? saccade : null, saccadeCal: inc.oculo ? sacCal : null, pvt, sart, stressScore, steps,
      screenW: W, calibration: { grade: 'good', errPct: 7.5, sim: true }, checkin: { ...P.checkin, phq: [...P.checkin.phq] },
      demo: true, sim: { persona: personaKey, label: P.label }, mode: opt.mode === 'quick' ? 'quick' : 'full', measuredAt: opt.measuredAt || new Date().toISOString(),
    };
  }

  return {
    VERSION, ADMIT, REFS, PHQ, PHQ_LINKS, PROTOCOL, DUR, MODULES, DOMAINS, DOMAIN_KEYS, INDICATORS, STATUS, SEV, HEAD, PATHWAYS, CARE_PLAN, PERSONAS,
    QC, CONTEXT, contextNotes, explainDomain, nextBand, mistProblem, mistNext, mistStart, aggregateDomain, cleanGaze, blockCenters, phqScore, phqLinks, scoreOf, statusOf, rangeText, pvtStats, eyeStats, saccadeThreshold, saccadeTrial, saccadeQuick, saccadeStats, pursuitStats, pursuitSec, ladderStats, reversalStats, sartCount, sartSequence, sartStats, integrate, run, simulate,
  };
});
