package com.expensetracker.sync

import java.time.LocalDate
import org.json.JSONObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class RecurringMaterializerTest {

    private fun entry(
        id: String = "recur-1",
        name: String = "Rent",
        amount: Double = 1500.0,
        currency: String = "MYR",
        direction: String = "debit",
        categoryId: String? = "cat-1",
        accountId: String? = "acc-1",
        frequency: String = "monthly",
        intervalStep: Int = 1,
        dayOfMonth: Int? = null,
        merchantRaw: String? = null,
        notes: String? = null,
        nextDueDate: String = "2026-09-01",
    ): SupabaseApi.RecurringEntry = SupabaseApi.RecurringEntry(
        id = id,
        name = name,
        amount = amount,
        currency = currency,
        direction = direction,
        categoryId = categoryId,
        accountId = accountId,
        frequency = frequency,
        intervalStep = intervalStep,
        dayOfMonth = dayOfMonth,
        merchantRaw = merchantRaw,
        notes = notes,
        nextDueDate = nextDueDate,
    )

    // --------------------------------------------------------------- advance

    @Test
    fun `advance daily steps by days`() {
        val next = RecurringMaterializer.advance(
            LocalDate.of(2026, 9, 25),
            "daily",
            intervalStep = 2,
            dayOfMonth = null,
        )
        assertEquals(LocalDate.of(2026, 9, 27), next)
    }

    @Test
    fun `advance weekly steps by weeks`() {
        val next = RecurringMaterializer.advance(
            LocalDate.of(2026, 9, 25),
            "weekly",
            intervalStep = 1,
            dayOfMonth = null,
        )
        assertEquals(LocalDate.of(2026, 10, 2), next)
    }

    @Test
    fun `advance monthly without anchor stays on the same day`() {
        val next = RecurringMaterializer.advance(
            LocalDate.of(2026, 9, 15),
            "monthly",
            intervalStep = 1,
            dayOfMonth = null,
        )
        assertEquals(LocalDate.of(2026, 10, 15), next)
    }

    @Test
    fun `advance monthly clamps day of month to the target month length`() {
        val next = RecurringMaterializer.advance(
            LocalDate.of(2026, 1, 31),
            "monthly",
            intervalStep = 1,
            dayOfMonth = 31,
        )
        assertEquals(LocalDate.of(2026, 2, 28), next)
        // ...and recovers to the 31st once the month has one.
        val recovered = RecurringMaterializer.advance(
            LocalDate.of(2026, 2, 28),
            "monthly",
            intervalStep = 2,
            dayOfMonth = 31,
        )
        assertEquals(LocalDate.of(2026, 4, 30), recovered)
    }

    @Test
    fun `advance yearly steps by years and clamps leap day`() {
        val ordinary = RecurringMaterializer.advance(
            LocalDate.of(2026, 9, 25),
            "yearly",
            intervalStep = 1,
            dayOfMonth = null,
        )
        assertEquals(LocalDate.of(2027, 9, 25), ordinary)

        val leap = RecurringMaterializer.advance(
            LocalDate.of(2024, 2, 29),
            "yearly",
            intervalStep = 1,
            dayOfMonth = null,
        )
        assertEquals(LocalDate.of(2025, 2, 28), leap)
    }

    @Test
    fun `advance treats an unknown frequency as monthly`() {
        val next = RecurringMaterializer.advance(
            LocalDate.of(2026, 9, 25),
            "fortnightly",
            intervalStep = 1,
            dayOfMonth = null,
        )
        assertEquals(LocalDate.of(2026, 10, 25), next)
    }

    // ------------------------------------------------------------- dueInstant

    @Test
    fun `due instant is midnight MYT on the due date`() {
        val iso = RecurringMaterializer.dueInstantIso(LocalDate.of(2026, 9, 1))
        // 2026-09-01 00:00 +08:00 is 2026-08-31 16:00 UTC.
        assertEquals("2026-08-31T16:00:00Z", iso)
    }

    // ---------------------------------------------------------------- buildRow

    @Test
    fun `buildRow produces the manual recurring shape with the dedup pair`() {
        val row = RecurringMaterializer.buildRow(
            entry().copy(notes = "landlord", merchantRaw = "HL Land"),
            LocalDate.of(2026, 9, 1),
            sourceAppLabel = "HLB",
        )

        assertEquals("recur-1", row.getString("recurring_entry_id"))
        assertEquals("2026-09-01", row.getString("recurring_due_date"))
        assertEquals("2026-08-31T16:00:00Z", row.getString("transaction_date"))
        assertEquals("2026-08-31T16:00:00Z", row.getString("notification_posted_at"))
        assertEquals(1500.0, row.getDouble("amount"), 0.0001)
        assertEquals("MYR", row.getString("currency"))
        assertEquals("debit", row.getString("direction"))
        assertEquals("HL Land", row.getString("merchant_raw"))
        assertEquals("cat-1", row.getString("category_id"))
        assertEquals("acc-1", row.getString("account_id"))
        assertEquals("manual", row.getString("source_package"))
        assertEquals("HLB", row.getString("source_app_label"))
        assertEquals("low", row.getString("confidence"))
        assertEquals("confirmed", row.getString("status"))
        assertTrue(row.getBoolean("is_recurring"))
        assertEquals("landlord", row.getString("notes"))
    }

    @Test
    fun `buildRow falls back to the entry name as merchant and Cash as source`() {
        val row = RecurringMaterializer.buildRow(
            entry(),
            LocalDate.of(2026, 9, 1),
            sourceAppLabel = "",
        )
        assertEquals("Rent", row.getString("merchant_raw"))
        assertEquals("Cash", row.getString("source_app_label"))
    }

    @Test
    fun `buildRow handles null optional columns`() {
        val row = RecurringMaterializer.buildRow(
            entry(categoryId = null, accountId = null),
            LocalDate.of(2026, 9, 1),
            sourceAppLabel = "Cash",
        )
        assertEquals(JSONObject.NULL, row.get("category_id"))
        assertEquals(JSONObject.NULL, row.get("account_id"))
        assertEquals(JSONObject.NULL, row.get("notes"))
    }

    // ---------------------------------------------------------------- fromJson

    @Test
    fun `fromJson parses a due entry row`() {
        val json = JSONObject()
            .put("id", "recur-9")
            .put("name", "Salary")
            .put("amount", 5000)
            .put("currency", "MYR")
            .put("direction", "credit")
            .put("category_id", "cat-9")
            .put("account_id", "acc-9")
            .put("frequency", "monthly")
            .put("interval_step", 1)
            .put("day_of_month", 1)
            .put("merchant_raw", JSONObject.NULL)
            .put("notes", JSONObject.NULL)
            .put("next_due_date", "2026-10-01")

        val parsed = SupabaseApi.RecurringEntry.fromJson(json)
        assertEquals("recur-9", parsed?.id)
        assertEquals("Salary", parsed?.name)
        assertEquals(5000.0, parsed?.amount ?: 0.0, 0.0001)
        assertEquals("credit", parsed?.direction)
        assertEquals("cat-9", parsed?.categoryId)
        assertEquals("acc-9", parsed?.accountId)
        assertEquals(1, parsed?.dayOfMonth)
        assertNull(parsed?.merchantRaw)
        assertNull(parsed?.notes)
        assertEquals("2026-10-01", parsed?.nextDueDate)
    }

    @Test
    fun `fromJson maps missing day-of-month to null and rejects blank id`() {
        val json = JSONObject()
            .put("id", "")
            .put("next_due_date", "2026-10-01")
        assertNull(SupabaseApi.RecurringEntry.fromJson(json))

        val withNullDay = JSONObject()
            .put("id", "recur-2")
            .put("day_of_month", JSONObject.NULL)
            .put("interval_step", 3)
        assertNull(SupabaseApi.RecurringEntry.fromJson(withNullDay)?.dayOfMonth)
        assertEquals(3, SupabaseApi.RecurringEntry.fromJson(withNullDay)?.intervalStep)
    }
}
