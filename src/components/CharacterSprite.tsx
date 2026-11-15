import { useRef, useState } from 'react';
import type { DotDockState } from '../types/dotdock';
import { getZodiacById, getZodiacImage } from '../services/zodiac';
import { getAvailableDockMetrics, getSelectedDockMetrics } from '../services/quotaMetrics';

interface CharacterSpriteProps {
  state: DotDockState;
  expanded: boolean;
  onToggleHud: () => void;
  onOpenSettings: () => void;
  onMinimize: () => void;
  onDragMove: (dx: number, dy: number) => void;
  onDragCommit: () => void;
}

export function CharacterSprite({
  state,
  expanded,
  onToggleHud,
  onOpenSettings,
  onMinimize,
  onDragMove,
  onDragCommit
}: CharacterSpriteProps) {
  const zodiac = getZodiacById(state.selectedZodiacId);
  const spriteSrc = state.customImageDataUrl || getZodiacImage(zodiac, state.characterStyle);
  const pixelClass = !state.customImageDataUrl && state.characterStyle === 'pixel' ? 'is-pixel' : '';

  const dragRef = useRef<{
    active: boolean;
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
  }>({
    active: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    moved: false
  });
  const [dragging, setDragging] = useState(false);

  const availableMetrics = getAvailableDockMetrics(state);
  const selectedMetrics = getSelectedDockMetrics(state);
  const overallPeak = Math.max(0, ...availableMetrics.map((m) => m.usedPercent));
  const hasWarning = overallPeak >= 80;
  const spriteSize = Math.round(64 * state.scale);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      active: true,
      pointerId: e.pointerId,
      startX: e.screenX,
      startY: e.screenY,
      lastX: e.screenX,
      lastY: e.screenY,
      moved: false
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== e.pointerId) return;

    const totalDist = Math.hypot(e.screenX - drag.startX, e.screenY - drag.startY);
    if (totalDist > 4) {
      if (!drag.moved) {
        drag.moved = true;
        setDragging(true);
      }
      const dx = Math.round(e.screenX - drag.lastX);
      const dy = Math.round(e.screenY - drag.lastY);
      if (dx !== 0 || dy !== 0) {
        onDragMove(dx, dy);
        drag.lastX += dx;
        drag.lastY += dy;
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== e.pointerId) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const wasMoved = drag.moved;
    drag.active = false;
    drag.moved = false;
    setDragging(false);

    if (wasMoved) {
      onDragCommit();
    } else {
      onToggleHud();
    }
  };

  const pillLabel = state.birthYear
    ? `${state.birthYear} ${zodiac.ttiLabel}`
    : zodiac.ttiLabel;

  return (
    <div
      className={`character-dock ${dragging ? 'is-dragging' : ''} ${expanded ? 'is-expanded' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      title="클릭: 현황판 열기/닫기 · 드래그: 위치 이동"
    >
      <div className="character-hover-tools">
        <button
          type="button"
          className="hover-tool-btn"
          title="메뉴바로 최소화"
          onClick={(e) => {
            e.stopPropagation();
            onMinimize();
          }}
        >
          _
        </button>
        <button
          type="button"
          className="hover-tool-btn"
          title="DotDock 통합 설정"
          onClick={(e) => {
            e.stopPropagation();
            onOpenSettings();
          }}
        >
          ⚙
        </button>
      </div>

      <div className="sprite-stage">
        {hasWarning && (
          <span className="warning-badge" title={`AI 사용량 ${overallPeak}% 도달!`}>
            !
          </span>
        )}
        <img
          src={spriteSrc}
          alt={zodiac.ttiLabel}
          className={`sprite-img ${pixelClass} ${dragging ? 'no-bounce' : ''}`}
          style={{
            width: `${spriteSize}px`,
            height: `${spriteSize}px`
          }}
          draggable={false}
        />
      </div>

      <div className="character-pill">
        <div className="pill-title-row">
          <span className="pill-dot" style={{ backgroundColor: zodiac.accent }} />
          <span className="pill-label">{pillLabel}</span>
        </div>
        {selectedMetrics.map((metric) => (
          <div
            key={metric.id}
            className="pill-quota-item"
            data-metric-id={metric.id}
            title={`${metric.providerTitle} · ${metric.label} (사용 ${metric.usedPercent}% · ${metric.remainingPercent}% 남음)`}
          >
            <div className="pill-quota-meta">
              <span className="pill-quota-name">{metric.shortLabel}</span>
              <span
                className={`pill-quota-rem ${
                  metric.usedPercent >= 85
                    ? 'is-danger'
                    : metric.usedPercent >= 65
                      ? 'is-warn'
                      : ''
                }`}
              >
                {metric.remainingPercent}% 남음
              </span>
            </div>
            <div className="pill-single-bar" aria-label={`${metric.shortLabel} 사용 ${metric.usedPercent}%`}>
              <div
                className="pill-single-fill"
                style={{
                  width: `${metric.usedPercent}%`,
                  backgroundColor: metric.usedPercent >= 85 ? '#fb7185' : metric.usedPercent >= 65 ? '#fbbf24' : metric.color
                }}
              />
            </div>
          </div>
        ))}
        {selectedMetrics.length === 0 && (
          <div className="pill-quota-meta">
            <span className="pill-quota-name">표시 항목 없음</span>
          </div>
        )}
      </div>
    </div>
  );
}
