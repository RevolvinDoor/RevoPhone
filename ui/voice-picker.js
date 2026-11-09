import {esc, engines, btn} from './common.js';
import {icon} from './icons.js';
import {guessVoice} from '../core/auto-voice.js';

export function voicePickerDialog(ctx, title, html) {
  const screen = ctx.doc?.querySelector?.('.screen') || ctx.doc?.body;
  if (!screen?.querySelector?.('.overlay')) return ctx.dialog(title, html);
  const overlay = ctx.doc.createElement('div');
  overlay.className = 'overlay';
  overlay.style.zIndex = String(70 + screen.querySelectorAll('.overlay').length);
  overlay.innerHTML = `<section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header class="sheet-header"><h2>${esc(title)}</h2><button type="button" class="nav-button" data-sheet-close aria-label="关闭">${icon('close')}</button></header><div class="sheet-body">${html}</div></section>`;
  const previousFocus = ctx.doc.activeElement;
  let live = true;
  const close = () => {
    live = false;
    overlay.remove();
    if (previousFocus?.isConnected) previousFocus.focus();
  };
  overlay.addEventListener('click', event => {
    if (event.target === overlay || event.target.closest('[data-sheet-close]')) close();
  });
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.stopPropagation(); close(); }
    if (event.key === 'Tab') {
      const controls = [...overlay.querySelectorAll('button,input,select,textarea,a[href]')].filter(control => !control.disabled && !control.hidden);
      if (event.shiftKey && ctx.doc.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
      else if (!event.shiftKey && ctx.doc.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
    }
  });
  screen.append(overlay);
  overlay.querySelector('[data-sheet-close]').focus();
  return {body: overlay.querySelector('.sheet-body'), close, get live() { return live && overlay.isConnected; }};
}

export function openVoiceListPicker(ctx, {route = {}, chooseEngine = false, onSelect} = {}) {
  const {api} = ctx;
  let engine = route.engine || 'fish', model = route.model || '', page = 0, token = '', search = '', epoch = 0;
  const found = new Map();
  const favorites = () => api.getState().voicePool || [];
  const isFavorite = voice => favorites().some(entry => entry.engine === engine && entry.voice === voice);
  const favoriteButton = voice => engine === 'custom' ? '' : `<button type="button" class="fav-toggle" data-fav="${esc(voice)}" aria-pressed="${isFavorite(voice)}" aria-label="${isFavorite(voice) ? '取消收藏' : '收藏'}">${icon('heart', isFavorite(voice))}</button>`;
  const dialog = voicePickerDialog(ctx, '选择音色', `${chooseEngine ? `<div class="field"><span>引擎</span><select data-voice-engine aria-label="音色引擎">${Object.entries(engines).map(([key, name]) => `<option value="${key}" ${key === engine ? 'selected' : ''}>${name}</option>`).join('')}</select></div><div class="field"><span>模型</span><select data-voice-model aria-label="音色模型"></select></div>` : ''}<div class="field"><input class="search" type="search" placeholder="搜索音色" aria-label="搜索音色"></div><div class="actions">${btn('search', '搜索', 'secondary')}</div><div class="group" data-voices></div>`);
  const paintModels = () => {
    const control = dialog.body.querySelector('[data-voice-model]');
    if (!control) return;
    const connection = api.getState().connections[engine] || {};
    const models = api.engineSchema(engine)?.models || [];
    control.innerHTML = `<option value="">跟随引擎 · ${esc(connection.model || '')}</option>${models.map(entry => `<option value="${esc(entry.id)}" ${entry.supported === false ? 'disabled' : ''}>${esc(entry.id)}</option>`).join('')}`;
    control.value = model;
  };
  const load = async more => {
    const ticket = ++epoch;
    if (!more) { page = 0; token = ''; found.clear(); }
    const list = dialog.body.querySelector('[data-voices]');
    list.dataset.engine = engine;
    if (!more) list.innerHTML = '<p class="hint">正在读取…</p>';
    try {
      const saved = api.getState().connections[engine] || {};
      const result = await api.voices(engine, {...saved, model: model || saved.model}, {search, page, token});
      if (!dialog.live || ticket !== epoch) return;
      const rows = engine === 'mini' && search
        ? result.voices.filter(entry => entry.name.toLowerCase().includes(search.toLowerCase()) || entry.id.includes(search)) : result.voices;
      for (const entry of rows) found.set(entry.id, entry);
      const html = rows.map(entry => `<div class="list-row voice-choice"><button type="button" class="voice-choice-pick" data-voice="${esc(entry.id)}"><span class="disc">${icon('wave')}</span><span><strong>${esc(entry.name)}</strong><small class="mono">${esc(entry.id)}</small></span></button><button type="button" class="chip-button" data-audition="${esc(entry.id)}" aria-label="试听${esc(entry.name)}">${icon('play', true)}</button>${favoriteButton(entry.id)}</div>`).join('');
      if (!more) list.innerHTML = html || '<p class="hint">没有找到音色，可以在角色页直接填写音色 ID。</p>';
      else { list.querySelector('[data-more]')?.remove(); list.insertAdjacentHTML('beforeend', html); }
      if (result.more) list.insertAdjacentHTML('beforeend', '<button type="button" class="text-button" data-more>加载更多</button>');
      token = result.token;
      page++;
    } catch (error) {
      if (dialog.live && ticket === epoch) list.innerHTML = `<p class="error-copy">${esc(error.message)}</p>`;
    }
  };
  const descriptor = voice => ({
    engine, voice, name: found.get(voice)?.name || voice,
    model: model || api.getState().connections[engine]?.model || '',
    language: route.language || api.getState().general.defaultLanguage || 'zh'
  });
  dialog.body.addEventListener('change', event => {
    if (event.target.matches('[data-voice-engine]')) {
      engine = event.target.value;
      model = '';
      paintModels();
      load(false);
    } else if (event.target.matches('[data-voice-model]')) {
      model = event.target.value;
      load(false);
    }
  });
  dialog.body.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.fav) {
      const voice = button.dataset.fav, list = [...favorites()], index = list.findIndex(entry => entry.engine === engine && entry.voice === voice);
      if (index >= 0) list.splice(index, 1);
      else {
        const entry = found.get(voice) || {name: voice};
        list.push({...descriptor(voice), style: (entry.info || '').slice(0, 120), ...guessVoice(`${entry.name} ${entry.info || ''}`)});
      }
      api.saveVoicePool(list);
      button.outerHTML = favoriteButton(voice);
      ctx.notify(index >= 0 ? '已取消收藏' : '已收藏');
    } else if (button.dataset.audition) {
      Promise.resolve(api.audition(descriptor(button.dataset.audition))).catch(error => ctx.notify(error.message, {error: true}));
    } else if (button.dataset.voice) {
      const voice = descriptor(button.dataset.voice);
      dialog.close();
      onSelect?.(voice);
    } else if (button.hasAttribute('data-more')) {
      button.disabled = true;
      load(true);
    } else if (button.dataset.action === 'search') {
      search = dialog.body.querySelector('.search').value.trim();
      load(false);
    }
  });
  paintModels();
  load(false);
  return dialog;
}
