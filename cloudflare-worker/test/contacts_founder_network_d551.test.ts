/**
 * D551 (#1144) — a founder's contact gets a strength and an organisation, the
 * contact list carries its follow-up rollup, and the founder Network desk's
 * two proposal bands have draft surfaces of their own.
 *
 * Pins:
 *   - migration 386 on a database built from the migrations (127, 128, 166, 386);
 *   - `PUT /api/contacts/:uid` sets, clears and refuses, for the owner only;
 *   - the list's rollup numbers, from one statement however many contacts;
 *   - `network/re-engagement` drafts over the caller's own cold contacts only,
 *     and `network/intro-email` over the caller's own accepted propositions.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/contacts_founder_network_d551.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import contacts, { contactProfilePatch } from '../src/routes/contacts.ts';
import research from '../src/routes/research.ts';

const here = dirname(fileURLToPath(import.meta.url));
const migration = (f: string) => readFileSync(resolve(here, `../sql/migrations/${f}`), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const MINE = { user: 70, founder_id: 170, project: 900 };
const THEIRS = { user: 71, founder_id: 171, project: 901 };

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
/** A D1 over node:sqlite that records every statement it is asked to prepare. */
function makeD1(db: InstanceType<typeof DatabaseSync>, log: string[] = []) {
  return {
    prepare(sql: string) {
      log.push(sql);
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

const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString().replace('T', ' ').slice(0, 19);

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER, partner_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT,
      spinout_lab_active INTEGER, subscription_tier TEXT
    );
    CREATE TABLE founders (id INTEGER PRIMARY KEY, uid TEXT, name TEXT, email TEXT);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, uid TEXT, name TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT);
    CREATE TABLE user_company_links (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, user_id INTEGER NOT NULL);
    CREATE TABLE mi_pro_subscriptions (user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT, period_end TEXT, stripe_customer_id TEXT);
    CREATE TABLE landing_pages (id INTEGER PRIMARY KEY, name TEXT, template_kit TEXT);
    CREATE TABLE raise_prospects (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL, project_id INTEGER NOT NULL, contact_id INTEGER,
      name TEXT, email TEXT, firm TEXT, stage TEXT NOT NULL DEFAULT 'to_contact', notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE research_zone_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, owner_user_id INTEGER NOT NULL, surface TEXT NOT NULL,
      scope_key TEXT, body TEXT NOT NULL, model TEXT, cost_micro_usd INTEGER NOT NULL DEFAULT 0,
      accepted_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // contacts, contact_replies and contact_tasks as the migrations build them.
  db.exec(migration('127_contacts.sql'));
  db.exec(migration('128_contact_promotion.sql').split('\n').filter((l) => !/^\s*--/.test(l)).join('\n'));
  db.exec(migration('166_contact_attribution.sql'));
  db.exec(migration('386_contact_strength_organization.sql'));
  db.exec(migration('150_introductions_network.sql'));
  for (const who of [MINE, THEIRS]) {
    db.prepare('INSERT INTO users (id, role, founder_id, name) VALUES (?, ?, ?, ?)').run(who.user, 'founder', who.founder_id, `Founder ${who.user}`);
    db.prepare('INSERT INTO founders (id, name) VALUES (?, ?)').run(who.founder_id, `Founder ${who.user}`);
    db.prepare('INSERT INTO projects (id, uid, name, founder_id) VALUES (?, ?, ?, ?)').run(who.project, `p${who.project}`, `Startup ${who.project}`, who.founder_id);
  }
  return db;
}

function addContact(db: InstanceType<typeof DatabaseSync>, uid: string, project: number, name: string, extra: Record<string, unknown> = {}) {
  const cols = ['uid', 'project_id', 'audience', 'email', 'name', ...Object.keys(extra)];
  const vals = [uid, project, 'investor', `${uid}@example.test`, name, ...Object.values(extra)];
  db.prepare(`INSERT INTO contacts (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...(vals as any[]));
  return (db.prepare('SELECT id FROM contacts WHERE uid = ?').get(uid) as any).id as number;
}

async function token(userId: number, role = 'founder') {
  return new SignJWT({ user_id: userId, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(db: any, who: { user: number }, method: string, path: string, body?: unknown, log: string[] = []) {
  const res = await contacts.request(path, {
    method,
    headers: { Authorization: `Bearer ${await token(who.user)}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db, log) } as any);
  return { status: res.status, body: await res.json() as any };
}

