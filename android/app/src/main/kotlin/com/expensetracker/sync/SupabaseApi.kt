package com.expensetracker.sync

import com.expensetracker.BuildConfig
import java.io.IOException
import java.time.Instant
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Thin, hand-rolled Supabase REST client (auth + PostgREST upserts).
 * Kept deliberately dependency-light and version-stable: OkHttp only, no
 * generated API bindings to drift. The anon key is public — RLS is the
 * boundary, and no service_role key ever exists in this app (agents.md §12).
 */
@Singleton
class SupabaseApi @Inject constructor(
    private val client: OkHttpClient,
) {
    private val baseUrl: String = BuildConfig.SUPABASE_URL.trimEnd('/')
    private val anonKey: String = BuildConfig.SUPABASE_ANON_KEY

    init {
        if (baseUrl.contains("placeholder") || anonKey.contains("placeholder")) {
            Log.w("SupabaseApi", "Running with placeholder SUPABASE_URL or SUPABASE_ANON_KEY. Sync will fail.")
        }
    }

    suspend fun signIn(email: String, password: String): SignInResponse = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("email", email)
            .put("password", password)
            .toString()
        val request = Request.Builder()
            .url("$baseUrl/auth/v1/token?grant_type=password")
            .post(body.toRequestBody(JSON_MEDIA_TYPE))
            .header(HEADER_APIS_KEY, anonKey)
            .header(HEADER_CONTENT_TYPE, JSON_MEDIA_TYPE.toString())
            .build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                val errorBody = response.body?.string()
                Log.e("SupabaseApi", "Sign in failed: HTTP ${response.code} - $errorBody")
                if ((response.code == 401) || (response.code == 403)) {
                    throw UnauthorizedException("Auth failed: HTTP ${response.code} - $errorBody")
                }
                throw IOException("auth failed: HTTP ${response.code} - $errorBody")
            }
            val json = JSONObject(response.body?.string().orEmpty())
            SignInResponse(
                accessToken = json.getString("access_token"),
                userId = json.getJSONObject("user").getString("id"),
            )
        }
    }

    data class SignInResponse(val accessToken: String, val userId: String)

    suspend fun upsertRawNotifications(rows: JSONArray, accessToken: String) {
        postUpsert("/rest/v1/raw_notifications", rows, "client_uuid", accessToken)
    }

    suspend fun upsertHeartbeat(row: JSONObject, accessToken: String) {
        postUpsert("/rest/v1/device_heartbeat", JSONArray().put(row), "device_id", accessToken)
    }

    private suspend fun postUpsert(path: String, body: JSONArray, conflictColumn: String, accessToken: String) {
        withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url("$baseUrl$path?on_conflict=$conflictColumn")
                .post(body.toString().toRequestBody(JSON_MEDIA_TYPE))
                .header(HEADER_APIS_KEY, anonKey)
                .header(HEADER_AUTHORIZATION, "Bearer $accessToken")
                .header(HEADER_CONTENT_TYPE, JSON_MEDIA_TYPE.toString())
                .header(HEADER_PREFER, "resolution=merge-duplicates,return=minimal")
                .build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    val errorBody = response.body?.string()
                    Log.e("SupabaseApi", "Request failed: HTTP ${response.code} - $errorBody")
                    if ((response.code == 401) || (response.code == 403)) {
                        throw UnauthorizedException("HTTP ${response.code}: $errorBody")
                    }
                    throw IOException("upsert failed: HTTP ${response.code} - $errorBody")
                }
            }
        }
    }

    class UnauthorizedException(message: String) : IOException(message)

    companion object {
        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
        private const val HEADER_APIS_KEY = "apikey"
        private const val HEADER_AUTHORIZATION = "Authorization"
        private const val HEADER_CONTENT_TYPE = "Content-Type"
        private const val HEADER_PREFER = "Prefer"

        fun iso8601(epochMillis: Long): String = Instant.ofEpochMilli(epochMillis).toString()
    }
}
