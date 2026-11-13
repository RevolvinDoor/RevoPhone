import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {FishOAuth, FISH_MCP} from '../core/fish-oauth.js';
import {FishMCP, MCP_MODEL, rpcResponse, speechArguments, creditResult} from '../core/fish-mcp.js';
import {Providers, buildRequest} from '../core/providers.js';
import {TTSParameters} from '../core/parameters.js';
import {requestHash} from '../core/cache.js';
import {TTSBackend} from '../core/backend.js';
import {freshState, normalizeSettings} from '../core/state.js';
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
  await f.store.write({...tokens, clientId: 'test-client', account: 'a', expiresAt: 1, nativeRegistrationId: 'existing-fish'}); await f.oauth.open();
  const one = f.oauth.token(), two = f.oauth.token();
  await started.promise; assert.equal(count, 1);
  gate.resolve(); assert.deepEqual(await Promise.all([one, two]), ['rotated', 'rotated']);
  assert.equal(f.store.value.nativeRegistrationId, 'existing-fish');
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

// Sanitized shape from the user's authenticated get_credit_balance result.
const packageCredits = {api_credit_usd: '0.257780', package_balance: 178128,
  package_extra_balance: 1000, package_cycle_ends_at: '2026-11-30T11:52:12+00:00',
  team_name: 'Fixture Team', plan: 'plus', tts_max_text_bytes_per_call: 15000};
test('Fish account credits read package fields from structured or text results without using API USD or text limits', () => {
  for (const result of [
    {structuredContent: packageCredits, content: [{type: 'text', text: JSON.stringify(packageCredits)}]},
    {content: [{type: 'text', text: JSON.stringify(packageCredits)}]},
    {structuredContent: {status: 'ok'}, content: [{type: 'text', text: JSON.stringify({...packageCredits, package_balance: '178,128'})}]}
  ]) {
    const b = creditResult(result);
    assert.equal(b.left, 178128); assert.equal(b.extra, 1000);
    assert.equal(b.team, 'Fixture Team'); assert.equal(b.plan, 'plus');
    assert.equal(b.resetAt, Date.parse(packageCredits.package_cycle_ends_at));
  }
  const zero = creditResult({structuredContent: {...packageCredits, package_balance: 0, package_extra_balance: '0'}});
  assert.equal(zero.left, 0); assert.equal(zero.extra, 0);
  for (const value of [null, '', ' ', false, 'unknown']) {
    const b = creditResult({structuredContent: {...packageCredits, package_balance: value}});
    assert.equal(b.left, null); assert.match(b.summary, /package_balance/);
  }
  assert.equal(creditResult({structuredContent: {api_credit_usd: '25', tts_max_text_bytes_per_call: 15000}}).left, null);
});

// These schemas model protocol behavior; they are fixtures, not a claim about Fish's authenticated schema.
const speech = {name: 'text_to_speech', inputSchema: {type: 'object', properties: {
  text: {type: 'string'}, voice_id: {type: 'string'}, model: {type: 'string', enum: ['s2.1-pro']},
  format: {type: 'string', enum: ['mp3', 'wav']}}, required: ['text', 'voice_id']}};
