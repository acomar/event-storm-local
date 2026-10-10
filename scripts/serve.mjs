import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import { normalizeHTTPWireRequest, executeHTTPWireRequest } from '../js/http-request.js';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8'
};

function isWithin(root, target) {
  const suffix = relative(root, target);
  return suffix === '' || (!isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith(`..${sep}`));
}

class RequestError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const MAX_BODY_BYTES = 256_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_MESSAGES = 24;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,159}$/;
const loopback = host => {
  const normalized = String(host || '').replace(/^\[|\]$/g, '').toLowerCase();
  return normalized === 'localhost' || normalized === '::1' ||
    (isIP(normalized) === 4 && normalized.startsWith('127.')) ||
    /^::ffff:127\./i.test(normalized);
};

/** Configuration is server-owned. The browser never supplies an upstream URL or API key. */
export function loadAIConfig(env = process.env) {
  let url;
  try { url = new URL(env.AI_BASE_URL || 'http://127.0.0.1:11434/v1'); }
  catch { throw new RequestError(503, 'ai_config_invalid', 'AI_BASE_URL precisa ser uma URL válida do provedor.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new RequestError(503, 'ai_config_invalid', 'AI_BASE_URL deve usar HTTP/HTTPS, sem credenciais, query ou fragmento.');
  const local = loopback(url.hostname);
  if (!local && env.AI_ALLOW_REMOTE !== 'true') throw new RequestError(503, 'ai_remote_disabled', 'Destino remoto exige AI_ALLOW_REMOTE=true no servidor.');
  if (!local && url.protocol !== 'https:') throw new RequestError(503, 'ai_config_invalid', 'Provedores remotos precisam de HTTPS.');
  // Avoid relying on DNS for a localhost destination; it remains pinned to loopback.
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  const model = env.AI_MODEL || 'llama3.1:8b';
  if (typeof model !== 'string' || !MODEL.test(model)) throw new RequestError(503, 'ai_config_invalid', 'AI_MODEL precisa ser um identificador de modelo com até 160 caracteres.');
  const apiKey = env.AI_API_KEY || '';
  if (typeof apiKey !== 'string' || apiKey.length > 8192 || /[\u0000-\u001f\u007f]/.test(apiKey)) throw new RequestError(503, 'ai_config_invalid', 'AI_API_KEY contém um formato inválido.');
  const timeoutMs = Number(env.AI_TIMEOUT_MS || '120000');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 300000) throw new RequestError(503, 'ai_config_invalid', 'AI_TIMEOUT_MS deve estar entre 50 e 300000 milissegundos.');
  return Object.freeze({ provider: 'openai-compatible', mode: local ? 'local' : 'remote', baseURL: url.href.replace(/\/+$/, ''), model, apiKey, timeoutMs });
}

function scrub(value, config) {
  return config?.apiKey ? String(value).replaceAll(config.apiKey, '[credencial removida]') : String(value);
}

function assertLocalOrigin(request, server) {
  if (!loopback(request.socket.remoteAddress)) throw new RequestError(403, 'origin_forbidden', 'A integração de IA aceita somente acesso local.');
  const host = request.headers.host;
  let parsed;
  try { parsed = new URL(`http://${host}`); } catch { /* Rejected below. */ }
  const bound = server.address();
  if (typeof host !== 'string' || !parsed || parsed.host !== host.toLowerCase() || !loopback(parsed.hostname) || Number(parsed.port || 80) !== bound?.port) throw new RequestError(403, 'host_forbidden', 'Host de acesso não permitido.');
  const origin = request.headers.origin;
  if (origin !== undefined && origin !== `http://${parsed.host}`) throw new RequestError(403, 'origin_forbidden', 'Abra a aplicação na mesma origem HTTP do servidor local.');
  if (request.headers['sec-fetch-site'] === 'cross-site') throw new RequestError(403, 'origin_forbidden', 'Requisição de outra origem não permitida.');
}

function readJSONBody(request, maxBytes = MAX_BODY_BYTES) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] || '')) throw new RequestError(415, 'content_type', 'Envie o pedido como application/json.');
  const expected = request.headers['content-length'];
  if (expected !== undefined && (!/^\d+$/.test(expected) || Number(expected) > maxBytes)) {
    request.resume();
    throw new RequestError(413, 'body_too_large', 'O pedido excede o limite de ' + Math.round(maxBytes / 1000) + ' KB. Reduza o conteúdo enviado.');
  }
  return new Promise((resolveBody, reject) => {
    const chunks = []; let size = 0;
    const timer = setTimeout(() => finish(new RequestError(408, 'body_timeout', 'O envio do pedido demorou demais.')), 15000);
    timer.unref();
    const cleanup = () => { clearTimeout(timer); for (const [event, fn] of [['data', onData], ['end', onEnd], ['error', onError], ['aborted', onAbort]]) request.removeListener(event, fn); };
    const finish = (error, result) => { cleanup(); if (error) { request.resume(); reject(error); } else resolveBody(result); };
    const onData = chunk => {
      size += chunk.length;
      if (size > maxBytes) { finish(new RequestError(413, 'body_too_large', 'O pedido excede o limite de ' + Math.round(maxBytes / 1000) + ' KB. Reduza o conteúdo enviado.')); return; }
      chunks.push(chunk);
    };
    const onEnd = () => {
      try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { finish(new RequestError(400, 'invalid_json', 'O pedido contém JSON inválido.')); }
    };
    const onError = () => finish(new RequestError(400, 'body_read_error', 'Não foi possível ler o pedido.'));
    const onAbort = () => finish(new RequestError(400, 'body_aborted', 'O envio do pedido foi interrompido.'));
    request.on('data', onData); request.on('end', onEnd); request.on('error', onError); request.on('aborted', onAbort);
  });
}

