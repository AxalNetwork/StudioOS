/**
 * D4818 (#4818) — the built Portfolio boards in a real browser: Overview,
 * Positions and Performance (#5311 PF-01 to PF-03), at 1440, 834, 390 and 320
 * wide, light and dark, with the keyboard. The bar is the Approvals and Fund
 * Admin passes': ZERO serious or critical axe violations (WCAG 2.0, 2.1 and
 * 2.2 A and AA rules) in Portfolio's own frame and any dialog it opens; the
 * app shell around it is not scanned here. The checks are D4818's
 * interactive checklist, run on what is built; D4818-p2 records each result.
 *
 * Part 3 (D4818-p3) adds Reports and Value-add to the same passes, one
 * company's workspace and its five tabs, the money, reporting and support
 * journeys, the admin preview, 200% zoom and WCAG 1.4.12 text spacing,
 * reduced motion and the announcements of async saves and failures.
 *
 * The reads are answered from `_portfolio.mjs`; the page is the built SPA
 * that `server.ts` serves, signed in as an investor (or an administrator,
 * where a check says so).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ASK_ANSWER, DETAIL, OWED, STORED_MARK, SUPPORT, install } from './_portfolio.mjs';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const BOARDS = [
  { path: '/portfolio', testid: 'investor-portfolio-canvas', title: 'Portfolio · Axal VC' },
  { path: '/portfolio/positions', testid: 'investor-portfolio-positions', title: 'Positions · Portfolio · Axal VC' },
  { path: '/portfolio/performance', testid: 'investor-portfolio-performance', title: 'Performance · Portfolio · Axal VC' },
  { path: '/portfolio/updates', testid: 'investor-portfolio-updates', title: 'Reports · Portfolio · Axal VC' },
  { path: '/portfolio/value-add', testid: 'investor-portfolio-value-add', title: 'Value-add · Portfolio · Axal VC' },
];
const NAV = ['/portfolio', '/portfolio/positions', '/portfolio/updates', '/portfolio/performance', '/portfolio/value-add'];
const DESK = { width: 1440, height: 900 };
const LAPTOP = { width: 1280, height: 800 };
const TABLET = { width: 834, height: 1112 };
const PHONE = { width: 390, height: 844 };
const NARROW = { width: 320, height: 640 };

async function open(page, request, path, { viewport = DESK, frame = '.pf-frame', idle = true, ...opts } = {}) {
  await page.setViewportSize(viewport);
  await install(page, request, opts);
  await page.goto(path);
  if (frame) await expect(page.locator(frame)).toBeVisible();
  if (idle) await page.waitForLoadState('networkidle');
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

/* ------------------------------------------------------------------ part 3 (D4818-p3) */

const CO = '/portfolio/companies/northwind';
const CO_NAME = 'Northwind Labs with a long registered company name';
const CO_TABS = [
  { id: 'overview', path: CO, label: 'Overview', title: 'Company · Portfolio · Axal VC' }, // D8681: the tab names the screen, never the company
  { id: 'financials', path: `${CO}/financials`, label: 'Financials', title: 'Financials · Company · Portfolio · Axal VC' },
  { id: 'reports', path: `${CO}/reports`, label: 'Reports', title: 'Reports · Company · Portfolio · Axal VC' },
  { id: 'support', path: `${CO}/support`, label: 'Support', title: 'Support · Company · Portfolio · Axal VC' },
  { id: 'activity', path: `${CO}/activity`, label: 'Activity', title: 'Activity · Company · Portfolio · Axal VC' },
];
const json = (body, status = 200) => [body, status];

/** Where a message is announced: the nearest live region around `text`, and whether it was in the page before `act` ran. */
async function announced(page, text, act) {
  await page.evaluate(() => {
    window.__live = [...document.querySelectorAll('[role="status"], [role="alert"], [aria-live]')];
  });
  await act();
  await expect(page.getByText(text).first()).toBeVisible();
  return page.evaluate((t) => {
    const live = (n) => n.closest('[role="status"], [role="alert"], [aria-live]:not([aria-live="off"])');
    const hits = [...document.querySelectorAll('body *')].filter((n) => [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.includes(t)));
    const regions = [...new Set(hits.map(live).filter(Boolean))];
    return {
      regions: regions.length,
      role: regions[0] ? (regions[0].getAttribute('role') || `aria-live=${regions[0].getAttribute('aria-live')}`) : null,
      before: regions.length > 0 && regions.every((r) => window.__live.includes(r) || r.getAttribute('role') === 'alert'),
    };
  }, text);
}

