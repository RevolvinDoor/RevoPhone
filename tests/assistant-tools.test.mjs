import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssistantTools, createAssistantToolSession, parseAssistantCalls, publicToolValue, assistantOperations} from '../core/assistant-tools.js';
import {freshState, normalizeSettings} from '../core/state.js';
import {normalizeXeno} from '../core/xeno.js';
import {createAssistantHost} from '../host-assistant.js';
import {createXenoHost} from '../host-xeno.js';
import {assistantMeta} from '../core/assistant.js';
import {assistantOperationHTML} from '../ui/assistant.js';
import {normalizeAssistantThreads} from '../core/data-transfer.js';
import {MemoryStore} from './helpers.mjs';

const block = (...calls) => '```revophone\n' + JSON.stringify({calls}) + '\n```';
const call = (id, name, ...args) => ({id, name, args});
test('只有完整的独立操作块会执行，示例、嵌套代码、HTML和非法参数不会执行', () => {
  const command = block(call('a', 'phone.tools', 'mall'));
  assert.equal(parseAssistantCalls(command)[0].name, 'phone.tools');
  for (const text of ['示例如下：\n' + command, '<pre>' + command + '</pre>', '```text\n' + command + '\n```', '这只是在讨论上架']) assert.equal(parseAssistantCalls(text), null);
  assert.throws(() => parseAssistantCalls('```revophone\n{"calls":[]}'), /不完整/);
  assert.throws(() => parseAssistantCalls(block(call('a', 'saveText', {apiKey: 'never'}))), /凭据/);
  assert.throws(() => parseAssistantCalls('```revophone\n{"calls":[{"id":"a","name":"saveText","args":[{"__proto__":{}}]}]}\n```'), /凭据/);
});

test('分组仅列出存在的功能，查询状态不会给模型凭据和媒体本体', async () => {
  const s = freshState(); s.text.apiKey = 'hidden'; s.text.token = 'hidden-token'; s.text.headers = {Authorization: 'hidden'};
  const tools = createAssistantTools({backend: {api: () => ({saveNote() {}})}, settings: () => s});
  const media = await tools.execute(call('a', 'phone.tools', 'media'));
  assert.deepEqual(media.map(row => row.name), ['saveNote']);
  const state = await tools.execute(call('b', 'phone.state', 'text'));
  assert.equal(JSON.stringify(state).includes('hidden'), false);
  assert.throws(() => tools.definition('setKey'), /没有这个/);
  assert.deepEqual(publicToolValue({id: 'p', imageData: 'data:image/png;base64,AA=='}), {id: 'p'});
  assert.equal(normalizeSettings({...s, assistant: {...s.assistant, actions: false}}).assistant.actions, false);
});

test('操作持久化后重试不重复；同编号改参数、并发执行和重生成不能重复副作用', async () => {
  const store = new MemoryStore();
  let writes = 0, release;
  const tools = {definition: () => ({read: false, description: '真实写入'}), execute: async () => { writes++; await new Promise(resolve => {release = resolve;}); return {id: 'item1'}; }};
  const options = {store, threadId: 't', turnId: 'u', chatKey: 'card|chat', tools, check() {}};
  const one = await createAssistantToolSession(options), two = await createAssistantToolSession(options);
  const pending = one.run(call('a', 'write', {name: '商品'}), {});
  while (!release) await new Promise(resolve => setImmediate(resolve));
  const concurrent = await two.run(call('b', 'write', {name: '商品'}), {});
  assert.equal(concurrent.ok, false); assert.equal(writes, 1);
  release(); assert.equal((await pending).ok, true);
  const retry = await createAssistantToolSession(options);
  assert.equal((await retry.run(call('c', 'write', {name: '商品'}), {})).reused, true);
  assert.equal(writes, 1);
  await assert.rejects(retry.run(call('a', 'write', {name: '不同商品'}), {}), /编号已用于/);
  const reroll = await createAssistantToolSession({...options, readOnly: true});
  assert.equal((await reroll.run(call('d', 'write', {}), {})).ok, false);
  assert.equal(writes, 1);
});

