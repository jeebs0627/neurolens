/* NeuroLens NewBiz MVP — 웹캠 하나로 시선(주의)과 rPPG(심박·호흡 동조)를 같은 시간축에서 재는 융합 측정 코어.
 * 운영 서비스와 무관한 독립 모듈이다 (newbiz.html 전용). 화면·카메라 코드는 없고 신호처리와 지표 계산만 담는다.
 * - rPPG: POS 알고리즘 (Wang et al., 2017, "Algorithmic principles of remote PPG", IEEE TBME) 을 논문 기준으로 직접 구현
 * - 시선: MediaPipe 홍채 랜드마크 + 머리 자세 특징 → 9점 보정 릿지 회귀
 * 모든 판정 기준은 파일럿 전 잠정값이며, 비진단 참고 지표다.
 * 브라우저: window.NLNewbiz · Node 테스트: module.exports */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NLNewbiz = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const VERSION = 'newbiz-mvp-0.2';
  const HR_BAND = [0.7, 3.0];            // 42~180 bpm
  const SNR_GOOD = 3, SNR_FAIR = -2;     // dB, 잠정 품질 기준
  const THRESH = {                       // 잠정 판정 기준 (파일럿으로 재설정 예정)
    biasHigh: 0.08,                      // 부정 자극 응시 비율이 50%보다 8%p 이상 높으면 '붙잡힘'
    stressHigh: 6,                       // 스트레스 과제 심박 상승 6 bpm 이상이면 '몸 반응 큼'
    negHrHigh: 3,                        // 부정 블록 심박이 중립 블록보다 3 bpm 이상 높으면 '정서 각성'
  };

  /* ---------- 기초 통계 ---------- */
  const finite = v => typeof v === 'number' && Number.isFinite(v);
  const mean = a => { const v = a.filter(finite); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN; };
  const median = a => {
    const v = a.filter(finite).sort((x, y) => x - y);
    if (!v.length) return NaN;
    const m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  };
  const std = a => { const m = mean(a); const v = a.filter(finite); return v.length > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1)) : NaN; };
  const quantile = (a, q) => {
    const v = a.filter(finite).sort((x, y) => x - y);
    if (!v.length) return NaN;
    const i = (v.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
    return v[lo] + (v[hi] - v[lo]) * (i - lo);
  };
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const round = (x, d = 0) => finite(x) ? Math.round(x * 10 ** d) / 10 ** d : null;

  /* ---------- 균일 리샘플 (웹캠 프레임 간격이 흔들리므로 필수) ---------- */
  function resample(ts, cols, fs) {
    const n = ts.length;
    if (n < 2) return { t0: ts[0] || 0, fs, data: cols.map(() => []) };
    const t0 = ts[0], dur = ts[n - 1] - t0, step = 1000 / fs;
    const m = Math.floor(dur / step) + 1;
    const data = cols.map(() => new Float64Array(m));
    let j = 0;
    for (let i = 0; i < m; i++) {
      const t = t0 + i * step;
      while (j < n - 2 && ts[j + 1] < t) j++;
      const ta = ts[j], tb = ts[j + 1], w = tb > ta ? clamp((t - ta) / (tb - ta), 0, 1) : 0;
      cols.forEach((c, k) => { data[k][i] = c[j] + (c[j + 1] - c[j]) * w; });
    }
    return { t0, fs, data };
  }

  /* ---------- 필터: RBJ 2차 biquad + 영위상(filtfilt) ---------- */
  function biquad(type, f0, fs, Q = Math.SQRT1_2) {
    const w = 2 * Math.PI * f0 / fs, cw = Math.cos(w), al = Math.sin(w) / (2 * Q);
    const a0 = 1 + al;
    const b = type === 'low' ? [(1 - cw) / 2, 1 - cw, (1 - cw) / 2] : [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2];
    return { b0: b[0] / a0, b1: b[1] / a0, b2: b[2] / a0, a1: -2 * cw / a0, a2: (1 - al) / a0 };
  }
  function lfilter(c, x) {
    const y = new Float64Array(x.length);
    let x1 = x[0], x2 = x[0], y1 = x[0] * (c.b0 + c.b1 + c.b2) / (1 + c.a1 + c.a2), y2 = y1;
    if (!finite(y1)) y1 = y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = c.b0 * x[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
    }
    return y;
  }
  function filtfilt(c, x) {
    const n = x.length, pad = Math.min(n - 1, 90);
    if (n < 4) return Float64Array.from(x);
    const ext = new Float64Array(n + 2 * pad);
    for (let i = 0; i < pad; i++) { ext[i] = 2 * x[0] - x[pad - i]; ext[n + pad + i] = 2 * x[n - 1] - x[n - 2 - i]; }
    ext.set(x, pad);
    let y = lfilter(c, ext).reverse();
    y = lfilter(c, y).reverse();
    return y.subarray(pad, pad + n);
  }
  function bandpass(x, fs, lo = HR_BAND[0], hi = HR_BAND[1]) {
    const m = mean(Array.from(x));
    let y = Float64Array.from(x, v => v - m);
    const hp = biquad('high', lo, fs), lp = biquad('low', hi, fs);
    y = filtfilt(hp, y); y = filtfilt(hp, y);   // 4차 고역통과
    y = filtfilt(lp, y); y = filtfilt(lp, y);   // 4차 저역통과
    return y;
  }

  /* ---------- POS (Plane-Orthogonal-to-Skin) ---------- */
  function pos(r, g, b, fs) {
    const N = r.length, l = Math.ceil(1.6 * fs), H = new Float64Array(N);
    for (let n = l; n <= N; n++) {
      const m = n - l;
      let mr = 0, mg = 0, mb = 0;
      for (let i = m; i < n; i++) { mr += r[i]; mg += g[i]; mb += b[i]; }
      mr /= l; mg /= l; mb /= l;
      if (!(mr > 0 && mg > 0 && mb > 0)) continue;
      const s1 = new Float64Array(l), s2 = new Float64Array(l);
      for (let i = 0; i < l; i++) {
        const cr = r[m + i] / mr, cg = g[m + i] / mg, cb = b[m + i] / mb;
        s1[i] = cg - cb;
        s2[i] = -2 * cr + cg + cb;
      }
      const sd2 = std(Array.from(s2));
      const alpha = sd2 > 0 ? std(Array.from(s1)) / sd2 : 0;
      let hm = 0;
      const h = new Float64Array(l);
      for (let i = 0; i < l; i++) { h[i] = s1[i] + alpha * s2[i]; hm += h[i]; }
      hm /= l;
      for (let i = 0; i < l; i++) H[m + i] += h[i] - hm;
    }
    return H;
  }

  /* ---------- FFT 파워 스펙트럼 ---------- */
  function nextPow2(n) { let p = 1; while (p < n) p <<= 1; return p; }
  function powerSpectrum(x, nfft) {
    const re = new Float64Array(nfft), im = new Float64Array(nfft);
    re.set(x.length > nfft ? x.subarray(0, nfft) : x);
    for (let i = 1, j = 0; i < nfft; i++) {
      let bit = nfft >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= nfft; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < nfft; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2;
          const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
          const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
    const p = new Float64Array(nfft / 2 + 1);
    for (let i = 0; i < p.length; i++) p[i] = re[i] * re[i] + im[i] * im[i];
    return p;
  }

  /* 대역 안 최대 피크 주파수(포물선 보간) + SNR(1·2차 고조파 ±0.1Hz 대 나머지, dB) */
  function spectralPeak(x, fs, lo = HR_BAND[0], hi = HR_BAND[1]) {
    const n = x.length;
    if (n < fs * 4) return null;
    const w = Float64Array.from(x, (v, i) => v * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1))));
    const nfft = Math.max(2048, nextPow2(n * 4));
    const p = powerSpectrum(w, nfft), df = fs / nfft;
    const i0 = Math.ceil(lo / df), i1 = Math.floor(hi / df);
    let k = i0;
    for (let i = i0; i <= i1; i++) if (p[i] > p[k]) k = i;
    let off = 0;
    if (k > i0 && k < i1) {
      const a = p[k - 1], b = p[k], c = p[k + 1], den = a - 2 * b + c;
      if (den !== 0) off = clamp(0.5 * (a - c) / den, -0.5, 0.5);
    }
    const f0 = (k + off) * df;
    let sig = 0, noise = 0;
    const s0 = Math.ceil(0.6 / df), s1 = Math.floor(3.3 / df);
    for (let i = s0; i <= s1; i++) {
      const f = i * df;
      if (Math.abs(f - f0) <= 0.1 || Math.abs(f - 2 * f0) <= 0.1) sig += p[i]; else noise += p[i];
    }
    const snrDb = noise > 0 && sig > 0 ? 10 * Math.log10(sig / noise) : -20;
    return { hz: f0, bpm: f0 * 60, snrDb };
  }

  const quality = snr => !finite(snr) ? 'none' : snr >= SNR_GOOD ? 'good' : snr >= SNR_FAIR ? 'fair' : 'poor';

  /* ---------- 프레임 기록 → BVP 파형 ---------- */
  /* frames: [{t(ms), r,g,b, ok}] — 얼굴이 잡힌(ok) 프레임만 써서 30Hz 로 맞춘다 */
  function buildBvp(frames, fs = 30) {
    const ok = frames.filter(f => f.ok && finite(f.r) && finite(f.g) && finite(f.b));
    if (ok.length < fs * 5) return null;
    const rs = resample(ok.map(f => f.t), [ok.map(f => f.r), ok.map(f => f.g), ok.map(f => f.b)], fs);
    const raw = pos(rs.data[0], rs.data[1], rs.data[2], fs);
    return { t0: rs.t0, fs, bvp: bandpass(raw, fs), coverage: ok.length / Math.max(1, frames.length) };
  }

  /* 10초 창·1초 간격으로 심박 시계열 */
  function hrWindows(sig, winSec = 10, stepSec = 1) {
    if (!sig) return [];
    const { bvp, fs, t0 } = sig, wl = Math.round(winSec * fs), st = Math.round(stepSec * fs), out = [];
    for (let s = 0; s + wl <= bvp.length; s += st) {
      const pk = spectralPeak(bvp.subarray(s, s + wl), fs);
      if (pk) out.push({ t: t0 + (s + wl / 2) * 1000 / fs, bpm: pk.bpm, snr: pk.snrDb });
    }
    return out;
  }

  /* 구간 대표 심박: 창 중심이 구간 안에 있는 창들의 중앙값 (품질 낮은 창은 제외, 모두 낮으면 전체 사용) */
  function phaseHr(wins, start, end) {
    const inside = wins.filter(w => w.t >= start && w.t <= end);
    if (!inside.length) return { bpm: null, snr: null, quality: 'none', n: 0 };
    const usable = inside.filter(w => w.snr >= SNR_FAIR);
    const use = usable.length >= Math.max(2, inside.length * 0.3) ? usable : inside;
    const snr = median(inside.map(w => w.snr));
    return { bpm: round(median(use.map(w => w.bpm)), 1), snr: round(snr, 1), quality: quality(snr), n: inside.length };
  }

  /* ---------- 박동 검출 → 박동 간격(IBI) ---------- */
  function beats(sig, start, end, hrBpm) {
    if (!sig || !finite(hrBpm)) return [];
    const { bvp, fs, t0 } = sig;
    const i0 = Math.max(1, Math.floor((start - t0) * fs / 1000)), i1 = Math.min(bvp.length - 2, Math.ceil((end - t0) * fs / 1000));
    const minGap = 0.6 * 60 / hrBpm * fs;
    const seg = Array.from(bvp.subarray(i0, i1 + 1));
    const thr = quantile(seg, 0.5);
    const out = [];
    let last = -Infinity;
    for (let i = i0; i <= i1; i++) {
      if (bvp[i] > bvp[i - 1] && bvp[i] >= bvp[i + 1] && bvp[i] > thr) {
        const a = bvp[i - 1], b = bvp[i], c = bvp[i + 1], den = a - 2 * b + c;
        const idx = i + (den !== 0 ? clamp(0.5 * (a - c) / den, -0.5, 0.5) : 0);
        if (idx - last >= minGap) { out.push(t0 + idx * 1000 / fs); last = idx; }
        else if (bvp[i] > bvp[Math.round(last)]) { out[out.length - 1] = t0 + idx * 1000 / fs; last = idx; }
      }
    }
    return out;
  }
  function ibis(beatTimes) {
    const raw = [];
    for (let i = 1; i < beatTimes.length; i++) raw.push({ t: beatTimes[i], ibi: beatTimes[i] - beatTimes[i - 1] });
    const valid = raw.filter(x => x.ibi >= 333 && x.ibi <= 1500);
    const med = median(valid.map(x => x.ibi));
    return valid.filter(x => Math.abs(x.ibi - med) <= med * 0.3);
  }
  function rmssd(list) {
    if (list.length < 5) return null;
    let s = 0, n = 0;
    for (let i = 1; i < list.length; i++) {
      if (list[i].t - list[i - 1].t > 2000) continue;   // 끊긴 구간 건너뜀
      s += (list[i].ibi - list[i - 1].ibi) ** 2; n++;
    }
    return n >= 4 ? Math.sqrt(s / n) : null;
  }

  /* 호흡 동조: 박동별 순간 심박을 4Hz 로 맞춘 뒤 0.1Hz(분당 6회 호흡) 대역의 진폭과 비중 */
  function breathingCoupling(list, targetHz = 0.1) {
    if (list.length < 12) return null;
    const fs = 4;
    const rs = resample(list.map(x => x.t), [list.map(x => 60000 / x.ibi)], fs);
    const hr = rs.data[0];
    if (hr.length < fs * 20) return null;
    const m = mean(Array.from(hr));
    const x = Float64Array.from(hr, v => v - m);
    const band = bandpass(x, fs, targetHz * 0.6, targetHz * 1.6);
    const amp = quantile(Array.from(band), 0.9) - quantile(Array.from(band), 0.1);
    const nfft = Math.max(1024, nextPow2(x.length * 4)), p = powerSpectrum(x, nfft), df = fs / nfft;
    let inB = 0, tot = 0;
    for (let i = 0; i < p.length; i++) {
      const f = i * df;
      if (f < 0.04 || f > 0.4) continue;
      tot += p[i];
      if (Math.abs(f - targetHz) <= 0.025) inB += p[i];
    }
    return { ampBpm: round(amp, 1), ratio: tot > 0 ? round(inB / tot, 2) : null };
  }

  /* ---------- 시선 특징 (MediaPipe Face Landmarker 478점) ---------- */
  const LM = {
    rOuter: 33, rInner: 133, rTop: 159, rBot: 145, rIris: 468,
    lInner: 362, lOuter: 263, lTop: 386, lBot: 374, lIris: 473,
    nose: 1, faceL: 234, faceR: 454, top: 10, chin: 152,
    forehead: 151, cheekR: 50, cheekL: 280,
  };
  function eyeUV(lm, a, b, top, bot, iris) {
    const ax = lm[a].x, ay = lm[a].y, bx = lm[b].x, by = lm[b].y;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, L = Math.sqrt(L2);
    const ix = lm[iris].x - ax, iy = lm[iris].y - ay;
    const u = (ix * dx + iy * dy) / L2;                       // 눈꼬리→눈머리 축 위치 (0~1)
    const midY = (lm[top].y + lm[bot].y) / 2;
    const v = (lm[iris].y - midY) / L;                        // 눈 높이 대비 홍채 상하 위치
    const open = Math.hypot(lm[bot].x - lm[top].x, lm[bot].y - lm[top].y) / L;
    return { u, v, open };
  }
  function faceFeatures(lm) {
    if (!lm || lm.length < 478) return null;
    const imgLeftFirst = (a, b) => lm[a].x <= lm[b].x ? [a, b] : [b, a];
    const [ra, rb] = imgLeftFirst(LM.rOuter, LM.rInner);
    const [la, lb] = imgLeftFirst(LM.lInner, LM.lOuter);
    const R = eyeUV(lm, ra, rb, LM.rTop, LM.rBot, LM.rIris);
    const Lf = eyeUV(lm, la, lb, LM.lTop, LM.lBot, LM.lIris);
    const fl = lm[LM.faceL], fr = lm[LM.faceR], tp = lm[LM.top], ch = lm[LM.chin], ns = lm[LM.nose];
    const fw = Math.hypot(fr.x - fl.x, fr.y - fl.y);
    const fh = Math.hypot(ch.x - tp.x, ch.y - tp.y);
    return {
      u: (R.u + Lf.u) / 2, v: (R.v + Lf.v) / 2,
      yaw: (ns.x - fl.x) / (fr.x - fl.x) - 0.5,
      pitch: (ns.y - tp.y) / (ch.y - tp.y) - 0.5,
      cx: (fl.x + fr.x) / 2, cy: (tp.y + ch.y) / 2, fw, fh,
      open: (R.open + Lf.open) / 2,
    };
  }
  const GAZE_KEYS = ['u', 'v', 'yaw', 'pitch', 'cx', 'cy'];
  function solve(A, y) {                                    // 가우스 소거 (부분 피벗)
    const n = y.length, M = A.map((row, i) => [...row, y[i]]);
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]];
      if (Math.abs(M[c][c]) < 1e-12) return null;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map((row, i) => row[n] / row[i]);
  }
  /* samples: [{f, x, y}] (x,y = 화면 px) → 표준화 + 릿지 회귀 모델 */
  function fitGaze(samples, lambda = 0.5) {
    const S = samples.filter(s => s.f && GAZE_KEYS.every(k => finite(s.f[k])));
    if (S.length < 20) return null;
    const mu = {}, sd = {};
    GAZE_KEYS.forEach(k => { mu[k] = mean(S.map(s => s.f[k])); sd[k] = std(S.map(s => s.f[k])) || 1; });
    const vec = f => [1, ...GAZE_KEYS.map(k => (f[k] - mu[k]) / sd[k])];
    const X = S.map(s => vec(s.f)), d = X[0].length;
    const fit = key => {
      const XtX = Array.from({ length: d }, () => new Array(d).fill(0)), Xty = new Array(d).fill(0);
      X.forEach((row, i) => {
        for (let a = 0; a < d; a++) { Xty[a] += row[a] * S[i][key]; for (let b = 0; b < d; b++) XtX[a][b] += row[a] * row[b]; }
      });
      for (let a = 1; a < d; a++) XtX[a][a] += lambda * S.length / 50;
      return solve(XtX, Xty);
    };
    const wx = fit('x'), wy = fit('y');
    return wx && wy ? { mu, sd, wx, wy } : null;
  }
  function predictGaze(model, f) {
    if (!model || !f) return null;
    const v = [1, ...GAZE_KEYS.map(k => (f[k] - model.mu[k]) / model.sd[k])];
    const dot = w => w.reduce((s, x, i) => s + x * v[i], 0);
    return { x: dot(model.wx), y: dot(model.wy) };
  }
  /* 검증점 오차 → 화면 폭 대비 비율과 등급 */
  function gazeAccuracy(points, W, H) {
    const errs = points.filter(p => finite(p.gx) && finite(p.gy)).map(p => Math.hypot(p.gx - p.x, (p.gy - p.y) * 0.6));
    if (!errs.length) return { errPct: null, grade: 'none' };
    const e = median(errs) / W * 100;
    return { errPct: round(e, 1), grade: e <= 10 ? 'good' : e <= 18 ? 'fair' : 'poor', hx: round(median(points.map(p => Math.abs(p.gx - p.x))) / W * 100, 1) };
  }

  /* ---------- 정서 자유 보기 지표 ---------- */
  const SIDE_GAP = 0.06, ONSET_SKIP = 150, MAX_DT = 120;
  const sideOf = (x, W) => !finite(x) ? null : x < W * (0.5 - SIDE_GAP) ? 'L' : x > W * (0.5 + SIDE_GAP) ? 'R' : null;
  /* trial: {kind:'neg'|'pos'|'neu', emoSide:'L'|'R', onset, end, samples:[{t,x}]} */
  function trialStats(tr, W) {
    let emo = 0, other = 0, first = null, firstVisit = null, visitStart = null, lapse = 0, lapseStart = null;
    const s = tr.samples.filter(p => p.t >= tr.onset && p.t <= tr.end);
    for (let i = 0; i < s.length; i++) {
      const side = sideOf(s[i].x, W);
      const dt = i + 1 < s.length ? Math.min(MAX_DT, s[i + 1].t - s[i].t) : 0;
      if (side === tr.emoSide) emo += dt; else if (side) other += dt;
      if (!first && side && s[i].t - tr.onset >= ONSET_SKIP) first = side === tr.emoSide ? 'emo' : 'other';
      if (firstVisit === null) {                       // 감정 자극에 처음 머문 시간 (100ms 미만 이탈은 무시)
        if (side === tr.emoSide) { if (visitStart === null) visitStart = s[i].t; lapse = 0; lapseStart = null; }
        else if (visitStart !== null) {
          if (lapseStart === null) lapseStart = s[i].t;
          lapse += dt;
          if (lapse >= 100) firstVisit = lapseStart - visitStart;
        }
      }
    }
    if (firstVisit === null && visitStart !== null) firstVisit = tr.end - visitStart;
    const total = emo + other, dur = tr.end - tr.onset;
    const valid = total >= dur * 0.3;
    return { valid, emoShare: valid ? emo / total : null, first: valid ? first : null, firstVisitMs: valid ? firstVisit : null };
  }
  /* 좌우 균형 가중(NL-QC 5): 유효 시행이 한쪽에 몰리면 개인의 좌우 시선 치우침이 편향처럼 보이므로,
   * 정서 자극이 왼쪽·오른쪽에 있던 시행을 따로 평균한 뒤 두 평균을 같은 비중으로 합친다 (양쪽 2시행 이상일 때) */
  function blockStats(trials, W) {
    const st = trials.map(t => ({ ...trialStats(t, W), side: t.emoSide })).filter(s => s.valid);
    const firsts = st.filter(s => s.first);
    const L = st.filter(s => s.side === 'L').map(s => s.emoShare), R = st.filter(s => s.side === 'R').map(s => s.emoShare);
    const balanced = L.length >= 2 && R.length >= 2;
    return {
      n: trials.length, valid: st.length, balanced,
      emoShare: !st.length ? null : balanced ? round((mean(L) + mean(R)) / 2, 3) : round(mean(st.map(s => s.emoShare)), 3),
      firstEmoRate: firsts.length ? round(firsts.filter(s => s.first === 'emo').length / firsts.length, 2) : null,
      dwellMs: st.length ? round(median(st.map(s => s.firstVisitMs)), 0) : null,
    };
  }

  /* ---------- 깜빡임 · 움직임 · 표정 ---------- */
  /* series: [{t, blink(0~1)}] — 0.5 이상이 50~500ms 이어지면 1회 */
  function blinkRate(series, start, end) {
    const s = series.filter(p => p.t >= start && p.t <= end && finite(p.blink));
    if (s.length < 10) return null;
    let n = 0, on = null;
    s.forEach(p => {
      if (p.blink >= 0.5) { if (on === null) on = p.t; }
      else if (on !== null) { const d = p.t - on; if (d >= 50 && d <= 500) n++; on = null; }
    });
    const min = (s[s.length - 1].t - s[0].t) / 60000;
    return min > 0.2 ? round(n / min, 1) : null;
  }
  /* series: [{t, cx, cy, fw}] — 1초당 얼굴 중심 이동량 / 얼굴 폭 (%) 의 중앙값 */
  function motionIndex(series, start, end) {
    const s = series.filter(p => p.t >= start && p.t <= end && finite(p.cx));
    if (s.length < 10) return null;
    const per = [];
    let a = s[0];
    for (const p of s) {
      if (p.t - a.t >= 1000) { per.push(Math.hypot(p.cx - a.cx, p.cy - a.cy) / (p.fw || 1) * 100); a = p; }
    }
    return per.length ? round(median(per), 1) : null;
  }
  function expression(series, start, end) {
    const s = series.filter(p => p.t >= start && p.t <= end && finite(p.frown));
    if (s.length < 10) return null;
    return { frown: round(mean(s.map(p => p.frown)), 3), smile: round(mean(s.map(p => p.smile)), 3) };
  }

  /* ---------- 마음 반응 프로파일 ---------- */
  const PROFILES = {
    stable:   { title: '안정형', tag: '마음도 몸도 비교적 고요해요', desc: '부정 자극에 오래 붙잡히지 않았고, 압박 과제에서도 몸의 반응이 크지 않았어요. 지금의 리듬을 지키는 유지 관리가 잘 맞아요.' },
    mind:     { title: '생각 붙잡힘형', tag: '몸은 차분한데 시선이 부정 정보에 머물러요', desc: '신체 반응은 크지 않지만 시선이 부정적인 자극 쪽에 더 오래 머물렀어요. 걱정이나 반추가 조용히 에너지를 쓰고 있을 수 있어요.' },
    body:     { title: '몸 먼저 반응형', tag: '생각보다 몸이 먼저 긴장해요', desc: '시선은 고르게 분배됐지만 압박 상황에서 심박이 뚜렷하게 올랐어요. 머리로는 괜찮아도 몸이 먼저 경보를 울리는 패턴이에요.' },
    overload: { title: '복합 과부하형', tag: '마음과 몸이 함께 긴장해 있어요', desc: '시선이 부정 자극에 머물고, 몸의 반응도 컸어요. 최근 부담이 누적됐을 수 있어요. 회복을 먼저 챙겨 주세요.' },
    partial:  { title: '부분 측정', tag: '일부 신호만 충분히 측정됐어요', desc: '조명·움직임·보정 상태 때문에 한쪽 축의 신호가 충분하지 않았어요. 측정된 지표만 참고하고, 밝은 곳에서 다시 측정해 보세요.' },
  };
  const CARE = {
    stable:   { track: '유지 관리 트랙', items: ['주 2회 60초 데일리 체크로 개인 기준선 쌓기', '감사 기록 1줄', '호흡 바이오피드백은 필요할 때만'] },
    mind:     { track: '주의 전환 트랙', items: ['주의 전환 훈련: 부정 자극에서 시선을 떼는 연습 (하루 2분)', '걱정 시간 정하기 — 반추를 정해진 15분으로 모으기', '생각 라벨링: "나는 지금 ~라는 생각을 하고 있다"'] },
    body:     { track: '신체 이완 트랙', items: ['심박 바이오피드백 호흡 (분당 6회, 하루 3분)', '긴장 직후 90초 몸 스캔', '카페인·수면 리듬 점검'] },
    overload: { track: '회복 우선 트랙', items: ['호흡 바이오피드백 + 주의 전환 훈련 병행', '일정 덜어내기 — 이번 주 미룰 수 있는 일 1가지', '지속되면 전문 상담 연결 (정신건강 위기상담 109)'] },
    partial:  { track: '재측정 권장', items: ['밝고 균일한 조명에서 정면을 보고 재측정', '안경 반사·역광 피하기', '측정 중 머리 움직임 줄이기'] },
  };

  /* 측정 기록 전체 → 지표·프로파일. rec = {frames, phases:{name:{start,end}}, trials, calibration, checkin, demo} */
  function analyze(rec) {
    const sig = buildBvp(rec.frames);
    const wins = hrWindows(sig);
    const ph = rec.phases;
    const span = n => ph[n] ? [ph[n].start, ph[n].end] : [NaN, NaN];
    const hr = {};
    ['baseline', 'neu', 'neg', 'pos', 'stress', 'recovery'].forEach(n => { hr[n] = phaseHr(wins, ...span(n)); });
    /* 회복: 회복 구간 후반 절반 심박 */
    const [rs, re] = span('recovery');
    hr.recoveryLate = phaseHr(wins, (rs + re) / 2, re);

    const usableHr = q => q && q.bpm !== null && q.quality !== 'poor' && q.quality !== 'none';
    const stressDelta = usableHr(hr.baseline) && usableHr(hr.stress) ? round(hr.stress.bpm - hr.baseline.bpm, 1) : null;
    const negDelta = usableHr(hr.neu) && usableHr(hr.neg) ? round(hr.neg.bpm - hr.neu.bpm, 1) : null;
    let recovery = null;
    if (stressDelta !== null && usableHr(hr.recoveryLate)) {
      const drop = hr.stress.bpm - hr.recoveryLate.bpm;
      recovery = stressDelta >= 2 ? round(clamp(drop / stressDelta, -1, 2) * 100, 0) : null;
    }
    const recIbis = sig && usableHr(hr.recovery) ? ibis(beats(sig, rs, re, hr.recovery.bpm)) : [];
    const coupling = breathingCoupling(recIbis);
    const baseIbis = sig && usableHr(hr.baseline) ? ibis(beats(sig, ...span('baseline'), hr.baseline.bpm)) : [];
    const hrv = rmssd(baseIbis);

    const W = rec.screenW;
    const blocks = {};
    ['neu', 'neg', 'pos'].forEach(k => { blocks[k] = blockStats(rec.trials.filter(t => t.kind === k), W); });
    const sideBias = blocks.neu.emoShare;               // 중립-중립 블록의 '표적 쪽' 응시 비율 = 개인의 좌우 치우침 기준
    const attentionBias = blocks.neg.emoShare !== null ? round(blocks.neg.emoShare - 0.5, 3) : null;
    const positivity = blocks.pos.emoShare !== null ? round(blocks.pos.emoShare - 0.5, 3) : null;

    const fr = rec.frames;
    const all = [fr.length ? fr[0].t : 0, fr.length ? fr[fr.length - 1].t : 0];
    const face = rec.frames.filter(f => f.ok);
    const blink = { baseline: blinkRate(face, ...span('baseline')), stress: blinkRate(face, ...span('stress')), all: blinkRate(face, ...all) };
    const motion = { baseline: motionIndex(face, ...span('baseline')), all: motionIndex(face, ...all) };
    const expr = { neu: expression(face, ...span('neu')), neg: expression(face, ...span('neg')), pos: expression(face, ...span('pos')) };
    const exprNeg = expr.neu && expr.neg ? round((expr.neg.frown - expr.neu.frown) * 100, 1) : null;

    const gazeOk = !!rec.calibration && rec.calibration.grade !== 'poor' && rec.calibration.grade !== 'none' && blocks.neg.n > 0 && blocks.neg.valid >= Math.ceil(blocks.neg.n / 2);
    const bodyOk = stressDelta !== null;
    const biasHigh = gazeOk && attentionBias >= THRESH.biasHigh;
    const bodyHigh = bodyOk && (stressDelta >= THRESH.stressHigh || (negDelta !== null && negDelta >= THRESH.negHrHigh));
    const code = !gazeOk || !bodyOk ? 'partial' : biasHigh && bodyHigh ? 'overload' : biasHigh ? 'mind' : bodyHigh ? 'body' : 'stable';

    /* 자기보고와 실측의 불일치: 체크인 긴장도(1~5) vs 신체 반응 */
    const tension = rec.checkin && finite(rec.checkin.tension) ? rec.checkin.tension : null;
    let mismatch = null;
    if (tension !== null && bodyOk) {
      if (tension <= 2 && bodyHigh) mismatch = { kind: 'body-hidden', text: '스스로는 긴장이 낮다고 느꼈지만, 몸은 압박 상황에서 뚜렷하게 반응했어요. 몸의 신호를 알아차리는 연습이 도움이 될 수 있어요.' };
      else if (tension >= 4 && !bodyHigh) mismatch = { kind: 'mind-only', text: '스스로는 긴장이 높다고 느꼈지만, 몸의 반응은 비교적 차분했어요. 긴장감이 생각 쪽에서 오고 있을 수 있어요.' };
      else mismatch = { kind: 'aligned', text: '느끼는 긴장도와 몸의 반응이 대체로 일치했어요.' };
    }

    const coverage = sig ? round(sig.coverage * 100, 0) : 0;
    return {
      version: VERSION, demo: !!rec.demo, measuredAt: rec.measuredAt || null, checkin: rec.checkin || null,
      quality: { faceCoverage: coverage, gaze: rec.calibration || null, hr: hr.baseline.quality, gazeOk, bodyOk },
      hr, stressDelta, negDelta, recovery, coupling, hrv: round(hrv, 0),
      gaze: { blocks, sideBias, attentionBias, positivity, dwellNeg: blocks.neg.dwellMs, firstNeg: blocks.neg.firstEmoRate },
      blink, motion, expr, exprNeg,
      profile: { code, ...PROFILES[code], biasHigh, bodyHigh },
      care: CARE[code], mismatch,
      timeline: wins.map(w => ({ t: Math.round(w.t), bpm: round(w.bpm, 1), snr: round(w.snr, 1) })),
    };
  }

  /* 실시간 심박 (바이오피드백용): 최근 frames 로 즉시 추정 */
  function liveHr(frames, winSec = 10) {
    if (!frames.length) return null;
    const end = frames[frames.length - 1].t;
    const recent = frames.filter(f => f.t >= end - winSec * 1000);
    const sig = buildBvp(recent);
    if (!sig) return null;
    const pk = spectralPeak(sig.bvp, sig.fs);
    return pk ? { bpm: round(pk.bpm, 0), snr: round(pk.snrDb, 1), quality: quality(pk.snrDb) } : null;
  }

  /* ---------- 시뮬레이션 (카메라 없는 데모·테스트용) ----------
   * hrAt(t) 로 정한 심박을 따라 피부색에 맥동을 섞은 프레임을 만든다. 데모 결과는 반드시 '시뮬레이션'으로 표시한다. */
  function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }
  /* opt.eyeAt(t) → {blinkMs, drowsy(긴 눈감김 발생률 /초)}, opt.motionAt(t) → 머리 흔들림 배율 */
  function synthFrames(t0, t1, hrAt, opt = {}) {
    const fps = opt.fps || 30, rand = rng(opt.seed || 7), noise = opt.noise ?? 0.25, out = [];
    const gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += rand(); return u - 3; };
    let phase = 0, t = t0, nextBlink = t0 + 2500, closeUntil = -Infinity;
    while (t <= t1) {
      const dt = 1000 / fps * (1 + (rand() - 0.5) * 0.3);             // 웹캠처럼 프레임 간격 흔들림
      phase += 2 * Math.PI * hrAt(t) / 60 * dt / 1000;
      const p = Math.sin(phase) + 0.35 * Math.sin(2 * phase - 0.8);
      const drift = 2 * Math.sin(t / 9000);
      const eye = opt.eyeAt ? opt.eyeAt(t) : { blinkMs: 150, drowsy: 0 };
      if (t >= nextBlink && t >= closeUntil) { closeUntil = t + eye.blinkMs; nextBlink = t + 2500 + rand() * 3000; }
      if (eye.drowsy && t >= closeUntil && rand() < eye.drowsy * dt / 1000) closeUntil = t + 400 + rand() * 900;
      const closed = t < closeUntil;
      const mv = 0.002 * (opt.motionAt ? opt.motionAt(t) : 1);
      out.push({
        t, ok: true,
        r: 175 + drift + 0.25 * p + noise * gauss(), g: 118 + drift * 0.8 + 0.6 * p + noise * gauss(), b: 98 + drift * 0.7 + 0.15 * p + noise * gauss(),
        blink: closed ? 0.9 : 0.02, open: closed ? 0.04 : 0.29 + 0.008 * gauss(),
        cx: 0.5 + mv * gauss(), cy: 0.5 + mv * gauss(), fw: 0.3,
        frown: (opt.frownAt ? opt.frownAt(t) : 0.05) + 0.01 * rand(), smile: 0.1 + 0.01 * rand(),
      });
      t += dt;
    }
    return out;
  }

  return {
    VERSION, THRESH, LM, PROFILES, CARE,
    mean, median, std, quantile, resample, biquad, filtfilt, bandpass, pos, powerSpectrum, spectralPeak, quality,
    buildBvp, hrWindows, phaseHr, beats, ibis, rmssd, breathingCoupling,
    faceFeatures, fitGaze, predictGaze, gazeAccuracy,
    sideOf, trialStats, blockStats, blinkRate, motionIndex, expression, analyze, liveHr, synthFrames,
  };
});
