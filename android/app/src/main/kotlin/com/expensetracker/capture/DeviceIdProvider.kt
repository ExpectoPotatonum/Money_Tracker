package com.expensetracker.capture

import android.content.Context
import android.provider.Settings

object DeviceIdProvider {
    fun get(context: Context): String {
        val androidId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
        return androidId ?: "unknown"
    }
}