test('真实助手→商城设计工作台→上架→确认费用后配图，重试不会重复进货', async () => {
  const s = freshState(); s.assistant.memory.enabled = false;
  const store = new MemoryStore();
  let thread = {id: 'assistant1', kind: 'assistant', at: 1, revision: 0, messages: [{id: 'u1', role: 'user', text: '制作银发精灵皮躯上架商店，售价1800，再配图', at: 1}]};
  let restocks = 0, generated = 0, imageAttempts = 0, paid = false, mode = 'normal';
  const userCall = call('stock', 'mallRestock', {category: 'skin_suit', text: '银发精灵皮躯', name: '银发精灵皮躯', price: 1800});
  const api = {
    xenoAct(action, patch) {
      assert.equal(action, 'saveItem');
      const item = s.xeno.items.find(row => row.id === patch.id);
      assert.ok(item); Object.assign(item, patch); return structuredClone(s.xeno);
    }
  };
  const backend = {
    activeChatKey: 'card:a|old', apps: store, closed: false, emit() {}, cardKey: () => 'card:a',
    cardState: () => structuredClone(s), api: () => api, drawReady: () => false,
    saveXeno(update) { s.xeno = normalizeXeno(update(structuredClone(s.xeno))); },
    async generateText(ctx, request) {
      restocks++;
      assert.deepEqual(request.prompt.slice(0, 3).map(row => row.role), ['user','assistant','system']);
      return '<skin_suit_design name="银发精灵">\n[外观视觉还原]\n银发与精灵耳。\n[生图提示词 (Prompt)]\nsilver hair, elf\n</skin_suit_design>\n价格：1200\n简称：银发精灵';
    },
    assistantThread: async () => structuredClone(thread),
    async appendAssistantMessage(id, message) { thread.messages.push({id: crypto.randomUUID(), at: Date.now(), ...message}); thread.revision++; return structuredClone(thread); },
    async addAssistantVariant(id, mid, value) { Object.assign(thread.messages.find(m => m.id === mid), value); thread.revision++; return structuredClone(thread); }
  };
  const context = () => ({name1: '主角', mainApi: 'openai', chat: [], getCurrentChatId: () => 'old'});
  const xeno = createXenoHost({context, settings: () => s, backend});
  const tools = createAssistantTools({backend, settings: () => s, hosts: () => ({
    mallRestock: xeno.mallRestock,
    mallPicture: async itemId => {
      imageAttempts++;
      assert.ok(s.xeno.items.some(item => item.id === itemId));
      if (!paid) throw Object.assign(Error('确认费用'), {code: 'PAID'});
      generated++; api.xenoAct('saveItem', {id: itemId, imageData: 'data:image/png;base64,AA=='});
      return {photoId: 'photo1', itemId, prompt: 'silver hair, elf', imageSaved: true};
    }
  })});
  const host = createAssistantHost({context, settings: () => s, backend, tools, request: async (ctx, b, settings, messages) => {
    assert.deepEqual(messages.slice(0, 3).map(row => row.role), ['user','assistant','system']);
    if (mode === 'reroll' && !messages.some(row => typeof row.content === 'string' && row.content.includes('重新生成回复只查询'))) return {text: block(userCall)};
    if (mode === 'reroll') return {text: '商品已存在，本次只重写说明。'};
    const tasks = (await store.list('assistant-task'))[0]?.calls || [];
    if (!tasks.length) return {text: block(userCall)};
    const created = tasks.find(row => row.name === 'mallRestock')?.result;
    if (!tasks.some(row => row.name === 'mallPicture' && row.status === 'done')) return {text: block(call('picture', 'mallPicture', created.id))};
    return {text: '银发精灵皮躯已上架，售价1800，商品图已绑定。'};
  }});
  try {
    await assert.rejects(host.reply(thread.id), error => error.code === 'PAID');
    assert.equal(restocks, 1);
    const created = s.xeno.items.find(item => item.name === '银发精灵皮躯');
    assert.equal(created.price, 1800); assert.equal(created.owned, false); assert.equal(created.source, 'restock');
    paid = true; await host.reply(thread.id, '', {allowPaid: true});
    assert.equal(restocks, 1); assert.equal(generated, 1); assert.equal(imageAttempts, 2);
    assert.equal(thread.messages.at(-1).meta.operations.length, 2);
    assert.equal(thread.messages.at(-1).meta.image.photoId, 'photo1');
    const mid = thread.messages.at(-1).id;
    mode = 'reroll'; await host.reroll(thread.id, mid);
    assert.equal(restocks, 1); assert.equal(generated, 1);
  } finally { host.close(); }
});

