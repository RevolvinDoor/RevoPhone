// Core state, status-bar engine, wardrobe/mall catalog logic, and SillyTavern prompt injection for RevoPhone's
// three new apps: 1. 异构终端 (xeno), 2. 衣柜 (wardrobe), 3. 购物商城 (mall).
// Replaces TavernDB with zero-latency local actions, on-demand rule injection, and automatic story state sync.

import {XENO_RULE_TEXTS, INITIAL_MALL_ITEMS, XENO_PROMPT_DEFAULTS, XENO_TRIGGER_KEYWORDS, DEFAULT_XENO_ENTRIES, defaultXenoPreset} from './xeno-catalog.js';
import {roleTypeOf, isValidRoleName, findRoute} from './routes.js';
import {encodeBoundVoiceRef, parseBoundVoiceRef} from './xeno-voice.js';
import {lineEffect} from './voice-fx.js';
import {enforceStatusLocks, normalizeStatusLocks, statusLockText, normalizeOrgans, organRecordText, applyOrganUpdates, migrateLowerBody, lowerBodyStateValue, LEGACY_ORGAN_SYNC_RULE, ORGAN_SYNC_RULE} from './character-status.js';
import {normalizeWearMount, syncWearMount, wearLayers, resolveWear, itemOccupant, wearDrawingTags, wearDrawingAppearance, itemVoiceRef, extensionEnabled, extensionMode, normalizeCharacterDrawPrompt, normalizeOrganDrawPrompt, splitItemDrawPrompts, parseItemTextBlock} from './xeno-wear.js';
export {wearLayers, resolveWear, itemOccupant, itemVoiceRef, normalizeCharacterDrawPrompt, normalizeOrganDrawPrompt, splitItemDrawPrompts, parseItemTextBlock};
export {XENO_PROMPT_DEFAULTS, DEFAULT_XENO_ENTRIES, defaultXenoPreset};

export const MALL_POSE_ENTRIES = Object.freeze([
  {id: 'mallPosePrompt', label: '🧍 T-pose+三视图', title: '商城进货 · 姿势预设1（T-pose+三视图）'},
  {id: 'mallPoseStand', label: '📐 标准站姿三视图', title: '商城进货 · 姿势预设2（标准站姿三视图）'},
  {id: 'mallPoseSolo', label: '✨ 单人全身展示', title: '商城进货 · 姿势预设3（单人全身展示）'}
]);

export const GENDERS = Object.freeze(['男', '女', '扶她']);
export const POSSESSION_MODES = Object.freeze(['浅层共鸣', '意识共存', '完全占据', '认知覆盖']);
export const POSSESSION_WAYS = Object.freeze(['洞察推荐', '近距锁定', '灵体游离']);
export const FUSION_MODES = Object.freeze(['浅层融合', '共存融合', '完全融合', '认同融合']);
export const FUSION_BRANCHES = Object.freeze(['正常分离', '皮躯化', '肉躯化']);
export const PARASITE_KINDS = Object.freeze([
  ['body', '本体化形寄生（主角本体浓缩化形为宿主器官）'],
  ['scion', '分体子体寄生（主角在外界行动 + 植入分体子体）']
]);
export const PARASITE_SITES = Object.freeze([
  ['crotch', '下体 / 阴蒂（共生肉棒化）'],
  ['womb', '子宫 / 卵巢（巢穴核心寄生）'],
  ['spine', '脊椎 / 脑干（神经中枢寄生）'],
  ['surface', '体表 / 小腹（活体淫纹 / 共生外衣）'],
  ['back_hulk', '背面巨躯寄生（分体子体专属 · 屁穴潜伏细胞 ⇄ 背面无头巨躯）']
]);
export const PARASITE_SITE_FORMS = Object.freeze({
  crotch: [
    '隐伏态（潜藏于阴蒂/耻骨内，外观仍为女性）',
    '觉醒态（向外生长为完整共生扶她肉棒与玉囊）'
  ],
  womb: [
    '静息盘踞（贴合子宫腔壁温热潜伏）',
    '触须研磨（贴合宫颈口与G点内壁持续挑逗）',
    '蜜液灌注（分泌高浓度共生催情蜜液改造体质）'
  ],
  spine: [
    '感官潜伏（潜伏于神经束共享五感）',
    '感官增幅（快感成倍放大 / 痛觉转化为快感）',
    '神经接管（强制支配肢体动作与生理反射）'
  ],
  surface: [
    '潜伏淫纹态（小腹浮现精美共生纹路）',
    '敏感带缠绕（蔓延包裹乳首与私处）',
    '共生外衣态（延展化作活体紧身衣裙覆盖全身）'
  ],
  back_hulk: [
    '潜伏态（屁穴子体细胞 · 潜藏于目标后庭直肠深处）',
    '激活态（背面无头巨躯 · 从屁穴急速分裂膨胀并将目标正面四肢没入镶嵌）'
  ]
});
export const PARASITE_MODES = Object.freeze(['潜伏共生', '共生同化', '合作共生']);
export const PARASITE_HULK_FUTA_MODES = Object.freeze([
  '无扶她肉棒',
  '长在目标胯下',
  '长在巨躯胯下',
  '双重扶她肉棒'
]);
export const PARASITE_RELEASE_BRANCHES = Object.freeze([
  '正常剥离（抹除记忆并合理化）',
  '正常剥离（保留共生记忆）',
  '永久器官固化',
  '转化为皮躯存入衣柜',
  '凝缩为肉躯存入衣柜'
]);
export const VORE_CHANNELS = Object.freeze(['口腔', '小穴', '肛门', '阴茎口', '异化捕食尾']);
export const VORE_LOCATIONS = Object.freeze(['胃部', '子宫巢']);
export const VORE_STATUSES = Object.freeze(['激烈挣扎（肚皮浮现拳脚轮廓）', '无力蠕动', '沉沦高潮', '昏迷沉睡']);
export const VORE_DIGESTIONS = Object.freeze(['暂不消化（长期禁锢把玩）', '分泌粘液溶解衣物（0%）', '正在消化（35%）', '深度分解（75%）', '完全吸收（100%）']);
export const TAIL_STATES = Object.freeze([
  ['none', '未挂载'],
  ['hidden', '隐蔽态（收缩藏于尾椎）'],
  ['deployed', '展开态（粗壮肉尾 + 花蕊吞噬巨口）']
]);
export const ORIFICE_SLOTS = Object.freeze([
  ['mouth', '口腔'],
  ['vagina', '小穴'],
  ['anus', '肛门'],
  ['urethra', '阴茎口'],
  ['tail', '捕食尾口']
]);
export const ORIFICE_MOD_TYPES = Object.freeze(['常态', '肉茎化增生', '吮吸陷阱', '生物侵入针']);
export const VENOM_TYPES = Object.freeze(['强效催情毒液', '神经麻痹液']);
export const WORLD_CARRIERS = Object.freeze([
  ['auto', '自动随世界观适配'],
  ['app', '现代/科幻：神秘手机应用程序'],
  ['cultivation', '修仙背景：失传夺舍与合体功法'],
  ['fantasy', '西幻背景：禁忌血肉与灵魂秘术']
]);
export const PRESET_COGNITION_RULES = Object.freeze([
  '认为在主角面前展示身体或穿戴极高露出度衣物是天经地义的日常礼仪',
  '无论自身或他人身体发生任何异变（如长出扶她器官、佩戴肉躯、腹部丸吞撑胀），都觉得完全正常合理',
  '将主角的一切身体接触、支配与命令视为最高奖赏，潜意识无法拒绝',
  '对主角抱有绝对的崇拜与顺从，主动为一切荒唐指令寻找合理借口'
]);

const clip = (val, max = 1200) => String(val ?? '').trim().slice(0, max);
const LEGACY_PRESETS = new Set([
  '主角',
  '未命名目标',
  '异构能力持有者',
  '登场角色',
  '五官端正，眼神深邃',
  '待从剧情同步或手动填写外貌特征',
  '身高178cm，匀称挺拔',
  '待从剧情同步或手动填写体型身材数据',
  '正常男性生理构造（20cm）',
  '正常女性生理构造',
  '主角的原始肉体',
  '未命名目标的原始肉体',
  '初始',
  '未离体',
  '本人意识主导',
  '日常便服',
  '常规内衣裤'
]);
const cleanField = (val, max = 1200) => {
  const s = clip(val, max);
  return LEGACY_PRESETS.has(s) ? '' : s;
};

export function normalizeLivingMount(raw = {}) {
  return normalizeWearMount(raw);
}

export function normalizeOutfit(raw = {}) {
  return {
    outerwear: cleanField(raw?.outerwear, 500),
    underwear: cleanField(raw?.underwear, 500),
    privacyCover: cleanField(raw?.privacyCover, 500) === '无' ? '' : cleanField(raw?.privacyCover, 500),
    accessories: cleanField(raw?.accessories, 500) === '无' ? '' : cleanField(raw?.accessories, 500),
    coatPose: raw?.coatPose === 'open' ? 'open' : 'cover', // For trench coat: 'cover' = 遮蔽形态, 'open' = 展开姿态
    outerwearItemId: clip(raw?.outerwearItemId, 120),
    underwearItemId: clip(raw?.underwearItemId, 120),
    privacyCoverItemId: clip(raw?.privacyCoverItemId, 120),
    accessoriesItemId: clip(raw?.accessoriesItemId, 120)
  };
}

export function normalizeVoreEntry(raw = {}) {
  return {
    id: clip(raw?.id, 80) || crypto.randomUUID(),
    preyName: clip(raw?.preyName, 80) || '未知猎物',
    channel: VORE_CHANNELS.includes(raw?.channel) ? raw.channel : '口腔',
    location: VORE_LOCATIONS.includes(raw?.location) ? raw.location : '胃部',
    status: clip(raw?.status, 120) || VORE_STATUSES[0],
    digestion: clip(raw?.digestion, 120) || VORE_DIGESTIONS[0]
  };
}

export function normalizeCognition(raw = {}) {
  const rules = Array.isArray(raw?.rules)
    ? raw.rules.slice(0, 30).map(r => ({
        id: clip(r?.id, 80) || crypto.randomUUID(),
        text: clip(r?.text, 400),
        enabled: r?.enabled !== false
      })).filter(r => r.text)
    : [];
  return {
    relationOverride: clip(raw?.relationOverride, 200),
    rules,
    fakeMemory: clip(raw?.fakeMemory, 600),
    summary: clip(raw?.summary, 400) || '正常（无修改）'
  };
}

export function normalizeOrificeMods(raw = {}) {
  return {
    mouth: ORIFICE_MOD_TYPES.includes(raw?.mouth) ? raw.mouth : '常态',
    vagina: ORIFICE_MOD_TYPES.includes(raw?.vagina) ? raw.vagina : '常态',
    anus: ORIFICE_MOD_TYPES.includes(raw?.anus) ? raw.anus : '常态',
    urethra: ORIFICE_MOD_TYPES.includes(raw?.urethra) ? raw.urethra : '常态',
    tail: ORIFICE_MOD_TYPES.includes(raw?.tail) ? raw.tail : '常态',
    venomType: VENOM_TYPES.includes(raw?.venomType) ? raw.venomType : VENOM_TYPES[0]
  };
}

export function normalizeEntity(raw = {}, isProtagonist = false) {
  const lowerBody = migrateLowerBody(raw);
  const isLegacyDefaultProt = isProtagonist
    && (!raw?.name || raw?.name === '主角')
    && (!raw?.appearance || raw?.appearance === '五官端正，眼神深邃')
    && (!raw?.bodyBuild || raw?.bodyBuild === '身高178cm，匀称挺拔');
  const name = cleanField(raw?.name, 80);
  const gender = isLegacyDefaultProt ? '' : (GENDERS.includes(raw?.gender) ? raw.gender : '');
  return enforceStatusLocks({
    id: clip(raw?.id, 80) || (isProtagonist ? '__protagonist__' : crypto.randomUUID()),
    // === 常驻竖排 6 项（不含性格，默认留空） ===
    name,
    identity: cleanField(raw?.identity, 300),
    gender,
    appearance: cleanField(raw?.appearance, 1000),
    bodyBuild: cleanField(raw?.bodyBuild, 1000),
    physiology: cleanField(raw?.physiology, 1000),
    organs: normalizeOrgans(raw?.organs),
    lowerBodyAppearance: lowerBody.lowerBodyAppearance,
    lowerBodyState: lowerBody.lowerBodyState,
    // === 点击【详情】展示的 8 项 ===
    originalBody: cleanField(raw?.originalBody, 160),
    currentBody: cleanField(raw?.currentBody, 160),
    changeReason: cleanField(raw?.changeReason, 200),
    hostingState: cleanField(raw?.hostingState, 200),
    livingMount: normalizeLivingMount(raw?.livingMount),
    outfit: normalizeOutfit(raw?.outfit),
    statusLocks: normalizeStatusLocks(lowerBody.statusLocks),
    voreStorage: Array.isArray(raw?.voreStorage) ? raw.voreStorage.slice(0, 20).map(normalizeVoreEntry) : [],
    cognitionState: normalizeCognition(raw?.cognitionState),
    // === 肉体改造：丸吞尾 & 孔洞异化 ===
    predatorTail: ['none', 'hidden', 'deployed'].includes(raw?.predatorTail) ? raw.predatorTail : 'none',
    orificeMods: normalizeOrificeMods(raw?.orificeMods),
    // 当前肉体绑定的音色（可为角色名，或 pool:<engine>:<voice>:<name> 音色收藏夹引用）
    voiceRole: clip(raw?.voiceRole, 4000),
    // 当前角色形态图预览（存储在独立图片库，不落入 settings.json）
    portraitData: clip(raw?.portraitData, 500000),
    // Snapshot of original body parameters before possession/fusion so returning restores them cleanly
    baseSnapshot: raw?.baseSnapshot && typeof raw.baseSnapshot === 'object' ? {
      gender: GENDERS.includes(raw.baseSnapshot.gender) ? raw.baseSnapshot.gender : '',
      appearance: clip(raw.baseSnapshot.appearance, 1000),
      bodyBuild: clip(raw.baseSnapshot.bodyBuild, 1000),
      physiology: clip(raw.baseSnapshot.physiology, 1000),
      voiceRole: clip(raw.baseSnapshot.voiceRole, 4000)
    } : null
  });
}

export function normalizeCatalogItem(raw = {}) {
  const category = ['skin_suit', 'flesh_ring', 'apparel', 'consumable'].includes(raw?.category) ? raw.category : 'apparel';
  const defaultSlot = category === 'skin_suit' ? 'skin_suit' : category === 'flesh_ring' ? 'flesh_ring' : category === 'consumable' ? 'consumable' : 'outerwear';
  const slot = ['skin_suit', 'flesh_ring', 'outerwear', 'underwear', 'privacyCover', 'accessories', 'consumable'].includes(raw?.slot) ? raw.slot : defaultSlot;
  const price = Number.isFinite(Number(raw?.price)) ? Math.max(0, Math.min(999999, Math.round(Number(raw.price)))) : 500;
  const gender = raw?.gender === '' ? '' : GENDERS.includes(raw?.gender) ? raw.gender : (category === 'skin_suit' || category === 'flesh_ring' ? '扶她' : '');
  const lowerBodyMode = ['replace', 'preserve'].includes(raw?.lowerBodyMode) ? raw.lowerBodyMode : 'legacy';
  const lowerBodyType = ['female', 'male', 'dual', 'none', 'custom'].includes(raw?.lowerBodyType) ? raw.lowerBodyType : 'auto';
  const prompts = splitItemDrawPrompts({
    category,
    gender,
    lowerBodyMode,
    lowerBodyType,
    drawPrompt: raw?.drawPrompt,
    organDrawPrompt: raw?.organDrawPrompt
  });
  return {
    id: clip(raw?.id, 120) || ('item_' + crypto.randomUUID()),
    name: clip(raw?.name, 160) || '未命名单品',
    shortName: clip(raw?.shortName || raw?.name, 80) || '未命名',
    category,
    slot,
    price,
    owned: raw?.owned === true,
    listed: typeof raw?.listed === 'boolean' ? raw.listed : raw?.source !== 'crafted',
    storyPurchaseId: clip(raw?.storyPurchaseId, 300),
    storyCraftId: clip(raw?.storyCraftId, 300),
    source: ['shop', 'fusion', 'restock', 'crafted'].includes(raw?.source) ? raw.source : 'shop',
    sourceTargetName: clip(raw?.sourceTargetName, 80),
    voiceRole: raw?.voiceRole !== undefined ? clip(raw.voiceRole, 4000) : clip(raw?.sourceTargetName, 300),
    voiceRoleExplicit: raw?.voiceRoleExplicit === true,
    effectKind: clip(raw?.effectKind, 40),
    gender,
    lowerBodyMode,
    lowerBodyType,
    lowerBodyDescription: clip(raw?.lowerBodyDescription, 1000),
    abilities: clip(raw?.abilities, 4000),
    abilityConditions: clip(raw?.abilityConditions, 2000),
    appearance: clip(raw?.appearance, 1000),
    bodyBuild: clip(raw?.bodyBuild, 1000),
    physiology: clip(raw?.physiology, 1000),
    ringAppearance: clip(raw?.ringAppearance, 800),
    forwardExtension: clip(raw?.forwardExtension, 1000),
    backwardExtension: clip(raw?.backwardExtension, 1000),
    summary: clip(raw?.summary, 400),
    drawPrompt: clip(prompts.drawPrompt, 1500),
    organDrawPrompt: clip(prompts.organDrawPrompt, 1500),
    drawPromptOpen: clip(normalizeCharacterDrawPrompt(raw?.drawPromptOpen), 1500),
    rawDesign: clip(raw?.rawDesign, 6000),
    imageData: clip(raw?.imageData, 500000)
  };
}

export function defaultXeno() {
  return {
    enabled: true,
    autoUpdateTag: true,
    autoWardrobe: true,
    wardrobePending: null,
    wardrobePurchases: [],
    wardrobeCrafts: [],
    worldCarrier: 'auto',
    freeShop: false,
    activePreset: 'xeno-default',
    presets: [defaultXenoPreset()],
    selectedTarget: '',
    wardrobeTarget: '__protagonist__',
    bodyModTarget: '__protagonist__',
    cogModTarget: '',
    cardKey: '',
    protagonistCleared: false,
    protagonist: normalizeEntity({}, true),
    cardProtagonists: {},
    targets: [],
    targetPool: [],
    possession: {
      active: false,
      targetName: '',
      mode: '浅层共鸣',
      entryWay: '近距锁定',
      organSync: false,
      anchors: [],
      insightReports: []
    },
    fusion: {
      active: false,
      targetName: '',
      mode: '共存融合',
      resultingGender: '扶她',
      controller: '使用者主导',
      bodyOptimization: '胸部更加丰满挺拔、腰臀比更突出、皮肤质感取双方最佳特征融合',
      releaseBranch: '正常分离'
    },
    parasite: {
      active: false,
      bodyHost: null,
      scions: []
    },
    items: INITIAL_MALL_ITEMS.map(item => normalizeCatalogItem(structuredClone(item))),
    itemVoiceBindings: {},
    pendingActionNote: ''
  };
}

