-- currencies: reference table of selectable currencies for the dashboard's
-- edit mode + display symbols (agents.md §15 open item: "Which FX API"). The
-- web app reads this at runtime to build the dropdown and the symbol map, so
-- adding a currency later is a data change (one INSERT), not an app release —
-- the same "data change, not app release" philosophy as parser_templates.
--
-- Transactions store currency as plain text (no enum), so a code not in this
-- table still displays fine (falls back to the raw code) — this table only
-- drives the *choices* offered in edit mode and the symbol used for display.

create table if not exists currencies (
  id       uuid primary key default gen_random_uuid(),
  code     text not null unique,       -- ISO 4217: 'MYR', 'CNY', 'TWD', ...
  symbol   text not null,              -- display symbol: 'RM', 'NT$', ...
  position int not null default 99     -- sort order for the dropdown
);

-- seed the v1 set
insert into currencies (code, symbol, position) values
  ('MYR', 'RM',   10),
  ('CNY', '¥',    20),
  ('TWD', 'NT$',  30),
  ('USD', '$',    40),
  ('SGD', 'S$',   50)
on conflict (code) do update
  set symbol = excluded.symbol, position = excluded.position;

-- §17 checklist: reference/lookup table -> SELECT for authenticated + read
-- policy (no user_id, so it's shared, not owner-scoped).
grant select on currencies to authenticated;
alter table currencies enable row level security;
create policy "read_authenticated" on currencies
  for select to authenticated using (true);
