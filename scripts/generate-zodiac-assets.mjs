import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const zodiacOutDir = path.join(rootDir, 'src', 'assets', 'zodiac');
const trayOutPath = path.join(rootDir, 'electron', 'tray-icon.png');
const tray16OutPath = path.join(rootDir, 'electron', 'tray-icon-16.png');

fs.mkdirSync(zodiacOutDir, { recursive: true });
fs.mkdirSync(path.dirname(trayOutPath), { recursive: true });

// Precompute CRC32 table for valid PNG chunk checksums
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgbaBuffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter None
    rgbaBuffer.copy(raw, rowStart + 1, y * stride, (y + 1) * stride);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

function hexToRgba(hex) {
  if (!hex || hex === 'transparent') return [0, 0, 0, 0];
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const a = clean.length === 8 ? parseInt(clean.slice(6, 8), 16) : 255;
  return [r, g, b, a];
}

function renderGridToPng(grid, palette, scale = 4) {
  const gridHeight = grid.length;
  const gridWidth = grid[0].length;
  const width = gridWidth * scale;
  const height = gridHeight * scale;
  const rgba = Buffer.alloc(width * height * 4);

  for (let gy = 0; gy < gridHeight; gy++) {
    const row = grid[gy];
    if (row.length !== gridWidth) {
      throw new Error(`Row ${gy} length ${row.length} !== expected ${gridWidth}`);
    }
    for (let gx = 0; gx < gridWidth; gx++) {
      const ch = row[gx];
      const [r, g, b, a] = ch === '.' ? [0, 0, 0, 0] : hexToRgba(palette[ch]);
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const px = gx * scale + sx;
          const py = gy * scale + sy;
          const idx = (py * width + px) * 4;
          rgba[idx] = r;
          rgba[idx + 1] = g;
          rgba[idx + 2] = b;
          rgba[idx + 3] = a;
        }
      }
    }
  }

  return encodePng(width, height, rgba);
}

const EYES = `
  <g fill="#343047" stroke="none">
    <ellipse cx="105" cy="120" rx="6" ry="8"/>
    <ellipse cx="151" cy="120" rx="6" ry="8"/>
  </g>
  <g fill="#fff" stroke="none">
    <circle cx="103" cy="117" r="2"/><circle cx="149" cy="117" r="2"/>
  </g>`;
const CHEEKS = '<g fill="#f7a6b6" stroke="none" opacity=".65"><ellipse cx="87" cy="139" rx="10" ry="6"/><ellipse cx="169" cy="139" rx="10" ry="6"/></g>';
const SMILE = '<path d="M119 149q9 10 18 0" fill="none" stroke-width="3.5"/>';
const NOSE = '<path d="M123 136q5-4 10 0l-5 5Z" fill="#856070" stroke="none"/>';

