/**
 * D8770 (#8770) — template previews in a real browser, on the real Worker's
 * 24 HQ templates (`server.ts` seeds them from `templateLibrary.ts`):
 *
 *   1. the DOM overflow check: every card of every template, in Example and
 *      Blank structure, is laid out at 1920 × 1080 and each area measured by
 *      the browser (`TemplateSlide` → `preflightMeasure.measureBlocks`); no
 *      area may run past its box. The layout is scale-free, so one pass holds
 *      at every width the preview draws (the canvas's 960, 520 and 358);
 *   2. Kitchen Table: the Example opens first, marked, with the traction chart
 *      plotted (not "Line chart" in words); the Solution heading is whole;
 *      Open full size moves with ← → and reads the slide as text;
 *   3. Use this template posts only the venture, and the proposal it makes
 *      carries none of the example's words or figures;
 *   4. at 390 px nothing scrolls sideways;
 *   5. a headline too long for its area is caught by the same measurement,
 *      said under the card ("Text runs past its area") and offered full size.
 *
 * D8770 part 3 (PTP08, PTP16, PTP20 to PTP25):
 *   6. below 1024 px the preview is a sheet over the covers, with one card,
 *      Preview all N slides and Use this template at its foot; full size is
 *      "3 of 13 · Traction"; Kitchen Table's chrome, double rules and the
 *      library's grain and lightbulb are drawn;
 *   7. a preview whose cards could not be read offers Try again, and Use this
 *      template appears only once they read;
 *   8. a template the example covers none of opens on its blank structure,
 *      with Example unavailable.
 *
 * Screenshots are written next to the run's results for a person to compare
 * with the PTP boards (the visual snapshots); the overflow check is the gate.
 */
import { test, expect } from '@playwright/test';
import { prepare } from './_editor.mjs';

const KT = 'tpl_hq_kitchen_table';

/**
 * Waits until every card in `scope` has been measured, then names the ones
 * that overflow: those the preview flagged, and, read straight from the DOM
 * here as a cross-check, every area whose content is taller or wider than
 * its box.
 */
