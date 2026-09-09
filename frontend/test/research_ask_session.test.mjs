/**
 * Ask keeps what it answered — migration 221, and the four chips it turned on.
 *
 * WHY THIS FILE EXISTS. `research_zones.test.mjs` holds the SHAPE of the page:
 * three outcomes rendered differently, citations naming their passage, each
 * licence's own strip. This holds the CONTRACT underneath it — that a row is
 * written for every outcome, that the money on screen is the router's receipt
 * rather than this page's arithmetic, and that the four header chips select
 * something. Those are the claims that make the shape honest, and every one of
 * them spans the worker and the client.
 *
 * THE FAILURE THIS GUARDS AGAINST IS NOT A CRASH. It is a page that looks
 * exactly like this one and quietly stops writing the `no_source` row — at
 * which point `Unanswered` selects nothing, `No source` reads zero, and both
 * report "you have always been answered" over a library that has not been.
 * Absent read as empty is this product's central failure and the reason
 * `NoStoreYet`, `Unrecorded` and `ZoneBody` all exist; here it would wear a
 * number.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_ask_session.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const WORKER = read('cloudflare-worker/src/routes/research.ts');
const MIGRATION = read('cloudflare-worker/sql/migrations/221_research_ask_sessions.sql');
const API = codeOnly(read('frontend/src/lib/api.js'));
const ASK = codeOnly(read('frontend/src/pages/research/AskZone.jsx'));
const DRAFT = codeOnly(read('frontend/src/workspaces/ZoneDraft.jsx'));

/** The `/ask` handler, bounded at the next route declaration. */
function askHandler() {
  const start = WORKER.indexOf("research.post('/ask', async (c) => {");
  assert.notEqual(start, -1, 'the ask handler is gone');
  const after = WORKER.slice(start + 10);
  const next = after.search(/\nresearch\.(get|post|patch|delete)\(/);
  assert.ok(next > 0, 'the ask handler is not followed by another route');
  return WORKER.slice(start, start + 10 + next);
}

/**
 * The three `recordAnswer(c, session, { … })` argument objects, brace-balanced.
 *
 * PARSED RATHER THAN MATCHED, and two escaped mutations are why. Asserting
 * that `reason: 'model_unavailable'` appears SOMEWHERE in the handler passed
 * with the model-failure row rewritten to `no_source`, because the string
 * survived in the JSON RESPONSE below it. And asserting the no-source row
 * "carries an empty citation list" passed with a `cost_usd: 0.002` appended
 * after it. Both are the same mistake: a substring test cannot see the shape of
 * the thing it is testing.
 */
function recordedRows() {
  const h = askHandler();
  const rows = [];
  let at = h.indexOf('recordAnswer(c, session, {');
  while (at !== -1) {
    const open = h.indexOf('{', at);
    let depth = 0;
    for (let i = open; i < h.length; i += 1) {
      if (h[i] === '{') depth += 1;
      else if (h[i] === '}') {
        depth -= 1;
        if (depth === 0) { rows.push(h.slice(open + 1, i)); break; }
      }
    }
    at = h.indexOf('recordAnswer(c, session, {', at + 1);
  }
  return rows;
}

/**
 * The top-level keys of one such object, in order.
 *
 * Depth-aware split on commas, because a value may itself be an array, a call
 * or a nested object. Shorthand counts: `{ question, answer: null }` has two
 * keys, and reading only `key:` pairs silently drops the first — which is what
 * the first draft of this did.
 */
function keysOf(body) {
  const parts = [];
  let depth = 0, cur = '';
  for (const ch of body) {
    if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) depth -= 1;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => (x.startsWith('...') ? x : x.split(':')[0].trim()));
}

test('every outcome writes a row, and each writes its own reason', () => {
  const rows = recordedRows();
  // Three calls, one per outcome. Counted rather than matched once: the reason
  // to write the failures down is precisely that they are the rows a later
  // "cleanup" would drop as noise, and dropping either still leaves the happy
  // path writing.
  assert.equal(rows.length, 3, 'the ask handler no longer writes a row on all three outcomes');

  // THE THREE REASONS ARE DISTINCT, read off the calls themselves. A model
  // outage recorded as `no_source` would make `Unanswered` count outages as
  // library gaps and send the reader to upload a document that would not have
  // helped — the conflation this page's docblock has refused since it was
  // written, and one a substring search over the handler cannot see, because
  // the JSON response below carries the same words.
  const reasons = rows.map((r) => r.match(/reason: '([a-z_]+)'/)?.[1]);
  assert.deepEqual(reasons, ['no_source', 'model_unavailable', 'answered'],
    'the three stored outcomes are no longer three distinct reasons in the handler’s own order');
});

