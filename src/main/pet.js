'use strict';

const fs = require('fs');
const path = require('path');

/**
 * O calibre da fome é dominado por um caso concreto: o computador do trabalho
 * fica no trabalho no fim de semana. O último token cai sexta por volta das 18h
 * e o próximo só chega segunda de manhã — 63 horas depois. O bichinho precisa
 * atravessar isso vivo, mas chegar visivelmente mal, senão o fim de semana não
 * custa nada.
 *
 * Quem segura essas 63 horas é a saúde, não a barriga. A barriga na sexta à
 * noite depende de quanto a pessoa mexeu com IA naquele dia; a saúde, não —
 * acima de 50 de saciedade ela regenera, então quem trabalhou na sexta desliga
 * com 100. Por isso a saúde sozinha (100 ÷ 1,5 = ~67h) já cobre o fim de semana
 * inteiro mesmo saindo de barriga vazia, e a barriga só soma a margem por cima.
 *
 *   vida máxima  = 100/6 + 100/1,5 = ~83h (3 dias e 11h)
 *   sexta 18h de barriga cheia → segunda 9h com ~30 de saúde, humor "fraco"
 *   uma noite normal (15h fora) esvazia a barriga sem arranhar a saúde
 */
const TUNING = {
  // Calorias necessárias para recuperar 1 ponto de saciedade (0–100).
  caloriesPerSatiety: 4000,
  // Saciedade perdida por hora parado: ~17h para esvaziar de cheia.
  satietyDecayPerHour: 6,
  // Saúde perdida por hora com a barriga vazia: ~67h até morrer.
  healthDecayPerHour: 1.5,
  // Saúde recuperada por hora quando bem alimentado.
  healthRegenPerHour: 6,
  regenThreshold: 50,
  // Sono depois de tanto tempo sem nenhum token.
  sleepAfterMinutes: 20,
  // Teto de decaimento offline: uma semana fora já é o suficiente para matar.
  maxOfflineHours: 168
};

// Cada salto exige mais calorias que o anterior; o progresso usa o total vitalício.
const STAGES = [
  { id: 'ovo', label: 'ovo', phase: 'Primeiros passos', minCalories: 0 },
  { id: 'broto', label: 'broto', phase: 'Uma nova vida', minCalories: 250000 },
  { id: 'filhote', label: 'filhote', phase: 'Descobrindo o mundo', minCalories: 2000000 },
  { id: 'jovem', label: 'jovem', phase: 'Pronto para explorar', minCalories: 10000000 },
  { id: 'adulto', label: 'adulto', phase: 'O começo da aventura', minCalories: 40000000 },
  { id: 'guerreiro', label: 'guerreiro', phase: 'Sem armas', minCalories: 85000000 },
  { id: 'guerreiro-faca', label: 'guerreiro', phase: 'Faca', minCalories: 153000000 },
  { id: 'guerreiro-espada', label: 'guerreiro', phase: 'Espada', minCalories: 255000000 },
  { id: 'guerreiro-escudo', label: 'guerreiro', phase: 'Espada e escudo', minCalories: 408000000 },
  { id: 'guerreiro-machado', label: 'guerreiro', phase: 'Machado', minCalories: 638000000 },
  { id: 'anciao', label: 'ancião', phase: 'Sabedoria ancestral', minCalories: 983000000 },
  { id: 'mago', label: 'mago', phase: 'Cajado de madeira', minCalories: 1501000000 },
  { id: 'mago-cristal', label: 'mago', phase: 'Cajado de cristal', minCalories: 2278000000 },
  { id: 'mago-livro', label: 'mago', phase: 'Cajado e grimório', minCalories: 3444000000 },
  { id: 'mago-arcano', label: 'mago', phase: 'Cajado astral e tomo arcano', minCalories: 5193000000 },
  { id: 'dragao', label: 'dragão', phase: 'Escamas e pequenos chifres', minCalories: 7817000000 },
  { id: 'dragao-asas', label: 'dragão', phase: 'Asas despertas', minCalories: 11753000000 },
  { id: 'dragao-fogo', label: 'dragão', phase: 'Sopro de fogo', minCalories: 17657000000 },
  { id: 'dragao-ancestral', label: 'dragão', phase: 'Coroa e chama ancestral', minCalories: 26513000000 }
];

