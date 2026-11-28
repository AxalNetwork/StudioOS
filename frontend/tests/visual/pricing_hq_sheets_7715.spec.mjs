/**
 * D7715 part 2 (#7715) — the browser pass of the HQ country catalogue's two write sheets: Import country data on
 * `/admin/licences/pricing` and Record observation on `/admin/licences/pricing/country/:code` (canvas Licences
 * Country Data Sheets, LCD-01 to LCD-08, D7703). The built SPA that `server.ts` serves, signed in as a Super Admin at
 * HQ; every `/api` read and write is answered here, as the Worker answers it (`admin_licence_pricing.ts` and
 * `admin_licence_pricing_hq.ts`): a 200, a 207 with conflicts, a 400 with rows or fields, a 409 with the revision
 * now, a 502. At 1280 and 390 wide, light and dark:
 *
 *   - Import: the builder's body previewed (countries, fields, rows, revisions), the reason required, sent once, the
 *     catalogue read again; a 207 names the conflicted countries and the same body cannot be sent again; a refusal
 *     shows the Worker's sentence and nothing on the page changes; a 502 is said as no answer, and the file is spent.
 *   - Record observation: the expected revision is the read's, sent once, the new row first in the history and
 *     focused; a stale revision and a field refusal stay on the sheet with the typed values.
 *   - Zero axe violations (WCAG 2.0 to 2.2 A and AA) on the page and on each sheet; the keyboard opens each sheet,
 *     focus moves in, Escape gives it back to the opener; nothing is wider than the window at 390.
 *
 * Screenshots (device scale 2) are written only when PRICING_SHEETS_EVIDENCE_DIR is set; there are no baselines.
 * Every country figure, source and name here is invented.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { CONSENT_VERSION } from '../../src/lib/cookieConsent.js';

const EVIDENCE = process.env.PRICING_SHEETS_EVIDENCE_DIR || '';
if (EVIDENCE) mkdirSync(EVIDENCE, { recursive: true });
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const NOW = new Date('2026-11-28T09:40:00Z');
const BASE = '/api/admin/licence-pricing';
const ADMIN = { id: 7715, name: 'Pricing operator', email: 'operator@example.test', role: 'admin', is_super_admin: 1, is_superadmin: true, kyc_status: 'approved' };

const row = (country_code, field, value, over = {}) => ({ country_code, field, value, status: 'recorded', source: 'Source A sample', source_ref: 'table 1', as_of: '2026-01-01', ...over });
const BODY = {
  observations: [
    row('PT', 'population', 10_412_000), row('PT', 'ppp_gdp_per_capita', 45_200),
    row('EE', 'population', 1_371_000), row('EE', 'startup_ecosystem_score', 60_450, { status: 'provisional', source_ref: null }),
    row('IE', 'population', 5_281_000),
  ],
  expected_revisions: { PT: 12, EE: 7, IE: 4 },
  reason: 'Annual refresh from the sample source',
};
const FILE = { name: 'country-import.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(BODY)) };

const country = (code, name, region, revision, over = {}) => ({
  country_code: code, country_name: name, region_code: region, currency_code: 'EUR', regulatory_class: 'medium', data_completeness: null,
  last_source_update: '2026-10-14', recommendation: null, recommendation_reason: 'No pricing model is active.', profile_revision: revision, ...over,
});
const CATALOGUE = (revs) => ({
  model: null, model_reason: 'No pricing model is active.', model_problem: null, total: 3, counts: {},
  countries: [country('PT', 'Portugal', 'Southern Europe', revs.PT), country('EE', 'Estonia', 'Baltics', revs.EE), country('IE', 'Ireland', 'Western Europe', revs.IE)],
});
const PROFILE = {
  country_code: 'DK', country_name: 'Denmark', currency_code: 'DKK', region_code: 'Nordics', revision: 9,
  population: 5_961_000, population_status: 'recorded', population_source: 'Source A sample', population_source_ref: 'table 1', population_as_of: '2026-01-01',
  ppp_gdp_per_capita: 74_100, ppp_status: 'recorded', ppp_source: 'Source A sample', ppp_as_of: '2026-10-14',
  startup_ecosystem_score: 52_140, startup_score_status: 'recorded', startup_source: 'Source B sample', startup_source_ref: 'edition 3', startup_as_of: '2025-09-02', startup_ecosystem_rank: null,
};
const INPUTS = {
  market_size: { value: 5_961_000, status: 'recorded', source: 'Source A sample', source_ref: 'table 1', as_of: '2026-01-01' },
  purchasing_power: { value: 74_100, status: 'recorded', source: 'Source A sample', as_of: '2026-10-14' },
  startup_ecosystem: { value: 52_140, status: 'recorded', source: 'Source B sample', source_ref: 'edition 3', as_of: '2025-09-02' },
};
const OLDROW = { uid: 'o1', field: 'population', kind: 'value', value: 5_961_000, status: 'recorded', source: 'Source A sample', source_ref: 'table 1', as_of: '2026-01-01', ingested_at: '2026-02-03T10:12:00Z', recorded_by: 'user:3', reason: 'Yearly figures', profile_revision: 9 };
const NEWROW = { uid: 'o9', field: 'startup_ecosystem_score', kind: 'value', value: 41_250, status: 'recorded', source: 'Source B sample', source_ref: 'edition 4', as_of: '2026-10-01', ingested_at: '2026-11-28T09:40:00Z', recorded_by: 'user:7715', reason: 'Edition received', profile_revision: 10 };
const detail = (revision, observations) => ({
  profile: { ...PROFILE, revision }, inputs: INPUTS, data_completeness: { state: 'complete', recorded: 3, provisional: 0, not_recorded: 0, of: 3, missing: [], provisional_inputs: [] },
  last_source_update: '2026-10-14', regulatory_class: 'low', model: null, model_reason: 'No pricing model is active.',
  calculation: null, calculation_reason: 'No pricing model is active.', observations, snapshots: [],
});
const refusal = (code, message, extra = {}) => ({ ...extra, error: code, message, detail: message });

/**
 * Signs in as a Super Admin at HQ and answers every `/api` request. `answers.import` and `answers.record` are lists:
 * each write takes the next [status, body]. Returns what was sent and read, for the assertions.
 */
