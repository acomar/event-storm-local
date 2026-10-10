import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createStaticServer, loadAIConfig } from '../scripts/serve.mjs';

const KEY = 'fake-secret-for-local-tests-only';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function listen(server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`; }
async function close(server) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
const chat = (base, body = { messages: [{ role: 'user', content: 'Qual evento inicia o processo?' }] }, headers = {}) => fetch(`${base}/api/ai/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, ...headers }, body: JSON.stringify(body) });
const rawChat = (base, headers) => new Promise((done, reject) => {
  const req = request(`${base}/api/ai/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, ...headers } }, res => {
    let text = ''; res.setEncoding('utf8'); res.on('data', chunk => text += chunk);
    res.on('end', () => done({ status: res.statusCode, json: () => JSON.parse(text) }));
  });
  req.on('error', reject); req.end(JSON.stringify({ messages: [{ role: 'user', content: 'Qual evento inicia o processo?' }] }));
});
async function mockProvider(t, handler) {
  const records = [];
  const provider = createServer(async (req, res) => {
    req.on('error', () => {}); let text = '';
    for await (const chunk of req) text += chunk;
    const record = { url: req.url, authorization: req.headers.authorization, body: JSON.parse(text) };
    records.push(record);
    handler(req, res, record);
  });
  const base = await listen(provider);
  t.after(() => close(provider));
  return { base, records };
}
async function application(t, base, overrides = {}) {
  const server = await createStaticServer({ aiEnv: { AI_BASE_URL: `${base}/v1`, AI_MODEL: 'mock-model:8b', ...overrides } });
  const url = await listen(server);
  t.after(() => close(server));
  return { server, url };
}
async function within(promise, timeout = 3000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Test event did not arrive.')), timeout); })]); }
  finally { clearTimeout(timer); }
}

test('AI environment pins localhost, rejects unsafe destinations and requires explicit remote HTTPS', () => {
  const defaults = loadAIConfig({});
  assert.equal(defaults.baseURL, 'http://127.0.0.1:11434/v1');
  assert.equal(defaults.model, 'llama3.1:8b');
  assert.equal(defaults.timeoutMs, 120000);
  assert.equal(loadAIConfig({ AI_BASE_URL: 'http://localhost:1234/v1/' }).baseURL, 'http://127.0.0.1:1234/v1');
  assert.equal(loadAIConfig({ AI_BASE_URL: 'http://[::1]:1234/v1' }).mode, 'local');
  for (const url of ['http://169.254.169.254/v1', 'https://remote.example/v1', 'file:///etc/passwd', 'http://user:secret@127.0.0.1/v1', 'http://127.0.0.1/v1?key=secret']) assert.throws(() => loadAIConfig({ AI_BASE_URL: url }));
  assert.throws(() => loadAIConfig({ AI_BASE_URL: 'http://remote.example/v1', AI_ALLOW_REMOTE: 'true' }));
  assert.equal(loadAIConfig({ AI_BASE_URL: 'https://remote.example/v1', AI_ALLOW_REMOTE: 'true' }).mode, 'remote');
  assert.throws(() => loadAIConfig({ AI_MODEL: 'model\nInjected' }));
  assert.throws(() => loadAIConfig({ AI_API_KEY: 'key\nInjected' }));
});

test('AI subprocess reads environment without exposing credentials and forwards only the bounded chat contract', async t => {
  const upstream = await mockProvider(t, (_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ model: 'mock-model:8b', choices: [{ message: { content: `{"question":"O que aconteceu?","secret":"${KEY}"}` } }] })); });
  const script = `import {createStaticServer} from ${JSON.stringify(new URL('../scripts/serve.mjs', import.meta.url).href)};const server=await createStaticServer();server.listen(0,'127.0.0.1',()=>console.log(server.address().port));`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, AI_BASE_URL: `${upstream.base}/v1`, AI_MODEL: 'mock-model:8b', AI_API_KEY: KEY, AI_ALLOW_REMOTE: 'false', AI_TIMEOUT_MS: '1000' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  t.after(async () => { if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await within(exited); } });
  let output = '';
  const port = await within(new Promise((done, reject) => {
    child.on('error', reject); child.on('exit', code => reject(Error(`Test server exited: ${code}`)));
    child.stdout.on('data', chunk => { output += chunk; const match = /^(\d+)\s*$/m.exec(output); if (match) done(Number(match[1])); });
  }));
  const base = `http://127.0.0.1:${port}`;
  const configResponse = await fetch(`${base}/api/ai/config`);
  const configText = await configResponse.text();
  assert.equal(configResponse.status, 200);
  assert.equal(upstream.records.length, 0, 'Config must not query or wake the provider.');
  assert.ok(!configText.includes(KEY));
  assert.deepEqual(JSON.parse(configText), { configured: true, provider: 'openai-compatible', mode: 'local', model: 'mock-model:8b', baseURL: `${upstream.base}/v1`, keyConfigured: true });
  const schema = { type: 'object', properties: { question: { type: 'string' } }, required: ['question'], additionalProperties: false };
  const response = await chat(base, { messages: [{ role: 'user', content: 'Pedido recebido.' }], schema });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.provider, 'openai-compatible');
  assert.equal(result.model, 'mock-model:8b');
  assert.ok(result.content.includes('O que aconteceu?'));
  assert.ok(!JSON.stringify(result).includes(KEY));
  assert.equal(upstream.records[0].authorization, `Bearer ${KEY}`);
  assert.equal(upstream.records[0].url, '/v1/chat/completions');
  assert.equal(upstream.records[0].body.stream, false);
  assert.deepEqual(upstream.records[0].body.response_format, { type: 'json_object' });
  assert.ok(upstream.records[0].body.messages[0].content.includes(JSON.stringify(schema)));
});

