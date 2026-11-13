import test from 'node:test';
import assert from 'node:assert/strict';
import {TTSBackend} from '../core/backend.js';
import {freshState, normalizeSettings, validateSettings} from '../core/state.js';
import {ChatStore} from '../core/chats.js';
import {createSoulHost} from '../host-soul.js';
import {createChatHost} from '../host-chat.js';
import {normalizeSoulSession, defaultSoulSettings, soulDiscoveryRequest, newSoulSession} from '../core/soul.js';
import {MemoryStore} from './helpers.mjs';

// A small asynchronous IndexedDB surface: exercise the real ChatStore serializer and transactions.
function memoryIDB() {
  const rows = new Map();
  const db = {close() {}, createObjectStore: () => ({createIndex() {}}), transaction() {
    let pending = 0, ended = false;
    const tx = {abort() {ended = true; queueMicrotask(() => tx.onabort?.());}};
    const complete = () => {if (!pending && !ended) {ended = true; tx.oncomplete?.();}};
    const request = action => {
      const req = {}; pending++;
      queueMicrotask(() => {
        try {req.result = structuredClone(action()); req.onsuccess?.();}
        catch (error) {tx.error = error; tx.abort();}
        pending--; queueMicrotask(complete);
      });
      return req;
    };
    const store = {
      get: key => request(() => rows.get(JSON.stringify(key))),
      put: row => request(() => {rows.set(JSON.stringify([row.scope, row.id]), structuredClone(row)); return row.id;}),
      delete: key => request(() => rows.delete(JSON.stringify(key))),
      clear: () => request(() => rows.clear()),
      index: () => ({getAll: scope => request(() => [...rows.values()].filter(r => r.scope === scope))})
    };
    tx.objectStore = () => store; queueMicrotask(complete); return tx;
  }};
  return {open() {const req = {}; queueMicrotask(() => {req.result = db; req.onupgradeneeded?.(); req.onsuccess?.();}); return req;}};
}
function storage(name) {
  let saved;
  return {ref: {kind: 'character', fileName: name}, read: async () => structuredClone(saved || null), readLegacy: async () => null,
    async write(value) {saved = structuredClone(value); return true;}, saved: () => structuredClone(saved)};
}
function fixture() {
  const b = Object.create(TTSBackend.prototype), photos = new Map(), requests = [], images = [];
  Object.assign(b, {settings: freshState(), apps: new MemoryStore(), chats: new ChatStore('test', {indexedDB: memoryIDB()}),
    space: {key: 'card:a', name: '世界', members: []}, closed: false, activeChatKey: '',
    xenoFloors: new Map(), xenoSessions: new Map(), xenoChatRecords: new Map(), xenoChatStores: new Map(),
    xenoChatWrites: new Map(), deletedXenoChats: new Set(), xenoImages: new Map(),
    getState() {return structuredClone(this.settings);},
    save(value) {this.settings = validateSettings(normalizeSettings(value)); return this.getState();},
    emit() {}, notify() {}, subscribe: () => () => {}, initializeCardRoles() {}, persistXenoImage: async () => {},
    library: {getPhoto: async id => photos.get(id) || null, async addPhoto(value) {
      const row = {...value, id: crypto.randomUUID()}; photos.set(row.id, row); return row;
    }},
    drawReady: () => true,
    async generateImage(input) {images.push(input); const photoId = `photo:${images.length}`; photos.set(photoId, {id: photoId, blob: new Blob(['x'])}); return {photoId, blob: new Blob(['x'])};}
  });
  const ctx = {characterId: 0, characters: [{name: '世界', description: 'PUBLIC_WORLD：王都与冒险者工会', scenario: 'PUBLIC_SCENARIO'}],
    name1: 'PRIVATE_REAL_NAME', powerUserSettings: {persona_description: 'PRIVATE_PERSONA'},
    chat: [{mes: 'PRIVATE_STORY_SECRET', is_user: false}],
    getWorldInfoPrompt: async () => ({worldInfoBefore: 'PUBLIC_WORLD_LORE'})};
  let serial = 0;
  b.generateText = async (_, request) => {
    requests.push(request);
    if (request.prompt[0].content.includes('扩写一位')) return JSON.stringify({background: '在王都学习药剂', personality: '开朗细心', speech: '轻快短句', goals: '开一家小店', greeting: '你好，看到你也喜欢旅行，最近去了哪里？'});
    const count = request.prompt[0].content.includes('恰好 1 人') ? 1 : 3;
    return JSON.stringify({people: Array.from({length: count}, () => ({name: `新朋友${++serial}`, nickname: `夜归人${serial}`, age: 26,
      gender: '女', species: '人类', region: '王都', occupation: '药剂师', interests: ['旅行'], signature: '收工后一起喝茶', intro: '在工会附近工作',
      purpose: '认识新朋友', preferences: '爱聊天的人', appearance: '银发绿瞳', bodyBuild: '高挑', outfit: '蓝色长裙与旅行外套',
      drawPrompt: 'masterpiece, silver hair, green eyes, blue dress', greeting: '你好，你的旅行介绍很有趣。'}))});
  };
  const host = createSoulHost({context: () => ctx, backend: b, thumbnail: async () => 'data:image/jpeg;base64,QQ=='});
  return {b, ctx, requests, images, host};
}
const open = (b, name, file, hasHistory = false) => b.switchChatXeno(`card:a|${name}`, {space: {key: 'card:a', name: '世界', members: []}, storage: file,
  userName: '玩家', narratorName: '世界', hasHistory});