test('a question that never reached a model is stored as costing nothing', () => {
  const [noSource] = recordedRows();
  // THE WHOLE FIELD LIST, not a substring of it. No receipt is spread into this
  // row because no model ran — and appending a cost after the citation list is
  // exactly the mutation a "carries an empty citation list" assertion lets
  // through.
  assert.deepEqual(keysOf(noSource), ['question', 'answer', 'reason', 'best_score', 'citations'],
    'the no-source row writes a field it has no business writing — nothing ran, so nothing is charged');
  assert.match(noSource, /citations: \[\]/, 'the no-source row cites something');

  // The other two DO carry the receipt, spread from one object so the two
  // cannot report different money for the same run.
  const [, unavailable, answered] = recordedRows();
  for (const [name, body] of [['model_unavailable', unavailable], ['answered', answered]]) {
    assert.ok(keysOf(body).includes('...receipt'),
      `the ${name} row no longer carries the router's receipt`);
  }
  // And the response says so too: a zero the reader can see beside the count.
  assert.match(askHandler(), /cost_usd: 0,/, 'the no-source response no longer reports a zero charge');
});

test('the money on screen is the router’s receipt, never re-derived', () => {
  const h = askHandler();
  // `usage` comes off the run and is taken WHETHER OR NOT the answer arrived: a
  // model that ran and returned nothing still cost what it cost, and hiding
  // that would make this page's session total disagree with `ai_usage_logs` and
  // with the admin dashboard reading the same rows.
  assert.match(h, /usage = out\.usage \|\| null;/, 'the router’s usage is no longer captured');
  assert.match(h, /cost_usd: usage\?\.est_cost_usd \?\? 0,/,
    'the cost is no longer the router’s own estimate');
  // Nothing in the handler multiplies tokens by a price. A second calculation
  // is how a user is quoted one number and shown another — `ui/assistCost.js`
  // exists for that reason one layer up.
  assert.doesNotMatch(h, /1_000_000|1e6 \*|PRICE_USD/,
    'the handler is computing a cost instead of recording the one already charged');
});

test('the stored cost is an integer, and the API hands back dollars', () => {
  // `check-money-cents` refuses a REAL money column and its legacy list of 50
  // is closed. Cents would round a $0.0002 question to zero, so the unit is
  // micro-dollars — exact, integer, and converted once at the boundary.
  assert.match(MIGRATION, /cost_micro_usd\s+INTEGER NOT NULL DEFAULT 0/,
    'the cost column is no longer a micro-dollar integer');
  assert.doesNotMatch(MIGRATION, /cost_usd\s+REAL/, 'a float money column is back in the schema');
  assert.match(WORKER, /cost_usd: r\.cost_micro_usd \/ 1e6,/,
    'the API no longer converts the stored unit back to dollars');
  assert.match(WORKER, /Math\.round\(\(row\.cost_usd \?\? 0\) \* 1e6\)/,
    'the write no longer converts dollars into the stored unit');
});

test('every read is owner-scoped, and the API takes nobody else’s id', () => {
  // The same rule the rest of this file follows by construction. A session or
  // an answer belongs to the person who asked, and there is no cross-user read
  // anywhere in this feature.
  for (const q of [
    'FROM research_ask_sessions WHERE uid = ? AND owner_user_id = ?',
    'FROM research_ask_answers WHERE owner_user_id = ? AND saved = 1',
    'FROM research_ask_answers WHERE session_id = ? AND owner_user_id = ?',
  ]) {
    assert.ok(WORKER.includes(q), `an ask read lost its owner scope: ${q}`);
  }
  assert.match(WORKER, /UPDATE research_ask_answers SET saved = \? WHERE uid = \? AND owner_user_id = \?/,
    'the save toggle can be aimed at another account’s answer');
  // And the client cannot even express one.
  const block = API.slice(API.indexOf('research: {'), API.indexOf('\n  },', API.indexOf('research: {')));
  for (const banned of ['user_id', 'userId', 'owner']) {
    assert.ok(!block.includes(banned), `api.research takes a ${banned}`);
  }
});

