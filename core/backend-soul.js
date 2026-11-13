import {normalizeSoulSettings, normalizeSoulSession, normalizeSoulProfile, normalizeSoulCandidate,
  newSoulSession, soulPerson, soulChatPersona, SOUL_LIMIT} from './soul.js';
import {normalizeRoute} from './routes.js';
import {ensureTarget, syncXenoWithRoutes, effectiveEntityView} from './xeno.js';

export function installSoulBackend(Backend) {
  Object.assign(Backend.prototype, {
    soulScope() {
      return {chatKey: this.activeChatKey || '', cardKey: this.cardKey(), epoch: this.xenoChatEpoch || 0};
    },
    assertSoulScope(scope = this.soulScope()) {
      this.assertOpen();
      if (!scope.chatKey) throw Error('请先打开一段正文聊天，再使用 Soul');
      if (this.soulNavigating || scope.chatKey !== this.activeChatKey || scope.cardKey !== this.cardKey()
        || scope.epoch !== (this.xenoChatEpoch || 0) || this.deletedXenoChats?.has(scope.chatKey)) {
        throw Error('正文聊天已切换或删除，本次 Soul 操作未写入');
      }
    },
    getSoul() {
      if (this.soulSession?.chatKey !== this.activeChatKey) this.soulSession = newSoulSession(this.activeChatKey || '', this.settings.soul);
      return structuredClone(this.soulSession);
    },
    soulPerson(name) { return soulPerson(this.getSoul(), name); },
    soulPersonaFor(name) {
      const session = this.getSoul(), person = soulPerson(session, name);
      if (!person) return '';
      const route = this.routesHere().find(r => r.name === name), entity = this.settings.xeno.targets.find(t => t.name === name);
      const persona = soulChatPersona({...person, persona: route?.persona || person.persona}, session);
      if (!entity) return persona;
      const view = effectiveEntityView(this.settings.xeno, entity);
      return persona + '\n\n【你自己当前的外观与穿着】' + JSON.stringify({appearance: view.appearance, bodyBuild: view.bodyBuild,
        gender: view.gender, outfit: Object.fromEntries(['outerwear', 'underwear', 'privacyCover', 'accessories'].map(key => [key, entity.outfit[key]]))});
    },
    syncSoulPublicProfile(patch) {
      if (!this.activeChatKey || this.soulNavigating) return false;
      const soul = this.getSoul(); let changed = false;
      for (const [source, target] of [['name', 'nickname'], ['signature', 'signature']]) {
        if (patch.profile?.[source] !== undefined) {soul.profile[target] = String(patch.profile[source]).trim(); changed = true;}
      }
      if (patch.avatars && Object.hasOwn(patch.avatars, 'me')) {
        soul.profile.photoId = patch.avatars.me?.kind === 'photo' ? patch.avatars.me.photoId : ''; changed = true;
      }
      if (changed) this.soulSession = normalizeSoulSession(soul, this.activeChatKey, this.settings.soul);
      return changed;
    },
    async saveSoul(patch, scope = this.soulScope()) {
      this.assertSoulScope(scope);
      this.soulSession = normalizeSoulSession({...this.getSoul(), ...patch, chatKey: scope.chatKey}, scope.chatKey, this.settings.soul);
      this.emit('soul', {});
      await this.persistActiveChatXeno();
      return this.getSoul();
    },
    async saveSoulProfile(profile, {templateId = '', templateName = '', makeDefault = false, expectedChatKey = ''} = {}) {
      const scope = this.soulScope(); this.assertSoulScope(scope);
      if (expectedChatKey && expectedChatKey !== scope.chatKey) throw Error('正文聊天已切换，请重新打开公开主页');
      const clean = normalizeSoulProfile(profile);
      const config = normalizeSoulSettings(this.settings.soul);
      const firstSave = !config.templates.some(t => Object.values(t.profile).some(Boolean)) && Object.values(clean).some(Boolean);
      if (firstSave || templateId || templateName || makeDefault) {
        const next = this.getState();
        const id = templateId || (firstSave ? config.defaultTemplate : templateName ? crypto.randomUUID() : config.defaultTemplate);
        const index = config.templates.findIndex(t => t.id === id);
        const template = {id, name: String(templateName || config.templates[index]?.name || '我的主页').slice(0, 40), profile: clean};
        if (index >= 0) config.templates[index] = template;
        else {
          if (config.templates.length >= 8) throw Error('最多保存 8 个公开主页模板');
          config.templates.push(template);
        }
        if (makeDefault || firstSave) config.defaultTemplate = id;
        next.soul = config; this.save(next);
      }
      return this.saveSoul({profile: clean}, scope);
    },
    async soulPatchCandidate(id, patch, scope = this.soulScope()) {
      this.assertSoulScope(scope);
      const state = this.getSoul(), index = state.candidates.findIndex(c => c.id === id);
      if (index < 0) throw Error('这位角色已不在发现记录中');
      state.candidates[index] = normalizeSoulCandidate({...state.candidates[index], ...patch, id});
      await this.saveSoul({candidates: state.candidates}, scope);
      return structuredClone(state.candidates[index]);
    },
    async soulAddCandidates(candidates, {incoming = false, scope = this.soulScope()} = {}) {
      this.assertSoulScope(scope);
      const state = this.getSoul();
      if (state.candidates.length + candidates.length > SOUL_LIMIT) throw Error('发现记录已满，请先清理未认识的历史记录');
      const known = new Set([...this.contacts().map(c => c.name), ...this.routesHere().map(r => r.name), ...state.candidates.map(c => c.name)]);
      for (const c of candidates) {
        if (known.has(c.name)) throw Error('发现结果包含已认识或重复的人物，本次未添加，请刷新重试');
        known.add(c.name);
      }
      await this.saveSoul({candidates: [...candidates, ...state.candidates],
        ...(!incoming ? {batch: candidates.map(c => c.id)} : {})}, scope);
      return candidates;
    },
    async soulAdopt(id, scope = this.soulScope()) {
      this.assertSoulScope(scope);
      const state = this.getSoul(), person = state.candidates.find(c => c.id === id);
      if (!person) throw Error('找不到这位角色');
      if (person.accepted) {
        const threads = (await this.threads()).filter(t => t.type === 'dm' && t.members[0] === person.name);
        if (threads.length) return this.chats.get(threads[0].id);
        const thread = await this.chats.create({type: 'dm', members: [person.name], space: scope.cardKey, storyChatKey: scope.chatKey});
        try {
          this.assertSoulScope(scope);
          const saved = await this.chats.append(thread.id, [{kind: 'text', from: person.name, text: person.greeting}]);
          await this.soulPatchCandidate(id, {threadId: thread.id}, scope);
          this.emit('chat', {threadId: thread.id}); return saved;
        } catch (error) { await this.chats.remove(thread.id).catch(() => {}); throw error; }
      }
      if (!person.persona || !person.greeting) throw Error('完整人设或初次招呼尚未生成');
      if (this.routesHere().some(r => r.name === person.name) || this.contacts().some(c => c.name === person.name)) throw Error('已有同名角色，请先调整人物资料');
      if (this.settings.xeno.targets.length >= 60) throw Error('角色状态记录已满，请先整理角色');
      let thread;
      try {
        thread = await this.chats.create({type: 'dm', members: [person.name], space: scope.cardKey, storyChatKey: scope.chatKey});
        this.assertSoulScope(scope);
        thread = await this.chats.append(thread.id, [{kind: 'text', from: person.name, text: person.greeting}]);
        this.assertSoulScope(scope);
        const next = this.getState(), route = normalizeRoute({id: crypto.randomUUID(), name: person.name, roleType: 'normal',
          card: scope.cardKey, persona: person.persona, appearance: person.appearance, engine: 'fish', voice: ''});
        next.routes.push(route);
        next.xeno = syncXenoWithRoutes(next.xeno, next.routes.filter(r => r.card === scope.cardKey), scope.cardKey);
        const entity = ensureTarget(next.xeno, person.name);
        Object.assign(entity, {identity: person.occupation, gender: person.gender, appearance: person.appearance,
          bodyBuild: person.bodyBuild, portraitData: person.imageData || ''});
        entity.outfit.outerwear = person.outfit;
        person.accepted = true; person.threadId = thread.id;
        this.soulSession = state;
        this.save(next);
      } catch (error) {
        if (thread?.id) await this.chats.remove(thread.id).catch(() => {});
        if (this.activeChatKey === scope.chatKey) this.soulSession = normalizeSoulSession({...state,
          candidates: state.candidates.map(c => c.id === id ? {...c, accepted: false, threadId: ''} : c)}, scope.chatKey, this.settings.soul);
        throw error;
      }
      await this.persistActiveChatXeno();
      this.emit('soul', {}); this.emit('chat', {threadId: thread.id}); this.emit('xeno', {});
      return thread;
    },
    async soulClearHistory() {
      const state = this.getSoul(), candidates = state.candidates.filter(c => c.accepted);
      return this.saveSoul({candidates, batch: []});
    },
    async soulThread(id) {
      const thread = await this.chats.get(id);
      if (thread?.storyChatKey && thread.storyChatKey !== this.activeChatKey) throw Error('这段 Soul 私聊属于另一段正文聊天');
      return thread;
    },
    async soulSnapshot(payload) {
      // Use the key captured by the caller, never whatever chat happens to be open after await.
      const threads = await this.chats?.exportThreads?.();
      if (Array.isArray(threads)) payload.soulThreads = threads.filter(t => t.storyChatKey === payload.chatKey);
      return payload;
    },
    async loadSoulSnapshot(record, chatKey, {hasHistory = false, current = () => true} = {}) {
      const state = normalizeSoulSession(record?.soul, chatKey, this.settings.soul);
      if (this.chats?.importThreads && Array.isArray(record?.soulThreads)) {
        const local = new Map((await this.chats.exportThreads()).map(t => [t.id, t]));
        const incoming = record.soulThreads.filter(t => t.storyChatKey === chatKey
          && (!local.has(t.id) || (local.get(t.id).updatedAt || 0) < (t.updatedAt || 0)));
        if (!current()) return;
        if (incoming.length) await this.chats.importThreads(incoming);
      }
      if (!record?.soul && hasHistory && this.chats?.exportThreads) {
        const legacy = (await this.chats.exportThreads()).filter(t => !t.storyChatKey && t.space === this.cardKey());
        if (!current()) return;
        for (const t of legacy) await this.chats.update(t.id, {storyChatKey: chatKey});
      }
      for (const c of state.candidates) {
        if (!c.imageData || !this.library?.getPhoto) continue;
        const photo = c.photoId && await this.library.getPhoto(c.photoId).catch(() => null);
        if (!current()) return;
        if (!photo) {
          const bytes = Uint8Array.from(atob(c.imageData.split(',')[1]), ch => ch.charCodeAt(0));
          const restored = await this.library.addPhoto({name: `Soul-${c.name}.jpg`, blob: new Blob([bytes], {type: 'image/jpeg'})});
          c.photoId = restored.id;
        }
      }
      if (current()) this.soulSession = state;
    },
    async legacySoulThreads() {
      return (await this.chats.list()).filter(t => !t.storyChatKey && (!t.space || t.space === this.cardKey()));
    },
    async importLegacySoulThread(id, {expectedChatKey = ''} = {}) {
      const scope = this.soulScope(); this.assertSoulScope(scope);
      if (expectedChatKey && expectedChatKey !== scope.chatKey) throw Error('正文聊天已切换，请重新打开旧版资料入口');
      const legacy = await this.chats.get(id);
      if (!legacy || legacy.storyChatKey || legacy.space && legacy.space !== scope.cardKey) throw Error('找不到可导入的旧版对话');
      const newId = `${id}:soul:${encodeURIComponent(scope.chatKey)}`.slice(0, 512);
      const existing = await this.chats.get(newId);
      if (existing) return existing;
      this.assertSoulScope(scope);
      await this.chats.importThreads([{...legacy, id: newId, storyChatKey: scope.chatKey}]);
      await this.persistActiveChatXeno(scope.chatKey); this.emit('chat', {});
      return this.chats.get(newId);
    }
  });
}
