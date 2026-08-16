package com.expensetracker.capture

import android.util.Log
import com.expensetracker.data.CaptureRepository
import com.expensetracker.sync.SyncScheduler
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class NotificationCaptureHandler @Inject constructor(
    private val repository: CaptureRepository,
    private val syncScheduler: SyncScheduler,
) {
    /**
     * The one thing the binder thread does besides reading the
     * notification (agents.md §6 step 2 / ARCHITECTURE.md §6). Fast,
     * synchronous Room write; everything after that is a WorkManager
     * job, never inline here.
     */
    fun capture(draft: RawNotificationDraft) {
        try {
            val result = kotlinx.coroutines.runBlocking { repository.insert(draft) }
            if (result is CaptureRepository.InsertResult.Inserted) {
                syncScheduler.requestSync()
            }
        } catch (t: Throwable) {
            Log.e(TAG, "capture failed for ${draft.packageName}", t)
        }
    }

    private companion object {
        const val TAG = "NotificationCapture"
    }
}
