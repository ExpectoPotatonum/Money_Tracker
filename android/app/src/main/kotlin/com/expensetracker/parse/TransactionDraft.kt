package com.expensetracker.parse

import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeParseException
import org.json.JSONObject

/**
 * A normalized quick-add transaction — the Kotlin mirror of the web's
 * utils/ai.js normalize(). The category stays by NAME so the caller (which
 * holds the category list) resolves it to an id at insert time; account
 * selection is a UI concern, not part of the parse.
 */
data class TransactionDraft(
    val amount: Double,
    val direction: Direction,
    val currency: String,
    val merchantRaw: String?,
    val categoryName: String?,
    val transactionDateIso: String,
    val notes: String?,
) {
    enum class Direction(val column: String) {
        DEBIT("debit"),
        CREDIT("credit");
    }
}

/**
 * Strict normalization of an LLM reply into a usable [TransactionDraft], or
 * null when nothing usable can be extracted — gates mirror the web: `usable`
 * must be true, amount positive, direction debit/credit, currency in the
 * supported set (fallback MYR), dates tolerant.
 */
object TransactionNormalizer {

    /** v1 currency set — mirrors format.js CURRENCY_OPTIONS (DB table fallback). */
    val SUPPORTED_CURRENCIES = setOf("MYR", "CNY", "TWD", "USD", "SGD")
    private const val MAX_TEXT = 255

    fun normalize(raw: JSONObject?): TransactionDraft? {
        if (raw == null) return null
        val usable = raw.optBoolean("usable", false) || raw.optString("usable") == "true"
        if (!usable) return null

        val amount = raw.optDouble("amount", Double.NaN)
        if (!amount.isFinite() || amount <= 0.0) return null

        val direction = when (raw.optString("direction", "").lowercase()) {
            "debit" -> TransactionDraft.Direction.DEBIT
            "credit" -> TransactionDraft.Direction.CREDIT
            else -> return null
        }

        var currency = raw.optString("currency", "MYR").uppercase().trim()
        if (currency !in SUPPORTED_CURRENCIES) currency = "MYR"

        return TransactionDraft(
            amount = Math.round(amount * 100) / 100.0,
            direction = direction,
            currency = currency,
            merchantRaw = raw.optString("merchant_raw", "").trim().takeIf { it.isNotBlank() }?.take(MAX_TEXT),
            categoryName = raw.optString("category", "").trim().takeIf { it.isNotBlank() }?.take(MAX_TEXT),
            transactionDateIso = parseDate(raw.optString("transaction_date")).toString(),
            notes = raw.optString("notes", "").trim().takeIf { it.isNotBlank() }?.take(MAX_TEXT),
        )
    }

    private fun parseDate(raw: String?): Instant {
        val s = raw?.trim().orEmpty()
        if (s.isBlank()) return Instant.now()
        // ISO 8601 with offset ("2026-09-06T10:00:00+08:00") — the prompt's shape.
        try {
            return OffsetDateTime.parse(s).toInstant()
        } catch (_: DateTimeParseException) {
            // Fall back to a bare date ("2026-09-06") as UTC midnight.
        }
        try {
            return LocalDate.parse(s).atStartOfDay(ZoneOffset.UTC).toInstant()
        } catch (_: DateTimeParseException) {
            return Instant.now()
        }
    }
}