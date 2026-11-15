const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createBuiltinModelDownloader } = require('./model-download.cjs');

const MAX_MODEL_BYTES = 10 * 1024 * 1024;
const MAX_TRIANGLES = 20_000;
const ZODIACS = new Set(['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'sheep', 'monkey', 'rooster', 'dog', 'pig']);
const COMPRESSED = new Set(['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu']);
const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

class ModelValidationError extends Error {}

function requireValid(condition, message) {
  if (!condition) throw new ModelValidationError(message);
}

function integer(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function unpackGlb(bytes) {
  requireValid(Buffer.isBuffer(bytes) && bytes.length <= MAX_MODEL_BYTES, '3D 모델은 10MB 이하 GLB 파일만 사용할 수 있습니다.');
  requireValid(bytes.length >= 20 && bytes.readUInt32LE(0) === 0x46546c67 && bytes.readUInt32LE(4) === 2, 'GLB 2.0 파일이 아닙니다.');
  requireValid(bytes.readUInt32LE(8) === bytes.length, 'GLB 파일 길이가 손상되었습니다.');
  let jsonBytes;
  let binary = Buffer.alloc(0);
  for (let offset = 12; offset < bytes.length;) {
    requireValid(offset + 8 <= bytes.length, 'GLB 청크 범위가 손상되었습니다.');
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    requireValid(length % 4 === 0 && offset + 8 + length <= bytes.length, 'GLB 청크 길이가 손상되었습니다.');
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (offset === 12 && type === 0x4e4f534a) jsonBytes = chunk;
    else if (jsonBytes && binary.length === 0 && type === 0x004e4942) binary = chunk;
    else throw new ModelValidationError('GLB JSON/BIN 청크 구성이 지원되지 않습니다.');
    offset += 8 + length;
  }
  requireValid(Boolean(jsonBytes), 'GLB JSON 정보가 없습니다.');
  let json;
  try { json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(jsonBytes)); }
  catch { throw new ModelValidationError('GLB JSON 정보가 손상되었습니다.'); }
  requireValid(json && json.asset?.version === '2.0', 'GLB 2.0 모델만 지원합니다.');
  return { json, binary };
}

function validateExtensions(json) {
  const queue = [[json, 0]];
  let entries = 0;
  while (queue.length) {
    const [item, depth] = queue.pop();
    if (!item || typeof item !== 'object') continue;
    requireValid(depth <= 64 && (!Array.isArray(item) || item.length <= 10_000), 'GLB JSON 구성이 너무 복잡합니다.');
    for (const key in item) {
      requireValid(++entries <= 100_000, 'GLB JSON 구성이 너무 복잡합니다.');
      const value = item[key];
      requireValid(!COMPRESSED.has(key), '압축 디코더가 필요한 GLB는 지원하지 않습니다. 비압축 GLB로 내보내 주세요.');
      requireValid(key !== 'EXT_mesh_gpu_instancing', '인스턴스 확장 모델은 지원하지 않습니다.');
      if (typeof value === 'string') {
        requireValid(!COMPRESSED.has(value), '압축 디코더가 필요한 GLB는 지원하지 않습니다. 비압축 GLB로 내보내 주세요.');
        requireValid(value !== 'EXT_mesh_gpu_instancing', '인스턴스 확장 모델은 지원하지 않습니다.');
      } else if (value && typeof value === 'object') queue.push([value, depth + 1]);
    }
  }
}

function validateBuffers(json, binary) {
  const buffers = json.buffers || [];
  requireValid(Array.isArray(buffers) && buffers.length === 1, '데이터가 내장된 단일 버퍼 GLB만 지원합니다.');
  requireValid(buffers.every((buffer) => buffer && buffer.uri === undefined), '외부 URI 대신 데이터가 내장된 GLB를 사용해 주세요.');
  requireValid(integer(buffers[0].byteLength) && buffers[0].byteLength <= binary.length && binary.length - buffers[0].byteLength <= 3, 'GLB 버퍼 범위가 손상되었습니다.');
  const views = json.bufferViews || [];
  requireValid(Array.isArray(views) && views.length <= 512, 'GLB 버퍼 구성이 너무 복잡합니다.');
  for (const view of views) {
    requireValid(view && view.buffer === 0 && integer(view.byteOffset ?? 0) && integer(view.byteLength)
      && (view.byteOffset ?? 0) + view.byteLength <= buffers[0].byteLength, 'GLB 버퍼 뷰 범위가 손상되었습니다.');
    requireValid(view.byteStride === undefined || (integer(view.byteStride) && view.byteStride >= 4 && view.byteStride <= 252), 'GLB 버퍼 간격이 올바르지 않습니다.');
  }
  return views;
}

function validateAccessors(json, views) {
  const accessors = json.accessors || [];
  requireValid(Array.isArray(accessors) && accessors.length <= 256, 'GLB 접근자 구성이 너무 복잡합니다.');
  for (const accessor of accessors) {
    requireValid(accessor && integer(accessor.count) && accessor.count <= MAX_TRIANGLES * 3, 'GLB 정점 수가 20,000개 삼각형 예산을 초과합니다.');
    const width = COMPONENT_BYTES[accessor.componentType] * TYPE_COMPONENTS[accessor.type];
    requireValid(width > 0 && integer(accessor.bufferView) && views[accessor.bufferView] && !accessor.sparse, 'GLB 접근자 또는 희소 데이터가 지원되지 않습니다.');
    const view = views[accessor.bufferView];
    const stride = view.byteStride || width;
    requireValid(integer(accessor.byteOffset ?? 0) && stride >= width && (accessor.byteOffset ?? 0)
      + (accessor.count ? (accessor.count - 1) * stride + width : 0) <= view.byteLength, 'GLB 접근자 범위가 손상되었습니다.');
  }
  return accessors;
}

function validateStaticScene(json) {
  for (const field of ['animations', 'skins', 'cameras']) {
    requireValid(json[field] === undefined || (Array.isArray(json[field]) && json[field].length === 0), '애니메이션·스킨·카메라가 없는 정적 GLB만 지원합니다.');
  }
  for (const [field, limit] of [['textures', 16], ['samplers', 16], ['materials', 32]]) {
    requireValid(json[field] === undefined || (Array.isArray(json[field]) && json[field].length <= limit), 'GLB 재질·텍스처 구성이 너무 복잡합니다.');
  }
  requireValid(Array.isArray(json.scenes) && json.scenes.length === 1 && (json.scene === undefined || json.scene === 0), '단일 장면 GLB만 지원합니다.');
  const roots = json.scenes[0]?.nodes;
  requireValid(Array.isArray(roots) && roots.length > 0 && roots.length <= 256 && new Set(roots).size === roots.length, 'GLB 장면 루트가 올바르지 않습니다.');
  return roots;
}

function countTriangles(json, accessors) {
  const meshes = json.meshes || [];
  requireValid(Array.isArray(meshes) && meshes.length > 0 && meshes.length <= 128, 'GLB에 표시할 메시가 없거나 너무 많습니다.');
  let primitiveCount = 0;
  const counts = meshes.map((mesh) => {
    requireValid(mesh && Array.isArray(mesh.primitives) && mesh.primitives.length > 0 && (primitiveCount += mesh.primitives.length) <= 64, 'GLB 메시 구성이 너무 복잡합니다.');
    requireValid(mesh.weights === undefined, '모프 변형이 없는 정적 GLB만 지원합니다.');
    return mesh.primitives.reduce((sum, primitive) => {
      requireValid(primitive && primitive.targets === undefined, '모프 변형이 없는 정적 GLB만 지원합니다.');
      requireValid((primitive.mode ?? 4) === 4, '삼각형 메시로 내보낸 GLB만 지원합니다.');
      const position = accessors[primitive.attributes?.POSITION];
      requireValid(position && position.type === 'VEC3', 'GLB 위치 접근자가 올바르지 않습니다.');
      const indices = primitive.indices === undefined ? position : accessors[primitive.indices];
      requireValid(indices && (primitive.indices === undefined || indices.type === 'SCALAR') && indices.count % 3 === 0, 'GLB 삼각형 접근자가 올바르지 않습니다.');
      return sum + indices.count / 3;
    }, 0);
  });
  requireValid(counts.reduce((sum, count) => sum + count, 0) <= MAX_TRIANGLES, 'GLB 삼각형은 20,000개 이하여야 합니다.');
  const nodes = json.nodes || [];
  requireValid(Array.isArray(nodes) && nodes.length <= 256, 'GLB 노드는 256개 이하여야 합니다.');
  const visited = new Set();
  const visiting = new Set();
  const parents = new Set();
  function visit(index) {
    requireValid(integer(index) && nodes[index], 'GLB 노드 참조가 올바르지 않습니다.');
    requireValid(!visiting.has(index), 'GLB 노드에 순환 참조가 있습니다.');
    if (visited.has(index)) return;
    visiting.add(index);
    const node = nodes[index];
    requireValid(node.skin === undefined && node.camera === undefined && node.weights === undefined, '애니메이션·스킨·카메라가 없는 정적 GLB만 지원합니다.');
    for (const [field, size] of [['translation', 3], ['rotation', 4], ['scale', 3], ['matrix', 16]]) {
      requireValid(node[field] === undefined || (Array.isArray(node[field]) && node[field].length === size && node[field].every(Number.isFinite)), 'GLB 노드 변환이 올바르지 않습니다.');
    }
    requireValid(node.mesh === undefined || (integer(node.mesh) && counts[node.mesh] !== undefined), 'GLB 메시 참조가 올바르지 않습니다.');
    requireValid(node.children === undefined || Array.isArray(node.children), 'GLB 자식 노드가 올바르지 않습니다.');
    for (const child of node.children || []) {
      requireValid(!parents.has(child), 'GLB 자식 노드는 하나의 부모만 가질 수 있습니다.');
      parents.add(child);
      visit(child);
    }
    visiting.delete(index);
    visited.add(index);
  }
  nodes.forEach((_node, index) => visit(index));
  for (const root of json.scenes[0].nodes) {
    requireValid(integer(root) && nodes[root] && !parents.has(root), 'GLB 장면 루트가 올바르지 않습니다.');
  }
  const triangles = nodes.reduce((sum, node) => sum + (node.mesh === undefined ? 0 : counts[node.mesh]), 0);
  requireValid(triangles > 0 && triangles <= MAX_TRIANGLES, '인스턴스를 포함한 GLB 삼각형은 20,000개 이하여야 합니다.');
  return triangles;
}

function textureDimensions(bytes, mimeType) {
  if (mimeType === 'image/png') {
    requireValid(bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      && bytes.toString('ascii', 12, 16) === 'IHDR', 'GLB PNG 텍스처가 손상되었습니다.');
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  }
  if (mimeType === 'image/jpeg') {
    requireValid(bytes.length >= 4 && bytes.readUInt16BE(0) === 0xffd8, 'GLB JPEG 텍스처가 손상되었습니다.');
    for (let offset = 2; offset + 4 <= bytes.length;) {
      requireValid(bytes[offset] === 0xff, 'GLB JPEG 마커가 손상되었습니다.');
      const marker = bytes[offset + 1];
      if (marker === 0xff) { offset += 1; continue; }
      const length = bytes.readUInt16BE(offset + 2);
      requireValid(length >= 2 && offset + 2 + length <= bytes.length, 'GLB JPEG 범위가 손상되었습니다.');
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        requireValid(length >= 7, 'GLB JPEG 크기 정보가 손상되었습니다.');
        return [bytes.readUInt16BE(offset + 7), bytes.readUInt16BE(offset + 5)];
      }
      offset += 2 + length;
    }
  }
  if (mimeType === 'image/webp') {
    requireValid(bytes.length >= 25 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP', 'GLB WebP 텍스처가 손상되었습니다.');
    const kind = bytes.toString('ascii', 12, 16);
    if (kind === 'VP8X' && bytes.length >= 30) return [1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3)];
    if (kind === 'VP8L' && bytes[20] === 0x2f) {
      const bits = bytes.readUInt32LE(21);
      return [1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff)];
    }
    if (kind === 'VP8 ' && bytes.length >= 30) return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
  }
  throw new ModelValidationError('PNG/JPEG/WebP 내장 텍스처만 지원합니다.');
}

