-- Auto-categorize self-transfers: the owner's name in merchant_raw (from CIMB
-- DuitNow inbound, TnG P2P receive, etc.) maps to Finance & Transfer.
-- Display stays as merchant_raw (e.g. "HOO JET YUNG/Touch n Go").

insert into merchant_rules (match_pattern, match_type, normalized_name, category_id, priority)
select 'HOO JET YUNG', 'contains', 'HOO JET YUNG',
       (select id from categories where name = 'Finance & Transfer'), 20
where not exists (select 1 from merchant_rules where match_pattern = 'HOO JET YUNG');

-- Backfill existing transactions whose merchant_raw contains the name but have
-- no category yet (keyword rules are category-only and didn't fire because
-- priority 20 > priority 5, so only the category was missing).
select apply_category_hints();
