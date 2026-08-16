// redactionSpotCheck.ts — the §8 audit signal: a row from a package known to
// routinely send sensitive content, with an empty redactions_applied array,
// means the on-device pass may have missed phrasing.

import { assertEquals } from "@std/assert";
import { redactionSpotCheck } from "../functions/parse-notification/redactionSpotCheck.ts";

Deno.test("empty redactions for a sensitive package is flagged", () => {
  const warnings = redactionSpotCheck("my.com.tngdigital.ewallet", []);
  assertEquals(warnings.length, 1);
  assertEquals(warnings[0]!.includes("spotcheck"), true);
  assertEquals(warnings[0]!.includes("otp/balance/account"), true);
});

Deno.test("redacted row from a sensitive package is not flagged", () => {
  assertEquals(
    redactionSpotCheck("my.com.tngdigital.ewallet", ["otp", "balance"]),
    [],
  );
});

Deno.test("unknown packages are never flagged", () => {
  assertEquals(redactionSpotCheck("com.random.app", []), []);
});

Deno.test("partial redaction is still a pass — the audit trail exists", () => {
  assertEquals(redactionSpotCheck("com.transferwise.android", ["account"]), []);
});
