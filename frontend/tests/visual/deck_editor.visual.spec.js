// D1511 (#3762, deck v2 A18) — visual regression and axe on the integrated
// Pitch deck editor (`harness.jsx`), in the pinned container of
// `.github/workflows/deck-visual.yml`.
//
//   · The matrix: every structure (17, pd10) × every theme the Worker serves
//     (pd7) × both aspects (pd3c): the stage, one screenshot each.
//   · The accepted one-click deck in its picked theme (`fixture.json`, held
//     to the Worker's own build by `deck_visual_fixture_d1511.test.ts`).
//   · axe: zero serious or critical violations on the editor in light and dark
//     (pd0, pd3, pd3-d), along the keyboard path (pd11), with the Ask dialog
//     open (pd4, pd14, pd15), and at phone and tablet widths (pd9k, pd9l).
//
// Baselines are made by CI in the pinned container, never on a laptop: the
// workflow writes any missing one (`--update-snapshots=missing`) and commits
// it to the PR's branch for review; after that every run compares.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ASPECTS, ONE_CLICK, STRUCTURES, THEMES, harness } from './harnessData.js';

const HARNESS = '/tests/visual/harness.html';

async function open(page, data, ready = 'pitch-editor-stage') {
  await page.addInitScript((d) => { window.__DECK_HARNESS__ = d; }, data);
  // Nothing reaches a network: every read is stubbed in the harness, and any other call is refused.
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not in the visual harness"}' }));
  await page.goto(HARNESS);
  await expect(page.getByTestId(ready)).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

for (const theme of THEMES) {
  for (const aspect of ASPECTS) {
    test(`the 17 structures in ${theme} at ${aspect}`, async ({ page }) => {
      await open(page, harness({ theme, aspect }));
      // The strip shows the first cards and folds the rest behind "+ N more cards".
      await expect(page.getByTestId('pitch-editor-rail-0')).toBeVisible();
      const more = page.getByTestId('pitch-editor-more-cards');
      if (await more.count()) await more.click();
      await expect(page.getByTestId(`pitch-editor-rail-${STRUCTURES.length - 1}`)).toBeAttached();
      for (let i = 0; i < STRUCTURES.length; i += 1) {
        await page.getByTestId(`pitch-editor-rail-${i}`).click();
        await expect(page.getByTestId(`pitch-editor-rail-${i}`)).toHaveAttribute('aria-current', 'true');
        await expect(page.getByTestId('pitch-editor-stage')).toHaveScreenshot(`grid-${STRUCTURES[i].id}-${theme}-${aspect.replace(':', 'x')}.png`);
      }
    });
  }
}

test('the accepted one-click deck in its picked theme', async ({ page }) => {
  await open(page, harness({ slides: ONE_CLICK.slides, grid: ONE_CLICK.grid, theme: ONE_CLICK.theme }));
  await expect(page.getByTestId('pitch-editor-stage')).toHaveScreenshot(`oneclick-${ONE_CLICK.theme}.png`);
});

async function noSeriousViolations(page, where, scope = ['pitch-editor-stage', 'pitch-editor-cards']) {
  let axe = new AxeBuilder({ page });
  for (const id of scope) axe = axe.include(`[data-testid="${id}"]`);
  const r = await axe.analyze();
  const serious = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), where).toEqual([]);
}

for (const dark of [false, true]) {
  test(`axe: the editor in ${dark ? 'dark' : 'light'} has no serious violation`, async ({ page }) => {
    await open(page, harness({ dark }));
    await noSeriousViolations(page, 'editor');
  });
}

test('axe: the keyboard path over the Grid, then the Ask dialog, has no serious violation', async ({ page }) => {
  await open(page, harness());
  // The Grid's roving stop: the one area button with tabindex 0 (pd11).
  await page.getByTestId('pitch-editor-blocks').locator('button[tabindex="0"]').focus();
  for (const key of ['ArrowRight', 'ArrowDown', 'Space', 'Shift+ArrowRight', 'Escape', 'ArrowLeft', 'Space']) await page.keyboard.press(key);
  await noSeriousViolations(page, 'after the keyboard path');
  // Space left one area selected: its Ask chip opens the Generate dialog (pd4, pd14, pd15).
  const ask = page.getByTestId('pitch-editor-ask-area');
  await expect(ask).toBeVisible();
  await ask.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const r = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id), 'Ask dialog').toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('the studio home: a screenshot, and no serious axe violation', async ({ page }) => {
  await open(page, harness({ page: 'studio' }), 'pitch-studio-home');
  await expect(page.getByTestId('pitch-studio-home')).toHaveScreenshot('studio-home.png');
  await noSeriousViolations(page, 'studio home', ['pitch-studio-home']);
});

// At phone width the editor draws its list of cards and areas (pd9k), not the stage.
for (const [name, size, ready, scope] of [
  ['phone', { width: 390, height: 844 }, 'pitch-editor-phone', ['pitch-editor-phone']],
  ['tablet', { width: 820, height: 1180 }, 'pitch-editor-stage', ['pitch-editor-stage', 'pitch-editor-cards']],
]) {
  test(`axe: the editor at ${name} width has no serious violation`, async ({ page }) => {
    await page.setViewportSize(size);
    await open(page, harness(), ready);
    await noSeriousViolations(page, name, scope);
  });
}

test('the matrix covers every structure, theme and aspect', () => {
  expect(STRUCTURES.length).toBe(17);
  expect(THEMES.length).toBeGreaterThanOrEqual(3);
  expect([...ASPECTS]).toEqual(['16:9', '4:3']);
});
