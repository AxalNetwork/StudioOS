/**
 * D1272 (#3298), Promo codes part 2 — the list read with search, filters, sort
 * and paging; paused and ended recorded (migration 629); name and note; the
 * repeating months stored; Replace.
 *
 * What this file holds the Worker to:
 *   · the list: each state in `promoState`'s order with paused and ended first,
 *     every filter, four sorts that end on the id, a total and per-state counts
 *     that do not move with the page, `applies=plans` (refused until part 3; D1275 lifts it), and
 *     a D1 error a 503, never an empty list;
 *   · PATCH: pause and end take a reason and record who and when; resume clears
 *     the pause; an ended code never resumes; today's `active` toggle still
 *     works; name and note reach the mirror and Stripe's metadata;
 *   · DELETE records the end, so a deleted code never resumes;
 *   · Replace makes the new code, then ends the old one with `replaced_by`,
 *     both audited; when Stripe will not end the old one, the new one stands
 *     and the answer says so.
 *
 * Stripe is stubbed: `globalThis.fetch` answers the API and records each call.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/promo_lifecycle_d1272.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import adminPromos from '../src/routes/admin_promos.ts';
import { listPromoPage, listState, markResumed, rowToView } from '../src/services/promos.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const JWT_SECRET = 'unit-test-jwt-secret-d1272-0123456789-abc';
const ADMIN = 901;
const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const MIGRATION = readFileSync(new URL('../sql/migrations/629_promo_code_lifecycle.sql', import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-26T12:00:00Z');

function database() {
  const d = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const t of ['users', 'super_admins', 'user_sessions', 'promo_codes']) d.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  d.exec(MIGRATION);
  d.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)').run(ADMIN, 'admin', 'Hana Q', 'hq@example.test');
  d.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(ADMIN);
  d.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, 'totp', datetime('now'))").run(ADMIN, 'totp-d1272');
  return d;
}

const app = new Hono<any>();
app.route('/', adminPromos);
app.onError((err: any, c) => {
  const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
  if (s) return c.json({ detail: err.message }, s);
  throw err;
});

type Call = { method: string; path: string; form: Record<string, string> };
/** Stripe, stubbed. `fail` names a path (and method) to answer 400. */
function stripe(opts: { fail?: (c: Call) => boolean } = {}) {
  const calls: Call[] = [];
  let n = 0;
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any = {}) => {
    const path = String(url).replace(/^https:\/\/api\.stripe\.com\/v1/, '');
    const form = Object.fromEntries(new URLSearchParams(String(init.body || '')));
    const call = { method: init.method || 'POST', path, form };
    calls.push(call);
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
    if (opts.fail?.(call)) return json({ error: { message: 'No such promotion code' } }, 400);
    if (path === '/coupons') { n += 1; return json({ id: `coupon_${n}`, percent_off: Number(form.percent_off) || null, amount_off: null, currency: null, duration: form.duration }); }
    if (path === '/promotion_codes') { n += 1; return json({ id: `promo_${n}`, code: form.code, active: true, coupon: form.coupon }); }
    if (path.startsWith('/promotion_codes/')) return json({ id: path.split('/')[2], active: form.active !== 'false' });
    if (path.startsWith('/coupons/')) return json({ id: path.split('/')[2], deleted: true });
    return json({}, 404);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

async function call(d: DatabaseSync, method: string, path: string, body?: unknown, extra: Record<string, unknown> = {}) {
  const jwt = await new SignJWT({ user_id: ADMIN, role: 'admin', jti: 'totp-d1272' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(path, {
    method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, { DB: d1Over(d), JWT_SECRET, ENVIRONMENT: 'development', STRIPE_SECRET_KEY: 'sk_test_fixture', ...extra } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

const row = (d: DatabaseSync, id: string) => d.prepare('SELECT * FROM promo_codes WHERE id = ?').get(id) as any;
const audits = (d: DatabaseSync) => {
  try { return d.prepare('SELECT action, filters_json FROM admin_audit_log ORDER BY id').all() as any[]; } catch { return []; }
};

function seed(d: DatabaseSync) {
  const ins = d.prepare(`INSERT INTO promo_codes (id, code, code_normalized, coupon_id, percent_off, product_ids_json, max_redemptions, times_redeemed,
    active, expires_at, created_at, paused_at, ended_at, name) VALUES (?, ?, ?, 'c', 10, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  // id, code, products, cap, redeemed, active, expires, created, paused, ended, name
  ins.run('p1', 'SPRING10', 'SPRING10', '[]', null, 3, 1, null, '2026-10-01 09:00:00', null, null, 'Spring launch');
  ins.run('p2', 'FOUNDERS', 'FOUNDERS', '["prod_a"]', 5, 5, 1, null, '2026-10-02 09:00:00', null, null, null);
  ins.run('p3', 'OLD2025', 'OLD2025', '[]', null, 0, 1, '2026-01-01T00:00:00.000Z', '2026-10-03 09:00:00', null, null, null);
  ins.run('p4', 'PAUSED', 'PAUSED', '[]', null, 1, 0, null, '2026-10-04 09:00:00', '2026-10-20 10:00:00', null, null);
  ins.run('p5', 'ENDED', 'ENDED', '["prod_b"]', null, 9, 0, null, '2026-10-05 09:00:00', null, '2026-10-21 10:00:00', null);
  ins.run('p6', 'LEGACYOFF', 'LEGACYOFF', '[]', null, 0, 0, null, '2026-10-06 09:00:00', null, null, null);
  ins.run('p7', 'SQLSTAMP', 'SQLSTAMP', '[]', null, 0, 1, '2026-01-02 08:00:00', '2026-10-06 09:00:00', null, null, null);
}

/* ------------------------------------------------------------------ *
 * The list
 * ------------------------------------------------------------------ */

test('each state in promoState\'s order, paused and ended first; a SQL stamp expires like an ISO one', () => {
  const d = database();
  seed(d);
  const states = Object.fromEntries((d.prepare('SELECT * FROM promo_codes').all() as any[]).map((r) => [r.code, listState(r, NOW)]));
  assert.deepEqual(states, { SPRING10: 'active', FOUNDERS: 'at_cap', OLD2025: 'expired', PAUSED: 'paused', ENDED: 'ended', LEGACYOFF: 'off', SQLSTAMP: 'expired' });
  assert.equal(listState({ ...row(d, 'p5'), paused_at: '2026-10-20' }, NOW), 'ended', 'ended wins over paused');
  assert.equal(rowToView(row(d, 'p1'), NOW).name, 'Spring launch');
  assert.equal(rowToView(row(d, 'p1'), NOW).duration_in_months, null, 'months not recorded is null, never 0');
});

test('the list: filters, sorts, a stable total across pages, and counts per state', async () => {
  const d = database();
  seed(d);
  const one = await call(d, 'GET', '/?page_size=3');
  assert.equal(one.status, 200);
  assert.equal(one.body.total, 7);
  assert.deepEqual(one.body.promos.map((p: any) => p.code), ['SQLSTAMP', 'LEGACYOFF', 'ENDED'], 'newest first, a tie broken by the id');
  const two = await call(d, 'GET', '/?page_size=3&page=2');
  const three = await call(d, 'GET', '/?page_size=3&page=3');
  assert.equal(two.body.total, 7);
  assert.equal(three.body.total, 7, 'the total does not move with the page');
  const seen = [...one.body.promos, ...two.body.promos, ...three.body.promos].map((p: any) => p.id);
  assert.equal(new Set(seen).size, 7, 'every row once across the pages');
  assert.deepEqual(one.body.counts, { active: 1, paused: 1, ended: 1, expired: 2, at_cap: 1, off: 1 });
  assert.equal(one.body.promos[0].state, 'expired');

  assert.deepEqual((await call(d, 'GET', '/?state=paused')).body.promos.map((p: any) => p.code), ['PAUSED']);
  assert.deepEqual((await call(d, 'GET', '/?state=ended')).body.promos.map((p: any) => p.code), ['ENDED']);
  const products = await call(d, 'GET', '/?applies=products');
  assert.deepEqual(products.body.promos.map((p: any) => p.code).sort(), ['ENDED', 'FOUNDERS']);
  assert.deepEqual(products.body.counts, { active: 0, paused: 0, ended: 1, expired: 0, at_cap: 1, off: 0 }, 'counts follow the other filters');
  assert.equal((await call(d, 'GET', '/?applies=all')).body.total, 5);
  assert.deepEqual((await call(d, 'GET', '/?q=spring')).body.promos.map((p: any) => p.code), ['SPRING10'], 'the code, any case');
  assert.deepEqual((await call(d, 'GET', '/?q=launch')).body.promos.map((p: any) => p.code), ['SPRING10'], 'or the name');
  assert.deepEqual((await call(d, 'GET', '/?q=%25')).status, 400, 'one character searches nothing');
  assert.equal((await call(d, 'GET', '/?q=%25%25')).body.total, 0, 'a wildcard is searched as itself');
  assert.deepEqual((await call(d, 'GET', '/?sort=code&page_size=3')).body.promos.map((p: any) => p.code), ['ENDED', 'FOUNDERS', 'LEGACYOFF']);
  assert.deepEqual((await call(d, 'GET', '/?sort=redeemed&page_size=2')).body.promos.map((p: any) => p.code), ['ENDED', 'FOUNDERS']);
  assert.deepEqual((await call(d, 'GET', '/?sort=oldest&page_size=1')).body.promos.map((p: any) => p.code), ['SPRING10']);

  for (const [q, code] of [['state=gone', 'invalid_state'], ['applies=everyone', 'invalid_applies'], ['sort=price', 'invalid_sort'],
    ['page=0', 'invalid_page'], ['page_size=101', 'invalid_page_size']]) {
    const r = await call(d, 'GET', `/?${q}`);
    assert.equal(r.status, 400, q);
    assert.equal(r.body.code, code);
  }
  // D1275: plan scope is recorded since part 3, so `plans` filters. A code HQ chose plans for leaves
  // `products`, though its plans resolved to products; `all` keeps only a code that names neither.
  d.prepare(`UPDATE promo_codes SET plan_keys_json = '["tier:growth"]' WHERE id = 'p2'`).run();
  const plans = await call(d, 'GET', '/?applies=plans');
  assert.equal(plans.status, 200);
  // Mutation checked: keep refusing plans → 400.
  assert.deepEqual(plans.body.promos.map((p: any) => p.code), ['FOUNDERS']);
  // Mutation checked: let a plan code stay in `products` → ['ENDED', 'FOUNDERS'].
  assert.deepEqual((await call(d, 'GET', '/?applies=products')).body.promos.map((p: any) => p.code), ['ENDED']);
  assert.ok(!(await call(d, 'GET', '/?applies=all')).body.promos.some((p: any) => p.code === 'FOUNDERS'));
});

test('the state in SQL: ended over paused, expiry as a time not as text, and the service never resumes an ended code', async () => {
  const d = database();
  const env = { DB: d1Over(d) } as any;
  const ins = d.prepare(`INSERT INTO promo_codes (id, code, code_normalized, coupon_id, percent_off, active, expires_at, paused_at, ended_at, created_at)
    VALUES (?, ?, ?, 'c', 10, ?, ?, ?, ?, '2026-10-01 09:00:00')`);
  ins.run('b1', 'BOTH', 'BOTH', 0, null, '2026-10-20 10:00:00', '2026-10-21 10:00:00');
  // Later today, written as a SQL stamp: as text it sorts before "2026-10-26T12…", as a time it is ahead.
  ins.run('b2', 'TONIGHT', 'TONIGHT', 1, '2026-10-26 23:00:00', null, null);
  const page = await listPromoPage(env, {}, NOW);
  const byCode = Object.fromEntries(page.promos.map((p: any) => [p.code, p.state]));
  assert.deepEqual(byCode, { BOTH: 'ended', TONIGHT: 'active' });
  assert.deepEqual([page.counts.ended, page.counts.paused, page.counts.active, page.counts.expired], [1, 0, 1, 0]);
  assert.equal((await listPromoPage(env, { state: 'paused' }, NOW)).total, 0, 'an ended code is not also paused');
  assert.equal(await markResumed(env, 'b1', 'back'), false, 'the service refuses too, not only the route');
  assert.equal((d.prepare("SELECT active FROM promo_codes WHERE id = 'b1'").get() as any).active, 0);
});

test('pages over many codes made at the same moment: every code once, in id order within the tie', async () => {
  const d = database();
  const env = { DB: d1Over(d) } as any;
  const ins = d.prepare(`INSERT INTO promo_codes (id, code, code_normalized, coupon_id, percent_off, created_at) VALUES (?, ?, ?, 'c', 10, '2026-10-10 10:00:00')`);
  for (let k = 0; k < 30; k += 1) { const i = ((k * 7) % 30) + 1; const id = `t${String(i).padStart(2, '0')}`; ins.run(id, id.toUpperCase(), id.toUpperCase()); }
  const seen: string[] = [];
  for (let page = 1; page <= 5; page += 1) {
    const r = await listPromoPage(env, { page, page_size: 7 }, NOW);
    assert.equal(r.total, 30, `page ${page}`);
    seen.push(...r.promos.map((p: any) => p.id));
  }
  assert.equal(seen.length, 30);
  assert.deepEqual(seen.slice(0, 3), ['t30', 't29', 't28'], 'newest first, then the id, descending');
  assert.equal(new Set(seen).size, 30);
});

test('a list read that fails is a 503, never an empty list', async () => {
  const d = database();
  d.exec('DROP TABLE promo_codes');
  d.exec('CREATE TABLE promo_codes (id TEXT)'); // a table the read cannot use
  const r = await call(d, 'GET', '/');
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'promos_unreadable');
});

/* ------------------------------------------------------------------ *
 * Create, PATCH, DELETE
 * ------------------------------------------------------------------ */

test('create stores the months, the name and the note, on the mirror and on Stripe\'s metadata', async () => {
  const d = database();
  const s = stripe();
  try {
    const r = await call(d, 'POST', '/', { type: 'percent', code: 'YEARONE', percent_off: 20, duration: 'repeating', duration_in_months: 6, name: 'Year one', note: 'For the October cohort.' });
    assert.equal(r.status, 200);
    const p = row(d, r.body.promo_id);
    assert.deepEqual([p.duration_in_months, p.name, p.note], [6, 'Year one', 'For the October cohort.']);
    const pc = s.calls.find((c) => c.path === '/promotion_codes');
    assert.equal(pc.form['metadata[name]'], 'Year one');
    assert.equal(pc.form['metadata[note]'], 'For the October cohort.');
    const bad = await call(d, 'POST', '/', { type: 'percent', code: 'TOOLONG', percent_off: 5, name: 'x'.repeat(81) });
    assert.equal(bad.body.code, 'invalid_name');
  } finally { s.restore(); }
});

test('pause and end record who, when and why; an ended code never resumes; the toggle still works', async () => {
  const d = database();
  seed(d);
  const s = stripe();
  try {
    const noReason = await call(d, 'PATCH', '/p1', { action: 'pause' });
    assert.equal(noReason.status, 400);
    assert.equal(noReason.body.code, 'reason_required');
    assert.equal(s.calls.length, 0, 'a refused change never reaches Stripe');

    const paused = await call(d, 'PATCH', '/p1', { action: 'pause', reason: 'Checkout copy is wrong.' });
    assert.equal(paused.status, 200);
    let p = row(d, 'p1');
    assert.deepEqual([p.active, p.paused_by, p.reason], [0, ADMIN, 'Checkout copy is wrong.']);
    assert.ok(p.paused_at);
    assert.equal(s.calls.at(-1).form.active, 'false');
    assert.equal((await call(d, 'PATCH', '/p1', { action: 'pause', reason: 'again' })).body.code, 'already_paused');

    const resumed = await call(d, 'PATCH', '/p1', { action: 'resume', reason: 'Fixed.' });
    assert.equal(resumed.status, 200);
    p = row(d, 'p1');
    assert.deepEqual([p.active, p.paused_at, p.paused_by], [1, null, null]);

    const ended = await call(d, 'PATCH', '/p1', { action: 'end', reason: 'Campaign over.' });
    assert.equal(ended.status, 200);
    p = row(d, 'p1');
    assert.deepEqual([p.active, p.ended_by, p.reason], [0, ADMIN, 'Campaign over.']);
    const before = s.calls.length;
    for (const body of [{ action: 'resume', reason: 'Back.' }, { active: true }, { action: 'pause', reason: 'x' }, { action: 'end', reason: 'again' }]) {
      const r = await call(d, 'PATCH', '/p1', body);
      assert.equal(r.status, 409, JSON.stringify(body));
      assert.equal(r.body.code, 'promo_ended');
    }
    assert.equal(s.calls.length, before, 'an ended code is never switched back on in Stripe');
    assert.equal(row(d, 'p1').active, 0);

    // Today's console toggle: off pauses without a reason, on resumes.
    assert.equal((await call(d, 'PATCH', '/p6', { active: false })).status, 200);
    assert.ok(row(d, 'p6').paused_at);
    assert.equal((await call(d, 'PATCH', '/p6', { active: true })).status, 200);
    assert.deepEqual([row(d, 'p6').active, row(d, 'p6').paused_at], [1, null]);
    assert.equal((await call(d, 'PATCH', '/p6', { active: 'yes' })).body.code, 'invalid_active');
    assert.equal((await call(d, 'PATCH', '/p6', { action: 'archive' })).body.code, 'invalid_action');
    assert.equal((await call(d, 'PATCH', '/p6', {})).body.code, 'nothing_to_change');
    assert.equal((await call(d, 'PATCH', '/nope', { action: 'resume' })).status, 404);

    const acts = audits(d).map((a) => a.action);
    assert.deepEqual(acts, ['promo_pause', 'promo_resume', 'promo_end', 'promo_pause', 'promo_resume'], 'one audit row per change');
    assert.equal(JSON.parse(audits(d)[0].filters_json).reason, 'Checkout copy is wrong.');
  } finally { s.restore(); }
});

test('name and note change on the mirror and on Stripe\'s metadata; an empty value clears', async () => {
  const d = database();
  seed(d);
  const s = stripe();
  try {
    const r = await call(d, 'PATCH', '/p2', { name: '  Founders  first ', note: 'Ask Hana before extending.' });
    assert.equal(r.status, 200);
    assert.deepEqual([row(d, 'p2').name, row(d, 'p2').note], ['Founders first', 'Ask Hana before extending.']);
    const last = s.calls.at(-1);
    assert.equal(last.path, '/promotion_codes/p2');
    assert.deepEqual([last.form['metadata[name]'], last.form['metadata[note]'], last.form.active], ['Founders first', 'Ask Hana before extending.', undefined],
      'a words-only change does not touch active');
    await call(d, 'PATCH', '/p2', { note: '' });
    assert.deepEqual([row(d, 'p2').name, row(d, 'p2').note], ['Founders first', null], 'only the field sent changes');
    assert.equal((await call(d, 'PATCH', '/p2', { note: 'x'.repeat(501) })).body.code, 'invalid_note');
    assert.equal(audits(d).at(-1).action, 'promo_update');
  } finally { s.restore(); }
});

test('DELETE records the end, so a deleted code never resumes', async () => {
  const d = database();
  seed(d);
  const s = stripe();
  try {
    assert.equal((await call(d, 'DELETE', '/p1', { reason: 'Leaked publicly.' })).status, 200);
    const p = row(d, 'p1');
    assert.ok(p.ended_at);
    assert.deepEqual([p.ended_by, p.reason, p.active], [ADMIN, 'Leaked publicly.', 0]);
    assert.equal((await call(d, 'PATCH', '/p1', { active: true })).body.code, 'promo_ended');
  } finally { s.restore(); }
});

/* ------------------------------------------------------------------ *
 * Replace
 * ------------------------------------------------------------------ */

const NEW = { type: 'percent', code: 'SPRING15', percent_off: 15, reason: 'Raise the discount to 15%.' };

test('Replace makes the new code, then ends the old one with replaced_by; both are audited', async () => {
  const d = database();
  seed(d);
  const s = stripe();
  try {
    const r = await call(d, 'POST', '/p1/replace', NEW);
    assert.equal(r.status, 200);
    assert.equal(r.body.old_ended, true);
    const fresh = row(d, r.body.promo_id);
    assert.equal(fresh.code, 'SPRING15');
    assert.equal(fresh.active, 1);
    const old = row(d, 'p1');
    assert.deepEqual([old.active, old.replaced_by, old.reason, old.ended_by], [0, r.body.promo_id, 'Raise the discount to 15%.', ADMIN]);
    assert.ok(old.ended_at);
    const order = s.calls.map((c) => `${c.method} ${c.path}`);
    assert.ok(order.indexOf('POST /promotion_codes') < order.indexOf('POST /promotion_codes/p1'), 'the new code is made before the old one ends');
    assert.equal(s.calls.find((c) => c.path === '/promotion_codes').form['metadata[replaces]'], 'p1');
    assert.equal(s.calls.find((c) => c.path === '/promotion_codes/p1').form['metadata[replaced_by]'], r.body.promo_id);
    const a = audits(d);
    assert.deepEqual(a.map((x) => x.action), ['promo_create', 'promo_end']);
    assert.equal(JSON.parse(a[0].filters_json).replaces, 'p1');
    assert.equal(JSON.parse(a[1].filters_json).replaced_by, r.body.promo_id);
    assert.equal((await call(d, 'POST', '/p1/replace', { ...NEW, code: 'SPRING20' })).body.code, 'promo_ended', 'an ended code is not replaced twice');
  } finally { s.restore(); }
});

test('Replace refuses before Stripe: no reason, the same code, an unknown code; a refused new code ends nothing', async () => {
  const d = database();
  seed(d);
  const s = stripe();
  try {
    assert.equal((await call(d, 'POST', '/p1/replace', { ...NEW, reason: '' })).body.code, 'reason_required');
    assert.equal((await call(d, 'POST', '/p1/replace', { ...NEW, code: 'spring10' })).body.code, 'same_code');
    assert.equal((await call(d, 'POST', '/nope/replace', NEW)).status, 404);
    assert.equal(s.calls.length, 0);
    const bad = await call(d, 'POST', '/p1/replace', { ...NEW, percent_off: 0 });
    assert.equal(bad.body.code, 'invalid_percent');
    assert.equal(row(d, 'p1').ended_at, null, 'the old code stands when the new one is refused');
  } finally { s.restore(); }
});

test('when Stripe will not end the old code, the new one stands and the answer says so', async () => {
  const d = database();
  seed(d);
  const s = stripe({ fail: (c) => c.path === '/promotion_codes/p1' });
  try {
    const r = await call(d, 'POST', '/p1/replace', NEW);
    assert.equal(r.status, 502);
    assert.equal(r.body.old_ended, false);
    assert.ok(row(d, r.body.promo_id), 'the new code is kept');
    assert.deepEqual([row(d, 'p1').ended_at, row(d, 'p1').active], [null, 1], 'the old one is still on, and says so');
    assert.deepEqual(audits(d).map((x) => x.action), ['promo_create'], 'only what happened is audited');
  } finally { s.restore(); }
});

test('D1275: one code by its id, for its drawer at its own address; an unknown id is 404', async () => {
  const d = database();
  seed(d);
  const one = await call(d, 'GET', '/p1');
  assert.equal(one.status, 200);
  assert.deepEqual([one.body.promo.id, one.body.promo.code, one.body.promo.name, one.body.promo.state], ['p1', 'SPRING10', 'Spring launch', 'active']);
  const ended = await call(d, 'GET', '/p5');
  assert.equal(ended.body.promo.state, 'ended');
  const none = await call(d, 'GET', '/nope');
  assert.deepEqual([none.status, none.body.code], [404, 'not_found']);
});
