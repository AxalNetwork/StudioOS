/**
 * D191 — two definitions of one table must not drift apart silently.
 *
 * The guard under test is `scripts/check-schema-pair-drift.mjs`. Its parser is
 * exercised against FIXTURES so a finding count that moves with the repo
 * cannot make these pass or fail; the tests that do read the tree assert
 * properties, never counts.
 *
 * The defect being guarded, in one sentence: D1 holds one table per name and
 * `CREATE TABLE IF NOT EXISTS` cannot add a column to a table that already
 * exists, so when a migration and a runtime bootstrap declare different column
 * sets the first to run wins — in an order nothing in the repository decides —
 * and every column only the loser declares is a column that will never exist.
 * It shipped as `metrics_snapshots` twice (#183, #202) and as
 * `partner_profiles` (D187), where twenty-six partner accounts were told in
 * chat to accept an invitation that did not exist.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import {
  sqlExpressions,
  resolveLoopColumns,
  parseArrayEntries,
  shapeOf,
  findings,
  runtimeDefinitions,
  sqlDefinitions,
} from '../../scripts/check-schema-pair-drift.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const INTERP = '\u0000';

/** Built once — `findings()` compiles ~600 in-memory tables. */
const FOUND = findings();
const LEDGER: Record<string, string> =
  JSON.parse(read('scripts/schema-pair-drift-baseline.json')).pairs;

// ---------------------------------------------------------------------------
// The extractor — what a per-literal pass cannot see

test("a CREATE built by concatenating one quoted line per column is one statement", () => {
  // Nine runtime bootstraps are written this way. Read literal by literal they
  // are nine fragments and no statement, which is why the first sweep of this
  // reported fifteen tables as unbuildable, every one a quote-and-plus artifact.
  const src = `
    await env.DB.exec(
      'CREATE TABLE IF NOT EXISTS widgets (' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
      "label TEXT NOT NULL DEFAULT 'x', " +
      'owner_id INTEGER)',
    );
  `;
  const joined = sqlExpressions(src).map((e) => e.text);
  assert.ok(
    joined.some((t) => /CREATE TABLE IF NOT EXISTS widgets \(id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL DEFAULT 'x', owner_id INTEGER\)/.test(t)),
    `the + chain was not joined: ${JSON.stringify(joined)}`,
  );
});

test('an interpolation is MARKED in the text, never dropped', () => {
  // Dropping it would silently turn `DEFAULT ${x}` into valid-looking SQL and
  // let the guard build a shape the code never produces.
  const [e] = sqlExpressions('const q = `SELECT ${a} FROM t`;');
  assert.ok(e.text.includes(INTERP), 'the ${…} left no marker');
  assert.equal(e.text, `SELECT ${INTERP} FROM t`);
});

test('a regex literal does not desynchronise the scan', () => {
  // `escapeSoql`'s `.replace(/'/g, "\\'")` cost check-sqlite-dialect 139
  // statements in one file when its lone quote was read as a string opener.
  const src = `const e = (s) => s.replace(/'/g, "\\\\'");\nawait db.exec('CREATE TABLE after_the_regex (id INTEGER)');`;
  const texts = sqlExpressions(src).map((t) => t.text);
  assert.ok(
    texts.some((t) => t.startsWith('CREATE TABLE after_the_regex')),
    `the statement after the regex was swallowed: ${JSON.stringify(texts)}`,
  );
});

// ---------------------------------------------------------------------------
// The ALTER loops — the half that decides whether the guard starts right

test('all three ADD COLUMN loop shapes resolve to their columns', () => {
  const named = `
    const NEW_COLUMNS: Array<[string, string]> = [['a', 'TEXT'], ['b', 'INTEGER']];
    for (const [col, type] of NEW_COLUMNS) {
      await db.prepare(\`ALTER TABLE t ADD COLUMN \${col} \${type}\`).run();
    }`;
  const inlinePairs = `
    for (const [col, decl] of [['c', 'REAL'], ['d', 'TEXT']] as const) {
      await db.prepare(\`ALTER TABLE t ADD COLUMN \${col} \${decl}\`).run();
    }`;
  const inlineStrings = `
    for (const col of ['e TEXT', 'f INTEGER']) {
      await db.prepare(\`ALTER TABLE t ADD COLUMN \${col}\`).run();
    }`;
  for (const [src, expected] of [
    [named, ['a', 'b']],
    [inlinePairs, ['c', 'd']],
    [inlineStrings, ['e', 'f']],
  ] as Array<[string, string[]]>) {
    const at = src.indexOf('ALTER TABLE');
    const cols = resolveLoopColumns(src, at);
    assert.deepEqual((cols || []).map((c: string[]) => c[0]), expected,
      `loop shape did not resolve:\n${src}`);
  }
});

