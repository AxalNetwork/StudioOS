/**
 * D1301 (#3397) — GET /api/admin/accounts/overview: Admin › Accounts' overview,
 * counted as Insights counts.
 *
 * On node:sqlite with the tables cut from `schema_baseline.sql` (and
 * `legal_acceptances` from migration 245, which the baseline does not hold).
 * The read runs on a fixed clock (a Wednesday), so every figure below is
 * worked out by hand from the ten accounts in `seeded()`.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/admin_accounts_overview_d1301.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import overviewRoute, {
  accountsOverview, OPEN_LP, PROFILES, PRODUCT_TESTERS_REASON, ROW_LIMIT, SIGNUP_WEEKS,
} from '../src/routes/admin_accounts_overview.ts';
import { adminInsights } from '../src/services/adminInsights.ts';
import { HQ_SCOPE_LABEL } from '../src/services/studioGlance.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const NOW = Date.parse('2026-10-21T12:00:00Z'); // a Wednesday; this week is 2026-10-19
const DAY = 86_400_000;
const at = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
function ddl(name: string): string {
  const i = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(i >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(i, BASELINE.indexOf(');', i) + 2);
}
const LEGAL = (() => {
  const m = read('cloudflare-worker/sql/migrations/245_legal_acceptances.sql');
  const i = m.indexOf('CREATE TABLE IF NOT EXISTS legal_acceptances');
  return m.slice(i, m.indexOf(');', i) + 2);
})();

function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = x.map((v) => (v === undefined ? null : v)); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() { const r = db.prepare(sql).run(...b); return { meta: { changes: Number(r.changes) } }; },
      };
      return api;
    },
    async batch(x: any[]) { const out = []; for (const st of x || []) out.push(await st.run()); return out; },
  };
}

const TABLES = ['users', 'super_admins', 'user_sessions', 'activity_logs', 'lp_applications', 'tickets', 'ai_usage_logs',
  'esign_envelopes', 'user_role_review'];
/** Insights' funnel reads these too; where the baseline lacks one, that step fails alone there (D893). */
const INSIGHTS_ONLY = ['company_invitations', 'project_member_invitations', 'partner_invitations', 'branch_invitations'];

/**
 * Ten accounts, synthetic names and example.test addresses.
 *   1 Ada  admin    verified, identity approved, 100%, seen yesterday
 *   2 Fay  founder  unverified (1 day), identity waiting since 15 Oct, 80%, seen yesterday, Terms accepted
 *   3 Finn founder  unverified (20 days, overdue), 10%, last seen 40 days ago
 *   4 Ivy  investor verified, identity approved, 75%, never seen, Terms accepted, approved LP
 *   5 Gus  investor DEACTIVATED, approved LP (not counted)
 *   6 Xia  explorer verified, agreement not sent, seen 2 days ago
 *   7 Xan  explorer unverified (2 days), agreement sent, not signed, never seen
 *   8 Xev  explorer verified, agreement signed 18 Oct, seen 10 days ago
 *   9 Ari  advisor  verified, seen 5 days ago, Terms accepted, LP application pending since 5 Oct
 *  10 Ola  admin    unverified (today), identity waiting since 2 Oct, never seen
 */
