#!/usr/bin/env node
'use strict';

/** Teste rápido das regras do bichinho e dos parsers. node scripts/selftest.js */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sources = require('../src/main/sources');
const petLib = require('../src/main/pet');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tokengotchi-test-'));
const HOUR = 3_600_000;

// --- parser do Claude Code ---
const ccDir = path.join(tmp, 'claude', 'projects', 'demo');
fs.mkdirSync(ccDir, { recursive: true });
const ccFile = path.join(ccDir, 'session.jsonl');
fs.writeFileSync(
  ccFile,
  [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'oi' } }),
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 200,
          cache_read_input_tokens: 1000
        }
      }
    })
  ].join('\n') + '\n'
);

const ccSource = {
  id: 'cc',
  label: 'Claude Code',
  enabled: true,
  parser: 'claude-code',
  roots: [ccDir],
  extensions: ['.jsonl'],
  maxDepth: 2
};

const cursors = {};
let harvest = sources.collect({ sources: [ccSource] }, cursors, { now: Date.now() });
assert.strictEqual(harvest.tokens, 1350, 'soma de tokens do Claude Code');
assert.strictEqual(harvest.calories, 100 + 50 * 4 + 200 * 1.25 + 1000 * 0.1, 'calorias ponderadas');

// Segunda leitura sem novas linhas não pode contar de novo.
harvest = sources.collect({ sources: [ccSource] }, cursors, { now: Date.now() });
assert.strictEqual(harvest.tokens, 0, 'leitura incremental não repete');

// Append é detectado.
fs.appendFileSync(
  ccFile,
  JSON.stringify({ type: 'assistant', message: { usage: { output_tokens: 10 } } }) + '\n'
);
harvest = sources.collect({ sources: [ccSource] }, cursors, { now: Date.now() });
assert.strictEqual(harvest.tokens, 10, 'novas linhas são digeridas');

// --- parser do Codex (totais acumulados) ---
const codexDir = path.join(tmp, 'codex', 'sessions');
fs.mkdirSync(codexDir, { recursive: true });
const codexFile = path.join(codexDir, 'rollout.jsonl');
const codexEvent = (total) =>
  JSON.stringify({
    type: 'event_msg',
    payload: { type: 'token_count', info: { total_token_usage: { input_tokens: total, output_tokens: 0 } } }
  });
fs.writeFileSync(codexFile, codexEvent(500) + '\n');

const codexSource = {
  id: 'codex',
  label: 'Codex',
  enabled: true,
  parser: 'codex',
  roots: [codexDir],
  extensions: ['.jsonl'],
  maxDepth: 2
};
const codexCursors = {};
harvest = sources.collect({ sources: [codexSource] }, codexCursors, { now: Date.now() });
assert.strictEqual(harvest.tokens, 500, 'primeiro total do Codex');
fs.appendFileSync(codexFile, codexEvent(1200) + '\n');
harvest = sources.collect({ sources: [codexSource] }, codexCursors, { now: Date.now() });
assert.strictEqual(harvest.tokens, 700, 'Codex conta apenas o delta do acumulado');

// --- parser do Codex: formato real, com cache embutido no input ---
// Conferido em ~/.codex/sessions: `input_tokens` JÁ INCLUI `cached_input_tokens`
// (em 194/194 eventos, total_tokens === input_tokens + output_tokens), e
// `reasoning_output_tokens` é subconjunto de `output_tokens`.
const codexRealDir = path.join(tmp, 'codex-real', 'sessions');
fs.mkdirSync(codexRealDir, { recursive: true });
const codexRealFile = path.join(codexRealDir, 'rollout.jsonl');
const codexRealEvent = (input, cached, output, reasoning) =>
  JSON.stringify({
    timestamp: new Date().toISOString(),
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: input,
          cached_input_tokens: cached,
          output_tokens: output,
          reasoning_output_tokens: reasoning,
          total_tokens: input + output
        },
        last_token_usage: {
          input_tokens: input,
          cached_input_tokens: cached,
          output_tokens: output,
          reasoning_output_tokens: reasoning,
          total_tokens: input + output
        },
        model_context_window: 258400
      },
      rate_limits: { limit_id: 'codex', plan_type: 'plus' }
    }
  });

// Eventos com info: null aparecem de verdade nos logs e não podem quebrar nada.
fs.writeFileSync(
  codexRealFile,
  [
    JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: null } }),
    codexRealEvent(16526, 12672, 239, 128)
  ].join('\n') + '\n'
);

const codexRealSource = { ...codexSource, id: 'codex-real', roots: [codexRealDir] };
const codexRealCursors = {};
harvest = sources.collect({ sources: [codexRealSource] }, codexRealCursors, { now: Date.now() });
// input líquido = 16526 - 12672 = 3854; cacheRead = 12672; output = 239.
assert.strictEqual(harvest.usage.input, 3854, 'Codex desconta o cache do input');
assert.strictEqual(harvest.usage.cacheRead, 12672, 'Codex credita cached_input_tokens como cache read');
assert.strictEqual(harvest.usage.output, 239, 'Codex não soma reasoning duas vezes');
assert.strictEqual(harvest.tokens, 3854 + 12672 + 239, 'Codex não conta o cache duas vezes');
assert.strictEqual(
  harvest.calories,
  3854 * 1 + 239 * 4 + 12672 * 0.1,
  'cache read do Codex pesa 0,1× e não 1×'
);

