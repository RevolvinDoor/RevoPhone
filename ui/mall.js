// App 3: 购物商城 (mall)
// Features:
// 1. Wallet bar + top-up + 免单模式 (freeShop) + target character selector for 1-click "买下并穿戴 / 使用".
// 2. 商城进货 (Restock): Upload an image (multimodal vision + item thumbnail) and/or enter text description to have AI
//    generate new <skin_suit_design> / <flesh_ring_design> / <apparel_design> items and put them on the shelves.
// 3. 4 Shelves: 皮躯专柜, 肉躯专柜, 服饰与饰品, 异构道具与消耗品.

import {createView, esc, heading} from './common.js';
import {icon} from './icons.js';
import {getEntity} from '../core/xeno.js';
import {blobToDataUrl, generateItemPreview} from './xeno-media.js';

const SHELVES = [
  ['skin_suit', '皮躯专柜'],
  ['flesh_ring', '肉躯专柜'],
  ['apparel', '服饰饰品'],
  ['consumable', '异构道具']
];

const SLOT_LABELS = {
  skin_suit: '活体皮躯',
  flesh_ring: '活体肉躯',
  outerwear: '外搭衣物',
  underwear: '内衣裤装',
  privacyCover: '隐私遮挡',
  accessories: '附加饰品',
  consumable: '消耗道具'
};

