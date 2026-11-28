/**
 * D8729 part 3 (#8729): the founder Studio's first screen, measured in a real
 * browser. Part 2 (`D8729-p2.md`) built it and pinned the order by DOM order
 * in `frontend/test/studio_founder_venture_8729.test.mjs`; it left "a
 * real-browser check at 390 × 844" out. This spec is that check, against the
 * built SPA, for two synthetic ventures:
 *
 *   · AT 390 × 844 the venture's h1 and its one primary task (Add feature)
 *     are inside the first screen, with no scrolling and no page wider than
 *     the window; the primary is a 44 px target. The first heading in the
 *     accessibility tree names the venture, on the phone and at 1440 (SFD03,
 *     SFD12A, SFD14).
 *   · FOR EACH VENTURE the Next card's task opens Add feature in that venture
 *     (`/build/solution-design/new?project_id=<id>`), the dialog names it, and
 *     Cancel lands on Studio in the same venture with focus back on the task;
 *     the tile's Open link lands in that venture and the browser's Back
 *     returns to Studio there (SFD06, SFD07, SFD12D).
 *   · THE SEPARATE PATHS: an address naming a venture the member cannot open
 *     is "Venture not available" and offers their own ventures; two ventures
 *     and none named asks which (owner Q1 A); no venture is "Start your first
 *     venture" (SFD08 to SFD10, SFD12E, SFD12F).
 *   · axe-core finds no violation under the WCAG A and AA tags in the venture
 *     header and the Next card, at both widths.
 *
 * NO PREVIEW, NO ACCOUNT. The set-up is `switcher_rail_7808.spec.js`'s: the
 * spec serves the built SPA (`docs/`, from `npm run build` at the repo root)
 * with the Workers SPA fallback, signs in an invented founder, answers
 * `/api/*` with invented fixtures in the Worker's shapes (`/projects`,
 * `/studio/modules`, `/studio/layout`, `/cycles/build/overview` with
 * `cycle_build.ts`'s `next()` hrefs), refuses every write, aborts anything off
 * its origin and pins the clock. It does not prove the Worker's answers; the
 * Worker's own tests do.
 *
 *   npm run build                                   (repo root)
 *   cd frontend && npx --no-install playwright test -c playwright.config.js tests/e2e/studio_founder_first_screen_8729.spec.js --trace off
 *
 * Not yet a step in the `visual` job of `.github/workflows/ci.yml`: workflow
 * files are the owner's to change (T2), and D8729-p3 records the proposed step.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONSENT_VERSION } from '../../src/lib/cookieConsent.js';

const DOCS = resolve(fileURLToPath(new URL('../../../docs', import.meta.url)));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain',
};
const NOW = '2026-11-27T12:00:00Z';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

// The built SPA, with the Workers assets binding's single-page-application
// fallback: a file under docs/ when there is one, else the shell.
let server; let origin;
test.beforeAll(async () => {
  if (!existsSync(join(DOCS, 'index.html'))) throw new Error('docs/index.html is missing: run `npm run build` at the repo root first.');
  server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = join(DOCS, path);
    if (!(file === DOCS || file.startsWith(DOCS + sep)) || !existsSync(file) || statSync(file).isDirectory()) file = join(DOCS, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(() => new Promise((r) => (server ? server.close(r) : r())));

// ── invented fixtures, in the Worker's shapes ────────────────────────────────
const FOUNDER = {
  id: 8729, name: 'Synthetic Founder', email: 'founder@example.test', role: 'founder', roles: ['founder'], licences: ['founder'],
  is_super_admin: 0, kyc_status: 'approved',
};
const STAMP = '2026-11-20 09:00:00';
// Atlas Orchard is the brief's venture; Kiln Ledger is the canvas's second, both invented.
const ATLAS = { id: 12, uid: 'prj-8729-a', name: 'Atlas Orchard' };
const KILN = { id: 19, uid: 'prj-8729-k', name: 'Kiln Ledger' };
const project = (v) => ({ ...v, status: 'active', stage: 'idea', company_id: null, created_at: STAMP, updated_at: STAMP });
const MODULES = { profile: 'founder', groups: [{ key: 'studio', label: 'Studio' }, { key: 'build', label: 'Build' }], modules: [
  { key: 'build_solution_design', title: 'Solution design', group: 'build', purpose: 'Features, linked to the pains they answer.', href: '/build/solution-design', default_size: '1/3', in_default: true, locked_by_plan: false, plan: null },
  { key: 'build_product_roadmap', title: 'Product roadmap', group: 'build', purpose: 'What is planned, now and next.', href: '/build/product-roadmap', default_size: '1/3', in_default: true, locked_by_plan: false, plan: null },
  { key: 'eadwyn_questions', title: 'Eadwyn’s questions', group: 'studio', purpose: 'What Eadwyn is waiting on.', href: null, default_size: '1/2', in_default: true, locked_by_plan: false, plan: null },
] };
const LAYOUT = { profile: 'founder', source: 'saved', revision: 1, updated_at: null, dropped: [],
  layout: [{ key: 'build_solution_design', size: '1/3' }, { key: 'build_product_roadmap', size: '1/3' }, { key: 'eadwyn_questions', size: '1/2' }] };
// `cycle_build.ts` `next()`: `?project=<id>`, and `&add=1` for a first Add.
const buildOverview = (id) => ({ cards: [
  { slug: 'solution-design', name: 'Solution design', state: 'empty', series: [], reason: 'No features yet. Linked and unlinked features appear here.',
    next: { text: 'Add feature', href: `/build/solution-design?project=${id}&add=1` } },
  { slug: 'product-roadmap', name: 'Product roadmap', state: 'ok', series: [],
    next: { text: 'Move the next planned item into Now', href: `/build/product-roadmap?project=${id}` } },
] });

/**
 * Signs the fixture founder in, answers `/api/*`, aborts every other origin
 * and opens `path`. `ventures` is what `/api/projects` answers. Returns every
 * write (none may be made) and every `project` a venture-scoped read named.
 */
