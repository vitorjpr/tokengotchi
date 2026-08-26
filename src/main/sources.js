'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Quanto cada tipo de token "alimenta". Saída custa mais caro que entrada,
// e cache read é barato — então vale menos comida.
const WEIGHTS = {
  input: 1,
  output: 4,
  cacheWrite: 1.25,
  cacheRead: 0.1
};

const MAX_CHUNK_BYTES = 8 * 1024 * 1024; // no máximo 8 MB por arquivo por varredura

function expandHome(p) {
  if (p.startsWith('~')) return path.join(os.homedir(), p.slice(1));
  return p;
}

/** Caminha por um diretório coletando arquivos com as extensões pedidas. */
function walk(root, extensions, maxDepth, out = [], depth = 0) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.claude') continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (depth < maxDepth) walk(full, extensions, maxDepth, out, depth + 1);
    } else if (entry.isFile()) {
      if (extensions.some((ext) => entry.name.endsWith(ext))) out.push(full);
    }
  }
  return out;
}

function listFiles(source) {
  const files = [];
  for (const root of source.roots || []) {
    const expanded = expandHome(root);
    if (!fs.existsSync(expanded)) continue;
    walk(expanded, source.extensions || ['.jsonl'], source.maxDepth ?? 4, files);
  }
  return files;
}

/** Lê apenas os bytes novos de um arquivo append-only. */
function readNewLines(file, cursor) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }

  let offset = cursor.off || 0;
  // Arquivo foi truncado ou rotacionado: recomeça.
  if (stat.size < offset) offset = 0;
  if (stat.size === offset) return { lines: [], offset, size: stat.size, mtimeMs: stat.mtimeMs };

  const start = Math.max(offset, stat.size - MAX_CHUNK_BYTES);
  const length = stat.size - start;
  const buffer = Buffer.allocUnsafe(length);

  let fd;
  try {
    fd = fs.openSync(file, 'r');
    fs.readSync(fd, buffer, 0, length, start);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }

  const text = buffer.toString('utf8');
  const lastBreak = text.lastIndexOf('\n');
  // Linha incompleta no fim fica para a próxima varredura.
  const consumed = lastBreak === -1 ? '' : text.slice(0, lastBreak + 1);
  const newOffset = start + Buffer.byteLength(consumed, 'utf8');

  const lines = consumed.split('\n').filter((l) => l.trim().length > 0);
  return { lines, offset: newOffset, size: stat.size, mtimeMs: stat.mtimeMs };
}

function toCalories(usage) {
  return (
    (usage.input || 0) * WEIGHTS.input +
    (usage.output || 0) * WEIGHTS.output +
    (usage.cacheWrite || 0) * WEIGHTS.cacheWrite +
    (usage.cacheRead || 0) * WEIGHTS.cacheRead
  );
}

function emptyUsage() {
  return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
}

function addUsage(target, extra) {
  target.input += extra.input || 0;
  target.output += extra.output || 0;
  target.cacheWrite += extra.cacheWrite || 0;
  target.cacheRead += extra.cacheRead || 0;
}

function totalTokens(usage) {
  return usage.input + usage.output + usage.cacheWrite + usage.cacheRead;
}

/** Normaliza os muitos formatos de "usage" que os agentes escrevem. */
function normalizeUsage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const usage = {
    input:
      raw.input_tokens ?? raw.prompt_tokens ?? raw.input ?? raw.inputTokens ?? 0,
    output:
      raw.output_tokens ?? raw.completion_tokens ?? raw.output ?? raw.outputTokens ?? 0,
    cacheWrite:
      raw.cache_creation_input_tokens ?? raw.cached_write_tokens ?? raw.cacheWriteTokens ?? 0,
    cacheRead:
      raw.cache_read_input_tokens ?? raw.cached_input_tokens ?? raw.cacheReadTokens ?? 0
  };
  if (totalTokens(usage) === 0) return null;
  return usage;
}

/**
 * Normaliza o usage do Codex, que segue a convenção da OpenAI: `input_tokens`
 * já INCLUI `cached_input_tokens` (conferido em 194/194 eventos reais, onde
 * `total_tokens === input_tokens + output_tokens`). Somar os dois como se fossem
 * disjuntos — que é o que `normalizeUsage` faz — conta o cache duas vezes e ainda
 * cobra 1× em vez de 0,1× por ele.
 *
 * `reasoning_output_tokens` também é subconjunto de `output_tokens`, então é ignorado.
 *
 * Não dá para resolver isso dentro de `normalizeUsage` porque o Claude Code usa
 * campos disjuntos (`input_tokens` separado de `cache_read_input_tokens`).
 */
function normalizeCodexUsage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const cacheRead = raw.cached_input_tokens ?? raw.cache_read_input_tokens ?? 0;
  const grossInput = raw.input_tokens ?? raw.prompt_tokens ?? 0;
  const usage = {
    input: Math.max(0, grossInput - cacheRead),
    output: raw.output_tokens ?? raw.completion_tokens ?? 0,
    cacheWrite: 0,
    cacheRead
  };
  if (totalTokens(usage) === 0) return null;
  return usage;
}