const ZODIAC_VECTORS = {
  rat: {
    title: '쥐', colors: ['#d8dcf9', '#a3addb'], light: '#f1efff',
    back: '<path d="M166 203c46 24 69-8 49-22-12-8-27 1-20 12" fill="none" stroke="#b382a6" stroke-width="11"/>',
    head: `
      <circle cx="76" cy="66" r="30" fill="url(#coat)"/><circle cx="180" cy="66" r="30" fill="url(#coat)"/>
      <g fill="#f5bfd1" stroke="none"><circle cx="76" cy="66" r="19"/><circle cx="180" cy="66" r="19"/></g>
      <path d="M65 116c0-40 27-62 63-62s63 22 63 62c0 39-25 61-63 61s-63-22-63-61Z" fill="url(#coat)"/>
      <ellipse cx="128" cy="143" rx="32" ry="23" fill="#f1efff" stroke="none"/>`,
    face: `${EYES}${CHEEKS}${NOSE}${SMILE}<g fill="none" stroke="#797595" stroke-width="2.5"><path d="m87 146-18-3m18 11-17 4m99-12 18-3m-18 11 17 4"/></g>`
  },
  ox: {
    title: '소', colors: ['#e6c9ac', '#ba8b6b'], light: '#fff0d8',
    back: '<path d="M165 199q49 21 37-23" fill="none" stroke="#806255" stroke-width="8"/><path d="m197 174 11-8 4 17Z" fill="#806255"/>',
    head: `
      <path d="M86 79C58 70 59 45 70 34c-1 19 14 22 33 24m67 21c28-9 27-34 16-45 1 19-14 22-33 24" fill="#fff0cf"/>
      <ellipse cx="65" cy="105" rx="23" ry="16" transform="rotate(17 65 105)" fill="url(#coat)"/>
      <ellipse cx="191" cy="105" rx="23" ry="16" transform="rotate(-17 191 105)" fill="url(#coat)"/>
      <rect x="66" y="61" width="124" height="114" rx="51" fill="url(#coat)"/>
      <path d="M111 65q17-14 34 0l-17 32Z" fill="#fff0d8" stroke="none"/>
      <ellipse cx="128" cy="147" rx="43" ry="28" fill="#f8d9b5"/>`,
    face: `${EYES}<g fill="#a97a65" stroke="none"><ellipse cx="113" cy="145" rx="4" ry="5"/><ellipse cx="143" cy="145" rx="4" ry="5"/></g><path d="M120 158q8 7 16 0" fill="none" stroke-width="3"/>`
  },
  tiger: {
    title: '호랑이', colors: ['#ffd48f', '#f2a85b'], light: '#fff0d3',
    back: '<path d="M163 207c33 17 66 0 53-21" fill="none" stroke="#eaa15e" stroke-width="14"/><path d="m196 207 4 9m12-28 9 4" stroke="#785344" stroke-width="7"/>',
    head: `
      <circle cx="77" cy="72" r="23" fill="url(#coat)"/><circle cx="179" cy="72" r="23" fill="url(#coat)"/>
      <g fill="#fff0d3" stroke="none"><circle cx="77" cy="72" r="13"/><circle cx="179" cy="72" r="13"/></g>
      <ellipse cx="128" cy="119" rx="68" ry="61" fill="url(#coat)"/>
      <path d="M89 137q18-16 39 0 21-16 39 0v11c-5 24-73 24-78 0Z" fill="#fff0d3" stroke="none"/>
      <g fill="#785344" stroke="none"><path d="m119 60 9 27 9-27Z"/><path d="m96 66 12 20 2-24Zm64 0-12 20-2-24Z"/><path d="m63 110 23 8-24 5Zm1 25 23 4-17 10Zm129-25-23 8 24 5Zm-1 25-23 4 17 10Z"/></g>`,
    face: `${EYES}${CHEEKS}${NOSE}${SMILE}`
  },
  rabbit: {
    title: '토끼', colors: ['#fff9f7', '#e9d6e5'], light: '#fffafd',
    back: '<circle cx="178" cy="191" r="19" fill="#fff9f7"/>',
    head: `
      <ellipse cx="101" cy="57" rx="18" ry="42" transform="rotate(-12 101 57)" fill="url(#coat)"/>
      <ellipse cx="155" cy="57" rx="18" ry="42" transform="rotate(12 155 57)" fill="url(#coat)"/>
      <g fill="#f1b8ce" stroke="none"><ellipse cx="101" cy="55" rx="8" ry="28" transform="rotate(-12 101 55)"/><ellipse cx="155" cy="55" rx="8" ry="28" transform="rotate(12 155 55)"/></g>
      <ellipse cx="128" cy="128" rx="63" ry="55" fill="url(#coat)"/>`,
    face: `${EYES}${CHEEKS}<path d="M123 139q5-5 10 0l-5 5Z" fill="#c981a1" stroke="none"/><path d="M128 144v7m-9-2q9 10 18 0" fill="none" stroke-width="3"/>`
  },
  dragon: {
    title: '용', colors: ['#a7e5cf', '#63b99f'], light: '#fff0c5',
    back: `
      <path d="M90 192q-48-5-50-40 22 11 39-8Zm76 0q48-5 50-40-22 11-39-8Z" fill="#b9b4e5"/>
      <path d="M164 205q48 26 51-14" fill="none" stroke="#78bea7" stroke-width="15"/>
      <path d="m204 188 12-12 10 20Z" fill="#eabf77"/>`,
    head: `
      <path d="m87 78-6-32 17 8 8-24 14 37m49 11 6-32-17 8-8-24-14 37" fill="#f3d298"/>
      <path d="m69 105-23-7 7 21-12 11 26 12m120-37 23-7-7 21 12 11-26 12" fill="#83c4b3"/>
      <path d="M64 120c0-39 28-60 64-60s64 21 64 60c0 40-26 61-64 61s-64-21-64-61Z" fill="url(#coat)"/>
      <path d="m111 66 17-19 17 19-17 10Z" fill="#f3d298" stroke-width="3"/>
      <ellipse cx="128" cy="145" rx="39" ry="24" fill="#dcf2d3" stroke="none"/>`,
    face: `${EYES}${CHEEKS}<g fill="#5b9783" stroke="none"><ellipse cx="116" cy="142" rx="3" ry="4"/><ellipse cx="140" cy="142" rx="3" ry="4"/></g><path d="M116 154q12 11 24 0" fill="none" stroke-width="3.5"/>`
  },
  snake: {
    title: '뱀', colors: ['#b4df9d', '#78b784'], light: '#f6edb7',
    body: `
      <ellipse cx="128" cy="204" rx="66" ry="23" fill="url(#coat)"/>
      <path d="M86 204c-10-18 6-32 30-32h22c24 0 39 13 27 28-9 12-48 16-66 3" fill="none" stroke="#528f73" stroke-width="12"/>
      <path d="M99 189c5-22 8-34 5-58h48c-8 28-5 47 5 61-16 18-42 19-58-3Z" fill="url(#coat)"/>
      <path d="M116 146h23l-1 44q-9 8-21 0Z" fill="#f6edb7" stroke="none"/>
      <path d="m117 164 21 1m-20 12 19 1" stroke="#c2c58b" stroke-width="3"/>`,
    head: '<path d="M67 106c0-34 28-55 61-55s61 21 61 55c0 31-26 53-61 53s-61-22-61-53Z" fill="url(#coat)"/><path d="M80 128q48 25 96 0c-15 34-81 35-96 0Z" fill="#f6edb7" stroke="none"/>',
    face: `${EYES}${CHEEKS}<path d="M119 140q9 8 18 0" fill="none" stroke-width="3"/><path d="M128 149v15m0-2-6 6m6-6 6 6" stroke="#e8889a" stroke-width="4"/>`
  },
  horse: {
    title: '말', colors: ['#e9bd91', '#c58e66'], light: '#ffe9c8',
    back: '<path d="M166 195c32-14 49 8 32 27-4-13-12-14-26-10Z" fill="#715767"/>',
    head: `
      <ellipse cx="92" cy="64" rx="15" ry="31" transform="rotate(-15 92 64)" fill="url(#coat)"/>
      <ellipse cx="164" cy="64" rx="15" ry="31" transform="rotate(15 164 64)" fill="url(#coat)"/>
      <g fill="#e6a5a0" stroke="none"><ellipse cx="92" cy="61" rx="6" ry="18" transform="rotate(-15 92 61)"/><ellipse cx="164" cy="61" rx="6" ry="18" transform="rotate(15 164 61)"/></g>
      <path d="M75 127c-15-53 16-79 50-80 45-1 72 42 49 100Z" fill="#715767"/>
      <path d="M74 120c0-34 22-59 54-59s54 25 54 59v17c0 30-21 49-54 49s-54-19-54-49Z" fill="url(#coat)"/>
      <path d="M119 68h18l-4 66h-10Z" fill="#fff1da" stroke="none"/>
      <path d="M105 67c5-24 30-30 48-13l-15 1 7 13-16-5-9 14Z" fill="#715767"/>
      <ellipse cx="128" cy="155" rx="39" ry="27" fill="#f6d5b6" stroke="none"/>`,
    face: `${EYES}${CHEEKS}<g fill="#ae7f70" stroke="none"><ellipse cx="114" cy="151" rx="4" ry="5"/><ellipse cx="142" cy="151" rx="4" ry="5"/></g><path d="M119 165q9 7 18 0" fill="none" stroke-width="3"/>`
  },
  sheep: {
    title: '양', colors: ['#fffaf0', '#e9dfd4'], light: '#f8e9ce',
    back: '<circle cx="181" cy="195" r="16" fill="#fffaf0"/>',
    head: `
      <ellipse cx="65" cy="117" rx="22" ry="15" fill="#e9d2bd"/><ellipse cx="191" cy="117" rx="22" ry="15" fill="#e9d2bd"/>
      <path d="M68 111c-23-26-12-49 9-46 19 2 19 23 7 28-9 4-14-3-10-8m114 26c23-26 12-49-9-46-19 2-19 23-7 28 9 4 14-3 10-8" fill="none" stroke="#ae8b71" stroke-width="12"/>
      <path d="M69 106c-14-17-1-39 18-35 1-21 26-28 41-13 15-15 40-8 41 13 19-4 32 18 18 35 14 18 1 39-16 39-6 25-31 29-43 14-12 15-37 11-43-14-17 0-30-21-16-39Z" fill="url(#coat)"/>
      <ellipse cx="128" cy="128" rx="46" ry="46" fill="#f0d8b9" stroke="none"/>
      <path d="M94 90c-7-13 7-23 18-16 3-18 29-18 32 0 11-7 25 3 18 16-11 16-57 16-68 0Z" fill="#fffaf0" stroke-width="3"/>`,
    face: `${EYES}${CHEEKS}${NOSE}${SMILE}`
  },
  monkey: {
    title: '원숭이', colors: ['#c99a78', '#9c715f'], light: '#f6dfbc',
    back: '<path d="M166 207c49 16 67-22 40-29-16-4-24 15-8 19" fill="none" stroke="#9c715f" stroke-width="13"/>',
    head: `
      <circle cx="65" cy="117" r="24" fill="url(#coat)"/><circle cx="191" cy="117" r="24" fill="url(#coat)"/>
      <g fill="#edc5ad" stroke="none"><circle cx="65" cy="117" r="13"/><circle cx="191" cy="117" r="13"/></g>
      <ellipse cx="128" cy="117" rx="64" ry="62" fill="url(#coat)"/>
      <path d="M84 124c-10-38 25-53 44-29 19-24 54-9 44 29 15 30-6 48-44 48s-59-18-44-48Z" fill="#f6dfbc" stroke="none"/>
      <path d="m112 61 10-15 7 12 12-9 3 17" fill="url(#coat)" stroke-width="3"/>`,
    face: `${EYES}${CHEEKS}${NOSE}<path d="M114 149q14 16 28 0" fill="none" stroke-width="3.5"/>`
  },
  rooster: {
    title: '닭', colors: ['#fff9e8', '#ecdfbe'], light: '#fff1cb',
    back: `
      <path d="M163 203q34-5 45-44-31 4-45 24Z" fill="#7fbea8"/>
      <path d="M164 208q46 8 59-21-28-9-48 6Z" fill="#7d9bc4"/>
      <path d="M163 211q32 23 47 4-20-16-37-16Z" fill="#e49b84"/>`,
    head: `
      <path d="M106 80c-20-14-9-37 6-28-7-28 21-36 29-11 19-14 36 9 17 29l-15 19Z" fill="#e98b8a"/>
      <ellipse cx="128" cy="121" rx="59" ry="58" fill="url(#coat)"/>
      <path d="M115 155c-11 32 25 42 26 9l-9-16Z" fill="#e98b8a" stroke-width="4"/>`,
    face: `${EYES}${CHEEKS}<path d="m128 133 15 11-15 12-15-12Z" fill="#efbd64" stroke-width="3.5"/>`
  },
  dog: {
    title: '개', colors: ['#f7d6ac', '#dfae7c'], light: '#fff0d7',
    back: '<path d="M164 206q42 4 38-29" fill="none" stroke="#d4a178" stroke-width="14"/>',
    head: `
      <path d="M86 76c-29-16-42 19-34 57 6 24 23 18 30-2l15-32m73-23c29-16 42 19 34 57-6 24-23 18-30-2l-15-32" fill="#b9876a"/>
      <ellipse cx="128" cy="122" rx="61" ry="59" fill="url(#coat)"/>
      <path d="M82 102c7-34 39-35 41-6 2 25-16 35-33 24Z" fill="#bc8a6d" stroke="none"/>
      <ellipse cx="128" cy="147" rx="33" ry="23" fill="#fff0d7" stroke="none"/>`,
    face: `${EYES}${CHEEKS}<path d="M118 136q10-6 20 0l-10 10Z" fill="#695362" stroke="none"/><path d="M122 153v9c0 12 14 12 14 0v-9" fill="#ed9dac" stroke-width="3"/><path d="M115 149q6 8 13 0 7 8 13 0" fill="none" stroke-width="3"/>`
  },
  pig: {
    title: '돼지', colors: ['#f8c9d6', '#e8a5bd'], light: '#ffe5e7',
    back: '<path d="M169 206c28 12 48-12 29-18-13-4-18 12-6 14" fill="none" stroke="#d38fa8" stroke-width="8"/>',
    head: `
      <path d="M77 89 67 48q-1-9 8-6l37 24m67 23 10-41q1-9-8-6l-37 24" fill="url(#coat)"/>
      <path d="m79 54 8 25 14-12m76-13-8 25-14-12" fill="#dc97b3" stroke="none"/>
      <ellipse cx="128" cy="121" rx="67" ry="59" fill="url(#coat)"/>
      <ellipse cx="128" cy="145" rx="33" ry="23" fill="#eba6bd" stroke="#b77a99" stroke-width="3.5"/>`,
    face: `${EYES}${CHEEKS}<g fill="#b77a99" stroke="none"><ellipse cx="117" cy="145" rx="4" ry="6"/><ellipse cx="139" cy="145" rx="4" ry="6"/></g>`
  }
};

