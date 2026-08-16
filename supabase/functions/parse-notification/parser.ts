// parser.ts — the pure parsing function. No DB, no network, no IO.
// This is the regression-test target: (sanitizedText, template) -> fields|null,
// which is exactly what the replay-templates harness calls in a loop
// (ARCHITECTURE.md §4).

import type {
  Direction,
  ParsedFields,
  ParserTemplate,
  SanitizedText,
} from "../_shared/types.ts";

// Keyword sets are data, not per-package branches. They drive both the loose
// fallback's direction inference and the direction-defaulting when a strict
// template didn't capture a `direction` group.
const CREDIT_WORDS = [
  "received",
  "credited",
  "credit",
  "top-up",
  "top up",
  "cashback",
  "refund",
  "deposit",
  "transfer in",
  "added",
];
const DEBIT_WORDS = [
  "debited",
  "debit",
  "paid",
  "payment",
  "charged",
  "spent",
  "purchase",
  "deducted",
  "withdrawn",
  "transfer out",
  "sent",
];

/** Symbols/keywords that signal each currency in free text (loose fallback). */
const LOOSE_CURRENCIES: Record<string, string[]> = {
  MYR: ["RM", "MYR"],
  USD: ["USD", "US\\$", "\\$"],
  CNY: ["CNY", "CN¥", "¥"],
  SGD: ["SGD", "S\\$"],
  EUR: ["EUR", "€"],
  GBP: ["GBP", "£"],
  JPY: ["JPY", "¥"],
};

export function parseNotification(
  text: SanitizedText,
  template: ParserTemplate,
): ParsedFields | null {
  const body = bodyText(text);
  if (!body) return null;

  const bodyMatch = matchPattern(template.body_pattern, body);
  const titleOk = titleMatches(template.title_pattern, text.title ?? "");
  if (bodyMatch && titleOk) {
    return fromGroups(bodyMatch.groups ?? {}, body, template, true);
  }
  return looseParse(body);
}

/** Strict template match — all fields come from the named groups. */
function fromGroups(
  groups: Record<string, string>,
  body: string,
  template: ParserTemplate,
  matchedTemplate: boolean,
): ParsedFields | null {
  const amountRaw = groups["amount"];
  if (!amountRaw) return null; // no amount -> not a parseable transaction

  const amount = parseAmount(amountRaw);
  if (amount === null) return null;

  const currency = (groups["currency"] ?? template.default_currency)
    .toUpperCase();
  const merchant = groups["merchant"] || null;
  const txnDate = groups["txn_date"] || null;
  const direction = directionFrom(groups["direction"], body);

  return {
    amount,
    currency,
    direction,
    merchant_raw: merchant,
    txn_date: txnDate,
    matchedTemplate,
  };
}

/**
 * Loose per-currency fallback (agents.md §6): no strict template matched, so
 * look for a currency-amount token anywhere and let confidence = low drive the
 * needs_review status. Merchant is deliberately unresolvable here — sending
 * `merchant_raw: null` to the review inbox is the whole point.
 */
function looseParse(body: string): ParsedFields | null {
  for (const code of Object.keys(LOOSE_CURRENCIES)) {
    const m = looseCurrencyRe(code).exec(body);
    if (!m) continue;
    const amount = parseAmount(m.groups?.["amtA"] ?? m.groups?.["amtB"] ?? "");
    if (amount === null) continue;
    const direction = directionFrom(undefined, body);
    return {
      amount,
      currency: code,
      direction,
      merchant_raw: null,
      txn_date: null,
      matchedTemplate: false,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The body text the template matches against: fullest field wins. */
export function bodyText(text: SanitizedText): string {
  return text.big_text ?? text.text_body ?? text.sub_text ?? "";
}

export function matchPattern(
  pattern: string,
  haystack: string,
): RegExpExecArray | null {
  if (!pattern || !haystack) return null;
  try {
    return new RegExp(pattern, "i").exec(haystack);
  } catch {
    return null; // a malformed stored pattern must fail parsing, not the function
  }
}

function titleMatches(titlePattern: string | null, title: string): boolean {
  if (!titlePattern) return true; // optional constraint
  return matchPattern(titlePattern, title) !== null;
}

export function parseAmount(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[, ]/g, "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function directionFrom(
  groupValue: string | undefined,
  text: string,
): Direction {
  if (groupValue) {
    const v = groupValue.toLowerCase();
    if (/credit|receive|top.?up|refund|cashback|deposit|transfer.?in/.test(v)) {
      return "credit";
    }
    if (/debit|pay|spend|charge|withdraw|transfer.?out/.test(v)) return "debit";
  }
  const lower = text.toLowerCase();
  for (const word of CREDIT_WORDS) if (lower.includes(word)) return "credit";
  for (const word of DEBIT_WORDS) if (lower.includes(word)) return "debit";
  return "debit"; // conservative default: most notifications are spends
}

function looseCurrencyRe(code: string): RegExp {
  const alternatives = LOOSE_CURRENCIES[code].join("|");
  return new RegExp(
    `(?:(?:${alternatives})\\s*(?<amtA>[\\d,]+(?:\\.[\\d]{1,2})?)|(?<amtB>[\\d,]+(?:\\.[\\d]{1,2})?)\\s*(?:${alternatives}))`,
    "i",
  );
}

// ---------------------------------------------------------------------------
// Date parsing from a template's date_format (pure, table of tokens)
// ---------------------------------------------------------------------------

const TOKEN_PATTERNS: Record<string, string> = {
  yyyy: "\\d{4}",
  MM: "\\d{1,2}",
  dd: "\\d{1,2}",
  HH: "\\d{1,2}",
  mm: "\\d{2}",
  ss: "\\d{2}",
};
const TOKENS = Object.keys(TOKEN_PATTERNS).sort((a, b) => b.length - a.length);

export function parseDateFromFormat(
  raw: string | null,
  format: string | null,
): Date | null {
  if (!raw || !format) return null;
  const tokens: string[] = [];
  let pattern = "^";
  let i = 0;
  while (i < format.length) {
    const token = TOKENS.find((t) => format.startsWith(t, i));
    if (token) {
      pattern += `(${TOKEN_PATTERNS[token]})`; // capture group per token — match[i+1] aligns with tokens[]
      tokens.push(token);
      i += token.length;
    } else {
      pattern += format[i]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i += 1;
    }
  }
  pattern += "$";

  const match = new RegExp(pattern).exec(raw);
  if (!match) return null;

  const values: Record<string, number> = {};
  tokens.forEach((token, idx) => {
    values[token] = parseInt(match[idx + 1]!, 10);
  });

  const date = new Date(Date.UTC(
    values["yyyy"] ?? 1970,
    (values["MM"] ?? 1) - 1,
    values["dd"] ?? 1,
    values["HH"] ?? 0,
    values["mm"] ?? 0,
    values["ss"] ?? 0,
  ));
  return Number.isNaN(date.getTime()) ? null : date;
}
