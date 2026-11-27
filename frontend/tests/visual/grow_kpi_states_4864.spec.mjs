/** D4864 (#4864, GR-12, GR-15): Grow's KPI states, source lines and recovery at 1440 and 390, light and dark, with axe and a failed refresh. */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { prepare } from './_editor.mjs';
import { MODULES } from '../../src/pages/cycles/adapters/grow.js';
test.setTimeout(90_000);

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const recorded = (value) => ({ state: 'recorded', value });
const fig = (o) => ({ unit: 'count', value: null, delta_30d: null, spark: [], state: 'not_recorded', source: null, as_of: null, reason: null, reason_code: null, freshness: null, ...o });
function overview(projectId) {
  const focus = recorded({ metric_key: 'mrr', target_value: 100, direction: 'up', updated_at: '2026-11-01' });
  return {
    cycle: 'grow', question: 'How does this venture become larger and more enduring?',
    attention: { state: 'ready', writable: true, period: '2026-11', focus, measurement: recorded({ value: 0, as_of: '2026-11-12', source: 'manual' }),
      primary: { key: 'review_growth', label: 'Review growth', href: `/grow/focus?project_id=${projectId}` }, items: [],
      signals: { targets: recorded(1), kpis: recorded(1), channels: recorded(0), customers: { state: 'unreadable', value: null } } },
    figures: [
      fig({ key: 'mrr', label: 'MRR', unit: 'usd', value: 0, state: 'too_little', source: 'manual', as_of: '2026-11-12', freshness: 'current', delta_30d: 0 }),
      fig({ key: 'nrr', label: 'Net revenue retention', unit: 'pct', value: 104, state: 'too_little', source: 'Revenue ledger · stripe', as_of: '2026-09-30', freshness: 'stale', delta_30d: 2 }),
      fig({ key: 'customers', label: 'Customers', reason_code: 'not_connected', reason: 'Not recorded: Stripe is not connected and no Customers figure was entered by hand' }),
      fig({ key: 'headcount', label: 'Headcount', state: 'unreadable', reason_code: 'unavailable', reason: 'Unreadable: Headcount could not be read' }),
    ],
    cards: MODULES.map((m) => (m.slug === 'partner-network'
      ? { ...m, state: 'empty', range: 'Last 6 months', reason: 'No partners yet. Partners by stage appear here.', series: [], next: { text: 'Add partner', href: `/grow/partner-network?project=${projectId}&add=1` } }
      : { ...m, state: 'ok', range: 'This month', caption: 'From recorded venture data', series: [], next: null })),
  };
}
async function open(page, request, width, theme, state) {
  const m = await prepare(page, request);
  const res = await request.put('/api/settings/appearance', { headers: { Authorization: `Bearer ${m.token}` }, data: { theme } });
  expect(res.ok()).toBe(true);
  await page.setViewportSize({ width, height: 900 });
  await page.route('**/api/cycles/grow/overview*', (route) => route.fulfill(state.fail ? { status: 503, json: { detail: 'Synthetic read failure' } } : { status: 200, json: overview(m.oneClick.projectId) }));
  await page.goto(`/grow?project_id=${m.oneClick.projectId}`);
  await expect(page.getByTestId('grow-overview-v2')).toBeVisible();
  return m;
}

for (const width of [1440, 390]) {
  for (const theme of ['light', 'dark']) {
    test(`Grow KPI states, sources and recovery at ${width}px in ${theme}`, async ({ page, request }, testInfo) => {
      const state = { fail: false };
      const m = await open(page, request, width, theme, state);
      const pid = m.oneClick.projectId;
      if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/);
      await expect(page.getByTestId('grow-kpi-mrr')).toContainText('$0');
      await expect(page.getByTestId('grow-kpi-mrr')).toContainText('Measured zero, not missing.');
      await expect(page.getByTestId('grow-kpi-mrr')).toContainText('Source: Entered by hand · as of 2026-11-12');
      await expect(page.getByTestId('grow-kpi-nrr')).toContainText(/Stale · \d+ days old/);
      await expect(page.getByTestId('grow-kpi-nrr')).not.toContainText('▲');
      await expect(page.getByTestId('grow-kpi-customers')).toContainText('Not recorded');
      await expect(page.getByTestId('grow-kpi-customers-connect')).toHaveAttribute('href', '/account/connectors/stripe');
      await expect(page.getByTestId('grow-kpi-customers-enter')).toHaveAttribute('href', `/grow/revenue-and-traction/new?project_id=${pid}&kpi=paying_accounts`);
      await expect(page.getByTestId('grow-kpi-headcount')).toContainText('Unavailable');
      await expect(page.getByTestId('grow-kpi-headcount').getByRole('button', { name: /Retry/ })).toBeVisible();
      await expect(page.getByTestId('grow-domain-customers')).toContainText('Unavailable');
      await expect(page.getByTestId('grow-domain-customers-action')).toHaveCount(0);
      await expect(page.getByTestId('grow-domain-distribution-action')).toHaveAttribute('href', `/grow/distribution?project_id=${pid}`);
      await expect(page.getByTestId('grow-domain-partnerships-action')).toHaveAttribute('href', `/grow/partner-network?project_id=${pid}&add=1`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const axe = await new AxeBuilder({ page }).withTags(TAGS).include('[data-testid="grow-snapshot"]').include('[data-testid="grow-domains"]').analyze();
      expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`grow-kpi-states-${width}-${theme}.png`), fullPage: true });

      // GR-15: a failed refresh keeps this venture's figures, marked Stale, with Try again.
      state.fail = true;
      await page.getByTestId('grow-kpi-headcount').getByRole('button', { name: /Retry/ }).click();
      await expect(page.getByTestId('grow-refresh-failed')).toBeVisible();
      await expect(page.getByTestId('grow-refresh-failed')).toHaveAttribute('role', 'alert');
      await expect(page.getByTestId('grow-kpi-mrr')).toHaveAttribute('data-kpi-state', 'kept');
      await expect(page.getByTestId('grow-overview-error')).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath(`grow-kpi-refresh-failed-${width}-${theme}.png`), fullPage: true });
      state.fail = false;
      await page.getByTestId('grow-refresh-retry').click();
      await expect(page.getByTestId('grow-refresh-failed')).toHaveCount(0);
      await expect(page.getByTestId('grow-kpi-mrr')).toHaveAttribute('data-kpi-state', 'value');
    });
  }
}