async function visit(page, path, { ventures = [ATLAS, KILN] } = {}) {
  const writes = []; const scoped = [];
  await page.clock.setFixedTime(new Date(NOW));
  await page.addInitScript(({ user, consentVersion }) => {
    localStorage.setItem('token', 'synthetic-founder-session');
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('viewMode', 'founder');
    localStorage.setItem('axal_appearance_v1', JSON.stringify({ theme: 'light' }));
    localStorage.setItem('axal_cookie_consent_v1', JSON.stringify({ version: consentVersion, decided: true, categories: { essential: true } }));
  }, { user: FOUNDER, consentVersion: CONSENT_VERSION });
  await page.routeWebSocket(() => true, (ws) => ws.close());
  await page.route((u) => u.origin !== origin, (route) => route.abort());
  await page.route((u) => u.pathname.startsWith('/api/'), (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    if (p === '/api/client-error') return route.fulfill({ status: 204, body: '' });
    // Eadwyn's chat opens its own session when it is drawn; that is the assistant's, not a venture write.
    if (p === '/api/advisor/start') return route.fulfill({ status: 404, json: { error: 'not_found' } });
    if (req.method() !== 'GET') { writes.push(`${req.method()} ${p}`); return route.fulfill({ status: 500, json: { error: 'unexpected_write' } }); }
    if (url.searchParams.has('project')) scoped.push(`${p}?project=${url.searchParams.get('project')}`);
    if (p === '/api/auth/me' || p === '/api/me') return route.fulfill({ json: FOUNDER });
    if (p === '/api/settings/appearance') return route.fulfill({ json: { theme: 'light' } });
    if (p === '/api/onboarding/progress') return route.fulfill({ json: { flow: 'founder', completed_at: NOW } });
    if (p === '/api/company/memberships') return route.fulfill({ json: [] });
    if (p === '/api/projects') return route.fulfill({ json: ventures.map(project) });
    if (p === '/api/spinout-lab/state') return route.fulfill({ json: { active: false } });
    if (p === '/api/advisor/progress') return route.fulfill({ json: { total: 24, answered: 18 } });
    if (p === '/api/advisor/queue') return route.fulfill({ json: { queue: [] } });
    if (p === '/api/studio/modules') return route.fulfill({ json: MODULES });
    if (p === '/api/studio/layout') return route.fulfill({ json: LAYOUT });
    if (p.startsWith('/api/progress/lifecycle/')) return route.fulfill({ json: { checklist: [] } });
    if (p.startsWith('/api/scoring/scores/')) return route.fulfill({ json: [] });
    if (p === '/api/cycles/build/overview') return route.fulfill({ json: buildOverview(Number(url.searchParams.get('project'))) });
    // Add feature's choices: the venture has no pain themes or hypotheses yet, so each offers None yet.
    if (p === '/api/cycles/build/modules/solution-design/form-options') return route.fulfill({ json: {} });
    // Every other read is answered "not found", which each one handles.
    return route.fulfill({ status: 404, json: { error: 'not_found' } });
  });
  await page.goto(`${origin}${path}`);
  return { writes, scoped };
}

