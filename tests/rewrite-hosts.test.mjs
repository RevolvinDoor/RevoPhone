import test from 'node:test';
import assert from 'node:assert/strict';
import {createPictureHost} from '../host-pictures.js';
import {createChatHost} from '../host-chat.js';
import {freshState} from '../core/state.js';
import {DEFAULT_FORMAT} from '../core/protocol.js';

function deferred() { let resolve; const promise=new Promise(done=>{resolve=done;}); return {promise,resolve}; }
const imageReply='<img>\n位置：P1\n场景：park, daylight\n</img>';

function pictureFixture({voice=false}={}) {
  const s=freshState(), started=deferred(), answer=deferred(), writes=[];
  s.chat.presets.forEach(p=>{p.lore=false;}); s.draw.engine='gpt'; s.draw.enabled=!voice;
  s.draw.mode='separate'; s.draw.auto=false;
  const message={mes:'林走进公园。',swipe_id:0,swipes:['林走进公园。']};
  const ctx={chatId:'chat',chat:[{is_user:true,mes:'去散步'},message],name1:'玩家',saveChat:async()=>writes.push('save')};
  const backend={subscribe(){},async generateText(){started.resolve();return answer.promise;},drawReady:()=>true,drawQuote:()=>({free:true})};
  const host=createPictureHost({context:()=>ctx,settings:()=>s,backend,scheduleRender(){},redrawMessage(){},notice(){},
    voice:voice?{wanted:()=>true,has:()=>false,rules:()=>'',format:()=>DEFAULT_FORMAT}:null});
  return {s,ctx,message,backend,host,started,answer,writes};
}

test('没有版本变化时，原有后台配图仍正常写入正文和当前 swipe',async()=>{
  const f=pictureFixture(), job=f.host.planPictures(1); await f.started.promise;
  f.answer.resolve(imageReply); assert.equal(await job,true);
  assert.match(f.message.mes,/<img>/); assert.equal(f.message.swipes[0],f.message.mes); assert.equal(f.writes.length,1);
});

for(const change of ['swipe','edit','chat']) {
  test(`旧后台配图不会覆盖同一消息对象的新版本：${change}`,async()=>{
    const f=pictureFixture(), job=f.host.planPictures(1); await f.started.promise;
    if(change==='swipe'){f.message.swipe_id=1;f.message.mes='重写稿';}
    if(change==='edit')f.message.mes='手动编辑稿';
    if(change==='chat')f.ctx.chatId='other';
    const raw=f.message.mes; f.answer.resolve(imageReply);
    assert.equal(await job,false); assert.equal(f.message.mes,raw); assert.equal(f.writes.length,0);
  });
}

test('回复后单独配音的旧结果不会写到重写稿，也不触发后续自动出图',async()=>{
  const f=pictureFixture({voice:true}), job=f.host.autoPictures(1); await f.started.promise;
  f.message.swipe_id=1;f.message.mes='重写稿';f.answer.resolve('“你好”<tts>林|平静|你好</tts>');
  await job;assert.equal(f.message.mes,'重写稿');assert.equal(f.writes.length,0);
});

test('首稿配图仍在等待时，重写稿可独立配图；旧请求结束不清除新任务',async()=>{
  const f=pictureFixture(), old=deferred(), latest=deferred(), second=deferred();let calls=0;
  f.backend.generateText=async()=>{calls++;if(calls===1){f.started.resolve();return old.promise;}second.resolve();return latest.promise;};
  const first=f.host.planPictures(1);await f.started.promise;
  f.message.swipe_id=1;f.message.mes='重写稿';const next=f.host.planPictures(1);await second.promise;
  old.resolve(imageReply);assert.equal(await first,false);
  latest.resolve(imageReply);assert.equal(await next,true);
  assert.match(f.message.mes,/^重写稿/);assert.match(f.message.mes,/<img>/);assert.equal(f.writes.length,1);
});

