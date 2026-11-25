const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron, expect } = require('@playwright/test');
const { version } = require('../package.json');
const verify3D = require('./smoke-3d.cjs');
const verifySchedules = require('./smoke-schedules.cjs');
const verifyAntigravityQuota = require('./smoke-antigravity-quota.cjs');

const projectDir = path.resolve(__dirname, '..');
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotdock-smoke-'));
const quotaFile = path.join(profileDir, 'quota.json');
const outputDir = path.resolve(process.env.DOTDOCK_SMOKE_OUTPUT || 'test-results/electron');
const report = { version, platform: process.platform, arch: process.arch, checks: [] };
const rendererErrors = [];
const rendererNetworkRequests = [];
report.rendererConsole = [];
let application;
let page;

async function launch() {
  const env = { ...process.env, DOTDOCK_SMOKE_TEST: '1',
    DOTDOCK_TEST_USER_DATA: profileDir, DOTDOCK_TEST_QUOTA_FILE: quotaFile };
  delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({
    ...(process.env.DOTDOCK_EXECUTABLE ? { executablePath: process.env.DOTDOCK_EXECUTABLE } : {}),
    args: process.env.DOTDOCK_EXECUTABLE ? [] : [projectDir],
    env,
    timeout: 60_000
  });
  report.sqliteRuntime = await application.evaluate(({ BrowserWindow }) => {
    const setIgnoreMouseEvents = BrowserWindow.prototype.setIgnoreMouseEvents;
    BrowserWindow.prototype.setIgnoreMouseEvents = function (ignore, ...options) {
      this.__dotdockIgnoreMouseEvents = ignore;
      return Reflect.apply(setIgnoreMouseEvents, this, [ignore, ...options]);
    };
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
    const database = new DatabaseSync(':memory:');
    try {
      if (database.prepare('SELECT 1 AS ok').get().ok !== 1) throw new Error('Bundled SQLite unavailable');
    } finally {
      database.close();
    }
    const originalFetch = globalThis.fetch;
    globalThis.__dotdockNetworkRequests = [];
    globalThis.fetch = (...args) => {
      const input = args[0];
      const value = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
      const url = new URL(value);
      if (['http:', 'https:'].includes(url.protocol)) {
        globalThis.__dotdockNetworkRequests.push(`${url.origin}${url.pathname}`);
      }
      return Reflect.apply(originalFetch, globalThis, args);
    };
    return { electron: process.versions.electron, node: process.versions.node, sqlite: process.versions.sqlite };
  });
  page = await application.firstWindow();
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol)) rendererNetworkRequests.push(`${url.origin}${url.pathname}`);
  });
  page.on('pageerror', (error) => rendererErrors.push(error.message));
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type()) && report.rendererConsole.length < 50) {
      report.rendererConsole.push(message.text().slice(0, 500));
    }
  });
  await page.waitForFunction(() => Boolean(window.dotdock));
}

async function saveFixtureState(patch) {
  const state = await page.evaluate((value) => window.dotdock.saveState(value), patch);
  await application.evaluate(({ BrowserWindow }, payload) => {
    BrowserWindow.getAllWindows()[0].webContents.send('dotdock:command', { type: 'state-updated', payload });
  }, state);
}

async function stubAccountActions() {
  const state = await page.evaluate(() => window.dotdock.getState());
  await application.evaluate(({ ipcMain }, fixtureState) => {
    globalThis.__dotdockAuthCalls = [];
    globalThis.__dotdockAuthState = fixtureState;
    for (const channel of ['dotdock:detect-local-auth', 'dotdock:oauth-login']) {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, (_event, provider) => {
        globalThis.__dotdockAuthCalls = [...globalThis.__dotdockAuthCalls, { channel, provider }];
        return { ok: false, message: '격리된 테스트: 실제 계정에 접근하지 않습니다.', state: globalThis.__dotdockAuthState };
      });
    }
  }, state);
}

