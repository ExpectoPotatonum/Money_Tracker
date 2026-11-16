-- 202611160002_source_account_map.sql
--
-- Sent-from → Account auto-mapping. The dashboard already resolves a default
-- account from `package_account_map` (one bank app = one account). Real life is
-- less tidy: Samsung Wallet can notify for several cards, and one package can
-- surface multiple `source_app_label` values (e.g. "Samsung Wallet - HLB Debit
-- Card" vs "Samsung Wallet - CIMB Card").
--
-- Owner decision (2026-11-16): map the *Sent from label* first, then fall back
-- to the package default. Precedence in parse_raw_notification():
--
--   source_account_map (user_id, source_app_label)
--     → package_account_map (user_id, package_name)
--       → NULL ("Unassigned", resolved by hand in the accounts manager)
--
-- Resolution only — this never creates an account (same owner decision #2 as
-- 202609190004). The parser body also carries forward the amount > 0 guard from
-- 202611140001 (that migration is applied through this one if it had not been
-- run yet).
--
-- Run this file in the Supabase SQL Editor (migrations are not auto-applied).
-- Re-runnable / idempotent.

-- ---------------------------------------------------------------------------
-- 1. The label → account map. Owner-scoped; deleting an account cascades the
--    map row away (the web API also clears it explicitly for older projects).
-- ---------------------------------------------------------------------------
create table if not exists source_account_map (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users(id),
  source_app_label  text not null,
  account_id        uuid not null references accounts(id) on delete cascade,
  created_at        timestamptz not null default now(),
  unique (user_id, source_app_label)
);

create index if not exists source_account_map_account_idx
  on source_account_map (account_id);
create index if not exists source_account_map_user_idx
  on source_account_map (user_id);

grant select, insert, update, delete on source_account_map to authenticated;

alter table source_account_map enable row level security;

drop policy if exists "owner_only" on source_account_map;
create policy "owner_only" on source_account_map
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 2. Parser: label map first, package map second. Full function body carried
--    forward from 202611140001_amount_must_be_positive.sql (the latest live
--    version) so applying this also applies the non-positive-amount guard.
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
  v_amount_num numeric;
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
  v_tpl_id uuid;
  v_tpl_date_format text;
  v_tpl_default_currency text;
  v_source_label text;
  v_account_id uuid;
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

  -- Snapshot the top-version active template so rejected/failed rows record the
  -- most-likely template and sane date/currency defaults.
  select id, date_format, default_currency
    into v_tpl_id, v_tpl_date_format, v_tpl_default_currency
    from parser_templates
    where package_name = r.package_name and active
    order by version desc
    limit 1;

  -- Reject marketing/reward notifications (points, cashback, vouchers, balance
  -- top-ups, reloads) before anything becomes a transaction. Marked `ignored`,
  -- not 'failed', so they neither clutter the review net nor skew the spike
  -- alert.
  if exists (
    select 1 from parser_templates pt
    where pt.package_name = r.package_name
      and pt.active
      and pt.reject_pattern is not null
      and pt.reject_pattern <> ''
      and v_body ~* pt.reject_pattern
  ) then
    update raw_notifications
      set parse_status = 'ignored',
          parse_error = 'rejected: not a transaction',
          parser_template_id = v_tpl_id
      where id = rid;
    return;
  end if;

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

  -- Cast once, here: a non-numeric amount group (bad field_map) is a parse
  -- failure, not an exception that would abort the capture INSERT.
  begin
    v_amount_num := replace(v_parsed ->> 'amount', ',', '')::numeric;
  exception when others then
    update raw_notifications
      set parse_status = 'failed',
          parse_error = 'unparseable amount',
          parser_template_id = v_tpl_id
      where id = rid;
    return;
  end;

  -- THE INVARIANT: an amount must be > 0 to be a transaction (202611140001).
  if v_amount_num <= 0 then
    update raw_notifications
      set parse_status = 'ignored',
          parse_error = 'non-positive amount',
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
      -- Notification text timestamps are LOCAL MYT, not UTC (202609070001).
      v_txn_date := (to_timestamp(v_parsed ->> 'txn_date', v_tpl_date_format)
                     AT TIME ZONE 'UTC')
                    AT TIME ZONE 'Asia/Kuala_Lumpur';
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

  -- Account resolution order (owner decision 2026-11-16):
  --   1. exact Sent-from label (so one package can map several cards),
  --   2. package default (backwards compatible with 202609190004),
  --   3. NULL = "Unassigned" for the web accounts manager.
  select sam.account_id into v_account_id
  from source_account_map sam
  where sam.user_id = r.user_id
    and sam.source_app_label = v_source_label
  limit 1;

  if v_account_id is null then
    select pam.account_id into v_account_id
    from package_account_map pam
    where pam.user_id = r.user_id
      and pam.package_name = r.package_name
    limit 1;
  end if;

  -- One transaction row, idempotent on the unique raw_notification_id.
  insert into transactions (
    user_id, raw_notification_id, source_package, source_app_label,
    amount, currency, direction,
    merchant_raw, merchant_display, category_id,
    transaction_date, notification_posted_at,
    parser_template_id, confidence, status, account_id
  ) values (
    r.user_id, r.id, r.package_name, v_source_label,
    v_amount_num,
    coalesce((v_parsed ->> 'currency'), v_tpl_default_currency, 'MYR'),
    v_parsed ->> 'direction',
    v_parsed ->> 'merchant_raw',
    v_merchant_display,
    v_category_id,
    v_txn_date, r.posted_at,
    v_tpl_id, v_confidence, v_txn_status, v_account_id
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
