-- 0000-seed-credit-categories: credit-side categories for the dashboard
-- "Money in" table (agents.md §13: web UI groups debits/spend and credits/income
-- separately). Debit/spend categories live in migration 202608160001_seed_categories.
--
-- Insert-by-name with `on conflict (name) do nothing` so this is safe to run
-- against the live project regardless of which categories already exist there
-- (the live set differs from the seed — see 202608180004_seed_templates.sql).

insert into categories (name, icon, color) values
  ('Salary',             'payments',     '#2ecc71'),
  ('Transfers',          'swap_horiz',   '#7f8c8d'),
  ('Refunds',            'replay',       '#1abc9c'),
  ('Cashback & Rewards', 'loyalty',      '#f39c12'),
  ('Investments/Interest','trending_up', '#3498db'),
  ('Gifts',              'card_giftcard','#e74c3c')
on conflict (name) do nothing;

-- grant select so the authenticated role can still read them (convention §17)
grant select on categories to authenticated;
