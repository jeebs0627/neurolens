/* NeuroLens 마인드 컨디션 리포트 렌더러 (condition.html 전용).
 * NLBattery.run() 결과를 받아 HTML 문자열을 만든다. 화면 이벤트 연결은 condition.html 이 한다.
 * 본문은 쉬운 말과 그림으로, 전문 지표·방법·참고문헌은 부록에 둔다. 인용 번호는 부록에 처음 나온 순서로 매긴다.
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


  /* 정서 주의 × 신체 반응 2축 유형: 기울어진 판 위의 네 칸 + 떠 있는 위치 표지 (입체 표현) */
  const QUAD = {
    mind: { name: '생각 과몰입형', sub: '생각이 오래 머물러요', c: ['#9C8CF8', '#6A4FD8'] },
    overload: { name: '감정/스트레스 과부하형', sub: '마음과 몸이 함께 긴장', c: ['#F58FA8', '#D2486A'] },
    stable: { name: '마음 평온형', sub: '마음도 몸도 차분해요', c: ['#6FD3A6', '#1E8A7A'] },
    body: { name: '신체 우선 반응형', sub: '몸이 먼저 긴장해요', c: ['#F8CF7A', '#D9961C'] },
  };
  function quadrantSvg(r) {
    const P = { tl: [112, 64], tr: [368, 64], bl: [36, 270], br: [444, 270] }, T = 16;
    const map = (u, v) => {
      const lx = P.tl[0] + (P.bl[0] - P.tl[0]) * v, rx = P.tr[0] + (P.br[0] - P.tr[0]) * v;
      return [lx + (rx - lx) * u, P.tl[1] + (P.bl[1] - P.tl[1]) * v];
    };
    /* 기준선(임계값)이 판의 한가운데 오도록 구간별로 늘린다 — 네 칸이 같은 크기 */
    const half = (v, lo, th, hi) => { const x = Math.max(lo, Math.min(hi, v)); return x < th ? 0.5 * (x - lo) / (th - lo) : 0.5 + 0.5 * (x - th) / (hi - th); };
    const U = v => 0.04 + 0.92 * half(v, -4, N.THRESH.stressHigh, 16), V = v => 0.96 - 0.92 * half(v, -0.3, N.THRESH.biasHigh, 0.3);
    const tu = 0.5, tv = 0.5, g = 0.011;
    const has = r.stressDelta !== null && r.gaze.attentionBias !== null && r.quality.gazeOk;
    const me = r.profile && QUAD[r.profile.code] ? r.profile.code : null;
    const pts = a => a.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ');
    const tile = (k, u0, u1, v0, v1) => {
      const on = me === k, q = QUAD[k], c = map((u0 + u1) / 2, (v0 + v1) / 2);
      const top = [map(u0, v0), map(u1, v0), map(u1, v1), map(u0, v1)];
      const front = v1 > 0.99 ? `<polygon points="${pts([map(u0, v1), map(u1, v1), [map(u1, v1)[0], map(u1, v1)[1] + T], [map(u0, v1)[0], map(u0, v1)[1] + T]])}" fill="${on ? q.c[1] : '#CBD2DF'}" opacity="${on ? 0.85 : 1}"/>` : '';
      return `<g class="q3-t${on ? ' on' : ''}">${front}<polygon points="${pts(top)}" fill="${on ? `url(#q3g-${k})` : '#F4F6FA'}" stroke="${on ? '#fff' : '#E2E7F0'}" stroke-width="1.5"/>
        <polygon points="${pts(top)}" fill="url(#q3gloss)" opacity="${on ? 0.55 : 0.8}"/>
        <text x="${c[0].toFixed(1)}" y="${(c[1] - 2).toFixed(1)}" text-anchor="middle" font-size="${(on ? 14.5 : 13) - (q.name.length > 8 ? 2 : 0)}" font-weight="800" fill="${on ? '#fff' : q.c[1]}">${esc(q.name)}</text>
        <text x="${c[0].toFixed(1)}" y="${(c[1] + 16).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="600" fill="${on ? 'rgba(255,255,255,.88)' : '#8A93A8'}">${esc(q.sub)}</text></g>`;
    };
    const grads = Object.entries(QUAD).map(([k, q]) => `<linearGradient id="q3g-${k}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${q.c[0]}"/><stop offset="1" stop-color="${q.c[1]}"/></linearGradient>`).join('');
    let marker = '';
    if (has) {
      const [x, y] = map(U(r.stressDelta), V(r.gaze.attentionBias)), c = me ? QUAD[me].c[1] : '#2458E6';
      marker = `<g class="q3-me"><ellipse class="q3-pulse" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="18" ry="6" fill="none" stroke="${c}" stroke-width="2"/>
        <ellipse cx="${x.toFixed(1)}" cy="${(y + 1).toFixed(1)}" rx="13" ry="4.5" fill="rgba(14,26,51,.28)"/>
        <line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x.toFixed(1)}" y2="${(y - 30).toFixed(1)}" stroke="#0E1A33" stroke-width="2" stroke-linecap="round" opacity=".55"/>
        <circle cx="${x.toFixed(1)}" cy="${(y - 40).toFixed(1)}" r="13" fill="url(#q3ball)" stroke="#fff" stroke-width="2"/>
        <rect x="${(x + 16).toFixed(1)}" y="${(y - 51).toFixed(1)}" width="30" height="21" rx="10.5" fill="#0E1A33"/>
        <text x="${(x + 31).toFixed(1)}" y="${(y - 36.5).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="800" fill="#fff">나</text></g>`;
    }
    const ang = Math.atan2(P.tl[1] - P.bl[1], P.tl[0] - P.bl[0]) * 180 / Math.PI;
    const lx = (P.tl[0] + P.bl[0]) / 2 - 22, ly = (P.tl[1] + P.bl[1]) / 2;
    return `<svg class="chart q3" viewBox="0 0 480 340" role="img" aria-label="마음의 시선과 몸의 반응으로 본 2축 유형${me ? ': ' + QUAD[me].name : ''}">
      <defs>${grads}<linearGradient id="q3gloss" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>
        <radialGradient id="q3ball" cx="35%" cy="30%" r="70%"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="${me ? QUAD[me].c[0] : '#7FA2FF'}"/><stop offset="1" stop-color="${me ? QUAD[me].c[1] : '#2458E6'}"/></radialGradient>
        <filter id="q3sh" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="14" stdDeviation="12" flood-color="#0E1A33" flood-opacity=".16"/></filter></defs>
      <g filter="url(#q3sh)">${tile('mind', 0, tu - g, 0, tv - g)}${tile('overload', tu + g, 1, 0, tv - g)}${tile('stable', 0, tu - g, tv + g, 1)}${tile('body', tu + g, 1, tv + g, 1)}</g>
      ${marker}
      <text x="240" y="322" text-anchor="middle" font-size="12" font-weight="700" fill="#647089">긴장할 때 몸(심박)의 반응 →</text>
      <text x="${lx}" y="${ly}" text-anchor="middle" font-size="12" font-weight="700" fill="#647089" transform="rotate(${ang.toFixed(1)} ${lx} ${ly})">불편한 정보에 머무는 정도 →</text>
      ${has ? '' : '<text x="240" y="40" text-anchor="middle" font-size="12" fill="#D2486A">한쪽 신호가 부족해 내 위치는 표시하지 않았어요</text>'}
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
    const L = { baseline: ['평소', '#EEF3FF'], pursuit: ['시선', '#F4F6FA'], saccade: ['시선', '#F4F6FA'], neu: ['사진', '#F4F6FA'], neg: ['사진', '#FDEEF1'], pos: ['사진', '#EDF7F1'], pvt: ['반응', '#EEF3FF'], sart: ['집중', '#F1EEFF'], stress: ['압박', '#FFF6E6'], recovery: ['회복 호흡', '#E8F4EE'] };
    const bands = keys.filter(k => L[k]).map(k => {
      const x0 = xs(ph[k].start), w = xs(ph[k].end) - x0;
      return `<rect x="${x0}" y="${py}" width="${w}" height="${ih}" fill="${L[k][1]}"/>${w > 26 ? `<text x="${x0 + w / 2}" y="${H - 8}" text-anchor="middle" font-size="10.5" fill="#647089">${L[k][0]}</text>` : ''}`;
    }).join('');
    let d = '', prev = null;
    tl.filter(w => w.t >= t0 && w.t <= t1).forEach(w => { d += (prev && w.t - prev.t < 3500 ? 'L' : 'M') + xs(w.t).toFixed(1) + ' ' + ys(w.bpm).toFixed(1) + ' '; prev = w; });
    const ticks = [lo, Math.round((lo + hi) / 2), hi].map(v => `<text x="${px - 6}" y="${ys(v) + 4}" text-anchor="end" font-size="10.5" fill="#8A93A8">${v}</text>`).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="측정 구간별 원격 심박 변화">${bands}${ticks}<path d="${d}" fill="none" stroke="#D2486A" stroke-width="2.2" stroke-linejoin="round"/></svg>`;
  }

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

  /* 종합 해설 요청 본문: 허용된 구조화 지표만 (PHQ 응답·영상·자유 문장은 넣지 않는다) */
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
  /* ---------- 쉬운 말 사전 (본문용) — 전문 이름과 수치 기준은 부록에서 보여 준다 ---------- */
  const EASY = {
    pvtLapses: ['반응이 늦어진 횟수', '신호를 보고도 한 박자 늦게 누르거나 놓친 횟수'],
    pvtMedian: ['평소 반응 속도', '신호를 보고 누르기까지 걸린 보통 시간'],
    perclos: ['눈 감김 정도', '눈꺼풀이 거의 감겨 있던 시간의 비율'],
    blinkDur: ['눈 깜빡임 길이', '피곤할수록 깜빡임이 길어져요'],
    pvtFalse: ['성급하게 누른 횟수', '신호가 뜨기 전에 먼저 누른 횟수'],
    antiError: ['반대쪽 보기 실수', '반대쪽을 봐야 할 때 눈이 먼저 따라간 비율'],
    sartCommission: ['멈춰야 할 때 누른 비율', '숫자 3에서 손을 멈추지 못한 비율'],
    sartCv: ['반응 속도의 고르기', '반응 시간이 들쭉날쭉할수록 집중이 흔들려요'],
    sartOmission: ['놓친 반응', '눌러야 할 숫자를 놓친 비율'],
    pursuitGain: ['눈으로 따라가기', '움직이는 점을 눈이 얼마나 잘 따라갔는지'],
    pursuitErr: ['따라갈 때 흔들림', '따라가는 동안 시선이 흔들린 정도'],
    motion: ['머리 움직임', '집중 과제 중 머리가 움직인 양'],
    bias: ['불편한 사진을 본 시간', '불편한 사진과 평범한 사진 중 불편한 쪽을 본 비율'],
    firstNeg: ['첫 시선의 방향', '사진이 뜨자마자 불편한 사진으로 먼저 눈이 간 비율'],
    negHr: ['사진을 볼 때 심박 변화', '불편한 사진을 볼 때 심박이 오른 정도'],
    stressDelta: ['긴장할 때 심박 상승', '시간 압박 속 암산 중 심박이 평소보다 오른 정도'],
    recovery: ['심박 회복', '천천히 호흡한 뒤 심박이 제자리로 돌아온 정도'],
    recoveryResid: ['남아 있는 긴장', '호흡 뒤에도 평소보다 남아 있는 심박'],
    coupling: ['호흡과 심박의 리듬', '천천히 숨 쉴 때 심박이 함께 오르내린 폭'],
  };
  const easyName = e => (EASY[e.key] || [e.label])[0];
  const LAY = {
    alert: { ok: '잠이 충분하고 머리가 맑은 상태예요', watch: '피로가 조금 쌓여 있어요. 오늘은 무리하지 않는 게 좋아요', concern: '많이 지쳐 있어요. 지금은 휴식이 가장 먼저예요' },
    control: { ok: '하려던 일에 집중을 잘 붙잡고 있어요', watch: '집중이 가끔 흐트러지는 상태예요', concern: '집중이 자주 흔들려요. 한 번에 한 가지씩 해 보세요' },
    emotion: { ok: '불편한 정보에 쉽게 끌려가지 않아요', watch: '걱정거리에 마음이 조금 오래 머무는 편이에요', concern: '불편한 생각에 마음이 자주 붙잡혀 있어요' },
    autonomic: { ok: '긴장해도 몸이 금방 편안해져요', watch: '긴장이 몸에 조금 남아 있어요', concern: '몸이 긴장을 오래 붙잡고 있어요' },
  };
  const layOf = (k, d) => d.status === 'na' ? '이번에는 측정되지 않았어요' : LAY[k][d.status];
  const LEVEL = sc => (sc >= 85 ? '아주 좋음' : sc >= 70 ? '좋음' : sc >= 55 ? '보통' : sc >= 40 ? '조금 지침' : '챙김 필요');
  const PATH_EASY = {
    fatigue: ['피로가 집중과 마음까지 끌어내리고 있어요', w => `또렷함이 떨어진 상태에서 ${w}도 함께 낮았어요. 잠이 부족하면 집중하는 힘과 감정을 다루는 힘이 같이 약해지기 때문에, 이번 결과의 일부는 피로 때문일 수 있어요. 푹 쉰 뒤 같은 시간대에 다시 재 보면 원인을 구분할 수 있어요.`],
    act: ['불편한 정보에 끌리면서 멈추는 힘도 약해졌어요', () => '불편한 사진 쪽으로 시선이 쏠리는 경향과, 멈춰야 할 때 멈추지 못하는 경향이 함께 나타났어요. 걱정이 많을 때는 집중을 붙잡는 힘이 약해지고 눈에 띄는 자극에 끌려가기 쉬워요. 마음을 전환하는 연습과 집중 훈련을 함께 하면 효과가 좋아요.'],
    nvi: ['집중력과 몸의 회복력이 함께 낮아요', () => '집중을 조절하는 힘과 긴장을 풀어 주는 몸의 힘은 뇌의 같은 조절 회로를 함께 쓰는 것으로 알려져 있어요. 그래서 천천히 호흡하며 심박을 고르는 연습이 집중력 회복에도 도움이 될 수 있어요.'],
    perseverative: ['곱씹는 생각이 몸의 긴장을 오래 끌고 있어요', () => '불편한 정보에 마음이 오래 머물고, 긴장한 뒤 몸도 늦게 풀렸어요. 걱정을 곱씹는 시간이 길어질수록 몸의 긴장도 함께 길어지기 쉬워요. 생각을 정리하는 연습과 몸을 이완하는 연습을 함께 해 보세요.'],
  };
  const MISMATCH_EASY = {
    'sleep-unaware': '스스로는 크게 졸리지 않다고 느꼈지만, 측정에서는 피로 신호가 뚜렷했어요. 피로는 느낌보다 수행에 먼저 나타나는 경우가 많으니 측정 결과를 기준으로 쉬는 시간을 잡아 보세요.',
    'sleep-subjective': '졸리다고 느꼈지만 실제 또렷함은 괜찮은 편이었어요. 지루함이나 의욕 저하가 졸림처럼 느껴졌을 수 있어요.',
    'sleep-aligned': '느끼는 졸림과 실제 또렷함이 비슷했어요.',
    'tension-body-hidden': '스스로는 긴장이 크지 않다고 느꼈지만, 몸은 압박 상황에 꽤 크게 반응했어요. 몸이 보내는 긴장 신호에 조금 더 귀 기울여 주세요.',
    'tension-mind-only': '긴장을 많이 느꼈지만 몸은 생각보다 차분하게 반응했어요. 몸은 잘 버티고 있다는 뜻이에요.',
    'tension-aligned': '느끼는 긴장과 몸의 반응이 비슷했어요.',
  };
  /* 케어: 결과와 이어지는 실천 항목 (근거 문헌은 부록의 케어 근거에서 확인) */
  const CARE_EASY = {
    alert: { goal: '반응이 늦어지는 순간과 눈 감김이 줄어드는 것', when: '2주 뒤 같은 시간대', items: [
      ['기상 시각 고정하기', '2주 동안 일어나는 시간을 30분 범위 안에서 지켜 보세요. 잠이 오지 않을 때 침대에 오래 누워 있지 않는 것도 중요해요.', '매일 아침'],
      ['10분 짧은 낮잠', '오후 졸림이 심한 날에는 오후 3시 이전에 10분 정도만 눈을 붙여 보세요. 길게 자면 밤잠을 방해할 수 있어요.', '졸린 날 오후'],
      ['중요한 일 전 컨디션 점검', '집중이 필요한 일을 앞두고 3분 반응 점검을 해 보고, 피로가 크면 쉬운 일부터 먼저 하도록 순서를 바꿔 보세요.', '중요한 일 전']] },
    control: { goal: '멈춰야 할 때 멈추는 힘과 고른 반응 속도', when: '4주 뒤', items: [
      ['10분 호흡 집중 훈련', '호흡에 주의를 두고, 생각이 다른 곳으로 가면 알아차린 뒤 다시 호흡으로 돌아오는 연습이에요.', '하루 10분'],
      ['주 3회 유산소 운동', '빠르게 걷기나 가벼운 달리기를 30분 정도 해 보세요. 집중력에 가장 꾸준히 효과가 확인된 생활 습관이에요.', '주 3회'],
      ['25분 한 가지 일만 하기', '알림을 끄고 25분 동안 한 가지 일에만 집중한 뒤 5분 쉬어 보세요.', '일·공부 시간']] },
    emotion: { goal: '불편한 정보에서 마음을 떼어 내는 유연성', when: '2주 뒤', items: [
      ['2분 주의 전환 연습', '불편한 장면이나 생각이 떠오르면 일부러 시선을 다른 대상으로 옮겨 잠시 머무는 연습을 해 보세요.', '하루 2분'],
      ['걱정 시간 정해 두기', '걱정은 하루 15분 정해 둔 시간에 몰아서 하고, 그 밖의 시간에는 “이따가 생각하자”고 미뤄 보세요.', '하루 15분'],
      ['생각에 이름 붙이기', '“나는 지금 ~라는 생각을 하고 있구나”라고 말해 보면 생각과 거리를 두는 데 도움이 돼요.', '걱정이 떠오를 때']] },
    autonomic: { goal: '긴장한 뒤 심박이 빨리 제자리로 돌아오는 것', when: '2주 뒤', items: [
      ['공명 호흡 5분', '5초 들이쉬고 5초 내쉬는 호흡(분당 6회)을 하루 두 번 5분씩 해 보세요. 아래 1분 호흡으로 바로 연습할 수 있어요.', '하루 2번'],
      ['4주 꾸준히 호흡 연습', '꾸준히 하면 숨을 쉴 때 심박이 함께 부드럽게 오르내리는 폭이 커져요. 몸이 긴장을 푸는 힘이 길러진다는 신호예요.', '4주 동안'],
      ['90초 몸 스캔', '긴장된 일정이 끝나면 머리부터 발끝까지 힘이 들어간 곳을 차례로 살피며 풀어 주세요.', '긴장된 일정 직후']] },
    balanced: { goal: '네 영역 모두 지금처럼 양호하게 유지', when: '4주 뒤', items: [
      ['월 1회 같은 시간대 측정', '지금 결과를 나의 기준으로 삼고 한 달에 한 번 같은 시간대에 재 보세요. 작은 변화도 금방 알아챌 수 있어요.', '월 1회'],
      ['긴장된 일정 전후 3분 호흡', '발표나 시험 같은 일정 전후에 천천히 3분 호흡하면 지금의 회복력을 지키는 데 도움이 돼요.', '필요할 때'],
      ['수면 리듬 지키기', '또렷함은 다른 모든 영역의 바탕이에요. 자고 일어나는 시간을 지금처럼 일정하게 유지해 주세요.', '매일']] },
    safety: { goal: '마음의 부담을 혼자 견디지 않기', when: '2~4주 뒤', items: [
      ['전문가와 이야기해 보기', '가까운 정신건강복지센터나 정신건강의학과에서 상담을 받아 보세요. 이 결과지를 함께 보여 주면 도움이 돼요.', '이번 주 안에'],
      ['힘들 땐 바로 연락하기', '힘든 마음이 갑자기 커지면 언제든 정신건강 위기상담 109(24시간)에 전화해 주세요.', '언제든'],
      ['루틴은 무리하지 않게', '상담과 함께 아래 루틴을 할 수 있는 만큼만 천천히 이어 가 보세요.', '여유가 될 때']] },
  };

  /* 예시(시뮬레이션) 리포트의 고정 해설 — 예시를 열 때마다 해설을 새로 만들지 않는다 */
  const SAMPLE_SUMMARY = {
    fatigue: [
      '이번 결과는 ‘피로 회복 우선형’으로 정리됐어요. 마음의 시선과 몸의 회복력은 양호한 범위에 있어서, 불편한 정보에 크게 휘둘리지 않고 긴장한 뒤에도 몸이 비교적 잘 돌아오는 편이에요. 다만 집중의 바탕이 되는 또렷함이 떨어져 있고, 집중 조절도 함께 ‘주의’ 범위로 내려와 있어요.',
      '반응 과제에서 신호를 보고도 한 박자 늦게 누른 순간이 여러 번 있었고, 눈꺼풀이 무겁게 내려와 있던 시간도 길었어요. 이렇게 피로가 쌓이면 멈춰야 할 때 손이 먼저 나가거나 반응 속도가 들쭉날쭉해지기 쉬워요. 이번 집중 조절 결과도 피로의 영향을 함께 받았을 가능성이 커요.',
      '스스로는 그렇게 졸리지 않다고 답했지만, 측정에서는 피로 신호가 분명하게 보였어요. 어젯밤 수면이 짧았던 것도 영향을 줬을 거예요. 피로는 느낌보다 수행에 먼저 나타나는 경우가 많으니, 오늘은 생각보다 지쳐 있다고 여기고 일정을 조금 여유 있게 잡아 보시는 게 좋겠습니다.',
      '가장 먼저 수면 리듬을 되찾는 것을 추천드려요. 앞으로 2주 동안 기상 시각을 30분 범위 안에서 일정하게 지키고, 잠이 오지 않을 때 침대에 오래 누워 있지 않는 것부터 시작해 보면 어떨까요? 오후에 졸림이 심한 날에는 오후 3시 이전에 10분 정도 짧게 눈을 붙이는 것도 도움이 돼요. 집중이 필요한 일은 컨디션이 좋은 오전에 배치하는 편이 좋겠습니다.',
      '그리고 최근 2주 동안 마음이 꽤 힘들었다고 답해 주셨는데, 이 부분은 루틴보다 먼저 챙기셨으면 해요. 가까운 정신건강복지센터나 전문가와 한 번 이야기해 보시길 권해 드려요. 2주 뒤 같은 시간대에 다시 측정해 보면 수면을 정돈한 효과가 또렷함과 집중 조절에 어떻게 나타나는지 확인할 수 있을 거예요.',
    ],
    balanced: [
      '이번 결과는 ‘균형 조절형’이에요. 또렷함, 집중 조절, 마음의 시선, 몸의 회복력 네 영역이 모두 양호한 범위에 있어서 전반적으로 컨디션이 안정적인 상태예요.',
      '반응 과제에서는 신호에 빠르고 고르게 반응했고, 불편한 사진과 평범한 사진에도 시선을 치우치지 않게 나눠 봤어요. 압박 과제에서 심박이 잠시 올랐다가도 천천히 호흡하자 금방 제자리로 돌아왔어요. 긴장을 받아들이고 다시 회복하는 흐름이 잘 작동하고 있다는 뜻이에요.',
      '스스로 느끼는 졸림과 긴장도 측정 결과와 잘 맞았어요. 몸의 신호를 비교적 정확하게 알아차리고 있다는 점도 좋은 강점이에요. 어젯밤 충분히 잔 것이 오늘 결과에 도움이 됐을 거예요.',
      '지금은 새로운 것을 더하기보다 현재의 리듬을 지키는 게 좋겠습니다. 오늘 결과를 나의 기준으로 남겨 두고, 한 달에 한 번 같은 시간대에 다시 측정해 보시길 추천드려요. 발표나 시험처럼 긴장되는 일정 전후에는 3분 정도 천천히 호흡하는 습관을 들여 보는 건 어떨까요?',
      '자고 일어나는 시간을 지금처럼 일정하게 유지하는 것도 잊지 마세요. 또렷함은 다른 모든 영역의 바탕이라서, 수면 리듬만 잘 지켜도 지금의 균형을 오래 이어 갈 수 있어요.',
    ],
    control: [
      '이번 결과는 ‘집중 흔들림형’으로 정리됐어요. 또렷함과 마음의 시선은 양호해서 피로나 걱정이 큰 상태는 아니에요. 다만 하려던 일에 집중을 붙잡아 두는 집중 조절과, 긴장 뒤 몸이 풀리는 몸의 회복력이 함께 ‘주의’ 범위에 있어요.',
      '숫자 과제에서 멈춰야 할 때 손이 먼저 나간 경우가 꽤 있었고, 반응 속도도 들쭉날쭉했어요. 반대쪽을 봐야 하는 과제에서도 눈이 먼저 표적을 따라간 경우가 있었어요. 집중을 조절하는 힘과 긴장을 푸는 몸의 힘은 같은 조절 회로를 함께 쓰는 것으로 알려져 있어서, 두 결과가 함께 나타난 것은 자연스러운 흐름이에요.',
      '느끼는 긴장과 몸의 반응은 대체로 비슷했어요. 측정 1~3시간 전에 카페인을 마셨기 때문에 반응 속도는 평소보다 조금 좋게 나왔을 수 있어요. 다음 측정은 카페인 조건을 맞춰서 비교해 보시는 게 좋겠습니다.',
      '가장 먼저 하루 10분 호흡 집중 훈련을 추천드려요. 호흡에 주의를 두고, 생각이 다른 곳으로 흘러가면 알아차린 뒤 다시 돌아오는 연습이에요. 여기에 일을 할 때 알림을 끄고 25분 동안 한 가지 일만 해 보는 방식을 더해 보면 어떨까요? 주 3회, 30분 정도의 빠른 걷기도 집중력에 꾸준히 도움이 되는 습관이에요.',
      '하루 두 번, 5초 들이쉬고 5초 내쉬는 호흡을 5분씩 해 주시면 몸의 회복력과 집중 조절을 함께 챙길 수 있어요. 4주 정도 이어 간 뒤 다시 측정해서 멈추는 힘과 반응 속도가 얼마나 고르게 바뀌었는지 확인해 보세요.',
    ],
    overload: [
      '이번 결과에서는 또렷함과 집중 조절이 잘 유지되고 있어요. 머리는 맑게 깨어 있고 할 일에 집중하는 힘도 괜찮은 편이에요. 다만 마음의 시선과 몸의 회복력이 함께 ‘관리 필요’ 범위에 있어서, 마음과 몸 모두 긴장이 꽤 쌓여 있는 상태로 보여요.',
      '불편한 사진이 나오면 시선이 먼저 그쪽으로 향하고 오래 머물렀어요. 압박 과제에서는 심박이 크게 올랐고, 호흡을 한 뒤에도 몸이 제자리로 돌아오는 데 시간이 걸렸어요. 걱정을 곱씹는 시간이 길어지면 몸의 긴장도 함께 길어지기 쉬운데, 이번 결과가 바로 그런 흐름을 보여 주고 있어요.',
      '스스로는 긴장이 크지 않다고 느꼈지만 몸은 꽤 크게 반응하고 있었어요. 마음으로는 괜찮다고 생각해도 몸이 먼저 지쳐 갈 수 있으니, 요즘 몸이 보내는 신호에 조금 더 귀 기울여 주시면 좋겠습니다.',
      '최근 2주 동안 마음이 많이 힘들었다고 답해 주셨어요. 이번에는 혼자 해결하려 하기보다 가까운 정신건강복지센터나 전문가와 먼저 이야기해 보시길 권해 드려요. 그와 함께 하루 두 번, 5초 들이쉬고 5초 내쉬는 호흡을 5분씩 해 보는 건 어떨까요? 긴장된 일정이 끝나면 90초 정도 몸 구석구석의 힘을 풀어 주는 것도 도움이 돼요.',
      '걱정은 하루 15분 정해 둔 시간에 몰아서 하고, 그 밖의 시간에는 “나는 지금 이런 생각을 하고 있구나” 하고 한발 떨어져 보는 연습을 추천드려요. 2주 뒤 같은 시간대에 다시 측정하면 몸의 회복과 시선의 변화를 확인할 수 있을 거예요.',
    ],
  };

  /* ---------- 본문 구성 요소 ---------- */
  /* 네 영역 한눈에: 관리 필요 · 주의 · 양호 구간 위에 내 점수 표지 (+ 지난 측정) */
  function zoneBars(b, prev) {
    return `<div class="zb">${B.DOMAIN_KEYS.map(k => {
      const d = b.domains[k], p = prev && finite(prev[k]) ? prev[k] : null;
      return `<a class="zb-r" href="#dom-${k}"><div class="zb-l"><span class="dic" style="color:${DCOLOR[k]};background:${DCOLOR[k]}1A">${icon(k)}</span><div><b>${esc(d.name)}</b><small>${esc(layOf(k, d))}</small></div></div>
        <div class="zb-t"><span class="z1"></span><span class="z2"></span><span class="z3"></span>${p !== null ? `<i class="zb-prev" style="left:${Math.max(0, Math.min(100, p))}%" title="지난 측정 ${p}점"></i>` : ''}${finite(d.score) ? `<i class="zb-pin" style="left:${Math.max(2, Math.min(98, d.score))}%;--c:${DCOLOR[k]}"><b>${d.score}</b></i>` : ''}</div>
        <span class="st st-${d.status}">${B.STATUS[d.status]}</span></a>`;
    }).join('')}<div class="zb-ax"><span></span><div><span>관리 필요</span><span>주의</span><span>양호</span></div><span></span></div></div>
    <div class="legend"><span><i class="pin"></i>이번 측정</span>${prev ? '<span><i class="dash"></i>지난 측정</span>' : ''}<span class="muted">0~100점 · 높을수록 좋아요</span></div>`;
  }

  /* 느끼는 나 vs 측정한 나 */
  function selfVsMeasured(r) {
    const c = r.checkin || {}, b = r.battery, phq = b.phq;
    const rows = [
      ['alert', '졸림 ↔ 또렷함', finite(c.kss) ? Math.round((9 - c.kss) / 8 * 100) : null],
      ['control', '집중 ↔ 집중 조절', phq && finite(phq.items[6]) ? Math.round((3 - phq.items[6]) / 3 * 100) : null],
      ['emotion', '기분 ↔ 마음의 시선', finite(c.valence) ? Math.round((c.valence - 1) / 8 * 100) : null],
      ['autonomic', '긴장 ↔ 몸의 회복력', finite(c.tension) ? Math.round((5 - c.tension) / 4 * 100) : null],
    ].map(([k, name, self]) => ({ k, name, self, meas: b.domains[k].score })).filter(x => finite(x.self) && finite(x.meas));
    if (!rows.length) return '<p class="muted small">비교할 응답이나 측정이 부족했어요.</p>';
    return `<div class="svm">${rows.map(x => {
      const gap = x.meas - x.self, lo = Math.min(x.self, x.meas), hi = Math.max(x.self, x.meas);
      const say = Math.abs(gap) < 25 ? '느낌과 측정이 비슷해요' : gap > 0 ? '느낌보다 측정이 좋았어요' : '느낌보다 측정이 낮았어요';
      return `<div class="svm-r"><div class="svm-l"><b>${esc(x.name)}</b><span class="${Math.abs(gap) >= 25 ? 'big' : ''}">${say}</span></div>
        <div class="svm-t"><i class="svm-gap" style="left:${lo}%;width:${hi - lo}%"></i><i class="svm-s" style="left:${x.self}%" title="내 느낌 ${x.self}"></i><i class="svm-m" style="left:${x.meas}%;background:${DCOLOR[x.k]}" title="측정 ${x.meas}"></i></div></div>`;
    }).join('')}</div>
    <div class="legend"><span><i class="hollow"></i>내가 느낀 상태</span><span><i style="background:#2a78d6;border-radius:50%"></i>측정 결과</span><span class="muted">오른쪽일수록 좋은 상태</span></div>`;
  }

  /* 점수 구성: 항목마다 배정된 몫(막대 길이)을 얼마나 채웠는지(색) — 채운 만큼을 더하면 영역 점수 */
  function scoreBuild(k, d) {
    const ex = (d.explain || []).filter(e => e.share > 0);
    if (!ex.length || d.score === null) return '';
    const max = Math.max(...ex.map(e => e.share));
    const worst = ex.slice().sort((a, z) => (z.share - z.points) - (a.share - a.points))[0], lost = worst.share - worst.points;
    return `<div class="sb"><div class="sb-h"><b>점수 구성</b><p>항목마다 점수에 반영되는 몫이 달라요. 막대가 길수록 비중이 큰 항목이고, 색으로 채워진 만큼이 이번에 얻은 점수예요.</p></div>
      <div class="sb-rows">${ex.map(e => {
        const nm = EASY[e.key] || [e.label, ''];
        return `<div class="sb-r${e === worst && lost >= 3 ? ' worst' : ''}"><div class="sb-l"><b>${esc(nm[0])}</b><small>${esc(nm[1])}</small></div>
          <div class="sb-bar"><span class="sb-slot" style="width:${Math.max(8, e.share / max * 100)}%"><i style="width:${Math.max(0, Math.min(100, e.score))}%;background:${SCOLOR[e.status]}"></i></span></div>
          <div class="sb-v"><b>${Math.round(e.points)}</b><small>/ ${Math.round(e.share)}점</small></div></div>`;
      }).join('')}</div>
      <div class="sb-sum"><span>합계</span><div class="sb-total"><i style="width:${d.score}%;background:${DCOLOR[k]}"></i></div><b>${d.score}<small> / 100점</small></b></div>
      ${lost >= 3 ? `<p class="sb-tip">가장 아쉬운 항목 <b>‘${esc(easyName(worst))}’</b> — 여기서 약 ${Math.round(lost)}점이 빠졌어요.</p>` : '<p class="sb-tip ok">모든 항목이 고르게 채워졌어요.</p>'}</div>`;
  }

  /* 측정 맥락: 수면 · 카페인 · 측정 시각 — 점수는 그대로 두고 해석만 돕는다 */
  function contextCard(r) {
    const c = r.checkin || {}, I = r.battery.integrated, d = r.measuredAt ? new Date(r.measuredAt) : null;
    const chip = (label, v) => `<div class="ctx-c"><span>${label}</span><b>${esc(v || '응답 없음')}</b></div>`;
    return `<div class="dcard-h"><h3>오늘의 측정 환경</h3><span class="muted small">점수는 그대로 두고, 결과를 읽을 때 함께 참고해요</span></div>
      <div class="ctx">${chip('어젯밤 수면', B.CONTEXT.sleep[c.sleep])}${chip('마지막 카페인', B.CONTEXT.caffeine[c.caffeine])}${chip('측정 시각', d && !isNaN(d) ? d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' }) : null)}</div>
      ${(I.context || []).map(m => `<div class="note-l"><b>${esc(m.title.replace(/\s*↔\s*/, ' · '))}</b> ${esc(m.text)}</div>`).join('') || '<p class="muted small" style="margin:8px 0 0">결과 해석에 영향을 줄 만한 요인은 없었어요.</p>'}`;
  }

  /* 영역별 결과 (본문): 점수 · 한 줄 해석 · 점수 구성 · 쉬운 그래프 · 바로 해볼 것 */
  function domainCard(k, idx, r, b) {
    const d = b.domains[k], care = CARE_EASY[k].items[0];
    let extra = '';
    if (k === 'emotion' && d.status !== 'na') {
      extra = `<div class="q3-wrap"><div class="q3-fig">${quadrantSvg(r)}</div><div class="q3-txt"><span class="eyebrow">마음 × 몸 반응 유형</span><b>${esc(r.profile.title)}</b><em>${esc(r.profile.tag)}</em><p>${esc(r.profile.desc)}</p>
        <p class="muted small">불편한 사진에 시선이 머문 정도(세로)와 긴장할 때 심박이 오른 정도(가로)로 네 가지 유형을 나눠요.</p></div></div>`;
    }
    if (k === 'autonomic' && d.status !== 'na') extra = `<div class="group-t">검사하는 동안의 심박 흐름</div>${timelineSvg(r)}<p class="muted small" style="margin:4px 0 0">압박 구간에서 심박이 올랐다가 회복 호흡 구간에서 얼마나 내려오는지가 몸의 회복력을 보여 줘요.</p>`;
    return `<section class="card dom" id="dom-${k}" style="--dc:${DCOLOR[k]}">
      <div class="dom-h"><div><div class="eyebrow" style="color:${DCOLOR[k]}"><span class="dic sm" style="color:${DCOLOR[k]};background:${DCOLOR[k]}1A">${icon(k)}</span> 영역 ${idx}</div><h2>${esc(d.name)}</h2>
        <p class="muted" style="margin:0">${esc(d.what)}</p></div>
        <div class="dom-ring">${ring(d.score, { size: 104, stroke: 10, color: d.status === 'na' ? '#A3ABBD' : DCOLOR[k], track: '#E6EAF1', text: '#0E1A33', sub: B.STATUS[d.status], title: d.name })}</div></div>
      ${d.status === 'na' ? '<p class="warn-line">이 영역은 검사를 하지 않았거나 신호가 부족해 측정되지 않았어요.</p>'
        : `<div class="dom-say st-b-${d.status}">${esc(layOf(k, d))}${d.tentative ? '<span class="st st-watch" style="margin-left:8px">측정 신호가 약해 참고용</span>' : ''}</div>${scoreBuild(k, d)}${extra}
        <div class="dom-try"><span>바로 해 볼 것</span><b>${esc(care[0])}</b><p>${esc(care[1])}</p></div>`}
    </section>`;
  }

  /* 케어 플랜: 결과와 연결한 이유 → 실천 카드(체크) → 목표 · 재측정 */
  function careTrack(t, b) {
    const E = CARE_EASY[t.domain] || CARE_EASY.balanced, D = B.DOMAINS[t.domain];
    let why = '';
    if (t.domain === 'safety') why = '최근 2주 동안 마음이 많이 힘들었다고 답해 주셨어요. 측정 결과보다 이 부분을 먼저 챙기는 것이 좋겠습니다.';
    else if (t.domain === 'balanced') why = '네 영역이 모두 양호했어요. 지금의 균형을 지키는 습관을 권해 드려요.';
    else {
      const d = b.domains[t.domain], ex = (d.explain || []).slice().sort((a, z) => (z.share - z.points) - (a.share - a.points))[0];
      why = `${D.name}이 ${d.score}점(${B.STATUS[d.status]})으로 ${t.rank === 1 ? '가장 먼저' : '두 번째로'} 챙길 영역이에요.${ex && ex.share - ex.points >= 3 ? ` 특히 ‘${easyName(ex)}’ 항목이 점수를 많이 낮췄어요.` : ''}`;
    }
    const tag = t.domain === 'safety' ? '먼저 확인' : t.domain === 'balanced' ? '유지 관리' : `${t.rank}순위`;
    return `<div class="ct${t.domain === 'safety' ? ' safe' : ''}" style="--dc:${DCOLOR[t.domain] || '#167A6B'}">
      <div class="ct-h"><span class="ct-rank">${tag}</span>${DCOLOR[t.domain] ? `<span class="dic sm" style="color:${DCOLOR[t.domain]};background:${DCOLOR[t.domain]}1A">${icon(t.domain)}</span>` : ''}<b>${esc(t.title)}</b></div>
      <p class="ct-why">${esc(why)}</p>
      <ul class="ct-items">${E.items.map(([title, how, when], i) => `<li><label><input type="checkbox" data-todo="${esc(t.domain)}-${i}"><span class="ct-n">${i + 1}</span><span class="ct-b"><b>${esc(title)}</b><em>${esc(when)}</em><small>${esc(how)}</small></span></label></li>`).join('')}</ul>
      <div class="ct-f"><span><b>목표</b> ${esc(E.goal)}</span><span><b>다시 측정</b> ${esc(E.when)}</span></div></div>`;
  }
  function careRoadmap(b) {
    const main = b.care.find(t => t.domain !== 'safety') || b.care[0], E = CARE_EASY[main.domain] || CARE_EASY.balanced;
    const steps = [
      ['오늘', '1분 호흡으로 몸이 어떻게 반응하는지 바로 확인해요'],
      ['1~2주', `${main.title} — 위의 실천 항목을 매일 조금씩 이어 가요`],
      [E.when.replace(' 같은 시간대', ''), '같은 시간대에 다시 측정해 변화를 확인해요'],
      ['그다음', '오늘 결과를 나의 기준으로 삼아 꾸준히 비교해요'],
    ];
    return `<div class="group-t">앞으로의 관리 일정</div><ol class="roadmap">${steps.map(([w, t], i) => `<li><span class="rm-n">${i + 1}</span><b>${esc(w)}</b><p>${esc(t)}</p></li>`).join('')}</ol>`;
  }

  /* ---------- 부록: 전문 지표 · 그래프 · 방법 · 근거 ---------- */
  function domainDetail(k, r, C) {
    const b = r.battery, d = b.domains[k], list = b.indicators.filter(i => i.domain === k), P = B.PROTOCOL;
    let body = '';
    if (k === 'alert') {
      body += b.pvt ? `<div class="group-t">PVT-B · 시행별 반응시간</div>${pvtSvg(b.pvt)}${b.pvt.invalid ? `<p class="warn-line">${esc(b.pvt.invalid)}</p>` : ''}` : '';
      body += methodBox('alert', b, C, `<p><b>프로토콜</b> 자극 간격 ${P.pvt.isiMin / 1000}~${P.pvt.isiMax / 1000}초 무작위, 경과 반응 ≥ ${P.pvt.lapseMs}ms, 조기 반응 &lt; ${P.pvt.falseMs}ms 또는 자극 전 입력, 무반응 ${P.pvt.timeoutMs / 1000}초. PERCLOS는 개인별 눈 열림 범위로 정규화한 닫힘 ≥ ${P.perclos.closure * 100}% 시간 비율.${C.cite(['basnerB', 'wierwille'])}</p>`);
    } else if (k === 'control') {
      body += b.saccade ? `<div class="group-t">프로·안티사카드 · 시행 결과</div>${saccadeSvg(b.saccade)}${b.saccade.ok ? '' : `<p class="warn-line">${esc(b.saccade.reason)} — 안티사카드 지표를 판정에서 제외했어요.</p>`}` : '';
      body += b.pursuit && b.pursuit.trace ? `<div class="group-t">원활 추적 · 표적 대비 시선</div>${pursuitSvg(b.pursuit)}${b.pursuit.ok ? '' : `<p class="warn-line">${esc(b.pursuit.reason)} — 추적 지표를 판정에서 제외했어요.</p>`}` : (b.pursuit && !b.pursuit.ok ? `<p class="warn-line">원활 추적: ${esc(b.pursuit.reason)}</p>` : '');
      body += b.sart ? `<div class="group-t">SART · 시행별 반응</div>${sartSvg(b.sart)}${b.sart.invalid ? `<p class="warn-line">${esc(b.sart.invalid)}</p>` : ''}` : '';
      body += methodBox('oculo', b, C, `<p><b>프로토콜</b> 응시점 ${P.saccade.fixMin / 1000}~${P.saccade.fixMax / 1000}초 무작위 후 응시점이 사라지며 표적이 화면 중심에서 폭의 ${Math.round(P.saccade.ecc * 100)}% 위치에 1초 제시(단계 패러다임). 원활 추적은 ${P.pursuit.freq}Hz 수평 정현파(진폭 폭의 ${Math.round(P.pursuit.amp * 100)}%), 첫 ${P.pursuit.skipMs / 1000}초 제외 후 최적 지연에서의 이득과 잔차 SD를 계산.${C.cite(['antoniades', 'maruta'])}</p>`);
      body += methodBox('sustain', b, C, `<p><b>프로토콜</b> 숫자 1~9 균등 무작위, 숫자 ${P.sart.digitMs}ms + ${P.sart.mask ? '마스크' : '빈 화면'} ${P.sart.maskMs}ms, 글자 크기 5단계 무작위, 3(약 11%)에서 반응 억제.${C.cite(['robertson'])}</p>`);
    } else if (k === 'emotion') {
      const photo = r.stimMode === 'photo';
      body += `<p class="small"><b>2축 유형 판정 기준</b> 부정 자극 주의 편향 ${N.THRESH.biasHigh} 이상 · 압박 심박 반응 ${N.THRESH.stressHigh}bpm 이상을 ‘높음’으로 봅니다.${C.cite(['armstrong', 'kreibig'])}</p>`;
      body += methodBox('core', b, C, `<p><b>자극</b> ${photo
        ? `정서 사진 세트 ${esc(r.stimForm || 'A')} — 위협·슬픔·긍정 사진과, 같은 장면에서 정서 단서만 뺀 중립 사진을 짝지어 4초 제시. ${r.stimStatus === 'provisional' ? '평균 밝기·대비를 맞춘 잠정 세트로, SAM 정서가·각성가 평정은 진행 중이에요' : '사진은 SAM 정서가·각성가 평정과 휘도 정합을 거쳐 선별'}${C.cite(['sam', 'kurdi', 'marchewka'])}.`
        : '정서 사진 세트가 준비되지 않아 밝기를 맞춘 도식 얼굴과 단어 자극을 3.5초 제시했습니다. 사진 자극보다 정서 강도가 약해 편향이 작게 측정될 수 있습니다.'} 자유 보기 체류 지표는 dot-probe 반응시간보다 재검사 신뢰도가 높게 보고됩니다${C.cite(['waechter'])}.</p>`);
    } else if (k === 'autonomic') {
      body += `<p class="small">기준선은 잔잔한 풍경을 보는 ‘바닐라 기준선’으로 쟀어요${C.cite(['jennings', 'piferi'])}. 공명 호흡은 분당 6회(0.1Hz)${C.cite(['lehrer', 'shaffer'])}. MIST 압박 과제 정답 ${r.stressScore ? `${r.stressScore.correct}/${r.stressScore.total}` : '—'}${C.cite(['dedovic'])} · 안정 시 심박 신호 ${{ good: '양호', fair: '보통', poor: '약함', none: '없음' }[r.hr.baseline.quality]}${C.cite(['pos'])}</p>`;
    }
    return `<div class="ax-d"><h4><span class="dic sm" style="color:${DCOLOR[k]};background:${DCOLOR[k]}1A">${icon(k)}</span> ${esc(d.name)} <span class="muted small">${esc(d.pro)} · ${esc(d.network)}${C.cite(d.refs)}</span>${d.status === 'na' ? '' : ` <span class="muted small">· 측정 신뢰도 ${Math.round(d.confidence * 100)}%</span>`}</h4>
      ${(d.notes || []).map(n => `<p class="qnote">${esc(n)}</p>`).join('')}${indicatorTable(list, b.info[k], C)}${body}</div>`;
  }

  function render(r, ctx = {}) {
    const b = r.battery, I = b.integrated, C = citer();
    const when = r.measuredAt ? new Date(r.measuredAt) : null;
    const sid = 'NL-' + (r.measuredAt || '').replace(/[^0-9]/g, '').slice(2, 14);
    const ph = r.phaseTimes || {}, pk = Object.keys(ph).filter(k => finite(ph[k].start) && finite(ph[k].end));
    const mins = pk.length ? Math.round((Math.max(...pk.map(k => ph[k].end)) - Math.min(...pk.map(k => ph[k].start))) / 6000) / 10 : null;
    const isSim = b.sim && !Object.values(b.steps).some(s => s.status === 'input');
    const source = isSim ? '<span class="badge demo">예시 리포트 · 가상의 측정 데이터로 만든 결과예요</span>'
      : r.demo ? '<span class="badge demo">데모 · 카메라 없이 진행한 결과예요</span>' : '<span class="badge live">실제 측정 결과</span>';
    const calib = r.quality.gaze;
    const calText = !calib ? '—' : calib.sim ? '시뮬레이션' : calib.mouse ? '데모(마우스)' : calib.errPct == null ? '보정 안 됨' : `오차 ${calib.errPct}% (${{ good: '양호', fair: '보통', poor: '불안정' }[calib.grade]})`;
    const mods = ['alert', 'oculo', 'sustain', 'core'].map(m => `<span class="mchip m-${moduleStatus(b, m).split('+')[0]}">${esc(B.MODULES[m].title)} · ${esc(statusLabel(moduleStatus(b, m)))}</span>`).join('');
    const idx = overallIndex(b), hist = ctx.history || [];
    const prev = hist.find(x => x.scores && !x.demo === !r.demo) || null;
    const safety = b.care.find(t => t.domain === 'safety');
    const flagged = ['control', 'emotion'].filter(k => B.SEV[b.domains[k].status] >= 1).map(k => b.domains[k].name).join('·');
    const next = new Date(r.measuredAt ? new Date(r.measuredAt).getTime() : Date.now()); next.setDate(next.getDate() + 14);
    const domTiles = B.DOMAIN_KEYS.map(k => {
      const d = b.domains[k];
      return `<a class="rdom" href="#dom-${k}"><div class="rdom-h"><span class="dic" style="color:#fff;background:${DCOLOR[k]}">${icon(k, '#fff')}</span><b>${esc(d.name)}</b></div>
        <div class="rdom-b"><b class="rdom-s">${d.score ?? '—'}</b><span class="st st-${d.status}">${B.STATUS[d.status]}</span></div>
        <div class="rdom-bar"><i style="width:${finite(d.score) ? Math.max(2, d.score) : 0}%;background:${DCOLOR[k]}"></i></div><p>${esc(layOf(k, d))}</p></a>`;
    }).join('');

    let h = `
    <nav class="rnav no-print" aria-label="리포트 목차"><a href="#r-top">요약</a><a href="#r-ai">종합 해설</a><a href="#r-dash">한눈에 보기</a><a href="#dom-alert">영역별 결과</a><a href="#r-care">케어 플랜</a><a href="#r-app">부록</a></nav>

    <section class="rhero" id="r-top">
      <div class="rhero-top"><div><div class="kicker">Mind Condition Report</div><h1>마인드 컨디션 리포트</h1>
        <p class="rhero-sub">${when ? esc(when.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })) : ''}${mins === null ? '' : ` · 측정 ${mins}분`}</p></div>${source}</div>
      <div class="rhero-main">
        <div class="rhero-gauge">${ring(idx, { size: 176, stroke: 14, color: idx === null ? '#8A93A8' : idx >= 70 ? '#4FD1A1' : idx >= 40 ? '#F2B544' : '#F27C98', sub: idx === null ? '' : LEVEL(idx), title: '종합 컨디션' })}<span class="rhero-cap">종합 컨디션</span></div>
        <div class="rhero-type"><span class="rhero-k">오늘의 유형</span><div class="rhero-t">${esc(I.title)}</div>
          <p>${esc(I.lead.replace(/\((각성|주의 통제|정서 주의 편향|자율신경 조절)\)/g, ''))}</p></div>
      </div>
      <div class="rdoms">${domTiles}</div>
    </section>

    <section class="card ai" id="r-ai">
      <div class="ai-h"><span class="ai-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H8l-4 4z"/><path d="M8 9h8M8 12h5"/></svg></span><div><div class="eyebrow">종합 해설</div><h2>결과를 정리하고, 지금 해 볼 것을 알려 드려요</h2></div></div>
      ${safety ? '<div class="ai-safe"><b>먼저 확인해 주세요</b> 최근 2주 동안 마음이 많이 힘들었다고 답해 주셨어요. 혼자 견디지 말고 가까운 정신건강복지센터나 전문가와 이야기해 보세요 · 정신건강 위기상담 109 (24시간)</div>' : ''}
      <div class="ai-body" id="aiBody"><div class="sk"></div><div class="sk"></div><div class="sk"></div><div class="sk s2"></div></div>
      <p class="ai-f">측정 결과를 바탕으로 정리한 참고용 해설이며, 의학적 진단이 아니에요.</p>
    </section>

    <section id="r-dash">
      <div class="dgrid">
        <div class="card dcard wide"><div class="dcard-h"><h3>네 영역 한눈에 보기</h3><span class="muted small">눌러서 영역별 자세한 결과로 이동</span></div>${zoneBars(b, prev ? prev.scores : null)}</div>
        <div class="card dcard"><div class="dcard-h"><h3>느끼는 나 vs 측정한 나</h3></div>${selfVsMeasured(r)}
          ${I.mismatches.filter(m => MISMATCH_EASY[m.key]).map(m => `<div class="note-l${m.aligned ? '' : ' hi'}">${esc(MISMATCH_EASY[m.key])}</div>`).join('')}</div>
        <div class="card dcard"><div class="dcard-h"><h3>영역끼리 이어지는 흐름</h3></div>
          ${I.pathways.length ? I.pathways.map(p => { const E = PATH_EASY[p.key]; return `<div class="path"><b>${esc(E ? E[0] : p.title)}</b><p>${esc(E ? E[1](flagged || '다른 영역') : p.text)}</p></div>`; }).join('')
            : I.code !== 'insufficient' ? '<p class="muted small">두 영역 이상이 함께 낮아지는 흐름은 나타나지 않았어요. 낮은 영역이 있다면 그 영역에 맞춘 케어에 집중하면 충분해요.</p>' : '<p class="muted small">측정된 영역이 적어 영역 사이의 흐름은 살펴보지 않았어요.</p>'}</div>
        <div class="card dcard wide">${contextCard(r)}</div>
        ${(() => {
          const pts = [...hist.filter(x => x.scores && !x.demo === !r.demo).slice(0, 5).reverse().map(x => ({ label: new Date(x.at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }), scores: x.scores })),
            { label: '이번', scores: Object.fromEntries(B.DOMAIN_KEYS.map(k => [k, b.domains[k].score])) }];
          return `<div class="card dcard wide"><div class="dcard-h"><h3>변화 추이</h3><span class="muted small">이 기기에 남은 ${r.demo ? '데모·예시' : ''} 기록</span></div>${pts.length >= 2 ? trendSvg(pts)
            : '<p class="muted small" style="margin:0">이번이 첫 측정이에요. 2주 뒤 같은 시간대에 다시 측정하면 여기에서 변화를 그래프로 볼 수 있어요.</p>'}</div>`;
        })()}
      </div>
    </section>`;

    h += B.DOMAIN_KEYS.map((k, i) => domainCard(k, i + 1, r, b)).join('');

    h += `
    <section class="card care" id="r-care">
      <div class="eyebrow" style="color:var(--care)">Care Plan</div>
      <h2>나를 위한 케어 플랜</h2>
      <p class="muted" style="margin-top:0">결과에서 가장 먼저 챙길 영역부터 실천 방법을 골랐어요. 해 본 항목은 체크해 두면 이 기기에 기억돼요.</p>
      <div class="tracks">${b.care.map(t => careTrack(t, b)).join('')}</div>
      ${careRoadmap(b)}
      <div class="next-m"><div><span class="eyebrow">다음 측정 추천일</span><b>${esc(next.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' }))}</b><p class="muted small" style="margin:2px 0 0">오늘과 같은 시간대에 재면 변화를 가장 정확하게 비교할 수 있어요.</p></div>
        <button class="btn care no-print" id="bioStart" type="button">지금 1분 호흡해 보기</button></div>
      <div class="effect" id="effect"></div>
      <div class="btns no-print">
        <button class="btn ghost" id="again" type="button">다시 측정하기</button>
        <button class="btn ghost" id="printBtn" type="button">인쇄 · PDF 저장</button>
      </div>
      <p class="disc">힘든 마음이 2주 이상 이어지거나 일상이 어렵다면 전문가 상담을 권해요 · 정신건강 위기상담 109 (24시간)</p>
    </section>

    <section class="card appx" id="r-app">
      <div class="eyebrow">Appendix</div>
      <h2>부록 · 더 자세히 보기</h2>
      <p class="muted small" style="margin-top:0">측정 지표의 실제 수치, 검사 방법, 참고 문헌을 모아 두었어요. 궁금한 항목을 펼쳐 보세요.</p>
      <details class="ax"><summary>A. 영역별 상세 지표와 그래프</summary>${B.DOMAIN_KEYS.map(k => domainDetail(k, r, C)).join('')}</details>
      <details class="ax"><summary>B. 최근 2주 마음 상태 응답</summary>${phqSection(b, C)}</details>
      <details class="ax"><summary>C. 결과 해석 기준</summary>
        <p class="small">각 지표는 문헌 보고 범위를 웹캠·브라우저 환경에 맞춘 기준점으로 0–100점 환산했습니다 (최적 100 · 양호 한계 70 · 주의 한계 40 · 최저 0, 사이는 선형 보간). 영역 점수는 핵심 지표 2배 가중에 지표별 측정 신뢰도를 곱한 가중 평균입니다. 종합 컨디션은 측정된 영역 점수를 측정 신뢰도로 가중 평균한 참고용 요약입니다. 1순위 영역은 저하 정도가 가장 큰 영역이되, 각성이 같은 수준으로 저하된 경우 각성을 먼저 둡니다${C.cite(['limDinges'])}. 영역 간 연결 해석에는 주의 통제 이론${C.cite(['act'])}, 신경내장 통합 모델${C.cite(['thayer'])}, 지속 인지 가설${C.cite(['brosschot'])}을 적용했습니다.</p>
        <div class="group-t">케어 근거</div>
        <ul class="qlist">${b.care.map(t => `<li><b>${esc(t.title)}</b> — ${t.items.map(it => esc(it.text) + C.cite(it.refs)).join(' / ')}</li>`).join('')}</ul></details>
      <details class="ax"><summary>D. 측정 품질과 방법</summary>${qcSection(b, C)}
        <div class="group-t">단계별 수행 상태</div><div class="mchips">${mods}</div>
        <div class="steps" style="margin-top:6px">${Object.keys(STEP_NAMES).filter(k => b.steps[k]).map(k => `<span class="mchip m-${b.steps[k].status}">${STEP_NAMES[k]} · ${STEP_LABEL[b.steps[k].status] || esc(b.steps[k].status)}</span>`).join('') || '<span class="muted small">—</span>'}</div>
        <div class="group-t">신호 품질</div>
        <ul class="qlist">
          <li>얼굴 인식 프레임 ${r.quality.faceCoverage}% · 영상은 브라우저 안에서만 처리${C.cite(['mediapipe'])}</li>
          <li>원격 심박: 이마·양 볼 다중 영역 융합, 10초 창 신호 대 잡음비로 품질 판정 — 기준선 ${{ good: '양호', fair: '보통', poor: '약함', none: '측정 안 됨' }[r.hr.baseline.quality]}${C.cite(['pos'])}</li>
          <li>시선: 9점 응시 + 추적 보정 · ${esc(calText)}${C.cite(['pfeuffer', 'casiez'])}${r.resized ? ' · 측정 중 화면 크기 변경으로 정확도 저하 가능' : ''}${C.cite(['webcamET'])}</li>
        </ul>
        <div class="group-t">해석상 한계</div>
        <p class="small">참고 범위는 규준 수립 전 잠정값이며, 연구실 장비(적외선 안구추적기·심전도)로 얻은 문헌 수치와 직접 비교할 수 없습니다. 단일 측정은 수면·카페인·시간대의 영향을 받으므로 같은 조건에서 반복 측정한 개인 기준선 대비 변화로 해석하는 것이 가장 정확합니다.</p></details>
      <details class="ax"><summary>E. 측정 정보</summary>
        <dl class="ainfo"><div><dt>측정 일시</dt><dd>${when ? esc(when.toLocaleString('ko-KR')) : '—'}</dd></div><div><dt>측정 번호</dt><dd>${esc(sid)}</dd></div><div><dt>측정 방식</dt><dd>${r.mode === 'quick' ? '표준 측정' : '정밀 측정'}${mins === null ? '' : ` · ${mins}분`}</dd></div><div><dt>시선 보정</dt><dd>${esc(calText)}</dd></div></dl>
        ${hist.length ? `<div class="group-t">이 기기의 이전 측정 ${hist.length}건</div><ul class="hist">${hist.map(x => `<li>${esc(new Date(x.at).toLocaleString('ko-KR'))} · ${esc(x.title)}${x.demo ? ' (데모·예시)' : ''}${x.scores ? ' · ' + B.DOMAIN_KEYS.map(k => `${esc(B.DOMAINS[k].name)} ${x.scores[k] ?? '—'}`).join(' · ') : ''}</li>`).join('')}</ul>` : ''}
        <button class="btn ghost no-print" id="dl" type="button" style="margin-top:12px">결과 데이터 내려받기</button></details>
      <details class="ax"><summary>F. 참고 문헌</summary><ol class="refs">${C.list().map(x => `<li id="ref-${x.n}">${esc(x.text)}</li>`).join('')}</ol></details>
      <p class="disc">본 결과는 의학적 진단이 아닌 웰니스 참고 지표입니다. 카메라 영상은 저장·전송되지 않았습니다.</p>
    </section>`;
    return h;
  }

  return { render, citer, esc, summaryPayload, overallIndex, SAMPLE_SUMMARY };
});
