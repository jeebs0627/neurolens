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
  const valText = i => i.value === null ? '—' : `${i.d >= 1 ? i.value.toFixed(i.d) : i.value}${i.unit ? ` <small>${esc(i.unit)}</small>` : ''}`;

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
      : `<circle cx="${xs(i).toFixed(1)}" cy="${ys(rt).toFixed(1)}" r="3.4" fill="${rt >= B.PROTOCOL.pvt.lapseMs ? '#C98A12' : '#2458E6'}" opacity=".85"/>`).join('');
    const yl = [200, 355, 600, 1000].map(v => `<text x="${px - 6}" y="${ys(v) + 4}" text-anchor="end" font-size="10.5" fill="#8A93A8">${v}</text>`).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="PVT 시행별 반응시간">
      <line x1="${px}" x2="${px + iw}" y1="${ys(355)}" y2="${ys(355)}" stroke="#C98A12" stroke-dasharray="4 4"/>
      <text x="${px + iw}" y="${ys(355) - 5}" text-anchor="end" font-size="10.5" fill="#8A5508">경과 반응 기준 355ms</text>
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

  /* ---------- 섹션 ---------- */
  function indicatorTable(list, info, C) {
    const rows = list.map(i => `<tr><td><b>${esc(i.label)}</b>${i.primary ? '<span class="core-tag">핵심</span>' : ''}<div class="td-d">${esc(i.desc)}</div></td>
      <td class="num">${valText(i)}</td><td class="rng">${esc(i.range)}</td><td>${stBadge(i.status)}</td><td class="refc">${C.cite(i.refs)}</td></tr>`).join('');
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
      body += b.pvt ? `<div class="group-t">PVT-B · 시행별 반응시간</div>${pvtSvg(b.pvt)}` : '';
      body += methodBox('alert', b, C, `<p><b>프로토콜</b> 자극 간격 ${P.pvt.isiMin / 1000}~${P.pvt.isiMax / 1000}초 무작위, 경과 반응 ≥ ${P.pvt.lapseMs}ms, 조기 반응 &lt; ${P.pvt.falseMs}ms 또는 자극 전 입력, 무반응 ${P.pvt.timeoutMs / 1000}초. PERCLOS는 개인별 눈 열림 범위로 정규화한 닫힘 ≥ ${P.perclos.closure * 100}% 시간 비율.${C.cite(['basnerB', 'wierwille'])}</p>`);
    } else if (k === 'control') {
      body += b.saccade ? `<div class="group-t">프로·안티사카드 · 시행 결과</div>${saccadeSvg(b.saccade)}${b.saccade.ok ? '' : `<p class="warn-line">${esc(b.saccade.reason)} — 안티사카드 지표를 판정에서 제외했어요.</p>`}` : '';
      body += b.pursuit && b.pursuit.trace ? `<div class="group-t">원활 추적 · 표적 대비 시선</div>${pursuitSvg(b.pursuit)}${b.pursuit.ok ? '' : `<p class="warn-line">${esc(b.pursuit.reason)} — 추적 지표를 판정에서 제외했어요.</p>`}` : (b.pursuit && !b.pursuit.ok ? `<p class="warn-line">원활 추적: ${esc(b.pursuit.reason)}</p>` : '');
      body += b.sart ? `<div class="group-t">SART · 시행별 반응</div>${sartSvg(b.sart)}` : '';
      body += methodBox('oculo', b, C, `<p><b>프로토콜</b> 응시점 ${P.saccade.fixMin / 1000}~${P.saccade.fixMax / 1000}초 무작위 후 응시점이 사라지며 표적이 화면 중심에서 폭의 ${Math.round(P.saccade.ecc * 100)}% 위치에 1초 제시(단계 패러다임). 프로사카드 블록 → 연습 → 안티사카드 블록. 원활 추적은 ${P.pursuit.freq}Hz 수평 정현파(진폭 폭의 ${Math.round(P.pursuit.amp * 100)}%), 첫 ${P.pursuit.skipMs / 1000}초 제외 후 최적 지연에서의 이득과 이득 보정 잔차 SD를 계산.${C.cite(['antoniades', 'maruta'])}</p>`);
      body += methodBox('sustain', b, C, `<p><b>프로토콜</b> 숫자 1~9 균등 무작위, 숫자 ${P.sart.digitMs}ms + 마스크 ${P.sart.maskMs}ms, 글자 크기 5단계 무작위, 3(약 11%)에서 반응 억제.${C.cite(['robertson'])}</p>`);
    } else if (k === 'emotion') {
      body += `<div class="two"><div><div class="group-t">정서 주의 × 신체 반응 · 2축 유형</div>${quadrantSvg(r)}</div><div class="prof-mini"><div class="group-t">2축 유형</div><b>${esc(r.profile.title)}</b><p>${esc(r.profile.desc)}</p></div></div>`;
      const photo = r.stimMode === 'photo';
      body += methodBox('core', b, C, `<p><b>자극</b> ${photo
        ? `정서 사진 세트 ${esc(r.stimForm || 'A')} — 위협·슬픔·긍정 사진과 내용 유형(인물·동물·장면·사물)이 같은 중립 사진을 짝지어 4초 제시. 사진은 SAM 정서가·각성가 평정과 휘도 정합을 거쳐 선별${C.cite(['sam', 'kurdi', 'marchewka'])}.`
        : '정서 사진 세트가 준비되지 않아 밝기를 맞춘 도식 얼굴과 단어 자극을 3.5초 제시했습니다. 사진 자극보다 정서 강도가 약해 편향이 작게 측정될 수 있습니다.'} 자유 보기 체류 지표는 dot-probe 반응시간보다 재검사 신뢰도가 높게 보고됩니다${C.cite(['waechter'])}.</p>`);
    } else if (k === 'autonomic') {
      body += `<div class="group-t">구간별 원격 심박 (rPPG · POS)</div>${timelineSvg(r)}`;
      body += `<p class="disc">압박 과제 정답 ${r.stressScore ? `${r.stressScore.correct}/${r.stressScore.total}` : '—'} · 안정 시 심박 신호 ${{ good: '양호', fair: '보통', poor: '약함', none: '없음' }[r.hr.baseline.quality]}${C.cite(['pos'])}</p>`;
    }
    return `<section class="card dom" id="dom-${k}">
      <div class="dom-h"><div><div class="kicker">Domain ${idx} · ${esc(d.en)}</div><h2>${esc(d.name)} <span class="net">${esc(d.network)}</span></h2>
        <p class="muted small" style="margin:0">${esc(d.what)}${C.cite(d.refs)}</p></div>
        <div class="dom-score st-${d.status}"><b>${d.score === null ? '—' : d.score}</b><span>${B.STATUS[d.status]}</span></div></div>
      ${d.status === 'na' ? '<p class="warn-line">이 영역의 검사를 수행하지 않았거나 신호가 부족해 측정되지 않았어요.</p>' : ''}
      ${indicatorTable(list, b.info[k], C)}${body}</section>`;
  }

  function render(r, ctx = {}) {
    const b = r.battery, I = b.integrated, C = citer(), c = r.checkin || {};
    const when = r.measuredAt ? new Date(r.measuredAt) : null;
    const sid = 'NL-' + (r.measuredAt || '').replace(/[^0-9]/g, '').slice(2, 14);
    const ph = r.phaseTimes || {}, pk = Object.keys(ph).filter(k => finite(ph[k].start) && finite(ph[k].end));
    const mins = pk.length ? Math.round((Math.max(...pk.map(k => ph[k].end)) - Math.min(...pk.map(k => ph[k].start))) / 6000) / 10 : null;
    const source = b.sim && !Object.values(b.steps).some(s => s.status === 'input')
      ? `<span class="badge demo">시뮬레이션 피험자 · ${esc(b.sim.label)} — 실제 측정이 아닙니다</span>`
      : r.demo ? '<span class="badge demo">데모 — 시선은 마우스, 생리 신호는 시뮬레이션</span>'
        : `<span class="badge live">실측 · 얼굴 인식 ${r.quality.faceCoverage}%</span>`;
    const calib = r.quality.gaze;
    const calText = !calib ? '—' : calib.sim ? '시뮬레이션' : calib.mouse ? '데모(마우스)' : calib.errPct == null ? '보정 안 됨' : `오차 ${calib.errPct}% (${{ good: '양호', fair: '보통', poor: '불안정' }[calib.grade]})`;
    const mods = ['alert', 'oculo', 'sustain', 'core'].map(m => `<span class="mchip m-${moduleStatus(b, m).split('+')[0]}">${esc(B.MODULES[m].title)} · ${esc(statusLabel(moduleStatus(b, m)))}</span>`).join('');
    const activePaths = I.pathways.map(p => p.key);
    const chips = [I.primary && `<span class="chip pri">1순위 · ${esc(B.DOMAINS[I.primary].name)}</span>`, I.secondary && `<span class="chip sec">2순위 · ${esc(B.DOMAINS[I.secondary].name)}</span>`].filter(Boolean).join('');

    let h = `
    <div class="card rpt-head">
      <div class="rh-top"><div><div class="kicker">NeuroLens Lab · Integrated Self-Regulation Assessment</div>
        <h1 class="rh-t">통합 자기조절 평가 리포트</h1>
        <p class="muted" style="margin:0">각성 · 주의 통제 · 정서 주의 · 자율신경 조절을 하나의 모델로 통합해 해석합니다${C.cite(['posner', 'thayerLane'])}</p></div>${source}</div>
      <dl class="meta">
        <div><dt>측정 일시</dt><dd>${when ? esc(when.toLocaleString('ko-KR')) : '—'}</dd></div>
        <div><dt>세션 ID</dt><dd>${esc(sid)}</dd></div>
        <div><dt>측정 시간</dt><dd>${mins === null ? '—' : mins + '분'} · ${r.mode === 'quick' ? '빠른 측정' : '표준 측정'}</dd></div>
        <div><dt>시선 보정</dt><dd>${esc(calText)}</dd></div>
      </dl>
      <div class="mchips">${mods}</div>
    </div>

    <div class="card sum">
      <div class="kicker">종합 소견 · Integrated Interpretation</div>
      <div class="sum-grid">
        <div>
          <div class="ptype">${esc(I.title)}</div>
          <div class="chips">${chips}</div>
          <p class="lead" style="margin:10px 0 16px">${esc(I.lead)}${I.code === 'alert' ? C.cite(['limDinges']) : ''}</p>
          ${domainBars(b.domains)}
        </div>
        <div><div class="group-t" style="margin-top:0">통합 모델 — 활성 연결 강조</div>${frameworkSvg(b.domains, activePaths)}</div>
      </div>
      ${I.pathways.length ? `<div class="group-t">영역 간 연결 해석</div>${I.pathways.map(p => `<div class="path"><b>${esc(p.title)}</b><p>${esc(p.text)}${C.cite(p.refs)}</p></div>`).join('')}`
        : I.code !== 'insufficient' ? '<p class="muted small">두 영역 이상이 함께 저하된 이론적 연결 패턴은 나타나지 않았어요.</p>' : ''}
      <div class="group-t">자기보고 ↔ 측정 대조</div>
      <div class="feel">기분 <b>${c.valence ?? '—'}</b>/9 · 긴장 <b>${c.tension ?? '—'}</b>/5 · 에너지 <b>${c.energy ?? '—'}</b>/5 · 졸림(KSS) <b>${c.kss ?? '—'}</b>/9${C.cite(['sam', 'kss'])}</div>
      ${I.mismatches.length ? I.mismatches.map(m => `<div class="mismatch${m.aligned ? ' al' : ''}"><b>${esc(m.title)}</b> ${esc(m.text)}${C.cite(m.refs)}</div>`).join('') : '<p class="muted small">비교할 자기보고 또는 측정이 부족했어요.</p>'}
    </div>`;

    h += B.DOMAIN_KEYS.map((k, i) => domainSection(k, i + 1, r, C)).join('');

    h += `
    <div class="card care">
      <div class="kicker">Care Plan · 측정에 정렬된 케어</div>
      <h2>우선순위 케어 플랜</h2>
      <p class="muted small" style="margin-top:0">가장 저하된 영역부터 근거 기반 루틴을 배정하고, 같은 검사로 재측정해 효과를 확인하는 폐루프로 설계했어요.</p>
      ${b.care.map(t => `<div class="track"><div class="track-h"><span class="rank">${t.domain === 'balanced' ? '유지' : `${t.rank}순위 · ${esc(B.DOMAINS[t.domain].name)}`}</span><b>${esc(t.title)}</b></div>
        <p class="muted small" style="margin:2px 0 8px">${esc(t.goal)}</p>
        <ol>${t.items.map(it => `<li>${esc(it.text)}${C.cite(it.refs)}</li>`).join('')}</ol>
        <div class="kpi"><span><b>목표 지표</b> ${esc(t.kpi)}</span><span><b>재측정</b> ${esc(t.remeasure)}</span></div></div>`).join('')}
      <div class="btns no-print">
        <button class="btn care" id="bioStart">지금 1분 호흡 바이오피드백</button>
        <button class="btn ghost" id="again">다시 측정</button>
        <button class="btn ghost" id="printBtn">인쇄 · PDF</button>
        <button class="btn ghost" id="dl">결과 JSON 저장</button>
      </div>
      <div class="effect" id="effect"></div>
      <p class="disc">힘든 마음이 2주 이상 이어지거나 일상이 어렵다면 전문가 상담을 권합니다 · 정신건강 위기상담 109 (24시간)</p>
    </div>

    <div class="card">
      <h2>평가 방법과 측정 품질</h2>
      <div class="group-t">점수화와 통합 규칙</div>
      <p class="small">각 지표는 문헌 보고 범위를 웹캠·브라우저 환경에 맞춘 기준점으로 0–100점 환산했습니다 (최적 100 · 양호 한계 70 · 주의 한계 40 · 최저 0, 사이는 선형 보간). 영역 점수는 핵심 지표에 2배 가중을 둔 평균이며, 핵심 지표 하나라도 ‘관리 필요’면 평균이 양호여도 ‘주의’로 올립니다. 1순위 영역은 저하 정도가 가장 큰 영역이되, 각성이 같은 수준으로 저하된 경우 각성을 먼저 둡니다 — 수면 부족이 다른 인지 수행 저하를 설명할 수 있기 때문입니다${C.cite(['limDinges'])}. 영역 간 연결 해석은 주의 통제 이론${C.cite(['act'])}, 신경내장 통합 모델${C.cite(['thayer'])}, 지속 인지 가설${C.cite(['brosschot'])}을 규칙으로 적용했습니다.</p>
      <div class="group-t">단계별 수행 상태</div>
      <div class="steps">${Object.keys(STEP_NAMES).filter(k => b.steps[k]).map(k => `<span class="mchip m-${b.steps[k].status}">${STEP_NAMES[k]} · ${STEP_LABEL[b.steps[k].status] || esc(b.steps[k].status)}</span>`).join('') || '<span class="muted small">—</span>'}</div>
      <div class="group-t">신호 품질</div>
      <ul class="qlist">
        <li>얼굴 인식 프레임 ${r.quality.faceCoverage}% · 영상은 브라우저 안에서만 처리 (MediaPipe Face Landmarker 478점)${C.cite(['mediapipe'])}</li>
        <li>원격 심박: POS 알고리즘, 10초 창 스펙트럼 SNR로 품질 판정 — 기준선 ${{ good: '양호', fair: '보통', poor: '약함', none: '측정 안 됨' }[r.hr.baseline.quality]}${C.cite(['pos'])}</li>
        <li>시선: 9점 보정 릿지 회귀 · ${esc(calText)}${r.resized ? ' · 측정 중 화면 크기 변경으로 정확도 저하 가능' : ''}${C.cite(['webcamET'])}</li>
      </ul>
      <div class="group-t">해석상 한계</div>
      <p class="small">참고 범위는 파일럿 규준 수립 전 잠정값이며, 연구실 장비(적외선 안구추적기·심전도)로 얻은 문헌 수치와 직접 비교할 수 없습니다. 단일 측정은 수면·카페인·시간대의 영향을 받으므로 같은 조건에서 반복 측정한 개인 기준선 대비 변화로 해석하는 것이 가장 정확합니다. 본 결과는 의학적 진단이 아닌 웰니스 참고 지표입니다.</p>
    </div>`;

    const hist = ctx.history || [];
    h += `<div class="card"><h3>이 기기의 이전 측정</h3>${hist.length ? `<ul class="hist">${hist.map(x => `<li>${esc(new Date(x.at).toLocaleString('ko-KR'))} · ${esc(x.title)}${x.demo ? ' (데모·시뮬레이션)' : ''}${x.scores ? ' · ' + B.DOMAIN_KEYS.map(k => `${esc(B.DOMAINS[k].name)} ${x.scores[k] ?? '—'}`).join(' · ') : ''}</li>`).join('')}</ul>` : '<p class="muted small">이번이 첫 측정이에요. 반복 측정하면 집단 평균이 아니라 ‘평소의 나’와 비교할 수 있어요.</p>'}</div>`;

    h += `<div class="card refs"><h2>참고문헌</h2><ol>${C.list().map(x => `<li id="ref-${x.n}">${esc(x.text)}</li>`).join('')}</ol>
      <p class="disc">본 결과는 의학적 진단이 아닌 웰니스 참고 지표입니다. 카메라 영상은 저장·전송되지 않았고, 결과 요약만 이 브라우저에 남습니다. · ${esc(r.version)} · ${esc(b.version)}</p></div>`;
    return h;
  }

  return { render, citer, esc };
});
