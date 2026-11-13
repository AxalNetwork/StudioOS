// #3938 part 4 (D1478 task 4, job NE1) — the co-founder and advisor surfaces on the match-row helper.
//
//   1. The press ranks exactly the cards the free read answers: its filters (matching consent,
//      the directory, a pause) still decide who is a candidate.
//   2. The candidate text is the card's own fields: never a name or an email.
//   3. Rows follow the reranker; each carries the writer's line.
//   4. No query (and, for a co-founder, nothing in the profile) is 422 and runs nothing.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/match_rows_ne1_surfaces_3938.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import cofounder from '../src/routes/cofounder.ts';
import advisors from '../src/routes/advisors.ts';
import { MATCH_DEPS, defaultMatchDeps, type MatchDeps } from '../src/services/ai/matchRows.ts';

const JWT_SECRET = 'unit-test-jwt-secret-3938-ne1-surfaces-0123456789ab';
const BASELINE = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const DIR = 'cloudflare-worker/sql/migrations';
const MIGRATIONS = readdirSync(DIR).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort(compareMigrations).map((n) => readFileSync(`${DIR}/${n}`, 'utf8'));
const ME = 1;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(BASELINE);
  for (const m of MIGRATIONS) db.exec(m);
  const u = db.prepare("INSERT INTO users (id, uid, role, name, email, is_active) VALUES (?, ?, ?, ?, ?, 1)");
  u.run(ME, 'u-me', 'founder', 'Fay Founder', 'fay@example.test');
  u.run(2, 'u-ada', 'founder', 'Ada Lovelace', 'ada@example.test');
  u.run(3, 'u-ben', 'founder', 'Ben Bright', 'ben@example.test');
  u.run(4, 'u-cy', 'founder', 'Cy Hidden', 'cy@example.test');
  u.run(5, 'u-dee', 'advisor', 'Dee Advisor', 'dee@example.test');
  u.run(6, 'u-eve', 'advisor', 'Eve Paused', 'eve@example.test');
  const p = db.prepare("INSERT INTO cofounder_profiles (uid, user_id, commitment, looking_for, skills_json, sectors_json, bio, listed) VALUES (?, ?, 'full_time', ?, ?, ?, ?, 1)");
  p.run('p-me', ME, 'A technical co-founder for logistics', '[]', '[]', null);
  p.run('p-ada', 2, 'A commercial partner', '["engineering","ml"]', '["logistics"]', 'Built routing systems.');
  p.run('p-ben', 3, 'A technical partner', '["sales"]', '["fintech"]', 'Sold to banks.');
  p.run('p-cy', 4, 'Anything', '["engineering"]', '["logistics"]', 'Opted out.');
  db.exec("CREATE TABLE IF NOT EXISTS user_settings (user_id INTEGER PRIMARY KEY, matching_opt_in INTEGER DEFAULT 0, show_in_directory INTEGER DEFAULT 1)");
  for (const id of [2, 3]) db.prepare('INSERT OR REPLACE INTO user_settings (user_id, matching_opt_in) VALUES (?, 1)').run(id);
  const a = db.prepare("INSERT INTO advisors (uid, user_id, display_name, email, bio, expertise_json, sectors_json, headline, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, '2026-10-01', '2026-10-01')");
  a.run('a-dee', 5, 'Dee Advisor', 'dee@example.test', 'Ran ops at a freight company.', '["operations"]', '["logistics"]', 'Operator');
  a.run('a-eve', 6, 'Eve Paused', 'eve@example.test', 'Paused advisor.', '["finance"]', '["fintech"]', 'CFO');
  db.prepare("INSERT INTO network_member_states (user_id, paused_at) VALUES (6, '2026-10-01')").run();
  return db;
}

const app = new Hono<any>();
app.route('/api/cofounder', cofounder);
app.route('/api/advisors', advisors);
app.onError((err: any, c) => {
  const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
  if (s) return c.json({ detail: err.message }, s);
  throw err;
});
async function post(db: DatabaseSync, path: string, body: unknown) {
  const tok = await new SignJWT({ user_id: ME, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(path, { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

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

test('#3938 NE1 co-founder: ranks the browse cards, anonymous, with a line each', async () => {
  const s = stub();
  try {
    const r = await post(fixture(), '/api/cofounder/browse/rank', { query: 'A technical co-founder in logistics' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.job, 'NE1');
    // Mutation checked: ranking every listed profile instead of browse's cards → p-cy (no consent) is a candidate.
    assert.deepEqual(r.body.rows.map((x: any) => x.uid).sort(), ['p-ada', 'p-ben'], 'browse\'s consent filter still decides');
    assert.ok(r.body.rows.every((x: any) => /^Line \d\.$/.test(x.line)));
    const all = s.seen.texts.join(' | ');
    assert.doesNotMatch(all, /@example\.test|Ada|Ben|Lovelace/, 'no name or email reaches a model');
    assert.match(all, /Skills: engineering, ml/);
    assert.deepEqual(s.made, [['/spinout-lab/cofounder-match', 'NE1']]);
  } finally { s.restore(); }
});

test('#3938 NE1 co-founder: with no query, the profile\'s own words; with neither, 422 and no run', async () => {
  const s = stub();
  try {
    const db = fixture();
    const r = await post(db, '/api/cofounder/browse/rank', {});
    assert.equal(r.status, 200);
    assert.equal(s.seen.query, 'A technical co-founder for logistics', 'the profile\'s looking_for');
    db.prepare("UPDATE cofounder_profiles SET looking_for = NULL WHERE user_id = ?").run(ME);
    s.seen.runs = 0;
    const none = await post(db, '/api/cofounder/browse/rank', {});
    assert.deepEqual([none.status, none.body.error], [422, 'query_missing']);
    assert.equal(s.seen.runs, 0, 'nothing ran');
  } finally { s.restore(); }
});

test('#3938 NE1 advisors: ranks the matched advisors, never a paused one, never an email', async () => {
  const s = stub();
  try {
    const db = fixture();
    const none = await post(db, '/api/advisors/match/rank', {});
    assert.deepEqual([none.status, none.body.error], [422, 'query_missing']);
    assert.equal(s.made.length, 0, 'no query, no run');
    const r = await post(db, '/api/advisors/match/rank', { query: 'Scaling freight operations' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    // Mutation checked: reading every active advisor instead of /match's list → a-eve (paused) is a candidate.
    assert.deepEqual(r.body.rows.map((x: any) => x.uid), ['a-dee'], 'the paused advisor is not a candidate');
    assert.doesNotMatch(s.seen.texts.join(' | '), /@example\.test|Dee Advisor/);
    assert.match(s.seen.texts[0], /Expertise: operations/);
    assert.deepEqual(s.made, [['/build/team', 'NE1']]);
  } finally { s.restore(); }
});
