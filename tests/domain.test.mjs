import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { newProject, newCard, validateProject, importProject, exampleProject, uid } from '../js/domain.js';
import { extractContent, answerQuestion, questions, nextQuestion, inspectProject, exportBlueprint } from '../js/facilitator.js';

function append(project, extraction) {
  const copy = structuredClone(project);
  copy.graph.sources.push(extraction.source);
  copy.graph.evidences.push(...extraction.evidences);
  copy.graph.proposals.push(...extraction.proposals);
  if (extraction.answer) copy.graph.answers.push(extraction.answer);
  return validateProject(copy);
}

test('original schema 1.0 JSON imports without losing graph or evidence', async () => {
  const original = JSON.parse(await readFile(new URL('../examples/abertura-conta.json', import.meta.url), 'utf8'));
  const copy = validateProject(original);
  assert.deepEqual(copy, original);
  assert.notEqual(copy.graph.nodes, original.graph.nodes);
  const imported = importProject(original);
  assert.notEqual(imported.id, original.id);
  assert.deepEqual(imported.graph, original.graph);
  assert.equal(imported.version, 1);
});

test('defaults normalize an early schema 1.0 draft and constructors provide detached objects', () => {
  const p = validateProject({ name: 'Descoberta', graph: { nodes: [{ name: 'Pedido Recebido' }] } });
  assert.equal(p.schema_version, '1.0');
  assert.equal(p.graph.nodes[0].status, 'pending');
  assert.deepEqual(p.graph.nodes[0].position, { x: 0, y: 0 });
  assert.equal(p.graph.viewport.zoom, 0.8);
  const position = { x: 10, y: 20 };
  const card = newCard('aggregate', position);
  position.x = 99;
  assert.equal(card.position.x, 10);
  assert.throws(() => newCard('missing'), /tipo/);
});

test('optional edge endpoints round-trip while legacy edges gain no new fields', () => {
  const project=exampleProject(),legacy=structuredClone(project.graph.edges[0]);
  assert.deepEqual(validateProject(project).graph.edges[0],legacy);
  project.graph.edges[0].source_side='bottom';project.graph.edges[0].target_side='top';
  const copy=validateProject(project);assert.equal(copy.graph.edges[0].source_side,'bottom');assert.equal(copy.graph.edges[0].target_side,'top');
  assert.deepEqual(validateProject(copy),copy);
  project.graph.edges[0].source_side='center';assert.throws(()=>validateProject(project),/source_side/);
});

test('context dimensions remain optional schema properties with validated finite bounds', () => {
  const project=newProject('Contextos'),context=newCard('context');project.graph.nodes.push(context);
  assert.deepEqual(validateProject(project).graph.nodes[0].properties,{});
  context.properties={width:860,height:540};assert.deepEqual(validateProject(project).graph.nodes[0].properties,{width:860,height:540});
  context.properties.width='600';assert.throws(()=>validateProject(project),/properties.width/);
  context.properties.width=20;assert.throws(()=>validateProject(project),/240/);
  context.properties.width=860;context.properties.height=10001;assert.throws(()=>validateProject(project),/10000/);
});

test('ordinary card dimensions round-trip and invalid dimensions are rejected', () => {
  const project=newProject('Cards'),node=newCard('event');project.graph.nodes.push(node);
  node.properties={width:460,height:280};assert.deepEqual(validateProject(project).graph.nodes[0].properties,node.properties);
  node.properties.width=-1;assert.throws(()=>validateProject(project),/properties.width/);
  node.properties.width=460;node.properties.height='280';assert.throws(()=>validateProject(project),/properties.height/);
  node.properties.height=2001;assert.throws(()=>validateProject(project),/2000/);
});

