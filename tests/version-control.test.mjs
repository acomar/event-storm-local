import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalStore, VersionEngine, MemoryRepositoryAdapter, FolderRepositoryAdapter, threeWayMerge, semanticDiff, migrateProject, hash } from '../js/version-control.js';

function card(id = 'n1', name = 'Pedido recebido') {
  return { id, kind: 'event', name, description: '', context: '', properties: {}, position: { x: 100, y: 100 }, origin: 'person', evidence_ids: [], status: 'pending', author: 'Pessoa local', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };
}
function project() {
  return { id: 'project-test', schema_version: '1.0', name: 'Pedidos', objective: 'Entender pedidos', modality: 'big_picture', version: 1, graph: { nodes: [card()], edges: [], sources: [], evidences: [], proposals: [], answers: [], viewport: { x: 0, y: 0, zoom: 1 } }, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };
}
async function user(remote, bundle) {
  const store = new LocalStore({ name: crypto.randomUUID(), memory: true, sessionId: crypto.randomUUID() });
  const engine = new VersionEngine(store, 'project-test'); await engine.init(project());
  if (bundle) await engine.importBundle(bundle);
  if (remote) await engine.attach(remote);
  return engine;
}
async function harness() {
  const remote = new MemoryRepositoryAdapter({ projectId: 'project-test' });
  const a = await user(remote); await a.sync();
  const b = await user(remote, await a.exportBundle()); await b.sync();
  return { a, b, remote, base: a.state.localHead };
}
async function edit(engine, mutate) { const copy = structuredClone(engine.state.workingCopy); mutate(copy); await engine.updateWorkingCopy(copy); }

