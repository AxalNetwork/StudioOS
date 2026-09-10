/**
 * Company invitations — Task #121, and what the page used to do instead.
 *
 * `POST /company/:uid/members` resolves an email to an EXISTING user row and
 * 404s otherwise, then writes `user_company_links`. So the control labelled
 * "Invite by email" could not reach anyone without an account, and for anyone
 * with one it joined them to a company without asking. `CompanySettingsPage`
 * said as much in its own docblock, which was the right thing to write down
 * and the wrong thing to leave true.
 *
 * These tests drive the SHIPPED routes through `r.fetch()` against in-memory
 * SQLite whose `company_invitations` DDL is lifted VERBATIM from migration
 * 236 — the same rule the calendar suite adopted after a harness that invented
 * its own schema confirmed a column (`founders.user_id`) that has never
 * existed. The mailer is stubbed at the module boundary so "did the email
 * send" is observable without sending one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';

import company from '../src/routes/company.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const OWNER = 501;      // primary admin of the company
const OUTSIDER = 502;   // authenticated, but not a member
const INVITEE = 503;    // the address the invitation is sent to
const CO_UID = 'co-uid-1';

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
    async batch(x: any[]) { return x; },
  };
}

/** Migration 236's own statements, so the test cannot drift from the schema. */
function migration236(): string {
  const src = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/236_company_invitations.sql'), 'utf8');
  const body = src.replace(/^--.*$/gm, '');
  assert.match(body, /CREATE TABLE IF NOT EXISTS company_invitations/, 'migration 236 no longer creates the table this suite drives');
  assert.match(body, /status IN \('pending', 'accepted', 'revoked', 'expired'\)/, 'the closed status set changed');
  assert.match(body, /idx_company_invitations_one_pending/, 'the one-pending-per-address index is gone');
  return body;
}

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT, is_active INTEGER DEFAULT 1,
      jwt_min_iat INTEGER, founder_id INTEGER, partner_id INTEGER, name TEXT, email TEXT);
    CREATE TABLE company_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, company_name TEXT NOT NULL,
      stage TEXT, revenue_range TEXT, employee_count INTEGER, current_products TEXT,
      international_presence TEXT, expansion_goals TEXT, logo_url TEXT, website TEXT,
      linkedin_url TEXT, description TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE user_company_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, company_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL, role_in_company TEXT NOT NULL DEFAULT 'Member',
      is_primary_admin INTEGER NOT NULL DEFAULT 0, title TEXT, authority TEXT, carry_bps INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE (company_id, user_id));
  `);
  db.exec(migration236());
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  u.run(OWNER, 'founder', 'Owner Person', 'owner@example.test');
  u.run(OUTSIDER, 'founder', 'Outsider', 'outsider@example.test');
  u.run(INVITEE, 'founder', 'Invitee', 'invitee@example.test');
  db.prepare("INSERT INTO company_profiles (id, uid, company_name) VALUES (1, ?, 'Halyard')").run(CO_UID);
  db.prepare(
    "INSERT INTO user_company_links (uid, company_id, user_id, role_in_company, is_primary_admin) VALUES ('l1', 1, ?, 'Owner', 1)",
  ).run(OWNER);
  return db;
}

async function tokenFor(userId: number, role = 'founder') {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

/** Every mail this suite would have sent, so `email_sent` is observable. */
const sent: { to: string; link: string }[] = [];
let mailWorks = true;

async function call(db: any, userId: number, path: string, init: RequestInit = {}) {
  const jwt = await tokenFor(userId);
  const res = await company.fetch(
    new Request(`http://x${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json', ...(init.headers || {}) },
    }),
    {
      JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db),
      // The mailer reads these before it does anything; absent means "not
      // sent", which is the state the page draws differently.
      GMAIL_CLIENT_ID: mailWorks ? 'id' : '', GMAIL_CLIENT_SECRET: mailWorks ? 'secret' : '',
      GMAIL_REFRESH_TOKEN: mailWorks ? 'refresh' : '',
      PUBLIC_BASE_URL: 'https://axal.vc',
    } as any,
  );
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}

