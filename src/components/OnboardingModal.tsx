import { useState } from 'react';
import type {
  AuthActionResult,
  AutoSyncMinutes,
  DotDockState,
  ProviderId,
  ZodiacId
} from '../types/dotdock';
import { ZODIAC_LIST, getZodiacByBirthYear, getZodiacById, getZodiacImage } from '../services/zodiac';
import { getLocalDateString, parseBirthDate, formatCompanionLabel } from '../services/age';

const AUTO_SYNC_OPTIONS: AutoSyncMinutes[] = [5, 10, 15, 20];

interface OnboardingModalProps {
  state: DotDockState;
  updateState: (patch: Partial<DotDockState>) => Promise<void>;
  startOAuthLogin: (provider: ProviderId) => Promise<AuthActionResult>;
  detectLocalAuth: (provider?: ProviderId) => Promise<AuthActionResult>;
  authStatusMessage: string | null;
  onComplete: () => Promise<void>;
  onMinimize: () => void;
}

const LLM_ITEMS: Array<{ id: ProviderId; name: string; desc: string; dot: string }> = [
  { id: 'codex', name: 'ChatGPT · Codex', desc: 'OpenAI 웹 OAuth / 주간 · 5시간 사용량', dot: '#10b981' },
  { id: 'claude', name: 'Claude', desc: 'Claude 웹 OAuth / 5시간 · 일주일 사용량', dot: '#f59e0b' },
  { id: 'gemini', name: 'Antigravity · Gemini', desc: 'Antigravity 로그인 후 로컬 인증 감지 / 모델 할당량', dot: '#38bdf8' }
];

