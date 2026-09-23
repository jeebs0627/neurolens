/*
 * Today's emotion index, v1. The pre-check-in supplies valence1to9.
 *
 * The number is a 0–100 rescaling of the person's present-moment valence
 * rating. Gaze, personality, and screening results are context/quality signals,
 * not unvalidated numerical corrections to a subjective feeling.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NLEmotionScore = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const VERSION = 'valence-v1';
  const TIME_ZONE = 'Asia/Seoul';
  const DAY_FORMAT = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const POSITIVE = new Set(['calm', 'happy', 'joyful', 'excited', 'thrilled']);
  const UNPLEASANT = new Set(['anxious', 'tense', 'irritable', 'sad', 'lonely',
    'empty', 'depressed', 'overwhelmed', 'low', 'flat']);

  function timestamp(value) {
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number') return value;
    return typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
  }

  function calculateEmotionScore({ checkin, signals, checkinAt, resultAt, now = Date.now() } = {}) {
    const base = { version: VERSION, score: null };
    if (!checkin || typeof checkin !== 'object') return { ...base, status: 'missing_checkin' };
    if (checkin.valence1to9 == null || checkin.valence1to9 === '') {
      return { ...base, status: 'needs_valence' };
    }
    const valence = checkin.valence1to9;
    if (typeof valence !== 'number' || !Number.isInteger(valence) || valence < 1 || valence > 9) {
      return { ...base, status: 'invalid_valence' };
    }
    if (!signals || typeof signals !== 'object') return { ...base, status: 'awaiting_measurement' };

    const checked = timestamp(checkinAt);
    const measured = timestamp(resultAt);
    const current = timestamp(now);
    if (![checked, measured, current].every(Number.isFinite)) return { ...base, status: 'missing_timestamp' };
    if (checked > measured || measured > current || checked > current) {
      return { ...base, status: 'invalid_timing' };
    }
    if (DAY_FORMAT.format(checked) !== DAY_FORMAT.format(current) || current - checked >= 24 * 60 * 60 * 1000) {
      return { ...base, status: 'expired_checkin' };
    }

    const moods = Array.isArray(checkin.moods) ? checkin.moods : [];
    const mixed = moods.some(mood => POSITIVE.has(mood)) && moods.some(mood => UNPLEASANT.has(mood));
    const quality = ['low', 'mid', 'high'].includes(signals.gaze?.quality) ? signals.gaze.quality : null;
    const screening = ['low', 'borderline', 'high'].includes(signals.screening) ? signals.screening : null;
    return {
      ...base,
      status: 'ok',
      score: Math.round((valence - 1) * 100 / 8),
      meaning: 'self_reported_present_valence',
      input: { valence1to9: valence, checkinAt: checked, resultAt: measured },
      context: {
        moods,
        mixedFeelings: mixed,
        energy1to5: Number.isInteger(checkin.energy) && checkin.energy >= 1 && checkin.energy <= 5 ? checkin.energy : null,
        gazeQuality: quality,
        screeningBand: screening,
        supportSuggested: screening === 'borderline' || screening === 'high',
      },
      weights: { selfReportedValence: 1, gaze: 0, personality: 0, screening: 0 },
    };
  }

  return { VERSION, TIME_ZONE, calculateEmotionScore };
});
