/**
 * #4603 (Build audit 4/4) — the Build overview and module reads, measured.
 *
 * Mounts `routes/cycle_build.ts` alone at `/api/cycles/build` over the real
 * migrated schema (node:sqlite), seeds one synthetic venture at a chosen size,
 * and counts, per request, every D1 statement executed and the rows each one
 * returned. #4573's approach (the same counting D1 binding), kept to this route
 * so the auth middleware's statements do not blur Build's own.
 *
 * Rows RETURNED is what this can see. D1's rows READ (rows scanned) can be
 * larger and is unavailable here: it needs Cloudflare's D1 analytics.
 *
 * Every person, venture and figure is synthetic.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import build from '../src/routes/cycle_build.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'synthetic-4603-only-not-a-real-credential'.repeat(2);
export const PROJECT = 101;

/** `rowsRead` is D1's `meta.rows_read`, set only when the harness runs on a local D1 (`useD1`, `_build_rows_read.ts`). */
export type Statement = { sql: string; rows: number; rowsRead?: number };

/** A D1 binding that records each statement executed and how many rows it returned. */
function countingD1(db: DatabaseSync, log: () => Statement[]) {
  const real: any = d1Over(db);
  const norm = (sql: string) => sql.replace(/\s+/g, ' ').trim().slice(0, 140);
  const rowsOf = (r: any) => (Array.isArray(r?.results) ? r.results.length : r == null ? 0 : Array.isArray(r) ? r.length : 1);
  const wrap = (stmt: any, sql: string): any => ({
    bind: (...args: any[]) => wrap(stmt.bind(...args), sql),
    first: async (...a: any[]) => { const r = await stmt.first(...a); log().push({ sql: norm(sql), rows: r == null ? 0 : 1 }); return r; },
    all: async (...a: any[]) => { const r = await stmt.all(...a); log().push({ sql: norm(sql), rows: rowsOf(r) }); return r; },
    run: async (...a: any[]) => { const r = await stmt.run(...a); log().push({ sql: norm(sql), rows: 0 }); return r; },
    raw: async (...a: any[]) => { const r = await stmt.raw(...a); log().push({ sql: norm(sql), rows: rowsOf(r) }); return r; },
    __inner: stmt, __sql: sql,
  });
  return {
    ...real,
    prepare: (sql: string) => wrap(real.prepare(sql), sql),
    batch: async (stmts: any[]) => { const out = await real.batch(stmts.map((s) => s.__inner ?? s)); stmts.forEach((s, i) => log().push({ sql: norm(s.__sql ?? 'batch'), rows: rowsOf(out[i]) })); return out; },
  };
}

