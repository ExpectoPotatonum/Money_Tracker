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

    suspend fun signIn(email: String, password: String): String = withContext(Dispatchers.IO) {
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
            if (!response.isSuccessful) throw IOException("auth failed: HTTP ${response.code}")
            val json = JSONObject(response.body?.string().orEmpty())
            json.getString("access_token")
        }
    }

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
                if (!response.isSuccessful) throw IOException("upsert failed: HTTP ${response.code}")
            }
        }
    }

    companion object {
        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
        private const val HEADER_APIS_KEY = "apikey"
        private const val HEADER_AUTHORIZATION = "Authorization"
        private const val HEADER_CONTENT_TYPE = "Content-Type"
        private const val HEADER_PREFER = "Prefer"

        fun iso8601(epochMillis: Long): String = Instant.ofEpochMilli(epochMillis).toString()
    }
}
