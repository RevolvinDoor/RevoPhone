import test from 'node:test';
import assert from 'node:assert/strict';
import {freshState} from '../core/state.js';
import {TTSBackend} from '../core/backend.js';
import {normalizeXeno, normalizeCatalogItem, xenoRegisterItem, xenoEquipItem, xenoUnequipSlot, xenoUpdateMountOption,
  effectiveEntityView, resolveWear, xenoPromptPlan, extractXenoSession, buildEntityPortraitPrompt,
  parseItemTextBlock, splitItemDrawPrompts} from '../core/xeno.js';
import {applyWardrobeReply, wardrobeActionPlan, matchWardrobeItems} from '../core/xeno-actions.js';
import {createXenoHost} from '../host-xeno.js';
import {createAssistantTools} from '../core/assistant-tools.js';
import {itemStructureFields, openItemEditor} from '../ui/xeno-item-editor.js';
import {generateItemPreview, generateEntityPortrait} from '../xeno-images.js';
import {stripQualityDrawTags, normalizeCharacterDrawPrompt} from '../core/xeno-wear.js';
import {mergeXenoSession} from '../core/xeno.js';
import {wardrobeApp} from '../ui/wardrobe.js';
import {mallApp} from '../ui/mall.js';

test('文本进货识别同人字段和已有cosplay Tag，支持XML及JSON且保留作品消歧', () => {
  for (const [category, xml] of [['skin_suit', 'skin_suit_design'], ['flesh_ring', 'flesh_ring_design']]) {
    for (const content of [
      `<${xml} name="同人测试">\n[同人角色Tag]：hatsune_miku (vocaloid)\n[角色生图提示词]：aqua hair\n</${xml}>`,
      JSON.stringify({name: '同人测试', category, fanwork: true, cosplayCharacter: 'hatsune_miku (vocaloid)', drawPrompt: 'aqua hair'}),
      `<${xml} name="同人测试">\n[角色生图提示词]：hatsune_miku (vocaloid) (cosplay), aqua hair\n</${xml}>`,
      `[分类]：${category}\n[同人卡]：是 [同人角色Tag]：hatsune_miku (vocaloid) [角色生图提示词]：aqua hair`
    ]) {
      const parsed = parseItemTextBlock(content);
      assert.equal(parsed.fanwork, true); assert.equal(parsed.cosplayCharacter, 'hatsune miku (vocaloid)');
      const item = normalizeCatalogItem(parsed);
      assert.equal(item.drawPrompt, 'hatsune miku (vocaloid) (cosplay), aqua hair');
    }
  }
});

test('文本进货不把原创或服饰误判为同人，明确取消同人时不自动恢复', () => {
  const original = parseItemTextBlock('[名称]：原创测试\n[角色生图提示词]：silver hair, blue eyes');
  assert.notEqual(original.fanwork, true);
  const disabled = parseItemTextBlock(JSON.stringify({category: 'skin_suit', fanwork: false, cosplayCharacter: 'hatsune_miku', drawPrompt: 'aqua hair'}));
  assert.equal(disabled.fanwork, false);
  const apparel = parseItemTextBlock('[分类]：apparel\n[同人角色Tag]：hatsune_miku\n[生图提示词]：blue coat');
  assert.notEqual(apparel.fanwork, true);
  assert.equal(parseItemTextBlock(JSON.stringify({category: 'apparel', fanwork: true, cosplayCharacter: 'hatsune_miku'})).fanwork, false);
  assert.equal(parseItemTextBlock('[生图提示词]：blue coat', {fallbackCategory: 'apparel'}).category, 'apparel');
});

