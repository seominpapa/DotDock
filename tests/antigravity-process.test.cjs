const assert = require('node:assert/strict');
const { test } = require('node:test');
const { discoverAntigravityEndpoints } = require('../electron/antigravity-process.cjs');

const MAC_EXE = '/Applications/Antigravity IDE.app/Contents/Resources/app/extensions/antigravity/bin/language_server_macos_arm';
const WIN_EXE = 'C:\\Users\\Synthetic User\\AppData\\Local\\Programs\\Antigravity IDE\\resources\\app\\extensions\\antigravity\\bin\\language_server_windows_x64.exe';
const CSRF = 'synthetic-standard-token';
const EXT_CSRF = 'synthetic-extension-token';
const SID = 'S-1-5-21-synthetic-user';
const fakeFs = { realpath: async (file) => file, stat: async () => ({ isFile: () => true, mode: 0o755 }) };

function mac(options = {}) {
  const calls = [];
  const command = `${MAC_EXE} --csrf_token=${CSRF} --extension_server_port 4555 --extension_server_csrf_token ${EXT_CSRF}`;
  const replies = {
    ps: `123 501 ${command}\n`,
    text: `p123\nu501\nn${MAC_EXE}\n`,
    ports: 'p123\nu501\nn127.0.0.1:4555\nn127.0.0.1:4666\n',
    ...options.replies
  };
  return {
    calls,
    options: {
      platform: 'darwin', uid: 501, homeDir: '/Users/Synthetic User', fs: options.fs || fakeFs,
      execFile: (file, args, settings, callback) => {
        calls.push({ file, args, settings });
        const reply = file.endsWith('/ps') ? replies.ps : args.includes('txt') ? replies.text : replies.ports;
        queueMicrotask(() => callback(options.error || null, reply));
      }
    }
  };
}

function windows(options = {}) {
  const calls = [];
  const record = {
    pid: 234, ownerSid: SID, executablePath: WIN_EXE,
    commandLine: `"${WIN_EXE}" --csrf_token ${CSRF} --extension_server_port=4555 --extension_server_csrf_token=${EXT_CSRF}`,
    ports: [4555, 4666], ...options.record
  };
  return {
    calls,
    options: {
      platform: 'win32', fs: options.fs || fakeFs,
      env: { LOCALAPPDATA: 'C:\\Users\\Synthetic User\\AppData\\Local', ProgramFiles: 'C:\\Program Files' },
      execFile: (file, args, settings, callback) => {
        calls.push({ file, args, settings });
        queueMicrotask(() => callback(options.error || null, JSON.stringify({ currentSid: SID, processes: [record] })));
      }
    }
  };
}

test('macOS discovers an installed IDE in a path with spaces and uses only owned listener ports', async () => {
  const fixture = mac();
  assert.deepEqual(await discoverAntigravityEndpoints(fixture.options), [
    { pid: 123, port: 4555, protocol: 'http:', csrfToken: EXT_CSRF },
    { pid: 123, port: 4666, protocol: 'https:', csrfToken: CSRF }
  ]);
  assert.equal(fixture.calls.length, 3);
  assert.ok(fixture.calls.every(({ settings }) => settings.timeout <= 2000 && settings.maxBuffer <= 2 * 1024 * 1024));
});

test('macOS excludes another user, missing CSRF, CLI, and non-Antigravity processes', async () => {
  for (const ps of [
    `123 502 ${MAC_EXE} --csrf_token ${CSRF}`,
    `123 501 ${MAC_EXE}`,
    `123 501 /usr/local/bin/agy --csrf_token ${CSRF}`,
    `123 501 /Applications/Other.app/language_server_macos_arm --csrf_token ${CSRF}`
  ]) {
    const fixture = mac({ replies: { ps } });
    assert.deepEqual(await discoverAntigravityEndpoints(fixture.options), []);
    assert.equal(fixture.calls.length, 1);
  }
});

test('macOS rechecks PID owner and rejects a symlink outside trusted installation roots', async () => {
  assert.deepEqual(await discoverAntigravityEndpoints(mac({ replies: { text: `p123\nu502\nn${MAC_EXE}\n` } }).options), []);
  assert.deepEqual(await discoverAntigravityEndpoints(mac({ replies: { ports: 'p123\nu502\nn127.0.0.1:4666\n' } }).options), []);
  const fs = { ...fakeFs, realpath: async () => '/private/tmp/Antigravity.app/language_server_macos_arm' };
  assert.deepEqual(await discoverAntigravityEndpoints(mac({ fs }).options), []);
});

