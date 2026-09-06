// Settings persisted in localStorage. Everything here is browser-local (the
// LLM key never leaves the visitor's machine, matching the Q2 choice —
// dashboard-side escalation, same trust model as the anon key).
const KEYS = {
  llmKey: 'mt_llm_key',
  llmModel: 'mt_llm_model',
  llmEnabled: 'mt_llm_parse_enabled',
  lang: 'mt_lang',
};

export const DEFAULT_MODEL = 'gemini-2.5-flash';

export function getSettings() {
  return {
    llmKey: localStorage.getItem(KEYS.llmKey) ?? '',
    llmModel: localStorage.getItem(KEYS.llmModel) || DEFAULT_MODEL,
    llmEnabled: localStorage.getItem(KEYS.llmEnabled) !== '0',
    lang: localStorage.getItem(KEYS.lang) || 'en',
  };
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  if (patch.llmKey !== undefined) localStorage.setItem(KEYS.llmKey, next.llmKey.trim());
  if (patch.llmModel !== undefined) localStorage.setItem(KEYS.llmModel, next.llmModel.trim());
  if (patch.llmEnabled !== undefined)
    localStorage.setItem(KEYS.llmEnabled, next.llmEnabled ? '1' : '0');
  if (patch.lang !== undefined) localStorage.setItem(KEYS.lang, next.lang);
  return next;
}