async function checkGeminiAction(card) {
  const state = await page.evaluate(() => window.dotdock.getState());
  await application.evaluate((_electron, fixtureState) => {
    globalThis.__dotdockAuthState = fixtureState;
  }, state);
  const before = await application.evaluate(() => globalThis.__dotdockAuthCalls.length);
  await card.getByRole('button', { name: '로컬 인증 감지', exact: true }).click();
  await expect.poll(() => application.evaluate(() => globalThis.__dotdockAuthCalls.length)).toBe(before + 1);
}

function geminiCard() {
  return page.locator('section.provider-card').filter({
    has: page.locator('.provider-name').filter({ hasText: /^Antigravity · Gemini$/ })
  });
}

async function verifyFirstRun() {
  const displayAge = Math.round((new Date().getFullYear() - 1996) * 0.8);
  await expect(page.getByRole('dialog', { name: 'DotDock 초기 설정', exact: true })).toBeVisible();
  await stubAccountActions();
  await page.getByPlaceholder('태어난 연도 (예: 1996)').fill('1996');
  await expect.poll(() => page.evaluate(() => window.dotdock.getState())).toMatchObject({
    birthYear: 1996, selectedZodiacId: 'rat'
  });
  await expect(page.locator('.pill-label')).toHaveText('96년생 쥐띠');
  await page.getByLabel('생년월일 (선택)', { exact: true }).fill('1996-01-01');
  await expect.poll(() => page.evaluate(() => window.dotdock.getState())).toMatchObject({
    birthYear: 1996, birthDate: '1996-01-01', selectedZodiacId: 'rat'
  });
  await expect(page.locator('.pill-label')).toHaveText(`96년생 쥐띠(${displayAge}세)`);
  for (const birthDate of ['1996-02-30', '2999-01-01']) {
    const rejected = await page.evaluate(async (value) => {
      try { await window.dotdock.saveState({ birthDate: value }); return false; }
      catch { return true; }
    }, birthDate);
    assert.equal(rejected, true);
  }
  assert.equal((await page.evaluate(() => window.dotdock.getState())).birthDate, '1996-01-01');
  report.checks.push('birthdate applies exact birthday age × 0.8; invalid/future dates rejected without losing saved identity');
  await page.getByTitle('토끼띠 (卯)', { exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.dotdock.getState())).toMatchObject({
    selectedZodiacId: 'rabbit'
  });
  await page.getByRole('button', { name: '도트', exact: true }).click();
  await expect(page.locator('.sprite-img')).toHaveClass(/is-pixel/);
  await expect.poll(() => page.locator('.zodiac-thumb-sm').evaluateAll((images) =>
    images.filter((image) => image.complete && image.naturalWidth === 64 && image.naturalHeight === 64).length)).toBe(12);
  await expect.poll(() => page.locator('.sprite-img').evaluate((image) =>
    ({ width: image.naturalWidth, height: image.naturalHeight }))).toEqual({ width: 64, height: 64 });
  await page.screenshot({ path: path.join(outputDir, 'onboarding-pixel.png') });
  await page.getByRole('button', { name: '벡터', exact: true }).click();
  await expect(page.locator('.sprite-img')).not.toHaveClass(/is-pixel/);
  await expect.poll(() => page.locator('.zodiac-thumb-sm').evaluateAll((images) =>
    images.filter((image) => image.complete && image.naturalWidth > 0).length)).toBe(12);
  await page.screenshot({ path: path.join(outputDir, 'onboarding-vector.png') });
  report.checks.push('all 12 DOT sprites load at natural 64×64; vector sprites load and style selection updates character');
  await checkGeminiAction(page.locator('.onboarding-llm-card').filter({ hasText: 'Antigravity · Gemini' }));
  await page.getByRole('button', { name: '🚀 설정 완료하고 시작하기', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'DotDock 정보 HUD', exact: true })).toBeVisible();
  report.checks.push('first-run onboarding, zodiac selection, HUD');

  await saveFixtureState({ enabledProviders: ['codex'],
    dockMetricIds: ['codex:weekly', 'claude:fiveHour'] });
  await expect(page.getByLabel('AI 현황 표시 선택', { exact: true })).toHaveCount(0);
  await expect(page.getByText('현황에 표시할 AI', { exact: true })).toHaveCount(0);
  await expect(page.locator('.pill-quota-item')).toHaveCount(1);
  const claudeCard = page.locator('section.provider-card').filter({
    has: page.locator('.provider-name').filter({ hasText: /^Claude$/ })
  });
  const claudeMetric = claudeCard.locator('.quota-pin-check').filter({ hasText: '5시간 (5h)' })
    .getByRole('checkbox');
  await expect(claudeMetric).not.toBeChecked();
  await claudeMetric.check();
  await expect(page.locator('.pill-quota-item')).toHaveCount(2);
  await expect(page.locator('.pill-quota-item[data-metric-id="codex:weekly"]')).toBeVisible();
  await expect(page.locator('.pill-quota-item[data-metric-id="claude:fiveHour"]')).toBeVisible();
  await expect.poll(() => page.evaluate(async () => (await window.dotdock.getState()).dockMetricIds))
    .toEqual(['codex:weekly', 'claude:fiveHour']);
  await expect.poll(() => page.evaluate(async () => (await window.dotdock.getState()).enabledProviders))
    .toEqual(['codex', 'claude']);
  await saveFixtureState({ enabledProviders: ['codex', 'claude', 'gemini'] });
  report.checks.push('only usage checkboxes select multiple dock rows and restore previously hidden providers');

  const stats = await page.evaluate(() => window.dotdock.getSystemStats());
  for (const key of ['cpuLoadPercent', 'gpuLoadPercent', 'memPercent']) {
    assert.ok(Number.isFinite(stats[key]) && stats[key] >= 0 && stats[key] <= 100, key);
  }
  assert.ok(stats.cpuCount >= 1);
  assert.ok(stats.memTotalGb > 0 && stats.memUsedGb >= 0);
  assert.ok(stats.platform.startsWith(process.platform));
  report.systemStats = stats;
  report.checks.push('native CPU, GPU and memory response shape');

  await page.getByRole('button', { name: '일정·메모', exact: true }).click();
  await page.getByLabel('빠른 메모', { exact: true }).fill('DotDock native smoke memo');
  await expect.poll(() => page.evaluate(async () => (await window.dotdock.getState()).memo))
    .toBe('DotDock native smoke memo');
  await page.getByTitle('캐릭터 및 통합 설정 열기', { exact: true }).click();
  await page.getByLabel('생년만 입력', { exact: true }).fill('2000');
  await page.getByRole('button', { name: '적용', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.dotdock.getState())).toMatchObject({
    birthYear: 2000, birthDate: null
  });
  await expect(page.locator('.pill-label')).toHaveText('00년생 용띠');
  await page.getByLabel('생년월일 (선택)', { exact: true }).fill('2004-01-01');
  await page.getByRole('button', { name: '생일 적용', exact: true }).click();
  await expect(page.locator('.pill-label')).toHaveText(`04년생 원숭이띠(${Math.round((new Date().getFullYear() - 2004) * 0.8)}세)`);
  assert.equal(await page.locator('.pill-title-row').evaluate((row) => row.scrollWidth <= row.clientWidth), true,
    'long zodiac age label fits inside the character pill');
  await page.getByLabel('생년월일 (선택)', { exact: true }).fill('1996-01-01');
  await page.getByRole('button', { name: '생일 적용', exact: true }).click();
  await page.getByTitle('토끼띠 (卯)', { exact: true }).click();
  await expect(page.locator('.pill-label')).toHaveText(`96년생 토끼띠(${displayAge}세)`);
  report.checks.push('settings year changes clear mismatched birthday; date derives zodiac; manual zodiac and long age label work');
  await page.getByRole('button', { name: '도트', exact: true }).click();
  await expect(page.locator('.sprite-img')).toHaveClass(/is-pixel/);
  await page.getByRole('button', { name: '1.5x', exact: true }).click();
  await expect(page.locator('.sprite-img')).toHaveCSS('width', '96px');
  await expect(page.locator('.sprite-img')).toHaveCSS('height', '96px');
  await expect.poll(() => page.locator('.sprite-img').evaluate((image) =>
    ({ width: image.naturalWidth, height: image.naturalHeight }))).toEqual({ width: 64, height: 64 });
  await expect.poll(() => page.locator('.zodiac-thumb').evaluateAll((images) =>
    images.filter((image) => image.complete && image.naturalWidth === 64 && image.naturalHeight === 64).length)).toBe(12);
  await page.screenshot({ path: path.join(outputDir, 'character-dot-1.5x.png') });
  await page.getByRole('button', { name: '벡터', exact: true }).click();
  await expect(page.locator('.sprite-img')).not.toHaveClass(/is-pixel/);
  await page.getByRole('button', { name: '1.5x', exact: true }).click();
  await expect(page.locator('.sprite-img')).toHaveCSS('width', '96px');
  await expect(page.locator('.sprite-img')).toHaveCSS('height', '96px');
  await page.screenshot({ path: path.join(outputDir, 'character-vector-1.5x.png') });
  report.checks.push('DOT natural 64×64 renders at 1.5x/96px; settings style toggle and vector 1.5x rendering');
  report.requestsBefore3D = {
    mainFetch: await application.evaluate(() => globalThis.__dotdockNetworkRequests),
    renderer: [...rendererNetworkRequests]
  };
  assert.deepEqual(report.requestsBefore3D, { mainFetch: [], renderer: [] }, '2D setup makes no observed HTTP requests before selecting 3D');
  assert.equal(fs.existsSync(path.join(profileDir, 'model-cache')), false, '2D setup does not create the 3D download cache');
  report.checks.push('no observed HTTP fetches or model cache before selecting 3D; production downloader remains enabled');
  await verify3D({ application, page, profileDir, outputDir, report });
  report.modelDownloadRequests = await application.evaluate(() => globalThis.__dotdockNetworkRequests);
  await page.getByRole('button', { name: '← 현황판', exact: true }).click();
  await page.getByRole('button', { name: '앱 설정', exact: true }).click();
  await expect(page.getByRole('button', { name: /업데이트 확인/ })).toBeVisible();
  await expect(page.locator('.hud-body')).toContainText(version);
  assert.equal(await application.evaluate(({ app }) => app.getVersion()), version);
  await page.screenshot({ path: path.join(outputDir, 'settings.png') });
  report.checks.push('memo save, settings version and update action');

  await page.getByRole('button', { name: '현황', exact: true }).click();
  await geminiCard().getByRole('button', { name: '계정 연결', exact: true }).click();
  await expect(page.locator('.source-pill')).toHaveText('계정 연결 관리');
  await checkGeminiAction(geminiCard());
  const authCalls = await application.evaluate(() => globalThis.__dotdockAuthCalls);
  assert.deepEqual(authCalls, Array.from({ length: 2 }, () => ({
    channel: 'dotdock:detect-local-auth', provider: 'gemini'
  })));
  report.checks.push('Gemini local authentication remains on onboarding and account screen; overview navigates to account screen');

  const connectedState = await page.evaluate(() => window.dotdock.getState());
  connectedState.auth.gemini = { connected: true, method: 'oauth-session', connectionSource: 'local-api',
    accountLabel: 'synthetic@example.invalid', lastSyncedAt: new Date().toISOString(),
    statusMessage: 'Antigravity 로컬 서비스에서 실시간 사용량을 확인했습니다.' };
  await page.evaluate((auth) => window.dotdock.saveState({ auth }), connectedState.auth);
  await application.evaluate(({ ipcMain }, fixtureState) => {
    ipcMain.removeHandler('dotdock:detect-local-auth');
    ipcMain.handle('dotdock:detect-local-auth', () => ({ ok: true, message: '격리된 연결 성공', state: fixtureState }));
  }, connectedState);
  await geminiCard().getByRole('button', { name: '로컬 인증 감지', exact: true }).click();
  await expect(geminiCard().locator('.auth-badge')).toHaveText('● OAuth 연동');
  await page.getByRole('button', { name: '현황', exact: true }).click();
  await expect(geminiCard().locator('.header-conn-pill')).toHaveText('● OAuth 연동');
  await expect(geminiCard().locator('.header-conn-pill')).toHaveAttribute('title', /로컬 서비스/);
  report.checks.push('successful Antigravity detection shows OAuth badge and the connection source tooltip');
  await verifyAntigravityQuota({ page, application, saveFixtureState, outputDir, report });

  await page.getByTitle('창 닫기', { exact: true }).click();
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize()[0]))
    .toBe(168);
  assert.deepEqual(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize()),
    [report.periodQuotaCollapsedSize.width, report.periodQuotaCollapsedSize.height]);
  assert.ok((await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize()[1])) >= 182);
  await page.evaluate(async () => {
    window.dotdock.moveBy(-12, -12);
    await window.dotdock.commitWindowPosition();
  });
  report.savedPosition = await page.evaluate(async () => (await window.dotdock.getState()).windowPosition);
  await page.locator('.character-pill').click();
  await expect(page.getByRole('dialog', { name: 'DotDock 정보 HUD', exact: true })).toBeVisible();
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize()[0]))
    .toBe(390);
  assert.ok((await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize()[1])) >= 600);
  await page.screenshot({ path: path.join(outputDir, 'hud.png') });
  report.checks.push('collapse, expand and persisted position');

  fs.writeFileSync(quotaFile, JSON.stringify({ codex: { weekly: { used: 77, limit: 100 } } }));
  const quota = await page.evaluate(() => window.dotdock.syncLocalQuota());
  assert.equal(quota.found, true);
  assert.equal(path.resolve(quota.path), quotaFile);
  assert.equal(quota.state.quota.codex.weekly.used, 77);
  assert.equal(quota.state.quota.source, 'local-file');
  report.checks.push('isolated local quota JSON import');
  await verifySchedules({ application, page, outputDir, report });
}

