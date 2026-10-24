/**
 * D990 (#2801) — Partner profiles part 1, through the real
 * `admin_partner_profiles.ts` routes on `node:sqlite` (the baseline's
 * `partner_profiles`, then migrations 275 and 556 from their files).
 *
 *   1. Migration 556 gives every row a reference, and its trigger gives one to
 *      each writer's insert; never an email, never two alike.
 *   2. The list: rows waiting longest first, Drafts not waiting, totals over
 *      the filtered set, each row's derived source, account and identity check.
 *   3. Every filter, the sorts and the pages; part 2's filter and sort refused.
 *   4. The list read and the by-reference read are logged by reference, never
 *      by email; `ein` stays masked.
 *   5. The counts: waiting and its bands without Drafts, the weekly series, and
 *      the blocks parts 2 and 4 fill reading "not available", never zero.
 *   6. Approvals lane 7 leaves Drafts out.
 *   7. Refusals: no session 401, a member 403, a D1 error 503 (never `[]`).
 *
 * Every person and line is synthetic.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/partner_profiles_list_d990.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import partnerProfiles from '../src/routes/admin_partner_profiles.ts';
import { PROFILE_REF, WEEKS, partnerProfileCounts } from '../src/services/partnerProfiles.ts';
import { APPROVAL_SOURCES } from '../src/services/approvalSources.ts';
import { tableFromBaseline } from './_baseline.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 900, CHATTER = 901, PARTNER = 902, NAMEONLY = 903, VERIFIED = 904;
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const MIGRATION_275 = read('cloudflare-worker/sql/migrations/275_partner_profiles_columns.sql');
const MIGRATION_556 = read('cloudflare-worker/sql/migrations/556_partner_profiles_ref.sql');

function makeD1(db: InstanceType<typeof DatabaseSync>) {
  const stmt = (sql: string) => {
    let b: any[] = [];
    const api: any = {
      bind: (...x: any[]) => { b = x.map((v) => (v === undefined ? null : v)); return api; },
      async first() { return db.prepare(sql).get(...b) ?? null; },
      async all() { return { results: db.prepare(sql).all(...b) }; },
      async run() {
        const r = db.prepare(sql).run(...b);
        return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
      },
    };
    return api;
  };
  return {
    prepare: stmt,
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const out = []; for (const s of x) out.push(await s.run()); return out; },
  };
}

const NOW = Date.now();
const ago = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString().slice(0, 19).replace('T', ' ');

/** Six profiles, one per shape the three writers leave, inserted before 556 like production's. */
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'partner_profiles', 'user_role_review', 'activity_logs']) db.exec(tableFromBaseline(BASELINE, t));
  db.exec(MIGRATION_275);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, kyc_status) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(ADMIN, 'admin', 'Ada Admin', 'ada@example.test', 'approved');
  u.run(CHATTER, 'exploring', 'Cleo Chat', 'chat@example.test', 'pending');
  u.run(PARTNER, 'partner', 'Ed Eadwyn', 'eadwyn@example.test', 'approved');
  u.run(NAMEONLY, 'partner', 'Nia Name', 'draft@example.test', null);
  u.run(VERIFIED, 'investor', 'Val Verified', 'done@example.test', 'rejected');
  db.prepare("INSERT INTO user_role_review (user_id, suggested_role, role_confirmed) VALUES (?, 'founder', 0)").run(CHATTER);
  const p = (cols: Record<string, unknown>) => {
    const keys = Object.keys(cols);
    db.prepare(`INSERT INTO partner_profiles (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...(Object.values(cols) as any[]));
  };
  // The onboarding chat: a transcript, the chat's answers, an account.
  p({ email: 'chat@example.test', user_id: CHATTER, chat_history: '[{"role":"user","content":"hi"}]', persona: 'Founder',
    founder_track: 'Spin-Out (New)', entity_type: 'LLC', legal_entity_name: 'Chat Labs LLC', ein: '12-3456789',
    admin_status: 'pending', created_at: ago(120) });
  // A partner invitation: the form's answers, no account.
  p({ email: 'inv@example.test', invitation_id: 7, full_name: 'Iris Invited', organization: 'Invited 50% Co', role_title: 'Partner',
    motivation: 'Deals', admin_status: 'pending', created_at: ago(2) });
  // Eadwyn's partner questions: an answer only Eadwyn writes.
  p({ email: 'eadwyn@example.test', user_id: PARTNER, full_name: 'Ed Eadwyn', services_offered: 'Legal',
    admin_status: 'pending', created_at: ago(48) });
  // Eadwyn's name-only row: no chat, no answers — a Draft, though the oldest.
  p({ email: 'draft@example.test', user_id: NAMEONLY, full_name: 'Nia Name', admin_status: 'pending', created_at: ago(240) });
  // Verified through the chat, with an agreement.
  p({ email: 'done@example.test', user_id: VERIFIED, chat_history: '[{"role":"user"}]', persona: 'Investor — LP',
    agreement_type: 'LP Agreement', admin_status: 'verified', created_at: ago(24 * 40) });
  // All three sources at once, rejected, no account.
  p({ email: 'both@example.test', invitation_id: 8, chat_history: '[{"role":"user"}]', services_offered: 'Tax',
    full_name: 'Bo Both', admin_status: 'rejected', created_at: ago(24 * 20) });
  db.exec(MIGRATION_556);
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) };
  return { db, env };
}

async function token(who: number, role: string) {
  return new SignJWT({ user_id: who, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

/** index.ts maps requireAuth's and requireAdmin's refusals to 401 and 403; the mount here does the same. */
const APP = new Hono<any>().route('/', partnerProfiles);
APP.onError((err: any, c: any) => {
  const m = String(err?.message || '');
  return c.json({ error: m }, m === 'Unauthorized' ? 401 : m === 'Admin required' ? 403 : 500);
});

async function call(f: any, path: string, who: [number, string] | null = [ADMIN, 'admin']) {
  const headers: Record<string, string> = {};
  if (who) headers.Authorization = `Bearer ${await token(...who)}`;
  const res = await APP.fetch(new Request(`http://x${path}`, { headers }), f.env);
  let body: any = null;
  try { body = await res.json(); } catch { /* status says it */ }
  return { status: res.status, body };
}

const emails = (r: any) => r.body.rows.map((x: any) => x.email);
const refOf = (f: any, email: string) => (f.db.prepare('SELECT ref FROM partner_profiles WHERE email = ?').get(email) as any).ref;
const logs = (f: any) => f.db.prepare('SELECT action, details FROM activity_logs ORDER BY id').all() as any[];
const quiet = async <T>(fn: () => Promise<T>) => { const s = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = s; } };