test('刷新严格三人三图，只有喜欢后才扩写、入角色与状态；重复点击不重复生成和登记', async () => {
  const {b, host, requests, images} = fixture(), file = storage('a'); await open(b, 'a', file);
  await b.saveSoulProfile({nickname: '公开网名', intro: '喜欢旅行'});
  const [first, same] = await Promise.all([host.discover(), host.discover()]);
  assert.deepEqual(first.batch, same.batch); assert.equal(first.candidates.length, 3);
  assert.equal(requests.length, 1); assert.equal(images.length, 3);
  assert.equal(b.settings.routes.length, 0); assert.equal(b.settings.xeno.targets.length, 0);
  assert.ok(first.candidates.every(c => !c.persona && !c.accepted));
  assert.ok(images.every(i => /full body/.test(i.prompt) && !/masterpiece/.test(i.prompt)));
  assert.ok(images.every(i => i.params.width < i.params.height));
  const id = first.batch[0];
  const [thread, again] = await Promise.all([host.accept(id), host.accept(id)]);
  assert.equal(thread.id, again.id); assert.equal(requests.length, 2); assert.equal(images.length, 3);
  assert.equal(thread.storyChatKey, 'card:a|a'); assert.equal(thread.messages.length, 1);
  const person = b.getSoul().candidates.find(c => c.id === id);
  assert.ok(person.accepted); assert.ok(person.persona.includes('开朗细心'));
  assert.ok(b.settings.routes.some(r => r.name === person.name));
  const status = b.settings.xeno.targets.find(t => t.name === person.name);
  assert.equal(status.appearance, '银发绿瞳'); assert.equal(status.outfit.outerwear, '蓝色长裙与旅行外套');
  await host.accept(id); assert.equal(requests.length, 2); assert.equal((await b.chats.get(thread.id)).messages.length, 1);
  assert.equal(file.saved().soul.candidates.find(c => c.id === id).accepted, true);
});

test('一次主动来信产生一位全新陌生人；接受前无完整档案，接受后沿用原招呼和照片', async () => {
  const {b, host, images, requests} = fixture(); await open(b, 'a', storage('a'));
  await b.saveSoul({nsfw: true});
  await host.discover({incoming: true});
  const candidate = b.getSoul().candidates[0];
  assert.equal(images.length, 1); assert.equal(candidate.incoming, true); assert.equal(candidate.accepted, false);
  assert.equal(candidate.persona, ''); assert.equal((await b.threads()).length, 0);
  assert.match(requests[0].prompt[0].content, /配合意愿高/);
  assert.match(requests[0].prompt[0].content, /成年人交友/);
  const thread = await host.accept(candidate.id);
  assert.equal(thread.messages[0].text, candidate.greeting); assert.equal(images.length, 1);
});

test('公开主页模板自动复用、当前副本独立；发现、角色与私聊按正文聊天保存并可跨本机数据库恢复', async () => {
  const {b, host} = fixture(), a = storage('a'), n = storage('new'); await open(b, 'a', a);
  await b.saveSoulProfile({nickname: '模板昵称', identity: '旅行者'}, {templateName: '旅行账号', makeDefault: true});
  await b.saveSoulProfile({nickname: '当前聊天昵称'});
  await host.discover(); const person = b.getSoul().candidates[0]; const thread = await host.accept(person.id);
  await open(b, 'new', n);
  assert.equal(b.getSoul().profile.nickname, '模板昵称'); assert.deepEqual(b.getSoul().candidates, []);
  assert.deepEqual(await b.threads(), []); assert.equal(b.contacts().some(c => c.name === person.name), false);
  await assert.rejects(b.soulThread(thread.id), /另一段正文聊天/);
  await open(b, 'a', a);
  assert.equal(b.getSoul().profile.nickname, '当前聊天昵称'); assert.equal((await b.threads())[0].id, thread.id);
  const {b: fresh} = fixture(); await open(fresh, 'a', a);
  assert.equal(fresh.getSoul().profile.nickname, '当前聊天昵称');
  assert.equal((await fresh.soulThread(thread.id)).messages[0].text, thread.messages[0].text);
  assert.equal(fresh.settings.xeno.targets.some(t => t.name === person.name), true);
  await fresh.deleteChatXenoFile('a.jsonl', {cardKey: 'card:a'});
  assert.deepEqual(await fresh.chats.list(), []); assert.equal(await fresh.apps.get('xeno-chat:card:a|a'), null);
});

