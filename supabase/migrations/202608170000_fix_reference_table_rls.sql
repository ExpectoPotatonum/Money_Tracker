-- 0004: reference-table RLS fix
-- categories, merchant_rules, and parser_templates are shared reference data
-- with no per-row user_id column — owned and maintained by the single operator
-- via SQL Editor (not written by the app), but read by the authenticated
-- dashboard (categories) and by the Edge Function (merchant_rules,
-- parser_templates, via service_role which bypasses RLS).
--
-- Enabling RLS without a policy would lock these out entirely, which surfaces
-- as "permission denied for table categories" in the dashboard. So: enable
-- RLS and grant authenticated read access. Writes stay locked down — no RLS
-- policy grants insert/update/delete, SAP the operator's SQL Editor (service
-- role) can write.

alter table categories enable row level security;
alter table merchant_rules enable row level security;
alter table parser_templates enable row level security;

create policy "categories_read_authenticated"
  on categories for select to authenticated using (true);

create policy "merchant_rules_read_authenticated"
  on merchant_rules for select to authenticated using (true);

create policy "parser_templates_read_authenticated"
  on parser_templates for select to authenticated using (true);
