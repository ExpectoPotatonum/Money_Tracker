package com.expensetracker.capture

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import dagger.hilt.android.AndroidEntryPoint
import java.security.MessageDigest
import java.util.UUID
import javax.inject.Inject

/**
 * Phase-1 capture only (agents.md §14) — the listener writes to Room and
 * returns. No parsing, no sanitization, no network on this thread; the
 * only work past the synchronous write is handing a sync request to
 * WorkManager (agents.md §6 step 4).
 */
@AndroidEntryPoint
class CaptureNotificationListenerService : NotificationListenerService() {

    @Inject lateinit var handler: NotificationCaptureHandler

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val packageName = sbn.packageName
        if (packageName !in TargetPackages.ALL) return

        val extras = sbn.notification.extras

        // getCharSequence(), not getString(). Notification.Builder stores
        // these via putCharSequence() — if the source app styled the
        // amount (a SpannableString rather than a plain String, which
        // several banking apps do to bold it), getString() silently
        // returns null instead of throwing. getCharSequence() works
        // either way.
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()
        val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()
        val subText = extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString()
        val isGroupSummary = (sbn.notification.flags and Notification.FLAG_GROUP_SUMMARY) != 0

        // Near-duplicate detection at capture time (agents.md §6) — the
        // hash is computed before insert, and the repository refuses the
        // row if the same hash landed within the dedup window.
        val contentHash = sha256("$packageName|$title|$text|$bigText")

        val draft = RawNotificationDraft(
            clientUuid = UUID.randomUUID().toString(),
            deviceId = DeviceIdProvider.get(applicationContext),
            packageName = packageName,
            appLabel = AppLabelResolver.get(applicationContext, packageName),
            notificationKey = sbn.key,
            title = title,
            textBody = text,
            bigText = bigText,
            subText = subText,
            isGroupSummary = isGroupSummary,
            postedAt = sbn.postTime, // when the source app posted it
            // capturedAt is intentionally not set here — defaults to
            // now() at insert (agents.md §7 distinguishes the two).
            contentHash = contentHash,
        )

        handler.capture(draft)
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        ListenerState.bound = true
        Log.i(TAG, "listener connected")
        SafeForegroundLauncher.start(this, NotificationCaptureService::class.java)
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        ListenerState.bound = false
        Log.w(TAG, "listener disconnected — requestRebind will be triggered by the health check")
    }

    private fun sha256(input: String): String =
        MessageDigest.getInstance("SHA-256")
            .digest(input.toByteArray())
            .joinToString("") { "%02x".format(it) }

    private companion object {
        const val TAG = "CaptureListener"
    }
}