test('01 primeiro repositório vazio: publica origem íntegra e evita versão vazia', async () => {
  const remote = new MemoryRepositoryAdapter(); const a = await user(remote);
  assert.equal(remote.head, null); assert.equal((await a.sync()).syncState, 'updated');
  assert.equal(remote.head, a.state.localHead); assert.equal(await a.saveVersion('vazia'), null);
  assert.equal((await a.history()).length, 1);
});
test('02 alteração somente local: salvar não publica automaticamente', async () => {
  const { a, remote, base } = await harness(); await edit(a, p => p.name = 'Novo nome');
  assert.equal(a.state.dirty, true); const commit = await a.saveVersion('Nome corrigido', 'Ana');
  assert.notEqual(commit.id, base); assert.equal(remote.head, base); assert.equal(a.state.dirty, false);
  await a.sync(); assert.equal(remote.head, commit.id);
});
test('03 alteração somente remota: preserva viewport individual', async () => {
  const { a, b } = await harness(); await edit(b, p => p.graph.viewport.x = 55);
  await edit(a, p => p.name = 'Remoto'); await a.sync(); await b.sync();
  assert.equal(b.state.workingCopy.name, 'Remoto'); assert.equal(b.state.workingCopy.graph.viewport.x, 55);
});
test('04 fast-forward: usa o mesmo head remoto sem commit artificial', async () => {
  const { a, b } = await harness(); await edit(a, p => p.objective = 'Nova meta'); await a.sync();
  await b.sync(); assert.equal(a.state.localHead, b.state.localHead); assert.equal((await b.history()).length, 2);
});
test('05 campos diferentes da mesma entidade integram automaticamente pelo ancestral comum', async () => {
  const { a, b, base } = await harness();
  await edit(a, p => { p.graph.nodes[0].name = 'Pedido criado'; p.graph.nodes[0].updated_at = '2026-02-01'; });
  await edit(b, p => { p.graph.nodes[0].description = 'Uma compra'; p.graph.nodes[0].updated_at = '2026-03-01'; });
  await a.sync(); assert.equal((await b.sync()).syncState, 'updated');
  assert.equal(b.state.workingCopy.graph.nodes[0].name, 'Pedido criado'); assert.equal(b.state.workingCopy.graph.nodes[0].description, 'Uma compra');
  const head = await b.getCommit(b.state.localHead); assert.equal(head.parents.length, 2);
  assert.equal(await b.mergeBase(head.parents[0], head.parents[1]), base);
});
test('06 mesmo campo: conflito persistido; resolução é nova versão com duas origens', async () => {
  const { a, b, remote } = await harness(); await edit(a, p => p.name = 'Ana'); await edit(b, p => p.name = 'Bia');
  await a.sync(); const shared = remote.head; await b.sync();
  assert.equal(b.state.syncState, 'needs_resolution'); assert.equal(remote.head, shared);
  const session = b.state.conflictSession, conflict = session.conflicts[0];
  assert.equal(conflict.path, '/name'); assert.equal(conflict.baseValue, 'Pedidos'); assert.equal(conflict.localValue, 'Bia'); assert.equal(conflict.remoteValue, 'Ana');
  assert.equal((await b.store.get(b.sessionKey)).conflictSession.id, session.id);
  await b.resolveConflict(conflict.conflictId, 'local'); assert.equal(b.state.workingCopy.name, 'Bia');
  await b.sync(); assert.equal(b.state.syncState, 'updated'); assert.equal((await b.getCommit(b.state.localHead)).parents.length, 2);
});
test('07 delete versus update: entidade não desaparece silenciosamente', async () => {
  const { a, b } = await harness(); await edit(a, p => p.graph.nodes.splice(0, 1)); await edit(b, p => p.graph.nodes[0].name = 'Atualizado');
  await a.sync(); await b.sync(); const conflict = b.state.conflictSession.conflicts[0];
  assert.equal(conflict.type, 'delete_vs_update'); assert.equal(conflict.entityId, 'n1');
  await b.resolveConflict(conflict.conflictId, 'local'); await b.sync(); assert.equal(b.state.workingCopy.graph.nodes[0].name, 'Atualizado');
});
test('08 adições concorrentes com IDs distintos são preservadas', async () => {
  const { a, b } = await harness(); await edit(a, p => p.graph.nodes.push(card('a', 'A'))); await edit(b, p => p.graph.nodes.push(card('b', 'B')));
  await a.sync(); await b.sync(); assert.equal(b.state.syncState, 'updated'); assert.deepEqual(new Set(b.state.workingCopy.graph.nodes.map(n => n.id)), new Set(['n1', 'a', 'b']));
});
test('09 colisão de ID exige decisão mesmo em campos independentes', async () => {
  const { a, b } = await harness(); await edit(a, p => p.graph.nodes.push(card('same', 'A'))); await edit(b, p => p.graph.nodes.push(card('same', 'B')));
  await a.sync(); await b.sync(); assert.equal(b.state.conflictSession.conflicts[0].type, 'id_collision');
});
test('10 mudança de ordem: conflito só quando movimentos são incompatíveis', async () => {
  const { a, b } = await harness(); await edit(a, p => p.graph.nodes.push(card('n2'), card('n3'))); await a.sync(); await b.sync();
  await edit(a, p => p.graph.nodes = [p.graph.nodes[1], p.graph.nodes[0], p.graph.nodes[2]]);
  await edit(b, p => p.graph.nodes = [p.graph.nodes[0], p.graph.nodes[2], p.graph.nodes[1]]);
  await a.sync(); await b.sync(); const conflict = b.state.conflictSession.conflicts.find(c => c.type === 'order_conflict');
  assert.ok(conflict); await b.resolveConflict(conflict.conflictId, 'remote'); await b.sync(); assert.deepEqual(b.state.workingCopy.graph.nodes.map(n => n.id), ['n2', 'n1', 'n3']);
  const base = [card('a'), card('b')], moved = [base[1], base[0]], edited = structuredClone(base); edited[0].name = 'Outro';
  const result = threeWayMerge({nodes:base}, {nodes:moved}, {nodes:edited}); assert.equal(result.conflicts.length, 0); assert.equal(result.value.nodes[1].name, 'Outro');
});
test('11 remoto muda durante CAS: tenta novamente e preserva todos os ramos', async () => {
  const { a, b, remote } = await harness(); const c = await user(remote, await a.exportBundle());
  await edit(a, p => p.name = 'A'); await a.sync();
  await edit(c, p => p.modality = 'process'); await c.saveVersion('C'); await c.uploadHistory(c.state.localHead);
  await edit(b, p => p.objective = 'B'); remote.beforeCAS = () => { remote.head = c.state.localHead; };
  await b.sync(); assert.equal(b.state.syncState, 'updated');
  assert.equal(b.state.workingCopy.name, 'A'); assert.equal(b.state.workingCopy.objective, 'B'); assert.equal(b.state.workingCopy.modality, 'process');
  assert.ok(await b.isAncestor(c.state.localHead, b.state.localHead)); assert.ok(await b.isAncestor(a.state.localHead, b.state.localHead));
});
test('12 offline durante sync mantém working copy e versão local recuperável', async () => {
  const { a, remote } = await harness(); await edit(a, p => p.name = 'Sem conexão'); remote.online = false;
  await a.sync(); assert.equal(a.state.syncState, 'offline'); assert.equal(a.state.workingCopy.name, 'Sem conexão');
  assert.equal((await a.loadSnapshot(a.state.localHead)).name, 'Sem conexão'); remote.online = true; await a.sync(); assert.equal(a.state.syncState, 'updated');
});
test('13 permissão revogada: reautoriza referência conhecida sem novo seletor', async () => {
  const { a, remote } = await harness(); await edit(a, p => p.name = 'Preservado'); remote.permission = 'denied';
  await a.sync(); assert.equal(a.state.syncState, 'permission_lost'); assert.equal(a.state.workingCopy.name, 'Preservado');
  await remote.reconnect(); await a.sync(); assert.equal(a.state.syncState, 'updated');
});
test('14 JSON inválido ou hash corrompido bloqueia promoção e mantém cópia', async () => {
  const { a, b, remote } = await harness(); await edit(a, p => p.name = 'Novo remoto'); await a.sync();
  const commit = remote.objects.get(a.state.localHead); remote.objects.get(commit.snapshotId).data.name = 'Corrompido';
  await edit(b, p => p.objective = 'Meu trabalho'); await b.sync(); assert.equal(b.state.syncState, 'integrity_error'); assert.equal(b.state.workingCopy.objective, 'Meu trabalho');
  remote.readManifest = async () => { throw new SyntaxError('JSON inválido'); }; await b.sync(); assert.equal(b.state.syncState, 'integrity_error');
});
test('15 migração explícita de schema é determinística e rejeita versão futura', async () => {
  const old = project(); old.schema_version = '0.9'; delete old.graph.answers; delete old.graph.proposals; delete old.graph.viewport;
  const first = migrateProject(old), second = migrateProject(old); assert.deepEqual(first, second); assert.equal(old.schema_version, '0.9');
  const remote = new MemoryRepositoryAdapter(); remote.manifest.schemaVersion = '0.9';
  const payload = { type: 'snapshot', schemaVersion: '0.9', data: old }; const digest = await hash(payload); const snapshot = { id: `s-${digest}`, ...payload, integrityHash: digest };
  const body = { type: 'commit', parents: [], snapshotId: snapshot.id, timestamp: '2026-01-01T00:00:00Z', schemaVersion: '0.9', message: 'Legado' }; const cd = await hash(body); const commit = { id: `c-${cd}`, ...body, integrityHash: cd };
  remote.objects.set(snapshot.id, snapshot); remote.objects.set(commit.id, commit);
  const a = await user(remote); assert.equal((await a.loadSnapshot(commit.id)).schema_version, '1.0');
  const future = project(); future.schema_version = '9.0'; assert.throws(() => migrateProject(future), /não suportada/);
});
test('16 recuperação/revert cria nova versão e preserva trabalho anterior', async () => {
  const { a, base } = await harness(); await edit(a, p => p.name = 'Versão 2'); await a.saveVersion('Segunda'); const second = a.state.localHead;
  await edit(a, p => p.name = 'Rascunho'); await a.restore(base);
  assert.equal(a.state.workingCopy.name, 'Pedidos'); assert.notEqual(a.state.localHead, base);
  const history = await a.history(); assert.equal(history.length, 4); assert.ok(history.some(c => c.id === second));
  assert.ok(history.some(c => c.message === 'Cópia preservada antes de recuperar versão'));
});
test('17 reinício recupera alterações não publicadas e sessão de conflito', async () => {
  const { a, b } = await harness(); await edit(a, p => p.name = 'A'); await edit(b, p => p.name = 'B'); await a.sync(); await b.sync();
  const reopened = new VersionEngine(new LocalStore({ name: b.store.name, memory: true, sessionId: b.store.sessionId }), 'project-test');
  await reopened.init(project()); assert.equal(reopened.state.workingCopy.name, 'B'); assert.equal(reopened.state.conflictSession.id, b.state.conflictSession.id);
  const { a: draft } = await harness(); await edit(draft, p => p.name = 'Não publicado');
  const restart = new VersionEngine(new LocalStore({ name: draft.store.name, memory: true, sessionId: draft.store.sessionId }), 'project-test');
  await restart.init(project()); assert.equal(restart.state.workingCopy.name, 'Não publicado'); assert.equal(restart.state.dirty, true);
});
test('18 duas abas usam sessões independentes e nenhum rascunho sobrescreve outro', async () => {
  const name = crypto.randomUUID(), first = new VersionEngine(new LocalStore({ name, memory: true, sessionId: 'tab-a' }), 'project-test'); await first.init(project());
  const second = new VersionEngine(new LocalStore({ name, memory: true, sessionId: 'tab-b' }), 'project-test'); await second.init(project());
  await edit(first, p => p.name = 'Aba A'); await edit(second, p => p.name = 'Aba B');
  assert.equal((await first.store.get(first.sessionKey)).workingCopy.name, 'Aba A'); assert.equal((await first.store.get(second.sessionKey)).workingCopy.name, 'Aba B');
  assert.equal((await first.store.list('session:project-test:')).length, 2);
});