function seeded() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of TABLES) db.exec(ddl(t));
  for (const t of INSIGHTS_ONLY) {
    try { db.exec(ddl(t)); } catch { /* absent from the baseline */ }
  }
  db.exec(LEGAL);
  const u = db.prepare(`INSERT INTO users (id, role, name, email, is_active, email_verified, created_at, country,
                          kyc_status, kyc_submitted_at, profile_completion_pct, last_active_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  u.run(1, 'admin', 'Ada Sample', 'ada@example.test', 1, 1, '2026-01-01 09:00:00', 'Canada', 'approved', null, 100, at(NOW - DAY));
  u.run(2, 'founder', 'Fay Sample', 'fay@example.test', 1, 0, '2026-10-20 09:00:00', 'Kenya', 'pending', '2026-10-15 10:00:00', 80, at(NOW - DAY));
  u.run(3, 'founder', 'Finn Sample', 'finn@example.test', 1, 0, '2026-10-01 09:00:00', '', 'not_started', null, 10, at(NOW - 40 * DAY));
  u.run(4, 'investor', 'Ivy Sample', 'ivy@example.test', 1, 1, '2026-09-01 10:00:00', 'Portugal', 'approved', null, 75, null);
  u.run(5, 'investor', 'Gus Sample', 'gus@example.test', 0, 1, '2026-10-14 09:00:00', 'France', 'rejected', null, 0, at(NOW - 2 * DAY));
  u.run(6, 'exploring', 'Xia Sample', 'xia@example.test', 1, 1, '2026-10-10 09:00:00', 'Brazil', 'not_started', null, 20, at(NOW - 2 * DAY));
  u.run(7, 'exploring', 'Xan Sample', 'xan@example.test', 1, 0, '2026-10-19 09:00:00', 'Brazil', 'not_started', null, null, null);
  u.run(8, 'exploring', 'Xev Sample', 'xev@example.test', 1, 1, '2026-09-20 09:00:00', 'Brazil', 'not_started', null, 50, at(NOW - 10 * DAY));
  u.run(9, 'advisor', 'Ari Sample', 'ari@example.test', 1, 1, '2026-08-01 09:00:00', 'Netherlands', 'not_started', null, 60, at(NOW - 5 * DAY));
  u.run(10, 'admin', 'Ola Sample', 'ola@example.test', 1, 0, '2026-10-21 08:00:00', 'Canada', 'pending', '2026-10-02 08:00:00', 0, null);

  const env = db.prepare(`INSERT INTO esign_envelopes (id, envelope_uuid, user_id, document_type, document_title, document_body, body_sha256, status, created_by, completed_at)
                          VALUES (?, ?, ?, 'binding_agreement', 'Binding agreement', 'synthetic', 'synthetic-sha', ?, 1, ?)`);
  env.run(70, 'env-70', 7, 'sent', null);
  env.run(80, 'env-80', 8, 'completed', '2026-10-18 09:00:00');
  const rr = db.prepare('INSERT INTO user_role_review (user_id, binding_envelope_id) VALUES (?, ?)');
  rr.run(7, 70);
  rr.run(8, 80);

  const lp = db.prepare(`INSERT INTO lp_applications (user_id, investor_type, status, created_at) VALUES (?, 'individual', ?, ?)`);
  lp.run(4, 'approved', '2026-09-05 09:00:00');
  lp.run(5, 'approved', '2026-10-14 10:00:00'); // deactivated: not counted
  lp.run(9, 'pending', '2026-10-05 09:00:00');

  const tos = db.prepare(`INSERT INTO legal_acceptances (user_id, obligation_key, surface) VALUES (?, ?, 'onboarding')`);
  tos.run(2, 'tos_v1');
  tos.run(4, 'tos_v1');
  tos.run(9, 'tos_v1');
  tos.run(9, 'tos_v1'); // accepted twice: one account
  tos.run(3, 'privacy_v1'); // another obligation: not the Terms
  tos.run(5, 'tos_v1'); // deactivated: not counted
  return db;
}

const envOf = (db: InstanceType<typeof DatabaseSync>) => ({ DB: makeD1(db) }) as any;
const overview = (db = seeded(), includeAdmins = false) => accountsOverview(envOf(db), { nowMs: NOW, includeAdmins });

test('the four figures: accounts, active in 30 days, email not verified, waiting on you', async () => {
  const o: any = await overview();
  assert.deepEqual(o.kpis.accounts, { available: true, total: 9, new_30d: 5, deactivated: 1 });
  // Active, dormant and never seen make the whole: 5 + 1 + 3 = 9.
  assert.deepEqual(o.kpis.active_30d, { available: true, count: 5, of: 9, never_seen: 3, dormant: 1 });
  assert.deepEqual(o.kpis.unverified, { available: true, count: 4, overdue: 1, overdue_days: 7 });
  assert.equal(o.kpis.waiting.available, true);
  assert.equal(o.kpis.waiting.total, 2);
  assert.equal(o.kpis.waiting.explorers_ready, 1);
  assert.equal(o.kpis.waiting.lp_applications, 1);
  assert.deepEqual(o.kpis.waiting.tester_applications.recorded, false, 'testers wait on D1302, never a zero');
});

test('a widget per profile, in ACC1’s order, each with eight weeks of sign-ups (deactivated included, this week to date)', async () => {
  const o: any = await overview();
  assert.deepEqual(o.profiles.rows.map((r: any) => [r.profile, r.label, r.count, r.new_30d]), [
    ['founder', 'Founders', 2, 2],
    ['investor', 'Investors', 1, 0],
    ['advisor', 'Advisors', 1, 0],
    ['partner', 'Operating Partners', 0, 0],
    ['exploring', 'Explorers', 3, 2],
  ]);
  assert.equal(o.profiles.admins, 2);
  assert.equal(o.profiles.other, 2, 'the mix’s “other” is what the five widgets leave');
  assert.equal(o.weeks.length, SIGNUP_WEEKS);
  assert.equal(o.current_week, '2026-10-19');
  const weeks = (p: string) => Object.fromEntries(o.profiles.rows.find((r: any) => r.profile === p).weeks.filter((w: any) => w.count).map((w: any) => [w.week, w.count]));
  assert.deepEqual(weeks('founder'), { '2026-09-28': 1, '2026-10-19': 1 });
  assert.deepEqual(weeks('investor'), { '2026-08-31': 1, '2026-10-12': 1 }, 'a deactivated account was still a sign-up');
  assert.deepEqual(weeks('exploring'), { '2026-09-14': 1, '2026-10-05': 1, '2026-10-19': 1 });
  assert.equal(o.profiles.rows[0].weeks.at(-1).to_date, true);
});

test('LPs are approved LP applications of live accounts, by the account’s own profile; testers say why they have no figure', async () => {
  const o: any = await overview();
  assert.deepEqual(o.lps, { available: true, count: 1, by_profile: [{ profile: 'investor', count: 1 }], open_applications: 1 });
  assert.deepEqual(o.product_testers, { available: false, recorded: false, reason: PRODUCT_TESTERS_REASON });
});

test('readiness: each step over the live accounts, for all and for each profile', async () => {
  const o: any = await overview();
  assert.deepEqual(o.readiness.all, { total: 9, email_verified: 5, terms_accepted: 3, identity_approved: 2, profile_ready: 3, active_30d: 5 });
  const by = (p: string) => o.readiness.by_profile.find((r: any) => r.profile === p);
  assert.deepEqual(by('founder'), { profile: 'founder', total: 2, email_verified: 0, terms_accepted: 1, identity_approved: 0, profile_ready: 1, active_30d: 1 });
  assert.deepEqual(by('investor'), { profile: 'investor', total: 1, email_verified: 1, terms_accepted: 1, identity_approved: 1, profile_ready: 1, active_30d: 0 }, '75% is ready');
  assert.deepEqual(by('partner'), { profile: 'partner', total: 0, email_verified: 0, terms_accepted: 0, identity_approved: 0, profile_ready: 0, active_30d: 0 });
});

test('the Explorer split is the Exploring board’s: not sent, sent and not signed, signed and ready', async () => {
  const o: any = await overview();
  assert.deepEqual(o.explorers, { available: true, total: 3, not_sent: 1, sent_unsigned: 1, signed_ready: 1 });
  assert.equal(o.explorers.total, o.profiles.rows.find((r: any) => r.profile === 'exploring').count);
});

test('Newest and Needs attention name the account, never its email; another admin is listed to a Super Admin only', async () => {
  const plain: any = await overview(seeded(), false);
  assert.deepEqual(plain.newest.rows.map((r: any) => r.id), [2, 7, 6, 3, 8]);
  assert.deepEqual(plain.newest.rows[0], { id: 2, name: 'Fay Sample', profile: 'founder', country: 'Kenya', joined_at: '2026-10-20 09:00:00' });
  assert.equal(plain.newest.rows.find((r: any) => r.id === 3).country, null, 'a blank country is not a country');
  // Oldest wait first: Finn's email (1 Oct), Ari's LP application (5 Oct), Fay's identity (15 Oct), Xev's agreement (18 Oct).
  assert.deepEqual(plain.attention.rows.map((r: any) => [r.id, r.kind]), [[3, 'email_unverified'], [9, 'lp_application'], [2, 'identity_waiting'], [8, 'explorer_signed']]);
  assert.deepEqual(plain.attention.by_kind, {
    email_unverified: { available: true, count: 1 }, identity_waiting: { available: true, count: 1 },
    explorer_signed: { available: true, count: 1 }, lp_application: { available: true, count: 1 },
  });
  assert.equal(plain.attention.partial, false);
  assert.deepEqual(Object.keys(plain.attention.not_recorded), ['tester_application', 'limited_access']);

  const sup: any = await overview(seeded(), true);
  assert.deepEqual(sup.newest.rows.map((r: any) => r.id), [10, 2, 7, 6, 3]);
  assert.deepEqual(sup.attention.rows.map((r: any) => r.id), [3, 10, 9, 2, 8]);
  assert.equal(sup.attention.by_kind.identity_waiting.count, 2);
  for (const o of [plain, sup]) assert.doesNotMatch(JSON.stringify(o), /@example\.test/, 'an email left the read');
});

test('the lists stop at five, and a kind’s count is all of them, not the five shown', async () => {
  const db = seeded();
  const u = db.prepare(`INSERT INTO users (id, role, name, email, is_active, email_verified, created_at) VALUES (?, 'founder', ?, ?, 1, 0, ?)`);
  for (let i = 0; i < 7; i += 1) u.run(100 + i, `Extra ${i}`, `extra${i}@example.test`, `2026-09-0${i + 1} 09:00:00`);
  const o: any = await overview(db);
  assert.equal(o.newest.rows.length, ROW_LIMIT);
  assert.equal(o.attention.rows.length, ROW_LIMIT);
  assert.equal(o.attention.by_kind.email_unverified.count, 8);
  assert.deepEqual(o.attention.rows.map((r: any) => r.id), [100, 101, 102, 103, 104]);
});

test('edges: an agreement whose envelope is gone is sent, not twice counted; a wait with no start goes last; a declined LP application is not open', async () => {
  const db = seeded();
  const u = db.prepare(`INSERT INTO users (id, role, name, email, is_active, email_verified, created_at, kyc_status, kyc_submitted_at)
                        VALUES (?, ?, ?, ?, 1, 1, '2026-06-01 09:00:00', ?, ?)`);
  u.run(11, 'exploring', 'Yan Sample', 'yan@example.test', 'not_started', null);
  u.run(12, 'founder', 'Zed Sample', 'zed@example.test', 'pending', null);
  db.prepare('INSERT INTO user_role_review (user_id, binding_envelope_id) VALUES (?, ?)').run(11, 999); // no such envelope
  db.prepare(`INSERT INTO lp_applications (user_id, investor_type, status, created_at) VALUES (3, 'individual', 'declined', '2026-10-03 09:00:00')`).run();
  const o: any = await overview(db);
  assert.deepEqual(o.explorers, { available: true, total: 4, not_sent: 1, sent_unsigned: 2, signed_ready: 1 });
  assert.equal(o.explorers.not_sent + o.explorers.sent_unsigned + o.explorers.signed_ready, o.explorers.total);
  assert.equal(o.lps.open_applications, 1, 'a declined application is decided');
  assert.equal(o.kpis.waiting.lp_applications, 1);
  const ids = o.attention.rows.map((r: any) => r.id);
  assert.equal(o.attention.by_kind.identity_waiting.count, 2);
  assert.ok(!ids.includes(12) || ids.at(-1) === 12, 'an identity check with no start is listed after every dated wait');
  assert.deepEqual(ids, [3, 9, 2, 8, 12]);
});

test('counts agree with the Insights read on the same accounts', async () => {
  const db = seeded();
  const o: any = await overview(db);
  const i: any = await adminInsights(envOf(db), { range: '8w', role: null, country: null, compare: false, group: null }, NOW);
  assert.equal(o.kpis.accounts.total, i.kpis.accounts.total);
  assert.equal(o.kpis.accounts.new_30d, i.kpis.accounts.new_30d);
  assert.equal(o.kpis.accounts.deactivated, i.kpis.accounts.deactivated);
  const who = Object.fromEntries(i.blocks.who.by_profile.map((x: any) => [x.profile, x.count]));
  for (const r of o.profiles.rows) assert.equal(r.count, who[r.profile] ?? 0, r.profile);
  assert.equal(o.profiles.admins, who.admin);
  assert.equal(o.lps.count, i.blocks.who.lps);
  assert.equal(o.kpis.active_30d.dormant, i.blocks.dormant.count);
  assert.equal(o.kpis.active_30d.never_seen, i.blocks.dormant.never_seen);
  assert.equal(o.readiness.all.identity_approved, i.blocks.identity.approved);
  assert.deepEqual(o.weeks, i.weeks);
  for (const [k, w] of i.blocks.growth.weeks.entries()) {
    const ours = o.profiles.rows.reduce((t: number, r: any) => t + r.weeks[k].count, 0) + (w.by_profile.admin ?? 0);
    assert.equal(ours, w.total, w.week);
  }
});

test('a failed store costs its own block: the rest read, and nothing becomes a zero', async () => {
  const noEnvelopes = seeded();
  noEnvelopes.exec('DROP TABLE esign_envelopes');
  let o: any = await overview(noEnvelopes);
  assert.equal(o.explorers.unreadable, true);
  assert.equal(o.kpis.waiting.unreadable, true, 'waiting is not 1 when the explorers cannot be read');
  assert.equal(o.attention.available, true);
  assert.equal(o.attention.partial, true);
  assert.equal(o.attention.by_kind.explorer_signed.unreadable, true);
  assert.deepEqual(o.attention.rows.map((r: any) => r.id), [3, 9, 2]);
  assert.equal(o.kpis.accounts.total, 9);
  assert.equal(o.readiness.available, true);

  const noTerms = seeded();
  noTerms.exec('DROP TABLE legal_acceptances');
  o = await overview(noTerms);
  assert.equal(o.readiness.all.terms_accepted, null, 'an unread step is null, never 0');
  assert.match(o.readiness.terms_reason, /could not be read/);
  assert.equal(o.readiness.all.email_verified, 5);

  const noLp = seeded();
  noLp.exec('DROP TABLE lp_applications');
  o = await overview(noLp);
  assert.equal(o.lps.unreadable, true);
  assert.equal(o.kpis.waiting.unreadable, true);
  assert.equal(o.attention.by_kind.lp_application.unreadable, true);
  assert.equal(o.profiles.available, true);

  const noUsers = seeded();
  noUsers.exec('DROP TABLE users');
  o = await overview(noUsers);
  for (const k of ['accounts', 'active_30d', 'unverified']) assert.equal(o.kpis[k].unreadable, true, k);
  for (const k of ['profiles', 'readiness', 'newest', 'attention', 'lps', 'explorers']) assert.equal(o[k].unreadable, true, k);
  assert.match(o.profiles.reason, /That is not the same as none\./);
  assert.match(o.attention.reason, /Needs attention could not be read/, 'every kind failed: the list is unreadable, not empty');
  assert.equal(o.product_testers.recorded, false);
});

test('a reason never quotes the database or a person: an error is logged as a block name and a message', async () => {
  const db = seeded();
  db.exec('DROP TABLE esign_envelopes');
  const seen: unknown[][] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => { seen.push(a); };
  try { await overview(db); } finally { console.error = orig; }
  assert.ok(seen.length >= 2);
  for (const line of seen) assert.doesNotMatch(JSON.stringify(line), /Sample|@example/);
  const o: any = await overview((() => { const d = seeded(); d.exec('DROP TABLE esign_envelopes'); return d; })());
  assert.equal(o.explorers.reason, 'The Exploring board could not be read on this database. That is not the same as none.');
});

test('the LP queue’s open states fill the statements’ three placeholders; the five profiles are #2377’s', () => {
  assert.deepEqual([...OPEN_LP], ['pending', 'in_review', 'needs_follow_up']);
  assert.deepEqual(PROFILES.map((p) => p.key), ['founder', 'investor', 'advisor', 'partner', 'exploring']);
  const src = read('cloudflare-worker/src/routes/admin_accounts_overview.ts');
  assert.equal((src.match(/IN \(\?, \?, \?\)/g) || []).length, 2);
  assert.doesNotMatch(src, /\$\{[^}]*\}[^`]*FROM|IN \(\$\{/, 'a statement interpolates');
});

