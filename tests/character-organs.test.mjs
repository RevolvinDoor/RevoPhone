import test from 'node:test';
import assert from 'node:assert/strict';
import {editCharacterStatus, lowerBodyStates, LEGACY_ORGAN_SYNC_RULE, ORGAN_SYNC_RULE} from '../core/character-status.js';
import {normalizeXeno, effectiveEntityView, applyXenoUpdateFromText, extractXenoSession, mergeXenoSession, xenoPromptPlan, defaultXenoPreset, stripXenoUpdate, xenoEquipItem, buildEntityPortraitPrompt, xenoDrawTagsFor} from '../core/xeno.js';
import {TTSBackend} from '../core/backend.js';
import {freshState} from '../core/state.js';
import {createXenoHost} from '../host-xeno.js';
import {outgoingChat} from '../core/outgoing.js';
import {characterStatusApp} from '../ui/character-status.js';

const base = (gender = '扶她') => normalizeXeno({cardKey: 'card:a', protagonist: {name: '旅人', gender, physiology: '原有生理描述', lowerBodyAppearance: '已有下体外观'}, targets: [{id: 'target:a', name: '同行者', gender: '女'}]});
const tag = (patch, target = '主角') => `<xeno_organs>${JSON.stringify([{target, ...patch}])}</xeno_organs>`;
const edit = (xeno, field, value) => editCharacterStatus(xeno.protagonist, {field, value}, effectiveEntityView(xeno, xeno.protagonist));
const lock = (xeno, field, locked = true) => editCharacterStatus(xeno.protagonist, {field, locked}, effectiveEntityView(xeno, xeno.protagonist));

test('角色当前状态写入英文绘图Tag，无与缩回不残留外露结构Tag，未记录时不猜测', () => {
  for (const [gender, state, expected] of [['扶她', '勃起', 'erect'], ['男', '疲软', 'flaccid'], ['女', '无', 'female'], ['扶她', '缩回', 'female']]) {
    const xeno = base(gender); edit(xeno, 'lowerBodyState', state);
    for (const prompt of [buildEntityPortraitPrompt(xeno, xeno.protagonist).prompt, xenoDrawTagsFor(xeno, '主角')]) {
      assert.ok(prompt.split(',').map(t => t.trim()).includes(expected));
      assert.doesNotMatch(prompt, /勃起|疲软|缩回/);
      if (expected === 'female') assert.doesNotMatch(prompt, /futanari|erect|flaccid/);
    }
  }
  assert.doesNotMatch(buildEntityPortraitPrompt(base(), base().protagonist).prompt, /erect|flaccid|female/);
});

test('当前与锁定状态覆盖装备旧Tag，按有效下体类型校验后才用于绘图', () => {
  let xeno = base();
  xeno.items.push({id: 'state:body', name: '测试躯体', category: 'skin_suit', gender: '扶她', owned: true,
    lowerBodyMode: 'replace', lowerBodyType: 'dual', drawPrompt: 'silver hair', organDrawPrompt: 'futanari, flaccid'});
  xeno = xenoEquipItem(xeno, {itemId: 'state:body'}); edit(xeno, 'lowerBodyState', '勃起'); lock(xeno, 'lowerBodyState');
  xeno.protagonist.lowerBodyState = '疲软';
  let prompt = buildEntityPortraitPrompt(xeno, xeno.protagonist).prompt;
  assert.match(prompt, /erect/); assert.doesNotMatch(prompt, /flaccid/);
  xeno.items.find(i => i.id === 'state:body').lowerBodyType = 'female';
  prompt = buildEntityPortraitPrompt(xeno, xeno.protagonist).prompt;
  assert.doesNotMatch(prompt, /erect|flaccid|futanari/);
});
function backendFixture() {
  const b = Object.create(TTSBackend.prototype);
  Object.assign(b, {settings: {...freshState(), xeno: base()}, space: {key: 'card:a', members: []},
    activeChatKey: 'chat:a', xenoFloors: new Map(), routesHere: () => [], notify() {},
    cardState() {return structuredClone(this.settings);},
    saveXeno(update) {const next = structuredClone(this.settings); next.xeno = normalizeXeno(update(next.xeno, next, 'card:a')); this.settings = next; return next.xeno;},
    persistActiveChatXeno: async () => {}});
  return b;
}

