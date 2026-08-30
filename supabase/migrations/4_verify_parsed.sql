-- 4: VERIFY — after backfill, check the parsed transactions + updated raw rows.

-- Should now have 2 rows (TNG credit + CIMB debit)
select id, source_package, amount, currency, direction,
       merchant_display, transaction_date, confidence, status
from transactions
order by transaction_date;

-- raw_notifications should have flipped off 'pending'
select package_name, parse_status, parse_error
from raw_notifications
order by posted_at desc;
