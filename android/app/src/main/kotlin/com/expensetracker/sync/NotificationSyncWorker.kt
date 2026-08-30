package com.expensetracker.sync

import android.content.Context
import android.util.Log
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.expensetracker.data.CaptureRepository
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import java.io.IOException
import org.json.JSONArray

/**
 * Batch upsert of pending rows (agents.md §11). Idempotent by
 * construction: the DB has `unique(client_uuid)` and the upsert uses
 * `on_conflict=client_uuid`, so a WorkManager retry can never create a
 * duplicate. Redaction runs here, at sync time, on the untouched Room copy.
 */
@HiltWorker
class NotificationSyncWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted params: WorkerParameters,
    private val repository: CaptureRepository,
    private val api: SupabaseApi,
    private val authStore: AuthStore,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val rows = repository.pendingForSync(CaptureRepository.SYNC_BATCH_SIZE)
        if (rows.isEmpty()) return Result.success()

        val token = try {
            val cachedToken = authStore.accessToken
            if (cachedToken != null && authStore.userId != null) {
                cachedToken
            } else {
                signInAndCache()
            }
        } catch (e: SupabaseApi.UnauthorizedException) {
            Log.e("NotificationSyncWorker", "Sync auth failed: check credentials", e)
            return Result.failure()
        } catch (e: IOException) {
            Log.e("NotificationSyncWorker", "Sync auth failed: retryable", e)
            return Result.retry()
        }

        val payload = JSONArray()
        val userId = authStore.userId
        rows.forEach { payload.put(PayloadBuilder.toPayload(it, userId)) }

        return try {
            api.upsertRawNotifications(payload, token)
            repository.markSynced(rows.map { it.clientUuid })
            Result.success()
        } catch (e: SupabaseApi.UnauthorizedException) {
            Log.e("NotificationSyncWorker", "Sync failed: unauthorized", e)
            authStore.accessToken = null
            Result.retry()
        } catch (e: IOException) {
            Log.e("NotificationSyncWorker", "Sync failed", e)
            repository.markFailed(rows.map { it.clientUuid })
            Result.retry()
        }
    }

    private suspend fun signInAndCache(): String {
        val email = authStore.email
        val password = authStore.password
        if (email.isBlank() || password.isBlank()) throw IOException("no credentials configured")
        val response = api.signIn(email, password)
        authStore.accessToken = response.accessToken
        authStore.userId = response.userId
        return response.accessToken
    }

    companion object {
        const val WORK_NAME = "notification-sync"
        const val WORK_NAME_ONE_OFF = "notification-sync-oneshot"
        const val KEY_UPLOADED = "uploaded_count"

        fun progress(count: Int) = workDataOf(KEY_UPLOADED to count)
    }
}
