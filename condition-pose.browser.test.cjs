'use strict';
/* 보정 자세 지키기 E2E (헤드리스 Edge · 카메라 없음 · 합성 자세 주입).
 * 검사: 시작 1초로 기준 자세 → 얼굴이 옮겨지면(얼굴 폭의 20%) 이탈 판정·표본 차단·방향 안내(거울 기준) → 돌아오면(허용치 70% 안) 재개·구간 기록
 *       → 고개 돌림·거리 변화도 이탈 → poseHold 는 돌아올 때까지 기다림 → poseGuardStop 뒤에는 표본을 막지 않음 */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { chromium } = require('playwright');
const root = __dirname;
const server = http.createServer((req, res) => { const file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname)); if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; } try { const body = fs.readFileSync(file); res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(file)] || 'application/octet-stream'); res.end(body); } catch (_) { res.writeHead(404).end(); } });
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: process.env.CONDITION_EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } }), errors = [];
    await context.route('**/auth.js', r => r.fulfill({ contentType: 'text/javascript', body: 'window.NLAuth={getUser:async()=>null,saveCondition:async()=>null,myConditions:async()=>[]};' }));
    await context.route('**/supabase.min.js', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + '/condition.html?debug=1'); await page.waitForFunction(() => window.__nl);
    const r = await page.evaluate(async () => {
      const P = window.__nl, { S } = P, warn = document.getElementById('poseWarn');
      const pose = (t, o = {}) => ({ cx: 0.52, cy: 0.47, fw: 0.30, yaw: -0.01, ...o, t });
      let t = 1000; const feed = (n, o) => { for (let i = 0; i < n; i++) { t += 33; P.poseTrack(t, pose(t, o)); } };
      const out = {};
      P.poseGuardStart();
      feed(40);                                               // 1.3초 안정 → 기준
      out.ref = S.poseGuard.ref; out.offStable = S.poseGuard.off;
      const got = []; const sampler = P.featSampler(0, -1, 1e12, () => ({ x: 1, y: 2 }), got);
      sampler(t, {}); out.sampledStable = got.length;
      feed(20, { cx: 0.52 + 0.06 });                          // 얼굴 폭의 20% 이동(원 영상 오른쪽)
      out.offMoved = S.poseGuard.off; out.warnOn = warn.classList.contains('on'); out.msg = warn.textContent;
      sampler(t, {}); out.sampledMoved = got.length;
      feed(20, { cx: 0.52 + 0.025 });                         // 8%: 허용치(10%) 안이지만 복귀 기준(7%) 밖 → 아직 이탈
      out.offHyst = S.poseGuard.off;
      feed(20, { cx: 0.52 + 0.005 });                         // 복귀
      out.offBack = S.poseGuard.off; out.warnBack = warn.classList.contains('on');
      sampler(t, {}); out.sampledBack = got.length;
      out.events = S.poseGuard.events.map(e => ({ closed: e.end !== null, dcx: e.d.dcx }));
      feed(20, { yaw: -0.09 }); out.offYaw = S.poseGuard.off; out.msgYaw = warn.textContent; feed(20);
      feed(20, { fw: 0.345 }); out.offNear = S.poseGuard.off; out.msgNear = warn.textContent;
      /* poseHold: 이탈 중이면 돌아올 때까지 기다린다 */
      const hold = P.poseHold(5000); setTimeout(() => feed(20), 600);
      out.held = await hold;
      const G = P.poseGuardStop(); out.stoppedEvents = G.events.length; out.guardAfterStop = S.poseGuard; out.warnAfterStop = warn.classList.contains('on');
      sampler(t, {}); out.sampledAfterStop = got.length;
      return out;
    });
    assert.ok(Math.abs(r.ref.cx - 0.52) < 1e-9 && Math.abs(r.ref.fw - 0.30) < 1e-9, 'reference pose from the first second');
    assert.equal(r.offStable, false); assert.equal(r.sampledStable, 1);
    assert.equal(r.offMoved, true, 'face moved 20% of face width → departed'); assert.equal(r.warnOn, true);
    assert.match(r.msg, /오른쪽으로/, 'raw-image rightward move → mirror-view instruction to move right');
    assert.equal(r.sampledMoved, 1, 'no calibration samples while departed');
    assert.equal(r.offHyst, true, 'hysteresis: must come back within 70% of the tolerance');
    assert.equal(r.offBack, false); assert.equal(r.warnBack, false); assert.equal(r.sampledBack, 2, 'sampling resumes after returning');
    assert.deepEqual(r.events, [{ closed: true, dcx: 0.2 }]);
    assert.equal(r.offYaw, true); assert.match(r.msgYaw, /고개를 돌리지/);
    assert.equal(r.offNear, true); assert.match(r.msgNear, /멀리|뒤로/);
    assert.ok(r.held >= 500 && r.held < 3000, 'poseHold waits until the pose returns: ' + r.held);
    assert.ok(r.stoppedEvents >= 3); assert.equal(r.guardAfterStop, null); assert.equal(r.warnAfterStop, false); assert.equal(r.sampledAfterStop, 3, 'no gating once the guard is stopped');
    assert.deepEqual(errors, []);
    console.log('PASS calibration pose guard: reference, departure (position·yaw·distance), mirrored guidance, sample gating, hysteresis, hold, stop');
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
