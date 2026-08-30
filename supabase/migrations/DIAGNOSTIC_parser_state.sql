-- DIAGNOSTIC: run this to see which pieces of the DB parser already exist.
-- Helps us understand why backfill_parse_pending() was missing.

-- 1. Which functions exist?
select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('parse_raw_notification','backfill_parse_pending',
                    'trigger_parse_raw_notification','infer_direction',
                    'loose_parse_amount')
order by p.proname;

-- 2. Does the trigger exist?
select tgname
from pg_trigger
where tgname = 'raw_notifications_after_insert_parse';

-- 3. Does the field_map column exist?
select column_name
from information_schema.columns
where table_name = 'parser_templates' and column_name = 'field_map';

-- 4. Is parser_templates seeded?
select package_name, version, active, field_map
from parser_templates;

-- 5. rows still pending (these are the ones backfill will process)
select id, package_name, parse_status
from raw_notifications
order by posted_at desc;
