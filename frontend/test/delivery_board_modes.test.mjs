/**
 * Delivery · Board — the `pd1` artboard, and the zone that could not see its
 * own bucket.
 *
 * WHAT `/delivery/board` USED TO RENDER. `EngagementsPage` with
 * `view="engagements"` — a proposals-and-invoices page shared with
 * `/pipeline/proposals`, reading `engagements` and the quote ledger and nothing
 * else. Migration 208 built five stores for this bucket — milestones,
 * deliverables, seats, hours, blockers — and not one of them reached the page
 * the Delivery row lands on. The zone the bucket opens on was the only zone in
 * it that could not see the bucket.
 *
 * THE TWO MODES ARE NOT VARIANTS. "A project reports milestones, an embedded
 * seat reports hours against a grant the founder can revoke." Progress carries
 * two different measures and never one averaged one: a fraction of a scope and
 * a fraction of a week are not the same number.
 *
 * AND FOUR MORE ARTBOARDS WERE INVISIBLE. This bucket's canvas sits in
 * `design/canvases/integrated/` — verified byte-identical to the artifact the
 * work was specified from — and the partner profile's guards read only
 * `design/incoming/` for a `Pages · Partner (Network|Offers|Research)` pattern.
 * Widening it surfaced chip rows for all five Delivery zones, none of which the
 * filter table covered. A guard that cannot read a file reports the file as
 * empty; this one reported four artboards as specifying nothing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { srcFilesWith } from './_srcFilesWith.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const read = (p) => codeOnly(raw(p));

const CANVAS = raw('design/canvases/integrated/Pages · Partner Delivery.dc.html');
const zoneRaw = raw('frontend/src/pages/partner/delivery/BoardZone.jsx');
const zone = read('frontend/src/pages/partner/delivery/BoardZone.jsx');
const worker = raw('cloudflare-worker/src/routes/partner_delivery.ts');
const filters = read('frontend/src/workspaces/partnerZoneFilters.js');
const actions = read('frontend/src/workspaces/partnerZoneActions.js');
const routes = read('frontend/src/workspaces/partner/PartnerBucketRoutes.jsx');
const kit = read('frontend/src/workspaces/canvasKit.jsx');
const api = read('frontend/src/lib/api.js');
const spec = raw('cloudflare-worker/src/routes/research.ts');

const PD1 = CANVAS.slice(CANVAS.indexOf("{ id:'pd1'"), CANVAS.indexOf("{ id:'pd2'"));
assert.ok(PD1.includes("route:'/delivery/board'"), 'the pd1 artboard could not be found in the canvas');

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

// D4822 (#4822): Board v2 replaced the v1 instrument with an action-first table (canvas `Delivery v2`). The
// invariants this file guards are re-pointed at v2's helpers, which hold the rules the instrument's cells held.
const attention = read('frontend/src/pages/partner/delivery/boardAttention.js');
const pill = read('frontend/src/pages/partner/delivery/HealthPill.jsx');
const sheet = read('frontend/src/pages/partner/delivery/EngagementSheet.jsx');
const V2 = raw('design/incoming/Delivery v2 Page.dc.html');
const BOARD = between(worker, "partnerDelivery.get('/board'", "partnerDelivery.get('/health'");

test('the route the Delivery row lands on reads the Delivery stores', () => {
  assert.match(routes, /board: \(\) => <PartnerBoard \/>,/,
    'the board is rendering something other than its own zone again');
  assert.match(routes, /const PartnerBoard = lazy\(\(\) => import\('\.\.\/\.\.\/pages\/partner\/delivery\/BoardZone'\)\);/,
    'the board zone is not imported');
  // AND NO OTHER FILE CLAIMS THE ZONE. Two files building one zone's action
  // row is how a header row comes to describe a page the reader is not on;
  // `profile_zone_actions` fails on it, and this pins the reason. It read
  // `EngagementsPage` by name until D395 deleted that page, so it walks the
  // tree: the property is "the zone is the only builder".
  assert.deepEqual(srcFilesWith("partnerZoneActions('delivery/board'"),
    ['frontend/src/pages/partner/delivery/BoardZone.jsx'],
    'a second file is building the board’s action row');
  // The five stores the old page could not see.
  for (const table of ['engagement_seats', 'engagement_milestones', 'engagement_blockers',
    'engagement_deliverables', 'engagement_hours']) {
    // The trailing alias matters: `FROM engagement_hours` is a prefix of
    // `FROM engagement_hoursX`, so a renamed table satisfied the plain
    // substring — an escape this suite's own mutation run caught.
    assert.ok(new RegExp(`FROM ${table}\\s+[a-z]\\b`).test(BOARD),
      `the board read no longer reads ${table}`);
  }
});

test('mode is derived from the seat, and a revoked seat stays embedded', () => {
  // #4690: from the WHOLE COLLECTION of seats via the shared helper, not from
  // whichever row happened to be first.
  assert.match(BOARD, /mode: seats\.mode,/,
    'mode is no longer derived from whether a seat was granted');
  // NO COLUMN. A stored mode would be a second place to say what the seat
  // already says, and the two would part company the first time one was
  // revoked.
  assert.ok(!/ADD COLUMN mode|e\.mode/.test(BOARD), 'the board is reading a stored mode');
  assert.ok(worker.includes('MODE IS STRUCTURAL, NOT A STATUS'),
    'the route no longer records why mode is derived');
  // The seat the row is about is the most recent one, so a seat regranted after
  // a revocation is a live embedded engagement again.
  assert.match(BOARD, /const seats = seatStateFor\(seatByEng\.get\(id\) \|\| \[\]\);/,
    'the row no longer derives its seat state from the whole collection');
  assert.match(BOARD, /ORDER BY s\.granted_at DESC/, 'the seats are no longer read newest first');
  // A revoked seat is still a seat: the row keeps its mode and stays on the
  // board, struck through.
  assert.match(zone, /r\.seat_state === 'revoked' \? 'opacity-60' : ''/,
    'a revoked seat’s row is no longer dimmed');
  // ASSERTED POSITIVELY: the rows are the view's rows, and no view drops a revoked seat (`matchesView` reads mode,
  // attention and the client search only; the attention rule itself treats a revoked seat as closed, not absent).
  assert.match(zone, /const visible = items\.filter\(\(row\) => matchesView\(row, current, query\)\);/,
    'the board is narrowing the rows again — a revoked seat must stay visible');
  assert.ok(!/seat_revoked_at|seat_state/.test(attention.slice(attention.indexOf('export function matchesView'), attention.indexOf('export function primaryAction'))),
    'a view is filtering revoked seats out');
});

test('progress is two measures and is never averaged', () => {
  const fn = between(attention, 'export function progressText(', 'const dollars');
  assert.match(fn, /if \(row\.mode === 'project'\) return row\.milestone_count \? `\$\{row\.milestones_done\} \/ \$\{row\.milestone_count\} milestones` : null;/,
    'a project row no longer counts milestones, or shows a ratio over zero');
  assert.match(fn, /row\.hours_cap != null \? `\$\{h\}h \/ \$\{row\.hours_cap\}h \$\{per\}`/,
    'an embedded row no longer counts hours against the retained-hours cap');
  // An embedded seat with no retainer has NO cap, and the row says so rather than filling in a number.
  assert.match(fn, /no retained-hours cap/, 'a seat with no retainer is being measured against an invented cap');
  assert.ok(!/\/ 2|average|\+ row\.milestones/.test(fn), 'the two measures are being combined');
  assert.match(zone, /\{progressText\(r\) \|\| notRecorded\}/, 'a row with nothing to measure is drawn as a number');
});

test('health is the same computed rating, and null is drawn absent', () => {
  assert.match(BOARD, /const h = healthFor\(\{/, 'the board is no longer using the shared rating');
  assert.ok(!/health: '(on_track|at_risk|blocked)'/.test(BOARD),
    'the board is asserting a health rather than computing one');
  assert.match(zone, /<HealthPill health=\{r\.health\} \/>/, 'the Health column no longer draws the computed rating');
  // Null is "Not rated", dashed and worded, never green and never a default.
  assert.match(pill, /if \(!health \|\| !HEALTH_WORD\[health\]\) \{/, 'an unrated engagement is being drawn as a rating');
  assert.match(pill, /border-dashed[^"]*"[^>]*data-health="not_rated"/, 'Not rated is no longer drawn distinctly');
  assert.ok(!/health \|\| 'on_track'|\?\? 'on_track'/.test(pill + zone), 'an unrated engagement is being defaulted to on track');
  // And the strip says how much of the board could not be rated at all, so a
  // low `Need attention` cannot read as a healthy book.
  assert.match(BOARD, /unrated_count: items\.filter\(\(i: any\) => i\.health === null\)\.length,/,
    'the read no longer reports how much of the board is unrated');
  assert.ok(zone.includes('Not rated is not On track'),
    'the board no longer says an unrated engagement is not an on-track one');
});

test('the board read still counts its totals over the whole board (v2 draws no tile strip, D4822)', () => {
  // The v2 canvas (DL01) drops the four tiles: "do not display meaningless averages". The read still answers the
  // totals, counted the same way, for the surfaces that print them (Home, D394).
  assert.ok(!/BoardTile|Project value/.test(zone), 'the v1 tile strip is back on the v2 board');
  // COUNTED SERVER-SIDE OVER THE WHOLE BOARD, and the two money tiles exclude
  // revoked seats: a closed seat bills nothing this month.
  assert.match(BOARD, /const live = items\.filter\(\(i: any\) => i\.seat_state !== 'revoked'\);/,
    'the value tiles are no longer counted over the live board');
  assert.match(BOARD, /project_value: money\(live\.filter\(\(i: any\) => i\.mode === 'project'\)\),/,
    'the project-value tile is no longer summed over project engagements');
  // #4690: Embedded / month is the RECORDED RECURRING AMOUNT (shared retainer
  // rule), never the one-off quote `money()` sums.
  assert.match(BOARD, /const embeddedLive = live\.filter\(\(i: any\) => i\.mode === 'embedded' && !i\.cancelled_at\);/,
    'the embedded tile is no longer summed over live embedded engagements');
  assert.match(BOARD, /embedded_monthly: embeddedPriced\.length \? embeddedCents \/ 100 : null,/,
    'the embedded tile is no longer the recorded recurring amount');
  assert.match(BOARD, /revoked_seats: items\.reduce\(\(a: number, i: any\) => a \+ i\.revoked_seat_count, 0\),/,
    'the revoked tile is no longer counted over the whole board');
});

test('the board draws the v2 canvas’s six columns, in its order, as a semantic table (D4822)', () => {
  const head = [...V2.slice(V2.indexOf('<thead><tr>'), V2.indexOf('</tr></thead>')).matchAll(/<th scope="col">([^<]+)<\/th>/g)].map((m) => m[1]);
  assert.deepEqual(head, ['Client', 'Next action · why', 'Health', 'Progress', 'Owner', 'Mode · value']);
  const drawn = [...zone.matchAll(/<th scope="col" className="[^"]*">([^<]+)<\/th>/g)].map((m) => m[1]);
  assert.deepEqual(drawn, head, 'the board’s columns left the v2 canvas’s order');
  assert.match(zone, /<th scope="row"/, 'each row is no longer headed by its client');
  assert.match(zone, /<caption className="sr-only">/, 'the table lost its caption');
});

test('the grant holder is named where a seat is described: the engagement sheet’s capacity line', () => {
  assert.match(sheet, /row\.grant_holder \? `\$\{row\.grant_holder\} · ` : ''/,
    'the sheet no longer names who holds the seat');
});

test('the two Delivery marks are named in the kit, not improvised', () => {
  assert.match(kit, /export function GrantMark\(\{ children, revoked = false \}\)/,
    'the grant mark is gone from the kit');
  assert.match(kit, /export function ModeMark\(\{ children \}\)/, 'the mode mark is gone from the kit');
  assert.match(kit, /\{grant \? <GrantMark revoked=\{grantRevoked\}>\{grant\}<\/GrantMark> : null\}/,
    'the cell no longer draws a grant');
  assert.match(kit, /\{mode \? <ModeMark>\{mode\}<\/ModeMark> : null\}/, 'the cell no longer draws a mode');
  // REVOKED IS STRUCK THROUGH RATHER THAN REMOVED — a mark that vanished would
  // leave the row looking like a project.
  assert.match(kit, /revoked\s*\n?\s*\? 'border-gray-200 bg-gray-50 text-gray-500 line-through/,
    'a revoked grant no longer reads as struck through');
  assert.match(CANVAS, /\.grant\.rv\{[^}]*text-decoration:line-through\}/, 'the canvas’s revoked rule has moved');
  // The three-entry legend is its own component; `SourceLegend`'s two-entry
  // shape stays for the five artboards that draw exactly that.
  assert.match(kit, /export function Legend\(\{ items \}\)/, 'the general legend is gone');
  assert.match(kit, /export function SourceLegend\(/, 'the two-entry legend was removed rather than kept beside it');
});

test('the chip row exists, and attention is facts from the record, never an unrated row', () => {
  const canvasChips = JSON.parse(`[${PD1.match(/filters: fil\(\[([^\]]+)\]/)[1].replace(/'/g, '"')}]`);
  assert.deepEqual(canvasChips, ['All', 'Project', 'Embedded', 'Needs attention']);
  const chips = entriesIn(filters, "'delivery/board': [");
  assert.deepEqual(chips.map((e) => e.match(/canvas: '([^']+)'/)[1]), canvasChips,
    'the chip row is no longer the artboard’s four labels in its order');
  for (const entry of chips) {
    assert.match(entry, /key: '[a-z]+'/, `${entry} is not a live chip`);
  }
  // D4822: the page orders them Attention first and names them as the v2 canvas does.
  assert.match(zone, /\['Needs attention', 'attention', 'Attention'\], \['All', 'all', 'All'\], \['Project', 'project', 'Projects'\], \['Embedded', 'embedded', 'Embedded'\]/,
    'the board’s views left the v2 canvas’s order');
  const fn = between(attention, 'export function attentionReasons(', 'export const needsAttention');
  assert.ok(!/health === null|!row\.health\b/.test(fn),
    'an unrated engagement is being swept into attention, which turns “we have not looked” into “something is wrong”');
});

test('all five Delivery zones have their chip row, and the guard can see them', () => {
  // THE FINDING THIS FILE EXISTS FOR AS MUCH AS THE ARTBOARD. Four artboards
  // specified chip rows that no table covered, and the guard could not say so
  // because the canvas they come from was outside the pattern it read.
  for (const zoneKey of ['delivery/board', 'delivery/deliverables', 'delivery/capacity',
    'delivery/status-reports', 'delivery/health']) {
    assert.ok(filters.includes(`'${zoneKey}': [`), `${zoneKey} has no chip row`);
  }
  const guard = raw('frontend/test/profile_zone_filters.test.mjs');
  assert.ok(guard.includes("canvasDirs: ['design/incoming', 'design/canvases/integrated'],"),
    'the partner filter guard reads one directory again, so half its canvases are invisible');
  // NAMED, NOT PINNED. This asserted the whole alternation
  // (`Delivery|Network|Offers|Research`), so bringing the Pipeline canvas into
  // the same guard — which found five more uncovered chip rows — failed here
  // for no reason connected to Delivery. What this file needs to know is that
  // its own canvas is still read; which other buckets joined it is that
  // guard's business.
  const alternation = guard.match(/canvas: \/\^Pages · Partner \(([^)]*)\)/);
  assert.ok(alternation, 'the partner filter guard no longer selects its canvases by name');
  assert.ok(alternation[1].split('|').includes('Delivery'),
    'the partner filter guard no longer reads the Delivery canvas');
  // And each of the four other zones mounts what it declares.
  for (const [file, zoneKey] of [
    ['DeliverablesZone', 'delivery/deliverables'],
    ['CapacityZone', 'delivery/capacity'],
    ['StatusReportsZone', 'delivery/status-reports'],
    ['HealthZone', 'delivery/health'],
  ]) {
    const src = read(`frontend/src/pages/partner/delivery/${file}.jsx`);
    assert.ok(src.includes(`partnerZoneFilters('${zoneKey}'`), `${file} does not mount its chip row`);
    assert.ok(src.includes('<ZoneToolbar'), `${file} declares a chip row and renders no toolbar to put it in`);
  }
});

test('the ops row is the artboard’s three, and two are still prose', () => {
  const canvasOps = JSON.parse(`[${PD1.match(/ops:\[([^\]]+)\]/)[1].replace(/'/g, '"')}]`);
  assert.deepEqual(canvasOps, ['Bulk status update', 'Saved views', 'Export']);
  const ops = entriesIn(actions, "'delivery/board': [");
  assert.deepEqual(ops.map((e) => e.match(/label: '([^']+)'/)[1]), canvasOps,
    'the ops row is no longer the artboard’s three labels in its order');
  assert.match(ops[2], /\{ label: 'Export', kind: 'export' \}/, 'the export has stopped running');
  for (const entry of ops.slice(0, 2)) {
    assert.match(entry, /unbuilt: '/, `${entry} claims a control it does not have`);
  }
  // The export header is hoisted above the gate branch so an unlinked account
  // draws the same row — disabled, and saying so itself. It used to check
  // `<UnlinkedZone title="Board" actions={rowActions} />`, the card that
  // stood INSTEAD of the zone; the row now goes to the toolbar the live
  // branch uses, and the gate is a line above the body.
  assert.match(zone, /actions=\{rowActions\}/,
    'the gate branch no longer draws the same header row as the live one');
  assert.match(zone, /notice=\{unlinked \? <NoPartnerProfile \/> :/,
    'the gate stopped saying why the zone is empty');
  assert.match(zone, /filters=\{unlinked \? \[\] : chips\}/,
    'a filter chip is drawn over rows this account cannot read');
});

test('the read is scoped, mounted where the SPA calls it, and the draft is told what not to say', () => {
  // SCOPED ON THE ENGAGEMENTS SELECT ITSELF, not anywhere in the handler. The
  // six child reads each carry their own `WHERE e.partner_id = ?`, so a
  // whole-handler search was satisfied by any of them while the engagements
  // query returned every firm's rows — an escape this suite's own mutation run
  // caught.
  const engSelect = between(BOARD, 'SELECT e.id, e.uid, e.status', 'LIMIT 200');
  assert.ok(engSelect.includes('WHERE e.partner_id = ?'),
    'the board’s engagement read is no longer scoped to the caller’s firm');
  // MOUNTED AT `/api/partner/delivery`, beside its five siblings. The first
  // version of this method called `/partner-delivery/board`, which the drift
  // guard caught as a route the worker does not have.
  assert.match(api, /getPartnerDeliveryBoard: \(\) => request\('\/partner\/delivery\/board'\),/,
    'the board method points at a mount the worker does not serve');
  const entry = between(spec, "'delivery/board': {", "'offers/audience-fit': {");
  assert.ok(entry.includes('never suggest it for one'),
    'the draft may now answer a client-side blocker by adding people');
  assert.ok(entry.includes('it is unrated: say it has no signal rather than calling it on track'),
    'the draft may now read an empty engagement as healthy');
  assert.ok(entry.includes('WHERE e.partner_id = ?'), 'the gather is no longer scoped to the caller’s firm');
  const band = between(zone, '<ZoneDraft', '/>');
  for (const [k, v] of [['label', 'aiLabel'], ['accept', 'aiAccept'], ['foot', 'aiFoot']]) {
    const want = PD1.match(new RegExp(`${v}:'([^']*)'`))[1];
    assert.ok(band.includes(`${k}="${want}"`), `the band's ${k} left the artboard: ${want}`);
  }
  assert.ok(band.includes('surface="delivery/board"'), 'the band is on the wrong surface');
});
