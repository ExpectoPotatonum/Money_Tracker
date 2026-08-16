package com.expensetracker.sync

import android.content.Context
import android.content.SharedPreferences
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * v1 credentials store. Single-user app (§5 of agents.md); email/password
 * are held in plain SharedPreferences so the sync workers can sign in
 * unattended. Not a secret in the app-code sense (the user types these
 * in); upgrading to KeyStore-backed storage is a later, cheap change.
 * The anon key is public by design — RLS is the security boundary.
 */
@Singleton
class AuthStore @Inject constructor(
    @ApplicationContext context: Context,
) {
    private val prefs: SharedPreferences =
        context.getSharedPreferences("supabase_auth", Context.MODE_PRIVATE)

    var email: String
        get() = prefs.getString(KEY_EMAIL, "").orEmpty()
        set(value) = prefs.edit().putString(KEY_EMAIL, value).apply()

    var password: String
        get() = prefs.getString(KEY_PASSWORD, "").orEmpty()
        set(value) = prefs.edit().putString(KEY_PASSWORD, value).apply()

    var accessToken: String?
        get() = prefs.getString(KEY_ACCESS_TOKEN, null)
        set(value) = prefs.edit().putString(KEY_ACCESS_TOKEN, value).apply()

    fun hasCredentials(): Boolean = email.isNotBlank() && password.isNotBlank()

    private companion object {
        const val KEY_EMAIL = "email"
        const val KEY_PASSWORD = "password"
        const val KEY_ACCESS_TOKEN = "access_token"
    }
}