// ── 1. the reference ─────────────────────────────────────────────────────────

test('migration 556 gives every row a reference, and every writer\'s insert gets one: random, unique, never the email', () => {
  // Mutations checked: the backfill dropped; the trigger dropped; the ref built from the email.
  const f = fixture();
  const before = f.db.prepare('SELECT email, ref FROM partner_profiles').all() as any[];
  assert.equal(before.length, 6);
  for (const r of before) {
    assert.match(String(r.ref), PROFILE_REF, `${r.email} has no reference`);
    assert.ok(!String(r.ref).includes(r.email.split('@')[0]), 'the reference carries the email');
  }
  assert.equal(new Set(before.map((r) => r.ref)).size, 6, 'two profiles share a reference');
  // The three writers' own inserts, as they write them (no ref named).
  f.db.prepare("INSERT INTO partner_profiles (email, user_id, persona, chat_history) VALUES ('w1@example.test', 1, 'Founder', '[]')").run();
  f.db.prepare("INSERT INTO partner_profiles (email, invitation_id, full_name, raw_chat_json) VALUES ('w2@example.test', 9, 'W', '{}')").run();
  f.db.prepare("INSERT INTO partner_profiles (email, user_id, full_name) VALUES ('w3@example.test', 3, 'W') ON CONFLICT(email) DO UPDATE SET full_name = excluded.full_name").run();
  const added = f.db.prepare("SELECT ref FROM partner_profiles WHERE email LIKE 'w_@example.test'").all() as any[];
  assert.equal(added.length, 3);
  for (const r of added) assert.match(String(r.ref), PROFILE_REF, 'an insert went without a reference');
  // An update keeps the reference; a duplicate is refused.
  const ref = refOf(f, 'w3@example.test');
  f.db.prepare("INSERT INTO partner_profiles (email, full_name) VALUES ('w3@example.test', 'W2') ON CONFLICT(email) DO UPDATE SET full_name = excluded.full_name").run();
  assert.equal(refOf(f, 'w3@example.test'), ref, 'an upsert changed the reference');
  assert.throws(() => f.db.prepare('INSERT INTO partner_profiles (email, ref) VALUES (?, ?)').run('dup@example.test', ref), /UNIQUE/);
});

