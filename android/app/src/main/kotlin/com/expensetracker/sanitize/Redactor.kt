package com.expensetracker.sanitize

/**
 * Generic, app-agnostic redaction pass (agents.md §8) — the only thing
 * standing between a phone and Supabase seeing an OTP, a balance, or an
 * account/card number. Heaviest test coverage in the repo on purpose.
 *
 * Deliberately a few obviously-correct patterns rather than one clever
 * mega-regex: the "next to a keyword" idea is implemented as keyword
 * matches with a fixed window around them, never as a single combined
 * pattern that would be a nightmare to reason about.
 *
 * The transaction amount itself is left alone — it sits next to
 * *different* keywords ("debited", "paid", "received"), which is what
 * makes stripping a balance figure without also stripping the number
 * the whole pipeline exists to capture.
 */
object Redactor {

    const val OTP_MARKER = "[REDACTED-OTP]"
    const val BALANCE_MARKER = "[REDACTED-BALANCE]"
    const val ACCOUNT_MARKER = "[REDACTED-ACCOUNT]"

    private const val OTP_WINDOW = 40
    private const val BALANCE_BEFORE_WINDOW = 4
    private const val BALANCE_AFTER_WINDOW = 25

    private val otpKeywords = Regex(
        """(?i)\b(otp|one[- ]?time\s+(?:password|code|pin)|""" +
            """verification\s+(?:code|pin|number)|pin|code)\b""",
    )
    private val otpDigits = Regex("""\b\d{4,8}\b""")

    private val balanceKeywords = Regex(
        """(?i)\b(available\s+balance|avail\s+bal|balance|baki)\b""",
    )
    private val amountTokens = Regex(
        """(?:RM|MYR|[A-Z]{3}\s?)?[$€¥]?\s?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?""",
    )

    private val longDigitRuns = Regex("""\b\d{8,}\b""")
    private val maskedCardPatterns = listOf(
        Regex("""\*{2,}\s*\d{0,4}"""),
        Regex("""(?i)\b(?:ending|last)\s+(?:in\s+)?\d{2,4}\b"""),
        Regex("""(?i)\bxxxx\s+\d{2,4}\b"""),
    )

    fun redact(text: String): RedactionResult {
        val spans = mutableListOf<Span>()
        collectKeywordWindowed(
            otpKeywords, otpDigits, OTP_WINDOW, OTP_WINDOW, RedactionType.OTP, text, spans,
        )
        collectKeywordWindowed(
            balanceKeywords, amountTokens, BALANCE_BEFORE_WINDOW, BALANCE_AFTER_WINDOW,
            RedactionType.BALANCE, text, spans,
        )
        collectDirect(longDigitRuns, RedactionType.ACCOUNT, text, spans)
        maskedCardPatterns.forEach { collectDirect(it, RedactionType.ACCOUNT, text, spans) }

        val merged = mergeSpans(spans)
        if (merged.isEmpty()) return RedactionResult(text, emptySet())

        val sb = StringBuilder(text.length)
        var pos = 0
        for (span in merged) {
            sb.append(text, pos, span.start)
            sb.append(span.marker())
            pos = span.end
        }
        sb.append(text, pos, text.length)
        return RedactionResult(sb.toString(), merged.mapTo(mutableSetOf()) { it.type })
    }

    private data class Span(val start: Int, val end: Int, val type: RedactionType)

    /**
     * Balances almost always *follow* their keyword ("available balance
     * RM 12.34"), while the transaction amount the pipeline exists to
     * capture usually *precedes* it ("You paid RM 65.50 ... available
     * balance RM 12.34"). So the backward window is deliberately tiny:
     * a token 12 chars before "balance" is almost certainly the amount,
     * not the balance (agents.md §8's carve-out rule in one parameter).
     */
    private fun collectKeywordWindowed(
        keywords: Regex,
        tokens: Regex,
        beforeWindow: Int,
        afterWindow: Int,
        type: RedactionType,
        text: String,
        out: MutableList<Span>,
    ) {
        for (keyword in keywords.findAll(text)) {
            val from = (keyword.range.first - beforeWindow).coerceAtLeast(0)
            val to = (keyword.range.last + 1 + afterWindow).coerceAtMost(text.length)
            for (token in tokens.findAll(text, from)) {
                if (token.range.first >= to) break
                // token fully before the keyword and out of the small
                // backward window -> the transaction amount, leave it
                if (token.range.last + beforeWindow < keyword.range.first) continue
                // a token that starts inside the keyword itself is the
                // keyword, not a value to redact
                if (token.range.first >= keyword.range.first && token.range.last <= keyword.range.last) continue
                out.add(Span(token.range.first, token.range.last + 1, type))
            }
        }
    }

    private fun collectDirect(
        pattern: Regex,
        type: RedactionType,
        text: String,
        out: MutableList<Span>,
    ) {
        pattern.findAll(text).forEach { out.add(Span(it.range.first, it.range.last + 1, type)) }
    }

    /**
     * Resolve overlapping spans. Priority: ACCOUNT > BALANCE > OTP — the
     * more specific a pattern is, the more it wins. (A masked card number
     * sitting inside a balance window is an account, not a balance.)
     */
    private fun mergeSpans(spans: List<Span>): List<Span> {
        val sorted = spans.sortedWith(compareBy({ it.start }, { it.type.priority() }))
        val out = mutableListOf<Span>()
        for (span in sorted) {
            val last = out.lastOrNull()
            if (last != null && span.start < last.end) {
                if (span.type.priority() < last.type.priority()) {
                    out[out.size - 1] = span
                }
                continue
            }
            out.add(span)
        }
        return out
    }

    private fun RedactionType.priority(): Int = when (this) {
        RedactionType.ACCOUNT -> 0
        RedactionType.BALANCE -> 1
        RedactionType.OTP -> 2
    }

    private fun Span.marker(): String = when (type) {
        RedactionType.OTP -> OTP_MARKER
        RedactionType.BALANCE -> BALANCE_MARKER
        RedactionType.ACCOUNT -> ACCOUNT_MARKER
    }
}