test('自动图片请求结束时如果已换 swipe，即使正文标签相同也不上传或存入新版本',async t=>{
  const f=pictureFixture(), started=deferred(), image=deferred();let uploads=0;
  f.s.draw.mode='inline';f.s.draw.auto=true;f.message.mes+=imageReply;
  f.backend.generateImage=async()=>{started.resolve();return image.promise;};
  t.mock.method(globalThis,'fetch',async()=>{uploads++;throw Error('unexpected upload');});
  const job=f.host.autoPictures(1);await started.promise;f.message.swipe_id=1;
  image.resolve({blob:new Blob(['mock image']),params:{}});await job;
  assert.equal(uploads,0);assert.equal(f.message.extra?.sttts_pics,undefined);
});

function phoneFixture(t) {
  const rows=new Map(), previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  const storage={getItem:k=>rows.get(k)||null,setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k)};
  Object.defineProperty(globalThis,'localStorage',{value:storage,configurable:true});
  t.after(()=>{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage;});
  const s=freshState(), posts=[], events=[];
  s.chat.proactive.on=true;
  const message={mes:'正文\n<phone>\n林：首稿消息\n林：[朋友圈] 首稿动态\n</phone>',swipe_id:0};
  const ctx={characterId:0,chatId:'chat',getCurrentChatId(){return this.chatId;},name1:'玩家',name2:'林',chat:[{is_user:true},message]};
  const thread={id:'dm',type:'dm',members:['林'],space:'card',messages:[]};
  const backend={subscribe(){},cardKey:()=> 'card',activeChatKey:'card|chat',here:()=>null,
    contacts:()=>[{name:'林',source:'role',voice:false}],threads:async()=>[structuredClone(thread)],
    emit:(...args)=>events.push(args),chatMutate:async(_id,fn)=>fn(),momentsMutate:async fn=>fn(),moments:{add:async items=>posts.push(...items)},
    chats:{list:async()=>[structuredClone(thread)],get:async()=>structuredClone(thread),
      async append(_id,items){thread.messages.push(...items.map(item=>({...item,id:crypto.randomUUID()})));return structuredClone(thread);},
      async removeMessages(_id,ids){thread.messages=thread.messages.filter(m=>!ids.includes(m.id));}}
  };
  const host=createChatHost({context:()=>ctx,settings:()=>s,backend,storage,notice(){}});
  return {host,ctx,message,thread,posts,events,backend};
}

test('手机消息随原稿／重写稿来回恢复，独立朋友圈保留且不重复发送',async t=>{
  const f=phoneFixture(t), original=f.message.mes;
  assert.equal(await f.host.deliver(1),1);assert.equal(f.posts.length,1);
  f.message.mes='<phone>林：重写消息</phone>';f.message.swipe_id=1;
  assert.equal(await f.host.deliver(1),1);assert.deepEqual(f.thread.messages.map(m=>m.text),['重写消息']);
  f.message.mes=original;f.message.swipe_id=0;
  assert.equal(await f.host.deliver(1,{restore:true}),1);
  assert.deepEqual(f.thread.messages.map(m=>m.text),['首稿消息']);assert.equal(f.posts.length,1);
  assert.equal(await f.host.deliver(1,{restore:true}),0);
  assert.equal(f.thread.messages.length,1);assert.equal(f.events.filter(e=>e[1]?.incoming).length,2);
});

test('玩家已回复的手机对话不会因切换正文版本而被撤回',async t=>{
  const f=phoneFixture(t);await f.host.deliver(1);
  f.thread.messages.push({id:'answer',from:'me',kind:'text',text:'我的回复'});
  f.message.mes='<phone>林：重写消息</phone>';f.message.swipe_id=1;
  await f.host.deliver(1);assert.ok(f.thread.messages.some(m=>m.text==='首稿消息'));
  assert.ok(f.thread.messages.some(m=>m.id==='answer'));
});

test('快速切换 swipe 时排队中的旧手机交付会被丢弃',async t=>{
  const f=phoneFixture(t), first=f.host.deliver(1);
  f.message.mes='<phone>林：最终消息</phone>';f.message.swipe_id=2;
  const last=f.host.deliver(1,{restore:true});
  assert.equal(await first,0);assert.equal(await last,1);
  assert.deepEqual(f.thread.messages.map(m=>m.text),['最终消息']);assert.equal(f.posts.length,0);
});
