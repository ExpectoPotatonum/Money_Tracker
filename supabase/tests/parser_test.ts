// parser.ts is the heaviest-regression-test target (ARCHITECTURE.md §8): any
// body_pattern change gets replayed against every stored sample, and these
// table-driven tests are that replay running in unit-test form.

import { assertEquals } from "@std/assert";
import {
  bodyText,
  matchPattern,
  parseAmount,
  parseDateFromFormat,
  parseNotification,
} from "../functions/parse-notification/parser.ts";
import type {
  ParserTemplate,
  SanitizedText,
} from "../functions/_shared/types.ts";
import { loadTemplates } from "./fixtures.ts";

/** Narrowing substitute for assertNotNull (std's variant doesn't narrow in strict mode). */
function notNull<T>(value: T | null, message: string): T {
  if (value === null) throw new Error(message);
  return value;
}

function template(overrides: Partial<ParserTemplate>): ParserTemplate {
  return {
    id: "t-test",
    package_name: "com.example.test",
    app_label: "Test",
    version: 1,
    active: true,
    title_pattern: null,
    body_pattern: "Amount (?<amount>[\\d,]+\\.\\d{2}) (?<currency>[A-Z]{3})",
    date_format: null,
    default_currency: "MYR",
    sample_input: null,
    notes: null,
    ...overrides,
  };
}

function textOf(body: string): SanitizedText {
  return { text_body: body };
}

// ---------------------------------------------------------------------------
// Every stored template must strictly parse its own sanitized sample — this is
// the "fixed HLB, broke TnG" guard at unit-test level.
// ---------------------------------------------------------------------------
Deno.test("every fixture template strictly parses its own sanitized sample_input", () => {
  for (const t of loadTemplates()) {
    let parsed = parseNotification(textOf(t.sample_input!), t);
    parsed = notNull(
      parsed,
      `${t.package_name} v${t.version} failed on its own sample`,
    );
    assertEquals(
      parsed.amount,
      t.sample_expected.amount,
      `${t.package_name} v${t.version}: amount`,
    );
    assertEquals(
      parsed.currency,
      t.sample_expected.currency,
      `${t.package_name} v${t.version}: currency`,
    );
    assertEquals(
      parsed.direction,
      t.sample_expected.direction,
      `${t.package_name} v${t.version}: direction`,
    );
    if (t.sample_expected.merchant_raw !== null) {
      assertEquals(
        parsed.merchant_raw,
        t.sample_expected.merchant_raw,
        `${t.package_name} v${t.version}: merchant`,
      );
    }
    assertEquals(
      parsed.matchedTemplate,
      true,
      `${t.package_name} v${t.version}: must match strictly`,
    );
  }
});

// ---------------------------------------------------------------------------
// Strict template behavior
// ---------------------------------------------------------------------------
Deno.test("strict template extracts named groups", () => {
  const t = template({});
  let parsed = parseNotification(textOf("Amount 12.50 USD"), t);
  parsed = notNull(parsed, "parseNotification returned null");
  assertEquals(parsed.amount, 12.5);
  assertEquals(parsed.currency, "USD");
  assertEquals(parsed.direction, "debit"); // default when nothing indicates credit
  assertEquals(parsed.matchedTemplate, true);
});

Deno.test("direction group wins over keyword inference", () => {
  const t = template({
    body_pattern: "Amount (?<amount>[\\d,]+\\.\\d{2}) (?<direction>\\w+)",
  });
  let parsed = parseNotification(textOf("Amount 12.50 credit"), t);
  parsed = notNull(parsed, "parseNotification returned null");
  assertEquals(parsed.direction, "credit");
});

Deno.test("direction inferred from keywords when no group", () => {
  const t = template({ body_pattern: "Received (?<amount>[\\d,]+\\.\\d{2})" });
  let parsed = parseNotification(textOf("Received 12.50 from Ali"), t);
  parsed = notNull(parsed, "parseNotification returned null");
  assertEquals(parsed.direction, "credit");
});

Deno.test("big_text preferred over text_body", () => {
  const t = template({});
  let parsed = parseNotification({
    text_body: "Amount 1.00 MYR",
    big_text: "Amount 99.99 MYR",
  }, t);
  parsed = notNull(parsed, "parseNotification returned null");
  assertEquals(parsed.amount, 99.99);
});

