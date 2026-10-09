import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8'
};

function isWithin(root, target) {
  const suffix = relative(root, target);
  return suffix === '' || (!isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith(`..${sep}`));
}

export async function createStaticServer({ root = defaultRoot } = {}) {
  const realRoot = await realpath(root);
  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-cache');
    const end = (status, text) => {
      response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : text);
    };
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.setHeader('Allow', 'GET, HEAD');
      end(405, 'Método não permitido.');
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent((request.url || '/').split('?')[0]);
    } catch {
      end(400, 'Endereço inválido.');
      return;
    }
    if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0') ||
        pathname.split('/').some(segment => segment.startsWith('.'))) {
      end(403, 'Acesso não permitido.');
      return;
    }
    let candidate = resolve(realRoot, `.${pathname}`);
    if (!isWithin(realRoot, candidate)) {
      end(403, 'Acesso não permitido.');
      return;
    }
    try {
      let information = await stat(candidate);
      if (information.isDirectory()) {
        candidate = resolve(candidate, 'index.html');
        information = await stat(candidate);
      }
      const actualPath = await realpath(candidate);
      if (!isWithin(realRoot, actualPath) || !information.isFile()) {
        end(403, 'Acesso não permitido.');
        return;
      }
      response.writeHead(200, {
        'Content-Type': mimeTypes[extname(actualPath).toLowerCase()] || 'application/octet-stream',
        'Content-Length': information.size,
        ...(extname(actualPath).toLowerCase() === '.js' ? { 'Service-Worker-Allowed': '/' } : {})
      });
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      const stream = createReadStream(actualPath);
      stream.on('error', () => response.destroy());
      stream.pipe(response);
    } catch (error) {
      if (!response.headersSent) end(['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : 403, 'Arquivo indisponível.');
      else response.destroy();
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || '8080');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT deve ser um número entre 1 e 65535.');
  const server = await createStaticServer();
  server.on('error', error => {
    console.error(`Não foi possível iniciar o servidor: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => console.log(`Event Storm Local: http://127.0.0.1:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
}