test('智能识别与直接保存都自动勾选同人并填Tag，手动取消后保持取消且不调用模型', () => {
  for (const mode of ['parse', 'save', 'disable']) {
    const b = backendFixture(), handlers = {}, fields = {category: 'skin_suit', price: '0',
      smartInput: '<skin_suit_design name="同人测试">\n[同人角色Tag]：hatsune_miku\n[角色生图提示词]：hatsune miku (cosplay), aqua hair\n</skin_suit_design>'};
    const checkbox = {checked: false}, fanFields = {hidden: true}, errors = [];
    const ctx = {api: new Proxy({getState: () => b.settings, xenoAct: b.xenoAct.bind(b)}, {get(target, key) {
      if (key in target) return target[key]; throw Error('不应调用模型或绘图接口');
    }}), dialog() {return {body: {addEventListener(type, fn) {handlers[type] = fn;}, querySelector(selector) {
      if (selector === '[data-item-fanwork]') return checkbox;
      if (selector === '[data-item-fanwork-fields]') return fanFields;
      if (selector === '[data-item-consumable]') return {hidden: true};
      const key = selector.match(/data-item="([^"]+)"/)?.[1]; if (!key) return null;
      return {get value() {return fields[key] || '';}, set value(v) {fields[key] = String(v);}};
    }}, close() {}};}, notify(message, options) {if (options?.error) errors.push(message);}};
    const click = selector => handlers.click({target: {closest: s => s === selector ? {} : null}});
    openItemEditor(ctx, {destination: 'mall'});
    if (mode !== 'save') {
      click('[data-editor-smart-parse]');
      assert.equal(checkbox.checked, true); assert.equal(fields.cosplayCharacter, 'hatsune miku'); assert.equal(fanFields.hidden, false);
    }
    if (mode === 'disable') {checkbox.checked = false; handlers.change({target: {dataset: {itemFanwork: ''}, checked: false}});}
    click('[data-editor-save]');
    assert.deepEqual(errors, []);
    const item = b.settings.xeno.items.find(i => i.name === '同人测试'); assert.ok(item);
    assert.equal(item.fanwork, mode !== 'disable');
    if (mode === 'disable') assert.doesNotMatch(item.drawPrompt, /cosplay/);
    else assert.equal(item.cosplayCharacter, 'hatsune miku');
  }
});

test('商城和衣柜商品图统一状态Tag格式，女性结构使用female且不替服饰猜测身体', async () => {
  const state = freshState(); let prompt;
  const ctx = {api: {getState: () => state, drawReady: () => true, async generateImage(input) {prompt = input.prompt; throw Error('captured');}}};
  for (const category of ['skin_suit', 'flesh_ring']) {
    const item = normalizeCatalogItem({name: '状态测试', category, gender: '扶她', lowerBodyMode: 'replace', lowerBodyType: 'dual',
      drawPrompt: 'silver hair', organDrawPrompt: 'futanari, erection'});
    await assert.rejects(generateItemPreview(ctx, item), /captured/);
    assert.match(prompt, /erect/); assert.doesNotMatch(prompt, /erection/);
    item.lowerBodyType = 'female';
    await assert.rejects(generateItemPreview(ctx, item), /captured/);
    assert.match(prompt, /female/); assert.doesNotMatch(prompt, /erect|flaccid|futanari/);
    item.lowerBodyMode = 'preserve';
    await assert.rejects(generateItemPreview(ctx, item), /captured/);
    assert.match(prompt, /futanari, erect/); assert.doesNotMatch(prompt, /female/);
  }
  await assert.rejects(generateItemPreview(ctx, normalizeCatalogItem({name: '外套', category: 'apparel', drawPrompt: 'blue coat'})), /captured/);
  assert.doesNotMatch(prompt, /female/);
  state.xeno = normalizeXeno({protagonist: {name: '旅人', gender: '扶她', lowerBodyState: '勃起'}});
  state.draw.styles[0].positive = 'flaccid, masterpiece';
  await assert.rejects(generateEntityPortrait(ctx, '__protagonist__', 'silver hair'), /captured/);
  assert.match(prompt, /erect/); assert.doesNotMatch(prompt, /flaccid|masterpiece/);
  state.xeno.protagonist.lowerBodyState = '缩回';
  state.draw.styles[0].positive = '{futanari}, erect';
  await assert.rejects(generateEntityPortrait(ctx), /captured/);
  assert.match(prompt, /female/); assert.doesNotMatch(prompt, /erect|futanari/);
});

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

