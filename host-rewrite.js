// Optional Auto-Rewrite reply-delivery v1. Without this runtime, event handlers
// take their original synchronous path (including when auto rewrite is off).
const RUNTIME = Symbol.for('st.auto-rewrite.standalone');
const keyOf = ctx => `${ctx.groupId ?? ''}|${ctx.characterId ?? ''}|${ctx.getCurrentChatId?.() ?? ctx.chatId ?? ''}`;

export function createStoryRewriteControl(runtime = () => globalThis[RUNTIME]) {
  const watches = new Set();
  const control = () => {
    const api = runtime()?.control;
    return api?.version === 1 && typeof api.getState === 'function' && typeof api.setAuto === 'function' ? api : null;
  };
  function status() {
    const state = control()?.getState();
    return {available: Boolean(state?.available), auto: Boolean(state?.available && state.auto)};
  }
  function requireControl() {
    if (!status().available) throw Error('请安装或启用 Auto-Rewrite 3.1.4 或更新版');
    return control();
  }
  return {status,
    setAuto(value) { requireControl().setAuto(Boolean(value)); return status(); },
    openSettings() { const api = requireControl(); if (typeof api.openSettings !== 'function') throw Error('请更新正文重写扩展'); api.openSettings(); },
    subscribe(listener) {
      const stop = control()?.subscribe?.(listener) ?? (() => {});
      const off = () => { if (watches.delete(off)) stop(); };
      watches.add(off); return off;
    },
    dispose() { for (const off of watches) off(); },
  };
}

export const hasRewriteVersions = message => Boolean(message?.extra?.auto_rewrite_revision
  || message?.swipe_info?.some(info => info?.extra?.auto_rewrite_revision));

export function createRewriteGate({context, runtime = () => globalThis[RUNTIME], notice = () => {}}) {
  const pending = new Map();
  let closed = false;
  function hold(id, type) {
    if (closed) return null;
    const api = runtime()?.replyDelivery;
    if (api?.version !== 1 || typeof api.waitForReply !== 'function') return null;
    return api.waitForReply(id, type);
  }
  function defer(id, kind, action, type) {
    const promise = hold(id, type);
    if (!promise) return false;
    if (!pending.has(promise)) pending.set(promise, new Set());
    const kinds = pending.get(promise);
    if (kinds.has(kind)) return true;
    kinds.add(kind);
    const ctx = context(), key = keyOf(ctx), message = ctx.chat[id];
    // Fire and forget: host eventSource.emit awaits returned promises, so
    // returning this promise would prevent the native swipe from ever starting.
    void promise.then(result => {
      const now = context(), current = now.chat[id];
      if (closed || !result?.ready || keyOf(now) !== key || result.key !== key
        || current !== message || result.message !== current || result.index !== Number(id)
        || (current?.swipe_id ?? 0) !== result.swipeId || current?.mes !== result.text) return;
      return action(Number(id), {count: result.count});
    }).catch(error => notice(error.message)).finally(() => {
      kinds.delete(kind);
      if (!kinds.size) pending.delete(promise);
    });
    return true;
  }
  return {defer, held: (id, type) => Boolean(hold(id, type)), dispose() { closed = true; pending.clear(); }};
}