function validateChatRequest(body, config) {
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
  if (!plain(body) || Object.keys(body).some(key => !['messages', 'model', 'schema'].includes(key))) throw new RequestError(400, 'invalid_request', 'Use apenas messages, model e schema no pedido.');
  if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > MAX_MESSAGES) throw new RequestError(400, 'invalid_messages', `Envie entre 1 e ${MAX_MESSAGES} mensagens.`);
  let total = 0;
  const messages = body.messages.map(message => {
    if (!plain(message) || Object.keys(message).some(key => !['role', 'content'].includes(key)) || !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || !message.content.trim() || message.content.length > 100000) throw new RequestError(400, 'invalid_messages', 'Mensagens precisam de papel válido e conteúdo de texto com até 100 mil caracteres.');
    total += message.content.length;
    return { role: message.role, content: message.content };
  });
  if (total > 180000) throw new RequestError(413, 'messages_too_large', 'Reduza o histórico para até 180 mil caracteres.');
  const model = body.model ?? config.model;
  if (typeof model !== 'string' || !MODEL.test(model)) throw new RequestError(400, 'invalid_model', 'O identificador do modelo é inválido.');
  let schema;
  if (body.schema !== undefined) {
    schema = body.schema;
    if (!plain(schema) || Buffer.byteLength(JSON.stringify(schema), 'utf8') > 32768) throw new RequestError(400, 'invalid_schema', 'O esquema precisa ser um objeto JSON de até 32 KB.');
    let nodes = 0;
    const visit = (value, depth = 0) => {
      if (++nodes > 10000 || depth > 16) throw new RequestError(400, 'invalid_schema', 'O esquema excede os limites de estrutura.');
      if (value && typeof value === 'object') {
        for (const [key, item] of Object.entries(value)) {
          if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new RequestError(400, 'invalid_schema', 'O esquema contém uma propriedade não permitida.');
          visit(item, depth + 1);
        }
      }
    };
    visit(schema);
  }
  return { messages, model, schema };
}

