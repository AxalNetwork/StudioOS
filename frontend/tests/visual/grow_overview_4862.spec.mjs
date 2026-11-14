/** #4862: approved sparse/active Grow hierarchy, source failure, permissions and context at desktop and phone widths. */
import { test, expect } from '@playwright/test';
import { prepare } from './_editor.mjs';
import { MODULES } from '../../src/pages/cycles/adapters/grow.js';
test.setTimeout(60_000);

const recorded = (value) => ({ state: 'recorded', value });
const absent = { state: 'not_recorded', value: null };
const failed = { state: 'unreadable', value: null };
function overview(projectId, mode) {
  const href = (path) => `${path}?project_id=${projectId}`;
  const primary = { key: mode === 'sparse' ? 'set_focus' : 'review_growth', label: mode === 'sparse' ? 'Set focus metric' : 'Review growth', href: href('/grow/focus') };
  const focus = mode === 'sparse' ? absent : recorded({ metric_key: 'mrr', target_value: 100, direction: 'up', updated_at: '2026-10-01' });
  const item = { key: 'set_focus', actionLabel: 'Set focus metric', label: 'Choose your primary growth metric', why: 'Everything below is ranked against it.', href: href('/grow/focus'), area: 'Focus', priority: 10 };
  const partner = { key: 'partner_proposal', actionLabel: 'Review proposal', label: 'Review saved partner proposals', why: '1 pending proposal from Mercury.', href: href('/grow/partner-network'), area: 'Partnerships', priority: 50 };
  const attention = {
    state: mode === 'partial' ? 'unreadable' : 'ready', writable: mode !== 'readonly', period: '2026-10',
    focus: mode === 'partial' ? failed : focus, measurement: mode === 'partial' ? failed : mode === 'sparse' ? absent : recorded({ value: 0, as_of: '2026-10-19', source: 'manual' }),
    primary: mode === 'partial' || mode === 'readonly' ? null : primary,
    items: mode === 'partial' || mode === 'readonly' ? [] : mode === 'sparse' ? [item, { ...item, key: 'set_target', actionLabel: 'Set target', label: 'Set your growth target', priority: 20 }, { ...item, key: 'record_kpi', actionLabel: 'Enter a KPI', label: 'Record your first KPI', priority: 30 }] : [partner],
    signals: mode === 'partial' ? {} : Object.fromEntries(['targets', 'kpis', 'channels', 'customers'].map((key) => [key, recorded(mode === 'sparse' ? 0 : 1)])),
  };
  return {
    cycle: 'grow', question: 'How does this venture become larger and more enduring?', attention,
    figures: [{ key: 'mrr', label: 'MRR', value: mode === 'sparse' ? null : 0, unit: 'usd', state: mode === 'sparse' ? 'not_recorded' : 'ok', spark: [], delta_30d: null, source: 'manual', as_of: '2026-10-19' }],
    cards: MODULES.map((m) => ({ ...m, state: 'empty', range: 'This month', caption: 'From recorded venture data', reason: 'No entries in this view', series: [], next: null })),
  };
}
async function start(page, request, width, state) {
  const m = await prepare(page, request);
  await page.setViewportSize({ width, height: 900 });
  await page.route('**/api/cycles/grow/overview*', (route) => route.fulfill({ status: state.mode === 'error' ? 503 : 200, json: state.mode === 'error' ? { detail: 'Synthetic read failure' } : overview(m.oneClick.projectId, state.mode) }));
  const path = `/grow?project_id=${m.oneClick.projectId}`;
  await page.goto(path);
  await expect(page.getByTestId('grow-overview-v2')).toBeVisible();
  return { m, path };
}

