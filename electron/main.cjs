const { app, BrowserWindow, ipcMain, Menu, Tray, screen, nativeImage, shell, dialog, Notification, powerMonitor } = require('electron');
const { execFile } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const oauth = require('./oauth.cjs');
const { createUpdater } = require('./updates.cjs');
const { getCollapsedSize } = require('./dock-layout.cjs');
const { loadBirthIdentity, applyBirthIdentity } = require('./birth-identity.cjs');
const { registerCharacterModelIpc } = require('./character-models.cjs');
const schedules = require('./schedules.cjs');
const { createScheduleRuntime } = require('./schedule-runtime.cjs');
const { createAlarmEffects } = require('./alarm-effects.cjs');

const EXPANDED_SIZE = { width: 390, height: 600 };
const VALID_SYNC_MINUTES = [5, 10, 15, 20];
const SMOKE_TEST = process.env.DOTDOCK_SMOKE_TEST === '1';
if (process.platform === 'win32') app.setAppUserModelId('com.dotdock.app');
if (SMOKE_TEST) {
  if (!process.env.DOTDOCK_TEST_USER_DATA || !process.env.DOTDOCK_TEST_QUOTA_FILE) {
    throw new Error('Smoke tests require isolated user data and quota paths.');
  }
  app.setPath('userData', process.env.DOTDOCK_TEST_USER_DATA);
}
const updater = createUpdater({ app, shell, dialog });

function normalizeAutoSyncMinutes(val) {
  const num = Number(val);
  return VALID_SYNC_MINUTES.includes(num) ? num : 10;
}

const DEFAULT_QUOTA = {
  lastUpdatedAt: new Date().toISOString(),
  source: 'manual',
  codex: {
    fiveHour: {
      used: 0,
      limit: 100,
      unit: '%',
      resetLabel: '동기화 대기 중',
      label: '5시간 (5h)',
      hidden: true
    },
    weekly: {
      used: 0,
      limit: 100,
      unit: '%',
      resetLabel: '동기화 대기 중',
      label: '주간 한도 (7d)',
      hidden: false
    }
  },
  claude: {
    fiveHour: {
      used: 0,
      limit: 100,
      unit: '%',
      resetLabel: '동기화 대기 중',
      label: '5시간 (5h)',
      hidden: false
    },
    weekly: {
      used: 0,
      limit: 100,
      unit: '%',
      resetLabel: '동기화 대기 중',
      label: '일주일 (7d)',
      hidden: false
    },
    fable: {
      used: 0,
      limit: 100,
      unit: '%',
      resetLabel: '모델별 한도 없음',
      label: '모델별 한도',
      hidden: true
    }
  },
  gemini: {
    fiveHour: {
      used: 0,
      limit: 100,
      unit: '%',
      resetLabel: '동기화 대기 중',
      label: 'Gemini 모델',
      hidden: false
    },
    weekly: {
      used: 0,
      limit: 100,
      unit: '%',
      resetLabel: '동기화 대기 중',
      label: 'Claude · GPT 모델',
      hidden: false
    }
  }
};

function createDefaultAuth() {
  return {
    codex: { connected: false, method: 'none', statusMessage: 'ChatGPT / Codex 미연결' },
    claude: { connected: false, method: 'none', statusMessage: 'Claude 미연결' },
    gemini: { connected: false, method: 'none', statusMessage: 'Antigravity / Gemini 미연결' }
  };
}

function createDefaultState() {
  return {
    onboardingCompleted: false,
    enabledProviders: ['codex', 'claude', 'gemini'],
    dockMetricId: 'codex:weekly',
    dockMetricIds: ['codex:weekly'],
    showSystemWidget: true,
    birthYear: null,
    birthDate: null,
    selectedZodiacId: 'dragon',
    characterStyle: 'vector',
    customModelId: null,
    customImageDataUrl: null,
    scale: 1,
    alwaysOnTop: true,
    launchAtLogin: true,
    checkUpdatesOnStartup: true,
    autoSyncMinutes: 10,
    activeWidgetId: 'ai-quota',
    memo: '• DotDock에 오신 걸 환영해요!\n• 캐릭터를 드래그해 원하는 위치로 옮길 수 있어요.\n• 클릭하면 AI 사용량과 확장 위젯을 볼 수 있어요.',
    ...schedules.loadScheduleState({}),
    windowPosition: null,
    auth: createDefaultAuth(),
    quota: JSON.parse(JSON.stringify(DEFAULT_QUOTA))
  };
}

let mainWindow = null;
let tray = null;
let isExpanded = false;
let isQuitting = false;
let preExpandPos = null;
let appState = null;
let autoSyncTimer = null;
let scheduleRuntime = null;
let alarmEffects = null;
let alarmVisible = false;
let alarmPosition = null;

function getStateFilePath() {
  return path.join(app.getPath('userData'), 'dotdock-state.json');
}

function getLocalQuotaFilePath() {
  if (SMOKE_TEST) return process.env.DOTDOCK_TEST_QUOTA_FILE;
  return path.join(os.homedir(), '.dotdock', 'quota.json');
}

function mergeDeepQuota(base, incoming) {
  if (!incoming || typeof incoming !== 'object') return base;
  const next = JSON.parse(JSON.stringify(base));
  const providers = ['codex', 'claude', 'gemini'];
  for (const provider of providers) {
    if (incoming[provider] && typeof incoming[provider] === 'object') {
      for (const [bucketKey, bucketVal] of Object.entries(incoming[provider])) {
        if (next[provider][bucketKey] && bucketVal && typeof bucketVal === 'object') {
          next[provider][bucketKey] = {
            ...next[provider][bucketKey],
            ...bucketVal
          };
        }
      }
    }
  }
  next.lastUpdatedAt = incoming.lastUpdatedAt || new Date().toISOString();
  next.source = 'local-file';
  return next;
}

