import test from 'node:test';
import assert from 'node:assert/strict';
import {freshState} from '../core/state.js';
import {normalizeXeno, defaultXenoPreset, xenoMallPosePromptText, XENO_PROMPT_DEFAULTS} from '../core/xeno.js';
import {buildMallRestockRequest, formatMallRestockRequest} from '../core/xeno-restock.js';
import {TTSBackend} from '../core/backend.js';
import {createXenoHost} from '../host-xeno.js';
import {mallApp} from '../ui/mall.js';

const options = {category: 'skin_suit', slot: 'skin_suit', text: '银发，身高170cm', gender: '女'};
const reply = '<skin_suit_design name="银霜">\n[体态参数]：身高170cm\n[生图提示词 (Prompt)]：silver hair, standing\n</skin_suit_design>';
function fixture() {
  const state = freshState(), requests = [];
  const preset = state.xeno.presets[0];
  for (const entry of preset.entries.filter(entry => entry.scope === 'mall')) {
    entry.text = `CUSTOM:${entry.id}`;
  }
  const backend = {cardState: () => structuredClone(state), emit() {},
    async generateText(ctx, request) {requests.push(structuredClone(request)); return reply;},
    saveXeno(update) {state.xeno = normalizeXeno(update(structuredClone(state.xeno)));}};
  const host = createXenoHost({backend, settings: () => state, context: () => ({})});
  return {state, preset, backend, host, requests};
}
const system = request => request.messages.find(message => message.role === 'system').content;

test('进货只使用当前预设、选中分类及一份自定义比例尺，保留独立前置消息和参考图', () => {
  const {state, preset} = fixture();
  const inactive = defaultXenoPreset(); inactive.id = 'inactive';
  inactive.entries.find(entry => entry.id === 'scaleRule').text = 'INACTIVE-SCALE';
  state.xeno.presets.push(inactive);
  const input = {...options, imageData: 'data:image/png;base64,AA=='};
  const request = buildMallRestockRequest(state.xeno, input), sys = system(request);
  assert.deepEqual(request.messages.map(message => message.role), ['user', 'assistant', 'system', 'user']);
  assert.equal(sys.split('CUSTOM:scaleRule').length - 1, 1);
  assert.ok(sys.endsWith('CUSTOM:scaleRule')); assert.ok(sys.includes('CUSTOM:skinWorkbench'));
  assert.doesNotMatch(sys, /CUSTOM:ringWorkbench|CUSTOM:apparelWorkbench|INACTIVE-SCALE/);
  assert.ok(!sys.includes(XENO_PROMPT_DEFAULTS.scaleRule));
  assert.equal(request.messages.at(-1).content[1].image_url.url, input.imageData);
  assert.ok(request.messages.at(-1).content[0].text.includes('本次比例尺'));
  const formatted = formatMallRestockRequest(request);
  assert.match(formatted, /参考图片附件/); assert.ok(!formatted.includes(input.imageData));
  assert.equal(preset.entries.find(entry => entry.id === 'scaleRule').text, 'CUSTOM:scaleRule');
});

test('关闭或清空工作台条目不会补回默认，旧预设缺失条目仍兼容默认值', () => {
  for (const empty of [false, true]) {
    const {state, preset} = fixture();
    const ids = ['scaleRule', 'restockSysHeader', 'skinWorkbench', 'restockPreUser', 'restockPreAssistant'];
    for (const entry of preset.entries.filter(entry => ids.includes(entry.id))) {
      if (empty) entry.text = '';
      else entry.enabled = false;
    }
    const request = buildMallRestockRequest(state.xeno, options), sys = system(request);
    assert.deepEqual(request.messages.map(message => message.role), ['system', 'user']);
    for (const id of ids) {assert.ok(!sys.includes('CUSTOM:' + id)); assert.ok(!sys.includes(XENO_PROMPT_DEFAULTS[id]));}
    assert.doesNotMatch(sys, /【本次比例尺】/);
  }
  const {state, preset} = fixture();
  preset.entries = preset.entries.filter(entry => !['scaleRule', 'skinWorkbench'].includes(entry.id));
  const sys = system(buildMallRestockRequest(state.xeno, options));
  assert.ok(sys.includes(XENO_PROMPT_DEFAULTS.scaleRule)); assert.ok(sys.includes(XENO_PROMPT_DEFAULTS.skinWorkbench));
});

test('每类实际进货请求与同一组装器完全一致，图片不会被偷偷丢弃，成功只上架一次', async () => {
  for (const [category, tag, workbench] of [
    ['skin_suit', 'skin_suit_design', 'skinWorkbench'], ['flesh_ring', 'flesh_ring_design', 'ringWorkbench'],
    ['apparel', 'apparel_design', 'apparelWorkbench'], ['consumable', 'apparel_design', 'apparelWorkbench']
  ]) {
    const {state, backend, host, requests} = fixture();
    const expectedReply = reply.replaceAll('skin_suit_design', tag);
    backend.generateText = async (ctx, request) => {requests.push(structuredClone(request)); return expectedReply;};
    const input = {...options, category, slot: category === 'apparel' ? 'accessories' : category, imageData: 'data:image/png;base64,AA=='};
    const expected = buildMallRestockRequest(state.xeno, input), count = state.xeno.items.length;
    const item = await host.mallRestock(input);
    assert.equal(requests.length, 1); assert.deepEqual(requests[0].prompt, expected.messages);
    assert.ok(system(expected).includes('CUSTOM:' + workbench));
    assert.equal(state.xeno.items.length, count + 1);
    assert.equal(item.owned, false); assert.equal(item.imageData, input.imageData);
  }
});

