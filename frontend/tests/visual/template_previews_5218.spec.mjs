/** #5218: actual New Deck/Gallery renderers, locks, lazy reads and structure on desktop and phone. */
import { test, expect } from '@playwright/test';
import { prepare } from './_editor.mjs';

const slides = [{ id: 'cover', title: 'Cover' }, { id: 'problem', title: 'Problem' }, { id: 'solution', title: 'Solution' }];
const methods = [
  { id: 'yc_seed', key: 'yc_seed', label: 'YC Seed', slide_count: 10, category: 'fundraising', best_for: 'Early investor conversations', slides },
  { id: 'sequoia_classic', key: 'sequoia_classic', label: 'Sequoia Classic', slide_count: 12, category: 'fundraising', locked: true, slides },
  ...Array.from({ length: 8 }, (_, i) => ({ id: `deferred_${i}`, key: 'minimal_seed', label: `Deferred ${i}`, slides })),
  { id: 'unknown', key: 'not_a_renderer', label: 'Unknown renderer', slides },
];
const context = {
  audiences: [{ id: 'seed_fund', label: 'Seed fund', line: 'Traction and market' }], lengths: [{ id: 'standard', label: 'Standard' }],
  cards: [{ card: 'title', title: 'Cover', sources: [] }], standard: { standard: [{ card: 'title', title: 'Cover', purpose: 'Who we are' }] },
  fast_path: { audience: 'seed_fund', length: 'standard' }, averages: {},
};
const stored = { theme: { aspect: '16:9' }, cards: [{ title: 'Stored cover', blocks: [
  { id: 'title', kind: 'text', style: 'heading', text: 'The actual stored cover', grid: { c1: 1, c2: 12, r1: 1, r2: 3 } },
] }, { title: 'Stored second slide', body: 'The saved template structure' }] };

for (const width of [1440, 390]) {
  test(`New Deck previews and gated use at ${width}px`, async ({ page, request }, testInfo) => {
    const m = await prepare(page, request);
    await page.setViewportSize({ width, height: 900 });
    const reads = [];
    const writes = [];
    await page.route('**/api/decks/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() === 'POST') writes.push({ path, body: route.request().postDataJSON() });
      const answer = path.endsWith('/apply-method') ? { error: 'synthetic refusal', code: 'test_refusal' }
        : path.endsWith('/new/context') ? context
        : path.endsWith('/new/quote') ? { ai: false, reason: 'recorded', message: 'No charge' }
          : path.includes('/by-project/') ? { versions: [{ id: 90901, version: 3 }, { id: 90902, version: 2 }] }
            : path.endsWith('/methods') ? { methods }
              : path.endsWith('/recommend') ? { method_id: 'yc_seed', reason: 'Matches this stage' }
                : path.endsWith('/sources') ? { items: [], coverage: { slots: 0, filled: 0, by_grade: {}, not_recorded: 0, unreadable: 0 } }
                  : path.endsWith('/90901') ? { slides: [{ title: 'The real saved version', body: 'Saved content, never fictional data' }] }
                    : path.endsWith('/90902') ? null : undefined;
      if (answer === undefined) return route.continue();
      reads.push(path);
      return route.fulfill({ status: answer === null ? 503 : 200, json: answer || { error: 'unavailable' } });
    });
    await page.goto(`/raise/pitch/new?project_id=${m.oneClick.projectId}`);
    await page.getByTestId('pitch-new-option-version-90901').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('pitch-new-option-version-90901')).toContainText('Saved content, never fictional data');
    await page.getByTestId('pitch-new-option-version-90902').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('pitch-new-option-version-90902')).toContainText('Preview unavailable');
    const yc = page.getByTestId('pitch-new-option-template-yc_seed');
    await yc.scrollIntoViewIfNeeded();
    await expect(yc.getByText('Fictional sample')).toBeVisible();
    await expect(yc.locator('figure > div > div[style*="width: 1920px"]')).toHaveCount(1);
    await expect(page.getByTestId('pitch-new-recommended')).toBeVisible();
    await expect(page.getByTestId('pitch-new-option-template-deferred_7').locator('[style*="width: 1920px"]')).toHaveCount(0);
    await expect(page.getByTestId('pitch-new-option-blank-blank')).toContainText('Empty deck · your own structure');
    await expect(page.getByTestId('pitch-new-option-version-90901')).toContainText('Saved content, never fictional data');
    await expect(page.getByTestId('pitch-new-option-version-90902')).toContainText('Preview unavailable');
    await expect(page.getByTestId('pitch-new-option-version-90901')).not.toContainText('Fictional sample');
    expect(reads.filter((p) => p.endsWith('/90901'))).toHaveLength(1);
    await yc.click();
    await expect(page.getByTestId('pitch-new-template-structure')).toContainText('1. Cover');
    await expect(page.getByTestId('pitch-new-outline')).toHaveCount(0);
    await expect(page.getByTestId('pitch-new-use-template')).toBeEnabled();
    await page.getByTestId('pitch-new-use-template').click();
    await expect(page.getByTestId('pitch-new-dialog')).toContainText('Use this template');
    await page.getByTestId('pitch-new-confirm').click();
    await expect.poll(() => writes.filter((w) => w.path.endsWith('/apply-method')).length).toBe(1);
    expect(writes.find((w) => w.path.endsWith('/apply-method')).body.method_id).toBe('yc_seed');
    expect(writes.some((w) => w.path.endsWith('/outline') || w.path.endsWith('/generate'))).toBe(false);
    await expect(page.getByTestId('pitch-new-dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Preview all slides', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Problem');
    await page.keyboard.press('Escape');
    const locked = page.getByTestId('pitch-new-option-template-sequoia_classic');
    await locked.click();
    await expect(locked.getByText('Fictional sample')).toBeVisible();
    await expect(page.getByTestId('pitch-new-use-template')).toBeDisabled();
    await page.getByTestId('pitch-new-template-structure').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('pitch-new-template-structure')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`selected-template-${width}.png`), fullPage: true });
    await expect(page.getByTestId('pitch-new-outline')).toHaveCount(0);
    await page.getByTestId('pitch-new-option-template-unknown').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('pitch-new-option-template-unknown')).toContainText('Preview unavailable');
    await page.getByTestId('pitch-new-option-blank-blank').click();
    await expect(page.getByTestId('pitch-new-outline')).toBeVisible();
    await yc.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`new-deck-${width}.png`), fullPage: true });
  });

  test(`Gallery renders stored cards and shares visible reads at ${width}px`, async ({ page, request }, testInfo) => {
    const m = await prepare(page, request);
    await page.setViewportSize({ width, height: 900 });
    let detailReads = 0;
    await page.route('**/api/decks/templates**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/preview_fixture')) { detailReads++; return route.fulfill({ json: stored }); }
      return route.fulfill({ json: { templates: [{ uid: 'preview_fixture', name: 'Stored design', card_count: 2 }], filters: {} } });
    });
    await page.goto(`/raise/pitch/templates?project_id=${m.oneClick.projectId}`);
    const tile = page.getByTestId('pitch-templates-tile-preview_fixture');
    await expect(tile.getByText('The actual stored cover')).toBeVisible();
    await tile.click();
    await expect(page.getByTestId('pitch-templates-preview').getByText('The actual stored cover')).toBeVisible();
    expect(detailReads).toBe(1);
    await page.getByRole('button', { name: 'Preview all slides', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('The saved template structure');
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`gallery-${width}.png`), fullPage: true });
  });
}
