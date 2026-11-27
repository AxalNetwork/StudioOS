/**
 * D4672 (#4672) — Offers · Proof: an approval is bound to the exact revision it
 * was about, only the client named can give it, and a decline or withdrawal
 * stays. End to end over the real routes and the real migrations, against an
 * in-memory D1. Plus: no credential carried in a path reaches a telemetry store.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';

import partnerOffers from '../src/routes/partner_offers.ts';
import { proofConsentMailer, proofConsentState } from '../src/services/partnerProofConsent.ts';
import { redactPath } from '../src/util/pathRedaction.ts';
import { observabilityMiddleware } from '../src/middleware/observability.ts';

const mailed: { to: string; code: string }[] = [];
proofConsentMailer.send = async (_env: any, to: string, _firm: string, code: string) => { mailed.push({ to, code }); return true; };

const SQL = resolve(dirname(fileURLToPath(import.meta.url)), '../sql/migrations');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const OURS = { user: 90, role: 'partner' };
const THEIRS = { user: 91, role: 'partner' };
const CLIENT = 'dana@client.example';

function makeD1(db: InstanceType<typeof DatabaseSync>) {
  const coerce = (a: any[]) => a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
  };
}

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, partner_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT);
    CREATE TABLE partners (id INTEGER PRIMARY KEY, uid TEXT, name TEXT NOT NULL, company TEXT, email TEXT, status TEXT DEFAULT 'active');
    CREATE TABLE founders (id INTEGER PRIMARY KEY, uid TEXT, name TEXT NOT NULL, email TEXT);
    CREATE TABLE founder_needs (id INTEGER PRIMARY KEY, uid TEXT, project_id INTEGER, founder_id INTEGER,
      category TEXT, title TEXT, description TEXT, status TEXT DEFAULT 'open');
    CREATE TABLE engagements (id INTEGER PRIMARY KEY, uid TEXT, need_id INTEGER, quote_id INTEGER, partner_id INTEGER,
      founder_id INTEGER, project_id INTEGER, price REAL, status TEXT DEFAULT 'accepted', cancelled_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
  `);
  for (const m of ['209_partner_offers_stores', '202611092206_partner_proof_consent_integrity']) {
    db.exec(readFileSync(`${SQL}/${m}.sql`, 'utf8'));
  }
  const u = db.prepare('INSERT INTO users (id, role, partner_id, name, email) VALUES (?,?,?,?,?)');
  u.run(90, 'partner', 1, 'Ours', 'ours@firm.example');
  u.run(93, 'partner', 1, 'Colleague', 'colleague@firm.example');
  u.run(91, 'partner', 2, 'Theirs', 'theirs@other.example');
  db.prepare('INSERT INTO partners (id, uid, name, company, email) VALUES (1, ?, ?, ?, ?)').run('p-1', 'Ours', 'Ours Studio', 'hello@firm.example');
  db.prepare('INSERT INTO partners (id, uid, name, email) VALUES (2, ?, ?, ?)').run('p-2', 'Theirs', 'hello@other.example');
  db.prepare('INSERT INTO engagements (id, uid, need_id, quote_id, partner_id, founder_id, project_id, price) VALUES (701, ?, 1, 1, 1, 5, 9, 1)').run('e-701');
  db.prepare('INSERT INTO engagements (id, uid, need_id, quote_id, partner_id, founder_id, project_id, price) VALUES (703, ?, 1, 2, 1, 5, 9, 1)').run('e-703');
  return db;
}

const jwt = (who: { user: number; role: string }) => new SignJWT({ user_id: who.user, role: who.role })
  .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));

async function call(e: any, method: string, path: string, who: { user: number; role: string } | null, body?: any) {
  const headers: Record<string, string> = {};
  if (who) headers.Authorization = `Bearer ${await jwt(who)}`;
  const init: RequestInit = { method, headers };
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; (init as any).body = JSON.stringify(body); }
  const res = await partnerOffers.request(path, init, e);
  return { status: res.status, body: await res.json().catch(() => null) };
}

function setup() {
  const db = freshDb();
  const e = { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) };
  return { db, e };
}

async function itemAndAsk(e: any, item: any = { title: 'Cut settlement time by half', outcome_note: '48h → 22h', engagement_id: 701 }) {
  const made = await call(e, 'POST', '/proof', OURS, item);
  const ask = await call(e, 'POST', `/proof/${made.body.id}/consent-request`, OURS, { consenter_name: 'Dana', consenter_email: CLIENT });
  assert.equal(ask.status, 200, JSON.stringify(ask.body));
  return { id: made.body.id as number, link: ask.body.invite_token as string, consentId: ask.body.id as number };
}

/** A fresh code for the link, as the client would request it; the code itself, or the refusal. */
async function code(e: any, link: string) {
  const r = await call(e, 'POST', `/proof-consents/${link}/code`, null, {});
  return r.status === 200 ? { ok: true as const, code: mailed[mailed.length - 1].code } : { ok: false as const, status: r.status, body: r.body };
}

