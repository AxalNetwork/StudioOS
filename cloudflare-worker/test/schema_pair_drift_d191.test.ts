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
  runtimeDefinitionsFrom,
  maskCode,
  enclosingFunction,
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
  const shipped = sweep.replaceAll(INTERP, '?');  // a literal swap; no regex to assemble

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
// D192 — the runtime side was blind two ways, and both are driven by fixtures
//
// Fixtures rather than the tree, deliberately: a test that can only read
// `cloudflare-worker/src` cannot show that REVERSING either fix brings a
// finding back, and that half is what makes these guards rather than
// descriptions of whatever the repo happens to contain today.

const FX_A = '/fx/routes/a.ts';
const FX_B = '/fx/services/b.ts';

/** `[name, type]` pairs a fixture's CREATE-bearing file ends up carrying. */
const altersFor = (files: Record<string, string>, table: string) => {
  const defs = runtimeDefinitionsFrom(new Map(Object.entries(files)));
  const list = defs.get(table) || [];
  return list.flatMap((d: any) => d.alters.map((a: [string, string]) => a[0])).sort();
};

test('an ALTER written ABOVE its own CREATE, in one function, is not dropped', () => {
  // routes/legalcap.ts is this shape: six `ALTER TABLE subsidiaries` at :22-29
  // and the matching CREATE at :55, in ONE ensureSchema. The walk was a single
  // forward pass, so at the ALTER the table was not yet in the file's map and
  // all six were dropped — which is why the ledger carried a
  // `superset:subsidiaries` entry telling the next reader to widen a CREATE
  // whose own function already adds those columns thirty lines earlier.
  assert.deepEqual(
    altersFor({
      [FX_A]: `
        async function ensureSchema(env) {
          for (const a of ['ALTER TABLE widgets ADD COLUMN spinout_status TEXT']) {
            await env.DB.prepare(a).run();
          }
          await env.DB.exec("CREATE TABLE IF NOT EXISTS widgets (id INTEGER)");
        }`,
    }, 'widgets'),
    ['spinout_status'],
    'an ALTER above its CREATE was dropped — the pass is forward-only again',
  );
});

test('a helper awaited from the CREATE’s own bootstrap carries its columns across', () => {
  // routes/brand.ts:99 — `await ensureLandingPageBrandKitColumns(env)` inside
  // the same ensureSchema that creates landing_pages, after the CREATEs and
  // before the memo lands. By the time that bootstrap returns the table is at
  // its full shape, so the pair never diverged; the guard could not see it
  // because its runtime side was file-scoped while its SQL side was not.
  assert.deepEqual(
    altersFor({
      [FX_A]: `
        import { widen } from '../services/b';
        async function ensureSchema(env) {
          await env.DB.exec("CREATE TABLE IF NOT EXISTS widgets (id INTEGER)");
          await widen(env);
        }`,
      [FX_B]: `
        export async function widen(env) {
          await env.DB.exec("ALTER TABLE widgets ADD COLUMN extra TEXT");
        }`,
    }, 'widgets'),
    ['extra'],
    'the hop through the bootstrap did not resolve',
  );
});

test('the same helper awaited OUTSIDE the bootstrap does not', () => {
  // FUNCTION scope, not file scope, and this is the assertion that proves the
  // difference. A helper called from somewhere else in the file runs on a path
  // the CREATE’s own bootstrap does not take, so its columns are not owed to
  // this definition — which is exactly routes/settings.ts against
  // services/authBlockersSchema.ts before D192 repaired it, and exactly why a
  // repo-wide union was rejected: it would have cleared the one entry on the
  // ledger that was genuinely a defect.
  assert.deepEqual(
    altersFor({
      [FX_A]: `
        import { widen } from '../services/b';
        async function ensureSchema(env) {
          await env.DB.exec("CREATE TABLE IF NOT EXISTS widgets (id INTEGER)");
        }
        export async function someHandler(env) {
          await widen(env);
        }`,
      [FX_B]: `
        export async function widen(env) {
          await env.DB.exec("ALTER TABLE widgets ADD COLUMN extra TEXT");
        }`,
    }, 'widgets'),
    [],
    'a call outside the bootstrap was counted — the hop is file-scoped, not function-scoped',
  );
});

test('a helper the file does not import is never hopped to', () => {
  // The import map is load-bearing: without it any same-named function
  // anywhere in the corpus would do, and the hop would resolve by coincidence.
  assert.deepEqual(
    altersFor({
      [FX_A]: `
        async function ensureSchema(env) {
          await env.DB.exec("CREATE TABLE IF NOT EXISTS widgets (id INTEGER)");
          await widen(env);
        }`,
      [FX_B]: `
        export async function widen(env) {
          await env.DB.exec("ALTER TABLE widgets ADD COLUMN extra TEXT");
        }`,
    }, 'widgets'),
    [],
    'an unimported name resolved — the hop is not reading the import map',
  );
});

