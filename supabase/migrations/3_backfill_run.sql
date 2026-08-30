-- 3: backfill — parse the two existing pending rows.
-- Run AFTER 2c, 2d, 2e, and the template seed (202608180004) have all succeeded.
-- Returns the number of rows processed.

select backfill_parse_pending();
