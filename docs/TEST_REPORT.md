# Relatório de testes

Data: **9 de outubro de 2026**. Ambiente: Windows, Node.js **22.18.0** e navegador interno Chromium do Codex. Os resultados abaixo distinguem funções/adapters controlados, servidor HTTP e interação na interface. A workflow GitHub Actions está configurada; um resultado remoto de CI não foi usado como evidência nesta entrega.

Execução completa de `npm test`: **58 testes, 57 aprovados, 0 falhas e 1 ignorado**.

## Execuções automatizadas

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

## Verificação na interface real

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

Capturas do ambiente exercitado: [desktop](assets/facilitador-desktop.jpg), [tema escuro](assets/facilitador-dark.jpg) e [viewport mobile](assets/facilitador-mobile.jpg).

## Roteiro de reprodução pela interface

1. Inicie o servidor com `npm start` e abra `http://127.0.0.1:8080` em uma janela normal, mantendo a mesma origem durante o teste.
2. Clique **Começar do zero**, dê um nome e objetivo ao workshop e confirme a criação.
3. Abra **Facilitador**. Responda a primeira pergunta com `Pedido Recebido` e registre a resposta.
4. Abra **Descobertas**, confira o trecho de origem e aceite a proposta. O cartão deve entrar como **Pendente**.
5. Selecione o cartão, preencha uma descrição e marque **Validado** apenas por essa ação explícita.
6. Adicione um **Comando**, renomeie-o e aguarde a indicação de salvamento local.
7. Abra **Histórico**, descreva um marco e use **Salvar versão**. Confira a entrada da versão.
8. Recarregue a página, abra o mesmo projeto no dashboard e verifique ambos os elementos, a descrição e o estado.
9. Retome **Facilitador** e confira a resposta preservada e a próxima pergunta.
10. Abra o mesmo projeto em outra aba da mesma origem. Na descrição do Comando, registre perspectivas diferentes em cada aba e espere salvar. Recarregue cada aba e confira que cada rascunho retoma a sua própria descrição.
11. Nos pontos de conexão dos cartões, use Enter para iniciar e concluir uma relação. Edite o vínculo para **Dispara** e confira o resultado ao desfazer/refazer.
12. Use Shift para selecionar dois elementos, duplique a seleção e exclua os duplicados; confira a contagem antes/depois.
13. Na aba A, exporte o backup com histórico. Na aba B do mesmo projeto, importe o pacote, confira a diferença de descrição e recarregue antes de resolver para verificar a retomada.
14. Edite o resultado da diferença, conclua as escolhas e confira a descrição integrada e a relação recebida. Isso é integração local de pacote, sem afirmar publicação em pasta.
15. Abra `http://127.0.0.1:8080/standalone.html`, carregue o exemplo e confira os 11 elementos, nove relações e o Facilitador.
16. Troque o tema e inspecione o layout num viewport de 390 px. Esse teste de viewport não representa um aparelho mobile real.
17. Depois do primeiro carregamento completo de `index.html`, pare o servidor local e recarregue essa página na mesma origem. Extraia o texto usado no teste offline, confira evento e hotspot e recarregue novamente para verificar as propostas preservadas.

Os passos são um roteiro manual reproduzível, não uma suíte E2E automatizada nem uma alegação de execução de cenários adicionais.
