import {FISH_MCP, FishTokenStore} from './fish-oauth.js';
import {decodeMono, encodeWav, JOIN_RATE} from './audio-join.js';
import {sha256Hex} from './hash.js';

export const MCP_MODEL = 'mcp-default';
export const fishSubscription = connection => connection?.access === 'subscription';
const object = x => !!x && typeof x === 'object' && !Array.isArray(x);
const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const fail = message => Error('Fish 订阅积分：' + message);
const aliases = {text: ['text', 'input'], voice: ['voice_id', 'voice', 'reference_id'],
  model: ['model', 'model_id'], language: ['language', 'language_code'],
  speed: ['speed'], temperature: ['temperature']};

function property(tool, meaning) {
  const names = (aliases[meaning] || [meaning]).filter(key => Object.hasOwn(tool.inputSchema?.properties || {}, key));
  if (names.length > 1) throw fail(`工具有多个 ${meaning} 字段，暂不能确认参数映射，请更新插件`);
  return names[0];
}
function accepts(schema, value) {
  if (!object(schema) || schema.$ref || schema.allOf) return false;
  if (schema.anyOf) return schema.anyOf.some(s => accepts(s, value));
  if (schema.oneOf) return schema.oneOf.filter(s => accepts(s, value)).length === 1;
  if (schema.enum && !schema.enum.includes(value) || Object.hasOwn(schema, 'const') && schema.const !== value) return false;
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (types.length && !types.includes(type) && !(types.includes('integer') && Number.isInteger(value))) return false;
  if (typeof value === 'number' && (!Number.isFinite(value) || schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum)) return false;
  if (typeof value === 'string' && (schema.minLength !== undefined && [...value].length < schema.minLength || schema.maxLength !== undefined && [...value].length > schema.maxLength)) return false;
  if (Array.isArray(value)) return !schema.items || value.every(v => accepts(schema.items, v));
  if (object(value)) return Object.entries(value).every(([key, v]) => schema.properties?.[key] ? accepts(schema.properties[key], v) : schema.additionalProperties !== false) &&
    (schema.required || []).every(key => Object.hasOwn(value, key));
  return true;
}
/** Bind only properties actually discovered from Fish. Unknown required fields stop before a paid call. */
export function speechArguments(tool, request) {
  const schema = tool?.inputSchema;
  if (!object(schema?.properties)) throw fail('语音工具参数结构无法识别，请刷新工具信息');
  const args = {}, text = property(tool, 'text'), voice = property(tool, 'voice');
  if (!text || !voice) throw fail('官方语音工具的文本或音色字段发生变化，请更新插件');
  args[text] = request.text; args[voice] = request.voice;
  const model = property(tool, 'model');
  if (request.model !== MCP_MODEL) {
    if (!model) throw fail('此工具不开放模型选择，请把角色模型设为“跟随引擎”，并选择“官方 MCP 默认模型”');
    args[model] = request.model;
  }
  if (request.prosody) for (const name of ['speed', 'temperature']) {
    const key = property(tool, name), value = request.prosody[name];
    if (key) args[key] = value;
    else if (value !== (name === 'speed' ? 1 : .7)) throw fail('此工具不开放' + (name === 'speed' ? '语速' : '表现力') + '参数，请使用正文演技标签');
  }
  const extra = request.arguments || {};
  if (!object(extra)) throw fail('附加参数必须是 JSON 对象');
  const reserved = new Set([...aliases.text, ...aliases.voice, ...aliases.model, ...aliases.speed, ...aliases.temperature]);
  for (const [key, value] of Object.entries(extra)) {
    if (reserved.has(key)) throw fail('请通过角色配置或台词填写 ' + key + '，不能在附加参数中覆盖');
    if (!Object.hasOwn(schema.properties, key)) throw fail('官方语音工具没有参数：' + key);
    args[key] = value;
  }
  for (const key of schema.required || []) {
    if (!Object.hasOwn(args, key) && Object.hasOwn(schema.properties[key] || {}, 'default')) args[key] = schema.properties[key].default;
    if (!Object.hasOwn(args, key)) throw fail('官方工具还要求参数 ' + key + '，请按“工具信息”在附加参数中填写');
  }
  for (const [key, value] of Object.entries(args)) if (!accepts(schema.properties[key], value)) throw fail('参数 ' + key + ' 不符合官方工具 schema，请检查模型或附加参数');
  return args;
}

