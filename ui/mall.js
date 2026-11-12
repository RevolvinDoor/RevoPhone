// App 3: 购物商城 (mall)
// Features:
// 1. Wallet bar + top-up + 免单模式 (freeShop) + target character selector for 1-click "买下并穿戴 / 使用".
// 2. 商城进货 (Restock): Upload an image (multimodal vision + item thumbnail) and/or enter text description to have AI
//    generate new <skin_suit_design> / <flesh_ring_design> / <apparel_design> items and put them on the shelves.
// 3. 4 Shelves: 皮躯专柜, 肉躯专柜, 服饰与饰品, 异构道具与消耗品.

import {createView, esc, heading} from './common.js';
import {icon} from './icons.js';
import {getEntity, formatVoiceRoleLabel, activeXenoPreset, xenoPromptEntryText, activeMallPoseEntryId, MALL_POSE_ENTRIES, XENO_PROMPT_DEFAULTS, itemVoiceRef} from '../core/xeno.js';
import {blobToDataUrl, generateItemPreview, openVoicePoolPickerDialog, openItemVoiceListPicker} from './xeno-media.js';
import {saveFile} from '../download.js';
import {openItemEditor} from './xeno-item-editor.js';
import {buildMallRestockRequest, formatMallRestockRequest} from '../core/xeno-restock.js';

