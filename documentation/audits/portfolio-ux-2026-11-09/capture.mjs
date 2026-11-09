#!/usr/bin/env node
/**
 * Screenshot capture for the Portfolio UI/UX audit, issue #4816
 * (`documentation/audits/PORTFOLIO_UX_AUDIT_2026-11-09.md`).
 *
 * What it does: serves a built SPA (`docs/`, from `npm run build`) with an
 * index.html fallback, opens it in Playwright's Chromium as a synthetic
 * signed-in investor, answers every `/api/*` call from `fixtures/portfolio.mjs`
 * (no network, no production data, no real account), and writes one JPEG per
 * screen, state and viewport into `screens/`, plus `screens/metadata.json`
 * with each route's `document.title`, headings, landmarks and the first
 * keyboard Tab stops.
 *
 * It is an audit tool, not a test: no test runner globs this folder, and
 * nothing in CI runs it. To rerun, from the repo root:
 *
 *   npm run build                      # fills docs/
 *   node documentation/audits/portfolio-ux-2026-11-09/capture.mjs [path/to/docs]
 *
 * The clock is pinned to the audit date so "days since" copy is stable.
 */
import http from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as F from './fixtures/portfolio.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const DOCS = resolve(process.argv[2] || join(REPO, 'docs'));
const OUT = join(HERE, 'screens');
const PORT = 48160;
const require = createRequire(import.meta.url);

/**
 * The repo's Playwright first; when its browser is not installed (a sandbox
 * with a pre-installed Playwright elsewhere), the copy on NODE_PATH.
 */
async function launchChromium() {
  const candidates = ['playwright', ...String(process.env.NODE_PATH || '').split(':').filter(Boolean).map((p) => join(p, 'playwright'))];
  let lastError;
  for (const id of candidates) {
    try { return await require(id).chromium.launch(); } catch (error) { lastError = error; }
  }
  throw lastError;
}

if (!existsSync(join(DOCS, 'index.html'))) {
  console.error(`No built SPA at ${DOCS}. Run \`npm run build\` first, or pass the folder.`);
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let file = join(DOCS, decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(DOCS)) { res.writeHead(403); res.end(); return; }
  try { if (statSync(file).isDirectory()) file = join(file, 'index.html'); } catch { file = join(DOCS, 'index.html'); }
  if (!existsSync(file)) file = join(DOCS, 'index.html');
  const type = TYPES[extname(file)] || 'application/octet-stream';
  res.writeHead(200, { 'content-type': /^(text|application\/(json|manifest))/.test(type) ? `${type}; charset=utf-8` : type });
  createReadStream(file).pipe(res);
});

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 834, height: 1112 },
  phone: { width: 390, height: 844 },
};

/** The default answer for each API path the Portfolio pages read. */
function baseAnswers(user) {
  return {
    '/api/auth/me': user,
    '/api/onboarding/progress': { flow: user.role, completed_at: '2025-01-01T00:00:00Z' },
    '/api/positions': F.positions,
    '/api/positions/analytics': F.analytics,
    '/api/positions/marks': F.marks,
    '/api/positions/kpi-compliance': F.compliance,
    '/api/portfolio/health': F.healthList,
    '/api/portfolio-updates': F.updates,
    '/api/introductions/': F.introductions,
    '/api/portfolio/chases': F.chases,
    '/api/portfolio-support': F.support,
    '/api/reporting/portfolio': F.reportingPortfolio,
    '/api/notifications/unread-count': { count: 0 },
  };
}

function answerFor(pathname, answers) {
  if (pathname in answers) return answers[pathname];
  const fig = pathname.match(/^\/api\/reporting\/companies\/([^/]+)\/figures$/);
  if (fig) return F.companyFigures[fig[1]] || { status: 404, body: { detail: 'Not found' } };
  const co = pathname.match(/^\/api\/reporting\/companies\/([^/]+)$/);
  if (co) return F.reportingCompanyOf(co[1]) || { status: 404, body: { detail: 'Not found' } };
  const pos = pathname.match(/^\/api\/positions\/([a-z0-9-]+)$/);
  if (pos) return { project: F.positions.items.find((p) => p.project.uid === pos[1])?.project || null, rounds: [], marks: F.marks.items.filter((m) => m.project_uid === pos[1]), distributions: [] };
  return {};
}

