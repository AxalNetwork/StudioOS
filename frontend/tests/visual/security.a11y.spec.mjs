/**
 * D4803 (#4803, #4800 §7, canvas SEC accessibility and SE11 phone) — HQ ›
 * Security in a real browser: the seven workspaces at a desk (1440), on a
 * tablet (768) and on a phone (390), in light and in dark, read from the real
 * routes over the scenario `_security_seed.ts` seeds (a failed restore drill,
 * two administrators without MFA, three sessions, a deletion request near its
 * date, ledger rows, a Trust Center draft).
 *
 * The bar is the Approvals pass's (D4814): ZERO serious or critical axe
 * violations (WCAG 2.0, 2.1 and 2.2 A and AA rules) in the Security frame and
 * in every dialog it opens, and no page wider than its viewport. Each check is
 * a defect this pass found and fixed, or a behaviour the canvas specifies,
 * held so it stays:
 *   · every workspace's small labels and timestamps were #a1a1aa on white or
 *     on the ground (2.3:1 to 2.6:1); they are the muted ink now;
 *   · the workspace links move with Left, Right, Home and End and open the
 *     workspace as focus lands, with a visible focus ring; keys pressed in
 *     quick succession used to move from the workspace before (End then Right
 *     opened Access), because the move read the page's tab while the router
 *     was still rendering the last one;
 *   · on a phone the section select and every finding's action are 44 px;
 *   · the revoke sheet (SE11c) takes focus, keeps Tab inside, closes on Esc
 *     and gives focus back to the button that opened it, with 44 px actions;
 *   · Eadwyn (SE12) offers the security prompts first, and models, usage and
 *     top-up are one link away rather than on the page.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { manifest, prepare } from './_editor.mjs';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const TABS = ['overview', 'events', 'access', 'privacy', 'trust', 'ai-safety', 'resilience'];
const SIZES = { desk: { width: 1440, height: 900 }, tablet: { width: 768, height: 1024 }, phone: { width: 390, height: 844 } };
const PROMPTS = ['Summarize unresolved security items', 'Explain the failed restore drill', 'Identify sessions that warrant review',
  'Summarize events since yesterday', 'Explain recent refusals', 'Explain why a status is unavailable'];

async function open(page, request, tab, viewport = SIZES.desk) {
  await page.setViewportSize(viewport);
  await prepare(page, request, { as: 'security' });
  await page.goto(`/admin/security?tab=${tab}`);
  await expect(page.getByTestId('hq-security-page')).toBeVisible();
  await page.waitForLoadState('networkidle');
}

/** Serious and critical violations in the Security frame and any open dialog, one line each. */
async function blocking(page) {
  const builder = new AxeBuilder({ page }).withTags(TAGS).include('[data-testid="hq-security-page"]');
  if (await page.locator('[role="dialog"]').count()) builder.include('[role="dialog"]');
  const r = await builder.analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

/** Every workspace at the three widths: axe, then the page's own width. */
async function sweep(page, tab) {
  for (const [name, vp] of Object.entries(SIZES)) {
    await page.setViewportSize(vp);
    await page.waitForTimeout(150);
    expect(await blocking(page), `${tab} at ${name}`).toEqual([]);
    // A table may scroll inside its own card; the page itself never scrolls sideways.
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${tab} at ${name}`).toBeLessThanOrEqual(vp.width);
  }
}

const setTheme = async (request, theme) => {
  const m = await manifest(request);
  const res = await request.put('/api/settings/appearance', { headers: { Authorization: `Bearer ${m.security.token}` }, data: { theme } });
  expect(res.ok()).toBe(true);
};

test.describe('axe and width: every workspace at a desk, a tablet and a phone', () => {
  for (const tab of TABS) {
    test(`${tab} in light`, async ({ page, request }) => {
      await open(page, request, tab);
      await sweep(page, tab);
    });
  }

  test.describe('in dark', () => {
    test.beforeEach(async ({ request }) => setTheme(request, 'dark'));
    test.afterEach(async ({ request }) => setTheme(request, 'light'));
    for (const tab of TABS) {
      test(`${tab} in dark`, async ({ page, request }) => {
        await open(page, request, tab);
        await expect(page.locator('html')).toHaveClass(/dark/);
        await sweep(page, tab);
      });
    }
  });
});

test('the workspace links move with the arrow keys, Home and End, and show where focus is', async ({ page, request }) => {
  await open(page, request, 'overview');
  await page.getByTestId('security-tab-overview').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/tab=events/);
  await expect(page.getByTestId('security-tab-events')).toBeFocused();
  await expect(page.getByTestId('security-tab-events')).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('End');
  await expect(page).toHaveURL(/tab=resilience/);
  await expect(page.getByTestId('security-tab-resilience')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/tab=overview/);
  // Back to back, as a held key sends them: each moves from the link it lands on.
  // (The race is timing-bound here; hq_security_v2_d4800.test.mjs holds it every time.)
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(page).toHaveURL(/tab=trust/);
  await expect(page.getByTestId('security-tab-trust')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.getByTestId('security-tab-overview')).toBeFocused();
  // Keyboard focus draws a ring (focus-visible), not the browser's nothing.
  const ring = await page.getByTestId('security-tab-overview').evaluate((el) => getComputedStyle(el).boxShadow);
  expect(ring).not.toBe('none');
});

test('on a phone (SE11a): the section select and every finding\'s action are 44 px, and Action required comes first', async ({ page, request }) => {
  await open(page, request, 'overview', SIZES.phone);
  const select = page.getByTestId('security-section-select');
  expect((await select.boundingBox()).height).toBeGreaterThanOrEqual(44);
  const findings = page.locator('[data-testid^="security-finding-"]');
  expect(await findings.count()).toBeGreaterThan(0);
  await expect(findings.first()).toHaveAttribute('data-testid', 'security-finding-drill-failed');
  for (const action of await findings.locator('a, button').all()) {
    if (!(await action.isVisible())) continue;
    expect((await action.boundingBox()).height, await action.innerText()).toBeGreaterThanOrEqual(44);
  }
  // The Action required list is above the status by area.
  const order = await page.evaluate(() => ['security-action-required', 'security-areas']
    .map((id) => document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect().top ?? Infinity));
  expect(order[0]).toBeLessThan(order[1]);
  await select.selectOption('access');
  await expect(page).toHaveURL(/tab=access/);
});

test('the revoke sheet on a phone (SE11c): focus moves in, Tab stays in, Esc gives focus back', async ({ page, request }) => {
  await open(page, request, 'access', SIZES.phone);
  const opener = page.getByRole('button', { name: /^Revoke this session…/ }).first();
  await opener.scrollIntoViewIfNeeded();
  await opener.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  expect(await blocking(page)).toEqual([]);
  expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((d) => d.contains(document.activeElement)), `Tab ${i + 1} left the sheet`).toBe(true);
  }
  for (const b of await dialog.getByRole('button').all()) {
    if (!(await b.isVisible())) continue;
    expect((await b.boundingBox()).height, await b.innerText()).toBeGreaterThanOrEqual(44);
  }
  // The sheet stays inside the phone's width.
  const box = await dialog.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(SIZES.phone.width);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('Eadwyn on Security (SE12): the security prompts first, and models, usage and top-up one link away', async ({ page, request }) => {
  await open(page, request, 'overview');
  const rail = page.getByTestId('hq-security-rail');
  await expect(rail.getByTestId('link-worker-rail-usage-elsewhere')).toHaveAttribute('href', '/account/ai-tokens');
  await expect(rail.getByTestId('worker-rail-usage')).not.toContainText(/top up|Add tokens/i);
  await page.getByTestId('header-ask').first().click();
  const chips = page.getByTestId('ask-panel-chips').getByRole('button');
  await expect(chips.first()).toBeVisible();
  const labels = (await chips.allInnerTexts()).map((t) => t.trim());
  expect(labels.slice(0, PROMPTS.length)).toEqual(PROMPTS);
  expect(await blocking(page)).toEqual([]);
});
