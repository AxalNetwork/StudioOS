/** D973 — mounted admin network reads on the actual SQLite schema, with source failures. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import route from '../src/routes/admin_network_reads.ts';
import standing from '../src/routes/admin_network.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { mutate } from './_channel_readiness.ts';

const NOW = Date.parse('2026-10-26T04:30:00Z'); // Monday 00:30 ET, after Sunday's UTC midnight.
const SECRET = 'test'.repeat(16);
const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const name of ['users', 'super_admins', 'user_sessions', 'advisors', 'network_profiles', 'partners', 'partner_profiles', 'partner_deals', 'advisor_bookings', 'partner_bookings', 'advisor_office_hour_slots', 'partner_office_hour_slots', 'advisor_reviews', 'advisor_cohort_assignments']) db.exec(tableFromBaseline(baseline, name));
  for (const [file, name] of [['313_lab_host_applications.sql', 'lab_host_applications'], ['238_advisor_engagements.sql', 'advisor_engagements'], ['477_mercury_personal.sql', 'partner_deal_settlements']]) db.exec(tableFromBaseline(readFileSync(new URL('../sql/migrations/' + file, import.meta.url), 'utf8'), name));
  const insert = (table: string, value: Record<string, any>) => db.prepare(`INSERT INTO ${table} (${Object.keys(value).join(',')}) VALUES (${Object.keys(value).map(() => '?').join(',')})`).run(...Object.values(value));
  for (const [id, role, name] of [[1, 'admin', 'Admin'], [2, 'advisor', 'Ada'], [3, 'partner', 'Ben'], [4, 'advisor', 'No profile'], [5, 'founder', 'PRIVATE FOUNDER'], [6, 'admin', 'Other admin'], [7, 'admin', 'Super']]) {
    insert('users', { id, role, name, email: `${id}@private.example`, partner_id: id === 3 ? 9 : null, kyc_status: 'approved', last_active_at: '2026-10-25 12:00:00' });
    insert('user_sessions', { user_id: id, jti: `j-${id}`, factor: 'totp' });
  }
  insert('super_admins', { user_id: 7 });
  for (const [id, user_id, display_name] of [[11, 2, 'Ada'], [12, null, 'Unlinked'], [13, 6, 'PRIVATE ADMIN PROFILE']]) insert('advisors', { id, uid: `a${id}`, user_id, display_name, email: 'PRIVATE EMAIL', headline: 'Scaling teams', expertise_json: '["Operations","Hiring"]', sectors_json: '["SaaS"]', hourly_rate_usd: 125 });
  insert('partners', { id: 9, name: 'Firm Nine', email: 'PRIVATE FIRM EMAIL', directory_listed: 1 });
  for (let id = 1; id <= 8; id++) insert('network_profiles', { id, name: id === 1 ? 'Ada' : `Roster ${id}`, kind: 'advisor', company: 'Deck Firm', skills_json: '["Hiring"]', display_order: id, photo_r2_key: id === 1 ? 'PRIVATE R2 KEY' : null, is_active: id !== 8 ? 1 : 0 });
  insert('partner_profiles', { email: 'PRIVATE PARTNER EMAIL', user_id: 3, admin_status: 'verified' });
  insert('lab_host_applications', { uid: 'h', user_id: 2, host_kind: 'advisor', host_id: 11, capacity: 'advisor', status: 'pending', statement: 'PRIVATE STATEMENT' });
  insert('partner_deals', { id: 1, user_id: 3, deal_type: 'capital_partnership', status: 'active', proposal_json: '{"private":"PRIVATE TERMS"}', expires_at: '2026-11-01 00:00:00' });
  insert('partner_deals', { id: 2, user_id: 3, deal_type: 'capital_partnership', status: 'active', proposal_json: '{}', expires_at: '2026-12-01T00:00:00Z' });
  insert('partner_deals', { id: 3, user_id: 3, deal_type: 'custom', status: 'expired', proposal_json: '{}' });
  insert('advisor_cohort_assignments', { uid: 'c', advisor_user_id: 2, cohort_cycle_id: 77, note: 'PRIVATE COHORT NOTE' });
  insert('advisor_engagements', { uid: 'e', advisor_id: 11, client_name: 'PRIVATE CLIENT NAME', lane: 'signed', shape: 'retainer' });
  for (const [id, starts_at, status] of [[1, '2026-10-26 03:59:59', 'completed'], [2, '2026-10-26 04:00:00', 'confirmed'], [3, '2026-10-26T04:10:00Z', 'no_show'], [4, '2026-10-26T05:00:00Z', 'confirmed'], [5, '2026-07-01T00:00:00Z', 'completed']]) {
    insert('advisor_office_hour_slots', { id, uid: `s${id}`, advisor_id: 11, starts_at, ends_at: starts_at, notes: 'PRIVATE SLOT NOTE' });
    insert('advisor_bookings', { id, uid: `b${id}`, slot_id: id, advisor_id: 11, founder_user_id: 5, status, topic: 'PRIVATE TOPIC' });
  }
  insert('partner_office_hour_slots', { id: 1, uid: 'ps', partner_id: 9, starts_at: '2026-10-26 04:20:00', ends_at: '2026-10-26 04:30:00' });
  insert('partner_bookings', { uid: 'pb', slot_id: 1, partner_id: 9, founder_user_id: 5, status: 'completed' });
  insert('advisor_reviews', { uid: 'r1', booking_id: 1, reviewer_user_id: 5, reviewer_role: 'founder', rating: 4, comment: 'PRIVATE REVIEW' });
  insert('advisor_reviews', { uid: 'r2', booking_id: 2, reviewer_user_id: 2, reviewer_role: 'advisor', rating: 1 });
  for (const [id, direction, amount_cents, due_on, state] of [[1, 'to_member', 1100, '2026-10-26', 'issued'], [2, 'from_member', 300, '2026-11-25', 'issued'], [3, 'to_member', 9000, '2026-11-26', 'issued'], [4, 'to_member', 999, '2026-10-27', 'draft']]) insert('partner_deal_settlements', { id, uid: `due${id}`, partner_deal_id: 1, user_id: 3, kind: 'capital', direction, amount_cents, currency: 'usd', due_on, state, drafted_by: 1 });
  return { db, insert };
}
async function get(db: any, path: string, as = 1, extra: any = {}, mounted = route, clock = NOW) {
  const token = await new SignJWT({ user_id: as, role: as === 5 ? 'founder' : 'admin', jti: `j-${as}` }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const app = new Hono<any>(); app.route('/api/admin/network', mounted);
  const queries: string[] = []; const d1 = d1Over(db);
  const traced = { ...d1, prepare(sql: string) { queries.push(sql); return d1.prepare(sql); } };
  const before = Date.now; Date.now = () => clock;
  try {
    const response = await app.request('/api/admin/network' + path, { headers: as ? { Authorization: `Bearer ${token}` } : {} }, { DB: traced, JWT_SECRET: SECRET, ENVIRONMENT: 'development', ...extra });
    return { status: response.status, body: await response.json() as any, queries };
  } finally { Date.now = before; }
}
const value = (block: any) => { assert.equal(block.available, true); assert.equal(block.recorded, true); return block.value; };
const unknown = (block: any) => { assert.equal(block.recorded, false); assert.ok(block.reason); assert.equal('value' in block, false); };
const failed = (block: any) => { assert.equal(block.available, false); assert.ok(block.reason); assert.equal('value' in block, false); };
function privateFree(body: any) { assert.doesNotMatch(JSON.stringify(body), /PRIVATE|private\.example|photo_r2_key|founder_user_id|reviewer_user_id|proposal_json/); }

test('admin gate rejects anonymous and member before network reads', async () => {
  const { db } = fixture();
  assert.equal((await get(db, '/overview', 0)).status, 401);
  assert.equal((await get(db, '/people', 5)).status, 403);
  assert.equal((await get(db, '/people/user:2', 5)).status, 403);
  db.close();
});
async function overviewGate(mounted = route) {
  const { db } = fixture();
  try {
    const { status, body: b } = await get(db, '/overview', 1, {}, mounted);
    assert.equal(status, 200); assert.deepEqual(b.unreadable, []);
    assert.equal(value(b.counts.people), 12); unknown(b.counts.by_stage);
    assert.deepEqual(value(b.counts.by_kind), [{ kind: 'advisor', count: 3 }, { kind: 'operating_partner', count: 1 }, { kind: 'deck_only', count: 8 }]);
    const chart = value(b.sessions); assert.equal(chart.weeks.length, 12); assert.equal(chart.timezone, 'America/New_York');
    assert.deepEqual(chart.weeks.at(-1), { week: '2026-10-26', partial: true, booked: 1, completed: 1, no_show: 1, cancelled: 0 });
    assert.equal(chart.weeks.at(-2).completed, 1); assert.equal(chart.weeks.filter((x: any) => x.partial).length, 1);
    assert.equal(chart.this_month, 4);
    assert.deepEqual(value(b.deals).by_type, [{ type: 'capital_partnership', count: 2, soonest_end: '2026-11-01 00:00:00' }]);
    assert.equal(value(b.deals).ending_soon, 1);
    const due = value(b.settlements); assert.equal(due.count, 2); assert.equal(due.to_member_cents, 1100); assert.equal(due.from_member_cents, 300);
    unknown(value(b.skills).demand); assert.equal(value(b.skills).supply.find((x: any) => x.skill === 'Hiring').count, 10);
    assert.equal(value(b.needs_you.missing_advisor_profiles).length, 1); assert.equal(value(b.needs_you.pending_hosts).length, 1); assert.equal(value(b.needs_you.missing_deck_photos).length, 5);
    privateFree(b);
  } finally { db.close(); }
}
test('overview reads stored counts, ET weeks, partial current week, due directions and unknown stages', () => overviewGate());

async function peopleGate(mounted = route) {
  const { db } = fixture();
  try {
    const { body: b } = await get(db, '/people?limit=2&offset=0', 1, {}, mounted);
    assert.equal(b.available, true); assert.equal(b.total, 12); assert.equal(b.items.length, 2);
    assert.deepEqual(b.items.map((x: any) => x.ref), ['roster:1', 'user:2']); // same name stays two identities.
    const { body: page2 } = await get(db, '/people?limit=2&offset=2', 1, {}, mounted);
    assert.equal(page2.total, 12); assert.equal(new Set([...b.items, ...page2.items].map(x => x.ref)).size, 4);
    for (const [q, refs] of [['q=scaling&kind=advisor', ['user:2', 'advisor:12']], ['q=firm+nine', ['user:3']], ['skill=hiring&sector=SaaS', ['user:2', 'advisor:12']], ['lab_host=pending', ['user:2']], ['profile_check=verified&firm_attached=true&active_deal=true', ['user:3']], ['on_deck=true', ['roster:1', 'roster:2', 'roster:3', 'roster:4', 'roster:5', 'roster:6']]]) {
      const { body } = await get(db, '/people?' + q, 1, {}, mounted); assert.deepEqual(body.items.map((x: any) => x.ref), refs, String(q));
    }
    const { body: empty } = await get(db, "/people?q=%27%20OR%201%3D1--", 1, {}, mounted); assert.equal(empty.total, 0);
    for (const q of ['limit=101', 'limit=0', 'offset=-1', 'offset=1.5', 'sort=sql', 'kind=founder', 'on_deck=maybe', 'stage=active']) assert.equal((await get(db, '/people?' + q, 1, {}, mounted)).status, 400);
    privateFree(b);
  } finally { db.close(); }
}
test('people search, stable pages, literal search, real links, filters and validation', () => peopleGate());

async function drawerGate(mounted = route) {
  const { db } = fixture();
  try {
    const { status, body: b, queries } = await get(db, '/people/user:2', 1, {}, mounted);
    assert.equal(status, 200); assert.equal(b.person.ref, 'user:2');
    assert.deepEqual(value(b.work.sessions_90d), { booked: 1, completed: 1, no_show: 1, cancelled: 0, total: 3 });
    assert.deepEqual(value(b.person.rating), { count: 1, average: 4 }); assert.deepEqual(value(b.terms.hourly_rate), { amount_cents: 12500, currency: 'usd' });
    assert.equal(value(b.work.engagements).find((x: any) => x.lane === 'signed').count, 1);
    assert.equal(value(b.work.open_slots_14d), 1); unknown(b.terms.payout_readiness); unknown(b.terms.studio_agreement); unknown(b.history);
    const partner = (await get(db, '/people/user:3', 1, {}, mounted)).body;
    unknown(partner.work.sessions_90d); assert.equal(value(partner.work.firm_sessions_90d).completed, 1);
    assert.equal((await get(db, '/people/user:6', 1, {}, mounted)).status, 404);
    assert.equal((await get(db, '/people/user:6', 7, {}, mounted)).status, 200);
    assert.equal((await get(db, '/people/user:6', 6, {}, mounted)).status, 200);
    assert.equal((await get(db, '/people/name:Ada', 1, {}, mounted)).status, 404);
    privateFree(b); privateFree(partner); assert.doesNotMatch(queries.join('\n'), /SELECT[^\n]*client_name/);
  } finally { db.close(); }
}
test('drawer has public fields and lane counts, keeps firm sessions separate and admin profiles private', () => drawerGate());

async function failureGate(mounted = route) {
  const { db } = fixture();
  try {
    db.exec('DROP TABLE partner_bookings; DROP TABLE partner_deal_settlements');
    const { body: b } = await get(db, '/overview', 1, {}, mounted);
    failed(b.sessions); failed(b.settlements); assert.equal(value(b.counts.people), 12); assert.equal(value(b.deals).total, 2);
    const branch = (await get(db, '/overview', 1, { BRANCH_CODE: 'unit' }, mounted)).body;
    unknown(branch.settlements); assert.match(branch.settlements.reason, /kept by HQ/); assert.equal(branch.unreadable.includes('settlements'), false);
    db.exec('DROP TABLE partners');
    const people = (await get(db, '/people', 1, {}, mounted)).body;
    assert.equal(people.total, 12); failed(people.items.find((p: any) => p.ref === 'user:3').firm);
    failed((await get(db, '/people/user:3', 1, {}, mounted)).body.work.firm_sessions_90d);
    assert.equal((await get(db, '/people?q=Firm', 1, {}, mounted)).status, 503);
    db.exec('DROP TABLE network_profiles');
    const partial = (await get(db, '/people', 1, {}, mounted)).body; assert.equal(partial.total, null); assert.equal(partial.available, false); assert.equal(partial.items.length, 4);
    assert.equal((await get(db, '/people/roster:1', 1, {}, mounted)).status, 503);
  } finally { db.close(); }
}
test('failed blocks remain unreadable, unrelated blocks survive and branches never read HQ settlements', () => failureGate());

test('people totals and search include matches beyond the old 500-advisor cap', async () => {
  const { db, insert } = fixture();
  for (let n = 100; n < 705; n++) insert('users', { id: n, email: `fake${n}@example.test`, role: 'advisor', name: `Zed ${n}` });
  const { body } = await get(db, '/people?offset=610&limit=10'); assert.equal(body.total, 617); assert.equal(body.items.length, 7);
  const last = (await get(db, '/people?q=Zed+704')).body; assert.equal(last.total, 1); assert.equal(last.items[0].ref, 'user:704'); db.close();
});

test('malformed skills cannot silently turn a filtered list into a healthy empty total', async () => {
  const { db } = fixture(); db.exec("UPDATE advisors SET expertise_json = 'broken' WHERE id = 11");
  assert.equal((await get(db, '/people?skill=Hiring')).status, 503);
  const b = (await get(db, '/overview')).body; failed(b.skills); assert.equal(value(b.counts.people), 12); db.close();
});

test('ET weeks remain correct after the November daylight-saving change', async () => {
  const { db } = fixture();
  db.exec("DELETE FROM partner_bookings; DELETE FROM advisor_bookings WHERE id > 2; UPDATE advisor_bookings SET status = 'completed'; UPDATE advisor_office_hour_slots SET starts_at = CASE id WHEN 1 THEN '2026-11-02 04:59:59' ELSE '2026-11-02 05:00:00' END");
  const b = (await get(db, '/overview', 1, {}, route, Date.parse('2026-11-02T05:30:00Z'))).body;
  const weeks = value(b.sessions).weeks; assert.equal(weeks.at(-1).week, '2026-11-02'); assert.equal(weeks.at(-1).completed, 1); assert.equal(weeks.at(-2).completed, 1); db.close();
});
test('healthy empty stores return real zero and empty lists, distinct from unknown or failed', async () => {
  const { db } = fixture();
  for (const table of ['advisors', 'network_profiles', 'partners', 'partner_profiles', 'partner_deals', 'advisor_bookings', 'partner_bookings', 'advisor_office_hour_slots', 'partner_office_hour_slots', 'advisor_reviews', 'advisor_cohort_assignments', 'lab_host_applications', 'advisor_engagements', 'partner_deal_settlements']) db.exec(`DELETE FROM ${table}`);
  db.exec('DELETE FROM users WHERE id <> 1');
  const b = (await get(db, '/overview')).body; assert.equal(value(b.counts.people), 0); assert.equal(value(b.deals).total, 0); assert.equal(value(b.settlements).count, 0); assert.ok(value(b.sessions).weeks.every((w: any) => w.booked === 0 && w.completed === 0 && w.no_show === 0)); unknown(b.counts.by_stage);
  const p = (await get(db, '/people')).body; assert.equal(p.available, true); assert.equal(p.total, 0); assert.deepEqual(p.items, []); assert.equal((await get(db, '/people/user:2')).status, 404); db.close();
});
test('failed advisor enrichment never describes a missing individual profile as known', async () => {
  const { db } = fixture(); db.exec('DROP TABLE advisors');
  const p = (await get(db, '/people/user:2')).body.person;
  failed(p.sessions_90d); failed(p.skills); failed(p.sectors); failed(p.hourly_rate); failed(p.rating);
  const b = (await get(db, '/overview')).body; failed(b.counts.people); assert.equal(value(b.deals).total, 2); db.close();
});
async function accountFailureGate(mounted = route) {
  const { db } = fixture(); db.exec('ALTER TABLE users DROP COLUMN last_active_at');
  const b = (await get(db, '/people/user:2', 1, {}, mounted)).body;
  assert.equal(b.person.ref, 'user:2'); failed(b.person.kyc); failed(b.person.last_active); failed(b.person.member_active); failed(b.person.firm);
  assert.equal(value(b.work.sessions_90d).total, 3); db.close();
}
test('a failed account projection keeps joined identities but marks account columns unreadable', () => accountFailureGate());
async function invalidRateGate(mounted = route) {
  const { db } = fixture(); db.exec("UPDATE advisors SET hourly_rate_usd = '' WHERE id = 11");
  const b = (await get(db, '/people/user:2', 1, {}, mounted)).body; failed(b.terms.hourly_rate); assert.equal(value(b.work.sessions_90d).total, 3); db.close();
}
test('a corrupt legacy hourly rate never becomes a free zero-dollar rate', () => invalidRateGate());
test('rating, sessions, activity and descending name sorts use stored values with nulls last', async () => {
  const { db } = fixture();
  for (const sort of ['rating_desc', 'sessions_desc']) assert.equal((await get(db, '/people?sort=' + sort)).body.items[0].ref, 'user:2');
  db.exec("UPDATE users SET last_active_at = '2026-10-26 04:00:00' WHERE id = 3");
  assert.equal((await get(db, '/people?sort=last_active_desc')).body.items[0].ref, 'user:3');
  assert.equal((await get(db, '/people?sort=name_desc')).body.items[0].ref, 'advisor:12'); db.close();
});

// Every mutant must fail the same behavioral gate that the real mounted route passes.
for (const [tag, before, after, gate] of [
  ['auth', 'await requireAdmin(c as any)', '({ id: 1, role: "admin" })', async (r: any) => { const { db } = fixture(); try { assert.equal((await get(db, '/people', 5, {}, r)).status, 403); } finally { db.close(); } }],
  ['timezone', "timeZone: COHORT_TZ, year:", "timeZone: 'UTC', year:", overviewGate],
  ['partial', 'partial: i === 11', 'partial: false', overviewGate],
  ['privacy', 'SELECT advisor_id, lane, COUNT(*) AS n FROM advisor_engagements GROUP BY advisor_id, lane', 'SELECT advisor_id, lane, client_name, COUNT(*) AS n FROM advisor_engagements GROUP BY advisor_id, lane', drawerGate],
  ['invalid-money', "if (typeof value !== 'number') return unreadable('Hourly rate could not be read. Try again.');", '', invalidRateGate],
  ['account-kyc', 'kyc: userId != null && !has(s.accounts) ? s.accounts : u ?', 'kyc: u ?', accountFailureGate],
  ['account-activity', 'last_active: userId != null && !has(s.accounts) ? s.accounts : u ?', 'last_active: u ?', accountFailureGate],
  ['account-state', 'member_active: userId != null && !has(s.accounts) ? s.accounts : u ?', 'member_active: u ?', accountFailureGate],
  ['firm-session-failure', "row.kind === 'operating_partner' ? !has(row.firm) ? row.firm : sessionCounts", "row.kind === 'operating_partner' ? sessionCounts", failureGate],
  ['money', 'Number(value) * 100', 'Number(value)', drawerGate],
  ['total', 'total: complete ? list.length : null', 'total: complete ? list.slice(offset, offset + limit).length : null', peopleGate],
  ['failure', "return unreadable(`${key} could not be read. Try again.`);", 'return ok([]);', failureGate],
  ['hq', 'includeSettlements && !branch', 'includeSettlements', failureGate],
] as const) test('mutation rejected: ' + tag, async () => {
  const changed = await mutate('../src/routes/admin_network_reads.ts', before, after, tag);
  await assert.rejects(() => gate(changed.default), undefined, `${tag} must be caught`);
});


test('D973 opaque drawer refs coexist with D976 numeric standing in the mounted order', async () => {
  const { db } = fixture();
  const combined = new Hono<any>(); combined.route('/', route); combined.route('/', standing);
  try {
    const drawer = await get(db, '/people/user%3A2', 1, {}, combined);
    assert.equal(drawer.status, 200); assert.equal(drawer.body.person.ref, 'user:2');
    const numeric = await get(db, '/people/2', 1, {}, combined);
    assert.equal(numeric.status, 200); assert.equal(numeric.body.user_id, 2);
    assert.equal((await get(db, '/overview', 1, {}, combined)).status, 200);
  } finally { db.close(); }
});
