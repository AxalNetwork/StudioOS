/**
 * D893 (#2660) — GET /api/admin/insights: every block of Admin › Insights, as counts.
 *
 * On node:sqlite with the tables cut from `schema_baseline.sql`. The service
 * runs on a fixed clock (a Wednesday) so each block's figure is worked out by
 * hand below; the router runs on the real clock for the gates and the 400s.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/admin_insights_d893.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import adminInsightsRoute from '../src/routes/admin_insights.ts';
import {
  adminInsights, activatedRate, COMPLETENESS_BANDS, DORMANT_DAYS, INSIGHTS_DEFINITIONS, PRODUCT_TESTERS_REASON,
  type InsightsQuery,
} from '../src/services/adminInsights.ts';
import { ACTIVE_ACCOUNT_BASIS } from '../src/services/activeAccounts.ts';
import { HQ_SCOPE_LABEL } from '../src/services/studioGlance.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const NOW = Date.parse('2026-10-21T12:00:00Z'); // a Wednesday; this week is 2026-10-19, last week 2026-10-12
const DAY = 86_400_000;
const at = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
function ddl(name: string): string {
  const i = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(i >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(i, BASELINE.indexOf(');', i) + 2);
}

function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = x.map((v) => (v === undefined ? null : v)); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() { const r = db.prepare(sql).run(...b); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
      };
      return api;
    },
    async batch(x: any[]) { const out = []; for (const st of x || []) out.push(await st.run()); return out; },
  };
}

const TABLES = ['users', 'super_admins', 'user_sessions', 'activity_logs', 'lp_applications', 'tickets', 'ai_usage_logs',
  'legal_acceptances', 'company_invitations', 'project_member_invitations', 'partner_invitations', 'branch_invitations'];

/**
 * Six accounts. User 5 is deactivated; user 4 was never stamped by the
 * last-active middleware; users 3 and 6 last made a request over 30 days ago.
 */
