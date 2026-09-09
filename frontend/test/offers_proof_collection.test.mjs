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
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const read = (p) => codeOnly(raw(p));

const CANVAS = raw('design/incoming/Pages · Partner Offers.dc.html');
const zoneRaw = raw('frontend/src/pages/partner/offers/ProofZone.jsx');
const zone = read('frontend/src/pages/partner/offers/ProofZone.jsx');
const actions = read('frontend/src/workspaces/partnerZoneActions.js');
const actionsRaw = raw('frontend/src/workspaces/partnerZoneActions.js');
const filters = read('frontend/src/workspaces/partnerZoneFilters.js');
const app = raw('frontend/src/App.jsx');
const spec = raw('cloudflare-worker/src/routes/research.ts');

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

/**
 * The four cells of the instrument row, split at TOP-LEVEL COMMAS.
 *
 * Three of them are ternaries, so a brace scan counts branches rather than
 * columns and cannot say which column any of them holds — the mistake the Perk
 * deals suite made first. Position is the point: the artboard's second column is
 * `Provenance` and nothing else may occupy it.
 */
function cellsOf(src) {
  const at = src.indexOf('cells: [');
  assert.ok(at >= 0, 'the instrument row has no cells');
  const out = [];
  let depth = 0;
  let start = at + 'cells: ['.length;
  let quote = '';
  for (let i = start; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{' || ch === '[' || ch === '(') { depth += 1; continue; }
    if (ch === '}' || ch === ')') { depth -= 1; continue; }
    if (ch === ']') {
      if (depth === 0) { out.push(src.slice(start, i)); break; }
      depth -= 1;
      continue;
    }
    if (ch === ',' && depth === 0) { out.push(src.slice(start, i)); start = i + 1; }
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

const INST = between(zone, '<Instrument', '/>');

test('one function decides the consent state, and the chips read it', () => {
  const fn = between(zone, 'export function consentState(', 'const CONSENT_LABEL');
  // ORDER IS THE ASSERTION. Published wins over a withdrawal, a withdrawal over
  // a pending ask, and neither over silence — so no row is ever in two states.
  const order = ['published', 'withdrawn', 'awaiting', 'not_asked'];
  const seen = order.map((s) => fn.indexOf(`'${s}'`));
  for (const [i, at] of seen.entries()) assert.ok(at > 0, `the ${order[i]} branch is gone`);
  assert.deepEqual([...seen].sort((a, b) => a - b), seen,
    'the consent states are no longer decided in precedence order');
  assert.match(fn, /if \(item\?\.is_published\) return 'published';/,
    'a published item is no longer published first');
  assert.match(fn, /if \(consents\.some\(\(k\) => k\.withdrawn_at\)\) return 'withdrawn';/,
    'a withdrawal no longer blocks');
  assert.match(fn, /if \(consents\.some\(\(k\) => !k\.consent_given && !k\.withdrawn_at\)\) return 'awaiting';/,
    'an unanswered ask is no longer awaiting');
  // AND THE CHIPS READ THE SAME FUNCTION. They did not before: `Blocked` asked
  // `consents.some(withdrawn_at)` while the badge asked `is_published`, so a
  // published item carrying an older withdrawal answered to both chips.
  const vis = between(zone, 'const visible = items.filter(', 'const awaiting =');
  assert.match(vis, /const state = consentState\(item\);/, 'the chips no longer read the shared state');
  assert.match(vis, /if \(view === 'published'\) return state === 'published';/, 'Published no longer selects on the state');
  assert.match(vis, /if \(view === 'blocked'\) return state === 'withdrawn';/, 'Blocked no longer selects on the state');
  assert.match(vis, /if \(view === 'awaiting'\) return state === 'awaiting';/, 'Awaiting no longer selects on the state');
  assert.ok(!/is_published|withdrawn_at|consent_given/.test(vis),
    'the chip row has gone back to reading the consent fields itself');
});

test('the fourth state has no chip and borrows none', () => {
  const canvasChips = JSON.parse(`[${PO4.match(/filters: fil\(\[([^\]]+)\]/)[1].replace(/'/g, '"')}]`);
  assert.deepEqual(canvasChips, ['All', 'Published', 'Awaiting consent', 'Blocked']);
  const chips = entriesIn(filters, "'offers/proof': [");
  assert.deepEqual(chips.map((e) => e.match(/canvas: '([^']+)'/)[1]), canvasChips,
    'the chip row is no longer the artboard’s four labels in its order');
  for (const entry of chips) {
    const chip = entry.match(/canvas: '([^']+)'/)[1];
    assert.match(entry, /key: '[a-z]+'/, `${chip} is not a live chip`);
  }
  // `not_asked` IS A REAL STATE WITH NO WORD ON THE ARTBOARD, and it must not be
  // folded into `awaiting`: that would have the zone claim a request was made.
  const fn = between(zone, 'export function consentState(', 'const CONSENT_LABEL');
  assert.match(fn, /return 'not_asked';/, 'the never-asked state is gone');
  assert.ok(zone.includes("not_asked: 'Nobody asked'"), 'the never-asked state no longer has its own label');
  const vis = between(zone, 'const visible = items.filter(', 'const awaiting =');
  assert.ok(!/not_asked/.test(vis), 'a never-asked item is being swept into one of the chips');
});

test('the strip is the artboard’s four tiles, counted over the whole shelf', () => {
  const adds = PO4.slice(PO4.indexOf('adds:['), PO4.indexOf('instTitle:'));
  const labels = [...adds.matchAll(/label:'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['Published', 'Awaiting consent', 'Blocked', 'Client-verified metrics']);
  const strip = between(zone, '<div className="grid grid-cols-2 gap-3 md:grid-cols-4">', '<Instrument');
  assert.deepEqual([...strip.matchAll(/label="([^"]+)"/g)].map((m) => m[1]), labels,
    'the strip is no longer the artboard’s four tiles in its order');
  assert.ok(strip.includes('note="asked, no answer"'), 'the Awaiting tile lost the artboard’s note');
  // COUNTED OVER `items`, NEVER OVER THE CHIP-NARROWED LIST.
  const counts = between(zone, 'const awaiting = items.filter(', 'const heldCount =');
  assert.ok(!/\bvisible\b/.test(counts), 'a tile count is reading the chip-narrowed list');
  assert.match(counts, /const awaiting = items\.filter\(\(i\) => consentState\(i\) === 'awaiting'\);/,
    'the Awaiting tile no longer counts the awaiting items');
  assert.match(counts, /const blocked = items\.filter\(\(i\) => consentState\(i\) === 'withdrawn'\);/,
    'the Blocked tile no longer counts the withdrawn items');
});

test('the promised public profile is not repeated, because there is no such page', () => {
  // The artboard's own note, and the reason it cannot be carried over.
  assert.match(PO4, /\{ label:'Published', value:String\(published\.length\), note:'live on the public profile' \}/,
    'the canvas’s Published note has moved');
  const strip = between(zone, '<div className="grid grid-cols-2 gap-3 md:grid-cols-4">', '<Instrument');
  assert.ok(!/live on the public profile/.test(strip),
    'the strip is promising a public profile this product does not publish');
  assert.ok(strip.includes('note="a client agreed, and has not withdrawn"'),
    'the Published tile no longer says what published means here');
  // And the op that would open that page is still prose, for the same reason.
  const ops = entriesIn(actions, "'offers/proof': [");
  assert.match(ops[1], /\{ label: 'Preview public page', unbuilt: '/,
    'Preview public page has been given a control');
  assert.ok(!/path="\/proof|path="\/p\//.test(app), 'a public proof route exists, so that op should no longer be prose');
});

test('Client-verified metrics counts a claim a client agreed to', () => {
  // The zone's whole argument as a number: a published item with no result
  // claimed is not a verified metric, and a self-stated result is not one
  // either — which is what the artboard's "none self-reported" means.
  assert.match(zone, /const verified = items\.filter\(\(i\) => i\.is_published && i\.outcome_note\);/,
    'the verified-metrics tile no longer requires both consent and a claim');
  const strip = between(zone, '<div className="grid grid-cols-2 gap-3 md:grid-cols-4">', '<Instrument');
  assert.ok(strip.includes('value={String(verified.length)}'), 'the tile is no longer showing that count');
  assert.ok(strip.includes('self-stated ones are not counted'),
    'the tile no longer says what it excludes');
});

test('the instrument draws the artboard’s four columns, in its order and at its widths', () => {
  const head = JSON.parse(`[${PO4.match(/head:\[([^\]]+)\]/)[1].replace(/'/g, '"')}]`);
  assert.deepEqual(head, ['Outcome', 'Provenance', 'Consent', 'What it says']);
  assert.ok(INST.includes(`head={${JSON.stringify(head).replace(/"/g, "'").replace(/,/g, ', ')}}`),
    'the instrument head is no longer the artboard’s four columns in its order');
  assert.ok(INST.includes(`cols="${PO4.match(/cols:'([^']+)'/)[1]}"`),
    'the instrument no longer uses the artboard’s column widths');
  assert.ok(INST.includes(`meta="${PO4.match(/instMeta:'([^']+)'/)[1]}"`),
    'the instrument’s meta line has left the artboard');
  assert.ok(INST.includes(`title="${PO4.match(/instTitle:'([^']+)'/)[1]}"`),
    'the instrument’s title has left the artboard');
});

test('the seam mark is earned per row, and a hand-typed item says so', () => {
  const cells = cellsOf(INST);
  assert.equal(cells.length, 4, 'the row no longer draws one cell per artboard column');
  assert.match(cells[0], /text: item\.title/, 'the first column is no longer the outcome');
  // The artboard marks every row seam because none of it originates there. Here
  // an item can be typed by hand, and one with nothing behind it is the single
  // most useful thing this column can say.
  assert.match(cells[1], /item\.need_title\s*\n?\s*\? \{ text: item\.need_title, sub: item\.founder_name \|\| undefined, seam: 'From engagement' \}/,
    'the provenance column no longer marks a row that came from an engagement');
  assert.match(cells[1], /: \{ nr: true \}/,
    'an item with no engagement behind it is being marked as if it had one');
  assert.match(cells[2], /\{ pill: CONSENT_LABEL\[state\], pillTone: CONSENT_TONE\[state\] \}/,
    'the Consent column no longer draws the state');
  // The gate mark is the artboard's own, and it goes on everything unpublished.
  assert.match(cells[3], /\.\.\.\(state === 'published' \? \{\} : \{ gate: 'Not public' \}\)/,
    'an unpublished claim is no longer marked as not public');
  assert.match(CANVAS, /p\.consent === 'Published' \? cell\(p\.outcome\) : cell\(p\.outcome, \{ gate:'Not public' \}\)/,
    'the canvas’s gate mark has moved');
});

test('the instNote states both divergences from the artboard’s shelf', () => {
  const note = INST.slice(INST.indexOf('note={'));
  assert.ok(note.includes('an unconsented outcome has no published form to suppress'),
    'the instNote no longer carries the artboard’s argument');
  assert.ok(note.includes('A row with no engagement behind it carries no seam mark'),
    'the instNote no longer explains why the seam mark is per row');
  assert.ok(note.includes('nothing links a proof item to an engagement'),
    'the instNote no longer explains why Blocked means a withdrawal here');
  assert.match(PO4, /Every row is seam-marked because none of it originates here/,
    'the canvas’s instNote has moved');
});

test('Ask for consent runs, and its old reason described a page that exists', () => {
  const canvasOps = JSON.parse(`[${PO4.match(/ops:\[([^\]]+)\]/)[1].replace(/'/g, '"')}]`);
  assert.deepEqual(canvasOps, ['Ask for consent', 'Preview public page', 'Export']);
  const ops = entriesIn(actions, "'offers/proof': [");
  assert.deepEqual(ops.map((e) => e.match(/label: '([^']+)'/)[1]), canvasOps,
    'the ops row is no longer the artboard’s three labels in its order');
  assert.match(ops[0], /\{ label: 'Ask for consent', kind: 'handler', handler: 'askConsent' \}/,
    'Ask for consent is no longer performed by the page');
  assert.match(ops[2], /\{ label: 'Export', kind: 'export' \}/, 'the export has stopped running');
  // The surface the retired reason said did not exist.
  assert.match(app, /path="\/attest\/partner\/:token"/,
    'the client’s side of a consent request is no longer mounted');
  // Read raw: the correction is a comment, and `codeOnly` strips those.
  assert.ok(actionsRaw.includes('/attest/partner/:token'),
    'the table no longer records which surface the retired reason was wrong about');
  // The page supplies it, or the op renders nowhere at all.
  assert.match(zone, /askConsent: \(\) => \{ setNote\(null\); setAsking\(true\); \}/,
    'the page no longer supplies the handler');
  assert.match(zone, /partnerZoneActions\('offers\/proof', \{ handlers, view: \{/,
    'the action row drops handlers, so the op renders nowhere');
});

test('the ask names the outcome it is about, and issues one credential', () => {
  const modal = between(zone, 'function AskModal(', 'export default function PartnerProofZone');
  // A consent is about a specific claim — the store keeps the wording for that
  // reason — so a header op that asked without naming one would issue a
  // credential against nothing in particular.
  assert.match(modal, /<Field label="Which outcome"/, 'the ask no longer names which outcome it is about');
  assert.match(modal, /onChange=\{\(e\) => setPick\(Number\(e\.target\.value\)\)\}/, 'the outcome cannot be chosen');
  assert.match(modal, /issuedToken=\{issued\?\.itemId === item\.id \? issued : null\}/,
    'the issued link is no longer scoped to the item it was issued for');
  // It reuses the panel rather than reimplementing the form, so the once-only
  // token rule and its explanation cannot come apart from it.
  assert.match(modal, /<AskPanel\s/, 'the modal no longer reuses the ask panel');
  assert.ok(zone.includes('This is the only time it is shown.'),
    'the once-only token warning is gone');
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

test('StatCard went with the three tiles it drew, and the docblock says which', () => {
  // `check-unused-imports` is CodeQL-backed and reports an imported-but-unused
  // name as an alert. Read off the comment-stripped source, because the note
  // recording the removal sits inside the import braces.
  const at = zone.indexOf("} from '../kit';");
  assert.ok(at > 0, 'the kit import is gone');
  assert.ok(!/\bStatCard\b/.test(zone.slice(0, at)), 'StatCard is still imported and nothing uses it');
  assert.ok(zoneRaw.includes('`StatCard` went with the three tiles it drew'),
    'the removal is no longer recorded, so the next reader re-adds it');
});
