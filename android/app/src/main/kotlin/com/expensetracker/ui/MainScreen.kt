package com.expensetracker.ui

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.hilt.navigation.compose.hiltViewModel
import com.expensetracker.R
import com.expensetracker.capture.ListenerState
import com.expensetracker.capture.TargetPackages
import com.expensetracker.sync.HeartbeatWorker
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun MainScreen(viewModel: MainViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    var tab by remember { mutableStateOf(0) }

    Scaffold { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = { tab = 0 }) { Text(text = string(R.string.tab_status)) }
                TextButton(onClick = { tab = 1 }) { Text(text = string(R.string.tab_settings)) }
            }
            HorizontalDivider()
            when (tab) {
                0 -> StatusTab(state, viewModel)
                else -> SettingsTab(state, viewModel)
            }
        }
    }
}

@Composable
private fun StatusTab(state: MainViewModel.UiState, viewModel: MainViewModel) {
    val context = LocalContext.current
    val accessGranted = HeartbeatWorker.isListenerAccessGranted(context)

    Column(modifier = Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) {
        StatusRow(label = string(R.string.status_listener_connected), value = if (ListenerState.bound) "yes" else "no")
        StatusRow(label = string(R.string.status_notification_access), value = if (accessGranted) "yes" else "no")
        StatusRow(
            label = string(R.string.status_last_captured),
            value = state.lastCapturedAt?.let(::formatTimestamp) ?: string(R.string.status_never_captured),
        )
        StatusRow(
            label = string(R.string.status_heartbeat),
            value = if (state.lastHeartbeatAt > 0) formatTimestamp(state.lastHeartbeatAt) else "never",
        )
        StatusRow(label = string(R.string.status_unsynced_count), value = state.unsyncedCount.toString())
        Spacer(modifier = Modifier.height(16.dp))
        Button(onClick = { viewModel.refresh() }) { Text(text = "Refresh") }
    }
}

@Composable
private fun SettingsTab(state: MainViewModel.UiState, viewModel: MainViewModel) {
    val context = LocalContext.current
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }

    Column(
        modifier = Modifier
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
    ) {
        Text(text = string(R.string.settings_redaction_note), style = MaterialTheme.typography.bodySmall)
        Spacer(modifier = Modifier.height(16.dp))

        OutlinedTextField(
            value = email,
            onValueChange = { email = it },
            label = { Text(text = string(R.string.settings_supabase_email)) },
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(modifier = Modifier.height(8.dp))
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text(text = string(R.string.settings_supabase_password)) },
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(modifier = Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Button(onClick = { viewModel.saveCredentials(email, password) }) {
                Text(text = string(R.string.settings_save))
            }
            if (state.credentialsSaved) {
                Spacer(modifier = Modifier.padding(start = 8.dp))
                Text(text = string(R.string.settings_saved))
            }
        }

        Spacer(modifier = Modifier.height(24.dp))
        Button(onClick = {
            context.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        }) {
            Text(text = string(R.string.settings_open_listener_settings))
        }
        Spacer(modifier = Modifier.height(8.dp))
        Button(onClick = { openBatteryExemption(context) }) {
            Text(text = string(R.string.settings_battery_exemption))
        }

        Spacer(modifier = Modifier.height(24.dp))
        Text(
            text = "${string(R.string.settings_untracked_packages)}: ${TargetPackages.ALL.size}",
            style = MaterialTheme.typography.titleSmall,
        )
        TargetPackages.ALL.forEach {
            Text(text = it, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun StatusRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(text = label, style = MaterialTheme.typography.bodyMedium)
        Text(text = value, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.primary)
    }
}

@Composable
private fun string(id: Int): String = androidx.compose.ui.res.stringResource(id)

private fun openBatteryExemption(context: android.content.Context) {
    val intent = Intent(
        Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
        Uri.parse("package:${context.packageName}"),
    )
    context.startActivity(intent)
}

private fun formatTimestamp(epochMillis: Long): String =
    SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()).format(Date(epochMillis))
