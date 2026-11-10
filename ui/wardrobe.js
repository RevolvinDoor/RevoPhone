// App 2: 衣柜 (wardrobe)
// Top: 全身穿戴总览 (Full-body Wear Overview) with a dropdown to switch between Protagonist and any Target Character,
//      displaying all 6 slots vertically (活体皮躯槽, 活体肉躯槽, 外搭衣物槽, 内衣裤装槽, 隐私遮挡槽, 附加饰品槽) with instant controls.
// Bottom: 3 Wardrobe Library Tabs (皮躯库, 肉躯库, 服饰与饰品库) for owned items, with design viewer/editor & fusion restoration.

import {createView, esc, heading} from './common.js';
import {icon} from './icons.js';
import {getEntity, effectiveEntityView, formatVoiceRoleLabel, resolveWear, itemOccupant, wearLayers, itemVoiceRef} from '../core/xeno.js';
import {extensionEnabled} from '../core/xeno-wear.js';
import {openItemEditor} from './xeno-item-editor.js';
import {blobToDataUrl, generateItemPreview, openVoicePoolPickerDialog, openItemVoiceListPicker, generateEntityPortrait, openEntityPortraitDialog} from './xeno-media.js';

const SLOT_NAMES = {
  skin_suit: '活体皮躯',
  flesh_ring: '活体肉躯',
  outerwear: '外搭衣物',
  underwear: '内衣裤装',
  privacyCover: '隐私遮挡',
  accessories: '附加饰品'
};

