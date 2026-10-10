# Capacidades e evidências

Esta matriz segue a [skill local-first-version-control](https://github.com/acomar/skillforge/blob/1f2a421aadf17aadb82d31aaa91ecc98ed3c28e9/skills/arquitetura/local-first-version-control/SKILL.md). Implementação existente e expectativa de API não equivalem a compatibilidade certificada.

## Níveis

- **Verificado:** cenário executado com resultado registrado.
- **Parcial:** fluxo demonstrado com limites explícitos.
- **Experimental:** implementação presente sem todas as garantias de plataforma.
- **Não implementado:** não há adapter/capacidade nessa entrega.

## Armazenamento e adapters

| Capacidade | LocalStore navegador | Adapter memória de teste | Adapter pasta |
|---|---|---|---|
| Cópia editável local | IndexedDB; fallback informado | Não é storage de produção | Continua no LocalStore |
| Histórico e snapshots | Objetos imutáveis com integridade | Determinístico | Arquivos imutáveis |
| Merge semântico | Base/Local/Compartilhado | Cenários controlados | Mesmo motor |
| Conflitos persistidos | Sessão local; retomada e edição do resultado exercitadas em pacote divergente | Verificação determinística | Não exige escrever JSON manualmente |
| Publicação concorrente | Sessões distintas por aba | Compare-and-swap controlado | Anúncios separados; sem CAS distribuído; confirmação global permanece pendente |
| Offline | Reload com servidor parado, extração e propostas preservadas exercitados | Simulação de falha | Falha preserva local |
| Permissão de pasta | Handle persistido quando possível | Simulação | Reautorizar handle conhecido antes de abrir seletor |
| Multiusuário entre computadores | Não é garantia do LocalStore | Testa semântica; não prova filesystem | Experimental; provider pode atrasar visibilidade |
| Adapter remoto de workshops / Drive / GitHub | Não implementado | Não implementado | Não implementado |

O adapter de memória é usado somente nos testes e na prova de semântica. O armazenamento de produção é o navegador. A publicação no GitHub do código-fonte é independente do versionamento de workshops.

A pasta mantém `manifests/`, `objects/` e `heads/` dentro de `.event-storm-local`. O motor não declara **Atualizado** global para esse adapter: após publicar, ainda é necessário verificar novas alterações, pois nenhuma leitura prova que outro dispositivo já recebeu todos os arquivos.

## Navegadores

| Ambiente | Edição/IndexedDB | Cache offline | Escolha de pasta | Handle/reautorização | Evidência |
|---|---|---|---|---|---|
| Navegador interno Chromium, Windows | Criação, histórico, duas abas, canvas por teclado, integração de pacotes e roteiro de oito perguntas exercitados; abriu sem aviso de fallback | Exercitado com servidor local parado: reload, edição e retomada | Não exercitado | Não exercitado | [Relatório de interação na UI](TEST_REPORT.md) |
| Chrome Desktop instalado | Não exercitado | Não exercitado | Detectada por disponibilidade da API | Não exercitado | Sem certificação nesta entrega |
| Edge Desktop | Não exercitado | Não exercitado | Detectada por disponibilidade da API | Não exercitado | Sem certificação nesta entrega |
| Firefox Desktop | Não exercitado | Não exercitado | Pacote portátil quando API ausente | Não prometido | Sem certificação nesta entrega |
| Safari Desktop | Não exercitado | Não exercitado | Pacote portátil quando API ausente | Não prometido | Sem certificação nesta entrega |
| Viewport mobile no Chromium interno | Layout exercitado a 390 px; scrollWidth de 390 px | Não exercitado nesse viewport | Não exercitado | Não exercitado | Não certifica um aparelho ou browser mobile real |

Pasta requer contexto seguro e ação explícita do usuário. O browser pode negar a seleção, a escrita ou a persistência do handle. O aplicativo continua oferecendo edição local e exportação portátil. Nenhum provider de sincronização de arquivos foi certificado nesta entrega.

A recuperação distingue referência e permissão: uma pasta conhecida e autorizada é reutilizada; uma pasta conhecida sem permissão oferece **Permitir acesso** no mesmo handle; o seletor só é usado se a referência foi perdida ou ficou inutilizável. Esse protocolo foi exercitado com adapter controlado, não com autorização real de pasta no navegador.

O HTML único não precisa buscar JS/CSS/ícone externos e não registra service worker. Na verificação inicial, o `standalone.html` foi aberto via HTTP, carregou o exemplo com 11 nós e nove relações e exibiu o facilitador determinístico. Abrir em `file://` depende do suporte de armazenamento e das permissões da plataforma. O caso direto não foi exercitado porque a política da ferramenta de navegação deste ambiente aceita apenas HTTP/HTTPS; essa restrição não determina compatibilidade do arquivo no navegador do usuário. IA pela ponte exige HTTP na origem do backend; execução direta dispensa essa ponte quando o endpoint permite CORS.

## Facilitação com IA

| Capacidade | Implementação e evidência |
|---|---|
| Entrevista guiada sem modelo | UI verificada: oito perguntas e oito orientações, sem campos/formulário/chat; alternância preservou os dois elementos e uma relação do mapa |
| Extração de TXT/Markdown | Geração determinística de propostas locais com evidências; independente do modelo |
| Conversa com IA | Contrato estruturado, uma pergunta por vez e contexto limitado; UI exercitada com duas respostas controladas, quatro mensagens retomadas após reload |
| Atualização do mapa | Novos cartões como hipóteses; revisão aceita de comando validado preservou identidade, posição e quatro vínculos; remoções preservam o original; resposta controlada inválida recusada sem alterar os oito elementos e nove relações |
| Evidência e certeza | Trecho literal de fonte válida; nenhuma confiança numérica inventada; modelo não valida conhecimento |
| Ponte HTTP nativa | Oito testes de IA aprovados com provedor local simulado: configuração, encaminhamento, origem, limites, erros, cancelamento e concorrência |
| Editor HTTP | Múltiplos perfis, método, URL, query, cabeçalhos, variáveis, autenticação, corpo, caminho da resposta, preview e teste; exportação e reload exercitados pela UI |
| Credenciais e destino | Perfis salvos guardam credenciais no navegador e nos arquivos/versões; destinos HTTP/HTTPS configuráveis; rota legada por ambiente preservada |
| Ollama / LM Studio / modelo real | Configuração documentada com fontes oficiais; instalação, inferência real e qualidade da conversa não verificadas nesta evidência |
| IA sem servidor do aplicativo | Execução direta com CORS exercitada pela UI via HTTP; acesso direto em `file://` não exercitado |

O caminho real sem servidor de modelo disponível mostrou erro de conexão, preservou dois cartões e uma relação e recuperou o rascunho após reload. A área de contexto foi redimensionada e movida por teclado; o clique em cartão interno funcionou, e as quatro opções de lado de conexão geraram vínculos pela UI. O layout controlado alinhou ator, comando e eventos em faixas distintas. Esses cenários estão registrados no [relatório de testes](TEST_REPORT.md).

A consulta de configuração não comprova que o provedor está acessível nem que o modelo está carregado. O endpoint e o identificador padrão são exemplos de configuração. O conteúdo enviado à IA inclui um recorte da conversa, das fontes e do mapa; um destino remoto recebe esse conteúdo. Limites e procedimentos estão em [AI_SETUP.md](AI_SETUP.md).

## Evidências automatizadas

A execução completa da versão 1.2.0 em 9 de outubro de 2026, Windows e Node.js, registrou **109 testes, 108 aprovados, 0 falhas e 1 ignorado**, incluindo o editor HTTP e o roteiro simplificado. IA tem **20 testes de facilitador, oito da API legada e 12 de configuração/transporte HTTP**, com respostas e provedor simulados, sem inferência de um modelo real. Contagens históricas e interações na UI estão no [relatório de testes](TEST_REPORT.md).

Os 12 testes HTTP também verificam que configurações e chaves sobrevivem a exportação, importação, snapshots, restauração e merge, com conflito explícito em credenciais divergentes. O HTML único atual contém oito módulos e corresponde às fontes.

Verificação do servidor estático nesta entrega: fluxo HTTP/HEAD, bloqueio de método não permitido, caminhos ocultos, traversal e endereço inválido passou no Windows com Node.js. O teste de symlink externo foi **ignorado** nesse ambiente por falta de permissão do Windows para criar o symlink. A CI contém o teste e poderá exercitá-lo onde a plataforma permitir.

A skill exige os cenários abaixo; esta tabela distingue testes controlados e navegador:

| Cenário | Evidência final |
|---|---|
| Primeiro repositório vazio | Aprovado no teste 01, adapter controlado |
| Alteração somente local | Aprovado no teste 02 |
| Alteração somente remota / fast-forward | Aprovado nos testes 03 e 04 |
| Dois autores, campos independentes | Aprovado no teste 05; ancestral comum |
| Dois autores, mesmo campo | Aprovado no teste 06; também exercitado na UI com pacote divergente, reload da sessão e resultado editado |
| Delete versus update | Aprovado no teste 07 |
| Adição concorrente / colisão de ID | Aprovado nos testes 08 e 09 |
| Alteração de ordem | Aprovado no teste 10 |
| Remoto muda durante publicação | Aprovado no teste 11, CAS controlado; re-resolução também testada |
| Falha offline preserva cópia local | Aprovado no teste 12; UI reabriu do cache com servidor parado, gerou propostas e as preservou após reload |
| Permissão revogada e recuperada | Aprovado no teste 13 com adapter controlado; API real de pasta não certificada |
| JSON remoto inválido / hash inválido | Aprovado no teste 14; pacote corrompido também recusado |
| Evolução de schema | Aprovado no teste 15 com formato sintético de referência 0.9; não representa uma release do Studio |
| Recuperação / restore | Aprovado no teste 16; restauração cria nova versão |
| Reinício com alterações não publicadas | Aprovado no teste 17 com LocalStore de teste; reload e retomada também exercitados na UI; encerramento real do browser não exercitado |
| Duas abas | Aprovado no teste 18 e em duas abas reais: o mesmo campo guardou as perspectivas de cada aba após reload; sincronização de pasta entre abas não exercitada |
| Pasta entre dispositivos / provider cloud | Não certificado |

Também passaram seis casos de pasta com filesystem simulado, conflito estrutural referencial, integração de pacote no mesmo projeto sem perder o rascunho, divergência importada, validação de sessões exportadas e resultado customizado inválido. Esses resultados não certificam a API de pasta real.

## Riscos concretos

- Limpeza dos dados do site, modo privado, perda do perfil ou quota podem remover/impedir persistência; exporte backups.
- Uma pasta sincronizada pode exibir arquivos fora de ordem. Sem confirmação segura, publicação permanece pendente; não declarar que uma versão foi compartilhada.
- Importação de projeto e importação de pacote de versões têm propósitos diferentes. Só o pacote leva a ancestralidade necessária à integração.
- Nenhuma conta, ACL ou criptografia própria é implementada. A origem do navegador e as permissões locais delimitam o acesso.
- Limites de contrato não demonstram desempenho com milhares de elementos.
