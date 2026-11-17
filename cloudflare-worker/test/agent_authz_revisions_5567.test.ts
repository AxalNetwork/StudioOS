/**
 * D5567 part 3 (#5567): migration 202611161330's triggers, on the migrated schema. Each way a member's access is
 * taken away or changed raises that member's revision by one; granting access and unrelated writes do not.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/agent_authz_revisions_5567.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { authorizationRevision } from '../src/services/agents/computeBridge.ts';
import { d1Over } from './_d1_sqlite.mjs';

function fresh() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  db.exec('PRAGMA foreign_keys = OFF');
  return db;
}

/** Insert a row with the given values, filling every other NOT NULL column that has no default. */
function insert(db: DatabaseSync, table: string, values: Record<string, unknown>): number {
  const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as any[]);
  const row: Record<string, unknown> = { ...values };
  for (const c of cols) {
    if (c.name in row || c.pk || !c.notnull || c.dflt_value !== null) continue;
    row[c.name] = /INT|REAL|NUM/i.test(c.type) ? 1 : `${c.name}-${Math.random().toString(36).slice(2, 8)}`;
  }
  const keys = Object.keys(row);
  const info = db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...(Object.values(row) as any[]));
  return Number(info.lastInsertRowid);
}
const rev = (db: DatabaseSync, member: number) => Number((db.prepare('SELECT revision FROM agent_authz_revisions WHERE member_id = ?').get(member) as any)?.revision ?? 1);

test('the table starts empty: every member is at revision 1, and the bridge reads it so', async () => {
  const db = fresh();
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM agent_authz_revisions').get() as any).n, 0);
  assert.equal(await authorizationRevision({ DB: d1Over(db) } as any, 42), 1);
  insert(db, 'users', { id: 42, email: 'a@example.test', role: 'founder', is_active: 1 });
  db.prepare('UPDATE users SET is_active = 0 WHERE id = 42').run();
  assert.equal(await authorizationRevision({ DB: d1Over(db) } as any, 42), 2);
});

test('an unreadable revision is refused, never read as 1', async () => {
  const db = fresh();
  db.exec('DROP TABLE agent_authz_revisions');
  assert.equal(await authorizationRevision({ DB: d1Over(db) } as any, 42), null);
});

test('users: active flag, role and founder link raise it; other columns and same-value writes do not', () => {
  const db = fresh();
  insert(db, 'users', { id: 7, email: 'u@example.test', role: 'founder', is_active: 1, name: 'U' });
  db.prepare("UPDATE users SET name = 'Renamed' WHERE id = 7").run();
  db.prepare('UPDATE users SET is_active = 1 WHERE id = 7').run();
  assert.equal(rev(db, 7), 1, 'a rename and a same-value write change nothing');
  db.prepare('UPDATE users SET is_active = 0 WHERE id = 7').run(); assert.equal(rev(db, 7), 2);
  db.prepare('UPDATE users SET is_active = 1 WHERE id = 7').run(); assert.equal(rev(db, 7), 3, 're-activation is a change too');
  db.prepare("UPDATE users SET role = 'investor' WHERE id = 7").run(); assert.equal(rev(db, 7), 4);
  db.prepare('UPDATE users SET founder_id = 99 WHERE id = 7').run(); assert.equal(rev(db, 7), 5);
});

test('company links: deleting or moving one raises it; adding one does not', () => {
  const db = fresh();
  const id = insert(db, 'user_company_links', { user_id: 7, company_id: 1 });
  assert.equal(rev(db, 7), 1, 'a new link grants, it does not revoke');
  db.prepare('UPDATE user_company_links SET company_id = 2 WHERE id = ?').run(id); assert.equal(rev(db, 7), 2);
  db.prepare('DELETE FROM user_company_links WHERE id = ?').run(id); assert.equal(rev(db, 7), 3);
});

test('project memberships: removal, role change or deletion raises it; a new membership does not', () => {
  const db = fresh();
  const id = insert(db, 'project_members', { project_id: 3, user_id: 7 });
  assert.equal(rev(db, 7), 1);
  db.prepare("UPDATE project_members SET status = 'removed' WHERE id = ?").run(id); assert.equal(rev(db, 7), 2);
  db.prepare("UPDATE project_members SET role = 'advisor' WHERE id = ?").run(id); assert.equal(rev(db, 7), 3);
  db.prepare('DELETE FROM project_members WHERE id = ?').run(id); assert.equal(rev(db, 7), 4);
});

test('account licences: a revoke or a delete raises it; a grant and a same-value write do not', () => {
  const db = fresh();
  const id = insert(db, 'account_licences', { user_id: 7, licence: 'founder' });
  db.prepare('UPDATE account_licences SET revoked_at = NULL WHERE rowid = ?').run(id);
  assert.equal(rev(db, 7), 1);
  db.prepare("UPDATE account_licences SET revoked_at = '2026-11-16 13:00:00' WHERE rowid = ?").run(id); assert.equal(rev(db, 7), 2);
  db.prepare('DELETE FROM account_licences WHERE rowid = ?').run(id); assert.equal(rev(db, 7), 3);
});

test('agents: a sponsor change raises the old and the new sponsor; a pause and a deletion raise the sponsor', () => {
  const db = fresh();
  const id = insert(db, 'team_agents', { sponsor_user_id: 7, status: 'active', scope_kind: 'company', company_id: 1, first_name: 'Agent' });
  db.prepare("UPDATE team_agents SET first_name = 'Renamed' WHERE id = ?").run(id);
  db.prepare("UPDATE team_agents SET status = 'active', sponsor_user_id = 7 WHERE id = ?").run(id);
  assert.equal(rev(db, 7), 1, 'a rename and a same-value write change nothing');
  db.prepare("UPDATE team_agents SET status = 'paused' WHERE id = ?").run(id); assert.equal(rev(db, 7), 2);
  db.prepare('UPDATE team_agents SET sponsor_user_id = 8 WHERE id = ?').run(id);
  assert.equal(rev(db, 7), 3, 'the old sponsor'); assert.equal(rev(db, 8), 2, 'and the new one');
  db.prepare('DELETE FROM team_agents WHERE id = ?').run(id); assert.equal(rev(db, 8), 3);
  assert.equal(rev(db, 7), 3, 'the deletion is the current sponsor\'s');
});
