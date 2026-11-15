const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { isNewerVersion, selectInstaller, createUpdater } = require('../electron/updates.cjs');

const bytes = Buffer.from('verified installer');
const digest = `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
const asset = (name, overrides = {}) => ({
  name, size: bytes.length, digest,
  browser_download_url: `https://github.com/seominpapa/DotDock/releases/download/v0.2.0/${name}`,
  ...overrides
});
const release = (overrides = {}) => ({
  tag_name: 'v0.2.0', draft: false, prerelease: false,
  html_url: 'https://github.com/seominpapa/DotDock/releases/tag/v0.2.0',
  assets: [asset('DotDock-0.2.0-arm64.dmg'), asset('DotDock-0.2.0-x64.dmg'), asset('DotDock-Setup-0.2.0-x64.exe')],
  ...overrides
});

test('stable versions compare numerically and reject malformed/prerelease versions', () => {
  assert.equal(isNewerVersion('v0.1.10', '0.1.9'), true);
  for (const version of ['0.1.9', '0.1.8', '0.1.10-beta', 'invalid', '1.2', '01.2.3']) {
    assert.equal(isNewerVersion(version, '0.1.9'), false);
  }
  assert.equal(isNewerVersion('1.0.0', '0.9.99'), true);
});

test('selects exact installer for native OS and architecture', () => {
  assert.equal(selectInstaller(release(), 'darwin', 'arm64').name, 'DotDock-0.2.0-arm64.dmg');
  assert.equal(selectInstaller(release(), 'darwin', 'x64').name, 'DotDock-0.2.0-x64.dmg');
  assert.equal(selectInstaller(release(), 'win32', 'x64').name, 'DotDock-Setup-0.2.0-x64.exe');
  assert.equal(selectInstaller(release(), 'win32', 'arm64'), null);
  assert.equal(selectInstaller(release({ prerelease: true }), 'darwin', 'arm64'), null);
  assert.equal(selectInstaller(release({ draft: true }), 'darwin', 'arm64'), null);
});

test('rejects untrusted downloads, invalid sizes and missing integrity metadata', () => {
  for (const overrides of [
    { digest: null }, { digest: 'sha256:bad' }, { size: -1 }, { size: 2e9 },
    { browser_download_url: 'https://evil.test/installer.dmg' },
    { browser_download_url: 'https://github.com/other/DotDock/releases/download/v0.2.0/DotDock-0.2.0-arm64.dmg' },
    { browser_download_url: 'https://github.com/seominpapa/DotDock/releases/download/v0.1.0/DotDock-0.2.0-arm64.dmg' }
  ]) {
    assert.equal(selectInstaller(release({ assets: [asset('DotDock-0.2.0-arm64.dmg', overrides)] }), 'darwin', 'arm64'), null);
  }
});

async function fixture(t, options = {}) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dotdock-update-test-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const opened = [];
  const messages = [];
  let requests = 0;
  const updater = createUpdater({
    app: { getVersion: () => '0.1.0', getPath: () => temp },
    shell: { openPath: async (file) => { opened.push(file); return options.openError || ''; } },
    dialog: { showMessageBox: async (message) => { messages.push(message); return { response: options.response ?? 1 }; } },
    platform: 'darwin', arch: 'arm64',
    fetch: async (url) => {
      requests++;
      if (options.networkError) throw new Error('private internal network detail');
      if (url.includes('api.github.com')) return new Response(JSON.stringify(options.release || release()), { status: options.status || 200 });
      return new Response(options.download || bytes);
    }
  });
  return { updater, opened, messages, get requests() { return requests; }, temp };
}

test('checks newer, current and unavailable releases without leaking network details', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.updater.check()).available, true);
  assert.equal(f.updater.getInfo().currentVersion, '0.1.0');
  const same = await fixture(t, { release: release({ tag_name: 'v0.1.0' }) });
  assert.equal((await same.updater.check()).available, false);
  for (const options of [{ status: 404 }, { status: 403 }, { networkError: true }]) {
    const failed = await fixture(t, options);
    const result = await failed.updater.check();
    assert.equal(result.available, false);
    assert.ok(result.error);
    assert.doesNotMatch(result.message, /private internal/);
  }
});

test('prompts at startup only for newer releases, and respects later', async (t) => {
  const f = await fixture(t);
  await f.updater.promptAtStartup();
  await f.updater.promptAtStartup();
  assert.equal(f.messages.length, 1);
  assert.equal(f.opened.length, 0);
  const same = await fixture(t, { release: release({ tag_name: 'v0.1.0' }) });
  await same.updater.promptAtStartup();
  assert.equal(same.messages.length, 0);
});

test('downloads and opens only a complete installer with verified digest', async (t) => {
  const f = await fixture(t);
  await f.updater.check();
  const result = await f.updater.install();
  assert.equal(result.ok, true);
  assert.equal(f.opened.length, 1);
  assert.deepEqual(await fs.readFile(f.opened[0]), bytes);
});

test('corrupt/truncated downloads are removed and never launched', async (t) => {
  for (const download of [Buffer.from('corrupt installer!'), Buffer.from('short')]) {
    const f = await fixture(t, { download });
    await f.updater.check();
    assert.equal((await f.updater.install()).ok, false);
    assert.equal(f.opened.length, 0);
    assert.deepEqual(await fs.readdir(f.temp), []);
  }
});

test('installer errors are reported and concurrent clicks launch only once', async (t) => {
  const f = await fixture(t);
  await f.updater.check();
  const results = await Promise.all([f.updater.install(), f.updater.install()]);
  assert.ok(results.every((r) => r.ok));
  assert.equal(f.opened.length, 1);
  const failed = await fixture(t, { openError: 'cannot open' });
  await failed.updater.check();
  assert.equal((await failed.updater.install()).ok, false);
});
