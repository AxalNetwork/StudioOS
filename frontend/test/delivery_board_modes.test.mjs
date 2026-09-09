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
const engagements = read('frontend/src/pages/partner/operations/EngagementsPage.jsx');
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
const BOARD = between(worker, "partnerDelivery.get('/board'", "partnerDelivery.get('/health'");

test('the route the Delivery row lands on reads the Delivery stores', () => {
  assert.match(routes, /board: \(\) => <PartnerBoard \/>,/,
    'the board is rendering something other than its own zone again');
  assert.match(routes, /const PartnerBoard = lazy\(\(\) => import\('\.\.\/\.\.\/pages\/partner\/delivery\/BoardZone'\)\);/,
    'the board zone is not imported');
  // AND `EngagementsPage` NO LONGER CLAIMS THE ZONE. Two files building one
  // zone's action row is how a header row comes to describe a page the reader
  // is not on; `profile_zone_actions` fails on it, and this pins the reason.
  assert.ok(!engagements.includes("partnerZoneActions('delivery/board'"),
    'EngagementsPage is building the board’s action row again');
  // Flattened: the note wraps across comment lines.
  const engRaw = raw('frontend/src/pages/partner/operations/EngagementsPage.jsx').replace(/\s+/g, ' ');
  assert.ok(engRaw.includes('this page is no longer that zone'),
    'the removal is no longer recorded, so the next reader re-adds it');
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
  assert.match(BOARD, /mode: seat \? 'embedded' : 'project',/,
    'mode is no longer derived from whether a seat was granted');
  // NO COLUMN. A stored mode would be a second place to say what the seat
  // already says, and the two would part company the first time one was
  // revoked.
  assert.ok(!/ADD COLUMN mode|e\.mode/.test(BOARD), 'the board is reading a stored mode');
  assert.ok(worker.includes('MODE IS STRUCTURAL, NOT A STATUS'),
    'the route no longer records why mode is derived');
  // The seat the row is about is the most recent one, so a seat regranted after
  // a revocation is a live embedded engagement again.
  assert.match(BOARD, /const seat = \(seatByEng\.get\(id\) \|\| \[\]\)\[0\] \|\| null;/,
    'the row no longer picks the most recent seat');
  assert.match(BOARD, /ORDER BY s\.granted_at DESC/, 'the seats are no longer read newest first');
  // A revoked seat is still a seat: the row keeps its mode and stays on the
  // board, struck through.
  assert.match(zone, /rowClass: r\.seat_revoked_at \? 'opacity-60' : '',/,
    'a revoked seat’s row is no longer dimmed');
  // ASSERTED POSITIVELY. A ban shaped `filter(… seat_revoked_at …).map` cannot
  // cross the `)` of an arrow's parameter list, so `visible.filter((r) =>
  // !r.seat_revoked_at).map(` slipped through it — another escape this suite's
  // own mutation run caught. The instrument takes the narrowed list whole.
  assert.match(zone, /rows=\{visible\.map\(\(r\) => \(\{/,
    'the board is narrowing the rows again — a revoked seat must stay visible');
});

test('progress is two measures and is never averaged', () => {
  const cells = cellsOf(INST);
  assert.equal(cells.length, 5, 'the row no longer draws one cell per artboard column');
  const progress = cells[3];
  assert.match(progress, /r\.mode === 'project'/, 'the progress cell no longer branches on the mode');
  assert.match(progress, /\$\{r\.milestones_done\} of \$\{r\.milestone_count\} milestones/,
    'a project row no longer counts milestones');
  assert.match(progress, /\$\{r\.hours_this_period \?\? 0\} of \$\{r\.hours_cap\} h this period/,
    'an embedded row no longer counts hours against the retained-hours cap');
  // An embedded seat with no retainer has NO cap, and the row says so rather
  // than filling in a number nobody agreed to.
  assert.match(progress, /sub: 'no retained-hours cap agreed'/,
    'a seat with no retainer is being measured against an invented cap');
  // A project with no milestone recorded reads absent, not 0 of 0.
  assert.match(progress, /r\.milestone_count\s*\n?\s*\? \{ text:/,
    'a project with no milestones is being shown a ratio over zero');
  // Flattened: the sentence wraps, and it appears in both the docblock and the
  // stated limit — so this asserts the PAGE says it, not only the file.
  const flatBody = zoneRaw.slice(zoneRaw.indexOf('<StatedLimit')).replace(/\s+/g, ' ');
  assert.ok(flatBody.includes('a fraction of a scope and a fraction of a week are not the same number'),
    'the page no longer tells a reader why the two measures are not averaged');
});

test('health is the same computed rating, and null is drawn absent', () => {
  assert.match(BOARD, /const h = healthFor\(\{/, 'the board is no longer using the shared rating');
  assert.ok(!/health: '(on_track|at_risk|blocked)'/.test(BOARD),
    'the board is asserting a health rather than computing one');
  const cells = cellsOf(INST);
  assert.match(cells[4], /r\.health\s*\n?\s*\? \{ pill: HEALTH_LABEL\[r\.health\], pillTone: HEALTH_TONE\[r\.health\] \}/,
    'the Health column no longer draws the computed rating');
  assert.match(cells[4], /: \{ nr: true \}/, 'an unrated engagement is being drawn as something');
  assert.ok(!/health.*'on_track'.*\|\|/.test(cells[4]), 'an unrated engagement is being defaulted to on track');
  // And the strip says how much of the board could not be rated at all, so a
  // low `Need attention` cannot read as a healthy book.
  assert.match(BOARD, /unrated_count: items\.filter\(\(i: any\) => i\.health === null\)\.length,/,
    'the read no longer reports how much of the board is unrated');
  assert.ok(zone.includes('more rated on nothing at all'),
    'the strip no longer says how much of the board is unrated');
});

test('the strip is the artboard’s four tiles, counted over the whole board', () => {
  const adds = PD1.slice(PD1.indexOf('adds:['), PD1.indexOf('legend:'));
  const labels = [...adds.matchAll(/label: '([^']+)'|label:'([^']+)'/g)].map((m) => m[1] || m[2]);
  assert.deepEqual(labels, ['Project value', 'Embedded / month', 'Need attention', 'Revoked seats']);
  const strip = between(zone, '<div className="grid grid-cols-2 gap-3 md:grid-cols-4">', 'items.some((r) => r.grant)');
  assert.deepEqual([...strip.matchAll(/label="([^"]+)"/g)].map((m) => m[1]), labels,
    'the strip is no longer the artboard’s four tiles in its order');
  // COUNTED SERVER-SIDE OVER THE WHOLE BOARD, and the two money tiles exclude
  // revoked seats: a closed seat bills nothing this month.
  assert.match(BOARD, /const live = items\.filter\(\(i: any\) => !i\.seat_revoked_at\);/,
    'the value tiles are no longer counted over the live board');
  assert.match(BOARD, /project_value: money\(live\.filter\(\(i: any\) => i\.mode === 'project'\)\),/,
    'the project-value tile is no longer summed over project engagements');
  assert.match(BOARD, /embedded_monthly: money\(live\.filter\(\(i: any\) => i\.mode === 'embedded'\)\),/,
    'the embedded tile is no longer summed over embedded engagements');
  assert.match(BOARD, /revoked_seats: items\.filter\(\(i: any\) => i\.seat_revoked_at\)\.length,/,
    'the revoked tile is no longer counted over the whole board');
});

test('the instrument draws the artboard’s five columns, in its order and at its widths', () => {
  const head = JSON.parse(`[${PD1.match(/head:\[([^\]]+)\]/)[1].replace(/'/g, '"')}]`);
  assert.deepEqual(head, ['Client', 'Mode', 'Scope', 'Progress', 'Health']);
  assert.ok(INST.includes(`head={${JSON.stringify(head).replace(/"/g, "'").replace(/,/g, ', ')}}`),
    'the instrument head is no longer the artboard’s five columns in its order');
  assert.ok(INST.includes(`cols="${PD1.match(/cols:'([^']+)'/)[1]}"`),
    'the instrument no longer uses the artboard’s column widths');
  assert.ok(INST.includes(`meta="${PD1.match(/instMeta:'([^']+)'/)[1]}"`),
    'the instrument’s meta line has left the artboard');
  assert.ok(INST.includes(`title="${PD1.match(/instTitle:'([^']+)'/)[1]}"`),
    'the instrument’s title has left the artboard');
});

test('the grant is a mark on the row, and the legend explains only marks it draws', () => {
  const cells = cellsOf(INST);
  assert.match(cells[1], /\{ mode: MODE_LABEL\[r\.mode\] \}/, 'the Mode column no longer draws the mode chip');
  assert.match(cells[2], /grant: `Granted · \$\{r\.grant\}`, grantRevoked: Boolean\(r\.seat_revoked_at\)/,
    'the scope cell no longer marks what the founder granted, or whether it was revoked');
  assert.match(cells[2], /sub: r\.grant_holder \? `held by \$\{r\.grant_holder\}` : undefined/,
    'the row no longer names who holds the grant');
  // RENDERED ONLY WHERE A GRANT EXISTS. A legend explaining a violet mark
  // nobody can see is the same defect as a chip that selects everything — and
  // its revoked entry appears only once a seat actually has been revoked.
  assert.match(zone, /\{items\.some\(\(r\) => r\.grant\) && \(/,
    'the legend is drawn over a table that carries no grant');
  assert.match(zone, /\.\.\.\(revoked\.length\s*\n?\s*\? \[\{ chip: 'Granted · scope', grant: true, revoked: true/,
    'the legend claims a revoked grant before one exists');
  assert.match(CANVAS, /\{ cls:'grant rv', chip:'Granted · Repo', t:'grant revoked by the founder' \}/,
    'the canvas’s legend has moved');
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

test('the chip row exists at all now, and Needs attention is the rated-bad states', () => {
  const canvasChips = JSON.parse(`[${PD1.match(/filters: fil\(\[([^\]]+)\]/)[1].replace(/'/g, '"')}]`);
  assert.deepEqual(canvasChips, ['All', 'Project', 'Embedded', 'Needs attention']);
  const chips = entriesIn(filters, "'delivery/board': [");
  assert.deepEqual(chips.map((e) => e.match(/canvas: '([^']+)'/)[1]), canvasChips,
    'the chip row is no longer the artboard’s four labels in its order');
  for (const entry of chips) {
    assert.match(entry, /key: '[a-z]+'/, `${entry} is not a live chip`);
  }
  const fn = between(zone, 'export function matchesBoardChip(', 'function BoardTile(');
  assert.match(fn, /if \(chip === 'attention'\) return row\.health === 'at_risk' \|\| row\.health === 'blocked';/,
    'Needs attention is no longer the two rated-bad states');
  assert.ok(!/health === null|!row\.health/.test(fn),
    'an unrated engagement is being swept into Needs attention, which turns “we have not looked” into “something is wrong”');
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
  // draws the same row — disabled, and saying so itself.
  assert.match(zone, /<UnlinkedZone title="Board" actions=\{rowActions\} \/>/,
    'the gate branch no longer draws the same header row as the live one');
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
