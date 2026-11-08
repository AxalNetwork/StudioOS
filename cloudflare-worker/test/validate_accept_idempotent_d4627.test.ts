/**
 * D4627 (#4627) — proposal identity as the idempotency key for the Validate
 * accept paths, against REAL writers and REAL concurrency/fault injection,
 * not source-text ordering.
 *
 *   · THE ORDINARY ROUTE'S PARTIAL FAILURE (the issue's "General proposal
 *     partial failure"). `founder_validate.ts`'s accept route already claims
 *     the row before writing (`WHERE status = 'pending'`, checked by its
 *     affected-row count) and reverts the claim on a failed write — but a
 *     failure AFTER `spec.apply` creates the target and BEFORE `recordFill`
 *     records it used to leave that target orphaned, and a retry allocated a
 *     SECOND `Hn` next to it. `insertHypothesisStatement`'s
 *     `ON CONFLICT(source_proposal_id)` (migration 202611071547) is what
 *     this pins: a retry lands on the SAME row.
 *   · TWO OVERLAPPING ACCEPTS of the same proposal. The claim-before-write
 *     order already closes this for the ordinary route; this file proves it
 *     against a real D1-shaped database and two real, interleaved requests
 *     rather than reading the source for the right substrings.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/validate_accept_idempotent_d4627.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { DatabaseSync } from 'node:sqlite';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import founderValidate from '../src/routes/founder_validate.ts';
import { compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const SQL = new URL('../sql/', import.meta.url);
const BASELINE = readFileSync(new URL('schema_baseline.sql', SQL), 'utf8');
const MIGRATIONS = readdirSync(new URL('migrations/', SQL)).filter((f) => f.endsWith('.sql')).sort(compareMigrations);
const migration = (name: string) => readFileSync(new URL(`migrations/${name}`, SQL), 'utf8');
const ADMIN = 1;

/** A table as production has it: the baseline's, plus every later migration's ADD COLUMN for it. */
function build(db: any, table: string, create?: string) {
  db.exec(create ?? tableFromBaseline(BASELINE, table));
  const have = () => new Set((db.prepare(`PRAGMA table_info(${table})`).all() as any[]).map((c: any) => c.name));
  const re = new RegExp(`ALTER TABLE ${table} ADD COLUMN ([a-z_0-9]+)([^;]*);`, 'g');
  for (const f of MIGRATIONS) {
    for (const m of migration(f).matchAll(re)) {
      if (!have().has(m[1])) db.exec(`ALTER TABLE ${table} ADD COLUMN ${m[1]}${m[2]};`);
    }
  }
}

function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, name TEXT, role TEXT, is_active INTEGER DEFAULT 1);");
  db.prepare('INSERT INTO users (id, email, name, role) VALUES (1, ?, ?, ?)').run('admin@example.test', 'Admin', 'admin');
  db.exec(`CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, founder_id INTEGER, company_id INTEGER);
           INSERT INTO projects (id, name, founder_id) VALUES (7, 'Harbour', NULL);`);
  build(db, 'hypotheses');
  // D4627 (#4627): the partial unique index `insertHypothesisStatement` upserts
  // against. `build()` only replays `ADD COLUMN` lines, never a `CREATE INDEX`,
  // so the fixture adds it by hand — the same way `fills_registry.test.ts`'s
  // `freshDb()` already adds `idx_hypotheses_project_code`.
  db.exec(`CREATE UNIQUE INDEX idx_hypotheses_source_proposal ON hypotheses (source_proposal_id) WHERE source_proposal_id IS NOT NULL;`);
  db.exec('DROP TABLE IF EXISTS activity_logs');
  db.exec(`CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, user_id INTEGER,
    entity_type TEXT, entity_id TEXT, action TEXT NOT NULL, details TEXT, actor TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));`);
  build(db, 'validate_proposals');
  const fillProvenanceDDL = () => {
    const src = migration('246_fills_the_blanks_everywhere.sql');
    const at = src.indexOf('CREATE TABLE IF NOT EXISTS fill_provenance');
    return src.slice(at, src.indexOf(');', at) + 2);
  };
  build(db, 'fill_provenance', fillProvenanceDDL());
  const env: any = { DB: d1Over(db), JWT_SECRET: 'd4627-fixture-only-secret', ENVIRONMENT: 'development' };
  return { db, env };
}

