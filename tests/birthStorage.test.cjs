const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function loadTypeScript(relative) {
  const filename = path.resolve(__dirname, relative);
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = module.paths;
  compiled.require = (request) => request === './age' ? loadTypeScript('../src/services/age.ts') : require(request);
  compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename);
  return compiled.exports;
}
const { loadDotDockState, saveDotDockState } = loadTypeScript('../src/services/storage.ts');
const key = 'dotdock-web-fallback-state';
let saved;
beforeEach(() => {
  saved = new Map();
  global.window = {};
  global.localStorage = { getItem: (name) => saved.get(name) ?? null,
    setItem: (name, value) => saved.set(name, value) };
});

test('browser fallback loads legacy year-only profiles and drops invalid persisted identities', async () => {
  localStorage.setItem(key, JSON.stringify({ birthYear: 1996 }));
  assert.equal((await loadDotDockState()).birthDate, null);
  localStorage.setItem(key, JSON.stringify({ birthYear: 2999, birthDate: '2999-01-01' }));
  const state = await loadDotDockState();
  assert.equal(state.birthYear, null);
  assert.equal(state.birthDate, null);
});

test('browser fallback derives birth year, preserves manual zodiac and clears mismatching date', async () => {
  const created = await saveDotDockState({ birthDate: '1996-01-01', selectedZodiacId: 'rabbit' });
  assert.equal(created.birthYear, 1996);
  assert.equal(created.birthDate, '1996-01-01');
  assert.equal((await saveDotDockState({ memo: 'unchanged birthday' })).birthDate, '1996-01-01');
  const changed = await saveDotDockState({ birthYear: 2000 });
  assert.equal(changed.birthDate, null);
  assert.equal(changed.selectedZodiacId, 'rabbit');
  assert.equal(created.birthDate, '1996-01-01');
});

test('browser fallback rejects malformed/future dates and bad years without replacing saved state', async () => {
  await saveDotDockState({ birthDate: '1996-01-01' });
  const before = localStorage.getItem(key);
  for (const birthDate of ['', false, '1996-02-30', '2999-01-01']) {
    await assert.rejects(saveDotDockState({ birthDate }), /생년월일/);
  }
  for (const birthYear of ['1996', 2999, 1899, 1996.5]) {
    await assert.rejects(saveDotDockState({ birthYear }), /생년/);
  }
  assert.equal(localStorage.getItem(key), before);
  assert.equal((await saveDotDockState({ birthDate: null })).birthDate, null);
});
