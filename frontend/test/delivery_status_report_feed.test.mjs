/**
 * Delivery · Status reports — the `pd4` artboard, and three chips that selected
 * nothing.
 *
 * THE CHIP ROW WAS RIGHT AND THE RESPONSE WAS SHORT. `With blockers` filtered
 * on `r.blockers`, which the listing never returned; `This cycle` and `Archive`
 * compared against a `period` it never returned either — so the first fell
 * through to every report, the second to none, and the third to none. Four
 * chips, one of which worked. The compose endpoint had been reading blockers
 * live since it was written; the listing simply never joined them.
 *
 * BLOCKERS STAY LIVE, and that is the reason they were never a column. A prose
 * copy on the report row would go stale the moment one cleared, and the SIDE —
 * the thing that lets a report name a client-side blocker plainly without
 * leaning on it — is exactly what a stale copy loses. So the listing joins
 * OPEN blockers at read time, and a report's `Blocked on` cell is what is
 * blocking it now rather than what was blocking it when it was written.
 *
 * `Median read time` IS ABSENT FOR A HARDER REASON THAN THE ARTBOARD'S. Its
 * tile reads "reports do not report their own opens yet" — a missing feature.
 * Here a read needs an open, an open is the client's act, and no client-side
 * surface exists to record one at all: the same absence
 * `engagement_deliverables.opened_at` has. Timing from the send would measure
 * our own silence and call it their attention.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const read = (p) => codeOnly(raw(p));

const CANVAS = raw('design/canvases/integrated/Pages · Partner Delivery.dc.html');
const zone = read('frontend/src/pages/partner/delivery/StatusReportsZone.jsx');
const worker = raw('cloudflare-worker/src/routes/partner_delivery.ts');
const filters = read('frontend/src/workspaces/partnerZoneFilters.js');
const actions = read('frontend/src/workspaces/partnerZoneActions.js');
const spec = raw('cloudflare-worker/src/routes/research.ts');

const PD4 = CANVAS.slice(CANVAS.indexOf("{ id:'pd4'"), CANVAS.indexOf("{ id:'pd5'"));
assert.ok(PD4.includes("route:'/delivery/status-reports'"), 'the pd4 artboard could not be found in the canvas');

/** The source between two markers, with BOTH ends proven to exist. */
function between(src, a, b) {
  const from = src.indexOf(a);
  assert.ok(from >= 0, `the opening marker is gone: ${a}`);
  const to = src.indexOf(b, from + a.length);
  assert.ok(to > from, `the closing marker is gone: ${b}`);
  return src.slice(from, to);
}

/** The cells of the instrument row, split at TOP-LEVEL COMMAS (most are ternaries). */
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

/** Prose flattened out of comment markers, line wraps and `\uXXXX` escapes. */
const flat = (s) => s
  .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/^\s*(?:--|\/\/)/gm, '')
  .replace(/\s+/g, ' ');

const INST = between(zone, '<Instrument', '/>');

