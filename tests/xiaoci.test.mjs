import test from 'node:test';
import assert from 'node:assert/strict';
import {freshState, normalizeSettings} from '../core/state.js';
import {withXiaoci, xiaociPrelude, prependStoryXiaoci, normalizePromptRules} from '../core/prompt-rules.js';
import {buildChatRequest, withPhone} from '../core/chat.js';
import {buildCallRequest} from '../core/call.js';
import {buildMomentsRequest} from '../core/moments.js';
import {buildForumRequest} from '../core/forum.js';
import {buildPeekRequest} from '../core/peek.js';
import {buildMemoryRequest} from '../core/memory.js';
import {pickRequest, searchRequest} from '../core/auto-voice.js';
import {planRequest, suggestRequest, writeRequest, tagTextRequest, fillUpRequest} from '../core/draw.js';
import {voicePlanRequest, combinedRequest} from '../core/voice-plan.js';
import {chatBody, tavernTextRequest, assertOrderedChatSupport} from '../core/llm.js';
import {TTSBackend} from '../core/backend.js';
import {createAssistantHost, requestAssistantText} from '../host-assistant.js';

const roles = messages => messages.map(message => message.role);
const ordered = messages => assert.deepEqual(roles(messages).slice(0, 3), ['user', 'assistant', 'system']);
const member = {name: '林', persona: '熟悉的朋友', voice: false};
const thread = {type: 'dm', name: '林', messages: [{id: 'm1', from: 'me', kind: 'text', text: '你好'}]};
const original = () => [{role: 'system', content: '原规则'}, {role: 'user', content: '实际输入'}];

test('各功能使用独立配置，旧设置在保存恢复后仍保留自定义与关闭状态', () => {
  const old = freshState();
  old.promptRules = {
    chat: {parts: {noVoice: '仍然只发文字'}},
    xiaoci: {parts: {identity: '我是自定义小此'}},
    'xiaoci-dm': {parts: {user: '私聊准备', assistant: '{{小此人设}}：准备好了，{{用户}}'}},
    'xiaoci-group': {enabled: false}
  };
  const restored = normalizeSettings(JSON.parse(JSON.stringify(old)));
  assert.equal(restored.promptRules.chat.parts.noVoice, '仍然只发文字');
  const request = withXiaoci(restored.promptRules, 'dm', original(), {'用户': '阿明'});
  assert.equal(request[0].content, '私聊准备');
  assert.equal(request[1].content, '我是自定义小此：准备好了，阿明');
  assert.deepEqual(roles(withXiaoci(restored.promptRules, 'group', original())), ['system', 'user']);
  assert.equal(withXiaoci(restored.promptRules, 'call', original())[0].content.includes('电话'), true);
  assert.equal(normalizePromptRules(restored.promptRules)['xiaoci-dm'].parts.user, '私聊准备');
  assert.equal(xiaociPrelude({xiaoci: {parts: {identity: '人设正文'}}, 'xiaoci-dm': {parts: {assistant: '{{小此人设}}'}}}, 'dm')[1].content, '人设正文');
});

test('总开关、分功能开关或任一空白内容都整组跳过，不改写原消息和多模态输入', () => {
  const messages = original();
  messages[1].content = [{type: 'text', text: '看看这张图'}, {type: 'image_url', image_url: {url: 'data:image/png;base64,AA=='}}];
  const before = structuredClone(messages);
  for (const overrides of [
    {xiaoci: {enabled: false}},
    {'xiaoci-dm': {enabled: false}},
    {'xiaoci-dm': {parts: {user: ' \n '}}},
    {'xiaoci-dm': {parts: {assistant: ''}}}
  ]) assert.equal(withXiaoci(overrides, 'dm', messages), messages);
  const outgoing = withXiaoci({}, 'dm', messages);
  ordered(outgoing);
  assert.deepEqual(outgoing.slice(2), before);
  assert.deepEqual(messages, before);
});