export const MALL_ITEMS_FILE = 'revophone-mall-items';

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
  let restockGender = '';
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

  function ensurePoseEntriesInPreset(preset) {
    for (const def of MALL_POSE_ENTRIES) {
      if (!preset.entries.some(e => e.id === def.id)) {
        preset.entries.push({
          id: def.id,
          title: def.title,
          scope: 'mall',
          triggerMode: 'auto',
          enabled: def.id === 'mallPosePrompt',
          text: XENO_PROMPT_DEFAULTS[def.id] || ''
        });
      }
    }
  }

  function selectPosePresetEntry(targetEntryId) {
    const xeno = xenoState();
    const preset = structuredClone(activeXenoPreset(xeno));
    ensurePoseEntriesInPreset(preset);
    const curActiveId = activeMallPoseEntryId(xeno);
    const poseInput = v.root.querySelector('#mall-pose-prompt-input');
    if (curActiveId && poseInput) {
      const curEntry = preset.entries.find(e => e.id === curActiveId);
      if (curEntry && poseInput.value.trim() !== String(curEntry.text || '').trim()) {
        curEntry.text = poseInput.value.trim();
      }
    }
    const targetEntry = preset.entries.find(e => e.id === targetEntryId);
    const wasOnlyActive = curActiveId === targetEntryId && targetEntry?.enabled !== false;
    for (const def of MALL_POSE_ENTRIES) {
      const entry = preset.entries.find(e => e.id === def.id);
      if (!entry) continue;
      entry.enabled = wasOnlyActive ? false : (def.id === targetEntryId);
    }
    api.saveXenoPreset(preset);
    return !wasOnlyActive;
  }

  function savePosePrompt(nextPoseText, targetEntryId = '') {
    const xeno = xenoState();
    const preset = structuredClone(activeXenoPreset(xeno));
    ensurePoseEntriesInPreset(preset);
    const id = targetEntryId || activeMallPoseEntryId(xeno) || 'mallPosePrompt';
    const entry = preset.entries.find(e => e.id === id);
    const clean = String(nextPoseText ?? '').trim();
    if (entry) {
      entry.text = clean;
      if (clean && !activeMallPoseEntryId(xeno)) entry.enabled = true;
    }
    api.saveXenoPreset(preset);
  }

  function restockInput() {
    return {
      category: restockCategory,
      slot: restockCategory === 'apparel' ? restockSlot : restockCategory,
      text: v.root.querySelector('#mall-restock-text')?.value || '',
      gender: ['skin_suit', 'flesh_ring'].includes(restockCategory) ? restockGender : '',
      imageData: restockImage
    };
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
    const preset = activeXenoPreset(xeno);
    const activePoseId = activeMallPoseEntryId(xeno);
    const activePoseEntry = activePoseId ? preset.entries?.find(e => e.id === activePoseId) : null;
    const curPosePrompt = activePoseEntry ? String(activePoseEntry.text ?? '') : '';
    const activePoseMeta = MALL_POSE_ENTRIES.find(d => d.id === activePoseId);
    return `
      <section class="xeno-status-card mall-restock-box">
        <header class="xeno-status-head">
          <div class="xeno-status-title">
            <span class="xeno-badge target">RESTOCK</span>
            <strong>商城进货工坊（图文同步上新）</strong>
          </div>
          <div class="xeno-status-actions">
            <button type="button" class="xeno-mini-btn" data-action="preview-restock">查看本次请求</button>
            <button type="button" class="xeno-mini-btn" data-action="open-mall-batch" title="无图批量导出/导入商品 JSON">📦 批量导入/导出</button>
            <button type="button" class="xeno-mini-btn" data-action="toggle-restock">收起</button>
          </div>
        </header>
        <div class="xeno-form-block">
          <div class="xeno-row-controls">
            <button type="button" class="xeno-btn secondary full" data-action="manual-restock">✎ 手动录入商品（不调用模型）</button>
          </div>
          <p class="xeno-hint">已有完整设定可直接手动录入并定价；需要 AI 帮忙设计时，使用下方进货工坊。</p>
          <p class="xeno-hint">当前使用预设：${esc(preset.name)} · 比例尺${xenoPromptEntryText(xeno, 'scaleRule').trim() ? '已启用' : '已关闭或清空'}。修改比例尺后请保存并使用对应的「异构」预设。</p>
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
            ${['skin_suit', 'flesh_ring'].includes(restockCategory) ? `<label class="xeno-field-inline"><span>身体类型</span><select class="xeno-select" data-change="restock-gender">${[['', '按输入／参考设定'], ['女', '女性'], ['男', '男性'], ['扶她', '扶她']].map(([key, title]) => `<option value="${key}" ${restockGender === key ? 'selected' : ''}>${title}</option>`).join('')}</select></label>` : ''}
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
              <span>商品生图姿势与构图提示词（${activePoseMeta ? `当前：${esc(activePoseMeta.label)} · 预设独立保存` : '未启用姿势预设 · 点击右侧按钮切换'}）</span>
              <div class="xeno-chip-group" style="margin:0">
                ${MALL_POSE_ENTRIES.map(({id, label}) => {
                  const entry = preset.entries?.find(e => e.id === id);
                  const isOn = entry ? entry.enabled !== false : id === 'mallPosePrompt';
                  return `<button type="button" class="xeno-mini-btn ${isOn ? 'primary' : ''}" data-action="set-pose-preset" data-pose-id="${esc(id)}" title="切换「${esc(label)}」独立预设条目（不会覆盖其他姿势提示词）">${esc(label)}</button>`;
                }).join('')}
              </div>
            </div>
            <input type="text" class="xeno-input" id="mall-pose-prompt-input" data-pose-id="${esc(activePoseId || 'mallPosePrompt')}" data-change="save-pose-prompt" value="${esc(curPosePrompt)}" placeholder="${activePoseId ? '当前姿势预设的提示词（修改后仅保存在该按钮对应的预设条目中）' : '点击上方任意姿势按钮启用对应预设，或直接输入自定义姿势 Tag'}">
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
      if (i.listed === false) return false;
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
                  ${(item.category === 'skin_suit' || item.category === 'flesh_ring') && itemVoiceRef(xeno, item)
                    ? `<p class="tb-spec"><b>🎙️ 声带音色：</b>${esc(formatVoiceRoleLabel(itemVoiceRef(xeno, item), api.getState().voicePool || []))}（${item.category === 'skin_suit' ? '全脸覆面生效' : '后方延展·全脸覆面生效'}）</p>`
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
    if (act === 'preview-restock') {
      const draft = structuredClone(xeno), preset = activeXenoPreset(draft);
      const poseId = activeMallPoseEntryId(draft), pose = preset.entries.find(entry => entry.id === poseId);
      const poseInput = v.root.querySelector('#mall-pose-prompt-input');
      if (pose && poseInput) pose.text = poseInput.value.trim();
      const request = buildMallRestockRequest(draft, restockInput());
      ctx.dialog(`本次进货请求 · ${preset.name}`, `<p class="xeno-hint">使用当前已保存的异构预设及此处输入；只包含选中分类和当前姿势。此预览不调用模型，也不保存表单。实际请求和回复可在「日志」查看。</p><textarea class="xeno-textarea" rows="22" readonly aria-label="本次进货请求">${esc(formatMallRestockRequest(request))}</textarea>`);
      return;
    }
    if (act === 'manual-restock') {
      restockText = v.root.querySelector('#mall-restock-text')?.value || '';
      openItemEditor(ctx, {destination: 'mall', category: restockCategory, slot: restockSlot, gender: restockGender, initialText: restockText,
        onSaved({category}) {activeShelf = category; searchQuery = ''; apparelFilter = 'all'; v.refresh();}});
      return;
    }
    if (act === 'set-pose-preset') {
      restockText = v.root.querySelector('#mall-restock-text')?.value || restockText;
      const poseId = el.dataset.poseId || 'mallPosePrompt';
      const enabled = selectPosePresetEntry(poseId);
      const meta = MALL_POSE_ENTRIES.find(d => d.id === poseId);
      ctx.notify(enabled ? `已切换为「${meta?.label || poseId}」独立姿势预设` : `已关闭「${meta?.label || poseId}」姿势预设`);
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
      const input = restockInput();
      restockText = input.text;
      const poseInput = v.root.querySelector('#mall-pose-prompt-input');
      const activePoseId = activeMallPoseEntryId(xeno);
      if (poseInput && activePoseId && poseInput.value.trim() !== xenoPromptEntryText(xeno, activePoseId).trim()) {
        savePosePrompt(poseInput.value.trim(), activePoseId);
      }
      restocking = true;
      v.refresh();
      await v.busy(el, async () => {
        let created = null;
        try {
          created = await api.mallRestock(input);
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
      const voicePool = state.voicePool || [];
      let currentVoice = itemVoiceRef(state.xeno, item);
      const d = ctx.dialog(item.name, `
        <div class="xeno-sheet-form">
          ${item.imageData ? `<img class="wardrobe-sheet-img" src="${esc(item.imageData)}" alt="">` : ''}
          <p><b>分类：</b>${esc(SLOT_LABELS[item.slot] || item.category)} ｜ <b>售价：</b>¥${esc(String(item.price))}</p>
          <p><b>简介：</b>${esc(item.summary)}</p>
          ${isLiving ? `
            <div class="xeno-field-inline">
              <span>🎙️ 绑定声带音色</span>
              <p class="xeno-hint" data-item-voice-label>当前音色：${esc(formatVoiceRoleLabel(currentVoice, voicePool) || '未绑定，使用本体音色')}</p>
              <div class="xeno-row-controls">
                <button type="button" class="xeno-mini-btn" data-pick-list-voice>从列表选</button>
                <button type="button" class="xeno-mini-btn" data-pick-fav-voice>♡ 从收藏夹选</button>
              </div>
              <p class="xeno-hint">${item.category === 'skin_suit' ? '全脸覆面时生效' : '后方延展·全脸覆面时生效'}。选择后自动永久保存，购买前也可以先设置。</p>
            </div>
          ` : ''}
          ${item.appearance ? `<p><b>外貌特征：</b>${esc(item.appearance)}</p>` : ''}
          ${item.bodyBuild ? `<p><b>体型身材：</b>${esc(item.bodyBuild)}</p>` : ''}
          ${item.physiology ? `<p><b>生理特征：</b>${esc(item.physiology)}</p>` : ''}
          ${isLiving ? `<p><b>身体类型：</b>${esc(item.gender || '未设定')} ｜ <b>下体处理：</b>${esc(({replace: '使用本件结构', preserve: '保留内层／本体', legacy: '旧版兼容'})[item.lowerBodyMode])}</p>` : ''}
          ${item.lowerBodyDescription ? `<p><b>下体设定：</b>${esc(item.lowerBodyDescription)}</p>` : ''}
          ${item.abilities ? `<p><b>特殊能力：</b>${esc(item.abilities)}</p><p><b>生效条件：</b>${esc(item.abilityConditions || '穿戴期间，按能力描述')}</p>` : ''}
          ${item.drawPrompt ? `<p><b>角色生图提示词：</b><code>${esc(item.drawPrompt)}</code></p>` : ''}
          ${item.organDrawPrompt ? `<p><b>肉棒生图提示词：</b><code>${esc(item.organDrawPrompt)}</code></p>` : ''}
          <label class="xeno-field-inline">
            <span>完整高定档案</span>
            <textarea class="xeno-textarea" rows="7" readonly>${esc(item.rawDesign)}</textarea>
          </label>
            <div class="actions">
              <button type="button" class="primary" data-sheet-edit>编辑设定与能力</button>
              <button type="button" class="secondary" data-sheet-cancel>完成</button>
            </div>
        </div>
      `);
        d.body.addEventListener('click', e => {
          if (e.target.closest('[data-sheet-cancel]')) d.close(null);
          if (e.target.closest('[data-sheet-edit]')) {
            d.close(null); openItemEditor(ctx, {item}); return;
          }
          if (e.target.closest('[data-pick-fav-voice],[data-pick-list-voice]')) {
            const picker = e.target.closest('[data-pick-list-voice]') ? openItemVoiceListPicker : openVoicePoolPickerDialog;
            picker(ctx, {
              currentValue: currentVoice,
              onSelect: (ref, label) => {
                api.xenoAct('saveItem', {id: item.id, voiceRole: ref});
                currentVoice = ref;
                d.body.querySelector('[data-item-voice-label]').textContent = `当前音色：${label || '未绑定，使用本体音色'}`;
                ctx.notify(ref ? `已为「${item.shortName || item.name}」绑定${label}` : '已清除声带音色绑定');
              }
            });
            return;
          }
        });
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
      savePosePrompt(el.value, el.dataset.poseId || '');
      ctx.notify('已保存到当前姿势预设条目（同步至「预设 · 异构」）');
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
    if (act === 'restock-gender') { restockGender = el.value; return; }
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