test('普通功能直接修改真实数据；付费参数不能由模型自行授权', async () => {
  const notes = [], inputs = [];
  const tools = createAssistantTools({backend: {api: () => ({
    saveNote: async row => { notes.push(row); return {...row, id: 'n1'}; },
    generateImage: async input => { inputs.push(input); return {photoId: 'p1'}; }
  })}, settings: freshState});
  const result = await tools.execute(call('n', 'saveNote', {title: '待办', text: '买面包'}));
  assert.equal(notes.length, 1); assert.equal(result.id, 'n1');
  await tools.execute(call('g', 'generateImage', {prompt: 'landscape', allowPaid: true}));
  assert.equal(inputs[0].allowPaid, false);
});

test('操作记录能保存、导入导出并安全显示，HTML内容不会执行', () => {
  const rows = assistantOperations([{id: 'a', name: 'mallRestock', label: '<script>bad()</script>', status: 'done', result: {id: 'i1', name: '银发精灵', price: 1800}}]);
  const meta = assistantMeta({operations: rows});
  assert.equal(meta.operations[0].detail.includes('1800'), true);
  const html = assistantOperationHTML(meta.operations);
  assert.equal(html.includes('<script>'), false); assert.match(html, /&lt;script&gt;/);
  const thread = {id: 'assistant:t', kind: 'assistant', title: '商品', createdAt: 1, at: 1, updatedAt: 2, messages: [{id: 'u', role: 'user', text: '上架', at: 1}, {id: 'a', role: 'assistant', text: '完成', at: 2, meta}]};
  assert.deepEqual(normalizeAssistantThreads([thread])[0].messages[1].meta.operations, meta.operations);
});

test('完整预设保留长文本和全部条目；列表分页与状态路径不泄漏凭据', async () => {
  const s = freshState(), long = '完整提示词'.repeat(1600);
  s.xeno.presets = [{id: 'long', name: '长预设', entries: Array.from({length: 120}, (_, i) => ({id: 'e' + i, text: i ? '规则' : long}))}];
  s.routes = Array.from({length: 63}, (_, i) => ({id: 'r' + i, name: '角色' + i}));
  s.text.keyPool = ['secret-value']; s.text.headers = {Authorization: 'secret-header'};
  const tools = createAssistantTools({backend: {api: () => ({})}, settings: () => s});
  const preset = await tools.execute(call('a', 'phone.state', 'xeno', 'presets.long'));
  assert.equal(preset.entries.length, 120); assert.equal(preset.entries[0].text, long);
  const page = await tools.execute(call('b', 'phone.state', 'routes', '', 50, 13));
  assert.equal(page.total, 63); assert.equal(page.items[0].id, 'r50'); assert.equal(page.hasMore, false);
  for (const path of ['keyPool', 'keyPool.0', 'headers']) {
    assert.equal(await tools.execute(call('c', 'phone.state', 'text', path)), null);
  }
  await assert.rejects(tools.execute(call('c', 'phone.state', 'text', 'headers.Authorization')), /不支持/);
  s.xeno.presets[0].entries[0].text = long.repeat(5);
  assert.equal((await tools.execute(call('d', 'phone.state', 'xeno', 'presets.long'))).truncated, true);
  assert.deepEqual((await tools.execute(call('e', 'phone.xenoActions'))).options.possessionModes, ['浅层共鸣', '意识共存', '完全占据', '认知覆盖']);
});

