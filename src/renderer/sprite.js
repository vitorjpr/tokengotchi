'use strict';

// Cada estágio é uma grade 16x16.
//  .  vazio      B  corpo       D  sombra
//  L  luz        M  boca        C  casca do ovo
const GRIDS = {
  ovo: [
    '................',
    '................',
    '.....CCCCCC.....',
    '....CCCCCCCC....',
    '...CCCCLLCCCC...',
    '...CCCCCCCCCC...',
    '..CCCCCCCCCCCC..',
    '..CCCCCCCCCCCC..',
    '..CCCCCCCCCCCC..',
    '..CCCCCCCCCCCC..',
    '..CCCCCCCCCCCC..',
    '...CCCCCCCCCC...',
    '...DDDDDDDDDD...',
    '................',
    '................',
    '................'
  ],
  broto: [
    '................',
    '................',
    '................',
    '................',
    '.....BBBBBB.....',
    '....BBBBBBBB....',
    '....BBBBBBBB....',
    '....BBBBBBBB....',
    '....BBBMMBBB....',
    '....BBBBBBBB....',
    '.....BBBBBB.....',
    '......B..B......',
    '......B..B......',
    '......DD.DD.....',
    '................',
    '................'
  ],
  filhote: [
    '................',
    '................',
    '....BBBBBBBB....',
    '...BBBBBBBBBB...',
    '..BBBBBBBBBBBB..',
    '..BBBBBBBBBBBB..',
    '..BBBBBBBBBBBB..',
    '..BBBBBBBBBBBB..',
    '..BBBBMMMMBBBB..',
    '..BBBBBBBBBBBB..',
    '...BBBBBBBBBB...',
    '....BB....BB....',
    '....BB....BB....',
    '....BB....BB....',
    '....DD....DD....',
    '................'
  ],
  jovem: [
    '................',
    '...B........B...',
    '...BB......BB...',
    '...BBBBBBBBBB...',
    '..BBBBBBBBBBBB..',
    '.BBBBBBBBBBBBBB.',
    '.BBBBBBBBBBBBBB.',
    '.BBBBBBBBBBBBBB.',
    '.BBBBBMMMMBBBBB.',
    '.BBBBBBBBBBBBBB.',
    '..BBBBBBBBBBBB..',
    '...BBBBBBBBBB...',
    '...BB......BB...',
    '...BB......BB...',
    '...DD......DD...',
    '................'
  ],
  adulto: [
    '..B..........B..',
    '..BB........BB..',
    '..BBBBBBBBBBBB..',
    '.BBBBBBBBBBBBBB.',
    'BBBBBBBBBBBBBBBB',
    'BBBBBBBBBBBBBBBB',
    'BBBBBBBBBBBBBBBB',
    'BBBBBBBBBBBBBBBB',
    'BBBBBBMMMMBBBBBB',
    'BBBBBBBBBBBBBBBB',
    'BBBBBBBBBBBBBBBB',
    '.BBBBBBBBBBBBBB.',
    '..BBBB....BBBB..',
    '..BBBB....BBBB..',
    '..DDDD....DDDD..',
    '................'
  ],
  anciao: [
    '..B..........B..',
    '..BB........BB..',
    '..BBBBBBBBBBBB..',
    '.BBBBBBBBBBBBBB.',
    'BBBBBBBBBBBBBBBB',
    'BBBBBBBBBBBBBBBB',
    'BBBBBBBBBBBBBBBB',
    'BBBBBBBBBBBBBBBB',
    'BBBBBBMMMMBBBBBB',
    'BBBBLLLLLLLLBBBB',
    'BBBBLLLLLLLLBBBB',
    '.BBBBLLLLLLBBBB.',
    '..BBBB....BBBB..',
    '..BBBB....BBBB..',
    '..DDDD....DDDD..',
    '................'
  ],
  morto: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '..DDDDDDDDDDDD..',
    '.DBBBBBBBBBBBBD.',
    '.DBBBBBBBBBBBBD.',
    '.DBBBBBBBBBBBBD.',
    '..DDDDDDDDDDDD..',
    '................',
    '................',
    '................',
    '................'
  ]
};

// Novas formas continuam em pixel art, usando a mesma grade e animação.
GRIDS.dragao = [
  '....B......B....',
  '....BB....BB....',
  '....BBBBBBBB....',
  '...BBBBBBBBBB...',
  '...BBBBBBBBBB...',
  '...BBBBBBBBBB...',
  '...BBBBBBBBBB...',
  '....BBMMMMBB....',
  '....BBBBBBBB....',
  '....BBLLLLBB....',
  '....BBLLLLBB....',
  '...BBBLLLLBBB...',
  '..BBBBBBBBBBBB..',
  '.BBB.BB..BB.....',
  '.....DD..DD.....',
  '................'
];

function formFor(stage) {
  if (stage.startsWith('guerreiro')) return 'guerreiro';
  if (stage.startsWith('mago')) return 'mago';
  if (stage.startsWith('dragao')) return 'dragao';
  return stage;
}