async function verifyRestart() {
  await application.close();
  application = null;
  await launch();
  await expect(page.locator('.character-pill')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'DotDock 초기 설정', exact: true })).toHaveCount(0);
  const state = await page.evaluate(() => window.dotdock.getState());
  assert.equal(state.onboardingCompleted, true);
  assert.equal(state.birthYear, 1996);
  assert.equal(state.birthDate, '1996-01-01');
  assert.equal(state.selectedZodiacId, 'rabbit');
  assert.equal(state.characterStyle, 'vector');
  assert.equal(state.scale, 1.5);
  assert.equal(state.memo, 'DotDock native smoke memo');
  assert.deepEqual(state.dockMetricIds, report.selectedQuotaIds);
  assert.equal(state.quota.codex.weekly.used, 77);
  assert.deepEqual(state.windowPosition, report.savedPosition);
  assert.deepEqual(rendererErrors, []);
  report.checks.push('restart restores onboarding, character, memo, selected quotas, quota data and position');
  await verifyAntigravityQuota.verifyRestart({ page, report });
  await verifySchedules.verifyRestart({ application, page, report });
  await page.evaluate(() => window.dotdock.saveState({ characterStyle: '3d' }));
  await application.close();
  application = null;
  await launch();
  report.restartGraphics = await verify3D.probeGraphics(page);
  if (report.restartGraphics.available) {
    await expect(page.locator('.character-model-canvas')).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
    await expect.poll(() => page.locator('.character-model-canvas').getAttribute('data-render-count')).not.toBe('0');
  } else {
    await verify3D.verifyFallback(page);
  }
  assert.equal((await page.evaluate(() => window.dotdock.getState())).characterStyle, '3d');
  assert.deepEqual(rendererErrors, []);
  report.checks.push(report.restartGraphics.available
    ? 'saved 3D style and bundled model render after a fresh app launch'
    : 'saved 3D style restores with visible 2D fallback after a fresh app launch without WebGL');
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  try {
    await launch();
    await verifyFirstRun();
    await verifyRestart();
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = error.stack || String(error);
    if (page && !page.isClosed()) {
      report.modelError = await page.locator('.model-error-badge').getAttribute('title', { timeout: 1_000 }).catch(() => null);
    }
    if (page && !page.isClosed()) {
      await page.screenshot({ path: path.join(outputDir, 'failure.png') }).catch(() => {});
    }
    process.exitCode = 1;
  } finally {
    if (application) await application.close().catch(() => {});
    fs.writeFileSync(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2));
    fs.rmSync(profileDir, { recursive: true, force: true });
    console.log(JSON.stringify(report, null, 2));
  }
}

void main();