/** Seeds the venture with `n` records in each Build list (features, risks, roadmap items and their moves, filings, weekly reviews). */
function seed(db: DatabaseSync, n: number) {
  db.exec(`INSERT INTO users(id, role, founder_id, name, email, is_active) VALUES (1, 'founder', 11, 'Synthetic founder', 'founder@example.invalid', 1), (2, 'founder', 22, 'Other founder', 'other@example.invalid', 1);
    INSERT INTO entities(id, name, entity_type, jurisdiction) VALUES (501, 'Synthetic Inc', 'project', 'DE');
    INSERT INTO projects(id, name, founder_id, company_id, entity_id, mvp_target_date) VALUES (${PROJECT}, 'Synthetic venture', 11, 10, 501, '2027-03-01');`);
  const tx = (f: () => void) => { db.exec('BEGIN'); try { f(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } };
  tx(() => {
    const feat = db.prepare(`INSERT INTO mvp_features(project_id, title, is_must_have, delivery_status, added_value, effort, sort_order, done_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    const risk = db.prepare(`INSERT INTO venture_risks(project_id, title, severity, created_by) VALUES (?, ?, ?, 1)`);
    const okr = db.prepare(`INSERT INTO roadmap_okrs(project_id, objective, kanban_status, sort_order) VALUES (?, ?, ?, ?)`);
    const move = db.prepare(`INSERT INTO okr_column_moves(project_id, okr_id, to_status, moved_at, week_start) VALUES (?, ?, 'done', ?, '2026-01-05')`);
    const step = db.prepare(`INSERT INTO formation_steps(project_id, title, state, sort_order, created_by) VALUES (?, ?, ?, ?, 1)`);
    const statuses = ['Backlog', 'In Progress', 'Done', 'Blocked'];
    for (let i = 1; i <= n; i += 1) {
      const done = statuses[i % 4] === 'Done';
      feat.run(PROJECT, `Synthetic feature ${i}`, i % 2, statuses[i % 4], ['High', 'Medium', 'Low'][i % 3], ['S', 'M', 'L'][i % 3], i, done ? `2026-0${1 + (i % 9)}-15` : null);
      risk.run(PROJECT, `Synthetic risk ${i}`, ['high', 'medium', 'low'][i % 3]);
      const id = Number(okr.run(PROJECT, `Synthetic objective ${i}`, ['now', 'next', 'later', 'done'][i % 4], i).lastInsertRowid);
      if (i % 4 === 3) move.run(PROJECT, id, `2026-0${1 + (i % 9)}-10 12:00:00`);
      step.run(PROJECT, `Synthetic step ${i}`, ['todo', 'doing', 'done'][i % 3], i);
    }
  });
}

/**
 * #4603 part 2b (Founding team): `n` cap-table holders, opt-in so the earlier
 * parts' tables still reproduce. Three are founders (CEO, CTO, COO) with a
 * vesting schedule; the rest are investors and option holders, which the
 * Founding team module never lists.
 */
export function seedHolders(db: DatabaseSync, n: number) {
  db.exec('BEGIN');
  try {
    const holder = db.prepare(`INSERT INTO cap_table_holders(user_id, project_id, name, security_type, shares, ownership_pct, founder_role, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    const vesting = db.prepare(`INSERT INTO cap_table_vesting(user_id, holder_id, project_id, start_date, cliff_months, total_months, vested_shares) VALUES (?, ?, ?, '2026-01-01', 12, 48, ?)`);
    for (let i = 1; i <= n; i += 1) {
      const founder = i <= 3;
      const id = Number(holder.run(founder ? i : 100 + i, PROJECT, `Synthetic holder ${i}`, founder ? 'common' : i % 2 ? 'preferred' : 'options', 1000,
        founder ? 30 : 0.1, founder ? ['CEO', 'CTO', 'COO'][i - 1] : null, founder ? 'founder' : i % 2 ? 'investor' : 'employee').lastInsertRowid);
      if (founder) vesting.run(i, id, PROJECT, 250 * i);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

/**
 * #4603 part 2b (Company creation): filings on every source, opt-in like
 * `seedHolders`. Each formation step gets a due date relative to today (some
 * overdue, some due soon, most later; one in four undated), and the entity gets
 * a paid Lab order and four open obligations, of which the module reads three.
 */
export function seedFilings(db: DatabaseSync) {
  db.exec(`UPDATE formation_steps SET due_date = CASE WHEN id % 4 = 0 THEN NULL ELSE date('now', ((id % 120) - 20) || ' days') END WHERE project_id = ${PROJECT};
    INSERT INTO incorporations(user_id, project_id, jurisdiction_id, company_name, amount_cents, status, paid_at, packet_ready_at, created_at)
      VALUES (1, ${PROJECT}, 'DE', 'Synthetic Inc', 50000, 'paid', '2026-01-05', NULL, '2026-01-04');
    INSERT INTO entity_obligations(uid, entity_id, kind, title, cadence, due_date, status, resolved_on) VALUES
      ('ob-1', 501, 'franchise_tax', 'Synthetic franchise tax', 'annual', date('now', '+40 days'), 'open', NULL),
      ('ob-2', 501, 'annual_report', 'Synthetic annual report', 'annual', date('now', '+10 days'), 'open', NULL),
      ('ob-3', 501, 'registered_agent', 'Synthetic agent renewal', 'annual', date('now', '-3 days'), 'open', NULL),
      ('ob-4', 501, 'other', 'Synthetic later filing', 'one_time', date('now', '+200 days'), 'open', NULL),
      ('ob-5', 501, 'other', 'Synthetic filed filing', 'one_time', date('now', '-90 days'), 'filed', date('now', '-91 days'));`);
}

/**
 * #4603 part 2b (Operating systems): `n` tools enabled for the venture's company
 * (company 10), opt-in like `seedHolders`. Each is its own member's connection,
 * so the company's tools grow with `n`. Providers cycle through known
 * connectors, an unknown one and Google Calendar (a personal connection, never
 * a tool). Statuses cycle active, active, error, paused. Every tenth is
 * disabled for the company, and one more belongs to someone outside it. Bank
 * and CRM are mapped core systems, and eight weekly reviews are on record.
 */
export function seedTools(db: DatabaseSync, n: number) {
  db.exec('BEGIN');
  try {
    db.exec(`INSERT INTO user_company_links(uid, company_id, user_id) VALUES ('link-founder', 10, 1)`);
    const user = db.prepare(`INSERT INTO users(id, role, name, email, is_active) VALUES (?, 'founder', ?, ?, 1)`);
    const link = db.prepare(`INSERT INTO user_company_links(uid, company_id, user_id) VALUES (?, 10, ?)`);
    const integration = db.prepare(`INSERT INTO integrations(uid, user_id, provider_key, status, auth_type, last_synced_at, last_error_at) VALUES (?, ?, ?, ?, 'oauth2', '2026-11-01 08:00:00', ?)`);
    const enable = db.prepare(`INSERT INTO integration_companies(integration_id, company_id, enabled) VALUES (?, 10, ?)`);
    const providers = ['hubspot', 'stripe', 'slack', 'notion', 'figma', 'calendly', 'synthetic_unknown', 'google_calendar'];
    const statuses = ['active', 'active', 'error', 'paused'];
    for (let i = 1; i <= n + 1; i += 1) {
      const id = 1000 + i, status = statuses[i % 4];
      user.run(id, `Synthetic member ${i}`, `member${i}@example.invalid`);
      if (i <= n) link.run(`link-${i}`, id);
      const integ = Number(integration.run(`int-${i}`, id, providers[i % providers.length], status, status === 'error' ? `2026-11-0${1 + (i % 8)} 09:00:00` : null).lastInsertRowid);
      enable.run(integ, i % 10 === 0 ? 0 : 1);
    }
    db.exec(`INSERT INTO project_core_systems(project_id, kind, integration_id, used_by, updated_by)
        SELECT ${PROJECT}, 'bank', id, 'Finance', 1 FROM integrations WHERE uid = 'int-1';
      INSERT INTO project_core_systems(project_id, kind, integration_id, used_by, updated_by)
        SELECT ${PROJECT}, 'crm', id, NULL, 1 FROM integrations WHERE uid = 'int-8';`);
    const ritual = db.prepare(`INSERT INTO ritual_runs(project_id, ritual_id, run_date, state) VALUES (?, 1, date('now', ?), ?)`);
    for (let w = 1; w <= 8; w += 1) ritual.run(PROJECT, `-${7 * w} days`, w % 3 ? 'done' : 'missed');
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export async function buildReads(n: number) {
  const scratch = mkdtempSync(join(tmpdir(), 'build-4603-'));
  const file = join(scratch, 'db.sqlite');
  const seedDb = new DatabaseSync(file, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true } as any);
  loadSchema(seedDb); seedDb.close();
  const copy = join(scratch, 'case.sqlite');
  copyFileSync(file, copy);
  const db = new DatabaseSync(copy, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true } as any);
  seed(db, n);
  let log: Statement[] = [];
  const env: any = { DB: countingD1(db, () => log), JWT_SECRET, ENVIRONMENT: 'development' };
  const app = new Hono<any>().route('/api/cycles/build', build);
  app.onError((e, c) => c.json({ error: e.message }, 500));
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in the Build read harness'); }) as any;

  async function get(path: string, user = 1) {
    log = [];
    const quiet = [console.log, console.warn, console.error];
    console.log = console.warn = console.error = () => {};
    try {
      // Signed per request, so a test that mocks the clock (#6027) signs at its own now.
      const auth = await new SignJWT({ user_id: user, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
      const t0 = performance.now();
      const res = await app.request(path, { headers: { Authorization: `Bearer ${auth}` } }, env);
      const body = await res.json() as any;
      const ms = performance.now() - t0;
      const statements = [...log];
      const rowsRead = statements.every((s) => s.rowsRead != null) ? statements.reduce((t, s) => t + s.rowsRead!, 0) : null;
      return { status: res.status, body, ms, statements: statements.length, rows: statements.reduce((t, s) => t + s.rows, 0), rowsRead, log: statements };
    } finally { [console.log, console.warn, console.error] = quiet; }
  }
  const close = () => { globalThis.fetch = real; db.close(); rmSync(scratch, { recursive: true, force: true }); };
  /** #4603 part 3: answer from another D1 binding (a local D1 that reports rows read), logging into the same statement log. */
  const useD1 = (make: (log: () => Statement[]) => unknown) => { env.DB = make(() => log); };
  return { get, close, db, useD1 };
}

export const MODULE_SLUGS = ['solution-design', 'prototype-mvp', 'product-roadmap', 'founding-team', 'company-creation', 'operating-systems'] as const;
