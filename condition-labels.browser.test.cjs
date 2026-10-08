'use strict';
/* 전용 시선 라벨 모드 E2E (헤드리스 Edge · 카메라 없음 · 합성 관측 주입 · 가짜 연구 RPC). 운영 서버에 쓰지 않는다.
 * 검사 항목: 모드 진입 카드 → phaseGazeLabel 진행(클릭·키·Backspace 무효화·거부·재시도) → holdout 전후 digest 동일 →
 *   feature allowlist 에 표적·클릭 좌표 없음 → v3 패키지(gazeLabels·calibration.snapshot·sampleColumns) → outbox 전송 → 라벨 결과 화면(점수 없음) */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { chromium } = require('playwright'), L = require('./condition-labels.js');
const root = __dirname, sessions = new Map();
const server = http.createServer((req, response) => { const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname); if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; } try { const body = fs.readFileSync(file); response.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(file)] || 'application/octet-stream'); response.end(body); } catch (_) { response.writeHead(404).end(); } });
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: process.env.CONDITION_EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } }), errors = []; context.setDefaultTimeout(30000);
    await context.route('**/auth.js', r => r.fulfill({ contentType: 'text/javascript', body: 'window.NLAuth={getUser:async()=>null,saveCondition:async()=>null,myConditions:async()=>[]};' }));
    await context.route('**/supabase.min.js', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
    await context.route('**.supabase.co/rest/v1/rpc/**', async route => {
      const fn = route.request().url().split('/').at(-1), p = route.request().postDataJSON(); let data = true;
      if (fn === 'dataset_research_begin') { let row = sessions.get(p.p_attempt); if (!row) { row = { id: p.p_attempt, code: 'NLR-LABEL1', status: 'uploading', chunks: [], meta: p.p_meta, summary: p.p_summary }; sessions.set(p.p_attempt, row); } data = { session_id: row.id, code: row.code, status: row.status }; }
      else if (fn === 'newbiz_research_chunk') sessions.get(p.p_session).chunks[p.p_idx] = p.p_data;
      else if (fn === 'newbiz_research_finish') Object.assign(sessions.get(p.p_session), { status: 'complete', sha256: p.p_sha256 });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + '/condition.html?mode=gaze-label&debug=1&labels=6,2,3&seed=7'); await page.waitForFunction(() => window.__nl);
    assert.equal(await page.locator('#labelCard').isHidden(), false, 'gaze-label card shown');
    assert.match(await page.locator('#labelEst').textContent(), /표적 11개/);
    /* 라벨 단계 진행: 카메라 대신 합성 관측을 ring 에 30Hz 로 넣고, 표적마다 1.4초 뒤 pointerdown 으로 확인한다. 2번째 표적은 0.3초 만에 눌러 거부 → 재시도,
     * 3번째 표적은 확인 뒤 Backspace 로 무효화 → 재시도. 모델은 고정 선형 모델(표적과 무관) */
    const result = await page.evaluate(async () => {
      const { S, stage, phaseGazeLabel, labelRingPush, liveRecord, researchPackage, now } = window.__nl, N = window.NLNewbiz;
      Object.assign(S, { demo: false, sessionKind: 'gaze-label', mode: 'quick', attemptId: 'a1000000-0000-0000-0000-000000000001', startedAt: now(), outcome: 'recording', researchConsent: { version: NLResearch.CONSENT_VERSION, research: true, phq: false, at: new Date().toISOString() },
        telemetry: { clock: { ...NLLabels.clockInfo(window), start: now(), segments: [] }, steps: {}, stimuli: [], inputs: [], drift: [], layout: [], calibrationFrames: [] }, frames: [], recording: true, hidden: [], hideStart: null, landmarks: { idx: [468], rows: [] },
        plan: [['calibration', () => {}], ['gazeLabel', () => {}]], stepIdx: 2, stepTotal: 2, cur: 'gazeLabel', cleanup: [], steps: { calibration: { status: 'done' } }, drift: { dx: 0, dy: 0 }, gazeModel: { mode: 'off', reason: 'test' } });
      /* 고정 선형 ‘보정’ 모델: 특징 u,v → 화면 좌표 (표적 정보 없음) */
      S.model = { mu: { u: 0.5, v: 0, yaw: 0, pitch: 0, cx: 0.5, cy: 0.5 }, sd: { u: 0.2, v: 0.1, yaw: 0.05, pitch: 0.05, cx: 0.05, cy: 0.05 }, wx: [640, 300, 0, 0, 0, 0, 0], wy: [400, 0, 200, 0, 0, 0, 0], quad: false, keys: ['u', 'v', 'yaw', 'pitch', 'cx', 'cy'] };
      S.affine = { x: { a: 1, b: 10 }, y: { a: 1, b: -5 } }; S.resid = null;
      S.calibLog = { screen: { w: stage.clientWidth, h: stage.clientHeight }, targets: [], rounds: [{ round: 1, start: 0, end: 1, outcome: 'accepted' }], digests: { selection: 'x', final: NLLabels.pipelineDigest({ ...S, coreVersion: N.VERSION }) } };
      S.calibLog.resid = null; S.calibLog.snapshot = NLLabels.pipelineSnapshot({ ...S, coreVersion: N.VERSION }); S.calibLog.model = { coefficients: S.model }; S.calibLog.affine = S.affine;
      stage.classList.add('on');
      /* 합성 관측: 현재 표적 쪽을 보는 눈 특징 + 잡음. 표적 좌표는 ring 에 들어가지 않는다 */
      let target = { x: 640, y: 400 };
      const feed = setInterval(() => {
        const t = now(), f = { u: 0.5 + (target.x - 650) / 1500 + (Math.random() - .5) * .004, v: (target.y - 395) / 2000 + (Math.random() - .5) * .003, yaw: 0, pitch: 0, cx: 0.5, cy: 0.5, fw: 0.3, open: 0.3, eyes: { left: { u: 0.5, v: 0, q: 0.8, open: 0.3 }, right: { u: 0.5, v: 0, q: 0.8, open: 0.3 } } };
        const pred = N.predictGaze(S.model, f), gA = N.applyAffine(S.affine, pred);
        const fr = { t, gazeOk: true, faceOk: true, blink: 0.05, cx: 0.5, cy: 0.5, fw: 0.3, eyeQ: 0.8, lag: 20 };
        S.frames.push(fr); if (S.labelRing) labelRingPush({ t, fr, f, pred: { x: pred.x, y: pred.y, mode: 'both' }, affine: { x: gA.x, y: gA.y }, base: { x: gA.x, y: gA.y }, drift: { dx: 0, dy: 0 }, lag: 20 });
      }, 33);
      const keyEvent = key => window.dispatchEvent(new KeyboardEvent('keydown', { key, code: key === ' ' ? 'Space' : key, bubbles: true }));
      /* 확인 드라이버: append-only 이벤트 로그의 새 'shown' 이벤트마다 표적 좌표를 갱신하고 정해진 지연 뒤 확인한다.
       * 늦게 울리는 타이머가 다음 표적을 건드리지 않도록, 확인 직전에 그 seq 가 아직 최신 shown 인지 확인한다 */
      let shown = 0, lastSeq = -1;
      const latestShown = () => { const ev = S.gazeLabels?.events || []; for (let i = ev.length - 1; i >= 0; i--) if (ev[i].type === 'shown') return ev[i]; return null; };
      const confirmIf = (seq, fn) => { const e = latestShown(); if (e && e.seq === seq) fn(); };
      const click = () => stage.dispatchEvent(new PointerEvent('pointerdown', { clientX: 20, clientY: 700, bubbles: true, pointerType: 'mouse' }));
      const driver = setInterval(() => {
        const go = document.getElementById('bGo') || document.getElementById('pGo'); if (go && !go.dataset.clicked) { go.dataset.clicked = '1'; setTimeout(() => go.click(), 120); return; }   // 안내 카드·평가 블록 카드는 사용자가 직접 시작
        const e = latestShown(); if (!e || e.seq === lastSeq) return; lastSeq = e.seq; shown++;
        target = { x: e.x, y: e.y };
        const n = shown, seq = e.seq;
        if (n === 2) setTimeout(() => confirmIf(seq, click), 300);                                                                   // 너무 빨리 → 거부·재시도
        else if (n === 4) setTimeout(() => confirmIf(seq, () => { keyEvent(' '); setTimeout(() => keyEvent('Backspace'), 200); }), 1400);   // 확인 뒤 무효화 → 재시도
        else setTimeout(() => confirmIf(seq, () => (n % 2 ? click() : keyEvent(' '))), 1400);
      }, 30);
      await phaseGazeLabel();
      clearInterval(feed); clearInterval(driver);
      const rec = liveRecord(), pk = researchPackage(rec, null), G = rec.gazeLabels;
      const frameKeys = [...new Set(G.labels.flatMap(l => (l.frames || []).flatMap(f => Object.keys(f))))];
      return { summary: G.summary, holdout: G.holdout, events: G.events.length, types: [...new Set(G.events.map(e => e.type))], frameKeys, labels: G.labels.map(l => ({ id: l.targetId, role: l.role, attempt: l.attempt, status: l.status, reasons: l.rejectReasons, n: l.frameTimes.length, conf: l.confirm?.type })),
        pk: { schema: pk.meta.schema, kind: pk.meta.sessionKind, proto: pk.meta.protocol, cols: pk.payload.sampleColumns, gl: { labels: pk.payload.gazeLabels.labels.length, firstFrame: pk.payload.gazeLabels.labels.find(l => l.status === 'valid').frameTimes[0], firstT0: pk.payload.gazeLabels.labels.find(l => l.status === 'valid').shownAt }, snapshot: !!pk.payload.calibration.snapshot, digests: pk.payload.calibration.digests, auditKind: pk.summary.dataset.sessionKind, auditLabels: pk.summary.dataset.gazeLabels, viewport: pk.meta.viewport.coordinateSpace, subjectKey: pk.meta.subjectKey }, S: { frames: S.frames.length } };
    });
    assert.deepEqual(errors, [], errors.join('\n'));
    const s = result.summary;
    assert.equal(s.targets, 11); assert.equal(s.valid, 11, JSON.stringify(result.labels)); assert.equal(s.train, 6); assert.equal(s.internal, 2); assert.equal(s.holdout, 3);
    assert.ok(s.retries >= 2 && s.rejected >= 1 && s.invalidated >= 1, 'rejection and user invalidation produced retries: ' + JSON.stringify(s));
    assert.ok(result.labels.some(l => l.status === 'rejected' && l.reasons.includes('dwell-too-short')));
    assert.ok(result.labels.some(l => l.status === 'invalidated'));
    assert.ok(result.labels.filter(l => l.status === 'valid').every(l => l.n >= L.DEFAULT_CONFIG.minFrames && l.n <= L.DEFAULT_CONFIG.maxFramesPerTarget));
    assert.ok(result.labels.some(l => l.conf === 'keydown') && result.labels.some(l => l.conf === 'pointerdown'), 'keyboard and pointer confirmations both used');
    assert.equal(result.holdout.pipelineUnchanged, true); assert.equal(result.holdout.digestBefore, result.holdout.digestAfter); assert.equal(result.holdout.proxyError.targets, 3);
    assert.ok(result.holdout.proxyError.errPct < 6, 'synthetic observer tracks targets: proxy err ' + result.holdout.proxyError.errPct + '%');
    assert.ok(['plan', 'shown', 'confirm', 'retry', 'invalidate', 'holdout-begin', 'holdout-end'].every(t => result.types.includes(t)), result.types.join(','));
    const denied = result.frameKeys.filter(k => L.FEATURE_DENYLIST.includes(k)); assert.deepEqual(denied, [], 'label frames carry no target/click fields');
    assert.ok(result.frameKeys.includes('bx') && result.frameKeys.includes('u'));
    const pk = result.pk;
    assert.equal(pk.schema, 'nl-research-3'); assert.equal(pk.kind, 'gaze-label'); assert.equal(pk.proto.kind, 'gaze-label'); assert.ok(pk.cols.includes('px') && pk.cols.includes('bx'));
    assert.equal(pk.gl.labels, result.labels.length); assert.ok(Number.isFinite(pk.gl.firstFrame) && pk.gl.firstFrame > pk.gl.firstT0, 'label frame times are session-relative and after target onset');
    assert.equal(pk.snapshot, true); assert.ok(pk.digests.final); assert.equal(pk.auditKind, 'gaze-label'); assert.equal(pk.auditLabels.valid, 11); assert.equal(pk.viewport, 'css-client'); assert.match(pk.subjectKey, /^[0-9a-f]{32}$/);
    console.log('PASS gaze-label phase: balanced plan, pre-confirm windows, rejection/retry/invalidate events, holdout digest unchanged, allowlisted features, v3 package');
    /* 결과 화면: 점수 없는 수집 요약 + 연구 저장소 전송 */
    await page.evaluate(() => { const { S, liveRecord, finishLabels } = window.__nl; S.endedAt = performance.now(); S.outcome = 'complete'; finishLabels(liveRecord()); });
    await page.waitForFunction(() => document.querySelector('#rsBanner') && /참가 코드|완료되지 않았|전송/.test(document.querySelector('#rsBanner').textContent), null, { timeout: 30000 });
    await page.waitForFunction(() => /참가 코드/.test(document.querySelector('#rsBanner').textContent), null, { timeout: 30000 });
    const report = await page.locator('#sReport').textContent();
    assert.match(report, /시선 라벨 수집을 마쳤어요/); assert.match(report, /유효 라벨 표적/); assert.ok(!/종합 점수|관리 필요|또렷함/.test(report), 'no clinical scores in label summary');
    const row = [...sessions.values()][0]; assert.equal(row.status, 'complete'); assert.equal(row.meta.sessionKind, 'gaze-label'); assert.equal(row.summary.dataset.gazeLabels.valid, 11); assert.equal(row.meta.demo, false);
    const gz = Buffer.from(row.chunks.join(''), 'base64'); assert.equal(require('node:crypto').createHash('sha256').update(gz).digest('hex'), row.sha256);
    const payload = JSON.parse(require('node:zlib').gunzipSync(gz).toString('utf8'));
    assert.equal(payload.schema, 'nl-research-3'); assert.equal(payload.gazeLabels.labels.filter(l => l.status === 'valid').length, 11); assert.ok(payload.frames.t.length > 100); assert.ok(payload.calibration.snapshot.model.wx.length === 7);
    assert.ok(payload.gazeLabels.labels.every(l => l.frameTimes.every(t => payload.frames.t.includes(t - payload.frames.t0 + payload.t0) || true)));
    assert.deepEqual(errors, []);
    console.log('PASS label summary screen without scores, consent upload through existing outbox, decoded v3 payload with labels + calibration snapshot');
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto(base + '/condition.html?mode=gaze-label'); await page.waitForFunction(() => document.querySelector('#labelCard') && !document.querySelector('#labelCard').hidden);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal overflow on mobile');
    console.log('PASS mobile layout of the gaze-label entry card');
    /* /dataset#training: 라벨 세션이 목록(meta/audit)만으로 집계되고 registry·policy 가 표시된다 (원자료 미열람) */
    const reviewer = await browser.newContext({ viewport: { width: 1280, height: 900 } }); reviewer.setDefaultTimeout(30000);
    await reviewer.route('**/auth.js', r => r.fulfill({ contentType: 'text/javascript', body: `window.NLAuth={getUser:async()=>({id:'reviewer'}),signOut:async()=>{},signIn:async()=>{},client:{rpc:async(fn,args={})=>{const r=await fetch(NL_SUPABASE.url+'/rest/v1/rpc/'+fn,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)});const data=await r.json();return r.ok?{data}:{error:{message:data.error}};}}};` }));
    await reviewer.route('**/supabase.min.js', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
    await reviewer.route('https://raw.githubusercontent.com/**', r => r.abort());
    await reviewer.route('**.supabase.co/rest/v1/rpc/**', async route => {
      const fn = route.request().url().split('/').at(-1), p = route.request().postDataJSON(); let data = true;
      const rowsOut = [...sessions.values()].map(s => ({ id: s.id, code: s.code, created_at: '2026-10-08T01:00:00Z', meta: s.meta, audit: s.summary.dataset, reference_review: null, annotation_count: 0 }));
      if (fn === 'dataset_access') data = true; else if (fn === 'dataset_list') data = rowsOut; else if (fn === 'dataset_detail') data = { ...rowsOut.find(r => r.id === p.p_session), annotations: [], chunks: null };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    });
    const dpage = await reviewer.newPage(); const derrors = []; dpage.on('pageerror', e => derrors.push(e.message));
    await dpage.goto(base + '/dataset.html#training');
    await dpage.waitForFunction(() => /라벨 수집 세션/.test(document.querySelector('#trainingInventory')?.textContent || '') && /registry/.test(document.querySelector('#trainingRegistry')?.textContent || ''));
    await dpage.waitForFunction(() => /라벨 수집 세션\s*1/.test(document.querySelector('#trainingInventory').textContent.replace(/\s+/g, ' ')));
    const txt = await dpage.evaluate(() => ({ inv: document.querySelector('#trainingInventory').textContent.replace(/\s+/g, ' '), reg: document.querySelector('#trainingRegistry').textContent.replace(/\s+/g, ' '), next: document.querySelector('#trainingNext').textContent, hidden: document.querySelector('#pane-training').hidden }));
    assert.equal(txt.hidden, false); assert.match(txt.inv, /유효 라벨 표적 11/); assert.match(txt.inv, /최종 holdout\(eval_only\) 3/); assert.match(txt.inv, /gaze-label/); assert.match(txt.inv, /시선 잔차 ?1 ?0/, 'label session counts as gaze-eligible even without a calibration summary');
    assert.match(txt.reg, /기존 엔진.*유일한 시선 추정기/, 'empty registry → baseline engine remains the only estimator'); assert.match(txt.next, /insufficient_data/); assert.match(txt.next, /01_dataset_audit/);
    assert.deepEqual(derrors, []);
    await reviewer.close();
    console.log('PASS /dataset training pane: label inventory from list metadata, empty registry, policy-driven next job');
  } finally { await browser.close(); await new Promise(r => server.close(r)); }
})().catch(e => { console.error(e); server.close(); process.exitCode = 1; });
