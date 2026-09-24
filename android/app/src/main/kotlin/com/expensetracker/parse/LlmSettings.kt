package com.expensetracker.parse

import android.content.Context
import android.content.SharedPreferences
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * On-device LLM settings for the quick-add voice/text parse (Phase 5).
 * Mirrors the web's localStorage keys (lib/settings.js): the Gemini API key is
 * stored on-device in plain SharedPreferences — same trust model as the web's
 * localStorage and the app's existing credentials store. Single-user app; the
 * key never leaves the device and is never sent to Supabase.
 */
@Singleton
class LlmSettings @Inject constructor(
    @ApplicationContext context: Context,
) {
    private val prefs: SharedPreferences =
        context.getSharedPreferences("llm_settings", Context.MODE_PRIVATE)

    var apiKey: String
        get() = prefs.getString(KEY_API_KEY, "").orEmpty()
        set(value) = prefs.edit().putString(KEY_API_KEY, value).apply()

    var model: String
        get() = prefs.getString(KEY_MODEL, null) ?: DEFAULT_MODEL
        set(value) = prefs.edit().putString(KEY_MODEL, value).apply()

    var enabled: Boolean
        get() = prefs.getString(KEY_ENABLED, null) != "0"
        set(value) = prefs.edit().putString(KEY_ENABLED, if (value) "1" else "0").apply()

    companion object {
        const val DEFAULT_MODEL = "gemini-2.5-flash"

        private const val KEY_API_KEY = "llm_api_key"
        private const val KEY_MODEL = "llm_model"
        private const val KEY_ENABLED = "llm_enabled"
    }
}