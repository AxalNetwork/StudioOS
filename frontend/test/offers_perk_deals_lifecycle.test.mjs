/**
 * Offers · Perk deals — the `po2` artboard, and the consequence it is about.
 *
 * THE ARTBOARD IS NOT ABOUT A STATE. Its blurb: "some perks grant the redeemer
 * something, and when the perk expires that grant is revoked — so an expired row
 * states what it took back and on what date, rather than greying out." Its
 * instMeta says it from the other side: "Expiry is an event with a consequence,
 * not a filter."
 *
 * `perks` COULD EXPRESS NEITHER HALF. It carried a review status and a claim
 * cap and no date anywhere, so three of four strip tiles and two of four chips
 * had nothing to read — `NO_PERK_EXPIRY` in `partnerZoneFilters.js` said exactly
 * that, and it was right about a subtlety worth keeping: `perk_claims.expires_at`
 * exists and is a deadline on ONE founder's issued code, which says nothing
 * about the offer. Migration 228 put `ends_at` beside it, one per offer, and
 * `grant_scope` for what the ending takes back.
 *
 * WHAT THIS FILE HOLDS THE ZONE TO BEYOND THE COMPOSITION. Three claims the page
 * must not make. It must not say a scope was withdrawn — nothing in this product
 * withdraws one, and the red mark records that the grant ended with the offer.
 * It must not read `Grants revoked` as an all-clear — the count is of grants this
 * book NAMES. And `Live` must mean approved AND not ended, because the artboard's
 * word for it is "accepting redemptions" and a perk approved in March and ended
 * in June is not accepting anything.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const read = (p) => codeOnly(raw(p));

const CANVAS = raw('design/incoming/Pages · Partner Offers.dc.html');
const pageRaw = raw('frontend/src/pages/PerksPage.jsx');
const page = read('frontend/src/pages/PerksPage.jsx');
const worker = raw('cloudflare-worker/src/routes/perks.ts');
const migration = raw('cloudflare-worker/sql/migrations/228_perk_lifecycle_and_grant.sql');
const filters = read('frontend/src/workspaces/partnerZoneFilters.js');
const filtersRaw = raw('frontend/src/workspaces/partnerZoneFilters.js');
const actions = read('frontend/src/workspaces/partnerZoneActions.js');
const routes = read('frontend/src/workspaces/partner/PartnerBucketRoutes.jsx');
const kit = read('frontend/src/workspaces/canvasKit.jsx');
const spec = raw('cloudflare-worker/src/routes/research.ts');

const PO2 = CANVAS.slice(CANVAS.indexOf("{ id:'po2'"), CANVAS.indexOf("{ id:'po3'"));
assert.ok(PO2.includes("route:'/offers/perk-deals'"), 'the po2 artboard could not be found in the canvas');

/** The source between two markers, with BOTH ends proven to exist. */
function between(src, a, b) {
  const from = src.indexOf(a);
  assert.ok(from >= 0, `the opening marker is gone: ${a}`);
  const to = src.indexOf(b, from + a.length);
  assert.ok(to > from, `the closing marker is gone: ${b}`);
  return src.slice(from, to);
}

/**
 * The `{…}` entries of the array opening at `after`, each bounded at its own
 * closing brace.
 *
 * A fixed-length slice from one entry's label runs on into the next entry, so a
 * chip given a live `key` still reads as `unbuilt:` because its NEIGHBOUR
 * carries the word — an escape the Visibility suite caught in its own mutation
 * run and this one inherits the fix for.
 */
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

/** The `<Instrument … />` element, bounded at its own closing tag. */
const INST = between(page, '<Instrument', '/>');

