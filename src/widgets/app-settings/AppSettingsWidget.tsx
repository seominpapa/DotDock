import type { AutoSyncMinutes, WidgetContext } from '../../types/dotdock';
import { UpdateSettings } from '../../components/UpdateSettings';

const AUTO_SYNC_OPTIONS: AutoSyncMinutes[] = [5, 10, 15, 20];

export function AppSettingsWidget({
  state, updateState, onToggleAlwaysOnTop, onResetPosition, onReopenOnboarding, onMinimize
}: WidgetContext) {
  const renderAutoSyncButtons = () => (
    <div className="toolbar-actions">
      {AUTO_SYNC_OPTIONS.map((minutes) => (
        <button key={minutes} type="button"
          className={`mini-btn ${state.autoSyncMinutes === minutes ? 'is-active' : ''}`}
          aria-pressed={state.autoSyncMinutes === minutes}
          onClick={() => void updateState({ autoSyncMinutes: minutes })}>
          {minutes}분
        </button>
      ))}
    </div>
  );

  return (
    <section className="provider-card">
      <div className="provider-header">
        <strong className="provider-name">앱 실행 · 창 설정</strong>
      </div>

      <div className="settings-option-row">
        <span>컴퓨터 켜면 자동 실행 (시작프로그램)</span>
        <button
          type="button"
          className={`mini-btn ${state.launchAtLogin ? 'is-active' : ''}`}
          onClick={() => void updateState({ launchAtLogin: !state.launchAtLogin })}
        >
          {state.launchAtLogin ? '켜짐 (ON)' : '꺼짐 (OFF)'}
        </button>
      </div>

      <div className="settings-option-row">
        <span>AI 사용량 자동 동기화 주기</span>
        {renderAutoSyncButtons()}
      </div>

      <div className="settings-option-row">
        <span>현황에 PC 상태 (CPU·GPU·RAM) 표시</span>
        <button
          type="button"
          className={`mini-btn ${state.showSystemWidget ? 'is-active' : ''}`}
          onClick={() => void updateState({ showSystemWidget: !state.showSystemWidget })}
        >
          {state.showSystemWidget ? '표시 (ON)' : '숨김 (OFF)'}
        </button>
      </div>

      <div className="settings-option-row">
        <span>항상 위에 표시 (Float)</span>
        <button
          type="button"
          className={`mini-btn ${state.alwaysOnTop ? 'is-active' : ''}`}
          onClick={() => void onToggleAlwaysOnTop?.(!state.alwaysOnTop)}
        >
          {state.alwaysOnTop ? '켜짐 (ON)' : '꺼짐 (OFF)'}
        </button>
      </div>

      <div className="settings-option-row">
        <span>초기 온보딩 마법사 다시 열기</span>
        <button type="button" className="mini-btn is-accent" onClick={onReopenOnboarding}>
          초기 설정 열기
        </button>
      </div>

      <UpdateSettings
        checkOnStartup={state.checkUpdatesOnStartup !== false}
        onToggleStartup={() => void updateState({ checkUpdatesOnStartup: state.checkUpdatesOnStartup === false })}
      />
      <div className="settings-footer-actions">
        <button type="button" className="mini-btn" onClick={() => void onResetPosition?.()}>
          위치 초기화 (우측 하단)
        </button>
        <button type="button" className="mini-btn" onClick={onMinimize}>
          상단 메뉴바로 최소화
        </button>
      </div>
    </section>
  );
}
