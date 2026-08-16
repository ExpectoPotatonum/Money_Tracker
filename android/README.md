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
