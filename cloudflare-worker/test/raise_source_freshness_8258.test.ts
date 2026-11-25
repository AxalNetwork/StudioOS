/**
 * D8258 (#8258) — the Raise overview's connected sources say whether each last read is Fresh or Stale by
 * its own window, and tell a lost connection (Disconnected) apart from a failed read (Unavailable).
 * Synthetic facts only.
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/raise_source_freshness_8258.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import { connectors, FRESH_WITHIN_HOURS, sourceFreshness } from '../src/services/raiseCycle.ts';

const ddl = (() => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const out = (db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all() as any[]).map((r) => `${r.sql};`).join('\n');
  db.close(); return out;
})();
const NOW = Date.parse('2026-11-22T12:00:00Z');
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(ddl);
  db.exec(`INSERT INTO users(id,role,name,email,founder_id,is_active) VALUES (1,'founder','Synthetic founder','founder@example.test',11,1), (2,'founder','Other founder','other@example.test',22,1);
    INSERT INTO projects(id,uid,name,founder_id) VALUES (1,'synthetic-one','Synthetic venture',11);`);
  const env: any = { DB: d1Over(db), ENVIRONMENT: 'development' };
  return { db, ctx: { env, projectId: 1, today: '2026-11-22', now: NOW } as any };
}
const integration = (db: any, id: number, user: number, provider: string, status: string) =>
  db.prepare(`INSERT INTO integrations (id, uid, user_id, provider_key, status, auth_type) VALUES (?, ?, ?, ?, ?, 'oauth2')`).run(id, `i${id}`, user, provider, status);
const byKey = async (ctx: any) => Object.fromEntries(((await connectors(ctx)) as any[]).map((r) => [r.key, r]));

test('Fresh inside the window, Stale past it, Not recorded with no last read', () => {
  const h = 3_600_000;
  assert.equal(sourceFreshness(null, 48, NOW), 'not_recorded');
  assert.equal(sourceFreshness('not a time', 48, NOW), 'not_recorded');
  assert.equal(sourceFreshness(new Date(NOW - 47 * h).toISOString(), 48, NOW), 'fresh');
  assert.equal(sourceFreshness(new Date(NOW - 48 * h).toISOString(), 48, NOW), 'fresh', 'the window itself is still Fresh');
  assert.equal(sourceFreshness(new Date(NOW - 49 * h).toISOString(), 48, NOW), 'stale');
  assert.equal(sourceFreshness('2026-11-21 13:00:00', 24, NOW), 'fresh', 'a D1 timestamp is read as UTC');
  assert.equal(sourceFreshness('2026-11-21 11:00:00', 24, NOW), 'stale');
  assert.equal(sourceFreshness('2026-11-21', 24, NOW), 'stale', 'a bare day is its midnight');
  assert.deepEqual(FRESH_WITHIN_HOURS, { mercury: 48, github: 168, google: 168 });
});

test('each connected row carries its window and freshness; GitHub read 9 days ago is Stale, Mercury read today is Fresh', async () => {
  const { db, ctx } = fixture();
  integration(db, 1, 1, 'mercury', 'active');
  integration(db, 2, 1, 'github', 'active');
  integration(db, 3, 1, 'google_workspace', 'active');
  db.exec(`INSERT INTO mercury_raise_facts (integration_id, project_id, kind, fact_key, amount_cents, burn_cents, as_of) VALUES (1, 1, 'runway', 'runway', 3300000, 200000, '2026-11-22T09:00:00Z')`);
  db.exec(`INSERT INTO github_contributors (integration_id, project_id, repository, login, commits_90d, updated_at) VALUES (2, 1, 'acme/api', 'someone', 3, '2026-11-13 10:00:00')`);
  const k = await byKey(ctx);
  assert.deepEqual([k.mercury.state, k.mercury.freshness, k.mercury.fresh_within_hours], ['connected', 'fresh', 48]);
  assert.deepEqual([k.github.state, k.github.freshness, k.github.fresh_within_hours], ['connected', 'stale', 168]);
  assert.deepEqual([k.google.state, k.google.as_of, k.google.freshness], ['connected', null, 'not_recorded'], 'no file read: Not recorded, never Fresh');
  db.close();
});

test('a lost connection is Disconnected; a paused or another founder\'s is Not connected; an active one wins', async () => {
  const { db, ctx } = fixture();
  integration(db, 1, 1, 'mercury', 'error');
  integration(db, 2, 1, 'github', 'disconnected');
  integration(db, 3, 1, 'google_workspace', 'paused');
  let k = await byKey(ctx);
  assert.deepEqual([k.mercury.state, k.mercury.freshness, k.mercury.as_of, k.mercury.fact], ['disconnected', null, null, null], 'a token the provider refused');
  assert.equal(k.github.state, 'disconnected', 'disconnected');
  assert.equal(k.google.state, 'not_connected', 'paused is the member\'s choice, not a loss');
  db.exec('DELETE FROM integrations');
  integration(db, 4, 2, 'mercury', 'error');
  assert.equal((await byKey(ctx)).mercury.state, 'not_connected', 'another founder\'s lost connection is not this venture\'s');
  db.exec('DELETE FROM integrations');
  integration(db, 5, 1, 'github', 'active');
  db.prepare(`INSERT INTO project_members (project_id, user_id, status, role) VALUES (1, 2, 'accepted', 'member')`).run();
  integration(db, 6, 2, 'github', 'error');
  assert.equal((await byKey(ctx)).github.state, 'connected', 'an active connection serves the venture even when another member lost theirs');
  db.close();
});

test('Disconnected and Unavailable are drawn apart: a failed read stays Unavailable', async () => {
  const { db, ctx } = fixture();
  integration(db, 1, 1, 'mercury', 'error');
  integration(db, 2, 1, 'github', 'active');
  db.exec('ALTER TABLE github_contributors RENAME TO github_contributors_gone');
  const k = await byKey(ctx);
  assert.equal(k.mercury.state, 'disconnected');
  assert.deepEqual([k.github.state, k.github.freshness, k.github.fresh_within_hours], ['unreadable', null, 168]);
  db.close();
});

test('the status page has a word for Disconnected', () => {
  assert.match(readFileSync(new URL('../src/services/raiseStatusPage.ts', import.meta.url), 'utf8'), /disconnected: 'Disconnected'/);
});

test('this file is the one D8258 names', () => {
  assert.match(readFileSync(new URL('../../documentation/architecture/decisions/D8258.md', import.meta.url), 'utf8'), /raise_source_freshness_8258\.test\.ts/);
});