test('maskCode blanks a literal and a comment without moving any index', () => {
  const src = `const a = 'x{y'; // }\nconst b = 1;`;
  const masked = maskCode(src);
  assert.equal(masked.length, src.length, 'masking moved the indices it is supposed to preserve');
  assert.equal(masked.indexOf('const b'), src.indexOf('const b'));
  assert.ok(!masked.includes('{'), 'a brace inside a string survived the mask');
  assert.ok(!masked.slice(src.indexOf('//')).includes('}'), 'a brace inside a comment survived the mask');
});

test('an UNBALANCED brace in a comment does not close the enclosing function early', () => {
  // Brace-matching raw source would end the body at the stray `}` — before the
  // helper call — and the hop would silently find nothing, which is a false
  // finding with no symptom to notice it by.
  //
  // MEASURED, not imagined: eight files under cloudflare-worker/src carry an
  // unbalanced brace inside a literal or a comment today
  // (routes/events.ts, routes/financials.ts, routes/market_intel.ts,
  // services/captable.ts, services/competitorAnalysis.ts, services/csv.ts,
  // services/deckExtract.ts, integrations/providers/docusign.ts). The fixture
  // below is constructed rather than sampled — a balanced `DEFAULT '{}'`, which
  // is what the first draft of this test used, exercises nothing, because the
  // brace it adds is cancelled by its own partner.
  assert.deepEqual(
    altersFor({
      [FX_A]: `
        import { widen } from '../services/b';
        async function ensureSchema(env) {
          await env.DB.exec("CREATE TABLE IF NOT EXISTS widgets (id INTEGER)");
          // the caller closes its own block here } and this brace is prose
          await widen(env);
        }`,
      [FX_B]: `
        export async function widen(env) {
          await env.DB.exec("ALTER TABLE widgets ADD COLUMN extra TEXT");
        }`,
    }, 'widgets'),
    ['extra'],
    'a stray `}` in a comment closed the function body',
  );
});

test('enclosingFunction steps over control blocks and return annotations', () => {
  // `): Promise<void> {` is the shape EVERY bootstrap in this tree is written
  // in, so a test for `) {` alone would pass while the guard saw nothing. And
  // an `if (…) { … }` around the CREATE must not be mistaken for the body, or
  // a helper called after the block is out of scope.
  const src = [
    'async function ensureSchema(env: Env): Promise<void> {',
    '  if (cold) {',
    '    await env.DB.exec("CREATE TABLE IF NOT EXISTS widgets (id INTEGER)");',
    '  }',
    '  await widen(env);',
    '}',
  ].join('\n');
  const masked = maskCode(src);
  const fn = enclosingFunction(masked, src.indexOf('CREATE TABLE'));
  assert.ok(fn, 'no enclosing function found for a `): Promise<void> {` bootstrap');
  assert.ok(
    masked.slice(fn.start, fn.end).includes('await widen('),
    'the `if` block was taken for the function body, so the helper fell out of scope',
  );
});

// ---------------------------------------------------------------------------
// D192 — the three bootstraps that read columns they do not create
//
// Each is PAIRED against real SQLite: the CREATE alone is what a database this
// bootstrap reached first actually has, and it must fail the file's own reader;
// the CREATE plus the columns the repaired bootstrap now pulls in must not.
// Both halves are read off the tree, so removing the `await` empties the second
// half and the test fails rather than quietly asserting nothing.

const runtimeDef = (table: string, where: RegExp) => {
  const d = (runtimeDefinitions().get(table) || []).find((x: any) => where.test(x.where));
  assert.ok(d, `no runtime definition of ${table} matching ${where}`);
  return d as any;
};

const built = (def: any, withAlters: boolean) => {
  // Foreign keys off: these fixtures build ONE table to ask whether a column
  // exists on it, and advisor_messages REFERENCES advisor_conversations. Node
  // enables the constraints by default, so without this the "after" half fails
  // on a missing parent table and reads as the repair not having landed.
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(def.create);
  if (withAlters) {
    for (const [name, type] of def.alters) {
      try { db.exec(`ALTER TABLE ${def.create.match(/CREATE TABLE (\w+)/)![1]} ADD COLUMN ${name} ${type}`); } catch { /* replay */ }
    }
  }
  return db;
};

test('settings.ts: the step-up UPDATE throws on its own CREATE and lands after the hop', () => {
  const def = runtimeDef('user_sessions', /routes\/settings\.ts/);
  // Read off disk rather than retyped, so the test cannot drift from the code.
  const update = sqlExpressions(read('cloudflare-worker/src/routes/settings.ts'))
    .map((e) => e.text)
    .find((t) => /^\s*UPDATE user_sessions\s+SET factor = 'totp'/.test(t));
  assert.ok(update, "settings.ts's step-up UPDATE is gone — re-aim this test");
  const stmt = update!.replaceAll(INTERP, '?');

  const drive = (db: any) => {
    db.exec(`INSERT INTO user_sessions (user_id, jti) VALUES (1, 'j')`);
    db.prepare(stmt).run('2026-09-22T12:00:00.000Z', 'j', 1);
    return db.prepare(`SELECT factor, assurance_level, last_step_up_at FROM user_sessions WHERE jti = 'j'`).get();
  };

  // BEFORE: eight columns, and the UPDATE names four more.
  assert.throws(() => drive(built(def, false)), /no such column/i,
    'the CREATE alone no longer reproduces the defect — the fixture is wrong, not the fix');
  // AFTER: the four arrive from services/authBlockersSchema.ts, awaited at the
  // end of settings.ts's own ensureSchema.
  const row: any = drive(built(def, true));
  assert.equal(row.factor, 'totp');
  assert.equal(row.assurance_level, 'full');
  assert.equal(row.last_step_up_at, '2026-09-22T12:00:00.000Z');
});