test('旧下体记录与锁迁入固定字段，其他器官保留存档，显式清空不会再次迁回', () => {
  const organs = [{id: 'eye', name: '左眼', appearance: '琥珀色', state: '正常', locked: true},
    {id: 'genital', name: '下体', appearance: '旧下体外观', state: '缩回', locked: true}];
  const xeno = normalizeXeno({protagonist: {name: '旅人', gender: '扶她', organs}});
  assert.equal(xeno.protagonist.lowerBodyAppearance, '旧下体外观');
  assert.equal(xeno.protagonist.lowerBodyState, '缩回');
  assert.ok(xeno.protagonist.statusLocks.lowerBodyAppearance);
  assert.ok(xeno.protagonist.statusLocks.lowerBodyState);
  assert.deepEqual(xeno.protagonist.organs, organs);
  assert.deepEqual(normalizeXeno(xeno), xeno);
  lock(xeno, 'lowerBodyAppearance', false); lock(xeno, 'lowerBodyState', false);
  edit(xeno, 'lowerBodyAppearance', ''); edit(xeno, 'lowerBodyState', '');
  assert.equal(normalizeXeno(xeno).protagonist.lowerBodyAppearance, '');
  assert.equal(normalizeXeno(xeno).protagonist.lowerBodyState, '');
  const empty = normalizeXeno({protagonist: {name: '旅人'}});
  assert.equal(empty.protagonist.lowerBodyState, '');
});

test('状态严格按性别约束，穿戴后的当前有效类型用于校验；非法状态不写入', () => {
  assert.deepEqual(lowerBodyStates('男'), ['勃起', '疲软']);
  assert.deepEqual(lowerBodyStates('扶她'), ['勃起', '疲软', '缩回']);
  assert.deepEqual(lowerBodyStates('女'), ['无']);
  for (const [gender, valid, invalid] of [['男', '疲软', '缩回'], ['扶她', '缩回', '无'], ['女', '无', '勃起']]) {
    const xeno = base(gender); edit(xeno, 'lowerBodyState', valid);
    assert.equal(xeno.protagonist.lowerBodyState, valid);
    assert.throws(() => edit(xeno, 'lowerBodyState', invalid), /不支持该状态/);
    assert.equal(xeno.protagonist.lowerBodyState, valid);
    assert.equal(applyXenoUpdateFromText(xeno, tag({lowerBodyState: invalid})), null);
  }
  let xeno = base('男');
  xeno.items = [{id: 'skin', name: '女性皮躯', category: 'skin_suit', gender: '女', lowerBodyMode: 'replace', lowerBodyType: 'female', owned: true}];
  xeno = xenoEquipItem(xeno, {itemId: 'skin'});
  assert.equal(effectiveEntityView(xeno, xeno.protagonist).lowerBodyGender, '女');
  edit(xeno, 'lowerBodyState', '无');
  assert.throws(() => edit(xeno, 'lowerBodyState', '缩回'), /不支持/);
  const changed = base('扶她'); edit(changed, 'lowerBodyState', '缩回'); lock(changed, 'lowerBodyState');
  changed.protagonist.gender = '女';
  assert.equal(effectiveEntityView(changed, changed.protagonist).lowerBodyState, '');
  changed.enabled = false;
  assert.deepEqual(xenoPromptPlan(changed), []);
});

test('外观与状态可分别编辑和锁定，剧情增量合并保留未提及项，旧协议只接受下体', () => {
  const xeno = base(); edit(xeno, 'lowerBodyState', '疲软'); lock(xeno, 'lowerBodyAppearance');
  const next = applyXenoUpdateFromText(xeno, tag({lowerBodyAppearance: '变化', lowerBodyState: '勃起', locked: false}));
  assert.equal(next.protagonist.lowerBodyAppearance, '已有下体外观');
  assert.equal(next.protagonist.lowerBodyState, '勃起');
  assert.equal(next.protagonist.physiology, '原有生理描述');
  assert.equal(xeno.protagonist.lowerBodyState, '疲软');
  lock(next, 'lowerBodyState');
  assert.equal(applyXenoUpdateFromText(next, tag({lowerBodyState: '缩回'})), null);
  assert.throws(() => edit(next, 'lowerBodyState', '疲软'), /解锁/);
  lock(next, 'lowerBodyAppearance', false);
  const old = applyXenoUpdateFromText(next, tag({organs: [{name: '下体', appearance: '兼容旧下体文本', state: '疲软'}]}));
  assert.equal(old.protagonist.lowerBodyAppearance, '兼容旧下体文本');
  assert.equal(old.protagonist.lowerBodyState, '勃起');
  assert.equal(applyXenoUpdateFromText(old, tag({organs: [{name: '左眼', appearance: '银色'}]})), null);
  assert.equal(applyXenoUpdateFromText(old, tag({lowerBodyState: '无'}, '陌生角色')), null);
  assert.equal(applyXenoUpdateFromText(old, '<xeno_organs>{bad}</xeno_organs>'), null);
  assert.equal(applyXenoUpdateFromText(old, `<analysis>${tag({lowerBodyState: '缩回'})}</analysis>`), null);
});

