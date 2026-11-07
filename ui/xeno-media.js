// Shared image upload compression & AI product image generation helper for 购物商城 (mall) and 衣柜 (wardrobe).
import {esc} from './common.js';
import {icon} from './icons.js';
import {poolLine, VOICE_LANGUAGES} from '../core/auto-voice.js';
import {encodePoolVoiceRef, parsePoolVoiceRef, formatVoiceRoleLabel} from '../core/xeno.js';

const ENGINE_LABELS = {
  fish: 'Fish Audio',
  mini: 'MiniMax',
  eleven: 'ElevenLabs',
  mimo: '小米 MiMo',
  doubao: '豆包语音',
  custom: '自定义接口'
};

/** Renders `<option>` / `<optgroup>` items for binding either a `voicePool` (音色收藏夹) entry or a `角色` App route. */
export function renderVoiceBindSelectOptions({
  currentValue = '',
  emptyLabel = '（不切换音色，保持本人原音色）',
  routes = [],
  voicePool = []
} = {}) {
  const cur = String(currentValue || '').trim();
  const poolOpts = (Array.isArray(voicePool) ? voicePool : []).map(f => {
    const ref = encodePoolVoiceRef(f);
    const meta = [ENGINE_LABELS[f.engine] || f.engine, VOICE_LANGUAGES[f.language], f.style].filter(Boolean).join(' · ');
    return {ref, html: `<option value="${esc(ref)}" ${cur === ref ? 'selected' : ''}>💖 收藏夹：${esc(f.name)}${meta ? `（${esc(meta)}）` : ''}</option>`};
  });
  const parsedCur = parsePoolVoiceRef(cur, voicePool);
  const extraPoolOpt = (parsedCur && !poolOpts.some(o => o.ref === cur))
    ? `<option value="${esc(cur)}" selected>💖 收藏夹：${esc(parsedCur.name)}（${esc(ENGINE_LABELS[parsedCur.engine] || parsedCur.engine)}）</option>`
    : '';
  const roleOpts = (Array.isArray(routes) ? routes : [])
    .filter(r => r?.name && r.roleKind !== 'narrator')
    .map(r => `<option value="${esc(r.name)}" ${cur === r.name ? 'selected' : ''}>🎙️ 角色【${esc(r.name)}】${r.voice ? '（已配音）' : '（待配音）'}</option>`);

  return [
    `<option value="" ${!cur ? 'selected' : ''}>${esc(emptyLabel)}</option>`,
    (poolOpts.length || extraPoolOpt)
      ? `<optgroup label="💖 音色收藏夹（直接选用收藏音色）">${extraPoolOpt}${poolOpts.map(o => o.html).join('')}</optgroup>`
      : '',
    roleOpts.length
      ? `<optgroup label="👤 角色 App（跟随角色配音）">${roleOpts.join('')}</optgroup>`
      : ''
  ].join('');
}

/** Opens a picker sheet showing all voices in `音色收藏夹` (`state.voicePool`) and invokes `onSelect(ref, label)`. */
export function openVoicePoolPickerDialog(ctx, {currentValue = '', onSelect} = {}) {
  const state = ctx.api.getState();
  const pool = state.voicePool || [];
  const cur = String(currentValue || '').trim();
  const html = pool.length ? `
    <div class="xeno-sheet-form">
      <p class="xeno-hint">点击下方收藏的音色即可直接绑定为声带音色：</p>
      <div class="group" style="max-height:52vh;overflow-y:auto;margin:6px 0">
        ${pool.map((f, idx) => {
          const ref = encodePoolVoiceRef(f);
          const active = cur === ref;
          const desc = [ENGINE_LABELS[f.engine] || f.engine, poolLine({...f, name: ''})].filter(Boolean).join(' · ');
          return `
            <div class="list-row voice-choice" style="${active ? 'background:rgba(255,80,0,0.08);border-color:#ff5000' : ''}">
              <button type="button" class="voice-choice-pick" data-pick-pool-idx="${idx}">
                <span class="disc">${icon('heart', true)}</span>
                <span>
                  <strong>${esc(f.name)}${active ? '（当前已绑）' : ''}</strong>
                  <small>${esc(desc)}</small>
                  <small class="mono">${esc(f.voice)}</small>
                </span>
              </button>
              <button type="button" class="chip-button" data-audition-pool-idx="${idx}" title="试听这个音色" style="flex:none">${icon('play', true)}试听</button>
            </div>
          `;
        }).join('')}
      </div>
      <div class="actions">
        <button type="button" class="secondary" data-pool-clear>清除绑定</button>
        <button type="button" class="secondary" data-pool-close>关闭</button>
      </div>
    </div>
  ` : `
    <div class="xeno-sheet-form">
      <p class="help-copy">你的「音色收藏夹」目前还是空的。可以在「角色」App 的「音色收藏夹」中手动添加、从音色列表点 ♡ 收藏，或直接导入音色库 JSON 文件。</p>
      <div class="actions">
        <button type="button" class="secondary" data-pool-close>关闭</button>
        <button type="button" class="primary" data-pool-go-roles>前往「角色」App 管理收藏夹</button>
      </div>
    </div>
  `;

  // Mount as a stacked overlay when another sheet is already open so we never close the parent sheet (`sheet?.close(null)`)
  const screen = ctx.doc?.querySelector?.('.screen') || ctx.doc?.body;
  const hasExistingOverlay = !!screen?.querySelector?.('.overlay');
  let d;
  if (hasExistingOverlay && screen) {
    const overlay = ctx.doc.createElement('div');
    overlay.className = 'overlay';
    overlay.style.zIndex = '60';
    overlay.innerHTML = `<section class="sheet" role="dialog" aria-modal="true" aria-label="从音色收藏夹选择音色"><header class="sheet-header"><h2>💖 从音色收藏夹选择音色</h2><button class="nav-button" data-sheet-close aria-label="关闭">${icon('close')}</button></header><div class="sheet-body">${html}</div></section>`;
    screen.append(overlay);
    const close = () => { if (overlay.isConnected) overlay.remove(); };
    overlay.addEventListener('click', e => {
      if (e.target === overlay || e.target.closest('[data-sheet-close]')) close();
    });
    d = {body: overlay.querySelector('.sheet-body'), close};
  } else {
    d = ctx.dialog('💖 从音色收藏夹选择音色', html);
  }

  d.body.addEventListener('click', e => {
    if (e.target.closest('[data-pool-close]')) { d.close(null); return; }
    if (e.target.closest('[data-pool-go-roles]')) { d.close(null); ctx.open('roles'); return; }
    if (e.target.closest('[data-pool-clear]')) {
      d.close(true);
      onSelect?.('', '');
      return;
    }
    const audBtn = e.target.closest('[data-audition-pool-idx]');
    if (audBtn) {
      e.preventDefault();
      e.stopPropagation();
      const fav = pool[Number(audBtn.dataset.auditionPoolIdx)];
      if (fav?.voice) {
        ctx.api.audition({
          name: fav.name || '试听音色',
          engine: fav.engine || 'fish',
          voice: fav.voice,
          model: fav.model || '',
          language: fav.language || ''
        });
      }
      return;
    }
    const btn = e.target.closest('[data-pick-pool-idx]');
    if (btn) {
      const idx = Number(btn.dataset.pickPoolIdx);
      const fav = pool[idx];
      if (fav) {
        const ref = encodePoolVoiceRef(fav);
        d.close(true);
        onSelect?.(ref, formatVoiceRoleLabel(ref, pool));
      }
    }
  });
}

