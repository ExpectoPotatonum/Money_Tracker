package com.expensetracker.capture

import android.app.Notification
import android.content.Context
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import java.security.MessageDigest
import java.util.UUID

/**
 * Phase-1 capture only (agents.md §14) — no parsing, no sanitization,
 * no network. Every field maps 1:1 onto a raw_notifications column
 * (agents.md §7); nothing is combined into a single blob, since §8's
 * redaction pass and §9's parsing both match against title/text_body/
 * big_text/sub_text separately.
 *
 * TODO: wire captureDao (Room) in via Hilt once the data layer exists
 * (ARCHITECTURE.md §3 — /android/.../data). saveToRoom() and
 * isRecentDuplicate() are stand-ins until then.
 */
class CaptureNotificationListenerService : NotificationListenerService() {

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
        // hash is computed and checked before insert, not after.
        val contentHash = sha256("$packageName|$title|$text|$bigText")
        if (isRecentDuplicate(contentHash)) return

        val row = RawNotificationDraft(
            clientUuid = UUID.randomUUID().toString(),
            deviceId = DeviceIdProvider.get(applicationContext),
            packageName = packageName,
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

        // Room only. Nothing here ever touches the network or Supabase
        // directly — sync is a separate WorkManager job (agents.md §6
        // step 4 / §11), never inline in this callback.
        saveToRoom(row)
    }

    private fun sha256(input: String): String =
        MessageDigest.getInstance("SHA-256")
            .digest(input.toByteArray())
            .joinToString("") { "%02x".format(it) }

    // TODO: captureDao.existsRecentHash(contentHash, withinMillis = 5_000)
    private fun isRecentDuplicate(contentHash: String): Boolean = false

    // TODO: captureDao.insert(row.toEntity())
    private fun saveToRoom(row: RawNotificationDraft) { /* TODO */ }
}

/** Mirrors the raw_notifications columns this service is responsible for. */
data class RawNotificationDraft(
    val clientUuid: String,
    val deviceId: String,
    val packageName: String,
    val notificationKey: String?,
    val title: String?,
    val textBody: String?,
    val bigText: String?,
    val subText: String?,
    val isGroupSummary: Boolean,
    val postedAt: Long,
    val contentHash: String,
)

object DeviceIdProvider {
    fun get(context: Context): String =
        Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
}