test('空回复、拒答、截断档案或接口错误均不切换模板、不静默重试、不创建商品', async () => {
  for (const result of ['', '抱歉，无法满足这个请求。请换一种设计。', '<skin_suit_design name="未完成">', '<skin_suit_design name="空档案">  </skin_suit_design>', '<apparel_design name="错误分类"></apparel_design>', Error('图片接口连接失败')]) {
    const {state, backend, host, requests} = fixture(), original = structuredClone(state.xeno);
    backend.generateText = async (ctx, request) => {
      requests.push(request);
      if (result instanceof Error) throw result;
      return result;
    };
    await assert.rejects(host.mallRestock({...options, imageData: 'data:image/png;base64,AA=='}), /未上架|图片接口连接失败/);
    assert.equal(requests.length, 1); assert.deepEqual(state.xeno, original);
    assert.ok(requests[0].prompt.find(message => message.role === 'system').content.includes('CUSTOM:scaleRule'));
    assert.equal(host.busy('restock'), false);
  }
});

test('姿势选择与工坊显示一致，旧数据多选时只用第一项，关闭或清空不会叠加其他姿势', () => {
  const {state, preset} = fixture();
  const poses = preset.entries.filter(entry => ['mallPosePrompt', 'mallPoseStand', 'mallPoseSolo'].includes(entry.id));
  poses.forEach(entry => {entry.enabled = true;});
  const original = structuredClone(state.xeno);
  assert.equal(xenoMallPosePromptText(state.xeno), 'CUSTOM:mallPosePrompt');
  assert.deepEqual(state.xeno, original);
  poses[0].enabled = false;
  assert.equal(xenoMallPosePromptText(state.xeno), 'CUSTOM:mallPoseStand');
  poses[1].text = '';
  assert.equal(xenoMallPosePromptText(state.xeno), '');
  poses.forEach(entry => {entry.enabled = false;});
  assert.equal(xenoMallPosePromptText(state.xeno), '');
});

test('异构预设发送预览使用指定草稿及单一分类，和实际请求共用组装器', () => {
  const {state, backend} = fixture(), draft = defaultXenoPreset();
  draft.id = 'draft'; draft.entries.find(entry => entry.id === 'scaleRule').text = 'DRAFT-SCALE';
  const before = structuredClone(state), b = Object.create(TTSBackend.prototype);
  b.cardState = backend.cardState;
  const preview = b.previewXenoPrompt(draft, {mallCategory: 'flesh_ring'});
  const expected = buildMallRestockRequest({...state.xeno, presets: [draft], activePreset: draft.id}, {
    category: 'flesh_ring', slot: 'flesh_ring', text: '（本次进货要求；商城「查看本次请求」会显示当前实际输入）'
  });
  const mallPart = preview.slice(preview.indexOf('━━ 商城进货示例'));
  assert.match(mallPart, /肉躯/); assert.ok(mallPart.endsWith(formatMallRestockRequest(expected)));
  assert.doesNotMatch(mallPart, /CUSTOM:scaleRule|<skin_suit_design_workbench>|<apparel_design_workbench>/);
  assert.deepEqual(state, before);
});

test('商城查看本次请求读取表单草稿但不保存或请求模型，点击进货发送同一内容', async () => {
  const {state, host, requests} = fixture(), listeners = new Map(), errors = [];
  let dialogContent = '', saved = 0;
  const inputs = {'#mall-restock-text': {value: options.text}, '#mall-pose-prompt-input': {value: 'draft standing pose'}};
  const doc = {activeElement: null, addEventListener() {}, createElement: () => root};
  const root = {dataset: {}, ownerDocument: doc, scrollTop: 0,
    contains: element => !!element, querySelectorAll: () => [], querySelector: selector => inputs[selector] || null,
    addEventListener(type, handler) {if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(handler);}};
  const api = {getState: () => state, subscribe: () => () => {}, mallRestock: host.mallRestock,
    saveXenoPreset(preset) {saved++; state.xeno.presets = [preset];}};
  const ctx = {api, doc, win: {AbortController}, dialog(title, content) {dialogContent = content;},
    notify(message, opts) {if (opts?.error) errors.push(message);}};
  const view = mallApp(ctx);
  function click(action) {
    const target = {dataset: {action}, matches: () => false,
      closest: selector => selector === '[data-action]' ? target : null};
    for (const fn of listeners.get('click')) fn({target, preventDefault() {}});
  }
  click('toggle-restock');
  const before = structuredClone(state);
  click('preview-restock');
  assert.equal(requests.length, 0); assert.equal(saved, 0); assert.deepEqual(state, before);
  assert.match(dialogContent, /draft standing pose|CUSTOM:scaleRule/);
  assert.ok(dialogContent.includes('draft standing pose')); assert.ok(dialogContent.includes(options.text));
  click('run-restock');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(errors, []); assert.equal(requests.length, 1); assert.equal(saved, 1);
  assert.ok(requests[0].prompt.find(message => message.role === 'system').content.includes('draft standing pose'));
  assert.equal(requests[0].prompt.at(-1).content.includes(options.text), true);
  view.dispose();
});
