// Orchestration: context-injected prompt -> LLM -> tolerant JSON parse ->
// normalized transaction draft. Pure of any UI. Returns null when the text was
// noise, the model replied nonsense, or no usable transaction was extracted.
import { callLlm } from './llm.js';
import { extractJsonObject } from './json5.js';
import { buildNlPrompt, buildEscalationPrompt } from './prompts.js';
import { currencyOptions } from './format.js';

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

// NL bookkeeping (Phase B): a freeform sentence -> one transaction.
export async function parseTransactionText(userText, categoryNames) {
  const prompt = buildNlPrompt(userText, [...categoryNames.values()], currencyOptions());
  return normalize(extractJsonObject(await callLlm(prompt)), categoryNames);
}

// Review-inbox escalation (Phase C): a failed/needs_review raw_notifications
// row -> a transaction (or null when the LLM deems it noise).
export async function parseNotificationTransaction(row, categoryNames) {
  const prompt = buildEscalationPrompt(row, [...categoryNames.values()], currencyOptions());
  return normalize(extractJsonObject(await callLlm(prompt)), categoryNames);
}
