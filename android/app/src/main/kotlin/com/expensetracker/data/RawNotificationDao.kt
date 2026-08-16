package com.expensetracker.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query

@Dao
interface RawNotificationDao {

    @Insert
    suspend fun insert(entity: RawNotificationEntity): Long

    /**
     * Near-duplicate detection at capture time (agents.md §6). The hash
     * is checked against rows written within [withinMillis] — the OS
     * reposting or updating what is logically the same notification.
     */
    @Query(
        """
        SELECT EXISTS(
            SELECT 1 FROM raw_notifications
            WHERE contentHash = :contentHash AND capturedAt > :cutoff
        )
        """,
    )
    suspend fun existsRecentHash(contentHash: String, cutoff: Long): Boolean

    @Query("SELECT * FROM raw_notifications WHERE syncStatus IN ('pending', 'failed') ORDER BY capturedAt ASC LIMIT :limit")
    suspend fun pendingForSync(limit: Int): List<RawNotificationEntity>

    @Query("UPDATE raw_notifications SET syncStatus = :status WHERE clientUuid IN (:clientUuids)")
    suspend fun updateSyncStatus(status: String, clientUuids: List<String>)

    @Query("SELECT COUNT(*) FROM raw_notifications WHERE syncStatus IN ('pending', 'failed')")
    suspend fun countUnsynced(): Int

    @Query("SELECT MAX(capturedAt) FROM raw_notifications")
    suspend fun lastCapturedAt(): Long?
}
