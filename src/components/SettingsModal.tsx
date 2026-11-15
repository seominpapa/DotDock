import { useState } from 'react';
import { UpdateSettings } from './UpdateSettings';
import { CharacterModelSettings } from './CharacterModelSettings';
import { getLocalDateString, parseBirthDate } from '../services/age';
import type {
  AuthActionResult,
  AutoSyncMinutes,
  DotDockState,
  ProviderId,
  SettingsTabId,
  SyncQuotaResult,
  ZodiacId
} from '../types/dotdock';
import { ZODIAC_LIST, getZodiacByBirthYear, getZodiacById, getZodiacImage } from '../services/zodiac';
import { getAvailableDockMetrics, getSelectedDockMetricIds, toggleDockMetric } from '../services/quotaMetrics';

const AUTO_SYNC_OPTIONS: AutoSyncMinutes[] = [5, 10, 15, 20];

interface SettingsModalProps {
  state: DotDockState;
  activeTab: SettingsTabId;
  onChangeTab: (tab: SettingsTabId) => void;
  updateState: (patch: Partial<DotDockState>) => Promise<void>;
  startOAuthLogin: (provider: ProviderId) => Promise<AuthActionResult>;
  detectLocalAuth: (provider?: ProviderId) => Promise<AuthActionResult>;
  syncProviderQuota: (provider?: ProviderId) => Promise<AuthActionResult>;
  saveProviderToken: (provider: ProviderId, token: string) => Promise<AuthActionResult>;
  disconnectProvider: (provider: ProviderId) => Promise<AuthActionResult>;
  syncLocalQuota: (createSampleIfMissing?: boolean) => Promise<SyncQuotaResult>;
  authStatusMessage: string | null;
  syncStatusMessage: string | null;
  onToggleAlwaysOnTop: (flag: boolean) => Promise<void>;
  onResetPosition: () => Promise<void>;
  onReopenOnboarding: () => void;
  onSwitchToHud: () => void;
  onMinimize: () => void;
  onCloseWindow: () => void;
}

const LLM_CONFIGS: Array<{
  id: ProviderId;
  title: string;
  subtitle: string;
  dotColor: string;
  tokenHint: string;
}> = [
  {
    id: 'codex',
    title: 'ChatGPT · Codex',
    subtitle: 'OpenAI 웹 OAuth · Codex CLI 인증',
    dotColor: '#10b981',
    tokenHint: 'OpenAI OAuth Access Token'
  },
  {
    id: 'claude',
    title: 'Claude',
    subtitle: 'Claude 웹 OAuth · 5시간·주간 사용량',
    dotColor: '#f59e0b',
    tokenHint: 'Claude OAuth Access Token'
  },
  {
    id: 'gemini',
    title: 'Antigravity · Gemini',
    subtitle: 'Antigravity 로그인 후 로컬 인증 감지 · 모델 할당량',
    dotColor: '#38bdf8',
    tokenHint: 'Google OAuth Access Token (ya29...)'
  }
];

function formatMethodLabel(method: string): string {
  switch (method) {
    case 'oauth-session':
    case 'local-cli':
      return 'OAuth 연동';
    case 'token':
      return '토큰';
    default:
      return '미연결';
  }
}

