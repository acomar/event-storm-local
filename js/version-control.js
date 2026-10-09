/* Native local-first version control. No server, framework, or runtime dependency. */
import { validateProject as validateDomainProject } from './domain.js';
const clone = value => value === undefined ? undefined : structuredClone(value);
const missing = Symbol('missing');
const memoryDatabases = new Map();
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const unique = values => [...new Set(values)];
const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

export class VersionError extends Error {
  constructor(code, message) { super(message); this.name = 'VersionError'; this.code = code; }
}

export function canonicalJSON(value) {
  if (value === undefined || value === missing) return 'undefined';
  if (Array.isArray(value)) return '[' + value.map(canonicalJSON).join(',') + ']';
  if (plain(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJSON(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const equal = (a, b) => canonicalJSON(a) === canonicalJSON(b);
export async function hash(value) {
  const bytes = new TextEncoder().encode(canonicalJSON(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
const pathLabel = path => '/' + path.map(token => typeof token === 'object' ? token.id : token).join('/');
const ignored = path =>
  (path.length === 1 && ['updated_at', 'version'].includes(path[0])) ||
  (path.at(-1) === 'updated_at' && path[0] === 'graph' &&
    ((path.length === 4 && path[1] === 'nodes') || (path.length === 5 && path[1] === 'proposals' && path[3] === 'node'))) ||
  (path[0] === 'graph' && path[1] === 'viewport');
const idArray = values => values.flat().every(item => plain(item) && typeof item.id === 'string');
const setArray = path => String(path.at(-1)).endsWith('_ids');
const normalized = value => value === missing || value === undefined ? null : clone(value);

/** Strict supported project schema. Unknown schema versions never synchronize silently. */
export function validateProject(project) {
  if (!plain(project) || typeof project.id !== 'string' || !project.id || project.schema_version !== '1.0') throw new VersionError('schema', 'Projeto inválido ou versão de formato não suportada.');
  if (typeof project.name !== 'string' || typeof project.objective !== 'string' || !['big_picture', 'process', 'design'].includes(project.modality) || !Number.isInteger(project.version) || project.version < 0 || !plain(project.graph)) throw new VersionError('schema', 'Os campos obrigatórios do projeto são inválidos.');
  for (const field of ['nodes', 'edges', 'sources', 'evidences', 'proposals', 'answers']) {
    const list = project.graph[field];
    if (!Array.isArray(list) || list.some(item => !plain(item) || typeof item.id !== 'string' || !item.id) || new Set(list.map(item => item.id)).size !== list.length) throw new VersionError('schema', `A coleção ${field} possui dados inválidos ou IDs repetidos.`);
  }
  for (const node of project.graph.nodes) {
    if (typeof node.name !== 'string' || typeof node.description !== 'string' || !plain(node.position) || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y) || !Array.isArray(node.evidence_ids) || !plain(node.properties)) throw new VersionError('schema', `Cartão inválido: ${node.id}.`);
  }
  const viewport = project.graph.viewport;
  if (!plain(viewport) || !Number.isFinite(viewport.x) || !Number.isFinite(viewport.y) || !Number.isFinite(viewport.zoom) || viewport.zoom <= 0) throw new VersionError('schema', 'A posição do quadro é inválida.');
  for (const edge of project.graph.edges) if (typeof edge.source !== 'string' || typeof edge.target !== 'string' || typeof edge.relation !== 'string') throw new VersionError('schema', 'Ligação inválida.');
  // Also rejects cycles, non-JSON values, NaN/Infinity and prototype-bearing data.
  const visit = value => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return;
    if (Array.isArray(value)) return value.forEach(visit);
    if (plain(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))) return Object.values(value).forEach(visit);
    throw new VersionError('schema', 'O projeto deve conter apenas dados JSON válidos.');
  };
  try { JSON.stringify(project); visit(project); } catch (error) { throw error instanceof VersionError ? error : new VersionError('schema', 'O projeto contém uma estrutura circular.'); }
  try { validateDomainProject(project); } catch (error) { throw new VersionError('schema', error.message); }
  return project;
}

export function migrateProject(input) {
  const project = clone(input);
  if (project.schema_version === '0.9') {
    project.schema_version = '1.0';
    project.version ??= 1;
    project.graph.answers ??= [];
    project.graph.proposals ??= [];
    project.graph.viewport ??= { x: 0, y: 0, zoom: 1 };
  }
  return validateProject(project);
}

/** Structured operations indexed by entity IDs; metadata and personal viewport do not create differences. */
export function semanticDiff(base, next) {
  const operations = [];
  function walk(a, b, path) {
    if (ignored(path) || equal(a, b)) return;
    if (Array.isArray(a) && Array.isArray(b) && idArray([a, b])) {
      const before = new Map(a.map(item => [item.id, item])), after = new Map(b.map(item => [item.id, item]));
      for (const id of unique([...before.keys(), ...after.keys()])) walk(before.get(id) ?? missing, after.get(id) ?? missing, [...path, { id }]);
      const shared = a.map(item => item.id).filter(id => after.has(id));
      const reordered = b.map(item => item.id).filter(id => before.has(id));
      if (!equal(shared, reordered)) operations.push({ type: 'reorder', path: pathLabel(path), before: shared, after: reordered });
    } else if (plain(a) && plain(b)) {
      for (const key of unique([...Object.keys(a), ...Object.keys(b)])) walk(Object.hasOwn(a, key) ? a[key] : missing, Object.hasOwn(b, key) ? b[key] : missing, [...path, key]);
    } else operations.push({ type: a === missing ? 'add' : b === missing ? 'remove' : 'change', path: pathLabel(path), entityId: path.findLast?.(token => typeof token === 'object')?.id, before: normalized(a), after: normalized(b) });
  }
  walk(base, next, []);
  return operations;
}

/** Three-way semantic merge. A draft can contain a provisional value, but conflicts prevent publication. */
export function threeWayMerge(base, local, remote) {
  const conflicts = [];
  function conflict(a, l, r, path, type) {
    const item = {
      conflictId: `conflict-${conflicts.length + 1}`, path: pathLabel(path), tokens: clone(path), entityId: [...path].reverse().find(token => typeof token === 'object')?.id,
      type, baseValue: normalized(a), localValue: normalized(l), remoteValue: normalized(r),
      baseMissing: a === missing, localMissing: l === missing, remoteMissing: r === missing,
      operations: { local: a === missing ? 'add' : l === missing ? 'remove' : 'change', remote: a === missing ? 'add' : r === missing ? 'remove' : 'change' },
      allowedResolutions: ['local', 'remote', 'edit'], status: 'pending', resolution: null,
    };
    conflicts.push(item);
    return l === missing ? missing : clone(l);
  }
  function walk(a, l, r, path) {
    if (ignored(path)) {
      if (path.at(-1) === 'updated_at') return [a, l, r].filter(value => typeof value === 'string').sort().at(-1) ?? '';
      if (path.at(-1) === 'version') return Math.max(...[a, l, r].filter(value => typeof value === 'number'), 0);
      return clone(l === missing ? r : l);
    }
    if (equal(l, r)) return l === missing ? missing : clone(l);
    if (equal(a, l)) return r === missing ? missing : clone(r);
    if (equal(a, r)) return l === missing ? missing : clone(l);
    if (l === missing || r === missing) return conflict(a, l, r, path, 'delete_vs_update');
    if (a === missing && path.at(-1)?.id) return conflict(a, l, r, path, 'id_collision');
    if ((a === missing || plain(a)) && plain(l) && plain(r)) {
      const result = {};
      const initial = a === missing ? {} : a;
      for (const key of unique([...Object.keys(initial), ...Object.keys(l), ...Object.keys(r)])) {
        const value = walk(Object.hasOwn(initial, key) ? initial[key] : missing, Object.hasOwn(l, key) ? l[key] : missing, Object.hasOwn(r, key) ? r[key] : missing, [...path, key]);
        if (value !== missing) result[key] = value;
      }
      return result;
    }
    if (Array.isArray(a) && Array.isArray(l) && Array.isArray(r)) {
      if (setArray(path)) {
        const result = unique([...a, ...l, ...r]);
        return result.filter(value => a.includes(value) ? l.includes(value) && r.includes(value) : l.includes(value) || r.includes(value));
      }
      if (idArray([a, l, r])) {
        const bm = new Map(a.map(item => [item.id, item])), lm = new Map(l.map(item => [item.id, item])), rm = new Map(r.map(item => [item.id, item]));
        const merged = new Map();
        for (const id of unique([...bm.keys(), ...lm.keys(), ...rm.keys()])) {
          const item = walk(bm.get(id) ?? missing, lm.get(id) ?? missing, rm.get(id) ?? missing, [...path, { id }]);
          if (item !== missing) merged.set(id, item);
        }
        const common = a.map(item => item.id).filter(id => lm.has(id) && rm.has(id) && merged.has(id));
        const lo = l.map(item => item.id).filter(id => common.includes(id)), ro = r.map(item => item.id).filter(id => common.includes(id));
        const localReordered = !equal(common, lo), remoteReordered = !equal(common, ro);
        let order;
        if (localReordered && remoteReordered && !equal(lo, ro)) order = conflict(common, l.map(item => item.id), r.map(item => item.id), [...path, '$order'], 'order_conflict');
        else order = (remoteReordered ? r : l).map(item => item.id);
        order = order.filter(id => merged.has(id));
        // Preserve safe insertions from either side using the closest existing predecessor.
        for (const side of [l, r]) for (let index = 0; index < side.length; index++) {
          const id = side[index].id;
          if (!merged.has(id) || order.includes(id)) continue;
          const prior = side.slice(0, index).map(item => item.id).reverse().find(key => order.includes(key));
          const next = side.slice(index + 1).map(item => item.id).find(key => order.includes(key));
          if (prior) order.splice(order.indexOf(prior) + 1, 0, id);
          else if (next) order.splice(order.indexOf(next), 0, id);
          else order.push(id);
        }
        for (const id of [...merged.keys()].sort()) if (!order.includes(id)) order.push(id);
        return order.map(id => merged.get(id));
      }
    }
    return conflict(a, l, r, path, 'value_changed_both');
  }
  const value = walk(base, local, remote, []);
  if (value?.schema_version === '1.0') {
    try { validateProject(value); }
    catch (error) {
      // Valid inputs can jointly violate domain references (e.g. node deletion vs new edge).
      // Retain the three full graphs for an explicit structural decision; never prune data silently.
      if (/sem .*correspondente|candidatos duplicados/.test(error.message)) {
        conflicts.splice(0, conflicts.length);
        value.graph = conflict(base.graph, local.graph, remote.graph, ['graph'], 'structural_conflict');
        conflicts[0].context = { message: error.message, scope: 'graph', explanation: 'As operações concorrentes alteram referências entre entidades. A escolha preserva um quadro completo e válido.' };
      } else throw error;
    }
  }
  return { value, conflicts, autoMerged: conflicts.length === 0 };
}

/** IndexedDB is preferred. Fallback is explicit and never represents durable storage as guaranteed. */
export class LocalStore {
  constructor({ name = 'event-storm-local', sessionId, memory = false } = {}) {
    this.name = name; this.memory = memory; this.backend = null; this.warning = null; this.db = null;
    this.recoverySessionId = null;
    if (sessionId) this.sessionId = sessionId;
    else {
      this.sessionId = uuid();
      try { this.recoverySessionId = sessionStorage.getItem(`${name}:session`); sessionStorage.setItem(`${name}:session`, this.sessionId); } catch { /* A unique record still isolates this tab. */ }
    }
  }
  async open() {
    if (this.backend) return this;
    if (!this.memory && typeof indexedDB !== 'undefined') {
      try {
        this.db = await new Promise((resolve, reject) => {
          const request = indexedDB.open(this.name, 1);
          request.onupgradeneeded = () => request.result.createObjectStore('records');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
          request.onblocked = () => reject(new Error('Banco local bloqueado por outra versão da aplicação.'));
        });
        this.backend = 'indexedDB'; return this;
      } catch (error) { this.warning = `IndexedDB indisponível: ${error.message}`; }
    }
    if (!this.memory) {
      try {
        const probe = `${this.name}:probe`; localStorage.setItem(probe, '1'); localStorage.removeItem(probe);
        this.backend = 'localStorage'; this.warning = 'Usando armazenamento local alternativo. Pasta compartilhada não pode ser lembrada neste modo.'; return this;
      } catch { /* Explicit memory fallback below. */ }
    }
    this.backend = 'memory'; this.warning = 'Armazenamento apenas em memória: exporte uma cópia antes de fechar o navegador.';
    if (!memoryDatabases.has(this.name)) memoryDatabases.set(this.name, new Map());
    this.records = memoryDatabases.get(this.name); return this;
  }
  async get(key) {
    await this.open();
    if (this.backend === 'memory') return clone(this.records.get(key));
    if (this.backend === 'localStorage') { const value = localStorage.getItem(`${this.name}:${key}`); return value === null ? undefined : JSON.parse(value); }
    return new Promise((resolve, reject) => { const request = this.db.transaction('records').objectStore('records').get(key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  }
  async set(key, value) {
    await this.open();
    if (this.backend === 'memory') { this.records.set(key, clone(value)); return; }
    if (this.backend === 'localStorage') {
      if (value?.handle || (typeof FileSystemHandle !== 'undefined' && value instanceof FileSystemHandle)) throw new VersionError('storage', 'Guardar referência de pasta requer IndexedDB.');
      localStorage.setItem(`${this.name}:${key}`, JSON.stringify(value)); return;
    }
    return new Promise((resolve, reject) => { const transaction = this.db.transaction('records', 'readwrite'); transaction.objectStore('records').put(value, key); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error ?? new Error('Gravação local interrompida.')); });
  }
  async delete(key) {
    await this.open();
    if (this.backend === 'memory') return this.records.delete(key);
    if (this.backend === 'localStorage') return localStorage.removeItem(`${this.name}:${key}`);
    return new Promise((resolve, reject) => { const transaction = this.db.transaction('records', 'readwrite'); transaction.objectStore('records').delete(key); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
  }
  async list(prefix = '') {
    await this.open();
    if (this.backend === 'memory') return [...this.records.entries()].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value: clone(value) }));
    if (this.backend === 'localStorage') {
      const start = `${this.name}:`;
      return Object.keys(localStorage).filter(key => key.startsWith(start + prefix)).map(key => ({ key: key.slice(start.length), value: JSON.parse(localStorage.getItem(key)) }));
    }
    return new Promise((resolve, reject) => {
      const values = [], request = this.db.transaction('records').objectStore('records').openCursor();
      request.onsuccess = () => { const cursor = request.result; if (!cursor) return resolve(values); if (String(cursor.key).startsWith(prefix)) values.push({ key: cursor.key, value: cursor.value }); cursor.continue(); };
      request.onerror = () => reject(request.error);
    });
  }
}

/** A deterministic adapter with true in-process CAS, failure injection and an immutable object store. */
export class MemoryRepositoryAdapter {
  constructor({ repositoryId = uuid(), projectId = null } = {}) {
    this.manifest = { formatVersion: 1, repositoryId, schemaVersion: '1.0', projectId };
    this.objects = new Map(); this.head = null; this.online = true; this.permission = 'granted'; this.beforeCAS = null;
    this.capabilities = { conditionalWrite: true, durable: false, appendOnly: true };
    this.limitations = 'Adapter de teste em memória; não persiste fora deste processo.';
  }
  check() { if (!this.online) throw new VersionError('offline', 'O repositório está indisponível.'); if (this.permission !== 'granted') throw new VersionError('permission', 'Acesso ao repositório necessário.'); }
  async connect() { this.check(); }
  async getPermissionState() { return this.permission; }
  async requestKnownRepositoryPermission() { this.permission = 'granted'; return true; }
  async reconnect() { return this.requestKnownRepositoryPermission(); }
  async readManifest() { this.check(); return clone(this.manifest); }
  async readRef() { this.check(); return this.head; }
  async listHeads() { this.check(); return this.head ? [this.head] : []; }
  async readObject(id) { this.check(); if (!this.objects.has(id)) throw new VersionError('integrity', `Objeto ausente: ${id}.`); return clone(this.objects.get(id)); }
  async writeImmutableObject(id, value) { this.check(); const prior = this.objects.get(id); if (prior && !equal(prior, value)) throw new VersionError('integrity', 'Um objeto imutável já existe com conteúdo diferente.'); this.objects.set(id, clone(value)); }
  async compareAndSetRef(name, expected, next) {
    this.check();
    if (this.beforeCAS) { const hook = this.beforeCAS; this.beforeCAS = null; await hook({ name, expected, next, adapter: this }); }
    this.check(); if (this.head !== expected) return false; this.head = next; return true;
  }
}

async function makeSnapshot(project) {
  validateProject(project);
  const payload = { type: 'snapshot', schemaVersion: '1.0', data: clone(project) };
  const integrityHash = await hash(payload);
  return { id: `s-${integrityHash}`, ...payload, integrityHash };
}
async function makeCommit(snapshotId, parents, message, author) {
  const payload = { type: 'commit', parents: unique(parents.filter(Boolean)), snapshotId, timestamp: now(), author: author || 'Especialista local', message: message || '', schemaVersion: '1.0', nonce: uuid() };
  const integrityHash = await hash(payload);
  return { id: `c-${integrityHash}`, ...payload, integrityHash };
}
export async function verifyObject(object, expectedId = object?.id) {
  if (!plain(object) || !['snapshot', 'commit'].includes(object.type) || object.id !== expectedId) throw new VersionError('integrity', 'Objeto remoto inválido.');
  const { id, integrityHash, ...payload } = object;
  const computed = await hash(payload);
  if (computed !== integrityHash || id !== `${object.type === 'snapshot' ? 's' : 'c'}-${computed}`) throw new VersionError('integrity', 'Integridade inválida: o conteúdo da versão foi alterado.');
  if (!['1.0', '0.9'].includes(object.schemaVersion)) throw new VersionError('schema', 'Esta versão do repositório requer uma aplicação mais recente.');
  if (object.type === 'snapshot') {
    if (object.data?.schema_version !== object.schemaVersion) throw new VersionError('integrity', 'O formato declarado difere do conteúdo.');
    migrateProject(object.data);
  } else if (!Array.isArray(object.parents) || object.parents.some(parent => typeof parent !== 'string' || !parent.startsWith('c-')) || typeof object.snapshotId !== 'string' || !object.snapshotId.startsWith('s-') || typeof object.timestamp !== 'string') throw new VersionError('integrity', 'Metadados da versão são inválidos.');
  return object;
}

function applyConflict(project, conflict, value, remove = false) {
  const tokens = conflict.tokens;
  if (!Array.isArray(tokens) || !tokens.length || tokens.some(token => typeof token === 'string' && ['__proto__', 'constructor', 'prototype'].includes(token))) throw new VersionError('conflict', 'Caminho de resolução inválido.');
  let target = project;
  for (const token of tokens.slice(0, -1)) {
    if (typeof token === 'object') target = target.find(item => item.id === token.id);
    else target = Object.hasOwn(target, token) ? target[token] : undefined;
    if (target === undefined) throw new VersionError('conflict', 'O contexto desta diferença não existe mais.');
  }
  const final = tokens.at(-1);
  if (final === '$order') {
    if (!Array.isArray(value) || new Set(value).size !== value.length || value.some(id => !target.some(item => item.id === id))) throw new VersionError('conflict', 'A ordem escolhida contém IDs inválidos.');
    const order = [...value, ...target.map(item => item.id).filter(id => !value.includes(id))];
    target.splice(0, target.length, ...order.map(id => target.find(item => item.id === id)));
  } else if (typeof final === 'object') {
    const index = target.findIndex(item => item.id === final.id);
    if (remove) { if (index >= 0) target.splice(index, 1); }
    else if (!plain(value) || value.id !== final.id) throw new VersionError('conflict', 'O ID da entidade deve ser preservado.');
    else if (index >= 0) target[index] = clone(value);
    else target.push(clone(value));
  } else if (remove) delete target[final];
  else target[final] = clone(value);
}

export class VersionEngine {
  constructor(store, projectId, adapter = null) {
    this.store = store; this.projectId = projectId; this.adapter = adapter; this.state = null; this.maxRetries = 8;
    this.sessionKey = `session:${projectId}:${store.sessionId}`;
  }
  async persist() {
    this.state.savedAt = now();
    await this.store.set(this.sessionKey, this.state);
    return this.state;
  }
  async init(project) {
    await this.store.open();
    let recovered = await this.store.get(this.sessionKey);
    if (!recovered && this.store.recoverySessionId) recovered = await this.store.get(`session:${this.projectId}:${this.store.recoverySessionId}`);
    if (!recovered) {
      // A browser restore may lose sessionStorage; copying a saved draft preserves every prior tab.
      const sessions = await this.store.list(`session:${this.projectId}:`);
      recovered = sessions.map(item => item.value).sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''))[0];
    }
    this.fresh = !recovered;
    if (recovered) {
      this.state = clone(recovered); this.state.sessionId = this.store.sessionId;
      this.state.workingCopy = migrateProject(this.state.workingCopy);
      if (this.state.workingCopy.id !== this.projectId) throw new VersionError('schema', 'A cópia recuperada pertence a outro projeto.');
      if (this.state.localHead) await this.getCommit(this.state.localHead);
      if (['syncing', 'checking'].includes(this.state.syncState)) this.state.syncState = this.state.conflictSession ? 'needs_resolution' : 'local_changes';
    } else {
      const workingCopy = migrateProject(project);
      if (workingCopy.id !== this.projectId) throw new VersionError('schema', 'Identidade de projeto incompatível.');
      this.state = { workingCopy, baseCommit: null, localHead: null, remoteHead: null, dirty: true, syncState: 'local_changes', conflictSession: null, repositoryId: null, sessionId: this.store.sessionId, lastError: null };
      await this.saveVersion('Projeto criado');
    }
    if (this.adapter) await this.attach(this.adapter);
    return this.persist();
  }
  async updateWorkingCopy(project) {
    if (this.state.conflictSession) throw new VersionError('conflict', 'Conclua a resolução de diferenças antes de alterar o quadro.');
    const next = validateProject(clone(project));
    if (next.id !== this.projectId) throw new VersionError('schema', 'A identidade do projeto não pode mudar.');
    this.state.workingCopy = next;
    this.fresh = false;
    const head = this.state.localHead ? await this.loadSnapshot(this.state.localHead) : null;
    this.state.dirty = head === null || semanticDiff(head, next).length > 0;
    this.state.syncState = this.state.dirty || this.state.localHead !== this.state.remoteHead ? 'local_changes' : 'updated';
    return this.persist();
  }
  async putObject(object) {
    await verifyObject(object);
    const key = `object:${object.id}`, prior = await this.store.get(key);
    if (prior && !equal(prior, object)) throw new VersionError('integrity', 'O objeto local imutável foi alterado.');
    if (!prior) await this.store.set(key, object);
  }
  async getObject(id) {
    let object = await this.store.get(`object:${id}`);
    if (!object) {
      if (!this.adapter) throw new VersionError('integrity', `Versão ausente: ${id}.`);
      try { object = await this.adapter.readObject(id); } catch (error) { if (error instanceof SyntaxError) throw new VersionError('integrity', 'O repositório contém JSON inválido.'); throw error; }
      await verifyObject(object, id); await this.putObject(object);
    }
    return verifyObject(object, id);
  }
  async getCommit(id) {
    const commit = await this.getObject(id);
    if (commit.type !== 'commit') throw new VersionError('integrity', 'Referência aponta para um objeto que não é versão.');
    return commit;
  }
  async loadSnapshot(commitId) {
    const commit = await this.getCommit(commitId), snapshot = await this.getObject(commit.snapshotId);
    if (snapshot.type !== 'snapshot') throw new VersionError('integrity', 'Uma versão aponta para conteúdo inválido.');
    const project = migrateProject(snapshot.data);
    if (project.id !== this.projectId) throw new VersionError('integrity', 'Uma versão pertence a outro projeto.');
    return project;
  }
  async createVersion(project, parents, message, author) {
    const snapshot = await makeSnapshot(project); await this.putObject(snapshot);
    const commit = await makeCommit(snapshot.id, parents, message, author); await this.putObject(commit);
    return commit;
  }
  async saveVersion(message = 'Alterações salvas', author) {
    if (this.state.conflictSession) throw new VersionError('conflict', 'Resolva as diferenças antes de salvar uma nova versão.');
    validateProject(this.state.workingCopy);
    if (this.state.localHead && semanticDiff(await this.loadSnapshot(this.state.localHead), this.state.workingCopy).length === 0) { this.state.dirty = false; await this.persist(); return null; }
    if (this.state.localHead) this.fresh = false;
    const commit = await this.createVersion(this.state.workingCopy, [this.state.localHead], message, author);
    this.state.localHead = commit.id; this.state.dirty = false; this.state.syncState = 'local_changes'; await this.persist(); return commit;
  }
  async ancestors(start) {
    const depths = new Map(), queue = [[start, 0]];
    for (let index = 0; index < queue.length; index++) {
      const [id, depth] = queue[index]; if (!id || depths.has(id)) continue;
      depths.set(id, depth); const commit = await this.getCommit(id);
      for (const parent of commit.parents) queue.push([parent, depth + 1]);
      if (depths.size > 20000) throw new VersionError('integrity', 'Histórico acima do limite de segurança.');
    }
    return depths;
  }
  async isAncestor(ancestor, head) { return ancestor === head || (ancestor && (await this.ancestors(head)).has(ancestor)); }
  async mergeBase(local, remote) {
    const left = await this.ancestors(local), right = await this.ancestors(remote);
    const common = [...left.keys()].filter(id => right.has(id));
    if (!common.length) return null;
    // Prefer a common descendant over its own ancestors, then the closest deterministic candidate.
    const candidatesSet = new Set(common);
    for (const id of common) {
      const commit = await this.getCommit(id);
      for (const parent of commit.parents) candidatesSet.delete(parent);
    }
    const candidates = [...candidatesSet];
    candidates.sort((a, b) => Math.max(left.get(a), right.get(a)) - Math.max(left.get(b), right.get(b)) || a.localeCompare(b));
    if (candidates.length > 1) throw new VersionError('history', 'O histórico possui múltiplos ancestrais concorrentes. Exporte os ramos e integre com revisão antes de sincronizar.');
    return candidates[0];
  }
  async history() {
    const visited = await this.ancestors(this.state.localHead), entries = [];
    for (const id of visited.keys()) {
      const commit = await this.getCommit(id), project = await this.loadSnapshot(id);
      const previous = commit.parents[0] ? await this.loadSnapshot(commit.parents[0]) : null;
      const diff = previous ? semanticDiff(previous, project) : [{ type: 'add', path: '/', before: null, after: project.name }];
      entries.push({ ...commit, diff, summary: `${diff.length} ${diff.length === 1 ? 'alteração' : 'alterações'}` });
    }
    return entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp) || visited.get(a.id) - visited.get(b.id));
  }
  async restore(commitId) {
    if (this.state.conflictSession) throw new VersionError('conflict', 'Resolva as diferenças antes de recuperar uma versão.');
    // Preserve unsaved work as a version before making the restorative version.
    if (this.state.dirty) await this.saveVersion('Cópia preservada antes de recuperar versão');
    const project = await this.loadSnapshot(commitId);
    const commit = await this.createVersion(project, [this.state.localHead], 'Versão anterior restaurada');
    this.fresh = false;
    this.state.workingCopy = project; this.state.localHead = commit.id; this.state.dirty = false; this.state.syncState = 'local_changes';
    return this.persist();
  }
  validateManifest(manifest) {
    if (!plain(manifest) || manifest.formatVersion !== 1 || typeof manifest.repositoryId !== 'string' || !['1.0', '0.9'].includes(manifest.schemaVersion)) throw new VersionError('schema', 'Repositório incompatível ou manifesto inválido.');
    if (manifest.projectId && manifest.projectId !== this.projectId) throw new VersionError('repository', 'Esta pasta pertence a outro projeto.');
    if (this.state.repositoryId && this.state.repositoryId !== manifest.repositoryId) throw new VersionError('repository', 'Esta pasta pertence a outra base. A cópia local foi preservada.');
  }
  async attach(adapter) {
    this.adapter = adapter;
    try {
      await adapter.connect(); const manifest = await adapter.readManifest(); this.validateManifest(manifest);
      this.state.repositoryId = manifest.repositoryId; this.state.lastError = null;
    } catch (error) { this.setFailure(error); }
    return this.persist();
  }
  setFailure(error) {
    const code = error.code || (error.name === 'NotAllowedError' ? 'permission' : error.name === 'SyntaxError' ? 'integrity' : error.name === 'NetworkError' ? 'offline' : 'error');
    this.state.syncState = code === 'permission' ? 'permission_lost' : code === 'offline' ? 'offline' : code === 'integrity' ? 'integrity_error' : 'sync_error';
    this.state.lastError = { code, message: error.message || 'Não foi possível sincronizar.', timestamp: now() };
  }
  async readRemoteHeads() {
    const manifest = await this.adapter.readManifest(); this.validateManifest(manifest);
    this.state.repositoryId = manifest.repositoryId;
    const heads = this.adapter.listHeads ? await this.adapter.listHeads() : [await this.adapter.readRef('main')].filter(Boolean);
    for (const head of heads) await this.loadSnapshot(head);
    return unique(heads).sort();
  }
  async uploadHistory(head) {
    // Objects become available before a head can ever reference them.
    const ancestors = await this.ancestors(head);
    const ordered = [...ancestors.entries()].sort((a, b) => b[1] - a[1]);
    for (const [id] of ordered) {
      const commit = await this.getCommit(id), snapshot = await this.getObject(commit.snapshotId);
      await this.adapter.writeImmutableObject(snapshot.id, snapshot);
      await this.adapter.writeImmutableObject(commit.id, commit);
    }
  }
  async integrate(remoteHead) {
    const localHead = this.state.localHead;
    if (localHead === remoteHead || await this.isAncestor(remoteHead, localHead)) return true;
    if (!localHead || await this.isAncestor(localHead, remoteHead)) {
      const project = await this.loadSnapshot(remoteHead);
      project.graph.viewport = clone(this.state.workingCopy.graph.viewport);
      this.state.localHead = remoteHead; this.state.workingCopy = project; this.state.dirty = false; return true;
    }
    const baseCommit = await this.mergeBase(localHead, remoteHead);
    if (!baseCommit) throw new VersionError('history', 'Os projetos não têm uma versão de origem comum. Importe o pacote completo para compartilhar o mesmo histórico.');
    const [base, local, remote] = await Promise.all([this.loadSnapshot(baseCommit), this.loadSnapshot(localHead), this.loadSnapshot(remoteHead)]);
    local.graph.viewport = clone(this.state.workingCopy.graph.viewport);
    const result = threeWayMerge(base, local, remote);
    if (result.conflicts.length) {
      this.state.conflictSession = { id: uuid(), baseCommit, localCommit: localHead, remoteCommit: remoteHead, merged: result.value, conflicts: result.conflicts, createdAt: now() };
      this.state.syncState = 'needs_resolution'; await this.persist(); return false;
    }
    const commit = await this.createVersion(result.value, [localHead, remoteHead], 'Alterações integradas');
    this.state.localHead = commit.id; this.state.workingCopy = result.value; this.state.dirty = false; await this.persist(); return true;
  }
  async sync() {
    if (this.state.conflictSession) { this.state.syncState = 'needs_resolution'; return this.persist(); }
    if (!this.adapter) { this.state.syncState = 'local_changes'; this.state.lastError = { code: 'no_repository', message: 'Escolha uma pasta para compartilhar o projeto.' }; return this.persist(); }
    try {
      if (this.state.dirty) await this.saveVersion('Alterações preservadas antes da sincronização');
      this.state.syncState = 'syncing'; await this.persist();
      for (let attempt = 0; attempt < this.maxRetries; attempt++) {
        const heads = await this.readRemoteHeads();
        if (heads.length) this.fresh = false;
        this.state.remoteHead = heads.length ? heads[0] : null;
        for (const head of heads) if (!await this.integrate(head)) return this.persist();
        const current = this.state.localHead;
        if (heads.length === 1 && heads[0] === current) {
          this.state.baseCommit = current; this.state.remoteHead = current; this.state.syncState = this.adapter.capabilities?.conditionalWrite === false ? 'publication_pending' : 'updated'; this.state.lastError = null; return this.persist();
        }
        await this.uploadHistory(current);
        // Re-read after preparing immutable objects. CAS remains mandatory where it exists.
        const fresh = await this.readRemoteHeads();
        if (!equal(heads, fresh)) continue;
        const published = await this.adapter.compareAndSetRef('main', heads[0] ?? null, current, heads);
        if (!published) continue;
        const confirmed = await this.readRemoteHeads();
        if (confirmed.length !== 1 || confirmed[0] !== current) continue;
        this.state.baseCommit = current; this.state.remoteHead = current;
        this.fresh = false;
        this.state.syncState = this.adapter.capabilities?.conditionalWrite === false ? 'publication_pending' : 'updated';
        this.state.lastError = null; return this.persist();
      }
      this.state.syncState = 'publication_pending'; this.state.lastError = { code: 'concurrent_publish', message: 'Os ramos foram preservados. Sincronize novamente após a pasta terminar de atualizar.' };
    } catch (error) { this.setFailure(error); }
    return this.persist();
  }
  async resolveConflict(conflictId, choice, customValue) {
    const session = clone(this.state.conflictSession);
    const conflict = session?.conflicts.find(item => item.conflictId === conflictId);
    if (!conflict || !conflict.allowedResolutions.includes(choice)) throw new VersionError('conflict', 'Escolha de resolução inválida.');
    const remove = choice === 'local' ? conflict.localMissing : choice === 'remote' ? conflict.remoteMissing : false;
    const value = choice === 'local' ? conflict.localValue : choice === 'remote' ? conflict.remoteValue : customValue;
    if (choice === 'edit' && customValue === undefined) throw new VersionError('conflict', 'Informe o resultado desejado.');
    applyConflict(session.merged, conflict, value, remove);
    validateProject(session.merged);
    conflict.status = 'resolved'; conflict.resolution = { choice, value: normalized(value), remove, timestamp: now() };
    if (session.conflicts.every(item => item.status === 'resolved')) {
      validateProject(session.merged);
      const commit = await this.createVersion(session.merged, [session.localCommit, session.remoteCommit], 'Diferenças resolvidas');
      this.state.localHead = commit.id; this.state.workingCopy = clone(session.merged); this.state.conflictSession = null; this.state.dirty = false; this.state.syncState = 'local_changes';
      // The next sync always re-reads the remote; this commit preserves human decisions if it moved.
    } else this.state.conflictSession = session;
    return this.persist();
  }
  async exportBundle() {
    if (this.state.dirty && !this.state.conflictSession) await this.saveVersion('Cópia preservada para exportação');
    const roots = unique([this.state.localHead, this.state.baseCommit, this.state.remoteHead, this.state.conflictSession?.localCommit, this.state.conflictSession?.remoteCommit].filter(Boolean));
    const objects = new Map();
    for (const root of roots) for (const id of (await this.ancestors(root)).keys()) {
      const commit = await this.getCommit(id), snapshot = await this.getObject(commit.snapshotId); objects.set(id, commit); objects.set(snapshot.id, snapshot);
    }
    const bundle = { format: 'event-storm-local-bundle', formatVersion: 1, projectId: this.projectId, repositoryId: this.state.repositoryId, exportedAt: now(), state: clone(this.state), objects: [...objects.values()] };
    return { ...bundle, integrityHash: await hash(bundle) };
  }
  async importBundle(bundle, { replace = false } = {}) {
    if (!plain(bundle) || bundle.format !== 'event-storm-local-bundle' || bundle.formatVersion !== 1 || bundle.projectId !== this.projectId || !Array.isArray(bundle.objects) || bundle.objects.length > 50000) throw new VersionError('schema', 'Pacote inválido ou pertencente a outro projeto.');
    const { integrityHash, ...payload } = bundle;
    if (await hash(payload) !== integrityHash) throw new VersionError('integrity', 'O pacote foi modificado ou está incompleto.');
    validateProject(bundle.state?.workingCopy);
    if (bundle.state.workingCopy.id !== this.projectId || typeof bundle.state.localHead !== 'string' || typeof bundle.state.dirty !== 'boolean' || bundle.state.repositoryId !== bundle.repositoryId) throw new VersionError('integrity', 'O estado do pacote é incompatível com seus dados.');
    if (this.state.repositoryId && bundle.repositoryId && this.state.repositoryId !== bundle.repositoryId) throw new VersionError('repository', 'O pacote pertence a outra base compartilhada.');
    if (this.state.conflictSession) throw new VersionError('conflict', 'Conclua as diferenças locais antes de importar outro histórico.');
    if (replace && !this.fresh) throw new VersionError('history', 'Recuperação completa requer uma sessão nova. O histórico existente deve ser integrado.');
    const indexed = new Map();
    for (const object of bundle.objects) { await verifyObject(object); if (indexed.has(object.id)) throw new VersionError('integrity', 'Pacote contém objetos repetidos.'); indexed.set(object.id, object); }
    for (const object of indexed.values()) if (object.type === 'commit') {
      if (indexed.get(object.snapshotId)?.type !== 'snapshot' || object.parents.some(parent => indexed.get(parent)?.type !== 'commit')) throw new VersionError('integrity', 'Histórico do pacote está incompleto.');
      if (indexed.get(object.snapshotId).data.id !== this.projectId) throw new VersionError('integrity', 'Pacote contém dados de outro projeto.');
    }
    for (const head of [bundle.state.localHead, bundle.state.baseCommit, bundle.state.remoteHead, bundle.state.conflictSession?.localCommit, bundle.state.conflictSession?.remoteCommit, bundle.state.conflictSession?.baseCommit].filter(Boolean)) if (indexed.get(head)?.type !== 'commit') throw new VersionError('integrity', 'Uma referência do pacote não existe.');
    const snapshotFor = head => migrateProject(indexed.get(indexed.get(head).snapshotId).data);
    if (bundle.state.conflictSession) {
      if (!this.fresh) throw new VersionError('conflict', 'Este pacote possui diferenças pendentes. Abra-o em uma sessão nova ou conclua as decisões na origem antes de integrar.');
      const session = bundle.state.conflictSession;
      if (!plain(session) || !Array.isArray(session.conflicts)) throw new VersionError('integrity', 'Sessão de diferenças inválida.');
      const local = snapshotFor(session.localCommit); local.graph.viewport = clone(bundle.state.workingCopy.graph.viewport);
      const recomputed = threeWayMerge(snapshotFor(session.baseCommit), local, snapshotFor(session.remoteCommit));
      if (session.conflicts.length !== recomputed.conflicts.length) throw new VersionError('integrity', 'A sessão não corresponde às diferenças do histórico.');
      for (let index = 0; index < session.conflicts.length; index++) {
        const supplied = session.conflicts[index], expected = recomputed.conflicts[index];
        for (const field of ['conflictId', 'path', 'tokens', 'type', 'baseValue', 'localValue', 'remoteValue', 'baseMissing', 'localMissing', 'remoteMissing', 'allowedResolutions']) if (!equal(supplied[field], expected[field])) throw new VersionError('integrity', 'Uma diferença do pacote foi modificada.');
        if (supplied.status === 'resolved') {
          const resolution = supplied.resolution;
          if (!plain(resolution) || !expected.allowedResolutions.includes(resolution.choice)) throw new VersionError('integrity', 'Resolução do pacote inválida.');
          const remove = resolution.choice === 'local' ? expected.localMissing : resolution.choice === 'remote' ? expected.remoteMissing : false;
          const value = resolution.choice === 'local' ? expected.localValue : resolution.choice === 'remote' ? expected.remoteValue : resolution.value;
          applyConflict(recomputed.value, expected, value, remove);
        } else if (supplied.status !== 'pending') throw new VersionError('integrity', 'Estado de diferença inválido.');
      }
      validateProject(recomputed.value);
      if (!equal(recomputed.value, session.merged)) throw new VersionError('integrity', 'O resultado da sessão não corresponde às decisões.');
    }
    // Validate the complete package before touching any active state; preserve previous local work.
    if (this.state) await this.store.set(`backup:${this.projectId}:${uuid()}`, { state: clone(this.state), createdAt: now(), reason: 'before_import' });
    for (const object of indexed.values()) await this.putObject(object);
    if (this.fresh || replace) {
      this.state = clone(bundle.state); this.state.sessionId = this.store.sessionId; this.state.repositoryId = bundle.repositoryId;
      this.state.workingCopy = migrateProject(this.state.workingCopy);
      this.state.dirty = semanticDiff(snapshotFor(this.state.localHead), this.state.workingCopy).length > 0;
      this.state.syncState = this.state.conflictSession ? 'needs_resolution' : 'local_changes'; this.state.lastError = null;
    } else {
      if (this.state.dirty) await this.saveVersion('Alterações preservadas antes da importação');
      let incomingHead = bundle.state.localHead;
      if (semanticDiff(snapshotFor(incomingHead), bundle.state.workingCopy).length) incomingHead = (await this.createVersion(bundle.state.workingCopy, [incomingHead], 'Rascunho recuperado do pacote')).id;
      if (this.state.localHead !== incomingHead && !await this.mergeBase(this.state.localHead, incomingHead)) throw new VersionError('history', 'Os históricos não têm uma origem comum. Abra o pacote como projeto separado para preservar ambos.');
      await this.integrate(incomingHead);
      this.state.repositoryId ||= bundle.repositoryId;
      if (!this.state.conflictSession) this.state.syncState = 'local_changes';
      this.state.lastError = null;
    }
    this.fresh = false;
    return this.persist();
  }
}

/**
 * File System Access adapter. Shared/cloud folders have no cross-device CAS.
 * Every published head is a separate, immutable announcement. Concurrent heads
 * remain discoverable until a later integrated commit descends from both.
 * No mutable main ref is ever written, and publication is explicitly provisional.
 */
export class FolderRepositoryAdapter {
  constructor(handle, { store = null, projectId, expectedRepositoryId = null } = {}) {
    this.handle = handle; this.store = store; this.projectId = projectId; this.expectedRepositoryId = expectedRepositoryId;
    this.root = null; this.manifestDirectory = null; this.objectDirectory = null; this.headDirectory = null; this.manifest = null;
    this.capabilities = { conditionalWrite: false, durable: true, appendOnly: true, rememberedHandle: store?.backend === 'indexedDB' };
    this.limitations = 'Pasta compartilhada não oferece gravação condicional entre dispositivos. Publicações são provisórias até os provedores propagarem todos os arquivos; ramos concorrentes são preservados e integrados na próxima sincronização.';
  }
  static async select(store, projectId, expectedRepositoryId = null) {
    if (typeof showDirectoryPicker !== 'function') throw new VersionError('unsupported', 'Este navegador não permite escolher uma pasta. Use exportar/importar pacote.');
    const handle = await showDirectoryPicker({ mode: 'readwrite', id: 'event-storm-local' });
    const adapter = new FolderRepositoryAdapter(handle, { store, projectId, expectedRepositoryId });
    await adapter.connect(); await adapter.remember(); return adapter;
  }
  static async recover(store, projectId, expectedRepositoryId = null) {
    const saved = await store.get(`repository:${projectId}`);
    if (!saved?.handle) return null;
    // Permission is checked separately. Recovery never opens a picker or requests permission.
    return new FolderRepositoryAdapter(saved.handle, { store, projectId, expectedRepositoryId: expectedRepositoryId || saved.repositoryId });
  }
  async remember() {
    if (!this.store) return;
    await this.store.open();
    this.capabilities.rememberedHandle = this.store.backend === 'indexedDB';
    if (this.store.backend !== 'indexedDB') return;
    await this.store.set(`repository:${this.projectId}`, { handle: this.handle, repositoryId: this.manifest?.repositoryId ?? this.expectedRepositoryId, name: this.handle.name });
  }
  async getPermissionState() {
    if (!this.handle) return 'unavailable';
    try { return typeof this.handle.queryPermission === 'function' ? await this.handle.queryPermission({ mode: 'readwrite' }) : 'granted'; }
    catch (error) { if (error.name === 'NotFoundError') return 'unavailable'; throw error; }
  }
  async requestKnownRepositoryPermission() {
    if (!this.handle) return false;
    // Must be invoked from the user's Permitir acesso action, without an awaited picker.
    if (await this.getPermissionState() === 'granted') return true;
    if (typeof this.handle.requestPermission !== 'function') return false;
    return await this.handle.requestPermission({ mode: 'readwrite' }) === 'granted';
  }
  async reconnect() {
    if (!await this.requestKnownRepositoryPermission()) throw new VersionError('permission', 'Permita o acesso à pasta já configurada.');
    await this.connect(); return true;
  }
  async checkPermission() {
    const state = await this.getPermissionState();
    if (state === 'unavailable') throw new VersionError('repository_missing', 'A referência da pasta não está mais disponível. Escolha a pasta novamente.');
    if (state !== 'granted') throw new VersionError('permission', 'A pasta já está configurada. Permita o acesso para continuar sincronizando.');
  }
  async connect() {
    await this.checkPermission();
    try {
      this.root = await this.handle.getDirectoryHandle('.event-storm-local', { create: true });
      this.manifestDirectory = await this.root.getDirectoryHandle('manifests', { create: true });
      this.objectDirectory = await this.root.getDirectoryHandle('objects', { create: true });
      this.headDirectory = await this.root.getDirectoryHandle('heads', { create: true });
    } catch (error) {
      if (error.name !== 'NotFoundError') throw error;
      this.handle = null;
      throw new VersionError('repository_missing', 'A referência da pasta não está mais disponível. Localize a pasta novamente; a cópia local foi preservada.');
    }
    let manifests = await this.readManifests();
    if (!manifests.length) {
      const manifest = { formatVersion: 1, repositoryId: this.expectedRepositoryId || `event-storm-${this.projectId}`, schemaVersion: '1.0', projectId: this.projectId, headProtocol: 'immutable-announcements-v1' };
      const digest = await hash(manifest);
      // Concurrent initialization creates independent records; incompatible identities block use.
      await this.writeNewFile(this.manifestDirectory, `m-${digest}-${uuid()}.json`, manifest);
      manifests = await this.readManifests();
    }
    this.manifest = this.selectManifest(manifests);
    this.expectedRepositoryId = this.manifest.repositoryId;
    await this.remember(); return this;
  }
  selectManifest(manifests) {
    if (!manifests.length) throw new VersionError('integrity', 'O manifesto do repositório não está disponível.');
    const uniqueFormats = unique(manifests.map(canonicalJSON));
    if (uniqueFormats.length !== 1) throw new VersionError('repository', 'A pasta contém inicializações concorrentes de projetos diferentes. Nenhuma versão foi sobrescrita. Use pastas distintas.');
    const manifest = manifests[0];
    if (manifest.formatVersion !== 1 || manifest.schemaVersion !== '1.0' || manifest.headProtocol !== 'immutable-announcements-v1') throw new VersionError('schema', 'Formato de repositório de pasta não suportado.');
    if (manifest.projectId !== this.projectId) throw new VersionError('repository', 'Esta pasta pertence a outro projeto. Importe o pacote original para compartilhar seu histórico.');
    if (this.expectedRepositoryId && this.expectedRepositoryId !== manifest.repositoryId) throw new VersionError('repository', 'A pasta selecionada pertence a outra base.');
    return clone(manifest);
  }
  async readManifests() {
    const values = [];
    for await (const [name, entry] of this.manifestDirectory.entries()) {
      if (entry.kind !== 'file' || !name.endsWith('.json')) continue;
      const file = await entry.getFile();
      if (file.size === 0) continue; // Interrupted createWritable: never a completed record.
      let manifest;
      try { manifest = JSON.parse(await file.text()); } catch { throw new VersionError('integrity', 'Manifesto da pasta contém JSON inválido.'); }
      if (!name.startsWith(`m-${await hash(manifest)}-`)) throw new VersionError('integrity', 'Integridade do manifesto da pasta inválida.');
      values.push(manifest);
    }
    return values;
  }
  async readManifest() {
    await this.checkPermission(); if (!this.root) await this.connect();
    this.manifest = this.selectManifest(await this.readManifests()); return clone(this.manifest);
  }
  async writeNewFile(directory, name, value) {
    let prior;
    try { prior = await directory.getFileHandle(name); } catch (error) { if (error.name !== 'NotFoundError') throw error; }
    if (prior) {
      const file = await prior.getFile();
      if (file.size === 0) throw new VersionError('integrity', 'Um registro interrompido não pode ser reutilizado.');
      let object; try { object = JSON.parse(await file.text()); } catch { throw new VersionError('integrity', 'Registro imutável inválido.'); }
      if (!equal(object, value)) throw new VersionError('integrity', 'Um registro imutável já existe com outro conteúdo.');
      return;
    }
    // Every caller uses a cryptographically unique name. No existing file is overwritten.
    const file = await directory.getFileHandle(name, { create: true });
    const writable = await file.createWritable();
    try { await writable.write(canonicalJSON(value)); await writable.close(); }
    catch (error) { try { await writable.abort(); } catch { /* Original failure is reported. */ } throw error; }
    const confirmed = await file.getFile();
    try { if (!equal(JSON.parse(await confirmed.text()), value)) throw new Error('Conteúdo incompleto.'); }
    catch { throw new VersionError('integrity', 'A gravação da pasta não foi confirmada. A versão local foi preservada.'); }
  }
  async readObject(id) {
    await this.checkPermission(); if (!this.root) await this.connect();
    if (!/^[sc]-[a-f0-9]{64}$/.test(id)) throw new VersionError('integrity', 'Identificador remoto inválido.');
    let invalid = false;
    for await (const [name, entry] of this.objectDirectory.entries()) {
      if (entry.kind !== 'file' || !name.startsWith(`${id}-`) || !name.endsWith('.json')) continue;
      const file = await entry.getFile(); if (!file.size) continue;
      try { const object = JSON.parse(await file.text()); await verifyObject(object, id); return object; }
      catch (error) { if (['permission', 'offline'].includes(error.code)) throw error; invalid = true; }
    }
    throw new VersionError('integrity', invalid ? `Objeto corrompido na pasta: ${id}.` : `Objeto ausente na pasta: ${id}. Aguarde a propagação do provedor e sincronize novamente.`);
  }
  async writeImmutableObject(id, value) {
    await this.checkPermission(); if (!this.root) await this.connect(); await verifyObject(value, id);
    try { const existing = await this.readObject(id); if (!equal(existing, value)) throw new VersionError('integrity', 'Colisão de objeto imutável.'); return; }
    catch (error) { if (error.code !== 'integrity') throw error; }
    // A new replica can recover an interrupted orphan. Prior bytes remain untouched for audit.
    await this.writeNewFile(this.objectDirectory, `${id}-${uuid()}.json`, value);
  }
  async readAnnouncements() {
    await this.readManifest();
    const announcements = [];
    for await (const [name, entry] of this.headDirectory.entries()) {
      if (entry.kind !== 'file' || !name.endsWith('.json')) continue;
      const file = await entry.getFile(); if (!file.size) continue;
      let item; try { item = JSON.parse(await file.text()); } catch { throw new VersionError('integrity', 'Uma publicação da pasta contém JSON inválido.'); }
      const { id, integrityHash, ...body } = item;
      const digest = await hash(body);
      if (id !== `p-${digest}` || name !== `${id}.json` || integrityHash !== digest || item.repositoryId !== this.manifest.repositoryId || !Array.isArray(item.observedHeads) || !/^c-[a-f0-9]{64}$/.test(item.head)) throw new VersionError('integrity', 'Publicação de pasta inválida ou modificada.');
      announcements.push(item);
    }
    return announcements;
  }
  async listHeads() {
    const records = await this.readAnnouncements();
    const heads = unique(records.map(record => record.head)).sort(), superseded = new Set(), visited = new Set();
    // Reachability, rather than timestamps or provider arrival order, determines live branches.
    for (const head of heads) {
      const queue = [head];
      while (queue.length) {
        const id = queue.pop(); if (visited.has(id)) continue; visited.add(id);
        const commit = await this.readObject(id);
        if (commit.type !== 'commit') throw new VersionError('integrity', 'Publicação aponta para um objeto inválido.');
        for (const parent of commit.parents) { if (heads.includes(parent)) superseded.add(parent); queue.push(parent); }
        if (visited.size > 20000) throw new VersionError('integrity', 'Histórico de pasta acima do limite de segurança.');
      }
    }
    return heads.filter(head => !superseded.has(head));
  }
  async readRef() { return (await this.listHeads())[0] ?? null; }
  async compareAndSetRef(name, expected, next, expectedHeads = [expected].filter(Boolean)) {
    if (name !== 'main') throw new VersionError('repository', 'Somente a linha principal é suportada.');
    const current = await this.listHeads();
    if (!equal([...expectedHeads].sort(), current)) return false;
    const commit = await this.readObject(next);
    await this.readObject(commit.snapshotId);
    const body = { formatVersion: 1, repositoryId: this.manifest.repositoryId, head: next, observedHeads: current, createdAt: now(), nonce: uuid() };
    const digest = await hash(body), announcement = { id: `p-${digest}`, ...body, integrityHash: digest };
    await this.writeNewFile(this.headDirectory, `${announcement.id}.json`, announcement);
    // This is verification of currently visible tips, never an atomic CAS claim.
    const confirmed = await this.listHeads(); return confirmed.length === 1 && confirmed[0] === next;
  }
}
