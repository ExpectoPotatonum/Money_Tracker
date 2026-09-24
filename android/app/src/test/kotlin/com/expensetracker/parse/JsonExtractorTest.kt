package com.expensetracker.parse

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class JsonExtractorTest {
    @Test
    fun `strict object parsed as-is`() {
        val obj = JsonExtractor.extractObject("""{"usable": true, "amount": 12.34}""")
        assertEquals(true, obj?.optBoolean("usable"))
        assertEquals(12.34, obj?.optDouble("amount") ?: 0.0, 0.0001)
    }

    @Test
    fun `fenced json block stripped`() {
        val obj = JsonExtractor.extractObject("```json\n{\"usable\": true}\n```")
        assertEquals(true, obj?.optBoolean("usable"))
    }

    @Test
    fun `prose before and after the object ignored`() {
        val obj = JsonExtractor.extractObject("Sure! Here you go:\n{\"usable\": true, \"amount\": 5} Hope that helps.")
        assertEquals(5.0, obj?.optDouble("amount") ?: 0.0, 0.0001)
    }

    @Test
    fun `trailing commas accepted`() {
        val obj = JsonExtractor.extractObject("""{"usable": true, "amount": 7,}""")
        assertEquals(7.0, obj?.optDouble("amount") ?: 0.0, 0.0001)
    }

    @Test
    fun `unquoted keys and single quotes accepted`() {
        val obj = JsonExtractor.extractObject("{usable: true, 'amount': 9}")
        assertEquals(9.0, obj?.optDouble("amount") ?: 0.0, 0.0001)
    }

    @Test
    fun `array root rejected`() {
        assertNull(JsonExtractor.extractObject("[1, 2, 3]"))
    }

    @Test
    fun `no braces rejected`() {
        assertNull(JsonExtractor.extractObject("just prose"))
    }

    @Test
    fun `null and blank rejected`() {
        assertNull(JsonExtractor.extractObject(null))
        assertNull(JsonExtractor.extractObject("   "))
    }
}