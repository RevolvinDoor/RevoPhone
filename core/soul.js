// Soul's public profiles and per-story-chat discovery records. No DOM or model calls.
import {isValidRoleName} from './routes.js';
import {stripQualityDrawTags} from './xeno-wear.js';

const text = (v, max = 300) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const list = (v, max = 8) => [...new Set((Array.isArray(v) ? v : String(v || '').split(/[,，、]/))
  .map(x => text(x, 40)).filter(Boolean))].slice(0, max);
export const SOUL_LIMIT = 60;
export const SOUL_PROFILE_FIELDS = Object.freeze({nickname: '网名', signature: '个性签名', age: '公开年龄', gender: '性别',
  identity: '公开身份', region: '所在地区', interests: '兴趣', intro: '自我介绍', purpose: '交友目的', preferences: '择友偏好'});
export const SOUL_STRANGER_RULE = '你与玩家最初是陌生人，只知道玩家公开主页及双方自己的聊天。'
  + '未在本会话告知的真实身份、私密经历、其他联系人、其他对话和正文剧情都不是你的已知事实。'
  + '不编造曾经见面、共同回忆、旧关系或已经知道的秘密。后来告知的事情仅按本会话内容逐步了解。';
const soulStyle = nsfw => nsfw
  ? '本次为成年人交友中的成人写真创作者风格，参考 X 上的成年写真博主、性感穿搭博主等公开主页。'
    + '在满足 requirements 的前提下，体现性感写真、泳装或内衣穿搭、暧昧签名、粉丝互动、约拍等具体兴趣和社交取向；可以是兼职创作者，不改掉指定的本职职业、性别或种族。'
    + '照片采用符合本人穿搭的魅力写真，允许性感服装和自信姿态，不强制日常便装；不描写性行为或裸露私密部位。'
  : '本次为日常交友取向，签名、介绍和目的围绕日常生活与兴趣；照片为完整日常着装的全身生活照。';

