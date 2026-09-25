@file:OptIn(ExperimentalMaterial3Api::class)

package com.expensetracker.ui

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.speech.SpeechRecognizer
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.expensetracker.R
import com.expensetracker.parse.TransactionDraft
import com.expensetracker.parse.TransactionNormalizer
import com.expensetracker.sync.ManualTransactionBuilder
import java.util.Locale

/**
 * Phase 5 — quick-add manual bookkeeping: microph/type a transaction, parse it
 * with the on-device LLM, review the editable preview, save as a manual row.
 * Mirrors the web's nlModal (account required up front, replace-not-append
 * voice text, category by name resolved to id at save).
 */
@Composable
fun QuickAddTab(viewModel: QuickAddViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current

    var accountName by rememberSaveable { mutableStateOf("") }
    var text by rememberSaveable { mutableStateOf("") }
    var baseText by remember { mutableStateOf("") }
    var isListening by remember { mutableStateOf(false) }
    var voiceMessage by remember { mutableStateOf<String?>(null) }

    val voice = remember {
        if (SpeechRecognizer.isRecognitionAvailable(context)) {
            VoiceRecognizer(
                context = context,
                onResult = { spoken ->
                    if (spoken.isNotBlank()) {
                        text = listOf(baseText, spoken.trim()).filter { it.isNotBlank() }.joinToString(" ")
                    }
                },
                onListeningChange = { isListening = it },
                onError = { code -> voiceMessage = voiceErrorMessage(context, code) },
            )
        } else {
            null
        }
    }
    DisposableEffect(Unit) {
        onDispose { voice?.destroy() }
    }

    fun beginListening(recognizer: VoiceRecognizer) {
        baseText = text.trim()
        voiceMessage = null
        recognizer.start(voiceLanguage())
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        val recognizer = voice
        if (granted && recognizer != null) {
            beginListening(recognizer)
        } else if (!granted) {
            voiceMessage = context.getString(R.string.qa_voice_denied)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
    ) {
        if (state.loading) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                Spacer(modifier = Modifier.width(8.dp))
                Text(text = stringResource(R.string.qa_loading))
            }
        }
        if (state.saved) {
            Text(
                text = stringResource(R.string.qa_saved),
                color = MaterialTheme.colorScheme.primary,
                style = MaterialTheme.typography.titleSmall,
            )
        }
        state.error?.let { err ->
            Text(
                text = quickAddErrorMessage(context, err),
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall,
            )
            if (err is QuickAddViewModel.QuickAddError.Auth ||
                err is QuickAddViewModel.QuickAddError.Network
            ) {
                TextButton(onClick = { viewModel.refreshCatalogs() }) {
                    Text(text = stringResource(R.string.qa_retry))
                }
            }
        }

        state.draft?.let { draft ->
            QuickAddPreview(
                draft = draft,
                state = state,
                viewModel = viewModel,
                accountName = accountName,
            )
        } ?: run {
            if (state.accounts.isEmpty() && !state.loading) {
                Text(
                    text = stringResource(R.string.qa_no_accounts),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
                Spacer(modifier = Modifier.height(8.dp))
            }
            LabeledDropdown(
                label = stringResource(R.string.qa_account),
                options = state.accounts.map { it.name },
                selected = accountName,
                onSelect = { accountName = it },
                placeholder = stringResource(R.string.qa_account),
                enabled = state.accounts.isNotEmpty(),
            )
            Spacer(modifier = Modifier.height(8.dp))

            Row(verticalAlignment = Alignment.CenterVertically) {
                if (voice != null) {
                    Button(onClick = {
                        if (isListening) {
                            voice?.stop()
                        } else if (
                            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) !=
                            PackageManager.PERMISSION_GRANTED
                        ) {
                            permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                        } else {
                            beginListening(voice)
                        }
                    }) {
                        Text(text = if (isListening) "⏹" else "🎤")
                    }
                    Spacer(modifier = Modifier.width(12.dp))
                }
                Text(
                    text = when {
                        isListening -> stringResource(R.string.qa_listening)
                        voiceMessage != null -> voiceMessage.orEmpty()
                        else -> stringResource(R.string.qa_hint)
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = if (voiceMessage != null) {
                        MaterialTheme.colorScheme.error
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                )
            }
            Spacer(modifier = Modifier.height(8.dp))

            OutlinedTextField(
                value = text,
                onValueChange = {
                    text = it
                    viewModel.ackSaved()
                },
                placeholder = { Text(text = stringResource(R.string.qa_hint)) },
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(modifier = Modifier.height(12.dp))

            Button(
                onClick = { viewModel.parse(text) },
                enabled = text.isNotBlank() && accountName.isNotBlank() && !state.parsing,
                modifier = Modifier.fillMaxWidth(),
            ) {
                if (state.parsing) {
                    CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                } else {
                    Text(text = stringResource(R.string.qa_parse))
                }
            }
        }
    }
}

@Composable
private fun QuickAddPreview(
    draft: TransactionDraft,
    state: QuickAddViewModel.QuickAddUiState,
    viewModel: QuickAddViewModel,
    accountName: String,
) {
    val context = LocalContext.current
    val debitLabel = stringResource(R.string.qa_direction_debit)
    val creditLabel = stringResource(R.string.qa_direction_credit)
    val customSourceLabel = stringResource(R.string.qa_source_custom)

    var amount by remember(draft) { mutableStateOf(draft.amount.toString()) }
    var currency by remember(draft) { mutableStateOf(draft.currency) }
    var directionLabel by remember(draft) {
        mutableStateOf(if (draft.direction == TransactionDraft.Direction.DEBIT) debitLabel else creditLabel)
    }
    var merchantRaw by remember(draft) { mutableStateOf(draft.merchantRaw.orEmpty()) }
    var categoryName by remember(draft) { mutableStateOf(draft.categoryName.orEmpty()) }
    var sourcePreset by remember(draft) { mutableStateOf(ManualTransactionBuilder.DEFAULT_SOURCE) }
    var sourceCustom by remember(draft) { mutableStateOf("") }
    var customShown by remember(draft) { mutableStateOf(false) }
    var dateText by remember(draft) { mutableStateOf(ManualTransactionBuilder.draftLocalText(draft)) }
    var notes by remember(draft) { mutableStateOf(draft.notes.orEmpty()) }

    val directionOptions = listOf(debitLabel, creditLabel)
    val currencyOptions = TransactionNormalizer.SUPPORTED_CURRENCIES.toList()
    val categoryOptions = state.categories.map { it.name }
    val sourceOptions = ManualTransactionBuilder.SOURCE_PRESETS + customSourceLabel

    Column {
        Text(
            text = stringResource(R.string.qa_preview),
            style = MaterialTheme.typography.titleMedium,
        )
        Text(
            text = "${stringResource(R.string.qa_account)}: $accountName",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(modifier = Modifier.height(12.dp))

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                value = amount,
                onValueChange = { amount = it },
                label = { Text(text = stringResource(R.string.qa_field_amount)) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.weight(1f),
            )
            LabeledDropdown(
                label = stringResource(R.string.qa_field_currency),
                options = currencyOptions,
                selected = currency,
                onSelect = { currency = it },
                modifier = Modifier.weight(1f),
            )
        }
        Spacer(modifier = Modifier.height(8.dp))

        LabeledDropdown(
            label = stringResource(R.string.qa_field_direction),
            options = directionOptions,
            selected = directionLabel,
            onSelect = { directionLabel = it },
        )
        Spacer(modifier = Modifier.height(8.dp))

        OutlinedTextField(
            value = merchantRaw,
            onValueChange = { merchantRaw = it },
            label = { Text(text = stringResource(R.string.qa_field_merchant)) },
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(modifier = Modifier.height(8.dp))

        LabeledDropdown(
            label = stringResource(R.string.qa_field_category),
            options = categoryOptions,
            selected = categoryName,
            onSelect = { categoryName = it },
            placeholder = "—",
            allowEmpty = true,
        )
        Spacer(modifier = Modifier.height(8.dp))

        LabeledDropdown(
            label = stringResource(R.string.qa_field_source),
            options = sourceOptions,
            selected = if (customShown) customSourceLabel else sourcePreset,
            onSelect = {
                if (it == customSourceLabel) {
                    customShown = true
                } else {
                    customShown = false
                    sourcePreset = it
                }
            },
        )
        if (customShown) {
            Spacer(modifier = Modifier.height(8.dp))
            OutlinedTextField(
                value = sourceCustom,
                onValueChange = { sourceCustom = it },
                label = { Text(text = stringResource(R.string.qa_source_custom)) },
                modifier = Modifier.fillMaxWidth(),
            )
        }
        Spacer(modifier = Modifier.height(8.dp))

        OutlinedTextField(
            value = dateText,
            onValueChange = { dateText = it },
            label = { Text(text = stringResource(R.string.qa_field_date)) },
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(modifier = Modifier.height(8.dp))

        OutlinedTextField(
            value = notes,
            onValueChange = { notes = it },
            label = { Text(text = stringResource(R.string.qa_field_notes)) },
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(modifier = Modifier.height(16.dp))

        Button(
            onClick = {
                val finalSource = if (customShown) sourceCustom else sourcePreset
                viewModel.save(
                    QuickAddViewModel.QuickAddForm(
                        accountId = state.accounts.firstOrNull { it.name == accountName }?.id.orEmpty(),
                        amount = amount,
                        currency = currency,
                        direction = if (directionLabel == creditLabel) "credit" else "debit",
                        merchantRaw = merchantRaw,
                        categoryName = categoryName,
                        dateText = dateText,
                        sourceLabel = finalSource,
                        notes = notes,
                    ),
                )
            },
            enabled = !state.saving,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(text = if (state.saving) stringResource(R.string.qa_saving) else stringResource(R.string.qa_save))
        }
        if (state.saved) {
            Text(
                text = stringResource(R.string.qa_saved),
                color = MaterialTheme.colorScheme.primary,
                style = MaterialTheme.typography.titleSmall,
            )
        }
        if (state.error != null) {
            Text(
                text = quickAddErrorMessage(context, state.error),
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

/** Read-only select backed by an anchored dropdown (material3). */
@Composable
private fun LabeledDropdown(
    label: String,
    options: List<String>,
    selected: String,
    onSelect: (String) -> Unit,
    placeholder: String? = null,
    allowEmpty: Boolean = false,
    enabled: Boolean = true,
    modifier: Modifier = Modifier,
) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
        OutlinedTextField(
            value = selected,
            onValueChange = {},
            readOnly = true,
            enabled = enabled,
            label = { Text(text = label) },
            placeholder = { if (!placeholder.isNullOrBlank()) Text(text = placeholder) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier
                .menuAnchor(MenuAnchorType.PrimaryNotEditable)
                .fillMaxWidth()
                .then(modifier),
        )
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            if (allowEmpty) {
                DropdownMenuItem(
                    text = { Text(text = "—") },
                    onClick = {
                        onSelect("")
                        expanded = false
                    },
                )
            }
            options.forEach { option ->
                DropdownMenuItem(
                    text = { Text(text = option) },
                    onClick = {
                        onSelect(option)
                        expanded = false
                    },
                )
            }
        }
    }
}

private fun voiceErrorMessage(context: Context, code: Int): String = when (code) {
    SpeechRecognizer.ERROR_NO_MATCH -> context.getString(R.string.qa_voice_no_match)
    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> context.getString(R.string.qa_voice_denied)
    else -> context.getString(R.string.qa_voice_error)
}

private fun quickAddErrorMessage(
    context: Context,
    error: QuickAddViewModel.QuickAddError,
): String = when (error) {
    QuickAddViewModel.QuickAddError.NoConfig -> context.getString(R.string.qa_error_no_config)
    QuickAddViewModel.QuickAddError.NoCredentials -> context.getString(R.string.qa_error_no_credentials)
    QuickAddViewModel.QuickAddError.Auth -> context.getString(R.string.qa_error_auth)
    QuickAddViewModel.QuickAddError.Network -> context.getString(R.string.qa_error_network)
    QuickAddViewModel.QuickAddError.Unparseable -> context.getString(R.string.qa_error_unparseable)
    is QuickAddViewModel.QuickAddError.Llm -> context.getString(R.string.qa_error_llm)
}

private fun voiceLanguage(): String =
    if (Locale.getDefault().language == "zh") "zh-CN" else "en-US"
