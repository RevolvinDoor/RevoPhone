import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeOrgans, editCharacterOrgan, ORGAN_LIMIT} from '../core/character-status.js';
import {normalizeXeno, applyXenoUpdateFromText, extractXenoSession, mergeXenoSession, xenoPromptPlan, defaultXenoPreset, stripXenoUpdate} from '../core/xeno.js';
import {TTSBackend} from '../core/backend.js';
import {freshState} from '../core/state.js';
import {createXenoHost} from '../host-xeno.js';
import {outgoingChat} from '../core/outgoing.js';
import {characterStatusApp} from '../ui/character-status.js';

const base = () => normalizeXeno({cardKey: 'card:a', protagonist: {name: '旅人', physiology: '原有生理描述'}, targets: [{id: 'target:a', name: '同行者'}]});
const tag = (organs, target = '主角') => `<xeno_organs>${JSON.stringify([{target, organs}])}</xeno_organs>`;
const add = entity => editCharacterOrgan(entity, {name: '左眼', appearance: '琥珀色', state: '正常'});
function backendFixture() {
  const b = Object.create(TTSBackend.prototype);
  Object.assign(b, {settings: {...freshState(), xeno: base()}, space: {key: 'card:a', members: []},
    activeChatKey: 'chat:a', xenoFloors: new Map(), routesHere: () => [], notify() {},
    cardState() {return structuredClone(this.settings);},
    saveXeno(update) {const next = structuredClone(this.settings); next.xeno = normalizeXeno(update(next.xeno, next, 'card:a')); this.settings = next; return next.xeno;},
    persistActiveChatXeno: async () => {}});
  return b;
}

test('旧存档不臆造器官；坏数据有界归一化并保持稳定ID', () => {
  assert.deepEqual(base().protagonist.organs, []);
  const rows = normalizeOrgans([null, {}, {name: '左眼', id: 'dup'}, {name: '右眼', id: 'dup', appearance: {}, state: 'x'.repeat(1500), locked: true}]);
  assert.equal(rows.length, 2); assert.notEqual(rows[0].id, rows[1].id);
  assert.equal(rows[1].appearance, ''); assert.equal(rows[1].state.length, 1000);
  assert.deepEqual(normalizeOrgans(rows), rows);
  assert.equal(normalizeOrgans(Array.from({length: 40}, (_, i) => ({name: `部位${i}`}))).length, ORGAN_LIMIT);
});

test('逐项新增编辑删除、名称校验、容量与锁定；后台按角色ID定位且拒绝旧聊天写入', () => {
  const b = backendFixture(), act = patch => b.xenoAct('editCharacterOrgan', {targetKey: 'target:a', chatKey: 'chat:a', ...patch});
  act({name: '左眼', appearance: '琥珀色', state: '正常'});
  const id = b.settings.xeno.targets[0].organs[0].id;
  act({organId: id, operation: 'lock', locked: true});
  assert.throws(() => act({organId: id, operation: 'remove'}), /解锁/);
  assert.throws(() => act({organId: id, name: '右眼'}), /解锁/);
  assert.throws(() => act({organId: id, operation: 'lock', locked: false, chatKey: 'chat:b'}), /切换/);
  act({organId: id, operation: 'lock', locked: false});
  act({organId: id, name: '左眼', appearance: '灰色', state: '闭合'});
  assert.equal(b.settings.xeno.targets[0].organs[0].state, '闭合');
  assert.throws(() => act({name: '左眼'}), /同名/);
  assert.throws(() => act({name: ' '}), /名称/);
  act({organId: id, operation: 'remove'});
  assert.deepEqual(b.settings.xeno.targets[0].organs, []);
  assert.throws(() => act({organId: id, name: '左眼'}), /不存在/);
  const entity = base().protagonist;
  entity.organs = Array.from({length: ORGAN_LIMIT}, (_, i) => ({id: String(i), name: `部位${i}`}));
  assert.throws(() => editCharacterOrgan(entity, {name: '新增'}), /最多/);
});

