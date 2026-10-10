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
| Entrevista de oito etapas | Roteiro numerado de oito perguntas com orientações; sem registro de respostas, progresso ou propostas na UI |
| Aceitar proposta como Pendente | Validação continua exclusivamente humana |
| Inspeção de pendências e relações ausentes | Inspeção heurística; não prova completude nem causalidade |
| Schema JSON 1.0 e integridade referencial | Compatibilidade de importação/exportação com validação |
| Versionamento inteiro no MongoDB | Histórico persistente com snapshots, pais e integridade |
| Autosave via API | Cópia de trabalho persistida no navegador |
| Conflito HTTP 409 + exportar/recarregar | Integração semântica e sessão de diferenças persistida |
| Banco MongoDB, FastAPI, Nginx, React/XYFlow | HTML/CSS/JavaScript + IndexedDB; servidor Node.js nativo opcional para arquivos e IA |

## Interface

O original possui canvas com cartões arrastáveis, pan/zoom, minimapa, snap, multisseleção, conexão por pontos, edição inline, filtros/lista, temas e atalhos. A interface nativa reproduz os fluxos centrais; interações não dependem de XYFlow e podem diferir em detalhes de gesto ou aparência.

Verificação inicial por interação na interface do navegador interno Chromium, Windows, em 9 de outubro de 2026, antes da adição de IA e das áreas de contexto:

| Fluxo | Evidência |
|---|---|
| Criar workshop com objetivo | Executado; projeto aberto no workspace |
| Entrevista determinística, primeira pergunta e avanço | Executado; resposta preservada e um candidato gerado |
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

Na ampliação, a UI foi exercitada com duas respostas de IA controladas: o mapa passou a oito elementos e cinco relações, quatro conexões por lados elevaram o total a nove e o reload retomou quatro mensagens. A área de contexto foi redimensionada por teclado e recuperada com a largura salva. Uma resposta inválida não alterou o mapa. Sem provedor de modelo disponível, o erro preservou os cartões e o rascunho. São provas da integração e da UI; não certificam inferência nem qualidade de um LLM real. Veja [TEST_REPORT.md](TEST_REPORT.md).

## Novidades locais

- Cópia de trabalho e histórico no dispositivo.
- Salvamento explícito de versões e restauração sem apagar versões anteriores.
- Diferenças por campos e IDs, com ancestral comum.
- Exportação/importação de pacote de versões além do projeto portátil.
- Blueprint Markdown com rastreabilidade, relatos e lacunas explícitas; ordem visual precisa de validação humana.
- Sinalização conservadora de negações, condições e dúvidas como regras/hotspots.
- Adapter de pasta experimental, com permissões recuperáveis e publicações preservadas.
- Arquivos estáticos preparados para cache offline após primeiro carregamento.
- Entrevista guiada como referência para iniciantes, sem chat ou formulário; dados de respostas anteriores preservados por compatibilidade.
- Facilitador com IA opcional, uma pergunta por vez, evidência literal e hipóteses visíveis; contrato e configuração em [AI_SETUP.md](AI_SETUP.md).
- Editor HTTP parametrizável com perfis, autenticação, teste e importação/exportação; configuração e credenciais persistidas no navegador, no projeto e nas versões.
- Áreas de contexto transparentes e redimensionáveis, atrás do mapa, com conexões pelos quatro lados dos cartões.

## Limites preservados e diferenças intencionais

O original não oferece LLM. Esta edição permite configurar um endpoint HTTP, incluindo Chat Completions e workflows personalizados, executado pela ponte opcional ou diretamente no navegador com CORS. Valida as sugestões antes de aplicá-las. Novos cartões são hipóteses; revisões e pedidos de exclusão ficam para decisão humana. O modelo não é instalado pelo aplicativo, e os testes do backend usam um provedor simulado. A conversa com um modelo real precisa ser verificada no ambiente escolhido.

Interpretação geral de documentos, análise de código, importação PDF/DOCX/XLSX, URLs, contas e colaboração em tempo real continuam ausentes. Aplicar as skills não demonstra compreensão completa do domínio.

A modalidade segue indicando intenção; todos os modos usam o mesmo grafo. A área de contexto local pode ser movida e redimensionada; sua fronteira visual não prova um bounded context validado. O Studio original não reproduz essa área. Heurísticas e modelos podem omitir fatos e interpretar mal negações. Nenhuma ordem de eventos deve ser inferida só pela ordem das linhas de texto.

Os limites de quantidade e tamanho do contrato são proteção de entrada; não são uma promessa de desempenho com milhares de cartões. O navegador pode aplicar quota e encerrar armazenamento. A API opcional encaminha inferência; não persiste projetos nem implementa autenticação multiusuário ou migração automática de esquema desconhecido.

O tipo `aggregate`, os campos opcionais `source_side`/`target_side` de relações e a configuração opcional `ai_http` são extensões locais. O Studio original só admite seus 11 tipos e campos estritos; a importação de volta falha se houver agregados em nós/propostas, lados locais em relações ou `ai_http`. A ida e volta exige não utilizar essas extensões. Não há conversão silenciosa de um agregado para nota ou contexto.
