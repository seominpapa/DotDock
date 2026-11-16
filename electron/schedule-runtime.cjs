const { collectDueAlerts, nextAlarmDelay } = require('./schedules.cjs');

function createScheduleRuntime({ getState, commit, deliver, onError,
  now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null;
  let stopped = false;

  function check() {
    if (stopped) return;
    if (timer !== null) clearTimer(timer);
    timer = null;
    let delay;
    try {
      const result = collectDueAlerts(getState(), now());
      if (result.alerts.length) {
        commit(result.state);
        for (const alert of result.alerts) {
          try { deliver(alert); } catch (error) { onError(error); }
        }
      }
      delay = nextAlarmDelay(getState(), now());
    } catch (error) {
      onError(error);
      delay = 60_000;
    }
    if (delay !== null) {
      timer = setTimer(check, delay);
      timer?.unref?.();
    }
  }

  return { check, stop() {
    stopped = true;
    if (timer !== null) clearTimer(timer);
    timer = null;
  } };
}

module.exports = { createScheduleRuntime };
