/* NeuroLens CONDITION — 시선 라벨 수집·시간/좌표 provenance 공통 모듈 (gaze-label-1)
 *
 * 역할
 *   · 전용 시선 라벨 모드(/condition?mode=gaze-label)의 표적 계획, 확인 직전 창 선택, 규칙 기반 품질 점수, 이벤트 이력
 *   · 학습 feature allowlist / denylist (표적·클릭 좌표·정답·미래 정보는 모델 입력에서 제외)
 *   · 개인 시선 파이프라인(model·affine·resid·combine·drift)의 결정적 digest — holdout 전후 동일성 검증
 *   · 화면 좌표계 스냅샷(layout/visual viewport, DPR, 방향, 전체 화면)
 *   · Python(nlcolab) 과 같은 canonical JSON·SHA-256 규칙 — 양쪽 digest 가 일치해야 한다 (tools/colab/tests 에서 검증)
 *
 * 라벨 등급: explicit_target_confirmed 는 ‘표적 응시를 의도했다’는 proxy 라벨이다. 외부 eye tracker 기준값이 아니다.
 * dwellConfidence 는 규칙 기반 품질 점수이며 실제 시선 정답 확률이 아니다.
 * 브라우저: window.NLLabels · Node: module.exports */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NLLabels = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function () {
  'use strict';
  const VERSION = 'gaze-label-1', SCHEMA = 'nl-gaze-label-1';
  const finite = Number.isFinite, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const median = a => { const s = a.filter(finite).sort((x, y) => x - y); return s.length ? (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2 : NaN; };
  const mean = a => { const v = a.filter(finite); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN; };

  /* ---------- 라벨 출처 (문서 §4) ---------- */
  const LABEL_SOURCES = Object.freeze({
    reference_eyetracker: 'external eye tracker, time/coordinate verified',
    explicit_target_confirmed: 'instructed target + user confirmation (proxy, not independent measurement)',
    calibration_target: 'known calibration target (role: train / internal / holdout)',
    free_click_weak: 'ordinary UI click coordinate (weak; excluded from primary training/evaluation)',
    engine_prediction: 'engine output (baseline/comparison input, never ground truth)',
    unlabeled: 'valid observation without location/heart-rate truth',
  });
  const LABEL_ROLES = Object.freeze(['train', 'internal', 'holdout', 'eval_only', 'weak', 'excluded']);

  /* ---------- 학습 feature 계약 ----------
   * 브라우저가 추론 시점에 가질 수 있는 값만. 표적·클릭·정답·label confidence·미래 프레임·확인까지 남은 시간은 입력 금지 */
  const FEATURE_ALLOWLIST = Object.freeze(['baseX', 'baseY', 'u', 'v', 'uLeft', 'vLeft', 'uRight', 'vRight', 'qLeft', 'qRight', 'open', 'yaw', 'pitch', 'cx', 'cy', 'fw', 'blink', 'eyeQ', 'lag', 'eyeMode']);
  const FEATURE_DENYLIST = Object.freeze(['targetX', 'targetY', 'nx', 'ny', 'clickX', 'clickY', 'clientX', 'clientY', 'labelX', 'labelY', 'residualX', 'residualY', 'dwellConfidence', 'labelWeight', 'labelConfidence', 'confirmAt', 'timeToConfirm', 'futureX', 'futureY', 'role', 'labelSource', 'targetId']);
  function checkFeatureNames(names) {
    const bad = (names || []).filter(k => FEATURE_DENYLIST.includes(k) || !FEATURE_ALLOWLIST.includes(k));
    return { ok: bad.length === 0, rejected: bad };
  }

  /* ---------- 기본 설정 (공학적 초기값 · config 로 조정) ---------- */
  const DEFAULT_CONFIG = Object.freeze({
    counts: { train: 16, internal: 4, holdout: 5 },
    settleMs: 600,          // 새 표적 표시 직후 안정화 (라벨 제외)
    minDwellMs: 900,        // 표시→확인 최소 체류. 더 짧으면 라벨 무효
    windowEndBeforeConfirmMs: 200,   // 확인 시각보다 이만큼 앞에서 창 종료 (손 동작·반응 구간 제외)
    windowLenMs: 300,       // 창 길이 (확인 500~200ms 전) — 초기값이며 보편적 지연값이 아니다
    minFrames: 4, maxFramesPerTarget: 12,
    minFps: 8,              // 창 안 관측 fps 하한
    maxHeadMotionPct: 2.5,  // 창 안 얼굴 중심 이동 (얼굴 폭 % per 100ms)
    maxBlinkScore: 0.45,
    marginX: 0.07, marginY: 0.09,   // 표적 배치 여백 (viewport 비율)
    targetRadiusPx: 11,
  });

  /* ---------- 결정적 난수 (mulberry32) — seed 기록 ---------- */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const shuffleWith = (arr, rnd) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  /* ---------- 표적 계획: 중앙·주변·모서리를 고르게, 역할(train/internal/holdout)별로도 고르게 ----------
   * 좌표는 viewport 정규화(0~1). 화면 px 는 표시 시점에 곱한다. 순서는 seed 로 섞되 holdout 은 마지막 블록에 둔다
   * (학습·개인 head fitting·문턱 조정이 끝난 뒤 평가만 하도록 — §5 최종 holdout 보호) */
  function regionOf(nx, ny) {
    const cx = Math.abs(nx - 0.5), cy = Math.abs(ny - 0.5);
    if (cx < 0.17 && cy < 0.17) return 'center';
    if (cx > 0.33 && cy > 0.33) return 'corner';
    return 'periphery';
  }
  function planTargets(opt = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...(opt.config || {}) }, counts = { ...DEFAULT_CONFIG.counts, ...(cfg.counts || {}) };
    const seed = finite(opt.seed) ? opt.seed >>> 0 : (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    const rnd = mulberry32(seed), mx = cfg.marginX, my = cfg.marginY;
    const total = counts.train + counts.internal + counts.holdout;
    /* 후보 격자: 5×5 셀의 셀 안 무작위 위치(셀마다 하나) → 역할별로 중앙/주변/모서리 비율을 맞춰 뽑는다 */
    const cells = [];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
      const nx = mx + (c + 0.2 + 0.6 * rnd()) / 5 * (1 - 2 * mx), ny = my + (r + 0.2 + 0.6 * rnd()) / 5 * (1 - 2 * my);
      cells.push({ nx: round6(nx), ny: round6(ny), region: regionOf(nx, ny) });
    }
    const byRegion = { center: [], periphery: [], corner: [] };
    shuffleWith(cells, rnd).forEach(c => byRegion[c.region].push(c));
    /* 영역의 격자 셀이 다 쓰이면 그 영역 안에서 새 위치를 뽑는다(기각 표집) — 역할마다 중앙·주변·모서리가 반드시 섞이게 */
    const sampleIn = region => {
      for (let k = 0; k < 200; k++) { const nx = mx + rnd() * (1 - 2 * mx), ny = my + rnd() * (1 - 2 * my); if (regionOf(nx, ny) === region) return { nx: round6(nx), ny: round6(ny), region }; }
      const nx = mx + rnd() * (1 - 2 * mx), ny = my + rnd() * (1 - 2 * my); return { nx: round6(nx), ny: round6(ny), region: regionOf(nx, ny) };
    };
    const takeBalanced = n => {
      const out = [], order = ['corner', 'periphery', 'center'];
      for (let i = 0; out.length < n; i++) { const region = order[i % 3], list = byRegion[region]; out.push(list.length ? list.shift() : sampleIn(region)); }
      return out;
    };
    const roles = [['train', counts.train], ['internal', counts.internal], ['holdout', counts.holdout]];
    const targets = [];
    for (const [role, n] of roles) for (const c of shuffleWith(takeBalanced(n), rnd)) targets.push({ ...c, role });
    /* train·internal 은 섞어서 제시, holdout 은 마지막 블록 (순서는 그 안에서 무작위) */
    const main = shuffleWith(targets.filter(t => t.role !== 'holdout'), rnd), hold = shuffleWith(targets.filter(t => t.role === 'holdout'), rnd);
    const plan = [...main, ...hold].map((t, i) => ({ id: 'T' + String(i + 1).padStart(2, '0'), order: i, ...t }));
    return { version: VERSION, seed, counts, total, targets: plan };
  }
  const round6 = v => Math.round(v * 1e6) / 1e6;

  /* ---------- 좌표계 스냅샷 ----------
   * target 과 pointer 는 모두 CSS client 좌표(clientX/Y · getBoundingClientRect)로 기록하고 viewport 기준 0~1 로 정규화한다.
   * 카메라 px·물리 화면 px 와 섞지 않는다. DPR 하나로 브라우저 zoom 을 역산하지 않는다 */
  function viewportState(win) {
    const w = win || (typeof window !== 'undefined' ? window : null);
    if (!w) return { coordinateSpace: 'css-client', vw: null, vh: null };
    const vv = w.visualViewport || null, doc = w.document;
    return {
      coordinateSpace: 'css-client', version: 1,
      vw: w.innerWidth ?? null, vh: w.innerHeight ?? null, dpr: w.devicePixelRatio ?? null,
      visual: vv ? { w: vv.width, h: vv.height, offsetLeft: vv.offsetLeft, offsetTop: vv.offsetTop, scale: vv.scale, pageLeft: vv.pageLeft, pageTop: vv.pageTop } : null,
      scrollX: w.scrollX ?? null, scrollY: w.scrollY ?? null,
      orientation: (w.screen && w.screen.orientation && w.screen.orientation.type) || null,
      fullscreen: !!(doc && doc.fullscreenElement), screen: w.screen ? { w: w.screen.width, h: w.screen.height } : null,
      zoomNote: 'browser zoom not separately measurable; dpr includes zoom on most desktop browsers',
    };
  }
  /* 표적 DOM 요소의 실제 표시 중심 → client px + 정규화. 표적은 ‘표시된 중심’이 라벨이다(마우스 좌표가 아니다) */
  function targetCenter(rect, vp) {
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    const vw = vp && finite(vp.vw) ? vp.vw : null, vh = vp && finite(vp.vh) ? vp.vh : null;
    return { x, y, nx: vw ? x / vw : null, ny: vh ? y / vh : null, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
  }

  /* ---------- 확인 직전 창 선택 ----------
   * frames: [{t, gazeOk, blink, faceOk, cx, cy, fw, eyeQ, ...}] (t = performance.now 계열, 관측 시각)
   * 허용 구간: [shownAt+settle, confirmAt-endBefore] ∩ [confirmAt-endBefore-len, confirmAt-endBefore]
   * 제외: gazeOk 아님 · 깜빡임 · 얼굴 손실 · hidden 구간 · 레이아웃 변경 이후 · 머리 움직임 과다 · 프레임 간격 부족 */
  function selectWindow(opt) {
    const cfg = { ...DEFAULT_CONFIG, ...(opt.config || {}) };
    const shownAt = opt.shownAt, confirmAt = opt.confirmAt, hidden = opt.hidden || [], layout = opt.layoutChanges || [];
    const out = { config: { settleMs: cfg.settleMs, minDwellMs: cfg.minDwellMs, windowEndBeforeConfirmMs: cfg.windowEndBeforeConfirmMs, windowLenMs: cfg.windowLenMs }, frameTimes: [], keep: false, reasons: [], excluded: {}, stats: null, dwellConfidence: 0 };
    if (!finite(shownAt) || !finite(confirmAt)) { out.reasons.push('missing-timestamps'); return out; }
    const dwell = confirmAt - shownAt;
    out.dwellMs = Math.round(dwell);
    if (dwell < cfg.minDwellMs) out.reasons.push('dwell-too-short');
    const end = confirmAt - cfg.windowEndBeforeConfirmMs, start = Math.max(shownAt + cfg.settleMs, end - cfg.windowLenMs);
    out.window = { start: Math.round(start), end: Math.round(end) };
    if (end <= start) { out.reasons.push('window-empty'); return out; }
    if (layout.some(t => t > shownAt && t <= confirmAt)) out.reasons.push('layout-changed');
    if (hidden.some(h => h.start <= confirmAt && (h.end ?? Infinity) >= shownAt)) out.reasons.push('hidden-overlap');
    const inWin = (opt.frames || []).filter(f => finite(f.t) && f.t >= start && f.t <= end).sort((a, b) => a.t - b.t);
    const count = k => { out.excluded[k] = (out.excluded[k] || 0) + 1; };
    const ok = inWin.filter(f => {
      if (f.faceOk === false) { count('face-missing'); return false; }
      if (!f.gazeOk) { count('gaze-invalid'); return false; }
      if (finite(f.blink) && f.blink >= cfg.maxBlinkScore) { count('blink'); return false; }
      return true;
    });
    out.observedFrames = inWin.length; out.validFrames = ok.length;
    const span = inWin.length > 1 ? inWin.at(-1).t - inWin[0].t : 0, fps = span > 0 ? (inWin.length - 1) * 1000 / span : (inWin.length ? 1000 / cfg.windowLenMs : 0);
    const pose = ok.filter(f => [f.cx, f.cy, f.fw].every(finite) && f.fw > 0);
    const motion = pose.slice(1).map((f, i) => { const p = pose[i], dt = f.t - p.t; return dt > 0 ? Math.hypot(f.cx - p.cx, f.cy - p.cy) / f.fw * 100 * (100 / dt) : NaN; }).filter(finite);
    const headMotion = motion.length ? Math.max(...motion) : 0;
    out.stats = { fps: Math.round(fps * 10) / 10, headMotionPctPer100ms: Math.round(headMotion * 100) / 100, blinkFraction: inWin.length ? Math.round((out.excluded.blink || 0) / inWin.length * 100) / 100 : null, eyeQ: Math.round((median(ok.map(f => f.eyeQ)) || 0) * 1000) / 1000 };
    if (ok.length < cfg.minFrames) out.reasons.push('too-few-frames');
    if (fps < cfg.minFps) out.reasons.push('low-fps');
    if (headMotion > cfg.maxHeadMotionPct) out.reasons.push('head-motion');
    /* 한 표적의 연속 프레임은 독립 표본이 아니다: 표적당 최대 프레임 수를 제한한다(고르게 솎음) */
    let kept = ok;
    if (kept.length > cfg.maxFramesPerTarget) { const step = kept.length / cfg.maxFramesPerTarget; kept = Array.from({ length: cfg.maxFramesPerTarget }, (_, i) => kept[Math.floor(i * step)]); out.thinned = true; }
    out.frameTimes = kept.map(f => f.t);
    out.keep = out.reasons.length === 0;
    /* 규칙 기반 품질 점수 (0~1): 체류 여유·유효 프레임 비율·머리 안정·눈 품질. 정답 확률이 아니다 */
    const dwellScore = clamp((dwell - cfg.minDwellMs) / 1500, 0, 1) * 0.3 + 0.7;
    const validScore = inWin.length ? ok.length / inWin.length : 0;
    const motionScore = clamp(1 - headMotion / cfg.maxHeadMotionPct, 0, 1);
    out.dwellConfidence = out.keep ? Math.round(clamp(dwellScore * (0.4 + 0.6 * validScore) * (0.5 + 0.5 * motionScore) * clamp(out.stats.eyeQ / 0.4, 0.3, 1), 0, 1) * 1000) / 1000 : 0;
    out.confidenceNote = 'rule-based quality score; not a probability that the eye was on target';
    return out;
  }

  /* ---------- 이벤트 이력 (append-only) + 유효 상태 재계산 ----------
   * types: plan · shown · confirm · reject(자동) · invalidate(사용자: 잘못 눌렀어요) · retry · restore · supersede · layout · holdout-begin · holdout-end */
  function createEventLog(now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())) {
    const events = [];
    let seq = 0;
    return {
      events,
      push(type, data = {}) { const e = { seq: seq++, t: finite(data.t) ? data.t : now(), type, ...data }; events.push(e); return e; },
      effective() { return effectiveLabels(events); },
    };
  }
  /* 유효 라벨 계산: 표적마다 마지막 confirm 시도(attempt)를 기준으로, invalidate 가 뒤따르면 무효, restore 가 더 뒤따르면 복구.
   * 이전 시도는 superseded 로 남긴다(삭제하지 않음) */
  function effectiveLabels(events) {
    const byTarget = new Map();
    for (const e of events) {
      if (!e.targetId) continue;
      const T = byTarget.get(e.targetId) || { targetId: e.targetId, attempts: [], retries: 0 };
      byTarget.set(e.targetId, T);
      if (e.type === 'shown') T.attempts.push({ attempt: T.attempts.length + 1, shownAt: e.t, shownSeq: e.seq, status: 'shown', confirm: null, window: null, flags: [] });
      const A = T.attempts.at(-1);
      if (!A) continue;
      if (e.type === 'confirm') { A.confirm = e; A.status = e.window && e.window.keep ? 'valid' : 'rejected'; A.window = e.window || null; A.rejectReasons = e.window ? e.window.reasons : ['no-window']; }
      if (e.type === 'invalidate') { A.status = 'invalidated'; A.flags.push('user-invalidated'); A.invalidateReason = e.reason || 'user'; }
      if (e.type === 'restore') { if (A.window && A.window.keep) { A.status = 'valid'; A.flags.push('restored'); } }
      if (e.type === 'retry') { T.retries++; if (A.status !== 'invalidated') A.status = A.status === 'valid' ? 'superseded' : A.status; }
    }
    const targets = [...byTarget.values()].map(T => {
      /* 마지막 시도가 유효하면 그것, 아니면 유효 상태인 가장 최근 시도(이전 시도는 superseded 표시) */
      const last = T.attempts.at(-1), valid = T.attempts.filter(a => a.status === 'valid');
      const chosen = last && last.status === 'valid' ? last : valid.at(-1) || null;
      T.attempts.forEach(a => { if (a.status === 'valid' && a !== chosen) a.status = 'superseded'; });
      return { ...T, effective: chosen ? { attempt: chosen.attempt, confirmSeq: chosen.confirm.seq, frameTimes: chosen.window.frameTimes, dwellConfidence: chosen.window.dwellConfidence } : null, status: chosen ? 'valid' : last ? last.status : 'unshown' };
    });
    return { targets, valid: targets.filter(t => t.effective).length, total: targets.length };
  }

  /* ---------- canonical JSON + SHA-256 (Python nlcolab.canonical 과 동일 규칙) ----------
   * 키 정렬, 공백 없음, 숫자는 JS String(number) 형식(Python 쪽이 이를 모사), NaN/Infinity → null, undefined 키 제거, 실수는 소수 9자리로 반올림 */
  function canonical(value) {
    const num = v => { if (!finite(v)) return 'null'; const r = Math.round(v * 1e9) / 1e9; return Object.is(r, -0) ? '0' : String(r); };
    const walk = v => {
      if (v === null || v === undefined) return 'null';
      if (typeof v === 'number') return num(v);
      if (typeof v === 'boolean') return v ? 'true' : 'false';
      if (typeof v === 'string') return JSON.stringify(v);
      if (Array.isArray(v)) return '[' + v.map(walk).join(',') + ']';
      if (typeof v === 'object') { const keys = Object.keys(v).filter(k => v[k] !== undefined).sort(); return '{' + keys.map(k => JSON.stringify(k) + ':' + walk(v[k])).join(',') + '}'; }
      return 'null';
    };
    return walk(value);
  }
  /* 동기 SHA-256 (문자열 UTF-8) — crypto.subtle 은 비동기라 파이프라인 hash 를 동기 경로에서 쓰기 위해 구현 */
  function sha256Hex(str) {
    const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    const bytes = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(str) : Buffer.from(str, 'utf8');
    const l = bytes.length, padLen = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(padLen); m.set(bytes); m[l] = 0x80;
    const bits = l * 8; m[padLen - 4] = (bits >>> 24) & 255; m[padLen - 3] = (bits >>> 16) & 255; m[padLen - 2] = (bits >>> 8) & 255; m[padLen - 1] = bits & 255;
    const hi = Math.floor(bits / 0x100000000); m[padLen - 8] = (hi >>> 24) & 255; m[padLen - 7] = (hi >>> 16) & 255; m[padLen - 6] = (hi >>> 8) & 255; m[padLen - 5] = hi & 255;
    let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const w = new Uint32Array(64), rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < padLen; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = (m[off + 4 * i] << 24) | (m[off + 4 * i + 1] << 16) | (m[off + 4 * i + 2] << 8) | m[off + 4 * i + 3];
      for (let i = 16; i < 64; i++) { const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0; }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25), ch = (e & f) ^ (~e & g), t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22), maj = (a & b) ^ (a & c) ^ (b & c), t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H = H.map((v, i) => (v + [a, b, c, d, e, f, g, h][i]) >>> 0);
    }
    return H.map(v => v.toString(16).padStart(8, '0')).join('');
  }
  const digest = value => sha256Hex(canonical(value));

  /* ---------- 개인 시선 파이프라인 snapshot·digest ----------
   * 저장된 model/affine 만으로 당시 분석 좌표를 재현하려면 mu·sd·wx·wy·quad·keys·zr·eyes(검증 포함)·combine·affine·resid·drift 가 모두 필요하다.
   * 스냅샷은 JSON 직렬화 가능한 plain object 로만 구성한다 */
  function pipelineSnapshot(S) {
    const m = S.model || null;
    const strip = model => model ? { mu: model.mu, sd: model.sd, wx: model.wx, wy: model.wy, quad: !!model.quad, keys: model.keys || null, zr: model.zr || null, validation: model.validation || null } : null;
    return {
      version: 1, model: m ? { ...strip(m), eyes: m.eyes ? { left: strip(m.eyes.left), right: strip(m.eyes.right) } : null, combine: m.combine || null } : null,
      affine: S.affine || null, resid: S.resid || null, drift: S.drift ? { dx: S.drift.dx, dy: S.drift.dy } : null,
      gazeModel: S.gazeModel ? { id: S.gazeModel.id || null, version: S.gazeModel.version || null, mode: S.gazeModel.mode || null } : null,
      coreVersion: S.coreVersion || null,
    };
  }
  const pipelineDigest = S => digest(pipelineSnapshot(S));

  /* ---------- 시간 좌표 ----------
   * 세션 내 기준은 performance.now 계열 단조 시계. UTC 는 세션 간 정렬 메타데이터로만 둔다.
   * 탭 재개·카메라 재연결은 새 clock segment 로 기록한다 (segments 는 telemetry.clock 에 들어간다) */
  function clockInfo(win) {
    const p = (win && win.performance) || (typeof performance !== 'undefined' ? performance : null);
    return { monotonic: 'performance.now', timeOrigin: p && finite(p.timeOrigin) ? p.timeOrigin : null, utcAtOrigin: p && finite(p.timeOrigin) ? new Date(p.timeOrigin).toISOString() : null, eventTimeStamp: 'DOMHighResTimeStamp relative to timeOrigin (same clock); precision may be coarsened by the browser' };
  }

  return { VERSION, SCHEMA, LABEL_SOURCES, LABEL_ROLES, FEATURE_ALLOWLIST, FEATURE_DENYLIST, DEFAULT_CONFIG, checkFeatureNames, mulberry32, planTargets, regionOf, viewportState, targetCenter, selectWindow, createEventLog, effectiveLabels, canonical, sha256Hex, digest, pipelineSnapshot, pipelineDigest, clockInfo, median, mean };
});
