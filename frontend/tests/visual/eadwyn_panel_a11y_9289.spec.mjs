/**
 * D9289 (#9289): the Eadwyn chat on the founder's Studio, in Chromium, on the
 * real Worker and the built SPA. Only `/api/advisor/start` is changed, to make
 * the active question long; every other read is the Worker's.
 *
 *   · 390 px, long question and long answer: the composer is named, grows
 *     with its text and keeps two lines with the keyboard's height taken off
 *     the window; the question wraps to two lines; nothing is wider than the
 *     window. A screenshot is written to the test's output folder (and to
 *     `EADWYN_EVIDENCE_DIR` when set); there is no baseline.
 *   · 1440 px: the panel's tabs by arrow, Home and End, with focus following
 *     and `aria-controls` naming the drawn panel, Tab into that panel; the
 *     fullscreen view keeps Tab inside and gives focus back on Escape.
 *
 * No answer is sent, so nothing is written.
 */
import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { prepare } from './_editor.mjs';

test.setTimeout(120_000);

const QUESTION = 'Before we go any further, which customer segment would you serve first, what do they pay for today instead, and why would they switch to you within the next two quarters?';
const ANSWER = 'Independent veterinary clinics with two to five vets. Today they pay for a practice-management suite and a part-time bookkeeper; '
  + 'they would switch because our scheduling cuts no-shows by a third and the reconciliation runs itself, which saves the bookkeeper a day a week.';

async function openStudio(page, request, { width, height }) {
  await prepare(page, request);
  await page.setViewportSize({ width, height });
  await page.route('**/api/advisor/start', async (route) => {
    const res = await route.fetch();
    const body = await res.json().catch(() => ({}));
    const q = body?.next_question || { id: 'synthetic-9289', skip_allowed: true };
    await route.fulfill({ response: res, json: { ...body, complete: false, next_question: { ...q, prompt: QUESTION } } });
  });
  await page.goto('/studio');
  const field = page.getByRole('textbox', { name: 'Message Eadwyn' });
  await expect(field).toBeVisible({ timeout: 60_000 });
  await page.waitForLoadState('networkidle');
  return field;
}

const lines = (box, lineHeight) => Math.round(box.height / lineHeight);

test('390 px: the composer grows with a long answer and keeps two lines; the long question wraps to two', async ({ page, request }, testInfo) => {
  const field = await openStudio(page, request, { width: 390, height: 844 });
  const question = page.getByTestId('eadwyn-current-question').first();
  await expect(question).toBeVisible();
  await expect(question).toContainText(QUESTION.slice(0, 40));
  // Two lines, not one cut line: the clamp is 2 and the box is two lines tall.
  const q = await question.evaluate((el) => ({
    clamp: getComputedStyle(el).webkitLineClamp, line: parseFloat(getComputedStyle(el).lineHeight), h: el.getBoundingClientRect().height,
  }));
  expect(q.clamp).toBe('2');
  expect(Math.round(q.h / q.line)).toBe(2);

  const empty = await field.boundingBox();
  const lineHeight = await field.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
  expect(empty.height, 'two visible lines while empty, so the placeholder fits').toBeGreaterThanOrEqual(2 * lineHeight + 16);
  await field.fill(ANSWER);
  const full = await field.boundingBox();
  expect(full.height, 'it grew with the text').toBeGreaterThan(empty.height + lineHeight);
  expect(full.height, 'up to its cap').toBeLessThanOrEqual(161);
  expect(lines(full, lineHeight)).toBeGreaterThanOrEqual(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'nothing wider than the phone').toBe(true);
  const shot = testInfo.outputPath('eadwyn-composer-390-long.png');
  await page.screenshot({ path: shot, fullPage: false });
  if (process.env.EADWYN_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.EADWYN_EVIDENCE_DIR, 'eadwyn-composer-390-long.png') });

  // The keyboard open: the window loses the keyboard's height. The field, in
  // view, still shows at least two whole lines.
  await page.setViewportSize({ width: 390, height: 500 });
  await field.focus();
  await field.evaluate((el) => el.scrollIntoView({ block: 'end' }));
  const open = await field.boundingBox();
  expect(open.y).toBeGreaterThanOrEqual(0);
  expect(open.y + open.height).toBeLessThanOrEqual(500);
  expect(open.height).toBeGreaterThanOrEqual(2 * lineHeight + 16);
});

test('1440 px: the panel tabs answer the arrows, Home and End; fullscreen holds focus and gives it back', async ({ page, request }) => {
  await openStudio(page, request, { width: 1440, height: 900 });
  const strip = page.getByRole('tablist', { name: 'Eadwyn panel' });
  const tab = (name) => strip.getByRole('tab', { name, exact: true });
  await expect(tab('Conversation')).toHaveAttribute('aria-selected', 'true');
  await tab('Conversation').focus();

  const expectSelected = async (name) => {
    const t = tab(name);
    await expect(t).toHaveAttribute('aria-selected', 'true');
    await expect(t).toBeFocused();
    await expect(t).toHaveAttribute('tabindex', '0');
    const panel = await t.getAttribute('aria-controls');
    expect(panel).toBeTruthy();
    await expect(page.locator(`[id="${panel}"]`)).toHaveAttribute('role', 'tabpanel');
    await expect(page.locator(`[id="${panel}"]`)).toHaveAttribute('aria-labelledby', await t.getAttribute('id'));
    await expect(strip.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
  };
  await page.keyboard.press('ArrowRight');
  await expectSelected('Tasks');
  await page.keyboard.press('End');
  await expectSelected('My tickets');
  await page.keyboard.press('ArrowRight');
  await expectSelected('Conversation');
  await page.keyboard.press('ArrowLeft');
  await expectSelected('My tickets');
  await page.keyboard.press('Home');
  await expectSelected('Conversation');
  await page.keyboard.press('Tab');
  const panelId = await tab('Conversation').getAttribute('aria-controls');
  await expect(page.locator(`[id="${panelId}"]`)).toBeFocused();

  // Fullscreen: in by keyboard, Tab stays inside, Escape gives focus back.
  const opener = page.getByTestId('eadwyn-fullscreen-open');
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Eadwyn AI' });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  for (let i = 0; i < 25; i += 1) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((el) => el.contains(document.activeElement)), `Tab ${i + 1} stayed inside`).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('eadwyn-fullscreen-open')).toBeFocused();
});
