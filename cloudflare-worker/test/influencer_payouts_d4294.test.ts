/**
 * D4294 (#4294, D4289 P5) — influencer payout readiness.
 *
 *   1. each gate condition on `POST /api/network/payout/request`, in order, with
 *      its named refusal: identity, tax form, the current terms, the $50
 *      minimum (balance and request, in the terms' currency), once a month (a
 *      failed payout does not use the month up); a member who is not an
 *      influencer is unchanged; the readiness read says the same;
 *   2. the tax form: its types and size, HQ's review by the Super Admin only
 *      (an admin is refused), a rejection's reason reaching the influencer, a
 *      form sent again after a rejection, and the audit rows;
 *   3. the file stays private: no reply carries its key, only the Super Admin's
 *      route streams it (no-store, as an attachment), and the reader never
 *      serves a key outside `taxforms/`.
 *
 * Real SQLite with the whole schema (migrations included). The `influencers`
 * segment of `referral_partners` is written with CHECKs off, standing in for
 * P1's rebuild of that CHECK (#4290). Every person and figure is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/influencer_payouts_d4294.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import network from '../src/routes/network.ts';
import { mount } from '../src/routes/influencer_payouts.ts';
import { INFLUENCER_TERMS_VERSION, PAYOUT_MINIMUM_CENTS, monthStart, nextMonthStart } from '../src/services/influencer/payoutReadiness.ts';
import { getTaxForm } from '../src/services/r2.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { loadSchema } from './_schema_once.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'influencer-payouts-4294-'));
const seedPath = join(scratch, 'schema.sqlite');
const seed = new DatabaseSync(seedPath, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
loadSchema(seed); seed.close();
after(() => rmSync(scratch, { recursive: true, force: true }));
const JWT_SECRET = 'synthetic-4294-only-not-a-real-credential'.repeat(2);
let n = 0;

const INF = 2, MEMBER = 3, ADMIN = 4, SUPER = 5;
const PDF = `data:application/pdf;base64,${Buffer.from('%PDF-1.4 synthetic W-9').toString('base64')}`;

function fakeBucket() {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    async put(key: string, bytes: Uint8Array) { objects.set(key, bytes); },
    async get(key: string) { const b = objects.get(key); return b ? { body: b, async arrayBuffer() { return b; } } : null; },
  };
}

function fixture() {
  const file = join(scratch, `case-${++n}.sqlite`);
  copyFileSync(seedPath, file);
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const user = db.prepare('INSERT INTO users(id, uid, role, name, email, is_active, kyc_status) VALUES (?, ?, ?, ?, ?, 1, ?)');
  user.run(INF, 'u-inf', 'investor', 'Ina Influencer', 'ina@example.invalid', 'not_started');
  user.run(MEMBER, 'u-member', 'partner', 'Pat Partner', 'pat@example.invalid', 'not_started');
  user.run(ADMIN, 'u-admin', 'admin', 'Ada Admin', 'ada@example.invalid', 'approved');
  user.run(SUPER, 'u-super', 'admin', 'Sam Super', 'sam@example.invalid', 'approved');
  db.prepare('INSERT INTO super_admins(user_id) VALUES (?)').run(SUPER);
  db.exec('PRAGMA ignore_check_constraints = ON');
  db.prepare("INSERT INTO referral_partners(user_id, segment, added_by) VALUES (?, 'influencers', ?)").run(INF, SUPER);
  db.exec('PRAGMA ignore_check_constraints = OFF');
  const files = fakeBucket();
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', FILES: files };
  const app = new Hono<any>().route('/api/network', network);
  for (const m of mount) app.route(m.path, m.router);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  return { db, env, app, files, close: () => db.close() };
}
type F = ReturnType<typeof fixture>;
async function call(f: F, who: number, method: string, path: string, body?: unknown) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await f.app.request(path, {
    method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, f.env);
  const text = await res.text();
  let json: any; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, text, headers: res.headers };
}
const accrue = (f: F, who: number, cents: number, currency = 'USD') =>
  f.db.prepare("INSERT INTO commissions(user_id, amount_cents, currency, source_type, status) VALUES (?, ?, ?, 'referral_kyc_approved', 'accrued')").run(who, cents, currency);
const request = (f: F, who: number, amount: number, extra: Record<string, unknown> = {}) =>
  call(f, who, 'POST', '/api/network/payout/request', { amount_cents: amount, payout_method: 'wire', ...extra });

test('1. each gate condition refuses with its name, in order; a member who is not an influencer is unchanged', async () => {
  // Mutation checked: each condition removed from payoutGate (identity, tax form, terms, minimum, monthly) → its refusal step fails;
  // a failed payout counted for the month → the retry fails; isInfluencer always true → the plain member is refused.
  const f = fixture();
  try {
    accrue(f, INF, 4000);
    const step = async (amount: number, code: string, status = 403) => {
      const r = await request(f, INF, amount, { currency: 'USD' });
      assert.deepEqual([r.status, r.body.error], [status, code], JSON.stringify(r.body));
      assert.ok(r.body.message.length > 10, 'a sentence, not a bare 403');
      return r;
    };
    await step(4000, 'kyc_required');
    f.db.prepare("UPDATE users SET kyc_status = 'approved' WHERE id = ?").run(INF);
    await step(4000, 'tax_form_required');
    assert.equal((await call(f, INF, 'POST', '/api/influencer/me/tax-form', { form_type: 'w9', file: PDF })).status, 201);
    await step(4000, 'tax_form_required');
    assert.equal((await call(f, SUPER, 'POST', '/api/admin/influencers/u-inf/tax-form/decision', { decision: 'accept' })).status, 200);
    await step(4000, 'terms_acceptance_required');
    // An acceptance of an earlier version is not the current one.
    f.db.prepare("INSERT INTO influencer_terms_acceptances(user_id, version) VALUES (?, '2025-01-01')").run(INF);
    await step(4000, 'terms_acceptance_required');
    const stale = await call(f, INF, 'POST', '/api/influencer/me/terms/accept', { version: '2025-01-01' });
    assert.deepEqual([stale.status, stale.body.error, stale.body.version], [409, 'terms_version_not_current', INFLUENCER_TERMS_VERSION]);
    assert.equal((await call(f, INF, 'POST', '/api/influencer/me/terms/accept', { version: INFLUENCER_TERMS_VERSION })).status, 200);
    // $40 payable: a request for $50 is refused on the balance, before the ledger is read.
    const low = await step(PAYOUT_MINIMUM_CENTS, 'below_payout_minimum', 400);
    assert.equal(low.body.readiness, 'minimum');
    accrue(f, INF, 2000);
    // The balance is over $50 now; a request under it, or in another currency than the terms', is still refused.
    await step(2000, 'below_payout_minimum', 400);
    accrue(f, INF, 9000, 'EUR');
    const eur = await request(f, INF, 9000, { currency: 'EUR' });
    assert.deepEqual([eur.status, eur.body.error], [400, 'payout_currency_not_terms']);
    const ok = await request(f, INF, 6000, { currency: 'USD', destination_label: 'Main account', destination_last4: '4821' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.amount_cents, PAYOUT_MINIMUM_CENTS + 1000);
    accrue(f, INF, 7000);
    const again = await step(7000, 'payout_already_requested_this_month');
    assert.equal(again.body.readiness, 'monthly');
    // A failed payout gave its commissions back, so it does not use up the month.
    f.db.prepare("UPDATE payouts SET status = 'failed' WHERE user_id = ?").run(INF);
    assert.equal((await request(f, INF, 7000, { currency: 'USD' })).status, 200);

    // The readiness read says the same, item by item.
    const r = await call(f, INF, 'GET', '/api/influencer/me/payout-readiness');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.items.map((i: any) => i.key), ['identity', 'tax_form', 'terms', 'payout_method', 'minimum', 'monthly']);
    const item = (k: string) => r.body.items.find((i: any) => i.key === k);
    assert.equal(item('monthly').ready, false);
    assert.equal(item('monthly').next_on, nextMonthStart(new Date()));
    assert.deepEqual([item('payout_method').label, item('payout_method').last4, item('payout_method').blocks], ['Main account', '4821', false]);
    assert.equal(r.body.ready, false);

    // A member who is not an influencer: the request is as before, and the influencer routes are not theirs.
    accrue(f, MEMBER, 2000);
    assert.equal((await request(f, MEMBER, 2000)).status, 200, 'no KYC, no tax form, under $50: unchanged for a referral partner');
    assert.deepEqual([(await call(f, MEMBER, 'GET', '/api/influencer/me/payout-readiness')).body.error], ['not_an_influencer']);
  } finally { f.close(); }
});

test('2. the tax form: its type and size, review by the Super Admin only, a rejection reaching the influencer, the audit', async () => {
  // Mutation checked: the Super Admin check dropped → the admin's decision is accepted; a rejection without a reason allowed →
  // the reason_required check fails; logAdminAction removed → the audit count fails.
  const f = fixture();
  try {
    const up = (body: unknown) => call(f, INF, 'POST', '/api/influencer/me/tax-form', body);
    assert.equal((await call(f, INF, 'GET', '/api/influencer/me/tax-form')).body.status, 'missing');
    assert.equal((await up({ form_type: 'w4', file: PDF })).body.error, 'invalid_form_type');
    assert.equal((await up({ form_type: 'w9', file: 'data:text/html;base64,PGI+' })).body.error, 'unsupported_type');
    const big = `data:application/pdf;base64,${Buffer.alloc(5 * 1024 * 1024 + 10).toString('base64')}`;
    assert.deepEqual([(await up({ form_type: 'w9', file: big })).status], [413]);
    assert.equal((await call(f, MEMBER, 'POST', '/api/influencer/me/tax-form', { form_type: 'w9', file: PDF })).body.error, 'not_an_influencer');
    assert.equal(f.files.objects.size, 0, 'nothing refused was stored');

    assert.equal((await up({ form_type: 'w8ben', file: PDF })).status, 201);
    const decide = (who: number, body: unknown) => call(f, who, 'POST', '/api/admin/influencers/u-inf/tax-form/decision', body);
    const byAdmin = await decide(ADMIN, { decision: 'accept' });
    assert.deepEqual([byAdmin.status, byAdmin.body.error], [403, 'super_admin_only']);
    assert.equal((await decide(INF, { decision: 'accept' })).status, 403, 'a member is not an admin');
    assert.equal((await decide(SUPER, { decision: 'reject' })).body.error, 'reason_required');
    assert.equal((await decide(SUPER, { decision: 'reject', reason: 'The form is not signed.' })).status, 200);
    const seen = await call(f, INF, 'GET', '/api/influencer/me/tax-form');
    assert.deepEqual([seen.body.status, seen.body.form_type, seen.body.reason], ['rejected', 'w8ben', 'The form is not signed.']);
    assert.equal((await decide(SUPER, { decision: 'accept' })).body.error, 'no_form_to_review', 'a decided form is not decided again');

    assert.equal((await up({ form_type: 'w8ben', file: PDF })).status, 201, 'sent again after a rejection');
    assert.equal((await decide(SUPER, { decision: 'accept' })).status, 200);
    assert.deepEqual([(await call(f, INF, 'GET', '/api/influencer/me/tax-form')).body.status], ['accepted']);
    assert.equal((await up({ form_type: 'w9', file: PDF })).body.error, 'tax_form_already_accepted');
    const rows = f.db.prepare('SELECT status FROM influencer_tax_forms WHERE user_id = ? ORDER BY id').all(INF).map((r: any) => r.status);
    assert.deepEqual(rows, ['rejected', 'accepted'], 'the rejected form stays as the record');
    const audit = f.db.prepare("SELECT action, viewed_user_id FROM admin_audit_log WHERE action = 'influencer_tax_form_decided'").all() as any[];
    assert.equal(audit.length, 2);
    assert.ok(audit.every((a) => a.viewed_user_id === INF));
  } finally { f.close(); }
});

test('3. the file stays private: no reply carries its key, only the Super Admin streams it, never outside taxforms/', async () => {
  // Mutation checked: the Super Admin check dropped on the file route → the admin read succeeds; the prefix guard removed →
  // the kyc/ key is served; no-store dropped → the header check fails.
  const f = fixture();
  try {
    const up = await call(f, INF, 'POST', '/api/influencer/me/tax-form', { form_type: 'w9', file: PDF });
    const [key] = [...f.files.objects.keys()];
    assert.match(key, /^taxforms\/2\/[0-9a-f-]{36}\.pdf$/);
    for (const r of [up, await call(f, INF, 'GET', '/api/influencer/me/tax-form'), await call(f, INF, 'GET', '/api/influencer/me/payout-readiness')]) {
      assert.ok(!r.text.includes('taxforms/') && !r.text.includes(key), 'no reply names where the file is');
    }
    const path = '/api/admin/influencers/u-inf/tax-form/file';
    assert.equal((await call(f, INF, 'GET', path)).status, 403, 'not the member');
    assert.deepEqual([(await call(f, ADMIN, 'GET', path)).body.error], ['super_admin_only']);
    const read = await call(f, SUPER, 'GET', path);
    assert.equal(read.status, 200);
    assert.equal(read.text, '%PDF-1.4 synthetic W-9');
    assert.equal(read.headers.get('cache-control'), 'no-store, private');
    assert.match(read.headers.get('content-disposition')!, /^attachment; filename="w9\.pdf"$/);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'influencer_tax_form_viewed'").get()!.n, 1);
    f.files.objects.set('kyc/2/passport.pdf', new Uint8Array([1]));
    assert.equal(await getTaxForm(f.env, 'kyc/2/passport.pdf'), null, 'the reader never serves outside taxforms/');
    assert.equal((await call(f, SUPER, 'GET', '/api/admin/influencers/u-member/tax-form/file')).body.error, 'no_tax_form');
    assert.equal(monthStart(new Date('2026-11-30T23:59:00Z')), '2026-11-01 00:00:00');
    assert.equal(nextMonthStart(new Date('2026-12-15T00:00:00Z')), '2027-01-01');
  } finally { f.close(); }
});