test('删除所有初始商品后序列化、重新载入及旧聊天快照均不会复活；清理穿戴、音色和待购买引用', () => {
  const b = backendFixture(), builtinIds = b.settings.xeno.items.map(item => item.id);
  const living = b.settings.xeno.items.find(item => item.category === 'skin_suit');
  living.owned = true; living.voiceRole = 'bound:test';
  b.settings.xeno = xenoEquipItem(b.settings.xeno, {itemId: living.id});
  const session = extractXenoSession(b.settings.xeno);
  b.settings.xeno.targetPool = [{...structuredClone(b.settings.xeno.protagonist), name: '候选'}];
  b.settings.xeno.wardrobePending = {itemId: living.id};
  const balance = b.settings.chat.wallet.balance;
  for (const itemId of builtinIds) b.xenoAct('deleteItem', {itemId});
  const reloaded = normalizeXeno(JSON.parse(JSON.stringify(b.settings.xeno)));
  assert.deepEqual(reloaded.items, []);
  assert.deepEqual(reloaded.protagonist.livingMount.layers, []);
  assert.deepEqual(reloaded.targetPool[0].livingMount.layers, []);
  assert.equal(reloaded.itemVoiceBindings[living.id], undefined);
  assert.equal(reloaded.wardrobePending, null);
  assert.equal(b.settings.chat.wallet.balance, balance);
  const merged = mergeXenoSession(reloaded, session, 'card:a');
  assert.deepEqual(merged.items, []); assert.deepEqual(merged.protagonist.livingMount.layers, []);
  assert.equal(merged.itemVoiceBindings[living.id], undefined);
});

test('衣柜和商城初始商品均有删除入口；取消不改数据，确认后删除', async () => {
  for (const [app, action] of [[wardrobeApp, 'delete-wardrobe-item'], [mallApp, 'delete-mall-item']]) {
    const b = backendFixture(), listeners = new Map();
    const item = b.settings.xeno.items.find(item => item.category === 'skin_suit');
    item.owned = true;
    const doc = {activeElement: null, addEventListener() {}, createElement: () => root};
    const root = {dataset: {}, ownerDocument: doc, scrollTop: 0, contains: el => !!el,
      querySelectorAll: () => [], querySelector: () => null,
      addEventListener(type, handler) {if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(handler);}};
    let confirmed = false;
    const view = app({api: {getState: () => b.settings, subscribe: () => () => {},
      xenoAct: (action, input) => b.xenoAct(action, input)}, doc, win: {AbortController},
      confirm: async () => confirmed, notify() {}});
    assert.ok(root.innerHTML.includes(`data-action="${action}" data-id="${item.id}"`));
    const click = async () => {
      const target = {dataset: {action, id: item.id}, matches: () => false,
        closest: selector => selector === '[data-action]' ? target : null};
      for (const fn of listeners.get('click')) fn({target, preventDefault() {}});
      await new Promise(resolve => setImmediate(resolve));
    };
    await click(); assert.ok(b.settings.xeno.items.some(i => i.id === item.id));
    confirmed = true; await click(); assert.equal(b.settings.xeno.items.some(i => i.id === item.id), false);
    view.dispose();
  }
});

test('删除自制服饰后清理穿戴；已删除的剧情制作记录不重复入柜', () => {
  const b = backendFixture();
  b.xenoAct('registerItem', {name: '旅行外套', id: 'coat:delete', category: 'apparel', slot: 'outerwear'});
  b.settings.xeno = xenoEquipItem(b.settings.xeno, {itemId: 'coat:delete'});
  b.xenoAct('deleteItem', {itemId: 'coat:delete'});
  assert.equal(b.settings.xeno.protagonist.outfit.outerwearItemId, '');
  assert.equal(b.settings.xeno.protagonist.outfit.outerwear, '无');
  const first = applyWardrobeReply(b.settings.xeno, command(), {operationId: 'deleted:craft'});
  b.settings.xeno = first.state;
  const itemId = b.settings.xeno.items.find(item => item.name === '星霜').id;
  b.xenoAct('deleteItem', {itemId});
  const replay = applyWardrobeReply(b.settings.xeno, command(), {operationId: 'deleted:craft'});
  assert.equal(replay.state.items.some(item => item.id === itemId), false);
});

