/**
 * Delivery · Deliverables — the `pd2` artboard, and the column this product
 * cannot fill from its own side.
 *
 * THE ZONE'S ARGUMENT WAS ALREADY THE ARTBOARD'S. "Work delivered into silence
 * is the firm's most expensive state — invoiced, unreviewed, and blocking the
 * next milestone." Migration 208 built the log for it and made `opened_at` and
 * `signed_off_at` the CLIENT'S columns: no route here accepts either, on create
 * or on patch. What was missing was the artboard — the strip, the `Shipped log`
 * instrument, and the AI band.
 *
 * ONE ABSENCE IS STRONGER HERE THAN ON THE ARTBOARD. Its `Median days to open`
 * reads absent because "too few opened items to state one honestly" — a small
 * sample. Here the sample is EMPTY: no founder-side surface writes `opened_at`
 * at all, so a median would be a number about our own silence rather than about
 * client behaviour. Same tile, absent for a harder reason, and the instNote says
 * which.
 *
 * AND `Never opened` NEVER MEANS IGNORED. The row says sent-and-not-acknowledged
 * -here, the AI draft is told the same, and both matter because the one thing
 * this zone knows for certain is that it does not know whether the client looked.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const read = (p) => codeOnly(raw(p));

const CANVAS = raw('design/canvases/integrated/Pages · Partner Delivery.dc.html');
const zoneRaw = raw('frontend/src/pages/partner/delivery/DeliverablesZone.jsx');
const zone = read('frontend/src/pages/partner/delivery/DeliverablesZone.jsx');
const worker = raw('cloudflare-worker/src/routes/partner_delivery.ts');
const filters = read('frontend/src/workspaces/partnerZoneFilters.js');
const actions = read('frontend/src/workspaces/partnerZoneActions.js');
const spec = raw('cloudflare-worker/src/routes/research.ts');

const PD2 = CANVAS.slice(CANVAS.indexOf("{ id:'pd2'"), CANVAS.indexOf("{ id:'pd3'"));
assert.ok(PD2.includes("route:'/delivery/deliverables'"), 'the pd2 artboard could not be found in the canvas');

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

/** The cells of the instrument row, split at TOP-LEVEL COMMAS (four are ternaries). */
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