// ---------------------------------------------------------------------------
// The route.
// ---------------------------------------------------------------------------

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 901, PLAIN = 902, MEMBER = 903;

function routeDb() {
  const db = seeded();
  const u = db.prepare('INSERT INTO users (id, role, name, email, created_at) VALUES (?, ?, ?, ?, ?)');
  u.run(SUPER, 'admin', 'Super Sample', 'super@example.test', '2020-01-01 00:00:00');
  u.run(PLAIN, 'admin', 'Plain Sample', 'plain@example.test', '2020-01-01 00:00:00');
  u.run(MEMBER, 'founder', 'Member Sample', 'member@example.test', '2020-01-01 00:00:00');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  const ss = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, 'totp', datetime('now'))");
  for (const id of [SUPER, PLAIN, MEMBER]) ss.run(id, `j-${id}`);
  return db;
}

const app = new Hono<any>();
app.route('/api/admin/accounts/overview', overviewRoute);
app.onError((err: any, c) => {
  const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
  if (s) return c.json({ detail: err.message }, s);
  throw err;
});
async function get(db: any, as: number | null) {
  const headers: Record<string, string> = {};
  if (as !== null) {
    const t = await new SignJWT({ user_id: as, role: as === MEMBER ? 'founder' : 'admin', jti: `j-${as}` })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(JWT_SECRET));
    headers.Authorization = `Bearer ${t}`;
  }
  const res = await app.request('/api/admin/accounts/overview', { headers },
    { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any);
  return { status: res.status, body: await res.json() as any };
}

