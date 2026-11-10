import test from 'node:test';
import assert from 'node:assert/strict';
import {freshState} from '../core/state.js';
import {TTSBackend} from '../core/backend.js';
import {normalizeXeno, normalizeCatalogItem, xenoRegisterItem, xenoEquipItem, xenoUnequipSlot, xenoUpdateMountOption,
  effectiveEntityView, resolveWear, xenoPromptPlan, extractXenoSession, buildEntityPortraitPrompt} from '../core/xeno.js';
import {applyWardrobeReply, wardrobeActionPlan, matchWardrobeItems} from '../core/xeno-actions.js';
import {createXenoHost} from '../host-xeno.js';
import {createAssistantTools} from '../core/assistant-tools.js';
import {itemStructureFields, openItemEditor} from '../ui/xeno-item-editor.js';
import {generateItemPreview} from '../xeno-images.js';

const base = () => normalizeXeno({protagonist: {id: '__protagonist__', name: '旅人', gender: '男'}, cardKey: 'card:a'});
const itemInput = {name: '星霜', category: 'skin_suit', gender: '女', abilities: '夜视：低光中看清道路',
  abilityConditions: '仅低光环境；不提供透视', lowerBodyMode: 'replace', lowerBodyType: 'auto'};
const command = (evidence = '你制作完成了名为星霜的女性皮躯。', extra = []) =>
  evidence + (extra.length ? '\n你穿上了星霜。' : '') + '<xeno_action>' + JSON.stringify([
    {action: 'register', target: '主角', item: itemInput, evidence}, ...extra
  ]) + '</xeno_action>';
function backendFixture() {
  const b = Object.create(TTSBackend.prototype);
  Object.assign(b, {settings: {...freshState(), xeno: base()}, closed: false, space: {key: 'card:a', name: '卡A', members: []},
    activeChatKey: 'chat:a', xenoFloors: new Map(), xenoImages: new Map(), emit() {}, notify() {}, routesHere: () => [],
    cardState() {return structuredClone(this.settings);},
    saveXeno(update) {
      const next = structuredClone(this.settings);
      next.xeno = normalizeXeno(typeof update === 'function' ? update(next.xeno, next, 'card:a') : {...next.xeno, ...update});
      this.settings = next; return next.xeno;
    }, persistActiveChatXeno: async () => {}, persistXenoImage: async () => {}});
  return b;
}

test('自制装备直接入柜且不上架；属性经编辑、JSON导入及替换进货后保留', () => {
  const b = backendFixture(), balance = b.settings.chat.wallet.balance;
  b.settings.voicePool = [{engine: 'fish', voice: 'voice1', name: '音色', model: 'model1', language: 'zh'}];
  b.xenoAct('registerItem', {...itemInput, id: 'crafted:manual', forwardExtension: '按本件结构', lowerBodyDescription: '完整覆盖',
    voiceRole: 'pool:fish:voice1:音色', source: 'shop', owned: false, listed: true, price: 9000});
  let item = b.settings.xeno.items.find(item => item.id === 'crafted:manual');
  assert.equal(item.owned, true); assert.equal(item.source, 'crafted'); assert.equal(item.listed, false); assert.equal(item.price, 0);
  assert.match(item.voiceRole, /^voice:/); assert.equal(JSON.parse(item.voiceRole.slice(6)).model, 'model1');
  b.settings.voicePool = [];
  b.xenoAct('saveItem', {id: item.id, abilities: '夜视与轻身', abilityConditions: '穿戴且主动使用'});
  item = b.settings.xeno.items.find(row => row.id === item.id);
  const imported = normalizeCatalogItem(JSON.parse(JSON.stringify(item)));
  assert.equal(imported.lowerBodyDescription, '完整覆盖'); assert.equal(imported.abilities, '夜视与轻身');
  b.xenoAct('importItems', {items: [{id: 'new-stock', category: 'skin_suit', name: '新商品'}], replaceRestock: true});
  assert.ok(b.settings.xeno.items.find(row => row.id === item.id)?.owned);
  assert.equal(b.settings.chat.wallet.balance, balance);
});

