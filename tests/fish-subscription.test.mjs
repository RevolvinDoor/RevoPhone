import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {FishOAuth, FISH_MCP} from '../core/fish-oauth.js';
import {FishMCP, MCP_MODEL, rpcResponse, speechArguments} from '../core/fish-mcp.js';
import {Providers, buildRequest} from '../core/providers.js';
import {TTSParameters} from '../core/parameters.js';
import {requestHash} from '../core/cache.js';
import {TTSBackend} from '../core/backend.js';
import {freshState} from '../core/state.js';
import {enginesApp} from '../ui/engines.js';
import {DialoguePlayer} from '../core/player.js';

class RecordStore {
  value = null;
  queue = Promise.resolve();
  async read() { return structuredClone(this.value); }
  async write(value) { this.value = structuredClone(value); }
  change(update) { const job = this.queue.then(() => {this.value = structuredClone(update(this.value));}); this.queue = job.catch(() => {}); return job; }
  close() {}
}
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json', ...headers}});
const deferred = () => {let resolve; const promise = new Promise(r => resolve = r); return {promise, resolve};};
const tokens = {access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'Bearer', expires_in: 3600};
const metadata = {issuer: 'https://api.fish.audio', authorization_endpoint: 'https://fish.audio/oauth/authorize',
  token_endpoint: 'https://api.fish.audio/oauth/token', registration_endpoint: 'https://api.fish.audio/oauth/register',
  grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256']};
function loginFixture(options = {}) {
  const store = new RecordStore(), requests = [], listeners = new Map();
  const popup = {location: {replace(url) {popup.url = url;}}, close() {popup.closed = true;}};
  const win = {open: () => popup, addEventListener: (n, fn) => listeners.set(n, fn), removeEventListener: n => listeners.delete(n)};
  const oauth = new FishOAuth({scope: 'test', store, win, locks: null, redirectUri: 'http://localhost:8000/ext/fish-oauth.html',
    async fetcher(url, init = {}) {
      requests.push({url, ...init});
      if (url.includes('oauth-protected-resource')) return json({resource: FISH_MCP, authorization_servers: ['https://api.fish.audio']});
      if (url.includes('oauth-authorization-server')) return json(metadata);
      if (url.endsWith('/register')) return json({client_id: 'test-client'});
      if (url.endsWith('/token')) return options.token ? options.token(init) : json(tokens);
      throw Error('Unexpected request: ' + url);
    }});
  return {oauth, requests, store, popup, listeners};
}
test('OAuth uses S256 PKCE, validates callback state/source and keeps credentials out of status', async t => {
  const f = loginFixture(); t.after(() => f.oauth.close());
  await f.oauth.open(); await f.oauth.beginLogin();
  const auth = new URL(f.popup.url), callback = new URL(f.oauth.status().redirectUri);
  assert.equal(auth.searchParams.get('resource'), FISH_MCP);
  callback.searchParams.set('code', 'test-code'); callback.searchParams.set('state', 'wrong');
  await assert.rejects(f.oauth.finishLogin(callback.href), /校验不符/);
  assert.equal(f.requests.filter(r => r.url.endsWith('/token')).length, 0);
  callback.searchParams.set('state', auth.searchParams.get('state'));
  f.listeners.get('message')({origin: callback.origin, source: {}, data: {type: 'revophone-fish-oauth', url: callback.href}});
  assert.equal(f.requests.filter(r => r.url.endsWith('/token')).length, 0);
  await f.oauth.finishLogin(callback.href);
  const request = f.requests.find(r => r.url.endsWith('/token')), form = new URLSearchParams(request.body);
  assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'), auth.searchParams.get('code_challenge'));
  assert.equal(form.get('grant_type'), 'authorization_code'); assert.equal(form.get('resource'), FISH_MCP);
  assert.equal(f.store.value.refresh_token, tokens.refresh_token);
  assert.equal(f.oauth.status().configured, true); assert.equal(f.oauth.status().pending, false);
  assert.doesNotMatch(JSON.stringify(f.oauth.status()), /test-access-token|test-refresh-token|test-code/);
  assert.equal(f.listeners.size, 0); assert.equal(f.popup.closed, true);
});

test('Concurrent token refresh rotates once; disconnect during refresh cannot restore login', async t => {
  const gate = deferred(), started = deferred(); let count = 0;
  const f = loginFixture({token: async () => { count++; started.resolve(); await gate.promise; return json({...tokens, access_token: 'rotated'}); }});
  t.after(() => f.oauth.close());
  await f.store.write({...tokens, clientId: 'test-client', account: 'a', expiresAt: 1}); await f.oauth.open();
  const one = f.oauth.token(), two = f.oauth.token();
  await started.promise; assert.equal(count, 1);
  gate.resolve(); assert.deepEqual(await Promise.all([one, two]), ['rotated', 'rotated']);
  f.store.value.expiresAt = 1; f.oauth.record.expiresAt = 1;
  const again = f.oauth.token(), disconnect = f.oauth.disconnect();
  await assert.rejects(again, {name: 'AbortError'}); await disconnect;
  assert.equal(f.oauth.configured, false); assert.equal(f.store.value, null);
});

test('TauriTavern opens the prepared authorization URL externally without creating a blank popup', async t => {
  const f = loginFixture(), opened = [], gate = deferred(); t.after(() => f.oauth.close());
  f.oauth.win.__TAURITAVERN__ = {};
  f.oauth.win.open = (...args) => {opened.push(args); if (args[0] === 'about:blank') throw Error('blank native window'); return null;};
  const metadata = f.oauth.metadata.bind(f.oauth);
  f.oauth.metadata = async () => {await gate.promise; return metadata();};
  const login = f.oauth.beginLogin();
  assert.equal(f.oauth.status().preparing, true); assert.equal(opened.length, 0);
  await f.oauth.beginLogin(); // Repeated clicks while preparing must not create a second registration/window.
  gate.resolve(); await login;
  assert.equal(opened.length, 1);
  assert.equal(new URL(opened[0][0]).origin, 'https://fish.audio');
  assert.deepEqual(opened[0].slice(1), ['_blank', 'noopener']);
  assert.equal(f.oauth.status().pending, true); assert.equal(f.oauth.status().preparing, false);
  assert.equal(f.listeners.size, 0);
  const registration = JSON.parse(f.requests.find(r => r.url.endsWith('/register')).body);
  const redirect = new URL(registration.redirect_uris[0]), authorize = new URL(opened[0][0]);
  assert.equal(redirect.hostname, '127.0.0.1'); assert.equal(redirect.protocol, 'http:');
  assert.ok(Number(redirect.port) >= 49152 && Number(redirect.port) <= 65535);
  assert.equal(authorize.searchParams.get('redirect_uri'), redirect.href);
  redirect.searchParams.set('code', 'test-code'); redirect.searchParams.set('state', authorize.searchParams.get('state'));
  await f.oauth.finishLogin(redirect.href);
  const form = new URLSearchParams(f.requests.find(r => r.url.endsWith('/token')).body);
  assert.equal(form.get('redirect_uri'), registration.redirect_uris[0]);
  assert.equal(f.oauth.configured, true);
});

test('Invalid refresh authorization is cleared and never falls back to an API key', async t => {
  const f = loginFixture({token: () => json({error: 'invalid_grant'}, 400)}); t.after(() => f.oauth.close());
  await f.store.write({...tokens, clientId: 'client', account: 'a', expiresAt: 1}); await f.oauth.open();
  await assert.rejects(f.oauth.token(), /invalid_grant/);
  assert.equal(f.oauth.configured, false); assert.equal(f.store.value, null);
});

// These schemas model protocol behavior; they are fixtures, not a claim about Fish's authenticated schema.
const speech = {name: 'text_to_speech', inputSchema: {type: 'object', properties: {
  text: {type: 'string'}, voice_id: {type: 'string'}, model: {type: 'string', enum: ['s2.1-pro']},
  format: {type: 'string', enum: ['mp3', 'wav']}}, required: ['text', 'voice_id']}};
function speechFixture({journal = new RecordStore(), download, paid, mergeAudio, host} = {}) {
  const requests = [], oauth = {scope: 'test', record: {account: 'account-a'}, configured: true,
    token: async () => 'oauth-access', close() {}};
  const client = new FishMCP(oauth, {journal, mergeAudio, host, async fetcher(url, init = {}) {
    requests.push({url, ...init});
    if (url !== FISH_MCP) return download ? download(url, init) : new Response(new Uint8Array([1, 2, 3]), {headers: {'Content-Type': 'audio/mpeg'}});
    const body = JSON.parse(init.body);
    if (!body.id) return new Response(null, {status: 202});
    let result;
    if (body.method === 'initialize') result = {protocolVersion: '2025-11-25', capabilities: {tools: {}}};
    else if (body.method === 'tools/list') result = {tools: [speech, {name: 'get_credit_balance', inputSchema: {type: 'object', properties: {}}}]};
    else if (body.params.name === 'get_credit_balance') result = {structuredContent: {team: 'Fixture Team', remaining_credits: 12345}};
    else if (paid) return paid(body, init);
    else result = {structuredContent: {audio_url: 'https://audio.example/one.mp3'}};
    return json({jsonrpc: '2.0', id: body.id, result}, 200, body.method === 'initialize' ? {'Mcp-Session-Id': 'fixture-session'} : {});
  }});
  const connection = {access: 'subscription', model: MCP_MODEL, params: TTSParameters.defaults('fish'), mcpArguments: '{}'};
  const request = () => buildRequest('fish', connection, {voice: 'voice-a'}, {text: '[whispering] 你好', emotion: '1,0.7'}, new Map(), oauth.record.account);
  const calls = name => requests.filter(r => r.url === FISH_MCP && JSON.parse(r.body).params?.name === name);
  return {client, oauth, connection, request, calls, requests, journal};
}

test('Actual provider path uses MCP OAuth, preserves voice/text, downloads without forwarding auth, and reuses completed links', async t => {
  const f = speechFixture(); t.after(() => f.client.close());
  const providers = new Providers(); providers.fish = f.client; providers.setKey('fish', 'legacy-api-key');
  const audio = await providers.synthesize(f.request(), new AbortController().signal);
  assert.equal(audio.size, 3); assert.equal(f.calls('text_to_speech').length, 1);
  const args = JSON.parse(f.calls('text_to_speech')[0].body).params.arguments;
  assert.deepEqual(args, {text: '[whispering] 你好', voice_id: 'voice-a'});
  for (const r of f.requests.filter(r => r.url === FISH_MCP)) {
    assert.equal(r.headers.Authorization, 'Bearer oauth-access'); assert.equal(r.credentials, 'omit');
    if (JSON.parse(r.body).method !== 'initialize') assert.equal(r.headers['Mcp-Session-Id'], 'fixture-session');
  }
  const download = f.requests.find(r => r.url.startsWith('https://audio.example'));
  assert.equal(download.headers, undefined); assert.equal(download.credentials, 'omit');
  await providers.synthesize(f.request()); assert.equal(f.calls('text_to_speech').length, 1);
  const balance = await providers.balance('fish', f.connection);
  assert.equal(balance.kind, 'subscription'); assert.match(balance.summary, /Fixture Team|12345/);
  assert.equal(f.requests.some(r => /api-credit|compat\/v1/.test(r.url)), false);
  const state = freshState(); state.connections.fish = f.connection;
  const cached = new Map(), cache = {epoch: 0, get: async key => cached.get(key), put: async (key, blob) => cached.set(key, blob)};
  const player = new DialoguePlayer({settings: () => state, providers, cache, sink: {getVolume: () => 1, stop() {}}});
  const line = {text: 'queue line', emotion: '1,0.7'}, route = {name: 'Fixture', engine: 'fish', voice: 'voice-a'};
  const first = await player.make(line, route, state, new AbortController().signal);
  const second = await player.make(line, route, state, new AbortController().signal);
  assert.equal(first.fromCache, false); assert.equal(second.fromCache, true); assert.equal(first.key, second.key);
  assert.equal(f.calls('text_to_speech').length, 2);
});

test('Downloaded links survive a new client after failure; multi-clip results are all downloaded and merged', async t => {
  const journal = new RecordStore(); let downloads = 0;
  const paid = body => json({jsonrpc: '2.0', id: body.id, result: {structuredContent: {clips: [
    {audio_url: 'https://audio.example/one.mp3'}, {audio_url: 'https://audio.example/two.mp3'}]}}});
  const first = speechFixture({journal, paid, download: () => new Response('', {status: 503})}); t.after(() => first.client.close());
  await assert.rejects(first.client.synthesize(first.request()), /已生成/);
  const second = speechFixture({journal, paid, download: () => {downloads++; return new Response(new Uint8Array([downloads]));},
    mergeAudio: async clips => {assert.equal(clips.length, 2); return new Blob(await Promise.all(clips.map(c => c.arrayBuffer())));}});
  t.after(() => second.client.close());
  const audio = await second.client.synthesize(second.request());
  assert.equal(audio.size, 2); assert.equal(downloads, 2);
  assert.equal(first.calls('text_to_speech').length, 1); assert.equal(second.calls('text_to_speech').length, 0);
});

test('TauriTavern uses native MCP with transient authorization and keeps browser fetch for audio only', async t => {
  const native = [], host = {__TAURITAVERN__: {api: {mcp: {remote: {
    version: 1,
    async discover(connection) {native.push({connection}); return {protocolVersion: '2025-11-25', tools: [{...speech, nativeName: speech.name}]};},
    async call(input) {
      native.push(input);
      return {outcome: 'known_response', response: {kind: 'tool_result', isError: false, textBlocks: [], diagnostics: [],
        structuredJson: JSON.stringify({audio_url: 'https://audio.example/native.mp3'})}};
    }
  }}}}};
  const f = speechFixture({host}); t.after(() => f.client.close());
  const audio = await f.client.synthesize(f.request());
  assert.equal(audio.size, 3); assert.equal(native.length, 2);
  assert.equal(native[1].nativeName, 'text_to_speech');
  assert.equal(native[1].connection.headers.Authorization, 'Bearer oauth-access');
  assert.equal(native[1].connection.headers.Origin, undefined);
  assert.equal(native[1].connection.endpoint, FISH_MCP);
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].url, 'https://audio.example/native.mp3');
  assert.equal(f.requests[0].headers, undefined);
});