function speechFixture({journal = new RecordStore(), download, paid, mergeAudio, host} = {}) {
  const store = new RecordStore(); store.value = {account: 'account-a'};
  const requests = [], oauth = {scope: 'test', record: {account: 'account-a'}, store, configured: true,
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

function managerFixture(call, stage) {
  const exa = {id: 'exa', displayName: 'Exa Search', endpoint: 'https://mcp.exa.ai/mcp', headers: {}, state: 'paused', toolPermissions: {}, protocolVersion: 'auto'};
  const rows = new Map([['exa', structuredClone(exa)]]), calls = [], updates = []; let created = 0;
  const get = id => {const row = rows.get(id); if (!row) throw Error('missing registration'); return row;};
  const api = {servers: {
    async list() {return {servers: structuredClone([...rows.values()]), storageIssues: []};},
    async create(input) {const row = {id: 'fish-' + ++created, state: 'paused', toolPermissions: {}, ...structuredClone(input)}; rows.set(row.id, row); return structuredClone(row);},
    async update(input) {updates.push(structuredClone(input)); const row = get(input.registrationId); Object.assign(row, {displayName: input.displayName, endpoint: input.endpoint, headers: structuredClone(input.headers), protocolVersion: input.protocolVersion}); return structuredClone(row);},
    async remove(input) {rows.delete(input.registrationId);},
    async setState(input) {const row = get(input.registrationId); row.state = input.state; return structuredClone(row);},
    async discover(input) {const row = get(input.registrationId); if (row.state !== 'active') throw Error('paused'); return {protocolVersion: '2025-11-25', tools: [speech, {name: 'get_credit_balance', inputSchema: {type: 'object', properties: {}}}, {name: 'search_voices', inputSchema: {type: 'object', properties: {}}}].map(tool => ({...tool, nativeName: tool.name, permission: row.toolPermissions[tool.name] || 'off'}))};},
    async refresh(input) {return this.discover(input);}
  }, tools: {
    async setPermission(input) {const row = get(input.registrationId); row.toolPermissions[input.nativeName] = input.permission; return structuredClone(row);},
    async testCall(input) {calls.push({...structuredClone(input), server: structuredClone(get(input.registrationId))}); return call ? call(input) : {outcome: 'known_response', response: {kind: 'tool_result', isError: false, textBlocks: [], diagnostics: [], structuredJson: JSON.stringify(input.nativeName === 'get_credit_balance' ? {remaining_credits: 12, team: 'Fixture'} : {audio_url: 'https://audio.example/native.mp3'})}};}
  }};
  const transfers = [], path = 'C:\\Cache\\tauritavern-staging\\remote\\fixture.bin';
  const core = {
    async invoke(command, args) {
      transfers.push({command, args: structuredClone(args)});
      if (command === 'stage_file_from_url') return stage ? stage(args) : {file_path: path, mime_type: 'audio/mpeg'};
      if (command !== 'stage_file_discard') throw Error('unexpected native command');
    },
    convertFileSrc(value) {assert.equal(value, path); return 'http://asset.localhost/fixture.bin';}
  };
  return {host: {__TAURITAVERN__: {api: {mcp: api}}, __TAURI__: {core}}, api, rows, calls, updates, transfers, path, exa, created: () => created};
}

test('Existing TT MCP Manager registers Fish once, executes natively, and pauses/clears authorization on disconnect', async t => {
  const manager = managerFixture(), f = speechFixture({host: manager.host}); t.after(() => f.client.close());
  await f.client.native.connect(); await f.client.native.connect();
  assert.equal(manager.created(), 1);
  const audio = await f.client.synthesize(f.request());
  assert.equal(audio.size, 3); assert.equal(manager.calls.length, 1);
  assert.equal(manager.calls[0].nativeName, 'text_to_speech');
  assert.equal(manager.calls[0].server.headers.Authorization, 'Bearer oauth-access');
  assert.equal(manager.calls[0].server.headers.Origin, undefined);
  assert.equal(manager.calls[0].server.endpoint, FISH_MCP);
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].url, 'http://asset.localhost/fixture.bin');
  assert.equal(f.requests[0].headers, undefined);
  assert.equal(audio.type, 'audio/mpeg');
  assert.deepEqual(manager.transfers, [
    {command: 'stage_file_from_url', args: {url: 'https://audio.example/native.mp3'}},
    {command: 'stage_file_discard', args: {filePath: manager.path}}
  ]);
  const balance = await f.client.balance(); assert.equal(balance.kind, 'subscription'); assert.equal(balance.left, 12);
  await f.client.native.disconnect();
  assert.equal(manager.rows.get('fish-1').state, 'paused');
  assert.equal(manager.rows.get('fish-1').headers.Authorization, undefined);
  assert.deepEqual(manager.rows.get('exa'), manager.exa);
});

