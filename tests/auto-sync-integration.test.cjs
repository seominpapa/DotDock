const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function mainFunctions(names, context) {
  const filename = path.resolve(__dirname, '../electron/main.cjs');
  const parsed = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
  const source = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
    .map(node => node.getText(parsed)).join('\n');
  vm.createContext(context); vm.runInContext(source, context);
  return context;
}

test('main uses automatic quota action, latest state and normalized interval through the same runtime', async () => {
  let options; let restarts = 0; const calls = [];
  const state = { autoSyncMinutes: 10 }; const hooks = {};
  const main = mainFunctions(['restartAutoSyncTimer'], {
    SMOKE_TEST: false, autoSyncRuntime: null, powerMonitor: {}, appState: state,
    normalizeAutoSyncMinutes: value => [5, 10, 15, 20].includes(value) ? value : 10,
    getOAuthHooks: () => hooks,
    oauth: { syncProviderQuota: (...args) => { calls.push(args); return { ok: true }; } },
    createAutoSyncRuntime: value => { options = value; return { restart: () => restarts++ }; }
  });
  main.restartAutoSyncTimer(); main.restartAutoSyncTimer();
  assert.equal(restarts, 2); assert.equal(options.getIntervalMs(), 600_000);
  await options.sync(); assert.deepEqual(calls[0], [undefined, state, hooks]);
  main.appState = { autoSyncMinutes: 5 };
  assert.equal(options.getState(), main.appState); assert.equal(options.getIntervalMs(), 300_000);
  main.appState = { autoSyncMinutes: -1 }; assert.equal(options.getIntervalMs(), 600_000);
});

test('online signal is accepted only from the main window; hidden renderer still forwards online', () => {
  const listeners = new Map(); let recoveries = 0;
  const webContents = {};
  mainFunctions(['registerIpc'], {
    ipcMain: { on: (event, fn) => listeners.set(event, fn), handle() {} },
    mainWindow: { webContents }, autoSyncRuntime: { recover: () => recoveries++ },
    dialog: {}, os: { cpus: () => [] }, registerCharacterModelIpc() {}
  }).registerIpc();
  const signal = listeners.get('dotdock:network-online');
  signal({ sender: {} }); assert.equal(recoveries, 0);
  signal({ sender: webContents }); assert.equal(recoveries, 1);
  const events = new Map(); const sent = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../electron/preload.cjs'), 'utf8'), {
    window: { addEventListener: (event, fn) => events.set(event, fn) },
    require: () => ({ contextBridge: { exposeInMainWorld() {} }, ipcRenderer: { send: event => sent.push(event) } })
  });
  events.get('online')(); assert.deepEqual(sent, ['dotdock:network-online']);
});
