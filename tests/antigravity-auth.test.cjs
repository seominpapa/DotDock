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
    if (id === 'node:fs') return overrides.fs || { ...fs, existsSync: () => false };
    if (id === './antigravity-local.cjs') return {
      queryAntigravityLocal: overrides.local || (async () => ({ status: 'unavailable' }))
    };
    if (id === './credential-store.cjs') return {
      ...require('../electron/credential-store.cjs'),
      createCredentialStore: () => overrides.store || ({ read: () => ({}), write: () => {} })
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

function loadWindowsIde(t, respond, overrides = {}) {
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
    ...overrides,
    https: {
      request: (options, onResponse) => {
        requests.push(options);
        const request = new EventEmitter();
        request.write = () => {};
        request.end = () => {
          Promise.resolve(respond(options)).then(({ status, data }) => {
            const response = new EventEmitter();
            response.statusCode = status;
            onResponse(response);
            response.emit('data', Buffer.from(JSON.stringify(data)));
            response.emit('end');
          });
        };
        return request;
      }
    }
  });
  return { oauth, requests, database: fixture.database };
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

const account = 'synthetic@example.invalid';
const hooks = { saveState: () => {}, notifyStateUpdated: () => {} };
const localModels = { 'gemini-local': { quotaInfo: { remainingFraction: 0.6 } } };
function previousState() {
  return {
    auth: { gemini: { connected: true, method: 'oauth-session', accountLabel: account,
      lastSyncedAt: '2026-01-01T00:00:00.000Z', connectionSource: 'stored-auth' } },
    quota: { source: 'oauth-sync', gemini: {
      fiveHour: { used: 31, limit: 100, unit: '%', label: 'Gemini 모델', resetLabel: '이전 값', hidden: false },
      weekly: { used: 52, limit: 100, unit: '%', label: 'Claude · GPT 모델', resetLabel: '이전 값', hidden: false }
    } }
  };
}

test('local service success updates OAuth state without inspecting stored credentials or cloud APIs', async () => {
  const oauth = loadOAuth({
    local: async () => ({ status: 'ok', accountLabel: account, models: localModels }),
    fs: { existsSync: () => { throw new Error('Stored files must not be inspected after local success'); } }
  });
  const state = previousState();
  const result = await oauth.detectLocalAuth('gemini', state, hooks);
  assert.equal(result.ok, true);
  assert.equal(state.auth.gemini.connected, true);
  assert.equal(state.auth.gemini.method, 'oauth-session');
  assert.equal(state.auth.gemini.connectionSource, 'local-api');
  assert.equal(state.quota.gemini.fiveHour.used, 40);
  assert.equal(state.quota.gemini.weekly.hidden, true, 'never mix the previous remote partner pool into local results');
  assert.match(state.auth.gemini.statusMessage, /로컬 서비스/);
});

test('unavailable or failed local service falls back to the existing saved authentication path', async (t) => {
  for (const local of [async () => ({ status: 'unavailable' }), async () => { throw new Error('private local failure'); }]) {
    const { oauth, requests } = loadWindowsIde(t, ({ path: requestPath }) => {
      if (requestPath === '/oauth2/v2/userinfo') return { status: 200, data: { email: account } };
      if (requestPath === '/v1internal:loadCodeAssist') return { status: 200, data: {} };
      return { status: 200, data: { models: localModels } };
    }, { local });
    const state = previousState();
    const result = await oauth.detectLocalAuth('gemini', state, hooks);
    assert.equal(result.ok, true);
    assert.equal(state.auth.gemini.connectionSource, 'stored-auth');
    assert.match(state.auth.gemini.statusMessage, /저장된 인증/);
    assert.equal(state.quota.gemini.fiveHour.used, 40);
    assert.ok(requests.length > 0);
  }
});

test('failed dual detection preserves last good quotas and sync time instead of inventing zero usage', async () => {
  const oauth = loadOAuth({ fs: { existsSync: () => false } });
  const state = previousState();
  const before = structuredClone(state.quota.gemini);
  const synced = state.auth.gemini.lastSyncedAt;
  const result = await oauth.detectLocalAuth('gemini', state, hooks);
  assert.equal(result.ok, false);
  assert.equal(state.auth.gemini.connected, false);
  assert.deepEqual(state.quota.gemini, before);
  assert.equal(state.auth.gemini.lastSyncedAt, synced);
  assert.match(state.auth.gemini.statusMessage, /마지막|이전/);
});

test('first-time dual failure hides unknown quota bars', async () => {
  const oauth = loadOAuth({ fs: { existsSync: () => false } });
  const state = { auth: { gemini: {} }, quota: { gemini: {} } };
  assert.equal((await oauth.detectLocalAuth('gemini', state, hooks)).ok, false);
  assert.equal(state.quota.gemini.fiveHour.hidden, true);
  assert.equal(state.quota.gemini.weekly.hidden, true);
});

