/** Portable schema 1.0, compatible with eventstorm-studio JSON exports. */
export const kinds = Object.freeze({
  event: { label: 'Evento', color: '#ffba66', hint: 'Algo relevante que aconteceu. Ex.: Conta Aberta.' },
  command: { label: 'Comando', color: '#8cc9f5', hint: 'Uma intenção. Ex.: Abrir Conta.' },
  actor: { label: 'Ator', color: '#f2d968', hint: 'Quem participa ou decide.' },
  policy: { label: 'Política', color: '#cbb0ed', hint: 'Quando algo acontece, uma ação é disparada.' },
  read_model: { label: 'Modelo de leitura', color: '#9fd6b3', hint: 'Informações necessárias para decidir.' },
  hotspot: { label: 'Hotspot', color: '#f59abb', hint: 'Dúvida, conflito ou problema a investigar.' },
  external_system: { label: 'Sistema externo', color: '#e8bed6', hint: 'Sistema fora do escopo do domínio.' },
  context: { label: 'Contexto', color: '#b8cbdc', hint: 'Hipótese de fronteira de responsabilidade.' },
  note: { label: 'Nota', color: '#e4e7eb', hint: 'Observação livre.' },
  opportunity: { label: 'Oportunidade', color: '#9fddd6', hint: 'Possibilidade de melhoria.' },
  rule: { label: 'Regra', color: '#dfc3a1', hint: 'Condição ou restrição do negócio.' },
  aggregate: { label: 'Agregado', color: '#f4e89a', hint: 'Candidato a fronteira de consistência e invariantes.' }
});
export const statuses = Object.freeze({ extracted: 'Extraído', suggested: 'Sugerido', hypothesis: 'Hipótese', pending: 'Pendente', validated: 'Validado', contested: 'Contestado', rejected: 'Rejeitado' });
export const relations = Object.freeze({ before: 'Acontece antes de', triggers: 'Dispara', produces: 'Produz', performed_by: 'É executado por', depends_on: 'Depende de', queries: 'Consulta', reacts_to: 'Reage a', belongs_to: 'Pertence a', integrates: 'Integra com', contradicts: 'Contradiz', alternative: 'É alternativa a' });
export const origins = Object.freeze({ person: 'Declarado por pessoa', document: 'Documento', code: 'Evidência de código', deterministic: 'Heurística sem IA', ai: 'Sugestão de IA', expert: 'Especialista' });
export const limits = Object.freeze({ nodes: 5000, edges: 15000, sources: 300, evidences: 15000, proposals: 5000, answers: 1000, sourceContent: 100000, extractionContent: 30000 });
export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

const fail = (path, message) => { throw new Error(`${path}: ${message}`); };
const object = (value, path) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(path, 'deve ser um objeto JSON.');
  return value;
};
const string = (value, path, max, fallback, required = false) => {
  if (value === undefined && fallback !== undefined) value = fallback;
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(path, `texto ${required ? 'não vazio ' : ''}de até ${max} caracteres esperado.`);
  return value;
};
const id = (value, path) => string(value, path, 100, undefined, true);
const numeric = (value, path, fallback, min = -1000000, max = 1000000) => {
  if (value === undefined) value = fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(path, `número finito entre ${min} e ${max} esperado.`);
  return value;
};
const choice = (value, allowed, path, fallback) => {
  if (value === undefined) value = fallback;
  if (!allowed.includes(value)) fail(path, `valor desconhecido: ${String(value)}.`);
  return value;
};
const date = (value, path, fallback) => {
  const result = string(value, path, 100, fallback, true);
  if (!Number.isFinite(Date.parse(result))) fail(path, 'data inválida.');
  return result;
};
function list(value, path, max, normalize) {
  if (value === undefined) value = [];
  if (!Array.isArray(value) || value.length > max) fail(path, `lista de até ${max} itens esperada.`);
  return value.map((item, index) => normalize(item, `${path}[${index}]`));
}
function fields(value, allowed, path) {
  object(value, path);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(path, `campo desconhecido: ${key}.`);
}
function properties(value, path) {
  if (value === undefined) return {};
  object(value, path);
  if (Object.keys(value).length > 30) fail(path, 'no máximo 30 propriedades.');
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key) || !key || key.length > 100) fail(path, 'nome de propriedade inválido.');
    if (!['string', 'boolean', 'number'].includes(typeof item) || (typeof item === 'number' && !Number.isFinite(item)) || (typeof item === 'string' && item.length > 4000)) fail(`${path}.${key}`, 'valor deve ser texto (até 4000 caracteres), booleano ou número finito.');
    result[key] = item;
  }
  return result;
}
function normalizeCard(value, path, timestamp) {
  fields(value, ['id', 'kind', 'name', 'description', 'context', 'properties', 'position', 'origin', 'evidence_ids', 'status', 'author', 'created_at', 'updated_at'], path);
  const position = value.position ?? {};
  fields(position, ['x', 'y'], `${path}.position`);
  return {
    id: id(value.id ?? uid(), `${path}.id`),
    kind: choice(value.kind, Object.keys(kinds), `${path}.kind`, 'event'),
    name: string(value.name, `${path}.name`, 240, undefined, true),
    description: string(value.description, `${path}.description`, 4000, ''),
    context: string(value.context, `${path}.context`, 240, ''),
    properties: properties(value.properties, `${path}.properties`),
    position: { x: numeric(position.x, `${path}.position.x`, 0), y: numeric(position.y, `${path}.position.y`, 0) },
    origin: choice(value.origin, Object.keys(origins), `${path}.origin`, 'person'),
    evidence_ids: list(value.evidence_ids, `${path}.evidence_ids`, 100, id),
    status: choice(value.status, Object.keys(statuses), `${path}.status`, 'pending'),
    author: string(value.author, `${path}.author`, 160, 'Especialista local'),
    created_at: date(value.created_at, `${path}.created_at`, timestamp),
    updated_at: date(value.updated_at, `${path}.updated_at`, timestamp)
  };
}

