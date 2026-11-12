import {createView, esc, heading} from './common.js';
import {effectiveEntityView} from '../core/xeno.js';
import {STATUS_FIELDS, STATUS_OUTFIT_FIELDS} from '../core/character-status.js';

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
    const row = field => {
      const locked = Boolean(entity.statusLocks?.[field]);
      const text = STATUS_OUTFIT_FIELDS.includes(field) ? entity.outfit[field] : view[field];
      const derived = !STATUS_OUTFIT_FIELDS.includes(field) && view[field] !== entity[field];
      return `<article class="status-field"><div class="status-field-head"><h3>${esc(STATUS_FIELDS[field])}</h3>
        <label class="status-lock"><input type="checkbox" data-lock="${field}" aria-label="锁定${esc(STATUS_FIELDS[field])}" ${locked ? 'checked' : ''}>锁定</label></div>
        <p>${esc(text || '未记录')}</p>${derived ? '<small>当前外观由穿戴或形态决定，修改来源请前往衣柜或异构终端。</small>' : ''}<button type="button" class="text-button" data-edit="${field}" ${locked || derived ? 'disabled' : ''}>${locked ? '解锁后可编辑' : derived ? '随当前形态更新' : '编辑记录'}</button></article>`;
    };
    v.draw(`${heading('角色状态', '', 'Character Status')}
      <label class="status-person">查看角色<select data-person aria-label="查看角色">${entities(xeno).map(person => `<option value="${esc(person.id)}" ${person.id === selected ? 'selected' : ''}>${esc(person.name || '主角')}${person.id === '__protagonist__' ? ' · 主角' : ''}</option>`).join('')}</select></label>
      <p class="status-note">${esc(entity.identity || '身份未记录')} · 锁定字段会约束正文，并阻止同步覆盖。模型仍可能出现不遵守约束的描写。</p>
      <div class="actions"><button type="button" class="secondary" data-action="sync" ${api.xenoBusy?.('sync') ? 'disabled' : ''}>${api.xenoBusy?.('sync') ? '同步中…' : '从剧情同步'}</button><button type="button" class="secondary" data-action="wardrobe">衣柜</button><button type="button" class="secondary" data-action="xeno">异构终端</button></div>
      <h2 class="group-title">当前外观</h2>${row('appearance')}${row('bodyBuild')}
      <h2 class="group-title">衣物穿戴</h2>${STATUS_OUTFIT_FIELDS.map(row).join('')}
      <details class="status-sources" data-group="status-sources-${esc(entity.id)}"><summary>来源与变化</summary>
        <dl>${[['原始身体', view.originalBody], ['当前身体', view.currentBody], ['身体来源', view.bodySource], ['头部来源', view.headSource], ['穿戴层次', view.layerText], ['变化原因', view.changeReason]].map(([label, text]) => `<dt>${esc(label)}</dt><dd>${esc(text || '未记录')}</dd>`).join('')}</dl>
        <p class="status-note">显示当前记录中的来源与变化原因，不是完整历史日志。</p></details>`);
  };
  v.on('change', '[data-person]', el => {selected = el.value; v.refresh();});
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
