#!/usr/bin/env node
'use strict';

/** Teste rápido das regras do bichinho e dos parsers. node scripts/selftest.js */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sources = require('../src/main/sources');
const petLib = require('../src/main/pet');
const updates = require('../src/main/updates');

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

// --- nome do bichinho ---
// O nome é digitado pelo usuário e vai parar em disco, no tooltip da bandeja e
// no cabeçalho de uma janela de 250px, então é normalizado na entrada.
assert.strictEqual(petLib.sanitizeName('  Migu  '), 'Migu', 'apara espaços nas pontas');
assert.strictEqual(petLib.sanitizeName('a   b'), 'a b', 'colapsa espaços internos');
assert.strictEqual(petLib.sanitizeName('Ção Àcentuada'), 'Ção Àcentuada', 'preserva acentos');
assert.strictEqual(
  petLib.sanitizeName('quebra\nde\tlinha'),
  'quebra de linha',
  'troca caracteres de controle por espaço'
);
assert.strictEqual(
  petLib.sanitizeName('x'.repeat(50)).length,
  petLib.MAX_NAME_LENGTH,
  'corta no comprimento máximo'
);

// Nome vazio não é erro: volta para o padrão.
for (const vazio of ['', '   ', '\n\t', null, undefined, 42, {}]) {
  assert.strictEqual(
    petLib.sanitizeName(vazio),
    petLib.DEFAULT_NAME,
    `entrada sem nome útil (${JSON.stringify(vazio)}) volta ao padrão`
  );
}

const nomeado = petLib.freshPet(Date.now());
assert.strictEqual(nomeado.name, petLib.DEFAULT_NAME, 'bichinho novo nasce com o nome padrão');
assert.strictEqual(petLib.renamePet(nomeado, '  Migu '), 'Migu', 'renomear devolve o nome aplicado');
assert.strictEqual(nomeado.name, 'Migu', 'renomear altera o bichinho');
assert.strictEqual(petLib.snapshot(nomeado, Date.now()).name, 'Migu', 'snapshot expõe o nome');

// O nome sobrevive a salvar e recarregar, e um pet.json editado à mão com lixo
// no nome não pode voltar como está.
const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokengotchi-store-'));
const store = new petLib.Store(storeDir);
store.savePet(nomeado);
assert.strictEqual(store.loadPet().pet.name, 'Migu', 'nome persiste entre execuções');

const petFile = path.join(storeDir, 'pet.json');
const sujo = JSON.parse(fs.readFileSync(petFile, 'utf8'));
sujo.name = '   nome\ncom\nlixo   ';
fs.writeFileSync(petFile, JSON.stringify(sujo));
assert.strictEqual(
  store.loadPet().pet.name,
  'nome com lixo',
  'nome estragado no arquivo é normalizado ao carregar'
);
fs.rmSync(storeDir, { recursive: true, force: true });

// --- aviso de versão nova ---
// Comparação numérica, não alfabética: "0.10.0" > "0.9.0" é o caso que
// comparação por string erra.
assert.strictEqual(updates.compareVersions('0.10.0', '0.9.0'), 1, '0.10.0 é maior que 0.9.0');
assert.strictEqual(updates.compareVersions('1.0.0', '0.99.99'), 1, 'major manda');
assert.strictEqual(updates.compareVersions('0.2.1', '0.2.0'), 1, 'patch conta');
assert.strictEqual(updates.compareVersions('0.2.0', '0.2.0'), 0, 'iguais');
assert.strictEqual(updates.compareVersions('0.1.0', '0.2.0'), -1, 'menor');
assert.strictEqual(updates.compareVersions('v0.3.0', '0.2.0'), 1, 'aceita o v da tag');
assert.strictEqual(updates.compareVersions('lixo', '0.1.0'), null, 'entrada inválida vira null');
assert.strictEqual(updates.compareVersions('0.1.0', undefined), null, 'sem versão atual vira null');

