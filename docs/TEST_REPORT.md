# Relatório de testes

Data: **9 de outubro de 2026**. Ambiente: Windows, Node.js **22.18.0** e navegador interno Chromium do Codex. Os resultados abaixo distinguem funções/adapters controlados, servidor HTTP e interação na interface. A workflow GitHub Actions está configurada; um resultado remoto de CI não foi usado como evidência nesta entrega.

Execução completa inicial de `npm test`, antes das ampliações de IA e contexto: **58 testes, 57 aprovados, 0 falhas e 1 ignorado**. Essa contagem registra a versão inicial, não a suíte atual ampliada.

## Execução atual: versão 1.2.0 e editor HTTP

`npm run standalone` e `npm test` registraram **109 testes, 108 aprovados, 0 falhas e 1 ignorado**, incluindo o roteiro simplificado, os oito módulos do HTML único e 12 testes novos em `tests/http-request.test.mjs`. O ignorado continua sendo o symlink externo no Windows. As contagens 58/97 abaixo são registros históricos.

Os casos HTTP cobrem substituição de mensagens/esquema com tipos JSON, strings Unicode, query e formulário codificados, Bearer/Basic/chave em cabeçalho, campos inválidos, CRLF, expressões proibidas, leitura da resposta, configuração com credenciais portátil, snapshots/restauração/diff/merge, limites em bytes, erros não 2xx, timeout/cancelamento e encaminhamento nativo a um provedor simulado. A ponte foi exercitada inclusive com configuração legada inválida, demonstrando independência das variáveis de ambiente. Origem externa, redirects e método inválido são recusados.

UI real em uma origem isolada, sem alterar o projeto principal do usuário:

| Verificação | Resultado observado |
|---|---|
| Perfil configurado pela interface | Nome, URL completa, variáveis `model`/`apiKey` e autenticação Bearer salvos |
| Teste pela ponte local | HTTP 200, corpo/cabeçalhos disponíveis e contrato do facilitador reconhecido; mapa vazio preservado |
| Tipos enviados | `messages` chegou como lista, `temperature` como número e autenticação foi aceita pelo provedor controlado |
| Exportar configuração | JSON `event-storm-local-http`, um perfil e chave fictícia preservada no arquivo |
| Importar configuração | O arquivo exportado repôs perfil, URL, variáveis, Bearer e transporte; salvar e testar retornou HTTP 200 |
| Conversar com perfil ativo | Dois eventos como hipóteses e uma relação adicionados, com evidência e pergunta do facilitador |
| Reload e retomada | Dois elementos e uma relação preservados; perfil, URL e variáveis recuperados |
| Executar direto no navegador | HTTP 200 e contrato reconhecido com CORS do endpoint controlado; mapa permaneceu com dois elementos e uma relação |

[Captura do editor HTTP](assets/configuracao-http.jpg). Endpoint, modelo e chave da captura são fictícios. O servidor de teste foi temporário; não foi instalado um LLM nem verificada a qualidade de inferência real. O acesso direto por `file://` continua sem evidência neste ambiente.

## Execução completa da versão 1.1.0

Após a ampliação e a revisão de Unicode, a execução final de `npm run standalone` seguida de `npm test` registrou **97 testes, 96 aprovados, 0 falhas e 1 ignorado** no mesmo ambiente Windows/Node.js 22.18.0. O HTML único foi regenerado antes dessa execução.

| Suíte | Resultado registrado | Escopo |
|---|---|---|
| `tests/ai-facilitator.test.mjs` | 20 aprovados | Contexto e contrato de conversa, evidência literal, hipóteses, revisão de elementos existentes, layout, Unicode, preservação e retomada de turnos |
| `tests/ai-server.test.mjs` | 8 aprovados | API local, configuração, encaminhamento, proteção de chave, origem, limites, erros, timeout, cancelamento e concorrência |
| `tests/canvas.test.mjs` | 13 aprovados | Seleção, quadro somente leitura, áreas de contexto, dimensões e geometria dos quatro lados de conexão |
| `tests/domain.test.mjs` | 16 aprovados | Contrato, referências, importação, extração, entrevista, blueprint e extensões locais |
| `tests/serve.test.mjs` | 1 aprovado, 1 ignorado | Servidor estático e proteção de caminhos; symlink ignorado no Windows |
| `tests/standalone.test.mjs` | 3 aprovados | Bundle corresponde às fontes, isolamento e recusa de formas não suportadas |
| `tests/static-app.test.mjs` | 2 aprovados | Recursos locais, sintaxe e precache |
| `tests/version-control.test.mjs` | 33 aprovados | Histórico, sessões, merge, integridade, pacotes e filesystem controlado |

