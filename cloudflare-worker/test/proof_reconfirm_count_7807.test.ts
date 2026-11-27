/**
 * D7807 (#7807) — `GET /me/proof` counts the claims that need reconfirmation
 * over the whole list, in the same read as its other counts, so the
 * Verification tile and the Expertise overview no longer count a page.
 *
 *   needs_reconfirmation   a claim whose card reads Needs reconfirmation: no
 *                          live confirmation, no ask awaiting an answer, and a
 *                          given consent about an earlier reading of the claim
 *                          (or one recorded before D4670)
 *   a count that did not come back is null, never 0
 *
 * On the migrated schema, synthetic rows only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/proof_reconfirm_count_7807.test.ts
 */
import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import advisors from '../src/routes/advisors.ts';

const SECRET = 'test'.repeat(16);
test.after(() => removeMigratedDatabases());
const SAME = '2026-10-01T09:00:00.000Z';
const pin = (title: string) => JSON.stringify({ kind: 'engagement', title, organization: null, period_note: null, detail: null });
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** `aggregate`: what the whole-list count read does — answer, come back empty, or throw. */
function fixture() {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO users(id,name,email,role,is_active) VALUES
      (21,'Advisor','a@example.test','advisor',1),(22,'Advisor Two','a2@example.test','advisor',1);
    INSERT INTO advisors(id,uid,user_id,display_name,email) VALUES (201,'a-1',21,'Advisor','a@example.test'),(202,'a-2',22,'Advisor Two','a2@example.test');
  `);
  const aggregate = { mode: 'answer' as 'answer' | 'empty' | 'throw' };
  const binding = d1Over(db);
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: { ...binding, prepare(sql: string) {
    const real = binding.prepare(sql);
    if (aggregate.mode === 'answer' || !/AS needs_reconfirmation/.test(sql)) return real;
    const statement: any = {
      bind: () => statement,
      first: async () => { if (aggregate.mode === 'throw') throw new Error('D1_ERROR: synthetic read failed'); return null; },
    };
    return statement;
  } } };
  const app = new Hono<any>();
  app.route('/api/advisors', advisors);
  const get = async (path: string, who = 21) => {
    const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const res = await app.request(`/api/advisors${path}`, { headers: { Authorization: `Bearer ${jwt}` } }, env);
    return { status: res.status, body: await res.json() as any };
  };
  return { db, get, aggregate };
}

/**
 * 205 claims, so page 1 (200 rows, newest id first) holds 6..205 and page 2
 * holds 1..5. Every claim that needs reconfirmation is on page 2.
 *
 *   1  confirmed about an earlier title            needs reconfirmation
 *   2  confirmed before D4670 (nothing pinned)     needs reconfirmation
 *   3  a stale confirmation and a live one         confirmed, not counted
 *   4  a stale confirmation and a new ask out      awaiting, not counted
 *   5  a stale confirmation, then withdrawn        withdrawn, not counted
 *   206 another advisor's stale confirmation       not theirs, not counted
 */
function seed(db: any) {
  const p = db.prepare('INSERT INTO advisor_proof_items(id,uid,advisor_id,title,created_at) VALUES (?,?,?,?,?)');
  for (let i = 1; i <= 205; i += 1) p.run(i, `pr-${i}`, 201, `Claim ${i}`, SAME);
  p.run(206, 'pr-theirs', 202, 'Theirs', SAME);
  const c = db.prepare(`INSERT INTO advisor_proof_consents(uid,proof_item_id,attester_name,consent_given,consent_given_at,withdrawn_at,claim_json,claim_sha256)
    VALUES (?,?,?,?,?,?,?,?)`);
  const stale = (uid: string, item: number, withdrawn: string | null = null) =>
    c.run(uid, item, 'Earlier', 1, SAME, withdrawn, pin('An earlier wording'), sha(pin('An earlier wording')));
  stale('c-1', 1);
  c.run('c-2', 2, 'Before codes', 1, SAME, null, null, null);
  stale('c-3a', 3);
  c.run('c-3b', 3, 'Current', 1, SAME, null, pin('Claim 3'), sha(pin('Claim 3')));
  stale('c-4a', 4);
  c.run('c-4b', 4, 'Asked again', 0, null, null, pin('Claim 4'), sha(pin('Claim 4')));
  stale('c-5', 5, SAME);
  stale('c-theirs', 206);
}

test('more claims than one page: the reconfirmation count is the whole list, the same on every page', async () => {
  // Mutation checked: the stale EXISTS made to match current claims → 2 becomes 0 (and the page-2 card rule still says 2).
  // Mutation checked: `awaiting = 0` dropped from the CASE → claim 4 counts and 2 becomes 3.
  // Mutation checked: `attested = 0` dropped from the CASE → claim 3 counts and 2 becomes 3.
  const { db, get } = fixture();
  seed(db);
  const one = await get('/me/proof');
  const two = await get('/me/proof?offset=200');
  assert.equal(one.status, 200);
  assert.equal(one.body.items.length, 200);
  assert.equal(one.body.items.flatMap((x: any) => x.consents).length, 0, 'no claim with a consent is on page 1');
  assert.deepEqual(two.body.items.map((x: any) => x.uid), ['pr-5', 'pr-4', 'pr-3', 'pr-2', 'pr-1']);
  for (const body of [one.body, two.body]) {
    assert.equal(body.counts.needs_reconfirmation, 2, 'claims 1 and 2, counted on the page that does not hold them');
    assert.equal(body.counts.total, 205);
    assert.equal(body.counts.attested, 1);
    assert.equal(body.counts.awaiting, 1);
  }
  // The count agrees with the consent states the Worker sends for the same claims.
  const byUid = Object.fromEntries(two.body.items.map((x: any) => [x.uid, x]));
  for (const uid of ['pr-1', 'pr-2']) {
    assert.equal(byUid[uid].attested, false);
    assert.deepEqual(byUid[uid].consents.map((x: any) => x.state), ['needs_reconfirmation']);
  }
});

test('no claims is a real zero; a count that did not come back is null, never 0', async () => {
  // Mutation checked: `countOrNull` replaced by `Number(v) || 0` → the empty aggregate reads 0, not null.
  // Mutation checked: the COALESCE around the new SUM dropped → an advisor with no claims reads null, not 0.
  const { db, get, aggregate } = fixture();
  const none = await get('/me/proof');
  assert.equal(none.status, 200);
  assert.strictEqual(none.body.counts.needs_reconfirmation, 0, 'nothing to reconfirm is 0, an answer');
  seed(db);
  aggregate.mode = 'empty';
  const unread = await get('/me/proof?offset=200');
  assert.equal(unread.status, 200, 'the page still answers');
  assert.equal(unread.body.items.length, 5);
  assert.strictEqual(unread.body.counts.needs_reconfirmation, null);
  aggregate.mode = 'throw';
  const failed = await get('/me/proof');
  assert.equal(failed.status, 500, 'a failed count read is an error, never a page of zeros');
  assert.equal(failed.body.counts, undefined);
});
