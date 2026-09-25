package com.expensetracker.ui

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.expensetracker.R
import com.expensetracker.capture.TargetPackages

/**
 * Settings tab — Supabase credentials (AuthStore), the quick-add LLM fields
 * (key/model/enabled, LlmSettings), the notification-listener battery survival
 * buttons, and the tracked-package list. Credentials and LLM sections are
 * backed by SettingsViewModel; the rest are leaf actions.
 */
@Composable
fun SettingsTab(viewModel: SettingsViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
    ) {
        Text(
            text = stringResource(R.string.settings_redaction_note),
            style = MaterialTheme.typography.bodySmall,
        )
        Spacer(modifier = Modifier.height(16.dp))

        OutlinedTextField(
            value = state.email,
            onValueChange = { viewModel.updateCredentials(it, state.password) },
            label = { Text(text = stringResource(R.string.settings_supabase_email)) },
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(modifier = Modifier.height(8.dp))
        OutlinedTextField(
            value = state.password,
            onValueChange = { viewModel.updateCredentials(state.email, it) },
            label = { Text(text = stringResource(R.string.settings_supabase_password)) },
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(modifier = Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Button(onClick = { viewModel.saveCredentials() }) {
                Text(text = stringResource(R.string.settings_save))
            }
            if (state.credentialsSaved) {
                Spacer(modifier = Modifier.width(8.dp))
                Text(text = stringResource(R.string.settings_saved))
            }
        }

        Spacer(modifier = Modifier.height(24.dp))
        Text(
            text = stringResource(R.string.settings_llm_title),
            style = MaterialTheme.typography.titleSmall,
        )
        Spacer(modifier = Modifier.height(8.dp))
        OutlinedTextField(
            value = state.llmApiKey,
            onValueChange = { viewModel.updateLlm(it, state.llmModel, state.llmEnabled) },
            label = { Text(text = stringResource(R.string.settings_llm_key)) },
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(modifier = Modifier.height(8.dp))
        OutlinedTextField(
            value = state.llmModel,
            onValueChange = { viewModel.updateLlm(state.llmApiKey, it, state.llmEnabled) },
            label = { Text(text = stringResource(R.string.settings_llm_model)) },
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(modifier = Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = stringResource(R.string.settings_llm_enabled),
                modifier = Modifier.weight(1f),
            )
            Switch(
                checked = state.llmEnabled,
                onCheckedChange = { viewModel.updateLlm(state.llmApiKey, state.llmModel, it) },
            )
        }
        Spacer(modifier = Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Button(onClick = { viewModel.saveLlm() }) {
                Text(text = stringResource(R.string.settings_save))
            }
            if (state.llmSaved) {
                Spacer(modifier = Modifier.width(8.dp))
                Text(text = stringResource(R.string.settings_saved))
            }
        }

        Spacer(modifier = Modifier.height(24.dp))
        Button(onClick = {
            context.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        }) {
            Text(text = stringResource(R.string.settings_open_listener_settings))
        }
        Spacer(modifier = Modifier.height(8.dp))
        Button(onClick = { openBatteryExemption(context) }) {
            Text(text = stringResource(R.string.settings_battery_exemption))
        }

        Spacer(modifier = Modifier.height(24.dp))
        Text(
            text = "${stringResource(R.string.settings_untracked_packages)}: ${TargetPackages.ALL.size}",
            style = MaterialTheme.typography.titleSmall,
        )
        TargetPackages.ALL.forEach {
            Text(text = it, style = MaterialTheme.typography.bodySmall)
        }
    }
}

private fun openBatteryExemption(context: android.content.Context) {
    val intent = Intent(
        Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
        Uri.parse("package:${context.packageName}"),
    )
    context.startActivity(intent)
}