export function newCard(kind, position = { x: 150, y: 150 }) {
  if (!Object.hasOwn(kinds, kind)) fail('kind', 'tipo de cartão desconhecido.');
  return normalizeCard({ kind, name: kind === 'event' ? 'Novo evento ocorrido' : `Novo ${kinds[kind].label.toLowerCase()}`, position }, 'card', now());
}

export function newProject(name = 'Novo mapa', objective = '', example = false) {
  const timestamp = now();
  const project = example ? exampleProject() : {
    schema_version: '1.0', id: uid(), name, objective, modality: 'big_picture', version: 1,
    graph: { nodes: [], edges: [], sources: [], evidences: [], proposals: [], answers: [], viewport: { x: 0, y: 0, zoom: 0.8 } },
    created_at: timestamp, updated_at: timestamp
  };
  project.name = name;
  if (objective || !example) project.objective = objective;
  return validateProject(project);
}

/** Returns a detached normalized copy. Missing optional schema-1.0 fields gain defaults. */
export function validateProject(value) {
  fields(value, ['schema_version', 'id', 'name', 'objective', 'modality', 'version', 'graph', 'created_at', 'updated_at'], 'project');
  const timestamp = now();
  const graph = value.graph ?? {};
  fields(graph, ['nodes', 'edges', 'sources', 'evidences', 'proposals', 'answers', 'viewport'], 'graph');
  const g = {
    nodes: list(graph.nodes, 'graph.nodes', limits.nodes, (n, p) => normalizeCard(n, p, timestamp)),
    edges: list(graph.edges, 'graph.edges', limits.edges, (e, p) => {
      fields(e, ['id', 'source', 'target', 'relation', 'label'], p);
      return { id: id(e.id ?? uid(), `${p}.id`), source: id(e.source, `${p}.source`), target: id(e.target, `${p}.target`), relation: choice(e.relation, Object.keys(relations), `${p}.relation`, 'before'), label: string(e.label, `${p}.label`, 200, '') };
    }),
    sources: list(graph.sources, 'graph.sources', limits.sources, (s, p) => {
      fields(s, ['id', 'name', 'kind', 'content', 'created_at'], p);
      return { id: id(s.id ?? uid(), `${p}.id`), name: string(s.name, `${p}.name`, 200, undefined, true), kind: choice(s.kind, ['text', 'interview', 'manual', 'example'], `${p}.kind`, 'text'), content: string(s.content, `${p}.content`, limits.sourceContent, ''), created_at: date(s.created_at, `${p}.created_at`, timestamp) };
    }),
    evidences: list(graph.evidences, 'graph.evidences', limits.evidences, (e, p) => {
      fields(e, ['id', 'source_id', 'quote', 'explanation'], p);
      return { id: id(e.id ?? uid(), `${p}.id`), source_id: id(e.source_id, `${p}.source_id`), quote: string(e.quote, `${p}.quote`, 4000, ''), explanation: string(e.explanation, `${p}.explanation`, 4000, '') };
    }),
    proposals: list(graph.proposals, 'graph.proposals', limits.proposals, (proposal, p) => {
      fields(proposal, ['id', 'node', 'reason', 'decision'], p);
      return { id: id(proposal.id ?? uid(), `${p}.id`), node: normalizeCard(proposal.node, `${p}.node`, timestamp), reason: string(proposal.reason, `${p}.reason`, 2000, ''), decision: choice(proposal.decision, ['pending', 'accepted', 'rejected'], `${p}.decision`, 'pending') };
    }),
    answers: list(graph.answers, 'graph.answers', limits.answers, (a, p) => {
      fields(a, ['id', 'question_id', 'question', 'answer', 'source_id', 'created_at'], p);
      return { id: id(a.id ?? uid(), `${p}.id`), question_id: id(a.question_id, `${p}.question_id`), question: string(a.question, `${p}.question`, 1000, ''), answer: string(a.answer, `${p}.answer`, 10000, ''), source_id: id(a.source_id, `${p}.source_id`), created_at: date(a.created_at, `${p}.created_at`, timestamp) };
    }),
    viewport: (() => {
      const v = graph.viewport ?? {};
      fields(v, ['x', 'y', 'zoom'], 'graph.viewport');
      return { x: numeric(v.x, 'graph.viewport.x', 0), y: numeric(v.y, 'graph.viewport.y', 0), zoom: numeric(v.zoom, 'graph.viewport.zoom', 0.8, 0.05, 4) };
    })()
  };
  for (const [name, collection] of Object.entries(g)) {
    if (!Array.isArray(collection)) continue;
    if (new Set(collection.map(x => x.id)).size !== collection.length) fail(`graph.${name}`, 'IDs duplicados.');
  }
  const nodeIds = new Set(g.nodes.map(n => n.id));
  const sourceIds = new Set(g.sources.map(s => s.id));
  const evidenceIds = new Set(g.evidences.map(e => e.id));
  for (const e of g.edges) if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) fail('graph.edges', 'relação sem cartão correspondente.');
  for (const e of g.evidences) if (!sourceIds.has(e.source_id)) fail('graph.evidences', 'evidência sem fonte correspondente.');
  for (const node of [...g.nodes, ...g.proposals.map(p => p.node)]) if (node.evidence_ids.some(e => !evidenceIds.has(e))) fail('graph.nodes', 'cartão sem evidência correspondente.');
  for (const a of g.answers) if (!sourceIds.has(a.source_id)) fail('graph.answers', 'resposta sem fonte correspondente.');
  const proposalNodeIds = g.proposals.map(p => p.node.id);
  if (new Set(proposalNodeIds).size !== proposalNodeIds.length) fail('graph.proposals', 'IDs de cartões candidatos duplicados.');
  const version = numeric(value.version, 'project.version', 1, 1, Number.MAX_SAFE_INTEGER);
  if (!Number.isInteger(version)) fail('project.version', 'versão deve ser um inteiro.');
  return {
    schema_version: choice(value.schema_version, ['1.0'], 'project.schema_version', '1.0'),
    id: id(value.id ?? uid(), 'project.id'), name: string(value.name, 'project.name', 160, undefined, true),
    objective: string(value.objective, 'project.objective', 2000, ''), modality: choice(value.modality, ['big_picture', 'process', 'design'], 'project.modality', 'big_picture'),
    version, graph: g, created_at: date(value.created_at, 'project.created_at', timestamp), updated_at: date(value.updated_at, 'project.updated_at', timestamp)
  };
}