test('同轮换装完成后再校验下体状态，采用新穿戴的有效类型', () => {
  const b = backendFixture(); b.settings.xeno.protagonist.gender = '男';
  b.settings.xeno.items = [{id: 'skin', name: '女性皮躯', category: 'skin_suit', gender: '女', lowerBodyMode: 'replace', lowerBodyType: 'female', owned: true}];
  const text = '旅人穿上了女性皮躯。<xeno_action>[{"action":"equip","target":"主角","itemId":"skin","evidence":"旅人穿上了女性皮躯。"}]</xeno_action>' + tag({lowerBodyState: '无'});
  b.applyXenoFloorReply(2, 0, text);
  assert.equal(effectiveEntityView(b.settings.xeno, b.settings.xeno.protagonist).lowerBodyGender, '女');
  assert.equal(effectiveEntityView(b.settings.xeno, b.settings.xeno.protagonist).lowerBodyState, '无');
  assert.equal(b.settings.xeno.protagonist.lowerBodyRecords['item:skin'].lowerBodyState, '无');
  assert.equal(b.settings.xeno.protagonist.lowerBodyState, ''); // 本体记录保持原值。
});

test('下体字段与锁随聊天存档和楼层回退恢复，新聊天不继承，隐藏协议不进入正文', () => {
  const b = backendFixture(); edit(b.settings.xeno, 'lowerBodyState', '疲软'); lock(b.settings.xeno, 'lowerBodyState');
  const saved = JSON.parse(JSON.stringify(extractXenoSession(b.settings.xeno)));
  const restored = mergeXenoSession(b.settings.xeno, saved, 'card:a');
  assert.equal(restored.protagonist.lowerBodyState, '疲软'); assert.ok(restored.protagonist.statusLocks.lowerBodyState);
  assert.equal(mergeXenoSession(b.settings.xeno, null, 'card:a').protagonist.lowerBodyState, '');
  b.applyXenoFloorReply(2, 0, tag({lowerBodyState: '勃起'}));
  b.xenoAct('editCharacterStatus', {field: 'lowerBodyState', locked: false});
  b.applyXenoFloorReply(3, 0, tag({lowerBodyState: '缩回'}));
  assert.equal(b.settings.xeno.protagonist.lowerBodyState, '缩回');
  b.rollbackXenoOnDelete(2);
  assert.equal(b.settings.xeno.protagonist.lowerBodyState, '疲软'); assert.ok(b.settings.xeno.protagonist.statusLocks.lowerBodyState);
  const text = '故事正文' + tag({lowerBodyState: '疲软'});
  assert.equal(stripXenoUpdate(text), '故事正文');
  assert.equal(outgoingChat([{mes: text}], {pictures: false, voice: false, sounds: false})[0].mes, '故事正文');
  const cotUnclosedNoTail = '<think>思考：本轮无需输出 <xeno_action>、<xeno_update> 或 <xeno_organs>。</think>\n第一段正文。\n第二段正文。';
  assert.equal(stripXenoUpdate(cotUnclosedNoTail), '<think>思考：本轮无需输出 、 或 。</think>\n第一段正文。\n第二段正文。');
  const cotUnclosedWithTail = '<think>思考：末尾需要输出 <xeno_action>、<xeno_organs> 和 <xeno_update>。</think>\n第一段正文。\n<tts>旅人|1,0.7|出发吧</tts>\n第二段正文。\n<xeno_action>[{"action":"equip","target":"主角","itemId":"skin","evidence":"第一段正文。"}]</xeno_action>\n' + tag({lowerBodyState: '疲软'}) + '\n<xeno_update>旅人|旅客|扶她|黑发|高挑|原有生理描述|外套|内衣</xeno_update>';
  assert.equal(stripXenoUpdate(cotUnclosedWithTail), '<think>思考：末尾需要输出 、 和 。</think>\n第一段正文。\n<tts>旅人|1,0.7|出发吧</tts>\n第二段正文。');
  const plainCotAccidentalClose = '思考：检查 <xeno_update>\n第一段正文。\n第二段正文。\n旅人|旅客|扶她|黑发|高挑|原有生理描述|外套|内衣\n</xeno_update>';
  assert.equal(stripXenoUpdate(plainCotAccidentalClose), '思考：检查 \n第一段正文。\n第二段正文。');
});

