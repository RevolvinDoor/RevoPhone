import {FISH_MCP} from './fish-oauth.js';

/** Use TT's existing MCP Manager registration and native test-call API, with its state/permission gates. */
export class FishNativeMCP {
  constructor(oauth, host = globalThis) { this.oauth = oauth; this.host = host; }
  get api() { return this.host.__TAURITAVERN__?.api?.mcp; }
  get available() {
    return ['list', 'create', 'update', 'remove', 'setState', 'discover', 'refresh'].every(name => typeof this.api?.servers?.[name] === 'function') &&
      typeof this.api?.tools?.testCall === 'function' && typeof this.api?.tools?.setPermission === 'function';
  }
  get registered() { return !!this.oauth.record?.nativeRegistrationId; }
  get displayName() { return 'RevoPhone · Fish Audio · ' + String(this.oauth.scope || 'default').slice(0, 8); }
  error(message, code = 'HOST_MCP_NOT_READY') { return Object.assign(Error('Fish 订阅积分：' + message), {known: true, code}); }
  async ready(signal) {
    await (this.host.__TAURITAVERN__?.ready ?? this.host.__TAURITAVERN_MAIN_READY__);
    signal?.throwIfAborted();
    if (!this.available) throw this.error('当前 TT 没有可调用的 MCP 管理器接口，请更新 TT。', 'HOST_MCP_REQUIRED');
  }
  checkServer(server) {
    if (!server) throw this.error('TT 中的 Fish 服务不存在，请点击“接入 TT 自带 MCP”。', 'HOST_MCP_NOT_CONNECTED');
    if (server.endpoint !== FISH_MCP) throw this.error('TT 中的 Fish 服务地址已修改，请恢复为 ' + FISH_MCP + '；不会向其他地址发送 Fish 授权。', 'HOST_MCP_ENDPOINT_CHANGED');
    return server;
  }
  async server() {
    const id = this.oauth.record?.nativeRegistrationId;
    if (!id) throw this.error('请先点击“接入 TT 自带 MCP”，将本次 Fish 登录连接到 TT。', 'HOST_MCP_NOT_CONNECTED');
    const scan = await this.api.servers.list();
    return this.checkServer(scan.servers.find(server => server.id === id));
  }
  async authorize(server, token) {
    const headers = Object.fromEntries(Object.entries(server.headers || {}).filter(([name]) => name.toLowerCase() !== 'authorization'));
    headers.Authorization = 'Bearer ' + token;
    const authorization = Object.keys(server.headers || {}).filter(name => name.toLowerCase() === 'authorization');
    if (authorization.length === 1 && authorization[0] === 'Authorization' && server.headers.Authorization === headers.Authorization) return server;
    return this.api.servers.update({registrationId: server.id, displayName: server.displayName, endpoint: FISH_MCP,
      protocolVersion: server.protocolVersion, headers});
  }
  async connect() {
    if (this.connecting) return this.connecting;
    this.disconnecting = false;
    this.connecting = this.connectNow().finally(() => { this.connecting = null; });
    return this.connecting;
  }
  async connectNow() {
    await this.ready();
    const account = this.oauth.record?.account, token = await this.oauth.token();
    if (account !== this.oauth.record?.account) throw this.error('Fish 账户已变化，请重新操作');
    const scan = await this.api.servers.list();
    let server = scan.servers.find(row => row.id === this.oauth.record?.nativeRegistrationId);
    if (!server) {
      const matches = scan.servers.filter(row => row.displayName === this.displayName && row.endpoint === FISH_MCP);
      if (matches.length > 1) throw this.error('TT 中存在多个同名 RevoPhone Fish 服务，请在 MCP 管理器中只保留一个后重试');
      server = matches[0];
    }
    const created = !server;
    if (server) { this.checkServer(server); server = await this.authorize(server, token); }
    else server = await this.api.servers.create({displayName: this.displayName, endpoint: FISH_MCP,
      protocolVersion: '2025-11-25', headers: {Authorization: 'Bearer ' + token}});
    const id = server.id;
    // Keep only the binding ID with OAuth; TT owns the actual registered connection.
    try {
      await this.oauth.store.change(record => {
        if (record?.account !== account) throw this.error('Fish 账户已变化，请重新接入 TT');
        return {...record, nativeRegistrationId: id};
      });
    } catch (error) {
      if (created) {
        try { await this.api.servers.remove({registrationId: id}); }
        catch { throw this.error('无法保存 TT 关联，且新服务未清理成功；请到 TT MCP 管理器删除本次新建的 Fish 服务后重试'); }
      }
      throw error;
    }
    this.oauth.record = await this.oauth.store.read();
    if (this.oauth.record?.account !== account || this.disconnecting) throw this.error('连接已变化，请重新操作');
    for (const nativeName of ['get_credit_balance', 'search_voices', 'text_to_speech']) {
      await this.api.tools.setPermission({registrationId: id, nativeName, permission: 'allow'});
    }
    await this.api.servers.setState({registrationId: id, state: 'active'});
    return {registrationId: id};
  }
  async connection(signal) {
    await this.ready(signal);
    if (this.disconnecting) throw this.error('Fish 连接正在断开');
    let server = await this.server();
    if (server.state !== 'active') throw this.error('TT 中的 Fish MCP 已暂停，请在 MCP 管理器中开启后重试。', 'HOST_MCP_PAUSED');
    const account = this.oauth.record?.account;
    signal?.throwIfAborted();
    if (account !== this.oauth.record?.account || this.disconnecting) throw this.error('Fish 连接已变化，请重新操作');
    // Refresh only the credential; never reactivate a paused service or change its tool permissions here.
    const operation = (this.syncing || Promise.resolve()).catch(() => {}).then(async () => {
      server = await this.server();
      if (server.state !== 'active') throw this.error('TT 中的 Fish MCP 已暂停', 'HOST_MCP_PAUSED');
      if (this.disconnecting) throw this.error('Fish 连接正在断开');
      const token = await this.oauth.token();
      if (account !== this.oauth.record?.account || this.disconnecting) throw this.error('Fish 连接已变化，请重新操作');
      return this.authorize(server, token);
    });
    this.syncing = operation;
    server = await operation;
    signal?.throwIfAborted();
    return server;
  }
  clean(value, connection) {
    let text = String(value || '宿主未返回错误说明');
    for (const secret of [connection.headers?.Authorization?.slice(7), this.oauth.record?.access_token, this.oauth.record?.refresh_token].filter(s => typeof s === 'string' && s.length >= 4)) {
      text = text.split(secret).join('[已隐藏]').split(encodeURIComponent(secret)).join('[已隐藏]');
    }
    return text.replace(/\bBearer\s+[^\s"',;<>]+/gi, 'Bearer [已隐藏]').slice(0, 600);
  }
  async discover(signal, refresh = false) {
    const connection = await this.connection(signal);
    try {
      const result = await this.api.servers[refresh ? 'refresh' : 'discover']({registrationId: connection.id});
      signal?.throwIfAborted();
      if (!Array.isArray(result?.tools)) throw Error('宿主返回的工具列表无效');
      return {...result, tools: result.tools.map(tool => ({...tool, name: tool.nativeName}))};
    } catch (error) {
      throw Object.assign(Error('Fish 订阅积分：宿主 MCP 工具发现失败：' + this.clean(error.message, connection)), {known: true, code: 'HOST_MCP_DISCOVERY'});
    }
  }
  async call(name, args, signal, paid) {
    const connection = await this.connection(signal);
    if (!['ask', 'allow'].includes(connection.toolPermissions?.[name])) throw this.error('TT 中未允许工具 ' + name + '，请在 MCP 管理器中开启对应工具。', 'HOST_MCP_TOOL_OFF');
    let outcome;
    const unknown = message => Object.assign(Error('Fish 订阅积分：' + message + (paid ? '，可能已扣积分，请先核对官网生成历史；插件没有自动重试。' : '')), {code: paid ? 'FISH_OUTCOME_UNKNOWN' : 'HOST_MCP_OUTCOME_UNKNOWN'});
    try { outcome = await this.api.tools.testCall({registrationId: connection.id, nativeName: name, argumentsJson: JSON.stringify(args)}, {signal}); }
    catch (error) { throw unknown('宿主调用结果无法确认：' + this.clean(error.message, connection)); }
    if (outcome?.outcome === 'not_sent') throw Object.assign(Error('Fish 订阅积分：宿主未发送请求：' + this.clean(outcome.message, connection)), {known: true, code: outcome.code});
    if (outcome?.outcome === 'outcome_unknown') throw unknown(this.clean(outcome.message, connection));
    if (outcome?.outcome !== 'known_response') throw unknown('宿主返回了无法识别的调用状态');
    const result = outcome.response;
    if (result?.kind !== 'tool_result') throw Object.assign(Error('Fish 订阅积分：' + this.clean(result?.message, connection)), {known: true, code: result?.code});
    const content = (result.textBlocks || []).map(block => ({type: 'text', text: block.text}));
    if (result.isError) throw Object.assign(Error('Fish 订阅积分：官方工具执行失败：' + this.clean(content.map(x => x.text).join(' '), connection)), {known: true});
    let structuredContent;
    try { if (result.structuredJson !== undefined) structuredContent = JSON.parse(result.structuredJson); }
    catch { throw unknown('官方已返回结果，但结构化内容无法读取'); }
    return {isError: false, content, ...(structuredContent !== undefined ? {structuredContent} : {})};
  }
  async disconnect() {
    this.disconnecting = true;
    await this.connecting?.catch(() => {});
    await this.syncing?.catch(() => {});
    if (!this.registered || !this.available) return;
    const scan = await this.api.servers.list(), server = scan.servers.find(row => row.id === this.oauth.record.nativeRegistrationId);
    if (!server || server.endpoint !== FISH_MCP) return;
    await this.api.servers.setState({registrationId: server.id, state: 'paused'});
    const headers = Object.fromEntries(Object.entries(server.headers || {}).filter(([name]) => name.toLowerCase() !== 'authorization'));
    await this.api.servers.update({registrationId: server.id, displayName: server.displayName, endpoint: server.endpoint,
      protocolVersion: server.protocolVersion, headers});
  }
}
