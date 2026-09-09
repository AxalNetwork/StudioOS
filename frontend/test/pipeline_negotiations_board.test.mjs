/**
 * Pipeline · Negotiations — the `p3` artboard, and a limit that is not this
 * firm's.
 *
 * THE STORES WERE ALREADY THERE. Migration 208 built `quote_negotiations`
 * (stage, whose move it is, the one open question) and `quote_terms` (a clause
 * with three positions), and this zone has read them since. What was missing
 * was the artboard: no chip row at all — the whole Pipeline bucket had none —
 * no strip in the artboard's own four, no LANES, and no clause table.
 *
 * IT IS A WORK BOARD AND THE LANES ARE THE POINT. Four stages across, one card
 * per negotiation, and the one open question on every card: "a negotiation
 * without a named blocker is a negotiation nobody is running." A card with no
 * blocker named says so rather than looking finished.
 *
 * THE LANE COUNT IS A COUNT, NOT A LIMIT. The artboard draws `n / 5` and its
 * ops row offers to edit the five. No per-stage limit is stored anywhere and
 * the five is the canvas's own sample — printing it would police this firm's
 * board with somebody else's number, which is the same call `delivery/capacity`
 * makes about the hardcoded forty it refuses to treat as a cap.
 *
 * AND THE CLOSE-PROBABILITY REFUSAL SURVIVED ON A NEW REASON. The old one —
 * "nothing records why a past negotiation was won or lost" — stopped being true
 * when migration 234 added the loss taxonomy. What is still true is that a
 * taxonomy is not a rate.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const read = (p) => codeOnly(raw(p));

const CANVAS = raw('design/canvases/integrated/Pages · Partner Pipeline.dc.html');
const zone = read('frontend/src/pages/partner/pipeline/NegotiationsZone.jsx');
const worker = raw('cloudflare-worker/src/routes/partner_pipeline.ts');
const filters = read('frontend/src/workspaces/partnerZoneFilters.js');
const actions = read('frontend/src/workspaces/partnerZoneActions.js');
const spec = raw('cloudflare-worker/src/routes/research.ts');

const P3 = CANVAS.slice(
  CANVAS.indexOf('<section class="ab" id="p3">'),
  CANVAS.indexOf('<section class="ab" id="p4">'),
);
assert.ok(P3.includes('/pipeline/negotiations'), 'the p3 artboard could not be found in the canvas');

/** The source between two markers, with BOTH ends proven to exist. */
function between(src, a, b) {
  const from = src.indexOf(a);
  assert.ok(from >= 0, `the opening marker is gone: ${a}`);
  const to = src.indexOf(b, from + a.length);
  assert.ok(to > from, `the closing marker is gone: ${b}`);
  return src.slice(from, to);
}

/** Prose flattened out of comment markers, line wraps and `\uXXXX` escapes. */
const flat = (s) => s
  .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/^\s*(?:--|\/\/)/gm, '')
  .replace(/\s+/g, ' ');

