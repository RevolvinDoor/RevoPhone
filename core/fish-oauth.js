import {sha256Plain} from './hash.js';

export const FISH_MCP = 'https://api.fish.audio/mcp';
const ISSUER = 'https://api.fish.audio';
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
const abort = () => new DOMException('Fish 登录已取消', 'AbortError');

/** OAuth records are deliberately outside settings, API-key pools, exports and request logs. */
export class FishTokenStore {
  constructor(scope, factory = globalThis.indexedDB) { this.scope = scope; this.factory = factory; }
  async open() {
    if (this.closed) throw abort();
    if (!this.factory) throw Error('当前环境不能保存 Fish 授权，请允许网站使用本地存储');
    return this.db ??= await new Promise((resolve, reject) => {
      const r = this.factory.open('revophone-fish-oauth-v1', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('accounts');
      r.onsuccess = () => {
        const db = r.result;
        if (this.closed) { db.close(); reject(abort()); return; }
        db.onversionchange = () => { db.close(); this.db = null; };
        resolve(db);
      };
      r.onerror = () => reject(Error('无法打开 Fish 授权存储'));
      r.onblocked = () => reject(Error('Fish 授权存储被其他窗口占用，请关闭旧窗口'));
    });
  }
  async run(write, value) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('accounts', write ? 'readwrite' : 'readonly'), store = tx.objectStore('accounts');
      const r = !write ? store.get(this.scope) : value ? store.put(value, this.scope) : store.delete(this.scope);
      tx.oncomplete = () => resolve(r.result || null);
      tx.onerror = tx.onabort = () => reject(Error('无法读写 Fish 授权，请检查本地存储'));
    });
  }
  read() { return this.run(false); }
  write(value) { return this.run(true, value); }
  async change(update) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('accounts', 'readwrite'), store = tx.objectStore('accounts');
      let error;
      store.get(this.scope).onsuccess = event => {
        try { store.put(update(event.target.result || null), this.scope); }
        catch (e) { error = e; tx.abort(); }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(error || Error('无法保存 Fish 生成记录'));
    });
  }
  close() { this.closed = true; this.db?.close(); this.db = null; }
}

