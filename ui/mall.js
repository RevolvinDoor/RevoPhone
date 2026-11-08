// App 3: 购物商城 (mall)
// Features:
// 1. Wallet bar + top-up + 免单模式 (freeShop) + target character selector for 1-click "买下并穿戴 / 使用".
// 2. 商城进货 (Restock): Upload an image (multimodal vision + item thumbnail) and/or enter text description to have AI
//    generate new <skin_suit_design> / <flesh_ring_design> / <apparel_design> items and put them on the shelves.
// 3. 4 Shelves: 皮躯专柜, 肉躯专柜, 服饰与饰品, 异构道具与消耗品.

import {createView, esc, heading} from './common.js';
import {icon} from './icons.js';
import {getEntity, formatVoiceRoleLabel, activeXenoPreset, xenoPromptEntryText, XENO_PROMPT_DEFAULTS} from '../core/xeno.js';
import {blobToDataUrl, generateItemPreview, renderVoiceBindSelectOptions, openVoicePoolPickerDialog} from './xeno-media.js';
import {saveFile} from '../download.js';

export const MALL_ITEMS_FILE = 'revophone-mall-items';

const POSE_PRESETS = [
  ['🧍 T-pose+三视图', XENO_PROMPT_DEFAULTS.mallPosePrompt],
  ['📐 标准站姿三视图', 'character sheet, reference sheet, multiple views, three-view drawing, front view, side view, back view, full body, standing, simple background, white background'],
  ['✨ 单人全身展示', 'solo, full body, standing, looking at viewer, fashion showcase, simple background, high quality']
];

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
  let restocking = false;
  let uploadTargetItemId = '';
  const drawingIds = new Set();

  const xenoState = () => api.getState().xeno;
  const walletState = () => api.wallet?.() || {balance: 0};
  const unsubscribe = api.subscribe(e => {
    if (e?.type === 'xeno' || e?.type === 'wallet' || e?.type === 'settings') v.refresh();
  });
  const origDispose = v.dispose.bind(v);
  v.dispose = () => { unsubscribe?.(); origDispose(); };

  function savePosePrompt(nextPoseText) {
    const xeno = xenoState();
    const preset = structuredClone(activeXenoPreset(xeno));
    const entry = preset.entries.find(e => e.id === 'mallPosePrompt');
    if (entry) {
      entry.text = String(nextPoseText ?? '').trim();
      entry.enabled = !!entry.text;
    } else {
      preset.entries.push({
        id: 'mallPosePrompt',
        title: '商城进货 · 商品生图姿势提示词（T-pose+三视图）',
        scope: 'mall',
        triggerMode: 'auto',
        enabled: !!String(nextPoseText ?? '').trim(),
        text: String(nextPoseText ?? '').trim()
      });
    }
    api.saveXenoPreset(preset);
  }

  function serializeMallItems(items) {
    const cleanList = (Array.isArray(items) ? items : []).map(item => {
      const {imageData, ...rest} = item;
      return rest;
    });
    return JSON.stringify({
      format: MALL_ITEMS_FILE,
      version: 1,
      exportedAt: new Date().toISOString(),
      count: cleanList.length,
      items: cleanList
    }, null, 2);
  }

  function openBatchManageSheet() {
    const xeno = xenoState();
    const allItems = xeno.items || [];
    const customItems = allItems.filter(i => i.source !== 'shop');
    const initialExport = serializeMallItems(customItems.length ? customItems : allItems);
    const d = ctx.dialog('📦 商店进货批量导入 / 导出（不含图片）', `
      <div class="xeno-sheet-form">
        <p class="xeno-hint">批量导出与导入仅包含商品设定文本、价格、槽位、生图 Tag 与完整 XML 设定块，<b>不包含图片数据</b>，轻量且便于批量编辑或跨设备分享。导入同 ID 商品时会自动保留本地已有的商品配图。</p>
        <div class="xeno-row-controls" style="flex-wrap:wrap;gap:6px">
          <button type="button" class="xeno-mini-btn primary" data-batch-export="custom">📤 导出进货单品文件（${customItems.length} 件）</button>
          <button type="button" class="xeno-mini-btn" data-batch-export="all">📤 导出全部商品文件（${allItems.length} 件）</button>
          <button type="button" class="xeno-mini-btn" data-batch-fill="custom">显示进货 JSON</button>
          <button type="button" class="xeno-mini-btn" data-batch-fill="all">显示全部 JSON</button>
        </div>
        <label class="xeno-field-inline">
          <span>商品 JSON 数据（可直接复制、粘贴或批量修改后点下方导入）</span>
          <textarea class="xeno-textarea mono" rows="9" data-batch-json spellcheck="false">${esc(initialExport)}</textarea>
        </label>
        <label style="display:flex;align-items:center;gap:6px;margin:4px 0;font-size:12px;cursor:pointer">
          <input type="checkbox" data-batch-replace>
          <span>覆盖替换现有进货单品（不勾选则为增量合并/更新同 ID 商品）</span>
        </label>
        <input type="file" accept=".json,application/json,text/plain" data-batch-file hidden>
        <div class="actions" style="flex-wrap:wrap;gap:6px">
          <button type="button" class="secondary" data-batch-pick-file>📁 从 JSON 文件导入</button>
          <button type="button" class="primary" data-batch-import-text>📥 导入上方 JSON 内容</button>
          <button type="button" class="secondary" data-batch-close>关闭</button>
        </div>
      </div>
    `);

    const runImportText = rawText => {
      let parsed;
      try {
        parsed = JSON.parse(String(rawText || '').replace(/^\uFEFF/, '').trim());
      } catch {
        throw Error('JSON 格式不正确，请检查括号与引号是否完整');
      }
      const list = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.items)
        ? parsed.items
        : (parsed && typeof parsed === 'object' && parsed.name ? [parsed] : null);
      if (!list || !list.length) throw Error('未在 JSON 中找到有效的商品列表（items）');
      const replaceRestock = !!d.body.querySelector('[data-batch-replace]')?.checked;
      api.xenoAct('importItems', {items: list, replaceRestock});
      d.close(true);
      ctx.notify(`已批量导入 ${list.length} 件商品（不含图片，已保留本地配图）`);
    };

    const fileInput = d.body.querySelector('[data-batch-file]');
    fileInput?.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      try {
        const text = await file.text();
        const area = d.body.querySelector('[data-batch-json]');
        if (area) area.value = text;
        runImportText(text);
      } catch (err) {
        ctx.notify(err?.message || '导入失败', {error: true});
      }
    });

    d.body.addEventListener('click', async e => {
      if (e.target.closest('[data-batch-close]')) { d.close(null); return; }
      if (e.target.closest('[data-batch-pick-file]')) { fileInput?.click(); return; }
      const fillBtn = e.target.closest('[data-batch-fill]');
      if (fillBtn) {
        const mode = fillBtn.dataset.batchFill;
        const targetList = mode === 'all' ? allItems : customItems;
        const area = d.body.querySelector('[data-batch-json]');
        if (area) area.value = serializeMallItems(targetList);
        ctx.notify(`已切换显示${mode === 'all' ? '全部商品' : '进货单品'}（共 ${targetList.length} 件）`);
        return;
      }
      const expBtn = e.target.closest('[data-batch-export]');
      if (expBtn) {
        const mode = expBtn.dataset.batchExport;
        const targetList = mode === 'all' ? allItems : customItems;
        if (!targetList.length) {
          ctx.notify('当前没有可导出的进货单品，可点击「导出全部商品文件」', {error: true});
          return;
        }
        const text = serializeMallItems(targetList);
        const area = d.body.querySelector('[data-batch-json]');
        if (area) area.value = text;
        try {
          const fileName = mode === 'all' ? '商城全部商品(无图).json' : '商城进货单品(无图).json';
          const savedName = await saveFile(ctx.doc, new Blob([text], {type: 'application/json'}), fileName);
          ctx.notify('已导出 ' + savedName);
        } catch (err) {
          ctx.notify(err?.message || '导出失败', {error: true});
        }
        return;
      }
      if (e.target.closest('[data-batch-import-text]')) {
        try {
          const text = d.body.querySelector('[data-batch-json]')?.value || '';
          runImportText(text);
        } catch (err) {
          ctx.notify(err?.message || '导入失败', {error: true});
        }
      }
    });
  }

  function renderRestockPanel() {
    const busy = restocking || !!api.xenoBusy?.('restock');
    const xeno = xenoState();
    const curPosePrompt = xenoPromptEntryText(xeno, 'mallPosePrompt');
    return `
      <section class="xeno-status-card mall-restock-box">
        <header class="xeno-status-head">
          <div class="xeno-status-title">
            <span class="xeno-badge target">RESTOCK</span>
            <strong>商城进货工坊（图文同步上新）</strong>
          </div>
          <div class="xeno-status-actions">
            <button type="button" class="xeno-mini-btn" data-action="open-mall-batch" title="无图批量导出/导入商品 JSON">📦 批量导入/导出</button>
            <button type="button" class="xeno-mini-btn" data-action="toggle-restock">收起</button>
          </div>
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
          <div class="xeno-field-inline" style="margin-top:6px">
            <div class="xeno-row-between" style="margin-bottom:4px;flex-wrap:wrap;gap:4px">
              <span>商品生图姿势与构图提示词（如 T-pose + 三视图，自动用于进货与商品生图）</span>
              <div class="xeno-chip-group" style="margin:0">
                ${POSE_PRESETS.map(([label, val]) => `<button type="button" class="xeno-mini-btn ${curPosePrompt.trim() === val ? 'primary' : ''}" data-action="set-pose-preset" data-pose="${esc(val)}">${esc(label)}</button>`).join('')}
              </div>
            </div>
            <input type="text" class="xeno-input" id="mall-pose-prompt-input" data-change="save-pose-prompt" value="${esc(curPosePrompt)}" placeholder="例如：character sheet, multiple views, front view, side view, back view, t-pose, full body">
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
          <button type="button" class="xeno-mini-btn" data-action="open-mall-batch" title="批量导出/导入商品（不含图片）">📦 导入/导出</button>
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
                  ${(item.category === 'skin_suit' || item.category === 'flesh_ring') && (item.voiceRole || xeno.itemVoiceBindings?.[item.id] || item.sourceTargetName)
                    ? `<p class="tb-spec"><b>🎙️ 声带音色：</b>${esc(formatVoiceRoleLabel(item.voiceRole || xeno.itemVoiceBindings?.[item.id] || item.sourceTargetName, api.getState().voicePool || []))}（${item.category === 'skin_suit' ? '全脸覆面生效' : '后方延展·全脸覆面生效'}）</p>`
                    : ''}
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
    if (act === 'open-mall-batch') { openBatchManageSheet(); return; }
    if (act === 'set-pose-preset') {
      restockText = v.root.querySelector('#mall-restock-text')?.value || restockText;
      savePosePrompt(el.dataset.pose || '');
      ctx.notify('已更新商品生图姿势提示词');
      return;
    }
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
      if (restocking || api.xenoBusy?.('restock')) return;
      restockText = v.root.querySelector('#mall-restock-text')?.value || '';
      const poseInput = v.root.querySelector('#mall-pose-prompt-input');
      if (poseInput && poseInput.value.trim() !== xenoPromptEntryText(xeno, 'mallPosePrompt').trim()) {
        savePosePrompt(poseInput.value.trim());
      }
      restocking = true;
      v.refresh();
      await v.busy(el, async () => {
        let created = null;
        try {
          created = await api.mallRestock({
            category: restockCategory,
            slot: restockCategory === 'apparel' ? restockSlot : restockCategory,
            text: restockText,
            imageData: restockImage
          });
        } finally {
          restocking = false;
          v.refresh();
        }
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
      const isLiving = item.category === 'skin_suit' || item.category === 'flesh_ring';
      const state = api.getState();
      const routes = (state.routes || []).filter(r => r?.name && r.roleKind !== 'narrator');
      const voicePool = state.voicePool || [];
      const curVoice = item.voiceRole || state.xeno?.itemVoiceBindings?.[item.id] || item.sourceTargetName || '';
      const d = ctx.dialog(item.name, `
        <div class="xeno-sheet-form">
          ${item.imageData ? `<img class="wardrobe-sheet-img" src="${esc(item.imageData)}" alt="">` : ''}
          <p><b>分类：</b>${esc(SLOT_LABELS[item.slot] || item.category)} ｜ <b>售价：</b>¥${esc(String(item.price))}</p>
          <p><b>简介：</b>${esc(item.summary)}</p>
          ${isLiving ? `
            <div class="xeno-field-inline">
              <div class="xeno-row-between" style="margin-bottom:4px">
                <span>🎙️ 绑定声带音色（${item.category === 'skin_suit' ? '全脸覆面时生效' : '后方延展·全脸覆面时生效'}）</span>
                <button type="button" class="xeno-mini-btn primary" data-pick-fav-voice>♡ 从音色收藏夹选</button>
              </div>
              <select class="xeno-select" data-mall-voice>
                ${renderVoiceBindSelectOptions({currentValue: curVoice, emptyLabel: '（不切换音色，保持穿戴者本人音色）', routes, voicePool})}
              </select>
            </div>
          ` : ''}
          ${item.appearance ? `<p><b>外貌特征：</b>${esc(item.appearance)}</p>` : ''}
          ${item.bodyBuild ? `<p><b>体型身材：</b>${esc(item.bodyBuild)}</p>` : ''}
          ${item.physiology ? `<p><b>生理特征：</b>${esc(item.physiology)}</p>` : ''}
          ${item.drawPrompt ? `<p><b>生图提示词：</b><code>${esc(item.drawPrompt)}</code></p>` : ''}
          <label class="xeno-field-inline">
            <span>完整高定档案</span>
            <textarea class="xeno-textarea" rows="7" readonly>${esc(item.rawDesign)}</textarea>
          </label>
          ${isLiving ? `
            <div class="actions">
              <button type="button" class="secondary" data-sheet-cancel>关闭</button>
              <button type="button" class="primary" data-sheet-save-voice>保存音色绑定</button>
            </div>
          ` : ''}
        </div>
      `);
      if (isLiving) {
        d.body.addEventListener('change', e => {
          const sel = e.target.closest('[data-mall-voice]');
          if (!sel) return;
          const voiceRole = sel.value.trim();
          api.xenoAct('saveItem', {id: item.id, voiceRole});
          ctx.notify(voiceRole ? `已绑定「${formatVoiceRoleLabel(voiceRole, api.getState().voicePool || [])}」的声带音色` : '已清除声带音色绑定');
        });
        d.body.addEventListener('click', e => {
          if (e.target.closest('[data-sheet-cancel]')) d.close(null);
          if (e.target.closest('[data-pick-fav-voice]')) {
            const sel = d.body.querySelector('[data-mall-voice]');
            openVoicePoolPickerDialog(ctx, {
              currentValue: sel?.value || '',
              onSelect: (ref, label) => {
                api.xenoAct('saveItem', {id: item.id, voiceRole: ref});
                if (sel) {
                  const latest = api.getState();
                  sel.innerHTML = renderVoiceBindSelectOptions({
                    currentValue: ref,
                    emptyLabel: '（不切换音色，保持穿戴者本人音色）',
                    routes: latest.routes || [],
                    voicePool: latest.voicePool || []
                  });
                  sel.value = ref;
                }
                ctx.notify(ref ? `已为「${item.shortName || item.name}」绑定${label}` : '已清除声带音色绑定');
              }
            });
            return;
          }
          if (e.target.closest('[data-sheet-save-voice]')) {
            const voiceRole = d.body.querySelector('[data-mall-voice]')?.value?.trim() || '';
            api.xenoAct('saveItem', {id: item.id, voiceRole});
            d.close(true);
            ctx.notify(voiceRole ? `已绑定「${formatVoiceRoleLabel(voiceRole, api.getState().voicePool || [])}」的声带音色` : '已清除声带音色绑定');
          }
        });
      }
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
    if (act === 'save-pose-prompt') {
      restockText = v.root.querySelector('#mall-restock-text')?.value || restockText;
      savePosePrompt(el.value);
      ctx.notify('已保存商品生图姿势提示词（同步至「预设 · 异构」）');
      return;
    }
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
        api.xenoAct('saveItem', {id: item.id, imageData});
        ctx.notify(`已更新「${item.shortName}」主图并同步至衣柜`);
      }
    }
  });

  v.refresh();
  return v;
}
