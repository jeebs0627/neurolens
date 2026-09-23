const assert = require('node:assert/strict');
const test = require('node:test');
const { calculateEmotionScore } = require('./emotion-score');
const { normalizeCheckin, normalizeResult } = require('./care-preview');

const checkinAt = '2026-09-23T10:00:00+09:00';
const resultAt = '2026-09-23T10:10:00+09:00';
const now = '2026-09-23T10:20:00+09:00';
const run = (valence, signals = { gaze: { quality: 'high' }, screening: 'low' }) =>
  calculateEmotionScore({ checkin: { valence1to9: valence, moods: ['excited', 'anxious'], energy: 2 },
    signals, checkinAt, resultAt, now });

test('1–9 valence maps linearly to 0–100; neutral is 50', () => {
  assert.deepEqual([1, 3, 5, 7, 9].map(value => run(value).score), [0, 25, 50, 75, 100]);
  assert.equal(run(5).context.mixedFeelings, true);
});

test('screening and gaze quality do not silently change the emotion score', () => {
  const normal = run(7);
  const flagged = run(7, { gaze: { quality: 'low' }, screening: 'high', big5: { N: 100 } });
  assert.equal(flagged.score, normal.score);
  assert.equal(flagged.context.supportSuggested, true);
  assert.equal(flagged.context.gazeQuality, 'low');
  assert.equal(flagged.weights.gaze, 0);
});

test('missing or invalid valence does not manufacture a number', () => {
  assert.equal(run(undefined).status, 'needs_valence');
  assert.equal(run(5.5).status, 'invalid_valence');
  assert.equal(run('5').status, 'invalid_valence');
  assert.equal(run(5, null).status, 'awaiting_measurement');
});

test('a result from a different sequence or day cannot be labelled today', () => {
  const input = { checkin: { valence1to9: 7 }, signals: {}, checkinAt, resultAt, now };
  assert.equal(calculateEmotionScore({ ...input, resultAt: '2026-09-23T09:00:00+09:00' }).status, 'invalid_timing');
  assert.equal(calculateEmotionScore({ ...input, now: '2026-09-24T00:01:00+09:00' }).status, 'expired_checkin');
});

test('the check-in and measurement normalizers preserve the score input', () => {
  const raw = { moods: ['excited', 'anxious'], issue: 'career', energy: 4,
    valence1to9: 7, expectation: 'yes', worry: 'yes' };
  const checkin = normalizeCheckin(raw);
  const signals = normalizeResult({ gazeMetrics: { quality: 'good' }, depressionScreening: { band: 'low' } });
  assert.equal(checkin.valence1to9, 7);
  assert.equal(calculateEmotionScore({ checkin, signals, checkinAt, resultAt, now }).score, 75);
  assert.equal(normalizeCheckin({ ...raw, valence1to9: 10 }), null);
  assert.equal(normalizeCheckin({ ...raw, valence1to9: null }).valence1to9, undefined);
});
