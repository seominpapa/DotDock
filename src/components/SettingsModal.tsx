import { useState } from 'react';
import { CharacterModelSettings } from './CharacterModelSettings';
import { getLocalDateString, parseBirthDate } from '../services/age';
import type { DotDockState, ZodiacId } from '../types/dotdock';
import { ZODIAC_LIST, getZodiacByBirthYear, getZodiacById, getZodiacPreview } from '../services/zodiac';

interface SettingsModalProps {
  state: DotDockState;
  updateState: (patch: Partial<DotDockState>) => Promise<void>;
  onSwitchToHud: () => void;
  onMinimize: () => void;
  onCloseWindow: () => void;
}

export function SettingsModal({
  state, updateState, onSwitchToHud, onMinimize, onCloseWindow
}: SettingsModalProps) {
  const [yearInput, setYearInput] = useState<string>(state.birthYear ? String(state.birthYear) : '');
  const [birthDateInput, setBirthDateInput] = useState(state.birthDate || '');
  const parsedYear = Number(yearInput);
  const validYear = Number.isInteger(parsedYear) && parsedYear >= 1900 && parsedYear <= new Date().getFullYear();
  const parsedBirthDate = parseBirthDate(birthDateInput);
  const previewZodiac = validYear
    ? getZodiacByBirthYear(parsedYear)
    : getZodiacById(state.selectedZodiacId);

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

  return (
    <div className="hud-popover" role="dialog" aria-label="DotDock 캐릭터 설정">
      <header className="hud-header">
        <div className="hud-identity">
          <span className="hud-emoji">🐾</span>
          <div>
            <div className="hud-title">캐릭터 설정</div>
            <div className="hud-subtitle">생일 · 그림 스타일 · 크기</div>
          </div>
        </div>
        <div className="hud-window-actions">
          <button type="button" className="mini-btn" title="현황판 화면으로 돌아가기" onClick={onSwitchToHud}>
            ← 현황판
          </button>
          <button type="button" className="icon-btn" title="메뉴바로 최소화" onClick={onMinimize}>_</button>
          <button type="button" className="icon-btn" title="창 닫기" onClick={onCloseWindow}>✕</button>
        </div>
      </header>
      <div className="hud-body settings-body">
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
                생일을 입력하면 만 나이 × 0.8을 반올림해 괄호에 표시합니다. 생일이 없으면 나이는 표시하지 않습니다.
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
                        src={getZodiacPreview(z, state.characterStyle)}
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
      </div>
    </div>
  );
}
