/**
 * D7176 (#7176, canvas D7042 boards RS-14 A2 to F): a saved competitor analysis
 * at a desk, a tablet and a phone, in light and dark. The dossier draws its
 * kinds and save line; a typed title survives a refresh; the rerun review
 * opens and Cancel returns to the draft; a failed export keeps the dossier and
 * downloads nothing; no page is wider than the screen. Every /api/competitors
 * read is answered here; every name and figure is made up.
 *
 *   npm run build   (repo root)
 *   cd frontend && npx --no-install playwright test -c tests/visual/playwright.config.mjs research_saved_analyses_7176.spec.mjs
 */
import { test, expect } from '@playwright/test';
import { prepare } from './_editor.mjs';
test.setTimeout(90_000);

const RECORD = {
  id: 'an-7176', title: 'Sample analysis title', status: 'complete', mode: 'custom', version: 3, edited: true,
  created_at: '2026-11-09T10:00:00.000Z', updated_at: '2026-11-16T14:02:00.000Z',
  inputs: { market: 'Sample market', depth: 'quick' },
  output: { market_summary: 'A sample summary of the market.', gaps: ['Sample gap one'], wedge: 'A sample wedge.', next_actions: ['Sample step'], notes: 'Sample notes.', conclusion: 'Sample conclusion.' },
  sections_edited: { market_summary: '2026-11-14T10:00:00.000Z' },
  candidates: [
    { id: 'c1', name: 'Sample Rival A', domain: 'rival-a.example', category: 'direct', origin: 'discovered', relevance_score: 70, summary: 'Sample summary A' },
    { id: 'c2', name: 'Sample Rival B', domain: 'rival-b.example', category: 'adjacent', origin: 'known', relevance_score: 55, summary: 'Sample summary B' },
    { id: 'c3', name: 'Sample By Hand', domain: 'by-hand.example', category: 'direct', origin: 'manual', relevance_score: null, summary: 'Added by hand' },
  ],
  sources: [
    { id: 's1', candidate_id: 'c1', url: 'https://rival-a.example', title: 'Rival A', kind: 'site', status: 200, origin: 'fetched', fetched_at: '2026-11-12T09:40:00.000Z' },
    { id: 's2', candidate_id: 'c1', url: 'https://rival-a.example/pricing', title: 'Rival A pricing', kind: 'pricing', status: 200, origin: 'fetched', fetched_at: '2026-11-12T09:40:00.000Z' },
    { id: 's3', candidate_id: 'c3', url: 'https://press.example/sample-news', title: 'Sample press note', kind: 'news', status: 200, origin: 'manual', fetched_at: '2026-11-14T10:12:00.000Z' },
  ],
  signals: [],
};
const PROPOSAL = {
  proposal_id: 'p-7176', base_version: 3,
  candidates: { add: [{ id: 'n1', name: 'Sample Newcomer', domain: 'new.example', category: 'direct', origin: 'discovered', relevance_score: 60 }], remove: [{ id: 'c2', name: 'Sample Rival B', category: 'adjacent', origin: 'known' }] },
  output: {
    market_summary: { now: 'A sample summary of the market.', proposed: 'A rewritten sample summary.', changed: true, edited_at: '2026-11-14T10:00:00.000Z' },
    wedge: { now: 'A sample wedge.', proposed: 'A sharper sample wedge.', changed: true, edited_at: null },
    gaps: { now: ['Sample gap one'], proposed: ['Sample gap one'], changed: false, edited_at: null },
  },
  kept: { manual_candidates: [{ id: 'c3', name: 'Sample By Hand' }], manual_sources: ['https://press.example/sample-news'] },
};

