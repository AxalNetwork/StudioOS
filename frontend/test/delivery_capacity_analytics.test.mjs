/**
 * Delivery · Capacity — the `pd3` artboard, and the two numbers a firm is now
 * allowed to state about its own week.
 *
 * THE REFUSAL THIS ZONE CARRIED WAS RIGHT, AND HALF OF IT STILL IS. The page
 * answered `cap_hours: null` with a reason, because the artboard draws its bars
 * against a hardcoded `CAP_H = 40` and adopting that number would have invented
 * the firm's cap and then presented the result as a finding. That stays true of
 * the canvas's forty. What it was never a reason for is refusing a cap the firm
 * ITSELF states — the same class of fact as the budget floor in
 * `partner_fit_rules` — so migration 230 gives them somewhere to put an answer
 * and this guard holds the line that it does not put one there: a firm that has
 * stated nothing still reads `Not recorded`, and the number 40 appears nowhere.
 *
 * THE ARTBOARD'S THIRD HOUR COLUMN NEEDED A THIRD STORE.
 * `engagement_hours.engagement_id` is NOT NULL, so the client book cannot hold
 * admin, recruiting or the proposal that lost — and `Total` assembled from it
 * alone under-reports every person by exactly the part nobody is billed for, in
 * the reassuring direction. Migration 231 holds it; a row whose internal hours
 * nobody stated is marked a FLOOR rather than quietly totalling less.
 *
 * AND SEAT HOURS ARE THE SEAT-HOLDER'S. Not everyone's on an embedded
 * engagement: two people can work one while only one of them is inside the
 * client's systems.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const read = (p) => codeOnly(raw(p));

const CANVAS = raw('design/canvases/integrated/Pages · Partner Delivery.dc.html');
const zoneRaw = raw('frontend/src/pages/partner/delivery/CapacityZone.jsx');
const zone = read('frontend/src/pages/partner/delivery/CapacityZone.jsx');
const worker = raw('cloudflare-worker/src/routes/partner_delivery.ts');
const migration = raw('cloudflare-worker/sql/migrations/231_partner_internal_hours.sql');
const filters = read('frontend/src/workspaces/partnerZoneFilters.js');
const actions = read('frontend/src/workspaces/partnerZoneActions.js');
const apiJs = read('frontend/src/lib/api.js');
const spec = raw('cloudflare-worker/src/routes/research.ts');

const PD3 = CANVAS.slice(CANVAS.indexOf("{ id:'pd3'"), CANVAS.indexOf("{ id:'pd4'"));
assert.ok(PD3.includes("route:'/delivery/capacity'"), 'the pd3 artboard could not be found in the canvas');

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

/**
 * Prose flattened out of comment markers and line wraps, for an includes().
 *
 * `\uXXXX` IS RESOLVED because the canvas writes its curly apostrophes escaped
 * (`client’s`) while the zone writes them literally — the same sentence in
 * two encodings, and a comparison that missed it would report the artboard's
 * own finding as absent from the artboard.
 */
const flat = (s) => s
  .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/^\s*(?:--|\/\/)/gm, '')
  .replace(/\s+/g, ' ');

const INST = between(zone, '<Instrument', '/>');

