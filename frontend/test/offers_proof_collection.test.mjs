/**
 * Offers · Proof — the `po4` artboard, and the two things it says that this
 * shelf cannot.
 *
 * THE ZONE'S ARGUMENT WAS ALREADY THE ARTBOARD'S. "Consent is a gate rather
 * than a warning — an unconsented outcome has no published form to suppress, so
 * it simply is not one." The store has enforced that since migration 209:
 * `is_published` is computed as `consent_given = 1 AND withdrawn_at IS NULL`,
 * both halves, at read time, and there is no API method that sets it. What was
 * missing was the artboard — the four-tile strip, the `Outcome shelf`
 * instrument, and the AI band.
 *
 * TWO PLACES THE SHELF DIVERGES, BOTH BECAUSE THE ARTBOARD ASSUMES A PRODUCT
 * THIS ONE IS NOT.
 *
 *   ITS SHELF IS ENTIRELY SEAM-FED — "none of it originates here" — because
 *   every row there came out of an engagement record the client can see from
 *   their side. Here an item can be typed by hand, and one with no engagement
 *   behind it has no other side at all. So the seam mark is earned per row and
 *   a row without one reads absent, which is the strongest thing that column
 *   can say.
 *
 *   ITS `Blocked` MEANS "engagement not complete". Nothing links a proof item
 *   to an engagement's completion, and the one state in this store that blocks
 *   publication for a reason other than an unanswered ask is a consent taken
 *   back. So `Blocked` is `withdrawn`, and the instNote says which.
 *
 * AND ONE NOTE IS DELIBERATELY NOT COPIED. The artboard's `Published` tile
 * reads "live on the public profile". There is no public profile — `Preview
 * public page` is still prose for exactly that reason — and repeating the note
 * would have the strip promise a page that does not exist.
 *
 * D4842 (#4842) REDRAWS THE ZONE TO OFFERS V2 (OF-03): result cards, outcome
 * first, with OF-03's five chips. The strip and the shelf are gone, so the
 * tests that held them now hold the cards. What the store guarantees is
 * unchanged and still pinned here: one function decides the state, the never-
 * asked state is never called a request, the draft band counts this firm's
 * held items, and no page promises a public profile.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const read = (p) => codeOnly(raw(p));

const CANVAS = raw('design/canvases/integrated/Pages · Partner Offers.dc.html');
const zoneRaw = raw('frontend/src/pages/partner/offers/ProofZone.jsx');
const zone = read('frontend/src/pages/partner/offers/ProofZone.jsx');
const actions = read('frontend/src/workspaces/partnerZoneActions.js');
const actionsRaw = raw('frontend/src/workspaces/partnerZoneActions.js');
const filters = read('frontend/src/workspaces/partnerZoneFilters.js');
const app = raw('frontend/src/App.jsx');
const spec = raw('cloudflare-worker/src/routes/research.ts');
const V2 = raw('design/incoming/Offers v2 Page.dc.html');
const V2_PROOF = V2.slice(V2.indexOf('const proof = () =>'), V2.indexOf('const proofEmpty = () =>'));
assert.ok(V2_PROOF.includes("head('Proof'"), 'the Offers v2 proof board could not be found');

const PO4 = CANVAS.slice(CANVAS.indexOf("{ id:'po4'"), CANVAS.indexOf("{ id:'po5'"));
assert.ok(PO4.includes("route:'/offers/proof'"), 'the po4 artboard could not be found in the canvas');

/** The source between two markers, with BOTH ends proven to exist. */
function between(src, a, b) {
  const from = src.indexOf(a);
  assert.ok(from >= 0, `the opening marker is gone: ${a}`);
  const to = src.indexOf(b, from + a.length);
  assert.ok(to > from, `the closing marker is gone: ${b}`);
  return src.slice(from, to);
}

/** The `{…}` entries of the array opening at `after`, each bounded at its own brace. */
function entriesIn(src, after) {
  const at = src.indexOf(after);
  assert.ok(at >= 0, `the list is gone: ${after}`);
  let depth = 0;
  let start = -1;
  const out = [];
  for (let i = at + after.length; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === ']' && depth === 0) break;
    if (ch === '{') { if (depth === 0) start = i; depth += 1; }
    else if (ch === '}') { depth -= 1; if (depth === 0) out.push(src.slice(start, i + 1)); }
  }
  assert.ok(out.length > 0, `no entry could be read out of ${after}`);
  return out;
}

