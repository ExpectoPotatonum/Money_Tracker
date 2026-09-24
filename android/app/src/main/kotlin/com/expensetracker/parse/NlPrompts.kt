package com.expensetracker.parse

import java.time.LocalDate
import java.time.ZoneId

/**
 * Prompt construction for the LLM quick-add parse — a Kotlin port of the web's
 * utils/prompts.js buildNlPrompt. Context injection is the whole game: the
 * model answers against the user's real categories/currencies rather than
 * guessing, and the reply is crammed into one strict JSON object that
 * [JsonExtractor] parses.
 */
object NlPrompts {

    private const val MY_TIMEZONE = "Asia/Kuala_Lumpur"

    fun buildNlPrompt(
        userText: String,
        categoryNames: List<String>,
        currencies: List<String>,
    ): String {
        val categories = categoryNames.ifEmpty { listOf("(none configured)") }
        val currencyCodes = currencies.ifEmpty { TransactionNormalizer.SUPPORTED_CURRENCIES.toList() }
        return listOf(
            "You are a bookkeeping assistant. Convert the sentence below into one transaction.",
            jsonContract(categories, currencyCodes),
            "",
            "Sentence:",
            "\"\"\"$userText\"\"\"",
        ).joinToString("\n")
    }

    private fun jsonContract(categories: List<String>, currencyCodes: List<String>): String {
        val today = LocalDate.now(ZoneId.of(MY_TIMEZONE)).toString()
        return listOf(
            "Reply with ONLY a single JSON object — no markdown fences, no prose, no commentary.",
            "",
            "Rules:",
            "- amount: positive number (the transaction amount).",
            "- currency: 3-letter ISO code from this list: ${currencyCodes.joinToString(", ")}. Default \"MYR\".",
            "- direction: \"debit\" if money left (paid / spent / transferred out); \"credit\" if money came in (received / salary / refund / cashback / gift).",
            "- merchant_raw: the other party (payee or sender), as typed.",
            "- category: exactly one name from this list: ${categories.joinToString(", ")} — or null if unsure.",
            "- transaction_date: ISO 8601 with +08:00 offset (Asia/Kuala_Lumpur). Today is $today.",
            "- notes: a short note, or null.",
            "- usable: true if this contains a real transaction; false if it is noise (e.g. marketing, a balance reminder, or nothing extractable).",
            "",
            "JSON shape:",
            "{\"usable\": true, \"amount\": 12.34, \"currency\": \"MYR\", \"direction\": \"debit\", \"merchant_raw\": \"Example\", \"category\": \"Food & Dining\", \"transaction_date\": \"2026-09-06T10:00:00+08:00\", \"notes\": null}",
        ).joinToString("\n")
    }
}