/**
 * The five cells of the instrument row, split at TOP-LEVEL COMMAS.
 *
 * NOT BY BRACE, WHICH IS THE MISTAKE THIS FILE MADE FIRST. Three of these five
 * cells are ternaries — an uncapped offer draws a different cell from a capped
 * one, and so do a missing end date and a missing grant — so a scan that took
 * every `{` at depth zero as a cell read eight where there are five, and could
 * not have told which column any of them belonged to. Position is the whole
 * point of the assertions below: the artboard's fourth column is `Ends` and
 * nothing else may occupy it.
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
  return out.map((s2) => s2.trim()).filter(Boolean);
}

test('the offer gets its own end date, distinct from a claim’s', () => {
  const sql = migration.replace(/^\s*--.*$/gm, '');
  assert.match(sql, /ALTER TABLE perks\s*\n\s*ADD COLUMN ends_at TEXT/, 'the end date is gone');
  assert.match(sql, /ALTER TABLE perks\s*\n\s*ADD COLUMN grant_scope TEXT;/, 'the grant scope is gone');
  // BOTH NULLABLE AND NEITHER DEFAULTED. An offer with no end date runs until
  // somebody sets one; an offer that grants nothing beyond itself revokes
  // nothing. A default on either would have the store answer a question nobody
  // asked it.
  assert.ok(!/ends_at TEXT[^;]*DEFAULT/.test(sql), 'the end date has been given a default');
  assert.ok(!/grant_scope TEXT[^;]*DEFAULT|grant_scope TEXT NOT NULL/.test(sql),
    'the grant scope has been defaulted or made required');
  // The CHECK is the same shape the route validates, so a value one accepts is
  // a value the other accepts.
  assert.match(sql, /CHECK \(ends_at IS NULL OR ends_at GLOB '\[0-9\]\[0-9\]\[0-9\]\[0-9\]-\[0-9\]\[0-9\]-\[0-9\]\[0-9\]'\)/,
    'the end date accepts any text again');
  assert.match(worker, /return \/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(s\) \? s : null;/,
    'the route no longer validates the date shape the column requires');
  // And the reason the two dates are different things is recorded, because the
  // old chip reason existed entirely to stop a reader conflating them.
  assert.ok(migration.includes('THIS IS NOT `perk_claims.expires_at`'),
    'the migration no longer distinguishes the offer’s date from a claim’s');
});

test('the revocation date is derived, never stored a second time', () => {
  const sql = migration.replace(/^\s*--.*$/gm, '');
  assert.ok(!/grant_revoked_at|revoked_on/.test(sql),
    'a revocation date column has appeared, and it can now disagree with the end date');
  // Derived in the response instead — from the two columns that exist, and only
  // where a grant was named.
  assert.match(worker, /grant_revoked_on: p\.grant_scope && perkLifecycle\(p\.ends_at, today\) === 'expired'/,
    'the revocation date is no longer derived from the end date and the grant');
  // The migration cites the precedent rather than asserting the rule, because
  // this schema already made the same call about the credit balance.
  // Flattened: the quote wraps across comment lines.
  const header = migration.replace(/^\s*--/gm, '').replace(/\s+/g, ' ');
  assert.ok(header.includes('a stored balance is a second source of truth for a fact these rows already hold'),
    'the migration no longer cites 186’s own reasoning for deriving rather than storing');
});

test('the lifecycle window is one number, in the worker, and the page prints it', () => {
  assert.match(worker, /export const PERK_EXPIRING_WITHIN_DAYS = 30;/,
    'the window is gone or is no longer exported');
  // ONE DEFINITION. The gather imports it rather than repeating thirty days,
  // and the page reads `lifecycle` off the row rather than computing one.
  assert.match(spec, /import \{ perkLifecycle \} from '\.\/perks';/,
    'the draft gather no longer shares the zone’s definition of what is expiring');
  const state = between(page, 'export function perkState(', 'export function matchesPerkChip(');
  assert.match(state, /const s = String\(p\?\.lifecycle \|\| ''\);/,
    'the page is no longer reading the lifecycle the worker served');
  assert.ok(!/\b30\b|getUTCDate|Date\.now/.test(state),
    'the page has started computing the window itself, so it can drift from the worker');
  // NULL IS `live`, NOT `expiring`. An open-ended offer has no end date because
  // there is not one.
  assert.match(worker, /if \(!end\) return 'live';/,
    'an offer with no end date is no longer treated as live');
  // And the page states the rule beside the word rather than assuming it.
  assert.ok(page.includes('none ending within 30 days'),
    'the strip no longer prints the window it is counting against');
});

test('the four chips run, and Live means approved AND not ended', () => {
  const canvasChips = JSON.parse(`[${PO2.match(/filters: fil\(\[([^\]]+)\]/)[1].replace(/'/g, '"')}]`);
  assert.deepEqual(canvasChips, ['All', 'Live', 'Expiring', 'Expired']);
  const chips = entriesIn(filters, "'offers/perk-deals': [");
  assert.deepEqual(chips.map((e) => e.match(/canvas: '([^']+)'/)[1]), canvasChips,
    'the chip row is no longer the artboard’s four labels in its order');
  for (const entry of chips) {
    const chip = entry.match(/canvas: '([^']+)'/)[1];
    assert.match(entry, /key: '[a-z]+'/, `${chip} is not a live chip`);
    assert.ok(!/unbuilt:/.test(entry), `${chip} claims a gap it no longer has`);
  }
  assert.ok(!filters.includes('NO_PERK_EXPIRY'), 'the retired reason is still referenced');
  // THE CORRECTION `Live` NEEDED. It read `status === 'live'` alone — the
  // REVIEW state — while the artboard's own note for the word is "accepting
  // redemptions".
  const chip = between(page, 'export function matchesPerkChip(', 'const STATE_LABEL');
  assert.match(chip, /if \(chip === 'live'\) return p\.status === 'live' && state === 'live';/,
    'Live has stopped meaning both approved and not ended');
  assert.match(chip, /if \(chip === 'expiring'\) return state === 'expiring';/, 'Expiring no longer selects on the date');
  assert.match(chip, /if \(chip === 'expired'\) return state === 'expired';/, 'Expired no longer selects on the date');
  assert.ok(page.includes('const visible = rows.filter((p) => matchesPerkChip(p, view));'),
    'the list is no longer narrowed by the chip');
  // Quoted rather than deleted: the retired reason was exact, and its second
  // half is still true of `perk_claims.expires_at`.
  const doc = filtersRaw.replace(/^\s*(?:\*|\/\/)/gm, '').replace(/[`\s]+/g, ' ');
  assert.ok(doc.includes('the only expiry in this store is on a claim already issued to one founder'),
    'the docblock no longer records the gap these two chips waited on');
});

test('the strip is the artboard’s four tiles, counted over the whole book', () => {
  const adds = PO2.slice(PO2.indexOf('adds:['), PO2.indexOf('instTitle:'));
  const labels = [...adds.matchAll(/label:'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['Live', 'Expiring', 'Expired', 'Grants revoked']);
  const strip = between(page, '<div className="grid grid-cols-2 gap-3 md:grid-cols-4">', '</div>');
  assert.deepEqual([...strip.matchAll(/label="([^"]+)"/g)].map((m) => m[1]), labels,
    'the strip is no longer the artboard’s four tiles in its order');
  assert.ok(strip.includes('note="accepting redemptions"'), 'the Live tile lost the artboard’s note');
  assert.ok(strip.includes('note="grants revoked on expiry"'), 'the Expired tile lost the artboard’s note');
  // COUNTED OVER `rows`, NEVER OVER THE CHIP-NARROWED LIST. A figure that
  // changes because a chip was clicked is not reporting what its label claims.
  const counts = between(page, 'const live = rows.filter(', 'const handlers = {');
  assert.ok(!/\bvisible\b/.test(counts), 'a tile count is reading the chip-narrowed list');
  for (const decl of ['const live = rows.filter(', 'const expiring = rows.filter(', 'const expired = rows.filter(']) {
    assert.ok(page.includes(decl), `the strip has lost its count: ${decl}`);
  }
});

test('Grants revoked counts the grants this book names, and says so', () => {
  // The artboard's own arithmetic sums `used` over every expired perk, and both
  // of its expired rows happen to grant something. Counting a perk that granted
  // nothing under "Grants revoked" would claim a revocation that never
  // happened, so the filter is on the grant rather than on the state alone.
  assert.match(page, /const revoking = expired\.filter\(\(p\) => p\.grant_scope\);/,
    'the revoked count no longer requires the perk to name what it granted');
  assert.match(page, /const revokedRedeemers = revoking\.reduce\(\(a, p\) => a \+ \(Number\(p\.claim_count\) \|\| 0\), 0\);/,
    'the revoked count no longer sums the redeemers of those perks');
  assert.ok(page.includes('redeemers affected across ${revoking.length} perk')
    || page.includes('redeemers affected across'), 'the tile lost the artboard’s note');
  // AND THE ZERO IS NOT AN ALL-CLEAR. A perk with no grant recorded contributes
  // nothing because nobody said what it gave, not because it gave nothing.
  const note = INST.slice(INST.indexOf('note={'));
  assert.ok(note.includes('counts the grants this book NAMES'),
    'the instNote no longer says what the revoked count is a count of');
  assert.ok(note.includes('because nobody said what it gave, not because it gave nothing'),
    'the instNote no longer stops the zero reading as an all-clear');
});

test('the instrument draws the artboard’s five columns, in its order and at its widths', () => {
  const head = JSON.parse(`[${PO2.match(/head:\[([^\]]+)\]/)[1].replace(/'/g, '"')}]`);
  assert.deepEqual(head, ['Perk', 'State', 'Redeemed / cap', 'Ends', 'What it granted']);
  assert.ok(INST.includes(`head={${JSON.stringify(head).replace(/"/g, "'").replace(/,/g, ', ')}}`),
    'the instrument head is no longer the artboard’s five columns in its order');
  assert.ok(INST.includes(`cols="${PO2.match(/cols:'([^']+)'/)[1]}"`),
    'the instrument no longer uses the artboard’s column widths');
  assert.ok(INST.includes(`meta="${PO2.match(/instMeta:'([^']+)'/)[1]}"`),
    'the instrument’s meta line has left the artboard');
  assert.ok(INST.includes(`title="${PO2.match(/instTitle:'([^']+)'/)[1]}"`),
    'the instrument’s title has left the artboard');
});

test('the row draws the state, the ratio, and what the expiry took back', () => {
  const cells = cellsOf(INST);
  assert.equal(cells.length, 5, 'the row no longer draws one cell per artboard column');
  assert.match(cells[0], /text: p\.offer/, 'the first column is no longer the offer');
  // The review state rides under the name rather than as a sixth column, so a
  // draft or a paused listing is legible without adding a column the artboard
  // does not draw.
  assert.match(cells[0], /sub: REVIEW_NOTE\[p\.status\]/, 'a listing’s review state is no longer visible anywhere');
  assert.match(cells[1], /pill: STATE_LABEL\[state\], pillTone: STATE_TONE\[state\]/,
    'the State column no longer draws the lifecycle');
  // THE BAR IS DRAWN ONLY WHERE THERE IS A DENOMINATOR. An uncapped offer has a
  // count and no ratio, and a bar filled to a fraction of nothing invents the
  // cap the firm deliberately did not set.
  assert.match(cells[2], /cap == null\s*\n?\s*\? \{ text: `\$\{used\} redeemed`, sub: 'uncapped' \}/,
    'an uncapped offer is being given a ratio it has no denominator for');
  assert.match(cells[2], /barPct: Math\.round\(ratio \* 100\)/, 'the capped row lost its bar');
  assert.match(cells[2], /barColor: ratio >= 1 \? '#b91c1c' : \(ratio >= 0\.7 \? '#b45309' : '#047857'\)/,
    'the bar no longer follows the artboard’s three thresholds');
  assert.match(CANVAS, /barColor: ratio >= 1 \? '#b91c1c' : \(ratio >= \.7 \? '#b45309' : '#047857'\)/,
    'the canvas’s bar thresholds have moved');
  // An offer with no end date reads absent rather than open-ended: before this
  // migration every row had none, so calling them open-ended would claim a
  // decision nobody made.
  assert.match(cells[3], /p\.ends_at \? \{ text: String\(p\.ends_at\)\.slice\(0, 10\) \} : \{ nr: true \}/,
    'a missing end date is no longer stated as missing');
  assert.match(cells[4], /rvk: `Revoked \$\{p\.grant_revoked_on\}`/,
    'an expired offer no longer says what it took back and when');
  assert.match(cells[4], /: \{ nr: true \}/, 'a perk with no grant recorded is no longer stated as absent');
});

test('the red mark records an ending, and never claims a withdrawal', () => {
  // Nothing in this product withdraws a scope. The mark says the grant ended
  // with the offer; sending the notice is a person's job.
  const note = INST.slice(INST.indexOf('note={'));
  assert.ok(note.includes('Nothing in this product withdraws a scope automatically'),
    'the instNote no longer refuses the enforcement it does not have');
  assert.ok(note.includes('sending the notice is a person’s job'),
    'the instNote no longer says who acts on the revocation');
  assert.ok(migration.includes('Nothing in this product ENFORCES a revocation'),
    'the migration no longer records that the column is a record rather than an action');
  // The AI draft is told the same thing, because a model asked about revocations
  // will otherwise report them as done.
  const entry = between(spec, "'offers/perk-deals': {", "'offers/visibility': {");
  assert.ok(entry.includes('never as something already done'),
    'the draft is no longer told the revocation is a notice somebody must send');
  assert.ok(entry.includes('revokes nothing on expiry: say so rather than listing it as a loss'),
    'the draft is no longer told that a perk granting nothing loses nothing');
  assert.ok(entry.includes('WHERE p.partner_user_id = ?'),
    'the gather is no longer scoped to the caller’s own listings');
});

test('both writes run, and Extend could not have before', () => {
  const canvasOps = JSON.parse(`[${PO2.match(/ops:\[([^\]]+)\]/)[1].replace(/'/g, '"')}]`);
  assert.deepEqual(canvasOps, ['New perk', 'Extend', 'Export']);
  const ops = entriesIn(actions, "'offers/perk-deals': [");
  assert.deepEqual(ops.map((e) => e.match(/label: '([^']+)'/)[1]), canvasOps,
    'the ops row is no longer the artboard’s three labels in its order');
  assert.match(ops[0], /\{ label: 'New perk', kind: 'handler', handler: 'newPerk' \}/,
    'New perk is no longer performed by the page');
  assert.match(ops[1], /\{ label: 'Extend', kind: 'handler', handler: 'extend' \}/,
    'Extend is no longer performed by the page');
  assert.match(ops[2], /\{ label: 'Export', kind: 'export' \}/, 'the export has stopped running');
  // A handler the page does not supply renders NOTHING, so the binder has to
  // thread them through or both ops vanish silently.
  assert.match(routes, /zoneActions=\{\(rows, handlers\) => partnerZoneActions\('offers\/perk-deals', \{ handlers, view: \{/,
    'the perk binder drops handlers, so both page-supplied ops render nowhere');
  assert.match(page, /newPerk: \(\) => \{/, 'the page no longer supplies New perk');
  assert.match(page, /extend: \(\) => \{ setExtendNote\(null\); setExtending\(true\); \}/,
    'the page no longer supplies Extend');
});

test('Extend offers only what can be extended, and does not claim to restore', () => {
  assert.match(page, /rows=\{rows\.filter\(\(p\) => p\.ends_at && perkState\(p\) !== 'live'\)\}/,
    'the extend modal is offering to push a date on offers that are not ending');
  assert.ok(page.includes('Extending the offer does not restore a grant it already revoked'),
    'the extend modal no longer says what extending does not do');
  assert.match(page, /await api\.perkUpdate\(perk\.uid, \{ ends_at: date \}\)/,
    'saving a new end date no longer writes the column');
  // The route refuses a malformed date with a sentence rather than letting the
  // CHECK fail, because this control sends that field and nothing else.
  assert.ok(worker.includes("return c.json({ error: 'ends_at must be a date, as YYYY-MM-DD' }, 400);"),
    'a bad date now reaches the column as a constraint error rather than a message');
});

test('the two marks this artboard needs are named in the kit, not improvised', () => {
  // The signature also carries the Delivery canvas's `mode` and `grant`; this
  // assertion is about the two Offers marks keeping their named slots in it.
  assert.match(kit, /export function Cell\(\{\s*\n\s*text, pill, pillTone = 'neutral', seam, ours, orph, gate, stale, cite, rvk, nr, sub,\s*\n\s*mode, grant, grantRevoked = false, barPct, barColor = '#b45309', node,/,
    'the cell no longer takes the canvas’s own two Offers marks');
  assert.match(kit, /\{rvk \? <Pill tone="danger" className="!text-\[9\.5px\]">\{rvk\}<\/Pill> : null\}/,
    'the revoked mark no longer renders');
  assert.match(kit, /\{barPct == null \? null : \(/, 'the ratio bar no longer renders');
  // The bar is clamped, so a count above its cap draws a full bar rather than
  // one that overflows the cell.
  assert.match(kit, /Math\.max\(0, Math\.min\(100, Number\(barPct\) \|\| 0\)\)/,
    'the bar is no longer clamped, so a redeemed count above cap overflows the row');
  assert.match(CANVAS, /\.rvk\{[^}]*color:#b91c1c/, 'the canvas’s revoked mark has moved');
});

test('the AI band is the artboard’s, on its own allow-listed surface', () => {
  const label = PO2.match(/aiLabel:'([^']*)'/)[1];
  const accept = PO2.match(/aiAccept:'([^']*)'/)[1];
  const foot = PO2.match(/aiFoot:'([^']*)'/)[1];
  const band = between(page, '<ZoneDraft', '/>');
  assert.ok(band.includes('surface="offers/perk-deals"'), 'the band is on the wrong surface');
  assert.ok(band.includes(`label="${label}"`), `the band's label left the artboard: ${label}`);
  assert.ok(band.includes(`accept="${accept}"`), `the band's accept left the artboard: ${accept}`);
  assert.ok(band.includes(`foot="${foot}"`), `the band's footnote left the artboard: ${foot}`);
  assert.ok(spec.indexOf("'offers/perk-deals': {") > 0,
    'the perk surface is not allow-listed, so the band 400s');
});

test('the form writes both new columns, and an empty field is an absence', () => {
  assert.match(page, /ends_at: form\.ends_at \|\| null,/, 'a blank end date is being stored as an empty string');
  assert.match(page, /grant_scope: form\.grant_scope \|\| null,/, 'a blank grant is being stored as an empty string');
  assert.ok(pageRaw.includes('Ends (optional)'), 'the form has no end-date field');
  assert.ok(pageRaw.includes('What it grants beyond the offer, and for how long (optional)'),
    'the form has no grant field');
  // The worker stores both on submit, or the form writes into nothing.
  const insert = between(worker, 'INSERT INTO perks (', ').run();');
  assert.ok(insert.includes('ends_at, grant_scope'), 'the insert no longer carries the two new columns');
  assert.ok(insert.includes('dateOrNull(b?.ends_at), str(b?.grant_scope, 300) || null'),
    'the insert no longer binds the two new columns');
});