async function confirm(e: any, link: string, extra: any = {}) {
  const claim = (await call(e, 'GET', `/proof-consents/${link}/claim`, null)).body;
  const k = await code(e, link);
  if (!k.ok) return { status: k.status, body: k.body };
  return call(e, 'POST', `/proof-consents/${link}/respond`, null, { consent_text: 'I confirm this and they may show it.', claim_sha256: claim.claim_sha256, code: k.code, ...extra });
}

async function decline(e: any, link: string) {
  const k = await code(e, link);
  if (!k.ok) return { status: k.status, body: k.body };
  return call(e, 'POST', `/proof-consents/${link}/respond`, null, { consent_given: false, code: k.code });
}

const proof = async (e: any) => (await call(e, 'GET', '/proof', OURS)).body.items[0];

test('request → approve → edit: the approval stays with revision 1, revision 2 is self-stated until asked again', async () => {
  const { db, e } = setup();
  const { id, link } = await itemAndAsk(e);
  assert.equal((await confirm(e, link)).status, 200);
  let p = await proof(e);
  assert.equal(p.is_published, true);
  assert.equal(p.revision, 1);

  // Saving the same words is not a new revision, and changes nothing.
  await call(e, 'PATCH', `/proof/${id}`, OURS, { title: 'Cut settlement time by half' });
  p = await proof(e);
  assert.equal(p.revision, 1);
  assert.equal(p.is_published, true);

  for (const change of [{ outcome_note: '48h → 2h' }, { title: 'Cut settlement time by 90%' }, { detail: 'New paragraph' }, { engagement_id: 703 }, { kind: 'outcome' }]) {
    const before = (await proof(e)).revision;
    const r = await call(e, 'PATCH', `/proof/${id}`, OURS, change);
    assert.equal(r.status, 200);
    assert.equal(r.body.revision, before + 1, `${JSON.stringify(change)} did not move the revision`);
    assert.equal(r.body.is_published, false, `${JSON.stringify(change)} kept an approval of different words`);
  }
  p = await proof(e);
  assert.equal(p.consents[0].state, 'superseded');
  assert.equal(p.consents[0].revision, 1, 'the approval moved off the revision it was about');
  assert.ok(p.consents[0].consent_given_at, 'the old approval was erased rather than kept with its revision');
  const kinds = db.prepare('SELECT kind, revision FROM partner_proof_consent_events ORDER BY id').all() as any[];
  assert.deepEqual(kinds.map((k) => k.kind), ['asked', 'confirmed', 'superseded']);
  assert.equal(kinds[2].revision, 1);

  // Asking again pins the new revision, and that answer publishes it.
  const again = await call(e, 'POST', `/proof/${id}/consent-request`, OURS, { consenter_name: 'Dana', consenter_email: CLIENT });
  assert.equal(again.body.revision, p.revision);
  assert.equal((await confirm(e, again.body.invite_token)).status, 200);
  assert.equal((await proof(e)).is_published, true);
});