test('unknown schema, extra fields, corrupt values and excessive input are rejected', () => {
  const project = newProject('Teste');
  assert.throws(() => validateProject({ ...project, schema_version: '2.0' }), /schema_version/);
  assert.throws(() => validateProject({ ...project, unsafe: true }), /campo desconhecido/);
  assert.throws(() => validateProject({ ...project, name: 'a'.repeat(161) }), /160/);
  assert.throws(() => validateProject({ ...project, version: 1.5 }), /inteiro/);
  assert.throws(() => validateProject({ ...project, graph: { ...project.graph, nodes: Array(5001).fill({ name: 'Evento Registrado' }) } }), /5000/);
  assert.throws(() => validateProject({ ...project, graph: { ...project.graph, viewport: { x: Infinity, y: 0, zoom: 1 } } }), /finito/);
  assert.throws(() => validateProject({ ...project, graph: { ...project.graph, viewport: { x: 0, y: 0, zoom: 0 } } }), /0.05/);
});

test('all graph references and per-collection ID uniqueness are checked', () => {
  const project = exampleProject();
  const danglingEdge = structuredClone(project);
  danglingEdge.graph.edges[0].source = 'missing';
  assert.throws(() => validateProject(danglingEdge), /relação sem cartão/);
  const danglingEvidence = structuredClone(project);
  danglingEvidence.graph.evidences[0].source_id = 'missing';
  assert.throws(() => validateProject(danglingEvidence), /evidência sem fonte/);
  const danglingNode = structuredClone(project);
  danglingNode.graph.nodes[0].evidence_ids = ['missing'];
  assert.throws(() => validateProject(danglingNode), /cartão sem evidência/);
  const duplicate = structuredClone(project);
  duplicate.graph.nodes.push(structuredClone(duplicate.graph.nodes[0]));
  assert.throws(() => validateProject(duplicate), /IDs duplicados/);
  const danglingAnswer = structuredClone(project);
  danglingAnswer.graph.answers.push({ id: uid(), question_id: 'start', question: 'Início?', answer: 'Pedido Recebido', source_id: 'missing' });
  assert.throws(() => validateProject(danglingAnswer), /resposta sem fonte/);
});

test('dangerous property keys and nonfinite property values are rejected', () => {
  const project = newProject('Teste');
  const node = newCard('event');
  node.properties = JSON.parse('{"__proto__":"unsafe"}');
  project.graph.nodes.push(node);
  assert.throws(() => validateProject(project), /propriedade inválido/);
  node.properties = { confidence: NaN };
  assert.throws(() => validateProject(project), /finito/);
  assert.equal({}.unsafe, undefined);
});

test('example preserves original 11 cards, 9 links and explicit fictional evidence', () => {
  const example = newProject('Sessão', '', true);
  assert.equal(example.name, 'Sessão');
  assert.equal(example.graph.nodes.length, 11);
  assert.equal(example.graph.edges.length, 9);
  assert.ok(example.graph.nodes.every(n => n.status === 'pending'));
  assert.ok(example.graph.evidences.every(e => e.explanation.includes('demonstrativo')));
});

test('text extraction is pure, traceable and all proposals remain hypotheses', () => {
  const project = newProject('Pedido');
  const before = JSON.stringify(project);
  const text = 'O pedido foi recebido.\nO pagamento foi confirmado.\nA conta foi aberta.';
  const extraction = extractContent(project, 'Relato', text);
  assert.equal(JSON.stringify(project), before);
  assert.equal(extraction.source.content, text);
  assert.equal(extraction.proposals.length, 3);
  assert.ok(extraction.proposals.every(p => p.node.status === 'hypothesis' && p.decision === 'pending' && p.node.origin === 'deterministic'));
  assert.ok(extraction.evidences.every(e => text.includes(e.quote)));
  assert.doesNotThrow(() => append(project, extraction));
});

test('negation and conditions do not become positive canonical events', () => {
  const project = newProject('Conta');
  const text = 'A conta não foi aberta. Se o pagamento for confirmado, abrir a conta. Não sabemos quem decidiu.';
  const extraction = extractContent(project, 'Incertezas', text);
  assert.ok(extraction.proposals.every(p => p.node.kind !== 'event'));
  assert.ok(extraction.proposals.some(p => p.node.kind === 'rule'));
  assert.ok(extraction.proposals.some(p => p.node.name.includes('não foi aberta') && p.node.properties.negation));
  const answer = answerQuestion(project, 'end', 'A conta não foi aberta');
  assert.equal(answer.proposals[0].node.kind, 'hotspot');
  assert.equal(answer.proposals[0].node.name, 'A conta não foi aberta');
});