Deno.test("optional title_pattern is enforced when present", () => {
  const t = template({ title_pattern: "TnG eWallet" });
  // Title mismatches the app the template belongs to -> strict match refused,
  // and with no amount-shaped text left, not even the loose fallback fires.
  assertEquals(
    parseNotification({
      title: "Other App",
      text_body: "Your transaction is being processed",
    }, t),
    null,
  );
  // Title matches -> strict parse succeeds.
  notNull(
    parseNotification(
      { title: "TnG eWallet", text_body: "Amount 12.00 MYR" },
      t,
    ),
    "expected strict parse when title matches",
  );
});

Deno.test("no title_pattern means no title constraint", () => {
  const t = template({ title_pattern: null });
  notNull(
    parseNotification({ title: "Anything", text_body: "Amount 12.00 MYR" }, t),
    "expected parse",
  );
});

Deno.test("missing amount group fails the parse", () => {
  const t = template({ body_pattern: "no groups here at all" });
  assertEquals(parseNotification(textOf("no groups here at all"), t), null);
});

Deno.test("amount with thousands separators", () => {
  const t = template({});
  let parsed = parseNotification(textOf("Amount 1,234.56 USD"), t);
  parsed = notNull(parsed, "parseNotification returned null");
  assertEquals(parsed.amount, 1234.56);
});

Deno.test("malformed stored body_pattern fails the parse, not the function", () => {
  const t = template({ body_pattern: "(unclosed" });
  assertEquals(parseNotification(textOf("anything"), t), null);
});

// ---------------------------------------------------------------------------
// Loose fallback
// ---------------------------------------------------------------------------
Deno.test("loose fallback matches a bare currency amount and reports needs_review", () => {
  const t = template({ body_pattern: "nothing matches this" });
  let parsed = parseNotification(
    textOf("You spent RM 8.50 at the kopitiam today"),
    t,
  );
  parsed = notNull(parsed, "parseNotification returned null");
  assertEquals(parsed.amount, 8.5);
  assertEquals(parsed.currency, "MYR");
  assertEquals(parsed.direction, "debit");
  assertEquals(parsed.matchedTemplate, false);
  assertEquals(parsed.merchant_raw, null);
});

Deno.test("loose fallback infers credit direction", () => {
  const t = template({ body_pattern: "zzz" });
  let parsed = parseNotification(textOf("RM 20.00 received from Ali"), t);
  parsed = notNull(parsed, "parseNotification returned null");
  assertEquals(parsed.direction, "credit");
});

Deno.test("loose fallback returns null when nothing amount-shaped exists", () => {
  const t = template({ body_pattern: "zzz" });
  assertEquals(
    parseNotification(textOf("Your order has been shipped"), t),
    null,
  );
});

// ---------------------------------------------------------------------------
// parseAmount
// ---------------------------------------------------------------------------
Deno.test("parseAmount", () => {
  assertEquals(parseAmount("12.00"), 12);
  assertEquals(parseAmount("1,234.56"), 1234.56);
  assertEquals(parseAmount("12"), 12);
  assertEquals(parseAmount("abc"), null);
  assertEquals(parseAmount(""), null);
  assertEquals(parseAmount("12.345"), null); // more than 2dp rejected
});

// ---------------------------------------------------------------------------
// parseDateFromFormat
// ---------------------------------------------------------------------------
Deno.test("parseDateFromFormat", () => {
  let d = parseDateFromFormat("15/08/2026 14:30", "dd/MM/yyyy HH:mm");
  d = notNull(d, "parseDateFromFormat returned null");
  assertEquals(d.getUTCFullYear(), 2026);
  assertEquals(d.getUTCMonth(), 7); // 0-indexed
  assertEquals(d.getUTCDate(), 15);
  assertEquals(d.getUTCHours(), 14);
  assertEquals(d.getUTCMinutes(), 30);
  assertEquals(parseDateFromFormat("garbage", "dd/MM/yyyy HH:mm"), null);
  assertEquals(parseDateFromFormat("15/08/2026 14:30", null), null);
  assertEquals(parseDateFromFormat(null, "dd/MM/yyyy HH:mm"), null);
});

// ---------------------------------------------------------------------------
// bodyText / matchPattern helpers
// ---------------------------------------------------------------------------
Deno.test("bodyText picks fullest field", () => {
  assertEquals(bodyText({ text_body: "a", big_text: "bb" }), "bb");
  assertEquals(bodyText({ text_body: "a", sub_text: "c" }), "a");
  assertEquals(bodyText({}), "");
});

Deno.test("matchPattern never throws", () => {
  assertEquals(matchPattern("(bad", "x"), null);
  assertEquals(matchPattern("", "x"), null);
  notNull(matchPattern("RM (?<amount>\\d+)", "RM 5"), "expected match");
});
