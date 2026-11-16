interface ScheduleEditorInput {
  id?: string;
  title: string;
  date: string;
  time: string;
  reminderMinutes: number;
}

export function buildScheduleInput(input: ScheduleEditorInput) {
  const title = input.title.trim();
  if (!title || title.length > 120) throw new Error('일정 제목을 1~120자로 입력해 주세요.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('날짜를 확인해 주세요.');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) throw new Error('시간을 확인해 주세요.');
  const [year, month, day] = input.date.split('-').map(Number);
  const [hour, minute] = input.time.split(':').map(Number);
  const date = new Date(year, month - 1, day, hour, minute);
  if (year < 1900 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error('날짜를 확인해 주세요.');
  }
  if (date.getHours() !== hour || date.getMinutes() !== minute) throw new Error('이 지역에서 사용할 수 없는 시간입니다.');
  if (![0, 5, 10, 15, 30].includes(input.reminderMinutes)) throw new Error('미리 알림 시간을 확인해 주세요.');
  return { ...(input.id ? { id: input.id } : {}), title, startsAt: date.toISOString(), reminderMinutes: input.reminderMinutes };
}

export function toLocalScheduleInput(startsAt: string): { date: string; time: string } {
  const date = new Date(startsAt);
  if (!Number.isFinite(date.getTime())) throw new Error('일정 시간을 확인해 주세요.');
  const pad = (value: number) => String(value).padStart(2, '0');
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`
  };
}