test('the strip is the artboard’s four tiles, in its order and over the whole roster', () => {
  const adds = PD3.slice(PD3.indexOf('adds:['), PD3.indexOf('instTitle:'));
  // The Delivery canvas writes `label:'…'` with no space; the Offers one writes
  // `label: '…'`. Both shapes, so a reader is not held to a whitespace habit.
  const labels = [...adds.matchAll(/label: ?'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['Over-committed', 'Seats held', 'Project hours', 'Seat hours']);
  // READ OFF THE TILES THEMSELVES rather than off every `label=` in the file:
  // three forms sit below the strip and each carries its own field labels.
  const tiles = [...zone.matchAll(/<CapTile\b[\s\S]{0,500}?label="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(tiles, labels, 'the strip is no longer the artboard’s four tiles in its order');

  // THE ARTBOARD'S OWN TILE NOTES, carried rather than reworded.
  const strip = between(zone, '<CapTile', '<Instrument');
  assert.ok(strip.includes('each scoped and revocable'), 'the Seats held note is gone');
  assert.ok(strip.includes('inside client systems'), 'the Seat hours note is gone');
  // THE ONE NOTE THAT MUST NOT BE CARRIED VERBATIM. The artboard's Project
  // hours tile reads "this week"; `engagement_hours.period` is a MONTH
  // (`parsePeriod(…, 'monthly')`, `YYYY-MM`), so the artboard's own wording over
  // this store would be a false claim about what was counted. The tile names
  // the period it actually read instead.
  const projectTile = between(strip, 'label="Project hours"', '<CapTile');
  assert.ok(/this period · \$\{d\?\.period/.test(projectTile),
    'the Project hours tile stopped naming the period it counted');
  assert.ok(!/this week/i.test(projectTile),
    'the Project hours tile claims a week over a store keyed by month');

  // SUMMED OVER THE WHOLE ROSTER, NEVER THE CHIP-NARROWED LIST: a firm's
  // project hours do not change because a reader narrowed to seat-holders.
  assert.ok(!/<CapTile[\s\S]*?visible[\s\S]*?<Instrument/.test(zone),
    'a strip tile is counting the chip-narrowed list');
  for (const field of ['project_hours_total', 'seat_hours_total', 'live_seats']) {
    assert.ok(strip.includes(`d?.${field}`), `the strip stopped reading ${field}`);
  }
});

test('with no cap stated, Over-committed is absent — and the canvas’s 40 is nowhere', () => {
  const strip = between(zone, '<CapTile', '<Instrument');
  const tile = between(strip, 'label="Over-committed"', '<CapTile');
  // NOT ZERO. A count of zero says nobody is over the line; absence says there
  // is no line, which is what an unconfigured firm's answer actually is.
  assert.match(tile, /nr=\{d\?\.over_committed_count == null\}/,
    'Over-committed no longer reads absent when no cap is stated');
  assert.ok(flat(tile).includes('no cap is stated, so nobody is over one'),
    'the tile stopped saying why it is absent');

  // THE FIXTURE NUMBER IS THE WHOLE POINT OF THE REFUSAL. `CAP_H = 40` is the
  // artboard's, about somebody else's firm. A bare `/40/` over the file cannot
  // say this — `text-gray-400` and `bg-red-50/40` are Tailwind shades — so the
  // ban is on the three shapes a cap could actually arrive in: a fallback
  // beside the read, a constant of its own, and a suggestion in the empty box.
  assert.ok(PD3.includes('CAP_H'), 'the artboard no longer references its hardcoded cap');
  assert.ok(!/cap_hours\s*(?:\?\?|\|\|)/.test(zone), 'the zone defaults a cap the firm has not stated');
  assert.ok(!/\bCAP_H\b|\bDEFAULT_CAP\b/.test(zone), 'the zone declares a cap constant of its own');
  for (const [, hint] of zone.matchAll(/placeholder="([^"]*)"/g)) {
    assert.ok(!/\b40\b/.test(hint), `an input suggests the canvas fixture 40: "${hint}"`);
  }

  // AND THE CAP IS THE FIRM'S, READ BACK — never defaulted in the page.
  const meta = between(zone, 'meta={d?.cap_hours == null', 'cols=');
  assert.ok(meta.includes('No cap stated'), 'the instrument meta claims a cap when none is stated');
  assert.match(meta, /Cap \$\{d\.cap_hours\} h/, 'the instrument meta stopped quoting the firm’s own number');
});

test('the instrument is the artboard’s six columns, at its own grid', () => {
  const cols = PD3.match(/cols:'([^']+)'/)[1];
  const head = [...PD3.slice(PD3.indexOf('head:['), PD3.indexOf('rows:')).matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(head, ['Person', 'Seats held', 'Project h', 'Seat h', 'Internal h', 'Total']);
  assert.ok(INST.includes(`cols="${cols}"`), `the instrument no longer uses the artboard grid ${cols}`);
  const drawn = [...between(INST, 'head={[', ']}').matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(drawn, head, 'the instrument columns drifted from the artboard');
  assert.ok(INST.includes('title="People"'), 'the instrument is no longer the artboard’s People card');
  // The artboard's own meta clause, kept verbatim on both branches.
  assert.ok(PD3.includes('seat hours counted, not estimated'));
  assert.equal((INST.match(/seat hours counted, not estimated/g) || []).length, 2,
    'one of the two meta branches dropped the artboard’s clause');

  // PARSED IN ORDER, so swapping two cells cannot pass as a tally.
  const cells = cellsOf(INST);
  assert.equal(cells.length, 6, `the row draws ${cells.length} cells, not six`);
  assert.ok(/p\.name/.test(cells[0]), 'the Person cell stopped reading the name');
  assert.ok(/seat_places|places/.test(cells[1]), 'the Seats held cell stopped reading the seats');
  assert.ok(/p\.project_hours/.test(cells[2]), 'the Project h cell stopped reading project hours');
  assert.ok(/p\.seat_hours/.test(cells[3]), 'the Seat h cell stopped reading seat hours');
  assert.ok(/p\.internal_hours/.test(cells[4]), 'the Internal h cell stopped reading internal hours');
  assert.ok(/p\.total_hours/.test(cells[5]), 'the Total cell stopped reading the total');
  // The two hour columns are DISTINCT reads, not one number drawn twice.
  assert.ok(!/p\.seat_hours/.test(cells[2]) && !/p\.project_hours/.test(cells[3]),
    'the project and seat columns read the same field');
  // AND NEITHER TURNS AN UNMEASURED PERSON INTO A ZERO. Nobody logging hours
  // for someone is not the same as their having done no work, and the two hour
  // columns must keep that apart the way the Internal one does.
  assert.match(cells[2], /p\.project_hours == null\s*\?\s*\{ nr: true \}/,
    'a person with no hours logged now reads as zero project hours');
  assert.match(cells[3], /p\.seat_hours == null\s*\?\s*\{ nr: true \}/,
    'a person with no hours logged now reads as zero seat hours');
});

test('the seat cell names where the seat is, and a revoked grant stays struck through', () => {
  const cells = cellsOf(INST);
  const seatCell = cells[1];
  // "Two seats" is a number; "Halverton · Board, KPIs" is the exposure, which
  // is what the artboard's own instNote turns on.
  assert.ok(/grant: `Granted · \$\{lead\.scope\}`/.test(seatCell),
    'the seat cell stopped drawing the artboard’s grant mark');
  assert.ok(/grantRevoked: Boolean\(lead\.revoked\)/.test(seatCell),
    'a revoked grant is no longer drawn as revoked');
  assert.ok(/s\.client/.test(seatCell), 'the seat cell stopped naming the client');
  // AN EM DASH IS A KNOWN NOTHING, not an unknown: they hold no seat, which the
  // seat register can say for certain. `Not recorded` there would be a lie in
  // the other direction.
  assert.ok(/places\.length === 0\s*\?\s*\{ text: '—' \}/.test(seatCell),
    'a person with no seat now reads as unrecorded rather than as none');
  assert.ok(/revoked, kept on the record/.test(seatCell),
    'revoked seats stopped being counted on the row');
});

test('a total with no internal hours behind it is marked a floor', () => {
  const totalCell = cellsOf(INST)[5];
  assert.ok(flat(totalCell).includes('internal hours not stated — a floor, not a measurement'),
    'the total no longer says when it is only part of a week');
  // NULL IS DRAWN ABSENT, never as zero: a week assembled from nothing is not a
  // week of no work.
  assert.match(totalCell, /p\.total_hours == null\s*\?\s*\{ nr: true \}/,
    'an unmeasured person now reads as zero hours');
  assert.ok(/p\.over_committed === true/.test(totalCell),
    'the Over pill no longer requires an explicit true — null would light it');
  // The internal column keeps the same distinction on its own.
  assert.match(cellsOf(INST)[4], /p\.internal_hours == null\s*\?\s*\{ nr: true \}/,
    'unstated internal hours now read as zero');

  // AND THE WORKER MAKES THE SAME DISTINCTION, so the page is not carrying it
  // alone. `over_committed` needs a cap AND a measurement.
  assert.ok(flat(worker).includes('if (cap === null || !measured(p)) return null;'),
    'the worker now judges over-commitment without both sides');
  assert.ok(flat(worker).includes('const totalOf = (p: any) => (p.hours_recorded ? p.hours : 0) + (p.internal_hours ?? 0);'),
    'the worker total stopped including internal hours');
});

test('seat hours belong to the seat-holder, and survive a revocation', () => {
  const split = between(worker, 'const seatOf = new Set<string>();', 'for (const row of internal.results');
  assert.ok(/seatOf\.add\(`\$\{s\.holder_user_id\}:\$\{s\.engagement_id\}`\);/.test(split),
    'the seat key is no longer holder-and-engagement');
  // A REVOCATION DOES NOT REWRITE THE PAST: the work was still done inside the
  // client's systems, so the key is added unconditionally.
  assert.ok(!/if \(!s\.revoked_at\) seatOf\.add/.test(split),
    'a revoked seat stopped claiming the hours worked under it');
  assert.ok(/if \(seatOf\.has\(`\$\{h\.person_user_id\}:\$\{h\.engagement_id\}`\)\) p\.seat_hours \+= n;/.test(split),
    'seat hours are no longer keyed on whose seat it is');
});

test('the third store exists, is stated rather than derived, and clearing removes the row', () => {
  assert.ok(/CREATE TABLE IF NOT EXISTS partner_internal_hours/.test(migration));
  assert.ok(/CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_internal_hours_period\s+ON partner_internal_hours\(partner_id, person_user_id, period\)/.test(migration),
    'two rows could answer one question and the sum would double a week');
  assert.ok(/hours REAL NOT NULL CHECK \(hours >= 0 AND hours < 744\)/.test(migration),
    'the hours column stopped being a bounded number of real hours');
  // D1 REJECTS TRANSACTION STATEMENTS (200's header).
  assert.ok(!/^\s*(BEGIN|COMMIT)\b/im.test(migration), 'the migration carries a transaction statement');

  const put = between(worker, "partnerDelivery.put('/capacity/internal-hours'", "partnerDelivery.post('/engagements/:engagementId/seats'");
  // THE FIRM'S OWN PEOPLE ONLY — the same hole `requireOwnHolder` closes on the
  // seat register, and 404 rather than 403 so an error code teaches nothing.
  assert.ok(/WHERE id = \? AND partner_id = \?/.test(put), 'the writer stopped scoping the person to this firm');
  assert.ok(/Person not found in this firm.*404/s.test(put), 'the writer stopped 404ing an outsider');
  assert.ok(/if \(b\.hours === null\) \{[\s\S]{0,200}DELETE FROM partner_internal_hours/.test(put),
    'clearing internal hours no longer removes the row');
  assert.ok(/parsePeriod\(b\.period, 'monthly'\)/.test(put), 'the period is no longer validated');
});

test('the cap writer is the firm’s own number, and it can be taken back', () => {
  const put = between(worker, "partnerDelivery.put('/capacity/cap'", "partnerDelivery.put('/capacity/internal-hours'");
  assert.ok(/hours <= 0 \|\| hours >= 168/.test(put), 'a cap outside a week that exists is now accepted');
  assert.ok(/if \(b\.weekly_hours === null\) \{/.test(put), 'a cap can be set and not unset');
  assert.equal((put.match(/DELETE FROM partner_capacity/g) || []).length, 2,
    'one of the two clear paths — the firm’s default and one person’s — is gone');
  // TWO LITERAL STATEMENTS, because `check-sql-prepare` refuses a `${}` inside
  // `DB.prepare` and the partial unique indexes need the NULL case spelled out.
  assert.ok(/ON CONFLICT \(partner_id\) WHERE person_user_id IS NULL/.test(put));
  assert.ok(/ON CONFLICT \(partner_id, person_user_id\) WHERE person_user_id IS NOT NULL/.test(put));

  // THE PAGE OFFERS BOTH SCOPES, and an empty box clears rather than saving a
  // zero: zero hours would claim this person works none.
  const form = between(zone, 'The week this firm says it has', 'Internal hours ·');
  assert.ok(form.includes('The firm’s default'), 'the cap form stopped offering the firm-wide scope');
  assert.ok(/weekly_hours: raw === '' \? null : Number\(raw\)/.test(form),
    'an empty cap box now saves a zero instead of clearing');
  assert.ok(/api\.setPartnerCapacityCap/.test(form), 'the cap form stopped calling the writer');
});

test('the chips, ops and AI band are the artboard’s, and the draft surface is allow-listed', () => {
  const chips = [...PD3.slice(PD3.indexOf('filters: fil(['), PD3.indexOf('ops:')).matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(chips, ['This week', 'Next week', 'Seats only', 'All']);
  const row = between(filters, "'delivery/capacity': [", '],');
  assert.deepEqual([...row.matchAll(/canvas: '([^']+)'/g)].map((m) => m[1]), chips);
  // NONE OF THE FOUR IS PROSE. A chip nobody can select is a control that lies.
  assert.ok(!/unbuilt/.test(row), 'a capacity chip went back to being prose');

  const ops = [...PD3.slice(PD3.indexOf('ops:['), PD3.indexOf('adds:[')).matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(ops, ['Reallocate', 'Seat register', 'Export']);
  const opRow = between(actions, "'delivery/capacity': [", '],');
  assert.deepEqual([...opRow.matchAll(/label: '([^']+)'/g)].map((m) => m[1]), ops,
    'the ops row drifted from the artboard');

  // THE AI BAND, label for label.
  assert.ok(PD3.includes("aiLabel:'Draft · capacity findings'"));
  assert.ok(PD3.includes("aiAccept:'Accept findings'"));
  assert.ok(PD3.includes("aiFoot:'Hours read from engagement rows.'"));
  const band = between(zone, '<ZoneDraft', '/>');
  assert.ok(band.includes('surface="delivery/capacity"'));
  assert.ok(band.includes('label="Draft · capacity findings"'));
  assert.ok(band.includes('accept="Accept findings"'));
  assert.ok(band.includes('foot="Hours read from engagement rows."'));
  // CONFIG FOLLOWS A MOUNT, never the reverse: the band is refused by the
  // worker unless the surface is on its allow-list.
  assert.ok(spec.includes("'delivery/capacity': {"), 'the draft surface is not allow-listed');
  // AND THE INSTRUCTION KEEPS THE ZONE'S TWO REFUSALS.
  const surface = between(spec, "'delivery/capacity': {", "'offers/audience-fit': {");
  assert.ok(flat(surface).includes('unmeasured rather than idle or free'),
    'the draft may now report a sparse book as spare capacity');
  assert.ok(flat(surface).includes('never solved by reallocating project work'),
    'the draft may now answer a seat exposure with a scheduling fix');
});

test('the instNote carries the artboard’s finding, and the page’s limits are current', () => {
  // The artboard's own argument, which is the reason this zone exists.
  assert.ok(flat(PD3).includes('a stretched operator inside a client’s own systems is a trust exposure'));
  assert.ok(flat(PD3).includes('Reallocating project work does not fix it; renegotiating the seat does'));
  const note = between(INST, 'note={', '}\n');
  assert.ok(flat(note).includes('a stretched operator inside a client’s own systems is a trust exposure'),
    'the instNote dropped the artboard’s finding');
  assert.ok(flat(note).includes('Reallocating project work does not fix it; renegotiating the seat does'));

  // THE STALE GAP CLAIM IS GONE. The page used to state, flatly, that no cap is
  // recorded ANYWHERE IN THIS PRODUCT — true when it was written and false the
  // moment migration 230 landed. A stale gap claim is worse than never having
  // written one.
  const limits = zone.slice(zone.indexOf('<StatedLimit'));
  assert.ok(!/no capacity cap is recorded anywhere in this product/i.test(limits),
    'the page still claims the product records no cap at all');
  assert.ok(flat(limits).includes('The cap is yours, never ours'),
    'the limits stopped saying whose the cap is');
  assert.ok(flat(limits).includes('A total with no internal hours is a floor'),
    'the limits stopped naming the floor');
  // The WORKER still says it, and must: that sentence is what an unconfigured
  // firm is told, and the page prints it back.
  assert.ok(worker.includes('No capacity cap is recorded anywhere in this product.'),
    'the worker’s refusal text for an unconfigured firm is gone');
  assert.ok(zoneRaw.includes('d?.cap_note'), 'the page stopped printing the worker’s reason');
});

test('the two writers are reachable, and the period chips actually re-read', () => {
  // A METHOD WITH NO ROUTE IS THE DRIFT GUARD'S SUBJECT; this is the other
  // half — a route with no method is a store nobody can write.
  assert.ok(/setPartnerCapacityCap: \(data\) =>\s*request\('\/partner\/delivery\/capacity\/cap'/.test(apiJs));
  assert.ok(/setPartnerInternalHours: \(data\) =>\s*request\('\/partner\/delivery\/capacity\/internal-hours'/.test(apiJs));
  assert.ok(worker.includes("partnerDelivery.put('/capacity/cap'"));
  assert.ok(worker.includes("partnerDelivery.put('/capacity/internal-hours'"));

  // `This week` and `Next week` CHOOSE THE PERIOD, so they change the read
  // rather than filtering what came back — and the loader has to depend on it
  // or the chip moves nothing at all.
  assert.match(zone, /const period = view === 'next_week' \? nextPeriod\(\) : undefined;/);
  const loader = between(zone, 'const load = useCallback(', 'useEffect(');
  assert.ok(/\}, \[period\]\);/.test(loader),
    'the loader no longer re-reads when the period chip changes');
  assert.ok(/api\.getPartnerCapacity\(period\)/.test(loader), 'the load stopped passing the period');
});
