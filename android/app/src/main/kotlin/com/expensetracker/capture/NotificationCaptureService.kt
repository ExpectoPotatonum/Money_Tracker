package com.expensetracker.capture

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.expensetracker.R

/**
 * Low-importance silent foreground service (agents.md §10) — the pair to
 * the notification listener that keeps OneUI from killing the capture
 * pipeline. Declared with foregroundServiceType=specialUse to avoid the
 * 6h/24h runtime cap that applies to dataSync on Android 15+ (API 35).
 */
class NotificationCaptureService : Service() {

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        runCatching { startAsForeground() }
            .onFailure { Log.e("CaptureService", "failed to go foreground", it) }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        // If the listener is still bound, OneUI didn't kill us — we did.
        // Stay dead until the health-check worker or boot receiver wakes us.
    }

    /**
     * Required on Android 15+ (API 35) even for specialUse-type FGS —
     * harmless before the cap applies, mandatory once it does. The
     * system calls this when the cumulative specialUse cap is hit; we
     * stop gracefully instead of risking a RemoteServiceException.
     */
    override fun onTimeout(startId: Int, fgsType: Int) {
        Log.w("CaptureService", "FGS timeout (type=$fgsType) — stopping")
        stopSelf()
    }

    private fun startAsForeground() {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_LOW),
        )
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.capture_service_title))
            .setContentText(getString(R.string.capture_service_text))
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setOngoing(true)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceCompat.startForeground(
                this,
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    companion object {
        private const val CHANNEL_ID = "capture_service"
        private const val CHANNEL_NAME = "Capture service"
        private const val NOTIFICATION_ID = 1
    }
}
