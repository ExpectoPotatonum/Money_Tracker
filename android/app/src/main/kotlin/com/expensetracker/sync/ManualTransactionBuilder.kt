package com.expensetracker.sync

import com.expensetracker.parse.TransactionDraft
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import org.json.JSONObject

/**
 * Builds the manual quick-add row for Supabase — a Kotlin mirror of the web's
 * nlModal.js save handler. A manual row must satisfy migration 202609060003's
 * chk_manual_source constraint: `raw_notification_id` absent, `source_package`
 * = 'manual', `confidence` = 'low'. Only `source_app_label` carries the
 * payment method; `source_package` stays 'manual' (matches the web).
 *
 * Pure on purpose (no android.* imports): the shape is unit-tested as the
 * contract the check constraint and the web insert share.
 */
object ManualTransactionBuilder {

    /** Mirrors web utils/sources.js DEFAULT_SOURCE + SOURCE_PRESETS. */
    const val DEFAULT_SOURCE = "Cash"
    val SOURCE_PRESETS = listOf("Cash", "Bank", "e-Wallet", "Manual", "Card")

    private val LOCAL_FORMAT: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")

    /** "2026-09-06 10:00" (device-local wall clock) -> ISO-8601 UTC, or null when unparseable. */
    fun localDateTextToIso(text: String?, zoneId: ZoneId = ZoneId.systemDefault()): String? {
        val s = text?.trim().orEmpty()
        if (s.isBlank()) return null
        return try {
            LocalDateTime.parse(s, LOCAL_FORMAT).atZone(zoneId).toInstant().toString()
        } catch (_: DateTimeParseException) {
            null
        }
    }

    /** Draft's transaction time rendered for the preview date field, in [zoneId]. */
    fun draftLocalText(draft: TransactionDraft, zoneId: ZoneId = ZoneId.systemDefault()): String =
        try {
            Instant.parse(draft.transactionDateIso)
                .atZone(zoneId)
                .toLocalDateTime()
                .format(LOCAL_FORMAT)
        } catch (_: Exception) {
            LOCAL_FORMAT.format(LocalDateTime.now(zoneId))
        }

    fun build(
        amount: Double,
        direction: TransactionDraft.Direction,
        currency: String,
        merchantRaw: String?,
        categoryId: String?,
        accountId: String,
        transactionDateIso: String,
        sourceLabel: String,
        notes: String?,
    ): JSONObject = JSONObject()
        .put("amount", amount)
        .put("currency", currency)
        .put("direction", direction.column)
        .put("merchant_raw", merchantRaw ?: JSONObject.NULL)
        .put("category_id", categoryId ?: JSONObject.NULL)
        .put("account_id", accountId)
        .put("transaction_date", transactionDateIso)
        .put("notes", notes ?: JSONObject.NULL)
        .put("source_package", "manual")
        .put("source_app_label", sourceLabel.ifBlank { DEFAULT_SOURCE })
        .put("confidence", "low")
        .put("status", "confirmed")
        .put("notification_posted_at", transactionDateIso)
}
