package com.expensetracker.sync

import androidx.hilt.work.HiltWorkerFactory
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.work.ListenableWorker
import androidx.work.testing.TestListenableWorkerBuilder
import com.expensetracker.MoneyTrackerApp
import com.expensetracker.capture.RawNotificationDraft
import com.expensetracker.data.CaptureRepository
import dagger.hilt.android.testing.HiltAndroidRule
import dagger.hilt.android.testing.HiltAndroidTest
import io.mockk.any
import io.mockk.coEvery
import io.mockk.eq
import java.io.IOException
import javax.inject.Inject
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class NotificationSyncWorkerTest {

    @get:Rule
    val hiltRule = HiltAndroidRule(this)

    @Inject lateinit var repository: CaptureRepository
    @Inject lateinit var authStore: AuthStore
    @Inject lateinit var api: SupabaseApi
    @Inject lateinit var hiltWorkerFactory: HiltWorkerFactory

    @Before
    fun setUp() {
        hiltRule.inject()
    }

    @Test
    fun successMarksRowsSynced() = runBlocking {
        repository.insert(draft("uuid-a"))
        repository.insert(draft("uuid-b"))
        authStore.accessToken = "test-token"

        coEvery { api.upsertRawNotifications(any(), eq("test-token")) } returns Unit

        val context = ApplicationProvider.getApplicationContext<MoneyTrackerApp>()
        val worker = TestListenableWorkerBuilder.from(context, NotificationSyncWorker::class.java)
            .setWorkerFactory(hiltWorkerFactory)
            .build()

        val result = worker.doWork()

        assertTrue(result is ListenableWorker.Result.Success)
        assertEquals(0, repository.pendingForSync().size)
    }

    @Test
    fun retryOnNetworkFailure() = runBlocking {
        repository.insert(draft("uuid-c"))
        authStore.accessToken = "test-token"

        coEvery { api.upsertRawNotifications(any(), any()) } throws IOException("boom")

        val context = ApplicationProvider.getApplicationContext<MoneyTrackerApp>()
        val worker = TestListenableWorkerBuilder.from(context, NotificationSyncWorker::class.java)
            .setWorkerFactory(hiltWorkerFactory)
            .build()

        val result = worker.doWork()

        assertTrue(result is ListenableWorker.Result.Retry)
        assertEquals(1, repository.pendingForSync().size)
    }

    private fun draft(clientUuid: String) = RawNotificationDraft(
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
        contentHash = "hash-$clientUuid",
    )
}