test('发现/扩写只包含公开玩家资料；既有联系人和角色卡被排除，不接收正文与真实人设', async () => {
  const {b, host, requests} = fixture(); await open(b, 'a', storage('a'));
  await b.saveSoulProfile({nickname: 'PUBLIC_NICK', intro: 'PUBLIC_INTRO'});
  await host.discover(); await host.accept(b.getSoul().batch[0]);
  const text = JSON.stringify(requests.map(r => r.prompt));
  assert.match(text, /PUBLIC_WORLD/); assert.match(text, /PUBLIC_NICK/);
  assert.doesNotMatch(text, /PRIVATE_REAL_NAME|PRIVATE_PERSONA|PRIVATE_STORY_SECRET/);
  const request = soulDiscoveryRequest({world: 'world', profile: {nickname: 'public', photoId: 'private-file-id'}, excluded: ['旧友']});
  assert.doesNotMatch(JSON.stringify(request), /private-file-id/); assert.match(JSON.stringify(request), /旧友/);
});

test('私聊继续隔离正文、其他联系人的记忆与世界书；对方通过本会话认识玩家', async () => {
  const {b, host, ctx} = fixture(); await open(b, 'a', storage('a')); await b.saveSoulProfile({nickname: 'PUBLIC_NICK'});
  await host.discover(); const person = b.getSoul().candidates[0], thread = await host.accept(person.id);
  b.settings.routes.find(r => r.name === person.name).persona = 'CUSTOM_PERSONA：现在说话更直接';
  b.settings.xeno.targets.find(t => t.name === person.name).outfit.outerwear = 'CURRENT_OUTFIT：旅行雨衣';
  let captured;
  b.voiceFormat = () => b.settings.presets[0].format;
  b.generateText = async (_, request) => {captured = request.prompt; return `${person.name}：初次认识，很高兴与你聊天。`;};
  const chat = createChatHost({context: () => ctx, settings: () => b.cardState(), backend: b,
    memory: {contextFor: async () => ({text: 'OWN_PRIVATE_CHAT_MEMORY'}), recallStory: async () => 'OTHER_CONTACT_SECRET',
      after() {}, storyMemory: () => 'PRIVATE_STORY_MEMORY'}, storage: {getItem: () => null, setItem() {}}});
  await chat.reply(thread.id);
  const text = JSON.stringify(captured);
  assert.match(text, /PUBLIC_NICK/); assert.match(text, /OWN_PRIVATE_CHAT_MEMORY/);
  assert.match(text, /陌生人/);
  assert.match(text, /CUSTOM_PERSONA/); assert.match(text, /CURRENT_OUTFIT/);
  assert.doesNotMatch(text, /PRIVATE_REAL_NAME|PRIVATE_PERSONA|PRIVATE_STORY_SECRET|OTHER_CONTACT_SECRET|PRIVATE_STORY_MEMORY|PUBLIC_WORLD_LORE/);
});

test('图片失败保留三份资料且可单独重试；缺失年龄、格式错误或同名人物不悄悄写入', async () => {
  const {b, host, images} = fixture(); await open(b, 'a', storage('a'));
  b.generateImage = async input => {images.push(input); throw Error('图片暂不可用');};
  await host.discover();
  assert.equal(b.getSoul().candidates.length, 3); assert.equal(images.length, 3);
  const person = b.getSoul().candidates[0]; assert.match(person.imageError, /图片暂不可用/);
  b.generateImage = async () => ({photoId: 'retry-photo'});
  await host.picture(person.id); assert.equal(b.getSoul().candidates[0].photoId, 'retry-photo');
  const count = b.getSoul().candidates.length;
  b.generateText = async () => 'invalid JSON'; await assert.rejects(host.discover(), /格式不完整/);
  assert.equal(b.getSoul().candidates.length, count);
  b.generateText = async () => JSON.stringify({people: [{...person, age: 17}, person, person]});
  await assert.rejects(host.discover(), /成年身份/); assert.equal(b.getSoul().candidates.length, count);
});

