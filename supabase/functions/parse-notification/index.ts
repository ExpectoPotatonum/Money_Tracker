// parse-notification — thin webhook entry point (ARCHITECTURE.md §4).
// Its only job: read the Database Webhook payload, call the pure functions
// (parser.ts, merchantResolver.ts, redactionSpotCheck.ts), write the result.
// No parsing logic lives inline here.

import { adminClient } from "../_shared/db.ts";
import {
  isRawNotificationInsertEvent,
  textFromRow,
} from "../_shared/validation.ts";
import type { Confidence, TransactionStatus } from "../_shared/types.ts";
import { parseDateFromFormat, parseNotification } from "./parser.ts";
import { resolveMerchant } from "./merchantResolver.ts";
import { redactionSpotCheck } from "./redactionSpotCheck.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  let event: unknown;
  try {
    event = await req.json();
  } catch {
    return new Response("invalid json", { status: 400 });
  }
  if (!isRawNotificationInsertEvent(event)) {
    return new Response("unrecognized payload", { status: 400 });
  }

  const record = event.record;
  const db = adminClient();

  // Idempotency guard #1 (app-level): a webhook re-delivery of an already-
  // parsed row is a no-op. Guard #2 is the DB unique(raw_notification_id)
  // constraint backing the upsert below — see migration 0001.
  const { data: existing, error: readError } = await db
    .from("raw_notifications")
    .select("id, parse_status")
    .eq("id", record.id)
    .single();
  if (readError) {
    return new Response(`could not read row: ${readError.message}`, {
      status: 500,
    });
  }
  if (existing.parse_status !== "pending") {
    return new Response("already parsed", { status: 200 });
  }

  const { data: templates, error: templateError } = await db
    .from("parser_templates")
    .select("*")
    .eq("package_name", record.package_name)
    .eq("active", true)
    .order("version", { ascending: false })
    .limit(1);
  if (templateError) {
    return new Response(`template lookup failed: ${templateError.message}`, {
      status: 500,
    });
  }
  const template = templates?.[0];
  if (!template) {
    // Phase 1 (agents.md §14) captures with no templates yet — leave the row
    // pending; a backfill re-parses everything once templates land.
    return new Response("no active template — left pending", { status: 200 });
  }

  const parsed = parseNotification(textFromRow(record), template);

  const parseStatus = parsed === null
    ? "failed"
    : parsed.matchedTemplate
    ? "success"
    : "needs_review";
  const confidence: Confidence = parsed !== null && parsed.matchedTemplate
    ? "high"
    : "low";
  const txnStatus: TransactionStatus = parsed !== null && parsed.matchedTemplate
    ? "confirmed"
    : "needs_review";

  let linkedTransactionId: string | null = null;

  if (parsed !== null) {
    const { data: rules, error: rulesError } = await db
      .from("merchant_rules")
      .select("*")
      .order("priority", { ascending: false });
    if (rulesError) {
      return new Response(
        `merchant rules lookup failed: ${rulesError.message}`,
        { status: 500 },
      );
    }

    const resolution = resolveMerchant(parsed.merchant_raw, rules ?? []);
    const txnDate =
      parseDateFromFormat(parsed.txn_date, template.date_format) ??
        new Date(record.posted_at);

    // Upsert on the DB-level unique key — webhook re-delivery and backfills
    // are safe by construction, not by an app-level "have I done this" check.
    const { data: inserted, error: txnError } = await db
      .from("transactions")
      .upsert(
        {
          raw_notification_id: record.id,
          user_id: record.user_id,
          source_package: record.package_name,
          source_app_label: record.app_label,
          amount: parsed.amount,
          currency: parsed.currency,
          direction: parsed.direction,
          merchant_raw: parsed.merchant_raw,
          merchant_display: resolution?.merchant_display ?? null,
          category_id: resolution?.category_id ?? null,
          transaction_date: txnDate.toISOString(),
          notification_posted_at: record.posted_at,
          parser_template_id: template.id,
          confidence,
          status: txnStatus,
        },
        { onConflict: "raw_notification_id" },
      )
      .select("id")
      .single();
    if (txnError) {
      return new Response(`transaction write failed: ${txnError.message}`, {
        status: 500,
      });
    }
    linkedTransactionId = inserted?.id ?? null;
  }

  // Audit note only — never changes parse_status (redactionSpotCheck.ts).
  const warnings = redactionSpotCheck(
    record.package_name,
    record.redactions_applied ?? [],
  );
  const parseError = parsed === null
    ? "no extractable amount"
    : warnings.length > 0
    ? warnings.join("; ")
    : null;

  const { error: updateError } = await db
    .from("raw_notifications")
    .update({
      parse_status: parseStatus,
      parser_template_id: template.id,
      linked_transaction_id: linkedTransactionId,
      parse_error: parseError,
    })
    .eq("id", record.id);
  if (updateError) {
    return new Response(
      `raw_notifications update failed: ${updateError.message}`,
      { status: 500 },
    );
  }

  return new Response(
    JSON.stringify({
      id: record.id,
      parse_status: parseStatus,
      linked_transaction_id: linkedTransactionId,
    }),
    { headers: { "content-type": "application/json" } },
  );
});
