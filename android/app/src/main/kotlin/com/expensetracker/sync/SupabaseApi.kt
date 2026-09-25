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

    // ---------------------------------------------------------------- Phase 5
    // Quick-add manual-entry reads/writes (web mirror: api/transactions.js +
    // api/currencies.js + the accounts table). All RLS-scoped: listCategories /
    // listAccounts return only the signed-in user's rows.

    data class CategoryRow(val id: String, val name: String)

    data class AccountRow(val id: String, val name: String, val currency: String)

    /** Category options for the quick-add picker — ordered by name. */
    suspend fun listCategories(accessToken: String): List<CategoryRow> =
        getJsonArray("/rest/v1/categories", "id,name", "name", accessToken).mapNotNull { row ->
            val id = row.optString("id")
            if (id.isBlank()) null else CategoryRow(id, row.optString("name"))
        }

    /** Account options for the quick-add picker — ordered by name. */
    suspend fun listAccounts(accessToken: String): List<AccountRow> =
        getJsonArray("/rest/v1/accounts", "id,name,currency", "name", accessToken).mapNotNull { row ->
            val id = row.optString("id")
            if (id.isBlank()) null else AccountRow(id, row.optString("name"), row.optString("currency", "MYR"))
        }

    /**
     * Manual quick-add insert — a `source_package = 'manual'` row with no
     * raw_notifications link, confidence 'low' (202609060003's chk_manual_source
     * requires exactly that combination). Reuses the upsert path keyed on `id`
     * (server-generated uuid) so the auth/error handling is identical.
     */
    suspend fun insertTransaction(row: JSONObject, accessToken: String) {
        postUpsert("/rest/v1/transactions", JSONArray().put(row), "id", accessToken)
    }

    // ---------------------------------------------------------------- Phase 6
    // Recurring auto-entry (RecurringCheckWorker): read due cycles from
    // recurring_entries, materialize each as a manual is_recurring transaction,
    // then advance next_due_date. Exactly-once is the partial unique index
    // transactions_recurring_uq (202609250001) — this upsert uses
    // ignore-duplicates so a retried cycle no-ops instead of overwriting.

    data class RecurringEntry(
        val id: String,
        val name: String,
        val amount: Double,
        val currency: String,
        val direction: String,
        val categoryId: String?,
        val accountId: String?,
        val frequency: String,
        val intervalStep: Int,
        val dayOfMonth: Int?,
        val merchantRaw: String?,
        val notes: String?,
        val nextDueDate: String,
    ) {
        companion object {
            fun fromJson(row: JSONObject): RecurringEntry? {
                val id = row.optString("id")
                if (id.isBlank()) return null
                return RecurringEntry(
                    id = id,
                    name = row.optString("name"),
                    amount = row.optDouble("amount"),
                    currency = row.optString("currency", "MYR"),
                    direction = row.optString("direction"),
                    categoryId = row.optString("category_id").ifEmpty { null },
                    accountId = row.optString("account_id").ifEmpty { null },
                    frequency = row.optString("frequency"),
                    intervalStep = row.optInt("interval_step", 1).coerceAtLeast(1),
                    dayOfMonth = row.optInt("day_of_month", 0).takeIf { it in 1..31 },
                    merchantRaw = row.optString("merchant_raw").ifEmpty { null },
                    notes = row.optString("notes").ifEmpty { null },
                    nextDueDate = row.optString("next_due_date"),
                )
            }
        }
    }

    /** Active cycles whose next_due_date is on or before [dueOnOrBefore] (ISO date, MYT today). */
    suspend fun listDueRecurringEntries(accessToken: String, dueOnOrBefore: String): List<RecurringEntry> =
        getJsonArray(
            "/rest/v1/recurring_entries",
            "id,name,amount,currency,direction,category_id,account_id," +
                "frequency,interval_step,day_of_month,merchant_raw,notes,next_due_date",
            "next_due_date.asc",
            accessToken,
            filter = "active=eq.true&next_due_date=lte.$dueOnOrBefore",
        ).mapNotNull { RecurringEntry.fromJson(it) }

    /**
     * Materialize one recurring cycle. `recurring_entry_id` +
     * `recurring_due_date` are always set by RecurringMaterializer, so a retry
     * of the same cycle hits the partial unique index and no-ops.
     */
    suspend fun upsertRecurringTransaction(row: JSONObject, accessToken: String) {
        postUpsert(
            "/rest/v1/transactions",
            JSONArray().put(row),
            "recurring_entry_id,recurring_due_date",
            accessToken,
            prefer = "resolution=ignore-duplicates,return=minimal",
        )
    }

    /** Advance a cycle to its next due date once the current one is acked. */
    suspend fun advanceRecurringEntry(id: String, nextDueDate: String, accessToken: String) {
        withContext(Dispatchers.IO) {
            val body = JSONObject()
                .put("next_due_date", nextDueDate)
                .put("updated_at", iso8601(System.currentTimeMillis()))
            val request = Request.Builder()
                .url("$baseUrl/rest/v1/recurring_entries?id=eq.$id")
                .patch(body.toString().toRequestBody(JSON_MEDIA_TYPE))
                .header(HEADER_APIS_KEY, anonKey)
                .header(HEADER_AUTHORIZATION, "Bearer $accessToken")
                .header(HEADER_CONTENT_TYPE, JSON_MEDIA_TYPE.toString())
                .build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    val errorBody = response.body?.string()
                    Log.e("SupabaseApi", "PATCH recurring_entries failed: HTTP ${response.code} - $errorBody")
                    if ((response.code == 401) || (response.code == 403)) {
                        throw UnauthorizedException("HTTP ${response.code}: $errorBody")
                    }
                    throw IOException("PATCH recurring_entries failed: HTTP ${response.code} - $errorBody")
                }
            }
        }
    }

    private suspend fun getJsonArray(
        path: String,
        select: String,
        order: String,
        accessToken: String,
        filter: String? = null,
    ): List<JSONObject> = withContext(Dispatchers.IO) {
            val filterPart = if (filter.isNullOrBlank()) "" else "&$filter"
            val request = Request.Builder()
                .url("$baseUrl$path?select=$select&order=$order$filterPart")
                .get()
                .header(HEADER_APIS_KEY, anonKey)
                .header(HEADER_AUTHORIZATION, "Bearer $accessToken")
                .build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    val errorBody = response.body?.string()
                    Log.e("SupabaseApi", "GET $path failed: HTTP ${response.code} - $errorBody")
                    if ((response.code == 401) || (response.code == 403)) {
                        throw UnauthorizedException("HTTP ${response.code}: $errorBody")
                    }
                    throw IOException("GET $path failed: HTTP ${response.code} - $errorBody")
                }
                val body = response.body?.string().orEmpty()
                val array = runCatching { JSONArray(body) }.getOrNull()
                if (array == null) {
                    Log.w("SupabaseApi", "GET $path returned non-array body: ${body.take(160)}")
                    emptyList()
                } else {
                    (0 until array.length()).map { array.optJSONObject(it) ?: JSONObject() }
                }
            }
        }

    private suspend fun postUpsert(
        path: String,
        body: JSONArray,
        conflictColumn: String,
        accessToken: String,
        prefer: String = "resolution=merge-duplicates,return=minimal",
    ) {
        withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url("$baseUrl$path?on_conflict=$conflictColumn")
                .post(body.toString().toRequestBody(JSON_MEDIA_TYPE))
                .header(HEADER_APIS_KEY, anonKey)
                .header(HEADER_AUTHORIZATION, "Bearer $accessToken")
                .header(HEADER_CONTENT_TYPE, JSON_MEDIA_TYPE.toString())
                .header(HEADER_PREFER, prefer)
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
