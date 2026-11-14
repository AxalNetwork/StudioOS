/** D979 (#2765) — the Firms tab's list and drawer reads, mounted on the real SQLite schema, with each store failing alone. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import route from '../src/routes/admin_partner_firms.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const NOW = Date.parse('2026-10-26T16:00:00Z'); // 12:00 ET on 26 Oct.
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const SECRET = 'test'.repeat(16);
const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const migration = (file: string, name: string) => tableFromBaseline(readFileSync(new URL('../sql/migrations/' + file, import.meta.url), 'utf8'), name);

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const name of ['users', 'super_admins', 'user_sessions', 'partners', 'partner_profiles', 'partner_deals', 'partner_referral_redemptions']) db.exec(tableFromBaseline(baseline, name));
  // Production's partner_profiles: the baseline's (keyed by email) with migration 275's columns.
  db.exec(readFileSync(new URL('../sql/migrations/275_partner_profiles_columns.sql', import.meta.url), 'utf8'));
  db.exec(migration('361_partner_booking_ratings.sql', 'partner_booking_ratings'));
  db.exec(migration('313_lab_host_applications.sql', 'lab_host_applications'));
  db.exec(migration('477_mercury_personal.sql', 'partner_deal_settlements'));
  const insert = (table: string, v: Record<string, any>) => db.prepare(`INSERT INTO ${table} (${Object.keys(v).join(',')}) VALUES (${Object.keys(v).map(() => '?').join(',')})`).run(...Object.values(v));
  for (const [id, role, name, partner_id] of [[1, 'admin', 'Admin', null], [5, 'founder', 'PRIVATE FOUNDER', null], [10, 'partner', 'Pia Example', 1], [11, 'partner', 'Lio Testwell', 1], [12, 'partner', 'Max Sample', 2], [13, 'partner', 'Una Stub', 4], [14, 'partner', 'Teo Unattached', null]] as const) {
    insert('users', { id, role, name, email: `${id}@private.example`, partner_id, headline: id === 10 ? 'Sales lead' : null });
    insert('user_sessions', { user_id: id, jti: `j-${id}`, factor: 'totp' });
  }
  insert('partners', { id: 1, name: 'Alpha', company: 'Alpha Advisory Ltd', email: 'PRIVATE FIRM 1', specialization: 'Go-to-market', directory_listed: 1, directory_featured: 1, oh_when_to_book: 'After the first paying customers', oh_stage_fit: 'Pre-seed · Seed', referral_code: 'PRIVATE-CODE' });
  insert('partners', { id: 2, name: 'Zeta', company: 'Beta Capital Partners', email: 'PRIVATE FIRM 2', specialization: 'Capital', directory_listed: 1 });
  insert('partners', { id: 3, name: 'Gamma Ops', email: 'PRIVATE FIRM 3', specialization: 'Operations' });
  insert('partners', { id: 4, name: 'delta design', email: 'PRIVATE FIRM 4', directory_listed: 1 });
  const deal = (id: number, user_id: number, deal_type: string, status: string, expires_at: string | null) =>
    insert('partner_deals', { id, user_id, deal_type, status, expires_at, activated_at: '2026-03-12 00:00:00', proposal_json: '{"private":"PRIVATE TERMS"}', referral_code: `PRIVATE-${id}`, granted_tier_investor: 'professional' });
  deal(1, 10, 'services_partnership', 'active', iso(NOW + 10 * DAY));
  deal(2, 11, 'custom', 'expired', '2026-01-01 00:00:00');
  deal(3, 12, 'capital_partnership', 'active', iso(NOW + 60 * DAY));
  deal(4, 13, 'equity_partnership', 'active', null);
  deal(5, 14, 'custom', 'active', iso(NOW + 5 * DAY)); // an unattached account's deal is no firm's
  for (const [id, partner_deal_id, redeemed_by_user_id] of [[1, 1, 5], [2, 1, 1], [3, 2, 5]]) insert('partner_referral_redemptions', { id, partner_deal_id, redeemed_by_user_id });
  for (const [id, rating] of [[1, 4], [2, 5]]) insert('partner_booking_ratings', { id, booking_id: id, partner_id: 1, founder_user_id: 5, rating, comment: 'PRIVATE REVIEW' });
  for (const [id, direction, amount_cents, due_on, state] of [[1, 'to_member', 120000, '2026-11-02', 'issued'], [2, 'from_member', 80000, '2026-10-26', 'issued'], [3, 'to_member', 999, '2026-11-26', 'issued'], [4, 'to_member', 500, '2026-11-01', 'draft'], [5, 'to_member', 700, '2026-10-25', 'issued']] as const) {
    insert('partner_deal_settlements', { id, uid: `s${id}`, partner_deal_id: 1, user_id: 10, kind: 'revenue_share', direction, amount_cents, due_on, state, drafted_by: 1, memo: 'PRIVATE MEMO' });
  }
  insert('partner_profiles', { invitation_id: 1, email: 'PRIVATE PROFILE EMAIL', user_id: 10, organization: 'Alpha Advisory Ltd', role_title: 'Partner', expertise: 'Go-to-market, Sales hiring, Go-to-market', sectors: 'B2B software', capital_capacity_usd: 250000, motivation: 'PRIVATE MOTIVATION', prior_deals: 'PRIVATE DEALS', raw_chat_json: '{"x":"PRIVATE CHAT"}' });
  insert('lab_host_applications', { uid: 'h1', user_id: 10, host_kind: 'partner', host_id: 1, capacity: 'partner', status: 'approved', statement: 'PRIVATE STATEMENT', reviewed_at: '2026-10-01 10:00:00' });
  return db;
}

async function get(db: DatabaseSync, path: string, { as = 1, env = {}, failOn = [] as RegExp[] } = {}) {
  const token = await new SignJWT({ user_id: as, role: as === 5 ? 'founder' : 'admin', jti: `j-${as}` }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const app = new Hono<any>(); app.route('/api/admin/partners', route);
  // The production app's mapping of the auth gate's throw (index.ts onError).
  app.onError((err: any, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES as any)[err.message] || 500));
  const queries: string[] = []; const d1 = d1Over(db);
  const DB = { ...d1, prepare(sql: string) {
    queries.push(sql);
    if (failOn.some((re) => re.test(sql))) return { bind() { return this; }, all: async () => { throw new Error('D1_ERROR: no such table'); }, first: async () => { throw new Error('D1_ERROR'); } };
    return d1.prepare(sql);
  } };
  const before = Date.now; Date.now = () => NOW;
  try {
    const res = await app.request('/api/admin/partners' + path, { headers: as ? { Authorization: `Bearer ${token}` } : {} }, { DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development', ...env });
    return { status: res.status, body: await res.json() as any, queries };
  } finally { Date.now = before; }
}
const value = (b: any) => { assert.equal(b.available, true, JSON.stringify(b)); assert.equal(b.recorded, true); return b.value; };
const failed = (b: any) => { assert.equal(b.available, false); assert.ok(b.reason); assert.equal('value' in b, false); };
const privateFree = (body: any) => assert.doesNotMatch(JSON.stringify(body), /PRIVATE|private\.example|proposal_json|referral_code|memo|motivation/);
const ids = (b: any) => b.items.map((i: any) => i.id);

test('the gate: anonymous and a member are refused before any firm is read', async () => {
  const db = fixture();
  for (const p of ['/firms', '/firms/1']) {
    const anon = await get(db, p, { as: 0 });
    assert.equal(anon.status, 401);
    const member = await get(db, p, { as: 5 });
    assert.equal(member.status, 403);
    assert.ok(!member.queries.some((q) => /FROM partners/.test(q)), 'no firm statement runs for a member');
  }
  db.close();
});

test('AP5: every firm with its nine columns, by name, with an exact total and nothing private', async () => {
  // Mutation checked: the deals join without `status = 'active'` → Alpha's deal count is 2; redemptions without it → 3;
  // settlements without `state = 'issued'` → 4 due; the 30-day window widened → s3 counts; a missing end guessed → delta's end is not null.
  // Sorting by the stored name alone → Zeta (Beta Capital Partners) moves last; an account's email selected → the statement check fails.
  const db = fixture();
  const { status, body, queries } = await get(db, '/firms');
  assert.equal(status, 200);
  assert.equal(body.total, 4);
  assert.ok(!queries.some((q) => /\bemail\b/.test(q)), 'no statement selects an email');
  assert.deepEqual(ids(body), [1, 2, 4, 3], 'by company, else name, case-insensitively (by name alone, Zeta would be last)');
  assert.deepEqual(body.unreadable, []);
  assert.equal(body.scope, 'hq');
  const alpha = body.items[0];
  assert.equal(alpha.company, 'Alpha Advisory Ltd');
  assert.equal(alpha.specialization, 'Go-to-market');
  assert.deepEqual(alpha.directory, { listed: true, featured: true });
  assert.equal(value(alpha.accounts), 2);
  assert.deepEqual(value(alpha.deal), { count: 1, types: ['services_partnership'], soonest_end: iso(NOW + 10 * DAY), ending_soon: true });
  assert.equal(value(alpha.redemptions), 2, 'only the active deal\'s redemptions');
  assert.deepEqual(value(alpha.rating), { count: 2, average: 4.5 });
  assert.deepEqual(value(alpha.settlements_due), { currency: 'usd', count: 2, to_member_cents: 120000, from_member_cents: 80000 }, 'issued, due today through 30 days on, each direction alone');
  const gamma = body.items.find((i: any) => i.id === 3);
  assert.equal(value(gamma.accounts), 0);
  assert.deepEqual(value(gamma.deal), { count: 0, types: [], soonest_end: null, ending_soon: false });
  assert.deepEqual(value(gamma.rating), { count: 0, average: null }, 'no ratings is no average, never 0');
  assert.equal(value(body.items.find((i: any) => i.id === 4).deal).soonest_end, null, 'a missing end is never guessed');
  assert.equal(value(body.items.find((i: any) => i.id === 2).deal).ending_soon, false);
  privateFree(body);
  db.close();
});

test('AP5: search, the four filters, each sort and pages, filtered before paging', async () => {
  // Mutation checked: paging before filtering → page 2 of the listed firms holds a not-listed one; `no_accounts` inverted → Gamma is dropped.
  const db = fixture();
  const ask = async (qs: string) => (await get(db, `/firms?${qs}`)).body;
  assert.deepEqual(ids(await ask('q=CAPITAL')), [2], 'company');
  assert.deepEqual(ids(await ask('q=operations')), [3], 'specialization');
  assert.deepEqual(ids(await ask('directory=featured')), [1]);
  assert.deepEqual(ids(await ask('directory=listed')), [1, 2, 4]);
  assert.deepEqual(ids(await ask('directory=not_listed')), [3]);
  assert.deepEqual(ids(await ask('deal_type=capital_partnership')), [2]);
  assert.deepEqual(ids(await ask('ends_within=30')), [1]);
  assert.deepEqual(ids(await ask('ends_within=90')), [1, 2]);
  assert.deepEqual(ids(await ask('no_accounts=true')), [3]);
  assert.deepEqual(ids(await ask('no_accounts=0')), [1, 2, 4]);
  assert.deepEqual(ids(await ask('sort=name_desc')), [3, 4, 2, 1]);
  assert.deepEqual(ids(await ask('sort=accounts_desc')), [1, 2, 4, 3]);
  assert.deepEqual(ids(await ask('sort=deal_ends_asc')), [1, 2, 3, 4], 'firms with no end sort last, by id');
  assert.deepEqual(ids(await ask('sort=rating_desc')), [1, 2, 3, 4]);
  const page = await ask('directory=listed&limit=2&offset=2');
  assert.deepEqual([ids(page), page.total, page.limit, page.offset], [[4], 3, 2, 2]);
  const past = await ask('limit=2&offset=10');
  assert.deepEqual([ids(past), past.total], [[], 4], 'a page past the end still carries the total');
  assert.deepEqual(page.filters.deal_types, ['equity_partnership', 'services_partnership', 'deal_sourcing_revshare', 'capital_partnership', 'custom']);
  for (const qs of ['directory=hidden', 'deal_type=loan', 'ends_within=7', 'no_accounts=maybe', 'sort=newest', 'limit=0', 'limit=101', 'offset=-1', `q=${'x'.repeat(201)}`]) {
    const r = await get(db, `/firms?${qs}`);
    assert.equal(r.status, 400, qs);
    assert.ok(r.body.error && r.body.message, qs);
  }
  db.close();
});

test('AP5: a failed store costs only its column, a filter on it is a 503, and failed firms are a 503', async () => {
  // Mutation checked: the deals catch returning [] → the column reads "no active deal" and the filter answers []; the 503 guard removed → 200.
  const db = fixture();
  const dealsDown = await get(db, '/firms', { failOn: [/SELECT u.partner_id, d.id, d.deal_type/] });
  assert.equal(dealsDown.status, 200);
  assert.deepEqual(dealsDown.body.unreadable, ['deals']);
  for (const i of dealsDown.body.items) { failed(i.deal); value(i.accounts); value(i.rating); }
  for (const qs of ['deal_type=custom', 'ends_within=30', 'sort=deal_ends_asc']) {
    const r = await get(db, `/firms?${qs}`, { failOn: [/SELECT u.partner_id, d.id, d.deal_type/] });
    assert.equal(r.status, 503, qs);
    assert.equal(r.body.error, 'filter_unreadable');
    assert.equal(r.body.source, 'deals');
  }
  const accountsDown = await get(db, '/firms?no_accounts=true', { failOn: [/FROM users WHERE partner_id IS NOT NULL GROUP BY/] });
  assert.equal(accountsDown.status, 503);
  const ratingsDown = await get(db, '/firms', { failOn: [/FROM partner_booking_ratings/] });
  assert.equal(ratingsDown.status, 200);
  failed(ratingsDown.body.items[0].rating);
  assert.equal((await get(db, '/firms?sort=rating_desc', { failOn: [/FROM partner_booking_ratings/] })).status, 503);
  const settlementsDown = await get(db, '/firms', { failOn: [/FROM partner_deal_settlements/] });
  failed(settlementsDown.body.items[0].settlements_due);
  value(settlementsDown.body.items[0].redemptions);
  const firmsDown = await get(db, '/firms', { failOn: [/FROM partners$/] });
  assert.equal(firmsDown.status, 503);
  assert.equal(firmsDown.body.error, 'firms_unreadable');
  assert.doesNotMatch(JSON.stringify(firmsDown.body), /D1_ERROR|SELECT/);
  db.close();
});

test('on a branch, settlements are kept by HQ and no settlement statement runs', async () => {
  // Mutation checked: the branch guard removed → a settlement statement runs and the block is a value.
  const db = fixture();
  for (const p of ['/firms', '/firms/1']) {
    const { status, body, queries } = await get(db, p, { env: { BRANCH_CODE: 'lisbon' } });
    assert.equal(status, 200, p);
    assert.equal(body.scope, 'lisbon');
    const block = p === '/firms' ? body.items[0].settlements_due : body.settlements;
    assert.deepEqual(block, { available: true, recorded: false, reason: 'Settlements are kept by HQ.' });
    assert.ok(!queries.some((q) => /partner_deal_settlements/.test(q)), p);
  }
  db.close();
});

test('AP6: one firm — accounts, directory, every deal with its redemptions, settlements, profiles and office hours', async () => {
  // Mutation checked: the profile list split without de-duplicating → "Go-to-market" twice; capital in dollars → 250000 cents;
  // lab host for host_kind 'advisor' → status null; the deals read limited to active → the expired deal is missing.
  const db = fixture();
  assert.equal((await get(db, '/firms/99')).status, 404);
  const { status, body, queries } = await get(db, '/firms/1');
  assert.equal(status, 200);
  assert.ok(!queries.some((q) => /\bemail\b/.test(q)), 'no statement selects an email');
  assert.deepEqual(body.firm, { id: 1, name: 'Alpha', company: 'Alpha Advisory Ltd', specialization: 'Go-to-market', status: 'active' });
  assert.deepEqual(value(body.accounts), [{ id: 11, name: 'Lio Testwell', headline: null, active: true }, { id: 10, name: 'Pia Example', headline: 'Sales lead', active: true }]);
  assert.equal(body.directory.listed, true);
  assert.equal(body.directory.featured, true);
  const deals = value(body.deals);
  assert.equal(deals.more, false);
  assert.deepEqual(deals.rows.map((d: any) => [d.id, d.status, d.redemptions]), [[2, 'expired', 1], [1, 'active', 2]]);
  assert.equal(deals.rows[1].granted_tier_investor, 'professional');
  const sets = value(body.settlements);
  assert.deepEqual(sets.rows.map((s: any) => [s.id, s.state]), [[3, 'issued'], [1, 'issued'], [4, 'draft'], [2, 'issued'], [5, 'issued']], 'every state, latest due first');
  const [profile] = value(body.profiles);
  assert.equal(profile.user_id, 10);
  assert.deepEqual(value(profile.expertise), ['Go-to-market', 'Sales hiring']);
  assert.deepEqual(value(profile.capital_capacity), { amount_cents: 25_000_000, currency: 'usd' });
  assert.equal(profile.geography.recorded, false);
  assert.equal(value(body.office_hours.when_to_book), 'After the first paying customers');
  assert.equal(body.office_hours.session_outcome.recorded, false);
  assert.deepEqual(value(body.office_hours.rating), { count: 2, average: 4.5 });
  assert.deepEqual(value(body.office_hours.lab_host), { status: 'approved', decided_at: '2026-10-01 10:00:00' });
  privateFree(body);
  const gamma = (await get(db, '/firms/3')).body;
  assert.deepEqual(value(gamma.accounts), []);
  assert.deepEqual(value(gamma.deals), { rows: [], more: false });
  assert.deepEqual(value(gamma.office_hours.rating), { count: 0, average: null });
  assert.deepEqual(value(gamma.office_hours.lab_host), { status: null, decided_at: null });
  db.close();
});

test('AP6: each block fails alone; the firm row failing is a 503, never a 404', async () => {
  // Mutation checked: the profiles catch returning [] → "no profile" instead of Unreadable; firm 503 → 404.
  const db = fixture();
  const blocks: Array<[RegExp, (b: any) => any]> = [
    [/FROM users WHERE partner_id = \?/, (b) => b.accounts],
    [/AS redemptions/, (b) => b.deals],
    [/FROM partner_deal_settlements s JOIN/, (b) => b.settlements],
    [/FROM partner_profiles/, (b) => b.profiles],
    [/FROM partner_booking_ratings/, (b) => b.office_hours.rating],
    [/FROM lab_host_applications/, (b) => b.office_hours.lab_host],
  ];
  for (const [re, pick] of blocks) {
    const { status, body } = await get(db, '/firms/1', { failOn: [re] });
    assert.equal(status, 200, String(re));
    failed(pick(body));
    for (const [other, otherPick] of blocks) if (other !== re) assert.equal(otherPick(body).available, true, `${re} cost ${other}`);
  }
  const down = await get(db, '/firms/1', { failOn: [/oh_session_outcome/] });
  assert.equal(down.status, 503);
  assert.equal(down.body.error, 'firm_unreadable');
  db.close();
});
