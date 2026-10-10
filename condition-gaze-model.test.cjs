'use strict';
/* 시선 잔차 모델 클라이언트 테스트: fetch/ORT 를 주입한 합성 환경. 운영 registry·네트워크·모델 파일을 쓰지 않는다 */
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const M = require('./condition-gaze-model.js'), L = require('./condition-labels.js');
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('PASS', name); };

const features = ['baseX', 'baseY', 'u', 'v', 'yaw', 'pitch'];
const modelBytes = Buffer.from('synthetic-onnx-bytes-not-a-real-model');
const sha = crypto.createHash('sha256').update(modelBytes).digest('hex');
/* 가짜 ORT: 입력 벡터의 첫 두 성분 ×0.01 을 잔차로 돌려준다 (D→2) */
const fakeOrt = { Tensor: function (type, data, dims) { this.type = type; this.data = data; this.dims = dims; }, InferenceSession: { create: async bytes => ({ inputNames: ['x'], outputNames: ['delta'], run: async feeds => ({ delta: { data: Float32Array.from([feeds.x.data[0] * 0.01, feeds.x.data[1] * 0.01]) } }) }) } };
const manifest = () => ({ schema: M.MANIFEST_SCHEMA, id: 'gaze-residual-test', version: '0.0.1', sha256: sha, contract: 'add-residual', features: features.slice(), opset: 17,
  preprocessing: { version: 'pp-1', mean: [0.5, 0.5, 0.5, 0, 0, 0], std: [0.3, 0.3, 0.2, 0.1, 0.05, 0.05], mask: true, clip: 6 }, input: { name: 'x', shape: [1, 12] }, output: { name: 'delta', shape: [1, 2] },
  supports: { core: ['In_mind core 2.3'], labelsVersion: L.VERSION }, guard: { zMax: 4, maxCorrectionFrac: 0.15, maxMissing: 2 }, tolerance: { abs: 1e-5, rel: 1e-4 },
  testVectors: [{ input: [1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], output: [0.01, 0.02] }] });
