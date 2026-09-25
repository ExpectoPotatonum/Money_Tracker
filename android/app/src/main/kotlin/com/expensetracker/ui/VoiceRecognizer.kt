package com.expensetracker.ui

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer

/**
 * Phase 5 — thin SpeechRecognizer wrapper for the quick-add mic (the long-deferred
 * "full on-phone voice" half of the web's Web Speech input). Results are delivered
 * as full-hypothesis strings; the caller REPLACES its text field on every callback
 * and never appends — the web's original appending implementation doubled the
 * transcript on every event, and Android partials have the same failure mode.
 */
class VoiceRecognizer(
    context: Context,
    private val onResult: (String) -> Unit,
    private val onListeningChange: (Boolean) -> Unit,
    private val onError: (Int) -> Unit,
) {
    private val recognizer = SpeechRecognizer.createSpeechRecognizer(context)

    private val listener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) = Unit
        override fun onBeginningOfSpeech() = Unit
        override fun onRmsChanged(rmsdB: Float) = Unit
        override fun onBufferReceived(buffer: ByteArray?) = Unit
        override fun onEndOfSpeech() {
            onListeningChange(false)
        }

        override fun onPartialResults(partialResults: Bundle?) {
            onResult(firstHypothesis(partialResults).orEmpty())
        }

        override fun onResults(results: Bundle?) {
            onListeningChange(false)
            onResult(firstHypothesis(results).orEmpty())
        }

        override fun onError(error: Int) {
            onListeningChange(false)
            onError(error)
        }

        override fun onEvent(eventType: Int, params: Bundle?) = Unit
    }

    fun start(language: String) {
        recognizer.setRecognitionListener(listener)
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }
        onListeningChange(true)
        val started = runCatching { recognizer.startListening(intent) }.isSuccess
        if (!started) {
            onListeningChange(false)
        }
    }

    fun stop() {
        runCatching { recognizer.stopListening() }
    }

    fun destroy() {
        runCatching { recognizer.destroy() }
    }

    private fun firstHypothesis(bundle: Bundle?): String? =
        bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
}
