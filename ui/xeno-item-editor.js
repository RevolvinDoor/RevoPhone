import {esc} from './common.js';
import {GENDERS, itemVoiceRef, formatVoiceRoleLabel, parseItemTextBlock, normalizeCharacterDrawPrompt, normalizeOrganDrawPrompt, splitItemDrawPrompts} from '../core/xeno.js';
import {openItemVoiceListPicker, openVoicePoolPickerDialog} from './xeno-media.js';

const categories = [['skin_suit', '皮躯'], ['flesh_ring', '肉躯'], ['apparel', '服饰与饰品']];
const mallCategories = [...categories, ['consumable', '异构道具']];
const select = (key, label, value, choices) => `<label class="xeno-field-inline"><span>${esc(label)}</span><select class="xeno-select" data-item="${key}">${choices.map(([id, title]) => `<option value="${id}" ${id === value ? 'selected' : ''}>${esc(title)}</option>`).join('')}</select></label>`;
const field = (item, key, label, max, rows = 2) => `<label class="xeno-field-inline"><span>${esc(label)}</span><textarea class="xeno-textarea" data-item="${key}" rows="${rows}" maxlength="${max}">${esc(item[key] || '')}</textarea></label>`;

export function itemStructureFields(item) {
  return select('gender', '身体类型', item.gender || '', [['', '未设定'], ...GENDERS.map(value => [value, value])])
    + select('lowerBodyMode', '下体处理', item.lowerBodyMode || 'legacy', [
      ['replace', '使用本件装备的结构'], ['preserve', '保留内层／本体结构'], ['legacy', '旧版兼容规则']
    ])
    + select('lowerBodyType', '本件下体类型', item.lowerBodyType || 'auto', [
      ['auto', '跟随本件身体类型'], ['female', '女性结构'], ['male', '男性结构'], ['dual', '双性结构'], ['none', '无独立结构'], ['custom', '自定义结构']
    ])
    + field(item, 'lowerBodyDescription', '下体设定（可选，描述结构与覆盖方式）', 1000)
    + '<p class="xeno-hint">皮躯的本层下体开关启用时生效；肉躯还需前方延展开启。选择保留，或关闭本层开关时，取下一有效内层／本体。女性结构不会自动附加男性部位。旧装备可先保留兼容规则，再按需要修改。</p>'
    + field(item, 'abilities', '特殊能力（每行一项，可留空）', 4000, 4)
    + field(item, 'abilityConditions', '能力生效条件、代价及限制', 2000, 3)
    + '<p class="xeno-hint">穿戴后把能力与条件提供给剧情模型；脱下后停止提供。这里记录玩法设定，不会自动执行未实现的数值系统或脚本。</p>'
    + field(item, 'ringAppearance', '肉躯静息外观（其他分类可留空）', 800)
    + field(item, 'forwardExtension', '前方延展设定（按本件结构，不限定男性）', 1000)
    + field(item, 'backwardExtension', '后方延展设定', 1000);
}

export function readItemStructure(root) {
  return Object.fromEntries(['gender', 'lowerBodyMode', 'lowerBodyType', 'lowerBodyDescription', 'abilities',
    'abilityConditions', 'ringAppearance', 'forwardExtension', 'backwardExtension']
    .map(key => [key, root.querySelector(`[data-item="${key}"]`)?.value?.trim() || '']));
}

