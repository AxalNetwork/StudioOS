import { test, expect } from '@playwright/test';
import { requirePreview, loginAs } from './_helpers.js';

test.describe('Calendar > Google OAuth start (post-AO verification)', () => {
  test.beforeEach(() => requirePreview(test));

  test('Connect Google initiates the OAuth flow (or already-connected)', async ({ page }) => {
    await loginAs(page, 'founder');
    await page.goto('/calendar');
    await expect(page.getByTestId('calendar-page')).toBeVisible();

    const connect = page.getByTestId('calendar-connect-google-btn');
    if (await connect.count()) {
      // Watch for either a navigation to Google's OAuth URL or a
      // call to /api/calendar/google/oauth/start (the SPA may either
      // window.location.assign() or open a popup).
      const oauthStart = page.waitForResponse(
        r => /\/api\/calendar\/google\/(oauth|start|connect)/i.test(r.url()),
        { timeout: 5_000 }
      ).catch(() => null);
      const navToGoogle = page.waitForURL(/accounts\.google\.com|google\.com\/o\/oauth2/i, { timeout: 5_000 }).catch(() => null);
      await connect.click().catch(() => {}); // popup may already block before resolution
      const [resp, nav] = await Promise.all([oauthStart, navToGoogle]);
      expect(resp || nav, 'expected either OAuth start API call OR navigation to Google').toBeTruthy();
    } else {
      // Already linked — assert the disconnect/sync controls are wired.
      const sync = page.getByRole('button', { name: /Sync now|Syncing/i });
      const disconnect = page.getByRole('button', { name: /Disconnect/i });
      expect((await sync.count()) + (await disconnect.count())).toBeGreaterThan(0);
    }
  });
});
