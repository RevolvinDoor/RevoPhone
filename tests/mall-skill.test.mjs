import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {packItems, checkBundle, extractRules} from '../skills/revophone-mall-restock/scripts/mall-pack.mjs';
import {TTSBackend} from '../core/backend.js';
import {freshState} from '../core/state.js';
import {normalizeXeno, normalizeCatalogItem} from '../core/xeno.js';

const apparel = {name: '雾行披风', category: 'apparel', slot: 'outerwear', price: 680, abilities: '细雨防护', abilityConditions: '不防浸泡'};
const fixtures = [
  {...apparel},
  {name: '星河', category: 'skin_suit', price: 1500, gender: '女', lowerBodyMode: 'replace', lowerBodyType: 'female',
    lowerBodyDescription: '按本件结构覆盖', appearance: '银发', bodyBuild: '身高170cm', abilities: '夜视', abilityConditions: '低光环境',
    drawPrompt: 'silver hair', rawDesign: '完整结构资料'},
  {name: '晨露', category: 'flesh_ring', price: 1200, gender: '男', ringAppearance: '银色环体',
    forwardExtension: '局部重构设定', backwardExtension: '全身重构设定'},
  {name: '专注徽记', category: 'consumable', price: 120, effectKind: 'cognition', summary: '将本次行动视为专注练习'}
];

test('批量技能打包四分类并通过商城真实归一化，去掉拥有状态和图片，重打包保留编号', () => {
  const {bundle} = packItems(fixtures.map(item => ({...item, owned: true, imageData: 'not-exported', storyCraftId: 'old'})));
  assert.equal(bundle.count, 4);
  assert.equal(new Set(bundle.items.map(item => item.id)).size, 4);
  for (const item of bundle.items) {
    assert.ok(item.id.startsWith('restock_')); assert.equal(item.source, 'restock'); assert.equal(item.listed, true);
    assert.equal(Object.hasOwn(item, 'owned'), false); assert.equal(Object.hasOwn(item, 'imageData'), false);
    assert.equal(Object.hasOwn(item, 'storyCraftId'), false);
    const normalized = normalizeCatalogItem(item);
    assert.equal(normalized.owned, false);
    for (const [key, value] of Object.entries(item)) assert.equal(normalized[key], value, key);
  }
  assert.equal(bundle.items[0].gender, '');
  assert.deepEqual(checkBundle(bundle).bundle, bundle);
  assert.deepEqual(packItems(bundle).bundle.items, bundle.items);
});

test('商品包实际增量导入和重导不增加副本，不清空已购买状态、图片及永久音色', () => {
  const b = Object.create(TTSBackend.prototype);
  b.settings = freshState(); b.cardKey = () => ''; b.routesHere = () => [];
  b.saveXeno = update => {b.settings.xeno = normalizeXeno(update(structuredClone(b.settings.xeno))); return b.settings.xeno;};
  const bundle = packItems(fixtures).bundle;
  b.xenoAct('importItems', {items: bundle.items, replaceRestock: false});
  const target = b.settings.xeno.items.find(row => row.id === bundle.items[1].id), count = b.settings.xeno.items.length;
  assert.equal(target.owned, false); assert.equal(target.abilities, '夜视');
  Object.assign(target, {owned: true, imageData: 'local-image', voiceRole: 'bound-local-voice'});
  const update = structuredClone(bundle); update.items[1].price = 1700;
  b.xenoAct('importItems', {items: checkBundle(update).bundle.items, replaceRestock: false});
  const restored = b.settings.xeno.items.find(row => row.id === target.id);
  assert.equal(b.settings.xeno.items.length, count); assert.equal(restored.owned, true);
  assert.equal(restored.imageData, 'local-image'); assert.equal(restored.voiceRole, 'bound-local-voice');
  assert.equal(restored.price, 1700); assert.equal(restored.lowerBodyType, 'female');
  assert.equal(restored.abilityConditions, '低光环境');
});

test('非法分类、售价、槽位、类型、长度和批内冲突都在交付前被拒绝', () => {
  for (const patch of [{name: ''}, {name: 'x'.repeat(161)}, {price: -1}, {price: 1.2}, {price: '680'},
    {price: 1000000}, {category: 'unknown'}, {slot: 'skin_suit'}, {gender: 'female'},
    {source: 'crafted'}, {abilities: 'x'.repeat(4001)}, {unknownAbility: 'script'}]) {
    assert.throws(() => packItems([{...apparel, ...patch}]));
  }
  assert.throws(() => packItems([{name: '道具', category: 'consumable', price: 0}]), /effectKind/);
  assert.throws(() => packItems([{...apparel, id: 'same'}, {...apparel, name: '另一件', id: 'same'}]), /重复 ID/);
  assert.throws(() => packItems([apparel, apparel]), /重名/);
  assert.throws(() => packItems(Array.from({length: 201}, (_, i) => ({...apparel, name: '单品' + i}))), /200/);
  const bundle = packItems([apparel]).bundle;
  assert.throws(() => checkBundle({...bundle, count: 2}), /count/);
  assert.throws(() => checkBundle({...bundle, items: [{...bundle.items[0], owned: false}]}), /购买状态/);
  const incomplete = structuredClone(bundle); delete incomplete.items[0].lowerBodyMode;
  assert.throws(() => checkBundle(incomplete), /结构模式/);
});