test('Native download failure retries saved links after reload without another paid call', async t => {
  const manager = managerFixture(), journal = new RecordStore();
  const first = speechFixture({host: manager.host, journal, download: () => {throw TypeError('Failed to fetch local audio');}});
  t.after(() => first.client.close());
  await first.client.native.connect();
  await assert.rejects(first.client.synthesize(first.request()), /已生成.*TT 原生音频下载或读取失败/);
  assert.equal(manager.transfers.at(-1).command, 'stage_file_discard');
  const second = speechFixture({host: manager.host, journal}); t.after(() => second.client.close());
  second.oauth.record.nativeRegistrationId = first.oauth.record.nativeRegistrationId;
  const audio = await second.client.synthesize(second.request());
  assert.equal(audio.size, 3); assert.equal(manager.calls.length, 1);
  assert.equal(manager.transfers.filter(r => r.command === 'stage_file_from_url').length, 2);
  assert.equal(manager.transfers.filter(r => r.command === 'stage_file_discard').length, 2);
  assert.equal(second.requests.every(r => r.url === 'http://asset.localhost/fixture.bin'), true);
});

test('Stopping during native staging removes the eventual file without reading or regenerating', async t => {
  let complete, started;
  const waiting = new Promise(resolve => {started = resolve;});
  const manager = managerFixture(undefined, () => {started(); return new Promise(resolve => {complete = resolve;});});
  const f = speechFixture({host: manager.host}); t.after(() => f.client.close());
  await f.client.native.connect();
  const abort = new AbortController(), playing = f.client.synthesize(f.request(), abort.signal);
  const rejected = assert.rejects(playing, error => error.name === 'AbortError');
  await waiting; abort.abort(); complete({file_path: manager.path, mime_type: 'audio/mpeg'});
  await rejected;
  assert.equal(f.requests.length, 0); assert.equal(manager.calls.length, 1);
  assert.equal(manager.transfers.at(-1).command, 'stage_file_discard');
  assert.equal((await f.client.jobs()).values().next().value.links.length, 1);
});

test('Native staging failure preserves links, redacts signed URLs, and never uses browser CDN fetch', async t => {
  const manager = managerFixture(undefined, () => {throw Error('download failed https://audio.example/a?signature=private');});
  const f = speechFixture({host: manager.host}); t.after(() => f.client.close());
  await f.client.native.connect();
  for (let i = 0; i < 2; i++) await assert.rejects(f.client.synthesize(f.request()), error => /已生成.*TT 原生音频下载/.test(error.message) && !error.message.includes('private'));
  assert.equal(manager.calls.length, 1); assert.equal(f.requests.length, 0);
  assert.equal(manager.transfers.length, 2);
});

test('An old TauriTavern fails before sending instead of falling back to browser MCP', async t => {
  const f = speechFixture({host: {__TAURITAVERN__: {api: {mcp: {}}}}}); t.after(() => f.client.close());
  await assert.rejects(f.client.information(), error => error.code === 'HOST_MCP_REQUIRED');
  assert.equal(f.requests.length, 0);
});

test('Native unknown outcomes keep the paid journal blocked and are never retried', async t => {
  const manager = managerFixture(() => ({outcome: 'outcome_unknown', code: 'mcp.call_timeout', message: 'result unknown'}));
  const f = speechFixture({host: manager.host}); t.after(() => f.client.close());
  await f.client.native.connect();
  await assert.rejects(f.client.synthesize(f.request()), error => error.code === 'FISH_OUTCOME_UNKNOWN');
  await assert.rejects(f.client.synthesize(f.request()), /上次的生成结果未知/);
  assert.equal(manager.calls.length, 1); assert.equal(f.requests.length, 0);
});