/** Every axe violation under the WCAG A and AA tags inside `selector`, one line each. */
async function axe(page, selector) {
  const r = await new AxeBuilder({ page }).withTags(TAGS).include(selector).analyze();
  return r.violations.map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

/** The first heading in the accessibility tree, as `[level, name]`. */
async function firstHeading(page) {
  const h = page.getByRole('heading').first();
  return [await h.evaluate((el) => Number(el.tagName.slice(1)) || Number(el.getAttribute('aria-level'))), (await h.innerText()).trim()];
}

/**
 * Where `testId` sits on the first screen: its box, whether it lies wholly
 * inside the window, and whether a click at its centre reaches it (nothing
 * sticky, such as the Customise bar or the tab bar, drawn over it).
 */
async function onFirstScreen(page, testId) {
  return page.getByTestId(testId).evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height),
      inside: r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth,
      reached: el === hit || el.contains(hit),
      scrollY: window.scrollY,
      wide: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
}

const PRIMARY = 'link-studio-next-primary';
const NEXT_TASK = 'studio-next-build_solution_design';
const TILE_TASK = 'studio-tile-next-build_solution_design';
const otherThan = (v) => (v === ATLAS ? KILN : ATLAS);

// Service workers are blocked: the app's worker answers some `/api/*` reads
// (`/api/projects` among them) before `page.route` sees them.
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce', serviceWorkers: 'block' };
const DESKTOP = { viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block' };

test.describe('390 × 844: the venture and one task for it are the first screen (SFD12A, SFD14)', () => {
  test.use(PHONE);
  for (const v of [ATLAS, KILN]) {
    test(`${v.name}: the first heading names it, and Add feature is inside the window, reachable and 44 px tall`, async ({ page }) => {
      const { writes, scoped } = await visit(page, `/studio?project_id=${v.id}`);
      await expect(page.getByTestId('text-founder-studio-title')).toHaveText(v.name);
      await expect(page.getByTestId(PRIMARY)).toBeVisible();
      await page.waitForLoadState('networkidle');
      // The accessibility tree opens on the venture, not on Eadwyn's bar.
      expect(await firstHeading(page)).toEqual([1, v.name]);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expect(page.getByTestId(PRIMARY)).toHaveAccessibleName(`Add feature to ${v.name}`);
      const head = await onFirstScreen(page, 'text-founder-studio-title');
      const primary = await onFirstScreen(page, PRIMARY);
      const swap = await onFirstScreen(page, 'button-studio-switch-venture');
      expect(primary.scrollY, 'nothing was scrolled').toBe(0);
      expect(head.inside && swap.inside, `the heading and Switch are on the first screen: ${JSON.stringify({ head, swap })}`).toBe(true);
      expect(primary.inside, `Add feature is on the first screen: ${JSON.stringify(primary)}`).toBe(true);
      expect(primary.reached, 'nothing sticky is drawn over Add feature').toBe(true);
      expect(primary.height).toBeGreaterThanOrEqual(44);
      expect(primary.wide, 'no page wider than the window').toBe(false);
      // The venture work comes before Eadwyn's collapsed row (owner Q3 A).
      const row = await onFirstScreen(page, 'studio-eadwyn-row');
      expect(row.top).toBeGreaterThan(primary.bottom);
      expect(scoped.filter((x) => x.endsWith(`project=${otherThan(v).id}`)), 'no read names the other venture').toEqual([]);
      expect(writes).toEqual([]);
    });
  }

  test('axe finds no violation in the venture header and the Next card', async ({ page }) => {
    await visit(page, `/studio?project_id=${ATLAS.id}`);
    await expect(page.getByTestId(PRIMARY)).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(await axe(page, '[data-testid="founder-studio-venture-head"]')).toEqual([]);
    expect(await axe(page, '[data-testid="studio-next"]')).toEqual([]);
  });
});

test.describe('1440: the venture is the first heading, with its next task above Eadwyn (SFD03)', () => {
  test.use(DESKTOP);
  test('the h1 names the venture and Add feature is on the first screen, above Eadwyn', async ({ page }) => {
    const { writes } = await visit(page, `/studio?project_id=${KILN.id}`);
    await expect(page.getByTestId('text-founder-studio-title')).toHaveText(KILN.name);
    await expect(page.getByTestId(PRIMARY)).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(await firstHeading(page)).toEqual([1, KILN.name]);
    const primary = await onFirstScreen(page, PRIMARY);
    expect(primary.inside && primary.reached, JSON.stringify(primary)).toBe(true);
    const eadwyn = await page.getByTestId('section-founder-advisor').evaluate((el) => el.getBoundingClientRect().top);
    expect(eadwyn).toBeGreaterThan(primary.bottom);
    expect(await axe(page, '[data-testid="founder-studio-venture-head"]')).toEqual([]);
    expect(await axe(page, '[data-testid="studio-next"]')).toEqual([]);
    expect(writes).toEqual([]);
  });
});

/**
 * One venture's way out and back: the Next card's task and the tile's task
 * open Add feature in that venture, the dialog names it, and Cancel lands on
 * Studio there with focus on the control that left; the tile's Open link
 * lands in that venture and Back returns.
 */
async function returnCheck(page, v, { phone }) {
  const { writes, scoped } = await visit(page, `/studio?project_id=${v.id}`);
  await expect(page.getByTestId('text-founder-studio-title')).toHaveText(v.name);
  const line = `${v.name} · Build · Solution design`;
  for (const id of [NEXT_TASK, TILE_TASK]) {
    const link = page.locator(`[id="${id}"]`);
    await expect(link).toHaveAttribute('href', `/build/solution-design/new?project_id=${v.id}`);
    await link.click();
    await expect(page).toHaveURL(`${origin}/build/solution-design/new?project_id=${v.id}`);
    // Below 1024px the form is the page (D695, SFD12C), with the venture line; above, the dialog's first line (SFD05).
    const form = page.getByTestId(phone ? 'cycle-form-page' : 'cycle-form');
    await expect(form).toBeVisible();
    if (phone) await expect(page.getByTestId('cycle-form-venture')).toHaveText(line);
    else {
      await expect(form).toContainText(line);
      await expect(page.getByTestId('cycle-form-venture'), 'the dialog does not say it twice').toHaveCount(0);
    }
    // The dialog is kept as it was: Add feature with an empty draft sends nothing and stays on the form.
    const save = page.getByTestId('cycle-form-save');
    await expect(save).toHaveText('Add feature');
    await save.click();
    await expect(form).toBeVisible();
    expect(writes, 'an empty draft is not sent').toEqual([]);
    await page.getByTestId('cycle-form-cancel').click();
    await expect(page).toHaveURL(`${origin}/studio?project_id=${v.id}`);
    await expect(page.getByTestId('text-founder-studio-title')).toHaveText(v.name);
    await expect(page.locator(`[id="${id}"]`), `focus returns to ${id}`).toBeFocused();
  }
  const open = page.getByTestId('studio-tile-open-build_solution_design');
  await expect(open).toHaveAttribute('href', `/build/solution-design?project_id=${v.id}`);
  await open.click();
  await expect(page).toHaveURL(`${origin}/build/solution-design?project_id=${v.id}`);
  await page.goBack();
  await expect(page).toHaveURL(`${origin}/studio?project_id=${v.id}`);
  await expect(page.getByTestId('text-founder-studio-title')).toHaveText(v.name);
  expect(scoped.filter((x) => x.endsWith(`project=${otherThan(v).id}`)), 'no read names the other venture').toEqual([]);
  expect(writes).toEqual([]);
}

test.describe('Two ventures: every task lands in the selected venture and Cancel or Back keeps it (SFD06, SFD07)', () => {
  test.describe('390 × 844', () => {
    test.use(PHONE);
    for (const v of [ATLAS, KILN]) test(v.name, ({ page }) => returnCheck(page, v, { phone: true }));
  });
  test.describe('1440', () => {
    test.use(DESKTOP);
    for (const v of [ATLAS, KILN]) test(v.name, ({ page }) => returnCheck(page, v, { phone: false }));
  });
});

test.describe('Separate paths when no venture is open (SFD08 to SFD10, SFD12E, SFD12F)', () => {
  test.use(PHONE);
  test('an address naming a venture the member cannot open: "Venture not available", their own ventures offered, nothing of theirs read', async ({ page }) => {
    const { writes, scoped } = await visit(page, '/studio?project_id=404');
    await expect(page.getByTestId('text-founder-studio-title')).toHaveText('Venture not available');
    const notice = page.getByTestId('status-founder-project-unavailable');
    await expect(notice).toBeVisible();
    for (const v of [ATLAS, KILN]) {
      const link = notice.getByRole('link', { name: v.name });
      await expect(link).toHaveAttribute('href', `/studio?project_id=${v.id}`);
      expect((await link.boundingBox()).height, `${v.name} is a 44 px target`).toBeGreaterThanOrEqual(44);
    }
    await page.waitForLoadState('networkidle');
    expect(await firstHeading(page)).toEqual([1, 'Venture not available']);
    await expect(page).toHaveURL(`${origin}/studio?project_id=404`);
    expect(scoped.filter((x) => /project=(12|19)$/.test(x)), 'another venture is never read in its place (D4619)').toEqual([]);
    expect(writes).toEqual([]);
  });

  test('two ventures and none named: Studio asks which (owner Q1 A), and the pick opens it', async ({ page }) => {
    const { writes, scoped } = await visit(page, '/studio');
    const chooser = page.getByTestId('studio-venture-chooser');
    await expect(chooser).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Which venture are you working on?' })).toBeVisible();
    expect(await firstHeading(page)).toEqual([1, 'Studio']);
    expect(scoped, 'nothing venture-scoped is read before a choice').toEqual([]);
    await chooser.getByRole('link', { name: KILN.name }).click();
    await expect(page).toHaveURL(`${origin}/studio?project_id=${KILN.id}`);
    await expect(page.getByTestId('text-founder-studio-title')).toHaveText(KILN.name);
    await expect(page.getByTestId(PRIMARY)).toHaveAttribute('href', `/build/solution-design/new?project_id=${KILN.id}`);
    expect(writes).toEqual([]);
  });

  test('one venture and none named: it opens, and its ID is written to the address', async ({ page }) => {
    const { writes } = await visit(page, '/studio', { ventures: [ATLAS] });
    await expect(page.getByTestId('text-founder-studio-title')).toHaveText(ATLAS.name);
    await expect(page).toHaveURL(`${origin}/studio?project_id=${ATLAS.id}`);
    await expect(page.getByTestId(PRIMARY)).toBeVisible();
    expect(writes).toEqual([]);
  });

  test('no venture yet: "Start your first venture", with Create your startup on the first screen', async ({ page }) => {
    const { writes, scoped } = await visit(page, '/studio', { ventures: [] });
    await expect(page.getByTestId('studio-first-venture')).toBeVisible();
    await expect(page.getByTestId('text-founder-studio-title')).toHaveText('Studio');
    const create = await onFirstScreen(page, 'link-studio-first-venture');
    expect(create.inside && create.reached, JSON.stringify(create)).toBe(true);
    await expect(page.getByTestId('button-studio-switch-venture')).toHaveCount(0);
    expect(scoped).toEqual([]);
    expect(writes).toEqual([]);
  });
});
