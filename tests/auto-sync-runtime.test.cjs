const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createAutoSyncRuntime } = require('../electron/auto-sync-runtime.cjs');

function fixture(sync) {
  let now = 0; let sequence = 0; let calls = 0;
  let state = { autoSyncMinutes: 10, auth: {
    codex: { connected: true }, gemini: { connected: true }
  } };
  const timers = new Map(); const errors = []; const powerMonitor = new EventEmitter();
  const runtime = createAutoSyncRuntime({ powerMonitor, getState: () => state,
    getIntervalMs: () => state.autoSyncMinutes * 60_000,
    sync: async () => { calls++; return sync ? sync() : { ok: true }; },
    onError: error => errors.push(error.message),
    setTimer: (fn, delay) => { const id = ++sequence; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimer: id => timers.delete(id) });
  async function advance(ms) {
    const end = now + ms;
    for (;;) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      now = next[1].at; timers.delete(next[0]); await next[1].fn();
    }
    now = end;
  }
  return { runtime, powerMonitor, timers, errors, advance, calls: () => calls,
    state: () => state, replaceState: next => { state = next; } };
}

test('wake and unlock sync within one second instead of waiting ten minutes', async () => {
  const f = fixture(); f.runtime.restart();
  await f.advance(599_000); assert.equal(f.calls(), 0);
  f.powerMonitor.emit('resume'); f.powerMonitor.emit('unlock-screen');
  await f.advance(1000); assert.equal(f.calls(), 1);
  await f.advance(599_000); assert.equal(f.calls(), 1);
  await f.advance(1000); assert.equal(f.calls(), 2);
  f.runtime.stop();
});

test('wake before Wi-Fi is ready retries after fifteen seconds and stops on success', async () => {
  let online = false;
  const f = fixture(async () => ({ ok: online }));
  f.powerMonitor.emit('resume'); await f.advance(1000); assert.equal(f.calls(), 1);
  online = true; await f.advance(15_000); assert.equal(f.calls(), 2);
  await f.advance(15_000); assert.equal(f.calls(), 2);
  f.runtime.stop();
});

test('failed recovery is bounded to three attempts and regular sync continues', async () => {
  const f = fixture(async () => ({ ok: false }));
  f.runtime.recover(); await f.advance(31_000); assert.equal(f.calls(), 3);
  await f.advance(599_000); assert.equal(f.calls(), 3);
  await f.advance(1000); assert.equal(f.calls(), 4);
  f.runtime.stop();
});

test('online arriving during an older request queues one follow-up without overlap', async () => {
  let finish;
  const f = fixture(() => new Promise(resolve => { finish = resolve; }));
  f.runtime.recover();
  const pending = f.advance(1000);
  await Promise.resolve();
  f.runtime.recover(); f.powerMonitor.emit('unlock-screen'); f.runtime.recover();
  assert.equal(f.calls(), 1);
  finish({ ok: true }); await pending;
  const followUp = f.advance(1000);
  await Promise.resolve(); assert.equal(f.calls(), 2);
  finish({ ok: true }); await followUp;
  await f.advance(15_000); assert.equal(f.calls(), 2);
  f.runtime.stop();
});

test('partial success retries a previously connected provider even after its auth fields are cleared', async () => {
  let f;
  f = fixture(async () => {
    f.replaceState({ ...f.state(), auth: { codex: { connected: false }, gemini: { connected: true } } });
    return { ok: true };
  });
  f.runtime.recover(); await f.advance(31_000); assert.equal(f.calls(), 3);
  f.runtime.stop();
});

test('manually disconnected providers do not require recovery', async () => {
  const f = fixture();
  f.replaceState({ ...f.state(), auth: { codex: { connected: true },
    gemini: { connected: false, lastSyncedAt: '2026-11-16T00:00:00Z', autoConnectDisabled: true } } });
  f.runtime.recover(); await f.advance(31_000); assert.equal(f.calls(), 1);
  f.runtime.stop();
});

test('rejected requests are reported and retried; interval changes and stop clear timers', async () => {
  const f = fixture(async () => { throw new Error('network unavailable'); });
  f.runtime.restart();
  f.replaceState({ ...f.state(), autoSyncMinutes: 5 }); f.runtime.restart();
  assert.equal(f.timers.size, 1);
  f.runtime.recover(); await f.advance(31_000);
  assert.equal(f.errors.length, 3); assert.equal(f.calls(), 3);
  await f.advance(300_000); assert.equal(f.calls(), 4);
  f.runtime.stop(); f.runtime.recover(); f.runtime.restart(); f.powerMonitor.emit('resume');
  await f.advance(600_000); assert.equal(f.calls(), 4); assert.equal(f.timers.size, 0);
  assert.equal(f.powerMonitor.listenerCount('resume'), 0);
  assert.equal(f.powerMonitor.listenerCount('unlock-screen'), 0);
});

test('stopping during a request prevents retries after it resolves', async () => {
  let finish;
  const f = fixture(() => new Promise(resolve => { finish = resolve; }));
  f.runtime.recover(); const pending = f.advance(1000); await Promise.resolve();
  f.runtime.stop(); finish({ ok: false }); await pending;
  await f.advance(600_000); assert.equal(f.calls(), 1); assert.equal(f.timers.size, 0);
});
