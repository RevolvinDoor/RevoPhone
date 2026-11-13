import {worldInfoFor} from './host-lore.js';
import {blobToDataUrl} from './xeno-images.js';
import {isValidRoleName} from './core/routes.js';
import {SOUL_LIMIT, normalizeSoulCandidate, parseSoulJson, soulDiscoveryRequest,
  soulExpansionRequest, expandedSoulPersona} from './core/soul.js';
import {stripQualityDrawTags} from './core/xeno-wear.js';

export function createSoulHost({context, backend, thumbnail = blob => blobToDataUrl(globalThis.window, blob)}) {
  const jobs = new Map();
  const unsubscribe = backend.subscribe?.(event => {
    if (!['space', 'soul'].includes(event?.type)) return;
    const current = backend.soulScope();
    for (const job of jobs.values()) if (job.scope.chatKey !== current.chatKey || job.scope.epoch !== current.epoch) job.controller.abort();
  });
  function run(key, action) {
    const scope = backend.soulScope(); backend.assertSoulScope(scope);
    const id = `${scope.chatKey}:${scope.epoch}:${key}`;
    if (jobs.has(id)) return jobs.get(id).work;
    const controller = new AbortController();
    const work = Promise.resolve().then(() => action(scope, controller.signal)).finally(() => {
      jobs.delete(id); backend.emit('soul', {busy: false});
    });
    jobs.set(id, {work, controller, scope});
    backend.emit('soul', {busy: true});
    return work;
  }
  // Public world background for authoring: never pass the player's persona or story transcript.
  async function worldBackground(scope, query) {
    const ctx = context(), card = ctx?.characters?.[ctx?.characterId];
    const scenario = String(card?.scenario || card?.data?.scenario || '');
    const description = String(card?.description || card?.data?.description || '');
    const lore = await worldInfoFor(() => ctx, {texts: [scenario, card?.name || '', query], max: 9000,
      report: (...args) => backend.reportDiagnostic?.(...args)});
    backend.assertSoulScope(scope);
    const world = [scenario, description, lore].filter(Boolean).join('\n\n').slice(0, 18000);
    if (!world.trim()) throw Error('未读取到当前世界观，请先在角色卡或世界书中提供背景设定');
    return world;
  }
  function busy() {
    if (backend.soulNavigating) return true;
    const scope = backend.soulScope();
    return [...jobs.keys()].some(key => key.startsWith(`${scope.chatKey}:${scope.epoch}:`));
  }
  function picture(id, {allowPaid = false} = {}) {
    return run(`picture:${id}`, async (scope, signal) => {
      const state = backend.getSoul(), person = state.candidates.find(c => c.id === id);
      if (!person) throw Error('这位角色已不在发现记录中');
      if (person.imageState === 'done' && (person.imageData || person.photoId)) return person;
      const key = `soul:${scope.chatKey}:${id}`, stop = () => backend.drawQueue?.cancel(key);
      signal.addEventListener('abort', stop, {once: true});
      try {
        if (!backend.drawReady()) throw Error('请先在「引擎／绘图」配置绘图连接，再点击补画');
        const draw = backend.cardState().draw;
        const style = draw.styles.find(s => s.id === draw.activeStyle) || draw.styles[0] || {};
        const prompt = stripQualityDrawTags([style.artist, style.positive, person.drawPrompt, 'adult, solo, full body',
          person.nsfw ? 'glamour portrait, fashion photoshoot, confident pose'
            : 'standing, fully clothed, casual portrait, everyday scene'].filter(Boolean).join(', '));
        const made = await backend.generateImage({prompt, negative: style.negative || '',
          params: {...draw.params, width: 768, height: 1024},
          name: `Soul-${person.name}`, key, label: `Soul ${person.nsfw ? '写真' : '生活照'} · ${person.name}`, allowPaid});
        backend.assertSoulScope(scope);
        const imageData = made.blob ? await thumbnail(made.blob) : '';
        backend.assertSoulScope(scope);
        if (!made.photoId && !imageData) throw Error('绘图接口没有返回可用图片，可点击补画重试');
        return backend.soulPatchCandidate(id, {photoId: made.photoId || '', imageData, imageState: 'done', imageError: ''}, scope);
      } catch (error) {
        backend.assertSoulScope(scope);
        await backend.soulPatchCandidate(id, {imageState: 'waiting', imageError: error.message}, scope);
        throw error;
      } finally {signal.removeEventListener('abort', stop);}
    });
  }
  function discover({query, incoming = false} = {}) {
    return run(incoming ? 'incoming' : 'discovery', async (scope, signal) => {
      const state = backend.getSoul(), count = incoming ? 1 : 3;
      if (state.candidates.length + count > SOUL_LIMIT) throw Error('发现记录已满，请先清理未认识的历史记录');
      const requirements = typeof query === 'string' ? query.trim().slice(0, 1000) : state.query;
      await backend.saveSoul({query: requirements}, scope);
      const world = await worldBackground(scope, requirements);
      const excluded = [...new Set([...state.candidates.map(c => c.name), ...backend.contacts().map(c => c.name),
        ...backend.routesHere().map(r => r.name), context()?.characters?.[context()?.characterId]?.name].filter(Boolean))];
      const prompt = soulDiscoveryRequest({world, profile: state.profile, query: requirements, nsfw: state.nsfw, incoming, excluded});
      const output = parseSoulJson(await backend.generateText(context(), {prompt, responseLength: incoming ? 1600 : 3800, trimNames: false, signal}));
      backend.assertSoulScope(scope);
      if (!Array.isArray(output.people) || output.people.length !== count) throw Error(`发现回复应包含 ${count} 人，本次未添加，请重试`);
      const candidates = output.people.map(raw => {
        const person = normalizeSoulCandidate({...raw, id: crypto.randomUUID(), incoming, nsfw: state.nsfw, requirements, at: Date.now(),
          accepted: false, ignored: false, persona: '', threadId: '', photoId: '', imageData: '', imageState: 'waiting'});
        if (!isValidRoleName(person.name) || !Number.isInteger(person.age) || person.age < 18 || person.age > 100000
          || !['男', '女', '扶她'].includes(person.gender) || !person.appearance || !person.bodyBuild || !person.outfit || !person.drawPrompt
          || !person.nickname || !person.species || !person.region || !person.occupation || !person.interests.length
          || !person.signature || !person.intro || !person.purpose || !person.preferences
          || person.name === context()?.name1
          || incoming && !person.greeting || excluded.includes(person.name)) throw Error('发现资料缺少成年身份、公开资料、外貌、服装或包含已知角色，本次未添加');
        return person;
      });
      await backend.soulAddCandidates(candidates, {incoming, scope});
      // Each candidate gets one image request. A failed/paid image stays as a visible retry card.
      for (const person of candidates) {
        backend.assertSoulScope(scope);
        try { await picture(person.id); } catch (error) { backend.assertSoulScope(scope); }
      }
      return backend.getSoul();
    });
  }
  function accept(id) {
    return run(`accept:${id}`, async (scope, signal) => {
      let state = backend.getSoul(), person = state.candidates.find(c => c.id === id);
      if (!person) throw Error('找不到这位角色');
      if (person.accepted) return backend.soulAdopt(id, scope);
      if (!person.persona) {
        const prompt = soulExpansionRequest(person, state);
        const raw = parseSoulJson(await backend.generateText(context(), {prompt, responseLength: 3000, trimNames: false, signal}));
        backend.assertSoulScope(scope);
        const persona = expandedSoulPersona(raw, person), greeting = person.incoming ? person.greeting : String(raw.greeting || '').trim().slice(0, 400);
        if (!greeting) throw Error('未生成初次招呼，请重试');
        person = await backend.soulPatchCandidate(id, {persona, greeting}, scope);
      }
      return backend.soulAdopt(id, scope);
    });
  }
  return {discover, picture, accept, busy, dispose() {
    unsubscribe?.();
    for (const {controller} of jobs.values()) controller.abort();
    jobs.clear();
  }};
}
