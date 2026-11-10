import {esc} from './common.js';
import {GENDERS, itemVoiceRef, formatVoiceRoleLabel} from '../core/xeno.js';
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

export function openItemEditor(ctx, {item = null, category = 'skin_suit', destination = 'wardrobe', slot = 'outerwear', gender, onSaved} = {}) {
  const creating = !item, stocking = creating && destination === 'mall', {api} = ctx;
  const value = item || {id: (stocking ? 'restock_' : 'crafted_') + crypto.randomUUID(), category, slot,
    gender: gender ?? (stocking ? '' : '女'), lowerBodyMode: 'replace', lowerBodyType: 'auto'};
  const living = ['skin_suit', 'flesh_ring'].includes(value.category);
  let currentVoice = creating ? '' : itemVoiceRef(api.getState().xeno, value), voiceChanged = false;
  const d = ctx.dialog(stocking ? '手动录入商品' : creating ? '登记自制装备' : `编辑 · ${value.name}`, `<div class="xeno-sheet-form">
    ${stocking ? '<p class="xeno-hint">完全手动填写，直接上架为未购买商品，不调用文字模型或自动绘图，不扣钱包。无需编写 XML；上架后可在商品卡上传图片，也可另行选择生图。</p>'
      : creating ? '<p class="xeno-hint">将剧情中自制、获赠或已获得的装备直接收入衣柜，不扣钱包、不自动上架商店，也不会自动穿戴。普通字段即可保存，无需编写 XML。</p>' : ''}
    ${value.imageData ? `<img class="wardrobe-sheet-img" src="${esc(value.imageData)}" alt="">` : ''}
    ${creating ? select('category', stocking ? '商品分类' : '装备分类', category, stocking ? mallCategories : categories) : `<p class="xeno-hint">分类：${esc(mallCategories.find(([id]) => id === value.category)?.[1] || value.category)}</p>`}
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
    ${field(value, 'drawPrompt', '生图提示词', 1500)}
    ${field(value, 'rawDesign', '补充设定／原始 XML（可选）', 6000, 5)}
    ${!creating || stocking ? `<label class="xeno-field-inline"><span>商店售价</span><input class="xeno-input" type="number" min="0" max="999999" step="1" data-item="price" value="${value.price || 0}"></label>` : ''}
    ${!creating ? `<label class="xeno-field-inline"><span>在商店展示</span><input type="checkbox" data-item-listed ${value.listed !== false ? 'checked' : ''}></label>` : ''}
    <div class="actions"><button type="button" class="secondary" data-editor-close>取消</button><button type="button" class="primary" data-editor-save>${stocking ? '直接上架' : creating ? '收入衣柜' : '保存设定'}</button></div>
  </div>`);
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
      const read = key => d.body.querySelector(`[data-item="${key}"]`)?.value?.trim() || '';
      const name = read('name');
      if (!name || name.length > 160) throw Error('请填写 1–160 字的名称');
      const kind = creating ? read('category') : value.category;
      const patch = {...readItemStructure(d.body), id: value.id, name, shortName: read('shortName') || name.slice(0, 80),
        slot: ['skin_suit', 'flesh_ring', 'consumable'].includes(kind) ? kind : read('slot'),
        ...Object.fromEntries(['summary', 'appearance', 'bodyBuild', 'physiology', 'drawPrompt', 'rawDesign'].map(key => [key, read(key)])),
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
