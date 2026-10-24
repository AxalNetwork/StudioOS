/**
 * D976 / #2762 — the advisor and partner network: a stage per person, Pause and
 * Resume with a reason, the advisor directory switch, and one person's standing.
 *
 * On node:sqlite over the baseline's own tables and the migrations' own DDL:
 *   1. Migration 552 stands alone, and the lazy mirror declares the same columns.
 *   2. The stage, rule by rule, in its order.
 *   3. Pause and Resume: admin only, a reason required, audited, refused twice.
 *      A paused advisor takes no new booking, leaves the advisor directory and
 *      the Lab's office hours; a booking already made stays.
 *   4. The directory switch: an advisor only; hiding keeps booking open.
 *   5. The standing read: ratings, sessions, engagement lanes, payout, studio
 *      agreement and Lab host, each alone; a failed block is unreadable, a block
 *      with no store is not recorded; no client name and no rating comment.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import adminNetwork from '../src/routes/admin_network.ts';
import advisors from '../src/routes/advisors.ts';
import { labHosts } from '../src/routes/lab_hosts.ts';
import { NETWORK_STATES_DDL } from '../src/services/networkStatesSchema.ts';
import { kindOf, loadPerson, readStanding, stageOf } from '../src/services/networkStanding.ts';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const MIGRATION = read('cloudflare-worker/sql/migrations/552_network_member_states.sql');
const JWT_SECRET = 'synthetic-network-standing-key-0123456789';
// Wednesday 21 October 2026, noon UTC.
const NOW = Date.parse('2026-10-21T12:00:00Z');
const iso = (days: number) => new Date(NOW + days * 86400e3).toISOString();

const ADMIN = 1, VIC = 2, PIA = 3, NED = 4, FAY = 5, EVE = 6, OLD = 7, NOPRO = 8;

function makeD1(db: InstanceType<typeof DatabaseSync>, failing: string[]) {
  const coerce = (a: any[]) => a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
  const check = (sql: string) => { for (const f of failing) if (sql.includes(f)) throw new Error('SQLITE_ERROR: synthetic failure fixture-secret-text'); };
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { check(sql); return db.prepare(sql).get(...b) ?? null; },
        async all() { check(sql); return { results: db.prepare(sql).all(...b) }; },
        async run() { check(sql); const r = db.prepare(sql).run(...b); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const out = []; for (const s of x) out.push(await s.run()); return out; },
  };
}

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const t of ['users', 'partners', 'advisors', 'activity_logs', 'admin_audit_log', 'advisor_bookings', 'advisor_office_hour_slots',
    'advisor_reviews', 'partner_bookings', 'partner_office_hour_slots', 'partner_invitations']) {
    db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  }
  db.exec(read('cloudflare-worker/sql/migrations/313_lab_host_applications.sql'));
  db.exec(stripForeignKeys(tableFromBaseline(read('cloudflare-worker/sql/migrations/238_advisor_engagements.sql'), 'advisor_engagements')));
  db.exec(stripForeignKeys(tableFromBaseline(read('cloudflare-worker/sql/migrations/241_advisor_money_model.sql'), 'advisor_payout_accounts')));
  db.exec(stripForeignKeys(tableFromBaseline(read('cloudflare-worker/sql/migrations/361_partner_booking_ratings.sql'), 'partner_booking_ratings')));
  db.exec(MIGRATION);
  const u = db.prepare('INSERT INTO users (id, email, role, name, partner_id, spinout_lab_active, is_active) VALUES (?,?,?,?,?,?,?)');
  u.run(ADMIN, 'admin@example.test', 'admin', 'Admin fixture', null, 0, 1);
  u.run(VIC, 'vic@example.test', 'advisor', 'Advisor fixture', null, 0, 1);
  u.run(PIA, 'pia@example.test', 'partner', 'Partner fixture', 20, 0, 1);
  u.run(NED, 'ned@example.test', 'partner', 'Unattached fixture', null, 0, 1);
  u.run(FAY, 'fay@example.test', 'founder', 'Founder fixture', null, 0, 1);
  u.run(EVE, 'eve@example.test', 'exploring', 'Explorer fixture', null, 1, 1);
  u.run(OLD, 'old@example.test', 'advisor', 'Former fixture', null, 0, 0);
  u.run(NOPRO, 'nopro@example.test', 'advisor', 'Onboarding fixture', null, 0, 1);
  db.exec(`INSERT INTO partners (id, name, company, email, status) VALUES (20, 'Firm fixture', 'Firm Co', 'firm@example.test', 'active');
    INSERT INTO advisors (id, uid, user_id, display_name, email, is_active, created_at, updated_at)
      VALUES (30, 'adv-vic', ${VIC}, 'Advisor fixture', 'vic@example.test', 1, '2026-01-01', '2026-01-01'),
             (31, 'adv-old', ${OLD}, 'Former fixture', 'old@example.test', 1, '2026-01-01', '2026-01-01');
    INSERT INTO advisor_office_hour_slots (id, uid, advisor_id, starts_at, ends_at, capacity, is_cancelled, created_at)
      VALUES (1, 's1', 30, '${iso(-10)}', '${iso(-10 + 1 / 24)}', 3, 0, '2026-01-01'),
             (2, 's2', 30, '${iso(5)}', '${iso(5 + 1 / 24)}', 3, 0, '2026-01-01'),
             (3, 's3', 30, '${iso(-200)}', '${iso(-200 + 1 / 24)}', 3, 0, '2026-01-01'),
             (4, 's4', 30, '${iso(20)}', '${iso(20 + 1 / 24)}', 1, 0, '2026-01-01'),
             (5, 's5', 30, '${iso(6)}', '${iso(6 + 1 / 24)}', 1, 1, '2026-01-01'),
             (6, 's6', 30, '${iso(-90.5)}', '${iso(-90.5 + 1 / 24)}', 1, 0, '2026-01-01'),
             (7, 's7', 30, '${iso(7)}', '${iso(7 + 1 / 24)}', 1, 0, '2026-01-01');
    INSERT INTO advisor_bookings (id, uid, slot_id, advisor_id, founder_user_id, status, created_at, updated_at) VALUES
      (1, 'b1', 1, 30, ${FAY}, 'completed', '2026-01-01', '2026-01-01'),
      (2, 'b2', 1, 30, ${EVE}, 'no_show', '2026-01-01', '2026-01-01'),
      (3, 'b3', 1, 30, ${NED}, 'confirmed', '2026-01-01', '2026-01-01'),
      (4, 'b4', 2, 30, ${FAY}, 'confirmed', '2026-01-01', '2026-01-01'),
      (5, 'b5', 3, 30, ${FAY}, 'completed', '2026-01-01', '2026-01-01'),
      (6, 'b6', 2, 30, ${NED}, 'cancelled', '2026-01-01', '2026-01-01'),
      (7, 'b7', 6, 30, ${NED}, 'completed', '2026-01-01', '2026-01-01'),
      (8, 'b8', 7, 30, ${EVE}, 'confirmed', '2026-01-01', '2026-01-01');
    INSERT INTO advisor_reviews (uid, booking_id, reviewer_user_id, reviewer_role, rating, comment, created_at) VALUES
      ('r1', 1, ${FAY}, 'founder', 5, 'Comment fixture one', '2026-01-01'),
      ('r2', 5, ${FAY}, 'founder', 4, 'Comment fixture two', '2026-01-01'),
      ('r3', 1, ${VIC}, 'advisor', 1, 'Advisor note fixture', '2026-01-01');
    INSERT INTO advisor_engagements (uid, advisor_id, client_name, lane) VALUES
      ('e1', 30, 'Client fixture A', 'signed'), ('e2', 30, 'Client fixture B', 'signed'), ('e3', 30, 'Client fixture C', 'drafting'), ('e4', 30, 'Client fixture D', 'renewal_due');
    INSERT INTO advisor_payout_accounts (uid, advisor_id, state, charges_enabled, payouts_enabled) VALUES ('pa1', 30, 'verified', 1, 1);
    INSERT INTO partner_office_hour_slots (id, uid, partner_id, starts_at, ends_at, capacity, is_cancelled, created_at)
      VALUES (1, 'ps1', 20, '${iso(-3)}', '${iso(-3 + 1 / 24)}', 2, 0, '2026-01-01'), (2, 'ps2', 20, '${iso(3)}', '${iso(3 + 1 / 24)}', 2, 0, '2026-01-01');
    INSERT INTO partner_bookings (id, uid, slot_id, partner_id, founder_user_id, status, created_at, updated_at) VALUES
      (1, 'pb1', 1, 20, ${FAY}, 'completed', '2026-01-01', '2026-01-01'), (2, 'pb2', 2, 20, ${FAY}, 'pending', '2026-01-01', '2026-01-01');
    INSERT INTO partner_booking_ratings (booking_id, partner_id, founder_user_id, rating, comment) VALUES (1, 20, ${FAY}, 3, 'Partner comment fixture');
    INSERT INTO partner_invitations (token, recipient_email, invited_by_user_id, status, expires_at, signed_at, resulting_user_id, created_at)
      VALUES ('tok1', 'pia@example.test', ${ADMIN}, 'signed', '2027-01-01', '2026-09-12T10:00:00Z', ${PIA}, '2026-09-01'),
             ('tok2', 'ned@example.test', ${ADMIN}, 'profiled', '2027-01-01', NULL, ${NED}, '2026-09-01');
    INSERT INTO lab_host_applications (uid, user_id, host_kind, host_id, capacity, status, reviewed_at)
      VALUES ('lh1', ${VIC}, 'advisor', 30, 'advisor', 'approved', '2026-10-05T00:00:00Z');`);
  const failing: string[] = [];
  const env: any = { DB: makeD1(db, failing), ENVIRONMENT: 'development', JWT_SECRET };
  async function call(router: any, method: string, path: string, user: number | null, body?: unknown) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (user != null) {
      headers.Authorization = 'Bearer ' + await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
    }
    const res = await router.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env,
      { waitUntil() {}, passThroughOnException() {}, props: {} } as any);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  }
  return { db, env, call, fail: (s: string) => failing.push(s) };
}

const unreadableShape = (b: any) => {
  assert.equal(b.available, false);assert.equal(b.unreadable, true);
  assert.match(b.reason, /could not be read/);assert.doesNotMatch(b.reason, /SQLITE|fixture-secret-text/);
  assert.deepEqual(Object.keys(b).sort(), ['available', 'reason', 'unreadable']);
};
const NAMES = /Client fixture|Comment fixture|Advisor note fixture|Partner comment fixture|@example\.test/;

test('D976 migration 552 stands alone, and the lazy mirror declares its columns', () => {
  const cols = (sql: string) => {
    const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
    db.exec(stripForeignKeys(tableFromBaseline(BASELINE, 'users')));db.exec(sql);
    return db.prepare('PRAGMA table_info(network_member_states)').all().map((c: any) => `${c.name}:${c.type}:${c.notnull}:${c.pk}`);
  };
  assert.deepEqual(cols(NETWORK_STATES_DDL), cols(MIGRATION));
  assert.ok(cols(MIGRATION).includes('paused_reason:TEXT:0:0'));assert.ok(cols(MIGRATION).includes('user_id:INTEGER:0:1'));
});

test('D976 stage: ended, then paused, then onboarding, then active', () => {
  const base = { user_id: 1, role: 'advisor', user_active: 1, partner_id: null, kyc_status: null, advisor_id: 30, advisor_active: 1,
    firm_status: null, paused_at: null, paused_reason: null, resumed_at: null, resume_reason: null, directory_hidden_at: null };
  assert.equal(stageOf(base), 'active');
  assert.equal(stageOf({ ...base, paused_at: 'x' }), 'paused');
  assert.equal(stageOf({ ...base, user_active: 0, paused_at: 'x' }), 'ended', 'an inactive account has ended, paused or not');
  assert.equal(stageOf({ ...base, advisor_active: 0, paused_at: 'x' }), 'ended');
  assert.equal(stageOf({ ...base, advisor_id: null }), 'onboarding');
  assert.equal(stageOf({ ...base, advisor_id: null, paused_at: 'x' }), 'paused');
  assert.equal(stageOf({ ...base, directory_hidden_at: 'x' }), 'active', 'hidden from the directory is not a stage');
  const partner = { ...base, role: 'partner', advisor_id: null, advisor_active: null, partner_id: 20, firm_status: 'active' };
  assert.equal(stageOf(partner), 'active');
  assert.equal(stageOf({ ...partner, partner_id: null, firm_status: null }), 'onboarding');
  assert.equal(stageOf({ ...partner, firm_status: 'inactive' }), 'ended');
  assert.equal(kindOf({ role: 'founder', advisor_id: 5 }), 'advisor', 'an advisor profile makes an advisor, whatever the role');
  assert.equal(kindOf({ role: 'founder', advisor_id: null }), null);
});

test('D976 pause: admin only, a reason required, audited, refused twice, refused once ended', async () => {
  const f = fixture();
  assert.equal((await f.call(adminNetwork, 'POST', `/people/${VIC}/pause`, FAY, { reason: 'Reason fixture' })).status, 403);
  assert.equal((await f.call(adminNetwork, 'POST', `/people/${VIC}/pause`, null, { reason: 'Reason fixture' })).status, 401);
  for (const reason of [undefined, '', '   ', 7, {}]) {
    const r = await f.call(adminNetwork, 'POST', `/people/${VIC}/pause`, ADMIN, { reason });
    assert.equal(r.status, 400);assert.deepEqual(r.body, { error: 'reason_required' });
  }
  assert.deepEqual((await f.call(adminNetwork, 'POST', `/people/${FAY}/pause`, ADMIN, { reason: 'x' })).body, { error: 'not_in_network' });
  assert.equal((await f.call(adminNetwork, 'POST', '/people/999/pause', ADMIN, { reason: 'x' })).status, 404);
  assert.equal((await f.call(adminNetwork, 'POST', '/people/abc/pause', ADMIN, { reason: 'x' })).status, 404);
  assert.deepEqual((await f.call(adminNetwork, 'POST', `/people/${OLD}/pause`, ADMIN, { reason: 'x' })).body, { error: 'ended' });

  const long = 'Reason fixture '.repeat(100);
  const r = await f.call(adminNetwork, 'POST', `/people/${VIC}/pause`, ADMIN, { reason: '  ' + long + '  ' });
  assert.equal(r.status, 200);assert.equal(r.body.stage, 'paused');
  assert.deepEqual(r.body.effects, ['advisor_bookings_stop', 'advisor_directory_hidden', 'lab_office_hours_hidden']);
  const row: any = f.db.prepare('SELECT * FROM network_member_states WHERE user_id = ?').get(VIC);
  assert.equal(row.paused_reason, long.trim().slice(0, 1000));assert.equal(row.paused_by, ADMIN);assert.ok(row.paused_at);
  const audit: any = f.db.prepare("SELECT * FROM admin_audit_log WHERE action = 'network.paused'").get();
  assert.equal(audit.admin_user_id, ADMIN);assert.equal(audit.viewed_user_id, VIC);
  assert.equal(JSON.parse(audit.filters_json).reason, long.trim().slice(0, 1000));

  const again = await f.call(adminNetwork, 'POST', `/people/${VIC}/pause`, ADMIN, { reason: 'Second fixture' });
  assert.equal(again.status, 409);assert.deepEqual(again.body, { error: 'already_paused' });
  assert.equal((f.db.prepare('SELECT paused_reason FROM network_member_states WHERE user_id = ?').get(VIC) as any).paused_reason, long.trim().slice(0, 1000));
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'network.paused'").get()!.n, 1);

  const partner = await f.call(adminNetwork, 'POST', `/people/${PIA}/pause`, ADMIN, { reason: 'Partner reason fixture' });
  assert.equal(partner.status, 200);assert.equal(partner.body.stage, 'paused');
  assert.deepEqual(partner.body.effects, [], 'a partner account has no advisor booking or listing to stop');
});

test('D976 a paused advisor takes no new booking and leaves both directories; bookings made stay; resume restores', async () => {
  const f = fixture();
  const listed = async () => (await f.call(advisors, 'GET', '/', FAY)).body.items.map((m: any) => m.uid);
  const lab = async () => (await f.call(labHosts, 'GET', '/directory', EVE)).body.items.filter((i: any) => i.kind === 'advisor').map((i: any) => i.uid);
  assert.deepEqual(await listed(), ['adv-vic', 'adv-old']);assert.deepEqual(await lab(), ['adv-vic']);

  await f.call(adminNetwork, 'POST', `/people/${VIC}/pause`, ADMIN, { reason: 'Reason fixture' });
  assert.deepEqual(await listed(), ['adv-old']);assert.deepEqual(await lab(), []);
  const refused = await f.call(advisors, 'POST', '/slots/4/book', EVE, { topic: 'Topic fixture' });
  assert.equal(refused.status, 409);assert.equal(refused.body.code, 'advisor_paused');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM advisor_bookings WHERE slot_id = 4').get()!.n, 0);
  assert.equal(f.db.prepare("SELECT status FROM advisor_bookings WHERE id = 4").get()!.status, 'confirmed', 'a booking already made stays');

  for (const reason of [undefined, '  ']) assert.equal((await f.call(adminNetwork, 'POST', `/people/${VIC}/resume`, ADMIN, { reason })).status, 400);
  const resumed = await f.call(adminNetwork, 'POST', `/people/${VIC}/resume`, ADMIN, { reason: 'Back fixture' });
  assert.equal(resumed.status, 200);assert.equal(resumed.body.stage, 'active');
  const row: any = f.db.prepare('SELECT * FROM network_member_states WHERE user_id = ?').get(VIC);
  assert.equal(row.paused_at, null);assert.equal(row.resume_reason, 'Back fixture');assert.equal(row.resumed_by, ADMIN);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'network.resumed'").get()!.n, 1);
  assert.deepEqual((await f.call(adminNetwork, 'POST', `/people/${VIC}/resume`, ADMIN, { reason: 'Again fixture' })).body, { error: 'not_paused' });
  assert.deepEqual(await listed(), ['adv-vic', 'adv-old']);assert.deepEqual(await lab(), ['adv-vic']);
  const booked = await f.call(advisors, 'POST', '/slots/4/book', EVE, { topic: 'Topic fixture' });
  assert.equal(booked.status, 200, JSON.stringify(booked.body));
});

test('D976 directory switch: an advisor only; hiding leaves booking open; refused twice either way', async () => {
  const f = fixture();
  assert.equal((await f.call(adminNetwork, 'POST', `/people/${VIC}/directory`, FAY, { listed: false })).status, 403);
  assert.deepEqual((await f.call(adminNetwork, 'POST', `/people/${PIA}/directory`, ADMIN, { listed: false })).body, { error: 'not_an_advisor' });
  assert.deepEqual((await f.call(adminNetwork, 'POST', `/people/${NOPRO}/directory`, ADMIN, { listed: false })).body, { error: 'not_an_advisor' });
  for (const listed of [undefined, 'false', 0]) assert.equal((await f.call(adminNetwork, 'POST', `/people/${VIC}/directory`, ADMIN, { listed })).status, 400);
  assert.deepEqual((await f.call(adminNetwork, 'POST', `/people/${VIC}/directory`, ADMIN, { listed: true })).body, { error: 'not_hidden' });

  const hid = await f.call(adminNetwork, 'POST', `/people/${VIC}/directory`, ADMIN, { listed: false });
  assert.deepEqual(hid.body, { user_id: VIC, hidden_by_admin: true, listed: false });
  assert.deepEqual((await f.call(advisors, 'GET', '/', FAY)).body.items.map((m: any) => m.uid), ['adv-old']);
  assert.deepEqual((await f.call(labHosts, 'GET', '/directory', EVE)).body.items.map((i: any) => i.uid), ['adv-vic'], 'hiding is the advisor directory only');
  assert.equal((await f.call(advisors, 'POST', '/slots/4/book', EVE, { topic: 'Topic fixture' })).status, 200, 'a hidden advisor is still bookable');
  assert.deepEqual((await f.call(adminNetwork, 'POST', `/people/${VIC}/directory`, ADMIN, { listed: false })).body, { error: 'already_hidden' });
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'network.directory_hidden'").get()!.n, 1);

  await f.call(adminNetwork, 'POST', `/people/${VIC}/pause`, ADMIN, { reason: 'Reason fixture' });
  const shown = await f.call(adminNetwork, 'POST', `/people/${VIC}/directory`, ADMIN, { listed: true });
  assert.deepEqual(shown.body, { user_id: VIC, hidden_by_admin: false, listed: false }, 'Show does not lift a pause');
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'network.directory_shown'").get()!.n, 1);
});

test('D976 standing: an advisor\'s ratings, sessions, engagement lanes, payout and Lab host; no agreement store', async () => {
  const f = fixture();
  const s: any = await readStanding(f.env, (await loadPerson(f.env, VIC))!, NOW);
  assert.equal(s.kind, 'advisor');assert.equal(s.stage, 'active');assert.equal(s.pause.paused, false);
  assert.deepEqual(s.directory, { listed: true, hidden_by_admin: false, hidden_at: null });
  assert.deepEqual(s.ratings, { available: true, scope: 'advisor', count: 2, average: 4.5, by_score: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 1 } }, 'founders only');
  assert.deepEqual(s.sessions, { available: true, scope: 'advisor', window_days: 90,
    counts: { completed: 1, upcoming: 2, cancelled: 0, no_show: 1, not_marked: 1 }, open_slots_14d: 1 });
  assert.deepEqual(s.engagements, { available: true, by_lane: { drafting: 1, proposed: 0, signed: 2, renewal_due: 1, ended: 0 }, other: 0 });
  assert.deepEqual(s.payout, { available: true, on_file: true, ready: true, state: 'verified', last_checked_at: null });
  assert.equal(s.agreement.recorded, false);assert.match(s.agreement.reason, /No store records a studio agreement/);
  assert.deepEqual(s.lab_host, { available: true, scope: 'advisor', status: 'approved', decided_at: '2026-10-05T00:00:00Z' });
  assert.doesNotMatch(JSON.stringify(s), NAMES);

  f.db.exec("UPDATE advisor_payout_accounts SET payouts_enabled = 0");
  const pending: any = await readStanding(f.env, (await loadPerson(f.env, VIC))!, NOW);
  assert.equal(pending.payout.ready, false);assert.equal(pending.payout.state, 'pending');
  f.db.exec('DELETE FROM advisor_payout_accounts; DELETE FROM advisor_reviews');
  const none: any = await readStanding(f.env, (await loadPerson(f.env, VIC))!, NOW);
  assert.deepEqual(none.payout, { available: true, on_file: false, ready: false, state: null, last_checked_at: null });
  assert.equal(none.ratings.average, null, 'no ratings is not an average of zero');assert.equal(none.ratings.count, 0);

  await f.call(adminNetwork, 'POST', `/people/${VIC}/pause`, ADMIN, { reason: 'Reason fixture' });
  const paused: any = await readStanding(f.env, (await loadPerson(f.env, VIC))!, NOW);
  assert.equal(paused.stage, 'paused');assert.equal(paused.directory.listed, false, 'a paused advisor is not listed');assert.equal(paused.directory.hidden_by_admin, false);
  assert.equal(paused.pause.reason, 'Reason fixture');

  const onboarding: any = await readStanding(f.env, (await loadPerson(f.env, NOPRO))!, NOW);
  assert.equal(onboarding.stage, 'onboarding');
  for (const k of ['ratings', 'sessions', 'engagements', 'payout']) assert.equal(onboarding[k].recorded, false, k);
});

test('D976 standing: a partner account reads its firm, and its signed invitation as the agreement', async () => {
  const f = fixture();
  const s: any = await readStanding(f.env, (await loadPerson(f.env, PIA))!, NOW);
  assert.equal(s.kind, 'operating_partner');assert.equal(s.stage, 'active');
  assert.deepEqual(s.ratings, { available: true, scope: 'firm', count: 1, average: 3, by_score: { 1: 0, 2: 0, 3: 1, 4: 0, 5: 0 } });
  assert.deepEqual(s.sessions.counts, { completed: 1, upcoming: 1, cancelled: 0, no_show: 0, not_marked: 0 });
  assert.equal(s.sessions.scope, 'firm');assert.equal(s.sessions.open_slots_14d, 1);
  assert.equal(s.engagements.recorded, false);assert.equal(s.payout.recorded, false);assert.equal(s.directory.recorded, false);
  assert.deepEqual(s.agreement, { available: true, on_file: true, signed_at: '2026-09-12T10:00:00Z', source: 'partner_invitation' });
  assert.doesNotMatch(JSON.stringify(s), NAMES);
  const ned: any = await readStanding(f.env, (await loadPerson(f.env, NED))!, NOW);
  assert.equal(ned.stage, 'onboarding');assert.equal(ned.ratings.recorded, false);assert.equal(ned.sessions.recorded, false);
  assert.deepEqual(ned.agreement, { available: true, on_file: false, signed_at: null, source: 'partner_invitation' });
});

test('D976 standing: a failed store fails only its own block; the route is admin only', async () => {
  const f = fixture();f.fail('FROM advisor_reviews');f.fail('FROM advisor_engagements');
  const s: any = await readStanding(f.env, (await loadPerson(f.env, VIC))!, NOW);
  unreadableShape(s.ratings);unreadableShape(s.engagements);
  for (const k of ['sessions', 'payout', 'lab_host']) assert.equal(s[k].available, true, k);
  assert.equal(s.stage, 'active');

  const g = fixture();
  assert.equal((await g.call(adminNetwork, 'GET', `/people/${VIC}`, FAY)).status, 403);
  assert.equal((await g.call(adminNetwork, 'GET', `/people/${FAY}`, ADMIN)).status, 404);
  const r = await g.call(adminNetwork, 'GET', `/people/${VIC}`, ADMIN);
  assert.equal(r.status, 200);assert.equal(r.body.user_id, VIC);assert.equal(r.body.ratings.available, true);
  assert.doesNotMatch(JSON.stringify(r.body), NAMES);
});
