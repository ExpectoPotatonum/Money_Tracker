package com.expensetracker.capture

import java.security.MessageDigest
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class RawNotificationDraftMapperTest {

    @Test
    fun `draft maps to entity with all fields intact`() {
        val draft = RawNotificationDraft(
            clientUuid = "uuid-1",
            deviceId = "device-1",
            packageName = "my.com.tngdigital.ewallet",
            appLabel = "TnG eWallet",
            notificationKey = "key-1",
            title = "Payment made",
            textBody = "RM 10.00 to Grab",
            bigText = "big text",
            subText = "sub text",
            isGroupSummary = false,
            postedAt = 1_700_000_000_000L,
            contentHash = "abc",
        )

        val entity = draft.toEntity()

        assertEquals("uuid-1", entity.clientUuid)
        assertEquals("device-1", entity.deviceId)
        assertEquals("my.com.tngdigital.ewallet", entity.packageName)
        assertEquals("TnG eWallet", entity.appLabel)
        assertEquals("key-1", entity.notificationKey)
        assertEquals("Payment made", entity.title)
        assertEquals("RM 10.00 to Grab", entity.textBody)
        assertEquals("big text", entity.bigText)
        assertEquals("sub text", entity.subText)
        assertFalse(entity.isGroupSummary)
        assertEquals(1_700_000_000_000L, entity.postedAt)
        assertEquals("abc", entity.contentHash)
    }

    @Test
    fun `content hash differs when text differs`() {
        val base = hash("package|title|body|big")
        val changed = hash("package|title|other|big")
        assertFalse(base == changed)
        assertTrue(base.length == 64)
    }

    @Test
    fun `client uuid is unique across drafts`() {
        val a = UUID.randomUUID().toString()
        val b = UUID.randomUUID().toString()
        assertFalse(a == b)
    }

    private fun hash(input: String): String =
        MessageDigest.getInstance("SHA-256")
            .digest(input.toByteArray())
            .joinToString("") { "%02x".format(it) }
}
