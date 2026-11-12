import test from 'node:test';
import assert from 'node:assert/strict';
import {editCharacterStatus, normalizeStatusLocks, statusLockText} from '../core/character-status.js';
import {normalizeXeno, effectiveEntityView, applyXenoUpdateFromText, xenoPromptPlan, extractXenoSession, mergeXenoSession,
  xenoEquipItem, xenoUnequipSlot, xenoUpdateMountOption, defaultXenoPreset} from '../core/xeno.js';
import {freshState} from '../core/state.js';
import {TTSBackend} from '../core/backend.js';
import {applyWardrobeReply} from '../core/xeno-actions.js';
import {characterStatusApp} from '../ui/character-status.js';
import {APPS, HOME} from '../ui/apps.js';

const base = () => normalizeXeno({cardKey: 'card:a', protagonist: {name: '旅人', gender: '男', appearance: '黑发', bodyBuild: '高挑', outfit: {outerwear: '蓝色外套'}}});
function lock(xeno, field) {editCharacterStatus(xeno.protagonist, {field, locked: true}, effectiveEntityView(xeno, xeno.protagonist));}
const reply = '<xeno_update>旅人|旅客|男|银发|匀称|正常|红色外套|棉质内衣</xeno_update>';

test('锁定外观和衣物后，剧情同步只改变未锁字段，解锁后可再次更新', () => {
  const xeno = base(); lock(xeno, 'appearance'); lock(xeno, 'outerwear');
  const next = applyXenoUpdateFromText(xeno, reply);
  assert.equal(next.protagonist.appearance, '黑发');
  assert.equal(next.protagonist.outfit.outerwear, '蓝色外套');
  assert.equal(next.protagonist.bodyBuild, '匀称');
  assert.equal(xeno.protagonist.bodyBuild, '高挑');
  assert.throws(() => editCharacterStatus(next.protagonist, {field: 'appearance', value: '白发'}, {}), /解锁/);
  editCharacterStatus(next.protagonist, {field: 'appearance', locked: false}, {});
  assert.equal(applyXenoUpdateFromText(next, reply).protagonist.appearance, '银发');
});

test('锁定值随聊天存档恢复，新聊天不继承锁；空记录可锁定且无效字段不保存', () => {
  const xeno = base(); lock(xeno, 'appearance'); lock(xeno, 'accessories');
  assert.deepEqual(normalizeStatusLocks({unknown: {value: 'x'}, appearance: false}), {});
  const saved = JSON.parse(JSON.stringify(extractXenoSession(xeno)));
  assert.equal(mergeXenoSession(xeno, saved, 'card:a').protagonist.statusLocks.appearance.value, '黑发');
  assert.deepEqual(mergeXenoSession(xeno, null, 'card:a').protagonist.statusLocks, {});
  xeno.protagonist.outfit.accessories = '帽子';
  assert.equal(normalizeXeno(xeno).protagonist.outfit.accessories, '');
});

test('正文锁定清单包含角色与固定值，异构开关关闭后仍保持约束；旧预设增加说明而不改自定义文本', () => {
  const xeno = base(); lock(xeno, 'appearance');
  for (const enabled of [true, false]) {
    const block = xenoPromptPlan({...xeno, enabled}).find(block => block.key === 'sttts.entry.character-status-locks');
    assert.match(block.text, /旅人/); assert.match(block.text, /黑发/); assert.equal(block.role, 0);
  }
  assert.equal(statusLockText(base()), '');
  const preset = defaultXenoPreset();
  preset.entries = preset.entries.filter(entry => entry.id !== 'statusLockGuidance');
  preset.entries.find(entry => entry.id === 'autoSync').text = '自定义同步';
  const migrated = normalizeXeno({...xeno, presets: [preset], activePreset: preset.id}).presets[0];
  assert.equal(migrated.entries.find(entry => entry.id === 'autoSync').text, '自定义同步');
  assert.ok(migrated.entries.some(entry => entry.id === 'statusLockGuidance'));
});

