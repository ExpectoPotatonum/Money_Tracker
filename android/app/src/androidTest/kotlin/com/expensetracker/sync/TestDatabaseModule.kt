package com.expensetracker.sync

import android.content.Context
import androidx.room.Room
import com.expensetracker.data.AppDatabase
import com.expensetracker.data.RawNotificationDao
import com.expensetracker.di.AppModule
import dagger.Module
import dagger.Provides
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import dagger.hilt.testing.TestInstallIn
import javax.inject.Singleton

@TestInstallIn(
    components = [SingletonComponent::class],
    replaces = [AppModule::class],
)
@Module
object TestDatabaseModule {

    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context): AppDatabase =
        Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()

    @Provides
    @Singleton
    fun provideRawNotificationDao(database: AppDatabase): RawNotificationDao =
        database.rawNotificationDao()
}