test('the strip is the artboard’s four tiles, counted over the whole log', () => {
  const adds = PD2.slice(PD2.indexOf('adds:['), PD2.indexOf('instTitle:'));
  // The Delivery canvas writes `label:'…'` with no space; the Offers one writes
  // `label: '…'`. Both shapes, so a reader is not held to a whitespace habit.
  const labels = [...adds.matchAll(/label: ?'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['Never opened', 'Signed off', 'Shipped this month', 'Median days to open']);
  // READ OFF THE TILES THEMSELVES, not off every `label=` between the strip and
  // the instrument: the add-a-deliverable form sits in that gap and carries its
  // own field labels.
  const tiles = [...zone.matchAll(/<ShipTile\b[\s\S]{0,400}?label="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(tiles, labels, 'the strip is no longer the artboard’s four tiles in its order');
  // COUNTED OVER `items`, NEVER OVER THE CHIP-NARROWED LIST.
  const counts = between(zone, 'const unopened = items.filter(', 'const oldestUnopened =');
  assert.ok(!/\bvisible\b|\bordered\b/.test(counts), 'a tile count is reading the chip-narrowed list');
  assert.match(counts, /const unopened = items\.filter\(\(r\) => r\.sent_at && !r\.opened_at\);/,
    'the Never opened tile no longer counts sent-and-unopened rows');
  assert.match(counts, /const signedOff = items\.filter\(\(r\) => r\.signed_off_at\);/,
    'the Signed off tile no longer counts signed-off rows');
});

test('the median is absent for a harder reason than the artboard’s', () => {
  // The artboard's own tile and its reason.
  assert.match(PD2, /\{ label:'Median days to open', nr:true, note:'too few opened items to state one honestly' \}/,
    'the canvas’s median tile has moved');
  const median = between(zone, '<ShipTile\n            label="Median days to open"', '/>');
  assert.match(median, /\bnr\b/, 'the median tile is being given a number');
  assert.ok(median.includes('no opened_at is written anywhere, so there is no sample to take a median of'),
    'the median tile no longer says why the sample is empty rather than small');
  // AND `opened_at` STAYS THE CLIENT'S. No route accepts it, on create or patch,
  // which is what makes the absence structural rather than a display choice.
  const post = between(worker, "partnerDelivery.post('/engagements/:engagementId/deliverables'", 'partnerDelivery.patch');
  assert.ok(!/opened_at|signed_off_at/.test(post),
    'the create route now accepts a column the client owns');
  const patch = between(worker, "partnerDelivery.patch('/deliverables/:id'", "partnerDelivery.delete('/deliverables/:id'");
  assert.ok(!/put\('opened_at'|put\('signed_off_at'/.test(patch),
    'the patch route now writes a column the client owns');
});

test('the instrument draws the artboard’s five columns, in its order and at its widths', () => {
  const head = JSON.parse(`[${PD2.match(/head:\[([^\]]+)\]/)[1].replace(/'/g, '"')}]`);
  assert.deepEqual(head, ['Client', 'Deliverable', 'Sent', 'Age', 'Acknowledgment']);
  assert.ok(INST.includes(`head={${JSON.stringify(head).replace(/"/g, "'").replace(/,/g, ', ')}}`),
    'the instrument head is no longer the artboard’s five columns in its order');
  assert.ok(INST.includes(`cols="${PD2.match(/cols:'([^']+)'/)[1]}"`),
    'the instrument no longer uses the artboard’s column widths');
  assert.ok(INST.includes(`meta="${PD2.match(/instMeta:'([^']+)'/)[1]}"`),
    'the instrument’s meta line has left the artboard');
  assert.ok(INST.includes(`title="${PD2.match(/instTitle:'([^']+)'/)[1]}"`),
    'the instrument’s title has left the artboard');
});

test('the page actually does the order its meta line claims', () => {
  // "Unopened first, oldest first within it" is a claim the instrument makes in
  // prose, so the page sorts rather than trusting whatever the read returned.
  const sort = between(zone, 'const ordered = view ===', 'const rowActions =');
  assert.match(sort, /const au = a\.sent_at && !a\.opened_at \? 0 : 1;/, 'unopened rows no longer sort first');
  assert.match(sort, /return au - bu \|\| \(b\.days_since_sent \?\? -1\) - \(a\.days_since_sent \?\? -1\);/,
    'the oldest is no longer first within the unopened rows');
  // `By client` IS THE ONE CHIP THAT REPLACES THE ORDERING, because that is
  // what the chip is.
  assert.match(sort, /view === 'by_client' \? visible :/,
    'the By client chip no longer replaces the default ordering');
  // And the instrument and the log below draw the same list, in that order.
  assert.match(INST, /rows=\{ordered\.map\(/, 'the instrument is not drawing the ordered list');
  assert.match(zone, /\{ordered\.map\(\(row\) => \(/, 'the log below is not drawing the ordered list');
});

test('an unopened row is marked, and never called ignored', () => {
  const cells = cellsOf(INST);
  assert.equal(cells.length, 5, 'the row no longer draws one cell per artboard column');
  assert.match(cells[0], /row\.founder_name \? \{ text: row\.founder_name \} : \{ nr: true \}/,
    'the client column no longer states an absent client');
  assert.match(cells[1], /text: row\.title, sub: row\.version \? `v\$\{row\.version\}` : undefined/,
    'the deliverable column no longer carries the version');
  // AGE IS SINCE SENDING, and an unsent draft has no age — which is not zero.
  assert.match(cells[3], /row\.days_since_sent == null\s*\n?\s*\? \{ nr: true \}/,
    'an unsent draft is being given an age of zero');
  // THE FOUR ACKNOWLEDGMENT STATES, and the fourth is the one that matters.
  assert.match(cells[4], /row\.signed_off_at\s*\n?\s*\? \{ pill: 'Signed off', pillTone: 'ok' \}/,
    'a signed-off row no longer says so');
  assert.match(cells[4], /pill: 'Never opened', pillTone: 'danger', sub: 'or opened without telling us'/,
    'an unopened row is being called ignored rather than unacknowledged here');
  assert.match(cells[4], /\{ pill: 'Not sent', pillTone: 'neutral' \}/,
    'an unsent row is being drawn as unopened, which claims it went out');
  // The red tint is the artboard's own, and it is on the row rather than a note.
  assert.match(zone, /rowClass: isUnopened \? 'bg-red-50\/40 dark:bg-red-950\/10' : ''/,
    'the unopened rows no longer tint red');
});

test('the instNote carries the artboard’s argument and the harder absence', () => {
  const note = INST.slice(INST.indexOf('note={'));
  assert.match(PD2, /both invoiced, neither reviewed — which is also why that engagement reads at risk on the board/,
    'the canvas’s instNote has moved');
  assert.ok(note.includes('invoiced, unreviewed, and blocking the next milestone'),
    'the instNote no longer says what an unopened deliverable costs');
  assert.ok(note.includes('reads at risk on the board'),
    'the instNote no longer connects an unopened row to the board’s rating');
  assert.ok(note.includes('a median over a column nobody writes would be a number about our own silence'),
    'the instNote no longer says why the median is absent here');
  assert.ok(note.includes('never that the client ignored it'),
    'the instNote no longer refuses the reading it exists to refuse');
});

test('the chip row is the artboard’s four, with Never opened first', () => {
  const canvasChips = JSON.parse(`[${PD2.match(/filters: fil\(\[([^\]]+)\]/)[1].replace(/'/g, '"')}]`);
  assert.deepEqual(canvasChips, ['Never opened', 'All', 'Signed off', 'By client']);
  const chips = entriesIn(filters, "'delivery/deliverables': [");
  assert.deepEqual(chips.map((e) => e.match(/canvas: '([^']+)'/)[1]), canvasChips,
    'the chip row is no longer the artboard’s four labels in its order');
  for (const entry of chips) {
    assert.match(entry, /key: '[a-z_]+'/, `${entry} is not a live chip`);
  }
  // AND THE DEFAULT IS THE FIRST ONE, because the artboard selects it: a log
  // that opens on everything buries the state it exists to surface.
  assert.match(zone, /const \[view, setView\] = useState\('never_opened'\);/,
    'the log no longer opens on the unopened rows');
});

test('both writes stay prose, and their reasons are still exact', () => {
  const canvasOps = JSON.parse(`[${PD2.match(/ops:\[([^\]]+)\]/)[1].replace(/'/g, '"')}]`);
  assert.deepEqual(canvasOps, ['Chase unopened', 'Version history', 'Export']);
  const ops = entriesIn(actions, "'delivery/deliverables': [");
  assert.deepEqual(ops.map((e) => e.match(/label: '([^']+)'/)[1]), canvasOps,
    'the ops row is no longer the artboard’s three labels in its order');
  assert.match(ops[2], /\{ label: 'Export', kind: 'export' \}/, 'the export has stopped running');
  // `Chase unopened` — nothing here sends mail, and the AI band drafts the
  // notes a person then sends, which is a different thing from the op.
  assert.match(ops[0], /\{ label: 'Chase unopened', unbuilt: '/, 'Chase unopened claims to send something');
  // `Version history` — `engagement_deliverables.version` is a single column,
  // so there is no history to open.
  assert.match(ops[1], /\{ label: 'Version history', unbuilt: '/, 'Version history claims a history it does not keep');
  assert.ok(!/deliverable_versions|version_history/.test(worker),
    'a version history table exists now, so that op should no longer be prose');
});

test('the AI band is the artboard’s, and its count is this firm’s', () => {
  const band = between(zone, '<ZoneDraft', '/>');
  assert.ok(band.includes('surface="delivery/deliverables"'), 'the band is on the wrong surface');
  for (const [k, v] of [['label', 'aiLabel'], ['accept', 'aiAccept']]) {
    const want = PD2.match(new RegExp(`${v}:'([^']*)'`))[1];
    assert.ok(band.includes(`${k}="${want}"`), `the band's ${k} left the artboard: ${want}`);
  }
  // THE FOOT IS DERIVED, NOT TRANSCRIBED. The artboard's is "Two notes; a human
  // sends each." — two is its own sample.
  assert.match(PD2, /aiFoot:'Two notes; a human sends each\.'/, 'the canvas’s foot has moved');
  assert.ok(!band.includes('Two notes'), 'the band is printing the artboard’s own sample count');
  assert.match(band, /foot=\{`\$\{unopened\.length\} note\$\{unopened\.length === 1 \? '' : 's'\}; a human sends each\.`\}/,
    'the band’s count is no longer this firm’s unopened deliverables');
});

test('the draft chases what is unopened, and never implies the client ignored it', () => {
  const entry = between(spec, "'delivery/deliverables': {", "'delivery/board': {");
  assert.ok(entry.includes('never say or imply the client ignored it')
    || entry.includes('Never say or imply the client ignored it'),
    'the draft may now accuse the client of ignoring the work');
  assert.ok(entry.includes('this product records no opens at all'),
    'the draft is no longer told why an unopened row is not evidence of anything');
  assert.ok(entry.includes('assign no blame'), 'the draft may now assign blame');
  assert.ok(entry.includes('d.sent_at IS NOT NULL AND d.opened_at IS NULL'),
    'the gather is no longer reading the unopened rows');
  assert.ok(entry.includes('WHERE e.partner_id = ?'), 'the gather is no longer scoped to the caller’s firm');
  // It names what the review unblocks, which is the artboard's own instruction.
  // BOTH THE ALIAS AND ITS USE. The name appears twice — once as the SQL alias
  // and once in the sentence built from it — so renaming only the alias left
  // the guard green while the count came back undefined. An escape this suite's
  // own mutation run caught.
  assert.ok(entry.includes(') AS open_milestones'),
    'the gather no longer counts what an unreviewed deliverable is holding up');
  assert.ok(entry.includes('r.open_milestones'),
    'the gathered sentence no longer says what an unreviewed deliverable is holding up');
});

test('StatCard went with the four tiles it drew, and the docblock says which', () => {
  const at = zone.indexOf("} from '../kit';");
  assert.ok(at > 0, 'the kit import is gone');
  assert.ok(!/\bStatCard\b/.test(zone.slice(0, at)), 'StatCard is still imported and nothing uses it');
  assert.ok(zoneRaw.includes('`StatCard` went with the four tiles it drew'),
    'the removal is no longer recorded, so the next reader re-adds it');
});