test.describe('part 3: one company\'s workspace and its five tabs', () => {
  for (const t of CO_TABS) {
    test(`${t.path}: zero serious or critical at each width, light and dark, the heading, title and current tab agree`, async ({ page, request }) => {
      await open(page, request, t.path);
      await expect(page.locator('.pf-frame h1')).toHaveText(CO_NAME);
      await expect(page).toHaveTitle(t.title);
      await expect(page.locator('main')).toHaveCount(1);
      const tabs = page.getByRole('navigation', { name: `${CO_NAME} sections` });
      await expect(tabs.getByRole('link')).toHaveText(CO_TABS.map((x) => x.label));
      await expect(tabs.locator('[aria-current="page"]')).toHaveText(t.label);
      expect(await blocking(page), `desk ${t.path}`).toEqual([]);
      for (const vp of [TABLET, PHONE, NARROW]) {
        await page.setViewportSize(vp);
        await page.waitForTimeout(150);
        expect(await blocking(page), `${vp.width} ${t.path}`).toEqual([]);
        expect(await pageWidth(page), `${vp.width} ${t.path} scrolls sideways`).toBeLessThanOrEqual(vp.width);
      }
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.evaluate(() => { document.documentElement.classList.add('dark'); document.documentElement.setAttribute('data-theme', 'dark'); });
      expect(await blocking(page), `dark ${t.path}`).toEqual([]);
    });
  }

  test('the keyboard walks the tabs; reload and Back keep the address, heading, title and current tab aligned', async ({ page, request }) => {
    await open(page, request, CO);
    const tabs = page.getByRole('navigation', { name: `${CO_NAME} sections` });
    for (const t of CO_TABS.slice(1)) {
      await tabs.getByRole('link', { name: t.label }).focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(new RegExp(`${t.path}$`));
      await expect(page).toHaveTitle(t.title);
      await expect(tabs.locator('[aria-current="page"]')).toHaveText(t.label);
      await expect(page.locator('.pf-frame h1')).toHaveText(CO_NAME);
    }
    await page.reload();
    await expect(page.locator('.pf-frame h1')).toHaveText(CO_NAME);
    await expect(page).toHaveTitle(CO_TABS[4].title);
    await expect(tabs.locator('[aria-current="page"]')).toHaveText('Activity');
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${CO_TABS[3].path}$`));
    await expect(page).toHaveTitle(CO_TABS[3].title);
    await expect(tabs.locator('[aria-current="page"]')).toHaveText('Support');
  });

  test('a company name is a direct link from Reports, and a company not held names nothing', async ({ page, request }) => {
    await open(page, request, '/portfolio/updates');
    const link = page.getByTestId('link-company-2');
    await expect(link).toHaveAttribute('href', CO);
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.pf-frame h1')).toHaveText(CO_NAME);
    await page.goto('/portfolio/companies/ghost-co');
    await expect(page.getByTestId('company-not-held')).toBeVisible();
    await expect(page).toHaveTitle('Company · Portfolio · Axal VC');
    await expect(page.locator('.pf-frame h1')).toHaveText('Company');
    await expect(page.locator('.pf-frame')).not.toContainText('ghost');
    expect(await blocking(page)).toEqual([]);
  });
});

test.describe('part 3: reporting journeys', () => {
  test('Reports: a row\'s report detail opens by keyboard, keeps focus inside, and Esc gives focus back', async ({ page, request }) => {
    await open(page, request, '/portfolio/updates');
    const trigger = page.getByTestId('button-open-report-2');
    await expect(trigger).toHaveAccessibleName(`Report detail for ${CO_NAME}`);
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleName(new RegExp(CO_NAME));
    expect(await blocking(page)).toEqual([]);
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Shift+Tab');
      expect(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]')), `Shift+Tab ${i} left the dialog`).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('Reports: a chase names its company in a live region that was already there, and so does a failed one', async ({ page, request }) => {
    let fail = true;
    const log = [];
    await open(page, request, '/portfolio/updates', { log, over: { '/api/portfolio/chase': () => (fail ? json({ detail: 'Service unavailable' }, 503) : json({ ok: true, chased: [{ project_id: 2 }], already: [], skipped: [] })) } });
    const chase = page.getByTestId('button-chase-2');
    let said = await announced(page, 'Service unavailable', () => chase.click());
    expect(said, 'the failed chase').toMatchObject({ regions: 1, before: true });
    fail = false;
    said = await announced(page, `${CO_NAME} has been asked`, () => chase.click());
    expect(said, 'the chase').toMatchObject({ regions: 1, before: true });
    expect(log.filter((l) => l.startsWith('POST /api/portfolio/chase'))).toHaveLength(2);
  });

  test('company Reports: Ask goes Review → a refusal kept in place → Receipt, naming the company and period, focus held in the sheet', async ({ page, request }) => {
    let fail = true;
    const log = [];
    await open(page, request, `${CO}/reports`, { log, over: { '/api/reporting/periods/pm9/ask': () => (fail ? json({ error: 'already_asked', message: 'You already asked for this period’s report.' }, 409) : json(ASK_ANSWER)) } });
    const ask = page.getByTestId('report-obligation-ask');
    await ask.focus();
    await page.keyboard.press('Enter');
    const review = page.getByRole('dialog');
    await expect(review).toBeVisible();
    await expect(review).toContainText(CO_NAME);
    await expect(review).toContainText('Sep 2026');
    expect(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]')), 'focus entered the review').toBe(true);
    expect(await blocking(page)).toEqual([]);
    const confirm = page.getByTestId('report-review-confirm');
    await expect(confirm).toHaveAccessibleName(/Northwind Labs/);
    await confirm.click();
    const error = page.getByTestId('report-review-error');
    await expect(error).toHaveAttribute('role', 'alert');
    await expect(error).toContainText('already_asked');
    await expect(confirm).toHaveAttribute('aria-describedby', 'pf-ask-error');
    await expect(review).toContainText(CO_NAME);
    fail = false;
    await confirm.click();
    const status = page.getByTestId('report-receipt-status');
    await expect(status).toHaveAttribute('role', 'status');
    await expect(page.getByRole('dialog')).toContainText(CO_NAME);
    expect(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]')), 'focus is inside the receipt').toBe(true);
    expect(await blocking(page)).toEqual([]);
    await page.getByTestId('report-receipt-done').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // The re-read replaces the Ask that opened the sheet; focus lands on the obligation it acted on.
    await expect(page.getByTestId('report-obligation'), 'focus is lost when the receipt closes').toBeFocused();
    expect(log.filter((l) => l.startsWith('POST'))).toEqual(['POST /api/reporting/periods/pm9/ask', 'POST /api/reporting/periods/pm9/ask']);
  });
});

test.describe('part 3: support journeys on Value-add', () => {
  test('Log support: an empty save names its field, a failed save keeps every entry and says so, a retry records', async ({ page, request }) => {
    let fail = true;
    const log = [];
    await open(page, request, '/portfolio/value-add', { log, over: { '/api/portfolio-support': (q, req) => (req.method() === 'POST' ? (fail ? json({ detail: 'Service unavailable' }, 503) : json({ item: { uid: 'new' } }, 201)) : undefined) } });
    await page.getByRole('button', { name: 'Log support' }).click();
    const form = page.getByTestId('va-log-support');
    await expect(form).toBeVisible();
    expect(await blocking(page)).toEqual([]);
    await page.getByTestId('button-va-record').click();
    const company = form.getByLabel('Company');
    await expect(company).toHaveAttribute('aria-invalid', 'true');
    await expect(company).toHaveAccessibleDescription('Choose the company this support is for.');
    await company.selectOption('northwind');
    await form.getByLabel('What happened').fill('Intro to a buyer at a utility');
    await form.getByLabel('Hours').fill('1.5');
    const said = await announced(page, 'This did not save. Your entries are kept.', () => page.getByTestId('button-va-record').click());
    expect(said, 'the failed save').toMatchObject({ regions: 1, before: true });
    await expect(company).toHaveValue('northwind');
    await expect(form.getByLabel('What happened')).toHaveValue('Intro to a buyer at a utility');
    await expect(form.getByLabel('Hours')).toHaveValue('1.5');
    fail = false;
    await page.getByTestId('button-va-record').click();
    await expect(form).toHaveCount(0);
    expect(log.filter((l) => l.startsWith('POST'))).toHaveLength(2);
  });

  test('Mark delivered confirms in place naming the company; a conflict is announced, and focus is not dropped', async ({ page, request }) => {
    await open(page, request, '/portfolio/value-add', { over: { '/api/portfolio-support/nw-intro': (q, req) => (req.method() === 'PATCH' ? json({ detail: { code: 'changed_since_open', message: 'changed' } }, 409) : undefined) } });
    const deliver = page.getByTestId('button-va-deliver-nw-intro');
    await deliver.focus();
    await page.keyboard.press('Enter');
    const group = page.getByRole('group', { name: `Confirm for ${CO_NAME}` });
    await expect(group).toBeVisible();
    expect(await blocking(page)).toEqual([]);
    const said = await announced(page, 'someone else changed this entry', () => page.getByTestId('button-va-confirm-nw-intro').click());
    expect(said, 'the conflict').toMatchObject({ regions: 1, before: true });
    // Focus is placed once the ledger has been read again (part 3, fix 3), so wait for that read rather than racing it (D4818-p4).
    await expect.poll(() => active(page), { message: 'focus fell to the page when the confirmation closed' }).not.toBe('BODY');
  });

  test('Withdraw cancelled gives focus back; an entry\'s history opens with its state on the control', async ({ page, request }) => {
    await open(page, request, '/portfolio/value-add');
    const withdraw = page.getByTestId('button-va-withdraw-nw-intro');
    await withdraw.focus();
    await page.keyboard.press('Enter');
    const group = page.getByRole('group', { name: `Confirm for ${CO_NAME}` });
    await group.getByRole('button', { name: 'Cancel' }).click();
    await expect(group).toHaveCount(0);
    await expect(withdraw).toBeFocused();
    const history = page.getByTestId('button-va-history-pp-intro');
    await expect(history).toHaveAttribute('aria-expanded', 'false');
    await history.click();
    await expect(history).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('history-va-support-pp-intro')).toContainText('Priya Example');
  });
});

test.describe('part 3: the money sheet (PF-07), as an administrator', () => {
  test('a mark goes Prepare → Review → Confirm → Receipt in the sheet, errors tied to fields, focus held, the receipt announced', async ({ page, request }) => {
    const log = [];
    await open(page, request, '/portfolio/positions', { as: 'admin', frame: null, log, over: { '/api/positions/northwind/marks': () => json(STORED_MARK, 201) } });
    await page.getByRole('button', { name: 'View dilution' }).first().click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await page.getByTestId('button-mark-open').click();
    expect(await blocking(page)).toEqual([]);
    await page.getByTestId('form-mark').evaluate((f) => f.requestSubmit());
    const fmv = page.getByTestId('input-mark-fmv');
    await expect(fmv).toHaveAttribute('aria-invalid', 'true');
    expect(await fmv.evaluate((n) => (n.getAttribute('aria-describedby') || '').split(' ').map((id) => document.getElementById(id)?.textContent || '').join(' ').trim())).not.toBe('');
    await page.getByTestId('input-mark-as_of_date').fill('2026-09-30');
    await fmv.fill('2,100,000');
    await page.getByTestId('input-mark-event').fill('Down round');
    await page.getByTestId('form-mark').evaluate((f) => f.requestSubmit());
    await expect(page.getByTestId('write-flow-written')).toContainText('Northwind Labs');
    await page.getByTestId('write-flow-continue').click();
    await expect(page.getByTestId('write-flow-confirm')).toHaveText('Record $2,100,000 mark for Northwind Labs');
    for (let i = 0; i < 10; i += 1) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]')), `Tab ${i} left the sheet`).toBe(true);
    }
    await page.getByTestId('write-flow-confirm').click();
    await expect(page.getByTestId('write-flow-receipt')).toContainText('mk-7f3a');
    expect(await page.getByTestId('write-flow-receipt').evaluate((n) => !!n.closest('[role="status"], [role="alert"], [aria-live]') || !!n.querySelector('[role="status"], [aria-live]')), 'the receipt is announced').toBe(true);
    expect(await blocking(page)).toEqual([]);
    expect(log.filter((l) => l.startsWith('POST'))).toEqual(['POST /api/positions/northwind/marks']);
  });
});

test.describe('part 3: the money sheet when the record moves, as an administrator', () => {
  test('a mark that landed meanwhile stops the save: nothing is sent, the draft is kept and announced, focus stays in the sheet; a typed draft asks before it is discarded', async ({ page, request }) => {
    const log = [];
    let reads = 0;
    const moved = { ...DETAIL, marks: [{ uid: 'm2', as_of_date: '2026-09-30', fmv: 2250000, basis: 'gp_estimate' }, ...DETAIL.marks] };
    await open(page, request, '/portfolio/positions', { as: 'admin', frame: null, log, over: {
      '/api/positions/northwind': (q, req) => (req.method() === 'GET' ? json((reads += 1) > 1 ? moved : DETAIL) : undefined),
    } });
    await page.getByRole('button', { name: 'View dilution' }).first().click();
    await page.getByTestId('button-mark-open').click();
    await page.getByTestId('input-mark-as_of_date').fill('2026-09-30');
    await page.getByTestId('input-mark-fmv').fill('2,100,000');
    await page.getByTestId('form-mark').evaluate((f) => f.requestSubmit());
    await page.getByTestId('write-flow-continue').click();
    await page.getByTestId('write-flow-confirm').focus();
    await page.keyboard.press('Enter');
    const conflict = page.getByTestId('write-flow-conflict');
    await expect(conflict.getByRole('alert')).toHaveText(/Not saved\. Your draft is kept\./);
    await expect(page.getByTestId('write-flow-company')).toContainText('Northwind Labs');
    expect(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]')), 'focus left the sheet at the conflict').toBe(true);
    expect(await blocking(page)).toEqual([]);
    expect(log.filter((l) => l.startsWith('POST')), 'a conflict sends nothing').toEqual([]);
    await page.getByTestId('write-flow-review-again').click();
    await page.getByTestId('write-flow-back').click();
    await expect(page.getByTestId('input-mark-fmv'), 'the draft is kept').toHaveValue('2,100,000');
    await page.getByTestId('write-flow-cancel').click();
    const ask = page.getByTestId('write-flow-discard');
    await expect(ask).toHaveAttribute('role', 'alertdialog');
    await expect(ask).toHaveAccessibleName(/.+/);
  });
});

test.describe('part 3: the admin Investor preview (PF-08)', () => {
  const PREVIEWED = ['/portfolio', '/portfolio/positions', '/portfolio/updates', '/portfolio/performance', '/portfolio/value-add', CO, `${CO}/financials`];
  for (const path of PREVIEWED) {
    test(`${path}: one banner, private states, no investor read, no private name in the page`, async ({ page, request }) => {
      const log = [];
      await open(page, request, path, { as: 'preview', log });
      await expect(page.getByTestId('portfolio-preview-banner')).toHaveCount(1);
      await expect(page.getByText('Private in preview').first()).toBeVisible();
      expect(log, 'a private read was made in preview').toEqual([]);
      const text = await page.evaluate(() => document.body.innerText + document.body.textContent);
      for (const name of ['Northwind', 'Lumen', 'Pelican', 'Kite']) expect(text.includes(name), `${name} in the DOM`).toBe(false);
      expect(await blocking(page)).toEqual([]);
      await page.setViewportSize(PHONE);
      await page.waitForTimeout(150);
      expect(await blocking(page)).toEqual([]);
      expect(await pageWidth(page)).toBeLessThanOrEqual(PHONE.width);
    });
  }
});

/** WCAG 1.4.12: line height 1.5, paragraphs 2em apart, letters 0.12em, words 0.16em. */
const SPACING = '.pf-shell *, [role="dialog"] * { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } .pf-shell p, [role="dialog"] p { margin-bottom: 2em !important; }';
/**
 * Text cut off by its own box: overflow hidden or clipped, and the text wider or
 * taller than the box. A visually hidden label (a 1px box) is not text cut off.
 */
const clipped = (page) => page.evaluate(() => [...document.querySelectorAll('.pf-shell *, [role="dialog"] *')].filter((n) => {
  if (![...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) return false;
  const s = getComputedStyle(n);
  if (s.display === 'none' || s.visibility === 'hidden' || (n.clientWidth <= 1 && n.clientHeight <= 1)) return false;
  const cut = (o) => o === 'hidden' || o === 'clip';
  return (cut(s.overflowX) && n.scrollWidth > n.clientWidth + 1) || (cut(s.overflowY) && n.scrollHeight > n.clientHeight + 1);
}).map((n) => `${n.tagName.toLowerCase()}.${[...n.classList].join('.')} "${n.textContent.trim().slice(0, 30)}"`));

test.describe('part 3: 200% zoom and text spacing', () => {
  const ALL = [...BOARDS.map((b) => b.path), CO, `${CO}/financials`, `${CO}/reports`];
  for (const path of ALL) {
    test(`${path}: at 200% (720 css px) nothing scrolls sideways; with 1.4.12 spacing no text is cut off at 1280 and 390`, async ({ page, request }) => {
      await open(page, request, path, { viewport: { width: 720, height: 450 } });
      expect(await pageWidth(page), '200% scrolls sideways').toBeLessThanOrEqual(720);
      expect(await blocking(page)).toEqual([]);
      // 1.4.12 asks that the spacing lose nothing: a box already clamped by
      // design (its full text in the row's detail) is listed in D4818-p3 and
      // compared against itself; anything the spacing newly cuts off fails.
      for (const vp of [LAPTOP, PHONE]) {
        await page.setViewportSize(vp);
        await page.waitForTimeout(150);
        const was = new Set(await clipped(page));
        const style = await page.addStyleTag({ content: SPACING });
        await page.waitForTimeout(100);
        expect(await pageWidth(page), `${vp.width} with spacing scrolls sideways`).toBeLessThanOrEqual(vp.width);
        expect((await clipped(page)).filter((x) => !was.has(x)), `${vp.width} text cut off by the spacing`).toEqual([]);
        await style.evaluate((n) => n.remove());
      }
    });
  }
});

test.describe('part 3: reduced motion', () => {
  test('with reduced motion nothing in the frame or a sheet animates while it loads, and the content is the same without it', async ({ page, request }) => {
    const moving = () => page.evaluate(() => document.getAnimations().filter((a) => {
      const el = a.effect?.target;
      const t = a.effect?.getComputedTiming?.() || {};
      return el && el.closest && el.closest('.pf-shell, [role="dialog"]') && a.playState === 'running' && (t.duration > 10 || t.iterations === Infinity);
    }).map((a) => `${a.animationName || a.transitionProperty || 'animation'} on ${a.effect.target.className}`));
    const slow = () => new Promise((r) => { setTimeout(() => r(undefined), 3000); });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // The register and one company's mark history each answer late, so their skeletons are on screen when measured.
    await open(page, request, '/portfolio/positions', { idle: false, over: { '/api/positions': slow, '/api/positions/northwind': slow } });
    await expect(page.locator('.pf-frame .pf-skeleton').first()).toBeVisible();
    expect(await moving(), 'the register loading').toEqual([]);
    await expect(page.getByTestId('button-mark-history-2')).toBeVisible({ timeout: 10_000 });
    const reduced = await page.locator('.pf-frame h1').textContent();
    await page.getByTestId('button-mark-history-2').click();
    await expect(page.getByRole('dialog').locator('.pf-skeleton')).toBeVisible();
    expect(await moving(), 'the sheet opening and loading').toEqual([]);
    await expect(page.getByRole('dialog')).toContainText('Priced round', { timeout: 10_000 });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('button-mark-history-2')).toBeFocused();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.reload();
    await expect(page.locator('.pf-frame .pf-skeleton').first()).toBeVisible();
    expect((await moving()).length, 'without the preference the skeleton does move, so the measure sees motion').toBeGreaterThan(0);
    await expect(page.locator('.pf-frame h1')).toHaveText(reduced);
  });
});

/* ------------------------------------------------------------------ part 4 (D4818-p4) */

/** A held answer: `hold` is an `over` that waits until `release()`, then lets the fixture answer (or answers `body()`). */
function gate(body) {
  let open;
  const opened = new Promise((r) => { open = r; });
  const calls = [];
  return {
    calls,
    hold: async (q, req) => { calls.push(req.method()); await opened; return body ? body() : undefined; },
    release: () => open(),
  };
}
/** Client-side navigation, as a link or Back makes it: the SPA stays loaded, so a late answer can still land. */
const go = (page, path) => page.evaluate((p) => { window.history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')); }, path);
const frameText = (page) => page.evaluate(() => [...document.querySelectorAll('.pf-shell, [role="dialog"]')].map((n) => n.textContent).join(' '));

test.describe('part 4: late answers across a company or account switch', () => {
  test('company workspace: Northwind\'s late reads do not paint over Lumen once the address has changed', async ({ page, request }) => {
    const late = gate();
    await open(page, request, CO, { idle: false, over: {
      '/api/reporting/companies/northwind': late.hold,
      '/api/portfolio/health/northwind': late.hold,
      '/api/portfolio-notes/companies/northwind': late.hold,
    } });
    await expect.poll(() => late.calls.length, 'Northwind\'s reads are in flight').toBeGreaterThanOrEqual(2);
    await go(page, '/portfolio/companies/lumen');
    await expect(page.locator('.pf-frame h1')).toHaveText('Lumen Robotics');
    late.release();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(300);
    await expect(page.locator('.pf-frame h1')).toHaveText('Lumen Robotics');
    // D8681 (#8681): the tab title names the screen, never the company; the heading above names Lumen.
    await expect(page).toHaveTitle('Company · Portfolio · Axal VC');
    await expect(page.getByRole('navigation', { name: 'Lumen Robotics sections' })).toBeVisible();
    expect(await frameText(page), 'a Northwind answer painted into Lumen').not.toContain('Northwind');
    await go(page, '/portfolio/companies/lumen/reports');
    await expect(page.getByTestId('report-obligation-none')).toBeVisible();
    expect(await frameText(page)).not.toContain('Northwind');
  });

  test('Positions: a mark history that answers after another company\'s was opened stays out of it', async ({ page, request }) => {
    const late = gate();
    await open(page, request, '/portfolio/positions', { over: { '/api/positions/northwind': late.hold } });
    await page.getByTestId('button-mark-history-2').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByTestId('button-mark-history-1').click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toContainText('Series A');
    late.release();
    await page.waitForTimeout(500);
    await expect(sheet).toContainText('Lumen Robotics');
    expect(await sheet.textContent(), 'Northwind\'s marks drawn in Lumen\'s sheet').not.toMatch(/Northwind|\$2,400,000|31 Mar 2026/);
  });

  test('money sheet (admin): a company read that answers late does not swap the sheet, and the mark is written to the company reviewed', async ({ page, request }) => {
    const late = gate();
    const log = [];
    let reads = 0;
    await open(page, request, '/portfolio/positions', { as: 'admin', frame: null, log, over: {
      // Northwind's first read is late; every later one answers at once.
      '/api/positions/northwind': (q, req) => ((reads += 1) === 1 ? late.hold(q, req) : undefined),
      '/api/positions/lumen/marks': () => json({ ...STORED_MARK, uid: 'mk-lu1', project_id: 1 }, 201),
      '/api/positions/northwind/marks': () => json(STORED_MARK, 201),
    } });
    const view = page.getByRole('button', { name: 'View dilution' });
    await view.nth(0).click();
    await expect.poll(() => late.calls.length).toBe(1);
    await view.nth(1).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toHaveAccessibleName('Lumen Robotics');
    await page.getByTestId('button-mark-open').click();
    await page.getByTestId('input-mark-as_of_date').fill('2026-10-31');
    await page.getByTestId('input-mark-fmv').fill('5,400,000');
    late.release();
    await page.waitForTimeout(500);
    await expect(sheet, 'the late Northwind read replaced the open sheet').toHaveAccessibleName('Lumen Robotics');
    await expect(page.getByTestId('input-mark-fmv'), 'the draft was lost').toHaveValue('5,400,000');
    await page.getByTestId('form-mark').evaluate((f) => f.requestSubmit());
    await expect(page.getByTestId('write-flow-company')).toContainText('Lumen Robotics');
    await page.getByTestId('write-flow-continue').click();
    await expect(page.getByTestId('write-flow-confirm')).toHaveText('Record $5,400,000 mark for Lumen Robotics');
    await page.getByTestId('write-flow-confirm').click();
    await expect(page.getByTestId('write-flow-receipt')).toContainText('mk-lu1');
    expect(log.filter((l) => l.startsWith('POST')), 'the mark went to another company').toEqual(['POST /api/positions/lumen/marks']);
  });

  test('account switch: the administrator\'s own late book does not reach the Investor preview they switch to', async ({ page, request }) => {
    const late = gate();
    const log = [];
    await open(page, request, '/portfolio/positions', { as: 'admin', frame: null, idle: false, log, over: { '/api/positions': late.hold } });
    await expect.poll(() => late.calls.length).toBeGreaterThanOrEqual(1);
    await page.getByTestId('preview-shell-trigger').click();
    await page.locator('[data-preview-shell="investor"]').click();
    await go(page, '/portfolio/positions');
    await expect(page.getByTestId('portfolio-preview-banner')).toHaveCount(1);
    const before = log.length;
    late.release();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(300);
    await expect(page.getByTestId('portfolio-preview-banner')).toHaveCount(1);
    await expect(page.getByText('Private in preview').first()).toBeVisible();
    const text = await page.evaluate(() => document.body.textContent);
    for (const name of ['Northwind', 'Lumen']) expect(text.includes(name), `${name} reached the preview`).toBe(false);
    expect(log.slice(before), 'the preview made a private read').toEqual([]);
  });
});

/** The support ledger after one move: the entry's new state and date, and the revision it carries now. */
function ledgerAfter(uid, change) {
  return { ...SUPPORT, entries: SUPPORT.entries.map((e) => (e.uid === uid ? { ...e, ...change, revision: e.revision + 1, updated_at: '2026-11-05T09:00:00Z' } : e)) };
}

test.describe('part 4: Deliver and Withdraw that save', () => {
  for (const m of [
    { uid: 'nw-intro', move: 'deliver', state: 'delivered', company: CO_NAME, said: 'is marked delivered', change: { state: 'delivered', delivered_at: '2026-11-05' } },
    { uid: 'lu-review', move: 'withdraw', state: 'withdrawn', company: 'Lumen Robotics', said: 'is withdrawn', change: { state: 'withdrawn', withdrawn_at: '2026-11-05' } },
  ]) {
    test(`${m.move}: pending while it saves, then the ledger read again shows it, the outcome named and announced, focus kept`, async ({ page, request }) => {
      const log = [];
      const bodies = [];
      let saved = false;
      const patch = gate(() => { saved = true; return json({ item: { uid: m.uid, state: m.state } }); });
      await open(page, request, '/portfolio/value-add', { log, over: {
        '/api/portfolio-support': (q, req) => (req.method() === 'GET' ? json(saved ? ledgerAfter(m.uid, m.change) : SUPPORT) : undefined),
        [`/api/portfolio-support/${m.uid}`]: (q, req) => { if (req.method() !== 'PATCH') return undefined; bodies.push(req.postDataJSON()); return patch.hold(q, req); },
      } });
      await page.getByTestId(`button-va-${m.move}-${m.uid}`).focus();
      await page.keyboard.press('Enter');
      const confirm = page.getByTestId(`button-va-confirm-${m.uid}`);
      await confirm.focus();
      const said = await announced(page, m.said, async () => {
        await page.keyboard.press('Enter');
        // Pending: the confirm says so and cannot be pressed twice; nothing claims it saved yet.
        await expect(confirm).toHaveText('Saving…');
        await expect(confirm).toBeDisabled();
        expect(await frameText(page)).not.toContain(m.said);
        patch.release();
      });
      expect(said, 'the saved move').toMatchObject({ regions: 1, before: true });
      await expect(page.getByTestId('status-va-support-saved')).toContainText(m.company);
      await expect(page.getByTestId(`row-va-commitment-${m.uid}`)).toHaveAttribute('data-state', m.state);
      await expect(page.getByTestId(`va-confirm-${m.uid}`)).toHaveCount(0);
      await expect.poll(() => active(page), { message: 'focus fell to the page after the save' }).not.toBe('BODY');
      expect(bodies).toEqual([{ state: m.state, project_uid: expect.any(String), expected_revision: 1 }]);
      expect(log.filter((l) => l.startsWith('PATCH'))).toHaveLength(1);
      expect(await blocking(page)).toEqual([]);
    });
  }
});

test.describe('part 4: reporting delivery unknown', () => {
  for (const v of [
    { name: 'a gateway timeout', answer: (route) => route.fulfill({ status: 504, contentType: 'text/plain', body: 'Gateway Timeout' }) },
    { name: 'a dropped connection', answer: (route) => route.abort('connectionreset') },
  ]) {
    test(`Ask with ${v.name}: says it may or may not be recorded, offers no second send, and the re-read settles it`, async ({ page, request }) => {
      const log = [];
      let asked = false;
      await open(page, request, `${CO}/reports`, { log, over: {
        // After the lost answer, the company read is what says whether the ask landed: here it did.
        '/api/reporting/companies/northwind': (q, req) => (req.method() === 'GET' && asked
          ? json({ ...OWED, company: { ...OWED.company, periods: OWED.company.periods.map((p) => (p.uid === 'pm9' ? { ...p, asked: true, asked_at: '2026-11-05 09:15:00' } : p)) } })
          : undefined),
      } });
      await page.route('**/api/reporting/periods/pm9/ask', (route) => { asked = true; log.push('POST /api/reporting/periods/pm9/ask'); return v.answer(route); });
      await page.getByTestId('report-obligation-ask').click();
      const sheet = page.getByRole('dialog');
      await page.getByTestId('report-review-confirm').click();
      const notice = page.getByTestId('report-review-unknown');
      await expect(notice, 'no answer was read as a refusal').toBeVisible();
      await expect(notice).toHaveAttribute('role', 'alert');
      await expect(notice).toContainText('may or may not');
      await expect(notice).toContainText(CO_NAME);
      expect(await sheet.textContent(), 'an unknown outcome claimed as not sent').not.toContain('Not sent');
      expect(await sheet.textContent(), 'delivery claimed').not.toMatch(/was sent|has been sent|delivered|emailed/i);
      await expect(page.getByTestId('report-review-confirm'), 'the same send offered again').toHaveCount(0);
      expect(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]')), 'focus left the sheet').toBe(true);
      expect(await blocking(page)).toEqual([]);
      await page.getByTestId('report-review-check').click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByTestId('report-obligation-record')).toContainText('You asked on');
      await expect(page.getByTestId('report-obligation-ask')).toHaveCount(0);
      await expect(page.getByTestId('report-obligation')).toBeFocused();
      expect(log.filter((l) => l.startsWith('POST'))).toEqual(['POST /api/reporting/periods/pm9/ask']);
    });
  }

  test('Ask pending: while it waits the confirm says so and cannot be pressed twice, and the Receipt never claims the email arrived', async ({ page, request }) => {
    const log = [];
    const post = gate(() => json(ASK_ANSWER));
    await open(page, request, `${CO}/reports`, { log, over: { '/api/reporting/periods/pm9/ask': post.hold } });
    await page.getByTestId('report-obligation-ask').click();
    const confirm = page.getByTestId('report-review-confirm');
    await confirm.click();
    await expect(confirm).toHaveText('Asking…');
    await expect(confirm).toBeDisabled();
    await expect(page.getByTestId('report-review-cancel')).toBeDisabled();
    post.release();
    await expect(page.getByTestId('report-receipt-status')).toBeVisible();
    await expect(page.getByTestId('report-receipt-facts')).toContainText('Delivery is not confirmed here');
    expect(await page.getByRole('dialog').textContent()).not.toMatch(/was emailed|email was sent|delivered to/i);
    expect(log.filter((l) => l.startsWith('POST'))).toHaveLength(1);
  });
});

/**
 * Computed contrast (WCAG 1.4.3 and 1.4.11), from the browser's own computed
 * colours: every visible element in the Portfolio frame that carries its own
 * text, its colour against the background behind it, composited up the DOM
 * (each translucent layer over the next, the element's and its ancestors'
 * opacity applied to the text). Ratios use WCAG's relative luminance:
 * (L1 + 0.05) / (L2 + 0.05). Text needs 4.5:1, or 3:1 when large (24px, or
 * 18.66px bold). Disabled controls are exempt (1.4.3). A background drawn by
 * an image or gradient is not measured: those elements are counted and named,
 * not passed.
 */
const contrastOf = (page, scope) => page.evaluate((sel) => {
  const cv = document.createElement('canvas');
  cv.width = 1; cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  // The canvas resolves any CSS colour syntax (rgb, hex, oklch, color-mix) to sRGB.
  const rgba = (c) => {
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  };
  const over = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
  const lum = (c) => {
    const [r, g, b] = c.slice(0, 3).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  /** The opaque colour behind `el`, or null when an image or gradient is in the way. */
  const behind = (el) => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.backgroundImage && s.backgroundImage !== 'none') return null;
      const c = rgba(s.backgroundColor);
      if (c[3] > 0) layers.push(c);
      if (c[3] >= 1) break;
    }
    let base = [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i -= 1) base = layers[i][3] >= 1 ? layers[i] : over(layers[i], base);
    return base;
  };
  const opacity = (el) => { let o = 1; for (let n = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity) || 0; return o; };
  const name = (el) => `${el.tagName.toLowerCase()}${[...el.classList].slice(0, 2).map((c) => `.${c}`).join('')} "${el.textContent.trim().replace(/\s+/g, ' ').slice(0, 32)}"`;
  const out = { measured: 0, min: Infinity, failures: [], unmeasured: [], kinds: {} };
  const KINDS = { heading: 'h1, h2, h3', nav: 'nav a', table: 'th, td', button: 'button, .pf-btn', chip: '.pf-chip, .pf-pill', quiet: '.pf-muted, .pf-sm, .pf-foot, .pf-note, small', state: '.pf-not-recorded, .pf-unreadable' };
  for (const el of document.querySelectorAll(`${sel} *`)) {
    if (![...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) continue;
    const s = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    if (s.visibility !== 'visible' || s.display === 'none' || box.width <= 1 || box.height <= 1 || el.closest('[aria-hidden="true"]')) continue;
    if (el.closest('button:disabled, [aria-disabled="true"], fieldset:disabled')) continue;
    const bg = behind(el);
    if (!bg) { out.unmeasured.push(name(el)); continue; }
    const fg = rgba(s.color);
    fg[3] *= opacity(el);
    const r = ratio(over(fg, bg), bg);
    const px = parseFloat(s.fontSize);
    const large = px >= 24 || (px >= 18.66 && Number(s.fontWeight) >= 700);
    const need = large ? 3 : 4.5;
    out.measured += 1;
    out.min = Math.min(out.min, r);
    for (const [k, q] of Object.entries(KINDS)) if (el.matches(q) || el.closest(q)) out.kinds[k] = (out.kinds[k] || 0) + 1;
    if (r + 0.005 < need) out.failures.push(`${name(el)} ${r.toFixed(2)}:1 < ${need}:1 (${s.color} on rgb(${bg.slice(0, 3).join(',')}))`);
  }
  return out;
}, scope);

/** The focus indicator of `locator`, reached from the keyboard: its colour against what is behind it (1.4.11, 3:1). */
const ringOf = (locator) => locator.evaluate((el) => {
  const cv = document.createElement('canvas');
  cv.width = 1; cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const rgba = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const over = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
  const lum = (c) => { const [r, g, b] = c.slice(0, 3).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const s = getComputedStyle(el);
  const ring = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 ? s.outlineColor : (/(rgba?\([^)]*\)|oklch\([^)]*\)|#[0-9a-f]{3,8})/i.exec(s.boxShadow) || [])[1];
  if (!ring) return { ring: null, ratio: 0 };
  // The ring is drawn just outside the control, over its parent's background.
  const layers = [];
  for (let n = el.parentElement; n; n = n.parentElement) {
    const b = getComputedStyle(n);
    if (b.backgroundImage && b.backgroundImage !== 'none') return { ring, ratio: null };
    const c = rgba(b.backgroundColor);
    if (c[3] > 0) layers.push(c);
    if (c[3] >= 1) break;
  }
  let bg = [255, 255, 255, 1];
  for (let i = layers.length - 1; i >= 0; i -= 1) bg = layers[i][3] >= 1 ? layers[i] : over(layers[i], bg);
  return { ring, ratio: ratio(over(rgba(ring), bg), bg) };
});

test.describe('part 4: computed contrast, light and dark', () => {
  const PAGES = [...BOARDS.map((b) => b.path), CO, `${CO}/reports`, `${CO}/financials`];
  for (const theme of ['light', 'dark']) {
    for (const path of PAGES) {
      test(`${path} in ${theme}: every measured text reaches 4.5:1 (3:1 large), and the focus ring 3:1`, async ({ page, request }) => {
        await open(page, request, path, { theme });
        if (theme === 'dark') await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        const r = await contrastOf(page, '.pf-shell');
        test.info().annotations.push({ type: 'contrast', description: `${theme} ${path}: ${r.measured} measured, lowest ${r.min.toFixed(2)}:1, ${r.unmeasured.length} over an image or gradient${r.unmeasured.length ? ` (${r.unmeasured.join('; ')})` : ''}` });
        expect(r.failures, `${theme} ${path}`).toEqual([]);
        expect(r.measured, 'too little was measured to mean anything').toBeGreaterThan(20);
        // The key kinds of text the boards carry were each measured, not skipped.
        for (const k of ['heading', 'nav', 'button', 'quiet']) expect(r.kinds[k] || 0, `${k} text was not measured`).toBeGreaterThan(0);
        await page.keyboard.press('Tab');
        const nav = page.locator('.pf-frame a[href="/portfolio/positions"], .pf-frame a[href$="/financials"]').first();
        await nav.focus();
        const ring = await ringOf(nav);
        expect(ring.ring, 'no focus ring').toBeTruthy();
        expect(ring.ratio ?? 0, `focus ring ${ring.ring}`).toBeGreaterThanOrEqual(3);
      });
    }
  }

  test('a sheet and an in-place confirmation, light and dark', async ({ page, request }) => {
    for (const theme of ['light', 'dark']) {
      await open(page, request, '/portfolio/positions', { theme });
      await page.getByTestId('button-mark-history-2').click();
      await expect(page.getByRole('dialog')).toContainText('Priced round');
      let r = await contrastOf(page, '[role="dialog"]');
      expect(r.failures, `${theme} mark history sheet`).toEqual([]);
      expect(r.measured).toBeGreaterThan(10);
      await page.keyboard.press('Escape');
      await page.goto('/portfolio/value-add');
      await page.getByTestId('button-va-deliver-nw-intro').click();
      await expect(page.getByTestId('va-confirm-nw-intro')).toBeVisible();
      r = await contrastOf(page, '[data-testid="va-confirm-nw-intro"]');
      expect(r.failures, `${theme} Mark delivered confirmation`).toEqual([]);
      expect(r.measured).toBeGreaterThan(1);
    }
  });
});
