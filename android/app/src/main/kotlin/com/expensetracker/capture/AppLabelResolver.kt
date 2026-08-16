package com.expensetracker.capture

import android.content.Context
import android.content.pm.PackageManager
import java.util.concurrent.ConcurrentHashMap

/**
 * Caches package display names so the binder thread never hits
 * PackageManager repeatedly — getApplicationLabel is cheap but not free,
 * and capture is supposed to be a fast synchronous write (agents.md §6).
 */
object AppLabelResolver {
    private val cache = ConcurrentHashMap<String, String?>()

    fun get(context: Context, packageName: String): String? {
        cache[packageName]?.let { return it }
        val label = runCatching {
            val info = context.packageManager.getApplicationInfo(packageName, 0)
            context.packageManager.getApplicationLabel(info)?.toString()
        }.getOrNull()
        cache[packageName] = label
        return label
    }
}
