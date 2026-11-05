// Tavern host bridge for RevoPhone's 异构终端 (xeno) & 购物商城 (mall):
// 1. 洞察推荐 (AI scans current story & generates 《附身价值与颜值评估报告》 + populates targets)
// 2. 从剧情同步状态 (AI extracts protagonist & target 6-field status bars from recent story)
// 3. 商城进货 (AI generates new <skin_suit_design> / <flesh_ring_design> / <apparel_design> items from image and/or text)

import {storyLines} from './core/moments.js';
import {activeChatPreset, cleanTagged} from './core/chat.js';
import {cardRoutes, findRoute, roleTypeOf} from './core/routes.js';
import {ensureTarget, normalizeCatalogItem, GENDERS} from './core/xeno.js';

export function createXenoHost({context, settings, backend, notice = () => {}}) {
  const busy = {insight: null, sync: null, restock: null};
  const userName = () => context()?.name1 || settings()?.xeno?.protagonist?.name || '主角';

  function run(kind, task) {
    if (busy[kind]) return busy[kind];
    busy[kind] = (async () => {
      backend.emit('xeno', {busy: kind, active: true});
      return await task(context());
    })().finally(() => {
      busy[kind] = null;
      backend.emit('xeno', {busy: kind, active: false});
    });
    return busy[kind];
  }

  function recentStoryText(ctx) {
    const s = settings();
    const preset = activeChatPreset(s.chat);
    const lines = storyLines(ctx?.chat || [], preset, userName()).slice(-16);
    const charCard = ctx?.characters?.[ctx?.characterId];
    const cardDesc = charCard ? `【当前角色卡：${charCard.name || ''}】\n${String(charCard.description || '').slice(0, 1200)}` : '';
    const storyBlock = lines.map(r => `${r.name}: ${r.text}`).join('\n');
    return [cardDesc, storyBlock].filter(Boolean).join('\n\n');
  }

  /** 1. 附身之术 · 洞察推荐：扫描当前剧情环境，生成《附身价值与颜值评估报告》并自动登记目标角色 */
  function insightRecommend() {
    return run('insight', async ctx => {
      const story = recentStoryText(ctx);
      if (!story.trim()) throw Error('当前还没有剧情内容可供洞察分析');
      const prompt = [
        {
          role: 'system',
          content: '你是【异构终端】的「洞察推荐」扫描引擎。请根据当前故事上下文与角色设定，扫描当前场景中在场或可锁定的高颜值女性角色（1至4名），生成《附身价值与颜值评估报告》，同时提取其状态栏六项基础数据。\n严格按照以下每行一条的格式输出（不要输出多余解释）：\n<insight>\n姓名｜身份｜性别(女/扶她)｜外貌特征(发色瞳色五官气质)｜体型身材(身高/三围/罩杯/腰臀腿细节)｜生理特征(敏感带与身体特质)｜颜值评分(90-100)｜身材评分(90-100)｜附身价值剖析(为什么值得附身、身份便利与身体玩法价值)｜推荐切入方式(近距锁定·浅层共鸣 / 近距锁定·认知覆盖 / 灵体游离·完全占据)\n</insight>'
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
      const story = recentStoryText(ctx);
      if (!story.trim()) throw Error('当前还没有剧情内容可供同步');
      const card = backend.cardState();
      const cur = card.xeno;
      const known = [cur.protagonist.name, ...cur.targets.map(t => t.name)].filter(Boolean).join('、');
      const prompt = [
        {
          role: 'system',
          content: '你是【异构终端】的实时状态栏提取引擎。请根据最新剧情与角色设定，提取主角以及剧情中登场的目标角色当前的六项基础状态与衣着。\n注意：不需要输出性格！\n每名角色占一行，格式严格如下：\n<xeno_sync>\n角色类别(主角/目标)｜姓名｜身份｜性别(男/女/扶她)｜外貌特征｜体型身材(含身高三围罩杯等具体特征)｜生理特征｜外搭衣物｜内衣裤装\n</xeno_sync>'
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
          if (isProt && name) ent.name = name;
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
      const catLabel = {
        skin_suit: '活体皮躯（完整的第二具人形生物躯体，含扶她生理构造与背部脊椎穿戴接口）',
        flesh_ring: '活体肉躯（环状活体增殖道具，含静息饰品形态、前方延展肉棒重构、后方延展全身躯体重构）',
        apparel: '高定特殊服饰/内衣/遮挡贴/饰品（注重剪裁、材质反光、镂空暴露度与机关设计）',
        consumable: '异构生物道具/催情或改造消耗品'
      }[category] || '高定特殊服饰';

      const xmlTag = category === 'skin_suit' ? 'skin_suit_design' : category === 'flesh_ring' ? 'flesh_ring_design' : 'apparel_design';
      const sysPrompt = [
        `你是【异构购物商城】的首席生物与高定设计师。请根据用户提供的${imageData ? '参考图片与' : ''}文字要求，为商城设计并上架 1 件全新的【${catLabel}】。`,
        '必须严格按以下格式输出（字段齐全，细节极具张力与画面感，并提供英文 Danbooru 生图提示词）：',
        '<restock_item>',
        '名称：单品完整名称（如：【圣洁修女·祈祷者】）',
        '简称：简短名称（如：圣洁修女）',
        '价格：数字（200~3500之间）',
        `性别：${category === 'skin_suit' || category === 'flesh_ring' ? '扶她 或 女' : '女'}`,
        '外貌特征：发色、发型、瞳色、面容气质描述（皮躯/肉躯必填，服饰可写穿戴视觉效果）',
        '体型身材：身高、罩杯乳量、腰臀腿比例与肌肤质感描述',
        `生理特征：${category === 'flesh_ring' ? '前方延展肉棒尺寸形态与后方延展外躯特征' : '私密部位、扶她器官或穿戴后的生理反馈'}`,
        '简介：一句话核心卖点摘要（60字以内）',
        '生图提示词：英文 Danbooru tag 串（如 1girl, nun habit, side slit, pelvic curtain, cross necklace...）',
        '详细设定：',
        `<${xmlTag} name="单品完整名称">`,
        '（按高定档案格式写出 [外观视觉还原] / [体态参数] / [生理构造与穿戴机能] / [生图提示词 (Prompt)] 完整块）',
        `</${xmlTag}>`,
        '</restock_item>'
      ].join('\n');

      const userText = text.trim()
        ? `【进货要求 / 灵感描述】：${text.trim()}\n【目标分类】：${catLabel}（槽位：${slot}）`
        : `【进货要求】：请自由发挥创意，设计一件极具魅力与反差感的全新【${catLabel}】（槽位：${slot}）`;

      const messages = [
        {role: 'system', content: sysPrompt},
        {
          role: 'user',
          content: imageData
            ? [
                {type: 'text', text: userText + '\n请仔细观察所附图片中的人物外貌、身材或服装款式，将其还原转化为商城单品：'},
                {type: 'image_url', image_url: {url: imageData}}
              ]
            : userText
        }
      ];

      let raw = '';
      try {
        raw = String(await backend.generateText(ctx, {prompt: messages, responseLength: 1800, trimNames: false}) || '');
      } catch (err) {
        if (imageData) {
          const fallbackPrompt = [
            {role: 'system', content: sysPrompt},
            {role: 'user', content: userText}
          ];
          raw = String(await backend.generateText(ctx, {prompt: fallbackPrompt, responseLength: 1800, trimNames: false}) || '');
        } else {
          throw err;
        }
      }

      const cleaned = cleanTagged(raw);
      const body = cleaned.match(/<restock_item>([\s\S]*?)<\/restock_item>/i)?.[1] || cleaned;
      const pick = label => body.match(new RegExp(`(?:^|\\n)\\s*${label}\\s*[:：]\\s*([^\\n]+)`))?.[1]?.trim() || '';
      const designMatch = body.match(new RegExp(`<${xmlTag}[\\s\\S]*?<\\/${xmlTag}>`, 'i'))?.[0] || body.trim();

      const name = pick('名称') || (text.trim() ? `【${text.trim().slice(0, 16)}】` : '【异构高定新货】');
      const shortName = pick('简称') || name.replace(/[【】\[\]]/g, '').slice(0, 12);
      const price = Number(pick('价格').replace(/[^\d]/g, '')) || 1280;
      const gender = GENDERS.includes(pick('性别')) ? pick('性别') : (category === 'skin_suit' || category === 'flesh_ring' ? '扶她' : '');
      const appearance = pick('外貌特征');
      const bodyBuild = pick('体型身材');
      const physiology = pick('生理特征');
      const summary = pick('简介') || appearance || bodyBuild || '商城定制进货单品';
      const drawPrompt = pick('生图提示词');

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
        ringAppearance: category === 'flesh_ring' ? (appearance || '定制活体肉躯环') : '',
        forwardExtension: category === 'flesh_ring' ? (physiology || '向前方增殖重构为雄伟肉棒器官') : '',
        backwardExtension: category === 'flesh_ring' ? `向后方全身蔓延包裹，重构为：${appearance}；${bodyBuild}` : '',
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
    mallRestock,
    busy: kind => kind ? !!busy[kind] : !!(busy.insight || busy.sync || busy.restock)
  };
}
