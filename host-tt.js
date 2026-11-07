// TauriTavern enhanced host API bridge (window.__TAURITAVERN__.api.chat & api.extension.store)
// with automatic fallback for standard SillyTavern environments.

import {lexicalScores} from './core/memory.js';
import {plainStory} from './core/chat.js';
import {withoutPictures} from './core/draw.js';

export const TT_NAMESPACE = 'revophone';

/** Converts an arbitrary ID/name into a key matching TauriTavern's [A-Za-z0-9_.-] rule. */
export function toSafeStoreKey(raw) {
  const str = String(raw ?? '').trim();
  if (!str) return 'empty';
  if (/^[A-Za-z0-9][A-Za-z0-9_.-]{0,118}$/.test(str) && str !== '.' && str !== '..') {
    return str;
  }
  const bytes = new TextEncoder().encode(str);
  let out = 'k_';
  for (const b of bytes) {
    const ch = String.fromCharCode(b);
    out += /^[A-Za-z0-9_-]$/.test(ch) ? ch : '_' + b.toString(16).padStart(2, '0');
    if (out.length >= 116) break;
  }
  return out;
}

export function hasTauriTavern() {
  const win = globalThis.window || globalThis;
  return Boolean(win?.__TAURITAVERN__);
}

export async function waitTauriTavernReady(timeoutMs = 2500) {
  const win = globalThis.window || globalThis;
  const ready = win?.__TAURITAVERN__?.ready ?? win?.__TAURITAVERN_MAIN_READY__;
  if (!ready) return hasTauriTavern();
  try {
    await Promise.race([
      Promise.resolve(ready),
      new Promise(resolve => setTimeout(resolve, timeoutMs))
    ]);
    return hasTauriTavern();
  } catch {
    return false;
  }
}

export async function getTTChatHandle() {
  if (!await waitTauriTavernReady()) return null;
  const win = globalThis.window || globalThis;
  try {
    return win?.__TAURITAVERN__?.api?.chat?.current?.handle?.() || null;
  } catch {
    return null;
  }
}

export async function getTTExtensionStore() {
  if (!await waitTauriTavernReady()) return null;
  const win = globalThis.window || globalThis;
  try {
    return win?.__TAURITAVERN__?.api?.extension?.store || null;
  } catch {
    return null;
  }
}

/** Returns a deterministic per-chat identifier for the currently open chat. */
export function getActiveChatKey(context, fallbackSpaceKey = '') {
  const win = globalThis.window || globalThis;
  try {
    const ref = win?.__TAURITAVERN__?.api?.chat?.current?.ref?.();
    if (ref?.kind === 'character' && ref.characterId && ref.fileName) {
      return `tt:char:${ref.characterId}:${ref.fileName}`;
    }
    if (ref?.kind === 'group' && ref.chatId) {
      return `tt:group:${ref.chatId}`;
    }
  } catch {}
  const ctx = typeof context === 'function' ? context() : context;
  const chatId = String(ctx?.getCurrentChatId?.() ?? ctx?.chatId ?? '').trim();
  const space = String(fallbackSpaceKey || (ctx?.groupId ? `group:${ctx.groupId}` : ctx?.characterId !== undefined ? `card:${ctx?.characters?.[ctx.characterId]?.avatar || ctx.characterId}` : '')).trim();
  if (!chatId && !space) return '';
  return `${space}|${chatId || 'default'}`;
}

/**
 * Uses TauriTavern's Rust-backed `locate.findLastMessage()` when available,
 * falling back to a bounded reverse scan of `context().chat`.
 */
