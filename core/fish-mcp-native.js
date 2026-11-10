import {FISH_MCP} from './fish-oauth.js';

/** TauriTavern owns native MCP transport; RevoPhone owns OAuth and the speech workflow. */
export class FishNativeMCP {
  constructor(oauth, host = globalThis) { this.oauth = oauth; this.host = host; }
  get api() { return this.host.__TAURITAVERN__?.api?.mcp?.remote; }
  get available() { return this.api?.version === 1 && typeof this.api.discover === 'function' && typeof this.api.call === 'function'; }
  async connection(signal) {
    await (this.host.__TAURITAVERN__?.ready ?? this.host.__TAURITAVERN_MAIN_READY__);
    signal?.throwIfAborted();
    if (!this.available) throw Object.assign(Error('Fish 订阅积分：当前 TauriTavern 缺少原生 MCP 扩展调用接口，需要安装包含配套宿主补丁的版本；仅更新 RevoPhone 不够。'), {code: 'HOST_MCP_REQUIRED', known: true});
    const account = this.oauth.record?.account, token = await this.oauth.token();
    signal?.throwIfAborted();
    if (account !== this.oauth.record?.account) throw Object.assign(Error('Fish 账户已变化，请重新操作'), {known: true});
    return {endpoint: FISH_MCP, protocolVersion: '2025-11-25', headers: {Authorization: 'Bearer ' + token}};
  }
  clean(value, connection) {
    let text = String(value || '宿主未返回错误说明');
    for (const secret of [connection.headers.Authorization.slice(7), this.oauth.record?.refresh_token].filter(s => typeof s === 'string' && s.length >= 4)) {
      text = text.split(secret).join('[已隐藏]').split(encodeURIComponent(secret)).join('[已隐藏]');
    }
    return text.replace(/\bBearer\s+[^\s"',;<>]+/gi, 'Bearer [已隐藏]').slice(0, 600);
  }
  async discover(signal) {
    const connection = await this.connection(signal);
    try {
      const result = await this.api.discover(connection);
      signal?.throwIfAborted();
      if (!Array.isArray(result?.tools)) throw Error('宿主返回的工具列表无效');
      return {...result, tools: result.tools.map(tool => ({...tool, name: tool.nativeName}))};
    } catch (error) {
      throw Object.assign(Error('Fish 订阅积分：宿主 MCP 工具发现失败：' + this.clean(error.message, connection)), {known: true, code: 'HOST_MCP_DISCOVERY'});
    }
  }
  async call(name, args, signal, paid) {
    const connection = await this.connection(signal);
    let outcome;
    const unknown = message => Object.assign(Error('Fish 订阅积分：' + message + (paid ? '，可能已扣积分，请先核对官网生成历史；插件没有自动重试。' : '')), {code: paid ? 'FISH_OUTCOME_UNKNOWN' : 'HOST_MCP_OUTCOME_UNKNOWN'});
    try { outcome = await this.api.call({connection, nativeName: name, argumentsJson: JSON.stringify(args)}, {signal}); }
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
}