/** A pending `hypothesis` proposal, as the propose route writes one. */
function proposeHypothesis(db: any, claim: string): number {
  const ins = db.prepare(
    `INSERT INTO validate_proposals (project_id, kind, payload_json, task, created_by, surface, fill_class, target_ref)
     VALUES (7, 'hypothesis', ?, 'validate_draft_hypotheses', 1, 'validate/hypotheses', 'restatement', 'hypotheses')`,
  ).run(JSON.stringify({ claim }));
  return Number(ins.lastInsertRowid);
}

async function accept(env: any, id: number) {
  const jwt = await new SignJWT({ user_id: ADMIN }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(env.JWT_SECRET));
  const app = new Hono();
  app.onError((e: any, c) => c.json({ detail: String(e?.message) }, (AUTH_ERROR_STATUSES[e?.message] || 500) as any));
  app.route('/api/founder/validate', founderValidate);
  const r = await app.request(`/api/founder/validate/proposals/${id}/accept`, {
    method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: '{}',
  }, env);
  return { status: r.status, body: await r.json().catch(() => null) as any };
}

/**
 * Wraps a D1 shim so the FIRST matching statement's `run`/`first`/`all`
 * throws, then every later call (including a later call to the SAME
 * statement text, which is exactly what a retry sends) goes through for
 * real. This is what stands in for "the write died mid-request" — a crash,
 * a dropped connection, a D1 500 — between two of the accept route's writes.
 */
function flaky(DB: any, matches: (sql: string) => boolean, timesToFail = 1) {
  let left = timesToFail;
  return {
    prepare(sql: string) {
      const real = DB.prepare(sql);
      if (!matches(sql)) return real;
      const api: any = {
        bind(...a: any[]) { real.bind(...a); return api; },
        all: async () => { if (left > 0) { left -= 1; throw new Error('injected failure'); } return real.all(); },
        first: async (c?: string) => { if (left > 0) { left -= 1; throw new Error('injected failure'); } return real.first(c); },
        run: async () => { if (left > 0) { left -= 1; throw new Error('injected failure'); } return real.run(); },
      };
      return api;
    },
    batch: (stmts: any[]) => DB.batch(stmts),
    exec: (sql: string) => DB.exec(sql),
  };
}

