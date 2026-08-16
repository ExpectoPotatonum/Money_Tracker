package com.expensetracker.sanitize

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class RedactorTest {

    @Test
    fun `otp next to keyword is redacted`() {
        val result = Redactor.redact("Your OTP is 123456. Valid for 5 minutes.")
        assertEquals("Your OTP is ${Redactor.OTP_MARKER}. Valid for 5 minutes.", result.redacted)
        assertEquals(setOf(RedactionType.OTP), result.applied)
    }

    @Test
    fun `code after digits is redacted`() {
        val result = Redactor.redact("454321 is your verification code")
        assertEquals("${Redactor.OTP_MARKER} is your verification code", result.redacted)
    }

    @Test
    fun `one-time password phrase redacted`() {
        val result = Redactor.redact("Your one-time password: 482915.")
        assertEquals("Your one-time password: ${Redactor.OTP_MARKER}.", result.redacted)
    }

    @Test
    fun `six digit pin redacted`() {
        val result = Redactor.redact("Enter PIN 726143 to confirm")
        assertEquals("Enter PIN ${Redactor.OTP_MARKER} to confirm", result.redacted)
    }

    @Test
    fun `otp-style digits far from keyword are left alone`() {
        val result = Redactor.redact("Payment to 9876 Street, reference 12345")
        assertEquals("Payment to 9876 Street, reference 12345", result.redacted)
        assertTrue(result.applied.isEmpty())
    }

    @Test
    fun `transaction amount near debited is preserved`() {
        val text = "You paid RM 65.50 at Kopitiam. Available balance RM 12,340.75"
        val result = Redactor.redact(text)
        assertTrue(result.redacted.contains("RM 65.50 at Kopitiam"))
        assertTrue(result.redacted.contains("Available balance ${Redactor.BALANCE_MARKER}"))
        assertEquals(setOf(RedactionType.BALANCE), result.applied)
    }

    @Test
    fun `balance with avail bal phrase redacted`() {
        val result = Redactor.redact("avail bal RM 998.00")
        assertEquals("avail bal ${Redactor.BALANCE_MARKER}", result.redacted)
    }

    @Test
    fun `baki phrase redacted`() {
        val result = Redactor.redact("Baki terkini RM 500.00")
        assertEquals("Baki terkini ${Redactor.BALANCE_MARKER}", result.redacted)
    }

    @Test
    fun `currency symbol balance redacted`() {
        val result = Redactor.redact("Balance: $1,250.99")
        assertEquals("Balance: ${Redactor.BALANCE_MARKER}", result.redacted)
    }

    @Test
    fun `long digit run is an account`() {
        val result = Redactor.redact("Card **** 4567  Account 112233445566")
        assertEquals(
            "Card ${Redactor.ACCOUNT_MARKER}  Account ${Redactor.ACCOUNT_MARKER}",
            result.redacted,
        )
        assertEquals(setOf(RedactionType.ACCOUNT), result.applied)
    }

    @Test
    fun `masked card number redacted`() {
        val result = Redactor.redact("ending 5678")
        assertEquals("${Redactor.ACCOUNT_MARKER}", result.redacted)
    }

    @Test
    fun `star masked card redacted`() {
        val result = Redactor.redact("Card ending in **** 1234")
        assertEquals("Card ending in ${Redactor.ACCOUNT_MARKER}", result.redacted)
    }

    @Test
    fun `account wins over balance when spans overlap`() {
        val result = Redactor.redact("balance 1234567890")
        assertEquals("balance ${Redactor.ACCOUNT_MARKER}", result.redacted)
        assertEquals(setOf(RedactionType.ACCOUNT), result.applied)
    }

    @Test
    fun `empty and plain text pass through`() {
        assertEquals(RedactionResult("", emptySet()), Redactor.redact(""))
        val plain = "You have received a new message"
        assertEquals(RedactionResult(plain, emptySet()), Redactor.redact(plain))
    }

    @Test
    fun `date digits near no keyword are untouched`() {
        val result = Redactor.redact("Bought on 2024-09-30, ref 88432")
        assertEquals("Bought on 2024-09-30, ref 88432", result.redacted)
    }
}