test('费用确认只授权原操作；换绘图配置或同轮新增操作必须再确认', async () => {
  const store = new MemoryStore(); let billing = 'model-a', charges = 0;
  const tools = {
    definition: () => ({read: false, description: '生成图片'}), billingState: () => billing,
    execute: async (input, options) => {
      if (!options.allowPaid) throw Object.assign(Error('确认费用'), {code: 'PAID'});
      charges++; return {photoId: input.id};
    }
  };
  const options = {store, threadId: 't', turnId: 'u', chatKey: 'chat', tools, check() {}};
  const first = await createAssistantToolSession(options), a = call('a', 'draw', 'first');
  await assert.rejects(first.run(a, {allowPaid: true}), {code: 'PAID'});
  const approved = await createAssistantToolSession(options);
  billing = 'model-b';
  await assert.rejects(approved.run(a, {allowPaid: true}), {code: 'PAID'});
  assert.equal(charges, 0);
  const retry = await createAssistantToolSession(options);
  assert.equal((await retry.run(a, {allowPaid: true})).ok, true);
  await assert.rejects(retry.run(call('b', 'draw', 'second'), {allowPaid: true}), {code: 'PAID'});
  assert.equal(charges, 1);
  const resume = await createAssistantToolSession(options);
  assert.equal((await resume.run(call('b', 'draw', 'second'), {allowPaid: true})).ok, true);
  assert.equal(charges, 2);
});

test('助手实际操作后切换正文，保留已完成记录并停止同批后续操作', async () => {
  const s = freshState(); s.assistant.memory.enabled = false;
  const store = new MemoryStore();
  const thread = {id: 't', revision: 0, messages: [{id: 'u', role: 'user', text: '保存两条备忘录', at: 1}]};
  let writes = 0, requests = 0;
  const backend = {activeChatKey: 'old', cardKey: () => 'card:a', apps: store, emit() {}, drawReady: () => false,
    assistantThread: async () => structuredClone(thread),
    api: () => ({saveNote: row => {writes++; backend.activeChatKey = 'new'; return {...row, id: 'n1'};}})
  };
  const tools = createAssistantTools({backend, settings: () => s});
  const host = createAssistantHost({backend, tools, settings: () => s, context: () => ({mainApi: 'openai', chat: []}),
    request: async () => {requests++; return {text: block(call('a', 'saveNote', {text: '第一条'}), call('b', 'saveNote', {text: '第二条'}))};}
  });
  try {
    await assert.rejects(host.reply('t'), /聊天已切换/);
    assert.equal(writes, 1); assert.equal(requests, 1);
    const tasks = await store.list('assistant-task');
    assert.equal(tasks[0].calls.length, 1); assert.equal(tasks[0].calls[0].status, 'done');
    assert.equal(thread.messages.length, 1);
  } finally {host.close();}
});

test('剧情同步等待模型期间切换正文，不写入新聊天状态', async () => {
  const s = freshState(); s.chat.presets[0].lore = false;
  let finish, writes = 0;
  const backend = {activeChatKey: 'old', cardKey: () => 'card:a', emit() {},
    routesHere: () => [], cardState: () => s,
    generateText: async () => new Promise(resolve => {finish = resolve;}),
    saveXeno: () => {writes++;}
  };
  const host = createXenoHost({backend, settings: () => s, context: () => ({name1: '主角', chat: [{name: '角色', mes: '在花园见面。'}]})});
  const work = host.syncFromStory();
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  backend.activeChatKey = 'new';
  finish('<xeno_sync>主角｜主角｜访客｜女｜银发｜高挑｜健康</xeno_sync>');
  await assert.rejects(work, /聊天已切换/); assert.equal(writes, 0);
});
