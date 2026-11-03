// #3938 part 5 (D1478 task 4, job NE1) — Introductions on the match-row helper.
//
//   1. The press ranks exactly the people the who-knows read answers: a member who did not
//      share, or withdrew, is never a candidate.
//   2. The candidate text is the person's title, company and how they are known: never a
//      name, an email, a phone, notes or a profile URL.
//   3. Rows follow the reranker; each carries the writer's line and the read's `ref`.
//   4. No query is 422 and runs nothing; a bad who-knows ask is the read's own refusal, and runs nothing.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/match_rows_introductions_3938.test.ts
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import relationships from '../src/routes/relationships.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { MATCH_DEPS, defaultMatchDeps, type MatchDeps } from '../src/services/ai/matchRows.ts';

after(removeMigratedDatabases);
const JWT_SECRET = 'synthetic-3938-introductions-only-not-a-real-credential';
const PRIVATE = /Synthetic (Ada|Bob|Carl)|@example\.invalid|linkedin\.com|private note|555/;

// 2 founds venture 1 and shares; 4 is its co-founder and asks; 3 founds another venture.
function fixture() {
  const db = migratedDatabase();
  const u = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active) VALUES (?, ?, ?, ?, ?, 1)');
  for (const [id, role, fid] of [[2, 'founder', 100], [3, 'founder', 300], [4, 'founder', null]] as const) u.run(id, role, fid, `Synthetic member ${id}`, `synthetic-${id}@example.invalid`);
  db.exec("INSERT INTO projects(id,name,founder_id) VALUES (1,'Synthetic venture',100),(3,'Other venture',300)");
  db.exec("INSERT INTO project_members(project_id,user_id,role,status) VALUES (1,4,'cofounder','accepted')");
  const nc = db.prepare('INSERT INTO network_connections(id,user_id,name,email,company,title,phone,notes,source,linkedin_url,connected_on) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  nc.run(21, 2, 'Synthetic Ada', 'ada@example.invalid', 'Acme', 'CTO', '+1 555 0100', 'Synthetic private note', 'linkedin_csv', 'https://www.linkedin.com/in/synthetic-ada', '2024-03-12');
  nc.run(22, 2, 'Synthetic Bob', 'bob@example.invalid', 'Acme', 'Head of procurement', null, null, 'manual', null, null);
  nc.run(31, 3, 'Synthetic Carl', null, 'Acme', 'COO', null, null, 'manual', null, null); // another venture's founder: not a teammate
  db.prepare("INSERT INTO contact_sources(owner_user_id,contact_table,contact_id,source,created_row) VALUES (2,'network_connections',21,'linkedin_csv',1)").run();
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' };
  const app = new Hono<any>().route('/api/relationships', relationships);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  return { db, env, app };
}
type F = ReturnType<typeof fixture>;

async function call(f: F, who: number, method: string, path: string, json?: unknown) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await f.app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: json === undefined ? undefined : JSON.stringify(json) }, f.env);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const RANK = '/api/relationships/who-knows/rank?company=Acme';

/** Fake deps: the texts it was handed, and a reranker that reverses the order. */
function stub() {
  const seen = { query: '', texts: [] as string[], runs: 0 };
  const made: Array<[string, string]> = [];
  MATCH_DEPS.make = (_env, charge, job) => {
    made.push([String(charge.surface), job]);
    const d: MatchDeps = {
      async embed(t) { seen.runs += 1; return [t.length % 7, 1]; },
      async rerank(q, ctx) { seen.query = q; seen.texts = ctx; return ctx.map((_, i) => ({ index: ctx.length - 1 - i, score: 1 - i / 10 })); },
      async write(_p, rows) { return Array.from({ length: rows }, (_, i) => `${i + 1}. Line ${i + 1}.`).join('\n'); },
    };
    return d;
  };
  return { seen, made, restore: () => { MATCH_DEPS.make = defaultMatchDeps; } };
}

test('#3938 NE1 introductions: ranks exactly the people who-knows answers, with a line each', async () => {
  const f = fixture();
  const s = stub();
  try {
    assert.equal((await call(f, 2, 'PUT', '/api/relationships/sharing', { share: true })).status, 200);
    const read = await call(f, 4, 'GET', '/api/relationships/who-knows?company=Acme');
    const r = await call(f, 4, 'POST', RANK, { query: 'A buyer for freight software' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.job, 'NE1');
    // Mutation checked: ranking every shared_relationships row for the company instead of the read → 31 (not a teammate) is a candidate.
    assert.deepEqual(r.body.rows.map((x: any) => x.ref).sort(), read.body.people.map((p: any) => p.ref).sort(), 'the read decides who is a candidate');
    assert.deepEqual(r.body.rows.map((x: any) => x.ref).sort(), [21, 22]);
    assert.deepEqual(r.body.rows.map((x: any) => x.position), [1, 2]);
    assert.ok(r.body.rows.every((x: any) => /^Line \d\.$/.test(x.line)));
    assert.equal(s.seen.query, 'A buyer for freight software');
    const all = s.seen.texts.join(' | ');
    assert.doesNotMatch(all, PRIVATE, 'no name, email, phone, notes or URL reaches a model');
    assert.match(all, /Title: Head of procurement\. Company: Acme\. Known through: /);
    assert.deepEqual(s.made, [['/network/introductions', 'NE1']]);
  } finally { s.restore(); }
});

test('#3938 NE1 introductions: a withdrawn share takes its people out of the next press', async () => {
  const f = fixture();
  const s = stub();
  try {
    await call(f, 2, 'PUT', '/api/relationships/sharing', { share: true });
    await call(f, 2, 'PUT', '/api/relationships/sharing', { share: false });
    const r = await call(f, 4, 'POST', RANK, { query: 'A buyer for freight software' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.rows, [], 'nobody shared, nobody ranked');
    assert.equal(s.seen.texts.length, 0, 'no person text reached a model');
  } finally { s.restore(); }
});

test('#3938 NE1 introductions: no query is 422; a bad ask is the read\'s refusal; neither runs', async () => {
  const f = fixture();
  const s = stub();
  try {
    await call(f, 2, 'PUT', '/api/relationships/sharing', { share: true });
    const none = await call(f, 4, 'POST', RANK, {});
    assert.deepEqual([none.status, none.body.error], [422, 'query_missing']);
    const name = await call(f, 4, 'POST', '/api/relationships/who-knows/rank?person=Synthetic%20Ada', { query: 'x' });
    assert.deepEqual([name.status, name.body.error], [400, 'person_unmatchable'], 'a name alone never matches, here too');
    assert.equal(s.made.length, 0, 'no run');
  } finally { s.restore(); }
});
