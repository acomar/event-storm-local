import test from 'node:test';
import assert from 'node:assert/strict';
import { newProject, newCard, exampleProject, validateProject, importProject, projectMaps, projectMap, mapProject, updateMap, addMap, removeMap } from '../js/domain.js';
import { LocalStore, VersionEngine, MemoryRepositoryAdapter, semanticDiff, threeWayMerge } from '../js/version-control.js';
import { extractContent } from '../js/facilitator.js';

test('legacy project is a primary map without changing its portable JSON', () => {
  const project = exampleProject(), original = structuredClone(project);
  const maps = projectMaps(project);
  assert.equal(maps.length, 1);
  assert.equal(maps[0].name, 'Mapa principal');
  assert.equal(maps[0].graph, project.graph);
  assert.deepEqual(validateProject(project), original);
  assert.deepEqual(mapProject(project, 'main'), original);
});

test('multiple maps isolate cards, references, sources, viewport and modality', () => {
  const project = exampleProject(), original = structuredClone(project.graph);
  const id = addMap(project, 'Entrega');
  const map = projectMap(project, id), node = newCard('event');
  map.graph.nodes.push(node);
  map.graph.viewport.x = 900;
  updateMap(project, id, { modality: 'process', name: 'Fluxo de entrega' });
  const extraction = extractContent(mapProject(project, id), 'Entrega', 'A entrega foi confirmada.');
  map.graph.sources.push(extraction.source);
  map.graph.evidences.push(...extraction.evidences);
  map.graph.proposals.push(...extraction.proposals);
  assert.deepEqual(project.graph, original);
  const scoped = mapProject(project, id);
  assert.equal(scoped.modality, 'process');
  assert.equal(scoped.graph, map.graph);
  assert.equal(scoped.maps, undefined);
  assert.equal(scoped.primary_map, undefined);
  const portable = validateProject(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(portable, project);
  const imported = importProject(portable);
  assert.notEqual(imported.id, project.id);
  assert.deepEqual(imported.maps, project.maps);
  assert.deepEqual(imported.graph, project.graph);
});

test('validation rejects invalid map metadata, duplicate IDs and cross-map references', () => {
  const project = exampleProject(), id = addMap(project, 'Entrega');
  const invalid = structuredClone(project);
  invalid.maps[0].id = 'main';
  assert.throws(() => validateProject(invalid), /IDs de mapas duplicados/);
  invalid.maps[0].id = id;
  invalid.maps[0].name = '';
  assert.throws(() => validateProject(invalid), /maps\[0\].name/);
  assert.throws(() => addMap(project, ' '), /map.name/);
  assert.throws(() => projectMap(project, 'missing'), /mapa não encontrado/);
  project.maps[0].graph.edges.push({ id: 'edge', source: project.graph.nodes[0].id, target: project.graph.nodes[1].id, relation: 'before', label: '' });
  assert.throws(() => validateProject(project), /maps\[0\].graph.edges.*sem cartão/);
  project.maps[0].graph.edges = [];
  project.maps[0].graph.nodes.push({ ...newCard('note'), evidence_ids: [project.graph.evidences[0].id] });
  assert.throws(() => validateProject(project), /maps\[0\].graph.nodes.*sem evidência/);
});

test('removing the primary map preserves the promoted map ID and every remaining graph', () => {
  const project = exampleProject(), first = addMap(project, 'Entrega'), second = addMap(project, 'Cobrança');
  projectMap(project, first).graph.nodes.push(newCard('event'));
  updateMap(project, first, { modality: 'design' });
  const graph = structuredClone(projectMap(project, first).graph);
  removeMap(project, 'main');
  assert.deepEqual(projectMaps(project).map(map => map.id), [first, second]);
  assert.equal(projectMaps(project)[0].name, 'Entrega');
  assert.equal(project.modality, 'design');
  assert.deepEqual(project.graph, graph);
  removeMap(project, second);
  assert.throws(() => removeMap(project, first), /pelo menos um mapa/);
  assert.equal(projectMaps(validateProject(project)).length, 1);
});

test('duplicate graphs remain detached while internal IDs and evidence remain valid', () => {
  const project = exampleProject(), id = addMap(project, 'Cópia');
  updateMap(project, id, { graph: structuredClone(project.graph) });
  const copy = projectMap(project, id);
  copy.graph.nodes[0].description = 'Somente na cópia';
  assert.equal(project.graph.nodes[0].description, '');
  assert.doesNotThrow(() => validateProject(project));
});

test('versions, restoration, session recovery and bundles preserve every map', async () => {
  const project = newProject('Múltiplos mapas'), id = addMap(project, 'Entrega');
  project.graph.nodes.push(newCard('command'));
  projectMap(project, id).graph.nodes.push(newCard('event'));
  const store = new LocalStore({ name: crypto.randomUUID(), memory: true, sessionId: 'original' });
  const engine = new VersionEngine(store, project.id);
  await engine.init(project);
  const initial = engine.state.localHead;
  const changed = structuredClone(project);
  changed.graph.nodes[0].description = 'No principal';
  changed.maps[0].graph.nodes[0].properties = { width: 400, height: 260 };
  await engine.updateWorkingCopy(changed);
  await engine.saveVersion('Ambos os mapas editados');
  const recovered = new VersionEngine(store, project.id);
  await recovered.init(project);
  assert.deepEqual(recovered.state.workingCopy, engine.state.workingCopy);
  const bundle = await engine.exportBundle();
  const otherStore = new LocalStore({ name: crypto.randomUUID(), memory: true, sessionId: 'imported' });
  const imported = new VersionEngine(otherStore, project.id);
  await imported.init(project);
  await imported.importBundle(bundle);
  assert.deepEqual(imported.state.workingCopy.graph, changed.graph);
  assert.deepEqual(imported.state.workingCopy.maps, changed.maps);
  await engine.restore(initial);
  assert.deepEqual(engine.state.workingCopy.graph, project.graph);
  assert.deepEqual(engine.state.workingCopy.maps, project.maps);
  assert.ok((await engine.history()).length >= 3);
});

test('independent map edits merge while each viewport stays local and resize changes are tracked', () => {
  const base = exampleProject(), id = addMap(base, 'Entrega');
  projectMap(base, id).graph.nodes.push(newCard('event'));
  const local = structuredClone(base), remote = structuredClone(base);
  local.graph.nodes[0].description = 'Principal atualizado';
  local.maps[0].graph.viewport.x = 800;
  remote.maps[0].graph.nodes[0].properties = { width: 400, height: 260 };
  remote.maps[0].graph.nodes[0].updated_at = '2026-10-14T00:00:00Z';
  remote.maps[0].graph.viewport.x = -800;
  const merged = threeWayMerge(base, local, remote);
  assert.equal(merged.conflicts.length, 0);
  assert.equal(merged.value.graph.nodes[0].description, 'Principal atualizado');
  assert.equal(merged.value.maps[0].graph.nodes[0].properties.width, 400);
  assert.equal(merged.value.maps[0].graph.viewport.x, 800);
  const paths = semanticDiff(base, remote).map(change => change.path);
  assert.ok(paths.some(path => path.endsWith('/properties/width')));
  assert.ok(paths.every(path => !path.includes('viewport') && !path.endsWith('updated_at')));
});

test('broken references from concurrent edits become a conflict in the affected additional map', () => {
  const base = exampleProject(), id = addMap(base, 'Entrega');
  const a = newCard('event'), b = newCard('command');
  projectMap(base, id).graph.nodes.push(a, b);
  const local = structuredClone(base), remote = structuredClone(base);
  local.maps[0].graph.nodes = [b];
  remote.maps[0].graph.edges.push({ id: 'new-edge', source: a.id, target: b.id, relation: 'before', label: '' });
  local.name = 'Minha edição';remote.name = 'Edição remota';
  const merged = threeWayMerge(base, local, remote);
  assert.equal(merged.conflicts.length, 2);
  assert.ok(merged.conflicts.some(conflict => conflict.path === '/name'));
  const structural = merged.conflicts.find(conflict => conflict.type === 'structural_conflict');
  assert.equal(structural.path, `/maps/${id}/graph`);
  assert.deepEqual(structural.localValue, local.maps[0].graph);
  assert.deepEqual(structural.remoteValue, remote.maps[0].graph);
  assert.deepEqual(merged.value.graph, base.graph);
  assert.doesNotThrow(() => validateProject(merged.value));
  assert.equal(new Set(merged.conflicts.map(item => item.conflictId)).size, merged.conflicts.length);
});

test('primary-map deletion versus a concurrent edit requires a decision on intact maps', async () => {
  const project = exampleProject(), mapId = addMap(project, 'Entrega');
  projectMap(project, mapId).graph.nodes.push(newCard('event'));
  const repository = new MemoryRepositoryAdapter({ projectId: project.id });
  const makeEngine = async () => {
    const store = new LocalStore({ name: crypto.randomUUID(), memory: true, sessionId: crypto.randomUUID() });
    const engine = new VersionEngine(store, project.id);await engine.init(project);return engine;
  };
  const a = await makeEngine();await a.attach(repository);await a.sync();
  const b = await makeEngine();await b.importBundle(await a.exportBundle());await b.attach(repository);await b.sync();
  const deletion = structuredClone(a.state.workingCopy);removeMap(deletion, 'main');
  const edit = structuredClone(b.state.workingCopy);edit.graph.nodes[0].description = 'Edição concorrente';
  await a.updateWorkingCopy(deletion);await b.updateWorkingCopy(edit);await a.sync();await b.sync();
  const conflicts = b.state.conflictSession.conflicts;
  assert.equal(conflicts.length, 1);assert.equal(conflicts[0].type, 'map_structure_conflict');
  assert.deepEqual(conflicts[0].remoteValue.graph, deletion.graph);
  assert.deepEqual(conflicts[0].localValue.graph, edit.graph);
  const recovered = await makeEngine();await recovered.importBundle(await b.exportBundle());
  assert.equal(recovered.state.conflictSession.conflicts[0].type, 'map_structure_conflict');
  await recovered.resolveConflict(conflicts[0].conflictId, 'remote');
  assert.equal(projectMaps(recovered.state.workingCopy)[0].id, mapId);
  assert.deepEqual(recovered.state.workingCopy.graph, deletion.graph);
  assert.equal(recovered.state.workingCopy.maps.length, 0);
});