test('合并任务只有一对前置消息，共用人设一次，任务开关分别生效', () => {
  const overrides = {xiaoci: {parts: {identity: '共同身份标记'}}};
  const prelude = xiaociPrelude(overrides, ['voice', 'draw-story', 'voice']);
  assert.deepEqual(roles(prelude), ['user', 'assistant']);
  assert.equal(prelude[1].content.split('共同身份标记').length - 1, 1);
  assert.match(prelude[0].content, /配音/);
  assert.match(prelude[0].content, /配图/);
  assert.doesNotMatch(xiaociPrelude({...overrides, 'xiaoci-voice': {enabled: false}}, ['voice', 'draw-story'])[0].content, /配音/);
});

test('私聊／群聊及看图请求保留历史和图片，前置助手不会替换原功能 system', () => {
  const s = freshState(), preset = s.chat.presets[0];
  const pictures = [{id: 'm1', url: 'data:image/png;base64,AA=='}];
  for (const type of ['dm', 'group']) {
    const args = {preset, thread: {...thread, type}, members: [member], pictures, user: '阿明'};
    const request = buildChatRequest(args);
    const legacy = buildChatRequest({...args, prompts: {xiaoci: {enabled: false}}});
    ordered(request);
    assert.deepEqual(request.slice(2), legacy);
    assert.equal(request.at(-1).content[1].image_url.url, pictures[0].url);
    assert.match(request.at(-1).content[0].text, /你好/);
  }
});

test('电话各阶段、朋友圈／论坛各交互和查手机保留原有请求体', () => {
  const preset = freshState().chat.presets[0];
  const post = {author: '林', text: '今天去散步', title: '公园', comments: [], replies: [], likes: []};
  const factories = [
    ...['incoming', 'outgoing', 'reply', 'voicemail'].map(mode => prompts => buildCallRequest({prompts, preset, mode, contact: member})),
    ...['posts', 'react', 'reply'].map(mode => prompts => buildMomentsRequest({prompts, preset, mode, people: [member], post, comment: {text: '好呀'}})),
    ...['posts', 'react', 'reply'].map(mode => prompts => buildForumRequest({prompts, preset, mode, people: [member], post, reply: {text: '好呀', author: 'me'}})),
    prompts => buildPeekRequest({prompts, preset, person: member})
  ];
  for (const build of factories) {
    const request = build({});
    ordered(request);
    assert.deepEqual(request.slice(2), build({xiaoci: {enabled: false}}));
  }
});

test('记忆摘要／合并与音色搜索／选择保留严格输出格式', () => {
  const factories = [
    prompts => buildMemoryRequest({prompts, level: 0, messages: thread.messages, user: '阿明', who: '林'}),
    prompts => buildMemoryRequest({prompts, level: 1, nodes: [{level: 0, from: 1, to: 2, text: '两人约好散步'}]}),
    prompts => pickRequest('林的资料', [{label: '清澈的声音'}], {prompts}),
    prompts => searchRequest('林的资料', 'fish', prompts, 'zh')
  ];
  for (const build of factories) {
    const request = build({});
    ordered(request);
    assert.deepEqual(request.slice(2), build({xiaoci: {enabled: false}}));
  }
});

test('绘图各入口、漫画和扩写保持结构化前置对话，不重复叠加', () => {
  for (const comic of [false, true]) {
    const s = freshState();
    s.draw.comic.enabled = comic;
    const off = {...s, promptRules: {xiaoci: {enabled: false}}};
    const factories = [
      settings => planRequest(settings, {message: '林走进公园。'}),
      settings => suggestRequest(settings, {before: [{name: '旁白', text: '林走进公园。'}]}),
      settings => writeRequest(settings, {idea: '公园中的长椅'}),
      settings => tagTextRequest(settings, 'park, bench', 'translate'),
      settings => tagTextRequest(settings, 'park, bench', 'revise', '改成夜晚')
    ];
    for (const build of factories) {
      const request = build(s);
      ordered(request);
      assert.deepEqual(request.slice(2), build(off));
      const followup = fillUpRequest(request, {line: 'park, bench', people: [], used: 10, left: 100, tags: 10});
      assert.deepEqual(followup.slice(0, request.length), request);
      assert.deepEqual(roles(followup).slice(-2), ['assistant', 'user']);
    }
  }
});

