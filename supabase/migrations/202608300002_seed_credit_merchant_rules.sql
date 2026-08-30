-- seed merchant_rules for the credit-side categories added in
-- 202608300001_seed_credit_categories.sql (Salary, Refunds, Cashback &
-- Rewards, Investments/Interest, Gifts).
--
-- These match recognizable sender/merchant text for *incoming* money. A P2P
-- receive like TnG "HOO JET YUNG" carries a person's name as merchant_raw, so
-- it cannot be matched generically here — leave it uncategorized and set by
-- hand in the dashboard's edit mode (that's the whole point of the manual
-- edit feature), rather than guessing at person names.
--
-- Idempotent: guarded by NOT EXISTS (merchant_rules has no unique constraint).
-- category_id is resolved by name at insert time so this survives whichever
-- category set actually exists in the live project.

insert into merchant_rules (match_pattern, match_type, normalized_name, category_id, priority)
select 'salary', 'contains', 'Salary',
       (select id from categories where name = 'Salary'),
       20
where not exists (select 1 from merchant_rules where match_pattern = 'salary');

insert into merchant_rules (match_pattern, match_type, normalized_name, category_id, priority)
select 'refund', 'contains', 'Refund',
       (select id from categories where name = 'Refunds'),
       20
where not exists (select 1 from merchant_rules where match_pattern = 'refund');

insert into merchant_rules (match_pattern, match_type, normalized_name, category_id, priority)
select 'cashback', 'contains', 'Cashback',
       (select id from categories where name = 'Cashback & Rewards'),
       20
where not exists (select 1 from merchant_rules where match_pattern = 'cashback');

insert into merchant_rules (match_pattern, match_type, normalized_name, category_id, priority)
select 'rebate', 'contains', 'Rebate',
       (select id from categories where name = 'Cashback & Rewards'),
       20
where not exists (select 1 from merchant_rules where match_pattern = 'rebate');

insert into merchant_rules (match_pattern, match_type, normalized_name, category_id, priority)
select 'interest', 'contains', 'Interest',
       (select id from categories where name = 'Investments/Interest'),
       20
where not exists (select 1 from merchant_rules where match_pattern = 'interest');

insert into merchant_rules (match_pattern, match_type, normalized_name, category_id, priority)
select 'dividend', 'contains', 'Dividend',
       (select id from categories where name = 'Investments/Interest'),
       20
where not exists (select 1 from merchant_rules where match_pattern = 'dividend');

insert into merchant_rules (match_pattern, match_type, normalized_name, category_id, priority)
select 'gift', 'contains', 'Gift',
       (select id from categories where name = 'Gifts'),
       20
where not exists (select 1 from merchant_rules where match_pattern = 'gift');
