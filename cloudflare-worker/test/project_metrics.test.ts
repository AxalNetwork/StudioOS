/**
 * The founder's KPI form and the Stripe MRR sync start working.
 *
 * WHAT WAS BROKEN, AND HOW LONG IT HID. `metrics_snapshots` was two tables under
 * one name. Production's is the DEAL shape `routes/pipeline.ts` creates at runtime
 * (`deal_id NOT NULL`, `key_metrics`, `traction_score`, `ai_review`).
 * `routes/progress.ts` and `integrations/providers/stripe.ts` wrote a per-project
 * per-day series keyed on `project_id`, with `mrr`, `active_users`, `notes` and
 * `source` — four columns production has never had. Every one of those statements
 * threw `no such column: project_id`.
 *
 * Three things kept it invisible, and each is asserted against here:
 *
 *   · `progress.ts`'s own `ensureMetricsSnapshotsSchema` was believed to "ensure
 *     the founder-metrics shape first" (its caller's comment said so). It could
 *     not: against an existing table it took its ALTER branch, and its required
 *     list held ten metric columns and none of the four that mattered. An ALTER
 *     cannot turn a `deal_id` table into a `project_id` one.
 *   · `check-sqlite-columns` passed, because each writer's own `CREATE TABLE IF
 *     NOT EXISTS` contributed `project_id` and `mrr` to the harvested set and its
 *     INSERT then validated against them — the union limitation that guard's own
 *     docblock names `check-sqlite-table-collisions.mjs` as the complement for.
 *   · `services/saasMetrics.ts`'s docblock asserted the `project_id` shape was
 *     "the LIVE one … what every metrics handler reads". It was the opposite.
 *
 * SO THE FIXTURE IS BUILT FROM MIGRATION 249 ITSELF, never hand-written. A
 * hand-written `project_metrics` is exactly how this would pass while production
 * stayed broken — the same rule `partner_pipeline_stores.test.ts` states, and the
 * failure mode this whole task is.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureProjectMetricsSchema } from '../src/routes/progress.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(HERE, '../sql');
const MIGRATION = readFileSync(`${SQL}/migrations/249_project_metrics.sql`, 'utf8');
const BASELINE = readFileSync(`${SQL}/schema_baseline.sql`, 'utf8');

const PROJECT = 8801;

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
    async batch(x: any[]) { const out = []; for (const st of x || []) out.push(await st.run()); return out; },
  };
}

/** The migration, applied statement by statement, exactly as `migrate-d1` would. */
function applyMigration(db: InstanceType<typeof DatabaseSync>) {
  const sql = MIGRATION.replace(/^\s*--.*$/gm, '');
  for (const stmt of sql.split(';')) {
    if (stmt.trim()) db.exec(stmt);
  }
}

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  applyMigration(db);
  return db;
}

const env = (db: InstanceType<typeof DatabaseSync>) => ({ DB: makeD1(db) } as any);

// ── the migration ─────────────────────────────────────────────────────────────

test('the migration carries no transaction statement, which D1 rejects', () => {
  const code = MIGRATION.replace(/^\s*--.*$/gm, '');
  for (const kw of ['BEGIN', 'COMMIT', 'ROLLBACK', 'END TRANSACTION']) {
    assert.ok(!new RegExp(`\\b${kw}\\b`, 'i').test(code),
      `migration 249 contains ${kw} — D1 rejects it, as migration 200 found`);
  }
});

test('the new table has the five columns whose absence broke both writers', () => {
  const db = freshDb();
  const cols = new Set((db.prepare('PRAGMA table_info(project_metrics)').all() as any[]).map((r) => r.name));
  // These five are the whole bug: `progress.ts:1784` names all of them and
  // `metrics_snapshots` has none of them.
  for (const c of ['project_id', 'mrr', 'active_users', 'notes', 'source']) {
    assert.ok(cols.has(c), `project_metrics is missing ${c}, which is why the old table could not host these writers`);
  }
  // And the ten that `ensureMetricsSnapshotsSchema` used to ALTER in one at a
  // time, so a fresh database needs no self-healing pass at all.
  for (const c of ['arr', 'cac', 'ltv', 'monthly_churn_pct', 'new_users',
    'net_burn', 'cash_balance', 'headcount', 'nrr_pct', 'paying_accounts']) {
    assert.ok(cols.has(c), `project_metrics is missing ${c}`);
  }
  // NO `deal_id`. If this table grows one, the two records have merged again and
  // the whole point of migration 249 is lost.
  assert.ok(!cols.has('deal_id'), 'project_metrics has a deal_id — the two records are merging back together');
});