test('parseArrayEntries prefers the pair shape over the string shape', () => {
  assert.deepEqual(parseArrayEntries(`[['a', 'TEXT'], ['b', 'INTEGER']]`), [['a', 'TEXT'], ['b', 'INTEGER']]);
  assert.deepEqual(parseArrayEntries(`['a TEXT', 'b INTEGER']`), [['a', 'TEXT'], ['b', 'INTEGER']]);
});

test('a definition that reaches the other shape THROUGH its ALTERs compares equal', () => {
  // This is the assertion that keeps the guard off `partner_profiles`, whose
  // runtime side reaches migration 275 only through a 24-entry ADD COLUMN loop.
  // Drop the alters and the same pair diverges — which is what an ALTER-blind
  // comparison reports, and why it starts with twenty-one false findings.
  const runtime = { where: 'fixture.ts:1', create: 'CREATE TABLE t (id INTEGER PRIMARY KEY)', alters: [['extra', 'TEXT']], interp: false };
  const declared = { where: 'fixture.sql', create: 'CREATE TABLE t (id INTEGER PRIMARY KEY, extra TEXT)', alters: [], interp: false };
  assert.deepEqual(shapeOf(runtime, 't').cols, shapeOf(declared, 't').cols);
  assert.deepEqual(shapeOf({ ...runtime, alters: [] }, 't').cols, ['id'],
    'without the ALTER the runtime side is one column narrower — the false finding');
});

// ---------------------------------------------------------------------------
// The two kinds that are not a column difference

test('a definition real SQLite refuses is reported, not skipped', () => {
  // `integrations/providers/stripe.ts` writes DEFAULT (datetime("now")) with
  // double quotes; SQLite rejects it and the statement's own catch has been
  // swallowing the proof ever since.
  const refused = shapeOf(
    { where: 'fixture.ts:1', create: `CREATE TABLE t (id INTEGER PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime("now")))`, alters: [], interp: false },
    't',
  );
  assert.equal(refused.error, 'refused');
  assert.match(refused.detail, /not constant/);
});

test('an interpolated definition is reported as its own kind', () => {
  // Silently dropping a definition the guard cannot build is how a gate comes
  // to report a pass over a corpus it never read.
  const out = shapeOf({ where: 'fixture.ts:1', create: `CREATE TABLE t (${INTERP})`, alters: [], interp: true }, 't');
  assert.equal(out.error, 'interpolated');
});

// ---------------------------------------------------------------------------
// The tree — properties, never counts

test('every finding is on the ledger and every ledger line is still a finding', () => {
  const added = [...FOUND.keys()].filter((k) => !(k in LEDGER)).sort();
  const stale = Object.keys(LEDGER).filter((k) => !FOUND.has(k)).sort();
  assert.deepEqual(added, [], 'a pair drifted and is not on scripts/schema-pair-drift-baseline.json');
  assert.deepEqual(stale, [], 'these ledger entries now agree — delete them, a ledger is only worth reading if every line is true');
});

test('every ledger entry carries one of the four kinds and a reviewed reason', () => {
  for (const [key, reason] of Object.entries(LEDGER)) {
    assert.match(key, /^(divergent|superset|refused|interpolated):[a-z_][a-z0-9_]*$/, `bad ledger key: ${key}`);
    assert.equal(typeof reason, 'string');
    assert.ok(reason.length > 120, `${key}'s reason is too short to be a reviewed one: ${reason}`);
  }
});

test('partner_profiles is NOT reported at all — D187 converged it, through an ALTER loop', () => {
  // The case that shaped the guard, and the one it must stay silent about:
  // routes/profiling.ts's 24-entry loop reaches migration 275's shape exactly.
  // A CREATE-only comparison calls it divergent; a pair parser that cannot read
  // a type carrying its own quotes — ['raw_chat_json', "TEXT NOT NULL DEFAULT
  // '{}'"] — calls it a one-column superset, which is what this gate did until
  // its own stale-entry refusal caught it.
  for (const key of FOUND.keys()) {
    assert.notEqual(key.split(':')[1], 'partner_profiles',
      `partner_profiles is reported as ${key} — the ALTER resolution stopped reading all 24 columns`);
  }
  const profiling = (runtimeDefinitions().get('partner_profiles') || [])
    .find((d: any) => d.where.startsWith('cloudflare-worker/src/routes/profiling.ts'));
  assert.ok(profiling, 'profiling.ts no longer defines partner_profiles');
  assert.equal(profiling.alters.length, 24, 'NEW_COLUMNS lost an entry to the parser');
  assert.ok(profiling.alters.some((a: string[]) => a[0] === 'raw_chat_json'),
    "the entry whose TYPE carries quotes is being dropped again");
});

