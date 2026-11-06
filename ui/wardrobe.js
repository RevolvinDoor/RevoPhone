// App 2: 衣柜 (wardrobe)
// Top: 全身穿戴总览 (Full-body Wear Overview) with a dropdown to switch between Protagonist and any Target Character,
//      displaying all 6 slots vertically (活体皮躯槽, 活体肉躯槽, 外搭衣物槽, 内衣裤装槽, 隐私遮挡槽, 附加饰品槽) with instant controls.
// Bottom: 3 Wardrobe Library Tabs (皮躯库, 肉躯库, 服饰与饰品库) for owned items, with design viewer/editor & fusion restoration.

import {createView, esc, heading} from './common.js';
import {icon} from './icons.js';
import {getEntity, effectiveEntityView} from '../core/xeno.js';
import {blobToDataUrl, generateItemPreview} from './xeno-media.js';

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
    const items = xeno.items || [];
    const skin = entity.livingMount.skinSuitId ? items.find(i => i.id === entity.livingMount.skinSuitId) : null;
    const ring = entity.livingMount.fleshRingId ? items.find(i => i.id === entity.livingMount.fleshRingId) : null;
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
            <button type="button" class="xeno-mini-btn primary" data-action="go-mall">🛒 去商城买新装</button>
          </div>
        </header>
        <div class="xeno-target-bar">
          <select class="xeno-select" data-change="select-wardrobe-person" aria-label="选择穿戴总览角色">
            ${allPeople.map(([k, label]) => `<option value="${esc(k)}" ${targetKey === k ? 'selected' : ''}>${esc(label)}</option>`).join('')}
          </select>
        </div>
        <p class="xeno-hint">当前显性外貌：<b>${esc(view.gender || '未定')}</b> ｜ 🎙️ 声带音色：<b>${esc(view.voiceStateText)}</b></p>
        <div class="wardrobe-slot-list">
          <div class="wardrobe-slot-row ${skin ? 'equipped' : ''}">
            <div class="slot-head">
              <span class="slot-tag">1. 活体皮躯槽</span>
              <strong>${skin ? esc(skin.name) : '未穿戴'}</strong>
              ${skin ? `<button type="button" class="xeno-mini-btn danger" data-action="unequip-slot" data-slot="skin_suit">脱卸</button>` : ''}
            </div>
            ${skin ? `
              <p class="slot-desc">${esc(skin.summary || skin.bodyBuild)}</p>
              <p class="xeno-hint" style="margin:2px 0 6px">🎙️ 皮躯绑定音色：<b>${esc(skin.voiceRole || skin.sourceTargetName || '未绑定（点击下方皮躯卡片可绑定角色音色）')}</b>（全脸覆面生效，露原貌恢复本人音色）</p>
              <div class="xeno-row-controls">
                <button type="button" class="xeno-mini-btn ${entity.livingMount.skinFaceMode === 'full' ? 'primary' : ''}" data-action="skin-face" data-mode="full">全脸覆面（皮躯音色）</button>
                <button type="button" class="xeno-mini-btn ${entity.livingMount.skinFaceMode === 'neck' ? 'primary' : ''}" data-action="skin-face" data-mode="neck">露原貌（本人音色）</button>
                <button type="button" class="xeno-mini-btn ${entity.livingMount.skinOrganOut ? 'accent' : ''}" data-action="skin-organ">
                  ${entity.livingMount.skinOrganOut ? '扶她器官：充血释出' : '扶她器官：收纳隐藏'}
                </button>
              </div>
            ` : '<small class="slot-empty">从下方「皮躯库」选择活体皮躯穿入背部脊椎裂口</small>'}
          </div>
          <div class="wardrobe-slot-row ${ring ? 'equipped' : ''}">
            <div class="slot-head">
              <span class="slot-tag">2. 活体肉躯槽</span>
              <strong>${ring ? esc(ring.name) : '未安装'}</strong>
              ${ring ? `<button type="button" class="xeno-mini-btn danger" data-action="unequip-slot" data-slot="flesh_ring">取下</button>` : ''}
            </div>
            ${ring ? `
              <p class="slot-desc">${esc(ring.summary || ring.ringAppearance)}</p>
              <p class="xeno-hint" style="margin:2px 0 6px">🎙️ 肉躯绑定音色：<b>${esc(ring.voiceRole || ring.sourceTargetName || '未绑定（点击下方肉躯卡片可绑定角色音色）')}</b>（仅后方延展生效）</p>
              <div class="xeno-row-controls">
                <button type="button" class="xeno-mini-btn ${entity.livingMount.fleshExtendMode === 'idle' ? 'primary' : ''}" data-action="ring-mode" data-mode="idle">静息饰品形态</button>
                <button type="button" class="xeno-mini-btn ${entity.livingMount.fleshExtendMode === 'forward' ? 'primary' : ''}" data-action="ring-mode" data-mode="forward">前方延展(肉棒重构)</button>
                <button type="button" class="xeno-mini-btn ${entity.livingMount.fleshExtendMode === 'backward' ? 'primary' : ''}" data-action="ring-mode" data-mode="backward">后方延展(全身+肉躯音色)</button>
              </div>
            ` : '<small class="slot-empty">从下方「肉躯库」选择活体肉躯环扣合于阴茎口/阴蒂口</small>'}
          </div>
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
              const isEquipped = item.category === 'skin_suit'
                ? entity.livingMount.skinSuitId === item.id
                : item.category === 'flesh_ring'
                ? entity.livingMount.fleshRingId === item.id
                : entity.outfit[item.slot + 'ItemId'] === item.id;
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
                    ${item.bodyBuild ? `<p class="tb-spec"><b>体态：</b>${esc(item.bodyBuild)}</p>` : ''}
                    <div class="tb-bottom-row">
                      <div class="tb-buy-group">
                        ${item.category === 'flesh_ring' ? `
                          <button type="button" class="tb-btn-cart" data-action="equip-item" data-id="${esc(item.id)}" data-mode="forward">前方延展</button>
                          <button type="button" class="tb-btn-buy" data-action="equip-item" data-id="${esc(item.id)}" data-mode="backward">后方延展</button>
                        ` : `
                          ${item.source === 'fusion' ? `<button type="button" class="tb-btn-cart" data-action="restore-fusion-item" data-id="${esc(item.id)}">还原角色</button>` : ''}
                          <button type="button" class="tb-btn-buy" data-action="equip-item" data-id="${esc(item.id)}">立即穿戴</button>
                        `}
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
            <p class="sub">所有初始单品默认陈列在【购物商城】中，你可以前往商城购买入库，或在异构终端通过「融合解除·皮躯化/肉躯化」转化目标角色。</p>
            <div class="xeno-row-controls" style="justify-content:center;margin-top:10px">
              <button type="button" class="xeno-btn primary" data-action="go-mall">🛒 前往购物商城选购</button>
            </div>
          </div>
        `}
      </section>
    `;
  }

  function openDesignSheet(item) {
    const isLiving = item.category === 'skin_suit' || item.category === 'flesh_ring';
    const routes = (api.getState().routes || []).filter(r => r?.name && r.roleKind !== 'narrator');
    const curVoice = item.voiceRole || item.sourceTargetName || '';
    const d = ctx.dialog(item.name, `
      <div class="xeno-sheet-form">
        ${item.imageData ? `<img class="wardrobe-sheet-img" src="${esc(item.imageData)}" alt="">` : ''}
        <label class="xeno-field-inline"><span>单品名称</span><input class="xeno-input" data-item="name" value="${esc(item.name)}"></label>
        <label class="xeno-field-inline"><span>一句话简介</span><input class="xeno-input" data-item="summary" value="${esc(item.summary)}"></label>
        ${isLiving ? `
          <label class="xeno-field-inline">
            <span>🎙️ 绑定声带音色角色（${item.category === 'skin_suit' ? '全脸覆面时生效' : '后方全身延展时生效'}）</span>
            <select class="xeno-select" data-item="voiceRole">
              <option value="" ${!curVoice ? 'selected' : ''}>（不切换音色，保持穿戴者本人音色）</option>
              ${routes.map(r => `<option value="${esc(r.name)}" ${curVoice === r.name ? 'selected' : ''}>🎙️ 使用角色【${esc(r.name)}】的音色${r.voice ? '（已配音）' : '（待配音）'}</option>`).join('')}
            </select>
          </label>
        ` : ''}
        <label class="xeno-field-inline"><span>外貌特征</span><textarea class="xeno-textarea" rows="2" data-item="appearance">${esc(item.appearance)}</textarea></label>
        <label class="xeno-field-inline"><span>体型身材</span><textarea class="xeno-textarea" rows="2" data-item="bodyBuild">${esc(item.bodyBuild)}</textarea></label>
        <label class="xeno-field-inline"><span>生理特征</span><textarea class="xeno-textarea" rows="2" data-item="physiology">${esc(item.physiology)}</textarea></label>
        <label class="xeno-field-inline"><span>生图提示词 (Danbooru Tags)</span><textarea class="xeno-textarea" rows="2" data-item="drawPrompt">${esc(item.drawPrompt)}</textarea></label>
        <label class="xeno-field-inline"><span>完整 XML 设定块（穿戴时自动注入提示词）</span><textarea class="xeno-textarea" rows="6" data-item="rawDesign">${esc(item.rawDesign)}</textarea></label>
        <div class="actions">
          <button type="button" class="secondary" data-sheet-cancel>关闭</button>
          <button type="button" class="primary" data-sheet-save>保存设定</button>
        </div>
      </div>
    `);
    d.body.addEventListener('click', e => {
      if (e.target.closest('[data-sheet-cancel]')) d.close(null);
      if (e.target.closest('[data-sheet-save]')) {
        const read = k => d.body.querySelector(`[data-item="${k}"]`)?.value?.trim() ?? '';
        api.xenoAct('saveItem', {
          ...item,
          name: read('name') || item.name,
          summary: read('summary'),
          voiceRole: isLiving ? read('voiceRole') : item.voiceRole,
          appearance: read('appearance'),
          bodyBuild: read('bodyBuild'),
          physiology: read('physiology'),
          drawPrompt: read('drawPrompt'),
          rawDesign: read('rawDesign')
        });
        d.close(true);
        ctx.notify('单品设定档案已保存');
      }
    });
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
    if (act === 'wardrobe-tab') { activeTab = el.dataset.tab; v.refresh(); return; }
    if (act === 'filter-apparel') { apparelFilter = el.dataset.filter; v.refresh(); return; }
    if (act === 'skin-face') {
      api.xenoAct('updateMountOption', {targetKey, patch: {skinFaceMode: el.dataset.mode}});
      return;
    }
    if (act === 'skin-organ') {
      api.xenoAct('updateMountOption', {targetKey, patch: {skinOrganOut: !entity.livingMount.skinOrganOut}});
      return;
    }
    if (act === 'ring-mode') {
      api.xenoAct('updateMountOption', {targetKey, patch: {fleshExtendMode: el.dataset.mode}});
      return;
    }
    if (act === 'coat-pose') {
      api.xenoAct('updateMountOption', {targetKey, patch: {coatPose: el.dataset.pose}});
      return;
    }
    if (act === 'unequip-slot') {
      api.xenoAct('unequipSlot', {targetKey, slot: el.dataset.slot});
      ctx.notify('已卸下对应槽位装束');
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
      api.xenoAct('equipItem', {targetKey, itemId: el.dataset.id, mode: el.dataset.mode || ''});
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
        api.xenoAct('saveItem', {...item, imageData});
        ctx.notify(`已上传「${item.shortName}」图片并同步至商城与衣柜`);
      }
    }
  });

  v.refresh();
  return v;
}
