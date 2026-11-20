/**
 * D7513 (#7513, canvas D6053) — the Worker side of what D6863 left: step 3 of a
 * draft started from a closed call (`GET /api/round-calls/:uid/source-audience`,
 * RAC20C and RAC20D) and the call a recorded commitment keeps on Capital
 * relationships › Commitments (`commitmentsRead`'s `line.call`, RAC22C).
 *
 * Real routes and services over the migrated SQLite schema. Every person and
 * figure is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/round_call_follow_through_7513.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import routes from '../src/routes/round_call_follow_through.ts';
import { commitmentsRead } from '../src/services/capRelReads.ts';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const SECRET = 'fixture-only-d7513-01234567890123456789';

/**
 * People: 1 the owner; 6 an accepted co-founder; 2 another founder.
 * Call 1 (closed) chose: 4 Ivy (responded, verified, in the pipeline), 10 Moe (did not respond, verified, in the
 * pipeline), 12 Rae (responded, KYC pending now), 13 Sol (not delivered, account paused), 15 Uma (verified, not in the
 * pipeline); 11 Quinn was a match (in the pipeline, never copied). Call 2 is a draft started from call 1; call 3 a
 * draft from nothing; call 5 a draft whose source is another venture's call 4.
 */
function fixture(on = true) {
  const db = new DatabaseSync(':memory:', { ...SCHEMA_OPTIONS, enableForeignKeyConstraints: false });
  loadSchema(db);
  db.exec("INSERT INTO founders(id,name,email) VALUES(1,'Owner','owner@example.test'),(2,'Other','other@example.test'),(6,'Cofounder','co@example.test')");
  const user = db.prepare('INSERT INTO users(id,name,email,role,founder_id,kyc_status,is_active) VALUES(?,?,?,?,?,?,?)');
  for (const row of [[1, 'Owner', 'owner@example.test', 'founder', 1, 'approved', 1], [2, 'Other', 'other@example.test', 'founder', 2, 'approved', 1],
    [6, 'Cofounder', 'co@example.test', 'founder', 6, 'approved', 1],
    [4, 'Ivy', 'ivy@example.test', 'investor', null, 'approved', 1], [10, 'Moe', 'moe@example.test', 'investor', null, 'approved', 1],
    [11, 'Quinn', 'quinn@example.test', 'investor', null, 'approved', 1], [12, 'Rae', 'rae@example.test', 'investor', null, 'pending', 1],
    [13, 'Sol', 'sol@example.test', 'investor', null, 'approved', 0], [15, 'Uma', 'uma@example.test', 'investor', null, 'approved', 1]]) user.run(...row);
  db.exec(`INSERT INTO projects(id,uid,name,founder_id,company_id,sector,stage,description) VALUES
      (1,'energy','Energy',1,NULL,'climate','seed','energy storage'),(2,'other','Other',2,NULL,'climate','seed','other');
    INSERT INTO project_members(project_id,user_id,role,status) VALUES (1,6,'cofounder','accepted');
    INSERT INTO raise_prospects(id,uid,project_id,name,email,stage,commit_status,amount) VALUES
      (1,'p1',1,'Ivy','IVY@example.test','committed','soft',50000),(2,'p2',1,'Moe','moe@example.test','contacted',NULL,NULL),
      (3,'p3',1,'Rae','rae@example.test','contacted',NULL,NULL),(4,'p4',1,'Sol','sol@example.test','contacted',NULL,NULL),
      (5,'p5',1,'Quinn','quinn@example.test','contacted',NULL,NULL),(9,'p9',2,'Uma','uma@example.test','contacted',NULL,NULL);
    INSERT INTO round_calls(id,uid,project_id,name,amount_cents,instrument,terms,minimum_cheque_cents,target_close,stage,sector,state,terms_hash,created_by,sent_at,closed_at,source_call_id) VALUES
      (1,'seed-ext',1,'Seed extension',50000000,'safe','Plain terms',2500000,'2099-01-15','seed','climate','closed','h1',1,'2026-10-01','2026-10-12',NULL),
      (2,'bridge',1,'Bridge',40000000,'safe','Plain terms',2500000,'2099-03-01','seed','climate','draft','h2',6,NULL,NULL,1),
      (3,'fresh',1,'Fresh',40000000,'safe','Plain terms',2500000,'2099-03-01','seed','climate','draft','h3',1,NULL,NULL,NULL),
      (4,'theirs',2,'Theirs',40000000,'safe','Plain terms',2500000,'2099-03-01','seed','climate','closed','h4',2,'2026-10-01','2026-10-12',NULL),
      (5,'stray',1,'Stray',40000000,'safe','Plain terms',2500000,'2099-03-01','seed','climate','draft','h5',1,NULL,NULL,4);
    INSERT INTO round_call_recipients(id,call_id,investor_user_id,origin,match_reasons_json,opened_at,responded_at,commitment_cents,delivery_state) VALUES
      (1,1,4,'chosen','[]','2026-10-02','2026-10-03',5000000,'notified'),(2,1,10,'chosen','[]','2026-10-02',NULL,NULL,'notified'),
      (3,1,11,'match','["Climate"]',NULL,NULL,NULL,'notified'),(4,1,12,'chosen','[]','2026-10-02','2026-10-05',NULL,'notified'),
      (5,1,13,'chosen','[]',NULL,NULL,NULL,'not_delivered'),(6,1,15,'chosen','[]',NULL,NULL,NULL,'notified'),
      (7,4,4,'chosen','[]',NULL,NULL,NULL,'notified');`);
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'production', ROUND_CALLS_ENABLED: on ? 'true' : 'false' };
  return { db, env };
}

