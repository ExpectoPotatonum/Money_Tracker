package com.expensetracker.sync

import android.content.Context
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.expensetracker.BuildConfig
import com.expensetracker.capture.DeviceIdProvider
import com.expensetracker.capture.ListenerState
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import java.io.IOException
import org.json.JSONObject

/**
 * Writes `device_heartbeat` on every wake (agents.md §10) so the
 * dashboard can tell a dead capture pipeline from an idle one. Fields
 * mirror the schema: last_seen_at, listener_connected,
 * notification_access_granted, battery_unrestricted, app_version.
 */
@HiltWorker
class HeartbeatWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted params: WorkerParameters,
    private val api: SupabaseApi,
    private val authStore: AuthStore,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val token = runCatching { authStore.accessToken ?: signIn() }.getOrNull()
        if (token == null) return Result.retry()

        val context = applicationContext
        val row = JSONObject()
            .put("device_id", DeviceIdProvider.get(context))
            .put("last_seen_at", SupabaseApi.iso8601(System.currentTimeMillis()))
            .put("listener_connected", ListenerState.bound)
            .put("notification_access_granted", isListenerAccessGranted(context))
            .put("battery_unrestricted", isBatteryUnrestricted(context))
            .put("app_version", BuildConfig.VERSION_NAME)

        return try {
            api.upsertHeartbeat(row, token)
            Result.success()
        } catch (_: IOException) {
            Result.retry()
        }
    }

    private suspend fun signIn(): String {
        val email = authStore.email
        val password = authStore.password
        if (email.isBlank() || password.isBlank()) throw IOException("no credentials configured")
        return api.signIn(email, password).also { authStore.accessToken = it }
    }

    companion object {
        const val WORK_NAME = "heartbeat"

        fun isListenerAccessGranted(context: Context): Boolean {
            val enabled = Settings.Secure.getString(
                context.contentResolver,
                "enabled_notification_listeners",
            ).orEmpty()
            val component = "${context.packageName}/com.expensetracker.capture.CaptureNotificationListenerService"
            return enabled.split(":").contains(component)
        }

        private fun isBatteryUnrestricted(context: Context): Boolean {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true
            val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
            return pm.isIgnoringBatteryOptimizations(context.packageName)
        }
    }
}