// O delta acumulado continua valendo no formato real.
fs.appendFileSync(codexRealFile, codexRealEvent(20000, 15000, 500, 200) + '\n');
harvest = sources.collect({ sources: [codexRealSource] }, codexRealCursors, { now: Date.now() });
// novo líquido: input 20000-15000=5000, cacheRead 15000, output 500.
assert.strictEqual(harvest.usage.input, 5000 - 3854, 'delta do input líquido');
assert.strictEqual(harvest.usage.cacheRead, 15000 - 12672, 'delta do cache read');
assert.strictEqual(harvest.usage.output, 500 - 239, 'delta do output');

// --- fonte por atividade (Cursor): estimativa, não leitura de tokens ---
// Único parser sem cobertura até aqui, e o único com lógica de tempo.
const actDir = path.join(tmp, 'cursor-like');
fs.mkdirSync(actDir, { recursive: true });
const actFile = path.join(actDir, 'state.json');
fs.writeFileSync(actFile, '{}');

const actSource = {
  id: 'act',
  label: 'Cursor',
  enabled: true,
  parser: 'activity',
  roots: [actDir],
  extensions: ['.json'],
  maxDepth: 2,
  estimatedTokensPerEvent: 1800,
  minEventIntervalSeconds: 45
};
const actCursors = {};
const t0 = Date.now();

// Primeira varredura só anota o mtime: sem mtime anterior não há evento.
harvest = sources.collect({ sources: [actSource] }, actCursors, { now: t0 });
assert.strictEqual(harvest.tokens, 0, 'primeira varredura de atividade não credita nada');

// Arquivo mexeu → um evento estimado (70% entrada / 30% saída).
const touch1 = new Date(t0 + 60_000);
fs.utimesSync(actFile, touch1, touch1);
harvest = sources.collect({ sources: [actSource] }, actCursors, { now: t0 + 60_000 });
assert.strictEqual(harvest.tokens, 1800, 'atividade detectada vira estimativa de 1800 tokens');
assert.strictEqual(harvest.usage.input, 1260, 'estimativa é 70% entrada');
assert.strictEqual(harvest.usage.output, 540, 'estimativa é 30% saída');
assert.strictEqual(harvest.calories, 1260 * 1 + 540 * 4, 'calorias da estimativa');
assert.strictEqual(harvest.bySource.act.estimated, true, 'fonte marcada como estimativa');

// Mexeu de novo dentro dos 45s: o limitador tem que segurar.
const touch2 = new Date(t0 + 70_000);
fs.utimesSync(actFile, touch2, touch2);
harvest = sources.collect({ sources: [actSource] }, actCursors, { now: t0 + 70_000 });
assert.strictEqual(harvest.tokens, 0, 'evento dentro do intervalo mínimo não conta');

// Passado o intervalo, volta a contar.
const touch3 = new Date(t0 + 200_000);
fs.utimesSync(actFile, touch3, touch3);
harvest = sources.collect({ sources: [actSource] }, actCursors, { now: t0 + 200_000 });
assert.strictEqual(harvest.tokens, 1800, 'passado o intervalo mínimo, conta de novo');

// Arquivo parado não gera evento, por mais que o tempo passe.
harvest = sources.collect({ sources: [actSource] }, actCursors, { now: t0 + 900_000 });
assert.strictEqual(harvest.tokens, 0, 'arquivo sem alteração não credita');

// --- primeira execução não engorda com histórico antigo ---
const freshCursors = {};
harvest = sources.collect({ sources: [ccSource] }, freshCursors, {
  now: Date.now(),
  firstRun: true
});
assert.strictEqual(harvest.tokens, 0, 'primeira execução apenas marca posição');

// --- regras do bichinho ---
const now = Date.now();
let pet = petLib.freshPet(now);
petLib.tick(pet, { calories: 400_000, now });
assert.strictEqual(Math.round(pet.satiety), 100, 'comida farta enche a barriga');

petLib.tick(pet, { now: now + 20 * HOUR });
assert.ok(pet.satiety <= 0.01, 'saciedade zera em ~20h sem tokens');
assert.ok(!pet.dead, 'ainda vivo ao ficar sem comida');

petLib.tick(pet, { now: now + 33 * HOUR });
assert.ok(pet.dead, 'morre depois de ~32h de abandono');
assert.strictEqual(petLib.moodFor(pet, now + 33 * HOUR), 'morto');

// Comer antes de morrer recupera a saúde.
let pet2 = petLib.freshPet(now);
petLib.tick(pet2, { calories: 400_000, now });
petLib.tick(pet2, { now: now + 26 * HOUR });
assert.ok(!pet2.dead && pet2.health < 100, 'saúde caiu, mas segue vivo');
petLib.tick(pet2, { calories: 400_000, now: now + 26 * HOUR + 1000 });
petLib.tick(pet2, { now: now + 32 * HOUR });
assert.ok(pet2.health > 50, 'alimentar a tempo recupera a saúde');

// Evolução por calorias acumuladas.
let pet3 = petLib.freshPet(now);
petLib.tick(pet3, { calories: 3_000_000, now });
assert.strictEqual(petLib.snapshot(pet3, now).stage, 'filhote', 'evolui com o consumo acumulado');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('ok — parsers, leitura incremental e ciclo de vida conferidos');
