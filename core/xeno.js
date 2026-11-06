// Core state, status-bar engine, wardrobe/mall catalog logic, and SillyTavern prompt injection for RevoPhone's
// three new apps: 1. 异构终端 (xeno), 2. 衣柜 (wardrobe), 3. 购物商城 (mall).
// Replaces TavernDB with zero-latency local actions, on-demand rule injection, and automatic story state sync.

import {XENO_RULE_TEXTS, INITIAL_MALL_ITEMS} from './xeno-catalog.js';
import {roleTypeOf, isValidRoleName, findRoute} from './routes.js';
import {lineEffect} from './voice-fx.js';

export const GENDERS = Object.freeze(['男', '女', '扶她']);
export const POSSESSION_MODES = Object.freeze(['浅层共鸣', '意识共存', '完全占据', '认知覆盖']);
export const POSSESSION_WAYS = Object.freeze(['洞察推荐', '近距锁定', '灵体游离']);
export const FUSION_MODES = Object.freeze(['浅层融合', '共存融合', '完全融合', '认同融合']);
export const FUSION_BRANCHES = Object.freeze(['正常分离', '皮躯化', '肉躯化']);
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
  return {
    skinSuitId: clip(raw?.skinSuitId, 120),
    skinFaceMode: raw?.skinFaceMode === 'neck' ? 'neck' : 'full', // 'full' = 全脸覆面拟态, 'neck' = 收缩至颈部露原貌
    skinOrganOut: raw?.skinOrganOut !== false, // true = 充血释出, false = 收纳回阴蒂口
    fleshRingId: clip(raw?.fleshRingId, 120),
    fleshExtendMode: ['idle', 'forward', 'backward'].includes(raw?.fleshExtendMode) ? raw.fleshExtendMode : 'idle'
  };
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
  const isLegacyDefaultProt = isProtagonist
    && (!raw?.name || raw?.name === '主角')
    && (!raw?.appearance || raw?.appearance === '五官端正，眼神深邃')
    && (!raw?.bodyBuild || raw?.bodyBuild === '身高178cm，匀称挺拔');
  const name = cleanField(raw?.name, 80);
  const gender = isLegacyDefaultProt ? '' : (GENDERS.includes(raw?.gender) ? raw.gender : '');
  return {
    id: clip(raw?.id, 80) || (isProtagonist ? '__protagonist__' : crypto.randomUUID()),
    // === 常驻竖排 6 项（不含性格，默认留空） ===
    name,
    identity: cleanField(raw?.identity, 300),
    gender,
    appearance: cleanField(raw?.appearance, 1000),
    bodyBuild: cleanField(raw?.bodyBuild, 1000),
    physiology: cleanField(raw?.physiology, 1000),
    // === 点击【详情】展示的 8 项 ===
    originalBody: cleanField(raw?.originalBody, 160),
    currentBody: cleanField(raw?.currentBody, 160),
    changeReason: cleanField(raw?.changeReason, 200),
    hostingState: cleanField(raw?.hostingState, 200),
    livingMount: normalizeLivingMount(raw?.livingMount),
    outfit: normalizeOutfit(raw?.outfit),
    voreStorage: Array.isArray(raw?.voreStorage) ? raw.voreStorage.slice(0, 20).map(normalizeVoreEntry) : [],
    cognitionState: normalizeCognition(raw?.cognitionState),
    // === 肉体改造：丸吞尾 & 孔洞异化 ===
    predatorTail: ['none', 'hidden', 'deployed'].includes(raw?.predatorTail) ? raw.predatorTail : 'none',
    orificeMods: normalizeOrificeMods(raw?.orificeMods),
    // 当前肉体绑定的音色（可为角色名，或 pool:<engine>:<voice>:<name> 音色收藏夹引用）
    voiceRole: clip(raw?.voiceRole, 300),
    // Snapshot of original body parameters before possession/fusion so returning restores them cleanly
    baseSnapshot: raw?.baseSnapshot && typeof raw.baseSnapshot === 'object' ? {
      gender: GENDERS.includes(raw.baseSnapshot.gender) ? raw.baseSnapshot.gender : '',
      appearance: clip(raw.baseSnapshot.appearance, 1000),
      bodyBuild: clip(raw.baseSnapshot.bodyBuild, 1000),
      physiology: clip(raw.baseSnapshot.physiology, 1000),
      voiceRole: clip(raw.baseSnapshot.voiceRole, 300)
    } : null
  };
}