test('单独配音、配图和合并任务接手机联动后仍使用原 system 与实际输入', () => {
  const s = freshState(), format = s.presets[0].format;
  const pictures = planRequest(s, {message: '林说：“你好。”', prelude: false});
  const voice = voicePlanRequest({rules: '配音规则', format, message: '林说：“你好。”'});
  const both = combinedRequest({rules: '配音规则', format, pictures});
  for (const [scenes, task] of [[['voice'], voice], [['draw-story'], pictures], [['voice', 'draw-story'], both]]) {
    const raw = withPhone(task, '【手机上的事】本轮可以发消息');
    const request = withXiaoci({}, scenes, raw);
    ordered(request);
    assert.deepEqual(request.slice(2), raw);
    assert.match(request[2].content, /手机上的事/);
    assert.match(request.at(-1).content, /你好/);
  }
});

test('正文最终请求按 type 隔离，合并配音绘图、不重复注入且不污染 quiet 或 impersonate', () => {
  for (const type of ['normal', 'regenerate', 'swipe', 'continue']) {
    const payload = {type, messages: original()};
    const before = structuredClone(payload.messages);
    assert.equal(prependStoryXiaoci(payload, {}, ['voice', 'draw-story']), true);
    ordered(payload.messages);
    assert.deepEqual(payload.messages.slice(2), before);
    assert.equal(prependStoryXiaoci(payload, {}, ['voice', 'draw-story']), false);
  }
  for (const type of ['quiet', 'impersonate', undefined]) {
    const payload = {type, messages: original()}, before = structuredClone(payload);
    assert.equal(prependStoryXiaoci(payload, {}, ['voice']), false);
    assert.deepEqual(payload, before);
  }
  assert.equal(prependStoryXiaoci({type: 'normal', messages: original()}, {}, []), false);
});

test('绘图纯文本兼容路径遇到前置对话保留真实角色，额外 systemPrompt 不会被宿主提前', () => {
  const prompt = withXiaoci({}, 'draw-write', original());
  const before = structuredClone(prompt);
  const request = tavernTextRequest({prompt, plainText: true, systemPrompt: '附加系统规则', responseLength: 1000});
  ordered(request.prompt);
  assert.equal(request.systemPrompt, '');
  assert.equal(request.prompt[2].content, '附加系统规则\n\n原规则');
  assert.deepEqual(prompt, before);
  const legacy = tavernTextRequest({prompt: original(), plainText: true});
  assert.equal(legacy.prompt, '实际输入');
  assert.equal(legacy.systemPrompt, '原规则');
  assert.throws(() => assertOrderedChatSupport({mainApi: 'kobold'}, prompt), /user → assistant → system/);
  assert.doesNotThrow(() => assertOrderedChatSupport({mainApi: 'openai'}, prompt));
});

test('generateTextRaw 的实际宿主边界保留顺序并保护输入不受宿主原地修改', async () => {
  const s = freshState(), prompt = writeRequest(s, {idea: '公园的长椅'}), before = structuredClone(prompt);
  let sent;
  const backend = {settings: s, textKeys: new Map()};
  const ctx = {mainApi: 'openai', generateRaw: async request => {
    sent = structuredClone(request);
    request.prompt[0].content = '宿主内部改写';
    return '完成';
  }};
  assert.equal(await TTSBackend.prototype.generateTextRaw.call(backend, ctx, {prompt, plainText: true}), '完成');
  ordered(sent.prompt);
  assert.equal(sent.plainText, undefined);
  assert.deepEqual(prompt, before);
});

test('新角色支持检查只限制新增小此前置，不改变原有异构式请求或关闭后的路径', async () => {
  const backend = {settings: freshState(), textKeys: new Map()};
  const ctx = {mainApi: 'textgenerationwebui', generateRaw: async () => '旧路径仍可用'};
  const legacy = [{role: 'user', content: '原有前置用户'}, {role: 'assistant', content: '原有前置助手'}, ...original()];
  assert.equal(await TTSBackend.prototype.generateTextRaw.call(backend, ctx, {prompt: legacy}), '旧路径仍可用');
  await assert.rejects(TTSBackend.prototype.generateTextRaw.call(backend, ctx, {prompt: withXiaoci({}, 'dm', original())}), /user → assistant → system/);
  const disabled = withXiaoci({xiaoci: {enabled: false}}, 'dm', original());
  assert.equal(await TTSBackend.prototype.generateTextRaw.call(backend, ctx, {prompt: disabled}), '旧路径仍可用');
});