function renderZodiacSvg(spec) {
  const body = spec.body || `
    <ellipse cx="128" cy="186" rx="45" ry="37" fill="url(#coat)"/>
    <ellipse cx="128" cy="190" rx="27" ry="25" fill="${spec.light}" stroke="none"/>
    <ellipse cx="87" cy="182" rx="10" ry="18" transform="rotate(18 87 182)" fill="url(#coat)"/>
    <ellipse cx="169" cy="182" rx="10" ry="18" transform="rotate(-18 169 182)" fill="url(#coat)"/>
    <ellipse cx="105" cy="218" rx="19" ry="11" fill="url(#coat)"/>
    <ellipse cx="151" cy="218" rx="19" ry="11" fill="url(#coat)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256" role="img" aria-labelledby="title">
  <title id="title">${spec.title} 수호메이트</title>
  <defs><linearGradient id="coat" x1=".25" y1="0" x2=".7" y2="1"><stop stop-color="${spec.colors[0]}"/><stop offset="1" stop-color="${spec.colors[1]}"/></linearGradient></defs>
  <ellipse cx="128" cy="232" rx="65" ry="9" fill="#252334" opacity=".12"/>
  <g stroke="#504454" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round">
    ${spec.back || ''}${body}${spec.head}${spec.face}
  </g>
</svg>\n`;
}

