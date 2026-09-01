-- 021: TnG outbound + Samsung Wallet templates, direction fix, resync
--
-- WHY: the dashboard showed NULL Merchant / Category for every TnG *outbound*
-- notification ("You have paid RM X to <M>.", "... has been deducted", "You have
-- successfully transferred RM X to <M>.") plus the Samsung Wallet debit
-- ("MUJI - QUEENSBAY MALL MYR 113.20"). The live parser picked only ONE active
-- template per package (`order by version desc limit 1`) and TnG only had the
-- credit "received" template, so all outbound formats fell through to the loose
-- amount-only fallback — extracting a number but no merchant/date/category.
--
-- Two fixes here:
--   1. parse_raw_notification now tries EVERY active template for the package
--      (highest version first), taking the first that strictly parses. Distinct
--      notification formats for the same app each map to their own template row
--      instead of one template crowding out the rest.
--   2. infer_direction no longer treats a bare "transferred" as income — only
--      "transferred ... to you" is. "You have successfully transferred RM X to
--      HOO JET YUNG." is a real debit, not a credit (matches the JS parser.ts
--      CREDIT_WORDS list, which never contained "transferred").
--
-- Then new parser_templates rows (version bump, never in-place edits — §§9/16),
-- merchant rules for clearly-categorized merchants, and a resync helper that
-- resets non-success rows to 'pending' and re-parses them.
--
-- Apply manually in the SQL Editor. Idempotent (create or replace / on
-- conflict / NOT EXISTS / resync is safe to re-run).

-- ---------------------------------------------------------------------------
-- 1a. Direction inference — drop bare "transferred" from the credit branch.
-- ---------------------------------------------------------------------------
create or replace function infer_direction(body text)
returns text
language sql
immutable
as $$
  select case
    when body ilike '%transferred%' and body ilike '%to you%' then 'credit'
    when body ilike '%received%' or body ilike '%credited%'
      or body ilike '%credit%' or body ilike '%cashback%'
      or body ilike '%refund%' or body ilike '%deposit%'
      or body ilike '%added%'
      or body ilike '%top-up%' or body ilike '%top up%' then 'credit'
    when body ilike '%debited%' or body ilike '%debit%'
      or body ilike '%paid%' or body ilike '%payment%'
      or body ilike '%charged%' or body ilike '%spent%'
      or body ilike '%purchase%' or body ilike '%deducted%'
      or body ilike '%withdrawn%' or body ilike '%transfer out%'
      or body ilike '%sent%' or body ilike '%from your%' then 'debit'
    else 'debit'
  end;
$$;

-- ---------------------------------------------------------------------------
-- 1b. Core parse: try all active templates per package, highest version first.
-- ---------------------------------------------------------------------------
create or replace function parse_raw_notification(rid uuid)
returns void
language plpgsql
as $$
declare
  r record;
  t record;
  m text[];
  v_amount text;
  v_currency text;
  v_merchant text;
  v_txn_date_g text;
  v_dir text;
  v_parsed jsonb;
  v_status text;
  v_confidence text;
  v_txn_status text;
  v_txn_date timestamptz;
  v_merchant_display text;
  v_category_id uuid;
  v_linked uuid;
  v_body text;
  v_tpl_id uuid;              -- highest-version template (fallback defaults)
  v_tpl_date_format text;
  v_tpl_default_currency text;
