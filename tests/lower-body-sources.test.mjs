import test from 'node:test';
import assert from 'node:assert/strict';
import {freshState} from '../core/state.js';
import {editCharacterStatus} from '../core/character-status.js';
import {normalizeXeno, effectiveEntityView, xenoEquipItem, xenoUnequipSlot, xenoUpdateMountOption,
  applyXenoUpdateFromText, buildEntityPortraitPrompt, xenoDrawTagsFor, extractXenoSession, mergeXenoSession} from '../core/xeno.js';
import {characterStatusApp} from '../ui/character-status.js';
import {xenoApp} from '../ui/xeno.js';
import {wardrobeApp} from '../ui/wardrobe.js';
import {TTSBackend} from '../core/backend.js';

const base = () => normalizeXeno({cardKey: 'card:a', protagonist: {name: '旅人', gender: '扶她',
  lowerBodyAppearance: '本体当前疲软', lowerBodyState: '疲软'}, items: [
  {id: 'inner', name: '内层测试', category: 'skin_suit', gender: '扶她', lowerBodyMode: 'replace', lowerBodyType: 'dual',
    lowerBodyDescription: '内层目前疲软', owned: true},
  {id: 'outer', name: '外层测试', category: 'skin_suit', gender: '扶她', lowerBodyMode: 'replace', lowerBodyType: 'dual',
    physiology: '最外层目前勃起', owned: true}
]});
const view = x => effectiveEntityView(x, x.protagonist);
const edit = (x, field, value) => editCharacterStatus(x.protagonist, {field, value}, view(x));
const update = (x, patch) => applyXenoUpdateFromText(x, `<xeno_organs>${JSON.stringify([{target: '主角', ...patch}])}</xeno_organs>`);
const worn = () => xenoEquipItem(xenoEquipItem(base(), {itemId: 'inner'}), {itemId: 'outer'});

test('当前外观有明确状态时自动得到状态，尺寸和否定文本不猜测，女性类型得到无', () => {
  for (const [appearance, expected] of [['目前勃起', '勃起'], ['当前疲软', '疲软'], ['已缩回', '缩回'],
    ['勃起长度20cm，疲软长度10cm', ''], ['尚未勃起，状态未记录', ''], ['不是勃起状态', ''], ['可随时勃起', ''], ['外观未说明状态', '']]) {
    const x = normalizeXeno({protagonist: {name: '旅人', gender: '扶她', lowerBodyAppearance: appearance}});
    assert.equal(view(x).lowerBodyState, expected, appearance);
  }
  assert.equal(view(normalizeXeno({protagonist: {name: '旅人', gender: '女'}})).lowerBodyState, '无');
});

test('读取最外层下体且按层保存编辑记录，关闭和脱下外层恢复内层与本体', () => {
  let x = worn();
  assert.match(view(x).lowerBodyAppearance, /最外层目前勃起/);
  assert.equal(view(x).lowerBodyState, '勃起');
  edit(x, 'lowerBodyAppearance', '最外层当前缩回');
  assert.equal(view(x).lowerBodyState, '缩回');
  assert.equal(x.protagonist.lowerBodyState, '疲软');
  assert.equal(x.protagonist.lowerBodyAppearance, '本体当前疲软');
  x = xenoUpdateMountOption(x, {itemId: 'outer', patch: {skinOrganOut: false}});
  assert.equal(view(x).lowerBodyState, '疲软'); assert.match(view(x).lowerBodyAppearance, /内层目前疲软/);
  x = xenoUpdateMountOption(x, {itemId: 'outer', patch: {skinOrganOut: true}});
  assert.equal(view(x).lowerBodyState, '缩回');
  x = xenoUnequipSlot(x, {slot: 'outermost'});
  assert.match(view(x).lowerBodyAppearance, /内层目前疲软/);
  x = xenoUnequipSlot(x, {slot: 'all'});
  assert.equal(view(x).lowerBodyAppearance, '本体当前疲软'); assert.equal(view(x).lowerBodyState, '疲软');
});

test('只同步外观也更新同一来源的状态，锁定值优先且不改本体或商品', () => {
  let x = worn(); const catalog = structuredClone(x.items);
  x = update(x, {lowerBodyAppearance: '外层最新疲软'});
  assert.equal(view(x).lowerBodyState, '疲软');
  assert.equal(x.protagonist.lowerBodyAppearance, '本体当前疲软'); assert.deepEqual(x.items, catalog);
  editCharacterStatus(x.protagonist, {field: 'lowerBodyState', locked: true}, view(x));
  x = update(x, {lowerBodyAppearance: '外层现在勃起'});
  assert.equal(view(x).lowerBodyState, '疲软');
  assert.equal(x.protagonist.lowerBodyState, '疲软');
  editCharacterStatus(x.protagonist, {field: 'lowerBodyState', locked: false}, view(x));
  x = update(x, {lowerBodyAppearance: '外层现在缩回', lowerBodyState: '尚未记录'});
  assert.equal(view(x).lowerBodyState, '缩回');
});

