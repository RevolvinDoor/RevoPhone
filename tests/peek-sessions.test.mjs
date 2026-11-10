import test from 'node:test';
import assert from 'node:assert/strict';
import {TTSBackend} from '../core/backend.js';
import {freshState} from '../core/state.js';
import {cleanPeek, peekId} from '../core/peek.js';
import {createAppsHost} from '../host-apps.js';
import {MemoryStore} from './helpers.mjs';

function backendFixture(store = new MemoryStore()) {
  const backend = Object.create(TTSBackend.prototype);
  Object.assign(backend, {
    settings: freshState(), apps: store, space: {key: 'card:a', name: 'A', members: []},
    closed: false, activeChatKey: '', xenoFloors: new Map(), xenoSessions: new Map(), xenoChatRecords: new Map(),
    xenoChatStores: new Map(), xenoChatWrites: new Map(), deletedXenoChats: new Set(), xenoImages: new Map(),
    emit() {}, notify() {}, persistXenoImage: async () => {},
    getState() { return structuredClone(this.settings); }, cardState() { return this.getState(); },
    save(value) { this.settings = structuredClone(value); return this.getState(); },
    setSpace(value) { this.space = structuredClone(value); }, initializeCardRoles() {}
  });
  return backend;
}
const snap = (name = '林', text = '旧聊天里的备忘') => ({name, notes: [{title: '笔记', text}]});
const storage = ref => {
  let saved;
  return {ref, async read() { return structuredClone(saved || null); }, async readLegacy() { return null; },
    async write(value) { saved = structuredClone(value); return true; }, saved: () => structuredClone(saved)};
};
async function open(backend, key, store, space = 'card:a') {
  return backend.switchChatXeno(key, {space: {key: space, name: space, members: []}, storage: store, userName: '主角', hasHistory: false});
}

test('查手机始终按角色卡＋聊天隔离，关闭分区也不会串；新聊天为空、切回旧聊天恢复', async () => {
  const b = backendFixture();
  const a = storage({kind: 'character', fileName: 'old'}), n = storage({kind: 'character', fileName: 'new'}), other = storage({kind: 'character', fileName: 'old'});
  b.settings.chat.partition = 'off';
  await open(b, 'card:a|old', a);
  await b.savePeek(snap());
  assert.equal((await b.listPeeks()).length, 1);
  assert.equal(a.saved().peeks[0].notes[0].text, '旧聊天里的备忘');
  await open(b, 'card:a|new', n);
  assert.equal((await b.listPeeks()).length, 0); assert.equal(await b.getPeek('林'), null);
  await b.savePeek(snap('林', '新聊天的内容'));
  await open(b, 'card:b|old', other, 'card:b');
  assert.equal((await b.listPeeks()).length, 0);
  await open(b, 'card:a|old', a);
  assert.equal((await b.getPeek('林')).notes[0].text, '旧聊天里的备忘');
  assert.equal((await b.listPeeks())[0].chatKey, 'card:a|old');
});

test('聊天元数据包含查手机快照；换本地存储后仍可从聊天文件恢复；忘掉后不复活', async () => {
  const a = storage({kind: 'character', fileName: 'old'});
  const b = backendFixture(); await open(b, 'card:a|old', a); await b.savePeek(snap());
  const fresh = backendFixture(); await open(fresh, 'card:a|old', a);
  assert.equal((await fresh.getPeek('林')).notes[0].text, '旧聊天里的备忘');
  await fresh.deletePeek('林');
  assert.deepEqual(a.saved().peeks, []);
  const freshAgain = backendFixture(); await open(freshAgain, 'card:a|old', a);
  assert.deepEqual(await freshAgain.listPeeks(), []);
});

test('删除角色聊天或群聊清理对应快照，保留别的聊天；已删除聊天的迟到结果不能写回', async () => {
  const b = backendFixture(), a = storage({kind: 'character', fileName: 'old'});
  await open(b, 'card:a|old', a); await b.savePeek(snap());
  const scope = b.peekScope();
  const n = storage({kind: 'character', fileName: 'new'});
  await open(b, 'card:a|new', n); await b.savePeek(snap('林', '保留'));
  await b.deleteChatXenoFile('old.jsonl', {cardKey: 'card:a'});
  assert.equal(await b.apps.get(peekId('林', 'card:a', 'card:a|old')), null);
  assert.equal((await b.getPeek('林')).notes[0].text, '保留');
  await assert.rejects(b.savePeek(snap(), scope), /已删除/);
  const g = storage({kind: 'group', chatId: 'g-old'});
  await open(b, 'tt:group:g-old', g, 'group:1'); await b.savePeek(snap());
  await b.deleteChatXenoFile('g-old', {cardKey: 'group:1', group: true});
  assert.deepEqual(await b.listPeeks(), []);
});

