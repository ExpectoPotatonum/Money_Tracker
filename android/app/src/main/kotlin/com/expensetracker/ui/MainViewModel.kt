package com.expensetracker.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.expensetracker.data.CaptureRepository
import com.expensetracker.sync.AuthStore
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

@HiltViewModel
class MainViewModel @Inject constructor(
    private val repository: CaptureRepository,
    private val authStore: AuthStore,
) : ViewModel() {

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            val now = System.currentTimeMillis()
            _state.value = UiState(
                lastCapturedAt = repository.lastCapturedAt(),
                unsyncedCount = repository.countUnsynced(),
                syncQueryMillis = now,
            )
        }
    }

    fun saveCredentials(email: String, password: String) {
        authStore.email = email
        authStore.password = password
        _state.value = _state.value.copy(credentialsSaved = true)
    }

    fun credentialsDismissed() {
        _state.value = _state.value.copy(credentialsSaved = false)
    }

    data class UiState(
        val lastCapturedAt: Long? = null,
        val unsyncedCount: Int = 0,
        val syncQueryMillis: Long = 0,
        val credentialsSaved: Boolean = false,
    )
}