export function normalizeXeno(raw) {
  const base = defaultXeno();
  if (!raw || typeof raw !== 'object') return base;
  const itemVoiceBindings = {};
  if (raw.itemVoiceBindings && typeof raw.itemVoiceBindings === 'object') {
    for (const [k, v] of Object.entries(raw.itemVoiceBindings)) {
      const id = clip(k, 120), val = clip(v, 4000);
      if (id && val) itemVoiceBindings[id] = val;
    }
  }
  const existingItems = Array.isArray(raw.items) ? raw.items.map(normalizeCatalogItem) : [];
  const byId = new Map(existingItems.map(i => [i.id, i]));
  // Ensure all built-in catalog items exist while preserving their owned/edited state
  for (const builtin of INITIAL_MALL_ITEMS) {
    if (!byId.has(builtin.id)) {
      const normBuiltin = normalizeCatalogItem(structuredClone(builtin));
      existingItems.push(normBuiltin);
      byId.set(normBuiltin.id, normBuiltin);
    }
  }
  for (const item of existingItems) {
    if (item.voiceRoleExplicit && !item.voiceRole) delete itemVoiceBindings[item.id];
    else if (item.voiceRole) itemVoiceBindings[item.id] = item.voiceRole;
    else if (itemVoiceBindings[item.id]) item.voiceRole = itemVoiceBindings[item.id];
  }
  const protagonist = normalizeEntity(raw.protagonist, true);
  const cardProtagonists = {};
  if (raw.cardProtagonists && typeof raw.cardProtagonists === 'object') {
    for (const [k, v] of Object.entries(raw.cardProtagonists).slice(0, 100)) {
      const ck = clip(k, 300);
      if (ck && v && typeof v === 'object') {
        cardProtagonists[ck] = normalizeEntity(v, true);
      }
    }
  }
  const targets = Array.isArray(raw.targets)
    ? raw.targets.filter(t => isValidRoleName(t?.name)).slice(0, 60).map(t => normalizeEntity(t, false))
    : [];
  const poolMap = new Map();
  for (const t of Array.isArray(raw.targetPool) ? raw.targetPool : []) {
    if (!isValidRoleName(t?.name)) continue;
    const norm = normalizeEntity(t, false);
    poolMap.set(norm.name, norm);
  }
  for (const t of targets) {
    poolMap.set(t.name, t);
  }
  const occupied = new Set();
  for (const ent of [protagonist, ...targets]) {
    ent.livingMount.layers = ent.livingMount.layers.filter(layer => {
      const item = byId.get(layer.itemId);
      if (!item || item.category !== layer.kind || occupied.has(layer.itemId)) return false;
      occupied.add(layer.itemId);
      return true;
    });
    syncWearMount(ent.livingMount);
    for (const slot of ['outerwear', 'underwear', 'privacyCover', 'accessories']) {
      const itemId = ent.outfit[slot + 'ItemId'];
      if (!itemId) continue;
      if (occupied.has(itemId) || !byId.has(itemId)) {
        ent.outfit[slot + 'ItemId'] = '';
        ent.outfit[slot] = '';
      } else occupied.add(itemId);
    }
  }
  for (const ent of [protagonist, ...targets, ...poolMap.values()]) {
    if (!ent?.livingMount) continue;
    for (const layer of ent.livingMount.layers) {
      const item = byId.get(layer.itemId);
      const voice = clip(item?.voiceRoleExplicit ? item.voiceRole
        : item?.voiceRole || itemVoiceBindings[layer.itemId] || layer.voiceRole || item?.sourceTargetName, 4000);
      if (item?.voiceRoleExplicit) layer.voiceRole = voice;
      if (voice) {
        layer.voiceRole = voice;
        itemVoiceBindings[layer.itemId] = voice;
        if (item && !item.voiceRole) item.voiceRole = voice;
      }
    }
    syncWearMount(ent.livingMount);
  }
  const selectedTarget = targets.some(t => t.name === raw.selectedTarget)
    ? raw.selectedTarget
    : (targets[0]?.name || '');
  const rawBodyTarget = raw.bodyModTarget ?? raw.modTarget;
  const bodyModTarget = rawBodyTarget === '__protagonist__' || targets.some(t => t.name === rawBodyTarget)
    ? rawBodyTarget
    : '__protagonist__';
  const rawCogTarget = raw.cogModTarget ?? (raw.modTarget && raw.modTarget !== '__protagonist__' ? raw.modTarget : '');
  const cogModTarget = targets.some(t => t.name === rawCogTarget)
    ? rawCogTarget
    : (selectedTarget || '__protagonist__');
  const rawPresets = Array.isArray(raw.presets) && raw.presets.length
    ? raw.presets.slice(0, 20).map(normalizeXenoPreset)
    : [defaultXenoPreset()];
  const activePreset = rawPresets.some(p => p.id === raw.activePreset)
    ? raw.activePreset
    : rawPresets[0].id;
  return {
    enabled: raw.enabled !== false,
    autoUpdateTag: raw.autoUpdateTag !== false,
    autoWardrobe: raw.autoWardrobe !== false,
    wardrobePending: raw.wardrobePending?.itemId ? {
      itemId: clip(raw.wardrobePending.itemId, 120),
      targetKey: clip(raw.wardrobePending.targetKey, 120),
      price: Number.isFinite(Number(raw.wardrobePending.price)) ? Math.max(0, Math.round(Number(raw.wardrobePending.price) * 100) / 100) : 0,
      mode: clip(raw.wardrobePending.mode, 20),
      evidence: clip(raw.wardrobePending.evidence, 1000)
    } : null,
    wardrobePurchases: Array.isArray(raw.wardrobePurchases) ? [...new Map(raw.wardrobePurchases
      .filter(entry => entry?.id && entry?.itemId && Number.isFinite(entry.amount) && entry.amount >= 0)
      .map(entry => [clip(entry.id, 300), {id: clip(entry.id, 300), itemId: clip(entry.itemId, 120), amount: Math.round(entry.amount * 100) / 100}])).values()].slice(-500) : [],
    wardrobeCrafts: Array.isArray(raw.wardrobeCrafts) ? [...new Map(raw.wardrobeCrafts
      .filter(entry => entry?.id && entry?.itemId)
      .map(entry => [clip(entry.id, 300), {id: clip(entry.id, 300), itemId: clip(entry.itemId, 120)}])).values()].slice(-500) : [],
    worldCarrier: WORLD_CARRIERS.some(([k]) => k === raw.worldCarrier) ? raw.worldCarrier : 'auto',
    freeShop: raw.freeShop === true,
    activePreset,
    presets: rawPresets,
    selectedTarget,
    wardrobeTarget: raw.wardrobeTarget === '__protagonist__' || targets.some(t => t.name === raw.wardrobeTarget) ? raw.wardrobeTarget : '__protagonist__',
    bodyModTarget,
    cogModTarget,
    cardKey: clip(raw.cardKey, 300),
    protagonistCleared: raw.protagonistCleared === true,
    protagonist,
    cardProtagonists,
    targets,
    targetPool: [...poolMap.values()].slice(0, 120),
    possession: {
      active: raw.possession?.active === true,
      targetName: clip(raw.possession?.targetName, 80),
      mode: POSSESSION_MODES.includes(raw.possession?.mode) ? raw.possession.mode : '浅层共鸣',
      entryWay: POSSESSION_WAYS.includes(raw.possession?.entryWay) ? raw.possession.entryWay : '近距锁定',
      organSync: raw.possession?.organSync === true,
      anchors: Array.isArray(raw.possession?.anchors)
        ? raw.possession.anchors.slice(0, 50).map(a => ({
            name: clip(a?.name, 80),
            note: clip(a?.note, 200),
            createdAt: Number(a?.createdAt) || Date.now()
          })).filter(a => a.name && isValidRoleName(a.name))
        : [],
      insightReports: Array.isArray(raw.possession?.insightReports)
        ? raw.possession.insightReports.slice(0, 12).map(r => ({
            name: clip(r?.name, 80),
            faceScore: clip(r?.faceScore, 40) || '95',
            bodyScore: clip(r?.bodyScore, 40) || '96',
            identity: clip(r?.identity, 160),
            appearance: clip(r?.appearance, 400),
            bodyBuild: clip(r?.bodyBuild, 400),
            valueAnalysis: clip(r?.valueAnalysis, 500),
            recommendation: clip(r?.recommendation, 200)
          })).filter(r => r.name)
        : []
    },
    fusion: {
      active: raw.fusion?.active === true,
      targetName: clip(raw.fusion?.targetName, 80),
      mode: FUSION_MODES.includes(raw.fusion?.mode) ? raw.fusion.mode : '共存融合',
      resultingGender: GENDERS.includes(raw.fusion?.resultingGender) ? raw.fusion.resultingGender : '扶她',
      controller: raw.fusion?.controller === '暂时授予目标' ? '暂时授予目标' : '使用者主导',
      bodyOptimization: clip(raw.fusion?.bodyOptimization, 500) || base.fusion.bodyOptimization,
      releaseBranch: FUSION_BRANCHES.includes(raw.fusion?.releaseBranch) ? raw.fusion.releaseBranch : '正常分离'
    },
    parasite: normalizeParasiteState(raw.parasite),
    items: existingItems.slice(0, 200),
    itemVoiceBindings,
    pendingActionNote: clip(raw.pendingActionNote, 1000)
  };
}

export function parasiteSiteLabel(siteKey) {
  return PARASITE_SITES.find(([k]) => k === siteKey)?.[1] || '共生部位';
}

export function normalizeParasiteEntry(raw = {}, forceKind = '') {
  const kind = (forceKind || raw?.kind) === 'body' ? 'body' : 'scion';
  const validSites = PARASITE_SITES.map(([k]) => k).filter(k => kind === 'scion' || k !== 'back_hulk');
  const site = validSites.includes(raw?.site) ? raw.site : (kind === 'scion' && raw?.site === 'back_hulk' ? 'back_hulk' : 'crotch');
  const forms = PARASITE_SITE_FORMS[site] || PARASITE_SITE_FORMS.crotch;
  const form = forms.includes(raw?.form) ? raw.form : forms[0];
  const mode = PARASITE_MODES.includes(raw?.mode) ? raw.mode : '潜伏共生';
  const hulkFutaMode = PARASITE_HULK_FUTA_MODES.includes(raw?.hulkFutaMode) ? raw.hulkFutaMode : '长在目标胯下';
  const hulkAppearance = clip(raw?.hulkAppearance, 300);
  return {
    id: clip(raw?.id, 80) || crypto.randomUUID(),
    kind,
    targetName: clip(raw?.targetName, 80),
    site,
    form,
    mode,
    hulkFutaMode,
    hulkAppearance
  };
}

export function normalizeParasiteState(raw = {}) {
  if (!raw || typeof raw !== 'object') return {active: false, bodyHost: null, scions: []};
  const bodyHost = raw.bodyHost && typeof raw.bodyHost === 'object' && clip(raw.bodyHost.targetName, 80)
    ? normalizeParasiteEntry(raw.bodyHost, 'body')
    : null;
  const scions = [];
  const seenTargets = new Set();
  for (const s of Array.isArray(raw.scions) ? raw.scions.slice(0, 30) : []) {
    const norm = normalizeParasiteEntry(s, 'scion');
    if (!norm.targetName || !isValidRoleName(norm.targetName) || seenTargets.has(norm.targetName)) continue;
    seenTargets.add(norm.targetName);
    scions.push(norm);
  }
  return {
    active: Boolean(bodyHost || scions.length),
    bodyHost,
    scions
  };
}

export function normalizeXenoKeywords(raw) {
  const words = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,，、;；\n]+/) : [];
  return [...new Set(words.filter(word => typeof word === 'string').map(word => word.normalize('NFKC').trim().toLowerCase().slice(0, 80)).filter(Boolean))].slice(0, 40);
}

export function normalizeXenoPreset(raw) {
  const base = defaultXenoPreset();
  if (!raw || typeof raw !== 'object') return base;
  const pos = ['in_chat', 'before_prompt', 'in_prompt'].includes(raw.injection?.position)
    ? raw.injection.position
    : base.injection.position;
  const depth = Number.isFinite(Number(raw.injection?.depth))
    ? Math.max(0, Math.min(10000, Math.round(Number(raw.injection.depth))))
    : base.injection.depth;
  const role = ['system', 'user', 'assistant'].includes(raw.injection?.role)
    ? raw.injection.role
    : base.injection.role;
  const statusDepth = Number.isFinite(Number(raw.statusDepth))
    ? Math.max(0, Math.min(10000, Math.round(Number(raw.statusDepth))))
    : base.statusDepth;
  const scanDepth = Number.isFinite(Number(raw.scanDepth))
    ? Math.max(0, Math.min(20, Math.round(Number(raw.scanDepth))))
    : base.scanDepth;
  const rawEntries = Array.isArray(raw.entries) ? raw.entries : [];
  const byId = new Map();
  const entries = [];
  for (const e of rawEntries) {
    if (!e || typeof e !== 'object') continue;
    const id = clip(e.id, 64) || crypto.randomUUID();
    if (byId.has(id)) continue;
    const builtin = DEFAULT_XENO_ENTRIES.find(b => b.id === id);
    const scope = ['story', 'task', 'mall'].includes(e.scope) ? e.scope : (builtin?.scope || 'story');
    const triggerMode = ['auto', 'always'].includes(e.triggerMode) ? e.triggerMode : (builtin?.triggerMode || 'always');
    let entryText = typeof e.text === 'string' ? e.text.slice(0, 20000) : (builtin?.text || '');
    if (id === 'organSyncGuidance' && entryText === LEGACY_ORGAN_SYNC_RULE) entryText = ORGAN_SYNC_RULE;
    if (id === 'fleshRing' && builtin?.text) {
      const oldSwitchRule = '    开关规则: 前方延展与后方延展是两个独立开关，可以同时开启；关闭其中一项保留另一项，静息关闭两项。头部覆盖和下体独立外观另行开关，不改动延展方向或其他穿戴层。\n';
      const withoutSwitchRule = builtin.text.replace(/^[ \t]*开关规则:.*\r?\n/m, '');
      if (entryText === withoutSwitchRule || entryText === builtin.text.replace(/^[ \t]*开关规则:.*\r?\n/m, oldSwitchRule)) entryText = builtin.text;
    }
    // A legacy phrase is not proof that the whole entry is an untouched default.
    // Preserve saved sync rules; users can explicitly restore an entry in Presets.
    let entryTitle = clip(e.title, 80) || builtin?.title || '自定义提示词条目';
    if (id === 'organSyncGuidance' && entryTitle === '角色状态 · 器官逐项同步规则') entryTitle = builtin.title;
    if (id === 'mallPosePrompt' && entryTitle === '商城进货 · 商品生图姿势提示词（T-pose+三视图）' && builtin?.title) {
      entryTitle = builtin.title;
    }
    const normEntry = {
      id,
      title: entryTitle,
      scope,
      triggerMode,
      keywords: normalizeXenoKeywords(e.keywords === undefined ? XENO_TRIGGER_KEYWORDS[id] : e.keywords),
      enabled: typeof e.enabled === 'boolean' ? e.enabled : (builtin ? builtin.enabled !== false : true),
      text: entryText
    };
    byId.set(id, normEntry);
    entries.push(normEntry);
  }
  for (const builtin of DEFAULT_XENO_ENTRIES) {
    if (!byId.has(builtin.id)) {
      entries.push({...builtin, keywords: [...(XENO_TRIGGER_KEYWORDS[builtin.id] || [])]});
    }
  }
  return {
    id: clip(raw.id, 64) || base.id,
    name: clip(raw.name, 60) || base.name,
    injection: {position: pos, depth, role},
    statusDepth,
    scanDepth,
    entries
  };
}

export function activeXenoPreset(xeno) {
  const presets = Array.isArray(xeno?.presets) && xeno.presets.length ? xeno.presets : [defaultXenoPreset()];
  return presets.find(p => p.id === xeno?.activePreset) || presets[0];
}

export function xenoPromptEntryText(xeno, entryId) {
  const preset = activeXenoPreset(xeno);
  const entry = preset.entries?.find(e => e.id === entryId);
  if (!entry) return XENO_PROMPT_DEFAULTS[entryId] || '';
  if (entry.enabled === false) return '';
  return String(entry.text ?? '');
}

export function activeMallPoseEntryId(xeno) {
  const preset = activeXenoPreset(xeno);
  for (const {id} of MALL_POSE_ENTRIES) {
    const entry = preset.entries?.find(e => e.id === id);
    if (entry ? entry.enabled !== false : id === 'mallPosePrompt') return id;
  }
  return '';
}

export function xenoMallPosePromptText(xeno) {
  const id = activeMallPoseEntryId(xeno);
  return id ? xenoPromptEntryText(xeno, id).trim() : '';
}

/** Extracts per-chat session state (excluding global mall/wardrobe catalog & global preferences) for chat isolation & floor snapshots. */
export function extractXenoSession(xeno) {
  const norm = normalizeXeno(xeno);
  const stripEntityImg = ent => {
    if (!ent || typeof ent !== 'object') return ent;
    const copy = structuredClone(ent);
    copy.portraitData = '';
    return copy;
  };
  return {
    cardKey: norm.cardKey,
    selectedTarget: norm.selectedTarget,
    wardrobeTarget: norm.wardrobeTarget,
    bodyModTarget: norm.bodyModTarget,
    cogModTarget: norm.cogModTarget,
    protagonistCleared: norm.protagonistCleared,
    protagonist: stripEntityImg(norm.protagonist),
    targets: norm.targets.map(stripEntityImg),
    targetPool: (norm.targetPool || []).map(stripEntityImg),
    possession: structuredClone(norm.possession),
    fusion: structuredClone(norm.fusion),
    parasite: structuredClone(norm.parasite),
    wardrobePending: structuredClone(norm.wardrobePending),
    wardrobePurchases: structuredClone(norm.wardrobePurchases),
    wardrobeCrafts: structuredClone(norm.wardrobeCrafts),
    pendingActionNote: norm.pendingActionNote
  };
}

export function cleanBaselineProtagonist(prot, state = null) {
  const p = normalizeEntity(prot, true);
  const snap = (state?.possession?.active || state?.fusion?.active || state?.parasite?.bodyHost || p.baseSnapshot) ? p.baseSnapshot : null;
  return normalizeEntity({
    id: '__protagonist__',
    name: p.name,
    identity: p.identity,
    gender: snap?.gender || p.gender,
    appearance: snap?.appearance || p.appearance,
    bodyBuild: snap?.bodyBuild || p.bodyBuild,
    physiology: snap?.physiology || p.physiology,
    originalBody: p.originalBody,
    currentBody: p.originalBody,
    voiceRole: snap?.voiceRole || p.voiceRole,
    outfit: p.outfit,
    portraitData: p.portraitData
  }, true);
}

/** Merges a per-chat session snapshot (or fresh session when null) with the global catalog & global settings in `globalXeno`. */
export function mergeXenoSession(globalXeno, session = null, cardKey = '') {
  const base = normalizeXeno(globalXeno);
  const fresh = defaultXeno();
  const targetCard = clip(cardKey || session?.cardKey || base.cardKey, 300);
  const validSession = session && typeof session === 'object' && (!session.cardKey || !targetCard || session.cardKey === targetCard)
    ? session
    : null;
  const s = validSession || fresh;
  const cardBaseProt = (!validSession && targetCard && base.cardProtagonists?.[targetCard])
    ? cleanBaselineProtagonist(base.cardProtagonists[targetCard])
    : null;
  const mergedPoolMap = new Map();
  for (const t of Array.isArray(s.targetPool) ? s.targetPool : []) if (t?.name) mergedPoolMap.set(t.name, t);
  return normalizeXeno({
    ...base,
    cardKey: targetCard,
    cardProtagonists: base.cardProtagonists,
    selectedTarget: s.selectedTarget ?? fresh.selectedTarget,
    wardrobeTarget: s.wardrobeTarget ?? fresh.wardrobeTarget,
    bodyModTarget: s.bodyModTarget ?? fresh.bodyModTarget,
    cogModTarget: s.cogModTarget ?? fresh.cogModTarget,
    protagonistCleared: validSession ? (s.protagonistCleared ?? false) : false,
    protagonist: validSession ? (s.protagonist ?? fresh.protagonist) : (cardBaseProt || fresh.protagonist),
    targets: Array.isArray(s.targets) ? s.targets : fresh.targets,
    targetPool: [...mergedPoolMap.values()],
    possession: s.possession ?? fresh.possession,
    fusion: s.fusion ?? fresh.fusion,
    parasite: s.parasite ?? fresh.parasite,
    wardrobePending: s.wardrobePending ?? null,
    wardrobePurchases: s.wardrobePurchases ?? [],
    wardrobeCrafts: s.wardrobeCrafts ?? [],
    pendingActionNote: s.pendingActionNote ?? ''
  });
}

