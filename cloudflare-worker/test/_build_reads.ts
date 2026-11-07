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

export type Statement = { sql: string; rows: number };

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
  const token = await new SignJWT({ user_id: 1, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in the Build read harness'); }) as any;

  async function get(path: string, user = 1) {
    log = [];
    const quiet = [console.log, console.warn, console.error];
    console.log = console.warn = console.error = () => {};
    try {
      const auth = user === 1 ? token : await new SignJWT({ user_id: user, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
      const t0 = performance.now();
      const res = await app.request(path, { headers: { Authorization: `Bearer ${auth}` } }, env);
      const body = await res.json() as any;
      const ms = performance.now() - t0;
      const statements = [...log];
      return { status: res.status, body, ms, statements: statements.length, rows: statements.reduce((t, s) => t + s.rows, 0), log: statements };
    } finally { [console.log, console.warn, console.error] = quiet; }
  }
  const close = () => { globalThis.fetch = real; db.close(); rmSync(scratch, { recursive: true, force: true }); };
  return { get, close, db };
}

export const MODULE_SLUGS = ['solution-design', 'prototype-mvp', 'product-roadmap', 'founding-team', 'company-creation', 'operating-systems'] as const;
