/**
 * Portfolio · Updates — canvas **IP2**, `/portfolio/updates`.
 *
 * THE FINDING, AND IT IS MILDER THAN IP1's. `Rules` was marked unbuilt on this
 * zone for want of an extraction layer. That reason is true about extraction
 * and beside the point about rules, because two different rule sets are in play
 * and only one of them is missing:
 *
 *   COLLECTION rules — what companies are asked to report — are stored.
 *   `portfolio_kpi_definitions` holds the key, the name, the wording companies
 *   are held to, the unit, the cadence, whether each is required and who it
 *   applies to. It is seeded firm-wide by migration 168. And
 *   `GET /positions/kpi-compliance` has returned the whole set as `kpi_set` on
 *   every load of this page since the page was written.
 *
 *   EXTRACTION rules — how "a team of ~12" becomes a headcount — are not.
 *   Nothing stores a proposal, an ambiguity state or a review queue.
 *
 * So the chip was dark over data already in hand, while the sentence explaining
 * why described a different object. That is the whole change: one chip lit, one
 * panel written, and both reasons made specific enough to stay true.
 *
 * IT IS NOT A SIXTH FALSEHOOD and this file does not dress it up as one. IP1's
 * reason denied a store that existed and a read that was already serving it to
 * the same reader. IP2's reason named a real gap and then generalised one word
 * too far. The assertions below therefore check that BOTH halves survive: the
 * rules that exist are shown, and the ones that do not are still refused.
 *
 * WHY THESE ASSERTIONS READ THE SCHEMA AND THE ROUTE. A sentence can be
 * rewritten without a store appearing. If `portfolio_kpi_definitions` is ever
 * dropped, or the compliance route stops returning `kpi_set`, the old reason
 * becomes true again and this file should fail loudly rather than keep
 * asserting a panel over nothing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = read('frontend/src/pages/investor/InvestorPortfolioUpdates.jsx');
const P = codeOnly(PAGE);
const POSITIONS = read('cloudflare-worker/src/routes/positions.ts');
const UPDATES = read('cloudflare-worker/src/routes/portfolio_updates.ts');
const RESEARCH = read('cloudflare-worker/src/routes/research.ts');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const MIGRATION = read('cloudflare-worker/sql/migrations/168_portfolio_marks_distributions.sql');
// BOTH TABLES ARE READ COMMENT-FREE. Each entry changed below carries a
// comment quoting the reason it replaced, so the next reader knows what was
// wrong — and a raw-text search reads that quote as the old reason returning.
// Sixth time in this series; it is why `_codeOnly` exists.
const ACTIONS = codeOnly(read('frontend/src/workspaces/investorZoneActions.js'));
const FILTERS = codeOnly(read('frontend/src/workspaces/investorZoneFilters.js'));
const API = read('frontend/src/lib/api.js');
const CANVAS = read('design/canvases/integrated/Pages · Investor Portfolio.dc.html');

/**
 * The page with its JSX comments removed — what a reader actually sees.
 *
 * `codeOnly` strips `//` and block comments but not `{/* … *​/}`, and this
 * page's comments deliberately QUOTE the two dead predicates that used to
 * empty the inbox so the next reader knows what was wrong. A raw-text search
 * reads that quote as the defect returning — the trap ID1 hit with a fixture
 * figure, ID3 hit twice, ID4 hit on its own limits block and IP1 hit on a
 * replacement card.
 */
