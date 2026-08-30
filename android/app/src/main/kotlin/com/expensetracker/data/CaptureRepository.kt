package com.expensetracker.data

import com.expensetracker.capture.RawNotificationDraft
import com.expensetracker.capture.toEntity
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Single mediator between capture and sync (ARCHITECTURE.md §3). Capture
 * hands it a draft; it owns the near-duplicate check and the insert.
 * Sync reads pending rows back out through the same interface.
 */
@Singleton
class CaptureRepository @Inject constructor(
    private val dao: RawNotificationDao,
) {
    suspend fun insert(draft: RawNotificationDraft): InsertResult {
        val now = System.currentTimeMillis()
        if (dao.existsRecentHash(draft.contentHash, cutoff = now - DEDUP_WINDOW_MILLIS)) {
            return InsertResult.Duplicate
        }
        val id = dao.insert(draft.toEntity())
        return InsertResult.Inserted(id)
    }

    suspend fun pendingForSync(limit: Int = SYNC_BATCH_SIZE): List<RawNotificationEntity> =
        dao.pendingForSync(limit)

    suspend fun markSynced(clientUuids: List<String>) =
        dao.updateSyncStatus(SYNC_SYNCED, clientUuids)

    suspend fun markFailed(clientUuids: List<String>) =
        dao.updateSyncStatus(SYNC_FAILED, clientUuids)

    suspend fun countUnsynced(): Int = dao.countUnsynced()

    suspend fun lastCapturedAt(): Long? = dao.lastCapturedAt()

    sealed interface InsertResult {
        data class Inserted(val id: Long) : InsertResult
        data object Duplicate : InsertResult
    }

    companion object {
        const val DEDUP_WINDOW_MILLIS = 5_000L
        const val SYNC_BATCH_SIZE = 50
    }
}
