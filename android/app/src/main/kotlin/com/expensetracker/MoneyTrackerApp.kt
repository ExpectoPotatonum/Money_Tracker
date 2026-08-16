package com.expensetracker

import android.app.Application
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import com.expensetracker.sync.SyncScheduler
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

@HiltAndroidApp
class MoneyTrackerApp : Application(), Configuration.Provider {

    @Inject lateinit var workerConfig: Configuration

    @Inject lateinit var hiltWorkerFactory: HiltWorkerFactory

    @Inject lateinit var syncScheduler: SyncScheduler

    override val workManagerConfiguration: Configuration
        get() = workerConfig

    override fun onCreate() {
        super.onCreate()
        // First-launch scheduling; the boot receiver handles reboots.
        syncScheduler.scheduleAll()
    }
}
