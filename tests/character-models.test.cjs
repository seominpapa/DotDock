const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateGlb, createCharacterModelStore, registerCharacterModelIpc, MAX_MODEL_BYTES } = require('../electron/character-models.cjs');
const { createGlb, createTriangleGlb, triangleDocument, triangleBinary } = require('./helpers/glb.cjs');

test('accepts a self contained GLB2 triangle', () => {
  assert.equal(validateGlb(createTriangleGlb()).triangles, 1);
});

test('rejects malformed GLB headers, chunks and JSON', () => {
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(20), createTriangleGlb().subarray(0, 30)]) {
    assert.throws(() => validateGlb(bytes));
  }
  const wrongVersion = createTriangleGlb();
  wrongVersion.writeUInt32LE(1, 4);
  assert.throws(() => validateGlb(wrongVersion), /GLB/);
  const wrongLength = createTriangleGlb();
  wrongLength.writeUInt32LE(99, 8);
  assert.throws(() => validateGlb(wrongLength), /길이/);
  const invalidJson = createTriangleGlb();
  invalidJson[20] = 0;
  assert.throws(() => validateGlb(invalidJson), /JSON/);
  assert.throws(() => validateGlb(Buffer.alloc(MAX_MODEL_BYTES + 1)), /10/);
});

test('rejects external and data URIs and decoder-dependent models', () => {
  for (const uri of ['https://example.com/file.bin', 'file:///etc/passwd', 'data:application/octet-stream;base64,AAAA']) {
    const json = triangleDocument();
    json.buffers[0].uri = uri;
    assert.throws(() => validateGlb(createGlb(json, triangleBinary())), /내장/);
    const imageJson = triangleDocument();
    imageJson.images = [{ uri }];
    assert.throws(() => validateGlb(createGlb(imageJson, triangleBinary())), /내장/);
  }
  for (const name of ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu']) {
    const json = triangleDocument();
    json.extensionsUsed = [name];
    assert.throws(() => validateGlb(createGlb(json, triangleBinary())), /압축/);
  }
});

test('rejects geometry above budget, invalid accessors and unsupported primitives', () => {
  const excessive = triangleDocument();
  excessive.accessors[0].count = 60003;
  assert.throws(() => validateGlb(createGlb(excessive, triangleBinary())), /삼각형|정점/);
  const invalidAccessor = triangleDocument();
  invalidAccessor.meshes[0].primitives[0].attributes.POSITION = 100;
  assert.throws(() => validateGlb(createGlb(invalidAccessor, triangleBinary())), /접근자/);
  const lines = triangleDocument();
  lines.meshes[0].primitives[0].mode = 1;
  assert.throws(() => validateGlb(createGlb(lines, triangleBinary())), /삼각형/);
  const outOfBounds = triangleDocument();
  outOfBounds.bufferViews[0].byteLength = 40;
  assert.throws(() => validateGlb(createGlb(outOfBounds, triangleBinary())), /범위/);
});

test('rejects cycles, instancing extensions and excessive node counts', () => {
  const cyclic = triangleDocument();
  cyclic.nodes[0].children = [0];
  assert.throws(() => validateGlb(createGlb(cyclic, triangleBinary())), /순환/);
  const instanced = triangleDocument();
  instanced.extensionsUsed = ['EXT_mesh_gpu_instancing'];
  assert.throws(() => validateGlb(createGlb(instanced, triangleBinary())), /인스턴스/);
  const excessive = triangleDocument();
  excessive.nodes = Array.from({ length: 257 }, () => ({ mesh: 0 }));
  assert.throws(() => validateGlb(createGlb(excessive, triangleBinary())), /노드/);
});

test('rejects loader allocation multipliers before parsing static models', () => {
  const cases = [
    (json) => { json.scenes = Array.from({ length: 10_000 }, () => ({ nodes: [0] })); },
    (json) => { json.scenes[0].nodes = [0, 0]; },
    (json) => { json.cameras = [{ type: 'perspective' }]; },
    (json) => { json.animations = [{ channels: Array(10_000).fill({}) }]; },
    (json) => { json.skins = [{}]; },
    (json) => { json.meshes[0].primitives[0].targets = [{ POSITION: 0 }]; },
    (json) => { json.nodes = [{ children: [1, 1] }, { mesh: 0 }]; },
    (json) => { json.nodes = [{ children: [2] }, { children: [2] }, { mesh: 0 }]; },
    (json) => { json.nodes = [{ children: [1] }, { mesh: 0 }]; json.scenes[0].nodes = [0, 1]; },
    (json) => { json.nodes[0].scale = [Infinity, 1, 1]; }
  ];
  for (const modify of cases) {
    const json = triangleDocument();
    modify(json);
    assert.throws(() => validateGlb(createGlb(json, triangleBinary())));
  }
});