function loadStateFromDisk() {
  const defaults = createDefaultState();
  const statePath = getStateFilePath();
  let loaded = defaults;
  try {
    if (fs.existsSync(statePath)) {
      const raw = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      loaded = {
        ...defaults,
        ...raw,
        ...schedules.loadScheduleState(raw),
        ...loadBirthIdentity(raw),
        characterStyle: ['vector', '3d'].includes(raw.characterStyle) ? raw.characterStyle : 'pixel',
        customModelId: typeof raw.customModelId === 'string' ? raw.customModelId : null,
        onboardingCompleted:
          typeof raw.onboardingCompleted === 'boolean' ? raw.onboardingCompleted : false,
        enabledProviders: Array.isArray(raw.enabledProviders)
          ? raw.enabledProviders
          : defaults.enabledProviders,
        dockMetricId:
          typeof raw.dockMetricId === 'string' ? raw.dockMetricId : defaults.dockMetricId,
        dockMetricIds: Array.isArray(raw.dockMetricIds)
          ? raw.dockMetricIds.filter((id) => typeof id === 'string' && /^(codex|claude|gemini):(fiveHour|weekly|fable)$/.test(id))
          : [raw.dockMetricId || defaults.dockMetricId],
        showSystemWidget:
          typeof raw.showSystemWidget === 'boolean' ? raw.showSystemWidget : true,
        launchAtLogin:
          typeof raw.launchAtLogin === 'boolean' ? raw.launchAtLogin : true,
        checkUpdatesOnStartup: raw.checkUpdatesOnStartup !== false,
        autoSyncMinutes: normalizeAutoSyncMinutes(raw.autoSyncMinutes),
        auth: {
          ...defaults.auth,
          ...(raw.auth || {}),
          codex: { ...defaults.auth.codex, ...((raw.auth && raw.auth.codex) || {}) },
          claude: { ...defaults.auth.claude, ...((raw.auth && raw.auth.claude) || {}) },
          gemini: { ...defaults.auth.gemini, ...((raw.auth && raw.auth.gemini) || {}) }
        },
        quota: {
          ...defaults.quota,
          ...(raw.quota || {}),
          codex: { ...defaults.quota.codex, ...((raw.quota && raw.quota.codex) || {}) },
          claude: { ...defaults.quota.claude, ...((raw.quota && raw.quota.claude) || {}) },
          gemini: { ...defaults.quota.gemini, ...((raw.quota && raw.quota.gemini) || {}) }
        }
      };
    }
  } catch (err) {
    console.error('[DotDock] Failed to load state:', err);
  }

  // Auto-apply ~/.dotdock/quota.json if present
  const localQuotaPath = getLocalQuotaFilePath();
  try {
    if (fs.existsSync(localQuotaPath)) {
      const external = JSON.parse(fs.readFileSync(localQuotaPath, 'utf8'));
      loaded.quota = mergeDeepQuota(loaded.quota, external);
    }
  } catch (err) {
    console.warn('[DotDock] Failed to read ~/.dotdock/quota.json:', err.message);
  }

  appState = loaded;
  return appState;
}

function saveStateToDisk() {
  if (!appState) return;
  try {
    persistStateFile(appState);
  } catch (err) {
    console.error('[DotDock] Failed to save state:', err);
  }
}

function persistStateFile(next) {
  const statePath = getStateFilePath();
  const temporary = `${statePath}.schedule-tmp`;
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, statePath);
  } catch {
    try { fs.unlinkSync(temporary); } catch { /* No temporary file to remove. */ }
    throw new Error('일정을 저장하지 못했습니다. 저장 공간과 폴더 권한을 확인해 주세요.');
  }
}

function commitScheduleState(next) {
  persistStateFile(next);
  appState = next;
  alarmEffects?.reconcile(next.scheduleAlerts, next.alarmPreferences);
  sendCommand('state-updated', appState);
}

function setAlarmVisible(visible) {
  if (!mainWindow || mainWindow.isDestroyed() || alarmVisible === visible) return;
  const current = mainWindow.getBounds();
  alarmVisible = visible;
  if (isExpanded) {
    if (visible) alarmPosition = appState.windowPosition ? { ...appState.windowPosition } : null;
    if (!visible && alarmPosition && preExpandPos) {
      preExpandPos = { ...preExpandPos, restorePosition: alarmPosition };
      alarmPosition = null;
    }
    return;
  }
  const collapsed = getCollapsedSize(appState);
  if (visible) alarmPosition = { x: current.x, y: current.y };
  const size = visible ? { width: 300, height: collapsed.height + 190 } : collapsed;
  const position = !visible && alarmPosition ? alarmPosition : {
    x: current.x + current.width - size.width, y: current.y + current.height - size.height
  };
  const clamped = clampPositionToDisplay(position.x, position.y, size.width, size.height);
  mainWindow.setBounds({ ...clamped, ...size });
  if (!visible) alarmPosition = null;
}

function openSchedules() {
  showAndFocusWindow();
  applyExpandedState(true);
  sendCommand('open-schedules');
}

