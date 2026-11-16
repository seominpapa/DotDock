const path = require('node:path');

function createAlarmEffects({ BrowserWindow, Notification, screen, shell,
  getWindow, onOpen, onError, suppressNative = false }) {
  let overlay = null;
  let closeTimer = null;
  const notices = new Map();

  function closeOverlay() {
    clearTimeout(closeTimer);
    if (overlay && !overlay.isDestroyed()) overlay.destroy();
    overlay = null;
  }

  function showEdge() {
    closeOverlay();
    const bounds = screen.getDisplayMatching(getWindow().getBounds()).bounds;
    const win = new BrowserWindow({ ...bounds, frame: false, transparent: true,
      focusable: false, skipTaskbar: true, resizable: false, hasShadow: false,
      show: false, alwaysOnTop: true, fullscreenable: false,
      // Allow the overlay to cover the macOS menu-bar area.
      enableLargerThanScreen: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    overlay = win;
    win.setIgnoreMouseEvents(true);
    win.setAlwaysOnTop(true, 'floating');
    win.once('ready-to-show', () => { if (!win.isDestroyed()) win.showInactive(); });
    void win.loadFile(path.join(__dirname, 'alarm-edge.html')).catch(() => {
      if (overlay !== win) return;
      closeOverlay(); onError('화면 테두리 효과를 표시하지 못했습니다.');
    });
    closeTimer = setTimeout(closeOverlay, 3200);
    closeTimer.unref?.();
  }

  function show(alert, preferences) {
    if (preferences.screenEdge) {
      try { showEdge(); } catch { closeOverlay(); onError('화면 테두리 효과를 표시하지 못했습니다.'); }
    }
    if (preferences.sound && !suppressNative) {
      try { shell.beep(); } catch { onError('알림 소리를 재생하지 못했습니다.'); }
    }
    if (!preferences.notification || suppressNative) return;
    if (!Notification.isSupported()) {
      onError('시스템 알림을 사용할 수 없습니다. 캐릭터 효과 또는 화면 테두리 효과를 켜 주세요.');
      return;
    }
    try {
      notices.get(alert.scheduleId)?.close();
      const notice = new Notification({ title: 'DotDock 일정 알림', silent: true,
        body: `${new Date(alert.startsAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} ${alert.title}` });
      notices.set(alert.scheduleId, notice);
      notice.on('click', () => onOpen(alert.scheduleId));
      notice.on('failed', () => onError(process.platform === 'darwin'
        ? '시스템 알림을 표시하지 못했습니다. OS 알림 설정을 확인해 주세요. 비서명 macOS 앱에서는 제한될 수 있어 캐릭터·테두리 효과를 권장합니다.'
        : '시스템 알림이 차단되었습니다. OS 알림 설정과 DotDock 알림 권한을 확인해 주세요.'));
      notice.show();
    } catch {
      onError('시스템 알림을 표시하지 못했습니다. OS 알림 설정을 확인해 주세요.');
    }
  }

  function reconcile(alerts, preferences) {
    if (preferences?.screenEdge === false) closeOverlay();
    for (const [id, notice] of notices) {
      if (preferences?.notification === false || !alerts.some((alert) => alert.scheduleId === id)) {
        notice.close(); notices.delete(id);
      }
    }
  }

  return { show, reconcile, close() {
    closeOverlay();
    for (const notice of notices.values()) notice.close();
    notices.clear();
  } };
}

module.exports = { createAlarmEffects };
