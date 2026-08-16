package com.expensetracker.data

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Local mirror of a `raw_notifications` row (agents.md §7) plus the
 * sync bookkeeping columns that never leave the device. The text columns
 * hold the *untouched* original — §8's redaction runs only when the row
 * is turned into a sync payload, never on this stored copy.
 */
@Entity(
    tableName = "raw_notifications",
    indices = [Index(value = ["contentHash", "capturedAt"]), Index(value = ["syncStatus"])],
)
data class RawNotificationEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
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
    val capturedAt: Long = System.currentTimeMillis(),
    val contentHash: String,
    val syncStatus: String = SYNC_PENDING,
)

const val SYNC_PENDING = "pending"
const val SYNC_SYNCED = "synced"
const val SYNC_FAILED = "failed"
