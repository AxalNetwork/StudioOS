/**
 * Accepting a proposal and typing the same thing must produce the same row.
 *
 * The dispatch in `routes/founder_validate.ts` was `if (row.kind === 'pain_tag')`
 * — two branches in a file about Validate, which is fine for two kinds and the
 * wrong place for a third. `services/fills/registry.ts` holds one entry per kind
 * now, and this file asserts the invariant that move had to preserve.
 *
 * WHY IT IS THE FIRST THING TO CHECK. `insertHypothesis` allocates `H1, H2 …`
 * from `MAX(CAST(substr(code,2) AS INTEGER))` over every code the project has
 * ever used, so a retired `H2` is never reissued. A registry entry that wrote its
 * own INSERT instead of calling it would start handing out duplicate codes — not
 * loudly, and not to the person who wrote the entry, but to a founder reading a
 * board pack with two claims called H3. D46 states the rule; nothing enforced it.
 *
 * RUN, NOT READ, wherever running is possible. The `apply` of each kind is called
 * against real SQLite and the row it produces is compared against the row the
 * MANUAL writer produces from the same input — which is the only comparison that
 * actually proves "the same row".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FILL_KINDS, FILL_SURFACES, fillKind, kindsForSurface } from '../src/services/fills/registry.ts';
import { FILL_CLASSES, isFillClass, refuseReason } from '../src/services/fills/types.ts';
import { ASSUMPTION_COLUMNS } from '../src/services/marketAssumptions.ts';
import { insertHypothesis, upsertPainAlias } from '../src/routes/_founder_validate_writes.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(HERE, '..', p), 'utf8');

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first(col?: string) {
          const r = db.prepare(sql).get(...b) ?? null;
          return col === undefined ? r : ((r as any)?.[col] ?? null);
        },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const out = []; for (const st of x || []) out.push(await st.run().catch(() => ({}))); return out; },
  };
}

const SQL = resolve(HERE, '../sql');

/**
 * The DDL, FROM THE MIGRATION, never hand-copied.
 *
 * A fixture typed out by hand is a second schema, and it drifts silently: the
 * first version of this file invented a `pain_group_aliases` with
 * `pain_group_id` and `phrase` columns, and every assertion about "the same row"
 * was then comparing rows in a table the product does not have. Reading 106 and
 * 211 means a column rename breaks this test instead of passing it.
 *
 * Closes on `\n);` rather than the first `);` because these DDLs carry prose
 * comments, and a comment mentioning a parenthesis would otherwise truncate the
 * table mid-column.
 */
function tableFromMigration(name: string, table: string): string {
  const src = readFileSync(`${SQL}/migrations/${name}.sql`, 'utf8');
  const at = src.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`);
  assert.ok(at >= 0, `${table} is no longer created by migration ${name}`);
  const end = src.indexOf('\n);', at);
  assert.ok(end > at, `${table}'s DDL in ${name} does not close the way this reader expects`);
  return `${src.slice(at, end)}\n);`;
}

/**
 * The same, for an index — the upsert's ON CONFLICT target is part of the shape.
 *
 * THE MIGRATION'S INDEX NAMES ARE READ ONCE WITH A LITERAL PATTERN and then
 * looked up. Semgrep's `detect-non-literal-regexp` flagged the `new RegExp` this
 * built from `index` (alert 6087) and the rule is right — a regex compiled from a
 * variable is worth avoiding even where the variable is a literal in this file.
 * Parsing the whole file's `CREATE INDEX` names into a map also handles the
 * `UNIQUE` variant and any whitespace without an alternation to get wrong, and it
 * keeps the word-boundary the old pattern needed: `idx_foo` can no longer be
 * found by asking for `idx_foobar`, because the capture is the whole name.
 */
function indexFromMigration(name: string, index: string): string {
  const src = readFileSync(`${SQL}/migrations/${name}.sql`, 'utf8');
  const starts = new Map<string, number>();
  for (const m of src.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+([A-Za-z_][\w]*)/g)) {
    if (!starts.has(m[1])) starts.set(m[1], m.index ?? -1);
  }
  const at = starts.get(index) ?? -1;
  assert.ok(at >= 0, `${index} is no longer created by migration ${name}`);
  return src.slice(at, src.indexOf(';', at) + 1);
}