export function mallApp(ctx) {
  const {api} = ctx, v = createView(ctx, 'mall');
  let activeShelf = 'skin_suit';
  let apparelFilter = 'all';
  let searchQuery = '';
  let restockOpen = false;
  let restockCategory = 'apparel';
  let restockSlot = 'outerwear';
  let restockText = '';
  let restockImage = '';
  let restockAutoDraw = false;
  let uploadTargetItemId = '';
  const drawingIds = new Set();

  const xenoState = () => api.getState().xeno;
  const walletState = () => api.wallet?.() || {balance: 0};
  const unsubscribe = api.subscribe(e => {
    if (e?.type === 'xeno' || e?.type === 'wallet' || e?.type === 'settings') v.refresh();
  });
  const origDispose = v.dispose.bind(v);
  v.dispose = () => { unsubscribe?.(); origDispose(); };

  function renderRestockPanel() {
    const busy = api.xenoBusy?.('restock');
    return `
      <section class="xeno-status-card mall-restock-box">
        <header class="xeno-status-head">
          <div class="xeno-status-title">
            <span class="xeno-badge target">RESTOCK</span>
            <strong>商城进货工坊（图文同步上新）</strong>
          </div>
          <button type="button" class="xeno-mini-btn" data-action="toggle-restock">收起</button>
        </header>
        <div class="xeno-form-block">
          <div class="xeno-grid-2">
            <label class="xeno-field-inline">
              <span>进货大类</span>
              <select class="xeno-select" data-change="restock-cat">
                <option value="skin_suit" ${restockCategory === 'skin_suit' ? 'selected' : ''}>1. 活体皮躯</option>
                <option value="flesh_ring" ${restockCategory === 'flesh_ring' ? 'selected' : ''}>2. 活体肉躯</option>
                <option value="apparel" ${restockCategory === 'apparel' ? 'selected' : ''}>3. 服饰与饰品</option>
                <option value="consumable" ${restockCategory === 'consumable' ? 'selected' : ''}>4. 异构道具消耗品</option>
              </select>
            </label>
            ${restockCategory === 'apparel' ? `
              <label class="xeno-field-inline">
                <span>服饰穿戴槽位</span>
                <select class="xeno-select" data-change="restock-slot">
                  <option value="outerwear" ${restockSlot === 'outerwear' ? 'selected' : ''}>外搭衣物槽</option>
                  <option value="underwear" ${restockSlot === 'underwear' ? 'selected' : ''}>内衣裤装槽</option>
                  <option value="privacyCover" ${restockSlot === 'privacyCover' ? 'selected' : ''}>隐私遮挡槽</option>
                  <option value="accessories" ${restockSlot === 'accessories' ? 'selected' : ''}>附加饰品槽</option>
                </select>
              </label>
            ` : ''}
          </div>
          <div class="tb-restock-media">
            <div class="tb-img-box restock-preview">
              ${restockImage
                ? `<img src="${esc(restockImage)}" alt="进货主图">`
                : `<div class="tb-img-empty">
                     <span class="tb-img-cat">商品主图位</span>
                     <small>上传或自动生图</small>
                   </div>`}
              <div class="tb-img-actions">
                <button type="button" class="tb-img-btn" data-action="pick-restock-img">📷 上传图</button>
                ${restockImage ? `<button type="button" class="tb-img-btn" data-action="clear-restock-img">清除</button>` : ''}
              </div>
              <input type="file" accept="image/*" id="mall-restock-file" data-change="restock-file" hidden>
            </div>
            <div class="tb-restock-fields">
              <label class="xeno-field-inline" style="margin:0">
                <span>进货文字描述 / 款式要求（留空则 AI 随机创意进货）</span>
                <textarea class="xeno-textarea" id="mall-restock-text" rows="3" placeholder="例如：高冷黑丝修女皮躯，白发红瞳，I罩杯爆乳，真空高开叉修女袍…">${esc(restockText)}</textarea>
              </label>
              <div class="xeno-row-between" style="margin-top:6px">
                <span class="xeno-hint">未上传图片时自动调用 AI 生图作为主图</span>
                <button type="button" role="switch" aria-checked="${restockAutoDraw}" class="xeno-switch-btn ${restockAutoDraw ? 'on' : ''}" data-action="toggle-restock-autodraw"><i></i></button>
              </div>
            </div>
          </div>
          <div class="xeno-row-controls">
            <button type="button" class="xeno-btn primary full" data-action="run-restock" ${busy ? 'disabled' : ''}>
              ${busy ? '✨ AI 正在设计新货并同步主图…' : '✨ AI 生成新货并同步图片上架'}
            </button>
          </div>
        </div>
      </section>
    `;
  }

  v.refresh = () => {
    const xeno = xenoState();
    const wallet = walletState();
    const targetKey = xeno.wardrobeTarget || '__protagonist__';
    const wearer = getEntity(xeno, targetKey) || xeno.protagonist;
    const allPeople = [
      ['__protagonist__', `主角${xeno.protagonist.name ? '：' + xeno.protagonist.name : ''}`],
      ...xeno.targets.map(t => [t.name, `目标：${t.name}`])
    ];
    const q = searchQuery.trim().toLowerCase();
    const shelfItems = (xeno.items || []).filter(i => {
      if (i.category !== activeShelf) return false;
      if (activeShelf === 'apparel' && apparelFilter !== 'all' && i.slot !== apparelFilter) return false;
      if (q && !`${i.name} ${i.shortName} ${i.summary} ${i.bodyBuild}`.toLowerCase().includes(q)) return false;
      return true;
    });

    v.draw(`
      ${heading(
        '购物商城',
        `<button type="button" class="round-button" data-action="go-wardrobe" title="打开衣柜">${icon('layers')}</button>
         <button type="button" class="round-button" data-action="go-xeno" title="打开异构终端">${icon('wand')}</button>`,
        'Xeno Boutique'
      )}
      <section class="tb-header-card">
        <div class="tb-search-row">
          <div class="tb-search-box">
            <span class="tb-search-ico">🔍</span>
            <input type="search" class="tb-search-input" id="mall-search-input" data-field="mall-search" value="${esc(searchQuery)}" placeholder="搜索皮躯 / 肉躯 / 高定服饰…">
          </div>
          <button type="button" class="tb-restock-trigger" data-action="toggle-restock">
            ${restockOpen ? '收起进货' : '+ 进货上架'}
          </button>
        </div>
        <div class="tb-wallet-row">
          <div class="tb-wallet-left">
            <span class="tb-wallet-label">💰 零钱</span>
            <strong class="tb-wallet-num">¥${esc(String(wallet.balance ?? 0))}</strong>
            <button type="button" class="xeno-mini-btn" data-action="wallet-topup">充值</button>
          </div>
          <button type="button" role="switch" aria-checked="${xeno.freeShop}" class="tb-free-pill ${xeno.freeShop ? 'on' : ''}" data-action="toggle-free-shop">
            <span class="dot"></span>
            <span>${xeno.freeShop ? '尊享免单：已开启' : '免单模式：已关闭'}</span>
          </button>
        </div>
        <div class="tb-wearer-row">
          <span>穿戴目标：</span>
          <select class="xeno-select" data-change="select-mall-wearer" aria-label="穿戴目标">
            ${allPeople.map(([k, label]) => `<option value="${esc(k)}" ${targetKey === k ? 'selected' : ''}>${esc(label)}</option>`).join('')}
          </select>
        </div>
      </section>
      ${restockOpen ? renderRestockPanel() : ''}
      <nav class="xeno-module-tabs cols-4" aria-label="商城专柜">
        ${SHELVES.map(([k, label]) => `
          <button type="button" class="xeno-tab ${activeShelf === k ? 'active' : ''}" data-action="mall-shelf" data-shelf="${esc(k)}">${esc(label)}</button>
        `).join('')}
      </nav>
      ${activeShelf === 'apparel' ? `
        <div class="xeno-chip-group" style="margin-bottom:8px">
          ${[['all', '全部'], ['outerwear', '外搭衣物'], ['underwear', '内衣裤装'], ['privacyCover', '隐私遮挡'], ['accessories', '附加饰品']].map(([k, label]) => `
            <button type="button" class="xeno-chip ${apparelFilter === k ? 'active' : ''}" data-action="mall-apparel-filter" data-filter="${esc(k)}">${esc(label)}</button>
          `).join('')}
        </div>
      ` : ''}
      <input type="file" accept="image/*" id="mall-item-file" data-change="mall-item-file" hidden>
      <section class="xeno-module-card">
        <div class="xeno-sec-title">
          <strong>🔥 ${esc(SHELVES.find(([k]) => k === activeShelf)?.[1] || '专柜')} · 官方自营</strong>
          <small>共 ${shelfItems.length} 件宝贝</small>
        </div>
        <div class="tb-product-list">
          ${shelfItems.map(item => {
            const isDrawing = drawingIds.has(item.id);
            return `
              <article class="tb-card ${item.owned ? 'owned' : ''}" data-action="view-mall-item" data-id="${esc(item.id)}">
                <div class="tb-img-box">
                  ${item.imageData
                    ? `<img src="${esc(item.imageData)}" alt="${esc(item.shortName)}" data-action="preview-mall-img" data-id="${esc(item.id)}">`
                    : `<div class="tb-img-empty">
                         <span class="tb-img-cat">${esc(SLOT_LABELS[item.slot] || item.category)}</span>
                         <small>${isDrawing ? 'AI 绘图中…' : '待上传/生图'}</small>
                       </div>`}
                  <div class="tb-img-actions">
                    <button type="button" class="tb-img-btn" data-action="upload-mall-img" data-id="${esc(item.id)}" title="上传本地图片">📷 上传</button>
                    <button type="button" class="tb-img-btn" data-action="draw-mall-img" data-id="${esc(item.id)}" ${isDrawing ? 'disabled' : ''} title="AI 生成商品图">${isDrawing ? '绘图中' : '🎨 生图'}</button>
                  </div>
                </div>
                <div class="tb-info">
                  <div class="tb-title-row">
                    <strong class="tb-title">${esc(item.name)}</strong>
                    ${item.source === 'restock' ? `<button type="button" class="tb-del-btn" data-action="delete-mall-item" data-id="${esc(item.id)}" title="下架删除">×</button>` : ''}
                  </div>
                  <p class="tb-desc">${esc(item.summary)}</p>
                  ${item.bodyBuild ? `<p class="tb-spec"><b>规格：</b>${esc(item.bodyBuild)}</p>` : ''}
                  <div class="tb-price-row">
                    <div class="tb-price-box">
                      ${xeno.freeShop
                        ? `<span class="tb-price"><i>¥</i>0</span><span class="tb-free-badge">免单价</span><del class="tb-orig-price">¥${item.price}</del>`
                        : `<span class="tb-price"><i>¥</i>${item.price}</span>`}
                    </div>
                    <span class="tb-stock-tag ${item.owned ? 'owned' : ''}">${item.owned ? '✓ 已在衣柜' : '官方现货'}</span>
                  </div>
                  <div class="tb-bottom-row">
                    <div class="tb-buy-group">
                      ${item.category === 'consumable' ? `
                        <button type="button" class="tb-btn-buy full" data-action="buy-and-equip" data-id="${esc(item.id)}">
                          立即对【${esc(wearer.name)}】使用
                        </button>
                      ` : `
                        <button type="button" class="tb-btn-cart" data-action="buy-only" data-id="${esc(item.id)}" ${item.owned ? 'disabled' : ''}>
                          ${item.owned ? '已入衣柜' : '加入衣柜'}
                        </button>
                        <button type="button" class="tb-btn-buy" data-action="buy-and-equip" data-id="${esc(item.id)}">
                          立即穿戴
                        </button>
                      `}
                    </div>
                  </div>
                </div>
              </article>
            `;
          }).join('')}
        </div>
      </section>
    `);
  };

  v.on('input', '#mall-search-input', el => {
    searchQuery = el.value;
    v.refresh();
  });

  v.on('click', '[data-action]', async el => {
    const act = el.dataset.action;
    const xeno = xenoState();
    const targetKey = xeno.wardrobeTarget || '__protagonist__';
    const wearer = getEntity(xeno, targetKey) || xeno.protagonist;

    if (act === 'go-wardrobe') { ctx.open('wardrobe'); return; }
    if (act === 'go-xeno') { ctx.open('xeno'); return; }
    if (act === 'mall-shelf') { activeShelf = el.dataset.shelf; v.refresh(); return; }
    if (act === 'mall-apparel-filter') { apparelFilter = el.dataset.filter; v.refresh(); return; }
    if (act === 'toggle-free-shop') {
      const nextFree = !xeno.freeShop;
      api.saveXeno({freeShop: nextFree});
      ctx.notify(nextFree ? '已开启商城免单模式（全场 ¥0 购入）' : '已关闭商城免单模式');
      return;
    }
    if (act === 'toggle-restock-autodraw') {
      restockText = v.root.querySelector('#mall-restock-text')?.value || restockText;
      restockAutoDraw = !restockAutoDraw;
      v.refresh();
      return;
    }
    if (act === 'toggle-restock') {
      restockOpen = !restockOpen;
      if (restockOpen && activeShelf) restockCategory = activeShelf;
      v.refresh();
      return;
    }
    if (act === 'pick-restock-img') {
      restockText = v.root.querySelector('#mall-restock-text')?.value || restockText;
      v.root.querySelector('#mall-restock-file')?.click();
      return;
    }
    if (act === 'clear-restock-img') { restockImage = ''; v.refresh(); return; }
    if (act === 'upload-mall-img') {
      uploadTargetItemId = el.dataset.id;
      v.root.querySelector('#mall-item-file')?.click();
      return;
    }
    if (act === 'draw-mall-img') {
      const item = xeno.items.find(i => i.id === el.dataset.id);
      if (!item || drawingIds.has(item.id)) return;
      drawingIds.add(item.id);
      v.refresh();
      try {
        const url = await generateItemPreview(ctx, item);
        if (url) ctx.notify(`已生成「${item.shortName}」主图并同步至商城与衣柜`);
      } finally {
        drawingIds.delete(item.id);
        v.refresh();
      }
      return;
    }
    if (act === 'preview-mall-img') {
      const item = xeno.items.find(i => i.id === el.dataset.id);
      if (item?.imageData) {
        ctx.dialog(item.shortName || item.name, `<img class="wardrobe-sheet-img" style="max-height:65vh;object-fit:contain" src="${esc(item.imageData)}" alt="">`);
      }
      return;
    }
    if (act === 'run-restock') {
      restockText = v.root.querySelector('#mall-restock-text')?.value || '';
      await v.busy(el, async () => {
        const created = await api.mallRestock({
          category: restockCategory,
          slot: restockCategory === 'apparel' ? restockSlot : restockCategory,
          text: restockText,
          imageData: restockImage
        });
        if (created?.category) activeShelf = created.category;
        const needAutoDraw = restockAutoDraw && !restockImage && created?.id;
        restockText = '';
        restockImage = '';
        restockOpen = false;
        v.refresh();
        if (needAutoDraw) {
          drawingIds.add(created.id);
          v.refresh();
          try {
            await generateItemPreview(ctx, created);
          } catch (err) {
            ctx.notify('新货已上架，自动配图未完成：' + err.message, {error: true});
          } finally {
            drawingIds.delete(created.id);
            v.refresh();
          }
        }
      });
      return;
    }
    if (act === 'wallet-topup') {
      const d = ctx.dialog('钱包零钱充值', `
        <div class="xeno-sheet-form">
          <label class="xeno-field-inline">
            <span>充值金额（元）</span>
            <input type="number" class="xeno-input" data-topup-amount value="5000" min="1" max="9999999">
          </label>
          <div class="actions">
            <button type="button" class="secondary" data-sheet-cancel>取消</button>
            <button type="button" class="primary" data-sheet-save>立即充值</button>
          </div>
        </div>
      `);
      d.body.addEventListener('click', e => {
        if (e.target.closest('[data-sheet-cancel]')) d.close(null);
        if (e.target.closest('[data-sheet-save]')) {
          const amount = Number(d.body.querySelector('[data-topup-amount]')?.value || 5000);
          api.walletTopup(amount);
          d.close(true);
          ctx.notify(`已充值 ¥${amount}`);
        }
      });
      return;
    }
    if (act === 'buy-only') {
      const item = xeno.items.find(i => i.id === el.dataset.id);
      if (!item) return;
      api.buyXenoItem(item.id);
      ctx.notify(`已购买「${item.shortName}」并收入【衣柜】！`);
      return;
    }
    if (act === 'buy-and-equip') {
      const item = xeno.items.find(i => i.id === el.dataset.id);
      if (!item) return;
      api.buyXenoItem(item.id, {equipTargetKey: targetKey, equipMode: item.category === 'flesh_ring' ? 'forward' : ''});
      ctx.notify(item.category === 'consumable'
        ? `已对「${wearer.name}」使用「${item.shortName}」！`
        : `已为「${wearer.name}」购买并穿戴「${item.shortName}」！`);
      return;
    }
    if (act === 'view-mall-item') {
      const item = xeno.items.find(i => i.id === el.dataset.id);
      if (!item) return;
      ctx.dialog(item.name, `
        <div class="xeno-sheet-form">
          ${item.imageData ? `<img class="wardrobe-sheet-img" src="${esc(item.imageData)}" alt="">` : ''}
          <p><b>分类：</b>${esc(SLOT_LABELS[item.slot] || item.category)} ｜ <b>售价：</b>¥${esc(String(item.price))}</p>
          <p><b>简介：</b>${esc(item.summary)}</p>
          ${item.appearance ? `<p><b>外貌特征：</b>${esc(item.appearance)}</p>` : ''}
          ${item.bodyBuild ? `<p><b>体型身材：</b>${esc(item.bodyBuild)}</p>` : ''}
          ${item.physiology ? `<p><b>生理特征：</b>${esc(item.physiology)}</p>` : ''}
          ${item.drawPrompt ? `<p><b>生图提示词：</b><code>${esc(item.drawPrompt)}</code></p>` : ''}
          <label class="xeno-field-inline">
            <span>完整高定档案</span>
            <textarea class="xeno-textarea" rows="7" readonly>${esc(item.rawDesign)}</textarea>
          </label>
        </div>
      `);
      return;
    }
    if (act === 'delete-mall-item') {
      const item = xeno.items.find(i => i.id === el.dataset.id);
      if (item && await ctx.confirm(`下架删除「${item.name}」？`, '删除后将从商城与衣柜中移除。')) {
        api.xenoAct('deleteItem', {itemId: item.id});
      }
    }
  });

  v.on('change', '[data-change]', async el => {
    const act = el.dataset.change;
    if (act === 'select-mall-wearer') { api.xenoAct('selectWardrobeTarget', {key: el.value}); return; }
    if (act === 'restock-cat') {
      restockText = v.root.querySelector('#mall-restock-text')?.value || restockText;
      restockCategory = el.value;
      v.refresh();
      return;
    }
    if (act === 'restock-slot') {
      restockText = v.root.querySelector('#mall-restock-text')?.value || restockText;
      restockSlot = el.value;
      v.refresh();
      return;
    }
    if (act === 'restock-file') {
      restockText = v.root.querySelector('#mall-restock-text')?.value || restockText;
      const file = el.files?.[0];
      el.value = '';
      if (file) {
        restockImage = await blobToDataUrl(ctx.win, file);
        v.refresh();
      }
      return;
    }
    if (act === 'mall-item-file') {
      const file = el.files?.[0];
      const item = xenoState().items.find(i => i.id === uploadTargetItemId);
      el.value = '';
      if (file && item) {
        const imageData = await blobToDataUrl(ctx.win, file);
        api.xenoAct('saveItem', {...item, imageData});
        ctx.notify(`已更新「${item.shortName}」主图并同步至衣柜`);
      }
    }
  });

  v.refresh();
  return v;
}
