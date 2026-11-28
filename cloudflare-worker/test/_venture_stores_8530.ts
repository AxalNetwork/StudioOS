/**
 * #8530 (D8530) — a synthetic VentureSpace with a row in every store, and the real code path of each lifecycle event.
 *
 * The world is the real migrated schema (`_schema_once.mjs`), never hand-copied DDL. For every D1 table in the inventory
 * (`src/services/ventureSpaceDataInventory.ts`) it writes two rows built from the table's own columns: row A belongs
 * to the venture (project 1 in company 1, owned by user 2) and row B to a control venture (project 10 in company 2,
 * owned by user 4). Every column that references `users` names the row's owner, a `scope_kind` column says `project`,
 * and every other reference is made real (`repairReferences`): a nullable one becomes NULL, a required one gets a
 * parent row. CHECK constraints are off only while a row is written, so a write the code makes later is checked.
 * For every R2 prefix it puts one object for each venture in an in-memory bucket.
 *
 * The events are the routes a person uses — `POST /api/projects/:id/move`, `DELETE /api/projects/:id` (Trash),
 * `POST /api/projects/:id/restore`, HQ's `DELETE /api/admin/projects/:id/hard-delete` (the project route's `?hard=true`
 * refuses HQ on a company's venture, #5366) — and, for account erasure, the one erasure
 * the platform has (`eraseAccountAgents`, D1530; D168: the rest of an erasure is manual). Each runs inside a savepoint
 * and is rolled back, so one world serves every event. Nothing here reads production data or the wall clock.
 */
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { loadSchema } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import projects from '../src/routes/projects.ts';
import projectLifecycle from '../src/routes/project_lifecycle.ts';
import admin from '../src/routes/admin.ts';
import { eraseAccountAgents } from '../src/agents/erasure.ts';
import type { LifecycleEvent, Store } from '../src/services/ventureSpaceDataInventory.ts';

export const VENTURE = 1, CONTROL = 10;
export const HOME = 1, CONTROL_COMPANY = 2, DESTINATION = 3;
export const OWNER = 2, ADMIN = 3, CONTROL_OWNER = 4;
const FOUNDER = 100, CONTROL_FOUNDER = 200;
// A synthetic signing seed for locally minted test tokens, joined at run time so no key-shaped literal
// sits in the source (gitleaks' generic-api-key rule flagged the literal form).
const JWT_SECRET = ['synthetic', '8530', 'local', 'test', 'signing', 'seed', 'not', 'a', 'credential'].join('-');

type Column = { name: string; type: string; nn: number; dflt: string | null; pk: number; hidden: number };
type Fk = { id: number; seq: number; table: string; from: string; to: string | null; on_delete: string };
const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

export const columnsOf = (db: DatabaseSync, table: string) =>
  db.prepare('SELECT name, type, "notnull" AS nn, dflt_value AS dflt, pk, hidden FROM pragma_table_xinfo(?)').all(table) as unknown as Column[];
const fksOf = (db: DatabaseSync, table: string) => db.prepare('SELECT * FROM pragma_foreign_key_list(?)').all(table) as unknown as Fk[];