function startScheduleRuntime() {
  const onError = (error) => sendCommand('alarm-status', typeof error === 'string' ? error : error.message);
  alarmEffects = createAlarmEffects({ BrowserWindow, Notification, screen, shell,
    getWindow: () => mainWindow, onOpen: openSchedules, onError, suppressNative: SMOKE_TEST });
  scheduleRuntime = createScheduleRuntime({ getState: () => appState, commit: commitScheduleState, onError,
    deliver: (alert) => {
      alarmEffects.show(alert, appState.alarmPreferences);
      if (appState.alarmPreferences.character && !mainWindow.isVisible()) mainWindow.showInactive();
    } });
  scheduleRuntime.check();
  powerMonitor.on('resume', () => scheduleRuntime.check());
  powerMonitor.on('unlock-screen', () => scheduleRuntime.check());
}

function getDefaultCollapsedPosition() {
  const { workArea } = screen.getPrimaryDisplay();
  const collapsedSize = getCollapsedSize(appState);
  return {
    x: workArea.x + workArea.width - collapsedSize.width - 24,
    y: workArea.y + workArea.height - collapsedSize.height - 24
  };
}

function clampPositionToDisplay(x, y, width, height) {
  const display = screen.getDisplayMatching({ x, y, width, height }) || screen.getPrimaryDisplay();
  const wa = display.workArea;
  const clampedX = Math.max(wa.x, Math.min(Math.round(x), wa.x + wa.width - width));
  const clampedY = Math.max(wa.y, Math.min(Math.round(y), wa.y + wa.height - height));
  return { x: clampedX, y: clampedY };
}

function sendCommand(type, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('dotdock:command', { type, payload });
  }
}

function showAndFocusWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (process.platform === 'darwin' && app.dock) {
    app.dock.show();
  }
  mainWindow.show();
  mainWindow.focus();
  updateTrayMenu();
}

function minimizeWindowToTray() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (isExpanded) {
    applyExpandedState(false);
  }
  mainWindow.hide();
  updateTrayMenu();
}

function resetWindowPosition() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (isExpanded) {
    applyExpandedState(false);
  }
  const pos = getDefaultCollapsedPosition();
  const collapsed = getCollapsedSize(appState);
  const size = alarmVisible ? { width: 300, height: collapsed.height + 190 } : collapsed;
  const position = clampPositionToDisplay(pos.x + collapsed.width - size.width,
    pos.y + collapsed.height - size.height, size.width, size.height);
  mainWindow.setBounds({
    ...position,
    ...size
  });
  alarmPosition = alarmVisible ? pos : null;
  appState.windowPosition = pos;
  saveStateToDisk();
  showAndFocusWindow();
}

function applyExpandedState(expanded) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { x: 0, y: 0, ...getCollapsedSize(appState) };
  }
  const current = mainWindow.getBounds();
  const collapsed = getCollapsedSize(appState);
  const targetSize = expanded ? EXPANDED_SIZE : alarmVisible ? { width: 300, height: collapsed.height + 190 } : collapsed;
  if (expanded === isExpanded && current.width === targetSize.width && current.height === targetSize.height) {
    return current;
  }

  let nextX;
  let nextY;

  if (expanded) {
    preExpandPos = { ...current, ...(alarmPosition ? { restorePosition: alarmPosition } : {}) };
    const right = current.x + current.width;
    const bottom = current.y + current.height;
    nextX = right - targetSize.width;
    nextY = bottom - targetSize.height;
  } else {
    const right = current.x + current.width;
    const bottom = current.y + current.height;
    nextX = right - targetSize.width;
    nextY = bottom - targetSize.height;
    if (preExpandPos) {
      // Restore exact pre-expand position if the user didn't drag while expanded
      const movedWhileExpanded =
        Math.abs((current.x + current.width) - (preExpandPos.x + preExpandPos.width)) > 2 ||
        Math.abs((current.y + current.height) - (preExpandPos.y + preExpandPos.height)) > 2;
      if (!movedWhileExpanded) {
        const restore = !alarmVisible && preExpandPos.restorePosition ? preExpandPos.restorePosition : {
          x: preExpandPos.x + preExpandPos.width - targetSize.width,
          y: preExpandPos.y + preExpandPos.height - targetSize.height
        };
        nextX = restore.x;
        nextY = restore.y;
      }
      preExpandPos = null;
    }
  }

  const clamped = clampPositionToDisplay(nextX, nextY, targetSize.width, targetSize.height);
  isExpanded = expanded;
  mainWindow.setBounds({
    x: clamped.x,
    y: clamped.y,
    width: targetSize.width,
    height: targetSize.height
  });

  if (!expanded && !alarmVisible) {
    appState.windowPosition = clamped;
    saveStateToDisk();
  }

  updateTrayMenu();
  return { x: clamped.x, y: clamped.y, width: targetSize.width, height: targetSize.height };
}

function createWindow() {
  const collapsedSize = getCollapsedSize(appState);
  const initialPos = appState.windowPosition
    ? clampPositionToDisplay(
        appState.windowPosition.x,
        appState.windowPosition.y,
        collapsedSize.width,
        collapsedSize.height
      )
    : getDefaultCollapsedPosition();

  appState.windowPosition = initialPos;

  const startExpanded = !appState.onboardingCompleted;
  const startSize = startExpanded ? EXPANDED_SIZE : collapsedSize;
  const startPos = startExpanded
    ? clampPositionToDisplay(
        initialPos.x + collapsedSize.width - EXPANDED_SIZE.width,
        initialPos.y + collapsedSize.height - EXPANDED_SIZE.height,
        EXPANDED_SIZE.width,
        EXPANDED_SIZE.height
      )
    : initialPos;

  if (startExpanded) {
    isExpanded = true;
    preExpandPos = { ...initialPos, ...collapsedSize };
  }

  mainWindow = new BrowserWindow({
    width: startSize.width,
    height: startSize.height,
    x: startPos.x,
    y: startPos.y,
    icon: path.join(__dirname, 'app-icon.png'),
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: Boolean(appState.alwaysOnTop),
    skipTaskbar: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (appState.alwaysOnTop) {
    mainWindow.setAlwaysOnTop(true, 'floating');
  }

  const indexHtml = path.join(__dirname, '..', 'dist', 'index.html');
  mainWindow.loadFile(indexHtml);
  mainWindow.webContents.once('did-finish-load', () => {
    sendCommand('state-updated', appState);
  });
  for (const event of ['hide', 'minimize']) {
    mainWindow.on(event, () => sendCommand('window-visibility', false));
  }
  for (const event of ['show', 'restore']) {
    mainWindow.on(event, () => sendCommand('window-visibility', true));
  }

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      minimizeWindowToTray();
    }
  });
}

