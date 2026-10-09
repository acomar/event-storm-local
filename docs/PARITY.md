# Paridade com EventStorming Studio

Referência auditada: [acomar/eventstorm-studio na revisão 41fb8656](https://github.com/acomar/eventstorm-studio/tree/41fb8656d635da8e10e3dd8be00af4d2d6cc53ee), incluindo README, modelo de domínio, engine determinístico e componentes App/Canvas/Panels. A intenção é preservar os fluxos de descoberta com outra arquitetura. Não se trata de um build do frontend React original.

## Modelo e fluxo

| Capacidade do original | Event Storm Local |
|---|---|
| Projetos com nome, objetivo e modalidade | Mesmo contrato portátil; persistência no dispositivo |
| Exemplo de abertura de conta | Cenário fictício editável, identificado como exemplo |
| 11 tipos de elemento e relações de domínio | Tipos preservados; extensão local Agregado explicada abaixo |
| Estados de conhecimento, origem e evidência | Preservados no projeto e na importação/exportação |
| Texto/TXT/Markdown → propostas | Regras determinísticas no próprio navegador |
| Entrevista de oito etapas | Facilitador determinístico com respostas e fontes preservadas |
| Aceitar proposta como Pendente | Validação continua exclusivamente humana |
| Inspeção de pendências e relações ausentes | Inspeção heurística; não prova completude nem causalidade |
| Schema JSON 1.0 e integridade referencial | Compatibilidade de importação/exportação com validação |
| Versionamento inteiro no MongoDB | Histórico persistente com snapshots, pais e integridade |
| Autosave via API | Cópia de trabalho persistida no navegador |
| Conflito HTTP 409 + exportar/recarregar | Integração semântica e sessão de diferenças persistida |
| Banco MongoDB, FastAPI, Nginx, React/XYFlow | HTML/CSS/JavaScript + IndexedDB; servidor estático opcional |

## Interface

O original possui canvas com cartões arrastáveis, pan/zoom, minimapa, snap, multisseleção, conexão por pontos, edição inline, filtros/lista, temas e atalhos. A interface nativa reproduz os fluxos centrais; interações não dependem de XYFlow e podem diferir em detalhes de gesto ou aparência.

Verificação por interação na interface do navegador interno Chromium, Windows, em 9 de outubro de 2026:

| Fluxo | Evidência |
|---|---|
| Criar workshop com objetivo | Executado; projeto aberto no workspace |
| Facilitador, primeira pergunta e avanço | Executado; resposta preservada e um candidato gerado |
| Aceitar candidato | Executado; cartão entrou como Pendente |
| Editar descrição e marcar Validado | Executado; estado e descrição preservados ao retomar |
| Criar e renomear Comando | Executado |
| Salvar versão e consultar Histórico | Executado; versão listada |
| Recarregar e retomar projeto | Executado; dashboard mostrou os dois elementos e a entrevista retomou na etapa seguinte |
| Rascunhos independentes em duas abas | Executado; descrições diferentes do mesmo Comando persistiram e retomaram após reload de cada aba |
| Arraste, pan/zoom, minimapa e snap | Implementados; não exercitados nessa verificação |
| Conexões e edição de relação | Executado pelo teclado nos dois pontos de conexão; relação alterada para Dispara |
| Desfazer/refazer, multisseleção, duplicação e exclusão | Executado; seleção Shift de dois elementos, duplicação para quatro e exclusão de volta a dois |
| Exportar backup e integrar pacote do mesmo projeto | Executado; arquivo com seis objetos, diferenças detectadas e decisão editada preservando as duas perspectivas |
| Retomar resolução após reload | Executado; sessão de diferenças preservada e vínculo remoto incorporado na integração local |
| Tema escuro e viewport mobile | Capturas reais; viewport de 390 px sem rolagem horizontal |
| HTML único | Executado via HTTP; exemplo com 11 nós, nove relações e Facilitador |
| Reabrir e trabalhar sem servidor disponível | Executado; shell recuperado do cache, extração com evento e hotspot e propostas preservadas após reload |

O armazenamento principal abriu sem aviso de fallback nesse ambiente. Isso não prova retenção indefinida do perfil nem compatibilidade de outras plataformas. Resultados e roteiro de reprodução ficam em [TEST_REPORT.md](TEST_REPORT.md).

O acesso direto por `file://` não foi exercitado: a ferramenta de navegação desse ambiente permite apenas HTTP/HTTPS. Pasta real, sincronização entre computadores e todos os gestos de canvas também não foram certificados.

## Novidades locais

- Cópia de trabalho e histórico no dispositivo.
- Salvamento explícito de versões e restauração sem apagar versões anteriores.
- Diferenças por campos e IDs, com ancestral comum.
- Exportação/importação de pacote de versões além do projeto portátil.
- Blueprint Markdown com rastreabilidade, relatos e lacunas explícitas; ordem visual precisa de validação humana.
- Sinalização conservadora de negações, condições e dúvidas como regras/hotspots.
- Adapter de pasta experimental, com permissões recuperáveis e publicações preservadas.
- Arquivos estáticos preparados para cache offline após primeiro carregamento.

## Limites preservados e diferenças intencionais

O original não oferece LLM, interpretação geral de documentos, análise de código, PDF/DOCX/XLSX, URLs, contas, colaboração em tempo real, relatório avançado ou organização automática. Esta edição também não passa a oferecer essas capacidades apenas por aplicar as skills.

A modalidade segue indicando intenção; todos os modos usam o mesmo grafo. Contexto textual/cartão não equivale a uma área delimitada. A heurística pode omitir fatos e interpretar mal negações. Nenhuma ordem de eventos deve ser inferida só pela ordem das linhas de texto.

Os limites de quantidade e tamanho do contrato são proteção de entrada; não são uma promessa de desempenho com milhares de cartões. O navegador pode aplicar quota e encerrar armazenamento. Não há API de dados, autenticação multiusuário ou migração automática de esquema desconhecido.

O tipo `aggregate` é uma extensão local dentro da estrutura do grafo. O Studio original só admite seus 11 tipos; a importação de volta falha se houver agregados em nós ou propostas. Sem essa extensão, a estrutura portátil mantém os tipos originais. Não há conversão silenciosa de um agregado para nota ou contexto.
