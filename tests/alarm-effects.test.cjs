const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAlarmEffects } = require('../electron/alarm-effects.cjs');

function fixture(options = {}) {
  const windows = []; const notices = []; const errors = []; let beeps = 0;
  const pendingLoads = [];
  class Window {
    constructor(settings) {
      if (options.edgeFailure) throw new Error('overlay unavailable');
      this.options = settings; this.destroyed = false; windows.push(this);
      this.bounds = { x: settings.x, y: settings.y, width: settings.width, height: settings.height - 40 };
    }
    setBounds(bounds) { this.bounds = { ...bounds }; }
    setIgnoreMouseEvents(value) { this.ignoreMouse = value; }
    setAlwaysOnTop(value) { this.onTop = value; }
    once(_event, fn) { this.ready = fn; }
    loadFile(file) { this.file = file; this.ready(); return options.deferLoad
      ? new Promise((resolve, reject) => pendingLoads.push({ resolve, reject })) : Promise.resolve(); }
    showInactive() { this.shownInactive = true; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
  }
  class Notice {
    static isSupported() { return true; }
    constructor(options) { this.options = options; this.listeners = {}; notices.push(this); }
    on(event, fn) { this.listeners[event] = fn; }
    show() { this.shown = true; }
    close() { this.closed = true; }
  }
  const effects = createAlarmEffects({ BrowserWindow: Window, Notification: Notice,
    screen: { getDisplayMatching: () => ({ bounds: { x: 0, y: 0, width: 1000, height: 700 } }) },
    shell: { beep: () => { if (options.beepFailure) throw new Error('sound unavailable'); beeps++; } }, getWindow: () => ({ getBounds: () => ({ x: 0, y: 0, width: 168, height: 182 }) }),
    onOpen: () => {}, onError: (message) => errors.push(message) });
  return { effects, windows, notices, errors, pendingLoads, beeps: () => beeps };
}
const alert = { scheduleId: 'one', title: '<script>never HTML</script>', startsAt: '2026-11-16T05:00:00.000Z' };

test('all effects disabled creates no windows, notifications or sound', () => {
  const f = fixture();
  f.effects.show(alert, { character: false, screenEdge: false, notification: false, sound: false });
  assert.equal(f.windows.length, 0); assert.equal(f.notices.length, 0); assert.equal(f.beeps(), 0);
  f.effects.close();
});

test('edge overlay uses fixed local file, isolated sandbox and inactive click-through window', () => {
  const f = fixture();
  f.effects.show(alert, { screenEdge: true, notification: false, sound: false });
  const win = f.windows[0];
  assert.equal(win.options.focusable, false);
  assert.equal(win.options.webPreferences.nodeIntegration, false);
  assert.equal(win.options.webPreferences.sandbox, true);
  assert.equal(win.options.webPreferences.preload, undefined);
  assert.equal(win.ignoreMouse, true); assert.equal(win.shownInactive, true);
  assert.ok(win.file.endsWith('alarm-edge.html'));
  f.effects.close(); assert.equal(win.destroyed, true);
});

test('edge overlay restores full display bounds after native creation clamps to the work area', () => {
  const f = fixture();
  f.effects.show(alert, { screenEdge: true });
  assert.deepEqual(f.windows[0].bounds, { x: 0, y: 0, width: 1000, height: 700 });
  assert.equal(f.windows[0].options.enableLargerThanScreen, true);
  f.effects.close();
});

test('notification and sound are independent; stale notifications are closed', () => {
  const f = fixture();
  f.effects.show(alert, { notification: true, sound: false, screenEdge: false });
  assert.equal(f.windows.length, 0); assert.equal(f.beeps(), 0);
  assert.equal(f.notices[0].options.body.includes(alert.title), true);
  assert.equal(f.notices[0].options.silent, true);
  f.effects.reconcile([]); assert.equal(f.notices[0].closed, true);
  f.effects.show(alert, { notification: false, sound: true, screenEdge: false });
  assert.equal(f.beeps(), 1);
  f.effects.close();
});

test('a failed screen or sound effect never prevents another selected notification', () => {
  for (const options of [{ edgeFailure: true }, { beepFailure: true }]) {
    const f = fixture(options);
    assert.doesNotThrow(() => f.effects.show(alert, { screenEdge: true, sound: true, notification: true }));
    assert.equal(f.notices.length, 1);
    assert.equal(f.errors.length, 1);
    f.effects.close();
  }
});

test('a canceled older overlay load cannot close the current overlay', async () => {
  const f = fixture({ deferLoad: true });
  f.effects.show(alert, { screenEdge: true });
  f.effects.show(alert, { screenEdge: true });
  f.pendingLoads[0].reject(new Error('aborted'));
  await new Promise(setImmediate);
  assert.equal(f.windows[0].destroyed, true);
  assert.equal(f.windows[1].destroyed, false);
  assert.equal(f.errors.length, 0);
  f.pendingLoads[1].resolve();
  f.effects.close();
});
