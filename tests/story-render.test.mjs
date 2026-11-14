import test from 'node:test';
import assert from 'node:assert/strict';
import {DialoguePlayer} from '../core/player.js';
import {freshState} from '../core/state.js';
import {normalizeRoute} from '../core/routes.js';
import {parsePictures} from '../core/draw.js';
import {createPictureHost} from '../host-pictures.js';
import {createRenderQueue,runRenderJobs} from '../core/render-queue.js';

const line={role:'林',emotion:'平静',text:'你好',translation:'你好'};
function voiceFixture(read) {
  const state=freshState();
  state.routes=[normalizeRoute({id:'lin',name:'林',engine:'fish',voice:'voice-a'})];
  let reads=0;
  const player=new DialoguePlayer({settings:()=>{reads++;return read?read(state):structuredClone(state);},
    providers:{references:new Map()},cache:{has:async()=>true},sink:{getVolume:()=>1,stop(){}}});
  return {state,player,reads:()=>reads};
}

test('语音状态查询只读取一次完整配置，缓存和已播放状态保持一致',async()=>{
  const f=voiceFixture();
  assert.equal(await f.player.lineState(line),'ready');
  assert.equal(f.reads(),1);
  const key=await f.player.lineKey(line);f.player.played.add(key);
  assert.equal(await f.player.lineState(line),'played');
});

test('同轮多个台词可共用状态快照且不再读取全局配置',async()=>{
  const f=voiceFixture(()=>{throw Error('不应再复制配置');}), snapshot=structuredClone(f.state);
  assert.deepEqual(await Promise.all(Array.from({length:100},()=>f.player.lineState(line,snapshot))),Array(100).fill('ready'));
  assert.equal(f.reads(),0);
  assert.deepEqual(snapshot,f.state);
});

function pictureFixture(t) {
  const state=freshState(), marker='render-test';let reads=0;
  const chat=[{is_user:true,mes:'用户'},
    {mes:'<img>\n位置：P1\n场景：park\n</img>\n<img>\n位置：P2\n场景：room\n</img>'},
    {mes:'<img>\n位置：P1\n场景：street\n</img>'}];
  const placeholders=chat.slice(1).map(m=>parsePictures(m.mes).map(tag=>({
    dataset:{stttsToken:marker,stttsHash:tag.hash},innerHTML:'',toggleAttribute(){}})));
  const elements=placeholders.map((pics,i)=>({getAttribute:()=>String(i+1),querySelectorAll:()=>pics}));
  const previous=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{configurable:true,value:{querySelectorAll:()=>elements}});
  t.after(()=>{if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;});
  const host=createPictureHost({context:()=>({chat,chatId:'fixture'}),settings:()=>{reads++;return structuredClone(state);},
    backend:{subscribe(){}},marker,scheduleRender(){},notice(){}});
  return {host,placeholders,reads:()=>reads,current:id=>chat[id]};
}

test('同轮多个正文图片共用一次配置快照',t=>{
  const f=pictureFixture(t);f.host.decorate(f.current);
  assert.equal(f.reads(),1);
  for(const p of f.placeholders.flat())assert.match(p.innerHTML,/正文出图没有开启/);
  f.host.decorate(f.current);assert.equal(f.reads(),2);
});

test('定向刷新一层图片时不重读或更新其他楼层',t=>{
  const f=pictureFixture(t);f.host.decorate(f.current,{only:new Set([2])});
  assert.equal(f.reads(),1);
  assert.ok(f.placeholders[0].every(p=>p.innerHTML===''));
  assert.match(f.placeholders[1][0].innerHTML,/正文出图没有开启/);
});

function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};}
const turn=()=>new Promise(setImmediate);

test('连续输出合并为一次后续刷新，旧结果失效且异步刷新不重叠',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const gate=deferred(),calls=[];let busy=0,peak=0;
  const queue=createRenderQueue(async(only,current)=>{
    busy++;peak=Math.max(peak,busy);calls.push({only,current});
    if(calls.length===1)await gate.promise;
    busy--;
  });t.after(()=>queue.dispose());
  queue.schedule([1]);queue.schedule([2]);t.mock.timers.tick(40);
  assert.deepEqual([...calls[0].only],[1,2]);assert.equal(calls[0].current(),true);
  queue.schedule([3]);queue.schedule([4]);
  assert.equal(calls[0].current(),false);
  t.mock.timers.tick(200);assert.equal(calls.length,1);
  gate.resolve();await turn();t.mock.timers.tick(40);await turn();
  assert.deepEqual([...calls[1].only],[1,2,3,4]);assert.equal(peak,1);
  queue.schedule([5]);queue.schedule();t.mock.timers.tick(40);await turn();
  assert.equal(calls[2].only,null);
});

test('禁用时丢弃等待任务并阻止旧刷新继续生效',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const gate=deferred();let count=0,current;
  const queue=createRenderQueue(async(_ids,valid)=>{count++;current=valid;await gate.promise;});
  queue.schedule([1]);t.mock.timers.tick(40);queue.schedule([2]);queue.dispose();
  assert.equal(current(),false);gate.resolve();await turn();
  queue.schedule([3]);t.mock.timers.runAll();await turn();assert.equal(count,1);
});

test('单次刷新失败被报告后，后续刷新仍可运行',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let calls=0;const errors=[];
  const queue=createRenderQueue(async()=>{if(++calls===1)throw Error('fixture failure');},{onError:e=>errors.push(e.message)});
  t.after(()=>queue.dispose());
  queue.schedule([1]);t.mock.timers.tick(40);await turn();assert.deepEqual(errors,['fixture failure']);
  queue.schedule([2]);t.mock.timers.tick(40);await turn();assert.equal(calls,2);
});

test('台词状态查询最多四项并发，过期时不再开始剩余台词',async()=>{
  const gate=deferred();let current=true,started=0,busy=0,peak=0;
  const jobs=Array.from({length:300},()=>async()=>{started++;busy++;peak=Math.max(peak,busy);await gate.promise;busy--;});
  const running=runRenderJobs(jobs,()=>current);assert.equal(started,4);
  current=false;gate.resolve();await running;assert.equal(started,4);assert.equal(peak,4);
  let finished=0;
  await runRenderJobs(Array.from({length:300},()=>async()=>{finished++;}),()=>true);
  assert.equal(finished,300);
});

test('一项状态查询失败时等待其他在途查询结束再释放这一轮',async()=>{
  const gate=deferred();let started=0,settled=false;
  const jobs=Array.from({length:20},(_,i)=>async()=>{started++;if(i===0)throw Error('read failed');await gate.promise;});
  const running=runRenderJobs(jobs,()=>true);
  const checked=assert.rejects(running,/read failed/).then(()=>{settled=true;});
  await turn();assert.equal(started,4);assert.equal(settled,false);
  gate.resolve();await checked;assert.equal(started,4);
});