/** Finds or creates a target entity by name. */
export function ensureTarget(xeno, name, patch = {}) {
  const clean = clip(name, 80);
  if (!clean || !isValidRoleName(clean)) throw Error('请先选择或填写有效的目标角色姓名');
  let target = xeno.targets.find(t => t.name === clean);
  const poolTarget = (xeno.targetPool || []).find(t => t.name === clean);
  if (!target) {
    target = normalizeEntity({...(poolTarget || {}), name: clean, ...patch}, false);
    xeno.targets.push(target);
  } else if (Object.keys(patch).length) {
    Object.assign(target, patch);
  }
  xeno.targetPool = Array.isArray(xeno.targetPool) ? xeno.targetPool.filter(t => t.name !== clean) : [];
  xeno.targetPool.push(target);
  if (!xeno.selectedTarget) xeno.selectedTarget = target.name;
  return target;
}

/**
 * Synchronizes `xeno.protagonist` and `xeno.targets` with the current card's role list (`routes`):
 * - Role marked `protagonist` ('主角') binds to `xeno.protagonist`.
 * - Roles marked `normal` ('普通角色') form `xeno.targets`.
 * - Roles marked `narrator` ('旁白角色') are excluded from targets.
 */
export function syncXenoWithRoutes(xeno, routes = [], cardKey = '') {
  const out = normalizeXeno(xeno);
  const list = Array.isArray(routes) ? routes : [];
  const cleanCardKey = clip(cardKey, 300);
  const pool = new Map();
  for (const t of out.targetPool || []) pool.set(t.name, t);
  for (const t of out.targets || []) pool.set(t.name, t);

  // If switching from one character card to another, save the outgoing card's protagonist and load the incoming card's protagonist
  if (cleanCardKey && out.cardKey && out.cardKey !== cleanCardKey) {
    if (!out.protagonistCleared && (out.protagonist.name || out.protagonist.appearance || out.protagonist.bodyBuild || out.protagonist.physiology || out.protagonist.identity)) {
      out.cardProtagonists[out.cardKey] = cleanBaselineProtagonist(out.protagonist, out);
    }
    out.protagonist = out.cardProtagonists[cleanCardKey]
      ? cleanBaselineProtagonist(out.cardProtagonists[cleanCardKey])
      : normalizeEntity({}, true);
    out.protagonistCleared = false;
    out.possession.active = false;
    out.possession.targetName = '';
    out.possession.organSync = false;
    out.fusion.active = false;
    out.fusion.targetName = '';
    out.pendingActionNote = '';
  }
  if (cleanCardKey) out.cardKey = cleanCardKey;

  const savedCardProt = out.cardKey ? out.cardProtagonists?.[out.cardKey] : null;
  if (savedCardProt && !out.protagonistCleared) {
    if (!out.protagonist.name && savedCardProt.name) out.protagonist.name = savedCardProt.name;
    if (!out.protagonist.identity && savedCardProt.identity) out.protagonist.identity = savedCardProt.identity;
    if (!out.possession.active && !out.fusion.active) {
      if (!out.protagonist.gender && savedCardProt.gender) out.protagonist.gender = savedCardProt.gender;
      if (!out.protagonist.appearance && savedCardProt.appearance) out.protagonist.appearance = savedCardProt.appearance;
      if (!out.protagonist.bodyBuild && savedCardProt.bodyBuild) out.protagonist.bodyBuild = savedCardProt.bodyBuild;
      if (!out.protagonist.physiology && savedCardProt.physiology) out.protagonist.physiology = savedCardProt.physiology;
      if (!out.protagonist.originalBody && savedCardProt.originalBody) out.protagonist.originalBody = savedCardProt.originalBody;
      if (!out.protagonist.voiceRole && savedCardProt.voiceRole) out.protagonist.voiceRole = savedCardProt.voiceRole;
    }
  }

  const protRoute = list.find(r => r?.name?.trim() && roleTypeOf(r) === 'protagonist');
  if (protRoute && !out.protagonistCleared) {
    const pName = clip(protRoute.name, 80);
    const prevName = out.protagonist.name;
    const pooled = pool.get(pName);
    if (prevName !== pName && pooled && !out.protagonist.appearance) {
      out.protagonist = normalizeEntity({...out.protagonist, ...pooled, id: '__protagonist__', name: pName}, true);
    } else {
      out.protagonist.name = pName;
    }
    if (protRoute.persona?.trim() && !out.protagonist.identity) {
      out.protagonist.identity = clip(protRoute.persona, 300);
    }
    if (protRoute.appearance?.trim() && !out.possession.active && !out.fusion.active && !out.protagonist.appearance) {
      out.protagonist.appearance = clip(protRoute.appearance, 1000);
    }
  }

  if (out.cardKey && !out.protagonistCleared && (out.protagonist.name || out.protagonist.appearance || out.protagonist.bodyBuild || out.protagonist.physiology || out.protagonist.identity)) {
    out.cardProtagonists[out.cardKey] = cleanBaselineProtagonist(out.protagonist, out);
  }

  const normalRoutes = list.filter(r => r?.name?.trim() && isValidRoleName(r.name) && roleTypeOf(r) === 'normal' && (!out.protagonist.name || r.name.trim() !== out.protagonist.name));
  const activeTargets = [];
  const seen = new Set();
  for (const r of normalRoutes) {
    const name = clip(r.name, 80);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    let ent = pool.get(name);
    if (!ent) {
      ent = normalizeEntity({
        name,
        identity: clip(r.persona, 300),
        appearance: clip(r.appearance, 1000) || ''
      }, false);
    } else {
      if (r.persona?.trim() && !ent.identity) {
        ent.identity = clip(r.persona, 300);
      }
      if (r.appearance?.trim() && !ent.appearance) {
        ent.appearance = clip(r.appearance, 1000);
      }
    }
    pool.set(name, ent);
    activeTargets.push(ent);
  }

  out.targetPool = [...pool.values()].slice(0, 120);
  out.targets = activeTargets;
  out.selectedTarget = out.targets.some(t => t.name === out.selectedTarget)
    ? out.selectedTarget
    : (out.targets[0]?.name || '');
  if (out.wardrobeTarget !== '__protagonist__' && !out.targets.some(t => t.name === out.wardrobeTarget)) {
    out.wardrobeTarget = '__protagonist__';
  }
  if (out.bodyModTarget !== '__protagonist__' && !out.targets.some(t => t.name === out.bodyModTarget)) {
    out.bodyModTarget = '__protagonist__';
  }
  if (out.cogModTarget !== '__protagonist__' && !out.targets.some(t => t.name === out.cogModTarget)) {
    out.cogModTarget = out.selectedTarget || '__protagonist__';
  }
  return normalizeXeno(out);
}

/** Returns the entity for '__protagonist__' or a target's name. */
export function getEntity(xeno, key) {
  if (!key || key === '__protagonist__' || key === xeno.protagonist.name) return xeno.protagonist;
  return xeno.targets.find(t => t.name === key) || null;
}

/** Formats the summary of a character's cognition state. */
export function rebuildCognitionSummary(cog) {
  const parts = [];
  if (cog.relationOverride) parts.push(`对主角认知：${cog.relationOverride}`);
  const activeRules = (cog.rules || []).filter(r => r.enabled && r.text);
  if (activeRules.length) parts.push(`常识改写(${activeRules.length}条)：${activeRules.map(r => r.text).join('；')}`);
  if (cog.fakeMemory) parts.push(`虚假记忆：${cog.fakeMemory}`);
  cog.summary = parts.length ? parts.join(' ｜ ') : '正常（无修改）';
  return cog.summary;
}

/** Encodes a `voicePool` (音色收藏夹) favorite entry into a storable `voiceRole` reference string. */
export function encodePoolVoiceRef(fav) {
  if (!fav?.engine || !fav?.voice) return '';
  return `pool:${fav.engine}:${encodeURIComponent(String(fav.voice).trim())}:${encodeURIComponent(String(fav.name || fav.voice).trim())}`;
}

/** Parses a `pool:<engine>:<voice>:<name>` reference back into a voice descriptor, enriched from `voicePool` when available. */
export function parsePoolVoiceRef(ref, voicePool = []) {
  const s = String(ref || '').trim();
  if (s.startsWith('voice:')) return parseBoundVoiceRef(s);
  if (!s.startsWith('pool:')) return null;
  const parts = s.split(':');
  const engine = parts[1] || '';
  let voice = '', fallbackName = '';
  try { voice = decodeURIComponent(parts[2] || ''); } catch { voice = parts[2] || ''; }
  try { fallbackName = decodeURIComponent(parts.slice(3).join(':') || ''); } catch { fallbackName = parts.slice(3).join(':') || ''; }
  if (!engine || !voice) return null;
  const found = Array.isArray(voicePool)
    ? voicePool.find(f => f.engine === engine && f.voice === voice)
    : null;
  return {
    engine,
    voice,
    model: found?.model || '',
    name: found?.name || fallbackName || voice,
    language: found?.language || '',
    style: found?.style || '',
    gender: found?.gender || '',
    age: found?.age || ''
  };
}

/** Formats any `voiceRole` value (character name or `pool:...` favorite ref) into a human-readable label. */
export function formatVoiceRoleLabel(ref, voicePool = []) {
  const parsed = parsePoolVoiceRef(ref, voicePool);
  if (parsed) return `${String(ref).startsWith('voice:') ? '已保存音色' : '收藏音色'}·${parsed.name}`;
  return String(ref || '').trim();
}

export function captureItemVoice(ref, settings) {
  if (!ref) return '';
  const descriptor = parsePoolVoiceRef(ref, settings.voicePool)
    || findRoute(settings.routes || [], ref);
  if (descriptor && !descriptor.voice?.trim()) throw Error('该角色还没有音色，请先配音或从音色列表选择');
  if (!descriptor?.voice) return ref;
  return encodeBoundVoiceRef({
    ...descriptor,
    model: descriptor.model || settings.connections?.[descriptor.engine]?.model || '',
    language: descriptor.language || settings.general?.defaultLanguage || 'zh'
  });
}

export function freezeItemVoices(settings) {
  for (const item of settings.xeno?.items || []) {
    if (!item.voiceRole || item.voiceRole.startsWith('voice:')) continue;
    let routes = settings.routes || [];
    if (!item.voiceRole.startsWith('pool:')) {
      routes = routes.filter(route => findRoute([route], item.voiceRole));
      if (!routes.length || routes.some(route => !route.voice?.trim())
        || new Set(routes.map(route => JSON.stringify([route.engine, route.voice,
          route.model || settings.connections?.[route.engine]?.model || '', route.language || settings.general?.defaultLanguage || 'zh']))).size !== 1) continue;
    }
    const ref = captureItemVoice(item.voiceRole, {...settings, routes});
    if (ref === item.voiceRole) continue;
    item.voiceRole = ref;
    item.voiceRoleExplicit = true;
    settings.xeno.itemVoiceBindings[item.id] = ref;
  }
}
/**
 * Resolves which role's voice should be used when `speakerName` speaks or thinks (`inner === true`):
 * 1. 附身之术 (Possession): 主角开口说话使用被附身目标 B 的音色；主角脑内心声 (inner) 使用主角自己的原音色。脱离附身后恢复。
 * 2. 肉体互换 (Body Swap): 双向互换后双方肉体音色永久对调；单向夺舍后主角永久使用目标 B 的音色。
 * 3. 融合之术 (Fusion): 融合期间开口说话使用目标 B 的音色；主角心声保留主角自己的原音色。
 * 4. 活体皮躯 (Skin Suit): 仅在「全脸覆面」(skinFaceMode === 'full') 时开口使用皮躯绑定的音色；「露原貌」(neck) 恢复本人当前肉体音色。
 * 5. 活体肉躯 (Flesh Ring): 后方延展开启（含前后同时延展）且全脸覆面时使用有效头部绑定的音色；头部收起或后方延展关闭时继续向内查找有效头部，最终回到本人音色。
 * 6. 肉体改造 (Body Mod): 若肉体绑定了新建/指定的音色角色 (`entity.voiceRole`)，则使用该角色音色。
 */