test('one function decides the consent state, and the chips read it', () => {
  const fn = between(zone, 'export function consentState(', 'const CONSENT_LABEL');
  // ORDER IS THE ASSERTION. Published wins over a withdrawal, a withdrawal over
  // a pending ask, and neither over silence — so no row is ever in two states.
  // D4672 added `ask_again` (asked, but only about an older revision or on a lapsed link) before silence.
  const order = ['published', 'withdrawn', 'awaiting', 'ask_again', 'not_asked'];
  const seen = order.map((s) => fn.indexOf(`'${s}'`));
  for (const [i, at] of seen.entries()) assert.ok(at > 0, `the ${order[i]} branch is gone`);
  assert.deepEqual([...seen].sort((a, b) => a - b), seen,
    'the consent states are no longer decided in precedence order');
  assert.match(fn, /if \(item\?\.is_published\) return 'published';/,
    'a published item is no longer published first');
  assert.match(fn, /if \(consents\.some\(\(k\) => k\.withdrawn_at\)\) return 'withdrawn';/,
    'a withdrawal no longer blocks');
  // D4672: awaiting is an OPEN ask about the claim as it reads now — the Worker's `requested`.
  assert.match(fn, /if \(consents\.some\(\(k\) => k\.state === 'requested'\)\) return 'awaiting';/,
    'an unanswered ask is no longer awaiting');
  // AND THE CHIPS READ THE SAME FUNCTION, through the card's own label
  // (D4842): the chip, the label on the card and the export cannot disagree.
  const vis = between(zone, 'const keyed = items.map(', 'const awaiting =');
  assert.match(vis, /proofConsentKey\(consentState\(item\), item\)/, 'the chips no longer read the shared state');
  assert.match(vis, /view === 'all' \|\| PROOF_CHIP_OF\[key\] === view/, 'a chip no longer selects on the card label');
  assert.ok(!/is_published|withdrawn_at|consent_given/.test(vis),
    'the chip row has gone back to reading the consent fields itself');
});

