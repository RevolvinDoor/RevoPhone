import test from 'node:test';
import assert from 'node:assert/strict';
import {createRewriteGate,createStoryRewriteControl,hasRewriteVersions} from '../host-rewrite.js';

function fixture(runtime) {
  const message = {mes: 'original', swipe_id: 0};
  const ctx = {characterId: 0, groupId: null, chatId: 'chat', getCurrentChatId() { return this.chatId; }, chat: [{is_user: true},message]};
  const gate = createRewriteGate({context: () => ctx, runtime});
  return {ctx,message,gate};
}
function deferred() { let resolve; const promise = new Promise(done => {resolve = done;}); return {promise,resolve}; }
const tick = () => new Promise(resolve => setImmediate(resolve));
const result = f => ({ready: true, count: true, key: '|0|chat', index: 1, message: f.message, swipeId: f.message.swipe_id, text: f.message.mes});

test('没有重写插件、已禁用、旧版或未重写时直接沿用原事件路径', () => {
  for (const runtime of [undefined, {}, {replyDelivery:{version: 0}}, {replyDelivery:{version: 1, waitForReply: () => null}}]) {
    const f = fixture(() => runtime), calls = [];
    if (!f.gate.defer(1,'received',() => calls.push('deferred'))) calls.push('original');
    assert.deepEqual(calls,['original']); assert.equal(f.gate.held(1),false);
  }
});

test('等待期间不阻塞宿主事件，同一回复的接收和渲染各交付一次', async () => {
  const d = deferred(), f = fixture(() => ({replyDelivery:{version:1,waitForReply:() => d.promise}})), seen = [];
  const receive = (id,meta) => seen.push(['received',id,meta.count,f.message.mes]);
  const render = id => seen.push(['rendered',id,f.message.mes]);
  assert.equal(f.gate.defer(1,'received',receive),true);
  f.gate.defer(1,'received',receive); f.gate.defer(1,'rendered',render); f.gate.defer(1,'rendered',render);
  assert.deepEqual(seen,[]);
  f.message.swipe_id=1; f.message.mes='final'; d.resolve(result(f)); await tick();
  assert.deepEqual(seen,[['received',1,true,'final'],['rendered',1,'final']]);
});

test('事后手动重写的正文照常交付，但不会累计自动活动次数', async () => {
  const d = deferred(), f = fixture(() => ({replyDelivery:{version:1,waitForReply:() => d.promise}})), seen=[];
  f.gate.defer(1,'received',(_id,meta) => seen.push(meta.count));
  d.resolve({...result(f),count:false}); await tick(); assert.deepEqual(seen,[false]);
});

for (const change of ['chat','message','swipe','text','dispose','not-ready']) {
  test(`等待结束后拒绝过时交付：${change}`, async () => {
    const d = deferred(), f = fixture(() => ({replyDelivery:{version:1,waitForReply:() => d.promise}})), seen=[];
    f.gate.defer(1,'received',() => seen.push('stale'));
    const finished = result(f);
    if(change==='chat')f.ctx.chatId='other';
    if(change==='message')f.ctx.chat[1]={...f.message};
    if(change==='swipe')f.message.swipe_id=1;
    if(change==='text')f.message.mes='edited';
    if(change==='dispose')f.gate.dispose();
    if(change==='not-ready')finished.ready=false;
    d.resolve(finished); await tick(); assert.deepEqual(seen,[]);
  });
}

test('切回原稿时仍可从其他 swipe 识别重写关系，不把普通翻页当成重写', () => {
  assert.equal(hasRewriteVersions({extra:{}}),false);
  assert.equal(hasRewriteVersions({extra:{auto_rewrite_revision:{id:'r'}}}),true);
  assert.equal(hasRewriteVersions({extra:{},swipe_info:[{}, {extra:{auto_rewrite_revision:{id:'r'}}}]}),true);
});

test('正文开关只读写重写插件同一个设置，并能打开设置、取消订阅', () => {
  const state={available:true,auto:false},listeners=new Set();let opened=0;
  const control={version:1,getState:()=>({...state}),setAuto:value=>{state.auto=value;for(const fn of listeners)fn();},
    openSettings:()=>opened++,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}};
  const bridge=createStoryRewriteControl(()=>({control})), seen=[];
  const stop=bridge.subscribe(()=>seen.push(bridge.status().auto));
  assert.deepEqual(bridge.status(),{available:true,auto:false});
  bridge.setAuto(true);assert.equal(state.auto,true);control.setAuto(false);
  assert.deepEqual(seen,[true,false]);bridge.openSettings();assert.equal(opened,1);
  stop();assert.equal(listeners.size,0);
  bridge.subscribe(()=>{});assert.equal(listeners.size,1);bridge.dispose();assert.equal(listeners.size,0);
});

test('没安装、旧版本或禁用重写插件时开关不可用，不创建私有设置', () => {
  for(const runtime of [undefined,{}, {control:{version:0}}, {control:{version:1,getState:()=>({available:false,auto:true}),setAuto(){throw Error('must not set');}}}]) {
    const bridge=createStoryRewriteControl(()=>runtime);
    assert.deepEqual(bridge.status(),{available:false,auto:false});
    assert.throws(()=>bridge.setAuto(true),/安装或启用/);assert.doesNotThrow(()=>bridge.subscribe(()=>{})());
  }
});
