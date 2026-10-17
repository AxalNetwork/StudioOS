/**
 * D709 (#1774) — the management-fee routes over real node:sqlite: access, terms,
 * preview, issue, the seals and statements. Every figure is synthetic.
 *
 * The remittance block (decision 9, #1773's `fundPayeeOf` and
 * `payInstructionsFor`) and its account-number sweep join this file once #1773
 * merges; until then a statement's `pay_to` is asserted here.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/fund_fees_d709.test.ts
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN, SUPER, GP, OTHER_GP, PRO_LP, LP_USER, Q0, Q1, Q2, FEE_START,
  makeEnv, call, q, one, count, readyFund, preview, issue,
} from './_fund_fees_d709_harness.ts';
import { parseQuarter } from '../src/services/fundFeeCalc.ts';

// No module here may reach the network: fetch is a counter that throws.
let fetches = 0;
const realFetch = globalThis.fetch;
beforeEach(() => { fetches = 0; globalThis.fetch = (async () => { fetches += 1; throw new Error('no network in D709'); }) as any; });
afterEach(() => { globalThis.fetch = realFetch; assert.equal(fetches, 0, 'fetch was called'); });

test('access: the GP of record and an admin pass; below institutional is 402 first; another GP, an LP and another fund\'s LP are 404', async () => {
  const env = makeEnv();
  assert.equal((await call(env, GP, '/api/fund-fees/1')).status, 200);
  assert.equal((await call(env, ADMIN, '/api/fund-fees/1')).status, 200);
  assert.equal((await call(env, PRO_LP, '/api/fund-fees/1')).status, 402, 'the tier is checked first');
  assert.equal((await call(env, PRO_LP, '/api/fund-fees/999')).status, 402, 'even for a fund that does not exist');
  assert.equal((await call(env, OTHER_GP, '/api/fund-fees/1')).status, 404);
  assert.equal((await call(env, LP_USER, '/api/fund-fees/1')).status, 404, 'an LP of the fund is not its GP');
  const foreign = await call(env, GP, '/api/fund-fees/1/lps/500/admission', { method: 'PUT', body: { admitted_on: FEE_START, source: 'x' } });
  assert.equal(foreign.status, 404);
  assert.equal(count(env, 'fund_lp_admissions'), 0);
});

test('a plain admin gets super_admin_required on confirm and issue, never a TOTP demand, and nothing is written', async () => {
  const env = makeEnv();
  const t = await call(env, ADMIN, '/api/fund-fees/1/terms', { method: 'POST', body: { fee_start_date: FEE_START, investment_period_end: '2099-12-31', lpa_reference: 'LPA §8.1' } });
  assert.equal(t.status, 201);
  const logs = count(env, 'activity_logs');
  for (const claims of [{ jti: `totp-${ADMIN}` }, {}]) {
    const r = await call(env, ADMIN, `/api/fund-fees/1/terms/${t.body.uid}/confirm`, { method: 'POST', claims });
    assert.deepEqual([r.status, r.body.code], [403, 'super_admin_required'], JSON.stringify(claims));
  }
  assert.equal(one(env, 'SELECT status FROM fund_mgmt_fee_terms').status, 'draft');
  assert.equal(count(env, 'activity_logs'), logs);
  // The Super Admin with a fresh step-up confirms.
  const ok = await call(env, SUPER, `/api/fund-fees/1/terms/${t.body.uid}/confirm`, { method: 'POST', claims: { jti: `totp-${SUPER}` } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  for (const lp of [100, 200]) await call(env, GP, `/api/fund-fees/1/lps/${lp}/admission`, { method: 'PUT', body: { admitted_on: FEE_START, source: 'memo' } });
  const p = await preview(env);
  assert.equal(p.status, 200, JSON.stringify(p.body));
  const before = count(env, 'activity_logs');
  for (const claims of [{ jti: `totp-${ADMIN}` }, {}]) {
    const r = await call(env, ADMIN, `/api/fund-fees/1/periods/${Q0}/issue`, { method: 'POST', body: { digest: p.body.digest }, claims });
    assert.deepEqual([r.status, r.body.code], [403, 'super_admin_required']);
  }
  assert.equal(one(env, 'SELECT status FROM fund_fee_periods').status, 'draft');
  assert.equal(count(env, 'activity_logs'), before);
  // A non-admin GP of record issues on their own fund as written.
  assert.equal((await issue(env, p.body.digest)).status, 200);
});

test('a support session\'s write is 403', async () => {
  const env = makeEnv();
  const r = await call(env, GP, '/api/fund-fees/1/terms', { method: 'POST', claims: { impersonated_by: ADMIN },
    body: { fee_start_date: FEE_START, investment_period_end: '2099-12-31', lpa_reference: 'LPA §8.1' } });
  assert.equal(r.status, 403);
  assert.equal(count(env, 'fund_mgmt_fee_terms'), 0);
  assert.equal((await call(env, GP, '/api/fund-fees/1', { claims: { impersonated_by: ADMIN } })).status, 200, 'a read is not a write');
});

test('terms: a draft, its defaults, confirm, and versions that cannot reach into the past', async () => {
  const env = makeEnv();
  const state = await call(env, GP, '/api/fund-fees/1');
  assert.deepEqual(state.body.defaults, { annual_bps: 200, basis_during: 'committed', basis_after: 'net_invested', frequency: 'quarterly_in_advance', payee: 'gp', offset_bps: 10000 });
  assert.deepEqual(state.body.lps.map((l: any) => [l.id, l.admission_missing]), [[100, true], [200, true]], 'billable LPs, with the missing dates flagged');
  for (const bad of [{ lpa_reference: '' }, { annual_bps: 10001 }, { offset_bps: -1 }, { basis_after: 'gross' }, { investment_period_end: '2000-01-01' }]) {
    const r = await call(env, GP, '/api/fund-fees/1/terms', { method: 'POST', body: { fee_start_date: FEE_START, investment_period_end: '2099-12-31', lpa_reference: 'LPA', ...bad } });
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  const first = await call(env, GP, '/api/fund-fees/1/terms', { method: 'POST', body: { fee_start_date: FEE_START, investment_period_end: '2099-12-31', lpa_reference: 'LPA §8.1', effective_from: parseQuarter(Q1)!.first } });
  assert.equal(first.status, 400, 'the first version takes effect on its fee start date');
  const uid = await readyFund(env);
  assert.deepEqual({ ...one(env, 'SELECT annual_bps, basis_during, basis_after, frequency, payee, offset_bps, status FROM fund_mgmt_fee_terms WHERE uid = ?', uid) },
    { annual_bps: 200, basis_during: 'committed', basis_after: 'net_invested', frequency: 'quarterly_in_advance', payee: 'gp', offset_bps: 10000, status: 'confirmed' });
  assert.equal((await call(env, GP, `/api/fund-fees/1/terms/${uid}/confirm`, { method: 'POST' })).status, 409);
  const mid = await call(env, GP, '/api/fund-fees/1/terms', { method: 'POST', body: { fee_start_date: FEE_START, investment_period_end: '2099-12-31', lpa_reference: 'LPA', effective_from: addOne(FEE_START) } });
  assert.equal(mid.status, 400, 'a later version starts a quarter');
  // A draft for the coming quarter, then that quarter is issued: the draft would bill into the past, so confirm refuses it.
  const v2 = await call(env, GP, '/api/fund-fees/1/terms', { method: 'POST', body: { fee_start_date: FEE_START, investment_period_end: '2099-12-31', lpa_reference: 'LPA v2', annual_bps: 150, effective_from: parseQuarter(Q1)!.first } });
  assert.equal(v2.status, 201, JSON.stringify(v2.body));
  const p0 = await preview(env); assert.equal((await issue(env, p0.body.digest)).status, 200);
  const p1 = await preview(env, Q1); assert.equal((await issue(env, p1.body.digest, Q1)).status, 200);
  const late = await call(env, GP, `/api/fund-fees/1/terms/${v2.body.uid}/confirm`, { method: 'POST' });
  assert.equal(late.status, 400, JSON.stringify(late.body));
  assert.equal(one(env, 'SELECT status FROM fund_mgmt_fee_terms WHERE uid = ?', v2.body.uid).status, 'draft');
});
const addOne = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

test('preview saves a draft and returns a digest; with a refusal it saves nothing', async () => {
  const env = makeEnv();
  const none = await preview(env);
  assert.equal(none.status, 400, 'no confirmed terms');
  assert.equal(count(env, 'fund_fee_periods'), 0);
  const uid = await readyFund(env);
  await call(env, GP, '/api/fund-fees/1/terms', { method: 'POST', body: {} }); // a refused draft does not matter
  env.__db.exec('DELETE FROM fund_lp_admissions WHERE limited_partner_id = 200');
  const missing = await preview(env);
  assert.equal(missing.status, 400);
  assert.match(JSON.stringify(missing.body.refusals), /no admission date/);
  assert.equal(count(env, 'fund_fee_periods'), 0, 'a refusal saves nothing');
  await call(env, GP, '/api/fund-fees/1/lps/200/admission', { method: 'PUT', body: { admitted_on: FEE_START, source: 'memo' } });
  const p = await preview(env);
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.match(p.body.digest, /^[0-9a-f]{64}$/);
  assert.equal(one(env, 'SELECT status, digest FROM fund_fee_periods').digest, p.body.digest);
  assert.equal(count(env, 'fund_fee_lines'), 2);
  const again = await preview(env);
  assert.equal(again.body.digest, p.body.digest, 'the same inputs, the same digest');
  assert.equal(count(env, 'fund_fee_periods'), 1, 'the draft is replaced, not added');
  assert.ok(uid);
});

test('issue refuses a missing previous quarter, a quarter after the coming one, and a stale digest; writes once', async () => {
  const env = makeEnv();
  await readyFund(env);
  assert.equal((await preview(env, Q1)).status, 409, 'the quarter before is not issued');
  assert.equal((await preview(env, Q2)).status, 400, 'in advance means the coming quarter');
  assert.equal((await issue(env, 'x'.repeat(64))).status, 409, 'nothing previewed');
  const p = await preview(env);
  // An input changes after the preview: the digest is stale.
  await call(env, GP, '/api/fund-fees/1/net-invested', { method: 'POST', body: { as_of: FEE_START, net_invested_cents: 1, source: 'books' } });
  env.__db.exec(`INSERT INTO limited_partners (id, fund_id, name, commitment_amount, status) VALUES (600, 1, 'LP D', 250000, 'committed')`);
  await call(env, GP, '/api/fund-fees/1/lps/600/admission', { method: 'PUT', body: { admitted_on: FEE_START, source: 'memo' } });
  const stale = await issue(env, p.body.digest);
  assert.equal(stale.status, 409);
  assert.equal(one(env, 'SELECT status FROM fund_fee_periods').status, 'draft');
  const fresh = await preview(env);
  assert.equal((await issue(env, 'f'.repeat(64))).status, 409, 'a digest that is not the preview\'s');
  assert.equal(one(env, 'SELECT status FROM fund_fee_periods').status, 'draft');
  const out = await issue(env, fresh.body.digest);
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(out.body.already_issued, false);
  assert.equal(out.body.period.remittance_reference, `AXAL-MF-${Q0}-F1`);
  assert.deepEqual(out.body.lines.map((l: any) => [l.reference_code, l.status]),
    [[`AXAL-MF-${Q0}-L100`, 'issued'], [`AXAL-MF-${Q0}-L200`, 'issued'], [`AXAL-MF-${Q0}-L600`, 'issued']]);
  assert.equal(new Set(out.body.lines.map((l: any) => l.reference_code)).size, 3);
  // A second press changes nothing.
  const rows = () => [count(env, 'fund_fee_periods'), count(env, 'fund_fee_lines'), count(env, 'activity_logs'), JSON.stringify(q(env, 'SELECT * FROM fund_fee_lines ORDER BY id'))];
  const before = rows();
  const twice = await issue(env, fresh.body.digest);
  assert.deepEqual([twice.status, twice.body.already_issued], [200, true]);
  assert.deepEqual(rows(), before);
  assert.equal((await issue(env, p.body.digest)).status, 409, 'an issued quarter with another digest');
  assert.equal((await preview(env)).status, 409, 'an issued quarter is not previewed again');
  // The next quarter now issues.
  const next = await preview(env, Q1);
  assert.equal(next.status, 200);
  assert.equal((await issue(env, next.body.digest, Q1)).status, 200);
});

test('issue refuses unconfirmed terms and a missing admission', async () => {
  const env = makeEnv();
  await call(env, GP, '/api/fund-fees/1/terms', { method: 'POST', body: { fee_start_date: FEE_START, investment_period_end: '2099-12-31', lpa_reference: 'LPA' } });
  const unconfirmed = await preview(env);
  assert.equal(unconfirmed.status, 400);
  assert.match(JSON.stringify(unconfirmed.body.refusals), /no confirmed fee terms/);
  assert.equal((await issue(env, 'x'.repeat(64))).status, 409);
  assert.equal(count(env, 'fund_fee_periods'), 0);
});

test('a failed audit rolls the issue back', async () => {
  const env = makeEnv();
  await readyFund(env);
  const p = await preview(env);
  env.__db.exec(`CREATE TRIGGER reject_issue BEFORE INSERT ON activity_logs WHEN NEW.action = 'fund_fee_period_issued' BEGIN SELECT RAISE(ABORT, 'audit failure'); END`);
  const r = await issue(env, p.body.digest);
  assert.equal(r.status, 500);
  assert.equal(one(env, 'SELECT status FROM fund_fee_periods').status, 'draft');
  assert.deepEqual(q(env, 'SELECT DISTINCT status FROM fund_fee_lines').map(x => x.status), ['draft']);
});

test('the seals: an issued line or period keeps its amounts; no DELETE; a confirmed version is never rewritten', async () => {
  const env = makeEnv();
  await readyFund(env);
  const p = await preview(env);
  await issue(env, p.body.digest);
  const refuses = (sql: string) => assert.throws(() => env.__db.exec(sql), /D709/, sql);
  refuses('UPDATE fund_fee_lines SET gross_fee_cents = gross_fee_cents + 1, net_fee_cents = net_fee_cents + 1 WHERE limited_partner_id = 100');
  refuses('UPDATE fund_fee_periods SET net_cents = 0, gross_cents = 0, catch_up_cents = 0, offset_applied_cents = 0, offset_carried_cents = offset_pool_cents');
  refuses('DELETE FROM fund_fee_lines');
  refuses('DELETE FROM fund_fee_periods');
  refuses("UPDATE fund_fee_lines SET status = 'draft'");
  refuses('UPDATE fund_mgmt_fee_terms SET annual_bps = 100');
  refuses('DELETE FROM fund_mgmt_fee_terms');
  refuses("UPDATE fund_lp_admissions SET admitted_on = '2000-01-01'");
  await call(env, GP, '/api/fund-fees/1/net-invested', { method: 'POST', body: { as_of: FEE_START, net_invested_cents: 5, source: 'books' } });
  refuses('UPDATE fund_net_invested_capital SET net_invested_cents = 6');
  // The admission is fixed through the route too.
  const r = await call(env, GP, '/api/fund-fees/1/lps/100/admission', { method: 'PUT', body: { admitted_on: FEE_START, source: 'memo' } });
  assert.equal(r.status, 409);
});

test('offsets: only a portfolio company of this fund; counted once by the issue that uses it', async () => {
  const env = makeEnv();
  await readyFund(env);
  const bad = await call(env, GP, '/api/fund-fees/1/offsets', { method: 'POST', body: { project_id: 8, axal_entity: 'management', amount_cents: 100, received_on: FEE_START, description: 'Fee', source: 'invoice' } });
  assert.equal(bad.status, 400);
  const ok = await call(env, GP, '/api/fund-fees/1/offsets', { method: 'POST', body: { project_id: 7, axal_entity: 'management', amount_cents: 100, received_on: '2000-01-01', description: 'Spin-Out Lab fee', source: 'invoice 1 (synthetic)' } });
  assert.equal(ok.status, 201);
  const p = await preview(env);
  assert.equal(p.body.totals.offset_pool_cents, 100);
  await issue(env, p.body.digest);
  const period = one(env, 'SELECT id FROM fund_fee_periods');
  assert.equal(one(env, 'SELECT counted_in_period_id FROM fund_fee_offsets').counted_in_period_id, period.id);
  assert.throws(() => env.__db.exec('UPDATE fund_fee_offsets SET counted_in_period_id = NULL'), /D709/);
});

test('statements: one LP\'s figures and reference; nothing is due from the LP', async () => {
  const env = makeEnv();
  await readyFund(env);
  const p = await preview(env);
  await issue(env, p.body.digest);
  const s = await call(env, GP, `/api/fund-fees/1/periods/${Q0}/statements/100`);
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.deepEqual(s.body.pay_to, { due: false, sentence: 'Nothing is due from you against this statement.' });
  assert.equal(s.body.reference_code, `AXAL-MF-${Q0}-L100`);
  assert.equal(s.body.rate_bps, 200);
  assert.equal(s.body.lpa_reference, 'LPA §8.1 (synthetic)');
  assert.equal(s.body.net_fee_cents, s.body.gross_fee_cents + s.body.catch_up_cents - s.body.offset_cents);
  assert.equal((await call(env, GP, `/api/fund-fees/1/periods/${Q0}/statements/500`)).status, 404, 'another fund\'s LP');
  assert.equal((await call(env, GP, '/api/fund-fees/1/periods/2026Q9')).status, 404);
  assert.equal((await call(env, OTHER_GP, `/api/fund-fees/1/periods/${Q0}/statements/100`)).status, 404);
});