test('剧情补丁保留未提及字段和器官，锁定项不能改删或由模型解锁；只操作已知角色', () => {
  const xeno = base(); add(xeno.protagonist);
  const id = xeno.protagonist.organs[0].id;
  const text = tag([{id, state: '闭合'}, {name: '右眼', appearance: '灰色'}]);
  const next = applyXenoUpdateFromText(xeno, text);
  assert.equal(xeno.protagonist.organs[0].state, '正常');
  assert.equal(next.protagonist.organs[0].appearance, '琥珀色');
  assert.equal(next.protagonist.organs[0].state, '闭合');
  assert.equal(next.protagonist.physiology, '原有生理描述');
  assert.equal(applyXenoUpdateFromText(xeno, text).protagonist.organs[1].id, next.protagonist.organs[1].id);
  editCharacterOrgan(next.protagonist, {organId: id, operation: 'lock', locked: true});
  const merged = applyXenoUpdateFromText(next, tag([{id, remove: true, locked: false}, {id, state: '变化', locked: false}, {name: '右眼', state: '闭合'}]));
  assert.deepEqual(merged.protagonist.organs[0], next.protagonist.organs[0]);
  assert.equal(merged.protagonist.organs[1].state, '闭合');
  const removed = applyXenoUpdateFromText(merged, tag([{id: merged.protagonist.organs[1].id, remove: true}]));
  assert.equal(removed.protagonist.organs.length, 1);
  assert.equal(applyXenoUpdateFromText(merged, tag([])), null);
  assert.equal(applyXenoUpdateFromText(merged, tag([{name: '眼睛'}], '陌生角色')), null);
  assert.equal(applyXenoUpdateFromText(merged, tag([{name: '眼睛'}], '同行者'), {routes: [{name: '同行者', roleType: 'narrator'}]}), null);
  assert.equal(applyXenoUpdateFromText(merged, `<analysis>${text}</analysis><tts>${text}</tts>`), null);
  assert.equal(applyXenoUpdateFromText(merged, '<xeno_organs>{bad}</xeno_organs>'), null);
});

test('器官随聊天存档和楼层回退恢复，新聊天不继承；隐藏块不进入正文和历史请求', () => {
  const b = backendFixture(); add(b.settings.xeno.protagonist);
  const id = b.settings.xeno.protagonist.organs[0].id;
  editCharacterOrgan(b.settings.xeno.protagonist, {organId: id, operation: 'lock', locked: true});
  const saved = JSON.parse(JSON.stringify(extractXenoSession(b.settings.xeno)));
  assert.deepEqual(mergeXenoSession(b.settings.xeno, saved, 'card:a').protagonist.organs, b.settings.xeno.protagonist.organs);
  assert.deepEqual(mergeXenoSession(b.settings.xeno, null, 'card:a').protagonist.organs, []);
  b.applyXenoFloorReply(2, 0, tag([{id, state: '变化'}]));
  b.xenoAct('editCharacterOrgan', {organId: id, operation: 'lock', locked: false});
  b.applyXenoFloorReply(3, 0, tag([{id, state: '闭合'}]));
  assert.equal(b.settings.xeno.protagonist.organs[0].state, '闭合');
  b.rollbackXenoOnDelete(2);
  assert.equal(b.settings.xeno.protagonist.organs[0].locked, true);
  assert.equal(b.settings.xeno.protagonist.organs[0].state, '正常');
  const text = '故事正文' + tag([{name: '左眼'}]);
  assert.equal(stripXenoUpdate(text), '故事正文');
  assert.equal(outgoingChat([{is_user: false, mes: text}])[0].mes, '故事正文');
  assert.equal(outgoingChat([{is_user: false, mes: text}], {pictures: false, voice: false, sounds: false})[0].mes, '故事正文');
});

test('器官事实与锁定进入提示词；保留旧自定义同步文本，尊重开关和清空', () => {
  const xeno = base(); add(xeno.protagonist);
  const preset = defaultXenoPreset();
  preset.entries.find(e => e.id === 'autoSync').text = '自定义旧同步规则';
  preset.entries = preset.entries.filter(e => e.id !== 'organSyncGuidance');
  xeno.presets = [preset]; xeno.activePreset = preset.id;
  let blocks = xenoPromptPlan(xeno), status = blocks.find(b => b.key === 'sttts.entry.xeno-status').text;
  assert.match(status, /左眼/); assert.match(status, /自定义旧同步规则/); assert.match(status, /<xeno_organs>/);
  const normalized = normalizeXeno(xeno), organRule = normalized.presets[0].entries.find(e => e.id === 'organSyncGuidance');
  organRule.enabled = false;
  assert.doesNotMatch(xenoPromptPlan(normalized).find(b => b.key === 'sttts.entry.xeno-status').text, /<xeno_organs>/);
  organRule.enabled = true; organRule.text = '';
  assert.doesNotMatch(xenoPromptPlan(normalized).find(b => b.key === 'sttts.entry.xeno-status').text, /<xeno_organs>/);
  normalized.autoUpdateTag = false;
  editCharacterOrgan(normalized.protagonist, {organId: normalized.protagonist.organs[0].id, operation: 'lock', locked: true});
  normalized.enabled = false;
  blocks = xenoPromptPlan(normalized);
  assert.match(blocks[0].text, /左眼/); assert.match(blocks[0].text, /正常/);
});