function seeded() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of TABLES) {
    try { db.exec(ddl(t)); } catch { /* a table the baseline does not hold is simply absent */ }
  }
  const u = db.prepare(`INSERT INTO users (id, role, name, email, is_active, created_at, country, kyc_status,
                          subscription_tier, profile_completion_pct, last_active_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  u.run(1, 'admin', 'Ada Private', 'ada@secret.example', 1, '2026-01-01 09:00:00', 'Canada', 'approved', 'free', 100, at(NOW - DAY));
  u.run(2, 'founder', 'Fay Private', 'fay@secret.example', 1, '2026-10-20 09:00:00', 'Canada', 'pending', 'pro', 30, at(NOW - DAY));
  u.run(3, 'founder', 'Finn Private', 'finn@secret.example', 1, '2026-10-13 09:00:00', 'France', 'not_started', 'free', 10, at(NOW - 40 * DAY));
  u.run(4, 'investor', 'Ivy Private', 'ivy@secret.example', 1, '2026-09-01 10:00:00', '', 'approved', 'plus', 60, null);
  u.run(5, 'investor', 'Gone Private', 'gone@secret.example', 0, '2026-10-14 09:00:00', 'France', 'rejected', 'free', 0, at(NOW - 2 * DAY));
  u.run(6, 'founder', 'Fred Private', 'fred@secret.example', 1, '2026-09-02 10:00:00', 'Canada', 'rejected', 'free', null, at(NOW - 35 * DAY));

  const lp = db.prepare(`INSERT INTO lp_applications (user_id, investor_type, status) VALUES (?, 'individual', ?)`);
  lp.run(4, 'approved');
  lp.run(2, 'pending');
  lp.run(5, 'approved'); // deactivated: not counted

  const a = db.prepare(`INSERT INTO activity_logs (user_id, action, endpoint, created_at) VALUES (?, ?, ?, ?)`);
  a.run(1, 'request', '/api/projects', '2026-08-25 09:00:00'); // the log's first day (week of 08-24)
  a.run(6, 'request', '/api/projects', '2026-09-03 09:00:00'); // week 08-31
  a.run(4, 'user_login', '/api/auth/login', '2026-09-01 10:05:00'); // week 08-31: user 4 signed in (with user 6, two that week)
  a.run(4, 'request', '/api/inbox', '2026-09-09 09:00:00'); // week 09-07: day 8 for user 4
  a.run(1, 'request', '/api/inbox', '2026-10-06 09:00:00'); // week 10-05
  a.run(1, 'request', '/api/inbox', '2026-10-12 00:00:00'); // week 10-12, its first second
  a.run(3, 'request', '/api/inbox', '2026-10-18 23:59:59'); // week 10-12, its last second
  a.run(3, 'request', '/api/inbox', '2026-10-14 09:00:00');
  a.run(4, 'note', null, '2026-10-13 09:00:00'); // not a middleware row: not activity
  a.run(1, 'request', '/api/inbox', '2026-10-20 09:00:00'); // this week
  a.run(2, 'request', '/api/inbox', '2026-10-21 08:00:00'); // this week

  const t = db.prepare(`INSERT INTO tickets (title, description, status, user_id) VALUES ('t', 'x', ?, ?)`);
  t.run('open', 2);
  t.run('in_progress', 3);
  t.run('closed', 6);

  const ai = db.prepare(`INSERT INTO ai_usage_logs (user_id, task, model, est_cost_usd, created_at) VALUES (?, 'x', 'm', ?, ?)`);
  ai.run(1, 1.0, '2026-10-02 10:00:00');
  ai.run(2, 0.5, '2026-10-03 10:00:00');
  ai.run(4, 0.25, '2026-10-04 10:00:00');
  ai.run(null, 0.1, '2026-10-05 10:00:00');
  ai.run(2, 9, '2026-09-30 23:00:00'); // last month
  return db;
}

const Q = (over: Partial<InsightsQuery> = {}): InsightsQuery =>
  ({ range: '8w', role: null, country: null, compare: false, group: null, ...over });
const read = (db: any, over: Partial<InsightsQuery> = {}) =>
  adminInsights({ DB: makeD1(db) } as any, Q(over), NOW) as Promise<any>;

const WEEKS_8 = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19'];

// ---------------------------------------------------------------------------

test('the axis, the scope and the definitions', async () => {
  const r = await read(seeded());
  assert.equal(r.range, '8w');
  assert.deepEqual(r.weeks, WEEKS_8);
  assert.equal(r.current_week, '2026-10-19');
  assert.equal(r.last_complete_week, '2026-10-12');
  assert.equal(r.as_of, '2026-10-21T12:00:00.000Z');
  assert.deepEqual(r.scope, { key: 'hq', label: HQ_SCOPE_LABEL });
  assert.deepEqual(r.definitions, INSIGHTS_DEFINITIONS);
  assert.equal(r.definitions.activity, ACTIVE_ACCOUNT_BASIS);
  for (const k of Object.keys(r.blocks)) assert.ok(k in r.definitions, `${k} has a definition`);
  const b = await adminInsights({ DB: makeD1(seeded()), BRANCH_CODE: 'mtl' } as any, Q(), NOW) as any;
  assert.deepEqual(b.scope, { key: 'mtl', label: 'mtl accounts' });
});

test('the KPIs: accounts, new this week, active last week, activated', async () => {
  const r = await read(seeded());
  assert.deepEqual(r.kpis.accounts, { available: true, total: 5, new_30d: 2, deactivated: 1 });
  assert.deepEqual(r.kpis.new_this_week, { available: true, count: 1, last_week: 2 },
    'this week user 2; last week users 3 and 5 (deactivated since, still created then)');
  assert.deepEqual(r.kpis.active_last_week, { available: true, week: '2026-10-12', value: 2, week_before: 1 },
    'users 1 and 3 on both edges of the week; user 4\'s row is not a middleware row');
  assert.deepEqual(r.kpis.activated, { available: true, rate_pct: 50, cohorts_counted: 1 },
    'only the 08-31 cohort has closed its week two: user 4 of users 4 and 6');
});

test('who, plan, countries, identity, completeness, dormant: one pass over the live accounts', async () => {
  const { blocks: b } = await read(seeded());
  assert.deepEqual(b.who, {
    available: true, total: 5,
    by_profile: [{ profile: 'founder', count: 3 }, { profile: 'admin', count: 1 }, { profile: 'investor', count: 1 }],
    lps: 1,
    product_testers: { recorded: false, reason: PRODUCT_TESTERS_REASON },
  });
  assert.deepEqual(b.plan, {
    available: true,
    by_tier: [{ tier: 'free', count: 3 }, { tier: 'plus', count: 1 }, { tier: 'pro', count: 1 }],
    paid: 2, paid_pct: 40,
  });
  assert.deepEqual(b.countries, {
    available: true, rows: [{ country: 'Canada', count: 3 }, { country: 'France', count: 1 }], not_stated: 1,
  });
  assert.deepEqual(b.identity, { available: true, not_started: 1, pending: 1, approved: 2, rejected: 1, other: 0 });
  assert.deepEqual(b.completeness, {
    available: true,
    bands: COMPLETENESS_BANDS.map((x) => ({ band: x.band, count: 1 })),
    not_recorded: 1,
  }, 'an account with no figure is not counted as 0%');
  assert.equal(b.dormant.count, 2, 'users 3 (40 days) and 6 (35 days)');
  assert.equal(b.dormant.never_seen, 1, 'user 4 was never stamped, so is not called dormant');
  assert.equal(b.dormant.days, DORMANT_DAYS);
  assert.equal(b.dormant.last_month, null, 'not read back from a column that keeps only the latest request');
  assert.ok(b.dormant.last_month_reason);
});

test('identity: a status outside the four is counted as other, never folded into one of them', async () => {
  const db = seeded();
  db.prepare(`UPDATE users SET kyc_status = 'manual_review' WHERE id = 1`).run();
  db.prepare(`UPDATE users SET kyc_status = NULL WHERE id = 4`).run();
  const { blocks: b } = await read(db);
  assert.deepEqual(b.identity, { available: true, not_started: 2, pending: 1, approved: 0, rejected: 1, other: 1 },
    'a blank status has not started; an unknown one is other');
});

test('the weekly lines: growth by profile, activity with blanks before the log, activation, retention', async () => {
  const { blocks: b } = await read(seeded());
  const g = b.growth.weeks;
  assert.deepEqual(g.map((w: any) => w.week), WEEKS_8);
  assert.deepEqual(g[0], { week: '2026-08-31', total: 2, to_date: false, by_profile: { founder: 1, investor: 1 } });
  assert.deepEqual(g[6], { week: '2026-10-12', total: 2, to_date: false, by_profile: { founder: 1, investor: 1 } });
  assert.deepEqual(g[7], { week: '2026-10-19', total: 1, to_date: true, by_profile: { founder: 1 } });
  assert.equal(g[3].total, 0, 'a week with nobody is a measured zero');

  assert.deepEqual(b.activity.values, [2, 1, 0, 0, 0, 1, 2, 2]);
  assert.equal(b.activity.previous, null, 'no previous period unless compare=1');

  const c = Object.fromEntries(b.activation.cohorts.map((x: any) => [x.week, x]));
  assert.deepEqual([c['2026-08-31'].created, c['2026-08-31'].signed_in, c['2026-08-31'].active_week_two], [2, 1, 1]);
  assert.equal(c['2026-10-12'].active_week_two, null, 'its week two has not ended');

  const ret = Object.fromEntries(b.retention.cohorts.map((x: any) => [x.week, x]));
  assert.deepEqual(ret['2026-08-31'], { week: '2026-08-31', signups: 2, retained_30d: 0 });
  assert.deepEqual(ret['2026-10-12'], { week: '2026-10-12', signups: 2, retained_30d: 1 });
  assert.deepEqual(ret['2026-10-19'], { week: '2026-10-19', signups: 1, retained_30d: 1 });
  assert.equal(b.retention.cohorts.length, 8, 'Monday weeks, not %W keys');
});

test('tickets and spend', async () => {
  const { blocks: b } = await read(seeded());
  assert.deepEqual(b.tickets, { available: true, open: 2, by_status: { open: 1, in_progress: 1, closed: 1 } });
  assert.equal(b.spend.month, '2026-10');
  assert.equal(b.spend.calls, 4);
  assert.ok(Math.abs(b.spend.usd - 1.85) < 1e-9, 'last month\'s 9 USD is not this month\'s');
  assert.deepEqual(b.spend.by_profile.map((x: any) => [x.profile, x.calls]),
    [['admin', 1], ['founder', 1], ['investor', 1], ['no account', 1]]);
});

test('the profile filter narrows every block about accounts', async () => {
  const r = await read(seeded(), { role: 'founder' });
  assert.deepEqual(r.filters, { profile: 'founder', country: null, compare: false, group: null });
  assert.equal(r.kpis.accounts.total, 3);
  assert.deepEqual(r.blocks.who.by_profile, [{ profile: 'founder', count: 3 }]);
  assert.equal(r.blocks.who.lps, 0);
  assert.deepEqual(r.blocks.activity.values, [1, 0, 0, 0, 0, 0, 1, 1]);
  assert.deepEqual(r.blocks.countries.rows, [{ country: 'Canada', count: 2 }, { country: 'France', count: 1 }]);
  assert.equal(r.blocks.tickets.open, 2);
  assert.deepEqual(r.blocks.spend.by_profile.map((x: any) => x.profile), ['founder'], 'an unowned call is no profile\'s');
  assert.equal(r.kpis.activated.rate_pct, 0, 'founder 6 was not active in week two');
  assert.equal(r.blocks.growth.weeks[6].total, 1);
});

test('the country filter, as stored, and both filters together', async () => {
  const fr = await read(seeded(), { country: 'France' });
  assert.equal(fr.kpis.accounts.total, 1);
  assert.equal(fr.kpis.accounts.deactivated, 1, 'user 5');
  assert.deepEqual(fr.blocks.activity.values, [0, 0, 0, 0, 0, 0, 1, 0]);
  assert.deepEqual(fr.blocks.tickets.by_status, { in_progress: 1 });
  const both = await read(seeded(), { role: 'investor', country: 'Canada' });
  assert.equal(both.kpis.accounts.total, 0);
  assert.equal(both.blocks.plan.paid_pct, null, 'no share of nobody');
  assert.equal(both.blocks.spend.usd, 0);
  const none = await read(seeded(), { country: 'canada' });
  assert.equal(none.kpis.accounts.total, 0, 'as stored: no case folding');
});

test('every range draws its own number of Monday weeks', async () => {
  for (const [range, n] of [['8w', 8], ['quarter', 13], ['year', 52]] as const) {
    const r = await read(seeded(), { range });
    assert.equal(r.weeks.length, n, range);
    assert.equal(r.weeks.at(-1), '2026-10-19');
    assert.equal(r.blocks.growth.weeks.length, n);
    assert.equal(r.blocks.activity.values.length, n);
    assert.equal(r.blocks.retention.cohorts.length, n);
    assert.equal(r.blocks.activation.cohorts.length, n);
  }
  const y = await read(seeded(), { range: 'year' });
  assert.equal(y.blocks.activity.values[y.weeks.indexOf('2026-08-24')], 1, 'the log\'s first week');
  assert.equal(y.blocks.activity.values[y.weeks.indexOf('2026-08-17')], null, 'before the log began: blank, not zero');
});

test('compare=1 draws the period before as a second line', async () => {
  const r = await read(seeded(), { compare: true });
  assert.deepEqual(r.blocks.activity.previous, [null, null, null, null, null, null, null, 1],
    'eight weeks before 08-31; the log began in the last of them');
  assert.deepEqual(r.blocks.activity.values, [2, 1, 0, 0, 0, 1, 2, 2], 'the current line is unchanged');
});

test('group=<role> fills the lightbox, with its table by country', async () => {
  const r = await read(seeded(), { group: 'founder' });
  const g = r.group;
  assert.equal(g.available, true);
  assert.deepEqual(
    [g.profile, g.count, g.new_30d, g.active_last_week, g.activated_pct, g.dormant],
    ['founder', 3, 2, 1, 0, 2],
  );
  assert.deepEqual(g.signups_by_week.at(-1), { week: '2026-10-19', count: 1, to_date: true });
  assert.deepEqual(g.active_by_week.map((x: any) => x.count), [1, 0, 0, 0, 0, 0, 1, 1]);
  assert.deepEqual(g.by_country, [
    { country: 'Canada', accounts: 2, new_30d: 1, active_last_week: 0 },
    { country: 'France', accounts: 1, new_30d: 1, active_last_week: 1 },
  ]);
  assert.equal((await read(seeded())).group, undefined, 'no group block unless asked');
});

test('each block fails alone: a missing table is that block\'s unreadable, never zero', async () => {
  const cases: Array<[string, (r: any) => void]> = [
    ['lp_applications', (r) => {
      assert.equal(r.blocks.who.lps, null);
      assert.match(r.blocks.who.lps_reason, /not the same as none/);
      assert.equal(r.blocks.who.total, 5, 'the rest of the block answers');
    }],
    ['tickets', (r) => {
      assert.equal(r.blocks.tickets.available, false);
      assert.equal(r.blocks.tickets.unreadable, true);
      assert.equal(r.blocks.tickets.open, undefined);
    }],
    ['ai_usage_logs', (r) => {
      assert.equal(r.blocks.spend.available, false);
      assert.equal(r.blocks.spend.usd, undefined);
    }],
    ['activity_logs', (r) => {
      for (const x of [r.blocks.activity, r.kpis.active_last_week, r.blocks.retention, r.blocks.activation]) {
        assert.equal(x.available, false);
        assert.equal(x.unreadable, true);
      }
      assert.equal(r.blocks.activity.values, undefined);
      assert.equal(r.kpis.accounts.total, 5, 'the account blocks still answer');
      assert.equal(r.blocks.plan.paid, 2);
    }],
    ['users', (r) => {
      for (const k of ['who', 'plan', 'countries', 'identity', 'completeness', 'dormant', 'growth']) {
        assert.equal(r.blocks[k].available, false, k);
      }
      assert.equal(r.kpis.accounts.available, false);
    }],
  ];
  for (const [table, check] of cases) {
    const db = seeded();
    db.exec(`DROP TABLE ${table}`);
    const r = await read(db);
    check(r);
    for (const [k, v] of Object.entries({ ...r.kpis, ...r.blocks }) as Array<[string, any]>) {
      if (v?.available === false) assert.match(v.reason, /not the same as none/, `${table} → ${k}`);
    }
  }
  const db = seeded();
  db.exec('DROP TABLE activity_logs');
  assert.equal((await read(db, { group: 'founder' })).group.available, false, 'the group needs the log');
});

test('no field in any response holds an email, a name or an id', async () => {
  const banned = new Set(['id', 'user_id', 'uid', 'email', 'name']);
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        assert.ok(!banned.has(k), `${path}.${k} is a per-account key`);
        walk(x, `${path}.${k}`);
      }
      return;
    }
    if (typeof v === 'string') {
      assert.doesNotMatch(v, /@|Private|secret\.example/, `${path} carries a person`);
    }
  };
  for (const over of [{}, { compare: true, group: 'founder' }, { role: 'investor' }, { country: 'France', range: 'year' as const }]) {
    walk(await read(seeded(), over), 'insights');
  }
});

test('activatedRate: only cohorts whose week two closed, and none is null, not 0', () => {
  const c = (created: number, w2: number | null) => ({ week: 'w', created, signed_in: 0, terms_accepted: 0, active_week_two: w2, week_two_open: w2 === null, invited: 0 });
  assert.deepEqual(activatedRate([c(4, 1), c(6, 3), c(10, null)]), { rate_pct: 40, cohorts_counted: 2 });
  assert.deepEqual(activatedRate([c(3, null)]), { rate_pct: null, cohorts_counted: 0 });
  assert.deepEqual(activatedRate([c(0, 0)]), { rate_pct: null, cohorts_counted: 0 });
});

// ---------------------------------------------------------------------------
// The route: the gate, scope, and the 400s.
// ---------------------------------------------------------------------------

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 901;
const PLAIN = 902;
const MEMBER = 903;

function routeDb() {
  const db = seeded();
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  u.run(SUPER, 'admin', 'Super Private', 'super@secret.example');
  u.run(PLAIN, 'admin', 'Plain Private', 'plain@secret.example');
  u.run(MEMBER, 'founder', 'Member Private', 'member@secret.example');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  const ss = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, 'totp', datetime('now'))");
  for (const id of [SUPER, PLAIN, MEMBER]) ss.run(id, `j-${id}`);
  return db;
}

const app = new Hono<any>();
app.route('/api/admin/insights', adminInsightsRoute);
app.onError((err: any, c) => {
  const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
  if (s) return c.json({ detail: err.message }, s);
  throw err;
});
async function get(db: any, qs: string, as: number, extra: Record<string, unknown> = {}) {
  const t = await new SignJWT({ user_id: as, role: as === MEMBER ? 'founder' : 'admin', jti: `j-${as}` })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(`/api/admin/insights${qs}`, { headers: { Authorization: `Bearer ${t}` } },
    { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db), ...extra } as any);
  return { status: res.status, body: await res.json() as any };
}

test('the route: any admin reads; a member is refused', async () => {
  const db = routeDb();
  const r = await get(db, '?range=quarter&profile=founder&country=Canada&compare=1&group=investor', PLAIN);
  assert.equal(r.status, 200);
  assert.equal(r.body.weeks.length, 13);
  assert.deepEqual(r.body.filters, { profile: 'founder', country: 'Canada', compare: true, group: 'investor' });
  assert.ok(Array.isArray(r.body.blocks.activity.previous));
  assert.equal(r.body.group.profile, 'investor');
  assert.equal((await get(db, '', MEMBER)).status, 403);
});

test('the route: another scope is HQ\'s for a plain Admin and a branch read for a Super Admin; its own scope reads', async () => {
  const db = routeDb();
  const plain = await get(db, '?scope=mtl', PLAIN);
  assert.equal(plain.status, 403);
  assert.equal(plain.body.code, 'hq_only');
  // D893 S08 (#2662): an unbound branch is read as not deployed, never as HQ's own accounts.
  const sup = await get(db, '?scope=mtl', SUPER);
  assert.equal(sup.status, 200);
  assert.equal(sup.body.scope.key, 'mtl');
  assert.deepEqual(sup.body.branch, { status: 'not_deployed' });
  assert.equal((await get(db, '?scope=hq', PLAIN)).status, 200);
  const branch = await get(db, '?scope=hq', PLAIN, { BRANCH_CODE: 'mtl' });
  assert.equal(branch.status, 403, 'a branch admin asking for HQ is asking for another scope');
  assert.equal((await get(db, '?scope=mtl', PLAIN, { BRANCH_CODE: 'mtl' })).status, 200);
});

test('the route: a filter it cannot read is a 400, never a wider answer', async () => {
  const db = routeDb();
  for (const [qs, code] of [
    ['?range=month', 'bad_range'],
    ['?profile=Founder', 'bad_profile'],
    ['?profile=a%20b', 'bad_profile'],
    ['?group=x;drop', 'bad_group'],
    [`?country=${'x'.repeat(65)}`, 'bad_country'],
    ['?country=%0A', 'bad_country'],
  ] as const) {
    const r = await get(db, qs, PLAIN);
    assert.equal(r.status, 400, qs);
    assert.equal(r.body.code, code, qs);
  }
  assert.equal((await get(db, '?range=&profile=&country=', PLAIN)).status, 200, 'empty means unset');
});
