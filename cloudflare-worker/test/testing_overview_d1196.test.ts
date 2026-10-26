/**
 * D1196 (#3146, part 1 of #2382) — Product testing's overview read,
 * `GET /api/admin/testing/overview`, on node:sqlite with the baseline's tables
 * and migrations 515, 516, 517 and 576 applied as they ship. Every person and
 * programme below is made up, and every expected figure is counted by hand in
 * the comments.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/testing_overview_d1196.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { adminTesting } from '../src/routes/testing.ts';
import { readTestingOverview, mondayOf, OVERVIEW_WEEKS } from '../src/services/testingOverview.ts';
import { testerRecipients } from '../src/services/mailLinkTesters.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SQL = resolve(process.cwd(), 'cloudflare-worker/sql');
const BASELINE = readFileSync(`${SQL}/schema_baseline.sql`, 'utf8');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}

// Sunday 25 October 2026: this Monday is 19 October, so the twelve weeks start on 3 August.
const NOW = Date.parse('2026-10-25T12:00:00Z');

// People. HQ is the Super Admin; ADMIN a plain admin.
const HQ = 1, ADMIN = 2;
const F1 = 10, F2 = 11, F3 = 12, F4 = 13, F5 = 14, F6 = 15, F7 = 16, INV = 20, ADV = 21, EXP = 22;
// Programmes: P1 open, P2 testing, P3 closed, P4 draft.
const P1 = 1, P2 = 2, P3 = 3, P4 = 4;

function world({ opened = true }: { opened?: boolean } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'super_admins', 'partners', 'notifications_inbox', 'insight_subscriptions', 'user_profile_ext']) db.exec(ddl(t));
  for (const m of ['515_newsletter_lists.sql', '516_product_testing.sql', '517_mail_link.sql', '576_product_testers.sql']) db.exec(readFileSync(`${SQL}/migrations/${m}`, 'utf8'));
  const u = db.prepare('INSERT INTO users (id, email, name, role, is_active) VALUES (?, ?, ?, ?, ?)');
  for (const [id, role, active] of [
    [HQ, 'admin', 1], [ADMIN, 'admin', 1],
    [F1, 'founder', 1], [F2, 'founder', 1], [F3, 'founder', 1], [F4, 'founder', 1], [F5, 'founder', 1], [F6, 'founder', 1], [F7, 'founder', 1],
    [INV, 'investor', 0], [ADV, 'advisor', 1], [EXP, 'exploring', 1],
  ] as const) u.run(id, `person${id}@example.test`, `Made-up ${id}`, role, active);
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${HQ})`);
  const p = db.prepare("INSERT INTO testing_programmes (id, uid, owner_kind, created_by, product_name, places, status) VALUES (?, ?, 'hq', ?, ?, 10, ?)");
  p.run(P1, 'prog-1', HQ, 'Product Alpha', 'open');
  p.run(P2, 'prog-2', HQ, 'Product Beta', 'testing');
  p.run(P3, 'prog-3', HQ, 'Product Gamma', 'closed');
  p.run(P4, 'prog-4', HQ, 'Product Delta', 'draft');
  const a = db.prepare(`INSERT INTO testing_applications (uid, programme_id, user_id, status, consent_email_at, consent_version, mail_enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const app = (prog: number, user: number, status: string, consent: boolean, mail = 1) =>
    a.run(`app-${prog}-${user}`, prog, user, status, consent ? '2026-09-01 10:00:00' : null, consent ? 'v1' : null, mail);
  // P1 (open). Picked: F1 (consented, emails on, reachable); F2 (consented, emails off); F3 (no consent);
  // INV (consented, emails on, account closed); ADV (consented, emails on, address suppressed);
  // F5 (consented, emails on, unsubscribed from the newsletter). EXP applied. F4 withdrew.
  app(P1, F1, 'picked', true); app(P1, F2, 'picked', true, 0); app(P1, F3, 'picked', false);
  app(P1, INV, 'picked', true); app(P1, ADV, 'picked', true); app(P1, F5, 'picked', true);
  app(P1, EXP, 'applied', false); app(P1, F4, 'withdrawn', false);
  // P2 (testing). F1 picked and reachable again; F6 withdrew.
  app(P2, F1, 'picked', true); app(P2, F6, 'withdrawn', false);
  // P3 (closed). F7 applied: a closed programme is not open, so F7 is in no count.
  app(P3, F7, 'applied', false);
  db.exec(`INSERT INTO email_suppressions (email, reason) VALUES ('person${ADV}@example.test', 'bounce')`);
  db.exec(`INSERT INTO newsletter_subscribers (uid, email, status) VALUES ('ns-1', 'person${F5}@example.test', 'unsubscribed')`);
  // The pool: F1, F2 and EXP active; INV active on a closed account; ADV paused; ADMIN active.
  const t = db.prepare("INSERT INTO product_testers (user_id, status, decided_at) VALUES (?, ?, CASE WHEN ? = 'applied' THEN NULL ELSE '2026-09-01' END)");
  for (const [id, st] of [[F1, 'active'], [F2, 'active'], [EXP, 'active'], [INV, 'active'], [ADV, 'paused'], [ADMIN, 'active']] as const) t.run(id, st, st);
  // The history. The first programme opened on Tuesday 18 August, in the week of 17 August.
  const e = db.prepare('INSERT INTO testing_events (programme_id, action, created_at) VALUES (?, ?, ?)');
  e.run(P1, 'applied', '2026-07-01 09:00:00'); // before the window: in no week
  if (opened) e.run(P1, 'opened', '2026-08-18 09:00:00');
  e.run(P1, 'applied', '2026-08-19 09:00:00'); e.run(P1, 'applied', '2026-08-19 15:00:00'); e.run(P1, 'picked', '2026-08-20 09:00:00');
  e.run(P1, 'applied', '2026-09-01 09:00:00');
  e.run(P1, 'withdrawn', '2026-09-02 09:00:00'); // not an application or a pick
  if (opened) e.run(P2, 'opened', '2026-09-15 09:00:00');
  e.run(P2, 'applied', '2026-10-20 09:00:00'); e.run(P2, 'picked', '2026-10-21 09:00:00');
  const env = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any;
  return { db, env };
}

async function call(env: any, who: number) {
  const app = new Hono();
  app.route('/api/admin/testing', adminTesting);
  const jwt = await new SignJWT({ user_id: who, role: 'admin' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request('/api/admin/testing/overview', { headers: { Authorization: `Bearer ${jwt}` } }, env);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

test('weekly: twelve Monday weeks; before the first programme opened is not recorded; a quiet week after is a measured 0', async () => {
  // Hand-worked. Weeks from 3 Aug: 3 Aug and 10 Aug end before 18 Aug → recorded: false, no counts.
  // 17 Aug: 2 applications, 1 pick. 24 Aug: 0, 0. 31 Aug: 1 application (1 Sep). 7 Sep … 12 Oct: 0, 0.
  // 19 Oct, to date: 1 application, 1 pick. The July application and the withdrawal count nowhere.
  // Mutations checked: a week before the first opening counted as 0; a withdrawal counted; the window off by a week.
  const { env } = world();
  assert.equal(mondayOf(NOW), '2026-10-19');
  const w = (await readTestingOverview(env, NOW)).weekly as any;
  assert.equal(w.available, true);
  assert.equal(w.weeks.length, OVERVIEW_WEEKS);
  assert.equal(w.first_opened, '2026-08-18');
  assert.deepEqual(w.weeks.map((x: any) => [x.week_start, x.recorded, x.applications, x.picks]), [
    ['2026-08-03', false, null, null], ['2026-08-10', false, null, null],
    ['2026-08-17', true, 2, 1], ['2026-08-24', true, 0, 0], ['2026-08-31', true, 1, 0],
    ['2026-09-07', true, 0, 0], ['2026-09-14', true, 0, 0], ['2026-09-21', true, 0, 0], ['2026-09-28', true, 0, 0],
    ['2026-10-05', true, 0, 0], ['2026-10-12', true, 0, 0], ['2026-10-19', true, 1, 1],
  ]);
  assert.equal(w.weeks[11].to_date, true);
  assert.ok(w.weeks.slice(0, 11).every((x: any) => !x.to_date));
  // No programme ever opened: every week is not recorded, never zeros.
  const empty = world({ opened: false });
  assert.ok(((await readTestingOverview(empty.env, NOW)).weekly as any).weeks.every((x: any) => x.recorded === false && x.applications === null));
});

test('by profile: the active pool on active accounts, and open programmes\' applicants each once; withdrawn per open programme', async () => {
  // Hand-worked pool: F1, F2 (founders), EXP (explorer), ADMIN (other); INV's account is closed, ADV is paused → 4.
  // Applicants on P1 and P2, not withdrawn, each once: F1, F2, F3, F5 (4 founders), INV, ADV, EXP. F7 is on a
  // closed programme. Withdrawn: F4 on P1, F6 on P2 → 2.
  // Mutations checked: a closed programme counted as open; F1 counted twice; withdrawn applicants counted as applicants.
  const { env } = world();
  const o = await readTestingOverview(env, NOW) as any;
  assert.deepEqual([o.by_profile.pool.total, o.by_profile.pool.by_profile], [4, { founder: 2, investor: 0, advisor: 0, partner: 0, exploring: 1, other: 1 }]);
  assert.deepEqual([o.by_profile.applicants.total, o.by_profile.applicants.by_profile], [7, { founder: 4, investor: 1, advisor: 1, partner: 0, exploring: 1, other: 0 }]);
  assert.deepEqual([o.withdrawn.total, o.withdrawn.programmes.map((p: any) => [p.uid, p.withdrawn])], [2, [['prog-1', 1], ['prog-2', 1]]]);
});

test('Mail reach per open programme narrows step by step, and its last step equals testerRecipients\' count on the same rows', async () => {
  // Hand-worked P1: picked F1, F2, F3, INV, ADV, F5 = 6; agreed to email (not F3) = 5; emails on (not F2) = 4;
  // reachable: INV closed, ADV suppressed, F5 unsubscribed → F1 = 1. P2: 1, 1, 1, 1. P3 and P4 are not open.
  // Mutations checked: the suppression or the unsubscribe step dropped; a closed account reached; steps not cumulative.
  const { env } = world();
  const m = (await readTestingOverview(env, NOW)).mail_reach as any;
  assert.equal(m.available, true);
  assert.deepEqual(m.programmes.map((p: any) => [p.uid, p.status, p.picked, p.consented, p.emails_on, p.reachable]), [
    ['prog-1', 'open', 6, 5, 4, 1], ['prog-2', 'testing', 1, 1, 1, 1],
  ]);
  for (const p of m.programmes) {
    assert.equal(p.reachable, (await testerRecipients(env, p.uid, 0)).recipients.length, `${p.uid}: the same rule as the send`);
  }
});

test('the route: a Super Admin reads it, a plain Admin is 403; no field carries an email; one failed block leaves the rest', async () => {
  // Mutations checked: requireAdmin in place of requireSuperAdmin; a block's failure failing the whole read.
  const { db, env } = world();
  assert.equal((await call(env, ADMIN)).status, 403);
  const ok = await call(env, HQ);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const text = JSON.stringify(ok.body);
  assert.ok(!/@/.test(text), 'no email address, or any part of one');
  assert.ok(!/Made-up/.test(text), 'no member name');
  for (const k of ['weekly', 'withdrawn', 'mail_reach']) assert.equal(ok.body[k].available, true, k);

  // The pool's table gone: only the pool says so; the applicants, weekly, withdrawn and Mail reach still answer.
  db.exec('DROP TABLE product_testers');
  const part = await call(env, HQ);
  assert.equal(part.status, 200);
  assert.deepEqual([part.body.by_profile.pool.available, part.body.by_profile.pool.reason], [false, 'The tester pool could not be read on this database. That is not the same as none.']);
  assert.equal(part.body.by_profile.pool.total, undefined, 'a failed block carries no figures');
  assert.equal(part.body.by_profile.applicants.total, 7);
  assert.equal(part.body.mail_reach.available, true);
  // The history gone: only weekly fails.
  db.exec('DROP TABLE testing_events');
  const noHistory = await call(env, HQ);
  assert.deepEqual([noHistory.body.weekly.available, noHistory.body.withdrawn.available], [false, true]);
});