// ---------------------------------------------------------------------------
// Migration 386
// ---------------------------------------------------------------------------

test('migration 386 adds strength (the canvas set, or NULL) and organization to a migrated contacts table', () => {
  const db = freshDb();
  const cols = (db.prepare('PRAGMA table_info(contacts)').all() as any[]).map((c) => c.name);
  assert.ok(cols.includes('strength') && cols.includes('organization'));
  const id = addContact(db, 'c1', MINE.project, 'Ana');
  assert.equal((db.prepare('SELECT strength FROM contacts WHERE id = ?').get(id) as any).strength, null, 'unset is NULL, never cool');
  for (const s of ['strong', 'warm', 'cool']) db.prepare('UPDATE contacts SET strength = ? WHERE id = ?').run(s, id);
  assert.throws(() => db.prepare('UPDATE contacts SET strength = ? WHERE id = ?').run('hot', id), /CHECK/);
});

// ---------------------------------------------------------------------------
// PUT /api/contacts/:uid
// ---------------------------------------------------------------------------

test('the owner sets, keeps and clears strength and organisation', async () => {
  const db = freshDb();
  addContact(db, 'c1', MINE.project, 'Ana');
  const set = await call(db, MINE, 'PUT', '/c1', { strength: 'Warm', organization: '  Latitude Seed  ' });
  assert.equal(set.status, 200);
  assert.deepEqual([set.body.strength, set.body.organization], ['warm', 'Latitude Seed']);
  const kept = await call(db, MINE, 'PUT', '/c1', { status: 'contacted' });
  assert.deepEqual([kept.body.strength, kept.body.organization, kept.body.status], ['warm', 'Latitude Seed', 'contacted'], 'an absent key keeps the value');
  const cleared = await call(db, MINE, 'PUT', '/c1', { strength: null, organization: '' });
  assert.deepEqual([cleared.body.strength, cleared.body.organization], [null, null]);
});

test('a strength outside the set is refused with a field, and nothing is written', async () => {
  const db = freshDb();
  addContact(db, 'c1', MINE.project, 'Ana', { strength: 'cool', organization: 'Kestrel' });
  const bad = await call(db, MINE, 'PUT', '/c1', { strength: 'hot', organization: 'Changed' });
  assert.deepEqual([bad.status, bad.body.field, bad.body.code], [400, 'strength', 'strength_invalid']);
  const row = db.prepare('SELECT strength, organization FROM contacts WHERE uid = ?').get('c1') as any;
  assert.deepEqual([row.strength, row.organization], ['cool', 'Kestrel']);
});

test("another founder's contact is refused, and stays as it was", async () => {
  const db = freshDb();
  addContact(db, 'theirs', THEIRS.project, 'Bo', { strength: 'strong', organization: 'Thornbury' });
  const r = await call(db, MINE, 'PUT', '/theirs', { strength: 'cool', organization: 'Mine now' });
  assert.equal(r.status, 403);
  const row = db.prepare('SELECT strength, organization FROM contacts WHERE uid = ?').get('theirs') as any;
  assert.deepEqual([row.strength, row.organization], ['strong', 'Thornbury']);
});

test('contactProfilePatch: absent keeps, null and blank clear, case and spaces are forgiven, 200 characters at most', () => {
  const row = { strength: 'warm', organization: 'Verwood' };
  assert.deepEqual(contactProfilePatch({}, row), { strength: 'warm', organization: 'Verwood' });
  assert.deepEqual(contactProfilePatch({ strength: ' STRONG ' }, row), { strength: 'strong', organization: 'Verwood' });
  assert.deepEqual(contactProfilePatch({ strength: '', organization: null }, row), { strength: null, organization: null });
  assert.equal((contactProfilePatch({ organization: 'x'.repeat(300) }, row) as any).organization.length, 200);
  assert.deepEqual(contactProfilePatch({ strength: 'cold' }, row), { error: 'strength_invalid' });
});

