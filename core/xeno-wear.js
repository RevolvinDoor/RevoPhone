const text = (value, limit = 120) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const kinds = ['skin_suit', 'flesh_ring'];
const last = (list, predicate) => list.slice().reverse().find(predicate);

export function normalizeWearMount(raw = {}) {
  raw = raw && typeof raw === 'object' ? raw : {};
  let input = raw.layers;
  if (!Array.isArray(input)) {
    input = [];
    if (raw.skinSuitId) input.push({itemId: raw.skinSuitId, kind: 'skin_suit', faceMode: raw.skinFaceMode, organOut: raw.skinOrganOut, voiceRole: raw.skinVoiceRole});
    if (raw.fleshRingId) input.push({itemId: raw.fleshRingId, kind: 'flesh_ring', faceMode: raw.fleshFaceMode, extendMode: raw.fleshExtendMode, voiceRole: raw.fleshVoiceRole});
  }
  const seen = new Set(), layers = [];
  for (const entry of input.slice(0, 200)) {
    if (!entry || !kinds.includes(entry.kind)) continue;
    const itemId = text(entry.itemId);
    if (!itemId || seen.has(itemId)) continue;
    seen.add(itemId);
    layers.push({
      itemId, kind: entry.kind,
      faceMode: entry.faceMode === 'neck' ? 'neck' : 'full',
      extendMode: ['idle', 'forward', 'backward'].includes(entry.extendMode) ? entry.extendMode : 'idle',
      organOut: entry.organOut !== false,
      voiceRole: text(entry.voiceRole, 4000)
    });
  }
  return syncWearMount({layers});
}

export function syncWearMount(mount) {
  const skin = last(mount.layers, layer => layer.kind === 'skin_suit');
  const ring = last(mount.layers, layer => layer.kind === 'flesh_ring');
  return Object.assign(mount, {
    skinSuitId: skin?.itemId || '', skinFaceMode: skin?.faceMode || 'full',
    skinOrganOut: skin?.organOut !== false, skinVoiceRole: skin?.voiceRole || '',
    fleshRingId: ring?.itemId || '', fleshFaceMode: ring?.faceMode || 'full',
    fleshExtendMode: ring?.extendMode || 'idle', fleshVoiceRole: ring?.voiceRole || ''
  });
}

export function wearLayers(entity) {
  return normalizeWearMount(entity?.livingMount).layers;
}

export function itemVoiceRef(xeno, item, layer = null) {
  if (item?.voiceRoleExplicit) return item.voiceRole || '';
  return item?.voiceRole || xeno.itemVoiceBindings?.[item?.id] || layer?.voiceRole || item?.sourceTargetName || '';
}

export function itemOccupant(xeno, itemId) {
  for (const entity of [xeno.protagonist, ...(xeno.targets || [])]) {
    if (!entity) continue;
    const layers = wearLayers(entity);
    const index = layers.findIndex(layer => layer.itemId === itemId);
    if (index >= 0) return {entity, targetKey: entity === xeno.protagonist ? '__protagonist__' : entity.name, layer: index + 1};
    for (const slot of ['outerwear', 'underwear', 'privacyCover', 'accessories']) {
      if (entity.outfit?.[slot + 'ItemId'] === itemId) return {entity, targetKey: entity === xeno.protagonist ? '__protagonist__' : entity.name, slot};
    }
  }
  return null;
}

export function resolveWear(xeno, entity) {
  const items = new Map((xeno.items || []).map(item => [item.id, item]));
  const layers = wearLayers(entity).map((layer, index) => ({...layer, index, item: items.get(layer.itemId)}))
    .filter(layer => layer.item && layer.item.category === layer.kind);
  const covering = layer => layer.kind === 'skin_suit' || layer.extendMode === 'backward';
  const body = last(layers, covering) || null;
  const head = last(layers, layer => covering(layer) && layer.faceMode === 'full') || null;
  const organ = last(layers, layer => layer.organOut && (
    layer.kind === 'flesh_ring' ? layer.extendMode !== 'idle'
      : layer.item.gender === '扶她' || Boolean(layer.item.forwardExtension)
  )) || null;
  const headVoice = head ? text(itemVoiceRef(xeno, head.item, head), 4000) : '';
  const label = layer => layer ? `${layer.item.name}（第 ${layer.index + 1} 层）` : '本体';
  return {
    layers, body, head, organ, headVoice,
    bodySource: label(body), headSource: label(head), organSource: organ ? label(organ) : '本体／未显露',
    headAppearance: head?.item.appearance || entity?.appearance || '',
    organAppearance: organ ? (organ.item.forwardExtension || organ.item.physiology || organ.item.summary || organ.item.name)
      : ['男', '扶她'].includes(entity?.gender) ? '本体外观（未单独记录）' : '',
    layerText: layers.length ? layers.map(layer => `${layer.index + 1}. ${layer.item.name}［${layer.kind === 'skin_suit' ? '皮躯' : '肉躯 · ' + layer.extendMode} · ${layer.faceMode === 'full' ? '覆面' : '头部收起'} · 独立部位${layer.organOut ? '启用' : '收起'}］`).join(' → ') : '未穿戴'
  };
}

export function wearDrawingTags(xeno, entity) {
  const view = resolveWear(xeno, entity);
  const facial = /(?:hair|eyes?|eyebrows?|eyelashes?|face|facial|head|ears?|horns?|bangs|braid|ponytail|pigtails|beard|lipstick|lips|makeup|mouth|teeth|fangs|头发|发色|瞳|眼睛|脸|面容|面貌|耳朵)/i;
  const organTag = /(?:futanari|penis|erection|testicles|scrotum|genital|阴茎|肉棒|玉囊)/i;
  const parts = value => String(value || '').split(',').map(part => part.trim()).filter(Boolean);
  const result = [];
  if (view.body) result.push(...parts(view.body.item.drawPrompt).filter(part =>
    (view.body.itemId === view.head?.itemId || !facial.test(part))
    && (view.body.itemId === view.organ?.itemId || !organTag.test(part))));
  if (view.head && view.head.itemId !== view.body?.itemId) result.push(...parts(view.head.item.drawPrompt).filter(part => facial.test(part)));
  if (view.body && !view.head) result.push(...parts(entity.appearance).filter(part => facial.test(part)));
  if (view.organ && view.organ.itemId !== view.body?.itemId) result.push(...parts(view.organ.item.drawPrompt).filter(part => organTag.test(part)));
  return [...new Set(result)].join(', ');
}
