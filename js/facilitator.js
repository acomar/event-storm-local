/** Offline facilitation: lexical proposals are suggestions, never validated facts. */
import { kinds, statuses, origins, relations, limits, uid, now, newCard, validateProject } from './domain.js';

export const questions = Object.freeze([
  { id: 'start', question: 'Qual acontecimento inicia esse processo?', kind: 'event' },
  { id: 'end', question: 'Qual acontecimento indica que o processo terminou?', kind: 'event' },
  { id: 'middle', question: 'O que acontece entre o início e o fim? Escreva um acontecimento por linha.', kind: 'event' },
  { id: 'actors', question: 'Quem participa ou toma decisões nesse processo?', kind: 'actor' },
  { id: 'failure', question: 'O que pode dar errado e como vocês tratam essa situação?', kind: 'hotspot' },
  { id: 'systems', question: 'Quais sistemas externos participam desse processo?', kind: 'external_system' },
  { id: 'rules', question: 'Quais condições ou regras precisam ser respeitadas?', kind: 'rule' },
  { id: 'unknown', question: 'Que dúvida você gostaria de esclarecer com outro especialista?', kind: 'hotspot' }
]);

const fold = value => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
const past = /\b\w+(?:ado|ada|ados|adas|ido|ida|idos|idas)\b|\b(?:aberta|aberto|feito|feita|pago|paga|devolvido|entregue)\b/;
// Common nouns also end in participle suffixes; they do not establish past tense.
const hasPast = value => past.test(value.replace(/\b(?:pedido|pedidos|estado|estados|resultado|resultados|mercado|mercados|dado|dados|partido|partidos)\b/g, ''));
const negative = /\b(?:nao|nunca|jamais|nem|sem)\b|\b(?:negad\w*|recusad\w*)/;
const conditional = /\b(?:se|caso|quando|exceto|somente|apenas|deve|pode|poderia|talvez|hipotese)\b/;
const unknown = /\b(?:nao sei|nao sabemos|desconhecid\w*|duvida|incert\w*)\b/;
const patterns = [
  [/\b(?:solicita\w*|solicitou|solicitar)\b.{0,45}\b(?:abertura|conta)\b/, 'Abertura de Conta Solicitada'],
  [/\b(?:envia\w*|enviou|enviar|recebid\w*)\b.{0,40}\bdocument\w*|\bdocument\w*.{0,40}\b(?:recebid\w*|enviad\w*)\b/, 'Documentos Recebidos'],
  [/\b(?:valid\w*|verific\w*)\b.{0,40}\bdocument\w*|\bdocument\w*.{0,25}\bvalidad\w*/, 'Documentação Validada'],
  [/\b(?:abre|abriu|abrir|aberta|aberto|cria|criou|criar)\b.{0,25}\bconta\b|\bconta\b.{0,25}\b(?:aberta|criada)\b/, 'Conta Aberta'],
  [/\b(?:notific\w*|avis\w*)\b.{0,30}\bcliente\b|\bcliente\b.{0,30}\bnotificad\w*/, 'Cliente Notificado'],
  [/\bpagamento\b.{0,25}\b(?:aprovad\w*|confirmad\w*)/, 'Pagamento Confirmado'],
  [/\bpedido\b.{0,25}\b(?:criad\w*|recebid\w*)/, 'Pedido Recebido']
];

export function nextQuestion(project) {
  const answered = new Set(project.graph.answers.map(answer => answer.question_id));
  return questions.find(question => !answered.has(question.id)) ?? null;
}

