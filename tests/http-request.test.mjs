import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { newHTTPRequest, normalizeHTTPRequest, normalizeAIHTTP, normalizeHTTPWireRequest, buildHTTPRequest, extractHTTPResponse, executeHTTPWireRequest, executeHTTPRequest } from '../js/http-request.js';
import { newProject, validateProject, importProject } from '../js/domain.js';
import { LocalStore, VersionEngine, threeWayMerge, semanticDiff } from '../js/version-control.js';
import { createStaticServer } from '../scripts/serve.mjs';

const config = (preset = 'ollama') => newHTTPRequest(preset);
const variables = () => ({ messages: [{ role: 'system', content: 'Contrato' }, { role: 'user', content: 'Ação "confirmada"\n字 & café' }], schema: { type: 'object' }, message: 'A&B = café', prompt: 'Um relato', project: { name: 'Mapa de pedidos' } });
const library = request => ({ active_id: request.id, requests: [request] });
async function listen(server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return 'http://127.0.0.1:' + server.address().port; }
async function close(server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }

test('JSON templates keep messages, numeric parameters, objects and escaped Unicode in their native types', () => {
  const profile = config(), data = variables();
  profile.parameters.push({ name: 'metadata', value: '{"enabled":true,"count":3}', enabled: true, type: 'json' });
  profile.body = '{"model":"{{model}}","messages":"{{messages}}","temperature":"{{temperature}}","metadata":"{{metadata}}","label":"Projeto: {{project.name}}"}';
  const request = buildHTTPRequest(profile, data), body = JSON.parse(request.body);
  assert.deepEqual(body.messages, data.messages);
  assert.equal(body.temperature, 0.2);
  assert.deepEqual(body.metadata, { enabled: true, count: 3 });
  assert.equal(body.label, 'Projeto: Mapa de pedidos');
  assert.equal(request.headers['Content-Type'], 'application/json');
});

test('query fields encode values, preserve duplicates and ignore disabled rows; bearer credentials are configurable', () => {
  const profile = config();
  profile.url = 'http://127.0.0.1:1234/run?existing=1';
  profile.query = [{ name: 'q', value: '{{message}}', enabled: true }, { name: 'q', value: 'outra', enabled: true }, { name: 'ignored', value: 'secret', enabled: false }];
  profile.auth.type = 'bearer'; profile.parameters.find(row => row.name === 'apiKey').value = 'chave-ficticia';
  profile.headers.push({ name: 'X-Map', value: '{{project.name}}', enabled: true }, { name: 'X-Ignored', value: 'x', enabled: false });
  const request = buildHTTPRequest(profile, variables()), url = new URL(request.url);
  assert.deepEqual(url.searchParams.getAll('q'), ['A&B = café', 'outra']);
  assert.equal(url.searchParams.get('existing'), '1');
  assert.equal(url.searchParams.has('ignored'), false);
  assert.equal(request.headers.Authorization, 'Bearer chave-ficticia');
  assert.equal(request.headers['X-Map'], 'Mapa de pedidos');
  assert.equal(request.headers['X-Ignored'], undefined);
});

test('basic authentication encodes UTF-8 and header authentication supports arbitrary credential headers', () => {
  const profile = config();
  profile.auth = { type: 'basic', username: 'joão', password: 'café', token: '', header: 'X-Key' };
  let request = buildHTTPRequest(profile, variables());
  assert.equal(request.headers.Authorization, 'Basic ' + Buffer.from('joão:café').toString('base64'));
  profile.auth = { type: 'header', token: 'token-local', username: '', password: '', header: 'X-Key' };
  request = buildHTTPRequest(profile, variables());
  assert.equal(request.headers['X-Key'], 'token-local');
});

test('text, form URLencoded and no-body requests render appropriately; GET cannot silently send a body', () => {
  const profile = config(); profile.headers = [];
  profile.body_type = 'form'; profile.body = 'prompt={{message}}&name={{project.name}}&name=segundo';
  let request = buildHTTPRequest(profile, variables());
  const form = new URLSearchParams(request.body);
  assert.equal(form.get('prompt'), 'A&B = café'); assert.deepEqual(form.getAll('name'), ['Mapa de pedidos', 'segundo']);
  assert.equal([...form.keys()].length, 3); assert.equal(request.headers['Content-Type'], 'application/x-www-form-urlencoded');
  profile.body_type = 'text'; profile.body = 'Contexto: {{message}}';
  assert.equal(buildHTTPRequest(profile, variables()).body, 'Contexto: A&B = café');
  profile.method = 'GET'; assert.throws(() => buildHTTPRequest(profile, variables()), /não aceita corpo/);
  profile.body_type = 'none'; assert.equal(buildHTTPRequest(profile, variables()).body, null);
});