test('生成中切换正文聊天不串写；旧主页弹窗也不能写进新聊天', async () => {
  const {b, host} = fixture(), a = storage('a'); await open(b, 'a', a);
  let finish; b.generateText = async () => new Promise(resolve => {finish = resolve;});
  const work = host.discover(); while (!finish) await new Promise(resolve => setImmediate(resolve));
  await open(b, 'new', storage('new'));
  finish(JSON.stringify({people: []})); await assert.rejects(work, /切换或删除/);
  assert.deepEqual(b.getSoul().candidates, []); assert.deepEqual(await b.threads(), []);
  await assert.rejects(b.saveSoulProfile({nickname: '旧弹窗'}, {expectedChatKey: 'card:a|a'}), /已切换/);
});

test('真实ChatStore的会话标识经更新/导入导出保留，旧版对话可复制导入且原记录不丢', async () => {
  const {b} = fixture();
  const legacy = await b.chats.create({members: ['旧朋友'], space: 'card:a'});
  await b.chats.append(legacy.id, [{from: '旧朋友', kind: 'text', text: '旧记录'}]);
  await open(b, 'new', storage('new'));
  assert.equal((await b.threads()).length, 0); assert.equal((await b.legacySoulThreads()).length, 1);
  const imported = await b.importLegacySoulThread(legacy.id);
  assert.equal(imported.storyChatKey, 'card:a|new'); assert.equal(imported.messages[0].text, '旧记录');
  assert.equal((await b.chats.get(legacy.id)).storyChatKey, undefined);
  assert.equal((await b.importLegacySoulThread(legacy.id)).id, imported.id);
  const normal = normalizeSoulSession({chatKey: 'wrong', candidates: [{age: 17}]}, 'new', defaultSoulSettings());
  assert.deepEqual(normal, newSoulSession('new', defaultSoulSettings()));
});

test('第一次直接保存主页会自动记住；之后当前修改与新聊天默认模板分离', async () => {
  const {b} = fixture(), a = storage('a'); await open(b, 'a', a);
  await b.saveSoulProfile({nickname: '默认网名', signature: '喜欢旅行'});
  assert.equal(b.settings.soul.templates[0].profile.nickname, '默认网名');
  await b.saveSoulProfile({nickname: '本次化名'});
  await open(b, 'next', storage('next'));
  assert.equal(b.getSoul().profile.nickname, '默认网名');
  assert.equal(b.getSoul().profile.signature, '喜欢旅行');
  b.saveChatOptions({profile: {name: '当前新化名', signature: '新的签名'}});
  assert.equal(b.getSoul().profile.nickname, '当前新化名');
  assert.equal(b.settings.soul.templates[0].profile.nickname, '默认网名');
});

test('私聊删除后可以继续认识同一人，不重新扩写；跨聊天媒体维护写回原会话快照', async () => {
  const {b, host, requests} = fixture(), a = storage('a'); await open(b, 'a', a);
  await host.discover(); const id = b.getSoul().batch[0], first = await host.accept(id), calls = requests.length;
  await b.chatMutate(first.id, () => b.chats.remove(first.id));
  const replacement = await host.accept(id);
  assert.notEqual(replacement.id, first.id); assert.equal(requests.length, calls);
  await open(b, 'next', storage('next'));
  await assert.rejects(b.chatMutate(replacement.id, () => b.chats.append(replacement.id, [])), /另一段正文聊天/);
  await b.chatMutate(replacement.id, () => b.chats.append(replacement.id, [{kind: 'text', from: 'me', text: '原会话维护记录'}]), {allowOtherChat: true});
  assert.deepEqual(await b.threads(), []);
  assert.equal(a.saved().soulThreads[0].messages.at(-1).text, '原会话维护记录');
});

test('生图期间切换聊天会保留原简单档案，不把迟到照片或人物写进新聊天', async () => {
  const {b, host} = fixture(), a = storage('a'); await open(b, 'a', a);
  let finish; b.generateImage = async () => new Promise(resolve => {finish = resolve;});
  const work = host.discover(); while (!finish) await new Promise(resolve => setImmediate(resolve));
  await open(b, 'next', storage('next'));
  finish({photoId: 'late-photo'}); await assert.rejects(work, /切换或删除/);
  assert.deepEqual(b.getSoul().candidates, []);
  await open(b, 'a', a);
  assert.equal(b.getSoul().candidates.length, 3);
  assert.ok(b.getSoul().candidates.every(c => !c.photoId && !c.accepted));
});
