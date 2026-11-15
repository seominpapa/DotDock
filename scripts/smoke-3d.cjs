const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { expect } = require('@playwright/test');
const { createTriangleGlb } = require('../tests/helpers/glb.cjs');

const zodiacIds = ['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'sheep', 'monkey', 'rooster', 'dog', 'pig'];
const zodiacTitles = [
  '쥐띠 (子)', '소띠 (丑)', '호랑이띠 (寅)', '토끼띠 (卯)', '용띠 (辰)', '뱀띠 (巳)',
  '말띠 (午)', '양띠 (未)', '원숭이띠 (申)', '닭띠 (酉)', '개띠 (戌)', '돼지띠 (亥)'
];

async function probeGraphics(page) {
  const graphics = await page.evaluate(() => {
    const element = document.createElement('canvas');
    const context = element.getContext('webgl2', { alpha: true, antialias: true, powerPreference: 'low-power' });
    if (!context || context.isContextLost()) return { available: false, renderer: 'WebGL2 unavailable' };
    const extension = context.getExtension('WEBGL_debug_renderer_info');
    const result = { available: true,
      vendor: extension ? context.getParameter(extension.UNMASKED_VENDOR_WEBGL) : 'unavailable',
      renderer: extension ? context.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unavailable' };
    context.getExtension('WEBGL_lose_context')?.loseContext();
    return result;
  });
  const { available } = graphics;
  assert.ok(available || (process.platform === 'darwin' && process.arch === 'x64'
    && process.env.DOTDOCK_SMOKE_ALLOW_NO_WEBGL === '1'),
    'WebGL2 unavailable: full 3D verification requires a graphics-capable runner');
  graphics.verification = available ? 'full 3D' : '2D fallback only; 3D rendering/rotation unverified';
  graphics.skipped = available ? [] : ['3D rendering', 'pointer/keyboard rotation', 'idle/hidden rendering', 'custom GLB rendering'];
  return graphics;
}

module.exports = async function verify3D({ application, page, profileDir, outputDir, report }) {
  const canvas = page.locator('.character-model-canvas');
  assert.equal(await page.evaluate(() => performance.getEntriesByType('resource')
    .some(({ name }) => /\/CharacterModel-[^/]+\.js/.test(name))), false,
  '3D renderer stays unloaded until selected');
  await expect(canvas).toHaveCount(0);
  report.graphics = await probeGraphics(page);
  const { available } = report.graphics;
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect.poll(() => page.locator('.zodiac-thumb').evaluateAll((images) =>
    images.filter((image) => /\/model-previews\/[^/]+\.png$/.test(image.src)
      && image.complete && image.naturalWidth >= 192 && image.naturalHeight >= 192).length)).toBe(12);
  await page.screenshot({ path: path.join(outputDir, 'settings-3d-previews.png') });

  async function ready() {
    if (!available) {
      await verifyFallback(page);
      return;
    }
    await expect(canvas).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
    await expect.poll(() => canvas.getAttribute('data-render-count'), { timeout: 15_000 })
      .not.toBe('0');
  }
  for (const scale of ['1x', '1.25x', '1.5x']) {
    await page.getByRole('button', { name: scale, exact: true }).click();
    await ready();
    if (available) await expect(page.locator('.model-error-badge')).toHaveCount(0);
  }
  for (const [index, title] of zodiacTitles.entries()) {
    await page.getByTitle(title, { exact: true }).click();
    await expect.poll(async () => (await page.evaluate(() => window.dotdock.getState())).selectedZodiacId)
      .toBe(zodiacIds[index]);
    if (!available) {
      const stored = await page.evaluate(async (id) => {
        const model = await window.dotdock.getCharacterModel(`zodiac:${id}`);
        return { ok: model.ok, length: model.base64?.length || 0 };
      }, zodiacIds[index]);
      assert.equal(stored.ok, true, `packaged model exists: ${zodiacIds[index]}`);
      assert.ok(stored.length > 0);
    }
    await ready();
    if (available) await expect(page.locator('.model-error-badge')).toHaveCount(0);
    if (available) await canvas.screenshot({ path: path.join(outputDir, `model-${zodiacTitles.indexOf(title) + 1}.png`) });
  }
  await page.getByTitle('용띠 (辰)', { exact: true }).click();
  await ready();
  await expect(canvas).toHaveCount(available ? 1 : 0);
  report.checks.push('12 bundled static GLB previews load in selection grid; only selected model uses a live canvas');
  for (const [button, filename] of [['도트', 'dot'], ['벡터', 'vector']]) {
    await page.getByRole('button', { name: button, exact: true }).click();
    await expect(canvas).toHaveCount(0);
    await expect.poll(() => page.locator('.sprite-img').evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
    await page.locator('.sprite-stage').screenshot({ path: path.join(outputDir, `dragon-${filename}-1.5x.png`) });
  }
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await ready();
  if (available) {
    await canvas.screenshot({ path: path.join(outputDir, 'character-3d-1.5x.png') });
    await page.waitForTimeout(500);
    const idleCount = await canvas.getAttribute('data-render-count');
    await page.waitForTimeout(1_000);
    assert.equal(await canvas.getAttribute('data-render-count'), idleCount, 'idle model does not render continuously');
    const position = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getPosition());
    const box = await canvas.boundingBox();
    assert.ok(box);
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => Number(await canvas.getAttribute('data-render-count'))).toBeGreaterThan(Number(idleCount));
    assert.deepEqual(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getPosition()), position,
      'rotating the model does not drag the application');
    const afterDrag = Number(await canvas.getAttribute('data-render-count'));
    await canvas.focus();
    await canvas.press('ArrowLeft');
    await expect.poll(async () => Number(await canvas.getAttribute('data-render-count'))).toBeGreaterThan(afterDrag);
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
    await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false);
    await expect(canvas).toHaveAttribute('data-window-visible', 'false');
    const hiddenCount = await canvas.getAttribute('data-render-count');
    await canvas.dispatchEvent('keydown', { key: 'ArrowRight' });
    await page.waitForTimeout(250);
    await expect(canvas).toHaveAttribute('data-window-visible', 'false');
    assert.equal(await canvas.getAttribute('data-render-count'), hiddenCount, 'hidden model does not render');
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
    await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
    await expect(canvas).toHaveAttribute('data-window-visible', 'true');
    await expect.poll(async () => Number(await canvas.getAttribute('data-render-count'))).toBeGreaterThan(Number(hiddenCount));
    report.checks.push('12 bundled GLBs render at 1.5x; pointer/keyboard rotation, lazy loading, idle and hidden render pause');
  } else {
    report.checks.push('WebGL unavailable: all 12 packaged GLBs load; selections and scales recover to visible 2D; 3D remains optional');
  }

  const fixture = path.join(profileDir, 'fixture.glb');
  fs.writeFileSync(fixture, createTriangleGlb());
  async function chooseFile(file) {
    await application.evaluate(({ dialog }, selectedFile) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedFile] });
    }, file);
    await page.getByRole('button', { name: 'GLB 가져오기', exact: true }).click();
  }
  await chooseFile(fixture);
  await expect.poll(async () => (await page.evaluate(() => window.dotdock.getState())).customModelId)
    .toMatch(/^[a-f0-9-]{36}$/);
  const importedId = (await page.evaluate(() => window.dotdock.getState())).customModelId;
  await ready();
  const invalidFixture = path.join(profileDir, 'invalid.glb');
  fs.writeFileSync(invalidFixture, 'invalid GLB');
  await chooseFile(invalidFixture);
  await expect(page.locator('.sync-banner[role="status"]')).toContainText('GLB');
  assert.equal((await page.evaluate(() => window.dotdock.getState())).customModelId, importedId,
    'invalid import preserves the selected model');

  fs.unlinkSync(path.join(profileDir, 'models', `${importedId}.glb`));
  await page.getByRole('button', { name: '벡터', exact: true }).click();
  await expect(canvas).toHaveCount(0);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.locator('.model-error-badge')).toBeVisible();
  await expect(page.locator('.sprite-img')).toBeVisible();
  await page.getByRole('button', { name: '기본 12지신 사용', exact: true }).click();
  await ready();
  assert.equal((await page.evaluate(() => window.dotdock.getState())).customModelId, null);
  await page.getByTitle('토끼띠 (卯)', { exact: true }).click();
  await ready();
  await page.getByRole('button', { name: '벡터', exact: true }).click();
  await expect(canvas).toHaveCount(0);
  report.checks.push(available
    ? 'custom GLB import/render, invalid import preserves selection, missing-file 2D fallback and default restoration (file dialog stubbed)'
    : 'custom GLB import persists, invalid import preserves selection, default restores; no-WebGL fallback visible (file dialog stubbed; GLB rendering unverified)');
};

async function verifyFallback(page) {
  await expect(page.locator('.model-error-badge')).toBeVisible();
  await expect(page.locator('.sprite-img')).toBeVisible();
  await expect.poll(() => page.locator('.sprite-img').evaluate((image) =>
    image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(page.locator('.character-model-canvas')).toHaveCount(0);
  assert.equal((await page.evaluate(() => window.dotdock.getState())).characterStyle, '3d');
}

module.exports.probeGraphics = probeGraphics;
module.exports.verifyFallback = verifyFallback;
