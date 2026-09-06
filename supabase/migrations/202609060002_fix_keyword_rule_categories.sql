-- 202609060002_fix_keyword_rule_categories.sql
-- Follow-up to 202609060001. The live categories table differs from the seed
-- file: there is no 'Health & Fitness' row, so the health keyword rule was
-- seeded with category_id = NULL and matched nothing (backfill: 0 rows).
-- Also, live HAS a 'Finance & Transfer' category distinct from 'Transfers' —
-- the HOO JET YUNG self-transfer rule belongs there (owner's original words).
-- Idempotent: guarded insert + updates by pattern + re-runnable backfill.

-- 1. Health category, in the owner's own term
insert into categories (name, icon, color)
select 'Health & Wellness', 'fitness_center', '#e67e22'
where not exists (select 1 from categories where name = 'Health & Wellness');

-- 2. Point the health keyword rule at it
update merchant_rules
set category_id = (select id from categories where name = 'Health & Wellness')
where match_type = 'regex'
  and match_pattern like 'hospital|clinic|klinik|pharmacy%';

-- 3. HOO JET YUNG -> Finance & Transfer (not Transfers)
update merchant_rules
set category_id = (select id from categories where name = 'Finance & Transfer')
where match_pattern = 'HOO JET YUNG';

-- 4. Re-run the backfill (fills the HOSPITAL / PHARMACY rows + any NULLs)
select apply_category_hints();
