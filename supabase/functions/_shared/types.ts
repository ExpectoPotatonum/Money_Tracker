// Shared types across the Edge Functions. DB text columns with check
// constraints are mapped to discriminated unions here so typos fail at
// compile time instead of at 2am when a row silently falls through a branch
// (ARCHITECTURE.md §4).

export type ParseStatus =
  | "pending"
  | "success"
  | "failed"
  | "needs_review"
  | "ignored";

export type Direction = "debit" | "credit";

export type Confidence = "high" | "medium" | "low";

export type TransactionStatus =
  | "confirmed"
  | "needs_review"
  | "duplicate"
  | "ignored";

/** A parser_templates row, as it arrives from Postgres. */
export interface ParserTemplate {
  id: string;
  package_name: string;
  app_label: string;
  version: number;
  active: boolean;
  title_pattern: string | null;
  body_pattern: string;
  date_format: string | null;
  default_currency: string;
  sample_input: string | null;
  notes: string | null;
}

/** The four text fields §8's redaction pass leaves in a synced row. */
export interface SanitizedText {
  title?: string | null;
  text_body?: string | null;
  big_text?: string | null;
  sub_text?: string | null;
}

/** The structured result of parsing one sanitized notification. */
export interface ParsedFields {
  amount: number;
  currency: string;
  direction: Direction;
  merchant_raw: string | null;
  /** raw captured txn_date group (if any) — parsed via date_format downstream */
  txn_date: string | null;
  /** true = strict template matched; false = loose per-currency fallback */
  matchedTemplate: boolean;
}

/** A merchant_rules row. */
export interface MerchantRule {
  id: string;
  match_pattern: string;
  match_type: "exact" | "contains" | "regex";
  normalized_name: string;
  category_id: string | null;
  priority: number;
}

export interface MerchantResolution {
  merchant_display: string;
  category_id: string | null;
}

/** The Database Webhook body for an inserted raw_notifications row. */
export interface RawNotificationInsertEvent {
  type: string;
  table: string;
  schema: string;
  record: {
    id: string;
    user_id: string;
    client_uuid: string;
    device_id: string;
    package_name: string;
    app_label: string | null;
    title: string | null;
    text_body: string | null;
    big_text: string | null;
    sub_text: string | null;
    posted_at: string;
    redactions_applied: string[];
  };
}

/** Redaction category names — must match what the Android redactor reports. */
export type RedactionCategory = "otp" | "balance" | "account";