/** Procura recursivamente por um objeto de usage dentro de uma entrada JSON. */
function findUsageDeep(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 6) return null;
  const direct = normalizeUsage(node);
  if (direct) return direct;
  for (const key of Object.keys(node)) {
    const child = node[key];
    if (child && typeof child === 'object') {
      const found = findUsageDeep(child, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

const parsers = {
  /** Transcrições do Claude Code: cada mensagem do assistente traz message.usage. */
  'claude-code'(lines) {
    const usage = emptyUsage();
    for (const line of lines) {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const raw = entry?.message?.usage || entry?.usage;
      const normalized = normalizeUsage(raw);
      if (normalized) addUsage(usage, normalized);
    }
    return { usage, cumulativeTotal: null };
  },

  /**
   * Rollouts do Codex: eventos token_count trazem o total acumulado da sessão.
   * Guardamos o último total por arquivo e somamos apenas a diferença.
   */
  codex(lines, fileCursor) {
    const usage = emptyUsage();
    let latestTotals = null;

    for (const line of lines) {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const payload = entry?.payload || entry;
      if (payload?.type && payload.type !== 'token_count') continue;
      const info = payload?.info || payload;
      const cumulative = normalizeCodexUsage(info?.total_token_usage);
      if (cumulative) {
        latestTotals = cumulative;
        continue;
      }
      const last = normalizeCodexUsage(info?.last_token_usage) || findUsageDeep(payload);
      if (last) addUsage(usage, last);
    }

    if (latestTotals) {
      const previous = fileCursor.totals || emptyUsage();
      const delta = {
        input: Math.max(0, latestTotals.input - (previous.input || 0)),
        output: Math.max(0, latestTotals.output - (previous.output || 0)),
        cacheWrite: Math.max(0, latestTotals.cacheWrite - (previous.cacheWrite || 0)),
        cacheRead: Math.max(0, latestTotals.cacheRead - (previous.cacheRead || 0))
      };
      return { usage: delta, cumulativeTotal: latestTotals };
    }

    return { usage, cumulativeTotal: fileCursor.totals || null };
  },

  /** Qualquer JSONL que carregue algum objeto de usage reconhecível. */
  'generic-usage'(lines) {
    const usage = emptyUsage();
    for (const line of lines) {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const found = findUsageDeep(entry);
      if (found) addUsage(usage, found);
    }
    return { usage, cumulativeTotal: null };
  }
};

/**
 * Fontes sem log de tokens (Cursor). Detecta atividade pelo mtime dos arquivos
 * de estado e credita uma estimativa fixa por evento.
 */
function collectActivity(source, cursorState, now) {
  const files = listFiles(source);
  const perEvent = source.estimatedTokensPerEvent ?? 1800;
  const minInterval = (source.minEventIntervalSeconds ?? 45) * 1000;
  const usage = emptyUsage();
  let events = 0;

  for (const file of files) {
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    const key = `${source.id}:${file}`;
    const cursor = cursorState[key] || {};
    const previousMtime = cursor.mtimeMs || 0;
    const lastCredit = cursor.creditedAt || 0;

    if (previousMtime && stat.mtimeMs > previousMtime && now - lastCredit > minInterval) {
      usage.input += Math.round(perEvent * 0.7);
      usage.output += Math.round(perEvent * 0.3);
      events += 1;
      cursor.creditedAt = now;
    }
    cursor.mtimeMs = stat.mtimeMs;
    cursorState[key] = cursor;
  }

  return { usage, files: files.length, events, estimated: true };
}

function collectParsed(source, cursorState, now) {
  const files = listFiles(source);
  const usage = emptyUsage();
  let touched = 0;

  for (const file of files) {
    const key = `${source.id}:${file}`;
    const cursor = cursorState[key] || { off: 0 };
    const result = readNewLines(file, cursor);
    if (!result) continue;

    if (result.lines.length > 0) {
      const parser = parsers[source.parser] || parsers['generic-usage'];
      const parsed = parser(result.lines, cursor);
      if (totalTokens(parsed.usage) > 0) touched += 1;
      addUsage(usage, parsed.usage);
      if (parsed.cumulativeTotal) cursor.totals = parsed.cumulativeTotal;
    }

    cursor.off = result.offset;
    cursor.mtimeMs = result.mtimeMs;
    cursor.seenAt = now;
    cursorState[key] = cursor;
  }

  return { usage, files: files.length, events: touched, estimated: false };
}

/**
 * Varre todas as fontes ativas e devolve o que foi consumido desde a última chamada.
 * cursorState é mutado no lugar (e persistido pelo chamador).
 */
function collect(config, cursorState, options = {}) {
  const now = options.now || Date.now();
  const firstRun = options.firstRun === true;
  const bySource = {};
  const total = emptyUsage();

  for (const source of config.sources || []) {
    if (!source.enabled) continue;
    const result =
      source.parser === 'activity'
        ? collectActivity(source, cursorState, now)
        : collectParsed(source, cursorState, now);

    // Na primeira execução só marcamos a posição atual dos arquivos:
    // ninguém merece nascer com meses de histórico na barriga.
    const usage = firstRun ? emptyUsage() : result.usage;

    bySource[source.id] = {
      label: source.label,
      files: result.files,
      events: result.events,
      estimated: result.estimated,
      tokens: totalTokens(usage),
      calories: toCalories(usage)
    };
    addUsage(total, usage);
  }

  return {
    usage: total,
    tokens: totalTokens(total),
    calories: toCalories(total),
    bySource
  };
}

module.exports = {
  collect,
  parsers,
  readNewLines,
  listFiles,
  expandHome,
  toCalories,
  emptyUsage,
  addUsage,
  totalTokens,
  normalizeUsage,
  normalizeCodexUsage,
  WEIGHTS
};
