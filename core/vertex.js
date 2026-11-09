export function vertexSettings(context = globalThis.SillyTavern?.getContext?.()) {
  const connection = context?.chatCompletionSettings;
  if (connection?.chat_completion_source !== 'vertexai') throw Error('请先在酒馆的 API 连接中选择并配置 Google Vertex AI');
  if (connection.reverse_proxy?.trim()) throw Error('当前 Vertex 连接使用反向代理，请使用 OpenAI 兼容渠道配置对应中转');
  return {
    provider: 'vertexai',
    model: String(connection.vertexai_model || ''),
    vertexAuthMode: connection.vertexai_auth_mode === 'full' ? 'full' : 'express',
    vertexRegion: String(connection.vertexai_region || 'global'),
    vertexSecretId: String(connection.secret_id || '')
  };
}

export function vertexModels(text, context = globalThis.SillyTavern?.getContext?.(), document = globalThis.document) {
  const models = new Set();
  const add = (value, mode) => {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9][\w./:@-]*$/.test(value.trim())) return;
    if (text.vertexAuthMode === 'express' && (mode === 'full' || /^claude-/i.test(value))) return;
    models.add(value.trim());
  };
  for (const option of document?.querySelectorAll?.('#model_vertexai_select option') || []) add(option.value, option.dataset?.mode);
  const connection = context?.chatCompletionSettings;
  const custom = connection?.custom_models_by_source?.vertexai;
  if (Array.isArray(custom)) for (const model of custom) add(model);
  add(connection?.vertexai_model);
  add(text.model);
  if (!models.size) throw Error('未找到酒馆的 Vertex 模型列表，可以直接手动填写模型名');
  return [...models].sort();
}

export function vertexBody(text, messages, maxTokens) {
  if (!text.model?.trim()) throw Error('请先填写 Vertex 模型名');
  if (text.vertexAuthMode === 'express' && /^claude-/i.test(text.model)) throw Error('Vertex 的 Claude 模型需要使用完整认证');
  return {
    chat_completion_source: 'vertexai',
    vertexai_auth_mode: text.vertexAuthMode === 'full' ? 'full' : 'express',
    vertexai_region: text.vertexRegion?.trim() || 'global',
    ...(text.vertexSecretId?.trim() ? {secret_id: text.vertexSecretId.trim()} : {}),
    model: text.model.trim(), messages, max_tokens: maxTokens, temperature: text.temperature,
    use_sysprompt: true, tool_choice: 'none', request_images: false, enable_web_search: false,
    ...(text.thinking === 'off' ? {reasoning_effort: 'min'} : {})
  };
}

export function vertexReply(json) {
  const candidate = json?.candidates?.[0];
  const parts = candidate?.content?.parts || candidate?.output?.parts;
  return Array.isArray(parts) ? parts.filter(part => part?.thought !== true && typeof part?.text === 'string').map(part => part.text).join('') : '';
}