export function SettingsModal({
  state,
  activeTab,
  onChangeTab,
  updateState,
  startOAuthLogin,
  detectLocalAuth,
  syncProviderQuota,
  saveProviderToken,
  disconnectProvider,
  authStatusMessage,
  syncStatusMessage,
  onToggleAlwaysOnTop,
  onResetPosition,
  onReopenOnboarding,
  onSwitchToHud,
  onMinimize,
  onCloseWindow
}: SettingsModalProps) {
  const [yearInput, setYearInput] = useState<string>(
    state.birthYear ? String(state.birthYear) : ''
  );
  const [birthDateInput, setBirthDateInput] = useState(state.birthDate || '');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [tokenOpenFor, setTokenOpenFor] = useState<ProviderId | null>(null);
  const [tokenDraft, setTokenDraft] = useState('');

  const parsedYear = Number(yearInput);
  const validYear = Number.isInteger(parsedYear) && parsedYear >= 1900 && parsedYear <= new Date().getFullYear();
  const parsedBirthDate = parseBirthDate(birthDateInput);
  const previewZodiac = validYear
    ? getZodiacByBirthYear(parsedYear)
    : getZodiacById(state.selectedZodiacId);

  const enabledProviders = state.enabledProviders || ['codex', 'claude', 'gemini'];

  const handleApplyBirthYear = () => {
    if (!validYear) return;
    const matched = getZodiacByBirthYear(parsedYear);
    const retainedDate = parseBirthDate(state.birthDate)?.year === parsedYear ? state.birthDate : null;
    setBirthDateInput(retainedDate || '');
    void updateState({
      birthYear: parsedYear,
      birthDate: retainedDate,
      selectedZodiacId: matched.id,
      customImageDataUrl: null,
      customModelId: null
    });
  };

  const handleApplyBirthDate = () => {
    if (!birthDateInput) {
      void updateState({ birthDate: null });
      return;
    }
    if (!parsedBirthDate) return;
    setYearInput(String(parsedBirthDate.year));
    void updateState({
      birthDate: birthDateInput,
      birthYear: parsedBirthDate.year,
      selectedZodiacId: getZodiacByBirthYear(parsedBirthDate.year).id,
      customImageDataUrl: null,
      customModelId: null
    });
  };

  const handleSelectZodiac = (id: ZodiacId) => {
    void updateState({ selectedZodiacId: id, customImageDataUrl: null, customModelId: null });
  };

  const handleUploadCustomImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        void updateState({ customImageDataUrl: reader.result, characterStyle: 'vector' });
      }
    };
    reader.readAsDataURL(file);
  };

  const toggleProvider = (id: ProviderId) => {
    const exists = enabledProviders.includes(id);
    if (exists && enabledProviders.length <= 1) return;
    const next = exists
      ? enabledProviders.filter((p) => p !== id)
      : [...enabledProviders, id];
    void updateState({ enabledProviders: next });
  };

  const runAction = async (key: string, fn: () => Promise<unknown>) => {
    setBusyKey(key);
    try {
      await fn();
    } finally {
      setBusyKey(null);
    }
  };

  const currentSyncMinutes: AutoSyncMinutes = state.autoSyncMinutes || 10;

  const renderAutoSyncButtons = () => (
    <div className="toolbar-actions">
      {AUTO_SYNC_OPTIONS.map((mins) => (
        <button
          key={mins}
          type="button"
          className={`mini-btn ${currentSyncMinutes === mins ? 'is-active' : ''}`}
          onClick={() => void updateState({ autoSyncMinutes: mins })}
        >
          {mins}분
        </button>
      ))}
    </div>
  );

  return (
    <div className="hud-popover" role="dialog" aria-label="DotDock 설정">
      <header className="hud-header">
        <div className="hud-identity">
          <span className="hud-emoji">⚙</span>
          <div>
            <div className="hud-title">DotDock 통합 설정</div>
            <div className="hud-subtitle">캐릭터 · AI 쿼터/인증 · 시스템 표시</div>
          </div>
        </div>

        <div className="hud-window-actions">
          <button
            type="button"
            className="mini-btn"
            title="현황판 화면으로 돌아가기"
            onClick={onSwitchToHud}
          >
            ← 현황판
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

      <nav className="widget-tabs" aria-label="설정 카테고리">
        <button
          type="button"
          className={`widget-tab ${activeTab === 'character' ? 'is-active' : ''}`}
          onClick={() => onChangeTab('character')}
        >
          🐾 캐릭터 설정
        </button>
        <button
          type="button"
          className={`widget-tab ${activeTab === 'ai' ? 'is-active' : ''}`}
          onClick={() => onChangeTab('ai')}
        >
          ⚡ AI 쿼터 · 인증
        </button>
        <button
          type="button"
          className={`widget-tab ${activeTab === 'system' ? 'is-active' : ''}`}
          onClick={() => onChangeTab('system')}
        >
          🖥️ 시스템 · 창
        </button>
      </nav>

      <div className="hud-body settings-body">
        {activeTab === 'character' && (
          <>
            <section className="provider-card">
              <div className="provider-header">
                <strong className="provider-name">1. 생년월일 · 띠 자동 매칭</strong>
              </div>
              <label htmlFor="settings-birth-date">생년월일 (선택)</label>
              <div className="birth-year-row">
                <input
                  id="settings-birth-date"
                  type="date"
                  min="1900-01-01"
                  max={getLocalDateString()}
                  value={birthDateInput}
                  onChange={(event) => setBirthDateInput(event.target.value)}
                  className="year-input"
                />
                <button
                  type="button"
                  className="mini-btn is-accent"
                  disabled={Boolean(birthDateInput && !parsedBirthDate)}
                  onClick={handleApplyBirthDate}
                >
                  생일 적용
                </button>
              </div>
              <p className="year-preview">
                생일 기준 만 나이 × 0.8을 반올림해 표시합니다. 생년만 입력하면 나이는 표시하지 않습니다.
              </p>
              {birthDateInput && !parsedBirthDate && <p className="year-preview" role="alert">오늘까지의 올바른 생년월일을 입력해 주세요.</p>}
              <label htmlFor="settings-birth-year">생년만 입력</label>
              <div className="birth-year-row">
                <input
                  id="settings-birth-year"
                  type="number"
                  min={1900}
                  max={new Date().getFullYear()}
                  value={yearInput}
                  onChange={(e) => setYearInput(e.target.value)}
                  placeholder="예: 1996"
                  className="year-input"
                />
                <button
                  type="button"
                  className="mini-btn is-accent"
                  disabled={!validYear}
                  onClick={handleApplyBirthYear}
                >
                  적용
                </button>
              </div>
              <div className="year-preview">
                {validYear ? (
                  <span>
                    {parsedYear}년생은{' '}
                    <strong>
                      {previewZodiac.emoji} {previewZodiac.ttiLabel} ({previewZodiac.hanja})
                    </strong>{' '}
                    입니다!
                  </span>
                ) : (
                  <span>1900년부터 올해 사이 연도를 입력하거나 아래에서 직접 고르세요.</span>
                )}
              </div>
            </section>

            <section className="provider-card">
              <div className="provider-header">
                <strong className="provider-name">2. 12지신 캐릭터 선택</strong>
              </div>
              <div className="settings-option-row">
                <span>캐릭터 스타일</span>
                <div className="toolbar-actions">
                  {(['vector', 'pixel', '3d'] as const).map((style) => (
                    <button
                      key={style}
                      type="button"
                      className={`mini-btn ${(state.characterStyle || 'vector') === style ? 'is-active' : ''}`}
                      aria-pressed={(state.characterStyle || 'vector') === style}
                      onClick={() => void updateState({ characterStyle: style, customImageDataUrl: null })}
                    >
                      {style === 'vector' ? '벡터' : style === 'pixel' ? '도트' : '3D'}
                    </button>
                  ))}
                </div>
              </div>
              {state.characterStyle === '3d' && (
                <div className="character-model-options">
                  <p className="year-preview">캐릭터를 드래그하면 회전합니다. 이름 영역을 드래그하면 창이 이동합니다.</p>
                  <CharacterModelSettings modelId={state.customModelId} onImported={async (id) => {
                    await updateState({ customModelId: id, characterStyle: '3d', customImageDataUrl: null });
                  }} />
                  {state.customModelId && <button type="button" className="mini-btn" onClick={() => void updateState({ customModelId: null })}>기본 12지신 사용</button>}
                </div>
              )}
              <div className="zodiac-grid">
                {ZODIAC_LIST.map((z) => {
                  const selected = state.selectedZodiacId === z.id && !state.customImageDataUrl;
                  return (
                    <button
                      key={z.id}
                      type="button"
                      className={`zodiac-cell ${selected ? 'is-selected' : ''}`}
                      onClick={() => handleSelectZodiac(z.id)}
                      title={`${z.ttiLabel} (${z.hanja})`}
                    >
                      <img
                        src={getZodiacImage(z, state.characterStyle)}
                        alt={z.ttiLabel}
                        className={`zodiac-thumb ${state.characterStyle === 'pixel' ? 'is-pixel' : ''}`}
                      />
                      <span className="zodiac-cell-label">{z.koreanName}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="provider-card">
              <div className="provider-header">
                <strong className="provider-name">3. 커스텀 사진 &amp; 캐릭터 크기</strong>
              </div>

              <div className="settings-option-row">
                <span>커스텀 이미지</span>
                <div className="toolbar-actions">
                  <label className="mini-btn is-accent file-label">
                    파일 선택
                    <input
                      type="file"
                      accept="image/png,image/gif,image/webp,image/jpeg"
                      onChange={handleUploadCustomImage}
                      hidden
                    />
                  </label>
                  {state.customImageDataUrl && (
                    <button
                      type="button"
                      className="mini-btn"
                      onClick={() => void updateState({ customImageDataUrl: null })}
                    >
                      기본 띠 복원
                    </button>
                  )}
                </div>
              </div>

              <div className="settings-option-row">
                <span>캐릭터 크기</span>
                <div className="toolbar-actions">
                  {([1, 1.25, 1.5] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`mini-btn ${state.scale === s ? 'is-active' : ''}`}
                      onClick={() => void updateState({ scale: s })}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              </div>
            </section>
          </>
        )}

        {activeTab === 'ai' && (
          <>
            <div className="widget-toolbar">
              <div className="sync-meta">
                <span className="source-pill">LLM 인증 · 표시 설정</span>
              </div>
              <div className="toolbar-actions">
                <button
                  type="button"
                  className="mini-btn is-accent"
                  disabled={busyKey !== null}
                  onClick={() => void runAction('cfg-sync', () => syncProviderQuota())}
                >
                  {busyKey === 'cfg-sync' ? '동기화 중...' : '↻ 사용량 동기화'}
                </button>
              </div>
            </div>

            {(authStatusMessage || syncStatusMessage) && (
              <div className="sync-banner">
                <span>{authStatusMessage || syncStatusMessage}</span>
              </div>
            )}

            <section className="provider-card">
              <div className="settings-option-row">
                <span>자동 동기화 주기 (기본 10분)</span>
                {renderAutoSyncButtons()}
              </div>
            </section>

            {LLM_CONFIGS.map((spec) => {
              const enabled = enabledProviders.includes(spec.id);
              const info = state.auth[spec.id];
              const isTokenOpen = tokenOpenFor === spec.id;
              const selectedDockMetricIds = getSelectedDockMetricIds(state);
              const providerMetrics = getAvailableDockMetrics(state, true).filter(
                (m) => m.provider === spec.id
              );

              return (
                <section key={spec.id} className="provider-card">
                  <div className="provider-header">
                    <label className="llm-check-label">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={() => toggleProvider(spec.id)}
                      />
                      <span className="provider-dot" style={{ backgroundColor: spec.dotColor }} />
                      <strong className="provider-name">{spec.title}</strong>
                    </label>
                    <span
                      className={`auth-badge ${
                        info.connected ? 'is-connected' : 'is-disconnected'
                      }`}
                    >
                      {info.connected ? `● ${formatMethodLabel(info.method)}` : '○ 미연결'}
                    </span>
                  </div>

                  <div className="auth-detail-line">
                    <span className="auth-sub">{spec.subtitle}</span>
                    {info.accountLabel && <span className="auth-account">{info.accountLabel}</span>}
                  </div>
                  {info.statusMessage && (
                    <div className="quota-reset-text">{info.statusMessage}</div>
                  )}

                  <div className="auth-actions-row">
                    <button
                      type="button"
                      className="mini-btn is-accent"
                      disabled={busyKey !== null}
                      title={spec.id === 'gemini'
                        ? 'Antigravity에서 로그인한 계정의 로컬 인증을 감지합니다'
                        : '기본 웹 브라우저로 OAuth 로그인'}
                      onClick={() =>
                        void runAction(`cfg-login-${spec.id}`, () =>
                          spec.id === 'gemini' ? detectLocalAuth(spec.id) : startOAuthLogin(spec.id))
                      }
                    >
                      {busyKey === `cfg-login-${spec.id}`
                        ? spec.id === 'gemini' ? '로컬 인증 확인 중…' : '브라우저 인증 중...'
                        : spec.id === 'gemini' ? '로컬 인증 감지' : info.connected
                          ? '🌐 계정 변경'
                          : '🌐 웹 로그인'}
                    </button>
                    <button
                      type="button"
                      className={`mini-btn ${isTokenOpen ? 'is-active' : ''}`}
                      disabled={busyKey !== null}
                      onClick={() => {
                        setTokenOpenFor(isTokenOpen ? null : spec.id);
                        setTokenDraft('');
                      }}
                    >
                      🔑 토큰
                    </button>
                    {info.connected && (
                      <>
                        <button
                          type="button"
                          className="mini-btn"
                          disabled={busyKey !== null}
                          onClick={() =>
                            void runAction(`cfg-sync-${spec.id}`, () => syncProviderQuota(spec.id))
                          }
                        >
                          ↻ 동기화
                        </button>
                        <button
                          type="button"
                          className="mini-btn is-danger-btn"
                          disabled={busyKey !== null}
                          onClick={() =>
                            void runAction(`cfg-disc-${spec.id}`, () => disconnectProvider(spec.id))
                          }
                        >
                          해제
                        </button>
                      </>
                    )}
                  </div>

                  {isTokenOpen && (
                    <div className="token-input-row">
                      <input
                        type="password"
                        className="year-input"
                        value={tokenDraft}
                        onChange={(e) => setTokenDraft(e.target.value)}
                        placeholder={spec.tokenHint}
                      />
                      <button
                        type="button"
                        className="mini-btn is-accent"
                        disabled={!tokenDraft.trim() || busyKey !== null}
                        onClick={() =>
                          void runAction(`cfg-tok-${spec.id}`, async () => {
                            await saveProviderToken(spec.id, tokenDraft);
                            setTokenDraft('');
                            setTokenOpenFor(null);
                          })
                        }
                      >
                        저장
                      </button>
                    </div>
                  )}

                  {providerMetrics.length > 0 && (
                    <div className="dock-metric-pick-list">
                      <div className="dock-metric-pick-title">
                        캐릭터 하단 상태창 표시 항목 (여러 개 선택 가능)
                      </div>
                      <div className="dock-metric-pick-items">
                        {providerMetrics.map((metric) => {
                          const isSelected = selectedDockMetricIds.includes(metric.id);
                          return (
                            <label
                              key={metric.id}
                              className={`dock-metric-pick-item ${isSelected ? 'is-selected' : ''}`}
                              title="체크하면 캐릭터 하단 상태창에 이 항목의 막대 그래프와 남은 퍼센트를 표시합니다"
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() =>
                                  void updateState({
                                    dockMetricIds: toggleDockMetric(state, metric.id),
                                    enabledProviders: enabled || isSelected
                                      ? enabledProviders
                                      : [...enabledProviders, spec.id]
                                  })
                                }
                              />
                              <span>
                                {metric.label} · {metric.remainingPercent}% 남음
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </section>
              );
            })}
          </>
        )}

        {activeTab === 'system' && (
          <section className="provider-card">
            <div className="provider-header">
              <strong className="provider-name">시스템 현황 &amp; 데스크탑 창 옵션</strong>
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
              <span>클릭 현황판에 CPU·GPU·RAM 표시</span>
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
                onClick={() => void onToggleAlwaysOnTop(!state.alwaysOnTop)}
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
              <button type="button" className="mini-btn" onClick={() => void onResetPosition()}>
                위치 초기화 (우측 하단)
              </button>
              <button type="button" className="mini-btn" onClick={onMinimize}>
                상단 메뉴바로 최소화
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