/** Pure operation; caller appends its return values in one local transaction. */
export function extractContent(project, name, content, kind) {
  const validated = validateProject(project);
  if (typeof name !== 'string' || !name.trim() || name.length > 200) throw new Error('A fonte precisa de nome com até 200 caracteres.');
  if (typeof content !== 'string' || !content.trim() || content.length > limits.extractionContent) throw new Error(`Informe conteúdo de 1 a ${limits.extractionContent} caracteres.`);
  if (kind !== undefined && !Object.hasOwn(kinds, kind)) throw new Error('Tipo de candidato desconhecido.');
  const source = { id: uid(), name, content, kind: 'text', created_at: now() };
  const evidences = [];
  const proposals = [];
  const seen = new Map();
  // Keep the full source verbatim. Quotes are literal substrings, not rewritten claims.
  const sentences = content.split(/[\n.!?;]+/).map(sentence => sentence.trim()).filter(Boolean);
  for (const sentence of sentences) {
    const normalized = fold(sentence);
    const isNegative = negative.test(normalized);
    const isConditional = conditional.test(normalized);
    const isUnknown = unknown.test(normalized);
    let candidates = [];
    if (kind) {
      const candidateKind = isUnknown || (kind === 'event' && (isNegative || isConditional)) ? 'hotspot' : kind;
      candidates = [[sentence.slice(0, 240), candidateKind]];
    } else if (isUnknown) {
      candidates = [[sentence.slice(0, 240), 'hotspot']];
    } else if (isNegative || isConditional) {
      candidates = [[sentence.slice(0, 240), isConditional ? 'rule' : 'hotspot']];
    } else {
      candidates = patterns.filter(([pattern]) => pattern.test(normalized)).map(([, label]) => [label, 'event']);
      if (!candidates.length && hasPast(normalized) && sentence.length <= 240) candidates = [[sentence, 'event']];
    }
    const sentenceKeys = new Set();
    for (const [candidateName, candidateKind] of candidates) {
      const key = `${candidateKind}:${fold(candidateName)}`;
      if (sentenceKeys.has(key)) continue;
      sentenceKeys.add(key);
      const evidence = {
        id: uid(), source_id: source.id, quote: sentence.slice(0, 4000),
        explanation: 'Trecho literal da fonte. Correspondência lexical determinística; não comprova ocorrência, ordem, causalidade nem validade da regra.'
      };
      const existingProposal = seen.get(key);
      if (existingProposal) {
        // A repeated candidate may have multiple distinct supporting or conflicting quotes.
        if (!evidences.some(e => existingProposal.node.evidence_ids.includes(e.id) && e.quote === evidence.quote)) {
          if (existingProposal.node.evidence_ids.length >= 100) throw new Error('Um candidato excedeu o limite de 100 evidências. Divida o texto em fontes menores.');
          evidences.push(evidence);
          existingProposal.node.evidence_ids.push(evidence.id);
        }
        continue;
      }
      evidences.push(evidence);
      const index = validated.graph.nodes.length + validated.graph.proposals.filter(p => p.decision === 'pending').length + proposals.length;
      const node = {
        ...newCard(candidateKind, { x: 80 + (index % 5) * 245, y: 100 + Math.floor(index / 5) * 190 }),
        name: candidateName, origin: 'deterministic', status: 'hypothesis', author: 'Facilitador local', evidence_ids: [evidence.id],
        properties: { extraction: 'Correspondência lexical', ...(isNegative ? { negation: true } : {}), ...(isConditional ? { conditional: true } : {}) }
      };
      const duplicate = validated.graph.nodes.some(n => fold(n.name) === fold(candidateName)) || validated.graph.proposals.some(p => p.decision === 'pending' && fold(p.node.name) === fold(candidateName));
      const proposal = {
        id: uid(), node, decision: 'pending',
        reason: `${duplicate ? 'Possível duplicidade. ' : ''}${isNegative || isConditional || isUnknown ? 'Negação, condição ou incerteza preservada; não interpretar como ocorrência afirmativa. ' : ''}Candidato textual; revise nome, tipo, contexto e evidências. Aceitar no mapa mantém a hipótese até validação explícita por especialista.`
      };
      proposals.push(proposal);
      seen.set(key, proposal);
    }
  }
  validateProject({ ...validated, graph: { ...validated.graph, sources: [...validated.graph.sources, source], evidences: [...validated.graph.evidences, ...evidences], proposals: [...validated.graph.proposals, ...proposals] } });
  return { source, evidences, proposals };
}