test('An old TauriTavern fails before sending instead of falling back to browser MCP', async t => {
  const f = speechFixture({host: {__TAURITAVERN__: {api: {mcp: {}}}}}); t.after(() => f.client.close());
  await assert.rejects(f.client.information(), error => error.code === 'HOST_MCP_REQUIRED');
  assert.equal(f.requests.length, 0);
});

test('Native unknown outcomes keep the paid journal blocked and are never retried', async t => {
  let called = 0;
  const f = speechFixture({host: {__TAURITAVERN__: {api: {mcp: {remote: {version: 1,
    async discover() {return {protocolVersion: '2025-11-25', tools: [{...speech, nativeName: speech.name}]};},
    async call() {called++; return {outcome: 'outcome_unknown', code: 'mcp.call_timeout', message: 'result unknown'};}
  }}}}}}); t.after(() => f.client.close());
  await assert.rejects(f.client.synthesize(f.request()), error => error.code === 'FISH_OUTCOME_UNKNOWN');
  await assert.rejects(f.client.synthesize(f.request()), /上次的生成结果未知/);
  assert.equal(called, 1); assert.equal(f.requests.length, 0);
});

test('Initialization 403 retains the official reason and stage without leaking OAuth credentials or retrying', async t => {
  const f = speechFixture(); t.after(() => f.client.close()); let attempts = 0;
  f.oauth.record.refresh_token = 'private-refresh';
  f.client.fetcher = async () => {
    attempts++;
    return json({jsonrpc: '2.0', error: {code: -32000, message: 'Invalid Origin header: http://tauri.localhost; Bearer oauth-access; refresh_token=private-refresh'}}, 403);
  };
  await assert.rejects(f.client.information(), error => {
    assert.equal(error.status, 403); assert.equal(error.mcpMethod, 'initialize');
    assert.match(error.message, /初始化.*HTTP 403.*initialize/);
    assert.match(error.serverMessage, /Invalid Origin header: http:\/\/tauri.localhost/);
    assert.doesNotMatch(JSON.stringify(error) + error.message, /oauth-access|private-refresh/);
    return true;
  });
  assert.equal(attempts, 1); assert.equal(f.calls('text_to_speech').length, 0);
});

