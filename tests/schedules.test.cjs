const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  loadScheduleState, validatePreferences, saveSchedule, deleteSchedule,
  actOnSchedule, collectDueAlerts, nextAlarmDelay
} = require('../electron/schedules.cjs');

const now = Date.parse('2026-11-16T05:00:00.000Z');
const blank = () => ({ memo: 'keep me', ...loadScheduleState({}) });
const create = (state = blank(), offset = 10 * 60_000, id = 'meeting') =>
  saveSchedule(state, { title: '현장 회의', startsAt: new Date(now + offset).toISOString(),
    reminderMinutes: 5 }, () => id);

test('migrates old profiles without replacing memo and validates effect booleans', () => {
  assert.deepEqual(blank().alarmPreferences, { character: true, screenEdge: false, notification: true, sound: false });
  assert.deepEqual(blank().schedules, []);
  assert.equal(blank().memo, 'keep me');
  assert.throws(() => validatePreferences({ character: 'yes' }), /알림 효과/);
  assert.deepEqual(validatePreferences({ character: false, screenEdge: false, notification: false, sound: false }),
    { character: false, screenEdge: false, notification: false, sound: false });
});

test('validates every schedule boundary and never mutates existing state', () => {
  const state = create();
  const before = JSON.stringify(state);
  for (const input of [null, {}, { title: ' ', startsAt: new Date(now).toISOString(), reminderMinutes: 0 },
    { title: 'x', startsAt: '2026-02-30T05:00:00.000Z', reminderMinutes: 0 },
    { title: 'x', startsAt: new Date(now).toISOString(), reminderMinutes: 7 },
    { id: 'absent', title: 'x', startsAt: new Date(now).toISOString(), reminderMinutes: 0 }]) {
    assert.throws(() => saveSchedule(state, input));
  }
  assert.throws(() => actOnSchedule(state, 'meeting', 'bad', now));
  assert.throws(() => actOnSchedule(state, 'meeting', 'snooze', now), /알림/);
  assert.throws(() => deleteSchedule(state, '../bad'));
  assert.equal(JSON.stringify(state), before);
});

test('pre-reminder and start fire once; restart restores pending alerts and delivered markers', () => {
  let state = create();
  assert.equal(collectDueAlerts(state, now).alerts.length, 0);
  assert.equal(nextAlarmDelay(state, now), 60_000);
  ({ state } = collectDueAlerts(state, now + 5 * 60_000));
  assert.equal(state.scheduleAlerts[0].phase, 'reminder');
  assert.equal(collectDueAlerts(state, now + 5 * 60_000).alerts.length, 0);
  state = { ...state, ...loadScheduleState(JSON.parse(JSON.stringify(state))) };
  assert.equal(state.scheduleAlerts.length, 1);
  const result = collectDueAlerts(state, now + 10 * 60_000);
  assert.equal(result.alerts[0].phase, 'start');
  assert.equal(result.state.scheduleAlerts.length, 1);
  assert.equal(collectDueAlerts(result.state, now + 11 * 60_000).alerts.length, 0);
});

test('wake/restart after both due times emits start only and retains simultaneous events', () => {
  const state = create(create(), 10 * 60_000, 'second');
  const result = collectDueAlerts(state, now + 60 * 60_000);
  assert.equal(result.alerts.length, 2);
  assert.ok(result.alerts.every((alert) => alert.phase === 'start'));
  assert.equal(result.state.scheduleAlerts.length, 2);
  assert.ok(result.state.schedules.every((entry) => entry.reminderSentAt && entry.startSentAt));
  assert.equal(collectDueAlerts(result.state, now + 61 * 60_000).alerts.length, 0);
});

test('snooze waits five minutes even across the start time, then emits only once', () => {
  let { state } = collectDueAlerts(create(), now + 9 * 60_000);
  state = actOnSchedule(state, 'meeting', 'snooze', now + 9 * 60_000);
  assert.equal(state.scheduleAlerts.length, 0);
  assert.equal(state.schedules[0].snoozedUntil, new Date(now + 14 * 60_000).toISOString());
  assert.equal(collectDueAlerts(state, now + 10 * 60_000).alerts.length, 0);
  const result = collectDueAlerts(state, now + 14 * 60_000);
  assert.equal(result.alerts[0].phase, 'snooze');
  assert.equal(collectDueAlerts(result.state, now + 15 * 60_000).alerts.length, 0);
});

test('dismiss, complete, reopen, reschedule and delete clear the correct pending alerts', () => {
  let { state } = collectDueAlerts(create(), now + 5 * 60_000);
  state = actOnSchedule(state, 'meeting', 'dismiss', now);
  assert.equal(state.scheduleAlerts.length, 0);
  assert.equal(collectDueAlerts(state, now + 5 * 60_000).alerts.length, 0);
  ({ state } = collectDueAlerts(state, now + 10 * 60_000));
  state = actOnSchedule(state, 'meeting', 'complete', now);
  assert.equal(state.scheduleAlerts.length, 0);
  assert.equal(collectDueAlerts(state, now + 60 * 60_000).alerts.length, 0);
  state = actOnSchedule(state, 'meeting', 'reopen', now);
  ({ state } = collectDueAlerts(state, now + 60 * 60_000));
  assert.equal(state.scheduleAlerts.length, 1);
  state = saveSchedule(state, { id: 'meeting', title: '새 시간', startsAt: new Date(now + 90 * 60_000).toISOString(), reminderMinutes: 0 });
  assert.equal(state.scheduleAlerts.length, 0);
  assert.equal(state.schedules[0].startSentAt, null);
  state = deleteSchedule(state, 'meeting');
  assert.equal(state.schedules.length, 0);
  assert.equal(nextAlarmDelay(state, now), null);
});

test('loads valid entries only, drops orphan alerts, clamps malformed persisted preferences', () => {
  const { state } = collectDueAlerts(create(), now + 10 * 60_000);
  const restored = loadScheduleState({ ...state, schedules: [...state.schedules, { id: 'bad' }],
    scheduleAlerts: [...state.scheduleAlerts, { ...state.scheduleAlerts[0], scheduleId: 'orphan' }],
    alarmPreferences: { character: false, sound: 'true' } });
  assert.equal(restored.schedules.length, 1);
  assert.equal(restored.scheduleAlerts.length, 1);
  assert.equal(restored.alarmPreferences.character, false);
  assert.equal(restored.alarmPreferences.sound, false);
});

test('disabled effects consume due markers without leaving a backlog of pending popups', () => {
  const state = { ...create(), alarmPreferences: { character: false, screenEdge: false, notification: false, sound: false } };
  const result = collectDueAlerts(state, now + 20 * 60_000);
  assert.equal(result.state.scheduleAlerts.length, 0);
  assert.ok(result.state.schedules[0].startSentAt);
  assert.equal(collectDueAlerts({ ...result.state, alarmPreferences: blank().alarmPreferences }, now + 30 * 60_000).alerts.length, 0);
});