test('the route: any admin reads, a Super Admin also sees other administrators, a member and a stranger are refused', async () => {
  const db = routeDb();
  const plain = await get(db, PLAIN);
  assert.equal(plain.status, 200);
  assert.equal(plain.body.kpis.accounts.total, 12);
  assert.deepEqual(plain.body.scope, { key: 'hq', label: HQ_SCOPE_LABEL });
  assert.ok(!plain.body.newest.rows.some((r: any) => r.profile === 'admin'));
  const sup = await get(db, SUPER);
  assert.equal(sup.status, 200);
  assert.ok(sup.body.newest.rows.some((r: any) => r.profile === 'admin'));
  assert.equal((await get(db, MEMBER)).status, 403);
  assert.equal((await get(db, null)).status, 401);
});

test('the route is mounted, and the client calls it from its own module re-exported by one line', () => {
  const index = read('cloudflare-worker/src/index.ts');
  assert.match(index, /import adminAccountsOverview from '\.\/routes\/admin_accounts_overview';/);
  assert.match(index, /app\.route\('\/api\/admin\/accounts\/overview', adminAccountsOverview\);/);
  assert.match(read('frontend/src/lib/api/adminAccounts.js'), /accountsOverview: \(\) => request\('\/admin\/accounts\/overview'\)/);
  assert.match(read('frontend/src/lib/api.js'), /^export \* from '\.\/api\/adminAccounts\.js';$/m);
});
