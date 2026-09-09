/**
 * Delivery · Health — the `pd5` artboard, and three facts about an engagement
 * that are not facts about the work.
 *
 * THE ZONE'S ONE RULE SURVIVES EVERYTHING BELOW: nothing recorded means NOT
 * RATED, never "on track". An engagement with no milestone, blocker,
 * deliverable or retainer gets `health: null` and reads absent. Silence is not
 * good news, and a green strip over an empty book is the most confident wrong
 * answer this product could give.
 *
 * WHAT WAS MISSING WAS NOT DERIVABLE. Health reads five stores; the artboard
 * asks for three things none of them holds — an OWNER (who at the firm runs
 * it), a SCOPE ASSESSMENT (a blocker is something stopping the work; drift is
 * the work quietly becoming a different job) and a SATISFACTION score. Each is
 * a sentence somebody states, migration 232 holds all three, and until somebody
 * states one it is absent. `scope_state` is never defaulted to "within": an
 * engagement nobody has assessed has not been cleared of drift.
 *
 * A SCORE NEVER APPEARS WITHOUT ITS SOURCE. 208:160 made `opened_at` the
 * client's to set because a partner-side write would be the firm reporting a
 * metric about itself; satisfaction is nearly that, and provenance is the
 * difference. A number typed by the person who wants the renewal, shown on the
 * page that decides one, is exactly that failure.
 *
 * AND `By owner` WAS THE LAST PROSE CHIP IN THE BUCKET. Its reason was exactly
 * right — the owner migration 224 added belongs to a book CONTACT, a person the
 * firm knows, not to work it is running — and 232 records the second thing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const read = (p) => codeOnly(raw(p));

const CANVAS = raw('design/canvases/integrated/Pages · Partner Delivery.dc.html');
const zone = read('frontend/src/pages/partner/delivery/HealthZone.jsx');
const worker = raw('cloudflare-worker/src/routes/partner_delivery.ts');
const migration = raw('cloudflare-worker/sql/migrations/232_partner_engagement_health.sql');
const filters = read('frontend/src/workspaces/partnerZoneFilters.js');
const actions = read('frontend/src/workspaces/partnerZoneActions.js');
const apiJs = read('frontend/src/lib/api.js');
const spec = raw('cloudflare-worker/src/routes/research.ts');

const PD5 = CANVAS.slice(CANVAS.indexOf("{ id:'pd5'"));
assert.ok(PD5.includes("route:'/delivery/health'"), 'the pd5 artboard could not be found in the canvas');

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

test('the strip is the artboard’s four tiles, over the whole book', () => {
  const adds = PD5.slice(PD5.indexOf('adds:['), PD5.indexOf('legend:['));
  const labels = [...adds.matchAll(/label: ?'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['At risk', 'Scope drift', 'Lowest utilization', 'Firm satisfaction avg']);
  const tiles = [...zone.matchAll(/<HealthTile\b[\s\S]{0,600}?label="([^"]+)"/g)].map((m) => m[1]);
  // The one spelling that differs: this product writes "utilisation" throughout
  // (`utilisation_pct`, `utilisationFor`), and one tile in one licence's
  // vocabulary is not worth a second spelling of a column name.
  assert.deepEqual(tiles, ['At risk', 'Scope drift', 'Lowest utilisation', 'Firm satisfaction avg'],
    'the strip is no longer the artboard’s four tiles in its order');

  const strip = between(zone, '<HealthTile', '<Instrument');
  assert.ok(!/\bvisible\b/.test(strip), 'a strip tile is counting the chip-narrowed list');
  for (const field of ['at_risk_count', 'drift_count', 'lowest_utilisation_pct', 'satisfaction_avg']) {
    assert.ok(strip.includes(`d?.${field}`), `the strip stopped reading ${field}`);
  }
  // NAMED, NOT ONLY COUNTED. "Verwood, Thornfield" is a page a reader can act
  // on; "2" is not, and the artboard's own note names them.
  assert.ok(strip.includes('atRiskNames'), 'the At risk tile stopped naming who is at risk');
  assert.ok(/const atRiskNames = items\s*\n?\s*\.filter\(\(r\) => r\.health === 'at_risk' \|\| r\.health === 'blocked'\)/.test(zone),
    'the At risk names are no longer the two rated-bad states');
});

test('lowest utilisation is the lowest, and the firm average waits for the firm', () => {
  // LOWEST, NOT AVERAGE: the renewal risk is the one client not using what they
  // pay for, and an average hides them behind four who are.
  assert.ok(PD5.includes("label:'Lowest utilization'"), 'the artboard stopped asking for the lowest');
  const pick = between(worker, 'const lowest = withUtil.length', 'return c.json({');
  assert.ok(/b\.utilisation_pct < a\.utilisation_pct \? b : a/.test(pick),
    'the strip figure is no longer the lowest utilisation');

  // REFUSED WHILE ANY LIVE ENGAGEMENT IS UNSCORED — the artboard's own rule
  // and its own reason.
  assert.ok(flat(PD5).includes('averaging the rest would present'),
    'the artboard stopped refusing the firm-wide average');
  const avg = between(worker, 'satisfaction_avg: live.length && scored.length === live.length', 'satisfaction_scored_count');
  assert.ok(/scored\.reduce/.test(avg), 'the average is no longer a mean of the scores');
  assert.ok(flat(worker).includes('averaging the rest would present ${scored.length} opinion'),
    'the worker stopped saying why the average is refused');
  const strip = between(zone, '<HealthTile', '<Instrument');
  const tile = strip.slice(strip.indexOf('label="Firm satisfaction avg"'));
  assert.match(tile, /nr=\{d\?\.satisfaction_avg == null\}/,
    'the firm satisfaction tile now shows a number where the average is refused');
});

test('the instrument is the artboard’s six columns, at its own grid', () => {
  const cols = PD5.match(/cols:'([^']+)'/)[1];
  const head = [...PD5.slice(PD5.indexOf('head:['), PD5.indexOf('rows:')).matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(head, ['Client', 'Mode', 'Scope state', 'Utilization', 'Satisfaction', 'Health']);
  assert.ok(INST.includes(`cols="${cols}"`), `the instrument no longer uses the artboard grid ${cols}`);
  assert.deepEqual(
    [...between(INST, 'head={[', ']}').matchAll(/'([^']+)'/g)].map((m) => m[1]),
    ['Client', 'Mode', 'Scope state', 'Utilisation', 'Satisfaction', 'Health'],
    'the instrument columns drifted from the artboard',
  );
  assert.ok(PD5.includes("instTitle:'Renewal watch'") && INST.includes('title="Renewal watch"'));
  assert.ok(PD5.includes("instMeta:'Utilization is a read, not a second record'"));
  assert.ok(INST.includes('meta="Utilisation is a read, not a second record"'),
    'the instrument dropped the artboard’s meta');

  const cells = cellsOf(INST);
  assert.equal(cells.length, 6, `the row draws ${cells.length} cells, not six`);
  assert.ok(/r\.founder_name/.test(cells[0]), 'the Client cell stopped naming the client');
  assert.ok(/r\.seat_scope/.test(cells[1]), 'the Mode cell stopped deriving mode from the seat');
  assert.ok(/r\.scope_state/.test(cells[2]), 'the Scope state cell stopped reading the assessment');
  assert.ok(/r\.utilisation_pct/.test(cells[3]), 'the Utilisation cell stopped reading the figure');
  assert.ok(/r\.satisfaction/.test(cells[4]), 'the Satisfaction cell stopped reading the score');
  assert.ok(/r\.health/.test(cells[5]), 'the Health cell stopped reading the rating');
  // MODE IS DERIVED FROM THE SEAT, never stored — the same rule `/board`
  // follows, and a `mode` column would be a second place to say it.
  assert.ok(!/\bmode\b\s*:/.test(worker.slice(worker.indexOf('seat_scope: seat?.scope'), worker.indexOf('utilisation_source'))),
    'the health read now stores a mode beside the seat it is derived from');
});

test('an unassessed scope is absent, never “within scope”', () => {
  const cell = cellsOf(INST)[2];
  assert.ok(/r\.scope_state === 'drift'/.test(cell), 'the drift branch is gone');
  assert.ok(/r\.scope_state === 'within' \? \{ text: 'Within scope' \} : \{ nr: true \}/.test(cell),
    'an engagement nobody assessed now reads as in scope');
  // AND THE SCHEMA REFUSES A DEFAULT. `scope_state` has no DEFAULT clause, so
  // an absent row cannot arrive pre-cleared.
  assert.ok(/scope_state TEXT CHECK \(scope_state IN \('within', 'drift'\)\)/.test(migration),
    'scope_state gained a default, or stopped being one of two');
  // The strip counts the unassessed rather than folding them into the clean
  // side, which is what makes the drift count readable.
  assert.ok(/scope_unassessed_count: live\.filter\(\(r: any\) => r\.scope_state == null\)\.length,/.test(worker),
    'the unassessed engagements stopped being counted');
  assert.ok(/drift_count: items\.filter\(\(r: any\) => r\.scope_state === 'drift'\)\.length,/.test(worker),
    'the drift count no longer counts only what somebody assessed as drift');
});

test('a satisfaction score always carries its source, in the schema and on the row', () => {
  // THE SCHEMA MAKES IT IMPOSSIBLE, not merely discouraged.
  assert.ok(/CHECK \(satisfaction IS NULL OR satisfaction_source IS NOT NULL\)/.test(migration),
    'a score can now be stored with no source');
  assert.ok(/satisfaction REAL CHECK \(satisfaction IS NULL OR \(satisfaction >= 1 AND satisfaction <= 5\)\)/.test(migration),
    'the score stopped being a bounded 1–5');
  assert.ok(!/^\s*(BEGIN|COMMIT)\b/im.test(migration), 'the migration carries a transaction statement');

  // AND THE ROUTE REFUSES IT WITH THE REASON, so the failure is legible rather
  // than a constraint error.
  const put = between(worker, "partnerDelivery.put('/engagements/:engagementId/health'", 'partnerDelivery.get(');
  assert.ok(flat(put).includes('A number with none is the firm scoring itself'),
    'the route stopped saying why a score needs a source');
  assert.ok(/satisfaction !== null && !source/.test(put), 'the source is no longer required beside a score');
  // AN OMITTED KEY IS UNTOUCHED; an explicit null clears. Saving the owner must
  // not wipe a score the page never loaded.
  assert.ok(/const has = \(k: string\) => Object\.prototype\.hasOwnProperty\.call\(b, k\);/.test(put),
    'the writer stopped telling "not sent" from "sent as null"');
  assert.ok(/requireOwnHolder\(c\.env, partnerId, Number\(b\.owner_user_id\)\)/.test(put),
    'an owner can now be somebody outside this firm');

  // THE ROW PRINTS THE SOURCE EVERY TIME IT PRINTS A SCORE.
  const cell = cellsOf(INST)[4];
  assert.ok(/r\.satisfaction == null\s*\n?\s*\?\s*\{ nr: true \}/.test(cell),
    'an unscored engagement now reads as a number');
  assert.ok(/sub: r\.satisfaction_source/.test(cell),
    'the score is drawn without saying where it was said');
});

test('utilisation is seam-marked as a read, and the legend explains the marks it draws', () => {
  const cell = cellsOf(INST)[3];
  assert.ok(/seam: 'Read · Pipeline · Retainers'/.test(cell),
    'the utilisation figure stopped being marked as a read');
  assert.ok(/r\.utilisation_pct == null\s*\n?\s*\?\s*\{ nr: true \}/.test(cell),
    'an engagement with no retainer now reads as zero utilisation');
  assert.ok(worker.includes("utilisation_source: 'pipeline_retainers',"),
    'the read stopped declaring where utilisation comes from');

  // THE ARTBOARD'S TWO-ENTRY LEGEND, drawn only where the table carries the
  // marks it explains.
  const legendSpec = between(PD5, 'legend:[', 'instTitle:');
  assert.deepEqual([...legendSpec.matchAll(/chip:'([^']+)'/g)].map((m) => m[1]),
    ['Read · Pipeline', 'Granted · KPIs']);
  const legend = between(zone, '<Legend', '/>');
  assert.ok(legend.includes("chip: 'Read · Pipeline'"), 'the seam legend entry is gone');
  assert.ok(legend.includes('grant: true'), 'the grant legend entry is gone');
  assert.ok(/items\.some\(\(r\) => r\.utilisation_pct != null\)/.test(zone)
    && /items\.some\(\(r\) => r\.seat_scope\)/.test(zone),
    'the legend is drawn over marks the table may not carry');
});

test('every chip selects something — By owner was the bucket’s last prose one', () => {
  const chips = [...PD5.slice(PD5.indexOf('filters: fil(['), PD5.indexOf('ops:')).matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(chips, ['At risk', 'All', 'Renewing soon', 'By owner']);
  const row = between(filters, "'delivery/health': [", '],');
  assert.deepEqual([...row.matchAll(/canvas: '([^']+)'/g)].map((m) => m[1]), chips);
  assert.ok(!/unbuilt/.test(row), 'a health chip went back to being prose');
  assert.ok(/\{ canvas: 'By owner', key: 'owner' \}/.test(row), 'By owner is no longer a live key');

  const narrowing = between(zone, 'const visible = (() => {', '})();');
  // UNASSIGNED FIRST. An engagement nobody owns is what this ordering exists to
  // surface; sorting it to the bottom under a "no owner" heading defeats it.
  assert.ok(/if \(!an !== !bn\) return an \? 1 : -1;/.test(narrowing),
    'unassigned engagements no longer sort first under By owner');
  assert.ok(/view === 'owner'/.test(narrowing), 'By owner selects nothing');
  // AND THE OWNER IS ON EVERY ROW, so the chip has something to order by.
  assert.ok(/owner_user_id: st\?\.owner_user_id \? Number\(st\.owner_user_id\) : null,/.test(worker),
    'the health read stopped returning the owner');
});

test('the ops row and the AI band are the artboard’s, and the surface is allow-listed', () => {
  const ops = [...PD5.slice(PD5.indexOf('ops:['), PD5.indexOf('adds:[')).matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(ops, ['Change order', 'Renewal watch', 'Export']);
  const opRow = between(actions, "'delivery/health': [", '],');
  assert.deepEqual([...opRow.matchAll(/label: '([^']+)'/g)].map((m) => m[1]), ops,
    'the ops row drifted from the artboard');

  assert.ok(PD5.includes("aiLabel:'Draft · renewal risk read'"));
  assert.ok(PD5.includes("aiAccept:'Accept read'"));
  const band = between(zone, '<ZoneDraft', '/>');
  assert.ok(band.includes('surface="delivery/health"'));
  assert.ok(band.includes('label="Draft · renewal risk read"'));
  assert.ok(band.includes('accept="Accept read"'));
  assert.ok(band.includes('foot="Utilisation traced to Pipeline · Retainers."'));

  assert.ok(spec.includes("'delivery/health': {"), 'the draft surface is not allow-listed');
  const surface = between(spec, "'delivery/health': {", "'delivery/status-reports': {");
  // "ABSENT RATHER THAN LOW" is the artboard's own phrase and the instruction a
  // model gets wrong by default: a missing score reads as a bad one, an
  // unassessed scope as a clean one, an empty engagement as a healthy one.
  assert.ok(flat(PD5).includes('where satisfaction is absent rather than low'));
  assert.ok(flat(surface).includes('Absent is not low and absent is not fine'),
    'the draft may now read silence as a finding');
  assert.ok(flat(surface).includes('never recompute it'),
    'the draft may now compute a second utilisation');
});

test('the instNote carries the artboard’s finding, and the limits are current', () => {
  assert.ok(flat(PD5).includes('two pages disagreeing about the same client’s utilization is worse than either number'));
  const note = between(INST, 'note={', '}\n');
  assert.ok(flat(note).includes('two pages disagreeing about the same client’s utilisation is worse than either number'),
    'the instNote dropped the artboard’s finding');
  assert.ok(flat(note).includes('has not been cleared of drift'),
    'the instNote stopped saying why an unassessed scope is absent');

  const limits = zone.slice(zone.indexOf('<StatedLimit'));
  assert.ok(flat(limits).includes('Nothing recorded is never “on track”'),
    'the zone’s one rule left the limits');
  assert.ok(flat(limits).includes('A satisfaction score is a remark, not a measurement'),
    'the limits stopped saying what a score is');
  assert.ok(flat(limits).includes('never “within” by default'),
    'the limits stopped saying what an unassessed scope means');
  // AND THE WRITER IS REACHABLE. A route with no method is a store nobody can
  // write, which is the other half of what the drift guard checks.
  assert.ok(/savePartnerEngagementHealth: \(engagementId, data\) =>/.test(apiJs));
  assert.ok(apiJs.includes('/partner/delivery/engagements/${engagementId}/health'));
});