for (const width of [1440, 390]) {
  test(`Grow sparse and active actions keep venture context at ${width}px`, async ({ page, request }, testInfo) => {
    const state = { mode: 'sparse' };
    const { m } = await start(page, request, width, state);
    await expect(page.getByTestId('cycle-action')).toHaveText('Set focus metric');
    await expect(page.getByRole('button', { name: /^Ask Eadwyn/ })).toHaveCount(1);
    await expect(page.getByTestId('cycle-action')).toHaveAttribute('href', `/grow/focus?project_id=${m.oneClick.projectId}`);
    await expect(page.getByTestId('grow-attention-set_focus')).toBeInViewport();
    await expect(page.getByTestId('grow-setup')).toContainText('Choose primary growth metric');
    await expect(page.getByRole('link', { name: 'Reporting utility' })).toHaveAttribute('href', `/grow/reporting?project_id=${m.oneClick.projectId}`);
    await expect(page.getByRole('link', { name: 'Share an update', exact: true })).toHaveAttribute('href', `/grow/update?project_id=${m.oneClick.projectId}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`grow-sparse-${width}.png`), fullPage: true });
    await page.getByRole('link', { name: 'Share an update', exact: true }).click();
    await expect(page.getByRole('radiogroup', { name: 'Period', exact: true })).toBeVisible();
    if (width < 1024) await page.getByRole('button', { name: '‹ Grow', exact: true }).click();
    else await page.keyboard.press('Escape');
    state.mode = 'active';
    await page.reload();
    await expect(page.getByTestId('cycle-action')).toHaveText('Review growth');
    await expect(page.getByTestId('grow-setup')).toHaveCount(0);
    await expect(page.getByTestId('grow-overview-focus')).toContainText('$0');
    await expect(page.getByTestId('grow-overview-focus')).toContainText('Source: manual');
    await expect(page.getByTestId('grow-attention-partner_proposal')).toContainText('pending proposal');
    await expect(page.getByTestId('grow-attention-partner_proposal').getByRole('link')).toHaveAttribute('href', `/grow/partner-network?project_id=${m.oneClick.projectId}`);
    await expect(page.getByTestId('grow-snapshot')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`grow-active-${width}.png`), fullPage: true });
  });

  test(`Grow failed reads never recommend missing setup and retry in place at ${width}px`, async ({ page, request }) => {
    const state = { mode: 'partial' };
    await start(page, request, width, state);
    await expect(page.getByTestId('grow-overview-focus')).toContainText('Focus could not be read');
    await expect(page.getByTestId('cycle-action')).toHaveCount(0);
    await expect(page.getByTestId('grow-attention-set_focus')).toHaveCount(0);
    await expect(page.getByTestId('grow-setup')).toContainText('Setup could not be read');
    state.mode = 'error';
    await page.reload();
    await expect(page.getByTestId('grow-overview-error')).toBeVisible();
    await expect(page.getByTestId('cycle-action')).toHaveCount(0);
    state.mode = 'sparse';
    await page.getByTestId('grow-overview-error').getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByTestId('cycle-action')).toHaveText('Set focus metric');
  });

  test(`Grow read-only evidence keeps operating and share actions unavailable at ${width}px`, async ({ page, request }) => {
    await start(page, request, width, { mode: 'readonly' });
    await expect(page.getByTestId('grow-overview-focus')).toContainText('$0');
    await expect(page.getByTestId('cycle-action')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Share an update', exact: true })).toHaveCount(0);
    await expect(page.getByTestId('grow-overview-v2').getByRole('button', { name: /^Ask Eadwyn/ })).toHaveCount(0);
    await expect(page.getByTestId('grow-setup')).toHaveCount(0);
    await expect(page.getByTestId('grow-attention')).toContainText('Read only');
  });
}


test('the real Worker overview feeds the rendered attention part without a mock', async ({ page, request }) => {
  const m = await prepare(page, request);
  const response = await request.get(`/api/cycles/grow/overview?project=${m.oneClick.projectId}`, { headers: { Authorization: `Bearer ${m.token}` } });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.attention.writable).toBe(true);
  expect(body.attention.focus.state).toBe('not_recorded');
  expect(body.attention.primary.key).toBe('set_focus');
  expect(body.attention.primary.href).toBe(`/grow/focus?project_id=${m.oneClick.projectId}`);
  await page.goto(`/grow?project_id=${m.oneClick.projectId}`);
  await expect(page.getByTestId('cycle-action')).toHaveText('Set focus metric');
  await expect(page.getByTestId('grow-attention-set_focus')).toBeVisible();
});
