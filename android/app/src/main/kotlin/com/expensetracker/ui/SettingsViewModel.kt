package com.expensetracker.ui

import androidx.lifecycle.ViewModel
import com.expensetracker.parse.LlmSettings
import com.expensetracker.sync.AuthStore
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Settings tab state — the Supabase credentials (moved out of MainViewModel
 * so the Status tab stops carrying them) plus the on-device LLM quick-add
 * settings (key/model/enabled, mirrored from the web's lib/settings.js).
 */
@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val authStore: AuthStore,
    private val llmSettings: LlmSettings,
) : ViewModel() {

    private val _state = MutableStateFlow(SettingsUiState())
    val state: StateFlow<SettingsUiState> = _state.asStateFlow()

    init {
        _state.value = SettingsUiState(
            email = authStore.email,
            password = authStore.password,
            llmApiKey = llmSettings.apiKey,
            llmModel = llmSettings.model,
            llmEnabled = llmSettings.enabled,
        )
    }

    fun updateCredentials(email: String, password: String) {
        _state.value = _state.value.copy(
            email = email,
            password = password,
            credentialsSaved = false,
        )
    }

    /** Stores creds and drops any cached session so workers sign in afresh. */
    fun saveCredentials() {
        authStore.email = _state.value.email
        authStore.password = _state.value.password
        authStore.accessToken = null
        authStore.userId = null
        _state.value = _state.value.copy(credentialsSaved = true)
    }

    fun updateLlm(apiKey: String, model: String, enabled: Boolean) {
        _state.value = _state.value.copy(
            llmApiKey = apiKey,
            llmModel = model,
            llmEnabled = enabled,
            llmSaved = false,
        )
    }

    fun saveLlm() {
        llmSettings.apiKey = _state.value.llmApiKey.trim()
        llmSettings.model = _state.value.llmModel.trim().ifBlank { LlmSettings.DEFAULT_MODEL }
        llmSettings.enabled = _state.value.llmEnabled
        _state.value = _state.value.copy(llmSaved = true)
    }

    data class SettingsUiState(
        val email: String = "",
        val password: String = "",
        val llmApiKey: String = "",
        val llmModel: String = LlmSettings.DEFAULT_MODEL,
        val llmEnabled: Boolean = false,
        val credentialsSaved: Boolean = false,
        val llmSaved: Boolean = false,
    )
}
