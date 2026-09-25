package com.expensetracker.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.expensetracker.R
import com.expensetracker.capture.ListenerState
import com.expensetracker.sync.HeartbeatWorker
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** App shell — Status / Quick Add / Settings tabs. */
@Composable
fun MainScreen(viewModel: MainViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    var tab by rememberSaveable { mutableStateOf(0) }

    Scaffold { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = { tab = 0 }) { Text(text = stringResource(R.string.tab_status)) }
                TextButton(onClick = { tab = 1 }) { Text(text = stringResource(R.string.tab_quick_add)) }
                TextButton(onClick = { tab = 2 }) { Text(text = stringResource(R.string.tab_settings)) }
            }
            HorizontalDivider()
            when (tab) {
                0 -> StatusTab(state, viewModel)
                1 -> QuickAddTab()
                else -> SettingsTab()
            }
        }
    }
}

@Composable
private fun StatusTab(state: MainViewModel.UiState, viewModel: MainViewModel) {
    val context = LocalContext.current
    val accessGranted = HeartbeatWorker.isListenerAccessGranted(context)

    Column(modifier = Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) {
        StatusRow(
            label = stringResource(R.string.status_listener_connected),
            value = if (ListenerState.bound) "yes" else "no",
        )
        StatusRow(
            label = stringResource(R.string.status_notification_access),
            value = if (accessGranted) "yes" else "no",
        )
        StatusRow(
            label = stringResource(R.string.status_last_captured),
            value = state.lastCapturedAt?.let(::formatTimestamp) ?: stringResource(R.string.status_never_captured),
        )
        StatusRow(
            label = stringResource(R.string.status_heartbeat),
            value = if (state.lastHeartbeatAt > 0) formatTimestamp(state.lastHeartbeatAt) else "never",
        )
        StatusRow(
            label = stringResource(R.string.status_unsynced_count),
            value = state.unsyncedCount.toString(),
        )
        Spacer(modifier = Modifier.height(16.dp))
        Button(onClick = { viewModel.refresh() }) { Text(text = "Refresh") }
    }
}

@Composable
private fun StatusRow(label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(text = label, style = MaterialTheme.typography.bodyMedium)
        Text(text = value, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.primary)
    }
}

private fun formatTimestamp(epochMillis: Long): String =
    SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()).format(Date(epochMillis))
