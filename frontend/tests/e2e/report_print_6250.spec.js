/**
 * D6250-p2 (#6250): the issued fund report reader, printed. The reader landed
 * in #8154 with its print stylesheet (`@media print` in
 * `src/pages/fundPage.css`); its multi-page print was never looked at in a
 * browser. This spec prints it in Chromium (print emulation and `page.pdf`)
 * and reads the PDF back with pdfjs, so the acceptance in the issue ("Print
 * gives a clean page") is checked on every run, not once:
 *
 *   · ONLY THE DOCUMENT. Under print media the app chrome (sidebar, top bar,
 *     Worker rail, the Report actions row) is not drawn; the letter and the
 *     "Figures as issued" column are, in normal flow, at the page's width.
 *   · LIGHT COLOURS. In light and dark themes every printed text is black on
 *     white, with no card shadow or border, and the page's colour scheme is
 *     not dark (a dark one paints the page margins when backgrounds print).
 *   · NOTHING CLIPPED. No element of the reader overflows its box or the
 *     page, at Letter and A4; every paragraph, event and figure row of a
 *     long report reaches the PDF, and every text run lies inside the page.
 *   · PAGE BREAKS. The long report prints on several pages; no dated event is
 *     split across two pages and no section heading ends a page alone.
 *   · HEADER AND FOOTER. The document's own masthead (fund, period, issue date,
 *     issuer, both correction links) opens page 1; the letter's closing line
 *     follows its last event on the same page; the "Figures as issued" column
 *     prints whole on the last page.
 *
 * NO PREVIEW, NO ACCOUNT. The set-up is `switcher_rail_7808.spec.js`'s: the
 * spec serves the built SPA (`docs/`) with the Workers SPA fallback, signs in
 * an invented LP, answers `/api/*` with invented fixtures in the Worker's
 * shapes (`GET /api/funds/:id/page` and `/report-periods/:id`), aborts
 * anything off its origin and pins the clock.
 *
 *   npm run build                                   (repo root)
 *   cd frontend && npx --no-install playwright test -c playwright.config.js tests/e2e/report_print_6250.spec.js --trace off
 *
 * CI runs it in the `visual` job of `.github/workflows/ci.yml`, after that job
 * builds the SPA, with the job's pinned Chromium (`PW_CHROMIUM_PATH`).
 */
import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { CONSENT_VERSION } from '../../src/lib/cookieConsent.js';

const DOCS = resolve(fileURLToPath(new URL('../../../docs', import.meta.url)));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain',
};
const NOW = '2026-11-18T12:00:00Z';

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
const LP_USER = {
  id: 6250, name: 'Synthetic Partner', email: 'lp@example.test', role: 'investor', roles: ['investor'], licences: ['investor'],
  is_super_admin: 0, kyc_status: 'approved',
};
const FUND_PAGE = {
  currency: 'USD', can_manage: false,
  fund: { id: 7, name: 'Example Seed Fund I', lp_count: 12, size_cents: 2500000000,
    gp: { name: 'Example GP', title: null, entity: null, email: null },
    providers: { fund_admin: null, auditor: null, legal_counsel: null, custodian: null, valuation_policy: null } },
  totals: { committed_cents: 999999999, invested_cents: 999999999 },
  periods: [{ id: 1, period: 'Q1 2026', status: 'issued' }, { id: 2, period: 'Q2 2026', status: 'issued' }, { id: 3, period: 'Q2 2026 correction', status: 'issued' }],
  lpa: null,
};
const sentence = (n) => `Paragraph ${n} of the letter. The portfolio companies recorded their quarter, the fund called capital as planned and the partners reviewed every follow-on reserve against the plan agreed at the last annual meeting. `;
const LETTER = Array.from({ length: 14 }, (_, i) => (i === 3
  ? `${sentence(i + 1)}The full data room lives at https://example.test/fund/reports/2026/q2/data-room/very-long-path-without-any-break-points-to-wrap-at-all-0123456789abcdefghijklmnopqrstuvwxyz and is unchanged.`
  : sentence(i + 1).repeat(3)).trim());