function applyLoginItemSetting(openAtLogin) {
  const enabled = Boolean(openAtLogin);
  if (SMOKE_TEST) return enabled;
  if (typeof app.setLoginItemSettings !== 'function') return enabled;
  try {
    const isBundledMacApp = process.platform === 'darwin' && __dirname.includes('.app/Contents/');
    if (app.isPackaged || isBundledMacApp || process.platform === 'win32') {
      app.setLoginItemSettings({
        openAtLogin: enabled,
        openAsHidden: false
      });
    }
  } catch (err) {
    console.warn('[DotDock] Failed to set login item settings:', err.message);
  }
  return enabled;
}

function restartAutoSyncTimer() {
  if (autoSyncTimer) {
    clearInterval(autoSyncTimer);
    autoSyncTimer = null;
  }
  if (SMOKE_TEST) return;
  const mins = normalizeAutoSyncMinutes(appState?.autoSyncMinutes);
  const intervalMs = mins * 60 * 1000;
  autoSyncTimer = setInterval(() => {
    if (!appState || isQuitting) return;
    void oauth.syncProviderQuota(undefined, appState, getOAuthHooks());
  }, intervalMs);
  if (typeof autoSyncTimer.unref === 'function') {
    autoSyncTimer.unref();
  }
}

function updateTrayMenu() {
  if (!tray) return;
  const visible = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible();
  const syncMinutes = normalizeAutoSyncMinutes(appState?.autoSyncMinutes);
  const menu = Menu.buildFromTemplate([
    {
      label: visible ? '캐릭터 숨기기 (메뉴바로 최소화)' : '캐릭터 보이기 (DotDock 열기)',
      click: () => {
        if (visible) {
          minimizeWindowToTray();
        } else {
          showAndFocusWindow();
        }
      }
    },
    {
      label: isExpanded ? 'AI 사용량 HUD 닫기' : 'AI 사용량 HUD 열기',
      click: () => {
        showAndFocusWindow();
        sendCommand('toggle-hud');
      }
    },
    { type: 'separator' },
    {
      label: '계정 연결...',
      click: () => {
        showAndFocusWindow();
        sendCommand('open-oauth');
      }
    },
    {
      label: '생년 / 띠 캐릭터 설정...',
      click: () => {
        showAndFocusWindow();
        sendCommand('open-settings');
      }
    },
    {
      label: '컴퓨터 켜면 자동 실행',
      type: 'checkbox',
      checked: Boolean(appState?.launchAtLogin),
      click: (menuItem) => {
        appState.launchAtLogin = Boolean(menuItem.checked);
        applyLoginItemSetting(appState.launchAtLogin);
        saveStateToDisk();
        sendCommand('state-updated', appState);
        updateTrayMenu();
      }
    },
    {
      label: `자동 동기화 주기 (${syncMinutes}분)`,
      submenu: VALID_SYNC_MINUTES.map((mins) => ({
        label: mins === 10 ? '10분 (기본)' : `${mins}분`,
        type: 'radio',
        checked: syncMinutes === mins,
        click: () => {
          appState.autoSyncMinutes = mins;
          restartAutoSyncTimer();
          saveStateToDisk();
          sendCommand('state-updated', appState);
          updateTrayMenu();
        }
      }))
    },
    {
      label: '위치 초기화 (우측 하단)',
      click: () => {
        resetWindowPosition();
      }
    },
    { type: 'separator' },
    {
      label: 'DotDock 종료',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  const isMac = process.platform === 'darwin';
  const primaryPath = path.join(__dirname, isMac ? 'tray-iconTemplate.png' : 'app-icon.png');
  const fallbackPath = path.join(__dirname, 'tray-icon.png');
  const chosenPath = fs.existsSync(primaryPath) ? primaryPath : fallbackPath;
  let icon = nativeImage.createFromPath(chosenPath);
  if (isMac) {
    icon.setTemplateImage(true);
  } else if (!icon.isEmpty()) {
    icon = icon.resize({ width: 16, height: 16 });
  }
  console.log('[DotDock] Tray icon size:', icon.getSize(), 'isEmpty:', icon.isEmpty());

  tray = new Tray(icon);
  if (isMac) {
    tray.setTitle('DotDock');
  }
  tray.setToolTip('DotDock — 12지신 AI 데스크탑 메이트');

  tray.on('click', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!mainWindow.isVisible()) {
      showAndFocusWindow();
    } else {
      tray.popUpContextMenu();
    }
  });

  updateTrayMenu();
}

function getOAuthHooks() {
  return {
    getState: () => appState,
    saveState: () => saveStateToDisk(),
    notifyStateUpdated: () => sendCommand('state-updated', appState),
    mergeLocalQuotaFile: () => {
      const localPath = getLocalQuotaFilePath();
      try {
        if (fs.existsSync(localPath)) {
          const external = JSON.parse(fs.readFileSync(localPath, 'utf8'));
          appState.quota = mergeDeepQuota(appState.quota, external);
        }
      } catch (err) {
        console.warn('[DotDock] Failed to merge ~/.dotdock/quota.json:', err.message);
      }
    }
  };
}

function registerIpc() {
  registerCharacterModelIpc({ ipcMain, dialog, getWindow: () => mainWindow,
    getUserData: () => app.getPath('userData'),
    getBundledModelsDirectory: () => path.join(app.getAppPath(), 'dist', 'models') });
  ipcMain.handle('dotdock:get-update-info', () => updater.getInfo());
  ipcMain.handle('dotdock:check-for-updates', () => updater.check());
  ipcMain.handle('dotdock:install-update', () => updater.install());
  ipcMain.handle('dotdock:get-state', () => {
    return appState;
  });

  ipcMain.handle('dotdock:save-state', (_event, patch) => {
    if (!patch || typeof patch !== 'object') return appState;
    if (patch.schedules !== undefined || patch.scheduleAlerts !== undefined) {
      throw new Error('일정은 일정 전용 기능으로 변경해 주세요.');
    }
    const alarmPreferences = patch.alarmPreferences === undefined ? appState.alarmPreferences
      : schedules.validatePreferences(patch.alarmPreferences);
    const birthIdentity = applyBirthIdentity(appState, patch);
    const next = {
      ...appState,
      ...patch,
      ...birthIdentity,
      alarmPreferences,
      ...(patch.launchAtLogin !== undefined
        ? { launchAtLogin: Boolean(patch.launchAtLogin) }
        : {}),
      ...(patch.autoSyncMinutes !== undefined
        ? { autoSyncMinutes: normalizeAutoSyncMinutes(patch.autoSyncMinutes) }
        : {}),
      auth: patch.auth
        ? {
            ...appState.auth,
            ...patch.auth,
            codex: { ...appState.auth.codex, ...(patch.auth.codex || {}) },
            claude: { ...appState.auth.claude, ...(patch.auth.claude || {}) },
            gemini: { ...appState.auth.gemini, ...(patch.auth.gemini || {}) }
          }
        : appState.auth,
      quota: patch.quota
        ? {
            ...appState.quota,
            ...patch.quota,
            codex: { ...appState.quota.codex, ...(patch.quota.codex || {}) },
            claude: { ...appState.quota.claude, ...(patch.quota.claude || {}) },
            gemini: { ...appState.quota.gemini, ...(patch.quota.gemini || {}) }
          }
        : appState.quota
    };
    if (patch.alarmPreferences !== undefined) {
      commitScheduleState({ ...next, scheduleAlerts: Object.values(alarmPreferences).some(Boolean) ? next.scheduleAlerts : [] });
    } else {
      persistStateFile(next);
      appState = next;
    }
    if (patch.launchAtLogin !== undefined) {
      applyLoginItemSetting(appState.launchAtLogin);
    }
    if (patch.autoSyncMinutes !== undefined) {
      restartAutoSyncTimer();
    }
    updateTrayMenu();
    if (patch.dockMetricIds !== undefined || patch.scale !== undefined || patch.enabledProviders !== undefined) {
      applyExpandedState(isExpanded);
    }
    return appState;
  });

  const assertScheduleSender = (event) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('허용되지 않은 일정 요청입니다.');
  };
  const changeSchedule = (event, change) => {
    assertScheduleSender(event);
    commitScheduleState(change());
    scheduleRuntime.check();
    return appState;
  };
  ipcMain.handle('dotdock:save-schedule', (event, input) =>
    changeSchedule(event, () => schedules.saveSchedule(appState, input)));
  ipcMain.handle('dotdock:delete-schedule', (event, id) =>
    changeSchedule(event, () => schedules.deleteSchedule(appState, id)));
  ipcMain.handle('dotdock:schedule-action', (event, payload) =>
    changeSchedule(event, () => schedules.actOnSchedule(appState, payload?.id, payload?.action)));
  ipcMain.handle('dotdock:set-alarm-visible', (event, visible) => {
    assertScheduleSender(event);
    if (typeof visible !== 'boolean') throw new Error('올바른 알림 표시 값이 아닙니다.');
    setAlarmVisible(visible);
  });
  ipcMain.handle('dotdock:preview-alarm', (event) => {
    assertScheduleSender(event);
    if (!Object.values(appState.alarmPreferences).some(Boolean)) throw new Error('알림 효과를 하나 이상 선택해 주세요.');
    const alert = { id: `preview:${Date.now()}`, scheduleId: 'preview', title: '일정 알림 미리보기',
      startsAt: new Date().toISOString(), deliveredAt: new Date().toISOString(), phase: 'start' };
    alarmEffects.show(alert, appState.alarmPreferences);
    if (appState.alarmPreferences.character) {
      sendCommand('alarm-preview', alert);
      if (!mainWindow.isVisible()) mainWindow.showInactive();
    }
  });

  ipcMain.handle('dotdock:oauth-login', async (_event, provider) => {
    const result = await oauth.openOAuthLoginWindow(provider, appState, getOAuthHooks());
    return { ...result, state: appState };
  });

  ipcMain.handle('dotdock:detect-local-auth', async (_event, provider) => {
    const result = await oauth.detectLocalAuth(provider, appState, getOAuthHooks());
    return { ...result, state: appState };
  });

  ipcMain.handle('dotdock:sync-provider-quota', async (_event, provider) => {
    const result = await oauth.syncProviderQuota(provider, appState, getOAuthHooks());
    return { ...result, state: appState };
  });

  ipcMain.handle('dotdock:save-provider-token', async (_event, payload) => {
    const result = await oauth.saveProviderToken(payload?.provider, payload?.token, appState, getOAuthHooks());
    return { ...result, state: appState };
  });

  ipcMain.handle('dotdock:disconnect-provider', async (_event, provider) => {
    const result = await oauth.disconnectProvider(provider, appState, getOAuthHooks());
    return { ...result, state: appState };
  });

  ipcMain.handle('dotdock:sync-local-quota', (_event, options = {}) => {
    const localPath = getLocalQuotaFilePath();
    try {
      if (!fs.existsSync(localPath)) {
        if (options.createSampleIfMissing) {
          fs.mkdirSync(path.dirname(localPath), { recursive: true });
          const sample = {
            lastUpdatedAt: new Date().toISOString(),
            codex: appState.quota.codex,
            claude: appState.quota.claude,
            gemini: appState.quota.gemini
          };
          fs.writeFileSync(localPath, JSON.stringify(sample, null, 2), 'utf8');
        } else {
          return { found: false, path: localPath, state: appState };
        }
      }
      const external = JSON.parse(fs.readFileSync(localPath, 'utf8'));
      appState.quota = mergeDeepQuota(appState.quota, external);
      saveStateToDisk();
      return { found: true, path: localPath, state: appState };
    } catch (err) {
      return { found: false, path: localPath, state: appState, error: err.message };
    }
  });

  ipcMain.handle('dotdock:set-expanded', (_event, expanded) => {
    return applyExpandedState(Boolean(expanded));
  });

  ipcMain.on('dotdock:move-by', (_event, { dx, dy }) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const bounds = mainWindow.getBounds();
    const clamped = clampPositionToDisplay(bounds.x + dx, bounds.y + dy, bounds.width, bounds.height);
    mainWindow.setBounds({
      x: clamped.x,
      y: clamped.y,
      width: bounds.width,
      height: bounds.height
    });
  });

  ipcMain.handle('dotdock:commit-position', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return appState.windowPosition;
    const bounds = mainWindow.getBounds();
    const collapsedSize = getCollapsedSize(appState);
    const collapsedPos = isExpanded || alarmVisible
      ? {
          x: bounds.x + bounds.width - collapsedSize.width,
          y: bounds.y + bounds.height - collapsedSize.height
        }
      : { x: bounds.x, y: bounds.y };
    appState.windowPosition = collapsedPos;
    if (alarmVisible) alarmPosition = collapsedPos;
    saveStateToDisk();
    return collapsedPos;
  });

  ipcMain.on('dotdock:minimize-to-tray', () => {
    minimizeWindowToTray();
  });

  ipcMain.handle('dotdock:reset-position', () => {
    resetWindowPosition();
    return appState.windowPosition;
  });

  ipcMain.handle('dotdock:set-always-on-top', (_event, alwaysOnTop) => {
    const flag = Boolean(alwaysOnTop);
    appState.alwaysOnTop = flag;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(flag, flag ? 'floating' : 'normal');
    }
    saveStateToDisk();
    return flag;
  });

  function readCpuSampleTotals() {
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;
    for (const cpu of cpus) {
      const t = cpu.times;
      idle += t.idle;
      total += t.user + t.nice + t.sys + t.idle + t.irq;
    }
    return { idle, total };
  }

  let prevCpuTimes = readCpuSampleTotals();
  let lastCpuLoadPercent = 0;

  function sampleCpuPercent(loadAvg1m, cpuCount) {
    const { idle, total } = readCpuSampleTotals();
    if (!prevCpuTimes) {
      prevCpuTimes = { idle, total };
      if (process.platform === 'win32') return lastCpuLoadPercent;
      return Math.min(100, Math.round((loadAvg1m / cpuCount) * 100));
    }
    const dIdle = idle - prevCpuTimes.idle;
    const dTotal = total - prevCpuTimes.total;
    prevCpuTimes = { idle, total };
    if (dTotal <= 0) {
      if (lastCpuLoadPercent > 0 || process.platform === 'win32') {
        return lastCpuLoadPercent;
      }
      return Math.min(100, Math.round((loadAvg1m / cpuCount) * 100));
    }
    lastCpuLoadPercent = Math.min(100, Math.max(0, Math.round((1 - dIdle / dTotal) * 100)));
    return lastCpuLoadPercent;
  }

  function getSystemMemoryStats(totalMem) {
    const fallbackStats = () => {
      const usedMem = Math.max(0, totalMem - os.freemem());
      return {
        memUsedGb: Number((usedMem / 1024 ** 3).toFixed(1)),
        memTotalGb: Number((totalMem / 1024 ** 3).toFixed(1)),
        memPercent: totalMem > 0 ? Math.min(100, Math.max(0, Math.round((usedMem / totalMem) * 100))) : 0
      };
    };

    return new Promise((resolve) => {
      if (process.platform !== 'darwin') {
        resolve(fallbackStats());
        return;
      }
      execFile('/usr/bin/vm_stat', [], { timeout: 1500 }, (err, stdout) => {
        if (err || !stdout) {
          resolve(fallbackStats());
          return;
        }
        const pageSizeMatch = stdout.match(/page size of (\d+) bytes/i);
        const pageSize = pageSizeMatch ? Number(pageSizeMatch[1]) : 16384;
        const readPages = (label) => {
          const re = new RegExp(`${label}:\\s+(\\d+)`, 'i');
          const m = stdout.match(re);
          return m ? Number(m[1]) : 0;
        };
        const anonymous = readPages('Anonymous pages');
        const purgeable = readPages('Pages purgeable');
        const active = readPages('Pages active');
        const wired = readPages('Pages wired down');
        const compressor = readPages('Pages occupied by compressor');

        const usedPages =
          anonymous > 0
            ? Math.max(0, anonymous - purgeable) + wired + compressor
            : active + wired + compressor;

        if (usedPages <= 0) {
          resolve(fallbackStats());
          return;
        }

        const usedMem = Math.min(totalMem, usedPages * pageSize);
        resolve({
          memUsedGb: Number((usedMem / 1024 ** 3).toFixed(1)),
          memTotalGb: Number((totalMem / 1024 ** 3).toFixed(1)),
          memPercent: totalMem > 0 ? Math.min(100, Math.max(0, Math.round((usedMem / totalMem) * 100))) : 0
        });
      });
    });
  }

  function parseNvidiaSmiOutput(stdout) {
    const lines = String(stdout || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return null;
    const models = [];
    const loads = [];
    for (const line of lines) {
      const idx = line.lastIndexOf(',');
      if (idx <= 0) continue;
      const name = line.slice(0, idx).trim();
      const utilStr = line.slice(idx + 1).trim();
      if (name) models.push(name);
      const utilMatch = utilStr.match(/(\d+(?:\.\d+)?)/);
      if (utilMatch) {
        loads.push(Math.min(100, Math.max(0, Math.round(Number(utilMatch[1])))));
      }
    }
    if (models.length === 0 && loads.length === 0) return null;
    return {
      gpuLoadPercent: loads.length > 0 ? Math.max(...loads) : 0,
      gpuModel: models[0] || 'NVIDIA GPU',
      hasNumericLoad: loads.length > 0
    };
  }

  function parseWinGpuPowerShellOutput(stdout, fallbackModel = 'Windows GPU') {
    const raw = String(stdout || '').trim();
    if (!raw) {
      return { gpuLoadPercent: 0, gpuModel: fallbackModel };
    }
    const jsonStart = raw.indexOf('{');
    const jsonText = jsonStart >= 0 ? raw.slice(jsonStart) : raw;
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      return { gpuLoadPercent: 0, gpuModel: fallbackModel };
    }

    const gpuListRaw = Array.isArray(parsed?.gpus)
      ? parsed.gpus
      : parsed?.gpus
        ? [parsed.gpus]
        : [];
    const gpuNames = gpuListRaw
      .map((g) => (typeof g === 'string' ? g : g?.Name))
      .map((s) => String(s || '').trim())
      .filter(Boolean);
    const preferredGpu =
      gpuNames.find((n) => !/microsoft basic|remote|virtual|rdp/i.test(n)) ||
      gpuNames[0] ||
      fallbackModel;

    const engineRaw = Array.isArray(parsed?.engines)
      ? parsed.engines
      : parsed?.engines
        ? [parsed.engines]
        : [];

    const bucketTotals = new Map();
    for (const row of engineRaw) {
      const pct = Number(row?.UtilizationPercentage);
      if (!Number.isFinite(pct) || pct <= 0) continue;
      const name = String(row?.Name || '');
      const physMatch =
        name.match(/(luid_0x[0-9a-f]+_0x[0-9a-f]+_phys_\d+)/i) || name.match(/(phys_\d+)/i);
      const engMatch = name.match(/engtype_([^_\s]+)/i);
      const key = `${physMatch ? physMatch[1].toLowerCase() : 'gpu0'}:${engMatch ? engMatch[1].toLowerCase() : 'all'}`;
      bucketTotals.set(key, (bucketTotals.get(key) || 0) + pct);
    }

    const maxBucket = bucketTotals.size > 0 ? Math.max(...bucketTotals.values()) : 0;
    return {
      gpuLoadPercent: Math.min(100, Math.max(0, Math.round(maxBucket))),
      gpuModel: preferredGpu
    };
  }

  let cachedWinGpuModel = null;
  let inFlightWinGpuPromise = null;

  function queryWinGpuViaPowerShell() {
    return new Promise((resolve) => {
      const fallbackModel = cachedWinGpuModel || 'Windows GPU';
      const includeModel = !cachedWinGpuModel;
      const psScript = [
        '$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
        '$engines = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction SilentlyContinue | Where-Object { $_.UtilizationPercentage -gt 0 } | Select-Object Name,UtilizationPercentage)',
        includeModel
          ? '$gpus = @(Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)'
          : '$gpus = @()',
        '@{ engines = $engines; gpus = $gpus } | ConvertTo-Json -Compress -Depth 3'
      ].join('; ');

      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
        { timeout: 3000, maxBuffer: 2 * 1024 * 1024, windowsHide: true },
        (err, stdout) => {
          if (err || !stdout) {
            resolve({ gpuLoadPercent: 0, gpuModel: fallbackModel });
            return;
          }
          const result = parseWinGpuPowerShellOutput(stdout, fallbackModel);
          if (result.gpuModel && result.gpuModel !== 'Windows GPU') {
            cachedWinGpuModel = result.gpuModel;
          }
          resolve(result);
        }
      );
    });
  }

  function getGpuStatsWin() {
    if (inFlightWinGpuPromise) return inFlightWinGpuPromise;
    inFlightWinGpuPromise = new Promise((resolve) => {
      execFile(
        'nvidia-smi',
        ['--query-gpu=name,utilization.gpu', '--format=csv,noheader,nounits'],
        { timeout: 1500, maxBuffer: 1024 * 1024, windowsHide: true },
        async (err, stdout) => {
          if (!err && stdout) {
            const nvidia = parseNvidiaSmiOutput(stdout);
            if (nvidia) {
              if (nvidia.gpuModel && nvidia.gpuModel !== 'NVIDIA GPU') {
                cachedWinGpuModel = nvidia.gpuModel;
              }
              if (nvidia.hasNumericLoad) {
                resolve({ gpuLoadPercent: nvidia.gpuLoadPercent, gpuModel: nvidia.gpuModel });
                return;
              }
            }
          }
          const psStats = await queryWinGpuViaPowerShell();
          resolve(psStats);
        }
      );
    }).finally(() => {
      inFlightWinGpuPromise = null;
    });
    return inFlightWinGpuPromise;
  }

  function getGpuStatsMac() {
    return new Promise((resolve) => {
      const defaultModel = process.arch === 'arm64' ? 'Apple Silicon GPU' : 'macOS GPU';
      execFile(
        '/usr/sbin/ioreg',
        ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator'],
        { timeout: 1500, maxBuffer: 4 * 1024 * 1024 },
        (err, stdout) => {
          if (err || !stdout) {
            resolve({ gpuLoadPercent: 0, gpuModel: defaultModel });
            return;
          }
          const collectMatches = (regex) =>
            Array.from(stdout.matchAll(regex))
              .map((m) => Number(m[1]))
              .filter((n) => Number.isFinite(n));

          const devValues = collectMatches(/"Device Utilization %"\s*=\s*(\d+)/g);
          const rendValues = collectMatches(/"Renderer Utilization %"\s*=\s*(\d+)/g);
          const tilerValues = collectMatches(/"Tiler Utilization %"\s*=\s*(\d+)/g);
          const allValues = devValues.length > 0 ? devValues : [...rendValues, ...tilerValues];
          const modelMatch = stdout.match(/"model"\s*=\s*"([^"]+)"/);

          const rawPct = allValues.length > 0 ? Math.max(...allValues) : 0;
          const gpuLoadPercent = Math.min(100, Math.max(0, rawPct));
          const gpuModel = modelMatch ? modelMatch[1] : defaultModel;
          resolve({ gpuLoadPercent, gpuModel });
        }
      );
    });
  }

  function getGpuStatsPlatform() {
    if (process.platform === 'darwin') return getGpuStatsMac();
    if (process.platform === 'win32') return getGpuStatsWin();
    return Promise.resolve({ gpuLoadPercent: 0, gpuModel: 'Integrated GPU' });
  }

  ipcMain.handle('dotdock:get-system-stats', async () => {
    const totalMem = os.totalmem();
    const loadAvg1m = os.loadavg()[0] || 0;
    const cpuCount = os.cpus().length || 1;
    const cpuLoadPercent = sampleCpuPercent(loadAvg1m, cpuCount);
    const effectiveLoad1m =
      process.platform === 'win32'
        ? Number(((cpuLoadPercent / 100) * cpuCount).toFixed(2))
        : Number(loadAvg1m.toFixed(2));
    const [gpuStats, memStats] = await Promise.all([
      getGpuStatsPlatform(),
      getSystemMemoryStats(totalMem)
    ]);
    return {
      cpuLoadPercent,
      gpuLoadPercent: gpuStats.gpuLoadPercent,
      gpuModel: gpuStats.gpuModel,
      loadAvg1m: effectiveLoad1m,
      cpuCount,
      memUsedGb: memStats.memUsedGb,
      memTotalGb: memStats.memTotalGb,
      memPercent: memStats.memPercent,
      uptimeHours: Math.floor(os.uptime() / 3600),
      platform: `${os.platform()} ${os.arch()}`
    };
  });
}

