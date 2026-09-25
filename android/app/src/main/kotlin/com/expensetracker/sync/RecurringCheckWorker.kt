package com.expensetracker.sync

import android.content.Context
import android.util.Log
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import java.io.IOException
import java.time.LocalDate

/**
 * Phase 6 recurring auto-entry (import-candidate-features.md §4.5). The phone
 * — not the DB — owns the clock (Free tier has no pg_cron / scheduled Edge
 * Functions), so this worker materializes every due recurring_entries row as a
 * manual `is_recurring` transaction. Runs as a daily periodic plus a one-off on
 * every app wake/capture (SyncScheduler), giving fast catch-up after the phone
 * has been off.
 *
 * Idempotent and resumable: each materialized row's (recurring_entry_id,
 * recurring_due_date) maps to the partial unique index transactions_recurring_uq
 * (202609250001); the upsert uses ignore-duplicates, and next_due_date is only
 * advanced after the insert is acked — so a retried pass never double-records a
 * cycle and a partial failure catches up on the next pass.
 */
@HiltWorker
class RecurringCheckWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted params: WorkerParameters,
    private val api: SupabaseApi,
    private val authStore: AuthStore,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val token = try {
            val cachedToken = authStore.accessToken
            if (cachedToken != null && authStore.userId != null) cachedToken else signIn()
        } catch (e: SupabaseApi.UnauthorizedException) {
            Log.e(TAG, "Recurring auth failed: check credentials", e)
            return Result.failure()
        } catch (e: IOException) {
            Log.e(TAG, "Recurring auth failed: retryable", e)
            return Result.retry()
        }

        return try {
            val today = RecurringMaterializer.todayMyt()
            val due = api.listDueRecurringEntries(token, today.toString())
            if (due.isNotEmpty()) {
                val accountNames = api.listAccounts(token).associate { it.id to it.name }
                for (entry in due) {
                    val dueDate = runCatching { LocalDate.parse(entry.nextDueDate) }.getOrNull()
                        ?: continue
                    val row = RecurringMaterializer.buildRow(
                        entry,
                        dueDate,
                        accountNames[entry.accountId] ?: ManualTransactionBuilder.DEFAULT_SOURCE,
                    )
                    api.upsertRecurringTransaction(row, token)
                    val nextDue = RecurringMaterializer.advance(
                        dueDate,
                        entry.frequency,
                        entry.intervalStep,
                        entry.dayOfMonth,
                    )
                    api.advanceRecurringEntry(entry.id, nextDue.toString(), token)
                }
            }
            Result.success()
        } catch (e: SupabaseApi.UnauthorizedException) {
            Log.e(TAG, "Recurring sync failed: unauthorized", e)
            authStore.accessToken = null
            Result.retry()
        } catch (e: IOException) {
            Log.e(TAG, "Recurring sync failed: retryable", e)
            Result.retry()
        }
    }

    private suspend fun signIn(): String {
        val email = authStore.email
        val password = authStore.password
        if (email.isBlank() || password.isBlank()) throw IOException("no credentials configured")
        val response = api.signIn(email, password)
        authStore.accessToken = response.accessToken
        authStore.userId = response.userId
        return response.accessToken
    }

    companion object {
        /** Daily periodic work (scheduleAll). */
        const val WORK_NAME = "recurring-check"
        /** One-off on app wake/capture (requestSync) — distinct name from the periodic. */
        const val WORK_NAME_ONE_OFF = "recurring-check-one-off"
        private const val TAG = "RecurringCheckWorker"
    }
}