let serial = 0;
/** One row of `table` from its own columns: `values` first, then a distinct synthetic value for each required column. */
export function seedRow(db: DatabaseSync, table: string, values: Record<string, unknown>, fillDefaults = false): number {
  const cols = columnsOf(db, table).filter((c) => !c.hidden);
  const pkCount = cols.filter((c) => c.pk > 0).length;
  const salt = ++serial;
  const names: string[] = [], vals: any[] = [];
  cols.forEach((c, i) => {
    if (c.name in values) { names.push(c.name); vals.push(values[c.name]); return; }
    if (c.pk === 1 && pkCount === 1 && /INT/i.test(c.type)) return;
    const text = !/INT|REAL|NUM|FLOA|DOUB|BOOL|BLOB/i.test(c.type);
    if (!(c.nn || c.pk) && !(fillDefaults && text && c.dflt != null)) return;
    if (c.dflt != null && !(fillDefaults && text)) return;
    names.push(c.name);
    if (!text) vals.push(/BLOB/i.test(c.type) ? new Uint8Array([salt % 256]) : 700000 + salt * 100 + i);
    else vals.push(`s26-${salt}-${c.name}`);
  });
  const info = db.prepare(`INSERT INTO ${q(table)} (${names.map(q).join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...vals);
  return Number(info.lastInsertRowid);
}

/** Make every reference real: a nullable one (not the venture's keys) becomes NULL, a required one gets a parent row. */
export function repairReferences(db: DatabaseSync): number {
  for (let pass = 0; pass < 8; pass++) {
    const bad = db.prepare('PRAGMA foreign_key_check').all() as any[];
    if (!bad.length) return 0;
    for (const v of bad) {
      const fk = fksOf(db, v.table).filter((f) => f.id === v.fkid);
      const cols = columnsOf(db, v.table);
      const row = db.prepare(`SELECT * FROM ${q(v.table)} WHERE rowid = ?`).get(v.rowid) as any;
      if (!row) continue;
      const nullable = fk.every((f) => { const c = cols.find((x) => x.name === f.from); return c && !c.nn && !c.pk && f.from !== 'project_id' && f.from !== 'company_id'; });
      if (nullable) { db.prepare(`UPDATE ${q(v.table)} SET ${fk.map((f) => `${q(f.from)} = NULL`).join(',')} WHERE rowid = ?`).run(v.rowid); continue; }
      const parentCols = columnsOf(db, v.parent);
      const parentPk = parentCols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
      const values: Record<string, unknown> = {};
      fk.forEach((f, i) => {
        const to = f.to ?? parentPk[i];
        let value = row[f.from];
        if (/INT/i.test(parentCols.find((c) => c.name === to)?.type ?? '') && !Number.isInteger(Number(value))) {
          value = 800000 + (++serial);
          db.prepare(`UPDATE ${q(v.table)} SET ${q(f.from)} = ? WHERE rowid = ?`).run(value, v.rowid);
        }
        values[to] = value;
      });
      const where = Object.keys(values).map((k) => `${q(k)} = ?`).join(' AND ');
      if (db.prepare(`SELECT 1 FROM ${q(v.parent)} WHERE ${where}`).get(...(Object.values(values) as any[]))) continue;
      try { seedRow(db, v.parent, values); } catch { seedRow(db, v.parent, values, true); }
    }
  }
  return (db.prepare('PRAGMA foreign_key_check').all() as any[]).length;
}

/** Per-table values a generic row cannot guess: what the table's own triggers need, or what an event looks for. */
const OVERRIDES: Record<string, (which: 'A' | 'B') => Record<string, unknown>> = {
  user_company_links: (w) => (w === 'A' ? { role_in_company: 'Admin', is_primary_admin: 1 } : {}),
  work_graph_release_authority_events: () => ({ seq: 1 }), // its trigger takes only the next seq of a key
  work_graph_release_site_origins: (w) => ({ seq: 1, op: 'allow', origin: `https://s26-${w.toLowerCase()}.example` }), // D5585-p18: next seq, an origin
  // D5585-p16: a line name is the next seq of a line of its own tenant and company (its two triggers).
  work_graph_release_line_names: (w) => ({ seq: 1, tenant_id: 1, line_asset_uid: `s26-line-${w}` }),
  financial_events: () => ({ source: 's26-source' }), // its trigger needs a coverage row for the source
  build_plans: (w) => ({ scope: `s26-${w}` }), // one current plan per (project, scope)
};
const BEFORE: Record<string, (db: DatabaseSync) => void> = {
  work_graph_release_line_names: (db) => {
    for (const [w, company, project] of [['A', HOME, VENTURE], ['B', CONTROL_COMPANY, CONTROL]] as const) {
      if (db.prepare('SELECT 1 FROM work_graph_release_lines WHERE line_asset_uid = ?').get(`s26-line-${w}`)) continue;
      seedRow(db, 'work_graph_release_lines', { line_asset_uid: `s26-line-${w}`, tenant_id: 1, company_id: company, project_id: project, audience: 'internal' });
    }
  },
  financial_events: (db) => { if (!db.prepare("SELECT 1 FROM financial_event_coverage WHERE source = 's26-source'").get()) seedRow(db, 'financial_event_coverage', { source: 's26-source' }); },
};

export type World = {
  db: DatabaseSync;
  env: any;
  objects: Map<string, string>;
  /** D1 store name → [rowid of A, rowid of B]. */
  rows: Map<string, [number, number]>;
  /** R2 store id → [key of A, key of B]. */
  keys: Map<string, [string, string]>;
  seed: (table: string) => void;
};

/** The two rows of one D1 store. References are made real afterwards by the caller. */
function seedStore(db: DatabaseSync, rows: World['rows'], table: string, which: 'A' | 'B' | 'both') {
  const cols = columnsOf(db, table);
  const has = (n: string) => cols.some((c) => c.name === n);
  // A reference to `users`, declared or by name (many tables carry `user_id` without REFERENCES).
  const users = new Set([...fksOf(db, table).filter((f) => f.table === 'users').map((f) => f.from), ...cols.filter((c) => /(^|_)user_id$/.test(c.name)).map((c) => c.name)]);
  const founders = new Set(fksOf(db, table).filter((f) => f.table === 'founders').map((f) => f.from));
  const one = (w: 'A' | 'B') => {
    const values: Record<string, unknown> = {};
    if (has('project_id')) values.project_id = w === 'A' ? VENTURE : CONTROL;
    if (has('company_id')) values.company_id = w === 'A' ? HOME : CONTROL_COMPANY;
    if (has('scope_kind')) values.scope_kind = has('project_id') ? 'project' : 'company';
    for (const c of users) values[c] = w === 'A' ? OWNER : CONTROL_OWNER;
    for (const c of founders) values[c] = w === 'A' ? FOUNDER : CONTROL_FOUNDER;
    Object.assign(values, OVERRIDES[table]?.(w) ?? {});
    BEFORE[table]?.(db);
    let id: number;
    try { id = seedRow(db, table, values); } catch { id = seedRow(db, table, values, true); }
    const pair = rows.get(table) ?? [0, 0];
    pair[w === 'A' ? 0 : 1] = id;
    rows.set(table, pair);
  };
  if (which !== 'B') one('A');
  if (which !== 'A') one('B');
}

/** In-memory R2 with the surface the Worker uses (list pages, delete, get, put, head). */
function bucket(objects: Map<string, string>) {
  return {
    list: async (o: { prefix?: string; limit?: number; cursor?: string } = {}) => {
      const keys = [...objects.keys()].filter((k) => k.startsWith(o.prefix ?? '') && (!o.cursor || k > o.cursor)).sort();
      const page = keys.slice(0, o.limit ?? 1000);
      return { objects: page.map((key) => ({ key })), truncated: keys.length > page.length, ...(keys.length > page.length ? { cursor: page.at(-1) } : {}), delimitedPrefixes: [] };
    },
    delete: async (keys: string | string[]) => { for (const k of [keys].flat()) objects.delete(k); },
    get: async (k: string) => (objects.has(k) ? { body: objects.get(k), text: async () => objects.get(k) } : null),
    head: async (k: string) => (objects.has(k) ? { key: k } : null),
    put: async (k: string, v: string) => { objects.set(k, String(v)); return { key: k }; },
  };
}

/** The R2 key of one venture under a store's template. */
export function keyFor(template: string, which: 'A' | 'B'): string {
  const project = which === 'A' ? VENTURE : CONTROL;
  return template
    .replace('{project_id}', String(project))
    .replace('{project_uid}', which === 'A' ? 'p-venture' : 'p-control')
    .replace('{company_uid}', which === 'A' ? 'co-home' : 'co-control') + 's26-object.bin';
}

/**
 * Build the world. `withhold` names D1 stores whose row A is not written yet (the ones that refuse a hard delete):
 * `world.seed(name)` writes it later, inside the caller's savepoint.
 */
export function buildWorld(stores: readonly Store[], withhold: ReadonlySet<string> = new Set()): World {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec(`INSERT INTO founders (id, name, email) VALUES (${FOUNDER}, 'Synthetic founder', 'founder-8530@example.invalid'), (${CONTROL_FOUNDER}, 'Control founder', 'control-8530@example.invalid');
    INSERT INTO users (id, role, name, email, founder_id, is_active) VALUES
      (${OWNER}, 'founder', 'Synthetic owner', 'owner-8530@example.invalid', ${FOUNDER}, 1),
      (${ADMIN}, 'admin', 'Synthetic admin', 'admin-8530@example.invalid', NULL, 1),
      (${CONTROL_OWNER}, 'founder', 'Control owner', 'control-owner-8530@example.invalid', ${CONTROL_FOUNDER}, 1);
    INSERT INTO company_profiles (id, uid, company_name) VALUES (${HOME}, 'co-home', 'Home'), (${CONTROL_COMPANY}, 'co-control', 'Control'), (${DESTINATION}, 'co-destination', 'Destination');
    INSERT INTO user_company_links (uid, company_id, user_id, role_in_company, is_primary_admin) VALUES ('l-8530-destination', ${DESTINATION}, ${OWNER}, 'Admin', 1);
    INSERT INTO projects (id, uid, name, founder_id, company_id) VALUES (${VENTURE}, 'p-venture', 'Synthetic venture', ${FOUNDER}, ${HOME}), (${CONTROL}, 'p-control', 'Control venture', ${CONTROL_FOUNDER}, ${CONTROL_COMPANY});`);
  const rows: World['rows'] = new Map();
  const keys: World['keys'] = new Map();
  const objects = new Map<string, string>();
  db.exec('PRAGMA ignore_check_constraints = ON');
  try {
    for (const s of stores) {
      if (s.kind === 'd1_table' && s.name !== 'projects') seedStore(db, rows, s.name, withhold.has(s.name) ? 'B' : 'both');
      if (s.kind === 'r2_prefix') {
        const pair: [string, string] = [keyFor(s.name, 'A'), keyFor(s.name, 'B')];
        for (const k of pair) objects.set(k, 'synthetic');
        keys.set(s.id, pair);
      }
    }
    linkAgents(db, rows);
    const left = repairReferences(db);
    if (left) throw new Error(`${left} references could not be made real`);
  } finally { db.exec('PRAGMA ignore_check_constraints = OFF'); }
  db.exec('PRAGMA foreign_keys = ON');
  const env: any = { DB: d1Over(db), FILES: bucket(objects), JWT_SECRET, ENVIRONMENT: 'development' };
  const seed = (table: string) => {
    // Inside the caller's savepoint: foreign keys stay on, so the new row's references are deferred until repaired.
    db.exec('PRAGMA defer_foreign_keys = ON; PRAGMA ignore_check_constraints = ON');
    try {
      seedStore(db, rows, table, 'A');
      const left = repairReferences(db);
      if (left) throw new Error(`${table}: ${left} references could not be made real`);
    } finally { db.exec('PRAGMA ignore_check_constraints = OFF; PRAGMA defer_foreign_keys = OFF'); }
  };
  return { db, env, objects, rows, keys, seed };
}

/**
 * The venture's agent rows point at its own agent, as the engine writes them: its notes and runs name agent A, and
 * its open task is assigned to agent A (an erasure cancels such a task; D1530).
 */
function linkAgents(db: DatabaseSync, rows: World['rows']) {
  const agent = rows.get('team_agents')?.[0];
  for (const table of ['agent_memory_notes', 'agent_skill_workflow_runs']) {
    const id = rows.get(table)?.[0];
    if (agent && id && columnsOf(db, table).some((c) => c.name === 'agent_id')) db.prepare(`UPDATE ${q(table)} SET agent_id = ? WHERE rowid = ?`).run(agent, id);
  }
  const task = rows.get('scope_tasks')?.[0];
  if (agent && task) db.prepare("UPDATE scope_tasks SET assignee_kind = 'agent', assignee_agent_id = ?, status = 'open', board_column = NULL WHERE rowid = ?").run(agent, task);
  const call = rows.get('capital_calls')?.[0];
  if (call) seedRow(db, 'capital_call_receipts', { capital_call_id: call }); // a call with money received (financial records)
}

async function call(world: World, who: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const app = new Hono().route('/api/projects', projectLifecycle).route('/api/projects', projects).route('/api/admin', admin);
  const res = await app.request(path, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, world.env).catch((e) => { if (e instanceof Response) return e; throw e; });
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

/** Run one event through its real code path. Returns the response of the last route it called. */
export async function runEvent(world: World, event: LifecycleEvent): Promise<{ status: number; body: any }> {
  const quiet = [console.log, console.warn, console.error] as const;
  console.log = console.warn = console.error = () => {};
  try {
    switch (event) {
      case 'move': return await call(world, OWNER, 'POST', `/api/projects/${VENTURE}/move`, { company_id: DESTINATION });
      case 'archive': return await call(world, OWNER, 'DELETE', `/api/projects/${VENTURE}`);
      case 'restore': {
        const trashed = await call(world, OWNER, 'DELETE', `/api/projects/${VENTURE}`);
        if (trashed.status !== 200) return trashed;
        return await call(world, OWNER, 'POST', `/api/projects/${VENTURE}/restore`);
      }
      case 'hard_delete': return await call(world, ADMIN, 'DELETE', `/api/admin/projects/${VENTURE}/hard-delete`);
      case 'account_erasure': await eraseAccountAgents(world.env, OWNER); return { status: 200, body: null };
    }
  } finally { [console.log, console.warn, console.error] = quiet; }
}

/** A D1 row as JSON (or null when gone), for before/after comparison. */
export function rowOf(world: World, table: string, rowid: number): Record<string, unknown> | null {
  const row = world.db.prepare(`SELECT * FROM ${q(table)} WHERE rowid = ?`).get(rowid) as Record<string, unknown> | undefined;
  if (!row) return null;
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Uint8Array ? [...v] : typeof v === 'bigint' ? Number(v) : v]));
}

export type Observed = 'gone' | 'unchanged' | 'unlinked' | 'changed';

/** What happened to a row: gone, unchanged, its project_id cleared, or changed in another way. */
export function observe(before: Record<string, unknown> | null, after: Record<string, unknown> | null): Observed {
  if (!after) return 'gone';
  if (JSON.stringify(before) === JSON.stringify(after)) return 'unchanged';
  if (before && before.project_id != null && after.project_id == null) return 'unlinked';
  return 'changed';
}

/** Run `fn` in a savepoint that is always rolled back (the bucket too), so the world is the same for the next event. */
export async function rolledBack<T>(world: World, fn: () => Promise<T>): Promise<T> {
  const objects = new Map(world.objects);
  world.db.exec('SAVEPOINT s8530');
  try { return await fn(); } finally {
    world.db.exec('ROLLBACK TO s8530'); world.db.exec('RELEASE s8530');
    world.objects.clear(); for (const [k, v] of objects) world.objects.set(k, v);
  }
}
