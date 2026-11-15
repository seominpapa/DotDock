const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { validateGlb } = require('../electron/character-models.cjs');

test('all 12 bundled zodiac models are unique and satisfy the native import limits', () => {
  const names = ['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'sheep', 'monkey', 'rooster', 'dog', 'pig'];
  const directory = path.resolve(__dirname, '../public/models');
  assert.deepEqual(fs.readdirSync(directory).filter((name) => name.endsWith('.glb')).sort(), names.map((name) => `${name}.glb`).sort());
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, require('../package.json').version);
  assert.deepEqual(Object.keys(manifest.models).sort(), [...names].sort());
  const hashes = names.map((name) => {
    const bytes = fs.readFileSync(path.join(directory, `${name}.glb`));
    assert.ok(validateGlb(bytes).triangles > 0, name);
    const hash = createHash('sha256').update(bytes).digest('hex');
    assert.deepEqual(manifest.models[name], { file: `${name}.glb`, bytes: bytes.length, sha256: hash });
    return hash;
  });
  assert.equal(new Set(hashes).size, 12);
});
