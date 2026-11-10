/**
 * #4603 part 3 (D4603) — D1's rows READ, measured on a local D1.
 *
 * Miniflare's D1 (workerd's SQLite, the engine `wrangler dev` uses) reports
 * `meta.rows_read` for every statement: the rows SQLite scanned, not the rows
 * it returned. `toLocalD1` copies a database the Build read harness seeded
 * (`_build_reads.ts`, node:sqlite) into a fresh in-memory local D1:
 * tables, then their rows, then indexes, views and triggers, so no trigger
 * fires during the copy. Foreign keys are dropped from the copied DDL: D1
 * enforces them, the synthetic seeds do not satisfy them, and a constraint
 * does not change what a read scans. `countingLocalD1` then logs each
 * statement's rows returned and rows read into the harness's own log
 * (`useD1`).
 *
 * This is the local engine, not production D1, and its numbers are labelled
 * so. Every row is synthetic; nothing here reaches a remote database.
 */
import type { DatabaseSync } from 'node:sqlite';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import type { Statement } from './_build_reads.ts';

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
/** The DDL without its foreign keys: a column's `REFERENCES …` and a table's `FOREIGN KEY (…) REFERENCES …`. */
export function withoutForeignKeys(ddl: string): string {
  const action = String.raw`(?:\s+(?:ON\s+(?:DELETE|UPDATE)\s+(?:SET\s+NULL|SET\s+DEFAULT|CASCADE|RESTRICT|NO\s+ACTION)|MATCH\s+\w+|(?:NOT\s+)?DEFERRABLE(?:\s+INITIALLY\s+(?:DEFERRED|IMMEDIATE))?))*`;
  const target = String.raw`REFERENCES\s+("[^"]+"|\w+)\s*(?:\([^)]*\))?` + action;
  return ddl
    .replace(new RegExp(String.raw`,\s*(?:CONSTRAINT\s+\w+\s+)?FOREIGN\s+KEY\s*\([^)]*\)\s*` + target, 'gi'), '')
    .replace(new RegExp(String.raw`\s+(?:CONSTRAINT\s+\w+\s+)?` + target, 'gi'), '');
}

/**
 * The copy runs inside workerd: this worker takes a JSON batch of
 * `{ sql, params }` and runs it with D1's own `batch`, every value bound. One
 * request per chunk instead of one proxy round trip per statement; a blob
 * travels as `{ blob: [...] }`.
 */
const LOADER = `export default { async fetch(request, env) {
  const { statements } = await request.json();
  const value = (v) => v && typeof v === 'object' && Array.isArray(v.blob) ? new Uint8Array(v.blob) : v;
  try { await env.DB.batch(statements.map((s) => env.DB.prepare(s.sql).bind(...s.params.map(value)))); return new Response('ok'); }
  catch (e) { return new Response(String(e && e.message || e), { status: 500 }); }
} };`;

