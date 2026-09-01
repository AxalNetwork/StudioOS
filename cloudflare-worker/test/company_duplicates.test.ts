/**
 * The company switcher must never show the same company twice.
 *
 * The switcher is the single writer of active-company state and the only
 * control that says which company you are looking at. A list with two
 * identical entries makes that question unanswerable, and it was reachable two
 * different ways:
 *
 *   1. TWO LINKS, ONE COMPANY. `user_company_links` shipped with only
 *      `idx_uclink_user` — a plain index on user_id, no uniqueness — and
 *      `/company/memberships` returned one entry PER LINK. A duplicated pair
 *      rendered twice.
 *
 *   2. TWO COMPANIES, ONE NAME. `/company/create` inserted with no pre-check,
 *      so a double submit (retry, second tab, flaky network) produced two
 *      `company_profiles` rows with the same name and two links. This is the
 *      worse of the two: the rows have DIFFERENT ids, so migration 189 — which
 *      backfills projects through the primary link only — put every project
 *      under one of them, and selecting the other shows an empty workspace
 *      that reads as data loss.
 *
 * Harness modelled on advisor.answered.test.ts: mint a jose JWT and drive the
 * router against an in-memory D1 stub.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import company from '../src/routes/company.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // >= 32 bytes
const USER_ID = 7;

type Link = {
  id: number; uid: string; company_id: number; user_id: number;
  role_in_company: string; is_primary_admin: number; created_at: string;
};

const SEED = [
  { id: 1, uid: 'co-1', company_name: 'DeFi Scoring', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
  { id: 2, uid: 'co-2', company_name: 'VJs TV', created_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-02T00:00:00Z' },
];
const NEW_ID = 99;

async function mintToken(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

/**
 * @param links      the caller's membership rows, verbatim — the point of most
 *                   of these tests is what happens when they contain a duplicate
 * @param inserts    every INSERT the handler attempts, so a refused create can
 *                   be shown to have written nothing rather than merely 409'd
 */
function makeEnv(links: Link[], inserts: string[] = []): any {
  const user = { id: USER_ID, role: 'founder', name: 'F', email: 'f@example.com', is_active: 1 };
  // A store, not a constant. A successful create reads the row back through
  // `SELECT * FROM company_profiles WHERE id = ?` before building its DTO, so
  // a stub that only knows the seed rows makes the success path throw and the
  // test proves nothing about it.
  const companies = [...SEED];
  const handle = (rawSql: string) => {
    const s = rawSql.toLowerCase();
    let bound: any[] = [];
    const api: any = {
      bind: (...a: any[]) => { bound = a; return api; },
      async first() {
        if (s.includes('from company_profiles') && s.includes('where id = ?')) {
          return companies.find((c) => c.id === bound[0]) || null;
        }
        // The create guard: does this caller already hold this name?
        if (s.includes('from company_profiles') && s.includes('join user_company_links')) {
          const [userId, name] = bound;
          const mine = links.filter((l) => l.user_id === userId).map((l) => l.company_id);
          const hit = companies.find(
            (c) => mine.includes(c.id)
              && c.company_name.trim().toLowerCase() === String(name).trim().toLowerCase(),
          );
          return hit ? { company_name: hit.company_name } : null;
        }
        if (s.includes('from users where id')) return user;
        return null;
      },
      async all() {
        if (s.includes('from users where id')) return { results: [user] };
        if (s.includes('from user_company_links') && s.includes('where user_id = ?')) {
          const mine = links.filter((l) => l.user_id === bound[0]);
          // Honour the handler's ORDER BY. Returning insertion order instead
          // would make the ordering assertion below a test of this stub.
          if (s.includes('order by is_primary_admin desc')) {
            mine.sort((a, b) => (b.is_primary_admin - a.is_primary_admin)
              || (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
          }
          return { results: mine };
        }
        if (s.includes('from user_company_links') && s.includes('where company_id = ?')) {
          return { results: links.filter((l) => l.company_id === bound[0]) };
        }
        if (s.startsWith('pragma table_info')) return { results: [] };
        return { results: [] };
      },
      async run() {
        if (s.startsWith('insert into')) inserts.push(s);
        if (s.startsWith('insert into company_profiles')) {
          companies.push({
            id: NEW_ID, uid: String(bound[0]), company_name: String(bound[1]),
            created_at: '2026-02-01T00:00:00Z', updated_at: '2026-02-01T00:00:00Z',
          });
        }
        if (s.startsWith('insert into user_company_links')) {
          links.push(link(NEW_ID, Number(bound[1]), 1, '2026-02-01T00:00:00Z'));
        }
        return { meta: { changes: 1, last_row_id: NEW_ID } };
      },
    };
    return api;
  };
  return {
    JWT_SECRET,
    ENVIRONMENT: 'development',
    DB: {
      prepare: (sql: string) => handle(sql),
      async exec() { return { count: 0, duration: 0 }; },
      async batch(stmts: any[]) { return (stmts || []).map(() => ({ results: [] })); },
    },
  };
}

const link = (id: number, companyId: number, primary = 0, created = '2026-01-01T00:00:00Z'): Link => ({
  id, uid: `l-${id}`, company_id: companyId, user_id: USER_ID,
  role_in_company: 'Admin', is_primary_admin: primary, created_at: created,
});

const memberships = (env: any, token: string) =>
  company.request('/company/memberships', { headers: { Authorization: `Bearer ${token}` } }, env);

const create = (env: any, token: string, name: string) =>
  company.request('/company/create', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ company_name: name }),
  }, env);

