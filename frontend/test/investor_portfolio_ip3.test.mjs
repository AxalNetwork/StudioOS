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
// D4817 part 5 (#5311, PF-05): the page draws in the Portfolio frame, and its
// pure rules (labels, hours, figures, per-company rollup, the view predicate)
// moved to `pages/portfolio/valueAddModel.js`. `M` is that model, code only.
const M = codeOnly(read('frontend/src/pages/portfolio/valueAddModel.js'));
const PF05 = read('design/incoming/Portfolio v2 Page.dc.html');
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
  // D4642: only the TRANSITION stamps the date. An amendment to an entry that
  // is already delivered with no recorded date must not back-stamp today onto a
  // delivery that happened at some other time, so `moving` gates the fallback.
  assert.match(patch, /state === 'delivered'\s*\n?\s*\? \(existing\.delivered_at \|\| isoDate\(body\.delivered_at\) \|\| \(moving \? day : null\)\)/,
    'delivering no longer stamps a date');
  assert.match(patch, /const moving = asked !== null && asked !== existing\.state;/,
    'the transition flag that gates date stamping is gone');
  assert.match(patch, /its state cannot change/, 'a delivered entry can be re-opened');
  assert.match(patch, /asked !== existing\.state && existing\.state !== 'promised'/,
    'the terminal-state check changed shape');
});

