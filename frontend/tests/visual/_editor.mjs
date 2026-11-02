/**
 * D1511 (#3762) — what every visual and axe spec does before it looks:
 * signs in with the server's session, pins the clock, answers Google Fonts
 * from `fonts/` (Inter, Roboto Mono and Space Grotesk, OFL; Public Sans and
 * Bricolage Grotesque from the repo's legal-paper fonts), aborts every other
 * request that leaves 127.0.0.1, and opens the editor once its fonts and
 * reads have settled.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';

const FONTS = fileURLToPath(new URL('./fonts/', import.meta.url));
const PAPER = fileURLToPath(new URL('../../../cloudflare-worker/src/templates/legal/paper/', import.meta.url));
const FACES = [
  ['Inter', '100 900', 'normal', `${FONTS}inter-latin-wght-normal.woff2`],
  ['Roboto Mono', '100 700', 'normal', `${FONTS}roboto-mono-latin-wght-normal.woff2`],
  ['Space Grotesk', '300 700', 'normal', `${FONTS}space-grotesk-latin-wght-normal.woff2`],
  ['Public Sans', '400 600', 'normal', `${PAPER}public-sans-400.woff2`],
  ['Public Sans', '700 800', 'normal', `${PAPER}public-sans-700.woff2`],
  ['Public Sans', '400', 'italic', `${PAPER}public-sans-400-italic.woff2`],
  ['Bricolage Grotesque', '700 800', 'normal', `${PAPER}bricolage-grotesque-800.woff2`],
];
const FONT_CSS = FACES.map(([family, weight, style], i) =>
  `@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};font-display:block;src:url(https://fonts.gstatic.com/d1511/${i}.woff2) format('woff2');}`).join('\n');

/**
 * The theme axis: the keys of `BASE_THEMES` in `services/decks/designSystem.ts`,
 * read from its source when the spec loads (the Worker module itself imports
 * JSON that Playwright's loader does not take). The server imports the object,
 * and the matrix's first test holds the two equal, so this read cannot drift.
 */
const DESIGN_SYSTEM = readFileSync(fileURLToPath(new URL('../../../cloudflare-worker/src/services/decks/designSystem.ts', import.meta.url)), 'utf8');
const THEMES_BLOCK = /export const BASE_THEMES[^=]*=\s*\{\n([\s\S]*?)\n\};/.exec(DESIGN_SYSTEM)?.[1] ?? '';
export const THEMES = Object.freeze([...THEMES_BLOCK.matchAll(/^ {2}([a-z_]+): \{/gm)].map((x) => x[1]));
if (!THEMES.length) throw new Error('D1511: BASE_THEMES could not be read from designSystem.ts');

/** The page clock the editor's "Saved · …" chip reads: an hour after every seeded version was saved. */
export const NOW = new Date('2026-10-20T10:00:00Z');

let cached = null;
/** The server's manifest: the session, the matrix ventures and the one-click deck. */
export async function manifest(request) {
  if (!cached) cached = await (await request.get('/__visual/manifest')).json();
  return cached;
}

/** Everything a spec does before its first navigation. */
export async function prepare(page, request) {
  const m = await manifest(request);
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(({ token, user }) => {
    try {
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
      // The cookie banner, decided (essential only), so it never covers the editor (lib/cookieConsent.js).
      localStorage.setItem('axal_cookie_consent_v1', JSON.stringify({ version: 1, decided: true, updatedAt: '2026-10-20T00:00:00Z', categories: { essential: true } }));
    } catch { /* storage off: the spec fails on sign-in, loudly */ }
  }, { token: m.token, user: m.user });
  await page.route((url) => url.hostname !== '127.0.0.1', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ status: 200, contentType: 'text/css', body: FONT_CSS });
    const face = /^\/d1511\/(\d+)\.woff2$/.exec(url.pathname);
    if (url.hostname === 'fonts.gstatic.com' && face) return route.fulfill({ status: 200, contentType: 'font/woff2', body: readFileSync(FACES[Number(face[1])][3]) });
    return route.abort('blockedbyclient');
  });
  return m;
}

/** Opens the editor on a venture's current deck and waits until it has drawn with its fonts. */
export async function openEditor(page, projectId) {
  await page.goto(`/raise/pitch/edit?project_id=${projectId}`);
  await expect(page.getByTestId('pitch-editor-stage')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('pitch-editor-card')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

/** Selects card `n` (0-based) in the Cards strip (opening "+ N more cards" when it is past the first few). */
export async function showCard(page, n) {
  const item = page.getByTestId(`pitch-editor-rail-${n}`);
  if (!(await item.count())) await page.getByTestId('pitch-editor-more-cards').click();
  await item.click();
  await expect(item).toHaveAttribute('aria-current', 'true');
}