function validateTextures(json, views, binary) {
  const images = json.images || [];
  requireValid(Array.isArray(images) && images.length <= 8, 'GLB 텍스처는 8개 이하여야 합니다.');
  let totalPixels = 0;
  for (const image of images) {
    requireValid(image && image.uri === undefined, '외부 URI 대신 텍스처가 내장된 GLB를 사용해 주세요.');
    requireValid(integer(image.bufferView) && views[image.bufferView], 'GLB 텍스처 버퍼가 올바르지 않습니다.');
    const view = views[image.bufferView];
    const start = view.byteOffset || 0;
    const [width, height] = textureDimensions(binary.subarray(start, start + view.byteLength), image.mimeType);
    requireValid(width > 0 && height > 0 && width <= 2048 && height <= 2048, 'GLB 텍스처는 가로·세로 2048px 이하여야 합니다.');
    totalPixels += width * height;
  }
  requireValid(totalPixels <= 16 * 1024 * 1024, 'GLB 전체 텍스처 해상도가 너무 큽니다.');
}

function validateGlb(bytes) {
  const { json, binary } = unpackGlb(bytes);
  validateExtensions(json);
  validateStaticScene(json);
  const views = validateBuffers(json, binary);
  const accessors = validateAccessors(json, views);
  const triangles = countTriangles(json, accessors);
  validateTextures(json, views, binary);
  return { triangles };
}

