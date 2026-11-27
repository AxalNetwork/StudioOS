/**
 * #9045 (D9045) — a synthetic person with a row in every store that names them, and the platform's one account
 * erasure run on them.
 *
 * The world is the real migrated schema (`_schema_once.mjs`), never hand-copied DDL, and the row builders are
 * D8530's (`_venture_stores_8530.ts`). For every D1 table in the account inventory
 * (`test/_account_data_inventory_9045.ts`) it writes two rows from the table's own columns: row A names the subject
 * (every user-id column and every foreign key to `users` is the subject's id, every email column the subject's
 * address) and row B a control person. The subject sponsors one agent and the control person another; the rows the
 * erasure reaches through an agent (its runs, its duties, a task assigned to it, a compute request and its object)
 * point at that person's agent. Every other reference is made real (`repairReferences`). For every R2 template it
 * puts one object for each person in an in-memory bucket; the three KV namespaces are in-memory maps.
 *
 * The event is `eraseAccountAgents` (D1530), the only erasure code the platform has (D168: the rest of an erasure is
 * manual). It runs inside a savepoint that is rolled back. Nothing here reads production data or the wall clock.
 */
import { DatabaseSync } from 'node:sqlite';
import { loadSchema } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { eraseAccountAgents } from '../src/agents/erasure.ts';
import { columnsOf, seedRow, repairReferences, rowOf, observe, type Observed } from './_venture_stores_8530.ts';
import { PERSON_EMAIL, PERSON_USER_ID, type AccountStore } from './_account_data_inventory_9045.ts';

export { rowOf, observe, type Observed };
export const SUBJECT = 2, CONTROL = 4;
export const EMAIL = { A: 'subject-9045@example.invalid', B: 'control-9045@example.invalid' } as const;
const JWT_SECRET = ['synthetic', '9045', 'local', 'test', 'signing', 'seed', 'not', 'a', 'credential'].join('-');
const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** The columns of a table that name a person: user ids (by name or by a foreign key to `users`) and email addresses. */
export function personColumns(db: DatabaseSync, table: string): { user: string[]; email: string[] } {
  const cols = columnsOf(db, table).map((c) => c.name);
  const fks = (db.prepare('SELECT "from", "table" FROM pragma_foreign_key_list(?)').all(table) as any[]).filter((f) => f.table === 'users').map((f) => f.from as string);
  return { user: [...new Set([...cols.filter((c) => PERSON_USER_ID.test(c)), ...fks])], email: cols.filter((c) => PERSON_EMAIL.test(c)) };
}

export type World = {
  db: DatabaseSync;
  env: any;
  objects: Map<string, string>;
  kv: Record<'TOKENS' | 'RATE_LIMITS' | 'OAUTH_KV', Map<string, string>>;
  /** D1 store name → [rowid of A, rowid of B]. */
  rows: Map<string, [number, number]>;
  /** R2 store id → [key of A, key of B]. */
  keys: Map<string, [string, string]>;
};

/** Per-table values a generic row cannot guess (what the table's own triggers need). Same as D8530's. */
const OVERRIDES: Record<string, () => Record<string, unknown>> = {
  work_graph_release_authority_events: () => ({ seq: 1 }),
  financial_events: () => ({ source: 's9045-source' }),
};
const BEFORE: Record<string, (db: DatabaseSync) => void> = {
  financial_events: (db) => { if (!db.prepare("SELECT 1 FROM financial_event_coverage WHERE source = 's9045-source'").get()) seedRow(db, 'financial_event_coverage', { source: 's9045-source' }); },
};

function seedStore(db: DatabaseSync, rows: World['rows'], table: string) {
  const { user, email } = personColumns(db, table);
  const pair: [number, number] = [0, 0];
  for (const [i, w] of (['A', 'B'] as const).entries()) {
    const values: Record<string, unknown> = {};
    for (const c of user) values[c] = w === 'A' ? SUBJECT : CONTROL;
    for (const c of email) values[c] = EMAIL[w];
    Object.assign(values, OVERRIDES[table]?.() ?? {});
    BEFORE[table]?.(db);
    try { pair[i] = seedRow(db, table, values); } catch { pair[i] = seedRow(db, table, values, true); }
  }
  rows.set(table, pair);
}

