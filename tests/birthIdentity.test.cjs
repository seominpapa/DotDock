const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadBirthIdentity, applyBirthIdentity } = require('../electron/birth-identity.cjs');

const now = new Date(2026, 10, 15);

test('old year-only and corrupt saved birthdays load without an invented birthday', () => {
  assert.deepEqual(loadBirthIdentity({ birthYear: 1996 }, now), { birthYear: 1996, birthDate: null });
  for (const birthDate of ['1996-02-30', '1997-01-01', '2026-11-16', null]) {
    assert.deepEqual(loadBirthIdentity({ birthYear: 1996, birthDate }, now), { birthYear: 1996, birthDate: null });
  }
  assert.deepEqual(loadBirthIdentity({ birthYear: 2100, birthDate: '2100-01-01' }, now), { birthYear: null, birthDate: null });
});

test('a valid birthday determines year while zodiac remains independently selected', () => {
  const current = { birthYear: 1996, birthDate: null, selectedZodiacId: 'rabbit' };
  assert.deepEqual(applyBirthIdentity(current, { birthDate: '2000-02-29' }, now), {
    birthYear: 2000, birthDate: '2000-02-29'
  });
  assert.deepEqual(current, { birthYear: 1996, birthDate: null, selectedZodiacId: 'rabbit' });
  assert.deepEqual(loadBirthIdentity({ birthYear: 2000, birthDate: '2000-02-29' }, now), {
    birthYear: 2000, birthDate: '2000-02-29'
  });
});

test('changing year clears only a mismatching date and null explicitly removes the date', () => {
  const current = { birthYear: 1996, birthDate: '1996-01-01' };
  assert.deepEqual(applyBirthIdentity(current, { memo: 'unrelated' }, now), current);
  assert.deepEqual(applyBirthIdentity(current, { birthYear: 1996 }, now), current);
  assert.deepEqual(applyBirthIdentity(current, { birthYear: 2000 }, now), { birthYear: 2000, birthDate: null });
  assert.deepEqual(applyBirthIdentity(current, { birthDate: null }, now), { birthYear: 1996, birthDate: null });
  assert.deepEqual(applyBirthIdentity(current, { birthYear: null }, now), { birthYear: null, birthDate: null });
});

test('IPC patches reject malformed, non-leap, future birthdays and invalid birth years', () => {
  const current = { birthYear: 1996, birthDate: '1996-01-01' };
  for (const birthDate of ['', '1996-2-01', '1900-02-29', '2001-02-29', '1996-13-01', '2026-11-16', 1996, false]) {
    assert.throws(() => applyBirthIdentity(current, { birthDate }, now), /생년월일/);
  }
  for (const birthYear of [1899, 2027, 1996.5, '1996', false]) {
    assert.throws(() => applyBirthIdentity(current, { birthYear }, now), /생년/);
  }
  assert.deepEqual(applyBirthIdentity(current, { birthDate: '2026-11-15' }, now), {
    birthYear: 2026, birthDate: '2026-11-15'
  });
});