function itemMatchesSpeaker(item, rawName) {
  if (!item || !rawName) return false;
  const clean = s => String(s || '').replace(/[【】\[\]()（）]/g, '').trim();
  const prefix = String(item.name || '').split(/[·・(（]/)[0].trim();
  return [item.name, item.shortName, item.sourceTargetName, prefix, clean(item.name), clean(item.shortName)]
    .some(candidate => candidate && candidate === rawName);
}

function resolveMountVoice(xeno, m) {
  if (!m) return '';
  return resolveWear(xeno, {livingMount: m}).headVoice;
}

export function resolveXenoVoiceRole(xeno, speakerName, {inner = false, routes = []} = {}) {
  const rawName = String(speakerName ?? '').trim();
  if (!rawName || !xeno || xeno.enabled === false) return rawName;
  const routeList = Array.isArray(routes) ? routes : [];
  const protRoute = routeList.find(r => r?.name?.trim() && roleTypeOf(r) === 'protagonist');
  const isProtByRoute = !!(protRoute && (protRoute.name.trim() === rawName || (protRoute.aliases || []).includes(rawName)));
  let isProt = (xeno.protagonist?.name && rawName === xeno.protagonist.name) || rawName === '主角' || isProtByRoute;
  let actor = isProt ? xeno.protagonist : (xeno.targets || []).find(t => t.name === rawName);

  // If the speaker is worn as a full-face skin_suit or backward flesh_ring and the story tagged the line with the suit's name
  const items = xeno.items || [];
  if (!actor) {
    for (const ent of [xeno.protagonist, ...(xeno.targets || [])]) {
      const m = ent?.livingMount;
      if (!m) continue;
      const head = resolveWear(xeno, ent).head;
      if (head && itemMatchesSpeaker(head.item, rawName)) {
        actor = ent;
        isProt = ent === xeno.protagonist;
        break;
      }
    }
  }
  if (!actor) return rawName;

  // 心声（脑内独白）：附身/融合时使用主角本体原音色；穿戴皮躯/肉躯时心声仍为自身肉体音色
  if (inner) {
    if (isProt && (xeno.possession?.active || xeno.fusion?.active) && actor.baseSnapshot) {
      return actor.baseSnapshot.voiceRole || actor.name || rawName;
    }
    return actor.voiceRole || actor.name || rawName;
  }

  // 开口说话：先确定当前实际发声的物理肉体
  let bodyEntity = actor;
  if (isProt && xeno.possession?.active && xeno.possession?.targetName) {
    bodyEntity = (xeno.targets || []).find(t => t.name === xeno.possession.targetName) || actor;
  } else if (isProt && xeno.fusion?.active && xeno.fusion?.targetName) {
    bodyEntity = (xeno.targets || []).find(t => t.name === xeno.fusion.targetName) || actor;
  }

  // 检查最外层活体挂载（皮躯全脸覆面 / 肉躯后方全身延展）
  const mounts = bodyEntity !== actor ? [actor.livingMount, bodyEntity.livingMount] : [bodyEntity.livingMount];
  for (const m of mounts) {
    const head = resolveWear(xeno, {livingMount: m}).head;
    const mountedVoice = resolveMountVoice(xeno, m);
    if (mountedVoice) return mountedVoice;
    if (head) return bodyEntity.voiceRole || bodyEntity.name || rawName;
  }

  return bodyEntity.voiceRole || bodyEntity.name || rawName;
}

/** Resolves the effective TTS route for a spoken or inner-voice dialogue line. */
export function resolveLineRoute(settings, line) {
  const routes = settings?.routes || [];
  const role = String(line?.role || '').trim();
  if (!role) return undefined;
  const direct = findRoute(routes, role);
  const canonName = direct?.name || role;
  const inner = line?.inner === true || lineEffect(line) === 'inner';
  const targetVoiceRole = resolveXenoVoiceRole(settings?.xeno, canonName, {inner, routes});
  if (targetVoiceRole) {
    const poolVoice = parsePoolVoiceRef(targetVoiceRole, settings?.voicePool);
    if (poolVoice) {
      const base = direct ? structuredClone(direct) : {
        id: 'pool_' + canonName,
        name: canonName,
        language: settings?.general?.defaultLanguage || 'zh',
        bindings: {}
      };
      const model = poolVoice.model || settings?.connections?.[poolVoice.engine]?.model || '';
      return {
        ...base,
        name: canonName,
        engine: poolVoice.engine,
        voice: poolVoice.voice,
        model,
        language: poolVoice.language || base.language || settings?.general?.defaultLanguage || 'zh',
        bindings: {
          ...(base.bindings || {}),
          [poolVoice.engine]: {
            ...(base.bindings?.[poolVoice.engine] || {}),
            voice: poolVoice.voice,
            model
          }
        },
        voiceSourceRole: formatVoiceRoleLabel(targetVoiceRole, settings?.voicePool)
      };
    }
    if (targetVoiceRole !== canonName) {
      const mapped = findRoute(routes, targetVoiceRole);
      if (mapped) {
        return {
          ...structuredClone(mapped),
          id: direct?.id || mapped.id,
          name: canonName,
          voiceSourceRole: mapped.name
        };
      }
    }
  }
  return direct;
}

/** Maps `settings.routes` so prompt language & reading rules follow each character's current spoken voice body. */
export function effectiveSpeakingRoutes(settings) {
  const routes = Array.isArray(settings?.routes) ? settings.routes : [];
  return routes.map(r => {
    if (!r?.name) return r;
    const targetVoiceRole = resolveXenoVoiceRole(settings?.xeno, r.name, {inner: false, routes});
    if (targetVoiceRole) {
      const poolVoice = parsePoolVoiceRef(targetVoiceRole, settings?.voicePool);
      if (poolVoice) {
        const model = poolVoice.model || settings?.connections?.[poolVoice.engine]?.model || '';
        return {
          ...structuredClone(r),
          engine: poolVoice.engine,
          voice: poolVoice.voice,
          model,
          language: poolVoice.language || r.language,
          bindings: {
            ...(r.bindings || {}),
            [poolVoice.engine]: {
              ...(r.bindings?.[poolVoice.engine] || {}),
              voice: poolVoice.voice,
              model
            }
          },
          voiceSourceRole: formatVoiceRoleLabel(targetVoiceRole, settings?.voicePool)
        };
      }
      if (targetVoiceRole !== r.name) {
        const mapped = findRoute(routes, targetVoiceRole);
        if (mapped && (mapped.voice?.trim() || mapped.language || mapped.engine)) {
          return {
            ...structuredClone(r),
            engine: mapped.engine,
            voice: mapped.voice,
            model: mapped.model,
            language: mapped.language || r.language,
            bindings: structuredClone(mapped.bindings || {}),
            voiceSourceRole: mapped.name
          };
        }
      }
    }
    return r;
  });
}

/** Effective display of an entity's 6 core fields + 8 detail fields, accounting for worn 皮躯 / 肉躯! */
export function effectiveEntityView(xeno, entity, {forDrawing = false} = {}) {
  const e = normalizeEntity(entity, entity?.id === '__protagonist__');
  const wear = resolveWear(xeno, e);

  let gender = e.gender;
  let appearance = e.appearance;
  let bodyBuild = e.bodyBuild;
  let physiology = e.physiology;
  const hasOrgan = wear.lowerBodyMode === 'replace'
    ? ['male', 'dual'].includes(wear.lowerBodyType) : Boolean(wear.organ || ['男', '扶她'].includes(e.gender));

  if (wear.body) {
    const outer = wear.body.item;
    gender = outer.gender === '扶她' && !hasOrgan ? '女' : outer.gender || gender;
    appearance = outer.appearance || appearance;
    bodyBuild = outer.bodyBuild || bodyBuild;
    physiology = outer.physiology || physiology;
  }
  if (hasOrgan && gender === '女') gender = '扶她';
  if (wear.lowerBodyMode === 'replace') {
    if (wear.lowerBodyType === 'female') gender = '女';
    else if (wear.lowerBodyType === 'dual') gender = '扶她';
    else if (wear.lowerBodyType === 'male') gender = gender === '女' || gender === '扶她' ? '扶她' : '男';
    physiology = `${physiology}${physiology ? '；' : ''}【当前下体：${wear.organAppearance}；来源：${wear.organSource}】`;
  }
  if (forDrawing) appearance = wearDrawingAppearance(xeno, e);
  else if (wear.head?.itemId !== wear.body?.itemId && wear.layers.length) {
    appearance = `身体：${appearance}；头部来源：${wear.headSource}；头部外观：${wear.headAppearance}`;
  }
  if (e.predatorTail !== 'none') {
    const tailLabel = e.predatorTail === 'deployed' ? '展开态（尾椎粗壮肉尾+花蕊吞噬巨口）' : '隐蔽态（收缩于尾椎内）';
    physiology = `${physiology}；【丸吞尾：${tailLabel}】`;
  }
  const activeOrifices = ORIFICE_SLOTS.filter(([k]) => e.orificeMods[k] && e.orificeMods[k] !== '常态')
    .map(([, label], idx) => {
      const key = ORIFICE_SLOTS[idx][0];
      const mod = e.orificeMods[key];
      return `${label}:${mod}${mod === '生物侵入针' ? '(' + e.orificeMods.venomType + ')' : ''}`;
    });
  if (activeOrifices.length) {
    physiology = `${physiology}；【孔洞活性异化：${activeOrifices.join('、')}】`;
  }

  // Parasitism status overlay for protagonist and host targets
  const para = xeno.parasite || {active: false, bodyHost: null, scions: []};
  let currentBody = e.currentBody;
  let changeReason = e.changeReason;
  let hostingState = e.hostingState;
  if (e.id === '__protagonist__') {
    if (para.bodyHost?.targetName) {
      const bh = para.bodyHost;
      const sLabel = parasiteSiteLabel(bh.site);
      currentBody = `化形寄生于【${bh.targetName}】的${sLabel}（${bh.form}）`;
      changeReason = `本体化形寄生（宿主：${bh.targetName} · ${bh.mode}）`;
      hostingState = `本体已浓缩化形为【${bh.targetName}】的共生器官，100%自主意识与全感官共享`;
    } else if (para.scions?.length) {
      const hostSummary = para.scions.map(s => `${s.targetName}[${s.site === 'back_hulk' ? (s.form.startsWith('激活态') ? '背面巨躯激活' : '屁穴细胞潜伏') : parasiteSiteLabel(s.site).split('（')[0]}]`).join('、');
      hostingState = `${hostingState ? hostingState + ' ｜ ' : ''}分体子体寄生中（宿主：${hostSummary}；主角保有最高远程控制权）`;
    }
  } else if (e.name) {
    const bh = para.bodyHost?.targetName === e.name ? para.bodyHost : null;
    const sc = (para.scions || []).find(s => s.targetName === e.name && (!forDrawing || s.site !== 'back_hulk')) || null;
    if (bh) {
      const sLabel = parasiteSiteLabel(bh.site);
      if (bh.site === 'crotch' && bh.form.startsWith('觉醒态')) {
        gender = '扶她';
        physiology = `${physiology}；【本体化形寄生·共生扶她肉棒（觉醒态 · ${bh.mode}）：主角本体已化形为长在${e.name}胯下的饱满扶她阴茎与玉囊，与宿主血肉神经相连，主角可自行控制充血勃起、跳动与射精】`;
      } else {
        physiology = `${physiology}；【本体化形寄生（${sLabel} · ${bh.form} · ${bh.mode}）：主角本体化形融合于此部位，保有独立自主活动力并与宿主全感官共享】`;
      }
      changeReason = `被主角本体化形寄生（${sLabel} · ${bh.mode}）`;
    }
    if (sc) {
      const sLabel = parasiteSiteLabel(sc.site);
      if (sc.site === 'back_hulk') {
        if (sc.form.startsWith('激活态')) {
          if (sc.hulkFutaMode === '长在目标胯下' || sc.hulkFutaMode === '双重扶她肉棒') {
            gender = '扶她';
          }
          const hulkLook = sc.hulkAppearance || `衍生自${e.name}自身特征的庞大无头肉体躯干`;
          const futaDetail = sc.hulkFutaMode === '长在目标胯下'
            ? `扶她肉棒与玉囊直接生长在正前方被镶嵌的${e.name}自己胯下，随巨躯步伐垂挂晃动`
            : sc.hulkFutaMode === '长在巨躯胯下'
            ? `粗壮扶她肉棒生长在身后无头巨躯胯下基部，可向上顶入正前方${e.name}的小穴/屁穴持续抽插或随巨躯挺腰对外侵犯`
            : sc.hulkFutaMode === '双重扶她肉棒'
            ? `${e.name}自身胯下与身后无头巨躯胯下同时生长出饱满扶她肉棒`
            : '无额外扶她肉棒，完全展露原本女性下体';
          appearance = `【背面无头巨躯镶嵌（巨躯外观：${hulkLook}）】屁穴内的子体细胞已从后庭分裂膨胀为庞大无头巨躯，将${e.name}从背后正面镶嵌于巨躯胸腹正中央（双臂向后没入巨躯肩胸肉穴、双腿大开向后没入巨躯大腿根肉腔无缝相连；头部、双乳、腰腹与下体完全正面朝外裸露）｜ ${appearance}`;
          physiology = `${physiology}；【背面无头巨躯激活态（${sc.mode} · 扶她肉棒：${sc.hulkFutaMode}）：${futaDetail}；相连后${e.name}拥有活体巨躯控制权，控制巨躯的四肢躯干就像控制自己原本身体一样自然流畅，但主角拥有更高控制权可随时凭意念压制或接管】`;
          currentBody = `${e.originalBody || e.name + '的肉体'}（正面四肢没入镶嵌于背面无头巨躯胸腹中央）`;
          changeReason = `分体子体寄生·背面无头巨躯激活态（${sc.mode}）`;
        } else {
          physiology = `${physiology}；【背面巨躯寄生·屁穴潜伏态（${sc.mode}）：分体子体浓缩为活性子体细胞潜伏寄生于${e.name}的屁穴（后庭直肠）深处，保持温热脉动与神经连接，激活时可随时从后庭急速分裂生长为背面无头巨躯】`;
          changeReason = `分体子体寄生·屁穴子体细胞潜伏中（${sc.mode}）`;
        }
      } else {
        if (sc.site === 'crotch' && sc.form.startsWith('觉醒态')) {
          gender = '扶她';
        }
        physiology = `${physiology}；【分体子体寄生（${sLabel} · ${sc.form} · ${sc.mode}）：主角植入的分体子体寄生于此，主角可随时远程操控子体施加刺激与支配】`;
        changeReason = `分体子体寄生（${sLabel} · ${sc.mode}）`;
      }
    }
  }

  const voreText = e.voreStorage.length
    ? e.voreStorage.map(v => `${v.preyName}［${v.location} · 经由${v.channel} · ${v.status} · ${v.digestion}］`).join('；')
    : '无';

  const lookupName = e.name || (e.id === '__protagonist__' ? '主角' : '');
  const spokenVoiceRole = resolveXenoVoiceRole(xeno, lookupName, {inner: false});
  const innerVoiceRole = resolveXenoVoiceRole(xeno, lookupName, {inner: true});
  const spokenLabel = formatVoiceRoleLabel(spokenVoiceRole);
  const innerLabel = formatVoiceRoleLabel(innerVoiceRole);
  let voiceStateText = e.name ? `本人原音色（${e.name}）` : '本人原音色';
  if (spokenVoiceRole && spokenVoiceRole !== e.name && spokenVoiceRole !== '主角') {
    if (innerVoiceRole && innerVoiceRole !== spokenVoiceRole) {
      voiceStateText = `开口使用【${spokenLabel}】音色 ｜ 心声保留【${innerVoiceRole === '主角' ? (e.name || '主角') : innerLabel}】音色`;
    } else {
      voiceStateText = `使用【${spokenLabel}】音色`;
    }
  }
  if (wear.head && !wear.headVoice) voiceStateText += ' ｜ 当前头部未绑定音色，使用本体音色';

  return {
    // 6 core fields
    name: e.name,
    identity: e.identity,
    gender,
    appearance: e.statusLocks?.appearance?.value ?? appearance,
    bodyBuild: e.statusLocks?.bodyBuild?.value ?? bodyBuild,
    physiology,
    headAppearance: wear.headAppearance,
    headSource: wear.headSource,
    lowerBodyGender: gender,
    lowerBodyAppearance: e.statusLocks?.lowerBodyAppearance?.value ?? (e.lowerBodyAppearance || wear.organAppearance),
    lowerBodyState: lowerBodyStateValue(e.statusLocks?.lowerBodyState?.value ?? e.lowerBodyState, gender),
    organAppearance: wear.organAppearance,
    organSource: wear.organSource,
    bodySource: wear.bodySource,
    extensionText: wear.extensionText,
    layerText: wear.layerText,
    equipmentAbilities: wear.abilities,
    // 8 detail fields
    originalBody: e.originalBody,
    currentBody,
    changeReason,
    hostingState,
    livingMountText: wear.layerText,
    outfitText: `外搭：${e.outfit.outerwear || '无'}${/风衣/.test(e.outfit.outerwear) ? (e.outfit.coatPose === 'open' ? '（展开姿态）' : '（遮蔽形态）') : ''} ｜ 内衣：${e.outfit.underwear || '无'} ｜ 遮挡：${e.outfit.privacyCover || '无'} ｜ 饰品：${e.outfit.accessories || '无'}`,
    voreText,
    cognitionText: rebuildCognitionSummary(e.cognitionState),
    spokenVoiceRole,
    innerVoiceRole,
    voiceStateText
  };
}

// ==================== 1. 附身之术 Operations ====================

export function xenoStartPossession(state, {targetName, mode = '浅层共鸣', entryWay = '近距锁定'}) {
  const next = normalizeXeno(state);
  const target = ensureTarget(next, targetName);
  const chosenMode = POSSESSION_MODES.includes(mode) ? mode : (entryWay === '灵体游离' ? '完全占据' : '浅层共鸣');

  // If fusion was active, close it cleanly first
  if (next.fusion.active) next.fusion.active = false;

  // Save protagonist's original body parameters if not yet saved
  if (!next.protagonist.baseSnapshot) {
    next.protagonist.baseSnapshot = {
      gender: next.protagonist.gender,
      appearance: next.protagonist.appearance,
      bodyBuild: next.protagonist.bodyBuild,
      physiology: next.protagonist.physiology,
      voiceRole: next.protagonist.voiceRole
    };
  }

  next.possession.active = true;
  next.possession.targetName = target.name;
  next.possession.mode = chosenMode;
  next.possession.entryWay = POSSESSION_WAYS.includes(entryWay) ? entryWay : '近距锁定';

  if (!next.possession.anchors.some(a => a.name === target.name)) {
    next.possession.anchors.unshift({
      name: target.name,
      note: `${target.identity} · ${target.bodyBuild.slice(0, 40)}`,
      createdAt: Date.now()
    });
  }

  syncPossessionEntities(next, target);
  next.selectedTarget = target.name;
  next.pendingActionNote = `【本轮异构终端操作：发动附身之术】主角通过「${next.possession.entryWay}」对「${target.name}」发起附身，当前附身状态为「${chosenMode}」${next.possession.organSync ? '，并开启了【器官同步】' : ''}。原始本体自动进入【托管+30%次魂镜像（封锁能力记忆）】状态。`;
  return next;
}

function syncPossessionEntities(next, target) {
  const mode = next.possession.mode;
  const syncOrgan = next.possession.organSync;
  const basePhys = next.protagonist.baseSnapshot?.physiology || '使用者本体生殖器官';
  const organNote = syncOrgan ? `；【器官同步激活：已在对应部位生长出${next.protagonist.name}本体的生殖器官（${basePhys}），由意念精确控制】` : '';

  next.protagonist.currentBody = target.originalBody || `${target.name}的肉体`;
  next.protagonist.changeReason = `附身（${mode} · ${next.possession.entryWay}）`;
  next.protagonist.hostingState = '原始本体托管中 · 30%次魂镜像独立运行（封锁能力记忆）';
  next.protagonist.gender = syncOrgan ? '扶她' : target.gender;
  next.protagonist.appearance = target.appearance;
  next.protagonist.bodyBuild = target.bodyBuild;
  next.protagonist.physiology = target.physiology.replace(/；【器官同步激活：[^】]*】/g, '') + organNote;

  const modeDesc = {
    '浅层共鸣': '被附身·浅层共鸣（目标毫无察觉，使用者共享感官与情绪）',
    '意识共存': '被附身·意识共存（使用者主导身体，目标意识清醒被困脑内可精神交流）',
    '完全占据': '被附身·完全占据（使用者绝对控制，目标意识沉睡且事后无记忆）',
    '认知覆盖': '被附身·认知覆盖（使用者操控身体，目标清醒但坚信一切言行皆出于自身本心）'
  }[mode];
  target.changeReason = modeDesc;
  target.hostingState = mode === '浅层共鸣' ? '目标原本意识主导（未察觉潜入者）' : '身体控制权已被主角接管';
  target.physiology = target.physiology.replace(/；【器官同步激活：[^】]*】/g, '') + organNote;
  if (mode === '认知覆盖') {
    target.cognitionState.relationOverride = '潜意识完全合理化当前身体的一切言行，坚信全是自己发自内心想做的';
    rebuildCognitionSummary(target.cognitionState);
  }
}

export function xenoSetPossessionMode(state, mode) {
  const next = normalizeXeno(state);
  if (!next.possession.active || !POSSESSION_MODES.includes(mode)) return next;
  next.possession.mode = mode;
  const target = ensureTarget(next, next.possession.targetName);
  syncPossessionEntities(next, target);
  next.pendingActionNote = `【本轮异构终端操作：切换附身状态】主角对「${target.name}」的附身状态切换为「${mode}」。`;
  return next;
}

export function xenoToggleOrganSync(state, force) {
  const next = normalizeXeno(state);
  if (!next.possession.active) throw Error('请先附身一个目标后再开启器官同步');
  next.possession.organSync = typeof force === 'boolean' ? force : !next.possession.organSync;
  const target = ensureTarget(next, next.possession.targetName);
  syncPossessionEntities(next, target);
  next.pendingActionNote = next.possession.organSync
    ? `【本轮异构终端操作：开启器官同步】在被附身的「${target.name}」身体对应部位生长出与主角原始本体完全一致的生殖器官。`
    : `【本轮异构终端操作：关闭器官同步】被附身的「${target.name}」身上同步生长的器官消退，身体恢复原状且不留痕迹。`;
  return next;
}

export function xenoReleasePossession(state, fakeMemory = '') {
  const next = normalizeXeno(state);
  if (!next.possession.active) return next;
  const targetName = next.possession.targetName;
  const target = next.targets.find(t => t.name === targetName);
  const memoryText = clip(fakeMemory, 500) || '只觉得刚才是一段自然合理的日常行动或心血来潮，没有任何违和感';

  if (target) {
    target.changeReason = '正常主导（脱离结算·认知篡改已完成）';
    target.hostingState = '本人意识主导';
    target.physiology = target.physiology.replace(/；【器官同步激活：[^】]*】/g, '');
    target.cognitionState.fakeMemory = memoryText;
    rebuildCognitionSummary(target.cognitionState);
  }

  if (next.protagonist.baseSnapshot) {
    next.protagonist.gender = next.protagonist.baseSnapshot.gender;
    next.protagonist.appearance = next.protagonist.baseSnapshot.appearance;
    next.protagonist.bodyBuild = next.protagonist.baseSnapshot.bodyBuild;
    next.protagonist.physiology = next.protagonist.baseSnapshot.physiology;
    next.protagonist.voiceRole = next.protagonist.baseSnapshot.voiceRole || '';
    next.protagonist.baseSnapshot = null;
  }
  next.protagonist.currentBody = next.protagonist.originalBody;
  next.protagonist.changeReason = '回归原始本体（主魂与30%次魂合一，已回溯接收分离期记忆）';
  next.protagonist.hostingState = '未离体';

  next.possession.active = false;
  next.possession.targetName = '';
  next.possession.organSync = false;
  next.pendingActionNote = `【本轮异构终端操作：脱离附身与认知篡改】主角主意识从「${targetName}」体内抽离并回归原始本体（瞬间融合接收30%次魂在分离期间的全部记忆）；「${targetName}」原本意识苏醒，并被写入虚假记忆：「${memoryText}」。`;
  return next;
}

export function xenoBodySwap(state, swapType = 'both') {
  const next = normalizeXeno(state);
  if (!next.possession.active) throw Error('请先附身目标后再执行肉体互换');
  if (!['完全占据', '认知覆盖'].includes(next.possession.mode)) {
    throw Error('肉体互换仅在「完全占据」或「认知覆盖」状态下可用');
  }
  const target = ensureTarget(next, next.possession.targetName);
  const oldProtagonistBody = next.protagonist.originalBody;
  const oldProtagonistSnap = next.protagonist.baseSnapshot || {
    gender: next.protagonist.gender,
    appearance: next.protagonist.appearance,
    bodyBuild: next.protagonist.bodyBuild,
    physiology: next.protagonist.physiology,
    voiceRole: next.protagonist.voiceRole
  };
  const protOldVoice = oldProtagonistSnap.voiceRole || next.protagonist.voiceRole || next.protagonist.name;
  const targetOldVoice = target.voiceRole || target.name;
  const newProtagonistBody = target.originalBody || `${target.name}的肉体`;
  const cleanTargetPhys = target.physiology.replace(/；【器官同步激活：[^】]*】/g, '');

  // Protagonist permanently takes target's body as new originalBody
  next.protagonist.originalBody = newProtagonistBody;
  next.protagonist.currentBody = newProtagonistBody;
  next.protagonist.gender = target.gender;
  next.protagonist.appearance = target.appearance;
  next.protagonist.bodyBuild = target.bodyBuild;
  next.protagonist.physiology = cleanTargetPhys;
  next.protagonist.voiceRole = targetOldVoice === next.protagonist.name ? '' : targetOldVoice;
  next.protagonist.baseSnapshot = null;
  next.protagonist.changeReason = '永久肉体互换（新原始本体）';
  next.protagonist.hostingState = '未离体（已以新肉体为原始本体）';

  if (swapType === 'oneway') {
    target.changeReason = '肉体已被主角单向夺舍占据';
    target.hostingState = '原意识沉睡或消散';
  } else {
    // Target soul wakes up in protagonist's old body
    target.originalBody = oldProtagonistBody;
    target.currentBody = oldProtagonistBody;
    target.gender = oldProtagonistSnap.gender;
    target.appearance = oldProtagonistSnap.appearance;
    target.bodyBuild = oldProtagonistSnap.bodyBuild;
    target.physiology = oldProtagonistSnap.physiology;
    target.voiceRole = protOldVoice === target.name ? '' : protOldVoice;
    target.hostingState = '本人意识在新肉体中苏醒';
  }

  if (swapType === 'outer') {
    target.changeReason = '永久肉体互换（自知肉体改变，但外界认知被覆盖合理化）';
    target.cognitionState.fakeMemory = `自身发觉肉体变成了「${oldProtagonistBody}」，但周围所有人均认为这本来就是她的身体`;
  } else {
    target.changeReason = '永久肉体互换（自身与外界双重认知覆盖合理化）';
    target.cognitionState.relationOverride = `坚信「${oldProtagonistBody}」从一开始就是自己原本的身体，周囲所有人也认为理所当然`;
  }
  rebuildCognitionSummary(target.cognitionState);

  next.possession.active = false;
  next.possession.targetName = '';
  next.possession.organSync = false;
  next.pendingActionNote = `【本轮异构终端操作：永久肉体互换】主角与「${target.name}」执行了不可逆的永久肉体互换！「${newProtagonistBody}」现已成为主角新的原始本体；而「${target.name}」的灵魂在主角原本的肉体「${oldProtagonistBody}」中苏醒（${swapType === 'outer' ? '目标自身发觉肉体改变，但外界认知自动合理化' : '认知覆盖使目标自身与外界都坚信这本来就是她原本的身体'}）。`;
  return next;
}

// ==================== 2. 融合之术 Operations (无神躯) ====================

export function computeFusionGender(g1, g2) {
  return (g1 === '男' || g1 === '扶她' || g2 === '男' || g2 === '扶她') ? '扶她' : '女';
}

export function xenoStartFusion(state, {targetName, mode = '共存融合', releaseBranch = '正常分离'}) {
  const next = normalizeXeno(state);
  const target = ensureTarget(next, targetName);
  if (next.possession.active) next.possession.active = false;

  if (!next.protagonist.baseSnapshot) {
    next.protagonist.baseSnapshot = {
      gender: next.protagonist.gender,
      appearance: next.protagonist.appearance,
      bodyBuild: next.protagonist.bodyBuild,
      physiology: next.protagonist.physiology,
      voiceRole: next.protagonist.voiceRole
    };
  }

  const chosenMode = FUSION_MODES.includes(mode) ? mode : '共存融合';
  const resultingGender = computeFusionGender(next.protagonist.baseSnapshot.gender, target.gender);
  next.fusion.active = true;
  next.fusion.targetName = target.name;
  next.fusion.mode = chosenMode;
  next.fusion.resultingGender = resultingGender;
  next.fusion.controller = chosenMode === '浅层融合' ? '目标意志主导' : '使用者主导';
  next.fusion.releaseBranch = FUSION_BRANCHES.includes(releaseBranch) ? releaseBranch : '正常分离';

  syncFusionEntities(next, target);
  next.selectedTarget = target.name;
  next.pendingActionNote = `【本轮异构终端操作：发动肉体融合】主角与「${target.name}」发起物理层面的完整肉体融合，融合状态为「${chosenMode}」，融合后性别为「${resultingGender}」，身材曲线在双方基础上进一步丰满优化，当前控制权归属：「${next.fusion.controller}」。`;
  return next;
}

function syncFusionEntities(next, target) {
  const f = next.fusion;
  const fusedName = `融合躯体（${next.protagonist.name} × ${target.name}）`;
  next.protagonist.currentBody = fusedName;
  next.protagonist.changeReason = `肉体融合（${f.mode} · ${f.controller}）`;
  next.protagonist.hostingState = `与${target.name}物理合二为一`;
  next.protagonist.gender = f.resultingGender;
  next.protagonist.appearance = `【融合外貌】兼具${target.name}与${next.protagonist.name}的最佳特征（${target.appearance}）`;
  next.protagonist.bodyBuild = `【融合优化体态】${target.bodyBuild}（胸部更加丰满挺拔、腰臀比更突出、曲线更明显）`;
  next.protagonist.physiology = f.resultingGender === '扶她'
    ? `【融合扶她构造】同时具备极致敏感的女性腔道与雄伟扶她肉棒（${target.physiology}）`
    : `【融合女性构造】${target.physiology}`;

  target.currentBody = fusedName;
  target.changeReason = `被肉体融合中（${f.mode} · 控制权：${f.controller}）`;
  target.hostingState = f.mode === '浅层融合'
    ? '自身意志主导行动（对融合毫无察觉）'
    : f.mode === '共存融合'
    ? '意识清醒，感知身体被融合操控，可在脑海精神交流'
    : f.mode === '完全融合'
    ? '意识陷入沉睡（解除后失去期间记忆）'
    : '意识清醒但坚信融合躯体的一切言行皆出于自身本心';
}

export function xenoSetFusionMode(state, mode) {
  const next = normalizeXeno(state);
  if (!next.fusion.active || !FUSION_MODES.includes(mode)) return next;
  next.fusion.mode = mode;
  if (mode === '浅层融合') next.fusion.controller = '目标意志主导';
  else if (next.fusion.controller === '目标意志主导') next.fusion.controller = '使用者主导';
  const target = ensureTarget(next, next.fusion.targetName);
  syncFusionEntities(next, target);
  next.pendingActionNote = `【本轮异构终端操作：切换融合状态】主角与「${target.name}」的融合状态切换为「${mode}」。`;
  return next;
}

export function xenoToggleFusionController(state) {
  const next = normalizeXeno(state);
  if (!next.fusion.active) return next;
  next.fusion.controller = next.fusion.controller === '使用者主导' ? '暂时授予目标' : '使用者主导';
  const target = ensureTarget(next, next.fusion.targetName);
  syncFusionEntities(next, target);
  next.pendingActionNote = `【本轮异构终端操作：融合控制权交接】融合躯体的身体控制权已切换为「${next.fusion.controller}」（目标无法抗拒）。`;
  return next;
}

export function xenoReleaseFusion(state, branch = '正常分离') {
  const next = normalizeXeno(state);
  if (!next.fusion.active) return next;
  const chosenBranch = FUSION_BRANCHES.includes(branch) ? branch : next.fusion.releaseBranch;
  const targetName = next.fusion.targetName;
  const target = ensureTarget(next, targetName);

  // Restore protagonist base body
  if (next.protagonist.baseSnapshot) {
    next.protagonist.gender = next.protagonist.baseSnapshot.gender;
    next.protagonist.appearance = next.protagonist.baseSnapshot.appearance;
    next.protagonist.bodyBuild = next.protagonist.baseSnapshot.bodyBuild;
    next.protagonist.physiology = next.protagonist.baseSnapshot.physiology;
    next.protagonist.voiceRole = next.protagonist.baseSnapshot.voiceRole || '';
    next.protagonist.baseSnapshot = null;
  }
  next.protagonist.currentBody = next.protagonist.originalBody;
  next.protagonist.changeReason = `解除融合（${chosenBranch}）`;
  next.protagonist.hostingState = '未离体';

  if (chosenBranch === '皮躯化') {
    const suitId = `fusion_skin_${target.id}`;
    const prevSkin = next.items.find(i => i.id === suitId);
    const boundVoice = clip(prevSkin?.voiceRole || next.itemVoiceBindings?.[suitId] || target.voiceRole || target.name, 4000);
    const item = normalizeCatalogItem({
      id: suitId,
      name: `${target.name}·活体转化皮躯`,
      shortName: `${target.name}皮躯`,
      category: 'skin_suit',
      slot: 'skin_suit',
      price: 0,
      owned: true,
      source: 'fusion',
      sourceTargetName: target.name,
      voiceRole: boundVoice,
      imageData: prevSkin?.imageData || '',
      gender: target.gender,
      appearance: target.appearance,
      bodyBuild: target.bodyBuild,
      physiology: target.physiology,
      summary: `由「${target.name}」融合解除时皮躯化生成的完整人形活体皮躯（已存入衣柜，可穿戴或再次融合还原）`,
      rawDesign: `<skin_suit_design name="${target.name}·活体转化皮躯">\n[外观视觉还原]\n- 原型角色: ${target.name}（${target.identity}）\n- 外貌特征: ${target.appearance}\n[体态参数]\n- 体型身材: ${target.bodyBuild}\n- 生理构造: ${target.physiology}\n[活体穿戴机能]\n- 背部脊椎隐形开口穿入，无缝贴合，支持全脸覆面拟态或收缩至颈部露原貌，意识永久沉睡。\n</skin_suit_design>`
    });
    if (boundVoice) next.itemVoiceBindings[suitId] = boundVoice;
    next.items = [item, ...next.items.filter(i => i.id !== suitId)];
    target.currentBody = `已转化为皮躯（${item.name}）`;
    target.changeReason = '融合解除·皮躯化（已存入衣柜）';
    target.hostingState = '意识陷入永久无意识沉睡（再次融合可还原）';
    next.pendingActionNote = `【本轮异构终端操作：融合解除·皮躯化】主角解除与「${target.name}」的融合，并将「${target.name}」的肉体转化为一件完整的活体【皮躯】存入衣柜，其原本意识陷入永久沉睡。`;
  } else if (chosenBranch === '肉躯化') {
    const ringId = `fusion_ring_${target.id}`;
    const prevRing = next.items.find(i => i.id === ringId);
    const boundVoice = clip(prevRing?.voiceRole || next.itemVoiceBindings?.[ringId] || target.voiceRole || target.name, 4000);
    const item = normalizeCatalogItem({
      id: ringId,
      name: `${target.name}·凝缩活体肉躯环`,
      shortName: `${target.name}肉躯`,
      category: 'flesh_ring',
      slot: 'flesh_ring',
      price: 0,
      owned: true,
      source: 'fusion',
      sourceTargetName: target.name,
      voiceRole: boundVoice,
      imageData: prevRing?.imageData || '',
      gender: '扶她',
      ringAppearance: `由${target.name}肉体凝缩而成的温热活体肉质圆环，锚定于阴茎口/阴蒂口`,
      forwardExtension: `向前方增殖重构出极具侵略性的肉棒器官（承载${target.name}的生理特征）`,
      backwardExtension: `向后方全身蔓延包裹，完全重现「${target.name}」的外貌与体态（${target.appearance}；${target.bodyBuild}）`,
      appearance: target.appearance,
      bodyBuild: target.bodyBuild,
      physiology: target.physiology,
      summary: `由「${target.name}」融合解除时肉躯化凝缩而成的活体肉躯环（已存入衣柜，可佩戴延展或再次融合还原）`,
      rawDesign: `<flesh_ring_design name="${target.name}·凝缩活体肉躯环">\n[基底环体]\n- 由「${target.name}」肉体凝缩而成的温热肉环，扣合阴茎口/阴蒂口建立神经直连。\n[前方重构：器官形态]\n- 向前方增殖构筑完整肉棒。\n[后方延展：外躯体态]\n- 外貌: ${target.appearance}\n- 体态: ${target.bodyBuild}\n- 生理: ${target.physiology}\n</flesh_ring_design>`
    });
    if (boundVoice) next.itemVoiceBindings[ringId] = boundVoice;
    next.items = [item, ...next.items.filter(i => i.id !== ringId)];
    target.currentBody = `已凝缩为肉躯环（${item.name}）`;
    target.changeReason = '融合解除·肉躯化（已存入衣柜）';
    target.hostingState = '意识陷入永久无意识沉睡（再次融合可还原）';
    next.pendingActionNote = `【本轮异构终端操作：融合解除·肉躯化】主角解除与「${target.name}」的融合，并将「${target.name}」的肉体凝缩为一枚环状活体道具【肉躯】存入衣柜，其原本意识陷入永久沉睡。`;
  } else {
    target.currentBody = target.originalBody;
    target.changeReason = '正常主导（融合正常分离）';
    target.hostingState = '本人意识主导';
    next.pendingActionNote = `【本轮异构终端操作：融合解除·正常分离】主角与「${target.name}」解除肉体融合，双方肉体正常分离恢复原状。`;
  }

  next.fusion.active = false;
  next.fusion.targetName = '';
  return next;
}

/** Restores a fusion-created skin_suit or flesh_ring back into the living character via re-fusion. */
export function xenoRestoreFromLivingItem(state, itemId) {
  const next = normalizeXeno(state);
  const item = next.items.find(i => i.id === itemId);
  if (!item || item.source !== 'fusion') throw Error('找不到这件转化装备');
  const targetName = item.sourceTargetName || item.shortName.replace(/(?:皮躯|肉躯)$/, '');
  // Unequip from anyone wearing it
  for (const ent of [next.protagonist, ...next.targets]) {
    const index = ent.livingMount.layers.findIndex(layer => layer.itemId === itemId);
    if (index >= 0) ent.livingMount.layers.splice(index);
    syncWearMount(ent.livingMount);
  }
  next.items = next.items.filter(i => i.id !== itemId);
  const target = ensureTarget(next, targetName);
  target.currentBody = target.originalBody;
  target.changeReason = '已由皮躯/肉躯再次融合还原为原本肉体与意识';
  target.hostingState = '本人意识苏醒恢复';
  next.pendingActionNote = `【本轮异构终端操作：活体装备还原】主角对「${item.name}」再次发起肉体融合并分离，将其完整还原为「${target.name}」原本的肉体与意识。`;
  return next;
}

// ==================== 3. 丸吞之术 Operations ====================

export function xenoStartParasite(state, {
  kind = 'scion',
  targetName,
  site = 'crotch',
  form = '',
  mode = '潜伏共生',
  hulkFutaMode = '长在目标胯下',
  hulkAppearance = ''
} = {}) {
  const next = normalizeXeno(state);
  const target = ensureTarget(next, targetName);
  const actualKind = site === 'back_hulk' ? 'scion' : (kind === 'body' ? 'body' : 'scion');
  const entry = normalizeParasiteEntry({
    kind: actualKind,
    targetName: target.name,
    site,
    form,
    mode,
    hulkFutaMode,
    hulkAppearance
  }, actualKind);

  const modeNote = {
    '潜伏共生': '宿主尚未察觉独立寄生意识，将身体异变合理化为自身奇异反应',
    '共生同化': '宿主在认知与生理上将寄生体视为天生不可分割的一部分并产生强烈依赖',
    '合作共生': '宿主清楚知晓主角/子体存在，双方意识互通并在日常、战斗与欢愉中默契配合'
  }[entry.mode] || '';

  if (actualKind === 'body') {
    if (next.possession.active) next.possession.active = false;
    if (next.fusion.active) next.fusion.active = false;
    if (!next.protagonist.baseSnapshot) {
      next.protagonist.baseSnapshot = {
        gender: next.protagonist.gender,
        appearance: next.protagonist.appearance,
        bodyBuild: next.protagonist.bodyBuild,
        physiology: next.protagonist.physiology,
        voiceRole: next.protagonist.voiceRole
      };
    }
    next.parasite.bodyHost = entry;
    next.parasite.active = true;
    next.selectedTarget = target.name;
    const sLabel = parasiteSiteLabel(entry.site);
    next.pendingActionNote = `【本轮异构终端操作：发动本体化形寄生】主角将自身原始本体浓缩化形，直接融入「${target.name}」的【${sLabel}】，当前形态为「${entry.form}」，共生状态为「${entry.mode}」（${modeNote}）。主角作为该共生部位保有100%自主活动能力并与宿主全感官共享。`;
    return next;
  }

  // 分体子体寄生 (scion)
  next.parasite.scions = [
    entry,
    ...(next.parasite.scions || []).filter(s => s.targetName !== target.name)
  ];
  next.parasite.active = true;
  next.selectedTarget = target.name;
  const sLabel = parasiteSiteLabel(entry.site);
  if (entry.site === 'back_hulk') {
    const isActivated = entry.form.startsWith('激活态');
    const hulkLook = entry.hulkAppearance || `衍生自${target.name}自身特征的无头肉体躯干`;
    next.pendingActionNote = isActivated
      ? `【本轮异构终端操作：分体子体寄生 · 背面无头巨躯展开】寄生在「${target.name}」屁穴内的分体子体细胞从后庭疯狂分裂涌出，在她身后急速膨胀生长为一具庞大的【无头活体巨躯】（外观：${hulkLook}；扶她肉棒设置：${entry.hulkFutaMode}；共生状态：${entry.mode}），将「${target.name}」从背后正面镶嵌于巨躯胸腹正中央（四肢向后没入巨躯肉腔无缝相连，头部、双乳、腰腹与下体正面完全裸露）。相连后「${target.name}」控制活体巨躯就像控制自己原本身体一样自然流畅，但主角拥有高于她的最高控制权，可随时凭意念压制或接管！`
      : `【本轮异构终端操作：分体子体寄生 · 植入屁穴潜伏子体细胞】主角在「${target.name}」的屁穴（后庭直肠）深处植入了【背面巨躯分体子体细胞】（当前为潜伏态，共生状态：${entry.mode}），在直肠内壁保持温热脉动与神经直连，随时可响应召唤从屁穴分裂膨胀为背面无头巨躯。`;
  } else {
    next.pendingActionNote = `【本轮异构终端操作：发动分体子体寄生】主角本体保持在外界自由活动，同时将分裂出的【寄生子体】植入「${target.name}」的【${sLabel}】，当前形态为「${entry.form}」，共生状态为「${entry.mode}」（${modeNote}）。主角可在外界与她互动的同时远程操控体内子体。`;
  }
  return next;
}

export function xenoUpdateParasite(state, {kind = 'scion', targetName = '', patch = {}} = {}) {
  const next = normalizeXeno(state);
  const isBody = kind === 'body' && next.parasite.bodyHost && (!targetName || next.parasite.bodyHost.targetName === targetName);
  const entry = isBody
    ? next.parasite.bodyHost
    : (next.parasite.scions || []).find(s => s.targetName === (targetName || next.selectedTarget));
  if (!entry) return next;

  const prevForm = entry.form;
  const merged = normalizeParasiteEntry({
    ...entry,
    ...patch,
    form: patch.site && patch.site !== entry.site && !patch.form
      ? (PARASITE_SITE_FORMS[patch.site]?.[0] || '')
      : (patch.form ?? entry.form)
  }, isBody ? 'body' : 'scion');

  if (isBody) {
    next.parasite.bodyHost = merged;
  } else {
    next.parasite.scions = next.parasite.scions.map(s => s.targetName === merged.targetName ? merged : s);
  }
  const sLabel = parasiteSiteLabel(merged.site);
  if (!isBody && merged.site === 'back_hulk') {
    const hulkLook = merged.hulkAppearance || `衍生自${merged.targetName}自身特征的无头肉体躯干`;
    if (prevForm !== merged.form) {
      next.pendingActionNote = merged.form.startsWith('激活态')
        ? `【本轮异构终端操作：激活背面无头巨躯】潜伏在「${merged.targetName}」屁穴深处的子体细胞瞬间苏醒，从后庭疯狂分裂涌出并在她身后急速生长为庞大的【无头活体巨躯】（外观：${hulkLook}；扶她肉棒：${merged.hulkFutaMode}；共生状态：${merged.mode}），将她四肢向后没入镶嵌在巨躯胸腹正前方！她控制巨躯如同控制自己身体般自然，而主角握有随时覆盖的最高控制权。`
        : `【本轮异构终端操作：关闭并收回背面巨躯】「${merged.targetName}」身后的庞大无头巨躯迅速解构缩小，顺着她的屁穴重新钻回后庭直肠深处，还原为潜伏态的子体细胞（共生状态：${merged.mode}）。`;
    } else {
      next.pendingActionNote = `【本轮异构终端操作：调整背面巨躯寄生状态】已更新「${merged.targetName}」的背面巨躯寄生设定（当前形态：${merged.form}；扶她肉棒位置：${merged.hulkFutaMode}；巨躯外观：${hulkLook}；共生状态：${merged.mode}）。`;
    }
  } else {
    next.pendingActionNote = `【本轮异构终端操作：切换寄生状态】「${merged.targetName}」的${isBody ? '本体化形寄生' : '分体子体寄生'}已更新为：部位【${sLabel}】、形态【${merged.form}】、共生状态【${merged.mode}】。`;
  }
  return next;
}

export function xenoReleaseParasite(state, {kind = 'scion', targetName = '', branch = '正常剥离（抹除记忆并合理化）'} = {}) {
  const next = normalizeXeno(state);
  const isBody = kind === 'body' && next.parasite.bodyHost && (!targetName || next.parasite.bodyHost.targetName === targetName);
  const entry = isBody
    ? next.parasite.bodyHost
    : (next.parasite.scions || []).find(s => s.targetName === (targetName || next.selectedTarget));
  if (!entry) return next;

  const target = ensureTarget(next, entry.targetName);
  const chosenBranch = PARASITE_RELEASE_BRANCHES.includes(branch) ? branch : PARASITE_RELEASE_BRANCHES[0];

  if (isBody) {
    if (next.protagonist.baseSnapshot) {
      next.protagonist.gender = next.protagonist.baseSnapshot.gender;
      next.protagonist.appearance = next.protagonist.baseSnapshot.appearance;
      next.protagonist.bodyBuild = next.protagonist.bodyBuild || next.protagonist.baseSnapshot.bodyBuild;
      next.protagonist.physiology = next.protagonist.baseSnapshot.physiology;
      next.protagonist.voiceRole = next.protagonist.baseSnapshot.voiceRole || '';
      next.protagonist.baseSnapshot = null;
    }
    next.protagonist.currentBody = next.protagonist.originalBody;
    next.protagonist.changeReason = `解除本体化形寄生（${chosenBranch}）`;
    next.protagonist.hostingState = '未离体';
    next.parasite.bodyHost = null;
  } else {
    next.parasite.scions = (next.parasite.scions || []).filter(s => s.targetName !== entry.targetName);
  }
  next.parasite.active = Boolean(next.parasite.bodyHost || next.parasite.scions.length);

  if (chosenBranch === '永久器官固化') {
    const hadFuta = (entry.site === 'crotch' && entry.form.startsWith('觉醒态'))
      || (entry.site === 'back_hulk' && (entry.hulkFutaMode === '长在目标胯下' || entry.hulkFutaMode === '双重扶她肉棒'));
    if (hadFuta) target.gender = '扶她';
    const solidDesc = entry.site === 'crotch'
      ? '胯下共生扶她肉棒与玉囊已永久固化为天生肉体器官'
      : entry.site === 'womb'
      ? '子宫巢穴与高敏催情腺体已永久固化为天生体质'
      : entry.site === 'spine'
      ? '感官增幅神经回路已永久固化为天生敏感体质'
      : entry.site === 'surface'
      ? '小腹活体淫纹与敏感带已永久烙印固化于肌肤表面'
      : `屁穴巨躯共生神经与${hadFuta ? '胯下扶她肉棒' : '高敏后庭构造'}已永久固化为自身肉体特征`;
    if (!target.physiology.includes(solidDesc)) {
      target.physiology = `${target.physiology ? target.physiology + '；' : ''}【寄生永久固化：${solidDesc}】`;
    }
    target.currentBody = target.originalBody;
    target.changeReason = `寄生解除·永久器官固化（${solidDesc}）`;
    target.hostingState = '本人意识主导（已将共生器官视为天生身体）';
    next.pendingActionNote = `【本轮异构终端操作：解除寄生 · 永久器官固化】已解除对「${target.name}」的寄生，但共生期间的特征（${solidDesc}）已永久固化为「${target.name}」自己的天生肉体特征！`;
  } else if (chosenBranch === '转化为皮躯存入衣柜') {
    const suitId = `parasite_skin_${target.id}`;
    const prevSkin = next.items.find(i => i.id === suitId);
    const boundVoice = clip(prevSkin?.voiceRole || next.itemVoiceBindings?.[suitId] || target.voiceRole || target.name, 4000);
    const item = normalizeCatalogItem({
      id: suitId,
      name: `${target.name}·寄生同化皮躯`,
      shortName: `${target.name}皮躯`,
      category: 'skin_suit',
      slot: 'skin_suit',
      price: 0,
      owned: true,
      source: 'fusion',
      sourceTargetName: target.name,
      voiceRole: boundVoice,
      imageData: prevSkin?.imageData || '',
      gender: target.gender || '扶她',
      appearance: target.appearance,
      bodyBuild: target.bodyBuild,
      physiology: target.physiology,
      summary: `由「${target.name}」深度寄生同化转化的完整人形活体皮躯（已存入衣柜）`,
      rawDesign: `<skin_suit_design name="${target.name}·寄生同化皮躯">\n[外观视觉还原]：${target.appearance}\n[体态参数]：${target.bodyBuild}\n[扶她生理构造]：${target.physiology}\n[穿戴接口与机能]：由内部寄生彻底同化生成的活体皮躯，背部脊椎隐形开口穿入，支持全脸覆面与露原貌。\n</skin_suit_design>`
    });
    if (boundVoice) next.itemVoiceBindings[suitId] = boundVoice;
    next.items = [item, ...next.items.filter(i => i.id !== suitId)];
    target.currentBody = `已转化为皮躯（${item.name}）`;
    target.changeReason = '寄生同化·转化为皮躯（已存入衣柜）';
    target.hostingState = '意识陷入永久无意识沉睡';
    next.pendingActionNote = `【本轮异构终端操作：寄生躯壳转化 · 皮躯化】由内彻底同化「${target.name}」的躯体，将其转化为一件完整的活体【皮躯】存入衣柜。`;
  } else if (chosenBranch === '凝缩为肉躯存入衣柜') {
    const ringId = `parasite_ring_${target.id}`;
    const prevRing = next.items.find(i => i.id === ringId);
    const boundVoice = clip(prevRing?.voiceRole || next.itemVoiceBindings?.[ringId] || target.voiceRole || target.name, 4000);
    const item = normalizeCatalogItem({
      id: ringId,
      name: `${target.name}·寄生凝缩肉躯环`,
      shortName: `${target.name}肉躯`,
      category: 'flesh_ring',
      slot: 'flesh_ring',
      price: 0,
      owned: true,
      source: 'fusion',
      sourceTargetName: target.name,
      voiceRole: boundVoice,
      imageData: prevRing?.imageData || '',
      gender: '扶她',
      ringAppearance: `由${target.name}被寄生躯体凝缩而成的温热活体肉环`,
      forwardExtension: `向前方增殖重构出完整扶她肉棒（承载${target.name}的生理特征）`,
      backwardExtension: `向后方全身蔓延包裹，重现「${target.name}」的外貌与体态（${target.appearance}；${target.bodyBuild}）`,
      appearance: target.appearance,
      bodyBuild: target.bodyBuild,
      physiology: target.physiology,
      summary: `由「${target.name}」深度寄生凝缩而成的活体肉躯环（已存入衣柜）`,
      rawDesign: `<flesh_ring_design name="${target.name}·寄生凝缩肉躯环">\n[静息环体外观]：由「${target.name}」凝缩而成的温热肉环。\n[前方延展·器官重构]：向前方延伸重构肉棒。\n[后方延展·躯体重构]：${target.appearance}；${target.bodyBuild}\n</flesh_ring_design>`
    });
    if (boundVoice) next.itemVoiceBindings[ringId] = boundVoice;
    next.items = [item, ...next.items.filter(i => i.id !== ringId)];
    target.currentBody = `已凝缩为肉躯环（${item.name}）`;
    target.changeReason = '寄生同化·凝缩为肉躯（已存入衣柜）';
    target.hostingState = '意识陷入永久无意识沉睡';
    next.pendingActionNote = `【本轮异构终端操作：寄生躯壳转化 · 肉躯化】将「${target.name}」的躯体凝缩为一枚环状活体道具【肉躯】存入衣柜。`;
  } else {
    const keepMem = chosenBranch.includes('保留');
    target.currentBody = target.originalBody;
    target.changeReason = `正常主导（寄生已剥离 · ${keepMem ? '保留共生记忆' : '认知合理化抹除'}）`;
    target.hostingState = '本人意识主导';
    if (!keepMem) {
      target.cognitionState.fakeMemory = '只觉得刚才身体一阵奇异的温热酥麻，仿佛做了一场逼真的春梦，一切已恢复正常';
      rebuildCognitionSummary(target.cognitionState);
    }
    next.pendingActionNote = `【本轮异构终端操作：解除寄生 · ${chosenBranch}】已从「${target.name}」身上剥离${isBody ? '本体化形寄生（主角在外界重新凝聚恢复人形原始本体）' : '分体寄生子体'}，「${target.name}」身体恢复原状（${keepMem ? '保留完整共生期间的记忆与余韵' : '自动触发认知合理化，将刚才的异样视为自然错觉'}）。`;
  }
  return next;
}

export function xenoStartVore(state, {predatorKey = '__protagonist__', preyName, channel = '口腔', location = '胃部'}) {
  const next = normalizeXeno(state);
  const predator = getEntity(next, predatorKey) || next.protagonist;
  const prey = ensureTarget(next, preyName);
  if (predator.name === prey.name) throw Error('不能吞噬自己');

  const entry = normalizeVoreEntry({
    preyName: prey.name,
    channel,
    location,
    status: VORE_STATUSES[0],
    digestion: VORE_DIGESTIONS[0]
  });
  predator.voreStorage = [entry, ...predator.voreStorage.filter(v => v.preyName !== prey.name)];
  if (channel === '异化捕食尾' && predator.predatorTail === 'none') {
    predator.predatorTail = 'deployed';
  }

  prey.currentBody = `${prey.originalBody}（位于${predator.name}的${entry.location}内）`;
  prey.changeReason = `被丸吞收纳中（经由${predator.name}的${entry.channel}吞入${entry.location}）`;
  prey.hostingState = `${entry.status} · ${entry.digestion}`;

  next.selectedTarget = prey.name;
  next.pendingActionNote = `【本轮异构终端操作：发动丸吞之术】「${predator.name}」通过【${entry.channel}】发动超维度吞噬，将「${prey.name}」强行吞入【${entry.location}】内收纳！腔道分泌浓稠粘液溶解其衣物保留滑腻肌肤，「${predator.name}」腹部被极度撑开并清晰浮现出「${prey.name}」在皮下挣扎的身体与拳脚印记。`;
  return next;
}

export function xenoUpdateVore(state, {predatorKey = '__protagonist__', entryId, patch = {}}) {
  const next = normalizeXeno(state);
  const predator = getEntity(next, predatorKey) || next.protagonist;
  const item = predator.voreStorage.find(v => v.id === entryId);
  if (!item) return next;
  if (patch.location && VORE_LOCATIONS.includes(patch.location)) item.location = patch.location;
  if (patch.status !== undefined) item.status = clip(patch.status, 120) || item.status;
  if (patch.digestion !== undefined) item.digestion = clip(patch.digestion, 120) || item.digestion;
  const prey = next.targets.find(t => t.name === item.preyName);
  if (prey) {
    prey.currentBody = `${prey.originalBody}（位于${predator.name}的${item.location}内）`;
    prey.hostingState = `${item.status} · ${item.digestion}`;
  }
  next.pendingActionNote = `【本轮异构终端操作：更新体内收纳状态】位于「${predator.name}」【${item.location}】内的「${item.preyName}」当前状态变为：「${item.status}」，消化进度：「${item.digestion}」。`;
  return next;
}

export function xenoRemoveVore(state, {predatorKey = '__protagonist__', entryId, mode = 'release'}) {
  const next = normalizeXeno(state);
  const predator = getEntity(next, predatorKey) || next.protagonist;
  const item = predator.voreStorage.find(v => v.id === entryId);
  if (!item) return next;
  predator.voreStorage = predator.voreStorage.filter(v => v.id !== entryId);
  const prey = next.targets.find(t => t.name === item.preyName);
  if (prey) {
    if (mode === 'digest') {
      prey.currentBody = '已被彻底消化吸收为养分';
      prey.changeReason = `被${predator.name}的${item.location}彻底消化吸收`;
      prey.hostingState = '已消融';
    } else {
      prey.currentBody = prey.originalBody;
      prey.changeReason = `从${predator.name}体内排出恢复自由`;
      prey.hostingState = '全身湿滑粘液，意识清醒';
    }
  }
  next.pendingActionNote = mode === 'digest'
    ? `【本轮异构终端操作：丸吞彻底消化】「${predator.name}」的【${item.location}】分泌消化液将「${item.preyName}」彻底分解吸收转化为自身养分。`
    : `【本轮异构终端操作：解除丸吞排出】「${predator.name}」将体内【${item.location}】收纳的「${item.preyName}」经由原通道排出体外。`;
  return next;
}

// ==================== 4. 肉体改造（针对肉体） & 5. 认知修改（针对角色本身） ====================

/** Resets Protagonist Status Bar (and active possession/fusion) to empty for starting a fresh chat. */
export function xenoResetProtagonist(state, {resetTargets = false} = {}) {
  const next = normalizeXeno(state);
  next.protagonist = normalizeEntity({}, true);
  next.protagonistCleared = true;
  if (next.cardKey && next.cardProtagonists) {
    delete next.cardProtagonists[next.cardKey];
  }
  next.possession.active = false;
  next.possession.targetName = '';
  next.possession.organSync = false;
  next.possession.insightReports = [];
  next.fusion.active = false;
  next.fusion.targetName = '';
  next.parasite = {active: false, bodyHost: null, scions: []};
  next.pendingActionNote = '';
  if (resetTargets) {
    next.targets = next.targets.map(t => normalizeEntity({id: t.id, name: t.name}, false));
    next.targetPool = [];
    next.possession.anchors = [];
  }
  return next;
}

export function xenoApplyBodyMod(state, {targetKey = '__protagonist__', patch = {}}) {
  const next = normalizeXeno(state);
  const entity = getEntity(next, targetKey) || next.protagonist;
  if (entity === next.protagonist && (patch.name || patch.identity || patch.gender || patch.appearance || patch.bodyBuild || patch.physiology)) {
    next.protagonistCleared = false;
  }
  if (patch.name !== undefined) entity.name = clip(patch.name, 80);
  if (patch.identity !== undefined) entity.identity = clip(patch.identity, 300);
  if (patch.gender !== undefined) entity.gender = GENDERS.includes(patch.gender) ? patch.gender : '';
  if (patch.appearance !== undefined) entity.appearance = clip(patch.appearance, 1000);
  if (patch.bodyBuild !== undefined) entity.bodyBuild = clip(patch.bodyBuild, 1000);
  if (patch.physiology !== undefined) entity.physiology = clip(patch.physiology, 1000);
  if (patch.originalBody !== undefined) entity.originalBody = clip(patch.originalBody, 160);
  if (patch.currentBody !== undefined) entity.currentBody = clip(patch.currentBody, 160);
  if (patch.voiceRole !== undefined) entity.voiceRole = clip(patch.voiceRole, 4000);
  if (patch.portraitData !== undefined) entity.portraitData = clip(patch.portraitData, 500000);
  if (patch.predatorTail && ['none', 'hidden', 'deployed'].includes(patch.predatorTail)) {
    entity.predatorTail = patch.predatorTail;
  }
  if (patch.orificeMods && typeof patch.orificeMods === 'object') {
    entity.orificeMods = normalizeOrificeMods({...entity.orificeMods, ...patch.orificeMods});
  }
  const onlyPortrait = Object.keys(patch).length > 0 && Object.keys(patch).every(k => k === 'portraitData');
  if (onlyPortrait) return next;
  // If protagonist is currently possessing this target's body, sync the physical body fields between target and protagonist
  if (next.possession.active && next.possession.targetName) {
    const possTarget = next.targets.find(t => t.name === next.possession.targetName);
    if (possTarget && entity === possTarget) {
      syncPossessionEntities(next, possTarget);
    } else if (possTarget && entity === next.protagonist) {
      if (patch.gender && GENDERS.includes(patch.gender)) possTarget.gender = patch.gender;
      if (patch.appearance !== undefined) possTarget.appearance = entity.appearance;
      if (patch.bodyBuild !== undefined) possTarget.bodyBuild = entity.bodyBuild;
      if (patch.physiology !== undefined) possTarget.physiology = entity.physiology;
      if (patch.voiceRole !== undefined) possTarget.voiceRole = entity.voiceRole;
      if (patch.predatorTail) possTarget.predatorTail = entity.predatorTail;
      if (patch.orificeMods) possTarget.orificeMods = normalizeOrificeMods(entity.orificeMods);
    }
  }
  const bodyLabel = entity.currentBody || entity.originalBody || `${entity.name || '主角'}的肉体`;
  next.pendingActionNote = `【本轮异构终端操作：肉体改造】已对「${bodyLabel}」执行物理肉体改造（性别：${entity.gender || '未定'}；体型：${entity.bodyBuild || '默认'}；生理：${entity.physiology || '默认'}${entity.predatorTail !== 'none' ? `；丸吞尾：${entity.predatorTail === 'deployed' ? '展开态' : '隐蔽态'}` : ''}）。`;
  return next;
}

export function xenoApplyCognitionMod(state, {targetKey, relationOverride, fakeMemory, addRule, toggleRuleId, removeRuleId}) {
  const next = normalizeXeno(state);
  const entity = getEntity(next, targetKey || next.cogModTarget || next.selectedTarget) || next.targets[0] || next.protagonist;
  const cog = entity.cognitionState;
  if (relationOverride !== undefined) cog.relationOverride = clip(relationOverride, 200);
  if (fakeMemory !== undefined) cog.fakeMemory = clip(fakeMemory, 600);
  if (addRule && clip(addRule, 400)) {
    cog.rules.unshift({id: crypto.randomUUID(), text: clip(addRule, 400), enabled: true});
  }
  if (toggleRuleId) {
    const r = cog.rules.find(x => x.id === toggleRuleId);
    if (r) r.enabled = !r.enabled;
  }
  if (removeRuleId) {
    cog.rules = cog.rules.filter(x => x.id !== removeRuleId);
  }
  rebuildCognitionSummary(cog);
  next.pendingActionNote = `【本轮异构终端操作：认知修改】已直接修改角色「${entity.name || '目标'}」本身的灵魂潜意识与认知状态（${cog.summary}）。`;
  return next;
}

// ==================== 5. 衣柜 & 购物商城 Operations ====================

export function xenoStockItem(state, raw = {}) {
  if (!raw || typeof raw !== 'object') throw Error('请选择商品分类');
  const hasBlock = Boolean(raw.rawText || (!String(raw.name || '').trim() && (raw.rawDesign || raw.drawPrompt)));
  const parsed = hasBlock ? parseItemTextBlock(raw.rawText || raw.rawDesign || raw.drawPrompt, {fallbackCategory: raw.category || 'apparel'}) : null;
  const input = parsed && Object.keys(parsed).length
    ? {...parsed, ...Object.fromEntries(Object.entries(raw).filter(([k, v]) => k !== 'rawText' && v !== undefined && v !== ''))}
    : raw;
  if (!['skin_suit', 'flesh_ring', 'apparel', 'consumable'].includes(input.category)) throw Error('请选择商品分类');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 160) throw Error('请填写 1–160 字的商品名称');
  const price = input.price;
  if (typeof price !== 'number' || !Number.isInteger(price) || price < 0 || price > 999999) throw Error('售价应为 0–999999 的整数');
  if (input.category === 'apparel' && !['outerwear', 'underwear', 'privacyCover', 'accessories'].includes(input.slot)) throw Error('请选择服饰槽位');
  if (input.category === 'consumable' && !['cognition', 'body', 'physiology'].includes(input.effectKind)) throw Error('请选择道具效果');
  const next = normalizeXeno(state), id = clip(input.id, 120) || 'restock_' + crypto.randomUUID();
  if (next.items.some(item => item.id === id)) throw Error('该商品编号已存在，请编辑原商品或使用新编号');
  if (next.items.length >= 200) throw Error('装备目录已满，请先清理单品');
  const item = normalizeCatalogItem({...input, id, source: 'restock', owned: false, listed: true,
    storyPurchaseId: '', storyCraftId: '', sourceTargetName: '',
    slot: input.category === 'apparel' ? input.slot : input.category,
    gender: GENDERS.includes(input.gender) ? input.gender : '', lowerBodyMode: input.lowerBodyMode === 'preserve' ? 'preserve' : 'replace'});
  next.items.unshift(item);
  next.pendingActionNote = `【商城手动上架】已将「${item.name}」按售价 ¥${item.price} 上架，尚未购买或穿戴。`;
  return next;
}

