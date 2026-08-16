// Shared fixture loading for tests and the replay harness. The regression
// baseline is `sample_input` + `sample_expected` from fixtures/templates.json —
// the checked-in export of parser_templates rows (ARCHITECTURE.md §4/§8).

import type { ParserTemplate } from "../functions/_shared/types.ts";

export interface FixtureTemplate extends ParserTemplate {
  sample_expected: {
    amount: number;
    currency: string;
    direction: "debit" | "credit";
    merchant_raw: string | null;
  };
}

export function loadTemplates(): FixtureTemplate[] {
  const raw = Deno.readTextFileSync(
    new URL("../fixtures/templates.json", import.meta.url),
  );
  const parsed = JSON.parse(raw) as { templates: FixtureTemplate[] };
  return parsed.templates;
}

export function loadTemplatesByPackage(): Map<string, FixtureTemplate[]> {
  const byPackage = new Map<string, FixtureTemplate[]>();
  for (const t of loadTemplates()) {
    const list = byPackage.get(t.package_name) ?? [];
    list.push(t);
    byPackage.set(t.package_name, list);
  }
  return byPackage;
}