/** In-memory R2 with the surface the Worker uses. */
function bucket(objects: Map<string, string>) {
  return {
    list: async (o: { prefix?: string; limit?: number } = {}) => ({ objects: [...objects.keys()].filter((k) => k.startsWith(o.prefix ?? '')).sort().slice(0, o.limit ?? 1000).map((key) => ({ key })), truncated: false, delimitedPrefixes: [] }),
    delete: async (keys: string | string[]) => { for (const k of [keys].flat()) objects.delete(k); },
    get: async (k: string) => (objects.has(k) ? { body: objects.get(k), text: async () => objects.get(k) } : null),
    head: async (k: string) => (objects.has(k) ? { key: k } : null),
    put: async (k: string, v: string) => { objects.set(k, String(v)); return { key: k }; },
  };
}
/** In-memory KV. */
function kvOver(map: Map<string, string>) {
  return {
    get: async (k: string) => map.get(k) ?? null,
    put: async (k: string, v: string) => { map.set(k, String(v)); },
    delete: async (k: string) => { map.delete(k); },
    list: async (o: { prefix?: string } = {}) => ({ keys: [...map.keys()].filter((k) => k.startsWith(o.prefix ?? '')).map((name) => ({ name })), list_complete: true }),
  };
}

/** The R2 key of one person under a store's template. */
export function keyFor(template: string, which: 'A' | 'B'): string {
  return template.replace('{user_id}', String(which === 'A' ? SUBJECT : CONTROL)) + 's9045-object.bin';
}

/**
 * The rows the erasure reaches through the person's agent: the subject's agent (row A of `team_agents`) runs, holds
 * a duty, is assigned an open task, and has a compute request with one stored object; the control person's agent
 * has the same. Tables without a person column (`agent_task_runs`) get their two rows here.
 */
function linkAgents(db: DatabaseSync, rows: World['rows'], objects: Map<string, string>, keys: World['keys']) {
  const [agentA, agentB] = (rows.get('team_agents') ?? [0, 0]).map((rowid) => (db.prepare('SELECT id FROM team_agents WHERE rowid = ?').get(rowid) as any)?.id as number);
  const pairs: Array<[number, number]> = [[agentA, 0], [agentB, 1]];
  const runs: [number, number] = [0, 0];
  for (const [agent, i] of pairs) {
    runs[i] = seedRow(db, 'agent_task_runs', { agent_id: agent, uid: `s9045-run-${i}`, status: 'completed' });
    const duty = rows.get('agent_duties')?.[i];
    if (duty) db.prepare("UPDATE agent_duties SET agent_id = ?, status = 'active' WHERE rowid = ?").run(agent, duty);
    const task = rows.get('scope_tasks')?.[i];
    if (task) db.prepare("UPDATE scope_tasks SET assignee_kind = 'agent', assignee_agent_id = ?, status = 'open', board_column = NULL WHERE rowid = ?").run(agent, task);
    const request = rows.get('agent_compute_requests')?.[i];
    const object = rows.get('agent_compute_objects')?.[i];
    if (request && task && object) {
      const taskId = (db.prepare('SELECT id FROM scope_tasks WHERE rowid = ?').get(task) as any).id;
      db.prepare('UPDATE agent_compute_requests SET task_id = ? WHERE rowid = ?').run(taskId, request);
      const uid = (db.prepare('SELECT uid FROM agent_compute_requests WHERE rowid = ?').get(request) as any).uid;
      const key = `agent-compute/project/1/pending-${uid}/s9045-${i}`;
      db.prepare('UPDATE agent_compute_objects SET request_uid = ?, r2_key = ? WHERE rowid = ?').run(uid, key, object);
      objects.set(key, 'synthetic');
      const pair = keys.get('r2:FILES/agent-compute/') ?? ['', ''];
      pair[i] = key;
      keys.set('r2:FILES/agent-compute/', pair);
    }
  }
  rows.set('agent_task_runs', runs);
}