test('the scope chips are three separate statements, not one with a fragment spliced in', () => {
  // `check-sql-prepare` refuses a `${…}` inside a prepared query even when the
  // value is a literal chosen by a ternary — and it was right to: the first
  // draft of this read spliced `' AND saved = 1'` in, and the next person to
  // add a fourth scope reaches for the same seam with a variable in hand.
  const listing = WORKER.slice(WORKER.indexOf("research.get('/ask/sessions'"), WORKER.indexOf("research.patch('/ask/answers/:uid'"));
  assert.ok(listing.length > 0, 'the sessions listing is gone');
  assert.doesNotMatch(listing, /\$\{[^}]*\}[^`]*`\s*\)\.bind/, 'an interpolation is back inside a prepared query');
  // COUNTED OVER THE BRANCHES, NOT THE HANDLER. The handler also resolves which
  // session to read before it reads anything, which is a fourth prepare and
  // nothing to do with the scopes — slicing at the `rows` declaration is what
  // keeps this counting the thing it names.
  const branches = listing.slice(listing.indexOf('let rows:'), listing.indexOf('const items ='));
  assert.ok(branches.length > 0, 'the scope branches are gone');
  assert.equal((branches.match(/DB\.prepare\(/g) || []).length, 3,
    'the three scopes are no longer three whole statements');
});

test('the four chips reach the two things they can be', () => {
  // A chip is either a different READ or a narrowing of the rows that came
  // back. `This session` and `All history` change the request; `Cited` and
  // `Unanswered` are predicates over whatever it returned — which is what keeps
  // `Cited` one chip rather than one per scope.
  assert.match(ASK, /const SCOPES = new Set\(\['session', 'all', 'saved'\]\)/,
    'the scope set is gone');
  assert.match(ASK, /cited: \(t\) => \(t\.citations \|\| \[\]\)\.length > 0,/,
    'the Cited chip no longer tests for citations');
  assert.match(ASK, /unanswered: \(t\) => t\.reason !== 'answered',/,
    'the Unanswered chip no longer tests the outcome');
  // The narrowing chips must NOT refetch: clicking `Cited` on a long history
  // and watching the page reload it is the same round trip twice for a filter
  // that runs on data already in hand.
  assert.match(ASK, /useEffect\(\(\) => \{ loadThread\(scope, ''\); \}, \[loadThread, scope\]\);/,
    'the thread refetches on a narrowing chip, not only on a scope change');
});

test('the metered rate is read from the pricing endpoint, never typed', () => {
  // D13/D16, and `railModels.js` states the rule: a model's name, id and rate
  // are FACTS and come from `GET /api/ai/pricing`, which reads the router's own
  // tables. The artboard quotes `$0.440 / M in · $0.014 cached` for DeepSeek —
  // a model this product does not run — so transcribing it would put another
  // vendor's price list under our model's work.
  assert.match(ASK, /api\.aiPricing\(\)/, 'the page no longer reads the published price list');
  assert.match(ASK, /pricing\?\.routes\?\.research_ask\?\.model/,
    'the rate is no longer looked up by the task this page actually runs');
  // THROUGH A JSX-COMMENT STRIP, and that is not a loophole — it is the same
  // reason `_codeOnly.mjs` exists. `codeOnly` deliberately KEEPS indented
  // `{/* */}` blocks, and the comment above the ask bar quotes the artboard's
  // own "≈ $0.005 per question" precisely to explain why the page does not
  // render it. Banning the string outright bans the explanation rather than the
  // behaviour, which is the mistake `research_canvas_strips.test.mjs` records
  // making twice.
  const rendered = ASK.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  for (const literal of ['0.440', '0.014', '1.320', '$0.005 per question']) {
    assert.ok(!rendered.includes(literal), `the artboard's ${literal} has been transcribed as a rate`);
  }
  // And the strip really did remove something, or the four bans above are
  // passing over an empty string.
  assert.ok(rendered.length > 0 && rendered.length < ASK.length,
    'the JSX-comment strip removed nothing, so these bans are not reading the page');
});

