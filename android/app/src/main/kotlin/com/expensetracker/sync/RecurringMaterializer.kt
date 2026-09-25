package com.expensetracker.sync

import java.time.LocalDate
import java.time.ZoneId
import kotlin.math.min
import org.json.JSONObject

/**
 * Pure Phase-6 logic behind RecurringCheckWorker (import-candidate-features.md
 * §4.5): given a due RecurringEntry, produce the materialized manual row and
 * the next due date. The phone owns the clock — the worker runs on every app
 * wake/capture and a daily periodic — and dedup (the partial unique index
 * transactions_recurring_uq, 202609250001) keeps a rerun from double-recording
 * a cycle.
 *
 * Dates are anchored to Asia/Kuala_Lumpur like the dashboard: a cycle due on
 * 2026-09-01 is recorded at 00:00 MYT (2026-08-31T16:00:00Z).
 */
object RecurringMaterializer {

    val MYT: ZoneId = ZoneId.of("Asia/Kuala_Lumpur")

    /** "today" in the dashboard's pinned zone — the worker's due filter bound. */
    fun todayMyt(): LocalDate = LocalDate.now(MYT)

    /** The cycle's transaction time: 00:00 MYT on the due date, as UTC ISO-8601. */
    fun dueInstantIso(dueDate: LocalDate, zoneId: ZoneId = MYT): String =
        dueDate.atStartOfDay(zoneId).toInstant().toString()

    /**
     * Next cycle after [nextDue] advances one interval_step from the due date
     * itself (never recomputed from "now"), so a lagged catch-up backfills the
     * missed cycle and only that cycle. Monthly honors day_of_month by clamping
     * to the target month's length (Jan 31 -> Feb 28).
     */
    fun advance(nextDue: LocalDate, frequency: String, intervalStep: Int, dayOfMonth: Int?): LocalDate =
        when (frequency) {
            "daily" -> nextDue.plusDays(intervalStep.toLong())
            "weekly" -> nextDue.plusWeeks(intervalStep.toLong())
            "monthly" -> advanceMonthly(nextDue, intervalStep, dayOfMonth)
            "yearly" -> nextDue.plusYears(intervalStep.toLong())
            else -> nextDue.plusMonths(intervalStep.toLong()) // DB check() makes this unreachable
        }

    private fun advanceMonthly(nextDue: LocalDate, intervalStep: Int, dayOfMonth: Int?): LocalDate {
        val base = nextDue.plusMonths(intervalStep.toLong())
        if (dayOfMonth == null) return base
        return LocalDate.of(base.year, base.monthValue, min(dayOfMonth, base.lengthOfMonth()))
    }

    /**
     * The manual row a materialized cycle inserts. Satisfies 202609060003's
     * chk_manual_source (source_package 'manual', confidence 'low', no
     * raw_notification_id) and carries the dedup pair.
     */
    fun buildRow(
        entry: SupabaseApi.RecurringEntry,
        dueDate: LocalDate,
        sourceAppLabel: String,
        zoneId: ZoneId = MYT,
    ): JSONObject {
        val txnInstant = dueInstantIso(dueDate, zoneId)
        return JSONObject()
            .put("recurring_entry_id", entry.id)
            .put("recurring_due_date", dueDate.toString())
            .put("amount", entry.amount)
            .put("currency", entry.currency)
            .put("direction", entry.direction)
            .put("merchant_raw", entry.merchantRaw ?: entry.name)
            .put("category_id", entry.categoryId ?: JSONObject.NULL)
            .put("account_id", entry.accountId ?: JSONObject.NULL)
            .put("transaction_date", txnInstant)
            .put("notification_posted_at", txnInstant)
            .put("source_package", "manual")
            .put("source_app_label", sourceAppLabel.ifBlank { ManualTransactionBuilder.DEFAULT_SOURCE })
            .put("confidence", "low")
            .put("status", "confirmed")
            .put("is_recurring", true)
            .put("notes", entry.notes ?: JSONObject.NULL)
    }
}
