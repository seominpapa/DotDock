const assert = require('node:assert/strict');
const path = require('node:path');
const { expect } = require('@playwright/test');

async function verify({ page, application, saveFixtureState, outputDir, report }) {
  const rows = [['gemini-5h', 'gemini', 'fiveHour', 20], ['gemini-weekly', 'gemini', 'weekly', 70],
    ['3p-5h', 'partner', 'fiveHour', 10], ['3p-weekly', 'partner', 'weekly', 60]].map(([id, family, period, used]) => {
    const modelLabel = family === 'gemini' ? 'Gemini 모델' : 'Claude · GPT 모델';
    return { id, family, period, used, modelLabel, limit: 100, unit: '%', resetLabel: '격리된 테스트 초기화',
      label: `${modelLabel} · ${period === 'fiveHour' ? '5시간 (5h)' : '일주일 (7d)'}` };
  });
  const current = await page.evaluate(() => window.dotdock.getState());
  await saveFixtureState({ quota: { ...current.quota, gemini: { ...current.quota.gemini, periodQuotas: rows } } });
  const card = page.locator('section.provider-card').filter({ has: page.locator('.provider-name').filter({ hasText: /^Antigravity · Gemini$/ }) });
  await expect(card.getByRole('checkbox')).toHaveCount(4);
  for (const row of rows) {
    const checkbox = card.getByRole('checkbox', { name: row.label, exact: true });
    await checkbox.check();
    await expect(page.locator(`.pill-quota-item[data-metric-id="gemini:quota:${row.id}"]`)).toContainText(`${100 - row.used}`);
  }
  await expect(page.locator('.pill-quota-item')).toHaveCount(6);
  assert.ok(await page.locator('.pill-quota-name').evaluateAll(labels => labels.every(label => label.scrollWidth <= label.clientWidth)),
    'the 5h/7d suffix must remain visible in the collapsed dock');
  const first = card.getByRole('checkbox', { name: new RegExp(rows[0].label.replace(/[()]/g, '\\$&')) });
  await first.uncheck();
  await expect(page.locator('.pill-quota-item')).toHaveCount(5);
  await expect(page.locator('.pill-quota-item[data-metric-id="gemini:quota:gemini-weekly"]')).toBeVisible();
  await first.check();
  report.selectedQuotaIds = (await page.evaluate(() => window.dotdock.getState())).dockMetricIds;
  assert.equal(report.selectedQuotaIds.length, 6);
  await page.screenshot({ path: path.join(outputDir, 'antigravity-period-quotas.png') });
  const state = await page.evaluate(() => window.dotdock.getState());
  const expected = require('../electron/dock-layout.cjs').getCollapsedSize(state);
  report.periodQuotaCollapsedSize = expected;
  report.checks.push('four Antigravity shared family-period checkboxes independently pin distinct percentages without hiding other selections');
}

verify.verifyRestart = async ({ page, report }) => {
  const state = await page.evaluate(() => window.dotdock.getState());
  assert.deepEqual(state.dockMetricIds, report.selectedQuotaIds);
  assert.deepEqual(state.quota.gemini.periodQuotas.map(row => row.used), [20, 70, 10, 60]);
  await expect(page.locator('.pill-quota-item')).toHaveCount(6);
  report.checks.push('all four Antigravity period quota selections and percentages survive an actual app restart');
};
module.exports = verify;