// Drawn on a separate 32-cell grid: each cell is 3px at the maximum 96px display size.
const PIXEL_HEAD = [
  '.....##########.....', '...##############...', '..################..',
  '.##################.', '####################', '####################',
  '####################', '####################', '####################',
  '####################', '####################', '.##################.',
  '..################..', '...##############...', '.....##########.....'
];
const PIXEL_BODY = ['..########..', '.##########.', '############', '############',
  '############', '############', '.##########.', '..########..'];
const PIXEL_EAR = ['..###..', '.#####.', '#######', '#######', '#######', '.#####.', '..###..'];
const PIXEL_PALETTES = {
  rat: ['#a4a1dc', '#706eaa', '#ede8ff'],
  ox: ['#ce9965', '#956441', '#ffe1a3'],
  tiger: ['#ffb63e', '#d5792e', '#fff0bd'],
  rabbit: ['#fff3ed', '#d4b8d7', '#fffafa'],
  dragon: ['#43c28e', '#25876e', '#e8e69b'],
  snake: ['#9bcf54', '#5c9e42', '#f5e6a4'],
  horse: ['#d69358', '#8f5746', '#ffe4b5'],
  sheep: ['#fff2d4', '#c8b1a7', '#d89f72'],
  monkey: ['#b77c51', '#795143', '#ffda9e'],
  rooster: ['#ffedbc', '#c5ad81', '#fff9de'],
  dog: ['#eeb864', '#a66c42', '#fff0c9'],
  pig: ['#ef9eb6', '#c66b96', '#ffd4d7']
};

