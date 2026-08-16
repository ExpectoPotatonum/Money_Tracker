package com.expensetracker.sync

import com.expensetracker.di.NetworkModule
import dagger.Module
import dagger.Provides
import dagger.hilt.components.SingletonComponent
import dagger.hilt.testing.TestInstallIn
import io.mockk.mockk
import javax.inject.Singleton

@TestInstallIn(
    components = [SingletonComponent::class],
    replaces = [NetworkModule::class],
)
@Module
object TestNetworkModule {

    @Provides
    @Singleton
    fun provideSupabaseApi(): SupabaseApi = mockk()

    @Provides
    @Singleton
    fun provideOkHttpClient(): okhttp3.OkHttpClient = okhttp3.OkHttpClient()
}
