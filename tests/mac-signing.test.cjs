const assert = require('node:assert/strict');
const test = require('node:test');
const { verifyMacApp } = require('../scripts/verify-mac-signing.cjs');

const teamId = 'ABCDE12345';
const signature = [
  'Identifier=com.dotdock.app',
  'CodeDirectory v=20500 flags=0x10000(runtime)',
  `Authority=Developer ID Application: Example (${teamId})`,
  `TeamIdentifier=${teamId}`
].join('\n');

function fixture(options = {}) {
  const calls = [];
  const run = (command, args) => {
    calls.push([command, args]);
    const isDisplay = args.includes('--display');
    const isAssessment = command.endsWith('/spctl');
    return {
      status: options.failAt === calls.length ? 1 : 0,
      stdout: '',
      stderr: isDisplay ? (options.signature ?? signature)
        : isAssessment ? (options.assessment ?? 'accepted\nsource=Notarized Developer ID\n') : ''
    };
  };
  return { calls, run };
}

test('requires a valid app path and Apple team before native verification', () => {
  const f = fixture();
  for (const [app, team] of [['app.dmg', teamId], ['', teamId], ['DotDock.app', ''], ['DotDock.app', 'bad\nteam']]) {
    assert.throws(() => verifyMacApp(app, team, f.run));
  }
  assert.equal(f.calls.length, 0);
});

test('accepts only a verified Developer ID app with a stapled ticket and Gatekeeper approval', () => {
  const f = fixture();
  verifyMacApp('/tmp/DotDock.app', teamId, f.run);
  assert.equal(f.calls.length, 4);
  assert.deepEqual(f.calls[0], ['/usr/bin/codesign', ['--verify', '--deep', '--strict', '/tmp/DotDock.app']]);
  assert.deepEqual(f.calls[2], ['/usr/bin/xcrun', ['stapler', 'validate', '/tmp/DotDock.app']]);
  assert.equal(f.calls[3][0], '/usr/sbin/spctl');
});

test('rejects ad-hoc, development, other-team, other-app and non-hardened signatures', () => {
  for (const invalid of [
    signature.replace(/^Authority=.*\n/m, ''),
    signature.replace('Developer ID Application:', 'Apple Development:'),
    signature.replace(`TeamIdentifier=${teamId}`, 'TeamIdentifier=OTHER12345'),
    signature.replace('Identifier=com.dotdock.app', 'Identifier=com.other.app'),
    signature.replace('flags=0x10000(runtime)', 'flags=0x0(none)')
  ]) {
    const f = fixture({ signature: invalid });
    assert.throws(() => verifyMacApp('/tmp/DotDock.app', teamId, f.run));
    assert.equal(f.calls.length, 2);
  }
});

test('a failed signature, missing ticket or Gatekeeper rejection blocks the release', () => {
  for (const failAt of [1, 2, 3, 4]) {
    const f = fixture({ failAt });
    assert.throws(() => verifyMacApp('/tmp/DotDock.app', teamId, f.run));
    assert.equal(f.calls.length, failAt);
  }
  const f = fixture({ assessment: 'accepted\nsource=Developer ID\n' });
  assert.throws(() => verifyMacApp('/tmp/DotDock.app', teamId, f.run), /notarized/i);
});

test('native tool launch failures are reported and Windows signing hooks do nothing', async () => {
  assert.throws(() => verifyMacApp('/tmp/DotDock.app', teamId,
    () => ({ status: null, error: new Error('not available') })), /verification failed/i);
  await require('../scripts/verify-mac-signing.cjs')({ electronPlatformName: 'win32' });
});
