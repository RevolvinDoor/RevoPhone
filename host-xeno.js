// Tavern host bridge for RevoPhone's 异构终端 (xeno) & 购物商城 (mall):
// 1. 洞察推荐 (AI scans current story & generates 《附身价值与颜值评估报告》 + populates targets)
// 2. 从剧情同步状态 (AI extracts protagonist & target 6-field status bars from recent story)
// 3. 商城进货 (AI generates new <skin_suit_design> / <flesh_ring_design> / <apparel_design> items from image and/or text)

import {storyLines} from './core/moments.js';
import {activeChatPreset, cleanTagged} from './core/chat.js';
import {cardRoutes, findRoute, roleTypeOf} from './core/routes.js';
import {ensureTarget, normalizeCatalogItem, GENDERS, xenoPromptEntryText, xenoMallPosePromptText, XENO_PROMPT_DEFAULTS, extractCardProtagonistProfile, applyXenoUpdateFromText} from './core/xeno.js';
import {searchStoryMessages} from './host-tt.js';
import {worldInfoFor, loreOptions} from './host-lore.js';

export function createXenoHost({context, settings, backend, notice = () => {}}) {
  const busy = {insight: null, sync: null, restock: null};
  const userName = () => context()?.name1 || settings()?.xeno?.protagonist?.name || '主角';
  const userPersona = () => String(context()?.powerUserSettings?.persona_description || '').slice(0, 2000);

  function run(kind, task) {
    if (busy[kind]) return busy[kind];
    const p = Promise.resolve()
      .then(() => task(context()))
      .finally(() => {
        busy[kind] = null;
        backend.emit('xeno', {busy: kind, active: false});
      });
    busy[kind] = p;
    backend.emit('xeno', {busy: kind, active: true});
    return p;
  }

  async function generateRestockText(ctx, messages) {
    return String(await backend.generateText(ctx, {prompt: messages, responseLength: 1800, trimNames: false}) || '');
  }

  async function recentStoryText(ctx, extraNames = '') {
    const s = settings();
    const preset = activeChatPreset(s.chat);
    const uName = userName();
    const chat = Array.isArray(ctx?.chat) ? ctx.chat : [];
    const lines = storyLines(chat, preset, uName).slice(-16);
    const charCard = ctx?.characters?.[ctx?.characterId];
    const cName = charCard?.name || '';
    const replaceMacros = str => String(str || '')
      .replaceAll('{{user}}', uName)
      .replaceAll('{{char}}', cName)
      .replace(/<user>/gi, uName)
      .replace(/<char>/gi, cName);

    const cardParts = [];
    if (charCard) {
      if (charCard.description) cardParts.push(replaceMacros(charCard.description).slice(0, 5000));
      if (charCard.personality) cardParts.push('性格：' + replaceMacros(charCard.personality).slice(0, 800));
      if (charCard.scenario) cardParts.push('场景与背景设定：' + replaceMacros(charCard.scenario).slice(0, 1500));
      if (!lines.length && charCard.first_mes) cardParts.push('开场白：' + replaceMacros(charCard.first_mes).slice(0, 2500));
    }
    const cardDesc = cardParts.length ? `【当前角色卡：${cName}】\n${cardParts.join('\n')}` : '';

    // Extract embedded character_book entries (especially protagonist & core character settings)
    const rawEntries = charCard?.data?.character_book?.entries || charCard?.character_book?.entries || [];
    const entryList = Array.isArray(rawEntries) ? rawEntries : Object.values(rawEntries || {});
    const embeddedLoreParts = [];
    let embeddedChars = 0;
    for (const entry of entryList) {
      if (!entry || entry.enabled === false || entry.disable === true) continue;
      const comment = String(entry.comment || entry.name || '').trim();
      const keys = Array.isArray(entry.keys || entry.key) ? (entry.keys || entry.key).join(' ') : String(entry.keys || entry.key || '');
      const content = replaceMacros(entry.content || '').trim();
      if (!content) continue;
      const isRelevant = entry.constant === true
        || /主角|男主|女主|使用者|玩家|user|外貌|身材|设定|人设|背景|状态/i.test(comment + ' ' + keys)
        || (uName && (comment.includes(uName) || keys.includes(uName) || content.includes(uName)))
        || (cName && (comment.includes(cName) || keys.includes(cName)));
      if (isRelevant && embeddedChars < 6000) {
        const snippet = content.slice(0, 1500);
        embeddedLoreParts.push(`${comment ? `[${comment}] ` : ''}${snippet}`);
        embeddedChars += snippet.length;
      }
    }
    let activeLore = '';
    if (preset?.lore !== false) {
      activeLore = await worldInfoFor(context, {
        ...loreOptions(preset || {}),
        persona: userPersona(),
        characters: cardDesc.slice(0, 2000),
        texts: [uName, cName, extraNames, ...lines.slice(-6).map(r => `${r.name}: ${r.text}`)].filter(Boolean)
      }).catch(() => '');
    }
    const loreBlock = [embeddedLoreParts.join('\n'), replaceMacros(activeLore).slice(0, 4000)].filter(Boolean).join('\n');
    const fullLoreSection = loreBlock ? `【角色卡世界书与设定条目】\n${loreBlock}` : '';

    const protRoute = (backend.routesHere?.() || []).find(r => roleTypeOf(r) === 'protagonist');
    const personaParts = [];
    if (protRoute?.name) personaParts.push(`角色App绑定主角名：${protRoute.name}`);
    if (protRoute?.persona?.trim()) personaParts.push(`角色App主角资料：${replaceMacros(protRoute.persona).trim()}`);
    if (protRoute?.appearance?.trim()) personaParts.push(`角色App主角外貌：${replaceMacros(protRoute.appearance).trim()}`);
    if (userPersona().trim()) personaParts.push(`酒馆当前用户人设：${replaceMacros(userPersona()).trim()}`);
    const personaSection = personaParts.length ? `【主角/用户人设参考（若角色卡或世界书对主角有专门设定，以角色卡设定为最高优先）】\n${personaParts.join('\n')}` : '';

    const storyBlock = lines.map(r => `${r.name}: ${r.text}`).join('\n');
    let recalledBlock = '';
    const endIndex = Math.max(0, chat.length - 16);
    if (endIndex > 0) {
      const query = [uName, extraNames, cName, '主角 外貌 身高 三围 罩杯 身材 穿着 衣服 身份 发色 瞳色'].filter(Boolean).join(' ');
      const hits = await searchStoryMessages(ctx, {query, limit: 6, endIndex, scanLimit: 3000}).catch(() => []);
      if (hits.length) {
        recalledBlock = `【早期剧情中的角色设定与状态记录（全文检索召回）】\n` + hits.map(h => `[第${h.index + 1}楼 · ${h.name}] ${h.text}`).join('\n');
      }
    }
    return [cardDesc, fullLoreSection, personaSection, recalledBlock, storyBlock ? `【最新剧情】\n${storyBlock}` : ''].filter(Boolean).join('\n\n');
  }

  /** Synchronizes the current card's protagonist appearance/profile from the open Character Card, opening floor, and `<xeno_update>` history. */
  function syncCardProtagonist(ctx = context(), {forceOpening = false} = {}) {
    if (!ctx || !backend) return null;
    const cardKey = backend.cardKey();
    const routes = backend.routesHere();
    const cur = backend.cardState()?.xeno;
    if (!cur || cur.protagonistCleared) return null;

    // 1. If the chat already has `<xeno_update>` blocks and protagonist/targets are still unpopulated, replay them
    const chat = Array.isArray(ctx.chat) ? ctx.chat : [];
    let stateAfterTags = null;
    if (!cur.protagonist.appearance && chat.length > 0) {
      const combinedTags = chat.slice(-20).map(m => String(m?.mes || '')).filter(t => /<xeno_update\b/i.test(t)).join('\n');
      if (combinedTags) {
        stateAfterTags = applyXenoUpdateFromText(cur, combinedTags, {
          routes,
          protagonistName: ctx.name1 || '',
          cardMembers: backend.space?.members || []
        });
      }
    }

    // 2. Extract protagonist profile from the active Character Card / character_book / opening message / protRoute / persona
    const profile = extractCardProtagonistProfile(ctx, routes, cardKey);
    const targetProt = (stateAfterTags || cur).protagonist;
    const needsFill = forceOpening
      || (!targetProt.name && profile.name)
      || (!targetProt.identity && profile.identity)
      || (!targetProt.gender && profile.gender)
      || (!targetProt.appearance && profile.appearance)
      || (!targetProt.bodyBuild && profile.bodyBuild)
      || (!targetProt.physiology && profile.physiology);

    if (!stateAfterTags && !needsFill) return null;

    return backend.saveXeno(xeno => {
      const next = stateAfterTags ? {...xeno, protagonist: stateAfterTags.protagonist, targets: stateAfterTags.targets, targetPool: stateAfterTags.targetPool} : xeno;
      const p = next.protagonist;
      if (profile.name && (!p.name || p.name === '主角')) p.name = profile.name;
      if (profile.identity && (forceOpening || !p.identity)) p.identity = profile.identity;
      if (!next.possession?.active && !next.fusion?.active) {
        if (profile.gender && (forceOpening || !p.gender)) p.gender = profile.gender;
        if (profile.appearance && (forceOpening || !p.appearance)) p.appearance = profile.appearance;
        if (profile.bodyBuild && (forceOpening || !p.bodyBuild)) p.bodyBuild = profile.bodyBuild;
        if (profile.physiology && (forceOpening || !p.physiology)) p.physiology = profile.physiology;
      }
      if (profile.outerwear && !p.outfit.outerwearItemId && (forceOpening || !p.outfit.outerwear)) p.outfit.outerwear = profile.outerwear;
      if (profile.underwear && !p.outfit.underwearItemId && (forceOpening || !p.outfit.underwear)) p.outfit.underwear = profile.underwear;
      return next;
    });
  }

  /** 1. 附身之术 · 洞察推荐：扫描当前剧情环境，生成《附身价值与颜值评估报告》并自动登记目标角色 */
  function insightRecommend() {
    return run('insight', async ctx => {
      const cur = backend.cardState()?.xeno;
      const knownNames = [cur?.protagonist?.name, ...(cur?.targets || []).map(t => t.name)].filter(Boolean).join(' ');
      const story = await recentStoryText(ctx, knownNames);
      if (!story.trim()) throw Error('当前还没有剧情内容可供洞察分析');
      const prompt = [
        {
          role: 'system',
          content: xenoPromptEntryText(cur, 'insightPrompt') || XENO_PROMPT_DEFAULTS.insightPrompt
        },
        {
          role: 'user',
          content: `【当前剧情与角色背景】\n${story}\n\n请立即生成《附身价值与颜值评估报告》：`
        }
      ];
      const raw = cleanTagged(String(await backend.generateText(ctx, {prompt, responseLength: 1400, trimNames: false}) || ''));
      const blocks = [...raw.matchAll(/<insight>([\s\S]*?)<\/insight>/gi)].map(m => m[1]).join('\n') || raw;
      const lines = blocks.split(/\r?\n/).map(l => l.trim()).filter(l => l.includes('｜') || l.includes('|'));
      const reports = [];
      for (const line of lines) {
        const parts = line.split(/[｜|]/).map(s => s.trim());
        if (parts.length < 6) continue;
        const [name, identity, gender, appearance, bodyBuild, physiology, faceScore = '96', bodyScore = '97', valueAnalysis = '身材极品且身份极具支配价值', recommendation = '近距锁定·浅层共鸣'] = parts;
        if (!name || name === '姓名') continue;
        reports.push({
          name,
          identity: identity || '登场角色',
          gender: GENDERS.includes(gender) ? gender : '女',
          appearance: appearance || '容貌绝美',
          bodyBuild: bodyBuild || '身材曼妙丰满',
          physiology: physiology || '敏感度极高',
          faceScore: String(faceScore).replace(/[^\d.]/g, '') || '96',
          bodyScore: String(bodyScore).replace(/[^\d.]/g, '') || '97',
          valueAnalysis: valueAnalysis || '高价值附身目标',
          recommendation: recommendation || '近距锁定'
        });
      }
      if (!reports.length) throw Error('未能从当前剧情中解析出推荐目标，请重试');
      const next = backend.saveXeno(xeno => {
        xeno.possession.insightReports = reports;
        for (const r of reports) {
          ensureTarget(xeno, r.name, {
            identity: r.identity,
            gender: r.gender,
            appearance: r.appearance,
            bodyBuild: r.bodyBuild,
            physiology: r.physiology
          });
        }
        return xeno;
      });
      notice(`洞察完成：生成了 ${reports.length} 份《附身价值与颜值评估报告》`);
      return next;
    });
  }

  /** 2. 从当前剧情同步主角与登场目标状态栏 */
  function syncFromStory() {
    return run('sync', async ctx => {
      const card = backend.cardState();
      const cur = card.xeno;
      const known = [cur.protagonist.name, ...cur.targets.map(t => t.name)].filter(Boolean).join('、');
      const story = await recentStoryText(ctx, known);
      if (!story.trim()) throw Error('当前还没有剧情内容可供同步');
      const prompt = [
        {
          role: 'system',
          content: xenoPromptEntryText(cur, 'syncPrompt') || XENO_PROMPT_DEFAULTS.syncPrompt
        },
        {
          role: 'user',
          content: `【主角名称】：${userName()}\n【已知角色】：${known}\n\n【最新剧情与设定】\n${story}\n\n请输出 <xeno_sync> 数据块：`
        }
      ];
      const raw = cleanTagged(String(await backend.generateText(ctx, {prompt, responseLength: 1400, trimNames: false}) || ''));
      const block = [...raw.matchAll(/<xeno_sync>([\s\S]*?)<\/xeno_sync>/gi)].map(m => m[1]).join('\n') || raw;
      const lines = block.split(/\r?\n/).map(l => l.trim()).filter(l => l.includes('｜') || l.includes('|'));
      let count = 0;
      const next = backend.saveXeno((xeno, nextState, cardKey) => {
        const scopedRoutes = cardRoutes(nextState?.routes || [], cardKey);
        for (const line of lines) {
          const parts = line.split(/[｜|]/).map(s => s.trim());
          if (parts.length < 6) continue;
          const [kind, name, identity, gender, appearance, bodyBuild, physiology, outerwear, underwear] = parts;
          if (!name || name === '姓名' || name === '旁白') continue;
          const matchedRoute = findRoute(scopedRoutes, name);
          if (matchedRoute && roleTypeOf(matchedRoute) === 'narrator') continue;
          const isProt = (matchedRoute && roleTypeOf(matchedRoute) === 'protagonist') || kind.includes('主角') || name === xeno.protagonist.name || name === userName();
          const ent = isProt ? xeno.protagonist : ensureTarget(xeno, name);
          if (isProt) {
            xeno.protagonistCleared = false;
            if (name) ent.name = name;
          }
          if (identity) ent.identity = identity;
          if (GENDERS.includes(gender)) ent.gender = gender;
          if (appearance) ent.appearance = appearance;
          if (bodyBuild) ent.bodyBuild = bodyBuild;
          if (physiology) ent.physiology = physiology;
          if (outerwear) ent.outfit.outerwear = outerwear;
          if (underwear) ent.outfit.underwear = underwear;
          count++;
        }
        return xeno;
      });
      if (!count) throw Error('未能从回复中提取到有效状态行，请重试');
      notice(`已从剧情同步 ${count} 名角色的状态栏数据`);
      return next;
    });
  }

  /** 3. 购物商城 AI 进货（支持上传图片 imageData 多模态识图 + 文字描述生成新货上架） */
  function mallRestock({category = 'apparel', slot = 'outerwear', text = '', imageData = ''} = {}) {
    return run('restock', async ctx => {
      const cur = backend.cardState()?.xeno;
      const preUser = xenoPromptEntryText(cur, 'restockPreUser');
      const preAssistant = xenoPromptEntryText(cur, 'restockPreAssistant');
      const sysHeader = xenoPromptEntryText(cur, 'restockSysHeader') || XENO_PROMPT_DEFAULTS.restockSysHeader;
      const WORKBENCH_SCALE_RULE = xenoPromptEntryText(cur, 'scaleRule') || XENO_PROMPT_DEFAULTS.scaleRule;
      const WORKBENCH_POSE_PROMPT = xenoMallPosePromptText(cur);
      const WORKBENCH_SKIN_SUIT_RULE = xenoPromptEntryText(cur, 'skinWorkbench') || XENO_PROMPT_DEFAULTS.skinWorkbench;
      const WORKBENCH_FLESH_RING_RULE = xenoPromptEntryText(cur, 'ringWorkbench') || XENO_PROMPT_DEFAULTS.ringWorkbench;
      const WORKBENCH_APPAREL_RULE = xenoPromptEntryText(cur, 'apparelWorkbench') || XENO_PROMPT_DEFAULTS.apparelWorkbench;

      const xmlTag = category === 'skin_suit' ? 'skin_suit_design' : category === 'flesh_ring' ? 'flesh_ring_design' : 'apparel_design';
      const workbenchRule = category === 'skin_suit'
        ? WORKBENCH_SKIN_SUIT_RULE
        : category === 'flesh_ring'
          ? WORKBENCH_FLESH_RING_RULE
          : WORKBENCH_APPAREL_RULE;
      const catTitle = category === 'skin_suit' ? '活体皮躯' : category === 'flesh_ring' ? '活体肉躯' : category === 'consumable' ? '异构生物道具' : '高定特殊服饰';

      const sysPrompt = [
        sysHeader,
        WORKBENCH_SCALE_RULE,
        workbenchRule,
        WORKBENCH_POSE_PROMPT ? `【商品图固定姿势与构图 Tag 要求】：在生成 [生图提示词 (Prompt)] 时，请包含或优先适配以下构图与姿势 Tag：${WORKBENCH_POSE_PROMPT}` : '',
        '请额外在设计块外层附上简要上架元数据（价格：数字 200~3500；简称：4~8字），或直接严格输出上述 XML 设计块。'
      ].filter(Boolean).join('\n\n');

      const cleanInput = text.trim();
      const userText = imageData
        ? (cleanInput
          ? `【设计工作台输入】：${cleanInput}\n【目标分类】：${catTitle}（槽位：${slot}）\n请仔细观察所附参考图中的人物外貌、身材或服装剪裁款式，结合上述文字要求将其100%还原转化为工作台设定档案。\n请严格按照 <${xmlTag} name="..."> 格式输出设定档案：`
          : `【设计工作台输入】：请仔细观察所附参考图中的人物外貌、身材或服装剪裁款式，将其100%逆向还原转化为【${catTitle}】（槽位：${slot}）的工作台设定档案。\n请严格按照 <${xmlTag} name="..."> 格式输出设定档案：`)
        : (cleanInput
          ? `【设计工作台输入】：${cleanInput}\n【目标分类】：${catTitle}（槽位：${slot}）\n请严格按照 <${xmlTag} name="..."> 格式输出设定档案：`
          : `【设计工作台输入】：请自由发挥创意，设计一件极具魅力与反差感的全新【${catTitle}】（槽位：${slot}）。\n请严格按照 <${xmlTag} name="..."> 格式输出设定档案：`);

      const preMessages = [
        ...(preUser ? [{role: 'user', content: preUser}] : []),
        ...(preAssistant ? [{role: 'assistant', content: preAssistant}] : [])
      ];
      const messages = [
        ...preMessages,
        {role: 'system', content: sysPrompt},
        {
          role: 'user',
          content: imageData
            ? [
                {type: 'text', text: userText},
                {type: 'image_url', image_url: {url: imageData}}
              ]
            : userText
        }
      ];

      const isRefusalOrEmpty = str => {
        const s = String(str || '').trim();
        if (!s || s.length < 25) return true;
        if (new RegExp(`<${xmlTag}[\\s\\S]*?>`, 'i').test(s)) return false;
        return /(?:I cannot|I'm sorry|I am unable|as an AI|cannot fulfill|explicit|NSFW|无法满足|抱歉.*无法|不能生成|违反.*政策)/i.test(s);
      };

      let raw = '';
      try {
        raw = await generateRestockText(ctx, messages, !!imageData);
      } catch (err) {
        if (imageData) {
          const fallbackText = cleanInput
            ? `【设计工作台输入】：${cleanInput}\n【目标分类】：${catTitle}（槽位：${slot}）\n请严格按照 <${xmlTag} name="..."> 格式输出设定档案：`
            : `【设计工作台输入】：请自由发挥创意，设计一件极具魅力与反差感的全新【${catTitle}】（槽位：${slot}）。\n请严格按照 <${xmlTag} name="..."> 格式输出设定档案：`;
          const fallbackPrompt = [
            ...preMessages,
            {role: 'system', content: sysPrompt},
            {role: 'user', content: fallbackText}
          ];
          raw = await generateRestockText(ctx, fallbackPrompt, false);
        } else {
          throw err;
        }
      }

      // 若模型因敏感词限制拒绝或未返回有效内容，自动切换为安全高定美学工作台提示词重试
      if (isRefusalOrEmpty(raw)) {
        const safeSysPrompt = [
          sysHeader,
          `<${xmlTag} name="单品名称">`,
          category === 'skin_suit'
            ? '[外观视觉还原]：(发色、发型、瞳色、五官神态与整体气质)\n[体态参数]：(身高145-178cm、胸围罩杯、腰臀比、腿部线条与肌肤质感)\n[扶她生理构造]：(人体工学比例下的生理特征与质感描述)\n[穿戴接口与机能]：(背部隐形穿戴接口、内部包裹感与声带/体香同步机能)\n[生图提示词 (Prompt)]：(高质量英文 Danbooru tag 串)'
            : category === 'flesh_ring'
              ? '[静息环体外观]：(未激活时的精致环状材质、色泽、纹路与穿戴位置)\n[前方延展·器官重构]：(向前重构的生理结构与尺寸特征)\n[后方延展·躯体重构]：(向后蔓延包裹全身后重构出的发色、瞳色、面容、胸臀体态与外层仿生衣物)\n[生图提示词 (Prompt)]：(提取后方延展完全体形态的英文 Danbooru tag 串)'
              : '[款式与定位]：(服装风格、适用场景与核心视觉冲击点)\n[材质与色彩]：(主面料、薄纱、皮革/金属配件的质感、反光与贴肤度)\n[剪裁与暴露结构]：(从上到下详细拆解领口、胸线、腰腹、臀侧、裙摆/裤装的剪裁细节与镂空/开叉设计)\n[穿戴互动与机关]：(穿脱方式、隐藏暗扣与对身体曲线的修饰效果)\n[生图提示词 (Prompt)]：(仅针对该套服装与穿搭效果输出精准的英文 Danbooru 服装 tag 串)',
          `</${xmlTag}>`
        ].join('\n');
        const safeMessages = [
          ...preMessages,
          {role: 'system', content: safeSysPrompt},
          {
            role: 'user',
            content: imageData
              ? [
                  {type: 'text', text: userText},
                  {type: 'image_url', image_url: {url: imageData}}
                ]
              : userText
          }
        ];
        try {
          raw = await generateRestockText(ctx, safeMessages, !!imageData);
        } catch {}
      }

      const cleaned = cleanTagged(raw);
      const body = cleaned.match(/<restock_item>([\s\S]*?)<\/restock_item>/i)?.[1] || cleaned;
      const pick = label => body.match(new RegExp(`(?:^|\\n)\\s*${label}\\s*[:：]\\s*([^\\n]+)`))?.[1]?.trim() || '';
      const pickSection = label => {
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return body.match(new RegExp(`\\[${escaped}\\]\\s*[:：]?\\s*([\\s\\S]*?)(?=\\n\\s*\\[|\\n\\s*<\\/${xmlTag}>|$)`, 'i'))?.[1]?.trim() || '';
      };
      const xmlAttrName = body.match(new RegExp(`<${xmlTag}\\s+[^>]*name=["']([^"']+)["']`, 'i'))?.[1]?.trim() || '';
      const designMatch = body.match(new RegExp(`<${xmlTag}[\\s\\S]*?<\\/${xmlTag}>`, 'i'))?.[0] || body.trim();

      const rawName = xmlAttrName || pick('名称') || (text.trim() ? text.trim().slice(0, 16) : '异构高定新货');
      const name = rawName.startsWith('【') ? rawName : `【${rawName.replace(/^[【\[]|[】\]]$/g, '')}】`;
      const shortName = pick('简称') || rawName.replace(/[【】\[\]]/g, '').split(/[·・\s]/)[0].slice(0, 12);
      const price = Number(pick('价格').replace(/[^\d]/g, '')) || 1280;
      const gender = GENDERS.includes(pick('性别')) ? pick('性别') : (category === 'skin_suit' || category === 'flesh_ring' ? '扶她' : '');

      const secVisual = pickSection('外观视觉还原') || pickSection('款式与定位');
      const secBody = pickSection('体态参数') || pickSection('材质与色彩');
      const secPhysio = pickSection('扶她生理构造') || pickSection('剪裁与暴露结构');
      const secMech = pickSection('穿戴接口与机能') || pickSection('穿戴互动与机关');
      const secRing = pickSection('静息环体外观');
      const secForward = pickSection('前方延展·器官重构');
      const secBackward = pickSection('后方延展·躯体重构');
      const secPrompt = pickSection('生图提示词 (Prompt)') || pickSection('生图提示词');

      const appearance = pick('外貌特征') || secVisual || secBackward || '';
      const bodyBuild = pick('体型身材') || secBody || secBackward || '';
      const physiology = pick('生理特征') || secPhysio || secForward || secMech || '';
      const summary = (pick('简介') || secVisual || secRing || appearance || bodyBuild || '商城定制进货单品').replace(/\s+/g, ' ').slice(0, 90);
      const drawPrompt = (pick('生图提示词') || secPrompt || '').replace(/^[(（]|[)）]$/g, '').trim();

      const newItem = normalizeCatalogItem({
        id: 'restock_' + crypto.randomUUID(),
        name,
        shortName,
        category,
        slot: category === 'skin_suit' ? 'skin_suit' : category === 'flesh_ring' ? 'flesh_ring' : category === 'consumable' ? 'consumable' : slot,
        price,
        owned: false,
        source: 'restock',
        effectKind: category === 'consumable' ? 'body' : '',
        gender,
        appearance,
        bodyBuild,
        physiology,
        ringAppearance: category === 'flesh_ring' ? (secRing || appearance || '定制活体肉躯环') : '',
        forwardExtension: category === 'flesh_ring' ? (secForward || physiology || '向前方增殖重构为扶她肉棒器官') : '',
        backwardExtension: category === 'flesh_ring' ? (secBackward || `向后方全身蔓延包裹，重构为：${appearance}；${bodyBuild}`) : '',
        summary,
        drawPrompt,
        rawDesign: designMatch,
        imageData: imageData || ''
      });

      backend.saveXeno(xeno => {
        xeno.items = [newItem, ...xeno.items];
        return xeno;
      });
      notice(`商城进货成功：${newItem.name} 已上架！`);
      return newItem;
    });
  }

  return {
    insightRecommend,
    syncFromStory,
    syncCardProtagonist,
    mallRestock,
    busy: kind => kind ? !!busy[kind] : !!(busy.insight || busy.sync || busy.restock)
  };
}
