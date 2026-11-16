import { useCallback, useEffect, useState } from 'react';
import type {
  AuthActionResult,
  DotDockState,
  ProviderId,
  ScheduleAction,
  ScheduleAlert,
  ScheduleInput,
  SettingsTabId,
  SyncQuotaResult,
  SystemStats
} from './types/dotdock';
import {
  commitWindowPosition,
  detectLocalAuth,
  disconnectProvider,
  fetchSystemStats,
  loadDotDockState,
  minimizeToMenuBar,
  moveWindowBy,
  resetWindowPos,
  saveDotDockState,
  saveProviderToken,
  setWindowExpanded,
  startOAuthLogin,
  subscribeMainCommands,
  syncLocalQuotaFile,
  syncProviderQuota,
  updateAlwaysOnTop,
  saveSchedule,
  deleteSchedule,
  actOnSchedule,
  previewAlarm,
  setAlarmVisible
} from './services/storage';
import { CharacterSprite } from './components/CharacterSprite';
import { HudPopover } from './components/HudPopover';
import { OnboardingModal } from './components/OnboardingModal';
import { SettingsModal } from './components/SettingsModal';
import { ScheduleAlarm } from './components/ScheduleAlarm';

export function App() {
  const [state, setState] = useState<DotDockState | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [viewMode, setViewMode] = useState<'hud' | 'settings'>('hud');
  const [alarmPreview, setAlarmPreview] = useState<ScheduleAlert | null>(null);
  const [alarmStatus, setAlarmStatus] = useState<string | null>(null);
  const [syncStatusMessage, setSyncStatusMessage] = useState<string | null>(null);
  const [authStatusMessage, setAuthStatusMessage] = useState<string | null>(null);
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);

  const showOnboarding = state !== null && !state.onboardingCompleted;
  const isWindowExpanded = showOnboarding || expanded;
  const visibleAlarm = !showOnboarding && state?.alarmPreferences.character
    ? alarmPreview || state.scheduleAlerts[0] || null : null;

  useEffect(() => {
    void setAlarmVisible(Boolean(visibleAlarm));
  }, [Boolean(visibleAlarm), isWindowExpanded]);

  useEffect(() => {
    if (!alarmPreview) return;
    const timer = window.setTimeout(() => setAlarmPreview(null), 8000);
    return () => window.clearTimeout(timer);
  }, [alarmPreview]);

  useEffect(() => {
    void loadDotDockState().then((loaded) => {
      setState(loaded);
      if (!loaded.onboardingCompleted) {
        setExpanded(true);
      }
    });
  }, []);

  useEffect(() => {
    if (!state) return;
    void setWindowExpanded(isWindowExpanded);
  }, [state, isWindowExpanded]);

  const refreshSystemStats = useCallback(async () => {
    const stats = await fetchSystemStats();
    setSystemStats(stats);
  }, []);

  useEffect(() => {
    if (!isWindowExpanded || showOnboarding || viewMode !== 'hud') return;
    void refreshSystemStats();
    const timer = window.setInterval(() => {
      void refreshSystemStats();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [isWindowExpanded, showOnboarding, viewMode, refreshSystemStats]);

  const updateState = useCallback(async (patch: Partial<DotDockState>) => {
    setState((previous) => previous ? { ...previous, ...patch } : previous);
    try {
      setState(await saveDotDockState(patch));
    } catch (error) {
      setState(await loadDotDockState());
      throw error;
    }
  }, []);

  useEffect(() => {
    return subscribeMainCommands((cmd) => {
      if (cmd.type === 'toggle-hud') {
        setViewMode('hud');
        setExpanded((prev) => !prev);
      } else if (cmd.type === 'open-settings') {
        setExpanded(true);
        setViewMode('settings');
      } else if (cmd.type === 'open-oauth') {
        setExpanded(true);
        setViewMode('hud');
        void updateState({ activeWidgetId: 'oauth-connect' });
      } else if (cmd.type === 'open-schedules') {
        setExpanded(true);
        setViewMode('hud');
        void updateState({ activeWidgetId: 'schedule-memo' });
      } else if (cmd.type === 'alarm-preview' && cmd.payload) {
        setAlarmPreview(cmd.payload as ScheduleAlert);
      } else if (cmd.type === 'alarm-status') {
        setAlarmStatus(String(cmd.payload));
      } else if (cmd.type === 'quota-updated' && cmd.payload) {
        setState(cmd.payload as DotDockState);
        setSyncStatusMessage('~/.dotdock/quota.json 변경 사항을 반영했습니다.');
      } else if (cmd.type === 'state-updated' && cmd.payload) {
        setState(cmd.payload as DotDockState);
      }
    });
  }, [updateState]);

  const handleSyncLocalQuota = useCallback(
    async (createSampleIfMissing = false): Promise<SyncQuotaResult> => {
      const result = await syncLocalQuotaFile(createSampleIfMissing);
      setState(result.state);
      if (result.error) {
        setSyncStatusMessage(`파일 읽기 오류: ${result.error}`);
      } else if (result.found) {
        setSyncStatusMessage(
          createSampleIfMissing
            ? `샘플 파일을 생성하고 연동했습니다: ${result.path}`
            : `로컬 파일에서 사용량을 불러왔습니다: ${result.path}`
        );
      } else {
        setSyncStatusMessage(`${result.path} 파일이 아직 없습니다.`);
      }
      return result;
    },
    []
  );

  const handleStartOAuthLogin = useCallback(async (provider: ProviderId): Promise<AuthActionResult> => {
    const res = await startOAuthLogin(provider);
    setState(res.state);
    setAuthStatusMessage(res.message);
    return res;
  }, []);

  const handleDetectLocalAuth = useCallback(async (provider?: ProviderId): Promise<AuthActionResult> => {
    const res = await detectLocalAuth(provider);
    setState(res.state);
    setAuthStatusMessage(res.message);
    return res;
  }, []);

  const handleSyncProviderQuota = useCallback(async (provider?: ProviderId): Promise<AuthActionResult> => {
    const res = await syncProviderQuota(provider);
    setState(res.state);
    setAuthStatusMessage(res.message);
    return res;
  }, []);

  const handleSaveProviderToken = useCallback(
    async (provider: ProviderId, token: string): Promise<AuthActionResult> => {
      const res = await saveProviderToken(provider, token);
      setState(res.state);
      setAuthStatusMessage(res.message);
      return res;
    },
    []
  );

  const handleDisconnectProvider = useCallback(async (provider: ProviderId): Promise<AuthActionResult> => {
    const res = await disconnectProvider(provider);
    setState(res.state);
    setAuthStatusMessage(res.message);
    return res;
  }, []);

  const handleToggleHud = () => {
    if (showOnboarding) return;
    if (expanded) {
      setExpanded(false);
      setViewMode('hud');
      return;
    }
    setViewMode('hud');
    setExpanded(true);
  };

  const handleOpenSettingsTab = (tab: SettingsTabId = 'character') => {
    setExpanded(true);
    setViewMode(tab === 'character' ? 'settings' : 'hud');
    if (tab !== 'character') void updateState({ activeWidgetId: tab === 'ai' ? 'oauth-connect' : 'app-settings' });
  };

  const handleCloseWindow = () => {
    setExpanded(false);
    setViewMode('hud');
  };

  const handleMinimize = () => {
    setExpanded(false);
    setViewMode('hud');
    minimizeToMenuBar();
  };

  const handleToggleAlwaysOnTop = async (flag: boolean) => {
    const next = await updateAlwaysOnTop(flag);
    setState((prev) => (prev ? { ...prev, alwaysOnTop: next } : prev));
  };

  const handleResetPosition = async () => {
    setExpanded(false);
    setViewMode('hud');
    await resetWindowPos();
  };

  const handleReopenOnboarding = () => {
    void updateState({ onboardingCompleted: false });
    setExpanded(true);
  };

  const handleSaveSchedule = async (entry: ScheduleInput) => { setState(await saveSchedule(entry)); };
  const handleDeleteSchedule = async (id: string) => { setState(await deleteSchedule(id)); };
  const handleScheduleAction = async (id: string, action: ScheduleAction) => {
    setState(await actOnSchedule(id, action));
  };

  if (!state) {
    return null;
  }

  return (
    <div className={`app-shell ${visibleAlarm ? 'has-schedule-alarm' : ''}`}>
      {showOnboarding && (
        <OnboardingModal
          state={state}
          updateState={updateState}
          startOAuthLogin={handleStartOAuthLogin}
          detectLocalAuth={handleDetectLocalAuth}
          authStatusMessage={authStatusMessage}
          onComplete={async () => {
            setViewMode('hud');
            setExpanded(true);
            await refreshSystemStats();
          }}
          onMinimize={handleMinimize}
        />
      )}

      {!showOnboarding && expanded && viewMode === 'settings' && (
        <SettingsModal
          state={state}
          updateState={updateState}
          onSwitchToHud={() => setViewMode('hud')}
          onMinimize={handleMinimize}
          onCloseWindow={handleCloseWindow}
        />
      )}

      {!showOnboarding && expanded && viewMode === 'hud' && (
        <HudPopover
          state={state}
          updateState={updateState}
          syncLocalQuota={handleSyncLocalQuota}
          syncStatusMessage={syncStatusMessage}
          startOAuthLogin={handleStartOAuthLogin}
          detectLocalAuth={handleDetectLocalAuth}
          syncProviderQuota={handleSyncProviderQuota}
          saveProviderToken={handleSaveProviderToken}
          disconnectProvider={handleDisconnectProvider}
          authStatusMessage={authStatusMessage}
          systemStats={systemStats}
          refreshSystemStats={refreshSystemStats}
          onToggleAlwaysOnTop={handleToggleAlwaysOnTop}
          onResetPosition={handleResetPosition}
          onReopenOnboarding={handleReopenOnboarding}
          saveSchedule={handleSaveSchedule}
          deleteSchedule={handleDeleteSchedule}
          actOnSchedule={handleScheduleAction}
          previewAlarm={previewAlarm}
          onOpenSettingsTab={handleOpenSettingsTab}
          onMinimize={handleMinimize}
          onCloseWindow={handleCloseWindow}
        />
      )}

      {alarmStatus && expanded && <div className="alarm-status" role="alert">
        <span>{alarmStatus}</span><button type="button" className="mini-btn" aria-label="알림 안내 닫기"
          onClick={() => setAlarmStatus(null)}>✕</button>
      </div>}
      {visibleAlarm && <ScheduleAlarm key={visibleAlarm.id} alert={visibleAlarm} characterEffect
        onAction={async (action) => {
          if (alarmPreview?.id === visibleAlarm.id) { setAlarmPreview(null); return; }
          await handleScheduleAction(visibleAlarm.scheduleId, action);
        }} />}

      <CharacterSprite
        state={state}
        expanded={isWindowExpanded}
        onToggleHud={handleToggleHud}
        onOpenSettings={() => handleOpenSettingsTab('character')}
        onMinimize={handleMinimize}
        onDragMove={moveWindowBy}
        onDragCommit={() => void commitWindowPosition()}
      />
    </div>
  );
}

export default App;
