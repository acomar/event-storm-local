---
name: event-storm-local-ai-facilitator
description: Facilitar descoberta de domínio com IA, evidências literais e atualização incremental do mapa, preservando decisões humanas.
---

# Facilitador IA do EventStorm Local

O comportamento de facilitação implementa as skills do SkillForge `eventstorming-facilitator` e `ddd-event-storming-pt`, incluindo o Blueprint e o checklist de validação. A IA interpreta relatos de qualquer domínio e sugere elementos e relações. O armazenamento, a integridade do grafo, o histórico e as decisões humanas continuam locais.

## Procedimento incorporado ao prompt

1. Descobrir objetivo, escopo e modalidade. Preservar a linguagem de quem conhece o domínio.
2. Começar por fatos relevantes expressos no passado; construir a narrativa antes de detalhar implementação.
3. Fazer uma pergunta decisiva por turno. Aceitar respostas parciais e priorizar lacunas na sequência, regras críticas e hotspots.
4. Investigar comandos, atores, informações de leitura, políticas, sistemas externos e causas conhecidas.
5. Registrar alternativas, exceções, falhas, compensações, caminhos manuais e divergências sem apagar relatos anteriores.
6. Manter declarado, inferido e contestado visíveis. Propostas da IA nunca confirmam automaticamente conhecimento.
7. Investigar invariantes, agregados e candidatos a bounded contexts com evidências de linguagem, responsabilidade e limites.
8. Validar um caso real ponta a ponta e um caso de falha antes de aprofundar Process Level ou Software Design.
9. Distinguir funcionamento atual (As-Is) de oportunidades e sugestões (To-Be).
10. Resumir conhecimento e pendências, mantendo rastreabilidade para o Blueprint.

O tom é direto, crítico e respeitoso. O facilitador aponta contradições e lacunas; não elogia automaticamente nem inventa fatos, confiança numérica, pesquisas ou testes realizados.

## Contrato do módulo

`js/ai-facilitator.js` não faz chamadas de rede e não possui dependências externas. A interface envia `messages` e `schema` à ponte local `POST /api/ai/chat`; a ponte devolve o conteúdo textual do modelo. A configuração do provedor pertence à ponte local.

| Export | Responsabilidade |
| --- | --- |
| `facilitatorSystemPrompt` | Instruções de descoberta, facilitação, rastreabilidade e preservação das decisões humanas. |
| `responseSchema` | JSON Schema estrito, com campos permitidos, enumerações e limites. |
| `buildMessages(project, conversation, message)` | Produz mensagens de sistema, contexto limitado do mapa, histórico recente e mensagem atual. |
| `parseFacilitatorResponse(raw, project, conversation, message)` | Valida JSON e citações; devolve resposta, pergunta, resumo, operações e avisos. |
| `applyFacilitatorPlan(project, plan)` | Revalida contra o mapa atual e devolve uma nova cópia do projeto. |
| `conversationFromProject(project)` | Recupera a conversa persistida nas fontes e respostas do schema 1.0. |

Uma conversa usa registros `{role: 'user' | 'assistant', content, question?}`. A recuperação também fornece `summary`, `source_id` e `created_at` quando disponíveis. Papéis `system` fornecidos como histórico são recusados.

A resposta contém exclusivamente `reply`, `question`, `summary`, `nodes`, `edges` e `removals`. Cada nó especifica `id`, `kind`, `name`, `description`, `context`, `evidenceQuote`, `evidenceSourceId` e `certainty`. A certeza permite `stated`, `inferred` e `contested`. Cada relação especifica `source`, `target`, `relation` e `label`. O modelo não controla status, posição, propriedades ou identidade do projeto.

`operations` classifica `add_node`, `reference_node`, `propose_edit`, `add_edge` e `removal_ignored`. O plano também contém `warnings`, `projectId`, `message`, `conversationQuestion`, a resposta original validada e IDs presentes quando o pedido foi preparado. Aplicar o plano é uma operação pura; a interface persiste o projeto resultante em sua transação local.

## Preservação e revisão

- Novos elementos entram como `hypothesis`; relatos contestados entram como `contested`. Origem `ai` e certeza declarada/inferida/contestada ficam explícitas. Candidatos a contextos e agregados permanecem hipóteses.
- Cartões, posições, propriedades manuais, evidências e relações existentes permanecem preservados. O módulo adiciona conhecimento de forma incremental, da esquerda para a direita, sem reorganizar os cartões anteriores.
- Uma revisão de elemento existente vira uma proposta `pending`, com um novo ID de candidato. `node.properties.ai_edit_target_id` identifica o cartão original; `ai_previous_status` registra seu estado anterior. O motivo explica o impacto sobre conhecimento validado. Aplicar a revisão ao elemento original exige uma escolha explícita na interface.
- Relações envolvendo revisões ainda pendentes não são adicionadas. Novas relações recebem o rótulo `Hipótese IA`; a ordem do desenho não prova causalidade. O schema 1.0 não possui status ou evidência próprios por relação.
- Pedidos de remoção geram hotspots rastreáveis. Nenhum cartão é apagado automaticamente.
- Se um cartão referenciado foi removido manualmente depois da preparação do plano, o plano é recusado e deve ser atualizado. Alterações manuais em outros campos são preservadas e confrontadas como propostas.
- Eventos afirmativos acompanhados de evidência com negação são registrados conservadoramente como hotspots. Esta proteção lexical pode também destacar relatos que mereçam revisão contextual.