// ── 2. the list ──────────────────────────────────────────────────────────────

test('the list puts the longest-waiting first, reads a Draft as not waiting, and totals the filtered set', async () => {
  // Mutations checked: Draft predicate dropped (the name-only row waits first); waiting sort reversed.
  const f = fixture();
  const r = await call(f, '/');
  assert.equal(r.status, 200);
  assert.deepEqual(emails(r).slice(0, 3), ['chat@example.test', 'eadwyn@example.test', 'inv@example.test']);
  assert.deepEqual(r.body.totals, { total: 6, draft: 1, pending: 3, verified: 1, rejected: 1, not_recorded: 0 });
  const draft = r.body.rows.find((x: any) => x.email === 'draft@example.test');
  assert.equal(draft.status, 'draft');
  assert.equal(draft.admin_status, 'pending');
  assert.deepEqual(draft.sources, [], 'a name-only row has no source by the rule');
  assert.deepEqual(r.body.options.category, ['Founder', 'Investor — LP']);
  assert.deepEqual(r.body.options.agreement, ['LP Agreement']);
});

test('each row carries its reference, date, ids, names, derived source, account and identity check in KYC & KYB\'s words', async () => {
  // Mutations checked: invitation source dropped; the shared columns marking an invited row Eadwyn; exploring misread.
  const f = fixture();
  const rows = new Map((await call(f, '/')).body.rows.map((x: any) => [x.email, x]));
  const chat: any = rows.get('chat@example.test');
  assert.match(chat.ref, PROFILE_REF);
  assert.equal(chat.created_at, ago(120));
  assert.equal(chat.user_id, CHATTER);
  assert.deepEqual(chat.sources, ['chat']);
  assert.deepEqual(chat.account, { user_id: CHATTER, name: 'Cleo Chat', role: 'exploring', exploring: true, suggested_role: 'founder', assigned_role: null, assigned_at: null });
  assert.deepEqual(chat.identity_check, { state: 'pending', label: 'Pending' });
  assert.equal('ein' in chat, false, 'the list carries the tax ID');
  const inv: any = rows.get('inv@example.test');
  assert.deepEqual(inv.sources, ['invitation'], 'the invitation form\'s columns read as Eadwyn');
  assert.equal(inv.invitation_id, 7);
  assert.equal(inv.full_name, 'Iris Invited');
  assert.equal(inv.organization, 'Invited 50% Co');
  assert.equal(inv.account, null);
  assert.equal(inv.identity_check, null, 'no account reads as nothing recorded, not "Not started"');
  assert.deepEqual((rows.get('eadwyn@example.test') as any).sources, ['eadwyn']);
  assert.deepEqual((rows.get('eadwyn@example.test') as any).identity_check, { state: 'approved', label: 'Approved' });
  assert.deepEqual((rows.get('both@example.test') as any).sources, ['invitation', 'chat', 'eadwyn']);
  assert.deepEqual((rows.get('draft@example.test') as any).identity_check, { state: 'not_started', label: 'Not started' });
});

// ── 3. filters, sorts, pages ─────────────────────────────────────────────────