test('metrics_snapshots is left exactly as production has it', () => {
  // THE OTHER HALF OF THE SEPARATION. The per-deal traction record keeps its
  // table, its readers (`pipeline.ts`, `services/tractionSnapshots.ts`) and its
  // shape. A migration that "fixed" this by adding `project_id` to it would put
  // two records in one table and make every `SELECT *` on the deal side return
  // rows with all-NULL traction fields.
  const at = BASELINE.search(/^CREATE TABLE (?:IF NOT EXISTS )?"?metrics_snapshots"?\s*\(/m);
  assert.ok(at >= 0);
  const body = BASELINE.slice(at, BASELINE.indexOf(');', at));
  assert.match(body, /deal_id INTEGER NOT NULL/, 'the deal table lost its key');
  assert.ok(!/\bproject_id\b/.test(body), 'the baseline metrics_snapshots grew a project_id');
  assert.ok(!/\bmrr\b/.test(body), 'the baseline metrics_snapshots grew an mrr');
  // And nothing in this migration touches it — asserted on the CODE, because the
  // migration's own header explains the collision at length and names the table a
  // dozen times. The same trap #196 hit with a BEGIN/COMMIT assertion that matched
  // the comment saying why there is no BEGIN.
  const code = MIGRATION.replace(/^\s*--.*$/gm, '');
  assert.ok(!/metrics_snapshots/.test(code),
    'migration 249 has a STATEMENT naming metrics_snapshots — it must only create project_metrics');
});

// ── the uniqueness that replaces a delete ─────────────────────────────────────

test('one row per project per day per source, so a re-sync upserts', () => {
  const db = freshDb();
  const ins = db.prepare(
    "INSERT INTO project_metrics (project_id, snapshot_date, mrr, source) VALUES (?,?,?,'stripe') "
    + 'ON CONFLICT(project_id, snapshot_date, source) DO UPDATE SET mrr = excluded.mrr',
  );
  ins.run(PROJECT, '2026-09-13', 1000);
  ins.run(PROJECT, '2026-09-13', 1200);
  const rows = db.prepare("SELECT mrr FROM project_metrics WHERE source = 'stripe'").all() as any[];
  assert.equal(rows.length, 1, 'a re-sync left two rows for one day');
  assert.equal(rows[0].mrr, 1200, 'the later figure did not win');
});

test('a NULL source does not collide, so a founder can log the same day twice', () => {
  const db = freshDb();
  // DELIBERATE, and it is why the index includes `source` rather than being on
  // `(project_id, snapshot_date)` alone. SQLite treats NULLs as distinct in a
  // UNIQUE index. A hand-entered figure is a statement someone made, not a
  // projection to be silently replaced — the route decides whether a second entry
  // updates or adds, and the schema does not decide for it.
  const ins = db.prepare('INSERT INTO project_metrics (project_id, snapshot_date, mrr) VALUES (?,?,?)');
  ins.run(PROJECT, '2026-09-13', 1000);
  ins.run(PROJECT, '2026-09-13', 1100);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM project_metrics').get() as any).n, 2);
});

test('a founder figure and a Stripe figure for one day are two rows, not a fight', () => {
  const db = freshDb();
  db.prepare('INSERT INTO project_metrics (project_id, snapshot_date, mrr, source) VALUES (?,?,?,?)')
    .run(PROJECT, '2026-09-13', 900, 'founder');
  db.prepare('INSERT INTO project_metrics (project_id, snapshot_date, mrr, source) VALUES (?,?,?,?)')
    .run(PROJECT, '2026-09-13', 1000, 'stripe');
  const rows = db.prepare('SELECT source, mrr FROM project_metrics ORDER BY source').all() as any[];
  assert.deepEqual(rows.map((r) => [r.source, r.mrr]), [['founder', 900], ['stripe', 1000]],
    'two sources for one day collapsed into one row — a reported figure and a measured one are different claims');
});

// ── the lazy bootstrap ────────────────────────────────────────────────────────

test('the bootstrap builds the same table the migration does, on a cold database', async () => {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  const e = env(db);
  await ensureProjectMetricsSchema(e);

  const cols = new Set((db.prepare('PRAGMA table_info(project_metrics)').all() as any[]).map((r) => r.name));
  const migrated = freshDb();
  const want = new Set((migrated.prepare('PRAGMA table_info(project_metrics)').all() as any[]).map((r) => r.name));
  // THE TWO MUST AGREE, because the bug was a bootstrap that claimed a shape it
  // did not produce. A column in the migration and not the bootstrap is a cold
  // isolate that fails where a migrated one works.
  assert.deepEqual([...cols].sort(), [...want].sort(),
    'the lazy bootstrap and migration 249 disagree about the table');

  // Including the conflict target, or the Stripe upsert has nothing to conflict on.
  const idx = (db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='project_metrics'")
    .all() as any[]).map((r) => r.name);
  assert.ok(idx.includes('idx_project_metrics_day_source'),
    'the bootstrap omits the unique index the upsert names as its conflict target');
});

test('the bootstrap cannot rescue a wrong-keyed table, and no longer pretends to', async () => {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  // A `project_metrics` that exists with the DEAL shape — the situation the old
  // helper was in every time it ran against production. Its ALTER branch adds the
  // ten metric columns and CANNOT add `project_id`, which is precisely why the
  // writers kept throwing. Asserted so nobody restores the belief that it can.
  db.exec('CREATE TABLE project_metrics (id INTEGER PRIMARY KEY AUTOINCREMENT, deal_id INTEGER NOT NULL)');
  const e = env(db);
  await ensureProjectMetricsSchema(e);
  const cols = new Set((db.prepare('PRAGMA table_info(project_metrics)').all() as any[]).map((r) => r.name));
  assert.ok(cols.has('arr'), 'the ALTER branch did not run at all');
  assert.ok(!cols.has('project_id'),
    'the bootstrap claims to add project_id — an ALTER cannot make a deal table a project one, '
    + 'and believing it could is what hid this bug');
});

// ── the writers, repointed ────────────────────────────────────────────────────

test('no project-keyed statement names metrics_snapshots any more', () => {
  // THE SEPARATION, ASSERTED ON THE SOURCE. Three files hold the project family
  // and two hold the deal family, and a statement in the wrong one is the bug
  // coming back. Read as text because the point is which table a query NAMES.
  const read = (p: string) => readFileSync(resolve(HERE, '..', p), 'utf8');
  for (const f of ['src/routes/progress.ts', 'src/routes/research.ts',
    'src/integrations/providers/stripe.ts']) {
    const src = read(f);
    const sql = [...src.matchAll(/(?:FROM|INTO|UPDATE|TABLE)\s+metrics_snapshots\b/g)];
    assert.equal(sql.length, 0,
      `${f} still has ${sql.length} statement(s) against metrics_snapshots — it writes the project shape`);
  }
  // And the deal family is untouched: if these lost their table, #183's work went
  // with it.
  for (const f of ['src/routes/pipeline.ts', 'src/services/tractionSnapshots.ts']) {
    assert.match(read(f), /metrics_snapshots/,
      `${f} no longer names metrics_snapshots — the per-deal traction record lost its table`);
  }
});

test('the Stripe write is one statement, and the DELETE is gone', () => {
  const src = readFileSync(resolve(HERE, '../src/integrations/providers/stripe.ts'), 'utf8');
  assert.match(src, /ON CONFLICT\(project_id, snapshot_date, source\) DO UPDATE SET/,
    'the Stripe sync does not upsert, so a re-sync depends on a DELETE landing first');
  assert.ok(!/DELETE FROM project_metrics/.test(src),
    'the DELETE is still there — it was a read-modify-write whose catch swallowed a failure '
    + 'while the INSERT after it had none');
  // Only the four figures Stripe knows are overwritten. A blanket replace would
  // wipe a founder's headcount for the same day because Stripe has no opinion
  // about it.
  const upsert = src.match(/DO UPDATE SET '\s*\+\s*'([^']*)'\s*\+\s*'([^']*)'/);
  assert.ok(upsert, 'the upsert SET clause is no longer readable by this guard');
  const setCols = `${upsert![1]}${upsert![2]}`;
  for (const c of ['headcount', 'cash_balance', 'notes']) {
    assert.ok(!setCols.includes(c), `the upsert overwrites ${c}, which Stripe knows nothing about`);
  }
});
