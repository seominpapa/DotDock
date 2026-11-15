const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createTriangleGlb } = require('./helpers/glb.cjs');

const script = path.resolve(__dirname, '../scripts/package-3d-models.py');
const python = process.platform === 'win32' ? 'python' : 'python3';
const names = ['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'sheep', 'monkey', 'rooster', 'dog', 'pig'];
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dotdock-model-distribution-'));
  try {
    fs.mkdirSync(path.join(root, 'public/models'), { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '0.1.5' }));
    for (const name of names) fs.writeFileSync(path.join(root, 'public/models', `${name}.glb`), createTriangleGlb());
    run(root);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('packages exactly 12 GLBs with pinned URLs and independently verified ZIP digests', () => fixture((root) => {
  execFileSync(python, [script, '--root', root]);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/models/manifest.json'), 'utf8'));
  assert.equal(manifest.version, '0.1.5');
  assert.equal(manifest.tag, 'v0.1.5');
  assert.deepEqual(Object.keys(manifest.models), names);
  for (const name of names) {
    assert.deepEqual(manifest.models[name], {
      file: `${name}.glb`, bytes: createTriangleGlb().length, sha256: hash(createTriangleGlb())
    });
  }
  assert.equal(manifest.baseUrl, 'https://raw.githubusercontent.com/seominpapa/DotDock/v0.1.5/public/models/');
  assert.equal(manifest.archive.file, 'DotDock-3D-Models-0.1.5.zip');
  assert.equal(manifest.archive.url, 'https://github.com/seominpapa/DotDock/releases/download/v0.1.5/DotDock-3D-Models-0.1.5.zip');
  const archive = path.join(root, 'release', manifest.archive.file);
  const inspection = JSON.parse(execFileSync(python, ['-c', [
    'import hashlib,json,sys,zipfile',
    'with zipfile.ZipFile(sys.argv[1]) as archive:',
    ' entries={name:archive.read(name) for name in archive.namelist()}',
    ' expected={line.split("  ",1)[1]:line.split("  ",1)[0] for line in entries["SHA256SUMS.txt"].decode().splitlines()}',
    ' assert set(expected)==set(entries)-{"SHA256SUMS.txt"}',
    ' assert all(hashlib.sha256(entries[name]).hexdigest()==digest for name,digest in expected.items())',
    ' print(json.dumps({"names":list(entries),"manifest":json.loads(entries["manifest.json"]),"readme":entries["README.md"].decode()}))'
  ].join('\n'), archive], { encoding: 'utf8' }));
  assert.deepEqual(inspection.names, [...names.map((name) => `models/${name}.glb`), 'manifest.json', 'README.md', 'SHA256SUMS.txt']);
  assert.deepEqual(inspection.manifest, manifest);
  assert.match(inspection.readme, /GLB/);
  const first = hash(fs.readFileSync(archive));
  execFileSync(python, [script, '--root', root]);
  assert.equal(hash(fs.readFileSync(archive)), first, 'repeated builds produce identical archive bytes');
  execFileSync(python, [script, '--root', root, '--check']);
}));

test('manifest checks reject stale versions, content changes, and missing or unexpected models', () => fixture((root) => {
  const run = (...args) => execFileSync(python, [script, '--root', root, ...args], { stdio: 'pipe' });
  run('--manifest-only');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '0.1.6' }));
  assert.throws(() => run('--check'), /manifest/i);
  run('--manifest-only');
  fs.appendFileSync(path.join(root, 'public/models/rat.glb'), 'changed');
  assert.throws(() => run('--check'), /GLB|manifest/i);
  fs.writeFileSync(path.join(root, 'public/models/rat.glb'), createTriangleGlb());
  fs.unlinkSync(path.join(root, 'public/models/pig.glb'));
  assert.throws(() => run('--manifest-only'), /pig/);
  fs.writeFileSync(path.join(root, 'public/models/pig.glb'), createTriangleGlb());
  fs.writeFileSync(path.join(root, 'public/models/cat.glb'), createTriangleGlb());
  assert.throws(() => run('--manifest-only'), /cat/);
}));