test('Unknown paid outcome stays blocked across client recreation until explicit clearing', async t => {
  const journal = new RecordStore(), first = speechFixture({journal, paid: () => {throw Error('connection lost');}});
  t.after(() => first.client.close());
  await assert.rejects(first.client.synthesize(first.request()), e => e.code === 'FISH_OUTCOME_UNKNOWN');
  const second = speechFixture({journal}); t.after(() => second.client.close());
  await assert.rejects(second.client.synthesize(second.request()), /上次的生成结果未知/);
  assert.equal(second.calls('text_to_speech').length, 0);
  await second.client.clearUnknown(); await second.client.synthesize(second.request());
  assert.equal(second.calls('text_to_speech').length, 1);
});

test('Failure to persist a charge record stops before submitting any paid tool', async t => {
  const journal = new RecordStore(); journal.change = async () => {throw Error('storage full');};
  const f = speechFixture({journal}); t.after(() => f.client.close());
  await assert.rejects(f.client.synthesize(f.request()), /storage full/);
  assert.equal(f.calls('text_to_speech').length, 0);
});

test('An old API-balance response cannot populate the subscription account after a switch', async t => {
  const f = speechFixture(), providers = new Providers(); providers.fish = f.client;
  providers.setKey('fish', 'old-api-key');
  const gate = deferred(), started = deferred();
  providers.balance = async () => {started.resolve(); await gate.promise; return {kind: 'credit', credit: 50};};
  const backend = new TTSBackend({settings: freshState(), providers, indexedDB: null}); t.after(() => backend.close());
  const reading = backend.voiceBalance('fish', true); await started.promise;
  backend.saveConnection('fish', {access: 'subscription'}); gate.resolve();
  await assert.rejects(reading, /接入方式已变化/); assert.equal(backend.balances.has('fish'), false);
});