test('different local account cannot replace a bound account or silently try another identity', async () => {
  const oauth = loadOAuth({
    local: async () => ({ status: 'ok', accountLabel: 'other@example.invalid', models: localModels }),
    fs: { existsSync: () => { throw new Error('Account mismatch must stop fallback'); } }
  });
  const state = previousState();
  const before = structuredClone(state.quota.gemini);
  const result = await oauth.detectLocalAuth('gemini', state, hooks);
  assert.equal(result.ok, false);
  assert.equal(state.auth.gemini.accountLabel, account);
  assert.equal(state.auth.gemini.connected, false);
  assert.deepEqual(state.quota.gemini, before);
  assert.match(state.auth.gemini.statusMessage, /계정/);
});

test('remote fallback verifies the actual token owner before accepting quotas for a bound account', async (t) => {
  const { oauth, requests } = loadWindowsIde(t, ({ path: requestPath }) => {
    if (requestPath === '/oauth2/v2/userinfo') return { status: 200, data: { email: 'other@example.invalid' } };
    return { status: 200, data: { models: localModels } };
  });
  const state = previousState();
  const result = await oauth.detectLocalAuth('gemini', state, hooks);
  assert.equal(result.ok, false);
  assert.equal(state.auth.gemini.accountLabel, account);
  assert.equal(state.quota.gemini.fiveHour.used, 31);
  assert.ok(requests.every(({ path: requestPath }) => requestPath === '/oauth2/v2/userinfo'));
});

test('local success without account identity cannot later switch to unidentified saved credentials', async (t) => {
  let localAvailable = true;
  const { oauth, requests } = loadWindowsIde(t, () => ({ status: 200, data: { models: localModels } }), {
    local: async () => localAvailable ? { status: 'ok', models: localModels } : { status: 'unavailable' }
  });
  const state = { auth: { gemini: {} }, quota: { gemini: {} } };
  assert.equal((await oauth.detectLocalAuth('gemini', state, hooks)).ok, true);
  localAvailable = false;
  assert.equal((await oauth.detectLocalAuth('gemini', state, hooks)).ok, false);
  assert.equal(requests.length, 0);
  assert.equal(state.quota.gemini.fiveHour.used, 40);
});

test('disconnect disables automatic reconnection until the user explicitly detects again', async () => {
  let calls = 0;
  const oauth = loadOAuth({ local: async () => { calls++; return { status: 'ok', accountLabel: account, models: localModels }; } });
  const state = previousState();
  await oauth.disconnectProvider('gemini', state, hooks);
  assert.equal(state.auth.gemini.autoConnectDisabled, true);
  assert.equal((await oauth.syncProviderQuota('gemini', state, hooks)).ok, false);
  assert.equal(calls, 0);
  state.auth = { ...state.auth, codex: {}, claude: {} };
  state.quota = { ...state.quota, codex: {}, claude: {} };
  await oauth.detectLocalAuth(undefined, state, hooks);
  assert.equal(calls, 0);
  assert.equal((await oauth.detectLocalAuth('gemini', state, hooks)).ok, true);
  assert.equal(state.auth.gemini.autoConnectDisabled, false);
  assert.equal(calls, 1);
});

test('disconnect while local detection is pending invalidates the late result', async () => {
  let resolveLocal;
  const oauth = loadOAuth({ local: () => new Promise((resolve) => { resolveLocal = resolve; }) });
  const state = previousState();
  const pending = oauth.detectLocalAuth('gemini', state, hooks);
  await oauth.disconnectProvider('gemini', state, hooks);
  resolveLocal({ status: 'ok', accountLabel: account, models: localModels });
  assert.equal((await pending).ok, false);
  assert.equal(state.auth.gemini.connected, false);
  assert.equal(state.auth.gemini.autoConnectDisabled, true);
});

function encodedCredential() {
  const field = (number, value) => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
    assert.ok(bytes.length < 128);
    return Buffer.concat([Buffer.from([number * 8 + 2, bytes.length]), bytes]);
  };
  const info = field(1, 'ya29.synthetic-current');
  const row = field(1, info.toString('base64'));
  const entry = Buffer.concat([field(1, 'oauthTokenInfoSentinelKey'), field(2, row)]);
  return field(1, entry).toString('base64');
}

test('modern encoded Windows IDE credentials connect through the same public detection API', async t => {
  const { oauth, requests, database } = loadWindowsIde(t, ({ path: requestPath }) => ({ status: 200,
    data: requestPath === '/oauth2/v2/userinfo' ? { email: account } : { models: localModels } }));
  database.prepare('UPDATE ItemTable SET key=?, value=?').run('antigravityUnifiedStateSync.oauthToken', encodedCredential());
  const state = { auth: { gemini: {} }, quota: { gemini: {} } };
  assert.equal((await oauth.detectLocalAuth('gemini', state, hooks)).ok, true);
  assert.equal(state.auth.gemini.connectionSource, 'stored-auth');
  assert.ok(requests.every(({ headers }) => headers.Authorization === 'Bearer ya29.synthetic-current'));
});

