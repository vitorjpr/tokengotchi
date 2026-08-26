'use strict';

const el = (id) => document.getElementById(id);
const canvas = el('pet');

let state = {
  stage: 'ovo',
  mood: 'acordando',
  satiety: 0,
  health: 100,
  dead: false,
  generation: 1,
  tokensToday: 0,
  hoursUntilDeath: 0,
  secondsSinceMeal: 999,
  lastMealCalories: 0
};
let frame = 0;
let lastTokens = 0;

const MOOD_COLOR = {
  feliz: '#5f8d4e',
  bem: '#c49a78',
  'com fome': '#e89a3d',
  faminto: '#f2994a',
  fraco: '#c65d4b',
  dormindo: '#7c8ea6',
  morto: '#6e665f'
};

function formatTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function formatCountdown(hours) {
  if (hours <= 0) return 'fim';
  if (hours < 1) return `${Math.round(hours * 60)} min de vida`;
  if (hours < 48) return `~${Math.round(hours)}h de vida`;
  return `~${Math.round(hours / 24)}d de vida`;
}

function render() {
  el('gen').textContent = `·${state.generation}`;
  el('moodLabel').textContent = state.dead ? 'morreu de fome' : state.mood;
  el('stageLabel').textContent = state.stageLabel || state.stage;
  el('dot').style.background = MOOD_COLOR[state.mood] || '#c49a78';

  el('satietyValue').textContent = `${state.satiety}%`;
  el('satietyBar').style.width = `${state.satiety}%`;
  el('healthValue').textContent = `${state.health}%`;
  el('healthBar').style.width = `${state.health}%`;
  el('healthBar').style.background =
    state.health < 35 ? '#c65d4b' : state.health < 70 ? '#e89a3d' : '#5f8d4e';

  el('tokens').textContent = `${formatTokens(state.tokensToday)} tokens hoje`;
  el('timer').textContent = state.dead
    ? `geração ${state.generation}`
    : formatCountdown(state.hoursUntilDeath);

  el('hatch').hidden = !state.dead;
}

function showGain(tokens) {
  const gain = el('gain');
  gain.textContent = `+${formatTokens(tokens)}`;
  gain.classList.add('show');
  setTimeout(() => gain.classList.remove('show'), 1800);
}

function loop() {
  frame += 1;
  const eating = !state.dead && state.secondsSinceMeal < 6;
  window.TokengotchiSprite.draw(canvas, { ...state, eating }, frame);
  state.secondsSinceMeal += 1 / 30;
  requestAnimationFrame(loop);
}

window.tokengotchi.onState((incoming) => {
  const gained = incoming.lifetimeTokens - lastTokens;
  if (lastTokens > 0 && gained > 0) showGain(gained);
  lastTokens = incoming.lifetimeTokens;
  state = incoming;
  render();
});

el('hide').addEventListener('click', () => window.tokengotchi.hide());
el('quit').addEventListener('click', () => window.tokengotchi.quit());
el('hatch').addEventListener('click', async () => {
  state = await window.tokengotchi.hatch();
  lastTokens = state.lifetimeTokens;
  render();
});

window.tokengotchi.snapshot().then((snap) => {
  state = snap;
  lastTokens = snap.lifetimeTokens;
  render();
});

render();
loop();
