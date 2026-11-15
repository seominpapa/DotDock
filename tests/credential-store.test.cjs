const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createCredentialStore, CredentialStoreError } = require('../electron/credential-store.cjs');

function fixture(t, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotdock-credentials-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'credentials.json');
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value).reverse(),
    decryptString: (value) => Buffer.from(value).reverse().toString(),
    ...overrides
  };
  return { filePath, store: createCredentialStore(filePath, safeStorage) };
}

test('round-trips credentials without writing the plaintext token', (t) => {
  const { filePath, store } = fixture(t);
  const credentials = { tokens: { codex: 'test-private-value' } };
  assert.deepEqual(store.read(), {});
  store.write(credentials);
  assert.equal(fs.readFileSync(filePath, 'utf8').includes('test-private-value'), false);
  assert.deepEqual(store.read(), credentials);
  if (process.platform !== 'win32') assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
});

test('migrates legacy plaintext only after encrypted data is safely written', (t) => {
  const { filePath, store } = fixture(t);
  const credentials = { oauthTokens: { claude: { refreshToken: 'old-value' } } };
  fs.writeFileSync(filePath, JSON.stringify(credentials));
  assert.deepEqual(store.read(), credentials);
  assert.equal(JSON.parse(fs.readFileSync(filePath, 'utf8')).format, 'dotdock-encrypted-v1');
  assert.deepEqual(store.read(), credentials);
});

test('unavailable encryption leaves legacy credentials untouched', (t) => {
  const { filePath, store } = fixture(t, { isEncryptionAvailable: () => false });
  const legacy = '{"tokens":{"codex":"keep-me"}}';
  fs.writeFileSync(filePath, legacy);
  assert.throws(() => store.read(), CredentialStoreError);
  assert.throws(() => store.write({}), CredentialStoreError);
  assert.equal(fs.readFileSync(filePath, 'utf8'), legacy);
});

test('basic_text storage is rejected rather than presented as encryption', (t) => {
  const { store } = fixture(t, { getSelectedStorageBackend: () => 'basic_text' });
  assert.throws(() => store.write({ tokens: {} }), CredentialStoreError);
});

test('corrupt JSON and failed decryption are never replaced with empty state', (t) => {
  const { filePath, store } = fixture(t, { decryptString: () => { throw new Error('private detail'); } });
  fs.writeFileSync(filePath, '{broken');
  assert.throws(() => store.read(), CredentialStoreError);
  assert.equal(fs.readFileSync(filePath, 'utf8'), '{broken');
  store.write({ tokens: { codex: 'keep-me' } });
  const encrypted = fs.readFileSync(filePath, 'utf8');
  assert.throws(() => store.read(), (error) => error instanceof CredentialStoreError && !error.message.includes('private detail'));
  assert.equal(fs.readFileSync(filePath, 'utf8'), encrypted);
});

test('encryption failure preserves the original file and creates no partial file', (t) => {
  const { filePath, store } = fixture(t, { encryptString: () => { throw new Error('private detail'); } });
  const legacy = '{"tokens":{"codex":"keep-me"}}';
  fs.writeFileSync(filePath, legacy);
  assert.throws(() => store.read(), CredentialStoreError);
  assert.equal(fs.readFileSync(filePath, 'utf8'), legacy);
  assert.deepEqual(fs.readdirSync(path.dirname(filePath)), ['credentials.json']);
});

test('unknown encrypted formats are preserved rather than treated as legacy tokens', (t) => {
  const { filePath, store } = fixture(t);
  const unknown = '{"format":"future-format","data":"opaque"}';
  fs.writeFileSync(filePath, unknown);
  assert.throws(() => store.read(), CredentialStoreError);
  assert.equal(fs.readFileSync(filePath, 'utf8'), unknown);
});
