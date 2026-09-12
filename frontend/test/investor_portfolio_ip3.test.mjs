/**
 * Portfolio · Value-add — canvas **IP3**, `/portfolio/value-add`.
 *
 * THE ONE ZONE IN THIS SERIES WHOSE `unbuilt` REASONS WERE ALL TRUE, and this
 * file exists to keep that distinction rather than blur it. ID2, ID3, ID4, IP1
 * and IP2 each carried a sentence the schema contradicted, and each was fixed
 * by reading the store and rewriting the sentence. IP3's three reasons —
 * "no support ledger exists to write to", "there is no support history to
 * export", "a company is never counted as supported from the position book
 * alone" — were checked the same way and they held.
 *
 * WHY THEY HELD. Every table in the schema joining an investor to a company
 * records the investor GAINING ACCESS to one, never doing work for one:
 *
 *   `investor_introductions`  an investor REQUESTING an intro to a founder
 *                             against a paid quarterly quota. Its `status` is
 *                             written 'pending' once and updated by NOTHING, so
 *                             a Delivered/Outstanding split off that column
 *                             would report a state machine that never moves.
 *                             `_investorProjectScope` unions it with dealroom
 *                             membership to decide what an investor may SEE.
 *   `intro_propositions`,
 *   `intro_credit_ledger`     the peer matching engine and its credits.
 *   `engagements`,
 *   `engagement_hours`        a PARTNER's paid delivery — born of a need and a
 *                             quote, carrying a price.
 *
 * So the page was not corrected, it was BUILT: migration 237 adds
 * `portfolio_support_entries`, and the four dead chips became the predicates
 * over `state` the artboard always specified.
 *
 * THE ASSERTIONS BELOW GUARD BOTH HALVES. The store and its transition, so the
 * ledger cannot decay into another frozen-status table; and the four schema
 * facts that made the old reasons true, so a future reader who wonders why a
 * second support store was built finds the answer checked rather than asserted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = read('frontend/src/pages/investor/InvestorPortfolioValueAdd.jsx');
const P = codeOnly(PAGE);
const ROUTE = read('cloudflare-worker/src/routes/portfolio_support.ts');
// The route ARGUES for its own gate, in a docblock that necessarily says the
// word `requireAdmin` while being the file that does not use it. `R` is the
// code alone; `ROUTE` keeps the prose for the assertions that check it is
// still there. Seventh time in this series that a file's own explanation
// matched the ban meant for its code.
const R = codeOnly(ROUTE);
const MIGRATION_RAW = read('cloudflare-worker/sql/migrations/237_portfolio_support_entries.sql');
// Same trap in SQL: the migration's header says "No BEGIN/COMMIT — D1 rejects
// them", which is exactly the sentence you want kept and exactly what a ban on
// those words would trip over.
const MIGRATION = MIGRATION_RAW.replace(/^\s*--[^\n]*$/gm, '');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const INTROS = read('cloudflare-worker/src/routes/introductions.ts');
const RESEARCH = read('cloudflare-worker/src/routes/research.ts');
const INDEX = read('cloudflare-worker/src/index.ts');
const API = read('frontend/src/lib/api.js');
// Both zone tables are read comment-free: each entry changed here carries a
// comment quoting the reason it replaced, and a raw search reads that quote as
// the old reason returning. Same trap IP2 hit.
const ACTIONS = codeOnly(read('frontend/src/workspaces/investorZoneActions.js'));
const FILTERS = codeOnly(read('frontend/src/workspaces/investorZoneFilters.js'));
const CANVAS = read('design/canvases/integrated/Pages · Investor Portfolio.dc.html');

/** The page minus its JSX comments — what a reader actually sees. */
function rendered() {
  return P.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

/** One component body, bounded by the next declaration. */
function fn(name) {
  const a = P.indexOf(`function ${name}(`);
  assert.ok(a > 0, `${name} is gone from the page`);
  const b = P.indexOf('\nfunction ', a + 20);
  return P.slice(a, b > a ? b : P.length);
}

/** The IP3 artboard fixture, bounded at both ends. */
function ip3() {
  const a = CANVAS.indexOf("id:'ip3'");
  assert.ok(a >= 0, 'the IP3 artboard is gone from the canvas');
  const b = CANVAS.indexOf('\n    ];', a);
  assert.ok(b > a, 'IP3 is no longer the last artboard — this slice would run past it');
  return CANVAS.slice(a, b);
}

/** One handler from the route, bounded by the next registration. */
function handler(sig) {
  const a = ROUTE.indexOf(sig);
  assert.ok(a > 0, `${sig} is gone`);
  const b = ROUTE.indexOf('\nr.', a + 5);
  return ROUTE.slice(a, b > a ? b : ROUTE.length);
}

/** The `portfolio/value-add` draft surface, and its instruction alone. */
function surface() {
  const a = RESEARCH.indexOf("'portfolio/value-add': {");
  assert.ok(a > 0, 'the portfolio/value-add draft surface is not registered');
  return RESEARCH.slice(a, RESEARCH.indexOf('\n  },', a));
}
function instruction() {
  const spec = surface();
  const a = spec.indexOf('instruction: [');
  assert.ok(a > 0, 'the surface no longer carries an instruction');
  const b = spec.indexOf("].join(' ')", a);
  assert.ok(b > a, 'the instruction array is no longer joined');
  return spec.slice(a, b);
}

test('the three old reasons were true, and these are the facts that made them true', () => {
  // 1. `investor_introductions` is an ACCESS relation with a frozen status.
  const a = BASELINE.indexOf('CREATE TABLE investor_introductions');
  assert.ok(a > 0, 'investor_introductions is gone');
  const ddl = BASELINE.slice(a, BASELINE.indexOf(');', a));
  for (const absent of ['hours', 'kind', 'delivered_at', 'outcome']) {
    assert.ok(!new RegExp(`\\b${absent}\\b`).test(ddl),
      `investor_introductions now has ${absent} — re-check whether it is a support record after all`);
  }
  // Written 'pending' by the one INSERT and moved by nothing. If an UPDATE ever
  // appears, the Delivered/Outstanding argument below needs revisiting.
  assert.match(INTROS, /VALUES \(\?, \?, \?, \?, \?, \?, 'pending', \?\)/,
    'the introduction insert changed shape');
  // `grep -rl` exits 1 on no match, which `execFileSync` throws on — so the
  // PASSING case is the one that needs catching, not the failing one.
  let updates = '';
  try {
    updates = execFileSync('grep', ['-rl', 'UPDATE investor_introductions', 'cloudflare-worker/src'],
      { encoding: 'utf8' }).trim();
  } catch (e) {
    assert.equal(e.status, 1, `grep failed for a reason other than no-match: ${e.message}`);
  }
  assert.equal(updates, '', 'something now updates investor_introductions.status');

  // 2. `intro_credit_ledger` is credits, not hours.
  const c = BASELINE.indexOf('CREATE TABLE intro_credit_ledger');
  assert.ok(c > 0, 'intro_credit_ledger is gone');
  const credit = BASELINE.slice(c, BASELINE.indexOf(');', c));
  assert.match(credit, /delta\s+INTEGER NOT NULL/, 'the credit ledger changed shape');
  assert.ok(!/\bhours\b/.test(credit), 'intro_credit_ledger now records hours');

  // 3. `engagements` is a PARTNER's paid delivery.
  const e = BASELINE.indexOf('CREATE TABLE engagements');
  const eng = BASELINE.slice(e, BASELINE.indexOf(');', e));
  for (const col of ['partner_id', 'quote_id', 'price']) {
    assert.match(eng, new RegExp(`\\b${col}\\b`), `engagements lost ${col} — it may no longer be billed work`);
  }
  // And the migration says all of this, so the next reader finds the reasoning
  // rather than only the table.
  assert.match(MIGRATION_RAW, /investor_introductions/, 'the migration no longer explains what it checked');
  assert.match(MIGRATION_RAW, /engagement_hours/);
});

test('migration 237 builds a ledger, not another frozen-status table', () => {
  assert.match(MIGRATION, /CREATE TABLE IF NOT EXISTS portfolio_support_entries/);
  // `promised` is the DEFAULT — the artboard's whole point is that an offer
  // that was never made stays visible.
  assert.match(MIGRATION, /state\s+TEXT\s+NOT NULL DEFAULT 'promised'/,
    'a new entry no longer defaults to promised');
  assert.match(MIGRATION, /CHECK \(state IN \('promised', 'delivered', 'withdrawn'\)\)/,
    'the state set is no longer closed');
  // `hours` nullable, and NOT defaulted. A column defaulting to 0 would make
  // an untimed entry indistinguishable from a measured zero.
  assert.match(MIGRATION, /hours\s+REAL,/, 'hours is no longer a plain nullable REAL');
  assert.ok(!/hours\s+REAL[^,]*DEFAULT/.test(MIGRATION), 'hours now carries a default');
  // `summary` NOT NULL: a count of unnamed favours is not a ledger.
  assert.match(MIGRATION, /summary\s+TEXT\s+NOT NULL,/, 'an entry may now carry no description');
  assert.ok(!/\bBEGIN\b|\bCOMMIT\b/.test(MIGRATION), 'the migration carries transaction statements D1 rejects');

  // THE TRANSITION IS WHAT MAKES IT A LEDGER. Without it `state` freezes at
  // 'promised' exactly as investor_introductions' does.
  assert.match(ROUTE, /r\.patch\('\/:uid'/, 'the state transition is gone');
  const patch = handler("r.patch('/:uid'");
  assert.match(patch, /state === 'delivered'\s*\n?\s*\? \(existing\.delivered_at \|\| isoDate\(body\.delivered_at\) \|\| day\)/,
    'delivering no longer stamps a date');
  assert.match(patch, /cannot change state/, 'a delivered entry can be re-opened');
  assert.match(patch, /asked !== existing\.state && existing\.state !== 'promised'/,
    'the terminal-state check changed shape');
});

test('the read and the write narrow on the same accessible set, and neither reaches a query with an empty one', () => {
  // The CSV predicate reads NULL as EVERY ROW, so `[]` must be answered before
  // the query. `cloudflare-worker/test/portfolio_support_scope.test.ts` drives
  // this against real SQL; this asserts the shape cannot silently drop.
  assert.match(ROUTE, /return \{ ids, empty: ids != null && ids\.length === 0 \}/,
    'the empty-set flag changed shape');
  const get = handler("r.get('/'");
  assert.match(get, /if \(empty\) \{/, 'the read no longer short-circuits an empty accessible set');
  const post = handler("r.post('/'");
  assert.match(post, /if \(empty \|\| \(ids != null && !ids\.includes\(Number\(proj\.id\)\)\)\)/,
    'the write gate no longer checks the empty set first');
  const patch = handler("r.patch('/:uid'");
  assert.match(patch, /if \(empty \|\| \(ids != null && !ids\.includes\(Number\(existing\.project_id\)\)\)\)/,
    'the transition gate no longer checks the empty set first');
  // Every handler is behind canViewLpData, so a founder gets 403 rather than a
  // paywall — and the mount says why it is not in STUDIO_PREFIXES.
  assert.equal((ROUTE.match(/if \(!canViewLpData\(user\)\) return c\.json\(\{ detail: 'Forbidden' \}, 403\);/g) || []).length, 3,
    'a handler lost its role gate');
  assert.match(INDEX, /app\.route\('\/api\/portfolio-support', portfolioSupport\);/, 'the route is not mounted');
  assert.match(INDEX, /they have hit someone else's surface/, 'the mount no longer says why 403 rather than 402');
});

test('the write is open to an investor on purpose, and the route says why', () => {
  // Every other write in the Portfolio bucket is requireAdmin. This one is not,
  // and a reader has to find the argument rather than assume a slip.
  assert.ok(!/requireAdmin/.test(R), 'the support write became admin-only, which empties the ledger');
  assert.match(ROUTE, /WRITES ARE NOT ADMIN-ONLY, AND THAT IS DELIBERATE/,
    'the route no longer argues for its own gate');
  assert.match(ROUTE, /A support entry is\s*\n \* not a valuation/, 'the valuation distinction is gone');
  // And nobody gains a project they could not already see.
  assert.match(ROUTE, /Nobody gains a project they could not already see\./);
});

test('all four chips are live and the page implements each one', () => {
  const row = FILTERS.slice(FILTERS.indexOf("'portfolio/value-add': ["), FILTERS.indexOf('],', FILTERS.indexOf("'portfolio/value-add': [")));
  assert.deepEqual(
    (row.match(/key: '([a-z]+)'/g) || []).map((x) => x.slice(6, -1)),
    ['all', 'delivered', 'outstanding', 'company'],
    'the four chips are no longer the four the artboard names');
  assert.ok(!row.includes('unbuilt'), 'a chip went dark again');
  // The shared reason has no uses left and should not linger.
  assert.ok(!FILTERS.includes('NO_SUPPORT_LEDGER'), 'the retired reason constant is back');

  const code = codeOnly(P);
  assert.match(code, /filter === 'delivered' \? row\.state === 'delivered'/, 'Delivered no longer reads state');
  assert.match(code, /filter === 'outstanding' \? row\.state === 'promised'/, 'Outstanding no longer reads state');
  // `company` is a VIEW, like IP2's `Rules` — a rollup, not a narrower row set.
  assert.match(code, /const byCompany = filter === 'company';/, 'the By company view is gone');
  assert.match(code, /\{byCompany\s*\n?\s*\? <PerCompany/, 'By company no longer swaps the body');
});

test('the three ops are wired, and the handler names match what the page passes', () => {
  const row = ACTIONS.slice(ACTIONS.indexOf("'portfolio/value-add': ["), ACTIONS.indexOf('],', ACTIONS.indexOf("'portfolio/value-add': [")));
  assert.match(row, /\{ label: 'Log support', kind: 'handler', handler: 'logSupport' \}/);
  assert.match(row, /\{ label: 'Export', kind: 'export' \}/);
  assert.match(row, /\{ label: 'Per-company view', kind: 'handler', handler: 'byCompany' \}/);
  assert.ok(!row.includes('unbuilt'), 'an op went dark again');

  // `makeZoneActions` reads `handlers[item.handler]` and DROPS anything without
  // a callable onClick — silently. A name mismatch here is a control that
  // vanishes rather than one that errors, so both names are checked against the
  // object the page actually passes.
  const passed = P.slice(P.indexOf('handlers: {'), P.indexOf('}', P.indexOf('handlers: {')) + 1);
  assert.match(passed, /logSupport/, 'the logSupport handler is not passed to the builder');
  assert.match(passed, /byCompany: byCompanyView/, 'the byCompany handler is not passed to the builder');
  assert.match(P, /const logSupport = useCallback/, 'the log-support handler is gone');
  assert.match(P, /const byCompanyView = useCallback/, 'the per-company handler is gone');
});

test('an unrecorded hour count is never a zero, on the page or in the total', () => {
  // D56/D68. `null` is "nobody timed this"; `0` is "it took none".
  assert.match(P, /const hoursLabel = \(value\) => \(value == null \? 'Not recorded'/,
    'an untimed entry renders as a number');
  // The strip refuses to print a 0 total when the only reason it is zero is
  // that nothing was timed.
  assert.match(P, /totals\.entries_without_hours > 0 && totals\.hours_recorded === 0\s*\n?\s*\? 'Not recorded'/,
    'a ledger of untimed entries reports 0 hours');
  // The route counts the untimed entries rather than folding them in.
  assert.match(ROUTE, /if \(s\.hours == null\) \{ x\.entries_without_hours \+= 1; withoutHours \+= 1; \}/,
    'the route no longer counts untimed entries separately');
  assert.match(ROUTE, /if \(v === undefined \|\| v === null \|\| v === ''\) return null;/,
    'an empty hours field is coerced to a number');
  // And the form sends absence as absence.
  assert.match(P, /\.\.\.\(form\.hours === '' \? \{\} : \{ hours: Number\(form\.hours\) \}\)/,
    'the form sends an empty hours field as a value');
  const panel = fn('PerCompany');
  assert.match(panel, /row\.entries_without_hours === row\.entries \? 'Not recorded'/,
    'a company whose entries are all untimed shows an hour total');
});

test('a company is counted as supported only from a recorded entry', () => {
  // The reason that stayed true even after the store was built, and the rule
  // the rollup has to keep.
  const get = handler("r.get('/'");
  assert.match(get, /FROM portfolio_positions pp/, 'the book is no longer read');
  assert.match(get, /companies_supported: companies\.filter\(\(x\) => x\.entries > 0 && inBook\.has\(x\.project_id\)\)\.length/,
    'a company is counted as supported without an entry');
  assert.match(get, /const untouched = companies\.filter\(\(x\) => x\.entries === 0 && inBook\.has\(x\.project_id\)\)/,
    'the untouched list changed shape');
  const panel = fn('PerCompany');
  assert.match(panel, /never because it is in the book, sent an update, or appears in an introduction row/,
    'the counting rule is no longer stated on the page');
  // The strip names the untouched companies, as the artboard does.
  assert.match(P, /untouched\.map\(\(x\) => x\.name\)\.join\(', '\)/, 'the untouched companies are no longer named');
});

test('an unreadable ledger is not an empty one', () => {
  assert.match(P, /const unreadable = Boolean\(state\.error\);/, 'the page no longer tracks an unreadable read');
  assert.match(P, /That is not a claim that no support was given\./,
    'a failed read no longer says what it is not claiming');
  const ledger = fn('Ledger');
  assert.match(ledger, /if \(unreadable\) return/, 'the ledger draws its empty state over a failed read');
  assert.match(ledger, /The ledger is empty because nothing has been logged, not because nothing was done\./,
    'the empty state no longer explains what an empty ledger means');
});

test('the AI band is mounted and refuses the four flattering substitutions', () => {
  const shown = rendered();
  assert.match(shown, /surface="portfolio\/value-add"/, 'the artboard’s AI band is not on the page');
  const said = instruction();
  assert.match(said, /A PROMISED entry is not work done/, 'a promise may be reported as delivered');
  assert.match(said, /never invent a result/, 'an outcome may be invented');
  assert.match(said, /never fold it into the total/, 'untimed entries may be summed as zero');
  assert.match(said, /has nothing RECORDED against it/, 'a company with no entry may be called unsupported in fact');
  assert.match(said, /do not forecast/);
  const spec = surface();
  assert.match(spec, /if \(role !== 'admin' && role !== 'partner' && role !== 'investor'\) return \[\];/,
    'the gather no longer gates on role');
  assert.match(spec, /if \(ids != null && ids\.length === 0\) return \[\];/,
    'the gather lets an empty accessible set reach the query');
  assert.doesNotMatch(spec, /role:\s*'(admin|partner|investor)'/, 'the gather hard-codes a role');
  // UNTIMED is spelled, not zeroed, in the rows the model sees.
  assert.match(spec, /hours \$\{s\.hours == null \? 'UNTIMED' : s\.hours\}/,
    'an untimed entry reaches the model as a number');
});

test('the strip, the instrument and the header row match the artboard', () => {
  const board = ip3();
  const head = /head:\[([^\]]*)\]/.exec(board);
  assert.ok(head, 'the IP3 artboard no longer declares an instrument head');
  const columns = head[1].split(',').map((x) => x.trim().replace(/^'|'$/g, ''));
  assert.deepEqual(columns, ['Company', 'Kind', 'State', 'Hours', 'What happened']);
  // SCOPED TO THE LEDGER, not to the page. `PerCompany` has a `Hours` column of
  // its own, so a page-wide `includes` reported the instrument's `Hours` as
  // present after it had been deleted — the rollup's header stood in for it.
  // Mutation-checking found exactly that. The artboard's instrument is the
  // ledger, so the ledger is what has to carry these five.
  const ledgerBody = fn('Ledger');
  for (const col of columns) {
    assert.ok(ledgerBody.includes(`<th>${col}</th>`), `the support ledger lost its ${col} column`);
  }
  for (const label of ['Delivered', 'Hours logged', 'Outstanding', 'No support at all']) {
    assert.ok(P.includes(`label="${label}"`), `the strip lost its ${label} tile`);
  }
  const filters = /filters: fil\(\[([^\]]*)\]/.exec(board);
  for (const label of filters[1].split(',').map((x) => x.trim().replace(/^'|'$/g, ''))) {
    assert.ok(FILTERS.includes(`canvas: '${label}'`), `the filter table lost ${label}`);
  }
  const ops = /ops:\[([^\]]*)\]/.exec(board);
  for (const label of ops[1].split(',').map((x) => x.trim().replace(/^'|'$/g, ''))) {
    assert.ok(ACTIONS.includes(`label: '${label}'`), `the ops row lost ${label}`);
  }
  // Task #150 asks for the eyebrow to go, as #95 already did for founder.
  assert.ok(!P.includes('i4-eyebrow'), 'the Portfolio / Value-add eyebrow is back');
  assert.match(P, /<h1>Value-add desk<\/h1>/, 'the heading went with the eyebrow');
  // Three client methods, all against the mounted route.
  for (const m of ['portfolioSupportList', 'portfolioSupportLog', 'portfolioSupportUpdate']) {
    assert.ok(API.includes(`${m}:`), `the ${m} client method is gone`);
  }
});
