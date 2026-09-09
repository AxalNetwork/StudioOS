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
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const read = (p) => codeOnly(raw(p));

const CANVAS = raw('design/incoming/Pages · Partner Offers.dc.html');
const zoneRaw = raw('frontend/src/pages/partner/offers/AudienceFitZone.jsx');
const zone = read('frontend/src/pages/partner/offers/AudienceFitZone.jsx');
const worker = raw('cloudflare-worker/src/routes/partner_offers.ts');
const migration = raw('cloudflare-worker/sql/migrations/229_fit_rule_signal.sql');
const filters = read('frontend/src/workspaces/partnerZoneFilters.js');
const filtersRaw = raw('frontend/src/workspaces/partnerZoneFilters.js');
const actions = read('frontend/src/workspaces/partnerZoneActions.js');
const actionsRaw = raw('frontend/src/workspaces/partnerZoneActions.js');
const spec = raw('cloudflare-worker/src/routes/research.ts');

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

/** The cells of the instrument row, split at TOP-LEVEL COMMAS (two are ternaries). */
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

test('the strength is a stored judgement, and it is not a score', () => {
  const sql = migration.replace(/^\s*--.*$/gm, '');
  assert.match(sql, /ALTER TABLE partner_fit_rules\s*\n\s*ADD COLUMN signal TEXT/, 'the signal column is gone');
  assert.match(sql, /CHECK \(signal IS NULL OR signal IN \('best_fit', 'qualified', 'weak_intent'\)\)/,
    'the signal column accepts any text again');
  // NULLABLE WITH NO DEFAULT. A profile the firm has not graded reads ungraded;
  // defaulting it would put a judgement — the strongest of the three — in the
  // firm's mouth.
  assert.ok(!/signal TEXT[^;]*DEFAULT/.test(sql), 'the signal column has been given a default');
  // AND NOTHING SCORES ANYBODY. The response still says so, which is the claim
  // the retired chip reasons were right about.
  assert.match(worker, /enforcement: 'none',/, 'the response no longer says nothing enforces these rules');
  assert.ok(zone.includes('<strong>Nothing runs these rules.</strong>'),
    'the zone no longer states that nothing runs these rules');
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
  assert.match(zone, /const visible = view === 'all' \? items : profiles\.filter\(\(r\) => r\.signal === view\);/,
    'the strength chips are no longer selecting the firm’s profiles by their signal');
  assert.match(zone, /const profiles = items\.filter\(\(r\) => r\.kind === 'best_fit'\);/,
    'the profiles and the exclusions are no longer split');
});