// Equipamentos sobrepostos ao corpo; coordenadas na grade original 16x16.
function drawEquipment(ctx, px, bob, stage) {
  const form = formFor(stage);
  const rect = (x, y, w, h, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x * px), Math.round((y + bob) * px), Math.ceil(w * px), Math.ceil(h * px));
  };
  const steel = '#b8cad2', gold = '#e7b962', wood = '#966447';
  if (form === 'guerreiro') {
    rect(4, 10, 8, 1, wood);
    rect(7, 10, 2, 1, gold);
    rect(3, 3, 2, 1, steel);
    rect(11, 3, 2, 1, steel);
    if (stage === 'guerreiro') return;
    rect(14, 8, 1, 4, wood);
    if (stage === 'guerreiro-machado') {
      rect(14, 3, 1, 6, wood);
      rect(12, 4, 4, 3, steel);
      rect(12, 4, 1, 2, '#eef4ee');
    } else {
      const top = stage === 'guerreiro-faca' ? 6 : 2;
      rect(14, top, 1, 8 - top, steel);
      rect(13, 8, 3, 1, gold);
    }
    if (stage === 'guerreiro-escudo') {
      rect(0, 7, 4, 5, steel);
      rect(1, 8, 2, 5, '#50758e');
      rect(1, 9, 2, 1, gold);
    }
  }
  if (form === 'mago') {
    rect(6, 0, 3, 1, '#997aca');
    rect(5, 1, 5, 1, '#8061b1');
    rect(4, 2, 7, 1, '#8061b1');
    rect(2, 3, 11, 1, '#60458c');
    rect(4, 10, 8, 2, '#60458c');
    rect(7, 10, 1, 2, gold);
    rect(14, 4, 1, 10, wood);
    rect(13, 3, 3, 2, wood);
    if (stage !== 'mago') {
      rect(13, 2, 3, 2, stage === 'mago-arcano' ? gold : '#8ee5e1');
      rect(14, 1, 1, 4, '#eef4ee');
    }
    if (stage === 'mago-livro' || stage === 'mago-arcano') {
      rect(0, 8, 5, 4, stage === 'mago-arcano' ? gold : '#976cbb');
      rect(0, 9, 2, 2, '#f3e7da');
      rect(3, 9, 2, 2, '#f3e7da');
    }
  }
  if (form === 'dragao') {
    if (stage !== 'dragao') {
      const wing = stage === 'dragao-ancestral' ? '#bc9159' : '#629776';
      for (let i = 0; i < 3; i++) {
        rect(i, 4 + i, 1, 7 - i * 2, wing);
        rect(15 - i, 4 + i, 1, 7 - i * 2, wing);
      }
    }
    if (stage === 'dragao-fogo' || stage === 'dragao-ancestral') {
      rect(8, 8, 2, 2, '#ffd97e');
      rect(9, 9, 2, 2, '#eea34e');
      rect(10, 10, 3, 2, '#e27346');
      rect(12, 9, 1, 2, '#ffd97e');
    }
    if (stage === 'dragao-ancestral') {
      rect(5, 1, 6, 1, gold);
      rect(5, 0, 1, 1, gold);
      rect(8, 0, 1, 1, gold);
      rect(10, 0, 1, 1, gold);
    }
  }
}

// Onde ficam os olhos em cada estágio (canto superior esquerdo de um bloco 2x2).
const EYES = {
  ovo: null,
  broto: { left: [5, 6], right: [9, 6] },
  filhote: { left: [4, 5], right: [10, 5] },
  jovem: { left: [4, 5], right: [10, 5] },
  adulto: { left: [3, 5], right: [11, 5] },
  anciao: { left: [3, 5], right: [11, 5] },
  morto: { left: [3, 8], right: [11, 8] }
};

const SIZE = 16;

function mix(hexA, hexB, amount) {
  const a = parseInt(hexA.slice(1), 16);
  const b = parseInt(hexB.slice(1), 16);
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  const r = Math.round(ar + (br - ar) * amount);
  const g = Math.round(ag + (bg - ag) * amount);
  const bl = Math.round(ab + (bb - ab) * amount);
  return `rgb(${r}, ${g}, ${bl})`;
}

function paletteFor(state) {
  const form = formFor(state.stage);
  const healthy = form === 'dragao' ? '#79ac85' : form === 'mago' ? '#baa0cf' : '#C49A78';
  const pale = '#7A7068';
  const amount = state.dead ? 1 : Math.min(1, Math.max(0, (100 - state.health) / 100));
  const body = mix(healthy, pale, amount * 0.85);
  return {
    body,
    shade: mix(body, '#1A1614', 0.45),
    light: mix(body, '#F3E7DA', 0.45),
    shell: mix('#D8C3AC', pale, amount * 0.6),
    dark: '#171310'
  };
}

/**
 * Desenha o bichinho.
 * state: { stage, mood, health, dead }
 * frame: contador de animação (incrementa a cada quadro)
 */
