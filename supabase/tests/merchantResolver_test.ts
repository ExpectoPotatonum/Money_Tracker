// merchantResolver.ts — priority ordering and match-type semantics.

import { assertEquals } from "@std/assert";
import { resolveMerchant } from "../functions/parse-notification/merchantResolver.ts";
import type { MerchantRule } from "../functions/_shared/types.ts";

function rule(overrides: Partial<MerchantRule>): MerchantRule {
  return {
    id: "r-test",
    match_pattern: "SHOPEE",
    match_type: "contains",
    normalized_name: "Shopee",
    category_id: "cat-shopping",
    priority: 0,
    ...overrides,
  };
}

Deno.test("highest priority rule wins", () => {
  const rules = [
    rule({
      id: "low",
      match_pattern: "shop",
      priority: 1,
      normalized_name: "Generic Shop",
    }),
    rule({
      id: "high",
      match_pattern: "shopee",
      priority: 10,
      normalized_name: "Shopee Official",
    }),
  ];
  assertEquals(
    resolveMerchant("Shopee Mall SG", rules)?.merchant_display,
    "Shopee Official",
  );
});

Deno.test("exact match is case-insensitive", () => {
  const rules = [rule({ match_type: "exact", match_pattern: "shopee" })];
  assertEquals(resolveMerchant("SHOPEE", rules)?.merchant_display, "Shopee");
  assertEquals(
    resolveMerchant("Shopee Mall", rules)?.merchant_display,
    "Shopee Mall",
  );
});

Deno.test("contains match", () => {
  const rules = [rule({ match_type: "contains" })];
  assertEquals(
    resolveMerchant("PAYMENT TO SHOPEE", rules)?.merchant_display,
    "Shopee",
  );
});

Deno.test("regex match", () => {
  const rules = [
    rule({
      match_type: "regex",
      match_pattern: "\\b(?:grab|grabpay)\\b",
      normalized_name: "GrabPay",
    }),
  ];
  assertEquals(
    resolveMerchant("GrabPay ride", rules)?.merchant_display,
    "GrabPay",
  );
});

Deno.test("regex match is matched before falling through to lower priority", () => {
  const rules = [
    rule({
      match_type: "contains",
      match_pattern: "grab",
      priority: 5,
      normalized_name: "Grab",
    }),
    rule({
      match_type: "regex",
      match_pattern: "grabfood",
      priority: 2,
      normalized_name: "GrabFood",
    }),
  ];
  assertEquals(resolveMerchant("grabfood", rules)?.merchant_display, "Grab");
});

Deno.test("no match falls back to the raw text", () => {
  const rules = [rule({ match_pattern: "something-else" })];
  assertEquals(
    resolveMerchant("MYSTERY MERCHANT", rules)?.merchant_display,
    "MYSTERY MERCHANT",
  );
  assertEquals(resolveMerchant("MYSTERY MERCHANT", rules)?.category_id, null);
});

Deno.test("null or empty merchant resolves to null", () => {
  assertEquals(resolveMerchant(null, [rule({})]), null);
  assertEquals(resolveMerchant("   ", [rule({})]), null);
});

Deno.test("malformed stored regex rule never throws", () => {
  const rules = [rule({ match_type: "regex", match_pattern: "(unclosed" })];
  assertEquals(
    resolveMerchant("anything", rules)?.merchant_display,
    "anything",
  );
});