function renderPixelDrawing(id) {
  const [coat, shade, light] = PIXEL_PALETTES[id];
  const ink = '#292638', pink = '#ee789b', white = '#fffafa', gold = '#f4c05e';
  const grid = Array.from({ length: 32 }, () => Array(32).fill(null));
  const box = (x, y, width, height, color) => {
    assert.ok(x >= 0 && y >= 0 && x + width <= 32 && y + height <= 32);
    for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++) {
      grid[y + dy][x + dx] = color;
    }
  };
  const stamp = (x, y, rows, color) => {
    const inside = (dx, dy) => rows[dy]?.[dx] === '#';
    rows.forEach((row, dy) => [...row].forEach((cell, dx) => {
      if (cell !== '#') return;
      const edge = [[0, -1], [0, 1], [-1, 0], [1, 0]].some(([sx, sy]) => !inside(dx + sx, dy + sy));
      box(x + dx, y + dy, 1, 1, edge ? ink : color);
    }));
  };
  // Tails and ears sit behind the body; every feature stays on the integer grid.
  if (id === 'rat' || id === 'pig' || id === 'monkey') {
    stamp(23, 22, ['..#####', '..#####', '.....##', '##...##', '#######', '.#####.'], id === 'monkey' ? shade : pink);
  }
  if (id === 'tiger' || id === 'dog') {
    stamp(23, 20, ['...###', '...###', '...###', '######', '######', '.####.'], coat);
    if (id === 'tiger') box(27, 22, 2, 1, ink);
  }
  if (id === 'dragon') {
    stamp(1, 17, ['#.......', '###.....', '#####...', '.#######', '..######', '....####'], '#827bc2');
    stamp(23, 17, ['.......#', '.....###', '...#####', '#######.', '######..', '####....'], '#827bc2');
  }
  if (id === 'rooster') {
    stamp(22, 19, ['.....##', '...####', '.######', '#######', '######.', '#####..'], '#3a9f86');
    box(26, 22, 2, 2, '#527cb4');
  }
  if (['rat', 'tiger', 'monkey'].includes(id)) {
    stamp(4, id === 'monkey' ? 10 : 4, PIXEL_EAR, coat);
    stamp(21, id === 'monkey' ? 10 : 4, PIXEL_EAR, coat);
    box(6, id === 'monkey' ? 12 : 6, 3, 3, id === 'tiger' ? light : pink);
    box(23, id === 'monkey' ? 12 : 6, 3, 3, id === 'tiger' ? light : pink);
  }
  if (id === 'rabbit' || id === 'horse') {
    const ears = ['.###.', '#####', '#####', '#####', '#####', '#####', '#####', '.###.'];
    stamp(8, 1, ears, coat); stamp(19, 1, ears, coat);
    box(10, 3, 1, 4, pink); box(21, 3, 1, 4, pink);
  }
  if (id === 'ox' || id === 'sheep') {
    stamp(3, 9, ['.####', '#####', '#####', '.####'], coat);
    stamp(24, 9, ['####.', '#####', '#####', '####.'], coat);
    stamp(5, 3, ['###...', '###...', '###...', '######', '.#####', '..####'], gold);
    stamp(21, 3, ['...###', '...###', '...###', '######', '#####.', '####..'], gold);
  }
  if (id === 'dragon') {
    stamp(7, 1, ['###....', '####...', '.####..', '.#####.', '..#####', '..#####', '...####'], gold);
    stamp(18, 1, ['....###', '...####', '..####.', '.#####.', '#####..', '#####..', '####...'], gold);
    stamp(3, 10, ['##..', '####', '####', '####', '##..'], shade);
    stamp(25, 10, ['..##', '####', '####', '####', '..##'], shade);
  }
  if (id === 'pig') {
    stamp(6, 3, ['###....', '#####..', '######.', '#######', '#######', '.######'], coat);
    stamp(19, 3, ['....###', '..#####', '.######', '#######', '#######', '######.'], coat);
    box(8, 5, 2, 2, shade); box(22, 5, 2, 2, shade);
  }
  if (id === 'rooster') {
    stamp(11, 1, ['...###....', '...###.##.', '.#########', '##########', '#########.', '.#######..', '..#####...'], pink);
  }
  if (id === 'snake') {
    stamp(6, 23, ['...############...', '.################.', '##################', '##################', '.################.', '...############...'], coat);
    box(11, 26, 11, 1, shade);
    stamp(11, 18, ['..######..', '.########.', '##########', '##########', '##########', '##########', '.########.', '..######..'], coat);
    box(14, 21, 4, 5, light); box(14, 23, 4, 1, shade);
  } else {
    stamp(9, 26, ['.#####.', '#######', '#######', '.#####.'], coat);
    stamp(16, 26, ['.#####.', '#######', '#######', '.#####.'], coat);
    stamp(10, 21, PIXEL_BODY, coat);
    box(13, 23, 6, 4, light); box(14, 27, 4, 1, light);
    box(20, 23, 1, 3, shade);
    stamp(7, 21, ['.##', '###', '###', '.##'], coat);
    stamp(22, 21, ['##.', '###', '###', '##.'], coat);
  }
  stamp(6, 8, PIXEL_HEAD, coat);
  box(23, 13, 2, 5, shade); box(21, 19, 3, 1, shade); box(20, 20, 3, 1, shade);
  box(10, 10, 5, 1, light); box(9, 11, 3, 1, light);
  if (id === 'monkey') {
    stamp(9, 11, ['.####..####.', '############', '############', '############', '############', '############', '.##########.', '..########..'], light);
  }
  if (id === 'sheep') {
    stamp(8, 12, ['..############..', '.##############.', '################', '################', '################', '.##############.', '..############..'], light);
    box(9, 8, 3, 3, white); box(14, 7, 4, 4, white); box(20, 8, 3, 3, white);
    box(13, 10, 1, 1, shade); box(19, 10, 1, 1, shade);
  }
  if (id === 'horse') {
    stamp(11, 5, ['...#####.', '.########', '########.', '#######..', '.#####...'], shade);
    box(15, 10, 2, 6, light);
  }
  if (id === 'dog') { stamp(5, 7, ['.####', '#####', '#####', '#####', '#####', '#####', '.###.'], shade);
    stamp(22, 7, ['####.', '#####', '#####', '#####', '#####', '#####', '.###.'], shade); }
  if (id === 'tiger') {
    box(15, 9, 2, 3, ink); box(11, 9, 2, 2, ink); box(19, 9, 2, 2, ink);
    box(7, 14, 2, 1, ink); box(7, 17, 2, 1, ink); box(23, 14, 2, 1, ink); box(23, 17, 2, 1, ink);
  }
  if (id === 'ox' || id === 'horse' || id === 'pig') {
    stamp(10, 17, ['.##########.', '############', '############', '.##########.'], id === 'pig' ? shade : light);
    box(13, 18, 1, 1, ink); box(18, 18, 1, 1, ink);
  } else if (id === 'dragon') {
    box(12, 17, 8, 3, light); box(13, 17, 1, 1, shade); box(18, 17, 1, 1, shade);
    box(15, 9, 2, 2, gold);
  } else {
    box(12, 17, 8, 3, light);
    box(15, 17, 2, 1, id === 'rooster' ? gold : ink);
  }
  box(11, 14, 2, 3, ink); box(19, 14, 2, 3, ink);
  box(11, 14, 1, 1, white); box(19, 14, 1, 1, white);
  if (!['ox', 'pig', 'horse'].includes(id)) {
    box(9, 18, 2, 1, pink); box(21, 18, 2, 1, pink);
    box(14, 20, 4, 1, ink);
  }
  if (id === 'rat') { box(7, 19, 3, 1, ink); box(22, 19, 3, 1, ink); }
  if (id === 'rabbit') { box(15, 18, 2, 1, pink); box(15, 19, 1, 1, ink); }
  if (id === 'snake') { box(15, 20, 2, 3, pink); box(14, 22, 1, 1, pink); box(17, 22, 1, 1, pink); }
  if (id === 'dog') { box(15, 20, 2, 2, pink); }
  if (id === 'rooster') {
    box(14, 17, 4, 1, gold); box(13, 18, 6, 1, gold); box(15, 19, 2, 1, gold);
    box(15, 20, 2, 3, pink); box(11, 29, 2, 1, gold); box(19, 29, 2, 1, gold);
  }
  return grid;
}

