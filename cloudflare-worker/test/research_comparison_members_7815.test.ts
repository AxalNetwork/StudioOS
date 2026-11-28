/** D7815 (#7815): overlapping mounted add-member requests retain the column limit and distinct positions on SQLite.
 *
 * From cloudflare-worker/test/README.md (moved by #6472): D7815: overlapping mounted add-member
 * requests in all arrival orders preserve the live limit, distinct positions and duplicate
 * response.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import comparisons from '../src/routes/research_project_comparisons.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { schemaPath, SCHEMA_OPTIONS } from './_schema_once.mjs';
const schema = schemaPath(), secret = 'synthetic-comparison-member-7815-secret';
const app = new Hono<any>().route('/api/research/projects', comparisons);
app.onError((e, c) => c.json({ detail: e.message }, 500));
const permutations = (items: number[]): number[][] => items.length ? items.flatMap((x, i) => permutations(items.filter((_, j) => i !== j)).map(rest => [x, ...rest])) : [[]];
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'comparison-members-7815-')), file = join(dir, 'fixture.sqlite');
  copyFileSync(schema, file); const db = new DatabaseSync(file, SCHEMA_OPTIONS);
  db.exec("INSERT INTO users(id,email,name,role) VALUES(701,'owner@example.test','Synthetic owner','founder'); INSERT INTO research_projects(id,uid,owner_user_id,title,question,created_by) VALUES(1,'project-one',701,'Synthetic project','Which company?',701); INSERT INTO research_project_comparisons(id,uid,project_id,owner_user_id,kind,title,created_by) VALUES(1,'comparison-one',1,701,'company','Synthetic comparison',701)");
  for (let i = 1; i <= 9; i++) {
    db.prepare("INSERT INTO research_company_directory(uid,name,website,country,source_name,source_url,as_of) VALUES(?,?,?,'Canada','Wikidata',?,'2026-09-30')").run(`c-${i}`, `Synthetic ${i}`, `https://example.test/c-${i}`, `https://example.test/source-${i}`);
    db.prepare("INSERT INTO research_project_subjects(id,project_id,owner_user_id,kind,directory_uid,name,created_by) VALUES(?,1,701,'company',?,?,701)").run(i, `c-${i}`, `Synthetic ${i}`);
    if (i <= 5) db.prepare("INSERT INTO research_project_comparison_members(comparison_id,subject_id,kind,position,created_by) VALUES(1,?,'company',?,701)").run(i, i);
  }
  const token = await new SignJWT({ user_id: 701, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
  const base = d1Over(db), waiting: (() => void)[] = [];
  let overlap = 0;
  const DB = { ...base, prepare(sql: string) {
    const statement = base.prepare(sql);
    if (!sql.startsWith('SELECT COUNT(*) AS n, COALESCE(MAX(position)')) return statement;
    const original = statement.first.bind(statement);
    statement.first = async () => {
      const snapshot = await original();
      if (overlap) {
        await new Promise<void>(resolve => { waiting.push(resolve); if (waiting.length === overlap) { overlap = 0; for (const wake of waiting.splice(0)) wake(); } });
      }
      return snapshot;
    };
    return statement;
  } };
  const env: any = { DB, JWT_SECRET: secret, ENVIRONMENT: 'development' };
  return { db, overlap(n: number) { overlap = n; }, close() { db.close(); rmSync(dir, { recursive: true, force: true }); }, async add(id: number) {
    const r = await app.request('/api/research/projects/project-one/comparisons/comparison-one/members', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: `c-${id}` }) }, env);
    return { status: r.status, body: await r.json() as any };
  }, members() { return db.prepare('SELECT subject_id,position FROM research_project_comparison_members WHERE comparison_id=1 ORDER BY position').all().map(row => ({ ...row })); } };
}
for (const order of permutations([6, 7, 8])) test(`D7815 overlapping add order ${order.join(',')} stays at six distinct columns and positions`, async () => {
  const f = await fixture(); try {
    f.overlap(3);
    const results = await Promise.all(order.map(id => f.add(id)));
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409, 409], JSON.stringify(results));
    assert.deepEqual(results.filter(r => r.status === 200).map(r => r.body), [{ ok: true, added: true }]);
    assert.deepEqual(results.filter(r => r.status === 409).map(r => r.body), [{ detail: 'comparison_full' }, { detail: 'comparison_full' }]);
    const rows = f.members();
    assert.equal(rows.length, 6);
    assert.equal(new Set(rows.map(r => r.subject_id)).size, 6);
    assert.deepEqual(rows.map(r => r.position), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(await f.add(Number(rows[5].subject_id)), { status: 200, body: { ok: true, added: false } });
  } finally { f.close(); }
});
test('D7815 overlapping duplicate requests keep the existing false-added response and one column', async () => {
  const f = await fixture(); try {
    f.overlap(2);
    const results = await Promise.all([f.add(6), f.add(6)]);
    assert.deepEqual(results.map(r => r.status), [200, 200], JSON.stringify(results));
    assert.deepEqual(results.map(r => r.body.added).sort(), [false, true]);
    assert.equal(f.members().length, 6);
    assert.deepEqual(f.members().map(r => r.position), [1, 2, 3, 4, 5, 6]);
  } finally { f.close(); }
});