## Evidência e persistência da conversa

Uma citação é obrigatória para cada elemento proposto e deve ser uma substring literal da fonte indicada. `evidenceSourceId: ''` referencia a mensagem atual. Outros IDs precisam identificar fontes existentes. Respostas anteriores do próprio facilitador não servem como evidência de fatos do domínio.

Cada turno aplicado acrescenta duas fontes `interview`: `Facilitador IA · usuário`, contendo a mensagem original completa, e `Facilitador IA · resposta`, contendo um registro JSON versionado com resposta, pergunta, resumo, vínculo à fonte do usuário e plano validado. Também acrescenta uma resposta com `question_id: 'ai-chat'`, a pergunta anterior e o ID da fonte do usuário. Não há alteração do schema 1.0.

Mensagens de até 30 mil caracteres são preservadas integralmente na fonte. O campo `Answer.answer` mantém os primeiros 10 mil caracteres para respeitar o contrato original; a conversa recuperada usa a fonte completa. O armazenamento está sujeito aos limites existentes: até 300 fontes, 1000 respostas e demais limites do grafo. Um turno que excede esses limites falha sem alterar o projeto original.

## Limites de entrada e saída

| Item | Limite |
| --- | --- |
| Mensagem do usuário | 30 mil caracteres |
| Histórico incluído no pedido | Até 20 mensagens e 24 mil caracteres |
| Contexto do mapa incluído no pedido | Até 90 mil caracteres; omissões e fontes truncadas são sinalizadas |
| Total de mensagens do pedido | Até 23 |
| Resposta textual do modelo | Até 100 mil caracteres, sem cercas Markdown |
| Reply / pergunta / resumo | 6000 / 1000 / 4000 caracteres |
| Nós / relações / solicitações de remoção | 32 / 64 / 20 por turno |
| Citação literal | Até 4000 caracteres |
| IDs temporários | Até 100 caracteres seguros; IDs existentes são referenciados exatamente |

O contexto inclui até 200 cartões, 600 relações entre cartões incluídos, 12 fontes recentes com até 3000 caracteres por fonte e 20 propostas pendentes. Se necessário, reduz essas coleções para respeitar o orçamento. Isso limita o pedido enviado ao provedor; o projeto e seu histórico completos continuam preservados localmente.

O módulo recusa campos desconhecidos, enumerações inválidas, IDs temporários com HTML, referências inexistentes, relações consigo mesmo, citações inventadas, status enviados pelo modelo, mais de uma pergunta e planos de outro projeto. Fontes e histórico são tratados como dados, nunca como instruções de sistema. Nenhuma resposta executa código ou ferramentas.

Validar uma citação literal comprova que o trecho está na fonte; não comprova sua verdade nem que a interpretação semântica da IA está correta. Por isso os resultados continuam sujeitos a revisão e validação humana. O roteiro de perguntas da Entrevista guiada e a extração determinística de texto permanecem disponíveis independentemente do provedor de IA; o roteiro não registra respostas nem cria propostas.

## Critérios de aceite verificados

Os testes do módulo cobrem conversa incremental, posições e correções manuais preservadas, revisão de conhecimento validado, citações atuais e históricas, negação, exclusão sem remoção, recuperação da conversa, contexto de 30 mil caracteres, limites da ponte HTTP, referências inválidas, campos injetados e hipóteses em diferentes domínios. Eles não atestam a qualidade ou disponibilidade de um modelo real; a integração com o provedor é verificada separadamente.

## Referências de origem

- SkillForge: `skills/arquitetura/eventstorming-facilitator/SKILL.md`.
- Blueprint: `skills/arquitetura/eventstorming-facilitator/referencias/modelo-mapa.md`.
- Checklist: `skills/arquitetura/eventstorming-facilitator/referencias/checklist-validacao.md`.
- SkillForge DDD: `skills/arquitetura/ddd-event-storming-pt/SKILL.md`.

O texto de facilitação desta implementação é uma adaptação local desses princípios. A referência de proveniência indicada pela skill DDD é o projeto `yonatankarp/software-design-skills`; não se trata de tradução integral ou distribuição daquele pacote.
