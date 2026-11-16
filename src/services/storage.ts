import type {
  AuthActionResult,
  AppUpdateInfo,
  AlarmPreferences,
  DotDockState,
  MainCommand,
  ProviderId,
  ScheduleAction,
  ScheduleInput,
  SyncQuotaResult,
  SystemStats
} from '../types/dotdock';
import { parseBirthDate } from './age';

const FALLBACK_STORAGE_KEY = 'dotdock-web-fallback-state';

function isValidBirthYear(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1900 && value <= new Date().getFullYear();
}

export async function getUpdateInfo(): Promise<AppUpdateInfo> {
  if (window.dotdock) return window.dotdock.getUpdateInfo();
  return { currentVersion: '웹 미리보기', latestVersion: null, available: false,
    downloadAvailable: false, releaseUrl: 'https://github.com/seominpapa/DotDock/releases/latest',
    message: '데스크톱 앱에서 업데이트를 확인할 수 있습니다.' };
}

export async function checkForUpdates(): Promise<AppUpdateInfo> {
  return window.dotdock ? window.dotdock.checkForUpdates() : getUpdateInfo();
}

export async function installUpdate(): Promise<{ ok: boolean; message: string }> {
  return window.dotdock ? window.dotdock.installUpdate()
    : { ok: false, message: '데스크톱 앱에서 업데이트를 설치할 수 있습니다.' };
}

const FALLBACK_STATE: DotDockState = {
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
  memo: '• DotDock에 오신 걸 환영해요!\n• 캐릭터를 드래그해 원하는 위치로 옮길 수 있어요.',
  schedules: [],
  scheduleAlerts: [],
  alarmPreferences: { character: true, screenEdge: false, notification: true, sound: false },
  windowPosition: null,
  auth: {
    codex: { connected: false, method: 'none', statusMessage: 'ChatGPT / Codex 미연결' },
    claude: { connected: false, method: 'none', statusMessage: 'Claude 미연결' },
    gemini: { connected: false, method: 'none', statusMessage: 'Antigravity / Gemini 미연결' }
  },
  quota: {
    lastUpdatedAt: new Date().toISOString(),
    source: 'manual',
    codex: {
      fiveHour: { used: 0, limit: 100, unit: '%', resetLabel: '동기화 대기 중', label: '5시간 (5h)', hidden: true },
      weekly: { used: 0, limit: 100, unit: '%', resetLabel: '동기화 대기 중', label: '주간 한도 (7d)', hidden: false }
    },
    claude: {
      fiveHour: { used: 0, limit: 100, unit: '%', resetLabel: '동기화 대기 중', label: '5시간 (5h)', hidden: false },
      weekly: { used: 0, limit: 100, unit: '%', resetLabel: '동기화 대기 중', label: '일주일 (7d)', hidden: false },
      fable: { used: 0, limit: 100, unit: '%', resetLabel: '모델별 한도 없음', label: '모델별 한도', hidden: true }
    },
    gemini: {
      fiveHour: { used: 0, limit: 100, unit: '%', resetLabel: '동기화 대기 중', label: 'Gemini 모델', hidden: false },
      weekly: { used: 0, limit: 100, unit: '%', resetLabel: '동기화 대기 중', label: 'Claude · GPT 모델', hidden: false }
    }
  }
};

export async function loadDotDockState(): Promise<DotDockState> {
  if (window.dotdock) {
    return window.dotdock.getState();
  }
  try {
    const raw = localStorage.getItem(FALLBACK_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...FALLBACK_STATE,
        ...parsed,
        schedules: [],
        scheduleAlerts: [],
        alarmPreferences: Object.fromEntries(Object.entries(FALLBACK_STATE.alarmPreferences).map(([key, value]) =>
          [key, typeof parsed.alarmPreferences?.[key] === 'boolean' ? parsed.alarmPreferences[key] : value])) as unknown as AlarmPreferences,
        birthYear: isValidBirthYear(parsed.birthYear) ? parsed.birthYear : null,
        birthDate: parseBirthDate(parsed.birthDate)?.year === parsed.birthYear ? parsed.birthDate : null,
        characterStyle: parsed.characterStyle === '3d' ? '3d' : parsed.characterStyle === 'vector' ? 'vector' : 'pixel',
        customModelId: typeof parsed.customModelId === 'string' ? parsed.customModelId : null,
        dockMetricIds: Array.isArray(parsed.dockMetricIds)
          ? parsed.dockMetricIds
          : [parsed.dockMetricId || FALLBACK_STATE.dockMetricId],
        auth: { ...FALLBACK_STATE.auth, ...(parsed.auth || {}) }
      };
    }
  } catch {
    // ignore storage errors in preview mode
  }
  return FALLBACK_STATE;
}

