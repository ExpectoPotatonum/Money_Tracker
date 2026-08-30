package com.expensetracker.capture

import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.service.notification.NotificationListenerService
import com.expensetracker.sync.SyncScheduler
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

/**
 * Restarts the pipeline after a reboot or app update (agents.md §10):
 * rebinds the notification listener, brings the foreground service back,
 * and reschedules the periodic workers.
 */
@AndroidEntryPoint
class BootReceiver : BroadcastReceiver() {

    @Inject lateinit var syncScheduler: SyncScheduler

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            -> {
                NotificationListenerService.requestRebind(
                    ComponentName(context, CaptureNotificationListenerService::class.java)
                )
                SafeForegroundLauncher.start(context, NotificationCaptureService::class.java)
                syncScheduler.scheduleAll()
            }
        }
    }
}
