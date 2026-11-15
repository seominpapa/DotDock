const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { expect } = require('@playwright/test');
const { createTriangleGlb } = require('../tests/helpers/glb.cjs');

const zodiacTitles = [
  '쥐띠 (子)', '소띠 (丑)', '호랑이띠 (寅)', '토끼띠 (卯)', '용띠 (辰)', '뱀띠 (巳)',
  '말띠 (午)', '양띠 (未)', '원숭이띠 (申)', '닭띠 (酉)', '개띠 (戌)', '돼지띠 (亥)'
];

module.exports = async function verify3D({ application, page, profileDir, outputDir, report }) {
  const canvas = page.locator('.character-model-canvas');
  assert.equal(await page.evaluate(() => performance.getEntriesByType('resource')
    .some(({ name }) => /\/CharacterModel-[^/]+\.js/.test(name))), false,
  '3D renderer stays unloaded until selected');
  await expect(canvas).toHaveCount(0);
  await page.getByRole('button', { name: '3D', exact: true }).click();

  async function ready() {
    await expect(canvas).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
    await expect.poll(() => canvas.getAttribute('data-render-count'), { timeout: 15_000 })
      .not.toBe('0');
  }
  for (const scale of ['1x', '1.25x', '1.5x']) {
    await page.getByRole('button', { name: scale, exact: true }).click();
    await ready();
    await expect(page.locator('.model-error-badge')).toHaveCount(0);
  }
  report.graphics = await canvas.evaluate((element) => {
    const context = element.getContext('webgl2');
    const extension = context?.getExtension('WEBGL_debug_renderer_info');
    return { vendor: extension ? context.getParameter(extension.UNMASKED_VENDOR_WEBGL) : 'unavailable',
      renderer: extension ? context.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unavailable' };
  });
  report.graphics.mode = process.env.DOTDOCK_SMOKE_SOFTWARE_GPU === '1' ? 'forced software (SwiftShader)' : 'default';
  if (process.env.DOTDOCK_SMOKE_SOFTWARE_GPU === '1') assert.match(report.graphics.renderer, /SwiftShader/i);
  for (const title of zodiacTitles) {
    await page.getByTitle(title, { exact: true }).click();
    await ready();
    await expect(page.locator('.model-error-badge')).toHaveCount(0);
    await canvas.screenshot({ path: path.join(outputDir, `model-${zodiacTitles.indexOf(title) + 1}.png`) });
  }
  await page.getByTitle('용띠 (辰)', { exact: true }).click();
  await ready();
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
  report.checks.push('custom GLB import/render, invalid import preserves selection, missing-file 2D fallback and default restoration (file dialog stubbed)');
};
