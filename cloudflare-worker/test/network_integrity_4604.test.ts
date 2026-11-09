/**
 * D4604 (#4604, Network audit 1 of 5) — relationship state, private notes and introduction delivery.
 * Synthetic people on the real migrated schema; the only reachable host is the introducer's own
 * (stubbed) mailbox provider, so nothing reaches a person.
 *
 *   1. A relationship transition writes only from the state it read: a stale answer, withdrawal,
 *      removal or re-request is 409, and leaves no event and no notice behind.
 *   2. A private note is kept whole — at the full limit, beside the other party's — through every
 *      update, is refused (never cut) over the limit, and is read back only by its writer.
 *   3. An introduction's delivery is one durable attempt: a second composition cannot reach the
 *      provider while an earlier one is unconfirmed or delivered; a delivered one whose record failed
 *      is reconciled to made without sending again; the teammate's word settles an unconfirmed one.
 *
 * A "race" is a write made straight into SQLite between the route's read and its UPDATE, by a hook
 * on the first statement that matches.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/network_integrity_4604.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import partnernet from '../src/routes/partnernet.ts';
import relationships from '../src/routes/relationships.ts';
import mailAccounts from '../src/routes/mail_accounts.ts';
import { deliveryState } from '../src/services/relationships.ts';
import { saveAccount } from '../src/services/mail/accounts.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

after(removeMigratedDatabases);
const JWT_SECRET = 'synthetic-d4604-only-not-a-real-credential'.repeat(2);

type Hook = { match: RegExp; before?: () => void; fail?: boolean; fired?: boolean };
/** A D1 binding whose first statement matching a hook runs the hook first (a concurrent write), or fails. */
function hooked(inner: any, hooks: Hook[]) {
  return {
    ...inner,
    prepare(sql: string) {
      const stmt = inner.prepare(sql);
      const hook = hooks.find((h) => !h.fired && h.match.test(sql));
      if (!hook) return stmt;
      const fire = () => {
        if (hook.fired) return;
        hook.fired = true;
        hook.before?.();
        if (hook.fail) throw new Error('synthetic write failure');
      };
      const wrap = (s: any): any => ({
        bind: (...a: any[]) => wrap(s.bind(...a)),
        run: async () => { fire(); return s.run(); },
        first: async (...a: any[]) => { fire(); return s.first(...a); },
        all: async () => { fire(); return s.all(); },
      });
      return wrap(stmt);
    },
  };
}

// ── 1 and 2: the partner relationship book ──────────────────────────────────