test('every filter narrows the list, and the totals follow it', async () => {
  // Mutations checked: search ignoring organization; the LIKE escape dropped ("50%" matches everything); has_account inverted.
  const f = fixture();
  const set = async (qs: string) => (await call(f, '/?' + qs)).body;
  const by = async (qs: string) => (await set(qs)).rows.map((x: any) => x.email).sort();
  assert.deepEqual(await by('q=cleo'), ['chat@example.test'], 'search by account name');
  assert.deepEqual(await by('q=IRIS'), ['inv@example.test'], 'search by full name, any case');
  assert.deepEqual(await by('q=chat%20labs'), ['chat@example.test'], 'search by entity');
  assert.deepEqual(await by('q=50%25'), ['inv@example.test'], 'a % in the search is a literal');
  assert.deepEqual(await by('q=%25'), ['inv@example.test'], 'a bare % matched every row');
  assert.deepEqual(await by('q=_'), [], 'a bare _ matched every row');
  assert.deepEqual(await by('q=both%40'), ['both@example.test'], 'search by email');
  assert.deepEqual(await by('status=draft'), ['draft@example.test']);
  assert.deepEqual(await by('status=pending'), ['chat@example.test', 'eadwyn@example.test', 'inv@example.test']);
  assert.deepEqual(await by('source=invitation'), ['both@example.test', 'inv@example.test']);
  assert.deepEqual(await by('source=chat'), ['both@example.test', 'chat@example.test', 'done@example.test']);
  assert.deepEqual(await by('source=eadwyn'), ['both@example.test', 'eadwyn@example.test']);
  assert.deepEqual(await by('source=none'), ['draft@example.test']);
  assert.deepEqual(await by('category=Founder'), ['chat@example.test']);
  assert.deepEqual(await by('founder_track=Spin-Out%20(New)'), ['chat@example.test']);
  assert.deepEqual(await by('entity_type=LLC'), ['chat@example.test']);
  assert.deepEqual(await by('agreement=LP%20Agreement'), ['done@example.test']);
  assert.equal((await set('agreement=not_recorded')).totals.total, 5);
  assert.deepEqual(await by('has_account=no'), ['both@example.test', 'inv@example.test']);
  assert.equal((await set('has_account=yes')).totals.total, 4);
  assert.deepEqual(await by('identity=pending'), ['chat@example.test']);
  assert.deepEqual(await by('identity=not_started'), ['draft@example.test']);
  assert.deepEqual(await by('identity=no_account'), ['both@example.test', 'inv@example.test']);
  assert.deepEqual(await by(`captured_from=${ago(24 * 6).slice(0, 10)}`), ['chat@example.test', 'eadwyn@example.test', 'inv@example.test']);
  assert.deepEqual(await by(`captured_to=${ago(24 * 30).slice(0, 10)}`), ['done@example.test']);
  const t = await set('source=chat');
  assert.deepEqual(t.totals, { total: 3, draft: 0, pending: 1, verified: 1, rejected: 1, not_recorded: 0 });
});

test('the sorts and the pages, and what waits for part 2 is refused rather than faked', async () => {
  // Mutations checked: OFFSET ignored; newest sort ascending.
  const f = fixture();
  assert.deepEqual(emails(await call(f, '/?sort=newest')).slice(0, 2), ['inv@example.test', 'eadwyn@example.test']);
  assert.deepEqual(emails(await call(f, '/?sort=name')), [
    'both@example.test', 'chat@example.test', 'eadwyn@example.test', 'inv@example.test', 'draft@example.test', 'done@example.test',
  ]);
  const p2 = await call(f, '/?sort=newest&page_size=2&page=2');
  assert.deepEqual(emails(p2), ['chat@example.test', 'draft@example.test']);
  assert.equal(p2.body.page, 2);
  assert.equal(p2.body.page_size, 2);
  assert.equal(p2.body.totals.total, 6, 'totals are over the filtered set, not the page');
  assert.equal((await call(f, '/?page_size=5000')).body.page_size, 100);
  for (const [qs, code] of [['reviewed_by=1', 'not_recorded'], ['sort=reviewed', 'not_recorded'], ['sort=random', 'bad_sort'],
    ['status=approved', 'bad_filter'], ['source=email', 'bad_filter'], ['has_account=maybe', 'bad_filter'],
    ['identity=x', 'bad_filter'], ['captured_from=yesterday', 'bad_filter']]) {
    const r = await call(f, '/?' + qs);
    assert.equal(r.status, 400, qs);
    assert.equal(r.body.error, code, qs);
  }
});

// ── 4. the logs ──────────────────────────────────────────────────────────────

test('the list read and the by-reference read are logged by reference, never by email, and the tax ID stays masked', async () => {
  // Mutations checked: the list log dropped; the profile log naming the email.
  const f = fixture();
  await call(f, '/?page_size=2');
  const ref = refOf(f, 'chat@example.test');
  const one = await call(f, '/' + ref);
  assert.equal(one.status, 200);
  assert.equal(one.body.ref, ref);
  assert.equal(one.body.ein, undefined, 'the tax ID left in clear');
  assert.ok(one.body.masked.ein, 'the masked tax ID is missing');
  assert.deepEqual(one.body.listed.sources, ['chat']);
  assert.equal(one.body.listed.status, 'pending');
  const lines = logs(f);
  assert.deepEqual(lines.map((l) => l.action), ['partner_profile_list_access', 'partner_profile_access']);
  assert.equal(lines[0].details, 'Partner profile list read count=2 total=6 page=1');
  assert.equal(lines[1].details, `Admin read partner profile ref=${ref} user_id=${CHATTER}`);
  for (const l of lines) assert.ok(!String(l.details).includes('@'), `a log line carries an email: ${l.details}`);
  const noAccount = await call(f, '/' + refOf(f, 'inv@example.test'));
  assert.equal(noAccount.status, 200);
  assert.match(logs(f).at(-1).details, /; no user account$/);
  assert.equal((await call(f, '/pp_0000000000')).status, 404);
  assert.equal((await call(f, '/chat%40example.test')).status, 404, 'an email is not an address');
  assert.equal(logs(f).length, 3, 'a refused read was logged as a read');
});