Os testes de IA usam respostas e transporte controlados. Essa suíte demonstra o contrato e a preservação dos dados, sem certificar inferência ou qualidade de um modelo real.

## Alteração posterior: Entrevista guiada como roteiro

A Entrevista guiada passa a ser uma lista numerada de oito perguntas com orientações para iniciantes, sem chat, formulário, registro de respostas, progresso ou geração de propostas. A conversa do Facilitador com IA e a extração determinística de texto continuam disponíveis. Dados históricos de respostas são preservados; as funções legadas permanecem no core apenas por compatibilidade.

O QA da alteração foi concluído pela interface real em `http://127.0.0.1:8080`:

| Verificação | Resultado observado |
|---|---|
| Roteiro para iniciantes | Oito perguntas na ordem e oito orientações exibidas |
| Painel de Entrevista guiada | Nenhum input, textarea, select ou formulário; nenhum chat ou conversa |
| Alternar entre roteiro e Facilitador com IA | Mapa permaneceu com dois elementos e uma relação |
| Facilitador com IA | Conversa com role log e formulário de mensagem preservados; botão Roteiro de perguntas abriu a lista |

Captura do roteiro no tema atual do usuário: [Entrevista guiada](assets/entrevista-guiada.jpg).

Naquela alteração, o HTML único de sete módulos foi regenerado com `npm run standalone` e os testes focados registraram **5 aprovados, 0 falhas**. A suíte completa não foi repetida naquele momento; posteriormente a versão 1.2.0 foi verificada integralmente conforme o registro acima. Os resultados históricos abaixo descrevem a interface de entrevista existente naquela execução e não afirmam que o roteiro atual registra respostas.

## Execução automatizada inicial

| Suíte | Resultado registrado | Escopo |
|---|---|---|
| `tests/domain.test.mjs` | 14 aprovados | Contrato original, invariantes, referências, importação, extração, entrevista e blueprint |
| `tests/version-control.test.mjs` | 33 aprovados | 18 cenários obrigatórios, nova mudança durante resolução, pacotes, integridade estrutural, pasta controlada e propriedades de negócio preservadas |
| `tests/serve.test.mjs` | 1 aprovado, 1 ignorado | HTTP/HEAD, MIME, métodos, caminhos ocultos, traversal e endereço inválido |
| `tests/static-app.test.mjs` | 2 aprovados | Recursos e imports locais, sintaxe dos módulos e completude do precache do service worker |
| `tests/standalone.test.mjs` | 3 aprovados | HTML gerado idêntico às fontes, ausência de assets externos, funções do bundle isolado e recusa de imports/ciclos/exports não suportados |
| `tests/canvas.test.mjs` | 4 aprovados | Seleção Shift, arraste coletivo, filtro na seleção retangular e inspeção sem alteração em quadro somente leitura |

O teste de symlink externo foi ignorado porque o Windows não permitiu criar o link de teste sem privilégios adicionais. A proteção existe no servidor; esse caso não foi exercitado nessa plataforma. O teste permanece na suíte para ambientes onde a criação de symlink é permitida.

Comando da execução completa registrada:

```sh
npm test
```

A suíte completa é reproduzível com `npm test`. O teste HTTP precisa de acesso ao loopback; neste ambiente o sandbox bloqueou a primeira tentativa, e a execução autorizada fora dessa restrição passou. Os testes não apagam projetos do navegador.

O gerador e a suíte de standalone foram executados com `npm run standalone` e `node --test tests/standalone.test.mjs`. O teste do bundle executa contrato do domínio, extração, salvamento de versões, histórico e restauração em um contexto JavaScript isolado. Essa prova não equivale a abrir `file://` num navegador real.