function resultData(result) {
  const parts = [];
  if (object(result?.structuredContent)) parts.push(result.structuredContent);
  for (const block of result?.content || []) if (block.type === 'text' && typeof block.text === 'string') {
    try { parts.push(JSON.parse(block.text)); } catch { parts.push(block.text); }
  }
  return parts;
}
export function audioLinks(result) {
  const urls = [];
  const add = value => {
    let url; try { url = new URL(value); } catch { return; }
    if (url.protocol !== 'https:' || url.username || url.password) return;
    if (!urls.includes(url.href)) urls.push(url.href);
  };
  const walk = (value, key = '', depth = 0) => {
    if (depth > 12) throw fail('返回内容层级过深');
    if (typeof value === 'string') {
      if (/^(?:url|uri|audio_url|audio_link|download_url|download_link|file_url)$/i.test(key)) add(value);
      else for (const match of value.matchAll(/https:\/\/[^\s<>"')\]]+/g)) {
        if (/\.(?:mp3|wav|ogg|opus|flac|m4a)(?:[?#]|$)/i.test(match[0]) || /(?:audio|download)/i.test(key)) add(match[0]);
      }
    } else if (Array.isArray(value)) value.forEach(v => walk(v, key, depth + 1));
    else if (object(value)) for (const [k, v] of Object.entries(value)) walk(v, k, depth + 1);
  };
  resultData(result).forEach(v => walk(v));
  // Resource links are another standard MCP result representation.
  for (const block of result?.content || []) if (block.type === 'resource_link' && /^audio\//.test(block.mimeType || '')) add(block.uri);
  if (!urls.length) throw fail('工具没有返回可识别的 HTTPS 音频链接；请查看官方生成历史，不要立即重复生成');
  if (urls.length > 32) throw fail('返回片段过多，请缩短台词');
  return urls;
}
export function creditResult(result) {
  const parts = resultData(result), summary = parts.map(p => typeof p === 'string' ? p : JSON.stringify(p, null, 2)).join('\n');
  if (!summary.trim()) throw fail('额度工具没有返回账户信息');
  const data = parts.find(object) || {}, balance = data.remaining_credits ?? data.credits_remaining ?? data.credit_balance ?? data.balance;
  const label = value => typeof value === 'string' ? value : typeof value?.name === 'string' ? value.name : '';
  // Preserve the server's own account, plan and limits rather than inventing a USD-to-credit conversion.
  return {engine: 'fish', kind: 'subscription', left: typeof balance === 'number' && Number.isFinite(balance) ? balance : null,
    team: label(data.team), plan: label(data.plan), summary: summary.slice(0, 10000)};
}

/** A bounded JSON/SSE reader. A POST's response is consumed only until its matching JSON-RPC reply. */
export async function rpcResponse(response, id, signal) {
  if (!/text\/event-stream/i.test(response.headers.get('content-type') || '')) {
    const text = await boundedText(response, 2 * 1024 * 1024);
    let json; try { json = JSON.parse(text); } catch { throw fail('MCP 返回了无效 JSON'); }
    if (json?.id !== id) throw fail('MCP 响应编号不符');
    return json;
  }
  const reader = response.body?.getReader();
  if (!reader) throw fail('当前环境无法读取 MCP 事件流');
  let buffer = '', bytes = 0; const decoder = new TextDecoder();
  try {
    while (true) {
      signal?.throwIfAborted();
      const {done, value} = await reader.read();
      bytes += value?.length || 0;
      if (bytes > 2 * 1024 * 1024) throw fail('MCP 响应过大');
      buffer += done ? decoder.decode() : decoder.decode(value, {stream: true});
      // Normalize only complete CRLFs; keep a trailing CR until its following chunk arrives.
      buffer = buffer.replace(/\r\n/g, '\n');
      let at;
      while ((at = buffer.indexOf('\n\n')) >= 0) {
        const event = buffer.slice(0, at); buffer = buffer.slice(at + 2);
        const data = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
        if (!data) continue;
        let json; try { json = JSON.parse(data); } catch { throw fail('MCP 事件流包含无效 JSON'); }
        if (json.id === id) return json;
      }
      if (done) throw fail('MCP 事件流结束前没有返回结果');
    }
  } finally { await reader.cancel().catch(() => {}); }
}
async function boundedText(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) { const text = await response.text(); if (new TextEncoder().encode(text).length > limit) throw fail('响应过大'); return text; }
  const chunks = []; let size = 0;
  try {
    while (true) { const {done, value} = await reader.read(); if (done) break; size += value.length; if (size > limit) throw fail('响应过大'); chunks.push(value); }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}

/** Keep protocol/authentication out of generic API-key rotation and generic proxy rewriting. */
export class FishMCP {
  constructor(oauth, {fetcher = (...a) => globalThis.fetch(...a), mergeAudio = mergeClips,
    journal = new FishTokenStore(oauth.scope + ':audio-jobs', oauth.store?.factory)} = {}) {
    Object.assign(this, {oauth, fetcher, mergeAudio, journal});
    this.id = 0; this.inflight = new Map(); this.controller = new AbortController();
  }
  reset() { this.session = ''; this.protocol = ''; this.tools = null; this.account = ''; }
  async send(method, params, {signal, notify = false, paid = false, initialize = false} = {}) {
    const combined = AbortSignal.any([this.controller.signal, ...(signal ? [signal] : []), AbortSignal.timeout(paid ? 180000 : 30000)]);
    const account = this.oauth.record?.account, token = await this.oauth.token(); combined.throwIfAborted();
    if (account !== this.oauth.record?.account) throw fail('登录账户已变化，请重新播放');
    const id = ++this.id, headers = {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer ' + token};
    if (!initialize) {
      headers['MCP-Protocol-Version'] = this.protocol;
      if (this.session) headers['Mcp-Session-Id'] = this.session;
    }
    let sent = false;
    try {
      sent = true;
      const r = await this.fetcher(FISH_MCP, {method: 'POST', headers, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
        body: JSON.stringify({jsonrpc: '2.0', ...(notify ? {} : {id}), method, ...(params === undefined ? {} : {params})}), signal: combined});
      if (!r.ok) {
        if (r.status === 401 || r.status === 404) { this.session = ''; this.protocol = ''; this.tools = null; }
        await r.body?.cancel().catch(() => {});
        throw Object.assign(fail(`MCP 请求被拒（HTTP ${r.status}）${r.status === 401 ? '，请重新连接 Fish 账户' : ''}`), {known: r.status < 500});
      }
      if (initialize) this.session = r.headers.get('Mcp-Session-Id') || '';
      if (notify) { await r.body?.cancel().catch(() => {}); return; }
      const json = await rpcResponse(r, id, combined);
      if (json.error) throw Object.assign(fail('官方 MCP 返回协议错误（' + json.error.code + '）'), {known: true});
      if (!object(json.result)) throw fail('MCP 没有返回完整结果');
      if (json.result.isError) {
        const message = resultData(json.result).filter(p => typeof p === 'string').join(' ').slice(0, 350);
        throw Object.assign(fail('官方工具执行失败' + (message ? '：' + message : '')), {known: true});
      }
      return json.result;
    } catch (error) {
      if (paid && sent && !error.known) throw Object.assign(fail('生成结果未知，服务端可能已扣积分。请先查看 Fish 生成历史；插件没有自动重试。'), {code: 'FISH_OUTCOME_UNKNOWN'});
      throw error;
    }
  }
  async ready(signal, refresh = false) {
    // OAuth refresh does not change account identity. Reauthorizing/disconnecting does.
    const account = this.oauth.record?.account;
    if (this.account !== account) { this.reset(); this.account = account; }
    if (refresh) this.tools = null;
    if (this.tools) return;
    if (!this.starting) this.starting = (async () => {
      if (!this.protocol) {
        const result = await this.send('initialize', {protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {name: 'RevoPhone', version: '1.2.1'}}, {signal, initialize: true});
        if (account !== this.oauth.record?.account) throw fail('登录账户已变化，请重新读取工具');
        if (!['2025-11-25', '2025-06-18', '2025-03-26'].includes(result.protocolVersion) || !result.capabilities?.tools) throw fail('服务端协商的 MCP 版本或工具能力不受支持');
        this.protocol = result.protocolVersion;
        await this.send('notifications/initialized', undefined, {signal, notify: true});
      }
      const tools = new Map(), cursors = new Set(); let cursor;
      for (let page = 0; page < 20; page++) {
        const result = await this.send('tools/list', cursor ? {cursor} : {}, {signal});
        if (account !== this.oauth.record?.account) throw fail('登录账户已变化，请重新读取工具');
        if (!Array.isArray(result.tools)) throw fail('工具列表格式不符');
        for (const tool of result.tools) {
          if (tools.has(tool.name)) throw fail('工具列表含重复名称');
          tools.set(tool.name, tool);
        }
        cursor = result.nextCursor;
        if (!cursor) { this.tools = tools; this.account = this.oauth.record?.account; return; }
        if (cursors.has(cursor)) throw fail('工具分页游标重复');
        cursors.add(cursor);
      }
      throw fail('工具列表分页过多');
    })().finally(() => { this.starting = null; });
    return this.starting;
  }
  async call(name, args, signal, paid = false, expectedAccount) {
    await this.ready(signal);
    if (expectedAccount !== undefined && expectedAccount !== this.oauth.record?.account) throw fail('登录账户已变化，已停止本次生成');
    if (!this.tools.has(name)) throw fail('官方服务没有工具 ' + name);
    return this.send('tools/call', {name, arguments: args}, {signal, paid});
  }
  async balance() { return creditResult(await this.call('get_credit_balance', {})); }
  async information(refresh = true) {
    await this.ready(undefined, refresh);
    return Object.fromEntries(['text_to_speech', 'search_voices', 'get_credit_balance'].map(name => [name, this.tools.get(name) || null]));
  }
  async voices({search = '', page = 0} = {}) {
    await this.ready();
    const tool = this.tools.get('search_voices');
    if (!tool) throw fail('官方服务没有音色查询工具');
    const props = tool.inputSchema?.properties || {}, args = {};
    const query = ['query', 'search', 'title'].find(k => props[k]);
    if (search && !query) throw fail('当前音色工具未开放可识别的搜索字段，请直接填写音色 ID');
    if (query && search) args[query] = search;
    if (props.page) args.page = page + 1;
    else if (page) return {voices: [], more: false, token: '', note: '请缩小搜索范围'};
    for (const key of tool.inputSchema?.required || []) {
      if (args[key] === undefined && props[key]?.default !== undefined) args[key] = props[key].default;
      if (args[key] === undefined) throw fail('音色查询要求参数 ' + key + '；当前可手动填写已有音色 ID');
    }
    const result = await this.call('search_voices', args), voices = [];
    const walk = (v, depth = 0) => {
      if (depth > 12) return;
      if (Array.isArray(v)) v.forEach(x => walk(x, depth + 1));
      else if (object(v)) {
        const id = v.voice_id || v._id || v.id, name = v.title || v.name;
        if (typeof id === 'string' && typeof name === 'string' && !voices.some(x => x.id === id)) voices.push({id, name, info: String(v.description || '').slice(0, 240)});
        else Object.values(v).forEach(x => walk(x, depth + 1));
      }
    };
    resultData(result).forEach(v => walk(v));
    if (!voices.length) throw fail('未读到可识别的音色记录；可在角色里直接填写已有 Fish 音色 ID');
    return {voices, more: false, token: '', note: '官方 MCP 音色结果'};
  }
  async jobs() {
    return this.jobRows(await this.journal.read());
  }
  jobRows(value) {
    if (value === null) return new Map();
    if (!Array.isArray(value) || value.length > 64 || value.some(row => !Array.isArray(row) || !/^[a-f0-9]{64}$/.test(row[0]) || !object(row[1]) ||
        !(row[1].pending === true || Array.isArray(row[1].links) && row[1].links.length && row[1].links.every(url => { try { const u = new URL(url); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; } })))) {
      throw fail('本地生成记录损坏，已停止生成以避免重复扣费');
    }
    return new Map(value);
  }
  async saveJob(key, value, claim = false) {
    let previous;
    const operation = (this.writingJobs || Promise.resolve()).catch(() => {}).then(async () => {
      await this.journal.change(saved => {
        const rows = this.jobRows(saved);
        if (claim && rows.has(key)) { previous = rows.get(key); return saved; }
        if (value && !rows.has(key) && rows.size >= 64) {
          const old = [...rows].find(([, row]) => row.links);
          if (!old) throw fail('未确认的生成记录已满，请先核对官网历史并清除未知记录');
          rows.delete(old[0]);
        }
        if (value) rows.set(key, value); else rows.delete(key);
        return [...rows];
      });
    });
    this.writingJobs = operation; await operation; return previous;
  }
  async clearUnknown() {
    if (this.inflight.size) throw fail('请先停止正在进行的生成，再清除未知记录');
    const rows = await this.jobs();
    for (const [key, row] of rows) if (!row.links) await this.saveJob(key, null);
  }
  async synthesize(request, signal) {
    await this.ready(signal);
    if (request.account !== this.oauth.record?.account) throw fail('登录账户已变化，请重新播放');
    const args = speechArguments(this.tools.get('text_to_speech'), request.body);
    const key = await sha256Hex(JSON.stringify([this.account, canonical(args)]));
    if (this.inflight.has(key)) return this.inflight.get(key);
    const job = this.synthesizeNow(args, key, signal, request.account);
    this.inflight.set(key, job);
    try { return await job; } finally { if (this.inflight.get(key) === job) this.inflight.delete(key); }
  }
  async synthesizeNow(args, key, signal, account) {
    const rows = await this.jobs(), previous = rows.get(key);
    if (previous && !previous.links) throw Object.assign(fail('这句上次的生成结果未知，可能已扣积分。请先查看 Fish 生成历史；确认需要重新生成后，可在引擎中清除未知记录。'), {code: 'FISH_OUTCOME_UNKNOWN'});
    let links = previous?.links;
    if (!links) {
      const existing = await this.saveJob(key, {pending: true}, true);
      if (existing) {
        if (!existing.links) throw fail('另一个窗口已提交这句语音，请稍后播放；本窗口没有重复生成');
        links = existing.links;
      }
    }
    if (!links) {
      let result;
      try { result = await this.call('text_to_speech', args, signal, true, account); }
      catch (error) {
        if (error.code !== 'FISH_OUTCOME_UNKNOWN') await this.saveJob(key, null);
        throw error;
      }
      try { this.onSpend?.(); } catch {}
      // Unrecognized results remain pending: reloading must not turn them into another paid call.
      links = audioLinks(result);
      await this.saveJob(key, {links});
    }
    // If audio download fails, the next playback retries these links, never another paid tool call.
    try {
      const clips = [];
      for (const url of links) {
        signal?.throwIfAborted();
        const r = await this.fetcher(url, {credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'follow',
          signal: AbortSignal.any([this.controller.signal, ...(signal ? [signal] : []), AbortSignal.timeout(60000)])});
        if (!r.ok) throw fail('音频下载失败（HTTP ' + r.status + '）');
        const bytes = await readAudio(r);
        clips.push(new Blob([bytes], {type: r.headers.get('content-type') || 'application/octet-stream'}));
      }
      return clips.length === 1 ? clips[0] : await this.mergeAudio(clips, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      throw fail('语音已生成，但下载或解码失败。再次播放会重试已保存的链接，不重复生成。' + (error.message ? ' ' + error.message : ''));
    }
  }
  close() { this.controller.abort(); this.reset(); this.oauth.close(); this.writingJobs?.finally(() => this.journal.close()).catch(() => {}); if (!this.writingJobs) this.journal.close(); }
}
async function readAudio(response) {
  const reader = response.body?.getReader(), chunks = []; let size = 0;
  if (!reader) { const bytes = new Uint8Array(await response.arrayBuffer()); if (!bytes.length || bytes.length > 64 * 1024 * 1024) throw fail('音频大小无效'); return bytes; }
  try {
    while (true) { const {done, value} = await reader.read(); if (done) break; size += value.length; if (size > 64 * 1024 * 1024) throw fail('音频过大'); chunks.push(value); }
  } finally { await reader.cancel().catch(() => {}); }
  if (!size) throw fail('音频文件为空');
  const bytes = new Uint8Array(size); let at = 0;
  for (const part of chunks) { bytes.set(part, at); at += part.length; }
  return bytes;
}
/** Decode first: concatenating MP3/WAV file bytes would silently discard or corrupt later clips. */
async function mergeClips(clips, signal) {
  const buffers = []; let frames = 0;
  for (const clip of clips) {
    signal?.throwIfAborted();
    const samples = await decodeMono(globalThis, clip, JOIN_RATE);
    frames += samples.length;
    if (frames > 16 * 1024 * 1024) throw fail('合并后的音频过长，请缩短台词');
    buffers.push(samples);
  }
  const samples = new Float32Array(frames); let offset = 0;
  for (const buffer of buffers) { samples.set(buffer, offset); offset += buffer.length; }
  return encodeWav(samples, JOIN_RATE);
}
