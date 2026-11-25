const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../src/services/quotaMetrics.ts');
const compiled = new Module(filename, module);
compiled.filename = filename;
compiled.paths = module.paths;
compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, filename);
const { getAvailableDockMetrics, getSelectedDockMetricIds, getSelectedDockMetrics, toggleDockMetric,
  normalizeAntigravityPeriodQuotas, normalizeDockMetricIds } = compiled.exports;

function state(patch = {}) {
  const bucket = { used: 25, limit: 100, unit: '%', resetLabel: '대기' };
  return {
    enabledProviders: ['codex', 'claude', 'gemini'],
    dockMetricId: 'codex:weekly',
    quota: {
      codex: { fiveHour: { ...bucket }, weekly: { ...bucket } },
      claude: { fiveHour: { ...bucket }, weekly: { ...bucket }, fable: { ...bucket, hidden: true } },
      gemini: { fiveHour: { ...bucket }, weekly: { ...bucket } }
    },
    ...patch
  };
}

test('preserves legacy single selection when no multi-selection was saved', () => {
  assert.deepEqual(getSelectedDockMetricIds(state()), ['codex:weekly']);
  assert.deepEqual(getSelectedDockMetrics(state()).map((metric) => metric.id), ['codex:weekly']);
  assert.deepEqual(getSelectedDockMetricIds(state({ dockMetricId: undefined })), ['codex:fiveHour']);
});

test('renders every selected metric once with its own remaining percentage', () => {
  const metrics = getSelectedDockMetrics(state({ dockMetricIds: ['codex:weekly', 'claude:fiveHour', 'codex:weekly'] }));
  assert.deepEqual(metrics.map((metric) => metric.id), ['codex:weekly', 'claude:fiveHour']);
  assert.ok(metrics.every((metric) => metric.remainingPercent === 75));
});

test('explicit empty selection stays empty instead of restoring the legacy choice', () => {
  assert.deepEqual(getSelectedDockMetricIds(state({ dockMetricIds: [] })), []);
  assert.deepEqual(getSelectedDockMetrics(state({ dockMetricIds: [] })), []);
});

test('hidden or disabled-provider metrics are not displayed', () => {
  const selected = state({ enabledProviders: ['codex'], dockMetricIds: ['codex:weekly', 'claude:weekly', 'claude:fable'] });
  assert.deepEqual(getSelectedDockMetrics(selected).map((metric) => metric.id), ['codex:weekly']);
  const hidden = state({ enabledProviders: ['claude'], dockMetricIds: ['codex:weekly', 'claude:fable'] });
  hidden.quota.claude.fiveHour.hidden = true;
  hidden.quota.claude.weekly.hidden = true;
  assert.deepEqual(getSelectedDockMetrics(hidden), []);
});

test('toggles independently without mutating state or losing unavailable selections', () => {
  const current = state({ dockMetricIds: ['codex:weekly', 'claude:fable'] });
  assert.deepEqual(toggleDockMetric(current, 'claude:fiveHour'), ['codex:weekly', 'claude:fable', 'claude:fiveHour']);
  assert.deepEqual(toggleDockMetric(current, 'codex:weekly'), ['claude:fable']);
  assert.deepEqual(current.dockMetricIds, ['codex:weekly', 'claude:fable']);
  assert.deepEqual(toggleDockMetric(state(), 'codex:weekly'), []);
});

function withPeriodQuotas(patch = {}) {
  const current = state(patch);
  current.quota.gemini.periodQuotas = [
    ['gemini-5h', 'gemini', 'fiveHour', 10], ['gemini-weekly', 'gemini', 'weekly', 35],
    ['3p-5h', 'partner', 'fiveHour', 0], ['3p-weekly', 'partner', 'weekly', 51]
  ].map(([id, family, period, used]) => ({ id, family, period, used,
    modelLabel: family === 'gemini' ? 'Gemini 모델' : 'Claude · GPT 모델',
    label: `${family === 'gemini' ? 'Gemini 모델' : 'Claude · GPT 모델'} · ${period === 'fiveHour' ? '5시간 (5h)' : '일주일 (7d)'}`,
    limit: 100, unit: '%', resetLabel: `${id} 초기화` }));
  return current;
}