export async function toLocalD1(db: DatabaseSync) {
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, compatibilityDate: '2026-01-01', d1Databases: ['DB'], script: LOADER }) as any);
  const d1: any = await mf.getD1Database('DB');
  const send = async (statements: Array<{ sql: string; params: unknown[] }>) => {
    const res = await mf.dispatchFetch('http://loader.invalid/', { method: 'POST', body: JSON.stringify({ statements }) });
    if (!res.ok) throw new Error(await res.text());
  };
  const param = (v: unknown) => (v instanceof Uint8Array ? { blob: [...v] } : typeof v === 'bigint' ? Number(v) : v ?? null);
  // A chunk that fails is retried one statement at a time; what still fails is returned.
  const run = async (items: Array<{ sql: string; params?: unknown[]; o?: any }>, size = 100) => {
    const failed: any[] = [];
    for (let at = 0; at < items.length; at += size) {
      const chunk = items.slice(at, at + size).map((x) => ({ sql: x.sql, params: x.params ?? [], o: x.o }));
      try { await send(chunk); }
      catch { for (const x of chunk) { try { await send([x]); } catch { failed.push(x.o ?? x.sql); } } }
    }
    return failed;
  };
  const objects = db.prepare(`SELECT type, name, tbl_name, sql FROM sqlite_master
    WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY rowid`).all() as any[];
  const virtual = objects.filter((o) => o.type === 'table' && /^CREATE\s+VIRTUAL\s+TABLE/i.test(o.sql));
  const shadow = (name: string) => virtual.some((v) => name !== v.name && name.startsWith(`${v.name}_`));
  const tables = objects.filter((o) => o.type === 'table' && !shadow(o.name));
  const tableFailures = await run(tables.map((o) => ({ sql: withoutForeignKeys(o.sql), o })));
  if (tableFailures.length) throw new Error(`could not create ${tableFailures.map((o) => o.name).join(', ')}`);
  for (const t of tables.filter((x) => !virtual.includes(x))) {
    const rows = db.prepare(`SELECT * FROM ${quote(t.name)}`).all() as any[];
    if (!rows.length) continue;
    // Several rows per INSERT, up to D1's 100 bound parameters a statement (the local engine enforces it too).
    const cols = Object.keys(rows[0]), per = Math.max(1, Math.floor(100 / cols.length));
    const head = `INSERT INTO ${quote(t.name)} (${cols.map(quote).join(', ')}) VALUES `, tuple = `(${cols.map(() => '?').join(', ')})`;
    const inserts = [];
    for (let at = 0; at < rows.length; at += per) {
      const group = rows.slice(at, at + per);
      inserts.push({ sql: head + group.map(() => tuple).join(', '), params: group.flatMap((r) => cols.map((c) => param(r[c]))) });
    }
    const failed = await run(inserts, 200);
    if (failed.length) throw new Error(`could not copy the rows of ${t.name}`);
  }
  for (const type of ['index', 'view', 'trigger']) {
    let left = objects.filter((o) => o.type === type);
    // A view or trigger can name another created after it: retry until a pass creates nothing.
    while (left.length) {
      const failed = await run(left.map((o) => ({ sql: o.sql, o })));
      if (failed.length === left.length) throw new Error(`could not create ${failed.map((o) => o.name).join(', ')}`);
      left = failed;
    }
  }
  return { d1, dispose: () => mf.dispose() };
}

/** A D1 binding over the local D1 that logs each statement's rows returned and rows read. `first()` reads through `all()`, as D1 runs it. */
export function countingLocalD1(d1: any, log: () => Statement[]) {
  const norm = (sql: string) => sql.replace(/\s+/g, ' ').trim().slice(0, 140);
  const push = (sql: string, r: any) => { log().push({ sql: norm(sql), rows: Array.isArray(r?.results) ? r.results.length : 0, rowsRead: Number(r?.meta?.rows_read ?? 0) }); return r; };
  const wrap = (stmt: any, sql: string): any => ({
    bind: (...args: any[]) => wrap(stmt.bind(...args), sql),
    all: async () => push(sql, await stmt.all()),
    run: async () => push(sql, await stmt.run()),
    first: async (column?: string) => {
      const r = push(sql, await stmt.all());
      const row = r.results?.[0] ?? null;
      log()[log().length - 1].rows = row ? 1 : 0; // first() returns one row, as the node:sqlite harness counts it
      return column ? (row ? row[column] : null) : row;
    },
    raw: async () => { const r = push(sql, await stmt.all()); return r.results.map((x: any) => Object.values(x)); },
    __inner: stmt, __sql: sql,
  });
  return {
    prepare: (sql: string) => wrap(d1.prepare(sql), sql),
    batch: async (stmts: any[]) => { const out = await d1.batch(stmts.map((s) => s.__inner ?? s)); stmts.forEach((s, i) => push(s.__sql ?? 'batch', out[i])); return out; },
    exec: (sql: string) => d1.exec(sql),
  };
}
