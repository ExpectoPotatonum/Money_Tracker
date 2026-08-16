// merchantResolver.ts — pure function against merchant_rules. Highest
// priority first, exact/contains/regex per row. Returns null only when there
// is nothing to resolve; otherwise it always produces a display name, falling
// back to the raw text when no rule matches (so the dashboard can show the
// merchant even before someone writes a rule for it).

import type { MerchantResolution, MerchantRule } from "../_shared/types.ts";

export function resolveMerchant(
  merchantRaw: string | null,
  rules: MerchantRule[],
): MerchantResolution | null {
  if (!merchantRaw) return null;

  const target = merchantRaw.trim();
  if (!target) return null;

  const sorted = [...rules].sort((a, b) => b.priority - a.priority);
  for (const rule of sorted) {
    if (ruleMatches(rule, target)) {
      return {
        merchant_display: rule.normalized_name,
        category_id: rule.category_id,
      };
    }
  }
  return { merchant_display: target, category_id: null };
}

function ruleMatches(rule: MerchantRule, target: string): boolean {
  switch (rule.match_type) {
    case "exact":
      return target.toLowerCase() === rule.match_pattern.toLowerCase();
    case "contains":
      return target.toLowerCase().includes(rule.match_pattern.toLowerCase());
    case "regex":
      try {
        return new RegExp(rule.match_pattern, "i").test(target);
      } catch {
        return false; // a bad stored rule must never throw out of here
      }
  }
}
