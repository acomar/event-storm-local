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
| API/Drive/GitHub remoto | Não implementado | Não implementado | Não implementado |

O adapter de memória é usado somente nos testes e na prova de semântica. O armazenamento de produção é o navegador. A publicação no GitHub do código-fonte é independente do versionamento de workshops.

A pasta mantém `manifests/`, `objects/` e `heads/` dentro de `.event-storm-local`. O motor não declara **Atualizado** global para esse adapter: após publicar, ainda é necessário verificar novas alterações, pois nenhuma leitura prova que outro dispositivo já recebeu todos os arquivos.

## Navegadores

| Ambiente | Edição/IndexedDB | Cache offline | Escolha de pasta | Handle/reautorização | Evidência |
|---|---|---|---|---|---|
| Navegador interno Chromium, Windows | Criação, facilitador, histórico, duas abas, canvas por teclado e integração de pacotes exercitados; abriu sem aviso de fallback | Exercitado com servidor local parado: reload, edição e retomada | Não exercitado | Não exercitado | [Relatório de interação na UI](TEST_REPORT.md) |
| Chrome Desktop instalado | Não exercitado | Não exercitado | Detectada por disponibilidade da API | Não exercitado | Sem certificação nesta entrega |
| Edge Desktop | Não exercitado | Não exercitado | Detectada por disponibilidade da API | Não exercitado | Sem certificação nesta entrega |
| Firefox Desktop | Não exercitado | Não exercitado | Pacote portátil quando API ausente | Não prometido | Sem certificação nesta entrega |
| Safari Desktop | Não exercitado | Não exercitado | Pacote portátil quando API ausente | Não prometido | Sem certificação nesta entrega |
| Viewport mobile no Chromium interno | Layout exercitado a 390 px; scrollWidth de 390 px | Não exercitado nesse viewport | Não exercitado | Não exercitado | Não certifica um aparelho ou browser mobile real |

Pasta requer contexto seguro e ação explícita do usuário. O browser pode negar a seleção, a escrita ou a persistência do handle. O aplicativo continua oferecendo edição local e exportação portátil. Nenhum provider de sincronização de arquivos foi certificado nesta entrega.

A recuperação distingue referência e permissão: uma pasta conhecida e autorizada é reutilizada; uma pasta conhecida sem permissão oferece **Permitir acesso** no mesmo handle; o seletor só é usado se a referência foi perdida ou ficou inutilizável. Esse protocolo foi exercitado com adapter controlado, não com autorização real de pasta no navegador.

O HTML único não precisa buscar JS/CSS/ícone externos e não registra service worker. O `standalone.html` foi aberto via HTTP, carregou o exemplo com 11 nós e nove relações e exibiu o Facilitador. Abrir em `file://` depende do suporte de armazenamento e das permissões da plataforma. O caso direto não foi exercitado porque a política da ferramenta de navegação deste ambiente aceita apenas HTTP/HTTPS; essa restrição não determina compatibilidade do arquivo no navegador do usuário.

## Evidências automatizadas

Execução auditada em 9 de outubro de 2026, Windows e Node.js: **58 testes, 57 aprovados, 0 falhas e 1 ignorado**. Quantidades por suíte e comandos efetivos estão no [relatório de testes](TEST_REPORT.md), que separa testes controlados e uso real da interface.

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
