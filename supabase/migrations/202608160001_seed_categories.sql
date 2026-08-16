-- 0002: seed default categories
-- Deterministic UUIDs so future seeds (merchant_rules, parser_templates) and
-- fixtures can reference them by a stable id. Names come from a plain-English
-- personal-finance set; the real taxonomy can evolve once phase-1 samples land.

insert into categories (id, name, icon, color) values
  ('11111111-1111-4111-8111-111111111111', 'Food & Dining',   'restaurant', '#e74c3c'),
  ('22222222-2222-4222-8222-222222222222', 'Groceries',       'cart',       '#27ae60'),
  ('33333333-3333-4333-8333-333333333333', 'Transport',       'directions_bus', '#3498db'),
  ('44444444-4444-4444-8444-444444444444', 'Shopping',        'shopping_bag', '#9b59b6'),
  ('55555555-5555-4555-8555-555555555555', 'Utilities & Bills','receipt',   '#f39c12'),
  ('66666666-6666-4666-8666-666666666666', 'Housing',         'home',       '#16a085'),
  ('77777777-7777-4777-8777-777777777777', 'Entertainment',   'movie',      '#8e44ad'),
  ('88888888-8888-4888-8888-888888888888', 'Health & Fitness','fitness_center', '#e67e22'),
  ('99999999-9999-4999-8999-999999999999', 'Travel',          'flight',     '#2c3e50'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Education',       'school',     '#d35400'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Income',          'trending_up', '#2ecc71'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Transfers',       'swap_horiz', '#7f8c8d'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Investments',     'show_chart', '#1abc9c'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Other',           'category',   '#95a5a6')
on conflict (name) do nothing;
