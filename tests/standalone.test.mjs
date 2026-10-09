import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { buildStandalone, compileModules, readSources } from '../scripts/build-standalone.mjs';
import { validateProject } from '../js/domain.js';

test('standalone tracked file matches its sources and contains no external shell assets', async () => {
  const result = await buildStandalone({ write: false });
  const tracked = await readFile(new URL('../standalone.html', import.meta.url), 'utf8');
  assert.equal(tracked, result.html, 'Regenerate standalone.html with npm run standalone after source changes.');
  assert.equal(result.order.length, 6);
  assert.ok(result.order.indexOf('domain.js') < result.order.indexOf('facilitator.js'));
  assert.ok(result.order.indexOf('ui.js') < result.order.indexOf('canvas.js'));
  assert.equal(result.order.at(-1), 'app.js');
  assert.match(result.html, /<style>/);
  assert.match(result.html, /href="data:image\/svg\+xml,/);
  assert.doesNotMatch(result.html, /<script[^>]+src=|<link[^>]+rel="(?:stylesheet|manifest)"/);
  assert.match(result.bundle, /location\.protocol!=='file:' && !globalThis\.__EVENT_STORM_STANDALONE__/);
  assert.ok(result.html.indexOf('<script>') > result.html.indexOf('id="app"'), 'DOM must exist before the classic inline script boots.');
});

test('isolated standalone modules preserve domain, facilitation, history and restore behavior', async () => {
  const sources = await readSources();
  const { bundle } = compileModules(sources, { runEntry: false, exposeModules: true });
  const context = vm.createContext({ crypto: webcrypto, TextEncoder, setTimeout, clearTimeout });
  vm.runInContext('globalThis.structuredClone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));', context);
  vm.runInContext(bundle, context, { timeout: 2000 });
  const modules = context.__standaloneTestModules;
  assert.ok(modules['domain.js']);
  assert.ok(modules['version-control.js']);
  assert.ok(modules['ui.js'].esc);
  assert.ok(modules['canvas.js'].Board);
  const project = modules['domain.js'].newProject('Standalone', 'Provar a cópia local');
  validateProject(JSON.parse(JSON.stringify(project)));
  const extraction = modules['facilitator.js'].extractContent(project, 'Relato', 'Pedido Recebido.');
  assert.equal(extraction.proposals.length, 1);
  assert.equal(extraction.proposals[0].node.status, 'hypothesis');
  assert.equal(extraction.evidences[0].quote, 'Pedido Recebido');
  const store = new modules['version-control.js'].LocalStore({ memory: true, name: 'standalone-semantic-test' });
  await store.open();
  const engine = new modules['version-control.js'].VersionEngine(store, project.id);
  await engine.init(project);
  const first = engine.state.localHead;
  assert.equal(await engine.saveVersion('Inicial'), null, 'No empty version after initialization.');
  project.graph.nodes.push(modules['domain.js'].newCard('event'));
  await engine.updateWorkingCopy(project);
  await engine.saveVersion('Evento adicionado');
  assert.equal((await engine.history()).length, 2);
  await engine.restore(first);
  assert.equal(engine.state.workingCopy.graph.nodes.length, 0);
  assert.equal((await engine.history()).length, 3);
});

test('standalone compiler rejects external imports, cycles and mutable export contracts', async () => {
  const sources = await readSources();
  assert.throws(() => compileModules({ ...sources, 'app.js': `import { newProject as externalProject } from 'https://external.example/app.js';\n${sources['app.js']}` }), /externa\/desconhecida/);
  assert.throws(() => compileModules({ ...sources, 'domain.js': `import { icon } from './ui.js';\n${sources['domain.js']}`, 'ui.js': `import { kinds } from './domain.js';\n${sources['ui.js']}` }), /Ciclo/);
  assert.throws(() => compileModules({ ...sources, 'domain.js': sources['domain.js'].replace('export const kinds', 'export let kinds') }), /exportação não suportada/);
});
