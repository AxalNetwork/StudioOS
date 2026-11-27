/**
 * Offers · Audience fit — the `po5` artboard, and two reasons that misread it.
 *
 * THE ANTI-PERSONA IS THE WORKING HALF. "A stated floor, declined sectors and
 * honestly absent capabilities are what let Pipeline pass a lead with a reason —
 * the anti-persona is the working half of a match engine, not a disclaimer." The
 * zone's own docblock has said the same thing since it was written; what was
 * missing was the artboard's composition, and its `Who we are not for` card is
 * a first-class element rather than a footnote.
 *
 * TWO STATED GAPS TURNED OUT TO BE MISREADINGS, and both are the same shape as
 * the one Proof's `Ask for consent` had: a reason that was exactly right about
 * one thing and was attached to another.
 *
 *   `Qualified` and `Weak` were prose because "no lead is scored against these
 *   rules". True — and the artboard's chips do not select scores. Its own rows
 *   read "Series A companies without design leadership — Qualified" and "Pre-
 *   product founders with a deck — Weak intent": the FIRM'S judgement about a
 *   KIND of client, written beside the profile. Migration 229 stores it, and
 *   `enforcement: 'none'` is exactly as true after it as before.
 *
 *   `Pass reasons` was prose because "a pass reason is not a stored field on a
 *   fit rule" — and `statement` is that field, the one the form labels "The
 *   sentence a pass quotes".
 *
 * AND ONE FIGURE IS DELIBERATELY NOT CARRIED. The artboard's linkage note ends
 * "produced four explained passes last quarter". Nothing in this product logs a
 * pass, so the sentence says what the rules are for and stops where the record
 * stops.
 *
 * D4842 (#4842) REDRAWS THE ZONE TO OFFERS V2 (OF-04, OF04b): a rank note, one
 * rules table and a create sheet that asks business questions. The strip, the
 * profile instrument and the anti-persona card are gone, so the tests that held
 * them now hold the table and the sheet. The store's guarantees are unchanged
 * and still pinned: a strength is a profile's alone, nothing is auto-declined,
 * the chips select over profiles, and a pass note is composed, never invented.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const read = (p) => codeOnly(raw(p));

const CANVAS = raw('design/canvases/integrated/Pages · Partner Offers.dc.html');
const zoneRaw = raw('frontend/src/pages/partner/offers/AudienceFitZone.jsx');
const zone = read('frontend/src/pages/partner/offers/AudienceFitZone.jsx');
const worker = raw('cloudflare-worker/src/routes/partner_offers.ts');
const migration = raw('cloudflare-worker/sql/migrations/229_fit_rule_signal.sql');
const filters = read('frontend/src/workspaces/partnerZoneFilters.js');
const filtersRaw = raw('frontend/src/workspaces/partnerZoneFilters.js');
const actions = read('frontend/src/workspaces/partnerZoneActions.js');
const actionsRaw = raw('frontend/src/workspaces/partnerZoneActions.js');
const spec = raw('cloudflare-worker/src/routes/research.ts');
const V2 = raw('design/incoming/Offers v2 Page.dc.html');
const V2_FIT = V2.slice(V2.indexOf('const fit = () =>'), V2.indexOf('/* ---------- visibility'));
assert.ok(V2_FIT.includes("head('Audience fit'"), 'the Offers v2 fit board could not be found');

const PO5 = CANVAS.slice(CANVAS.indexOf("{ id:'po5'"), CANVAS.indexOf('];', CANVAS.indexOf("{ id:'po5'")));
assert.ok(PO5.includes("route:'/offers/audience-fit'"), 'the po5 artboard could not be found in the canvas');

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

test('the strength is a stored judgement, and it is not a score', () => {
  const sql = migration.replace(/^\s*--.*$/gm, '');
  assert.match(sql, /ALTER TABLE partner_fit_rules\s*\n\s*ADD COLUMN signal TEXT/, 'the signal column is gone');
  assert.match(sql, /CHECK \(signal IS NULL OR signal IN \('best_fit', 'qualified', 'weak_intent'\)\)/,
    'the signal column accepts any text again');
  // NULLABLE WITH NO DEFAULT. A profile the firm has not graded reads ungraded;
  // defaulting it would put a judgement — the strongest of the three — in the
  // firm's mouth.
  assert.ok(!/signal TEXT[^;]*DEFAULT/.test(sql), 'the signal column has been given a default');
  // THE RESPONSE SAYS WHAT READS THESE (#4696). It said `enforcement: 'none'`
  // while Pipeline scored and ranked against the same rows.
  assert.match(worker, /enforcement: 'score_and_rank',/, 'the response no longer says the rules score and rank');
  assert.match(worker, /auto_decline: false,/, 'the response no longer says nothing is declined for the firm');
  assert.ok(!/enforcement: 'none',/.test(worker), 'the response says nothing enforces rules Pipeline reads');
  assert.ok(zone.includes('Pipeline scores and ranks leads with these rules; it never declines one for you.'),
    'the zone no longer states what the rules are used for');
  assert.ok(migration.includes('`enforcement: \'none\'` stays exactly as true after it as before'),
    'the migration no longer records that it adds no enforcement');
});

test('a strength belongs to a profile, and an exclusion is refused one', () => {
  const fn = between(worker, 'function signalFor(', 'partnerOffers.get(');
  assert.match(fn, /if \(!FIT_SIGNALS\.includes\(s\)\) return \{ error:/, 'an unknown signal is now accepted');
  assert.match(fn, /if \(kind !== 'best_fit'\) return \{ error: 'Only a fit profile carries a signal/,
    'an exclusion can now carry a strength nothing reads');
  // A CHECK CANNOT SAY THIS. On an added column it may not reference another
  // column, so the rule lives in the route and the migration says why.
  // Flattened: the sentence wraps across comment lines.
  const header = migration.replace(/^\s*--/gm, '').replace(/\s+/g, ' ');
  assert.ok(header.includes('a CHECK on an added column may not reference another column'),
    'the migration no longer explains why the cross-column rule is in the route');
  // The PATCH does not merge it like the other fields: a sent signal is
  // validated strictly, an inherited one is dropped when the kind stops being a
  // profile — otherwise editing a graded profile into a declined sector would
  // be refused outright.
  assert.match(worker, /const sent = Object\.prototype\.hasOwnProperty\.call\(b, 'signal'\);/,
    'the patch no longer distinguishes a sent signal from an inherited one');
  assert.match(worker, /const sig = signalFor\(kind, sent \? b\.signal : \(kind === 'best_fit' \? row\.signal : null\)\);/,
    'editing a graded profile into an exclusion no longer clears its strength');
  // And the form does not draw a control the route would reject.
  assert.match(zone, /const isProfile = kind === 'best_fit';/, 'the form no longer knows which kinds carry a strength');
  assert.match(zone, /signal: isProfile \? \(signal \|\| null\) : null,/,
    'the form is sending a strength on kinds that cannot carry one');
});

test('all four chips run, and the two retired reasons are quoted', () => {
  const canvasChips = JSON.parse(`[${PO5.match(/filters: fil\(\[([^\]]+)\]/)[1].replace(/'/g, '"')}]`);
  assert.deepEqual(canvasChips, ['All', 'Best fit', 'Qualified', 'Weak']);
  const chips = entriesIn(filters, "'offers/audience-fit': [");
  assert.deepEqual(chips.map((e) => e.match(/canvas: '([^']+)'/)[1]), canvasChips,
    'the chip row is no longer the artboard’s four labels in its order');
  for (const entry of chips) {
    const chip = entry.match(/canvas: '([^']+)'/)[1];
    assert.match(entry, /key: '[a-z_]+'/, `${chip} is not a live chip`);
    assert.ok(!/unbuilt:/.test(entry), `${chip} claims a gap it no longer has`);
  }
  // Quoted rather than deleted: both were exact about leads and were attached
  // to chips that do not select leads.
  const doc = filtersRaw.replace(/^\s*(?:\*|\/\/)/gm, '').replace(/[`\s]+/g, ' ');
  assert.ok(doc.includes('no lead is scored against these rules'),
    'the docblock no longer records the reason these two chips waited on');
  assert.ok(doc.includes('the FIRM\'S judgement about a KIND of client'),
    'the docblock no longer says what the chips actually select');
  // THE CHIPS SELECT OVER PROFILES, not over every rule: a declined sector
  // returned under `Weak` would answer a different question from the one asked.
  assert.match(zone, /fitView\(items, view\)/,
    'the strength chips are no longer selecting through the one row-set definition');
  assert.match(read('frontend/src/lib/fitRuleView.js'), /profiles\.filter\(\(r\) => r\.signal === view\)/,
    'the strength chips are no longer selecting the firm’s profiles by their signal');
  // The export and the editable list take the rows the chip selects (#4696).
  assert.match(zone, /rows: visible, cells:/, 'the export is no longer the rows the chip selects');
  assert.match(zone, /rows=\{visible\.map\(\(r\) => \(/, 'the rules table is no longer the rows the chip selects');
  assert.match(read('frontend/src/lib/fitRuleView.js'), /const profiles = all\.filter\(\(r\) => r\.kind === 'best_fit'\);/,
    'the profiles and the exclusions are no longer split');
});

test('OF-04 is the rank note and one rules table, in the canvas’s columns', () => {
  const head = [...V2_FIT.matchAll(/<th scope="col">([^<]*)<\/th>/g)].map((m) => m[1]).filter(Boolean);
  assert.deepEqual(head, ['Rule', 'Who', 'Strength', 'What we say', 'Point them to']);
  const table = between(zone, 'function FitRulesTable(', 'export default function PartnerAudienceFitZone');
  assert.ok(table.includes(`{${JSON.stringify(head).replace(/"/g, "'").replace(/,/g, ', ')}.map((h) =>`),
    'the table head is no longer the canvas’s five columns in its order');
  assert.ok(!/<Instrument\b|FitTile|const ANTI = \[|Who we are not for/.test(zone), 'the po5 strip, instrument or anti card came back');
  // THE NOTE IS THE CANVAS'S SENTENCE, and it says rank and explain, never reject.
  const canvasNote = V2_FIT.match(/<div>(Pipeline uses these rules[^<]+)<\/div>/)[1];
  assert.ok(zone.includes(canvasNote), 'the rank note left the canvas');
  assert.match(canvasNote, /never reject/, 'the canvas note no longer says a rule never rejects');
  assert.match(zone, /<summary[^>]*>How rules affect ranking<\/summary>/, 'the longer account is printed rather than opened from the note');
  assert.ok(zone.includes('d?.enforcement_note'), 'the longer account no longer reads the Worker’s own enforcement note');
});

test('each row says Great fit or Not a fit, and a rule with nothing to say carries Add reply', async () => {
  const { fitRuleRow } = await import('../src/pages/partner/offers/fitRules.js');
  const money = (c) => `$${(c / 100).toLocaleString('en-US')}`;
  const profile = fitRuleRow({ kind: 'best_fit', value: 'B2B SaaS', signal: 'best_fit', statement: 'Let’s talk.', is_active: 1 }, money);
  assert.deepEqual([profile.rule, profile.kind, profile.who, profile.strength, profile.needsReply], ['Great fit', null, 'B2B SaaS', 'Best fit', false]);
  const floor = fitRuleRow({ kind: 'budget_floor', floor_cents: 2500000, statement: null, referred_to: 'Granite', is_active: 1 }, money);
  assert.deepEqual([floor.rule, floor.kind, floor.who, floor.strength, floor.pointTo, floor.needsReply],
    ['Not a fit', 'Below a minimum engagement', 'Projects below $25,000', null, 'Granite', true]);
  // An exclusion never carries a strength, and an unnamed or unpriced rule reads absent rather than blank.
  assert.equal(fitRuleRow({ kind: 'sector_declined', value: 'Crypto', signal: 'best_fit' }, money).strength, null);
  assert.equal(fitRuleRow({ kind: 'budget_floor', floor_cents: null }, money).who, null);
  assert.equal(fitRuleRow({ kind: 'best_fit', value: 'x', is_active: 0 }, money).inUse, false);
  const table = between(zone, 'function FitRulesTable(', 'export default function PartnerAudienceFitZone');
  assert.match(table, /v\.who \|\| <Unrecorded>Not named<\/Unrecorded>/, 'an unnamed rule is drawn blank');
  assert.match(table, /No reply yet/, 'a rule with nothing to say is drawn blank');
  assert.match(table, /\{v\.needsReply \? 'Add reply' : 'Edit'\}/, 'a rule with nothing to say is not the primary action');
  assert.match(table, /md:hidden/, 'the phone has no stacked layout, so the table is wider than the screen');
});

test('the sheet asks business questions first, and the rule types are disclosed', async () => {
  const { fitSheetCopy, FIT_KINDS } = await import('../src/pages/partner/offers/fitRules.js');
  assert.match(V2, /<h2 id="fth">Who is a great fit\?<\/h2>/, 'the canvas’s sheet title has moved');
  assert.equal(fitSheetCopy('best_fit').title, 'Who is a great fit?');
  assert.equal(fitSheetCopy('sector_declined').says, 'When someone isn’t a fit, what should we say?');
  assert.equal(fitSheetCopy('budget_floor').who, 'Minimum engagement');
  assert.deepEqual(FIT_KINDS.map(([k]) => k), ['best_fit', 'budget_floor', 'sector_declined', 'capability_absent']);
  const sheet = between(zone, 'export function FitRuleSheet(', 'function FitRulesTable(');
  assert.match(sheet, /useState\(initial\?\.kind \|\| 'best_fit'\)/, 'a new rule no longer starts as a great-fit profile');
  assert.match(sheet, /aria-expanded=\{advanced\}[\s\S]*Advanced rule types/, 'the rule types are no longer behind a disclosure');
  // D4844: the Offers field (`OfferField`), with its own error.
  assert.match(sheet, /\{advanced && \(\s*<OfferField label="Rule type"/, 'the rule type is shown before it is asked for');
  assert.ok(sheet.indexOf('copy.who') < sheet.indexOf('copy.says') && sheet.indexOf('copy.says') < sheet.indexOf('Can we point them somewhere else?'),
    'the questions are no longer in the canvas’s order: who, what to say, where to point them');
  // “Not yet” stays apart from a decline, and the sheet says which strengths scoring reads.
  assert.ok(zoneRaw.includes('Weak intent means “not yet”, which is not a decline.'), 'weak intent reads as a decline');
  assert.ok(zoneRaw.includes('Pipeline reads Best fit and Weak intent when it scores a lead; Qualified is a note you keep.'),
    'the sheet no longer says which strengths scoring reads');
});

test('Pass reasons runs, and its reason was wrong about its own store', () => {
  const canvasOps = JSON.parse(`[${PO5.match(/ops:\[([^\]]+)\]/)[1].replace(/'/g, '"')}]`);
  assert.deepEqual(canvasOps, ['Edit fit rules', 'Pass reasons', 'Export']);
  const ops = entriesIn(actions, "'offers/audience-fit': [");
  assert.deepEqual(ops.map((e) => e.match(/label: '([^']+)'/)[1]), canvasOps,
    'the ops row is no longer the artboard’s three labels in its order');
  assert.match(ops[1], /\{ label: 'Pass reasons', kind: 'handler', handler: 'passReasons' \}/,
    'Pass reasons is no longer performed by the page');
  assert.match(ops[2], /\{ label: 'Export', kind: 'export' \}/, 'the export has stopped running');
  // `Edit fit rules` STAYS PROSE, and for a reason a header control cannot get
  // around rather than for a missing store.
  assert.match(ops[0], /\{ label: 'Edit fit rules', unbuilt: 'every rule is edited on its own row/,
    'Edit fit rules has been given a control that cannot know which rule it means');
  // The retired reason is recorded, because it was a claim about the store and
  // the store contradicted it.
  // Flattened: both sentences wrap across comment lines.
  const doc = actionsRaw.replace(/^\s*\/\//gm, '').replace(/[`\s]+/g, ' ');
  assert.ok(doc.includes('a pass reason is not a stored field on a fit rule'),
    'the retired reason is no longer recorded, so the next reader re-adds it');
  assert.ok(doc.includes('partner_fit_rules .statement is exactly that field'),
    'the correction no longer names the field the reason denied');
  assert.match(zone, /passReasons: \(\) => \{ clearNote\(\); setShowingPasses\(true\); \}/,
    'the page no longer supplies the handler');
  assert.match(zone, /partnerZoneActions\('offers\/audience-fit', \{ handlers, view: \{/,
    'the action row drops handlers, so the op renders nowhere');
});

test('the pass note composes what the firm wrote, and never invents one', () => {
  const modal = between(zone, 'function PassReasons(', 'export default function PartnerAudienceFitZone');
  assert.match(modal, /const text = r\.statement\s*\n?\s*\? `\$\{r\.statement\}\$\{r\.referred_to \? ` We would point you to \$\{r\.referred_to\}\.` : ''\}`\s*\n?\s*: null;/,
    'the pass note is no longer assembled from the firm’s own sentence and referral');
  assert.ok(modal.includes('No sentence written. A pass citing this rule would have nothing to say'),
    'a rule with no sentence is getting one invented for it');
  assert.ok(modal.includes('Nothing sends these — a pass is still yours to make and yours to word.'),
    'the modal no longer says it sends nothing');
  // Exclusions only: a profile is who the firm IS for and is not passed on.
  assert.match(zone, /rules=\{items\.filter\(\(r\) => r\.is_active && r\.kind !== 'best_fit'\)\}/,
    'the pass reasons are being drawn from profiles as well as exclusions');
});

test('the AI band is the artboard’s, and its draft refuses to soften a pass', () => {
  const label = PO5.match(/aiLabel:'([^']*)'/)[1];
  const accept = PO5.match(/aiAccept:'([^']*)'/)[1];
  const foot = PO5.match(/aiFoot:'([^']*)'/)[1];
  const band = between(zone, '<ZoneDraft', '/>');
  assert.ok(band.includes('surface="offers/audience-fit"'), 'the band is on the wrong surface');
  assert.ok(band.includes(`label="${label}"`), `the band's label left the artboard: ${label}`);
  assert.ok(band.includes(`accept="${accept}"`), `the band's accept left the artboard: ${accept}`);
  assert.ok(band.includes(`foot="${foot}"`), `the band's footnote left the artboard: ${foot}`);
  const entry = between(spec, "'offers/audience-fit': {", "'offers/proof': {");
  assert.ok(entry.includes('never soften it into a maybe'),
    'the draft is no longer forbidden from turning a pass into a maybe');
  assert.ok(entry.includes('Where it names none, do not invent one'),
    'the draft may now invent a firm to refer to');
  assert.ok(entry.includes('NO SENTENCE RECORDED'),
    'the gathered rows no longer say which exclusions cannot be drafted from');
  assert.ok(entry.includes("WHERE r.partner_id = ? AND r.is_active = 1 AND r.kind <> 'best_fit'"),
    'the gather is no longer scoped to this firm’s own live exclusions');
});

test('StatCard went with the tiles it drew, and the docblock says why', () => {
  const at = zone.indexOf("} from '../kit';");
  assert.ok(at > 0, 'the kit import is gone');
  assert.ok(!/\bStatCard\b|\bSection\b/.test(zone.slice(0, at)), 'StatCard or Section is still imported and nothing uses it');
  assert.ok(zoneRaw.includes('D4842: no tile strip, no profile table and no "who we are not for" card.'),
    'the removal is no longer recorded, so the next reader re-adds it');
});