export function buildWorld(stores: readonly AccountStore[]): World {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec(`INSERT INTO users (id, role, name, email, is_active) VALUES
      (${SUBJECT}, 'founder', 'Synthetic subject', '${EMAIL.A}', 1),
      (${CONTROL}, 'founder', 'Control person', '${EMAIL.B}', 1);`);
  const rows: World['rows'] = new Map([['users', [SUBJECT, CONTROL]]]);
  const keys: World['keys'] = new Map();
  const objects = new Map<string, string>();
  // CHECK constraints and triggers are off only while the rows are written (a table's own guard trigger refuses a
  // generic row); both are back before the erasure runs, so every write it makes is checked and fires its triggers.
  const triggers = (db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND sql IS NOT NULL").all() as any[]);
  for (const t of triggers) db.exec(`DROP TRIGGER ${q(t.name)}`);
  db.exec('PRAGMA ignore_check_constraints = ON');
  try {
    for (const s of stores) {
      if (s.kind === 'd1_table' && s.name !== 'users' && personColumns(db, s.name).user.length + personColumns(db, s.name).email.length) seedStore(db, rows, s.name);
      if (s.kind === 'r2_prefix' && s.name.includes('{user_id}')) {
        const pair: [string, string] = [keyFor(s.name, 'A'), keyFor(s.name, 'B')];
        for (const k of pair) objects.set(k, 'synthetic');
        keys.set(s.id, pair);
      }
    }
    linkAgents(db, rows, objects, keys);
    const left = repairReferences(db);
    if (left) throw new Error(`${left} references could not be made real`);
  } finally {
    db.exec('PRAGMA ignore_check_constraints = OFF');
    for (const t of triggers) db.exec(t.sql);
  }
  db.exec('PRAGMA foreign_keys = ON');
  const kv = { TOKENS: new Map<string, string>(), RATE_LIMITS: new Map<string, string>(), OAUTH_KV: new Map<string, string>() };
  // One key of each kind the Worker writes under a person, for each person.
  for (const [w, id] of [['A', SUBJECT], ['B', CONTROL]] as const) {
    kv.RATE_LIMITS.set(`last_active:${id}`, '1');
    kv.RATE_LIMITS.set(`login:${EMAIL[w]}`, '1');
    kv.OAUTH_KV.set(`grant:${id}:s9045-grant`, '{}');
    kv.TOKENS.set(`s9045-token-${id}`, '1');
  }
  const env: any = {
    DB: d1Over(db), FILES: bucket(objects), JWT_SECRET, ENVIRONMENT: 'development',
    TOKENS: kvOver(kv.TOKENS), RATE_LIMITS: kvOver(kv.RATE_LIMITS), OAUTH_KV: kvOver(kv.OAUTH_KV),
  };
  return { db, env, objects, kv, rows, keys };
}

/** The platform's account erasure, on the subject. The agent runtime is a stub that records what it was asked. */
export async function eraseSubject(world: World): Promise<Array<[string, number | null]>> {
  const asked: Array<[string, number | null]> = [];
  const runtime = async () => ({ erase: async (scope: any, agentId: number | null) => { asked.push([scope?.kind ?? '?', agentId]); } }) as any;
  const quiet = [console.log, console.warn, console.error] as const;
  console.log = console.warn = console.error = () => {};
  try { await eraseAccountAgents(world.env, SUBJECT, runtime); } finally { [console.log, console.warn, console.error] = quiet; }
  return asked;
}

/** A snapshot of every KV namespace. */
export const kvSnapshot = (w: World) => JSON.stringify(Object.fromEntries(Object.entries(w.kv).map(([k, m]) => [k, [...m].sort()])));

/** Run `fn` in a savepoint that is always rolled back (the bucket too). */
export async function rolledBack<T>(world: World, fn: () => Promise<T>): Promise<T> {
  const objects = new Map(world.objects);
  world.db.exec('SAVEPOINT s9045');
  try { return await fn(); } finally {
    world.db.exec('ROLLBACK TO s9045'); world.db.exec('RELEASE s9045');
    world.objects.clear(); for (const [k, v] of objects) world.objects.set(k, v);
  }
}

export { q };