test('an unowned extension port never receives a CSRF token', async () => {
  const fixture = mac({ replies: { ports: 'p123\nu501\nn127.0.0.1:4666\n' } });
  assert.deepEqual(await discoverAntigravityEndpoints(fixture.options), [
    { pid: 123, port: 4666, protocol: 'https:', csrfToken: CSRF }
  ]);
});

test('Windows verifies the current SID, executable path with spaces, and process-owned ports', async () => {
  const fixture = windows();
  assert.deepEqual(await discoverAntigravityEndpoints(fixture.options), [
    { pid: 234, port: 4555, protocol: 'http:', csrfToken: EXT_CSRF },
    { pid: 234, port: 4666, protocol: 'https:', csrfToken: CSRF }
  ]);
  const [{ args, settings }] = fixture.calls;
  assert.ok(args.includes('-EncodedCommand'));
  const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
  assert.match(script, /GetOwnerSid/);
  assert.match(script, /WindowsIdentity/);
  assert.match(script, /Get-NetTCPConnection/);
  assert.match(script, /OwningProcess/);
  assert.match(script, /Listen/);
  assert.match(script, /OutputEncoding.*UTF8Encoding/);
  assert.doesNotMatch(script, /Invoke-WebRequest|Start-Process|RunAs|Get-Credential/);
  assert.equal(settings.windowsHide, true);
});

test('Windows rejects another SID, untrusted executable, non-file executable, and missing CSRF', async () => {
  for (const record of [
    { ownerSid: 'S-1-5-21-other-user' },
    { executablePath: 'C:\\Temp\\Antigravity\\language_server_windows_x64.exe' },
    { commandLine: `"${WIN_EXE}" --extension_server_port 4555` }
  ]) assert.deepEqual(await discoverAntigravityEndpoints(windows({ record }).options), []);
  const fs = { ...fakeFs, stat: async () => ({ isFile: () => false, mode: 0o755 }) };
  assert.deepEqual(await discoverAntigravityEndpoints(windows({ fs }).options), []);
});

test('discovery fails closed for denied process inspection, empty output, and unsupported platforms', async () => {
  const denied = Object.assign(new Error('synthetic private command line'), { code: 'EACCES' });
  assert.deepEqual(await discoverAntigravityEndpoints(windows({ error: denied }).options), []);
  assert.deepEqual(await discoverAntigravityEndpoints(mac({ error: denied }).options), []);
  assert.deepEqual(await discoverAntigravityEndpoints(mac({ replies: { ps: '' } }).options), []);
  assert.deepEqual(await discoverAntigravityEndpoints({ platform: 'linux' }), []);
});

test('ports are deduplicated and bounded and require valid integers', async () => {
  const fixture = windows({ record: { ports: [4555, 4666, 4666, 0, -1, 65536, '4777', ...Array.from({ length: 20 }, (_, i) => 4800 + i)] } });
  const endpoints = await discoverAntigravityEndpoints(fixture.options);
  assert.equal(endpoints.length, 8);
  assert.equal(new Set(endpoints.map(({ port }) => port)).size, 8);
  assert.ok(endpoints.every(({ port }) => Number.isInteger(port) && port > 0 && port <= 65535));
});

test('discovery caps inspected process counts and supports a user Applications directory', async () => {
  const executable = MAC_EXE.replace('/Applications/', '/Users/Synthetic User/Applications/');
  const fixture = mac({ replies: { ps: Array.from({ length: 8 }, () => `123 501 ${executable} --csrf_token ${CSRF}`).join('\n'), text: `p123\nu501\nn${executable}\n` } });
  await discoverAntigravityEndpoints(fixture.options);
  assert.equal(fixture.calls.length, 9, 'only four processes may receive two lsof inspections each');
});

test('malformed Windows metadata, failed filesystem inspection, and cancellation fail closed', async () => {
  const broken = windows();
  broken.options.execFile = (_file, _args, _settings, callback) => callback(null, 'not JSON');
  assert.deepEqual(await discoverAntigravityEndpoints(broken.options), []);
  const failedFs = { ...fakeFs, realpath: async () => { throw new Error('synthetic private path'); } };
  assert.deepEqual(await discoverAntigravityEndpoints(windows({ fs: failedFs }).options), []);
  const signal = AbortSignal.abort();
  const fixture = windows();
  assert.deepEqual(await discoverAntigravityEndpoints({ ...fixture.options, signal }), []);
  assert.equal(fixture.calls.length, 0);
});
