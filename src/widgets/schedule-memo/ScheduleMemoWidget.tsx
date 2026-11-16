import { useState } from 'react';
import type { AlarmPreferences, ScheduleEntry, WidgetContext } from '../../types/dotdock';
import { getLocalDateString } from '../../services/age';
import { buildScheduleInput, toLocalScheduleInput } from '../../services/schedules';
import './schedule.css';

const EFFECTS: Array<{ key: keyof AlarmPreferences; label: string; description: string }> = [
  { key: 'character', label: '캐릭터 빛 효과 · 말풍선', description: '캐릭터 옆에 일정 알림을 표시해요.' },
  { key: 'screenEdge', label: '화면 테두리 효과', description: '화면 가장자리에 잠깐 은은한 빛이 흘러요.' },
  { key: 'notification', label: '시스템 알림', description: 'macOS·Windows 알림으로 알려드려요. OS의 알림 허용이 필요할 수 있어요.' },
  { key: 'sound', label: '알림 소리', description: '일정 시간이 되면 짧은 소리를 재생해요.' }
];

export function ScheduleMemoWidget({
  state, updateState, saveSchedule, deleteSchedule, actOnSchedule, previewAlarm
}: WidgetContext) {
  const [date, setDate] = useState(() => getLocalDateString());
  const [time, setTime] = useState(() => toLocalScheduleInput(new Date().toISOString()).time);
  const [title, setTitle] = useState('');
  const [reminderMinutes, setReminderMinutes] = useState(5);
  const [editingId, setEditingId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const schedules = (state.schedules || []).filter((entry) => toLocalScheduleInput(entry.startsAt).date === date)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const preferences = state.alarmPreferences;
  const hasEffect = Object.values(preferences).some(Boolean);

  const runAction = async (action: () => Promise<void>, success?: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      if (success) setMessage(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '저장하지 못했습니다. 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  const editSchedule = (entry: ScheduleEntry) => {
    const local = toLocalScheduleInput(entry.startsAt);
    setEditingId(entry.id);
    setTitle(entry.title);
    setDate(local.date);
    setTime(local.time);
    setReminderMinutes(entry.reminderMinutes);
    setError(null);
    setMessage(null);
  };

  const cancelEdit = () => {
    setEditingId(undefined);
    setTitle('');
  };

  return (
    <div className="widget-stack schedule-widget">
      {error && <div className="schedule-error" role="alert">{error}</div>}
      {message && <div className="sync-banner" role="status">{message}</div>}

      <section className="provider-card">
        <div className="provider-header">
          <strong className="provider-name">{editingId ? '일정 수정' : '일정 추가'}</strong>
          <span className="provider-sub">내 컴퓨터에 저장</span>
        </div>
        <form className="schedule-form" onSubmit={(event) => {
          event.preventDefault();
          void runAction(async () => {
            if (!saveSchedule) throw new Error('일정 저장 기능을 사용할 수 없습니다.');
            await saveSchedule(buildScheduleInput({ id: editingId, title, date, time, reminderMinutes }));
            cancelEdit();
          }, editingId ? '일정을 수정했습니다.' : '일정을 추가했습니다.');
        }}>
          <label className="schedule-field">일정 제목
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120}
              placeholder="예: 현장 회의" required disabled={busy} />
          </label>
          <div className="schedule-time-row">
            <label className="schedule-field">일정 날짜
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required disabled={busy} />
            </label>
            <label className="schedule-field">일정 시간
              <input type="time" value={time} onChange={(event) => setTime(event.target.value)} required disabled={busy} />
            </label>
          </div>
          <div className="schedule-submit-row">
            <label className="schedule-field">미리 알림
              <select aria-label="미리 알림" value={reminderMinutes} onChange={(event) => setReminderMinutes(Number(event.target.value))} disabled={busy}>
                {[0, 5, 10, 15, 30].map((minutes) => <option key={minutes} value={minutes}>
                  {minutes === 0 ? '정시에만' : `${minutes}분 전 + 정시`}
                </option>)}
              </select>
            </label>
            <div className="toolbar-actions">
              {editingId && <button type="button" className="mini-btn" disabled={busy} onClick={cancelEdit}>취소</button>}
              <button type="submit" className="mini-btn is-accent" disabled={busy || !saveSchedule}>
                {busy ? '처리 중…' : editingId ? '수정 저장' : '일정 추가'}
              </button>
            </div>
          </div>
        </form>
      </section>

      <section className="provider-card">
        <div className="provider-header">
          <strong className="provider-name">{date === getLocalDateString() ? '오늘 일정' : `${date} 일정`}</strong>
          <button type="button" className="mini-btn schedule-today" disabled={busy}
            onClick={() => { setDate(getLocalDateString()); cancelEdit(); }}>오늘</button>
        </div>
        {schedules.length === 0 && <p className="quota-reset-text">선택한 날짜에 등록된 일정이 없습니다.</p>}
        <ul className="schedule-list" aria-label="선택한 날짜의 일정">
          {schedules.map((entry) => (
            <li key={entry.id} className={`schedule-item ${entry.completed ? 'is-complete' : ''}`}>
              <label className="schedule-complete-label">
                <input type="checkbox" checked={entry.completed} disabled={busy || !actOnSchedule}
                  aria-label={`${entry.title} 완료`}
                  onChange={() => void runAction(async () => {
                    await actOnSchedule?.(entry.id, entry.completed ? 'reopen' : 'complete');
                  })} />
                <span className="schedule-item-copy"><time dateTime={entry.startsAt}>{toLocalScheduleInput(entry.startsAt).time}</time>
                  <span className="schedule-item-title">{entry.title}</span>
                  <small>{entry.completed ? '완료' : entry.snoozedUntil
                    ? `${new Date(entry.snoozedUntil).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 다시 알림`
                    : entry.reminderMinutes ? `${entry.reminderMinutes}분 전 · 정시 알림` : '정시 알림'}</small>
                </span>
              </label>
              <div className="toolbar-actions">
                <button type="button" className="mini-btn" disabled={busy} onClick={() => editSchedule(entry)}
                  aria-label={`${entry.title} 수정`}>수정</button>
                <button type="button" className="mini-btn is-danger-btn" disabled={busy || !deleteSchedule}
                  aria-label={`${entry.title} 삭제`} onClick={() => void runAction(async () => {
                    await deleteSchedule?.(entry.id);
                    if (editingId === entry.id) cancelEdit();
                  }, '일정을 삭제했습니다.')}>삭제</button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="provider-card">
        <div className="provider-header"><strong className="provider-name">알림 효과 선택</strong></div>
        {EFFECTS.map(({ key, label, description }) => (
          <label key={key} className="schedule-effect-option">
            <input type="checkbox" checked={preferences[key]} disabled={busy}
              onChange={() => void runAction(() => updateState({
                alarmPreferences: { ...preferences, [key]: !preferences[key] }
              }))} />
            <span><strong>{label}</strong><small>{description}</small></span>
          </label>
        ))}
        {!hasEffect && <p className="quota-reset-text">모든 알림 효과가 꺼져 있습니다. 알림 팝업도 표시하지 않습니다.</p>}
        <button type="button" className="mini-btn" disabled={busy || !previewAlarm || !hasEffect}
          onClick={() => void runAction(async () => { await previewAlarm?.(); }, '선택한 효과를 미리 보여드렸어요.')}>
          선택한 효과 미리보기
        </button>
        <p className="quota-reset-text schedule-note">DotDock이 실행 중일 때 알립니다. 트레이에 숨겨도 동작하며, 완전히 종료하면 알림을 보낼 수 없습니다. 시스템 알림은 OS 알림 설정의 영향을 받습니다.</p>
      </section>

      <section className="provider-card">
        <div className="provider-header"><strong className="provider-name">빠른 메모</strong><span className="provider-sub">자동 저장</span></div>
        <textarea className="memo-textarea" value={state.memo} rows={4} aria-label="빠른 메모"
          placeholder="짧은 메모를 적어두세요. 시간 알림은 위 일정에 등록해 주세요."
          onChange={(event) => {
            void updateState({ memo: event.target.value }).catch((cause: unknown) => {
              setError(cause instanceof Error ? cause.message : '메모를 저장하지 못했습니다.');
            });
          }} />
      </section>
    </div>
  );
}
