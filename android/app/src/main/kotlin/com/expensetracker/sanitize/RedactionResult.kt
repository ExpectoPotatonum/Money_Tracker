package com.expensetracker.sanitize

data class RedactionResult(
    val redacted: String,
    val applied: Set<RedactionType>,
)