const P = 7001;
const OTHER_P = 7002;

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(`
    ${tableFromMigration('211_founder_validate_evidence', 'hypotheses')}
    -- The code allocation is what this file is mostly about, and this index is
    -- what would catch a second allocator handing out a duplicate. A fixture
    -- without it would let the bug through and still pass.
    ${indexFromMigration('211_founder_validate_evidence', 'idx_hypotheses_project_code')}
    ${tableFromMigration('106_pain_groups', 'pain_groups')}
    ${tableFromMigration('106_pain_groups', 'pain_group_aliases')}
    -- THE UNIQUE INDEX IS PART OF THE SHAPE, not decoration: upsertPainAlias
    -- is an ON CONFLICT upsert against exactly this index, and without it the
    -- upsert is a plain insert that would let one phrase sit in two themes.
    ${indexFromMigration('106_pain_groups', 'idx_pain_group_aliases_project_phrase')}
  `);
  db.prepare('INSERT INTO pain_groups (id, project_id, title) VALUES (?,?,?)').run(11, P, 'Onboarding drags');
  db.prepare('INSERT INTO pain_groups (id, project_id, title) VALUES (?,?,?)').run(12, OTHER_P, 'Theirs');
  seedCodeHistory(db);
  return db;
}

/**
 * A project whose codes are NOT a dense 1..n sequence — and the reason the
 * invariant test is worth running.
 *
 * An empty `hypotheses` table cannot tell the real allocator from a wrong one:
 * with no history, `MAX(CAST(substr(code,2)))` and `COUNT(*) + 1` both say 1, so
 * a registry entry that reimplemented the rule passed this file's headline test.
 * That escape is what this seed closes. Four rows, each pinning one clause of
 * `insertHypothesis`:
 *
 *   H1  live                 the ordinary case
 *   H6  RETIRED              the highest code ever used, on a retired row. An
 *                            allocator that counted or maxed over live rows only
 *                            would reissue a code a founder has already written
 *                            down — the exact thing the comment in
 *                            `_founder_validate_writes.ts` warns about.
 *   H2  live                 a gap above it, so a count is never the maximum
 *   X9  live                 a hand-edited code, which `GLOB 'H*'` must exclude;
 *                            without the GLOB the 9 becomes the maximum.
 *
 * The next code is H7, and each of the four plausible wrong rules gives a
 * different answer: COUNT(*) → H5, live count → H4, MAX over live → H3, MAX
 * without the GLOB → H10.
 */
const NEXT_CODE = 'H7';
function seedCodeHistory(db: InstanceType<typeof DatabaseSync>) {
  const ins = db.prepare(
    'INSERT INTO hypotheses (project_id, code, claim, sort_order, retired_at) VALUES (?,?,?,?,?)',
  );
  ins.run(P, 'H1', 'Buyers will pay for a shorter close', 1, null);
  ins.run(P, 'H6', 'A claim the founder retired after three interviews', 2, '2026-08-01T00:00:00Z');
  ins.run(P, 'H2', 'Procurement is the gate, not the budget', 3, null);
  ins.run(P, 'X9', 'A code somebody typed by hand', 4, null);
}
const env = (db: InstanceType<typeof DatabaseSync>) => ({ DB: makeD1(db) }) as any;
const ctx = (db: InstanceType<typeof DatabaseSync>, projectId = P) =>
  ({ env: env(db), user: { id: 3, role: 'founder' } as any, projectId });

test('every kind is registered under its own surface, and nothing else slipped in', () => {
  assert.deepEqual(Object.keys(FILL_KINDS).sort(),
    ['competitor', 'hypothesis', 'market_input', 'pain_tag']);
  assert.deepEqual([...FILL_SURFACES].sort(),
    ['market/competitors', 'market/sizing', 'validate/hypotheses', 'validate/pain-map']);
  assert.equal(fillKind('pain_tag')?.surface, 'validate/pain-map');
  assert.equal(fillKind('market_input')?.surface, 'market/sizing');
  assert.equal(fillKind('nope'), null, 'an unknown kind must resolve to null, not undefined-shaped');
  assert.equal(kindsForSurface('validate/pain-map').length, 1);
  assert.equal(kindsForSurface('brand/positioning').length, 0,
    'a surface with no entry must offer nothing');
  // Two namespaces, and the ids in them must not be confused: a surface is an
  // address for a blank, and a kind is what fills it.
  for (const k of Object.values(FILL_KINDS)) {
    assert.notEqual(k.kind, k.surface, `${k.kind} uses one id for both its kind and its surface`);
  }
});