export async function saveDotDockState(patch: Partial<DotDockState>): Promise<DotDockState> {
  if (window.dotdock) {
    return window.dotdock.saveState(patch);
  }
  const current = await loadDotDockState();
  if (patch.schedules !== undefined || patch.scheduleAlerts !== undefined) {
    throw new Error('일정은 일정 전용 기능으로 변경해 주세요.');
  }
  if (patch.alarmPreferences && Object.values(patch.alarmPreferences).some((value) => typeof value !== 'boolean')) {
    throw new Error('알림 효과는 켜짐 또는 꺼짐으로 선택해 주세요.');
  }
  const birth = parseBirthDate(patch.birthDate);
  if (patch.birthDate !== undefined && patch.birthDate !== null && !birth) {
    throw new Error('오늘까지의 올바른 생년월일을 입력해 주세요.');
  }
  if (patch.birthYear !== undefined && patch.birthYear !== null && !isValidBirthYear(patch.birthYear)) {
    throw new Error('1900년부터 올해까지의 생년을 입력해 주세요.');
  }
  const birthYear = birth?.year ?? (patch.birthYear === undefined ? current.birthYear : patch.birthYear);
  const requestedDate = patch.birthDate === undefined ? current.birthDate : patch.birthDate;
  const birthDate = parseBirthDate(requestedDate)?.year === birthYear ? requestedDate : null;
  const next = { ...current, ...patch, birthYear, birthDate };
  try {
    localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

function scheduleBridge() {
  if (!window.dotdock) throw new Error('일정 알림은 DotDock 데스크톱 앱에서 사용할 수 있습니다.');
  return window.dotdock;
}

export async function saveSchedule(entry: ScheduleInput): Promise<DotDockState> {
  return scheduleBridge().saveSchedule(entry);
}

export async function deleteSchedule(id: string): Promise<DotDockState> {
  return scheduleBridge().deleteSchedule(id);
}

export async function actOnSchedule(id: string, action: ScheduleAction): Promise<DotDockState> {
  return scheduleBridge().actOnSchedule(id, action);
}

export async function previewAlarm(): Promise<void> {
  return scheduleBridge().previewAlarm();
}

export async function setAlarmVisible(visible: boolean): Promise<void> {
  await window.dotdock?.setAlarmVisible(visible);
}

export async function syncLocalQuotaFile(createSampleIfMissing = false): Promise<SyncQuotaResult> {
  if (window.dotdock) {
    return window.dotdock.syncLocalQuota({ createSampleIfMissing });
  }
  return {
    found: false,
    path: '~/.dotdock/quota.json',
    state: await loadDotDockState()
  };
}

export async function startOAuthLogin(provider: ProviderId): Promise<AuthActionResult> {
  if (window.dotdock) {
    return window.dotdock.startOAuthLogin(provider);
  }
  return {
    ok: false,
    message: 'Electron 데스크탑 앱에서 실행 시 OAuth 로그인 창이 열립니다.',
    state: await loadDotDockState()
  };
}

export async function detectLocalAuth(provider?: ProviderId): Promise<AuthActionResult> {
  if (window.dotdock) {
    return window.dotdock.detectLocalAuth(provider);
  }
  return {
    ok: false,
    message: 'Electron 데스크탑 앱에서만 로컬 인증을 감지할 수 있습니다.',
    state: await loadDotDockState()
  };
}

export async function syncProviderQuota(provider?: ProviderId): Promise<AuthActionResult> {
  if (window.dotdock) {
    return window.dotdock.syncProviderQuota(provider);
  }
  return {
    ok: false,
    message: 'Electron 데스크탑 앱에서 사용량 동기화를 실행할 수 있습니다.',
    state: await loadDotDockState()
  };
}

export async function saveProviderToken(
  provider: ProviderId,
  token: string
): Promise<AuthActionResult> {
  if (window.dotdock) {
    return window.dotdock.saveProviderToken(provider, token);
  }
  return {
    ok: false,
    message: 'Electron 데스크탑 앱에서 토큰 저장을 실행할 수 있습니다.',
    state: await loadDotDockState()
  };
}

export async function disconnectProvider(provider: ProviderId): Promise<AuthActionResult> {
  if (window.dotdock) {
    return window.dotdock.disconnectProvider(provider);
  }
  return {
    ok: false,
    message: 'Electron 데스크탑 앱에서 연결 해제를 실행할 수 있습니다.',
    state: await loadDotDockState()
  };
}

export async function setWindowExpanded(expanded: boolean): Promise<void> {
  if (window.dotdock) {
    await window.dotdock.setExpanded(expanded);
  }
}

export function moveWindowBy(dx: number, dy: number): void {
  window.dotdock?.moveBy(dx, dy);
}

export async function commitWindowPosition(): Promise<void> {
  if (window.dotdock) {
    await window.dotdock.commitWindowPosition();
  }
}

export function minimizeToMenuBar(): void {
  window.dotdock?.minimizeToTray();
}

export async function resetWindowPos(): Promise<void> {
  if (window.dotdock) {
    await window.dotdock.resetPosition();
  }
}

export async function updateAlwaysOnTop(flag: boolean): Promise<boolean> {
  if (window.dotdock) {
    return window.dotdock.setAlwaysOnTop(flag);
  }
  return flag;
}

export async function fetchSystemStats(): Promise<SystemStats> {
  if (window.dotdock) {
    return window.dotdock.getSystemStats();
  }
  return {
    cpuLoadPercent: 18,
    gpuLoadPercent: 12,
    gpuModel: 'Apple Silicon GPU',
    loadAvg1m: 1.4,
    cpuCount: 8,
    memUsedGb: 9.2,
    memTotalGb: 16,
    memPercent: 58,
    uptimeHours: 14,
    platform: 'darwin arm64 (preview)'
  };
}

export function subscribeMainCommands(cb: (cmd: MainCommand) => void): () => void {
  if (window.dotdock) {
    return window.dotdock.onCommand(cb);
  }
  return () => {};
}
