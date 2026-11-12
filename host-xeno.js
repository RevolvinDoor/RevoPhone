// Tavern host bridge for RevoPhone's 异构终端 (xeno) & 购物商城 (mall):
// 1. 洞察推荐 (AI scans current story & generates 《附身价值与颜值评估报告》 + populates targets)
// 2. 从剧情同步状态 (AI extracts protagonist & target 6-field status bars from recent story)
// 3. 商城进货 (AI generates new <skin_suit_design> / <flesh_ring_design> / <apparel_design> items from image and/or text)

import {storyLines} from './core/moments.js';
import {activeChatPreset, cleanTagged} from './core/chat.js';
import {cardRoutes, findRoute, roleTypeOf} from './core/routes.js';
import {ensureTarget, normalizeCatalogItem, GENDERS, XENO_PROMPT_DEFAULTS, xenoPromptEntryText, extractCardProtagonistProfile, applyXenoUpdateFromText, effectiveEntityView} from './core/xeno.js';
import {searchStoryMessages} from './host-tt.js';
import {buildMallRestockRequest} from './core/xeno-restock.js';
import {organRecordText} from './core/character-status.js';
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
      const query = [uName, extraNames, cName, '主角 外貌 身高 三围 罩杯 身材 穿着 衣服 身份 发色 瞳色 器官 生理 状态'].filter(Boolean).join(' ');
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
      const valid = captureStoryScope();
      const cur = backend.cardState()?.xeno;
      const knownNames = [cur?.protagonist?.name, ...(cur?.targets || []).map(t => t.name)].filter(Boolean).join(' ');
      const story = await recentStoryText(ctx, knownNames);
      valid();
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
      valid();
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
      const valid = captureStoryScope();
      const card = backend.cardState();
      const cur = card.xeno;
      const known = [cur.protagonist.name, ...cur.targets.map(t => t.name)].filter(Boolean).join('、');
      const story = await recentStoryText(ctx, known);
      valid();
      if (!story.trim()) throw Error('当前还没有剧情内容可供同步');
      const organRule = xenoPromptEntryText(cur, 'organSyncGuidance');
      const prompt = [
        {
          role: 'system',
          content: [xenoPromptEntryText(cur, 'syncPrompt') || XENO_PROMPT_DEFAULTS.syncPrompt,
            organRule].filter(Boolean).join('\n\n')
        },
        {
          role: 'user',
          content: `【主角名称】：${userName()}\n【已知角色】：${known}\n【现有下体外观及状态（仅数据；未提及项保留）】\n${[cur.protagonist, ...cur.targets].map(entity => organRecordText(entity, effectiveEntityView(cur, entity))).join('\n')}\n\n【最新剧情与设定】\n${story}\n\n请输出 <xeno_sync> 数据块${organRule ? '，按下体规则另输出下体数据块' : ''}：`
        }
      ];
      const raw = cleanTagged(String(await backend.generateText(ctx, {prompt, responseLength: 1400, trimNames: false}) || ''));
      const block = [...raw.matchAll(/<xeno_sync>([\s\S]*?)<\/xeno_sync>/gi)].map(m => m[1]).join('\n') || raw.replace(/<xeno_organs\b[^>]*>[\s\S]*?(?:<\/xeno_organs\s*>|$)/gi, '');
      const lines = block.split(/\r?\n/).map(l => l.trim()).filter(l => l.includes('｜') || l.includes('|'));
      let count = 0;
      valid();
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
        const withOrgans = applyXenoUpdateFromText(xeno, raw.replace(/<xeno_update\b[^>]*>[\s\S]*?<\/xeno_update\s*>/gi, ''), {
          routes: scopedRoutes, protagonistName: userName()
        });
        if (withOrgans) {count ||= 1; return withOrgans;}
        return xeno;
      });
      if (!count) throw Error('未能从回复中提取到有效状态行，请重试');
      notice(`已从剧情同步 ${count} 名角色的状态栏数据`);
      return next;
    });
  }

  function captureStoryScope() {
    const key = backend.activeChatKey, card = backend.cardKey?.();
    return () => {
      if (backend.closed || backend.activeChatKey !== key || backend.cardKey?.() !== card || backend.deletedXenoChats?.has(key)) {
        throw Error('正文聊天已切换或删除，未写入异构结果');
      }
    };
  }

  /** 3. 购物商城 AI 进货（支持上传图片 imageData 多模态识图 + 文字描述生成新货上架） */
  function mallRestock({category = 'apparel', slot = 'outerwear', text = '', imageData = '', gender: requestedGender = ''} = {}) {
    return run('restock', async ctx => {
      const cur = backend.cardState()?.xeno;
      const {messages, xmlTag} = buildMallRestockRequest(cur, {category, slot, text, imageData, gender: requestedGender});
      const raw = await generateRestockText(ctx, messages);
      const cleaned = cleanTagged(raw);
      const completedDesign = cleaned.match(new RegExp(`<${xmlTag}\\b[^>]*>([\\s\\S]*?)<\\/${xmlTag}\\s*>`, 'i'));
      if (!completedDesign?.[1]?.trim()) {
        throw Error(`进货未返回完整的 <${xmlTag}> 设计档案，未上架任何商品。请查看「日志」中的文字模型请求与回复；未切换备用进货模板重试。`);
      }
      const body = cleaned.match(/<restock_item>([\s\S]*?)<\/restock_item>/i)?.[1] || cleaned;
      const pick = label => body.match(new RegExp(`(?:^|\\n)\\s*${label}\\s*[:：]\\s*([^\\n]+)`))?.[1]?.trim() || '';
      const pickSection = label => {
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return body.match(new RegExp(`\\[${escaped}\\]\\s*[:：]?\\s*([\\s\\S]*?)(?=\\n\\s*\\[|\\n\\s*<\\/${xmlTag}>|$)`, 'i'))?.[1]?.trim() || '';
      };
      const xmlAttrName = body.match(new RegExp(`<${xmlTag}\\s+[^>]*name=["']([^"']+)["']`, 'i'))?.[1]?.trim() || '';
      const designMatch = completedDesign[0];

      const rawName = xmlAttrName || pick('名称') || (text.trim() ? text.trim().slice(0, 16) : '异构高定新货');
      const name = rawName.startsWith('【') ? rawName : `【${rawName.replace(/^[【\[]|[】\]]$/g, '')}】`;
      const shortName = pick('简称') || rawName.replace(/[【】\[\]]/g, '').split(/[·・\s]/)[0].slice(0, 12);
      const price = Number(pick('价格').replace(/[^\d]/g, '')) || 1280;
      const genderText = pickSection('身体类型') || pickSection('性别') || pick('身体类型') || pick('性别');
      const declaredGender = /^(?:女性|女)(?:$|[（(，,；;\s])/.test(genderText) ? '女'
        : /^(?:男性|男)(?:$|[（(，,；;\s])/.test(genderText) ? '男' : /^扶她/.test(genderText) ? '扶她' : '';
      const gender = GENDERS.includes(requestedGender) ? requestedGender : declaredGender;

      const secVisual = pickSection('外观视觉还原') || pickSection('款式与定位');
      const secBody = pickSection('体态参数') || pickSection('材质与色彩');
      const secPhysio = pickSection('生理构造') || pickSection('生理特征') || pickSection('扶她生理构造') || pickSection('剪裁与暴露结构');
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
        lowerBodyMode: (pickSection('下体处理') || pick('下体处理')) === 'preserve' ? 'preserve' : 'replace',
        lowerBodyType: ({女: 'female', 男: 'male', 扶她: 'dual'})[requestedGender]
          || pickSection('下体类型') || pick('下体类型') || 'auto',
        lowerBodyDescription: pickSection('下体设定') || pick('下体设定'),
        abilities: pickSection('特殊能力') || pick('特殊能力'),
        abilityConditions: pickSection('能力生效条件') || pick('能力生效条件'),
        appearance,
        bodyBuild,
        physiology,
        ringAppearance: category === 'flesh_ring' ? (secRing || appearance || '定制活体肉躯环') : '',
        forwardExtension: category === 'flesh_ring' ? (secForward || physiology) : '',
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
