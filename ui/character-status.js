import {createView, esc, heading, help} from './common.js';
import {icon} from './icons.js';
import {effectiveEntityView} from '../core/xeno.js';
import {STATUS_FIELDS, STATUS_OUTFIT_FIELDS, ORGAN_LIMIT} from '../core/character-status.js';

export function characterStatusApp(ctx) {
  const {api} = ctx, v = createView(ctx, 'character-status');
  let selected = '__protagonist__';
  const entities = xeno => [xeno.protagonist, ...xeno.targets];
  const current = xeno => entities(xeno).find(entity => entity.id === selected) || xeno.protagonist;
  const unsubscribe = api.subscribe(event => {
    if (event?.type === 'xeno' || event?.type === 'settings') v.refresh();
  });
  const dispose = v.dispose.bind(v);
  v.dispose = () => {unsubscribe?.(); dispose();};
  v.refresh = () => {
    const xeno = api.getState().xeno, entity = current(xeno), view = effectiveEntityView(xeno, entity);
    selected = entity.id;
    const organs = entity.organs || [];
    const lockCount = Object.keys(STATUS_FIELDS).filter(field => entity.statusLocks?.[field]).length + organs.filter(row => row.locked).length;
    const recordedCount = Object.keys(STATUS_FIELDS).filter(field => String(STATUS_OUTFIT_FIELDS.includes(field) ? entity.outfit[field] || '' : view[field] || '').trim()).length;
    const syncing = Boolean(api.xenoBusy?.('sync'));
    const fieldIcons = {appearance: 'person', bodyBuild: 'expand', outerwear: 'layers', underwear: 'layers', privacyCover: 'lock', accessories: 'wand'};
    const row = field => {
      const locked = Boolean(entity.statusLocks?.[field]);
      const text = STATUS_OUTFIT_FIELDS.includes(field) ? entity.outfit[field] : view[field];
      const derived = !STATUS_OUTFIT_FIELDS.includes(field) && view[field] !== entity[field];
      return `<article class="status-field${locked ? ' is-locked' : ''}${text ? '' : ' is-empty'}">
        <div class="status-field-head"><span class="status-field-symbol" aria-hidden="true">${icon(fieldIcons[field])}</span><h3>${esc(STATUS_FIELDS[field])}</h3>
          ${!locked && !derived ? `<button type="button" class="status-edit" data-edit="${field}" aria-label="编辑${esc(STATUS_FIELDS[field])}">${icon('edit')}<span>编辑</span></button>` : `<span class="status-state">${locked ? '已固定' : '随形态'}</span>`}</div>
        <p class="status-value">${esc(text || '尚未记录')}</p>
        <div class="status-field-footer"><span class="status-field-hint">${locked ? '解锁后可更改' : derived ? '由当前穿戴或形态决定' : '可随剧情更新'}</span>
        <label class="status-lock"><input type="checkbox" role="switch" data-lock="${field}" aria-label="锁定${esc(STATUS_FIELDS[field])}" ${locked ? 'checked' : ''}><span class="status-lock-track" aria-hidden="true"></span><span>${locked ? '已锁定' : '锁定'}</span></label></div></article>`;
    };
    v.draw(`${heading('角色状态', help('勾选锁定后，记录保持当前值，并向正文发送约束。先解锁再修改。模型仍可能出现不遵守约束的描写。由形态决定的外观，请到衣柜或异构终端修改来源。'), 'Character / Status')}
      <section class="status-profile" aria-label="人物概览"><div class="status-profile-top">
        <span class="status-monogram" aria-hidden="true">${esc(Array.from(entity.name || '角')[0])}</span>
        <div class="status-profile-copy"><span class="status-kicker">${entity.id === '__protagonist__' ? '主角档案' : '角色档案'}</span><h2>${esc(entity.name || '未命名主角')}</h2><p>${esc(entity.identity || '身份尚未记录')}</p></div></div>
        <div class="status-profile-meta"><span>${icon('file')}基础 ${recordedCount} / 6 项 · 器官 ${organs.length} 项</span><span>${icon('lock')}${lockCount ? `${lockCount} 项已锁定` : '暂无锁定'}</span></div>
        <label class="status-person"><span>切换角色</span><select data-person aria-label="查看角色">${entities(xeno).map(person => `<option value="${esc(person.id)}" ${person.id === selected ? 'selected' : ''}>${esc(person.name || '主角')}${person.id === '__protagonist__' ? ' · 主角' : ''}</option>`).join('')}</select></label>
      </section>
      <nav class="status-toolbar" aria-label="状态操作"><button type="button" class="status-sync" data-action="sync" aria-busy="${syncing}" ${syncing ? 'disabled' : ''}>${icon('refresh')}<span>${syncing ? '同步中…' : '从剧情同步'}</span></button><button type="button" data-action="wardrobe">${icon('layers')}<span>衣柜</span></button><button type="button" data-action="xeno">${icon('sliders')}<span>终端</span></button></nav>
      <section aria-label="当前外观"><div class="status-section-heading"><h2>当前外观</h2><span>APPEARANCE</span></div><div class="status-group">${row('appearance')}${row('bodyBuild')}</div></section>
      <section aria-label="器官记录"><div class="status-section-heading"><h2>器官记录 <small>${organs.length} / ${ORGAN_LIMIT}</small></h2><button type="button" class="status-organ-add" data-organ-edit="" ${organs.length >= ORGAN_LIMIT ? 'disabled' : ''}>＋ 新增器官</button></div>
        <div class="status-group">${organs.length ? organs.map(organ => `<article class="status-field${organ.locked ? ' is-locked' : ''}" data-flip="organ-${esc(organ.id)}">
          <div class="status-field-head"><span class="status-field-symbol" aria-hidden="true">${icon('person')}</span><h3>${esc(organ.name)}</h3>${organ.locked ? '<span class="status-state">已固定</span>' : `<button type="button" class="status-edit" data-organ-edit="${esc(organ.id)}" aria-label="编辑${esc(organ.name)}">${icon('edit')}<span>编辑</span></button>`}</div>
          <dl class="status-organ-values"><div><dt>外观</dt><dd>${esc(organ.appearance || '尚未记录')}</dd></div><div><dt>当前状态</dt><dd>${esc(organ.state || '尚未记录')}</dd></div></dl>
          <div class="status-field-footer"><span class="status-field-hint">${organ.locked ? '解锁后可编辑或删除' : '可随剧情更新'}</span><label class="status-lock"><input type="checkbox" role="switch" data-organ-lock="${esc(organ.id)}" aria-label="锁定${esc(organ.name)}" ${organ.locked ? 'checked' : ''}><span class="status-lock-track" aria-hidden="true"></span><span>${organ.locked ? '已锁定' : '锁定'}</span></label></div></article>`).join('') : '<p class="status-note status-organ-empty">尚未记录器官。可逐项新增，或从剧情同步；没有明确提及的内容保持空白。</p>'}</div>
        <details class="status-sources" data-group="organ-reference-${esc(entity.id)}"><summary><span><strong>生理与当前形态参考</strong><small>原有生理描述 · 下体外观与来源</small></span><span class="status-chevron" aria-hidden="true">${icon('down')}</span></summary><dl>${[['生理特征', view.physiology], ['当前下体外观', view.organAppearance], ['下体来源', view.organSource]].map(([label, text]) => `<div><dt>${esc(label)}</dt><dd>${esc(text || '未记录')}</dd></div>`).join('')}</dl><p class="status-note">器官档案是逐项记录；穿戴与形态的实际来源由衣柜和异构终端管理。</p></details>
      </section>
      <section aria-label="衣物穿戴"><div class="status-section-heading"><h2>衣物穿戴</h2><span>WARDROBE</span></div><div class="status-group">${STATUS_OUTFIT_FIELDS.map(row).join('')}</div></section>
      <details class="status-sources" data-group="status-sources-${esc(entity.id)}"><summary><span class="status-source-icon" aria-hidden="true">${icon('layers')}</span><span><strong>来源与变化</strong><small>身体来源 · 穿戴层次 · 变化原因</small></span><span class="status-chevron" aria-hidden="true">${icon('down')}</span></summary>
        <dl>${[['原始身体', view.originalBody], ['当前身体', view.currentBody], ['身体来源', view.bodySource], ['头部来源', view.headSource], ['穿戴层次', view.layerText], ['变化原因', view.changeReason]].map(([label, text]) => `<div><dt>${esc(label)}</dt><dd>${esc(text || '未记录')}</dd></div>`).join('')}</dl>
        <p class="status-note">这里保留当前来源与原因，不是历史日志。</p></details>`);
  };
  v.on('change', '[data-person]', el => {selected = el.value; v.refresh();});
  v.on('change', '[data-organ-lock]', el => {
    const entity = current(api.getState().xeno);
    api.xenoAct('editCharacterOrgan', {targetKey: entity.id, chatKey: api.statusChatKey(), organId: el.dataset.organLock, operation: 'lock', locked: el.checked});
  });
  v.on('click', '[data-organ-edit]', el => {
    const entity = current(api.getState().xeno), organId = el.dataset.organEdit;
    const organ = entity.organs.find(row => row.id === organId);
    if (organId && (!organ || organ.locked)) return;
    const chatKey = api.statusChatKey();
    const d = ctx.dialog(organ ? `编辑${organ.name}` : '新增器官', `<div class="status-organ-editor">
      <label class="status-editor">器官名称<input data-organ-name maxlength="80" value="${esc(organ?.name || '')}" placeholder="填写器官或部位名称"></label>
      <label class="status-editor">外观<textarea data-organ-appearance rows="3" maxlength="1000" placeholder="形态、颜色、大小等已知特征">${esc(organ?.appearance || '')}</textarea></label>
      <label class="status-editor">当前状态<textarea data-organ-state rows="3" maxlength="1000" placeholder="当前状态；未知时可留空">${esc(organ?.state || '')}</textarea></label>
      <p class="status-note">只记录已知事实。名称用于区分记录，同类器官可注明左右或位置。</p>
      <div class="actions">${organ ? '<button type="button" class="danger" data-organ-remove>删除本条</button>' : ''}<button type="button" class="secondary" data-cancel>取消</button><button type="button" class="primary" data-organ-save>保存</button></div></div>`);
    d.body.addEventListener('click', event => {
      if (event.target.closest('[data-cancel]')) d.close();
      const removing = Boolean(event.target.closest('[data-organ-remove]'));
      if (!removing && !event.target.closest('[data-organ-save]')) return;
      try {
        const target = entities(api.getState().xeno).find(person => person.id === entity.id);
        if (api.statusChatKey() !== chatKey || !target) throw Error('角色或聊天已切换，请重新打开编辑');
        api.xenoAct('editCharacterOrgan', {targetKey: target.id, chatKey, organId: organId || undefined,
          operation: removing ? 'remove' : 'save', name: d.body.querySelector('[data-organ-name]').value,
          appearance: d.body.querySelector('[data-organ-appearance]').value, state: d.body.querySelector('[data-organ-state]').value});
        d.close(); ctx.notify(removing ? '器官记录已删除' : '器官记录已保存');
      } catch (error) {ctx.notify(error.message, {error: true});}
    });
  });
  v.on('change', '[data-lock]', el => {
    const entity = current(api.getState().xeno);
    api.xenoAct('editCharacterStatus', {targetKey: entity.id === '__protagonist__' ? entity.id : entity.name, field: el.dataset.lock, locked: el.checked});
  });
  v.on('click', '[data-edit]', el => {
    const xeno = api.getState().xeno, entity = current(xeno), field = el.dataset.edit;
    if (entity.statusLocks?.[field]) return;
    const view = effectiveEntityView(xeno, entity);
    const value = STATUS_OUTFIT_FIELDS.includes(field) ? entity.outfit[field] : view[field];
    const chatKey = api.statusChatKey();
    const d = ctx.dialog(`编辑${STATUS_FIELDS[field]}`, `<label class="status-editor">${esc(STATUS_FIELDS[field])}<textarea data-status-value rows="5" maxlength="${STATUS_OUTFIT_FIELDS.includes(field) ? 500 : 1000}">${esc(value || '')}</textarea></label>
      ${STATUS_OUTFIT_FIELDS.includes(field) ? '<p class="status-note">编辑为文字记录会解除该栏的衣柜商品绑定；实际更换装备请到衣柜操作。</p>' : ''}
      <div class="actions"><button type="button" class="secondary" data-cancel>取消</button><button type="button" class="primary" data-save>保存</button></div>`);
    d.body.addEventListener('click', event => {
      if (event.target.closest('[data-cancel]')) d.close();
      if (!event.target.closest('[data-save]')) return;
      try {
        const fresh = api.getState().xeno;
        const target = entities(fresh).find(person => person.id === entity.id);
        if (api.statusChatKey() !== chatKey || !target) throw Error('角色或聊天已切换，请重新打开编辑');
        api.xenoAct('editCharacterStatus', {targetKey: target.id === '__protagonist__' ? target.id : target.name, chatKey, field, value: d.body.querySelector('[data-status-value]').value});
        d.close(); ctx.notify('状态记录已保存');
      } catch (error) {ctx.notify(error.message, {error: true});}
    });
  });
  v.on('click', '[data-action]', async el => {
    if (el.dataset.action === 'sync') await v.busy(el, () => api.xenoSyncStory());
    else ctx.open(el.dataset.action);
  });
  v.refresh();
  return v;
}
