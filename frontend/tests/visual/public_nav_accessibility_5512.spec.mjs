/** #5512: computed homepage contrast and real keyboard focus through the public Network disclosure. */
import { test, expect } from '@playwright/test';
import { prepare } from './_editor.mjs';

test.setTimeout(60_000);

async function visit(page, request, width = 1440) {
  await prepare(page, request);
  await page.addInitScript(() => { localStorage.removeItem('token'); localStorage.removeItem('user'); });
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/');
  await expect(page.locator('#ax-platform-h')).toBeAttached();
}

const network = (page) => page.getByRole('navigation', { name: 'Main', exact: true }).getByRole('button', { name: 'Network', exact: true });
const overview = (page) => page.locator('.ax-netmenu a[href="/resources"]');
const luminance = (rgb) => rgb.map((v) => v / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);

for (const width of [1440, 390]) {
  test(`every module-count label meets 4.5:1 on its rendered background at ${width}px`, async ({ page, request }, testInfo) => {
    await visit(page, request, width);
    const evidence = [];
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme });
      const readings = await page.locator('.ax-tools-k').evaluateAll((labels) => labels.map((label) => {
        const rgba = (value) => { const values = value.match(/[\d.]+/g).map(Number); return [...values.slice(0, 3), values[3] ?? 1]; };
        const style = getComputedStyle(label);
        for (let node = label; node; node = node.parentElement) {
          const parent = getComputedStyle(node);
          if (parent.backgroundImage !== 'none' || Number(parent.opacity) !== 1) throw new Error('Contrast needs a rendered image/opacity measurement');
          const background = rgba(parent.backgroundColor);
          if (background[3] === 1) return { text: label.textContent.trim(), foreground: rgba(style.color), background, fontSize: style.fontSize };
          if (background[3] !== 0) throw new Error('Contrast needs an alpha-composited background measurement');
        }
        throw new Error('No opaque background found for module-count label');
      }));
      expect(readings.length).toBeGreaterThan(0);
      for (const reading of readings) {
        expect(reading.foreground[3]).toBe(1);
        const ratio = contrast(reading.foreground.slice(0, 3), reading.background.slice(0, 3));
        evidence.push({ width, colorScheme, ...reading, ratio });
        expect(ratio, JSON.stringify(evidence.at(-1))).toBeGreaterThanOrEqual(4.5);
      }
    }
    await testInfo.attach('computed-contrast', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
    await page.locator('.ax-tools-k').first().screenshot({ path: testInfo.outputPath(`module-label-${width}.png`) });
  });
}

test('Enter, Tab, Escape restores the trigger and the next Tab follows document order', async ({ page, request }, testInfo) => {
  await visit(page, request);
  const trigger = network(page);
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Tab');
  await expect(overview(page)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.ax-netmenu')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveCSS('outline-style', 'solid');
  await expect(trigger).toHaveCSS('outline-width', '2px');
  await page.getByRole('navigation', { name: 'Main', exact: true }).screenshot({ path: testInfo.outputPath('network-restored-focus.png') });
  await page.keyboard.press('Tab');
  await expect(page.locator('.ax-nav-actions .ax-lp')).toBeFocused();
});

test('pointer dismissal and Escape outside the disclosure preserve the outside focus', async ({ page, request }) => {
  await visit(page, request);
  const trigger = network(page);
  const lp = page.locator('.ax-nav-actions .ax-lp');
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#ax-hero-h').click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await lp.focus();
  await page.keyboard.press('Escape');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(lp).toBeFocused();
});

test('menu links retain native Enter activation and close on route change', async ({ page, request }) => {
  await visit(page, request);
  const trigger = network(page);
  await trigger.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(overview(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/resources$/);
  await expect(network(page)).toHaveAttribute('aria-expanded', 'false');
});

test('phone navigation retains its burger and native Network link', async ({ page, request }) => {
  await visit(page, request, 390);
  await expect(network(page)).toBeHidden();
  const burger = page.getByRole('button', { name: 'Open menu', exact: true });
  await burger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Close menu', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await page.locator('.ax-mobilemenu a[href="/resources"]').click();
  await expect(page).toHaveURL(/\/resources$/);
  await expect(page.getByRole('button', { name: 'Open menu', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.ax-mobilemenu')).toHaveCount(0);
});