const IDA = 10, PAM = 20, OLI = 30, ADMIN = 1;
function book() {
  const db = migratedDatabase();
  const u = db.prepare('INSERT INTO users (id, email, name, role, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(ADMIN, 'admin@example.test', 'Synthetic Admin', 'admin');
  u.run(IDA, 'ida@example.test', 'Synthetic Ida', 'investor');
  u.run(PAM, 'pam@example.test', 'Synthetic Pam', 'partner');
  u.run(OLI, 'oli@example.test', 'Synthetic Oli', 'investor');
  const hooks: Hook[] = [];
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: hooked(d1Over(db), hooks) };
  const as = async (who: number, role: string, path: string, init: { method?: string; body?: unknown } = {}) => {
    const tok = await new SignJWT({ user_id: who, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(JWT_SECRET));
    const res = await partnernet.request(path, {
      method: init.method || 'GET', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }, env);
    const text = await res.text();
    let body: any; try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body, text };
  };
  const ida = (p: string, i?: any) => as(IDA, 'investor', p, i);
  const pam = (p: string, i?: any) => as(PAM, 'partner', p, i);
  const events = (id: number) => (db.prepare('SELECT event_type FROM relationship_events WHERE relationship_id = ? ORDER BY id').all(id) as any[]).map((e) => e.event_type);
  const told = (who: number) => (db.prepare("SELECT title FROM notifications_inbox WHERE user_id = ? AND type = 'relationship_request' ORDER BY id").all(who) as any[]).map((n) => n.title);
  const row = (id: number) => db.prepare('SELECT * FROM partner_relationships WHERE id = ?').get(id) as any;
  const ask = async () => {
    const r = await ida('/relationships', { method: 'POST', body: { partner_id: PAM, relationship_type: 'co_investor' } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.id as number;
  };
  const accepted = async () => {
    const id = await ask();
    assert.equal((await pam(`/relationships/${id}/respond`, { method: 'POST', body: { decision: 'accept' } })).status, 200);
    return id;
  };
  return { db, hooks, as, ida, pam, events, told, row, ask, accepted, close: () => db.close() };
}

test('a stale answer to a request withdrawn in between is 409: no acceptance, no event, no notice', async () => {
  // Mutation checked: respond's UPDATE without `status = 'pending'` → the withdrawn row is accepted and the requester told.
  const b = book();
  try {
    const id = await b.ask();
    b.hooks.push({ match: /^\s*UPDATE partner_relationships SET status = \?, responded_at/, before: () => {
      b.db.prepare("UPDATE partner_relationships SET status = 'withdrawn' WHERE id = ?").run(id);
    } });
    const r = await b.pam(`/relationships/${id}/respond`, { method: 'POST', body: { decision: 'accept' } });
    assert.equal(r.status, 409);
    assert.equal(b.row(id).status, 'withdrawn', 'the withdrawal stands');
    assert.deepEqual(b.events(id), ['requested'], 'no accepted event for a write that changed nothing');
    assert.deepEqual(b.told(IDA), [], 'the requester is not told of an acceptance that did not happen');
    assert.deepEqual((await b.ida('/relationships')).body, [], 'nothing reached a book');
  } finally { b.close(); }
});

test('an answer read for one request cannot land on a newer request between the same pair', async () => {
  // Mutation checked: respond's UPDATE without `requested_at IS ?` → the old answer accepts the new request.
  const b = book();
  try {
    const id = await b.ask();
    b.hooks.push({ match: /^\s*UPDATE partner_relationships SET status = \?, responded_at/, before: () => {
      b.db.prepare("UPDATE partner_relationships SET requested_at = '2099-01-01T00:00:00.000Z' WHERE id = ?").run(id);
    } });
    assert.equal((await b.pam(`/relationships/${id}/respond`, { method: 'POST', body: { decision: 'decline' } })).status, 409);
    assert.equal(b.row(id).status, 'pending', 'the newer request still waits for its own answer');
    assert.deepEqual(b.events(id), ['requested']);
  } finally { b.close(); }
});

test('a withdrawal that lost to an acceptance is 409, and the acceptance stands', async () => {
  // Mutation checked: withdraw's UPDATE without `status = 'pending'` → the accepted row is pulled back.
  const b = book();
  try {
    const id = await b.ask();
    b.hooks.push({ match: /^\s*UPDATE partner_relationships SET status = 'withdrawn'/, before: () => {
      b.db.prepare("UPDATE partner_relationships SET status = 'accepted', responded_at = '2026-11-09T00:00:00.000Z' WHERE id = ?").run(id);
    } });
    assert.equal((await b.ida(`/relationships/${id}/withdraw`, { method: 'POST' })).status, 409);
    assert.equal(b.row(id).status, 'accepted');
    assert.deepEqual(b.events(id), ['requested'], 'no withdrawn event');
  } finally { b.close(); }
});

test('two removals write one removal; a re-request that raced another request does not overwrite it', async () => {
  // Mutations checked: remove's UPDATE without `status = 'accepted'` → two removed events;
  // the re-request UPDATE without its expected-state clause → Pam's newer request is overwritten by Ida's.
  const b = book();
  try {
    const id = await b.accepted();
    b.hooks.push({ match: /^\s*UPDATE partner_relationships SET status = 'removed'/, before: () => {
      b.db.prepare("UPDATE partner_relationships SET status = 'removed' WHERE id = ?").run(id);
    } });
    assert.equal((await b.pam(`/relationships/${id}/remove`, { method: 'POST' })).status, 409);
    assert.deepEqual(b.events(id), ['requested', 'accepted'], 'the removal that lost writes no event');

    b.hooks.push({ match: /^\s*UPDATE partner_relationships\s+SET relationship_type = \?, strength_score/, before: () => {
      b.db.prepare("UPDATE partner_relationships SET status = 'pending', requested_by = ?, requested_at = '2026-11-09T01:00:00.000Z' WHERE id = ?").run(PAM, id);
    } });
    const again = await b.ida('/relationships', { method: 'POST', body: { partner_id: PAM, relationship_type: 'strategic_alliance' } });
    assert.deepEqual([again.status, again.body.error], [409, 'relationship_changed']);
    assert.deepEqual([b.row(id).requested_by, b.row(id).relationship_type], [PAM, 'co_investor'], 'Pam\'s request stands');
    assert.deepEqual(b.told(PAM).length, 1, 'Pam is not told of a request that was not written');
  } finally { b.close(); }
});

test('an edit to a relationship removed in between is 409, with no updated event', async () => {
  // Mutation checked: PATCH's UPDATE without `status = 'accepted'` → the removed row is edited and an event written.
  const b = book();
  try {
    const id = await b.accepted();
    b.hooks.push({ match: /^\s*UPDATE partner_relationships SET strength_score/, before: () => {
      b.db.prepare("UPDATE partner_relationships SET status = 'removed' WHERE id = ?").run(id);
    } });
    assert.equal((await b.ida(`/relationships/${id}`, { method: 'PATCH', body: { strength_score: 99 } })).status, 409);
    assert.notEqual(b.row(id).strength_score, 99);
    assert.deepEqual(b.events(id), ['requested', 'accepted']);
  } finally { b.close(); }
});

test('two parties saving private notes at once both keep theirs, whole, at the full limit', async () => {
  // Mutations checked: PATCH's UPDATE without `metadata IS ?` → Pam's concurrent note is lost;
  // the old `JSON.stringify(meta).slice(0, 4000)` → two 2,000-character notes corrupt the metadata and both read back null;
  // the old `.slice(0, 2000)` with the limit raised → a long note is cut instead of refused.
  const b = book();
  try {
    const id = await b.accepted();
    const idaNote = `“Ida’s” diligence — ${'é"\\'.repeat(700)}`.slice(0, 2000);
    const pamNote = `Pam's read: ${'x'.repeat(1988)}`;
    assert.equal(idaNote.length, 2000);
    assert.equal(pamNote.length, 2000);
    b.hooks.push({ match: /^\s*UPDATE partner_relationships SET metadata = \?/, before: () => {
      const meta = JSON.parse(b.row(id).metadata || '{}');
      meta.private_notes = { ...(meta.private_notes || {}), [PAM]: pamNote };
      b.db.prepare('UPDATE partner_relationships SET metadata = ? WHERE id = ?').run(JSON.stringify(meta), id);
    } });
    const saved = await b.ida(`/relationships/${id}`, { method: 'PATCH', body: { private_note: idaNote } });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.my_private_note, idaNote, 'the confirmation is the stored note');
    assert.equal((await b.ida('/relationships')).body[0].my_private_note, idaNote);
    assert.equal((await b.pam('/relationships')).body[0].my_private_note, pamNote, 'the other party\'s concurrent note survived');
    assert.deepEqual(b.events(id), ['requested', 'accepted', 'updated'], 'one updated event for one write');

    // Over the limit: refused, and nothing changes.
    const long = await b.pam(`/relationships/${id}`, { method: 'PATCH', body: { private_note: 'y'.repeat(2001) } });
    assert.deepEqual([long.status, long.body.error], [400, 'private_note_too_long']);
    assert.equal((await b.pam('/relationships')).body[0].my_private_note, pamNote);
    assert.equal((await b.pam(`/relationships/${id}`, { method: 'PATCH', body: { private_note: 42 } })).body.error, 'private_note_invalid');

    // A shared-metadata edit and a strength edit leave both notes as they were.
    assert.equal((await b.pam(`/relationships/${id}`, { method: 'PATCH', body: { metadata: { stage: 'seed', private_notes: { [IDA]: '' }, created_by: PAM } } })).status, 200);
    assert.equal((await b.ida(`/relationships/${id}`, { method: 'PATCH', body: { strength_score: 80 } })).status, 200);
    const meta = JSON.parse(b.row(id).metadata);
    assert.equal(meta.stage, 'seed');
    assert.equal(meta.created_by, IDA, 'the creator is not a party\'s to rewrite');
    assert.deepEqual(meta.private_notes, { [IDA]: idaNote, [PAM]: pamNote });
    assert.equal((await b.pam(`/relationships/${id}`, { method: 'PATCH', body: { metadata: { blob: 'z'.repeat(4001) } } })).body.error, 'metadata_too_large');

    // Clearing is the writer's own.
    await b.ida(`/relationships/${id}`, { method: 'PATCH', body: { private_note: null } });
    assert.equal((await b.ida('/relationships')).body[0].my_private_note, null);
    assert.equal((await b.pam('/relationships')).body[0].my_private_note, pamNote);
  } finally { b.close(); }
});

test('each party reads only their own note: in the book, on a re-request, and never by a non-party', async () => {
  // Mutations checked: POST returning the raw row's metadata → a re-request hands Ida Pam's note;
  // the re-request rewriting metadata without the old notes → both notes are blank after re-acceptance.
  const b = book();
  try {
    const id = await b.accepted();
    await b.ida(`/relationships/${id}`, { method: 'PATCH', body: { private_note: 'Ida only' } });
    await b.pam(`/relationships/${id}`, { method: 'PATCH', body: { private_note: 'Pam only' } });
    const ida = (await b.ida('/relationships')).text;
    assert.ok(ida.includes('Ida only') && !ida.includes('Pam only'));
    assert.ok(!(await b.as(OLI, 'investor', '/relationships')).text.includes('only'));
    const admin = await b.as(ADMIN, 'admin', `/relationships/${id}`, { method: 'PATCH', body: { private_note: 'admin note' } });
    assert.deepEqual([admin.status, admin.body.error], [403, 'private_note_party_only']);
    assert.ok(!b.row(id).metadata.includes('admin note'));

    await b.pam(`/relationships/${id}/remove`, { method: 'POST' });
    const again = await b.ida('/relationships', { method: 'POST', body: { partner_id: PAM, relationship_type: 'co_investor' } });
    assert.equal(again.status, 201);
    assert.ok(!again.text.includes('Pam only'), 'a re-request does not hand back the other party\'s note');
    assert.equal(again.body.my_private_note, 'Ida only');
    assert.equal(again.body.metadata.private_notes, undefined);
    await b.pam(`/relationships/${id}/respond`, { method: 'POST', body: { decision: 'accept' } });
    assert.equal((await b.ida('/relationships')).body[0].my_private_note, 'Ida only', 'kept whole through the re-request');
    assert.equal((await b.pam('/relationships')).body[0].my_private_note, 'Pam only');
  } finally { b.close(); }
});

// ── 3: introduction delivery ─────────────────────────────────────────────────

// 2 founder of venture 1 (shares Ada, is asked), 4 its co-founder (asks).
function desk() {
  const db = migratedDatabase();
  const u = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?)');
  for (const [id, fid] of [[2, 100], [4, null]] as const) u.run(id, 'founder', fid, `Synthetic member ${id}`, `synthetic-${id}@example.invalid`, 'studio');
  db.exec("INSERT INTO projects(id,name,founder_id) VALUES (1,'Synthetic venture',100)");
  db.exec("INSERT INTO project_members(project_id,user_id,role,status) VALUES (1,4,'cofounder','accepted')");
  db.prepare('INSERT INTO network_connections(id,user_id,name,email,company,source,linkedin_url) VALUES (?,?,?,?,?,?,?)')
    .run(21, 2, 'Synthetic Ada', 'ada@example.invalid', 'Acme', 'linkedin_csv', 'https://www.linkedin.com/in/synthetic-ada-4604');
  db.prepare("INSERT INTO contact_sources(owner_user_id,contact_table,contact_id,source,created_row) VALUES (2,'network_connections',21,'linkedin_csv',1)").run();
  const hooks: Hook[] = [];
  const env: any = {
    DB: hooked(d1Over(db), hooks), JWT_SECRET, ENVIRONMENT: 'development', KEK_PII: 'synthetic-kek-d4604-'.repeat(3),
    MAIL_MICROSOFT_CLIENT_ID: 'ms-client', MAIL_MICROSOFT_CLIENT_SECRET: 'ms-secret',
  };
  const app = new Hono<any>().route('/api/relationships', relationships).route('/api/mail', mailAccounts);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const provider = { sends: 0, answer: 202 };
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    const json = (status: number, j: any) => new Response(JSON.stringify(j), { status, headers: { 'content-type': 'application/json' } });
    if (url.includes('/oauth2/v2.0/token')) return json(200, { access_token: 'synthetic-access', scope: 'Mail.Send offline_access' });
    if (url === 'https://graph.microsoft.com/v1.0/me/sendMail') { provider.sends += 1; return new Response(null, { status: provider.answer }); }
    throw new Error(`no network in this test: ${url}`);
  }) as any;
  const call = async (who: number, method: string, path: string, json?: unknown) => {
    const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
    const res = await app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: json === undefined ? undefined : JSON.stringify(json) }, env);
    const text = await res.text();
    let body: any; try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body, text };
  };
  const accepted = async () => {
    await call(2, 'PUT', '/api/relationships/sharing', { share: true });
    const r = await call(4, 'POST', '/api/relationships/intro-request', { teammate: 2, ref: 21, note: 'Synthetic reason.' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const uid = r.body.request.uid as string;
    assert.equal((await call(2, 'POST', `/api/relationships/intro-requests/${uid}/decide`, { decision: 'accepted' })).status, 200);
    const acct = await saveAccount(env, { id: 2, role: 'founder' } as any, {
      provider: 'outlook', address: 'introducer-2@example.invalid', display_name: null, scopes: 'Mail.Send offline_access', can_read: false,
      creds: { kind: 'oauth', refresh_token: 'synthetic-refresh-d4604' },
    });
    return { uid, account: acct.uid as string };
  };
  let n = 0;
  const send = async (account: string, intro: string, key = `synthetic-op-key-${String(++n).padStart(4, '0')}`) => {
    const nonce = (await call(2, 'POST', '/api/mail/send/confirm', { account_uid: account })).body.nonce;
    return call(2, 'POST', '/api/mail/send', { account_uid: account, to: 'ada@example.invalid', subject: 'Introducing a teammate', body: 'Ada, meet a teammate.', nonce, intro_uid: intro, operation_key: key });
  };
  const received = async () => (await call(2, 'GET', '/api/relationships/intro-requests')).body.received[0];
  const made = () => (db.prepare("SELECT COUNT(*) AS n FROM relationship_interactions WHERE kind = 'intro_made'").get() as any).n;
  const madeNotices = () => (db.prepare("SELECT COUNT(*) AS n FROM notifications_inbox WHERE type = 'relationship_intro_answered' AND title = 'Your introduction was made'").get() as any).n;
  return { db, hooks, provider, call, accepted, send, received, made, madeNotices, close: () => { globalThis.fetch = real; db.close(); } };
}

test('an unconfirmed intro cannot be sent again from a new composition; the teammate\'s word settles it without a resend', async () => {
  // Mutations checked: claimIntroDelivery skipped in /send → the second composition reaches the provider (two sends);
  // the resolve route not reconciling the intro → "It arrived" leaves the request accepted.
  const d = desk();
  try {
    const { uid, account } = await d.accepted();
    d.provider.answer = 503;
    const first = await d.send(account, uid);
    assert.deepEqual([first.status, first.body.operation.state], [202, 'uncertain']);
    d.provider.answer = 202;
    const second = await d.send(account, uid);
    assert.deepEqual([second.status, second.body.error], [409, 'intro_delivery_unconfirmed']);
    assert.equal(d.provider.sends, 1, 'the second composition never reached the provider');
    const view = await d.received();
    assert.deepEqual([view.status, view.delivery], ['accepted', { state: 'unconfirmed', operation_uid: first.body.operation.uid }]);
    const asker = (await d.call(4, 'GET', '/api/relationships/intro-requests')).body.sent[0];
    assert.equal(asker.delivery, null, 'the asker never reads the introducer\'s mailbox');

    const said = await d.call(2, 'POST', `/api/mail/send/operations/${first.body.operation.uid}/resolve`, { outcome: 'arrived' });
    assert.equal(said.status, 200);
    assert.deepEqual(said.body.intro, { uid, status: 'made' });
    const after = await d.received();
    assert.deepEqual([after.status, after.delivery, after.mail_sent_uid], ['made', null, first.body.operation.uid]);
    assert.deepEqual([d.made(), d.madeNotices(), d.provider.sends], [1, 1, 1]);
    assert.equal((await d.send(account, uid)).body.error, 'intro_already_made');
  } finally { d.close(); }
});

test('an intro the mail server refused, or that the teammate says did not arrive, can be written again', async () => {
  // Mutation checked: the claim's release clause removed → after a refusal the intro is stuck as unconfirmed.
  const d = desk();
  try {
    const { uid, account } = await d.accepted();
    d.provider.answer = 503;
    const lost = await d.send(account, uid);
    await d.call(2, 'POST', `/api/mail/send/operations/${lost.body.operation.uid}/resolve`, { outcome: 'not_arrived' });
    assert.equal((await d.received()).delivery.state, 'not_sent');
    d.provider.answer = 400;
    const refused = await d.send(account, uid);
    assert.notEqual(refused.status, 201);
    assert.equal((await d.received()).delivery.state, 'not_sent');
    d.provider.answer = 202;
    const ok = await d.send(account, uid);
    assert.deepEqual([ok.status, ok.body.intro], [201, { uid, status: 'made' }]);
    assert.deepEqual([d.made(), d.provider.sends], [1, 3]);
  } finally { d.close(); }
});

test('a delivered intro whose record failed is reconciled to made without sending again', async () => {
  // Mutation checked: markMadeOnSend without the accepted-operation proof → the reconcile is refused while the sent log is missing.
  const d = desk();
  try {
    const { uid, account } = await d.accepted();
    // The provider accepts; the sent-log write and the introduction record both fail on this request.
    d.hooks.push({ match: /^\s*INSERT INTO mail_sent/, fail: true });
    d.hooks.push({ match: /UPDATE relationship_interactions SET status = 'made'/, fail: true });
    const sent = await d.send(account, uid);
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    assert.deepEqual(sent.body.intro, { uid, status: 'accepted', recorded: false }, 'delivered, record still to reconcile');
    assert.equal(d.provider.sends, 1);
    assert.deepEqual((await d.received()).delivery, { state: 'record_pending', operation_uid: sent.body.operation.uid });

    // The desk's recovery: reconcile. Nothing is sent; the request is made from the accepted operation.
    const rec = await d.call(2, 'POST', `/api/relationships/intro-requests/${uid}/delivery/reconcile`);
    assert.deepEqual([rec.status, rec.body.request.status, rec.body.request.delivery], [200, 'made', null]);
    const again = await d.call(2, 'POST', `/api/relationships/intro-requests/${uid}/delivery/reconcile`);
    assert.equal(again.body.request.status, 'made');
    assert.deepEqual([d.made(), d.madeNotices(), d.provider.sends], [1, 1, 1], 'one event, one notice, one email');
    assert.equal((await d.call(4, 'POST', `/api/relationships/intro-requests/${uid}/delivery/reconcile`)).status, 404, 'the asker cannot reconcile it');
  } finally { d.close(); }
});

test('a new composition of an intro already delivered reconciles it instead of sending; a replay recovers it as made', async () => {
  // Mutations checked: the claim not reconciling an accepted holder → the request stays accepted;
  // markMadeOnSend writing its event before checking `changes` → a second intro_made event on the replay;
  // the already-made refusal returned before the replay lookup → the replay is 409, not recovered.
  const d = desk();
  try {
    const { uid, account } = await d.accepted();
    d.hooks.push({ match: /UPDATE relationship_interactions SET status = 'made'/, fail: true });
    const sent = await d.send(account, uid, 'synthetic-op-key-replay');
    assert.equal(sent.body.intro.recorded, false);
    const fresh = await d.send(account, uid);
    assert.deepEqual([fresh.status, fresh.body.error], [409, 'intro_already_sent']);
    assert.equal((await d.received()).status, 'made', 'reconciled from the delivered operation');
    const replay = await d.send(account, uid, 'synthetic-op-key-replay');
    assert.deepEqual([replay.status, replay.body.recovered, replay.body.intro], [200, true, { uid, status: 'made' }]);
    assert.deepEqual([d.made(), d.provider.sends], [1, 1]);
  } finally { d.close(); }
});

test('the delivery state reads the attempt\'s operation: sending, unconfirmed once stale, record pending, not sent', () => {
  const now = Date.parse('2026-11-09T12:00:00Z');
  const op = (state: any, updated_at = '2026-11-09 11:59:30') => ({ uid: 'a'.repeat(32), state, updated_at });
  assert.equal(deliveryState('accepted', null, false, now), null, 'no attempt recorded');
  assert.equal(deliveryState('made', op('accepted'), true, now), null, 'made says it all');
  assert.equal(deliveryState('accepted', op('pending'), true, now), 'sending');
  assert.equal(deliveryState('accepted', op('pending', '2026-11-09 11:50:00'), true, now), 'unconfirmed');
  assert.equal(deliveryState('accepted', op('uncertain'), true, now), 'unconfirmed');
  assert.equal(deliveryState('accepted', op('accepted'), true, now), 'record_pending');
  assert.equal(deliveryState('accepted', op('refused'), true, now), 'not_sent');
  assert.equal(deliveryState('accepted', null, true, now), 'not_sent', 'an attempt never admitted');
});