test('查手机生成中切换聊天仍写回原聊天；删除原聊天后生成返回不会重建', async () => {
  const b = backendFixture(), a = storage({kind: 'character', fileName: 'old'}), n = storage({kind: 'character', fileName: 'new'});
  await open(b, 'card:a|old', a);
  Object.assign(b, {contacts: () => [{name: '林', persona: '朋友'}], threads: async () => [], drawReady: () => false});
  let finish;
  b.generateText = async () => new Promise(resolve => {finish = resolve;});
  const host = createAppsHost({context: () => ({chat: [], name1: '主角'}), settings: () => {
    const s = b.getState(); s.chat.presets[0].lore = false; return s;
  }, backend: b});
  const work = host.peekLook('林');
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  await open(b, 'card:a|new', n);
  finish('【备忘录】约定｜明天见面');
  await work;
  assert.equal(await b.getPeek('林'), null);
  await open(b, 'card:a|old', a);
  assert.equal((await b.getPeek('林')).notes[0].text, '明天见面');
  finish = null;
  const work2 = host.peekLook('林');
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  await b.deleteChatXenoFile('old', {cardKey: 'card:a'});
  finish('【备忘录】约定｜这条不应保存');
  await assert.rejects(work2, /已删除/);
  assert.deepEqual(await b.listPeeks(), []);
});

test('旧版同卡快照只迁移到已有聊天一次，新聊天不会接收旧内容', async () => {
  const b = backendFixture();
  await b.apps.put([cleanPeek({...snap(), space: 'card:a'}, 1)]);
  await open(b, 'card:a|new', storage({kind: 'character', fileName: 'new'}));
  assert.deepEqual(await b.listPeeks(), []);
  const old = storage({kind: 'character', fileName: 'old'});
  const saved = b.xenoChatRecords.get('card:a|new');
  saved.chatKey = 'card:a|old'; delete saved.peeks; await old.write(saved);
  await b.switchChatXeno('card:a|old', {space: {key: 'card:a'}, storage: old, hasHistory: true});
  assert.equal((await b.listPeeks()).length, 1);
  assert.equal(await b.apps.get(peekId('林', 'card:a')), null);
});

test('退出正文聊天清空查手机可见范围，保留原聊天快照且不创建无归属记录', async () => {
  const b = backendFixture(), a = storage({kind: 'character', fileName: 'old'});
  await open(b, 'card:a|old', a); await b.savePeek(snap());
  await b.switchChatXeno('', {space: {key: ''}});
  assert.equal(b.activeChatKey, ''); assert.deepEqual(await b.listPeeks(), []);
  assert.equal(await b.getPeek('林'), null);
  await assert.rejects(b.savePeek(snap()), /先打开/);
  await open(b, 'card:a|old', a);
  assert.equal((await b.getPeek('林')).notes[0].text, '旧聊天里的备忘');
});

test('聊天文件已清空快照时覆盖旧本地副本；恢复过程中删除聊天不能复活记录', async () => {
  const a = storage({kind: 'character', fileName: 'old'}), original = backendFixture();
  await open(original, 'card:a|old', a); await original.savePeek(snap());
  const saved = a.saved();
  const empty = backendFixture();
  await empty.apps.put([cleanPeek({...snap(), space: 'card:a', chatKey: 'card:a|old'}, 1)]);
  await a.write({...saved, peeks: []});
  await open(empty, 'card:a|old', a);
  assert.deepEqual(await empty.listPeeks(), []);
  await a.write(saved);
  const b = backendFixture(); let release;
  const put = b.apps.put.bind(b.apps);
  b.apps.put = async rows => {
    if (rows.some(row => row.kind === 'peek')) await new Promise(resolve => {release = resolve;});
    return put(rows);
  };
  const opening = open(b, 'card:a|old', a);
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await b.deleteChatXenoFile('old', {cardKey: 'card:a'});
  release(); assert.equal(await opening, null);
  assert.deepEqual(await b.apps.list('peek'), []);
  assert.equal(await b.apps.get('xeno-chat:card:a|old'), null);
});

test('本机快照读取失败仍保存异构状态，并保留聊天文件中的上次查手机记录', async () => {
  const b = backendFixture(), a = storage({kind: 'character', fileName: 'old'}), notices = [];
  await open(b, 'card:a|old', a); await b.savePeek(snap());
  const list = b.apps.list.bind(b.apps);
  b.apps.list = async kind => {if (kind === 'peek') throw Error('存储暂时不可读'); return list(kind);};
  b.notify = message => notices.push(message);
  b.settings.xeno.protagonist.name = '新名称';
  await b.persistActiveChatXeno();
  assert.equal(a.saved().session.protagonist.name, '新名称');
  assert.equal(a.saved().peeks[0].notes[0].text, '旧聊天里的备忘');
  assert.match(notices[0], /查手机记录读取失败/);
});
