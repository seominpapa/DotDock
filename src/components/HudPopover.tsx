import type {
  AuthActionResult,
  DotDockState,
  ProviderId,
  SettingsTabId,
  SyncQuotaResult,
  SystemStats
} from '../types/dotdock';
import { getZodiacById, getZodiacImage } from '../services/zodiac';
import { WIDGET_REGISTRY, getWidgetById } from '../widgets/registry';
import { formatCompanionLabel } from '../services/age';

interface HudPopoverProps {
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
  onOpenSettingsTab: (tab?: SettingsTabId) => void;
  onMinimize: () => void;
  onCloseWindow: () => void;
}

export function HudPopover({
  state,
  updateState,
  syncLocalQuota,
  syncStatusMessage,
  startOAuthLogin,
  detectLocalAuth,
  syncProviderQuota,
  saveProviderToken,
  disconnectProvider,
  authStatusMessage,
  systemStats,
  refreshSystemStats,
  onOpenSettingsTab,
  onMinimize,
  onCloseWindow
}: HudPopoverProps) {
  const zodiac = getZodiacById(state.selectedZodiacId);
  const activeWidget = getWidgetById(state.activeWidgetId);
  const charIconSrc = state.customImageDataUrl || getZodiacImage(zodiac, state.characterStyle);

  return (
    <div className="hud-popover" role="dialog" aria-label="DotDock 정보 HUD">
      <header className="hud-header">
        <div className="hud-identity">
          <span className="hud-emoji">{zodiac.emoji}</span>
          <div>
            <div className="hud-title">
              DotDock <span className="hud-hanja">({zodiac.hanja})</span>
            </div>
            <div className="hud-subtitle">
              {formatCompanionLabel(state, zodiac.ttiLabel)} 수호메이트
            </div>
          </div>
        </div>

        <div className="hud-window-actions">
          <button
            type="button"
            className="char-settings-btn"
            title="캐릭터 및 통합 설정 열기"
            onClick={() => onOpenSettingsTab('character')}
          >
            <img
              src={charIconSrc}
              alt={zodiac.ttiLabel}
              className={`char-btn-sprite ${!state.customImageDataUrl && state.characterStyle === 'pixel' ? 'is-pixel' : ''}`}
            />
            <span>캐릭터 설정</span>
          </button>
          <button
            type="button"
            className="icon-btn"
            title="메뉴바로 최소화"
            onClick={onMinimize}
          >
            _
          </button>
          <button
            type="button"
            className="icon-btn"
            title="창 닫기"
            onClick={onCloseWindow}
          >
            ✕
          </button>
        </div>
      </header>

      <nav className="widget-tabs" aria-label="정보 위젯 탭">
        {WIDGET_REGISTRY.map((widget) => {
          const isActive = widget.id === activeWidget.id;
          return (
            <button
              key={widget.id}
              type="button"
              className={`widget-tab ${isActive ? 'is-active' : ''}`}
              onClick={() => void updateState({ activeWidgetId: widget.id })}
            >
              <span>{widget.title}</span>
              {widget.badge && <span className="tab-badge">{widget.badge}</span>}
            </button>
          );
        })}
      </nav>

      <main className="hud-body">
        {activeWidget.render({
          state,
          updateState,
          syncLocalQuota,
          syncStatusMessage,
          startOAuthLogin,
          detectLocalAuth,
          syncProviderQuota,
          saveProviderToken,
          disconnectProvider,
          authStatusMessage,
          systemStats,
          refreshSystemStats,
          onOpenSettingsTab
        })}
      </main>
    </div>
  );
}
