-- CI verification for ARCHITECTURE.md §6. Each trigger must raise on the
-- mutation it exists to block; the legitimate parse-status update must pass.
-- Run AFTER tests/_bootstrap_auth.sql + all migrations.
--
-- auth.uid() is stubbed to '00000000-0000-0000-0000-000000000000' in CI, so
-- fixture rows must carry that user_id to satisfy the RLS with-check policy.

-- ---------------------------------------------------------------------------
-- 1. raw_notifications capture fields are immutable
-- ---------------------------------------------------------------------------
insert into raw_notifications
  (user_id, client_uuid, device_id, package_name, title, text_body, big_text, sub_text,
   posted_at, content_hash, redactions_applied)
values
  ('00000000-0000-0000-0000-000000000000', 'ci-raw-1', 'ci-device', 'my.com.tngdigital.ewallet',
   'TnG eWallet', 'You have received RM 10.00 from Ali', null, null,
   now(), 'ci-hash-1', '{}');

-- The one update shape the system is allowed to perform post-insert: parse
-- bookkeeping only. Must NOT raise.
update raw_notifications
  set parse_status = 'failed', parse_error = 'ci test'
  where client_uuid = 'ci-raw-1';

do $$
begin
  begin
    update raw_notifications set text_body = 'mutated' where client_uuid = 'ci-raw-1';
    raise exception 'raw_notifications immutable trigger did NOT fire on text_body';
  exception
    when others then
      if sqlerrm not like '%raw_notifications capture fields are immutable%' then
        raise;
      end if;
  end;

  begin
    update raw_notifications set posted_at = now() where client_uuid = 'ci-raw-1';
    raise exception 'raw_notifications immutable trigger did NOT fire on posted_at';
  exception
    when others then
      if sqlerrm not like '%raw_notifications capture fields are immutable%' then
        raise;
      end if;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 2. parser_templates patterns are immutable — new version instead
-- ---------------------------------------------------------------------------
insert into parser_templates
  (package_name, app_label, version, body_pattern, default_currency, sample_input, notes)
values
  ('my.com.tngdigital.ewallet', 'TnG eWallet', 1,
   'You have received (?<amount>[\d,]+\.\d{2}) (?<currency>[A-Z]{3}) from (?<merchant>.*)',
   'MYR', 'You have received 10.00 MYR from Ali', 'ci fixture');

do $$
begin
  begin
    update parser_templates
      set body_pattern = 'changed'
      where package_name = 'my.com.tngdigital.ewallet' and version = 1;
    raise exception 'parser_templates immutable trigger did NOT fire on body_pattern';
  exception
    when others then
      if sqlerrm not like '%body_pattern/title_pattern are immutable%' then
        raise;
      end if;
  end;

  begin
    update parser_templates
      set title_pattern = 'changed'
      where package_name = 'my.com.tngdigital.ewallet' and version = 1;
    raise exception 'parser_templates immutable trigger did NOT fire on title_pattern';
  exception
    when others then
      if sqlerrm not like '%body_pattern/title_pattern are immutable%' then
        raise;
      end if;
  end;
end $$;

-- A new version must be free to insert (the immutability is per-row, not
-- per-package) — this is the "fix by bumping version" path working.
insert into parser_templates
  (package_name, app_label, version, body_pattern, default_currency, sample_input, notes)
values
  ('my.com.tngdigital.ewallet', 'TnG eWallet', 2,
   'New format: (?<amount>[\d,]+\.\d{2}) (?<currency>[A-Z]{3})',
   'MYR', 'New format: 10.00 MYR', 'ci fixture');

-- Clean up fixtures so the schema is left exactly as migrations created it.
delete from raw_notifications where client_uuid like 'ci-raw-%';
delete from parser_templates where notes = 'ci fixture';
