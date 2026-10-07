import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { onRequest } from './functions/index.js';

const root = fileURLToPath(new URL('./dist/', import.meta.url));
const port = Number(process.env.PORT) || 4173;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function insideRoot(file) {
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  return file.startsWith(prefix);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value == null) continue;
        headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      }
      const response = await onRequest({ request: new Request(url, { headers }) });
      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }

    let pathname = decodeURIComponent(url.pathname);
    const bare = normalize(join(root, pathname));
    if (!insideRoot(bare)) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }
    try {
      const info = await stat(bare);
      if (info.isDirectory()) {
        if (!pathname.endsWith('/')) {
          res.statusCode = 308;
          res.setHeader('Location', `${pathname}/${url.search}`);
          res.end();
          return;
        }
        pathname = `${pathname}index.html`;
      }
    } catch {
      /* Missing paths fall through to the file read. */
    }

    const file = normalize(join(root, pathname));
    if (!insideRoot(file)) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }
    const body = await readFile(file);
    res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
    res.end(body);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    res.statusCode = 500;
    res.end('Server error');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`http://127.0.0.1:${port}`);
});
