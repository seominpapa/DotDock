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