test('the strip is the artboard’s four tiles, and an absent floor says so', () => {
  const adds = PO5.slice(PO5.indexOf('adds:['), PO5.indexOf('linkage:'));
  const labels = [...adds.matchAll(/label:'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['Best fit', 'Budget floor', 'Sectors declined', 'Capabilities absent']);
  const strip = between(zone, '<div className="grid grid-cols-2 gap-3 md:grid-cols-4">', 'Reads through to Pipeline');
  assert.deepEqual([...strip.matchAll(/label="([^"]+)"/g)].map((m) => m[1]), labels,
    'the strip is no longer the artboard’s four tiles in its order');
  // A firm with no floor and a firm whose floor is zero are different, and an
  // em dash reads as the second.
  assert.match(strip, /nr=\{floor\?\.floor_cents == null\}/,
    'a firm with no floor is being shown an em dash rather than an absence');
  assert.ok(strip.includes('note="stated, not stretched"'),
    'the Capabilities tile lost the artboard’s note');
  // Counted over the record, never over the chip-narrowed list.
  const counts = between(zone, 'const bestFit = profiles.filter(', 'const ANTI = [');
  assert.ok(!/\bvisible\b/.test(counts), 'a tile count is reading the chip-narrowed list');
});

test('the linkage note says what the rules are for, and stops where the record stops', () => {
  assert.match(PO5, /produced ' \+ nWord\(4\) \+ ' explained passes last quarter/,
    'the canvas’s pass count has moved');
  const note = between(zone, 'Reads through to Pipeline:', '<Instrument');
  assert.ok(note.includes('quotes these sentences to pass a lead with a named reason'),
    'the linkage note no longer says what Pipeline does with these rules');
  assert.ok(note.includes('under floor,\n            referred to Ostara Studio') || note.includes('referred to Ostara Studio'),
    'the linkage note no longer shows the shape of a pass with a reason');
  assert.ok(!/explained passes last quarter/.test(note),
    'the linkage note is printing a pass count nothing in this product logs');
  assert.ok(note.includes('no pass is\n            logged anywhere') || note.includes('no pass is'),
    'the linkage note no longer says why the count is absent');
});

test('the instrument draws the artboard’s three columns, in its order and at its widths', () => {
  const head = JSON.parse(`[${PO5.match(/head:\[([^\]]+)\]/)[1].replace(/'/g, '"')}]`);
  assert.deepEqual(head, ['Profile', 'Signal', 'Why']);
  assert.ok(INST.includes(`head={${JSON.stringify(head).replace(/"/g, "'").replace(/,/g, ', ')}}`),
    'the instrument head is no longer the artboard’s three columns in its order');
  assert.ok(INST.includes(`cols="${PO5.match(/cols:'([^']+)'/)[1]}"`),
    'the instrument no longer uses the artboard’s column widths');
  assert.ok(INST.includes(`meta="${PO5.match(/instMeta:'([^']+)'/)[1]}"`),
    'the instrument’s meta line has left the artboard');
  assert.ok(INST.includes(`title="${PO5.match(/instTitle:'([^']+)'/)[1]}"`),
    'the instrument’s title has left the artboard');
  // IT DRAWS THE PROFILES, not every rule: the exclusions are the card below,
  // which is how the artboard splits them.
  assert.match(INST, /rows=\{profiles\.map\(/, 'the instrument is no longer drawing only the profiles');
});

test('an ungraded profile and an unwritten sentence both read absent', () => {
  const cells = cellsOf(INST);
  assert.equal(cells.length, 3, 'the row no longer draws one cell per artboard column');
  assert.match(cells[0], /text: r\.value \|\| undefined/, 'the first column is no longer the profile');
  assert.match(cells[0], /\.\.\.\(r\.is_active \? \{\} : \{ gate: 'Not in use' \}\)/,
    'a retired profile no longer says it is not in use');
  assert.match(cells[1], /r\.signal\s*\n?\s*\? \{ pill: SIGNAL_LABEL\[r\.signal\], pillTone: SIGNAL_TONE\[r\.signal\] \}\s*\n?\s*: \{ nr: true \}/,
    'an ungraded profile is being given a strength it was never assigned');
  // A profile with no sentence is the zone's own failure case, so it is named
  // rather than left blank.
  assert.match(cells[2], /r\.statement \? \{ text: r\.statement \} : \{ nr: true \}/,
    'a profile with no sentence no longer says so');
});

test('the instNote keeps “not yet” apart from a decline, and refuses the meta line’s claim', () => {
  const note = INST.slice(INST.indexOf('note={'));
  assert.match(PO5, /Pre-product founders read as weak intent rather than declined/,
    'the canvas’s instNote has moved');
  assert.ok(note.includes('A profile graded weak intent is not a decline'),
    'the instNote no longer keeps a weak profile out of the exclusions');
  assert.ok(note.includes('ends up saying \\u201cno\\u201d to the same founder twice')
    || note.includes('to the same founder twice'),
    'the instNote no longer carries the artboard’s argument for “not yet”');
  // THE META LINE IS THE ARTBOARD'S AND IT DESCRIBES AN INTENTION. "Signals
  // feed lead scoring" — nothing scores a lead here, and the note says so
  // rather than letting the line stand as a claim about this product.
  assert.ok(note.includes('nothing scores a lead against these rows'),
    'the instNote no longer refuses the scoring its own meta line implies');
});

test('the anti-persona card is first-class, and an unwritten kind says so', () => {
  assert.match(CANVAS, /Who we are not for<\/span>/, 'the canvas’s anti card has moved');
  assert.match(CANVAS, /First-class — a pass needs a reason, not a shrug/, 'the canvas’s anti note has moved');
  const card = between(zone, 'Who we are not for', '<ZoneDraft');
  assert.ok(card.includes('First-class — a pass needs a reason, not a shrug'),
    'the anti card lost the artboard’s own note');
  // THREE ACROSS, one per exclusion KIND, which is how the artboard groups it.
  assert.match(zone, /const ANTI = \[/, 'the anti-persona grouping is gone');
  const anti = between(zone, 'const ANTI = [', 'const handlers = {');
  assert.deepEqual([...anti.matchAll(/k: '([^']+)'/g)].map((m) => m[1]),
    ['Budget floor', 'Sectors declined', 'Capability absent'],
    'the anti card is no longer the artboard’s three exclusion kinds in its order');
  assert.match(card, /md:grid-cols-3/, 'the anti card is no longer three across');
  // A kind the firm has written nothing under is DRAWN and says so — an
  // exclusion nobody stated is the reason a pass lands silent, so dropping the
  // card would hide the very gap this zone is about.
  assert.match(card, /\{an\.v \|\| <NotRecorded>Nothing stated<\/NotRecorded>\}/,
    'an exclusion nobody has written is being dropped rather than stated');
  assert.ok(card.includes('No sentence written, so a pass citing this would have nothing to say.'),
    'an exclusion with no sentence no longer says what that costs');
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
  assert.match(zone, /passReasons: \(\) => \{ setNote\(null\); setShowingPasses\(true\); \}/,
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

test('StatCard went with the four tiles it drew, and the docblock says which', () => {
  const at = zone.indexOf("} from '../kit';");
  assert.ok(at > 0, 'the kit import is gone');
  assert.ok(!/\bStatCard\b/.test(zone.slice(0, at)), 'StatCard is still imported and nothing uses it');
  assert.ok(zoneRaw.includes('`StatCard` went with the four tiles it drew'),
    'the removal is no longer recorded, so the next reader re-adds it');
});