test('unknown variables, executable expressions, unsafe paths, CRLF and managed transport headers are rejected', () => {
  const profile = config();
  profile.body = '{"x":"{{missing}}"}'; assert.throws(() => buildHTTPRequest(profile, variables()), /não existe/);
  profile.body = '{"x":"{{project.constructor}}"}'; assert.throws(() => buildHTTPRequest(profile, variables()), /sem expressões/);
  profile.body = '{"x":"{{process.exit()}}"}'; assert.throws(() => buildHTTPRequest(profile, variables()), /sem expressões/);
  profile.body = '{}'; profile.headers = [{ name: 'Authorization', value: 'a\r\nX-Evil: yes', enabled: true }];
  assert.throws(() => buildHTTPRequest(profile, variables()), /Cabeçalho inválido/);
  profile.headers = [{ name: 'Host', value: 'another-host', enabled: true }]; assert.throws(() => buildHTTPRequest(profile, variables()), /gerenciado pelo transporte/);
  profile.url = 'file:///secret.txt'; assert.throws(() => normalizeHTTPRequest(profile), /HTTP\/HTTPS/);
  const reserved = config(); reserved.parameters.push({ name: 'messages', value: 'replace-system', enabled: true, type: 'text' });
  assert.throws(() => normalizeHTTPRequest(reserved), /reservado/);
});

test('response mapping handles arrays, root JSON and plain text while refusing a missing field', () => {
  const content = '{"reply":"Pergunte","question":"Quem decide?","summary":"","nodes":[],"edges":[],"removals":[]}';
  assert.equal(extractHTTPResponse({ body: JSON.stringify({ choices: [{ message: { content } }] }) }, 'choices[0].message.content'), content);
  assert.equal(extractHTTPResponse({ body: content }, ''), content);
  assert.equal(extractHTTPResponse({ body: 'texto sem JSON' }, ''), 'texto sem JSON');
  assert.throws(() => extractHTTPResponse({ body: '{}' }, 'choices[0].message.content'), /não existe/);
  assert.throws(() => extractHTTPResponse({ body: '{}' }, '__proto__.x'), /sem expressões/);
});

test('configuration stays portable with credentials, and old projects keep their original shape', () => {
  const old = newProject('Original'); assert.equal(Object.hasOwn(validateProject(old), 'ai_http'), false);
  const profile = config(); profile.auth.type = 'bearer'; profile.parameters.find(row => row.name === 'apiKey').value = 'token-gravado';
  old.ai_http = library(profile);
  const normalized = validateProject(JSON.parse(JSON.stringify(old)));
  assert.deepEqual(normalized.ai_http, normalizeAIHTTP(old.ai_http));
  const imported = importProject(normalized);
  assert.notEqual(imported.id, old.id); assert.deepEqual(imported.ai_http, normalized.ai_http);
  assert.equal(imported.ai_http.requests[0].parameters.find(row => row.name === 'apiKey').value, 'token-gravado');
  assert.throws(() => normalizeAIHTTP({ active_id: 'missing', requests: [profile] }), /ativa não existe/);
});

test('HTTP configuration participates in local versions, backups, restoration and semantic merge', async () => {
  const project = newProject('Versionado'), profile = config(), store = new LocalStore({ memory: true, name: crypto.randomUUID() });
  await store.open(); const engine = new VersionEngine(store, project.id); await engine.init(project);
  const original = engine.state.localHead;
  profile.parameters.find(row => row.name === 'apiKey').value = 'token-de-teste';
  project.ai_http = library(profile); await engine.updateWorkingCopy(project); await engine.saveVersion('Configuração HTTP');
  const configured = engine.state.localHead, bundle = await engine.exportBundle();
  assert.equal(bundle.state.workingCopy.ai_http.requests[0].parameters[1].value, 'token-de-teste');
  const targetStore = new LocalStore({ memory: true, name: crypto.randomUUID() }); await targetStore.open();
  const target = new VersionEngine(targetStore, project.id); const seed = structuredClone(project); delete seed.ai_http; await target.init(seed);
  await target.importBundle(bundle); assert.equal(target.state.workingCopy.ai_http.active_id, profile.id);
  await engine.restore(original); assert.equal(Object.hasOwn(engine.state.workingCopy, 'ai_http'), false);
  await engine.restore(configured); assert.equal(engine.state.workingCopy.ai_http.requests[0].parameters[1].value, 'token-de-teste');
  const local = structuredClone(project), remote = structuredClone(project);
  local.ai_http.requests[0].url = 'http://127.0.0.1:1111/a'; remote.ai_http.requests[0].name = 'Outro nome';
  assert.ok(semanticDiff(project, local).some(change => change.path.includes('ai_http')));
  const merged = threeWayMerge(project, local, remote); assert.equal(merged.conflicts.length, 0);
  assert.equal(merged.value.ai_http.requests[0].url, local.ai_http.requests[0].url);
  assert.equal(merged.value.ai_http.requests[0].name, 'Outro nome');
  remote.ai_http.requests[0].url = 'http://127.0.0.1:2222/b'; assert.ok(threeWayMerge(project, local, remote).conflicts.length);
});

