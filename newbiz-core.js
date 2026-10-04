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

  const VERSION = 'In_mind core 0.6';
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
      const rgb=[0,1,2].map(()=>new Float64Array(length).fill(NaN));
      let j=0;
      for(let i=0;i<length;i++){
        const t=t0+i*1000/fs;
        while(j+1<clean.length&&clean[j+1].t<t)j++;
        const a=clean[j],b=clean[j+1];
        if(!a || t<a.t-.001)continue;
        if(Math.abs(t-a.t)<.001){for(let k=0;k<3;k++)rgb[k][i]=a.v[k];qualityTrace[i]=a.q;jitterTrace[i]=a.jitter;continue;}
        if(!b||b.t-a.t>200||b.t<=a.t)continue;
        const q=(t-a.t)/(b.t-a.t);qualityTrace[i]=a.q+(b.q-a.q)*q;jitterTrace[i]=a.jitter+(b.jitter-a.jitter)*q;
        for(let k=0;k<3;k++)rgb[k][i]=a.v[k]+(b.v[k]-a.v[k])*q;
        if(b.t-a.t>dt*1.6)repaired[i]=1;
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
  function measureEvidence(frames,start,end) {
    const selected=frames.filter(f=>f.t>=start&&f.t<=end),sig=buildBvp(selected);
    return phaseHr(hrWindows(sig,10,1,{start,end,jumps:lumJumps(selected)}),start,end);
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
      if(!bvp.subarray(lo,hi).every(finite) || sig.repaired?.subarray(lo,hi).some(Boolean))continue;
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
  /* 조명 급변: 2초 창 평균 피부 밝기가 직전 창보다 12% 넘게 바뀐 시각 (rPPG 창을 이 근처에서 제외) */
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
    const midX = (lm[top].x + lm[bot].x) / 2, midY = (lm[top].y + lm[bot].y) / 2;
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
  const gazeVec = (f, mu, sd, quad) => {
    const z = GAZE_KEYS.map(k => (f[k] - mu[k]) / sd[k]);
    return quad ? [1, ...z, z[0] * z[0], z[1] * z[1], z[0] * z[1]] : [1, ...z];
  };
  function fitGaze(samples, lambda = 0.5, opt = {}) {
    const S = samples.filter(s => s.f && GAZE_KEYS.every(k => finite(s.f[k])));
    if (S.length < 20) return null;
    const quad = opt.quad !== false && S.length >= 120;
    const mu = {}, sd = {};
    GAZE_KEYS.forEach(k => { mu[k] = mean(S.map(s => s.f[k])); sd[k] = std(S.map(s => s.f[k])) || 1; });
    const X = S.map(s => gazeVec(s.f, mu, sd, quad)), d = X[0].length, W = S.map(s => (finite(s.w) ? s.w : 1));
    const wsum = W.reduce((a, b) => a + b, 0);
    const fit = key => {
      const XtX = Array.from({ length: d }, () => new Array(d).fill(0)), Xty = new Array(d).fill(0);
      X.forEach((row, i) => {
        const w = W[i];
        for (let a = 0; a < d; a++) { Xty[a] += w * row[a] * S[i][key]; for (let b = 0; b < d; b++) XtX[a][b] += w * row[a] * row[b]; }
      });
      for (let a = 1; a < d; a++) XtX[a][a] += lambda * wsum / 50 * (a > GAZE_KEYS.length ? 4 : 1);   // 제곱항은 더 강하게 수축
      return solve(XtX, Xty);
    };
    const wx = fit('x'), wy = fit('y');
    if(!wx || !wy)return null;
    const model={mu,sd,wx,wy,quad};
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
    const v = gazeVec(f, model.mu, model.sd, model.quad);
    const dot = w => w.reduce((s, x, i) => s + x * v[i], 0);
    return { x: dot(model.wx), y: dot(model.wy) };
  }
  /* 영점 조정: 표적(x,y) ↔ 예측(gx,gy) 쌍으로 축별 1차 보정 x' = a·x + b 를 맞춘다.
   * 표적이 한 축에서 퍼져 있지 않으면 이동(b)만 쓰고, 기울기는 0.75~1.35 로 제한해 과보정을 막는다 */
  function fitAffine(pairs) {
    const P = (pairs || []).filter(p => finite(p.x) && finite(p.y) && finite(p.gx) && finite(p.gy));
    if (P.length < 3) return null;
    const axis = (t, g) => {
      const mt = mean(t), mg = mean(g);
      let cov = 0, vg = 0, vt = 0;
      for (let i = 0; i < t.length; i++) { cov += (g[i] - mg) * (t[i] - mt); vg += (g[i] - mg) ** 2; vt += (t[i] - mt) ** 2; }
      const a = vt > 0 && vg > 0 ? clamp(cov / vg, 0.75, 1.35) : 1;
      return { a, b: mt - a * mg };
    };
    return { x: axis(P.map(p => p.x), P.map(p => p.gx)), y: axis(P.map(p => p.y), P.map(p => p.gy)) };
  }
  const applyAffine = (A, g) => (A && g ? { x: A.x.a * g.x + A.x.b, y: A.y.a * g.y + A.y.b } : g);

  /* One Euro 필터 (Casiez, Roussel & Vogel, 2012): 시선이 머물 때는 강하게, 빠르게 움직일 때는 약하게 평활해
   * 떨림과 지연을 함께 줄인다. 화면 표시용 시선 커서에 쓴다 */
  function oneEuro(opt = {}) {
    const minCut = opt.minCutoff ?? 0.9, beta = opt.beta ?? 0.006, dCut = opt.dCutoff ?? 1;
    let xPrev = null, dxPrev = 0, tPrev = null;
    const alpha = (cut, dt) => { const r = 2 * Math.PI * cut * dt; return r / (r + 1); };
    return (x, tMs) => {
      if (xPrev === null || !finite(tPrev)) { xPrev = x; tPrev = tMs; return x; }
      const dt = Math.max(0.001, (tMs - tPrev) / 1000);
      tPrev = tMs;
      const dx = (x - xPrev) / dt, ad = alpha(dCut, dt);
      dxPrev = ad * dx + (1 - ad) * dxPrev;
      const a = alpha(minCut + beta * Math.abs(dxPrev), dt);
      xPrev = a * x + (1 - a) * xPrev;
      return xPrev;
    };
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
          win = pend.slice(); pend = [];
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
  /* 축별 1차 보정 두 개를 겹친다: 먼저 A, 그다음 B */
  const composeAffine = (A, Bm) => (!A ? Bm : !Bm ? A : { x: { a: Bm.x.a * A.x.a, b: Bm.x.a * A.x.b + Bm.x.b }, y: { a: Bm.y.a * A.y.a, b: Bm.y.a * A.y.b + Bm.y.b } });

  /* 검증점 오차 → 화면 폭 대비 비율과 등급 */
  function gazeAccuracy(points, W, H) {
    const errs = points.filter(p => finite(p.gx) && finite(p.gy)).map(p => Math.hypot(p.gx - p.x, (p.gy - p.y) * 0.6));
    if (!errs.length) return { errPct: null, grade: 'none' };
    const e = median(errs) / W * 100;
    return { errPct: round(e, 1), grade: e <= 10 ? 'good' : e <= 18 ? 'fair' : 'poor', hx: round(median(points.map(p => Math.abs(p.gx - p.x))) / W * 100, 1) };
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
    let lateEmo = 0, lateAll = 0, switches = 0, lastSide = null, latency = null;
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
      switches: valid ? switches : null, latencyMs: valid ? latency : null };
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
    const jumps = lumJumps(rec.frames);
    /* 10초 창이 조명 급변 시각을 포함하면 그 창은 버린다 */
    const wins = hrWindows(sig,10,1,{jumps});
    const phaseCache=new Map();
    const phaseWindows=(start,end)=>{
      if(!finite(start)||!finite(end)||end<=start)return [];
      const key=start+':'+end;if(!phaseCache.has(key))phaseCache.set(key,hrWindows(sig,10,1,{start,end,jumps}));
      return phaseCache.get(key);
    };
    const summarizePhase=(start,end)=>phaseHr(phaseWindows(start,end),start,end);
    const ph = rec.phases;
    const span = n => ph[n] ? [ph[n].start, ph[n].end] : [NaN, NaN];
    const hr = {};
    ['baseline', 'neu', 'neg', 'pos', 'recovery'].forEach(n => { hr[n] = summarizePhase(...span(n)); });
    /* 압박: 심박은 과제 시작 후 수 초에 걸쳐 오르므로 첫 8초를 빼고 잰다 */
    const [ss, se] = span('stress');
    hr.stress = summarizePhase(se - ss > 20000 ? ss + 8000 : ss, se);
    /* 과제 직전 안정 구간(안내 읽기·카운트다운, 시작 3~25초 전): 기준선이 약하거나 오래전이면 이쪽을 비교 기준으로 */
    hr.pre = ph.preStress ? summarizePhase(Math.max(ph.preStress.start,ph.preStress.end-25000),ph.preStress.end)
      : rec.capture ? phaseHr([],NaN,NaN) : summarizePhase(ss - 25000, ss - 3000);
    hr.pre.context=ph.preStress?'pre-task-instructions':'legacy-pre-task';
    /* 회복: 회복 구간 후반 절반 심박 */
    const [rs, re] = span('recovery');
    hr.recoveryLate = summarizePhase((rs + re) / 2, re);

    const usableHr = q => q && q.bpm !== null && q.quality !== 'poor' && q.quality !== 'none';
    const QR = { good: 2, fair: 1, poor: 0, none: -1 };
    const ref = usableHr(hr.baseline) && (!usableHr(hr.pre) || QR[hr.baseline.quality] >= QR[hr.pre.quality]) ? { ...hr.baseline, src: 'baseline' }
      : usableHr(hr.pre) ? { ...hr.pre, src: 'pre' } : null;
    const stressDelta = ref && usableHr(hr.stress) ? round(hr.stress.bpm - ref.bpm, 1) : null;
    const negDelta = usableHr(hr.neu) && usableHr(hr.neg) ? round(hr.neg.bpm - hr.neu.bpm, 1) : null;
    /* 심박 회복률 (항상 계산되도록 재정의):
     *   회복률 = 1 − (회복 후반 − 기준)⁺ / max(압박 정점 − 기준, 3bpm)
     *   - 압박 정점 = 압박 구간 심박 창들의 상위 25% 값(중앙값보다 반응을 잘 잡는다)
     *   - 분모 하한 3bpm: 반응이 작아도 비율이 폭주하지 않고, ‘다 돌아왔으면 100%’라는 직관을 지킨다
     *   - 회복 후반 신호가 약하면 회복 구간 전체 심박으로 대신한다 (recoverySrc 에 기록)
     * 반응이 큰 경우에는 고전적 정의(정점 대비 되돌아온 비율)와 같다 */
    let recovery = null, recoveryResid = null, recoverySrc = null;
    const lateHr = usableHr(hr.recoveryLate) ? (recoverySrc = 'late', hr.recoveryLate) : usableHr(hr.recovery) ? (recoverySrc = 'whole', hr.recovery) : null;
    const stressWins = phaseWindows(se - ss > 20000 ? ss + 8000 : ss,se).filter(w=>w.usable);
    const peak = stressWins.length >= 2 ? quantile(stressWins.map(w => w.bpm), 0.75) : usableHr(hr.stress) ? hr.stress.bpm : null;
    hr.stressPeak = finite(peak) ? round(peak, 1) : null;
    if (ref && lateHr) {
      recoveryResid = round(lateHr.bpm - ref.bpm, 1);
      if (finite(peak)) recovery = round(clamp(1 - Math.max(0, lateHr.bpm - ref.bpm) / Math.max(peak - ref.bpm, 3), -1, 1) * 100, 0);
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
      hr, hrRef: ref ? ref.src : null, stressDelta, negDelta, recovery, recoveryResid, recoverySrc, coupling, resp, lightJumps: jumps.length, hrv: round(hrv, 0),
      gaze: { blocks, sideBias, attentionBias, positivity, dwellNeg: blocks.neg.dwellMs, firstNeg: blocks.neg.firstEmoRate,
        lateNeg: blocks.neg.lateShare, binsNeg: blocks.neg.bins, binsPos: blocks.pos.bins, switches: blocks.neg.switches, latencyNeg: blocks.neg.latencyMs, halfGapNeg: blocks.neg.halfGap },
      blink, motion, expr, exprNeg,
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
    buildBvp, hrWindows, phaseHr, measureEvidence, beats, ibis, rmssd, breathingCoupling,
    faceFeatures, fitGaze, predictGaze, gazeAccuracy, validateGazeEyes, fitAffine, applyAffine, oneEuro, gazeCursor,
    respiration, lumJumps, sideOf, trialStats, blockStats, blinkRate, motionIndex, expression, analyze, liveHr, quickHr, gazeStabilizer, robustFeatures, composeAffine, synthFrames,
  };
  const Fusion = createFusion(api); api.Fusion = Fusion;
  return api;
});
