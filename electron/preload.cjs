const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dotdock', {
  getUpdateInfo: () => ipcRenderer.invoke('dotdock:get-update-info'),
  checkForUpdates: () => ipcRenderer.invoke('dotdock:check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('dotdock:install-update'),
  getState: () => ipcRenderer.invoke('dotdock:get-state'),
  saveState: (patch) => ipcRenderer.invoke('dotdock:save-state', patch),
  syncLocalQuota: (options) => ipcRenderer.invoke('dotdock:sync-local-quota', options),
  startOAuthLogin: (provider) => ipcRenderer.invoke('dotdock:oauth-login', provider),
  detectLocalAuth: (provider) => ipcRenderer.invoke('dotdock:detect-local-auth', provider),
  syncProviderQuota: (provider) => ipcRenderer.invoke('dotdock:sync-provider-quota', provider),
  saveProviderToken: (provider, token) =>
    ipcRenderer.invoke('dotdock:save-provider-token', { provider, token }),
  disconnectProvider: (provider) => ipcRenderer.invoke('dotdock:disconnect-provider', provider),
  setExpanded: (expanded) => ipcRenderer.invoke('dotdock:set-expanded', expanded),
  moveBy: (dx, dy) => ipcRenderer.send('dotdock:move-by', { dx, dy }),
  commitWindowPosition: () => ipcRenderer.invoke('dotdock:commit-position'),
  minimizeToTray: () => ipcRenderer.send('dotdock:minimize-to-tray'),
  resetPosition: () => ipcRenderer.invoke('dotdock:reset-position'),
  setAlwaysOnTop: (alwaysOnTop) => ipcRenderer.invoke('dotdock:set-always-on-top', alwaysOnTop),
  getSystemStats: () => ipcRenderer.invoke('dotdock:get-system-stats'),
  onCommand: (callback) => {
    const listener = (_event, command) => callback(command);
    ipcRenderer.on('dotdock:command', listener);
    return () => ipcRenderer.removeListener('dotdock:command', listener);
  }
});