begin
  select * into r from raw_notifications where id = rid;
  if r is null then
    return;
  end if;
  if r.parse_status is distinct from 'pending' then
    return; -- already parsed (success/failed/needs_review/ignored) — no-op
  end if;

  -- The fullest text field wins, matching parser.ts bodyText().
  v_body := coalesce(r.big_text, r.text_body, r.sub_text, '');
  if v_body = '' then
    update raw_notifications set parse_status = 'failed', parse_error = 'no body text'
      where id = rid;
    return;
  end if;

  -- Snapshot the top-version active template so the loose fallback / fail path
  -- records the most-likely template and sane date/currency defaults.
  select id, date_format, default_currency
    into v_tpl_id, v_tpl_date_format, v_tpl_default_currency
    from parser_templates
    where package_name = r.package_name and active
    order by version desc
    limit 1;

  v_parsed := null;

  -- Try every active template for the package (highest version first) and take
  -- the first that strictly parses.
  for t in
    select *
    from parser_templates
    where package_name = r.package_name and active
    order by version desc
  loop
    if (t.title_pattern is null or t.title_pattern = ''
        or (r.title is not null and r.title ~* t.title_pattern))
    then
      m := regexp_match(v_body, t.body_pattern, 'i');
      if m is not null then
        v_amount := m[(t.field_map ->> 'amount')::int];
        v_merchant := m[(t.field_map ->> 'merchant')::int];
        v_txn_date_g := m[(t.field_map ->> 'txn_date')::int];
        v_currency := coalesce(m[(t.field_map ->> 'currency')::int],
                               t.default_currency);
        v_dir := infer_direction(
          coalesce(m[(t.field_map ->> 'direction')::int], v_body));
        if v_amount is not null then
          v_parsed := jsonb_build_object(
            'amount', v_amount,
            'currency', upper(v_currency),
            'merchant_raw', v_merchant,
            'txn_date', v_txn_date_g,
            'direction', v_dir,
            'matched_template', true);
          v_tpl_id := t.id;
          v_tpl_date_format := t.date_format;
          v_tpl_default_currency := t.default_currency;
          exit;
        end if;
      end if;
    end if;
  end loop;

  -- Strict template did not yield an amount -> loose per-currency fallback.
  if v_parsed is null or (v_parsed ->> 'amount') is null then
    v_parsed := loose_parse_amount(v_body);
    if v_parsed is not null then
      v_parsed := v_parsed || '{"matched_template":false}'::jsonb;
    end if;
  end if;

  if v_parsed is null then
    update raw_notifications
      set parse_status = 'failed',
          parse_error = 'no extractable amount',
          parser_template_id = v_tpl_id
      where id = rid;
    return;
  end if;

  v_status := case
    when (v_parsed ->> 'matched_template')::boolean then 'success'
    else 'needs_review'
  end;
  v_confidence := case
    when (v_parsed ->> 'matched_template')::boolean then 'high'
    else 'low'
  end;
  v_txn_status := case
    when (v_parsed ->> 'matched_template')::boolean then 'confirmed'
    else 'needs_review'
  end;

  v_txn_date := r.posted_at;
  if (v_parsed ->> 'txn_date') is not null and v_tpl_date_format is not null then
    begin
      v_txn_date := to_timestamp(v_parsed ->> 'txn_date', v_tpl_date_format);
    exception when others then
      v_txn_date := r.posted_at; -- unparseable date falls back safely
    end;
  end if;

  -- Merchant resolution: highest priority rule first (merchantResolver.ts).
  if (v_parsed ->> 'merchant_raw') is not null then
    select
      coalesce(mr.normalized_name, (v_parsed ->> 'merchant_raw')),
      mr.category_id
    into v_merchant_display, v_category_id
    from merchant_rules mr
    where (
      case mr.match_type
        when 'exact' then lower((v_parsed ->> 'merchant_raw')) = lower(mr.match_pattern)
        when 'contains' then lower((v_parsed ->> 'merchant_raw')) like '%' || lower(mr.match_pattern) || '%'
        when 'regex' then (v_parsed ->> 'merchant_raw') ~* mr.match_pattern
      end
    )
    order by mr.priority desc
    limit 1;
  end if;
  if v_merchant_display is null then
    v_merchant_display := v_parsed ->> 'merchant_raw';
  end if;

  -- One transaction row, idempotent on the unique raw_notification_id.
  insert into transactions (
    user_id, raw_notification_id, source_package, source_app_label,
    amount, currency, direction,
    merchant_raw, merchant_display, category_id,
    transaction_date, notification_posted_at,
    parser_template_id, confidence, status
  ) values (
    r.user_id, r.id, r.package_name, r.app_label,
    replace((v_parsed ->> 'amount'), ',', '')::numeric,
    coalesce((v_parsed ->> 'currency'), v_tpl_default_currency, 'MYR'),
    v_parsed ->> 'direction',
    v_parsed ->> 'merchant_raw',
    v_merchant_display,
    v_category_id,
    v_txn_date, r.posted_at,
    v_tpl_id, v_confidence, v_txn_status
  )
  on conflict (raw_notification_id) do update
    set amount = excluded.amount,
        currency = excluded.currency,
        direction = excluded.direction,
        merchant_raw = excluded.merchant_raw,
        merchant_display = excluded.merchant_display,
        category_id = excluded.category_id,
        transaction_date = excluded.transaction_date,
        confidence = excluded.confidence,
        status = excluded.status,
        parser_template_id = excluded.parser_template_id,
        updated_at = now()
  returning id into v_linked;

  -- Back-link the raw row to its transaction and record the parse outcome.
  update raw_notifications
    set parse_status = v_status,
        parser_template_id = v_tpl_id,
        linked_transaction_id = v_linked,
        parse_error = null
    where id = rid;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. New parser_templates rows (each a NEW version, never an in-place edit).
