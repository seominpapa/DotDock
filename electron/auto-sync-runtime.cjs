function createAutoSyncRuntime({ sync, getState, getIntervalMs, powerMonitor, onError,
  setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null;
  let running = false;
  let pending = false;
  let stopped = false;
  let remainingAttempts = 0;
  let expectedProviders = [];

  function schedule(delay) {
    if (timer !== null) clearTimer(timer);
    timer = setTimer(run, delay);
    timer?.unref?.();
  }

  async function run() {
    timer = null;
    if (stopped) return;
    running = true;
    const recovering = remainingAttempts > 0;
    if (recovering) remainingAttempts--;
    let recovered = false;
    try {
      const result = await sync();
      recovered = result?.ok && expectedProviders.every(id => {
        const auth = getState().auth[id];
        return auth?.connected || auth?.autoConnectDisabled;
      });
    } catch (error) {
      onError(error);
    } finally {
      running = false;
      if (stopped) return;
      if (pending) {
        pending = false;
        schedule(1000);
      } else if (recovering && !recovered && remainingAttempts > 0) {
        schedule(15_000);
      } else {
        remainingAttempts = 0;
        expectedProviders = [];
        schedule(getIntervalMs());
      }
    }
  }

  function recover() {
    if (stopped) return;
    remainingAttempts = 3;
    // Keep failed providers across retries: a failed lookup can clear their auth fields.
    expectedProviders = [...new Set([...expectedProviders, ...Object.entries(getState().auth)
      .filter(([, auth]) => !auth.autoConnectDisabled && (auth.connected || auth.lastSyncedAt))
      .map(([id]) => id)])];
    if (running) pending = true;
    else schedule(1000);
  }

  powerMonitor.on('resume', recover);
  powerMonitor.on('unlock-screen', recover);
  return { recover,
    restart() {
      if (!stopped && !running && remainingAttempts === 0) schedule(getIntervalMs());
    },
    stop() {
      stopped = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
      powerMonitor.removeListener('resume', recover);
      powerMonitor.removeListener('unlock-screen', recover);
    }
  };
}

module.exports = { createAutoSyncRuntime };
