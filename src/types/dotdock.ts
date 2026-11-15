export type ZodiacId =
  | 'rat'
  | 'ox'
  | 'tiger'
  | 'rabbit'
  | 'dragon'
  | 'snake'
  | 'horse'
  | 'sheep'
  | 'monkey'
  | 'rooster'
  | 'dog'
  | 'pig';

export type ProviderId = 'codex' | 'claude' | 'gemini';

export type AutoSyncMinutes = 5 | 10 | 15 | 20;

export type DockMetricKey = 'fiveHour' | 'weekly' | 'fable';

export type DockMetricId =
  | 'codex:fiveHour'
  | 'codex:weekly'
  | 'claude:fiveHour'
  | 'claude:weekly'
  | 'claude:fable'
  | 'gemini:fiveHour'
  | 'gemini:weekly';

export interface ProviderAuthInfo {
  connected: boolean;
  method: 'none' | 'oauth-session' | 'local-cli' | 'token';
  accountLabel?: string;
  lastSyncedAt?: string;
  statusMessage?: string;
}

export type AuthStateMap = Record<ProviderId, ProviderAuthInfo>;

export interface QuotaBucket {
  used: number;
  limit: number;
  unit: string;
  resetLabel: string;
  label?: string;
  hidden?: boolean;
}

export interface AiQuotaState {
  lastUpdatedAt: string;
  source: 'manual' | 'local-file' | 'oauth-sync';
  codex: {
    fiveHour: QuotaBucket;
    weekly: QuotaBucket;
  };
  claude: {
    fiveHour: QuotaBucket;
    weekly: QuotaBucket;
    fable: QuotaBucket;
  };
  gemini: {
    fiveHour: QuotaBucket;
    weekly: QuotaBucket;
  };
}

export interface DotDockState {
  onboardingCompleted: boolean;
  enabledProviders: ProviderId[];
  dockMetricId?: DockMetricId;
  dockMetricIds?: DockMetricId[];
  showSystemWidget: boolean;
  birthYear: number | null;
  selectedZodiacId: ZodiacId;
  characterStyle?: 'vector' | 'pixel';
  customImageDataUrl: string | null;
  scale: 1 | 1.25 | 1.5;
  alwaysOnTop: boolean;
  launchAtLogin: boolean;
  checkUpdatesOnStartup: boolean;
  autoSyncMinutes: AutoSyncMinutes;
  activeWidgetId: string;
  memo: string;
  windowPosition: { x: number; y: number } | null;
  auth: AuthStateMap;
  quota: AiQuotaState;
}

export interface SystemStats {
  cpuLoadPercent: number;
  gpuLoadPercent: number;
  gpuModel: string;
  loadAvg1m: number;
  cpuCount: number;
  memUsedGb: number;
  memTotalGb: number;
  memPercent: number;
  uptimeHours: number;
  platform: string;
}

export interface SyncQuotaResult {
  found: boolean;
  path: string;
  state: DotDockState;
  error?: string;
}

export interface AuthActionResult {
  ok: boolean;
  message: string;
  state: DotDockState;
}

export interface AppUpdateInfo {
  currentVersion: string;
  latestVersion: string | null;
  available: boolean;
  downloadAvailable: boolean;
  releaseUrl: string;
  message: string;
  error?: boolean;
}

export interface InstallUpdateResult {
  ok: boolean;
  message: string;
}

export interface MainCommand {
  type: 'toggle-hud' | 'open-settings' | 'open-oauth' | 'quota-updated' | 'state-updated';
  payload?: unknown;
}

export type SettingsTabId = 'character' | 'ai' | 'system';

export interface WidgetContext {
  state: DotDockState;
  updateState: (patch: Partial<DotDockState>) => Promise<void>;
  syncLocalQuota: (createSampleIfMissing?: boolean) => Promise<SyncQuotaResult>;
  syncStatusMessage: string | null;
  startOAuthLogin: (provider: ProviderId) => Promise<AuthActionResult>;
  detectLocalAuth: (provider?: ProviderId) => Promise<AuthActionResult>;
  syncProviderQuota: (provider?: ProviderId) => Promise<AuthActionResult>;
  saveProviderToken: (provider: ProviderId, token: string) => Promise<AuthActionResult>;
  disconnectProvider: (provider: ProviderId) => Promise<AuthActionResult>;
  authStatusMessage: string | null;
  systemStats: SystemStats | null;
  refreshSystemStats: () => Promise<void>;
  onOpenSettingsTab?: (tab: SettingsTabId) => void;
}

export interface WidgetDefinition {
  id: string;
  title: string;
  badge?: string;
  render: (ctx: WidgetContext) => import('react').ReactNode;
}

export interface DotDockBridge {
  getUpdateInfo: () => Promise<AppUpdateInfo>;
  checkForUpdates: () => Promise<AppUpdateInfo>;
  installUpdate: () => Promise<InstallUpdateResult>;
  getState: () => Promise<DotDockState>;
  saveState: (patch: Partial<DotDockState>) => Promise<DotDockState>;
  syncLocalQuota: (options?: { createSampleIfMissing?: boolean }) => Promise<SyncQuotaResult>;
  startOAuthLogin: (provider: ProviderId) => Promise<AuthActionResult>;
  detectLocalAuth: (provider?: ProviderId) => Promise<AuthActionResult>;
  syncProviderQuota: (provider?: ProviderId) => Promise<AuthActionResult>;
  saveProviderToken: (provider: ProviderId, token: string) => Promise<AuthActionResult>;
  disconnectProvider: (provider: ProviderId) => Promise<AuthActionResult>;
  setExpanded: (expanded: boolean) => Promise<{ x: number; y: number; width: number; height: number }>;
  moveBy: (dx: number, dy: number) => void;
  commitWindowPosition: () => Promise<{ x: number; y: number }>;
  minimizeToTray: () => void;
  resetPosition: () => Promise<{ x: number; y: number }>;
  setAlwaysOnTop: (alwaysOnTop: boolean) => Promise<boolean>;
  getSystemStats: () => Promise<SystemStats>;
  onCommand: (callback: (command: MainCommand) => void) => () => void;
}

declare global {
  interface Window {
    dotdock?: DotDockBridge;
  }
}