test('the AI band never runs on mount, and its surfaces are allow-listed', () => {
  // A component that drafted on render would spend a reader's budget for
  // visiting a page — `ValidateProposals` states the same rule for the
  // founder's copy of this band.
  assert.match(DRAFT, /useEffect\(\(\) => \{ load\(\); \}, \[load\]\);/,
    'the band no longer loads exactly once');
  const load = DRAFT.slice(DRAFT.indexOf('const load = useCallback'), DRAFT.indexOf('const doRun ='));
  assert.match(load, /api\.research\.zoneDrafts\(surface\)/, 'the band’s read is gone');
  assert.doesNotMatch(load, /zoneDraftRun/, 'the band drafts on mount, spending a budget for a page view');

  // ── THE ALLOW-LIST AND THE MOUNTS ARE ONE SET, CHECKED BOTH WAYS ─────────
  //
  // THIS ASSERTION USED TO PIN A COUNT — "the allow-list is one entry long
  // while one band is mounted" — and the count was right on the day and then
  // wrong for five zones. `ZoneDraft` shipped on Library, Client prep, Market
  // and Relationships while `DRAFT_SURFACES` still held only `research/ask`, so
  // `GET /drafts` 400'd, the band caught the error and rendered its empty
  // state, and four pages showed an AI band whose run button did nothing. A
  // number cannot notice that; the two lists compared can.
  //
  // Both directions matter and they fail differently. A surface with no mount
  // is config for a page that cannot spend it — the failure
  // `ui_assist_rail_and_sidebar` catches on the rail. A mount with no surface
  // is a control that 400s in silence, which is worse, because the page looks
  // finished.
  const surfaces = WORKER.slice(WORKER.indexOf('const DRAFT_SURFACES'), WORKER.indexOf("research.get('/drafts'"));
  const allowed = (surfaces.match(/^ {2}'[a-z/-]+': \{$/gm) || [])
    .map((s) => s.trim().replace(/^'|': \{$/g, '')).sort();
  assert.ok(allowed.includes('research/ask'), 'the ask surface is gone from the allow-list');

  // Scoped to `<ZoneDraft …/>` elements, not to every `surface=` prop in the
  // tree: `WorkerRail` and the assist registrations take a prop of the same
  // name over a different vocabulary (`app`, `brand`, `advisory`), and reading
  // those as draft surfaces compares two unrelated lists.
  const files = execFileSync('grep', ['-rl', '<ZoneDraft', 'frontend/src'], { encoding: 'utf8' })
    .split('\n').filter(Boolean);
  const mounted = [...new Set(files.flatMap((f) => {
    const src = codeOnly(read(f));
    return src.split('<ZoneDraft').slice(1)
      .map((seg) => seg.slice(0, seg.indexOf('/>')).match(/surface="([a-z/-]+)"/)?.[1])
      .filter(Boolean);
  }))].sort();
  assert.ok(mounted.length >= 6, `expected the band to be mounted on the artboards; found ${mounted.length}`);
  assert.deepEqual(allowed, mounted,
    'the worker’s draft surfaces and the pages that mount a band have diverged: '
    + `allow-listed ${JSON.stringify(allowed)}, mounted ${JSON.stringify(mounted)}`);

  assert.match(WORKER, /if \(!spec\) return c\.json\(\{ detail: 'unknown_surface' \}, 400\);/,
    'an unknown surface is no longer refused');
});

test('a draft over nothing is refused rather than written from general knowledge', () => {
  // The same refusal `/ask` makes by retrieving first. A brief over an empty
  // session would be written from the model's own knowledge in exactly the
  // voice a grounded one uses, which is the single worst thing a research
  // surface can do and the reason D9/D12 withdrew four tabs.
  const post = WORKER.slice(WORKER.indexOf("research.post('/drafts'"), WORKER.indexOf("research.patch('/drafts/:uid'"));
  assert.match(post, /if \(!material\.length\) return c\.json\(\{ detail: 'nothing_to_draft' \}, 409\);/,
    'a draft with nothing to read now reaches the model');
  const gatherEnd = WORKER.indexOf('const material = await spec.gather');
  assert.ok(WORKER.indexOf('runAI(c.env, {\n      task: \'workspace_explain\'') > gatherEnd,
    'the model is called before the material is gathered');
  // An unanswered question is INCLUDED in what the brief reads, and marked. A
  // brief drafted only from the answers reads as though the session answered
  // everything it was asked.
  assert.match(WORKER, /\(no retrievable source — unanswered\)/,
    'the brief no longer sees the questions that went unanswered');
});