test('remoto muda durante resolução: publica somente após nova integração', async () => {
  const { a, b, remote } = await harness(); await edit(a, p => p.name = 'A'); await edit(b, p => p.name = 'B'); await a.sync(); await b.sync();
  await edit(a, p => p.name = 'A mais novo'); await a.sync(); const newer = remote.head;
  await b.resolveConflict(b.state.conflictSession.conflicts[0].conflictId, 'local'); await b.sync();
  assert.equal(b.state.syncState, 'needs_resolution'); assert.equal(remote.head, newer); assert.equal(b.state.conflictSession.conflicts[0].remoteValue, 'A mais novo');
  await b.resolveConflict(b.state.conflictSession.conflicts[0].conflictId, 'remote'); await b.sync(); assert.equal(b.state.workingCopy.name, 'A mais novo');
});
test('pacote validado preserva histórico e rejeita corrupção antes de alterar estado', async () => {
  const { a } = await harness(); await edit(a, p => p.name = 'Exportado'); const bundle = await a.exportBundle(); const b = await user(); await b.importBundle(bundle);
  assert.equal(b.state.workingCopy.name, 'Exportado'); assert.equal(b.state.localHead, a.state.localHead); assert.equal((await b.history()).length, (await a.history()).length);
  const head = b.state.localHead; bundle.objects[0].message = 'Corrompido'; await assert.rejects(b.importBundle(bundle), /modificado/); assert.equal(b.state.localHead, head);
});
test('diff semântico identifica entidade e separa ordem de conteúdo', () => {
  const before = project(), after = structuredClone(before); after.graph.nodes[0].name = 'Outro'; after.updated_at = 'amanhã';
  const diff = semanticDiff(before, after); assert.equal(diff.length, 1); assert.equal(diff[0].path, '/graph/nodes/n1/name'); assert.equal(diff[0].entityId, 'n1');
});

