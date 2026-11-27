/**
 * D4812 (#4812, part 8) — the accessibility pass for Fund Admin, in a real
 * browser at a desk (1440), on a phone (390) and at 320 CSS px (WCAG 1.4.10
 * reflow, i.e. a 1280px window at 400% zoom), in light and in dark. The bar is
 * the editor's and Approvals': ZERO serious or critical axe violations (WCAG
 * 2.0, 2.1 and 2.2, A and AA) in the console's frame and in every dialog it
 * opens; the app shell around it is not scanned here.
 *
 * The reads are the real Worker's, on the fund `_fund_admin_seed.ts` seeds
 * (three LPs, an overdue call line, fee periods, a prepared pack, two bank
 * matches), signed in as HQ Security's Super Admin.
 *
 * Each check below holds a defect this pass found and fixed:
 *   · with anything waiting, every page scrolled sideways on a phone (589px
 *     in 390): each tab's sr-only "waiting" sat outside the tab strip's
 *     scroller, because the strip was not a positioning context;
 *   · the header's primary action was 4.4:1 in dark (white on violet-500);
 *   · Escape did not close the open Fund scope list;
 *   · on a phone, the primary action, fund and LP names, "View as table",
 *     "Show proofs of funds", "← Funds", the Funds table's Open and the Books
 *     view chips were under 44px; those chips showed which one is on by
 *     colour alone (no aria-pressed).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { manifest, prepare } from './_editor.mjs';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const BASE = '/admin/fund-admin';
const FUND = 4812;
/** Every workspace and part, the Funds list and the seeded fund's page. */
const PAGES = ['', '/lps', '/calls', '/distributions', '/performance', '/reports', '/fees', '/banking', '/banking/reconciliation', '/banking/books', '/funds', `/funds/${FUND}`];
const DESK = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const REFLOW = { width: 320, height: 700 };

const setTheme = async (request, theme) => {
  const m = await manifest(request);
  const res = await request.put('/api/settings/appearance', { headers: { Authorization: `Bearer ${m.security.token}` }, data: { theme } });
  expect(res.ok()).toBe(true);
};

async function open(page, request, path, viewport = DESK) {
  await page.setViewportSize(viewport);
  await prepare(page, request, { as: 'security' });
  await page.goto(`${BASE}${path}`);
  await expect(page.getByTestId('fund-admin-console')).toBeVisible();
  await page.waitForLoadState('networkidle');
}

