import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { createStaticServer } from '../scripts/serve.mjs';

test('servidor estático serve HTML e HEAD, rejeita métodos, caminhos ocultos e traversal', async t => {
  const sandbox = await mkdtemp(join(tmpdir(), 'event-storm-static-'));
  const root = join(sandbox, 'site');
  await mkdir(root);
  await mkdir(join(root, '.git'));
  await writeFile(join(root, 'index.html'), '<!doctype html><p>Local</p>');
  await writeFile(join(root, 'app.js'), 'export const local = true;');
  await writeFile(join(root, '.git', 'config'), 'PRIVATE');
  await writeFile(join(sandbox, 'outside.txt'), 'PRIVATE');
  const server = await createStaticServer({ root });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(sandbox, { recursive: true, force: true }); });
  const port = server.address().port;
  const read = (path, method = 'GET') => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => body += chunk);
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
  const page = await read('/');
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /text\/html/);
  assert.match(page.body, /Local/);
  assert.equal((await read('/app.js', 'HEAD')).body, '');
  assert.equal((await read('/app.js', 'HEAD')).status, 200);
  assert.equal((await read('/', 'POST')).status, 405);
  for (const path of ['/.git/config', '/%2e%2e/outside.txt', '/%2e%2e%2foutside.txt', '/..\\outside.txt', '/%00']) {
    assert.equal((await read(path)).status, 403, path);
  }
  assert.equal((await read('/%XX')).status, 400);
  assert.equal((await read('/missing.txt')).status, 404);
  assert.equal(page.headers['x-content-type-options'], 'nosniff');
});

test('servidor estático rejeita symlink que sai da pasta publicada', async t => {
  const sandbox = await mkdtemp(join(tmpdir(), 'event-storm-link-'));
  const root = join(sandbox, 'site');
  await mkdir(root);
  await writeFile(join(sandbox, 'outside.txt'), 'PRIVATE');
  try { await symlink(join(sandbox, 'outside.txt'), join(root, 'linked.txt')); }
  catch (error) {
    await rm(sandbox, { recursive: true, force: true });
    if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('Esta plataforma não permitiu criar symlink de teste.'); return; }
    throw error;
  }
  const server = await createStaticServer({ root });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(sandbox, { recursive: true, force: true }); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/linked.txt`);
  assert.equal(response.status, 403);
});