test('the strip is the artboard’s four, counted over what is in play', () => {
  const stats = between(CANVAS, 'n_stats: [', 'n_lanes:');
  const labels = [...stats.matchAll(/label: ?'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['Live negotiations', 'Awaiting you', 'Awaiting them', 'Stalled 7d+']);
  const tiles = [...zone.matchAll(/<NegotiationTile\b[\s\S]{0,400}?label="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(tiles, labels, 'the strip is no longer the artboard’s four tiles in its order');

  // A CLOSED NEGOTIATION IS IN NONE OF THE COUNTS, and a quote nobody is
  // tracking is not a negotiation at all — folding either in would make the
  // board look busier than the work is.
  const read = between(worker, "partnerPipeline.get('/negotiations'", 'PUT because');
  assert.ok(/const open = items\.filter\(\s*\(x: any\) => x\.negotiation && x\.negotiation\.stage !== 'closed',\s*\);/.test(read),
    'the counts stopped excluding untracked and closed negotiations');
  for (const field of ['live_count', 'awaiting_us_count', 'awaiting_them_count', 'stalled_count']) {
    assert.ok(read.includes(`${field}:`), `the read stopped returning ${field}`);
  }
  // SEVEN DAYS, computed in the WORKER. A page computing its own age from a
  // different clock would make the chip and the strip disagree.
  assert.ok(/\(x\.negotiation\.days_stalled \?\? 0\) >= 7/.test(read),
    'the stalled threshold moved out of the worker or changed');
  assert.ok(/days_stalled: daysBetween\(r\.last_moved_at\)/.test(worker),
    'days_stalled is no longer computed from last_moved_at');
});

test('the lanes are the board, and the count is a count', () => {
  const lanes = between(zone, 'const LANES = [', '];');
  assert.deepEqual([...lanes.matchAll(/'(Scoping|Terms|Legal|Ready to sign)'/g)].map((m) => m[1]),
    ['Scoping', 'Terms', 'Legal', 'Ready to sign']);
  assert.ok(!/closed/.test(lanes), 'a closed negotiation is being drawn as a lane');
  // The artboard's own four, and its own `Nothing here` for an empty lane.
  assert.ok(flat(CANVAS).includes("'Scoping','Terms','Legal','Ready to sign'"),
    'the artboard’s lane list changed');
  assert.ok(P3.includes('Nothing here'), 'the artboard’s empty-lane copy is gone');
  assert.ok(zone.includes('Nothing here'), 'the zone stopped drawing an empty lane');

  // THE LIMIT IS NOT PRINTED. The artboard's `n / 5` is its own sample.
  assert.ok(flat(CANVAS).includes("count:String(cards.length) + ' / 5'"),
    'the artboard stopped drawing a per-stage limit');
  const lane = between(zone, 'const cards = open.filter', '{/* ══ TERMS IN PLAY');
  assert.ok(!/\/ 5|\/5/.test(lane), 'the zone prints the canvas’s own WIP limit as this firm’s');
  assert.ok(/\{cards\.length\}/.test(lane), 'the lane stopped counting its own cards');
  const opRow = between(actions, "'pipeline/negotiations': [", '],');
  assert.ok(/unbuilt/.test(opRow), 'the WIP-limit op became live over a limit nothing stores');

  // THE ONE OPEN QUESTION IS THE CARD'S REASON FOR EXISTING.
  assert.ok(flat(P3).includes('a negotiation without a named blocker is a negotiation nobody is running'));
  assert.ok(/r\.negotiation\.open_question\s*\n?\s*\|\| <Unrecorded>No blocker named<\/Unrecorded>/.test(lane),
    'a card with no blocker named now looks finished');
  // A STALLED CARD IS MARKED, and the threshold is the strip's.
  assert.ok(/\(r\.negotiation\.days_stalled \?\? 0\) >= 7/.test(lane),
    'the card stopped marking a stalled negotiation, or uses a second threshold');
});

test('the clause table is the artboard’s four columns, and only open terms', () => {
  const grids = [...P3.matchAll(/grid-template-columns:([^;"]+)/g)].map((m) => m[1].trim());
  const cols = grids.find((g) => g.includes('1.4fr'));
  assert.ok(cols, 'the artboard’s clause-table grid is gone');
  const head = [...P3.matchAll(/class="th"[^>]*>([^<]*)</g)].map((m) => m[1].trim());
  assert.deepEqual(head, ['Client', 'You asked', 'They asked', 'Where it lands']);

  const inst = between(zone, 'testid="terms-in-play"', '/>');
  assert.ok(inst.includes(`cols="${cols}"`), `the instrument no longer uses the artboard grid ${cols}`);
  assert.deepEqual(
    [...between(inst, 'head={[', ']}').matchAll(/'([^']+)'/g)].map((m) => m[1]), head,
    'the clause columns drifted from the artboard',
  );
  assert.ok(inst.includes('meta="The clause-level view · only here"'),
    'the artboard’s subtitle for the clause table is gone');
  assert.ok(P3.includes('The clause-level view · only here'));

  // THREE POSITIONS, AND THE THIRD MAY BE EMPTY WITHOUT THE ROW BEING
  // INCOMPLETE — that is the whole reason a term carries three.
  assert.ok(/t\.landing \? \{ text: t\.landing \} : \{ nr: true \}/.test(inst),
    'a term with no landing is no longer drawn as still open');
  assert.ok(flat(inst).includes('is not a gap in the record, it is a negotiation still running'),
    'the note stopped saying why an empty landing is fine');
  // ONLY OPEN TERMS. A settled clause belongs to the deal, not to the board.
  assert.ok(/\.filter\(\(t\) => t\.state === 'open'\)/.test(inst),
    'settled terms are back on the board');
});

test('all four chips select, and the close-probability refusal is the current one', () => {
  const chips = [...between(CANVAS, "n_views: views([", '])').matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(chips, ['All', 'Awaiting you', 'Awaiting them', 'Stalled 7d+']);
  const row = between(filters, "'pipeline/negotiations': [", '],');
  assert.deepEqual([...row.matchAll(/canvas: '([^']+)'/g)].map((m) => m[1]), chips);
  assert.ok(!/unbuilt/.test(row), 'a negotiations chip went back to being prose');
  const narrowing = between(zone, 'const visible = useMemo(() => {', '}, [view, open, items]);');
  assert.ok(/view === 'us'/.test(narrowing) && /view === 'them'/.test(narrowing)
    && /view === 'stalled'/.test(narrowing), 'a chip selects nothing');

  // THE REFUSAL SURVIVES ON THE ARGUMENT THAT SURVIVED. Migration 234 records
  // why a bid was LOST — a taxonomy — which is not a rate.
  assert.ok(worker.includes('close_probability: null,'), 'a close probability is being returned');
  assert.ok(flat(worker).includes('taxonomy rather than a rate'),
    'the worker stopped saying why it refuses one');
  const limits = zone.slice(zone.indexOf('<StatedLimit'));
  assert.ok(flat(limits).includes('Nothing here forecasts a close'));
  assert.ok(!/nothing records why a past negotiation was won or lost/i.test(zone),
    'the zone claims a gap migration 234 closed');
  assert.ok(flat(limits).includes('The lane count is a count, not a limit'),
    'the limits stopped saying the lane count is not a WIP limit');
});

test('the AI band is the artboard’s, and the counter is built from the clauses', () => {
  assert.ok(P3.includes('Proposal · counter drafted'));
  assert.ok(P3.includes('Send counter'));
  const band = between(zone, '<ZoneDraft', '/>');
  assert.ok(band.includes('surface="pipeline/negotiations"'));
  assert.ok(band.includes('label="Proposal · counter drafted"'));
  assert.ok(band.includes('accept="Send counter"'));

  assert.ok(spec.includes("'pipeline/negotiations': {"), 'the draft surface is not allow-listed');
  const surface = between(spec, "'pipeline/negotiations': {", "'pipeline/proposals': {");
  // A COUNTER NAMING A TERM THE FIRM NEVER PUT IN WRITING IS WORSE THAN NO
  // COUNTER, because a person may send it.
  assert.ok(flat(surface).includes('Never invent a term, a price or a concession'),
    'the draft may now invent a concession');
  assert.ok(flat(surface).includes('why the two positions cannot both hold'),
    'the draft stopped being asked for the one line that is its job');
  assert.ok(flat(surface).includes('time since a RECORDED move, not since the client last spoke'),
    'the draft may now read a stalled count as client silence');
  // AND THE GATHER READS OPEN NEGOTIATIONS, oldest move first — the one that
  // has been still longest is the one the counter is for.
  assert.ok(/g\.stage <> 'closed'/.test(surface), 'the gather is drafting counters for closed deals');
  assert.ok(/ORDER BY g\.last_moved_at ASC/.test(surface),
    'the gather stopped putting the longest-still negotiation first');
});
