-- 202609060001_keyword_category_rules.sql
-- Keyword-based auto-categorization via merchant_rules:
--   Food & Dining, Health & Fitness, Transport, Shopping (regex fallbacks),
--   plus a named rule mapping HOO JET YUNG (self) -> Transfers.
--
-- Design:
-- - Keyword rules have normalized_name = NULL, so the parser keeps the real
--   merchant text as merchant_display and only the category hint applies.
-- - Keyword rules sit at priority 5, below explicit named-merchant rules
--   (priority 20: starbucks, aeon, muji, salary, ...). A specific merchant
--   always wins — e.g. "AEON FOOD FAIR" resolves Shopping (named aeon rule),
--   not Food & Dining. Ties between two priority-5 keyword rules resolve
--   arbitrarily; expand either list if that ever matters in practice.
-- - Existing starbucks/aeon/muji rules (202609010001) are untouched and
--   already point at Food & Dining / Shopping / Shopping.
-- - Rows whose category is still NULL get backfilled by
--   apply_category_hints(); rows with a category already set (incl. manual
--   edits) are never touched.
-- Idempotent: guarded inserts + re-runnable function.
--
-- Schema note: merchant_rules.normalized_name was NOT NULL. Category-only
-- keyword rules need NULL (the parser already keeps the raw merchant text as
-- display via coalesce when normalized_name is NULL), so relax it here.

-- ── Relax normalized_name: NULL = category-only rule (keep raw display) ──
alter table merchant_rules alter column normalized_name drop not null;

-- ── Food & Dining keyword fallback ───────────────────────────────
insert into merchant_rules (match_pattern, match_type, normalized_name, category_id, priority)
select 'food|drinks|drink|cafe|café|restaurant|kopitiam|kopi|mamak|coffee|tea|ramen|nasi|noodles|bakery|bakes|dessert|smoothie|juice|pizza|burger|sushi|gelato|ice cream|dim sum|bistro|grill|kebab|fried chicken|steamboat|makan',
       'regex', null,
       (select id from categories where name = 'Food & Dining'),
       5
where not exists (
  select 1 from merchant_rules
  where match_type = 'regex' and match_pattern like 'food|drinks|drink|cafe%'
);

-- ── Health & Fitness keyword fallback ────────────────────────────
insert into merchant_rules (match_pattern, match_type, normalized_name, category_id, priority)
select 'hospital|clinic|klinik|pharmacy|farmasi|pharm|health|medical|dentist|dental|optometrist|optical|physio|physiotherapy|chiropractic|dermatology|specialist|wellness|fitness|gym|laboratory|diagnostic|vaccination|vaccine|podiatry',
       'regex', null,
       (select id from categories where name = 'Health & Fitness'),
       5
where not exists (
  select 1 from merchant_rules
  where match_type = 'regex' and match_pattern like 'hospital|clinic|pharmacy%'
);

-- ── Transport keyword fallback ───────────────────────────────────
-- Note: bare 'bus' also matches "BUSINESS …" — drop it if that mis-tags.
insert into merchant_rules (match_pattern, match_type, normalized_name, category_id, priority)
select 'parking|car park|toll|petrol|fuel|diesel|ron95|ron97|grab|taxi|lrt|mrt|ktm|bus|train|highway|expressway|toll plaza',
       'regex', null,
       (select id from categories where name = 'Transport'),
       5
where not exists (
  select 1 from merchant_rules
  where match_type = 'regex' and match_pattern like 'parking|car park|toll%'
);

-- ── Shopping keyword fallback ────────────────────────────────────
-- Note: 'mall' also matches "SMALL …" — narrow it if that mis-tags.
insert into merchant_rules (match_pattern, match_type, normalized_name, category_id, priority)
select 'shopping|mall|boutique|retail|supermarket|minimart|fashion|clothing|apparel|electronics|gadget|furniture|hardware|jewellery|jewelry',
       'regex', null,
       (select id from categories where name = 'Shopping'),
       5
where not exists (
  select 1 from merchant_rules
  where match_type = 'regex' and match_pattern like 'shopping|mall|boutique%'
);

-- ── HOO JET YUNG (self-transfer) -> Transfers ────────────────────
insert into merchant_rules (match_pattern, match_type, normalized_name, category_id, priority)
select 'HOO JET YUNG', 'contains', 'Hoo Jet Yung',
       (select id from categories where name = 'Transfers'),
       20
where not exists (select 1 from merchant_rules where match_pattern = 'HOO JET YUNG');

-- ── Backfill: fill NULL categories without touching manual edits ──
create or replace function apply_category_hints()
returns int
language plpgsql
as $$
declare
  v_count int := 0;
begin
  -- For transactions with no category, resolve the highest-priority matching
  -- merchant_rules row on merchant_raw (same semantics as parse_raw_notification:
  -- exact / contains / regex, priority desc). Rows with a category already set
  -- — including any hand-picked ones — are never touched.
  with ranked as (
    select
      t.id as txn_id,
      mr.category_id,
      mr.normalized_name,
      row_number() over (partition by t.id order by mr.priority desc) as rn
    from transactions t
    join merchant_rules mr
      on mr.category_id is not null
     and (
       case mr.match_type
         when 'exact' then lower(t.merchant_raw) = lower(mr.match_pattern)
         when 'contains' then lower(t.merchant_raw) like '%' || lower(mr.match_pattern) || '%'
         when 'regex' then t.merchant_raw ~* mr.match_pattern
       end
     )
    where t.category_id is null
      and t.merchant_raw is not null
  ),
  upd as (
    update transactions t
    set category_id = r.category_id,
        -- Adopt the rule's display name when it defines one (named-merchant
        -- rules); keyword rules keep the raw merchant text as display.
        merchant_display = coalesce(r.normalized_name, t.merchant_raw, t.merchant_display),
        updated_at = now()
    from ranked r
    where t.id = r.txn_id
      and r.rn = 1
    returning t.id
  )
  select count(*) into v_count from upd;

  return v_count;
end;
$$;

select apply_category_hints();
