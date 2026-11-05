// Shared image upload compression & AI product image generation helper for 购物商城 (mall) and 衣柜 (wardrobe).

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
    api.xenoAct('saveItem', {...item, imageData});
  }
  return imageData;
}
