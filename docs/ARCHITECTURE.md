# Arquitetura

## Decisão principal

Aplicação estática e modular, sem build e sem dependências de runtime externas. HTML e CSS compõem a interface; módulos JavaScript nativos implementam domínio, facilitação e versionamento. IndexedDB substitui o MongoDB do Studio original. Um servidor estático opcional apenas entrega arquivos; não recebe nem persiste dados de workshop.

Há duas formas de distribuição das mesmas fontes: `index.html` usa módulos locais servidos por HTTP/HTTPS; `standalone.html` leva o código, CSS e ícone dentro de um único arquivo. O segundo é gerado com um compilador nativo limitado ao grafo de seis módulos auditados, sem pacotes. O compilador aceita imports nomeados estáticos, exports nomeados de const/função/classe, verifica símbolos e ordena dependências. Imports externos, ciclos e formas não suportadas são rejeitados; cada fonte e o bundle passam pela verificação sintática nativa do Node.js.

Cada módulo compilado mantém seu escopo numa closure, evitando colisões de nomes. O script final é colocado depois do DOM inicial e desativa o registro de service worker no modo standalone. O HTML único pronto é versionado, e o teste verifica correspondência exata com as fontes para evitar publicação desatualizada. A persistência de origens `file://` continua dependendo do navegador; isso não é garantido pelo empacotamento.

Esta edição é derivada do [Studio na revisão 41fb8656](https://github.com/acomar/eventstorm-studio/tree/41fb8656d635da8e10e3dd8be00af4d2d6cc53ee) e aplica as orientações do [SkillForge na revisão 1f2a421a](https://github.com/acomar/skillforge/tree/1f2a421aadf17aadb82d31aaa91ecc98ed3c28e9). A proveniência e o alcance das skills estão em [SKILLFORGE.md](SKILLFORGE.md).

## Camadas

```text
Interface HTML / CSS / DOM
  ├── Contrato do domínio: validação e identidade
  ├── Facilitador: fontes → hipóteses → revisão humana → grafo
  └── VersionEngine
        ├── LocalStore: cópia de trabalho, sessão e objetos
        ├── Diff / merge semântico: Base + Local + Compartilhado
        └── RepositoryAdapter
              ├── memória: prova determinística e testes
              └── pasta: objetos e anúncios imutáveis, experimental
```

A camada de domínio não conhece DOM, IndexedDB ou filesystem. O facilitador produz candidatos; não confirma conhecimento automaticamente. O motor de versão recebe e valida snapshots estruturados; o adapter define acesso, integridade e publicação. Nenhuma camada executa conteúdo importado como código.

## Modelo portátil

O contrato de projeto continua em `schema_version: "1.0"`: metadados e um grafo com `nodes`, `edges`, `sources`, `evidences`, `proposals`, `answers` e `viewport`. Nós e fontes mantêm IDs estáveis. Relações referem IDs de nós; evidências referem fontes; respostas referem fontes. O importador rejeita IDs duplicados, referências ausentes, versões desconhecidas, coordenadas não finitas e entradas acima dos limites.

Estados do conhecimento continuam separados das decisões sobre propostas. Uma proposta gerada é uma hipótese; aceitar registra `pending`. `validated` depende de ação humana. Origens `ai` e `code` podem aparecer em arquivos portáteis do Studio, mas esta aplicação não contém importador de código nem motor de IA.

Importar um projeto para o dashboard cria outra identidade de projeto. Importar um pacote de versões é uma operação distinta: precisa preservar a identidade do repositório e seu histórico para permitir integração segura.

Na sessão nova, a importação do pacote restaura histórico e cópia de trabalho. Na sessão existente do mesmo projeto, salva o rascunho como versão antes de integrar a ponta recebida. Os ramos permanecem no DAG e a integração usa ancestral comum; divergências geram sessão de diferenças. Repositório diferente, histórico sem origem comum e sessão local de diferenças ainda pendente não permitem substituir o estado silenciosamente. Um pacote que já contém diferenças pendentes só pode ser recuperado numa sessão nova; o motor recalcula e valida a sessão e suas escolhas antes de aceitá-la.

O tipo local `aggregate` amplia os 11 tipos do Studio. O validador original rejeita esse valor; portanto projetos contendo agregados, inclusive em propostas, não são compatíveis de volta com o original. Essa limitação da extensão é explícita e não autoriza converter agregados silenciosamente para outro conceito.

## Facilitação e evidência

Texto e respostas são preservados como fontes. Cada candidato aponta para trechos dessas fontes e explica o reconhecimento determinístico. O vocabulário lexical é limitado e pode produzir falsos positivos; negação, contexto e causalidade precisam de revisão. Uma resposta anterior é preservada quando o especialista registra outra perspectiva.

O reconhecimento sinaliza negação/condição/dúvida como hotspot ou regra em vez de promover automaticamente uma ocorrência positiva. Isso reduz um falso positivo conhecido do original, sem constituir compreensão semântica geral. A entrevista mantém os oito IDs de perguntas do Studio.

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

O service worker conserva arquivos estáticos após primeiro carregamento bem-sucedido; não é o banco de dados. O aplicativo não depende de serviços externos para edição, entrevista ou histórico. Pasta inacessível e ausência de rede não devem eliminar a cópia de trabalho.

Conteúdo do usuário é apresentado como texto. Importações têm validação de schema e integridade. Nenhuma credencial é armazenada em pacotes. O servidor incluído escuta em `127.0.0.1`, aceita GET/HEAD, bloqueia diretórios ocultos, traversal e arquivos que resolvam fora da raiz. Não há sistema de contas, ACL, criptografia de projeto ou administração multiusuário.

## Verificação

Domínio, heurísticas, merge, histórico e adapters controlados são verificados com o runner nativo do Node.js. O teste do servidor usa HTTP loopback. APIs reais de pasta, quota, persistência de permissões e caches offline precisam de testes no navegador; um adapter de memória aprovado não certifica esses comportamentos. A matriz registra o que foi executado e o que permanece experimental.
