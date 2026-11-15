const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MODEL_IDS = new Set(['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'sheep', 'monkey', 'rooster', 'dog', 'pig']);
const MAX_MODEL_BYTES = 10 * 1024 * 1024;

function check(condition, message = '3D 모델 다운로드 정보를 확인하지 못했습니다.') {
  if (!condition) throw new Error(message);
}

function readRegularFile(filePath, limit) {
  check(fs.lstatSync(filePath).isFile());
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const info = fs.fstatSync(descriptor);
    check(info.isFile() && info.size > 0 && info.size <= limit);
    const bytes = Buffer.alloc(info.size);
    check(fs.readSync(descriptor, bytes, 0, info.size, 0) === info.size && fs.fstatSync(descriptor).size === info.size);
    return bytes;
  } finally { fs.closeSync(descriptor); }
}

function manifestEntry(manifestPath, id, limit) {
  check(MODEL_IDS.has(id));
  const manifest = JSON.parse(readRegularFile(manifestPath, 64 * 1024).toString('utf8'));
  check(typeof manifest.version === 'string' && manifest.version.length <= 64
    && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(manifest.version));
  const entry = manifest.models?.[id];
  check(entry && entry.file === `${id}.glb` && /^[a-f0-9]{64}$/.test(entry.sha256)
    && Number.isSafeInteger(entry.bytes) && entry.bytes >= 20 && entry.bytes <= limit);
  return { ...entry, url: `https://raw.githubusercontent.com/seominpapa/DotDock/v${manifest.version}/public/models/${id}.glb` };
}

function verify(bytes, entry, validateModel) {
  check(bytes.length === entry.bytes && crypto.createHash('sha256').update(bytes).digest('hex') === entry.sha256,
    '3D 모델 다운로드 크기 또는 무결성을 확인하지 못했습니다.');
  validateModel(bytes);
  return bytes;
}

function ensureCacheDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const info = fs.lstatSync(directory);
  check(info.isDirectory() && !info.isSymbolicLink(), '3D 모델 캐시 폴더가 올바르지 않습니다.');
}

function writeCache(directory, destination, bytes) {
  ensureCacheDirectory(directory);
  const temporary = path.join(directory, `.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, destination);
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

async function download(entry, fetchRequest, signal) {
  const response = await fetchRequest(entry.url, { signal, redirect: 'error',
    headers: { Accept: 'model/gltf-binary', 'Accept-Encoding': 'identity' } });
  signal.throwIfAborted();
  check(response.status === 200 && !response.redirected && (!response.url || response.url === entry.url) && response.body);
  const length = response.headers?.get('content-length');
  check(length == null || (/^\d+$/.test(length) && Number(length) === entry.bytes));
  const chunks = [];
  let received = 0;
  for await (const chunk of response.body) {
    signal.throwIfAborted();
    check(chunk instanceof Uint8Array);
    received += chunk.byteLength;
    check(received <= entry.bytes, '3D 모델 다운로드 크기가 올바르지 않습니다.');
    chunks.push(Buffer.from(chunk));
  }
  signal.throwIfAborted();
  check(received === entry.bytes, '3D 모델 다운로드가 완료되지 않았습니다.');
  return Buffer.concat(chunks, received);
}

async function withDeadline(task, timeoutMs) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('3D 모델 다운로드 제한 시간이 지났습니다.'));
        }, timeoutMs);
      }),
      task(controller.signal)
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

function createBuiltinModelDownloader({ cacheDirectory, manifestPath, validateModel,
  maxBytes = MAX_MODEL_BYTES, timeoutMs = 10_000, fetchRequest = globalThis.fetch }) {
  const pending = new Map();
  async function load(id, entry) {
    ensureCacheDirectory(cacheDirectory);
    const destination = path.join(cacheDirectory, `${id}-${entry.sha256}.glb`);
    try { return verify(readRegularFile(destination, maxBytes), entry, validateModel); }
    catch { /* Missing or invalid cache entries are replaced only after a verified download. */ }
    return withDeadline(async (signal) => {
      const bytes = verify(await download(entry, fetchRequest, signal), entry, validateModel);
      signal.throwIfAborted();
      writeCache(cacheDirectory, destination, bytes);
      return bytes;
    }, timeoutMs);
  }
  return {
    async read(id) {
      const entry = manifestEntry(manifestPath, id, maxBytes);
      const key = `${id}:${entry.sha256}`;
      if (!pending.has(key)) pending.set(key, load(id, entry).finally(() => pending.delete(key)));
      return pending.get(key);
    }
  };
}

module.exports = { createBuiltinModelDownloader };