function rendered() {
  return P.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

/** The `RuleSet` component body alone, bounded by the next declaration. */
function panel() {
  const a = P.indexOf('function RuleSet(');
  assert.ok(a > 0, 'the rule-set panel is gone');
  const b = P.indexOf('\nfunction ', a + 20);
  return P.slice(a, b > a ? b : P.length);
}

/** The stated-limit card alone — the block that says what is NOT built. */
function limits() {
  const a = P.indexOf('ip2-unavailable');
  assert.ok(a > 0, 'the stated-limit card is gone');
  return P.slice(a, P.indexOf('</section>', a));
}

/** The IP2 artboard fixture alone, bounded at BOTH ends. */
function ip2() {
  const a = CANVAS.indexOf("id:'ip2'");
  assert.ok(a >= 0, 'the IP2 artboard is gone from the canvas');
  const b = CANVAS.indexOf("id:'ip3'", a);
  assert.ok(b > a, 'IP3 no longer follows IP2 — this slice would run past the artboard');
  return CANVAS.slice(a, b);
}

/** The `portfolio/updates` draft surface alone. */
function surface() {
  const a = RESEARCH.indexOf("'portfolio/updates': {");
  assert.ok(a > 0, 'the portfolio/updates draft surface is not registered');
  const b = RESEARCH.indexOf('\n  },', a);
  return RESEARCH.slice(a, b);
}

/**
 * The surface's `instruction` array alone — the words that actually reach the
 * model.
 *
 * The comments above it explain each refusal and QUOTE it, so a presence
 * assertion over the whole block passes while the instruction is gutted.
 * Mutation-checking found precisely that: deleting the hedged-approximation
 * example from the instruction left the comment naming it, and the guard held.
 * Same trap as `rendered()` and the two zone tables, in the worker this time.
 */
function instruction() {
  const spec = surface();
  const a = spec.indexOf('instruction: [');
  assert.ok(a > 0, 'the surface no longer carries an instruction');
  const b = spec.indexOf("].join(' ')", a);
  assert.ok(b > a, 'the instruction array is no longer joined into one string');
  return spec.slice(a, b);
}

test('the rule set is a stored table, and this page was already being handed it', () => {
  // THE STORE. Every column the panel renders has to exist, or the panel is
  // drawing fields that are not there.
  const a = BASELINE.indexOf('CREATE TABLE portfolio_kpi_definitions');
  assert.ok(a > 0, 'portfolio_kpi_definitions is gone');
  const ddl = BASELINE.slice(a, BASELINE.indexOf(');', a));
  for (const col of ['kpi_key', 'name', 'definition', 'unit', 'cadence', 'required', 'applies_to', 'sort_order']) {
    assert.match(ddl, new RegExp(`\\b${col}\\b`), `portfolio_kpi_definitions lost ${col}`);
  }
  // `fund_id` nullable is what makes the seeded set FIRM-WIDE, which is the
  // word the panel and the ops reason both use.
  assert.match(ddl, /fund_id INTEGER REFERENCES vc_funds\(id\)/, 'the firm-wide fallback row is gone');

  // THE SEED. An empty table would make "no rules are stored" true again.
  //
  // Anchored at column 0 and bounded at the statement's own semicolon. An
  // `indexOf` here matched a COMMENTED-OUT insert — and `slice(-1)` on the miss
  // returns the file's last character rather than nothing, so the length check
  // guarding it could never fail. Mutation-checking found both at once.
  const seedAt = MIGRATION.search(/^INSERT OR IGNORE INTO portfolio_kpi_definitions/m);
  assert.ok(seedAt >= 0, 'the firm-wide KPI set is no longer seeded');
  const seed = MIGRATION.slice(seedAt, MIGRATION.indexOf(';', seedAt));
  const seeded = (seed.match(/^\s*\(NULL, '/gm) || []).length;
  assert.ok(seeded >= 4, `expected a seeded firm-wide rule set; found ${seeded} rows`);
  // Seeded at more than one cadence — which is why the panel has to say which
  // slice it is showing rather than presenting its rows as the whole set.
  assert.match(seed, /'monthly'/, 'the monthly cadence is gone from the seed');
  assert.match(seed, /'quarterly'/, 'the quarterly cadence is gone from the seed');

  // THE READ THAT WAS ALREADY HAPPENING. Not a new endpoint: the route already
  // selected the set and already returned it under `kpi_set`.
  const at = POSITIONS.indexOf("r.get('/kpi-compliance'");
  assert.ok(at > 0, 'the compliance route is gone');
  const handler = POSITIONS.slice(at, POSITIONS.indexOf('\nr.', at + 20));
  assert.match(handler, /FROM portfolio_kpi_definitions/, 'the route no longer reads the rule set');
  assert.match(handler, /kpi_set: defs\.results \|\| \[\]/, 'the route no longer returns the rule set');
  assert.match(API, /positionsKpiCompliance: \(cadence = 'quarterly'\) =>/, 'the client method changed shape');
  // And the page has always called it. This is the fact that makes the old
  // reason a mistake rather than a missing feature.
  assert.match(P, /api\.positionsKpiCompliance\(\)/, 'the page no longer loads the compliance payload');
  // No new endpoint was added for this zone — the same lesson ID4 applied.
  assert.ok(!/portfolio-updates\/rules|kpi-definitions/.test(API),
    'a new rules endpoint was added for data the page already had');
});

test('the Rules chip is live, and it is a view rather than a predicate that empties the inbox', () => {
  const row = FILTERS.slice(FILTERS.indexOf("'portfolio/updates': ["), FILTERS.indexOf('],', FILTERS.indexOf("'portfolio/updates': [")));
  assert.match(row, /\{ canvas: 'Rules', key: 'rules' \}/, 'the Rules chip is unbuilt again');
  assert.doesNotMatch(row, /Parse review/,
    'internal parse-review working copy is visible to investors');

  // The page implements it, and implements it as a swap.
  assert.match(P, /const showingRules = filter === 'rules';/, 'the page does not implement the Rules key');
  // D4817 part 4 (#5311, PF-04): while the reporting read is still answering,
  // the swap draws a skeleton, never an empty rule set.
  assert.match(P, /\{showingRules\s*\?\s*\(reads\.compliance\.state === 'loading' \? <section className="pf-card"><Skeleton rows=\{3\} \/><\/section> : <RuleSet/, 'the Rules chip no longer opens the rule set');
  // The dead predicates that used to return false are not back. `visible` is
  // the only row filter on this page and it may only narrow on `overdue`.
  const visible = P.slice(P.indexOf('const visible = rows.filter'), P.indexOf('\n', P.indexOf('const visible = rows.filter')));
  assert.ok(!visible.includes("'rules'"), 'the Rules chip empties the inbox again');
  assert.ok(!visible.includes("'parse'"), 'a retired parse predicate filters the inbox');
});

test('the panel tells an unreadable rule set apart from an empty one', () => {
  const body = panel();
  // Three branches. Collapsing the first two would report "the source could not
  // be read" as "companies are asked for nothing", which on this page is the
  // difference between silence and a standard.
  // D4817 part 4 (#5311, PF-04): each source is its own read (`usePortfolioReads`).
  assert.match(P, /const complianceUnavailable = reads\.compliance\.state === 'unreadable';/,
    'an unreadable reporting read is no longer told apart');
  assert.match(P, /const kpiSet = complianceUnavailable \? null : \(reads\.compliance\.value\?\.kpi_set \|\| \[\]\);/,
    'the null / empty distinction is gone from the derivation');
  assert.match(body, /kpiSet === null/, 'the panel has no unreadable state');
  assert.match(body, /kpiSet\.length === 0/, 'the panel has no empty state');
  assert.match(body, /data-testid="ip2-rule-set-unreadable"/, 'the unreadable state has no distinct marker');
  assert.match(body, /not a claim that companies are asked for nothing/,
    'the unreadable state no longer says what it is not claiming');
  assert.match(body, /Companies reporting on this schedule are held to no stored figure/,
    'the empty state no longer explains what an empty rule set means');

  // `complianceUnavailable` must be declared before `kpiSet` reads it. A `const`
  // read from its own temporal dead zone throws on first render, and the page
  // renders fine right up until the moment it does not.
  assert.ok(P.indexOf('const complianceUnavailable') < P.indexOf('const kpiSet'),
    'kpiSet reads complianceUnavailable before it is declared');
});

test('the rows shown are one cadence, and the panel says so', () => {
  // The route filters on a single cadence, so the panel is always a SLICE.
  const at = POSITIONS.indexOf("r.get('/kpi-compliance'");
  const handler = POSITIONS.slice(at, POSITIONS.indexOf('\nr.', at + 20));
  assert.match(handler, /WHERE fund_id IS NULL AND cadence = \?/, 'the route no longer filters by cadence');

  // The cadence named on screen is the one the SERVER answered with. A
  // hard-coded word would keep saying "quarterly" after the request changed.
  assert.match(P, /const cadence = reads\.compliance\.value\?\.cadence \|\| 'quarterly';/,
    'the panel names a cadence the response did not state');
  const body = panel();
  assert.match(body, /at the \{cadence\} cadence/, 'the seam note no longer names which slice this is');
  assert.match(body, /Rules stored against another cadence are collected on that schedule and are not in this table/,
    'the panel presents one cadence as the whole rule set');
});

test('“Carried by” counts stored updates, and a blank arrival is not a carried figure', () => {
  const body = panel();
  // A key present with an empty value is the exact gap this column exists to
  // show. Counting it as carried would hide the thing being asked about.
  assert.match(body, /value !== undefined && value !== null && String\(value\)\.trim\(\) !== ''/,
    'a blank value now counts as a carried figure');
  // No denominator means no count — never zero out of zero.
  assert.match(P, /const storedUpdates = reads\.updates\.state !== 'ok' \? null : rows\.map\(\(row\) => row\.update\)\.filter\(Boolean\);/,
    'the denominator no longer distinguishes an unreadable update source');
  assert.match(body, /held === null \? <span className="pf-unreadable">Unavailable<\/span>/,
    'an unreadable update source is counted rather than labelled');
  // And it is not sold as compliance. Each row's update is the company's
  // latest, whatever period it speaks for.
  assert.match(body, /not compliance for the current period/,
    'the column is presented as a compliance rate the list cannot support');
});

test('the panel invents no value for an absent field', () => {
  const body = panel();
  // D56/D68: absent is "Not recorded" with a reason, never a plausible zero and
  // never an em-dash. `'—'` is how this page renders a blank value elsewhere;
  // it may not appear in a rule row.
  assert.ok(!body.includes('|| 0'), 'the panel defaults an absent figure to zero');
  assert.ok(!body.includes("'—'"), 'a rule row renders an em-dash instead of naming what is absent');
  assert.match(body, /rule\.unit \|\| 'Not recorded'/, 'an absent unit no longer reads as unrecorded');
  assert.match(body, /!rule\.applies_to \? 'Not recorded'/, 'an absent scope no longer reads as unrecorded');
  // A KPI with no stored wording is a company held to a figure without being
  // told how to compute it — which is worth naming, not blanking.
  assert.match(body, /The figure is asked for without a stated way to compute it/,
    'a rule with no stored wording renders blank');
  // `required` is an INTEGER: 0 is optional, NULL is unrecorded, and reading
  // NULL as 0 would report an unrecorded rule as an optional one.
  assert.match(body, /rule\.required == null \? 'Requirement not recorded' : Number\(rule\.required\) \? 'Required' : 'Optional'/,
    'an unrecorded requirement is reported as optional');
});

test('the three ops reasons are each true about their own object', () => {
  const row = ACTIONS.slice(ACTIONS.indexOf("'portfolio/updates': ["), ACTIONS.indexOf('],', ACTIONS.indexOf("'portfolio/updates': [")));

  // EDIT RULES stays unbuilt, and now for the right reason: the set exists and
  // has no writer, rather than not existing.
  // The needles stop at the closing quote rather than the closing brace: an
  // entry may now carry a `hover:` after its `unbuilt:` — the short line a
  // reader sees on the disabled control, where `unbuilt` is the engineering
  // reason kept in the table. What is asserted is the reason's content, which
  // is what this test has always been about.
  assert.match(row, /\{ label: 'Edit rules', unbuilt: '[^']*KPI set companies are held to is stored firm-wide and read-only here[^']*'/,
    'the Edit rules reason no longer names the set that is actually stored');
  assert.ok(!/'no reminder rules are stored'/.test(row), 'the reason that described a different object is back');
  // And it is genuinely unwritable: no route anywhere writes the table.
  const writers = [POSITIONS, UPDATES, RESEARCH].filter((src) => /INSERT INTO portfolio_kpi_definitions|UPDATE portfolio_kpi_definitions/.test(src));
  assert.equal(writers.length, 0, 'a write path for the KPI set now exists and Edit rules should be built');

  // CHASE IS LIVE NOW (D464, migration 337). The old reasons were right when
  // written — the only outbound on this desk fired when an update ARRIVED —
  // and the chase is the other direction: the page hands the route its own
  // overdue set, the route re-checks tenancy per id, logs one row per company
  // and notifies the founder. What is pinned is the wiring, not the reason.
  assert.match(row, /\{ label: 'Chase all overdue', kind: 'handler', handler: 'chaseOverdue', primary: true \}/,
    'the chase is not the page-performed op D464 made it');
  const PORTFOLIO = read('cloudflare-worker/src/routes/portfolio.ts');
  assert.match(PORTFOLIO, /portfolio_update_chases/, 'the chase log store is gone');
  assert.match(PORTFOLIO, /type: 'portfolio_update_chase'/, 'the founder notification is gone');
  assert.match(API, /portfolioChase: \(projectIds\) =>/, 'api.js lost the chase write');
  // The page chases its own overdue set and nothing else.
  assert.match(P, /const overdueRows = rows\.filter\(\(row\) => row\.reported === false\);/,
    'the overdue set is no longer the companies the reporting read says have not reported');
  assert.match(P, /api\.portfolioChase\(overdueRows\.map\(\(row\) => row\.projectId\)\)/,
    'Chase all overdue must hand the route the page’s own overdue set');
  // The founder-side fan-out is untouched by any of this.
  assert.match(UPDATES, /async function notifyProjectFollowers/, 'the follower fan-out the reason describes is gone');
  assert.match(UPDATES, /if \(f\.uid === update\.author_user_id\) continue;/, 'the fan-out no longer excludes the author');

  // No unbuilt reason may carry a path. Precise endpoints belong in route
  // docblocks, where they are maintained; in a button they rot silently.
  for (const reason of row.match(/(?:unbuilt|hover): '([^']*)'/g) || []) {
    assert.ok(!/(^|\s)\/[a-z]/.test(reason), `an ops reason carries a path: ${reason}`);
  }
});

test('the AI band mounts the half that has somewhere to land, and refuses the half that does not', () => {
  const shown = rendered();
  assert.match(shown, /surface="portfolio\/updates"/, 'the artboard’s AI band is not on the page');
  // The old card denied the whole band. Its replacement denies the extraction
  // half only, which is the half that has no store.
  assert.ok(!shown.includes('Parse review and editable proposals are unavailable.'),
    'the card refusing the whole band is back, and the band is mounted');

  const spec = surface();
  // THE ONE FAILURE MODE THE INSTRUCTION EXISTS FOR. Asked which figures are
  // missing, a model finds them in the narrative and an approximation a founder
  // hedged enters the record as a reported figure.
  const said = instruction();
  assert.match(said, /NEVER convert a phrase into a number/, 'the instruction no longer refuses the conversion');
  assert.match(said, /a team of ~12/, 'the instruction no longer names the case the artboard drew');
  // A blank is not a zero and not a denial, and absence is not lateness.
  assert.match(said, /It does not mean the company has none, it is not a zero/,
    'the instruction lets an absent KPI read as zero');
  assert.match(said, /never call anything late or overdue/, 'the instruction lets the model invent a deadline');
  assert.match(said, /do not forecast/, 'the instruction no longer refuses a forecast');

  // The gather is scoped the way every read in `routes/positions.ts` is, and
  // short-circuits an empty accessible set: the CSV predicate reads NULL as
  // "all rows", so `[]` reaching the query is a cross-tenant read.
  assert.match(spec, /if \(role !== 'admin' && !\(await heldLicences\(c\.env\.DB, \{ id: userId, role \}\)\)\.some\(licence => licence === 'partner' \|\| licence === 'investor'\)\) return \[\];/,
    'the gather no longer gates on the caller’s role');
  assert.match(spec, /if \(ids != null && ids\.length === 0\) return \[\];/,
    'an empty accessible set now reaches the query, which reads NULL as every row');
  assert.doesNotMatch(spec, /role:\s*'(admin|partner|investor)'/,
    'the gather hard-codes a role, which widens the scope past the caller');
  // Every cadence, unlike the page's own read — a draft asked what is missing
  // must see the whole of what was asked for.
  assert.match(spec, /WHERE fund_id IS NULL\s*\n\s*ORDER BY cadence, sort_order/,
    'the gather now filters the rule set to one cadence and would report a gap-free month');

  // The source-preservation boundary is stated without internal roadmap copy.
  const card = limits();
  assert.match(card, /Narrative text is kept as submitted and is not converted into KPI figures/,
    'the card no longer explains the source-preservation boundary');
  assert.doesNotMatch(card, /parse-review|proposal queue|#\d+|IP2/,
    'the card exposes internal working copy');
  assert.match(P, /<SummaryTile label="Source handling" value="Source-preserved"/,
    'the strip no longer explains how submitted updates are handled');
});

test('the strip, the instrument and the header row still match the artboard', () => {
  const board = ip2();
  // D4817 part 4 (#5311): the instrument is Portfolio v2's PF-04 obligations
  // table now (`Portfolio v2 Page.dc.html`, `reports()`), which replaces IP2's
  // head; the strip is the frame's tiles. IP2's header row still holds below.
  const PF = read('design/incoming/Portfolio v2 Page.dc.html');
  const at = PF.indexOf('const reports = (detail) =>');
  assert.ok(at > 0, 'the PF-04 board is gone from the Portfolio v2 canvas');
  const pf04 = PF.slice(at, PF.indexOf('</thead>', at));
  const columns = [...pf04.matchAll(/<th>([^<]+)<\/th>/g)].map((m) => m[1]);
  assert.deepEqual(columns, ['Company', 'Due', 'Received', 'Status', 'Missing', 'Last chase']);
  for (const col of columns) {
    assert.ok(P.includes(`<th scope="col">${col}</th>`), `the obligations inbox lost its ${col} column`);
  }
  for (const label of ['Received', 'Not received', 'Due date', 'Source handling']) {
    assert.ok(P.includes(`<SummaryTile label="${label}"`), `the strip lost its ${label} tile`);
  }
  // The header row's two halves, verbatim from the artboard.
  const filters = /filters: fil\(\[([^\]]*)\]/.exec(board);
  for (const label of filters[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter((label) => label !== 'Parse review')) {
    assert.ok(FILTERS.includes(`canvas: '${label}'`), `the filter table lost ${label}`);
  }
  assert.doesNotMatch(FILTERS, /canvas: 'Parse review'/, 'retired internal working copy returned');
  const ops = /ops:\[([^\]]*)\]/.exec(board);
  for (const label of ops[1].split(',').map((x) => x.trim().replace(/^'|'$/g, ''))) {
    assert.ok(ACTIONS.includes(`label: '${label}'`), `the ops row lost ${label}`);
  }
  // Task #150 asks for the eyebrow to go, as #95 already did for founder.
  assert.ok(!P.includes('i4-eyebrow'), 'the Portfolio / Updates eyebrow is back');
  // D1424 (#3700) drew the heading with the shared ZoneHeader; D4817 part 4
  // (#5311, PF-04) draws it in the Portfolio frame, the Reports tab current.
  assert.match(P, /<PortfolioFrame\s+tab="updates"/, 'Reports left the Portfolio frame');
  assert.doesNotMatch(P, /<ZoneHeader /, 'a second heading is drawn');
});
