/**
 * D187 — `partner_profiles` is one table, not three, and every reader's
 * columns exist on it.
 *
 * THE COLLISION THIS GUARDS. The table was declared three times in two
 * shapes — `migrations/028_partner_deals.sql:34` (id / invitation_id / …),
 * `schema_baseline.sql:3297` (email PRIMARY KEY / …) and a runtime
 * `CREATE TABLE IF NOT EXISTS` in `routes/profiling.ts` — and a
 * CREATE TABLE IF NOT EXISTS cannot add a column to a table that already
 * exists, so which shape a database ended up with depended on which ran
 * first. Production got the email-keyed one, so `writeRouter.ts`,
 * `partner_onboarding.ts` and `partners.ts` were all reading columns that
 * were not there. That is the metrics_snapshots collision (#183, #202) for a
 * third time, and it is the reason the FIRST assertion below is the important
 * one: the runtime bootstrap and the migration must declare the same set, or
 * the next database is a coin flip again.
 *
 * THE USER-VISIBLE HALF. `ensurePartnerProfile`'s opening statement named
 * `id`, threw, was swallowed by its own catch, and returned null — so all six
 * partner questions in the advisor chat answered "Partner profile not bound
 * yet — accept your invitation from the Partner Portal first" to 26 of 51
 * accounts, while production held ZERO partner_invitations. The round-trip
 * test below is what stops that returning: it does not merely check that a
 * query prepares (D186's lesson — five of its twelve mutations passed a
 * preparability check), it saves an answer and reads it back as answered.
 *
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/partner_profiles_single_shape_d187.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { routeAnswer, hydrateAlreadyAnswered } from '../src/services/advisor/writeRouter.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(HERE, '../sql');
const MIGRATIONS = resolve(SQL, 'migrations');
const SRC = resolve(HERE, '../src');
const read = (p: string) => readFileSync(p, 'utf8');

const MIGRATION_275 = read(resolve(MIGRATIONS, '275_partner_profiles_columns.sql'));
const PROFILING = read(resolve(SRC, 'routes/profiling.ts'));
const WRITE_ROUTER = read(resolve(SRC, 'services/advisor/writeRouter.ts'));
const ONBOARDING = read(resolve(SRC, 'routes/partner_onboarding.ts'));
const PARTNERS = read(resolve(SRC, 'routes/partners.ts'));

/** A freshly provisioned environment: the baseline, then every migration past it. */
function freshDb(): InstanceType<typeof DatabaseSync> {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(read(resolve(SQL, 'schema_baseline.sql')));
  for (const name of readdirSync(MIGRATIONS)
    .filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF)
    .sort((a, b) => migrationNumber(a) - migrationNumber(b) || a.localeCompare(b))) {
    for (const stmt of splitStatements(read(resolve(MIGRATIONS, name)))) {
      try { db.exec(stmt); } catch { /* fresh-build failures are migrations_fresh_build's to report */ }
    }
  }
  return db;
}

const columnsOf = (db: InstanceType<typeof DatabaseSync>, table: string): Set<string> =>
  new Set((db.prepare(`SELECT name FROM pragma_table_info(?)`).all(table) as any[]).map((r) => r.name));

// --- what each source DECLARES, harvested rather than typed out -------------

/** The ADD COLUMN names in migration 275. */
function migration275Columns(): string[] {
  return [...MIGRATION_275.matchAll(/ALTER TABLE partner_profiles ADD COLUMN\s+(\w+)/g)].map((m) => m[1]);
}