test('stale revision: a request asked about the old wording cannot confirm the new one', async () => {
  const { db, e } = setup();
  const { id, link } = await itemAndAsk(e);
  const shown = (await call(e, 'GET', `/proof-consents/${link}/claim`, null)).body;
  assert.equal(shown.claim.outcome_note, '48h → 22h');
  const k = await code(e, link);
  assert.ok(k.ok);
  // The firm edits after the client opened the link and before they answer.
  await call(e, 'PATCH', `/proof/${id}`, OURS, { outcome_note: '48h → 2h' });
  const r = await call(e, 'POST', `/proof-consents/${link}/respond`, null, { consent_text: 'Yes.', claim_sha256: shown.claim_sha256, code: (k as any).code });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'claim_changed');
  assert.equal(Number((db.prepare('SELECT consent_given FROM partner_proof_consents').get() as any).consent_given), 0);
  assert.equal((await proof(e)).is_published, false);
  // The link now says so, and sends no further codes.
  const after = (await call(e, 'GET', `/proof-consents/${link}/claim`, null)).body;
  assert.equal(after.claim_changed, true);
  assert.equal(after.state, 'superseded');
  assert.equal((await code(e, link)).ok, false);
});

test('an answer about a claim other than the one this request pinned is refused', async () => {
  const { e } = setup();
  const { link } = await itemAndAsk(e);
  const r = await confirm(e, link, { claim_sha256: 'f'.repeat(64) });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'claim_changed');
  const none = await confirm(e, link, { claim_sha256: undefined });
  assert.equal(none.status, 409, 'a confirmation that names no claim was recorded');
});

test('request → decline: the request is closed and no later code reopens it', async () => {
  const { db, e } = setup();
  const { link } = await itemAndAsk(e);
  assert.equal((await decline(e, link)).status, 200);
  const p = await proof(e);
  assert.equal(p.consents[0].state, 'declined');
  assert.equal(p.consents[0].invite_token, null, 'a closed request still hands out its link');
  const again = await code(e, link);
  assert.equal(again.ok, false);
  assert.equal((again as any).body.error, 'consent_closed');
  assert.equal((await confirm(e, link)).status, 409);
  assert.equal((await proof(e)).is_published, false);
  assert.ok((db.prepare('SELECT closed_at FROM partner_proof_consents').get() as any).closed_at);
});

test('request → approve → withdraw → replay: the withdrawal stands', async () => {
  const { db, e } = setup();
  const { link } = await itemAndAsk(e);
  // Keep a code from before the withdrawal: the replay below uses it.
  const early = await code(e, link);
  assert.ok(early.ok);
  assert.equal((await confirm(e, link)).status, 200);
  assert.equal((await proof(e)).is_published, true);
  // The client withdraws with a fresh code.
  assert.equal((await decline(e, link)).status, 200);
  let p = await proof(e);
  assert.equal(p.consents[0].state, 'withdrawn');
  assert.equal(p.is_published, false);
  // Replay: the earlier code, a fresh code, and the firm's own route. None revives it.
  const replay = await call(e, 'POST', `/proof-consents/${link}/respond`, null, { consent_text: 'Yes again.', code: (early as any).code });
  assert.equal(replay.status, 401);
  assert.equal((await code(e, link)).ok, false);
  const forced = await call(e, 'POST', `/proof-consents/${link}/respond`, null, { consent_text: 'Yes again.', code: '000000' });
  assert.ok(forced.status >= 400);
  p = await proof(e);
  assert.equal(p.consents[0].state, 'withdrawn');
  assert.equal(p.is_published, false);
  const kinds = (db.prepare('SELECT kind FROM partner_proof_consent_events ORDER BY id').all() as any[]).map((k) => k.kind);
  assert.deepEqual(kinds, ['asked', 'confirmed', 'withdrawn']);
});

