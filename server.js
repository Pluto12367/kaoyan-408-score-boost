import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { existsSync } from 'node:fs';

const distRoot = join(process.cwd(), 'apps/web/dist');
const fallbackRoot = process.cwd();
const root = existsSync(distRoot) ? distRoot : fallbackRoot;
const port = Number(process.env.PORT ?? 4173);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
  const requestedPath = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const filePath = normalize(join(root, requestedPath));

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  try {
    const fileStat = await stat(filePath);
    // SPA fallback: serve index.html for non-file routes
    if (fileStat.isDirectory()) {
      const indexPath = join(filePath, 'index.html');
      const content = await readFile(indexPath);
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(content);
      return;
    }

    const content = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': types[extname(filePath)] ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=3600',
    });
    response.end(content);
  } catch {
    // SPA fallback for client-side routing
    try {
      const indexContent = await readFile(join(root, 'index.html'));
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(indexContent);
    } catch {
      response.writeHead(404);
      response.end('Not Found');
    }
  }
}).listen(port, () => {
  console.log(`408 score boost system running at http://localhost:${port}`);
  console.log(`Serving from: ${root}`);
});