test('手动剧情同步共用器官补丁协议，保留旧预设并拒绝跨聊天异步结果', async () => {
  const b = backendFixture(), requests = []; add(b.settings.xeno.protagonist);
  b.emit = () => {}; b.cardKey = () => 'card:a';
  const id = b.settings.xeno.protagonist.organs[0].id;
  b.generateText = async (ctx, request) => {requests.push(request); return tag([{id, state: '闭合'}]);};
  const host = createXenoHost({backend: b, settings: () => b.settings, context: () => ({name1: '旅人', chat: [{name: '旁白', mes: '旅人闭上了左眼。'}]})});
  await host.syncFromStory();
  assert.match(requests[0].prompt[0].content, /<xeno_organs>/);
  assert.ok(requests[0].prompt[1].content.includes(id));
  assert.equal(b.settings.xeno.protagonist.organs[0].state, '闭合');
  b.settings.xeno.presets[0].entries.find(e => e.id === 'organSyncGuidance').enabled = false;
  b.generateText = async (ctx, request) => {requests.push(request); return '<xeno_sync>主角|旅人|旅客|男|黑发|高挑|原有生理描述||</xeno_sync>';};
  await host.syncFromStory();
  assert.doesNotMatch(requests.at(-1).prompt[0].content, /<xeno_organs>/);
  assert.doesNotMatch(requests.at(-1).prompt[1].content, /按器官规则另输出/);
  b.generateText = async () => {b.activeChatKey = 'chat:b'; return tag([{id, state: '变化'}]);};
  await assert.rejects(host.syncFromStory(), /切换/);
  assert.equal(b.settings.xeno.protagonist.organs[0].state, '闭合');
});

test('器官UI转义数据，新增/编辑/删除使用同一角色与聊天，并拦截旧弹窗', () => {
  const state = {xeno: base()}, listeners = new Map(), calls = [], notices = [];
  add(state.xeno.protagonist); state.xeno.protagonist.organs[0].appearance = '<img onerror=bad>';
  let chat = 'chat:a', dialog, callback;
  const doc = {activeElement: null, addEventListener() {}, createElement: () => root};
  const root = {dataset: {}, ownerDocument: doc, scrollTop: 0, contains: el => !!el,
    querySelectorAll: () => [], querySelector: () => null,
    addEventListener(type, fn) {if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn);}};
  const api = {getState: () => state, subscribe: () => () => {}, statusChatKey: () => chat, xenoAct: (...args) => calls.push(args)};
  const inputs = {'[data-organ-name]': {value: '左眼'}, '[data-organ-appearance]': {value: '灰色'}, '[data-organ-state]': {value: '闭合'}};
  const ctx = {api, doc, win: {AbortController}, notify: message => notices.push(message), dialog(title, html) {
    dialog = {html, body: {addEventListener(type, fn) {callback = fn;}, querySelector: selector => inputs[selector]}, close() {}}; return dialog;
  }};
  const view = characterStatusApp(ctx), id = state.xeno.protagonist.organs[0].id;
  assert.match(root.innerHTML, /器官记录/); assert.match(root.innerHTML, /&lt;img onerror=bad&gt;/);
  const click = organId => {const el = {dataset: {organEdit: organId}, matches: () => false, closest: selector => selector === '[data-organ-edit]' ? el : null}; for (const fn of listeners.get('click')) fn({target: el, preventDefault() {}});};
  const submit = selector => callback({target: {closest: query => query === selector}});
  click(id); assert.match(dialog.html, /删除本条/);
  submit('[data-organ-save]'); assert.equal(calls.at(-1)[1].organId, id); assert.equal(calls.at(-1)[1].state, '闭合');
  click(id); submit('[data-organ-remove]'); assert.equal(calls.at(-1)[1].operation, 'remove');
  click(''); assert.doesNotMatch(dialog.html, /删除本条/); submit('[data-organ-save]'); assert.equal(calls.at(-1)[1].organId, undefined);
  click(id); chat = 'chat:b'; const count = calls.length; submit('[data-organ-save]');
  assert.equal(calls.length, count); assert.match(notices.at(-1), /切换/);
  view.dispose();
});
