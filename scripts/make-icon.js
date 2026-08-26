#!/usr/bin/env node
'use strict';

/**
 * Gera o ícone do app a partir de uma grade de pixel art 32x32, na mesma
 * paleta de src/renderer/style.css. Sem dependências: escreve o PNG na mão
 * (zlib é embutido no Node) e deixa o resto para sips/iconutil do macOS.
 *
 *   node scripts/make-icon.js      → build/icon.png (1024x1024)
 *
 * O icon.icns é montado pelo scripts/make-icon.sh, que chama este aqui.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PALETTE = {
  '.': null, // transparente
  b: '#F3E7DA', // surface
  B: '#C49A78', // corpo do bichinho (secondary)
  s: '#A67C58', // sombra do corpo
  l: '#E4D3C1', // luz do corpo
  e: '#2D2926', // text — olhos
  o: '#F2994A' // primary — só o token, que é o destaque
};

// 32x32. O bichinho é o mesmo blob de olhos grandes do sprite,
// e o ponto laranja é o token que ele come.
const ART = [
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'bbbbbbbbbbbbbboooobbbbbbbbbbbbbb',
  'bbbbbbbbbbbbboooooobbbbbbbbbbbbb',
  'bbbbbbbbbbbbboooooobbbbbbbbbbbbb',
  'bbbbbbbbbbbbbbooooBbbbbbbbbbbbbb',
  'bbbbbbbbbbblllBBBBBBBlbbbbbbbbbb',
  'bbbbbbbbbllBBBBBBBBBBBBlbbbbbbbb',
  'bbbbbbbblBBBBBBBBBBBBBBBlbbbbbbb',
  'bbbbbbblBBBBBBBBBBBBBBBBBlbbbbbb',
  'bbbbbbBBBBeeeBBBBBBeeeBBBBBbbbbb',
  'bbbbbbBBBBeeeBBBBBBeeeBBBBBbbbbb',
  'bbbbbBBBBBeeeBBBBBBeeeBBBBBBbbbb',
  'bbbbbBBBBBBBBBBBBBBBBBBBBBBBbbbb',
  'bbbbbBBBBBBBBBBBBBBBBBBBBBBBbbbb',
  'bbbbbBBBBBBBBeeeeeeBBBBBBBBBbbbb',
  'bbbbbsBBBBBBBBBBBBBBBBBBBBsbbbbb',
  'bbbbbbsBBBBBBBBBBBBBBBBBBsbbbbbb',
  'bbbbbbbssBBBBBBBBBBBBBBssbbbbbbb',
  'bbbbbbbbbsssBBBBBBBBsssbbbbbbbbb',
  'bbbbbbbbbbbbssssssssbbbbbbbbbbbb',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
];

const GRID = 32;
const SCALE = 32; // 32 * 32 = 1024
const SIZE = GRID * SCALE;

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ];
}

/** Canto arredondado: fora do raio vira transparente, no estilo squircle do macOS. */
function insideRounded(x, y, size, radius) {
  const nearX = x < radius ? radius - x : x > size - radius ? x - (size - radius) : 0;
  const nearY = y < radius ? radius - y : y > size - radius ? y - (size - radius) : 0;
  if (nearX === 0 || nearY === 0) return true;
  return nearX * nearX + nearY * nearY <= radius * radius;
}

function buildRgba() {
  const radius = Math.round(SIZE * 0.22);
  const rgba = Buffer.alloc(SIZE * SIZE * 4);

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const cell = ART[Math.floor(y / SCALE)][Math.floor(x / SCALE)];
      const hex = PALETTE[cell];
      const i = (y * SIZE + x) * 4;

      if (!hex || !insideRounded(x, y, SIZE, radius)) {
        rgba[i + 3] = 0;
        continue;
      }
      const [r, g, b] = hexToRgb(hex);
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

// --- PNG mínimo, escrito na mão ---

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Cada scanline leva um byte de filtro (0 = None) na frente.
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const src = y * width * 4;
    const dst = y * (width * 4 + 1);
    raw[dst] = 0;
    rgba.copy(raw, dst + 1, src, src + width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

for (const row of ART) {
  if (row.length !== GRID) throw new Error(`linha com ${row.length} colunas, esperado ${GRID}`);
}
if (ART.length !== GRID) throw new Error(`arte com ${ART.length} linhas, esperado ${GRID}`);

const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'icon.png');
fs.writeFileSync(out, encodePng(SIZE, SIZE, buildRgba()));
console.log(`icone gerado: ${out} (${SIZE}x${SIZE})`);
