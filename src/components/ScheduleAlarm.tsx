import { useState } from 'react';
import type { ScheduleAlert } from '../types/dotdock';
import './schedule-alarm.css';

interface ScheduleAlarmProps {
  alert: ScheduleAlert;
  characterEffect: boolean;
  onAction: (action: 'complete' | 'dismiss' | 'snooze') => Promise<void>;
}

export function ScheduleAlarm({ alert, characterEffect, onAction }: ScheduleAlarmProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (action: 'complete' | 'dismiss' | 'snooze') => {
    setBusy(true);
    setError(null);
    try {
      await onAction(action);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '처리하지 못했습니다. 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className={`schedule-alarm ${characterEffect ? 'has-character-effect' : ''}`}
      role="status" aria-live="polite" aria-label="일정 알림" data-alert-id={alert.id}>
      <div className="schedule-alarm-heading">
        <strong>{alert.phase === 'reminder' ? '잠시 후 일정이 있어요' : alert.phase === 'snooze' ? '다시 알려드려요' : '일정 시간이에요'}</strong>
        <button type="button" className="mini-btn" aria-label="일정 알림 닫기" disabled={busy}
          onClick={() => void act('dismiss')}>✕</button>
      </div>
      <div className="schedule-alarm-title"><time dateTime={alert.startsAt}>{new Date(alert.startsAt).toLocaleTimeString('ko-KR', {
        hour: '2-digit', minute: '2-digit'
      })}</time><span>{alert.title}</span></div>
      {error && <div className="schedule-alarm-error" role="alert">{error}</div>}
      <div className="schedule-alarm-actions">
        <button type="button" className="mini-btn is-accent" disabled={busy} onClick={() => void act('complete')}>완료</button>
        <button type="button" className="mini-btn" disabled={busy} onClick={() => void act('snooze')}>5분 뒤 다시</button>
      </div>
    </aside>
  );
}