test('D4627: a failure between creating the hypothesis and recording its provenance reverts to pending, and a retry lands on the SAME hypothesis', async () => {
  const { db, env } = world();
  const id = proposeHypothesis(db, 'Ops leads will pay to stop reconciling by hand.');

  // ATTEMPT 1: `apply` (the INSERT into `hypotheses`) succeeds; the very next
  // write, `recordFill`'s INSERT into `fill_provenance`, is made to fail —
  // the exact window the issue names ("a failure after target insertion
  // resets only the proposal to pending").
  env.DB = flaky(env.DB, (sql: string) => sql.includes('INSERT INTO fill_provenance'), 1);
  const first = await accept(env, id);
  assert.equal(first.status, 500, JSON.stringify(first.body));

  const hCount = () => Number((db.prepare('SELECT COUNT(*) AS n FROM hypotheses WHERE project_id = 7').get() as any).n);
  assert.equal(hCount(), 1, 'apply already ran and created the row — it must still be there, not rolled back by hand');
  const row1 = db.prepare('SELECT id, code, claim, source_proposal_id FROM hypotheses').get() as any;
  assert.equal(row1.source_proposal_id, id, 'the orphan target is still addressable by the proposal that made it');
  assert.equal(Number((db.prepare('SELECT COUNT(*) AS n FROM fill_provenance').get() as any).n), 0,
    'the injected failure means no provenance was recorded yet — the target is genuinely untracked');

  const proposalStatus = () => (db.prepare('SELECT status FROM validate_proposals WHERE id = ?').get(id) as any).status;
  assert.equal(proposalStatus(), 'pending', 'reverted — never left "accepted" over an untracked target');

  // ATTEMPT 2 (the retry): the injected failure is spent, so this one goes
  // through for real. Without the D4627 fix, `insertHypothesis` would read
  // `MAX(...)+1` again and allocate a second `Hn`, leaving two hypotheses —
  // the first forever orphaned — for one accepted proposal.
  const second = await accept(env, id);
  assert.equal(second.status, 201, JSON.stringify(second.body));
  assert.equal(hCount(), 1, 'the retry must land on the SAME hypothesis, not allocate a second one');
  const row2 = db.prepare('SELECT id, code, claim, source_proposal_id FROM hypotheses').get() as any;
  assert.equal(row2.id, row1.id, 'same row');
  assert.equal(row2.code, row1.code, 'no new H-code was handed out on the retry');
  assert.equal(second.body.hypothesis.id, row1.id);

  const fp = db.prepare('SELECT target_table, target_row_id, target_column, proposal_id FROM fill_provenance').all() as any[];
  assert.equal(fp.length, 1, 'exactly one provenance row, not one per attempt');
  assert.deepEqual({ ...fp[0] }, { target_table: 'hypotheses', target_row_id: row1.id, target_column: 'claim', proposal_id: id });
  assert.equal(proposalStatus(), 'accepted');
});

test('D4627: a failure between claiming the proposal and applying it also reverts cleanly, with nothing written', async () => {
  // The OTHER recoverable window the acceptance criteria name: "before
  // evidence/provenance" is covered above; this is "after target
  // insertion" moved earlier — before anything is inserted at all, so the
  // only thing to check is that nothing is left half-written.
  const { db, env } = world();
  const id = proposeHypothesis(db, 'Finance teams will switch for an audit trail.');
  env.DB = flaky(env.DB, (sql: string) => sql.includes('INSERT INTO hypotheses'), 1);
  const first = await accept(env, id);
  assert.equal(first.status, 500, JSON.stringify(first.body));
  assert.equal(Number((db.prepare('SELECT COUNT(*) AS n FROM hypotheses').get() as any).n), 0, 'apply itself failed — nothing to orphan');
  assert.equal((db.prepare('SELECT status FROM validate_proposals WHERE id = ?').get(id) as any).status, 'pending');

  const second = await accept(env, id);
  assert.equal(second.status, 201, JSON.stringify(second.body));
  assert.equal(Number((db.prepare('SELECT COUNT(*) AS n FROM hypotheses').get() as any).n), 1);
});

test('D4627: two overlapping accepts of the same hypothesis proposal resolve to one hypothesis, never two', async () => {
  // Real interleaving, not a mocked race: every D1 call in this fixture is
  // `async`, so two in-flight requests genuinely interleave at each `await` —
  // the same way two Workers requests interleave on one D1 connection.
  const { db, env } = world();
  const id = proposeHypothesis(db, 'Buyers delay because onboarding takes three weeks.');
  const [a, b] = await Promise.all([accept(env, id), accept(env, id)]);
  const statuses = [a.status, b.status].sort();
  // One wins (201, the hypothesis created); the other loses the claim and
  // gets the proposal's own 409 for "already decided" — never a second 201.
  assert.deepEqual(statuses, [201, 409], JSON.stringify({ a, b }));
  assert.equal(Number((db.prepare('SELECT COUNT(*) AS n FROM hypotheses WHERE project_id = 7').get() as any).n), 1);
  assert.equal(Number((db.prepare('SELECT COUNT(*) AS n FROM fill_provenance').get() as any).n), 1);
});