export function importProject(value) {
  const project = validateProject(value);
  project.id = uid();
  project.version = 1;
  project.created_at = now();
  project.updated_at = project.created_at;
  return project;
}

export function exampleProject() {
  const timestamp = now();
  const source = {
    id: uid(), name: 'Cenário didático de abertura de conta', kind: 'example', created_at: timestamp,
    content: 'Exemplo fictício e editável. Cliente solicita abertura. Documentos são recebidos e validados. Após a validação, solicitar abertura. Conta é aberta no core bancário. Cliente é notificado. Documentação recusada exige investigação.'
  };
  const entries = [
    ['actor', 'Cliente', 60, 10], ['command', 'Solicitar abertura', 60, 165], ['event', 'Abertura Solicitada', 315, 165],
    ['event', 'Documentos Recebidos', 570, 165], ['event', 'Documentação Validada', 825, 165], ['policy', 'Quando validada, solicitar abertura', 825, 385],
    ['command', 'Abrir conta', 1080, 385], ['event', 'Conta Aberta', 1335, 165], ['external_system', 'Core bancário', 1335, -45],
    ['event', 'Cliente Notificado', 1590, 165], ['hotspot', 'E se os documentos forem recusados?', 570, 405]
  ];
  const evidences = [];
  const nodes = entries.map(([kind, name, x, y]) => {
    const evidence = { id: uid(), source_id: source.id, quote: source.content, explanation: 'Cenário demonstrativo, não representa processo bancário real.' };
    evidences.push(evidence);
    return { ...newCard(kind, { x, y }), name, origin: 'document', status: 'pending', context: 'Abertura de conta', evidence_ids: [evidence.id] };
  });
  const edges = [[1, 0, 'performed_by'], [1, 2, 'produces'], [2, 3, 'before'], [3, 4, 'before'], [4, 5, 'triggers'], [5, 6, 'triggers'], [6, 7, 'produces'], [7, 8, 'depends_on'], [7, 9, 'before']]
    .map(([a, b, relation]) => ({ id: uid(), source: nodes[a].id, target: nodes[b].id, relation, label: '' }));
  return validateProject({ schema_version: '1.0', id: uid(), name: 'Abertura de conta', objective: 'Compreender a abertura de conta, suas decisões e exceções. Exemplo fictício.', modality: 'big_picture', version: 1, graph: { nodes, edges, sources: [source], evidences, proposals: [], answers: [], viewport: { x: 0, y: 0, zoom: 0.8 } }, created_at: timestamp, updated_at: timestamp });
}
