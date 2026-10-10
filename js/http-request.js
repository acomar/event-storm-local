/** Portable, declarative HTTP requests. Templates resolve data; they never execute JavaScript. */
const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const reserved = ['messages', 'message', 'prompt', 'system', 'history', 'project', 'schema'];
const dangerous = ['__proto__', 'prototype', 'constructor'];
const bytes = value => new TextEncoder().encode(value).byteLength;
const fail = message => { throw new Error('Configuração HTTP: ' + message); };
function object(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(label + ' deve ser um objeto.');
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail('Campo desconhecido em ' + label + ': ' + key + '.');
}
function text(value, max, label, fallback = '') {
  const result = value === undefined ? fallback : value;
  if (typeof result !== 'string' || result.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result)) fail(label + ' contém texto inválido ou excede o limite.');
  return result;
}
function choice(value, values, label, fallback) {
  const result = value === undefined ? fallback : value;
  if (!values.includes(result)) fail(label + ' não é válido.');
  return result;
}
function rows(value, kind) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 30) fail('Use até 30 itens em ' + kind + '.');
  const names = new Set();
  return value.map(row => {
    object(row, kind === 'parameters' ? ['name', 'value', 'enabled', 'type'] : ['name', 'value', 'enabled'], kind);
    const name = text(row.name, 100, 'Nome').trim(), content = text(row.value, 8192, 'Valor');
    const enabled = row.enabled === undefined ? true : row.enabled;
    if (typeof enabled !== 'boolean') fail('Estado da linha inválido.');
    if (!name && !content) return null;
    if (enabled && (!name || dangerous.includes(name))) fail('Informe um nome válido para a linha.');
    if (kind === 'parameters' && name && (!/^[A-Za-z][A-Za-z0-9_]{0,49}$/.test(name) || reserved.includes(name))) fail('Nome de variável inválido ou reservado: ' + name + '.');
    if (kind === 'headers' && name && !/^[!#$%&'*+.^_\x60|~0-9A-Za-z-]+$/.test(name)) fail('Nome de cabeçalho inválido.');
    const key = kind === 'headers' ? name.toLowerCase() : name;
    if (enabled && kind !== 'query' && names.has(key)) fail('Nome duplicado: ' + name + '.');
    if (enabled) names.add(key);
    if (kind !== 'parameters') return { name, value: content, enabled };
    const type = choice(row.type, ['text', 'json'], 'Tipo da variável', 'text');
    if (enabled && type === 'json') { try { JSON.parse(content); } catch { fail('JSON inválido na variável ' + name + '.'); } }
    return { name, value: content, enabled, type };
  }).filter(Boolean);
}

export const httpPresets = Object.freeze({ ollama: 'Ollama local', lmstudio: 'LM Studio local', chat: 'Chat Completions', custom: 'HTTP personalizado / webhook' });
export function newHTTPRequest(preset = 'ollama') {
  if (!Object.hasOwn(httpPresets, preset)) fail('Modelo de requisição desconhecido.');
  const custom = preset === 'custom';
  return {
    id: crypto.randomUUID(), name: httpPresets[preset], method: 'POST',
    url: custom ? 'http://127.0.0.1:5678/webhook/facilitador' : preset === 'lmstudio' ? 'http://127.0.0.1:1234/v1/chat/completions' : preset === 'chat' ? 'https://seu-provedor.example/v1/chat/completions' : 'http://127.0.0.1:11434/v1/chat/completions',
    execution: 'bridge', timeout_ms: 120000, query: [], headers: [{ name: 'Content-Type', value: 'application/json', enabled: true }],
    parameters: [
      { name: 'model', value: preset === 'ollama' ? 'llama3.1:8b' : '', enabled: true, type: 'text' },
      { name: 'apiKey', value: '', enabled: true, type: 'text' },
      { name: 'temperature', value: '0.2', enabled: true, type: 'json' }
    ],
    auth: { type: preset === 'chat' ? 'bearer' : 'none', token: '{{apiKey}}', username: '', password: '', header: 'X-API-Key' },
    body_type: 'json',
    body: JSON.stringify(custom ? { prompt: '{{prompt}}', messages: '{{messages}}', schema: '{{schema}}' } : { model: '{{model}}', messages: '{{messages}}', stream: false, temperature: '{{temperature}}', max_tokens: 4096, response_format: { type: 'json_object' } }, null, 2),
    response_path: custom ? '' : 'choices[0].message.content'
  };
}
export function normalizeHTTPRequest(value) {
  object(value, ['id', 'name', 'method', 'url', 'execution', 'timeout_ms', 'query', 'headers', 'parameters', 'auth', 'body_type', 'body', 'response_path'], 'requisição');
  const id = text(value.id, 100, 'ID'), name = text(value.name, 120, 'Nome').trim();
  if (!id || !name || dangerous.includes(id)) fail('A requisição precisa de ID e nome.');
  const url = text(value.url, 4096, 'URL').trim();
  if (!url) fail('Informe a URL.');
  const timeout_ms = value.timeout_ms === undefined ? 120000 : value.timeout_ms;
  if (!Number.isInteger(timeout_ms) || timeout_ms < 50 || timeout_ms > 300000) fail('Tempo limite deve estar entre 50 e 300000 ms.');
  const auth = value.auth || { type: 'none' };
  object(auth, ['type', 'token', 'username', 'password', 'header'], 'autenticação');
  const result = {
    id, name, method: choice(value.method, methods, 'Método', 'POST'), url,
    execution: choice(value.execution, ['bridge', 'browser'], 'Execução', 'bridge'), timeout_ms,
    query: rows(value.query, 'query'), headers: rows(value.headers, 'headers'), parameters: rows(value.parameters, 'parameters'),
    auth: { type: choice(auth.type, ['none', 'bearer', 'basic', 'header'], 'Autenticação', 'none'), token: text(auth.token, 8192, 'Token'), username: text(auth.username, 8192, 'Usuário'), password: text(auth.password, 8192, 'Senha'), header: text(auth.header, 100, 'Cabeçalho de autenticação', 'X-API-Key') },
    body_type: choice(value.body_type, ['none', 'json', 'text', 'form'], 'Tipo do corpo', 'json'),
    body: text(value.body, 60000, 'Corpo'), response_path: text(value.response_path, 500, 'Caminho da resposta').trim()
  };
  if (result.body_type === 'json') { try { JSON.parse(result.body); } catch { fail('O corpo deve ser JSON válido. Coloque as variáveis entre aspas, como "{{messages}}".'); } }
  if (!url.includes('{{')) normalizeHTTPWireRequest({ url, method: result.method, headers: {}, body: null, timeout_ms });
  readHTTPPath({}, result.response_path, false);
  return result;
}
export function normalizeAIHTTP(value) {
  object(value, ['active_id', 'requests'], 'configuração');
  if (!Array.isArray(value.requests) || value.requests.length > 20) fail('Cadastre até 20 requisições.');
  const requests = value.requests.map(normalizeHTTPRequest);
  if (new Set(requests.map(r => r.id)).size !== requests.length) fail('IDs de requisição duplicados.');
  const active_id = text(value.active_id, 100, 'Requisição ativa');
  if (active_id && !requests.some(r => r.id === active_id)) fail('A requisição ativa não existe.');
  const result = { active_id, requests };
  if (bytes(JSON.stringify(result)) > 900000) fail('A biblioteca de requisições excede 900 KB.');
  return result;
}
export function readHTTPPath(value, path, required = true) {
  if (!path || path === '$') return value;
  const normalized = path.replace(/^\$\./, '').replace(/\[(\d+)\]/g, '.$1');
  const parts = normalized.split('.');
  if (parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part) || dangerous.includes(part))) fail('Use um caminho como choices[0].message.content, sem expressões JavaScript.');
  let result = value;
  for (const part of parts) result = result !== null && typeof result === 'object' && Object.hasOwn(result, part) ? result[part] : undefined;
  if (required && result === undefined) fail('O campo ' + path + ' não existe na resposta ou nas variáveis.');
  return result;
}
function renderText(template, variables) {
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, path) => {
    const value = readHTTPPath(variables, path.trim());
    return typeof value === 'string' ? value : JSON.stringify(value);
  });
}
function renderJSON(value, variables, depth = 0) {
  if (depth > 32) fail('O corpo JSON é profundo demais.');
  if (typeof value === 'string') {
    const exact = /^\{\{\s*([^{}]+?)\s*\}\}$/.exec(value);
    return exact ? structuredClone(readHTTPPath(variables, exact[1].trim())) : renderText(value, variables);
  }
  if (Array.isArray(value)) return value.map(item => renderJSON(item, variables, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, renderJSON(item, variables, depth + 1)]));
  return value;
}
function base64(value) {
  const data = new TextEncoder().encode(value), alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let i = 0; i < data.length; i += 3) {
    const a = data[i], b = data[i + 1], c = data[i + 2];
    result += alphabet[a >> 2] + alphabet[((a & 3) << 4) | ((b || 0) >> 4)] + (b === undefined ? '=' : alphabet[((b & 15) << 2) | ((c || 0) >> 6)]) + (c === undefined ? '=' : alphabet[c & 63]);
  }
  return result;
}
export function normalizeHTTPWireRequest(value) {
  object(value, ['url', 'method', 'headers', 'body', 'timeout_ms'], 'pedido renderizado');
  const raw = text(value.url, 20000, 'URL renderizada');
  let url;
  try { url = new URL(raw); } catch { fail('A URL renderizada não é válida.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || /[\r\n\t]/.test(raw)) fail('Use uma URL HTTP/HTTPS sem credenciais embutidas ou fragmento.');
  const method = choice(value.method, methods, 'Método', 'POST');
  const headers = value.headers ?? {};
  if (!headers || typeof headers !== 'object' || Array.isArray(headers) || ![Object.prototype, null].includes(Object.getPrototypeOf(headers)) || Object.keys(headers).length > 60) fail('Cabeçalhos inválidos.');
  const normalized = [];
  const seen = new Set(), managed = ['host', 'content-length', 'connection', 'transfer-encoding', 'upgrade', 'keep-alive', 'proxy-connection', 'te', 'trailer'];
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase();
    if (!/^[!#$%&'*+.^_\x60|~0-9A-Za-z-]+$/.test(name) || dangerous.includes(key) || managed.includes(key) || seen.has(key) || typeof value !== 'string' || value.length > 8192 || /[\r\n\u0000]/.test(value)) fail('Cabeçalho inválido ou gerenciado pelo transporte: ' + name + '.');
    seen.add(key); normalized.push([name, value]);
  }
  const body = value.body === undefined || value.body === null ? null : text(value.body, 750000, 'Corpo renderizado');
  if (body !== null && bytes(body) > 750000) fail('Corpo renderizado excede 750 KB.');
  if (['GET', 'HEAD'].includes(method) && body !== null) fail(method + ' não aceita corpo; selecione Sem corpo.');
  const timeout_ms = value.timeout_ms;
  if (!Number.isInteger(timeout_ms) || timeout_ms < 50 || timeout_ms > 300000) fail('Tempo limite inválido.');
  const result = { url: url.href, method, headers: Object.fromEntries(normalized), body, timeout_ms };
  if (bytes(JSON.stringify({ request: result })) > 900000) fail('Pedido renderizado excede 900 KB.');
  return result;
}
export function buildHTTPRequest(profile, variables = {}) {
  const config = normalizeHTTPRequest(profile), context = Object.assign(Object.create(null), variables);
  for (const parameter of config.parameters.filter(row => row.enabled)) context[parameter.name] = parameter.type === 'json' ? JSON.parse(parameter.value) : parameter.value;
  const url = new URL(renderText(config.url, context));
  for (const row of config.query.filter(row => row.enabled)) url.searchParams.append(renderText(row.name, context), renderText(row.value, context));
  const headers = Object.fromEntries(config.headers.filter(row => row.enabled).map(row => [row.name, renderText(row.value, context)]));
  const setHeader = (name, value) => {
    for (const key of Object.keys(headers)) if (key.toLowerCase() === name.toLowerCase()) delete headers[key];
    Object.defineProperty(headers, name, { value, writable: true, enumerable: true, configurable: true });
  };
  if (config.auth.type === 'bearer') setHeader('Authorization', 'Bearer ' + renderText(config.auth.token, context));
  if (config.auth.type === 'basic') setHeader('Authorization', 'Basic ' + base64(renderText(config.auth.username, context) + ':' + renderText(config.auth.password, context)));
  if (config.auth.type === 'header') setHeader(config.auth.header, renderText(config.auth.token, context));
  let body = null;
  if (config.body_type === 'json') {
    try { body = JSON.stringify(renderJSON(JSON.parse(config.body), context)); } catch (error) { throw new Error('Corpo JSON: ' + error.message); }
    if (!Object.keys(headers).some(key => key.toLowerCase() === 'content-type')) setHeader('Content-Type', 'application/json');
  } else if (config.body_type === 'form') {
    const form = new URLSearchParams();
    for (const [key, value] of new URLSearchParams(config.body)) form.append(renderText(key, context), renderText(value, context));
    body = form.toString();
    if (!Object.keys(headers).some(key => key.toLowerCase() === 'content-type')) setHeader('Content-Type', 'application/x-www-form-urlencoded');
  } else if (config.body_type !== 'none') {
    body = renderText(config.body, context);
    if (!Object.keys(headers).some(key => key.toLowerCase() === 'content-type')) setHeader('Content-Type', config.body_type === 'form' ? 'application/x-www-form-urlencoded' : 'text/plain');
  }
  return normalizeHTTPWireRequest({ url: url.href, method: config.method, headers, body, timeout_ms: config.timeout_ms });
}
export function extractHTTPResponse(result, path) {
  let value = result.body;
  try { value = JSON.parse(value); } catch { if (path) fail('A resposta precisa ser JSON para usar um caminho de conteúdo.'); }
  value = readHTTPPath(value, path);
  const content = typeof value === 'string' ? value : JSON.stringify(value);
  if (typeof content !== 'string' || !content.trim() || content.length > 200000) fail('A resposta não contém texto válido para o facilitador.');
  return content;
}
export async function executeHTTPWireRequest(value, { signal, fetchImpl = globalThis.fetch } = {}) {
  const request = normalizeHTTPWireRequest(value), started = Date.now(), controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort('timeout'); }, request.timeout_ms);
  try {
    const response = await fetchImpl(request.url, { method: request.method, headers: request.headers, ...(request.body === null ? {} : { body: request.body }), signal: controller.signal, redirect: 'manual', credentials: 'omit' });
    if (response.status === 0) throw new Error('A resposta não pôde ser lida. Use o servidor local ou configure CORS no endpoint.');
    if (Number(response.headers.get('content-length') || 0) > 1000000) throw new Error('A resposta excede 1 MB.');
    const chunks = []; let size = 0;
    if (response.body) {
      const reader = response.body.getReader();
      try {
        while (true) {
          const item = await reader.read(); if (item.done) break;
          size += item.value.byteLength;
          if (size > 1000000) { await reader.cancel(); throw new Error('A resposta excede 1 MB.'); }
          chunks.push(item.value);
        }
      } finally { reader.releaseLock(); }
    }
    const output = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
    return { status: response.status, statusText: response.statusText, headers: Object.fromEntries(response.headers), body: new TextDecoder().decode(output), duration_ms: Date.now() - started };
  } catch (error) {
    controller.abort();
    if (timedOut) { const timeout = new Error('A requisição HTTP excedeu o tempo limite.'); timeout.code = 'http_timeout'; throw timeout; }
    if (signal?.aborted) { const cancelled = new Error('Requisição HTTP cancelada.'); cancelled.code = 'http_cancelled'; throw cancelled; }
    if (error instanceof TypeError) throw new Error('Não foi possível conectar ao endpoint HTTP. Se estiver usando o navegador, verifique CORS ou escolha o servidor local.');
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
export async function executeHTTPRequest(profile, variables, { signal, fetchImpl = globalThis.fetch, bridgeURL } = {}) {
  const config = normalizeHTTPRequest(profile), request = buildHTTPRequest(config, variables);
  if (config.execution === 'browser') return executeHTTPWireRequest(request, { signal, fetchImpl });
  if (!bridgeURL) {
    if (!['http:', 'https:'].includes(globalThis.location?.protocol)) throw new Error('Para usar o servidor local, abra a aplicação com npm start. No HTML direto, escolha Direto no navegador e um endpoint com CORS.');
    bridgeURL = new URL('./api/ai/http', globalThis.location.href).href;
  }
  const result = await executeHTTPWireRequest({ url: bridgeURL, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request }), timeout_ms: config.timeout_ms }, { signal, fetchImpl });
  let payload;
  try { payload = JSON.parse(result.body); } catch { throw new Error('O servidor local retornou uma resposta inválida.'); }
  if (result.status < 200 || result.status >= 300) throw new Error(payload?.error?.message || 'O servidor local recusou a requisição HTTP.');
  if (!payload || typeof payload.status !== 'number' || typeof payload.body !== 'string' || !payload.headers || typeof payload.headers !== 'object') throw new Error('A resposta HTTP encaminhada é inválida.');
  return payload;
}
