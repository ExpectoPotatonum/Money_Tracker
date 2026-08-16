// replay-templates.ts — the §15 regression harness, and the concrete answer to
// ARCHITECTURE.md §4/§9: replay every stored sample_input against its
// body_pattern so a "fixed HLB, broke TnG" regression fails locally and in CI,
// not in prod.
//
// Two data sources:
//   1. fixtures/templates.json (default — CI runs with no DB): the checked-in
//      baseline of sample_input + sample_expected.
//   2. A live Supabase project, when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
//      are set: fetches parser_templates; asserts each sample still parses
//      (non-null, amount > 0).
//
// Exit code 1 on any failure. Reporting format is deliberately plain
// (ARCHITECTURE.md §12 leaves the harness's internal reporting open).

import { parseNotification } from "../functions/parse-notification/parser.ts";
import { loadTemplates } from "../tests/fixtures.ts";
import { createClient } from "@supabase/supabase-js";
import type { ParserTemplate } from "../functions/_shared/types.ts";

interface CheckResult {
  label: string;
  ok: boolean;
  detail?: string;
}

const results: CheckResult[] = [];
let failures = 0;

function record(label: string, ok: boolean, detail?: string): void {
  results.push({ label, ok, detail });
  if (!ok) failures += 1;
}

function runFromFixtures(): void {
  for (const t of loadTemplates()) {
    if (!t.sample_input) continue;
    const parsed = parseNotification({ text_body: t.sample_input }, t);
    const label = `${t.package_name} v${t.version} sample`;
    if (!parsed) {
      record(label, false, "sample_input no longer parses");
      continue;
    }
    if (!parsed.matchedTemplate) {
      record(label, false, "sample_input now only matches the loose fallback");
      continue;
    }
    const exp = t.sample_expected;
    const mismatches: string[] = [];
    if (parsed.amount !== exp.amount) {
      mismatches.push(`amount ${parsed.amount} != ${exp.amount}`);
    }
    if (parsed.currency !== exp.currency) {
      mismatches.push(`currency ${parsed.currency} != ${exp.currency}`);
    }
    if (parsed.direction !== exp.direction) {
      mismatches.push(`direction ${parsed.direction} != ${exp.direction}`);
    }
    record(label, mismatches.length === 0, mismatches.join("; ") || undefined);
  }
}

async function runFromDatabase(): Promise<void> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    console.log("No SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY — using fixtures."),
      await runFromFixtures();
    return;
  }

  const client = createClient(url, key);
  const { data: templates, error } = await client
    .from("parser_templates")
    .select("*")
    .order("package_name")
    .order("version", { ascending: false });
  if (error) {
    throw new Error(`could not load parser_templates: ${error.message}`);
  }

  for (const t of (templates ?? []) as ParserTemplate[]) {
    if (!t.sample_input) continue;
    const parsed = parseNotification({ text_body: t.sample_input }, t);
    const label = `${t.package_name} v${t.version} sample`;
    if (!parsed) {
      record(label, false, "sample_input no longer parses");
    } else if (!parsed.matchedTemplate) {
      record(label, false, "sample_input now only matches the loose fallback");
    } else if (parsed.amount <= 0) {
      record(label, false, `implausible amount ${parsed.amount}`);
    } else {
      record(label, true);
    }
  }
}

const source = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  ? "database"
  : "fixtures";
if (source === "database") {
  await runFromDatabase();
} else {
  runFromFixtures();
}

for (const r of results) {
  console.log(
    `${r.ok ? "PASS" : "FAIL"}  ${r.label}${r.detail ? ` — ${r.detail}` : ""}`,
  );
}
console.log(
  `\n${
    results.length - failures
  }/${results.length} samples passed (source: ${source})`,
);
if (failures > 0) {
  console.error(
    `\n${failures} regression(s) — a previously-matching sample stopped matching. `,
  );
  Deno.exit(1);
}
