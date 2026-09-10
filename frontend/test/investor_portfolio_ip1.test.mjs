/**
 * Portfolio · Positions — canvas **IP1**, `/portfolio/positions`.
 *
 * WHAT THIS FILE GUARDS. Unlike the four Deals zones, IP1 already drew most of
 * its artboard: the four-up strip and all seven instrument columns were there
 * and correct. What was wrong was a claim, and the claim was on the screen.
 *
 * THE FINDING. `investorZoneActions` marked `Mark history` unbuilt because
 * "only the current mark is stored; there is no history to open", and the page
 * carried a card repeating it — "History remains read-only on this collection".
 * Both were false, and the second more so than the first:
 *
 *   `portfolio_marks` is a HISTORY table. One row per marking event, each with
 *   the `as_of_date` it speaks for, the `event` behind it, the `basis` it was
 *   arrived at on and free-text `source` provenance.
 *
 *   `GET /positions/:projectUid` was ALREADY RETURNING that history, to the
 *   same `canViewLpData` readers who were looking at the disabled button.
 *
 * So the store existed AND the read existed AND the reader was entitled. The
 * only thing missing was the control. That is why the assertions below check
 * the SCHEMA and the EXISTING ROUTE rather than matching the new sentence — a
 * sentence can be rewritten without any of those three facts changing.
 *
 * THE BASIS COLUMN IS WHY THE HISTORY MATTERS, and it is the one thing here
 * that a well-meaning simplification would drop. `basis` is
 * `round_price | secondary | gp_estimate | write_down | cost`, and the schema's
 * own comment says why: "a round-priced mark and a GP estimate must never look
 * alike to an LP". A NULL basis therefore renders as unrecorded, never as the
 * column's default.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = read('frontend/src/pages/investor/InvestorPortfolioPositions.jsx');
const P = codeOnly(PAGE);
const POSITIONS = read('cloudflare-worker/src/routes/positions.ts');
const RESEARCH = read('cloudflare-worker/src/routes/research.ts');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const ACTIONS = read('frontend/src/workspaces/investorZoneActions.js');
const API = read('frontend/src/lib/api.js');
const CANVAS = read('design/canvases/integrated/Pages · Investor Portfolio.dc.html');

/**
 * The page with its JSX comments removed — what a reader actually sees.
 *
 * `codeOnly` strips `//` and block comments but not `{/* … *​/}`, and the
 * replacement card deliberately QUOTES the claim it replaced so the next reader
 * knows what was wrong. A raw-text search reads that quote as the defect
 * returning: the same trap ID1 hit with a fixture figure in a docblock, ID3 hit
 * twice, and ID4 hit on its own limits block.
 */