test('衣柜与剧情穿脱拒绝改动已锁衣物，保留绑定和穿着姿态', () => {
  let xeno = base();
  xeno.items = [{id: 'coat', name: '旅行外套', category: 'apparel', slot: 'outerwear', summary: '蓝色', owned: true}];
  xeno = xenoEquipItem(xeno, {itemId: 'coat'}); lock(xeno, 'outerwear');
  assert.throws(() => xenoUnequipSlot(xeno, {slot: 'outerwear'}), /锁定/);
  assert.throws(() => xenoUpdateMountOption(xeno, {patch: {coatPose: 'open'}}), /锁定/);
  const result = applyWardrobeReply(xeno, '旅人脱下了旅行外套。<xeno_action>[{"action":"unequip","target":"主角","slot":"outerwear"}]</xeno_action>');
  assert.equal(result.state.protagonist.outfit.outerwearItemId, 'coat');
  const next = normalizeXeno(xeno); next.protagonist.outfit.outerwearItemId = '';
  assert.equal(normalizeXeno(next).protagonist.outfit.outerwearItemId, 'coat');
});

test('有效外观服从锁定值，手动保存拒绝旧聊天上下文', () => {
  const b = Object.create(TTSBackend.prototype);
  Object.assign(b, {settings: {...freshState(), xeno: base()}, activeChatKey: 'chat:a',
    saveXeno(update) {const next = structuredClone(this.settings); next.xeno = normalizeXeno(update(next.xeno, next, 'card:a')); this.settings = next; return next.xeno;}});
  b.xenoAct('editCharacterStatus', {field: 'appearance', locked: true, chatKey: 'chat:a'});
  assert.throws(() => b.xenoAct('editCharacterStatus', {field: 'appearance', locked: false, chatKey: 'chat:b'}), /切换/);
  b.settings.xeno.protagonist.appearance = '银发';
  assert.equal(effectiveEntityView(b.settings.xeno, b.settings.xeno.protagonist).appearance, '黑发');
});

test('楼层切换与删除回退恢复锁定快照，不保留后续解锁', () => {
  const b = Object.create(TTSBackend.prototype);
  Object.assign(b, {settings: {...freshState(), xeno: base()}, space: {key: 'card:a', members: []},
    activeChatKey: 'chat:a', xenoFloors: new Map(), routesHere: () => [], notify() {},
    cardState() {return structuredClone(this.settings);},
    saveXeno(update) {const next = structuredClone(this.settings); next.xeno = normalizeXeno(update(next.xeno, next, 'card:a')); this.settings = next; return next.xeno;},
    persistActiveChatXeno: async () => {}});
  lock(b.settings.xeno, 'appearance');
  b.applyXenoFloorReply(2, 0, reply);
  assert.equal(b.settings.xeno.protagonist.appearance, '黑发');
  b.xenoAct('editCharacterStatus', {field: 'appearance', locked: false});
  b.applyXenoFloorReply(3, 0, reply);
  assert.equal(b.settings.xeno.protagonist.appearance, '银发');
  b.rollbackXenoOnDelete(2);
  assert.equal(b.settings.xeno.protagonist.statusLocks.appearance.value, '黑发');
});

test('状态入口渲染转义文字，来源默认折叠，勾选调用共享状态且关闭页面取消订阅', () => {
  const state = {xeno: base()}, listeners = new Map(), calls = [];
  state.xeno.protagonist.appearance = '<img src=x onerror=bad>';
  let unsubscribed = false;
  const doc = {activeElement: null, addEventListener() {}, createElement: () => root};
  const root = {dataset: {}, ownerDocument: doc, scrollTop: 0, contains: element => !!element,
    querySelectorAll: () => [], querySelector: () => null,
    addEventListener(type, fn) {if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn);}};
  const api = {getState: () => state, subscribe: () => () => {unsubscribed = true;}, xenoAct: (...args) => calls.push(args)};
  const view = characterStatusApp({api, doc, win: {AbortController}, notify() {}});
  assert.ok(APPS['character-status']); assert.ok(HOME.pages.flat().includes('character-status'));
  assert.match(root.innerHTML, /&lt;img src=x onerror=bad&gt;/);
  assert.doesNotMatch(root.innerHTML, /<details[^>]*\bopen\b/);
  const el = {dataset: {lock: 'appearance'}, checked: true, closest: selector => selector === '[data-lock]' ? el : null};
  for (const fn of listeners.get('change')) fn({target: el});
  assert.deepEqual(calls, [['editCharacterStatus', {targetKey: '__protagonist__', field: 'appearance', locked: true}]]);
  view.dispose(); assert.equal(unsubscribed, true);
});