assert.ok(updates.isNewer('0.3.0', '0.2.0'), 'detecta versão nova');
assert.ok(!updates.isNewer('0.2.0', '0.2.0'), 'mesma versão não é novidade');
assert.ok(!updates.isNewer('0.1.0', '0.2.0'), 'versão antiga não é novidade');

const releaseNovo = {
  tag_name: 'v0.3.0',
  html_url: 'https://github.com/vitorjpr/tokengotchi/releases/tag/v0.3.0',
  draft: false,
  prerelease: false
};
assert.deepStrictEqual(
  updates.parseRelease(releaseNovo, '0.2.0'),
  {
    available: true,
    latest: '0.3.0',
    current: '0.2.0',
    url: 'https://github.com/vitorjpr/tokengotchi/releases/tag/v0.3.0'
  },
  'release novo vira aviso'
);
assert.strictEqual(
  updates.parseRelease({ ...releaseNovo, tag_name: 'v0.2.0' }, '0.2.0').available,
  false,
  'mesma versão não avisa'
);

// Rascunho e pré-lançamento não podem virar aviso: quem baixa é usuário final.
assert.strictEqual(
  updates.parseRelease({ ...releaseNovo, draft: true }, '0.2.0'),
  null,
  'rascunho é ignorado'
);
assert.strictEqual(
  updates.parseRelease({ ...releaseNovo, prerelease: true }, '0.2.0'),
  null,
  'pré-lançamento é ignorado'
);

// Resposta estragada não pode derrubar o app.
for (const ruim of [null, undefined, 'texto', {}, { tag_name: 'sem-numero' }]) {
  assert.strictEqual(
    updates.parseRelease(ruim, '0.2.0'),
    null,
    `resposta inválida (${JSON.stringify(ruim)}) vira null`
  );
}

// A versão do package.json precisa ser legível pelo próprio comparador —
// se alguém escrever "0.3" ali, o aviso silenciaria sem ninguém notar.
const pkgVersion = require('../package.json').version;
assert.ok(
  updates.parseVersion(pkgVersion),
  `versão do package.json (${pkgVersion}) precisa ser X.Y.Z`
);

// --- versão instalada em disco (bundle trocado sob o processo) ---
const plistExemplo = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<plist version="1.0"><dict>',
  '  <key>CFBundleName</key><string>Tokengotchi</string>',
  '  <key>CFBundleShortVersionString</key>',
  '  <string>0.4.1</string>',
  '</dict></plist>'
].join('\n');

assert.strictEqual(
  updates.parseInfoPlistVersion(plistExemplo),
  '0.4.1',
  'lê a versão do Info.plist mesmo com quebra de linha entre key e string'
);
for (const ruim of ['', '<plist></plist>', null, undefined, 42]) {
  assert.strictEqual(
    updates.parseInfoPlistVersion(ruim),
    null,
    `plist sem versão (${JSON.stringify(ruim)}) vira null`
  );
}

const execMac = '/Applications/Tokengotchi.app/Contents/MacOS/Tokengotchi';
const lerPlist = () => plistExemplo;

assert.strictEqual(
  updates.installedVersion({
    platform: 'darwin',
    isPackaged: true,
    execPath: execMac,
    readFile: lerPlist
  }),
  '0.4.1',
  'lê a versão instalada no macOS empacotado'
);

// Em desenvolvimento não há bundle para comparar.
assert.strictEqual(
  updates.installedVersion({
    platform: 'darwin',
    isPackaged: false,
    execPath: execMac,
    readFile: lerPlist
  }),
  null,
  'em dev não tenta ler bundle'
);

// Windows trava o executável em uso e o Linux roda de uma cópia montada:
// nesses casos a leitura não diria nada útil, então nem é tentada.
for (const plataforma of ['win32', 'linux']) {
  assert.strictEqual(
    updates.installedVersion({
      platform: plataforma,
      isPackaged: true,
      execPath: execMac,
      readFile: lerPlist
    }),
    null,
    `${plataforma} não tenta detectar troca de bundle`
  );
}

