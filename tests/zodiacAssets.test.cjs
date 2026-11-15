const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const source = path.resolve(__dirname, '../src/services/zodiac.ts');
require.extensions['.svg'] = (assetModule, filename) => { assetModule.exports = { default: filename }; };
const compiled = new Module(source, module);
compiled.filename = source;
compiled.paths = module.paths;
compiled._compile(ts.transpileModule(fs.readFileSync(source, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, source);
const { ZODIAC_LIST, getZodiacImage } = compiled.exports;

test('all twelve zodiac characters have distinct smooth and pixel vector assets', () => {
  assert.deepEqual(ZODIAC_LIST.map((zodiac) => zodiac.id), [
    'rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake',
    'horse', 'sheep', 'monkey', 'rooster', 'dog', 'pig'
  ]);
  const originals = new Set();
  const pixels = new Set();
  for (const zodiac of ZODIAC_LIST) {
    const smooth = fs.readFileSync(getZodiacImage(zodiac, 'vector'), 'utf8');
    const pixel = fs.readFileSync(getZodiacImage(zodiac, 'pixel'), 'utf8');
    assert.match(smooth, /viewBox="0 0 256 256"/);
    assert.match(pixel, /viewBox="0 0 64 64"/);
    assert.match(pixel, /shape-rendering="crispEdges"/);
    const cells = new Map();
    for (const path of pixel.matchAll(/<path fill="(#[a-f0-9]{6})" d="([^"]+)"/g)) {
      for (const cell of path[2].matchAll(/M(\d+) (\d+)h1v1h-1Z/g)) {
        const x = Number(cell[1]);
        const y = Number(cell[2]);
        assert.ok(x < 64 && y < 64);
        cells.set(`${x},${y}`, path[1]);
      }
    }
    assert.ok(cells.size > 900, `${zodiac.id} has a detailed 64px drawing`);
    let detailedBlocks = 0;
    for (let y = 0; y < 64; y += 4) for (let x = 0; x < 64; x += 4) {
      const colors = new Set();
      for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) {
        colors.add(cells.get(`${x + dx},${y + dy}`) || 'transparent');
      }
      if (colors.size > 1) detailedBlocks++;
    }
    assert.ok(detailedBlocks > 60, `${zodiac.id} adds detail beyond a scaled 16px grid`);
    for (const svg of [smooth, pixel]) {
      assert.match(svg, /<path/);
      assert.ok(svg.includes(zodiac.koreanName));
      assert.doesNotMatch(svg, /<image|<script|data:image|https?:\/\/(?!www\.w3\.org)/);
    }
    assert.equal(getZodiacImage(zodiac, undefined), getZodiacImage(zodiac, 'vector'));
    originals.add(smooth);
    pixels.add(pixel);
  }
  assert.equal(originals.size, 12);
  assert.equal(pixels.size, 12);
});
