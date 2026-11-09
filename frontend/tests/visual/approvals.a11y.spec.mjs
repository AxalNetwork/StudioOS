/**
 * D4814 (#4814, part 7) — Approvals in a real browser, at a desk and on a
 * phone: the Inbox, an item, Lanes, Decided and the three Approvals boards.
 * The bar is the editor's (editor.a11y.spec.mjs): ZERO serious or critical axe
 * violations (WCAG 2.0, 2.1 and 2.2 A and AA rules) in Approvals' own frame
 * and every dialog it opens; the app shell around it is not scanned here.
 *
 * Each check below is a defect this pass found and fixed, held so it stays
 * fixed:
 *   · Decided scrolled the whole page sideways on a phone (an "Open" header's
 *     sr-only text escaped the table's scroller);
 *   · the collapsed rail's "Not recorded" was 3.6:1;
 *   · Esc from Assign… (opened from ⋯) dropped focus on the page body;
 *   · "Open in Wellbeing experts ↗" was announced as "Wellbeing experts", and a
 *     flex control drew "Continue review inKYC & KYB→";
 *   · the phone Inbox had targets under 44px (AP-14);
 *   · "Waiting by lane" cut its labels and totals off on a phone.
 *
 * The reads are answered from `_approvals.mjs`; the page is the built SPA
 * that `server.ts` serves, signed in as a Super Admin.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { prepare } from './_editor.mjs';
import { install } from './_approvals.mjs';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const PAGES = ['/admin/approvals', '/admin/approvals/items/kyc-41', '/admin/approvals/lanes', '/admin/approvals/decided',
  '/admin/approvals/product-testers', '/admin/approvals/co-marketing', '/admin/approvals/wellbeing-experts'];
const DESK = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

async function open(page, request, path, viewport = DESK) {
  await page.setViewportSize(viewport);
  await prepare(page, request);
  await install(page);
  await page.goto(path);
  await expect(page.locator('[data-testid^="admin-board-approvals"]')).toBeVisible();
  await page.waitForLoadState('networkidle');
}

/** Serious and critical violations in Approvals' frame and any open dialog, one line each. */
async function blocking(page) {
  const builder = new AxeBuilder({ page }).withTags(TAGS).include('[data-testid^="admin-board-approvals"]');
  if (await page.locator('[role="dialog"]').count()) builder.include('[role="dialog"]');
  const r = await builder.analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

/** The id of what has focus, or BODY. */
const focused = (page) => page.evaluate(() => (document.activeElement && document.activeElement !== document.body ? document.activeElement.dataset.testid || document.activeElement.textContent.trim() : 'BODY'));

test.describe('axe: zero serious or critical violations, and no page wider than a phone', () => {
  for (const path of PAGES) {
    test(`${path} at a desk and on a phone`, async ({ page, request }) => {
      await open(page, request, path);
      expect(await blocking(page)).toEqual([]);
      await page.setViewportSize(PHONE);
      await page.waitForTimeout(200);
      expect(await blocking(page)).toEqual([]);
      // A table may scroll inside its own card; the page itself never scrolls sideways.
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE.width);
    });
  }

  test('with ⋯ open, with Assign open, and with a board\'s decision dialog open', async ({ page, request }) => {
    await open(page, request, '/admin/approvals');
    await page.getByRole('button', { name: 'More actions for Eva Expert' }).click();
    expect(await blocking(page)).toEqual([]);
    await page.getByRole('button', { name: 'Assign…' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await blocking(page)).toEqual([]);
    await page.goto('/admin/approvals/product-testers/1');
    await page.getByTestId('tester-action-approve').click();
    await expect(page.getByRole('dialog', { name: /Approve Gus Demo/ })).toBeVisible();
    expect(await blocking(page)).toEqual([]);
  });
});

test.describe('the keyboard path', () => {
  test('⋯ (AP-17): Tab walks its actions, Esc gives focus back; Assign… returns focus to ⋯', async ({ page, request }) => {
    await open(page, request, '/admin/approvals');
    const more = page.getByRole('button', { name: 'More actions for Eva Expert' });
    await more.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    expect(await focused(page)).toBe('approvals-menu-wellbeing_experts:51-assign');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    // The door is named for the whole control, not the lane alone.
    await expect(page.locator(':focus')).toHaveAccessibleName('Open in Wellbeing experts');
    await page.keyboard.press('Escape');
    expect(await focused(page)).toBe('approvals-menu-wellbeing_experts:51');
    await expect(more).toHaveAttribute('aria-expanded', 'false');

    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: /Assign Eva Expert/ })).toBeVisible();
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]'))), 'Tab stays in the dialog').toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await focused(page), 'focus goes back to ⋯, not the page').toBe('approvals-menu-wellbeing_experts:51');
  });

  test('on a phone: ⋯ → Assign… → Esc, and the filters sheet, give focus back', async ({ page, request }) => {
    await open(page, request, '/admin/approvals', PHONE);
    const more = page.getByTestId('approvals-card-more-wellbeing_experts:51');
    await more.focus();
    await page.keyboard.press('Enter');
    await page.getByTestId('approvals-row-sheet-assign').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: /Assign Eva Expert/ })).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await focused(page)).toBe('approvals-card-more-wellbeing_experts:51');
    await page.getByTestId('approvals-filters-open').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await focused(page)).toBe('approvals-filters-open');
  });
});