test('the chips are OF-03’s five, and the never-asked state borrows no request', async () => {
  const canvasChips = [...V2_PROOF.matchAll(/role="radio" aria-checked="(?:true|false)">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(canvasChips, ['All', 'Client approved', 'Approval requested', 'Self-stated', 'Withdrawn']);
  const chips = entriesIn(filters, "'offers/proof': [");
  assert.deepEqual(chips.map((e) => e.match(/canvas: '([^']+)'/)[1]), canvasChips,
    'the chip row is no longer the canvas’s five labels in its order');
  for (const entry of chips) {
    const chip = entry.match(/canvas: '([^']+)'/)[1];
    assert.match(entry, /key: '[a-z_]+'/, `${chip} is not a live chip`);
    assert.match(entry, /\{n\}/, `${chip} does not carry this firm's count`);
  }
  // `not_asked` IS A REAL STATE, and it must not be folded into a request:
  // that would have the zone claim an ask was made. It reads Self-stated.
  const fn = between(zone, 'export function consentState(', 'const CONSENT_LABEL');
  assert.match(fn, /return 'not_asked';/, 'the never-asked state is gone');
  assert.ok(zone.includes("not_asked: 'Nobody asked'"), 'the never-asked state no longer has its own label');
  const { proofConsentKey, PROOF_CHIP_OF } = await import('../src/pages/partner/offers/proofCards.js');
  assert.equal(proofConsentKey('not_asked', { consents: [] }), 'self_stated');
  assert.equal(PROOF_CHIP_OF[proofConsentKey('not_asked', { consents: [] })], 'self_stated');
});

test('OF-03 draws no tile strip and no shelf; the held count is over the whole page', () => {
  assert.ok(!/<Instrument\b|ProofTile|Client-verified metrics/.test(zone), 'the po4 strip or shelf came back');
  assert.ok(!/class="strip4"|class="kc"/.test(V2_PROOF), 'the v2 proof board draws tiles now');
  const counts = between(zone, 'const awaiting = items.filter(', 'const heldCount =');
  assert.ok(!/\bvisible\b/.test(counts), 'a count is reading the chip-narrowed list');
  assert.match(counts, /const awaiting = items\.filter\(\(i\) => consentState\(i\) === 'awaiting'\);/);
  assert.match(counts, /const blocked = items\.filter\(\(i\) => consentState\(i\) === 'withdrawn'\);/);
  assert.match(zone, /proofChipCounts\(keyed\.map\(/, 'the chip counts are not over every item on the page');
});

test('the promised public profile is not repeated, because there is no such page', () => {
  // The artboard's own note, and the reason it cannot be carried over. The v2
  // card's "Shown across Axal" is the same promise, and is not copied either.
  assert.match(PO4, /\{ label:'Published', value:String\(published\.length\), note:'live on the public profile' \}/,
    'the canvas’s Published note has moved');
  assert.match(V2, /'Shown across Axal'/, 'the v2 canvas no longer draws the publication line');
  assert.ok(!/live on the public profile|Shown across Axal/.test(zoneRaw),
    'the zone is promising a public page this product does not publish');
  // And the op that would open that page is still prose, for the same reason.
  const ops = entriesIn(actions, "'offers/proof': [");
  assert.match(ops[1], /\{ label: 'Preview public page', unbuilt: '/,
    'Preview public page has been given a control');
  assert.ok(!/path="\/proof|path="\/p\//.test(app), 'a public proof route exists, so that op should no longer be prose');
});

test('each card leads with the outcome and the client, and its label is an icon and a word', async () => {
  const m = await import('../src/pages/partner/offers/proofCards.js');
  // The headline is the result; the title follows as context. No result
  // written: the title leads, and it is still the firm's own words.
  assert.deepEqual(m.proofHeadline({ title: 'Acme rollout', outcome_note: 'Onboarding from 14 to 5 days', founder_name: 'Ada' }),
    { outcome: 'Onboarding from 14 to 5 days', client: 'Ada', context: 'Acme rollout' });
  assert.deepEqual(m.proofHeadline({ title: 'Acme rollout', outcome_note: ' ', founder_name: null }),
    { outcome: 'Acme rollout', client: null, context: null });
  for (const [key, label] of Object.entries(m.PROOF_CONSENT)) {
    assert.ok(label.icon && label.label && label.line, `${key} is not an icon, a word and one line`);
  }
  assert.deepEqual(['approved', 'requested', 'self_stated', 'withdrawn', 'superseded'].map((k) => m.PROOF_CONSENT[k].label),
    ['Client approved', 'Approval requested', 'Self-stated', 'Withdrawn', 'Superseded']);
  // A hand-typed item has no engagement behind it, and its card says so.
  assert.equal(m.proofProvenance('self_stated', { consents: [] }).engagement, 'No engagement linked');
  assert.equal(m.proofProvenance('self_stated', { need_title: 'Seed round', consents: [] }).engagement, 'Linked to Seed round');
  // Outlines (OF-10): solid green for client approved, dashed for self-stated.
  const card = between(zone, 'export function ProofCard(', 'const CONSENT_CHIP_CLASS');
  assert.match(card, /key === 'approved'\s*\n?\s*\? 'border-2 border-emerald-600/, 'a client-approved card lost its solid outline');
  assert.match(card, /border-dashed/, 'a self-stated card lost its dashed outline');
  assert.match(card, /<i aria-hidden="true" className="not-italic">\{label\.icon\}<\/i>\{label\.label\}/,
    'the consent label is no longer an icon and a word');
});

test('Ask for consent runs, and its old reason described a page that exists', () => {
  const canvasOps = JSON.parse(`[${PO4.match(/ops:\[([^\]]+)\]/)[1].replace(/'/g, '"')}]`);
  assert.deepEqual(canvasOps, ['Ask for consent', 'Preview public page', 'Export']);
  const ops = entriesIn(actions, "'offers/proof': [");
  assert.deepEqual(ops.map((e) => e.match(/label: '([^']+)'/)[1]), canvasOps,
    'the ops row is no longer the artboard’s three labels in its order');
  // D4844: still performed by the page, but no longer the zone's primary (`+ Add proof` is).
  assert.match(ops[0], /\{ label: 'Ask for consent', kind: 'handler', handler: 'askConsent' \}/,
    'Ask for consent is no longer performed by the page, or is drawn as a second primary');
  assert.match(ops[2], /\{ label: 'Export', kind: 'export' \}/, 'the export has stopped running');
  // The surface the retired reason said did not exist.
  assert.match(app, /path="\/attest\/partner\/:token"/,
    'the client’s side of a consent request is no longer mounted');
  // Read raw: the correction is a comment, and `codeOnly` strips those.
  assert.ok(actionsRaw.includes('/attest/partner/:token'),
    'the table no longer records which surface the retired reason was wrong about');
  // The page supplies it, or the op renders nowhere at all.
  assert.match(zone, /askConsent: \(\) => \{ clearNote\(\); setAsking\(true\); \}/,
    'the page no longer supplies the handler');
  assert.match(zone, /partnerZoneActions\('offers\/proof', \{ handlers, view: \{/,
    'the action row drops handlers, so the op renders nowhere');
});

test('the ask names the outcome it is about, and issues one credential', () => {
  const modal = between(zone, 'function AskModal(', 'export default function PartnerProofZone');
  // A consent is about a specific claim — the store keeps the wording for that
  // reason — so a header op that asked without naming one would issue a
  // credential against nothing in particular.
  assert.match(modal, /<OfferField label="Which outcome"/, 'the ask no longer names which outcome it is about');
  assert.match(modal, /onChange=\{\(e\) => setPick\(Number\(e\.target\.value\)\)\}/, 'the outcome cannot be chosen');
  assert.match(modal, /issuedToken=\{issued\?\.itemId === item\.id \? issued : null\}/,
    'the issued link is no longer scoped to the item it was issued for');
  // It reuses the panel rather than reimplementing the form, so the link rule
  // and its explanation cannot come apart from it.
  assert.match(modal, /<AskPanel\s/, 'the modal no longer reuses the ask panel');
  // D4672: the link is no longer the client's credential (a code emailed to them
  // is), so it is not "shown once"; the panel says instead that it cannot answer.
  assert.ok(zone.includes('so holding the link is'), 'the panel no longer says the link cannot answer');
  assert.ok(!zone.includes('This is the only time it is shown.'), 'the link is still called a once-only credential');
});

test('the AI band is the artboard’s, and its count is this firm’s', () => {
  const label = PO4.match(/aiLabel:'([^']*)'/)[1];
  const accept = PO4.match(/aiAccept:'([^']*)'/)[1];
  const band = between(zone, '<ZoneDraft', '/>');
  assert.ok(band.includes('surface="offers/proof"'), 'the band is on the wrong surface');
  assert.ok(band.includes(`label="${label}"`), `the band's label left the artboard: ${label}`);
  assert.ok(band.includes(`accept="${accept}"`), `the band's accept left the artboard: ${accept}`);
  // THE FOOT IS DERIVED, NOT TRANSCRIBED. The artboard's is "Three requests;
  // each needs a human send." — three is its own sample, and printing it here
  // would state a number about somebody else's data.
  assert.match(PO4, /aiFoot:'Three requests; each needs a human send\.'/, 'the canvas’s foot has moved');
  assert.ok(!band.includes('Three requests'), 'the band is printing the artboard’s own sample count');
  assert.match(band, /foot=\{`\$\{heldCount\} request\$\{heldCount === 1 \? '' : 's'\}; each needs a human send\.`\}/,
    'the band’s count is no longer this firm’s held outcomes');
  assert.match(zone, /const heldCount = awaiting\.length \+ blocked\.length/,
    'the held count is no longer derived from the shelf');
});

test('the draft reads this firm’s held outcomes, and never says a consent was obtained', () => {
  const entry = between(spec, "'offers/proof': {", "'offers/perk-deals': {");
  assert.ok(entry.includes('SELECT partner_id FROM users WHERE id = ?'),
    'the gather no longer resolves the caller’s partner row');
  assert.ok(entry.includes('WHERE p.partner_id = ?'),
    'the gather is no longer scoped to the caller’s own shelf');
  assert.ok(entry.includes('.filter((r) => !r.live)'),
    'the gather is drafting requests for outcomes a client already consented to');
  assert.ok(entry.includes('never write as though a request has been sent or a consent obtained'),
    'the draft is no longer forbidden from claiming a consent it does not have');
  assert.ok(entry.includes('NOT FROM ANY ENGAGEMENT'),
    'the gathered rows no longer say when an outcome has no client side to refer to');
});

test('StatCard went with the tiles it drew, and the docblock says why', () => {
  // `check-unused-imports` is CodeQL-backed and reports an imported-but-unused
  // name as an alert. Read off the comment-stripped source, because the note
  // recording the removal sits inside the import braces.
  const at = zone.indexOf("} from '../kit';");
  assert.ok(at > 0, 'the kit import is gone');
  assert.ok(!/\bStatCard\b|\bSection\b/.test(zone.slice(0, at)), 'StatCard or Section is still imported and nothing uses it');
  assert.ok(zoneRaw.includes('D4842: no tile strip and no shelf. OF-03 is the result cards alone.'),
    'the removal is no longer recorded, so the next reader re-adds it');
});