test('sql/historical/ is excluded — an archived shape is not a rival definition', () => {
  // `spinout_moderation_cases` is created at runtime and declared ONLY under
  // sql/historical/. Harvesting the archive would report it as a pair nobody
  // can answer, which is the false finding its three sibling guards each record.
  assert.ok(!sqlDefinitions().has('spinout_moderation_cases'));
  assert.ok(runtimeDefinitions().has('spinout_moderation_cases'));
  for (const key of FOUND.keys()) assert.notEqual(key.split(':')[1], 'spinout_moderation_cases');
  for (const def of sqlDefinitions().values()) {
    assert.doesNotMatch(def.where, /sql\/historical\//, `${def.where} is an archived file`);
  }
});

test('the rebuild idiom renames the CREATE with the table', () => {
  // `CREATE t_new … DROP t … RENAME t_new TO t` is how five migrations widen a
  // table. A definition still saying `CREATE TABLE landing_pages_new` builds
  // that name, so pragma_table_info for `landing_pages` comes back EMPTY — a
  // zero-column shape that reads as "every other definition is a superset"
  // rather than as a parse bug. It did, until this was fixed.
  const def = sqlDefinitions().get('landing_pages');
  assert.ok(def, 'landing_pages has no SQL definition');
  assert.match(def.create, /CREATE TABLE\s+landing_pages\s*\(/i);
  const shape = shapeOf(def, 'landing_pages');
  assert.ok((shape.cols || []).length > 10, `landing_pages built to ${(shape.cols || []).length} columns`);
});

// ---------------------------------------------------------------------------
// The one live consequence the guard found

test("the calendar sweep no longer deletes integrations/oauth.ts's in-flight state", () => {
  // Paired, and the statement is read off disk rather than retyped so the test
  // cannot drift from the code it is about.
  const calendar = read('cloudflare-worker/src/routes/calendar.ts');
  const sweep = sqlExpressions(calendar)
    .map((e) => e.text)
    .find((t) => /^\s*DELETE FROM oauth_state_tokens WHERE expires_at </.test(t));
  assert.ok(sweep, 'the calendar sweep statement is gone from calendar.ts');
  const shipped = sweep.replace(new RegExp(INTERP, 'g'), '?');

  const fixture = () => {
    // Production's shape: integrations/oauth.ts's columns plus the expires_at
    // calendar.ts ALTERs in, NOT NULL DEFAULT ''.
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE oauth_state_tokens (state TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
      provider TEXT NOT NULL, pkce_verifier TEXT, extra_json TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, consumed_at TIMESTAMP,
      expires_at TEXT NOT NULL DEFAULT '')`);
    // What integrations/oauth.ts:93 inserts — five columns, no expires_at.
    db.exec(`INSERT INTO oauth_state_tokens (state, user_id, provider, pkce_verifier, extra_json)
             VALUES ('salesforce-handshake', 1, 'salesforce', 'v', '{}')`);
    db.exec(`INSERT INTO oauth_state_tokens (state, user_id, provider, expires_at)
             VALUES ('calendar-expired', 1, 'google', '2000-01-01T00:00:00.000Z')`);
    return db;
  };
  const now = '2026-09-22T12:00:00.000Z';
  const survivors = (stmt: string) => {
    const db = fixture();
    db.prepare(stmt).run(now);
    return db.prepare('SELECT state FROM oauth_state_tokens ORDER BY state').all().map((r: any) => r.state);
  };

  // Before: `'' < <any ISO stamp>` is true in SQLite, so the sweep took the row
  // a provider handshake was waiting on.
  assert.deepEqual(
    survivors(`DELETE FROM oauth_state_tokens WHERE expires_at < ?`),
    [],
    'the unclause-d sweep no longer reproduces the defect — the fixture is wrong, not the fix',
  );
  // After: only the genuinely expired calendar row goes.
  assert.deepEqual(survivors(shipped), ['salesforce-handshake']);
});

// ---------------------------------------------------------------------------
// Wiring

test('the guard runs in test:guards and is documented', () => {
  assert.match(read('package.json'), /node --no-warnings scripts\/check-schema-pair-drift\.mjs/,
    'the guard is not in test:guards, so nothing runs it on a PR');
  const readme = read('scripts/README.md');
  const row = readme.split('\n').find((l) => l.includes('`check-schema-pair-drift.mjs`')) || '';
  assert.ok(row, 'add the check-schema-pair-drift.mjs row to scripts/README.md');
  assert.match(row, /`schema-pair-drift-baseline\.json`/, 'the README row no longer names its ledger');
  assert.match(row, /ALTER/, 'the README row dropped the ALTER-awareness, which is what keeps it off partner_profiles');
  assert.match(row, /stale entry/, 'the README row dropped the stale-entry refusal');
});

test('importing the guard does not run the scan', () => {
  // It calls process.exit(1) on a finding, so an unguarded module body would
  // kill this test process the moment any pair drifted.
  assert.match(read('scripts/check-schema-pair-drift.mjs'),
    /if \(import\.meta\.url === `file:\/\/\$\{process\.argv\[1\]\}`\) \{/);
});