--    Built from the SANITIZED real captures in supabase/data.sql (§8).
--    Postgres ARE: greedy quantifiers only; field_map = 1-based group index.
-- ---------------------------------------------------------------------------
insert into parser_templates (
  package_name, app_label, version, active,
  title_pattern, body_pattern, date_format,
  default_currency, field_map, sample_input, notes
) values
(
  'my.com.tngdigital.ewallet', 'TNG eWallet', 2, true,
  'DuitNow|Payment|paid',
  '^You have paid RM[[:space:]]*([0-9][0-9,]*\.[0-9][0-9]) to (.+)\.$',
  null,
  'MYR',
  '{"amount":1,"merchant":2}',
  'You have paid RM12.50 to KEDAI KOPI 66.',
  'TnG DuitNow outbound "paid ... to <merchant>."'
),
(
  'my.com.tngdigital.ewallet', 'TNG eWallet', 3, true,
  'ALIPAY|paid',  -- Alipay+ variant uses "at", not "to"
  '^You have paid RM[[:space:]]*([0-9][0-9,]*\.[0-9][0-9]) at (.+)$',
  null,
  'MYR',
  '{"amount":1,"merchant":2}',
  'You have paid RM29.16 at PINDUODUO',
  'TnG outbound "paid ... at <merchant>" (Alipay+).'
),
(
  'my.com.tngdigital.ewallet', 'TNG eWallet', 4, true,
  'DuitNow Transfer|transferred',
  '^You have successfully transferred RM[[:space:]]*([0-9][0-9,]*\.[0-9][0-9]) to (.+)\.$',
  null,
  'MYR',
  '{"amount":1,"merchant":2}',
  'You have successfully transferred RM 100.00 to HOO JET YUNG.',
  'TnG DuitNow outbound transfer to a recipient (debit).'
),
(
  'my.com.tngdigital.ewallet', 'TNG eWallet', 5, true,
  'Payment To',
  '^(.+): RM[[:space:]]*([0-9][0-9,]*\.[0-9][0-9]) has been deducted',
  null,
  'MYR',
  '{"merchant":1,"amount":2}',
  'Berjaya Starbucks Coffee Company Sdn Bhd: RM20.00 has been deducted from your TNG eWallet. Merchant Reference No. [REDACTED-ACCOUNT]',
  'TnG "Payment To <merchant>: RM X has been deducted..."'
),
(
  'com.samsung.android.spay', 'Samsung Wallet', 1, true,
  null,
  '^(.+) - .+ (RM|MYR)[[:space:]]*([0-9][0-9,]*\.[0-9][0-9])$',
  null,
  'MYR',
  '{"merchant":1,"amount":3}',
  'MUJI - QUEENSBAY MALL MYR 113.20',
  'Samsung Wallet card debit: "<card> - <location> <CCY> <amount>"'
)
on conflict (package_name, version) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Merchant rules for clearly-categorized merchants seen in the samples.
--    One-off food stalls / person names are left for manual edit mode (§15).
-- ---------------------------------------------------------------------------
insert into merchant_rules (match_pattern, match_type, normalized_name, category_id, priority)
select 'starbucks', 'contains', 'Starbucks',
       (select id from categories where name = 'Food & Dining'),
       20
where not exists (select 1 from merchant_rules where match_pattern = 'starbucks');

insert into merchant_rules (match_pattern, match_type, normalized_name, category_id, priority)
select 'aeon', 'contains', 'AEON',
       (select id from categories where name = 'Shopping'),
       20
where not exists (select 1 from merchant_rules where match_pattern = 'aeon');

insert into merchant_rules (match_pattern, match_type, normalized_name, category_id, priority)
select 'muji', 'contains', 'MUJI',
       (select id from categories where name = 'Shopping'),
       20
where not exists (select 1 from merchant_rules where match_pattern = 'muji');

-- ---------------------------------------------------------------------------
-- 4. Resync: reset failed/needs_review rows to 'pending', then re-parse them.
--    The parser upserts on raw_notification_id so this is idempotent; rows that
--    truly have no transaction revert to 'failed'. 'ignored' rows (deliberately
--    not a transaction, §9) are left alone. Safe to re-run.
-- ---------------------------------------------------------------------------
create or replace function backfill_resync()
returns int
language plpgsql
as $$
declare
  cur record;
  n int := 0;
begin
  update raw_notifications
    set parse_status = 'pending'
    where parse_status in ('failed', 'needs_review');
  for cur in
    select id from raw_notifications where parse_status = 'pending'
  loop
    perform parse_raw_notification(cur.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

select backfill_resync();
