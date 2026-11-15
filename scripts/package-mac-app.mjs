import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const pkgJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const sourceApp = path.join(rootDir, 'node_modules', 'electron', 'dist', 'Electron.app');
const releaseDir = path.join(rootDir, 'release');
const targetApp = path.join(releaseDir, 'DotDock.app');

if (!fs.existsSync(sourceApp)) {
  throw new Error(`Electron.app not found at ${sourceApp}`);
}

fs.rmSync(targetApp, { recursive: true, force: true });
fs.mkdirSync(releaseDir, { recursive: true });

// Preserve macOS framework symlinks inside Electron.app
execFileSync('ditto', [sourceApp, targetApp], { stdio: 'inherit' });

const appResourcesDir = path.join(targetApp, 'Contents', 'Resources', 'app');
fs.mkdirSync(appResourcesDir, { recursive: true });
fs.cpSync(path.join(rootDir, 'dist'), path.join(appResourcesDir, 'dist'), { recursive: true });
fs.cpSync(path.join(rootDir, 'electron'), path.join(appResourcesDir, 'electron'), {
  recursive: true
});
fs.copyFileSync(path.join(rootDir, 'package.json'), path.join(appResourcesDir, 'package.json'));

const infoPlistPath = path.join(targetApp, 'Contents', 'Info.plist');
const appIconSource = path.join(rootDir, 'electron', 'app-icon.png');
const bundleResourcesDir = path.join(targetApp, 'Contents', 'Resources');
const dotdockIcnsPath = path.join(bundleResourcesDir, 'dotdock.icns');
const electronIcnsPath = path.join(bundleResourcesDir, 'electron.icns');

if (fs.existsSync(appIconSource)) {
  const iconsetDir = path.join(releaseDir, 'dotdock.iconset');
  fs.rmSync(iconsetDir, { recursive: true, force: true });
  fs.mkdirSync(iconsetDir, { recursive: true });

  const iconSizes = [
    ['icon_16x16.png', 16],
    ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32],
    ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128],
    ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256],
    ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512],
    ['icon_512x512@2x.png', 1024]
  ];

  for (const [filename, size] of iconSizes) {
    execFileSync(
      '/usr/bin/sips',
      ['-z', String(size), String(size), appIconSource, '--out', path.join(iconsetDir, filename)],
      { stdio: 'pipe' }
    );
  }

  execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconsetDir, '-o', dotdockIcnsPath], {
    stdio: 'inherit'
  });
  fs.copyFileSync(dotdockIcnsPath, electronIcnsPath);
  fs.rmSync(iconsetDir, { recursive: true, force: true });
}

const plistEntries = [
  ['CFBundleName', 'DotDock'],
  ['CFBundleDisplayName', 'DotDock'],
  ['CFBundleIdentifier', 'com.dotdock.app'],
  ['CFBundleShortVersionString', pkgJson.version],
  ['CFBundleVersion', pkgJson.version],
  ['CFBundleIconFile', 'dotdock.icns']
];

for (const [key, value] of plistEntries) {
  try {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, infoPlistPath], {
      stdio: 'pipe'
    });
  } catch {
    execFileSync(
      '/usr/libexec/PlistBuddy',
      ['-c', `Add :${key} string ${value}`, infoPlistPath],
      { stdio: 'inherit' }
    );
  }
}

execFileSync('codesign', ['--force', '--deep', '--sign', '-', targetApp], { stdio: 'inherit' });
const now = new Date();
fs.utimesSync(targetApp, now, now);
console.log(`Packaged macOS app bundle: ${targetApp}`);

const dmgPath = path.join(releaseDir, `DotDock-${pkgJson.version}-${process.arch}.dmg`);
const dmgStagingDir = path.join(releaseDir, 'dmg-staging');
fs.rmSync(dmgStagingDir, { recursive: true, force: true });
fs.mkdirSync(dmgStagingDir, { recursive: true });
execFileSync('ditto', [targetApp, path.join(dmgStagingDir, 'DotDock.app')], { stdio: 'inherit' });
fs.symlinkSync('/Applications', path.join(dmgStagingDir, 'Applications'));
execFileSync(
  '/usr/bin/hdiutil',
  ['create', '-volname', 'DotDock', '-srcfolder', dmgStagingDir, '-ov', '-format', 'UDZO', dmgPath],
  { stdio: 'inherit' }
);
fs.rmSync(dmgStagingDir, { recursive: true, force: true });
console.log(`Packaged macOS DMG installer: ${dmgPath}`);
