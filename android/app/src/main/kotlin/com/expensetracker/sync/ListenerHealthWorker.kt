package com.expensetracker.sync

import android.content.Context
import android.service.notification.NotificationListenerService
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.expensetracker.capture.NotificationCaptureService
import com.expensetracker.capture.SafeForegroundLauncher
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject

/**
 * Periodic health check (agents.md §10): if notification access is
 * granted but the listener isn't bound, ask the system to rebind it and
 * restart the foreground service. Headless failures are invisible by
 * design — this is the part that makes them self-healing instead.
 */
@HiltWorker
class ListenerHealthWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted params: WorkerParameters,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val context = applicationContext
        if (HeartbeatWorker.isListenerAccessGranted(context)) {
            NotificationListenerService.requestRebind(context)
            SafeForegroundLauncher.start(context, NotificationCaptureService::class.java)
        }
        return Result.success()
    }

    companion object {
        const val WORK_NAME = "listener-health"
    }
}
