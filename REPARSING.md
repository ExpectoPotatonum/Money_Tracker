# Re-parsing & the DB-side parser

> Short doc for the "how do I re-parse history and why is parsing in Postgres?"
> questions. The long architecture narrative lives in `ARCHITECTURE.md` and the
> conventions in `agents.md` §5/§9/§15/§16.

## Why parsing is DB-side (not an Edge Function)

The original design parsed notifications in the `parse-notification` Deno Edge
Function, triggered by a Database Webhook. On Supabase's hosted platform both of
those are **paid-tier (Pro) features**, and this project runs on the **Free**
project. Free projects can't deploy Edge Functions or register webhooks.

So parsing runs **inside Postgres**: an `AFTER INSERT` trigger on
`raw_notifications` calls a PL/pgSQL function, `parse_raw_notification(rid)`,
which does everything the Edge Function did — template match, loose fallback,
merchant resolution, transaction write, raw-row status update. Triggers and
PL/pgSQL run on every plan, including Free.

- Migrations: `202608180002_db_parser_field_map.sql` (schema addition),
  `202608180003_db_parser_infra.sql` (parse function + trigger + backfill),
  `202608180004_seed_templates.sql` (TnG + CIMB templates from real samples).
- The Edge Function code stays in `supabase/functions/parse-notification/` as
  the **fallback if the project ever upgrades to Pro**. It and the DB parser
  share the same design goals (idempotent writes, decoupled re-runnable logic).

## How re-parsing works

Parsing is idempotent and re-runnable by construction:

- `transactions.unique(raw_notification_id)` backs the `INSERT ... ON CONFLICT
  (raw_notification_id) DO UPDATE` inside the parser, so re-running the same row
  never creates a duplicate.
- The parser only acts on rows whose `parse_status = 'pending'` (it returns
  early otherwise), so repeated backfills are cheap no-ops for already-parsed
  rows. `backfill_resync()` (migration 202609010001) flips `failed`/`needs_review`
  back to `pending` for you — it deliberately does **not** touch `success` rows,
  so it can't clobber manual edits.

To re-parse all history after a template/rule change, run in the SQL editor:

```sql
select backfill_resync();
```

To re-parse a single row (e.g. after fixing one template):

```sql
select parse_raw_notification('<uuid>');
```

### End-to-end after adding a new template

1. Insert the new `parser_templates` row (new `version`).
2. Insert any new `merchant_rules` rows.
3. Reset the rows you want to re-run to `pending`:

   ```sql
   update raw_notifications set parse_status = 'pending' where <filter>;
   ```
   (resetting to `pending` is optional — omitting it means already-parsed rows
   are skipped, but the ones you specifically want to reprocess must be flipped
   back to `pending` first because the parser bails on anything that isn't
   `pending`.)
4. Run `select backfill_resync();`.

> Note: `parse_raw_notification` tries **every active template** for the package
> (highest `version` first) and takes the first that strictly parses — so one
> package (TnG v1–v6) can have several rows, one per distinct notification
> format. A new format is a **new template row** (`version` bumps), never an
> in-place regex edit. `reject_pattern` (202609010005) marks matching
> marketing/reward bodies `ignored` before parsing, and `source_suffix_title`
> (202609010002) renders the dashboard's Send-from column as `<app> - <title>` (Samsung Wallet
> shows the card name).

## Postgres regex gotchas (read before writing a `body_pattern`)

Postgres's default regex flavor (ARE) differs from JavaScript's in ways that
matter for every template:

- `\s` `\d` `\w` and `\.` are supported.
- **NO lazy quantifiers** (`*?`, `+?`) — matching is always greedy. Use greedy
  quantifiers with explicit anchors (e.g. `(.+) to (.+) on (...)` backtracks to
  the last occurrence of the anchor literal).
- **NO `\b`** word-boundary.
- **NO lookahead/lookbehind.**
- `regexp_match` returns a **positional** array (index 1 = first capture group),
  so each rule's `field_map` records which group holds which field:
  `{"amount":1,"merchant":2,"txn_date":3}`. Fields may be any subset of
  `amount, currency, merchant, txn_date, direction`.

Example — CIMB DuitNow outbound (from migration 202608180004):

```sql
body_pattern => 'DuitNow to Acct RM[[:space:]]*([0-9][0-9,]*\.[0-9][0-9]) to (.+) on ([0-9]{1,2}-[A-Za-z]{3}-[0-9]{4},[[:space:]]*[0-9]{2}:[0-9]{2}:[0-9]{2})'
field_map    => '{"amount":1,"merchant":2,"txn_date":3}'
date_format  => 'DD-Mon-YYYY, HH24:MI:SS'   -- Postgres to_timestamp tokens
```

## Validation

Before applying a changed `body_pattern`, replay it against every stored
`sample_input` for that `package_name`. The SQL-side equivalent of the old
`replay-templates.ts` harness is, per pattern, a check like:

```sql
select regexp_match(
  'DuitNow to Acct RM 1.00 to HOO JET YUNG/Touch n Go on 30-Aug-2026, 01:22:56.',
  'DuitNow to Acct RM[[:space:]]*([0-9][0-9,]*\.[0-9][0-9]) to (.+) on ([0-9]{1,2}-[A-Za-z]{3}-[0-9]{4},[[:space:]]*[0-9]{2}:[0-9]{2}:[0-9]{2})',
  'i');
-- expect: {1.00,HOO JET YUNG/Touch n Go,30-Aug-2026, 01:22:56}
```
