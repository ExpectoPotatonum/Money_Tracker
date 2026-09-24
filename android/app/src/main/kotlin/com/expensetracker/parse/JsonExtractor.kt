package com.expensetracker.parse

import org.json.JSONObject

/**
 * Tolerant parsing of JSON from LLM output — a Kotlin port of the web's
 * utils/json5.js. Models routinely wrap objects in prose or code fences and
 * occasionally emit JSON5-ish syntax (trailing commas, single-quoted strings,
 * unquoted keys). Try strict first, then progressively relax; return null only
 * when nothing parses.
 */
object JsonExtractor {

    fun extractObject(text: String?): JSONObject? {
        if (text.isNullOrBlank()) {
            return null
        }
        var s = text.trim()

        // Strip ```json ... ``` fences (with or without the "json" tag).
        val fence = FENCE_REGEX.find(s)
        if (fence != null) {
            s = fence.groupValues[1].trim()
        }

        // Only the outermost object matters; ignore any leading/trailing prose.
        val start = s.indexOf('{')
        val end = s.lastIndexOf('}')
        if (start == -1 || end == -1 || end <= start) {
            return null
        }
        s = s.substring(start, end + 1)

        val attempts = listOf(s, dropTrailingCommas(s), json5ish(s))
        for (candidate in attempts) {
            try {
                return JSONObject(candidate)
            } catch (_: Exception) {
                // fall through to the next, more relaxed attempt
            }
        }
        return null
    }

    private fun dropTrailingCommas(s: String): String =
        TRAILING_COMMA_REGEX.replace(s, "$1")

    private fun json5ish(s: String): String {
        var out = dropTrailingCommas(s)
        // Unquoted keys: `{ amount: 1 }` -> `{ "amount": 1 }`.
        out = UNQUOTED_KEY_REGEX.replace(out, "$1\"$2\":")
        // Single-quoted strings -> double-quoted (values and quoted keys).
        out = SINGLE_QUOTE_REGEX.replace(out, "\"$1\"")
        return out
    }

    private val FENCE_REGEX = Regex("```(?:json)?\\s*([\\s\\S]*?)\\s*```", RegexOption.IGNORE_CASE)
    private val TRAILING_COMMA_REGEX = Regex(",\\s*([}\\]])")
    private val UNQUOTED_KEY_REGEX = Regex("([{,]\\s*)([A-Za-z_$][\\w$]*)\\s*:")
    private val SINGLE_QUOTE_REGEX = Regex("'([^'\\n\\\\]*(?:\\\\.[^'\\n\\\\]*)*)'")
}