test('the read and the write narrow on the same accessible set, and neither reaches a query with an empty one', () => {
  // The CSV predicate reads NULL as EVERY ROW, so `[]` must be answered before
  // the query. `cloudflare-worker/test/portfolio_support_scope.test.ts` drives
  // this against real SQL; this asserts the shape cannot silently drop.
  // D1595 (#3868): the book moved to services/profileWriteGates.ts, shared with Fill's scope; the route still reads it.
  assert.match(ROUTE, /return supportBookIds\(c\.env, user, await investorActiveCompany\(c, user\)\)/, 'the route no longer reads the shared book');
  assert.match(read('cloudflare-worker/src/services/profileWriteGates.ts'), /return \{ ids, empty: ids != null && ids\.length === 0 \}/,
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
  // Four handlers since D4642 added GET /:uid/history, which reads the same book.
  assert.equal((ROUTE.match(/if \(!canViewLpData\(user\)\) return c\.json\(\{ detail: 'Forbidden' \}, 403\);/g) || []).length, 4,
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

  assert.match(M, /filter === 'delivered' \? row\.state === 'delivered'/, 'Delivered no longer reads state');
  assert.match(M, /filter === 'outstanding' \? row\.state === 'promised'/, 'Outstanding no longer reads state');
  assert.match(P, /\.filter\(inView\(filter\)\)/, 'the page no longer applies the view predicate');
  // `company` is a VIEW, like IP2's `Rules` — a rollup, not a narrower row set.
  assert.match(P, /const byCompany = filter === 'company';/, 'the By company view is gone');
  assert.match(P, /\{byCompany \? <PerCompany/, 'By company no longer swaps the body');
});

test('the three ops are wired, and the handler names match what the page passes', () => {
  const row = ACTIONS.slice(ACTIONS.indexOf("'portfolio/value-add': ["), ACTIONS.indexOf('],', ACTIONS.indexOf("'portfolio/value-add': [")));
  // D1424 (#3700): Log support is the zone's indigo primary.
  assert.match(row, /\{ label: 'Log support', kind: 'handler', handler: 'logSupport', primary: true \}/);
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
  assert.match(M, /export const hoursLabel = \(value\) => \(value == null \? NOT_RECORDED/,
    'an untimed entry renders as a number');
  // The strip refuses to print a 0 total when the only reason it is zero is
  // that nothing was timed.
  assert.match(M, /if \(entries > 0 && untimed === entries\) return \{ state: 'not_recorded', text: NOT_RECORDED/,
    'a ledger of untimed entries reports 0 hours');
  // The route counts the untimed entries rather than folding them in.
  //
  // #4647 (D4647) moved this from a loop over the returned page to the
  // ledger's own GROUP BY, because every figure here has to be over the whole
  // authorized population and not over the 400 rows that happened to be
  // shown. The rule is unchanged and so is what this case is for: an untimed
  // entry is COUNTED, never summed as zero. Both halves are pinned, since the
  // sum and the count are now separate columns — and behaviourally too, in
  // cloudflare-worker/test/portfolio_periods_pages_4647.test.ts, which checks
  // a ledger where every entry is untimed.
  assert.match(ROUTE, /SUM\(CASE WHEN s\.hours IS NULL THEN 1 ELSE 0 END\) AS entries_without_hours/,
    'the route no longer counts untimed entries separately');
  assert.match(ROUTE, /SUM\(CASE WHEN s\.hours IS NULL THEN 0 ELSE s\.hours END\)/,
    'the hours total no longer excludes the untimed entries');
  assert.match(ROUTE, /if \(v === undefined \|\| v === null \|\| v === ''\) return null;/,
    'an empty hours field is coerced to a number');
  // And the form sends absence as absence.
  assert.match(P, /\.\.\.\(form\.hours === '' \? \{\} : \{ hours: Number\(form\.hours\) \}\)/,
    'the form sends an empty hours field as a value');
  assert.match(M, /hours: Number\(c\.entries_without_hours\) === Number\(c\.entries\)\s*\n\s*\? NOT_RECORDED/,
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
  assert.match(M, /untouched\.map\(\(x\) => x\.name\)\.join\(', '\)/, 'the untouched companies are no longer named');
});

test('an unreadable ledger is not an empty one', () => {
  // D4817 part 5: each read is the Portfolio model's (loading, ok, unreadable);
  // `portfolio_value_add_d4817.test.mjs` mounts the page in each state.
  assert.match(P, /const \{ reads, retry \} = usePortfolioReads\(SOURCES\);/, 'the page no longer tracks its read\'s state');
  assert.match(P, /That is not a claim that no support was given\./,
    'a failed read no longer says what it is not claiming');
  const ledger = fn('Commitments');
  assert.ok(ledger.indexOf("if (read.state === 'unreadable')") > 0
    && ledger.indexOf("if (read.state === 'unreadable')") < ledger.indexOf('if (!rows.length)'),
  'the ledger draws its empty state over a failed read');
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
  assert.match(spec, /if \(role !== 'admin' && !\(await heldLicences\(c\.env\.DB, \{ id: userId, role \}\)\)\.some\(licence => licence === 'partner' \|\| licence === 'investor'\)\) return \[\];/,
    'the gather no longer gates on role');
  assert.match(spec, /if \(ids != null && ids\.length === 0\) return \[\];/,
    'the gather lets an empty accessible set reach the query');
  assert.doesNotMatch(spec, /role:\s*'(admin|partner|investor)'/, 'the gather hard-codes a role');
  // UNTIMED is spelled, not zeroed, in the rows the model sees.
  assert.match(spec, /hours \$\{s\.hours == null \? 'UNTIMED' : s\.hours\}/,
    'an untimed entry reaches the model as a number');
});

test('the strip, the instrument and the header row match the artboard', () => {
  // D4817 part 5 (#5311): PF-05 supersedes IP3's instrument. Its table is
  // Company · Support item · Owner · State · Created · Delivered · Next /
  // linked, and its strip the six figures; the build calls Created "Recorded"
  // (the ledger's `created_at` is when the entry was recorded) and draws
  // Delivered over every entry (no read carries the Worker's quarter).
  const start = PF05.indexOf('const valueAdd = () =>');
  assert.ok(start > 0, 'the PF-05 board is gone from the canvas');
  const board = PF05.slice(start, PF05.indexOf('\n\n', start));
  const columns = [...board.matchAll(/<th>([^<]*)<\/th>/g)].map((x) => x[1]).filter(Boolean);
  assert.deepEqual(columns, ['Company', 'Support item', 'Owner', 'State', 'Created', 'Delivered', 'Next / linked']);
  const table = fn('Commitments');
  for (const col of columns.map((c) => (c === 'Created' ? 'Recorded' : c))) {
    assert.ok(table.includes(`<th scope="col">${col}</th>`), `the commitments table lost its ${col} column`);
  }
  const strip = [...board.matchAll(/<div><small>([^<]*)<\/small><b/g)].map((x) => x[1]);
  assert.deepEqual(strip, ['Open commitments', 'In progress', 'Delivered this quarter', 'Introductions made', 'Overdue commitments', 'No support recorded']);
  for (const label of strip.map((l) => (l === 'Delivered this quarter' ? 'Delivered' : l))) {
    assert.ok(M.includes(`'${label}'`), `the strip lost its ${label} figure`);
  }
  const ip3board = ip3();
  const filters = /filters: fil\(\[([^\]]*)\]/.exec(ip3board);
  for (const label of filters[1].split(',').map((x) => x.trim().replace(/^'|'$/g, ''))) {
    assert.ok(FILTERS.includes(`canvas: '${label}'`), `the filter table lost ${label}`);
  }
  const ops = /ops:\[([^\]]*)\]/.exec(ip3board);
  for (const label of ops[1].split(',').map((x) => x.trim().replace(/^'|'$/g, ''))) {
    assert.ok(ACTIONS.includes(`label: '${label}'`), `the ops row lost ${label}`);
  }
  // Task #150 asks for the eyebrow to go, as #95 already did for founder.
  assert.ok(!P.includes('i4-eyebrow'), 'the Portfolio / Value-add eyebrow is back');
  // D4817 part 5: the heading and local navigation are the Portfolio frame's.
  assert.match(P, /<PortfolioFrame\s+tab="value-add"/, 'the page left the Portfolio frame');
  // Four client methods, all against the mounted route.
  for (const m of ['portfolioSupportList', 'portfolioSupportLog', 'portfolioSupportUpdate', 'portfolioSupportHistory']) {
    assert.ok(API.includes(`${m}:`), `the ${m} client method is gone`);
  }
});

/**
 * D4642 (#4642) — the desk's save path.
 *
 * THREE DEFECTS THIS GUARDS AGAINST, each one found on this page rather than
 * imagined: a refused write written into `state.error`, which blanked every
 * stat to "Unavailable" and said the ledger could not be read about a ledger
 * it had just read; a Deliver sent with no record id and no revision, so a
 * stale tab silently overwrote a colleague's accepted change; and a draft
 * holding a `project_uid` the reloaded book no longer carried, which the
 * server answered with "Project not found" about a company the member had
 * picked from this very list.
 */
test('a refused write names its own entry and leaves the ledger readable', () => {
  // The two are separate state, and the stats read only `state.error`.
  assert.match(P, /const \[notice, setNotice\] = useState\(null\);/, 'the per-entry write outcome is gone');
  const move = /const move = async \(row, next\) => \{[\s\S]*?\n  \};/.exec(P);
  assert.ok(move, 'the transition handler is gone');
  assert.doesNotMatch(move[0], /setState\(\{ loading/, 'a refused write writes over the ledger read again');
  assert.doesNotMatch(move[0], /error: error\?\.message/, 'a refused write is reported as an unreadable ledger again');
  // The notice names the company and offers the next action.
  assert.match(P, /data-testid=\{`status-va-support-\$\{notice\.kind\}`\}/, 'the notice is no longer addressable');
  assert.match(P, /Reload the ledger/, 'the notice no longer offers a next action');
  // And the row it is about is marked, so a conflict on a long ledger is
  // findable rather than a sentence about an entry the member has to hunt for.
  assert.match(fn('Commitments'), /contested=\{noticeFor === c\.uid\}/, 'the contested row is no longer marked');
  assert.match(fn('CommitmentRow'), /contested \? 'is-contested' : undefined/, 'the contested row is no longer marked');
  assert.match(rendered(), /company \? `\$\{company\}: ` : ''/, 'the refusal no longer names the record it is about');
});

test('a transition names the record and the revision it read, and the loser keeps the newer work', () => {
  const move = /const move = async \(row, next\) => \{[\s\S]*?\n  \};/.exec(P)[0];
  // The request carries BOTH: the record it believes it is editing, and the
  // revision the page read. Either alone is not enough — the uid alone cannot
  // see a concurrent change, the revision alone cannot see a stale list.
  assert.match(move, /project_uid: row\.project_uid \?\? undefined,/, 'the transition no longer names the record');
  assert.match(move, /expected_revision: Number\(row\.revision\)/, 'the transition no longer sends the revision it read');
  // On a conflict the server's row replaces the stale one: the page shows the
  // accepted work rather than the copy it opened.
  assert.match(move, /error\?\.code === 'changed_since_open'/, 'the conflict is no longer told apart from any other refusal');
  // D4817 part 5: the ledger is read again, so the page shows the accepted row.
  const conflict = move.slice(move.indexOf("error?.code === 'changed_since_open'"));
  assert.match(conflict.slice(0, conflict.indexOf('return;')), /reload\(\);/, 'the newer accepted row is no longer read');
  assert.match(move, /Their change is shown\./, 'the conflict no longer says the accepted change is shown');
  assert.match(move, /Apply yours again if it still applies\./, 'the conflict no longer says what the member can do');
  // One pending save at a time, on both writers.
  assert.match(move, /if \(busy\) return;/, 'a second transition can race the first');
  assert.match(P, /if \(busy\) return; \/\/ D4642/, 'a double-clicked Log support can submit twice');
  const ledger = fn('CommitmentRow');
  assert.match(ledger, /disabled=\{!!busy\}/, 'the move buttons are live during a pending save');
  assert.match(ledger, /onAsk\(c\.row, 'delivered'\)/, 'Mark delivered no longer passes the whole row');
  assert.match(ledger, /onConfirm\(c\.row, asking\.next\)/, 'the confirmation no longer passes the whole row');
});

test('an amendment is attributed on the page, and an unamended entry claims nothing', () => {
  const ledger = fn('CommitmentRow');
  assert.match(ledger, /c\.revision > 1/, 'the page no longer tells an amended entry from a fresh one');
  assert.match(ledger, /Not amended since it was recorded/, 'an unamended entry no longer says so');
  assert.match(ledger, /HISTORY_LABEL\[item\.action\]/, "an amendment's own verb is gone");
  assert.match(M, /export const HISTORY_LABEL = \{ amended: 'Amended'/, 'a state-less amendment is labelled as a transition again');
  assert.match(ledger, /a member no longer on the account/, 'an amendment by a departed member reads as unattributed');
  // An unreadable history is not an empty one, and it does not touch the row.
  const open = /const openHistory = \(row\) => \{[\s\S]*?\n  \};/.exec(P)[0];
  assert.match(open, /if \(history\?\.uid === row\.uid\) \{ setHistory\(null\); return; \}/,
    'a second click re-fetches rather than closing');
  assert.match(P, /\{ uid: row\.uid, loading: false, error: true, items: \[\] \}/, 'a failed history read is reported as no amendments');
  assert.match(ledger, /open\.error \? <SourceFailure what="This entry’s history"/, 'a failed history read is reported as no amendments');
  assert.match(ledger, /No amendment is recorded\./, 'an empty history is no longer told apart from a failed one');
  assert.ok(API.includes('portfolioSupportHistory:'), 'the history client method is gone');
  assert.match(ROUTE, /r\.get\('\/:uid\/history'/, 'the history read is gone from the route');
});

test('a draft cannot be saved against a company the book no longer holds', () => {
  const submit = /const submit = async \(event\) => \{[\s\S]*?\n  \};/.exec(P)[0];
  assert.match(submit, /if \(!companies\.some\(\(x\) => x\.project_uid === form\.project_uid\)\)/,
    'the draft no longer re-checks its company against the reloaded book');
  assert.match(submit, /Pick a company again\./, 'the refusal no longer says what to do about it');
  // The message is the FORM's, not the ledger's: a draft that cannot be saved
  // says nothing about whether the ledger could be read.
  assert.match(submit, /setForm\(\(current\) => \(\{[\s\S]*?error: 'That company is no longer in this book/,
    'the draft refusal is reported somewhere other than the form');
});