/** Compresses an image File or Blob to a compact JPEG data URI (max 640px) so it can be stored in item.imageData. */
export async function blobToDataUrl(win, fileOrBlob) {
  if (!fileOrBlob) return '';
  return new Promise((resolve, reject) => {
    const reader = new win.FileReader();
    reader.onerror = () => reject(Error('读取图片失败'));
    reader.onload = () => {
      const rawUrl = String(reader.result || '');
      const img = new win.Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, 640 / Math.max(img.width || 1, img.height || 1));
          const canvas = win.document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          const g = canvas.getContext('2d');
          g.fillStyle = '#fff';
          g.fillRect(0, 0, canvas.width, canvas.height);
          g.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.84));
        } catch {
          resolve(rawUrl);
        }
      };
      img.onerror = () => resolve(rawUrl);
      img.src = rawUrl;
    };
    reader.readAsDataURL(fileOrBlob);
  });
}

/** Generates a product preview image for a Mall/Wardrobe item using the phone's configured drawing engine (NovelAI/GPT/ComfyUI). */
export async function generateItemPreview(ctx, item) {
  const {api} = ctx;
  if (!api.drawReady?.()) {
    throw Error((api.drawMissing?.() || '请先在「绘图」App 配置绘图接口与密钥') + '，或直接点击「上传」使用本地图片');
  }
  const state = api.getState();
  const style = state.draw?.styles?.find(s => s.id === state.draw.activeStyle) || state.draw?.styles?.[0] || {artist: '', positive: '', negative: ''};
  const baseTags = item.drawPrompt || [
    item.category === 'skin_suit' || item.category === 'flesh_ring' ? '1girl, solo, full body, masterpiece' : '1girl, solo, fashion showcase',
    item.appearance,
    item.bodyBuild,
    item.summary
  ].filter(Boolean).join(', ');
  const prompt = [style.artist, style.positive, baseTags].map(s => String(s || '').trim()).filter(Boolean).join(', ');
  const negative = String(style.negative || 'lowres, bad anatomy, bad hands, text, error').trim();

  let result;
  try {
    result = await api.generateImage({
      prompt,
      negative,
      name: `商城-${item.shortName || item.name}`,
      key: `mall:${item.id}`,
      label: `商城商品图 · ${item.shortName || item.name}`,
      allowPaid: false
    });
  } catch (error) {
    if (error?.code === 'PAID' || /扣 Anlas|花钱/.test(String(error?.message || ''))) {
      const ask = api.paidPrompt?.() || {title: '确认生成商品图', text: error.message};
      if (!await ctx.confirm(ask.title, ask.text)) return '';
      result = await api.generateImage({
        prompt,
        negative,
        name: `商城-${item.shortName || item.name}`,
        key: `mall:${item.id}`,
        label: `商城商品图 · ${item.shortName || item.name}`,
        allowPaid: true
      });
    } else {
      throw error;
    }
  }

  if (!result?.photoId) throw Error('未能获取生成的商品图片');
  const photo = await api.getPhoto(result.photoId);
  if (!photo?.blob) throw Error('读取生成的商品图片失败');
  const imageData = await blobToDataUrl(ctx.win, photo.blob);
  if (item.id && !item.id.startsWith('draft_')) {
    api.xenoAct('saveItem', {id: item.id, imageData});
  }
  return imageData;
}