const DEVELOPMENTS = Array.from({ length: 10 }, (_, i) => ({
  date: `2026-0${4 + Math.floor(i / 4)}-${String(3 + i * 2).padStart(2, '0')}`,
  title: `Development ${i + 1}`,
  body: `Recorded development ${i + 1}. ${'A portfolio company closed a round, hired a leader or shipped to its first customers. '.repeat(3)}`.trim(),
}));
const OUTLOOK = Array.from({ length: 4 }, (_, i) => `Outlook ${i + 1}. ${'Next quarter the fund expects to call capital once and to make two new seed investments. '.repeat(4)}`.trim());
const SUBSEQUENT = Array.from({ length: 6 }, (_, i) => ({ d: `2026-07-${String(2 + i * 3).padStart(2, '0')}`, e: `Subsequent event ${i + 1}. ${'Recorded after the period ended. '.repeat(4)}`.trim() }));
const cents = (n) => ({ cents: n });
const PERIOD = {
  id: 2, period: 'Q2 2026', status: 'issued', period_start: '2026-04-01', period_end: '2026-06-30',
  issued_at: '2026-07-08T10:00:00Z', issued_by_name: 'Synthetic Issuer', corrects_period_id: 1, corrects_period: 'Q1 2026', corrected_by_period_id: 3,
  narrative: { letter: LETTER, developments: DEVELOPMENTS, outlook: OUTLOOK, subsequent: SUBSEQUENT },
  figures: { source: 'report_pack', lp_count: 12, books_closed: true, nav_basis: 'Recorded marks at quarter end',
    totals: { commitments: cents(2500000000), called_to_date: cents(1234567891), contributed_in_quarter: cents(250000000), distributions_in_quarter: cents(0) },
    fund_figures: { investment_value: cents(1876543210), nav: cents(2012345678), cash: cents(135802468), liabilities: { cents: null, reason: 'No liabilities were recorded for the quarter.' } } },
};
const ALL_TEXT = [...LETTER, ...DEVELOPMENTS.flatMap((d) => [d.title, d.body]), ...OUTLOOK, ...SUBSEQUENT.map((s) => s.e)];
const FIGURE_LABELS = ['Committed capital', 'Called to date', 'Contributed this quarter', 'Investment value', 'Net asset value',
  'LPs in this report', 'Distributions this quarter', 'Fund cash', 'Recorded liabilities', 'Books closed for the quarter'];

/** Signs the fixture LP in, in `theme`, answers `/api/*`, aborts every other origin and opens the issued period. */
async function visit(page, theme) {
  const writes = [];
  await page.clock.setFixedTime(new Date(NOW));
  await page.addInitScript(({ user, consentVersion, t }) => {
    localStorage.setItem('token', 'synthetic-lp-session');
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('viewMode', 'investor');
    localStorage.setItem('axal_appearance_v1', JSON.stringify({ theme: t }));
    localStorage.setItem('axal_cookie_consent_v1', JSON.stringify({ version: consentVersion, decided: true, categories: { essential: true } }));
  }, { user: LP_USER, consentVersion: CONSENT_VERSION, t: theme });
  await page.routeWebSocket(() => true, (ws) => ws.close());
  await page.route((u) => u.origin !== origin, (route) => route.abort());
  await page.route((u) => u.pathname.startsWith('/api/'), (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    if (p === '/api/client-error') return route.fulfill({ status: 204, body: '' });
    if (req.method() !== 'GET') { writes.push(`${req.method()} ${p}`); return route.fulfill({ status: 500, json: { error: 'unexpected_write' } }); }
    if (p === '/api/auth/me' || p === '/api/me') return route.fulfill({ json: LP_USER });
    if (p === '/api/settings/appearance') return route.fulfill({ json: { theme } });
    if (p === '/api/onboarding/progress') return route.fulfill({ json: { flow: 'investor', completed_at: NOW } });
    if (p === '/api/company/memberships') return route.fulfill({ json: [] });
    if (p === '/api/funds/7/page') return route.fulfill({ json: FUND_PAGE });
    if (p === '/api/funds/7/report-periods/2') return route.fulfill({ json: { period: PERIOD } });
    return route.fulfill({ status: 404, json: { error: 'not_found' } });
  });
  await page.goto(`${origin}/funds/7/reporting/2`);
  await expect(page.getByRole('article', { name: 'Report letter' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Figures as issued' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /(^|\s)dark(\s|$)/ : /^(?!.*(^|\s)dark(\s|$))/);
  return { writes };
}

/** Every text run of each PDF page, with its box in PDF points (origin bottom left). */
async function pdfPages(buffer) {
  const task = getDocument({ data: new Uint8Array(buffer), useSystemFonts: false, isEvalSupported: false });
  const doc = await task.promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const pg = await doc.getPage(n);
    const [, , width, height] = pg.view;
    const { items } = await pg.getTextContent();
    const runs = items.filter((i) => i.str.trim()).map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width, h: i.height }));
    pages.push({ width, height, runs, text: items.map((i) => i.str + (i.hasEOL ? '\n' : '')).join('').replace(/\s+/g, ' ') });
  }
  await task.destroy();
  return pages;
}
// pdfjs drops a few glyphs of the bundled fonts (the colon, the en dash) that pdftotext reads, so text is
// compared on its letters, digits and dollar signs alone.
const squash = (s) => s.replace(/[^A-Za-z0-9$]/g, '');