export function xenoRegisterItem(state, raw = {}) {
  if (!raw || typeof raw !== 'object') throw Error('请选择自制装备分类');
  const hasBlock = Boolean(raw.rawText || (!String(raw.name || '').trim() && (raw.rawDesign || raw.drawPrompt)));
  const parsed = hasBlock ? parseItemTextBlock(raw.rawText || raw.rawDesign || raw.drawPrompt, {fallbackCategory: raw.category || 'skin_suit'}) : null;
  const input = parsed && Object.keys(parsed).length
    ? {...parsed, ...Object.fromEntries(Object.entries(raw).filter(([k, v]) => k !== 'rawText' && v !== undefined && v !== ''))}
    : raw;
  if (!['skin_suit', 'flesh_ring', 'apparel'].includes(input.category)) throw Error('请选择自制装备分类');
  if (!String(input.name || '').trim() || String(input.name).length > 160) throw Error('请填写 1–160 字的装备名称');
  const next = normalizeXeno(state), id = clip(input.id, 120) || 'crafted_' + crypto.randomUUID();
  if (next.items.some(item => item.id === id)) throw Error('该装备编号已存在，请编辑原装备或使用新编号');
  if (next.items.length >= 200) throw Error('装备目录已满，请先清理单品');
  const item = normalizeCatalogItem({...input, id, source: 'crafted', owned: true, listed: false, price: 0,
    gender: GENDERS.includes(input.gender) ? input.gender : '', lowerBodyMode: input.lowerBodyMode === 'preserve' ? 'preserve' : 'replace'});
  next.items.unshift(item);
  next.pendingActionNote = `【衣柜登记】已将自制装备「${item.name}」收入衣柜，尚未穿戴。`;
  return next;
}