test('the strip is the artboard’s four tiles, counted over every report', () => {
  const adds = PD4.slice(PD4.indexOf('adds:['), PD4.indexOf('instTitle:'));
  const labels = [...adds.matchAll(/label: ?'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['In draft', 'Sent this cycle', 'Naming a blocker', 'Median read time']);
  const tiles = [...zone.matchAll(/<ReportTile\b[\s\S]{0,400}?label="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(tiles, labels, 'the strip is no longer the artboard’s four tiles in its order');

  // COUNTED SERVER-SIDE OVER EVERY REPORT, never over the chip-narrowed list:
  // a firm's draft count does not change because a reader clicked `Archive`.
  const strip = between(zone, '<ReportTile', '<Instrument');
  assert.ok(!/\bvisible\b/.test(strip), 'a strip tile is counting the chip-narrowed list');
  for (const field of ['draft_count', 'sent_this_cycle', 'blocked_count']) {
    assert.ok(strip.includes(`d?.${field}`), `the strip stopped reading ${field}`);
  }
});

test('Median read time is absent, and for a harder reason than the artboard’s', () => {
  // The artboard's own tile: absent, with its reason.
  assert.ok(/\{ label:'Median read time', nr:true/.test(PD4),
    'the artboard no longer refuses a read time');
  const strip = between(zone, '<ReportTile', '<Instrument');
  const tile = strip.slice(strip.indexOf('label="Median read time"'));
  assert.match(tile, /label="Median read time"\s*\n\s*nr\b/,
    'the read-time tile now shows a number');
  assert.ok(flat(tile).includes('nothing records that a client read one'),
    'the tile stopped saying why it is absent');

  // AND THE WORKER REFUSES IT AT SOURCE rather than the page hiding a figure.
  // A median timed from the send would be a number about our own silence.
  assert.ok(worker.includes('read_time_median_days: null,'),
    'the listing now computes a read time');
  assert.ok(flat(worker).includes('There is no client-side surface to record it on'),
    'the worker stopped saying why the read time is refused');
});

test('the instrument is the artboard’s five columns, at its own grid', () => {
  const cols = PD4.match(/cols:'([^']+)'/)[1];
  const head = [...PD4.slice(PD4.indexOf('head:['), PD4.indexOf('rows:')).matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(head, ['Client', 'Period', 'State', 'Shipped', 'Blocked on']);
  assert.ok(INST.includes(`cols="${cols}"`), `the instrument no longer uses the artboard grid ${cols}`);
  assert.deepEqual(
    [...between(INST, 'head={[', ']}').matchAll(/'([^']+)'/g)].map((m) => m[1]), head,
    'the instrument columns drifted from the artboard',
  );
  assert.ok(PD4.includes("instTitle:'Report feed'") && INST.includes('title="Report feed"'));
  assert.ok(PD4.includes("instMeta:'A draft is never sent automatically'"));
  assert.ok(INST.includes('meta="A draft is never sent automatically"'),
    'the instrument dropped the artboard’s meta');

  // PARSED IN ORDER, so swapping two cells cannot pass as a tally.
  const cells = cellsOf(INST);
  assert.equal(cells.length, 5, `the row draws ${cells.length} cells, not five`);
  assert.ok(/r\.founder_name/.test(cells[0]), 'the Client cell stopped naming the client');
  assert.ok(/r\.period/.test(cells[1]), 'the Period cell stopped reading the period');
  assert.ok(/r\.state === 'sent'/.test(cells[2]), 'the State cell stopped reading the state');
  assert.ok(/r\.shipped/.test(cells[3]), 'the Shipped cell stopped reading what was written');
  assert.ok(/r\.blockers/.test(cells[4]), 'the Blocked on cell stopped reading the blockers');
  // A DRAFT IS TINTED, the way the artboard tints it — the one row on the page
  // that is not yet a record of anything a client has seen. Asserted against
  // the whole canvas rather than the `pd4` slice: `repRows` is built in the
  // data prelude above `PAGES`, so the slice cannot see its own row builder.
  const repRows = between(CANVAS, 'const repRows = REP.map(', 'const RETAINER_UTIL');
  assert.ok(repRows.includes("rowStyle: r.state === 'Draft'"), 'the artboard stopped tinting drafts');
  assert.match(INST, /rowClass: r\.state === 'draft' \?/, 'a draft row is no longer marked');
});

test('the Blocked on cell is live, sided, and empty means nothing open', () => {
  const cell = cellsOf(INST)[4];
  // AN EM DASH IS A KNOWN NOTHING: the blockers table was read and had none.
  // `Not recorded` would claim we did not look.
  assert.ok(/r\.blockers\.length === 0\s*\n?\s*\?\s*\{ text: '—' \}/.test(cell),
    'a report with nothing open now reads as unrecorded rather than as clear');
  assert.ok(/b\.side === 'client'/.test(INST), 'the row stopped separating the client’s side from ours');
  assert.ok(flat(cell).includes('on the client’s side'), 'the row stopped naming whose side it is on');
  assert.ok(/pill: 'Blocked'/.test(cell), 'the artboard’s Blocked pill is gone');

  // AND THE LISTING READS OPEN BLOCKERS ONLY. A cleared one is what a report
  // USED to be blocked on; sweeping it in would report a solved problem as a
  // live one.
  const join = between(worker, 'const blockers = await c.env.DB.prepare(', 'const period = currentPeriod();');
  assert.ok(/FROM engagement_blockers b\s+JOIN engagements e ON e\.id = b\.engagement_id/.test(join),
    'the blocker join is no longer scoped through engagements');
  assert.ok(/WHERE e\.partner_id = \? AND b\.cleared_at IS NULL/.test(join),
    'the listing now returns cleared blockers, or reads another firm’s');
});

test('all four chips select something, and the two dead ones are why', () => {
  const chips = [...PD4.slice(PD4.indexOf('filters: fil(['), PD4.indexOf('ops:')).matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(chips, ['This cycle', 'Drafts', 'With blockers', 'Archive']);
  const row = between(filters, "'delivery/status-reports': [", '],');
  assert.deepEqual([...row.matchAll(/canvas: '([^']+)'/g)].map((m) => m[1]), chips);
  assert.ok(!/unbuilt/.test(row), 'a status-report chip went back to being prose');

  // THE TWO FIELDS THE CHIPS WAITED ON. `With blockers` needs `blockers` on
  // each row; `This cycle` and `Archive` need the cycle to compare against.
  // Both are asserted on the LISTING, because a chip reading a field the
  // response never sends is a control that lies rather than one that filters.
  const listing = between(worker, "partnerDelivery.get('/status-reports'", "partnerDelivery.get('/engagements/:engagementId/report-draft/:period'");
  assert.ok(/blockers: byEngagement\.get\(Number\(r\.engagement_id\)\) \|\| \[\],/.test(listing),
    'the listing stopped attaching blockers to each report');
  assert.ok(/^\s{6}period,$/m.test(listing), 'the listing stopped returning the current cycle');

  const narrowing = between(zone, "const visible = (() => {", '})();');
  assert.ok(/view === 'blocked'\) return items\.filter\(\(r\) => r\.blockers\.length > 0\);/.test(narrowing),
    'With blockers no longer selects the reports that name one');
  assert.ok(/view === 'archive'\) return items\.filter\(\(r\) => period && r\.period < period\);/.test(narrowing),
    'Archive no longer selects earlier cycles');
  assert.ok(/view === 'this_cycle'\) return items\.filter\(\(r\) => !period \|\| r\.period === period\);/.test(narrowing),
    'This cycle no longer selects the current one');
});

test('the ops row and the AI band are the artboard’s, and the surface is allow-listed', () => {
  const ops = [...PD4.slice(PD4.indexOf('ops:['), PD4.indexOf('adds:[')).matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(ops, ['Draft all', 'Cadence rules', 'Export']);
  const opRow = between(actions, "'delivery/status-reports': [", '],');
  assert.deepEqual([...opRow.matchAll(/label: '([^']+)'/g)].map((m) => m[1]), ops,
    'the ops row drifted from the artboard');

  assert.ok(PD4.includes("aiLabel:'Draft · weekly reports'"));
  assert.ok(PD4.includes("aiAccept:'Review the batch'"));
  assert.ok(PD4.includes('none send themselves'));
  const band = between(zone, '<ZoneDraft', '/>');
  assert.ok(band.includes('surface="delivery/status-reports"'));
  assert.ok(band.includes('label="Draft · weekly reports"'));
  assert.ok(band.includes('accept="Review the batch"'));
  // THE FOOT COUNTS WHAT WILL ACTUALLY BE DRAFTED. The artboard's "Four
  // drafts" is its own fixture; hardcoding four would state a batch size about
  // somebody else's firm.
  assert.ok(/foot=\{`\$\{engagements\.length\} draft\$\{engagements\.length === 1 \? '' : 's'\}; none send themselves\.`\}/.test(band),
    'the AI foot no longer counts this firm’s own batch');

  assert.ok(spec.includes("'delivery/status-reports': {"), 'the draft surface is not allow-listed');
  const surface = between(spec, "'delivery/status-reports': {", "'delivery/capacity': {");
  // THE COPY DECISION THE ZONE IS BUILT AROUND, both halves. One without the
  // other produces either an accusation or a report that hides why work stopped.
  assert.ok(flat(surface).includes('name it plainly and say the deadline does not move because of it'),
    'the draft may now bury a client-side blocker');
  assert.ok(flat(surface).includes('never use it as an excuse'),
    'the draft may now lean on a client-side blocker');
  assert.ok(flat(surface).includes('we have not heard, never that the client ignored it'),
    'the draft may now read an unopened deliverable as the client ignoring it');
});

test('the instNote carries the artboard’s finding, and nothing here claims to send', () => {
  assert.ok(flat(PD4).includes('not our delay, still our problem'));
  const note = between(INST, 'note={', '}\n');
  assert.ok(flat(note).includes('not our delay, still our problem'),
    'the instNote dropped the artboard’s finding');
  assert.ok(flat(note).includes('read live at this moment rather than copied into the report'),
    'the instNote stopped saying why blockers are not a column');

  // SENDING IS A PERSON'S ACT, and the page must not imply otherwise: nothing
  // in this product emails a client.
  assert.ok(worker.includes("delivery: 'manual',"), 'the listing stopped declaring manual delivery');
  assert.ok(zone.includes('d.delivery_note'), 'the page stopped printing what “sent” means');
  const limits = zone.slice(zone.indexOf('<StatedLimit'));
  assert.ok(flat(limits).includes('It means a person sent it'),
    'the limits stopped saying what “sent” records');
  assert.ok(flat(limits).includes('A sent report cannot be edited or deleted'),
    'the limits stopped saying a sent report is frozen');
});
