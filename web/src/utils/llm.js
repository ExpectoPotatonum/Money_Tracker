// Thin Gemini "flash free tier" wrapper (Q4: single provider behind a ~30-line
// interface — swapping providers later means a new backend here, no call-site
// changes). Loses to null on any failure (quota, timeout, malformed reply —
// matching the FX utils' always-degrade-not-throw convention), dedupes
// concurrent calls for the same prompt, and never stores the key outside
// localStorage (Q2: dashboard-side escalation).
import { getSettings } from '../lib/settings.js';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 45_000;
const MAX_RESPONSE_CHARS = 8192;

const pending = new Map();

export function llmConfigured() {
  return Boolean(getSettings().llmKey);
}

export async function callLlm(prompt) {
  const settings = getSettings();
  if (!settings.llmKey || !settings.llmEnabled) return null;

  const key = `${settings.llmModel}\u0000${prompt}`;
  if (pending.has(key)) return pending.get(key);

  const task = doCall(settings, prompt).finally(() => pending.delete(key));
  pending.set(key, task);
  return task;
}

async function doCall(settings, prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), TIMEOUT_MS);
  try {
    const url =
      `${ENDPOINT}/${encodeURIComponent(settings.llmModel)}:generateContent` +
      `?key=${encodeURIComponent(settings.llmKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1 },
      }),
    });
    if (!res.ok) {
      console.warn(
        'llm request failed',
        res.status,
        (await res.text().catch(() => '')).slice(0, 160),
      );
      return null;
    }
    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts) ? parts.map((p) => p.text ?? '').join('') : '';
    return text ? text.slice(0, MAX_RESPONSE_CHARS) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
