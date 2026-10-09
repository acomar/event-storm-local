import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const load = path => readFile(new URL(path, root), 'utf8');

async function applicationResources() {
  const html = await load('index.html');
  const resources = new Set(['index.html']);
  const modules = [];
  for (const match of html.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)) {
    const value = match[1];
    if (value.startsWith('#')) continue;
    assert.match(value, /^\.\//, `HTML resource must remain local: ${value}`);
    const resolved = new URL(value, root);
    await access(resolved);
    const path = resolved.href.slice(root.href.length);
    resources.add(path);
    if (path.endsWith('.js')) modules.push(path);
  }
  const seen = new Set();
  while (modules.length) {
    const path = modules.pop();
    if (seen.has(path)) continue;
    seen.add(path);
    const source = await load(path);
    const parsed = spawnSync(process.execPath, ['--check', fileURLToPath(new URL(path, root))], { encoding: 'utf8' });
    assert.equal(parsed.status, 0, `${path}: ${parsed.stderr}`);
    for (const match of source.matchAll(/\b(?:import|export)\s+(?:[^;]*?\s+from\s+)?["']([^"']+)["']/g)) {
      const specifier = match[1];
      assert.match(specifier, /^\.\.?\//, `Browser import must remain local: ${specifier}`);
      const resolved = new URL(specifier, new URL(path, root));
      assert.ok(resolved.href.startsWith(root.href), `Import must remain in application: ${specifier}`);
      await access(resolved);
      const dependency = resolved.href.slice(root.href.length);
      resources.add(dependency);
      modules.push(dependency);
    }
  }
  return resources;
}

test('browser entry and its complete module graph resolve to local, valid JavaScript', async () => {
  const packageInfo = JSON.parse(await load('package.json'));
  assert.equal(packageInfo.type, 'module');
  assert.deepEqual(Object.keys(packageInfo.dependencies || {}), []);
  const html = await load('index.html');
  assert.match(html, /<html\s+lang="pt-BR"/);
  assert.match(html, /<script\s+type="module"\s+src="\.\/js\/app\.js"/);
  const resources = await applicationResources();
  for (const expected of ['js/app.js', 'js/domain.js', 'js/facilitator.js', 'js/version-control.js', 'js/canvas.js', 'js/ui.js', 'styles.css', 'manifest.webmanifest']) assert.ok(resources.has(expected), expected);
});

test('service-worker installation precaches every resource required to reopen the workspace offline', async () => {
  const registrations = new Map();
  const cached = new Set();
  const waiting = [];
  const workerSource = await load('sw.js');
  const self = {
    location: { href: 'https://local.example/workspace/sw.js', origin: 'https://local.example' },
    addEventListener(type, handler) { registrations.set(type, handler); },
    skipWaiting() { return Promise.resolve(); },
    clients: { claim() { return Promise.resolve(); } }
  };
  const caches = {
    async open() {
      return { async addAll(resources) {
        for (const resource of resources) {
          const url = new URL(typeof resource === 'string' ? resource : resource.url, self.location.href);
          assert.equal(url.origin, self.location.origin, 'Precache cannot require an external service.');
          let path = url.pathname.replace(/^\/workspace\//, '');
          if (!path || path.endsWith('/')) path += 'index.html';
          await access(new URL(path, root));
          cached.add(path);
        }
      } };
    }
  };
  vm.runInNewContext(workerSource, { self, caches, URL, Request, Response, Promise }, { filename: 'sw.js', timeout: 1000 });
  assert.ok(registrations.has('install'), 'Worker must install the offline shell.');
  assert.ok(registrations.has('fetch'), 'Worker must serve offline requests.');
  registrations.get('install')({ waitUntil(promise) { waiting.push(promise); } });
  await Promise.all(waiting);
  const resources = await applicationResources();
  for (const resource of resources) assert.ok(cached.has(resource), `Offline installation omitted ${resource}`);
});