const FAIL = { status: 500, body: { detail: 'Synthetic failure for the audit' } };
const HANG = { delay: 60000 };

const EMPTY_BOOK = {
  '/api/positions': { items: [], scope: F.positions.scope },
  '/api/positions/analytics': { paid_in: 0, distributed: 0, nav: 0, total_value: 0, dpi: null, rvpi: null, tvpi: null, moic: null, irr: null, basis: 'gross', flow_count: 0, as_of: null, position_count: 0, unmarked_position_count: 0, mark_coverage: null },
  '/api/portfolio/health': { items: [], totals: { green: 0, yellow: 0, red: 0, intervention: 0 } },
  '/api/portfolio-updates': { items: [] },
  '/api/positions/kpi-compliance': { ...F.compliance, companies: [], reported_count: 0, total_count: 0, compliance_pct: null },
  '/api/introductions/': { introductions: [] },
  '/api/portfolio-support': { entries: [], companies: [], untouched: [], totals: { delivered: 0, promised: 0, withdrawn: 0, hours_recorded: 0, entries_without_hours: 0, companies_in_book: 0, companies_supported: 0 } },
  '/api/reporting/portfolio': { companies: [] },
};

// Fields absent: the Worker returns null for anything not recorded.
const NOT_RECORDED = {
  '/api/positions': { ...F.positions, items: F.positions.items.map((p, i) => (i < 2 ? p : {
    ...p, project: { ...p.project, sector: null, stage: null }, latest_ownership_pct: null, latest_round: null, vintage: null,
  })) },
  '/api/positions/analytics': { ...F.analytics, irr: null },
  '/api/portfolio/health': { items: F.healthList.items.slice(0, 2), totals: { green: 1, yellow: 1, red: 0, intervention: 0 } },
};

// Stale: the newest mark is 16 months old and the newest update is 7 months old.
const STALE = {
  '/api/positions': { ...F.positions, items: F.positions.items.map((p) => (p.unmarked ? p : { ...p, mark_as_of: '2025-06-30' })) },
  '/api/portfolio-updates': { items: F.updates.items.map((u) => ({ ...u, submitted_at: '2026-04-02T09:00:00Z', updated_at: '2026-04-02T09:00:00Z' })) },
  '/api/positions/kpi-compliance': { ...F.compliance, companies: F.compliance.companies.map((c) => ({ ...c, reported: false, last_reported_at: c.last_reported_at ? '2026-04-02' : null, days_since_report: c.last_reported_at ? 221 : null })), reported_count: 0, compliance_pct: 0 },
};

