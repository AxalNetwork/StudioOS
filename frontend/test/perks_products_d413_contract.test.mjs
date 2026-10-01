/**
 * D413 — Perks & Products, built from `design/canvases/backlog/Perks &
 * Products.dc.html`. The canvas is sliced at BOTH ends of every section this
 * file reads, so a section that moves or is renamed fails here rather than
 * leaving an assertion to pass against the rest of the file.
 *
 * Three kinds of claim:
 *   1. The page draws what the canvas draws — its tabs, filters, headings,
 *      CTAs, form fields and Performance tiles, in the canvas's words.
 *   2. What the canvas draws that the store cannot say is the Worker's own
 *      sentence on the page, never a fixture, a zero or an invented promise.
 *   3. The partner side lives in /offers/perk-deals, and a partner on /perks is
 *      sent there.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { apiMethodNames, apiCallsIn } from './_apiMethods.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const CANVAS = raw('design/canvases/backlog/Perks & Products.dc.html');
const pageRaw = raw('frontend/src/pages/PerksPage.jsx');
const page = codeOnly(pageRaw);
const worker = raw('cloudflare-worker/src/routes/perks.ts');
const app = raw('frontend/src/App.jsx');
const routes = raw('frontend/src/workspaces/partner/PartnerBucketRoutes.jsx');

/** The text between two markers, with BOTH ends proven to exist. */
function between(src, a, b) {
  const from = src.indexOf(a);
  assert.ok(from >= 0, `the opening marker is gone: ${a}`);
  const to = src.indexOf(b, from + a.length);
  assert.ok(to > from, `the closing marker is gone: ${b}`);
  return src.slice(from, to);
}
/** The `l:'…'` values inside one canvas array literal. A literal regex, never a built one. */
const labelsIn = (src) => [...src.matchAll(/\bl:'([^']+)'/g)].map((m) => m[1]);

const MARKET = between(CANVAS, '<!-- ============ 1 · MARKETPLACE', '<!-- ============ 2 · MY PERKS');
const MINE = between(CANVAS, '<!-- ============ 2 · MY PERKS', '<!-- ============ 3 · PARTNER SUBMIT');
const MODAL = between(CANVAS, '<!-- ============ CLAIM MODAL ============ -->\n  <sc-if', '</x-dc>');
const SUBMIT_JS = between(CANVAS, '// ============ PARTNER SUBMIT ============', '// ============ PARTNER ANALYTICS ============');
const ANALYTICS_JS = between(CANVAS, '// ============ PARTNER ANALYTICS ============', '// ============ TABS ============');
const TABS_JS = between(CANVAS, '// ============ TABS ============', 'const isFounder');
const FILTERS_JS = between(CANVAS, '// ============ FILTERS ============', '// ============ MY PERKS ============');

const MARKETPLACE = between(page, 'function Marketplace(', 'function nextSteps(');
const CLAIM = between(page, 'function ClaimModal(', 'const CLAIM_STATE = {');
const MYPERKS = between(page, 'const CLAIM_STATE = {', 'const INPUT = ');
const PERF = between(page, 'function ListingPerformance(', 'function PartnerConsole(');
const CONSOLE = between(page, 'function PartnerConsole(', 'function ReviewQueue(');
const REVIEW = between(page, 'function ReviewQueue(', 'export default function PerksPage(');
const MARKET_PAGE = between(page, 'function PerksMarket(', '<WorkerRail');

/* ---------------------------------------------------------------- *
 * 1 · The page draws the canvas                                     *
 * ---------------------------------------------------------------- */

