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
const { getSelectedDockMetricIds, getSelectedDockMetrics, toggleDockMetric } = compiled.exports;

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