test('a withdrawal the firm records closes the request too', async () => {
  const { e } = setup();
  const { id, link, consentId } = await itemAndAsk(e);
  const early = await call(e, 'POST', `/proof/${id}/consents/${consentId}/withdraw`, OURS);
  assert.equal(early.status, 409, 'an unanswered request was "withdrawn" by the firm and shown as the client declining');
  await confirm(e, link);
  assert.equal((await call(e, 'POST', `/proof/${id}/consents/${consentId}/withdraw`, OURS)).status, 200);
  assert.equal((await code(e, link)).ok, false);
  assert.equal((await call(e, 'POST', `/proof/${id}/consents/${consentId}/withdraw`, OURS)).status, 409);
  assert.equal((await proof(e)).consents[0].state, 'withdrawn');
});

test('codes are single-use, short-lived and limited in tries', async () => {
  const { db, e } = setup();
  const { link } = await itemAndAsk(e);
  const claim = (await call(e, 'GET', `/proof-consents/${link}/claim`, null)).body;
  const k = (await code(e, link)) as any;
  // Expired.
  db.prepare("UPDATE partner_proof_consent_codes SET expires_at = '2000-01-01T00:00:00Z'").run();
  let r = await call(e, 'POST', `/proof-consents/${link}/respond`, null, { consent_text: 'Yes.', claim_sha256: claim.claim_sha256, code: k.code });
  assert.equal(r.status, 401);
  // Five wrong tries spend a code.
  const k2 = (await code(e, link)) as any;
  const wrong = k2.code === '111111' ? '222222' : '111111';
  for (let i = 0; i < 5; i += 1) await call(e, 'POST', `/proof-consents/${link}/respond`, null, { consent_text: 'Yes.', claim_sha256: claim.claim_sha256, code: wrong });
  r = await call(e, 'POST', `/proof-consents/${link}/respond`, null, { consent_text: 'Yes.', claim_sha256: claim.claim_sha256, code: k2.code });
  assert.equal(r.status, 401, 'a code survived five wrong tries');
  // Used once.
  const k3 = (await code(e, link)) as any;
  r = await call(e, 'POST', `/proof-consents/${link}/respond`, null, { consent_text: 'Yes.', claim_sha256: claim.claim_sha256, code: k3.code });
  assert.equal(r.status, 200);
  r = await call(e, 'POST', `/proof-consents/${link}/respond`, null, { consent_given: false, code: k3.code });
  assert.equal(r.status, 401, 'a spent code answered twice');
  // Codes are stored hashed.
  for (const row of db.prepare('SELECT code_hash FROM partner_proof_consent_codes').all() as any[]) {
    assert.ok(![k.code, k2.code, k3.code].includes(row.code_hash));
  }
});

test('a link expires, and an expired request answers nothing', async () => {
  const { db, e } = setup();
  const { link } = await itemAndAsk(e);
  db.prepare("UPDATE partner_proof_consents SET expires_at = '2000-01-01T00:00:00Z'").run();
  assert.equal((await proof(e)).consents[0].state, 'expired');
  const k = await code(e, link);
  assert.equal((k as any).body.error, 'request_expired');
});

test('the client confirms, never the firm: its own addresses cannot be named', async () => {
  const { e } = setup();
  const made = await call(e, 'POST', '/proof', OURS, { title: 'A result' });
  for (const addr of ['ours@firm.example', 'OURS@firm.example', 'colleague@firm.example', 'hello@firm.example']) {
    const r = await call(e, 'POST', `/proof/${made.body.id}/consent-request`, OURS, { consenter_name: 'Me', consenter_email: addr });
    assert.equal(r.status, 422, `${addr} was accepted as the client`);
  }
  const none = await call(e, 'POST', `/proof/${made.body.id}/consent-request`, OURS, { consenter_name: 'Dana' });
  assert.equal(none.status, 400);
  assert.equal(none.body.error, 'consenter_email_required');
});

