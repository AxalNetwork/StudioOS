/**
 * D1511 (#3762, deck v2 A18) — visual regression of the integrated editor at
 * HEAD (`/raise/pitch/edit`, `PitchEditor.jsx`), on the real Worker and the
 * fake AI binding (`server.ts`).
 *
 *   the matrix     every structure of the catalogue (pd10, 17) × every theme
 *                  of `BASE_THEMES` (pd7; six since #3769) ×
 *                  both slide sizes (pd3c, 16:9 and 4:3): the card face
 *                  (`pitch-editor-card`) as GridStage draws it
 *   the editor     pd0 / pd3 light, pd3-d dark, the grid overlay, a
 *                  selection with SELBAR and the instruction box (pd11), the
 *                  area lightbox (pd4), ⋯ (DeckMoreMenu), the deck's Ask,
 *                  Studio home, and the phone and tablet widths (pd9k, pd9l)
 *   the one-click  the accepted deck of the one-click build, every card, in
 *                  its picked theme (Neutral light: no base version, no kit)
 *
 * The axes are read, never counted here: themes from `BASE_THEMES`, sizes
 * from `ASPECTS`, structures from `STRUCTURES` (the frontend's mirror, held to
 * the Worker's by deck_grid_d1499), so a new theme is a new column of
 * baselines and nothing else changes. The first test holds all three to the
 * objects the server imported from the Worker.
 */
import { test, expect } from '@playwright/test';
import { ASPECTS, STRUCTURES } from '../../src/pages/raise/pitch/gridModel.js';
import { THEMES, manifest, openEditor, prepare, showCard } from './_editor.mjs';

const slug = (s) => s.replace(':', 'x');
const pad = (n) => String(n).padStart(2, '0');

test('the matrix reads its axes from the catalogue and the server seeded each cell', async ({ request }) => {
  const m = await manifest(request);
  expect(m.themes).toEqual(THEMES);
  expect(m.aspects).toEqual([...ASPECTS]);
  expect(m.structures).toEqual(STRUCTURES.map((s) => s.id));
  expect(STRUCTURES).toHaveLength(17);
  expect(m.matrix).toHaveLength(THEMES.length * ASPECTS.length);
});

for (const theme of THEMES) {
  for (const aspect of ASPECTS) {
    test(`matrix · ${theme} · ${aspect}: the ${STRUCTURES.length} structures`, async ({ page, request }) => {
      const m = await prepare(page, request);
      const cell = m.matrix.find((x) => x.theme === theme && x.aspect === aspect);
      await openEditor(page, cell.projectId);
      await expect(page.getByTestId('pitch-editor-card')).toHaveAttribute('data-aspect', aspect);
      for (const [i, s] of STRUCTURES.entries()) {
        await showCard(page, i);
        await page.mouse.move(0, 0);
        await expect(page.getByTestId('pitch-editor-htb')).toHaveCount(0);
        await expect.soft(page.getByTestId('pitch-editor-card'), `${theme} ${aspect} ${s.id}`)
          .toHaveScreenshot(`matrix-${theme}-${slug(aspect)}-${pad(i + 1)}-${s.id}.png`);
      }
    });
  }
}

test('the one-click deck, accepted, every card in its picked theme', async ({ page, request }) => {
  const m = await prepare(page, request);
  expect(m.oneClick.theme).toBe('neutral_light');
  await openEditor(page, m.oneClick.projectId);
  for (let i = 0; i < m.oneClick.cards; i += 1) {
    await showCard(page, i);
    await page.mouse.move(0, 0);
    await expect.soft(page.getByTestId('pitch-editor-card')).toHaveScreenshot(`one-click-${pad(i + 1)}.png`);
  }
});

