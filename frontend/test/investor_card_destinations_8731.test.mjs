/**
 * D8731 part 2 (#8731, canvas `Studio Home Investor`, SIV-0 to SIV-12): each
 * Funds and Usage & quota action on Investor Studio is labelled with the
 * heading it opens, and opens it.
 *
 * - Funds: no commitment → "See Axal VC Fund terms" → Axal VC Fund › Fund and
 *   terms; needs linking → "Link my commitment" → › My commitment; linked (with
 *   or without one more under the email) → "Open My commitment", one action.
 *   Unavailable, loading and the preview draw no link. Never /funds.
 * - Usage & quota: "Compare investor plans" → Pricing › Investor (Q2 A); each
 *   failed read is Unreadable, never a default cap with 0 used; the inner
 *   "Compare plans" link is gone from the card.
 * - Destinations: "My commitment" and "Fund and terms" are h2 headings that
 *   take focus on arrival; an unreadable position is never "no commitment";
 *   "‹ Studio" leads the page on a phone (390) when a Studio card opened it,
 *   and is absent at desktop (1440).
 *
 * Three fixtures, as the canvas draws them: LP only, GP only, LP and GP.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/investor_card_destinations_8731.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { COMMITMENT, FROM_STUDIO, FUND_TERMS, LP_WORKSPACE } from '../src/pages/investor/investorHomeModel.js';
import { fundCommitmentTile, investorTiles } from '../src/pages/studio/tiles/investorTiles.jsx';
import { quickStats } from '../src/pages/investor/investorStudioParts.jsx';
import StudioModuleTile from '../src/pages/studio/StudioModuleTile.jsx';
import { QuotaBarsView, quotaView } from '../src/components/InvestorQuotaBars.jsx';
import { MyCommitment } from '../src/pages/SpinoutLabLpCommitment.jsx';
import { focusSectionHeading } from '../src/pages/SpinoutLabLpWorkspacePage.jsx';
import StudioBackLink, { openedFromStudio } from '../src/pages/investor/StudioBackLink.jsx';
import InvestorWorkspacePage from '../src/pages/investor/InvestorWorkspacePage.jsx';
import { renderedText } from './_renderedText.mjs';

const TODAY = '2026-11-26';
const html = (el, entries) => renderToStaticMarkup(h(MemoryRouter, entries ? { initialEntries: entries } : null, el));
const draw = (el) => renderedText(html(el));
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const HOLDING = { id: 11, fund_id: 1, fund_name: 'Axal Fund I', commitment_amount: 250000, invested_amount: 100000, lpa_signed: 1, lpa_signed_at: '2026-02-03' };
const LINKED = { lp_holdings: [HOLDING], capital_calls_recorded: true, capital_calls: [], performance: [{ lp_id: 11, invested_amount: 100000, tvpi: 1.12, dpi: 0 }] };

/** The canvas's three fixtures (SIV-0): LP only (Professional), GP only (Institutional, no LP row), LP and GP. */
const FIXTURES = {
  lp: { user: { role: 'investor', investor_tier: 'professional' }, fund: LINKED },
  gp: { user: { role: 'investor', investor_tier: 'institutional' }, fund: { lp_holdings: [] } },
  dual: { user: { role: 'investor', investor_tier: 'institutional' }, fund: LINKED },
};

const tilesFor = (fixture, extra = {}) => investorTiles({
  quick: quickStats({}), today: TODAY, user: fixture.user,
  records: { fund: fixture.fund, inbox: { count: 0 } }, retrySource: () => {}, ...extra,
});

const MOD = (key, title) => ({ key, title, group: 'investor' });

// ── Funds (SIV-2) ──────────────────────────────────────────────────────────────

test('LP only: the linked card opens Axal VC Fund › My commitment, one action, no GP line', () => {
  const t = tilesFor(FIXTURES.lp).fund_commitment;
  assert.deepEqual([t.state, t.openLabel, t.href, t.linkState], ['ready', 'Open My commitment', COMMITMENT, FROM_STUDIO]);
  assert.equal(COMMITMENT, '/spinout-lab/investor-workspace#my-commitment');
  const body = html(t.body);
  assert.match(renderedText(body), /Axal Fund I/);
  assert.doesNotMatch(body, /<a /, 'the card body carries no second link');
  assert.doesNotMatch(renderedText(body), /A fund you run is under Fund/);
  const tile = html(h(StudioModuleTile, { mod: MOD('fund_commitment', 'Funds'), size: 'L', spec: t }));
  assert.match(tile, /href="\/spinout-lab\/investor-workspace#my-commitment"[^>]*>Open My commitment ›</);
  assert.equal((tile.match(/<a /g) || []).length, 1, 'one action on the card');
});

