# Fix Persistent 401 Unauthorized Errors

The user reports that 401 errors persist even after resolving potential RLS conflicts. This indicates a failure in the authentication layer or the token's validity for PostgREST requests.

## User Review Required

> [!IMPORTANT]
> This plan assumes that the `SUPABASE_URL` and `SUPABASE_ANON_KEY` provided during the build are correct. If the app was built with placeholder values, sync will fail with 401.

## Proposed Changes

### Sync Component

#### [MODIFY] [SupabaseApi.kt](file:///C:/Users/Jet/Documents/Money_Tracker/android/app/src/main/kotlin/com/expensetracker/sync/SupabaseApi.kt)
- Add a check for "placeholder" values in `BuildConfig` to log warnings if the app is misconfigured.
- Ensure `Log.e` prints the full error response body from Supabase for both `signIn` and `postUpsert`.
- Add the `X-Client-Info` header to requests for better Supabase dashboard observability (optional but helpful).

#### [MODIFY] [HeartbeatWorker.kt](file:///C:/Users/Jet/Documents/Money_Tracker/android/app/src/main/kotlin/com/expensetracker/sync/HeartbeatWorker.kt)
- Update token retrieval logic to force a re-sign-in if `authStore.userId` is missing, ensuring the sync payload is never sent with a null `user_id`.

#### [MODIFY] [NotificationSyncWorker.kt](file:///C:/Users/Jet/Documents/Money_Tracker/android/app/src/main/kotlin/com/expensetracker/sync/NotificationSyncWorker.kt)
- Update token retrieval logic to force a re-sign-in if `authStore.userId` is missing.

## Verification Plan

### Automated Tests
- N/A (requires real Supabase backend for 401 validation)

### Manual Verification
- Check Logcat for "SupabaseApi: Request failed: HTTP 401 - ..." to see the exact error message from Supabase (e.g., "Invalid API key", "JWT expired", "Invalid login credentials").
- Verify that `HeartbeatWorker` and `NotificationSyncWorker` successfully re-authenticate and populate the `userId` in `AuthStore`.
