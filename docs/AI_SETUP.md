# Configurar a IA por HTTP

Abra **Configurar IA** no projeto. O editor segue as opções usuais do [HTTP Request do n8n](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/): método, URL, autenticação, parâmetros, cabeçalhos, corpo e resposta. Usa JavaScript e HTTP nativos, sem SDK, pacote adicional ou banco servidor.

## Cadastrar e usar uma requisição

1. Escolha um modelo de requisição: Ollama, LM Studio, Chat Completions ou HTTP personalizado/webhook.
2. Dê um nome e informe a URL completa do endpoint. O endereço de exemplo de Chat Completions precisa ser substituído.
3. Preencha variáveis reutilizáveis como `model`, `apiKey` e `temperature`.
4. Selecione autenticação: nenhuma, Bearer token, Basic auth ou chave em cabeçalho. Os campos aceitam variáveis como `{{apiKey}}`.
5. Ajuste parâmetros da URL, cabeçalhos e corpo: JSON, texto, formulário URLencoded ou ausência de corpo.
6. Informe o campo da resposta, como `choices[0].message.content` ou `output`. Vazio usa a resposta inteira.
7. Clique em **Ver requisição preenchida** e **Testar requisição**. O teste usa um mapa vazio e a mensagem de teste, sem modificar o projeto.
8. Clique em **Salvar e usar**. O facilitador passa a usar esse perfil nas próximas mensagens.

Cada projeto aceita até 20 perfis, com duplicação, remoção e seleção do ativo ao salvar. Alterações no editor ficam como rascunho até salvar; testar e exportar usam os campos atuais do editor.