test('完整目录核对容量、同名以及非进货ID冲突，正常更新不占新名额', () => {
  const catalog = Array.from({length: 200}, (_, i) => ({id: 'stock-' + i, name: '已有商品' + i, category: 'apparel', source: 'restock'}));
  assert.throws(() => packItems([apparel], {catalog}), /201/);
  const {catalogCheck} = packItems([{...apparel, id: 'stock-0'}], {catalog});
  assert.deepEqual(catalogCheck, {checked: true, existing: 200, added: 0, total: 200});
  assert.throws(() => packItems([{...apparel, name: '已有商品1'}], {catalog: catalog.slice(0, 2)}), /同分类同名/);
  assert.throws(() => packItems([{...apparel, id: 'stock-0'}], {catalog: [{...catalog[0], source: 'shop'}]}), /非进货商品/);
  assert.throws(() => packItems([{name: '新身体', category: 'skin_suit', id: 'stock-0', price: 500}], {catalog}), /改变分类/);
});

test('读取用户异构预设只提取当前有效规则，不恢复关闭内容、不输出前置对话或其他设置', () => {
  const preset = {id: 'custom', name: '定制', entries: [
    {id: 'scaleRule', enabled: true, text: '身高160–190cm'},
    {id: 'skinWorkbench', enabled: false, text: 'DISABLED-TEMPLATE'},
    {id: 'apparelWorkbench', enabled: true, text: ''},
    {id: 'mallPosePrompt', enabled: false, text: '旧姿势'},
    {id: 'mallPoseStand', enabled: true, text: 'standing'},
    {id: 'mallPoseSolo', enabled: true, text: 'solo'},
    {id: 'restockPreAssistant', enabled: true, text: 'DO-NOT-EXTRACT-PRELUDE'}
  ]};
  const extracted = extractRules({format: 'st-iphonie-preset', kind: 'xeno', preset});
  assert.equal(extracted.scale.text, '身高160–190cm'); assert.equal(extracted.workbenches.skin_suit.text, '');
  assert.equal(extracted.workbenches.flesh_ring.present, false); assert.equal(extracted.workbenches.apparel.text, '');
  assert.equal(extracted.pose.id, 'mallPoseStand'); assert.equal(extracted.pose.text, 'standing');
  assert.doesNotMatch(JSON.stringify(extracted), /DO-NOT-EXTRACT-PRELUDE|DISABLED-TEMPLATE/);
  const active = extractRules({xeno: {activePreset: preset.id, presets: [{id: 'other', entries: []}, preset]}, apiKey: 'never-output'});
  assert.deepEqual(active, extracted);
  assert.throws(() => extractRules({format: 'st-iphonie-preset', kind: 'draw', preset}), /异构预设/);
});

test('独立CLI从任意目录打包和校验真实文件，拒绝覆写、错误参数与缺少编号的伪成品', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'revophone-mall-skill-'));
  try {
    const draft = join(dir, '草稿.json'), output = join(dir, '商城.json');
    const script = resolve('skills/revophone-mall-restock/scripts/mall-pack.mjs');
    await writeFile(draft, '\uFEFF' + JSON.stringify(fixtures), 'utf8');
    const run = (...args) => spawnSync(process.execPath, [script, ...args], {cwd: dir, encoding: 'utf8'});
    const packed = run('pack', '--input', draft, '--output', output);
    assert.equal(packed.status, 0, packed.stderr);
    assert.equal(JSON.parse(packed.stdout).count, 4);
    const before = await readFile(output, 'utf8');
    assert.equal(run('check', '--input', output).status, 0);
    assert.notEqual(run('pack', '--input', draft, '--output', output).status, 0);
    assert.equal(await readFile(output, 'utf8'), before);
    assert.notEqual(run('pack', '--input', draft, '--output', draft).status, 0);
    assert.notEqual(run('check', '--input', output, '--unknown', 'x').status, 0);
    const bad = JSON.parse(before); delete bad.items[0].id;
    await writeFile(join(dir, 'bad.json'), JSON.stringify(bad));
    assert.notEqual(run('check', '--input', join(dir, 'bad.json')).status, 0);
  } finally {await rm(dir, {recursive: true, force: true});}
});
