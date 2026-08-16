package com.expensetracker.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class RawNotificationDaoTest {

    private lateinit var db: AppDatabase
    private lateinit var dao: RawNotificationDao

    @Before
    fun setUp() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        dao = db.rawNotificationDao()
    }

    @After
    fun tearDown() {
        db.close()
    }

    @Test
    fun insertAndQueryPending() = runBlocking {
        dao.insert(entity("uuid-1", "hash-1"))
        dao.insert(entity("uuid-2", "hash-2"))

        val pending = dao.pendingForSync(10)

        assertEquals(2, pending.size)
        assertEquals("uuid-1", pending[0].clientUuid)
        assertEquals(SYNC_PENDING, pending[0].syncStatus)
    }

    @Test
    fun dedupDetectsRecentHash() = runBlocking {
        dao.insert(entity("uuid-1", "hash-x"))

        assertTrue(dao.existsRecentHash("hash-x", cutoff = System.currentTimeMillis() + 1000))
        assertFalse(dao.existsRecentHash("hash-x", cutoff = System.currentTimeMillis() - 60_000))
    }

    @Test
    fun markSyncedRemovesFromPending() = runBlocking {
        dao.insert(entity("uuid-1", "hash-1"))
        dao.insert(entity("uuid-2", "hash-2"))

        dao.updateSyncStatus(SYNC_SYNCED, listOf("uuid-1"))

        val pending = dao.pendingForSync(10)
        assertEquals(1, pending.size)
        assertEquals("uuid-2", pending[0].clientUuid)
    }

    @Test
    fun pendingLimitRespected() = runBlocking {
        repeat(5) { dao.insert(entity("uuid-$it", "hash-$it")) }

        val pending = dao.pendingForSync(2)

        assertEquals(2, pending.size)
    }

    @Test
    fun countsUnsynced() = runBlocking {
        dao.insert(entity("uuid-1", "hash-1"))
        dao.insert(entity("uuid-2", "hash-2"))
        dao.updateSyncStatus(SYNC_SYNCED, listOf("uuid-1"))

        assertEquals(1, dao.countUnsynced())
    }

    private fun entity(clientUuid: String, contentHash: String) = RawNotificationEntity(
        clientUuid = clientUuid,
        deviceId = "device-1",
        packageName = "com.cimb.cimbocto",
        appLabel = "CIMB Octo",
        notificationKey = null,
        title = "Payment",
        textBody = "RM 5.00 to Kopitiam",
        bigText = null,
        subText = null,
        isGroupSummary = false,
        postedAt = System.currentTimeMillis(),
        contentHash = contentHash,
    )
}
