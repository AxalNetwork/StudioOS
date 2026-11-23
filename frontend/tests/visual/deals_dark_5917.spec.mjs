/**
 * #5917 (D4815-p16, Deals v2 DX16, boards DE16a and DE16b): Deal flow and the deal Overview in dark
 * mode. The three status families and every absence state are drawn, each with its own word and
 * shape, and axe finds no text below 4.5:1 on the dark card or raised surfaces. Every venture is made up.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { prepare } from './_editor.mjs';
test.setTimeout(90_000);

const sc = (scope, band, confidence_word = 'High') => ({ scope, state: 'scored', band, confidence_word });
const DEALS = [
  { id: 1, project_name: 'Example Robotics', project_sector: 'Robotics', status: 'active', round_status: 'active', currency: 'USD', target_raise: 2000000, instrument: 'safe', can_read: true },
  { id: 2, project_name: 'Example Harbor', project_sector: 'AI tooling', status: 'active', currency: 'USD', target_raise: 1000000, instrument: 'priced', can_read: true },
  { id: 3, project_name: 'Example Copperline', project_sector: 'Energy', status: 'active', currency: 'USD', target_raise: 2500000, instrument: 'safe', can_read: true },
  { id: 4, project_name: 'Example Lumen', project_sector: 'Energy', status: 'scored', currency: 'USD', target_raise: 800000, instrument: 'safe', can_read: true },
];
// Deal 1 carries a value, a low-confidence value, Not expected yet, Not enough recorded, an unreadable
// scope and an unscored one; 2 is locked; 3 unreadable as a whole; 4 is left out of the batch (Not shared).
const BATCH = { items: [
  { deal_id: 1, locked: false, scopes: [sc('team', 'Strong'), sc('market', 'Fair', 'Low'), { scope: 'pmf', state: 'not_expected' }, { scope: 'technical', state: 'not_enough' }, { scope: 'traction', state: 'unreadable' }] },
  { deal_id: 2, locked: true, reason: 'The founder has not shared this scorecard.' },
  { deal_id: 3, unreadable: true },
] };
const FLOW = { scope: 'firm', by_stage: {}, items: [
  { uid: 'f1', deal_id: 1, venture: 'Example Robotics', stage: 'diligence', stage_changed_at: '2026-10-10 10:00:00', round_status: 'active', entered_via: 'invited', can_open: true },
  { uid: 'f2', deal_id: 2, venture: 'Example Harbor', stage: 'sourcing', stage_changed_at: '2026-09-01 10:00:00', can_open: true },
  { uid: 'f3', deal_id: 3, venture: 'Example Copperline', stage: 'screening', stage_changed_at: '2026-10-15 10:00:00', can_open: true },
  { uid: 'f4', deal_id: 4, venture: 'Example Lumen', stage: 'screening', stage_changed_at: '2026-10-01 10:00:00', can_open: true },
] };

async function open(page, request, { width, path }) {
  const m = await prepare(page, request, { as: 'security' });
  const user = { ...m.security.user, role: 'investor', is_superadmin: false, kyc_status: 'approved', subscription_tier: 'pro' };
  await page.addInitScript((u) => { localStorage.setItem('user', JSON.stringify(u)); localStorage.setItem('viewMode', 'investor'); }, user);
  await page.setViewportSize({ width, height: 900 });
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/api/auth/me') return route.fulfill({ json: user });
    if (p === '/api/onboarding/progress') return route.fulfill({ json: { flow: 'investor', completed_at: '2026-10-01' } });
    if (p === '/api/settings/appearance') return route.fulfill({ json: { theme: 'dark' } });
    if (p === '/api/deals/flow') return route.fulfill({ json: FLOW });
    if (p === '/api/deals/flow/passes') return route.fulfill({ json: { scope: 'you', total: 0, buckets: [], items: [] } });
    if (p === '/api/deals/fit') return route.fulfill({ json: { items: [{ deal_id: 1, state: 'scored', score: 84, confidence_label: 'High' }] } });
    if (p === '/api/venture-scores/batch') return route.fulfill({ json: BATCH });
    if (p === '/api/deals') return route.fulfill({ json: DEALS });
    if (p === '/api/deals/dealroom/quota') return route.fulfill({ json: { used: 1, cap: 5, unlimited: false, plan: 'pro' } });
    if (/^\/api\/deals\/\d+$/.test(p)) return route.fulfill({ json: DEALS.find((d) => `/api/deals/${d.id}` === p) || {} });
    return route.fulfill({ json: { items: [], views: [], weights: {}, by_stage: {} } });
  });
  await page.goto(path);
  await expect(page.locator('html')).toHaveClass(/dark/);
}

/** Serious or critical colour-contrast findings inside `scope`. */
async function contrast(page, scope) {
  const axe = await new AxeBuilder({ page }).withRules(['color-contrast']).include(scope).analyze();
  return axe.violations.flatMap((v) => v.nodes.map((n) => `${n.target.join(' ')}: ${n.any.map((a) => a.message).join('; ')}`));
}

for (const width of [1440, 390]) {
  test(`DE16a Deal flow in dark mode at ${width}px`, async ({ page, request }, testInfo) => {
    await open(page, request, { width, path: '/deals' });
    await expect(page.getByTestId(width < 768 ? 'dealflow-phone-board' : 'dealflow-board')).toBeVisible();
    await expect(page.locator('[data-testid^="dealflow-card-"][data-states]').first()).toBeVisible();
    // The three status families, each its own shape.
    for (const f of ['company', 'process', 'transaction']) await expect(page.locator(`[data-family="${f}"]`).first()).toBeVisible();
    await page.setViewportSize({ width, height: width < 768 ? 3200 : 1600 });
    await page.screenshot({ path: testInfo.outputPath(`de16a-${width}-dark.png`), fullPage: true });
    expect(await contrast(page, '[data-app-main]')).toEqual([]);
  });
}

test('DE16a Deal flow table in dark mode: a value and every absence state, each with its own mark and word', async ({ page, request }, testInfo) => {
  await open(page, request, { width: 1440, path: '/deals?view=table&scope=all' });
  await expect(page.locator('[data-family="locked"]').first()).toBeVisible();
  const marks = await page.locator('[data-family]').evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('data-family')))].sort());
  for (const f of ['value', 'not_expected', 'not_recorded', 'unreadable', 'locked', 'missing', 'not_shared']) expect(marks, f).toContain(f);
  await page.setViewportSize({ width: 1440, height: 1600 });
  await page.screenshot({ path: testInfo.outputPath('de16a-table-dark.png'), fullPage: true });
  expect(await contrast(page, '[data-app-main]')).toEqual([]);
});

for (const width of [1440, 390]) {
  test(`DE16b the deal Overview in dark mode at ${width}px`, async ({ page, request }, testInfo) => {
    await open(page, request, { width, path: '/deals/1' });
    await expect(page.getByRole('heading', { name: /Example Robotics/ }).first()).toBeVisible();
    await page.setViewportSize({ width, height: width < 768 ? 3200 : 1600 });
    await page.screenshot({ path: testInfo.outputPath(`de16b-${width}-dark.png`), fullPage: true });
    expect(await contrast(page, '[data-app-main]')).toEqual([]);
  });
}
