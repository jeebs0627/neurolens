/* NeuroLens NewBiz MVP — 웹캠 하나로 시선(주의)과 rPPG(심박·호흡 동조)를 같은 시간축에서 재는 융합 측정 코어.
 * 운영 서비스와 무관한 독립 모듈이다 (newbiz.html 전용). 화면·카메라 코드는 없고 신호처리와 지표 계산만 담는다.
 * - rPPG: POS 알고리즘 (Wang et al., 2017, "Algorithmic principles of remote PPG", IEEE TBME) 을 논문 기준으로 직접 구현
 * - 시선: MediaPipe 홍채 랜드마크 + 머리 자세 특징 → 9점 보정 릿지 회귀
 * 모든 판정 기준은 파일럿 전 잠정값이며, 비진단 참고 지표다.
 * 브라우저: window.NLNewbiz · Node 테스트: module.exports */
(function (root, factory) {
  const signal = typeof module === 'object' && module.exports ? require('./condition-signal.js') : root && root.NLSignal;
  const fusion = typeof module === 'object' && module.exports ? require('./condition-fusion.js') : root && root.NLFusionFactory;
  const api = factory(signal, fusion);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NLNewbiz = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function (Signal, createFusion) {
  'use strict';

  const VERSION = 'In_mind core 2.5';   // 2.5 (2026-10-10): 압박 상승이 max(3bpm, 2×SE)보다 작으면 회복률을 계산하지 않음(recoveryNA) · 2.4 (2026-10-09): 안정화기가 확인한 큰 시선 이동의 보류 표본을 분석에 되살림(사카드·자유 보기 잠복기 1프레임 지연 편향 제거) · 2.3 (2026-10-07): 홍채 세로 위치 기준을 눈꺼풀 중점→눈꼬리 축으로(실측 재생 13세션 검증), 클릭 보정·국소 잔차·lookV 후보 삭제, 추적 보정 경로 균형(18초 전 주기) · 2.1~2.2: 심박 고조파 합 피크 선택 · 2.0 (2026-10-06): 150ms 이하 프레임 공백은 보간 표시 안 함(1~2프레임 누락으로 창 전체가 버려지던 문제) · 1.9 (2026-10-05): 심박 창 탈락·건너뜀 진단, 움직임 판정 창 확대 · 1.8: 세션 심박 흐름으로 약한·빠진 구간 보정 · 1.7: 보정 4단계에 세로 점수 후보(여유 기준 선택) · 1.6: 세로 시선 점수(lookV) 기록·그림자 비교(측정 모델 불변) · 1.5: 시선 커서 응시 고정 · 1.4: 0.6초 이하 프레임 공백 보간, 머리 움직임 구간 블랭킹 · 1.3: 시선 제곱항 접선 연장·화면 밖 압축, 심박 영역 합성 유도 후보·국소 사전값 추적
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

  /* CHROM projection (de Haan & Jeanne, 2013, doi:10.1109/TBME.2013.2266196).
   * Filtering and colour normalization are confined to each observed continuous segment. */
  function chrom(r,g,b,fs) {
    const mr=mean(Array.from(r)),mg=mean(Array.from(g)),mb=mean(Array.from(b));
    if(!(mr>0&&mg>0&&mb>0))return new Float64Array(r.length);
    const x=bandpass(Float64Array.from(r,(v,i)=>3*v/mr-2*g[i]/mg),fs);
    const y=bandpass(Float64Array.from(r,(v,i)=>1.5*v/mr+g[i]/mg-1.5*b[i]/mb),fs);
    const sy=std(Array.from(y)),alpha=sy>1e-12?std(Array.from(x))/sy:0;
    return Float64Array.from(x,(v,i)=>v-alpha*y[i]);
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
  function spectralPeak(x, fs, lo = HR_BAND[0], hi = HR_BAND[1], minSec = 4) {
    const n = x.length;
    if (n < fs * minSec) return null;
    const w = Float64Array.from(x, (v, i) => v * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1))));
    const nfft = Math.max(2048, nextPow2(n * 4));
    const p = powerSpectrum(w, nfft), df = fs / nfft;
    const i0 = Math.ceil(lo / df), i1 = Math.floor(hi / df);
    /* 고조파 합 피크 선택: 맥파는 기본 주파수와 2차 고조파를 함께 가지므로 P(f)+0.5·P(2f) 가 최대인 f 를 고른다.
     * 잡음 피크는 2f 에 짝이 없어 불리하고, 반주파수 오류(f/2)는 P(f/2) 가 작아 불리하다. 보간·SNR 은 기본 주파수에서 그대로 */
    const hs = i => p[i] + (2 * i < p.length ? 0.5 * p[2 * i] : 0);
    let k = i0;
    for (let i = i0; i <= i1; i++) if (hs(i) > hs(k)) k = i;
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
  /* 다중 피부 영역: 프레임에 영역별 평균색(rr = [[r,g,b] 이마, 왼뺨, 오른뺨])이 있으면 영역마다 POS 파형을 따로 만든다.
   * 움직임·조명 그림자는 영역마다 다르게 들어오므로, 창마다 가장 깨끗한 영역을 고르면 신호 손실이 크게 준다 */
  function buildBvp(frames, fs = 30) {
    const ok = frames.filter(f => (f.ppgOk ?? f.ok) && [f.t,f.r,f.g,f.b].every(finite)).sort((a,b)=>a.t-b.t);
    if (ok.length < 40 || ok.at(-1).t-ok[0].t < 5000) return null;
    const t0=ok[0].t, length=Math.floor((ok.at(-1).t-t0)*fs/1000)+1;
    const channel = (pick,qualityOf) => {
      const rows=ok.map(f=>({t:f.t,v:pick(f),q:qualityOf(f)})).filter(p=>p.v && p.v.every(finite));
      const dt=median(rows.slice(1).map((p,i)=>p.t-rows[i].t).filter(v=>v>0));
      const bvp=new Float64Array(length).fill(NaN), repaired=new Uint8Array(length), chromWave=new Float64Array(length).fill(NaN), greenWave=new Float64Array(length).fill(NaN), qualityTrace=new Float32Array(length), jitterTrace=new Float32Array(length);
      if(rows.length<40 || !(dt<=150))return {bvp,repaired,chromWave,greenWave,quality:qualityTrace,jitter:jitterTrace};
      // Only isolated RGB impulses with matching neighbours are removed. Raw rows are untouched.
      const clean=rows.filter((p,i)=>{
        const a=rows[i-1],b=rows[i+1];
        if(!a||!b||b.t-a.t>150)return true;
        const near=Math.max(...a.v.map((v,k)=>Math.abs(v-b.v[k])))<2;
        return !(near && Math.max(...p.v.map((v,k)=>Math.abs(v-(a.v[k]+b.v[k])/2)))>8);
      });
      clean.forEach((p,i)=>{
        const prev=clean[i-1];p.jitter=0;
        if(prev&&p.t-prev.t<=200){
          const ratio=(v,k)=>v[k]/Math.max(1,v[1]);
          p.jitter=Math.max(...[0,2].map(k=>Math.abs(ratio(p.v,k)/Math.max(.01,ratio(prev.v,k))-1)));
        }
      });
      const gaps=clean.map((p,i)=>i?p.t-clean[i-1].t:NaN),dtCache=new Map();
      const localDt=j=>{if(!dtCache.has(j)){const g=gaps.slice(Math.max(1,j-15),j+16).filter(v=>v>0);dtCache.set(j,g.length?median(g):dt);}return dtCache.get(j);};
      const rgb=[0,1,2].map(()=>new Float64Array(length).fill(NaN));
      let j=0;
      for(let i=0;i<length;i++){
        const t=t0+i*1000/fs;
        while(j+1<clean.length&&clean[j+1].t<t)j++;
        const a=clean[j],b=clean[j+1];
        if(!a || t<a.t-.001)continue;
        if(Math.abs(t-a.t)<.001){for(let k=0;k<3;k++)rgb[k][i]=a.v[k];qualityTrace[i]=a.q;jitterTrace[i]=a.jitter;continue;}
        // 600ms 이하 공백은 직선 보간하고 '보간' 표시(repaired)를 남긴다. 200ms에서 끊으면 몇 초마다 생기는 짧은 누락만으로
        // 10초 창이 거의 다 깨졌다(합성: 7초마다 0.45초 누락 → 유효 49초→9초). 보간이 25% 넘는 창은 Fusion 에서 그대로 버린다
        if(!b||b.t-a.t>600||b.t<=a.t)continue;
        const q=(t-a.t)/(b.t-a.t);qualityTrace[i]=a.q+(b.q-a.q)*q;jitterTrace[i]=a.jitter+(b.jitter-a.jitter)*q;
        for(let k=0;k<3;k++)rgb[k][i]=a.v[k]+(b.v[k]-a.v[k])*q;
        // 보간 표시는 주변 ±15프레임 간격의 국소 중앙값 기준: 기록 전체 중앙값(dt)만 쓰면 빨라진 구간 때문에
        // 18~20fps 구간 전체가 '보간'으로 잡혀 창이 모두 버려진다(2026-10-04 실측: 기준선 0초)
        // 150ms 이하 공백은 표시하지 않는다: 맥파(≤3Hz)는 그 정도 직선 보간으로 모양이 유지되는데, 국소 기준만 쓰면 30fps 중 1~2프레임씩
        // 자주 빠지는 기록(실효 ~21fps)에서 보간 비율이 25%를 넘어 창이 전부 'frame-gaps'로 버려졌다(합성: 30% 누락 → 커버리지 0%→93%, 오답 0)
        if(b.t-a.t>Math.max(localDt(j)*1.6,150))repaired[i]=1;
      }
      // Filtering is restarted at every long gap; no pulse is synthesized across absence.
      for(let a=0;a<length;){
        while(a<length&&!finite(rgb[0][a]))a++;
        let b=a;while(b<length&&finite(rgb[0][b]))b++;
        if(b-a>=fs*5){const colors=rgb.map(x=>x.subarray(a,b));bvp.set(bandpass(pos(...colors,fs),fs),a);chromWave.set(chrom(...colors,fs),a);greenWave.set(bandpass(colors[1],fs),a);}
        a=b+1;
      }
      return {bvp,repaired,chromWave,greenWave,quality:qualityTrace,jitter:jitterTrace};
    };
    const aggregate=channel(f=>[f.r,f.g,f.b],f=>f.skinQ??1);
    const regions=[0,1,2].map(k=>channel(f=>f.rr?.[k],f=>f.rq?.[k]??1));
    const candidates=[aggregate,...regions].flatMap((c,i)=>['pos','chrom','green'].map(method=>({roi:['aggregate','forehead','right-cheek','left-cheek'][i],method,wave:method==='pos'?c.bvp:method==='chrom'?c.chromWave:c.greenWave,repairs:c.repaired,quality:c.quality,jitter:c.jitter})));
    const usable=regions.filter(c=>c.bvp.some(finite));
    const observed=aggregate.bvp.reduce((n,v)=>n+(finite(v)?1:0),0);
    return {t0,fs,candidates,bvp:aggregate.bvp,chans:usable.map(c=>c.bvp),repaired:aggregate.repaired,
      channelRepairs:usable.map(c=>c.repaired),coverage:Signal.timeCoverage(ok,frames[0]?.t??t0,frames.at(-1)?.t??ok.at(-1).t),
      recoveredFraction:observed?aggregate.repaired.reduce((n,v,i)=>n+(finite(aggregate.bvp[i])?v:0),0)/observed:0};
  }

  /* 6–16초 관측 창을 1초 간격으로 평가한다. 색 신호 추정법·피부 영역의 일치와
   * 반복성을 함께 확인하며, 겹치는 창의 관측 시간은 Fusion.summarize에서 한 번만 센다. */
  function hrWindows(sig, winSec = 10, stepSec = 1, opt = {}) {
    return Fusion.windows(sig,winSec,stepSec,opt);
  }
  function phaseHr(wins,start,end) { return Fusion.summarize(wins,start,end); }
  /* 세션 심박 흐름: 기록 전체의 채택 창(usable)을 시간(가우스 σ 12초, ±25초)·창 신뢰도로 가중한 중앙값으로 잇는다.
   * 심박은 수십 초 사이에 크게 바뀌지 않으므로, 근처에 채택 창이 4개 이상 있으면 그 시각의 심박을 이 흐름으로 추론할 수 있다 */
  function sessionTrend(wins) {
    const W = (wins || []).filter(w => w.usable && finite(w.bpm) && finite(w.t));
    const at = t => {
      const near = W.map(w => ({ bpm: w.bpm, k: (w.confidence ?? 0.5) * Math.exp(-(((w.t - t) / 1000) ** 2) / 288) })).filter((p, i) => Math.abs(W[i].t - t) <= 25000).sort((a, b) => a.bpm - b.bpm);
      if (near.length < 4) return null;
      const tot = near.reduce((s, p) => s + p.k, 0); let acc = 0, m = near[0].bpm;
      for (const p of near) { acc += p.k; if (acc >= tot / 2) { m = p.bpm; break; } }
      return { bpm: m, n: near.length };
    };
    const phase = (a, b) => {
      if (!finite(a) || !finite(b) || b <= a) return null;
      const pts = []; for (let t = a; t <= b; t += 2000) { const v = at(t); if (v) pts.push(v); }
      return pts.length ? { bpm: median(pts.map(p => p.bpm)), n: Math.round(median(pts.map(p => p.n))) } : null;
    };
    return { at, phase, windows: W.length };
  }
  /* 튀는 구간·빠진 구간 보정: 구간 추정이 약하면(약한 신호·창 3개 미만·없음) 흐름과 8bpm 넘게 다를 때 흐름 값으로 바꾼다.
   * 충분히 측정된 구간은 흐름과 달라도 그대로 둔다(실제 반응일 수 있음). 원래 값(rawBpm)·근거를 남기고 신뢰도는 0.3 이하
   * (흐름은 이웃 구간 창도 섞어 만들므로, 이 값으로 구간 간 차이를 재면 차이가 0 쪽으로 줄어든다 — 차이 지표에서는 battery 가 한 번 더 낮춘다).
   * 근거(2026-10-05 실측 NLR-4950…): 측정 내내 85bpm 안팎인데 창 2·4개뿐인 중립 55·긍정 106 구간이 그대로 쓰였다 */
  function repairPhase(q, tr) {
    if (!q || !tr) return q;
    const weak = q.bpm === null || q.status === 'weak-signal' || q.status === 'unavailable' || (q.n || 0) < 3;
    const off = q.bpm === null ? Infinity : Math.abs(q.bpm - tr.bpm);
    if (!weak || off <= 8) return q;
    return { ...q, bpm: tr.bpm, rawBpm: q.bpm, status: 'inferred', quality: 'fair', confidence: round(Math.min(0.3, 0.3 * tr.n / 8), 2),
      correction: { kind: 'session-trend', rule: 'weak phase estimate >8 bpm from the ±25 s trend of accepted windows', raw: q.bpm === null ? null : round(q.bpm, 1), trend: round(tr.bpm, 1), support: tr.n } };
  }
  function measureEvidence(frames,start,end) {
    const selected=frames.filter(f=>f.t>=start&&f.t<=end),sig=buildBvp(selected);
    return phaseHr(hrWindows(sig,10,1,{start,end,jumps:lumJumps(selected),motion:motionBursts(selected)}),start,end);
  }

  /* ---------- 박동 검출 → 박동 간격(IBI) ---------- */
  function beats(sig, start, end, hrBpm) {
    if (!sig || !finite(hrBpm)) return [];
    const { bvp, fs, t0 } = sig;
    const i0 = Math.max(1, Math.floor((start - t0) * fs / 1000)), i1 = Math.min(bvp.length - 2, Math.ceil((end - t0) * fs / 1000));
    const minGap = 0.6 * 60 / hrBpm * fs;
    const seg = Array.from(bvp.subarray(i0, i1 + 1)).filter(finite);
    // A rescued chrominance HR does not turn numerical noise in the POS waveform into beats.
    if(seg.length<fs*4 || std(seg)<1e-9)return [];
    const thr = quantile(seg, 0.5);
    const out = [];
    let last = -Infinity;
    for (let i = i0; i <= i1; i++) {
      const lo=Math.max(0,i-Math.ceil(fs*.75)), hi=Math.min(bvp.length,i+Math.ceil(fs*.75));
      // 정점 위치 계산(포물선 보간)에 쓰는 i-1..i+1 이 실제 관측 표본이면 박동 시각은 정확하다. 주변 1.5초 전체에
      // 보간 표본이 하나도 없기를 요구하면, 30fps에서 한 프레임씩 빠지는 흔한 기록에서 박동의 80%가 버려졌다(2026-10-04 실측)
      if(!bvp.subarray(lo,hi).every(finite) || sig.repaired?.subarray(i-1,i+2).some(Boolean) || (sig.repaired && sig.repaired.subarray(lo,hi).reduce((a,b)=>a+b,0)>(hi-lo)*.25))continue;
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
    let inB = 0, tot = 0, pk = -1, pf = null;
    for (let i = 0; i < p.length; i++) {
      const f = i * df;
      if (f < 0.04 || f > 0.4) continue;
      tot += p[i];
      if (Math.abs(f - targetHz) <= 0.025) inB += p[i];
      if (p[i] > pk) { pk = p[i]; pf = f; }
    }
    return { ampBpm: round(amp, 1), ratio: tot > 0 ? round(inB / tot, 2) : null, peakHz: round(pf, 3) };
  }

  /* ---------- 호흡수 추정 (공명 호흡 순응 확인) ----------
   * 카메라만으로 호흡을 보는 두 경로: ① 호흡에 따른 머리·얼굴의 미세한 상하 움직임(얼굴 중심 cy),
   * ② 피부 밝기의 저주파 변동(호흡성 강도 변조). 4Hz 로 맞춘 뒤 0.05~0.6Hz 대역의 스펙트럼 피크와
   * 피크 집중도(피크 ±0.02Hz 파워 / 대역 전체)를 구해, 집중도가 더 높은 경로를 쓴다.
   * 집중도가 0.4 미만이면 ‘뚜렷한 호흡 리듬 없음’으로 보고 판정하지 않는다 */
  function respiration(frames, start, end) {
    const s = (frames || []).filter(f => f.ok && f.t >= start && f.t <= end && finite(f.cy));
    if (s.length < 150 || end - start < 25000) return null;
    const fs = 4, out = [];
    const series = [['motion', s.map(f => f.cy)], ['intensity', s.map(f => (finite(f.g) ? f.g / Math.max(1, f.r + f.g + f.b) : NaN))]];
    for (const [src, col] of series) {
      if (!col.every(finite)) continue;
      const rs = resample(s.map(f => f.t), [col], fs), x = Array.from(rs.data[0]);
      if (x.length < fs * 20) continue;
      const band = bandpass(Float64Array.from(x), fs, 0.05, 0.6);
      const nfft = Math.max(1024, nextPow2(band.length * 4)), p = powerSpectrum(band, nfft), df = fs / nfft;
      let pk = 0, pi = -1, tot = 0;
      for (let i = 0; i < p.length; i++) { const f = i * df; if (f < 0.05 || f > 0.6) continue; tot += p[i]; if (p[i] > pk) { pk = p[i]; pi = i; } }
      if (pi < 0 || !(tot > 0)) continue;
      let near = 0;
      for (let i = 0; i < p.length; i++) if (Math.abs(i - pi) * df <= 0.02) near += p[i];
      out.push({ src, hz: round(pi * df, 3), bpm: round(pi * df * 60, 1), conc: round(near / tot, 2) });
    }
    if (!out.length) return null;
    const best = out.sort((a, b) => b.conc - a.conc)[0];
    return { ...best, clear: best.conc >= 0.4 };
  }
  /* 호흡 파형 (그래프용): 얼굴 중심 세로 위치(cy)를 4Hz로 다시 표본화해 0.05~0.6Hz 대역만 남긴다.
   * 1초 넘게 끊긴 곳은 이어 붙이지 않고 나눠서(segment) 돌려준다 — 끊긴 곳을 그럴듯하게 채우지 않는다 */
  function breathWave(frames, start, end) {
    const s = (frames || []).filter(f => (f.faceOk ?? f.ok) && f.t >= start && f.t <= end && finite(f.cy)).sort((a, b) => a.t - b.t);
    if (s.length < 40 || end - start < 15000) return null;
    const fs = 4, segs = [];
    let cur = [s[0]];
    for (let i = 1; i < s.length; i++) { if (s[i].t - s[i - 1].t > 1000) { segs.push(cur); cur = []; } cur.push(s[i]); }
    segs.push(cur);
    const out = [];
    segs.filter(g => g.length >= 20 && g[g.length - 1].t - g[0].t >= 8000).forEach(g => {
      const rs = resample(g.map(f => f.t), [g.map(f => f.cy)], fs), x = Float64Array.from(rs.data[0]);
      const y = bandpass(x, fs, 0.05, 0.6), sd = std(Array.from(y)) || 1;
      out.push({ t0: rs.t0, fs, y: Array.from(y, v => round(v / sd, 2)) });
    });
    return out.length ? out : null;
  }
  /* 조명 급변: 2초 창 평균 피부 밝기가 직전 창보다 12% 넘게 바뀐 시각 (rPPG 창을 이 근처에서 제외) */
  /* 머리 움직임 구간: 0.25초 간격으로 앞뒤 0.25초 얼굴 위치(±80ms 중앙값)의 이동량(얼굴 폭 대비, %/초)이 10%/초를 넘는 시점 ±0.5초.
   * 움직임은 피부색을 크게 흔들어 맥박보다 센 가짜 주기를 만든다(합성: 1.5초 흔들림이 9초마다 → 심박 오차 32bpm) */
  function motionBursts(frames, thr = 10) {
    const s = (frames || []).filter(f => (f.faceOk ?? f.ok) && finite(f.cx) && finite(f.cy) && f.fw > 0);
    const out = [];
    if (s.length < 60) return out;
    /* 심박 단계는 얼굴 추론이 10~15Hz 라 ±130ms 안의 얼굴 위치를 쓴다 */
    const at = t => { const w = s.filter(f => Math.abs(f.t - t) <= 130); return w.length ? { x: median(w.map(f => f.cx)), y: median(w.map(f => f.cy)), w: median(w.map(f => f.fw)) } : null; };
    for (let t = s[0].t + 250; t <= s.at(-1).t - 250; t += 250) {
      const a = at(t - 250), b = at(t + 250);
      if (!a || !b) continue;
      if (Math.hypot(b.x - a.x, b.y - a.y) / ((a.w + b.w) / 2) / 0.5 * 100 > thr) {
        const last = out.at(-1);
        if (last && t - 500 <= last[1]) last[1] = t + 500; else out.push([t - 500, t + 500]);
      }
    }
    return out;
  }
  function lumJumps(frames) {
    const s = (frames || []).filter(f => f.ok && finite(f.lum));
    const out = [];
    if (s.length < 120) return out;
    let i = 0, prev = null;
    while (i < s.length) {
      const t0 = s[i].t; let j = i, sum = 0;
      while (j < s.length && s[j].t < t0 + 2000) { sum += s[j].lum; j++; }
      const m = sum / Math.max(1, j - i);
      if (prev !== null && Math.abs(m - prev) / Math.max(1, prev) > 0.12) out.push(t0);
      prev = m; i = j;
    }
    return out;
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
    let icx = 0, icy = 0;                                     // 홍채 중심: 중심점 + 테두리 4점 평균 (단일 점보다 떨림이 작다)
    for (let k = 0; k < 5; k++) { icx += lm[iris + k].x; icy += lm[iris + k].y; }
    icx /= 5; icy /= 5;
    const ix = icx - ax, iy = icy - ay;
    const u = (ix * dx + iy * dy) / L2;                       // 눈꼬리→눈머리 축 위치 (0~1)
    /* 세로 기준은 눈꺼풀 중점이 아니라 눈꼬리-눈머리 축: 아래를 보면 윗눈꺼풀이 홍채를 따라 내려와(눈꺼풀-시선 연동) 눈꺼풀 중점 기준 v 는
     * 거의 변하지 않아 세로 신호가 절반 이하로 눌렸다. 눈꼬리는 시선과 무관하게 고정이라 기준으로 삼는다.
     * 실측 재생(2026-10-07, 13세션): 정밀 보정 held-out 10.8→9.5%, 원형 추적 과제 세로 오차 13.3→8.9%H, 영점 뒤 오차 9.3→6.9%W (tools/gaze_replay.cjs) */
    const midX = (ax + bx) / 2, midY = (ay + by) / 2;
    const v = (-(icx-midX)*dy + (icy-midY)*dx) / L2; // Eye-local perpendicular axis compensates head roll.
    const open = Math.hypot(lm[bot].x - lm[top].x, lm[bot].y - lm[top].y) / L;
    return { u, v, open };
  }
  function faceFeatures(lm) {
    if (!lm || lm.length < 478 || lm.some(p=>!p || !finite(p.x) || !finite(p.y))) return null;
    const imgLeftFirst = (a, b) => lm[a].x <= lm[b].x ? [a, b] : [b, a];
    const [ra, rb] = imgLeftFirst(LM.rOuter, LM.rInner);
    const [la, lb] = imgLeftFirst(LM.lInner, LM.lOuter);
    const R = eyeUV(lm, ra, rb, LM.rTop, LM.rBot, LM.rIris);
    const Lf = eyeUV(lm, la, lb, LM.lTop, LM.lBot, LM.lIris);
    const validEye = e => [e.u,e.v,e.open].every(finite) && e.u>-.25 && e.u<1.25 && Math.abs(e.v)<.5;
    const usable = [R,Lf].filter(validEye);
    if(!usable.length)return null;
    const fl = lm[LM.faceL], fr = lm[LM.faceR], tp = lm[LM.top], ch = lm[LM.chin], ns = lm[LM.nose];
    const fw = Math.hypot(fr.x - fl.x, fr.y - fl.y);
    const fh = Math.hypot(ch.x - tp.x, ch.y - tp.y);
    return {
      u: mean(usable.map(e=>e.u)), v: mean(usable.map(e=>e.v)),
      yaw: (ns.x - fl.x) / (fr.x - fl.x) - 0.5,
      pitch: (ns.y - tp.y) / (ch.y - tp.y) - 0.5,
      cx: (fl.x + fr.x) / 2, cy: (tp.y + ch.y) / 2, fw, fh,
      open: mean(usable.map(e=>e.open)),
      eyes: {left:{...Lf,q:validEye(Lf)?clamp((Lf.open-.025)/.12,0,1):0},right:{...R,q:validEye(R)?clamp((R.open-.025)/.12,0,1):0}},
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
  /* samples: [{f, x, y, w?}] (x,y = 화면 px, w = 표본 가중치) → 표준화 + 릿지 회귀 모델.
   * 홍채 위치(u,v)의 제곱항을 더해 화면 가장자리에서 시선이 덜 따라가는 비선형을 보정한다 */
  /* 눈꺼풀 열림(open)은 위를 보면 커지고 아래를 보면 작아져 웹캠에서 약한 세로 시선 추정을 보강한다.
   * 보정 표본 모두에 값이 있을 때만 특징으로 쓰고(model.keys), 예측 때 없으면 평균값(z=0)으로 둔다 */
  /* 머리 자세 특징의 표준편차 하한: 보정 중 머리가 거의 안 움직이면 σ가 0.002 수준으로 작게 잡혀,
   * 이후 자세가 조금만 바뀌어도 수 σ로 외삽돼 시선이 화면 밖으로 튄다(2026-10-04 실측: 세로 +3,000px).
   * 하한(HEAD_SD_MIN)·머리 특징 강한 수축(HEAD_RIDGE, fitGaze)·예측 z ±4 제한으로 외삽을 묶는다 */
  const HEAD_SD_MIN = { yaw: 0.01, pitch: 0.01, cx: 0.01, cy: 0.01 }, Z_MAX = 4, HEAD_RIDGE = 100;
  /* 제곱항 접선 연장(zr): 홍채 위치(u,v)가 보정 때 본 범위를 벗어나면 제곱항이 위치의 제곱으로 커져 시선이 화면 밖에서 가속하듯 튄다.
   * 범위 안은 그대로, 범위 밖은 경계에서의 접선(1차)으로 이어 붙여 같은 눈 움직임에 같은 만큼만 움직이게 한다 */
  const gazeVec = (f, mu, sd, quad, keys = GAZE_KEYS, zr = null) => {
    const z = keys.map(k => (finite(f[k]) ? clamp((f[k] - mu[k]) / Math.max(sd[k], HEAD_SD_MIN[k] || 0), -Z_MAX, Z_MAX) : 0));
    if (!quad) return [1, ...z];
    if (!zr) return [1, ...z, z[0] * z[0], z[1] * z[1], z[0] * z[1]];
    const c0 = clamp(z[0], zr.lo[0], zr.hi[0]), c1 = clamp(z[1], zr.lo[1], zr.hi[1]), e0 = z[0] - c0, e1 = z[1] - c1;
    return [1, ...z, c0 * c0 + 2 * c0 * e0, c1 * c1 + 2 * c1 * e1, c0 * c1 + c1 * e0 + c0 * e1];
  };
  function fitGaze(samples, lambda = 0.5, opt = {}) {
    const S = samples.filter(s => s.f && GAZE_KEYS.every(k => finite(s.f[k])));
    if (S.length < 20) return null;
    const quad = opt.quad !== false && S.length >= 120;
    /* opt.extra: 추가 특징(예: lookV — MediaPipe 세로 시선 점수). 모든 표본에 값이 있을 때만 쓴다 */
    const keys = [...(opt.open !== false && S.every(s => finite(s.f.open)) ? [...GAZE_KEYS, 'open'] : GAZE_KEYS), ...(opt.extra || []).filter(k => S.every(s => finite(s.f[k])))];
    const mu = {}, sd = {};
    keys.forEach(k => { mu[k] = mean(S.map(s => s.f[k])); sd[k] = std(S.map(s => s.f[k])) || 1; });
    const X = S.map(s => gazeVec(s.f, mu, sd, quad, keys)), d = X[0].length, W = S.map(s => (finite(s.w) ? s.w : 1));
    const zr = quad ? { lo: [0, 1].map(j => Math.min(...X.map(r => r[1 + j]))), hi: [0, 1].map(j => Math.max(...X.map(r => r[1 + j]))) } : null;
    const wsum = W.reduce((a, b) => a + b, 0);
    const fit = key => {
      const XtX = Array.from({ length: d }, () => new Array(d).fill(0)), Xty = new Array(d).fill(0);
      X.forEach((row, i) => {
        const w = W[i];
        for (let a = 0; a < d; a++) { Xty[a] += w * row[a] * S[i][key]; for (let b = 0; b < d; b++) XtX[a][b] += w * row[a] * row[b]; }
      });
      // 제곱항은 더 강하게 수축. 머리 자세(yaw·pitch·cx·cy)는 보정 중 시선을 따라 함께 움직인 상관을 배우지 않도록 100배 수축
      // (2026-10-04 실측 재현: 보정 밖 검증점 오차 21% → 16%, 과제 중 세로 좌표가 화면 밖 +2,000px → 화면 안)
      /* opt.keyRidge: 특징별 수축 배율(기본 없음 = 기존과 동일). 실측 벤치(tools/colab/engine_bench.cjs)에서만 비교한다 */
      for (let a = 1; a < d; a++) XtX[a][a] += lambda * wsum / 50 * (a > keys.length ? 4 * (opt.quadRidge ?? 1) : HEAD_SD_MIN[keys[a - 1]] ? HEAD_RIDGE : 1) * (a <= keys.length && opt.keyRidge && finite(opt.keyRidge[keys[a - 1]]) ? opt.keyRidge[keys[a - 1]] : 1);
      return solve(XtX, Xty);
    };
    const wx = fit('x'), wy = fit('y');
    if(!wx || !wy)return null;
    const model={mu,sd,wx,wy,quad,keys,zr};
    if(!opt.singleEye){
      model.eyes={};
      for(const side of ['left','right']){
        const rows=S.filter(s=>s.f.eyes?.[side]?.q>.035).map(s=>({...s,f:{...s.f,u:s.f.eyes[side].u,v:s.f.eyes[side].v},w:(s.w??1)*s.f.eyes[side].q}));
        // A one-eye model needs spatially distributed calibration, not just many centre samples.
        if(rows.length>=20 && std(rows.map(s=>s.x))>std(S.map(s=>s.x))*.5 && std(rows.map(s=>s.y))>std(S.map(s=>s.y))*.5)
          model.eyes[side]=fitGaze(rows,lambda,{...opt,singleEye:true});
      }
    }
    if(model.eyes && !Object.values(model.eyes).some(Boolean))delete model.eyes;
    return model;
  }
  /* 시선 예측: 두 눈이 모두 또렷하면 두 눈 평균 특징으로 학습한 기본(양안) 모델을 쓴다.
   * 프레임마다 눈별 품질 가중을 바꾸면 두 눈 모델의 미세한 치우침 차이 때문에 좌표가 들썩이므로,
   * 한쪽 눈이 감기거나 반사로 흐려졌을 때만 검증을 통과한 나머지 한쪽 눈 모델로 넘어간다 */
  const EYE_OK = 0.15;
  function predictGaze(model, f) {
    if (!model || !f) return null;
    if (f.eyes) {
      const okL = f.eyes.left && f.eyes.left.q >= EYE_OK, okR = f.eyes.right && f.eyes.right.q >= EYE_OK;
      if (!okL && !okR) return null;                                   // 두 눈 모두 불안정(깜빡임·반사) → 이 프레임은 쓰지 않는다
      /* 눈별 신뢰도 결합: 보정 검증에서 오차가 작은 눈에 더 큰 고정 가중(1/오차²)을 준다. 가중은 측정 내내 바뀌지 않아 좌표가 들썩이지 않는다 */
      const cw = model.combine;
      if (cw && okL && okR && model.eyes && model.eyes.left && model.eyes.right) {
        const pl = predictGaze(model.eyes.left, { ...f, eyes: null, u: f.eyes.left.u, v: f.eyes.left.v }), pr = predictGaze(model.eyes.right, { ...f, eyes: null, u: f.eyes.right.u, v: f.eyes.right.v });
        if (pl && pr) return { x: cw.left * pl.x + cw.right * pr.x, y: cw.left * pl.y + cw.right * pr.y, mode: 'weighted' };
      }
      if (!(okL && okR)) {
        const side = okL ? 'left' : 'right', e = f.eyes[side], m = model.eyes && model.eyes[side];
        if (m && !['poor', 'none'].includes(m.validation && m.validation.grade)) return { ...predictGaze(m, { ...f, eyes: null, u: e.u, v: e.v }), mode: side };
        if (m) return null;                                              // 검증에 실패한 한쪽 눈 모델로는 시선을 만들지 않는다
        f = { ...f, eyes: null, u: e.u, v: e.v };                      // 한쪽 눈 모델이 없으면 그 눈 특징으로 양안 모델 사용
      }
    }
    const v = gazeVec(f, model.mu, model.sd, model.quad, model.keys || GAZE_KEYS, model.zr);
    const dot = w => w.reduce((s, x, i) => s + x * v[i], 0);
    return { x: dot(model.wx), y: dot(model.wy) };
  }
  /* 영점 조정: 표적(x,y) ↔ 예측(gx,gy) 쌍으로 축별 1차 보정 x' = a·x + b 를 맞춘다.
   * 표적이 한 축에서 퍼져 있지 않으면 이동(b)만 쓰고, 기울기는 0.75~1.35 로 제한해 과보정을 막는다 */
  function fitAffine(pairs, opt = {}) {
    const P = (pairs || []).filter(p => finite(p.x) && finite(p.y) && finite(p.gx) && finite(p.gy));
    if (P.length < 3) return null;
    const lo = opt.minSlope ?? 0.75, hiX = opt.maxSlopeX ?? opt.maxSlope ?? 1.35, hiY = opt.maxSlopeY ?? opt.maxSlope ?? 1.35;
    /* 기울기 0.75~1.35 로 제한해 과보정을 막는다. 세로 압축은 눈꼬리 기준 v(eyeUV)로 원천에서 풀었으므로 넓은 상한(2.2)은 쓰지 않는다
     * (실측 재생 13세션: 넓은 상한과 결과 동일) */
    const axis = (t, g, hi) => {
      const mt = mean(t), mg = mean(g);
      let cov = 0, vg = 0, vt = 0;
      for (let i = 0; i < t.length; i++) { cov += (g[i] - mg) * (t[i] - mt); vg += (g[i] - mg) ** 2; vt += (t[i] - mt) ** 2; }
      const r = vt > 0 && vg > 0 ? cov / Math.sqrt(vt * vg) : 0;
      const a = vt > 0 && vg > 0 ? clamp(cov / vg, lo, hi) : 1;
      return { a, b: mt - a * mg, r: round(r, 2) };
    };
    return { x: axis(P.map(p => p.x), P.map(p => p.gx), hiX), y: axis(P.map(p => p.y), P.map(p => p.gy), hiY) };
  }
  const applyAffine = (A, g) => (A && g ? { x: A.x.a * g.x + A.x.b, y: A.y.a * g.y + A.y.b } : g);
  /* 화면 밖 완만한 압축: 화면 안(0~W, 0~H)은 그대로, 밖으로 나간 거리 e 는 M·tanh(e/M)(M = 화면의 35%)로 줄인다.
   * 화면 밖 웹캠 시선은 정확도가 낮고 작은 특징 변화에도 크게 움직여, 그대로 두면 속도·가속이 비현실적으로 커진다.
   * 가장자리에서 기울기 1로 이어져 화면 안쪽 판정은 바뀌지 않는다. 연구용 원출력(px·py)은 압축하지 않는다 */
  function softBound(g, W, H, k = 0.35) {
    if (!g || !finite(g.x) || !finite(g.y)) return g;
    const sb = (v, L) => { const M = k * L; return v < 0 ? -M * Math.tanh(-v / M) : v > L ? L + M * Math.tanh((v - L) / M) : v; };
    return { ...g, x: sb(g.x, W), y: sb(g.y, H) };
  }

  /* One Euro 필터 (Casiez, Roussel & Vogel, 2012): 시선이 머물 때는 강하게, 빠르게 움직일 때는 약하게 평활해
   * 떨림과 지연을 함께 줄인다. 화면 표시용 시선 커서에 쓴다 */
  function oneEuro(opt = {}) {
    const minCut = opt.minCutoff ?? 0.9, beta = opt.beta ?? 0.006, dCut = opt.dCutoff ?? 1;
    let xPrev = null, dxPrev = 0, tPrev = null;
    const alpha = (cut, dt) => { const r = 2 * Math.PI * cut * dt; return r / (r + 1); };
    const f = (x, tMs) => {
      if (xPrev === null || !finite(tPrev)) { xPrev = x; tPrev = tMs; return x; }
      const dt = Math.max(0.001, (tMs - tPrev) / 1000);
      tPrev = tMs;
      const dx = (x - xPrev) / dt, ad = alpha(dCut, dt);
      dxPrev = ad * dx + (1 - ad) * dxPrev;
      const a = alpha(minCut + beta * Math.abs(dxPrev), dt);
      xPrev = a * x + (1 - a) * xPrev;
      return xPrev;
    };
    f.reset = x => { xPrev = x; dxPrev = 0; };   // 새 응시로 옮길 때 지연 없이 그 위치에서 다시 시작
    return f;
  }

  /* 시선 커서 (보조 포함): 원시 시선 → ① 학습된 치우침 보정 → ② 강한 One Euro 평활 → ③ 최대 속도 제한
   * → ④ 표적 근처 자석 보조. 실제 시선이 표적에서 조금 어긋나 있어도 커서를 표적 쪽으로 안정적으로 모아 준다.
   *  - 치우침 학습: 커서가 표적 근처(보조 반경 안)에 느리게 머무는 동안에만, 표적 − 보정 시선 차이를 천천히(프레임당 3%) 누적
   *    (보정 학습에는 쓰지 않고 커서 표시와 사후 평가에만 쓴다 — 커서를 보며 사용자가 시선을 '보상'할 수 있으므로)
   *  - 자석: 표적까지 거리 d 가 보조 반경 Ra 안이면 커서를 표적 + (시선 − 표적) × (0.35 + 0.65·d/Ra) 로 당긴다
   *  - 속도 제한: 화면 폭의 0.9배/초 — 사카드로 커서가 순간 이동해 보이는 것을 막는다 */
  function gazeCursor(opt = {}) {
    const W = opt.W || 1440, H = opt.H || 900, Ra = opt.assist || W * 0.14, vmax = (opt.vmax || 0.9) * W;
    const fx = oneEuro({ minCutoff: opt.minCutoff ?? 0.35, beta: opt.beta ?? 0.0015 }), fy = oneEuro({ minCutoff: opt.minCutoff ?? 0.35, beta: opt.beta ?? 0.0015 });
    const bias = { x: 0, y: 0, n: 0 }, maxB = { x: W * 0.08, y: H * 0.08 };
    let pos = null, last = null, lastT = null;
    /* 응시 고정(opt.lock, 기본 켬): 시선이 반경 R 안에 머무는 동안은 그 응시의 누적 평균(최대 30표본 ≈ 1초)을 보여 준다 —
     * 웹캠 시선의 프레임별 떨림은 평균으로 √n 만큼 줄고, 한 프레임짜리 튐은 무시된다. 반경 밖 표본이 2개 연속이면 새 응시로 바로 옮긴다.
     * R = 응시 중 평균 이탈 거리 × 2.5 (화면 폭 2.5~8%) — 사람·조명마다 다른 잡음에 맞춘다. 화면 표시 전용(분석 자료는 그대로) */
    const lock = opt.lock !== false;
    let fix = null, outside = [];
    return {
      bias,
      step(raw, t, target) {
        const cx = raw.x + bias.x, cy = raw.y + bias.y;
        let x = fx(cx, t), y = fy(cy, t);
        const dt = lastT === null ? 0.033 : Math.max(0.001, (t - lastT) / 1000);
        const speed = last ? Math.hypot(x - last.x, y - last.y) / dt : 0;
        if (last) { const d = Math.hypot(x - last.x, y - last.y), lim = vmax * dt; if (d > lim) { x = last.x + (x - last.x) * lim / d; y = last.y + (y - last.y) * lim / d; } }
        last = { x, y }; lastT = t;
        let out = { x, y }, near = false;
        if (lock) {
          const R = clamp(2.5 * (fix ? fix.dev : W * 0.015), W * 0.025, W * 0.08);
          const d = fix ? Math.hypot(cx - fix.x, cy - fix.y) : Infinity;
          if (fix && d <= R) {
            outside = []; fix.n = Math.min(30, fix.n + 1);
            fix.x += (cx - fix.x) / fix.n; fix.y += (cy - fix.y) / fix.n; fix.dev += 0.1 * (d - fix.dev);
          } else {
            outside.push({ x: cx, y: cy });
            if (!fix || outside.length >= 2) {
              const mx = mean(outside.map(q => q.x)), my = mean(outside.map(q => q.y));
              fix = { x: mx, y: my, n: outside.length, dev: fix ? fix.dev : W * 0.015 }; outside = [];
              fx.reset?.(mx); fy.reset?.(my); last = { x: mx, y: my };
            }
          }
          if (fix && !outside.length) out = { x: fix.x, y: fix.y };
        }
        if (target) {
          const d = Math.hypot(x - target.x, y - target.y);
          if (d < Ra) {
            near = true;
            const k = 0.35 + 0.65 * d / Ra;
            out = { x: target.x + (x - target.x) * k, y: target.y + (y - target.y) * k };
            if (speed < W * 0.25) {                                 // 머무는 중에만 치우침 학습
              bias.x = clamp(bias.x + 0.03 * (target.x - x), -maxB.x, maxB.x);
              bias.y = clamp(bias.y + 0.03 * (target.y - y), -maxB.y, maxB.y);
              bias.n++;
            }
          }
        }
        pos = out;
        return { ...out, near, speed };
      },
      get pos() { return pos; },
    };
  }

  /* 시선 좌표 안정화 (화면 표시·커서·과제 판정용)
   * ① 화면 밖으로 크게 벗어난 값은 가장자리로 제한 ② 화면 폭의 22% 넘게 한 번에 뛰는 값은 다음 표본들이 같은 곳을 가리킬 때만
   * 진짜 시선 이동으로 받아들이고(그 전에는 직전 위치 유지) ③ 최근 5표본(200ms 이내) 중앙값으로 한 프레임짜리 튐을 지운다.
   * 400ms 넘게 표본이 끊기면(깜빡임·얼굴 이탈) 새로 시작한다 */
  function gazeStabilizer(opt = {}) {
    const W = opt.W || 1440, H = opt.H || 900, JUMP = opt.jump ?? 0.22, CONF = opt.confirm ?? 0.07, N = opt.n ?? 5, SPAN = opt.span ?? 200;
    let win = [], pend = [], stable = null;
    const dist = (a, b) => Math.hypot((a.x - b.x) / W, (a.y - b.y) / W);
    return {
      push(g, t) {
        if (!g || !finite(g.x) || !finite(g.y) || !finite(t)) return null;
        const p = { x: clamp(g.x, -0.1 * W, 1.1 * W), y: clamp(g.y, -0.1 * H, 1.1 * H), t };
        if (stable && t - stable.t > 400) { win = []; pend = []; stable = null; }
        if (stable && dist(p, stable) > JUMP) {
          pend = pend.filter(q => t - q.t <= SPAN); pend.push(p);
          const ok = pend.length >= 2 && pend.every(q => dist(q, p) <= CONF);
          if (!ok) return { x: stable.x, y: stable.y, t, held: true };
          /* confirmed: 보류했다가 진짜 이동으로 확인된 앞 표본 시각 — 기록 측이 분석 제외(bl)를 되돌린다.
           * 되돌리지 않으면 사카드 착지 첫 표본이 빠져 잠복기가 1프레임 쪽으로 늦게 보간된다(합성 +28~47ms) */
          const confirmed = pend.slice(0, -1).map(q => q.t);
          win = pend.slice(); pend = [];
          win = win.filter(q => t - q.t <= SPAN).slice(-N);
          stable = { x: median(win.map(q => q.x)), y: median(win.map(q => q.y)), t };
          return { ...stable, held: false, confirmed };
        } else { pend = []; win.push(p); }
        win = win.filter(q => t - q.t <= SPAN).slice(-N);
        stable = { x: median(win.map(q => q.x)), y: median(win.map(q => q.y)), t };
        return { ...stable, held: false };
      },
      reset() { win = []; pend = []; stable = null; },
      get stable() { return stable; },
    };
  }
  /* 보정 표본 정리: 한 표적을 보는 동안 모은 눈 특징 중 중앙값에서 크게 벗어난 프레임(반쯤 감김·반사·순간 오검출)을 뺀다 */
  function robustFeatures(fs) {
    if (!fs || fs.length < 6) return fs || [];
    const mu = median(fs.map(f => f.u)), mv = median(fs.map(f => f.v));
    const su = Math.max(0.006, 1.4826 * median(fs.map(f => Math.abs(f.u - mu)))), sv = Math.max(0.006, 1.4826 * median(fs.map(f => Math.abs(f.v - mv))));
    const kept = fs.filter(f => Math.abs(f.u - mu) <= 3 * su && Math.abs(f.v - mv) <= 3 * sv);
    return kept.length >= Math.max(4, fs.length * 0.4) ? kept : fs;
  }
  /* 잔차 보정: 축별 보정 뒤에도 화면 위치마다 남는 오차(예: 위쪽은 아래로, 오른쪽 아래는 왼쪽으로 쏠림)를
   * 쌍선형 면 dx = a + b·x + c·y + d·x·y 로 맞춘다 (표본은 화면 폭·높이로 정규화, 능선 회귀로 과적합 억제, 보정량 상한 화면의 12%) */
  function fitResidual(pairs, W, H, lambda = 0.15) {
    const P = (pairs || []).filter(p => [p.x, p.y, p.gx, p.gy].every(finite));
    if (P.length < 6) return null;
    const row = p => { const x = p.gx / W - 0.5, y = p.gy / H - 0.5; return [1, x, y, x * y]; };
    const fitAxis = (key, scale) => {
      const A = Array.from({ length: 4 }, () => new Array(4).fill(0)), b = new Array(4).fill(0);
      P.forEach(p => { const v = row(p), e = (key === 'x' ? p.x - p.gx : p.y - p.gy) / scale; for (let i = 0; i < 4; i++) { b[i] += v[i] * e; for (let j = 0; j < 4; j++) A[i][j] += v[i] * v[j]; } });
      for (let i = 1; i < 4; i++) A[i][i] += lambda * P.length / 10;
      return solve(A, b);
    };
    const cx = fitAxis('x', W), cy = fitAxis('y', H);
    return cx && cy ? { W, H, cx, cy, n: P.length } : null;
  }
  function applyResidual(R, g) {
    if (!R || !g) return g;
    const x = g.x / R.W - 0.5, y = g.y / R.H - 0.5, v = [1, x, y, x * y];
    const dx = clamp(v.reduce((s, a, i) => s + a * R.cx[i], 0), -0.12, 0.12) * R.W, dy = clamp(v.reduce((s, a, i) => s + a * R.cy[i], 0), -0.12, 0.12) * R.H;
    return { ...g, x: g.x + dx, y: g.y + dy };
  }
  /* 축별 1차 보정 두 개를 겹친다: 먼저 A, 그다음 B */
  const composeAffine = (A, Bm) => (!A ? Bm : !Bm ? A : { x: { a: Bm.x.a * A.x.a, b: Bm.x.a * A.x.b + Bm.x.b }, y: { a: Bm.y.a * A.y.a, b: Bm.y.a * A.y.b + Bm.y.b } });

  /* 그림자 비교(측정에 쓰지 않음): 같은 학습 표본으로 기본 특징 모델과 추가 특징(extra) 모델을 각각 맞추고(+ 축별 보정),
   * 학습에 쓰지 않은 평가 점(evalPts)에서 오차를 비교한다. 세로 오차(hy, 화면 높이 대비)와 세로 구분력(ry)을 따로 낸다.
   * train: [{x,y,f}] · fitPts/evalPts: [{x,y,fs:[f…]}] (점마다 특징 목록 — 중앙값 예측) */
  function compareGazeFeatures({ train, fitPts, evalPts, W, H, extra }) {
    const at = (m, A, p) => { const g = p.fs.map(f => applyAffine(A, predictGaze(m, f))).filter(q => q && finite(q.x) && finite(q.y)); return g.length >= 4 ? { x: p.x, y: p.y, gx: median(g.map(q => q.x)), gy: median(g.map(q => q.y)) } : null; };
    const one = keys => {
      const m = fitGaze(train, 0.5, { extra: keys });
      if (!m || keys.some(k => !m.keys.includes(k))) return null;
      const A = fitAffine(fitPts.map(p => at(m, null, p)).filter(Boolean));
      const pr = evalPts.map(p => at(m, A, p)).filter(Boolean);
      if (pr.length < 4) return null;
      const a = gazeAccuracy(pr, W, H), ys = pr.map(p => p.y), gys = pr.map(p => p.gy);
      const mt = mean(ys), mg = mean(gys); let c = 0, vt = 0, vg = 0; ys.forEach((y, i) => { c += (y - mt) * (gys[i] - mg); vt += (y - mt) ** 2; vg += (gys[i] - mg) ** 2; });
      return { errPct: a.errPct, hx: a.hx, hy: round(median(pr.map(p => Math.abs(p.gy - p.y))) / H * 100, 1), ry: vt > 0 && vg > 0 ? round(c / Math.sqrt(vt * vg), 2) : null, points: pr.length };
    };
    const cover = train.length ? round(train.filter(s => s.f && extra.every(k => finite(s.f[k]))).length / train.length, 2) : 0;
    return { extra, cover, base: one([]), withExtra: cover >= 0.8 ? one(extra) : null, note: 'shadow comparison only; measurement model unchanged' };
  }
  /* 보정 후보 선택(정밀 보정 점 오차가 작은 순). 추가 특징(extra) 후보는 기존 후보 중 최선보다 0.5%p 이상이면서 10% 이상
   * 좋을 때만 고른다 — 후보가 늘면 8개 평가 점에서 우연히 좋아 보이는 쪽이 뽑히기 쉬워 여유를 둔다.
   * 근거(2026-10-05 그림자 비교 4세션): lookV 는 세로 구분력 r 을 4회 모두 올렸지만 오차는 1회 −30%, 3회 +13~36% */
  function pickCalibration(cands, margin = { abs: 0.5, rel: 0.1 }) {
    const ok = cands.filter(c => c.acc && c.acc.errPct !== null).sort((a, b) => a.acc.errPct - b.acc.errPct);
    const base = ok.find(c => !c.extra), best = ok[0];
    if (!best || !best.extra || !base) return best || null;
    const need = base.acc.errPct - Math.max(margin.abs, margin.rel * base.acc.errPct);
    return best.acc.errPct <= need ? best : base;
  }
  /* 검증점 오차 → 화면 폭 대비 비율과 등급 */
  /* 오차 = 점별 거리(가로·세로 같은 무게)의 평균 ÷ 화면 폭. 이전 식(세로 ×0.6, 중앙값)은 가로가 정확하면 세로가 크게 빗나가도
   * 작게 나와(실측 NLR-541B…: 아래쪽 점이 200px 넘게 빗나갔는데 2.8% '양호') 세로를 고치는 보정 후보가 뽑히지 않았다 */
  function gazeAccuracy(points, W, H) {
    const P = points.filter(p => finite(p.gx) && finite(p.gy)), errs = P.map(p => Math.hypot(p.gx - p.x, p.gy - p.y));
    if (!errs.length) return { errPct: null, grade: 'none' };
    const e = mean(errs) / W * 100;
    return { errPct: round(e, 1), grade: e <= 10 ? 'good' : e <= 18 ? 'fair' : 'poor', hx: round(median(P.map(p => Math.abs(p.gx - p.x))) / W * 100, 1),
      ...(finite(H) && H > 0 ? { hy: round(median(P.map(p => Math.abs(p.gy - p.y))) / H * 100, 1) } : {}) };
  }
  function validateGazeEyes(model, points, W, H) {
    if(!model?.eyes)return;
    for(const side of ['left','right']){
      const m=model.eyes[side];if(!m)continue;
      const pairs=points.map(p=>{
        const gs=p.fs.filter(f=>f.eyes?.[side]?.q>.035).map(f=>predictGaze(m,{...f,u:f.eyes[side].u,v:f.eyes[side].v}));
        return gs.length>=4?{x:p.x,y:p.y,gx:median(gs.map(g=>g.x)),gy:median(gs.map(g=>g.y))}:null;
      }).filter(Boolean);
      m.validation=pairs.length>=3?{...gazeAccuracy(pairs,W,H),points:pairs.length}:{grade:'none',errPct:null,points:pairs.length};
    }
  }

  /* ---------- 정서 자유 보기 지표 ---------- */
  const SIDE_GAP = 0.06, ONSET_SKIP = 150;
  const sideOf = (x, W) => !finite(x) ? null : x < W * (0.5 - SIDE_GAP) ? 'L' : x > W * (0.5 + SIDE_GAP) ? 'R' : null;
  /* trial: {kind:'neg'|'pos'|'neu', emoSide:'L'|'R', onset, end, samples:[{t,x}]} */
  /* 자유 보기 시행 1개: 전체 체류 비율 + 시간 흐름(1초 구간) + 유지 주의(1.5초 이후) + 시선 전환 횟수
   * 초기 정향(첫 시선)과 유지 주의(후반 체류)는 서로 다른 기제로, 불안은 초기 경계·우울은 후반 유지와 더 관련된다
   * (Armstrong & Olatunji, 2012). 시간 구간 분석은 경계-회피 패턴을 구분하게 해 준다 (Mogg et al., 2004) */
  const LATE_MS = 1500, BIN_MS = 1000;
  function trialStats(tr, W) {
    let emo = 0, other = 0, first = null, firstVisit = null, visitStart = null, lapse = 0, lapseStart = null;
    let lateEmo = 0, lateAll = 0, switches = 0, lastSide = null, latency = null, visits = 0, onEmo = false;
    const bins = [[0, 0], [0, 0], [0, 0], [0, 0]];
    const s = Signal.cleanGaze(tr.samples,{task:'dwell',W}).filter(p => p.t >= tr.onset && p.t <= tr.end);
    for (let i = 0; i < s.length; i++) {
      const side = sideOf(s[i].x, W);
      const dt = i + 1 < s.length ? (!s[i + 1].breakBefore && (s[i + 1].t - s[i].t)<=200 ? (s[i + 1].t - s[i].t) * (s[i].recovered ? .5 : 1) : 0) : 0;
      if (side === tr.emoSide) emo += dt; else if (side) other += dt;
      if (side) {
        const rel = s[i].t - tr.onset, b = Math.min(3, Math.floor(rel / BIN_MS));
        bins[b][1] += dt; if (side === tr.emoSide) bins[b][0] += dt;
        if (rel >= LATE_MS) { lateAll += dt; if (side === tr.emoSide) lateEmo += dt; }
        if (lastSide && side !== lastSide) switches++;
        if (side === tr.emoSide && !onEmo) { visits++; onEmo = true; } else if (side !== tr.emoSide) onEmo = false;
        lastSide = side;
        if (latency === null && !s[i].recovered && side === tr.emoSide && rel >= ONSET_SKIP) latency = rel;
      }
      if (!first && !s[i].recovered && side && s[i].t - tr.onset >= ONSET_SKIP) first = side === tr.emoSide ? 'emo' : 'other';
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
    return { valid, emoShare: valid ? emo / total : null, first: valid ? first : null, firstVisitMs: valid ? firstVisit : null,
      lateShare: valid && lateAll >= (dur - LATE_MS) * 0.3 ? lateEmo / lateAll : null, bins: valid ? bins.map(([e, a]) => (a >= 250 ? e / a : null)) : null,
      switches: valid ? switches : null, latencyMs: valid ? latency : null,
      visits: valid ? visits : null, glanceMs: valid && visits ? emo / visits : null };
  }
  /* 좌우 균형 가중(NL-QC 5): 유효 시행이 한쪽에 몰리면 개인의 좌우 시선 치우침이 편향처럼 보이므로,
   * 정서 자극이 왼쪽·오른쪽에 있던 시행을 따로 평균한 뒤 두 평균을 같은 비중으로 합친다 (양쪽 2시행 이상일 때) */
  function blockStats(trials, W) {
    const st = trials.map(t => ({ ...trialStats(t, W), side: t.emoSide })).filter(s => s.valid);
    const firsts = st.filter(s => s.first);
    const L = st.filter(s => s.side === 'L').map(s => s.emoShare), R = st.filter(s => s.side === 'R').map(s => s.emoShare);
    const balanced = L.length >= 2 && R.length >= 2;
    /* 좌우 균형 평균을 다른 비율 지표에도 같은 방식으로 적용 */
    const balMean = key => {
      const ok = st.filter(s => finite(s[key]));
      if (!ok.length) return null;
      const l = ok.filter(s => s.side === 'L').map(s => s[key]), r = ok.filter(s => s.side === 'R').map(s => s[key]);
      return round(l.length >= 2 && r.length >= 2 ? (mean(l) + mean(r)) / 2 : mean(ok.map(s => s[key])), 3);
    };
    /* 반분 안정성: 홀수·짝수 번째 시행의 평균 응시 비율 차이 — 작을수록 시행마다 일관되게 측정된 것 */
    const half = k => { const a = st.filter((_, i) => i % 2 === k).map(s => s.emoShare); return a.length ? mean(a) : null; };
    const h0 = half(0), h1 = half(1);
    return {
      n: trials.length, valid: st.length, balanced,
      emoShare: !st.length ? null : balanced ? round((mean(L) + mean(R)) / 2, 3) : round(mean(st.map(s => s.emoShare)), 3),
      lateShare: balMean('lateShare'),
      bins: st.length ? [0, 1, 2, 3].map(b => { const v = st.map(s => s.bins && s.bins[b]).filter(finite); return v.length ? round(mean(v), 3) : null; }) : null,
      switches: st.length ? round(mean(st.map(s => s.switches)), 2) : null,
      revisits: st.length ? round(mean(st.map(s => Math.max(0, (s.visits || 0) - 1))), 2) : null,
      glanceMs: (() => { const v = st.map(s => s.glanceMs).filter(finite); return v.length >= 2 ? round(median(v), 0) : null; })(),
      latencyMs: (() => { const v = st.map(s => s.latencyMs).filter(finite); return v.length >= 2 ? round(median(v), 0) : null; })(),
      halfGap: finite(h0) && finite(h1) && st.length >= 6 ? round(Math.abs(h0 - h1), 3) : null,
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
    stable:   { title: '마음 평온형', tag: '마음도 몸도 차분하게 유지되고 있어요', desc: '불편한 사진에 시선이 오래 머물지 않았고, 압박 과제에서도 심박이 크게 오르지 않았어요. 지금의 생활 리듬을 그대로 지켜 가는 것이 가장 좋은 관리예요.' },
    mind:     { title: '생각 과몰입형', tag: '몸은 차분하지만 생각이 불편한 쪽에 오래 머물러요', desc: '심박 반응은 크지 않았지만 시선이 불편한 사진 쪽에 더 오래 머물렀어요. 걱정이나 곱씹는 생각이 겉으로 드러나지 않게 에너지를 쓰고 있을 수 있어요.' },
    body:     { title: '신체 우선 반응형', tag: '마음보다 몸이 먼저 긴장해요', desc: '시선은 고르게 나뉘었지만 압박 상황에서 심박이 뚜렷하게 올랐어요. 스스로는 괜찮다고 느껴도 몸이 먼저 긴장 신호를 보내는 편이에요.' },
    overload: { title: '감정/스트레스 과부하형', tag: '마음과 몸이 함께 긴장해 있어요', desc: '시선이 불편한 사진에 오래 머물렀고, 압박 상황에서 몸의 반응도 컸어요. 최근 쌓인 부담이 꽤 클 수 있으니 회복을 먼저 챙겨 주세요.' },
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
    /* 화면이 가려진 구간(탭 전환 등)의 프레임은 쓰지 않는다 */
    const hidden = (rec.hidden || []).filter(h => finite(h.start) && finite(h.end));
    const inHidden = t => hidden.some(h => t >= h.start - 500 && t <= h.end + 1500);
    if (hidden.length) rec = { ...rec, frames: rec.frames.map(f => (inHidden(f.t) ? { ...f, ok: false, ppgOk: false, faceOk: false, eyeOk: false } : f)) };
    const sig = buildBvp(rec.frames);
    const jumps = lumJumps(rec.frames), moveBursts = motionBursts(rec.frames);
    /* 10초 창이 조명 급변 시각을 포함하면 그 창은 버린다 */
    const wins = hrWindows(sig,10,1,{jumps,motion:moveBursts});
    const phaseCache=new Map();
    const phaseWindows=(start,end)=>{
      if(!finite(start)||!finite(end)||end<=start)return [];
      const key=start+':'+end;if(!phaseCache.has(key))phaseCache.set(key,hrWindows(sig,10,1,{start,end,jumps,motion:moveBursts}));
      return phaseCache.get(key);
    };
    /* 하위 구간(회복 후반·압박 8초 이후·정서 블록)은 상위 구간 전체에서 만든 창 가운데 하위 구간 안에 온전히 든 창만 요약한다.
     * 하위 구간만 잘라 창을 다시 만들면 시간 연속성 추적(앞뒤 20~30초 이웃 창)이 문맥을 잃어, 같은 프레임인데도 채택 창이 크게 준다
     * (2026-10-07 실측 NLR-D2B1…: 회복 전체 채택 33창 · 70.9bpm 인데 회복 후반만 다시 만들면 2창 → 'inferred'(신뢰도 0.3) → 심박 회복률·잔여 심박 판정 제외).
     * 창은 하위 구간 밖 자료를 포함하지 않으므로 앞 구간 값이 섞이지 않는다 */
    const summarizePhase=(start,end,parent)=>phaseHr(parent&&finite(parent[0])&&finite(parent[1])?phaseWindows(...parent):phaseWindows(start,end),start,end);
    const ph = rec.phases;
    const span = n => ph[n] ? [ph[n].start, ph[n].end] : [NaN, NaN];
    const hr = {};
    /* 정서 블록(중립→부정→긍정)은 연달아 이어지므로 세 블록 전체를 상위 구간으로 쓴다. 이웃 블록은 추적 기준으로만 쓰여 블록 간 차이는 0 쪽(보수적)으로만 줄 수 있다 */
    const emo = ['neu', 'neg', 'pos'].every(n => ph[n] && finite(ph[n].start) && finite(ph[n].end)) && ph.neg.start - ph.neu.end < 5000 && ph.pos.start - ph.neg.end < 5000 ? [ph.neu.start, ph.pos.end] : null;
    ['baseline', 'recovery'].forEach(n => { hr[n] = summarizePhase(...span(n)); });
    ['neu', 'neg', 'pos'].forEach(n => { hr[n] = summarizePhase(...span(n), emo); });
    /* 압박: 심박은 과제 시작 후 수 초에 걸쳐 오르므로 첫 8초를 빼고 잰다 */
    const [ss, se] = span('stress');
    hr.stress = summarizePhase(se - ss > 20000 ? ss + 8000 : ss, se, [ss, se]);
    /* 과제 직전 안정 구간(안내 읽기·카운트다운, 시작 3~25초 전): 기준선이 약하거나 오래전이면 이쪽을 비교 기준으로 */
    hr.pre = ph.preStress ? summarizePhase(Math.max(ph.preStress.start,ph.preStress.end-25000),ph.preStress.end)
      : rec.capture ? phaseHr([],NaN,NaN) : summarizePhase(ss - 25000, ss - 3000);
    hr.pre.context=!ph.preStress?'legacy-pre-task':ph.preStress.end-ph.preStress.start>=15000?'pre-task-rest':'pre-task-instructions';
    /* 회복: 회복 구간 후반 절반 심박 */
    const [rs, re] = span('recovery');
    hr.recoveryLate = summarizePhase((rs + re) / 2, re, [rs, re]);
    /* 세션 흐름으로 튀는·빠진 구간 보정 */
    const trend = sessionTrend(wins), spanOf = { baseline: span('baseline'), neu: span('neu'), neg: span('neg'), pos: span('pos'), stress: [se - ss > 20000 ? ss + 8000 : ss, se], recovery: [rs, re], recoveryLate: [(rs + re) / 2, re] };
    Object.entries(spanOf).forEach(([k, [a, b]]) => { if (hr[k]) hr[k] = repairPhase(hr[k], trend.phase(a, b)); });

    /* 약한 신호(weak-signal)라도 창 3개 이상이 일관되면 비교에 쓴다 — 신뢰도(hq)가 낮게 매겨져 점수 가중이 작아진다 */
    const usableHr = q => q && q.bpm !== null && q.quality !== 'none' && (q.quality !== 'poor' || (q.status === 'weak-signal' && q.n >= 3));
    const QR = { good: 2, fair: 1, poor: 0, none: -1 };
    /* 압박 직전 안정 구간(30초)이 측정됐으면 그쪽을 기준으로 쓴다: 몇 분 전 기준선보다 PVT·SART 뒤 달라진 각성 수준이 반영된다.
     * 직전 구간 품질이 기준선보다 두 단계 이상 낮을 때만 기준선을 쓴다 */
    const preFirst = ph.preStress && ph.preStress.end - ph.preStress.start >= 15000;
    const ref = usableHr(hr.pre) && (preFirst ? !usableHr(hr.baseline) || QR[hr.pre.quality] >= QR[hr.baseline.quality] - 1 : !usableHr(hr.baseline) || QR[hr.pre.quality] > QR[hr.baseline.quality]) ? { ...hr.pre, src: 'pre' }
      : usableHr(hr.baseline) ? { ...hr.baseline, src: 'baseline' } : null;
    const stressDelta = ref && usableHr(hr.stress) ? round(hr.stress.bpm - ref.bpm, 1) : null;
    const negDelta = usableHr(hr.neu) && usableHr(hr.neg) ? round(hr.neg.bpm - hr.neu.bpm, 1) : null;
    /* 심박 회복률 (고전적 정의 — 정점 대비 되돌아온 비율):
     *   회복률 = 1 − (회복 후반 − 기준)⁺ / (압박 정점 − 기준), 압박 상승이 max(3bpm, 2×SE) 이상일 때만(아래 recoveryNA)
     *   - 압박 정점 = 압박 구간 심박 창들의 상위 25% 값(중앙값보다 반응을 잘 잡는다)
     *   - 회복 후반 신호가 약하면 회복 구간 전체 심박으로 대신한다 (recoverySrc 에 기록)
     * core 2.4 까지는 분모 하한 3bpm 으로 '항상' 계산했으나, 압박 반응이 없으면 잔여 심박 잡음이 회복률 판정으로 증폭됐다 */
    let recovery = null, recoveryResid = null, recoverySrc = null;
    const lateHr = usableHr(hr.recoveryLate) ? (recoverySrc = 'late', hr.recoveryLate) : usableHr(hr.recovery) ? (recoverySrc = 'whole', hr.recovery) : null;
    const stressFrom = se - ss > 20000 ? ss + 8000 : ss;
    const stressWins = phaseWindows(ss,se).filter(w=>w.usable&&w.start>=stressFrom-.01&&w.end<=se+.01);
    const peak = stressWins.length >= 2 ? quantile(stressWins.map(w => w.bpm), 0.75) : usableHr(hr.stress) ? hr.stress.bpm : null;
    hr.stressPeak = finite(peak) ? round(peak, 1) : null;
    /* 회복률은 압박 반응이 측정 오차보다 클 때만 정의된다(core 2.5): 상승 ≥ max(3bpm, 2×SE(기준·압박 차)).
     * 실측 19세션 중 15세션이 이 기준에 못 미쳤고, 그때 회복률은 잔여 심박(회복 후반 − 기준)을 3bpm 분모로 다시 잰 값이라
     * 잡음만으로 −95%·‘관리 필요’가 나왔다(압박 때 심박이 오히려 내려간 세션 포함). 이 경우 null + recoveryNA, 평가는 잔여 심박이 맡는다 */
    const seOf = q => q && finite(q.spreadBpm) ? Math.max(0.5, q.spreadBpm) / Math.sqrt(Math.max(1, (q.effectiveSeconds || 10) / 10)) : 2;
    let recoveryNA = null;
    if (ref && lateHr) {
      recoveryResid = round(lateHr.bpm - ref.bpm, 1);
      const rise = finite(peak) ? peak - ref.bpm : null, need = Math.max(3, 2 * Math.hypot(seOf(ref), seOf(hr.stress)));
      if (rise === null) recoveryNA = null;
      else if (rise < need) recoveryNA = { reason: 'no-stress-rise', riseBpm: round(rise, 1), needBpm: round(need, 1) };
      else recovery = round(clamp(1 - Math.max(0, lateHr.bpm - ref.bpm) / rise, -1, 1) * 100, 0);
    }
    const recIbis = sig && usableHr(hr.recovery) ? ibis(beats(sig, rs, re, hr.recovery.bpm)) : [];
    const coupling = breathingCoupling(recIbis);
    const resp = rs < re ? respiration(rec.frames, rs + 5000, re) : null;
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
    const face = rec.frames.filter(f => f.faceOk ?? f.ok);
    const blink = { baseline: blinkRate(face, ...span('baseline')), stress: blinkRate(face, ...span('stress')), all: blinkRate(face, ...all) };
    const motion = { baseline: motionIndex(face, ...span('baseline')), all: motionIndex(face, ...all) };
    const expr = { neu: expression(face, ...span('neu')), neg: expression(face, ...span('neg')), pos: expression(face, ...span('pos')) };
    const exprNeg = expr.neu && expr.neg ? round((expr.neg.frown - expr.neu.frown) * 100, 1) : null;
    /* 정서 반응 보조 지표: 기쁜 사진에서 미소 근육 반응(웹캠 표정 추정, EMG 대리) · 불편한 사진에서 깜빡임 변화 */
    const exprPos = expr.neu && expr.pos ? round((expr.pos.smile - expr.neu.smile) * 100, 1) : null;
    const blinkNeu = blinkRate(face, ...span('neu')), blinkNeg = blinkRate(face, ...span('neg'));
    const blinkEmo = finite(blinkNeu) && finite(blinkNeg) ? round(blinkNeg - blinkNeu, 1) : null;

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

    const coverage = round(Signal.timeCoverage(face,...all)*100,0);
    return {
      version: VERSION, demo: !!rec.demo, measuredAt: rec.measuredAt || null, checkin: rec.checkin || null,
      quality: { skinCoverage: sig ? round(sig.coverage*100,0) : 0, recoveredFraction: sig ? round(sig.recoveredFraction,3) : 0, faceCoverage: coverage, gaze: rec.calibration || null, hr: hr.baseline.quality, gazeOk, bodyOk },
      hr, hrRef: ref ? ref.src : null, stressDelta, negDelta, recovery, recoveryNA, recoveryResid, recoverySrc, coupling, resp, lightJumps: jumps.length, hrv: round(hrv, 0),
      gaze: { blocks, sideBias, attentionBias, positivity, dwellNeg: blocks.neg.dwellMs, firstNeg: blocks.neg.firstEmoRate,
        lateNeg: blocks.neg.lateShare, binsNeg: blocks.neg.bins, binsPos: blocks.pos.bins, switches: blocks.neg.switches, latencyNeg: blocks.neg.latencyMs, halfGapNeg: blocks.neg.halfGap,
        revisitsNeg: blocks.neg.revisits, glanceNeg: blocks.neg.glanceMs, glanceNeu: blocks.neu.glanceMs },
      breath: { baseline: breathWave(rec.frames, ...span('baseline')), recovery: breathWave(rec.frames, ...span('recovery')) },
      blink, motion, expr, exprNeg, exprPos, blinkEmo,
      profile: { code, ...PROFILES[code], biasHigh, bodyHigh },
      care: CARE[code], mismatch,
      timeline: wins.map(w => ({ t: Math.round(w.t), start: w.start, end: w.end, bpm: round(w.bpm, 1), snr: round(w.snr, 1), confidence:w.confidence, usable:w.usable, status:w.status, methods:w.methods, regions:w.regions, recovered:w.recovered, spreadBpm:w.spread, reason:w.reason })),
      evidence: {version:Fusion.VERSION, phases:Object.fromEntries(Object.entries(hr).filter(([,v])=>v&&typeof v==='object')), windows:wins},
    };
  }

  /* 실시간 심박 (바이오피드백용): 최근 frames 로 즉시 추정 */
  function liveHr(frames, winSec = 10) {
    if (!frames.length) return null;
    const end = frames[frames.length - 1].t;
    const recent = frames.filter(f => f.t >= end - winSec * 1000);
    const sig = buildBvp(recent);
    if (!sig) return null;
    const pk = hrWindows(sig,8,1).filter(w=>w.usable).at(-1);
    return pk && end-pk.t<5000 ? { bpm: round(pk.bpm, 0), snr: round(pk.snr, 1), quality: pk.quality, confidence:pk.confidence, validSeconds:pk.windowSec, status:pk.status } : null;
  }

  /* 예비 심박 (화면 표시 전용): 카메라를 켜고 약 3초부터 바로 보여 주기 위한 짧은 창 추정.
   * 스펙트럼 피크와 박동 간격(피크 사이 시간)을 함께 보고, 둘이 어긋나면 품질을 낮춘다.
   * 융합 추정(liveHr)이 나오기 전까지만 쓰며, 측정·판정에는 쓰지 않는다 */
  function quickHr(frames, fs = 30) {
    const ok = frames.filter(f => (f.ppgOk ?? f.ok) && [f.t, f.r, f.g, f.b].every(finite));
    if (ok.length < 2) return null;
    const end = ok[ok.length - 1].t, use = ok.filter(f => f.t >= end - 8000);
    const sec = (end - use[0].t) / 1000;
    if (sec < 2.8 || use.length < fs * 2.2) return null;
    const rs = resample(use.map(f => f.t), [use.map(f => f.r), use.map(f => f.g), use.map(f => f.b)], fs);
    const x = bandpass(pos(rs.data[0], rs.data[1], rs.data[2], fs), fs);
    if (std(Array.from(x)) < 1e-9) return null;
    const pk = spectralPeak(x, fs, HR_BAND[0], HR_BAND[1], 2.5);
    if (!pk) return null;
    /* 박동 간격: 0.33초 이상 떨어진 양(+)의 국소 최대 */
    const peaks = [];
    for (let i = 1; i < x.length - 1; i++) if (x[i] > 0 && x[i] >= x[i - 1] && x[i] > x[i + 1] && (!peaks.length || i - peaks[peaks.length - 1] >= fs * 0.33)) peaks.push(i);
    const ibi = peaks.slice(1).map((p, i) => (p - peaks[i]) / fs).filter(v => v >= 0.33 && v <= 1.5);
    const bpmI = ibi.length >= 2 ? 60 / median(ibi) : null;
    const agree = bpmI !== null && Math.abs(bpmI - pk.bpm) <= 8;
    const bpm = agree ? (pk.bpm + bpmI) / 2 : pk.bpm;
    return { bpm: round(bpm, 0), snr: round(pk.snrDb, 1), quality: agree && pk.snrDb >= -2 ? 'fair' : 'poor', provisional: true, validSeconds: round(sec, 1) };
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
      const ch = k => { const n2 = noise * 1.7 * (1 + 0.4 * k); return [175 + drift + 0.25 * p + n2 * gauss(), 118 + drift * 0.8 + 0.6 * p + n2 * gauss(), 98 + drift * 0.7 + 0.15 * p + n2 * gauss()]; };
      out.push({
        t, ok: true, rr: opt.rois === false ? undefined : [ch(0), ch(1), ch(2)],
        r: 175 + drift + 0.25 * p + noise * gauss(), g: 118 + drift * 0.8 + 0.6 * p + noise * gauss(), b: 98 + drift * 0.7 + 0.15 * p + noise * gauss(),
        blink: closed ? 0.9 : 0.02, open: closed ? 0.04 : 0.29 + 0.008 * gauss(),
        cx: 0.5 + mv * gauss(), cy: 0.5 + mv * gauss() + (opt.breathAt ? opt.breathAt(t) : 0), fw: 0.3,
        frown: (opt.frownAt ? opt.frownAt(t) : 0.05) + 0.01 * rand(), smile: 0.1 + 0.01 * rand(),
      });
      t += dt;
    }
    return out;
  }

  const api = {
    VERSION, THRESH, LM, PROFILES, CARE, Signal, chrom,
    mean, median, std, quantile, resample, biquad, filtfilt, bandpass, pos, powerSpectrum, spectralPeak, quality,
    buildBvp, hrWindows, phaseHr, sessionTrend, repairPhase, measureEvidence, motionBursts, beats, ibis, rmssd, breathingCoupling,
    faceFeatures, fitGaze, predictGaze, compareGazeFeatures, pickCalibration, softBound, gazeAccuracy, validateGazeEyes, fitAffine, applyAffine, oneEuro, gazeCursor,
    respiration, lumJumps, sideOf, trialStats, blockStats, blinkRate, motionIndex, expression, analyze, liveHr, quickHr, breathWave, fitResidual, applyResidual, gazeStabilizer, robustFeatures, composeAffine, synthFrames,
  };
  const Fusion = createFusion(api); api.Fusion = Fusion;
  return api;
});