async function open(page, request, width, theme) {
  await prepare(page, request);
  await page.setViewportSize({ width, height: 900 });
  if (theme === 'dark') await page.route('**/api/settings/appearance', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: { theme: 'dark' } }) : route.continue()));
  await page.route('**/api/competitors/an-7176', (route) => route.fulfill({ json: RECORD }));
  await page.route('**/api/competitors/an-7176/refresh', (route) => route.fulfill({ json: { ...RECORD, refresh: { at: '2026-11-16T14:20:00.000Z', checked: 3, fetched: 2, not_fetched: 1, results: [{ id: 's1', ok: true, status: 200 }, { id: 's2', ok: false, status: 503 }, { id: 's3', ok: true, status: 200 }] } } }));
  await page.route('**/api/competitors/an-7176/rerun', (route) => route.fulfill({ json: PROPOSAL }));
  await page.route('**/api/competitors/an-7176/export*', (route) => route.fulfill({ status: 503, contentType: 'text/html', body: '<h1>Service Unavailable</h1>' }));
  await page.goto('/research/companies/an-7176');
  await expect(page.getByTestId('company-analysis')).toBeVisible();
  await expect(page.getByLabel('Analysis title')).toHaveValue('Sample analysis title');
  if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/);
}

const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

for (const width of [1440, 768, 390]) {
  for (const theme of ['light', 'dark']) {
    test(`saved analysis at ${width}px in ${theme}: kinds, save line, refresh keeps the draft, review, failed export`, async ({ page, request }, testInfo) => {
      await open(page, request, width, theme);
      await expect(page.getByTestId('analysis-legend')).toBeVisible();
      await expect(page.getByTestId('analysis-yours')).toContainText('never written by a run');
      await page.getByLabel('Analysis title').fill('Typed, not saved');
      const phone = width < 768;
      await expect(page.getByTestId(phone ? 'analysis-phone-bar' : 'analysis-actions')).toBeVisible();
      expect(await noSideScroll(page)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`saved-analysis-${width}-${theme}.png`), fullPage: true });

      // Refresh: the typed title stays.
      if (phone) { await page.getByRole('button', { name: 'Actions ⋯' }).click(); await page.getByRole('button', { name: /^Refresh sources/ }).click(); }
      else await page.getByRole('button', { name: 'Refresh sources', exact: true }).click();
      await expect(page.getByTestId('refresh-result')).toContainText('3 checked · 2 fetched again · 1 not fetched');
      await expect(page.getByLabel('Analysis title')).toHaveValue('Typed, not saved');

      // Rerun: the review, then Cancel back to the same draft.
      if (phone) { await page.getByRole('button', { name: 'Actions ⋯' }).click(); await page.getByRole('button', { name: /^Rerun discovery/ }).click(); }
      else await page.getByRole('button', { name: 'Rerun discovery', exact: true }).click();
      await expect(page.getByTestId('rerun-review')).toBeVisible();
      expect(await noSideScroll(page)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`rerun-review-${width}-${theme}.png`), fullPage: true });
      await page.getByRole('button', { name: 'Cancel · keep my draft' }).click();
      await expect(page.getByTestId('rerun-review')).toHaveCount(0);
      await expect(page.getByLabel('Analysis title')).toHaveValue('Typed, not saved');

      // Export with the dirty draft asks first; the saved version's export fails and nothing downloads.
      if (phone) { await page.getByRole('button', { name: 'Actions ⋯' }).click(); await page.getByRole('button', { name: /^Export Markdown/ }).click(); }
      else { await page.getByRole('button', { name: 'Export ▾' }).click(); await page.getByRole('menuitem', { name: /Markdown \(\.md\)/ }).click(); }
      await expect(page.getByTestId('export-decision')).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`export-decision-${width}-${theme}.png`) });
      let downloaded = false;
      page.on('download', () => { downloaded = true; });
      await page.getByRole('button', { name: 'Export saved version 3' }).click();
      await expect(page.getByTestId('export-failed')).toContainText('Nothing was downloaded.');
      expect(downloaded).toBe(false);
      await expect(page.getByLabel('Analysis title')).toHaveValue('Typed, not saved');
      expect(await noSideScroll(page)).toBe(true);
    });
  }
}