async function call(f: any, path: string, who: number | null = 1, method = 'GET', body?: unknown) {
  const app = new Hono<any>(); app.route('/round-calls', routes);
  app.onError((e, c) => c.json({ error: e.message }, (AUTH_ERROR_STATUSES[e.message] || 500) as any));
  const headers: any = {};
  if (who) headers.Authorization = 'Bearer ' + await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const saved = console.error; console.error = () => {};
  try {
    const res = await app.request('/round-calls' + path, { method, headers, ...body === undefined ? {} : { body: JSON.stringify(body) } }, f.env);
    return { status: res.status, body: await res.json() as any };
  } finally { console.error = saved; }
}

test('step 3 from a closed call: its chosen investors, ticked only when still verified and in this pipeline; matches never copied', async () => {
  // Mutation checked: a match copied (origin filter dropped); a KYC-pending investor ticked; an inactive account ticked;
  // an investor outside this venture's pipeline ticked (prospect project filter dropped); the email case not folded.
  const f = fixture();
  const r = await call(f, '/bridge/source-audience');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.source, { uid: 'seed-ext', name: 'Seed extension', closed_at: '2026-10-12' });
  assert.equal(r.body.can_set, true);
  assert.deepEqual(r.body.rows.map((x: any) => [x.name, x.on_source, x.today, x.ticked, x.prospect_id]), [
    ['Ivy', 'responded', 'verified', true, 1],
    ['Moe', 'did_not_respond', 'verified', true, 2],
    ['Rae', 'responded', 'not_verified', false, 3],
    ['Sol', 'not_delivered', 'not_active', false, 4],
    ['Uma', 'did_not_respond', 'not_in_pipeline', false, null],
  ]);
  assert.deepEqual(r.body.counts, { chosen: 5, responded: 2, did_not_respond: 2, not_delivered: 1, ticked: 2 });
  assert.doesNotMatch(JSON.stringify(r.body), /Quinn|@example|investor_user_id/i, 'no match, no email, no user id');
});

test('step 3 from a closed call: the co-founder reads it but does not set it; everyone else is refused with a code', async () => {
  // Mutation checked: can_set true for a co-founder; a sent or closed call answered; a draft with no source answered;
  // another venture's call read as the source (project filter dropped); the flag ignored.
  const f = fixture();
  const member = await call(f, '/bridge/source-audience', 6);
  assert.deepEqual([member.status, member.body.can_set, member.body.counts.ticked], [200, false, 2]);
  assert.equal((await call(f, '/bridge/source-audience', 2)).status, 404, 'another founder does not find the draft');
  assert.equal((await call(f, '/bridge/source-audience', null)).status, 401);
  const closed = await call(f, '/seed-ext/source-audience');
  assert.deepEqual([closed.status, closed.body.code], [409, 'call_read_only']);
  const fresh = await call(f, '/fresh/source-audience');
  assert.deepEqual([fresh.status, fresh.body.code, fresh.body.message], [409, 'no_source_call', 'This draft was not started from a closed call.']);
  const stray = await call(f, '/stray/source-audience');
  assert.deepEqual([stray.status, stray.body.code], [404, 'source_not_found']);
  assert.equal((await call(fixture(false), '/bridge/source-audience')).status, 503, 'calls switched off');
});

test('Commitments: a line recorded from a call keeps that call and its uid; a typed line from no call has none', async () => {
  // Mutation checked: the call not read onto the typed line; another venture's call named (project join dropped);
  // a failed link read drawn as "from no call" instead of `call_links: unreadable`.
  const f = fixture();
  const recorded = await call(f, '/seed-ext/commitments', 1, 'POST', { recipient_id: 1, status: 'signed', amount_cents: 4500000 });
  assert.equal(recorded.status, 200, JSON.stringify(recorded.body));
  f.db.exec("UPDATE raise_prospects SET stage='committed',commit_status='soft',amount=1000,round_call_uid='theirs' WHERE id=2");
  const read = await commitmentsRead(f.env, 1, null);
  assert.equal(read.call_links, 'ok');
  const typed = (pid: number) => read.investors.find((i: any) => i.prospect_id === pid)!.lines.find((l: any) => l.source === 'typed')!;
  assert.deepEqual([typed(1).status, typed(1).cents, typed(1).call], ['signed', 4500000, { uid: 'seed-ext', name: 'Seed extension' }]);
  assert.equal(typed(2).call, null, 'another venture\'s call is never named here');
  f.db.exec('ALTER TABLE raise_prospects RENAME COLUMN round_call_uid TO gone_uid');
  const saved = console.warn; console.warn = () => {};
  try {
    const partial = await commitmentsRead(f.env, 1, null);
    assert.equal(partial.call_links, 'unreadable');
    const line = partial.investors.find((i: any) => i.prospect_id === 1)!.lines.find((l: any) => l.source === 'typed')!;
    assert.equal('call' in line, false, 'unread is not "from no call"');
    assert.equal(partial.totals.partial, false, 'the amounts are all read');
  } finally { console.warn = saved; }
});
