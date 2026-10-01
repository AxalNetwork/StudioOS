/**
 * D235 — a runtime bootstrap is a safety net for a DECLARED object, never the
 * only declaration.
 *
 * What went wrong, in one paragraph: `routes/admin_publications.ts` creates
 * its table with `CREATE TABLE IF NOT EXISTS` on first use, and D190 left it
 * to that bootstrap on purpose. The bootstrap ran in production on 2026-09-24,
 * so production held three names the repo's own fresh build did not, and deploy
 * step 9 (`scripts/check-baseline-drift.mjs`, which compares names both ways)
 * failed on six consecutive main deploys. Migration 287 declares every object
 * a runtime statement can create, and `scripts/check-runtime-schema-declared.mjs`
 * keeps the rule true.
 *
 * Three groups below:
 *   · 287 itself, on a real `node:sqlite` build from the baseline plus every
 *     migration above the cutoff — the database step 9 builds;
 *   · the guard's rules, each driven by a FIXTURE so a count that moves with
 *     the repo cannot make a test pass or fail;
 *   · the guard against the real tree, asserting properties, never counts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import {
  analyse,
  findings,
  harvestRuntimeDdl,
  judge,
  literalArrayEntries,
  statementsOf,
  LEDGER,
} from '../../scripts/check-runtime-schema-declared.mjs';
import { buildFresh, objectNames, postCutoffMigrations } from '../../scripts/check-baseline-drift.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const LATER = postCutoffMigrations(ROOT) as Array<{ name: string; sql: string }>;
const M287 = '287_runtime_schema_declared.sql';

/** The fresh build step 9 compares against production, with and without 287. */
const withAll = () => buildFresh(BASELINE, LATER.map((m) => m.sql));
const without287 = () => buildFresh(BASELINE, LATER.filter((m) => m.name !== M287).map((m) => m.sql));

/** The fourteen objects 287 declares, as step 9 names them. */
const DECLARED = [
  'index:idx_admin_publications_created_by',
  'index:idx_admin_publications_slug',
  'index:idx_admin_publications_status_created',
  'index:idx_referral_attributions_referrer',
  'index:idx_spinout_mod_open',
  'index:idx_spinout_mod_status',
  'index:idx_spinout_mod_user',
  'index:uniq_discovery_advisor_slot',
  'index:uniq_roadmap_okrs_advisor_slot',
  'table:admin_publications',
  'table:deck_brand_watermarks',
  'table:deck_recommendation_overrides',
  'table:referral_attributions',
  'table:spinout_moderation_cases',
];

/** The runtime statements 287 copies, by the files its header cites. */
const RUNTIME_FILES = [
  'cloudflare-worker/src/routes/admin_publications.ts',
  'cloudflare-worker/src/routes/spinout_moderation.ts',
  'cloudflare-worker/src/services/referralAttribution.ts',
  'cloudflare-worker/src/services/decks/branding.ts',
  'cloudflare-worker/src/services/decks/recommend.ts',
  'cloudflare-worker/src/services/advisor/writeRouter.ts',
];

// node:sqlite rows carry a null prototype; comparing their JSON is what makes
// two databases' answers comparable without that detail getting in the way.
const j = (v: unknown) => JSON.stringify(v);

/**
 * Everything about an object a reader depends on: a table's columns, keys and
 * uniqueness; an index's table, columns, uniqueness and WHERE.
 */
function shapeOf(db: DatabaseSync, type: string, name: string) {
  if (type === 'table') {
    const uniques = (db.prepare('SELECT name, origin FROM pragma_index_list(?)').all(name) as any[])
      .filter((i) => i.origin === 'u' || i.origin === 'pk')
      .map((i) => (db.prepare('SELECT name FROM pragma_index_info(?) ORDER BY seqno').all(i.name) as any[])
        .map((c) => c.name).join(','))
      .sort();
    return j({
      columns: db.prepare('SELECT name, type, "notnull" AS nn, dflt_value AS dflt, pk FROM pragma_table_info(?) ORDER BY cid').all(name),
      foreignKeys: db.prepare('SELECT "table" AS parent, "from" AS col, "to" AS ref FROM pragma_foreign_key_list(?) ORDER BY id, seq').all(name),
      uniques,
    });
  }
  const row = db.prepare("SELECT tbl_name, sql FROM sqlite_master WHERE type = 'index' AND name = ?").get(name) as any;
  assert.ok(row, `index ${name} is not in the database`);
  const listed = (db.prepare('SELECT name, "unique" AS u, partial FROM pragma_index_list(?)').all(row.tbl_name) as any[])
    .find((i) => i.name === name);
  const where = /\bWHERE\b([\s\S]*)$/i.exec(row.sql)?.[1].replace(/\s+/g, ' ').trim() ?? null;
  return j({
    table: row.tbl_name,
    unique: listed?.u,
    partial: listed?.partial,
    columns: (db.prepare('SELECT * FROM pragma_index_xinfo(?) WHERE key = 1 ORDER BY seqno').all(name) as any[])
      .map((c) => [c.name, c.desc, c.coll]),
    where,
  });
}

