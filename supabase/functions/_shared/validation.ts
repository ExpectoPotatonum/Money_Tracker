// Shape validation for untrusted inputs. The webhook payload is the app's own
// pipeline, but a malformed row shouldn't crash the function or silently write
// garbage (ARCHITECTURE.md §4). These are deliberately loose structural checks
// — a record is *well-formed enough to attempt parsing*, not guaranteed good.

import type {
  ParserTemplate,
  RawNotificationInsertEvent,
  SanitizedText,
} from "./types.ts";

export function isRawNotificationInsertEvent(
  value: unknown,
): value is RawNotificationInsertEvent {
  if (typeof value !== "object" || value === null) return false;
  const record = (value as Record<string, unknown>).record;
  if (typeof record !== "object" || record === null) return false;
  const r = record as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.package_name === "string" &&
    typeof r.client_uuid === "string"
  );
}

/** Collects the four redaction-relevant text fields from a row. */
export function textFromRow(
  record: RawNotificationInsertEvent["record"],
): SanitizedText {
  return {
    title: record.title,
    text_body: record.text_body,
    big_text: record.big_text,
    sub_text: record.sub_text,
  };
}

const CURRENCY_RE = /^[A-Z]{3}$/;
const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;

export function isParserTemplate(value: unknown): value is ParserTemplate {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.id === "string" &&
    typeof t.package_name === "string" &&
    typeof t.body_pattern === "string" &&
    (typeof t.title_pattern === "string" || t.title_pattern === null) &&
    typeof t.default_currency === "string" &&
    CURRENCY_RE.test(t.default_currency)
  );
}

export function isAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) &&
    AMOUNT_RE.test(String(value));
}
