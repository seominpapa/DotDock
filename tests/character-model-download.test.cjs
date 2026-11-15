const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createBuiltinModelDownloader } = require('../electron/model-download.cjs');
const { validateGlb, createCharacterModelStore, registerCharacterModelIpc } = require('../electron/character-models.cjs');
const { createTriangleGlb } = require('./helpers/glb.cjs');

function fixture(t, bytes = createTriangleGlb()) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dotdock-model-download-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bundled = path.join(directory, 'bundled');
  fs.mkdirSync(bundled);
  fs.writeFileSync(path.join(bundled, 'rat.glb'), createTriangleGlb());
  const entry = { file: 'rat.glb', sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
  const manifestPath = path.join(bundled, 'manifest.json');
  const manifest = { version: '0.1.5', models: { rat: entry } };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const cacheDirectory = path.join(directory, 'cache');
  const options = { cacheDirectory, manifestPath, validateModel: validateGlb, maxBytes: 10 * 1024 * 1024 };
  return { directory, bundled, manifest, manifestPath, cacheDirectory, options, bytes };
}

function response(bytes, overrides = {}) {
  return { status: 200, headers: new Headers({ 'content-length': String(bytes.length) }),
    body: (async function* () { yield bytes.subarray(0, 17); yield bytes.subarray(17); })(), ...overrides };
}

test('downloads only the selected pinned GitHub model, coalesces requests, then verifies cache without network', async (t) => {
  const f = fixture(t);
  let requests = 0;
  const fetchRequest = async (url, options) => {
    requests++;
    assert.equal(url, 'https://raw.githubusercontent.com/seominpapa/DotDock/v0.1.5/public/models/rat.glb');
    assert.equal(options.redirect, 'error');
    return response(f.bytes);
  };
  const downloader = createBuiltinModelDownloader({ ...f.options, fetchRequest });
  assert.equal(requests, 0);
  const result = await Promise.all([downloader.read('rat'), downloader.read('rat')]);
  assert.deepEqual(result, [f.bytes, f.bytes]);
  assert.equal(requests, 1);
  const [name] = fs.readdirSync(f.cacheDirectory);
  assert.match(name, /^rat-[a-f0-9]{64}\.glb$/);
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(f.cacheDirectory, name)).mode & 0o777, 0o600);
  const offline = createBuiltinModelDownloader({ ...f.options, fetchRequest: async () => { throw new Error('offline cache must not fetch'); } });
  assert.deepEqual(await offline.read('rat'), f.bytes);
});

test('rejects unsafe manifests and identifiers before any network request', async (t) => {
  const f = fixture(t);
  const invalid = [
    { version: '../main' }, { version: 'main' },
    { models: { rat: { ...f.manifest.models.rat, file: '../rat.glb' } } },
    { models: { rat: { ...f.manifest.models.rat, sha256: 'bad' } } },
    { models: { rat: { ...f.manifest.models.rat, bytes: 10 * 1024 * 1024 + 1 } } }
  ];
  let requests = 0;
  for (const change of invalid) {
    fs.writeFileSync(f.manifestPath, JSON.stringify({ ...f.manifest, ...change }));
    await assert.rejects(createBuiltinModelDownloader({ ...f.options, fetchRequest: async () => { requests++; } }).read('rat'));
  }
  await assert.rejects(createBuiltinModelDownloader(f.options).read('../rat'));
  await assert.rejects(createBuiltinModelDownloader(f.options).read('cat'));
  assert.equal(requests, 0);
});

test('rejects redirects, HTTP failures, short, oversized and hash mismatched responses without caching', async (t) => {
  const f = fixture(t);
  const cases = [
    () => response(f.bytes, { status: 404 }),
    () => response(f.bytes, { redirected: true }),
    () => response(f.bytes, { url: 'https://example.com/rat.glb' }),
    () => response(f.bytes.subarray(1)),
    () => response(Buffer.concat([f.bytes, Buffer.from('x')]), { headers: new Headers() }),
    () => response(Buffer.alloc(f.bytes.length))
  ];
  for (const makeResponse of cases) {
    await assert.rejects(createBuiltinModelDownloader({ ...f.options, fetchRequest: async () => makeResponse() }).read('rat'));
    assert.deepEqual(fs.readdirSync(f.cacheDirectory), []);
  }
});

test('validates GLB after digest validation and repairs a corrupted cache atomically', async (t) => {
  const invalid = fixture(t, Buffer.alloc(100));
  await assert.rejects(createBuiltinModelDownloader({ ...invalid.options, fetchRequest: async () => response(invalid.bytes) }).read('rat'), /GLB/);
  assert.deepEqual(fs.readdirSync(invalid.cacheDirectory), []);
  const f = fixture(t);
  let requests = 0;
  const downloader = createBuiltinModelDownloader({ ...f.options, fetchRequest: async () => { requests++; return response(f.bytes); } });
  await downloader.read('rat');
  const cached = path.join(f.cacheDirectory, fs.readdirSync(f.cacheDirectory)[0]);
  fs.writeFileSync(cached, Buffer.alloc(f.bytes.length));
  assert.deepEqual(await downloader.read('rat'), f.bytes);
  assert.equal(requests, 2);
  assert.deepEqual(fs.readdirSync(f.cacheDirectory).filter((name) => name.endsWith('.tmp')), []);
});