// ---------------------------------------------------------------------------
// GET /api/contacts — the follow-up rollup
// ---------------------------------------------------------------------------

function seedRollup(db: InstanceType<typeof DatabaseSync>, extra = 0) {
  const a = addContact(db, 'a', MINE.project, 'Ana');
  const b = addContact(db, 'b', MINE.project, 'Bo');
  addContact(db, 'c', MINE.project, 'Cy');
  for (let k = 0; k < extra; k++) addContact(db, `x${k}`, MINE.project, `Extra ${k}`);
  const t = db.prepare('INSERT INTO contact_tasks (contact_id, title, due_date, done) VALUES (?, ?, ?, ?)');
  t.run(a, 'Send deck', '2026-11-03', 0);
  t.run(a, 'Book call', '2026-10-20', 0);
  t.run(a, 'Old one', '2026-01-01', 1);       // done: neither the next due nor counted
  t.run(a, 'Someday', null, 0);               // open, no due date: counted, never the next due
  t.run(b, 'Follow up', '', 0);
  const r = db.prepare('INSERT INTO contact_replies (contact_id, direction, body, created_at) VALUES (?, ?, ?, ?)');
  r.run(a, 'inbound', 'first', '2026-08-01 09:00:00');
  r.run(a, 'outbound', 'second', '2026-09-15 10:00:00');
  return { a, b };
}

test('each contact carries its next open due date, its open task count and its last reply', async () => {
  const db = freshDb();
  seedRollup(db);
  const items = (await call(db, MINE, 'GET', '/')).body.items;
  const by = Object.fromEntries(items.map((i: any) => [i.uid, i]));
  assert.deepEqual([by.a.next_task_due, by.a.open_tasks, by.a.last_reply_at], ['2026-10-20', 3, '2026-09-15 10:00:00']);
  assert.deepEqual([by.b.next_task_due, by.b.open_tasks, by.b.last_reply_at], [null, 1, null], 'a blank due date is not a date');
  assert.deepEqual([by.c.next_task_due, by.c.open_tasks, by.c.last_reply_at], [null, 0, null]);
});

test('the rollup is one statement, however many contacts there are', async () => {
  const counts: number[] = [];
  for (const extra of [0, 12]) {
    const db = freshDb();
    seedRollup(db, extra);
    const log: string[] = [];
    const r = await call(db, MINE, 'GET', '/', undefined, log);
    assert.equal(r.body.items.length, 3 + extra);
    // Reads only: the schema bootstrap's CREATE statements name the tables too.
    const selects = log.filter((sql) => /^\s*SELECT/i.test(sql));
    const reads = selects.filter((sql) => /contact_tasks|contact_replies/.test(sql));
    assert.equal(reads.length, 1, `the rollup took ${reads.length} statements for ${3 + extra} contacts`);
    counts.push(selects.length);
  }
  assert.equal(counts[0], counts[1], 'more contacts made more statements');
});

// ---------------------------------------------------------------------------
// The founder Network draft surfaces
// ---------------------------------------------------------------------------

async function draft(db: any, who: { user: number }, surface: string, scopeKey?: string) {
  let prompt: string | null = null;
  const AI = {
    run: async (_m: string, payload: any) => {
      const messages = payload?.messages || [];
      prompt = String(messages[messages.length - 1]?.content ?? '');
      return { response: 'a drafted paragraph' };
    },
  };
  const res = await research.fetch(new Request('http://x/drafts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token(who.user)}`, 'content-type': 'application/json' },
    body: JSON.stringify({ surface, ...(scopeKey === undefined ? {} : { scope_key: scopeKey }) }),
  }), { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db), AI } as any);
  return { status: res.status, prompt: prompt as string | null };
}

