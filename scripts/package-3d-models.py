#!/usr/bin/env python3
"""Build the pinned model manifest and a reproducible standalone GLB archive."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import sys
import zipfile

ZODIACS = ('rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse',
           'sheep', 'monkey', 'rooster', 'dog', 'pig')
REPOSITORY = 'seominpapa/DotDock'
MAX_MODEL_BYTES = 10 * 1024 * 1024


def digest(data):
    return hashlib.sha256(data).hexdigest()


def model_files(root):
    directory = root / 'public' / 'models'
    expected = {f'{name}.glb' for name in ZODIACS}
    actual = {item.name for item in directory.glob('*.glb')}
    if expected != actual:
        raise ValueError(f'Expected exactly 12 GLBs; missing={sorted(expected - actual)}, unexpected={sorted(actual - expected)}')
    files = {}
    for name in ZODIACS:
        source = directory / f'{name}.glb'
        if source.is_symlink() or not source.is_file() or source.stat().st_size > MAX_MODEL_BYTES:
            raise ValueError(f'Invalid model file: {name}.glb')
        data = source.read_bytes()
        if len(data) < 20 or struct.unpack_from('<III', data) != (0x46546C67, 2, len(data)):
            raise ValueError(f'Invalid GLB 2.0 header or length: {name}.glb')
        files[name] = data
    return files


def manifest_bytes(version, files):
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('Model distribution version must be a stable x.y.z release')
    tag = f'v{version}'
    archive = f'DotDock-3D-Models-{version}.zip'
    manifest = {
        'version': version,
        'tag': tag,
        'baseUrl': f'https://raw.githubusercontent.com/{REPOSITORY}/{tag}/public/models/',
        'archive': {
            'file': archive,
            'url': f'https://github.com/{REPOSITORY}/releases/download/{tag}/{archive}'
        },
        'models': {
            name: {'file': f'{name}.glb', 'bytes': len(files[name]), 'sha256': digest(files[name])}
            for name in ZODIACS
        }
    }
    return (json.dumps(manifest, indent=2, ensure_ascii=False) + '\n').encode('utf-8'), archive


def readme_bytes(version):
    return f'''# DotDock 3D Models {version}

This archive contains the 12 static zodiac GLB models used by DotDock.
The models were generated with Tripo P1. These are the existing release models;
this archive does not call the Tripo API or generate new models.

DotDock: https://github.com/{REPOSITORY}

## Use

DotDock downloads and caches the selected built-in model when you choose 3D.
If you want to import a model manually, extract this ZIP, open character
settings, select GLB 가져오기, and choose a file from the models directory.
Drag the character to rotate it; drag its name to move the application window.
These static models do not include character animation or rigging.

## Verify

manifest.json pins the release tag, filenames, sizes, and SHA-256 digests.
SHA256SUMS.txt covers the 12 GLBs, manifest.json, and this README.
After extracting, run `shasum -a 256 -c SHA256SUMS.txt` on macOS or
`sha256sum -c SHA256SUMS.txt` on Linux. Windows users can compare
`Get-FileHash models/rat.glb -Algorithm SHA256` against the manifest.
The release's separate SHA256SUMS.txt covers the downloadable ZIP itself.
'''.encode('utf-8')


def write_archive(destination, entries):
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in entries.items():
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data, compresslevel=9)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument('--output-directory', type=Path)
    parser.add_argument('--version')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--manifest-only', action='store_true')
    mode.add_argument('--check', action='store_true')
    args = parser.parse_args()
    version = args.version or json.loads((args.root / 'package.json').read_text(encoding='utf-8'))['version']
    files = model_files(args.root)
    manifest, archive_name = manifest_bytes(version, files)
    manifest_path = args.root / 'public' / 'models' / 'manifest.json'
    if args.check:
        if not manifest_path.is_file() or manifest_path.read_text(encoding='utf-8') != manifest.decode('utf-8'):
            raise ValueError('Model manifest is stale; regenerate with --manifest-only')
        print(f'Verified model manifest for v{version} (12 GLBs)')
        return
    manifest_path.write_bytes(manifest)
    if args.manifest_only:
        print(f'Wrote {manifest_path}')
        return
    entries = {f'models/{name}.glb': files[name] for name in ZODIACS}
    entries['manifest.json'] = manifest
    entries['README.md'] = readme_bytes(version)
    entries['SHA256SUMS.txt'] = ''.join(f'{digest(data)}  {name}\n' for name, data in entries.items()).encode('utf-8')
    destination = (args.output_directory or args.root / 'release') / archive_name
    write_archive(destination, entries)
    print(f'Wrote {destination} ({destination.stat().st_size} bytes, SHA-256 {digest(destination.read_bytes())})')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, struct.error) as error:
        print(f'Model distribution error: {error}', file=sys.stderr)
        sys.exit(1)
