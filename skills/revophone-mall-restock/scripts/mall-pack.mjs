import {readFile, writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const FORMAT = 'revophone-mall-items';
const CATEGORIES = ['skin_suit', 'flesh_ring', 'apparel', 'consumable'];
const SLOTS = ['outerwear', 'underwear', 'privacyCover', 'accessories'];
const LIMITS = {id: 120, name: 160, shortName: 80, summary: 400, appearance: 1000, bodyBuild: 1000,
  physiology: 1000, ringAppearance: 800, forwardExtension: 1000, backwardExtension: 1000,
  lowerBodyDescription: 1000, abilities: 4000, abilityConditions: 2000, drawPrompt: 1500,
  organDrawPrompt: 1500,
  drawPromptOpen: 1500, voiceRole: 4000, rawDesign: 6000};
const OMIT = ['owned', 'imageData', 'storyPurchaseId', 'storyCraftId', 'sourceTargetName'];
const KEYS = new Set([...Object.keys(LIMITS), ...OMIT, 'category', 'slot', 'price', 'source', 'listed',
  'gender', 'lowerBodyMode', 'lowerBodyType', 'effectKind', 'voiceRoleExplicit']);
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const nameKey = item => `${item.category}:${item.name}`;
function fail(message) {throw Error(message);}
function enumValue(value, choices, field) {
  if (!choices.includes(value)) fail(`${field} 应为 ${choices.map(value => JSON.stringify(value)).join(' / ')}`);
  return value;
}
function text(value, key) {
  if (typeof value !== 'string') fail(`${key} 必须是字符串`);
  const clean = value.trim();
  if (clean.length > LIMITS[key]) fail(`${key} 超过 ${LIMITS[key]} 字符，商城会截断，请先精简`);
  return clean;
}

export function itemList(data) {
  const list = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : record(data) && data.name ? [data] : null;
  if (!list?.length) fail('没有找到非空的商品数组或 items');
  return list;
}

function prepareItem(raw, assignIds) {
  if (!record(raw)) fail('商品必须是对象');
  for (const key of Object.keys(raw)) if (!KEYS.has(key)) fail(`不支持的商品字段：${key}`);
  const item = {};
  for (const key of Object.keys(LIMITS)) if (own(raw, key)) item[key] = text(raw[key], key);
  if (!item.name) fail('商品名称不能为空');
  if (!item.id) {
    if (!assignIds) fail('成品缺少稳定 id，请先 pack');
    item.id = 'restock_' + randomUUID();
  }
  if (item.shortName === undefined) item.shortName = item.name.slice(0, 80);
  item.category = enumValue(raw.category, CATEGORIES, 'category');
  if (!Number.isInteger(raw.price) || raw.price < 0 || raw.price > 999999) fail('price 必须是 0–999999 的整数');
  item.price = raw.price;
  if (raw.source !== undefined && raw.source !== 'restock') fail('只打包 restock 进货商品，请先排除内置、自制或角色转化物品');
  item.source = 'restock';
  if (raw.listed !== undefined && typeof raw.listed !== 'boolean') fail('listed 必须是布尔值');
  item.listed = raw.listed ?? true;
  item.gender = enumValue(raw.gender ?? '', ['', '男', '女', '扶她'], 'gender');
  item.lowerBodyMode = enumValue(raw.lowerBodyMode ?? 'replace', ['replace', 'preserve', 'legacy'], 'lowerBodyMode');
  item.lowerBodyType = enumValue(raw.lowerBodyType ?? 'auto', ['auto', 'female', 'male', 'dual', 'none', 'custom'], 'lowerBodyType');
  if (own(item, 'drawPrompt')) {
    item.drawPrompt = item.drawPrompt
      .split(/\s*[,，]\s*/)
      .map(s => s.trim())
      .filter(s => s && !/^(?:\d*\s*)?futanari$/i.test(s))
      .join(', ');
  }
  if (own(item, 'organDrawPrompt') && item.organDrawPrompt) {
    const tags = item.organDrawPrompt
      .split(/\s*[,，]\s*/)
      .map(s => s.trim())
      .filter(s => s && !/^(?:\d*\s*)?futanari$/i.test(s));
    item.organDrawPrompt = ['futanari', ...tags].join(', ').slice(0, LIMITS.organDrawPrompt);
  }
  item.slot = item.category === 'apparel' ? enumValue(raw.slot, SLOTS, 'slot') : item.category;
  if (raw.slot !== undefined && raw.slot !== item.slot) fail(`slot 与分类不一致，应为 ${item.slot}`);
  if (item.category === 'consumable') item.effectKind = enumValue(raw.effectKind, ['cognition', 'body', 'physiology'], 'effectKind');
  else if (raw.effectKind) fail('非道具商品不应包含 effectKind');
  if (own(item, 'voiceRole')) item.voiceRoleExplicit = true;
  return item;
}

export function checkCatalog(items, catalog) {
  if (!catalog) return {checked: false, note: '未提供商城全部商品目录，尚未核对本地余量及同名冲突'};
  const existing = itemList(catalog), byId = new Map(), byName = new Map();
  for (const row of existing) {
    if (!record(row) || typeof row.id !== 'string' || !row.id || !CATEGORIES.includes(row.category) || typeof row.name !== 'string') fail('完整目录中存在无效 ID、名称或分类');
    if (byId.has(row.id)) fail(`完整目录中存在重复 ID：${row.id}`);
    byId.set(row.id, row);
    const key = nameKey(row);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(row.id);
  }
  let added = 0;
  for (const item of items) {
    const matched = byId.get(item.id);
    if (matched && (matched.category !== item.category || matched.source !== 'restock')) fail(`编号 ${item.id} 不能用于改变分类或覆盖非进货商品`);
    if ((byName.get(nameKey(item)) || []).some(id => id !== item.id)) fail(`本地存在同分类同名的另一商品：${item.name}。更新时沿用原 ID；新商品请改名`);
    if (!matched) added++;
  }
  const total = existing.length + added;
  if (total > 200) fail(`导入后共 ${total} 件，超过 200 件上限；请先清理目录或减少新货`);
  return {checked: true, existing: existing.length, added, total};
}

export function packItems(data, {catalog, assignIds = true, now = new Date().toISOString()} = {}) {
  const input = itemList(data);
  if (input.length > 200) fail('单批超过 200 件，商城目录无法完整保留');
  const ids = new Set(), names = new Set();
  const items = input.map((raw, index) => {
    let item;
    try {item = prepareItem(raw, assignIds);}
    catch (error) {fail(`第 ${index + 1} 件：${error.message}`);}
    if (ids.has(item.id)) fail(`批内重复 ID：${item.id}`);
    if (names.has(nameKey(item))) fail(`批内同分类商品重名：${item.name}`);
    ids.add(item.id); names.add(nameKey(item));
    return item;
  });
  const catalogCheck = checkCatalog(items, catalog);
  return {bundle: {format: FORMAT, version: 1, exportedAt: now, count: items.length, items}, catalogCheck};
}

export function checkBundle(data, {catalog} = {}) {
  if (!record(data) || data.format !== FORMAT || data.version !== 1) fail(`成品必须是 ${FORMAT} v1 文件`);
  if (!Array.isArray(data.items) || data.count !== data.items.length) fail('count 与实际 items 数量不符');
  if (typeof data.exportedAt !== 'string' || !Number.isFinite(Date.parse(data.exportedAt))) fail('exportedAt 必须是有效时间');
  for (const item of data.items) {
    if (record(item) && OMIT.some(key => own(item, key))) fail('成品不应携带图片、购买状态或剧情来源；请重新 pack');
    if (!record(item) || item.source !== 'restock' || typeof item.listed !== 'boolean'
      || ['gender', 'lowerBodyMode', 'lowerBodyType', 'slot'].some(key => !own(item, key))) fail('成品缺少明确的来源、展示、身体类型、结构模式或槽位；请先 pack');
  }
  return packItems(data, {catalog, assignIds: false, now: data.exportedAt});
}

export function extractRules(data) {
  let preset;
  if (data?.format === 'st-iphonie-preset') {
    if (data.kind !== 'xeno') fail('请选择异构预设，其他类型不包含商城工作台');
    preset = data.preset;
  } else if (Array.isArray(data?.entries)) preset = data;
  else {
    const xeno = data?.xeno || data?.settings?.xeno;
    if (Array.isArray(xeno?.presets)) preset = xeno.presets.find(entry => entry.id === xeno.activePreset);
  }
  if (!record(preset) || !Array.isArray(preset.entries)) fail('未找到异构预设；请提供导出的异构预设或明确包含使用中预设的设置');
  const read = id => {
    const entry = preset.entries.find(entry => entry?.id === id);
    return {present: !!entry, enabled: !!entry && entry.enabled !== false, text: entry?.enabled === false ? '' : String(entry?.text ?? '').trim()};
  };
  const poseIds = ['mallPosePrompt', 'mallPoseStand', 'mallPoseSolo'];
  const activePose = poseIds.find(id => read(id).enabled);
  return {preset: {id: preset.id || '', name: preset.name || ''}, scale: read('scaleRule'),
    workbenches: {skin_suit: read('skinWorkbench'), flesh_ring: read('ringWorkbench'), apparel: read('apparelWorkbench')},
    pose: activePose ? {id: activePose, ...read(activePose)} : null};
}

function summary(result) {
  const {items} = result.bundle;
  return {count: items.length, categories: Object.fromEntries(CATEGORIES.map(category => [category, items.filter(item => item.category === category).length])),
    price: {min: Math.min(...items.map(item => item.price)), max: Math.max(...items.map(item => item.price))},
    catalog: result.catalogCheck};
}
async function readJSON(file) {
  try {return JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));}
  catch (error) {fail(`无法读取 JSON ${file}：${error.message}`);}
}
export async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv, flags = {};
  if (!['pack', 'check', 'rules'].includes(command)) fail('用法：mall-pack.mjs pack --input draft.json --output stock.json [--catalog all.json]；check --input stock.json [--catalog all.json]；rules --input preset.json');
  const allowed = command === 'pack' ? ['--input', '--output', '--catalog'] : command === 'check' ? ['--input', '--catalog'] : ['--input'];
  for (let i = 0; i < rest.length; i += 2) {
    if (!allowed.includes(rest[i]) || !rest[i + 1] || rest[i + 1].startsWith('--') || own(flags, rest[i])) fail(`参数错误：${rest[i]}`);
    flags[rest[i]] = rest[i + 1];
  }
  if (!flags['--input'] || command === 'pack' && !flags['--output']) fail('缺少 --input 或 --output');
  const input = await readJSON(flags['--input']);
  if (command === 'rules') {console.log(JSON.stringify(extractRules(input), null, 2)); return;}
  const catalog = flags['--catalog'] ? await readJSON(flags['--catalog']) : undefined;
  const result = command === 'check' ? checkBundle(input, {catalog}) : packItems(input, {catalog});
  if (command === 'pack') {
    if (resolve(flags['--input']) === resolve(flags['--output'])) fail('输入输出不可相同，请保留原始草稿或成品');
    await writeFile(flags['--output'], JSON.stringify(result.bundle, null, 2) + '\n', {encoding: 'utf8', flag: 'wx'});
  }
  console.log(JSON.stringify({...summary(result), ...(flags['--output'] ? {output: resolve(flags['--output'])} : {}), valid: true}, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {console.error(error.message); process.exitCode = 1;});
}
