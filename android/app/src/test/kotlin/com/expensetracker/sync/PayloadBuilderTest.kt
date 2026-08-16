package com.expensetracker.sync

import com.expensetracker.data.RawNotificationEntity
import com.expensetracker.sanitize.Redactor
import org.json.JSONObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class PayloadBuilderTest {

    @Test
    fun `payload carries all columns in snake_case`() {
        val entity = RawNotificationEntity(
            clientUuid = "uuid-1",
            deviceId = "device-1",
            packageName = "my.com.tngdigital.ewallet",
            appLabel = "TnG eWallet",
            notificationKey = "key-1",
            title = "Payment made",
            textBody = "You paid RM 10.00. Balance RM 999.99",
            postedAt = 1_700_000_000_000L,
            contentHash = "abc",
            isGroupSummary = false,
        )

        val json = PayloadBuilder.toPayload(entity) as JSONObject

        assertEquals("uuid-1", json.getString("client_uuid"))
        assertEquals("device-1", json.getString("device_id"))
        assertEquals("my.com.tngdigital.ewallet", json.getString("package_name"))
        assertEquals("TnG eWallet", json.getString("app_label"))
        assertEquals("key-1", json.getString("notification_key"))
        assertEquals("Payment made", json.getString("title"))
        assertEquals("2023-11-14T22:13:20Z", json.getString("posted_at"))
        assertEquals("abc", json.getString("content_hash"))
        assertTrue(json.has("redactions_applied"))
    }

    @Test
    fun `balance redacted and recorded in redactions_applied`() {
        val entity = RawNotificationEntity(
            clientUuid = "uuid-2",
            deviceId = "device-2",
            packageName = "com.cimb.cimbocto",
            textBody = "Spent RM 20.00. Available balance RM 88.00",
            postedAt = 1_700_000_000_000L,
            contentHash = "abc",
            isGroupSummary = false,
        )

        val json = PayloadBuilder.toPayload(entity) as JSONObject

        assertTrue(json.getString("text_body").contains("Available balance ${Redactor.BALANCE_MARKER}"))
        assertTrue(json.getString("text_body").contains("RM 20.00"))
        val applied = json.getJSONArray("redactions_applied")
        assertEquals(1, applied.length())
        assertEquals("balance", applied.getString(0))
    }

    @Test
    fun `otp redacted and recorded`() {
        val entity = RawNotificationEntity(
            clientUuid = "uuid-3",
            deviceId = "device-3",
            packageName = "com.cimb.cimbocto",
            title = "Your OTP is 123456",
            postedAt = 1_700_000_000_000L,
            contentHash = "abc",
            isGroupSummary = false,
        )

        val json = PayloadBuilder.toPayload(entity) as JSONObject

        assertEquals("Your OTP is ${Redactor.OTP_MARKER}", json.getString("title"))
        val applied = json.getJSONArray("redactions_applied")
        assertEquals(1, applied.length())
        assertEquals("otp", applied.getString(0))
    }

    @Test
    fun `null fields become json null`() {
        val entity = RawNotificationEntity(
            clientUuid = "uuid-4",
            deviceId = "device-4",
            packageName = "com.cimb.cimbocto",
            postedAt = 1_700_000_000_000L,
            contentHash = "abc",
            isGroupSummary = false,
        )

        val json = PayloadBuilder.toPayload(entity) as JSONObject

        assertTrue(json.isNull("title"))
        assertTrue(json.isNull("app_label"))
        assertTrue(json.isNull("notification_key"))
        assertEquals(0, json.getJSONArray("redactions_applied").length())
    }

    @Test
    fun `iso8601 formatting is UTC zulu`() {
        assertEquals("1970-01-01T00:00:00Z", SupabaseApi.iso8601(0))
    }
}