/** The NEW_COLUMNS tuples profiling.ts's runtime bootstrap ALTERs on. */
function profilingBootstrapColumns(): string[] {
  const from = PROFILING.indexOf('const NEW_COLUMNS');
  assert.ok(from > 0, 'NEW_COLUMNS is gone from profiling.ts — this test is aimed at nothing');
  const to = PROFILING.indexOf('];', from);
  assert.ok(to > from, 'the NEW_COLUMNS array is unterminated');
  return [...PROFILING.slice(from, to).matchAll(/\[\s*'(\w+)'\s*,/g)].map((m) => m[1]);
}

/** The columns the three readers name on partner_profiles. */
function readerColumns(): Map<string, string[]> {
  const out = new Map<string, string[]>();

  // writeRouter's partnerMap values are the advisor bank's six targets.
  const mapFrom = WRITE_ROUTER.indexOf('const partnerMap');
  assert.ok(mapFrom > 0, 'partnerMap is gone from writeRouter.ts');
  const mapTo = WRITE_ROUTER.indexOf('};', mapFrom);
  out.set('writeRouter partnerMap', [
    ...[...WRITE_ROUTER.slice(mapFrom, mapTo).matchAll(/:\s*'(\w+)',/g)].map((m) => m[1]),
    'email', 'user_id', 'invitation_id', 'raw_chat_json', 'full_name', 'updated_at',
  ]);

  // partner_onboarding's upsert column list.
  const insFrom = ONBOARDING.indexOf('INSERT INTO partner_profiles');
  assert.ok(insFrom > 0, 'the partner_onboarding upsert is gone');
  const insTo = ONBOARDING.indexOf(')', ONBOARDING.indexOf('(', insFrom));
  out.set('partner_onboarding upsert', ONBOARDING.slice(ONBOARDING.indexOf('(', insFrom) + 1, insTo)
    .split(',').map((c) => c.trim()).filter((c) => /^\w+$/.test(c)));

  // partners.ts's capacity read.
  const cap = /SELECT ([\w, ]+) FROM partner_profiles/.exec(PARTNERS);
  assert.ok(cap, "partners.ts no longer reads partner_profiles");
  out.set('partners capacity read', cap![1].split(',').map((c) => c.trim()));

  return out;
}

// ---------------------------------------------------------------------------

test('the runtime bootstrap and migration 275 declare the same columns', () => {
  // THE ASSERTION THE COLLISION EXISTS FOR. profiling.ts's CREATE TABLE IF NOT
  // EXISTS cannot add a column to a table that is already there, and migration
  // 275 cannot run on a database the bootstrap built from scratch after the
  // runner had finished. Fix one and leave the other stale and which shape a
  // database ends up with is back to which ran first.
  const mig = migration275Columns();
  const boot = profilingBootstrapColumns();
  assert.ok(mig.length >= 17, `migration 275 adds only ${mig.length} columns — it was trimmed`);

  const missingFromBootstrap = mig.filter((c) => !boot.includes(c));
  assert.deepEqual(missingFromBootstrap, [],
    'migration 275 adds columns routes/profiling.ts\'s NEW_COLUMNS does not, so a database built by '
    + 'that bootstrap alone would lack them — which is exactly how this collision started');
});

test('every column the three readers name exists on a freshly provisioned table', () => {
  // Harvested from the source rather than typed, so a fourth reader added
  // later is covered without anyone remembering to extend a list here.
  const have = columnsOf(freshDb(), 'partner_profiles');
  assert.ok(have.size >= 39, `partner_profiles has ${have.size} columns — migration 275 did not apply`);

  const problems: string[] = [];
  for (const [who, cols] of readerColumns()) {
    assert.ok(cols.length > 0, `${who} yielded no columns — the extractor broke, not the schema`);
    for (const c of cols) if (!have.has(c)) problems.push(`${who}: ${c}`);
  }
  assert.deepEqual(problems, [],
    `a reader names a column a provisioned partner_profiles does not have: ${problems.join('; ')}`);

  // `id` must NOT come back. D187's decision is that production's email-keyed
  // shape wins; a second identity column is how a fourth shape would start.
  assert.equal(have.has('id'), false,
    'partner_profiles grew an `id` column — the table is keyed on email (D187, migration 275)');
  assert.equal(have.has('email'), true);
});

test('a partner answer is saved and reads back as answered', async () => {
  // THE ROUND TRIP, END TO END. Preparability is not the bar: before D187 the
  // reader's `SELECT *` prepared perfectly and simply never found the field,
  // so the chat re-asked all six questions forever.
  const db = freshDb();
  const env = { DB: d1Over(db) } as any;
  db.prepare(`INSERT INTO users (email, name, role) VALUES (?, ?, 'partner')`)
    .run('p@t.test', 'Partner One');
  const id = Number((db.prepare('SELECT last_insert_rowid() AS id').get() as any).id);
  const user = { id, email: 'p@t.test', name: 'Partner One', role: 'partner' } as any;

  const res = await routeAnswer(env, user, 'partner.conflicts.list', 'None to declare.');
  assert.equal(res.status, 'saved',
    `the partner bank refused a partner: ${res.status} ${res.hint || res.error || ''}`);
  assert.equal(res.saved_to?.column, 'conflicts_text',
    'the answer landed in the raw_chat_json fallback rather than its own column — '
    + 'the column is missing again');

  const row = db.prepare(`SELECT conflicts_text FROM partner_profiles WHERE email = ?`)
    .get('p@t.test') as any;
  assert.equal(row?.conflicts_text, 'None to declare.');

  const answered = await hydrateAlreadyAnswered(env, user);
  assert.equal(answered.has('partner.conflicts.list'), true,
    'the answer was stored and does not read back as answered, so the chat asks again — '
    + 'the defect from the reader side');
});

test('the advisor never mints an invitation, and never rebinds another account\'s profile', async () => {
  const db = freshDb();
  const env = { DB: d1Over(db) } as any;
  db.prepare(`INSERT INTO users (email, name, role) VALUES (?, ?, 'partner')`).run('a@t.test', 'A');
  const a = Number((db.prepare('SELECT last_insert_rowid() AS id').get() as any).id);
  db.prepare(`INSERT INTO users (email, name, role) VALUES (?, ?, 'partner')`).run('b@t.test', 'B');
  const b = Number((db.prepare('SELECT last_insert_rowid() AS id').get() as any).id);

  await routeAnswer(env, { id: a, email: 'a@t.test', name: 'A', role: 'partner' } as any,
    'partner.firm.name', 'Acme');

  // The old step 3 wrote a fake partner_invitations row flagged 'advisor_stub'
  // purely to satisfy shape 1's `invitation_id NOT NULL UNIQUE`. On an
  // email-keyed row that side effect is unnecessary, and a chat message should
  // never mint an invitation.
  const invs = db.prepare(`SELECT COUNT(*) AS c FROM partner_invitations`).get() as any;
  assert.equal(Number(invs.c), 0,
    'answering a chat question created a partner_invitations row as a side effect');

  // B's account must not capture A's profile.
  db.prepare(`UPDATE partner_profiles SET email = 'a@t.test' WHERE email = 'a@t.test'`).run();
  const res = await routeAnswer(env, { id: b, email: 'a@t.test', name: 'B', role: 'partner' } as any,
    'partner.firm.name', 'Hijack');
  assert.equal(res.status, 'noop',
    'a second account wrote into a partner profile owned by someone else');
  const owner = db.prepare(`SELECT user_id, organization FROM partner_profiles WHERE email = 'a@t.test'`)
    .get() as any;
  assert.equal(Number(owner.user_id), a);
  assert.equal(owner.organization, 'Acme', 'the refused write changed the row anyway');
});

test('the invitation upsert runs, keys on the table\'s own key, and does not duplicate', () => {
  // The statement is taken FROM THE SOURCE and executed, not paraphrased: the
  // defect was that every column it names was absent, so a test that restated
  // the SQL would have passed against the broken route. Running the shipped
  // text is what makes this an assertion about partner_onboarding.ts.
  const from = ONBOARDING.indexOf('INSERT INTO partner_profiles');
  const to = ONBOARDING.indexOf('`,', from);
  assert.ok(from > 0 && to > from, 'the partner_onboarding upsert moved');
  const sql = ONBOARDING.slice(from, to);
  const placeholders = (sql.match(/\?/g) || []).length;

  assert.match(sql, /ON CONFLICT\(email\)/,
    'the upsert conflicts on something other than email — email is the table\'s primary key, and '
    + 'conflicting elsewhere inserts a second, key-less row beside a profile that already exists');

  const db = freshDb();
  db.prepare(`INSERT INTO users (email, name, role) VALUES ('hq@t.test', 'HQ', 'admin')`).run();
  const inviter = Number((db.prepare('SELECT last_insert_rowid() AS id').get() as any).id);
  db.prepare(`INSERT INTO partner_invitations (token, recipient_email, invited_by_user_id, expires_at)
              VALUES ('tok', 'inv@t.test', ?, '2030-01-01')`).run(inviter);
  const invId = Number((db.prepare('SELECT last_insert_rowid() AS id').get() as any).id);

  const binds = (org: string) => [
    'inv@t.test', invId, 'Full Name', org, 'Role', 'expertise', 'sectors', 'geo',
    '5', 100000, 'motivation', 'prior', 'https://x.test', '{}',
  ].slice(0, placeholders);

  const stmt = db.prepare(sql);
  stmt.run(...binds('Acme'));
  stmt.run(...binds('Acme II'));   // the upsert half — same invitation, same address

  const rows = db.prepare(`SELECT organization FROM partner_profiles WHERE email = 'inv@t.test'`).all() as any[];
  assert.equal(rows.length, 1, `the upsert inserted ${rows.length} rows for one invitation`);
  assert.equal(rows[0].organization, 'Acme II', 'the second submission did not update the row');
  assert.equal(
    Number((db.prepare(`SELECT invitation_id AS i FROM partner_profiles WHERE email = 'inv@t.test'`).get() as any).i),
    invId, 'the profile is not linked back to its invitation');
});