test('bound account refreshes an expired token with unknown expiry before verifying identity', async t => {
  const writes = [];
  const { oauth, requests } = loadWindowsIde(t, ({ path: requestPath, headers }) => {
    if (requestPath === '/token') return { status: 200, data: { access_token: 'ya29.synthetic-refreshed', expires_in: 3600 } };
    if (requestPath === '/oauth2/v2/userinfo') return headers.Authorization === 'Bearer ya29.synthetic-expired'
      ? { status: 401, data: {} } : { status: 200, data: { email: account } };
    return { status: 200, data: { models: localModels } };
  }, { store: {
    read: () => ({ oauthTokens: { gemini: { accessToken: 'ya29.synthetic-expired', refreshToken: '1//synthetic-refresh' } } }),
    write: value => writes.push(value)
  } });
  const state = previousState();
  assert.equal((await oauth.detectLocalAuth('gemini', state, hooks)).ok, true);
  assert.ok(requests.some(({ path: requestPath }) => requestPath === '/token'));
  assert.equal(writes.length, 1);
  assert.equal(writes[0].oauthTokens.gemini.accessToken, 'ya29.synthetic-refreshed');
});

test('remote response without recognized model quota never claims connection', async t => {
  const { oauth } = loadWindowsIde(t, () => ({ status: 200, data: { models: { unknown: { quotaInfo: { remainingFraction: 0.5 } } } } }));
  const state = { auth: { gemini: {} }, quota: { gemini: {} } };
  assert.equal((await oauth.detectLocalAuth('gemini', state, hooks)).ok, false);
  assert.equal(state.auth.gemini.connected, false);
  assert.equal(state.quota.gemini.fiveHour.hidden, true);
});

test('a replaced application state and disconnect invalidate older requests and return the current state', async () => {
  let resolveLocal;
  const oauth = loadOAuth({ local: () => new Promise(resolve => { resolveLocal = resolve; }) });
  let current = previousState();
  const currentHooks = { ...hooks, getState: () => current };
  const pending = oauth.detectLocalAuth('gemini', current, currentHooks);
  current = structuredClone(current);
  await oauth.disconnectProvider('gemini', current, currentHooks);
  resolveLocal({ status: 'ok', accountLabel: account, models: localModels });
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.state, current);
  assert.equal(current.auth.gemini.connected, false);
});

test('a newly verified local identity lets anonymous history fall back only to that account', async t => {
  for (const email of [account, 'other@example.invalid']) {
    const { oauth } = loadWindowsIde(t, ({ path: requestPath }) => ({ status: 200,
      data: requestPath === '/oauth2/v2/userinfo' ? { email } : { models: localModels } }), {
      local: async () => ({ status: 'no-quota', accountLabel: account })
    });
    const state = previousState();
    state.auth.gemini = { ...state.auth.gemini, accountLabel: 'Antigravity Google', accountUnverified: true };
    assert.equal((await oauth.detectLocalAuth('gemini', state, hooks)).ok, email === account);
    assert.equal(state.quota.gemini.fiveHour.used, email === account ? 40 : 31);
  }
});

test('disconnect during cloud quota lookup never saves refreshed tokens or applies its late result', async t => {
  let releaseModels;
  let started;
  const modelsStarted = new Promise(resolve => { started = resolve; });
  const writes = [];
  let credentials = { oauthTokens: { gemini: { accessToken: 'ya29.synthetic-expired',
    refreshToken: '1//synthetic-refresh', expiresAt: 1 } } };
  const { oauth } = loadWindowsIde(t, ({ path: requestPath }) => {
    if (requestPath === '/token') return { status: 200, data: { access_token: 'ya29.synthetic-refreshed' } };
    if (requestPath === '/oauth2/v2/userinfo') return { status: 200, data: { email: account } };
    if (requestPath === '/v1internal:fetchAvailableModels') return new Promise(resolve => { releaseModels = resolve; started(); });
    return { status: 200, data: {} };
  }, { store: { read: () => structuredClone(credentials), write: value => { writes.push(value); credentials = value; } } });
  const state = previousState();
  const pending = oauth.detectLocalAuth('gemini', state, hooks);
  await modelsStarted;
  assert.equal(writes.length, 0, 'do not save a refreshed token until quota and identity are verified');
  await oauth.disconnectProvider('gemini', state, hooks);
  const writesAfterDisconnect = writes.length;
  releaseModels({ status: 200, data: { models: localModels } });
  assert.equal((await pending).ok, false);
  assert.equal(writes.length, writesAfterDisconnect);
  assert.equal(state.auth.gemini.connected, false);
  assert.equal(state.auth.gemini.autoConnectDisabled, true);
});