test('GP only: no commitment opens the fund brief, says a fund you run is under Fund, and never /funds', () => {
  const t = tilesFor(FIXTURES.gp).fund_commitment;
  assert.deepEqual([t.state, t.openLabel, t.href, t.linkState], ['empty', 'See Axal VC Fund terms', FUND_TERMS, FROM_STUDIO]);
  assert.equal(FUND_TERMS, LP_WORKSPACE + '#fund');
  const tile = html(h(StudioModuleTile, { mod: MOD('fund_commitment', 'Funds'), size: 'L', spec: t }));
  assert.match(renderedText(tile), /You hold no fund commitment on Axal\..*Only your commitments as an LP are counted here\. A fund you run is under Fund\.See Axal VC Fund terms ›/s);
  assert.match(tile, /href="\/spinout-lab\/investor-workspace#fund"/);
  assert.doesNotMatch(tile, /href="\/funds/);
});

test('LP and GP: the card lists the LP commitment only, opens My commitment, and adds the GP line', () => {
  const t = tilesFor(FIXTURES.dual).fund_commitment;
  assert.deepEqual([t.openLabel, t.href], ['Open My commitment', COMMITMENT]);
  assert.match(draw(t.body), /Axal Fund I.*Only your commitments as an LP are counted here\. A fund you run is under Fund\./s);
  // The GP line follows Fund's own Institutional gate, not the role alone.
  const lapsed = tilesFor({ ...FIXTURES.dual, user: { ...FIXTURES.dual.user, investor_subscription_status: 'past_due' } }).fund_commitment;
  assert.doesNotMatch(draw(lapsed.body), /A fund you run is under Fund/);
});

test('needs linking: "Link my commitment" opens My commitment, whose plain lp-portal read links the row', () => {
  const t = tilesFor({ ...FIXTURES.lp, fund: { lp_holdings: [], unlinked_commitment: true } });
  assert.deepEqual([t.fund_commitment.state, t.fund_commitment.openLabel, t.fund_commitment.href], ['ready', 'Link my commitment', COMMITMENT]);
  assert.match(draw(t.fund_commitment.body), /A commitment under your email is not linked to this account yet\. Opening My commitment in Axal VC Fund links it\./);
  // The Needs you row says the same thing and goes to the same place.
  const row = html(t.needs_you.body);
  assert.match(renderedText(row), /Link your commitment in Axal VC Fund/);
  assert.match(row, /href="\/spinout-lab\/investor-workspace#my-commitment"[^>]*>Link my commitment</);
  assert.doesNotMatch(renderedText(row), /LP workspace/);
});

test('linked with one more under the email: still one action, and the rest is said, not linked', () => {
  const t = tilesFor({ ...FIXTURES.lp, fund: { ...LINKED, unlinked_commitment: true } }).fund_commitment;
  assert.deepEqual([t.openLabel, t.href], ['Open My commitment', COMMITMENT]);
  const body = html(t.body);
  assert.match(renderedText(body), /One more commitment under your email links when you open My commitment\./);
  assert.doesNotMatch(body, /<a /);
});

test('unavailable, loading and preview draw no link; unavailable says it is not a claim of no commitment', () => {
  const retried = [];
  const failed = tilesFor(FIXTURES.lp, { records: { fund: undefined }, failures: { fund: 'x' }, retrySource: (k) => retried.push(k) }).fund_commitment;
  assert.equal(failed.state, 'unreadable');
  assert.equal(failed.href, undefined);
  const tile = html(h(StudioModuleTile, { mod: MOD('fund_commitment', 'Funds'), size: 'L', spec: failed }));
  assert.match(renderedText(tile), /Funds could not be read · Try againNot a claim that you hold no commitment\./);
  assert.doesNotMatch(tile, /<a /);
  failed.onRetry();
  assert.deepEqual(retried, ['fund']);
  const loading = fundCommitmentTile({ fund: undefined, funds: { rows: [] }, fundUnreadable: false, retry: () => {} });
  assert.deepEqual([loading.state, loading.href], ['loading', undefined]);
  const preview = tilesFor(FIXTURES.lp, { previewing: true });
  assert.equal(preview.fund_commitment.state, 'withheld');
  assert.equal(preview.usage_quota.state, 'withheld');
  for (const key of ['fund_commitment', 'usage_quota']) {
    assert.doesNotMatch(html(h(StudioModuleTile, { mod: MOD(key, key), size: 'L', spec: { ...preview[key], href: '/x' } })), /<a /, `${key}: a withheld tile draws no link`);
  }
});

test('no Funds state links to Run my fund', () => {
  const states = [
    FIXTURES.lp, FIXTURES.gp, FIXTURES.dual,
    { ...FIXTURES.lp, fund: { lp_holdings: [], unlinked_commitment: true } },
    { ...FIXTURES.lp, fund: { ...LINKED, unlinked_commitment: true } },
  ].map((f) => tilesFor(f).fund_commitment);
  for (const t of states) assert.ok(String(t.href).startsWith(LP_WORKSPACE + '#'), `${t.openLabel} → ${t.href}`);
  assert.deepEqual(states.map((t) => t.openLabel), ['Open My commitment', 'See Axal VC Fund terms', 'Open My commitment', 'Link my commitment', 'Open My commitment']);
});

// ── Usage & quota (SIV-7, Q2 option A) ─────────────────────────────────────────

test('Usage & quota opens Pricing › Investor as "Compare investor plans"; not the investor account, no link', () => {
  const t = tilesFor(FIXTURES.lp).usage_quota;
  assert.deepEqual([t.state, t.openLabel, t.href, t.linkState], ['ready', 'Compare investor plans', '/pricing?for=investor', FROM_STUDIO]);
  const admin = investorTiles({ quick: quickStats({}), today: TODAY, user: { role: 'admin' }, records: {}, retrySource: () => {} }).usage_quota;
  assert.equal(admin.href, undefined);
  assert.match(draw(admin.body), /Quota data is available only to the signed-in investor account\./);
});

test('quotaView: each figure from the read that has it, or null; never a default cap with 0 used', () => {
  const billing = { tier: 'professional', quotas: { intros_used: 4, intros_per_quarter: 25, dealroom_used: 3, dealroom_max: 5 } };
  const intros = { tier: 'professional', used: 4, cap: 10, quarter: '2026-Q4' };
  assert.deepEqual(quotaView(billing, intros), { tier: 'professional', intros: { used: 4, cap: 10, quarter: '2026-Q4' }, dealrooms: { used: 3, cap: 5 }, unreadable: false, planUnreadable: false });
  // B · plan status unreadable, intros read: the tier and intros still show; deal rooms are Unreadable.
  assert.deepEqual(quotaView(null, intros), { tier: 'professional', intros: { used: 4, cap: 10, quarter: '2026-Q4' }, dealrooms: null, unreadable: false, planUnreadable: true });
  // The intro read failed: the billing read carries the intro count.
  assert.deepEqual(quotaView(billing, null).intros, { used: 4, cap: 25, quarter: null });
  // C · both reads failed.
  assert.equal(quotaView(null, null).unreadable, true);
  // A read that answered without a figure does not become 0.
  assert.equal(quotaView({ tier: 'free', quotas: { dealroom_max: 1 } }, null).dealrooms, null);
  assert.equal(quotaView({ quotas: {} }, null).tier, null);
});

test('the compact bars: no inner "Compare plans", Unreadable per failed source, one Try again when both fail', () => {
  const ok = html(h(QuotaBarsView, { view: quotaView({ tier: 'professional', quotas: { intros_used: 4, intros_per_quarter: 10, dealroom_used: 3, dealroom_max: 5 } }, null), compact: true }));
  assert.match(renderedText(ok), /Investor plan · professional.*Warm intros \/ quarter4 \/ 10.*Active deal rooms3 \/ 5/s);
  assert.doesNotMatch(ok, /Compare plans|<a /);
  const part = renderedText(html(h(QuotaBarsView, { view: quotaView(null, { tier: 'professional', used: 4, cap: 10 }), compact: true })));
  assert.match(part, /Warm intros \/ quarter4 \/ 10.*Active deal roomsUnreadable.*Your plan status could not be read · Try again/s);
  assert.doesNotMatch(part, /0 \/ 1|0 \/ 3/);
  const none = html(h(QuotaBarsView, { view: quotaView(null, null), compact: true }));
  assert.match(renderedText(none), /^Usage & quota could not be read ·Try again$/);
  assert.match(none, /role="alert"/);
  assert.doesNotMatch(none, /Warm intros|deal rooms/);
  // Off Studio (not compact) the full card keeps its own Compare plans link.
  assert.match(html(h(QuotaBarsView, { view: quotaView({ tier: 'free', quotas: { intros_used: 0, intros_per_quarter: 3, dealroom_used: 0, dealroom_max: 1 } }, null) })), /Compare plans/);
});

// ── Destinations (SIV-3, SIV-11) ───────────────────────────────────────────────

test('My commitment is an h2 that takes focus; unreadable says so and is never "no commitment"', () => {
  const failed = html(h(MyCommitment, { portal: null, failed: true, onReload: () => {} }));
  assert.match(failed, /<section id="my-commitment" aria-labelledby="my-commitment-heading"/);
  assert.match(failed, /<h2 id="my-commitment-heading" tabindex="-1" data-section-heading=""[^>]*>My commitment<\/h2>/);
  assert.match(renderedText(failed), /Your LP position.*This is not a claim that you hold no commitment\./s);
  assert.doesNotMatch(renderedText(failed), /No commitment is recorded/);
});

test('Fund and terms is an h2 that takes focus', () => {
  const src = read('../src/pages/investor/fund/FundOverviewSection.jsx');
  assert.match(src, /<section id="fund" aria-labelledby="fund-heading"/);
  assert.match(src, /<h2 id="fund-heading" tabIndex=\{-1\} data-section-heading=""[^>]*>Fund and terms<\/h2>/);
  assert.match(src, /The fund brief, open to every investor/);
});

test('arriving at a section focuses its heading without scrolling again', () => {
  const calls = [];
  const heading = { focus: (opts) => calls.push(opts) };
  assert.equal(focusSectionHeading({ querySelector: (sel) => (sel === '[data-section-heading]' ? heading : null) }), true);
  assert.deepEqual(calls, [{ preventScroll: true }]);
  assert.equal(focusSectionHeading({ querySelector: () => null }), false);
  assert.equal(focusSectionHeading(null), false);
  // The workspace's hash effect calls it after scrolling to the section.
  assert.match(read('../src/pages/SpinoutLabLpWorkspacePage.jsx'), /scroll\(\);\n\s+\/\/ D8731[^\n]*\n\s+focusSectionHeading\(target\);/);
});

// ── ‹ Studio on a phone (SIV-9), absent at desktop ────────────────────────────

function atWidth(phone, fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const before = globalThis.window;
  globalThis.window = { matchMedia: () => ({ matches: phone, addEventListener() {}, removeEventListener() {} }) };
  try { return fn(); } finally { if (had) globalThis.window = before; else delete globalThis.window; }
}

const fromStudio = (pathname) => [{ pathname, state: FROM_STUDIO, key: 'k1' }];
const workspace = (entries) => html(h(InvestorWorkspacePage, { page: 'axal-vc-fund' }, h('p', null, 'body')), entries);

test('openedFromStudio reads only the Studio card state', () => {
  assert.equal(openedFromStudio(FROM_STUDIO), true);
  assert.equal(openedFromStudio({ from: 'deals' }), false);
  assert.equal(openedFromStudio(null), false);
  assert.equal(openedFromStudio('studio'), false);
});

test('390: Axal VC Fund opened from a Studio card leads with ‹ Studio, before its h1', () => {
  const page = atWidth(true, () => workspace(fromStudio(COMMITMENT.replace('#my-commitment', ''))));
  const back = page.indexOf('data-testid="link-back-studio"');
  assert.ok(back > -1, 'the back link is drawn');
  assert.ok(back < page.indexOf('<h1'), 'it is the first stop, before the h1');
  assert.match(page, />‹ Studio</);
  assert.match(page, /<h1[^>]*>Axal VC Fund<\/h1>/);
});

test('1440, or reached another way: no ‹ Studio', () => {
  assert.doesNotMatch(atWidth(false, () => workspace(fromStudio('/spinout-lab/investor-workspace'))), /link-back-studio/);
  assert.doesNotMatch(atWidth(true, () => workspace(['/spinout-lab/investor-workspace'])), /link-back-studio/);
});

test('390: Pricing opened from Usage & quota offers ‹ Studio too', () => {
  const back = atWidth(true, () => html(h(StudioBackLink), [{ pathname: '/pricing', search: '?for=investor', state: FROM_STUDIO, key: 'k2' }]));
  assert.match(back, /‹ Studio/);
  assert.match(read('../src/pages/PricingPage.jsx'), /<StudioBackLink \/><PricingBody user=\{user\} \/>/);
});

test('every card link carries the Studio state', () => {
  assert.match(read('../src/pages/studio/StudioModuleTile.jsx'), /<Link to=\{href\} state=\{spec\?\.linkState\}/);
  assert.match(read('../src/pages/studio/tiles/investorHomeModules.jsx'), /<Link to=\{row\.action\.to\} state=\{FROM_STUDIO\}/);
});
