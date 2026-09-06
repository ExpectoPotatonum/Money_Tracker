-- Manual quick-add entries (AI NL bookkeeping, Phase B) have no source push
-- notification. The original design assumed every transaction derives from a
-- raw_notifications row; allow manual rows to skip that link while keeping the
-- audit invariant that capture rows are never fabricated:
--   - a transaction WITHOUT a raw_notifications link must self-identify as a
--     manual entry (source_package = 'manual') and be treated as low
--     confidence, since there's no notification cross-check;
--   - a transaction WITH a link must NOT claim to be manual.
alter table transactions alter column raw_notification_id drop not null;

alter table transactions add constraint chk_manual_source check (
  (raw_notification_id is null and source_package = 'manual' and confidence = 'low')
  or
  (raw_notification_id is not null and source_package <> 'manual')
);