test('relações concorrentes inválidas geram decisão estrutural preservando gráficos íntegros', async () => {
  const { a, b } = await harness(); await edit(a, p => p.graph.nodes.push(card('n2'))); await a.sync(); await b.sync();
  await edit(a, p => p.graph.nodes = p.graph.nodes.filter(n => n.id !== 'n1'));
  await edit(b, p => p.graph.edges.push({ id: 'edge-new', source: 'n1', target: 'n2', relation: 'before', label: '' }));
  await a.sync(); await b.sync(); assert.equal(b.state.syncState, 'needs_resolution');
  const conflict = b.state.conflictSession.conflicts[0]; assert.equal(conflict.type, 'structural_conflict');
  await b.resolveConflict(conflict.conflictId, 'local'); await b.sync(); assert.equal(b.state.workingCopy.graph.nodes.length, 2); assert.equal(b.state.workingCopy.graph.edges.length, 1);
});

class FakeFile {
  constructor(name, directory) { this.kind = 'file'; this.name = name; this.directory = directory; this.content = ''; }
  async getFile() { return { size: new TextEncoder().encode(this.content).length, text: async () => this.content }; }
  async createWritable() {
    let pending = '';
    return { write: async content => { pending = content; }, close: async () => { if (this.directory.failNextClose) { this.directory.failNextClose = false; throw new Error('Interrupted write'); } this.content = pending; }, abort: async () => {} };
  }
}
class FakeDirectory {
  constructor(name = 'shared', permissions = { value: 'granted', requests: 0 }) { this.kind = 'directory'; this.name = name; this.items = new Map(); this.permissions = permissions; this.failNextClose = false; }
  async queryPermission() { return this.permissions.value; }
  async requestPermission() { this.permissions.requests++; return this.permissions.value = 'granted'; }
  async getDirectoryHandle(name, { create = false } = {}) {
    let entry = this.items.get(name);
    if (!entry && create) { entry = new FakeDirectory(name, this.permissions); this.items.set(name, entry); }
    if (!entry) throw new DOMException('Missing directory', 'NotFoundError'); return entry;
  }
  async getFileHandle(name, { create = false } = {}) {
    let entry = this.items.get(name);
    if (!entry && create) { entry = new FakeFile(name, this); this.items.set(name, entry); }
    if (!entry) throw new DOMException('Missing file', 'NotFoundError'); return entry;
  }
  async *entries() { yield* [...this.items.entries()]; }
}
async function folderAdapter(handle = new FakeDirectory()) { const adapter = new FolderRepositoryAdapter(handle, { projectId: 'project-test' }); await adapter.connect(); return adapter; }

