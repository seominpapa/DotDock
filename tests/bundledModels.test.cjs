const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { validateGlb } = require('../electron/character-models.cjs');

test('all 12 bundled zodiac models are unique and satisfy the native import limits', () => {
  const names = ['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'sheep', 'monkey', 'rooster', 'dog', 'pig'];
  const directory = path.resolve(__dirname, '../public/models');
  assert.deepEqual(fs.readdirSync(directory).sort(), names.map((name) => `${name}.glb`).sort());
  const hashes = names.map((name) => {
    const bytes = fs.readFileSync(path.join(directory, `${name}.glb`));
    assert.ok(validateGlb(bytes).triangles > 0, name);
    return createHash('sha256').update(bytes).digest('hex');
  });
  assert.equal(new Set(hashes).size, 12);
});