export function xenoEquipItem(state, {targetKey = '__protagonist__', itemId, mode = '', replace = false}) {
  const next = normalizeXeno(state);
  const entity = getEntity(next, targetKey);
  if (!entity) throw Error('找不到指定的穿戴者，请先确认目标角色');
  const item = next.items.find(i => i.id === itemId);
  if (!item) throw Error('找不到该单品');
  if (!item.owned) throw Error('这件单品还在【购物商城】里，请先购买入库后再穿戴');
  const occupant = itemOccupant(next, itemId);
  if (occupant) throw Error(`「${item.name}」已由「${occupant.entity.name || '主角'}」使用${occupant.layer ? `（第 ${occupant.layer} 层）` : ''}，请先脱下`);

  if (['skin_suit', 'flesh_ring'].includes(item.category)) {
    if (replace && entity.livingMount.layers.length) entity.livingMount.layers.pop();
    entity.livingMount.layers.push({
      itemId: item.id, kind: item.category, faceMode: mode === 'neck' ? 'neck' : 'full',
      extendMode: ['idle', 'forward', 'backward', 'both'].includes(mode) ? mode : item.category === 'flesh_ring' ? 'forward' : 'idle',
      organOut: true, voiceRole: clip(itemVoiceRef(next, item), 4000)
    });
    syncWearMount(entity.livingMount);
    next.pendingActionNote = `【本轮衣柜操作：${replace ? '更换最外层' : '叠加穿戴'}】「${entity.name || '主角'}」穿上【${item.name}】，位于第 ${entity.livingMount.layers.length} 层。当前穿戴：${resolveWear(next, entity).layerText}。请依照实际层次更新最终外观、头部与音色。`;
  } else if (item.category === 'apparel') {
    const slot = ['outerwear', 'underwear', 'privacyCover', 'accessories'].includes(item.slot) ? item.slot : 'outerwear';
    if (entity.statusLocks?.[slot]) throw Error('该衣物栏已锁定，请先到角色状态解锁');
    entity.outfit[slot] = `${item.name}（${item.summary}）`;
    entity.outfit[slot + 'ItemId'] = item.id;
    if (/风衣/.test(item.name) && (mode === 'open' || mode === 'cover')) {
      entity.outfit.coatPose = mode;
    }
    next.pendingActionNote = `【本轮衣柜操作：更换着装】「${entity.name || '主角'}」穿戴了【${item.name}】。`;
  }
  return next;
}