test('RevoPhone respects TT tool Off, paused services, and endpoint edits before native testCall', async t => {
  const manager = managerFixture(), f = speechFixture({host: manager.host}); t.after(() => f.client.close());
  await f.client.native.connect();
  await manager.api.tools.setPermission({registrationId: 'fish-1', nativeName: 'text_to_speech', permission: 'off'});
  await assert.rejects(f.client.synthesize(f.request()), error => error.code === 'HOST_MCP_TOOL_OFF');
  assert.equal(manager.calls.length, 0);
  await manager.api.servers.setState({registrationId: 'fish-1', state: 'paused'});
  await assert.rejects(f.client.synthesize(f.request()), error => error.code === 'HOST_MCP_PAUSED');
  assert.equal(manager.rows.get('fish-1').state, 'paused');
  const edited = manager.rows.get('fish-1'); edited.state = 'active'; edited.endpoint = 'https://other.example/mcp';
  const updates = manager.updates.length;
  await assert.rejects(f.client.information(true), error => error.code === 'HOST_MCP_ENDPOINT_CHANGED');
  assert.equal(manager.updates.length, updates); assert.equal(manager.calls.length, 0);
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
  const nonDefaultProsody = buildRequest('fish', {...f.connection, model: MCP_MODEL}, {voice: 'voice-a'}, {text: '[whispering] 你好', emotion: '0.9,0.8'}, new Map(), f.oauth.record.account);
  assert.deepEqual(speechArguments(speech, nonDefaultProsody.body), {text: '[whispering] 你好', voice_id: 'voice-a'});
  const withProsodySchema = structuredClone(speech);
  withProsodySchema.inputSchema.properties.speed = {type: 'number', minimum: 0.5, maximum: 2};
  withProsodySchema.inputSchema.properties.temperature = {type: 'number', minimum: 0, maximum: 1};
  assert.deepEqual(speechArguments(withProsodySchema, nonDefaultProsody.body), {text: '[whispering] 你好', voice_id: 'voice-a', speed: 0.9, temperature: 0.8});
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

test('Fish voices saved with the MCP default use the active API model and API key after switching access', async () => {
  const calls = [], providers = new Providers(async (url, init) => {
    calls.push({url, init});
    return new Response(new Uint8Array([73, 68, 51]), {headers: {'Content-Type': 'audio/mpeg'}});
  });
  providers.setKey('fish', 'saved-api-key');
  providers.fish = new Proxy({}, {get() {assert.fail('API synthesis must not access MCP or OAuth');}});
  const connection = {access: 'api', model: 's2.1-pro', params: TTSParameters.defaults('fish')};
  const line = {text: 'hello', emotion: '1,0.7'}, route = {voice: 'saved-voice', model: MCP_MODEL};
  for (const relay of [{}, {relay: 'https://relay.example'}, {relay: 'https://relay.example/v1', relayApi: 'openai'}]) {
    const current = {...connection, ...relay}, request = buildRequest('fish', current, route, line);
    assert.notEqual(request.transport, 'mcp');
    assert.equal(await requestHash(request), await requestHash(buildRequest('fish', current, {...route, model: ''}, line)));
    const audio = await providers.synthesize(request);
    assert.equal(audio.size, 3);
    const {url, init} = calls.at(-1), body = JSON.parse(init.body);
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer saved-api-key');
    assert.equal(body.voice, 'saved-voice');
    assert.equal(body.model, relay.relayApi === 'openai' ? 's2.1-pro' : 'fish-audio/s2.1-pro');
    assert.equal(url, relay.relayApi === 'openai' ? 'https://relay.example/v1/audio/speech' : (relay.relay || 'https://api.fish.audio') + '/compat/v1/audio/speech');
    assert.doesNotMatch(init.body, /mcp-default/);
  }
  const explicit = buildRequest('fish', connection, {...route, model: 's1'}, line);
  assert.equal(explicit.body.model, 'fish-audio/s1');
  assert.throws(() => buildRequest('fish', connection, {...route, model: 'unsupported'}, line), /请选择当前引擎支持的模型/);
  assert.equal(connection.model, 's2.1-pro'); assert.equal(route.model, MCP_MODEL);
});

test('Old Fish API settings recover a real API model without changing subscription models or saved voices', () => {
  for (const apiModel of ['s2-pro', MCP_MODEL, undefined]) {
    const input = freshState();
    input.connections.fish = {...input.connections.fish, access: 'api', model: MCP_MODEL, apiModel};
    const expected = apiModel === 's2-pro' ? apiModel : 's2.1-pro';
    const state = normalizeSettings(input);
    assert.equal(state.connections.fish.access, 'api');
    assert.equal(state.connections.fish.model, expected);
    const request = buildRequest('fish', input.connections.fish, {voice: 'saved-voice'}, {text: 'hello'});
    assert.equal(request.body.model, 'fish-audio/' + expected);
    const preview = TTSParameters.requestPreview('fish', input.connections.fish, 'saved-voice', 'hello');
    assert.equal(preview.body.model, 'fish-audio/' + expected);
    assert.equal(input.connections.fish.model, MCP_MODEL);
  }
  const input = freshState();
  input.connections.fish = {...input.connections.fish, access: 'subscription', model: MCP_MODEL, apiModel: 's1'};
  const state = normalizeSettings(input);
  assert.equal(state.connections.fish.model, MCP_MODEL);
  assert.equal(state.connections.fish.apiModel, 's1');
  assert.equal(buildRequest('fish', state.connections.fish, {voice: 'saved-voice'}, {text: 'hello'}).transport, 'mcp');
});

test('Fish API balance remains available when the host MCP server is not registered', async t => {
  const f = speechFixture(), providers = new Providers(); providers.fish = f.client;
  providers.setKey('fish', 'saved-api-key');
  const backend = new TTSBackend({settings: freshState(), providers, indexedDB: null}); t.after(() => backend.close());
  const api = {...backend.api()}; let html = '', balances = 0, mcpChecks = 0;
  api.fishStatus = () => {mcpChecks++; return {configured: true, nativeRequired: true, nativeRegistered: false};};
  api.fishCatalog = async () => false;
  api.voiceBalance = async () => {balances++; return {kind: 'credit', credit: 8.5, free: false};};
  const doc = {activeElement: null, addEventListener() {}, createElement: () => root};
  const root = {dataset: {}, ownerDocument: doc, scrollTop: 0, contains: () => true, querySelectorAll: () => [], querySelector: () => null,
    addEventListener() {}, set innerHTML(value) {html = value;}, get innerHTML() {return html;}};
  const view = enginesApp({api, doc, win: {AbortController, setTimeout}, notify(message) {assert.fail(message);}});
  t.after(() => view.dispose()); view.edit('fish');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(balances, 1); assert.equal(mcpChecks, 0);
  assert.match(html, /API 余额<\/span><strong>\$8\.50/);
  assert.doesNotMatch(html, /先接入 TT 自带 MCP/);
  api.saveConnection('fish', {access: 'subscription'});
  view.onBalance({engine: 'fish', stale: true});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(balances, 1); assert.ok(mcpChecks > 0);
});

test('Engine UI switches only Fish access, shows OAuth controls and credits, and never exports tokens as settings', async t => {
  const f = speechFixture(), providers = new Providers(); providers.fish = f.client;
  f.oauth.status = () => ({configured: true, pending: false});
  providers.setKey('fish', 'old-api-key');
  const backend = new TTSBackend({settings: freshState(), providers, indexedDB: null}); t.after(() => backend.close());
  const api = {...backend.api()}, listeners = new Map(); let html = '';
  // Keep this UI test local: no real endpoint and no host instance is opened.
  api.voiceBalance = async () => creditResult({structuredContent: packageCredits});
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
  assert.match(html, /重新授权|断开连接/); assert.match(html, /剩余订阅积分<\/span><strong>178,128/);
  assert.match(html, /额外积分<\/span><strong>1,000/); assert.match(html, /本期结束/);
  assert.match(html, /团队<\/span><small>Fixture Team/);
  view.back();
  assert.match(html, /178,128 积分/); assert.doesNotMatch(html, /网页订阅积分|积分未识别/);
  assert.doesNotMatch(html, /data-field="key"|免费额度|API 余额<\/span>/);
  assert.equal(api.keyStatus('fish'), true);
  assert.doesNotMatch(JSON.stringify(api.getState()), /oauth-access|test-refresh-token/);
  api.saveConnection('fish', {access: 'api'});
  assert.equal(backend.settings.connections.fish.model, 's2.1-pro'); assert.equal(providers.currentKey('fish'), 'old-api-key');
});