test('byte limits account for Unicode in request bodies and complete portable libraries', () => {
  assert.throws(() => normalizeHTTPWireRequest({ url: 'http://127.0.0.1/', method: 'POST', headers: {}, body: '界'.repeat(260000), timeout_ms: 1000 }), /750 KB/);
  const requests = Array.from({ length: 15 }, () => { const r = config(); r.body = JSON.stringify({ context: '界'.repeat(24000) }); return r; });
  assert.throws(() => normalizeAIHTTP({ active_id: requests[0].id, requests }), /900 KB/);
});

test('direct transport exposes HTTP errors and cancels a stalled request or an oversized response', async () => {
  const request = { url: 'http://127.0.0.1/', method: 'GET', headers: {}, body: null, timeout_ms: 50 };
  const response = await executeHTTPWireRequest(request, { fetchImpl: async () => new Response('{"error":"bad"}', { status: 422, headers: { 'X-Test': 'yes' } }) });
  assert.equal(response.status, 422); assert.equal(response.body, '{"error":"bad"}'); assert.equal(response.headers['x-test'], 'yes');
  const stalled = (_url, { signal }) => new Promise((_resolve, reject) => { if (signal.aborted) reject(new Error('aborted')); else signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); });
  await assert.rejects(executeHTTPWireRequest(request, { fetchImpl: stalled }), error => error.code === 'http_timeout');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(executeHTTPWireRequest(request, { signal: controller.signal, fetchImpl: stalled }), error => error.code === 'http_cancelled');
  let outboundSignal;
  await assert.rejects(executeHTTPWireRequest(request, { fetchImpl: async (_url, options) => { outboundSignal = options.signal; return new Response('x', { headers: { 'Content-Length': '1000001' } }); } }), /excede 1 MB/);
  assert.equal(outboundSignal.aborted, true);
});

test('native HTTP bridge forwards configurable requests even without environment configuration and retains provider status/body', async () => {
  let received;
  const upstream = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    received = { url: request.url, method: request.method, headers: request.headers, body: Buffer.concat(chunks).toString('utf8') };
    response.writeHead(201, { 'Content-Type': 'application/json', 'X-Provider': 'fixture' }); response.end(JSON.stringify({ output: 'resposta-controlada' }));
  });
  const upstreamURL = await listen(upstream), server = await createStaticServer({ aiEnv: { AI_BASE_URL: 'invalid' } }), appURL = await listen(server);
  try {
    const profile = config('custom'); profile.url = upstreamURL + '/run'; profile.response_path = 'output'; profile.auth.type = 'bearer'; profile.parameters[1].value = 'token-ficticio'; profile.query = [{ name: 'q', value: '{{message}}', enabled: true }];
    const result = await executeHTTPRequest(profile, variables(), { bridgeURL: appURL + '/api/ai/http' });
    assert.equal(result.status, 201); assert.equal(result.headers['x-provider'], 'fixture');
    assert.equal(extractHTTPResponse(result, profile.response_path), 'resposta-controlada');
    assert.equal(received.method, 'POST'); assert.equal(received.headers.authorization, 'Bearer token-ficticio');
    assert.equal(new URL(received.url, upstreamURL).searchParams.get('q'), variables().message);
    assert.deepEqual(JSON.parse(received.body).messages, variables().messages);
    assert.deepEqual(JSON.parse(received.body).schema, variables().schema);
  } finally { await close(server); await close(upstream); }
});

test('bridge rejects cross-origin callers, invalid URLs and payloads; redirects retain status without forwarding credentials', async () => {
  let redirected = 0;
  const target = createServer((_request, response) => { redirected++; response.end('should not run'); }), targetURL = await listen(target);
  const upstream = createServer((_request, response) => { response.writeHead(307, { Location: targetURL }); response.end('redirect'); }), upstreamURL = await listen(upstream);
  const server = await createStaticServer(), appURL = await listen(server);
  const wire = { url: upstreamURL, method: 'GET', headers: { Authorization: 'Bearer sample' }, body: null, timeout_ms: 1000 };
  try {
    const send = (body, origin) => fetch(appURL + '/api/ai/http', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
    assert.equal((await send({ request: wire }, 'https://foreign.example')).status, 403);
    assert.equal((await send({ request: { ...wire, url: 'file:///anything' } })).status, 400);
    assert.equal((await send({ request: wire, extra: true })).status, 400);
    const result = await (await send({ request: wire })).json();
    assert.equal(result.status, 307); assert.equal(result.body, 'redirect'); assert.equal(redirected, 0);
    assert.equal((await fetch(appURL + '/api/ai/http')).status, 405);
  } finally { await close(server); await close(upstream); await close(target); }
});