function rendered() {
  return P.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

/** The `MarkHistory` component body alone, bounded by the next declaration. */
function panel() {
  const a = P.indexOf('function MarkHistory(');
  assert.ok(a > 0, 'the mark-history panel is gone');
  const b = P.indexOf('\nfunction ', a + 20);
  return P.slice(a, b > a ? b : P.length);
}

/** The IP1 fixture object alone, bounded at both ends. */
function ip1() {
  const a = CANVAS.indexOf("id:'ip1'");
  assert.ok(a >= 0, 'the IP1 artboard is gone from the canvas');
  const b = CANVAS.indexOf("id:'ip2'", a);
  assert.ok(b > a, 'IP2 no longer follows IP1 — this slice would run past the artboard');
  return CANVAS.slice(a, b);
}

test('portfolio_marks is a history table, which is the premise of everything below', () => {
  // THE SCHEMA FIRST. If the store ever collapses to one row per project, the
  // old reason becomes true again and these guards should fail loudly rather
  // than keep asserting a control over nothing.
  const a = BASELINE.indexOf('CREATE TABLE portfolio_marks');
  assert.ok(a > 0, 'portfolio_marks is gone');
  const ddl = BASELINE.slice(a, BASELINE.indexOf(');', a));
  for (const col of ['as_of_date', 'fmv', 'event', 'basis', 'source']) {
    assert.match(ddl, new RegExp(`\\b${col}\\b`), `portfolio_marks lost ${col}`);
  }
  // No UNIQUE on project_id — that is what makes it a history rather than a
  // current-value row, and it is the exact fact the old reason denied.
  assert.doesNotMatch(ddl, /UNIQUE\s*\(\s*project_id\s*\)/,
    'portfolio_marks now holds one row per project, so the old reason would be true');
  // And the five values the basis column accepts, from its own comment.
  for (const basis of ['round_price', 'secondary', 'gp_estimate', 'write_down', 'cost']) {
    assert.ok(ddl.includes(basis), `the basis vocabulary lost ${basis}`);
  }
});

test('the history was already served to this reader before the button existed', () => {
  // The second half of the finding, and the more damning one: no new access is
  // granted here. `GET /positions/:projectUid` returns the same rows under the
  // same gate, and did so while the control said there was nothing to open.
  const at = POSITIONS.indexOf("r.get('/:projectUid'");
  assert.ok(at > 0, 'the per-project read is gone');
  const handler = POSITIONS.slice(at, POSITIONS.indexOf('\nr.', at + 20));
  assert.match(handler, /canViewLpData\(user\)/, 'the per-project read changed its gate');
  assert.match(handler, /FROM portfolio_marks WHERE project_id = \?/,
    'the per-project read no longer returns the mark history');
  assert.match(handler, /as_of_date, fmv, post_money, event, basis, source, note/,
    'the per-project read stopped returning the columns this panel shows');
});

test('the ops row opens it instead of denying it, and the follow-on reason is corrected', () => {
  const at = ACTIONS.indexOf("'portfolio/positions': [");
  assert.ok(at >= 0, 'the positions ops row is gone');
  const row = ACTIONS.slice(at, ACTIONS.indexOf('],', at));
  assert.match(row, /\{ label: 'Mark history', kind: 'handler', handler: 'markHistory' \}/,
    'Mark history is not a page-supplied control');
  const reasons = [...row.matchAll(/unbuilt: '([^']*)'/g)].map((m) => m[1]);
  for (const reason of reasons) {
    assert.doesNotMatch(reason, /only the current mark is stored/, 'the false reason is back');
    assert.doesNotMatch(reason, /follow-ons are recorded on the deal/,
      'the follow-on reason with the modelling backwards is back');
    assert.doesNotMatch(reason, /(^|\s)\/[a-z]/, `an unbuilt reason carries an unchecked path: "${reason}"`);
  }
  // A follow-on IS a ledger row; what stops the button is the write's gate.
  assert.match(BASELINE, /CREATE TABLE portfolio_positions[\s\S]{0,400}round_name/,
    'portfolio_positions lost round_name, which the corrected reason rests on');
  const create = POSITIONS.slice(POSITIONS.indexOf("r.post('/', async"), POSITIONS.indexOf("r.put('/:uid'"));
  assert.match(create, /requireAdmin\(c\)/, 'creating a position is no longer admin-only');
  assert.match(create, /INSERT INTO portfolio_positions/);
  assert.match(row, /recording one is an admin write/);
});

test('mark history action is user-visible: it requests marks and renders rows, empty, and error states', async () => {
  // Keep static guardrails that prevent silent action-drop regressions.
  assert.match(P, /handlers: \{ markHistory \}/,
    'the handler is not passed under `handlers`, so the builder drops the op');
  assert.match(P, /const markHistory = useCallback\(/);
  assert.match(API, /positionsMarkHistory: \(\) => request\('\/positions\/marks'\)/);
  assert.ok(POSITIONS.indexOf("r.get('/marks'") < POSITIONS.indexOf("r.get('/:projectUid'"),
    'the marks route is registered after /:projectUid, so it is unreachable');

  // Behavioral coverage requirement:
  // - open Mark history from the action surface
  // - verify marks request is made
  // - verify returned rows render
  // - verify empty-state and error-state are user-visible
  //
  // NOTE: Implement with this repo's existing component test helpers/render stack.
  // This test intentionally fails until wired to real render/mocks.
  assert.fail('TODO: add component-level Mark history behavioral test (request + rows + empty + error states)');
});

test('an empty accessible set reads as empty, never as every row', () => {
  // The CSV predicate treats NULL as "all rows", so `[]` MUST short-circuit.
  // Getting this wrong is a cross-tenant leak that looks like a working page.
  const at = POSITIONS.indexOf("r.get('/marks'");
  const handler = POSITIONS.slice(at, POSITIONS.indexOf('\nr.', at + 20));
  assert.match(handler, /canViewLpData\(user\)/, 'the marks route lost its gate');
  assert.match(handler, /investorProjectIds\(/, 'the marks route is not scoped');
  assert.match(handler, /projectIds != null && projectIds\.length === 0/,
    'an empty accessible set is not short-circuited, so it would read as unscoped');
  const guardAt = handler.indexOf('projectIds.length === 0');
  assert.ok(guardAt > 0 && guardAt < handler.indexOf('FROM portfolio_marks'),
    'the empty-set guard runs after the query rather than before it');
  // Same short-circuit in the AI gather, for the same reason.
  const sAt = RESEARCH.indexOf("'portfolio/positions': {");
  assert.ok(sAt >= 0, 'the surface is not allow-listed, so the band 400s');
  const surface = RESEARCH.slice(sAt, RESEARCH.indexOf('\n  },', sAt));
  assert.match(surface, /if \(ids != null && ids\.length === 0\) return \[\];/,
    'the gather would read every firm’s marks for a caller with no accessible book');
  // AND IT REFUSES AN UNPRIVILEGED CALLER BEFORE IT READS. The short-circuit
  // above only handles an empty book; without this, any signed-in role reaches
  // the marks of whatever `investorProjectIds` resolves for them.
  assert.match(surface, /role !== 'admin' && role !== 'partner' && role !== 'investor'/,
    'the gather no longer refuses an unprivileged caller');
  const gate = surface.indexOf("role !== 'admin'");
  assert.ok(gate > 0 && gate < surface.indexOf('investorProjectIds'),
    'the role check runs after the scope is resolved rather than before it');
  assert.doesNotMatch(surface, /role:\s*'(admin|partner|investor)'/,
    'the gather hard-codes a role, which widens the scope past the caller');
});

test('a mark with no basis is unrecorded, never the column’s default', () => {
  const at = POSITIONS.indexOf("r.get('/marks'");
  const handler = POSITIONS.slice(at, POSITIONS.indexOf('\nr.', at + 20));
  assert.match(handler, /basis: m\.basis \?\? null,/, 'the route defaults an absent basis');
  assert.ok(!/basis:\s*m\.basis\s*\|\|\s*'gp_estimate'/.test(handler),
    'an absent basis is reported as a GP estimate, which invents the provenance');
  assert.match(P, /m\.basis \? title\(m\.basis\) : 'Not recorded'/,
    'the panel renders an absent basis as something other than unrecorded');
  // And the AI instruction refuses the same substitution.
  const surface = RESEARCH.slice(RESEARCH.indexOf("'portfolio/positions': {"),
    RESEARCH.indexOf('\n  },', RESEARCH.indexOf("'portfolio/positions': {")));
  assert.match(surface, /basis is UNRECORDED has no stated provenance/);
});

test('the panel tells an empty history apart from an unreadable one', () => {
  // On a valuation page these are different facts, and a single empty table
  // reports the second as the first.
  const body = panel();
  assert.match(body, /data-testid="ip1-mark-history-error"/, 'an unreadable history has no distinct state');
  assert.match(body, /not a claim that the book has no marks/);
  assert.match(body, /No marking event is recorded against an accessible position\. The book carries positions at cost until one is\./,
    'the panel’s empty state no longer explains what an empty history means');
  assert.match(body, /state\.loading/, 'the panel has no in-flight state');
  // Closing resets to null so a reopen re-reads rather than showing a stale book.
  assert.match(P, /if \(current !== null\) return null;/);
});

test('the false card is gone and the eyebrow with it', () => {
  // The card asserted the opposite of the store. Its replacement says the true
  // narrower thing — the WRITES are elsewhere — rather than denying the read.
  const shown = rendered();
  assert.ok(!shown.includes('History remains read-only on this collection'),
    'the card asserting there is no history is back');
  assert.ok(!/IP1 does not export positions, write marks/.test(shown),
    'the card refusing the AI narrative is back, and the band is mounted');
  // And the band it refused is actually mounted.
  assert.match(shown, /surface="portfolio\/positions"/, 'the artboard’s AI band is not on the page');
  assert.match(P, /Every valuation and ownership write is an admin action/);
  // Task #150 asks for the eyebrow to go, as #95 already did for founder.
  assert.ok(!P.includes('i4-eyebrow'), 'the Portfolio / Positions eyebrow is back');
  assert.match(P, /<h1>Positions book<\/h1>/, 'the heading went with the eyebrow');
});

test('the strip and the instrument still match the artboard, column for column', () => {
  const board = ip1();
  const head = /head:\[([^\]]*)\]/.exec(board);
  assert.ok(head, 'the IP1 artboard no longer declares an instrument head');
  const columns = head[1].split(',').map((x) => x.trim().replace(/^'|'$/g, ''));
  assert.deepEqual(columns, ['Company', 'Stage', 'Invested', 'FMV', 'Multiple', 'Health', 'Last update']);
  for (const col of columns) {
    assert.ok(P.includes(`<th>${col}</th>`), `the positions table lost its ${col} column`);
  }
  // The artboard's own four tiles.
  for (const label of ['Invested', 'Current FMV', 'TVPI', 'Needs attention']) {
    assert.ok(P.includes(`label="${label}`), `the strip lost its ${label} tile`);
  }
  // TVPI and DPI are reported separately — the artboard's note is explicit that
  // an unrealised multiple is a mark and a realised one is cash.
  assert.match(board, /reported separately rather than blended/);
  assert.match(P, /DPI \$\{ratio\(state\.analytics\?\.dpi\)\}/,
    'DPI is no longer reported beside TVPI');
  const surface = RESEARCH.slice(RESEARCH.indexOf("'portfolio/positions': {"),
    RESEARCH.indexOf('\n  },', RESEARCH.indexOf("'portfolio/positions': {")));
  assert.match(surface, /Never blend an unrealised multiple with a realised one/);
  assert.match(surface, /never call the change momentum or a trend/);
});