## O que o motor demonstrou

- Primeiro repositório vazio; edição somente local; avanço por mudança remota.
- Integração de campos independentes pelo ancestral comum e decisão quando o mesmo campo diverge.
- Preservação em remoção versus edição, adições concorrentes, colisão de ID e mudança incompatível de ordem.
- Nova mudança remota durante publicação ou resolução, sem substituir um ramo silenciosamente.
- Preservação local em falha offline, perda de permissão e dados inválidos/corrompidos.
- Histórico íntegro; restauração cria nova versão; recuperação de rascunho e sessão de diferenças.
- Sessões locais independentes para representar duas abas.
- Pacote de histórico íntegro e recusa de corrupção antes de alterar o estado.
- Importação de pacote no mesmo projeto preserva o rascunho, mantém os ramos locais e integra ou pede decisão; sessões exportadas são revalidadas e caminhos de resolução falsos recusados.
- Resultado editado inválido não marca a diferença como resolvida nem altera a sessão.
- Adapter de pasta com filesystem simulado: publicações append-only, concorrência, diferenças, reautorização do handle conhecido, escrita interrompida e identidades incompatíveis de manifestos.
- Migração determinística de formato sintético de referência 0.9; isso não representa compatibilidade com uma release Studio 0.9.

Permissão, interrupção, concorrência e duas abas nesse conjunto são cenários controlados. Eles verificam a semântica do motor e não certificam comportamento de filesystem cloud ou APIs de browser.

## Verificação inicial na interface real

A aplicação foi aberta em uma origem local no navegador interno Chromium. Verificações realizadas por interação na UI:

| Ação | Resultado observado |
|---|---|
| Criar projeto com nome e objetivo | Workspace aberto com os metadados fornecidos |
| Responder a primeira pergunta do Facilitador | Resposta preservada, um candidato gerado e próxima pergunta disponível |
| Aceitar candidato | Cartão inserido como Pendente |
| Editar descrição e marcar Validado | Descrição e estado exibidos no cartão/painel |
| Criar um Comando e editar seu nome | Segundo elemento presente no projeto |
| Salvar versão e abrir Histórico | Versão registrada e visível |
| Recarregar a página e retomar o projeto | Dashboard indicou dois elementos; nome, estado Validado e descrição preservados |
| Retomar Facilitador | Pergunta seguinte disponível e resposta anterior Pedido Recebido preservada |
| Duas abas, mesmo projeto e mesmo campo | Cada aba preservou sua própria descrição do Comando após reload: "Perspectiva da primeira aba." e "Perspectiva independente da segunda aba." |
| Conectar pelo teclado e editar a relação | Enter nos dois pontos de conexão criou o vínculo; relação alterada para Dispara (`triggers`) |
| Desfazer/refazer e seleção Shift | Operações retomadas; dois cartões ficaram selecionados |
| Duplicar e excluir seleção | Dois cartões passaram a quatro; excluir a seleção voltou o mapa a dois |
| Exportar backup | Download concluído; pacote `event-storm-local-bundle` válido com seis objetos |
| Importar o backup da aba A na aba B | Uma diferença de descrição detectada com as duas perspectivas preservadas |
| Recarregar durante resolução | Sessão preservada e interface de diferenças disponível ao retomar |
| Editar o resultado da diferença | `Descrição combinada com as duas perspectivas.` aplicada; vínculo remoto incorporado na integração local |
| Abrir `standalone.html` por HTTP | Exemplo fictício com 11 nós e nove relações carregado; Facilitador disponível |
| Tema escuro e viewport de 390 px | Capturas salvas; largura de conteúdo 390 px, sem transbordamento horizontal |
| Recarregar com servidor Node parado | Aplicação principal reabriu pelo cache, mantendo acesso ao projeto |
| Extrair conteúdo sem servidor disponível | `O pedido foi recebido. O pagamento não foi aprovado.` produziu dois candidatos: evento e hotspot |
| Recarregar e retomar após extração offline | As duas propostas continuaram preservadas |

