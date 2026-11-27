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
// The SAME file unstripped. One slice below is bounded by a `{/* ══ … *\/}`
// section marker, and `codeOnly` now removes those — so a landmark that is
// itself a comment has to be read from the source that still has it. Every
// assertion stays on the stripped copy; only the boundary moves.
const zoneRaw = raw('frontend/src/pages/partner/pipeline/NegotiationsZone.jsx');
const worker = raw('cloudflare-worker/src/routes/partner_pipeline.ts');
const filters = read('frontend/src/workspaces/partnerZoneFilters.js');
const actions = read('frontend/src/workspaces/partnerZoneActions.js');
const spec = raw('cloudflare-worker/src/routes/research.ts');
const sheet = read('frontend/src/pages/partner/pipeline/NegotiationTermsSheet.jsx');
// D5938: the board this zone is drawn to now, `Pipeline v2` PP05 and PP05b.
const V2 = raw('design/incoming/Pipeline v2 Page.dc.html');
const PP05 = V2.slice(V2.indexOf('/* ---------- P3 negotiations ---------- */'), V2.indexOf('const negSheet = '));
const SHEET_CANVAS = V2.slice(V2.indexOf('const negSheet = '), V2.indexOf("</aside>';", V2.indexOf('const negSheet = ')));
assert.ok(PP05.includes('const NEG = {'), 'the PP05 board could not be found in the canvas');
assert.ok(SHEET_CANVAS.includes('cmp3'), 'the PP05b sheet could not be found in the canvas');

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
  // D4693: "open" is the shared rule, read off each item. #4701: the count walks the whole book.
  assert.ok(/scanAll\(/.test(read), 'the counts stopped walking the whole book');
  assert.ok(/if \(!x\.negotiation\?\.open\) continue;/.test(read),
    'the counts stopped excluding untracked and closed negotiations');
  assert.ok(/open: negotiationIsOpen\(r\.stage, r\.quote_status\)/.test(worker),
    'a negotiation is no longer open by the shared rule');
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
  // D5938: the board is PP05 of `Pipeline v2` now, its lanes the recorded
  // stages and its own "None at this stage" for an empty lane.
  assert.ok(/const NEG = \{ Scoping: \[[\s\S]*?Terms: \[[\s\S]*?Legal: \[[\s\S]*?'Ready to sign': \[\] \}/.test(PP05),
    'the PP05 lane list changed');
  assert.ok(PP05.includes('None at this stage'), 'the PP05 empty-lane copy is gone');
  assert.ok(zone.includes('None at this stage'), 'the zone stopped drawing an empty lane');

  // THE LIMIT IS NOT PRINTED. PP05 says so itself: "WIP limits · backend required".
  assert.ok(PP05.includes('WIP limits · backend required'), 'the canvas stopped marking WIP limits as unbuilt');
  // `visible`, NOT `open`. The lanes once filtered the unnarrowed list, so the
  // four chips above them were inert — CodeQL surfaced it as an unused
  // variable. `profile_zone_filters.test.mjs` holds that rule for every zone;
  // this pins it for the board it was found on.
  const lane = between(zoneRaw, 'const lanes = useMemo(', '{/* ══ THE EADWYN COUNTER');
  assert.ok(/cards: visible\.filter\(\(r\) => r\.negotiation\.stage === key\)/.test(lane),
    'the lanes went back to drawing the unnarrowed board, so the chips select nothing');
  assert.ok(!/cards: open\.filter/.test(zone), 'the lanes draw the unnarrowed board');
  assert.ok(!/\/ 5|\/5/.test(lane), 'the zone prints a WIP limit nothing stores');
  assert.ok(/\{cards\.length\}/.test(lane), 'the lane stopped counting its own cards');
  const opRow = between(actions, "'pipeline/negotiations': [", '],');
  assert.ok(/unbuilt/.test(opRow), 'the WIP-limit op became live over a limit nothing stores');

  // THE ONE OPEN QUESTION IS THE CARD'S REASON FOR EXISTING.
  const card = between(zoneRaw, 'function BoardCard(', 'function StageSelector(');
  assert.ok(/n\.open_question\s*\n?\s*\|\| <Unrecorded>No blocker named<\/Unrecorded>/.test(card),
    'a card with no blocker named now looks finished');
  // A STALLED CARD IS MARKED, and the threshold is the strip's.
  assert.ok(/\(n\.days_stalled \?\? 0\) >= 7/.test(card),
    'the card stopped marking a stalled negotiation, or uses a second threshold');
});

test('the terms sheet is PP05b’s three positions, and an empty landing is a state', () => {
  const head = [...between(SHEET_CANVAS, '<table class="cmp3"><thead><tr>', '</tr></thead>').matchAll(/<th>([^<]+)<\/th>/g)].map((m) => m[1]);
  assert.deepEqual(head, ['Term', 'We proposed', 'They proposed', 'Current position']);
  const table = between(sheet, 'data-testid="terms-compare"', '</thead>');
  assert.deepEqual([...table.matchAll(/<th scope="col"[^>]*>([^<]+)<\/th>/g)].map((m) => m[1]), head,
    'the sheet’s columns drifted from PP05b');
  // THREE POSITIONS, AND THE THIRD MAY BE EMPTY WITHOUT THE ROW BEING
  // INCOMPLETE — a clause with no landing reads its state ("Open"), not a gap.
  const current = between(sheet, 'function CurrentPosition(', 'function TermName(');
  assert.ok(/if \(term\.landing\)/.test(current) && /return <span className="font-extrabold">\{label\}<\/span>;/.test(current),
    'a term with no landing no longer reads its state');
});

test('all four chips select, and the close-probability refusal is the current one', () => {
  const chips = [...between(CANVAS, "n_views: views([", '])').matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(chips, ['All', 'Awaiting you', 'Awaiting them', 'Stalled 7d+']);
  const row = between(filters, "'pipeline/negotiations': [", '],');
  assert.deepEqual([...row.matchAll(/canvas: '([^']+)'/g)].map((m) => m[1]), chips);
  assert.ok(!/unbuilt/.test(row), 'a negotiations chip went back to being prose');
  const narrowing = between(zone, 'const visible = useMemo(() => {', '}, [view, open]);');
  assert.ok(/view === 'us'/.test(narrowing) && /view === 'them'/.test(narrowing)
    && /view === 'stalled'/.test(narrowing), 'a chip selects nothing');
  // `All` IS THE BOARD, NOT EVERY ENGAGEMENT. It returned `items` — including
  // the rows nobody is negotiating and the ones already closed — so the one
  // chip meant to show the whole board would have shown more than the strip
  // beside it counts.
  assert.ok(/return open;/.test(narrowing) && !/return items;/.test(narrowing),
    'the All chip shows rows that are not on the board');

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

test('the AI band is PP05b’s counter, and the counter is built from the clauses', () => {
  // D5938: PP05b draws the counter "not sent" with Accept counter draft, Edit
  // terms and Discard, and no Send. The band draws "Not sent" and its three
  // controls only while a draft exists (ZoneDraft's `item`).
  for (const s of ['Eadwyn counter proposal · not sent', 'Accept counter draft', 'Edit terms', 'Discard']) {
    assert.ok(SHEET_CANVAS.includes(s), `PP05b no longer draws ${s}`);
  }
  assert.ok(!/Send counter/.test(PP05 + SHEET_CANVAS), 'the PP05 canvas draws a Send counter');
  const band = between(zone, '<ZoneDraft', '/>');
  assert.ok(band.includes('surface="pipeline/negotiations"'));
  assert.ok(band.includes('label="Eadwyn counter proposal"'));
  assert.ok(band.includes('status="Not sent"'));
  assert.ok(band.includes('accept="Accept counter draft"'));
  assert.ok(band.includes('editLabel="Edit terms"'));
  assert.ok(!/Send counter/.test(zone), 'the zone offers to send a counter');

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