// The Gmail call is the only network in this path. Stubbing fetch keeps the
// send observable AND proves the route reports a refusal rather than throwing.
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: any) => {
  const url = String(input?.url || input);
  if (url.includes('googleapis.com')) {
    if (url.includes('oauth2') || url.includes('token')) {
      return new Response(JSON.stringify({ access_token: 'stub' }), { status: 200 });
    }
    const raw = JSON.parse(String(init?.body || '{}')).raw || '';
    const decoded = atob(raw.replace(/-/g, '+').replace(/_/g, '/'));
    // The two bodies are themselves base64 INSIDE the multipart envelope, so
    // the link is not in the decoded raw — an earlier version of this harness
    // read that as "no token reached the email" when the mail was fine.
    // Decode every part and search the result.
    const parts = decoded.split(/\r?\n\r?\n/).map((chunk) => {
      const flat = chunk.replace(/\s+/g, '');
      if (!/^[A-Za-z0-9+/=]{40,}$/.test(flat)) return '';
      try { return decodeURIComponent(escape(atob(flat))); } catch { return ''; }
    }).join('\n');
    sent.push({
      to: (decoded.match(/^To: (.*)$/m) || [])[1] || '',
      link: (parts.match(/https:\/\/axal\.vc\/company\/invitations\/accept\?token=[A-Za-z0-9._~%-]+/) || [])[0] || '',
    });
    return new Response(JSON.stringify({ id: 'stub' }), { status: 200 });
  }
  return realFetch(input, init);
}) as any;

/**
 * The token, taken from the route's `accept_path` — the once-only channel the
 * inviter actually gets it on, and the only one that exists when the mailer is
 * unconfigured. `tokenInLastMail` separately proves the RECIPIENT's copy
 * works, which is a different claim and gets its own assertion.
 */
function tokenFrom(body: any): string {
  return decodeURIComponent(String(body?.accept_path || '').split('token=')[1] || '');
}
function tokenInLastMail(): string {
  const link = sent[sent.length - 1]?.link || '';
  return decodeURIComponent((link.split('token=')[1] || '').trim());
}

