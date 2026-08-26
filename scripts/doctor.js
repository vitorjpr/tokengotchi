#!/usr/bin/env node
'use strict';

/**
 * Mostra o que o Tokengotchi consegue enxergar na sua máquina, sem abrir o app.
 *   npm run doctor
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const sources = require('../src/main/sources');

const HOURS = Number(process.argv[2] || 48);
const WINDOW_MS = HOURS * 3_600_000;

function loadConfig() {
  const userConfig = path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'Tokengotchi',
    'sources.json'
  );
  const fallback = path.join(__dirname, '..', 'config', 'default-sources.json');
  const file = fs.existsSync(userConfig) ? userConfig : fallback;
  return { config: JSON.parse(fs.readFileSync(file, 'utf8')), file };
}

function fmt(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

const { config, file } = loadConfig();
const now = Date.now();

console.log(`\nTokengotchi · diagnóstico das fontes`);
console.log(`config: ${file}`);
console.log(`janela: últimas ${HOURS}h\n`);

for (const source of config.sources || []) {
  const status = source.enabled ? '' : ' (desligada)';
  console.log(`── ${source.label}${status}`);

  for (const root of source.roots || []) {
    const expanded = sources.expandHome(root);
    const exists = fs.existsSync(expanded);
    console.log(`   ${exists ? '✓' : '✗'} ${root}`);
  }

  if (!source.enabled) {
    console.log('');
    continue;
  }

  const files = sources.listFiles(source);
  const recent = files.filter((f) => {
    try {
      return now - fs.statSync(f).mtimeMs < WINDOW_MS;
    } catch {
      return false;
    }
  });

  if (source.parser === 'activity') {
    console.log(`   ${files.length} arquivo(s), ${recent.length} com atividade recente`);
    console.log(
      `   modo estimativa: ~${source.estimatedTokensPerEvent} tokens por evento detectado\n`
    );
    continue;
  }

  const usage = sources.emptyUsage();
  for (const f of recent) {
    const cursor = { off: 0 };
    const read = sources.readNewLines(f, cursor);
    if (!read || read.lines.length === 0) continue;
    const parser = sources.parsers[source.parser] || sources.parsers['generic-usage'];
    const parsed = parser(read.lines, cursor);
    sources.addUsage(usage, parsed.usage);
  }

  const total = sources.totalTokens(usage);
  console.log(`   ${files.length} arquivo(s), ${recent.length} recente(s)`);
  if (total === 0) {
    console.log('   nenhum token reconhecido nessa janela\n');
  } else {
    console.log(
      `   entrada ${fmt(usage.input)} · saída ${fmt(usage.output)} · cache w ${fmt(
        usage.cacheWrite
      )} / r ${fmt(usage.cacheRead)}`
    );
    console.log(`   total ${fmt(total)} tokens → ${fmt(sources.toCalories(usage))} calorias\n`);
  }
}

const port = config.ingest?.port || 4736;
console.log(`Alimentação manual: curl -s localhost:${port}/feed -d '{"source":"teste","output":5000}'`);
console.log(`Status do bichinho:  curl -s localhost:${port}/status\n`);
