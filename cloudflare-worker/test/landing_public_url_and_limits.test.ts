/**
 * Public URL system, abuse limits and lead attribution for founder landing
 * pages.
 *
 * These lock the invariants that the founder-facing "share your page" flow
 * depends on, several of which were previously wrong or absent:
 *
 *  - Social metadata existed nowhere in the worker (grep for `og:` returned 0),
 *    so every shared link unfurled as a bare URL. It is emitted from ONE helper
 *    because the <head> is inlined by 21 separate renderers.
 *  - A published page is reachable at BOTH /landing/{random-slug} and
 *    /p/{site}/{page}. Without a canonical they compete as duplicate content.
 *  - There was no page cap at all, and no honeypot or duplicate suppression on
 *    a public, unauthenticated write.
 *
 * Run: node --experimental-strip-types --test cloudflare-worker/test/landing_public_url_and_limits.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { renderLandingTemplate, TEMPLATE_KEYS, HONEYPOT_FIELD } from '../src/services/landingTemplates.ts';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const BRAND_TS = read('../src/routes/brand.ts');
const RATE_TS = read('../src/middleware/rateLimit.ts');
const TEMPLATES_TS = read('../src/services/landingTemplates.ts');

const baseRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  project_id: 7,
  name: 'Northwind Labs',
  slug: 'northwind-labs-a1b2c3',
  page_slug: 'home',
  headline: 'Ship faster',
  subheadline: 'The operating system for ambitious founders.',
  audience: 'customer',
  audience_customer_body: 'We help teams go from idea to traction.',
  cta_text: 'Join the waitlist',
  template: 'minimal',
  published: 1,
  ...over,
});

/* ─────────────────────── Open Graph / social cards ─────────────────────── */

test('every template emits Open Graph + Twitter Card meta', () => {
  for (const key of TEMPLATE_KEYS) {
    const html = renderLandingTemplate(baseRow({ template: key }), {
      slug: 'northwind-labs-a1b2c3',
      canonical: 'https://axal.vc/p/northwind',
    });
    assert.match(html, /<meta property="og:title"/, `${key}: missing og:title`);
    assert.match(html, /<meta property="og:type" content="website"/, `${key}: missing og:type`);
    assert.match(html, /<meta name="twitter:card"/, `${key}: missing twitter:card`);
    assert.match(html, /<meta property="og:url" content="https:\/\/axal\.vc\/p\/northwind"/, `${key}: missing og:url`);
    assert.match(html, /<link rel="canonical" href="https:\/\/axal\.vc\/p\/northwind"/, `${key}: missing canonical`);
  }
});

test('og:description carries the audience body copy', () => {
  const html = renderLandingTemplate(baseRow(), { slug: 's', canonical: 'https://axal.vc/p/x' });
  assert.match(html, /<meta property="og:description" content="We help teams go from idea to traction\."/);
});