test('同人Tag随商品导入保存，仅随有效身体输出；商品图与形态图去除质量词，保留cosplay括号', async () => {
  const b = backendFixture();
  b.xenoAct('stockItem', {...itemInput, category: 'flesh_ring', price: 800, id: 'fan:body',
    fanwork: true, cosplayCharacter: 'hatsune_miku (cosplay)',
    drawPrompt: 'masterpiece, best quality, silver hair, very aesthetic, absurdres'});
  const item = b.settings.xeno.items.find(item => item.id === 'fan:body');
  assert.equal(item.drawPrompt, 'hatsune miku (cosplay), silver hair');
  b.xenoAct('importItems', {items: [JSON.parse(JSON.stringify(item))]});
  b.settings.xeno.items.find(i => i.id === item.id).owned = true;
  b.settings.xeno = xenoEquipItem(b.settings.xeno, {itemId: item.id, mode: 'forward'});
  assert.doesNotMatch(buildEntityPortraitPrompt(b.settings.xeno, b.settings.xeno.protagonist).prompt, /cosplay/);
  b.settings.xeno = xenoUpdateMountOption(b.settings.xeno, {itemId: item.id, patch: {fleshExtendMode: 'backward'}});
  const portrait = buildEntityPortraitPrompt(b.settings.xeno, b.settings.xeno.protagonist).prompt;
  assert.match(portrait, /hatsune miku \(cosplay\)/);
  assert.doesNotMatch(portrait, /masterpiece|best quality|aesthetic|absurdres/);
  assert.equal(normalizeCharacterDrawPrompt('1girl, hatsune miku (cosplay)'), '1girl, hatsune miku (cosplay)');
  assert.equal(stripQualityDrawTags('{masterpiece}, 1.2::best quality::, detailed eyes, hatsune miku (cosplay)'), 'detailed eyes, hatsune miku (cosplay)');
  let submitted;
  b.settings.draw.styles = [{id: 'test', artist: 'artist:test', positive: 'masterpiece, best quality, soft lighting'}];
  b.settings.draw.activeStyle = 'test';
  const ctx = {api: {drawReady: () => true, getState: () => b.settings,
    async generateImage(input) {submitted = input.prompt; throw Error('captured');}}};
  await assert.rejects(generateItemPreview(ctx, item), /captured/);
  assert.match(submitted, /artist:test, soft lighting/);
  assert.match(submitted, /hatsune miku \(cosplay\)/);
  assert.doesNotMatch(submitted, /masterpiece|best quality|high quality/);
});

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
  const values = {...itemInput, price: '1800', category: 'skin_suit', slot: 'outerwear', fanwork: true, cosplayCharacter: 'hatsune_miku'};
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
        if (selector === '[data-item-fanwork]') return {checked: values.fanwork};
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

