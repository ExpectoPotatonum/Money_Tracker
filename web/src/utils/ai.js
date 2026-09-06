// Orchestration: context-injected prompt -> LLM -> tolerant JSON parse ->
// normalized transaction draft. Pure of any UI. Returns { draft, error } so
// callers can tell "LLM never answered" (surfaced as a diagnostic) apart from
// "LLM answered but no usable transaction" (the existing gentle reword prompt).
import { callLlm } from './llm.js';
import { extractJsonObject } from './json5.js';
import { buildNlPrompt, buildEscalationPrompt } from './prompts.js';
import { currencyOptions } from './format.js';
import { t } from '../lib/i18n.js';

const DIRECTIONS = new Set(['debit', 'credit']);

function categoryIdForName(name, categoryNames) {
  if (!name) return null;
  for (const [id, label] of categoryNames) {
    if (label === name) return id;
  }
  return null;
}

function normalize(raw, categoryNames) {
  const usable = raw?.usable === true || raw?.usable === 'true';
  if (!raw || !usable) return null;

  const amount = Number(raw.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const direction = String(raw.direction ?? '').toLowerCase();
  if (!DIRECTIONS.has(direction)) return null;

  let currency = String(raw.currency ?? 'MYR')
    .toUpperCase()
    .trim();
  if (!currencyOptions().includes(currency)) currency = 'MYR';

  let transaction_date = new Date(raw.transaction_date ?? Date.now());
  if (Number.isNaN(transaction_date.getTime())) transaction_date = new Date();

  return {
    amount: Math.round(amount * 100) / 100,
    direction,
    currency,
    merchant_raw: raw.merchant_raw ? String(raw.merchant_raw).slice(0, 255) : null,
    category_id: categoryIdForName(raw.category, categoryNames),
    transaction_date: transaction_date.toISOString(),
    notes: raw.notes ? String(raw.notes).slice(0, 255) : null,
  };
}

// Localized failure text for a { code, kind } error from the functions below.
// 'notransaction' keeps the gentle generic wording; 'llm' failures are specific
// so a dead model or quota doesn't look like a wording problem.
export function llmErrorMessage(error) {
  if (error?.code !== 'llm') return t('nl.failed');
  const key =
    error.kind === 'network' || error.kind === 'config'
      ? 'ai.error.network'
      : error.kind === 'model'
        ? 'ai.error.model'
        : error.kind === 'quota'
          ? 'ai.error.quota'
          : error.kind === 'empty'
            ? 'ai.error.empty'
            : 'ai.error.generic';
  return t(key).replace('{status}', String(error.status ?? ''));
}

// NL bookkeeping (Phase B): a freeform sentence -> one transaction.
export async function parseTransactionText(userText, categoryNames) {
  const prompt = buildNlPrompt(userText, [...categoryNames.values()], currencyOptions());
  const res = await callLlm(prompt);
  if (!res.ok) return { draft: null, error: { code: 'llm', ...res } };
  const draft = normalize(extractJsonObject(res.text), categoryNames);
  return draft
    ? { draft, error: null }
    : { draft: null, error: { code: 'notransaction' } };
}

// Review-inbox escalation (Phase C): a failed/needs_review raw_notifications
// row -> a transaction (or an error when the LLM itself failed to answer).
export async function parseNotificationTransaction(row, categoryNames) {
  const prompt = buildEscalationPrompt(row, [...categoryNames.values()], currencyOptions());
  const res = await callLlm(prompt);
  if (!res.ok) return { draft: null, error: { code: 'llm', ...res } };
  const draft = normalize(extractJsonObject(res.text), categoryNames);
  return draft
    ? { draft, error: null }
    : { draft: null, error: { code: 'notransaction' } };
}