O [Ollama documenta `/v1/chat/completions`](https://docs.ollama.com/api/openai-compatibility); seu modelo de requisição usa `http://127.0.0.1:11434/v1/chat/completions`. O [LM Studio oferece o endpoint compatível](https://lmstudio.ai/docs/developer/openai-compat), e o modelo de requisição usa a porta 1234. Informe um modelo efetivamente instalado/carregado. O aplicativo não instala serviços nem baixa modelos.

## Variáveis e corpo

| Variável | Conteúdo |
|---|---|
| `{{messages}}` | Lista de mensagens com instrução, contexto limitado e conversa |
| `{{schema}}` | Contrato JSON do plano que atualiza o mapa |
| `{{prompt}}` | Mensagens reunidas como texto |
| `{{message}}` | Mensagem atual |
| `{{system}}` | Instrução do facilitador e contrato |
| `{{history}}` | Mensagens anteriores à atual, incluindo contexto |
| `{{project.name}}` | Nome do projeto |
| `{{model}}`, `{{apiKey}}` e nomes cadastrados | Variáveis reutilizáveis definidas pelo usuário |

No corpo JSON, coloque as variáveis entre aspas:

```json
{
  "model": "{{model}}",
  "messages": "{{messages}}",
  "temperature": "{{temperature}}",
  "stream": false,
  "response_format": { "type": "json_object" }
}
```

Um valor inteiro como `"{{messages}}"` é substituído pela lista real. Variáveis do tipo JSON preservam números, objetos e listas; `temperature` do tipo JSON com valor `0.2` vira número. Variáveis dentro de strings continuam texto e são escapadas pelo serializador JSON. Parâmetros da URL e formulário são codificados. A sintaxe é declarativa, sem eval ou execução de expressões JavaScript/n8n.

Para workflows personalizados, envie `{{prompt}}` ou `{{messages}}` e `{{schema}}`, conforme seu contrato. O endpoint deve devolver o objeto do [facilitador](AI_FACILITATOR_SKILL.md), diretamente ou dentro do campo escolhido. Texto livre aparece no teste HTTP, mas não atualiza o mapa sem esse contrato. Streaming não é interpretado; os modelos de requisição usam `stream: false`.

## Transporte

**Servidor local** usa a ponte incluída em `npm start`, na mesma origem HTTP da aplicação. Encaminha HTTP/HTTPS para destinos locais, de rede ou remotos, sem depender das variáveis de ambiente legadas. Permite leitura de endpoints sem CORS.

**Direto no navegador** dispensa a ponte, inclusive no HTML único, quando o endpoint permite CORS para a origem da página. Conteúdo misto, políticas de rede e cabeçalhos restritos continuam sujeitos às regras do navegador. Em `file://`, o endpoint precisa aceitar a origem usada pelo navegador; esse acesso direto não foi exercitado nesta entrega.

O teste mostra status HTTP, duração, corpo e cabeçalhos; no navegador, somente cabeçalhos expostos por CORS podem ser lidos. Há cancelamento e timeout de 50 a 300000 ms. Erros de conexão, HTTP ou resposta inválida preservam o mapa e o rascunho da conversa.

## Navegador, arquivo e versões

**Salvar e usar** persiste todos os campos, inclusive chaves, tokens e senhas. A extensão opcional `ai_http` acompanha **Exportar JSON**, snapshots, restauração, pacote de versões e integração de diferenças.

**Exportar configuração** baixa um JSON com formato `event-storm-local-http`, versão 1 e a biblioteca completa. **Importar configuração JSON** carrega essa biblioteca no editor; **Salvar e usar** a ativa no projeto. Os arquivos incluem autenticação, cabeçalhos e variáveis. IDs estáveis permitem combinar campos independentes e identificar conflitos.

Credenciais não entram automaticamente no contexto do modelo; são usadas nos campos parametrizados. A ponte não persiste workshops/configurações nem registra corpos ou chaves em logs. O Studio original tem schema estrito que recusa `ai_http`.

## Ponte HTTP

`POST /api/ai/http` recebe `{request: {url, method, headers, body, timeout_ms}}`. O corpo renderizado é uma string ou null. Retorna `{status, statusText, headers, body, duration_ms}`, preservando inclusive respostas não 2xx do destino. Falhas do transporte retornam `{error: {code, message}}` com status correspondente. A UI só aplica respostas 2xx com plano válido.

A ponte exige loopback e Host/porta/Origin da aplicação; não abre CORS para outras páginas. Aceita somente HTTP/HTTPS sem credenciais embutidas na URL, rejeita cabeçalhos gerenciados e injeção de linhas, verifica TLS e não segue redirects. Limites: quatro pedidos simultâneos compartilhados com a rota legada, 1 MB de entrada/resposta, 750 KB de corpo renderizado, 900 KB de configuração/pedido renderizado e 30 linhas por coleção. Fechar/cancelar interrompe o encaminhamento.

## Configuração anterior por ambiente

Sem perfil HTTP salvo ativo, continuam disponíveis `GET /api/ai/config` e `POST /api/ai/chat`:

| Variável | Padrão |
|---|---|
| `AI_BASE_URL` | `http://127.0.0.1:11434/v1` |
| `AI_MODEL` | `llama3.1:8b` |
| `AI_API_KEY` | vazio |
| `AI_TIMEOUT_MS` | `120000` |
| `AI_ALLOW_REMOTE` | false; remoto exige `true` e HTTPS |

A rota legada mantém a chave somente no ambiente do servidor e exige confirmação de destino remoto na UI. Aceita `{messages, model?, schema?}` e retorna `{content, model, provider}`. Trocar variáveis legadas exige reiniciar o servidor. Perfis novos são independentes dessas variáveis e podem ser salvos sem reinício.

## Evidência

Os 12 testes HTTP cobrem parametrização, tipos JSON, Unicode, autenticação, resposta, persistência, histórico/merge, limites, cancelamento e encaminhamento a um servidor simulado. A UI verificou Bearer, exportação com chave fictícia, reload, execução pela ponte e pelo navegador, além de dois cartões e uma relação gerados por resposta controlada.

Esses resultados demonstram transporte e contrato, sem atestar inferência ou qualidade de um LLM real. Entrevista guiada, edição, extração determinística e histórico continuam disponíveis sem modelo. Veja [TEST_REPORT.md](TEST_REPORT.md).