test('Concurrent windows claim a paid request atomically, and account changes before sending stop generation', async t => {
  const journal = new RecordStore(), gate = deferred(), sent = deferred();
  const first = speechFixture({journal, paid: async body => {sent.resolve(); await gate.promise; return json({id: body.id, result: {structuredContent: {audio_url: 'https://audio.example/one.mp3'}}});}});
  const second = speechFixture({journal}); t.after(() => {first.client.close(); second.client.close();});
  const generating = first.client.synthesize(first.request()); await sent.promise;
  await assert.rejects(second.client.synthesize(second.request()), /结果未知|另一个窗口/);
  assert.equal(second.calls('text_to_speech').length, 0); gate.resolve(); await generating;
  const old = second.request(); second.oauth.record.account = 'account-b';
  await assert.rejects(second.client.synthesize(old), /账户已变化/);
});

test('Schema validation stops unsupported models, extra overrides, and unknown requirements before any paid request', async t => {
  const f = speechFixture(); t.after(() => f.client.close());
  f.connection.model = 'drama-3'; await assert.rejects(f.client.synthesize(f.request()), /schema/);
  assert.equal(f.calls('text_to_speech').length, 0);
  const input = {text: 'hello', voice: 'a', model: MCP_MODEL, arguments: {text: 'replacement'}};
  assert.throws(() => speechArguments(speech, input), /不能在附加参数中覆盖/);
  const changed = structuredClone(speech); changed.inputSchema.properties.workspace = {type: 'string'}; changed.inputSchema.required.push('workspace');
  assert.throws(() => speechArguments(changed, {...input, arguments: {}}), /workspace/);
  assert.equal(speechArguments(changed, {...input, arguments: {workspace: 'test'}}).workspace, 'test');
});

