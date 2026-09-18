/**
 * D159 — one `logAdminAction`, writing BOTH stores, with the target it has.
 *
 * WHY THIS RUNS THE REAL FUNCTION AGAINST A REAL DATABASE. The defect was
 * which TABLE a row landed in, and two of the four copies landed in one table
 * instead of two. A source scan for `INSERT INTO admin_audit_log` would have
 * passed on the copies that had it and said nothing about the ones that did
 * not, which is how the drift survived. D1 is SQLite, so `node:sqlite` behind
 * the `makeD1` shim lets the writes be counted rather than described.
 *
 * THE TABLES COME FROM THE BASELINE, verbatim, so a fixture narrower than
 * production fails here rather than passing against a shape nothing runs —
 * the D133 lesson, where two narrow fixtures made seven tests agree with each
 * other and with nothing else.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { logAdminAction, targetUserIdOf } from '../src/services/adminAudit';

const root = process.cwd();
const SRC = resolve(root, 'cloudflare-worker/src');
const BASELINE = readFileSync(resolve(root, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');

/** One table's CREATE TABLE, verbatim. A literal search, never a built regex. */
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  const end = BASELINE.indexOf(');', at);
  assert.ok(end > at, `${name}'s definition in the baseline is unterminated`);
  return BASELINE.slice(at, end + 2);
}

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { return x; },
  };
}

function fresh() {
  const db = new DatabaseSync(':memory:');
  // admin_audit_log REFERENCES users(id) and node:sqlite enforces it: a stub
  // parent keeps foreign keys ON rather than switching them off, so a row that
  // could not exist in production cannot exist here either.
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)');
  // activity_logs also carries `project_id INTEGER REFERENCES projects(id)`.
  // Without this stub the INSERT raises `no such table: main.projects` — and
  // the helper SWALLOWS that by design, so the first draft of this fixture
  // reported "activity_logs did not receive the action" for a reason that had
  // nothing to do with the code under test. Stub the parent, keep FKs on.
  db.exec('CREATE TABLE projects (id INTEGER PRIMARY KEY)');
  db.exec("INSERT INTO users (id, name, email) VALUES (7, 'HQ Op', 'op@axal.vc'), (42, 'Target', 't@axal.vc')");
  db.exec(ddl('admin_audit_log'));
  db.exec(ddl('activity_logs'));
  // A FRESH env OBJECT per fixture. `ensureAdminAuditLogTable` memoises on a
  // WeakMap keyed off the binding, so a shared env would carry one database's
  // bootstrap into the next and the second fixture would assert nothing.
  return { db, env: { DB: makeD1(db) } as any };
}

const rows = (db: InstanceType<typeof DatabaseSync>, sql: string): any[] => db.prepare(sql).all() as any[];

test('a privileged action reaches BOTH stores, which is the whole defect', async () => {
  const { db, env } = fresh();
  await logAdminAction(env, 7, 'op@axal.vc', 'advisor_shadow_cleared', { target_user_id: 42 });

  const activity = rows(db, 'SELECT * FROM activity_logs');
  const audit = rows(db, 'SELECT * FROM admin_audit_log');
  assert.equal(activity.length, 1, 'activity_logs did not receive the action');
  assert.equal(audit.length, 1,
    'admin_audit_log did not receive the action — this is exactly what admin_advisor_audit.ts '
    + 'and matchAudit.ts did before D159, and it is why HQ\'s governance feed could not show it');
  assert.equal(audit[0].action, 'advisor_shadow_cleared');
  assert.equal(audit[0].admin_user_id, 7);
});

test('the target rides across, so the feed can name who it was done to', async () => {
  const { db, env } = fresh();
  await logAdminAction(env, 7, 'op@axal.vc', 'advisor_locked', { target_user_id: 42 });
  const [row] = rows(db, 'SELECT * FROM admin_audit_log');
  assert.equal(row.viewed_user_id, 42,
    'viewed_user_id is what the feed LEFT JOINs users on; without it the Target column is blank');
  // The join the feed actually runs must resolve a person, not merely an id.
  const [joined] = rows(db,
    'SELECT t.name AS target FROM admin_audit_log a LEFT JOIN users t ON t.id = a.viewed_user_id');
  assert.equal(joined.target, 'Target');
});

test('an action with no subject records NO subject, rather than a plausible one', async () => {
  const { db, env } = fresh();
  // A match list is generated over a set. The admin's own id is right there and
  // is the obvious thing to fall back to — which would make the feed say the
  // operator did it TO THEMSELVES. An absent target stays absent.
  await logAdminAction(env, 7, 'op@axal.vc', 'match_list_generated', { kind: 'founder' });
  const [row] = rows(db, 'SELECT * FROM admin_audit_log');
  assert.equal(row.viewed_user_id, null, 'an action with no subject must not borrow one');
  assert.notEqual(row.viewed_user_id, 0, 'and must not render a zero id');
});

