/** #4705: keyboard/focus and phone checks against a local Vite fixture; no live account. */
import { test, expect } from '@playwright/test';
for (const width of [1440, 390]) test(`studio creation recovery and keyboard entry at ${width}px`, async ({ page, baseURL }) => {
  await page.setViewportSize({ width, height: 1000 });
  await page.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL).origin ? route.continue() : route.abort());
  await page.goto('/tests/e2e/pipeline_4705.html');
  const opener = page.getByRole('button', { name: 'New Pipeline Startup', exact: true });
  await opener.focus();
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog', { name: 'New Pipeline Startup', exact: true });
  await expect(sheet).toBeVisible();
  await expect.poll(() => sheet.evaluate(el => el.contains(document.activeElement))).toBe(true);
  for (const [label, value] of [['Name *', 'Keep startup'], ['Sector', 'health'], ['Description', 'Draft description'], ['Problem', 'Draft problem'], ['Solution', 'Draft solution']]) {
    await sheet.getByText(label, { exact: true }).click();
    await expect(sheet.getByLabel(label, { exact: true })).toBeFocused();
    await sheet.getByLabel(label, { exact: true }).fill(value);
  }
  await sheet.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(sheet.getByRole('alert')).toContainText('The startup could not be created.');
  await expect(sheet.getByText('synthetic-raw-detail')).toHaveCount(0);
  await expect(sheet.getByLabel('Name *', { exact: true })).toHaveValue('Keep startup');
  await expect(sheet.getByRole('textbox', { name: 'Solution', exact: true })).toHaveValue('Draft solution');
  await sheet.getByRole('button', { name: 'Create', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect.poll(() => sheet.evaluate(el => el.contains(document.activeElement))).toBe(true);
  await page.screenshot({ path: test.info().outputPath(`creation-${width}.png`), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(opener).toBeFocused();
  const startup = page.getByRole('button', { name: 'Open Synthetic startup', exact: true });
  await startup.focus();
  await page.keyboard.press('Space');
  const detail = page.getByRole('dialog', { name: 'Synthetic startup', exact: true });
  await expect(detail).toBeVisible();
  await expect(detail.getByRole('button', { name: 'MVP Dev', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(startup).toBeFocused();
});