test('女性结构覆盖男性本体；保留内层、关闭本层及脱下可恢复原来源', () => {
  let state = xenoRegisterItem(base(), {...itemInput, id: 'female'});
  state = xenoEquipItem(state, {itemId: 'female'});
  assert.equal(effectiveEntityView(state, state.protagonist).gender, '女');
  assert.equal(resolveWear(state, state.protagonist).lowerBodyType, 'female');
  const portrait = buildEntityPortraitPrompt(state, state.protagonist).prompt;
  assert.doesNotMatch(portrait, /futanari/);
  assert.equal(state.protagonist.gender, '男');
  state = xenoUpdateMountOption(state, {itemId: 'female', patch: {skinOrganOut: false}});
  assert.equal(resolveWear(state, state.protagonist).organ, null);
  assert.equal(effectiveEntityView(state, state.protagonist).gender, '扶她');
  state = xenoUnequipSlot(state, {slot: 'all'});
  assert.equal(effectiveEntityView(state, state.protagonist).gender, '男');
  state.items.find(item => item.id === 'female').lowerBodyMode = 'preserve';
  state = xenoEquipItem(state, {itemId: 'female'});
  assert.equal(resolveWear(state, state.protagonist).organ, null);
});

test('女性肉躯仅前方生效时提供女性结构；后方、部位开关和多层来源相互独立', () => {
  let state = xenoRegisterItem(base(), {...itemInput, id: 'skin'});
  state = xenoRegisterItem(state, {...itemInput, category: 'flesh_ring', name: '白露', id: 'ring', lowerBodyType: 'dual'});
  state = xenoEquipItem(state, {itemId: 'skin'});
  state = xenoEquipItem(state, {itemId: 'ring', mode: 'backward'});
  assert.equal(resolveWear(state, state.protagonist).organ.itemId, 'skin');
  assert.equal(resolveWear(state, state.protagonist).body.itemId, 'ring');
  state = xenoUpdateMountOption(state, {itemId: 'ring', patch: {fleshForwardEnabled: true}});
  assert.equal(resolveWear(state, state.protagonist).lowerBodyType, 'dual');
  state.items.find(item => item.id === 'ring').lowerBodyType = 'female';
  assert.equal(effectiveEntityView(state, state.protagonist).gender, '女');
  state = xenoUpdateMountOption(state, {itemId: 'ring', patch: {organOut: false}});
  assert.equal(resolveWear(state, state.protagonist).organ.itemId, 'skin');
  state = xenoUpdateMountOption(state, {itemId: 'ring', patch: {fleshBackwardEnabled: false, organOut: true}});
  assert.equal(resolveWear(state, state.protagonist).body.itemId, 'skin');
  assert.equal(resolveWear(state, state.protagonist).organ.itemId, 'ring');
});

test('旧装备保留兼容语义；明确女性结构不会在形态图中继续携带冲突标签', () => {
  const old = normalizeCatalogItem({id: 'old', name: '旧装备', category: 'skin_suit', owned: true});
  assert.equal(old.gender, '扶她'); assert.equal(old.lowerBodyMode, 'legacy');
  const state = xenoEquipItem(xenoRegisterItem(base(), {...itemInput, id: 'female', drawPrompt: 'silver hair, futanari, penis, blue eyes'}), {itemId: 'female'});
  assert.doesNotMatch(buildEntityPortraitPrompt(state, state.protagonist).prompt, /futanari|penis/);
  state.possession.active = true; state.possession.organSync = true;
  assert.doesNotMatch(buildEntityPortraitPrompt(state, state.protagonist).prompt, /futanari/);
});

test('能力与限制仅由实际穿戴装备提供；内外层都记录，脱下后停止注入', () => {
  let state = xenoRegisterItem(base(), {...itemInput, id: 'female'});
  assert.equal(effectiveEntityView(state, state.protagonist).equipmentAbilities, '');
  state = xenoEquipItem(state, {itemId: 'female'});
  assert.match(effectiveEntityView(state, state.protagonist).equipmentAbilities, /夜视.*低光/s);
  assert.match(xenoPromptPlan(state).map(row => row.text).join('\n'), /仅低光环境；不提供透视/);
  state = xenoUnequipSlot(state, {slot: 'all'});
  assert.equal(effectiveEntityView(state, state.protagonist).equipmentAbilities, '');
  assert.doesNotMatch(xenoPromptPlan(state).map(row => row.text).join('\n'), /仅低光环境；不提供透视/);
});