test.describe('the integrated editor', () => {
  test('pd0 / pd3: the editor in light, and the grid overlay', async ({ page, request }) => {
    const m = await prepare(page, request);
    await openEditor(page, m.matrix[0].projectId);
    await page.mouse.move(0, 0);
    await expect(page.getByTestId('pitch-editor')).toHaveScreenshot('editor-light.png');
    await page.getByTestId('pitch-editor-grid-toggle').click();
    await expect(page.getByTestId('pitch-editor-grid-overlay')).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(page.getByTestId('pitch-editor-stage')).toHaveScreenshot('editor-grid-overlay.png');
  });

  test('pd11: two areas selected — SELBAR and the instruction box', async ({ page, request }) => {
    const m = await prepare(page, request);
    await openEditor(page, m.matrix[0].projectId);
    const hero = STRUCTURES.findIndex((s) => s.id === 'hero_3');
    await showCard(page, hero);
    await page.getByTestId('pitch-editor-block-b2').click();
    await page.getByTestId('pitch-editor-block-b3').click({ modifiers: ['Shift'] });
    await expect(page.getByTestId('pitch-editor-selbar')).toBeVisible();
    await expect(page.getByTestId('pitch-instruction-field')).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(page.getByTestId('pitch-editor-stage')).toHaveScreenshot('editor-selection.png');
    await expect(page.getByTestId('pitch-instruction')).toHaveScreenshot('instruction-box.png');
  });

  test('pd4: the area lightbox', async ({ page, request }) => {
    const m = await prepare(page, request);
    await openEditor(page, m.matrix[0].projectId);
    await page.getByTestId('pitch-editor-block-b1').click();
    await page.getByTestId('pitch-editor-ask-area').click();
    await expect(page.getByTestId('pitch-areas-generate')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('pitch-areas')).toHaveScreenshot('area-lightbox.png');
  });

  test('the toolbar: ⋯ (DeckMoreMenu) and the deck\'s Ask', async ({ page, request }) => {
    const m = await prepare(page, request);
    await openEditor(page, m.matrix[0].projectId);
    await page.getByTestId('deck-more-open').click();
    await expect(page.getByTestId('deck-more')).toHaveScreenshot('deck-more-menu.png');
    await page.keyboard.press('Escape');
    await page.getByTestId('pitch-ask').click();
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('pitch-header-ask')).toHaveScreenshot('deck-ask.png');
  });

  test('Studio home', async ({ page, request }) => {
    const m = await prepare(page, request);
    await page.goto(`/raise/pitch?project_id=${m.oneClick.projectId}`);
    await expect(page.getByTestId('pitch-studio-home')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await expect(page.getByTestId('pitch-studio-home')).toHaveScreenshot('studio-home.png');
  });

  test('pd9l and pd9k: the tablet and phone widths', async ({ page, request }) => {
    const m = await prepare(page, request);
    await page.setViewportSize({ width: 820, height: 1180 });
    await openEditor(page, m.matrix[0].projectId);
    await page.mouse.move(0, 0);
    await expect(page.getByTestId('pitch-editor-cards')).toHaveAttribute('data-orientation', 'row');
    await expect(page.getByTestId('pitch-editor')).toHaveScreenshot('editor-tablet.png');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/raise/pitch/edit?project_id=${m.matrix[0].projectId}`);
    await expect(page.getByTestId('pitch-editor')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await expect(page.getByTestId('pitch-editor')).toHaveScreenshot('editor-phone.png');
  });
});

test.describe('pd3-d: dark', () => {
  test.beforeEach(async ({ request }) => {
    const m = await manifest(request);
    expect((await request.put('/api/settings/appearance', { headers: { Authorization: `Bearer ${m.token}` }, data: { theme: 'dark' } })).ok()).toBe(true);
  });
  test.afterEach(async ({ request }) => {
    const m = await manifest(request);
    await request.put('/api/settings/appearance', { headers: { Authorization: `Bearer ${m.token}` }, data: { theme: 'light' } });
  });
  test('the editor in dark, on a dark deck', async ({ page, request }) => {
    const m = await prepare(page, request);
    const cell = m.matrix.find((x) => x.theme === 'neutral_dark' && x.aspect === '16:9') ?? m.matrix[0];
    await openEditor(page, cell.projectId);
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.mouse.move(0, 0);
    await expect(page.getByTestId('pitch-editor')).toHaveScreenshot('editor-dark.png');
  });
});
