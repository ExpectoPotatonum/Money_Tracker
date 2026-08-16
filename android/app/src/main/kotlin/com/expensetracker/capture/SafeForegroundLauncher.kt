package com.expensetracker.capture

import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat

/**
 * startForegroundService from a background context can throw on
 * Android 12+ (ForegroundServiceStartNotAllowedException). Every launch
 * point here is a wake-up moment (listener connect, boot, health-check
 * tick), but failures are survivable — the periodic health check retries.
 */
object SafeForegroundLauncher {
    fun start(context: Context, serviceClass: Class<*>) {
        try {
            ContextCompat.startForegroundService(context, Intent(context, serviceClass))
        } catch (e: Exception) {
            Log.w("SafeForegroundLauncher", "could not start foreground service", e)
        }
    }
}
