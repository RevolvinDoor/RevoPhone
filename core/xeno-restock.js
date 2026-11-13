import {GENDERS, xenoPromptEntryText, xenoMallPosePromptText} from './xeno.js';

// One recipe for actual restocking and previews. Missing built-ins are resolved
// by xenoPromptEntryText; explicitly disabled or empty entries stay empty.
export function buildMallRestockRequest(xeno, {category = 'apparel', slot = 'outerwear', text = '', imageData = '', gender = '', fanwork = false, cosplayCharacter = ''} = {}) {
  const xmlTag = category === 'skin_suit' ? 'skin_suit_design' : category === 'flesh_ring' ? 'flesh_ring_design' : 'apparel_design';
  const workbenchId = category === 'skin_suit' ? 'skinWorkbench' : category === 'flesh_ring' ? 'ringWorkbench' : 'apparelWorkbench';
  const catTitle = {skin_suit: '活体皮躯', flesh_ring: '活体肉躯', apparel: '高定特殊服饰', consumable: '异构生物道具'}[category];
  const get = id => xenoPromptEntryText(xeno, id).trim();
  const scale = get('scaleRule'), pose = xenoMallPosePromptText(xeno).trim();
  const metadataRule = '【装备结构与能力字段】在设计块中另列 [身体类型]：女/男/扶她/未设定；[下体处理]：replace 或 preserve；[下体类型]：auto/female/male/dual/none/custom；[下体设定]：结构与覆盖方式；[特殊能力]：能力说明；[能力生效条件]：触发、代价及限制。'
    + '以上字段按输入要求，优先于模板中的固定性别假设。女性装备不添加男性部位，前方延展按该件结构重构，不固定为男性结构。可用 [生理构造] 记录生理特征。未要求特殊能力时留空，不擅自添加。'
    + '【提示词分离规则】必须将 [角色生图提示词 (Character Prompt)] 与 [肉棒生图提示词 (Penis Prompt)] 分开输出：角色生图提示词一律禁止包含 futanari 及任何男性生殖器 Tag；肉棒生图提示词（仅在具备男性/扶她肉棒结构或前方延展肉棒时填写，纯女性无肉棒留空）必须固定以 futanari 开头并包含肉棒外观 Tag。'
    + (GENDERS.includes(gender) ? `本次指定身体类型为「${gender}」，设计正文、结构字段及绘图提示词必须一致。` : '身体类型根据明确输入或参考设定；无法确定时写未设定，不统一默认为扶她。');
  const system = [
    get('restockSysHeader'),
    get(workbenchId),
    metadataRule,
    '【生图格式】使用 NovelAI 的英文逗号分隔 Tag，括号不加反斜杠转义。所有生图提示词禁止加入 masterpiece、best quality、high quality、very aesthetic、absurdres、highres、ultra-detailed 等质量词。',
    fanwork && ['skin_suit', 'flesh_ring'].includes(category)
      ? `【同人躯体】按参考角色还原身体，将 NovelAI 格式的「角色英文 Tag (cosplay)」放入角色／身体生图提示词，不放入肉棒提示词。${cosplayCharacter ? `指定角色 Tag：${cosplayCharacter}；` : '请从文字或参考图识别角色，'}另列 [同人角色Tag]：角色的英文 Tag（不含 cosplay 后缀，空格分词，保留作品消歧括号）。` : '',
    pose ? `【商品图固定姿势与构图 Tag 要求】：在生成 [角色生图提示词 (Character Prompt)] / [生图提示词 (Prompt)] 时，请包含或优先适配以下构图与姿势 Tag：${pose}` : '',
    '请额外在设计块外层附上简要上架元数据（价格：数字 200~3500；简称：4~8字），或直接严格输出上述 XML 设计块。',
    scale ? '【本次比例尺】以下是当前使用预设中已保存且启用的比例尺。设计正文和生图提示词须保持一致；模板中的示例、默认范围或默认风格与它冲突时，以这条比例尺为准。\n' + scale : ''
  ].filter(Boolean).join('\n\n');
  const cleanInput = String(text || '').trim();
  const userText = [
    `【设计工作台输入】：${cleanInput || (imageData ? '请根据所附参考图生成设定档案。' : '请设计一件全新的商品。')}`,
    `【目标分类】：${catTitle}（槽位：${slot}）`,
    imageData ? '请观察所附参考图中的人物外貌、身材或服装剪裁款式，结合文字要求与本次比例尺生成工作台设定档案。' : '',
    `请严格按照 <${xmlTag} name="..."> 格式输出设定档案：`
  ].filter(Boolean).join('\n');
  const preUser = get('restockPreUser'), preAssistant = get('restockPreAssistant');
  return {xmlTag, messages: [
    ...(preUser ? [{role: 'user', content: preUser}] : []),
    ...(preAssistant ? [{role: 'assistant', content: preAssistant}] : []),
    {role: 'system', content: system},
    {role: 'user', content: imageData
      ? [{type: 'text', text: userText}, {type: 'image_url', image_url: {url: imageData}}]
      : userText}
  ]};
}

export function formatMallRestockRequest(request) {
  return request.messages.map((message, index) => {
    const content = Array.isArray(message.content)
      ? message.content.map(part => part.type === 'text' ? part.text : '（参考图片附件）').join('\n')
      : message.content;
    return `【第 ${index + 1} 条 · ${message.role}】\n${content}`;
  }).join('\n\n');
}