// ---------------------------------------------------------------------------
// Migration 287, on the database step 9 builds

test('287 adds exactly the fourteen objects its header names, and removes nothing', () => {
  const after = objectNames(withAll()) as Set<string>;
  const before = objectNames(without287()) as Set<string>;
  const added = [...after].filter((n) => !before.has(n)).sort();
  const removed = [...before].filter((n) => !after.has(n)).sort();
  assert.deepEqual(added, DECLARED, 'the fresh build gained a different set of names from 287');
  assert.deepEqual(removed, [], '287 must be purely additive');
});

test('287 is above the cutoff, so step 7 applies it before step 9 compares, and it carries no transaction', () => {
  // The deploy applies pending migrations at step 7 and compares at step 9.
  // A file at or below BASELINE_CUTOFF is only MARKED by a bootstrap, never run.
  assert.ok(LATER.some((m) => m.name === M287), `${M287} is not above BASELINE_CUTOFF`);
  assert.doesNotMatch(read(`cloudflare-worker/sql/migrations/${M287}`).replace(/--.*$/gm, ''),
    /\b(?:BEGIN|COMMIT)\b/i, 'D1 rejects transaction statements in a migration (#26)');
});

test('every object 287 declares has the shape its runtime statement creates', () => {
  // The header's promise: "each copied verbatim from its runtime statement so
  // the object a reader expects is the object it gets". Proved rather than
  // read: the runtime statements run on a build WITHOUT 287, and the result
  // must match the build WITH it, object by object.
  const files = new Map(RUNTIME_FILES.map((f) => [join(ROOT, f), read(f)]));
  const harvest = harvestRuntimeDdl(files, ROOT) as any;
  const byKey = new Map<string, string[]>();
  for (const c of harvest.creates) {
    if (!c.sql) continue;
    const k = `${c.type}:${c.name.toLowerCase()}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(c.sql);
  }

  const fromRuntime = without287();
  const runtimeKeys = DECLARED.filter((k) => k !== 'index:idx_admin_publications_created_by');
  // Tables first: an index needs its table.
  for (const k of [...runtimeKeys].sort((a, b) => (a.startsWith('table:') ? -1 : 1) - (b.startsWith('table:') ? -1 : 1))) {
    const sqls = byKey.get(k);
    assert.ok(sqls && sqls.length, `no literal runtime statement creates ${k} in ${RUNTIME_FILES.join(', ')}`);
    for (const s of sqls!) fromRuntime.exec(s);
  }
  // The one 287 takes from 045 rather than from a bootstrap.
  const m045 = read('cloudflare-worker/sql/migrations/045_admin_publications.sql');
  const createdBy = statementsOf(m045.replace(/--.*$/gm, ''))
    .find((s: string) => /idx_admin_publications_created_by/.test(s));
  assert.ok(createdBy, "045 no longer declares idx_admin_publications_created_by");
  fromRuntime.exec(createdBy);

  const declared = withAll();
  for (const k of DECLARED) {
    const [type, name] = k.split(':');
    assert.equal(shapeOf(declared, type, name), shapeOf(fromRuntime, type, name), `${k} differs between 287 and its source`);
  }
});

test("the advisor's slot upserts run on the fresh build, and update rather than duplicate", () => {
  // Their ON CONFLICT names a partial UNIQUE index as its target. Without the
  // index SQLite refuses the statement outright, so this is the write the
  // two uniq_*_advisor_slot declarations exist for.
  const src = read('cloudflare-worker/src/services/advisor/writeRouter.ts');
  const upserts = [...src.matchAll(/`(INSERT INTO (discovery_interviews|roadmap_okrs)[\s\S]*?ON CONFLICT\([\s\S]*?)`/g)]
    .map((m) => ({ table: m[2], sql: m[1] }));
  assert.equal(upserts.filter((u) => u.table === 'discovery_interviews').length, 2, 'the two interview upserts');
  assert.equal(upserts.filter((u) => u.table === 'roadmap_okrs').length, 1, 'the OKR upsert');
  assert.ok(upserts.every((u) => !u.sql.includes('${')), 'the upserts must stay literal to be run here');

  const binds = (u: { table: string; sql: string }, value: string) => {
    const now = '2026-09-24T12:00:00.000Z';
    if (u.table === 'roadmap_okrs') return [7, value, 'advisor:q1_obj1', 1, now, now];
    return /\(\?, \?, \?, \?, '', /.test(u.sql)
      ? [7, value, 'advisor:interview1', '2026-09-24', now, now]                         // name
      : [7, 'advisor:interview1', '2026-09-24', value, JSON.stringify([value]), now, now]; // pains
  };

  const db = withAll();
  for (const u of upserts) {
    db.prepare(u.sql).run(...binds(u, 'first'));
    db.prepare(u.sql).run(...binds(u, 'second'));
  }
  const interviews = db.prepare("SELECT interviewee_name, pains_json FROM discovery_interviews WHERE project_id = 7 AND interviewee_role = 'advisor:interview1'").all() as any[];
  assert.equal(interviews.length, 1, 'four interview writes to one slot must leave one row');
  assert.equal(interviews[0].interviewee_name, 'second');
  assert.equal(interviews[0].pains_json, JSON.stringify(['second']));
  const okrs = db.prepare("SELECT objective FROM roadmap_okrs WHERE project_id = 7 AND quarter = 'advisor:q1_obj1'").all() as any[];
  assert.equal(okrs.length, 1, 'two OKR writes to one slot must leave one row');
  assert.equal(okrs[0].objective, 'second');

  // The WHERE keeps the index to advisor slots: two founder rows that share an
  // ordinary quarter label in one project are not a conflict.
  db.prepare("INSERT INTO roadmap_okrs (project_id, objective, quarter) VALUES (7, 'a', 'Q1 2026')").run();
  db.prepare("INSERT INTO roadmap_okrs (project_id, objective, quarter) VALUES (7, 'b', 'Q1 2026')").run();

  // And the proof the index is what makes the write possible.
  const bare = without287();
  assert.throws(() => bare.prepare(upserts[0].sql).run(...binds(upserts[0], 'x')),
    /ON CONFLICT clause does not match/i);
});

// ---------------------------------------------------------------------------
// The guard's rules, on fixtures

/** A guard run over a tiny fresh build and a map of fixture sources. */
function run(base: string, sources: Record<string, string>, ledger: any = {}) {
  const truthDb = new DatabaseSync(':memory:');
  truthDb.exec(base);
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true } as any);
  db.exec(base);
  const files = new Map(Object.entries(sources).map(([rel, src]) => [join(ROOT, rel), src]));
  const verdict = analyse({ truth: objectNames(truthDb), db, harvest: harvestRuntimeDdl(files, ROOT) }) as any;
  const problems = judge(verdict, ledger) as Array<{ kind: string; text: string }>;
  return { verdict, problems, kinds: problems.map((p) => p.kind).sort() };
}
const F = 'cloudflare-worker/src/fixture/a.ts';

test('a runtime CREATE of a name the fresh build lacks fails, and cannot be ledgered', () => {
  const { problems } = run('CREATE TABLE a (id INTEGER);',
    { [F]: 'await env.DB.exec("CREATE TABLE IF NOT EXISTS b (id INTEGER)");' },
    { refused: { 'table:b': { refusal: 'x' } } });
  const creatable = problems.filter((p) => p.kind === 'creatable');
  assert.equal(creatable.length, 1);
  assert.match(creatable[0].text, /^table:b — the fresh build lacks it and cloudflare-worker\/src\/fixture\/a\.ts:1 can create it/);
  // A ledger line for it changes nothing: it is reported stale, not accepted.
  assert.ok(problems.some((p) => p.kind === 'stale-refused' && p.text === 'table:b'));
});

test('a runtime CREATE of a declared name is a safety net and passes', () => {
  const { problems, verdict } = run('CREATE TABLE a (id INTEGER); CREATE INDEX ia ON a(id);', {
    [F]: 'db.exec("CREATE TABLE IF NOT EXISTS a (id INTEGER)"); db.exec("CREATE INDEX IF NOT EXISTS ia ON a(id)");',
  });
  assert.deepEqual(problems, []);
  assert.equal(verdict.statements, 2, 'both statements were harvested and run — the pass is not vacuous');
});

test('an index created only after a later ADD COLUMN is found by running to a fixed point', () => {
  // Order in the tree is arbitrary; the index runs on the second pass.
  const { problems } = run('CREATE TABLE a (id INTEGER);', {
    [F]: 'db.exec("CREATE INDEX IF NOT EXISTS ix ON a(extra)");\ndb.exec("ALTER TABLE a ADD COLUMN extra TEXT");',
  });
  assert.deepEqual(problems.map((p) => p.kind), ['creatable']);
  assert.match(problems[0].text, /^index:ix /);
});

test('a refusal on record passes only while SQLite still gives that refusal', () => {
  const base = 'CREATE TABLE a (id INTEGER);';
  const src = { [F]: 'db.exec("CREATE INDEX IF NOT EXISTS ix ON a(missing)");' };
  assert.deepEqual(run(base, src).kinds, ['refused'], 'unrecorded, it is a finding');
  assert.deepEqual(run(base, src, { refused: { 'index:ix': { refusal: 'no such column: missing' } } }).kinds, [],
    'recorded with the refusal SQLite gives, it passes');
  assert.deepEqual(run(base, src, { refused: { 'index:ix': { refusal: 'no such table' } } }).kinds, ['refusal-changed'],
    'recorded with a different refusal, it fails');
});

test('a refusal cannot be re-proved when an ALTER the check cannot expand reaches its table', () => {
  // The unexpandable ALTER could add the very column the refusal depends on.
  const { kinds } = run('CREATE TABLE a (id INTEGER);', {
    [F]: 'db.exec("CREATE INDEX IF NOT EXISTS ix ON a(missing)");\n'
      + 'for (const c of columnsFrom(config)) await env.DB.exec(`ALTER TABLE a ADD COLUMN ${c} TEXT`);',
  }, {
    refused: { 'index:ix': { refusal: 'no such column: missing' } },
    opaque: { 'cloudflare-worker/src/fixture/a.ts': { statements: 1, reason: 'fixture' } },
  });
  assert.deepEqual(kinds, ['unverifiable']);
});

test('a ledger line for a refusal that no longer happens is stale', () => {
  assert.deepEqual(run('CREATE TABLE a (id INTEGER);', {}, { refused: { 'index:gone': { refusal: 'x' } } }).kinds,
    ['stale-refused']);
});

test('DDL the check cannot model is counted against the ledger, in both directions', () => {
  const base = 'CREATE TABLE a (id INTEGER);';
  const src = { [F]: 'db.exec(`CREATE TABLE IF NOT EXISTS ${name} (id INTEGER)`);' };
  assert.deepEqual(run(base, src).kinds, ['opaque']);
  assert.deepEqual(run(base, src, { opaque: { [F]: { statements: 1, reason: 'fixture' } } }).kinds, []);
  assert.deepEqual(run(base, src, { opaque: { [F]: { statements: 2, reason: 'fixture' } } }).kinds, ['opaque'],
    'a count that disagrees is a finding: something was added or removed');
  assert.deepEqual(run(base, {}, { opaque: { [F]: { statements: 1, reason: 'fixture' } } }).kinds, ['stale-opaque']);
});

test('a runtime rename that fires against the fresh build is reported three ways', () => {
  const { kinds } = run('CREATE TABLE old_t (id INTEGER);', { [F]: 'db.exec("ALTER TABLE old_t RENAME TO new_t");' });
  assert.deepEqual(kinds, ['creatable', 'removed', 'renamed']);
});

test('a DROP of a declared name with no CREATE after it is not silently accepted', () => {
  const dropOnly = run('CREATE TABLE a (id INTEGER);', { [F]: 'db.exec("DROP TABLE IF EXISTS a");' });
  assert.deepEqual(dropOnly.kinds, ['opaque']);
  const rebuilt = run('CREATE TABLE a (id INTEGER);', {
    [F]: 'db.exec("DROP TABLE IF EXISTS a");\ndb.exec("CREATE TABLE IF NOT EXISTS a (id INTEGER)");',
  });
  assert.deepEqual(rebuilt.kinds, [], 'a drop-and-recreate carries a legacy database forward');
});

// ---------------------------------------------------------------------------
// Loop expansion — a bootstrap that loops over a literal array is modelled,
// one statement per entry

test('a loop over a type-annotated const array expands, comments and all', () => {
  // `settings.ts` and `fundGpSchema.ts` read as unmodelled until a quote inside
  // a `//` comment (`D1's`) stopped being taken for the start of an entry.
  const src = `
    const COLS: Array<[string, string]> = [
      // D1's own note, with an apostrophe in it
      ['alpha', 'TEXT'],
      /* and here's a block comment */ ['beta', "TEXT NOT NULL DEFAULT '{}'"],
    ];
    for (const [col, type] of COLS) {
      await env.DB.exec(\`ALTER TABLE widgets ADD COLUMN \${col} \${type}\`);
    }`;
  const h = harvestRuntimeDdl(new Map([[join(ROOT, F), src]]), ROOT) as any;
  assert.deepEqual(h.columns.map((c: any) => c.sql), [
    'ALTER TABLE widgets ADD COLUMN alpha TEXT',
    "ALTER TABLE widgets ADD COLUMN beta TEXT NOT NULL DEFAULT '{}'",
  ]);
  assert.equal(h.opaque.size, 0);
});

test('a loop over anything but a literal array stays opaque', () => {
  const src = 'for (const col of loadColumns()) { await env.DB.exec(`ALTER TABLE widgets ADD COLUMN ${col} TEXT`); }';
  const h = harvestRuntimeDdl(new Map([[join(ROOT, F), src]]), ROOT) as any;
  assert.equal(h.columns.length, 0);
  assert.equal(h.opaque.get('cloudflare-worker/src/fixture/a.ts')?.length, 1);
});

test('the array reader keeps a // that sits inside a string', () => {
  // Blanking comments must never reach into a literal.
  assert.deepEqual(literalArrayEntries("['https://example.test', 'b' /* c */]"), [['https://example.test'], ['b']]);
  assert.deepEqual(literalArrayEntries("[ // it's a note\n 'a', \"it's\" ]"), [['a'], ["it's"]]);
  assert.equal(literalArrayEntries('[...more, "a"]'), null, 'a spread is not a literal array');
});

test('a trigger is one statement, not split at the semicolons inside its body', () => {
  const parts = statementsOf('CREATE TRIGGER t AFTER INSERT ON a BEGIN UPDATE a SET id = 1; UPDATE a SET id = 2; END; CREATE TABLE b (id INTEGER)');
  assert.equal(parts.length, 2);
  assert.match(parts[0], /^CREATE TRIGGER t [\s\S]*\bEND$/);
  assert.match(parts[1], /^CREATE TABLE b/);
});

// ---------------------------------------------------------------------------
// The real tree

test('the tree passes: no runtime statement can create or remove a name the fresh build lacks or has', () => {
  const verdict = findings(ROOT) as any;
  const ledger = JSON.parse(readFileSync(LEDGER, 'utf8'));
  assert.deepEqual(judge(verdict, ledger), []);
  // Not vacuous: the harvest must reach the statements D235 is about.
  assert.ok(verdict.statements > 500, `only ${verdict.statements} runtime DDL statements were harvested`);
  assert.deepEqual(verdict.creatable, []);
  assert.deepEqual(verdict.refused.map((r: any) => r.key), Object.keys(ledger.refused).sort());
});

test('every ledger entry carries what it records and a reviewed reason', () => {
  const ledger = JSON.parse(readFileSync(LEDGER, 'utf8'));
  for (const [k, e] of Object.entries<any>(ledger.refused)) {
    assert.ok(typeof e.refusal === 'string' && e.refusal.length > 5, `${k} records no refusal text`);
    assert.ok(typeof e.reason === 'string' && e.reason.length > 40, `${k} records no reviewed reason`);
  }
  for (const [f, e] of Object.entries<any>(ledger.opaque)) {
    assert.ok(Number.isInteger(e.statements) && e.statements > 0, `${f} records no statement count`);
    assert.ok(typeof e.reason === 'string' && e.reason.length > 40, `${f} records no reviewed reason`);
  }
});

test('the drift check and this guard build the same database from one list', () => {
  // A second copy of "which files, in which order" is how the two would come
  // to build different databases while each reported success about its own.
  const guard = read('scripts/check-runtime-schema-declared.mjs');
  assert.match(guard, /import \{[^}]*\bbuildFresh\b[^}]*\bpostCutoffMigrations\b[^}]*\} from '\.\/check-baseline-drift\.mjs'/);
  assert.doesNotMatch(guard, /readdirSync\([^)]*migrations/, 'the guard must not list migrations itself');
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts['test:guards'], /node --no-warnings scripts\/check-runtime-schema-declared\.mjs/);
});