// App sendo substituído neste instante: leitura falha e não pode derrubar nada.
assert.strictEqual(
  updates.installedVersion({
    platform: 'darwin',
    isPackaged: true,
    execPath: execMac,
    readFile: () => {
      throw new Error('ENOENT');
    }
  }),
  null,
  'falha de leitura vira null em vez de exceção'
);

// Caminho fora do formato de bundle não deve ser interpretado.
assert.strictEqual(
  updates.installedVersion({
    platform: 'darwin',
    isPackaged: true,
    execPath: '/usr/local/bin/tokengotchi',
    readFile: lerPlist
  }),
  null,
  'caminho sem /Contents/MacOS/ vira null'
);

// --- fiação do renderer ---
// O renderer não roda aqui (precisa de Electron), mas os contratos entre os
// arquivos são texto e dá para conferir: um id com erro de digitação só
// apareceria abrindo o app, e um método ausente no preload vira
// "undefined is not a function" na cara do usuário.
const rendererJs = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/app.js'), 'utf8');
const rendererHtml = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/index.html'), 'utf8');
const preloadJs = fs.readFileSync(path.join(__dirname, '..', 'src/main/preload.js'), 'utf8');
const mainJs = fs.readFileSync(path.join(__dirname, '..', 'src/main/main.js'), 'utf8');

const htmlIds = new Set([...rendererHtml.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
for (const [, id] of rendererJs.matchAll(/\bel\(\s*['"]([^'"]+)['"]\s*\)/g)) {
  assert.ok(htmlIds.has(id), `app.js usa el('${id}'), mas não existe id="${id}" no index.html`);
}

// A janela inteira é área de arrasto, então todo controle clicável precisa
// estar declarado como no-drag — sem isso o clique vira arrasto e o botão fica
// inerte, que foi o que aconteceu com o "Baixar" da faixa de atualização.
// O CSS resolve isso por seletor de elemento; este teste guarda a regra.
const rendererCss = fs.readFileSync(
  path.join(__dirname, '..', 'src/renderer/style.css'),
  'utf8'
);
const noDragRule = /(^|\})[^{}]*\bbutton\b[^{}]*\{[^{}]*-webkit-app-region:\s*no-drag/m;
assert.ok(
  noDragRule.test(rendererCss),
  'style.css precisa declarar -webkit-app-region: no-drag para button, ' +
    'senão qualquer botão novo nasce inerte dentro da região de arrasto'
);

// E todo elemento interativo do HTML precisa ser de um tipo coberto por essa
// regra; um <div> clicável passaria despercebido.
const interativos = [...rendererHtml.matchAll(/<(\w+)[^>]*\bid="(\w+)"/g)]
  .filter(([, , id]) => new RegExp(`el\\('${id}'\\)[^;]*addEventListener\\('click'`).test(rendererJs))
  .map(([, tag, id]) => ({ tag: tag.toLowerCase(), id }));
for (const { tag, id } of interativos) {
  assert.ok(
    ['button', 'input', 'select', 'textarea', 'a'].includes(tag),
    `#${id} recebe clique mas é <${tag}>, que não está coberto pela regra de no-drag`
  );
}
assert.ok(interativos.length >= 4, 'esperava encontrar os elementos clicáveis do renderer');

// Todo window.tokengotchi.X usado no renderer precisa existir no preload.
for (const [, method] of rendererJs.matchAll(/window\.tokengotchi\.(\w+)/g)) {
  assert.ok(
    new RegExp(`\\b${method}\\s*:`).test(preloadJs),
    `renderer chama window.tokengotchi.${method}, ausente no preload.js`
  );
}

// E todo canal que o preload invoca precisa ter handler no main.
for (const [, channel] of preloadJs.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)) {
  assert.ok(
    mainJs.includes(`ipcMain.handle('${channel}'`),
    `preload invoca '${channel}', sem ipcMain.handle correspondente no main.js`
  );
}
for (const [, channel] of preloadJs.matchAll(/ipcRenderer\.send\('([^']+)'/g)) {
  assert.ok(
    mainJs.includes(`ipcMain.on('${channel}'`),
    `preload envia '${channel}', sem ipcMain.on correspondente no main.js`
  );
}

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
