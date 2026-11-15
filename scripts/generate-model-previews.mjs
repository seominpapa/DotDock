import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));
const threeDir = path.join(root, 'node_modules/three');
const outputDir = path.join(root, 'public/model-previews');
const ids = ['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake',
  'horse', 'sheep', 'monkey', 'rooster', 'dog', 'pig'];
const html = `<!doctype html><meta charset="utf-8"><title>DotDock model previews</title>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js"}}</script>
<script type="module">
import { AmbientLight, Box3, DirectionalLight, Group, LoadingManager,
  PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from 'three';
import { GLTFLoader } from '/three/examples/jsm/loaders/GLTFLoader.js';
const renderer = new WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(1);
renderer.setSize(256,256);
renderer.setClearColor(0x000000,0);
renderer.outputColorSpace = SRGBColorSpace;
document.body.append(renderer.domElement);
window.renderPreview = async (id) => {
  const response = await fetch('/models/' + id + '.glb');
  if (!response.ok) throw new Error('Bundled GLB is missing: ' + id);
  const manager = new LoadingManager();
  manager.setURLModifier(url => {
    if (!url.startsWith('blob:')) throw new Error('Only embedded GLB textures are supported');
    return url;
  });
  const gltf = await new GLTFLoader(manager).parseAsync(await response.arrayBuffer(), '');
  const bounds = new Box3().setFromObject(gltf.scene);
  const dimensions = bounds.getSize(new Vector3());
  const extent = Math.max(dimensions.x, dimensions.y, dimensions.z);
  if (!Number.isFinite(extent) || extent <= 0) throw new Error('Invalid model bounds: ' + id);
  gltf.scene.position.sub(bounds.getCenter(new Vector3()));
  const normalized = new Group();
  normalized.add(gltf.scene);
  normalized.scale.setScalar(1.7 / extent);
  // Match CharacterModel lighting, with a slight turn and margin for a static thumbnail.
  normalized.rotation.y = -Math.PI / 2 + 0.35;
  const scene = new Scene();
  scene.add(normalized, new AmbientLight(0xffffff, 2));
  const key = new DirectionalLight(0xffffff, 3);
  key.position.set(3,4,5);
  scene.add(key);
  const camera = new PerspectiveCamera(35,1,0.05,100);
  camera.position.set(0,0.15,3.8);
  camera.lookAt(0,0,0);
  await renderer.compileAsync(scene,camera);
  renderer.render(scene,camera);
  const context = renderer.getContext();
  const pixels = new Uint8Array(256 * 256 * 4);
  context.readPixels(0,0,256,256,context.RGBA,context.UNSIGNED_BYTE,pixels);
  let filled = 0;
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    if (!pixels[(y * 256 + x) * 4 + 3]) continue;
    filled++;
    if (x < 6 || y < 6 || x >= 250 || y >= 250) throw new Error('Preview is cropped: ' + id);
  }
  if (filled < 5_000) throw new Error('Preview is empty: ' + id);
  const png = renderer.domElement.toDataURL('image/png').split(',')[1];
  const geometries = new Set(), materials = new Set(), textures = new Set();
  for (const model of gltf.scenes) model.traverse(object => {
    if (!object.isMesh) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  geometries.forEach(value => value.dispose());
  materials.forEach(value => value.dispose());
  textures.forEach(value => { value.source.data?.close?.(); value.dispose(); });
  scene.clear();
  renderer.renderLists.dispose();
  return png;
};
</script>`;

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(html);
    return;
  }
  let filename;
  if (pathname.startsWith('/three/')) {
    const target = path.resolve(threeDir, pathname.slice('/three/'.length));
    if (target.startsWith(threeDir + path.sep) && target.endsWith('.js')) filename = target;
  } else if (ids.some(id => pathname === '/models/' + id + '.glb')) {
    filename = path.join(root, 'public', pathname);
  }
  if (!filename || !fs.existsSync(filename)) { response.writeHead(404).end(); return; }
  response.writeHead(200, { 'Content-Type': filename.endsWith('.js') ? 'text/javascript' : 'model/gltf-binary' });
  fs.createReadStream(filename).on('error', () => response.destroy()).pipe(response);
});

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dotdock-model-previews-'));
let application;
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const main = path.join(temporary, 'main.cjs');
  fs.writeFileSync(main, `const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(path.join(temporary, 'profile'))});
app.whenReady().then(()=>new BrowserWindow({show:false}).loadURL('http://127.0.0.1:${address.port}'));`);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({ args: [main], env });
  const page = await application.firstWindow();
  await page.waitForFunction(() => typeof window.renderPreview === 'function');
  fs.mkdirSync(outputDir, { recursive: true });
  for (const id of ids) {
    const png = Buffer.from(await page.evaluate(id => window.renderPreview(id), id), 'base64');
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), 256);
    assert.equal(png.readUInt32BE(20), 256);
    assert.ok(png.length > 5_000, 'Preview must contain a rendered model');
    fs.writeFileSync(path.join(outputDir, id + '.png'), png);
    console.log(id + ': ' + png.length + ' bytes');
  }
} finally {
  await application?.close();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(temporary, { recursive: true, force: true });
}
