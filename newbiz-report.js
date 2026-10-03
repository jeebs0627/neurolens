/* NeuroLens NewBiz — 통합 자기조절 평가 리포트 렌더러 (newbiz.html 전용).
 * NLBattery.run() 결과를 받아 HTML 문자열을 만든다. 화면 이벤트 연결은 newbiz.html 이 한다.
 * 인용 번호는 본문에 처음 나온 순서로 매기고, 실제 인용된 문헌만 참고문헌에 싣는다.
 * 브라우저: window.NLReport · Node 테스트: module.exports */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const api = factory(isNode ? require('./newbiz-core.js') : root.NLNewbiz, isNode ? require('./newbiz-battery.js') : root.NLBattery);
  if (isNode) module.exports = api;
  if (root) root.NLReport = api;
})(typeof window !== 'undefined' ? window : null, function (N, B) {
  'use strict';

  const finite = v => typeof v === 'number' && Number.isFinite(v);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (v, d = 0, sign = false) => !finite(v) ? '—' : (sign && v > 0 ? '+' : '') + v.toFixed(d);
  const STEP_LABEL = { done: '실측', input: '데모 입력', sim: '시뮬레이션', skipped: '건너뜀', off: '미선택', nogaze: '시선 보정 없음' };
  const MODULE_STEPS = { alert: ['pvt'], oculo: ['pursuit', 'saccade'], sustain: ['sart'], core: ['freeview', 'stress', 'recovery'] };
  const STEP_NAMES = { calibration: '시선 보정', baseline: '기준선', pursuit: '원활 추적', saccade: '프로·안티사카드', freeview: '정서 자유 보기', pvt: 'PVT-B', sart: 'SART', stress: '압박 과제', recovery: '공명 호흡 회복' };
  const DOMAIN_CHART = { ok: '#2F9E6A', watch: '#C98A12', concern: '#D2486A', na: '#A3ABBD' };

  function citer() {
    const order = [];
    const num = k => { let i = order.indexOf(k); if (i < 0) { order.push(k); i = order.length - 1; } return i + 1; };
    const compress = ns => {
      const out = [];
      for (let i = 0; i < ns.length; i++) {
        let j = i;
        while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++;
        out.push(j - i >= 2 ? `${ns[i]}–${ns[j]}` : j > i ? `${ns[i]},${ns[j]}` : String(ns[i]));
        i = j;
      }
      return out.join(',');
    };
    return {
      cite(keys) {
        const ks = (keys || []).filter(k => B.REFS[k]);
        if (!ks.length) return '';
        const ns = [...new Set(ks.map(num))].sort((a, b) => a - b);
        return `<sup class="cite">[${compress(ns)}]</sup>`;
      },
      list: () => order.map((k, i) => ({ n: i + 1, key: k, text: B.REFS[k] })),
    };
  }

  const stBadge = s => `<span class="st st-${s}">${B.STATUS[s]}</span>`;
  const valText = i => i.value === null ? '—' : `${i.d >= 1 ? i.value.toFixed(i.d) : i.value}${i.unit ? ` <small>${esc(i.unit)}</small>` : ''}${i.ci ? `<div class="ci">95% ${fmt(i.ci[0], i.d)}~${fmt(i.ci[1], i.d)}</div>` : ''}`;
  /* 판정 칸: 상태 + NL-QC 표시(경계 · 신뢰도 낮음 · 제외) */
  const judge = i => i.excluded ? `<span class="st st-na">판정 제외</span><div class="qtag">신뢰도 ${Math.round(i.r * 100)}%</div>`
    : `${stBadge(i.status)}${i.borderline ? '<div class="qtag b">경계 · 오차 범위가 기준에 걸침</div>' : ''}${finite(i.r) && i.r < 0.8 ? `<div class="qtag">신뢰도 ${Math.round(i.r * 100)}%</div>` : ''}${i.next ? `<div class="qtag nx">${esc(i.next.text)}</div>` : ''}`;

  function moduleStatus(b, mod) {
    const st = MODULE_STEPS[mod].map(k => (b.steps[k] && b.steps[k].status) || 'off');
    const uniq = [...new Set(st)];
    return uniq.length === 1 ? uniq[0] : uniq.filter(s => s !== 'off').join('+');
  }
  const statusLabel = s => s.split('+').map(x => STEP_LABEL[x] || x).join(' · ');

  /* ---------- 그림 ---------- */
  function frameworkSvg(domains, active) {
    const node = { alert: [280, 46], control: [118, 160], emotion: [442, 160], autonomic: [280, 274] };
    const on = k => active.includes(k);
    const edge = (a, b, key, label, lx, ly) => {
      const [x1, y1] = node[a], [x2, y2] = node[b];
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${on(key) ? '#7357E7' : '#C9D0DD'}" stroke-width="${on(key) ? 3.4 : 1.6}" ${on(key) ? '' : 'stroke-dasharray="5 5"'}/>
        <text x="${lx}" y="${ly}" text-anchor="middle" font-size="10.5" font-weight="${on(key) ? 800 : 500}" fill="${on(key) ? '#5A3FD0' : '#8A93A8'}">${label}</text>`;
    };
    const box = k => {
      const d = domains[k], [x, y] = node[k], c = DOMAIN_CHART[d.status];
      return `<g><rect x="${x - 84}" y="${y - 27}" width="168" height="54" rx="14" fill="#fff" stroke="${c}" stroke-width="2.2"/>
        <text x="${x}" y="${y - 6}" text-anchor="middle" font-size="14" font-weight="800" fill="#0B1733">${esc(d.name)}</text>
        <text x="${x}" y="${y + 13}" text-anchor="middle" font-size="11" fill="${c}" font-weight="700">${d.score === null ? '측정 안 됨' : `${d.score}점 · ${B.STATUS[d.status]}`}</text></g>`;
    };
    return `<svg class="chart fw" viewBox="0 0 560 310" role="img" aria-label="통합 자기조절 모델: 각성, 주의 통제, 정서 주의, 자율신경 조절과 그 연결">
      ${edge('alert', 'control', 'fatigue', '피로 게이팅', 172, 96)}${edge('alert', 'emotion', 'fatigue', 'Lim & Dinges 2010', 392, 96)}
      ${edge('control', 'emotion', 'act', '주의 통제 이론 · Eysenck 2007', 280, 152)}
      ${edge('control', 'autonomic', 'nvi', '신경내장 통합', 160, 230)}${edge('emotion', 'autonomic', 'perseverative', '지속 인지 가설', 402, 230)}
      <text x="280" y="196" text-anchor="middle" font-size="10" fill="#8A93A8">Thayer 2009 · Brosschot 2006</text>
      ${['alert', 'control', 'emotion', 'autonomic'].map(box).join('')}
    </svg>`;
  }

  function domainBars(domains) {
    return `<div class="dbars">${B.DOMAIN_KEYS.map(k => {
      const d = domains[k];
      return `<div class="dbar"><div class="dbar-h"><b>${esc(d.name)}</b><span class="en">${esc(d.en)}</span>${stBadge(d.status)}<b class="sc">${d.score === null ? '—' : d.score}</b></div>
        <div class="dbar-t" aria-hidden="true">${d.score === null ? '' : `<i style="left:${Math.max(1, Math.min(99, d.score))}%"></i>`}</div>${d.partial && d.status !== 'na' ? '<div class="dbar-n">핵심 지표 일부만 측정됨</div>' : ''}</div>`;
    }).join('')}<div class="dbar-scale"><span>0</span><span>관리 필요</span><span>40</span><span>주의</span><span>70</span><span>양호</span><span>100</span></div></div>`;
  }

  function pvtSvg(pvt) {
    const rts = pvt.rts, n = rts.length, W = 860, H = 190, px = 44, py = 12, iw = W - px - 10, ih = H - py - 28;
    const lo = 100, hi = 1000, ys = v => py + (1 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * ih, xs = i => px + (n > 1 ? i / (n - 1) : 0.5) * iw;
    const pts = rts.map((rt, i) => rt === null
      ? `<text x="${xs(i)}" y="${py + 9}" text-anchor="middle" font-size="12" fill="#D2486A">×</text>`
      : `<circle cx="${xs(i).toFixed(1)}" cy="${ys(rt).toFixed(1)}" r="3.4" fill="${rt >= (pvt.lapseMs || B.PROTOCOL.pvt.lapseMs) ? '#C98A12' : '#2458E6'}" opacity=".85"/>`).join('');
    const yl = [200, 355, 600, 1000].map(v => `<text x="${px - 6}" y="${ys(v) + 4}" text-anchor="end" font-size="10.5" fill="#8A93A8">${v}</text>`).join('');
    const L = pvt.lapseMs || 355;
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="PVT 시행별 반응시간">
      <line x1="${px}" x2="${px + iw}" y1="${ys(L)}" y2="${ys(L)}" stroke="#C98A12" stroke-dasharray="4 4"/>
      <text x="${px + iw}" y="${ys(L) - 5}" text-anchor="end" font-size="10.5" fill="#8A5508">경과 반응 기준 ${L}ms${L > 355 ? ` (355 + 기기 지연 보정 ${L - 355})` : ''}</text>
      ${yl}${pts}<text x="${px + iw / 2}" y="${H - 6}" text-anchor="middle" font-size="11" fill="#647089">시행 순서 → (파랑: 정상 반응 · 주황: 경과 반응 · ×: 무반응)</text></svg>`;
  }

  function saccadeSvg(s) {
    const W = 860, rowH = 34, H = 2 * rowH + 44, px = 120, iw = W - px - 16;
    const row = (label, g, type, y) => {
      const tr = s.trials.filter(t => t.type === type);
      if (!tr.length) return `<text x="10" y="${y + 21}" font-size="12.5" fill="#647089">${label}: 미실시</text>`;
      const parts = type === 'pro'
        ? [['정반응', tr.filter(t => t.valid && !t.error).length, '#2F9E6A'], ['방향 오류', tr.filter(t => t.valid && t.error).length, '#D2486A'], ['판정 불가', tr.filter(t => !t.valid).length, '#C9D0DD']]
        : [['정반응', tr.filter(t => t.valid && !t.error).length, '#2F9E6A'], ['오류 후 교정', tr.filter(t => t.valid && t.error && t.corrected).length, '#C98A12'], ['오류 미교정', tr.filter(t => t.valid && t.error && !t.corrected).length, '#D2486A'], ['판정 불가', tr.filter(t => !t.valid).length, '#C9D0DD']];
      let x = px;
      const bars = parts.map(([nm, c, col]) => {
        const w = c / tr.length * iw, out = c ? `<rect x="${x}" y="${y}" width="${w}" height="${rowH - 10}" fill="${col}"/>${w > 52 ? `<text x="${x + w / 2}" y="${y + 17}" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">${nm} ${c}</text>` : ''}` : '';
        x += w; return out;
      }).join('');
      return `<text x="10" y="${y + 17}" font-size="12.5" font-weight="700" fill="#273451">${label} (${tr.length})</text>${bars}`;
    };
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="프로·안티사카드 시행 결과">${row('프로사카드', s.pro, 'pro', 8)}${row('안티사카드', s.anti, 'anti', 8 + rowH)}
      <text x="${px}" y="${H - 8}" font-size="11" fill="#647089">초록: 정반응 · 주황: 표적 쪽으로 갔다가 스스로 교정 · 빨강: 교정 없는 오류 · 회색: 시선 신호 부족</text></svg>`;
  }

  function pursuitSvg(p) {
    const tr = p.trace.filter(z => z.t <= 13), W = 860, H = 170, px = 36, py = 10, iw = W - px - 10, ih = H - py - 30;
    if (tr.length < 10) return '';
    const t0 = tr[0].t, t1 = tr[tr.length - 1].t, xs = t => px + (t - t0) / (t1 - t0 || 1) * iw, ys = v => py + (1 - (Math.max(-1.5, Math.min(1.5, v)) + 1.5) / 3) * ih;
    const path = k => tr.map((z, i) => `${i ? 'L' : 'M'}${xs(z.t).toFixed(1)} ${ys(z[k]).toFixed(1)}`).join(' ');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="원활 추적: 표적과 시선의 수평 위치">
      <line x1="${px}" x2="${px + iw}" y1="${ys(0)}" y2="${ys(0)}" stroke="#E3E8F1"/>
      <path d="${path('tg')}" fill="none" stroke="#A3ABBD" stroke-width="2" stroke-dasharray="6 4"/>
      <path d="${path('g')}" fill="none" stroke="#2458E6" stroke-width="2"/>
      <text x="${px}" y="${H - 8}" font-size="11" fill="#647089">회색 점선: 표적 위치 · 파랑: 추정 시선 (수평, 진폭 대비) · 처음 ${Math.round(t1 - t0)}초</text></svg>`;
  }

  function sartSvg(s) {
    const T = s.rts, n = T.length, W = 860, H = 170, px = 44, py = 12, iw = W - px - 10, ih = H - py - 28;
    const lo = 100, hi = 1100, ys = v => py + (1 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * ih, xs = i => px + i / Math.max(1, n - 1) * iw;
    const pts = T.map((z, i) => {
      if (z.nogo) return z.rt === null ? `<rect x="${xs(i) - 2.5}" y="${py + ih - 5}" width="5" height="5" fill="#2F9E6A"/>` : `<circle cx="${xs(i)}" cy="${ys(z.rt)}" r="4.2" fill="#D2486A"/>`;
      return z.rt === null ? `<text x="${xs(i)}" y="${py + 9}" text-anchor="middle" font-size="11" fill="#C98A12">×</text>` : `<circle cx="${xs(i)}" cy="${ys(z.rt)}" r="2.4" fill="#8A93A8"/>`;
    }).join('');
    const yl = [200, 500, 800, 1100].map(v => `<text x="${px - 6}" y="${ys(v) + 4}" text-anchor="end" font-size="10.5" fill="#8A93A8">${v}</text>`).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="SART 시행별 반응">${yl}${pts}
      <text x="${px + iw / 2}" y="${H - 6}" text-anchor="middle" font-size="11" fill="#647089">회색: 반응시간(ms) · 빨강: 3에서 누름(억제 실패) · 초록 □: 3에서 멈춤 · ×: 누락</text></svg>`;
  }

  function quadrantSvg(r) {
    const W = 360, H = 290, px = 46, py = 14, iw = W - px - 14, ih = H - py - 40;
    const xs = v => px + (Math.max(-4, Math.min(16, v)) + 4) / 20 * iw;
    const ys = v => py + (1 - (Math.max(-0.3, Math.min(0.3, v)) + 0.3) / 0.6) * ih;
    const tx = xs(N.THRESH.stressHigh), ty = ys(N.THRESH.biasHigh);
    const has = r.stressDelta !== null && r.gaze.attentionBias !== null && r.quality.gazeOk;
    const cell = (x, y, w, h, fill, label) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/><text x="${x + w / 2}" y="${y + h / 2}" text-anchor="middle" font-size="12" font-weight="700" fill="#5A6580">${label}</text>`;
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="정서 주의 편향과 압박 심박 반응 2축 유형">
      ${cell(px, py, tx - px, ty - py, '#F3F0FF', '생각 붙잡힘형')}${cell(tx, py, px + iw - tx, ty - py, '#FDEEF1', '복합 과부하형')}
      ${cell(px, ty, tx - px, py + ih - ty, '#EDF7F1', '안정형')}${cell(tx, ty, px + iw - tx, py + ih - ty, '#FFF6E6', '몸 먼저 반응형')}
      <text x="${px + iw / 2}" y="${H - 8}" text-anchor="middle" font-size="11.5" fill="#647089">압박 심박 반응 (bpm) →</text>
      <text x="14" y="${py + ih / 2}" text-anchor="middle" font-size="11.5" fill="#647089" transform="rotate(-90 14 ${py + ih / 2})">부정 자극 주의 편향 →</text>
      ${[-4, 0, 6, 12, 16].map(v => `<text x="${xs(v)}" y="${py + ih + 14}" text-anchor="middle" font-size="10.5" fill="#8A93A8">${v}</text>`).join('')}
      ${has ? `<circle cx="${xs(r.stressDelta)}" cy="${ys(r.gaze.attentionBias)}" r="9" fill="#2458E6" stroke="#fff" stroke-width="3"/><text x="${xs(r.stressDelta)}" y="${ys(r.gaze.attentionBias) - 14}" text-anchor="middle" font-size="12" font-weight="800" fill="#2458E6">나</text>` : `<text x="${px + iw / 2}" y="${py + 18}" text-anchor="middle" font-size="11.5" fill="#D2486A">한쪽 축의 신호가 부족해 위치를 표시하지 않았어요</text>`}
    </svg>`;
  }

  function timelineSvg(r) {
    const ph = r.phaseTimes || {}, keys = Object.keys(ph).filter(k => finite(ph[k].start) && finite(ph[k].end));
    const tl = r.timeline.filter(w => w.snr >= -2);
    if (tl.length < 5 || !keys.length) return '<p class="muted small">심박 신호가 충분하지 않아 그래프를 그리지 않았어요.</p>';
    const t0 = Math.min(...keys.map(k => ph[k].start)), t1 = Math.max(...keys.map(k => ph[k].end));
    const W = 860, H = 210, px = 40, py = 14, iw = W - px - 10, ih = H - py - 34;
    const lo = Math.floor(Math.min(...tl.map(w => w.bpm)) - 4), hi = Math.ceil(Math.max(...tl.map(w => w.bpm)) + 4);
    const xs = t => px + (t - t0) / (t1 - t0) * iw, ys = v => py + (1 - (v - lo) / (hi - lo)) * ih;
    const L = { baseline: ['기준선', '#EEF3FF'], pursuit: ['추적', '#F4F6FA'], saccade: ['사카드', '#F4F6FA'], neu: ['중립', '#F4F6FA'], neg: ['부정', '#FDEEF1'], pos: ['긍정', '#EDF7F1'], pvt: ['PVT', '#EEF3FF'], sart: ['SART', '#F1EEFF'], stress: ['압박', '#FFF6E6'], recovery: ['회복', '#E8F4EE'] };
    const bands = keys.filter(k => L[k]).map(k => {
      const x0 = xs(ph[k].start), w = xs(ph[k].end) - x0;
      return `<rect x="${x0}" y="${py}" width="${w}" height="${ih}" fill="${L[k][1]}"/>${w > 26 ? `<text x="${x0 + w / 2}" y="${H - 8}" text-anchor="middle" font-size="10.5" fill="#647089">${L[k][0]}</text>` : ''}`;
    }).join('');
    let d = '', prev = null;
    tl.filter(w => w.t >= t0 && w.t <= t1).forEach(w => { d += (prev && w.t - prev.t < 3500 ? 'L' : 'M') + xs(w.t).toFixed(1) + ' ' + ys(w.bpm).toFixed(1) + ' '; prev = w; });
    const ticks = [lo, Math.round((lo + hi) / 2), hi].map(v => `<text x="${px - 6}" y="${ys(v) + 4}" text-anchor="end" font-size="10.5" fill="#8A93A8">${v}</text>`).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="측정 구간별 원격 심박 변화">${bands}${ticks}<path d="${d}" fill="none" stroke="#D2486A" stroke-width="2.2" stroke-linejoin="round"/></svg>`;
  }

  /* ---------- 대시보드 구성 요소 ---------- */
  /* 영역 정체성 색 (색각 이상 검증 통과: dataviz validate_palette) — 상태 색(양호·주의·관리 필요)과는 따로 쓴다 */
  const DCOLOR = { alert: '#2a78d6', control: '#4a3aa7', emotion: '#e87ba4', autonomic: '#1baf7a' };
  const SCOLOR = DOMAIN_CHART;
  const DOM_ICON = {
    alert: '<path d="M12 3v3M12 18v3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M3 12h3M18 12h3M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1"/><circle cx="12" cy="12" r="3.6"/>',
    control: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
    emotion: '<path d="M12 20.5s-7.5-4.6-9.2-9.1C1.4 7.9 3.6 4.5 7 4.5c2 0 3.6 1.1 5 2.9 1.4-1.8 3-2.9 5-2.9 3.4 0 5.6 3.4 4.2 6.9-1.7 4.5-9.2 9.1-9.2 9.1z"/>',
    autonomic: '<path d="M2 12h4l2.5-6 4 12 3-9 2 3H22"/>',
  };
  const icon = (k, c = 'currentColor') => `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${DOM_ICON[k]}</svg>`;

  /* 종합 지수: 측정된 영역 점수를 측정 신뢰도로 가중 평균 (참고용 요약) */
  function overallIndex(b) {
    const m = B.DOMAIN_KEYS.map(k => b.domains[k]).filter(d => d.status !== 'na' && finite(d.score));
    if (m.length < 2) return null;
    const w = m.map(d => Math.max(0.2, d.confidence || 0)), sw = w.reduce((a, x) => a + x, 0);
    return Math.round(m.reduce((a, d, i) => a + d.score * w[i], 0) / sw);
  }
  /* 원형 게이지: 점수 호 + 가운데 숫자 */
  function ring(score, { size = 120, stroke = 10, color = '#2a78d6', track = 'rgba(255,255,255,.14)', text = '#fff', sub = '', title = '' } = {}) {
    const r = (size - stroke) / 2, C = 2 * Math.PI * r, v = finite(score) ? Math.max(0, Math.min(100, score)) : 0;
    return `<svg class="ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${esc(title)} ${finite(score) ? score + '점' : '측정 안 됨'}">
      <title>${esc(title)} ${finite(score) ? score + '점' : '측정 안 됨'}</title>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${track}" stroke-width="${stroke}"/>
      ${finite(score) ? `<circle class="ring-arc" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${(C * v / 100).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>` : ''}
      <text x="50%" y="${sub ? '47%' : '50%'}" dominant-baseline="middle" text-anchor="middle" font-family="Sora" font-weight="700" font-size="${size * 0.27}" fill="${text}">${finite(score) ? score : '—'}</text>
      ${sub ? `<text x="50%" y="68%" text-anchor="middle" font-size="${size * 0.1}" font-weight="700" fill="${text}" opacity=".7">${esc(sub)}</text>` : ''}</svg>`;
  }

  /* 레이더: 네 영역 점수 + (있으면) 직전 측정. 배경 동심원은 판정 경계(40 · 70) */
  function radarSvg(domains, prev) {
    const K = B.DOMAIN_KEYS, cx = 220, cy = 160, R = 108, ang = i => -Math.PI / 2 + i * Math.PI / 2;
    const pt = (i, v) => [cx + Math.cos(ang(i)) * R * v / 100, cy + Math.sin(ang(i)) * R * v / 100];
    const poly = vals => vals.map((v, i) => pt(i, finite(v) ? v : 0).map(n => n.toFixed(1)).join(',')).join(' ');
    const ringPoly = v => K.map((_, i) => pt(i, v).join(',')).join(' ');
    const cur = K.map(k => domains[k].score);
    const prevVals = prev ? K.map(k => prev[k]) : null;
    const lab = (k, i) => {
      const [x, y] = pt(i, 116), d = domains[k], anchor = i === 1 ? 'start' : i === 3 ? 'end' : 'middle';
      const y0 = i === 0 ? y - 20 : i === 2 ? y + 14 : y - 4;
      return `<text x="${x}" y="${y0}" text-anchor="${anchor}" font-size="13" font-weight="800" fill="#273451">${esc(d.name)}</text>
        <text x="${x}" y="${y0 + 16}" text-anchor="${anchor}" font-size="13" font-weight="700" font-family="Sora" fill="#273451">${d.score ?? '—'} <tspan font-family="Noto Sans KR" font-size="11" fill="#647089">${B.STATUS[d.status]}</tspan></text>`;
    };
    return `<svg class="chart radar" viewBox="0 0 440 330" role="img" aria-label="네 영역 점수 레이더 차트">
      <polygon points="${ringPoly(100)}" fill="#EEF7F2"/><polygon points="${ringPoly(70)}" fill="#FFF6E6"/><polygon points="${ringPoly(40)}" fill="#FDEEF1"/>
      ${[40, 70, 100].map(v => `<polygon points="${ringPoly(v)}" fill="none" stroke="#D9DEE8" stroke-width="1"/>`).join('')}
      ${K.map((_, i) => { const [x, y] = pt(i, 100); return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#D9DEE8"/>`; }).join('')}
      <text x="${cx + 5}" y="${cy - R * 0.4 + 12}" font-size="10" fill="#8A93A8">40</text><text x="${cx + 5}" y="${cy - R * 0.7 + 12}" font-size="10" fill="#8A93A8">70</text>
      ${prevVals ? `<polygon points="${poly(prevVals)}" fill="none" stroke="#8A93A8" stroke-width="2" stroke-dasharray="5 4"/>` : ''}
      <polygon class="radar-a" points="${poly(cur)}" fill="rgba(42,120,214,.16)" stroke="#2a78d6" stroke-width="2.4" stroke-linejoin="round"/>
      ${K.map((k, i) => finite(cur[i]) ? (() => { const [x, y] = pt(i, cur[i]); return `<circle cx="${x}" cy="${y}" r="6" fill="#2a78d6" stroke="#fff" stroke-width="2"><title>${esc(domains[k].name)} ${cur[i]}점 · ${B.STATUS[domains[k].status]}</title></circle>`; })() : '').join('')}
      ${K.map(lab).join('')}
    </svg>
    <div class="legend"><span><i style="background:#2a78d6"></i>이번 측정</span>${prevVals ? '<span><i class="dash"></i>직전 측정</span>' : ''}<span><i style="background:#FDEEF1;border:1px solid #F2C9D3"></i>관리 필요 &lt;40</span><span><i style="background:#FFF6E6;border:1px solid #F0D6A4"></i>주의 40–70</span><span><i style="background:#EEF7F2;border:1px solid #C4E3DC"></i>양호 ≥70</span></div>`;
  }

  /* 영역 요약 목록: 점수 막대 + 상태 + 가장 낮은 핵심 지표 */
  function domainList(b) {
    return B.DOMAIN_KEYS.map(k => {
      const d = b.domains[k];
      const worst = b.indicators.filter(i => i.domain === k && i.value !== null && !i.excluded && i.status !== 'na').sort((x, y) => x.score - y.score)[0];
      return `<a class="dl-r" href="#dom-${k}"><span class="dic" style="color:${DCOLOR[k]};background:${DCOLOR[k]}1A">${icon(k)}</span>
        <div class="dl-m"><div class="dl-h"><b>${esc(d.name)}</b><span class="st st-${d.status}">${B.STATUS[d.status]}</span><b class="dl-s">${d.score ?? '—'}</b></div>
          <div class="dl-t"><i style="width:${finite(d.score) ? Math.max(2, d.score) : 0}%;background:${DCOLOR[k]}"></i></div>
          <div class="dl-n">${d.status === 'na' ? '측정 안 됨' : worst && SEV_OF(worst.status) >= 1 ? `가장 낮은 지표 · ${esc(worst.label)} ${esc(B.STATUS[worst.status])}` : '모든 판정 지표가 양호 범위'}</div></div></a>`;
    }).join('');
  }
  const SEV_OF = s => B.SEV[s] ?? -1;

  /* 지표 지도: 판정 지표를 0–100 환산 점수의 막대로 (영역별 묶음) */
  function indicatorMap(b) {
    return `<div class="imap">${B.DOMAIN_KEYS.map(k => {
      const list = b.indicators.filter(i => i.domain === k);
      return `<div class="imap-g"><div class="imap-h"><span class="dic" style="color:${DCOLOR[k]};background:${DCOLOR[k]}1A">${icon(k)}</span><b>${esc(b.domains[k].name)}</b></div>
        ${list.map(i => {
          const has = i.value !== null && !i.excluded, sc = has ? i.score : null;
          return `<div class="imap-r" title="${esc(i.label)}: ${i.value === null ? '측정 안 됨' : `${i.value}${i.unit ? ' ' + i.unit : ''}`} · ${esc(i.range)}">
            <span class="imap-l">${esc(i.label)}${i.primary ? '<em>핵심</em>' : ''}</span>
            <span class="imap-t">${has ? `<i style="width:${Math.max(2, sc)}%;background:${SCOLOR[i.status]}"></i>` : ''}</span>
            <span class="imap-v">${i.value === null ? '<span class="muted">—</span>' : i.excluded ? '<span class="muted">제외</span>' : `${esc(B.STATUS[i.status])}${i.borderline ? '·경계' : ''}`}</span></div>`;
        }).join('')}</div>`;
    }).join('')}</div>
    <div class="legend"><span><i style="background:${SCOLOR.ok}"></i>양호</span><span><i style="background:${SCOLOR.watch}"></i>주의</span><span><i style="background:${SCOLOR.concern}"></i>관리 필요</span><span class="muted">막대 길이 = 지표 점수(0–100, 길수록 좋음) · 마우스를 올리면 실제 값</span></div>`;
  }

  /* 느끼는 나 vs 측정된 나: 같은 0–100(높을수록 좋은 상태) 척도에 자기보고와 측정 점수를 나란히 */
  function selfVsMeasured(r) {
    const c = r.checkin || {}, b = r.battery, phq = b.phq;
    const rows = [
      ['alert', '각성', finite(c.kss) ? Math.round((9 - c.kss) / 8 * 100) : null, '졸림(KSS) 반대로'],
      ['control', '주의 통제', phq && finite(phq.items[6]) ? Math.round((3 - phq.items[6]) / 3 * 100) : null, '최근 2주 집중 곤란 반대로'],
      ['emotion', '정서', finite(c.valence) ? Math.round((c.valence - 1) / 8 * 100) : null, '지금 기분'],
      ['autonomic', '몸의 긴장', finite(c.tension) ? Math.round((5 - c.tension) / 4 * 100) : null, '긴장 반대로'],
    ].map(([k, name, self, how]) => ({ k, name, self, how, meas: b.domains[k].score }));
    const use = rows.filter(x => finite(x.self) || finite(x.meas));
    if (!use.length) return '<p class="muted small">비교할 자기보고 또는 측정이 부족했어요.</p>';
    return `<div class="svm">${use.map(x => {
      const gap = finite(x.self) && finite(x.meas) ? x.meas - x.self : null, lo = gap === null ? 0 : Math.min(x.self, x.meas), hi = gap === null ? 0 : Math.max(x.self, x.meas);
      return `<div class="svm-r"><div class="svm-l"><b>${esc(x.name)}</b><span>${esc(x.how)}</span></div>
        <div class="svm-t" title="자기보고 ${x.self ?? '—'} · 측정 ${x.meas ?? '—'}">${gap !== null ? `<i class="svm-gap" style="left:${lo}%;width:${hi - lo}%"></i>` : ''}
          ${finite(x.self) ? `<i class="svm-s" style="left:${x.self}%"></i>` : ''}${finite(x.meas) ? `<i class="svm-m" style="left:${x.meas}%"></i>` : ''}</div>
        <div class="svm-v${gap !== null && Math.abs(gap) >= 25 ? ' big' : ''}">${gap === null ? '—' : `${gap > 0 ? '+' : ''}${gap}`}</div></div>`;
    }).join('')}<div class="svm-ax"><span>0</span><span>50</span><span>100</span></div></div>
      <div class="legend"><span><i class="hollow"></i>자기보고</span><span><i style="background:#2a78d6"></i>측정</span><span class="muted">오른쪽 = 측정 − 자기보고 (25 이상 차이 강조)</span></div>`;
  }

  /* 추세: 이 기기의 이전 측정 + 이번 측정, 영역별 선 (영역 색 + 끝점 직접 표기) */
  function trendSvg(points) {
    if (points.length < 2) return '';
    const W = 860, H = 220, px = 34, py = 16, iw = W - px - 110, ih = H - py - 34;
    const xs = i => px + (points.length > 1 ? i / (points.length - 1) : 0.5) * iw, ys = v => py + (1 - v / 100) * ih;
    const lines = B.DOMAIN_KEYS.map(k => {
      const pts = points.map((p, i) => finite(p.scores[k]) ? [xs(i), ys(p.scores[k]), p.scores[k]] : null);
      let d = '', pen = false;
      pts.forEach(q => { if (!q) { pen = false; return; } d += `${pen ? 'L' : 'M'}${q[0].toFixed(1)} ${q[1].toFixed(1)} `; pen = true; });
      const last = [...pts].reverse().find(Boolean);
      return `<path d="${d}" fill="none" stroke="${DCOLOR[k]}" stroke-width="2" stroke-linejoin="round"/>
        ${pts.filter(Boolean).map(q => `<circle cx="${q[0]}" cy="${q[1]}" r="4.5" fill="${DCOLOR[k]}" stroke="#fff" stroke-width="2"><title>${esc(B.DOMAINS[k].name)} ${q[2]}점</title></circle>`).join('')}
        ${last ? `<text x="${last[0] + 10}" y="${last[1] + 4}" font-size="11.5" font-weight="700" fill="#273451">${esc(B.DOMAINS[k].name)} ${last[2]}</text>` : ''}`;
    }).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="영역 점수 추세">
      ${[40, 70].map(v => `<line x1="${px}" x2="${px + iw}" y1="${ys(v)}" y2="${ys(v)}" stroke="#E3E8F1" stroke-dasharray="4 4"/><text x="${px - 6}" y="${ys(v) + 4}" text-anchor="end" font-size="10" fill="#8A93A8">${v}</text>`).join('')}
      ${lines}
      ${points.map((p, i) => `<text x="${xs(i)}" y="${H - 6}" text-anchor="middle" font-size="10.5" fill="#647089">${esc(p.label)}</text>`).join('')}</svg>
      <div class="legend">${B.DOMAIN_KEYS.map(k => `<span><i style="background:${DCOLOR[k]}"></i>${esc(B.DOMAINS[k].name)}</span>`).join('')}</div>`;
  }

  /* 점수 구성: 영역 점수를 지표별 기여(점)로 나눈 막대 + 다음 단계까지의 거리 */
  function explainBlock(d) {
    const ex = d.explain || [];
    if (!ex.length || d.score === null) return '';
    const bar = ex.map(e => `<i style="width:${Math.max(0.5, e.points)}%;background:${SCOLOR[e.status]}" title="${esc(e.label)} · 비중 ${e.share}% · ${e.points}점"></i>`).join('');
    return `<div class="xpl"><div class="xpl-h"><b>점수 구성</b><span class="muted small">${d.score}점 = 지표별 (비중 × 지표 점수)의 합 · 비중 = 핵심 2배 × 측정 신뢰도</span></div>
      <div class="xpl-bar">${bar}<span class="xpl-lost" style="width:${Math.max(0, 100 - ex.reduce((s, e) => s + e.points, 0))}%" title="깎인 점수"></span></div>
      <div class="xpl-rows">${ex.map(e => `<div class="xpl-r"><span class="xdot" style="background:${SCOLOR[e.status]}"></span><span class="xl">${esc(e.label)}</span><span class="xs">비중 ${e.share}%</span><span class="xp"><b>${e.points}</b>/${e.share}점</span><span class="xn">${e.next ? esc(e.next.text) : '양호 범위'}</span></div>`).join('')}</div></div>`;
  }

  /* 영역 KPI 타일: 핵심 지표를 큰 숫자로 */
  function kpiTiles(list) {
    const prim = list.filter(i => i.primary);
    return `<div class="kpis">${prim.map(i => `<div class="kpi-t st-b-${i.excluded ? 'na' : i.status}"><span>${esc(i.label)}</span><b>${i.value === null ? '—' : (i.d >= 1 ? i.value.toFixed(i.d) : i.value)}<small>${esc(i.unit || '')}</small></b><em>${i.value === null ? '측정 안 됨' : i.excluded ? '판정 제외' : B.STATUS[i.status] + (i.borderline ? ' · 경계' : '')}</em></div>`).join('')}</div>`;
  }

  /* 측정 맥락: 수면 · 카페인 · 측정 시각 — 점수는 그대로 두고 해석만 돕는다 */
  function contextCard(r, C) {
    const c = r.checkin || {}, I = r.battery.integrated, d = r.measuredAt ? new Date(r.measuredAt) : null;
    const chip = (label, v) => `<div class="ctx-c"><span>${label}</span><b>${esc(v || '응답 없음')}</b></div>`;
    return `<div class="dcard-h"><h3>측정 맥락</h3><span class="muted small">점수는 바꾸지 않고, 결과가 일시적인 상태인지 해석을 돕습니다</span></div>
      <div class="ctx">${chip('어젯밤 수면', B.CONTEXT.sleep[c.sleep])}${chip('마지막 카페인', B.CONTEXT.caffeine[c.caffeine])}${chip('측정 시각', d && !isNaN(d) ? d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' }) : null)}</div>
      ${(I.context || []).map(m => `<div class="mismatch al"><b>${esc(m.title)}</b> ${esc(m.text)}${C.cite(m.refs)}</div>`).join('') || '<p class="muted small" style="margin:8px 0 0">측정 맥락에서 해석을 바꿀 만한 요인은 없었어요.</p>'}`;
  }

  /* AI 총평 요청 본문: 허용된 구조화 지표만 (PHQ 응답·영상·자유 문장은 넣지 않는다) */
  function summaryPayload(r) {
    const b = r.battery, I = b.integrated, c = r.checkin || {};
    const domains = {};
    B.DOMAIN_KEYS.forEach(k => { const d = b.domains[k]; domains[k] = { score: d.score, status: d.status, confidence: d.confidence, tentative: !!d.tentative }; });
    return {
      demo: !!(r.demo || b.sim), mode: r.mode || 'full', type: I.code, primary: I.primary, secondary: I.secondary, domains,
      indicators: b.indicators.filter(i => i.value !== null && !i.excluded && i.status !== 'na').map(i => ({ key: i.key, value: i.value, status: i.status, borderline: !!i.borderline })),
      pathways: I.pathways.map(p => p.key), mismatches: I.mismatches.map(m => m.key),
      checkin: { valence: c.valence ?? null, tension: c.tension ?? null, energy: c.energy ?? null, kss: c.kss ?? null },
      care: b.care.filter(t => t.domain !== 'safety').map(t => t.domain), qc: { grade: b.qc ? b.qc.grade : null, hrRef: b.qc ? b.qc.hrRef || null : null },
      context: { sleep: c.sleep || null, caffeine: c.caffeine || null, hour: r.measuredAt && !isNaN(new Date(r.measuredAt)) ? new Date(r.measuredAt).getHours() : null, notes: (I.context || []).map(m => m.key) },
    };
  }

  /* ---------- 섹션 ---------- */
  function indicatorTable(list, info, C) {
    const rows = list.map(i => `<tr><td><b>${esc(i.label)}</b>${i.primary ? '<span class="core-tag">핵심</span>' : ''}<div class="td-d">${esc(i.desc)}</div></td>
      <td class="num">${valText(i)}</td><td class="rng">${esc(i.range)}</td><td>${judge(i)}</td><td class="refc">${C.cite(i.refs)}</td></tr>`).join('');
    const inf = (info || []).filter(x => x.value !== null).map(x => `<tr class="info"><td>${esc(x.label)}<div class="td-d">참고 지표 · 판정에 쓰지 않음</div></td><td class="num">${esc(x.value)}${x.unit ? ` <small>${esc(x.unit)}</small>` : ''}</td><td class="rng">—</td><td><span class="st st-na">참고</span></td><td class="refc">${C.cite(x.refs)}</td></tr>`).join('');
    return `<div class="tbl-wrap"><table class="itbl"><thead><tr><th>지표</th><th>결과</th><th>참고 범위 (잠정)</th><th>판정</th><th>근거</th></tr></thead><tbody>${rows}${inf}</tbody></table></div>`;
  }

  function methodBox(modKey, b, C, extra = '') {
    const m = B.MODULES[modKey], st = moduleStatus(b, modKey);
    return `<details class="method"><summary>${esc(m.title)} — 검사 방법 · 근거 · 한계 <span class="mstat">${esc(statusLabel(st))}</span></summary>
      <p><b>패러다임</b> ${esc(m.paradigm)}${C.cite(m.refs)}</p>${extra}<p><b>웹캠 구현의 한계</b> ${esc(m.limits)}</p></details>`;
  }

  function domainSection(k, idx, r, C) {
    const b = r.battery, d = b.domains[k], list = b.indicators.filter(i => i.domain === k);
    let body = '';
    const P = B.PROTOCOL;
    if (k === 'alert') {
      body += b.pvt ? `<div class="group-t">PVT-B · 시행별 반응시간</div>${pvtSvg(b.pvt)}${b.pvt.invalid ? `<p class="warn-line">${esc(b.pvt.invalid)}</p>` : ''}` : '';
      body += methodBox('alert', b, C, `<p><b>프로토콜</b> 자극 간격 ${P.pvt.isiMin / 1000}~${P.pvt.isiMax / 1000}초 무작위, 경과 반응 ≥ ${P.pvt.lapseMs}ms, 조기 반응 &lt; ${P.pvt.falseMs}ms 또는 자극 전 입력, 무반응 ${P.pvt.timeoutMs / 1000}초. PERCLOS는 개인별 눈 열림 범위로 정규화한 닫힘 ≥ ${P.perclos.closure * 100}% 시간 비율.${C.cite(['basnerB', 'wierwille'])}</p>`);
    } else if (k === 'control') {
      body += b.saccade ? `<div class="group-t">프로·안티사카드 · 시행 결과</div>${saccadeSvg(b.saccade)}${b.saccade.ok ? '' : `<p class="warn-line">${esc(b.saccade.reason)} — 안티사카드 지표를 판정에서 제외했어요.</p>`}` : '';
      body += b.pursuit && b.pursuit.trace ? `<div class="group-t">원활 추적 · 표적 대비 시선</div>${pursuitSvg(b.pursuit)}${b.pursuit.ok ? '' : `<p class="warn-line">${esc(b.pursuit.reason)} — 추적 지표를 판정에서 제외했어요.</p>`}` : (b.pursuit && !b.pursuit.ok ? `<p class="warn-line">원활 추적: ${esc(b.pursuit.reason)}</p>` : '');
      body += b.sart ? `<div class="group-t">SART · 시행별 반응</div>${sartSvg(b.sart)}${b.sart.invalid ? `<p class="warn-line">${esc(b.sart.invalid)}</p>` : ''}` : '';
      body += methodBox('oculo', b, C, `<p><b>프로토콜</b> 응시점 ${P.saccade.fixMin / 1000}~${P.saccade.fixMax / 1000}초 무작위 후 응시점이 사라지며 표적이 화면 중심에서 폭의 ${Math.round(P.saccade.ecc * 100)}% 위치에 1초 제시(단계 패러다임). 프로사카드 블록 → 연습 → 안티사카드 블록. 원활 추적은 ${P.pursuit.freq}Hz 수평 정현파(진폭 폭의 ${Math.round(P.pursuit.amp * 100)}%), 첫 ${P.pursuit.skipMs / 1000}초 제외 후 최적 지연에서의 이득과 이득 보정 잔차 SD를 계산.${C.cite(['antoniades', 'maruta'])}</p>`);
      body += methodBox('sustain', b, C, `<p><b>프로토콜</b> 숫자 1~9 균등 무작위, 숫자 ${P.sart.digitMs}ms + ${P.sart.mask ? '마스크' : '빈 화면'} ${P.sart.maskMs}ms, 글자 크기 5단계 무작위, 3(약 11%)에서 반응 억제.${C.cite(['robertson'])}</p>`);
    } else if (k === 'emotion') {
      body += `<div class="two"><div><div class="group-t">정서 주의 × 신체 반응 · 2축 유형</div>${quadrantSvg(r)}</div><div class="prof-mini"><div class="group-t">2축 유형</div><b>${esc(r.profile.title)}</b><p>${esc(r.profile.desc)}</p></div></div>`;
      const photo = r.stimMode === 'photo';
      body += methodBox('core', b, C, `<p><b>자극</b> ${photo
        ? `정서 사진 세트 ${esc(r.stimForm || 'A')} — 위협·슬픔·긍정 사진과 내용 유형(인물·동물·장면·사물)이 같은 중립 사진을 짝지어 4초 제시. 사진은 SAM 정서가·각성가 평정과 휘도 정합을 거쳐 선별${C.cite(['sam', 'kurdi', 'marchewka'])}.`
        : '정서 사진 세트가 준비되지 않아 밝기를 맞춘 도식 얼굴과 단어 자극을 3.5초 제시했습니다. 사진 자극보다 정서 강도가 약해 편향이 작게 측정될 수 있습니다.'} 자유 보기 체류 지표는 dot-probe 반응시간보다 재검사 신뢰도가 높게 보고됩니다${C.cite(['waechter'])}.</p>`);
    } else if (k === 'autonomic') {
      body += `<div class="group-t">구간별 원격 심박 (rPPG · POS)</div>${timelineSvg(r)}<p class="disc">기준선은 빈 화면 대신 잔잔한 풍경을 보는 ‘바닐라 기준선’으로 쟀어요${C.cite(['jennings', 'piferi'])}. 공명 호흡은 분당 6회(0.1Hz)${C.cite(['lehrer', 'shaffer'])}.</p>`;
      body += `<p class="disc">MIST 압박 과제 정답 ${r.stressScore ? `${r.stressScore.correct}/${r.stressScore.total}` : '—'}${r.stressScore && r.stressScore.minLimit ? ` · 최단 제한 시간 ${(r.stressScore.minLimit / 1000).toFixed(1)}초` : ''}${C.cite(['dedovic'])} · 안정 시 심박 신호 ${{ good: '양호', fair: '보통', poor: '약함', none: '없음' }[r.hr.baseline.quality]}${C.cite(['pos'])}</p>`;
    }
    return `<section class="card dom" id="dom-${k}" style="--dc:${DCOLOR[k]}">
      <div class="dom-h"><div><div class="kicker" style="color:${DCOLOR[k]}"><span class="dic sm" style="color:${DCOLOR[k]};background:${DCOLOR[k]}1A">${icon(k)}</span> Domain ${idx} · ${esc(d.en)}</div><h2>${esc(d.name)} <span class="net">${esc(d.pro)} · ${esc(d.network)}</span></h2>
        <p class="muted small" style="margin:0">${esc(d.what)}${C.cite(d.refs)}</p></div>
        <div class="dom-ring">${ring(d.score, { size: 96, stroke: 9, color: d.status === 'na' ? '#A3ABBD' : DCOLOR[k], track: '#E6EAF1', text: '#0E1A33', sub: B.STATUS[d.status], title: d.name })}</div></div>
      ${d.status === 'na' ? '<p class="warn-line">이 영역의 검사를 수행하지 않았거나 신호가 부족해 측정되지 않았어요.</p>'
        : `<div class="confbar"><span>측정 신뢰도</span><span class="cb"><i style="width:${Math.round(d.confidence * 100)}%"></i></span><b>${Math.round(d.confidence * 100)}%</b>${d.tentative ? '<span class="st st-watch">잠정</span>' : ''}</div>${(d.notes || []).map(n => `<p class="qnote">${esc(n)}</p>`).join('')}`}
      ${kpiTiles(list)}${explainBlock(d)}${body}
      <details class="method dtl" open><summary>상세 지표 · 참고 범위 · 근거</summary>${indicatorTable(list, b.info[k], C)}</details></section>`;
  }

  /* 최근 2주 자기보고(PHQ) — 진단명 없이 부담 수준과 측정 영역 대조만 보여 준다 */
  function phqSection(b, C) {
    const p = b.phq;
    if (!p) return '<div class="group-t">최근 2주 자기보고</div><p class="muted small">응답하지 않았어요.</p>';
    const K = { both: ['st-watch', '함께 나타남'], self: ['st-na', '자기보고만'], measure: ['st-watch', '측정에서만'], none: ['st-ok', '두드러지지 않음'], na: ['st-na', '측정 안 됨'] };
    const head = p.phq8 !== null
      ? `최근 2주 기분 부담 <b>${esc(p.band)}</b> · PHQ-8 <b>${p.phq8}</b>/24 (선별 PHQ-2 ${p.phq2}/6)`
      : `최근 2주 기분 부담 · 선별 PHQ-2 <b>${p.phq2}</b>/6 · ${p.screen ? '추가 문항 미응답' : '추가 문항 대상 아님 (3점 미만)'}`;
    const rows = b.phqLinks.map(L => `<tr><td><b>${esc(L.label)}</b></td><td class="num">${L.score}<small>/${L.max}</small></td><td>${esc(L.measure)} ${stBadge(L.status)}</td><td><span class="st ${K[L.kind][0]}">${K[L.kind][1]}</span><div class="td-d">${esc(L.text)}</div></td></tr>`).join('');
    return `<div class="group-t">최근 2주 자기보고 ↔ 측정 영역</div>
      <div class="feel">${head}${C.cite(p.phq8 !== null ? ['phq8', 'phqKr', 'levis'] : ['phq2', 'phqKr'])}</div>
      ${p.consult ? '<div class="mismatch" style="background:#FCEEF1;border-color:#F2C9D3;color:#7A2238"><b>상담 권장</b> 최근 2주 기분 부담이 높게 보고됐어요. 아래 케어 플랜 첫 항목의 상담 안내를 확인해 주세요. 이 결과는 진단이 아닙니다.</div>' : ''}
      ${rows ? `<div class="tbl-wrap"><table class="itbl" style="min-width:560px"><thead><tr><th>자기보고 증상</th><th>응답</th><th>연결된 측정</th><th>대조</th></tr></thead><tbody>${rows}</tbody></table></div>`
        : '<p class="muted small">PHQ-2만 응답해 증상별 대조는 하지 않았어요 (PHQ-2가 3점 이상일 때 추가 문항을 묻습니다).</p>'}`;
  }

  /* 케어 로드맵: 측정 → 오늘 → 1~2주 루틴 → 재측정 → 4주 비교 (폐루프) */
  function careRoadmap(b) {
    const main = b.care.find(t => t.domain !== 'safety') || b.care[0];
    const steps = [
      ['오늘', '1분 호흡 바이오피드백으로 같은 카메라에서 바로 몸의 변화를 확인'],
      ['1~2주', `${main.title}: 매일 루틴 ${main.items.length}가지 — 목표 ${main.kpi}`],
      ['2주 후', `재측정 · ${main.remeasure}`],
      ['4주 후', '전체 배터리 재측정 → 이번 결과(개인 기준선)와 영역별 변화 비교'],
    ];
    return `<div class="group-t">케어 로드맵 · 측정–케어–재측정 폐루프</div>
      <ol class="roadmap">${steps.map(([w, t], i) => `<li><span class="rm-n">${i + 1}</span><b>${esc(w)}</b><p>${esc(t)}</p></li>`).join('')}</ol>`;
  }

  /* NL-QC: 우리 보정 원칙과 이번 측정에 실제로 적용된 내역 */
  function qcSection(b, C) {
    const q = b.qc;
    if (!q) return '';
    const G = { A: ['st-ok', '높음'], B: ['st-ok', '양호'], C: ['st-watch', '보통 · 일부 잠정'], D: ['st-concern', '낮음 · 재측정 권장'] };
    const rows = q.steps.map(x => `<tr><td><b>${esc(x.label)}</b></td><td class="num">${x.r === null ? '—' : Math.round(x.r * 100) + '<small>%</small>'}</td><td>${x.note ? esc(x.note) : '<span class="muted">이상 없음</span>'}</td></tr>`).join('');
    const applied = [
      q.latency && q.latency.offset ? `기기 입력 지연 보정 −${q.latency.offset}ms (가장 빠른 10% 반응 ${q.latency.fast10}ms 기준, 경과 반응 기준 ${q.latency.lapseMs}ms)` : null,
      q.sideBalanced ? '정서 자유 보기: 좌우 균형 가중 적용 (개인의 좌우 시선 치우침 상쇄)' : null,
      q.hidden ? `화면이 가려졌던 구간 ${q.hidden.n}회(${q.hidden.sec}초) — 겹친 시행 ${q.hidden.dropped}개를 판정에서 제외` : null,
      q.lightJumps ? `조명 급변 ${q.lightJumps}회 — 그 전후 심박 계산 구간을 제외` : null,
      q.breath && q.breath.clear ? `공명 호흡 순응: 카메라로 잰 호흡 분당 ${q.breath.bpm}회${q.breath.off ? ' → 안내(6회)와 달라 호흡 동조 지표 제외' : ' (안내 6회 따름)'}` : null,
      Object.entries(q.fps || {}).some(([, v]) => v < 20) ? `카메라 프레임이 낮았던 단계: ${Object.entries(q.fps).filter(([, v]) => v < 20).map(([k, v]) => `${STEP_NAMES[k] || ({ neg: '정서 보기' }[k]) || k} ${v}fps`).join(' · ')} — 시선 지표 신뢰도를 낮춤` : null,
      q.hrRef === 'pre' ? '안정 기준선 심박이 약해 압박 과제 직전 안정 구간을 심박 비교 기준으로 사용' : null,
      q.calib && q.calib.affine ? `시선 영점 조정 적용: 보정 오차 ${q.calib.before}% → ${q.calib.errPct}% (${esc(q.calib.model)} 모델${q.calib.control ? ` · 시선 이동 ${q.calib.control.hit}/${q.calib.control.n} 성공` : ''})` : null,
      q.borderline.length ? `측정 오차 범위가 판정 경계에 걸친 지표 ${q.borderline.length}개: ${q.borderline.join(' · ')}` : null,
      q.excluded.length ? `신뢰도가 낮아 판정에서 뺀 지표: ${q.excluded.join(' · ')}` : null,
      q.downgraded.length ? `수렴 원칙으로 ‘관리 필요’를 ‘주의’로 낮춘 영역: ${q.downgraded.map(k => B.DOMAINS[k].name).join(' · ')}` : null,
    ].filter(Boolean);
    return `<div class="group-t">보정 · 품질 관리 (${esc(q.version)})</div>
      <div class="qcgrade"><span class="st ${G[q.grade][0]}">측정 신뢰도 ${esc(q.grade)} · ${G[q.grade][1]}</span><b>${Math.round(q.confidence * 100)}%</b><span class="muted small">측정된 영역의 신뢰도 평균</span></div>
      <ol class="qlist qprin">
        <li><b>신뢰도 가중</b> 지표마다 신호 품질·유효 시행 수로 신뢰도(0~100%)를 매겨 영역 점수에 곱해 반영하고, 30% 미만인 지표는 판정에서 뺍니다${C.cite(['nunnally'])}.</li>
        <li><b>측정 오차 띠</b> 시행 수로 구한 95% 구간이 판정 기준에 걸치면 ‘경계’로 표시합니다 — 적은 시행으로 내린 판정을 과신하지 않기 위해서입니다${C.cite(['jacobson', 'hedge'])}.</li>
        <li><b>수렴 원칙</b> ‘관리 필요’는 서로 다른 지표 2개 이상이 같은 방향을 가리키거나, 경계가 아닌 고신뢰 핵심 지표일 때만 내립니다.</li>
        <li><b>수행 타당도</b> 자극 전 반응이 3분당 20회를 넘는 PVT, 반응해야 할 숫자의 절반 이상을 놓친 SART, 방향을 구분하지 못한 사카드는 판정에서 뺍니다.</li>
        <li><b>개인 기준 보정</b> 심박은 본인 안정 기준선(약하면 과제 직전 안정 구간) 대비, 시선은 추적 보정·영점 조정·블록별 드리프트·개인 시선 진폭·좌우 균형으로, 반응시간은 기기 입력 지연(상한 60ms)으로 보정합니다.</li>
        <li><b>측정 환경 감시</b> 탭 전환 등으로 화면이 가려진 구간의 시행, 조명이 급변한 구간의 심박, 카메라 프레임이 낮은 단계의 시선 지표, 안내한 호흡 속도를 따르지 않은 구간의 호흡 동조 지표를 자동으로 빼거나 신뢰도를 낮춥니다.</li>
        <li><b>다중 영역 심박</b> 이마·양 볼의 심박을 따로 구해 가장 많은 영역이 동의하는 값을 씁니다. 한 영역에만 생긴 움직임 잡음이 심박으로 잘못 잡히지 않게 합니다.</li>
      </ol>
      <div class="tbl-wrap"><table class="itbl" style="min-width:480px"><thead><tr><th>검사</th><th>신뢰도</th><th>비고</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${applied.length ? `<ul class="qlist" style="margin-top:8px">${applied.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`;
  }

  /* ---------- 간편 보고서 (일반인용) ----------
   * 전문 지표 없이 ‘오늘의 마음 날씨’ 비유와 네 장의 카드, 오늘 할 일 3가지로 결과를 전한다.
   * 판정 근거는 전문가 보고서와 같은 영역 점수·상태이며, 문장만 쉬운 말로 바꾼다 */
  const LAY = {
    alert: { ok: '잠이 충분하고 머리가 맑은 상태예요', watch: '조금 피곤한 상태예요. 오늘은 무리하지 마세요', concern: '많이 피곤해요. 지금은 휴식이 가장 먼저예요', icon: '🔋' },
    control: { ok: '하려던 일에 집중을 잘 붙잡고 있어요', watch: '집중이 가끔 흐트러져요', concern: '집중이 자주 흔들려요. 한 번에 한 가지씩 해 보세요', icon: '🎯' },
    emotion: { ok: '불편한 정보에 쉽게 끌려가지 않아요', watch: '걱정거리에 마음이 조금 오래 머물러요', concern: '불편한 생각에 마음이 자주 붙잡혀요', icon: '👀' },
    autonomic: { ok: '긴장해도 몸이 금방 편안해져요', watch: '긴장이 몸에 조금 남아 있어요', concern: '몸이 긴장을 오래 붙잡고 있어요', icon: '💓' },
  };
  const LEVEL = sc => (sc >= 85 ? ['아주 좋음', 5] : sc >= 70 ? ['좋음', 4] : sc >= 55 ? ['보통', 3] : sc >= 40 ? ['조금 지침', 2] : ['챙김 필요', 1]);
  function weatherOf(idx) {
    if (idx === null) return { key: 'na', name: '측정 부족', line: '측정된 영역이 적어 날씨를 정하지 못했어요' };
    if (idx >= 80) return { key: 'sun', name: '맑음', line: '몸도 마음도 컨디션이 좋은 날이에요' };
    if (idx >= 65) return { key: 'partly', name: '구름 조금', line: '대체로 괜찮지만 살짝 챙길 부분이 있어요' };
    if (idx >= 45) return { key: 'cloud', name: '흐림', line: '조금 지쳐 있어요. 오늘은 페이스를 낮춰 보세요' };
    return { key: 'rain', name: '비', line: '많이 지쳐 있어요. 쉬어 가는 날로 정해 주세요' };
  }
  function weatherSvg(k) {
    const sun = (cx, cy, r) => `<g class="w-sun"><circle cx="${cx}" cy="${cy}" r="${r}" fill="#FFC94A"/>${Array.from({ length: 8 }, (_, i) => { const a = i * Math.PI / 4; return `<line x1="${cx + Math.cos(a) * (r + 8)}" y1="${cy + Math.sin(a) * (r + 8)}" x2="${cx + Math.cos(a) * (r + 18)}" y2="${cy + Math.sin(a) * (r + 18)}" stroke="#FFC94A" stroke-width="6" stroke-linecap="round"/>`; }).join('')}</g>`;
    const cloud = (x, y, s, c) => `<g class="w-cloud" transform="translate(${x} ${y}) scale(${s})"><path d="M20 60 a22 22 0 0 1 8-42 a30 30 0 0 1 56 6 a20 20 0 0 1 4 36z" fill="${c}"/></g>`;
    const rain = `<g class="w-rain">${[38, 62, 86].map((x, i) => `<line x1="${x}" y1="${118 + i * 4}" x2="${x - 6}" y2="${136 + i * 4}" stroke="#6FA8E8" stroke-width="5" stroke-linecap="round"/>`).join('')}</g>`;
    const body = k === 'sun' ? sun(80, 80, 34) : k === 'partly' ? sun(96, 62, 26) + cloud(18, 54, 1.05, '#fff') : k === 'cloud' ? cloud(26, 30, 1.1, '#E4E9F2') + cloud(4, 56, 1.0, '#fff') : k === 'rain' ? cloud(14, 30, 1.2, '#D5DCE8') + rain : cloud(20, 40, 1.1, '#E4E9F2');
    return `<svg viewBox="0 0 160 160" class="w-ico" aria-hidden="true">${body}</svg>`;
  }
  function renderSimple(r, ctx = {}) {
    const b = r.battery, I = b.integrated, idx = overallIndex(b), wx = weatherOf(idx), c = r.checkin || {};
    const D = B.DOMAIN_KEYS.map(k => ({ k, d: b.domains[k] }));
    const good = D.filter(x => x.d.status === 'ok'), low = D.filter(x => x.d.status === 'watch' || x.d.status === 'concern').sort((x, y) => x.d.score - y.d.score);
    const main = b.care.find(t => t.domain !== 'safety') || b.care[0];
    const short = t => { const x = t.split(/ — | \(/)[0].replace(/PVT/g, '반응 속도'); return x.length > 64 ? x.slice(0, 63) + '…' : x; };
    const next = new Date(r.measuredAt ? new Date(r.measuredAt).getTime() : Date.now()); next.setDate(next.getDate() + 14);
    const feel = [];
    I.mismatches.filter(m => !m.aligned).forEach(m => {
      if (m.key === 'sleep-unaware') feel.push(['😌 별로 안 졸렸어요', '😪 실제로는 꽤 피곤했어요']);
      if (m.key === 'sleep-subjective') feel.push(['😪 졸렸어요', '🙂 실제 또렷함은 괜찮았어요']);
      if (m.key === 'tension-body-hidden') feel.push(['😌 긴장 안 됐어요', '💓 몸은 꽤 긴장했어요']);
      if (m.key === 'tension-mind-only') feel.push(['😣 많이 긴장됐어요', '😌 몸은 생각보다 차분했어요']);
    });
    const safety = b.care.find(t => t.domain === 'safety');
    return `<div class="sp">
      <section class="sp-hero sp-${wx.key}">
        <div class="sp-hero-t"><span class="sp-k">오늘의 마음 날씨</span><h2>${esc(wx.name)}</h2><p>${esc(wx.line)}</p>
          <div class="sp-score"><b data-count="${idx ?? ''}">${idx ?? '—'}</b><span>/ 100 종합 컨디션</span></div>
          <div class="sp-type">${esc(I.title)}</div></div>
        <div class="sp-hero-v">${weatherSvg(wx.key)}</div>
      </section>
      ${safety ? '<div class="sp-safe"><b>먼저 확인해 주세요</b> 최근 2주 마음이 많이 힘들었다고 답했어요. 혼자 견디지 말고 가까운 정신건강복지센터나 전문가와 이야기해 보세요 · 위기상담 109 (24시간)</div>' : ''}
      ${ctx.ai ? `<section class="sp-card sp-ai"><span class="sp-k">✦ AI가 정리한 한마디</span><p>${esc(ctx.ai)}</p></section>` : ''}
      <section class="sp-grid">${D.map(({ k, d }) => {
        const [lv, n] = d.status === 'na' ? ['측정 안 됨', 0] : LEVEL(d.score);
        return `<div class="sp-dom sp-st-${d.status}" style="--dc:${DCOLOR[k]}">
          <div class="sp-dom-h"><span class="sp-emo">${LAY[k].icon}</span><div><b>${esc(d.name)}</b><small>${esc(d.what)}</small></div></div>
          <div class="sp-meter" aria-label="${esc(lv)}">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= n ? 'on' : ''}" style="animation-delay:${i * 90}ms"></i>`).join('')}</div>
          <div class="sp-lv"><b>${esc(lv)}</b>${d.score === null ? '' : `<span>${d.score}점</span>`}</div>
          <p>${esc(d.status === 'na' ? '이번에는 측정되지 않았어요' : LAY[k][d.status])}</p></div>`;
      }).join('')}</section>
      <section class="sp-two">
        <div class="sp-card"><span class="sp-k">💪 나의 강점</span>${good.length ? `<div class="sp-chips">${good.map(x => `<span>${LAY[x.k].icon} ${esc(x.d.name)}</span>`).join('')}</div>` : '<p class="sp-m">이번에는 뚜렷한 강점 영역이 없었어요. 쉬고 나면 달라질 수 있어요</p>'}</div>
        <div class="sp-card"><span class="sp-k">🌱 오늘 챙길 것</span>${low.length ? `<div class="sp-chips warm">${low.slice(0, 2).map(x => `<span>${LAY[x.k].icon} ${esc(x.d.name)}</span>`).join('')}</div>` : '<p class="sp-m">특별히 챙길 영역이 없어요. 지금 리듬을 지켜 주세요</p>'}</div>
      </section>
      ${feel.length ? `<section class="sp-card"><span class="sp-k">🪞 느낌 vs 실제</span>${feel.map(([a, z]) => `<div class="sp-feel"><span>${esc(a)}</span><i>→</i><span>${esc(z)}</span></div>`).join('')}<p class="sp-m">느낌과 몸의 신호가 다를 때가 있어요. 측정이 알려 주는 쪽도 함께 믿어 주세요</p></section>` : ''}
      <section class="sp-card sp-todo"><span class="sp-k">✅ 오늘부터 해볼 3가지 · ${esc(main.title)}</span>
        <ul>${main.items.slice(0, 3).map((it, i) => `<li><label><input type="checkbox" data-todo="${i}"><span>${esc(short(it.text))}</span></label></li>`).join('')}</ul>
        <p class="sp-m">체크하면 이 기기에 기억해요 · 2주 동안 꾸준히 해 보세요</p></section>
      <section class="sp-card sp-next"><div><span class="sp-k">📅 다음 측정</span><b>${esc(next.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' }))}</b><p class="sp-m">같은 시간대에 다시 재면 ‘평소의 나’와 비교해 변화를 보여 드려요</p></div>
        <button class="btn care" type="button" id="spBio">1분 호흡으로 지금 바로 회복해 보기</button></section>
      <p class="sp-disc">웰니스 참고용 결과이며 의학적 진단이 아니에요 · 자세한 근거는 ‘전문가 보고서’에서 볼 수 있어요</p>
    </div>`;
  }

  function render(r, ctx = {}) {
    const b = r.battery, I = b.integrated, C = citer(), c = r.checkin || {};
    const when = r.measuredAt ? new Date(r.measuredAt) : null;
    const sid = 'NL-' + (r.measuredAt || '').replace(/[^0-9]/g, '').slice(2, 14);
    const ph = r.phaseTimes || {}, pk = Object.keys(ph).filter(k => finite(ph[k].start) && finite(ph[k].end));
    const mins = pk.length ? Math.round((Math.max(...pk.map(k => ph[k].end)) - Math.min(...pk.map(k => ph[k].start))) / 6000) / 10 : null;
    const isSim = b.sim && !Object.values(b.steps).some(s => s.status === 'input');
    const source = isSim
      ? `<span class="badge demo">시뮬레이션 피험자 · ${esc(b.sim.label)} — 실제 측정이 아닙니다</span>`
      : r.demo ? '<span class="badge demo">데모 — 시선은 마우스, 생리 신호는 시뮬레이션</span>'
        : `<span class="badge live">실측 · 얼굴 인식 ${r.quality.faceCoverage}%</span>`;
    const calib = r.quality.gaze;
    const calText = !calib ? '—' : calib.sim ? '시뮬레이션' : calib.mouse ? '데모(마우스)' : calib.errPct == null ? '보정 안 됨' : `오차 ${calib.errPct}% (${{ good: '양호', fair: '보통', poor: '불안정' }[calib.grade]})`;
    const mods = ['alert', 'oculo', 'sustain', 'core'].map(m => `<span class="mchip m-${moduleStatus(b, m).split('+')[0]}">${esc(B.MODULES[m].title)} · ${esc(statusLabel(moduleStatus(b, m)))}</span>`).join('');
    const activePaths = I.pathways.map(p => p.key);
    const chips = [I.primary && `<span class="chip pri">1순위 · ${esc(B.DOMAINS[I.primary].name)}</span>`, I.secondary && `<span class="chip sec">2순위 · ${esc(B.DOMAINS[I.secondary].name)}</span>`].filter(Boolean).join('');
    const idx = overallIndex(b), qc = b.qc || { grade: '—', confidence: 0 };
    const hist = ctx.history || [];
    const prev = hist.find(x => x.scores && !x.demo === !r.demo) || null;
    const safety = b.care.find(t => t.domain === 'safety');

    let h = `
    <nav class="rnav no-print" aria-label="리포트 목차"><a href="#r-top">요약</a><a href="#r-ai">AI 총평</a><a href="#r-dash">대시보드</a>${B.DOMAIN_KEYS.map(k => `<a href="#dom-${k}">${esc(B.DOMAINS[k].name)}</a>`).join('')}<a href="#r-care">케어</a><a href="#r-qc">품질·방법</a></nav>

    <section class="rhero" id="r-top">
      <div class="rhero-top"><div><div class="kicker">NeuroLens Lab · Integrated Self-Regulation Report</div>
        <h1>통합 자기조절 리포트</h1>
        <p class="rhero-sub">또렷함 · 집중 조절 · 마음의 시선 · 몸의 회복력을 하나의 모델로 통합해 해석합니다${C.cite(['posner', 'thayerLane'])}</p></div>${source}</div>
      <div class="rhero-main">
        <div class="rhero-gauge">${ring(idx, { size: 168, stroke: 14, color: idx === null ? '#8A93A8' : idx >= 70 ? '#4FD1A1' : idx >= 40 ? '#F2B544' : '#F27C98', sub: '종합 지수', title: '종합 지수' })}
          <div class="rhero-qc"><span>측정 신뢰도</span><b>${esc(qc.grade)}</b><em>${Math.round((qc.confidence || 0) * 100)}%</em></div></div>
        <div class="rhero-type"><span class="rhero-k">통합 유형</span><div class="rhero-t">${esc(I.title)}</div><div class="chips">${chips}</div>
          <p>${esc(I.lead)}${I.code === 'alert' ? C.cite(['limDinges']) : ''}</p></div>
      </div>
      <div class="rdoms">${B.DOMAIN_KEYS.map(k => { const d = b.domains[k]; return `<a class="rdom" href="#dom-${k}"><div class="rdom-h"><span class="dic" style="color:${DCOLOR[k]};background:rgba(255,255,255,.1)">${icon(k, '#fff')}</span><span>${esc(d.name)}<small>${esc(d.pro)} · ${esc(d.en)}</small></span></div>
        <div class="rdom-b">${ring(d.score, { size: 74, stroke: 7, color: d.status === 'na' ? '#8A93A8' : DCOLOR[k], title: d.name })}<div><span class="st st-${d.status}">${B.STATUS[d.status]}</span>${d.tentative ? '<span class="st st-watch" style="margin-left:4px">잠정</span>' : ''}<div class="rdom-c"><span>신뢰도</span><i><b style="width:${Math.round((d.confidence || 0) * 100)}%"></b></i></div></div></div></a>`; }).join('')}</div>
      <dl class="rmeta"><div><dt>측정 일시</dt><dd>${when ? esc(when.toLocaleString('ko-KR')) : '—'}</dd></div><div><dt>세션 ID</dt><dd>${esc(sid)}</dd></div><div><dt>측정 시간</dt><dd>${mins === null ? '—' : mins + '분'} · ${r.mode === 'quick' ? '빠른 측정' : '표준 측정'}</dd></div><div><dt>시선 보정</dt><dd>${esc(calText)}</dd></div></dl>
    </section>

    <section class="card ai" id="r-ai">
      <div class="ai-h"><span class="ai-ico" aria-hidden="true">✦</span><div><div class="kicker">AI Summary · 종합 총평</div><h2>한눈에 보는 나의 자기조절 상태</h2></div><span class="ai-badge" id="aiModel">AI 해설</span></div>
      ${safety ? '<div class="ai-safe"><b>먼저 확인해 주세요</b> 최근 2주 기분 부담이 높게 보고됐어요. 아래 해설보다 먼저 전문가와 이야기해 보기를 권합니다 · 정신건강 위기상담 109 (24시간)</div>' : ''}
      <div class="ai-body" id="aiBody"><div class="sk"></div><div class="sk"></div><div class="sk"></div><div class="sk s2"></div></div>
      <div class="ai-f"><span>측정 수치만으로 AI가 작성한 참고용 해설이며 의학적 진단이 아닙니다 · 카메라 영상과 최근 2주 기분 응답은 보내지 않았어요</span><button class="sbtn no-print" id="aiRetry" type="button">다시 생성</button></div>
    </section>

    <section id="r-dash">
      <div class="dgrid">
        <div class="card dcard wide"><div class="dcard-h"><h3>영역 프로필</h3><span class="muted small">0–100 · 높을수록 좋음</span></div>
          <div class="split"><div>${radarSvg(b.domains, prev ? prev.scores : null)}</div><div class="dlist">${domainList(b)}</div></div></div>
        <div class="card dcard wide"><div class="dcard-h"><h3>통합 모델 · 활성 연결</h3><span class="muted small">보라 실선 = 이번에 나타난 연결</span></div>
          <div class="split"><div>${frameworkSvg(b.domains, activePaths)}</div><div>
          ${I.pathways.length ? I.pathways.map(p => `<div class="path"><b>${esc(p.title)}</b><p>${esc(p.text)}${C.cite(p.refs)}</p></div>`).join('')
            : I.code !== 'insufficient' ? '<p class="muted small">두 영역 이상이 함께 저하된 이론적 연결 패턴은 나타나지 않았어요. 저하된 영역이 있다면 그 영역만의 문제로 보고 해당 케어에 집중하면 돼요.</p>' : '<p class="muted small">측정된 영역이 부족해 연결을 해석하지 않았어요.</p>'}</div></div></div>
        <div class="card dcard wide"><div class="dcard-h"><h3>지표 지도</h3><span class="muted small">판정 지표 ${b.indicators.length}개 · 영역별</span></div>${indicatorMap(b)}</div>
        <div class="card dcard"><div class="dcard-h"><h3>느끼는 나 vs 측정된 나</h3><span class="muted small">같은 0–100 척도</span></div>${selfVsMeasured(r)}
          <div class="feel">기분 <b>${c.valence ?? '—'}</b>/9 · 긴장 <b>${c.tension ?? '—'}</b>/5 · 에너지 <b>${c.energy ?? '—'}</b>/5 · 졸림(KSS) <b>${c.kss ?? '—'}</b>/9${C.cite(['sam', 'kss'])}</div>
          ${I.mismatches.map(m => `<div class="mismatch${m.aligned ? ' al' : ''}"><b>${esc(m.title)}</b> ${esc(m.text)}${C.cite(m.refs)}</div>`).join('')}</div>
        <div class="card dcard">${phqSection(b, C)}</div>
        <div class="card dcard wide">${contextCard(r, C)}</div>
        ${(() => {
          const pts = [...hist.filter(x => x.scores && !x.demo === !r.demo).slice(0, 5).reverse().map(x => ({ label: new Date(x.at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }), scores: x.scores })),
            { label: '이번', scores: Object.fromEntries(B.DOMAIN_KEYS.map(k => [k, b.domains[k].score])) }];
          return `<div class="card dcard wide"><div class="dcard-h"><h3>변화 추이</h3><span class="muted small">이 기기의 ${r.demo ? '데모·시뮬레이션' : '실측'} 기록</span></div>${pts.length >= 2 ? trendSvg(pts)
            : '<p class="muted small">이번이 첫 측정이에요. 2주·4주 뒤 같은 시간대에 다시 측정하면 ‘평소의 나’ 대비 변화가 여기에 그래프로 나타나요.</p>'}
            ${hist.length ? `<details class="method"><summary>이 기기의 이전 측정 ${hist.length}건</summary><ul class="hist">${hist.map(x => `<li>${esc(new Date(x.at).toLocaleString('ko-KR'))} · ${esc(x.title)}${x.demo ? ' (데모·시뮬레이션)' : ''}${x.scores ? ' · ' + B.DOMAIN_KEYS.map(k => `${esc(B.DOMAINS[k].name)} ${x.scores[k] ?? '—'}`).join(' · ') : ''}</li>`).join('')}</ul></details>` : ''}</div>`;
        })()}
      </div>
    </section>`;

    h += B.DOMAIN_KEYS.map((k, i) => domainSection(k, i + 1, r, C)).join('');

    h += `
    <section class="card care" id="r-care">
      <div class="kicker">Care Plan · 측정에 정렬된 케어</div>
      <h2>우선순위 케어 플랜</h2>
      <p class="muted small" style="margin-top:0">가장 저하된 영역부터 근거 기반 루틴을 배정하고, 같은 검사로 재측정해 효과를 확인하는 폐루프로 설계했어요.</p>
      <div class="tracks">${b.care.map(t => `<div class="track${t.domain === 'safety' ? ' safe' : ''}"><div class="track-h"><span class="rank">${t.domain === 'balanced' ? '유지' : t.domain === 'safety' ? '먼저 확인' : `${t.rank}순위 · ${esc(B.DOMAINS[t.domain].name)}`}</span>${DCOLOR[t.domain] ? `<span class="dic sm" style="color:${DCOLOR[t.domain]};background:${DCOLOR[t.domain]}1A">${icon(t.domain)}</span>` : ''}<b>${esc(t.title)}</b></div>
        <p class="muted small" style="margin:2px 0 8px">${esc(t.goal)}</p>
        <ol>${t.items.map(it => `<li>${esc(it.text)}${C.cite(it.refs)}</li>`).join('')}</ol>
        <div class="kpi"><span><b>목표 지표</b> ${esc(t.kpi)}</span><span><b>재측정</b> ${esc(t.remeasure)}</span></div></div>`).join('')}</div>
      ${careRoadmap(b)}
      <div class="btns no-print">
        <button class="btn care" id="bioStart">지금 1분 호흡 바이오피드백</button>
        <button class="btn ghost" id="again">다시 측정</button>
        <button class="btn ghost" id="printBtn">인쇄 · PDF</button>
        <button class="btn ghost" id="dl">결과 JSON 저장</button>
      </div>
      <div class="effect" id="effect"></div>
      <p class="disc">힘든 마음이 2주 이상 이어지거나 일상이 어렵다면 전문가 상담을 권합니다 · 정신건강 위기상담 109 (24시간)</p>
    </section>

    <section class="card" id="r-qc">
      <h2>평가 방법과 측정 품질</h2>
      <div class="group-t">점수화와 통합 규칙</div>
      <p class="small">각 지표는 문헌 보고 범위를 웹캠·브라우저 환경에 맞춘 기준점으로 0–100점 환산했습니다 (최적 100 · 양호 한계 70 · 주의 한계 40 · 최저 0, 사이는 선형 보간). 영역 점수는 핵심 지표 2배 가중에 지표별 측정 신뢰도를 곱한 가중 평균이며, 경계가 아닌 고신뢰 핵심 지표가 ‘관리 필요’면 평균이 양호여도 ‘주의’로 올립니다. 종합 지수는 측정된 영역 점수를 측정 신뢰도로 가중 평균한 참고용 요약입니다. 1순위 영역은 저하 정도가 가장 큰 영역이되, 각성이 같은 수준으로 저하된 경우 각성을 먼저 둡니다 — 수면 부족이 다른 인지 수행 저하를 설명할 수 있기 때문입니다${C.cite(['limDinges'])}. 영역 간 연결 해석은 주의 통제 이론${C.cite(['act'])}, 신경내장 통합 모델${C.cite(['thayer'])}, 지속 인지 가설${C.cite(['brosschot'])}을 규칙으로 적용했습니다.</p>
      ${qcSection(b, C)}
      <div class="group-t">단계별 수행 상태</div>
      <div class="mchips">${mods}</div>
      <div class="steps" style="margin-top:6px">${Object.keys(STEP_NAMES).filter(k => b.steps[k]).map(k => `<span class="mchip m-${b.steps[k].status}">${STEP_NAMES[k]} · ${STEP_LABEL[b.steps[k].status] || esc(b.steps[k].status)}</span>`).join('') || '<span class="muted small">—</span>'}</div>
      <div class="group-t">신호 품질</div>
      <ul class="qlist">
        <li>얼굴 인식 프레임 ${r.quality.faceCoverage}% · 영상은 브라우저 안에서만 처리 (MediaPipe Face Landmarker 478점)${C.cite(['mediapipe'])}</li>
        <li>원격 심박: POS 알고리즘, 이마·양 볼 다중 영역 융합, 10초 창 스펙트럼 SNR로 품질 판정 — 기준선 ${{ good: '양호', fair: '보통', poor: '약함', none: '측정 안 됨' }[r.hr.baseline.quality]}${C.cite(['pos'])}</li>
        <li>시선: 9점 응시 + 추적 보정 릿지 회귀 · 영점 조정 · ${esc(calText)}${C.cite(['pfeuffer', 'casiez'])}${r.resized ? ' · 측정 중 화면 크기 변경으로 정확도 저하 가능' : ''}${C.cite(['webcamET'])}</li>
      </ul>
      <div class="group-t">해석상 한계</div>
      <p class="small">참고 범위는 파일럿 규준 수립 전 잠정값이며, 연구실 장비(적외선 안구추적기·심전도)로 얻은 문헌 수치와 직접 비교할 수 없습니다. 단일 측정은 수면·카페인·시간대의 영향을 받으므로 같은 조건에서 반복 측정한 개인 기준선 대비 변화로 해석하는 것이 가장 정확합니다. 본 결과는 의학적 진단이 아닌 웰니스 참고 지표입니다.</p>
    </section>`;

    h += `<section class="card refs"><h2>참고문헌</h2><ol>${C.list().map(x => `<li id="ref-${x.n}">${esc(x.text)}</li>`).join('')}</ol>
      <p class="disc">본 결과는 의학적 진단이 아닌 웰니스 참고 지표입니다. 카메라 영상은 저장·전송되지 않았습니다. 결과는 이 브라우저에 남고, AI 총평을 만들 때만 영역 점수와 판정 지표 수치가 AI 서버로 전송됩니다(저장하지 않음). · ${esc(r.version)} · ${esc(b.version)}</p></section>`;
    return h;
  }

  return { render, renderSimple, weatherOf, citer, esc, summaryPayload, overallIndex };
});