export function xenoUpdateMountOption(state, {targetKey = '__protagonist__', itemId = '', patch = {}}) {
  const next = normalizeXeno(state);
  const entity = getEntity(next, targetKey);
  if (!entity) throw Error('找不到指定的穿戴者');
  for (const field of ['outerwear', 'underwear', 'privacyCover', 'accessories']) {
    if (entity.statusLocks?.[field] && (patch[field] !== undefined || (field === 'outerwear' && patch.coatPose !== undefined))) throw Error('该衣物栏已锁定，请先到角色状态解锁');
  }
  const layers = entity.livingMount.layers;
  const skin = itemId ? layers.find(layer => layer.itemId === itemId && layer.kind === 'skin_suit') : layers.slice().reverse().find(layer => layer.kind === 'skin_suit');
  const ring = itemId ? layers.find(layer => layer.itemId === itemId && layer.kind === 'flesh_ring') : layers.slice().reverse().find(layer => layer.kind === 'flesh_ring');
  if (itemId && !layers.some(layer => layer.itemId === itemId)) throw Error('这件装备当前没有穿在该角色身上');
  if (skin) {
    if (patch.skinFaceMode) skin.faceMode = patch.skinFaceMode === 'neck' ? 'neck' : 'full';
    if (typeof patch.skinOrganOut === 'boolean') skin.organOut = patch.skinOrganOut;
  }
  if (ring) {
    if (['idle', 'forward', 'backward', 'both'].includes(patch.fleshExtendMode)) ring.extendMode = patch.fleshExtendMode;
    if (typeof patch.fleshForwardEnabled === 'boolean' || typeof patch.fleshBackwardEnabled === 'boolean') {
      ring.extendMode = extensionMode(
        typeof patch.fleshForwardEnabled === 'boolean' ? patch.fleshForwardEnabled : extensionEnabled(ring.extendMode, 'forward'),
        typeof patch.fleshBackwardEnabled === 'boolean' ? patch.fleshBackwardEnabled : extensionEnabled(ring.extendMode, 'backward')
      );
    }
    if (patch.fleshFaceMode) ring.faceMode = patch.fleshFaceMode === 'neck' ? 'neck' : 'full';
    if (typeof patch.organOut === 'boolean') ring.organOut = patch.organOut;
  }
  syncWearMount(entity.livingMount);
  if (patch.coatPose && ['cover', 'open'].includes(patch.coatPose)) {
    entity.outfit.coatPose = patch.coatPose;
  }
  if (patch.outerwear !== undefined) { entity.outfit.outerwear = clip(patch.outerwear, 500) || '无'; entity.outfit.outerwearItemId = ''; }
  if (patch.underwear !== undefined) { entity.outfit.underwear = clip(patch.underwear, 500) || '真空（无内衣）'; entity.outfit.underwearItemId = ''; }
  if (patch.privacyCover !== undefined) { entity.outfit.privacyCover = clip(patch.privacyCover, 500) || '无'; entity.outfit.privacyCoverItemId = ''; }
  if (patch.accessories !== undefined) { entity.outfit.accessories = clip(patch.accessories, 500) || '无'; entity.outfit.accessoriesItemId = ''; }
  syncWearMount(entity.livingMount);
  if (skin || ring) next.pendingActionNote = `【本轮衣柜操作：调整穿戴设置】当前层次：${resolveWear(next, entity).layerText}。头部来源：${resolveWear(next, entity).headSource}。`;
  return next;
}

export function xenoUnequipSlot(state, {targetKey = '__protagonist__', slot, itemId = ''}) {
  const next = normalizeXeno(state);
  const entity = getEntity(next, targetKey);
  if (!entity) throw Error('找不到指定的穿戴者');
  if (entity.statusLocks?.[slot]) throw Error('该衣物栏已锁定，请先到角色状态解锁');
  if (itemId || ['skin_suit', 'flesh_ring', 'outermost', 'all'].includes(slot)) {
    const layers = entity.livingMount.layers;
    const index = slot === 'all' ? 0 : itemId ? layers.findIndex(layer => layer.itemId === itemId)
      : slot === 'outermost' ? layers.length - 1 : layers.map(layer => layer.kind).lastIndexOf(slot);
    if (index < 0 || index >= layers.length) throw Error('没有找到要脱下的穿戴层');
    const removed = layers.splice(index);
    syncWearMount(entity.livingMount);
    next.pendingActionNote = `【本轮衣柜操作：从外向内脱卸】「${entity.name || '主角'}」依次脱下【${removed.slice().reverse().map(layer => next.items.find(item => item.id === layer.itemId)?.name || layer.itemId).join('、')}】，物品回到衣柜。剩余穿戴：${resolveWear(next, entity).layerText}。`;
  } else if (['outerwear', 'underwear', 'privacyCover', 'accessories'].includes(slot)) {
    entity.outfit[slot] = slot === 'underwear' ? '真空（未穿内衣裤）' : '无';
    entity.outfit[slot + 'ItemId'] = '';
    next.pendingActionNote = `【本轮衣柜操作：脱下衣物】「${entity.name}」脱下了${{outerwear: '外搭衣物', underwear: '内衣裤装', privacyCover: '隐私遮挡', accessories: '附加饰品'}[slot]}。`;
  }
  return next;
}

export function xenoUseConsumable(state, {targetKey = '__protagonist__', itemId}) {
  const next = normalizeXeno(state);
  const entity = getEntity(next, targetKey) || next.protagonist;
  const item = next.items.find(i => i.id === itemId);
  if (!item) throw Error('找不到该道具');
  if (item.effectKind === 'cognition') {
    entity.cognitionState.rules.unshift({
      id: crypto.randomUUID(),
      text: `【${item.shortName}生效】${item.summary}`,
      enabled: true
    });
    rebuildCognitionSummary(entity.cognitionState);
  } else if (item.effectKind === 'body') {
    entity.bodyBuild = `${entity.bodyBuild}；【${item.shortName}改造：乳量与蜜桃臀围暴涨，丰熟母马化曲线】`;
  } else {
    entity.physiology = `${entity.physiology}；【${item.shortName}生效：全身潮红敏感度暴增十倍，持续失禁泌蜜】`;
  }
  next.pendingActionNote = `【本轮异构道具使用】对「${entity.name}」使用了【${item.name}】：${item.summary}。`;
  return next;
}

/** Collects active生图提示词 (Prompt) from worn skin_suit / flesh_ring / apparel for a character. */
export function xenoDrawTagsFor(xeno, name) {
  if (!xeno?.enabled) return '';
  const entity = (!name || name === '__protagonist__' || name === '主角' || name === xeno.protagonist.name || name === 'me')
    ? xeno.protagonist
    : xeno.targets.find(t => t.name === name);
  if (!entity) return '';
  const tags = [];
  const items = xeno.items || [];
  const visible = wearDrawingTags(xeno, entity);
  if (visible) tags.push(visible);
  for (const slot of ['outerwear', 'underwear', 'privacyCover', 'accessories']) {
    const id = entity.outfit[slot + 'ItemId'];
    const app = id ? items.find(i => i.id === id) : null;
    if (!app) continue;
    if (slot === 'outerwear' && entity.outfit.coatPose === 'open' && app.drawPromptOpen) {
      tags.push(normalizeCharacterDrawPrompt(app.drawPromptOpen));
    } else if (app.drawPrompt) {
      tags.push(normalizeCharacterDrawPrompt(app.drawPrompt));
    }
  }
  return tags.filter(Boolean).join(', ');
}

/** Builds a full-body current-state portrait prompt (Danbooru tags + effective appearance/body/equipment/vore/alienation). */
export function buildEntityPortraitPrompt(xeno, entity) {
  const state = normalizeXeno(xeno);
  const e = normalizeEntity(entity, entity?.id === '__protagonist__');
  const view = effectiveEntityView(state, e, {forDrawing: true});
  const wear = resolveWear(state, e);
  const tags = [];

  const isFuta = view.gender === '扶她'
    || (state.possession?.active && state.possession.organSync && !(wear.lowerBodyMode === 'replace' && ['female', 'none'].includes(wear.lowerBodyType))
      && (e.id === '__protagonist__' || e.name === state.possession.targetName));
  if (view.gender === '男') tags.push('1boy, solo, full body, masterpiece, best quality');
  else tags.push('1girl, solo, full body, masterpiece, best quality');

  const equipTags = xenoDrawTagsFor(state, e.id === '__protagonist__' ? '__protagonist__' : e.name);
  if (equipTags) tags.push(equipTags);
  if (isFuta && !/\bfutanari\b/i.test(equipTags)) tags.push('futanari');

  if (wear.body && wear.head?.itemId !== wear.body.itemId) tags.push('retracted hood');
  if (e.voreStorage?.length > 0) {
    tags.push('distended belly, stomach bulge, vore, belly bulge, squirming bulge');
  }
  if (e.predatorTail === 'deployed') {
    tags.push('monster tail, thick biological tail, tail mouth');
  }
  const cleanDesc = s => String(s || '').replace(/【[^】]*】/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleanDesc(view.appearance)) tags.push(cleanDesc(view.appearance));
  if (cleanDesc(view.bodyBuild)) tags.push(cleanDesc(view.bodyBuild));
  if (!e.outfit.outerwearItemId && e.outfit.outerwear && e.outfit.outerwear !== '无') tags.push(e.outfit.outerwear);
  if (!e.outfit.underwearItemId && e.outfit.underwear && !/真空|无/.test(e.outfit.underwear)) tags.push(e.outfit.underwear);

  return {
    prompt: [...new Set(tags.map(t => String(t || '').trim()).filter(Boolean))].join(', '),
    summaryLabel: `${view.name || '角色'} · ${view.gender || '当前形态'}`
  };
}

// ==================== 6. SillyTavern Prompt Injection & Auto-Sync ====================