O armazenamento principal abriu sem aviso de fallback. Não foi necessária leitura direta da base para essa verificação: persistência foi observada pela retomada pela interface. Reload não equivale a encerrar/reabrir o processo do navegador nem prova retenção indefinida dos dados.

O teste offline real interrompeu o servidor local e recarregou a aplicação já instalada no cache; não exigiu uma API de dados. Isso demonstra recuperação do shell e edição no ambiente exercitado, sem certificar retenção indefinida do cache ou inicialização num perfil novo sem primeiro carregamento.

Não foram exercitados: escolha/reautorização real de pasta, sincronização entre computadores, providers cloud, drag/pan/zoom/minimapa/snap completos, todos os atalhos e aparelhos mobile reais. A exportação/importação de JSON simples e o download de blueprint não foram verificados pela UI; o pacote com histórico foi. Esses itens permanecem separados dos resultados positivos, mesmo quando existe implementação ou teste controlado.

A navegação direta para `file://` foi bloqueada pela política da ferramenta, que só permite HTTP/HTTPS. O HTML único foi verificado via HTTP e por testes de bundle; o teste em arquivo local não foi executado e não fornece evidência de compatibilidade ou falha do aplicativo nesse modo.

Capturas da versão inicial exercitada: [desktop](assets/facilitador-desktop.jpg), [tema escuro](assets/facilitador-dark.jpg) e [viewport mobile](assets/facilitador-mobile.jpg).

## Ampliação: IA, contexto e lados de conexão

A integração HTTP foi executada com `node --test tests/ai-server.test.mjs tests/serve.test.mjs`: **10 testes, 9 aprovados, 0 falhas e 1 ignorado**. Os oito testes de IA usam um provedor HTTP local controlado e verificam configuração por ambiente, encaminhamento, proteção da chave, Origin/Host, limites de entrada/resposta, erros, redirecionamentos, timeout, cancelamento e limite de quatro inferências simultâneas. Configuração inválida não impede o mapa estático. O ignorado é o caso de symlink do servidor no Windows.

A interface real foi exercitada em duas condições distintas no mesmo navegador Chromium: a configuração padrão sem servidor de modelo disponível, e uma origem isolada ligada a respostas controladas. A segunda verifica o transporte, a validação e as mudanças na UI; não é inferência de um LLM real.

| Cenário | Resultado observado |
|---|---|
| Consultar a configuração padrão em `127.0.0.1:8080` | Modelo de referência `llama3.1:8b` exibido; botão Atualizar configuração consulta metadados e não afirma disponibilidade |
| Enviar mensagem sem provedor disponível | Erro de conexão exibido; mapa com dois cartões e uma relação preservado |
| Recarregar após esse erro | Rascunho da mensagem retomado ao reabrir o projeto; mapa inalterado; recuperação local de rascunho até 30 mil caracteres e isolamento por aba |
| Primeiro turno com resposta controlada em origem isolada | Seis elementos e quatro relações no mapa; ator em y=-220, comando em y=-40 e eventos em y=140, x=80/340/600 |
| Segundo turno com resposta controlada | Oito elementos e cinco relações; conversa preservada |
| Conectar pelos quatro lados via teclado | Quatro vínculos adicionais criados por top/right/bottom/left; total de nove relações |
| Área de contexto e redimensionamento por teclado | Borda pontilhada, fundo transparente e área atrás de relações/cartões; ArrowRight mudou largura de 2122 para 2142 mantendo x=44 e y=76 |
| Recarregar o projeto controlado | Quatro mensagens da conversa, nove relações e largura 2142 recuperadas |
| Resposta controlada com JSON inválido | Resposta recusada; mapa permaneceu com oito elementos e nove relações; rascunho preservado |
| Novo projeto para validar layout e área de contexto | Envelope Pedidos pontilhado atrás dos cartões; clique no cartão interno selecionou o cartão |
| Mover o contexto pelo teclado | ArrowRight deslocou 20 px e ArrowLeft retornou; dimensão 802×606 preservada |
| Revisar uma alteração de comando validado | Resposta controlada propôs Solicitar Pedido sem modificar Enviar Pedido nem sua descrição manual; uma proposta explícita ficou pendente |
| Aceitar essa revisão humana | Mesmo UUID, posição (80,-40) e quatro vínculos preservados; seis elementos, duas evidências no cartão revisado e estado Pendente |

