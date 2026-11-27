/**
 * Task #32 — Admin docs visibility verification.
 *
 * Asserts that admin documentation is invisible to non-admin users on
 * every surface: sidebar rail, body content, right-rail "On this page"
 * list, direct-URL deep links (path + hash), and the docs-page Fuse.js
 * search.
 *
 * Skips cleanly when PLAYWRIGHT_BASE_URL is unset (same convention as
 * every other spec in this directory — see _helpers.js).
 */

import { test, expect, Page } from '@playwright/test';
// @ts-expect-error — _helpers is JS, no .d.ts. Runtime import is fine.
import { requirePreview, loginAs } from './_helpers.js';

async function openDocs(page: Page) {
  // The left rail is `lg:block` only — set a desktop viewport so the
  // rail mounts. Other specs rely on the same convention.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/docs');
  await page.waitForLoadState('networkidle');
}

// Pull the destination anchor encoded by a docs search result button.
// DocsLayout calls `goToAnchor(r.anchor)` which then `navigate(\`#${anchor}\`)`.
// We click each candidate and read `location.hash` to derive the anchor
// without depending on label-text heuristics.
async function searchResultAnchors(page: Page, query: string): Promise<string[]> {
  const search = page.getByLabel(/Search documentation/i);
  await search.fill(query);
  await page.waitForTimeout(400); // debounce + fuse pass
  // The results list lives inside the left rail (the `<aside>` that
  // contains the search input). Result rows are buttons that include
  // the section + subsection title; section-header buttons are
  // suppressed while a query is active, so every visible aside button
  // is a result row at this point.
  const buttons = page.locator('aside button');
  const count = await buttons.count();
  const anchors: string[] = [];
  for (let i = 0; i < count; i++) {
    const btn = buttons.nth(i);
    // Skip the clear-search "X" button (it has aria-label="Clear search").
    const aria = (await btn.getAttribute('aria-label')) || '';
    if (/clear search/i.test(aria)) continue;
    await btn.click();
    const hash = await page.evaluate(() => decodeURIComponent(window.location.hash.replace(/^#/, '')));
    if (hash) anchors.push(hash);
    // Re-open the search by typing again — clicking a result clears
    // the query, so we restore it before reading the next row.
    await search.fill(query);
    await page.waitForTimeout(250);
  }
  return anchors;
}

test.describe('Admin docs visibility (Task #32)', () => {
  test.beforeEach(() => requirePreview(test));

  test('logged-out → /docs/admin/admin-console renders generic 404 (no "admin" leak)', async ({ page }) => {
    await page.goto('/docs/admin/admin-console');
    await page.waitForLoadState('networkidle');
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body).toContain('page not found');
    expect(body).not.toContain('permission denied');
    expect(body).not.toContain('admin only');
  });

  test('logged-out → /docs rail has no "Admin" (auth guard keeps the rail unmounted entirely)', async ({ page }) => {
    await page.goto('/docs');
    await page.waitForLoadState('networkidle');
    // The /docs route is wrapped in guard([...roles]); anonymous users
    // are either bounced to /login OR see the rail unmounted. Either
    // way, the "Admin" group must NOT be visible.
    const adminGroup = page.getByRole('button', { name: /^Admin$/i });
    await expect(adminGroup).toHaveCount(0);
  });

  test('founder → /docs rail has no "Admin" section header', async ({ page }) => {
    await loginAs(page, 'founder');
    await openDocs(page);
    const nav = page.getByRole('navigation', { name: /Documentation contents/i });
    await expect(nav).toBeVisible();
    const adminGroup = nav.getByRole('button', { name: /^Admin$/i });
    await expect(adminGroup).toHaveCount(0);
  });

  test('founder → /docs body has no admin section headings or anchors', async ({ page }) => {
    await loginAs(page, 'founder');
    await openDocs(page);
    // Body suppression: the `<section data-anchor="admin/...">` blocks
    // must not be rendered for non-admin viewers.
    const adminAnchors = page.locator('[data-anchor^="admin/"]');
    await expect(adminAnchors).toHaveCount(0);
    // The portals/admin subsection is also admin-only.
    const portalsAdmin = page.locator('[data-anchor="portals/admin"]');
    await expect(portalsAdmin).toHaveCount(0);
  });

  test('founder → "On this page" right rail never points at an admin anchor', async ({ page }) => {
    await loginAs(page, 'founder');
    await openDocs(page);
    // Iterate every visible section by clicking its rail group, then
    // confirm the right-rail TOC never lists an admin anchor.
    const sectionButtons = page
      .getByRole('navigation', { name: /Documentation contents/i })
      .getByRole('button');
    const total = await sectionButtons.count();
    for (let i = 0; i < total; i++) {
      const label = (await sectionButtons.nth(i).innerText()).trim();
      if (!label || /admin/i.test(label)) continue; // header buttons only
      await sectionButtons.nth(i).click();
      await page.waitForTimeout(150);
      const hash = await page.evaluate(() => decodeURIComponent(window.location.hash.replace(/^#/, '')));
      expect(hash.startsWith('admin/')).toBe(false);
      expect(hash).not.toBe('portals/admin');
    }
  });

  test('admin → /docs rail shows "Admin" section header', async ({ page }) => {
    await loginAs(page, 'admin');
    await openDocs(page);
    const nav = page.getByRole('navigation', { name: /Documentation contents/i });
    await expect(nav).toBeVisible();
    const adminGroup = nav.getByRole('button', { name: /^Admin$/i });
    await expect(adminGroup.first()).toBeVisible();
  });

  test('founder → /docs/admin/admin-console renders generic 404', async ({ page }) => {
    await loginAs(page, 'founder');
    await page.goto('/docs/admin/admin-console');
    await page.waitForLoadState('networkidle');
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body).toContain('page not found');
    expect(body).not.toContain('permission denied');
  });

  test('founder → docs search for admin-only terms never returns an #admin/ anchor', async ({ page }) => {
    await loginAs(page, 'founder');
    await openDocs(page);
    for (const q of ['feature flag', 'audit log', 'impersonate']) {
      const anchors = await searchResultAnchors(page, q);
      for (const a of anchors) {
        expect(a.startsWith('admin/')).toBe(false);
        expect(a).not.toBe('portals/admin');
      }
    }
  });

  test('admin → docs search for "feature flag" returns an admin/feature-flags anchor', async ({ page }) => {
    await loginAs(page, 'admin');
    await openDocs(page);
    const anchors = await searchResultAnchors(page, 'feature flag');
    const hasAdminHit = anchors.some(a => a === 'admin/feature-flags');
    expect(hasAdminHit).toBe(true);
  });

  // -- Cmd+K global command palette coverage (Task #32 §6 last box) --

  // The palette is mounted in ProtectedLayout; opening via Meta+K /
  // Control+K toggles a dialog with aria-label="Command palette". The
  // four built-in admin doc subsection labels live in admin.js + the
  // portals/admin subsection; if any of them surface in a non-admin
  // user's palette docs group, the role filter is broken.
  const ADMIN_DOC_LABELS = [
    'Admin overview',
    'Users & roles',
    'Trust management',
    'Contracts',
    'Audit log',
    'Feature flags & rollout',
    'Admin Console (overview)',
  ];

  async function openCommandPalette(page: Page) {
    // Try Meta+K first (macOS default), then Control+K (other platforms).
    await page.keyboard.press('Meta+K').catch(() => {});
    const dialog = page.getByRole('dialog', { name: /Command palette/i });
    if (!(await dialog.isVisible().catch(() => false))) {
      await page.keyboard.press('Control+K').catch(() => {});
    }
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    return dialog;
  }

  async function paletteDocLabels(page: Page, query: string): Promise<string[]> {
    const dialog = await openCommandPalette(page);
    const input = dialog.getByLabel(/Search command palette/i);
    await input.fill(query);
    await page.waitForTimeout(300);
    // The docs group is rendered after a "Documentation" header div.
    // Grab every result button label inside the dialog and let the
    // caller filter — the admin labels are unique enough across groups
    // that simple containment is sufficient.
    const buttons = dialog.locator('button');
    const count = await buttons.count();
    const labels: string[] = [];
    for (let i = 0; i < count; i++) {
      const t = (await buttons.nth(i).innerText()).trim();
      if (t) labels.push(t);
    }
    // Close palette before the next call.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 3_000 });
    return labels;
  }

  test('founder → Cmd+K palette never lists an admin doc label for admin-only queries', async ({ page }) => {
    await loginAs(page, 'founder');
    // Need to be on an authenticated route so ProtectedLayout (and the
    // palette) is mounted. /docs is fine.
    await openDocs(page);
    for (const q of ['feature flag', 'audit log', 'impersonate']) {
      const labels = await paletteDocLabels(page, q);
      for (const adminLabel of ADMIN_DOC_LABELS) {
        const leaked = labels.some(l => l.includes(adminLabel));
        expect(leaked, `Founder palette leaked admin doc "${adminLabel}" for query "${q}"`).toBe(false);
      }
    }
  });

  test('admin → Cmd+K palette surfaces the "Feature flags & rollout" admin doc', async ({ page }) => {
    await loginAs(page, 'admin');
    await openDocs(page);
    const labels = await paletteDocLabels(page, 'feature flag');
    const hit = labels.some(l => l.includes('Feature flags & rollout'));
    expect(hit).toBe(true);
  });

  test('founder → /docs#admin/users strips the hash and lands on plain /docs', async ({ page }) => {
    await loginAs(page, 'founder');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/docs#admin/users');
    await page.waitForLoadState('networkidle');
    await expect.poll(() => new URL(page.url()).hash, { timeout: 5_000 }).toBe('');
    const nav = page.getByRole('navigation', { name: /Documentation contents/i });
    const adminGroup = nav.getByRole('button', { name: /^Admin$/i });
    await expect(adminGroup).toHaveCount(0);
  });
});
