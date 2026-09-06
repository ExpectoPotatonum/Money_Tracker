// Prompt construction for the LLM. Context injection is the whole game here
// (pattern borrowed from ezBookkeeping's templates/prompt/*.tmpl): the model
// answers against the user's real categories/currencies rather than guessing,
// and the reply is crammed into one strict JSON object that loadJson parses.
import { currencyOptions } from '../utils/format.js';

const MY_TIMEZONE = 'Asia/Kuala_Lumpur';
const DAY_MS = 86_400_000;

function myDate(offsetMs = 0) {
  const d = new Date(Date.now() + offsetMs);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MY_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function jsonContract(categoryNames, currencies) {
  const categories = categoryNames?.length ? categoryNames : ['(none configured)'];
  const currencyCodes = currencies?.length ? currencies : currencyOptions();
  return [
    'Reply with ONLY a single JSON object — no markdown fences, no prose, no commentary.',
    '',
    'Rules:',
    '- amount: positive number (the transaction amount).',
    `- currency: 3-letter ISO code from this list: ${currencyCodes.join(', ')}. Default "MYR".`,
    '- direction: "debit" if money left (paid / spent / transferred out); "credit" if money came in (received / salary / refund / cashback / gift).',
    '- merchant_raw: the other party (payee or sender), as typed.',
    `- category: exactly one name from this list: ${categories.join(', ')} — or null if unsure.`,
    `- transaction_date: ISO 8601 with +08:00 offset (Asia/Kuala_Lumpur). Today is ${myDate()}.`,
    '- notes: a short note, or null.',
    '- usable: true if this contains a real transaction; false if it is noise (e.g. marketing, a balance reminder, or nothing extractable).',
    '',
    'JSON shape:',
    '{"usable": true, "amount": 12.34, "currency": "MYR", "direction": "debit", "merchant_raw": "Example", "category": "Food & Dining", "transaction_date": "2026-09-06T10:00:00+08:00", "notes": null}',
  ].join('\n');
}

export function buildNlPrompt(userText, categoryNames, currencies) {
  return [
    'You are a bookkeeping assistant. Convert the sentence below into one transaction.',
    jsonContract(categoryNames, currencies),
    '',
    'Sentence:',
    `"""${userText}"""`,
  ].join('\n');
}

export function buildEscalationPrompt(row, categoryNames, currencies) {
  const title = row.title ? `Title: ${row.title}` : '';
  const body = row.big_text ?? row.text_body ?? row.sub_text ?? '';
  return [
    'This is a mobile banking/e-wallet notification that our regex parsers could not handle. Extract the transaction it describes, if any. The text has already been redacted on-device (OTPs, balances, and account numbers are replaced with placeholders).',
    jsonContract(categoryNames, currencies),
    '',
    `App: ${row.app_label ?? row.package_name}`,
    title,
    `Body: ${body}`,
    '',
    'If this notification is not about an actual money movement (marketing, rewards points, voucher), set "usable" to false.',
  ].join('\n');
}

export { MY_TIMEZONE, DAY_MS };
