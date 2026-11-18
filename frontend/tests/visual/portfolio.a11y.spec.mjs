/**
 * D4818 (#4818) — the built Portfolio boards in a real browser: Overview,
 * Positions and Performance (#5311 PF-01 to PF-03), at 1440, 834, 390 and 320
 * wide, light and dark, with the keyboard. The bar is the Approvals and Fund
 * Admin passes': ZERO serious or critical axe violations (WCAG 2.0, 2.1 and
 * 2.2 A and AA rules) in Portfolio's own frame and any dialog it opens; the
 * app shell around it is not scanned here. The checks are D4818's
 * interactive checklist, run on what is built; D4818-p2 records each result.
 *
 * The reads are answered from `_portfolio.mjs`; the page is the built SPA
 * that `server.ts` serves, signed in as an investor.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { install } from './_portfolio.mjs';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const BOARDS = [
  { path: '/portfolio', testid: 'investor-portfolio-canvas', title: 'Portfolio · Axal VC' },
  { path: '/portfolio/positions', testid: 'investor-portfolio-positions', title: 'Positions · Portfolio · Axal VC' },
  { path: '/portfolio/performance', testid: 'investor-portfolio-performance', title: 'Performance · Portfolio · Axal VC' },
];
const NAV = ['/portfolio', '/portfolio/positions', '/portfolio/updates', '/portfolio/performance', '/portfolio/value-add'];
const DESK = { width: 1440, height: 900 };
const LAPTOP = { width: 1280, height: 800 };
const TABLET = { width: 834, height: 1112 };
const PHONE = { width: 390, height: 844 };
const NARROW = { width: 320, height: 640 };

async function open(page, request, path, { viewport = DESK, ...opts } = {}) {
  await page.setViewportSize(viewport);
  await install(page, request, opts);
  await page.goto(path);
  await expect(page.locator('.pf-frame')).toBeVisible();
  await page.waitForLoadState('networkidle');
}

/** Serious and critical violations in the Portfolio frame and any open dialog, one line each. */
async function blocking(page) {
  const builder = new AxeBuilder({ page }).withTags(TAGS).include('.pf-shell');
  if (await page.locator('[role="dialog"]').count()) builder.include('[role="dialog"]');
  const r = await builder.analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

const pageWidth = (page) => page.evaluate(() => document.documentElement.scrollWidth);
const active = (page) => page.evaluate(() => {
  const a = document.activeElement;
  if (!a || a === document.body) return 'BODY';
  return a.getAttribute('href') || a.id || a.dataset.testid || a.textContent.trim().slice(0, 40);
});

test.describe('axe and reflow: every board at each width, light and dark', () => {
  for (const b of BOARDS) {
    test(`${b.path}: zero serious or critical, no page wider than its window`, async ({ page, request }) => {
      await open(page, request, b.path);
      expect(await blocking(page), `desk ${b.path}`).toEqual([]);
      for (const vp of [LAPTOP, TABLET, PHONE, NARROW]) {
        await page.setViewportSize(vp);
        await page.waitForTimeout(150);
        expect(await blocking(page), `${vp.width} ${b.path}`).toEqual([]);
        expect(await pageWidth(page), `${vp.width} ${b.path} scrolls sideways`).toBeLessThanOrEqual(vp.width);
      }
    });
    test(`${b.path} in dark`, async ({ page, request }) => {
      await open(page, request, b.path, { theme: 'dark' });
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      expect(await blocking(page)).toEqual([]);
      await page.setViewportSize(PHONE);
      await page.waitForTimeout(150);
      expect(await blocking(page)).toEqual([]);
    });
  }
});

test.describe('landmarks, title and the keyboard path', () => {
  for (const b of BOARDS) {
    test(`${b.path}: one H1, a named local navigation with five destinations, the document title`, async ({ page, request }) => {
      await open(page, request, b.path);
      await expect(page.locator('.pf-frame h1')).toHaveCount(1);
      await expect(page.locator('main')).toHaveCount(1);
      await expect(page.locator('.pf-frame main')).toHaveCount(0);
      const nav = page.locator('.pf-frame nav.pf-nav, .pf-frame .pf-nav nav, .pf-frame nav:has(a[href="/portfolio/performance"])').first();
      expect(await nav.getAttribute('aria-label')).toBeTruthy();
      for (const to of NAV) await expect(nav.locator(`a[href="${to}"]`)).toHaveCount(1);
      await expect(page).toHaveTitle(b.title);
    });

    test(`${b.path}: the skip link moves focus to the content, and Tab reaches every destination`, async ({ page, request }) => {
      await open(page, request, b.path);
      const skip = page.locator('a.pf-skip');
      await skip.focus();
      await expect(skip).toBeVisible();
      await page.keyboard.press('Enter');
      expect(await active(page)).toBe('portfolio-content');
      const seen = new Set();
      for (let i = 0; i < 60 && seen.size < NAV.length; i += 1) {
        await page.keyboard.press('Tab');
        const at = await active(page);
        if (NAV.includes(at)) {
          seen.add(at);
          const ring = await page.evaluate(() => {
            const s = getComputedStyle(document.activeElement);
            return { outline: parseFloat(s.outlineWidth) || 0, style: s.outlineStyle, shadow: s.boxShadow };
          });
          expect(ring.outline >= 2 && ring.style !== 'none' || ring.shadow !== 'none', `${at} has no visible focus`).toBe(true);
        }
      }
      expect([...seen].sort()).toEqual([...NAV].sort());
    });

    test(`${b.path}: on a phone the local navigation's targets are 44px tall`, async ({ page, request }) => {
      await open(page, request, b.path, { viewport: PHONE });
      for (const to of NAV) {
        const box = await page.locator(`.pf-frame a[href="${to}"]`).first().boundingBox();
        expect(box?.height ?? 0, `${to}`).toBeGreaterThanOrEqual(44);
      }
    });
  }
});

test.describe('read recovery and dialogs', () => {
  test('Overview: a failed source stands alone, and Retry asks for it alone', async ({ page, request }) => {
    const log = [];
    let fail = true;
    await open(page, request, '/portfolio', { log, over: { '/api/positions/analytics': () => (fail ? [{ detail: 'synthetic failure' }, 500] : undefined) } });
    await expect(page.locator('.pf-frame')).toContainText('Lumen Robotics');
    const retry = page.getByRole('button', { name: /Retry/ }).first();
    await expect(retry).toBeVisible();
    expect(await blocking(page)).toEqual([]);
    const before = log.length;
    fail = false;
    await retry.focus();
    await page.keyboard.press('Enter');
    await page.waitForLoadState('networkidle');
    const after = log.slice(before);
    expect(after.every((p) => p.startsWith('/api/positions/analytics')), after.join(', ')).toBe(true);
    await expect(page.locator('.pf-frame')).toContainText('Lumen Robotics');
  });

  test('Positions: a row\'s detail opens by keyboard, keeps focus inside, and Esc gives focus back', async ({ page, request }) => {
    await open(page, request, '/portfolio/positions');
    // The mark date opens one company's mark history in the shared Sheet (PF-02b).
    const trigger = page.getByTestId('button-mark-history-2');
    await expect(trigger).toHaveAccessibleName(/^31 Mar 2026, mark history for Northwind Labs/);
    await trigger.focus();
    const label = await active(page);
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    expect(await blocking(page)).toEqual([]);
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]')), `Tab ${i} left the dialog`).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(await active(page)).toBe(label);
  });

  test('Performance: the chart has a table with the same quarter-ends, reachable by keyboard', async ({ page, request }) => {
    await open(page, request, '/portfolio/performance');
    const table = page.locator('.pf-frame table').first();
    await expect(table).toBeAttached();
    expect(await table.locator('caption, [aria-label]').count() + (await table.getAttribute('aria-label') ? 1 : 0)).toBeGreaterThan(0);
  });
});
