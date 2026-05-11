import { test, expect } from '@playwright/test';
import { requirePreview, loginAs } from './_helpers.js';

test.describe('Projects > founder DELETE (post-AO verification)', () => {
  test.beforeEach(() => requirePreview(test));

  test('founder can soft-delete an owned project', async ({ page }) => {
    await loginAs(page, 'founder');
    await page.goto('/projects');
    await expect(page.getByTestId('projects-page')).toBeVisible();
    const firstLink = page.locator('a[href^="/projects/"]').first();
    await expect(firstLink).toBeVisible();
    const projectName = (await firstLink.innerText()).trim();
    await firstLink.click();
    await expect(page.getByTestId('project-detail')).toBeVisible();

    // ProjectDetail uses window.confirm for the delete prompt — auto-accept.
    page.once('dialog', async (d) => { await d.accept(); });

    // Capture the DELETE so the test can assert it succeeded even if the
    // post-delete navigation is fast.
    const delResp = page.waitForResponse(r => r.request().method() === 'DELETE' && /\/api\/projects\//.test(r.url()));
    await page.getByTestId('project-delete-btn').click();
    const r = await delResp;
    expect([200, 204]).toContain(r.status());

    // After delete the SPA navigates back to /projects; verify the row is gone
    // (soft-delete: Active projects list excludes deleted rows by default).
    await page.waitForURL(/\/projects(\?|$)/, { timeout: 10_000 });
    await expect(page.getByTestId('projects-page')).toBeVisible();
    if (projectName) {
      await expect(page.locator('a[href^="/projects/"]', { hasText: projectName })).toHaveCount(0);
    }
  });
});
