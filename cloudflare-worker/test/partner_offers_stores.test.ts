/**
 * The partner Offers stores — migration 209 and the routes over them.
 *
 * THE ONE THAT MATTERS MOST IS THE CONSENT ASYMMETRY, and it is the reason
 * several of these tests exist at all: a firm can record that a client
 * WITHDREW, and can never record that one AGREED. Granting is the token
 * holder's alone. Every route is checked for that, including the ones that look
 * like they could not possibly grant consent, because the value of the whole
 * proof zone rests on it — a storefront that can confirm its own evidence has
 * no evidence in it.
 *
 * The rest each pin a decision that could have gone the other way:
 *
 *   * published is DERIVED from `consent_given = 1 AND withdrawn_at IS NULL`,
 *     both halves, so a withdrawal cannot be undone by forgetting one column;
 *   * a withdrawal is a STATE — the row stays and says so, because a request
 *     that vanished on refusal would let a firm re-ask until it got a yes;
 *   * `request_token` is returned exactly once and by no later read;
 *   * an engagement can be attributed to one surface, not two, and only to a
 *     surface belonging to the same firm;
 *   * a budget floor rejects a fractional and a negative amount, and a
 *     non-floor rule cannot smuggle one in;
 *   * another firm gets 404 on every read and write.
 *
 * ONE SCHEMA TRAP THESE ALSO CATCH. 209's consent table is NOT 204's: its
 * columns are `consenter_*`, not `attester_*`, and it has no `statement`
 * column. `advisors.ts`'s `consentDto` mapped over this table returns
 * `undefined` for every field and throws nothing — so the DTO assertions below
 * are load-bearing rather than decorative.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import partnerOffers from '../src/routes/partner_offers.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(HERE, '../sql');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const OURS_USER = 90;
const THEIRS_USER = 91;
const FOUNDER_USER = 92;
const OUR_ENGAGEMENT = 701;
const THEIR_ENGAGEMENT = 702;

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
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
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) {
      const out = [];
      for (const st of x || []) out.push(await st.run().catch(() => ({})));
      return out;
    },
  };
}

const migration = (name: string) => readFileSync(`${SQL}/migrations/${name}.sql`, 'utf8');

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, partner_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT
    );
    CREATE TABLE partners (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL, company TEXT, email TEXT UNIQUE NOT NULL,
      specialization TEXT, status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE founder_needs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      project_id INTEGER NOT NULL, founder_id INTEGER NOT NULL,
      category TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
      budget_min REAL, budget_max REAL, timeline TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE engagements (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      need_id INTEGER NOT NULL, quote_id INTEGER NOT NULL UNIQUE,
      partner_id INTEGER NOT NULL, founder_id INTEGER NOT NULL,
      project_id INTEGER NOT NULL, price REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'accepted',
      delivered_at TEXT, delivery_notes TEXT, cancelled_at TEXT, cancel_reason TEXT,
      invoice_id TEXT, invoiced_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.exec(migration('209_partner_offers_stores'));

  const u = db.prepare('INSERT INTO users (id, role, partner_id, name, email) VALUES (?,?,?,?,?)');
  u.run(OURS_USER, 'partner', 1, 'Ours', 'ours@example.com');
  u.run(THEIRS_USER, 'partner', 2, 'Theirs', 'theirs@example.com');
  u.run(FOUNDER_USER, 'founder', null, 'Fran', 'fran@example.com');

  const p = db.prepare('INSERT INTO partners (id, uid, name, email) VALUES (?,?,?,?)');
  p.run(1, 'p-1', 'Ours', 'ours@example.com');
  p.run(2, 'p-2', 'Theirs', 'theirs@example.com');

  const n = db.prepare(
    'INSERT INTO founder_needs (id, uid, project_id, founder_id, category, title, description) VALUES (?,?,?,?,?,?,?)');
  n.run(401, 'need-1', 9, FOUNDER_USER, 'engineering', 'Payments migration', 'Move off the old rails');
  n.run(402, 'need-2', 9, FOUNDER_USER, 'design', 'Brand refresh', 'New identity');

  const e = db.prepare(
    `INSERT INTO engagements (id, uid, need_id, quote_id, partner_id, founder_id, project_id, price)
     VALUES (?,?,?,?,?,?,?,?)`);
  e.run(OUR_ENGAGEMENT, 'e-ours', 401, 801, 1, FOUNDER_USER, 9, 42000);
  e.run(THEIR_ENGAGEMENT, 'e-theirs', 402, 802, 2, FOUNDER_USER, 9, 15000);

  return db;
}

function env(db: InstanceType<typeof DatabaseSync>) {
  return { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) };
}

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(
  e: any, method: string, path: string, who: { user: number; role: string } | null, body?: any,
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  // `who === null` is the UNAUTHENTICATED case, and it is not an oversight in a
  // test — the consent response route is reached by a client with no account.
  if (who) headers.Authorization = `Bearer ${await token(who.user, who.role)}`;
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    (init as any).body = JSON.stringify(body);
  }
  const res = await partnerOffers.request(path, init, e);
  return { status: res.status, body: await res.json().catch(() => null) };
}

const ours = { user: OURS_USER, role: 'partner' };
const theirs = { user: THEIRS_USER, role: 'partner' };
const fran = { user: FOUNDER_USER, role: 'founder' };

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

test('an unattributed engagement is counted as unattributed, never shared out', async () => {
  const e = env(freshDb());
  await call(e, 'POST', '/surfaces', ours, { name: 'Axal directory', kind: 'directory' });
  const r = (await call(e, 'GET', '/visibility', ours)).body;

  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].engagement_count, 0);
  assert.equal(r.engagement_total, 1);
  assert.equal(r.unattributed_count, 1);
  assert.match(r.unattributed_note, /name no surface/);
  // Spreading it proportionally would make the widest column the least true,
  // which is the failure the store was designed around.
  assert.equal(r.items[0].engagement_count, 0, 'the unattributed engagement was credited to a surface');
});

test('views and the lead ratio come back null WITH a reason, not as zero', async () => {
  const e = env(freshDb());
  await call(e, 'POST', '/surfaces', ours, { name: 'Referral: Acme' });
  const r = (await call(e, 'GET', '/visibility', ours)).body;
  assert.equal(r.items[0].views, null);
  assert.match(r.items[0].views_note, /invented rather than measured/i);
  assert.equal(r.lead_ratio, null);
  assert.match(r.lead_ratio_note, /absent denominator/i);
});

test('an engagement is attributed to exactly one surface', async () => {
  const db = freshDb();
  const e = env(db);
  const a = await call(e, 'POST', '/surfaces', ours, { name: 'Directory' });
  const b = await call(e, 'POST', '/surfaces', ours, { name: 'Referral' });

  await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/source`, ours, { surface_id: a.body.id });
  await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/source`, ours, { surface_id: b.body.id });

  // Two rows would double-count it in the one comparison the zone exists for.
  assert.equal(db.prepare('SELECT COUNT(*) c FROM engagement_sources').get<any>().c, 1);
  const r = (await call(e, 'GET', '/visibility', ours)).body;
  assert.equal(r.unattributed_count, 0);
  assert.equal(r.items.find((x: any) => x.id === b.body.id).engagement_count, 1);
  assert.equal(r.items.find((x: any) => x.id === a.body.id).engagement_count, 0);
});

test('an engagement cannot be attributed to another firm\'s surface', async () => {
  const e = env(freshDb());
  const theirSurface = await call(e, 'POST', '/surfaces', theirs, { name: 'Their listing' });
  // Without this check a firm could attribute its own work to a listing another
  // firm reads, corrupting that firm's table rather than its own.
  const r = await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/source`, ours, {
    surface_id: theirSurface.body.id,
  });
  assert.equal(r.status, 404);
  assert.match(r.body.detail, /surface not found/i);
});

test('a duplicate surface name is refused with a sentence, not a raw constraint', async () => {
  const e = env(freshDb());
  await call(e, 'POST', '/surfaces', ours, { name: 'Axal directory' });
  const again = await call(e, 'POST', '/surfaces', ours, { name: 'Axal directory' });
  assert.equal(again.status, 409);
  assert.match(again.body.detail, /already recorded/i);
  // But the same name under a DIFFERENT firm is fine — the index is on the pair.
  const other = await call(e, 'POST', '/surfaces', theirs, { name: 'Axal directory' });
  assert.equal(other.status, 200);
});

test('deleting a surface takes its attributions and leaves the engagement', async () => {
  const db = freshDb();
  const e = env(db);
  const s = await call(e, 'POST', '/surfaces', ours, { name: 'Directory' });
  await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/source`, ours, { surface_id: s.body.id });

  await call(e, 'DELETE', `/surfaces/${s.body.id}`, ours);
  // An orphaned attribution row would be counted by nothing and cleaned by
  // nothing — and would reattach to the next surface if ids were reused.
  assert.equal(db.prepare('SELECT COUNT(*) c FROM engagement_sources').get<any>().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM engagements').get<any>().c, 2);
  const r = (await call(e, 'GET', '/visibility', ours)).body;
  assert.equal(r.unattributed_count, 1);
});

test('retiring a surface keeps it and everything it produced', async () => {
  const e = env(freshDb());
  const s = await call(e, 'POST', '/surfaces', ours, { name: 'Old listing' });
  await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/source`, ours, { surface_id: s.body.id });
  await call(e, 'PATCH', `/surfaces/${s.body.id}`, ours, { is_active: false });

  const r = (await call(e, 'GET', '/visibility', ours)).body;
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].is_active, false);
  // A retired listing that once produced work is a true row, so its count
  // survives retirement — the softer move must not quietly lose history.
  assert.equal(r.items[0].engagement_count, 1);
});

// ---------------------------------------------------------------------------
// Proof — the consent asymmetry
// ---------------------------------------------------------------------------

test('a proof item is self-stated until a live consent exists', async () => {
  const e = env(freshDb());
  const item = await call(e, 'POST', '/proof', ours, {
    title: 'Cut settlement time by half', kind: 'case_study', outcome_note: '48h → 22h',
  });
  assert.equal(item.status, 200);
  assert.equal(item.body.is_published, false);
  // "Self-stated" is the word, and it is doing work: the firm's own account of
  // a result and a client's confirmation of it are different evidence.
  assert.equal(item.body.status, 'self_stated');

  const list = (await call(e, 'GET', '/proof', ours)).body;
  assert.equal(list.published_count, 0);
  assert.equal(list.self_stated_count, 1);
});

test('the firm has no route that can grant consent', async () => {
  const db = freshDb();
  const e = env(db);
  const item = await call(e, 'POST', '/proof', ours, { title: 'A result' });
  const ask = await call(e, 'POST', `/proof/${item.body.id}/consent-request`, ours, {
    consenter_name: 'Dana', consenter_role: 'CTO',
  });
  assert.equal(ask.status, 200);

  // Every shape a firm might try. None of them may set consent_given.
  await call(e, 'PATCH', `/proof/${item.body.id}`, ours, {
    title: 'A result', consent_given: true, is_published: true, status: 'published',
  });
  await call(e, 'POST', `/proof/${item.body.id}/consent-request`, ours, {
    consenter_name: 'Dana', consent_given: true, consent_text: 'sure',
  });

  const rows = db.prepare('SELECT consent_given FROM partner_proof_consents').all() as any[];
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.equal(Number(row.consent_given), 0, 'a firm-side write granted consent');
  }
  const after = (await call(e, 'GET', '/proof', ours)).body;
  assert.equal(after.items[0].is_published, false);
});

test('the token is returned once and by no later read', async () => {
  const e = env(freshDb());
  const item = await call(e, 'POST', '/proof', ours, { title: 'A result' });
  const ask = await call(e, 'POST', `/proof/${item.body.id}/consent-request`, ours, {
    consenter_name: 'Dana',
  });
  assert.ok(ask.body.request_token, 'the ask must return the token once');
  assert.equal(ask.body.delivered, false, 'nothing is sent — the firm hands the link over');

  // A firm that could read it back could answer on the client's behalf, which
  // would make every consent in the table self-issued and worth nothing.
  const list = (await call(e, 'GET', '/proof', ours)).body;
  assert.equal(list.items[0].consents.length, 1);
  assert.equal(list.items[0].consents[0].request_token, undefined);
  // A plain substring test, not a regex built from the token — same reasoning
  // as the guards in `frontend/test/_zoneGuards.mjs`, and here the token could
  // in principle contain a metacharacter that changed what the pattern meant.
  assert.ok(!JSON.stringify(list).includes(ask.body.request_token),
    'the token appeared somewhere in a later read');
});

test('the client answers unauthenticated, and that is what publishes it', async () => {
  const e = env(freshDb());
  const item = await call(e, 'POST', '/proof', ours, { title: 'A result' });
  const ask = await call(e, 'POST', `/proof/${item.body.id}/consent-request`, ours, {
    consenter_name: 'Dana',
  });

  // No Authorization header at all. The counterparty on an engagement is often
  // not a user of this product; requiring an account would mean the only
  // publishable outcomes are the ones an existing Axal user will vouch for.
  const answered = await call(e, 'POST', `/proof-consents/${ask.body.request_token}/respond`, null, {
    consent_text: 'I confirm this is accurate and they may show it.',
  });
  assert.equal(answered.status, 200);
  assert.equal(answered.body.consent_given, true);
  assert.match(answered.body.consent_text, /may show it/);

  const list = (await call(e, 'GET', '/proof', ours)).body;
  assert.equal(list.items[0].is_published, true);
  assert.equal(list.items[0].status, 'published');
  assert.equal(list.published_count, 1);
});

test('agreeing without saying to what is refused', async () => {
  const e = env(freshDb());
  const item = await call(e, 'POST', '/proof', ours, { title: 'A result' });
  const ask = await call(e, 'POST', `/proof/${item.body.id}/consent-request`, ours, {
    consenter_name: 'Dana',
  });
  // Consent to "a case study" and consent to "a case study naming our revenue"
  // are different consents, so a record with no wording is a record of nothing.
  const bare = await call(e, 'POST', `/proof-consents/${ask.body.request_token}/respond`, null, {});
  assert.equal(bare.status, 400);
  assert.match(bare.body.detail, /consent_text/);
});

test('declining leaves a row saying no', async () => {
  const db = freshDb();
  const e = env(db);
  const item = await call(e, 'POST', '/proof', ours, { title: 'A result' });
  const ask = await call(e, 'POST', `/proof/${item.body.id}/consent-request`, ours, {
    consenter_name: 'Dana',
  });
  await call(e, 'POST', `/proof-consents/${ask.body.request_token}/respond`, null, {
    consent_given: false,
  });
  // A request that vanished on refusal would let a firm re-ask until it got a
  // yes, with nothing on the record.
  assert.equal(db.prepare('SELECT COUNT(*) c FROM partner_proof_consents').get<any>().c, 1);
  const list = (await call(e, 'GET', '/proof', ours)).body;
  assert.equal(list.items[0].is_published, false);
  assert.ok(list.items[0].consents[0].withdrawn_at, 'a decline must be visible as one');
});

test('a withdrawal un-publishes and stays on the record', async () => {
  const db = freshDb();
  const e = env(db);
  const item = await call(e, 'POST', '/proof', ours, { title: 'A result' });
  const ask = await call(e, 'POST', `/proof/${item.body.id}/consent-request`, ours, {
    consenter_name: 'Dana',
  });
  await call(e, 'POST', `/proof-consents/${ask.body.request_token}/respond`, null, {
    consent_text: 'Yes.',
  });
  const before = (await call(e, 'GET', '/proof', ours)).body;
  assert.equal(before.items[0].is_published, true);

  const consentId = before.items[0].consents[0].id;
  const w = await call(e, 'POST', `/proof/${item.body.id}/consents/${consentId}/withdraw`, ours);
  assert.equal(w.status, 200);

  const after = (await call(e, 'GET', '/proof', ours)).body;
  assert.equal(after.items[0].is_published, false);
  assert.equal(after.items[0].status, 'self_stated');
  // The row stays: a consent that can silently vanish is not evidence, and the
  // fact that it was given and taken back is itself worth keeping.
  assert.equal(db.prepare('SELECT COUNT(*) c FROM partner_proof_consents').get<any>().c, 1);
  assert.ok(after.items[0].consents[0].withdrawn_at);
  assert.ok(after.items[0].consents[0].consent_given_at, 'the fact it was once given must survive');
});

test('a withdrawal survives a forgotten column', async () => {
  const db = freshDb();
  const e = env(db);
  const item = await call(e, 'POST', '/proof', ours, { title: 'A result' });
  const ask = await call(e, 'POST', `/proof/${item.body.id}/consent-request`, ours, {
    consenter_name: 'Dana',
  });
  await call(e, 'POST', `/proof-consents/${ask.body.request_token}/respond`, null, {
    consent_text: 'Yes.',
  });
  // Simulate the half-write this design exists to survive: `withdrawn_at` set,
  // `consent_given` left at 1. Published must still be false, because it is
  // computed from BOTH columns.
  db.prepare("UPDATE partner_proof_consents SET withdrawn_at = '2026-09-04T00:00:00Z'").run();
  const after = (await call(e, 'GET', '/proof', ours)).body;
  assert.equal(after.items[0].is_published, false,
    'published survived a withdrawal because only one of the two columns was checked');
});

test('the consent DTO uses 209 column names, not 204 ones', async () => {
  const e = env(freshDb());
  const item = await call(e, 'POST', '/proof', ours, { title: 'A result' });
  const ask = await call(e, 'POST', `/proof/${item.body.id}/consent-request`, ours, {
    consenter_name: 'Dana', consenter_email: 'dana@example.com', consenter_role: 'CTO',
  });
  // Copying `advisors.ts`'s consentDto wholesale returns undefined for every
  // field and throws nothing. Only this catches it.
  assert.equal(ask.body.consenter_name, 'Dana');
  assert.equal(ask.body.consenter_email, 'dana@example.com');
  assert.equal(ask.body.consenter_role, 'CTO');
  assert.equal(ask.body.attester_name, undefined, '204 column names must not appear');
});

test('a proof item cannot be attached to another firm\'s engagement', async () => {
  const e = env(freshDb());
  const r = await call(e, 'POST', '/proof', ours, {
    title: 'Their work, our page', engagement_id: THEIR_ENGAGEMENT,
  });
  assert.equal(r.status, 404);
});

test('deleting a proof item takes its consent rows with it', async () => {
  const db = freshDb();
  const e = env(db);
  const item = await call(e, 'POST', '/proof', ours, { title: 'A result' });
  await call(e, 'POST', `/proof/${item.body.id}/consent-request`, ours, { consenter_name: 'Dana' });
  await call(e, 'DELETE', `/proof/${item.body.id}`, ours);
  // A consent row whose item is gone records a decision about nothing, and it
  // would keep a person's name and email in the store after the thing they were
  // asked about had been removed.
  assert.equal(db.prepare('SELECT COUNT(*) c FROM partner_proof_consents').get<any>().c, 0);
});

// ---------------------------------------------------------------------------
// Audience fit
// ---------------------------------------------------------------------------

test('a budget floor rejects a fraction, a negative and a word', async () => {
  const e = env(freshDb());
  for (const amount of [12.5, -1, 'free']) {
    const r = await call(e, 'POST', '/fit-rules', ours, {
      kind: 'budget_floor', floor_cents: amount,
    });
    assert.equal(r.status, 400, `${amount} was accepted as a floor`);
  }
  const none = await call(e, 'POST', '/fit-rules', ours, { kind: 'budget_floor' });
  assert.equal(none.status, 400);
  assert.match(none.body.detail, /needs an amount/i);
});

test('a non-floor rule cannot carry an amount', async () => {
  const e = env(freshDb());
  const r = await call(e, 'POST', '/fit-rules', ours, {
    kind: 'sector_declined', value: 'adtech', floor_cents: 500000,
    statement: 'We do not work in adtech.',
  });
  assert.equal(r.status, 200);
  // Storing one would put an amount where the zone reads a reason, and a later
  // kind change would then surface a floor nobody set.
  assert.equal(r.body.floor_cents, null);
});

test('a rule with no sentence is counted, because a pass citing it says nothing', async () => {
  const e = env(freshDb());
  await call(e, 'POST', '/fit-rules', ours, { kind: 'budget_floor', floor_cents: 2500000 });
  await call(e, 'POST', '/fit-rules', ours, {
    kind: 'best_fit', value: 'Series A fintech', statement: 'This is who we are for.',
  });
  const r = (await call(e, 'GET', '/fit-rules', ours)).body;
  assert.equal(r.items.length, 2);
  assert.equal(r.unstated_count, 1);
});

test('the response says nothing enforces these rules', async () => {
  const e = env(freshDb());
  await call(e, 'POST', '/fit-rules', ours, {
    kind: 'capability_absent', value: 'mobile', statement: 'We do not build mobile apps.',
  });
  const r = (await call(e, 'GET', '/fit-rules', ours)).body;
  // In the RESPONSE rather than only in page copy: a page can drift away from
  // what the API does, and the rail promises no lead is passed except on a
  // click. This is where that promise is kept.
  assert.equal(r.enforcement, 'none');
  assert.match(r.enforcement_note, /nothing scores, filters or auto-declines/i);
});

test('a rule that is not a floor needs something to be about', async () => {
  const e = env(freshDb());
  const r = await call(e, 'POST', '/fit-rules', ours, { kind: 'sector_declined' });
  assert.equal(r.status, 400);
  assert.match(r.body.detail, /sector, capability or fit/i);
});

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

test('another firm gets 404 on every write, and sees none of the rows', async () => {
  const e = env(freshDb());
  const surface = await call(e, 'POST', '/surfaces', theirs, { name: 'Theirs' });
  const item = await call(e, 'POST', '/proof', theirs, { title: 'Their case study' });
  const rule = await call(e, 'POST', '/fit-rules', theirs, {
    kind: 'best_fit', value: 'theirs', statement: 'x',
  });

  for (const [method, path, b] of [
    ['PATCH', `/surfaces/${surface.body.id}`, { name: 'Mine' }],
    ['DELETE', `/surfaces/${surface.body.id}`, undefined],
    ['PATCH', `/proof/${item.body.id}`, { title: 'Mine' }],
    ['DELETE', `/proof/${item.body.id}`, undefined],
    ['POST', `/proof/${item.body.id}/consent-request`, { consenter_name: 'X' }],
    ['PATCH', `/fit-rules/${rule.body.id}`, { kind: 'best_fit', value: 'mine' }],
    ['DELETE', `/fit-rules/${rule.body.id}`, undefined],
    ['PUT', `/engagements/${THEIR_ENGAGEMENT}/source`, { surface_id: surface.body.id }],
  ] as const) {
    const r = await call(e, method as string, path as string, ours, b as any);
    assert.equal(r.status, 404, `${method} ${path} answered ${r.status}, not 404`);
  }

  // And the reads return nothing of theirs either.
  assert.equal((await call(e, 'GET', '/visibility', ours)).body.items.length, 0);
  assert.equal((await call(e, 'GET', '/proof', ours)).body.items.length, 0);
  assert.equal((await call(e, 'GET', '/fit-rules', ours)).body.items.length, 0);
});

test('a founder is refused outright', async () => {
  const e = env(freshDb());
  for (const path of ['/visibility', '/proof', '/fit-rules']) {
    assert.equal((await call(e, 'GET', path, fran)).status, 403);
  }
});

test('an anonymous caller can only reach the consent response', async () => {
  const e = env(freshDb());
  for (const path of ['/visibility', '/proof', '/fit-rules', '/attribution']) {
    const r = await call(e, 'GET', path, null);
    assert.equal(r.status, 401, `${path} is readable without a token`);
  }
  // And a wrong token on the one public route is a 404, not a hint.
  const bad = await call(e, 'POST', '/proof-consents/not-a-real-token/respond', null, {
    consent_text: 'Yes.',
  });
  assert.equal(bad.status, 404);
});

// ---------------------------------------------------------------------------
// The routes store nothing they derive
// ---------------------------------------------------------------------------

test('no route writes a value it computes', () => {
  const src = readFileSync(resolve(HERE, '../src/routes/partner_offers.ts'), 'utf8');
  const writes = [...src.matchAll(/(?:INSERT INTO|UPDATE)\s+\w+[\s\S]*?(?=`)/g)].join('\n');
  const named = new Set(writes.split(/[^A-Za-z0-9_]+/).filter(Boolean));
  // `is_published` and `status` are read-time derivations over the consent
  // rows. A column for either would be a second source of truth that disagrees
  // the first time a consent is withdrawn through a path that forgot the flag —
  // which is the whole argument migration 209's header makes.
  for (const derived of ['is_published', 'engagement_count', 'won_value', 'unstated_count']) {
    assert.ok(!named.has(derived),
      `a write names \`${derived}\` — that value is derived and must not be stored`);
  }
});