test('AI rejects cross-origin, file/null origins and host rebinding before contacting the provider', async t => {
  const upstream = await mockProvider(t, (_req, res) => res.end('{}'));
  const { url } = await application(t, upstream.base);
  for (const headers of [{ Origin: 'http://foreign.example' }, { Origin: 'null' }, { Host: 'foreign.example:8080' }, { Host: '127.0.0.1:1' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    // Native HTTP preserves malicious Host headers; fetch/Undici normalizes them.
    const response = await rawChat(url, headers);
    assert.equal(response.status, 403, JSON.stringify(headers));
    assert.ok((await response.json()).error.code.endsWith('forbidden'));
  }
  const options = await fetch(`${url}/api/ai/chat`, { method: 'OPTIONS', headers: { Origin: url } });
  assert.equal(options.status, 405);
  assert.equal(options.headers.get('access-control-allow-origin'), null);
  assert.equal(upstream.records.length, 0);
});

test('AI validates size, roles, models, JSON schema and rejects a browser-supplied upstream URL', async t => {
  const upstream = await mockProvider(t, (_req, res) => res.end('{}'));
  const { url } = await application(t, upstream.base);
  const invalid = [
    [{ messages: [] }, 400],
    [{ messages: Array.from({ length: 25 }, () => ({ role: 'user', content: 'x' })) }, 400],
    [{ messages: [{ role: 'tool', content: 'x' }] }, 400],
    [{ messages: [{ role: 'user', content: 'x'.repeat(100001) }] }, 400],
    [{ messages: [{ role: 'user', content: 'x' }], model: 'bad\nmodel' }, 400],
    [{ messages: [{ role: 'user', content: 'x' }], baseURL: 'http://169.254.169.254/v1' }, 400],
    [{ messages: [{ role: 'user', content: 'x' }], schema: JSON.parse('{"__proto__":{"unsafe":true}}') }, 400],
    [{ messages: [{ role: 'user', content: 'x' }], schema: { description: 'á'.repeat(17000) } }, 400],
    [{ messages: [{ role: 'user', content: 'x'.repeat(300000) }] }, 413]
  ];
  for (const [body, status] of invalid) { const response = await chat(url, body); assert.equal(response.status, status); await response.text(); }
  const text = await fetch(`${url}/api/ai/chat`, { method: 'POST', headers: { Origin: url, 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(text.status, 415);
  const malformed = await fetch(`${url}/api/ai/chat`, { method: 'POST', headers: { Origin: url, 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  const chunked = await new Promise((done, reject) => {
    const req = request(`${url}/api/ai/chat`, { method: 'POST', headers: { Origin: url, 'Content-Type': 'application/json' } }, res => { res.resume(); res.on('end', () => done(res.statusCode)); });
    req.on('error', reject); req.write('x'.repeat(130000)); req.write('x'.repeat(130000)); req.end();
  });
  assert.equal(chunked, 413, 'Chunked uploads cannot bypass body limits.');
  assert.equal(upstream.records.length, 0);
});

test('AI reports unavailable model and provider errors without echoing secrets or following redirects', async t => {
  let scenario = 'missing';
  const redirected = await mockProvider(t, (_req, res) => res.end('{}'));
  const upstream = await mockProvider(t, (_req, res) => {
    if (scenario === 'missing') { res.writeHead(404); res.end(`missing ${KEY}`); }
    if (scenario === 'auth') { res.writeHead(401); res.end(`invalid ${KEY}`); }
    if (scenario === 'redirect') { res.writeHead(302, { Location: `${redirected.base}/v1/chat/completions` }); res.end(); }
    if (scenario === 'invalid') res.end('{');
    if (scenario === 'big') res.end('x'.repeat(1000001));
  });
  const { url } = await application(t, upstream.base, { AI_API_KEY: KEY });
  for (const [mode, code] of [['missing', 'model_unavailable'], ['auth', 'provider_auth'], ['redirect', 'provider_error'], ['invalid', 'invalid_response'], ['big', 'response_too_large']]) {
    scenario = mode; const response = await chat(url); const text = await response.text();
    assert.equal(response.status, 502); assert.equal(JSON.parse(text).error.code, code); assert.ok(!text.includes(KEY));
    if (mode === 'missing') assert.ok(text.includes('AI_MODEL'));
  }
  assert.equal(redirected.records.length, 0);
});

test('AI aborts a slow provider on timeout and when the browser cancels the request', async t => {
  let started = deferred(), disconnected = deferred();
  const upstream = await mockProvider(t, (_req, res) => { res.on('close', () => { if (!res.writableFinished) disconnected.resolve(); }); started.resolve(); });
  const { url } = await application(t, upstream.base, { AI_TIMEOUT_MS: '50' });
  const timed = await chat(url);
  assert.equal(timed.status, 504); assert.equal((await timed.json()).error.code, 'provider_timeout');
  await within(disconnected.promise);
  started = deferred(); disconnected = deferred();
  const { url: cancellationURL } = await application(t, upstream.base, { AI_TIMEOUT_MS: '1000' });
  const req = request(`${cancellationURL}/api/ai/chat`, { method: 'POST', headers: { Origin: cancellationURL, 'Content-Type': 'application/json' } });
  req.on('error', () => {}); req.end(JSON.stringify({ messages: [{ role: 'user', content: 'Continuar?' }] }));
  await within(started.promise); req.destroy(); await within(disconnected.promise);
});

test('AI bounds concurrent inference and releases capacity after requests complete', async t => {
  const started = deferred(), held = []; let released = false;
  const respond = res => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: 'Resposta local simulada.' } }] })); };
  const upstream = await mockProvider(t, (_req, res) => {
    if (released) { respond(res); return; }
    held.push(res); if (held.length === 4) started.resolve();
  });
  const { url } = await application(t, upstream.base, { AI_TIMEOUT_MS: '2000' });
  const pending = Array.from({ length: 4 }, () => chat(url));
  for (const promise of pending) promise.catch(() => {});
  await within(started.promise);
  const fifth = await chat(url);
  assert.equal(fifth.status, 429); assert.equal((await fifth.json()).error.code, 'busy');
  assert.equal(upstream.records.length, 4);
  released = true; held.forEach(respond);
  for (const response of await Promise.all(pending)) { assert.equal(response.status, 200); await response.text(); }
  const next = await chat(url); assert.equal(next.status, 200); await next.text();
  assert.equal(upstream.records.length, 5);
});

test('invalid AI configuration leaves the static application available and exposes only a safe status', async t => {
  const server = await createStaticServer({ aiEnv: { AI_BASE_URL: 'http://169.254.169.254/v1', AI_API_KEY: KEY } });
  const url = await listen(server); t.after(() => close(server));
  assert.equal((await fetch(`${url}/`)).status, 200);
  const response = await fetch(`${url}/api/ai/config`); const text = await response.text();
  assert.equal(response.status, 200); assert.equal(JSON.parse(text).configured, false); assert.ok(!text.includes(KEY));
  const rejected = await chat(url); assert.equal(rejected.status, 503);
});
