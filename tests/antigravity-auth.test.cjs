const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');
const vm = require('node:vm');

const AUTH_QUERY = "SELECT value FROM ItemTable WHERE key LIKE '%auth%' OR key LIKE '%oauth%' OR key LIKE '%antigravity%' OR key LIKE '%token%' OR key LIKE '%jetski%';";

// Synthetic Windows environment: sqlite3 is not installed, and no actual profile
// paths, Electron application state, or network services are accessed.
function loadOAuth(overrides = {}) {
  const filename = path.join(__dirname, '../electron/oauth.cjs');
  const source = `${fs.readFileSync(filename, 'utf8')}\nmodule.exports.queryDatabaseForTest = queryAntigravityStateDb;`;
  const mod = { exports: {} };
  const wrapped = vm.runInThisContext(`(function(require,module,exports,process){${source}\n})`, { filename });
  const localRequire = (id) => {
    if (id === 'electron') return { app: { getPath: () => '/synthetic-unused-profile' }, safeStorage: {} };
    if (id === 'node:child_process') return {
      execFileSync: () => { throw Object.assign(new Error('Synthetic sqlite3 unavailable'), { code: 'ENOENT' }); }
    };
    if (id === 'node:https' && overrides.https) return overrides.https;
    if (id === 'node:http' || id === 'node:https') return { request: () => { throw new Error('Network is disabled in this test'); } };
    if (id === 'node:os' && overrides.homeDirectory) return { homedir: () => overrides.homeDirectory };
    if (id === 'node:fs' && overrides.fs) return overrides.fs;
    if (id === './credential-store.cjs') return {
      ...require('../electron/credential-store.cjs'),
      createCredentialStore: () => ({ read: () => ({}) })
    };
    if (id.startsWith('./')) return require(path.join(path.dirname(filename), id));
    return require(id);
  };
  wrapped(localRequire, mod, mod.exports, { platform: 'win32', env: overrides.env || {} });
  return mod.exports;
}

function createDatabase(t, relativePath = 'state.vscdb') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dotdock-antigravity-test-'));
  const filename = path.join(directory, relativePath);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const database = new DatabaseSync(filename);
  database.exec('CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT);');
  t.after(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { database, filename, directory, read: loadOAuth().queryDatabaseForTest };
}

function loadWindowsIde(t, respond) {
  const fixture = createDatabase(t, path.join('Antigravity', 'User', 'globalStorage', 'state.vscdb'));
  fixture.database.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;');
  fixture.database.prepare('INSERT INTO ItemTable VALUES (?, ?)').run('antigravityAuthStatus', JSON.stringify({ accessToken: 'ya29.synthetic-stale' }));
  fixture.database.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  fixture.database.prepare('UPDATE ItemTable SET value=? WHERE key=?').run(JSON.stringify({ accessToken: 'ya29.synthetic-current' }), 'antigravityAuthStatus');
  const requests = [];
  const oauth = loadOAuth({
    env: { APPDATA: fixture.directory },
    homeDirectory: path.join(fixture.directory, 'synthetic-home'),
    fs: { ...fs, existsSync: (filename) => filename === fixture.filename && fs.existsSync(filename) },
    https: {
      request: (options, onResponse) => {
        requests.push(options);
        const request = new EventEmitter();
        request.write = () => {};
        request.end = () => {
          const { status, data } = respond(options);
          const response = new EventEmitter();
          response.statusCode = status;
          onResponse(response);
          response.emit('data', Buffer.from(JSON.stringify(data)));
          response.emit('end');
        };
        return request;
      }
    }
  });
  return { oauth, requests };
}

test('Windows reads current committed Antigravity credentials from a live WAL without sqlite3', (t) => {
  const { database, filename, read } = createDatabase(t);
  database.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;');
  database.prepare('INSERT INTO ItemTable VALUES (?, ?)').run('antigravityAuthStatus', JSON.stringify({ accessToken: 'ya29.synthetic-stale' }));
  database.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  database.prepare('UPDATE ItemTable SET value=? WHERE key=?').run(JSON.stringify({ accessToken: 'ya29.synthetic-current' }), 'antigravityAuthStatus');

  assert.ok(fs.statSync(`${filename}-wal`).size > 0, 'fixture must retain a live WAL');
  const result = read(filename, AUTH_QUERY);
  assert.match(result, /ya29\.synthetic-current/);
  assert.doesNotMatch(result, /ya29\.synthetic-stale/);
});

test('Windows never recovers deleted credentials or credentials from unrelated database rows', (t) => {
  const { database, filename, read } = createDatabase(t);
  database.exec('PRAGMA secure_delete=OFF;');
  database.prepare('INSERT INTO ItemTable VALUES (?, ?)').run('antigravityAuthStatus', JSON.stringify({ accessToken: 'ya29.synthetic-deleted' }));
  database.prepare('INSERT INTO ItemTable VALUES (?, ?)').run('unrelated.setting', JSON.stringify({ accessToken: 'ya29.synthetic-unrelated' }));
  database.prepare('DELETE FROM ItemTable WHERE key=?').run('antigravityAuthStatus');
  assert.ok(fs.readFileSync(filename).includes(Buffer.from('ya29.synthetic-deleted')), 'fixture must retain deleted bytes');

  assert.equal(read(filename, AUTH_QUERY), '');
});

