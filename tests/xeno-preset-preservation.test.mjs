import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultXenoPreset, normalizeXenoPreset, normalizeXeno} from '../core/xeno.js';
import {TTSBackend} from '../core/backend.js';

const legacyTexts = {
  autoSync: '1. 当本轮剧情中有【新登场的女性/扶她重要角色】首次亮相\n自定义：仅同步剧情明确提及的外观。',
  syncPrompt: '你是【异构终端】的实时状态栏提取引擎。请根据最新剧情与角色设定\n自定义：保留未发生变化的衣物记录。'
};

test('保存与重新载入保留含旧版片段的自定义同步规则', () => {
  let state = normalizeXeno({});
  const draft = defaultXenoPreset();
  for (const entry of draft.entries) if (legacyTexts[entry.id]) entry.text = legacyTexts[entry.id];
  const before = structuredClone(draft);
  const backend = {saveXeno(update) {state = normalizeXeno(update(structuredClone(state)));}};
  const saved = TTSBackend.prototype.saveXenoPreset.call(backend, draft);
  const reloaded = normalizeXeno(JSON.parse(JSON.stringify(state)));
  for (const preset of [saved, reloaded.presets.find(p => p.id === draft.id), normalizeXenoPreset(saved)]) {
    for (const [id, text] of Object.entries(legacyTexts)) {
      assert.equal(preset.entries.find(entry => entry.id === id).text, text);
    }
  }
  assert.deepEqual(draft, before);
});

test('关闭与清空的同步条目保留，缺失条目仍补默认值', () => {
  const draft = defaultXenoPreset();
  draft.entries.find(entry => entry.id === 'autoSync').enabled = false;
  draft.entries.find(entry => entry.id === 'autoSync').text = legacyTexts.autoSync;
  draft.entries.find(entry => entry.id === 'syncPrompt').text = '';
  const normalized = normalizeXenoPreset(draft);
  assert.equal(normalized.entries.find(entry => entry.id === 'autoSync').enabled, false);
  assert.equal(normalized.entries.find(entry => entry.id === 'autoSync').text, legacyTexts.autoSync);
  assert.equal(normalized.entries.find(entry => entry.id === 'syncPrompt').text, '');
  const missing = normalizeXenoPreset({...draft, entries: []});
  for (const id of Object.keys(legacyTexts)) {
    assert.equal(missing.entries.find(entry => entry.id === id).text,
      defaultXenoPreset().entries.find(entry => entry.id === id).text);
  }
});