test('bounds metadata complexity and per-texture image allocations', () => {
  for (const field of ['textures', 'samplers', 'materials']) {
    const json = triangleDocument();
    json[field] = Array(33).fill({});
    assert.throws(() => validateGlb(createGlb(json, triangleBinary())), /복잡/);
  }
  const json = triangleDocument();
  json.extras = Array(100_001).fill(0);
  assert.throws(() => validateGlb(createGlb(json, triangleBinary())), /복잡/);
  const deeplyNested = triangleDocument();
  let value = {};
  for (let index = 0; index < 100; index++) value = { child: value };
  deeplyNested.extras = value;
  assert.throws(() => validateGlb(createGlb(deeplyNested, triangleBinary())), /복잡/);
});

test('rejects models directory symlinks and absent renderer callers', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dotdock-model-test-'));
  try {
    const directory = path.join(temp, 'outside');
    fs.mkdirSync(directory);
    const id = '12345678-1234-4123-8123-123456789012';
    fs.writeFileSync(path.join(directory, `${id}.glb`), createTriangleGlb());
    fs.symlinkSync(directory, path.join(temp, 'models'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => createCharacterModelStore(path.join(temp, 'models')).read(id), /폴더/);
    const handlers = new Map();
    registerCharacterModelIpc({ ipcMain: { handle: (name, callback) => handlers.set(name, callback) }, getWindow: () => null });
    assert.equal((await handlers.get('dotdock:import-character-model')({})).ok, false);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('checks embedded texture dimensions before image decoding', () => {
  const png = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.writeUInt32BE(13, 8);
  png.write('IHDR', 12);
  png.writeUInt32BE(2049, 16);
  png.writeUInt32BE(1024, 20);
  const json = triangleDocument();
  json.buffers[0].byteLength = 60;
  json.bufferViews.push({ buffer: 0, byteOffset: 36, byteLength: 24 });
  json.images = [{ mimeType: 'image/png', bufferView: 1 }];
  assert.throws(() => validateGlb(createGlb(json, Buffer.concat([triangleBinary(), png]))), /2048/);
  png.writeUInt32BE(1024, 16);
  assert.equal(validateGlb(createGlb(json, Buffer.concat([triangleBinary(), png]))).triangles, 1);
});

test('imports by native file path, reads only opaque IDs, and revalidates stored files', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dotdock-model-test-'));
  try {
    const source = path.join(temp, 'rabbit.glb');
    fs.writeFileSync(source, createTriangleGlb());
    const store = createCharacterModelStore(path.join(temp, 'models'));
    const imported = store.importFile(source);
    assert.match(imported.modelId, /^[a-f0-9-]{36}$/);
    assert.deepEqual(Buffer.from(store.read(imported.modelId).base64, 'base64'), createTriangleGlb());
    assert.throws(() => store.read('../rabbit'), /식별자/);
    assert.throws(() => store.read(source), /식별자/);
    fs.writeFileSync(path.join(temp, 'models', `${imported.modelId}.glb`), Buffer.from('bad'));
    assert.throws(() => store.read(imported.modelId), /GLB/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('bundled model IDs use a zodiac whitelist and remain isolated from imported models', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dotdock-model-test-'));
  try {
    const bundled = path.join(temp, 'bundled');
    fs.mkdirSync(bundled);
    fs.writeFileSync(path.join(bundled, 'rabbit.glb'), createTriangleGlb());
    const store = createCharacterModelStore(path.join(temp, 'models'), bundled);
    assert.equal(store.read('zodiac:rabbit').ok, true);
    assert.throws(() => store.read('zodiac:../rabbit'), /식별자/);
    assert.throws(() => store.read('zodiac:cat'), /식별자/);
    assert.throws(() => store.read('zodiac:dragon'), /없/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('IPC import is cancelable, validates caller and returns errors without file paths', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dotdock-model-test-'));
  try {
    const handlers = new Map();
    const window = { webContents: { id: 7 } };
    registerCharacterModelIpc({
      ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
      dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
      getWindow: () => window,
      getUserData: () => temp
    });
    const imported = await handlers.get('dotdock:import-character-model')({ sender: { id: 7 } });
    assert.equal(imported.canceled, true);
    const rejected = await handlers.get('dotdock:get-character-model')({ sender: { id: 8 } }, '../secret');
    assert.equal(rejected.ok, false);
    assert.doesNotMatch(rejected.message, new RegExp(temp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