Captura da ampliação: [Facilitador com IA e mapa de pedidos](assets/facilitador-ia-integracao.jpg). A imagem usa respostas controladas de integração; não representa inferência de um modelo real. As dimensões de contexto acima pertencem a projetos de QA distintos: o teste anterior exercitou redimensionamento, e o novo projeto exercitou movimento sem mudança de tamanho.

Nenhum serviço Ollama/LM Studio ou modelo real foi detectado nesta verificação. Não há evidência de qualidade semântica, cumprimento do prompt por um LLM ou suporte de um provedor remoto. A instalação e a seleção do modelo continuam sendo configuração do ambiente, conforme [AI_SETUP.md](AI_SETUP.md).

## Roteiro de reprodução pela interface

1. Inicie o servidor com `npm start` e abra `http://127.0.0.1:8080` em uma janela normal, mantendo a mesma origem durante o teste.
2. Clique **Começar do zero**, dê um nome e objetivo ao workshop e confirme a criação.
3. Abra **Entrevista guiada** e confira as oito perguntas numeradas com orientações. O painel serve como referência, sem campo de resposta ou progresso.
4. Abra **Importar conteúdo**, extraia `O pedido foi recebido.` e depois abra **Revisar descobertas**, confira o trecho de origem e aceite a proposta. O cartão deve entrar como **Pendente**.
5. Selecione o cartão, preencha uma descrição e marque **Validado** apenas por essa ação explícita.
6. Adicione um **Comando**, renomeie-o e aguarde a indicação de salvamento local.
7. Abra **Histórico**, descreva um marco e use **Salvar versão**. Confira a entrada da versão.
8. Recarregue a página, abra o mesmo projeto no dashboard e verifique ambos os elementos, a descrição e o estado.
9. Retome **Entrevista guiada** e confira o roteiro completo; abrir esse painel não deve registrar fontes, respostas ou propostas.
10. Abra o mesmo projeto em outra aba da mesma origem. Na descrição do Comando, registre perspectivas diferentes em cada aba e espere salvar. Recarregue cada aba e confira que cada rascunho retoma a sua própria descrição.
11. Nos pontos de conexão dos cartões, use Enter para iniciar e concluir uma relação. Edite o vínculo para **Dispara** e confira o resultado ao desfazer/refazer.
12. Use Shift para selecionar dois elementos, duplique a seleção e exclua os duplicados; confira a contagem antes/depois.
13. Na aba A, exporte o backup com histórico. Na aba B do mesmo projeto, importe o pacote, confira a diferença de descrição e recarregue antes de resolver para verificar a retomada.
14. Edite o resultado da diferença, conclua as escolhas e confira a descrição integrada e a relação recebida. Isso é integração local de pacote, sem afirmar publicação em pasta.
15. Abra `http://127.0.0.1:8080/standalone.html`, carregue o exemplo e confira os 11 elementos, nove relações e o Facilitador.
16. Troque o tema e inspecione o layout num viewport de 390 px. Esse teste de viewport não representa um aparelho mobile real.
17. Depois do primeiro carregamento completo de `index.html`, pare o servidor local e recarregue essa página na mesma origem. Extraia o texto usado no teste offline, confira evento e hotspot e recarregue novamente para verificar as propostas preservadas.

Os passos são um roteiro manual reproduzível, não uma suíte E2E automatizada nem uma alegação de execução de cenários adicionais.

Para repetir o caminho de IA, configure um provedor conforme [AI_SETUP.md](AI_SETUP.md), abra **Facilitador com IA** e envie uma descrição curta do domínio. Confira que candidatos novos são hipóteses, que as evidências apontam para conteúdo literal da conversa e que mudanças de conhecimento existente pedem revisão. Recarregue para conferir a conversa e o mapa. Sem provedor disponível, envie uma mensagem e confira o erro e a preservação do rascunho. Esses passos descrevem como reproduzir; não certificam um modelo que não foi executado nesta entrega.
