/**
 * D1300 (#3396, part 1 of #2377) — All accounts' list read,
 * `GET /api/admin/users`: each filter and sort through the router over
 * SQLite, totals over a filtered set across pages, the columns, the stated
 * rule for deactivated accounts, and another studio's accounts never read.
 * Every name and figure is made up.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/accounts_list_d1300.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import admin from '../src/routes/admin.ts';
import { DEACTIVATED_RULE, TRUST_NOT_RECORDED, parseAccountsQuery } from '../src/services/accountsList.ts';

const JWT_SECRET = 'unit-test-jwt-secret-d1300-0123456789';
const ROOT = 1, SUPER = 7, FOUNDER = 2;
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString().slice(0, 19).replace('T', ' ');

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
        async run() { const r = db.prepare(sql).run(...b); return { meta: { changes: Number(r.changes) } }; },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const out: any[] = []; for (const st of x || []) out.push(await st.run().catch(() => ({}))); return out; },
  };
}

const SCHEMA = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY, uid TEXT, email TEXT, name TEXT, role TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1, email_verified INTEGER NOT NULL DEFAULT 1,
    kyc_status TEXT DEFAULT 'approved', access_level TEXT, jwt_min_iat INTEGER, created_at TEXT,
    admin_notes TEXT, last_active_at TIMESTAMP, last_active TIMESTAMP, country TEXT,
    subscription_tier TEXT NOT NULL DEFAULT 'free', profile_completion_pct INTEGER, spinout_lab_active INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);
  CREATE TABLE user_personas (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, persona_id TEXT, is_primary INTEGER DEFAULT 1);
  CREATE TABLE lp_applications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, status TEXT);
  CREATE TABLE product_testers (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER UNIQUE, status TEXT);
  CREATE TABLE advisor_cohort_assignments (id INTEGER PRIMARY KEY AUTOINCREMENT, advisor_user_id INTEGER, is_active INTEGER DEFAULT 1);
  CREATE TABLE legal_obligations (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, obligation_key TEXT, required INTEGER DEFAULT 1, status TEXT);
`;

/**
 * Six named accounts, each holding one fact the others do not, and sixty
 * look-alike founders in Spain so a filtered set crosses the page.
 */