test('正文完成制作可登记并同轮穿戴，不扣钱包；计划、否定、对话及无依据指令不登记', () => {
  const state = base();
  const result = applyWardrobeReply(state, command(undefined, [{action: 'equip', target: '主角', query: '星霜', evidence: '你穿上了星霜。'}]), {operationId: 'floor1', balance: 100});
  assert.deepEqual(result.messages, []);
  const created = result.state.items.find(item => item.source === 'crafted');
  assert.ok(created?.owned); assert.equal(created.listed, false);
  assert.equal(result.state.protagonist.livingMount.layers[0].itemId, created.id);
  assert.equal(result.state.wardrobePurchases.length, 0); assert.equal(result.state.wardrobeCrafts.length, 1);
  for (const evidence of ['你打算制作完成名为星霜的女性皮躯。', '你没有制作完成名为星霜的女性皮躯。', '你制作名为星霜的女性皮躯。']) {
    assert.equal(applyWardrobeReply(state, command(evidence), {operationId: 'bad'}).state.items.some(item => item.source === 'crafted'), false);
  }
  const spoken = '她说道：“你制作完成了名为星霜的女性皮躯。”' + command().slice(command().indexOf('<xeno_action>'));
  assert.equal(applyWardrobeReply(state, spoken, {operationId: 'spoken'}).state.items.some(item => item.source === 'crafted'), false);
  for (const example of ['```text\n' + command() + '\n```', '<pre>' + command() + '</pre>', '<script>' + command() + '</script>']) {
    assert.equal(applyWardrobeReply(state, example, {operationId: 'example'}).state.items.some(item => item.source === 'crafted'), false);
  }
  assert.match(wardrobeActionPlan(state)[0].text, /action:"register"/);
});

test('实际楼层事件重复、切换回复、编辑及删除回退不会重复制作或保留幽灵库存', () => {
  const b = backendFixture(), text = command();
  b.applyXenoFloorReply(2, 0, text);
  const created = b.settings.xeno.items.find(item => item.source === 'crafted');
  b.applyXenoFloorReply(2, 0, text);
  assert.equal(b.settings.xeno.items.filter(item => item.source === 'crafted').length, 1);
  assert.equal(extractXenoSession(b.settings.xeno).wardrobeCrafts.length, 1);
  b.rollbackXenoOnEdit(2, 0, '你在花园休息。');
  assert.equal(b.settings.xeno.items.find(item => item.id === created.id).owned, false);
  assert.equal(matchWardrobeItems(b.settings.xeno, '星霜').length, 0);
  b.rollbackXenoOnEdit(2, 0, text);
  assert.equal(b.settings.xeno.items.find(item => item.id === created.id).owned, true);
  b.rollbackXenoOnDelete(2);
  assert.equal(b.settings.xeno.items.find(item => item.id === created.id).owned, false);
});

test('商城工作台保存明确身体类型与特殊能力，保留原 user→assistant→system 顺序', async () => {
  const s = freshState(); let sent;
  const backend = {emit() {}, cardState: () => s, generateText: async (ctx, request) => {
    sent = request.prompt;
    return '<skin_suit_design name="星霜">\n[身体类型]：女\n[下体处理]：replace\n[下体类型]：female\n[下体设定]：按自身结构覆盖\n[特殊能力]：夜视\n[能力生效条件]：仅低光环境\n[生理构造]：女性结构\n[生图提示词]：silver hair\n</skin_suit_design>';
  }, saveXeno(update) {s.xeno = normalizeXeno(update(s.xeno));}};
  const host = createXenoHost({backend, context: () => ({}), settings: () => s});
  const item = await host.mallRestock({category: 'skin_suit', text: '女性装备，附带夜视能力', gender: '女'});
  assert.equal(item.gender, '女'); assert.equal(item.lowerBodyType, 'female');
  assert.equal(item.abilities, '夜视'); assert.equal(item.abilityConditions, '仅低光环境');
  assert.equal(item.owned, false); assert.equal(item.listed, true);
  assert.deepEqual(sent.slice(0, 3).map(row => row.role), ['user', 'assistant', 'system']);
});

