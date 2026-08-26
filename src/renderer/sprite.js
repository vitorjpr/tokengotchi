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
  const healthy = '#C49A78';
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
  const grid = GRIDS[stage] || GRIDS.filhote;
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

  const eyes = EYES[stage];
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
