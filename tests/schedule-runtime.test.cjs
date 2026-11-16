const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createScheduleRuntime } = require('../electron/schedule-runtime.cjs');
const { loadScheduleState, saveSchedule } = require('../electron/schedules.cjs');

test('claims and persists before delivery, polls clock changes, and stops all timers', () => {
  let clock = Date.parse('2026-11-16T00:00:00.000Z');
  let state = saveSchedule(loadScheduleState({}), { title: '일정', startsAt: new Date(clock + 120_000).toISOString(), reminderMinutes: 0 });
  const deliveries = []; const timers = new Map(); let seq = 0;
  const runtime = createScheduleRuntime({ getState: () => state, commit: (next) => { state = next; },
    deliver: (alert) => { assert.equal(state.scheduleAlerts[0].id, alert.id); deliveries.push(alert); },
    onError: assert.fail, now: () => clock, setTimer: (fn, delay) => { timers.set(++seq, { fn, delay }); return seq; },
    clearTimer: (id) => timers.delete(id) });
  runtime.check();
  assert.equal([...timers.values()][0].delay, 60_000);
  clock += 180_000; runtime.check();
  assert.equal(deliveries.length, 1);
  runtime.check();
  assert.equal(deliveries.length, 1);
  assert.equal(timers.size, 0);
  runtime.stop(); runtime.check();
  assert.equal(timers.size, 0);
});

test('failed persistence leaves due state unchanged, reports error, retries without delivery', () => {
  const now = Date.now();
  let state = saveSchedule(loadScheduleState({}), { title: '일정', startsAt: new Date(now).toISOString(), reminderMinutes: 0 });
  let fail = true; const errors = []; const deliveries = []; let timer;
  const runtime = createScheduleRuntime({ getState: () => state, now: () => now,
    commit: (next) => { if (fail) throw new Error('disk full'); state = next; },
    deliver: (alert) => deliveries.push(alert), onError: (error) => errors.push(error.message),
    setTimer: (fn, delay) => { timer = { fn, delay }; return 1; }, clearTimer: () => {} });
  runtime.check();
  assert.equal(errors.length, 1);
  assert.equal(state.schedules[0].startSentAt, null);
  assert.equal(deliveries.length, 0);
  assert.equal(timer.delay, 60_000);
  fail = false; timer.fn();
  assert.equal(deliveries.length, 1);
  runtime.stop();
});
