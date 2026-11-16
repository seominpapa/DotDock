const { randomUUID } = require('node:crypto');

const DEFAULT_PREFERENCES = { character: true, screenEdge: false, notification: true, sound: false };
const REMINDERS = [0, 5, 10, 15, 30];
const validId = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
const validDate = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
const timestamp = (value) => validDate(value) ? value : null;

function validatePreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(DEFAULT_PREFERENCES).some((key) => typeof value[key] !== 'boolean')) {
    throw new Error('알림 효과는 켜짐 또는 꺼짐으로 선택해 주세요.');
  }
  return Object.fromEntries(Object.keys(DEFAULT_PREFERENCES).map((key) => [key, value[key]]));
}

function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      (input.id !== undefined && !validId(input.id)) || typeof input.title !== 'string' ||
      !input.title.trim() || input.title.trim().length > 120 || !validDate(input.startsAt) ||
      !REMINDERS.includes(input.reminderMinutes)) {
    throw new Error('일정 제목(1~120자), 날짜·시간과 알림 시간을 확인해 주세요.');
  }
  return { title: input.title.trim(), startsAt: input.startsAt, reminderMinutes: input.reminderMinutes };
}

function loadScheduleState(raw) {
  const schedules = [];
  for (const entry of (Array.isArray(raw.schedules) ? raw.schedules : []).slice(0, 500)) {
    try {
      const input = validateInput(entry);
      if (!validId(entry.id) || schedules.some((item) => item.id === entry.id)) continue;
      schedules.push({ ...input, id: entry.id, completed: entry.completed === true,
        reminderSentAt: timestamp(entry.reminderSentAt), startSentAt: timestamp(entry.startSentAt),
        snoozedUntil: timestamp(entry.snoozedUntil) });
    } catch { /* Ignore malformed entries without discarding the rest of the profile. */ }
  }
  const scheduleAlerts = [];
  for (const alert of (Array.isArray(raw.scheduleAlerts) ? raw.scheduleAlerts : []).slice(0, 500)) {
    const entry = schedules.find((item) => item.id === alert?.scheduleId && !item.completed);
    if (!entry || typeof alert.id !== 'string' || alert.id.length > 200 ||
        !['reminder', 'start', 'snooze'].includes(alert.phase) || !validDate(alert.deliveredAt) ||
        scheduleAlerts.some((item) => item.scheduleId === entry.id)) continue;
    scheduleAlerts.push({ id: alert.id, scheduleId: entry.id, title: entry.title,
      startsAt: entry.startsAt, phase: alert.phase, deliveredAt: alert.deliveredAt });
  }
  return { schedules, scheduleAlerts, alarmPreferences: Object.fromEntries(
    Object.entries(DEFAULT_PREFERENCES).map(([key, fallback]) =>
      [key, typeof raw.alarmPreferences?.[key] === 'boolean' ? raw.alarmPreferences[key] : fallback])) };
}

function saveSchedule(state, input, makeId = randomUUID) {
  const values = validateInput(input);
  const previous = input.id === undefined ? null : state.schedules.find((entry) => entry.id === input.id);
  if (input.id !== undefined && !previous) throw new Error('일정을 찾을 수 없습니다. 목록을 다시 확인해 주세요.');
  if (!previous && state.schedules.length >= 500) throw new Error('일정은 최대 500개까지 저장할 수 있습니다.');
  const sameTime = previous?.startsAt === values.startsAt && previous?.reminderMinutes === values.reminderMinutes;
  const entry = { ...values, id: previous?.id || makeId(), completed: previous?.completed || false,
    reminderSentAt: sameTime ? previous.reminderSentAt : null,
    startSentAt: sameTime ? previous.startSentAt : null, snoozedUntil: sameTime ? previous.snoozedUntil : null };
  return { ...state, schedules: previous ? state.schedules.map((item) => item.id === entry.id ? entry : item)
    : [...state.schedules, entry], scheduleAlerts: state.scheduleAlerts.flatMap((alert) =>
    alert.scheduleId !== entry.id ? [alert] : sameTime ? [{ ...alert, title: entry.title }] : []) };
}

function getEntry(state, id) {
  if (!validId(id)) throw new Error('올바른 일정 ID가 아닙니다.');
  const entry = state.schedules.find((item) => item.id === id);
  if (!entry) throw new Error('일정을 찾을 수 없습니다.');
  return entry;
}

function deleteSchedule(state, id) {
  getEntry(state, id);
  return { ...state, schedules: state.schedules.filter((entry) => entry.id !== id),
    scheduleAlerts: state.scheduleAlerts.filter((alert) => alert.scheduleId !== id) };
}

function actOnSchedule(state, id, action, now = Date.now()) {
  const entry = getEntry(state, id);
  if (!['complete', 'reopen', 'dismiss', 'snooze'].includes(action)) throw new Error('올바른 일정 동작이 아닙니다.');
  if (['snooze', 'dismiss'].includes(action) && !state.scheduleAlerts.some((alert) => alert.scheduleId === id)) {
    throw new Error('처리할 알림이 없습니다.');
  }
  const patch = action === 'complete' ? { completed: true, snoozedUntil: null }
    : action === 'reopen' ? { completed: false, reminderSentAt: null, startSentAt: null, snoozedUntil: null }
      : action === 'snooze' ? { snoozedUntil: new Date(now + 5 * 60_000).toISOString() } : {};
  return { ...state, schedules: state.schedules.map((item) => item.id === entry.id ? { ...item, ...patch } : item),
    scheduleAlerts: state.scheduleAlerts.filter((alert) => alert.scheduleId !== id) };
}

function dueTime(entry) {
  if (entry.completed) return null;
  if (entry.snoozedUntil) return Date.parse(entry.snoozedUntil);
  if (entry.startSentAt) return null;
  const start = Date.parse(entry.startsAt);
  return !entry.reminderSentAt && entry.reminderMinutes > 0 ? start - entry.reminderMinutes * 60_000 : start;
}

function collectDueAlerts(state, now = Date.now()) {
  const alerts = [];
  const at = new Date(now).toISOString();
  const schedules = state.schedules.map((entry) => {
    const due = dueTime(entry);
    if (due === null || due > now) return entry;
    const hasStarted = Date.parse(entry.startsAt) <= now;
    const phase = entry.snoozedUntil ? 'snooze' : hasStarted ? 'start' : 'reminder';
    alerts.push({ id: `${entry.id}:${phase}:${now}`, scheduleId: entry.id, title: entry.title,
      startsAt: entry.startsAt, phase, deliveredAt: at });
    return { ...entry, snoozedUntil: null, reminderSentAt: at,
      startSentAt: hasStarted ? at : entry.startSentAt };
  });
  if (!alerts.length) return { state, alerts };
  return { state: { ...state, schedules, scheduleAlerts: Object.values(state.alarmPreferences).some(Boolean) ? [
    ...state.scheduleAlerts.filter((old) => !alerts.some((alert) => alert.scheduleId === old.scheduleId)), ...alerts
  ] : [] }, alerts };
}

function nextAlarmDelay(state, now = Date.now()) {
  const times = state.schedules.map(dueTime).filter((time) => time !== null);
  return times.length ? Math.max(0, Math.min(60_000, Math.min(...times) - now)) : null;
}

module.exports = { loadScheduleState, validatePreferences, saveSchedule, deleteSchedule,
  actOnSchedule, collectDueAlerts, nextAlarmDelay };
