package com.expensetracker.ui

import com.expensetracker.parse.LlmClient
import com.expensetracker.parse.LlmSettings
import com.expensetracker.sync.AuthStore
import com.expensetracker.sync.SupabaseApi
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

@OptIn(ExperimentalCoroutinesApi::class)
class QuickAddViewModelTest {

    private val dispatcher = StandardTestDispatcher()
    private lateinit var supabaseApi: SupabaseApi
    private lateinit var llmClient: LlmClient
    private lateinit var llmSettings: LlmSettings
    private lateinit var authStore: AuthStore

    @BeforeEach
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        supabaseApi = mockk(relaxed = true)
        llmClient = mockk(relaxed = true)
        llmSettings = mockk(relaxed = true)
        authStore = mockk(relaxed = true)
        every { authStore.hasCredentials() } returns true
        every { authStore.accessToken } returns null
        coEvery { supabaseApi.signIn(any(), any()) } returns SupabaseApi.SignInResponse("tok", "uid")
        coEvery { supabaseApi.listCategories(any()) } returns listOf(SupabaseApi.CategoryRow("c1", "Food & Dining"))
        coEvery { supabaseApi.listAccounts(any()) } returns listOf(SupabaseApi.AccountRow("a1", "Wallet", "MYR"))
    }

    @AfterEach
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun newViewModel(): QuickAddViewModel {
        val vm = QuickAddViewModel(supabaseApi, llmClient, llmSettings, authStore)
        dispatcher.scheduler.advanceUntilIdle()
        return vm
    }

    private fun enableLlm() {
        every { llmSettings.enabled } returns true
        every { llmSettings.apiKey } returns "key"
    }

    private fun llmReply() {
        coEvery { llmClient.call(any()) } returns LlmClient.LlmResult(
            ok = true,
            text = """
                {"usable":true,"amount":12.34,"currency":"MYR","direction":"debit",
                "merchant_raw":"Starbucks","category":"Food & Dining",
                "transaction_date":"2026-09-06T10:00:00+08:00","notes":null}
            """.trimIndent(),
            status = 200,
        )
    }

    @Test
    fun `catalogs load on init`() {
        val vm = newViewModel()
        assertFalse(vm.state.value.loading)
        assertEquals(1, vm.state.value.categories.size)
        assertEquals("Wallet", vm.state.value.accounts.first().name)
        assertNull(vm.state.value.error)
    }

    @Test
    fun `catalog failure surfaces Auth error`() {
        coEvery { supabaseApi.signIn(any(), any()) } throws SupabaseApi.UnauthorizedException("bad creds")
        val vm = newViewModel()
        assertEquals(QuickAddViewModel.QuickAddError.Auth, vm.state.value.error)
        assertFalse(vm.state.value.loading)
        assertTrue(vm.state.value.accounts.isEmpty())
    }

    @Test
    fun `parse with llm produces a draft`() {
        enableLlm()
        llmReply()
        val vm = newViewModel()
        vm.parse("paid 12.34 to starbucks")
        dispatcher.scheduler.advanceUntilIdle()
        val draft = vm.state.value.draft
        assertNotNull(draft)
        assertEquals(12.34, draft!!.amount, 0.0001)
        assertEquals("Starbucks", draft.merchantRaw)
        assertFalse(vm.state.value.parsing)
        assertNull(vm.state.value.error)
    }

    @Test
    fun `llm failure maps to Llm error`() {
        enableLlm()
        coEvery { llmClient.call(any()) } returns LlmClient.LlmResult(
            ok = false,
            status = 429,
            kind = LlmClient.LlmResult.Kind.QUOTA,
        )
        val vm = newViewModel()
        vm.parse("paid 5 to shop")
        dispatcher.scheduler.advanceUntilIdle()
        val error = vm.state.value.error
        assertTrue(error is QuickAddViewModel.QuickAddError.Llm)
        assertEquals(LlmClient.LlmResult.Kind.QUOTA, (error as QuickAddViewModel.QuickAddError.Llm).kind)
        assertNull(vm.state.value.draft)
    }

    @Test
    fun `parse without llm config reports NoConfig`() {
        every { llmSettings.enabled } returns false
        val vm = newViewModel()
        vm.parse("paid 5 to shop")
        assertEquals(QuickAddViewModel.QuickAddError.NoConfig, vm.state.value.error)
        assertNull(vm.state.value.draft)
    }

    @Test
    fun `parse without credentials reports NoCredentials`() {
        enableLlm()
        every { authStore.hasCredentials() } returns false
        val vm = newViewModel()
        vm.parse("paid 5 to shop")
        assertEquals(QuickAddViewModel.QuickAddError.NoCredentials, vm.state.value.error)
    }

    @Test
    fun `blank text is ignored`() {
        enableLlm()
        val vm = newViewModel()
        vm.parse("   ")
        dispatcher.scheduler.advanceUntilIdle()
        assertNull(vm.state.value.draft)
        assertNull(vm.state.value.error)
        coVerify(exactly = 0) { llmClient.call(any()) }
    }

    @Test
    fun `save inserts the reviewed row and clears the draft`() {
        enableLlm()
        llmReply()
        val vm = newViewModel()
        vm.parse("paid 12.34 to starbucks")
        dispatcher.scheduler.advanceUntilIdle()
        assertNotNull(vm.state.value.draft)

        coEvery { supabaseApi.insertTransaction(any(), any()) } returns Unit
        vm.save(
            QuickAddViewModel.QuickAddForm(
                accountId = "a1",
                amount = "13.00",
                currency = "MYR",
                direction = "debit",
                merchantRaw = "Starbucks",
                categoryName = "Food & Dining",
                dateText = "2026-09-06 10:00",
                sourceLabel = "Cash",
                notes = "",
            ),
        )
        dispatcher.scheduler.advanceUntilIdle()

        assertTrue(vm.state.value.saved)
        assertNull(vm.state.value.draft)
        coVerify(exactly = 1) {
            supabaseApi.insertTransaction(
                match {
                    it.getDouble("amount") == 13.0 &&
                        it.getString("account_id") == "a1" &&
                        it.getString("category_id") == "c1" &&
                        it.getString("source_package") == "manual" &&
                        it.getString("confidence") == "low" &&
                        it.getString("transaction_date").contains("2026-09-06")
                },
                "tok",
            )
        }
    }

    @Test
    fun `save retries once when the cached token is stale`() {
        enableLlm()
        llmReply()
        val vm = newViewModel()
        vm.parse("paid 12.34 to starbucks")
        dispatcher.scheduler.advanceUntilIdle()

        var insertCalls = 0
        coEvery { supabaseApi.insertTransaction(any(), any()) } answers {
            insertCalls++
            if (insertCalls == 1) throw SupabaseApi.UnauthorizedException("stale token")
            Unit
        }
        vm.save(
            QuickAddViewModel.QuickAddForm(
                accountId = "a1",
                amount = "12.34",
                sourceLabel = "Cash",
            ),
        )
        dispatcher.scheduler.advanceUntilIdle()

        assertTrue(vm.state.value.saved)
        assertNull(vm.state.value.draft)
        coVerify(exactly = 2) { supabaseApi.insertTransaction(any(), any()) }
    }

    @Test
    fun `save maps persistent auth failure to Auth error`() {
        enableLlm()
        llmReply()
        val vm = newViewModel()
        vm.parse("paid 12.34 to starbucks")
        dispatcher.scheduler.advanceUntilIdle()

        coEvery { supabaseApi.insertTransaction(any(), any()) } throws
            SupabaseApi.UnauthorizedException("stale token")
        coEvery { supabaseApi.signIn(any(), any()) } throws SupabaseApi.UnauthorizedException("bad creds")
        vm.save(
            QuickAddViewModel.QuickAddForm(
                accountId = "a1",
                amount = "12.34",
                sourceLabel = "Cash",
            ),
        )
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals(QuickAddViewModel.QuickAddError.Auth, vm.state.value.error)
        assertFalse(vm.state.value.saving)
    }
}
