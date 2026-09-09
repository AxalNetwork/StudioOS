/**
 * Pipeline · Proposals — the `p2` artboard, two stores it needed, and one it
 * cannot have.
 *
 * THE ROUTE RENDERED THE OTHER HALF OF `EngagementsPage`. The same
 * proposals-and-invoices page `/delivery/board` rendered until that zone got its
 * own: a list of quotes and their status, with no version history, no loss
 * reason and no lifecycle at all.
 *
 * THE ARTBOARD'S SUBJECT IS THE LIFECYCLE, in one sentence: "a proposal opened
 * four times and not answered is a different object from one never opened, and
 * only the detail page can tell you which you have."
 *
 * THIS BUILD CANNOT TELL THEM APART AND SAYS SO. `quotes` has no open, no read
 * receipt and no view count, and no founder-side surface records one — the same
 * absence `engagement_deliverables.opened_at` has, for the same reason: an open
 * is the client's act. So two tiles read absent, two chips are prose, and the
 * `Signal` column reports what this side knows. A "never opened" count computed
 * from silence would be a number about our own send.
 *
 * WHAT THE FIRM DOES OWN IS BUILT. Migration 234 adds a VERSION TRAIL —
 * append-only, self-numbering, because a history that can be rewritten is not
 * one — and a LOSS REASON from a closed taxonomy. The artboard's own reason for
 * the second: "free text would make this chart unreadable within a quarter."
 * And a loss with NO reason is counted on its own rather than folded into
 * `Other`, because "we did not ask" is not a taxonomy entry.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const read = (p) => codeOnly(raw(p));

const CANVAS = raw('design/canvases/integrated/Pages · Partner Pipeline.dc.html');
const zone = read('frontend/src/pages/partner/pipeline/ProposalsZone.jsx');
const worker = raw('cloudflare-worker/src/routes/partner_pipeline.ts');
const migration = raw('cloudflare-worker/sql/migrations/234_quote_versions_and_loss.sql');
const filters = read('frontend/src/workspaces/partnerZoneFilters.js');
const actions = read('frontend/src/workspaces/partnerZoneActions.js');
const routes = read('frontend/src/workspaces/partner/PartnerBucketRoutes.jsx');
const apiJs = read('frontend/src/lib/api.js');
const spec = raw('cloudflare-worker/src/routes/research.ts');

const P2 = CANVAS.slice(
  CANVAS.indexOf('<section class="ab" id="p2">'),
  CANVAS.indexOf('<section class="ab" id="p3">'),
);
assert.ok(P2.includes('/pipeline/proposals'), 'the p2 artboard could not be found in the canvas');

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

test('the route stopped rendering the shared engagements page', () => {
  assert.ok(/proposals: \(\) => <PartnerProposals \/>,/.test(routes),
    'the proposals zone is not mounted');
  assert.ok(routes.includes('pipeline/ProposalsZone'), 'the proposals zone is not imported');
  // AND `EngagementsPage` NO LONGER CLAIMS THE ZONE. Two files building one
  // zone's action row is how a header row comes to describe a page the reader
  // is not on.
  const engagements = read('frontend/src/pages/partner/operations/EngagementsPage.jsx');
  assert.ok(!engagements.includes("partnerZoneActions('pipeline/proposals'"),
    'EngagementsPage is building the proposals action row again');
  const engRaw = flat(raw('frontend/src/pages/partner/operations/EngagementsPage.jsx'));
  assert.ok(engRaw.includes('pipeline/ProposalsZone` took that one'),
    'the removal is no longer recorded, so the next reader re-adds it');
});

test('the two tiles that need a read receipt are absent, with the reason', () => {
  const stats = between(CANVAS, 'pr_stats: [', 'pr_rows:');
  const labels = [...stats.matchAll(/label: ?'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['Live proposals', 'Opened, unanswered', 'Never opened', 'Won this quarter']);
  const tiles = [...zone.matchAll(/<ProposalTile\b[\s\S]{0,500}?label="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(tiles, ['Live proposals', 'Opened, unanswered', 'Never opened', 'Won'],
    'the strip is no longer the artboard’s four tiles in its order');

  const strip = between(zone, '<ProposalTile', '{d?.read_receipts_note');
  // BOTH ABSENT, UNCONDITIONALLY. Not `nr={x == null}` — there is no `x`.
  assert.match(strip, /label="Opened, unanswered"\s*\n\s*nr\b/,
    'Opened, unanswered shows a number where nothing records an open');
  assert.match(strip, /label="Never opened"\s*\n\s*nr\b/,
    'Never opened shows a number where nothing records an open');
  assert.ok(flat(strip).includes('nothing records that a client opened one'));
  assert.ok(flat(strip).includes('a claim about our silence, not theirs'));

  // AND THE WORKER REFUSES AT SOURCE rather than the page hiding a figure it
  // was handed.
  assert.ok(worker.includes("read_receipts: 'none',"), 'the read stopped declaring the absence');
  assert.ok(flat(worker).includes('There is no client-side surface to record it on'),
    'the worker stopped saying why');
  assert.ok(!/opened_at|opens_count|view_count/.test(between(worker, "partnerPipeline.get('/proposals'", 'Append a version')),
    'the proposals read is inventing an open');
});

test('the win rate is null with nothing decided, and Analytics reads the same one', () => {
  const strip = between(zone, '<ProposalTile', '{d?.read_receipts_note');
  assert.match(strip, /nr=\{d\?\.win_rate_pct == null\}/,
    'a win rate is drawn over an empty denominator');
  assert.ok(flat(strip).includes('nothing decided yet, so there is no rate'));
  const read = between(worker, "partnerPipeline.get('/proposals'", 'Append a version');
  assert.ok(/win_rate_pct: decidedItems\.length\s*\n?\s*\? Math\.round\(\(won\.length \/ decidedItems\.length\) \* 100\) : null,/.test(read),
    'the win rate is no longer won-over-decided, or no longer null when nothing is decided');
  // DECIDED IS ACCEPTED PLUS REJECTED — a proposal still waiting is not a loss,
  // and a withdrawn one was never lost to anyone.
  assert.ok(/const decidedItems = items\.filter\(\(x: any\) => x\.decided\);/.test(read));
  assert.ok(/const decided = Boolean\(q\.decided_at\) \|\| q\.status === 'accepted' \|\| q\.status === 'rejected';/.test(read),
    'the decided test changed shape');
});

test('the instrument is the artboard’s five columns, at its own grid', () => {
  const grids = [...P2.matchAll(/grid-template-columns:([^;"]+)/g)].map((m) => m[1].trim());
  const cols = grids.find((g) => g.includes('.55fr'));
  assert.ok(cols, 'the artboard’s proposal-table grid is gone');
  const head = [...P2.matchAll(/class="th"[^>]*>([^<]*)</g)].map((m) => m[1].trim());
  assert.deepEqual(head, ['Client', 'Shape · value', 'Ver', 'State', 'Signal']);

  const inst = between(zone, 'testid="all-proposals"', '/>');
  assert.ok(inst.includes(`cols="${cols}"`), `the instrument no longer uses the artboard grid ${cols}`);
  assert.deepEqual(
    [...between(inst, 'head={[', ']}').matchAll(/'([^']+)'/g)].map((m) => m[1]), head,
    'the instrument columns drifted from the artboard',
  );
  assert.ok(inst.includes('title="All proposals"'));
  // A LOST PROPOSAL WITH NO REASON IS THE ROW THAT STILL NEEDS A PERSON.
  assert.ok(/rowClass: r\.state === 'Lost' && !r\.loss_reason \?/.test(inst),
    'a lost proposal with no reason is no longer marked');
  assert.ok(/pill: 'No reason recorded'/.test(inst),
    'the missing-reason marker is gone');
  assert.ok(flat(inst).includes('It is deliberately not a read receipt'),
    'the instNote stopped saying what the Signal column is not');
});

test('a version trail is append-only and self-numbering', () => {
  assert.ok(/CREATE TABLE IF NOT EXISTS quote_versions/.test(migration));
  assert.ok(/version INTEGER NOT NULL CHECK \(version >= 1\)/.test(migration));
  assert.ok(/CREATE UNIQUE INDEX IF NOT EXISTS idx_quote_versions_number\s+ON quote_versions\(quote_id, version\)/.test(migration),
    'one quote can hold two v2s');
  assert.ok(/price_cents INTEGER/.test(migration), 'the version price stopped being integer cents');
  assert.ok(!/^\s*(BEGIN|COMMIT)\b/im.test(migration), 'the migration carries a transaction statement');

  const post = between(worker, "partnerPipeline.post('/proposals/:quoteId/versions'", 'Record why a proposal was lost');
  // THE CALLER DOES NOT CHOOSE THE NUMBER, so two edits cannot both be v3.
  assert.ok(/SELECT MAX\(version\) AS top FROM quote_versions WHERE quote_id = \?/.test(post),
    'the version number is no longer derived from the trail');
  assert.ok(/const version = Number\(top\?\.top \|\| 0\) \+ 1;/.test(post));
  assert.ok(!/b\.version/.test(post), 'the caller can choose the version number again');
  // NO EDIT AND NO DELETE. A history that can be rewritten is not one.
  assert.ok(!/UPDATE quote_versions|DELETE FROM quote_versions/.test(worker),
    'a version can now be edited or deleted');
  assert.ok(/requireOwnQuote\(c\.env, partnerId, quoteId\)/.test(post),
    'a version can be appended to another firm’s quote');

  const inst = between(zone, 'testid="version-history"', '/>');
  assert.ok(inst.includes('meta="What changed, and what it cost"'),
    'the artboard’s version-panel subtitle is gone');
  assert.ok(flat(inst).includes('appended, never edited'),
    'the panel stopped saying why the trail is append-only');
});

test('a loss reason is from the taxonomy, and an unstated one is its own row', () => {
  // THE VOCABULARY IS THE PASS SET MINUS TWO. You do not lose a deal for being
  // under your own floor, or for a capability you just quoted on.
  //
  // IT MOVED, AND THIS FOLLOWED IT RATHER THAN LOOSENING. The list used to sit
  // in this route beside the validator; Pipeline · Analytics now groups by it,
  // so it lives in `services/bdAnalytics.ts` — the reader — and the writer
  // imports it. Two literals is how a chart ends up with three bars over a
  // four-value column, so this checks BOTH that the set is unchanged and that
  // the writer no longer keeps a copy.
  const engine = raw('cloudflare-worker/src/services/bdAnalytics.ts');
  const set = between(engine, 'export const LOSS_REASONS: readonly string[] = [', '];');
  assert.deepEqual([...set.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]),
    ['price', 'scope_mismatch', 'timing', 'other']);
  assert.ok(/import \{ LOSS_REASONS \} from '\.\.\/services\/bdAnalytics';/.test(worker),
    'the writer stopped importing the taxonomy it validates against');
  assert.ok(!/const LOSS_REASONS = \[/.test(worker),
    'a second taxonomy literal is back in the route that writes it');
  const passSet = between(worker, 'const PASS_REASONS = [', '];');
  for (const r of ['price', 'scope_mismatch', 'timing', 'other']) {
    assert.ok(passSet.includes(`'${r}'`), `the two taxonomies have drifted apart on ${r}`);
  }

  const put = between(worker, "partnerPipeline.put('/proposals/:quoteId/outcome'", '// ------');
  assert.ok(/!LOSS_REASONS\.includes\(reason\)/.test(put), 'any word can be a loss reason again');
  // A WON DEAL WITH A LOSS REASON IS A ROW NOTHING CAN READ.
  assert.ok(/status !== 'rejected'/.test(put), 'a loss reason can be set on a proposal that was not lost');
  assert.ok(/, 409\)/.test(put), 'that case no longer refuses');
  assert.ok(/if \(b\.loss_reason === null\)/.test(put), 'a loss reason cannot be cleared');

  // THE SCHEMA CANNOT HOLD THE SET AND THE MIGRATION SAYS SO. `ALTER TABLE …
  // ADD COLUMN` takes no CHECK, so the route is the only writer and the header
  // warns the next one.
  assert.ok(/ALTER TABLE quotes ADD COLUMN loss_reason TEXT;/.test(migration));
  assert.ok(flat(migration).includes('ENFORCED IN THE ROUTE, NOT HERE'),
    'the migration stopped saying where the taxonomy is enforced');
  // AND THE INDEX NAMES ONLY UNIVERSAL COLUMNS — the shape guard's own finding.
  assert.ok(/ON quotes\(loss_reason\);/.test(migration),
    'the loss-reason index names a column some definitions of `quotes` lack');

  // COUNTED SEPARATELY, NEVER FOLDED INTO `Other`.
  const read = between(worker, "partnerPipeline.get('/proposals'", 'Append a version');
  assert.ok(/losses_unstated: unstatedLosses,/.test(read), 'unstated losses stopped being counted');
  assert.ok(/else unstatedLosses \+= 1;/.test(read),
    'a loss with no reason is being counted into a taxonomy bucket');
  const chart = between(zone, 'testid="loss-reasons"', '/>');
  assert.ok(flat(chart).includes('not a taxonomy entry — nobody entered one'),
    'the unstated row stopped saying what it is');
  assert.ok(flat(chart).includes('would look complete while the firm learned nothing'),
    'the chart note stopped saying why they are not folded in');
  // READ OFF THE CANVAS, NOT THE SECTION. `pr_lossNote` lives in the data
  // block above the artboards, so the `p2` slice cannot see its own note — the
  // same reason the Delivery guard reads `repRows` off the whole file.
  assert.ok(flat(CANVAS).includes('Reasons are picked from a fixed taxonomy, not typed'),
    'the artboard stopped asking for a taxonomy');
  assert.ok(P2.includes('Taxonomy, not prose'), 'the artboard’s panel subtitle changed');
  assert.ok(chart.includes('meta="Taxonomy, not prose"'),
    'the loss panel dropped the artboard’s subtitle');
});

test('the chip row is the artboard’s, and the two dead ones say why', () => {
  const row = between(filters, "'pipeline/proposals': [", '],');
  assert.deepEqual([...row.matchAll(/canvas: '([^']+)'/g)].map((m) => m[1]),
    ['All', 'Opened, unanswered', 'Never opened', 'Won', 'Lost']);
  // TWO OF FIVE ARE PROSE, and both reasons name the same missing column.
  assert.equal((row.match(/unbuilt:/g) || []).length, 2,
    'the read-receipt chips changed status');
  assert.ok(flat(row).includes('nothing records that a client opened a proposal'));
  const narrowing = between(zone, 'const visible = (() => {', '})();');
  assert.ok(!/unanswered|unopened/.test(narrowing),
    'the page implements a chip the table says it cannot');
});

test('the ops row and the AI band are the artboard’s, and the surface is allow-listed', () => {
  const vm = [...P2.matchAll(/class="vm"[^>]*>([^<]*)</g)].map((m) => m[1].trim());
  assert.deepEqual(vm, ['Bulk: nudge unopened', 'Export win/loss CSV']);
  const opRow = between(actions, "'pipeline/proposals': [", '],');
  assert.deepEqual([...opRow.matchAll(/label: '([^']+)'/g)].map((m) => m[1]), vm,
    'the ops row drifted from the artboard');

  const band = between(zone, '<ZoneDraft', '/>');
  assert.ok(band.includes('surface="pipeline/proposals"'));
  assert.ok(spec.includes("'pipeline/proposals': {"), 'the draft surface is not allow-listed');
  const surface = between(spec, "'pipeline/proposals': {", "'pipeline/leads': {");
  // THE INSTRUCTION A MODEL GETS WRONG BY DEFAULT: handed a list of silent
  // proposals it will sort them into the two buckets the artboard names.
  assert.ok(flat(surface).includes('Never say or imply that one was read, ignored or never opened'),
    'the draft may now claim a proposal was read');
  assert.ok(flat(surface).includes('Never guess which reason it was'),
    'the draft may now guess a loss reason');
  assert.ok(flat(surface).includes('fewer than three decided proposals'),
    'the draft may now read a pattern out of one loss');
});

test('the writers are reachable, scoped, and the units are named', () => {
  assert.ok(/listPartnerProposals: \(\) => request\('\/partner\/pipeline\/proposals'\)/.test(apiJs));
  assert.ok(/addPartnerProposalVersion: \(quoteId, data\) =>/.test(apiJs));
  assert.ok(/setPartnerProposalOutcome: \(quoteId, data\) =>/.test(apiJs));
  assert.ok(worker.includes("partnerPipeline.get('/proposals'"));
  assert.ok(worker.includes("partnerPipeline.post('/proposals/:quoteId/versions'"));
  assert.ok(worker.includes("partnerPipeline.put('/proposals/:quoteId/outcome'"));

  // DOLLARS AND CENTS BOTH APPEAR HERE AND THE RESPONSE NAMES WHICH IS WHICH.
  // `quotes.price` is grandfathered REAL dollars; `quote_versions.price_cents`
  // is the new dialect. A field called `price` carrying both would be the bug
  // the Leads card already had once.
  const read = between(worker, "partnerPipeline.get('/proposals'", 'Append a version');
  assert.ok(/price_dollars: q\.price == null \? null : Number\(q\.price\),/.test(read),
    'the quote price stopped naming its unit');
  assert.ok(/price_cents: v\.price_cents == null \? null : Number\(v\.price_cents\),/.test(read),
    'the version price stopped naming its unit');
  const form = between(zone, 'Record a version, or why one was lost', '</Section>');
  assert.ok(/Math\.round\(Number\(draft\.price\) \* 100\)/.test(form),
    'the version form stopped converting the dollars a person types into cents');
  assert.ok(/moneyDollars\(Math\.round\(v\.price_cents \/ 100\)\)/.test(zone),
    'the version panel stopped converting cents back to dollars to display them');
});