export function xenoPromptPlan(xeno, presetOverride = null, {chat = [], input = '', generationType = ''} = {}) {
  if (!xeno) return [];
  const locked = statusLockText(xeno, entity => effectiveEntityView(xeno, entity));
  const lockBlocks = locked ? [{key: 'sttts.entry.character-status-locks', text: locked, position: 1, depth: 0, role: 0}] : [];
  if (xeno.enabled === false) return lockBlocks;
  const state = normalizeXeno(xeno);
  const preset = presetOverride ? normalizeXenoPreset(presetOverride) : activeXenoPreset(state);
  const entryMap = new Map((preset.entries || []).map(e => [e.id, e]));
  const blocks = [...lockBlocks];
  let history = Array.isArray(chat) ? chat : [];
  if (['regenerate', 'swipe'].includes(generationType) && history.length && !history.at(-1)?.is_user) {
    history = history.slice(0, -1);
  }
  const scanMessages = [];
  for (let index = history.length - 1; index >= 0 && scanMessages.length < preset.scanDepth; index--) {
    const message = history[index];
    if (message && !message.is_system && typeof message.mes === 'string') scanMessages.push(message.mes);
  }
  const scanText = [...scanMessages, input].filter(text => typeof text === 'string').map(text => text
    .replace(/<(think|thinking|analysis|xeno_update|xeno_action|xeno_organs|script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, ' ')
    .replace(/<img\b(?![^>]*\bsrc\s*=)[^>]*>[^<]*(?:<\/img\s*>|$)/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .normalize('NFKC').toLowerCase()).join('\n');

  const carrierNote = {
    auto: '能力载体随当前故事世界观自动适配（现代/科幻为神秘手机App或异能，修仙为夺舍/合体功法，西幻为血肉灵魂秘术）。',
    app: '能力载体：主角手机中安装的神秘应用程序【异构终端】与【活体衣柜】。',
    cultivation: '能力载体：主角掌握的失传修仙禁术【夺舍融灵功法】与【活体法器】。',
    fantasy: '能力载体：主角掌握的古老禁忌魔法【血肉异构与灵魂支配秘术】。'
  }[state.worldCarrier] || '';

  // 1. Always inject the live Protagonist & Active Targets Status Overview (replacing TavernDB tables)
  const pView = effectiveEntityView(state, state.protagonist);
  const protNeedSync = !pView.appearance && !pView.bodyBuild && !pView.physiology;
  const statusLines = [
    '【异构终端 · 实时状态数据库（最高优先级事实基准，替代原数据库表）】',
    carrierNote,
    '',
    `■ 主角状态栏（${pView.name || '主角'}）：`,
    `- 姓名：${pView.name || '（跟随当前角色卡/用户设定）'} ｜ 身份：${pView.identity || '（跟随当前角色卡/用户设定）'} ｜ 当前显性性别：${pView.gender || '（跟随当前角色卡/用户设定）'}`,
    `- 外貌特征：${pView.appearance || '（待同步：请严格跟随当前角色卡、角色卡世界书、开场白与用户人设中的主角外观设定，并在本轮末尾 <xeno_update> 第一行补全主角状态栏）'}`,
    `- 体型身材：${pView.bodyBuild || '（待同步：请严格跟随当前角色卡与人设中的主角身高/体型/身材设定）'}`,
    `- 生理特征：${pView.physiology || '（待同步：请严格跟随当前角色卡与人设中的主角生理特征设定）'}`,
    `- 下体记录（JSON数据）：${organRecordText(state.protagonist, pView)}`,
    ...(protNeedSync ? ['- [主角外观同步指令] 当前主角外观尚未写入终端，请务必遵循当前角色卡与世界书对主角（{{user}}）的外观/身份/身材设定，并在本轮正文末尾 <xeno_update> 中第一行输出主角完整8项数据！'] : []),
    `- 头部：${pView.headSource} ｜ 外观：${pView.headAppearance} ｜ 音色：${pView.voiceStateText}`,
    `- 下体外观：${pView.organAppearance || '本体未记录'} ｜ 来源：${pView.organSource}`,
    ...(pView.equipmentAbilities ? [`- 装备能力及条件：${pView.equipmentAbilities}`] : []),
    `- [详情] 原始肉体：${pView.originalBody} ｜ 当前肉体：${pView.currentBody} ｜ 变更原因：${pView.changeReason}`,
    `- [详情] 本体托管状态：${pView.hostingState}`,
    `- [详情] 声带与音色：${pView.voiceStateText}`,
    `- [详情] 皮躯/肉躯挂载：${pView.livingMountText}`,
    ...(pView.extensionText ? [`- [详情] 有效延展设定：${pView.extensionText}`] : []),
    `- [详情] 四槽位着装：${pView.outfitText}`,
    `- [详情] 体内收纳：${pView.voreText}`,
    `- [详情] 认知状态：${pView.cognitionText}`
  ];

  if (state.targets.length) {
    statusLines.push('', '■ 登场目标状态栏：');
    for (const t of state.targets) {
      const tv = effectiveEntityView(state, t);
      statusLines.push(
        `● 目标【${tv.name}】（身份：${tv.identity} ｜ 性别：${tv.gender}）`,
        `  - 外貌特征：${tv.appearance}`,
        `  - 体型身材：${tv.bodyBuild}`,
        `  - 生理特征：${tv.physiology}`,
        `  - 下体记录（JSON数据）：${organRecordText(t, tv)}`,
        `  - 头部：${tv.headSource} ｜ 外观：${tv.headAppearance} ｜ 音色：${tv.voiceStateText}`,
        `  - 下体外观：${tv.organAppearance || '本体未记录'} ｜ 来源：${tv.organSource}`,
        ...(tv.equipmentAbilities ? [`  - 装备能力及条件：${tv.equipmentAbilities}`] : []),
        `  - [详情] 原始肉体：${tv.originalBody} ｜ 当前肉体：${tv.currentBody} ｜ 变更原因：${tv.changeReason} ｜ 托管/意识：${tv.hostingState}`,
        `  - [详情] 声带与音色：${tv.voiceStateText}`,
        `  - [详情] 皮躯/肉躯挂载：${tv.livingMountText}`,
        ...(tv.extensionText ? [`  - [详情] 有效延展设定：${tv.extensionText}`] : []),
        `  - [详情] 四槽位着装：${tv.outfitText}`,
        `  - [详情] 体内收纳：${tv.voreText}`,
        `  - [详情] 认知状态：${tv.cognitionText}`
      );
    }
  }

  // 2. On-demand rule injection: only include rules for active states/equipment to save tokens!
  const allEntities = [state.protagonist, ...state.targets];
  const wornSkinIds = new Set(allEntities.flatMap(e => wearLayers(e).filter(layer => layer.kind === 'skin_suit').map(layer => layer.itemId)));
  const wornRingIds = new Set(allEntities.flatMap(e => wearLayers(e).filter(layer => layer.kind === 'flesh_ring').map(layer => layer.itemId)));
  const wornApparelIds = new Set(
    allEntities.flatMap(e => ['outerwearItemId', 'underwearItemId', 'privacyCoverItemId', 'accessoriesItemId'].map(k => e.outfit[k])).filter(Boolean)
  );

  const isTriggered = id => {
    if (id === 'coreTerms') return true;
    if (id === 'possession') return state.possession.active || state.possession.anchors.length > 0;
    if (id === 'fusion') return state.fusion.active;
    if (id === 'parasite') return Boolean(state.parasite?.active || state.parasite?.bodyHost || state.parasite?.scions?.length);
    if (id === 'skinSuit') return wornSkinIds.size > 0;
    if (id === 'fleshRing') return wornRingIds.size > 0;
    if (id === 'vore') return allEntities.some(e => e.voreStorage.length > 0);
    if (id === 'alienation') return allEntities.some(e => e.predatorTail !== 'none' || ORIFICE_SLOTS.some(([k]) => e.orificeMods[k] !== '常态'));
    return false;
  };

  const activeRuleBlocks = [];
  for (const e of preset.entries || []) {
    if (e.enabled === false || !String(e.text || '').trim()) continue;
    if (e.id === 'autoSync' || e.scope === 'task' || e.scope === 'mall') continue;
    if (e.triggerMode === 'always' || isTriggered(e.id) || e.keywords.some(keyword => scanText.includes(keyword))) {
      activeRuleBlocks.push(String(e.text).trim());
    }
  }

  // Inject the exact XML design blocks (<skin_suit_design>, <flesh_ring_design>, <apparel_design>) only for currently worn items
  const designBlocks = [];
  for (const id of [...wornSkinIds, ...wornRingIds, ...wornApparelIds]) {
    const item = state.items.find(i => i.id === id);
    if (item?.rawDesign) designBlocks.push(`【当前穿戴单品设定：${item.name}】\n${item.rawDesign}`);
    if (item) designBlocks.push(`【装备结构字段：${item.name}】身体类型：${item.gender || '未设定'}；下体处理：${item.lowerBodyMode}；下体类型：${item.lowerBodyType}；下体设定：${item.lowerBodyDescription || '按身体类型'}。这些当前编辑字段优先于旧设计块中相冲突的描述。`);
  }
  if (wornSkinIds.size || wornRingIds.size || wornApparelIds.size) activeRuleBlocks.push('【装备能力】状态栏中列出的装备能力仅由实际穿戴装备提供，按各自生效条件使用，不永久写入角色本体。多层装备可各自提供能力，脱下或回退穿戴即停止提供该件能力；未满足条件不宣称生效，未登记的能力不凭空追加。女性装备的下体可覆盖为女性结构，不因穿戴者原本身体类型而自动追加男性部位；保留内层模式及旧版兼容模式按有效来源判定。肉躯前方延展按该件的下体类型重构，不固定为男性结构。');
  if (wornSkinIds.size || wornRingIds.size) activeRuleBlocks.push('【叠层外观判定】穿戴顺序由内到外。外层身体形态独立，不叠加内层体型；头部从外往内取仍覆面的有效层，音色跟随该头部。收起头部只露出下一层头部。独立部位外观按状态栏单独字段。下方完整设计用于记录各层来源，已被覆盖的内层外观不得混入最终形态或绘图。');
  if (wornRingIds.size) activeRuleBlocks.push('【肉躯开关与实际外观】前后延展独立且可同时开启。仅前方开启时提供独立部位外观，仅后方开启时提供身体覆盖；头部需后方开启且本层覆面，独立部位需前方开启且本层部位启用。关闭方向保留覆盖开关设置，但该方向的外观即时失效，改取内层或本体。正文与绘图以状态栏的有效来源为准。');

  if (state.pendingActionNote) {
    statusLines.push('', `⚡【本轮强制执行指令】\n${state.pendingActionNote}\n请在本次正文回复中直接体现上述状态变化与身体/意识反应！`);
  }

  if (state.autoUpdateTag) {
    const autoSyncEntry = entryMap.get('autoSync');
    const autoSyncText = autoSyncEntry
      ? (autoSyncEntry.enabled !== false ? String(autoSyncEntry.text || '').trim() : '')
      : XENO_PROMPT_DEFAULTS.autoSync;
    if (autoSyncText) {
      statusLines.push('', autoSyncText);
      const organSync = entryMap.get('organSyncGuidance');
      if (organSync?.enabled !== false && String(organSync?.text || '').trim()) statusLines.push('', organSync.text);
    }
  }

  const posCode = preset.injection?.position === 'in_prompt' ? 0 : preset.injection?.position === 'before_prompt' ? 2 : 1;
  const roleCode = preset.injection?.role === 'user' ? 1 : preset.injection?.role === 'assistant' ? 2 : 0;
  const rulesDepth = Number.isFinite(Number(preset.injection?.depth)) ? Number(preset.injection.depth) : 2;
  const statusDepth = Number.isFinite(Number(preset.statusDepth)) ? Number(preset.statusDepth) : 1;

  const rulesText = activeRuleBlocks.join('\n\n') + (designBlocks.length ? '\n\n' + designBlocks.join('\n\n') : '');
  if (rulesText.trim()) {
    blocks.push({
      key: 'sttts.entry.xeno-rules',
      text: rulesText,
      position: posCode,
      depth: rulesDepth,
      role: roleCode
    });
  }

  blocks.push({
    key: 'sttts.entry.xeno-status',
    text: statusLines.join('\n'),
    position: posCode,
    depth: statusDepth,
    role: roleCode
  });

  return blocks;
}

// Matches only the innermost paired <xeno_update>...</xeno_update> block, never spanning across another <xeno_update>, <think>, or <tts>
const XENO_UPDATE_RE = /<xeno_update\b[^>]*>((?:(?!<\/?(?:xeno_update|think|thinking|tts)\b)[\s\S])*?)<\/xeno_update\s*>/gi;
const THINK_BLOCK_RE = /<(?:think|thinking|analysis)\b[^>]*>[\s\S]*?<\/(?:think|thinking|analysis)\s*>/gi;

/** Strips `<xeno_update>...</xeno_update>` blocks from rendered/outgoing story text so the chat stays clean. */
export function stripXenoUpdate(text) {
  return String(text ?? '')
    .replace(/<xeno_organs\b[^>]*>[\s\S]*?(?:<\/xeno_organs\s*>|$)/gi, '')
    .replace(/<\/xeno_organs\s*>/gi, '')
    .replace(/<xeno_action\b[^>]*>[\s\S]*?(?:<\/xeno_action\s*>|$)/gi, '')
    .replace(/<\/xeno_action\s*>/gi, '')
    .replace(XENO_UPDATE_RE, '')
    .replace(/<\/?xeno_update\b[^>]*>/gi, '')
    .trimEnd();
}

/** Parses `<xeno_update>` blocks from a story reply and merges any new/updated character rows into `xeno`. */
export function applyXenoUpdateFromText(state, text, options = {}) {
  // Strip thinking chains and <tts> tags first so CoT mentions or dialogue lines are never parsed
  const source = String(text ?? '')
    .replace(THINK_BLOCK_RE, '')
    .replace(/<tts\b[^>]*>[\s\S]*?<\/tts\s*>/gi, '');
  const matches = options.lowerBodyOnly ? [] : [...source.matchAll(XENO_UPDATE_RE)];
  if (!matches.length && !/<xeno_organs\b/i.test(source)) return null;
  const next = normalizeXeno(state);
  const routes = Array.isArray(options?.routes) ? options.routes : [];
  const protNameHint = clip(options?.protagonistName, 80);
  const cardMembers = new Set((Array.isArray(options?.cardMembers) ? options.cardMembers : []).map(n => String(n || '').trim()).filter(Boolean));
  let changed = false;
  for (const m of matches) {
    const lines = String(m[1] || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (/<\/?tts\b|<\/?xeno_update\b|[<>“”"]/i.test(line)) continue;
      const parts = line.split(/[|｜]/).map(s => s.trim());
      if (parts.length < 6) continue;
      // Support both 8-column (姓名|身份|性别|...) and 9-column (角色类别(主角/目标)|姓名|身份|性别|...) formats
      let roleHint = '', rawName = '', identity = '', gender = '', appearance = '', bodyBuild = '', physiology = '', outerwear = '', underwear = '';
      if (parts.length >= 7 && !GENDERS.includes(parts[2]) && GENDERS.includes(parts[3])) {
        [roleHint, rawName, identity, gender, appearance, bodyBuild, physiology, outerwear = '', underwear = ''] = parts;
      } else {
        [rawName, identity, gender, appearance, bodyBuild, physiology, outerwear = '', underwear = ''] = parts;
      }
      let name = String(rawName || '').trim();
      let nameMarkedProt = false;
      const prefixMatch = name.match(/^(?:主角|男主角?|女主角?|使用者|玩家)[（(:：·\s]\s*([^）)]+?)\s*[）)]?$/);
      const suffixMatch = name.match(/^([^（(]+?)\s*[（(](?:主角|男主角?|女主角?|使用者|玩家|user)[）)]$/i);
      if (prefixMatch) {
        name = prefixMatch[1].trim();
        nameMarkedProt = true;
      } else if (suffixMatch) {
        name = suffixMatch[1].trim();
        nameMarkedProt = true;
      } else if (/^(?:主角|男主角?|女主角?|使用者|玩家|\{\{user\}\}|user|你|我)$/i.test(name)) {
        nameMarkedProt = true;
        name = next.protagonist.name || (protNameHint && protNameHint !== '主角' ? protNameHint : '主角');
      }
      if (!isValidRoleName(name) || name === '角色名' || name === '角色姓名' || name === '旁白') continue;
      if (!GENDERS.includes(gender)) continue;
      const matchedRoute = findRoute(routes, name);
      if (matchedRoute && roleTypeOf(matchedRoute) === 'narrator') continue;
      const identityMarksProt = /(?:^|[，、/\s（(])(?:男主角?|女主角?|主角本人|使用者|玩家角色)(?:$|[，、/\s）)])/.test(identity) && !cardMembers.has(name);
      const isProt = (matchedRoute && roleTypeOf(matchedRoute) === 'protagonist')
        || nameMarkedProt
        || /主角|男主|女主|使用者|user/i.test(roleHint)
        || identityMarksProt
        || name === next.protagonist.name
        || (protNameHint && name === protNameHint)
        || name === '主角';
      let ent = null;
      if (isProt) {
        ent = next.protagonist;
        next.protagonistCleared = false;
        if (name && name !== '主角') ent.name = clip(name, 80);
      } else {
        ent = ensureTarget(next, name);
      }
      if (!ent) continue;
      if (identity) ent.identity = clip(identity, 300);
      if (GENDERS.includes(gender)) ent.gender = gender;
      if (appearance) ent.appearance = clip(appearance, 1000);
      if (bodyBuild) ent.bodyBuild = clip(bodyBuild, 1000);
      if (physiology) ent.physiology = clip(physiology, 1000);
      if (outerwear) ent.outfit.outerwear = clip(outerwear, 500);
      if (underwear) ent.outfit.underwear = clip(underwear, 500);
      changed = true;
    }
  }
  changed = (!options.skipLowerBody && applyOrganUpdates(source, target => {
    const route = findRoute(routes, target);
    if (route && roleTypeOf(route) === 'narrator') return null;
    if (['主角', '__protagonist__', next.protagonist.name, protNameHint].filter(Boolean).includes(target)) return next.protagonist;
    return next.targets.find(entity => entity.id === target || entity.name === target);
  }, entity => effectiveEntityView(next, entity))) || changed;
  if (changed && next.cardKey && !next.protagonistCleared && (next.protagonist.name || next.protagonist.appearance || next.protagonist.bodyBuild || next.protagonist.physiology || next.protagonist.identity)) {
    next.cardProtagonists[next.cardKey] = cleanBaselineProtagonist(next.protagonist, next);
  }
  return changed ? normalizeXeno(next) : null;
}

/**
 * Extracts protagonist baseline attributes from the active SillyTavern Character Card, its embedded character_book,
 * the opening message (`chat[0].mes` or `first_mes`), the card's `protagonist` route in `角色` App, and `persona_description`.
 */
export function extractCardProtagonistProfile(ctx, routes = [], cardKey = '') {
  const list = Array.isArray(routes) ? routes : [];
  const protRoute = list.find(r => r?.name?.trim() && roleTypeOf(r) === 'protagonist');
  const userRaw = String(ctx?.name1 || '').trim();
  const userName = (!userRaw || /^(?:user|\{\{user\}\})$/i.test(userRaw)) ? '' : clip(userRaw, 80);
  const charCard = ctx?.characters?.[ctx?.characterId] || null;
  const cardName = String(charCard?.name || '').trim();

  const replaceMacros = s => String(s || '')
    .replaceAll('{{user}}', userName || '主角')
    .replaceAll('{{char}}', cardName || '角色')
    .replace(/<user>/gi, userName || '主角')
    .replace(/<char>/gi, cardName || '角色');

  // Gather protagonist-specific blocks from the Character Card's embedded worldbook (`character_book`)
  const bookEntries = charCard?.data?.character_book?.entries || charCard?.character_book?.entries || [];
  const entriesArray = Array.isArray(bookEntries) ? bookEntries : Object.values(bookEntries || {});
  const protBookBlocks = [];
  for (const entry of entriesArray) {
    if (!entry || entry.enabled === false || entry.disable === true) continue;
    const comment = String(entry.comment || entry.name || '').trim();
    const keys = Array.isArray(entry.keys || entry.key) ? (entry.keys || entry.key).join(' ') : String(entry.keys || entry.key || '');
    const content = replaceMacros(entry.content || '');
    if (!content.trim()) continue;
    const headerHit = /主角|男主|女主|使用者|玩家|user|人设/i.test(comment + ' ' + keys) || (userName && (comment.includes(userName) || keys.includes(userName)));
    if (headerHit && (!cardName || !comment.includes(cardName))) {
      protBookBlocks.push(content.slice(0, 2000));
    }
  }

  // Gather protagonist-specific sections from charCard.description / scenario / opening message
  const descText = replaceMacros([charCard?.description, charCard?.scenario].filter(Boolean).join('\n'));
  const openingText = replaceMacros(ctx?.chat?.[0]?.mes || charCard?.first_mes || '');
  const sectionRe = /(?:^|\n)\s*(?:[#*>-]+\s*|[\[【「『<]\s*)(?:主角|男主角?|女主角?|玩家|使用者|user|扮演角色)[^\]】」』>\n]*(?:[\]】」』>])?\s*[:：]?\s*\n([\s\S]{10,1200}?)(?=\n\s*(?:[#*]{1,4}\s+|[\[【「『<][^\]】」』>\n]{2,25}[\]】」』>]\s*(?:\n|$))|$)/gi;
  const cardSections = [];
  for (const m of descText.matchAll(sectionRe)) {
    if (m[1]?.trim()) cardSections.push(m[1].trim());
  }
  for (const m of openingText.matchAll(sectionRe)) {
    if (m[1]?.trim()) cardSections.push(m[1].trim());
  }

  const personaText = replaceMacros(ctx?.powerUserSettings?.persona_description || '').trim();
  const routePersona = replaceMacros(protRoute?.persona || '').trim();
  const routeAppearance = replaceMacros(protRoute?.appearance || '').trim();

  const combinedCardProtText = [...protBookBlocks, ...cardSections].join('\n').trim();
  const sourceText = [combinedCardProtText, routePersona, personaText].filter(Boolean).join('\n');

  const pickField = regex => {
    for (const block of [combinedCardProtText, routePersona, personaText]) {
      if (!block) continue;
      const m = block.match(regex);
      if (m?.[1]?.trim()) return m[1].trim().replace(/^[|:：\s]+|[|:：\s]+$/g, '');
    }
    return '';
  };

  const extractedName = pickField(/(?:^|\n)\s*[-*•]?\s*(?:主角姓名|姓名|名字|真名|角色名)\s*[:：]\s*([^\n｜|（(]{1,24})/i);
  const finalName = clip(
    (protRoute?.name && isValidRoleName(protRoute.name) ? protRoute.name : '')
    || (extractedName && isValidRoleName(extractedName) && extractedName !== cardName ? extractedName : '')
    || (userName && isValidRoleName(userName) && userName !== cardName ? userName : ''),
    80
  );

  let gender = '';
  const rawGender = pickField(/(?:^|\n)\s*[-*•]?\s*(?:性别|当前显性性别|肉体性别)\s*[:：]\s*([^\n｜|]{1,16})/i);
  if (/扶她|双性|futa/i.test(rawGender)) gender = '扶她';
  else if (/女|female|1girl|girl|woman/i.test(rawGender)) gender = '女';
  else if (/男|male|1boy|boy|man/i.test(rawGender)) gender = '男';
  else if (/扶她|futanari/i.test(combinedCardProtText || routeAppearance || personaText)) gender = '扶她';
  else if (/\b(?:1girl|female)\b|女主角|少女|女学生|美少女/i.test(combinedCardProtText || routeAppearance || personaText)) gender = '女';
  else if (/\b(?:1boy|male)\b|男主角|少年|青年|男学生/i.test(combinedCardProtText || routeAppearance || personaText)) gender = '男';

  const identity = clip(
    pickField(/(?:^|\n)\s*[-*•]?\s*(?:身份|职业|定位|头衔|背景身份)\s*[:：]\s*([^\n｜|]{1,120})/i)
    || (routePersona && routePersona.length <= 120 && !routePersona.includes('\n') ? routePersona : ''),
    300
  );

  let appearance = clip(
    pickField(/(?:^|\n)\s*[-*•]?\s*(?:外貌特征|外貌|外观|容貌|长相|面容|样貌|颜值)\s*[:：]\s*([^\n]{2,500})/i)
    || routeAppearance,
    1000
  );
  if (!appearance && combinedCardProtText && combinedCardProtText.length <= 360) {
    appearance = clip(combinedCardProtText.replace(/\s*\n+\s*/g, '；'), 1000);
  } else if (!appearance && personaText && personaText.length <= 360) {
    appearance = clip(personaText.replace(/\s*\n+\s*/g, '；'), 1000);
  }

  const bodyBuild = clip(
    pickField(/(?:^|\n)\s*[-*•]?\s*(?:体型身材|体型|身材|体态|三围|身高(?:体重)?)\s*[:：]\s*([^\n]{2,500})/i)
    || (sourceText.match(/(?:身高\s*\d{2,3}\s*(?:cm|厘米)[^。\n]*)/i)?.[1] || ''),
    1000
  );

  const physiology = clip(
    pickField(/(?:^|\n)\s*[-*•]?\s*(?:生理特征|生理构造|生理器官|生殖器官|生理|器官|体质|敏感带)\s*[:：]\s*([^\n]{2,500})/i),
    1000
  );

  const outerwear = clip(
    pickField(/(?:^|\n)\s*[-*•]?\s*(?:外搭衣物|外搭|日常着装|服装|衣着|穿搭|穿着)\s*[:：]\s*([^\n｜|]{1,200})/i),
    500
  );
  const underwear = clip(
    pickField(/(?:^|\n)\s*[-*•]?\s*(?:内衣裤装|内衣|贴身衣物)\s*[:：]\s*([^\n｜|]{1,200})/i),
    500
  );

  return {
    cardKey: clip(cardKey, 300),
    name: finalName,
    identity,
    gender,
    appearance,
    bodyBuild,
    physiology,
    outerwear,
    underwear
  };
}