function watchLocalQuotaFile() {
  const localPath = getLocalQuotaFilePath();
  fs.watchFile(localPath, { interval: 4000 }, (curr, prev) => {
    if (curr.mtimeMs > prev.mtimeMs && curr.size > 0) {
      try {
        const external = JSON.parse(fs.readFileSync(localPath, 'utf8'));
        appState.quota = mergeDeepQuota(appState.quota, external);
        saveStateToDisk();
        sendCommand('quota-updated', appState);
      } catch (err) {
        console.warn('[DotDock] Quota watch parse error:', err.message);
      }
    }
  });
}

if (app.requestSingleInstanceLock()) {
app.on('second-instance', showAndFocusWindow);
app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock) {
    const ciIconPath = path.join(__dirname, 'app-icon.png');
    if (fs.existsSync(ciIconPath)) {
      const ciIcon = nativeImage.createFromPath(ciIconPath);
      if (!ciIcon.isEmpty()) {
        app.dock.setIcon(ciIcon);
      }
    }
  }
  loadStateFromDisk();
  applyLoginItemSetting(appState.launchAtLogin);
  restartAutoSyncTimer();
  registerIpc();
  createWindow();
  createTray();
  mainWindow.webContents.once('did-finish-load', startScheduleRuntime);
  if (!SMOKE_TEST) {
    watchLocalQuotaFile();
    void oauth.detectLocalAuth(undefined, appState, getOAuthHooks());
    const isBundled = app.isPackaged || __dirname.includes('.app/Contents/');
    if (isBundled && appState.checkUpdatesOnStartup) {
      setTimeout(() => { void updater.promptAtStartup().catch(() => {}); }, 2000);
    }
  }

  app.on('activate', () => {
    showAndFocusWindow();
  });
});
} else {
  app.quit();
}

app.on('before-quit', () => {
  isQuitting = true;
  scheduleRuntime?.stop();
  alarmEffects?.close();
  if (autoSyncTimer) {
    clearInterval(autoSyncTimer);
    autoSyncTimer = null;
  }
  fs.unwatchFile(getLocalQuotaFilePath());
  saveStateToDisk();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
