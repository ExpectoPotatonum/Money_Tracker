## Summary

<!-- What does this PR do, and why? -->

## Type of change

- [ ] feat
- [ ] fix
- [ ] chore
- [ ] docs
- [ ] test
- [ ] migration (`/supabase/migrations`)

## Conventions checklist (agents.md §16 / ARCHITECTURE.md §6)

- [ ] If this touches `parser_templates.body_pattern` or `title_pattern`: is it a **new row** with `version` bumped, not an edit to an existing one?
- [ ] If this touches `raw_notifications`: are `title`, `text_body`, `big_text`, `sub_text`, `posted_at`, `content_hash`, `package_name`, `device_id` left untouched post-insert? (Only `parse_status`, `parse_error`, `parser_template_id`, `linked_transaction_id` may change.)
- [ ] If this changes capture-path code (`NotificationListenerService` / `onNotificationPosted`): does it still do nothing but a fast, synchronous local write — no network, no regex, no blocking work?
- [ ] Zero references to the Supabase `service_role` key anywhere under `/android`?
- [ ] If this adds/changes a `parser_templates.body_pattern`: has `supabase/scripts/replay-templates.ts` been run against every `sample_input` for that `package_name`, and does it pass?
- [ ] If this touches `/supabase/migrations`: is it a **new** file (forward-only), not an edit to a migration that's already merged?
- [ ] Tests added or updated for any changed logic?
- [ ] If this resolves or changes an "open decision" from `agents.md` §15: is there a corresponding entry under `/docs/adr`?

## Testing done

<!-- Commands run, manual steps taken, screenshots if UI changed -->

## Related

<!-- Linked issue, ADR, or discussion -->
