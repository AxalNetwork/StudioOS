/**
 * D752 (#1890) section 4 — Axal's admins read an investor's shared proof of
 * funds, audited before it answers, and the LP application queue's state.
 *
 * Who may read; the three query forms; the audit row first (or 503, with no
 * view counted); a failed read; active, expired, revoked and superseded
 * statements; the investor's other active statements; the view count; the
 * queue's `proof_of_funds`; and the static rules (the route reads only
 * `capital_attestations` and `users`, and never the personal bank code).
 *
 * Statements are inserted with SQL. Mercury is the `bank()` stub, and no case
 * calls it. Names, holders and floors are invented: the floors are 25,000,000
 * and 10,000,000 cents, and none equals a target figure in the fixture.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/admin_capital_attestations_d752.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tableFromBaseline } from './_baseline.mjs';
import { mig } from './_mercury_d713.ts';
import { codeOnly } from './_codeOnly.mjs';
import { personalFixture, bank, req, day } from './_mercury_personal_d713.ts';
import { currentPerTarget, statementSentence } from '../src/services/capitalAttestationTerms.ts';

async function setup() {
  const { db, env } = await personalFixture();
  const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
  // deals, commitments and deal_invitations come from the shared world (`_mercury_d713.ts`, since #1887).
  db.exec(tableFromBaseline(baseline, 'lp_applications'));
  db.exec(mig('491_mercury_capital_attestations.sql'));
  db.exec(`INSERT INTO users (id, role, name, email) VALUES (31, 'investor', 'Second Investor', 'second@example.test');
    INSERT INTO lp_applications (id, user_id, fund_slug, investor_type, target_commitment, status) VALUES
      (201, 30, 'spinout-fund-i', 'individual', 400000.00, 'in_review'),
      (202, 31, 'spinout-fund-i', 'individual', 150000.00, 'pending'),
      (203, 10, 'spinout-fund-i', 'individual', 90000.00, 'pending'),
      (204, 20, 'spinout-fund-i', 'individual', 80000.00, 'pending');`);
  return { db, env };
}

let n = 0;
function statement(db: any, over: Record<string, unknown> = {}) {
  n += 1;
  const r = {
    uid: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, user_id: 30, purpose: 'deal_commitment', target_id: 101, deal_id: 1, fund_id: null,
    amount_floor_cents: 25000000, as_of: day(0), expires_on: day(30), holder_name: 'Own Practice LLC', accounts_counted: 2,
    consent_version: 'd752-1', state: 'active', revoked_at: null, ...over,
  };
  const keys = Object.keys(r);
  db.prepare(`INSERT INTO capital_attestations (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...Object.values(r) as any[]);
  return r.uid as string;
}
const views = (db: any, uid: string) => db.prepare('SELECT admin_view_count AS c, last_admin_view_at AS at FROM capital_attestations WHERE uid = ?').get(uid) as any;
const audits = (db: any) => db.prepare("SELECT * FROM admin_audit_log WHERE action = 'capital_attestations_read'").all() as any[];
const BASE = '/api/admin/capital-attestations';

test('who: partner, founder and investor 403; an admin on a branch or in a support session 403; nothing audited or counted; admins and the Super Admin read', async () => {
  const { db, env } = await setup();
  const uid = statement(db);
  const b = bank();
  try {
    for (const who of [20, 10, 30]) {
      const r = await req(env, who, 'GET', `${BASE}?deal_id=1`);
      assert.equal(r.status, 403, `${who}: ${r.text}`);
    }
    let r = await req(env, 2, 'GET', `${BASE}?deal_id=1`, undefined, { branch: true });
    assert.deepEqual([r.status, r.body.code], [403, 'hq_only']);
    r = await req(env, 2, 'GET', `${BASE}?deal_id=1`, undefined, { impersonated: true });
    assert.deepEqual([r.status, r.body.code], [403, 'support_session_refused']);
    assert.equal(audits(db).length, 0);
    assert.equal(views(db, uid).c, 0);
    for (const who of [2, 1]) {
      r = await req(env, who, 'GET', `${BASE}?deal_id=1`);
      assert.equal(r.status, 200, `${who}: ${r.text}`);
    }
    assert.equal(b.calls.length, 0, 'Mercury is never called');
  } finally { b.restore(); }
});

test('the query: exactly one form, a known purpose and positive ids; a refusal reads nothing and audits nothing', async () => {
  const { db, env } = await setup();
  for (const [q, code] of [
    ['', 'invalid_query'], ['?deal_id=1&fund_id=1', 'invalid_query'], ['?purpose=lp_application&target_id=1&deal_id=1', 'invalid_query'],
    ['?purpose=other&target_id=1', 'invalid_purpose'], ['?purpose=lp_application&target_id=0', 'invalid_target_id'],
    ['?purpose=lp_application&target_id=1.5', 'invalid_target_id'], ['?purpose=lp_application', 'invalid_target_id'],
    ['?deal_id=abc', 'invalid_deal_id'], ['?fund_id=-3', 'invalid_fund_id'],
  ]) {
    const r = await req(env, 2, 'GET', `${BASE}${q}`);
    assert.deepEqual([r.status, r.body.code], [400, code], q);
  }
  assert.equal(audits(db).length, 0);
});

test('audit first: one row with ids and counts only; no audit row means 503, nothing shown and no view counted', async () => {
  const { db, env } = await setup();
  const uid = statement(db);
  let r = await req(env, 2, 'GET', `${BASE}?purpose=deal_commitment&target_id=101`);
  assert.equal(r.status, 200, r.text);
  const rows = audits(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].admin_user_id, 2);
  const filters = JSON.parse(rows[0].filters_json);
  assert.deepEqual(filters, { purpose: 'deal_commitment', target_id: 101, deal_id: null, fund_id: null, count: 1, viewed: 1 });
  for (const s of ['25000000', '250,000', 'Own Practice', 'Investor']) assert.ok(!rows[0].filters_json.includes(s), s);
  assert.equal(views(db, uid).c, 1);
  db.exec("CREATE TRIGGER no_audit BEFORE INSERT ON admin_audit_log BEGIN SELECT RAISE(ABORT, 'audit down'); END;");
  r = await req(env, 2, 'GET', `${BASE}?purpose=deal_commitment&target_id=101`);
  assert.deepEqual([r.status, r.body.code], [503, 'audit_unavailable']);
  assert.ok(!('items' in r.body));
  assert.ok(!r.text.includes('25000000') && !r.text.includes('250,000'));
  assert.equal(views(db, uid).c, 1, 'no view counted without the audit row');
});

test('unreadable: a failed read is 503 attestations_unreadable, never an empty list, and writes no audit row', async () => {
  const { db, env } = await setup();
  db.exec('DROP TRIGGER trg_capital_attestations_block_delete; DROP TABLE capital_attestations');
  const r = await req(env, 2, 'GET', `${BASE}?deal_id=1`);
  assert.deepEqual([r.status, r.body.code, r.body.detail], [503, 'attestations_unreadable', 'The proofs of funds could not be read. This is not a claim that none was shared.']);
  assert.ok(!('items' in r.body), 'never an empty list');
  assert.equal(audits(db).length, 0);
});

const ACTIVE_KEYS = ['uid', 'purpose', 'target_id', 'deal_id', 'fund_id', 'investor_user_id', 'investor_name', 'target_label', 'state', 'label', 'expired',
  'amount_floor_cents', 'as_of', 'expires_on', 'holder_name', 'accounts_counted', 'shared_on', 'statement', 'other_active', 'other_active_count'];
const REVOKED_KEYS = ['uid', 'purpose', 'target_id', 'deal_id', 'fund_id', 'investor_user_id', 'investor_name', 'target_label', 'state', 'label', 'revoked_on', 'statement'];

test('active and expired: the exact keys, the investor\'s sentence; an expired statement keeps its amount', async () => {
  const { db, env } = await setup();
  statement(db);
  let r = await req(env, 2, 'GET', `${BASE}?purpose=deal_commitment&target_id=101`);
  const [item] = r.body.items;
  assert.deepEqual(Object.keys(item), ACTIVE_KEYS);
  const row: any = db.prepare('SELECT * FROM capital_attestations').get();
  assert.deepEqual([item.label, item.expired, item.statement, item.investor_name, item.target_label, item.shared_on],
    ['Active', false, statementSentence(row), 'Investor', 'Commitment on deal #1', String(row.consented_at).slice(0, 10)]);
  for (const k of ['consent_version', 'admin_view_count', 'last_admin_view_at', 'created_at', 'updated_at']) assert.ok(!(k in item), k);
  statement(db, { target_id: 102, as_of: day(-31), expires_on: day(-1), amount_floor_cents: 10000000 });
  r = await req(env, 2, 'GET', `${BASE}?purpose=deal_commitment&target_id=102`);
  assert.deepEqual([r.body.items[0].label, r.body.items[0].expired, r.body.items[0].amount_floor_cents], ['Expired', true, 10000000]);
});

test('revoked: its date and nothing it said; the newest revoked shows when none is active', async () => {
  const { db, env } = await setup();
  statement(db, { state: 'revoked', revoked_at: '2026-10-01 09:00:00', holder_name: 'Old Holder LLC' });
  const newest = statement(db, { state: 'revoked', revoked_at: '2026-10-20 09:00:00' });
  const r = await req(env, 2, 'GET', `${BASE}?purpose=deal_commitment&target_id=101`);
  assert.equal(r.body.items.length, 1);
  const [item] = r.body.items;
  assert.deepEqual(Object.keys(item), REVOKED_KEYS);
  assert.deepEqual([item.uid, item.label, item.revoked_on, item.statement], [newest, 'Revoked', '2026-10-20', 'Revoked by the investor on 2026-10-20.']);
  for (const s of ['25000000', '250,000', 'Own Practice', 'Old Holder']) assert.ok(!r.text.includes(s), s);
  assert.deepEqual(r.body.items.map((i: any) => i.state), ['revoked']);
});

test('superseded: never shown, counted or returned; only the active one is', async () => {
  const { db, env } = await setup();
  const old = statement(db, { state: 'superseded', amount_floor_cents: 31700000 });
  const live = statement(db);
  const r = await req(env, 2, 'GET', `${BASE}?purpose=deal_commitment&target_id=101`);
  assert.deepEqual(r.body.items.map((i: any) => i.uid), [live]);
  assert.ok(!r.text.includes('31700000') && !r.text.includes('317,000'));
  assert.equal(views(db, old).c, 0);
  // The read itself leaves superseded rows out, so they never fill its limit.
  db.exec('BEGIN');
  for (let i = 0; i < 501; i += 1) statement(db, { state: 'superseded' });
  db.exec('COMMIT');
  const many = await req(env, 2, 'GET', `${BASE}?purpose=deal_commitment&target_id=101`);
  assert.deepEqual([many.body.truncated, many.body.items.map((i: any) => i.uid)], [false, [live]]);
  // And the grouping drops one on its own.
  assert.deepEqual(currentPerTarget([{ id: 1, user_id: 30, purpose: 'deal_commitment', target_id: 9, state: 'superseded', revoked_at: null }] as any), []);
});

test('?deal_id: that deal\'s commitments, by target id, without reading commitments; ?fund_id: the fund\'s applications and LP commitments only', async () => {
  const { db, env } = await setup();
  statement(db, { target_id: 102 });
  statement(db, { target_id: 101, user_id: 31, amount_floor_cents: 10000000 });
  statement(db, { target_id: 109, deal_id: 2 });
  statement(db, { purpose: 'lp_application', target_id: 201, deal_id: null, fund_id: 7 });
  statement(db, { purpose: 'lp_commitment', target_id: 301, deal_id: null, fund_id: 7 });
  db.exec('DROP TABLE commitments');
  let r = await req(env, 2, 'GET', `${BASE}?deal_id=1`);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.items.map((i: any) => i.target_id), [101, 102]);
  assert.equal(r.body.deal_id, 1);
  r = await req(env, 2, 'GET', `${BASE}?fund_id=7`);
  assert.deepEqual(r.body.items.map((i: any) => i.purpose).sort(), ['lp_application', 'lp_commitment']);
  assert.equal(r.body.fund_id, 7);
  r = await req(env, 2, 'GET', `${BASE}?fund_id=8`);
  assert.deepEqual(r.body.items, []);
});

test('other active: each item lists the investor\'s other active statements, never itself and never another investor\'s', async () => {
  const { db, env } = await setup();
  const a = statement(db, { target_id: 101 });
  const b2 = statement(db, { purpose: 'lp_application', target_id: 201, deal_id: null, fund_id: 7, amount_floor_cents: 10000000 });
  statement(db, { user_id: 31, target_id: 103 });
  const r = await req(env, 2, 'GET', `${BASE}?purpose=deal_commitment&target_id=101`);
  const [item] = r.body.items;
  assert.equal(item.uid, a);
  assert.equal(item.other_active_count, 1);
  assert.deepEqual(item.other_active, [{ purpose: 'lp_application', target_label: 'Fund I application', amount_floor_cents: 10000000, as_of: day(0), expired: false }]);
  assert.equal(views(db, b2).c, 1, 'a statement whose amount was shown beside is counted too');
  // Two investors in one answer: each item lists only its own investor's others.
  statement(db, { user_id: 31, target_id: 102, amount_floor_cents: 10000000 });
  const deal = await req(env, 2, 'GET', `${BASE}?deal_id=1`);
  const by = Object.fromEntries(deal.body.items.map((i: any) => [i.target_id, i]));
  assert.deepEqual(by[101].other_active.map((o: any) => o.target_label), ['Fund I application']);
  assert.deepEqual([by[102].investor_user_id, by[102].other_active.map((o: any) => o.target_label)], [31, ['Commitment on deal #1']]);
});

test('views: one per read on each statement whose amount was carried; revoked and superseded never; a failed count is 503 with nothing shown', async () => {
  const { db, env } = await setup();
  const live = statement(db);
  const gone = statement(db, { target_id: 105, state: 'revoked', revoked_at: '2026-10-02 00:00:00' });
  const old = statement(db, { target_id: 106, state: 'superseded' });
  await req(env, 2, 'GET', `${BASE}?deal_id=1`);
  assert.equal(views(db, live).c, 1);
  assert.ok(views(db, live).at);
  assert.deepEqual([views(db, gone).c, views(db, old).c], [0, 0]);
  await req(env, 1, 'GET', `${BASE}?deal_id=1`);
  assert.equal(views(db, live).c, 2);
  db.exec("CREATE TRIGGER no_bump BEFORE UPDATE OF admin_view_count ON capital_attestations BEGIN SELECT RAISE(ABORT, 'no'); END;");
  const r = await req(env, 2, 'GET', `${BASE}?deal_id=1`);
  assert.deepEqual([r.status, r.body.code], [503, 'audit_unavailable']);
  assert.ok(!('items' in r.body));
});

test('the queue: each row\'s state, the applicant\'s own statements only, no figure, no audit, no view; unreadable and null as decided', async () => {
  const { db, env } = await setup();
  const active = statement(db, { purpose: 'lp_application', target_id: 201, deal_id: null, fund_id: 7 });
  statement(db, { purpose: 'lp_application', target_id: 202, user_id: 31, deal_id: null, fund_id: 7, as_of: day(-40), expires_on: day(-10) });
  statement(db, { purpose: 'lp_application', target_id: 203, user_id: 10, deal_id: null, fund_id: 7, state: 'revoked', revoked_at: '2026-10-01 00:00:00' });
  statement(db, { purpose: 'lp_application', target_id: 204, user_id: 30, deal_id: null, fund_id: 7 });
  const state = (r: any) => Object.fromEntries(r.body.applications.map((a: any) => [a.id, a.proof_of_funds]));
  let r = await req(env, 2, 'GET', '/api/admin/lp-applications');
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(state(r), { 201: 'active', 202: 'expired', 203: 'revoked', 204: 'none' }, 'a statement by someone else on 204 does not count');
  for (const s of ['25000000', '250,000', 'Own Practice']) assert.ok(!r.text.includes(s), s);
  assert.equal(audits(db).length, 0);
  assert.equal(views(db, active).c, 0);
  const patched = await req(env, 2, 'PATCH', '/api/admin/lp-applications/201', { status: 'needs_follow_up', review_note: 'Please send the subscription form.' });
  assert.equal(patched.status, 200, patched.text);
  assert.equal(patched.body.application.proof_of_funds, 'active');
  r = await req(env, 2, 'GET', '/api/admin/lp-applications', undefined, { branch: true });
  assert.ok(Object.values(state(r)).every((v) => v === null), 'null on a branch');
  r = await req(env, 2, 'GET', '/api/admin/lp-applications', undefined, { impersonated: true });
  if (r.status === 200) assert.ok(Object.values(state(r)).every((v) => v === null), 'null in a support session');
  db.exec('DROP TRIGGER trg_capital_attestations_block_delete; DROP TABLE capital_attestations');
  r = await req(env, 2, 'GET', '/api/admin/lp-applications');
  assert.equal(r.status, 200);
  assert.ok(Object.values(state(r)).every((v) => v === 'unreadable'), 'never none when unreadable');
});

const root = 'cloudflare-worker/src';
const walk = (p: string): string[] => readdirSync(p, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(p, e.name)) : [join(p, e.name)]));
const src = (f: string) => readFileSync(join(root, f), 'utf8');

test('static: the route reads capital_attestations and users only, imports no bank code, has no money path, and is mounted before the admin catch-all', () => {
  const route = codeOnly(src('routes/admin_capital_attestations.ts'));
  for (const m of route.matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+(?:\(\?\))?)/g)) assert.ok(['capital_attestations', 'users', 'json_each(?)'].includes(m[1]), m[1]);
  for (const m of route.matchAll(/\bUPDATE\s+([a-z_]+)/g)) assert.equal(m[1], 'capital_attestations');
  assert.match(route, /UPDATE capital_attestations SET admin_view_count = admin_view_count \+ 1[^`]*WHERE state = 'active' AND uid IN/, 'only an active statement gains a view');
  assert.doesNotMatch(route, /\bintegrations\b|integration_logs|mercury_personal_matches|provider_key/);
  const imports = [...route.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  for (const i of imports) assert.ok(['hono', '../types', '../services/mercury/access', '../services/capitalAttestationTerms'].includes(i) || i.startsWith('../util/'), i);
  for (const m of route.matchAll(/adminCapitalAttestations\.(?:get|post|put|patch|delete)\('([^']*)'/g)) assert.doesNotMatch(m[1], /send|transfer|pay|payout|wire/i);
  const index = src('index.ts');
  const mount = index.indexOf("app.route('/api/admin/capital-attestations'");
  assert.ok(mount > index.indexOf("app.route('/api/admin/lp-applications'"), 'after the LP queue');
  assert.ok(mount < index.indexOf("app.route('/api/admin', "), 'before the first catch-all');
  const queue = src('routes/admin_lp_applications.ts');
  const lists = [...queue.matchAll(/SELECT\s+([^`]*?)\s+FROM capital_attestations/g)].map((m) => m[1].replace(/\s+/g, ' '));
  assert.ok(lists.length >= 1);
  for (const l of lists) assert.equal(l, 'ca.target_id, ca.state, ca.expires_on');
  assert.doesNotMatch(src('routes/deals.ts'), /capital_attestations/);
  for (const f of [...walk(join(root, 'mcp')), join(root, 'services/eadwynConnectors.ts'), join(root, 'services/eadwynReaders.ts')]) {
    assert.doesNotMatch(readFileSync(f, 'utf8'), /capital_attestations|admin_capital_attestations/, f);
  }
  assert.doesNotMatch(index.slice(index.indexOf('scheduled')), /capital_attestations|admin_capital_attestations/);
});
