// redactionSpotCheck.ts — flags rows where the on-device redaction audit
// trail (§8 redactions_applied) looks wrong for the package. Per agents.md §8:
// "A row from an app known to send OTPs, with an empty array here, is a signal
// the redaction pass missed that app's phrasing." Data-driven, not branching —
// new apps add a mapping here, not an if/else.

const SENSITIVE_BY_PACKAGE: Record<string, string[]> = {
  // Routinely send OTPs, balances, or account/card numbers.
  "my.com.tngdigital.ewallet": ["otp", "balance", "account"],
  "com.cimb.cimbocto": ["otp", "balance", "account"],
  "com.samsung.android.spay": ["account"],
  "com.google.android.apps.walletnfcrel": ["account"],
  "com.transferwise.android": ["balance", "account"],
  "com.eg.android.AlipayGphone": ["balance", "account"],
};

/**
 * Returns a list of human-readable warnings (empty = no concern) for a row.
 * The index.ts entry point appends these to raw_notifications.parse_error —
 * it deliberately does NOT change parse_status: a clean parse is still a
 * clean parse, this is an audit note for the review inbox.
 */
export function redactionSpotCheck(
  packageName: string,
  redactionsApplied: string[],
): string[] {
  if (!SENSITIVE_BY_PACKAGE[packageName]) return [];
  if (redactionsApplied.length > 0) return [];
  return [
    `spotcheck: no redactions applied for ${packageName}, which routinely sends ` +
    `sensitive content — check the on-device redaction pass missed phrasing ` +
    `(expected ${SENSITIVE_BY_PACKAGE[packageName].join("/")})`,
  ];
}
