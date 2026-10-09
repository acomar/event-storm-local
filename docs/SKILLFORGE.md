# Skills do SkillForge aplicadas

Fonte auditada: [acomar/skillforge, revisão 1f2a421aadf17aadb82d31aaa91ecc98ed3c28e9](https://github.com/acomar/skillforge/tree/1f2a421aadf17aadb82d31aaa91ecc98ed3c28e9). As skills orientam a implementação; não são bibliotecas carregadas no runtime e não introduzem dependências.

## Modelagem DDD por EventStorming

[ddd-event-storming-pt/SKILL.md](https://github.com/acomar/skillforge/blob/1f2a421aadf17aadb82d31aaa91ecc98ed3c28e9/skills/arquitetura/ddd-event-storming-pt/SKILL.md) foi lida para preservar descoberta do domínio antes de solução técnica, eventos no passado, atores, comandos, políticas, leituras, sistemas externos, exceções e hotspots.

Aplicação concreta: tipos de cartão e relações do Studio, estados de conhecimento editáveis, procedência e evidências, objetivo/escopo do workshop e inspeção de dúvidas. Limites de contexto permanecem hipóteses; não são inferidos como arquitetura definitiva.

## EventStorming Facilitator

[eventstorming-facilitator/SKILL.md](https://github.com/acomar/skillforge/blob/1f2a421aadf17aadb82d31aaa91ecc98ed3c28e9/skills/arquitetura/eventstorming-facilitator/SKILL.md), [roteiro de facilitação](https://github.com/acomar/skillforge/blob/1f2a421aadf17aadb82d31aaa91ecc98ed3c28e9/skills/arquitetura/eventstorming-facilitator/referencias/roteiro-facilitacao.md), [modelo do mapa](https://github.com/acomar/skillforge/blob/1f2a421aadf17aadb82d31aaa91ecc98ed3c28e9/skills/arquitetura/eventstorming-facilitator/referencias/modelo-mapa.md) e [checklist de validação](https://github.com/acomar/skillforge/blob/1f2a421aadf17aadb82d31aaa91ecc98ed3c28e9/skills/arquitetura/eventstorming-facilitator/referencias/checklist-validacao.md) foram lidos.

Aplicação concreta: uma pergunta por vez, respostas preservadas, candidatos acompanhados de trecho de origem, revisão e decisão humanas, hipóteses nunca promovidas automaticamente a fatos. O mapa e a inspeção deixam lacunas visíveis. A implementação é determinística e limitada; não afirma compreensão geral de linguagem natural nem completude do domínio.

A exportação de blueprint Markdown organiza o conteúdo já registrado em 17 partes, incluindo narrativa, eventos, elementos, regras, relatos, candidatos a contextos, rastreabilidade e pendências. Informações ausentes ficam identificadas. O relatório não inventa cenários completos ou fronteiras validadas; agregados e contextos dependem de modelagem explícita por especialistas. Agregado é uma extensão local e limita a importação de volta para o Studio original.

## Local-First Version Control

[local-first-version-control/SKILL.md](https://github.com/acomar/skillforge/blob/1f2a421aadf17aadb82d31aaa91ecc98ed3c28e9/skills/arquitetura/local-first-version-control/SKILL.md) foi lida com estas referências:

| Referência | Uso na implementação |
|---|---|
| [implementacao-minima.md](https://github.com/acomar/skillforge/blob/1f2a421aadf17aadb82d31aaa91ecc98ed3c28e9/skills/arquitetura/local-first-version-control/referencias/implementacao-minima.md) | Separação entre LocalStore, motor, merge e adapters; prova determinística antes de expandir providers |
| [matriz-capacidades.md](https://github.com/acomar/skillforge/blob/1f2a421aadf17aadb82d31aaa91ecc98ed3c28e9/skills/arquitetura/local-first-version-control/referencias/matriz-capacidades.md) | Suporte descrito conforme evidência, sem supor compatibilidade de APIs |
| [experiencia-visual.md](https://github.com/acomar/skillforge/blob/1f2a421aadf17aadb82d31aaa91ecc98ed3c28e9/skills/arquitetura/local-first-version-control/referencias/experiencia-visual.md) | Estado compacto, histórico sob demanda e decisões sem exigir edição do JSON |
| [mensagens-interface.md](https://github.com/acomar/skillforge/blob/1f2a421aadf17aadb82d31aaa91ecc98ed3c28e9/skills/arquitetura/local-first-version-control/referencias/mensagens-interface.md) | Linguagem de produto: Alterações salvas, Sincronizar, Resolver diferenças, Permitir acesso |
| [microinteracoes.md](https://github.com/acomar/skillforge/blob/1f2a421aadf17aadb82d31aaa91ecc98ed3c28e9/skills/arquitetura/local-first-version-control/referencias/microinteracoes.md) | Autosave discreto, sessões de resolução preservadas e sucesso somente depois da confirmação |

Aplicação concreta: IndexedDB, IDs estáveis, histórico e snapshots imutáveis, integridade, merge semântico com ancestral comum, decisões humanas sobre ambiguidades, preservação local em falhas e interface de adapter substituível. Restauração cria uma nova versão. Git não é requisito para usar o aplicativo.

O adapter de pasta é explicitamente experimental. A ausência de compare-and-swap distribuído no filesystem é tratada com publicações separadas e integração, não escondida sob uma promessa de colaboração confiável. Os cenários e os limites precisam ser verificados por ambiente; ver [CAPABILITIES.md](CAPABILITIES.md).

## Team Topologies

[team-topologies-designer/SKILL.md](https://github.com/acomar/skillforge/blob/1f2a421aadf17aadb82d31aaa91ecc98ed3c28e9/skills/arquitetura/team-topologies-designer/SKILL.md) foi lida durante a auditoria. Não foi usada para inventar times, ownership, carga cognitiva ou topologias organizacionais: o pedido é um aplicativo e não fornece diagnóstico de equipes. A separação modular de código não é apresentada como diagnóstico Team Topologies.

## Limites de conformidade

Estas orientações não eliminam revisão humana ou testes de plataforma. Não foram copiados livros, credenciais ou serviços externos. Os documentos de capacidade diferenciam implementação, testes determinísticos e evidência de navegador. A implementação não se declara uma suíte certificada de todas as recomendações das skills.