test('every kind names a rail that exists and declares a mode — D17', () => {
  // D17 refused a mode toggle "until a page branches on the mode", because a
  // switch that changes nothing is a control that cannot affect the product. The
  // mirror image is what this checks: a fill whose rail has no `mode` entry is a
  // CAPABILITY WITH NO SWITCH — it would run with no way to turn it off, and
  // `manualNote`'s promise that nothing runs and nothing is spent would be false
  // on that page.
  const config = readFileSync(resolve(HERE, '../../frontend/src/ui/eadwynConfig.js'), 'utf8');
  for (const k of Object.values(FILL_KINDS)) {
    const at = config.indexOf(`\n  ${k.assistSurface}: {`);
    assert.ok(at > 0, `eadwynConfig has no ASSIST_SURFACES entry called ${k.assistSurface}`);
    const entry = config.slice(at, config.indexOf('\n  },', at));
    assert.match(entry, /mode: \{/,
      `${k.assistSurface} offers ${k.kind} with no mode entry, so it cannot be turned off`);
    assert.match(entry, /kind: 'choice'/, `${k.assistSurface}'s mode is not a real choice`);
    assert.match(entry, /manualNote:/,
      `${k.assistSurface} says what ON does and not what OFF means`);
  }
});

test('every kind has a host that mounts its band — the other half of D17', () => {
  // THE GAP THE TEST ABOVE DOES NOT CLOSE, and it was open for one commit. A
  // `mode` entry makes the switch RENDERABLE; it does not make anything happen
  // when it is flipped. Declaring the market mode without mounting the band left
  // a switch a founder could turn on to no effect — the dead control D17 refused,
  // reached from the opposite direction: config that arrived before its mount.
  //
  // So this asserts the mount, not the config: some page reads the same mode key
  // the rail writes, and passes the kind to the band.
  const hosts = [
    'frontend/src/workspaces/founder/FounderValidateWorkspace.jsx',
    'frontend/src/pages/founder/FounderValidatePage.jsx',
    'frontend/src/pages/SpinoutLabMarketPage.jsx',
  ].map((p) => readFileSync(resolve(HERE, '../..', p), 'utf8')).join('\n');

  for (const k of Object.values(FILL_KINDS)) {
    assert.ok(hosts.includes(`kind="${k.kind}"`),
      `${k.kind} is registered and no page offers it, so the switch does nothing`);
  }
  // And both sides read ONE mode store, so flipping the switch cannot leave the
  // page as it was — the reason `useAssistMode` is a module store at all.
  assert.match(hosts, /useAssistMode\('market'\)/);
  const layout = readFileSync(resolve(HERE, '../../frontend/src/ui/AssistLayout.jsx'), 'utf8');
  assert.match(layout, /const \[mode, setMode\] = useAssistMode\(surface\);/,
    'AssistLayout draws a rail whose switch has nothing behind it');
  assert.match(layout, /mode=\{mode\}\s*\n\s*onModeChange=\{setMode\}/,
    'the rail is given no way to change the mode it renders');
});

test('every entry declares a class the store admits and a task the router knows', () => {
  const router = read('src/services/aiRouter.ts');
  for (const k of Object.values(FILL_KINDS)) {
    assert.ok(isFillClass(k.fillClass), `${k.kind} declares an unknown fill class`);
    assert.ok(FILL_CLASSES.includes(k.fillClass));
    // A task with no `alternates` makes the rail's model menu a control that
    // cannot be used: `run()` refuses every `opts.model` outright, the primary
    // included. So a kind whose task is model-pickable must say so in ROUTE.
    assert.ok(router.includes(`${k.task}: {`), `aiRouter declares no route for ${k.task}`);
    const entry = router.slice(router.indexOf(`${k.task}: {`), router.indexOf('}', router.indexOf(`${k.task}: {`)));
    assert.match(entry, /alternates:/, `${k.task} declares no alternates, so no model can be chosen for it`);
    assert.ok(k.prompt.length > 80, `${k.kind}'s prompt is too short to constrain anything`);
    assert.ok(k.copy.run && k.copy.heading && k.copy.empty && k.copy.accept,
      `${k.kind} is missing band copy, so the surface would invent its own`);
  }
});

test('a restatement writes the same row the manual form writes', async () => {
  // THE INVARIANT. Two databases, the same input: one through the registry's
  // `apply`, one through the writer the manual route calls. The rows must be
  // identical in every column but the id.
  const viaFill = freshDb();
  const viaForm = freshDb();
  const claim = 'Buyers delay because onboarding takes three weeks';

  await fillKind('hypothesis')!.apply(ctx(viaFill), { claim }, 'hypotheses');
  await insertHypothesis(env(viaForm), P, claim);

  // `id` and the two timestamps are the only columns allowed to differ: the id
  // because they are separate databases, the timestamps because the two writes
  // are microseconds apart and could straddle a second boundary. Everything else
  // — code, claim, sort_order, retired_at — has to match.
  const strip = (r: any) => ({ ...r, id: undefined, created_at: undefined, updated_at: undefined });
  const last = (db: InstanceType<typeof DatabaseSync>) =>
    db.prepare('SELECT * FROM hypotheses WHERE project_id = ? ORDER BY id DESC LIMIT 1').get(P) as any;
  const a = last(viaFill);
  const b = last(viaForm);
  assert.deepEqual(strip(a), strip(b), 'accepting and typing produce different rows');

  // AND IT IS THE SAME ALLOCATION, not merely the same as itself. Two writers
  // that are both wrong the same way would satisfy the comparison above, so the
  // code is pinned to the rule: highest ever used over `GLOB 'H*'`, retired rows
  // included. See `seedCodeHistory` for what each of the four seeded rows catches.
  assert.equal(a.code, NEXT_CODE, 'the code allocation is no longer the one insertHypothesis makes');
  assert.equal(a.sort_order, 5, 'sort_order is no longer continued from the rows already there');

  // A DUPLICATE WOULD BE A UNIQUE VIOLATION, not a silently wrong code — which is
  // why the fixture carries `idx_hypotheses_project_code`. Inserting the code the
  // seed already holds has to throw here, or the index is not really in the
  // fixture and every claim above rests on nothing.
  assert.throws(
    () => viaFill.prepare('INSERT INTO hypotheses (project_id, code, claim) VALUES (?,?,?)').run(P, 'H2', 'x'),
    /UNIQUE/i,
    'the fixture does not enforce one code per project',
  );

  // A SECOND ACCEPT ADVANCES, on both sides.
  await fillKind('hypothesis')!.apply(ctx(viaFill), { claim: 'A second distinct claim here' }, 'hypotheses');
  await insertHypothesis(env(viaForm), P, 'A second distinct claim here');
  assert.equal(last(viaFill).code, 'H8');
  assert.equal(last(viaFill).code, last(viaForm).code);
});

test('a pain tag writes through the same upsert, and its tenancy check still holds', async () => {
  const db = freshDb();
  const payload = {
    pain_group_id: 11, phrase: 'onboarding takes three weeks', group_title: 'Onboarding drags',
  };
  const applied = await fillKind('pain_tag')!.apply(ctx(db), payload, '');
  const row = db.prepare('SELECT * FROM pain_group_aliases WHERE project_id = ?').get(P) as any;
  assert.equal(row.group_id, 11);
  assert.equal(row.display_phrase, 'onboarding takes three weeks');

  // The same input through the manual writer produces the same row.
  const viaForm = freshDb();
  await upsertPainAlias(env(viaForm), P, 11, 'onboarding takes three weeks');
  const b = viaForm.prepare('SELECT * FROM pain_group_aliases WHERE project_id = ?').get(P) as any;
  assert.equal(row.display_phrase, b.display_phrase);
  assert.equal(row.phrase_norm, b.phrase_norm);
  assert.equal(row.group_id, b.group_id);

  // THE AUDIT PAIR IS COMPARABLE, which is the only way `recordFill` can derive
  // `edited` from it: `written` comes back in the same shape `readable` produces,
  // so an untouched accept records `edited = 0` rather than every accept looking
  // corrected. Read back from the row, so a phrase the writer capped or trimmed
  // shows up as the difference it is.
  assert.equal(applied.written, 'onboarding takes three weeks → Onboarding drags');
  assert.equal(fillKind('pain_tag')!.readable(payload), applied.written);

  // AND THE ADDRESS IS THE ALIAS ROW'S `group_id`, not its phrase. The tagger
  // cannot invent a phrase — `parseTagProposals` emits the project's own logged
  // string — so a provenance row naming `display_phrase` would credit Eadwyn with
  // something the founder typed. The theme is the only thing the fill decided.
  assert.deepEqual(applied.target, {
    table: 'pain_group_aliases', rowId: Number(row.id), column: 'group_id',
  });

  // A THEME THAT IS NOT THIS PROJECT'S IS REFUSED, and it has to throw rather
  // than return quietly — the accept route turns the throw into a 409 and puts
  // the proposal back to pending, which is how a founder keeps seeing it.
  await assert.rejects(
    () => fillKind('pain_tag')!.apply(ctx(db), { pain_group_id: 12, phrase: 'not ours' }, ''),
    /no longer exists/i,
    'a proposal naming another project’s theme was applied',
  );
  const count = () => Number((db.prepare('SELECT COUNT(*) AS n FROM pain_group_aliases').get() as any).n);
  assert.equal(count(), 1, 'the refused apply still wrote a row');
});

test('a hypothesis accept addresses the row it actually inserted', async () => {
  // `target()` is computed before the write and cannot know an id an INSERT is
  // about to allocate. It used to return the PROJECT id under `table:
  // 'hypotheses'`, which addresses whichever claim happens to carry that id —
  // in this fixture, a different project's. `apply` returns the real address now.
  const db = freshDb();
  await insertHypothesis(env(db), 4242, 'Somebody else’s claim entirely, long enough');
  const applied = await fillKind('hypothesis')!.apply(
    ctx(db), { claim: 'Buyers delay because onboarding takes three weeks' }, 'hypotheses',
  );
  // Found by its claim, not by "the project's row": the seeded history means the
  // project has several, and picking the first would make this pass by accident.
  const mine = db.prepare('SELECT id FROM hypotheses WHERE project_id = ? AND claim = ?')
    .get(P, 'Buyers delay because onboarding takes three weeks') as any;
  assert.deepEqual(applied.target, { table: 'hypotheses', rowId: Number(mine.id), column: 'claim' });
  assert.notEqual(applied.target!.rowId, P, 'the provenance row is addressed at a project id again');

  // The up-front fallback must not be able to name a real row either.
  assert.equal(
    fillKind('hypothesis')!.target({}, 'hypotheses', ctx(db)).rowId, 0,
    'the fallback address points at a row that could exist',
  );
});

test('each kind keeps the promise its class makes, and only that one', () => {
  // The classes are not interchangeable, and the write-path check is what makes
  // the difference real rather than documentary. A citation on a restatement
  // would put a source beside a value the source did not supply; a `sourced` fill
  // with none is an assertion with nothing behind it.
  const citation = { kind: 'library' as const, document_id: 1, title: 't', chunk: 0, quote: 'a real sentence' };
  const bare = { payload: {}, targetRef: 'x', readable: 'something' };
  const expected: Record<string, string> = {
    pain_tag: 'restatement', hypothesis: 'restatement',
    market_input: 'sourced', competitor: 'sourced',
  };
  for (const k of Object.values(FILL_KINDS)) {
    assert.equal(k.fillClass, expected[k.kind],
      `${k.kind} changed class — re-check the guarantee it now has to keep`);
    if (k.fillClass === 'restatement') {
      assert.match(String(refuseReason(k, { ...bare, citation })), /carrying a citation/);
      assert.equal(refuseReason(k, bare), null);
    } else {
      assert.match(String(refuseReason(k, bare)), /no citation/,
        `${k.kind} is sourced and would be written with nothing behind it`);
      assert.equal(refuseReason(k, { ...bare, citation }), null);
    }
  }
});

test('the market fill proposes the inputs and never the market size', async () => {
  // THE WHOLE POINT OF THE SOURCED CLASS, and the thing #198 turns on. The page
  // derives TAM from population × ACV with the founder's own assumptions and
  // stamps each card "Founder research" or "Founder model". A fill that proposed
  // a TAM would write over that arithmetic into `projects.tam` — a bare REAL with
  // nothing beside it to say who produced the number — and make all three of the
  // page's provenance statements false at once.
  const market = fillKind('market_input')!;
  const src = read('src/services/fills/registry.ts');
  const entry = src.slice(src.indexOf('const marketSizing: FillKind = {'));
  assert.doesNotMatch(entry.slice(0, entry.indexOf('\n};')), /projects\.tam|UPDATE projects/,
    'the market fill can write projects.tam');
  assert.match(market.prompt, /never propose the market size itself/i);
  // The fields it may propose are exactly the store's own sizing inputs.
  for (const field of ['population', 'acv', 'cagr']) {
    assert.ok(ASSUMPTION_COLUMNS[field], `${field} is not a column this store has`);
  }
  assert.equal(market.target({ field: 'acv' }, '', ctx(freshDb())).table, 'project_market_assumptions');
  assert.equal(market.target({ field: 'acv' }, '', ctx(freshDb())).column, 'acv');
});

test('the competitor fill adds to a list and cannot start one', async () => {
  // D46's rule for the tagger, applied to a second surface: *"the tagger sorts
  // phrases into themes the founder wrote and cannot create one"*. Starting a
  // competitor analysis runs discovery and a public-web crawl, so a fill that
  // bootstrapped one would spend a founder's budget on a job they did not ask for
  // inside a run they asked to be cheap.
  const competitor = fillKind('competitor')!;
  const src = read('src/services/fills/registry.ts');
  const entry = src.slice(src.indexOf('const competitorScan: FillKind = {'));
  const body = entry.slice(0, entry.indexOf('\n};'));
  assert.doesNotMatch(body, /runCompetitorAnalysis|INSERT INTO competitor_analyses/,
    'the competitor fill can start an analysis');
  assert.match(body, /Eadwyn adds to your list — it does not start one/);
  assert.match(competitor.prompt, /Never invent a company, a product name or a URL\./);

  // IT WRITES THROUGH THE FORM'S OWN WRITER, which is why that writer was
  // extracted from the route body at all. A second copy would have got `position`
  // wrong (the board is ordered by it) and would have forgotten `edited = 1`,
  // which is what stops the next discovery run deleting an accepted row.
  assert.match(body, /await insertManualCandidate\(/);
  const route = read('src/routes/competitors.ts');
  assert.match(route, /await insertManualCandidate\(c\.env, user\.id, id, inputs, \{/,
    'the manual route no longer goes through the shared writer');
  // SCOPED TO THE ADD-ONE HANDLER, not the whole file. Two other inserts into
  // `competitor_candidates` are legitimately different operations and must stay:
  // `persistResult` replaces the whole set after a discovery run, and the bulk
  // `PUT /:id` rewrites the board from a client-supplied array. A file-wide ban
  // would have forbidden both, which is how a guard starts being worked around.
  const addHandler = (() => {
    const at = route.indexOf("competitors.post('/:id/candidates'");
    assert.ok(at > 0, 'the add-a-competitor route is gone');
    return route.slice(at, route.indexOf('\n});', at));
  })();
  assert.doesNotMatch(addHandler, /INSERT INTO competitor_candidates/,
    'the add-one handler kept its own copy of the insert');
  assert.doesNotMatch(addHandler, /MAX\(position\)/,
    'the add-one handler still allocates its own position');
  const writes = read('src/routes/_competitor_writes.ts');
  assert.match(writes, /UPDATE competitor_analyses SET edited = 1/,
    'the shared writer no longer protects manual rows from a re-run');
  assert.match(writes, /COALESCE\(MAX\(position\), -1\) AS maxpos/,
    'the shared writer no longer allocates a position');

  // AND IT NEVER CRAWLS ON ACCEPT. An accept is a click a founder expects to be
  // instant; a crawl turns it into a wait and an outbound request they did not ask
  // for. `buildManualCandidate` will do it when asked, so this has to say no.
  assert.match(body, /crawl: false,/, 'accepting a competitor triggers a web crawl');

  // The name is not the editable field: a renamed company is a different company,
  // and the citation was found for the one the model named.
  assert.equal(competitor.editableField, 'note');

  // THE ADDRESS LIMIT IS STATED RATHER THAN FUDGED. `competitor_candidates.id` is
  // a TEXT uid and `fill_provenance.target_row_id` is an INTEGER, so this row
  // cannot be addressed the way the others are. Row 0 says "on this project"
  // without pretending to point at a row; coercing the uid would put every
  // competitor on NaN.
  const t = competitor.target({ name: 'x' }, '', ctx(freshDb()));
  assert.equal(t.table, 'competitor_candidates');
  assert.equal(t.rowId, 0);
  assert.match(body, /is an INTEGER/, 'the address limitation is no longer written down');
});

test('a sourced fill with no citation is refused, and one with a hollow citation too', () => {
  // No `sourced` kind is registered yet, so the rule is checked against the
  // function every future one goes through. This is the guarantee the whole
  // three-class design rests on: TAM cannot be written on a model's word.
  const sourced = { ...fillKind('hypothesis')!, fillClass: 'sourced' as const };
  const base = { payload: {}, targetRef: 'projects.tam', readable: '1200000000' };
  assert.match(String(refuseReason(sourced, base)), /no citation/);
  assert.match(String(refuseReason(sourced, {
    ...base, citation: { kind: 'library', document_id: 1, title: 't', chunk: 0, quote: '  ' } as any,
  })), /no quote/);
  assert.match(String(refuseReason(sourced, {
    ...base, citation: { kind: 'library', document_id: NaN, title: 't', chunk: 0, quote: 'q' } as any,
  })), /naming no document/);
  assert.match(String(refuseReason(sourced, {
    ...base, citation: { kind: 'research', task: 'research_ask', query: '', source: 's', quote: 'q' } as any,
  })), /naming no query/);
  assert.match(String(refuseReason(sourced, {
    ...base, citation: { kind: 'guess', quote: 'q' } as any,
  })), /unknown kind/);
  // And the good one passes, or the rule would refuse everything.
  assert.equal(refuseReason(sourced, {
    ...base, citation: { kind: 'library', document_id: 4, title: 't', chunk: 1, quote: 'a real sentence' },
  }), null);
});

test('only a kind that says it is editable may be edited', () => {
  // `pain_tag`'s phrase is the project's own logged string — the thing
  // `parseTagProposals` deliberately emits instead of the model's echo — so
  // retyping it would break the match-back the whole class rests on.
  assert.equal(fillKind('pain_tag')!.editableField, null);
  assert.equal(fillKind('hypothesis')!.editableField, 'claim');
  // And the route refuses rather than silently accepting the original.
  const route = read('src/routes/founder_validate.ts');
  assert.match(route, /if \(editedValue && !spec\.editableField\)/,
    'an edit on a non-editable kind is no longer refused');
  assert.match(route, /\[spec\.editableField\]: editedValue/,
    'an accepted edit is not applied to the payload');
});

test('the accept route dispatches through the registry and records provenance', () => {
  const route = read('src/routes/founder_validate.ts');
  // The hardcoded branch is gone, and the registry is what replaced it.
  assert.doesNotMatch(route, /if \(row\.kind === 'pain_tag'\)/,
    'the hardcoded dispatch is back');
  assert.match(route, /const spec = fillKind\(row\.kind\);/);
  assert.match(route, /await spec\.apply\(/);
  // Provenance is written on the accept path and a failure reverts — a value
  // written with nothing able to attribute it is the state the table exists for.
  assert.match(route, /await recordFill\(c\.env, \{/);
  const at = route.indexOf('await recordFill');
  assert.match(route.slice(at, at + 900), /proposalId: row\.id/);
  // THE WRITE'S OWN ADDRESS WINS. `target()` runs before the insert and cannot
  // know the row id; the other precedence files a claim's provenance against
  // whatever row carries the project's id.
  assert.match(route.slice(at, at + 900), /target: applied\.target \?\? spec\.target\(/,
    'the accept route no longer prefers the address the write returned');
  assert.match(route.slice(at, at + 900), /model: row\.model/,
    'the provenance row records a model other than the one that ran');
  // An unknown kind reverts rather than 500s.
  assert.match(route, /if \(!spec\) \{\s*\n\s*await revert\(\);/);
});

test('a proposal row can carry a surface, a class, a citation and a target', () => {
  // The four columns migration 246 added, and the read that has to select them.
  const migration = readFileSync(`${SQL}/migrations/246_fills_the_blanks_everywhere.sql`, 'utf8');
  for (const col of ['surface', 'fill_class', 'citation_json', 'target_ref']) {
    assert.ok(migration.includes(`ADD COLUMN ${col} TEXT`), `246 no longer adds ${col}`);
  }
  // The backfill is what makes `surface` meaningful on landing rather than after
  // the next run, and it has to cover both existing kinds.
  assert.match(migration, /surface = 'validate\/pain-map'.*kind = 'pain_tag'/);
  assert.match(migration, /surface = 'validate\/hypotheses'.*kind = 'hypothesis'/);
  const route = read('src/routes/founder_validate.ts');
  assert.match(route, /target_ref, citation_json, model, task/,
    'loadProposal no longer selects the columns the accept path reads');
});