test('Antigravity preserves separate family and period percentages instead of merging quotas', () => {
  const current = withPeriodQuotas({ dockMetricIds: ['gemini:quota:gemini-5h', 'gemini:quota:gemini-weekly',
    'gemini:quota:3p-5h', 'gemini:quota:3p-weekly'] });
  const options = getAvailableDockMetrics(current).filter(metric => metric.provider === 'gemini');
  assert.deepEqual(options.map(metric => metric.remainingPercent), [90, 65, 100, 49]);
  assert.deepEqual(options.map(metric => metric.label), current.quota.gemini.periodQuotas.map(bucket => bucket.label));
  assert.deepEqual(options.map(metric => metric.shortLabel), ['Gemini 5h', 'Gemini 7d', 'AG C/G 5h', 'AG C/G 7d']);
  assert.ok(options.every(metric => metric.bucketKey === 'quota'));
  assert.equal(getSelectedDockMetrics(current).length, 4);
  assert.equal(getAvailableDockMetrics(current).filter(metric => metric.provider !== 'gemini').length, 4);
});

test('legacy Antigravity selections map once to each family most-used period with deterministic ties', () => {
  const current = withPeriodQuotas({ dockMetricIds: ['codex:weekly', 'gemini:fiveHour', 'gemini:weekly', 'gemini:quota:3p-weekly'] });
  assert.deepEqual(getSelectedDockMetricIds(current), ['codex:weekly', 'gemini:quota:gemini-weekly', 'gemini:quota:3p-weekly']);
  assert.deepEqual(toggleDockMetric(current, 'gemini:quota:gemini-5h'),
    ['codex:weekly', 'gemini:quota:gemini-weekly', 'gemini:quota:3p-weekly', 'gemini:quota:gemini-5h']);
  assert.deepEqual(toggleDockMetric(current, 'gemini:quota:gemini-weekly'), ['codex:weekly', 'gemini:quota:3p-weekly']);
  current.quota.gemini.periodQuotas = current.quota.gemini.periodQuotas.map(bucket => ({ ...bucket, used: 0 })).reverse();
  assert.deepEqual(getSelectedDockMetricIds(current), ['codex:weekly', 'gemini:quota:gemini-5h', 'gemini:quota:3p-5h', 'gemini:quota:3p-weekly']);
  assert.ok(current.dockMetricIds.includes('gemini:fiveHour'), 'resolving selections does not mutate saved state');
});

test('explicit period selections survive temporary missing data and labels changing', () => {
  const current = withPeriodQuotas({ dockMetricIds: ['gemini:quota:gemini-5h', 'gemini:quota:future-model-weekly'] });
  current.quota.gemini.periodQuotas = current.quota.gemini.periodQuotas.map(bucket => ({ ...bucket, label: '새 표시 이름' }));
  assert.deepEqual(getSelectedDockMetricIds(current), ['gemini:quota:gemini-5h', 'gemini:quota:future-model-weekly']);
  assert.deepEqual(toggleDockMetric(current, 'gemini:quota:gemini-weekly'),
    ['gemini:quota:gemini-5h', 'gemini:quota:future-model-weekly', 'gemini:quota:gemini-weekly']);
  delete current.quota.gemini.periodQuotas;
  assert.deepEqual(getSelectedDockMetricIds(current), ['gemini:quota:gemini-5h', 'gemini:quota:future-model-weekly']);
  assert.deepEqual(getSelectedDockMetrics(current), []);
});

test('invalid period data cannot create fabricated zero-usage rows or unsafe selections', () => {
  const [valid] = withPeriodQuotas().quota.gemini.periodQuotas;
  const entries = [valid, { ...valid, id: 'invalid-period', period: 'unknown' },
    { ...valid, id: 'missing-used', used: undefined }, { ...valid, id: 'infinite', used: Infinity },
    { ...valid, id: '../unsafe' }, { ...valid, id: 'html', modelLabel: 'bad\nlabel' },
    { ...valid, id: 'bad-limit', limit: 0 }, { ...valid, id: 'bad-family', family: 'other' },
    { ...valid, id: undefined }, { ...valid, id: ['array-id'] }, valid];
  assert.deepEqual(normalizeAntigravityPeriodQuotas(entries), [valid]);
  assert.deepEqual(normalizeDockMetricIds(['gemini:quota:gemini-5h', 'gemini:quota:../unsafe',
    'codex:weekly', 'codex:weekly', null, 'gemini:quota:future-weekly']),
  ['gemini:quota:gemini-5h', 'codex:weekly', 'gemini:quota:future-weekly']);
  const current = state();
  current.quota.gemini.periodQuotas = entries;
  assert.equal(getAvailableDockMetrics(current).filter(metric => metric.provider === 'gemini').length, 1);
});

test('legacy Antigravity fallback explicitly states that no period was supplied', () => {
  const options = getAvailableDockMetrics(state()).filter(metric => metric.provider === 'gemini');
  assert.ok(options.every(metric => metric.label.includes('기간 미제공')));
  assert.ok(options.every(metric => !/5h|7d/.test(metric.shortLabel)));
});
