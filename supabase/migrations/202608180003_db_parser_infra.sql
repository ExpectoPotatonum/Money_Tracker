-- 019: DB-side parser — trigger + PL/pgSQL function + backfill helper
--
-- Replaces the (paid-tier) parse-notification Edge Function + webhook with a
-- plain Postgres trigger that runs on every plan, including Free. Design goals
-- are preserved from agents.md §5 / §9:
--   * decoupled, re-runnable parsing — the same core function drives both the
--     live trigger and the historical backfill;
--   * unconditional capture — a row that fails to parse stays a row, marked
--     'failed'/'needs_review', never deleted;
--   * idempotent writes — transactions.unique(raw_notification_id) + upsert
--     make webhook-replay/backfill re-runs safe by construction.
--
-- The core function parse_raw_notification(rid uuid) is the single source of
-- parse truth: templated match (body_pattern + field_map) on the sanitized
-- text, then a loose per-currency fallback, then merchant resolution against
-- merchant_rules, then one transaction write + one raw_notifications update.
--
-- NOTE on the regex engine: Postgres ARE supports \s, \d, \w and \. but NOT
-- lazy quantifiers (*? +?), \b, or named-group extraction (regexp_match returns
-- a positional text[]). parser_templates.field_map supplies the group positions
-- (migration 202608180002). body_pattern values must be written accordingly.

-- ---------------------------------------------------------------------------
-- Direction inference (ported from the JS parser + a fix for "transferred …
-- to you"). Scans the body once; credit wins ties; defaults to debit (most
-- notifications are spends). Mirrors parser.ts directionFrom exactly.
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
      or body ilike '%transferred%' or body ilike '%added%'
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
-- Loose per-currency fallback (agents.md §6 / parser.ts looseParse). Returns
-- a matching {amount,currency,direction} as JSON when a currency-amount token
-- appears anywhere — even when no strict template matched — so the row lands
-- in the review inbox as 'needs_review' / confidence 'low' instead of being
-- silently dropped. Returns NULL when nothing amount-like is found.
-- ---------------------------------------------------------------------------
create or replace function loose_parse_amount(body text)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'amount', m.amount,
    'currency', m.currency,
    'direction', infer_direction(body)
  )
  from (
    select
      (regexp_match(body,
        '(RM|MYR|USD|US\$|\$|CNY|CN¥|¥|SGD|S\$|EUR|€|GBP|£)[[:space:]]*([0-9][0-9,]*\.[0-9][0-9])',
        'i'))[2] as amount,
      case
        when body ~* '(RM|MYR)' then 'MYR'
        when body ~* '(USD|US\$)' then 'USD'
        when body ~* '(CNY|CN¥)' then 'CNY'
        when body ~* 'SGD' then 'SGD'
        when body ~* 'EUR' then 'EUR'
        when body ~* 'GBP' then 'GBP'
        else 'MYR'
      end as currency
    where body ~* '(RM|MYR|USD|US\$|\$|CNY|CN¥|¥|SGD|S\$|EUR|€|GBP|£)[[:space:]]*[0-9][0-9,]*\.[0-9][0-9]'
  ) m
  where m.amount is not null;
$$;

-- ---------------------------------------------------------------------------
-- Core parse function. Idempotent: re-runs are safe (upsert on the unique
-- raw_notification_id). Standalone-callable so a backfill can iterate history.
-- Local variables use a v_ prefix so none collide with table column names
-- (PL/pgSQL resolves an unqualified name to a column over a variable inside a
-- SQL statement, which silently breaks assignments like `set x = x`).
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
begin
  -- Load the raw row; bail if it's gone or already off 'pending'.
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

  -- Active template for this package, highest version first.
  select * into t
    from parser_templates
    where package_name = r.package_name and active
    order by version desc
    limit 1;

  v_parsed := null;

  if t.id is not null then
    -- title_pattern is an optional guard; NULL/empty means "don't require it".
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
        end if;
      end if;
    end if;
  end if;

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
          parser_template_id = t.id
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

  -- transaction_date: txn_date group parsed via template.date_format, else the
  -- notification's posted_at (parser.ts parseDateFromFormat fallback).
  v_txn_date := r.posted_at;
  if (v_parsed ->> 'txn_date') is not null and t.date_format is not null then
    begin
      v_txn_date := to_timestamp(v_parsed ->> 'txn_date', t.date_format);
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
    coalesce((v_parsed ->> 'currency'), t.default_currency, 'MYR'),
    v_parsed ->> 'direction',
    v_parsed ->> 'merchant_raw',
    v_merchant_display,
    v_category_id,
    v_txn_date, r.posted_at,
    t.id, v_confidence, v_txn_status
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
        parser_template_id = t.id,
        linked_transaction_id = v_linked,
        parse_error = null
    where id = rid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Live trigger — run the parser the moment a raw_notifications row lands.
-- Fires on INSERT only: the parser's UPDATE of the same row is not an insert
-- and cannot re-trigger (no recursion), and the raw_notifications_immutable
-- before-update trigger still guards the capture fields (§16).
-- ---------------------------------------------------------------------------
create or replace function trigger_parse_raw_notification()
returns trigger
language plpgsql
as $$
begin
  perform parse_raw_notification(new.id);
  return new;
end;
$$;

drop trigger if exists raw_notifications_after_insert_parse on raw_notifications;

create trigger raw_notifications_after_insert_parse
  after insert on raw_notifications
  for each row execute function trigger_parse_raw_notification();

-- ---------------------------------------------------------------------------
-- Backfill helper — re-run the parser over any row still 'pending'. Safe to
-- run repeatedly; parsing is idempotent (§5). Intended for the SQL editor
-- once a template/rule changes, mirroring the Edge Function's re-parse story.
-- ---------------------------------------------------------------------------
create or replace function backfill_parse_pending()
returns int
language plpgsql
as $$
declare
  cur record;
  n int := 0;
begin
  for cur in
    select id from raw_notifications where parse_status = 'pending'
  loop
    perform parse_raw_notification(cur.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;