// ── 5. the counts ────────────────────────────────────────────────────────────

test('the counts: waiting and its bands leave Drafts out, the weekly series counts captures, and what later parts fill says so', async () => {
  // Mutations checked: Drafts counted as waiting; the 72h band read as 24h; verified faked as zero.
  const f = fixture();
  const r = await call(f, '/counts');
  assert.equal(r.status, 200);
  assert.deepEqual({ ...r.body.waiting, oldest_at: undefined }, {
    available: true, reason: null, count: 3, over_24h: 2, over_72h: 1, oldest_at: undefined, drafts: 1,
  });
  assert.equal(r.body.waiting.oldest_at, ago(120));
  assert.deepEqual(r.body.verified_30d, { available: false, reason: 'Verification and rejection dates are recorded from Partner profiles part 2.', count: null });
  assert.equal(r.body.envelopes_out.available, false);
  assert.equal(r.body.envelopes_out.count, null);
  const weeks = r.body.weekly.weeks;
  assert.equal(weeks.length, WEEKS);
  assert.equal(weeks.reduce((s: number, w: any) => s + w.captured, 0), 5, 'the Draft was counted as captured, or a capture was lost');
  assert.ok(weeks.every((w: any) => w.verified === null && w.rejected === null), 'part 2\'s figures read as numbers');
  assert.equal(r.body.weekly.verified_available, false);
  assert.ok(weeks.every((w: any) => new Date(w.week_start + 'T00:00:00Z').getUTCDay() === 1), 'a week does not start on Monday');
  assert.ok(weeks.at(-1).captured >= 1, 'this week\'s capture is missing');
  // An unreadable store costs its block, not the others, and never reads as zero.
  const broken: any = { DB: { prepare: () => { throw new Error('D1_ERROR: no such table'); } } };
  const b = await partnerProfileCounts(broken);
  assert.equal(b.waiting.available, false);
  assert.equal(b.waiting.count, null);
  assert.equal(b.weekly.available, false);
});

// ── 6. Approvals lane 7 ──────────────────────────────────────────────────────

test('Approvals lane 7 counts and lists what is waiting, Drafts left out', () => {
  // Mutation checked: lane 7 back on `admin_status = 'pending'` alone (counts 4).
  const f = fixture();
  const lane = APPROVAL_SOURCES.find((s) => s.key === 'partner_profiles')!;
  const c = f.db.prepare(lane.countSql).get() as any;
  assert.equal(c.n, 3);
  assert.equal(c.oldest, ago(120));
  const rows = f.db.prepare(lane.rowsSql).all(10) as any[];
  assert.equal(rows.length, 3);
  assert.ok(!rows.some((x) => x.who === 'draft@example.test'), 'a Draft is on the board');
});

// ── 7. refusals ──────────────────────────────────────────────────────────────

test('every route refuses no session and a member, and a D1 error is a 503, never an empty list', async () => {
  // Mutation checked: the list's catch answering `[]`.
  const f = fixture();
  const ref = refOf(f, 'chat@example.test');
  for (const path of ['/', '/counts', '/' + ref]) {
    assert.equal((await call(f, path, null)).status, 401, path);
    assert.equal((await call(f, path, [CHATTER, 'exploring'])).status, 403, path);
  }
  assert.equal(logs(f).length, 0, 'a refused read was logged');
  const db = f.env.DB;
  // A database whose profile reads fail (the session's own reads still work).
  f.env.DB = { ...db, prepare: (sql: string) => (/partner_profiles/.test(sql) ? { bind: () => { throw new Error('D1_ERROR'); }, first: () => { throw new Error('D1_ERROR'); }, all: () => { throw new Error('D1_ERROR'); } } : db.prepare(sql)) };
  const list = await quiet(() => call(f, '/'));
  assert.equal(list.status, 503);
  assert.equal(list.body.error, 'partner_profiles_unreadable');
  assert.equal((await quiet(() => call(f, '/' + ref))).status, 503);
});