function renderPixelSvg(grid, title) {
  const colors = new Map();
  grid.forEach((row, y) => row.forEach((color, x) => {
    if (color) colors.set(color, `${colors.get(color) || ''}M${x} ${y}h1v1h-1Z`);
  }));
  assert.ok(colors.size <= 10);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 32 32" shape-rendering="crispEdges" role="img" aria-label="${title} 도트 수호메이트">\n${[...colors].map(([fill, d]) => `<path fill="${fill}" d="${d}"/>`).join('\n')}\n</svg>\n`;
}

for (const [id, spec] of Object.entries(ZODIAC_VECTORS)) {
  const svg = renderZodiacSvg(spec);
  assert.match(svg, /viewBox="0 0 256 256"/);
  assert.doesNotMatch(svg, /<image|<script|data:image|https?:\/\/(?!www\.w3\.org)/);
  const outFile = path.join(zodiacOutDir, `${id}.svg`);
  fs.writeFileSync(outFile, svg.replace(/[ \t]+$/gm, ''));
  console.log(`Generated ${path.relative(rootDir, outFile)} (${Buffer.byteLength(svg)} bytes)`);
  const pixelSvg = renderPixelSvg(renderPixelDrawing(id), spec.title);
  assert.doesNotMatch(pixelSvg, /<image|data:image/);
  fs.writeFileSync(path.join(zodiacOutDir, `${id}-pixel.svg`), pixelSvg);
}
assert.equal(Object.keys(ZODIAC_VECTORS).length, 12);


