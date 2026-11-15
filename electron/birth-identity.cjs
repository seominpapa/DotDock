function parseBirthDate(value, now) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (year < 1900 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return value <= today ? { year } : null;
}

function isValidYear(value, now) {
  return Number.isInteger(value) && value >= 1900 && value <= now.getFullYear();
}

function loadBirthIdentity(saved, now = new Date()) {
  const birthYear = isValidYear(saved.birthYear, now) ? saved.birthYear : null;
  const birthDate = parseBirthDate(saved.birthDate, now)?.year === birthYear ? saved.birthDate : null;
  return { birthYear, birthDate };
}

function applyBirthIdentity(current, patch, now = new Date()) {
  const birth = parseBirthDate(patch.birthDate, now);
  if (patch.birthDate !== undefined && patch.birthDate !== null && !birth) {
    throw new Error('오늘까지의 올바른 생년월일을 입력해 주세요.');
  }
  if (patch.birthYear !== undefined && patch.birthYear !== null && !isValidYear(patch.birthYear, now)) {
    throw new Error('1900년부터 올해까지의 생년을 입력해 주세요.');
  }
  const birthYear = birth?.year ?? (patch.birthYear === undefined ? current.birthYear : patch.birthYear);
  const requestedDate = patch.birthDate === undefined ? current.birthDate : patch.birthDate;
  const birthDate = parseBirthDate(requestedDate, now)?.year === birthYear ? requestedDate : null;
  return { birthYear, birthDate };
}

module.exports = { loadBirthIdentity, applyBirthIdentity };
