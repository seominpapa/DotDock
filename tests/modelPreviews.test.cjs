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
const { ZODIAC_LIST, getZodiacImage, getZodiacPreview } = compiled.exports;

test('3D thumbnails use twelve distinct bundled high resolution model renders', () => {
  const images = new Set();
  for (const zodiac of ZODIAC_LIST) {
    const preview = getZodiacPreview(zodiac, '3d');
    assert.equal(preview, `./model-previews/${zodiac.id}.png`);
    const png = fs.readFileSync(path.resolve(__dirname, '../public', preview));
    assert.deepEqual(png.subarray(0, 8), Buffer.from('89504e470d0a1a0a', 'hex'));
    assert.equal(png.readUInt32BE(16), 256);
    assert.equal(png.readUInt32BE(20), 256);
    assert.ok(png.length > 5_000, `${zodiac.id} preview must contain a rendered model`);
    images.add(png.toString('base64'));
    assert.equal(getZodiacPreview(zodiac, 'pixel'), getZodiacImage(zodiac, 'pixel'));
    assert.equal(getZodiacPreview(zodiac, 'vector'), getZodiacImage(zodiac, 'vector'));
    assert.equal(getZodiacPreview(zodiac, undefined), getZodiacImage(zodiac, 'vector'));
    assert.equal(getZodiacImage(zodiac, '3d'), getZodiacImage(zodiac, 'vector'), '3D failure keeps its vector fallback');
  }
  assert.equal(images.size, 12);
});