// Generate macOS Menu Bar Tray CI Icon (16x16 grid -> 16x16 & 32x32 black template icons)
const trayPalette = {
  B: '#000000'
};
const trayGrid = [
  '................',
  '................',
  '..BBB..BBBBBBB..',
  '..BBB..BBBBBBB..',
  '................',
  '..BBB..BBBBBB...',
  '..BBB..BBBBBB...',
  '................',
  '..BBB..BBBB.....',
  '..BBB..BBBB.....',
  '................',
  '.BBBBBBBBBBBBBB.',
  '.BBBBBBBBBBBBBB.',
  '..BBBBBBBBBBBB..',
  '................',
  '................'
];

const tray32 = renderGridToPng(trayGrid, trayPalette, 2);
const tray16 = renderGridToPng(trayGrid, trayPalette, 1);
fs.writeFileSync(trayOutPath, tray32);
fs.writeFileSync(tray16OutPath, tray16);
fs.writeFileSync(path.join(rootDir, 'electron', 'tray-iconTemplate.png'), tray16);
fs.writeFileSync(path.join(rootDir, 'electron', 'tray-iconTemplate@2x.png'), tray32);
console.log(
  `Generated ${path.relative(rootDir, trayOutPath)}, tray-icon-16.png, tray-iconTemplate.png, and tray-iconTemplate@2x.png`
);

// Generate 512x512 DotDock Brand CI Icon (macOS Squircle + 3 Dot-Quota Bars + Dock Pill)
function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function mixRgb(a, b, t) {
  const k = clamp01(t);
  return [
    a[0] + (b[0] - a[0]) * k,
    a[1] + (b[1] - a[1]) * k,
    a[2] + (b[2] - a[2]) * k
  ];
}

function blendOver(dst, srcRgb, srcAlpha) {
  const sa = clamp01(srcAlpha);
  const da = dst[3];
  const outA = sa + da * (1 - sa);
  if (outA <= 0) return [0, 0, 0, 0];
  return [
    (srcRgb[0] * sa + dst[0] * da * (1 - sa)) / outA,
    (srcRgb[1] * sa + dst[1] * da * (1 - sa)) / outA,
    (srcRgb[2] * sa + dst[2] * da * (1 - sa)) / outA,
    outA
  ];
}

function sdRoundedBox(px, py, cx, cy, halfW, halfH, r) {
  const dx = Math.abs(px - cx) - (halfW - r);
  const dy = Math.abs(py - cy) - (halfH - r);
  const ax = Math.max(dx, 0);
  const ay = Math.max(dy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - r;
}

function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}