test('角色提示词与肉棒提示词分离：角色提示词一律不含 futanari，肉棒提示词固定以 futanari 开头并按前后延展独立生效', async () => {
  const state0 = base();
  state0.protagonist.gender = '女';
  for (const builtin of state0.items.filter(i => ['skin_suit', 'flesh_ring'].includes(i.category))) {
    assert.doesNotMatch(builtin.drawPrompt, /\bfutanari\b/i);
    assert.match(builtin.organDrawPrompt, /^futanari\b/i);
  }
  const split = splitItemDrawPrompts({
    category: 'flesh_ring',
    gender: '扶她',
    drawPrompt: '1girl, solo, futanari, silver hair, red eyes, huge penis, erection, testicles, dripping precum'
  });
  assert.equal(split.drawPrompt, '1girl, solo, silver hair, red eyes');
  assert.equal(split.organDrawPrompt, 'futanari, huge penis, erection, testicles, dripping precum');

  let state = xenoRegisterItem(state0, {
    id: 'ring_sep',
    name: '赤魇肉躯环',
    category: 'flesh_ring',
    gender: '扶她',
    lowerBodyMode: 'replace',
    lowerBodyType: 'dual',
    forwardExtension: '向前方重构紫黑巨根',
    backwardExtension: '向后方蔓延重构银发红瞳躯体',
    drawPrompt: '1girl, futanari, silver hair, crimson eyes, huge breasts',
    organDrawPrompt: 'huge penis, thick veins, glans, testicles'
  });
  const ringItem = state.items.find(i => i.id === 'ring_sep');
  assert.equal(ringItem.drawPrompt, '1girl, silver hair, crimson eyes, huge breasts');
  assert.equal(ringItem.organDrawPrompt, 'futanari, huge penis, thick veins, glans, testicles');

  // 1. 仅开启前方延展：只输出肉棒提示词（固定含 futanari），不输出后方角色身体提示词
  state = xenoEquipItem(state, {itemId: 'ring_sep', mode: 'forward'});
  let prompt = buildEntityPortraitPrompt(state, state.protagonist).prompt;
  assert.match(prompt, /futanari, huge penis, thick veins/);
  assert.doesNotMatch(prompt, /silver hair/);

  // 2. 仅开启后方延展（关闭前方延展）：只输出角色提示词，不含肉棒提示词与 futanari
  state = xenoUpdateMountOption(state, {itemId: 'ring_sep', patch: {fleshForwardEnabled: false, fleshBackwardEnabled: true}});
  prompt = buildEntityPortraitPrompt(state, state.protagonist).prompt;
  assert.match(prompt, /silver hair, crimson eyes/);
  assert.doesNotMatch(prompt, /futanari|huge penis/);

  // 3. 前后同时开启：同时包含角色提示词与固定 futanari 的肉棒提示词
  state = xenoUpdateMountOption(state, {itemId: 'ring_sep', patch: {fleshForwardEnabled: true, fleshBackwardEnabled: true}});
  prompt = buildEntityPortraitPrompt(state, state.protagonist).prompt;
  assert.match(prompt, /silver hair, crimson eyes/);
  assert.match(prompt, /futanari, huge penis, thick veins/);

  // 4. 商品图生成同样合并不含 futanari 的角色提示词与固定含 futanari 的肉棒提示词
  const s = freshState();
  let capturedPrompt = '';
  const ctx = {api: {drawReady: () => true, getState: () => s, generateImage: async input => {
    capturedPrompt = input.prompt; throw Error('captured');
  }}};
  await assert.rejects(generateItemPreview(ctx, ringItem), /captured/);
  assert.match(capturedPrompt, /silver hair, crimson eyes/);
  assert.match(capturedPrompt, /futanari, huge penis, thick veins/);
});