const ALL = ['desktop', 'tablet', 'phone'];
const DP = ['desktop', 'phone'];
const SCENARIOS = [
  // Journeys: the current screens with a full synthetic book.
  { id: 'S01-overview', path: '/portfolio', vps: ALL, a11y: true },
  { id: 'S02-overview-health-alias', path: '/portfolio/health', vps: ['desktop'] },
  { id: 'S03-positions', path: '/portfolio/positions', vps: ALL, a11y: true },
  { id: 'S04-positions-mark-history', path: '/portfolio/positions', vps: ['desktop'], click: '[data-testid*="mark-history"], button:has-text("Mark history")' },
  { id: 'S05-reports', path: '/portfolio/updates', vps: ALL, a11y: true },
  { id: 'S06-performance', path: '/portfolio/performance', vps: ALL, a11y: true },
  { id: 'S07-value-add', path: '/portfolio/value-add', vps: ALL, a11y: true },
  { id: 'S08-company-figures', path: '/portfolio/companies/tst-alpha', vps: ALL, a11y: true },
  { id: 'S09-company-reports', path: '/portfolio/companies/tst-alpha/reports', vps: DP },
  { id: 'S10-company-terms', path: '/portfolio/companies/tst-alpha/terms', vps: DP },
  { id: 'S11-company-not-held', path: '/portfolio/companies/tst-unknown', vps: ['desktop'] },
  { id: 'S12-account-companies', path: '/account/portfolio', vps: ['desktop'] },
  // States, forced by the fixtures.
  { id: 'T01-overview-loading', path: '/portfolio', vps: DP, override: { '/api/positions': HANG }, settle: 2500 },
  { id: 'T02-overview-empty', path: '/portfolio', vps: DP, override: EMPTY_BOOK },
  { id: 'T03-overview-unreadable', path: '/portfolio', vps: DP, override: { '/api/positions': FAIL } },
  { id: 'T04-overview-partial', path: '/portfolio', vps: DP, override: { '/api/positions/analytics': FAIL, '/api/portfolio/health': FAIL, '/api/positions/kpi-compliance': FAIL } },
  { id: 'T05-overview-not-recorded', path: '/portfolio', vps: DP, override: NOT_RECORDED },
  { id: 'T06-overview-stale', path: '/portfolio', vps: DP, override: STALE },
  { id: 'T07-positions-partial', path: '/portfolio/positions', vps: ['desktop'], override: { '/api/portfolio/health': FAIL, '/api/portfolio-updates': FAIL } },
  { id: 'T08-reports-unreadable', path: '/portfolio/updates', vps: ['desktop'], override: { '/api/reporting/portfolio': FAIL, '/api/portfolio/chases': FAIL } },
  { id: 'T09-reports-empty', path: '/portfolio/updates', vps: ['desktop'], override: EMPTY_BOOK },
  { id: 'T10-value-add-unreadable', path: '/portfolio/value-add', vps: ['desktop'], override: { '/api/portfolio-support': FAIL } },
  { id: 'T11-company-unreadable', path: '/portfolio/companies/tst-alpha', vps: ['desktop'], override: { '/api/positions': FAIL, '/api/reporting/companies/tst-alpha': FAIL, '/api/reporting/companies/tst-alpha/figures': FAIL } },
  { id: 'T12-performance-empty', path: '/portfolio/performance', vps: ['desktop'], override: EMPTY_BOOK },
  { id: 'T13-value-add-empty', path: '/portfolio/value-add', vps: ['desktop'], override: EMPTY_BOOK },
  // The Super Admin investor preview (#4849 re-check).
  { id: 'P01-admin-preview-overview', path: '/portfolio', vps: DP, user: 'admin', a11y: true },
  { id: 'P02-admin-preview-company', path: '/portfolio/companies/tst-alpha', vps: ['desktop'], user: 'admin' },
];

async function inspect(page, withTabs) {
  const dom = await page.evaluate(() => {
    const txt = (el) => (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 90);
    return {
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.getAttribute('content') || null,
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') || null,
      headings: [...document.querySelectorAll('h1,h2,h3')].filter((h) => h.offsetParent !== null).map((h) => `${h.tagName.toLowerCase()}: ${txt(h)}`).slice(0, 40),
      landmarks: [...document.querySelectorAll('main,nav,aside,header,footer,[role=main],[role=navigation],[role=complementary],[role=banner]')]
        .filter((el) => el.offsetParent !== null || el.tagName === 'MAIN')
        .map((el) => `${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''}${el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : ''}`),
      mainCount: document.querySelectorAll('main,[role=main]').length,
      h1Count: [...document.querySelectorAll('h1')].filter((h) => h.offsetParent !== null).length,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
  if (withTabs) {
    dom.tabStops = [];
    await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press('Tab');
      dom.tabStops.push(await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return 'body';
        const cs = getComputedStyle(el);
        const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none');
        const name = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 50);
        const region = el.closest('aside') ? 'aside' : el.closest('nav') ? 'nav' : el.closest('main') ? 'main' : el.closest('header') ? 'header' : 'other';
        return `${el.tagName.toLowerCase()} "${name}" [${region}]${ring ? '' : ' NO-VISIBLE-RING'}`;
      }));
    }
  }
  return dom;
}