function readModelFile(filePath) {
  requireValid(path.extname(filePath).toLowerCase() === '.glb', 'GLB 파일만 가져올 수 있습니다.');
  requireValid(fs.lstatSync(filePath).isFile(), '일반 GLB 파일만 사용할 수 있습니다.');
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const size = fs.fstatSync(descriptor).size;
    requireValid(size <= MAX_MODEL_BYTES, '3D 모델은 10MB 이하 GLB 파일만 사용할 수 있습니다.');
    const bytes = Buffer.alloc(size);
    requireValid(fs.readSync(descriptor, bytes, 0, size, 0) === size && fs.fstatSync(descriptor).size === size, 'GLB 파일이 읽는 중 변경되었습니다. 다시 가져와 주세요.');
    validateGlb(bytes);
    return bytes;
  } finally { fs.closeSync(descriptor); }
}

function createCharacterModelStore(modelsDirectory, bundledDirectory, { builtinDownloader } = {}) {
  const store = {
    importFile(filePath) {
      const bytes = readModelFile(filePath);
      fs.mkdirSync(modelsDirectory, { recursive: true, mode: 0o700 });
      requireValid(fs.lstatSync(modelsDirectory).isDirectory() && !fs.lstatSync(modelsDirectory).isSymbolicLink(), '3D 모델 저장 폴더가 올바르지 않습니다.');
      const modelId = crypto.randomUUID();
      const destination = path.join(modelsDirectory, `${modelId}.glb`);
      fs.writeFileSync(destination, bytes, { flag: 'wx', mode: 0o600 });
      return { ok: true, modelId, name: path.basename(filePath).replace(/[\x00-\x1f]/g, '').slice(0, 80), message: '3D 모델을 가져왔습니다.' };
    },
    read(modelId) {
      requireValid(typeof modelId === 'string', '3D 모델 식별자가 올바르지 않습니다.');
      const zodiac = modelId.startsWith('zodiac:') ? modelId.slice(7) : null;
      const imported = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(modelId);
      requireValid(imported || (bundledDirectory && ZODIACS.has(zodiac)), '3D 모델 식별자가 올바르지 않습니다.');
      if (imported) requireValid(fs.lstatSync(modelsDirectory).isDirectory() && !fs.lstatSync(modelsDirectory).isSymbolicLink(), '3D 모델 저장 폴더가 올바르지 않습니다.');
      const filePath = zodiac ? path.join(bundledDirectory, `${zodiac}.glb`) : path.join(modelsDirectory, `${modelId}.glb`);
      requireValid(fs.existsSync(filePath), '저장된 3D 모델이 없습니다. GLB 파일을 다시 가져와 주세요.');
      return { ok: true, modelId, base64: readModelFile(filePath).toString('base64') };
    },
    async readForDisplay(modelId) {
      const zodiac = typeof modelId === 'string' && modelId.startsWith('zodiac:') ? modelId.slice(7) : null;
      if (builtinDownloader && ZODIACS.has(zodiac)) {
        try {
          const bytes = await builtinDownloader.read(zodiac);
          return { ok: true, modelId, base64: bytes.toString('base64') };
        } catch { /* The bundled, validated model remains available offline. */ }
      }
      return store.read(modelId);
    }
  };
  return store;
}

