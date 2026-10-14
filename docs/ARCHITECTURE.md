# Arquitetura

## Decisão principal

Aplicação estática e modular, sem build e sem dependências de pacotes externas. HTML e CSS compõem a interface; módulos JavaScript nativos implementam domínio, facilitação e versionamento. IndexedDB substitui o MongoDB do Studio original. Um servidor Node.js opcional entrega arquivos e encaminha pedidos de IA ao modelo configurado, sem persistir dados de workshop. Edição, roteiro de perguntas, extração determinística e histórico não dependem desse modelo.

Há duas formas de distribuição das mesmas fontes: `index.html` usa módulos locais servidos por HTTP/HTTPS; `standalone.html` leva o código, CSS e ícone dentro de um único arquivo. O segundo é gerado com um compilador nativo limitado ao grafo de oito módulos auditados, sem pacotes. O compilador aceita imports nomeados estáticos, exports nomeados de const/função/classe, verifica símbolos e ordena dependências. Imports externos, ciclos e formas não suportadas são rejeitados; cada fonte e o bundle passam pela verificação sintática nativa do Node.js.

Cada módulo compilado mantém seu escopo numa closure, evitando colisões de nomes. O script final é colocado depois do DOM inicial e desativa o registro de service worker no modo standalone. O HTML único pronto é versionado, e o teste verifica correspondência exata com as fontes para evitar publicação desatualizada. A persistência de origens `file://` continua dependendo do navegador; isso não é garantido pelo empacotamento.

