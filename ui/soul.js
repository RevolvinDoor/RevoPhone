import {esc} from './common.js';
import {icon} from './icons.js';
import {SOUL_PROFILE_FIELDS, soulIdentity} from '../core/soul.js';

// A panel inside the existing chat view. The chat store and conversation UI remain shared.
export function soulPanel(ctx, {v, frame, render, open}) {
  const {api} = ctx, urls = new Map();
  let section = 'batch', query = null, disposed = false, ticket = 0;
  const state = () => api.getSoul();
  const busy = () => !!api.soulBusy?.();
  const photoUrl = async id => {
    if (!id) return '';
    if (!urls.has(id)) {
      const photo = await api.getPhoto(id).catch(() => null);
      if (disposed) return '';
      urls.set(id, photo ? ctx.win.URL.createObjectURL(photo.blob) : '');
    }
    return urls.get(id);
  };
  async function paintPhotos(current) {
    for (const img of v.root.querySelectorAll('img[data-soul-photo]')) {
      const url = await photoUrl(img.dataset.soulPhoto);
      if (disposed || current !== ticket) return;
      if (url && img.isConnected) { img.src = url; img.hidden = false; }
    }
  }
  function card(person) {
    const available = !!(person.imageData || person.photoId), working = busy();
    const photo = person.nsfw ? '写真' : '生活照';
    const label = person.accepted ? '继续聊天' : person.incoming ? '认识 TA' : '喜欢，打个招呼';
    return `<article class="soul-card" data-soul-person="${esc(person.id)}">
      <div class="soul-photo">
        ${person.imageData ? `<img src="${esc(person.imageData)}" alt="${esc(person.nickname || person.name)}的全身${photo}">`
          : person.photoId ? `<img data-soul-photo="${esc(person.photoId)}" alt="${esc(person.nickname || person.name)}的${photo}" hidden>`
          : `<div class="soul-photo-empty">${icon('person')}<span>${working ? `正在准备${photo}…` : `${photo}尚未完成`}</span></div>`}
        <div class="soul-photo-label"><span>${esc(person.region || '同一片世界')}</span><span>${person.incoming ? '陌生人来信' : person.accepted ? '已经认识' : '初次遇见'}</span></div>
      </div>
      <div class="soul-card-body">
        <h2>${esc(person.nickname || person.name)} <small>${person.age} 岁 · ${esc(person.gender)}</small></h2>
        <p class="soul-occupation">${esc([person.species, person.occupation].filter(Boolean).join(' · '))}</p>
        <p class="soul-signature">${esc(person.signature || person.intro)}</p>
        <div class="soul-tags">${person.interests.map(tag => `<span>${esc(tag)}</span>`).join('')}</div>
        <details><summary>查看公开资料</summary><dl>
          ${[['自我介绍', person.intro], ['交友目的', person.purpose], ['择友偏好', person.preferences],
            ['公开身份', soulIdentity(person)]].filter(([, value]) => value).map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}
        </dl></details>
        ${person.incoming && person.greeting ? `<blockquote><span>TA 发来招呼</span>${esc(person.greeting)}</blockquote>` : ''}
        ${person.imageError ? `<p class="soul-error" role="status">${esc(person.imageError)}</p>` : ''}
        <div class="soul-card-actions">
          ${!person.accepted ? `<button type="button" class="secondary" data-soul="ignore" data-id="${esc(person.id)}" ${working ? 'disabled' : ''}>略过</button>` : ''}
          <button type="button" class="primary" data-soul="accept" data-id="${esc(person.id)}" ${working ? 'disabled' : ''}>${working ? '正在处理…' : label}</button>
          ${!available ? `<button type="button" class="secondary" data-soul="picture" data-id="${esc(person.id)}" ${working ? 'disabled' : ''}>补画照片</button>` : ''}
        </div>
      </div>
    </article>`;
  }
  function draw() {
    const soul = state(), working = busy(), current = ++ticket;
    if (query === null) query = soul.query;
    const incoming = soul.candidates.filter(c => c.incoming && !c.accepted && !c.ignored);
    const rows = section === 'incoming' ? incoming : section === 'history' ? soul.candidates
      : soul.batch.map(id => soul.candidates.find(c => c.id === id)).filter(c => c && !c.ignored);
    v.draw(frame(`<header class="soul-heading"><div><p>MEET SOMEONE NEW</p><h1>Soul · 发现</h1></div>
      <button type="button" class="round-button" data-soul="profile" aria-label="编辑我的公开主页">${icon('person')}</button></header>
      <section class="soul-discover-controls">
        <label class="soul-query"><span>这次想认识什么样的人？</span><textarea id="soul-query" rows="2" maxlength="1000" placeholder="例如：同城、爱旅行、开朗的药剂师；留空随机发现" ${working ? 'disabled' : ''}>${esc(query)}</textarea></label>
        <div class="soul-control-row"><label class="soul-nsfw"><input type="checkbox" data-soul-nsfw ${soul.nsfw ? 'checked' : ''} ${working ? 'disabled' : ''}> NSFW · 成人写真</label>
          <button type="button" class="text-button" data-soul="profile">${esc(soul.profile.nickname || '填写一次公开主页')}</button></div>
        <div class="soul-main-actions"><button type="button" class="primary" data-soul="discover" ${working ? 'disabled' : ''}>${working ? '正在寻找新朋友…' : '刷新发现 · 3 人'}</button>
          <button type="button" class="secondary" data-soul="incoming" ${working ? 'disabled' : ''}>陌生人来信 · 1 人</button></div>
        <p class="hint">上方要求应用于每一位新人物，留空随机。${soul.nsfw ? '当前为成年写真创作者风格：性感穿搭、暧昧签名与粉丝互动。' : '当前为日常交友与生活照。'}刷新后生效，已有资料和照片保留。来信按钮一次带来一位热情的新朋友。</p>
      </section>
      <nav class="soul-sections" aria-label="发现记录">${[['batch', '本次发现'], ['incoming', `新的朋友${incoming.length ? ` · ${incoming.length}` : ''}`], ['history', '浏览记录']].map(([key, label]) => `<button type="button" data-soul="section" data-section="${key}" aria-pressed="${section === key}">${label}</button>`).join('')}</nav>
      ${rows.length ? `<div class="soul-cards">${rows.map(card).join('')}</div>` : `<div class="soul-empty">${icon('person')}<h2>${section === 'incoming' ? '还没有陌生人来信' : '下一位朋友，会是谁？'}</h2><p>可以写下要求，也可以留空，遇见这个世界里的新面孔。</p></div>`}
      ${section === 'history' && rows.some(c => !c.accepted) ? '<button type="button" class="text-button soul-clear" data-soul="clear">清理未认识的浏览记录</button>' : ''}`));
    return paintPhotos(current);
  }
  async function profileDialog() {
    const soul = state(), config = api.getState().soul, photos = await api.listPhotos().catch(() => []);
    if (disposed) return;
    const d = ctx.dialog('Soul · 我的公开主页', `<div class="soul-profile-form">
      <p class="hint">这里是新朋友能看到的资料。首次保存会自动记住为默认主页；以后修改当前副本，新聊天继续带入默认模板。</p>
      <label>选用已保存的主页<select data-soul-template><option value="">当前聊天的主页</option>${config.templates.map(t => `<option value="${esc(t.id)}">${esc(t.name)}${t.id === config.defaultTemplate ? ' · 默认' : ''}</option>`).join('')}</select></label>
      ${Object.entries(SOUL_PROFILE_FIELDS).map(([key, label]) => `<label>${label}${key === 'intro'
        ? `<textarea data-soul-field="${key}" rows="3" maxlength="800">${esc(soul.profile[key])}</textarea>`
        : `<input data-soul-field="${key}" maxlength="160" value="${esc(soul.profile[key])}" placeholder="可留空">`}</label>`).join('')}
      <label>公开头像<select data-soul-field="photoId"><option value="">使用当前头像</option>${soul.profile.photoId && !photos.slice(0, 80).some(p => p.id === soul.profile.photoId) ? `<option value="${esc(soul.profile.photoId)}" selected>已保存的头像</option>` : ''}${photos.slice(0, 80).map(photo => `<option value="${esc(photo.id)}" ${photo.id === soul.profile.photoId ? 'selected' : ''}>${esc(photo.name || '相册图片')}</option>`).join('')}</select></label>
      <label>模板名称<input data-soul-template-name maxlength="40" placeholder="例如：旅行者、日常身份"></label>
      <label class="soul-check"><input type="checkbox" data-soul-default> 用作以后新聊天的默认主页</label>
      <div class="actions"><button type="button" class="primary" data-soul-profile-save="current">保存本聊天</button><button type="button" class="secondary" data-soul-profile-save="template">另存模板</button><button type="button" class="secondary" data-soul-profile-save="update" disabled>更新所选模板</button></div>
      <button type="button" class="text-button" data-soul-legacy>导入旧版聊天记录</button>
    </div>`);
    d.body.addEventListener('change', event => {
      if (!event.target.matches('[data-soul-template]')) return;
      const template = config.templates.find(t => t.id === event.target.value);
      d.body.querySelector('[data-soul-profile-save="update"]').disabled = !template;
      if (!template) return;
      for (const [key, value] of Object.entries(template.profile)) {
        const input = d.body.querySelector(`[data-soul-field="${key}"]`);
        if (input) {
          if (key === 'photoId' && value && ![...input.options].some(option => option.value === value)) {
            const option = ctx.doc.createElement('option'); option.value = value; option.textContent = '模板保存的头像'; input.append(option);
          }
          input.value = value;
        }
      }
      d.body.querySelector('[data-soul-template-name]').value = template.name;
      d.body.querySelector('[data-soul-default]').checked = config.defaultTemplate === template.id;
    });
    d.body.addEventListener('click', async event => {
      const button = event.target.closest('[data-soul-profile-save]');
      if (button) {
        button.disabled = true;
        try {
          const profile = Object.fromEntries([...Object.keys(SOUL_PROFILE_FIELDS), 'photoId'].map(key => [key,
            d.body.querySelector(`[data-soul-field="${key}"]`).value.trim()]));
          const template = button.dataset.soulProfileSave !== 'current', updating = button.dataset.soulProfileSave === 'update';
          const name = d.body.querySelector('[data-soul-template-name]').value.trim();
          if (template && !name) throw Error('请为要保存的模板填一个名称');
          if (updating && !d.body.querySelector('[data-soul-template]').value) throw Error('请先选择要更新的模板');
          await api.saveSoulProfile(profile, {expectedChatKey: soul.chatKey, ...(template ? {templateId: updating ? d.body.querySelector('[data-soul-template]').value : '',
            templateName: name, makeDefault: d.body.querySelector('[data-soul-default]').checked} : {})});
          d.close(true); ctx.notify(template ? '公开主页和模板已保存' : '当前聊天的公开主页已保存'); render();
        } catch (error) { ctx.notify(error.message, {error: true}); button.disabled = false; }
      }
      if (event.target.closest('[data-soul-legacy]')) {
        try {
          const threads = await api.legacySoulThreads();
          const legacy = ctx.dialog('旧版对话', `<p class="hint">将所选对话复制到当前正文聊天，原记录保留。</p>${threads.length
            ? threads.map(t => `<button type="button" class="list-row" data-soul-import="${esc(t.id)}"><span>${esc(t.name)}</span></button>`).join('')
            : '<p class="hint">没有待导入的旧版对话。</p>'}`);
          legacy.body.addEventListener('click', async e => {
            const selected = e.target.closest('[data-soul-import]'); if (!selected) return;
            try { const thread = await api.importLegacySoulThread(selected.dataset.soulImport, {expectedChatKey: soul.chatKey}); legacy.close(); d.close(); await open(thread.id); }
            catch (error) { ctx.notify(error.message, {error: true}); }
          });
        } catch (error) { ctx.notify(error.message, {error: true}); }
      }
    });
  }
  v.on('input', '#soul-query', el => {query = el.value;});
  v.on('change', '[data-soul-nsfw]', async el => {
    try { await api.saveSoul({nsfw: el.checked}); render(); } catch (error) {ctx.notify(error.message, {error: true}); render();}
  });
  v.on('click', '[data-soul]', async el => {
    const action = el.dataset.soul;
    try {
      if (action === 'section') {section = el.dataset.section; return render();}
      if (action === 'profile') return await profileDialog();
      if (busy()) return;
      if (action === 'discover' || action === 'incoming') {
        section = action === 'incoming' ? 'incoming' : 'batch';
        await api.soulDiscover({query: query ?? state().query, incoming: action === 'incoming'});
      } else if (action === 'accept') {
        const thread = await api.soulAccept(el.dataset.id); return await open(thread.id);
      } else if (action === 'picture') {
        try {await api.soulPicture(el.dataset.id);}
        catch (error) {
          if (error.code !== 'PAID') throw error;
          const ask = api.paidPrompt?.() || {title: '确认生成生活照', text: error.message};
          if (await ctx.confirm(ask.title, ask.text)) await api.soulPicture(el.dataset.id, {allowPaid: true});
        }
      } else if (action === 'ignore') {
        const soul = state(); await api.saveSoul({candidates: soul.candidates.map(c => c.id === el.dataset.id ? {...c, ignored: true} : c)});
      } else if (action === 'clear' && await ctx.confirm('清理未认识的发现记录？', '已经认识的人及聊天记录保留。')) await api.soulClearHistory();
      render();
    } catch (error) {ctx.notify(error.message, {error: true}); render();}
  });
  return {render: draw, profile: profileDialog, reset() {query = null; section = 'batch';}, dispose() {
    disposed = true; ++ticket;
    for (const url of urls.values()) if (url) ctx.win.URL.revokeObjectURL(url);
    urls.clear();
  }};
}
