const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parsePeriodQuotas, normalizePeriodQuotas, normalizeMetricIds, resolvePeriodSelections } = require('../electron/antigravity-quota.cjs');

const summary = { response: { groups: [
  { displayName: 'Gemini Models', buckets: [
    { bucketId: 'gemini-weekly', window: 'weekly', remainingFraction: 0.3 },
    { bucketId: 'gemini-5h', window: '5h', remainingFraction: 0.8 }
  ] },
  { displayName: 'Claude and GPT models', buckets: [
    { bucketId: '3p-weekly', window: 'weekly', remainingFraction: 0.4 },
    { bucketId: '3p-5h', window: '5h', remainingFraction: 0.9 }
  ] }
] } };
const rows = () => parsePeriodQuotas(summary).map(q => ({ ...q, used: Math.round((1 - q.remainingFraction) * 100),
  limit: 100, unit: '%', resetLabel: '초기화 시간 미제공', label: `${q.modelLabel} ${q.period}` }));

test('real summary shape keeps all four shared family-period quotas separate and IDs stable', () => {
  const parsed = parsePeriodQuotas(summary);
  assert.deepEqual(parsed.map(q => [q.id, q.family, q.period, q.remainingFraction]), [
    ['gemini-5h', 'gemini', 'fiveHour', 0.8], ['gemini-weekly', 'gemini', 'weekly', 0.3],
    ['3p-5h', 'partner', 'fiveHour', 0.9], ['3p-weekly', 'partner', 'weekly', 0.4]
  ]);
  const reversed = { groups: [...summary.response.groups].reverse().map(g => ({ ...g, buckets: [...g.buckets].reverse() })) };
  assert.deepEqual(parsePeriodQuotas(reversed), parsed);
});

test('periods require explicit metadata, never infer a window from reset date or missing fraction', () => {
  assert.deepEqual(parsePeriodQuotas({ groups: [{ displayName: 'Gemini', buckets: [
    { bucketId: 'unknown', remainingFraction: 0.2, resetTime: '2030-01-01T00:00:00Z' },
    { bucketId: 'gemini-5h', window: '5h', resetTime: '2030-01-01T00:00:00Z' },
    { bucketId: 'bad', window: 'weekly', remainingFraction: -1 },
    { bucketId: 'bad2', window: 'weekly', remainingFraction: true },
    { bucketId: 'disabled', window: 'weekly', remainingFraction: 0, disabled: true }
  ] }] }), []);
});

test('normalizes safe snapshots and selections, bounds entries and rejects fabricated values', () => {
  const valid = rows();
  assert.equal(normalizePeriodQuotas(valid).length, 4);
  assert.deepEqual(normalizePeriodQuotas([{ ...valid[0], used: NaN }, { ...valid[0], id: '../secret' },
    { ...valid[0], label: 'bad\nlabel' }, { ...valid[0], period: 'unknown' }, { ...valid[0], limit: 0 }]), []);
  assert.deepEqual(normalizeMetricIds(['gemini:quota:gemini-5h', 'gemini:quota:gemini-5h', 'gemini:quota:../bad', 'invalid', 'codex:weekly']),
    ['gemini:quota:gemini-5h', 'codex:weekly']);
  assert.equal(normalizePeriodQuotas(Array.from({ length: 100 }, (_, i) => ({ ...valid[0], id: `quota-${i}` }))).length, 64);
});

test('legacy group selections resolve to one most-used period and explicit selections stay independent', () => {
  const quota = { periodQuotas: rows() };
  assert.deepEqual(resolvePeriodSelections(quota, ['gemini:fiveHour', 'gemini:weekly']),
    ['gemini:quota:gemini-weekly', 'gemini:quota:3p-weekly']);
  assert.deepEqual(resolvePeriodSelections(quota, ['gemini:quota:gemini-5h', 'gemini:quota:gemini-weekly', 'gemini:quota:missing']),
    ['gemini:quota:gemini-5h', 'gemini:quota:gemini-weekly', 'gemini:quota:missing']);
});