test('the founder tabs are the canvas’s two, with the admin queue after them', () => {
  const founderTabs = labelsIn(between(TABS_JS, 'const FOUNDER_TABS = [', '];'));
  assert.deepEqual(founderTabs, ['Marketplace', 'My perks']);
  const tabs = between(MARKET_PAGE, 'const tabs = useMemo(', '}, [isAdmin, mine]);');
  assert.deepEqual([...tabs.matchAll(/label: '([^']+)'/g)].map((m) => m[1]), [...founderTabs, 'Review queue']);
  assert.match(tabs, /if \(isAdmin\) t\.push\(\{ k: 'review'/, 'the review queue is no longer admin-only');
  // The My perks flag is the Worker's claim count, not a length the page counted.
  assert.match(tabs, /flag: mine \? String\(mine\.stats\.claimed\) : ''/);
});

test('the affordability switch is the canvas’s three, and each does what its label says', () => {
  const canvas = labelsIn(between(FILTERS_JS, 'const AFFORD = [', '];'));
  const ours = [...between(page, 'const AFFORD = [', '];').matchAll(/label: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(ours, canvas);
  const pass = between(page, 'export function passesAfford(', '\n}\n');
  assert.match(pass, /if \(afford === 'afford'\) return p\.claimable && !p\.claimed;/);
  // "No credits needed" is the canvas's `free`: a plan-included perk this plan includes.
  assert.match(pass, /if \(afford === 'free'\) return p\.kind === 'tier' && p\.reason !== 'tier_required';/);
});

test('the marketplace draws the canvas’s sections and empty state', () => {
  for (const words of ['Featured this month', 'All perks &amp; products', 'Nothing matches that filter', 'Clear filters']) {
    assert.ok(MARKET.includes(words), `the canvas no longer says ${words}`);
    assert.ok(MARKETPLACE.includes(words), `the marketplace no longer says ${words}`);
  }
  // Category chips carry counts, as the canvas's `c.n` does — over every listing.
  assert.match(MARKETPLACE, /items\.filter\(\(p\) => p\.category === k\)\.length/);
  // The featured quote is the Worker's editorial_note, which only admin review writes.
  assert.match(MARKETPLACE, /p\.editorial_note && \(/);
  assert.match(worker, /editorial_note: p\.featured \? \(p\.editorial_note \?\? null\) : null/);
});

test('a card says "Not yet rated" rather than a zero, and draws the served average', () => {
  assert.ok(MARKET.includes('Not yet rated'));
  const line = between(page, 'function RatingLine(', 'export function PerkCard(');
  assert.match(line, /rating\.average === null/);
  assert.ok(line.includes('Not yet rated'));
  assert.match(line, /rating\.average\.toFixed\(1\)/);
});

test('the CTA and gate note are the canvas’s, and a paid engagement is requested, not bought', () => {
  const ctaOf = between(CANVAS, 'const ctaOf = (p) => {', 'const decorate = (p) => {');
  assert.ok(ctaOf.includes("label:'Upgrade to claim'") && ctaOf.includes("label:'Not enough credits'") && ctaOf.includes("label:'Claimed'"));
  assert.match(page, /tier_required: 'Upgrade to claim',/);
  assert.match(page, /insufficient_credits: 'Not enough credits',/);
  const card = between(page, 'export function PerkCard(', 'const AFFORD = [');
  assert.match(card, /p\.claimed\s*\? 'Claimed'/);
  assert.ok(!/'Buy'/.test(page), 'nothing is charged here, so nothing says Buy');
  assert.ok(CANVAS.includes("'Available on ' + p.tier + ' and above'"));
  assert.match(card, /Available on \{tierName\(p\.required_tier\)\} and above/);
});

test('the claim modal draws the canvas’s review and done steps', () => {
  for (const words of ['Balance now', 'After claiming', 'What happens next', 'View in My perks', 'Back to marketplace']) {
    assert.ok(MODAL.includes(words), `the canvas modal no longer says ${words}`);
    assert.ok(CLAIM.includes(words), `the claim modal no longer says ${words}`);
  }
  const headers = between(CANVAS, "costHeader: selRaw.kind === 'credits'", '\n');
  for (const h of ['Credit balance', 'Plan entitlement', 'Price']) {
    assert.ok(headers.includes(`'${h}'`));
    assert.ok(CLAIM.includes(`'${h}'`), `the modal lost the ${h} header`);
  }
  // Its labels follow the canvas's claimBtnLabel, with Request for money.
  assert.match(CLAIM, /`Request · \$\{money\(d\.price_cents\) \|\| 'quoted'\}`/);
  assert.match(CLAIM, /`Claim · included in \$\{tierName\(d\.required_tier\)\}`/);
  assert.match(CLAIM, /`Claim · \$\{n0\(cost\)\} credits`/);
  assert.match(CLAIM, /`Upgrade to \$\{tierName\(d\.required_tier\)\}`/);
  // An upgrade goes to plan pricing, which D413 does not retire.
  assert.match(CLAIM, /<Link to="\/plans-and-pricing"/);
  // A refusal prints the Worker's sentence and re-reads on the codes that mean the listing moved.
  assert.match(CLAIM, /setErr\(e\?\.message \|\| 'Could not claim this perk\.'\)/);
  assert.match(CLAIM, /\['cap_reached', 'perk_ended', 'insufficient_credits', 'tier_required'\]\.includes\(e\?\.code\)/);
});

test('My perks draws the canvas’s three tiles from the Worker’s stats, and computes no dates', () => {
  const canvas = between(CANVAS, 'const mineStats = [', '];');
  assert.deepEqual([...canvas.matchAll(/k:'([^']+)'/g)].map((m) => m[1]), ['Claimed', 'Credits spent', 'Expiring in 30d']);
  const tiles = between(MYPERKS, "data-testid=\"perks-mine-stats\"", '].map(');
  assert.match(tiles, /\['Claimed', n0\(data\.stats\.claimed\)\]/);
  assert.match(tiles, /\['Perk credits spent', n0\(data\.stats\.credits_spent\)\]/);
  assert.match(tiles, /\[`Expiring in \$\{data\.stats\.expiring_within_days\}d`, n0\(data\.stats\.expiring\)\]/);
  // The window and the day count are served; a copy here could disagree with the partner zone.
  assert.ok(!/Date\.now|new Date|86400000|getUTCDate/.test(MYPERKS), 'My perks is doing date arithmetic');
  assert.match(MYPERKS, /c\.days_left > 0 \? `\$\{c\.days_left\} day/);
  assert.match(worker, /expiring: daysLeft !== null && daysLeft <= PERK_EXPIRING_WITHIN_DAYS,/);
});

test('the ledger has a running balance and none of the canvas’s invented lines', () => {
  assert.ok(MINE.includes('{{ l.balance }}'), 'the canvas no longer draws a running balance');
  assert.match(MYPERKS, /for \(const l of ledger\) \{ balances\.push\(bal\); bal -= Number\(l\.delta\); \}/);
  const ledgerBase = between(CANVAS, 'const LEDGER_BASE = [', '];');
  assert.ok(/monthly allowance/.test(ledgerBase) && /Referral credit/.test(ledgerBase) && /Annual plan bonus/.test(ledgerBase));
  for (const invented of [/allowance/i, /referral/i, /annual/i, /refresh on the 8th/i, /resets on the/i]) {
    assert.ok(!invented.test(MYPERKS), `My perks invents ${invented}`);
  }
  assert.ok(!/refresh on the 8th/i.test(page), 'nothing refreshes credits, so nothing may say it does');
});

test('a redeemed claim can be rated, through the route D412 built', () => {
  assert.match(MYPERKS, /await api\.perkRate\(c\.perk_uid, n\)/);
  assert.match(MYPERKS, /c\.can_rate \?/);
});

test('the partner form is the canvas’s fields, with the three methods the column accepts', () => {
  const fields = [...between(SUBMIT_JS, 'const subFields = [', '].map(').matchAll(/label:'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(fields, ['The offer, as a founder would read it', 'Cash value', 'Category', 'How founders redeem it',
    'Claim cap', 'Listing duration', 'The detail']);
  for (const f of fields) assert.ok(CONSOLE.includes(`label="${f}"`), `the form has no ${f} field`);
  // The canvas has four methods; migration 186's CHECK admits three.
  assert.match(SUBMIT_JS, /const METHODS = \['Code','Link','Introduction','Instant'\];/);
  const method = between(CONSOLE, 'label="How founders redeem it"', '</select>');
  assert.deepEqual([...method.matchAll(/<option value="([a-z]+)">([^<]+)<\/option>/g)].map((m) => [m[1], m[2]]),
    [['code', 'Code'], ['link', 'Link'], ['intro', 'Introduction']]);
  assert.ok(!/Instant/.test(CONSOLE), 'Instant is offered, and the column refuses it');
  // Duration is the canvas's four options and writes the offer's own end date.
  assert.ok(SUBMIT_JS.includes("options:['3 months','6 months','12 months','Ongoing']"));
  for (const o of ['Ongoing', '3 months', '6 months', '12 months']) assert.ok(CONSOLE.includes(`>${o}</option>`));
  assert.match(CONSOLE, /ends_at: months \? end\.toISOString\(\)\.slice\(0, 10\) : ''/);
  // Value crosses the wire in integer cents and a non-number is refused, never zeroed.
  assert.match(CONSOLE, /const valueCents = Math\.round\(Number\(form\.value\.replace\(/);
  assert.match(CONSOLE, /if \(!Number\.isFinite\(valueCents\) \|\| valueCents < 0\) \{ setErr\(/);
  assert.match(CONSOLE, /value_cents: valueCents,/);
  // The canvas's button rule.
  assert.ok(CANVAS.includes("subBtnLabel: subOk ? 'Submit for review' : 'Fill the offer, value and detail'"));
  assert.ok(CONSOLE.includes("'Fill the offer, value and detail'"));
});

test('the live preview is the marketplace card itself, "Not yet rated"', () => {
  assert.ok(CANVAS.includes("ratingNote:'Not yet rated'"));
  const preview = between(CONSOLE, '<PerkCard\n                preview', '/>');
  assert.match(preview, /rating: \{ count: 0, average: null \}/);
});

test('Performance draws the canvas’s four tiles and four funnel steps from the Worker', () => {
  const canvasTiles = [...between(ANALYTICS_JS, 'const anStats = [', '];').matchAll(/k:'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(canvasTiles, ['Claims', 'Redemption rate', 'Founders reached', 'Cost per founder']);
  const strip = between(PERF, 'data-testid="perk-performance-strip"', '</div>');
  assert.deepEqual([...strip.matchAll(/label="([^"]+)"/g)].map((m) => m[1]), canvasTiles);
  const canvasFunnel = [...between(ANALYTICS_JS, 'const FUNNEL = [', '];').matchAll(/k:'([^']+)'/g)].map((m) => m[1]);
  const ours = [...between(PERF, 'const funnel = s ? [', '] : [];').matchAll(/k: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(ours, canvasFunnel);
  assert.match(PERF, /\{ k: 'Card views', n: null, why: s\.absent\?\.card_views \}/);
  assert.match(PERF, /\{ k: 'Opened the detail', n: s\.views,/);
  assert.match(PERF, /\{ k: 'Claimed', n: s\.claims,/);
  assert.match(PERF, /\{ k: 'Redeemed with you', n: s\.redeemed,/);
  assert.match(PERF, /api\.perkStats\(uid\), api\.perkClaimsForListing\(uid\)/);
});

test('the partner marks claims redeemed and raises the cap on this panel', () => {
  assert.match(PERF, /await api\.perkRedeem\(uid, body\)/);
  assert.match(PERF, /redeem\(\{ claim_uid: c\.uid \}\)/);
  assert.match(PERF, /redeem\(\{ code: code\.trim\(\) \}\)/);
  assert.ok(ANALYTICS_JS.length > 0 && CANVAS.includes('>Raise the cap</div>'));
  assert.ok(PERF.includes('Raise the cap'));
  assert.match(PERF, /await api\.perkUpdate\(uid, \{ claim_cap: next \}\)/);
  // The Worker says whether the edit sent it back to review; the page repeats it.
  assert.match(PERF, /r\?\.reviewed_again/);
});

test('the zone’s export and lifecycle row say claimed and redeemed apart', () => {
  const view = between(routes, "'perk-deals': (user) =>", "visibility: () =>");
  assert.match(view, /header: \['Offer', 'State', 'Claimed', 'Redeemed', 'Cap',/);
  assert.match(view, /cells: \(p\) => \[p\.offer, p\.lifecycle, p\.claim_count, p\.redeemed_count, p\.claim_cap,/);
});

/* ---------------------------------------------------------------- *
 * 2 · Absences are the Worker's sentences                           *
 * ---------------------------------------------------------------- */

test('every absence the page prints is one the Worker serves', () => {
  const printed = [
    ['data.absent?.expiry_reminder', 'expiry_reminder:'],
    ['absent.partner_contact', 'partner_contact: PARTNER_NOT_TOLD'],
    ['s.absent?.card_views', 'card_views:'],
    ['s.absent?.founders_list', 'founders_list:'],
    ['s.absent?.bd_console', 'bd_console:'],
    ['s.absent?.redemption_rate', 'redemption_rate:'],
    ['s.absent?.cost_per_founder', 'cost_per_founder:'],
    ['absent.review_criteria', 'review_criteria:'],
  ];
  for (const [onPage, inWorker] of printed) {
    assert.ok(page.includes(onPage), `the page no longer prints ${onPage}`);
    assert.ok(worker.includes(inWorker), `the Worker no longer serves ${inWorker}`);
  }
  // Claimant status once, in the Worker's words.
  assert.match(MARKET_PAGE, /\{catalog\.claimant_reason\}/);
});

test('none of the canvas’s unbacked promises ship', () => {
  for (const phrase of [
    'Credits refresh on the 8th', 'roughly one in three', 'about five business days', 'syncs into your BD console',
    'pause the listing at any time', 'you get a reminder two weeks out',
    'not because a partner paid for placement', 'Open BD console', 'We hold one or two perks per category',
  ]) {
    assert.ok(CANVAS.includes(phrase), `the canvas no longer says "${phrase}", so this guard is stale`);
    assert.ok(!pageRaw.includes(phrase), `the page repeats "${phrase}", which nothing in the product does`);
  }
  // And the old page's own: the partner is not told who claimed (D413), so
  // it cannot have anyone's details.
  assert.ok(!pageRaw.includes('has your details and will be in touch'));
});

test('the canvas’s placeholder companies stay out, including the partner-side ones', () => {
  for (const name of ['Northwind Data', 'Orrick Labs', 'Halyard Security', 'Verity Health', 'Lumenpath', 'Priya Menon', 'Meridian']) {
    assert.ok(CANVAS.includes(name));
    assert.ok(!pageRaw.includes(name), `${name} is a canvas placeholder`);
  }
});

/* ---------------------------------------------------------------- *
 * 3 · Where each side lives                                         *
 * ---------------------------------------------------------------- */

test('a partner on /perks is sent to /offers/perk-deals; the rest use the standalone Perks page', () => {
  const at = app.indexOf('<Route path="/perks"');
  const line = app.slice(at, app.indexOf('\n', at));
  assert.match(line, /effectiveRole === 'partner' \? <Navigate replace to="\/offers\/perk-deals" \/> : <PerksPage user=\{user\} \/>/);
  assert.doesNotMatch(line, /PartnerWorkspaceTabs|FounderWorkspaceTabs/,
    'the standalone Perks page must not inherit the Offers or Founder shell tabs');
  // And the destination admits a partner, or the redirect lands on a refusal.
  assert.match(app, /<Route path="\/offers\/perk-deals" element=\{guard\(\['admin', 'partner'\], <PartnerBucketRoutes \/>\)\} \/>/);
});

test('the standalone page fills the column, and the rail is the canvas’s right edge', () => {
  const sidebar = raw('frontend/src/sidebarConfig.js');
  assert.match(sidebar, /export const SHARED_FULL_BLEED = \[[\s\S]*?'\/perks'/);
  assert.match(page, /className="perks-canvas"/);
  assert.match(page, /className="perks-rail"/);
  assert.ok(!page.includes('max-w-6xl'), 'the listings sit in a centred column beside a detached rail');
});

test('the page mounts one Worker rail, on /perks only, in the canvas’s violet', () => {
  assert.equal((page.match(/<WorkerRail\b/g) || []).length, 1);
  const guard = page.indexOf('if (embedded) {');
  assert.ok(guard > 0 && page.indexOf('<WorkerRail') > guard, 'the zone would get a second rail beside the shell’s');
  const rail = between(page, '<WorkerRail', '/>');
  assert.match(rail, /role="founder"/);
  assert.match(rail, /coverage=\{coverage\}/);
  assert.match(rail, /\['Expiry reminders', mine\.absent\.expiry_reminder\]/);
});

test('every perk api method the page calls is defined and mounted', () => {
  const called = [...apiCallsIn(pageRaw)].filter((m) => m.startsWith('perk'));
  for (const m of ['perkStats', 'perkClaimsForListing', 'perkRedeem', 'perkRate', 'perkUpdate', 'perkReview']) {
    assert.ok(called.includes(m), `the page no longer calls ${m}`);
  }
  const defined = apiMethodNames(raw('frontend/src/lib/api.js'));
  for (const m of called) assert.ok(defined.has(m), `api.js does not define ${m}`);
});

test('the admin queue writes the featured flag and the editorial quote', () => {
  assert.match(REVIEW, /\.\.\.\(featured\[uid\] \? \{ featured: true \} : \{\}\)/);
  assert.match(REVIEW, /\.\.\.\(editorial\[uid\] \? \{ editorial_note: editorial\[uid\] \} : \{\}\)/);
  assert.match(worker, /const editorial = b\?\.editorial_note === undefined \? perk\.editorial_note/);
});