export function OnboardingModal({
  state,
  updateState,
  startOAuthLogin,
  detectLocalAuth,
  authStatusMessage,
  onComplete,
  onMinimize
}: OnboardingModalProps) {
  const [yearInput, setYearInput] = useState<string>(
    state.birthYear ? String(state.birthYear) : ''
  );
  const [birthDateInput, setBirthDateInput] = useState(state.birthDate || '');
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const parsedYear = Number(yearInput);
  const validYear = Number.isInteger(parsedYear) && parsedYear >= 1900 && parsedYear <= new Date().getFullYear();
  const parsedBirthDate = parseBirthDate(birthDateInput);
  const activeZodiac = getZodiacById(state.selectedZodiacId);
  const previewSprite = state.customImageDataUrl || getZodiacImage(activeZodiac, state.characterStyle);

  const handleYearChange = (val: string) => {
    setYearInput(val);
    const num = Number(val);
    if (Number.isInteger(num) && num >= 1900 && num <= new Date().getFullYear()) {
      const matched = getZodiacByBirthYear(num);
      const retainedDate = parseBirthDate(state.birthDate)?.year === num ? state.birthDate : null;
      setBirthDateInput(retainedDate || '');
      void updateState({
        birthYear: num,
        birthDate: retainedDate,
        selectedZodiacId: matched.id,
        customImageDataUrl: null,
        customModelId: null
      });
    }
  };

  const handleBirthDateChange = (value: string) => {
    setBirthDateInput(value);
    if (!value) {
      void updateState({ birthDate: null });
      return;
    }
    const birth = parseBirthDate(value);
    if (!birth) return;
    setYearInput(String(birth.year));
    void updateState({
      birthDate: value,
      birthYear: birth.year,
      selectedZodiacId: getZodiacByBirthYear(birth.year).id,
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
    const current = state.enabledProviders || ['codex', 'claude', 'gemini'];
    const exists = current.includes(id);
    if (exists && current.length <= 1) return; // keep at least 1 provider
    const next = exists ? current.filter((p) => p !== id) : [...current, id];
    void updateState({ enabledProviders: next });
  };

  const runAuthAction = async (key: string, fn: () => Promise<unknown>) => {
    setBusyKey(key);
    try {
      await fn();
    } finally {
      setBusyKey(null);
    }
  };

  const handleFinish = async () => {
    if (birthDateInput && !parsedBirthDate) return;
    if (validYear && state.birthYear !== parsedYear) {
      const matched = getZodiacByBirthYear(parsedYear);
      await updateState({
        birthYear: parsedYear,
        selectedZodiacId: matched.id,
        onboardingCompleted: true
      });
    } else {
      await updateState({ onboardingCompleted: true });
    }
    await onComplete();
  };

  return (
    <div className="hud-popover" role="dialog" aria-label="DotDock 초기 설정">
      <header className="hud-header">
        <div className="hud-identity">
          <span className="hud-emoji">🎉</span>
          <div>
            <div className="hud-title">DotDock 초기 설정</div>
            <div className="hud-subtitle">
              생년월일로 내 12지신 캐릭터를 고르고, 모니터링할 LLM을 연결하세요.
            </div>
          </div>
        </div>
        <button type="button" className="icon-btn" title="메뉴바로 최소화" onClick={onMinimize}>
          _
        </button>
      </header>

      <div className="hud-body settings-body">
        {/* Step 1: Birth year & 12 zodiac */}
        <section className="provider-card">
          <div className="provider-header">
            <strong className="provider-name">1. 🎂 생년월일 &amp; 12지신 캐릭터 선택</strong>
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

          <div className="onboarding-hero-row">
            <div className="onboarding-preview-box">
              <img
                src={previewSprite}
                alt={activeZodiac.ttiLabel}
                className={`onboarding-preview-img ${!state.customImageDataUrl && state.characterStyle === 'pixel' ? 'is-pixel' : ''}`}
              />
              <span className="onboarding-preview-label">
                {formatCompanionLabel(state, activeZodiac.ttiLabel)}
              </span>
            </div>

            <div className="onboarding-year-col">
              <label htmlFor="onboarding-birth-date">생년월일 (선택)</label>
              <input
                id="onboarding-birth-date"
                type="date"
                min="1900-01-01"
                max={getLocalDateString()}
                value={birthDateInput}
                onChange={(event) => handleBirthDateChange(event.target.value)}
                className="year-input"
              />
              <div className="year-preview">생일 기준 만 나이 × 0.8을 반올림해 표시합니다.</div>
              {birthDateInput && !parsedBirthDate && <div className="year-preview" role="alert">오늘까지의 올바른 생년월일을 입력해 주세요.</div>}
              <label htmlFor="onboarding-birth-year">생년만 입력 (나이 미표시)</label>
              <input
                id="onboarding-birth-year"
                type="number"
                min={1900}
                max={new Date().getFullYear()}
                value={yearInput}
                onChange={(e) => handleYearChange(e.target.value)}
                placeholder="태어난 연도 (예: 1996)"
                className="year-input"
              />
              <div className="year-preview">
                {validYear
                  ? `${parsedYear}년생 → ${activeZodiac.emoji} ${activeZodiac.ttiLabel} (${activeZodiac.hanja}) 자동 매칭됨`
                  : '연도 입력 또는 아래 12지신에서 선택'}
              </div>
              <div className="toolbar-actions">
                <label className="mini-btn file-label">
                  📷 내 사진
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
                    기본 띠로
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="zodiac-grid-compact">
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
                    className={`zodiac-thumb-sm ${state.characterStyle === 'pixel' ? 'is-pixel' : ''}`}
                  />
                  <span className="zodiac-cell-label">{z.koreanName}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Step 2: Choose LLMs & Auth */}
        <section className="provider-card">
          <div className="provider-header">
            <strong className="provider-name">2. 🔐 사용할 LLM 선택 및 인증 연결</strong>
          </div>

          {authStatusMessage && <div className="sync-banner">{authStatusMessage}</div>}

          <div className="onboarding-llm-list">
            {LLM_ITEMS.map((item) => {
              const enabled = (state.enabledProviders || ['codex', 'claude', 'gemini']).includes(
                item.id
              );
              const authInfo = state.auth[item.id];
              return (
                <div
                  key={item.id}
                  className={`onboarding-llm-card ${enabled ? 'is-enabled' : 'is-disabled'}`}
                >
                  <div className="onboarding-llm-top">
                    <label className="llm-check-label">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={() => toggleProvider(item.id)}
                      />
                      <span className="provider-dot" style={{ backgroundColor: item.dot }} />
                      <strong>{item.name}</strong>
                    </label>
                    <span
                      className={`auth-badge ${
                        authInfo?.connected ? 'is-connected' : 'is-disconnected'
                      }`}
                    >
                      {authInfo?.connected ? '● 연결됨' : '○ 미연결'}
                    </span>
                  </div>

                  <div className="quota-reset-text">
                    {authInfo?.statusMessage || item.desc}
                  </div>

                  {enabled && (
                    <div className="auth-actions-row">
                      <button
                        type="button"
                        className="mini-btn is-accent"
                        disabled={busyKey !== null}
                        onClick={() =>
                          void runAuthAction(`ob-login-${item.id}`, () =>
                            item.id === 'gemini' ? detectLocalAuth(item.id) : startOAuthLogin(item.id))
                        }
                      >
                        {busyKey === `ob-login-${item.id}`
                          ? item.id === 'gemini' ? '로컬 인증 확인 중…' : '브라우저 인증 중...'
                          : item.id === 'gemini' ? '로컬 인증 감지' : '🌐 웹 로그인 (권장)'}
                      </button>
                      {item.id !== 'gemini' && <button
                        type="button"
                        className="mini-btn"
                        disabled={busyKey !== null}
                        onClick={() =>
                          void runAuthAction(`ob-detect-${item.id}`, () => detectLocalAuth(item.id))
                        }
                      >
                        💻 CLI·토큰 동기화
                      </button>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Step 3: Startup & Auto Sync */}
        <section className="provider-card">
          <div className="provider-header">
            <strong className="provider-name">3. ⚡ 시작 옵션 &amp; 자동 동기화 설정</strong>
          </div>

          <div className="settings-option-row">
            <span>컴퓨터를 켜면 항상 실행 (기본 켜짐)</span>
            <button
              type="button"
              className={`mini-btn ${state.launchAtLogin ? 'is-active' : ''}`}
              onClick={() => void updateState({ launchAtLogin: !state.launchAtLogin })}
            >
              {state.launchAtLogin ? '켜짐 (ON)' : '꺼짐 (OFF)'}
            </button>
          </div>

          <div className="settings-option-row">
            <span>자동 동기화 주기 (기본 10분)</span>
            <div className="toolbar-actions">
              {AUTO_SYNC_OPTIONS.map((mins) => (
                <button
                  key={mins}
                  type="button"
                  className={`mini-btn ${(state.autoSyncMinutes || 10) === mins ? 'is-active' : ''}`}
                  onClick={() => void updateState({ autoSyncMinutes: mins })}
                >
                  {mins}분
                </button>
              ))}
            </div>
          </div>
        </section>

        <button
          type="button"
          className="onboarding-finish-btn"
          disabled={Boolean(birthDateInput && !parsedBirthDate)}
          onClick={() => void handleFinish()}
        >
          🚀 설정 완료하고 시작하기
        </button>
      </div>
    </div>
  );
}