export function wardrobeApp(ctx) {
  const {api} = ctx, v = createView(ctx, 'wardrobe');
  let activeTab = 'skin_suit'; // 'skin_suit' | 'flesh_ring' | 'apparel'
  let apparelFilter = 'all'; // 'all' | 'outerwear' | 'underwear' | 'privacyCover' | 'accessories'
  let uploadTargetItemId = '';
  const drawingIds = new Set();

  const xenoState = () => api.getState().xeno;
  const unsubscribe = api.subscribe(e => {
    if (e?.type === 'xeno' || e?.type === 'settings') v.refresh();
  });
  const origDispose = v.dispose.bind(v);
  v.dispose = () => { unsubscribe?.(); origDispose(); };

  function renderOverview(xeno, entity, targetKey) {
    const allPeople = [
      ['__protagonist__', `👤 主角${xeno.protagonist.name ? '：' + xeno.protagonist.name : ''}${xeno.protagonist.gender ? `（${xeno.protagonist.gender}）` : ''}`],
      ...xeno.targets.map(t => [t.name, `🎯 目标：${t.name}${t.identity || t.gender ? `（${[t.identity, t.gender].filter(Boolean).join(' · ')}）` : ''}`])
    ];
    const layers = resolveWear(xeno, entity).layers;
    const state = api.getState();
    const voicePool = state.voicePool || [];
    const view = effectiveEntityView(xeno, entity);
    const hasCoat = /风衣/.test(entity.outfit.outerwear);

    return `
      <section class="xeno-status-card wardrobe-overview">
        <header class="xeno-status-head">
          <div class="xeno-status-title">
            <span class="xeno-badge prot">OVERVIEW</span>
            <strong>全身穿戴总览</strong>
          </div>
          <div class="xeno-status-actions">
            ${entity.portraitData ? `<button type="button" class="xeno-mini-btn" data-action="view-wearer-portrait" title="查看当前穿戴形态图">🖼️ 看形态图</button>` : ''}
            <button type="button" class="xeno-mini-btn" data-action="draw-wearer-portrait" title="按当前全身穿戴与躯体一键生成形态图">📸 生成形态图</button>
            <button type="button" class="xeno-mini-btn primary" data-action="go-mall">🛒 去商城买新装</button>
          </div>
        </header>
        <div class="xeno-target-bar">
          <select class="xeno-select" data-change="select-wardrobe-person" aria-label="选择穿戴总览角色">
            ${allPeople.map(([k, label]) => `<option value="${esc(k)}" ${targetKey === k ? 'selected' : ''}>${esc(label)}</option>`).join('')}
          </select>
        </div>
        <p class="xeno-hint">当前显性外貌：<b>${esc(view.gender || '未定')}</b> ｜ 🎙️ 声带音色：<b>${esc(view.voiceStateText)}</b></p>
        <p class="xeno-hint">身体来源：${esc(view.bodySource)}<br>头部：${esc(view.headSource)} · ${esc(view.headAppearance || '未记录')}<br>下体外观：${esc(view.organAppearance || '本体未记录')} · 来源：${esc(view.organSource)}</p>
        ${view.equipmentAbilities ? `<p class="xeno-hint">装备能力及条件：<br>${esc(view.equipmentAbilities).replace(/\n/g, '<br>')}</p>` : ''}
        ${view.extensionText ? `<p class="xeno-hint">有效延展设定：${esc(view.extensionText)}</p>` : ''}
        <div class="xeno-row-controls">
          <span class="xeno-hint">穿戴层次从内到外排列；脱下内层会先脱去它外面的各层。</span>
          ${layers.length ? '<button type="button" class="xeno-mini-btn danger" data-action="unequip-slot" data-slot="outermost">脱最外层</button><button type="button" class="xeno-mini-btn danger" data-action="unequip-slot" data-slot="all">脱全部叠层</button>' : ''}
        </div>
        <div class="wardrobe-slot-list">
          ${layers.length ? layers.map(layer => {
            const item = layer.item, isSkin = layer.kind === 'skin_suit', id = esc(item.id);
            const voice = itemVoiceRef(xeno, item, layer);
            return `<div class="wardrobe-slot-row equipped" data-layer-id="${id}">
              <div class="slot-head"><span class="slot-tag">第 ${layer.index + 1} 层 · ${isSkin ? '皮躯' : '肉躯'}${layer.index === layers.length - 1 ? ' · 最外层' : ''}</span>
                <strong>${esc(item.name)}</strong><button type="button" class="xeno-mini-btn danger" data-action="unequip-slot" data-id="${id}">${layer.index === layers.length - 1 ? '脱下' : '脱至此层（含外层）'}</button></div>
              <p class="slot-desc">${esc(item.summary || item.bodyBuild)}</p>
              <p class="xeno-hint">绑定音色：${esc(formatVoiceRoleLabel(voice, voicePool) || '未绑定，成为有效头部时使用本体音色')}</p>
              <div class="xeno-row-controls">
                <button type="button" class="xeno-mini-btn" data-action="view-design" data-id="${id}">编辑设定与能力</button>
                <button type="button" class="xeno-mini-btn" data-action="pick-item-list-voice" data-id="${id}">从列表选</button>
                <button type="button" class="xeno-mini-btn" data-action="pick-item-fav-voice" data-id="${id}">♡ 从收藏夹选</button>
              </div>
              <p class="xeno-hint">音色随这件装备永久保存，换聊天或移除收藏后仍保留。</p>
              ${!isSkin ? `<div class="xeno-row-controls">${[['idle','静息'],['forward','前方延展'],['backward','后方延展']].map(([mode,label]) => `<button type="button" class="xeno-mini-btn ${(mode === 'idle' ? layer.extendMode === 'idle' : extensionEnabled(layer.extendMode, mode)) ? 'primary' : ''}" aria-pressed="${mode === 'idle' ? layer.extendMode === 'idle' : extensionEnabled(layer.extendMode, mode)}" data-action="ring-mode" data-id="${id}" data-mode="${mode}">${label}</button>`).join('')}</div><p class="xeno-hint">前、后方延展可同时开启；再次点击只关闭对应方向，静息会收起两个方向。</p>` : ''}
              <div class="xeno-row-controls">
                ${[['full','全脸覆面'],['neck','收起本层头部']].map(([mode,label]) => `<button type="button" class="xeno-mini-btn ${layer.faceMode === mode ? 'primary' : ''}" data-action="${isSkin ? 'skin-face' : 'ring-face'}" data-id="${id}" data-mode="${mode}">${label}</button>`).join('')}
                <button type="button" class="xeno-mini-btn ${layer.organOut ? 'accent' : ''}" data-action="layer-organ" data-id="${id}" ${item.lowerBodyMode === 'preserve' ? 'disabled' : ''}>${item.lowerBodyMode === 'preserve' ? '本件设定：保留内层' : layer.organOut ? '本层下体：启用' : '本层下体：保留内层'}</button>
              </div>
              ${!isSkin ? '<p class="xeno-hint">头部覆盖需后方延展开启；本层下体需前方延展开启，并按装备设定的类型处理。关闭延展会保留覆盖设置，再次开启时恢复。</p>' : ''}
            </div>`;
          }).join('') : '<p class="xeno-hint">尚未穿戴皮躯或肉躯，可从下方库存叠加穿戴。</p>'}
          ${['outerwear', 'underwear', 'privacyCover', 'accessories'].map((slot, idx) => `
            <div class="wardrobe-slot-row">
              <div class="slot-head">
                <span class="slot-tag">${idx + 3}. ${esc(SLOT_NAMES[slot])}槽</span>
                <strong>${esc(entity.outfit[slot] || '无')}</strong>
                <div class="slot-btns">
                  <button type="button" class="xeno-mini-btn" data-action="edit-slot-text" data-slot="${esc(slot)}">改写</button>
                  <button type="button" class="xeno-mini-btn danger" data-action="unequip-slot" data-slot="${esc(slot)}">脱下</button>
                </div>
              </div>
              ${slot === 'outerwear' && hasCoat ? `
                <div class="xeno-row-controls">
                  <button type="button" class="xeno-mini-btn ${entity.outfit.coatPose === 'cover' ? 'primary' : ''}" data-action="coat-pose" data-pose="cover">风衣：遮蔽形态</button>
                  <button type="button" class="xeno-mini-btn ${entity.outfit.coatPose === 'open' ? 'primary' : ''}" data-action="coat-pose" data-pose="open">风衣：双手敞开展露</button>
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
      </section>
    `;
  }

  function renderLibrary(xeno, entity) {
    const owned = (xeno.items || []).filter(i => i.owned && i.category === activeTab && (activeTab !== 'apparel' || apparelFilter === 'all' || i.slot === apparelFilter));
    return `
      <section class="xeno-module-card">
        <div class="xeno-sec-title">
          <strong>我的衣柜库存（仅显示已拥有单品）</strong>
          <small>共 ${owned.length} 件</small>
        </div>
        <div class="xeno-row-controls"><button type="button" class="xeno-btn primary" data-action="register-crafted">＋ 登记自制装备</button><span class="xeno-hint">已制作或已获得的装备可直接入柜。</span></div>
        ${activeTab === 'apparel' ? `
          <div class="xeno-chip-group">
            ${[['all', '全部服饰'], ['outerwear', '外搭衣物'], ['underwear', '内衣裤装'], ['privacyCover', '隐私遮挡'], ['accessories', '附加饰品']].map(([k, label]) => `
              <button type="button" class="xeno-chip ${apparelFilter === k ? 'active' : ''}" data-action="filter-apparel" data-filter="${esc(k)}">${esc(label)}</button>
            `).join('')}
          </div>
        ` : ''}
        ${owned.length ? `
          <input type="file" accept="image/*" id="wardrobe-item-file" data-change="wardrobe-item-file" hidden>
          <div class="tb-product-list">
            ${owned.map(item => {
              const occupied = itemOccupant(xeno, item.id);
              const isEquipped = occupied?.entity.name === entity.name;
              const isDrawing = drawingIds.has(item.id);
              return `
                <article class="tb-card ${isEquipped ? 'equipped' : ''}" data-action="view-design" data-id="${esc(item.id)}">
                  <div class="tb-img-box">
                    ${item.imageData
                      ? `<img src="${esc(item.imageData)}" alt="${esc(item.shortName)}" data-action="preview-item-img" data-id="${esc(item.id)}">`
                      : `<div class="tb-img-empty">
                           <span class="tb-img-cat">${esc(SLOT_NAMES[item.slot] || item.category)}</span>
                           <small>${isDrawing ? 'AI 绘图中…' : '暂无配图'}</small>
                         </div>`}
                    <div class="tb-img-actions">
                      <button type="button" class="tb-img-btn" data-action="upload-item-img" data-id="${esc(item.id)}" title="上传本地图片">📷 上传</button>
                      <button type="button" class="tb-img-btn" data-action="draw-item-img" data-id="${esc(item.id)}" ${isDrawing ? 'disabled' : ''} title="AI 生成商品图">${isDrawing ? '绘图中' : '🎨 生图'}</button>
                    </div>
                  </div>
                  <div class="tb-info">
                    <div class="tb-title-row">
                      <strong class="tb-title">${esc(item.name)}</strong>
                    </div>
                    <p class="tb-desc">${esc(item.summary)}</p>
                    ${occupied ? `<p class="tb-spec">使用中：${esc(occupied.entity.name || '主角')}${occupied.layer ? ` · 第 ${occupied.layer} 层` : ''}</p>` : ''}
                    ${item.bodyBuild ? `<p class="tb-spec"><b>体态：</b>${esc(item.bodyBuild)}</p>` : ''}
                    ${item.gender ? `<p class="tb-spec"><b>身体类型：</b>${esc(item.gender)}${item.source === 'crafted' ? ' · 自制／已获得' : ''}</p>` : ''}
                    ${item.abilities ? `<p class="tb-spec"><b>特殊能力：</b>${esc(item.abilities)}</p>` : ''}
                    <div class="tb-bottom-row">
                      <div class="tb-buy-group">
                        ${occupied ? '<button type="button" class="tb-btn-buy" disabled>已占用，请先脱下</button>' : item.category === 'flesh_ring' ? `
                          <button type="button" class="tb-btn-cart" data-action="equip-item" data-id="${esc(item.id)}" data-mode="forward">前方延展</button>
                          <button type="button" class="tb-btn-buy" data-action="equip-item" data-id="${esc(item.id)}" data-mode="backward">后方延展</button>
                        ` : `
                          ${item.source === 'fusion' ? `<button type="button" class="tb-btn-cart" data-action="restore-fusion-item" data-id="${esc(item.id)}">还原角色</button>` : ''}
                          <button type="button" class="tb-btn-buy" data-action="equip-item" data-id="${esc(item.id)}">立即穿戴</button>
                        `}
                        ${!occupied && item.category !== 'apparel' && wearLayers(entity).length ? `<button type="button" class="tb-btn-cart" data-action="equip-item" data-id="${esc(item.id)}" data-replace="true" ${item.category === 'flesh_ring' ? 'data-mode="backward"' : ''}>换最外层</button>` : ''}
                      </div>
                    </div>
                  </div>
                </article>
              `;
            }).join('')}
          </div>
        ` : `
          <div class="xeno-reserved-box">
            <p>衣柜的「${activeTab === 'skin_suit' ? '皮躯库' : activeTab === 'flesh_ring' ? '肉躯库' : '服饰与饰品库'}」目前为空</p>
            <p class="sub">可以直接登记自制装备，也可前往商城购买，或通过异构终端的转化功能获得。</p>
            <div class="xeno-row-controls" style="justify-content:center;margin-top:10px">
              <button type="button" class="xeno-btn primary" data-action="go-mall">🛒 前往购物商城选购</button>
            </div>
          </div>
        `}
      </section>
    `;
  }

  function openDesignSheet(item) {
    return openItemEditor(ctx, {item});
  }

  v.refresh = () => {
    const xeno = xenoState();
    const targetKey = xeno.wardrobeTarget || '__protagonist__';
    const entity = getEntity(xeno, targetKey) || xeno.protagonist;

    v.draw(`
      ${heading(
        '衣柜',
        `<button type="button" class="round-button" data-action="go-xeno" title="打开异构终端">${icon('wand')}</button>
         <button type="button" class="round-button" data-action="go-mall" title="打开购物商城">${icon('shop')}</button>`,
        'Living Wardrobe'
      )}
      ${renderOverview(xeno, entity, targetKey)}
      <nav class="xeno-module-tabs cols-3" aria-label="衣柜分类">
        <button type="button" class="xeno-tab ${activeTab === 'skin_suit' ? 'active' : ''}" data-action="wardrobe-tab" data-tab="skin_suit">皮躯库</button>
        <button type="button" class="xeno-tab ${activeTab === 'flesh_ring' ? 'active' : ''}" data-action="wardrobe-tab" data-tab="flesh_ring">肉躯库</button>
        <button type="button" class="xeno-tab ${activeTab === 'apparel' ? 'active' : ''}" data-action="wardrobe-tab" data-tab="apparel">服饰与饰品库</button>
      </nav>
      ${renderLibrary(xeno, entity)}
    `);
  };

  v.on('click', '[data-action]', async el => {
    const act = el.dataset.action;
    const xeno = xenoState();
    const targetKey = xeno.wardrobeTarget || '__protagonist__';
    const entity = getEntity(xeno, targetKey) || xeno.protagonist;

    if (act === 'go-xeno') { ctx.open('xeno'); return; }
    if (act === 'go-mall') { ctx.open('mall'); return; }
    if (act === 'register-crafted') { openItemEditor(ctx, {category: activeTab}); return; }
    if (act === 'view-wearer-portrait') {
      openEntityPortraitDialog(ctx, targetKey);
      return;
    }
    if (act === 'draw-wearer-portrait') {
      if (!api.drawReady?.()) {
        openEntityPortraitDialog(ctx, targetKey);
        return;
      }
      await v.busy(el, async () => {
        const url = await generateEntityPortrait(ctx, targetKey);
        if (url) openEntityPortraitDialog(ctx, targetKey);
      });
      return;
    }
    if (act === 'wardrobe-tab') { activeTab = el.dataset.tab; v.refresh(); return; }
    if (act === 'filter-apparel') { apparelFilter = el.dataset.filter; v.refresh(); return; }
    if (act === 'skin-face') {
      api.xenoAct('updateMountOption', {targetKey, itemId: el.dataset.id, patch: {skinFaceMode: el.dataset.mode}});
      return;
    }
    if (act === 'layer-organ') {
      const layer = wearLayers(entity).find(layer => layer.itemId === el.dataset.id);
      if (!layer) return;
      api.xenoAct('updateMountOption', {targetKey, itemId: layer.itemId, patch: {[layer.kind === 'skin_suit' ? 'skinOrganOut' : 'organOut']: !layer.organOut}});
      return;
    }
    if (act === 'ring-mode') {
      const layer = wearLayers(entity).find(layer => layer.itemId === el.dataset.id);
      if (!layer) return;
      const mode = el.dataset.mode;
      const patch = mode === 'idle' ? {fleshExtendMode: 'idle'}
        : {[mode === 'forward' ? 'fleshForwardEnabled' : 'fleshBackwardEnabled']: !extensionEnabled(layer.extendMode, mode)};
      api.xenoAct('updateMountOption', {targetKey, itemId: layer.itemId, patch});
      return;
    }
    if (act === 'ring-face') {
      api.xenoAct('updateMountOption', {targetKey, itemId: el.dataset.id, patch: {fleshFaceMode: el.dataset.mode}});
      return;
    }
    if (act === 'coat-pose') {
      api.xenoAct('updateMountOption', {targetKey, patch: {coatPose: el.dataset.pose}});
      return;
    }
    if (act === 'pick-item-fav-voice' || act === 'pick-item-list-voice') {
      const item = xeno.items.find(i => i.id === el.dataset.id);
      if (!item) return;
      const picker = act === 'pick-item-list-voice' ? openItemVoiceListPicker : openVoicePoolPickerDialog;
      picker(ctx, {
        currentValue: itemVoiceRef(xeno, item),
        onSelect: (ref, label) => {
          api.xenoAct('saveItem', {id: item.id, voiceRole: ref});
          ctx.notify(ref ? `已为「${item.shortName || item.name}」绑定${label}` : '已清除该装备的音色绑定');
        }
      });
      return;
    }
    if (act === 'unequip-slot') {
      api.xenoAct('unequipSlot', {targetKey, slot: el.dataset.slot, itemId: el.dataset.id || ''});
      ctx.notify('已按从外到内的顺序脱下');
      return;
    }
    if (act === 'edit-slot-text') {
      const slot = el.dataset.slot;
      const d = ctx.dialog(`改写${SLOT_NAMES[slot] || '着装'}`, `
        <div class="xeno-sheet-form">
          <label class="xeno-field-inline">
            <span>当前${esc(SLOT_NAMES[slot])}描述</span>
            <textarea class="xeno-textarea" rows="3" data-slot-val>${esc(entity.outfit[slot] || '')}</textarea>
          </label>
          <div class="actions">
            <button type="button" class="secondary" data-sheet-cancel>取消</button>
            <button type="button" class="primary" data-sheet-save>保存</button>
          </div>
        </div>
      `);
      d.body.addEventListener('click', e => {
        if (e.target.closest('[data-sheet-cancel]')) d.close(null);
        if (e.target.closest('[data-sheet-save]')) {
          const val = d.body.querySelector('[data-slot-val]')?.value?.trim() || '无';
          api.xenoAct('updateMountOption', {targetKey, patch: {[slot]: val}});
          d.close(true);
        }
      });
      return;
    }
    if (act === 'equip-item') {
      api.xenoAct('equipItem', {targetKey, itemId: el.dataset.id, mode: el.dataset.mode || '', replace: el.dataset.replace === 'true'});
      ctx.notify(`已为「${entity.name}」穿戴单品`);
      return;
    }
    if (act === 'view-design') {
      const item = xeno.items.find(i => i.id === el.dataset.id);
      if (item) openDesignSheet(item);
      return;
    }
    if (act === 'preview-item-img') {
      const item = xeno.items.find(i => i.id === el.dataset.id);
      if (item?.imageData) {
        ctx.dialog(item.shortName || item.name, `<img class="wardrobe-sheet-img" style="max-height:65vh;object-fit:contain" src="${esc(item.imageData)}" alt="">`);
      }
      return;
    }
    if (act === 'upload-item-img') {
      uploadTargetItemId = el.dataset.id;
      v.root.querySelector('#wardrobe-item-file')?.click();
      return;
    }
    if (act === 'draw-item-img') {
      const item = xeno.items.find(i => i.id === el.dataset.id);
      if (!item || drawingIds.has(item.id)) return;
      drawingIds.add(item.id);
      v.refresh();
      try {
        const url = await generateItemPreview(ctx, item);
        if (url) ctx.notify(`已生成「${item.shortName}」的配图并同步至商城与衣柜`);
      } finally {
        drawingIds.delete(item.id);
        v.refresh();
      }
      return;
    }
    if (act === 'restore-fusion-item') {
      const item = xeno.items.find(i => i.id === el.dataset.id);
      if (item && await ctx.confirm(`还原「${item.name}」？`, '将通过再次肉体融合并正常分离，把该活体装备重新还原为鲜活的目标角色。')) {
        api.xenoAct('restoreLivingItem', {itemId: item.id});
        ctx.notify('已成功还原为独立角色！');
      }
    }
  });

  v.on('change', '[data-change]', async el => {
    if (el.dataset.change === 'select-wardrobe-person') {
      api.xenoAct('selectWardrobeTarget', {key: el.value});
      return;
    }
    if (el.dataset.change === 'wardrobe-item-file') {
      const file = el.files?.[0];
      const item = xenoState().items.find(i => i.id === uploadTargetItemId);
      el.value = '';
      if (file && item) {
        const imageData = await blobToDataUrl(ctx.win, file);
        api.xenoAct('saveItem', {id: item.id, imageData});
        ctx.notify(`已上传「${item.shortName}」图片并同步至商城与衣柜`);
      }
    }
  });

  v.refresh();
  return v;
}