export async function findLastChatMessage(context, {role, hasExtraKeys, scanLimit = 2000} = {}) {
  const handle = await getTTChatHandle();
  if (handle?.locate?.findLastMessage) {
    try {
      const hit = await handle.locate.findLastMessage({
        ...(role ? {role} : {}),
        ...(Array.isArray(hasExtraKeys) && hasExtraKeys.length ? {hasExtraKeys} : {}),
        ...(scanLimit ? {scanLimit} : {})
      });
      if (hit && Number.isInteger(hit.index)) return hit;
    } catch {}
  }
  const ctx = typeof context === 'function' ? context() : context;
  const chat = Array.isArray(ctx?.chat) ? ctx.chat : [];
  const minIndex = Math.max(0, chat.length - (Number(scanLimit) || 2000));
  for (let i = chat.length - 1; i >= minIndex; i--) {
    const m = chat[i];
    if (!m) continue;
    if (role === 'assistant' && (m.is_user || m.is_system)) continue;
    if (role === 'user' && (!m.is_user || m.is_system)) continue;
    if (role === 'system' && !m.is_system) continue;
    if (Array.isArray(hasExtraKeys) && hasExtraKeys.length) {
      if (!m.extra || !hasExtraKeys.every(k => m.extra[k] !== undefined)) continue;
    }
    return {index: i, message: m};
  }
  return null;
}

/**
 * Uses TauriTavern's Rust-backed `handle.searchMessages()` (with CJK bigram indexing)
 * to search chat history, falling back to local lexical scoring when not in TauriTavern.
 */
export async function searchStoryMessages(context, {
  query = '',
  limit = 6,
  role,
  startIndex = 0,
  endIndex,
  scanLimit = 3000
} = {}) {
  const cleanQuery = String(query ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!cleanQuery || limit <= 0) return [];
  const ctx = typeof context === 'function' ? context() : context;
  const chat = Array.isArray(ctx?.chat) ? ctx.chat : [];
  const maxEnd = Number.isInteger(endIndex) ? Math.min(chat.length, Math.max(0, endIndex)) : chat.length;
  const minStart = Math.max(0, Number.isInteger(startIndex) ? startIndex : 0, maxEnd - (Number(scanLimit) || 3000));
  if (maxEnd <= minStart) return [];

  const handle = await getTTChatHandle();
  if (handle?.searchMessages) {
    try {
      const hits = await handle.searchMessages({
        query: cleanQuery,
        limit,
        filters: {
          ...(role ? {role} : {}),
          startIndex: minStart,
          endIndex: maxEnd,
          scanLimit: Number(scanLimit) || 3000
        }
      });
      if (Array.isArray(hits)) {
        return hits
          .filter(h => h && Number.isInteger(h.index) && h.index >= minStart && h.index < maxEnd && h.role !== 'system')
          .slice(0, limit)
          .map(h => {
            const msg = chat[h.index];
            const rawText = String(h.text || msg?.mes || '');
            const cleaned = plainStory(withoutPictures(rawText)).replace(/\s+/g, ' ').trim();
            const speaker = msg?.name || (h.role === 'user' || msg?.is_user ? (ctx?.name1 || '我') : (ctx?.name2 || '角色'));
            return {
              index: h.index,
              score: Number(h.score) || 0,
              role: h.role || (msg?.is_user ? 'user' : 'assistant'),
              name: speaker,
              snippet: plainStory(withoutPictures(String(h.snippet || cleaned))).replace(/\s+/g, ' ').trim().slice(0, 220),
              text: cleaned.slice(0, 420)
            };
          })
          .filter(h => h.text || h.snippet);
      }
    } catch {}
  }

  // Fallback lexical search for standard SillyTavern
  const candidates = [];
  for (let i = minStart; i < maxEnd; i++) {
    const m = chat[i];
    if (!m || m.is_system) continue;
    if (role === 'assistant' && m.is_user) continue;
    if (role === 'user' && !m.is_user) continue;
    const cleaned = plainStory(withoutPictures(String(m.mes || ''))).replace(/\s+/g, ' ').trim();
    if (!cleaned) continue;
    const speaker = m.name || (m.is_user ? (ctx?.name1 || '我') : (ctx?.name2 || '角色'));
    candidates.push({
      index: i,
      role: m.is_user ? 'user' : 'assistant',
      name: speaker,
      text: `${speaker}: ${cleaned}`,
      cleanText: cleaned
    });
  }
  if (!candidates.length) return [];
  const scores = lexicalScores(candidates, cleanQuery);
  return candidates
    .map((c, idx) => ({...c, score: scores[idx] || 0}))
    .filter(c => c.score > 0.05)
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, limit)
    .sort((a, b) => a.index - b.index)
    .map(c => ({
      index: c.index,
      score: c.score,
      role: c.role,
      name: c.name,
      snippet: c.cleanText.slice(0, 220),
      text: c.cleanText.slice(0, 420)
    }));
}

