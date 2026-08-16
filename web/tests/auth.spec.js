import { test, expect } from '@playwright/test';

test('shows the sign-in gate when there is no session', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#auth-gate')).toBeVisible();
  await expect(page.locator('#auth-gate input[type="email"]')).toBeVisible();
  await expect(page.locator('#auth-gate input[type="password"]')).toBeVisible();
});