/** Serious and critical violations in the console and any open dialog, one line each. */
async function blocking(page) {
  const builder = new AxeBuilder({ page }).withTags(TAGS).include('[data-testid="fund-admin-console"]');
  if (await page.locator('[role="dialog"]').count()) builder.include('[role="dialog"]');
  const r = await builder.analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

const pageWidth = (page) => page.evaluate(() => document.documentElement.scrollWidth);

test.describe('axe: zero serious or critical violations; no page wider than its window', () => {
  for (const path of PAGES) {
    test(`${path || '/'} at a desk, on a phone and at 320px`, async ({ page, request }) => {
      await open(page, request, path);
      expect(await blocking(page)).toEqual([]);
      await page.setViewportSize(PHONE);
      await page.waitForTimeout(200);
      expect(await blocking(page)).toEqual([]);
      // A table may scroll inside its own card; the page itself never scrolls sideways.
      expect(await pageWidth(page)).toBeLessThanOrEqual(PHONE.width);
      await page.setViewportSize(REFLOW);
      await page.waitForTimeout(200);
      expect(await pageWidth(page)).toBeLessThanOrEqual(REFLOW.width);
    });
  }

  test.describe('in dark', () => {
    test.beforeEach(async ({ request }) => setTheme(request, 'dark'));
    test.afterEach(async ({ request }) => setTheme(request, 'light'));
    for (const path of PAGES) {
      test(`${path || '/'} in dark`, async ({ page, request }) => {
        await open(page, request, path);
        await expect(page.locator('html')).toHaveClass(/dark/);
        expect(await blocking(page)).toEqual([]);
      });
    }
  });

  test('with each dialog open: the LP drawer, Add LP, New capital call, Change economics, Fund scope and ⋯', async ({ page, request }) => {
    await open(page, request, `/lps?fund=${FUND}`);
    await page.getByTestId('lps-open-48120').click();
    await expect(page.getByTestId('lp-drawer-48120')).toBeVisible();
    expect(await blocking(page)).toEqual([]);

    await open(page, request, `/lps?fund=${FUND}`);
    await page.getByTestId('lps-add').click();
    await expect(page.getByRole('dialog', { name: 'Add LP' })).toBeVisible();
    expect(await blocking(page)).toEqual([]);

    await open(page, request, `/calls?fund=${FUND}`);
    await page.getByTestId('calls-new').click();
    await expect(page.getByTestId('calls-new-dialog')).toBeVisible();
    expect(await blocking(page)).toEqual([]);

    await open(page, request, `/funds/${FUND}`);
    await page.getByTestId('fund-economics-change').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await blocking(page)).toEqual([]);

    await open(page, request, '');
    await page.getByTestId('fund-admin-scope').click();
    await expect(page.getByTestId('fund-admin-filter')).toHaveAttribute('open', '');
    expect(await blocking(page)).toEqual([]);
    await page.getByRole('button', { name: 'More' }).click();
    expect(await blocking(page)).toEqual([]);
  });
});

test.describe('the keyboard path', () => {
  test('Fund scope opens from the keyboard, and Escape closes it with focus back on the control', async ({ page, request }) => {
    await open(page, request, '');
    const scope = page.getByTestId('fund-admin-scope');
    await scope.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('fund-admin-filter')).toHaveAttribute('open', '');
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toHaveAttribute('data-testid', /^fund-admin-filter-/);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('fund-admin-filter')).not.toHaveAttribute('open', '');
    await expect(scope).toBeFocused();
  });

  test('⋯ opens from the keyboard and Escape gives focus back to it', async ({ page, request }) => {
    await open(page, request, '');
    const more = page.getByRole('button', { name: 'More' });
    await more.focus();
    await page.keyboard.press('Enter');
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(more).toBeFocused();
  });

  test('a dialog keeps Tab inside it, and Escape returns focus to what opened it', async ({ page, request }) => {
    await open(page, request, `/funds/${FUND}`);
    const change = page.getByTestId('fund-economics-change');
    await change.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]'))), 'Tab stays in the dialog').toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(change).toBeFocused();
  });

  test('an LP name is the way in: Enter on it opens that LP', async ({ page, request }) => {
    await open(page, request, `/lps?fund=${FUND}`);
    await page.getByTestId('lps-open-48120').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('lp-drawer-48120')).toBeVisible();
    await expect(page.getByRole('dialog', { name: /LP Alpha Partners/ })).toBeVisible();
  });
});

test.describe('on a phone, every control is a 44px target', () => {
  for (const path of PAGES) {
    test(`${path || '/'}`, async ({ page, request }) => {
      await open(page, request, path, PHONE);
      const small = await page.evaluate(() => [...document.querySelectorAll('[data-testid="fund-admin-console"] :is(a, button, select, input, textarea, summary)')].map((n) => {
        const r = n.getBoundingClientRect();
        if (!r.width || !r.height) return null;
        // A link inside a sentence is exempt (WCAG 2.5.8, inline).
        if (n.tagName === 'A' && n.closest('p')) return null;
        return r.width >= 44 && r.height >= 44 ? null : `${Math.round(r.width)}×${Math.round(r.height)} ${n.dataset.testid || (n.getAttribute('aria-label') || n.textContent || '').trim().slice(0, 40)}`;
      }).filter(Boolean));
      expect(small).toEqual([]);
    });
  }
});
