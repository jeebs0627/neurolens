'use strict';
/* 데이터 수집 모드: 환경 메모 검증 · protocol.collect 전달 · 모듈 하나만 있는 기록의 분석 */
const assert = require('node:assert/strict');
const E = require('./collect-env.js'), D = require('./condition-dataset.js'), R = require('./newbiz-research.js'), B = require('./newbiz-battery.js');

/* 1) 메모: 알려진 키·선택지만, 숫자 범위, 글자 수 제한 */
assert.equal(E.clean(null), null);
assert.equal(E.clean({ device: '해킹', screenIn: 'abc', evil: 1 }), null);
assert.deepEqual(E.clean({ device: '노트북', screenIn: '15.64', light: '자연광', note: '  창가 ' }), { device: '노트북', screenIn: 15.6, light: '자연광', note: '창가' });
assert.equal(E.clean({ screenIn: 500 }), null);
assert.equal(E.clean({ note: 'x'.repeat(400) }).note.length, 300);
assert.equal(E.text({ device: '스마트폰', screenIn: 6.1, note: '거치대' }), '스마트폰 · 6.1″ · 거치대');

/* 2) 수집 모듈 표시는 dataset 감사(audit)와 연구 meta 양쪽에 남는다 */
const collect = { module: 'rppg', page: 'datacollection-1', env: { device: '노트북' }, dur: { recovery: 120 } };
const rec = { attemptId: '12345678-1234-1234-1234-123456789012', startedAt: 0, endedAt: 2000, lab: ['recovery'], collect, steps: { recovery: { status: 'done' } }, phases: { recovery: { start: 0, end: 2000 } }, frames: [{ t: 0, ok: true }, { t: 1000, ok: true }], telemetry: { steps: {}, drift: [] } };
assert.deepEqual(D.build(rec).protocol, { kind: 'lab', steps: ['recovery'], collect });
assert.deepEqual(R.pack(rec, null, { research: true }).meta.protocol, { kind: 'lab', steps: ['recovery'], collect });
assert.deepEqual(D.build({ ...rec, collect: null }).protocol, { kind: 'lab', steps: ['recovery'] });

/* 3) 호흡 따라하기만 측정한 기록도 분석이 끝나고 회복 구간 맥파 근거가 나온다 */
const sim = B.simulate('balanced', { mode: 'full', include: { alert: false, oculo: false, sustain: false, core: true }, seed: 3 });
Object.keys(sim.steps).forEach(k => { if (k !== 'recovery') sim.steps[k] = { status: 'off' }; });
const res = B.run({ ...sim, lab: ['recovery'], collect });
const pulse = D.build({ ...sim, lab: ['recovery'], collect }, res).tests.find(t => t.key === 'recovery').pulse;
assert.ok(pulse && Number.isFinite(pulse.bpm), 'recovery pulse evidence');
console.log('PASS collect env validation, protocol.collect propagation, recovery-only analysis');