test.describe('the phone Inbox and item (AP-14, AP-15)', () => {
  test('every control in the queue is 44px or more, counting a link\'s widened hit area', async ({ page, request }) => {
    await open(page, request, '/admin/approvals', PHONE);
    const small = await page.evaluate(() => {
      const root = document.querySelector('[data-testid^="admin-board-approvals"] .fwr-frame-main');
      return [...root.querySelectorAll('a, button, select, input')].map((n) => {
        let r = n.getBoundingClientRect();
        if (!r.width) return null;
        const b = getComputedStyle(n, '::before');
        if (b.content !== 'none' && b.position === 'absolute') r = { width: r.width - parseFloat(b.left) - parseFloat(b.right), height: r.height - parseFloat(b.top) - parseFloat(b.bottom) };
        return r.width >= 44 && r.height >= 44 ? null : `${Math.round(r.width)}×${Math.round(r.height)} ${n.dataset.testid || n.textContent.trim()}`;
      }).filter(Boolean);
    });
    expect(small).toEqual([]);
  });

  test('the item sheet reads "Continue review in KYC & KYB →", spaces and all, and its arrows are 44px', async ({ page, request }) => {
    await open(page, request, '/admin/approvals/items/kyc-41', PHONE);
    // innerText, not textContent: a flex control drops the spaces from what it draws, not from its text.
    expect(await page.getByTestId('approvals-item-continue-link').innerText()).toBe('Continue review in KYC & KYB →');
    await expect(page.getByRole('link', { name: 'Continue review in KYC & KYB' })).toBeVisible();
    for (const id of ['approvals-item-next']) {
      const box = await page.getByTestId(id).boundingBox();
      if (box) expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
    }
  });

  test('"Waiting by lane" keeps every label and total inside the chart', async ({ page, request }) => {
    await open(page, request, '/admin/approvals', PHONE);
    const chart = page.getByTestId('approvals-chart-lanes').locator('svg').first();
    await chart.scrollIntoViewIfNeeded();
    const out = await chart.evaluate((svg) => {
      const box = svg.getBoundingClientRect();
      return [...svg.querySelectorAll('text')].map((t) => { const r = t.getBoundingClientRect(); return r.left < box.left - 1 || r.right > box.right + 1 ? t.textContent : null; }).filter(Boolean);
    });
    expect(out).toEqual([]);
  });
});

test.describe('the rail', () => {
  test('the collapsed rail\'s "Not recorded" passes contrast', async ({ page, request }) => {
    await open(page, request, '/admin/approvals');
    const r = await new AxeBuilder({ page }).withRules(['color-contrast']).include('[data-testid="worker-rail-spine-spend"]').analyze();
    expect(r.violations).toEqual([]);
  });
});

test.describe('the boards\' queue grammar (D4814 part 8: AP-08, AP-10, AP-12)', () => {
  const BOARDS = [
    ['/admin/approvals/product-testers', 'testers', 'tester-pick-1', 'tester-more-3'],
    ['/admin/approvals/co-marketing', 'pitches', 'pitch-pick-p1', 'pitch-more-p1'],
    ['/admin/approvals/wellbeing-experts', 'experts', 'expert-pick-e1', 'expert-more-e1'],
  ];
  for (const [path, prefix, box, more] of BOARDS) {
    test(`${path}: a pick shows the bar; axe passes with the bar and with ⋯ open`, async ({ page, request }) => {
      await open(page, request, path);
      await page.getByTestId(box).check();
      await expect(page.getByTestId(`${prefix}-bulk-count`)).toHaveText('1 selected');
      expect(await blocking(page)).toEqual([]);
      await page.getByTestId(`${more}-button`).click();
      expect(await blocking(page)).toEqual([]);
    });
  }

  test('⋯ on a board: Tab walks it, Esc gives focus back; Assign… returns focus to ⋯; the bar\'s Assign… gets focus back too', async ({ page, request }) => {
    await open(page, request, '/admin/approvals/product-testers');
    const more = page.getByTestId('tester-more-3-button');
    await more.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    expect(await focused(page)).toBe('tester-more-3-assign');
    await page.keyboard.press('Escape');
    expect(await focused(page)).toBe('tester-more-3-button');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: /Assign Ben Sample/ })).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await focused(page)).toBe('tester-more-3-button');
    await page.getByTestId('tester-pick-1').check();
    await page.getByTestId('tester-pick-3').check();
    await page.getByTestId('testers-bulk-assign').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: /Assign 2 items/ })).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await focused(page)).toBe('testers-bulk-assign');
  });

  test('a last row\'s ⋯ opens where its actions can be clicked, on a board and on the Inbox', async ({ page, request }) => {
    const onTop = (id) => page.evaluate((id) => {
      const b = document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect();
      return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest(`[data-testid="${id}"]`) != null;
    }, id);
    await open(page, request, '/admin/approvals/product-testers');
    await page.getByTestId('tester-more-3-button').click();
    expect(await onTop('tester-more-3-copy'), 'not clipped by the queue\'s scroller').toBe(true);
    await page.goto('/admin/approvals');
    const last = page.getByRole('button', { name: 'More actions for Person E' });
    await last.scrollIntoViewIfNeeded();
    await last.click();
    expect(await onTop('approvals-menu-exploring:77-copy')).toBe(true);
  });
});

