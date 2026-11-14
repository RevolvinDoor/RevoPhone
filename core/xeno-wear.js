const text = (value, limit = 120) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const kinds = ['skin_suit', 'flesh_ring'];
const last = (list, predicate) => list.slice().reverse().find(predicate);
const facial = /(?:hair|eyes?|eyebrows?|eyelashes?|face|facial|head|ears?|horns?|bangs|braid|ponytail|pigtails|beard|lipstick|lips|makeup|mouth|teeth|fangs|头发|发色|瞳|眼睛|脸|面容|面貌|耳朵|[黑白红蓝绿金银紫粉棕灰长短]发)/i;
const FUTA_TAG_RE = /^(?:[\d.]*::)?(?:\d*futanari|futa|hermaphrodite|futanari\s+female|female\s+futanari|扶她)(?:::)?$/i;
const PENIS_TAG_RE = /(?:^|[\s(::])(?:\d*futanari\s+penis|penis|penises|phallus|dick|cock|erect|erection|flaccid|glans|foreskin|phimosis|testicles?|scrotum|precum|pre-cum|semen|ejaculation|urethra|urethral|veiny\s+shaft|thick\s+shaft|veins\s+on\s+penis|crotch\s+bulge|pelvic\s+bulge|groin\s+bulge)(?:$|[\s)::'])|^(?:[\d.]*::)?(?:bulge|veins|prominent\s+veins|thick\s+veins|veiny|dripping\s+pre-?cum|excessive\s+semen)(?:::)?$|(?:肉棒|阴茎|阳具|巨根|龟头|冠状沟|马眼|阴囊|睾丸|玉囊|包皮|勃起|前列腺液)/i;

/** Equipment and current-form prompts omit generic quality tags. */
export function stripQualityDrawTags(value) {
  return String(value || '').split(/[,，\n]+/).map(part => part.trim()).filter(part => {
    const tag = part.replace(/[{}\[\]()]|[\\]/g, '').replace(/^[\d.]+::|::$|:[\d.]+$/g, '').trim();
    return tag && !/^(?:masterpiece|(?:best|high|highest|great|amazing|perfect|excellent) quality|(?:very |highly detailed )?aesthetic|absurdres|highres|(?:ultra[- ]?|highly |hyper )detailed|[248]k)$/i.test(tag);
  }).join(', ');
}

export function normalizeCosplayCharacter(value) {
  return String(value || '').replace(/\\([()])/g, '$1').replace(/_/g, ' ')
    .replace(/\s*\(cosplay\)\s*$/i, '').replace(/[,，\n]/g, ' ').trim().slice(0, 160);
}

export function isFutanariTag(tag) {
  return FUTA_TAG_RE.test(String(tag || '').trim());
}

export function isPenisDrawTag(tag) {
  const s = String(tag || '').trim();
  return Boolean(s) && (FUTA_TAG_RE.test(s) || PENIS_TAG_RE.test(s));
}

/** Apply a validated current state after combining stored prompts and style tags. */
export function applyLowerBodyDrawState(value, state = '') {
  const target = ({勃起: 'erect', 疲软: 'flaccid', 缩回: 'female', 无: 'female'})[state];
  const key = tag => tag.replace(/[{}\[\]]/g, '').replace(/^-?[\d.]+::|::$/g, '').trim();
  const parts = stripQualityDrawTags(value).split(',').map(t => t.trim().replace(/\berection\b/gi, 'erect')).filter(Boolean);
  const kept = !target ? parts : parts.filter(tag => {
    const plain = key(tag);
    return !/\b(?:erect|flaccid)\b/i.test(plain) && plain.toLowerCase() !== 'female'
      && (target !== 'female' || !isPenisDrawTag(plain));
  });
  return [...new Set([...kept, ...(target ? [target] : [])])].join(', ');
}

function itemFanworkFields(value, category) {
  if (!kinds.includes(category)) return {fanwork: false, cosplayCharacter: ''};
  const embedded = String(value.drawPrompt || '').replace(/\\([()])/g, '$1').split(/[,，\n]+/)
    .map(tag => tag.trim().match(/^(?:[\d.]+::)?[{\[]*(.+?)\s*\(cosplay\)[}\]]*(?:::)?$/i)?.[1]).find(Boolean);
  const character = normalizeCosplayCharacter(value.cosplayCharacter || embedded || '');
  const flag = typeof value.fanwork === 'boolean' ? value.fanwork
    : /^(?:true|yes|1|是|同人|勾选)$/i.test(String(value.fanwork || '').trim()) ? true
      : /^(?:false|no|0|否|非同人|原创|不勾选)$/i.test(String(value.fanwork || '').trim()) ? false : undefined;
  return {...(flag !== undefined ? {fanwork: flag} : character ? {fanwork: true} : {}),
    ...(character ? {cosplayCharacter: character} : {})};
}

/** Normalizes character/body drawing prompt: NEVER includes `futanari` tag. */
export function normalizeCharacterDrawPrompt(value, {stripPenis = false} = {}) {
  const rawParts = stripQualityDrawTags(String(value || '')
    .replace(/^\(([^()]*)\)$/, '$1').replace(/^[（\[【]([\s\S]*)[）\]】]$/, '$1'))
    .split(/[,，]+/)
    .map(part => part.trim())
    .filter(Boolean);
  const out = [];
  for (const part of rawParts) {
    if (FUTA_TAG_RE.test(part)) continue;
    if (stripPenis && isPenisDrawTag(part)) continue;
    const cleaned = part.replace(/\b(?:\d*futanari|futa)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    if (!cleaned || FUTA_TAG_RE.test(cleaned)) continue;
    if (stripPenis && isPenisDrawTag(cleaned)) continue;
    if (!out.includes(cleaned)) out.push(cleaned);
  }
  return out.join(', ');
}

/** Normalizes penis/organ drawing prompt: ALWAYS fixes `futanari` tag at the front when non-empty. */
export function normalizeOrganDrawPrompt(value) {
  const rawParts = stripQualityDrawTags(String(value || '')
    .replace(/^\(([^()]*)\)$/, '$1').replace(/^[（\[【]([\s\S]*)[）\]】]$/, '$1'))
    .split(/[,，\n]+/)
    .map(part => part.trim())
    .filter(Boolean);
  if (!rawParts.length) return '';
  const rest = [];
  for (const part of rawParts) {
    if (FUTA_TAG_RE.test(part)) continue;
    if (!rest.includes(part)) rest.push(part);
  }
  return ['futanari', ...rest].join(', ');
}

/**
 * Separates character prompt (`drawPrompt`, never containing `futanari`) and penis prompt
 * (`organDrawPrompt`, always fixing `futanari` when present).
 */
export function splitItemDrawPrompts(rawDrawPrompt = '', rawOrganDrawPrompt = '', {category = 'apparel', gender = '', lowerBodyType = 'auto'} = {}) {
  if (rawDrawPrompt && typeof rawDrawPrompt === 'object' && !Array.isArray(rawDrawPrompt)) {
    const obj = rawDrawPrompt;
    return splitItemDrawPrompts(obj.drawPrompt ?? '', obj.organDrawPrompt ?? '', {
      category: obj.category || 'apparel',
      gender: obj.gender || '',
      lowerBodyType: obj.lowerBodyType || 'auto'
    });
  }
  let charInput = String(rawDrawPrompt ?? '').trim();
  let organInput = String(rawOrganDrawPrompt ?? '').trim();

  // Support inline markers inside a single prompt field (e.g. "角色提示词：... 肉棒提示词：...")
  const inlineSplit = charInput.match(/^(?:[\s\S]*?(?:角色(?:生图)?提示词|主体(?:生图)?提示词|后方延展(?:生图)?提示词|character\s*prompt)\s*[:：]\s*)?([\s\S]*?)\s*(?:[\[【]?\s*(?:肉棒(?:生图)?提示词|器官(?:生图)?提示词|阳具(?:生图)?提示词|前方延展(?:生图)?提示词|penis\s*prompt|organ\s*prompt)\s*[\]】]?\s*[:：])\s*([\s\S]*)$/i);
  if (inlineSplit) {
    charInput = inlineSplit[1].trim();
    organInput = [organInput, inlineSplit[2].trim()].filter(Boolean).join(', ');
  } else {
    charInput = charInput.replace(/^\s*[\[【]?\s*(?:角色(?:生图)?提示词|主体(?:生图)?提示词|后方延展(?:生图)?提示词|生图提示词|character\s*prompt|prompt)\s*(?:\([^)]*\))?\s*[\]】]?\s*[:：]?\s*/i, '').trim();
  }
  organInput = organInput.replace(/^\s*[\[【]?\s*(?:肉棒(?:生图)?提示词|器官(?:生图)?提示词|阳具(?:生图)?提示词|前方延展(?:生图)?提示词|penis\s*prompt|organ\s*prompt)\s*(?:\([^)]*\))?\s*[\]】]?\s*[:：]?\s*/i, '').trim();

  const effectiveLower = lowerBodyType && lowerBodyType !== 'auto'
    ? lowerBodyType
    : ({女: 'female', 男: 'male', 扶她: 'dual'})[gender] || (category === 'skin_suit' || category === 'flesh_ring' ? 'dual' : '');
  const isFemaleOrNone = ['female', 'none'].includes(effectiveLower);
  const isLiving = category === 'skin_suit' || category === 'flesh_ring';

  const rawTokens = charInput
    .replace(/^\(([^()]*)\)$/, '$1').replace(/^[（\[【]([\s\S]*)[）\]】]$/, '$1')
    .split(/[,，]+/)
    .map(part => part.trim())
    .filter(Boolean);
  const hadFuta = rawTokens.some(part => FUTA_TAG_RE.test(part) || /\b(?:\d*futanari|futa)\b/i.test(part));
  const shouldExtractPenis = isLiving || Boolean(organInput) || hadFuta || isFemaleOrNone;
  const extractedPenis = shouldExtractPenis
    ? rawTokens.filter(part => !FUTA_TAG_RE.test(part) && isPenisDrawTag(part))
    : [];
  const drawPrompt = normalizeCharacterDrawPrompt(charInput, {stripPenis: shouldExtractPenis});

  let organDrawPrompt = '';
  if (organInput) {
    const merged = isFemaleOrNone ? organInput : [organInput, ...extractedPenis].filter(Boolean).join(', ');
    organDrawPrompt = normalizeOrganDrawPrompt(merged);
  } else if (!isFemaleOrNone && (extractedPenis.length > 0 || (isLiving && hadFuta))) {
    organDrawPrompt = normalizeOrganDrawPrompt(extractedPenis.length ? extractedPenis.join(', ') : 'futanari');
  }
  return {drawPrompt, organDrawPrompt};
}

const FIELD_LABEL_RULES = [
  ['fanwork', /^(?:同人(?:卡|角色|皮躯|肉躯|商品)?|是否同人(?:卡|角色)?|fanwork|is\s*fanwork)$/i],
  ['cosplayCharacter', /^(?:同人角色\s*Tag|同人(?:角色)?英文\s*Tag|角色英文\s*Tag|同人角色标签|cosplay\s*character|cosplaycharacter|character\s*tag)$/i],
  ['name', /^(?:商品名称|装备名称|单品名称|名称|品名|名字|标题|name|title)$/i],
  ['shortName', /^(?:商品简称|装备简称|单品简称|简称|短名称|别名|short\s*name|shortname|alias)$/i],
  ['category', /^(?:商品分类|装备分类|进货大类|大类|分类|类别|category)$/i],
  ['slot', /^(?:服饰穿戴槽位|服饰槽位|穿戴槽位|槽位|穿戴部位|部位|slot)$/i],
  ['price', /^(?:商店售价|商品售价|售价|价格|定价|price)$/i],
  ['gender', /^(?:身体类型|当前显性性别|显性性别|目标性别|肉体性别|性别|gender)$/i],
  ['lowerBodyMode', /^(?:下体处理|下体覆盖模式|下体模式|lower\s*body\s*mode|lowerbodymode)$/i],
  ['lowerBodyType', /^(?:本件下体类型|下体类型|lower\s*body\s*type|lowerbodytype)$/i],
  ['lowerBodyDescription', /^(?:下体设定|下体结构设定|下体描述|lower\s*body\s*description|lowerbodydescription)$/i],
  ['abilities', /^(?:特殊能力|装备能力|能力效果|附带能力|能力|abilities)$/i],
  ['abilityConditions', /^(?:能力生效条件(?:[、，,]?\s*代价及限制)?|生效条件|能力条件|能力限制|代价及限制|限制与代价|触发条件|ability\s*conditions|abilityconditions)$/i],
  ['effectKind', /^(?:道具效果|消耗品效果|效果类型|effect\s*kind|effectkind)$/i],
  ['summary', /^(?:商品简介|装备简介|单品简介|简介|摘要|定位|款式与定位|风格与视觉基调|summary)$/i],
  ['appearance', /^(?:外观视觉还原|外貌特征|外观特征|外貌|外观|面貌体征|容貌特征|容貌|appearance)$/i],
  ['bodyBuild', /^(?:客观体态参数|体态参数|体型身材|身材参数|体态曲线|体型|身材|体态|规格指标|材质与色彩|核心结构解析|body\s*build|bodybuild)$/i],
  ['physiology', /^(?:扶她生理构造|生理特征|生理构造|生殖器官|生理器官|剪裁与暴露结构|生理|physiology)$/i],
  ['mechanics', /^(?:活体穿戴机能|穿戴接口与机能|穿戴互动与机关|穿搭层级与细节亮点)$/i],
  ['ringAppearance', /^(?:肉躯静息外观|静息环体外观|基底环体|静息外观|静息形态|环体外观|ring\s*appearance|ringappearance)$/i],
  ['forwardExtension', /^(?:前方延展设定|前方延展\s*[·:：]?\s*器官重构|前方重构\s*[·:：]?\s*器官形态|前方延展|前方重构|器官重构|器官形态|forward\s*extension|forwardextension)$/i],
  ['backwardExtension', /^(?:后方延展设定|后方延展\s*[·:：]?\s*躯体重构|后方延展\s*[·:：]?\s*外躯体态(?:\s*[(（][^）)]*[)）])?|后方延展|后方重构|躯体重构|外躯体态|backward\s*extension|backwardextension)$/i],
  ['drawPrompt', /^(?:角色生图提示词(?:\s*[(（][^）)]*[)）])?|角色提示词|主体生图提示词|主体提示词|后方延展(?:生图)?提示词|生图提示词\s*[：:]\s*遮蔽形态|character\s*prompt|body\s*prompt|draw\s*prompt|drawprompt)$/i],
  ['organDrawPrompt', /^(?:肉棒生图提示词(?:\s*[(（][^）)]*[)）])?|肉棒提示词|器官生图提示词|器官提示词|阳具(?:生图)?提示词|扶她(?:生图)?提示词|前方延展(?:生图)?提示词|penis\s*prompt|organ\s*prompt|futa\s*prompt|organ\s*draw\s*prompt|organdrawprompt)$/i],
  ['drawPromptOpen', /^(?:生图提示词\s*[：:]\s*展开姿态|展开姿态(?:生图)?提示词|open\s*prompt|drawpromptopen)$/i],
  ['combinedPrompt', /^(?:生图提示词(?:\s*[(（][^）)]*[)）])?|绘图提示词|生图\s*tag|提示词|prompt|tags|danbooru\s*tags?)$/i]
];