test('repeated candidate preserves different quotes and identifies duplicates on the board', () => {
  const project = newProject('Pedido');
  project.graph.nodes.push({ ...newCard('event'), name: 'Pedido Recebido' });
  const extraction = extractContent(project, 'Relatos', 'O pedido foi recebido. Outro pedido foi recebido ontem.');
  assert.equal(extraction.proposals.length, 1);
  assert.equal(extraction.evidences.length, 2);
  assert.equal(extraction.proposals[0].node.evidence_ids.length, 2);
  assert.match(extraction.proposals[0].reason, /duplicidade/);
});

test('eight interview steps preserve answers and advance exactly one question at a time', () => {
  let project = newProject('Entrevista');
  assert.equal(questions.length, 8);
  for (const question of questions) {
    assert.equal(nextQuestion(project).id, question.id);
    const text = question.kind === 'event' ? 'Etapa Concluída' : 'Termo preservado do especialista';
    const result = answerQuestion(project, question.id, text);
    assert.equal(result.source.kind, 'interview');
    assert.equal(result.answer.answer, text);
    assert.equal(result.answer.source_id, result.source.id);
    assert.equal(result.proposals[0].node.status, 'hypothesis');
    project = append(project, result);
  }
  assert.equal(nextQuestion(project), null);
  assert.equal(project.graph.answers.length, 8);
  assert.throws(() => answerQuestion(project, 'invalid', 'Teste'), /Pergunta desconhecida/);
  assert.throws(() => answerQuestion(project, 'start', 'x'.repeat(10001)), /10000/);
  assert.throws(() => extractContent(project, 'Fonte', 'x'.repeat(30001)), /30000/);
});

test('acceptance into board and explicit expert validation are separate decisions', () => {
  const project = append(newProject('Teste'), extractContent(newProject('Origem'), 'Relato', 'Pedido recebido.'));
  const proposal = project.graph.proposals[0];
  proposal.decision = 'accepted';
  project.graph.nodes.push(structuredClone(proposal.node));
  assert.doesNotThrow(() => validateProject(project));
  assert.ok(inspectProject(project).some(issue => issue.code === 'validation'));
  project.graph.nodes[0].status = 'validated';
  assert.ok(!inspectProject(project).some(issue => issue.code === 'validation'));
});

test('inspection highlights missing causes, actors, outcomes and contradictory links', () => {
  const project = newProject('Análise');
  const event = { ...newCard('event'), name: 'Abrir pedido' };
  const command = { ...newCard('command'), name: 'Receber pedido' };
  project.graph.nodes.push(event, command);
  const isolated = inspectProject(project);
  for (const code of ['past', 'cause', 'isolated', 'actor', 'outcome', 'traceability']) assert.ok(isolated.some(issue => issue.code === code), code);
  project.graph.edges.push({ id: uid(), source: event.id, target: command.id, relation: 'contradicts', label: '' });
  assert.ok(inspectProject(project).some(issue => issue.code === 'contradiction'));
});

test('Blueprint covers all skill sections and exports evidence, candidates and uncertainty', () => {
  let project = exampleProject();
  project = append(project, answerQuestion(project, 'failure', 'Documentação recusada exige análise manual'));
  const blueprint = exportBlueprint(project);
  for (let i = 1; i <= 17; i++) assert.ok(blueprint.includes(`## ${i}.`), `section ${i}`);
  assert.match(blueprint, /Propostas do facilitador/);
  assert.match(blueprint, /Documentação recusada exige análise manual/);
  assert.match(blueprint, /Cenário didático/);
  assert.match(blueprint, /não informada|Não informada/);
  assert.match(blueprint, /```mermaid/);
  assert.match(blueprint, /não provam causalidade/);
  assert.ok(!blueprint.includes('Confirmado pelo facilitador'));
});

test('import with proposals and evidence preserves references without mutating input', () => {
  const project = append(newProject('Importação'), answerQuestion(newProject('Origem'), 'start', 'Pedido Recebido'));
  const before = structuredClone(project);
  const imported = importProject(project);
  assert.deepEqual(project, before);
  assert.deepEqual(imported.graph, project.graph);
  assert.notEqual(imported.id, project.id);
});