function world({ bulk = 60 } = {}) {
  const d = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  d.exec(SCHEMA);
  const u = d.prepare(`INSERT INTO users (id, uid, email, name, role, is_active, email_verified, kyc_status, access_level, created_at,
    last_active_at, country, subscription_tier, profile_completion_pct, spinout_lab_active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  u.run(ROOT, 'u-root', 'root@axal.test', 'Root Admin', 'admin', 1, 1, 'approved', null, '2026-01-01 09:00:00', null, null, 'free', null, 0);
  u.run(FOUNDER, 'u-ana', 'ana@axal.test', 'Ana Founder', 'founder', 1, 1, 'approved', null, ago(5), ago(2), 'France', 'free', 80, 1);
  u.run(3, 'u-ben', 'ben@axal.test', 'Ben Investor', 'investor', 1, 0, 'pending', 'limited', '2026-03-10 09:00:00', ago(40), 'India', 'growth', 20, 0);
  u.run(4, 'u-cara', 'cara@axal.test', 'Cara Advisor', 'advisor', 1, 1, 'needs_info', null, '2026-04-01 09:00:00', null, 'france', 'studio', null, 0);
  u.run(5, 'u-dev', 'dev@axal.test', 'Dev Partner', 'partner', 0, 1, 'rejected', null, ago(20), ago(10), 'Germany', 'free', 50, 0);
  u.run(6, 'u-eve', 'eve@axal.test', 'Eve Explorer', 'exploring', 1, 1, null, null, '2026-02-01 09:00:00', null, null, 'free', 10, 0);
  u.run(SUPER, 'u-hq', 'hq@axal.test', 'Hana HQ', 'admin', 1, 1, 'approved', null, '2026-01-02 09:00:00', null, null, 'free', null, 0);
  for (let i = 0; i < bulk; i++) {
    u.run(100 + i, `u-b${i}`, `b${i}@axal.test`, `Bulk ${String(i).padStart(2, '0')}`, 'founder', 1, 1, 'approved', null,
      `2026-05-${String((i % 28) + 1).padStart(2, '0')} 09:00:00`, null, 'Spain', 'free', null, 0);
  }
  d.exec(`
    INSERT INTO super_admins (user_id) VALUES (${SUPER});
    INSERT INTO user_personas (user_id, persona_id, is_primary) VALUES (2, 'p_builder', 1), (3, 'p_backer', 1), (3, 'p_builder', 0);
    INSERT INTO lp_applications (user_id, status) VALUES (3, 'approved'), (6, 'pending');
    INSERT INTO product_testers (user_id, status) VALUES (4, 'active'), (6, 'applied');
    INSERT INTO advisor_cohort_assignments (advisor_user_id, is_active) VALUES (4, 1), (2, 0);
    INSERT INTO legal_obligations (user_id, obligation_key, required, status) VALUES
      (2, 'tos', 1, 'satisfied'), (2, 'nda', 1, 'waived'),
      (3, 'tos', 1, 'pending'), (3, 'kyc', 1, 'pending'),
      (5, 'a', 1, 'satisfied'), (5, 'b', 1, 'satisfied'), (5, 'c', 1, 'satisfied'), (5, 'd', 1, 'pending'),
      (4, 'optional', 0, 'pending'),
      (6, 'a', 1, 'satisfied'), (6, 'b', 1, 'satisfied'), (6, 'c', 1, 'satisfied'), (6, 'd', 1, 'satisfied'), (6, 'e', 1, 'pending');
  `);
  return d;
}

const app = new Hono<any>();
app.route('/admin', admin);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 403));

async function get(path: string, d: InstanceType<typeof DatabaseSync>, { as = ROOT, branch = '' } = {}) {
  const token = await new SignJWT({ user_id: as, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(d) };
  if (branch) env.BRANCH_CODE = branch;
  const res = await app.request(path, { headers: { Authorization: `Bearer ${token}` } }, env);
  return { status: res.status, body: await res.json() as any };
}

/** The named accounts a filter keeps, the look-alikes counted apart. */
async function kept(query: string, d = world()) {
  const { status, body } = await get(`/admin/users?envelope=1&limit=200&${query}`, d);
  assert.equal(status, 200, `${query}: ${JSON.stringify(body)}`);
  const names = body.results.map((r: any) => r.name);
  return { named: names.filter((n: string) => !n.startsWith('Bulk')).sort(), bulk: names.filter((n: string) => n.startsWith('Bulk')).length, body };
}

// ---------------------------------------------------------------- the query

test('a value outside a filter\'s set is refused, never ignored', () => {
  const p = (q: Record<string, string>) => parseAccountsQuery((k) => q[k]);
  assert.deepEqual(p({ profile: 'founder,wizard' }), { ok: false, code: 'invalid_profile', detail: 'profile must be one or more of: founder, investor, advisor, partner, exploring, admin.' });
  assert.equal((p({ sort: 'random' }) as any).code, 'invalid_sort');
  assert.equal((p({ trust: 'high' }) as any).code, 'invalid_trust');
  assert.equal((p({ joined: '7d', joined_from: '2026-01-01' }) as any).code, 'invalid_joined');
  assert.equal((p({ joined_from: '2026-02-01', joined_to: '2026-01-01' }) as any).code, 'invalid_joined_from');
  assert.equal((p({ joined_from: '2026-13-45' }) as any).code, 'invalid_joined_from');
  assert.equal((p({ plan: "free'; DROP TABLE users" }) as any).code, 'invalid_plan');
  assert.equal((p({ country: 'Fr' + 'a'.repeat(80) }) as any).code, 'invalid_country');
  assert.equal((p({ q: 'a' }) as any).code, 'query_too_short');
  const ok = p({ profile: 'Founder, investor', limit: '999' }) as any;
  assert.deepEqual([ok.query.profile, ok.query.limit, ok.query.sort], [['founder', 'investor'], 200, 'joined_desc']);
});

test('through the router: a refused filter is a 400 with its code, and nothing is read', async () => {
  const d = world();
  const r = await get('/admin/users?envelope=1&identity=maybe', d);
  assert.deepEqual([r.status, r.body.code], [400, 'invalid_identity']);
  const short = await get('/admin/users?q=a', d);
  assert.deepEqual([short.status, short.body.error], [400, 'query_too_short']);
});

// ---------------------------------------------------------------- every filter

test('profile, sub-account, status, email and identity each keep their accounts', async () => {
  assert.deepEqual((await kept('profile=investor,advisor')).named, ['Ben Investor', 'Cara Advisor']);
  assert.deepEqual((await kept('sub=lp')).named, ['Ben Investor'], 'an approved LP application only');
  assert.deepEqual((await kept('sub=tester')).named, ['Cara Advisor'], 'an active tester only');
  const none = await kept('sub=none');
  assert.ok(!none.named.includes('Ben Investor') && !none.named.includes('Cara Advisor') && none.named.includes('Eve Explorer'));
  assert.deepEqual((await kept('status=deactivated')).named, ['Dev Partner']);
  assert.ok(!(await kept('status=active')).named.includes('Dev Partner'));
  assert.deepEqual((await kept('email=unverified')).named, ['Ben Investor']);
  assert.deepEqual((await kept('identity=pending')).named, ['Ben Investor'], 'the canvas\'s Waiting');
  assert.deepEqual((await kept('identity=not_started')).named, ['Eve Explorer'], 'no status recorded reads Not started');
  assert.deepEqual((await kept('identity=needs_info,rejected')).named, ['Cara Advisor', 'Dev Partner']);
});

test('access level, plan, country, joined and last active each keep their accounts', async () => {
  assert.deepEqual((await kept('limited=on')).named, ['Ben Investor']);
  assert.ok(!(await kept('limited=off')).named.includes('Ben Investor'));
  assert.deepEqual((await kept('plan=growth,studio')).named, ['Ben Investor', 'Cara Advisor']);
  assert.deepEqual((await kept('country=France')).named, ['Ana Founder', 'Cara Advisor'], 'country is matched whatever its case');
  assert.equal((await kept('country=spain')).bulk, 60);
  assert.deepEqual((await kept('joined=7d')).named, ['Ana Founder']);
  assert.deepEqual((await kept('joined=30d')).named, ['Ana Founder', 'Dev Partner']);
  assert.deepEqual((await kept('joined_from=2026-03-01&joined_to=2026-03-31')).named, ['Ben Investor']);
  assert.deepEqual((await kept('active=7d')).named, ['Ana Founder']);
  assert.deepEqual((await kept('active=30d')).named, ['Ana Founder', 'Dev Partner']);
  assert.deepEqual((await kept('active=over_30d')).named, ['Ben Investor']);
  const never = await kept('active=never');
  assert.deepEqual([never.named, never.bulk], [['Cara Advisor', 'Eve Explorer', 'Hana HQ', 'Root Admin'], 60]);
});

test('persona, programme and trust band each keep their accounts', async () => {
  assert.deepEqual((await kept('persona=p_builder')).named, ['Ana Founder'], 'the primary segment, not a second one');
  assert.deepEqual((await kept('program=lab')).named, ['Ana Founder']);
  assert.deepEqual((await kept('program=mentor')).named, ['Cara Advisor'], 'an active cohort assignment only');
  assert.deepEqual((await kept('program=testing')).named, ['Cara Advisor']);
  assert.deepEqual((await kept('trust=under_50')).named, ['Ben Investor']);
  assert.deepEqual((await kept('trust=50_79')).named, ['Dev Partner']);
  assert.deepEqual((await kept('trust=80_up')).named, ['Ana Founder', 'Eve Explorer'], '80 is "80 and over", never "50 to 79"');
  const unknown = await kept('trust=not_recorded');
  assert.ok(unknown.named.includes('Cara Advisor') && unknown.bulk === 60, 'no required obligation is Not recorded');
  assert.deepEqual((await kept('profile=founder&country=france&program=lab&trust=80_up')).named, ['Ana Founder'], 'across filters, all');
  assert.deepEqual((await kept('profile=founder&country=india')).named, []);
});

test('the search reaches name, email and account uid', async () => {
  assert.deepEqual((await kept('q=u-cara')).named, ['Cara Advisor']);
  assert.deepEqual((await kept('q=ben@')).named, ['Ben Investor']);
  assert.deepEqual((await kept('q=Explorer')).named, ['Eve Explorer']);
});

// ---------------------------------------------------------------- sorts

test('each sort, with what nothing records last', async () => {
  const order = async (sort: string) => (await kept(`sort=${sort}&q=axal.test&profile=founder,investor,advisor,partner,exploring`)).body.results
    .map((r: any) => r.name).filter((n: string) => !n.startsWith('Bulk'));
  assert.deepEqual((await order('trust_asc')).slice(0, 4), ['Ben Investor', 'Dev Partner', 'Eve Explorer', 'Ana Founder'], 'lowest first: 0, 75, 80, 100');
  assert.deepEqual((await order('active_desc')).slice(0, 3), ['Ana Founder', 'Dev Partner', 'Ben Investor']);
  assert.deepEqual((await order('active_asc')).slice(0, 3), ['Ben Investor', 'Dev Partner', 'Ana Founder']);
  assert.deepEqual(await order('name_asc'), ['Ana Founder', 'Ben Investor', 'Cara Advisor', 'Dev Partner', 'Eve Explorer']);
  // Ids 1, 2 and 7 (Root, Ana, Hana): by name, not by id.
  assert.deepEqual((await kept('sort=name_asc&profile=admin,founder')).body.results.map((r: any) => r.name).filter((n: string) => !n.startsWith('Bulk')),
    ['Ana Founder', 'Hana HQ', 'Root Admin']);
  assert.deepEqual((await order('completeness_asc')).slice(0, 4), ['Eve Explorer', 'Ben Investor', 'Dev Partner', 'Ana Founder'], '10, 20, 50, 80, then not recorded');
  assert.equal((await order('completeness_asc')).at(-1), 'Cara Advisor');
  assert.deepEqual((await order('joined_asc'))[0], 'Eve Explorer');
  assert.deepEqual((await order('joined_desc'))[0], 'Ana Founder');
  const all = (await kept('sort=joined_asc')).body.results.map((r: any) => r.name);
  assert.equal(all[0], 'Root Admin');
});

// ---------------------------------------------------------------- totals and paging

test('the total is over the filtered set, across pages, and the pages reach every row', async () => {
  const d = world();
  const seen = new Set<number>();
  const one = await get('/admin/users?envelope=1&country=spain&limit=25', d);
  assert.deepEqual([one.body.matched, one.body.from, one.body.to, one.body.showing, one.body.next_offset], [60, 1, 25, 25, 25], '1–25 of 60');
  assert.equal(one.body.total, 67, 'the whole table stays the tiles\' total');
  assert.equal(one.body.by_role.founder, 61);
  assert.deepEqual(one.body.matched_by_role, { founder: 60 });
  for (const r of one.body.results) seen.add(r.id);
  const two = await get('/admin/users?envelope=1&country=spain&limit=25&offset=25', d);
  const three = await get('/admin/users?envelope=1&country=spain&limit=25&offset=50', d);
  assert.deepEqual([two.body.matched, three.body.matched], [60, 60], 'the same total on every page');
  assert.deepEqual([three.body.from, three.body.to, three.body.showing, three.body.next_offset], [51, 60, 10, null]);
  for (const r of [...two.body.results, ...three.body.results]) seen.add(r.id);
  assert.equal(seen.size, 60, 'every row, once');
  assert.equal(one.body.narrowed, true);
});

test('deactivated accounts: one stated rule, listed and marked, split apart in every count', async () => {
  const d = world({ bulk: 0 });
  const all = await get('/admin/users?envelope=1', d);
  assert.equal(all.body.deactivated_rule, DEACTIVATED_RULE);
  assert.match(DEACTIVATED_RULE, /is_active = 0/);
  assert.equal(all.body.results.find((r: any) => r.name === 'Dev Partner').is_active, 0, 'listed, and marked');
  assert.deepEqual(all.body.status_split, { active: 6, deactivated: 1 });
  const partners = await get('/admin/users?envelope=1&profile=partner&status=active', d);
  assert.deepEqual([partners.body.matched, partners.body.status_split], [0, { active: 0, deactivated: 1 }], 'what the other choice would show');
});

// ---------------------------------------------------------------- columns

test('the columns, and nothing recorded is null, never 0', async () => {
  const { body } = await get('/admin/users?envelope=1&limit=200', world({ bulk: 0 }));
  const by = (n: string) => body.results.find((r: any) => r.name === n);
  const ben = by('Ben Investor');
  assert.deepEqual(
    [ben.country, ben.subscription_tier, ben.profile_completion_pct, ben.persona, ben.sub_accounts, ben.programs, ben.trust, ben.access_level, ben.kyc_status, ben.email_verified],
    ['India', 'growth', 20, 'p_backer', { lp: true, tester: false }, { lab: false, mentor: false, testing: false }, { score: 0, open: 2, reason: null }, 'limited', 'pending', 0],
  );
  assert.match(ben.last_active_at, /^\d{4}-\d{2}-\d{2}/);
  const cara = by('Cara Advisor');
  assert.deepEqual([cara.profile_completion_pct, cara.last_active_at, cara.trust], [null, null, { score: null, open: 0, reason: TRUST_NOT_RECORDED }]);
  assert.deepEqual(by('Ana Founder').trust, { score: 100, open: 0, reason: null }, 'satisfied and waived both count');
  assert.equal(by('Eve Explorer').kyc_status, null);
  assert.deepEqual(body.unreadable, []);
});

test('a store this database cannot read leaves its column null and named; a filter on it is refused', async () => {
  const d = world({ bulk: 0 });
  d.exec('DROP TABLE legal_obligations; DROP TABLE user_personas');
  const r = await get('/admin/users?envelope=1', d);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.unreadable, ['persona', 'trust']);
  assert.ok(r.body.results.every((x: any) => x.trust === null && x.persona === null));
  const t = await get('/admin/users?envelope=1&trust=under_50', d);
  assert.deepEqual([t.status, t.body.code], [503, 'filter_unreadable'], 'never "none match"');
  assert.equal((await get('/admin/users?envelope=1&sort=trust_asc', d)).status, 503);
  assert.equal((await get('/admin/users?envelope=1&persona=p_builder', d)).status, 503);
});

// ---------------------------------------------------------------- another studio

test('an Admin cannot read another studio\'s accounts', async () => {
  const d = world({ bulk: 0 });
  const plain = await get('/admin/users?envelope=1&scope=lisbon', d);
  assert.deepEqual([plain.status, plain.body.code], [403, 'hq_only']);
  assert.ok(!JSON.stringify(plain.body).includes('@axal.test'), 'no row in the refusal');
  const hq = await get('/admin/users?envelope=1&scope=lisbon', d, { as: SUPER });
  assert.deepEqual([hq.status, hq.body.code], [400, 'scope_unavailable'], 'HQ does not copy a subsidiary\'s names here');
  assert.equal((await get('/admin/users?envelope=1&scope=hq', d)).status, 200, 'its own scope reads');
  // On a branch, its own code is its scope, and HQ's is another studio's.
  assert.equal((await get('/admin/users?envelope=1&scope=lisbon', d, { branch: 'lisbon' })).status, 200);
  const up = await get('/admin/users?envelope=1&scope=hq', d, { as: SUPER, branch: 'lisbon' });
  assert.deepEqual([up.status, up.body.code], [403, 'hq_only'], 'no admin on a branch is HQ');
  const founder = await get('/admin/users?envelope=1', d, { as: FOUNDER });
  assert.notEqual(founder.status, 200, 'a member is refused');
});

test('every statement is bound: the source builds no query text from what the caller sent', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/services/accountsList.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /prepare\(\s*`[^`]*\$\{/, 'no ${} inside a prepared template');
  // A hostile value is refused before the query is built, and a quote in a search is a bound value.
  const d = world({ bulk: 0 });
  assert.equal((await get("/admin/users?envelope=1&country=x'%20OR%201=1--", d)).status, 400);
  const q = await get("/admin/users?envelope=1&q=%27%20OR%201%3D1--", d);
  assert.deepEqual([q.status, q.body.matched], [200, 0]);
});
