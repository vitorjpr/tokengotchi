'use strict';

const crypto = require('crypto');
const http = require('http');

/**
 * Servidor local para alimentar o bichinho de fora.
 *
 * Só responde em 127.0.0.1 e só com o segredo de `ingest.token` no header
 * `Authorization: Bearer …`. Sem isso, /feed não altera o bichinho e
 * /status, /show e /hide também ficam fechados. Página web não recebe
 * CORS, então não consegue mandar esse header num pedido cross-origin.
 *
 *   curl -s localhost:4736/feed \
 *     -H "Authorization: Bearer $TOKEN" \
 *     -H 'Content-Type: application/json' \
 *     -d '{"source":"grok","output_tokens":1200,"input_tokens":800}'
 */

const MAX_BODY_BYTES = 64 * 1024;
const MAX_FEED_TOKENS = 100_000_000;
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_AUTHENTICATED_MAX = 300;
const DEFAULT_ANONYMOUS_MAX = 30;

const TOKEN_FIELDS = [
  'input_tokens',
  'output_tokens',
  'prompt_tokens',
  'completion_tokens',
  'input',
  'output',
  'inputTokens',
  'outputTokens',
  'cache_creation_input_tokens',
  'cached_write_tokens',
  'cacheWriteTokens',
  'cache_read_input_tokens',
  'cached_input_tokens',
  'cacheReadTokens'
];

/** Segredo que cabe num header HTTP: ASCII imprimível, sem espaço, tamanho limitado. */
function tokenIsUsable(token) {
  if (typeof token !== 'string') return false;
  if (token.length < 16 || token.length > 256) return false;
  return /^[\x21-\x7E]+$/.test(token);
}

/**
 * Garante `ingest.token` na config. Se faltar ou for fraco, gera 32 bytes
 * hexadecimais e chama `persist` para gravar. O token novo já está no objeto
 * mesmo se a gravação falhar — o chamador decide o que fazer com o erro.
 */
function ensureIngestToken(config, persist) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return '';
  if (!config.ingest || typeof config.ingest !== 'object' || Array.isArray(config.ingest)) {
    config.ingest = {};
  }
  if (tokenIsUsable(config.ingest.token)) return config.ingest.token;
  config.ingest.token = crypto.randomBytes(32).toString('hex');
  if (typeof persist === 'function') persist(config);
  return config.ingest.token;
}

function tokensEqual(presented, expected) {
  const a = crypto.createHash('sha256').update(presented).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function bearerToken(req) {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match ? match[1] : null;
}

function routeOf(req) {
  const path = String(req.url || '').split('?')[0];
  if (req.method === 'GET' && path.startsWith('/status')) return 'status';
  if (req.method === 'GET' && path.startsWith('/show')) return 'show';
  if (req.method === 'GET' && path.startsWith('/hide')) return 'hide';
  if (req.method === 'POST' && path.startsWith('/feed')) return 'feed';
  return null;
}

function tokenFieldSane(value) {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_FEED_TOKENS
  );
}

/** Recusa contagens absurdas (Infinity, negativo, acima do teto) antes de alimentar. */
function feedPayloadSane(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const objects = [payload];
  if (payload.usage && typeof payload.usage === 'object' && !Array.isArray(payload.usage)) {
    objects.push(payload.usage);
  }
  for (const obj of objects) {
    for (const key of TOKEN_FIELDS) {
      if (obj[key] == null) continue;
      if (!tokenFieldSane(obj[key])) return false;
    }
  }
  return true;
}

function createBucket(max, windowMs) {
  const hits = [];
  return function blocked(now = Date.now()) {
    while (hits.length && now - hits[0] >= windowMs) hits.shift();
    if (hits.length >= max) return true;
    hits.push(now);
    return false;
  };
}

function send(res, status, body) {
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

function startIngest({
  port = 4736,
  token = '',
  onFeed,
  getStatus,
  onReveal,
  onHide,
  rateLimit = {}
} = {}) {
  const windowMs = rateLimit.windowMs ?? DEFAULT_WINDOW_MS;
  const authenticatedBlocked = createBucket(
    rateLimit.authenticatedMax ?? DEFAULT_AUTHENTICATED_MAX,
    windowMs
  );
  const anonymousBlocked = createBucket(rateLimit.anonymousMax ?? DEFAULT_ANONYMOUS_MAX, windowMs);
  const secretOk = tokenIsUsable(token);

  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    const route = routeOf(req);
    if (!route) {
      send(res, 404, { error: 'rota desconhecida' });
      return;
    }

    const presented = bearerToken(req);
    const authorized = secretOk && presented !== null && tokensEqual(presented, token);
    if (!authorized) {
      // Balde separado: rajada anônima não pode esgotar a cota do hook legítimo.
      if (anonymousBlocked()) {
        send(res, 429, { error: 'muitas requisições' });
        return;
      }
      send(res, 401, { error: 'não autorizado' });
      return;
    }

    if (authenticatedBlocked()) {
      send(res, 429, { error: 'muitas requisições' });
      return;
    }

    if (route === 'status') {
      res.end(JSON.stringify(getStatus()));
      return;
    }

    if (route === 'show') {
      onReveal?.();
      res.end(JSON.stringify({ ok: true, visible: true }));
      return;
    }

    if (route === 'hide') {
      onHide?.();
      res.end(JSON.stringify({ ok: true, visible: false }));
      return;
    }

    let body = '';
    let tooBig = false;
    req.on('data', (chunk) => {
      if (tooBig) return;
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        tooBig = true;
        req.destroy();
      }
    });
    req.on('end', () => {
      if (tooBig || res.writableEnded) return;
      let payload;
      try {
        payload = JSON.parse(body || '{}');
      } catch {
        send(res, 400, { error: 'JSON inválido' });
        return;
      }
      if (!feedPayloadSane(payload)) {
        send(res, 400, { error: 'contagem de tokens inválida' });
        return;
      }
      let accepted;
      try {
        accepted = onFeed(payload);
      } catch {
        send(res, 500, { error: 'falha ao alimentar' });
        return;
      }
      res.end(JSON.stringify(accepted));
    });
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[tokengotchi] porta ${port} já está ocupada — outro processo (ou outra ` +
          'instância do app) está escutando nela. O bichinho segue comendo dos logs, ' +
          'mas /feed, /status, /show e /hide ficam indisponíveis. Mude "ingest.port" no ' +
          'sources.json ou libere a porta.'
      );
      return;
    }
    console.error('[tokengotchi] ingest indisponível:', err.message);
  });

  server.listen(port, '127.0.0.1');
  return server;
}

module.exports = {
  startIngest,
  ensureIngestToken,
  tokenIsUsable,
  MAX_FEED_TOKENS
};