Esta edição é derivada do [Studio na revisão 41fb8656](https://github.com/acomar/eventstorm-studio/tree/41fb8656d635da8e10e3dd8be00af4d2d6cc53ee) e aplica as orientações do [SkillForge na revisão 1f2a421a](https://github.com/acomar/skillforge/tree/1f2a421aadf17aadb82d31aaa91ecc98ed3c28e9). A proveniência e o alcance das skills estão em [SKILLFORGE.md](SKILLFORGE.md).

## Camadas

```text
Interface HTML / CSS / DOM
  ├── Contrato do domínio: validação e identidade
  ├── Facilitador determinístico: fontes → propostas → revisão humana → grafo
  ├── Facilitador IA: contexto → perfil HTTP → ponte local ou navegador → endpoint
  │     └── resposta validada → hipóteses / propostas de alteração → grafo
  └── VersionEngine
        ├── LocalStore: cópia de trabalho, sessão e objetos
        ├── Diff / merge semântico: Base + Local + Compartilhado
        └── RepositoryAdapter
              ├── memória: prova determinística e testes
              └── pasta: objetos e anúncios imutáveis, experimental
```

A camada de domínio não conhece DOM, IndexedDB ou filesystem. Os facilitadores produzem candidatos; não confirmam conhecimento automaticamente. `ai-facilitator.js` monta o contexto limitado, valida a resposta estruturada e aplica a transação ao projeto. `http-request.js` normaliza perfis, interpola variáveis declarativas sem eval, executa HTTP e extrai o campo da resposta; é compartilhado pelo navegador e pelo servidor. `scripts/serve.mjs` oferece transporte opcional sem persistir requisições ou workshops. O motor de versão recebe e valida snapshots estruturados; o adapter define acesso, integridade e publicação. Nenhuma camada executa conteúdo importado como código.

## Modelo portátil

O contrato de projeto continua em `schema_version: "1.0"`: metadados e um grafo com `nodes`, `edges`, `sources`, `evidences`, `proposals`, `answers` e `viewport`. Nós e fontes mantêm IDs estáveis. Relações referem IDs de nós; evidências referem fontes; respostas referem fontes. O importador rejeita IDs duplicados, referências ausentes, versões desconhecidas, coordenadas não finitas e entradas acima dos limites.

A extensão local opcional `primary_map: {id, name}` identifica o grafo principal, e `maps: [{id, name, modality, graph}]` preserva os mapas adicionais. `graph` e `modality` no projeto continuam sendo os dados do principal; nenhum grafo é duplicado entre containers. Sem a extensão, o principal tem ID lógico `main` e nome **Mapa principal**. Excluir o principal promove o primeiro mapa adicional preservando seu ID. A validação confere referências dentro de cada grafo: IDs de cards podem se repetir entre mapas, mas uma relação ou evidência não atravessa mapas.

O seletor ativo e os rascunhos do facilitador ficam em registros de sessão separados por projeto e mapa. O histórico, o JSON e o pacote de versões representam o projeto completo. A UI usa `mapProject` para fornecer somente o mapa ativo ao facilitador e aplica o resultado de volta a esse mapa. A configuração HTTP permanece no projeto. Viewports dos mapas adicionais recebem o mesmo tratamento de preferência local do grafo principal. Conflitos de referência ficam no grafo afetado; promoção do principal concorrente com edição da coleção exige escolher uma coleção inteira e válida.

Estados do conhecimento continuam separados das decisões sobre propostas. Uma proposta gerada é uma hipótese; aceitar registra `pending`. `validated` depende de ação humana. Novos cartões criados pela conversa com IA têm origem `ai` e estado `hypothesis` ou `contested`; revisões do mapa existente exigem decisão humana. A origem `code` é preservada na importação, sem importador de código nesta edição.

Importar um projeto para o dashboard cria outra identidade de projeto. Importar um pacote de versões é uma operação distinta: precisa preservar a identidade do repositório e seu histórico para permitir integração segura.

Na sessão nova, a importação do pacote restaura histórico e cópia de trabalho. Na sessão existente do mesmo projeto, salva o rascunho como versão antes de integrar a ponta recebida. Os ramos permanecem no DAG e a integração usa ancestral comum; divergências geram sessão de diferenças. Repositório diferente, histórico sem origem comum e sessão local de diferenças ainda pendente não permitem substituir o estado silenciosamente. Um pacote que já contém diferenças pendentes só pode ser recuperado numa sessão nova; o motor recalcula e valida a sessão e suas escolhas antes de aceitá-la.

O tipo local `aggregate` amplia os 11 tipos do Studio. Relações também podem ter `source_side` e `target_side` com os valores `top`, `right`, `bottom` ou `left`. O validador original rejeita esse tipo e esses campos locais; a ida e volta exige não utilizá-los. Essa limitação da extensão é explícita e não autoriza converter agregados silenciosamente para outro conceito.

Cartões `context` são áreas delimitadas, transparentes e redimensionáveis, desenhadas atrás dos cartões. Suas dimensões ficam em propriedades do nó. A área organiza a conversa visualmente; estar dentro dela não comprova um bounded context nem atribui ownership. O nome de contexto de cada elemento continua sendo conhecimento explícito do domínio.

Todos os outros cards também preservam dimensões opcionais em `properties.width` e `properties.height`. Sem dimensões explícitas, continuam com 210 × 146 pixels. O cálculo dos limites do nó alimenta conexões, seleção, minimapa, ajuste do viewport e inferência das áreas de contexto. A descrição é exibida como texto escapado no card, com rolagem para conteúdo longo. O foco explícito no clique evita que Delete continue preso ao campo de edição anterior.

A extensão opcional `ai_http` contém `active_id` e até 20 perfis identificados por ID estável. Preserva URL, método, transporte, timeout, linhas de parâmetros/cabeçalhos/variáveis, autenticação, corpo e caminho de resposta. Credenciais são parte explícita do projeto e acompanham exportação, snapshots, restauração e merge. Mudanças independentes se integram por campos; uma credencial alterada de duas formas gera conflito. O Studio estrito não aceita essa extensão; projetos antigos mantêm sua estrutura sem `ai_http` até salvar a configuração. Rascunhos do editor ficam separados do perfil ativo até **Salvar e usar**.

## Facilitação e evidência

Texto importado e turnos da conversa com IA são preservados como fontes. A extração lexical aponta candidatos para trechos dessas fontes e explica seu reconhecimento determinístico. O vocabulário lexical é limitado e pode produzir falsos positivos; negação, contexto e causalidade precisam de revisão. Uma resposta anterior é preservada quando o especialista registra outra perspectiva.

O reconhecimento sinaliza negação/condição/dúvida como hotspot ou regra em vez de promover automaticamente uma ocorrência positiva. Isso reduz um falso positivo conhecido do original, sem constituir compreensão semântica geral.

A Entrevista guiada apresenta as oito perguntas do Studio em uma lista numerada com orientações para iniciantes. É um roteiro de consulta, sem formulário, respostas persistidas, progresso ou criação de propostas. Respostas históricas permanecem no contrato e nos projetos; `answerQuestion` e as funções legadas continuam no core para compatibilidade, sem fluxo de gravação pela UI do roteiro.

O facilitador com IA recebe objetivo, modalidade e um recorte limitado do mapa, das fontes e da conversa. Seu contrato exige resposta, resumo, uma pergunta por vez, candidatos, relações e pedidos de remoção. A aplicação recusa campos desconhecidos, referências ausentes e evidências que não sejam trechos literais de fontes válidas; a própria resposta do modelo não se torna evidência de um fato. Nenhuma pontuação numérica de confiança é inventada.

A aplicação valida o plano novamente contra o mapa atual e faz uma única transação com fontes, resposta e mudanças. Novos cartões entram como hipóteses e preservam as posições existentes. Revisões de elementos existentes viram propostas; remoções viram hotspots de revisão, preservando os elementos originais. Relações geradas ficam identificadas como hipótese de IA. Resposta inválida ou erro de comunicação conserva o rascunho e o projeto. As mensagens e os turnos são persistidos em fontes/respostas do contrato existente, sem campos novos na raiz do projeto.

A exportação de blueprint Markdown cobre objetivo, narrativa por posicionamento visual, eventos, elementos, regras, relatos, candidatos de contexto, rastreabilidade, pendências e próximos passos. Onde o mapa não registra uma informação, o relatório a identifica como ausente. A ordem visual e o vínculo registrado não comprovam causalidade; as relações do schema original não têm uma evidência própria separada.

A modalidade identifica a intenção de Big Picture, Processo ou Software Design. Ela não muda automaticamente a semântica do domínio nem estabelece bounded contexts. Contextos são candidatos até validação; nomes, regras e relações devem ter sustentação na conversa.

## Persistência local e abas

A cópia editável é persistida localmente e é diferente do último marco salvo no histórico. Sessões por projeto e aba impedem que uma aba substitua silenciosamente o rascunho de outra. O estado local inclui base de integração, última versão local, última versão compartilhada conhecida, alterações pendentes, estado de sincronização e eventual sessão de diferenças.

IndexedDB é a primeira escolha. O fallback, quando necessário, deve ser apresentado explicitamente: localStorage tem limites menores; memória perde dados ao encerrar a página. Handles de pasta são persistidos somente quando a plataforma permite cloná-los em IndexedDB.

Persistir no navegador não protege contra limpeza de dados do site, perda do perfil ou falha do dispositivo. A exportação portátil é a fronteira de backup. Origem e perfil definem a área de armazenamento; mudar porta ou hostname muda essa área.

## Histórico e integridade

Snapshots e commits são objetos imutáveis com integridade SHA-256. Cada commit identifica pais, snapshot, data, autor, mensagem e schema. Repetir **Salvar versão** sem mudança não cria uma versão vazia. A restauração preserva a cópia atual e cria uma nova versão baseada no snapshot escolhido; não remove o histórico.

O contrato publicado do Studio usado como referência é 1.0. O motor inclui uma migração determinística de um formato sintético 0.9 para exercitar evolução de schema; esse teste não afirma que existiu uma release Studio 0.9 compatível. Esquemas futuros desconhecidos são rejeitados e não migrados silenciosamente.

O diff considera campos escalares, objetos, coleções identificadas por ID e ordem. Alterações em metadados derivados podem ser tratadas separadamente das mudanças de conteúdo. O merge usa ancestral comum, não comparação entre apenas duas cópias.

## Integração e diferenças

1. Validar e preservar as alterações locais.
2. Ler e validar a ponta compartilhada e seus objetos.
3. Se uma linha descende da outra, avançar com os objetos íntegros.
4. Se ambas avançaram, encontrar ancestral comum e integrar Base/Local/Compartilhado.
5. Combinar mudanças independentes ou iguais. Preservar conflitos de mesmo campo, remoção/edição, colisão de ID e ordem incompatível.
6. Persistir a sessão de diferenças até todas as decisões humanas serem válidas.
7. Verificar novamente a publicação antes de afirmar sucesso. Se houve outra mudança, integrar novamente.

Os conflitos são dados com identidade, path, valores anterior/local/compartilhado, tipo, opções e escolha. Fechar a interface de resolução não elimina a sessão. A UI deve mostrar o nome do campo ou entidade, e usar JSON bruto apenas como diagnóstico, quando existir.

## Adapter de pasta experimental

File System Access API não oferece compare-and-swap transacional entre dispositivos. O adapter não substitui um único `main.json` com last-write-wins. Ele publica objetos imutáveis e anúncios individuais, descobre as pontas e integra divergências. Corridas preservam as duas linhas; quando a descoberta não estabiliza, o estado permanece pendente em vez de declarar sucesso.

```text
pasta escolhida/
  .event-storm-local/
    manifests/   # identidade e formato, registros imutáveis
    objects/     # commits e snapshots, hash e réplica única
    heads/       # anúncios de pontas publicados separadamente
```

Manifestos também são imutáveis, para detectar inicializações concorrentes sem substituir a identidade de outra base. O adapter encontra pontas pela ancestralidade do grafo de commits. Arquivos vazios criados por escrita interrompida não são anúncios publicados; registros não vazios inválidos bloqueiam a leitura segura. A pasta sempre permanece em estado de publicação a verificar: o filesystem não permite confirmar convergência global imediata entre dispositivos, mesmo quando uma leitura local não encontra novas divergências.

Essa estratégia evita sobrescrita silenciosa, mas não equivale a transação distribuída. Um provider de sincronização de arquivos pode entregar objetos e anúncios em momentos diferentes. Arquivos incompletos, corrupção, versões incompatíveis e permissão perdida bloqueiam publicação segura e preservam o trabalho local. A confiabilidade multiusuário entre computadores exige evidência adicional; veja [CAPABILITIES.md](CAPABILITIES.md).

Recuperação segue esta ordem: reutilizar handle conhecido e autorizado; pedir permissão no handle conhecido por ação humana; abrir seletor somente se o handle foi perdido ou ficou inutilizável. Após recuperar acesso, validar a identidade do repositório antes de sincronizar.

## Offline e segurança

O service worker conserva arquivos estáticos após primeiro carregamento bem-sucedido; não é o banco de dados. O aplicativo não depende de serviços externos para edição, entrevista guiada ou histórico. A conversa com IA precisa do endpoint disponível; o cache não fornece inferência. O transporte pela ponte requer o servidor do aplicativo; o transporte direto requer CORS do endpoint, inclusive no HTML único. Pasta inacessível e ausência de rede não devem eliminar a cópia de trabalho.

Conteúdo do usuário é apresentado como texto. Importações têm validação de schema e integridade. Configurações HTTP e suas credenciais são armazenadas no navegador e nos pacotes conforme o fluxo de exportação. O contexto do modelo é montado a partir de campos explícitos do domínio e não inclui automaticamente `ai_http`. O servidor incluído escuta em `127.0.0.1`, serve arquivos com GET/HEAD e bloqueia diretórios ocultos, traversal e arquivos que resolvam fora da raiz.

A ponte `POST /api/ai/http` aceita o destino HTTP/HTTPS, cabeçalhos e corpo da requisição configurada pelo usuário, independentemente das variáveis de ambiente legadas. Exige acesso loopback com Host/porta e Origin válidos. Limita tamanho, estrutura, duração, simultaneidade e resposta, cancela pedidos interrompidos, verifica TLS e não segue redirecionamentos. A resposta preserva status, corpo e cabeçalhos do destino para diagnóstico local. `GET /api/ai/config` e `POST /api/ai/chat` mantêm o contrato legado e suas restrições próprias. O endpoint recebe o contexto enviado ao modelo; o mapa não é persistido pelo backend. Configuração, contrato e limites estão em [AI_SETUP.md](AI_SETUP.md). Não há sistema de contas, ACL, criptografia de projeto ou administração multiusuário.

## Verificação

Domínio, heurísticas, merge, histórico e adapters controlados são verificados com o runner nativo do Node.js. O teste do servidor usa HTTP loopback. APIs reais de pasta, quota, persistência de permissões e caches offline precisam de testes no navegador; um adapter de memória aprovado não certifica esses comportamentos. A matriz registra o que foi executado e o que permanece experimental.
