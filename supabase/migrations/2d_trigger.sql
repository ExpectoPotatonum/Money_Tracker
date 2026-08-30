-- 2d: live AFTER INSERT trigger on raw_notifications
-- Depends on 2c (parse_raw_notification) existing.

create or replace function trigger_parse_raw_notification()
returns trigger
language plpgsql
as $$
begin
  perform parse_raw_notification(new.id);
  return new;
end;
$$;

drop trigger if exists raw_notifications_after_insert_parse on raw_notifications;

create trigger raw_notifications_after_insert_parse
  after insert on raw_notifications
  for each row execute function trigger_parse_raw_notification();
