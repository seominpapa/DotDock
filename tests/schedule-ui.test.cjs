const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../src/services/schedules.ts');
const compiled = new Module(filename, module);
compiled.filename = filename;
compiled.paths = module.paths;
compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, filename);
const { buildScheduleInput, toLocalScheduleInput } = compiled.exports;

test('schedule editor converts local calendar time to ISO and round-trips edit values', () => {
  const expected = new Date(2026, 10, 16, 14, 30).toISOString();
  assert.deepEqual(buildScheduleInput({ title: '  현장 회의  ', date: '2026-11-16', time: '14:30', reminderMinutes: 5 }),
    { title: '현장 회의', startsAt: expected, reminderMinutes: 5 });
  assert.deepEqual(toLocalScheduleInput(expected), { date: '2026-11-16', time: '14:30' });
  assert.equal(buildScheduleInput({ id: 'kept', title: '회의', date: '2026-11-16', time: '14:30', reminderMinutes: 0 }).id, 'kept');
});

test('schedule editor rejects empty/long titles, malformed calendar times and unsupported reminders', () => {
  const valid = { title: '회의', date: '2026-11-16', time: '14:30', reminderMinutes: 5 };
  for (const title of ['', '   ', 'a'.repeat(121)]) assert.throws(() => buildScheduleInput({ ...valid, title }), /제목/);
  for (const date of ['', '2026-2-03', '2026-02-30', '2026-13-01', '0000-01-01']) {
    assert.throws(() => buildScheduleInput({ ...valid, date }), /날짜/);
  }
  for (const time of ['', '4:30', '24:00', '12:60']) assert.throws(() => buildScheduleInput({ ...valid, time }), /시간/);
  assert.throws(() => buildScheduleInput({ ...valid, reminderMinutes: 2 }), /미리 알림/);
  assert.throws(() => toLocalScheduleInput('invalid'), /시간/);
});