export class FishOAuth {
  constructor({scope, store = new FishTokenStore(scope), fetcher = (...a) => globalThis.fetch(...a),
    win = globalThis.window, changed = () => {}, locks = globalThis.navigator?.locks,
    redirectUri = new URL('../fish-oauth.html', import.meta.url).href} = {}) {
    Object.assign(this, {scope, store, fetcher, win, changed, locks, redirectUri});
    this.epoch = 0; this.record = null; this.pending = null; this.closed = false;
    this.controller = new AbortController();
  }
  async open() { this.record = await this.store.read(); return this; }
  get configured() { return !!(this.record?.access_token || this.record?.refresh_token); }
  status() {
    return {configured: this.configured, expiresAt: this.record?.expiresAt || null,
      preparing: !!this.preparing, pending: !!this.pending, authorizationUrl: this.pending?.url || '', redirectUri: this.pending?.redirectUri || '',
      error: this.error || ''};
  }
  // Never send OAuth bodies through RequestLog: URL-encoded forms contain codes and refresh tokens.
  async request(url, init = {}) {
    const r = await this.fetcher(url, {...init, credentials: 'omit', redirect: 'error',
      referrerPolicy: 'no-referrer', signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(25000)])});
    const json = await r.json().catch(() => null);
    if (!r.ok) throw Object.assign(Error(`Fish 授权请求失败（HTTP ${r.status}${json?.error ? '，' + String(json.error).replace(/[^\w.-]/g, '').slice(0, 80) : ''}）`), {status: r.status, oauthCode: json?.error});
    if (!json || typeof json !== 'object') throw Error('Fish 授权服务返回的不是 JSON');
    return json;
  }
  async metadata() {
    if (this.meta) return this.meta;
    const resource = await this.request(ISSUER + '/.well-known/oauth-protected-resource/mcp');
    if (resource.resource !== FISH_MCP || !resource.authorization_servers?.includes(ISSUER)) throw Error('Fish 授权资源信息不符，已停止连接');
    const meta = await this.request(ISSUER + '/.well-known/oauth-authorization-server');
    if (meta.issuer !== ISSUER || meta.authorization_endpoint !== 'https://fish.audio/oauth/authorize' ||
        meta.token_endpoint !== ISSUER + '/oauth/token' || meta.registration_endpoint !== ISSUER + '/oauth/register' ||
        !meta.code_challenge_methods_supported?.includes('S256') || !meta.grant_types_supported?.includes('refresh_token')) {
      throw Error('Fish OAuth 能力发生变化，请更新插件后重新连接');
    }
    return this.meta = meta;
  }
  cancelLogin() {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.win?.removeEventListener('message', this.pending.listener);
      try { this.pending.popup?.close(); } catch {}
      this.pending = null;
    }
  }
  async beginLogin() {
    if (this.closed) throw abort();
    if (this.preparing) return this.status();
    this.cancelLogin();
    const epoch = ++this.epoch, redirectUri = this.redirectUri;
    // TauriTavern hands ordinary HTTPS links to the system browser. A blank popup instead
    // enters native new-window creation before there is an authorization page to display.
    const external = !!(this.win?.__TAURITAVERN__ || this.win?.__TAURITAVERN_HOST__);
    let popup = null;
    this.preparing = true; this.error = ''; this.changed();
    try {
      // Ordinary browsers still need a popup opened during the initiating click.
      if (!external) popup = this.win?.open('about:blank', 'revophone-fish-' + random().slice(0, 8), 'popup,width=540,height=760');
      const meta = await this.metadata();
      const client = await this.request(meta.registration_endpoint, {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({client_name: 'RevoPhone', redirect_uris: [redirectUri],
          grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none'})});
      if (this.closed || epoch !== this.epoch) throw abort();
      if (typeof client.client_id !== 'string' || !client.client_id) throw Error('Fish 未返回 OAuth 客户端标识');
      const verifier = random(), state = random(), url = new URL(meta.authorization_endpoint);
      for (const [key, value] of Object.entries({response_type: 'code', client_id: client.client_id, redirect_uri: redirectUri,
        scope: 'mcp', state, code_challenge: b64url(sha256Plain(new TextEncoder().encode(verifier))),
        code_challenge_method: 'S256', resource: FISH_MCP})) url.searchParams.set(key, value);
      const listener = event => {
        if (event.origin !== new URL(redirectUri).origin || event.source !== popup ||
            event.data?.type !== 'revophone-fish-oauth' || typeof event.data.url !== 'string') return;
        this.finishLogin(event.data.url).catch(error => { this.error = error.message; this.changed(); });
      };
      const timer = setTimeout(() => { this.cancelLogin(); this.error = 'Fish 登录已超时，请重新连接'; this.changed(); }, 10 * 60 * 1000);
      this.pending = {epoch, verifier, state, redirectUri, clientId: client.client_id, popup, listener, timer, url: url.href};
      this.error = '';
      if (popup) this.win?.addEventListener('message', listener);
      if (popup) popup.location.replace(url.href);
      // No size/position features: TauriTavern routes this to the system browser on desktop and mobile.
      else this.win?.open(url.href, '_blank', 'noopener');
      this.preparing = false; return this.status();
    } catch (error) {
      try { popup?.close(); } catch {}
      this.error = error.name === 'AbortError' ? '' : error.message;
      throw error;
    } finally { this.preparing = false; this.changed(); }
  }
  async finishLogin(value) {
    const p = this.pending;
    if (!p) throw Error('没有进行中的 Fish 登录，请先点击连接账户');
    if (this.exchanging) throw Error('正在完成 Fish 登录，请稍候');
    let url; try { url = new URL(String(value).trim()); } catch { throw Error('请粘贴浏览器地址栏中的完整回调地址'); }
    const expected = new URL(p.redirectUri);
    if (url.origin !== expected.origin || url.pathname !== expected.pathname ||
        url.searchParams.get('state') !== p.state || url.hash) throw Error('回调地址或登录校验不符，请使用本次登录的完整回调地址');
    if (url.searchParams.has('iss') && url.searchParams.get('iss') !== ISSUER) throw Error('Fish 授权签发方不符');
    if (url.searchParams.has('error')) { this.cancelLogin(); throw Error('Fish 登录未获授权，请重新连接'); }
    const code = url.searchParams.get('code');
    if (!code) throw Error('回调地址缺少授权码');
    this.exchanging = true;
    try {
      const meta = await this.metadata();
      const tokens = await this.request(meta.token_endpoint, {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: new URLSearchParams({grant_type: 'authorization_code', code, code_verifier: p.verifier,
          client_id: p.clientId, redirect_uri: p.redirectUri, resource: FISH_MCP}).toString()});
      const record = this.tokenRecord(tokens, {clientId: p.clientId, account: random()});
      if (this.closed || p.epoch !== this.epoch) throw abort();
      await this.store.write(record);
      if (this.closed || p.epoch !== this.epoch) { await this.store.write(null); throw abort(); }
      this.record = record; this.error = ''; this.cancelLogin(); this.changed(); return this.status();
    } finally { this.exchanging = false; }
  }
  tokenRecord(tokens, previous) {
    if (typeof tokens.access_token !== 'string' || !tokens.access_token || String(tokens.token_type).toLowerCase() !== 'bearer' ||
        !Number.isFinite(Number(tokens.expires_in)) || Number(tokens.expires_in) <= 0) throw Error('Fish 返回的令牌格式不完整，请重新授权');
    return {...previous, access_token: tokens.access_token, refresh_token: tokens.refresh_token || previous.refresh_token || '',
      expiresAt: Date.now() + Number(tokens.expires_in) * 1000};
  }
  async token() {
    if (this.closed) throw abort();
    const epoch = this.epoch, current = await this.store.read();
    if (this.closed || epoch !== this.epoch) throw abort();
    const switched = current?.account !== this.record?.account;
    this.record = current;
    if (switched) this.changed();
    if (this.record?.expiresAt > Date.now() + 60000) return this.record.access_token;
    if (!this.refreshing) {
      const refresh = async () => {
        const epoch = this.epoch;
        const saved = await this.store.read();
        if (this.closed || epoch !== this.epoch) throw abort();
        this.record = saved;
        if (saved?.expiresAt > Date.now() + 60000) return saved.access_token;
        if (!saved?.refresh_token) throw Error('Fish 授权已过期，请重新连接账户');
        const meta = await this.metadata();
        let tokens;
        try {
          tokens = await this.request(meta.token_endpoint, {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
            body: new URLSearchParams({grant_type: 'refresh_token', refresh_token: saved.refresh_token,
              client_id: saved.clientId, resource: FISH_MCP}).toString()});
        } catch (error) {
          if (error.oauthCode === 'invalid_grant') {
            await this.store.change(current => current?.account === saved.account && current?.refresh_token === saved.refresh_token ? null : current);
            this.record = await this.store.read(); this.changed();
          }
          throw error;
        }
        if (this.closed || epoch !== this.epoch) throw abort();
        const record = this.tokenRecord(tokens, saved);
        await this.store.change(current => {
          if (this.closed || epoch !== this.epoch || current?.account !== saved.account || current?.refresh_token !== saved.refresh_token) throw abort();
          return record;
        });
        if (this.closed || epoch !== this.epoch) throw abort();
        this.record = record; this.changed(); return record.access_token;
      };
      const job = this.locks?.request ? this.locks.request('revophone-fish:' + this.scope, refresh) : refresh();
      this.refreshing = job.finally(() => { this.refreshing = null; });
    }
    return this.refreshing;
  }
  async disconnect() {
    ++this.epoch; this.cancelLogin(); this.record = null; this.error = '';
    // Share the refresh lock so a late rotating-token write cannot resurrect a disconnected account.
    const clear = () => this.store.write(null);
    if (this.locks?.request) await this.locks.request('revophone-fish:' + this.scope, clear);
    else { await this.refreshing?.catch(() => {}); await clear(); }
    this.record = null;
    this.changed();
  }
  close() { this.closed = true; ++this.epoch; this.cancelLogin(); this.controller.abort(); this.store.close(); }
}