async function install(page, { theme, answers = {} }) {
  const seen = { imports: [], records: [], catalogue: 0, country: 0, consistency: 0 };
  let revs = { PT: 12, EE: 7, IE: 4 };
  let market = detail(9, [OLDROW]);
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(({ user, consentVersion, t }) => {
    localStorage.setItem('token', 'synthetic-pricing-session');
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('viewMode', 'admin');
    localStorage.setItem('hqView', '1');
    localStorage.setItem('axal_appearance_v1', JSON.stringify({ theme: t }));
    localStorage.setItem('axal_cookie_consent_v1', JSON.stringify({ version: consentVersion, decided: true, updatedAt: '2026-11-01T00:00:00Z', categories: { essential: true } }));
  }, { user: ADMIN, consentVersion: CONSENT_VERSION, t: theme });
  await page.route((u) => u.hostname !== '127.0.0.1', (route) => route.abort('blockedbyclient'));
  await page.route((u) => u.hostname === '127.0.0.1' && u.pathname.startsWith('/api/'), async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/auth/me' || path === '/api/me') return json(ADMIN);
    if (path === '/api/settings/appearance') return json({ theme });
    if (path === '/api/onboarding/progress') return json({ completed_at: '2026-10-01T00:00:00Z' });
    if (path === `${BASE}/catalogue`) { seen.catalogue += 1; return json(CATALOGUE(revs)); }
    if (path === `${BASE}/model-versions`) return json({ current: null, drafts: [], retired: [], history: [] });
    if (path === `${BASE}/consistency`) { seen.consistency += 1; return json({ checked: { countries: 3, fields: 12 }, findings: [], total: 0, counts: {}, stored: false }); }
    if (path === `${BASE}/catalogue/DK`) { seen.country += 1; return json(market); }
    if (req.method() === 'POST' && path === `${BASE}/countries/import`) {
      seen.imports.push(req.postDataJSON());
      const [status, body] = answers.import.shift();
      if (status === 200 || status === 207) for (const [code, n] of Object.entries(body.applied)) revs = { ...revs, [code]: revs[code] + n };
      return json(body, status);
    }
    if (req.method() === 'POST' && path === `${BASE}/countries/DK/observations`) {
      seen.records.push(req.postDataJSON());
      const [status, body] = answers.record.shift();
      if (status === 201) market = detail(body.profile.revision, [NEWROW, OLDROW]);
      return json(body, status);
    }
    return json({});
  });
  return { seen, bumpMarket: (revision) => { market = detail(revision, [OLDROW]); } };
}

