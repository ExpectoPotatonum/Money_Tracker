package com.expensetracker.capture

import com.expensetracker.data.RawNotificationEntity

/**
 * Mirrors the `raw_notifications` columns the capture service is
 * responsible for (agents.md §7). Every field maps 1:1 onto a column;
 * nothing is combined into a single blob, since §8's redaction pass and
 * §9's parsing both match against title/text_body/big_text/sub_text
 * separately.
 */
data class RawNotificationDraft(
    val clientUuid: String,
    val deviceId: String,
    val packageName: String,
    val appLabel: String?,
    val notificationKey: String?,
    val title: String?,
    val textBody: String?,
    val bigText: String?,
    val subText: String?,
    val isGroupSummary: Boolean,
    val postedAt: Long,
    val contentHash: String,
)

fun RawNotificationDraft.toEntity(): RawNotificationEntity = RawNotificationEntity(
    clientUuid = clientUuid,
    deviceId = deviceId,
    packageName = packageName,
    appLabel = appLabel,
    notificationKey = notificationKey,
    title = title,
    textBody = textBody,
    bigText = bigText,
    subText = subText,
    isGroupSummary = isGroupSummary,
    postedAt = postedAt,
    contentHash = contentHash,
)