export function normalizeCatalogItem(raw = {}) {
  const category = ['skin_suit', 'flesh_ring', 'apparel', 'consumable'].includes(raw?.category) ? raw.category : 'apparel';
  const defaultSlot = category === 'skin_suit' ? 'skin_suit' : category === 'flesh_ring' ? 'flesh_ring' : category === 'consumable' ? 'consumable' : 'outerwear';
  const slot = ['skin_suit', 'flesh_ring', 'outerwear', 'underwear', 'privacyCover', 'accessories', 'consumable'].includes(raw?.slot) ? raw.slot : defaultSlot;
  const price = Number.isFinite(Number(raw?.price)) ? Math.max(0, Math.min(999999, Math.round(Number(raw.price)))) : 500;
  return {
    id: clip(raw?.id, 120) || ('item_' + crypto.randomUUID()),
    name: clip(raw?.name, 160) || '未命名单品',
    shortName: clip(raw?.shortName || raw?.name, 80) || '未命名',
    category,
    slot,
    price,
    owned: raw?.owned === true,
    source: ['shop', 'fusion', 'restock'].includes(raw?.source) ? raw.source : 'shop',
    sourceTargetName: clip(raw?.sourceTargetName, 80),
    voiceRole: clip(raw?.voiceRole || raw?.sourceTargetName, 300),
    effectKind: clip(raw?.effectKind, 40),
    gender: GENDERS.includes(raw?.gender) ? raw.gender : (category === 'skin_suit' || category === 'flesh_ring' ? '扶她' : ''),
    appearance: clip(raw?.appearance, 1000),
    bodyBuild: clip(raw?.bodyBuild, 1000),
    physiology: clip(raw?.physiology, 1000),
    ringAppearance: clip(raw?.ringAppearance, 800),
    forwardExtension: clip(raw?.forwardExtension, 1000),
    backwardExtension: clip(raw?.backwardExtension, 1000),
    summary: clip(raw?.summary, 400),
    drawPrompt: clip(raw?.drawPrompt, 1500),
    drawPromptOpen: clip(raw?.drawPromptOpen, 1500),
    rawDesign: clip(raw?.rawDesign, 6000),
    imageData: clip(raw?.imageData, 500000)
  };
}

export function defaultXeno() {
  return {
    enabled: true,
    autoUpdateTag: true,
    worldCarrier: 'auto',
    freeShop: false,
    selectedTarget: '',
    wardrobeTarget: '__protagonist__',
    bodyModTarget: '__protagonist__',
    cogModTarget: '',
    protagonistCleared: false,
    protagonist: normalizeEntity({}, true),
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
      reservedNote: '寄生之术模块预留位（待设定完成后启用）'
    },
    items: INITIAL_MALL_ITEMS.map(item => normalizeCatalogItem(structuredClone(item))),
    pendingActionNote: ''
  };
}