test('the claim page shows the pinned claim, masks the address, and leaks nothing else', async () => {
  const { e } = setup();
  const { link } = await itemAndAsk(e);
  const r = await call(e, 'GET', `/proof-consents/${link}/claim`, null);
  assert.equal(r.status, 200);
  assert.equal(r.body.firm_name, 'Ours Studio');
  assert.equal(r.body.claim.title, 'Cut settlement time by half');
  assert.equal(r.body.revision, 1);
  assert.equal(r.body.email_hint, 'd***@client.example');
  assert.ok(!JSON.stringify(r.body).includes(CLIENT), 'the address was echoed in full');
  assert.equal((await call(e, 'GET', '/proof-consents/not-a-link/claim', null)).status, 404);
});

test('a confirmation recorded before D4672 is kept and shown, and no longer publishes', async () => {
  const { db, e } = setup();
  const made = await call(e, 'POST', '/proof', OURS, { title: 'Old result' });
  db.prepare(`INSERT INTO partner_proof_consents (uid, proof_item_id, consenter_name, request_token, consent_given, consent_given_at, consent_text)
              VALUES ('c-old', ?, 'Dana', 'legacy-link', 1, '2026-09-01T00:00:00Z', 'Yes')`).run(made.body.id);
  const p = await proof(e);
  assert.equal(p.consents[0].state, 'superseded');
  assert.equal(p.consents[0].consent_given_at, '2026-09-01T00:00:00Z');
  assert.equal(p.is_published, false);
  assert.equal((await call(e, 'GET', '/proof-consents/legacy-link/claim', null)).body.claim, null, 'today’s wording was shown as what was agreed');
});

test('the answer history is append-only', async () => {
  const { db, e } = setup();
  await itemAndAsk(e);
  assert.throws(() => db.prepare("UPDATE partner_proof_consent_events SET kind = 'confirmed'").run(), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM partner_proof_consent_events').run(), /append-only/);
});

test('ownership holds: another firm reads, edits, asks about and withdraws nothing of ours', async () => {
  const { e } = setup();
  const { id, consentId } = await itemAndAsk(e);
  assert.equal((await call(e, 'PATCH', `/proof/${id}`, THEIRS, { title: 'x' })).status, 404);
  assert.equal((await call(e, 'POST', `/proof/${id}/consent-request`, THEIRS, { consenter_name: 'x', consenter_email: 'x@y.example' })).status, 404);
  assert.equal((await call(e, 'POST', `/proof/${id}/consents/${consentId}/withdraw`, THEIRS)).status, 404);
  assert.equal((await call(e, 'GET', '/proof', THEIRS)).body.items.length, 0);
});

test('the state rule, case by case', () => {
  const sha = 'a'.repeat(64);
  const base = { consent_given: 0, consent_given_at: null, withdrawn_at: null, claim_sha256: sha, expires_at: null };
  assert.equal(proofConsentState(base, sha), 'requested');
  assert.equal(proofConsentState({ ...base, consent_given: 1, consent_given_at: 'x' }, sha), 'confirmed');
  assert.equal(proofConsentState({ ...base, consent_given: 1, consent_given_at: 'x' }, 'b'.repeat(64)), 'superseded');
  assert.equal(proofConsentState({ ...base, claim_sha256: null, consent_given: 1 }, sha), 'superseded');
  assert.equal(proofConsentState({ ...base, withdrawn_at: 'x' }, sha), 'declined');
  assert.equal(proofConsentState({ ...base, withdrawn_at: 'x', consent_given_at: 'y' }, sha), 'withdrawn');
  assert.equal(proofConsentState({ ...base, expires_at: '2000-01-01T00:00:00Z' }, sha), 'expired');
  assert.equal(proofConsentState({ ...base, consent_given: 1, consent_given_at: 'x', expires_at: '2000-01-01T00:00:00Z' }, sha), 'confirmed', 'an answered request expired');
});

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

test('redactPath replaces credential parameters by the route, and opaque segments when no route matched', () => {
  const link = 'a3f9c2e1b7d84f60a2c9e1f3b5d7a9c1';
  assert.equal(redactPath(`/api/partner/offers/proof-consents/${link}/respond`, '/api/partner/offers/proof-consents/:token/respond'),
    '/api/partner/offers/proof-consents/:token/respond');
  assert.equal(redactPath(`/api/advisors/proof-consents/${link}/claim`, '/api/advisors/proof-consents/:token/claim'), '/api/advisors/proof-consents/:token/claim');
  assert.equal(redactPath('/api/partner/offers/proof/12', '/api/partner/offers/proof/:id'), '/api/partner/offers/proof/12', 'a non-credential id was redacted');
  assert.equal(redactPath(`/api/x/sign/${link}/document`, '/api/x/sign/:inviteToken/document'), '/api/x/sign/:inviteToken/document');
  assert.equal(redactPath(`/api/partner/offers/proof-consents/${link}/respondx`, '/*'), '/api/partner/offers/proof-consents/:redacted/respondx');
  assert.equal(redactPath(`/api/partner/offers/proof-consents/${link}/respond`), '/api/partner/offers/proof-consents/:redacted/respond');
  assert.equal(redactPath('/api/partner/offers/proof'), '/api/partner/offers/proof');
});

test('no telemetry store receives a consent link, matched or not', async () => {
  const writes: any[][] = [];
  const DB = {
    prepare(sql: string) {
      const api: any = { bind: (...b: any[]) => { writes.push([sql, ...b]); return api; }, run: async () => ({}), first: async () => null, all: async () => ({ results: [] }) };
      return api;
    },
  };
  const points: any[] = [];
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB, ANALYTICS: { writeDataPoint: (p: any) => points.push(p) } };
  const app = new Hono();
  app.use('*', observabilityMiddleware());
  const sub = new Hono();
  sub.post('/proof-consents/:token/respond', (c) => c.json({ detail: 'nope' }, 401));
  sub.get('/boom/:token', () => { throw new Error('boom'); });
  app.route('/api/partner/offers', sub);
  const link = 'a3f9c2e1b7d84f60a2c9e1f3b5d7a9c1';
  const pending: Promise<unknown>[] = [];
  const ctx: any = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {}, props: {} };
  await app.request(`/api/partner/offers/proof-consents/${link}/respond`, { method: 'POST' }, env, ctx);
  await app.request(`/api/partner/offers/proof-consents/${link}/nothing`, { method: 'POST' }, env, ctx);
  await app.request(`/api/partner/offers/boom/${link}`, {}, env, ctx).catch(() => null);
  await Promise.all(pending);
  assert.ok(writes.length > 0, 'nothing was recorded, so this test proves nothing');
  const everything = JSON.stringify({ writes, points });
  assert.ok(!everything.includes(link), 'a consent link reached a telemetry store');
  assert.ok(everything.includes('/proof-consents/:token/respond'), 'the route itself stopped being recorded');
});

