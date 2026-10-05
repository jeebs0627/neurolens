/* NeuroLens NewBiz — 연구용 데이터 패키징 (newbiz.html 전용, 참가자가 연구 제공에 따로 동의한 실측 세션만).
 *
 * 목적: 알고리즘 고도화·규준 수립·딥러닝 학습 재료. 카메라 영상·이미지는 만들지도 보내지도 않는다.
 * 구성:
 *   meta    — 프로토콜·알고리즘 버전, 화면·카메라·브라우저 계열(정밀 지문이 되는 UA 전체는 넣지 않음), 측정 모드
 *   summary — 영역·지표·QC·통합 해석·체크인(맥락 포함). PHQ 는 consent.phq 일 때만
 *   payload — 시계열 원자료(열 단위·정수 양자화): 프레임별 피부색·얼굴 특징·시선 특징, 눈·홍채 랜드마크,
 *             시행별 시선 표본과 반응, 보정 표적 기록, 화면 가림 구간, 단계 시각
 * 브라우저에서 JSON → gzip(CompressionStream) → base64 → 450KB 조각으로 나눠 Supabase RPC 로 올린다.
 * 브라우저: window.NLResearch · Node 테스트: module.exports */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NLResearch = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const SCHEMA = 'nl-research-2';
  const CONSENT_VERSION = 'condition-research-2026-10-04';
  const finite = v => typeof v === 'number' && Number.isFinite(v);
  const q = (v, k) => (finite(v) ? Math.round(v * k) : null);           // 정수 양자화 (k = 배율)

  /* 프레임: 열 단위 배열. t 는 첫 프레임 기준 ms. 배율은 SCALE 에 기록해 복원 가능하게 */
  const FRAME_COLS = { faceOk: 1, eyeOk: 1, skinOk: 1, ppgOk: 1, gazeOk: 1, skinQ: 1e3, eyeQ: 1e3, qLeft: 1e3, qRight: 1e3, uLeft: 1e4, vLeft: 1e4, uRight: 1e4, vRight: 1e4, roiAge: 1, exposureGain: 100, ok: 1, r: 100, g: 100, b: 100, lum: 10, cx: 1e4, cy: 1e4, fw: 1e4, open: 1e4, blink: 1e3, frown: 1e3, smile: 1e3, u: 1e4, v: 1e4, yaw: 1e4, pitch: 1e4, lag: 1 };
  function packFrames(frames) {
    const F = frames || [], t0 = F.length ? F[0].t : 0, out = { t0, scale: {...FRAME_COLS,rr:100,rq:1e3}, t: F.map(f => Math.round(f.t - t0)) };
    Object.entries(FRAME_COLS).forEach(([k, s]) => { out[k] = F.map(f => (typeof f[k] === 'boolean' ? (f[k] ? 1 : 0) : q(f[k], s))); });
    out.rr = F.map(f => (Array.isArray(f.rr) ? [0,1,2].flatMap(k => [0,1,2].map(c => q(f.rr[k]?.[c],100))) : null));   // [이마 r,g,b, 왼뺨 r,g,b, 오른뺨 r,g,b]
    out.rq = F.map(f=>f.rq ? f.rq.map(v=>q(v,1e3)) : null);
    for(const [key,scale] of Object.entries({intervalMs:100,captureDelayMs:100,callbackLateMs:100,mediaTimeMs:100,presentedFrames:1})){out.scale[key]=scale;out[key]=F.map(f=>q(f[key],scale));}
    out.clockSource = F.map(f=>f.clockSource||null);
    out.source = F.map(f=>f.source||null);
    out.reason = F.map(f=>f.reason||null);
    return out;
  }
  const rel = (t, t0) => (finite(t) ? Math.round(t - t0) : null);
  const packSamples = (S, t0) => (S || []).map(p => [rel(p.t, t0), q(p.x, 1), q(p.y, 1), q(finite(p.rx) ? p.rx : p.x, 1), q(finite(p.ry) ? p.ry : p.y, 1), p.bl ? 1 : 0, q(p.q,1e3), p.mode || null, q(p.lag,1)]);

  function browserFamily(ua) {
    ua = String(ua || '');
    const b = /Edg\//.test(ua) ? 'edge' : /Chrome\//.test(ua) ? 'chrome' : /Firefox\//.test(ua) ? 'firefox' : /Safari\//.test(ua) ? 'safari' : 'other';
    const o = /Windows/.test(ua) ? 'windows' : /Mac OS X/.test(ua) ? 'mac' : /Android/.test(ua) ? 'android' : /iPhone|iPad/.test(ua) ? 'ios' : /Linux/.test(ua) ? 'linux' : 'other';
    const v = (ua.match(/(?:Chrome|Firefox|Version|Edg)\/(\d+)/) || [])[1] || null;
    return { browser: b, major: v ? +v : null, os: o };
  }

  /* rec = liveRecord(), res = NLBattery.run(rec), env = {ua, screen, camera, dpr, tz, extra} */
  function pack(rec, res, consent, env = {}) {
    const b = res?.battery, t0 = rec.frames && rec.frames.length ? rec.frames[0].t : (rec.startedAt||0);
    const fps = (() => { const F = rec.frames || []; return F.length > 1 ? Math.round((F.length - 1) / ((F[F.length - 1].t - F[0].t) / 1000) * 10) / 10 : null; })();
    const meta = {
      schema: SCHEMA, consentVersion: CONSENT_VERSION,
      attemptId:rec.attemptId||null,outcome:rec.outcome||'complete',demo:!!rec.demo,
      versions: { fusion: res?.evidence?.version || null, core: res?.version||null, battery: b?.version||null, qc: b?.qc ? b.qc.version : null, app: env.app || null },
      capture: rec.capture || null, mode: rec.mode, modules: Object.fromEntries(Object.entries(b?.steps || rec.steps || {}).map(([k, v]) => [k, v.status])),
      screen: env.screen || null, dpr: env.dpr || null, camera: env.camera || null, fps,
      client: browserFamily(env.ua), tzOffsetMin: env.tz ?? null, localHour: rec.measuredAt ? new Date(rec.measuredAt).getHours() : null,
      stim: { mode: rec.stimMode || null, form: rec.stimForm || null }, measuredAt: rec.measuredAt || null,
      protocol: rec.lab ? { kind: 'lab', steps: rec.lab } : { kind: 'full' },
    };
    const ck = { ...(rec.checkin || {}) };
    if (!consent.phq) delete ck.phq;
    const summary = b ? {
      checkin: ck, integrated: { code: b.integrated.code, primary: b.integrated.primary, secondary: b.integrated.secondary, pathways: b.integrated.pathways.map(p => p.key), mismatches: b.integrated.mismatches.map(m => m.key), context: (b.integrated.context || []).map(c => c.key) },
      domains: Object.fromEntries(Object.entries(b.domains).map(([k, d]) => [k, { score: d.score, status: d.status, confidence: d.confidence, tentative: !!d.tentative }])),
      indicators: b.indicators.map(i => ({ key: i.key, value: i.value, score: i.score, status: i.status, r: i.r, borderline: !!i.borderline, excluded: !!i.excluded })),
      qc: b.qc || null, pulseEvidence: res.evidence?.phases || null, calibration: rec.calibration ? { grade: rec.calibration.grade, errPct: rec.calibration.errPct, before: rec.calibration.before ?? null, model: rec.calibration.model || null, affine: !!rec.calibration.affine, control: rec.calibration.control || null } : null,
      hr: { baseline: res.hr && res.hr.baseline, stressDelta: res.stressDelta, recovery: res.recovery, recoveryResid: res.recoveryResid, ref: res.hrRef || null, resp: res.resp || null },
      phq: consent.phq && b.phq ? { phq2: b.phq.phq2, phq8: b.phq.phq8 } : null,
    } : {checkin:ck};
    const dataset=typeof module==='object'&&module.exports ? require('./condition-dataset.js') : globalThis.NLDataset;
    if(dataset)summary.dataset=dataset.build(rec,res);
    const payload = {
      schema: SCHEMA, t0, sampleColumns: ['t','x','y','rx','ry','blink','quality_x1000','eyeMode','inferenceLagMs'],
      phases: Object.fromEntries(Object.entries(rec.phases || {}).map(([k, v]) => [k, [rel(v.start, t0), rel(v.end, t0)]])),
      hidden: (rec.hidden || []).map(h => [rel(h.start, t0), rel(h.end, t0)]),
      frames: packFrames(rec.frames),
      pulseEvidence: res?.evidence ? {version:res.evidence.version,windows:res.evidence.windows.map(w=>({...w,start:rel(w.start,t0),end:rel(w.end,t0),t:rel(w.t,t0)}))} : null,
      telemetry:rec.telemetry ? {clock:rec.telemetry.clock,calibrationFrames:packFrames(rec.telemetry.calibrationFrames),steps:Object.fromEntries(Object.entries(rec.telemetry.steps||{}).map(([k,v])=>[k,{...v,start:rel(v.start,t0),end:rel(v.end,t0)}])),
        stimuli:(rec.telemetry.stimuli||[]).map(v=>({...v,requested:rel(v.requested,t0),onset:rel(v.onset,t0)})),inputs:(rec.telemetry.inputs||[]).map(v=>({...v,t:rel(v.t,t0)})),drift:(rec.telemetry.drift||[]).map(v=>({...v,t:rel(v.t,t0)}))} : null,
      reference:rec.reference ? {...rec.reference,samples:rec.reference.samples.map(v=>({...v,t:rel(v.t,t0)})),events:(rec.reference.events||[]).map(v=>({...v,t:rel(v.t,t0)}))} : null,
      landmarks: rec.landmarks ? { idx: rec.landmarks.idx, scale: 1e4, rows: rec.landmarks.rows.map(r => [rel(r[0], t0), ...r.slice(1)]) } : null,
      calibration: rec.calibLog ? {
        screen: rec.calibLog.screen, targets: (rec.calibLog.targets || []).map(x => [rel(x.t, t0), q(x.x, 1), q(x.y, 1), x.kind]),
        pursuit: rec.calibLog.pursuit ? { ...rec.calibLog.pursuit, t0: rel(rec.calibLog.pursuit.t0, t0) } : null,
        model: rec.calibLog.model || null, affine: rec.calibLog.affine || null, cursor: rec.calibLog.cursor || null, evaluation:rec.calibLog.evaluation||null,
      } : null,
      freeview: (rec.trials || []).map(tr => ({ kind: tr.kind, sub: tr.sub || null, emoSide: tr.emoSide, emoId: tr.emoId || null, neuId: tr.neuId || null, onset: rel(tr.onset, t0), end: rel(tr.end, t0), s: packSamples(tr.samples, t0) })),
      saccade: (rec.saccade || []).map(tr => ({ type: tr.type, side: tr.side, practice: !!tr.practice, onset: rel(tr.onset, t0), end: rel(tr.end, t0), cal: tr.cal || null, s: packSamples(tr.samples, t0) })),
      saccadeCal: rec.saccadeCal || null,
      pursuit: rec.pursuit ? { version: rec.pursuit.version || 1, t0: rel(rec.pursuit.t0, t0), cx: rec.pursuit.cx, amp: rec.pursuit.amp, freq: rec.pursuit.freq, dur: rec.pursuit.dur, s: packSamples(rec.pursuit.samples || [], t0),
        levels: rec.pursuit.levels ? rec.pursuit.levels.map(b => ({ freq: b.freq, t0: rel(b.t0, t0), dur: b.dur, s: packSamples(b.samples, t0) })) : undefined,
        reversal: rec.pursuit.reversal ? { t0: rel(rec.pursuit.reversal.t0, t0), end: rel(rec.pursuit.reversal.end, t0), speed: rec.pursuit.reversal.speed, x0: rec.pursuit.reversal.x0, dir0: rec.pursuit.reversal.dir0,
          turns: rec.pursuit.reversal.turns.map(u => ({ ...u, t: rel(u.t, t0) })), s: packSamples(rec.pursuit.reversal.samples, t0) } : undefined, circle: rec.pursuit.circle ? { ...rec.pursuit.circle, samples: undefined, t0: rel(rec.pursuit.circle.t0,t0), s: packSamples(rec.pursuit.circle.samples,t0) } : null } : null,
      pvt: rec.pvt ? { falseStarts: rec.pvt.falseStarts, durationMs: rec.pvt.durationMs, trials: rec.pvt.trials.map(x => [rel(x.onset, t0), finite(x.rt) ? Math.round(x.rt) : null]) } : null,
      sart: rec.sart ? { trials: rec.sart.trials.map(x => [x.digit, rel(x.onset, t0), finite(x.rt) ? Math.round(x.rt) : null]) } : null,
      stress: rec.stressScore || null,
    };
    return { meta, summary, payload };
  }

  /* 브라우저: gzip → base64 → 조각 */
  async function encode(payload, chunkSize = 450000) {
    const json = JSON.stringify(payload);
    const raw = new TextEncoder().encode(json);
    const cs = new CompressionStream('gzip');
    const gz = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(cs)).arrayBuffer());
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', gz))).map(x => x.toString(16).padStart(2, '0')).join('');
    let bin = '';
    for (let i = 0; i < gz.length; i += 0x8000) bin += String.fromCharCode.apply(null, gz.subarray(i, i + 0x8000));
    const b64 = btoa(bin), chunks = [];
    for (let i = 0; i < b64.length; i += chunkSize) chunks.push(b64.slice(i, i + chunkSize));
    return { chunks, bytes: gz.length, rawBytes: raw.length, sha256: hash };
  }

  return { SCHEMA, CONSENT_VERSION, FRAME_COLS, pack, packFrames, encode, browserFamily };
});
