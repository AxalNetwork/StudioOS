/** Scheduling a package change for the next term only, with no proration (#5025 part 2, D5025-p2). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { mount } from '../src/routes/admin_package_lifecycle.ts';
import { changeStatus, scheduleRefusal } from '../src/services/packageChanges.ts';

const CLOCK = Date.UTC(2026, 10, 24, 12); // 2026-11-24
const SECRET = 'synthetic-package-changes-5025-test-secret';
const LIC = 'lic_5025b';
const comp = (...keys: string[]) => JSON.stringify(keys.map((k, i) => ({ program_key: k, position: i, metadata: null, terms: {} })));
const REASON = 'Owner approved the next-term move after review.';

function fixture(ctx: any) {
  ctx.mock.timers.enable({ apis: ['Date'], now: CLOCK });
  const db = new DatabaseSync(':memory:', { ...SCHEMA_OPTIONS });
  loadSchema(db);
  ctx.after(() => db.close());
  for (const id of [1, 2]) {
    db.prepare("INSERT INTO users (id, role, name, email) VALUES (?, 'admin', ?, ?)").run(id, `Operator ${id}`, `test${id}@example.test`);
    db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', ?)")
      .run(id, `totp-${id}`, new Date(CLOCK).toISOString());
  }
  db.exec('INSERT INTO super_admins (user_id) VALUES (1)');
  db.prepare(`INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status, term_years,
    annual_fee_cents, currency, revenue_share_bps, token_split_bps, starts_on, renews_on)
    VALUES (1, ?, 'AXL-5025B', 'Test licensee', 'Test studio', 'active', 3, 1000000, 'EUR', 3000, 5000, '2025-01-01', '2028-01-01')`).run(LIC);
  const offer = (uid: string, o: Record<string, any>) => {
    const accepted = o.state === 'accepted';
    db.prepare(`INSERT INTO licence_package_offers (uid, licence_uid, package_uid, package_key, package_version, package_name,
      pricing_recommendation_uid, country_pricing_snapshot_uid, currency, recommended_annual_fee_cents, accepted_annual_fee_cents,
      state, override_reason, starts_on, ends_on, composition_json, recommendation_json, created_at, created_by, create_key, create_hash,
      decided_by, acceptance_json) VALUES (?, ?, 'pkg', ?, 1, 'Package', 'rec', 'snap', ?, ?, ?, ?, NULL, ?, ?, ?, '{}', '2026-01-01T00:00:00Z', 1, ?, 'h', ?, ?)`)
      .run(uid, LIC, o.key ?? 'core_network', o.currency ?? 'EUR', o.fee, accepted ? o.fee : null, o.state, o.starts, o.ends,
        o.comp, `key-${uid}`, accepted ? 1 : null, accepted ? '{}' : null);
  };
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' };
  const app = new Hono<any>();
  app.route(mount.path, mount.router);
  const call = async (path: string, body?: unknown, user: number | null = 1) => {
    const token = user == null ? null : await new SignJWT({ user_id: user, role: 'admin', jti: `totp-${user}` })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    const init: RequestInit = body === undefined ? { headers }
      : { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    const res = await withThrownResponses(() => app.request(path, init, env));
    return { status: res.status, body: await res.json() as any };
  };
  return { db, offer, call };
}

const base = (o: any) => ({ package_key: 'core_network', currency: 'EUR', composition_json: comp('perks'), recommendation_json: '{}', ...o });

test('status is read from the schedule and its offer', () => {
  const row = { state: 'scheduled' as const, effective_on: '2027-01-01' };
  assert.equal(changeStatus(row, 'offered', '2026-12-31'), 'scheduled');
  assert.equal(changeStatus(row, 'offered', '2027-01-01'), 'due');
  assert.equal(changeStatus(row, 'accepted', '2026-12-31'), 'applied');
  assert.equal(changeStatus(row, 'declined', '2027-02-01'), 'lapsed');
  assert.equal(changeStatus(row, null, '2026-12-01'), 'lapsed');
  assert.equal(changeStatus({ ...row, state: 'cancelled' }, 'accepted', '2027-02-01'), 'cancelled');
});

test('next term only: an offer must start the day after the current term ends', () => {
  const term = base({ uid: 'cur', state: 'accepted', starts_on: '2026-01-01', ends_on: '2026-12-31' }) as any;
  const at = (starts_on: string, state = 'offered') => base({ uid: 'n', state, starts_on, ends_on: '2027-12-31' }) as any;
  assert.equal(scheduleRefusal(term, at('2027-01-01')), null);
  assert.equal(scheduleRefusal(term, at('2026-12-31'))!.code, 'change_not_next_term', 'the last day of the term is still mid-term');
  assert.equal(scheduleRefusal(term, at('2026-06-01'))!.code, 'change_not_next_term');
  assert.equal(scheduleRefusal(term, at('2027-01-02'))!.code, 'change_leaves_gap');
  assert.equal(scheduleRefusal(term, at('2027-01-01', 'draft'))!.code, 'offer_not_offered');
  assert.equal(scheduleRefusal(null, at('2027-01-01'))!.code, 'no_current_term');
  assert.match(scheduleRefusal(term, at('2026-06-01'))!.message, /2027-01-01/);
});

test('HQ schedules a downgrade for the next term: frozen kind and prices, no proration, audited, nothing else written', async (t) => {
  const { db, offer, call } = fixture(t);
  offer('cur', { state: 'accepted', fee: 1_000_000, starts: '2026-01-01', ends: '2026-12-31', comp: comp('perks', 'learning') });
  offer('down', { state: 'offered', fee: 600_000, starts: '2027-01-01', ends: '2027-12-31', comp: comp('perks') });
  const offersBefore = db.prepare('SELECT uid, state, revision FROM licence_package_offers ORDER BY uid').all();
  const res = await call(`/api/admin/licences/${LIC}/package-offers/down/schedule-change`, { reason: REASON, idempotency_key: 'sched-0001' });
  assert.equal(res.status, 201);
  const ch = res.body.change;
  assert.deepEqual([ch.kind, ch.effective_on, ch.status, ch.financial_rule, ch.proration_applies],
    ['downgrade', '2027-01-01', 'scheduled', 'next_term_no_proration', false]);
  assert.deepEqual([ch.from_offer_uid, ch.to_offer_uid, ch.old_annual_fee_cents, ch.new_annual_fee_cents], ['cur', 'down', 1_000_000, 600_000]);
  assert.deepEqual(db.prepare('SELECT uid, state, revision FROM licence_package_offers ORDER BY uid').all(), offersBefore, 'no offer changes');
  const audit = db.prepare("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'licence_package_change_scheduled'").get() as any;
  assert.equal(audit.n, 1);
  const again = await call(`/api/admin/licences/${LIC}/package-offers/down/schedule-change`, { reason: REASON, idempotency_key: 'sched-0001' });
  assert.deepEqual([again.status, again.body.replayed, again.body.change.uid], [200, true, ch.uid]);
  const second = await call(`/api/admin/licences/${LIC}/package-offers/down/schedule-change`, { reason: REASON, idempotency_key: 'sched-0002' });
  assert.deepEqual([second.status, second.body.error], [409, 'change_already_scheduled']);
  const list = await call(`/api/admin/licences/${LIC}/package-changes`);
  assert.deepEqual(list.body.items.map((x: any) => [x.uid, x.status]), [[ch.uid, 'scheduled']]);
  assert.equal((await call(`/api/admin/licences/${LIC}/package-changes`, undefined, 2)).status, 403, 'Super Admin only');
  assert.equal((await call('/api/admin/licences/lic_none/package-changes')).status, 404);
});

test('a mid-term offer, a gap, a draft and a non-super-admin are refused; nothing is written', async (t) => {
  const { db, offer, call } = fixture(t);
  offer('cur', { state: 'accepted', fee: 1_000_000, starts: '2026-01-01', ends: '2026-12-31', comp: comp('perks') });
  offer('mid', { state: 'offered', fee: 1_500_000, starts: '2026-12-01', ends: '2027-11-30', comp: comp('perks', 'learning') });
  offer('gap', { state: 'offered', fee: 1_500_000, starts: '2027-02-01', ends: '2028-01-31', comp: comp('perks', 'learning') });
  offer('drf', { state: 'draft', fee: 1_500_000, starts: '2027-01-01', ends: '2027-12-31', comp: comp('perks', 'learning') });
  const post = (o: string, body: any = { reason: REASON, idempotency_key: `k-${o}-000` }, user = 1) =>
    call(`/api/admin/licences/${LIC}/package-offers/${o}/schedule-change`, body, user);
  assert.deepEqual([(await post('mid')).status, (await post('mid')).body.error], [409, 'change_not_next_term']);
  assert.equal((await post('gap')).body.error, 'change_leaves_gap');
  assert.equal((await post('drf')).body.error, 'offer_not_offered');
  assert.equal((await post('nope')).status, 404);
  assert.equal((await post('drf', { reason: 'short', idempotency_key: 'k-short-000' })).body.error, 'reason_required');
  assert.equal((await post('drf', { reason: REASON, idempotency_key: 'k-extra-000', effective_on: '2026-12-01' })).body.error, 'invalid_fields');
  assert.equal((await post('drf', undefined as any, 2)).status, 403);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM licence_package_changes').get() as any).n, 0);
});

test('the schedule is due on its day, applied once the offer is accepted, and only cancellable before that', async (t) => {
  const { db, offer, call } = fixture(t);
  offer('cur', { state: 'accepted', fee: 1_000_000, starts: '2025-11-25', ends: '2026-11-24', comp: comp('perks') });
  offer('up', { state: 'offered', fee: 1_200_000, starts: '2026-11-25', ends: '2027-11-24', comp: comp('perks', 'learning') });
  const made = await call(`/api/admin/licences/${LIC}/package-offers/up/schedule-change`, { reason: REASON, idempotency_key: 'sched-up-01' });
  assert.equal(made.body.change.kind, 'upgrade');
  assert.equal(made.body.change.status, 'scheduled', 'effective tomorrow, so not yet due');
  t.mock.timers.setTime(Date.UTC(2026, 10, 25, 9));
  assert.equal((await call(`/api/admin/licences/${LIC}/package-changes`)).body.items[0].status, 'due');
  db.prepare("UPDATE licence_package_offers SET state = 'accepted', accepted_annual_fee_cents = 1200000, decided_by = 1, acceptance_json = '{}' WHERE uid = 'up'").run();
  assert.equal((await call(`/api/admin/licences/${LIC}/package-changes`)).body.items[0].status, 'applied');
  // A day later the morning's TOTP step-up has lapsed: the write bar refuses until the admin signs in again.
  assert.equal((await call(`/api/admin/licences/${LIC}/package-changes/${made.body.change.uid}/cancel`, { reason: REASON })).status, 403);
  assert.equal((await call(`/api/admin/licences/${LIC}/package-offers/up/schedule-change`, { reason: REASON, idempotency_key: 'sched-up-02' })).status, 403);
  db.prepare("UPDATE user_sessions SET created_at = ? WHERE user_id = 1").run(new Date(Date.UTC(2026, 10, 25, 9)).toISOString());
  const late = await call(`/api/admin/licences/${LIC}/package-changes/${made.body.change.uid}/cancel`, { reason: REASON });
  assert.deepEqual([late.status, late.body.error], [409, 'change_already_applied']);
});

test('cancelling records who and why, frees the term for another schedule, and cannot be repeated', async (t) => {
  const { db, offer, call } = fixture(t);
  offer('cur', { state: 'accepted', fee: 1_000_000, starts: '2026-01-01', ends: '2026-12-31', comp: comp('perks') });
  offer('a', { state: 'offered', fee: 1_000_000, starts: '2027-01-01', ends: '2027-12-31', comp: comp('perks') });
  offer('b', { state: 'offered', key: 'lite', fee: 800_000, starts: '2027-01-01', ends: '2027-12-31', comp: comp('perks') });
  const made = await call(`/api/admin/licences/${LIC}/package-offers/a/schedule-change`, { reason: REASON, idempotency_key: 'sched-a-001' });
  assert.equal(made.body.change.kind, 'renewal');
  assert.equal((await call(`/api/admin/licences/${LIC}/package-offers/b/schedule-change`, { reason: REASON, idempotency_key: 'sched-b-001' })).body.error,
    'change_already_scheduled', 'one live schedule per current term');
  const uid = made.body.change.uid;
  assert.equal((await call(`/api/admin/licences/${LIC}/package-changes/${uid}/cancel`, { reason: REASON }, 2)).status, 403);
  const done = await call(`/api/admin/licences/${LIC}/package-changes/${uid}/cancel`, { reason: 'The licensee asked to keep the same package.' });
  assert.equal(done.status, 200);
  assert.deepEqual([done.body.change.status, done.body.change.cancelled_by], ['cancelled', 1]);
  assert.equal((await call(`/api/admin/licences/${LIC}/package-changes/${uid}/cancel`, { reason: REASON })).body.error, 'change_already_cancelled');
  assert.equal((await call(`/api/admin/licences/${LIC}/package-changes/missing/cancel`, { reason: REASON })).status, 404);
  const other = await call(`/api/admin/licences/${LIC}/package-offers/b/schedule-change`, { reason: REASON, idempotency_key: 'sched-b-002' });
  assert.deepEqual([other.status, other.body.change.kind], [201, 'change']);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'licence_package_change_cancelled'").get() as any).n, 1);
  const reused = await call(`/api/admin/licences/${LIC}/package-offers/a/schedule-change`, { reason: REASON, idempotency_key: 'sched-b-002' });
  assert.deepEqual([reused.status, reused.body.error], [409, 'idempotency_key_reused']);
});
