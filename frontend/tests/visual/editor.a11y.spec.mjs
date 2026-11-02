/**
 * D1511 (#3762, deck v2 A18) — axe-core on the integrated editor, and its
 * keyboard path. Acceptance: ZERO serious or critical violations (WCAG 2.0,
 * 2.1 and 2.2 A and AA rules) in every state the editor's screens draw:
 *
 *   the editor at rest (pd0), with the grid overlay, with a keyboard
 *   selection (pd11), the area lightbox (pd4: a dialog that traps focus and
 *   gives it back), ⋯ (DeckMoreMenu), the deck's Ask, Studio home, dark
 *   (pd3-d), and the tablet and phone widths (pd9l, pd9k).
 *
 * The scan covers the editor's own frame (`pitch-editor`: header, toolbar,
 * Ask, Cards strip, stage, instruction box and the AIRail beside them) and
 * every dialog or menu it opens; the app shell around it (top bar, sidebar)
 * is outside this issue and is not scanned here.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { STRUCTURES } from '../../src/pages/raise/pitch/gridModel.js';
import { manifest, openEditor, prepare, showCard } from './_editor.mjs';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const SCOPES = ['[data-testid="pitch-editor"]', '[data-testid="pitch-studio-home"]', '[role="dialog"]', '[role="menu"]', '[data-testid="pitch-areas-layer"]'];

/** Serious and critical violations in the editor's scopes that are on the page, as one readable line each. */
async function blocking(page) {
  const builder = new AxeBuilder({ page }).withTags(TAGS);
  let any = false;
  for (const s of SCOPES) if (await page.locator(s).count()) { builder.include(s); any = true; }
  expect(any, 'a scope to scan is on the page').toBe(true);
  const r = await builder.analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

test.describe('axe: zero serious or critical violations', () => {
  test('pd0: the editor at rest, and with the grid overlay', async ({ page, request }) => {
    const m = await prepare(page, request);
    await openEditor(page, m.matrix[0].projectId);
    expect(await blocking(page)).toEqual([]);
    await page.getByTestId('pitch-editor-grid-toggle').click();
    await expect(page.getByTestId('pitch-editor-grid-overlay')).toBeVisible();
    expect(await blocking(page)).toEqual([]);
  });

  test('pd11: the keyboard path selects, extends and clears, and the selection scans clean', async ({ page, request }) => {
    const m = await prepare(page, request);
    await openEditor(page, m.matrix[0].projectId);
    await showCard(page, STRUCTURES.findIndex((s) => s.id === 'hero_3'));
    // One tab stop on the stage: the first area. Space selects it; Shift + arrow extends; Escape clears.
    const first = page.getByTestId('pitch-editor-block-b1');
    await first.focus();
    await expect(first).toBeFocused();
    await expect(page.locator('[data-testid^="pitch-editor-block-"][tabindex="0"]')).toHaveCount(1);
    await page.keyboard.press('Space');
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Shift+ArrowDown');
    await expect(page.locator('[data-testid^="pitch-editor-block-"][aria-pressed="true"]')).toHaveCount(2);
    await expect(page.getByTestId('pitch-editor-selbar')).toBeVisible();
    await expect(page.getByTestId('pitch-instruction-field')).toBeVisible();
    expect(await blocking(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid^="pitch-editor-block-"][aria-pressed="true"]')).toHaveCount(0);
  });

  test('pd4: the area lightbox is a dialog that holds focus, scans clean and gives focus back', async ({ page, request }) => {
    const m = await prepare(page, request);
    await openEditor(page, m.matrix[0].projectId);
    await page.getByTestId('pitch-editor-block-b1').click();
    const opener = page.getByTestId('pitch-editor-ask-area');
    await opener.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('pitch-areas-generate')).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(await blocking(page)).toEqual([]);
    // Focus stays inside the dialog however far Tab goes.
    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((d) => d.contains(document.activeElement)), `Tab ${i + 1} stays in the dialog`).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test('the toolbar: ⋯ and the deck\'s Ask', async ({ page, request }) => {
    const m = await prepare(page, request);
    await openEditor(page, m.matrix[0].projectId);
    await page.getByTestId('deck-more-open').click();
    await expect(page.getByTestId('deck-more')).toBeVisible();
    expect(await blocking(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await page.getByTestId('pitch-ask').click();
    await page.waitForLoadState('networkidle');
    expect(await blocking(page)).toEqual([]);
  });

  test('Studio home', async ({ page, request }) => {
    const m = await prepare(page, request);
    await page.goto(`/raise/pitch?project_id=${m.oneClick.projectId}`);
    await expect(page.getByTestId('pitch-studio-home')).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(await blocking(page)).toEqual([]);
  });

  test('pd9l and pd9k: the tablet and phone widths', async ({ page, request }) => {
    const m = await prepare(page, request);
    await page.setViewportSize({ width: 820, height: 1180 });
    await openEditor(page, m.matrix[0].projectId);
    expect(await blocking(page)).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/raise/pitch/edit?project_id=${m.matrix[0].projectId}`);
    await expect(page.getByTestId('pitch-editor')).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(await blocking(page)).toEqual([]);
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
    test('the editor in dark', async ({ page, request }) => {
      const m = await prepare(page, request);
      await openEditor(page, m.matrix.find((x) => x.theme === 'neutral_dark')?.projectId ?? m.matrix[0].projectId);
      await expect(page.locator('html')).toHaveClass(/dark/);
      expect(await blocking(page)).toEqual([]);
    });
  });
});
