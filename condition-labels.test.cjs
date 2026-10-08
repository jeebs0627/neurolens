'use strict';
/* 시선 라벨 수집 공통 모듈 테스트 (합성 입력 · 운영 업로드 없음) */
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const L = require('./condition-labels.js');
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('PASS', name); };

test('SHA-256 matches node:crypto and canonical JSON is key-sorted with JS number formatting', () => {
  for (const s of ['', 'abc', '한글 테스트 ✓', 'x'.repeat(1000)]) assert.equal(L.sha256Hex(s), crypto.createHash('sha256').update(s, 'utf8').digest('hex'));
  assert.equal(L.canonical({ b: 1, a: [1.5, 2, null, NaN, Infinity], c: { z: true, y: 'q', skip: undefined } }), '{"a":[1.5,2,null,null,null],"b":1,"c":{"y":"q","z":true}}');
  assert.equal(L.canonical(1e-7), '1e-7'); assert.equal(L.canonical(0.1 + 0.2), '0.3'); assert.equal(L.canonical(-0), '0'); assert.equal(L.canonical(123456789.123456789), '123456789.12345679');
});

test('target plan is deterministic by seed, balanced by region and role, holdout last', () => {
  const a = L.planTargets({ seed: 42 }), b = L.planTargets({ seed: 42 }), c = L.planTargets({ seed: 43 });
  assert.deepEqual(a, b); assert.notDeepEqual(a.targets.map(t => t.id + t.nx), c.targets.map(t => t.id + t.nx));
  assert.equal(a.targets.length, 25);
  const roles = { train: 0, internal: 0, holdout: 0 }; a.targets.forEach(t => roles[t.role]++);
  assert.deepEqual(roles, { train: 16, internal: 4, holdout: 5 });
  const lastFive = a.targets.slice(-5); assert.ok(lastFive.every(t => t.role === 'holdout'));
  for (const role of ['train', 'holdout']) { const regions = new Set(a.targets.filter(t => t.role === role).map(t => t.region)); assert.ok(regions.has('corner') && regions.has('periphery'), role + ' covers corners and periphery'); }
  assert.ok(a.targets.every(t => t.nx > 0.05 && t.nx < 0.95 && t.ny > 0.05 && t.ny < 0.95));
  const custom = L.planTargets({ seed: 1, config: { counts: { train: 6, internal: 2, holdout: 4 } } });
  assert.equal(custom.targets.length, 12); assert.equal(custom.targets.filter(t => t.role === 'holdout').length, 4);
});

test('feature contract rejects target/click/label/future information', () => {
  assert.deepEqual(L.checkFeatureNames(['u', 'v', 'baseX', 'baseY', 'yaw']), { ok: true, rejected: [] });
  const bad = L.checkFeatureNames(['u', 'targetX', 'clickY', 'dwellConfidence', 'timeToConfirm', 'unknownFeature']);
  assert.equal(bad.ok, false); assert.deepEqual(bad.rejected, ['targetX', 'clickY', 'dwellConfidence', 'timeToConfirm', 'unknownFeature']);
});

function frames(from, to, step, mut = () => ({})) { const out = []; for (let t = from; t <= to; t += step) out.push({ t, gazeOk: true, faceOk: true, blink: 0.05, cx: 0.5, cy: 0.5, fw: 0.3, eyeQ: 0.6, ...mut(t) }); return out; }

test('pre-confirm window keeps only frames inside [confirm-500, confirm-200] after settle, excludes blinks and face loss', () => {
  const shownAt = 1000, confirmAt = 3000;
  const F = frames(1000, 3000, 33, t => (t > 2560 && t < 2600 ? { blink: 0.9 } : t > 2700 ? { faceOk: false, gazeOk: false } : {}));
  const w = L.selectWindow({ frames: F, shownAt, confirmAt });
  assert.deepEqual(w.window, { start: 2500, end: 2800 });
  assert.ok(w.frameTimes.every(t => t >= 2500 && t <= 2800));
  assert.ok(w.frameTimes.every(t => !(t > 2560 && t < 2600) && t <= 2700), 'blink and face-missing frames excluded');
  assert.ok(w.excluded.blink >= 1 && w.excluded['face-missing'] >= 1);
  assert.equal(w.keep, true); assert.ok(w.dwellConfidence > 0 && w.dwellConfidence <= 1);
  assert.ok(w.frameTimes.length <= L.DEFAULT_CONFIG.maxFramesPerTarget);
});