test('a code fetched before the firm recorded a withdrawal answers nothing after it', async () => {
  const { db, e } = setup();
  const { id, link, consentId } = await itemAndAsk(e);
  await confirm(e, link);
  const held = (await code(e, link)) as any;
  assert.ok(held.ok);
  assert.equal((await call(e, 'POST', `/proof/${id}/consents/${consentId}/withdraw`, OURS)).status, 200);
  for (const body of [{ consent_given: false }, { consent_text: 'Yes again.', claim_sha256: 'x' }]) {
    const r = await call(e, 'POST', `/proof-consents/${link}/respond`, null, { ...body, code: held.code });
    assert.equal(r.status, 409, `a closed request accepted ${JSON.stringify(body)}`);
    assert.equal(r.body.error, 'consent_closed');
  }
  const kinds = (db.prepare('SELECT kind FROM partner_proof_consent_events ORDER BY id').all() as any[]).map((k) => k.kind);
  assert.deepEqual(kinds, ['asked', 'confirmed', 'withdrawn'], 'a second answer was written to a closed request');
});

test('codes are rate-limited per request', async () => {
  const { e } = setup();
  const { link } = await itemAndAsk(e);
  for (let i = 0; i < 5; i += 1) assert.equal((await code(e, link)).ok, true);
  const sixth = (await code(e, link)) as any;
  assert.equal(sixth.status, 429);
  assert.equal(sixth.body.error, 'code_rate_limited');
});