export function normalizeXeno(raw) {
  const base = defaultXeno();
  if (!raw || typeof raw !== 'object') return base;
  const existingItems = Array.isArray(raw.items) ? raw.items.map(normalizeCatalogItem) : [];
  const byId = new Map(existingItems.map(i => [i.id, i]));
  // Ensure all built-in catalog items exist while preserving their owned/edited state
  for (const builtin of INITIAL_MALL_ITEMS) {
    if (!byId.has(builtin.id)) existingItems.push(normalizeCatalogItem(structuredClone(builtin)));
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
  return {
    enabled: raw.enabled !== false,
    autoUpdateTag: raw.autoUpdateTag !== false,
    worldCarrier: WORLD_CARRIERS.some(([k]) => k === raw.worldCarrier) ? raw.worldCarrier : 'auto',
    freeShop: raw.freeShop === true,
    selectedTarget,
    wardrobeTarget: raw.wardrobeTarget === '__protagonist__' || targets.some(t => t.name === raw.wardrobeTarget) ? raw.wardrobeTarget : '__protagonist__',
    bodyModTarget,
    cogModTarget,
    protagonistCleared: raw.protagonistCleared === true,
    protagonist: normalizeEntity(raw.protagonist, true),
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
    parasite: {
      reservedNote: clip(raw.parasite?.reservedNote, 400) || base.parasite.reservedNote
    },
    items: existingItems.slice(0, 200),
    pendingActionNote: clip(raw.pendingActionNote, 1000)
  };
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
export function syncXenoWithRoutes(xeno, routes = []) {
  const out = normalizeXeno(xeno);
  const list = Array.isArray(routes) ? routes : [];
  const pool = new Map();
  for (const t of out.targetPool || []) pool.set(t.name, t);
  for (const t of out.targets || []) pool.set(t.name, t);

  const protRoute = list.find(r => r?.name?.trim() && roleTypeOf(r) === 'protagonist');
  if (protRoute && !out.protagonistCleared) {
    const pName = clip(protRoute.name, 80);
    const prevName = out.protagonist.name;
    const pooled = pool.get(pName);
    if (prevName !== pName && pooled) {
      out.protagonist = normalizeEntity({...pooled, ...out.protagonist, id: '__protagonist__', name: pName}, true);
    } else {
      out.protagonist.name = pName;
    }
    if (protRoute.persona?.trim() && !out.protagonist.identity) {
      out.protagonist.identity = clip(protRoute.persona, 300);
    }
    if (protRoute.appearance?.trim() && !out.protagonist.appearance) {
      out.protagonist.appearance = clip(protRoute.appearance, 1000);
    }
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
  return out;
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
    style: found?.style || '',
    gender: found?.gender || '',
    age: found?.age || ''
  };
}

/** Formats any `voiceRole` value (character name or `pool:...` favorite ref) into a human-readable label. */
export function formatVoiceRoleLabel(ref, voicePool = []) {
  const parsed = parsePoolVoiceRef(ref, voicePool);
  if (parsed) return `收藏音色·${parsed.name}`;
  return String(ref || '').trim();
}

/**
 * Resolves which role's voice should be used when `speakerName` speaks or thinks (`inner === true`):
 * 1. 附身之术 (Possession): 主角开口说话使用被附身目标 B 的音色；主角脑内心声 (inner) 使用主角自己的原音色。脱离附身后恢复。
 * 2. 肉体互换 (Body Swap): 双向互换后双方肉体音色永久对调；单向夺舍后主角永久使用目标 B 的音色。
 * 3. 融合之术 (Fusion): 融合期间开口说话使用目标 B 的音色；主角心声保留主角自己的原音色。
 * 4. 活体皮躯 (Skin Suit): 仅在「全脸覆面」(skinFaceMode === 'full') 时开口使用皮躯绑定的音色；「露原貌」(neck) 恢复本人当前肉体音色。
 * 5. 活体肉躯 (Flesh Ring): 仅在「后方全身延展」(fleshExtendMode === 'backward') 时开口使用肉躯绑定的音色；静息/前方延展保持本人当前肉体音色。
 * 6. 肉体改造 (Body Mod): 若肉体绑定了新建/指定的音色角色 (`entity.voiceRole`)，则使用该角色音色。
 */
export function resolveXenoVoiceRole(xeno, speakerName, {inner = false} = {}) {
  const rawName = String(speakerName ?? '').trim();
  if (!rawName || !xeno || xeno.enabled === false) return rawName;
  const isProt = (xeno.protagonist?.name && rawName === xeno.protagonist.name) || rawName === '主角';
  const actor = isProt ? xeno.protagonist : (xeno.targets || []).find(t => t.name === rawName);
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
  const items = xeno.items || [];
  const mounts = bodyEntity !== actor ? [actor.livingMount, bodyEntity.livingMount] : [bodyEntity.livingMount];
  for (const m of mounts) {
    if (!m) continue;
    if (m.skinSuitId && m.skinFaceMode === 'full') {
      const skin = items.find(i => i.id === m.skinSuitId);
      const skinVoice = clip(skin?.voiceRole || skin?.sourceTargetName, 300);
      if (skinVoice) return skinVoice;
    }
    if (m.fleshRingId && m.fleshExtendMode === 'backward') {
      const ring = items.find(i => i.id === m.fleshRingId);
      const ringVoice = clip(ring?.voiceRole || ring?.sourceTargetName, 300);
      if (ringVoice) return ringVoice;
    }
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
  const targetVoiceRole = resolveXenoVoiceRole(settings?.xeno, canonName, {inner});
  if (targetVoiceRole && targetVoiceRole !== canonName) {
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
        bindings: {
          ...(base.bindings || {}),
          [poolVoice.engine]: {
            ...(base.bindings?.[poolVoice.engine] || {}),
            voice: poolVoice.voice,
            model
          }
        },
        voiceSourceRole: `收藏音色·${poolVoice.name}`
      };
    }
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
  return direct;
}

/** Maps `settings.routes` so prompt language & reading rules follow each character's current spoken voice body. */
export function effectiveSpeakingRoutes(settings) {
  const routes = Array.isArray(settings?.routes) ? settings.routes : [];
  return routes.map(r => {
    if (!r?.name) return r;
    const targetVoiceRole = resolveXenoVoiceRole(settings?.xeno, r.name, {inner: false});
    if (targetVoiceRole && targetVoiceRole !== r.name) {
      const poolVoice = parsePoolVoiceRef(targetVoiceRole, settings?.voicePool);
      if (poolVoice) {
        const model = poolVoice.model || settings?.connections?.[poolVoice.engine]?.model || '';
        return {
          ...structuredClone(r),
          engine: poolVoice.engine,
          voice: poolVoice.voice,
          model,
          bindings: {
            ...(r.bindings || {}),
            [poolVoice.engine]: {
              ...(r.bindings?.[poolVoice.engine] || {}),
              voice: poolVoice.voice,
              model
            }
          },
          voiceSourceRole: `收藏音色·${poolVoice.name}`
        };
      }
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
    return r;
  });
}

/** Effective display of an entity's 6 core fields + 8 detail fields, accounting for worn 皮躯 / 肉躯! */
export function effectiveEntityView(xeno, entity) {
  const e = normalizeEntity(entity, entity?.id === '__protagonist__');
  const items = xeno.items || [];
  const skin = e.livingMount.skinSuitId ? items.find(i => i.id === e.livingMount.skinSuitId) : null;
  const ring = e.livingMount.fleshRingId ? items.find(i => i.id === e.livingMount.fleshRingId) : null;

  let gender = e.gender;
  let appearance = e.appearance;
  let bodyBuild = e.bodyBuild;
  let physiology = e.physiology;

  if (skin) {
    gender = skin.gender || gender;
    appearance = e.livingMount.skinFaceMode === 'full'
      ? `【皮躯全脸覆面：${skin.shortName}】${skin.appearance || e.appearance}`
      : `【皮躯露原貌：面部为${e.name}原貌，颈部以下为${skin.shortName}】${skin.appearance || e.appearance}`;
    if (skin.bodyBuild) bodyBuild = `【皮躯体态】${skin.bodyBuild}`;
    if (skin.physiology) {
      const organState = e.livingMount.skinOrganOut ? '扶她器官充血释出态' : '扶她器官收纳隐藏态';
      physiology = `【皮躯生理（${organState}）】${skin.physiology}`;
    }
  }
  if (ring) {
    if (e.livingMount.fleshExtendMode === 'backward') {
      // 后方延展：全身被新躯体包裹覆盖
      gender = ring.gender || '扶她';
      if (ring.appearance) appearance = `【肉躯后方全身延展：${ring.shortName}】${ring.appearance}`;
      if (ring.bodyBuild) bodyBuild = `【肉躯外躯体态】${ring.bodyBuild}`;
      if (ring.physiology) physiology = `【肉躯生理】${ring.physiology}`;
    } else if (e.livingMount.fleshExtendMode === 'forward') {
      // 前方延展：按数据库规则，女性通过肉躯拥有阴茎时基础性别仍保持原样（女），在生理与挂载状态中标注
      physiology = `${physiology}；【肉躯前方延展（${ring.shortName}）】：${ring.forwardExtension || ring.physiology}`;
    } else {
      physiology = `${physiology}；【肉躯静息佩戴（${ring.shortName}）】：根部扣合活体肉环`;
    }
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

  const skinText = skin
    ? `${skin.name}（${e.livingMount.skinFaceMode === 'full' ? '全脸覆面' : '褪至颈部露原貌'} · ${e.livingMount.skinOrganOut ? '器官释出' : '器官收纳'}）`
    : '未穿戴';
  const ringModeMap = {idle: '静息饰品形态', forward: '前方延展（肉棒重构）', backward: '后方延展（全身躯体重构）'};
  const ringText = ring
    ? `${ring.name}（${ringModeMap[e.livingMount.fleshExtendMode] || '静息'}）`
    : '未安装';

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
  } else if (skin && e.livingMount.skinFaceMode === 'neck') {
    voiceStateText = `皮躯露原貌：恢复【${spokenLabel || e.name || '本人'}】音色`;
  }

  return {
    // 6 core fields
    name: e.name,
    identity: e.identity,
    gender,
    appearance,
    bodyBuild,
    physiology,
    // 8 detail fields
    originalBody: e.originalBody,
    currentBody: e.currentBody,
    changeReason: e.changeReason,
    hostingState: e.hostingState,
    livingMountText: `皮躯：${skinText} ｜ 肉躯：${ringText}`,
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
      voiceRole: target.voiceRole || target.name,
      gender: target.gender,
      appearance: target.appearance,
      bodyBuild: target.bodyBuild,
      physiology: target.physiology,
      summary: `由「${target.name}」融合解除时皮躯化生成的完整人形活体皮躯（已存入衣柜，可穿戴或再次融合还原）`,
      rawDesign: `<skin_suit_design name="${target.name}·活体转化皮躯">\n[外观视觉还原]\n- 原型角色: ${target.name}（${target.identity}）\n- 外貌特征: ${target.appearance}\n[体态参数]\n- 体型身材: ${target.bodyBuild}\n- 生理构造: ${target.physiology}\n[活体穿戴机能]\n- 背部脊椎隐形开口穿入，无缝贴合，支持全脸覆面拟态或收缩至颈部露原貌，意识永久沉睡。\n</skin_suit_design>`
    });
    next.items = [item, ...next.items.filter(i => i.id !== suitId)];
    target.currentBody = `已转化为皮躯（${item.name}）`;
    target.changeReason = '融合解除·皮躯化（已存入衣柜）';
    target.hostingState = '意识陷入永久无意识沉睡（再次融合可还原）';
    next.pendingActionNote = `【本轮异构终端操作：融合解除·皮躯化】主角解除与「${target.name}」的融合，并将「${target.name}」的肉体转化为一件完整的活体【皮躯】存入衣柜，其原本意识陷入永久沉睡。`;
  } else if (chosenBranch === '肉躯化') {
    const ringId = `fusion_ring_${target.id}`;
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
      voiceRole: target.voiceRole || target.name,
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
    if (ent.livingMount.skinSuitId === itemId) ent.livingMount.skinSuitId = '';
    if (ent.livingMount.fleshRingId === itemId) ent.livingMount.fleshRingId = '';
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
  next.possession.active = false;
  next.possession.targetName = '';
  next.possession.organSync = false;
  next.possession.insightReports = [];
  next.fusion.active = false;
  next.fusion.targetName = '';
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
  if (patch.voiceRole !== undefined) entity.voiceRole = clip(patch.voiceRole, 300);
  if (patch.predatorTail && ['none', 'hidden', 'deployed'].includes(patch.predatorTail)) {
    entity.predatorTail = patch.predatorTail;
  }
  if (patch.orificeMods && typeof patch.orificeMods === 'object') {
    entity.orificeMods = normalizeOrificeMods({...entity.orificeMods, ...patch.orificeMods});
  }
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

export function xenoEquipItem(state, {targetKey = '__protagonist__', itemId, mode = ''}) {
  const next = normalizeXeno(state);
  const entity = getEntity(next, targetKey) || next.protagonist;
  const item = next.items.find(i => i.id === itemId);
  if (!item) throw Error('找不到该单品');
  if (!item.owned) throw Error('这件单品还在【购物商城】里，请先购买入库后再穿戴');

  if (item.category === 'skin_suit') {
    entity.livingMount.skinSuitId = item.id;
    if (mode === 'neck' || mode === 'full') entity.livingMount.skinFaceMode = mode;
    next.pendingActionNote = `【本轮衣柜操作：穿戴活体皮躯】「${entity.name}」从背部脊椎裂口穿入了【${item.name}】（${entity.livingMount.skinFaceMode === 'full' ? '活体组织向上蔓延覆盖全脸，完全拟态为皮躯容貌' : '头部组织收缩至颈部，露出原本面孔'}），建立双向神经感官直连。`;
  } else if (item.category === 'flesh_ring') {
    entity.livingMount.fleshRingId = item.id;
    entity.livingMount.fleshExtendMode = ['idle', 'forward', 'backward'].includes(mode) ? mode : 'forward';
    const modeDesc = {
      idle: '静息饰品形态（紧扣在阴茎口/阴蒂口上）',
      forward: `前方延展形态（向前方增殖重构出巨型肉棒：${item.forwardExtension}）`,
      backward: `后方延展形态（向后方全身蔓延包裹，彻底重构为：${item.backwardExtension}）`
    }[entity.livingMount.fleshExtendMode];
    next.pendingActionNote = `【本轮衣柜操作：佩戴活体肉躯】「${entity.name}」在阴茎口/阴蒂口扣合佩戴了【${item.name}】，当前意念延展形态为：${modeDesc}。`;
  } else if (item.category === 'apparel') {
    const slot = ['outerwear', 'underwear', 'privacyCover', 'accessories'].includes(item.slot) ? item.slot : 'outerwear';
    entity.outfit[slot] = `${item.name}（${item.summary}）`;
    entity.outfit[slot + 'ItemId'] = item.id;
    if (/风衣/.test(item.name) && (mode === 'open' || mode === 'cover')) {
      entity.outfit.coatPose = mode;
    }
    next.pendingActionNote = `【本轮衣柜操作：更换着装】「${entity.name}」穿戴了【${item.name}】。`;
  }
  return next;
}

export function xenoUpdateMountOption(state, {targetKey = '__protagonist__', patch = {}}) {
  const next = normalizeXeno(state);
  const entity = getEntity(next, targetKey) || next.protagonist;
  if (patch.skinFaceMode) entity.livingMount.skinFaceMode = patch.skinFaceMode === 'neck' ? 'neck' : 'full';
  if (typeof patch.skinOrganOut === 'boolean') entity.livingMount.skinOrganOut = patch.skinOrganOut;
  if (patch.fleshExtendMode && ['idle', 'forward', 'backward'].includes(patch.fleshExtendMode)) {
    entity.livingMount.fleshExtendMode = patch.fleshExtendMode;
  }
  if (patch.coatPose && ['cover', 'open'].includes(patch.coatPose)) {
    entity.outfit.coatPose = patch.coatPose;
  }
  if (patch.outerwear !== undefined) { entity.outfit.outerwear = clip(patch.outerwear, 500) || '无'; entity.outfit.outerwearItemId = ''; }
  if (patch.underwear !== undefined) { entity.outfit.underwear = clip(patch.underwear, 500) || '真空（无内衣）'; entity.outfit.underwearItemId = ''; }
  if (patch.privacyCover !== undefined) { entity.outfit.privacyCover = clip(patch.privacyCover, 500) || '无'; entity.outfit.privacyCoverItemId = ''; }
  if (patch.accessories !== undefined) { entity.outfit.accessories = clip(patch.accessories, 500) || '无'; entity.outfit.accessoriesItemId = ''; }
  return next;
}

export function xenoUnequipSlot(state, {targetKey = '__protagonist__', slot}) {
  const next = normalizeXeno(state);
  const entity = getEntity(next, targetKey) || next.protagonist;
  if (slot === 'skin_suit') {
    entity.livingMount.skinSuitId = '';
    next.pendingActionNote = `【本轮衣柜操作：脱卸皮躯】「${entity.name}」令背部脊椎接口裂开，从活体皮躯中脱出，恢复自身原本肉体。`;
  } else if (slot === 'flesh_ring') {
    entity.livingMount.fleshRingId = '';
    entity.livingMount.fleshExtendMode = 'idle';
    next.pendingActionNote = `【本轮衣柜操作：取下肉躯】「${entity.name}」令肉躯组织收缩回根部环体并取下肉躯环。`;
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
  const entity = (!name || name === xeno.protagonist.name || name === 'me')
    ? xeno.protagonist
    : xeno.targets.find(t => t.name === name);
  if (!entity) return '';
  const tags = [];
  const items = xeno.items || [];
  const skin = entity.livingMount.skinSuitId ? items.find(i => i.id === entity.livingMount.skinSuitId) : null;
  const ring = entity.livingMount.fleshRingId ? items.find(i => i.id === entity.livingMount.fleshRingId) : null;
  if (skin?.drawPrompt) tags.push(skin.drawPrompt);
  if (ring?.drawPrompt && entity.livingMount.fleshExtendMode !== 'idle') tags.push(ring.drawPrompt);
  for (const slot of ['outerwear', 'underwear', 'privacyCover', 'accessories']) {
    const id = entity.outfit[slot + 'ItemId'];
    const app = id ? items.find(i => i.id === id) : null;
    if (!app) continue;
    if (slot === 'outerwear' && entity.outfit.coatPose === 'open' && app.drawPromptOpen) {
      tags.push(app.drawPromptOpen);
    } else if (app.drawPrompt) {
      tags.push(app.drawPrompt);
    }
  }
  return tags.filter(Boolean).join(', ');
}

// ==================== 6. SillyTavern Prompt Injection & Auto-Sync ====================

export function xenoPromptPlan(xeno) {
  if (!xeno || xeno.enabled === false) return [];
  const state = normalizeXeno(xeno);
  const blocks = [];

  const carrierNote = {
    auto: '能力载体随当前故事世界观自动适配（现代/科幻为神秘手机App或异能，修仙为夺舍/合体功法，西幻为血肉灵魂秘术）。',
    app: '能力载体：主角手机中安装的神秘应用程序【异构终端】与【活体衣柜】。',
    cultivation: '能力载体：主角掌握的失传修仙禁术【夺舍融灵功法】与【活体法器】。',
    fantasy: '能力载体：主角掌握的古老禁忌魔法【血肉异构与灵魂支配秘术】。'
  }[state.worldCarrier] || '';

  // 1. Always inject the live Protagonist & Active Targets Status Overview (replacing TavernDB tables)
  const pView = effectiveEntityView(state, state.protagonist);
  const statusLines = [
    '【异构终端 · 实时状态数据库（最高优先级事实基准，替代原数据库表）】',
    carrierNote,
    '',
    `■ 主角状态栏（${pView.name}）：`,
    `- 姓名：${pView.name} ｜ 身份：${pView.identity} ｜ 当前显性性别：${pView.gender}`,
    `- 外貌特征：${pView.appearance}`,
    `- 体型身材：${pView.bodyBuild}`,
    `- 生理特征：${pView.physiology}`,
    `- [详情] 原始肉体：${pView.originalBody} ｜ 当前肉体：${pView.currentBody} ｜ 变更原因：${pView.changeReason}`,
    `- [详情] 本体托管状态：${pView.hostingState}`,
    `- [详情] 声带与音色：${pView.voiceStateText}`,
    `- [详情] 皮躯/肉躯挂载：${pView.livingMountText}`,
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
        `  - [详情] 原始肉体：${tv.originalBody} ｜ 当前肉体：${tv.currentBody} ｜ 变更原因：${tv.changeReason} ｜ 托管/意识：${tv.hostingState}`,
        `  - [详情] 声带与音色：${tv.voiceStateText}`,
        `  - [详情] 皮躯/肉躯挂载：${tv.livingMountText}`,
        `  - [详情] 四槽位着装：${tv.outfitText}`,
        `  - [详情] 体内收纳：${tv.voreText}`,
        `  - [详情] 认知状态：${tv.cognitionText}`
      );
    }
  }

  // 2. On-demand rule injection: only include rules for active states/equipment to save tokens!
  const activeRuleBlocks = [XENO_RULE_TEXTS.coreTerms];
  if (state.possession.active || state.possession.anchors.length) {
    activeRuleBlocks.push(XENO_RULE_TEXTS.possession);
  }
  if (state.fusion.active) {
    activeRuleBlocks.push(XENO_RULE_TEXTS.fusion);
  }

  const allEntities = [state.protagonist, ...state.targets];
  const wornSkinIds = new Set(allEntities.map(e => e.livingMount.skinSuitId).filter(Boolean));
  const wornRingIds = new Set(allEntities.map(e => e.livingMount.fleshRingId).filter(Boolean));
  const wornApparelIds = new Set(
    allEntities.flatMap(e => ['outerwearItemId', 'underwearItemId', 'privacyCoverItemId', 'accessoriesItemId'].map(k => e.outfit[k])).filter(Boolean)
  );

  if (wornSkinIds.size) activeRuleBlocks.push(XENO_RULE_TEXTS.skinSuit);
  if (wornRingIds.size) activeRuleBlocks.push(XENO_RULE_TEXTS.fleshRing);
  if (allEntities.some(e => e.voreStorage.length > 0)) activeRuleBlocks.push(XENO_RULE_TEXTS.vore);
  if (allEntities.some(e => e.predatorTail !== 'none' || ORIFICE_SLOTS.some(([k]) => e.orificeMods[k] !== '常态'))) {
    activeRuleBlocks.push(XENO_RULE_TEXTS.alienation);
  }

  // Inject the exact XML design blocks (<skin_suit_design>, <flesh_ring_design>, <apparel_design>) only for currently worn items
  const designBlocks = [];
  for (const id of [...wornSkinIds, ...wornRingIds, ...wornApparelIds]) {
    const item = state.items.find(i => i.id === id);
    if (item?.rawDesign) designBlocks.push(`【当前穿戴单品设定：${item.name}】\n${item.rawDesign}`);
  }

  if (state.pendingActionNote) {
    statusLines.push('', `⚡【本轮强制执行指令】\n${state.pendingActionNote}\n请在本次正文回复中直接体现上述状态变化与身体/意识反应！`);
  }

  if (state.autoUpdateTag) {
    statusLines.push(
      '',
      '【状态自动同步协议】',
      '1. 当且仅当本轮剧情中【已登记的目标角色或主角】发生换装/爆衣或身体特征变化时，在最终正文彻底结束后的最末尾输出一次完整闭合的状态块：<xeno_update>姓名|身份|性别(男/女/扶她)|外貌特征|体型身材|生理特征|外搭衣物|内衣裤装</xeno_update>（若有多名已登记角色变化则一行一人，每行固定8列）。',
      '2. 思考过程/思维链中在心里核对即可，严禁在思维链内预演或写出 xeno_update 标签字样，严禁产生半截未闭合标签，也严禁将 tts 台词写进状态块内。'
    );
  }

  blocks.push({
    key: 'sttts.entry.xeno-rules',
    text: activeRuleBlocks.join('\n\n') + (designBlocks.length ? '\n\n' + designBlocks.join('\n\n') : ''),
    position: 1,
    depth: 2,
    role: 0
  });

  blocks.push({
    key: 'sttts.entry.xeno-status',
    text: statusLines.join('\n'),
    position: 1,
    depth: 1,
    role: 0
  });

  return blocks;
}

// Matches only the innermost paired <xeno_update>...</xeno_update> block, never spanning across another <xeno_update>, <think>, or <tts>
const XENO_UPDATE_RE = /<xeno_update\b[^>]*>((?:(?!<\/?(?:xeno_update|think|thinking|tts)\b)[\s\S])*?)<\/xeno_update\s*>/gi;
const THINK_BLOCK_RE = /<(?:think|thinking)\b[^>]*>[\s\S]*?<\/(?:think|thinking)\s*>/gi;

/** Strips `<xeno_update>...</xeno_update>` blocks from rendered/outgoing story text so the chat stays clean. */
export function stripXenoUpdate(text) {
  return String(text ?? '')
    .replace(XENO_UPDATE_RE, '')
    .replace(/<\/?xeno_update\b[^>]*>/gi, '')
    .trimEnd();
}

/** Parses `<xeno_update>` blocks from a story reply and merges any new/updated character rows into `xeno`. */
export function applyXenoUpdateFromText(state, text) {
  // Strip thinking chains and <tts> tags first so CoT mentions or dialogue lines are never parsed
  const source = String(text ?? '')
    .replace(THINK_BLOCK_RE, '')
    .replace(/<tts\b[^>]*>[\s\S]*?<\/tts\s*>/gi, '');
  const matches = [...source.matchAll(XENO_UPDATE_RE)];
  if (!matches.length) return null;
  const next = normalizeXeno(state);
  let changed = false;
  for (const m of matches) {
    const lines = String(m[1] || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (/<\/?tts\b|<\/?xeno_update\b|[<>“”"]/i.test(line)) continue;
      const parts = line.split(/[|｜]/).map(s => s.trim());
      if (parts.length < 6) continue;
      const [name, identity, gender, appearance, bodyBuild, physiology, outerwear, underwear] = parts;
      if (!isValidRoleName(name) || name === '角色名' || name === '角色姓名' || name === '旁白') continue;
      if (!GENDERS.includes(gender)) continue;
      const isProt = name === next.protagonist.name || name === '主角';
      const ent = isProt ? next.protagonist : next.targets.find(t => t.name === name);
      if (!ent) continue;
      if (isProt) next.protagonistCleared = false;
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
  return changed ? next : null;
}