test('助手可登记自制装备；编辑界面具备完整结构字段并保存为已拥有', async () => {
  const b = backendFixture(), tools = createAssistantTools({backend: {api: () => ({xenoAct: b.xenoAct.bind(b)})}, settings: () => b.settings});
  const created = await tools.execute({id: 'a', name: 'wardrobeCreate', args: [itemInput]});
  assert.equal(created.owned, true); assert.equal(created.abilities, itemInput.abilities);
  const html = itemStructureFields({...itemInput, abilities: '<script>bad()</script>'});
  assert.match(html, /data-item="gender"/); assert.match(html, /data-item="abilityConditions"/);
  assert.doesNotMatch(html, /<script>/);
  let handler, content, captured;
  const values = {...itemInput, category: 'skin_suit', shortName: '星霜', slot: 'outerwear', lowerBodyType: 'auto'};
  const ctx = {api: {getState: () => b.settings, xenoAct(action, value) {captured = {action, value};}},
    dialog(title, html) {content = html; return {body: {addEventListener(event, fn) {if (event === 'click') handler = fn;},
      querySelector(selector) {const key = selector.match(/data-item="([^"]+)"/)?.[1]; return {value: values[key] || ''};}}, close() {}};}, notify() {}};
  openItemEditor(ctx);
  handler({target: {closest: selector => selector === '[data-editor-save]' ? {} : null}});
  assert.equal(captured.action, 'registerItem'); assert.equal(captured.value.gender, '女');
  assert.equal(captured.value.abilities, itemInput.abilities); assert.match(content, /收入衣柜/);
});

test('商品图实际提交的提示词遵循指定结构，过滤画风中的冲突标签，男性备用提示词正确', async () => {
  const s = freshState(); s.draw.styles[0].positive = 'futanari, best quality';
  let prompt;
  const ctx = {api: {drawReady: () => true, getState: () => s, generateImage: async input => {
    prompt = input.prompt; throw Error('captured');
  }}};
  const female = normalizeCatalogItem({...itemInput, drawPrompt: 'silver hair, penis', lowerBodyType: 'female'});
  await assert.rejects(generateItemPreview(ctx, female), /captured/);
  assert.match(prompt, /silver hair/); assert.doesNotMatch(prompt, /futanari|penis/);
  await assert.rejects(generateItemPreview(ctx, normalizeCatalogItem({...itemInput, gender: '男'})), /captured/);
  assert.match(prompt, /1boy/); assert.doesNotMatch(prompt, /1girl/);
});

test('手动进货保留完整设定和永久音色；强制未购买上架，实际购买后才入柜扣款', () => {
  const b = backendFixture();
  b.settings.chat.wallet.balance = 5000;
  b.settings.voicePool = [{engine: 'fish', voice: 'voice1', name: '音色', model: 'model1', language: 'zh'}];
  const details = {...itemInput, id: 'manual-stock', price: 1800, voiceRole: 'pool:fish:voice1:音色',
    lowerBodyDescription: '完整覆盖', appearance: '银发', bodyBuild: '修长', physiology: '与本件结构一致',
    ringAppearance: '静息设定', forwardExtension: '前方设定', backwardExtension: '后方设定',
    summary: '手动简介', drawPrompt: 'silver hair', rawDesign: '直接填写，无需 XML'};
  b.xenoAct('stockItem', {...details, owned: true, listed: false, source: 'crafted', slot: 'accessories',
    storyPurchaseId: 'old-purchase', storyCraftId: 'old-craft', sourceTargetName: '旧目标'});
  let item = b.settings.xeno.items.find(row => row.id === details.id);
  assert.equal(item.owned, false); assert.equal(item.listed, true); assert.equal(item.source, 'restock');
  assert.equal(item.slot, 'skin_suit'); assert.equal(item.storyPurchaseId, ''); assert.equal(item.storyCraftId, '');
  assert.equal(item.sourceTargetName, ''); assert.equal(b.settings.chat.wallet.balance, 5000);
  for (const key of Object.keys(details).filter(key => key !== 'voiceRole')) assert.equal(item[key], details[key], key);
  assert.match(item.voiceRole, /^voice:/); assert.equal(JSON.parse(item.voiceRole.slice(6)).model, 'model1');
  assert.throws(() => b.xenoAct('equipItem', {itemId: item.id}), /先购买/);
  b.settings.voicePool = [];
  b.xenoAct('saveItem', {id: item.id, summary: '修改简介'});
  assert.equal(b.settings.xeno.items.find(row => row.id === item.id).voiceRole, item.voiceRole);
  b.buyXenoItem(item.id);
  item = b.settings.xeno.items.find(row => row.id === item.id);
  assert.equal(item.owned, true); assert.equal(b.settings.chat.wallet.balance, 3200);
  b.buyXenoItem(item.id);
  assert.equal(b.settings.chat.wallet.balance, 3200);
  const restored = normalizeXeno(JSON.parse(JSON.stringify(b.settings.xeno))).items.find(row => row.id === item.id);
  assert.equal(restored.abilities, details.abilities); assert.equal(restored.lowerBodyDescription, details.lowerBodyDescription);
  for (const [category, slot, effectKind] of [['flesh_ring', 'flesh_ring', ''], ['apparel', 'accessories', ''], ['consumable', 'consumable', 'cognition']]) {
    b.xenoAct('stockItem', {name: category, id: category, category, slot, effectKind, price: 0});
    const stocked = b.settings.xeno.items.find(row => row.id === category);
    assert.equal(stocked.slot, slot); assert.equal(stocked.price, 0); assert.equal(stocked.owned, false);
    assert.equal(stocked.gender, '');
  }
});

test('手动进货拒绝缺失或非法价格、分类、槽位、道具效果、重复编号和满目录，失败不写入', () => {
  const b = backendFixture(), original = structuredClone(b.settings);
  const valid = {...itemInput, id: 'valid-stock', price: 0};
  for (const patch of [
    {name: ''}, {name: 'a'.repeat(161)}, {category: 'unknown'}, {category: 'apparel', slot: 'skin_suit'},
    {category: 'consumable', effectKind: 'custom-script'},
    ...[undefined, null, '', '1200', NaN, Infinity, -1, 1000000, 1.5].map(price => ({price})),
    {id: b.settings.xeno.items[0].id}
  ]) {
    assert.throws(() => b.xenoAct('stockItem', {...valid, ...patch}));
    assert.deepEqual(b.settings, original);
  }
  b.settings.xeno.items.push(...Array.from({length: 200}, (_, index) => normalizeCatalogItem({id: 'extra-' + index})));
  const full = structuredClone(b.settings);
  assert.throws(() => b.xenoAct('stockItem', valid), /目录已满/);
  assert.deepEqual(b.settings, full);
});

test('手动录入表单校验后直接持久上架，取消不保存，全程不调用设计或绘图接口', () => {
  const b = backendFixture(), handlers = {}, errors = [], calls = [];
  let content, closed = false, saved;
  const values = {...itemInput, price: '1800', category: 'skin_suit', slot: 'outerwear'};
  const effectBlock = {hidden: true};
  const api = new Proxy({getState: () => b.settings, xenoAct(action, value) {
    calls.push(action); return b.xenoAct(action, value);
  }}, {get(target, name) {
    if (name in target) return target[name];
    throw Error('手动录入不应访问额外接口：' + String(name));
  }});
  const ctx = {api, dialog(title, html) {
    assert.equal(title, '手动录入商品'); content = html;
    return {body: {addEventListener(type, handler) {handlers[type] = handler;},
      querySelector(selector) {
        if (selector === '[data-item-consumable]') return effectBlock;
        const key = selector.match(/data-item="([^"]+)"/)?.[1]; return {value: values[key] ?? ''};
      }}, close() {closed = true;}};
  }, notify(text, options) {if (options?.error) errors.push(text);}};
  const click = selector => handlers.click({target: {closest: candidate => candidate === selector ? {} : null}});
  openItemEditor(ctx, {destination: 'mall', onSaved(value) {saved = value;}});
  assert.match(content, /直接上架/); assert.match(content, /value="consumable"/);
  for (const price of ['', '-1', '1.5', '1000000', 'NaN']) {
    values.price = price; click('[data-editor-save]');
    assert.equal(closed, false); assert.equal(calls.length, 0);
  }
  values.price = '1800'; values.name = ''; click('[data-editor-save]');
  assert.equal(calls.length, 0); assert.equal(errors.length, 6);
  values.name = '手动披风'; values.category = 'apparel'; values.slot = 'accessories';
  handlers.change({target: {dataset: {item: 'category'}, value: 'consumable'}});
  assert.equal(effectBlock.hidden, false);
  handlers.change({target: {dataset: {item: 'category'}, value: 'apparel'}});
  assert.equal(effectBlock.hidden, true);
  click('[data-editor-save]');
  assert.deepEqual(calls, ['stockItem']); assert.equal(closed, true); assert.equal(saved.category, 'apparel');
  const item = b.settings.xeno.items.find(row => row.id === saved.id);
  assert.equal(item.price, 1800); assert.equal(item.owned, false); assert.equal(item.listed, true);
  assert.equal(item.abilities, itemInput.abilities); assert.equal(item.slot, 'accessories');
  const count = b.settings.xeno.items.length;
  openItemEditor(ctx, {destination: 'mall'}); click('[data-editor-close]');
  assert.equal(b.settings.xeno.items.length, count); assert.deepEqual(calls, ['stockItem']);
});

test('小此按已给定资料直接录入复用手动上架，不调用设计工作台或绘图', async () => {
  const b = backendFixture();
  const tools = createAssistantTools({backend: {api: () => ({xenoAct: b.xenoAct.bind(b)})}, settings: () => b.settings,
    hosts: () => ({mallRestock() {assert.fail('不应调用设计模型');}, mallPicture() {assert.fail('不应调用生图');}})});
  assert.ok((await tools.execute({id: 'list', name: 'phone.tools', args: ['mall']})).some(row => row.name === 'mallCreate'));
  const item = await tools.execute({id: 'direct', name: 'mallCreate', args: [{...itemInput, price: 1200}]});
  assert.equal(item.owned, false); assert.equal(item.listed, true); assert.equal(item.price, 1200);
  assert.equal(item.abilities, itemInput.abilities); assert.ok(b.settings.xeno.items.find(row => row.id === item.id));
});