for (const theme of ['light', 'dark']) {
  test.describe(`The issued report prints as a document (${theme})`, () => {
    test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

    test('print media shows only the reader, in normal flow, black on white, with nothing overflowing', async ({ page }) => {
      const { writes } = await visit(page, theme);
      await page.emulateMedia({ media: 'print' });
      await expect(page.locator('nav[aria-label="Report actions"]')).toBeHidden();
      await expect(page.locator('aside.fwr')).toBeHidden();
      await expect(page.getByRole('article', { name: 'Report letter' })).toBeVisible();
      await expect(page.getByRole('complementary', { name: 'Figures as issued' })).toBeVisible();
      const report = await page.evaluate(() => {
        const reader = document.querySelector('.fd-report-reader');
        const visible = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
        // Anything drawn outside the reader (and not one of its ancestors) is app chrome on paper.
        const chrome = [...document.body.querySelectorAll('*')].filter((el) => !reader.contains(el) && !el.contains(reader) && visible(el)
          && (el.textContent || '').trim()).map((el) => `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 80));
        const width = document.documentElement.clientWidth;
        const overflowing = [...reader.querySelectorAll('*')].filter((el) => visible(el)
          && (el.scrollWidth > el.clientWidth + 1 || el.getBoundingClientRect().right > width + 1 || el.getBoundingClientRect().left < -1))
          .map((el) => `${el.tagName.toLowerCase()}.${el.className}: ${el.scrollWidth}/${el.clientWidth}`);
        const colours = new Set(); const backgrounds = new Set(); const extras = [];
        for (const el of [reader, ...reader.querySelectorAll('*')]) {
          if (!visible(el)) continue;
          const s = getComputedStyle(el);
          if ([...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) colours.add(s.color);
          if (s.backgroundColor !== 'rgba(0, 0, 0, 0)') backgrounds.add(s.backgroundColor);
          if (el.matches('.fd-card') && (s.boxShadow !== 'none' || parseFloat(s.borderTopWidth) > 0)) extras.push(el.className);
        }
        const chain = []; for (let el = reader.parentElement; el; el = el.parentElement) {
          const s = getComputedStyle(el);
          if (s.position === 'fixed' || s.position === 'absolute' || s.overflowY === 'auto' || s.overflowY === 'scroll' || s.overflowY === 'hidden') chain.push(`${el.tagName.toLowerCase()}.${el.className}`.slice(0, 80));
          if (s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'rgb(255, 255, 255)') backgrounds.add(`ancestor ${s.backgroundColor}`);
        }
        return { chrome, overflowing, colours: [...colours], backgrounds: [...backgrounds], extras, chain, readerWidth: reader.getBoundingClientRect().width, width,
          scheme: getComputedStyle(document.documentElement).colorScheme };
      });
      expect(report.chrome, 'app chrome is printed').toEqual([]);
      expect(report.overflowing, 'an element of the reader overflows').toEqual([]);
      expect(report.colours, 'printed text is not black').toEqual(['rgb(0, 0, 0)']);
      expect(report.backgrounds.filter((b) => b !== 'rgb(255, 255, 255)'), 'a printed background is not white').toEqual([]);
      expect(report.extras, 'a printed card keeps its border or shadow').toEqual([]);
      expect(report.chain, 'an ancestor of the reader clips it or takes it out of flow').toEqual([]);
      // A dark colour scheme paints the page margins dark when backgrounds print.
      expect(report.scheme, 'the printed page keeps a dark colour scheme').not.toMatch(/dark/);
      expect(report.readerWidth).toBeGreaterThan(report.width * 0.9);
      expect(writes).toEqual([]);
    });

    for (const format of ['Letter', 'A4']) {
      test(`${format} PDF: several pages, every line inside the page, events and headings kept with their text`, async ({ page }) => {
        const { writes } = await visit(page, theme);
        const pdf = await page.pdf({ format, printBackground: true, margin: { top: '0.5in', bottom: '0.5in', left: '0.5in', right: '0.5in' } });
        const pages = await pdfPages(pdf);
        expect(pages.length, 'the long report fits one page: the fixture no longer tests page breaks').toBeGreaterThan(2);
        const all = squash(pages.map((p) => p.text).join(''));
        // Header: the masthead opens page 1. Footer: the closing line ends the document.
        const first = squash(pages[0].text);
        for (const text of ['Quarterly report to limited partners', 'Example Seed Fund I', 'Q2 2026', 'Jul 8, 2026, 10:00 AM UTC', 'Synthetic Issuer', 'This report corrects', 'Corrected by']) {
          expect(first, `page 1 does not carry "${text}"`).toContain(squash(text));
        }
        // No app chrome on paper.
        for (const chrome of ['Back to fund', 'Print', 'Your capital statement and PDF', 'GP-authored reporting', 'Issuing freezes the report']) {
          expect(all.includes(squash(chrome)) && !squash(LETTER.join('')).includes(squash(chrome)), `"${chrome}" is printed`).toBe(false);
        }
        // Nothing is lost: every paragraph, event and figure row reaches the PDF.
        for (const text of [...ALL_TEXT, ...FIGURE_LABELS, '$25,000,000.00', '$20,123,456.78']) {
          expect(all, `"${text.slice(0, 60)}" is missing from the PDF`).toContain(squash(text));
        }
        // Nothing is clipped: every text run lies inside its page, and inside the margins.
        const margin = 36;
        for (const [n, p] of pages.entries()) {
          for (const r of p.runs) {
            expect(r.x >= margin - 1 && r.x + r.w <= p.width - margin + 1 && r.y >= margin - 1 && r.y + r.h <= p.height - margin + 1,
              `page ${n + 1}: "${r.str.slice(0, 40)}" at x=${r.x.toFixed(1)} w=${r.w.toFixed(1)} y=${r.y.toFixed(1)} leaves the printable area`).toBe(true);
          }
        }
        // Page breaks: a dated event (date, title and body) is never split across pages,
        const pageOf = (text) => pages.findIndex((p) => squash(p.text).includes(squash(text)));
        for (const d of DEVELOPMENTS) {
          const at = pageOf(d.body);
          expect(at, `${d.title} is split across pages`).toBeGreaterThanOrEqual(0);
          expect(squash(pages[at].text)).toContain(squash(d.title));
        }
        for (const s of SUBSEQUENT) expect(pageOf(s.e), `"${s.e.slice(0, 30)}" is split across pages`).toBeGreaterThanOrEqual(0);
        // Footer: the letter's closing line follows its last event, on that event's page.
        const closing = pageOf('Issuing cannot be undone. Record a correcting period to change this report.');
        expect(closing).toBeGreaterThanOrEqual(0);
        expect(closing).toBe(pageOf(SUBSEQUENT.at(-1).e));
        // The figures column prints whole: its heading, every row and its note on one page, the last.
        const figuresAt = pageOf('Figures as issued');
        expect(figuresAt, 'the figures column is not printed').toBeGreaterThanOrEqual(0);
        for (const text of [...FIGURE_LABELS, 'These figures are frozen at issue.']) {
          expect(squash(pages[figuresAt].text), `the figures column is split across pages at "${text}"`).toContain(squash(text));
        }
        expect(figuresAt).toBe(pages.length - 1);
        // and no section heading is the last line of a page.
        for (const [n, p] of pages.entries()) {
          const last = [...p.runs].sort((a, b) => a.y - b.y)[0];
          expect(['Letter', 'Key developments', 'Outlook', 'Subsequent events', 'Figures as issued'].includes(last.str.trim()),
            `page ${n + 1} ends on the heading "${last.str}"`).toBe(false);
        }
        expect(writes).toEqual([]);
      });
    }
  });
}