test('deadline aborts stalled downloads and a subsequent call can retry', async (t) => {
  const f = fixture(t);
  let signal;
  let requests = 0;
  const downloader = createBuiltinModelDownloader({ ...f.options, timeoutMs: 15, fetchRequest: async (_url, options) => {
    requests++;
    signal = options.signal;
    if (requests === 1) return new Promise(() => {});
    return response(f.bytes);
  } });
  await assert.rejects(downloader.read('rat'), /시간|timeout/i);
  assert.equal(signal.aborted, true);
  assert.deepEqual(await downloader.read('rat'), f.bytes);
  assert.equal(requests, 2);
});

test('deadline also bounds stalled bodies and late fetch completion never writes cache', async (t) => {
  const f = fixture(t);
  const body = (async function* () { yield f.bytes.subarray(0, 17); await new Promise(() => {}); })();
  await assert.rejects(createBuiltinModelDownloader({ ...f.options, timeoutMs: 15,
    fetchRequest: async () => response(f.bytes, { body }) }).read('rat'), /시간/);
  let finish;
  const downloader = createBuiltinModelDownloader({ ...f.options, timeoutMs: 15,
    fetchRequest: () => new Promise((resolve) => { finish = resolve; }) });
  await assert.rejects(downloader.read('rat'), /시간/);
  finish(response(f.bytes));
  await new Promise(setImmediate);
  assert.deepEqual(fs.readdirSync(f.cacheDirectory), []);
});

test('rejects cache directory symlinks and replaces cache file symlinks without touching targets', async (t) => {
  const f = fixture(t);
  const outside = path.join(f.directory, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, f.cacheDirectory, process.platform === 'win32' ? 'junction' : 'dir');
  let requests = 0;
  const options = { ...f.options, fetchRequest: async () => { requests++; return response(f.bytes); } };
  await assert.rejects(createBuiltinModelDownloader(options).read('rat'));
  assert.equal(requests, 0);
  fs.rmSync(f.cacheDirectory, { recursive: true, force: true });
  fs.mkdirSync(f.cacheDirectory);
  const target = path.join(outside, 'private.glb');
  fs.writeFileSync(target, 'preserve');
  const cacheFile = path.join(f.cacheDirectory, `rat-${f.manifest.models.rat.sha256}.glb`);
  if (process.platform !== 'win32') {
    fs.symlinkSync(target, cacheFile);
    assert.deepEqual(await createBuiltinModelDownloader(options).read('rat'), f.bytes);
    assert.equal(fs.readFileSync(target, 'utf8'), 'preserve');
    assert.equal(fs.lstatSync(cacheFile).isSymbolicLink(), false);
  }
});

test('display read falls back to bundled models offline and custom imports never download', async (t) => {
  const f = fixture(t);
  let requests = 0;
  const downloader = createBuiltinModelDownloader({ ...f.options, fetchRequest: async () => { requests++; throw new Error('offline'); } });
  const store = createCharacterModelStore(path.join(f.directory, 'imports'), f.bundled, { builtinDownloader: downloader });
  assert.equal(requests, 0);
  assert.deepEqual(Buffer.from((await store.readForDisplay('zodiac:rat')).base64, 'base64'), f.bytes);
  assert.equal(requests, 1);
  const imported = store.importFile(path.join(f.bundled, 'rat.glb'));
  assert.equal((await store.readForDisplay(imported.modelId)).ok, true);
  assert.equal(requests, 1);
});

test('missing or malformed local manifests fall back offline without a request', async (t) => {
  const f = fixture(t);
  let requests = 0;
  const downloader = createBuiltinModelDownloader({ ...f.options, fetchRequest: async () => { requests++; } });
  const store = createCharacterModelStore(path.join(f.directory, 'imports'), f.bundled, { builtinDownloader: downloader });
  fs.unlinkSync(f.manifestPath);
  assert.equal((await store.readForDisplay('zodiac:rat')).ok, true);
  fs.writeFileSync(f.manifestPath, 'bad JSON');
  assert.equal((await store.readForDisplay('zodiac:rat')).ok, true);
  assert.equal(requests, 0);
});

test('cache write failures preserve existing entries and fall back to bundled models', async (t) => {
  const f = fixture(t);
  fs.mkdirSync(f.cacheDirectory);
  const destination = path.join(f.cacheDirectory, `rat-${f.manifest.models.rat.sha256}.glb`);
  fs.mkdirSync(destination);
  const downloader = createBuiltinModelDownloader({ ...f.options, fetchRequest: async () => response(f.bytes) });
  const store = createCharacterModelStore(path.join(f.directory, 'imports'), f.bundled, { builtinDownloader: downloader });
  assert.equal((await store.readForDisplay('zodiac:rat')).ok, true);
  assert.equal(fs.lstatSync(destination).isDirectory(), true);
  assert.equal(fs.readdirSync(f.cacheDirectory).length, 1);
});

test('IPC awaits download failures and returns only the bundled fallback to the allowed caller', async (t) => {
  const f = fixture(t);
  const handlers = new Map();
  let requests = 0;
  registerCharacterModelIpc({ ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
    getWindow: () => ({ webContents: { id: 7 } }), getUserData: () => f.directory,
    getBundledModelsDirectory: () => f.bundled,
    fetchRequest: async () => { requests++; throw new Error('/private/path?secret=preserve'); } });
  const read = handlers.get('dotdock:get-character-model');
  assert.equal((await read({ sender: { id: 8 } }, 'zodiac:rat')).ok, false);
  assert.equal(requests, 0);
  assert.equal((await read({ sender: { id: 7 } }, 'zodiac:rat')).ok, true);
  assert.equal(requests, 1);
  assert.equal((await read({ sender: { id: 7 } }, 'zodiac:cat')).ok, false);
  assert.equal(requests, 1);
});
