package com.expensetracker.parse

import org.json.JSONObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class TransactionDraftTest {
    private fun llmReply(vararg overrides: Pair<String, Any>): JSONObject {
        val base = JSONObject()
        base.put("usable", true)
        base.put("amount", 12.34)
        base.put("currency", "MYR")
        base.put("direction", "debit")
        base.put("merchant_raw", "Starbucks")
        base.put("category", "Food & Dining")
        base.put("transaction_date", "2026-09-06T10:00:00+08:00")
        base.put("notes", JSONObject.NULL)
        for ((k, v) in overrides) base.put(k, v)
        return base
    }

    @Test
    fun `valid reply normalized`() {
        val draft = TransactionNormalizer.normalize(llmReply())!!
        assertEquals(12.34, draft.amount, 0.0001)
        assertEquals(TransactionDraft.Direction.DEBIT, draft.direction)
        assertEquals("MYR", draft.currency)
        assertEquals("Starbucks", draft.merchantRaw)
        assertEquals("Food & Dining", draft.categoryName)
        assertEquals("2026-09-06T02:00:00Z", draft.transactionDateIso)
        assertNull(draft.notes)
    }

    @Test
    fun `usable false rejected`() {
        assertNull(TransactionNormalizer.normalize(llmReply("usable" to false)))
    }

    @Test
    fun `non-positive amount rejected`() {
        assertNull(TransactionNormalizer.normalize(llmReply("amount" to 0.0)))
        assertNull(TransactionNormalizer.normalize(llmReply("amount" to -3)))
    }

    @Test
    fun `unknown direction rejected`() {
        assertNull(TransactionNormalizer.normalize(llmReply("direction" to "sideways")))
    }

    @Test
    fun `unsupported currency falls back to MYR`() {
        val draft = TransactionNormalizer.normalize(llmReply("currency" to "gbp"))!!
        assertEquals("MYR", draft.currency)
    }

    @Test
    fun `blank date falls back to now`() {
        val draft = TransactionNormalizer.normalize(llmReply("transaction_date" to ""))!!
        assertNotNull(draft.transactionDateIso)
    }

    @Test
    fun `long merchant and notes truncated to 255`() {
        val long = "x".repeat(400)
        val draft = TransactionNormalizer.normalize(llmReply("merchant_raw" to long, "notes" to long))!!
        assertEquals(255, draft.merchantRaw?.length)
        assertEquals(255, draft.notes?.length)
    }

    @Test
    fun `credit direction kept`() {
        val draft = TransactionNormalizer.normalize(llmReply("direction" to "credit"))!!
        assertEquals(TransactionDraft.Direction.CREDIT, draft.direction)
    }

    @Test
    fun `null reply rejected`() {
        assertNull(TransactionNormalizer.normalize(null))
    }
}