export function answerQuestion(project, questionId, answer) {
  const question = questions.find(item => item.id === questionId);
  if (!question) throw new Error('Pergunta desconhecida.');
  if (typeof answer !== 'string' || !answer.trim() || answer.length > 10000) throw new Error('A resposta precisa de 1 a 10000 caracteres.');
  const extraction = extractContent(project, `Entrevista: ${question.question}`, answer, question.kind);
  extraction.source.kind = 'interview';
  const answerRecord = { id: uid(), question_id: question.id, question: question.question, answer, source_id: extraction.source.id, created_at: now() };
  validateProject({ ...project, graph: { ...project.graph, sources: [...project.graph.sources, extraction.source], evidences: [...project.graph.evidences, ...extraction.evidences], proposals: [...project.graph.proposals, ...extraction.proposals], answers: [...project.graph.answers, answerRecord] } });
  return { ...extraction, answer: answerRecord };
}

export function inspectProject(project) {
  const { graph } = validateProject(project);
  const issues = [];
  const add = (node, code, message) => issues.push({ node_id: node.id, code, message: `${node.name}: ${message}` });
  for (const node of graph.nodes) {
    if (node.status === 'rejected') continue;
    const incoming = graph.edges.filter(edge => edge.target === node.id);
    const outgoing = graph.edges.filter(edge => edge.source === node.id);
    if (node.status !== 'validated') add(node, 'validation', 'conhecimento ainda não validado por especialista.');
    if (!node.evidence_ids.length && !['note', 'opportunity'].includes(node.kind)) add(node, 'traceability', 'origem registrada, mas faltam evidências rastreáveis.');
    if (node.kind === 'event') {
      if (!hasPast(fold(node.name))) add(node, 'past', 'confira se o nome descreve um fato passado.');
      if (negative.test(fold(node.name)) || conditional.test(fold(node.name))) add(node, 'uncertainty', 'negação ou condição no nome; confirme o significado antes de tratá-lo como fato.');
      if (!incoming.some(edge => ['produces', 'triggers'].includes(edge.relation))) add(node, 'cause', 'causa ainda não registrada; pergunte qual intenção ou acontecimento o provocou.');
    }
    if (['event', 'command'].includes(node.kind) && !incoming.length && !outgoing.length) add(node, 'isolated', 'sem relações conhecidas.');
    if (node.kind === 'command') {
      if (!outgoing.some(edge => edge.relation === 'performed_by') && !incoming.some(edge => ['triggers', 'reacts_to'].includes(edge.relation))) add(node, 'actor', 'quem inicia ou executa a intenção ainda precisa ser identificado.');
      if (!outgoing.some(edge => ['produces', 'triggers'].includes(edge.relation))) add(node, 'outcome', 'resultado observável ainda não registrado.');
    }
    if (node.kind === 'context' && !node.evidence_ids.length) add(node, 'boundary', 'candidato a bounded context sem evidências de linguagem, responsabilidade ou limites.');
    if (node.kind === 'aggregate' && !node.description && !Object.keys(node.properties).length) add(node, 'invariant', 'investigue quais invariantes justificam a fronteira de consistência.');
    if ([...incoming, ...outgoing].some(edge => edge.relation === 'contradicts')) add(node, 'contradiction', 'há uma divergência registrada; preserve os dois relatos e valide com os envolvidos.');
  }
  for (const proposal of graph.proposals.filter(p => p.decision === 'pending')) add(proposal.node, 'proposal', 'candidato aguarda revisão antes de entrar no mapa.');
  return issues;
}

