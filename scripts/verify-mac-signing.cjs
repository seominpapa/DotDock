const path = require('node:path');
const { spawnSync } = require('node:child_process');

function verifyMacApp(appPath, teamId, run = spawnSync) {
  if (typeof appPath !== 'string' || !appPath.endsWith('.app') || !/^[A-Z0-9]{10}$/.test(teamId || '')) {
    throw new Error('A .app path and a valid APPLE_TEAM_ID are required for macOS release verification.');
  }
  const check = (command, args) => {
    const result = run(command, args, { encoding: 'utf8' });
    if (result.error || result.status !== 0) {
      throw new Error(`macOS release verification failed: ${path.basename(command)} ${args[0]}`);
    }
    return `${result.stdout || ''}\n${result.stderr || ''}`;
  };
  check('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath]);
  const signature = check('/usr/bin/codesign', ['--display', '--verbose=4', appPath]);
  if (!/^Authority=Developer ID Application: .+$/m.test(signature)
    || !signature.split('\n').includes(`TeamIdentifier=${teamId}`)
    || !/^Identifier=com\.dotdock\.app$/m.test(signature)
    || !/^CodeDirectory\b[^\n]*\bflags=[^\n]*\bruntime\b/m.test(signature)) {
    throw new Error('A hardened Developer ID Application signature for DotDock and the expected Apple team is required.');
  }
  // electron-builder can skip notarization when credentials are missing.
  check('/usr/bin/xcrun', ['stapler', 'validate', appPath]);
  const assessment = check('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath]);
  if (!/^source=Notarized Developer ID$/m.test(assessment)) {
    throw new Error('Gatekeeper must recognize a notarized Developer ID release.');
  }
}

module.exports = function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  verifyMacApp(path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`), process.env.APPLE_TEAM_ID);
};
module.exports.verifyMacApp = verifyMacApp;

if (require.main === module) {
  verifyMacApp(process.argv[2], process.env.APPLE_TEAM_ID);
  console.log('Verified Developer ID signature, hardened runtime, stapled ticket and Gatekeeper approval.');
}
