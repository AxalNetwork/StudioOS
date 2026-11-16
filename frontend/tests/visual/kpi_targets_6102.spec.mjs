/** #6102: the actual Grow table keeps target links above its row overlay on desktop and phone. */
import { test, expect } from '@playwright/test';
import { prepare } from './_editor.mjs';

for (const phone of [false, true]) test(`target/actual and Focus link in the ${phone ? 'phone' : 'desktop'} KPI table`, async ({ page, request }) => {
  const m = await prepare(page, request); const projectId = m.oneClick.projectId;
  if (phone) await page.setViewportSize({ width: 390, height: 844 });
  const target = (key, value, actual, met) => ({ metric_key: key, target_value: value, direction: key === 'net_burn' ? 'down' : 'up', actual, met });
  const rows = [
    { id: 'mrr', kpi: 'MRR', value: 80, unit: 'usd', target: target('mrr', 100, 80, false) },
    { id: 'net_burn', kpi: 'Burn', value: 51, unit: 'usd', target: target('net_burn', 50, 51, false) },
    { id: 'paying_accounts', kpi: 'Customers', value: 0, unit: 'count', target: target('paying_accounts', 0, 0, true) },
    { id: 'missing', kpi: 'Missing actual', value: null, unit: null, target: target('mrr', 200, null, null) },
  ].map((r) => ({ ...r, source: 'manual', as_of: '2026-11-14', target_state: 'recorded', target_href: `/grow/focus?project_id=${projectId}` }));
  await page.route('**/api/cycles/grow/modules/revenue-and-traction**', route => route.fulfill({ json: {
    module: { slug: 'revenue-and-traction', name: 'Revenue and traction', records_title: 'KPIs' },
    card: { slug: 'revenue-and-traction', name: 'Revenue and traction', state: 'empty', series: [], reason: 'No chart recorded in this fixture.' },
    records: { cols: ['KPI', 'Value', 'Change · 30 d', 'Source', 'As of', 'Target', 'Vs target'], rows, total: rows.length, page: 1, page_size: 25, linkable: true, filters: [], sorts: [] }, parts: {},
  } }));
  await page.goto(`/grow/revenue-and-traction?project_id=${projectId}`);
  const records = page.getByTestId(phone ? 'phone-module-records' : 'cycle-records');
  await expect(records).toContainText('Below target'); await expect(records).toContainText('Above target'); await expect(records).toContainText('Target met');
  await expect(records).not.toContainText('On track');
  let focus;
  if (phone) {
    await expect(records).toContainText('$80 · Target: $100.00 · Below target');
    await expect(records).toContainText('0 · Target: 0 · Target met');
    const missing = page.getByTestId('phone-module-row').filter({ hasText: 'Missing actual' });
    await expect(missing).toContainText('Not recorded · Target: $200.00');
    await expect(missing).not.toContainText('Vs target');
    focus = page.getByTestId('phone-module-tool').filter({ hasText: 'Open the metric log' });
    await expect(records.getByRole('link').filter({ hasText: 'MRR' })).toHaveAttribute('href', `/grow/revenue-and-traction/mrr?project_id=${projectId}`);
  } else {
    const missing = records.getByRole('row').filter({ hasText: 'Missing actual' }).getByRole('cell').nth(6);
    expect((await missing.innerText()).trim()).toBe('');
    focus = records.getByRole('link', { name: '$100.00', exact: true });
    await expect(records.getByRole('link', { name: 'MRR', exact: true })).toHaveAttribute('href', `/grow/revenue-and-traction/mrr?project_id=${projectId}`);
  }
  await expect(focus).toHaveAttribute('href', `/grow/focus?project_id=${projectId}`);
  await focus.click();
  await expect(page).toHaveURL(new RegExp(`/grow/focus\\?project_id=${projectId}$`));
});