test('inviting a stranger creates a pending row and mails a link', async () => {
  sent.length = 0; mailWorks = true;
  const db = freshDb();
  const r = await call(db, OWNER, `/company/${CO_UID}/invitations`, {
    method: 'POST', body: JSON.stringify({ email: 'Nobody@Example.test', role_in_company: 'Engineer' }),
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.email_sent, true, 'the invitation reports a send that did not happen');
  assert.equal(sent.length, 1, 'no email left the worker');
  assert.match(sent[0].to, /nobody@example\.test/i);

  const row: any = db.prepare('SELECT * FROM company_invitations').get();
  assert.equal(row.email, 'nobody@example.test', 'the address was not normalised before storage');
  assert.equal(row.status, 'pending');
  assert.equal(row.role_in_company, 'Engineer');
  assert.equal(row.email_sent, 1);
  // THE POINT OF THE WHOLE TABLE: no membership yet. The old path wrote one.
  assert.equal(db.prepare('SELECT COUNT(*) c FROM user_company_links').get().c, 1,
    'inviting somebody joined them to the company without their consent');
});

test('the invited role is clamped the way the edit control clamps it', async () => {
  // `PATCH /company/:uid/members/:userId` stores `.trim().slice(0, 80)`.
  // Accepting writes this value straight into `user_company_links`, so an
  // invitation that stored a longer one would seat a member holding a role
  // the edit control could never reproduce — and every later save of that
  // row would silently truncate it.
  sent.length = 0; mailWorks = true;
  const db = freshDb();
  const long = 'Chief '.repeat(40).trim();          // 239 characters
  await call(db, OWNER, `/company/${CO_UID}/invitations`, {
    method: 'POST', body: JSON.stringify({ email: 'long@example.test', role_in_company: long }),
  });
  const stored = db.prepare("SELECT role_in_company FROM company_invitations WHERE email = 'long@example.test'")
    .get().role_in_company;
  assert.equal(stored.length, 80, `the role was stored at ${stored.length} characters`);
  assert.equal(stored, long.slice(0, 80), 'the clamp changed the text as well as its length');

  // Whitespace-only is not a role. The column is NOT NULL with a 'Member'
  // default, but a bound '   ' defeats the default and seats a nameless one.
  await call(db, OWNER, `/company/${CO_UID}/invitations`, {
    method: 'POST', body: JSON.stringify({ email: 'blank@example.test', role_in_company: '   ' }),
  });
  assert.equal(
    db.prepare("SELECT role_in_company FROM company_invitations WHERE email = 'blank@example.test'").get().role_in_company,
    'Member', 'a blank role was stored instead of falling back to Member');
});

test('only the hash is stored — the raw token is never in the row or the list', async () => {
  sent.length = 0; mailWorks = true;
  const db = freshDb();
  const r = await call(db, OWNER, `/company/${CO_UID}/invitations`, {
    method: 'POST', body: JSON.stringify({ email: 'invitee@example.test' }),
  });
  const token = tokenFrom(r.body);
  assert.ok(token.length > 20, 'no token was returned to the inviter');
  // And the RECIPIENT's copy is the same working link, decoded out of the
  // base64 body the mailer actually sent.
  assert.equal(tokenInLastMail(), token, 'the emailed link carries a different token from the returned one');
  const row: any = db.prepare('SELECT * FROM company_invitations').get();
  assert.ok(!Object.values(row).some((v) => typeof v === 'string' && v.includes(token)),
    'the raw token is recoverable from the invitations table');
  assert.equal(row.token_hash.length, 64, 'token_hash is not a SHA-256 hex digest');
  // Nor does the list — which the settings page renders — leak it.
  const list = await call(db, OWNER, `/company/${CO_UID}/invitations`);
  assert.ok(!JSON.stringify(list.body).includes(token), 'the invitation list hands back the token');
  // It IS returned once, at creation, because with no mailer that link is the
  // only way the inviter can pass the invitation on.
  assert.ok(String(r.body.accept_path).includes(token), 'the creating caller cannot get the link even once');

  // THE DTO IS AN ALLOWLIST, asserted as a whole rather than by naming the
  // fields that must not appear. Checking "the raw token is absent" let a
  // mutation adding `token_hash` straight through; a closed key set is the
  // only shape that catches the NEXT field somebody adds.
  const one = (list.body as any).invitations[0];
  assert.deepEqual(Object.keys(one).sort(), [
    'accepted_at', 'authority', 'created_at', 'email', 'email_sent',
    'expires_at', 'invited_by', 'role_in_company', 'status', 'title', 'uid',
  ], 'the invitation DTO grew or lost a field — if that is deliberate, say so here');
});

test('accepting joins the company — and only for the address it was sent to', async () => {
  sent.length = 0; mailWorks = true;
  const db = freshDb();
  const created = await call(db, OWNER, `/company/${CO_UID}/invitations`, {
    method: 'POST', body: JSON.stringify({ email: 'invitee@example.test', role_in_company: 'Engineer' }),
  });
  const token = tokenFrom(created.body);

  // A DIFFERENT signed-in account holding the same link gets nothing. Without
  // this, forwarding an invitation would join the forwarder.
  const wrong = await call(db, OUTSIDER, '/company/invitations/accept', {
    method: 'POST', body: JSON.stringify({ token }),
  });
  assert.equal(wrong.status, 403, 'a forwarded invitation joined the wrong account');
  assert.equal(wrong.body.code, 'wrong_account');
  assert.equal(wrong.body.invited_email, 'invitee@example.test', 'the reader is not told which address it was for');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM user_company_links').get().c, 1);

  const ok = await call(db, INVITEE, '/company/invitations/accept', {
    method: 'POST', body: JSON.stringify({ token }),
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.company_uid, CO_UID);
  assert.equal(ok.body.already_member, false);
  const link: any = db.prepare('SELECT * FROM user_company_links WHERE user_id = ?').get(INVITEE);
  assert.ok(link, 'accepting did not create the membership');
  assert.equal(link.role_in_company, 'Engineer', 'the invited role was not carried through');
  assert.equal(link.is_primary_admin, 0, 'an invitation granted primary admin');

  // Second use of the same token is refused: an accepted invitation is spent.
  const again = await call(db, INVITEE, '/company/invitations/accept', {
    method: 'POST', body: JSON.stringify({ token }),
  });
  assert.equal(again.status, 410, 'an accepted invitation can be replayed');
  assert.equal(again.body.code, 'accepted');
});

test('an expired invitation is refused, and stops calling itself pending', async () => {
  sent.length = 0; mailWorks = true;
  const db = freshDb();
  const created = await call(db, OWNER, `/company/${CO_UID}/invitations`, {
    method: 'POST', body: JSON.stringify({ email: 'invitee@example.test' }),
  });
  const token = tokenFrom(created.body);
  db.prepare("UPDATE company_invitations SET expires_at = datetime('now', '-1 day')").run();
  const r = await call(db, INVITEE, '/company/invitations/accept', {
    method: 'POST', body: JSON.stringify({ token }),
  });
  assert.equal(r.status, 410);
  assert.equal(r.body.code, 'expired');
  assert.equal(db.prepare('SELECT status FROM company_invitations').get().status, 'expired',
    'the row still reads pending after being refused as expired');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM user_company_links').get().c, 1);
});

test('revoking kills the link, and the row survives so the address can be re-invited', async () => {
  sent.length = 0; mailWorks = true;
  const db = freshDb();
  const created = await call(db, OWNER, `/company/${CO_UID}/invitations`, {
    method: 'POST', body: JSON.stringify({ email: 'invitee@example.test' }),
  });
  const token = tokenFrom(created.body);
  const uid = db.prepare('SELECT uid FROM company_invitations').get().uid;

  const rev = await call(db, OWNER, `/company/${CO_UID}/invitations/${uid}`, { method: 'DELETE' });
  assert.equal(rev.status, 200);
  const dead = await call(db, INVITEE, '/company/invitations/accept', {
    method: 'POST', body: JSON.stringify({ token }),
  });
  assert.equal(dead.status, 410, 'a revoked invitation still works');
  assert.equal(dead.body.code, 'revoked');

  // The partial unique index covers PENDING only, so the same address can be
  // invited again — which is the reason the revoked row is kept rather than
  // deleted, along with the record of who asked whom.
  const second = await call(db, OWNER, `/company/${CO_UID}/invitations`, {
    method: 'POST', body: JSON.stringify({ email: 'invitee@example.test' }),
  });
  assert.equal(second.status, 200, 'a revoked address cannot be re-invited');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM company_invitations').get().c, 2,
    'the revoked row was destroyed rather than kept');
});

test('resending issues a NEW token and retires the old link', async () => {
  sent.length = 0; mailWorks = true;
  const db = freshDb();
  const created = await call(db, OWNER, `/company/${CO_UID}/invitations`, {
    method: 'POST', body: JSON.stringify({ email: 'invitee@example.test' }),
  });
  const first = tokenFrom(created.body);
  const uid = db.prepare('SELECT uid FROM company_invitations').get().uid;

  // AGE IT FIRST. The row was created seconds ago with a 14-day expiry, so
  // "expires more than 13 days out" is true whether or not resend touches it
  // — a mutation dropping the clock reset sailed through exactly that check.
  // Pushed to the brink, only an actual reset can satisfy it.
  db.prepare("UPDATE company_invitations SET expires_at = datetime('now', '+1 hour')").run();

  const re = await call(db, OWNER, `/company/${CO_UID}/invitations/${uid}/resend`, { method: 'POST' });
  assert.equal(re.status, 200, JSON.stringify(re.body));
  const second = tokenFrom(re.body);
  assert.notEqual(second, first, 'resend reused a token the server cannot reproduce');
  assert.equal(sent.length, 2);

  // ...and the clock the ageing UPDATE above pushed to the brink is back out
  // to fourteen days. Read from the row AND from the list the caller was
  // handed, because a reset the UI never sees leaves the member card counting
  // down to an hour that is not the truth.
  assert.equal(
    db.prepare("SELECT COUNT(*) c FROM company_invitations WHERE expires_at > datetime('now', '+13 days')").get().c,
    1, 'resend did not restart the 14-day clock');
  assert.ok(
    new Date(`${String(re.body.invitations[0].expires_at).replace(' ', 'T')}Z`).getTime()
      > Date.now() + 13 * 86400_000,
    'the resent invitation is still listed with its old expiry');

  // TWICE, because `second !== first` alone is satisfied by a CONSTANT — a
  // mutation replacing generateToken() with a fixed string escaped exactly
  // that assertion, and a fixed invitation token is the worst possible bug
  // in this file. Two resends must differ from each other too.
  const re2 = await call(db, OWNER, `/company/${CO_UID}/invitations/${uid}/resend`, { method: 'POST' });
  const third = tokenFrom(re2.body);
  assert.notEqual(third, second, 'every resend issues the same token');
  assert.notEqual(third, first, 'the token cycles back to an earlier value');
  assert.ok(third.length >= 24, 'the resent token is too short to be unguessable');

  // AND A RESEND THAT DID NOT SEND SAYS SO. With the mailer working the row
  // ends at email_sent = 1 whichever way the flag is written, so the only way
  // to prove it is re-derived rather than left standing is to resend with the
  // mailer off and watch it go back to 0. Done HERE, before the accept, because
  // accepting spends the invitation and a later resend would 409.
  mailWorks = false;
  const quiet = await call(db, OWNER, `/company/${CO_UID}/invitations/${uid}/resend`, { method: 'POST' });
  assert.equal(quiet.status, 200);
  assert.equal(quiet.body.email_sent, false, 'a resend that sent nothing reported a send');
  assert.equal(db.prepare('SELECT email_sent FROM company_invitations').get().email_sent, 0,
    'the row still claims the last resend was emailed');
  mailWorks = true;
  const newest = tokenFrom(quiet.body);

  // EVERY superseded link is dead, and only the newest one works. Checked
  // after ALL the resends, not between them — two earlier drafts of this test
  // accepted with a token a later resend had already replaced, and read the
  // resulting 404 as a bug in the route rather than in the test.
  for (const [label, stale] of [['first', first], ['second', second], ['third', third]] as [string, string][]) {
    const dead = await call(db, INVITEE, '/company/invitations/accept', {
      method: 'POST', body: JSON.stringify({ token: stale }),
    });
    assert.equal(dead.status, 404, `the superseded ${label} link still works`);
  }
  const newOne = await call(db, INVITEE, '/company/invitations/accept', {
    method: 'POST', body: JSON.stringify({ token: newest }),
  });
  assert.equal(newOne.status, 200, 'the freshly sent link does not work');
});

test('a send that did not happen is reported as not sent, not as success', async () => {
  sent.length = 0; mailWorks = false;   // no Gmail credentials in this env
  const db = freshDb();
  const r = await call(db, OWNER, `/company/${CO_UID}/invitations`, {
    method: 'POST', body: JSON.stringify({ email: 'invitee@example.test' }),
  });
  assert.equal(r.status, 200, 'the invitation was not created');
  assert.equal(r.body.email_sent, false, 'a silent mail failure is reported as a send');
  assert.equal(sent.length, 0);
  assert.equal(db.prepare('SELECT email_sent FROM company_invitations').get().email_sent, 0,
    'the row claims the email left');
  // The link is still returned, because it is now the only way to pass the
  // invitation on — and the token in it must actually work.
  const token = decodeURIComponent(String(r.body.accept_path).split('token=')[1]);
  const ok = await call(db, INVITEE, '/company/invitations/accept', {
    method: 'POST', body: JSON.stringify({ token }),
  });
  assert.equal(ok.status, 200, 'the handed-over link does not accept');
});

test('only someone who may manage members may invite, list, resend or revoke', async () => {
  sent.length = 0; mailWorks = true;
  const db = freshDb();
  await call(db, OWNER, `/company/${CO_UID}/invitations`, {
    method: 'POST', body: JSON.stringify({ email: 'invitee@example.test' }),
  });
  const uid = db.prepare('SELECT uid FROM company_invitations').get().uid;

  for (const [path, init] of [
    [`/company/${CO_UID}/invitations`, { method: 'POST', body: JSON.stringify({ email: 'x@example.test' }) }],
    // Listing is gated on the SAME right as managing, not on membership: the
    // rows carry other people's email addresses.
    [`/company/${CO_UID}/invitations`, {}],
    [`/company/${CO_UID}/invitations/${uid}/resend`, { method: 'POST' }],
    [`/company/${CO_UID}/invitations/${uid}`, { method: 'DELETE' }],
  ] as [string, RequestInit][]) {
    const r = await call(db, OUTSIDER, path, init);
    assert.equal(r.status, 403, `${init.method || 'GET'} ${path} is open to a non-member`);
  }
  assert.equal(db.prepare('SELECT COUNT(*) c FROM company_invitations').get().c, 1,
    'an outsider changed the invitation list');
});

test('inviting someone already on the company is refused, and so is a second pending invitation', async () => {
  sent.length = 0; mailWorks = true;
  const db = freshDb();
  const dupe = await call(db, OWNER, `/company/${CO_UID}/invitations`, {
    method: 'POST', body: JSON.stringify({ email: 'owner@example.test' }),
  });
  assert.equal(dupe.status, 409, 'an existing member can be invited again');

  await call(db, OWNER, `/company/${CO_UID}/invitations`, {
    method: 'POST', body: JSON.stringify({ email: 'invitee@example.test' }),
  });
  const twice = await call(db, OWNER, `/company/${CO_UID}/invitations`, {
    method: 'POST', body: JSON.stringify({ email: 'INVITEE@example.test' }),
  });
  // Caught by the partial unique index rather than a check-first read, which
  // is what makes two admins clicking at once safe.
  assert.equal(twice.status, 409, 'a duplicate pending invitation was created');
  assert.equal(twice.body.code, 'already_pending');
  assert.equal(db.prepare("SELECT COUNT(*) c FROM company_invitations WHERE status='pending'").get().c, 1);
});

test('a malformed address never reaches the mailer', async () => {
  sent.length = 0; mailWorks = true;
  const db = freshDb();
  for (const bad of ['', '   ', 'not-an-email', 'a@b', 'two@@at.test']) {
    const r = await call(db, OWNER, `/company/${CO_UID}/invitations`, {
      method: 'POST', body: JSON.stringify({ email: bad }),
    });
    assert.equal(r.status, 400, `"${bad}" was accepted as an address`);
  }
  assert.equal(sent.length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM company_invitations').get().c, 0);
});