test('advisor.ts: the turn INSERT degrades SILENTLY, so the columns must be read back', () => {
  // The worst of the three, and the reason this one asserts values rather than
  // that the call resolved: advisor.ts catches "no such column: safety_score"
  // and RETRIES in a legacy five-column form, so before the repair every turn's
  // safety score and sanitisation record is dropped and the write still
  // succeeds. A test that only checked for an absence of throw would pass on
  // the defect.
  const def = runtimeDef('advisor_messages', /routes\/advisor\.ts/);
  const insert = sqlExpressions(read('cloudflare-worker/src/routes/advisor.ts'))
    .map((e) => e.text)
    .find((t) => /^INSERT INTO advisor_messages \(conversation_id, role, question_id, content, meta_json, safety_score/.test(t));
  assert.ok(insert, "advisor.ts's wide turn INSERT is gone — re-aim this test");
  const stmt = insert!.replace(/VALUES \([^)]*\)/, 'VALUES (?, ?, ?, ?, ?, ?, ?)');

  const drive = (db: any) => {
    db.prepare(stmt).run(1, 'user', null, 'hello', null, 0.25, '["redact"]');
    return db.prepare(`SELECT safety_score, sanitisation_actions_json FROM advisor_messages`).get();
  };

  // Two phrasings, because SQLite words an INSERT's missing column differently
  // from a SELECT's or an UPDATE's — the narrow regex failed this test once on
  // a fixture that was reproducing the defect perfectly.
  assert.throws(() => drive(built(def, false)), /no such column|has no column named/i,
    'the CREATE alone no longer reproduces the defect — the fixture is wrong, not the fix');
  const row: any = drive(built(def, true));
  assert.equal(row.safety_score, 0.25);
  assert.equal(row.sanitisation_actions_json, '["redact"]');
});

test('admin_audit_log has ONE runtime definition, and it carries the four viewer columns', () => {
  // routes/monitoring_analytics.ts declared a nine-column CREATE for this table
  // while its own /audit/mine read names viewed_user_id. It was the only module
  // in the worker with a second CREATE; it is deleted, not widened.
  const defs = runtimeDefinitions().get('admin_audit_log') || [];
  assert.equal(defs.length, 1, `admin_audit_log has ${defs.length} runtime definitions: ${defs.map((d: any) => d.where).join(', ')}`);
  assert.match(defs[0].where, /routes\/admin\.ts/);
  const cols = new Set((shapeOf(defs[0], 'admin_audit_log').cols || []).map((c: any) => c.name || c));
  for (const c of ['viewed_user_id', 'conversation_id', 'viewed_at', 'actor']) {
    assert.ok(cols.has(c), `admin_audit_log's one definition lost ${c}`);
  }
  // The narrow shape is a literal because it is the DELETED code; nothing on
  // disk holds it any more. It must still fail the read it used to serve.
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE admin_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_user_id INTEGER NOT NULL, action TEXT NOT NULL, report_type TEXT, format TEXT, filters_json TEXT, storage_key TEXT, download_url TEXT, exported_at TEXT)");
  assert.throws(
    () => db.prepare('SELECT viewed_user_id FROM admin_audit_log').get(),
    /no such column/i,
    'the deleted nine-column shape no longer reproduces the defect',
  );
  // And the index monitoring_analytics.ts used to create came across with it.
  assert.match(read('cloudflare-worker/src/routes/admin.ts'), /idx_admin_audit_action_ts/,
    'idx_admin_audit_action_ts was deleted with the narrow CREATE rather than moved');
  assert.doesNotMatch(read('cloudflare-worker/src/routes/monitoring_analytics.ts'),
    /CREATE TABLE IF NOT EXISTS admin_audit_log/,
    'monitoring_analytics.ts declares admin_audit_log again');
});

test('user_sessions.factor is declared once, beside the columns it is read with', () => {
  // It lived in services/authSms.ts's MODULE-PRIVATE ensureSchema, which is
  // what left routes/settings.ts with nothing to import and a second
  // declaration as its only repair.
  const blockers = read('cloudflare-worker/src/services/authBlockersSchema.ts');
  const sms = read('cloudflare-worker/src/services/authSms.ts');
  assert.match(blockers, /ALTER TABLE user_sessions ADD COLUMN factor TEXT/);
  const smsAlters = sqlExpressions(sms).map((e) => e.text)
    .filter((t) => /^ALTER TABLE user_sessions\b/i.test(t));
  assert.deepEqual(smsAlters, [], `authSms.ts still declares ${smsAlters.join(', ')}`);
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