test('window rejects short dwell, hidden overlap, layout change, head motion, low fps and too few frames', () => {
  const base = { frames: frames(0, 3000, 33), shownAt: 1000, confirmAt: 3000 };
  assert.ok(L.selectWindow({ ...base, confirmAt: 1700 }).reasons.includes('dwell-too-short'));
  assert.ok(L.selectWindow({ ...base, hidden: [{ start: 2000, end: 2100 }] }).reasons.includes('hidden-overlap'));
  assert.ok(L.selectWindow({ ...base, layoutChanges: [2200] }).reasons.includes('layout-changed'));
  assert.ok(L.selectWindow({ ...base, frames: frames(0, 3000, 33, t => ({ cx: 0.5 + (t > 2600 ? 0.1 : 0) })) }).reasons.includes('head-motion'));
  assert.ok(L.selectWindow({ ...base, frames: frames(0, 3000, 200) }).reasons.includes('low-fps'));
  assert.ok(L.selectWindow({ ...base, frames: frames(0, 3000, 33, () => ({ gazeOk: false })) }).reasons.includes('too-few-frames'));
  const settle = L.selectWindow({ ...base, shownAt: 2300, confirmAt: 3300, config: { minDwellMs: 500 } });
  assert.ok(settle.window.start >= 2900, 'settle period pushes window start');
  assert.equal(L.selectWindow({ frames: [], shownAt: NaN, confirmAt: 1 }).keep, false);
});

test('event log recomputes effective labels: invalidate, retry, restore, supersede', () => {
  let t = 0; const log = L.createEventLog(() => (t += 10));
  const win = ok => ({ keep: ok, frameTimes: ok ? [1, 2, 3, 4] : [], dwellConfidence: ok ? 0.8 : 0, reasons: ok ? [] : ['too-few-frames'] });
  log.push('shown', { targetId: 'T01' }); log.push('confirm', { targetId: 'T01', window: win(true) });
  log.push('shown', { targetId: 'T02' }); log.push('confirm', { targetId: 'T02', window: win(true) }); log.push('invalidate', { targetId: 'T02', reason: 'user' });
  log.push('retry', { targetId: 'T02' }); log.push('shown', { targetId: 'T02' }); log.push('confirm', { targetId: 'T02', window: win(false) });
  log.push('shown', { targetId: 'T03' }); log.push('confirm', { targetId: 'T03', window: win(true) }); log.push('invalidate', { targetId: 'T03' }); log.push('restore', { targetId: 'T03' });
  const eff = log.effective();
  const T = Object.fromEntries(eff.targets.map(x => [x.targetId, x]));
  assert.equal(T.T01.status, 'valid'); assert.equal(T.T01.effective.attempt, 1);
  assert.equal(T.T02.status, 'rejected', 'invalidated first attempt is not resurrected; the retry was rejected'); assert.equal(T.T02.effective, null); assert.equal(T.T02.retries, 1); assert.equal(T.T02.attempts[0].status, 'invalidated');
  assert.equal(T.T03.status, 'valid'); assert.ok(T.T03.attempts[0].flags.includes('restored'));
  assert.equal(eff.valid, 2); assert.equal(eff.total, 3);
  assert.equal(log.events.length, 12, 'append-only: nothing removed');
});

test('pipeline snapshot digest is stable, order-independent and changes with any component', () => {
  const S = { model: { mu: { u: 0.5 }, sd: { u: 0.1 }, wx: [1, 2], wy: [3, 4], quad: false, keys: ['u'], eyes: { left: { mu: {}, sd: {}, wx: [1], wy: [1], validation: { grade: 'good' } } } }, affine: { x: { a: 1, b: 0 }, y: { a: 1, b: 0 } }, resid: null, drift: { dx: 0, dy: 0 } };
  const d1 = L.pipelineDigest(S), d2 = L.pipelineDigest({ ...S, model: { ...S.model, wy: [3, 4], wx: [1, 2] } });
  assert.equal(d1, d2); assert.match(d1, /^[0-9a-f]{64}$/);
  assert.notEqual(d1, L.pipelineDigest({ ...S, resid: { W: 1, H: 1, cx: [0, 0, 0, 0], cy: [0, 0, 0, 0] } }));
  assert.notEqual(d1, L.pipelineDigest({ ...S, drift: { dx: 1, dy: 0 } }));
  const snap = L.pipelineSnapshot(S); assert.equal(JSON.parse(JSON.stringify(snap)).model.eyes.left.validation.grade, 'good');
});

test('viewport snapshot and target centre normalisation use CSS client coordinates', () => {
  const vp = L.viewportState({ innerWidth: 1000, innerHeight: 500, devicePixelRatio: 2, scrollX: 0, scrollY: 0, visualViewport: { width: 1000, height: 500, offsetLeft: 0, offsetTop: 0, scale: 1, pageLeft: 0, pageTop: 0 }, screen: { width: 2000, height: 1000, orientation: { type: 'landscape-primary' } }, document: { fullscreenElement: null } });
  assert.equal(vp.coordinateSpace, 'css-client'); assert.equal(vp.dpr, 2); assert.equal(vp.orientation, 'landscape-primary');
  const c = L.targetCenter({ left: 490, top: 240, width: 20, height: 20 }, vp);
  assert.deepEqual([c.x, c.y, c.nx, c.ny], [500, 250, 0.5, 0.5]);
  assert.equal(L.viewportState(null).vw, null);
});

console.log(passed + ' label module tests passed.');
