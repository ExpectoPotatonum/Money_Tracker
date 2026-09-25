package com.expensetracker.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.expensetracker.parse.JsonExtractor
import com.expensetracker.parse.LlmClient
import com.expensetracker.parse.LlmSettings
import com.expensetracker.parse.NlPrompts
import com.expensetracker.parse.TransactionDraft
import com.expensetracker.parse.TransactionNormalizer
import com.expensetracker.sync.AuthStore
import com.expensetracker.sync.ManualTransactionBuilder
import com.expensetracker.sync.SupabaseApi
import dagger.hilt.android.lifecycle.HiltViewModel
import java.io.IOException
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * Phase 5 — quick-add manual bookkeeping (voice/text -> LLM -> editable preview
 * -> insert). Mirrors the web's nlModal + utils/ai.js flow, driven by the parse
 * core committed in 3401ae4 (LlmClient / NlPrompts / JsonExtractor /
 * TransactionNormalizer).
 *
 * The Supabase session is the same unattended AuthStore sign-in the sync
 * workers use: reuse a cached access token, sign in on demand when missing,
 * and on a stale-token failure (401/403 from the insert) clear the cached
 * token and retry the insert once.
 */
@HiltViewModel
class QuickAddViewModel @Inject constructor(
    private val supabaseApi: SupabaseApi,
    private val llmClient: LlmClient,
    private val llmSettings: LlmSettings,
    private val authStore: AuthStore,
) : ViewModel() {

    private val _state = MutableStateFlow(QuickAddUiState())
    val state: StateFlow<QuickAddUiState> = _state.asStateFlow()

    init {
        refreshCatalogs()
    }

    fun refreshCatalogs() {
        viewModelScope.launch { loadCatalogs() }
    }

    /** Categories + accounts for the pickers (RLS-scoped to the signed-in user). */
    suspend fun loadCatalogs() {
        _state.value = _state.value.copy(loading = true, error = null)
        try {
            val token = ensureToken()
            val categories = supabaseApi.listCategories(token)
            val accounts = supabaseApi.listAccounts(token)
            _state.value = _state.value.copy(loading = false, categories = categories, accounts = accounts)
        } catch (e: SupabaseApi.UnauthorizedException) {
            _state.value = _state.value.copy(loading = false, error = QuickAddError.Auth)
        } catch (e: IOException) {
            _state.value = _state.value.copy(loading = false, error = QuickAddError.Network)
        }
    }

    /** Ask the LLM to turn [userText] into a normalized [TransactionDraft]. */
    fun parse(userText: String) {
        val text = userText.trim()
        if (text.isEmpty()) return
        if (!llmSettings.enabled || llmSettings.apiKey.isBlank()) {
            _state.value = _state.value.copy(error = QuickAddError.NoConfig)
            return
        }
        if (!authStore.hasCredentials()) {
            _state.value = _state.value.copy(error = QuickAddError.NoCredentials)
            return
        }
        viewModelScope.launch {
            _state.value = _state.value.copy(parsing = true, draft = null, error = null)
            try {
                val token = ensureToken()
                val categoryNames = _state.value.categories.map { it.name }
                val prompt = NlPrompts.buildNlPrompt(
                    userText = text,
                    categoryNames = categoryNames,
                    currencies = TransactionNormalizer.SUPPORTED_CURRENCIES.toList(),
                )
                val result = llmClient.call(prompt)
                if (!result.ok) {
                    _state.value = _state.value.copy(
                        parsing = false,
                        error = QuickAddError.Llm(result.kind),
                    )
                    return@launch
                }
                val draft = TransactionNormalizer.normalize(JsonExtractor.extractObject(result.text))
                if (draft == null) {
                    _state.value = _state.value.copy(parsing = false, error = QuickAddError.Unparseable)
                } else {
                    _state.value = _state.value.copy(parsing = false, draft = draft)
                }
            } catch (e: SupabaseApi.UnauthorizedException) {
                _state.value = _state.value.copy(parsing = false, error = QuickAddError.Auth)
            } catch (e: IOException) {
                _state.value = _state.value.copy(parsing = false, error = QuickAddError.Network)
            }
        }
    }

    /**
     * Insert the reviewed form. A stale cached token retries once (cleared and
     * re-signed-in) before surfacing an auth error.
     */
    fun save(form: QuickAddForm) {
        val draft = _state.value.draft ?: return
        if (form.accountId.isBlank()) return
        viewModelScope.launch {
            _state.value = _state.value.copy(saving = true, error = null)
            try {
                val row = buildRow(draft, form)
                val token = ensureToken()
                try {
                    supabaseApi.insertTransaction(row, token)
                } catch (e: SupabaseApi.UnauthorizedException) {
                    authStore.accessToken = null
                    supabaseApi.insertTransaction(row, ensureToken())
                }
                _state.value = _state.value.copy(saving = false, saved = true, draft = null)
            } catch (e: SupabaseApi.UnauthorizedException) {
                _state.value = _state.value.copy(saving = false, error = QuickAddError.Auth)
            } catch (e: IOException) {
                _state.value = _state.value.copy(saving = false, error = QuickAddError.Network)
            }
        }
    }

    /** Return to input mode after a successful save. */
    fun ackSaved() {
        if (_state.value.saved) {
            _state.value = _state.value.copy(saved = false, error = null)
        }
    }

    private fun buildRow(draft: TransactionDraft, form: QuickAddForm): JSONObject {
        val amount = form.amount.toDoubleOrNull()?.takeIf { it > 0 } ?: draft.amount
        val direction = when (form.direction) {
            TransactionDraft.Direction.CREDIT.column -> TransactionDraft.Direction.CREDIT
            else -> TransactionDraft.Direction.DEBIT
        }
        val categoryId = _state.value.categories.firstOrNull { it.name == form.categoryName }?.id
        val dateIso = ManualTransactionBuilder.localDateTextToIso(form.dateText) ?: draft.transactionDateIso
        return ManualTransactionBuilder.build(
            amount = amount,
            direction = direction,
            currency = form.currency,
            merchantRaw = form.merchantRaw.trim().takeIf { it.isNotBlank() },
            categoryId = categoryId,
            accountId = form.accountId,
            transactionDateIso = dateIso,
            sourceLabel = form.sourceLabel,
            notes = form.notes.trim().takeIf { it.isNotBlank() },
        )
    }

    private suspend fun ensureToken(): String {
        authStore.accessToken?.let { return it }
        val response = supabaseApi.signIn(authStore.email, authStore.password)
        authStore.accessToken = response.accessToken
        authStore.userId = response.userId
        return response.accessToken
    }

    data class QuickAddForm(
        val accountId: String = "",
        val amount: String = "",
        val currency: String = "MYR",
        val direction: String = TransactionDraft.Direction.DEBIT.column,
        val merchantRaw: String = "",
        val categoryName: String = "",
        val dateText: String = "",
        val sourceLabel: String = ManualTransactionBuilder.DEFAULT_SOURCE,
        val notes: String = "",
    )

    data class QuickAddUiState(
        val loading: Boolean = true,
        val categories: List<SupabaseApi.CategoryRow> = emptyList(),
        val accounts: List<SupabaseApi.AccountRow> = emptyList(),
        val parsing: Boolean = false,
        val draft: TransactionDraft? = null,
        val saving: Boolean = false,
        val saved: Boolean = false,
        val error: QuickAddError? = null,
    )

    sealed interface QuickAddError {
        /** Gemini key missing / AI disabled in Settings. */
        data object NoConfig : QuickAddError
        /** Supabase email/password missing in Settings. */
        data object NoCredentials : QuickAddError
        data object Auth : QuickAddError
        data object Network : QuickAddError
        /** LLM replied, but nothing usable could be extracted. */
        data object Unparseable : QuickAddError
        data class Llm(val kind: LlmClient.LlmResult.Kind?) : QuickAddError
    }
}