test('memberships: two links to one company render once', async () => {
  const token = await mintToken(USER_ID, 'founder');
  // The exact shape migration 192 dedupes: same user, same company, two rows.
  const env = makeEnv([link(1, 1, 1), link(2, 1, 0), link(3, 2, 0)]);
  const res = await memberships(env, token);
  assert.equal(res.status, 200);
  const body = (await res.json()) as any[];
  assert.deepEqual(body.map((c) => c.company_name), ['DeFi Scoring', 'VJs TV'],
    'a duplicated link must not duplicate the company in the switcher');
});

test('memberships: distinct companies are all returned, in primary-first order', async () => {
  // The dedupe must not become "show one company" — the switcher exists to
  // list several, and `list[0]` has to stay the company /company/me picks.
  const token = await mintToken(USER_ID, 'founder');
  const env = makeEnv([link(1, 2, 0, '2026-01-02T00:00:00Z'), link(2, 1, 1, '2026-01-01T00:00:00Z')]);
  const body = (await (await memberships(env, token)).json()) as any[];
  assert.deepEqual(body.map((c) => c.company_name), ['DeFi Scoring', 'VJs TV']);
  assert.equal(body[0].is_primary_admin, true, 'the primary link must sort first');
});

test('create: a name this caller already holds is refused, and writes nothing', async () => {
  const token = await mintToken(USER_ID, 'founder');
  const inserts: string[] = [];
  const env = makeEnv([link(1, 1, 1)], inserts);
  const res = await create(env, token, 'DeFi Scoring');
  assert.equal(res.status, 409);
  const body = (await res.json()) as any;
  assert.match(body.detail, /already have a company called "DeFi Scoring"/);
  // 409-ing while still inserting would leave the duplicate behind and only
  // hide it from the response, which is the bug wearing a different hat.
  assert.deepEqual(inserts, [], 'a refused create must not write a company or a link');
});

test('create: the check ignores case and surrounding space', async () => {
  const token = await mintToken(USER_ID, 'founder');
  for (const attempt of ['defi scoring', '  DeFi Scoring  ', 'DEFI SCORING']) {
    const inserts: string[] = [];
    const res = await create(makeEnv([link(1, 1, 1)], inserts), token, attempt);
    assert.equal(res.status, 409, `"${attempt}" should collide`);
    assert.deepEqual(inserts, [], `"${attempt}" must not write`);
  }
});

test('create: a genuinely new name still works', async () => {
  // The guard must refuse duplicates, not creation. This is the assertion that
  // fails if the clash query is ever widened to match too much.
  const token = await mintToken(USER_ID, 'founder');
  const inserts: string[] = [];
  const res = await create(makeEnv([link(1, 1, 1)], inserts), token, 'Northwind');
  assert.equal(res.status, 200);
  assert.equal(inserts.length, 2, 'the company row and its membership link');
  assert.ok(inserts.some((q) => q.includes('insert into company_profiles')));
  assert.ok(inserts.some((q) => q.includes('insert into user_company_links')));
});

test('create: the name is only taken for the caller, not globally', async () => {
  // Two unrelated founders may both run a "Northwind". The clash query joins
  // through user_company_links for exactly this reason; a global uniqueness
  // check here would refuse a name because a stranger used it.
  const token = await mintToken(USER_ID, 'founder');
  const inserts: string[] = [];
  // COMPANIES holds "DeFi Scoring" (id 1), but this caller belongs to id 2 only.
  const res = await create(makeEnv([link(1, 2, 1)], inserts), token, 'DeFi Scoring');
  assert.equal(res.status, 200, 'someone else owning the name must not block it');
  assert.equal(inserts.length, 2);
});

test('create: an empty or blank name is still rejected before the clash check', async () => {
  const token = await mintToken(USER_ID, 'founder');
  for (const bad of ['', '   ']) {
    const inserts: string[] = [];
    const res = await create(makeEnv([link(1, 1, 1)], inserts), token, bad);
    assert.equal(res.status, 400);
    assert.deepEqual(inserts, []);
  }
});