export function openItemEditor(ctx, {item = null, category = 'skin_suit', destination = 'wardrobe', slot = 'outerwear', gender, initialText = '', onSaved} = {}) {
  const creating = !item, stocking = creating && destination === 'mall', {api} = ctx;
  const initialParsed = creating && String(initialText || '').trim()
    ? parseItemTextBlock(initialText, {fallbackCategory: category})
    : {};
  const baseItem = item || {id: (stocking ? 'restock_' : 'crafted_') + crypto.randomUUID(), category, slot,
    gender: gender ?? (stocking ? '' : '女'), lowerBodyMode: 'replace', lowerBodyType: 'auto'};
  const value = creating && Object.keys(initialParsed).length
    ? {...baseItem, ...initialParsed, category: initialParsed.category || category, slot: initialParsed.slot || slot,
      gender: gender || initialParsed.gender || (stocking ? '' : '女')}
    : baseItem;
  const living = ['skin_suit', 'flesh_ring'].includes(value.category);
  let currentVoice = creating ? '' : itemVoiceRef(api.getState().xeno, value), voiceChanged = false;
  const d = ctx.dialog(stocking ? '手动录入商品' : creating ? '登记自制装备' : `编辑 · ${value.name}`, `<div class="xeno-sheet-form">
    ${stocking ? '<p class="xeno-hint">完全手动填写，直接上架为未购买商品，不调用文字模型或自动绘图，不扣钱包。无需编写 XML；上架后可在商品卡上传图片，也可另行选择生图。</p>'
      : creating ? '<p class="xeno-hint">将剧情中自制、获赠或已获得的装备直接收入衣柜，不扣钱包、不自动上架商店，也不会自动穿戴。普通字段即可保存，无需编写 XML。</p>' : ''}
    <div class="xeno-field-inline">
      <span>⚡ 整段提示词 / 设定智能识别导入（粘贴完整设定、XML、[标签] 或中英混合大段提示词自动拆分填入）</span>
      <textarea class="xeno-textarea" data-item="smartInput" rows="3" maxlength="8000" placeholder="可直接粘贴一整段包含名称、外貌、体型、前方/后方延展、角色提示词、肉棒提示词或完整 XML 的内容，点击下方按钮或直接保存即可自动识别导入…">${esc(initialText || '')}</textarea>
      <div class="xeno-row-controls" style="margin-top:4px"><button type="button" class="secondary" data-editor-smart-parse>⚡ 智能识别并填入下方字段</button></div>
    </div>
    ${value.imageData ? `<img class="wardrobe-sheet-img" src="${esc(value.imageData)}" alt="">` : ''}
    ${creating ? select('category', stocking ? '商品分类' : '装备分类', value.category || category, stocking ? mallCategories : categories) : `<p class="xeno-hint">分类：${esc(mallCategories.find(([id]) => id === value.category)?.[1] || value.category)}</p>`}
    <label class="xeno-field-inline"><span>装备名称</span><input class="xeno-input" data-item="name" maxlength="160" value="${esc(value.name || '')}"></label>
    <label class="xeno-field-inline"><span>简称</span><input class="xeno-input" data-item="shortName" maxlength="80" value="${esc(value.shortName || '')}"></label>
    ${select('slot', '服饰槽位（皮躯／肉躯按分类自动确定）', value.slot || 'outerwear', [
      ['outerwear', '外搭衣物'], ['underwear', '内衣裤装'], ['privacyCover', '隐私遮挡'], ['accessories', '附加饰品']
    ])}
    ${field(value, 'summary', '简介', 400)}
    ${stocking || value.category === 'consumable' ? `<div data-item-consumable ${value.category !== 'consumable' ? 'hidden' : ''}>
      ${select('effectKind', '道具效果', value.effectKind || 'cognition', [
        ['cognition', '认知规则（以简介为内容）'], ['body', '身体改造（现有固定效果）'], ['physiology', '生理变化（现有固定效果）']
      ])}
      <p class="xeno-hint">道具沿用商城现有使用逻辑；身体改造和生理变化有固定效果，填写简介不会创建新的数值效果。按简介添加角色认知规则时请选择「认知规则」。</p>
    </div>` : ''}
    ${field(value, 'appearance', '外貌特征', 1000)}
    ${field(value, 'bodyBuild', '体型身材', 1000)}
    ${field(value, 'physiology', '生理特征', 1000)}
    ${itemStructureFields(value)}
    ${living || creating ? `<div class="xeno-field-inline"><span>绑定音色</span>
      <p class="xeno-hint" data-item-voice-label>${esc(formatVoiceRoleLabel(currentVoice, api.getState().voicePool) || '未绑定，使用本体音色')}</p>
      <div class="xeno-row-controls"><button type="button" class="secondary" data-editor-voice="list">从列表选</button><button type="button" class="secondary" data-editor-voice="favorites">从收藏夹选</button></div></div>` : ''}
    ${field(value, 'drawPrompt', '角色生图提示词（一律不加 futanari）', 1500)}
    ${field(value, 'organDrawPrompt', '肉棒生图提示词（固定含 futanari，仅肉棒/前方延展生效，无肉棒可留空）', 1500)}
    ${field(value, 'rawDesign', '补充设定／原始 XML（可选）', 6000, 5)}
    ${!creating || stocking ? `<label class="xeno-field-inline"><span>商店售价</span><input class="xeno-input" type="number" min="0" max="999999" step="1" data-item="price" value="${value.price || 0}"></label>` : ''}
    ${!creating ? `<label class="xeno-field-inline"><span>在商店展示</span><input type="checkbox" data-item-listed ${value.listed !== false ? 'checked' : ''}></label>` : ''}
    <div class="actions"><button type="button" class="secondary" data-editor-close>取消</button><button type="button" class="primary" data-editor-save>${stocking ? '直接上架' : creating ? '收入衣柜' : '保存设定'}</button></div>
  </div>`);
  const readField = key => d.body.querySelector(`[data-item="${key}"]`)?.value?.trim() || '';
  const writeField = (key, nextVal, overwrite = true) => {
    if (nextVal === undefined || nextVal === null || nextVal === '') return false;
    const el = d.body.querySelector(`[data-item="${key}"]`);
    if (!el) return false;
    if (!overwrite && String(el.value || '').trim() && !(key === 'price' && String(el.value).trim() === '0')) return false;
    el.value = String(nextVal);
    return true;
  };
  const applySmartBlock = (rawBlock, {overwrite = true, silent = false} = {}) => {
    const sourceText = String(rawBlock ?? (readField('smartInput') || readField('rawDesign') || readField('drawPrompt'))).trim();
    if (!sourceText) {
      if (!silent) ctx.notify('请先在识别框中粘贴或输入要识别的整段提示词或设定内容', {error: true});
      return null;
    }
    const curCat = creating ? (readField('category') || value.category) : value.category;
    const parsed = parseItemTextBlock(sourceText, {fallbackCategory: curCat});
    if (!parsed || !Object.keys(parsed).length) {
      if (!silent) ctx.notify('未识别到可拆分的有效字段，请检查输入内容', {error: true});
      return null;
    }
    let count = 0;
    const allowedCats = (stocking ? mallCategories : categories).map(([id]) => id);
    if (creating && parsed.category && allowedCats.includes(parsed.category)) {
      if (writeField('category', parsed.category, overwrite)) count++;
      const effects = d.body.querySelector('[data-item-consumable]');
      if (effects) effects.hidden = parsed.category !== 'consumable';
    }
    for (const key of ['name', 'shortName', 'slot', 'effectKind', 'summary', 'appearance', 'bodyBuild', 'physiology',
      'gender', 'lowerBodyMode', 'lowerBodyType', 'lowerBodyDescription', 'abilities', 'abilityConditions',
      'ringAppearance', 'forwardExtension', 'backwardExtension', 'drawPrompt', 'organDrawPrompt', 'rawDesign']) {
      if (parsed[key] !== undefined && parsed[key] !== '' && writeField(key, parsed[key], overwrite)) count++;
    }
    if (parsed.price !== undefined && (!creating || stocking)) {
      if (writeField('price', parsed.price, overwrite)) count++;
    }
    if (!silent) ctx.notify(`已智能识别并填入 ${count} 项字段（角色与肉棒提示词已自动分离）`);
    return parsed;
  };
  d.body.addEventListener('paste', event => {
    if (event.target?.dataset?.item !== 'smartInput') return;
    const pasted = event.clipboardData?.getData?.('text') || '';
    if (pasted && pasted.trim().length >= 12) {
      setTimeout(() => applySmartBlock(d.body.querySelector('[data-item="smartInput"]')?.value || pasted, {overwrite: true, silent: false}), 0);
    }
  });
  d.body.addEventListener('change', event => {
    if (event.target?.dataset?.item === 'category') {
      const effects = d.body.querySelector('[data-item-consumable]');
      if (effects) effects.hidden = event.target.value !== 'consumable';
    }
    if (event.target?.dataset?.item !== 'gender') return;
    const mode = d.body.querySelector('[data-item="lowerBodyMode"]');
    if (mode?.value === 'legacy') mode.value = 'replace';
  });
  d.body.addEventListener('click', event => {
    if (event.target.closest('[data-editor-close]')) return d.close(null);
    if (event.target.closest('[data-editor-smart-parse]')) {
      applySmartBlock(readField('smartInput') || readField('rawDesign') || readField('drawPrompt'), {overwrite: true, silent: false});
      return;
    }
    const voice = event.target.closest('[data-editor-voice]');
    if (voice) {
      const picker = voice.dataset.editorVoice === 'list' ? openItemVoiceListPicker : openVoicePoolPickerDialog;
      picker(ctx, {currentValue: currentVoice, onSelect(ref, label) {
        currentVoice = ref; voiceChanged = true;
        if (!creating) api.xenoAct('saveItem', {id: value.id, voiceRole: ref});
        d.body.querySelector('[data-item-voice-label]').textContent = label || '未绑定，使用本体音色';
      }});
      return;
    }
    if (!event.target.closest('[data-editor-save]')) return;
    try {
      const read = readField;
      if (read('smartInput')) {
        applySmartBlock(read('smartInput'), {overwrite: false, silent: true});
      } else if (!read('name') && (read('rawDesign') || read('drawPrompt'))) {
        applySmartBlock(read('rawDesign') || read('drawPrompt'), {overwrite: false, silent: true});
      }
      const name = read('name');
      if (!name || name.length > 160) throw Error('请填写 1–160 字的名称');
      const kind = creating ? read('category') : value.category;
      const structure = readItemStructure(d.body);
      const splitPrompts = splitItemDrawPrompts({
        category: kind,
        gender: structure.gender,
        lowerBodyMode: structure.lowerBodyMode,
        lowerBodyType: structure.lowerBodyType,
        drawPrompt: read('drawPrompt'),
        organDrawPrompt: read('organDrawPrompt')
      });
      const patch = {...structure, id: value.id, name, shortName: read('shortName') || name.slice(0, 80),
        slot: ['skin_suit', 'flesh_ring', 'consumable'].includes(kind) ? kind : read('slot'),
        ...Object.fromEntries(['summary', 'appearance', 'bodyBuild', 'physiology', 'rawDesign'].map(key => [key, read(key)])),
        drawPrompt: normalizeCharacterDrawPrompt(splitPrompts.drawPrompt),
        organDrawPrompt: splitPrompts.organDrawPrompt ? normalizeOrganDrawPrompt(splitPrompts.organDrawPrompt) : '',
        ...(kind === 'consumable' ? {effectKind: read('effectKind')} : {}),
        ...(voiceChanged ? {voiceRole: currentVoice} : {})};
      if (stocking) {
        const priceText = read('price'), price = Number(priceText);
        if (!priceText || !Number.isInteger(price) || price < 0 || price > 999999) throw Error('售价应为 0–999999 的整数');
        api.xenoAct('stockItem', {...patch, category: kind, price});
      } else if (creating) api.xenoAct('registerItem', {...patch, category: kind});
      else {
        const price = Number(read('price'));
        if (!Number.isFinite(price) || price < 0 || price > 999999) throw Error('售价应为 0–999999');
        api.xenoAct('saveItem', {...patch, price, listed: d.body.querySelector('[data-item-listed]').checked});
      }
      d.close(true);
      onSaved?.({id: value.id, category: kind});
      ctx.notify(stocking ? `已将「${name}」上架，尚未购买` : creating ? `已将「${name}」收入衣柜` : '装备设定已保存');
    } catch (error) {ctx.notify(error.message, {error: true});}
  });
  return d;
}
