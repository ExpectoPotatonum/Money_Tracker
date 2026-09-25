package com.expensetracker.ui

import com.expensetracker.parse.LlmSettings
import com.expensetracker.sync.AuthStore
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class SettingsViewModelTest {

    @Test
    fun `init prefills credentials and llm settings from the stores`() {
        val authStore = mockk<AuthStore>(relaxed = true)
        val llmSettings = mockk<LlmSettings>(relaxed = true)
        every { authStore.email } returns "owner@example.com"
        every { authStore.password } returns "pw"
        every { llmSettings.apiKey } returns "key"
        every { llmSettings.model } returns "gemini-2.5-flash"
        every { llmSettings.enabled } returns true

        val vm = SettingsViewModel(authStore, llmSettings)

        assertEquals("owner@example.com", vm.state.value.email)
        assertEquals("pw", vm.state.value.password)
        assertEquals("key", vm.state.value.llmApiKey)
        assertEquals("gemini-2.5-flash", vm.state.value.llmModel)
        assertTrue(vm.state.value.llmEnabled)
    }

    @Test
    fun `saveCredentials stores and clears the cached session`() {
        val authStore = mockk<AuthStore>(relaxed = true)
        val vm = SettingsViewModel(authStore, mockk<LlmSettings>(relaxed = true))

        vm.updateCredentials("new@example.com", "newpw")
        vm.saveCredentials()

        assertTrue(vm.state.value.credentialsSaved)
        verify { authStore.email = "new@example.com" }
        verify { authStore.password = "newpw" }
        verify { authStore.accessToken = null }
        verify { authStore.userId = null }
    }

    @Test
    fun `saveLlm trims the key and falls back to the default model`() {
        val llmSettings = mockk<LlmSettings>(relaxed = true)
        val vm = SettingsViewModel(mockk<AuthStore>(relaxed = true), llmSettings)

        vm.updateLlm("  key-with-spaces  ", "  ", false)
        vm.saveLlm()

        assertTrue(vm.state.value.llmSaved)
        verify { llmSettings.apiKey = "key-with-spaces" }
        verify { llmSettings.model = LlmSettings.DEFAULT_MODEL }
        verify { llmSettings.enabled = false }
    }

    @Test
    fun `typing clears the saved flags`() {
        val vm = SettingsViewModel(mockk<AuthStore>(relaxed = true), mockk<LlmSettings>(relaxed = true))
        vm.updateCredentials("a@b.c", "pw")
        vm.saveCredentials()
        vm.updateLlm("k", "m", true)
        assertTrue(vm.state.value.credentialsSaved)
        assertFalse(vm.state.value.llmSaved)
        vm.updateCredentials("a@b.c", "pw2")
        assertFalse(vm.state.value.credentialsSaved)
    }
}
