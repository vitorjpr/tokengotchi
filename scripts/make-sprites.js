#!/usr/bin/env node
'use strict';

/**
 * Renderiza os sprites do bichinho para PNG, para uso no README.
 *
 *   node scripts/make-sprites.js   → docs/sprites/*.png
 *
 * O ponto aqui é NÃO redesenhar nada: este script carrega o
 * src/renderer/sprite.js de verdade e chama o mesmo draw() que o app usa,
 * contra um canvas 2D falso que grava os fillRect num buffer de pixels.
 * Se o sprite mudar no app, a imagem do README muda junto — e se alguém
 * quebrar o desenho, isto quebra também.
 *
 * Sem dependências: PNG escrito na mão, como em scripts/make-icon.js.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

const SCALE = 8; // 16px de arte * 8 = 128px por sprite
const CSS_SIZE = 16 * SCALE;

// --- canvas 2D mínimo: só o que o sprite.js encosta ---

function createFakeCanvas(size, background) {
  const rgba = Buffer.alloc(size * size * 4);
  if (background) paintAll(rgba, background);

  const ctx = {
    imageSmoothingEnabled: true,
    fillStyle: '#000000',
    clearRect(x, y, w, h) {
      fillRect(rgba, size, x, y, w, h, background || null);
    },
    fillRect(x, y, w, h) {
      fillRect(rgba, size, x, y, w, h, this.fillStyle);
    }
  };

  return {
    width: size,
    height: size,
    clientWidth: CSS_SIZE,
    getContext: () => ctx,
    _rgba: rgba
  };
}

/**
 * Aceita as duas notações que o sprite.js produz: literais hexadecimais das
 * constantes e `rgb(r, g, b)`, que é o que o mix() dele devolve.
 */
function parseColor(value) {
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(value);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];

  const clean = String(value).replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const parsed = [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16)
  ];
  if (parsed.some(Number.isNaN)) {
    throw new Error(`cor não reconhecida: ${value}`);
  }
  return parsed;
}

function paintAll(rgba, hex) {
  const [r, g, b] = parseColor(hex);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = 255;
  }
}

function fillRect(rgba, size, x, y, w, h, hex) {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(size, Math.round(x + w));
  const y1 = Math.min(size, Math.round(y + h));

  // hex nulo = clearRect sem fundo: volta a transparente.
  const rgb = hex ? parseColor(hex) : null;

  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      const i = (py * size + px) * 4;
      if (!rgb) {
        rgba[i] = rgba[i + 1] = rgba[i + 2] = rgba[i + 3] = 0;
        continue;
      }
      rgba[i] = rgb[0];
      rgba[i + 1] = rgb[1];
      rgba[i + 2] = rgb[2];
      rgba[i + 3] = 255;
    }
  }
}

// --- carrega o sprite.js real num sandbox ---

function loadSprite() {
  const file = path.join(__dirname, '..', 'src', 'renderer', 'sprite.js');
  const code = fs.readFileSync(file, 'utf8');
  const sandbox = { window: { devicePixelRatio: 1 }, Math, console };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: file });
  if (!sandbox.window.TokengotchiSprite) {
    throw new Error('sprite.js não expôs window.TokengotchiSprite');
  }
  return sandbox.window.TokengotchiSprite;
}

// --- PNG (mesmo encoder do make-icon.js) ---

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
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

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    const src = y * size * 4;
    const dst = y * (size * 4 + 1);
    raw[dst] = 0;
    rgba.copy(raw, dst + 1, src, src + size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// --- o que renderizar ---

// Fundo igual ao da "telinha" do app (var --screen no style.css),
// para o sprite no README aparecer como aparece de verdade.
const SCREEN = '#241f1c';

const SHOTS = [
  // evolução, todos saudáveis e felizes
  { file: 'estagio-ovo', stage: 'ovo', mood: 'feliz', health: 100 },
  { file: 'estagio-broto', stage: 'broto', mood: 'feliz', health: 100 },
  { file: 'estagio-filhote', stage: 'filhote', mood: 'feliz', health: 100 },
  { file: 'estagio-jovem', stage: 'jovem', mood: 'feliz', health: 100 },
  { file: 'estagio-adulto', stage: 'adulto', mood: 'feliz', health: 100 },
  { file: 'estagio-anciao', stage: 'anciao', mood: 'feliz', health: 100 },

  // reações, todas no mesmo estágio para a diferença ser o humor
  { file: 'humor-feliz', stage: 'adulto', mood: 'feliz', health: 100 },
  { file: 'humor-comendo', stage: 'adulto', mood: 'feliz', health: 100, eating: true, frame: 0 },
  { file: 'humor-dormindo', stage: 'adulto', mood: 'dormindo', health: 100, frame: 8 },
  { file: 'humor-com-fome', stage: 'adulto', mood: 'com fome', health: 100 },
  { file: 'humor-faminto', stage: 'adulto', mood: 'faminto', health: 70 },
  { file: 'humor-fraco', stage: 'adulto', mood: 'fraco', health: 25 },
  { file: 'humor-morto', stage: 'adulto', mood: 'morto', health: 0, dead: true }
];

function render(shot) {
  const canvas = createFakeCanvas(CSS_SIZE, SCREEN);
  sprite.draw(
    canvas,
    {
      stage: shot.stage,
      mood: shot.mood,
      health: shot.health,
      dead: shot.dead === true,
      eating: shot.eating === true
    },
    shot.frame ?? 0
  );
  return canvas._rgba;
}

/** Cola vários sprites lado a lado numa tira só, com uma folga entre eles. */
function strip(frames, gap) {
  const width = frames.length * CSS_SIZE + (frames.length - 1) * gap;
  const out = Buffer.alloc(width * CSS_SIZE * 4);

  const [br, bg, bb] = parseColor(SCREEN);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = br;
    out[i + 1] = bg;
    out[i + 2] = bb;
    out[i + 3] = 255;
  }

  frames.forEach((rgba, index) => {
    const offsetX = index * (CSS_SIZE + gap);
    for (let y = 0; y < CSS_SIZE; y += 1) {
      for (let x = 0; x < CSS_SIZE; x += 1) {
        const src = (y * CSS_SIZE + x) * 4;
        if (rgba[src + 3] === 0) continue;
        const dst = (y * width + offsetX + x) * 4;
        rgba.copy(out, dst, src, src + 4);
      }
    }
  });

  return { width, height: CSS_SIZE, rgba: out };
}

function encodePngWH(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
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

const sprite = loadSprite();
const outDir = path.join(__dirname, '..', 'docs', 'sprites');
fs.mkdirSync(outDir, { recursive: true });

for (const shot of SHOTS) {
  const rgba = render(shot);
  fs.writeFileSync(path.join(outDir, `${shot.file}.png`), encodePng(CSS_SIZE, rgba));
  console.log(`  ${shot.file}.png`);
}

// Tira da evolução inteira, para o topo do README.
const evolucao = strip(
  SHOTS.filter((s) => s.file.startsWith('estagio-')).map(render),
  SCALE * 2
);
fs.writeFileSync(
  path.join(outDir, 'evolucao.png'),
  encodePngWH(evolucao.width, evolucao.height, evolucao.rgba)
);
console.log('  evolucao.png');

console.log(`\n${SHOTS.length + 1} imagens em ${path.relative(process.cwd(), outDir)}/`);