async function readUpstreamJSON(response) {
  if (Number(response.headers.get('content-length') || 0) > MAX_RESPONSE_BYTES) throw new RequestError(502, 'response_too_large', 'A resposta excedeu o limite. Peça uma análise menor.');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_RESPONSE_BYTES) throw new RequestError(502, 'response_too_large', 'A resposta excedeu o limite. Peça uma análise menor.');
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new RequestError(502, 'invalid_response', 'O provedor retornou uma resposta inválida.'); }
}

export async function createStaticServer({ root = defaultRoot, aiEnv = process.env } = {}) {
  const realRoot = await realpath(root);
  let config, configError, activeAI = 0;
  try { config = loadAIConfig(aiEnv); } catch (error) { configError = error; }
  const server = createServer(async (request, response) => {
    request.on('error', () => {});
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-cache');
    const end = (status, text) => {
      response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : text);
    };
    const json = (status, value) => {
      if (response.destroyed || response.writableEnded) return;
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify(value));
    };
    const errorJSON = error => json(error.status || 500, { error: { code: error.code || 'internal_error', message: error.message || 'Não foi possível completar o pedido.' } });
    const apiPath = (request.url || '/').split('?')[0];
    if (apiPath === '/api/ai/http') {
      try {
        assertLocalOrigin(request, server);
        response.setHeader('Allow', 'POST');
        if (request.method !== 'POST') throw new RequestError(405, 'method', 'Use POST para executar a requisição cadastrada.');
        const body = await readJSONBody(request, 1000000);
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'request')) throw new RequestError(400, 'invalid_request', 'Envie apenas request no pedido.');
        let outbound;
        try { outbound = normalizeHTTPWireRequest(body.request); } catch (error) { throw new RequestError(400, 'invalid_request', error.message); }
        if (activeAI >= 4) throw new RequestError(429, 'busy', 'Há pedidos em andamento. Aguarde antes de tentar novamente.');
        activeAI++;
        const controller = new AbortController();
        const disconnected = () => { if (!response.writableFinished) controller.abort(); };
        response.once('close', disconnected);
        try { json(200, await executeHTTPWireRequest(outbound, { signal: controller.signal })); }
        catch (error) {
          if (response.destroyed) return;
          throw new RequestError(error.code === 'http_timeout' ? 504 : 502, error.code || 'http_request_failed', error.message);
        } finally { response.removeListener('close', disconnected); activeAI--; }
      } catch (error) { errorJSON(error); }
      return;
    }
    if (apiPath === '/api/ai/config' || apiPath === '/api/ai/chat') {
      try {
        assertLocalOrigin(request, server);
        response.setHeader('Allow', apiPath === '/api/ai/config' ? 'GET' : 'POST');
        if (apiPath === '/api/ai/config') {
          if (request.method !== 'GET') throw new RequestError(405, 'method', 'Use GET para consultar a configuração.');
          if (configError) { json(200, { configured: false, provider: 'openai-compatible', mode: 'unavailable', model: '', baseURL: '', keyConfigured: Boolean(aiEnv.AI_API_KEY), error: { code: configError.code, message: configError.message } }); return; }
          json(200, { configured: true, provider: config.provider, mode: config.mode, model: scrub(config.model, config), baseURL: scrub(config.baseURL, config), keyConfigured: Boolean(config.apiKey) });
          return;
        }
        if (request.method !== 'POST') throw new RequestError(405, 'method', 'Use POST para conversar com o facilitador.');
        if (configError) throw configError;
        const body = validateChatRequest(await readJSONBody(request), config);
        if (activeAI >= 4) throw new RequestError(429, 'busy', 'Há pedidos em andamento. Aguarde antes de tentar novamente.');
        activeAI++;
        const controller = new AbortController(); let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; controller.abort(); }, config.timeoutMs); timer.unref();
        const disconnected = () => { if (!response.writableFinished) controller.abort(); };
        response.once('close', disconnected);
        try {
          const messages = body.schema ? [{ role: 'system', content: `Responda somente com JSON válido que respeite este esquema. Não acrescente blocos Markdown. Esquema: ${JSON.stringify(body.schema)}` }, ...body.messages] : body.messages;
          const upstream = await fetch(`${config.baseURL}/chat/completions`, {
            method: 'POST', redirect: 'manual', signal: controller.signal,
            headers: { 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
            body: JSON.stringify({ model: body.model, messages, stream: false, temperature: 0.2, max_tokens: 4096, ...(body.schema ? { response_format: { type: 'json_object' } } : {}) })
          });
          if (!upstream.ok) {
            await upstream.body?.cancel();
            if (upstream.status === 404) throw new RequestError(502, 'model_unavailable', 'O modelo configurado não está disponível. Confira AI_MODEL e carregue o modelo no provedor.');
            if ([401, 403].includes(upstream.status)) throw new RequestError(502, 'provider_auth', 'O provedor recusou o acesso. Confira AI_API_KEY no servidor.');
            if (upstream.status === 429) throw new RequestError(503, 'provider_busy', 'O provedor está ocupado. Tente novamente em alguns instantes.');
            throw new RequestError(502, 'provider_error', 'O provedor recusou o pedido. Confira o endpoint, o modelo e o suporte a JSON.');
          }
          const result = await readUpstreamJSON(upstream);
          const content = result?.choices?.[0]?.message?.content;
          if (typeof content !== 'string' || !content.trim() || content.length > 200000) throw new RequestError(502, 'invalid_response', 'O provedor não retornou conteúdo textual válido.');
          json(200, { content: scrub(content, config), model: scrub(typeof result.model === 'string' && MODEL.test(result.model) ? result.model : body.model, config), provider: config.provider });
        } catch (error) {
          controller.abort();
          if (response.destroyed) return;
          if (error instanceof RequestError) throw error;
          if (timedOut) throw new RequestError(504, 'provider_timeout', 'O modelo demorou demais. Tente uma pergunta menor ou outro modelo.');
          throw new RequestError(502, 'provider_unavailable', 'Não foi possível conectar ao provedor. Inicie o servidor do modelo e confira AI_BASE_URL.');
        } finally { clearTimeout(timer); response.removeListener('close', disconnected); activeAI--; }
      } catch (error) { errorJSON(error); }
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.setHeader('Allow', 'GET, HEAD');
      end(405, 'Método não permitido.');
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent((request.url || '/').split('?')[0]);
    } catch {
      end(400, 'Endereço inválido.');
      return;
    }
    if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0') ||
        pathname.split('/').some(segment => segment.startsWith('.'))) {
      end(403, 'Acesso não permitido.');
      return;
    }
    let candidate = resolve(realRoot, `.${pathname}`);
    if (!isWithin(realRoot, candidate)) {
      end(403, 'Acesso não permitido.');
      return;
    }
    try {
      let information = await stat(candidate);
      if (information.isDirectory()) {
        candidate = resolve(candidate, 'index.html');
        information = await stat(candidate);
      }
      const actualPath = await realpath(candidate);
      if (!isWithin(realRoot, actualPath) || !information.isFile()) {
        end(403, 'Acesso não permitido.');
        return;
      }
      response.writeHead(200, {
        'Content-Type': mimeTypes[extname(actualPath).toLowerCase()] || 'application/octet-stream',
        'Content-Length': information.size,
        ...(extname(actualPath).toLowerCase() === '.js' ? { 'Service-Worker-Allowed': '/' } : {})
      });
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      const stream = createReadStream(actualPath);
      stream.on('error', () => response.destroy());
      stream.pipe(response);
    } catch (error) {
      if (!response.headersSent) end(['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : 403, 'Arquivo indisponível.');
      else response.destroy();
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || '8080');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT deve ser um número entre 1 e 65535.');
  const server = await createStaticServer();
  server.on('error', error => {
    console.error(`Não foi possível iniciar o servidor: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => console.log(`Event Storm Local: http://127.0.0.1:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
}