test('外层状态未知时不沿用本体或内层，仅当前来源的状态Tag可以补充', () => {
  let x = base(); x.items.find(i => i.id === 'outer').physiology = '外层外观未提及状态';
  x = xenoEquipItem(x, {itemId: 'outer'});
  assert.equal(view(x).lowerBodyState, '');
  x.items.find(i => i.id === 'outer').organDrawPrompt = 'erect';
  assert.equal(view(x).lowerBodyState, '勃起');
  x = xenoUpdateMountOption(x, {itemId: 'outer', patch: {skinOrganOut: false}});
  assert.equal(view(x).lowerBodyState, '疲软');
});

test('各来源状态随原聊天快照恢复，新聊天不继承同步覆盖记录', () => {
  const x = worn(); edit(x, 'lowerBodyAppearance', '聊天A外层当前缩回');
  const snap = JSON.parse(JSON.stringify(extractXenoSession(x)));
  const restored = mergeXenoSession(x, snap, 'card:a');
  assert.equal(view(restored).lowerBodyState, '缩回');
  assert.match(view(restored).lowerBodyAppearance, /聊天A外层/);
  assert.deepEqual(normalizeXeno(restored), restored);
  const fresh = mergeXenoSession(x, null, 'card:a');
  assert.doesNotMatch(view(fresh).lowerBodyAppearance, /聊天A外层/);
  assert.deepEqual(fresh.protagonist.lowerBodyRecords, {});
  const removed = normalizeXeno({...restored, items: restored.items.filter(item => item.id !== 'outer')});
  assert.equal(removed.protagonist.lowerBodyRecords['item:outer'], undefined);
  const b = Object.create(TTSBackend.prototype);
  Object.assign(b, {settings: {...freshState(), xeno: worn()}, space: {key: 'card:a', members: []}, activeChatKey: 'chat:a',
    xenoFloors: new Map(), routesHere: () => [], notify() {}, cardState() {return structuredClone(this.settings);},
    saveXeno(update) {const next = structuredClone(this.settings); next.xeno = normalizeXeno(update(next.xeno, next, 'card:a')); this.settings = next; return next.xeno;},
    persistActiveChatXeno: async () => {}});
  b.applyXenoFloorReply(1, 0, '<xeno_organs>[{"target":"主角","lowerBodyAppearance":"本楼外层当前缩回"}]</xeno_organs>');
  assert.equal(view(b.settings.xeno).lowerBodyState, '缩回');
  b.rollbackXenoOnDelete(1);
  assert.equal(view(b.settings.xeno).lowerBodyState, '勃起');
});

test('肉躯仅后方延展不提供下体状态，前方和独立部位开关才切换有效来源', () => {
  let x = base();
  x.items.push({id: 'ring', name: '肉躯测试', category: 'flesh_ring', gender: '扶她', lowerBodyMode: 'replace', lowerBodyType: 'dual',
    forwardExtension: '前方现在缩回', backwardExtension: '后方现在勃起', owned: true});
  x = xenoEquipItem(x, {itemId: 'ring', mode: 'backward'});
  assert.equal(view(x).lowerBodyState, '疲软');
  x = xenoUpdateMountOption(x, {itemId: 'ring', patch: {fleshForwardEnabled: true}});
  assert.equal(view(x).lowerBodyState, '缩回');
  x = xenoUpdateMountOption(x, {itemId: 'ring', patch: {organOut: false}});
  assert.equal(view(x).lowerBodyState, '疲软');
});

test('角色状态、异构终端、衣柜及生图共用当前外观和状态，事件后同步刷新', () => {
  const settings = freshState(); settings.xeno = worn(); edit(settings.xeno, 'lowerBodyAppearance', '共同外观当前疲软');
  const roots = [], apps = [], subscribers = new Set();
  for (const create of [characterStatusApp, xenoApp, wardrobeApp]) {
    const doc = {activeElement: null, addEventListener() {}, createElement: () => root};
    const root = {dataset: {}, ownerDocument: doc, scrollTop: 0, contains: () => true,
      querySelectorAll: () => [], querySelector: () => null, addEventListener() {}};
    const api = {getState: () => settings, subscribe(fn) {subscribers.add(fn); return () => subscribers.delete(fn);}};
    apps.push(create({api, doc, win: {AbortController}, notify() {}})); roots.push(root);
  }
  for (const root of roots) {assert.match(root.innerHTML, /共同外观当前疲软/); assert.match(root.innerHTML, /疲软/);}
  for (const prompt of [buildEntityPortraitPrompt(settings.xeno, settings.xeno.protagonist).prompt, xenoDrawTagsFor(settings.xeno, '主角')]) {
    assert.match(prompt, /flaccid/); assert.doesNotMatch(prompt, /erect/);
  }
  edit(settings.xeno, 'lowerBodyAppearance', '新共同外观当前缩回');
  for (const notify of subscribers) notify({type: 'xeno'});
  for (const root of roots) assert.match(root.innerHTML, /新共同外观当前缩回/);
  assert.match(buildEntityPortraitPrompt(settings.xeno, settings.xeno.protagonist).prompt, /female/);
  for (const app of apps) app.dispose(); assert.equal(subscribers.size, 0);
});
