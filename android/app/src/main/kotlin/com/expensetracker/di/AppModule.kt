package com.expensetracker.di

import android.content.Context
import androidx.room.Room
import com.expensetracker.data.AppDatabase
import com.expensetracker.data.RawNotificationDao
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context): AppDatabase =
        Room.databaseBuilder(
            context,
            AppDatabase::class.java,
            "expense-tracker.db",
        ).build()

    @Provides
    @Singleton
    fun provideRawNotificationDao(database: AppDatabase): RawNotificationDao =
        database.rawNotificationDao()
}