function registerCharacterModelIpc({ ipcMain, dialog, getWindow, getUserData, getBundledModelsDirectory, fetchRequest }) {
  let modelStore;
  function store() {
    if (!modelStore) {
      const userData = getUserData();
      const bundled = getBundledModelsDirectory?.();
      const builtinDownloader = bundled ? createBuiltinModelDownloader({
        cacheDirectory: path.join(userData, 'model-cache'), manifestPath: path.join(bundled, 'manifest.json'),
        validateModel: validateGlb, maxBytes: MAX_MODEL_BYTES, fetchRequest
      }) : undefined;
      modelStore = createCharacterModelStore(path.join(userData, 'models'), bundled, { builtinDownloader });
    }
    return modelStore;
  }
  function allowed(event) {
    const contents = getWindow()?.webContents;
    return Boolean(contents && event.sender?.id === contents.id);
  }
  function failure(error) {
    return { ok: false, message: error instanceof ModelValidationError ? error.message : '3D 모델 파일을 읽거나 저장하지 못했습니다. 파일과 접근 권한을 확인해 주세요.' };
  }
  ipcMain.handle('dotdock:import-character-model', async (event) => {
    if (!allowed(event)) return { ok: false, message: '허용되지 않은 3D 모델 요청입니다.' };
    try {
      const selected = await dialog.showOpenDialog(getWindow(), { title: '3D 캐릭터 GLB 가져오기', properties: ['openFile'], filters: [{ name: 'GLB 3D 모델 (10MB 이하)', extensions: ['glb'] }] });
      if (selected.canceled || !selected.filePaths[0]) return { ok: false, canceled: true, message: '가져오기를 취소했습니다.' };
      return store().importFile(selected.filePaths[0]);
    } catch (error) { return failure(error); }
  });
  ipcMain.handle('dotdock:get-character-model', async (event, modelId) => {
    if (!allowed(event)) return { ok: false, message: '허용되지 않은 3D 모델 요청입니다.' };
    try { return await store().readForDisplay(modelId); }
    catch (error) { return failure(error); }
  });
}

module.exports = { MAX_MODEL_BYTES, validateGlb, createCharacterModelStore, registerCharacterModelIpc };
