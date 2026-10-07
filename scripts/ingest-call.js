#!/usr/bin/env node
'use strict';

/**
 * Chamadas locais autenticadas para as tasks do mise (show/status/hide).
 * O segredo não passa por string de shell: o Node lê o sources.json
 * (ou TOKENGOTCHI_TOKEN) e manda Authorization direto no HTTP.
 *
 *   node scripts/ingest-call.js status|show|hide
 */

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const ACTIONS = {
  status: { method: 'GET', path: '/status' },
  show: { method: 'GET', path: '/show' },
  hide: { method: 'GET', path: '/hide' }
};

function candidateFiles() {
  if (process.env.TOKENGOTCHI_SOURCES) return [process.env.TOKENGOTCHI_SOURCES];
  const home = os.homedir();
  const files = [
    path.join(home, 'Library', 'Application Support', 'Tokengotchi', 'sources.json'),
    path.join(home, 'Library', 'Application Support', 'tokengotchi', 'sources.json'),
    path.join(home, '.config', 'Tokengotchi', 'sources.json'),
    path.join(home, '.config', 'tokengotchi', 'sources.json')
  ];
  if (process.env.APPDATA) {
    files.push(path.join(process.env.APPDATA, 'Tokengotchi', 'sources.json'));
    files.push(path.join(process.env.APPDATA, 'tokengotchi', 'sources.json'));
  }
  return files;
}

function loadIngest() {
  for (const file of candidateFiles()) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data && data.ingest && typeof data.ingest === 'object') return data.ingest;
    } catch {
      continue;
    }
  }
  return {};
}

function main() {
  const action = ACTIONS[process.argv[2]];
  if (!action) {
    console.error('uso: node scripts/ingest-call.js <status|show|hide>');
    process.exit(1);
  }

  const ingest = loadIngest();
  const token = String(process.env.TOKENGOTCHI_TOKEN || ingest.token || '').trim();
  const port = Number(process.env.TOKENGOTCHI_PORT || ingest.port || 4736);
  if (!token) {
    console.error('Sem ingest.token. Abra o app uma vez ou defina TOKENGOTCHI_TOKEN.');
    process.exit(1);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('Porta de ingest inválida.');
    process.exit(1);
  }

  const req = http.request(
    {
      host: '127.0.0.1',
      port,
      method: action.method,
      path: action.path,
      headers: { Authorization: `Bearer ${token}` }
    },
    (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        process.stdout.write(body);
        if (!body.endsWith('\n')) process.stdout.write('\n');
        process.exit(res.statusCode >= 200 && res.statusCode < 300 ? 0 : 1);
      });
    }
  );
  req.setTimeout(2000, () => {
    req.destroy();
    console.error(`ingest não respondeu em 127.0.0.1:${port}`);
    process.exit(1);
  });
  req.on('error', (err) => {
    console.error(err.message);
    process.exit(1);
  });
  req.end();
}

main();
