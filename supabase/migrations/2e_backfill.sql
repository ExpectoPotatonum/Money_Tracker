-- 2e: backfill helper — re-parse every row still 'pending'
-- Depends on 2c existing. Run after templates are seeded.
-- Then run:  select backfill_parse_pending();

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
