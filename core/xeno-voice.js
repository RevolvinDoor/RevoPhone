const engines = ['fish', 'mini', 'eleven', 'mimo', 'doubao', 'custom'];
const text = (value, limit) => String(value || '').trim().slice(0, limit);

export function voiceDescriptor(raw) {
  if (!raw || !engines.includes(raw.engine) || !text(raw.voice, 2000)) return null;
  return {
    engine: raw.engine, voice: text(raw.voice, 2000), model: text(raw.model, 120),
    name: text(raw.name || raw.voice, 120), language: text(raw.language, 40)
  };
}

export function encodeBoundVoiceRef(raw) {
  const voice = voiceDescriptor(raw);
  return voice ? `voice:${JSON.stringify(voice)}` : '';
}

export function parseBoundVoiceRef(ref) {
  if (typeof ref !== 'string' || !ref.startsWith('voice:')) return null;
  try { return voiceDescriptor(JSON.parse(ref.slice(6))); } catch { return null; }
}