function env(registry, man = manifest(), bytes = modelBytes) {
  const files = { 'model-registry.json': registry, 'models/gaze/test/manifest.json': man };
  M.deps.fetch = async url => ({ ok: url in files || url === 'models/gaze/test/model.onnx', status: url in files || url === 'models/gaze/test/model.onnx' ? 200 : 404, json: async () => files[url], arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  M.deps.loadOrt = async () => fakeOrt;
  M.deps.subtle = null;
}
const entry = (over = {}) => ({ id: 'gaze-residual-test', kind: 'gaze-residual', version: '0.0.1', url: 'models/gaze/test/model.onnx', manifestUrl: 'models/gaze/test/manifest.json', sha256: sha, ...over });
const registry = (over = {}) => ({ schema: M.REGISTRY_SCHEMA, updatedAt: '2026-10-08T00:00:00Z', active: null, shadow: null, ...over });

(async () => {
  await test('manifest validation enforces schema, feature allowlist, shapes, hash, contract and version support', async () => {
    assert.deepEqual(M.validateManifest(manifest(), { core: 'In_mind core 2.3' }), { ok: true, errors: [] });
    const bad = M.validateManifest({ ...manifest(), features: ['baseX', 'targetX'], contract: 'magic' }, { core: 'In_mind core 9.9' });
    assert.equal(bad.ok, false);
    assert.ok(bad.errors.some(e => e.startsWith('feature-denied:targetX'))); assert.ok(bad.errors.includes('contract')); assert.ok(bad.errors.includes('input-shape')); assert.ok(bad.errors.some(e => e.startsWith('unsupported-core')));
    assert.ok(M.validateManifest({ ...manifest(), sha256: 'abc' }).errors.includes('sha256'));
    assert.ok(M.validateManifest({ ...manifest(), testVectors: [] }).errors.includes('test-vectors'));
  });

  await test('feature vector follows manifest order, standardises, masks missing values and never contains target data', async () => {
    const man = manifest(), f = { u: 0.6, v: 0.1, yaw: 0.02, pitch: NaN, eyes: { left: { u: 0.6, v: 0.1, q: 0.8 }, right: { u: 0.6, v: 0.1, q: 0.8 } }, open: 0.3, cx: 0.5, cy: 0.5, fw: 0.3 };
    const values = M.featureValues(f, { x: 500, y: 250, mode: 'both' }, 1000, 500);
    assert.equal(values.baseX, 0.5); assert.equal(values.baseY, 0.5); assert.ok(!('targetX' in values) && !('clickX' in values));
    const vec = M.vectorize(man, values);
    assert.equal(vec.vector.length, 12); assert.equal(vec.missing, 1);
    assert.ok(Math.abs(vec.vector[2] - (0.6 - 0.5) / 0.2) < 1e-6, 'u standardised');
    assert.equal(vec.vector[5], 0); assert.equal(vec.vector[11], 1, 'pitch missing → 0 with mask bit');
    assert.equal(vec.vector[6], 0, 'baseX present → mask 0');
  });

  await test('guard fails closed on non-finite output, too many missing, out-of-distribution input, and caps large corrections', async () => {
    const man = manifest(), v = { vector: new Float32Array(12), missing: 0 };
    assert.deepEqual(M.guard(man, v, [NaN, 0], 1000, 500), { dx: 0, dy: 0, reason: 'non-finite-output' });
    assert.equal(M.guard(man, { vector: new Float32Array(12), missing: 3 }, [1, 1], 1000, 500).reason, 'too-many-missing');
    const ood = new Float32Array(12); ood[2] = 5; assert.equal(M.guard(man, { vector: ood, missing: 0 }, [1, 1], 1000, 500).reason, 'out-of-distribution');
    const capped = M.guard(man, v, [400, 10], 1000, 500); assert.equal(capped.reason, 'capped'); assert.ok(Math.abs(capped.dx) <= 150 + 1e-9);
    assert.deepEqual(M.guard(man, v, [3, -4], 1000, 500), { dx: 3, dy: -4, reason: null });
  });

  await test('no registry / empty registry → mode off and the baseline engine is used', async () => {
    M.deps.fetch = async () => ({ ok: false, status: 404 }); M.deps.loadOrt = async () => fakeOrt;
    const off = await M.freeze({ core: 'In_mind core 2.3' }); assert.equal(off.mode, 'off'); assert.equal(off.reason, 'registry-unavailable');
    env(registry()); const none = await M.freeze({ core: 'In_mind core 2.3' }); assert.equal(none.mode, 'off'); assert.equal(none.reason, 'no-model-registered');
    assert.equal(M.infer(none, {}, { x: 1, y: 1 }, 100, 100, () => {}), false);
    assert.equal(M.describe(none).mode, 'off');
  });

  await test('active entry loads, verifies hash + test vectors, is frozen per session and infers asynchronously with single in-flight run', async () => {
    env(registry({ active: entry() }));
    const gm = await M.freeze({ core: 'In_mind core 2.3' });
    assert.equal(gm.mode, 'active'); assert.equal(gm.sha256, sha); assert.equal(gm.contract, 'add-residual'); assert.deepEqual(gm.features, features);
    const results = [];
    const f = { u: 0.5, v: 0, yaw: 0, pitch: 0, eyes: { left: { u: 0.5, v: 0, q: 0.9 }, right: { u: 0.5, v: 0, q: 0.9 } } };
    const ok1 = M.infer(gm, f, { x: 800, y: 400, mode: 'both' }, 1000, 500, r => results.push(r));
    const ok2 = M.infer(gm, f, { x: 800, y: 400, mode: 'both' }, 1000, 500, r => results.push(r));
    assert.equal(ok1, true); assert.equal(ok2, false, 'second frame dropped while busy (capture never blocks)');
    await M.drain(gm);
    assert.equal(results.length, 1); assert.equal(gm.dropped, 1); assert.equal(gm.inferred, 1);
    assert.ok(Math.abs(results[0].dx - 0.01 * (0.8 - 0.5) / 0.3) < 1e-6, 'delta from standardised baseX');
    const d = M.describe(gm); assert.equal(d.inferred, 1); assert.equal(d.ortVersion, M.ORT_VERSION); assert.ok(!('run' in d) && !('manifest' in d));
    /* 세션 중 registry 가 바뀌어도 고정된 gm 은 변하지 않는다 */
    env(registry({ active: entry({ id: 'other' }) })); assert.equal(gm.id, 'gaze-residual-test');
  });

  await test('hash mismatch, test-vector mismatch, foreign URL, denied feature and unsupported core all fail closed to mode off', async () => {
    env(registry({ active: entry() }), manifest(), Buffer.from('tampered'));
    let gm = await M.freeze({ core: 'In_mind core 2.3' }); assert.equal(gm.mode, 'off'); assert.equal(gm.loadError, 'model-hash-mismatch');
    env(registry({ active: entry() }), { ...manifest(), testVectors: [{ input: [1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], output: [0.5, 0.5] }] });
    gm = await M.freeze({ core: 'In_mind core 2.3' }); assert.equal(gm.mode, 'off'); assert.equal(gm.loadError, 'test-vector-mismatch');
    env(registry({ active: entry({ url: 'https://evil.example/model.onnx' }) })); gm = await M.freeze({ core: 'In_mind core 2.3' }); assert.equal(gm.loadError, 'model-url-not-allowed');
    env(registry({ active: entry() }), { ...manifest(), features: ['baseX', 'baseY', 'u', 'v', 'yaw', 'clickX'] }); gm = await M.freeze({ core: 'In_mind core 2.3' }); assert.match(gm.loadError, /feature-denied:clickX/);
    env(registry({ active: entry() })); gm = await M.freeze({ core: 'In_mind core 2.4' }); assert.match(gm.loadError, /unsupported-core/);
    env(registry({ active: entry({ sha256: 'f'.repeat(64) }) })); gm = await M.freeze({ core: 'In_mind core 2.3' }); assert.equal(gm.loadError, 'registry-manifest-hash-mismatch');
    assert.equal(M.sameOriginPath('models/gaze/x/../../secret.onnx'), false);
  });

  await test('feature version: a manifest with supports.features loads on any engine version with the same features and refuses other features', async () => {
    const fm = () => ({ ...manifest(), supports: { ...manifest().supports, features: 'gaze-features-2.3' } });
    assert.deepEqual(M.validateManifest(fm(), { core: 'In_mind core 2.9', features: 'gaze-features-2.3' }), { ok: true, errors: [] });
    assert.ok(M.validateManifest(fm(), { core: 'In_mind core 2.3', features: 'gaze-features-2.4' }).errors.includes('unsupported-features:gaze-features-2.4'));
    assert.ok(M.validateManifest(manifest(), { core: 'In_mind core 2.6', features: 'gaze-features-2.3' }).errors.includes('unsupported-core:In_mind core 2.6'), 'legacy manifest keeps the core list');
    env(registry({ shadow: entry() }), fm()); const gm = await M.freeze({ core: 'In_mind core 2.6', features: 'gaze-features-2.3' }); assert.equal(gm.mode, 'shadow');
    assert.equal(require('./newbiz-core.js').GAZE_FEATURES, 'gaze-features-2.3');
    /* 운영 registry 의 shadow manifest 는 지금 엔진의 특징 버전과 맞아야 한다(맞지 않으면 그림자 자료가 조용히 끊긴다) */
    const reg = JSON.parse(require('fs').readFileSync('model-registry.json', 'utf8'));
    if (reg.shadow) { const man = JSON.parse(require('fs').readFileSync(reg.shadow.manifestUrl, 'utf8')); assert.ok(M.validateManifest(man, { core: require('./newbiz-core.js').VERSION, features: require('./newbiz-core.js').GAZE_FEATURES }).ok, 'registry shadow manifest supports current engine'); }
  });

  await test('gaze-label sessions request shadow only: an active registry entry is frozen in shadow mode and never applied', async () => {
    env(registry({ active: entry() }));
    const gm = await M.freeze({ core: 'In_mind core 2.3', mode: 'shadow' }); assert.equal(gm.mode, 'shadow');
    env(registry({ shadow: entry() }));
    const gm2 = await M.freeze({ core: 'In_mind core 2.3' }); assert.equal(gm2.mode, 'shadow', 'shadow entry never becomes active without promotion');
  });

  console.log(passed + ' gaze-model client tests passed.');
})().catch(e => { console.error(e); process.exit(1); });
