package com.expensetracker.sync

import com.expensetracker.parse.TransactionDraft
import java.time.ZoneId
import org.json.JSONObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ManualTransactionBuilderTest {

    private val draft = TransactionDraft(
        amount = 12.5,
        direction = TransactionDraft.Direction.DEBIT,
        currency = "MYR",
        merchantRaw = "Starbucks",
        categoryName = "Food & Dining",
        transactionDateIso = "2026-09-06T02:00:00Z",
        notes = null,
    )

    @Test
    fun `build produces a manual row conforming to chk_manual_source`() {
        val json = ManualTransactionBuilder.build(
            amount = draft.amount,
            direction = draft.direction,
            currency = draft.currency,
            merchantRaw = draft.merchantRaw,
            categoryId = "cat-1",
            accountId = "acc-1",
            transactionDateIso = draft.transactionDateIso,
            sourceLabel = "e-Wallet",
            notes = null,
        )
        assertEquals(12.5, json.getDouble("amount"), 0.0001)
        assertEquals("MYR", json.getString("currency"))
        assertEquals("debit", json.getString("direction"))
        assertEquals("Starbucks", json.getString("merchant_raw"))
        assertEquals("cat-1", json.getString("category_id"))
        assertEquals("acc-1", json.getString("account_id"))
        assertEquals("e-Wallet", json.getString("source_app_label"))
        assertTrue(json.isNull("notes"))
        // The 202609060003 constraint trio.
        assertEquals("manual", json.getString("source_package"))
        assertEquals("low", json.getString("confidence"))
        assertTrue(!json.has("raw_notification_id"))
        assertEquals("confirmed", json.getString("status"))
        assertEquals(draft.transactionDateIso, json.getString("notification_posted_at"))
    }

    @Test
    fun `credit direction uses credit column value`() {
        val json = ManualTransactionBuilder.build(
            amount = 1.0,
            direction = TransactionDraft.Direction.CREDIT,
            currency = "MYR",
            merchantRaw = null,
            categoryId = null,
            accountId = "acc-1",
            transactionDateIso = "2026-09-06T02:00:00Z",
            sourceLabel = "Cash",
            notes = null,
        )
        assertEquals("credit", json.getString("direction"))
        assertTrue(json.isNull("merchant_raw"))
        assertTrue(json.isNull("category_id"))
    }

    @Test
    fun `blank source label falls back to Cash`() {
        val json = ManualTransactionBuilder.build(
            amount = 1.0,
            direction = TransactionDraft.Direction.DEBIT,
            currency = "MYR",
            merchantRaw = null,
            categoryId = null,
            accountId = "acc-1",
            transactionDateIso = "^invalid",
            sourceLabel = "   ",
            notes = null,
        )
        assertEquals(ManualTransactionBuilder.DEFAULT_SOURCE, json.getString("source_app_label"))
    }

    @Test
    fun `local date text converts to utc iso in the given zone`() {
        val zone = ZoneId.of("Asia/Kuala_Lumpur")
        val iso = ManualTransactionBuilder.localDateTextToIso("2026-09-06 10:00", zone)
        assertEquals("2026-09-06T02:00:00Z", iso)
    }

    @Test
    fun `blank or malformed local date text returns null`() {
        val zone = ZoneId.of("Asia/Kuala_Lumpur")
        assertNull(ManualTransactionBuilder.localDateTextToIso("   ", zone))
        assertNull(ManualTransactionBuilder.localDateTextToIso("yesterday", zone))
    }

    @Test
    fun `draft local text renders in the given zone`() {
        val text = ManualTransactionBuilder.draftLocalText(draft, ZoneId.of("Asia/Kuala_Lumpur"))
        assertEquals("2026-09-06 10:00", text)
    }

    @Test
    fun `result is a strict json object`() {
        val json = ManualTransactionBuilder.build(
            amount = 12.34,
            direction = TransactionDraft.Direction.DEBIT,
            currency = "MYR",
            merchantRaw = "Nasi Kandar",
            categoryId = "cat-9",
            accountId = "acc-9",
            transactionDateIso = "2026-09-06T02:00:00Z",
            sourceLabel = "Bank",
            notes = "lunch",
        )
        val parsed = JSONObject(json.toString())
        assertEquals(12.34, parsed.getDouble("amount"), 0.0001)
        assertEquals("Nasi Kandar", parsed.getString("merchant_raw"))
        assertEquals("lunch", parsed.getString("notes"))
    }
}
