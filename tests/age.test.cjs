const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../src/services/age.ts');
const compiled = new Module(filename, module);
compiled.filename = filename;
compiled.paths = module.paths;
compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, filename);
const { parseBirthDate, getInternationalAge, getDisplayAge, formatCompanionLabel, getLocalDateString } = compiled.exports;

test('birthday before/on/after changes complete-year age and rounds the 0.8 display age', () => {
  assert.equal(getInternationalAge('1996-11-15', new Date(2026, 10, 14, 23, 59)), 29);
  assert.equal(getInternationalAge('1996-11-15', new Date(2026, 10, 15, 0, 0)), 30);
  assert.equal(getInternationalAge('1996-11-15', new Date(2026, 10, 16)), 30);
  assert.equal(getDisplayAge('1996-11-15', new Date(2026, 10, 14)), 23);
  assert.equal(getDisplayAge('1996-11-15', new Date(2026, 10, 15)), 24);
  assert.equal(getDisplayAge('1995-01-01', new Date(2026, 10, 15)), 25);
});

test('validates strict ISO dates, leap years, future dates and missing values', () => {
  const now = new Date(2026, 10, 15);
  assert.deepEqual(parseBirthDate('2000-02-29', now), { year: 2000, month: 2, day: 29 });
  assert.deepEqual(parseBirthDate('2026-11-15', now), { year: 2026, month: 11, day: 15 });
  for (const value of [undefined, null, '', 1996, '96-11-15', '1996-1-15', '1996-11-31',
    '1900-02-29', '2001-02-29', '1996-00-01', '1996-13-01', '1899-12-31', '2026-11-16', '2100-01-01']) {
    assert.equal(parseBirthDate(value, now), null, String(value));
    assert.equal(getDisplayAge(value, now), null, String(value));
  }
  assert.equal(getInternationalAge('2026-11-15', now), 0);
});

test('February 29 birthdays complete their year on March 1 in a non-leap year', () => {
  assert.equal(getInternationalAge('2000-02-29', new Date(2025, 1, 28)), 24);
  assert.equal(getInternationalAge('2000-02-29', new Date(2025, 2, 1)), 25);
  assert.equal(getInternationalAge('2000-02-29', new Date(2024, 1, 29)), 24);
});

test('label uses two-digit birth year, selected zodiac, and transformed age without extra spaces', () => {
  const now = new Date(2026, 10, 15);
  assert.equal(formatCompanionLabel({ birthYear: 1996, birthDate: '1996-01-01' }, '쥐띠', now), '96년생 쥐띠(24세)');
  assert.equal(formatCompanionLabel({ birthYear: 2004, birthDate: '2004-12-01' }, '원숭이띠', now), '04년생 원숭이띠(17세)');
  assert.equal(formatCompanionLabel({ birthYear: 1996, birthDate: '1996-01-01' }, '토끼띠', now), '96년생 토끼띠(24세)');
});

test('legacy year-only profiles and mismatched/invalid dates never invent an exact age', () => {
  const now = new Date(2026, 10, 15);
  assert.equal(formatCompanionLabel({ birthYear: 1996 }, '쥐띠', now), '96년생 쥐띠');
  assert.equal(formatCompanionLabel({ birthYear: 1996, birthDate: '1997-01-01' }, '쥐띠', now), '96년생 쥐띠');
  assert.equal(formatCompanionLabel({ birthYear: null }, '용띠', now), '용띠');
  assert.equal(formatCompanionLabel({ birthYear: 1996, birthDate: '1996-02-30' }, '쥐띠', now), '96년생 쥐띠');
});

test('date input bounds use local calendar fields instead of UTC conversion', () => {
  assert.equal(getLocalDateString(new Date(2026, 0, 2, 0, 1)), '2026-01-02');
  assert.equal(getLocalDateString(new Date(2026, 10, 15, 23, 59)), '2026-11-15');
});