test('pasta usa publicação provisória append-only e não reescreve ref mutável', async () => {
  const adapter = await folderAdapter(), a = await user(adapter); await a.sync(); assert.equal(a.state.syncState, 'publication_pending');
  const root = adapter.root, before = [...adapter.headDirectory.items.values()].map(entry => entry.content);
  await edit(a, p => p.name = 'Outra versão'); await a.sync();
  assert.equal(a.state.syncState, 'publication_pending'); assert.equal(root.items.has('refs'), false);
  const after = [...adapter.headDirectory.items.values()].map(entry => entry.content); assert.equal(after.length, 2); assert.ok(before.every(content => after.includes(content)));
  assert.deepEqual(await adapter.listHeads(), [a.state.localHead]); await a.sync(); assert.equal(a.state.syncState, 'publication_pending');
});
test('pasta concorrente preserva dois heads e integra quando novos arquivos são descobertos', async () => {
  const adapter = await folderAdapter(), a = await user(adapter); await a.sync(); const b = await user(adapter, await a.exportBundle()); await b.sync();
  const base = a.state.localHead; await edit(a, p => p.name = 'A'); await a.saveVersion('A'); await a.uploadHistory(a.state.localHead);
  await edit(b, p => p.objective = 'B'); await b.saveVersion('B'); await b.uploadHistory(b.state.localHead);
  await adapter.compareAndSetRef('main', base, a.state.localHead, [base]);
  // Simulate delayed propagation on a different device: its immutable announcement arrives later.
  const body = { formatVersion: 1, repositoryId: adapter.manifest.repositoryId, head: b.state.localHead, observedHeads: [base], createdAt: '2026-01-01T00:00:00Z', nonce: crypto.randomUUID() }, digest = await hash(body);
  await adapter.writeNewFile(adapter.headDirectory, `p-${digest}.json`, { id: `p-${digest}`, ...body, integrityHash: digest });
  assert.deepEqual(new Set(await adapter.listHeads()), new Set([a.state.localHead, b.state.localHead]));
  await b.sync(); assert.equal(b.state.syncState, 'publication_pending'); assert.equal(b.state.workingCopy.name, 'A'); assert.equal(b.state.workingCopy.objective, 'B');
  assert.deepEqual(await adapter.listHeads(), [b.state.localHead]);
});
test('pasta com conflito mantém head concorrente e nenhum anúncio apaga ramo', async () => {
  const adapter = await folderAdapter(), a = await user(adapter); await a.sync(); const b = await user(adapter, await a.exportBundle());
  await edit(a, p => p.name = 'A'); await edit(b, p => p.name = 'B'); await a.sync(); const shared = a.state.localHead;
  await b.sync(); assert.equal(b.state.syncState, 'needs_resolution'); assert.deepEqual(await adapter.listHeads(), [shared]);
  assert.equal((await b.loadSnapshot(b.state.localHead)).name, 'B'); await b.resolveConflict(b.state.conflictSession.conflicts[0].conflictId, 'local'); await b.sync();
  assert.ok(await b.isAncestor(shared, b.state.localHead)); assert.equal(adapter.headDirectory.items.size, 3);
});
test('pasta conhecida reautoriza o mesmo handle e recovery não abre picker', async () => {
  const handle = new FakeDirectory(), records = new Map(), store = { backend: 'indexedDB', open: async () => {}, get: async key => records.get(key), set: async (key, value) => records.set(key, value) };
  const original = new FolderRepositoryAdapter(handle, { projectId: 'project-test', store }); await original.connect();
  handle.permissions.value = 'denied'; const recovered = await FolderRepositoryAdapter.recover(store, 'project-test');
  assert.equal(recovered.handle, handle); assert.equal(await recovered.getPermissionState(), 'denied'); assert.equal(handle.permissions.requests, 0);
  await assert.rejects(recovered.connect(), error => error.code === 'permission'); await recovered.reconnect(); assert.equal(handle.permissions.requests, 1); assert.equal(recovered.manifest.repositoryId, original.manifest.repositoryId);
});
test('gravação de pasta interrompida mantém local e ignora anúncio vazio nunca publicado', async () => {
  const adapter = await folderAdapter(), a = await user(adapter); await a.sync(); const base = a.state.localHead;
  await edit(a, p => p.name = 'Preservado'); adapter.headDirectory.failNextClose = true; await a.sync();
  assert.equal(a.state.syncState, 'sync_error'); assert.equal(a.state.workingCopy.name, 'Preservado'); assert.deepEqual(await adapter.listHeads(), [base]);
  await a.sync(); assert.equal(a.state.syncState, 'publication_pending'); assert.equal((await adapter.listHeads())[0], a.state.localHead);
});
test('manifestos concorrentes incompatíveis nunca escolhem identidade silenciosamente', async () => {
  const adapter = await folderAdapter(), wrong = { formatVersion: 1, repositoryId: 'other-repository', schemaVersion: '1.0', projectId: 'other-project', headProtocol: 'immutable-announcements-v1' };
  await adapter.writeNewFile(adapter.manifestDirectory, `m-${await hash(wrong)}-${crypto.randomUUID()}.json`, wrong);
  await assert.rejects(adapter.readManifest(), error => error.code === 'repository');
});