test('助手自定义接口仅发一次请求，消息数组和多模态附件到实际请求体仍保留', async () => {
  const s = freshState();
  s.text = {source: 'custom', active: 'demo', presets: [{id: 'demo', model: 'demo', url: 'https://models.invalid/v1', stream: false}]};
  const input = original();
  input[1].content = [{type: 'text', text: '看这张图'}, {type: 'image_url', image_url: {url: 'data:image/png;base64,AA=='}}];
  const prompt = withXiaoci({}, 'assistant', input);
  let calls = 0, body;
  const backend = {textKeys: new Map(), textFetch: async (url, options) => {
    calls++;
    body = JSON.parse(options.body);
    return new Response(JSON.stringify({choices: [{message: {content: '看到了这次提供的附件'}}]}), {headers: {'Content-Type': 'application/json'}});
  }};
  const answer = await requestAssistantText({mainApi: 'openai'}, backend, s, prompt);
  assert.equal(calls, 1);
  assert.equal(answer, '看到了这次提供的附件');
  assert.deepEqual(body.messages, chatBody({model: 'demo'}, prompt).messages);
  ordered(body.messages);
  assert.deepEqual(body.messages.at(-1).content, input[1].content);
});

test('助手宿主 ChatCompletionService 边界保留顺序，预设转换不改写会话原消息', async () => {
  const s = freshState(), prompt = withXiaoci({}, 'assistant', original()), before = structuredClone(prompt);
  let prepared = 0, sent = 0;
  const ctx = {mainApi: 'openai', ChatCompletionService: {
    presetToGeneratePayload: async (preset, overrides, payload) => { prepared++; return payload; },
    sendRequest: async payload => { sent++; ordered(payload.messages); return {content: '收到'}; }
  }};
  assert.equal(await requestAssistantText(ctx, {}, s, prompt, {completion: {preset: {}, model: 'demo'}}), '收到');
  assert.equal(prepared, 1);
  assert.equal(sent, 1);
  assert.deepEqual(prompt, before);
});

test('配音与绘图预设预览展示当前小此前置，聊天预览使用实际请求构造器', () => {
  const s = freshState();
  const backend = {settings: s, cardState: () => s, drawCast: () => [], voiceFormat: () => s.presets[0].format};
  const voice = TTSBackend.prototype.previewPrompt.call(backend);
  const draw = TTSBackend.prototype.previewDrawPrompt.call(backend);
  const chat = TTSBackend.prototype.previewChatPrompt.call(backend);
  for (const [scene, preview] of [['voice', voice], ['draw-story', draw], ['dm', chat]]) {
    const pair = xiaociPrelude(s.promptRules, scene, scene === 'dm' ? {'用户': '{{user}}'} : {});
    const prefix = pair.map(message => `【${message.role}】\n${message.content}`).join('\n\n') + '\n\n【system】';
    assert.equal(preview.includes(prefix), true);
  }
});

test('真实助手回复流程保留小此前置和历史，只把新回复写入会话', async () => {
  const s = freshState();
  s.assistant.memory.enabled = false;
  let saved = {id: 'thread-1', revision: 0, messages: [{id: 'u1', role: 'user', text: '你好'}]};
  let outgoing;
  const backend = {
    emit() {}, drawReady: () => false,
    assistantThread: async () => structuredClone(saved),
    appendAssistantMessage: async (id, message) => {
      saved.messages.push({id: 'a1', ...message});
      return structuredClone(saved);
    }
  };
  const host = createAssistantHost({
    context: () => ({mainApi: 'openai', name1: '阿明', chat: []}), settings: () => s, backend,
    request: async (ctx, service, state, messages) => {
      outgoing = structuredClone(messages);
      return {text: '你好，Master。', meta: {}};
    }
  });
  try {
    await host.reply(saved.id);
    ordered(outgoing);
    assert.equal(outgoing.at(-1).content, '你好');
    assert.deepEqual(saved.messages.map(message => message.role), ['user', 'assistant']);
    assert.equal(saved.messages.at(-1).text, '你好，Master。');
  } finally { host.close(); }
});
