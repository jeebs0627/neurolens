/* NeuroLens CONDITION — 시선 잔차 모델 클라이언트 (gaze-model-client-1)
 *
 * 역할: 검사 시작 시 model-registry.json 에서 승인된(active) 또는 그림자(shadow) 모델을 한 번 고정하고(세션 중 교체 없음),
 *   ONNX Runtime Web(WASM 기본)으로 추론한다. 입력은 기존 엔진의 보정 시선(g_base)과 관측 feature 뿐이며 표적·클릭·정답은 없다.
 *   출력은 잔차(dx,dy). 적용 계약은 manifest.contract 로 고정한다:
 *     'add-residual'     : g_corrected = g_base(기존 affine·잔차까지 적용한 좌표) + delta
 *     'replace-residual' : g_corrected = g_affine(기존 fitResidual 을 뺀 좌표) + delta  — 같은 잔차를 두 번 적용하지 않는다
 *   실패(로드·해시·스키마·테스트 벡터·NaN·지연)는 모두 fail-closed: 기존 엔진 좌표를 그대로 쓴다.
 *   active 모드의 보정은 분석 좌표에 적용되며(세션 종료 전 대기 중인 추론을 모두 기다린다), 화면 표시 커서는 기존 엔진 그대로다.
 *   shadow 모드는 출력만 기록(sx,sy)하고 어디에도 적용하지 않는다.
 * 브라우저: window.NLGazeModel · Node 테스트: module.exports (fetch/ort/crypto 주입 가능) */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NLGazeModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function () {
  'use strict';
  const VERSION = 'gaze-model-client-1', MANIFEST_SCHEMA = 'nl-gaze-residual-manifest-1', REGISTRY_SCHEMA = 'nl-model-registry-1';
  const REGISTRY_URL = 'model-registry.json';
  /* ONNX Runtime Web 고정 버전. 배포에서 CSP/CORS/캐시를 확인해야 한다 (COLAB_TRAINING_RUNBOOK.md) */
  const ORT_VERSION = '1.22.0', ORT_URL = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort.min.mjs`, ORT_WASM = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
  const finite = Number.isFinite;
  const deps = { fetch: null, loadOrt: null, subtle: null, now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) };
  const Labels = () => (typeof module === 'object' && module.exports ? require('./condition-labels.js') : root && root.NLLabels);
  const EYE_MODE = { both: 0, left: 1, right: 2, weighted: 3 };

  function hex(buf) { return Array.from(new Uint8Array(buf)).map(v => v.toString(16).padStart(2, '0')).join(''); }
  async function sha256(bytes) {
    const subtle = deps.subtle || (typeof crypto !== 'undefined' && crypto.subtle);
    if (subtle) return hex(await subtle.digest('SHA-256', bytes));
    return require('node:crypto').createHash('sha256').update(Buffer.from(bytes)).digest('hex');
  }
  const fetchJson = async (url, timeout = 5000) => {
    const f = deps.fetch || (typeof fetch === 'function' ? fetch : null); if (!f) throw Error('fetch-unavailable');
    const ctl = typeof AbortController === 'function' ? new AbortController() : null, timer = ctl && setTimeout(() => ctl.abort(), timeout);
    try { const r = await f(url, { cache: 'no-store', signal: ctl ? ctl.signal : undefined }); if (!r.ok) throw Error('HTTP ' + r.status); return await r.json(); } finally { if (timer) clearTimeout(timer); }
  };
  const fetchBytes = async (url, timeout = 15000) => {
    const f = deps.fetch || fetch, ctl = typeof AbortController === 'function' ? new AbortController() : null, timer = ctl && setTimeout(() => ctl.abort(), timeout);
    try { const r = await f(url, { cache: 'force-cache', signal: ctl ? ctl.signal : undefined }); if (!r.ok) throw Error('HTTP ' + r.status); return new Uint8Array(await r.arrayBuffer()); } finally { if (timer) clearTimeout(timer); }
  };
  /* 모델 URL 은 같은 출처의 상대 경로만 허용한다 (임의 URL 의 ONNX 를 검증 없이 로드하지 않는다) */
  const sameOriginPath = url => typeof url === 'string' && /^(models|\.\/models)\/[A-Za-z0-9_\-./]+\.(onnx|json)$/.test(url) && !url.includes('..');

  /* manifest 검증: 스키마·feature allowlist·버전 범위·입출력 shape·해시 형식·테스트 벡터 */
  function validateManifest(m, env = {}) {
    const L = Labels(), errors = [];
    if (!m || m.schema !== MANIFEST_SCHEMA) errors.push('schema');
    if (!m || !Array.isArray(m.features) || !m.features.length) errors.push('features');
    else { const chk = L.checkFeatureNames(m.features); if (!chk.ok) errors.push('feature-denied:' + chk.rejected.join(',')); }
    if (!m || !/^[0-9a-f]{64}$/.test(m.sha256 || '')) errors.push('sha256');
    if (!m || !['add-residual', 'replace-residual'].includes(m.contract)) errors.push('contract');
    const pp = m && m.preprocessing;
    if (!pp || !Array.isArray(pp.mean) || !Array.isArray(pp.std) || pp.mean.length !== (m.features || []).length || pp.std.length !== pp.mean.length) errors.push('preprocessing');
    const D = (m && m.features ? m.features.length : 0) * (pp && pp.mask ? 2 : 1);
    if (!m || !m.input || !Array.isArray(m.input.shape) || m.input.shape[1] !== D) errors.push('input-shape');
    if (!m || !m.output || !Array.isArray(m.output.shape) || m.output.shape[1] !== 2) errors.push('output-shape');
    if (!m || !Array.isArray(m.testVectors) || !m.testVectors.length) errors.push('test-vectors');
    if (m && Array.isArray(m.supports?.core) && env.core && !m.supports.core.includes(env.core)) errors.push('unsupported-core:' + env.core);
    if (m && m.supports?.labelsVersion && L.VERSION !== m.supports.labelsVersion) errors.push('unsupported-labels-version');
    if (m && finite(m.supports?.maxOpset) && finite(m.opset) && m.opset > m.supports.maxOpset) errors.push('opset');
    return { ok: errors.length === 0, errors };
  }

  /* feature 벡터: manifest.features 순서, 표준화, 결측은 0(평균)으로 두고 mask 비트에 1 을 기록한다(정상 관측으로 해석하지 않도록) */
  function featureValues(f, base, W, H) {
    const eyes = f && f.eyes;
    return {
      baseX: base && finite(base.x) && W > 0 ? base.x / W : NaN, baseY: base && finite(base.y) && H > 0 ? base.y / H : NaN,
      u: f ? f.u : NaN, v: f ? f.v : NaN, uLeft: eyes && eyes.left ? eyes.left.u : NaN, vLeft: eyes && eyes.left ? eyes.left.v : NaN, uRight: eyes && eyes.right ? eyes.right.u : NaN, vRight: eyes && eyes.right ? eyes.right.v : NaN,
      qLeft: eyes && eyes.left ? eyes.left.q : NaN, qRight: eyes && eyes.right ? eyes.right.q : NaN, open: f ? f.open : NaN, yaw: f ? f.yaw : NaN, pitch: f ? f.pitch : NaN,
      cx: f ? f.cx : NaN, cy: f ? f.cy : NaN, fw: f ? f.fw : NaN, blink: f && finite(f.blink) ? f.blink : NaN, eyeQ: f && finite(f.eyeQ) ? f.eyeQ : (eyes ? Math.max(eyes.left ? eyes.left.q : 0, eyes.right ? eyes.right.q : 0) : NaN),
      lag: f && finite(f.lag) ? f.lag : NaN, eyeMode: base && base.mode in EYE_MODE ? EYE_MODE[base.mode] : (base ? 0 : NaN),
    };
  }
  function vectorize(manifest, values) {
    const pp = manifest.preprocessing, n = manifest.features.length, out = new Float32Array(pp.mask ? 2 * n : n);
    let missing = 0;
    manifest.features.forEach((k, i) => {
      const v = values[k], sd = pp.std[i] || 1;
      if (finite(v)) out[i] = (v - pp.mean[i]) / sd; else { out[i] = 0; missing++; if (pp.mask) out[n + i] = 1; }
    });
    if (pp.clip) for (let i = 0; i < n; i++) out[i] = Math.max(-pp.clip, Math.min(pp.clip, out[i]));
    return { vector: out, missing };
  }

  /* 안전 제한: 입력 분포 범위(validation 에서 정한 z 한계)·보정 크기 상한. 넘으면 보정을 줄이거나 0 으로 두고 이유를 남긴다. 알려진 표적으로 snap 하지 않는다 */
  function guard(manifest, vec, delta, W, H) {
    const g = manifest.guard || {}, zmax = finite(g.zMax) ? g.zMax : 4, cap = finite(g.maxCorrectionFrac) ? g.maxCorrectionFrac : 0.15, maxMissing = finite(g.maxMissing) ? g.maxMissing : 2;
    let reason = null, dx = delta[0], dy = delta[1];
    if (!finite(dx) || !finite(dy)) return { dx: 0, dy: 0, reason: 'non-finite-output' };
    if (vec.missing > maxMissing) return { dx: 0, dy: 0, reason: 'too-many-missing' };
    const n = manifest.features.length; for (let i = 0; i < n; i++) if (Math.abs(vec.vector[i]) > zmax) return { dx: 0, dy: 0, reason: 'out-of-distribution' };
    const mx = cap * W, my = cap * H;
    if (Math.abs(dx) > mx || Math.abs(dy) > my) { const s = Math.min(mx / Math.abs(dx || 1e-9), my / Math.abs(dy || 1e-9), 1); dx *= s; dy *= s; reason = 'capped'; }
    return { dx, dy, reason };
  }

  async function loadOrt() {
    if (deps.loadOrt) return deps.loadOrt();
    const ort = await import(/* webpackIgnore: true */ ORT_URL);
    ort.env.wasm.wasmPaths = ORT_WASM; ort.env.wasm.numThreads = 1;
    return ort;
  }

  /* 검사 시작 시 1회: registry → 항목 선택 → manifest/모델 로드 → 해시·스키마·테스트 벡터 검증 → 세션 고정 */
  async function freeze(env = {}) {
    const started = deps.now();
    const flag = (() => { try { return new URLSearchParams(root.location ? root.location.search : '').get('gazemodel'); } catch (_) { return null; } })();
    if (flag === 'off') return { mode: 'off', reason: 'url-flag-off', clientVersion: VERSION };
    let registry;
    try { registry = await fetchJson(env.registryUrl || REGISTRY_URL); } catch (e) { return { mode: 'off', reason: 'registry-unavailable', loadError: String(e.message || e), clientVersion: VERSION }; }
    if (!registry || registry.schema !== REGISTRY_SCHEMA) return { mode: 'off', reason: 'registry-schema', clientVersion: VERSION };
    /* 선택: URL 플래그 shadow/active 가 있으면 그 역할의 항목만, 없으면 active → shadow 순. env.mode='shadow' 는 라벨 수집 모드에서 적용 금지용 */
    const wantActive = flag === 'active' || (!flag && env.mode !== 'shadow');
    let entry = null, mode = null;
    if (wantActive && registry.active && registry.active.kind === 'gaze-residual') { entry = registry.active; mode = 'active'; }
    else if (registry.shadow && registry.shadow.kind === 'gaze-residual') { entry = registry.shadow; mode = 'shadow'; }
    else if (!wantActive && registry.active && registry.active.kind === 'gaze-residual') { entry = registry.active; mode = 'shadow'; }
    if (!entry) return { mode: 'off', reason: 'no-model-registered', registryUpdatedAt: registry.updatedAt || null, clientVersion: VERSION };
    const base = { id: entry.id, version: entry.version || null, requestedMode: mode, registryUpdatedAt: registry.updatedAt || null, clientVersion: VERSION };
    try {
      if (!sameOriginPath(entry.manifestUrl) || !sameOriginPath(entry.url)) throw Error('model-url-not-allowed');
      const manifest = await fetchJson(entry.manifestUrl);
      const valid = validateManifest(manifest, env);
      if (!valid.ok) throw Error('manifest-invalid:' + valid.errors.join('|'));
      if (entry.sha256 && entry.sha256 !== manifest.sha256) throw Error('registry-manifest-hash-mismatch');
      const bytes = await fetchBytes(entry.url);
      const digest = await sha256(bytes);
      if (digest !== manifest.sha256) throw Error('model-hash-mismatch');
      const ort = await loadOrt();
      const session = await ort.InferenceSession.create(bytes, { executionProviders: env.providers || ['wasm'], graphOptimizationLevel: 'all' });
      const inputName = session.inputNames[0], outputName = session.outputNames[0];
      const run = async vector => { const out = await session.run({ [inputName]: new ort.Tensor('float32', vector, [1, vector.length]) }); return Array.from(out[outputName].data); };
      /* 테스트 벡터: Python/ONNX Runtime 과 같은 입력에서 같은 출력(허용 오차 manifest.tolerance, 기본 abs 1e-5 · rel 1e-4) */
      const tol = manifest.tolerance || { abs: 1e-5, rel: 1e-4 }, lat = [];
      for (const tv of manifest.testVectors) {
        const t0 = deps.now(), y = await run(Float32Array.from(tv.input)); lat.push(deps.now() - t0);
        tv.output.forEach((e, i) => { if (!(Math.abs(y[i] - e) <= tol.abs + tol.rel * Math.abs(e))) throw Error('test-vector-mismatch'); });
      }
      lat.sort((a, b) => a - b);
      const gm = { ...base, mode, manifest, sha256: digest, bytes: bytes.length, contract: manifest.contract, features: manifest.features.slice(), preprocessing: { mask: !!manifest.preprocessing.mask, clip: manifest.preprocessing.clip ?? null, version: manifest.preprocessing.version || null },
        latency: { testVectors: lat.length, p50: lat[Math.floor(lat.length / 2)], max: lat.at(-1) }, loadMs: Math.round(deps.now() - started), run, pending: 0, dropped: 0, inferred: 0, guardReasons: {}, errors: 0, busy: false, waiters: [] };
      return gm;
    } catch (e) {
      /* 기존 엔진으로 fail-closed. 실패 이유는 연구 기록에 남긴다 */
      return { ...base, mode: 'off', reason: 'load-failed', loadError: String(e.message || e).slice(0, 200), loadMs: Math.round(deps.now() - started) };
    }
  }

  /* 프레임 추론 요청: 동시에 하나만 돌리고, 바쁘면 이 프레임은 건너뛴다(카메라 캡처를 막지 않는다). 결과는 콜백으로 표본에 붙인다 */
  function infer(gm, f, base, W, H, onResult) {
    if (!gm || gm.mode === 'off' || !gm.run) return false;
    if (gm.busy) { gm.dropped++; return false; }
    const vec = vectorize(gm.manifest, featureValues(f, base, W, H));
    gm.busy = true; gm.pending++;
    const t0 = deps.now();
    gm.run(vec.vector).then(y0 => {
      /* 출력 단위: manifest.output.units 가 'viewport-fraction' 이면 (W,H) 를 곱해 CSS px 잔차로 바꾼 뒤 안전 제한을 적용한다 */
      const frac = gm.manifest.output && gm.manifest.output.units === 'viewport-fraction';
      const y = frac ? [y0[0] * W, y0[1] * H] : y0;
      const g = guard(gm.manifest, vec, y, W, H);
      if (g.reason) gm.guardReasons[g.reason] = (gm.guardReasons[g.reason] || 0) + 1;
      gm.inferred++;
      const ms = deps.now() - t0; gm.latencySum = (gm.latencySum || 0) + ms; gm.latencyMax = Math.max(gm.latencyMax || 0, ms);
      onResult({ dx: g.dx, dy: g.dy, raw: y0, reason: g.reason, ms, missing: vec.missing });
    }).catch(e => { gm.errors++; onResult({ dx: 0, dy: 0, reason: 'inference-error:' + String(e.message || e).slice(0, 60), ms: deps.now() - t0 }); })
      .finally(() => { gm.busy = false; gm.pending--; if (!gm.pending) gm.waiters.splice(0).forEach(r => r()); });
    return true;
  }
  /* 세션 종료 전: 대기 중인 추론을 모두 기다린다(최대 timeout). 그래야 분석 좌표에 빠진 보정이 없다 */
  function drain(gm, timeout = 2000) {
    if (!gm || !gm.pending) return Promise.resolve(true);
    return new Promise(res => { const t = setTimeout(() => res(false), timeout); gm.waiters.push(() => { clearTimeout(t); res(true); }); });
  }
  /* 연구 기록용 메타 (세션·바이트·함수는 제외) */
  function describe(gm) {
    if (!gm) return null;
    return { id: gm.id || null, version: gm.version || null, mode: gm.mode || 'off', reason: gm.reason || null, loadError: gm.loadError || null, sha256: gm.sha256 || null, contract: gm.contract || null, features: gm.features || null, preprocessing: gm.preprocessing || null,
      latency: gm.latency ? { ...gm.latency, meanMs: gm.inferred ? Math.round((gm.latencySum || 0) / gm.inferred * 100) / 100 : null, maxMs: gm.latencyMax ?? null } : null, loadMs: gm.loadMs ?? null, inferred: gm.inferred || 0, dropped: gm.dropped || 0, errors: gm.errors || 0, guardReasons: gm.guardReasons || null, clientVersion: VERSION, ortVersion: gm.run ? ORT_VERSION : null, registryUpdatedAt: gm.registryUpdatedAt || null };
  }

  return { VERSION, MANIFEST_SCHEMA, REGISTRY_SCHEMA, ORT_VERSION, EYE_MODE, deps, validateManifest, featureValues, vectorize, guard, freeze, infer, drain, describe, sameOriginPath };
});