test('importar pacote no mesmo projeto integra ramos e salva rascunho local', async () => {
  const { a, b, remote } = await harness(); await edit(a, p => p.name = 'Recebido'); await a.saveVersion('Ramo A');
  await edit(b, p => p.objective = 'Rascunho local'); const old = b.state.localHead, shared = remote.head;
  await b.importBundle(await a.exportBundle());
  assert.equal(b.state.workingCopy.name, 'Recebido'); assert.equal(b.state.workingCopy.objective, 'Rascunho local'); assert.equal(b.state.dirty, false);
  assert.ok(await b.isAncestor(old, b.state.localHead)); assert.ok(await b.isAncestor(a.state.localHead, b.state.localHead));
  assert.equal(remote.head, shared); assert.equal((await b.history()).length, 4);
});
test('importar pacote divergente gera conflito e mantém seu estado até decisão', async () => {
  const { a, b } = await harness(); await edit(a, p => p.name = 'Recebido'); await a.saveVersion('Ramo A'); await edit(b, p => p.name = 'Meu local');
  await b.importBundle(await a.exportBundle()); assert.equal(b.state.syncState, 'needs_resolution'); assert.equal(b.state.workingCopy.name, 'Meu local');
  assert.equal(b.state.conflictSession.conflicts[0].remoteValue, 'Recebido'); assert.equal(b.state.conflictSession.conflicts[0].localValue, 'Meu local');
});
test('pacote com sessão de resolução é reproduzível e caminhos falsos são rejeitados', async () => {
  const { a, b } = await harness(); await edit(a, p => { p.name = 'A'; p.objective = 'Meta A'; }); await edit(b, p => { p.name = 'B'; p.objective = 'Meta B'; });
  await a.sync(); await b.sync(); await b.resolveConflict(b.state.conflictSession.conflicts[0].conflictId, 'local');
  const bundle = await b.exportBundle(), restored = await user(); await restored.importBundle(bundle);
  assert.equal(restored.state.syncState, 'needs_resolution'); assert.equal(restored.state.conflictSession.conflicts[0].status, 'resolved');
  const corrupt = structuredClone(bundle); corrupt.state.conflictSession.conflicts[0].tokens = ['__proto__', 'polluted']; delete corrupt.integrityHash; corrupt.integrityHash = await hash(corrupt);
  const fresh = await user(); await assert.rejects(fresh.importBundle(corrupt), /modificada/); assert.equal({}.polluted, undefined);
});
test('resultado editado inválido não marca conflito resolvido nem altera sessão', async () => {
  const { a, b } = await harness(); await edit(a, p => p.name = 'A'); await edit(b, p => p.name = 'B'); await a.sync(); await b.sync();
  const previous = structuredClone(b.state.conflictSession), conflict = previous.conflicts[0];
  await assert.rejects(b.resolveConflict(conflict.conflictId, 'edit', ''), /não vazio/); assert.deepEqual(b.state.conflictSession, previous);
  await b.resolveConflict(conflict.conflictId, 'edit', 'Combinado'); assert.equal(b.state.workingCopy.name, 'Combinado');
});

test('propriedades de negócio chamadas version/updated_at não são metadados ignorados', async () => {
  const { a, b } = await harness(); await edit(a, p => p.graph.nodes[0].properties.version = 1); await a.sync(); await b.sync();
  await edit(a, p => p.graph.nodes[0].properties.version = 2); await edit(b, p => p.graph.nodes[0].properties.version = 3);
  assert.equal(b.state.dirty, true); await a.sync(); await b.sync(); assert.equal(b.state.syncState, 'needs_resolution');
  assert.equal(b.state.conflictSession.conflicts[0].path, '/graph/nodes/n1/properties/version');
  const before = project(), after = structuredClone(before); after.graph.nodes[0].properties.updated_at = 'Atributo de negócio';
  assert.equal(semanticDiff(before, after).length, 1);
});
