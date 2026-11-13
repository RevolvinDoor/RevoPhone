// Shared manual/assistant image operations. No UI mounting or implicit model request.
import {buildEntityPortraitPrompt, getEntity, xenoMallPosePromptText} from './core/xeno.js';
import {filterLowerBodyTags, itemLowerBodyType, normalizeCharacterDrawPrompt, normalizeOrganDrawPrompt} from './core/xeno-wear.js';
import {stripQualityDrawTags} from './core/xeno-wear.js';

async function drawImage(ctx, input) {
  if (ctx.signal?.aborted || ctx.valid && !ctx.valid()) throw Error('操作已取消或聊天已切换');
  const stop = () => ctx.api.cancelDraw?.(input.key);
  ctx.signal?.addEventListener('abort', stop, {once: true});
  try { return await ctx.api.generateImage(input); }
  finally { ctx.signal?.removeEventListener('abort', stop); }
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
  const poseTags = xenoMallPosePromptText(state.xeno).trim();
  const personTag = item.gender === '男' ? '1boy' : item.gender ? '1girl' : '';
  const lowerType = itemLowerBodyType(item);
  const charPrompt = normalizeCharacterDrawPrompt(item.drawPrompt);
  const organPrompt = !(item.lowerBodyMode === 'replace' && ['female', 'none'].includes(lowerType)) && item.organDrawPrompt
    ? normalizeOrganDrawPrompt(item.organDrawPrompt)
    : '';
  const rawTags = [
    charPrompt || [
      item.category === 'skin_suit' || item.category === 'flesh_ring' ? `${personTag}, solo, full body` : 'solo, fashion showcase',
      item.appearance,
      item.bodyBuild,
      item.summary
    ].filter(Boolean).join(', '),
    organPrompt
  ].filter(Boolean).join(', ');
  const baseTags = item.lowerBodyMode === 'replace' ? filterLowerBodyTags(rawTags, lowerType) : rawTags;
  const combinedBase = poseTags && !String(baseTags).toLowerCase().includes(poseTags.slice(0, 18).toLowerCase())
    ? `${poseTags}, ${baseTags}`
    : baseTags;
  const combinedPrompt = [style.artist, style.positive, combinedBase].map(s => String(s || '').trim()).filter(Boolean).join(', ');
  const prompt = stripQualityDrawTags(item.lowerBodyMode === 'replace' ? filterLowerBodyTags(combinedPrompt, lowerType) : combinedPrompt);
  const negative = String(style.negative || 'lowres, bad anatomy, bad hands, text, error').trim();

  let result;
  try {
    result = await drawImage(ctx, {
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
      result = await drawImage(ctx, {
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
    if (ctx.valid && !ctx.valid()) throw Error('操作已取消或聊天已切换，图片已保留在相册');
    if (!api.getState().xeno.items.some(row => row.id === item.id)) throw Error('商品已被删除，图片已保留在相册');
    api.xenoAct('saveItem', {id: item.id, imageData});
  }
  ctx.onImage?.(result);
  return imageData;
}

/** Generates a full-body portrait for the protagonist or target character based on their current appearance, body, living mounts, and 4-slot outfit. */
export async function generateEntityPortrait(ctx, targetKey = '__protagonist__', customBaseTags = '') {
  const {api} = ctx;
  if (!api.drawReady?.()) {
    throw Error((api.drawMissing?.() || '请先在「绘图」App 配置绘图接口与密钥') + '，或点击「查看形态图」上传本地立绘');
  }
  const state = api.getState();
  const xeno = state.xeno;
  const entity = getEntity(xeno, targetKey) || xeno.protagonist;
  const isProt = targetKey === '__protagonist__' || entity === xeno.protagonist;
  const built = buildEntityPortraitPrompt(xeno, entity);
  const baseTags = String(customBaseTags || built.prompt).trim();
  const style = state.draw?.styles?.find(s => s.id === state.draw.activeStyle) || state.draw?.styles?.[0] || {artist: '', positive: '', negative: ''};
  const prompt = stripQualityDrawTags([style.artist, style.positive, baseTags].map(s => String(s || '').trim()).filter(Boolean).join(', '));
  const negative = String(style.negative || 'lowres, bad anatomy, bad hands, text, error').trim();
  const entityName = built.entityName || entity.name || (isProt ? '主角' : '角色');

  let result;
  try {
    result = await drawImage(ctx, {
      prompt,
      negative,
      name: `形态图-${entityName}`,
      key: `xeno-portrait:${isProt ? 'prot' : entityName}`,
      label: `异构形态图 · ${entityName}`,
      allowPaid: false
    });
  } catch (error) {
    if (error?.code === 'PAID' || /扣 Anlas|花钱/.test(String(error?.message || ''))) {
      const ask = api.paidPrompt?.() || {title: '确认生成当前形态图', text: error.message};
      if (!await ctx.confirm(ask.title, ask.text)) return '';
      result = await drawImage(ctx, {
        prompt,
        negative,
        name: `形态图-${entityName}`,
        key: `xeno-portrait:${isProt ? 'prot' : entityName}`,
        label: `异构形态图 · ${entityName}`,
        allowPaid: true
      });
    } else {
      throw error;
    }
  }

  if (!result?.photoId) throw Error('未能获取生成的形态图');
  const photo = await api.getPhoto(result.photoId);
  if (!photo?.blob) throw Error('读取生成的形态图失败');
  const portraitData = await blobToDataUrl(ctx.win, photo.blob);
  if (ctx.valid && !ctx.valid()) throw Error('操作已取消或聊天已切换，图片已保留在相册');
  api.xenoAct('applyBodyMod', {
    targetKey: isProt ? '__protagonist__' : entity.name,
    patch: {portraitData}
  });
  ctx.onImage?.(result);
  return portraitData;
}