const md = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>').replace(/`/g, '\\`');
const lineText = value => md(value).replace(/<br>/g, ' ');
const table = (headers, rows) => rows.length ? [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map(row => `| ${row.map(md).join(' | ')} |`)].join('\n') : 'Ainda não registrado.';

/** SkillForge Blueprint. Absence and uncertainty stay visible in the exported report. */
export function exportBlueprint(project) {
  const p = validateProject(project);
  const g = p.graph;
  const active = g.nodes.filter(n => n.status !== 'rejected');
  const byId = new Map(g.nodes.map(n => [n.id, n]));
  const sourceById = new Map(g.sources.map(s => [s.id, s]));
  const evidenceById = new Map(g.evidences.map(e => [e.id, e]));
  const sortedEvents = active.filter(n => n.kind === 'event').sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
  const sections = [`# Blueprint EventStorming — ${lineText(p.name)}`, `Schema ${p.schema_version} · revisão ${p.version} · modalidade ${p.modality}\n\nGerado a partir do mapa local. Um candidato aceito continua hipótese até validação explícita. Relações e ordem visual não provam causalidade.`,
    '## 1. Objetivo e escopo',
    `**Objetivo:** ${lineText(p.objective || 'Ainda não definido.')}\n\n**Escopo registrado:** ${[...new Set(active.map(n => n.context).filter(Boolean))].map(lineText).join('; ') || 'Ainda não definido.'}\n\n**Participantes/fontes:** ${g.sources.map(s => lineText(s.name)).join('; ') || 'Ainda não registrados.'}`,
    '## 2. Narrativa do domínio',
    sortedEvents.length ? `Leitura do posicionamento dos eventos, da esquerda para a direita; validar esta sequência com especialistas:\n\n${sortedEvents.map(n => `${lineText(n.name)} (${statuses[n.status]})`).join(' → ')}.` : 'Não há eventos suficientes para narrar o processo. Registrar o início e o resultado esperado antes de detalhar implementação.',
    '## 3. Linha do tempo de Domain Events',
    'Ordem visual do quadro. Consulte as relações registradas para as sequências explicitamente modeladas.',
    table(['ID', 'Evento', 'Descrição', 'Status', 'Evidências'], sortedEvents.map(n => [n.id, n.name, n.description, statuses[n.status], n.evidence_ids.join(', ') || 'Não registradas']))
  ];
  const elements = (heading, kind) => {
    sections.push(heading, table(['ID', 'Elemento', 'Descrição / contexto', 'Status', 'Origem'], active.filter(n => n.kind === kind).map(n => [n.id, n.name, [n.description, n.context].filter(Boolean).join(' — '), statuses[n.status], origins[n.origin]])));
  };
  elements('## 4. Commands', 'command');
  elements('## 5. Actors', 'actor');
  elements('## 6. Policies', 'policy');
  elements('## 7. External Systems', 'external_system');
  elements('## 8. Read Models', 'read_model');
  elements('## 9. Aggregates candidatos', 'aggregate');
  sections.push('Agregados exigem evidências de invariantes e validação da fronteira de consistência.');
  elements('## 10. Hotspots', 'hotspot');
  sections.push('## 11. Regras e invariantes descobertas', table(['Regra', 'Contexto', 'Status', 'Evidências', 'Impacto / dúvidas registrados'], active.filter(n => n.kind === 'rule').map(n => [n.name, n.context, statuses[n.status], n.evidence_ids.join(', ') || 'Não registradas', n.description || 'Ainda não registrados.'])));
  sections.push('## 12. Cenários, alternativas e exceções',
    'Os relatos abaixo são evidências de participantes. Ausência de relato não indica ausência de exceções.',
    table(['Pergunta', 'Relato preservado', 'Fonte'], g.answers.map(a => [a.question, a.answer, a.source_id])),
    table(['Caminho registrado', 'Origem', 'Destino'], g.edges.filter(e => ['alternative', 'contradicts'].includes(e.relation)).map(e => [relations[e.relation], byId.get(e.source).name, byId.get(e.target).name])),
    'Happy path, falhas, compensações e caminhos manuais: validar com especialistas onde ainda não houver relato explícito.');
  sections.push('## 13. Candidatos a bounded contexts',
    'Uma fronteira desenhada permanece candidata até validação das responsabilidades, linguagem e regras. Não há inferência automática de fronteiras.',
    table(['Candidato', 'Status registrado', 'Evidências de limite', 'Linguagem / responsabilidade', 'Incertezas / confiança'], active.filter(n => n.kind === 'context').map(n => [n.name, statuses[n.status], n.evidence_ids.join(', ') || 'Não registradas', n.description || 'Não registradas', `Confiança: ${n.properties.confidence ?? 'não informada'}; investigar linguagem, responsabilidade e eventos de integração.`])));
  const traceNodes = [...g.nodes, ...g.proposals.filter(prop => prop.decision === 'pending' && !byId.has(prop.node.id)).map(prop => prop.node)];
  const traceRows = traceNodes.flatMap(n => n.evidence_ids.length ? n.evidence_ids.map(eid => {
    const evidence = evidenceById.get(eid);
    const source = sourceById.get(evidence.source_id);
    return [n.id, n.name, statuses[n.status], origins[n.origin], eid, `${source.name} (${source.id})`, evidence.quote, n.properties.confidence ?? 'Não informada'];
  }) : [[n.id, n.name, statuses[n.status], origins[n.origin], 'Não registrada', 'Não registrada', '', n.properties.confidence ?? 'Não informada']]);
  sections.push('## 14. Evidências, rastreabilidade e candidatos', table(['Elemento ID', 'Nome', 'Status', 'Origem', 'Evidência ID', 'Fonte', 'Trecho literal', 'Confiança'], traceRows),
    '### Propostas do facilitador', table(['Candidato', 'Tipo', 'Decisão', 'Status', 'Motivo'], g.proposals.map(prop => [prop.node.name, kinds[prop.node.kind].label, prop.decision, statuses[prop.node.status], prop.reason])),
    '### Relações registradas',
    'O contrato schema 1.0 não possui evidência própria por relação. Verifique as evidências dos cartões relacionados e valide cada vínculo com especialistas.',
    table(['ID', 'Origem', 'Relação', 'Destino', 'Rótulo'], g.edges.map(e => [e.id, byId.get(e.source).name, relations[e.relation], byId.get(e.target).name, e.label])));
  const priority = { contradiction: 1, uncertainty: 1, boundary: 2, traceability: 2, cause: 2, actor: 2, outcome: 2, invariant: 2, validation: 3, past: 3, isolated: 3, proposal: 3 };
  const issues = inspectProject(p).sort((a, b) => (priority[a.code] || 4) - (priority[b.code] || 4));
  sections.push('## 15. Pendências priorizadas',
    'Prioridade indicativa: divergências e incertezas primeiro; confirmar impacto com participantes. A classificação não foi inferida de incidentes ou métricas.',
    table(['Prioridade', 'Elemento afetado', 'Pendência'], issues.map(issue => [priority[issue.code] || 4, issue.node_id, issue.message])));
  sections.push('## 16. Próximos passos',
    '- Revisar candidatos com as pessoas que conhecem o processo e manter cada hipótese explícita.\n- Resolver divergências preservando os relatos originais e registrar quem validou os fatos.\n- Percorrer um caso real de ponta a ponta e um caso de falha; procurar eventos sem causa e comandos sem resultado.\n- Documentar invariantes e mudanças de linguagem antes de validar agregados ou contextos.\n- Aprofundar processos em Process Level; usar Software Design quando o objetivo exigir detalhamento.\n- Distinguir funcionamento atual (As-Is) de oportunidades propostas (To-Be).');
  const visualIds = new Map(active.map((n, i) => [n.id, `n${i}`]));
  const mermaidLabel = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/[\r\n]+/g, ' ').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  sections.push('## 17. Representação visual',
    active.length ? ['```mermaid', 'flowchart LR', ...active.map(n => `  ${visualIds.get(n.id)}["${mermaidLabel(n.name)} · ${statuses[n.status]}"]`), ...g.edges.filter(e => visualIds.has(e.source) && visualIds.has(e.target)).map(e => `  ${visualIds.get(e.source)} -->|"${mermaidLabel(relations[e.relation])}"| ${visualIds.get(e.target)}`), '```'].join('\n') : 'O quadro ainda está vazio.');
  return `${sections.join('\n\n')}\n`;
}
