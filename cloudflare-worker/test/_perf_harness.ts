/**
 * #4573 (Performance P1) — the API benchmark harness: the whole Worker
 * (`src/index.ts`, every middleware) over the real migrated schema in
 * node:sqlite, with a D1 binding that COUNTS every statement it executes.
 *
 * Each statement is put in one category, by its SQL:
 *   - `auth`: resolving the caller (`getCurrentUser`: the user row, held
 *     licences, the subscription, the recovery state) and nothing else;
 *   - `telemetry`: the observability middleware's writes (`system_metrics`,
 *     `activity_logs`, `error_logs`), which run in `ctx.waitUntil`: they cost
 *     D1 capacity, not this request's latency;
 *   - `route`: everything else, the route's own work.
 * In-process SQLite answers at once, so `waitUntil` work starts before the
 * response returns here; the category, not the timing, says what it is.
 *
 * Statement counts are deterministic for a given schema, fixture and code, so
 * they make CI budgets (`perf_budgets_4573.test.ts`). Wall times measured here
 * are in-process SQLite and say nothing about D1's network round trips; the
 * report (scripts/perf/api-bench.mjs) prints them as relative numbers only.
 *
 * Every account, venture and figure is synthetic. No network: `fetch` throws.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import { memKV } from './_mem_kv.mjs';
import { loadSchema } from './_schema_once.mjs';

export const JWT_SECRET = 'synthetic-4573-only-not-a-real-credential'.repeat(2);

/** The flows measured: a name, the account, the method and path. Read-only GETs, synthetic data. */
export const FLOWS = Object.freeze([
  { name: 'health', who: null, path: '/api/health' },
  { name: 'auth.me', who: 2, path: '/api/auth/me' },
  { name: 'projects.list', who: 2, path: '/api/projects' },
  { name: 'projects.read', who: 2, path: '/api/projects/1' },
  { name: 'dashboard', who: 2, path: '/api/dashboard' },
  { name: 'notifications', who: 2, path: '/api/notifications' },
  { name: 'search', who: 2, path: '/api/search?q=synthetic' },
  { name: 'decks.by_project', who: 2, path: '/api/decks/by-project/1' },
  { name: 'data_room.shared', who: 4, path: '/api/data-room/shared' },
  { name: 'research.overview', who: 2, path: '/api/research/overview' },
  { name: 'funds.list', who: 4, path: '/api/funds' },
  { name: 'projects.read.other_tenant', who: 5, path: '/api/projects/1' },
]);

export type Category = 'auth' | 'telemetry' | 'route';
/** The statements `getCurrentUser` runs to resolve the caller (auth.ts), by their leading SQL. */
export const AUTH_SQL = Object.freeze([
  'SELECT * FROM users WHERE id = ?',
  'SELECT licence FROM account_licences WHERE user_id = ?',
  'SELECT status, subscription_id, plan, period_end, stripe_customer_id FROM mi_pro_subscriptions WHERE user_id = ?',
  'SELECT cooling_off_until, step_up_due_at FROM user_recovery_state WHERE user_id = ?',
]);
export const TELEMETRY_SQL = Object.freeze(['INSERT INTO system_metrics', 'INSERT INTO activity_logs', 'INSERT INTO error_logs']);
export const categoryOf = (sql: string): Category =>
  AUTH_SQL.some((a) => sql.startsWith(a)) ? 'auth' : TELEMETRY_SQL.some((t) => sql.startsWith(t)) ? 'telemetry' : 'route';

/** A D1 binding over `db` that records each statement executed, normalised to one line. */
function countingD1(db: DatabaseSync, log: () => string[]) {
  const real: any = d1Over(db);
  const note = (sql: string) => { log().push(sql.replace(/\s+/g, ' ').trim().slice(0, 120)); };
  const wrap = (stmt: any, sql: string): any => ({
    bind: (...args: any[]) => wrap(stmt.bind(...args), sql),
    first: (...a: any[]) => { note(sql); return stmt.first(...a); },
    all: (...a: any[]) => { note(sql); return stmt.all(...a); },
    run: (...a: any[]) => { note(sql); return stmt.run(...a); },
    raw: (...a: any[]) => { note(sql); return stmt.raw(...a); },
    __inner: stmt,
    __sql: sql,
  });
  return {
    ...real,
    prepare: (sql: string) => wrap(real.prepare(sql), sql),
    batch: (stmts: any[]) => { for (const s of stmts) note(s.__sql ?? 'batch'); return real.batch(stmts.map((s) => s.__inner ?? s)); },
    exec: (sql: string) => { note(sql); return real.exec(sql); },
  };
}