function stageFor(calories) {
  let current = STAGES[0];
  for (const stage of STAGES) if (calories >= stage.minCalories) current = stage;
  return current;
}

function nextStage(calories) {
  return STAGES.find((stage) => calories < stage.minCalories) || null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

const DEFAULT_NAME = 'Tokengotchi';
const MAX_NAME_LENGTH = 18;

/**
 * O nome vem digitado pelo usuário e acaba em disco, no tooltip da bandeja e no
 * menu, então é normalizado antes de entrar: sem quebras de linha nem caracteres
 * de controle, espaços colapsados e um teto de comprimento — a janela tem 250px
 * e um nome gigante estouraria o cabeçalho.
 *
 * Nome vazio não é erro: significa "volta para o padrão".
 */
function sanitizeName(raw) {
  if (typeof raw !== 'string') return DEFAULT_NAME;
  const clean = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH)
    .trim();
  return clean.length > 0 ? clean : DEFAULT_NAME;
}

function renamePet(pet, raw) {
  pet.name = sanitizeName(raw);
  return pet.name;
}

function freshPet(now, generation = 1) {
  return {
    version: 1,
    name: DEFAULT_NAME,
    generation,
    bornAt: now,
    lastTickAt: now,
    lastFedAt: now,
    lastMealCalories: 0,
    satiety: 60,
    health: 100,
    lifetimeCalories: 0,
    lifetimeTokens: 0,
    tokensToday: 0,
    todayKey: dayKey(now),
    dead: false,
    diedAt: null,
    causeOfDeath: null,
    bySource: {}
  };
}

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * Avança o relógio do bichinho e digere o que chegou.
 * Retorna o próprio objeto (mutado) para facilitar persistência.
 */
function tick(pet, { calories = 0, tokens = 0, bySource = {}, now = Date.now() } = {}) {
  const elapsedHours = clamp((now - pet.lastTickAt) / 3_600_000, 0, TUNING.maxOfflineHours);
  pet.lastTickAt = now;

  if (pet.todayKey !== dayKey(now)) {
    pet.todayKey = dayKey(now);
    pet.tokensToday = 0;
  }

  if (pet.dead) {
    pet.satiety = 0;
    pet.health = 0;
    return pet;
  }

  // Digestão primeiro: comida que chegou agora não conta o decaimento da hora passada.
  if (calories > 0) {
    pet.satiety = clamp(pet.satiety + calories / TUNING.caloriesPerSatiety, 0, 100);
    pet.lifetimeCalories += calories;
    pet.lifetimeTokens += tokens;
    pet.tokensToday += tokens;
    pet.lastFedAt = now;
    pet.lastMealCalories = calories;
    for (const [id, data] of Object.entries(bySource)) {
      if (!data.tokens) continue;
      const entry = pet.bySource[id] || { label: data.label, tokens: 0, calories: 0 };
      entry.label = data.label || entry.label;
      entry.tokens += data.tokens;
      entry.calories += data.calories;
      entry.lastAt = now;
      pet.bySource[id] = entry;
    }
  }

  // O intervalo é dividido em fases: um dia inteiro offline não pode ser tratado
  // como se o bichinho estivesse com a barriga vazia o tempo todo.
  const decay = TUNING.satietyDecayPerHour;
  const satietyBefore = pet.satiety;
  const hoursUntilEmpty = satietyBefore / decay;

  const wellFedHours =
    satietyBefore > TUNING.regenThreshold
      ? Math.min(elapsedHours, (satietyBefore - TUNING.regenThreshold) / decay)
      : 0;
  const starvingHours = Math.max(0, elapsedHours - hoursUntilEmpty);

  pet.satiety = clamp(satietyBefore - decay * elapsedHours, 0, 100);

  if (wellFedHours > 0) {
    pet.health = clamp(pet.health + TUNING.healthRegenPerHour * wellFedHours, 0, 100);
  }
  if (starvingHours > 0) {
    pet.health = clamp(pet.health - TUNING.healthDecayPerHour * starvingHours, 0, 100);
  }

  if (pet.health <= 0) {
    pet.dead = true;
    pet.diedAt = now;
    pet.causeOfDeath = 'fome';
  }

  return pet;
}

