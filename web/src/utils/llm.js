// Thin Gemini wrapper (Q4: single provider behind a ~40-line interface —
// swapping providers later means a new backend here, no call-site changes).
// Returns a structured result, never throws:
//   { ok: true,  text }          — model replied
//   { ok: false, kind, status }  — kind: 'network' (offline/timeout, status 0),
//                                  'model' (dev name 404/retired, status 404),
//                                  'quota' (429/403), 'http' (other status),
//                                  'empty' (200 but no candidate text)
// Callers surface the reason -- "model unavailable", "rate limit", "offline" --
// instead of a generic "could not parse". If the configured model name is dead
// (Google retires flash preview names periodically), transparently retries once
// with DEFAULT_MODEL. Dedupes concurrent calls for the same prompt and never
// stores the key outside localStorage (Q2: dashboard-side escalation).
import { DEFAULT_MODEL, getSettings } from '../lib/settings.js';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 45_000;
const MAX_RESPONSE_CHARS = 8192;

const pending = new Map();

export function llmConfigured() {
  return Boolean(getSettings().llmKey);
}

export async function callLlm(prompt) {
  const settings = getSettings();
  if (!settings.llmKey || !settings.llmEnabled) {
    return { ok: false, kind: 'config', status: 0 };
  }

  const key = `${settings.llmModel}\u0000${prompt}`;
  if (pending.has(key)) return pending.get(key);

  const task = doCall(settings, prompt).finally(() => pending.delete(key));
  pending.set(key, task);
  return task;
}

async function doCall(settings, prompt) {
  const model = settings.llmModel || DEFAULT_MODEL;
  let result = await singleCall(model, settings.llmKey, prompt);
  const modelNotFound = result.status === 404 && model !== DEFAULT_MODEL;
  if (modelNotFound) {
    console.warn('llm model not found — retrying with default', DEFAULT_MODEL);
    result = await singleCall(DEFAULT_MODEL, settings.llmKey, prompt);
  }
  return classify(result);
}

function classify(result) {
  if (result.ok) return result;
  if (result.status === 404) return { ...result, kind: 'model' };
  if (result.status === 429 || result.status === 403) return { ...result, kind: 'quota' };
  if (result.status === 0) return { ...result, kind: 'network' };
  if (result.kind === 'empty') return result;
  return { ...result, kind: 'http' };
}

function singleCall(model, key, prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), TIMEOUT_MS);
  const url =
    `${ENDPOINT}/${encodeURIComponent(model)}:generateContent` +
    `?key=${encodeURIComponent(key)}`;
  return fetch(url, {
    method: 'POST',
    signal: controller.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1 },
    }),
  })
    .then(async (res) => {
      if (!res.ok) {
        const reason = (await res.text().catch(() => '')).slice(0, 160);
        console.warn('llm request failed', res.status, reason);
        return { ok: false, text: null, status: res.status, reason };
      }
      const data = await res.json();
      const parts = data?.candidates?.[0]?.content?.parts;
      const text = Array.isArray(parts) ? parts.map((p) => p.text ?? '').join('') : '';
      if (!text) {
        console.warn('llm returned an empty reply');
        return { ok: false, text: null, status: 200, reason: 'empty reply', kind: 'empty' };
      }
      return { ok: true, text: text.slice(0, MAX_RESPONSE_CHARS), status: 200 };
    })
    .catch((err) => {
      if (err?.name === 'AbortError') {
        console.warn('llm request timed out');
        return { ok: false, text: null, status: 0, reason: 'timeout' };
      }
      console.warn('llm request failed to reach provider', err);
      return { ok: false, text: null, status: 0, reason: String(err?.message ?? err) };
    })
    .finally(() => clearTimeout(timer));
}