/** Every axe violation (any impact) inside `scope`, one line each. */
async function violations(page, scope) {
  const r = await new AxeBuilder({ page }).withTags(TAGS).include(scope).analyze();
  return r.violations.map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

/** Nothing wider than the window: the page, and the open sheet. */
async function fits(page) {
  const m = await page.evaluate(() => {
    const d = document.documentElement;
    const sheet = document.querySelector('[role="dialog"]');
    return { page: d.scrollWidth, window: d.clientWidth, sheet: sheet ? sheet.scrollWidth - sheet.clientWidth : 0, right: sheet ? sheet.getBoundingClientRect().right : 0 };
  });
  expect(m.page, 'the page scrolls sideways').toBeLessThanOrEqual(m.window);
  expect(m.sheet, 'the sheet scrolls sideways').toBeLessThanOrEqual(0);
  expect(m.right).toBeLessThanOrEqual(m.window + 1);
}

/** What the catalogue shows, without the screen-reader live region (which says the refusal, LCD-08). */
const shown = (page) => page.getByTestId('hq-licence-pricing-page').evaluate((el) => {
  const copy = el.cloneNode(true);
  copy.querySelectorAll('[data-testid="pricing-live"]').forEach((n) => n.remove());
  return copy.textContent;
});

async function shot(page, combo, name) {
  if (!EVIDENCE) return;
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.screenshot({ path: join(EVIDENCE, `${combo}-${name}.png`), animations: 'disabled', caret: 'initial' });
}

async function openCatalogue(page) {
  await page.goto('/admin/licences/pricing');
  await expect(page.getByTestId('hq-licence-pricing-page')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('pricing-check-clear')).toBeVisible();
}

/** Opens Import, chooses the builder's file through the file chooser and reaches the review step. */
async function toReview(page) {
  await page.getByRole('button', { name: 'Import country data…' }).click();
  const sheet = page.getByRole('dialog', { name: 'Import country data' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId('pricing-import-review')).toBeDisabled();
  const chooser = page.waitForEvent('filechooser');
  await sheet.getByRole('button', { name: /^Choose (another )?file…$/ }).click();
  await (await chooser).setFiles(FILE);
  await sheet.getByRole('button', { name: 'Review 5 rows' }).click();
  await expect(sheet.getByTestId('pricing-import-summary')).toBeVisible();
  return sheet;
}

async function openCountry(page) {
  await page.goto('/admin/licences/pricing/country/dk');
  await expect(page.getByTestId('hq-licence-pricing-country')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('pricing-country-revision')).toHaveText('9');
}

async function fillRecord(page) {
  await page.getByRole('button', { name: 'Record observation…' }).click();
  const sheet = page.getByRole('dialog', { name: 'Record observation' });
  await expect(sheet.getByTestId('pricing-obs-revision')).toContainText('You are changing revision 9 of Denmark, read at 09:40 UTC.');
  await sheet.getByLabel('Field').selectOption('startup_ecosystem_score');
  await sheet.getByLabel(/^Value/).fill('41,250');
  await sheet.getByLabel('Source', { exact: true }).fill('Source B sample');
  await sheet.getByLabel(/^Reference/).fill('edition 4');
  await sheet.getByLabel(/^As of/).fill('2026-10-01');
  await sheet.getByLabel(/^Reason/).fill('Edition received');
  return sheet;
}

const COMBOS = [
  { id: 'desktop-1280-light', width: 1280, height: 900, theme: 'light' },
  { id: 'desktop-1280-dark', width: 1280, height: 900, theme: 'dark' },
  { id: 'phone-390-light', width: 390, height: 844, theme: 'light' },
  { id: 'phone-390-dark', width: 390, height: 844, theme: 'dark' },
];

for (const combo of COMBOS) {
  test.describe(combo.id, () => {
    test.use({ viewport: { width: combo.width, height: combo.height }, deviceScaleFactor: 2 });
    const phone = combo.width < 768;

    test('Import: the builder body is previewed, the reason required, sent once, and the catalogue read again', async ({ page }) => {
      const { seen } = await install(page, { theme: combo.theme, answers: { import: [[200, { applied: { PT: 2, EE: 2, IE: 1 }, conflicts: [] }]] } });
      await openCatalogue(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', combo.theme);
      expect(await violations(page, '[data-testid="hq-licence-pricing-page"]'), 'the catalogue').toEqual([]);
      if (phone) await fits(page);
      const sheet = await toReview(page);
      await expect(sheet.getByTestId('pricing-import-countries')).toHaveText('3');
      await expect(sheet.getByTestId('pricing-import-rows')).toHaveText('5 of at most 500');
      await expect(sheet.getByTestId('pricing-import-fields')).toHaveText('Population 3 · PPP GDP per capita 1 · Startup ecosystem score 1 · Startup ecosystem rank 0');
      await expect(sheet.getByTestId('pricing-import-row')).toHaveCount(5);
      await expect(sheet.getByTestId('pricing-import-revisions')).toContainText('PT [12]EE [7]IE [4]');
      await expect(sheet.getByTestId('pricing-import-file')).toContainText('country-import.json · 5 rows · 3 countries · read in this browser at 09:40 UTC');
      await shot(page, combo.id, 'import-review');
      expect(await violations(page, '[role="dialog"]'), 'the review step').toEqual([]);
      if (phone) await fits(page);

      const reason = sheet.getByLabel(/^Reason/);
      await expect(reason).toHaveValue(BODY.reason);
      const send = sheet.getByRole('button', { name: 'Import 5 observations' });
      await reason.fill('ab');
      await expect(send).toBeDisabled();
      await reason.fill('Annual refresh, checked twice');
      await send.scrollIntoViewIfNeeded();
      await shot(page, combo.id, 'import-reason');
      const reads = seen.catalogue;
      await send.click();
      const outcome = sheet.getByTestId('pricing-import-outcome');
      await expect(outcome).toHaveAttribute('data-partial', 'false');
      await expect(outcome).toContainText('5 observations recorded for 3 countries.');
      expect(seen.imports).toEqual([{ ...BODY, reason: 'Annual refresh, checked twice' }]);
      await expect.poll(() => seen.catalogue).toBe(reads + 1);
      await expect(sheet.getByTestId('pricing-import-written-table').getByRole('row')).toHaveCount(4);
      await shot(page, combo.id, 'import-written');
      expect(await violations(page, '[role="dialog"]'), 'the result').toEqual([]);
      await sheet.getByRole('button', { name: 'Back to the catalogue' }).click();
      await expect(sheet).toHaveCount(0);
      await expect(page.getByTestId('pricing-import-reread-note')).toContainText('read again at 09:40 UTC after the import');
      if (phone) await expect(page.getByTestId('pricing-catalogue-list').getByRole('listitem')).toContainText(['revision 14', 'revision 9', 'revision 5']);
      else await expect(page.getByTestId('pricing-cell-revision')).toHaveText(['14', '9', '5']);

      const again = await toReview(page);
      await expect(again.getByTestId('pricing-import-already-sent')).toContainText('This file was already sent from this page.');
      await expect(again.getByRole('button', { name: 'Import 5 observations' })).toBeDisabled();
      expect(seen.imports).toHaveLength(1);
    });

    test('Import: a 207 lists the conflicted countries and the same body cannot be sent again', async ({ page }) => {
      const { seen } = await install(page, { theme: combo.theme, answers: { import: [[207, { applied: { PT: 2 }, conflicts: [{ country_code: 'EE', current_revision: 8 }, { country_code: 'IE', current_revision: 5 }] }]] } });
      await openCatalogue(page);
      const sheet = await toReview(page);
      await sheet.getByRole('button', { name: 'Import 5 observations' }).click();
      const outcome = sheet.getByTestId('pricing-import-outcome');
      await expect(outcome).toHaveAttribute('data-partial', 'true');
      await expect(outcome).toContainText('2 countries changed since this file was built: EE and IE. Nothing was written for them. The Worker answered 207');
      await expect(sheet.getByTestId('pricing-import-conflict')).toHaveText([/^EE27/, /^IE14/]);
      await expect(sheet.getByTestId('pricing-import-rebuild')).toContainText('rebuild the file for EE, IE');
      await expect(sheet.getByRole('button', { name: /^Import \d+ observations$/ })).toHaveCount(0);
      await shot(page, combo.id, 'import-partial');
      expect(await violations(page, '[role="dialog"]'), 'the partial answer').toEqual([]);
      if (phone) await fits(page);
      await sheet.getByRole('button', { name: 'Back to the catalogue' }).click();
      const again = await toReview(page);
      await expect(again.getByTestId('pricing-import-already-sent')).toBeVisible();
      await expect(again.getByRole('button', { name: 'Import 5 observations' })).toBeDisabled();
      expect(seen.imports).toHaveLength(1);
    });

    test('Import: a refusal shows the Worker\'s sentence and changes nothing; a 502 is no answer', async ({ page }) => {
      const words = 'Some observations have fields to fix; nothing was imported.';
      const { seen } = await install(page, { theme: combo.theme, answers: { import: [
        [400, refusal('invalid_import', words, { rows: [{ row: 1, fields: { value: 'value must be an integer (PPP in whole international dollars, the startup score in thousandths of a point)' } }] })],
        [502, refusal('upstream_unavailable', 'The Worker could not finish this request.')],
      ] } });
      await openCatalogue(page);
      const page0 = await shown(page);
      const reads = { catalogue: seen.catalogue, consistency: seen.consistency };
      const sheet = await toReview(page);
      await sheet.getByLabel(/^Reason/).fill('Annual refresh');
      await sheet.getByRole('button', { name: 'Import 5 observations' }).click();
      const refused = sheet.getByTestId('pricing-import-refused');
      await expect(refused).toContainText(`✕ ${words}`);
      await expect(sheet.getByTestId('pricing-import-row-error')).toHaveText(['2PTvaluevalue must be an integer (PPP in whole international dollars, the startup score in thousandths of a point)']);
      await expect(sheet.getByRole('button', { name: 'Import 5 observations' })).toBeDisabled();
      await expect(sheet.getByLabel(/^Reason/)).toHaveValue('Annual refresh');
      await refused.scrollIntoViewIfNeeded();
      await shot(page, combo.id, 'import-refused');
      expect(await violations(page, '[role="dialog"]'), 'the refusal').toEqual([]);
      if (phone) await fits(page);
      await page.keyboard.press('Escape');
      await expect(sheet).toHaveCount(0);
      expect(seen.catalogue).toBe(reads.catalogue);
      expect(seen.consistency).toBe(reads.consistency);
      await expect(page.getByTestId('pricing-import-reread-note')).toHaveCount(0);
      expect(await shown(page), 'the catalogue reads as it did before the refusal').toBe(page0);
      await expect(page.getByTestId('pricing-live')).toHaveText(words);

      // The same file again (a refusal wrote nothing, so it is not spent): this time no answer comes back.
      const next = await toReview(page);
      await next.getByRole('button', { name: 'Import 5 observations' }).click();
      await expect(next.getByTestId('pricing-import-unknown')).toContainText('did not reach the Worker, so its answer is unknown. Read the catalogue again before sending anything');
      await expect(next.getByRole('button', { name: /^Import \d+ observations$/ })).toHaveCount(0);
      expect(seen.catalogue).toBe(reads.catalogue);
      await next.getByRole('button', { name: 'Read the catalogue again' }).click();
      await expect.poll(() => seen.catalogue).toBe(reads.catalogue + 1);
      const spent = await toReview(page);
      await expect(spent.getByRole('button', { name: 'Import 5 observations' })).toBeDisabled();
      expect(seen.imports).toHaveLength(2);
    });

    test('Record observation: sent once with its source, date and the revision read; the new row is first', async ({ page }) => {
      const { seen } = await install(page, { theme: combo.theme, answers: { record: [[201, { profile: { ...PROFILE, revision: 10 } }]] } });
      await openCountry(page);
      expect(await violations(page, '[data-testid="hq-licence-pricing-country"]'), 'the country').toEqual([]);
      if (phone) await fits(page);
      const sheet = await fillRecord(page);
      await shot(page, combo.id, 'record-form');
      expect(await violations(page, '[role="dialog"]'), 'the record sheet').toEqual([]);
      if (phone) await fits(page);
      const reads = seen.country;
      await sheet.getByRole('button', { name: 'Record observation' }).click();
      await expect(sheet).toHaveCount(0);
      expect(seen.records).toEqual([{ field: 'startup_ecosystem_score', value: 41_250, status: 'recorded', source: 'Source B sample', source_ref: 'edition 4', as_of: '2026-10-01', reason: 'Edition received', expected_revision: 9 }]);
      await expect.poll(() => seen.country).toBe(reads + 1);
      await expect(page.getByTestId('pricing-country-revision')).toHaveText('10');
      await expect(page.getByTestId('pricing-record-written')).toContainText('Startup ecosystem score recorded for Denmark. Revision 10.');
      const first = page.getByTestId('pricing-history-row').first();
      await expect(first).toHaveAttribute('data-new', 'true');
      await expect(first).toBeFocused();
      await expect(first).toContainText('Source B sample · edition 4');
      await expect(first).toContainText('2026-10-01');
      await expect(page.getByTestId('pricing-history-row')).toHaveCount(2);
      await first.scrollIntoViewIfNeeded();
      await shot(page, combo.id, 'record-written');
      expect(await violations(page, '[data-testid="hq-licence-pricing-country"]'), 'after the write').toEqual([]);
      if (phone) await fits(page);
    });

    test('Record observation: a stale revision and a field refusal stay on the sheet, typed values kept', async ({ page }) => {
      const words = 'Denmark changed since you read it, so nothing was saved. Reload it and apply your change again.';
      const { seen, bumpMarket } = await install(page, { theme: combo.theme, answers: { record: [
        [409, refusal('profile_conflict', words, { current_revision: 10 })],
        [400, refusal('invalid_observation', 'The observation has fields to fix.', { fields: { source: 'every observation names its source', as_of: 'as_of must be the YYYY-MM-DD date the value is true as of' } })],
      ] } });
      await openCountry(page);
      const reads = seen.country;
      const sheet = await fillRecord(page);
      await sheet.getByRole('button', { name: 'Record observation' }).click();
      const conflict = sheet.getByTestId('pricing-obs-conflict');
      await expect(conflict).toContainText(`! ${words} It is at revision 10 now. Your typed values are kept below.`);
      await expect(sheet.getByLabel(/^Value/)).toHaveValue('41,250');
      expect(seen.country).toBe(reads);
      await expect(page.getByTestId('pricing-country-revision')).toHaveText('9');
      await shot(page, combo.id, 'record-stale');
      expect(await violations(page, '[role="dialog"]'), 'the stale revision').toEqual([]);
      bumpMarket(10);
      await sheet.getByRole('button', { name: 'Reload Denmark' }).click();
      await expect(sheet.getByTestId('pricing-obs-revision')).toContainText('You are changing revision 10 of Denmark');
      await expect(conflict).toHaveCount(0);
      await sheet.getByRole('button', { name: 'Record observation' }).click();
      await expect(sheet.getByTestId('pricing-obs-refused')).toContainText('✕ The observation has fields to fix. Nothing was saved.');
      const source = sheet.getByLabel('Source', { exact: true });
      await expect(source).toHaveAccessibleDescription('✕ every observation names its source');
      await expect(source).toHaveAttribute('aria-invalid', 'true');
      await expect(source).toBeFocused();
      await expect(sheet.getByLabel(/^As of/)).toHaveAccessibleDescription('✕ as_of must be the YYYY-MM-DD date the value is true as of');
      await expect(sheet.getByLabel(/^Reason/)).toHaveValue('Edition received');
      expect(seen.records.map((b) => b.expected_revision)).toEqual([9, 10]);
      await shot(page, combo.id, 'record-refused');
      expect(await violations(page, '[role="dialog"]'), 'the field refusal').toEqual([]);
      if (phone) await fits(page);
      await expect(page.getByTestId('pricing-history-row')).toHaveCount(1);
    });

    test('the keyboard opens each sheet, focus moves in, and Escape gives it back to the opener', async ({ page }) => {
      await install(page, { theme: combo.theme });
      await openCatalogue(page);
      const opener = page.getByRole('button', { name: 'Import country data…' });
      await opener.focus();
      await page.keyboard.press('Enter');
      const sheet = page.getByRole('dialog', { name: 'Import country data' });
      await expect(sheet).toBeVisible();
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
      for (let i = 0; i < 8; i += 1) {
        await page.keyboard.press('Tab');
        expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]'))), `Tab ${i} left the sheet`).toBe(true);
      }
      await page.keyboard.press('Escape');
      await expect(sheet).toHaveCount(0);
      await expect(opener).toBeFocused();

      await openCountry(page);
      const record = page.getByRole('button', { name: 'Record observation…' });
      await record.focus();
      await page.keyboard.press('Enter');
      const obs = page.getByRole('dialog', { name: 'Record observation' });
      await expect(obs).toBeVisible();
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
      await obs.getByRole('button', { name: 'Close', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(obs).toHaveCount(0);
      await expect(record).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(obs).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(obs).toHaveCount(0);
      await expect(record).toBeFocused();
    });
  });
}
