-- 022: Samsung Wallet source label — "Samsung Wallet - <card>"
--
-- WHY: a Samsung Wallet debit (body "MUJI - QUEENSBAY MALL MYR 113.20") shows
-- Source as just "Samsung Wallet", losing which card was used. The card name
-- lives in the notification TITLE (e.g. "HLB Debit Card"). The owner wants the
-- dashboard's Source column to read "Samsung Wallet - HLB Debit Card" — and to
-- generalize: any future card under Samsung Wallet (or any app opting in) shows
-- "<app label> - <title>".
--
-- Data-driven, not a per-package `if` (§16): add parser_templates.
-- source_suffix_title. When true, the parser builds source_app_label as
-- `<app_label> - <title>`. The Samsung template sets it; the flag defaults
-- false so every other app is unchanged.
--
-- Apply in the SQL Editor. Idempotent (column guarded by IF NOT EXISTS; parser
-- is create or replace; template flagged via UPDATE; resync is safe to re-run).

-- 1. New flag on parser_templates (no GRANT needed — it's an existing column
--    on a reference table the parser reads; authenticated never writes it).
alter table parser_templates
  add column if not exists source_suffix_title boolean not null default false;

-- 2. Redefine the parser to build v_source_label from the matched template.
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
  v_source_label text;
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

  -- Default source label is the app name. If the matching template opts in
  -- (source_suffix_title), append the notification title — the card name on
  -- Samsung Wallet — e.g. "Samsung Wallet - HLB Debit Card".
  v_source_label := r.app_label;

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
          if t.source_suffix_title and r.title is not null then
            v_source_label := r.app_label || ' - ' || r.title;
          end if;
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
    r.user_id, r.id, r.package_name, v_source_label,
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
        source_app_label = excluded.source_app_label,
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

-- 3. Samsung Wallet card template opts in to the "<app> - <card>" source label.
--    A NEW Samsung template is NOT needed — it's the same body pattern, just
--    this flag on v1, so updating it in place (a flag, not the regex) is safe.
update parser_templates
  set source_suffix_title = true
  where package_name = 'com.samsung.android.spay'
    and version = 1
    and active;

-- 4. Re-parse the affected rows (idempotent).
select backfill_resync();
