/**
 * #9187 — a double-clicked pipeline vote answers 200 twice, and a vote for a
 * deal that does not exist is refused.
 *
 *   * The cast used to SELECT the caller's row and then INSERT when there was
 *     none. Two near-simultaneous first votes both saw "none"; the loser's
 *     INSERT hit UNIQUE(deal_id, user_id) and answered 500 `vote_failed`
 *     although the vote had been saved. The write is now one upsert.
 *   * A deal is a `projects` row: the pipeline board lists `projects` and keys
 *     every vote by that id. A vote for an id with no row used to answer 200
 *     and leave an orphan; it now answers 404 `deal_not_found` and writes
 *     nothing.
 *
 * Runs the real router on the real migrated schema (`_storage_schema.ts`), so
 * the unique constraint and the ON CONFLICT clause are SQLite's own.
 *
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/votes_upsert_9187.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import votes from '../src/routes/votes.ts';

test.after(() => removeMigratedDatabases());

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
type Db = ReturnType<typeof migratedDatabase>;

const DEAL = 9;
const MISSING_DEAL = 4242;
const PARTNER = 21;
const OTHERS = [22, 23, 24];

function coerce(a: any[]): any[] { return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v)); }
/**
 * Lockstep for parallel requests. Real D1 answers each request's statements
 * over the network, so two clicks a few milliseconds apart each run their
 * read before either runs its write. An in-process SQLite answers every
 * statement at once and the requests rarely overlap, which is how a
 * read-then-write passes here and fails in production. Every statement that
 * names `pipeline_votes` waits until each request still in flight has reached
 * one too, then all of them run in arrival order. No timer: a request that
 * finishes `leave()`s, so the rest are never left waiting for it.
 */
function lockstep(parties: number) {
  let active = parties;
  let waiting: Array<() => void> = [];
  const release = () => {
    if (!waiting.length || waiting.length < active) return;
    const go = waiting; waiting = [];
    for (const f of go) f();
  };
  return {
    arrive: () => new Promise<void>((resolve) => { waiting.push(resolve); release(); }),
    leave: () => { active -= 1; release(); },
  };
}
type Gate = ReturnType<typeof lockstep>;

function makeD1(db: Db, gate?: Gate) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const wait = () => (gate && /\bpipeline_votes\b/.test(sql) ? gate.arrive() : Promise.resolve());
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { await wait(); return db.prepare(sql).get(...b) ?? null; },
        async all() { await wait(); return { results: db.prepare(sql).all(...b) }; },
        async run() {
          await wait();
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const out = []; for (const st of x || []) out.push(await st.run()); return out; },
  };
}

function seeded(gate?: Gate): { db: Db; env: any } {
  const db = migratedDatabase();
  const user = db.prepare('INSERT INTO users (id, email, name, role) VALUES (?,?,?,?)');
  user.run(PARTNER, 'pat@example.com', 'Pat Partner', 'partner');
  for (const id of OTHERS) user.run(id, `p${id}@example.com`, `Partner ${id}`, 'partner');
  db.prepare("INSERT INTO projects (id, name, status) VALUES (?, 'Venture', 'active')").run(DEAL);
  return { db, env: { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db, gate) } };
}

async function token(userId: number, role: string) {
  return new SignJWT({ user_id: userId, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function cast(env: any, dealId: number, userId: number, body: any, gate?: Gate) {
  let res: Response;
  try {
    res = await votes.request(`/${dealId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await token(userId, 'partner')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, env);
  } finally { gate?.leave(); }
  return { status: res.status, body: await res.json() as any };
}

const rowsFor = (db: Db, dealId: number) =>
  db.prepare('SELECT user_id, vote_type, comment FROM pipeline_votes WHERE deal_id = ? ORDER BY user_id').all(dealId).map((r: any) => ({ ...r }));

test('four parallel first votes by one caller all answer 200 and leave one row', async () => {
  const gate = lockstep(4);
  const { db, env } = seeded(gate);
  const answers = await Promise.all([1, 2, 3, 4].map(() => cast(env, DEAL, PARTNER, { vote_type: 'Buy' }, gate)));
  assert.deepEqual(answers.map((a) => a.status), [200, 200, 200, 200]);
  for (const a of answers) assert.equal(a.body.my_vote.vote_type, 'Buy');
  assert.deepEqual(rowsFor(db, DEAL), [{ user_id: PARTNER, vote_type: 'Buy', comment: null }]);
});

test('parallel first votes by four callers are four rows, each answered 200', async () => {
  const gate = lockstep(4);
  const { db, env } = seeded(gate);
  const answers = await Promise.all([PARTNER, ...OTHERS].map((id) => cast(env, DEAL, id, { vote_type: 'Hold' }, gate)));
  assert.deepEqual(answers.map((a) => a.status), [200, 200, 200, 200]);
  assert.deepEqual(rowsFor(db, DEAL).map((r) => r.user_id), [PARTNER, ...OTHERS]);
});

test('a changed vote by the same caller updates its one row', async () => {
  const { db, env } = seeded();
  const first = await cast(env, DEAL, PARTNER, { vote_type: 'Buy', comment: 'good team' });
  assert.equal(first.status, 200);
  const second = await cast(env, DEAL, PARTNER, { vote_type: 'Pass', comment: 'weak moat' });
  assert.equal(second.status, 200);
  assert.deepEqual(rowsFor(db, DEAL), [{ user_id: PARTNER, vote_type: 'Pass', comment: 'weak moat' }]);
  assert.equal(second.body.total_voters, 1);
  assert.equal(second.body.by_type.Buy.count, 0);
  assert.equal(second.body.by_type.Pass.count, 1);
});

test('a vote for a deal that does not exist answers 404 and writes nothing', async () => {
  const { db, env } = seeded();
  const r = await cast(env, MISSING_DEAL, PARTNER, { vote_type: 'Strong_Buy' });
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'deal_not_found');
  assert.equal(typeof r.body.message, 'string');
  assert.deepEqual(rowsFor(db, MISSING_DEAL), []);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM pipeline_votes').get() as any).n, 0);
});