test('旧原样默认器官规则升级，自定义文本与关闭清空保留；锁定事实独立注入', () => {
  const xeno = base(), preset = defaultXenoPreset(), rule = preset.entries.find(e => e.id === 'organSyncGuidance');
  rule.text = LEGACY_ORGAN_SYNC_RULE; rule.title = '角色状态 · 器官逐项同步规则';
  xeno.presets = [preset]; xeno.activePreset = preset.id;
  const upgraded = normalizeXeno(xeno).presets[0].entries.find(e => e.id === rule.id);
  assert.equal(upgraded.text, ORGAN_SYNC_RULE); assert.match(upgraded.title, /下体/);
  rule.text = LEGACY_ORGAN_SYNC_RULE + '\n用户自定义'; rule.enabled = false;
  assert.equal(normalizeXeno(xeno).presets[0].entries.find(e => e.id === rule.id).text, rule.text);
  assert.doesNotMatch(xenoPromptPlan(xeno).find(b => b.key === 'sttts.entry.xeno-status').text, /<xeno_organs>/);
  rule.enabled = true; rule.text = '';
  assert.doesNotMatch(xenoPromptPlan(xeno).find(b => b.key === 'sttts.entry.xeno-status').text, /<xeno_organs>/);
  edit(xeno, 'lowerBodyState', '缩回'); lock(xeno, 'lowerBodyState'); xeno.enabled = false;
  assert.match(xenoPromptPlan(xeno)[0].text, /下体当前状态/); assert.match(xenoPromptPlan(xeno)[0].text, /缩回/);
});

test('手动同步发送当前下体类型并共用状态约束，关闭规则不要求输出，旧聊天结果拒绝保存', async () => {
  const b = backendFixture(), requests = [];
  b.emit = () => {}; b.cardKey = () => 'card:a';
  b.generateText = async (ctx, request) => {requests.push(request); return tag({lowerBodyState: '缩回'});};
  const host = createXenoHost({backend: b, settings: () => b.settings, context: () => ({name1: '旅人', chat: [{name: '旁白', mes: '旅人的下体缩回。'}]})});
  await host.syncFromStory();
  assert.match(requests[0].prompt[0].content, /缩回（仅当前下体类型为扶她）/);
  assert.match(requests[0].prompt[1].content, /lowerBodyType/);
  assert.equal(b.settings.xeno.protagonist.lowerBodyState, '缩回');
  b.settings.xeno.presets[0].entries.find(e => e.id === 'organSyncGuidance').enabled = false;
  b.generateText = async (ctx, request) => {requests.push(request); return '<xeno_sync>主角|旅人|旅客|扶她|黑发|高挑|原有生理描述||</xeno_sync>';};
  await host.syncFromStory();
  assert.doesNotMatch(requests.at(-1).prompt[0].content, /<xeno_organs>/);
  assert.doesNotMatch(requests.at(-1).prompt[1].content, /按下体规则另输出/);
  b.generateText = async () => {b.activeChatKey = 'chat:b'; return tag({lowerBodyState: '疲软'});};
  await assert.rejects(host.syncFromStory(), /切换/);
  assert.equal(b.settings.xeno.protagonist.lowerBodyState, '缩回');
});

test('下体位于当前外观，显示状态选择器与性别限定，跨聊天弹窗不能保存', () => {
  const state = {xeno: base()}, listeners = new Map(), calls = [], notices = [];
  state.xeno.protagonist.lowerBodyAppearance = '<img onerror=bad>';
  let chat = 'chat:a', dialog, callback;
  const doc = {activeElement: null, addEventListener() {}, createElement: () => root};
  const root = {dataset: {}, ownerDocument: doc, scrollTop: 0, contains: el => !!el, querySelectorAll: () => [], querySelector: () => null,
    addEventListener(type, fn) {if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn);}};
  const api = {getState: () => state, subscribe: () => () => {}, statusChatKey: () => chat, xenoAct: (...args) => calls.push(args)};
  const ctx = {api, doc, win: {AbortController}, notify: message => notices.push(message), dialog(title, html) {
    dialog = {html, body: {addEventListener(type, fn) {callback = fn;}, querySelector: () => ({value: '缩回'})}, close() {}}; return dialog;
  }};
  const view = characterStatusApp(ctx);
  assert.match(root.innerHTML, /当前外观[\s\S]*下体外观[\s\S]*当前状态[\s\S]*衣物穿戴/);
  assert.match(root.innerHTML, /&lt;img onerror=bad&gt;/); assert.doesNotMatch(root.innerHTML, /新增器官|器官记录|data-organ-edit/);
  const click = () => {const el = {dataset: {edit: 'lowerBodyState'}, matches: () => false, closest: selector => selector === '[data-edit]' ? el : null};
    for (const fn of listeners.get('click')) fn({target: el, preventDefault() {}});};
  const save = () => callback({target: {closest: selector => selector === '[data-save]'}});
  click(); assert.match(dialog.html, /<select/); assert.match(dialog.html, /缩回（仅扶她）/); assert.doesNotMatch(dialog.html, /value="无"/);
  save(); assert.equal(calls.at(-1)[1].value, '缩回');
  state.xeno.protagonist.gender = '女'; view.refresh(); click();
  assert.match(dialog.html, /无（仅女性）/); assert.doesNotMatch(dialog.html, /value="缩回"|value="勃起"/);
  chat = 'chat:b'; const count = calls.length; save(); assert.equal(calls.length, count); assert.match(notices.at(-1), /切换/);
  view.dispose();
});