test('Windows reads UTF-8 authentication BLOB values and excludes null values', (t) => {
  const { database, filename, read } = createDatabase(t);
  const credential = JSON.stringify({ accessToken: 'ya29.synthetic-blob' });
  database.prepare('INSERT INTO ItemTable VALUES (?, ?)').run('antigravityAuthStatus', Buffer.from(credential, 'utf8'));
  database.prepare('INSERT INTO ItemTable VALUES (?, ?)').run('antigravityNullToken', null);

  assert.equal(read(filename, AUTH_QUERY), credential);
});

test('credential detection reads provider databases without allowing writes or creating missing files', (t) => {
  const { database, filename, read } = createDatabase(t);
  database.prepare('INSERT INTO ItemTable VALUES (?, ?)').run('antigravityAuthStatus', JSON.stringify({ accessToken: 'ya29.synthetic-preserved' }));
  const before = fs.readFileSync(filename);

  read(filename, 'DELETE FROM ItemTable;');
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM ItemTable').get().count, 1);
  assert.deepEqual(fs.readFileSync(filename), before);
  const missing = path.join(path.dirname(filename), 'missing.vscdb');
  assert.equal(read(missing, AUTH_QUERY), '');
  assert.equal(fs.existsSync(missing), false);
});

test('a locked provider database fails within a bounded interval without scanning stale credentials', (t) => {
  const { database, filename, read } = createDatabase(t);
  database.prepare('INSERT INTO ItemTable VALUES (?, ?)').run('antigravityAuthStatus', JSON.stringify({ accessToken: 'ya29.synthetic-locked' }));
  database.exec('BEGIN EXCLUSIVE;');
  let result;
  const started = performance.now();
  try {
    result = read(filename, AUTH_QUERY);
  } finally {
    database.exec('ROLLBACK;');
  }

  assert.equal(result, '');
  assert.ok(performance.now() - started < 3000, 'credential detection must not wait indefinitely for the IDE');
});

test('a corrupt provider database fails without returning token-shaped raw bytes', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dotdock-antigravity-corrupt-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'state.vscdb');
  fs.writeFileSync(filename, 'invalid SQLite file {"accessToken":"ya29.synthetic-not-a-database"}');

  assert.equal(loadOAuth().queryDatabaseForTest(filename, AUTH_QUERY), '');
});

test('missing Antigravity authentication tells Windows users to sign in and detect locally', async () => {
  const oauth = loadOAuth({ fs: { existsSync: () => false } });
  const state = { auth: { gemini: {} }, quota: { gemini: {} } };
  const result = await oauth.detectLocalAuth('gemini', state, { saveState: () => {}, notifyStateUpdated: () => {} });

  assert.equal(result.ok, false);
  assert.equal(state.auth.gemini.connected, false);
  for (const message of [result.message, state.auth.gemini.statusMessage]) {
    assert.match(message, /Antigravity/);
    assert.match(message, /로그인/);
    assert.match(message, /로컬 인증 감지/);
    assert.doesNotMatch(message, /웹 로그인/);
  }
  for (const quota of [state.quota.gemini.fiveHour, state.quota.gemini.weekly]) {
    assert.doesNotMatch(quota.resetLabel, /웹 로그인/);
    assert.match(quota.resetLabel, /로컬 인증 감지/);
  }
});

test('Windows local detection authenticates from the current live-WAL token through the public API', async (t) => {
  const { oauth, requests } = loadWindowsIde(t, ({ path: requestPath }) => {
    if (requestPath === '/v1internal:loadCodeAssist') return { status: 200, data: { cloudaicompanionProject: 'synthetic-project' } };
    if (requestPath === '/v1internal:fetchAvailableModels') return {
      status: 200,
      data: { models: { 'gemini-synthetic': { quotaInfo: { remainingFraction: 0.75 } } } }
    };
    if (requestPath === '/oauth2/v2/userinfo') return { status: 200, data: { email: 'synthetic@example.invalid' } };
    throw new Error(`Unexpected synthetic request: ${requestPath}`);
  });
  const state = { auth: { gemini: {} }, quota: { gemini: {} } };
  const result = await oauth.detectLocalAuth('gemini', state, { saveState: () => {}, notifyStateUpdated: () => {} });

  assert.equal(result.ok, true);
  assert.equal(state.auth.gemini.connected, true);
  assert.equal(state.auth.gemini.accountLabel, 'synthetic@example.invalid');
  assert.equal(state.quota.gemini.fiveHour.used, 25);
  assert.deepEqual(requests.map(({ path: requestPath }) => requestPath), [
    '/v1internal:loadCodeAssist', '/v1internal:fetchAvailableModels', '/oauth2/v2/userinfo'
  ]);
  assert.ok(requests.every(({ headers }) => headers.Authorization === 'Bearer ya29.synthetic-current'));
});

test('an Antigravity API 401 never reports the detected Windows credential as connected', async (t) => {
  const { oauth, requests } = loadWindowsIde(t, ({ path: requestPath }) => requestPath === '/v1internal:loadCodeAssist'
    ? { status: 200, data: { cloudaicompanionProject: 'synthetic-project' } }
    : { status: 401, data: { error: 'synthetic expired credential' } });
  const state = { auth: { gemini: { connected: true } }, quota: { gemini: {} } };
  const result = await oauth.detectLocalAuth('gemini', state, { saveState: () => {}, notifyStateUpdated: () => {} });

  assert.equal(result.ok, false);
  assert.equal(state.auth.gemini.connected, false);
  assert.equal(requests.length, 2);
  assert.ok(requests.every(({ headers }) => headers.Authorization === 'Bearer ya29.synthetic-current'));
});
