// 系统提示词: the blocks of core/prompt-rule-defaults.js, with what the user changed (settings.promptRules), filled in.
// settings.promptRules: {[block id]: {enabled?, parts: {[part key]: text}}, legacy?: [{id, text, enabled}]} — legacy keeps
// what was changed in the sentence-by-sentence rules of 0.8.0–0.8.22, which no longer apply, so it can be copied over.
import {PROMPT_BLOCKS} from './prompt-rule-defaults.js';
export {PROMPT_BLOCKS};

const BLOCKS = new Map(PROMPT_BLOCKS.map(b => [b.id, b]));
const MAX = 20000;
// Request-local provenance, never serialized or sent to providers. This keeps
// the new role-support check from changing legacy Xeno prelude behavior.
const XIAOCI_REQUESTS = new WeakSet();
export const isXiaociRequest = messages => XIAOCI_REQUESTS.has(messages);

export function normalizePromptRules(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {}, legacy = Array.isArray(value.legacy) ? value.legacy.filter(x => x && typeof x.id === 'string' && typeof x.text === 'string') : [];
  for (const [id, rule] of Object.entries(value)) {
    if (id === 'legacy' || !rule || typeof rule !== 'object') continue;
    const block = BLOCKS.get(id);
    if (!block) {
      // A sentence of the old rules (chat.buildChatRequest.006 and the like): kept to look at, not used.
      if (typeof rule.text === 'string' && !legacy.some(x => x.id === id)) legacy.push({id, text: rule.text, enabled: rule.enabled !== false});
      continue;
    }
    const parts = {};
    for (const p of block.parts) if (typeof rule.parts?.[p.key] === 'string') parts[p.key] = rule.parts[p.key].slice(0, MAX);
    const kept = {...(block.optional && typeof rule.enabled === 'boolean' ? {enabled: rule.enabled} : {}), ...(Object.keys(parts).length ? {parts} : {})};
    if (Object.keys(kept).length) out[id] = kept;
  }
  if (legacy.length) out.legacy = legacy.slice(0, 300).map(x => ({id: x.id.slice(0, 80), text: x.text.slice(0, MAX), enabled: x.enabled !== false}));
  return out;
}

/** Whether a block is in use: optional ones can be turned off (some start off). */
export function promptOn(overrides, id) {
  const block = BLOCKS.get(id);
  if (!block) throw Error('未知提示词：' + id);
  if (!block.optional) return true;
  const own = overrides?.[id]?.enabled;
  return typeof own === 'boolean' ? own : !block.off;
}
/** A part of a block as the user has it (or as shipped). */
export function promptTemplate(overrides, id, part) {
  const block = BLOCKS.get(id), base = block?.parts.find(p => p.key === part);
  if (!base) throw Error('未知提示词：' + id + ' · ' + part);
  const own = overrides?.[id]?.parts?.[part];
  return typeof own === 'string' ? own : base.text;
}
/** A part of a block, filled in with values; '' when the block is off. */
export function promptText(overrides, id, part, values = {}) {
  if (!promptOn(overrides, id)) return '';
  return fillPrompt(promptTemplate(overrides, id, part), values);
}

/** A complete pair only: disabling/clearing either half never leaves an orphan
 * assistant message. Multiple tasks in one request share one identity and pair. */
export function xiaociPrelude(overrides, scenes, values = {}) {
  if (!promptOn(overrides, 'xiaoci')) return [];
  const identity = promptText(overrides, 'xiaoci', 'identity');
  const users = [], assistants = [];
  for (const scene of new Set(Array.isArray(scenes) ? scenes : [scenes])) {
    const id = 'xiaoci-' + scene;
    const vars = {'用户': 'Master', ...values, '小此人设': assistants.length ? '' : identity};
    const user = promptText(overrides, id, 'user', vars);
    const assistant = promptText(overrides, id, 'assistant', vars);
    if (!user.trim() || !assistant.trim()) continue;
    users.push(user);
    assistants.push(assistant);
  }
  return users.length ? [{role: 'user', content: users.join('\n\n')}, {role: 'assistant', content: assistants.join('\n\n')}] : [];
}

export function withXiaoci(overrides, scenes, messages, values = {}) {
  const prelude = xiaociPrelude(overrides, scenes, values);
  if (!prelude.length) return messages;
  // Most callers already start with their task's system. Imported Assistant
  // presets may start with another role, so keep an explicit task boundary.
  const system = messages[0]?.role === 'system' ? [] : [{role: 'system', content: '按下面的功能规则、参考资料和本轮用户输入完成当前任务。'}];
  const request = [...prelude, ...system, ...messages];
  XIAOCI_REQUESTS.add(request);
  return request;
}

/** Final Chat Completion payload hook. Background generateRaw/Assistant requests
 * use type=quiet and already own their preludes; never apply story roles there. */
export function prependStoryXiaoci(payload, overrides, scenes, values = {}) {
  if (!['normal', 'regenerate', 'swipe', 'continue'].includes(payload?.type) || !Array.isArray(payload.messages)) return false;
  const prelude = xiaociPrelude(overrides, scenes, values);
  if (!prelude.length || prelude.every((message, i) =>
    payload.messages[i]?.role === message.role && payload.messages[i]?.content === message.content)) return false;
  payload.messages = withXiaoci(overrides, scenes, payload.messages, values);
  return true;
}

const has = v => Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
const SECTION = /\{\{([#^])\s*([^{}#^/]+?)\s*\}\}([\s\S]*?)\{\{\/\s*\2\s*\}\}/;
const MARK = '\u0003';
/**
 * Fills a template: {{名字}} with values[名字]; {{#名字}}…{{/名字}} kept when it has something, {{^名字}}…{{/名字}}
 * when not. A line that had marks and comes out empty goes (no blank line where a section was left out). Names not
 * given are left as they are (another step fills them). What is filled in is never read as a template itself.
 */
export function fillPrompt(template, values = {}) {
  let text = String(template ?? '').split('\n').map(line => /\{\{[^{}]+\}\}/.test(line) ? line + MARK : line).join('\n');
  for (let i = 0; i < 500; i++) {
    const m = SECTION.exec(text);
    if (!m) break;
    const keep = (m[1] === '#') === has(values[m[2]]);
    text = text.slice(0, m.index) + (keep ? m[3] : '') + text.slice(m.index + m[0].length);
  }
  const filled = [];
  text = text.replace(/\{\{\s*([^{}#^/][^{}]*?)\s*\}\}/g, (all, name) => {
    if (!Object.hasOwn(values, name)) return all;
    const v = values[name], s = v === undefined || v === null || v === false ? '' : String(v);
    if (!s) return '';
    filled.push(s);
    return '\u0000' + (filled.length - 1) + '\u0000';
  });
  text = text.split('\n').filter(line => !(line.includes(MARK) && !line.replaceAll(MARK, '').trim())).join('\n').replaceAll(MARK, '');
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return text.replace(/\u0000(\d+)\u0000/g, (all, i) => filled[Number(i)]);
}
