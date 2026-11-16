const assert = require('node:assert/strict');
const path = require('node:path');
const { expect } = require('@playwright/test');

const characterOnly = { character: true, screenEdge: false, notification: false, sound: false };
const allOff = { character: false, screenEdge: false, notification: false, sound: false };

function localInput(date) {
  const two = (value) => String(value).padStart(2, '0');
  return { date: `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`,
    time: `${two(date.getHours())}:${two(date.getMinutes())}` };
}

async function preferences(page, value) {
  await page.evaluate((alarmPreferences) => window.dotdock.saveState({ alarmPreferences }), value);
  await expect.poll(() => page.evaluate(async () => (await window.dotdock.getState()).alarmPreferences)).toEqual(value);
}

async function createDue(page, title) {
  return page.evaluate(async (value) => {
    const state = await window.dotdock.saveSchedule({ title: value,
      startsAt: new Date(Date.now() + 700).toISOString(), reminderMinutes: 0 });
    return state.schedules.find((entry) => entry.title === value).id;
  }, title);
}

async function entry(page, id) {
  return page.evaluate(async (value) => (await window.dotdock.getState()).schedules.find((item) => item.id === value), id);
}

module.exports = async function verifySchedules({ application, page, outputDir, report }) {
  await page.getByRole('button', { name: '일정·메모', exact: true }).click();
  const future = localInput(new Date(Date.now() + 2 * 60 * 60_000));
  await page.getByLabel('일정 제목', { exact: true }).fill('Native UI schedule');
  await page.getByLabel('일정 날짜', { exact: true }).fill(future.date);
  await page.getByLabel('일정 시간', { exact: true }).fill(future.time);
  await page.getByLabel('미리 알림', { exact: true }).selectOption('5');
  await page.getByRole('button', { name: '일정 추가', exact: true }).click();
  await expect(page.getByLabel('Native UI schedule 수정', { exact: true })).toBeVisible();
  await page.getByLabel('Native UI schedule 수정', { exact: true }).click();
  await page.getByLabel('일정 제목', { exact: true }).fill('Native edited schedule');
  await page.getByLabel('미리 알림', { exact: true }).selectOption('15');
  await page.getByRole('button', { name: '수정 저장', exact: true }).click();
  await expect(page.getByLabel('Native edited schedule 수정', { exact: true })).toBeVisible();
  const edited = await page.evaluate(async () =>
    (await window.dotdock.getState()).schedules.find((item) => item.title === 'Native edited schedule'));
  assert.equal(edited.reminderMinutes, 15);
  assert.deepEqual(localInput(new Date(edited.startsAt)), future);

  await page.getByLabel('일정 제목', { exact: true }).fill('Native delete schedule');
  await page.getByRole('button', { name: '일정 추가', exact: true }).click();
  await page.getByLabel('Native delete schedule 삭제', { exact: true }).click();
  await expect(page.getByLabel('Native delete schedule 삭제', { exact: true })).toHaveCount(0);
  assert.equal(await page.evaluate(async () =>
    (await window.dotdock.getState()).schedules.some((item) => item.title === 'Native delete schedule')), false);
  report.checks.push('schedule UI creates, edits and deletes entries with local date/time and reminder selection');

  const beforeFailure = await page.evaluate(() => window.dotdock.getState());
  await application.evaluate(() => {
    const fs = process.getBuiltinModule('node:fs');
    globalThis.__dotdockOriginalRename = fs.renameSync;
    fs.renameSync = function (source, destination, ...options) {
      if (String(destination).endsWith('dotdock-state.json')) throw new Error('Synthetic disk failure');
      return Reflect.apply(globalThis.__dotdockOriginalRename, fs, [source, destination, ...options]);
    };
  });
  try {
    const rejected = await page.evaluate(async () => {
      try {
        await window.dotdock.saveSchedule({ title: 'Must not persist',
          startsAt: new Date(Date.now() + 60 * 60_000).toISOString(), reminderMinutes: 0 });
        return false;
      } catch { return true; }
    });
    assert.equal(rejected, true);
    assert.deepEqual(await page.evaluate(() => window.dotdock.getState()), beforeFailure);
  } finally {
    await application.evaluate(() => {
      process.getBuiltinModule('node:fs').renameSync = globalThis.__dotdockOriginalRename;
      delete globalThis.__dotdockOriginalRename;
    });
  }
  report.checks.push('failed atomic schedule write rejects IPC without changing in-memory state');

  for (const [label, checked] of [
    [/^캐릭터 빛 효과/, true], [/^화면 테두리 효과/, true],
    [/^시스템 알림/, false], [/^알림 소리/, true]
  ]) {
    await page.getByRole('checkbox', { name: label }).setChecked(checked);
  }
  await expect.poll(() => page.evaluate(async () => (await window.dotdock.getState()).alarmPreferences))
    .toEqual({ character: true, screenEdge: true, notification: false, sound: true });
  await preferences(page, characterOnly);
  await page.getByRole('button', { name: '선택한 효과 미리보기', exact: true }).click();
  const alarm = page.getByRole('status', { name: '일정 알림', exact: true });
  await expect(alarm).toContainText('일정 알림 미리보기');
  await expect(alarm).toHaveClass(/has-character-effect/);
  await alarm.getByRole('button', { name: '일정 알림 닫기', exact: true }).click();
  await expect(alarm).toHaveCount(0);
  assert.deepEqual((await page.evaluate(() => window.dotdock.getState())).scheduleAlerts, []);
  report.checks.push('independent effect checkboxes persist; character preview closes without saving a real alert');

  await page.getByTitle('창 닫기', { exact: true }).click();
  const snoozedId = await createDue(page, 'Native timer snooze');
  await expect(alarm).toContainText('Native timer snooze');
  await expect.poll(() => entry(page, snoozedId)).toMatchObject({ startSentAt: expect.any(String) });
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize()[0]))
    .toBe(300);
  const snoozeStart = Date.now();
  await alarm.getByRole('button', { name: '5분 뒤 다시', exact: true }).click();
  await expect(alarm).toHaveCount(0);
  const snoozed = await entry(page, snoozedId);
  const snoozeDelay = Date.parse(snoozed.snoozedUntil) - snoozeStart;
  assert.ok(snoozeDelay >= 5 * 60_000 && snoozeDelay < 5 * 60_000 + 15_000);
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize()[0]))
    .toBe(168);

  const completedId = await createDue(page, 'Native timer complete');
  await expect(alarm).toContainText('Native timer complete');
  await alarm.getByRole('button', { name: '완료', exact: true }).click();
  await expect(alarm).toHaveCount(0);
  await expect.poll(() => entry(page, completedId)).toMatchObject({ completed: true, snoozedUntil: null });

  const dismissedId = await createDue(page, 'Native timer dismiss');
  await expect(alarm).toContainText('Native timer dismiss');
  const normalPosition = await page.evaluate(async () => (await window.dotdock.getState()).windowPosition);
  const movedPosition = await page.evaluate(async () => {
    window.dotdock.moveBy(-12, -12);
    return window.dotdock.commitWindowPosition();
  });
  assert.deepEqual(movedPosition, { x: normalPosition.x - 12, y: normalPosition.y - 12 });
  await alarm.getByRole('button', { name: '일정 알림 닫기', exact: true }).click();
  await expect(alarm).toHaveCount(0);
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => {
    const { x, y } = BrowserWindow.getAllWindows()[0].getBounds();
    return { x, y };
  })).toEqual(movedPosition);
  assert.equal((await entry(page, dismissedId)).completed, false);
  assert.equal((await page.evaluate(() => window.dotdock.getState())).scheduleAlerts.length, 0);
  report.checks.push('real main-process timers show collapsed character alert; snooze persists five minutes; complete and dismiss clear alerts');

  await createDue(page, 'Native expanded dismiss');
  await expect(alarm).toContainText('Native expanded dismiss');
  await page.locator('.character-pill').click();
  await expect(page.getByRole('dialog', { name: 'DotDock 정보 HUD', exact: true })).toBeVisible();
  await alarm.getByRole('button', { name: '일정 알림 닫기', exact: true }).click();
  await expect(alarm).toHaveCount(0);
  await page.getByTitle('창 닫기', { exact: true }).click();
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => {
    const { x, y, width } = BrowserWindow.getAllWindows()[0].getBounds();
    return { x, y, width };
  })).toEqual({ ...movedPosition, width: 168 });
  report.savedPosition = movedPosition;
  report.checks.push('dragging an alarm preserves the new collapsed position; opening HUD then dismissing alarm does not shift the dock');

  const beforeHudAlarm = await application.evaluate(({ BrowserWindow }) => {
    const { x, y, width } = BrowserWindow.getAllWindows()[0].getBounds();
    return { x, y, width };
  });
  await page.locator('.character-pill').click();
  await expect(page.getByRole('dialog', { name: 'DotDock 정보 HUD', exact: true })).toBeVisible();
  await createDue(page, 'Native alarm during HUD');
  await expect(alarm).toContainText('Native alarm during HUD');
  await page.getByTitle('창 닫기', { exact: true }).click();
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize()[0]))
    .toBe(300);
  await alarm.getByRole('button', { name: '일정 알림 닫기', exact: true }).click();
  await expect(alarm).toHaveCount(0);
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => {
    const { x, y, width } = BrowserWindow.getAllWindows()[0].getBounds();
    return { x, y, width };
  })).toEqual(beforeHudAlarm);
  assert.equal(beforeHudAlarm.width, 168);
  report.checks.push('alarm arriving during an open HUD restores the original dock position after closing HUD and dismissing alert');

  await createDue(page, 'Native alarm position reset');
  await expect(alarm).toContainText('Native alarm position reset');
  const resetPosition = await page.evaluate(() => window.dotdock.resetPosition());
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize()[0])).toBe(300);
  await alarm.getByRole('button', { name: '일정 알림 닫기', exact: true }).click();
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => {
    const { x, y, width } = BrowserWindow.getAllWindows()[0].getBounds();
    return { x, y, width };
  })).toEqual({ ...resetPosition, width: 168 });
  report.savedPosition = resetPosition;
  report.checks.push('position reset retains the full alert window and restores the reset dock position after dismissal');

  await preferences(page, allOff);
  const silentId = await createDue(page, 'Native timer all effects off');
  await expect.poll(() => entry(page, silentId)).toMatchObject({ startSentAt: expect.any(String) });
  await expect(alarm).toHaveCount(0);
  assert.equal((await page.evaluate(() => window.dotdock.getState())).scheduleAlerts.length, 0);
  await page.locator('.character-pill').click();
  await page.getByRole('button', { name: '일정·메모', exact: true }).click();
  await expect(page.getByRole('button', { name: '선택한 효과 미리보기', exact: true })).toBeDisabled();
  report.checks.push('all effects off consumes due marker without showing a popup and disables effect preview');

  await preferences(page, { ...allOff, screenEdge: true });
  await page.getByRole('button', { name: '선택한 효과 미리보기', exact: true }).click();
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(2);
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().endsWith('/alarm-edge.html'));
    return win ? { focusable: win.isFocusable(), ignoresMouse: win.__dotdockIgnoreMouseEvents,
      nodeIntegration: win.webContents.getLastWebPreferences().nodeIntegration,
      sandbox: win.webContents.getLastWebPreferences().sandbox } : null;
  })).toEqual({ focusable: false, ignoresMouse: true, nodeIntegration: false, sandbox: true });
  await expect.poll(async () => {
    report.edgeEffect = await application.evaluate(async ({ BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().endsWith('/alarm-edge.html'));
      if (!win) return null;
      const style = await win.webContents.executeJavaScript(`(() => {
        const effect = getComputedStyle(document.body, '::after');
        return { opacity: Number(effect.opacity), border: effect.borderTopWidth, color: effect.borderTopColor };
      })()`);
      return { visible: win.isVisible(), bounds: win.getBounds(), style,
        display: screen.getDisplayMatching(BrowserWindow.getAllWindows()[0].getBounds()).bounds };
    });
    const effect = report.edgeEffect;
    return Boolean(effect?.visible && ['x', 'y', 'width', 'height'].every(key => effect.bounds[key] === effect.display[key])
      && effect.style.opacity > 0.2 && effect.style.border === '5px' && effect.style.color === 'rgb(165, 180, 252)');
  }, { intervals: [50, 100, 150], timeout: 2500 }).toBe(true);
  await application.evaluate(async ({ BrowserWindow }, filename) => {
    const win = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().endsWith('/alarm-edge.html'));
    const capture = await win.webContents.capturePage();
    process.getBuiltinModule('node:fs').writeFileSync(filename, capture.toPNG());
  }, path.join(outputDir, 'alarm-edge.png'));
  await expect(alarm).toHaveCount(0);
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
    { timeout: 6000 }).toBe(1);
  report.checks.push('screen-edge-only preview visibly glows at full display bounds; sandboxed click-through overlay closes automatically');

  await preferences(page, characterOnly);
  await page.screenshot({ path: path.join(outputDir, 'schedules.png') });
  const persisted = await page.evaluate(() => window.dotdock.getState());
  report.scheduleRestart = { schedules: persisted.schedules, scheduleAlerts: persisted.scheduleAlerts,
    alarmPreferences: persisted.alarmPreferences };
  report.scheduleNativeLimit = 'SMOKE_TEST suppresses OS notifications and sound; actual delivery/permissions require manual verification.';
};

module.exports.verifyRestart = async function verifyScheduleRestart({ page, report }) {
  const state = await page.evaluate(() => window.dotdock.getState());
  assert.deepEqual({ schedules: state.schedules, scheduleAlerts: state.scheduleAlerts,
    alarmPreferences: state.alarmPreferences }, report.scheduleRestart);
  await expect(page.getByRole('status', { name: '일정 알림', exact: true })).toHaveCount(0);
  report.checks.push('restart restores schedules, effect choices, snooze/completed/dismissed markers without duplicate alerts');
};