function generateBrandCiPng(size = 512) {
  const s = size / 512;
  const rgba = Buffer.alloc(size * size * 4);

  const bgTopLeft = [10, 16, 36];
  const bgBottomRight = [23, 37, 84];
  const glowCyan = [56, 189, 248];
  const glowIndigo = [99, 102, 241];

  const rows = [
    { cy: 164, barEnd: 388, c0: [16, 185, 129], c1: [52, 211, 153] }, // Emerald
    { cy: 224, barEnd: 332, c0: [245, 158, 11], c1: [251, 146, 60] }, // Amber
    { cy: 284, barEnd: 364, c0: [56, 189, 248], c1: [129, 140, 248] } // Sky-Indigo
  ];

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      // Work in 512x512 virtual space
      const x = (px + 0.5) / s;
      const y = (py + 0.5) / s;

      let pixel = [0, 0, 0, 0];

      // Soft ambient drop shadow beneath squircle
      const shadowDist = sdRoundedBox(x, y - 8, 256, 256, 212, 212, 96);
      if (shadowDist < 28) {
        const shadowAlpha = Math.exp(-Math.max(shadowDist, 0) * 0.14) * 0.36;
        pixel = blendOver(pixel, [2, 6, 23], shadowAlpha);
      }

      // Main macOS squircle tile
      const tileDist = sdRoundedBox(x, y, 256, 256, 212, 212, 96);
      const tileAlpha = clamp01(0.5 - tileDist);

      if (tileAlpha > 0) {
        const diagT = clamp01((x + y - 96) / 832);
        let tileColor = mixRgb(bgTopLeft, bgBottomRight, diagT);

        // Subtle cyan/indigo radial bloom inside the dark navy tile
        const bloomTop = Math.exp(-Math.hypot(x - 168, y - 162) / 185) * 0.24;
        const bloomBottom = Math.exp(-Math.hypot(x - 344, y - 348) / 210) * 0.26;
        tileColor = mixRgb(tileColor, glowCyan, bloomTop);
        tileColor = mixRgb(tileColor, glowIndigo, bloomBottom);

        // Crisp 2.5px inner rim highlight
        if (tileDist > -3.5) {
          const rimFactor = clamp01(1 - Math.abs(tileDist + 1.5) / 2.0);
          const topHighlight = clamp01(1 - (y - 44) / 360);
          const rimColor = mixRgb([99, 102, 241], [148, 216, 255], topHighlight);
          tileColor = mixRgb(tileColor, rimColor, rimFactor * (0.2 + 0.35 * topHighlight));
        }

        // Blend inner CI layers directly in tileColor space so alpha edges stay crisp
        let tilePixel = [tileColor[0], tileColor[1], tileColor[2], 1];

        // 3 Dot + Quota Bar rows
        for (const row of rows) {
          // Track behind bar (subtle dark glass slot)
          const trackDist = sdRoundedBox(x, y, 287, row.cy, 101, 14, 14);
          const trackAlpha = clamp01(0.5 - trackDist) * 0.12;
          if (trackAlpha > 0) {
            tilePixel = blendOver(tilePixel, [226, 232, 240], trackAlpha);
          }

          // Colored Dot (cx = 144, r = 20) + subtle radial glow
          const dotDist = sdCircle(x, y, 144, row.cy, 20);
          if (dotDist < 18) {
            const halo = Math.exp(-Math.max(dotDist, 0) * 0.22) * 0.22;
            tilePixel = blendOver(tilePixel, row.c1, halo);
          }
          const dotAlpha = clamp01(0.5 - dotDist);
          if (dotAlpha > 0) {
            const dotT = clamp01((y - (row.cy - 20)) / 40);
            const dotColor = mixRgb(row.c1, row.c0, dotT);
            tilePixel = blendOver(tilePixel, dotColor, dotAlpha);
          }

          // Active Quota Bar (x = 186..barEnd, halfH = 14)
          const barStart = 186;
          const barHalfW = (row.barEnd - barStart) / 2;
          const barCx = barStart + barHalfW;
          const barDist = sdRoundedBox(x, y, barCx, row.cy, barHalfW, 14, 14);
          const barAlpha = clamp01(0.5 - barDist);
          if (barAlpha > 0) {
            const barT = clamp01((x - barStart) / (barHalfW * 2));
            const barColor = mixRgb(row.c0, row.c1, barT);
            tilePixel = blendOver(tilePixel, barColor, barAlpha);
          }
        }

        // Luminous Dock Pill Base (x = 116..396, cy = 354, halfH = 19)
        const dockDist = sdRoundedBox(x, y, 256, 354, 140, 19, 19);
        if (dockDist < 16) {
          const dockGlow = Math.exp(-Math.max(dockDist, 0) * 0.24) * 0.18;
          tilePixel = blendOver(tilePixel, [56, 189, 248], dockGlow);
        }
        const dockAlpha = clamp01(0.5 - dockDist);
        if (dockAlpha > 0) {
          const dockT = clamp01((y - 335) / 38);
          const dockColor = mixRgb([241, 245, 249], [148, 163, 184], dockT);
          tilePixel = blendOver(tilePixel, dockColor, dockAlpha);

          // Centered cyan dock indicator strip inside the dock pill
          const stripDist = sdRoundedBox(x, y, 256, 354, 52, 5, 5);
          const stripAlpha = clamp01(0.5 - stripDist);
          if (stripAlpha > 0) {
            tilePixel = blendOver(tilePixel, [14, 165, 233], stripAlpha * 0.88);
          }
        }

        pixel = blendOver(pixel, tilePixel.slice(0, 3), tileAlpha);
      }

      const idx = (py * size + px) * 4;
      rgba[idx] = Math.round(pixel[0]);
      rgba[idx + 1] = Math.round(pixel[1]);
      rgba[idx + 2] = Math.round(pixel[2]);
      rgba[idx + 3] = Math.round(clamp01(pixel[3]) * 255);
    }
  }

  return encodePng(size, size, rgba);
}

const appCiPng512 = generateBrandCiPng(512);
const electronAppIconPath = path.join(rootDir, 'electron', 'app-icon.png');
const srcAppIconPath = path.join(rootDir, 'src', 'assets', 'app-icon.png');
fs.mkdirSync(path.dirname(srcAppIconPath), { recursive: true });
fs.writeFileSync(electronAppIconPath, appCiPng512);
fs.writeFileSync(srcAppIconPath, appCiPng512);
console.log(
  `Generated ${path.relative(rootDir, electronAppIconPath)} and ${path.relative(rootDir, srcAppIconPath)} (${appCiPng512.length} bytes)`
);