test('SSE parser handles byte/chunk boundaries, notifications, multiple data lines, and a persistent connection', async () => {
  const source = ': keepalive\r\n\r\nevent: message\r\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\r\n\r\ndata: {"jsonrpc":"2.0",\r\ndata: "id":7,"result":{"text":"你好"}}\r\n\r\n';
  const bytes = new TextEncoder().encode(source); let at = 0, cancelled = false;
  const stream = new ReadableStream({pull(c) {if (at < bytes.length) c.enqueue(bytes.slice(at, ++at));}, cancel() {cancelled = true;}});
  const result = await rpcResponse(new Response(stream, {headers: {'Content-Type': 'text/event-stream'}}), 7);
  assert.equal(result.result.text, '你好'); assert.equal(cancelled, true);
});

test('Fish API and relay keep old cache identity; MCP and authorized accounts have distinct identities', async () => {
  const f = speechFixture(), connection = {...f.connection, access: 'api', model: 's2.1-pro'};
  const route = {voice: 'a'}, line = {text: 'hello', emotion: '1,0.7'};
  const api = buildRequest('fish', connection, route, line);
  const relay = buildRequest('fish', {...connection, relay: 'https://relay.example'}, route, line);
  assert.equal(await requestHash(api), await requestHash(relay));
  assert.notEqual(await requestHash(api), await requestHash(f.request()));
  assert.notEqual(await requestHash(f.request()), await requestHash({...f.request(), account: 'different-account'}));
  f.client.close();
});