function seedCold(db: InstanceType<typeof DatabaseSync>) {
  const cold = addContact(db, 'cold', MINE.project, 'Marisol Mine', { organization: 'Thornbury', strength: 'strong', last_activity_at: daysAgo(71) });
  addContact(db, 'colder', MINE.project, 'Older Mine', { last_activity_at: daysAgo(90) });
  addContact(db, 'warm', MINE.project, 'Dev Recent', { last_activity_at: daysAgo(4) });
  addContact(db, 'theirs', THEIRS.project, 'Theirs Cold', { last_activity_at: daysAgo(80) });
  db.prepare('INSERT INTO contact_replies (contact_id, direction, body, created_at) VALUES (?, ?, ?, ?)')
    .run(cold, 'inbound', 'Can you share your retention data?', '2026-06-10 09:00:00');
  // The founder's own later note is not what the contact wrote.
  db.prepare('INSERT INTO contact_replies (contact_id, direction, body, created_at) VALUES (?, ?, ?, ?)')
    .run(cold, 'outbound', 'Our own follow-up text', '2026-06-20 09:00:00');
}

test('network/re-engagement drafts over the caller\'s own cold contacts, coldest first, with what they last wrote', async () => {
  const db = freshDb();
  seedCold(db);
  const { status, prompt } = await draft(db, MINE, 'network/re-engagement', String(MINE.project));
  assert.equal(status, 201);
  const p = String(prompt);
  assert.ok(p.indexOf('Older Mine') < p.indexOf('Marisol Mine'), 'coldest first');
  assert.match(p, /Marisol Mine \(investor\) at Thornbury — strength strong, 71 days/);
  assert.match(p, /the last thing they wrote: "Can you share your retention data\?"/);
  assert.match(p, /Older Mine .* no reply of theirs is logged/);
  assert.doesNotMatch(p, /Our own follow-up text/, "the founder's own outbound note is not what they wrote");
  assert.doesNotMatch(p, /Dev Recent/, 'a contact touched four days ago is not going cold');
  assert.doesNotMatch(p, /Theirs Cold/, "another founder's contact reached the model");
  assert.doesNotMatch(p, /@example\.test/, 'an email address reached the model');
});

test('network/re-engagement refuses another founder\'s project, and a project with nobody going cold', async () => {
  const db = freshDb();
  seedCold(db);
  const theirs = await draft(db, MINE, 'network/re-engagement', String(THEIRS.project));
  assert.deepEqual([theirs.status, theirs.prompt], [409, null]);
  const empty = freshDb();
  addContact(empty, 'warm', MINE.project, 'Dev Recent', { last_activity_at: daysAgo(4) });
  assert.equal((await draft(empty, MINE, 'network/re-engagement', String(MINE.project))).status, 409);
});

function seedIntros(db: InstanceType<typeof DatabaseSync>) {
  db.prepare('INSERT INTO users (id, role, name) VALUES (?, ?, ?)').run(80, 'investor', 'Dev Raman');
  db.prepare('INSERT INTO users (id, role, name) VALUES (?, ?, ?)').run(81, 'advisor', 'Pending Person');
  const ins = db.prepare(`INSERT INTO intro_propositions (uid, user_id, target_user_id, status, breakdown_json, responded_at)
                          VALUES (?, ?, ?, ?, ?, ?)`);
  ins.run('mine-accepted', MINE.user, 80, 'accepted', JSON.stringify({ reasons: ['His fund writes a developer-tooling thesis'] }), '2026-09-30');
  ins.run('mine-pending', MINE.user, 81, 'pending', JSON.stringify({ reasons: ['Not yet'] }), null);
  ins.run('theirs-accepted', THEIRS.user, 81, 'accepted', JSON.stringify({ reasons: ['Their reason'] }), '2026-09-29');
}

test('network/intro-email drafts from the caller\'s own accepted propositions and their recorded reasons', async () => {
  const db = freshDb();
  seedIntros(db);
  const { status, prompt } = await draft(db, MINE, 'network/intro-email');
  assert.equal(status, 201);
  assert.match(String(prompt), /Introduction to Dev Raman — recorded reasons: His fund writes a developer-tooling thesis/);
  assert.doesNotMatch(String(prompt), /Pending Person|Their reason/);
  assert.equal((await draft(db, MINE, 'network/intro-email', 'mine-accepted')).status, 201);
  assert.equal((await draft(db, MINE, 'network/intro-email', 'theirs-accepted')).status, 409, "another founder's proposition");
  assert.equal((await draft(db, MINE, 'network/intro-email', 'mine-pending')).status, 409, 'a pending proposition is not in motion');
});
