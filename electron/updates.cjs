const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const REPOSITORY = 'seominpapa/DotDock';
const RELEASES_URL = `https://github.com/${REPOSITORY}/releases/latest`;
const MAX_INSTALLER_BYTES = 750 * 1024 * 1024;

function parseVersion(value) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value || '');
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

function isNewerVersion(candidate, current) {
  const next = parseVersion(candidate);
  const installed = parseVersion(current);
  if (!next || !installed) return false;
  for (let i = 0; i < 3; i++) {
    if (next[i] !== installed[i]) return next[i] > installed[i];
  }
  return false;
}

function selectInstaller(release, platform, arch) {
  if (!release || release.draft || release.prerelease || !parseVersion(release.tag_name)) return null;
  const version = release.tag_name.replace(/^v/, '');
  const name = platform === 'darwin' && ['arm64', 'x64'].includes(arch)
    ? `DotDock-${version}-${arch}.dmg`
    : platform === 'win32' && arch === 'x64' ? `DotDock-Setup-${version}-x64.exe` : null;
  if (!name || !Array.isArray(release.assets)) return null;
  const expectedUrl = `https://github.com/${REPOSITORY}/releases/download/${release.tag_name}/${name}`;
  return release.assets.find((asset) => asset.name === name &&
    asset.browser_download_url === expectedUrl &&
    /^sha256:[a-f0-9]{64}$/.test(asset.digest || '') &&
    Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size <= MAX_INSTALLER_BYTES) || null;
}

function createUpdater({ app, shell, dialog, fetch: fetchRequest = globalThis.fetch, platform = process.platform, arch = process.arch }) {
  let info = { currentVersion: app.getVersion(), latestVersion: null, available: false,
    downloadAvailable: false, releaseUrl: RELEASES_URL, message: '새 버전을 확인해 주세요.' };
  let installer = null;
  let checking = null;
  let installing = null;
  let prompted = false;

  async function checkRelease() {
    installer = null;
    try {
      const response = await fetchRequest(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': `DotDock/${app.getVersion()}` },
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) throw new Error('release unavailable');
      const release = await response.json();
      if (release.draft || release.prerelease || !parseVersion(release.tag_name)) throw new Error('invalid release');
      const available = isNewerVersion(release.tag_name, app.getVersion());
      installer = available ? selectInstaller(release, platform, arch) : null;
      info = { ...info, latestVersion: release.tag_name.replace(/^v/, ''), available,
        downloadAvailable: Boolean(installer), error: false,
        message: available
          ? installer ? '새 버전을 다운로드할 수 있습니다.' : '이 컴퓨터용 설치 파일이 아직 준비되지 않았습니다.'
          : '현재 최신 버전을 사용하고 있습니다.' };
    } catch {
      info = { ...info, available: false, downloadAvailable: false, error: true,
        message: '업데이트를 확인하지 못했습니다. 인터넷 연결을 확인하고 잠시 후 다시 시도해 주세요.' };
    }
    return { ...info };
  }

  function check() {
    if (!checking) checking = checkRelease().finally(() => { checking = null; });
    return checking;
  }

  async function downloadAndOpen() {
    if (!installer) await check();
    const selected = installer;
    if (!selected) return { ok: false, message: info.message };
    let directory;
    try {
      directory = await fs.mkdtemp(path.join(app.getPath('temp'), 'dotdock-update-'));
      const partial = path.join(directory, `${selected.name}.part`);
      const destination = path.join(directory, selected.name);
      const response = await fetchRequest(selected.browser_download_url, { signal: AbortSignal.timeout(300000) });
      if (!response.ok || !response.body) throw new Error('download unavailable');
      const hash = crypto.createHash('sha256');
      let size = 0;
      const file = await fs.open(partial, 'wx', 0o600);
      try {
        for await (const chunk of response.body) {
          size += chunk.byteLength;
          if (size > selected.size || size > MAX_INSTALLER_BYTES) throw new Error('invalid size');
          hash.update(chunk);
          await file.writeFile(chunk);
        }
      } finally {
        await file.close();
      }
      if (size !== selected.size || `sha256:${hash.digest('hex')}` !== selected.digest) throw new Error('integrity check failed');
      await fs.rename(partial, destination);
      const openError = await shell.openPath(destination);
      if (openError) throw new Error('installer did not open');
      return { ok: true, message: platform === 'darwin'
        ? '설치 파일을 열었습니다. DotDock을 종료한 뒤 새 앱을 응용 프로그램 폴더에 덮어쓰고 다시 실행해 주세요. 설정은 유지됩니다.'
        : '설치 프로그램을 열었습니다. DotDock을 종료한 뒤 설치 안내를 따라 주세요. 설정은 유지됩니다.' };
    } catch {
      if (directory) await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
      return { ok: false, message: '설치 파일을 다운로드하거나 검증하지 못했습니다. 잠시 후 다시 시도해 주세요.' };
    }
  }

  function install() {
    if (!installing) installing = downloadAndOpen().finally(() => { installing = null; });
    return installing;
  }

  async function promptAtStartup() {
    if (prompted) return;
    prompted = true;
    const latest = await check();
    if (!latest.available || !latest.downloadAvailable) return;
    const { response } = await dialog.showMessageBox({
      type: 'info', title: 'DotDock 업데이트',
      message: `DotDock ${latest.latestVersion} 새 버전이 있습니다.`,
      detail: `현재 버전: ${latest.currentVersion}\n지금 설치 파일을 다운로드하고 열까요?`,
      buttons: ['다운로드 및 설치', '나중에'], defaultId: 0, cancelId: 1
    });
    if (response === 0) {
      const result = await install();
      await dialog.showMessageBox({ type: result.ok ? 'info' : 'error', title: 'DotDock 업데이트',
        message: result.message, buttons: ['확인'] });
    }
  }

  return { getInfo: () => ({ ...info }), check, install, promptAtStartup };
}

module.exports = { isNewerVersion, selectInstaller, createUpdater };