test('手动进货支持整段提示词与设定智能识别导入（XML、标签块、中英混合大段提示词自动拆分字段与肉棒提示词）', () => {
  const fullBlock = `<flesh_ring_design name="【圣洁修女·凝缩肉躯环】">
简称：修女肉躯
价格：2600
[身体类型]：扶她
[下体处理]：replace
[下体类型]：dual
[静息环体外观]：乳白色温热肉环，内壁布满圣纹肉褶。
[前方延展·器官重构]：向前方增殖重构出 32cm 白皙青筋扶她巨根与饱满玉囊。
[后方延展·躯体重构]：向后方全身蔓延包裹，重构为银发蓝瞳、丰乳肥臀的圣洁修女躯体。
[特殊能力]：圣洁伪装：穿戴期间周围人自动忽略其异样。
[能力生效条件]：后方延展开启时生效。
[角色生图提示词 (Character Prompt)]：(1girl, solo, futanari, nun, white habit, silver hair, blue eyes, huge breasts, wide hips)
[肉棒生图提示词 (Penis Prompt)]：(huge penis, thick shaft, veins, glans, large testicles, dripping precum)
</flesh_ring_design>`;

  const parsed = parseItemTextBlock(fullBlock);
  assert.equal(parsed.category, 'flesh_ring');
  assert.equal(parsed.name, '【圣洁修女·凝缩肉躯环】');
  assert.equal(parsed.shortName, '修女肉躯');
  assert.equal(parsed.price, 2600);
  assert.equal(parsed.gender, '扶她');
  assert.match(parsed.ringAppearance, /乳白色温热肉环/);
  assert.match(parsed.forwardExtension, /32cm 白皙青筋/);
  assert.match(parsed.backwardExtension, /银发蓝瞳/);
  assert.equal(parsed.drawPrompt, '1girl, solo, nun, white habit, silver hair, blue eyes, huge breasts, wide hips');
  assert.equal(parsed.organDrawPrompt, 'futanari, huge penis, thick shaft, veins, glans, large testicles, dripping precum');

  // 测试无标签中英混合大段提示词也能自动识别名称、分类、价格并分离角色/肉棒提示词
  const freeformBlock = `【深渊魅魔·活体皮躯】 售价1980元
白发金瞳的丰满魅魔活体皮躯，身高172cm，J罩杯爆乳与蜜桃臀，胯下生长着粗壮扶她肉棒与饱满玉囊。
1girl, solo, futanari, demon girl, white hair, golden eyes, horns, huge breasts, wide hips, huge penis, erection, veins, testicles`;
  const freeParsed = parseItemTextBlock(freeformBlock);
  assert.equal(freeParsed.category, 'skin_suit');
  assert.equal(freeParsed.name, '【深渊魅魔·活体皮躯】');
  assert.equal(freeParsed.price, 1980);
  assert.equal(freeParsed.drawPrompt, '1girl, solo, demon girl, white hair, golden eyes, horns, huge breasts, wide hips');
  assert.equal(freeParsed.organDrawPrompt, 'futanari, huge penis, erection, veins, testicles');

  // 测试手动录入弹窗粘贴整段内容后点击智能识别或直接保存均可准确导入
  const b = backendFixture(), handlers = {};
  const fields = {smartInput: fullBlock, category: 'apparel', slot: 'outerwear', price: '0'};
  const ctx = {
    api: {getState: () => b.settings, xenoAct: b.xenoAct.bind(b)},
    dialog(_title, _html) {
      return {
        body: {
          addEventListener(type, fn) {handlers[type] = fn;},
          querySelector(selector) {
            if (selector === '[data-item-consumable]') return {hidden: true};
            const key = selector.match(/data-item="([^"]+)"/)?.[1];
            if (!key) return null;
            return {
              get value() {return fields[key] ?? '';},
              set value(v) {fields[key] = String(v);}
            };
          }
        },
        close() {}
      };
    },
    notify() {}
  };
  openItemEditor(ctx, {destination: 'mall'});
  handlers.click({target: {closest: sel => sel === '[data-editor-smart-parse]' ? {} : null}});
  assert.equal(fields.name, '【圣洁修女·凝缩肉躯环】');
  assert.equal(fields.category, 'flesh_ring');
  assert.equal(fields.price, '2600');
  assert.equal(fields.drawPrompt, '1girl, solo, nun, white habit, silver hair, blue eyes, huge breasts, wide hips');
  assert.equal(fields.organDrawPrompt, 'futanari, huge penis, thick shaft, veins, glans, large testicles, dripping precum');
  handlers.click({target: {closest: sel => sel === '[data-editor-save]' ? {} : null}});
  const stocked = b.settings.xeno.items.find(i => i.name === '【圣洁修女·凝缩肉躯环】');
  assert.ok(stocked);
  assert.equal(stocked.price, 2600);
  assert.equal(stocked.drawPrompt, '1girl, solo, nun, white habit, silver hair, blue eyes, huge breasts, wide hips');
  assert.equal(stocked.organDrawPrompt, 'futanari, huge penis, thick shaft, veins, glans, large testicles, dripping precum');
});

test('购物商城悬轨陈列选购提示词（mallShop）在商城购买或剧情选购时自动按需注入', () => {
  const b = backendFixture();
  b.settings.chat.wallet.balance = 5000;
  const shopEntry = b.settings.xeno.presets[0].entries.find(e => e.id === 'mallShop');
  assert.ok(shopEntry);
  assert.equal(shopEntry.scope, 'story');
  assert.match(shopEntry.text, /自动化机械传输滑轨/);
  assert.match(shopEntry.text, /急停晃动惯性/);

  // 未触发商城选购时不常驻注入
  const idlePlan = xenoPromptPlan(b.settings.xeno, null, {input: '今天去散步'});
  const idleRules = idlePlan.find(p => p.key === 'sttts.entry.xeno-rules')?.text || '';
  assert.doesNotMatch(idleRules, /自动化机械传输滑轨/);

  // 商城购买后或输入选购关键词时自动注入悬轨陈列室提示词
  const unowned = b.settings.xeno.items.find(i => !i.owned && i.listed !== false);
  b.buyXenoItem(unowned.id);
  assert.match(b.settings.xeno.pendingActionNote, /悬轨陈列室/);
  const buyPlan = xenoPromptPlan(b.settings.xeno, null, {input: '继续'});
  const buyRules = buyPlan.find(p => p.key === 'sttts.entry.xeno-rules')?.text || '';
  assert.match(buyRules, /自动化机械传输滑轨/);
});
