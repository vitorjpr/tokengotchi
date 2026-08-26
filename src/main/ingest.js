'use strict';

const http = require('http');

/**
 * Servidor local minúsculo para alimentar o bichinho de fora.
 *
 *   curl -s localhost:4736/feed -d '{"source":"grok","output":1200,"input":800}'
 *
 * Serve para qualquer agente que não escreva log em disco: basta um hook.
 */
function startIngest({ port = 4736, onFeed, getStatus, onReveal, onHide }) {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    if (req.method === 'GET' && req.url.startsWith('/status')) {
      res.end(JSON.stringify(getStatus()));
      return;
    }

    // Resgate por terminal: a janela não aparece no Dock, então se ela some
    // (escondida, minimizada ou atrás de tudo) o ícone da barra de menus é o
    // único caminho de volta. Numa tela larga ele é fácil de perder.
    if (req.method === 'GET' && req.url.startsWith('/show')) {
      onReveal?.();
      res.end(JSON.stringify({ ok: true, visible: true }));
      return;
    }

    if (req.method === 'GET' && req.url.startsWith('/hide')) {
      onHide?.();
      res.end(JSON.stringify({ ok: true, visible: false }));
      return;
    }

    if (req.method === 'POST' && req.url.startsWith('/feed')) {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 64 * 1024) req.destroy();
      });
      req.on('end', () => {
        let payload;
        try {
          payload = JSON.parse(body || '{}');
        } catch {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'JSON inválido' }));
          return;
        }
        const accepted = onFeed(payload);
        res.end(JSON.stringify(accepted));
      });
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'rota desconhecida' }));
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[tokengotchi] porta ${port} já está ocupada — outro processo (ou outra ` +
          'instância do app) está escutando nela. O bichinho segue comendo dos logs, ' +
          'mas /feed, /status e /show ficam indisponíveis. Mude "ingest.port" no ' +
          'sources.json ou libere a porta.'
      );
      return;
    }
    console.error('[tokengotchi] ingest indisponível:', err.message);
  });

  server.listen(port, '127.0.0.1');
  return server;
}

module.exports = { startIngest };