async function overflowing(scope) {
  await expect.poll(async () => scope.locator('[data-measured="false"]').count(), { timeout: 20_000 }).toBe(0);
  const flagged = await scope.locator('[data-overflow="true"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
  const direct = await scope.locator('[data-testid$="-frame"] [data-testid$="-grid"] > div').evaluateAll((els) => els
    .filter((el) => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)
    .map((el) => `${el.closest('[data-measured]')?.getAttribute('data-testid')} ${el.getAttribute('data-testid')}`));
  return [...flagged, ...direct];
}

test('no card of the 24 templates runs past its area, in Example or Blank structure', async ({ page, request }) => {
  test.setTimeout(600_000);
  const m = await prepare(page, request);
  await page.goto(`/raise/pitch/templates?project_id=${m.oneClick.projectId}`);
  const tiles = page.locator('[data-testid^="pitch-templates-tile-"]');
  await expect(tiles).toHaveCount(24);
  const ids = await tiles.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid').replace('pitch-templates-tile-', '')));
  const found = [];
  for (const id of ids) {
    await page.getByTestId(`pitch-templates-tile-${id}`).click();
    await page.getByTestId('pitch-templates-all').click();
    const dialog = page.getByTestId('pitch-templates-all-dialog');
    for (const view of ['example', 'blank']) {
      await dialog.getByTestId(`pitch-templates-all-view-${view}`).click();
      await expect(dialog.locator(`[data-view="${view === 'example' ? 'example' : 'blank'}"]`).first()).toBeVisible();
      for (const t of await overflowing(dialog)) found.push(`${id} ${view} ${t}`);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  }
  expect(found).toEqual([]);
});

for (const width of [1440, 390]) {
  test(`Kitchen Table: Example first, a plotted chart, a whole heading and full size at ${width}px`, async ({ page, request }, testInfo) => {
    const m = await prepare(page, request);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/raise/pitch/templates?project_id=${m.oneClick.projectId}`);
    await page.getByTestId(`pitch-templates-tile-${KT}`).click();
    // D8770 part 3: below 1024 px the preview is a sheet over the covers (PTP21).
    const aside = page.getByTestId(width < 1024 ? 'pitch-templates-sheet' : 'pitch-templates-preview');
    await expect(aside.getByTestId('pitch-templates-view-example')).toHaveAttribute('aria-pressed', 'true');
    await expect(aside.getByTestId('pitch-templates-sets')).toContainText('Lora · Inter · IBM Plex Mono');
    const traction = aside.getByTestId('pitch-templates-card-2');
    await expect(traction.locator('[data-plan="panels"]')).toHaveCount(1);
    await expect(traction).not.toContainText('Line chart');
    await expect(traction.getByTestId('pitch-templates-card-2-badge')).toHaveText('Example · fictional figures');
    expect(await overflowing(aside)).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`kitchen-table-aside-${width}.png`), fullPage: true });

    await page.getByTestId('pitch-templates-all').click();
    const dialog = page.getByTestId('pitch-templates-all-dialog');
    await dialog.getByTestId('pitch-templates-all-view-blank').click();
    const solution = dialog.getByTestId('pitch-templates-all-3');
    await expect(solution).toContainText('[What the model does; what a person keeps]');
    expect(await overflowing(dialog)).toEqual([]);
    // Scaled, not re-laid: the frame is 1920 wide at every size.
    const frame = await solution.getByTestId('pitch-templates-all-3-frame').evaluate((el) => ({ w: el.offsetWidth, scale: Number(el.getAttribute('data-scale')), shown: el.parentElement.getBoundingClientRect().width }));
    expect(frame.w).toBe(1920);
    expect(Math.abs(frame.scale * 1920 - frame.shown)).toBeLessThan(1.5);
    await page.screenshot({ path: testInfo.outputPath(`kitchen-table-blank-${width}.png`), fullPage: true });

    await dialog.getByTestId('pitch-templates-all-view-example').click();
    await dialog.getByTestId('pitch-templates-all-2-open').click();
    const full = page.getByTestId('template-full');
    await expect(full).toContainText('3 of 13 · Traction');
    await expect(full.getByTestId('template-read-takeaway')).toHaveText('MRR grew 2.5× in five months');
    await expect(full.getByTestId('template-read-table')).toContainText('Nov 2026');
    await expect(full.getByTestId('template-read-source')).toContainText('sample, fictional');
    await expect(full.getByTestId('template-read-blank')).toContainText('[MRR]');
    await page.screenshot({ path: testInfo.outputPath(`kitchen-table-full-${width}.png`), fullPage: true });
    await page.keyboard.press('ArrowRight');
    await expect(full).toContainText('4 of 13 · Solution');
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test('a headline too long for its area is measured, said and offered at full size', async ({ page, request }) => {
  const m = await prepare(page, request);
  const LONG = 'A deliberately long synthetic headline that keeps going well past the two lines its area can hold at export size';
  await page.route(`**/api/decks/templates/${KT}`, async (route) => {
    const json = await (await route.fetch()).json();
    const head = json.cards[3].blocks.find((b) => b.id === 'H');
    head.text = LONG;
    await route.fulfill({ json });
  });
  await page.goto(`/raise/pitch/templates?project_id=${m.oneClick.projectId}`);
  await page.getByTestId(`pitch-templates-tile-${KT}`).click();
  await page.getByTestId('pitch-templates-all').click();
  const dialog = page.getByTestId('pitch-templates-all-dialog');
  await dialog.getByTestId('pitch-templates-all-view-blank').click();
  const card = dialog.getByTestId('pitch-templates-all-3');
  await expect(card).toHaveAttribute('data-measured', 'true');
  await expect(card).toHaveAttribute('data-overflow', 'true');
  await expect(card.getByTestId('pitch-templates-all-3-runs-past')).toHaveText('Text runs past its area');
  await expect(card.getByTestId('pitch-templates-all-3-open')).toBeVisible();
  // Every other card still fits.
  expect((await overflowing(dialog)).filter((t) => !t.includes('pitch-templates-all-3'))).toEqual([]);
});

test('Use this template posts only the venture, and the proposal carries none of the example', async ({ page, request }) => {
  const m = await prepare(page, request);
  const posts = [];
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/api/decks/templates/')) posts.push(r.postDataJSON()); });
  const applied = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`/api/decks/templates/${KT}/apply`));
  await page.goto(`/raise/pitch/templates?project_id=${m.oneClick.projectId}`);
  await page.getByTestId(`pitch-templates-tile-${KT}`).click();
  await expect(page.getByTestId('pitch-templates-card-2').locator('[data-plan="panels"]')).toHaveCount(1);
  await page.getByTestId('pitch-templates-use').click();
  await expect(page.getByTestId('pitch-templates-not-carried')).toContainText('[Larder Lane]');
  await page.getByTestId('pitch-templates-confirm').click();
  const body = await (await applied).text();
  expect(posts).toEqual([{ project_id: m.oneClick.projectId }]);
  for (const word of ['Larder Lane', 'fictional', '10600', '$10.6k', 'Ada Mensah']) expect(body).not.toContain(word);
});

test('at 390 px the preview is a sheet: one card in the template’s chrome and decor, Preview all 13 slides, Use this template at its foot', async ({ page, request }, testInfo) => {
  const m = await prepare(page, request);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/raise/pitch/templates?project_id=${m.oneClick.projectId}`);
  await expect(page.getByTestId('pitch-templates-preview')).toHaveCount(0);
  // The preview reads the elements library once, with the one icon Kitchen Table names.
  const iconsRead = page.waitForResponse((r) => r.url().includes('/api/decks/elements/icons?refs=lightbulb'));
  await page.getByTestId(`pitch-templates-tile-${KT}`).click();
  const icons = await (await iconsRead).json();
  const sheet = page.getByTestId('pitch-templates-sheet');
  await expect(sheet).toBeVisible();
  await expect(page.getByTestId('pitch-templates-sheet-layer')).toHaveAttribute('data-phone', 'sheet');
  await expect(sheet.locator('[data-testid^="pitch-templates-card-"][data-measured]')).toHaveCount(1);
  const card = sheet.getByTestId('pitch-templates-card-2');
  await expect(card.getByTestId('pitch-templates-card-2-chrome-top')).toHaveText('Larder Lane · Traction');
  await expect(card.getByTestId('pitch-templates-card-2-footer-rule')).toHaveCount(1);
  await expect(card.locator('[data-kind="divider"][data-style="double"]')).toHaveCount(1);
  expect(await overflowing(sheet)).toEqual([]);
  // Use this template is pinned to the sheet's foot, at least 44 px tall.
  const use = sheet.locator('footer').getByTestId('pitch-templates-use');
  await expect(use).toBeVisible();
  expect((await use.boundingBox()).height).toBeGreaterThanOrEqual(44);
  expect((await sheet.getByTestId('pitch-templates-card-2-open').boundingBox()).height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: testInfo.outputPath('kitchen-table-sheet-390.png') });

  await expect(sheet.getByTestId('pitch-templates-all')).toHaveText('Preview all 13 slides');
  await sheet.getByTestId('pitch-templates-all').click();
  const dialog = page.getByTestId('pitch-templates-all-dialog');
  // Why now: the library's grain and lightbulb, in the template's tones.
  const why = dialog.getByTestId('pitch-templates-all-4');
  await expect(why.locator('img[data-kind="texture"]')).toHaveCount(1);
  // The icon is drawn when the Worker can read the icon set; when it cannot (`unreadable`), it is left out, never a broken image.
  await expect(why.locator('img[data-kind="icon"]')).toHaveCount(icons.unreadable ? 0 : 1);
  await dialog.getByTestId('pitch-templates-all-2-open').click();
  const full = page.getByTestId('template-full');
  await expect(full.locator('h2')).toHaveText('3 of 13 · Traction');
  await expect(full.getByTestId('template-full-hint')).toHaveText('Turn the phone for a larger slide · pinch to zoom');
  await page.screenshot({ path: testInfo.outputPath('kitchen-table-full-390-phone.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('a preview whose cards could not be read offers Try again; Use this template waits for the cards', async ({ page, request }) => {
  const m = await prepare(page, request);
  // Every read of Kitchen Table's cards fails until the store is "back".
  let down = true;
  await page.route(`**/api/decks/templates/${KT}`, async (route) => {
    if (down) { await route.fulfill({ status: 500, json: { detail: 'synthetic failure' } }); return; }
    await route.fallback();
  });
  await page.goto(`/raise/pitch/templates?project_id=${m.oneClick.projectId}`);
  await page.getByTestId(`pitch-templates-tile-${KT}`).click();
  const aside = page.getByTestId('pitch-templates-preview');
  await expect(aside.getByTestId('pitch-templates-preview-error')).toContainText('This template’s cards could not be read.');
  await expect(aside.getByTestId('pitch-templates-use')).toHaveCount(0);
  down = false;
  await aside.getByTestId('pitch-templates-preview-retry').click();
  await expect(aside.getByTestId('pitch-templates-card-2').locator('[data-plan="panels"]')).toHaveCount(1);
  await expect(aside.getByTestId('pitch-templates-use')).toBeVisible();
});

test('a template the example covers none of opens on its blank structure, with Example unavailable', async ({ page, request }) => {
  const m = await prepare(page, request);
  await page.route(`**/api/decks/templates/${KT}`, async (route) => {
    const json = await (await route.fetch()).json();
    json.cards = json.cards.map((c, i) => ({ ...c, title: `Renamed card ${i + 1}` }));
    await route.fulfill({ json });
  });
  await page.goto(`/raise/pitch/templates?project_id=${m.oneClick.projectId}`);
  await page.getByTestId(`pitch-templates-tile-${KT}`).click();
  const aside = page.getByTestId('pitch-templates-preview');
  await expect(aside.getByTestId('pitch-templates-view-blank')).toHaveAttribute('aria-pressed', 'true');
  await expect(aside.getByTestId('pitch-templates-view-example')).toBeDisabled();
  await expect(aside.getByTestId('pitch-templates-example-note-unavailable')).toContainText('Example unavailable');
  await expect(aside.locator('[data-view="example"]')).toHaveCount(0);
  await expect(aside).not.toContainText('Larder Lane');
});
