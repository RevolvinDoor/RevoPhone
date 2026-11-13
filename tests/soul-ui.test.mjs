import test from 'node:test';
import assert from 'node:assert/strict';
import {soulPanel} from '../ui/soul.js';
import {freshState} from '../core/state.js';
import {newSoulSession, normalizeSoulCandidate, SOUL_PROFILE_FIELDS} from '../core/soul.js';

function fixture() {
  const settings = freshState(), handlers = new Map(), calls = [], dialogs = [], errors = [];
  let state = newSoulSession('story:a', settings.soul), opened;
  const person = normalizeSoulCandidate({id: 'one', name: '林', nickname: '"><script>alert(1)</script>', age: 25, gender: '女',
    intro: '<img src=x onerror=alert(1)>', interests: ['<script>'], signature: '夜班药剂师', region: '王都', occupation: '药剂师',
    appearance: '银发', bodyBuild: '高挑', outfit: '长裙', imageData: 'javascript:alert(1)', imageError: '需要补画'});
  state.candidates = [person]; state.batch = ['one'];
  const v = {root: {querySelectorAll: () => []}, draw(html) {this.html = html;}, on(type, selector, fn) {handlers.set(`${type}:${selector}`, fn);}};
  let panel;
  const api = {getState: () => settings, getSoul: () => structuredClone(state), soulBusy: () => false,
    async saveSoul(patch) {calls.push(['saveSoul', patch]); state = {...state, ...patch};},
    async soulDiscover(value) {calls.push(['discover', value]);},
    async soulAccept(id) {calls.push(['accept', id]); return {id: 'private:one'};},
    async soulPicture(id, options) {calls.push(['picture', id, options]); if (!options?.allowPaid) throw Object.assign(Error('需要确认费用'), {code: 'PAID'});},
    paidPrompt: () => ({title: '费用确认', text: '需要额度'}),
    listPhotos: async () => [],
    async saveSoulProfile(profile, options) {calls.push(['profile', structuredClone(profile), options]);},
    soulClearHistory: async () => calls.push(['clear']), legacySoulThreads: async () => []};
  const ctx = {api, win: {URL: {revokeObjectURL() {}}}, notify(text, options) {if (options?.error) errors.push(text);}, confirm: async () => true,
    dialog(title, html) {
      const fields = new Map([...Object.keys(SOUL_PROFILE_FIELDS), 'photoId'].map(k => [`[data-soul-field="${k}"]`, {value: state.profile[k]}]));
      fields.set('[data-soul-template]', {value: ''}); fields.set('[data-soul-template-name]', {value: '旅行者'});
      fields.set('[data-soul-default]', {checked: true});
      const listeners = {}, d = {title, html, fields, body: {querySelector: s => fields.get(s), addEventListener: (type, fn) => {listeners[type] = fn;}},
        close() {d.closed = true;}, listeners};
      dialogs.push(d); return d;
    }};
  panel = soulPanel(ctx, {v, frame: html => html, render: () => panel.render(), open: async id => {opened = id;}});
  const click = (action, extra = {}) => handlers.get('click:[data-soul]')({dataset: {soul: action, ...extra}});
  return {panel, v, calls, dialogs, errors, click, handlers, opened: () => opened};
}

test('发现页渲染公开资料并转义模型文字；按钮正确调用三人刷新、一人来信和私聊入口', async () => {
  const f = fixture(); await f.panel.render();
  assert.match(f.v.html, /刷新发现 · 3 人/); assert.match(f.v.html, /陌生人来信 · 1 人/);
  assert.ok(f.v.html.includes('&lt;script&gt;')); assert.ok(f.v.html.includes('&lt;img'));
  assert.doesNotMatch(f.v.html, /<script>|<img[^>]*onerror|src="javascript:/);
  f.handlers.get('input:#soul-query')({value: '爱旅行的药剂师'});
  await f.click('discover'); await f.click('incoming');
  assert.deepEqual(f.calls.filter(c => c[0] === 'discover'), [
    ['discover', {query: '爱旅行的药剂师', incoming: false}], ['discover', {query: '爱旅行的药剂师', incoming: true}]]);
  await f.handlers.get('change:[data-soul-nsfw]')({checked: true});
  assert.ok(f.calls.some(c => c[0] === 'saveSoul' && c[1].nsfw));
  assert.match(f.v.html, /NSFW · 成人写真/);
  assert.match(f.v.html, /创作者.*性感穿搭/);
  assert.match(f.v.html, /刷新.*生效/);
  assert.match(f.v.html, /已有.*保留/);
  await f.click('accept', {id: 'one'}); assert.equal(f.opened(), 'private:one');
  assert.deepEqual(f.errors, []); f.panel.dispose();
});

test('图片需要付费确认时由用户确认后再补画，忽略与清理记录保留独立操作', async () => {
  const f = fixture(); await f.panel.render();
  await f.click('picture', {id: 'one'});
  assert.deepEqual(f.calls.filter(c => c[0] === 'picture'), [['picture', 'one', undefined], ['picture', 'one', {allowPaid: true}]]);
  await f.click('ignore', {id: 'one'});
  assert.equal(f.calls.find(c => c[0] === 'saveSoul')[1].candidates[0].ignored, true);
  await f.click('clear'); assert.ok(f.calls.some(c => c[0] === 'clear'));
  assert.deepEqual(f.errors, []); f.panel.dispose();
});

test('公开主页可以只保存当前副本或另存默认模板，并携带原正文聊天标识', async () => {
  const f = fixture(); await f.click('profile'); const first = f.dialogs[0];
  assert.match(first.html, /保存本聊天/); assert.match(first.html, /另存模板/);
  first.fields.get('[data-soul-field="nickname"]').value = '匿名旅人';
  const save = async (dialog, mode) => {
    const button = {dataset: {soulProfileSave: mode}}, target = {closest: s => s === '[data-soul-profile-save]' ? button : null};
    await dialog.listeners.click({target});
  };
  await save(first, 'current');
  assert.equal(f.calls[0][1].nickname, '匿名旅人'); assert.deepEqual(f.calls[0][2], {expectedChatKey: 'story:a'});
  await f.click('profile'); await save(f.dialogs[1], 'template');
  assert.deepEqual(f.calls[1][2], {expectedChatKey: 'story:a', templateId: '', templateName: '旅行者', makeDefault: true});
  assert.deepEqual(f.errors, []); f.panel.dispose();
});