export async function harness() {
  const scratch = mkdtempSync(join(tmpdir(), 'perf-4573-'));
  const seedPath = join(scratch, 'schema.sqlite');
  const seed = new DatabaseSync(seedPath, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true } as any);
  loadSchema(seed); seed.close();
  const file = join(scratch, 'case.sqlite');
  copyFileSync(seedPath, file);
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true } as any);
  const user = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?)');
  for (const [id, role, fid, tier] of [[1, 'admin', null, 'studio'], [2, 'founder', 100, 'studio'], [4, 'investor', null, 'studio'], [5, 'founder', 500, 'studio']] as const) {
    user.run(id, role, fid, `Synthetic member ${id}`, `synthetic-${id}@example.invalid`, tier);
  }
  db.exec("INSERT INTO projects(id, name, founder_id) VALUES (1, 'Synthetic venture', 100), (5, 'Other synthetic venture', 500)");

  let log: string[] = [];
  const env: any = {
    DB: countingD1(db, () => log),
    JWT_SECRET, ENVIRONMENT: 'development', RATE_LIMITS: memKV(), TOKENS: memKV(),
  };
  const worker = (await import('../src/index.ts')).default as any;
  const tokens = new Map<number, string>();
  const tokenOf = async (id: number) => {
    if (!tokens.has(id)) tokens.set(id, await new SignJWT({ user_id: id }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET)));
    return tokens.get(id)!;
  };

  /** One request: its status, every statement it ran (its `waitUntil` work included), by category, and its wall time in ms. */
  async function request(flow: { who: number | null; path: string }, opts: { freshLimits?: boolean } = {}) {
    log = [];
    // A timing loop sends hundreds of requests a minute for one account; the rate limiter rightly answers 429.
    // `freshLimits` gives each request an empty limiter store, so a sample measures the flow, not the refusal.
    if (opts.freshLimits) env.RATE_LIMITS = memKV();
    const pending: Promise<unknown>[] = [];
    const ctx: any = { waitUntil: (p: Promise<unknown>) => { pending.push(p); }, passThroughOnException() {} };
    const headers: Record<string, string> = flow.who ? { Authorization: `Bearer ${await tokenOf(flow.who)}` } : {};
    const quiet = [console.log, console.info, console.warn, console.error];
    console.log = console.info = console.warn = console.error = () => {};
    try {
      const t0 = performance.now();
      const res = await worker.fetch(new Request(`https://axal.vc${flow.path}`, { headers }), env, ctx);
      await res.arrayBuffer();
      const ms = performance.now() - t0;
      await Promise.allSettled(pending);
      const statements = [...log];
      const count = { auth: 0, telemetry: 0, route: 0 } as Record<Category, number>;
      for (const s of statements) count[categoryOf(s)] += 1;
      return { status: res.status, ms, total: statements.length, ...count, statements };
    } finally {
      [console.log, console.info, console.warn, console.error] = quiet;
    }
  }

  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in the perf harness'); }) as any;
  const close = () => { globalThis.fetch = real; db.close(); rmSync(scratch, { recursive: true, force: true }); };
  return { request, close, db };
}

/** Statements that ran more than once in one request: the N+1 shape, by normalised SQL. */
export function repeats(statements: string[]): Array<{ sql: string; times: number }> {
  const n = new Map<string, number>();
  for (const s of statements) n.set(s, (n.get(s) ?? 0) + 1);
  return [...n].filter(([, t]) => t > 1).map(([sql, times]) => ({ sql, times })).sort((a, z) => z.times - a.times);
}