function classifyFieldLabel(rawLabel) {
  const clean = String(rawLabel || '')
    .replace(/^[\s#*>\-•\[【「『(（]+|[\s#*\]】」』)）:：]+$/g, '')
    .trim();
  if (!clean) return '';
  for (const [key, regex] of FIELD_LABEL_RULES) {
    if (regex.test(clean)) return key;
  }
  return '';
}

function isLikelyDanbooruLine(line) {
  const s = String(line || '').trim();
  if (!s || s.length < 8 || !s.includes(',')) return false;
  const parts = s.split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length < 2) return false;
  const asciiCount = (s.match(/[a-z0-9_(),:\\.\s/-]/gi) || []).length;
  return asciiCount / s.length >= 0.72;
}

/**
 * Parses a complete large block of text (XML `<skin_suit_design>` / `<flesh_ring_design>` / `<apparel_design>`,
 * bracketed `[字段]` / `【字段】` sections, `字段：内容` key-value lines, JSON, or raw Chinese + English Danbooru prompts)
 * into structured catalog item fields with separated `drawPrompt` (character) and `organDrawPrompt` (penis).
 */
export function parseItemTextBlock(rawText = '', defaults = {}) {
  defaults = {...defaults, category: defaults.category || defaults.fallbackCategory};
  const source = String(rawText ?? '').replace(/^\uFEFF/, '').trim();
  if (!source) return {};

  // 1. Try JSON object first
  const unfenced = source.replace(/^```(?:json|xml|text)?\s*/i, '').replace(/\s*```$/, '').trim();
  if (unfenced.startsWith('{') && unfenced.endsWith('}')) {
    try {
      const parsed = JSON.parse(unfenced);
      const obj = Array.isArray(parsed?.items) ? parsed.items[0] : parsed;
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        const category = ['skin_suit', 'flesh_ring', 'apparel', 'consumable'].includes(obj.category)
          ? obj.category
          : (defaults.category || 'skin_suit');
        const gender = ['男', '女', '扶她'].includes(obj.gender) ? obj.gender : (defaults.gender || '');
        const lowerBodyType = ['auto', 'female', 'male', 'dual', 'none', 'custom'].includes(obj.lowerBodyType)
          ? obj.lowerBodyType
          : 'auto';
        const prompts = splitItemDrawPrompts(obj.drawPrompt || '', obj.organDrawPrompt || '', {category, gender, lowerBodyType});
        return {
          ...obj,
          category,
          drawPrompt: prompts.drawPrompt,
          organDrawPrompt: prompts.organDrawPrompt,
          ...itemFanworkFields({...obj, drawPrompt: prompts.drawPrompt}, category)
        };
      }
    } catch {}
  }

  const out = {};
  const buckets = {
    name: [], shortName: [], category: [], slot: [], price: [], gender: [], fanwork: [], cosplayCharacter: [],
    lowerBodyMode: [], lowerBodyType: [], lowerBodyDescription: [],
    abilities: [], abilityConditions: [], effectKind: [], summary: [],
    appearance: [], bodyBuild: [], physiology: [], mechanics: [],
    ringAppearance: [], forwardExtension: [], backwardExtension: [],
    drawPrompt: [], organDrawPrompt: [], drawPromptOpen: [], combinedPrompt: [],
    subAppearance: [], subBodyBuild: []
  };

  // 2. Detect XML design wrapper
  const xmlMatch = unfenced.match(/<(skin_suit_design|flesh_ring_design|apparel_design)\b([^>]*)>([\s\S]*?)(?:<\/\1\s*>|$)/i);
  if (xmlMatch) {
    const tag = xmlMatch[1].toLowerCase();
    const attrs = xmlMatch[2] || '';
    out.rawDesign = xmlMatch[0].trim();
    if (tag === 'skin_suit_design') { out.category = 'skin_suit'; out.slot = 'skin_suit'; }
    else if (tag === 'flesh_ring_design') { out.category = 'flesh_ring'; out.slot = 'flesh_ring'; }
    else if (tag === 'apparel_design') { out.category = 'apparel'; }
    const attrName = attrs.match(/\bname\s*=\s*["']([^"']+)["']/i)?.[1]?.trim();
    if (attrName) buckets.name.push(attrName);
    const attrType = attrs.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1]?.trim() || '';
    if (attrType) {
      if (/隐私|遮挡|阴蒂贴|阴茎套/.test(attrType)) out.slot = 'privacyCover';
      else if (/饰品|附加|配件|锁具|乳环/.test(attrType)) out.slot = 'accessories';
      else if (/内衣|贴身|连体衣|比基尼|丁字/.test(attrType)) out.slot = 'underwear';
      else if (/外搭|外套|斗篷|风衣|浴袍/.test(attrType)) out.slot = 'outerwear';
      else if (/道具|消耗/.test(attrType)) { out.category = 'consumable'; out.slot = 'consumable'; }
    }
  } else if (unfenced.length >= 20) {
    out.rawDesign = unfenced;
  }

  // Pre-split inline prompt markers on the same line (e.g. "角色提示词：... 肉棒提示词：...")
  const expandedText = unfenced
    .replace(/([^\n])\s*(?=(?:\[|【)(?:同人(?:卡|角色Tag|角色英文Tag)?|角色英文Tag|角色(?:生图)?提示词|肉棒(?:生图)?提示词|器官(?:生图)?提示词|前方延展(?:设定|提示词)?|后方延展(?:设定|提示词)?|生图提示词|特殊能力|能力生效条件|外貌特征|体型身材|生理特征))/g, '$1\n')
    .replace(/([^\n])\s+(?=(?:角色(?:生图)?提示词|肉棒(?:生图)?提示词|器官(?:生图)?提示词|阳具(?:生图)?提示词|前方延展提示词|后方延展提示词|character\s*prompt|penis\s*prompt|organ\s*prompt)\s*[:：])/gi, '$1\n');

  const rawLines = expandedText.split(/\r?\n/);
  const lines = [];
  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (/^<\/?(?:skin_suit_design|flesh_ring_design|apparel_design|restock_item)\b[^>]*>$/i.test(trimmed)) continue;
    if (/[｜|]/.test(trimmed) && (trimmed.match(/[:：]/g) || []).length >= 2) {
      const parts = trimmed.split(/[｜|]/).map(s => s.trim()).filter(Boolean);
      if (parts.every(p => /^[^:：]{1,18}[:：]/.test(p))) {
        lines.push(...parts);
        continue;
      }
    }
    lines.push(trimmed);
  }

  let currentSection = '';
  const unlabeledLines = [];

  for (const line of lines) {
    // Check bracketed or markdown section header: [Label]：val or 【Label】：val or ### Label
    const bracketMatch = line.match(/^(?:[#*>-]+\s*)?(?:\[\s*([^\]\n]{1,40})\s*\]|【\s*([^】\n]{1,40})\s*】|\*\*([^*\n]{1,32})\*\*)\s*[:：]?\s*(.*)$/);
    if (bracketMatch) {
      const rawLabel = (bracketMatch[1] || bracketMatch[2] || bracketMatch[3] || '').trim();
      const rest = (bracketMatch[4] || '').trim();
      const key = classifyFieldLabel(rawLabel);
      if (key) {
        currentSection = key;
        if (rest) buckets[key].push(rest);
        continue;
      }
      // If the line starts with 【Item Title】 and rawLabel is not a field header
      if (bracketMatch[2] && !buckets.name.length && rawLabel.length <= 80) {
        buckets.name.push(`【${rawLabel}】`);
        if (rest) unlabeledLines.push(rest);
        continue;
      }
    }

    // Check sub-bullets inside multi-line sections (e.g. "- 生殖器官: ..." inside [体态参数])
    const bulletMatch = line.match(/^[-*•]\s*([^:：\n]{2,18})\s*[:：]\s*(.+)$/);
    if (bulletMatch) {
      const subLabel = bulletMatch[1].trim();
      const subVal = bulletMatch[2].trim();
      if (/^(?:生殖器官|扶她生理构造|生理构造|生理特征)$/.test(subLabel)) {
        buckets.physiology.push(subVal);
        continue;
      }
      if (currentSection === 'backwardExtension') {
        if (/^(?:面貌体征|外貌特征|外貌|容貌|发型瞳色)$/.test(subLabel)) buckets.subAppearance.push(subVal);
        else if (/^(?:体态曲线|体型身材|体态|身材|穿搭细节)$/.test(subLabel)) buckets.subBodyBuild.push(subVal);
      }
      if (currentSection) {
        buckets[currentSection].push(`${subLabel}：${subVal}`);
        continue;
      }
    }

    // Check plain Key: Value line
    const kvMatch = line.match(/^(?:[-*•]\s*)?([^:：\n\[【]{1,28})\s*[:：]\s*(.*)$/);
    if (kvMatch) {
      const key = classifyFieldLabel(kvMatch[1]);
      if (key) {
        currentSection = key;
        const val = kvMatch[2].trim();
        if (val) buckets[key].push(val);
        continue;
      }
    }

    // Check if this line is a raw English Danbooru tag line
    if (isLikelyDanbooruLine(line) && !['drawPrompt', 'organDrawPrompt', 'drawPromptOpen', 'combinedPrompt'].includes(currentSection)) {
      const tags = line.split(',').map(s => s.trim()).filter(Boolean);
      const allPenis = tags.length > 0 && tags.every(t => isPenisDrawTag(t) || isFutanariTag(t));
      if (allPenis) buckets.organDrawPrompt.push(line);
      else buckets.combinedPrompt.push(line);
      continue;
    }

    if (currentSection) {
      buckets[currentSection].push(line.replace(/^[-*•]\s*/, ''));
    } else {
      unlabeledLines.push(line);
    }
  }

  // 3. Process unlabeled lines if any fields are still missing
  if (unlabeledLines.length) {
    const firstLine = unlabeledLines[0];
    if (!buckets.name.length) {
      const titleCandidate = firstLine.split(/[，,。；;（(]/)[0].trim();
      if (titleCandidate && titleCandidate.length <= 40 && !isLikelyDanbooruLine(firstLine)) {
        buckets.name.push(titleCandidate);
      }
    }
    const joinedUnlabeled = unlabeledLines.join('\n');
    if (!buckets.price.length) {
      const priceHit = joinedUnlabeled.match(/(?:售价|价格|定价|¥|￥)\s*(\d{1,6})(?:\s*元)?/);
      if (priceHit) buckets.price.push(priceHit[1]);
    }
    if (!buckets.forwardExtension.length) {
      const fwdHit = joinedUnlabeled.match(/前方延展(?:设定)?(?:为|是|\s*[:：])\s*([^。；\n]+)/);
      if (fwdHit?.[1]?.trim()) buckets.forwardExtension.push(fwdHit[1].trim());
    }
    if (!buckets.backwardExtension.length) {
      const bwdHit = joinedUnlabeled.match(/后方延展(?:设定)?(?:为|是|\s*[:：])\s*([^。；\n]+)/);
      if (bwdHit?.[1]?.trim()) buckets.backwardExtension.push(bwdHit[1].trim());
    }
    const clauses = unlabeledLines.flatMap(l => l.split(/[。；;\n]+/)).map(s => s.trim()).filter(Boolean);
    for (const clause of clauses) {
      if (/身高\s*\d+|胸围|[A-Z]\s*罩杯|[A-Z]\s*杯|腰围|臀围|腰臀|巨乳|贫乳|爆乳|母马|梨形|沙漏/i.test(clause)) {
        if (!buckets.bodyBuild.includes(clause)) buckets.bodyBuild.push(clause);
      }
      if (/肉棒|阴茎|阳具|巨根|勃起|疲软|龟头|冠状沟|马眼|阴囊|睾丸|玉囊|小穴|敏感带/.test(clause)) {
        if (!buckets.physiology.includes(clause)) buckets.physiology.push(clause);
      }
      if (/[黑白红蓝绿金银紫粉棕灰长短]发|发色|发型|瞳|眼眸|双眸|尖耳|兽耳|面容|脸庞|肤|修女|女仆|精灵|神官/.test(clause)) {
        if (!buckets.appearance.includes(clause)) buckets.appearance.push(clause);
      }
    }
    if (!buckets.summary.length) {
      const chineseSummary = unlabeledLines.filter(l => !isLikelyDanbooruLine(l)).join('；').trim();
      if (chineseSummary) buckets.summary.push(chineseSummary.slice(0, 120));
    }
  }

  const joinBucket = (key, sep = '；') => buckets[key].map(s => s.trim()).filter(Boolean).join(sep).trim();

  // 4. Resolve category & slot
  const catRaw = joinBucket('category');
  if (!out.category) {
    if (/皮躯|skin_?suit/i.test(catRaw)) out.category = 'skin_suit';
    else if (/肉躯|肉环|flesh_?ring/i.test(catRaw)) out.category = 'flesh_ring';
    else if (/道具|消耗品|consumable/i.test(catRaw)) out.category = 'consumable';
    else if (/服饰|服装|衣|饰品|apparel/i.test(catRaw)) out.category = 'apparel';
    else if (buckets.ringAppearance.length || buckets.forwardExtension.length || buckets.backwardExtension.length || /肉躯|肉环/.test(unfenced)) out.category = 'flesh_ring';
    else if (/皮躯|活体皮衣|脊椎隐形/.test(unfenced)) out.category = 'skin_suit';
    else if (defaults.category) out.category = defaults.category;
  }
  const category = out.category || defaults.category || 'skin_suit';

  const slotRaw = joinBucket('slot');
  if (category === 'skin_suit' || category === 'flesh_ring' || category === 'consumable') {
    out.slot = category;
  } else if (!out.slot) {
    if (/隐私|遮挡|阴蒂贴|阴茎套|privacyCover/i.test(slotRaw || unfenced)) out.slot = 'privacyCover';
    else if (/饰品|附加|配件|乳环|锁具|accessories/i.test(slotRaw || unfenced)) out.slot = 'accessories';
    else if (/内衣|贴身|连体衣|比基尼|丁字|underwear/i.test(slotRaw || unfenced)) out.slot = 'underwear';
    else if (/外搭|外套|斗篷|风衣|浴袍|outerwear/i.test(slotRaw || unfenced)) out.slot = 'outerwear';
    else if (defaults.slot) out.slot = defaults.slot;
  }

  // 5. Resolve name, shortName, price
  const parsedName = joinBucket('name', ' ');
  if (parsedName) {
    out.name = parsedName;
    out.shortName = joinBucket('shortName', ' ')
      || parsedName.replace(/[【】\[\]()（）]/g, '').split(/[·・\s]/)[0].slice(0, 20);
  } else if (buckets.shortName.length) {
    out.shortName = joinBucket('shortName', ' ');
  }

  const priceRaw = joinBucket('price', ' ');
  if (priceRaw) {
    const digits = priceRaw.replace(/[^\d]/g, '');
    if (digits) out.price = Math.max(0, Math.min(999999, Number(digits)));
  }

  // 6. Resolve gender & lowerBody structure
  const genderRaw = joinBucket('gender', ' ');
  if (/扶她|双性|futanari|futa/i.test(genderRaw)) out.gender = '扶她';
  else if (/^(?:女性|纯女|女|female|1girl)/i.test(genderRaw)) out.gender = '女';
  else if (/^(?:男性|纯男|男|male|1boy)/i.test(genderRaw)) out.gender = '男';
  else if (!out.gender && (category === 'skin_suit' || category === 'flesh_ring')) {
    if (/扶她|futanari|1futanari|肉棒|阴茎|阳具|巨根/i.test(unfenced)) out.gender = '扶她';
    else if (/\b1boy\b|男性皮躯|男性肉躯/i.test(unfenced)) out.gender = '男';
    else if (/\b1girl\b|纯女|女性皮躯|女性结构/i.test(unfenced)) out.gender = '女';
  }

  const modeRaw = joinBucket('lowerBodyMode', ' ');
  if (/preserve|保留内层|保留本体/i.test(modeRaw)) out.lowerBodyMode = 'preserve';
  else if (/replace|使用本件|覆盖/i.test(modeRaw)) out.lowerBodyMode = 'replace';
  else if (/legacy|兼容/i.test(modeRaw)) out.lowerBodyMode = 'legacy';

  const typeRaw = joinBucket('lowerBodyType', ' ');
  if (/female|女性结构|纯女/i.test(typeRaw)) out.lowerBodyType = 'female';
  else if (/male|男性结构|纯男/i.test(typeRaw)) out.lowerBodyType = 'male';
  else if (/dual|双性结构|扶她/i.test(typeRaw)) out.lowerBodyType = 'dual';
  else if (/none|无独立结构|无下体/i.test(typeRaw)) out.lowerBodyType = 'none';
  else if (/custom|自定义/i.test(typeRaw)) out.lowerBodyType = 'custom';
  else if (/auto|跟随/i.test(typeRaw)) out.lowerBodyType = 'auto';

  const lowerDesc = joinBucket('lowerBodyDescription');
  if (lowerDesc) out.lowerBodyDescription = lowerDesc;

  const abilities = joinBucket('abilities', '\n');
  if (abilities) out.abilities = abilities;
  const abilityConds = joinBucket('abilityConditions');
  if (abilityConds) out.abilityConditions = abilityConds;

  const effectRaw = joinBucket('effectKind', ' ');
  if (effectRaw) {
    if (/cognition|认知|常识/i.test(effectRaw)) out.effectKind = 'cognition';
    else if (/body|身体|母马|重塑/i.test(effectRaw)) out.effectKind = 'body';
    else if (/physiology|生理|催情|敏感/i.test(effectRaw)) out.effectKind = 'physiology';
  }

  // 7. Resolve appearance, bodyBuild, physiology, extensions, summary
  const ringApp = joinBucket('ringAppearance');
  if (ringApp) out.ringAppearance = ringApp;
  const fwdExt = joinBucket('forwardExtension');
  if (fwdExt) out.forwardExtension = fwdExt;
  const bwdExt = joinBucket('backwardExtension');
  if (bwdExt) out.backwardExtension = bwdExt;

  const appearance = joinBucket('appearance') || joinBucket('subAppearance') || (category === 'flesh_ring' ? bwdExt : '');
  if (appearance) out.appearance = appearance;

  const bodyBuild = joinBucket('bodyBuild') || joinBucket('subBodyBuild') || (category === 'flesh_ring' ? bwdExt : '');
  if (bodyBuild) out.bodyBuild = bodyBuild;

  const physiology = joinBucket('physiology') || (category === 'flesh_ring' ? fwdExt : '') || joinBucket('mechanics');
  if (physiology) out.physiology = physiology;

  if (category === 'flesh_ring') {
    if (!out.ringAppearance && appearance) out.ringAppearance = appearance;
    if (!out.forwardExtension && physiology) out.forwardExtension = physiology;
    if (!out.backwardExtension && (appearance || bodyBuild)) {
      out.backwardExtension = [appearance, bodyBuild].filter(Boolean).join('；');
    }
  }

  const summary = joinBucket('summary') || ringApp || appearance || bodyBuild;
  if (summary) out.summary = summary.replace(/\s+/g, ' ').slice(0, 120);

  // 8. Resolve & split character prompt (`drawPrompt`) and penis prompt (`organDrawPrompt`)
  const rawCharPrompt = [joinBucket('drawPrompt', ', '), joinBucket('combinedPrompt', ', ')].filter(Boolean).join(', ');
  const rawOrganPrompt = joinBucket('organDrawPrompt', ', ');
  if (rawCharPrompt || rawOrganPrompt) {
    const prompts = splitItemDrawPrompts(rawCharPrompt, rawOrganPrompt, {
      category,
      gender: out.gender || defaults.gender || '',
      lowerBodyType: out.lowerBodyType || defaults.lowerBodyType || 'auto'
    });
    out.drawPrompt = prompts.drawPrompt;
    out.organDrawPrompt = prompts.organDrawPrompt;
  }
  const openPrompt = joinBucket('drawPromptOpen', ', ');
  if (openPrompt) out.drawPromptOpen = normalizeCharacterDrawPrompt(openPrompt);
  Object.assign(out, itemFanworkFields({...out, fanwork: joinBucket('fanwork'), cosplayCharacter: joinBucket('cosplayCharacter', ' ')}, category));

  if (defaults.generateFallbackName && !out.name) {
    const catSuffix = {skin_suit: '皮躯', flesh_ring: '肉躯', apparel: '高定服饰', consumable: '异构道具'}[category] || '单品';
    const hint = (out.appearance || out.summary || out.bodyBuild || '').replace(/[【】\[\]()（）]/g, '').split(/[，,。；;\s/]/)[0].slice(0, 10);
    out.name = hint ? `${hint}·${catSuffix}` : `定制${catSuffix}`;
    out.shortName = out.shortName || out.name.slice(0, 12);
  }

  return out;
}

export function itemLowerBodyType(item) {
  if (item?.lowerBodyType && item.lowerBodyType !== 'auto') return item.lowerBodyType;
  return ({女: 'female', 男: 'male', 扶她: 'dual'})[item?.gender] || 'custom';
}
const lowerLabel = type => ({female: '女性结构', male: '男性结构', dual: '双性结构', none: '无独立下体结构', custom: '自定义结构'})[type] || '未设定';
export function filterLowerBodyTags(value, type) {
  const incompatible = ['female', 'none'].includes(type) ? /futanari|penis|erect|erection|flaccid|testicles|scrotum|阴茎|肉棒|玉囊/i : null;
  return String(value || '').split(',').map(part => part.trim()).filter(part => part && !incompatible?.test(part)).join(', ');
}

export function extensionEnabled(mode, direction) {
  return mode === direction || mode === 'both';
}

export function extensionMode(forward, backward) {
  return forward ? backward ? 'both' : 'forward' : backward ? 'backward' : 'idle';
}

export function normalizeWearMount(raw = {}) {
  raw = raw && typeof raw === 'object' ? raw : {};
  let input = raw.layers;
  if (!Array.isArray(input)) {
    input = [];
    if (raw.skinSuitId) input.push({itemId: raw.skinSuitId, kind: 'skin_suit', faceMode: raw.skinFaceMode, organOut: raw.skinOrganOut, voiceRole: raw.skinVoiceRole});
    if (raw.fleshRingId) input.push({itemId: raw.fleshRingId, kind: 'flesh_ring', faceMode: raw.fleshFaceMode, extendMode: raw.fleshExtendMode, voiceRole: raw.fleshVoiceRole});
  }
  const seen = new Set(), layers = [];
  for (const entry of input.slice(0, 200)) {
    if (!entry || !kinds.includes(entry.kind)) continue;
    const itemId = text(entry.itemId);
    if (!itemId || seen.has(itemId)) continue;
    seen.add(itemId);
    layers.push({
      itemId, kind: entry.kind,
      faceMode: entry.faceMode === 'neck' ? 'neck' : 'full',
      extendMode: ['idle', 'forward', 'backward', 'both'].includes(entry.extendMode) ? entry.extendMode : 'idle',
      organOut: entry.organOut !== false,
      voiceRole: text(entry.voiceRole, 4000)
    });
  }
  return syncWearMount({layers});
}

export function syncWearMount(mount) {
  const skin = last(mount.layers, layer => layer.kind === 'skin_suit');
  const ring = last(mount.layers, layer => layer.kind === 'flesh_ring');
  return Object.assign(mount, {
    skinSuitId: skin?.itemId || '', skinFaceMode: skin?.faceMode || 'full',
    skinOrganOut: skin?.organOut !== false, skinVoiceRole: skin?.voiceRole || '',
    fleshRingId: ring?.itemId || '', fleshFaceMode: ring?.faceMode || 'full',
    fleshExtendMode: ring?.extendMode || 'idle', fleshVoiceRole: ring?.voiceRole || ''
  });
}

export function wearLayers(entity) {
  return normalizeWearMount(entity?.livingMount).layers;
}

export function itemVoiceRef(xeno, item, layer = null) {
  if (item?.voiceRoleExplicit) return item.voiceRole || '';
  return item?.voiceRole || xeno.itemVoiceBindings?.[item?.id] || layer?.voiceRole || item?.sourceTargetName || '';
}

export function itemOccupant(xeno, itemId) {
  for (const entity of [xeno.protagonist, ...(xeno.targets || [])]) {
    if (!entity) continue;
    const layers = wearLayers(entity);
    const index = layers.findIndex(layer => layer.itemId === itemId);
    if (index >= 0) return {entity, targetKey: entity === xeno.protagonist ? '__protagonist__' : entity.name, layer: index + 1};
    for (const slot of ['outerwear', 'underwear', 'privacyCover', 'accessories']) {
      if (entity.outfit?.[slot + 'ItemId'] === itemId) return {entity, targetKey: entity === xeno.protagonist ? '__protagonist__' : entity.name, slot};
    }
  }
  return null;
}

export function resolveWear(xeno, entity) {
  const items = new Map((xeno.items || []).map(item => [item.id, item]));
  const layers = wearLayers(entity).map((layer, index) => ({...layer, index, item: items.get(layer.itemId)}))
    .filter(layer => layer.item && layer.item.category === layer.kind);
  const covering = layer => layer.kind === 'skin_suit' || extensionEnabled(layer.extendMode, 'backward');
  const body = last(layers, covering) || null;
  const head = last(layers, layer => covering(layer) && layer.faceMode === 'full') || null;
  const organ = last(layers, layer => layer.organOut && (
    layer.item.lowerBodyMode === 'preserve' ? false
      : layer.kind === 'flesh_ring' ? extensionEnabled(layer.extendMode, 'forward')
        : layer.item.lowerBodyMode === 'replace' || layer.item.gender === '扶她' || Boolean(layer.item.forwardExtension)
  )) || null;
  const lowerBodyMode = organ?.item.lowerBodyMode === 'replace' ? 'replace' : 'legacy';
  const lowerBodyType = organ ? itemLowerBodyType(organ.item) : ({女: 'female', 男: 'male', 扶她: 'dual'})[entity?.gender] || 'custom';
  const equipped = [...new Map([...layers.map(layer => layer.item),
    ...['outerwear', 'underwear', 'privacyCover', 'accessories'].map(slot => items.get(entity?.outfit?.[slot + 'ItemId']))]
    .filter(Boolean).map(item => [item.id, item])).values()];
  const abilities = equipped.filter(item => item.abilities).map(item =>
    `「${item.name}」：${item.abilities}（条件：${item.abilityConditions || '穿戴期间可用，仍需满足能力描述中的条件'}）`).join('\n');
  const headVoice = head ? text(itemVoiceRef(xeno, head.item, head), 4000) : '';
  const label = layer => layer ? `${layer.item.name}（第 ${layer.index + 1} 层）` : '本体';
  return {
    layers, body, head, organ, headVoice, lowerBodyMode, lowerBodyType, abilities,
    bodySource: label(body), headSource: label(head), organSource: organ ? label(organ) : '本体',
    headAppearance: head?.item.appearance || entity?.appearance || '',
    organAppearance: organ ? (lowerBodyMode === 'replace'
      ? [lowerLabel(lowerBodyType), organ.item.lowerBodyDescription || organ.item.forwardExtension || organ.item.physiology].filter(Boolean).join('：')
      : organ.item.forwardExtension || organ.item.physiology || organ.item.summary || organ.item.name)
      : `${lowerLabel(lowerBodyType)}（本体）`,
    extensionText: [
      body?.kind === 'flesh_ring' && body.item.backwardExtension ? `后方（${label(body)}）：${body.item.backwardExtension}` : '',
      organ?.kind === 'flesh_ring' && organ.item.forwardExtension ? `前方（${label(organ)}）：${organ.item.forwardExtension}` : ''
    ].filter(Boolean).join(' ｜ '),
    layerText: layers.length ? layers.map(layer => `${layer.index + 1}. ${layer.item.name}［${layer.kind === 'skin_suit' ? '皮躯' : '肉躯 · ' + ({idle: '静息', forward: '前方延展', backward: '后方延展', both: '前后同时延展'}[layer.extendMode])} · ${layer.faceMode === 'full' ? '覆面' : '头部收起'} · 独立部位${layer.organOut ? '启用' : '收起'}］`).join(' → ') : '未穿戴'
  };
}

export function wearDrawingTags(xeno, entity) {
  const view = resolveWear(xeno, entity);
  const organTag = /(?:futanari|penis|erection|testicles|scrotum|genital|vagina|vulva|阴茎|肉棒|玉囊|女性结构|男性结构|双性结构)/i;
  const parts = value => String(value || '').split(',').map(part => part.trim()).filter(Boolean);
  const result = [];
  if (view.body) result.push(...parts(normalizeCharacterDrawPrompt(view.body.item.drawPrompt, {stripPenis: true})).filter(part =>
    (view.body.itemId === view.head?.itemId || !facial.test(part))
    && !organTag.test(part)));
  if (view.head && view.head.itemId !== view.body?.itemId) result.push(...parts(normalizeCharacterDrawPrompt(view.head.item.drawPrompt, {stripPenis: true})).filter(part => facial.test(part)));
  if (view.body && !view.head) result.push(...parts(normalizeCharacterDrawPrompt(entity.appearance, {stripPenis: true})).filter(part => facial.test(part)));
  if (view.organ) {
    const organType = itemLowerBodyType(view.organ.item);
    if (!['female', 'none'].includes(organType)) {
      const organPrompt = view.organ.item.organDrawPrompt
        ? normalizeOrganDrawPrompt(view.organ.item.organDrawPrompt)
        : normalizeOrganDrawPrompt(parts(view.organ.item.drawPrompt).filter(part => organTag.test(part) || isPenisDrawTag(part)).join(', '));
      if (organPrompt) result.push(...parts(organPrompt));
      else if (organType === 'dual' || view.organ.item.gender === '扶她') result.push('futanari');
    }
  }
  const tags = [...new Set(result)].join(', ');
  return view.lowerBodyMode === 'replace' ? filterLowerBodyTags(tags, view.lowerBodyType) : tags;
}

export function wearDrawingAppearance(xeno, entity) {
  const view = resolveWear(xeno, entity);
  if (!view.body || view.body.itemId === view.head?.itemId) return view.body?.item.appearance || entity.appearance || '';
  const parts = value => String(value || '').split(/[,，;；。\n]+/).map(part => part.trim()).filter(Boolean);
  const body = parts(view.body.item.appearance || entity.appearance).filter(part => !facial.test(part));
  const head = parts(view.headAppearance).filter(part => facial.test(part));
  return [...body, ...head].join(', ');
}