test('a PREVIEW emits no social metadata at all', () => {
  // A draft preview is a private link. Unfurling it in a chat would leak an
  // unpublished page, so the whole block is suppressed — not merely noindexed.
  const html = renderLandingTemplate(baseRow(), { token: 'tok', noindex: true, canonical: 'https://axal.vc/p/x' });
  assert.doesNotMatch(html, /og:title/);
  assert.doesNotMatch(html, /twitter:card/);
  assert.doesNotMatch(html, /rel="canonical"/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow" \/>/);
});

test('og:image is emitted only for an absolute https logo', () => {
  // A crawler has no origin to resolve a relative path against, so a
  // same-origin logo must NOT be advertised as the card image.
  const rel = renderLandingTemplate(baseRow({ logo_url: '/uploads/logo.png' }), { slug: 's', canonical: 'https://a.b/c' });
  assert.doesNotMatch(rel, /og:image/, 'relative logo must not become og:image');

  const abs = renderLandingTemplate(baseRow({ logo_url: 'https://cdn.example.com/logo.png' }), { slug: 's', canonical: 'https://a.b/c' });
  assert.match(abs, /<meta property="og:image" content="https:\/\/cdn\.example\.com\/logo\.png"/);
});

test('the social meta block is defined once, not per renderer', () => {
  // The <head> is copy-pasted across 21 renderers; if a future change inlines
  // og tags into one of them the others silently fall behind.
  const defs = TEMPLATES_TS.match(/function socialMeta\(/g) || [];
  assert.equal(defs.length, 1, 'socialMeta must be a single shared helper');
  const calls = TEMPLATES_TS.match(/\$\{socialMeta\(bk, a\)\}/g) || [];
  assert.equal(calls.length, 21, `all 21 renderer heads must call it (found ${calls.length})`);
});

/* ──────────────────────────── canonical URL ────────────────────────────── */

test('canonical prefers the branded /p/ URL over the legacy random slug', () => {
  // Both URLs serve identical HTML; the branded one is the founder's choice
  // and is stable across re-publishes, so it must win.
  assert.match(BRAND_TS, /export async function canonicalPublicUrl/);
  assert.match(BRAND_TS, /SELECT slug FROM brand_sites WHERE project_id = \?/);
  assert.match(BRAND_TS, /\$\{origin\}\/p\/\$\{encodeURIComponent\(site\.slug\)\}/);
  // …and falls back to the legacy URL when the project has no site row.
  assert.match(BRAND_TS, /\$\{origin\}\/landing\/\$\{encodeURIComponent\(row\.slug\)\}/);
});

test('both public renderers resolve a canonical', () => {
  const landing = BRAND_TS.slice(BRAND_TS.indexOf('export async function renderLandingHtml'));
  assert.match(landing.slice(0, 900), /canonicalPublicUrl\(env, row, origin\)/);
  const site = BRAND_TS.slice(BRAND_TS.indexOf('export async function renderSitePage'));
  assert.match(site.slice(0, 1600), /canonicalPublicUrl\(env, row, origin\)/);
});

/* ───────────────────────────── abuse limits ────────────────────────────── */

test('page creation is capped server-side', () => {
  assert.match(BRAND_TS, /const MAX_PAGES_PER_PROJECT = 5/);
  const create = BRAND_TS.slice(BRAND_TS.indexOf("brand.post('/landing/by-project/:pid/pages'"));
  const head = create.slice(0, 1400);
  assert.match(head, /pageCountFor\(c\.env, pid\)/, 'must count existing pages');
  // Pin the GUARD ITSELF, not just the strings inside it. Asserting only on
  // the error body passes even if the condition is short-circuited to a
  // constant, which is exactly the regression this needs to catch.
  assert.match(
    head,
    /if \(existingCount >= MAX_PAGES_PER_PROJECT\) \{/,
    'the count must actually be compared against the cap',
  );
  assert.match(head, /page_limit_reached/, 'must return a machine-readable code');
  assert.match(head, /}, 409\)/, 'over-cap is a 409 conflict, not a 400');
});

test('reserved page slugs are rejected on BOTH write paths', () => {
  // Only blocking create would let a founder rename INTO a reserved slug.
  const hits = BRAND_TS.match(/RESERVED_PAGE_SLUGS\.has\(/g) || [];
  assert.ok(hits.length >= 2, `expected create + update to both check (found ${hits.length})`);
  for (const word of ['login', 'verify', 'billing', 'password']) {
    assert.ok(BRAND_TS.includes(`'${word}'`), `phishing-adjacent slug "${word}" must be reserved`);
  }
});

test('the public signup endpoint has its own strict rate bucket', () => {
  const bucket = RATE_TS.slice(RATE_TS.indexOf("name: 'landing_signup'"));
  assert.match(bucket.slice(0, 400), /scope: 'ip'/, 'unauthenticated → must be per-IP');
  assert.match(bucket.slice(0, 400), /failClosed: true/, 'spam control must not fail open');
  const limit = /limit: (\d+)/.exec(bucket.slice(0, 400));
  assert.ok(limit && Number(limit[1]) <= 20, 'signup limit must be strict');
});

test('page creation is rate limited per user, independent of the cap', () => {
  // The cap counts CURRENT pages, so create/delete/create churns forever
  // underneath it without this bucket.
  const bucket = RATE_TS.slice(RATE_TS.indexOf("name: 'landing_page_create'"));
  assert.match(bucket.slice(0, 400), /scope: 'user'/);
});

/* ──────────────────────── public form: bot + dupes ─────────────────────── */

test('every rendered form carries the honeypot, hidden four ways', () => {
  for (const key of TEMPLATE_KEYS) {
    const html = renderLandingTemplate(baseRow({ template: key }), { slug: 's' });
    assert.ok(html.includes(`name="${HONEYPOT_FIELD}"`), `${key}: no honeypot input`);
    assert.match(html, /aria-hidden="true"/, `${key}: honeypot not hidden from AT`);
    assert.match(html, /tabindex="-1"/, `${key}: honeypot reachable by keyboard`);
    assert.match(html, /autocomplete="off"/, `${key}: a password manager could fill it`);
  }
});

test('the honeypot is positioned off-screen, not display:none', () => {
  // Cruder scrapers deliberately skip display:none fields, which would defeat
  // the trap entirely.
  const html = renderLandingTemplate(baseRow(), { slug: 's' });
  const block = html.slice(html.indexOf(`name="${HONEYPOT_FIELD}"`) - 400, html.indexOf(`name="${HONEYPOT_FIELD}"`));
  assert.match(block, /left:-9999px/);
  assert.doesNotMatch(block, /display:none/);
});

test('a tripped honeypot returns ok:true and writes nothing', () => {
  // Answering with an error teaches a bot the trap exists.
  // Scope to the WHOLE handler: the ordering assertion below compares two
  // offsets, and a slice that clips the INSERT makes indexOf return -1, which
  // would pass or fail for reasons unrelated to the ordering being checked.
  const start = BRAND_TS.indexOf("brand.post('/landing/:slug/waitlist'");
  const handler = BRAND_TS.slice(start, BRAND_TS.indexOf("brand.post('/landing/:slug/view'", start));
  assert.ok(handler.length > 0, 'waitlist handler not found');
  assert.match(handler, /HONEYPOT_FIELD/);

  const iOk = handler.indexOf('return c.json({ ok: true });');
  const iInsert = handler.indexOf('INSERT INTO waitlist_signups');
  assert.notEqual(iOk, -1, 'honeypot early-return not found');
  assert.notEqual(iInsert, -1, 'waitlist INSERT not found');
  assert.ok(iOk < iInsert, 'the honeypot must short-circuit BEFORE any write');
});

test('a repeat email on the same page is not a second lead', () => {
  const handler = BRAND_TS.slice(BRAND_TS.indexOf("brand.post('/landing/:slug/waitlist'"));
  assert.match(handler.slice(0, 2600), /SELECT id FROM waitlist_signups WHERE landing_page_id = \? AND email = \?/);
  assert.match(handler.slice(0, 2600), /duplicate: true/);
});

test('the form posts utm + referrer, and both are allowlisted server-side', () => {
  const html = renderLandingTemplate(baseRow(), { slug: 's' });
  assert.match(html, /utm_source/, 'client must read utm params');
  assert.match(html, /document\.referrer/, 'client must read the referrer');
  // Server re-allowlists — the client list is a convenience, not a control.
  assert.match(BRAND_TS, /const UTM_KEYS = \['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'\]/);
  assert.match(BRAND_TS, /function pickUtm/);
});

/* ─────────────────────────── per-page attribution ──────────────────────── */

test('the waitlist list exposes landing_page_id', () => {
  // Without it the UI has nothing to attribute a signup by, which is why every
  // per-page "subs" count previously rendered 0.
  const listing = BRAND_TS.slice(BRAND_TS.indexOf("brand.get('/landing/by-project/:pid/waitlist'"));
  const sql = listing.slice(0, 1200);
  assert.match(sql, /SELECT id, landing_page_id, email/);
});

/* ───────────────────────────── new endpoints ───────────────────────────── */

test('public-url returns the shareable URL and its published state', () => {
  const ep = BRAND_TS.slice(BRAND_TS.indexOf("brand.get('/landing/pages/:id/public-url'"));
  const body = ep.slice(0, 900);
  assert.match(body, /canonicalPublicUrl\(c\.env, row, origin\)/);
  assert.match(body, /published: !!row\.published/, 'caller must be able to say the link is not live yet');
  assert.match(body, /projectOwned\(c\.env, user, row\.project_id\)/, 'must stay owner-scoped');
});

test('slug availability mirrors the three verdicts the write enforces', () => {
  const ep = BRAND_TS.slice(BRAND_TS.indexOf("brand.get('/landing/by-project/:pid/page-slug-available'"));
  const body = ep.slice(0, 1600);
  for (const reason of ['invalid', 'reserved', 'taken']) {
    assert.ok(body.includes(`'${reason}'`), `missing verdict: ${reason}`);
  }
  assert.match(body, /exclude_page_id/, 're-saving a page its own slug must not clash with itself');
  assert.match(body, /projectOwned/, 'must stay owner-scoped');
});
