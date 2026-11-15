const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function loadOAuth(overrides = {}) {
  const captured = {};
  const fakeHttp = {
    createServer: (handler) => {
      captured.handler = handler;
      const server = new EventEmitter();
      server.close = () => {};
      server.listen = (...args) => { captured.listen = args; server.emit('listening'); };
      return server;
    }
  };
  const mod = { exports: {} };
  const filename = path.join(__dirname, '../electron/oauth.cjs');
  const wrapped = vm.runInThisContext(`(function(require,module,exports,process,setTimeout,clearTimeout){${fs.readFileSync(filename, 'utf8')}\n})`, { filename });
  const localRequire = (id) => {
    if (id === 'electron') return {
      app: { getPath: () => '/not-used' },
      shell: { openExternal: async (url) => { captured.authUrl = url; } },
      safeStorage: { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value), decryptString: (value) => value.toString() }
    };
    if (id === 'node:http') return fakeHttp;
    if (id === 'node:https') return overrides.https || { request: () => { throw new Error('Network is disabled in this test'); } };
    if (id === 'node:fs' && overrides.fs) return overrides.fs;
    if (id === './credential-store.cjs' && overrides.store) return overrides.store;
    if (id.startsWith('./')) return require(path.join(path.dirname(filename), id));
    return require(id);
  };
  wrapped(localRequire, mod, mod.exports, { env: {}, platform: process.platform }, () => 1, () => {});
  return { oauth: mod.exports, captured };
}

test('OAuth callback requires state and binds to loopback only', async () => {
  for (const state of ['', '&state=wrong']) {
    const { oauth, captured } = loadOAuth();
    const pending = oauth.openOAuthLoginWindow('codex', {}, {});
    await captured.handler({ url: `/auth/callback?code=test${state}` }, { writeHead: () => {}, end: () => {} });
    const result = await pending;
    assert.equal(result.ok, false);
    assert.match(result.message, /state/);
    assert.deepEqual(captured.listen, [1455, '127.0.0.1']);
  }
});

test('OAuth callback escapes untrusted error descriptions in HTML', async () => {
  const { oauth, captured } = loadOAuth();
  const pending = oauth.openOAuthLoginWindow('codex', {}, {});
  const state = new URL(captured.authUrl).searchParams.get('state');
  let html;
  await captured.handler({ url: `/auth/callback?state=${state}&error=denied&error_description=%3Cscript%3Ealert(1)%3C%2Fscript%3E` }, {
    writeHead: () => {}, end: (body) => { html = body; }
  });
  assert.equal((await pending).ok, false);
  assert.equal(html.includes('<script>'), false);
  assert.match(html, /&lt;script&gt;/);
});

test('Google direct OAuth without configured client gives local-login guidance', async () => {
  const { oauth, captured } = loadOAuth();
  const result = await oauth.openOAuthLoginWindow('gemini', {}, {});
  assert.equal(result.ok, false);
  assert.match(result.message, /Antigravity/);
  assert.match(result.message, /DOTDOCK_GOOGLE_CLIENT_ID/);
  assert.equal(captured.handler, undefined);
});

test('a token exchange does not report successful connection when quota sync fails', async () => {
  let credentials = {};
  const realStore = require('../electron/credential-store.cjs');
  const { oauth, captured } = loadOAuth({
    fs: { existsSync: () => false },
    store: { ...realStore, createCredentialStore: () => ({ read: () => credentials, write: (value) => { credentials = value; } }) },
    https: {
      request: (options, onResponse) => {
        const request = new EventEmitter();
        request.write = () => {};
        request.end = () => {
          const response = new EventEmitter();
          response.statusCode = options.path === '/oauth/token' ? 200 : 503;
          onResponse(response);
          response.emit('data', Buffer.from(JSON.stringify(options.path === '/oauth/token' ? { access_token: 'test-only' } : {})));
          response.emit('end');
        };
        return request;
      }
    }
  });
  const state = { auth: { codex: {} }, quota: { codex: {} } };
  const pending = oauth.openOAuthLoginWindow('codex', state, { saveState: () => {}, notifyStateUpdated: () => {} });
  const oauthState = new URL(captured.authUrl).searchParams.get('state');
  let status;
  await captured.handler({ url: `/auth/callback?state=${oauthState}&code=test` }, {
    writeHead: (value) => { status = value; }, end: () => {}
  });
  assert.equal((await pending).ok, false);
  assert.equal(status, 502);
  assert.equal(state.auth.codex.connected, false);
});

test('credential failures return a clear failed result without claiming a connection', async () => {
  const realStore = require('../electron/credential-store.cjs');
  const { oauth } = loadOAuth({
    store: { ...realStore, createCredentialStore: () => ({ read: () => { throw new realStore.CredentialStoreError('preserved'); } }) }
  });
  const state = { auth: { codex: { connected: true } } };
  const result = await oauth.detectLocalAuth('codex', state, {});
  assert.equal(result.ok, false);
  assert.equal(result.message, 'preserved');
  assert.equal(state.auth.codex.connected, false);
});