function moodFor(pet, now = Date.now()) {
  if (pet.dead) return 'morto';
  const idleMinutes = (now - pet.lastFedAt) / 60_000;
  if (pet.health < 35) return 'fraco';
  if (pet.satiety < 15) return 'faminto';
  if (idleMinutes > TUNING.sleepAfterMinutes) return 'dormindo';
  if (pet.satiety < 45) return 'com fome';
  if (pet.satiety >= 85) return 'feliz';
  return 'bem';
}

/** Horas restantes até morrer se nenhum token aparecer. */
function hoursUntilDeath(pet) {
  if (pet.dead) return 0;
  const toEmpty = pet.satiety / TUNING.satietyDecayPerHour;
  const toDeath = pet.health / TUNING.healthDecayPerHour;
  return toEmpty + toDeath;
}

function snapshot(pet, now = Date.now()) {
  const stage = stageFor(pet.lifetimeCalories);
  const upcoming = nextStage(pet.lifetimeCalories);
  const progress = upcoming
    ? clamp(
        (pet.lifetimeCalories - stage.minCalories) /
          (upcoming.minCalories - stage.minCalories),
        0,
        1
      )
    : 1;

  return {
    name: pet.name,
    generation: pet.generation,
    satiety: Math.round(pet.satiety),
    health: Math.round(pet.health),
    mood: moodFor(pet, now),
    dead: pet.dead,
    stage: stage.id,
    stageLabel: stage.label,
    stagePhase: stage.phase,
    level: STAGES.indexOf(stage) + 1,
    totalLevels: STAGES.length,
    caloriesToNext: upcoming ? Math.max(0, upcoming.minCalories - pet.lifetimeCalories) : 0,
    stageProgress: progress,
    nextStageLabel: upcoming ? `${upcoming.label} · ${upcoming.phase}` : null,
    ageHours: (now - pet.bornAt) / 3_600_000,
    lifetimeTokens: pet.lifetimeTokens,
    tokensToday: pet.tokensToday,
    hoursUntilDeath: hoursUntilDeath(pet),
    secondsSinceMeal: (now - pet.lastFedAt) / 1000,
    lastMealCalories: pet.lastMealCalories,
    bySource: pet.bySource
  };
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.petPath = path.join(dir, 'pet.json');
    this.cursorPath = path.join(dir, 'cursors.json');
    fs.mkdirSync(dir, { recursive: true });
  }

  loadPet(now = Date.now()) {
    try {
      const raw = JSON.parse(fs.readFileSync(this.petPath, 'utf8'));
      const pet = { ...freshPet(now), ...raw };
      // O arquivo é editável à mão; um nome estragado lá não pode virar
      // cabeçalho quebrado nem tooltip com caractere de controle.
      pet.name = sanitizeName(pet.name);
      return { pet, isNew: false };
    } catch {
      return { pet: freshPet(now), isNew: true };
    }
  }

  savePet(pet) {
    writeAtomic(this.petPath, JSON.stringify(pet, null, 2));
  }

  loadCursors() {
    try {
      return JSON.parse(fs.readFileSync(this.cursorPath, 'utf8'));
    } catch {
      return {};
    }
  }

  saveCursors(cursors) {
    writeAtomic(this.cursorPath, JSON.stringify(cursors));
  }
}

function writeAtomic(file, contents) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, file);
}

module.exports = {
  TUNING,
  STAGES,
  Store,
  DEFAULT_NAME,
  MAX_NAME_LENGTH,
  sanitizeName,
  renamePet,
  freshPet,
  tick,
  moodFor,
  snapshot,
  stageFor,
  hoursUntilDeath
};