/** Per-chat JSON store (`handle.store.*`) in TauriTavern. */
export async function getChatStoreJson(key, {namespace = TT_NAMESPACE} = {}) {
  const handle = await getTTChatHandle();
  if (!handle?.store?.getJson) return null;
  try {
    return await handle.store.getJson({namespace, key: toSafeStoreKey(key)});
  } catch {
    return null;
  }
}

export async function setChatStoreJson(key, value, {namespace = TT_NAMESPACE} = {}) {
  const handle = await getTTChatHandle();
  if (!handle?.store?.setJson) return false;
  try {
    await handle.store.setJson({namespace, key: toSafeStoreKey(key), value});
    return true;
  } catch {
    return false;
  }
}

export async function deleteChatStoreJson(key, {namespace = TT_NAMESPACE} = {}) {
  const handle = await getTTChatHandle();
  if (!handle?.store?.deleteJson) return false;
  try {
    await handle.store.deleteJson({namespace, key: toSafeStoreKey(key)});
    return true;
  } catch {
    return false;
  }
}

/** Per-chat lightweight metadata (`handle.metadata.*`) in TauriTavern. */
export async function getChatMetadataExtension(context, {namespace = TT_NAMESPACE} = {}) {
  const handle = await getTTChatHandle();
  if (handle?.metadata?.get) {
    try {
      const meta = await handle.metadata.get();
      if (meta?.extensions && namespace in meta.extensions) {
        return meta.extensions[namespace];
      }
    } catch {}
  }
  const ctx = typeof context === 'function' ? context() : context;
  return ctx?.chatMetadata?.extensions?.[namespace] ?? null;
}

export async function setChatMetadataExtension(context, value, {namespace = TT_NAMESPACE} = {}) {
  const ctx = typeof context === 'function' ? context() : context;
  if (ctx?.chatMetadata) {
    ctx.chatMetadata.extensions ??= {};
    if (value === null) delete ctx.chatMetadata.extensions[namespace];
    else ctx.chatMetadata.extensions[namespace] = value;
  }
  const handle = await getTTChatHandle();
  if (handle?.metadata?.setExtension) {
    try {
      await handle.metadata.setExtension({namespace, value});
      return true;
    } catch {}
  }
  try {
    ctx?.saveMetadataDebounced?.();
  } catch {}
  return false;
}

/** Global extension store (`window.__TAURITAVERN__.api.extension.store`) in TauriTavern. */
export async function getExtStoreJson(key, {table = 'main', namespace = TT_NAMESPACE} = {}) {
  const store = await getTTExtensionStore();
  if (!store?.tryGetJson) return null;
  try {
    const res = await store.tryGetJson({namespace, table: toSafeStoreKey(table), key: toSafeStoreKey(key)});
    return res?.found ? res.value : null;
  } catch {
    return null;
  }
}

export async function setExtStoreJson(key, value, {table = 'main', namespace = TT_NAMESPACE} = {}) {
  const store = await getTTExtensionStore();
  if (!store?.setJson) return false;
  try {
    await store.setJson({namespace, table: toSafeStoreKey(table), key: toSafeStoreKey(key), value});
    return true;
  } catch {
    return false;
  }
}

export async function deleteExtStoreJson(key, {table = 'main', namespace = TT_NAMESPACE} = {}) {
  const store = await getTTExtensionStore();
  if (!store?.deleteJson) return false;
  try {
    await store.deleteJson({namespace, table: toSafeStoreKey(table), key: toSafeStoreKey(key)});
    return true;
  } catch {
    return false;
  }
}

export async function listExtStoreKeys({table = 'main', namespace = TT_NAMESPACE} = {}) {
  const store = await getTTExtensionStore();
  if (!store?.listKeys) return [];
  try {
    const keys = await store.listKeys({namespace, table: toSafeStoreKey(table)});
    return Array.isArray(keys) ? keys : [];
  } catch {
    return [];
  }
}
