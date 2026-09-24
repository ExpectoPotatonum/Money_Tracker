package com.expensetracker.parse

import java.io.IOException
import java.net.URLEncoder
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

/**
 * Thin Gemini wrapper for quick-add parsing — a Kotlin port of the web's
 * utils/llm.js. Single provider behind a small interface; returns a structured
 * result and never throws. If the configured model name is dead (Google retires
 * flash preview names periodically), transparently retries once with the
 * default model, exactly like the web.
 */
@Singleton
class LlmClient @Inject constructor(
    private val client: OkHttpClient,
    private val settings: LlmSettings,
) {

    /** Result classification mirrors utils/llm.js — see [Kind]. */
    data class LlmResult(
        val ok: Boolean,
        val text: String? = null,
        val kind: Kind? = null,
        val status: Int = 0,
        val reason: String? = null,
    ) {
        enum class Kind { NETWORK, MODEL, QUOTA, HTTP, EMPTY, CONFIG }
    }

    suspend fun call(prompt: String): LlmResult = withContext(Dispatchers.IO) {
        if (!settings.enabled || settings.apiKey.isBlank()) {
            return@withContext LlmResult(ok = false, kind = LlmResult.Kind.CONFIG)
        }
        val configuredModel = settings.model
        var result = singleCall(configuredModel, settings.apiKey, prompt)
        val modelNotFound = result.status == 404 && configuredModel != LlmSettings.DEFAULT_MODEL
        if (modelNotFound) {
            result = singleCall(LlmSettings.DEFAULT_MODEL, settings.apiKey, prompt)
        }
        classify(result)
    }

    private fun classify(result: LlmResult): LlmResult {
        if (result.ok) return result
        return when {
            result.status == 404 -> result.copy(kind = LlmResult.Kind.MODEL)
            result.status == 429 || result.status == 403 -> result.copy(kind = LlmResult.Kind.QUOTA)
            result.status == 0 -> result.copy(kind = LlmResult.Kind.NETWORK)
            result.kind == LlmResult.Kind.EMPTY -> result
            else -> result.copy(kind = LlmResult.Kind.HTTP)
        }
    }

    private fun singleCall(model: String, apiKey: String, prompt: String): LlmResult {
        val url = "$ENDPOINT/${model}:generateContent?key=${URLEncoder.encode(apiKey, "UTF-8")}"
        val body = JSONObject()
            .put(
                "contents",
                JSONArray().put(
                    JSONObject()
                        .put("role", "user")
                        .put("parts", JSONArray().put(JSONObject().put("text", prompt))),
                ),
            )
            .put("generationConfig", JSONObject().put("temperature", 0.1))
            .toString()
        val request = Request.Builder()
            .url(url)
            .post(body.toRequestBody(JSON_MEDIA_TYPE))
            .build()
        return try {
            callClient.newCall(request).execute().use { response ->
                val responseBody = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    LlmResult(ok = false, status = response.code, reason = responseBody.take(160))
                } else {
                    val text = extractReplyText(runCatching { JSONObject(responseBody) }.getOrNull())
                    if (text.isBlank()) {
                        LlmResult(ok = false, kind = LlmResult.Kind.EMPTY, status = 200, reason = "empty reply")
                    } else {
                        LlmResult(ok = true, text = text.take(MAX_RESPONSE_CHARS), status = 200)
                    }
                }
            }
        } catch (e: IOException) {
            LlmResult(ok = false, status = 0, reason = e.message)
        }
    }

    /** candidates[0].content.parts[*].text joined — mirrors llm.js singleCall. */
    private fun extractReplyText(data: JSONObject?): String {
        if (data == null) return ""
        val candidates = data.optJSONArray("candidates") ?: return ""
        if (candidates.length() == 0) return ""
        val content = candidates.optJSONObject(0)?.optJSONObject("content") ?: return ""
        val parts = content.optJSONArray("parts") ?: return ""
        val sb = StringBuilder()
        for (i in 0 until parts.length()) {
            sb.append(parts.optJSONObject(i)?.optString("text").orEmpty())
        }
        return sb.toString()
    }

    private val callClient: OkHttpClient = client.newBuilder()
        .callTimeout(TIMEOUT_MS, TimeUnit.MILLISECONDS)
        .build()

    private companion object {
        const val ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models"
        const val TIMEOUT_MS = 45_000L
        const val MAX_RESPONSE_CHARS = 8192
        val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
    }
}