test('Engine UI switches only Fish access, shows OAuth controls and credits, and never exports tokens as settings', async t => {
  const f = speechFixture(), providers = new Providers(); providers.fish = f.client;
  f.oauth.status = () => ({configured: true, pending: false});
  providers.setKey('fish', 'old-api-key');
  const backend = new TTSBackend({settings: freshState(), providers, indexedDB: null}); t.after(() => backend.close());
  const api = {...backend.api()}, listeners = new Map(); let html = '';
  // Keep this UI test local: no real endpoint and no host instance is opened.
  api.voiceBalance = async () => ({kind: 'subscription', summary: 'Fixture Team: 12345 credits'});
  const doc = {activeElement: null, addEventListener() {}, createElement: () => root};
  const root = {dataset: {}, ownerDocument: doc, scrollTop: 0, contains: () => true, querySelectorAll: () => [], querySelector: () => null,
    addEventListener(n, fn) {if (!listeners.has(n)) listeners.set(n, []); listeners.get(n).push(fn);},
    set innerHTML(value) {html = value;}, get innerHTML() {return html;}};
  const view = enginesApp({api, doc, win: {AbortController, setTimeout}, notify(message, opts) {if (opts?.error) throw Error(message);}});
  t.after(() => view.dispose()); view.edit('fish');
  const target = {dataset: {field: 'fish-access'}, value: 'subscription', closest: selector => selector === '[data-field]' ? target : null};
  for (const fn of listeners.get('change') || []) fn({target});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(backend.settings.connections.fish.access, 'subscription'); assert.equal(backend.settings.connections.fish.model, MCP_MODEL);
  assert.match(html, /重新授权|断开连接/); assert.match(html, /12345 credits/);
  assert.doesNotMatch(html, /data-field="key"|免费额度|API 余额<\/span>/);
  assert.equal(api.keyStatus('fish'), true);
  assert.doesNotMatch(JSON.stringify(api.getState()), /oauth-access|test-refresh-token/);
  api.saveConnection('fish', {access: 'api'});
  assert.equal(backend.settings.connections.fish.model, 's2.1-pro'); assert.equal(providers.currentKey('fish'), 'old-api-key');
});
