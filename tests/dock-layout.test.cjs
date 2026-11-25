const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getCollapsedSize } = require('../electron/dock-layout.cjs');
const state = { scale: 1, enabledProviders: ['codex', 'claude'], dockMetricId: 'codex:weekly',
  quota: { codex: { weekly: {} }, claude: { fiveHour: {}, weekly: { hidden: true } } } };
test('window fits legacy, multiple, empty and maximum-scale metric display', () => {
  assert.deepEqual(getCollapsedSize(state), { width: 168, height: 182 });
  assert.equal(getCollapsedSize({ ...state, dockMetricIds: ['codex:weekly', 'claude:fiveHour'] }).height, 209);
  assert.equal(getCollapsedSize({ ...state, dockMetricIds: [] }).height, 182);
  assert.equal(getCollapsedSize({ ...state, scale: 1.5, dockMetricIds: ['codex:weekly', 'claude:fiveHour'] }).height, 241);
});
test('hidden, disabled and duplicate metric selections do not enlarge the window', () => {
  assert.equal(getCollapsedSize({ ...state, dockMetricIds: ['codex:weekly', 'codex:weekly', 'claude:weekly', 'gemini:weekly', 'invalid'] }).height, 182);
});

test('period selections and migrated legacy selections size the same rows as the renderer', () => {
  const row = { family: 'gemini', modelLabel: 'Gemini 모델', limit: 100, unit: '%', resetLabel: '대기', label: 'Gemini 한도' };
  const next = { ...state, enabledProviders: ['gemini'], quota: { gemini: { periodQuotas: [
    { ...row, id: 'gemini-5h', period: 'fiveHour', used: 20 },
    { ...row, id: 'gemini-weekly', period: 'weekly', used: 70 }
  ] } } };
  assert.equal(getCollapsedSize({ ...next, dockMetricIds: ['gemini:quota:gemini-5h', 'gemini:quota:gemini-weekly'] }).height, 209);
  assert.equal(getCollapsedSize({ ...next, dockMetricIds: ['gemini:fiveHour', 'gemini:quota:gemini-weekly'] }).height, 182);
});