function draw(canvas, state, frame) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const cssSize = canvas.clientWidth || 128;

  if (canvas.width !== Math.round(cssSize * dpr)) {
    canvas.width = Math.round(cssSize * dpr);
    canvas.height = Math.round(cssSize * dpr);
  }

  const px = (cssSize * dpr) / SIZE;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const stage = state.dead ? 'morto' : state.stage;
  const form = formFor(stage);
  const base = form === 'guerreiro' || form === 'mago' ? 'filhote' : form;
  const grid = GRIDS[base] || GRIDS.filhote;
  const colors = paletteFor(state);

  // Respiração / pulinho
  let bob = 0;
  if (!state.dead) {
    const slow = Math.floor(frame / 26) % 2;
    bob = state.mood === 'dormindo' ? slow * 0.5 : slow;
    if (state.eating) bob = Math.floor(frame / 6) % 2 ? -1.5 : 0.5;
    if (state.mood === 'fraco' || state.mood === 'faminto') bob = 0;
  }

  const fill = {
    B: colors.body,
    D: colors.shade,
    L: colors.light,
    C: colors.shell,
    M: colors.dark
  };

  const mouthOpen = state.eating && Math.floor(frame / 6) % 2 === 0;

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const cell = grid[y][x];
      if (cell === '.') continue;
      let color = fill[cell];
      if (cell === 'M' && !mouthOpen && !state.dead) color = colors.body;
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(x * px), Math.round((y + bob) * px), Math.ceil(px), Math.ceil(px));
    }
  }

  if (!state.dead) drawEquipment(ctx, px, bob, stage);
  const eyes = form === 'dragao' ? { left: [4, 5], right: [10, 5] } : EYES[base];
  if (eyes) drawEyes(ctx, px, bob, eyes, state, colors, frame);
  if (state.mood === 'dormindo' && !state.dead) drawZzz(ctx, px, frame, colors);
  if (state.eating) drawCrumbs(ctx, px, frame, colors);
}

function drawEyes(ctx, px, bob, eyes, state, colors, frame) {
  const blink = !state.dead && state.mood !== 'dormindo' && Math.floor(frame / 40) % 12 === 0;
  const closed = state.mood === 'dormindo' || blink;

  for (const key of ['left', 'right']) {
    const [ex, ey] = eyes[key];
    ctx.fillStyle = colors.dark;

    if (state.dead) {
      // Olhos em X
      ctx.fillRect(Math.round(ex * px), Math.round((ey + bob) * px), Math.ceil(px), Math.ceil(px));
      ctx.fillRect(
        Math.round((ex + 1) * px),
        Math.round((ey + 1 + bob) * px),
        Math.ceil(px),
        Math.ceil(px)
      );
      ctx.fillRect(
        Math.round((ex + 1) * px),
        Math.round((ey + bob) * px),
        Math.ceil(px),
        Math.ceil(px)
      );
      ctx.fillRect(
        Math.round(ex * px),
        Math.round((ey + 1 + bob) * px),
        Math.ceil(px),
        Math.ceil(px)
      );
      continue;
    }

    if (closed) {
      ctx.fillRect(
        Math.round(ex * px),
        Math.round((ey + 1 + bob) * px),
        Math.ceil(px * 2),
        Math.ceil(px)
      );
    } else if (state.mood === 'fraco' || state.mood === 'faminto') {
      // Olhar caído: só a metade de baixo do olho.
      ctx.fillRect(
        Math.round(ex * px),
        Math.round((ey + 1 + bob) * px),
        Math.ceil(px * 2),
        Math.ceil(px)
      );
      ctx.fillRect(
        Math.round(ex * px),
        Math.round((ey + bob) * px),
        Math.ceil(px),
        Math.ceil(px)
      );
    } else {
      ctx.fillRect(
        Math.round(ex * px),
        Math.round((ey + bob) * px),
        Math.ceil(px * 2),
        Math.ceil(px * 2)
      );
    }
  }
}

function drawZzz(ctx, px, frame, colors) {
  const steps = [0, 1, 2];
  ctx.fillStyle = colors.light;
  steps.forEach((i) => {
    const phase = (Math.floor(frame / 14) + i) % 6;
    if (phase > 3) return;
    const size = px * (0.7 + i * 0.25);
    const x = (12 + i * 0.6) * px;
    const y = (3.5 - phase * 0.8 - i * 0.5) * px;
    ctx.fillRect(Math.round(x), Math.round(y), Math.ceil(size), Math.ceil(size));
  });
}

function drawCrumbs(ctx, px, frame, colors) {
  ctx.fillStyle = colors.light;
  for (let i = 0; i < 3; i += 1) {
    const phase = (Math.floor(frame / 4) + i * 3) % 10;
    const x = (5 + i * 2.4) * px;
    const y = (9 + phase * 0.4) * px;
    ctx.fillRect(Math.round(x), Math.round(y), Math.ceil(px * 0.5), Math.ceil(px * 0.5));
  }
}

window.TokengotchiSprite = { draw };