test('a malformed target is dropped rather than bound', () => {
  // Each of these would join to nobody, so binding one would put a broken
  // reference in an audit table D156 has sealed against repair.
  for (const bad of [undefined, null, 'abc', '42', 0, -1, Number.NaN, {}, []] as unknown[]) {
    assert.equal(targetUserIdOf({ target_user_id: bad } as Record<string, unknown>), null,
      `${JSON.stringify(bad) ?? 'undefined'} was accepted as a target user id`);
  }
  assert.equal(targetUserIdOf({}), null, 'a details object with no target must yield null');
  assert.equal(targetUserIdOf({ target_user_id: 42 }), 42, 'a real id must survive');
});

test('the actor is hashed in activity_logs, never the raw email', async () => {
  const { db, env } = fresh();
  await logAdminAction(env, 7, 'op@axal.vc', 'advisor_unlocked', { target_user_id: 42 });
  const [row] = rows(db, 'SELECT * FROM activity_logs');
  assert.ok(row.actor, 'no actor was recorded');
  assert.notEqual(row.actor, 'op@axal.vc', 'the raw email reached activity_logs (T22.1 hashing lost)');
});

test('an unwritable activity_logs does not cost the audit row, or the reverse', async () => {
  const { db, env } = fresh();
  db.exec('DROP TABLE activity_logs');
  await logAdminAction(env, 7, 'op@axal.vc', 'advisor_locked', { target_user_id: 42 });
  assert.equal(rows(db, 'SELECT * FROM admin_audit_log').length, 1,
    'the governance row was lost because the OTHER store failed — the two writes must be independent');
});

// ---------------------------------------------------------------------------
// One definition, and one spelling for the key it reads.
// ---------------------------------------------------------------------------

function tsFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) tsFiles(p, out);
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

test('logAdminAction is declared exactly once in the worker source', () => {
  const declarers: string[] = [];
  for (const f of tsFiles(SRC)) {
    const src = readFileSync(f, 'utf8');
    // The declaration, not a call and not an import: `function logAdminAction(`
    // with an optional async/export in front.
    if (/(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+logAdminAction\s*\(/.test(src)) {
      declarers.push(f.slice(SRC.length + 1));
    }
  }
  assert.deepEqual(declarers, ['services/adminAudit.ts'],
    'logAdminAction is declared somewhere other than its one home — four copies of it had already '
    + 'drifted into doing different things, which is what D159 exists to end');
});

/**
 * The text of ONE call's argument list, from `logAdminAction(` to its matching
 * close paren. Exact rather than a character window, so the assertion cannot
 * reach code that is not part of the call.
 */
function callArgs(src: string, at: number): string {
  const open = src.indexOf('(', at);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '(') depth += 1;
    else if (src[i] === ')') {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return src.slice(open);
}

test('every call site names its subject target_user_id, the key the helper reads', () => {
  const offenders: string[] = [];
  for (const f of tsFiles(SRC)) {
    if (f.endsWith('services/adminAudit.ts')) continue; // the helper's own prose names the key
    const src = readFileSync(f, 'utf8');
    let at = src.indexOf('logAdminAction(');
    while (at >= 0) {
      // Bounded to this call's OWN argument list by matching parentheses, not
      // by a fixed character window. A 400-char window was the first draft and
      // it failed on correct code: every one of these handlers ends
      // `return c.json({ ok: true, user_id: uid, ... })` a few lines later, so
      // the window swept up the RESPONSE BODY's key and reported four
      // violations that were not violations. Same overreach as D147's.
      const window = callArgs(src, at);
      // A literal scan. Building a regex out of file data is the shape Semgrep
      // has flagged here three times, and it buys nothing over this.
      for (const m of window.match(/\b[A-Za-z_][A-Za-z0-9_]*_id\s*:/g) || []) {
        const key = m.replace(/\s*:$/, '');
        // Keys naming a PERSON must use the one spelling. Keys naming a thing
        // (invitation_id, deal_id, envelope_id, partner_id — a firm) are not
        // subjects and are left alone.
        if (key === 'user_id') offenders.push(`${f.slice(SRC.length + 1)}: ${key}`);
      }
      at = src.indexOf('logAdminAction(', at + 1);
    }
  }
  assert.deepEqual(offenders, [],
    'a logAdminAction call names a person with `user_id`. The helper fills '
    + 'admin_audit_log.viewed_user_id from `target_user_id` only, so this action would be recorded '
    + 'with no subject and HQ\'s feed would show a blank Target — silently.');
});
