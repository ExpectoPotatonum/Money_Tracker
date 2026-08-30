# ADR 0002: Auth session lifecycle & 401/403 self-healing

**Status:** Accepted — 2026-08-30

## Context

The Android app authenticates to Supabase and writes under RLS. Three problems surfaced in live use (`HeartbeatWorker` logging `upsert failed: HTTP 401`):

1. **Short-lived access tokens.** Supabase access tokens are JWTs that expire after ~1 hour by default. The original app cached only the `access_token` and signed in only when **no token was present at all** (`authStore.accessToken ?: signIn()`). Once a stale token existed, it was reused forever: every upsert returned HTTP 401, the worker neither recognized it as an auth failure nor cleared the token, and `Result.retry()` spun in a permanent loop with no self-healing until the user reopened the app.
2. **Missing `user_id` in payloads.** Every capture table carries RLS `owner_only` (`auth.uid() = user_id`). PostgREST can default `user_id` from the JWT, but during the "update" phase of an upsert it often requires the value to be explicit. Without it the RLS policy rejected the write — HTTP 403. The app never stored `user_id` locally at all.
3. **Silent failures.** Only the HTTP code was logged, never the response body. Supabase's body (e.g. `{"msg":"JWT expired"}` or `new row violates row-level security policy`) was discarded, so it was impossible to tell a bad password, a bad API key, or an RLS misconfiguration apart.

## Decision

In `android/`:

- **Full session persistence.** `AuthStore` now caches both `access_token` and `user_id`, captured at sign-in from `SupabaseApi.SignInResponse`. A worker treats the session as valid only when **both** are present.
- **Explicit `user_id` in payloads.** Both the heartbeat row and each notification payload include `user_id`, satisfying the `owner_only` RLS policy on every insert/update path.
- **Robust error mapping.** Any HTTP 401 or 403 thrown by `SupabaseApi` is surfaced as a dedicated `UnauthorizedException` (an `IOException` subtype). Workers catch it, **clear the dead token** from `AuthStore`, and `Result.retry()` — guaranteeing the next run performs a fresh sign-in instead of reusing the stale token.
- **Transparent logging.** `SupabaseApi` reads and logs the full response body on every failed request/upsert, so Postgres-level and auth-level messages are visible in Logcat for future diagnosis.
- **UI-driven verification.** `AuthStore.lastHeartbeatAt` is written on successful heartbeat and surfaced in `MainScreen` as a "Last heartbeat" readout, so a healthy auth+network+RLS path is visible without opening Logcat.
- **Configuration safety.** `SupabaseApi`, at construction, warns if `SUPABASE_URL` or `SUPABASE_ANON_KEY` contains a placeholder, so a build made without real values fails with an obvious log message rather than an opaque 401 storm.

## Consequences

- **Self-healing:** an expired token no longer wedges sync — the first 401 clears the token and the next worker run re-authenticates.
- **Re-auth is password-based.** Re-authentication relies on the stored shared-preference password and on Supabase not revoking the account's sessions. This matches v1's single-user scope; a proper `refresh_token` flow (grant_type=refresh_token) is the natural follow-up if password reliance becomes undesirable, and would let tokens refresh without a fresh password sign-in.
- **Credentials change clears the session.** `MainViewModel.saveCredentials` nulls the cached token/`user_id` so the new credentials take effect immediately.
- **Diagnosis is faster:** 401/403 vs. other failures are distinguishable, and the Supabase body makes RLS/grant mistakes (`permission denied for table <x>`) obvious in Logcat.

Revisit this record only if auth moves toward token-refresh, multiple-user/devices, or KeyStore-backed credential storage (any of which is a contained change to `AuthStore` + the worker sign-in paths).