export function normalizeSoulProfile(raw = {}) {
  return {...Object.fromEntries(Object.keys(SOUL_PROFILE_FIELDS).map(key => [key, text(raw?.[key], key === 'intro' ? 800 : 160)])),
    photoId: text(raw?.photoId, 512)};
}
export function defaultSoulSettings() {
  return {defaultTemplate: 'default', templates: [{id: 'default', name: '我的主页', profile: normalizeSoulProfile()}]};
}
export function normalizeSoulSettings(raw) {
  const templates = (Array.isArray(raw?.templates) ? raw.templates : []).filter(t => t?.id)
    .slice(0, 8).map(t => ({id: text(t.id, 100), name: text(t.name, 40) || '主页', profile: normalizeSoulProfile(t.profile)}));
  if (!templates.length) return defaultSoulSettings();
  return {defaultTemplate: templates.some(t => t.id === raw.defaultTemplate) ? raw.defaultTemplate : templates[0].id,
    templates: [...new Map(templates.map(t => [t.id, t])).values()]};
}
export function publicSoulProfile(profile) {
  const clean = normalizeSoulProfile(profile);
  return Object.fromEntries(Object.entries(clean).filter(([key, value]) => key !== 'photoId' && value));
}
export function newSoulSession(chatKey, settings) {
  const config = normalizeSoulSettings(settings);
  return {version: 1, chatKey, profile: structuredClone(config.templates.find(t => t.id === config.defaultTemplate).profile),
    nsfw: false, query: '', candidates: [], batch: []};
}
export function normalizeSoulCandidate(raw = {}) {
  return {id: text(raw.id, 100), name: text(raw.name, 24), nickname: text(raw.nickname, 40), age: Number(raw.age) || 0,
    gender: text(raw.gender, 20), species: text(raw.species, 60), region: text(raw.region, 120), occupation: text(raw.occupation, 120),
    interests: list(raw.interests), signature: text(raw.signature, 200), intro: text(raw.intro, 500),
    purpose: text(raw.purpose, 200), preferences: text(raw.preferences, 200), appearance: text(raw.appearance, 900),
    bodyBuild: text(raw.bodyBuild, 600), outfit: text(raw.outfit, 500), drawPrompt: stripQualityDrawTags(text(raw.drawPrompt, 1500)),
    nsfw: raw.nsfw === true, requirements: text(raw.requirements, 1000),
    incoming: raw.incoming === true, greeting: text(raw.greeting, 400), photoId: text(raw.photoId, 512),
    imageData: typeof raw.imageData === 'string' && raw.imageData.length <= 500000
      && /^data:image\/(?:jpeg|png|webp);base64,[a-z\d+/=]+$/i.test(raw.imageData) ? raw.imageData : '',
    imageError: text(raw.imageError, 250), imageState: raw.imageState === 'done' ? 'done' : 'waiting',
    accepted: raw.accepted === true, ignored: raw.ignored === true, threadId: text(raw.threadId, 512),
    persona: text(raw.persona, 3900), at: Number(raw.at) || 0};
}
export function normalizeSoulSession(raw, chatKey, settings) {
  const fresh = newSoulSession(chatKey, settings);
  if (!raw || raw.chatKey !== chatKey) return fresh;
  const candidates = (Array.isArray(raw.candidates) ? raw.candidates : []).slice(0, SOUL_LIMIT).map(normalizeSoulCandidate)
    .filter(c => c.id && isValidRoleName(c.name) && Number.isInteger(c.age) && c.age >= 18 && c.age <= 100000);
  return {...fresh, profile: normalizeSoulProfile(raw.profile), nsfw: raw.nsfw === true, query: text(raw.query, 1000),
    candidates: [...new Map(candidates.map(c => [c.id, c])).values()],
    batch: (Array.isArray(raw.batch) ? raw.batch : []).filter(id => candidates.some(c => c.id === id)).slice(0, 3)};
}
export function soulPerson(session, name) {
  return session?.candidates?.find(c => c.accepted && c.name === name) || null;
}
export function soulIdentity(candidate) {
  return [candidate.nickname || candidate.name, `${candidate.age}岁`, candidate.gender, candidate.species,
    candidate.region, candidate.occupation].filter(Boolean).join(' · ');
}
export function soulBrief(candidate) {
  return {name: candidate.name, nickname: candidate.nickname, age: candidate.age, gender: candidate.gender,
    species: candidate.species, region: candidate.region, occupation: candidate.occupation, interests: candidate.interests,
    signature: candidate.signature, intro: candidate.intro, purpose: candidate.purpose, preferences: candidate.preferences,
    appearance: candidate.appearance, bodyBuild: candidate.bodyBuild, outfit: candidate.outfit};
}
export function soulChatPersona(candidate, session) {
  return [candidate.persona, SOUL_STRANGER_RULE,
    candidate.incoming ? '你是主动来认识玩家的人，态度热情、配合意愿高，倾向接受玩家的互动邀请与安排，行动结合自身身份和世界条件。' : '',
    candidate.nsfw ? '延续自己公开资料中的成人写真创作者风格和暧昧社交口吻，具体身份以既有人设为准。'
      : '以日常交友和自然了解为取向。'].filter(Boolean).join('\n\n');
}
export function parseSoulJson(raw) {
  const source = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(source); } catch { throw Error('Soul 返回的资料格式不完整，本次未加入人物；可重试'); }
}
export function soulDiscoveryRequest({world, profile, query = '', nsfw = false, incoming = false, excluded = []}) {
  return [{role: 'system', content: '为当前世界观设计原创、明确成年的陌生交友角色。只输出 JSON：{"people":[...]}。'
    + `people 必须恰好 ${incoming ? 1 : 3} 人；姓名彼此不同且不在排除名单中。`
    + '每人字段：name(实际姓名，24字内)、nickname、age(整数，至少18)、gender(男/女/扶她)、species、region、occupation、interests(数组)、signature、intro(简短公开介绍)、purpose、preferences、appearance(固定外貌)、bodyBuild、outfit(照片中的具体穿搭)、drawPrompt(英文逗号分隔人物全身照片Tag)、greeting(一句初见招呼)。'
    + '每一位人物都必须满足 requirements 的明确条件与排除条件，包括性别、年龄、种族、职业、性格、外貌、穿搭和交友目的；不得分摊给三人或只满足其中一个关键词。'
    + '人物多样性只用于用户未指定的部分；未填要求才随机发现。world 仅提供地区和社会背景，不得拿角色卡主角的身份外貌替换筛选条件；publicProfile 是玩家资料，不是待生成角色的要求。'
    + '这里只设计简单资料，不扩写完整背景。地区与生活背景符合世界观；不生成既有角色或同人角色。'
    + SOUL_STRANGER_RULE
    + (incoming ? '本次人物主动来联系玩家，友好热情且配合意愿高，招呼从玩家公开主页切入。' : '')
    + soulStyle(nsfw)
    + (nsfw ? '每人的签名、介绍、交友目的和穿搭都要呈现上述风格，不能只写一句“接受成熟话题”后仍生成普通交友资料。' : '')
    + '输出前逐项核对每个人的资料和 drawPrompt 都符合 requirements、当前风格及成年原则，不符就在本次回复中改正；图片标签必须包含资料中的外貌、体型、服装和身份环境，不使用质量词。'
    + '筛选条件只是创作指令，不是角色已知的玩家信息；背景仅供设计世界一致性，不可让角色声称知道玩家未公开的信息。'},
  {role: 'user', content: JSON.stringify({world: text(world, 18000), publicProfile: publicSoulProfile(profile),
    excludedNames: excluded.slice(0, 150), requirements: text(query, 1000) || '随机发现，兼顾身份与性格的多样性'})}];
}
export function soulExpansionRequest(candidate, session) {
  return [{role: 'system', content: '根据固定交友资料扩写一位原创成年角色。只输出 JSON：{"background":"经历与社会关系","personality":"性格与动机","speech":"说话习惯","goals":"生活目标","greeting":"一句初见招呼"}。'
    + '总长度不超过2500字。保留全部固定事实、外貌和服装，人物有自己的生活，不新增与玩家的旧关系。'
    + SOUL_STRANGER_RULE
    + (candidate.incoming ? '该人物热情主动、配合意愿高，愿意响应玩家互动邀请，具体行动遵循身份和当前处境。' : '')
    + soulStyle(candidate.nsfw)
    + 'requirements 是发现此人时的创作条件，扩写继续保留其要求；不要把筛选条件当作角色知道的玩家信息，也不要改成后来其他人物的风格。'},
  {role: 'user', content: JSON.stringify({fixedProfile: soulBrief(candidate), publicPlayerProfile: publicSoulProfile(session.profile),
    requirements: candidate.requirements || ''})}];
}
export function expandedSoulPersona(raw, candidate) {
  const sections = ['background', 'personality', 'speech', 'goals'].map(key => text(raw?.[key], 650));
  if (sections.some(s => !s)) throw Error('完整人设缺少经历、性格、口吻或目标，未加入联系人');
  return [JSON.stringify(soulBrief(candidate)), ...sections].join('\n\n').slice(0, 3600);
}
