import type { DotDockState } from '../types/dotdock';

export function getLocalDateString(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function parseBirthDate(value: unknown, now = new Date()): { year: number; month: number; day: number } | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (year < 1900 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  if (value > getLocalDateString(now)) return null;
  return { year, month, day };
}

export function getInternationalAge(birthDate: unknown, now = new Date()): number | null {
  const birth = parseBirthDate(birthDate, now);
  if (!birth) return null;
  const birthdayAhead = now.getMonth() + 1 < birth.month
    || (now.getMonth() + 1 === birth.month && now.getDate() < birth.day);
  return now.getFullYear() - birth.year - (birthdayAhead ? 1 : 0);
}

export function getDisplayAge(birthDate: unknown, now = new Date()): number | null {
  const age = getInternationalAge(birthDate, now);
  return age === null ? null : Math.round(age * 0.8);
}

export function formatCompanionLabel(
  state: Pick<DotDockState, 'birthYear' | 'birthDate'>,
  zodiacLabel: string,
  now = new Date()
): string {
  if (!state.birthYear) return zodiacLabel;
  const birth = parseBirthDate(state.birthDate, now);
  const age = birth?.year === state.birthYear ? getDisplayAge(state.birthDate, now) : null;
  const year = String(state.birthYear % 100).padStart(2, '0');
  return `${year}년생 ${zodiacLabel}${age === null ? '' : `(${age}세)`}`;
}