server.listen(PORT, async () => {
  const browser = await launchChromium();
  const meta = { captured_on: F.TODAY, docs: relative(REPO, DOCS) || DOCS, screens: [] };
  for (const sc of SCENARIOS) {
    for (const vp of sc.vps) {
      const user = sc.user === 'admin' ? F.ADMIN : F.INVESTOR;
      const context = await browser.newContext({ viewport: VIEWPORTS[vp], deviceScaleFactor: 1, reducedMotion: 'reduce', colorScheme: 'light' });
      await context.addInitScript(({ u, admin }) => {
        try {
          localStorage.setItem('user', JSON.stringify(u));
          localStorage.setItem('token', 'synthetic-audit-token');
          if (admin) localStorage.setItem('viewMode', 'investor');
          localStorage.setItem('theme', 'light');
          // The cookie banner is decided (essential only) so it does not cover the page.
          localStorage.setItem('axal_cookie_consent_v1', JSON.stringify({ version: 1, decided: true, updatedAt: '2026-11-09T00:00:00Z', categories: { essential: true } }));
        } catch { /* storage blocked */ }
      }, { u: user, admin: sc.user === 'admin' });
      const page = await context.newPage();
      await page.clock.setFixedTime(new Date(F.TODAY));
      const answers = { ...baseAnswers(user), ...(sc.override || {}) };
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
      await page.route('**/api/**', async (route) => {
        const url = new URL(route.request().url());
        if (route.request().method() !== 'GET') return route.fulfill({ status: 405, json: { detail: 'Read-only audit capture' } });
        const a = answerFor(url.pathname, answers);
        if (a && a.delay) { await new Promise((r) => setTimeout(r, a.delay)); return route.fulfill({ json: {} }).catch(() => {}); }
        if (a && a.status) return route.fulfill({ status: a.status, json: a.body });
        return route.fulfill({ json: a });
      });
      await page.routeWebSocket(/.*/, () => {}).catch(() => {});
      await page.goto(`http://localhost:${PORT}${sc.path}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(sc.settle || 3500);
      if (sc.click) {
        const el = page.locator(sc.click).first();
        if (await el.count()) { await el.click().catch(() => {}); await page.waitForTimeout(1200); } else errors.push(`click target not found: ${sc.click}`);
      }
      const file = `${sc.id}-${vp}.jpg`;
      // Inspect at the real viewport (overflow and Tab order), then grow the
      // window to the inner scroller's height: the app scrolls inside its own
      // container, so Playwright's fullPage would only see one viewport.
      const dom = await inspect(page, sc.a11y && vp === 'desktop');
      const extra = await page.evaluate(() => Math.max(0, ...[...document.querySelectorAll('*')].map((el) => {
        const oy = getComputedStyle(el).overflowY;
        return (oy === 'auto' || oy === 'scroll') && el.clientHeight > 200 ? el.scrollHeight - el.clientHeight : 0;
      })));
      if (extra > 0) {
        await page.setViewportSize({ width: VIEWPORTS[vp].width, height: Math.min(VIEWPORTS[vp].height + extra, 4200) });
        await page.waitForTimeout(700);
      }
      await page.screenshot({ path: join(OUT, file), type: 'jpeg', quality: 60, fullPage: true });
      meta.screens.push({ id: sc.id, viewport: vp, path: sc.path, final_url: new URL(page.url()).pathname, file, user: user.role, errors, ...dom });
      console.log(`${file}\t${dom.title}\t${new URL(page.url()).pathname}`);
      await context.close();
    }
  }
  writeFileSync(join(OUT, 'metadata.json'), `${JSON.stringify(meta, null, 2)}\n`);
  await browser.close();
  server.close();
});
