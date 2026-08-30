# Android capture app

Headless-first Kotlin app: `NotificationListenerService` → Room → WorkManager sync to Supabase. No parsing on-device — `parser_templates` on the server do that (agents.md §9).

## Build

```bash
# from repo root
cd android
./gradlew assembleDebug
```

The Gradle wrapper (`gradlew`, `gradlew.bat`, `gradle/wrapper/gradle-wrapper.jar`) is committed. If it ever needs regenerating: `gradle wrapper --gradle-version 8.9`.

Required Java 17. Open the `android/` folder in Android Studio to run on a device/emulator.

## Supabase configuration

The anon key and project URL are compile-time values, fed via Gradle properties (they live in `BuildConfig`):

```bash
./gradlew assembleDebug \
  -PSUPABASE_URL=https://<project>.supabase.co \
  -PSUPABASE_ANON_KEY=<anon-key>
```

Without them the app builds with placeholder values and capture still works locally (Room is the source of truth); sync just fails until real values are supplied. The anon key is public by design — RLS is the security boundary (agents.md §12). **No `service_role` key ever goes in this app.**

Supabase sign-in credentials (email/password) are entered in the in-app Settings tab; they're stored in plain SharedPreferences for v1's single-user scope.

### Auth & sync self-healing

Access tokens are short-lived JWTs (~1h), so the app caches a full session and re-authenticates on demand rather than trusting a token forever:

- `AuthStore` caches the **access token and `user_id`** captured at sign-in. A sync/heartbeat worker treats the session as valid only when **both** are present; otherwise it signs in with the stored credentials and re-caches them.
- Every upsert payload (notifications and heartbeat) sends `user_id` explicitly — required by the RLS `owner_only` policy (`auth.uid() = user_id`).
- Any HTTP **401 or 403** is surfaced as an `UnauthorizedException`, which the workers catch by **clearing the stale token** and retrying — the next run performs a fresh sign-in instead of looping on a dead token forever.
- `SupabaseApi` logs the **full Supabase response body** on each failure, so an auth problem versus an RLS/grant problem (e.g. `permission denied for table X`) is distinguishable in Logcat.
- The status screen shows **"Last heartbeat"** as a live check that auth, networking, and DB permissions are all working.
- Building without real `SUPABASE_URL` / `SUPABASE_ANON_KEY` prints a placeholder warning at startup rather than failing with opaque 401s.

See `docs/adr/0002-auth-session-lifecycle.md` for the full decision.

## One-time device setup (OneUI — agents.md §10)

1. Grant notification access when prompted.
2. Settings > Apps > Expense Tracker > Battery → **Unrestricted**.
3. Recents → tap the app's icon → **Lock this app**.
4. Battery > Background usage limits → not in *Sleeping* / *Deep sleeping*.

## Testing

```bash
./gradlew ktlintCheck detekt testDebugUnitTest
./gradlew connectedDebugAndroidTest   # needs an emulator/device
```

The redaction pass (`sanitize/Redactor.kt`) is the heaviest-tested code in the repo on purpose (ARCHITECTURE.md §8). The instrumented sync test replaces `NetworkModule` with mocks via `@TestInstallIn`.

## Layout

```
app/src/main/kotlin/com/expensetracker/
  capture/   NotificationListenerService, foreground service, boot receiver
  sanitize/  pure redaction pass (§8 of agents.md)
  data/      Room entities, DAO, repository
  sync/      WorkManager workers, Supabase REST client, scheduling
  di/        Hilt modules
  ui/        status + settings screens (Compose)
```
