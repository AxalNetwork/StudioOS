/** D9068 (#9068): the member side of /api/intro-requests — the desk's lanes by who acts next, and the journey the request sheet drives, on synthetic records only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import router, { mount } from '../src/routes/intro_requests.ts';

const SECRET = 'intro-requests-9068-synthetic-test-key';
// Every person, organisation and account here is invented; addresses use the reserved example.test domain.
const ME = 906801, OTHER = 906802, OPERATOR = 906810;

function fixture() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  db.exec(`INSERT INTO users(id,email,name,role,is_active) VALUES
      (${ME},'9068-me@example.test','Synthetic founder','founder',1),
      (${OTHER},'9068-other@example.test','Synthetic investor','investor',1),
      (${OPERATOR},'9068-op@example.test','Synthetic operator','admin',1);
    INSERT INTO network_directory_sources(uid,name,url) VALUES ('src-9068','Synthetic source','https://directory.example.test');
    INSERT INTO network_directory_entries(uid,kind,source_uid,source_external_id,display_name,publication_status,observed_at) VALUES
      ('p-one','person','src-9068','r1','Person One Example','published','2026-11-01 00:00:00'),
      ('p-two','person','src-9068','r2','Person Two Example','published','2026-11-01 00:00:00'),
      ('o-one','organization','src-9068','r3','Org One Example','published','2026-11-01 00:00:00');
    PRAGMA foreign_keys=ON;`);
  const app = new Hono().route(mount.path, router);
  app.onError((e, c) => {
    const m = e.message;
    const status = m === 'Unauthorized' ? 401 : /required/i.test(m) ? 403 : 500;
    return c.json({ detail: status === 500 ? 'Unavailable' : m }, status);
  });
  return { db, app, env: { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any };
}
type F = ReturnType<typeof fixture>;

async function call(f: F, method: string, path: string, body?: any, who: number = ME) {
  const token = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const r = await f.app.request(`/api/intro-requests${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, f.env);
  return { status: r.status, body: (await r.json()) as any };
}
let n = 0;
async function draft(f: F, who: number, target: Record<string, unknown> = { target_entry_uid: 'p-one' }) {
  const r = await call(f, 'POST', '', { idempotency_key: `key-9068-${who}-${++n}`, purpose: 'Synthetic purpose', shareable_brief: 'Synthetic brief', ...target }, who);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.request;
}
async function makeReady(f: F, who: number) {
  await call(f, 'PUT', '/readiness/professional_profile', { value: { headline: 'Synthetic headline' } }, who);
  await call(f, 'PUT', '/readiness/capacity', { value: { capacity: 'founder' } }, who);
  for (const key of ['professional_profile', 'capacity'])
    assert.equal((await call(f, 'POST', `/operator/readiness/${who}/${key}`, { decision: 'approved' }, OPERATOR)).status, 200);
}
const setState = (f: F, uid: string, state: string, actor: string) => f.db.prepare('UPDATE network_intro_requests SET state=?, next_actor=? WHERE uid=?').run(state, actor, uid);

test('the desk lists by who acts next, with every lane counted by the server', async () => {
  const f = fixture();
  try {
    const a = await draft(f, ME); // requester
    const b = await draft(f, ME, { target_entry_uid: 'p-two' });
    const c = await draft(f, ME, { organization_entry_uid: 'o-one' });
    const d = await draft(f, ME);
    setState(f, b.uid, 'submitted', 'operator');
    setState(f, c.uid, 'awaiting_target', 'target');
    setState(f, d.uid, 'withdrawn', 'none');
    await draft(f, OTHER); // another member's draft is never counted on my desk

    const all = await call(f, 'GET', '');
    assert.equal(all.status, 200);
    assert.equal(all.body.total, 4);
    assert.deepEqual(all.body.lanes, { requester: 1, operator: 1, target: 1, none: 1 });

    const mine = await call(f, 'GET', '?next_actor=operator');
    assert.equal(mine.body.total, 1);
    assert.deepEqual(mine.body.items.map((x: any) => x.uid), [b.uid]);
    // The lane counts do not follow the filter: the four lanes stay whole.
    assert.deepEqual(mine.body.lanes, { requester: 1, operator: 1, target: 1, none: 1 });

    const needs = await call(f, 'GET', '?next_actor=requester');
    assert.deepEqual(needs.body.items.map((x: any) => x.uid), [a.uid]);

    // A lane the member has nothing in is a counted zero, not a missing key.
    const theirs = await call(f, 'GET', '', undefined, OTHER);
    assert.deepEqual(theirs.body.lanes, { requester: 1, operator: 0, target: 0, none: 0 });

    const bad = await call(f, 'GET', '?next_actor=someone');
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'next_actor_invalid');
  } finally {
    f.db.close();
  }
});

test('the sheet journey: a refused submit keeps the draft, a ready one queues it and contacts nobody', async () => {
  const f = fixture();
  try {
    // Step 1: a person not in the directory becomes a provisional target the member names.
    const p = await call(f, 'POST', '/provisional-targets', { display_name: 'Named Person Example', organization_text: 'Example Org' });
    assert.equal(p.status, 201);
    const d = await draft(f, ME, { target_provisional_uid: p.body.uid });
    assert.equal(d.target.kind, 'provisional');

    // Steps 2 and 3: the purpose, brief and private note are saved on the draft.
    const saved = await call(f, 'PATCH', `/${d.uid}`, { expected_revision: d.revision, purpose: 'Edited purpose', shareable_brief: 'Edited brief', private_notes: 'Only mine' });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.request.revision, d.revision + 1);

    // Step 4, not ready: refused by the server's readiness, the draft and its words are kept.
    const blocked = await call(f, 'POST', `/${d.uid}/submit`, { expected_revision: saved.body.request.revision });
    assert.equal(blocked.status, 200);
    assert.equal(blocked.body.request.state, 'readiness_needed');
    assert.equal(blocked.body.request.purpose, 'Edited purpose');
    assert.equal(blocked.body.request.shareable_brief, 'Edited brief');
    assert.equal(blocked.body.readiness.ready, false);
    assert.deepEqual(blocked.body.readiness.requirements.map((r: any) => [r.key, r.status]), [['professional_profile', 'missing'], ['capacity', 'missing']]);

    // A stale revision is refused and writes nothing.
    const stale = await call(f, 'POST', `/${d.uid}/submit`, { expected_revision: saved.body.request.revision });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error, 'revision_conflict');

    await makeReady(f, ME);
    const ok = await call(f, 'POST', `/${d.uid}/submit`, { expected_revision: blocked.body.request.revision });
    assert.equal(ok.body.request.state, 'submitted');
    assert.equal(ok.body.request.next_actor, 'operator');
    assert.equal(ok.body.request.policy_version, 1);
    assert.ok(ok.body.request.submitted_at);

    // Submitting contacts nobody: no attempt exists and the target was never asked.
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM network_intro_contact_attempts').get() as any).n, 0);
    assert.equal(ok.body.request.consent_status, 'not_asked');

    // The receipt read is the requester's own projection, with its activity.
    const receipt = await call(f, 'GET', `/${d.uid}`);
    assert.deepEqual(receipt.body.request.events.map((e: any) => e.type), ['draft_created', 'draft_updated', 'readiness_needed', 'submitted']);
    assert.equal(receipt.body.request.private_notes, 'Only mine');

    // Withdraw before contact is final, and a second withdraw is refused.
    const w = await call(f, 'POST', `/${d.uid}/withdraw`, { expected_revision: receipt.body.request.revision });
    assert.equal(w.body.request.state, 'withdrawn');
    assert.equal(w.body.request.events.at(-1).detail.after_contact, false);
    const again = await call(f, 'POST', `/${d.uid}/withdraw`, { expected_revision: w.body.request.revision });
    assert.equal(again.status, 409);
    assert.equal(again.body.error, 'request_not_withdrawable');

    // Another member cannot read it: the same 404 as a request that does not exist.
    const theirs = await call(f, 'GET', `/${d.uid}`, undefined, OTHER);
    assert.equal(theirs.status, 404);
    assert.equal(theirs.body.error, 'request_not_found');
  } finally {
    f.db.close();
  }
});
