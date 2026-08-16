package com.expensetracker.sync

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import dagger.hilt.android.qualifiers.ApplicationContext
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * All WorkManager scheduling (agents.md §11). Periodic cadences: dumb
 * ~15-min sync safety net, 30-min heartbeat, 60-min listener health
 * check. Captures additionally trigger an expedited one-off sync.
 */
@Singleton
class SyncScheduler @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private val workManager = WorkManager.getInstance(context)

    fun requestSync() {
        val request = OneTimeWorkRequestBuilder<NotificationSyncWorker>()
            .setConstraints(networkConnected())
            .setExpedited(OutOfQuotaWorkPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .build()
        workManager.enqueueUniqueWork(
            NotificationSyncWorker.WORK_NAME_ONE_OFF,
            ExistingWorkPolicy.KEEP,
            request,
        )
    }

    fun scheduleAll() {
        val sync = PeriodicWorkRequestBuilder<NotificationSyncWorker>(15, TimeUnit.MINUTES)
            .setConstraints(networkConnected())
            .build()
        workManager.enqueueUniquePeriodicWork(
            NotificationSyncWorker.WORK_NAME,
            ExistingPeriodicWorkPolicy.UPDATE,
            sync,
        )

        val heartbeat = PeriodicWorkRequestBuilder<HeartbeatWorker>(30, TimeUnit.MINUTES)
            .setConstraints(networkConnected())
            .build()
        workManager.enqueueUniquePeriodicWork(
            HeartbeatWorker.WORK_NAME,
            ExistingPeriodicWorkPolicy.UPDATE,
            heartbeat,
        )

        val health = PeriodicWorkRequestBuilder<ListenerHealthWorker>(60, TimeUnit.MINUTES)
            .build()
        workManager.enqueueUniquePeriodicWork(
            ListenerHealthWorker.WORK_NAME,
            ExistingPeriodicWorkPolicy.UPDATE,
            health,
        )
    }

    private fun networkConnected(): Constraints = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .build()
}
