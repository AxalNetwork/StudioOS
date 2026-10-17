/**
 * D709 (#1774) — funding: a fee line is paid when the capital call line it is
 * linked to is paid in full (decision 8), and a period when all its lines are.
 * Every figure is synthetic.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/fund_fee_funding_d709.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GP, Q0, FEE_START, makeEnv, call, q, one, readyFund, preview, issue } from './_fund_fees_d709_harness.ts';

/** A call of $1,500,000 split 2:1, so LP A's line owes 100,000,000 cents and LP B's 50,000,000. */
async function capitalCall(env: any, cents = 150_000_000) {
  const r = await call(env, GP, '/api/funds/1/capital-call', { method: 'POST', body: { amount_cents: cents } });
  assert.equal(r.status < 300, true, JSON.stringify(r.body));
  const header = one(env, 'SELECT id, uid FROM fund_capital_calls ORDER BY id DESC LIMIT 1');
  const lines = Object.fromEntries(q(env, 'SELECT id, limited_partner_id FROM capital_calls WHERE fund_call_id = ?', header.id).map(l => [l.limited_partner_id, l.id]));
  return { uid: header.uid as string, lines };
}
async function issued(env: any, extra: Record<string, unknown> = {}) {
  await readyFund(env);
  const p = await preview(env);
  const r = await issue(env, p.body.digest, Q0, GP, extra);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}
const fee = (env: any, lp: number) => one(env, 'SELECT status, paid_via, paid_evidence, capital_call_line_id FROM fund_fee_lines WHERE limited_partner_id = ?', lp);
const period = (env: any) => one(env, 'SELECT status, paid_at FROM fund_fee_periods').status;
const receive = (env: any, lineId: number, cents: number) =>
  call(env, GP, `/api/funds/1/capital-calls/lines/${lineId}/receipts`, { method: 'POST', body: { amount_cents: cents, received_on: FEE_START, reference: 'WIRE (synthetic)' } });

test('a receipt paying a linked call line in full pays the fee line, then the period; a part payment does not', async () => {
  const env = makeEnv();
  const c = await capitalCall(env);
  const out = await issued(env, { funding_call_uid: c.uid });
  assert.deepEqual(out.funding.linked.map((l: any) => l.limited_partner_id), [100, 200]);
  assert.deepEqual(out.funding.unlinked, []);
  const part = await receive(env, c.lines[100], 1_000);
  assert.equal(part.status, 201, JSON.stringify(part.body));
  assert.equal(fee(env, 100).status, 'issued', 'a part payment leaves the fee line issued');
  const rest = await receive(env, c.lines[100], 100_000_000 - 1_000);
  assert.equal(rest.status, 201);
  const paid = fee(env, 100);
  assert.deepEqual([paid.status, paid.paid_via], ['paid', 'capital_call']);
  assert.equal(paid.paid_evidence, rest.body.receipt.uid, 'the receipt is the evidence');
  assert.equal(period(env), 'issued', 'not while LP B\'s line is open');
  await receive(env, c.lines[200], 50_000_000);
  assert.equal(fee(env, 200).status, 'paid');
  assert.equal(period(env), 'paid');
});

test('mark-paid on a linked call line settles its fee line too', async () => {
  const env = makeEnv();
  const c = await capitalCall(env);
  await issued(env);
  const linked = await call(env, GP, `/api/fund-fees/1/periods/${Q0}/funding-call`, { method: 'POST', body: { call_uid: c.uid } });
  assert.equal(linked.status, 200, JSON.stringify(linked.body));
  const r = await call(env, GP, `/api/capital/calls/${c.lines[200]}/pay`, { method: 'POST' });
  assert.ok(r.status < 300, JSON.stringify(r.body));
  assert.equal(fee(env, 200).status, 'paid');
  assert.equal(fee(env, 100).status, 'issued');
});

test('linking to an already-paid call line pays the fee line at once', async () => {
  const env = makeEnv();
  const c = await capitalCall(env);
  await receive(env, c.lines[100], 100_000_000);
  await issued(env);
  const r = await call(env, GP, `/api/fund-fees/1/periods/${Q0}/funding-call`, { method: 'POST', body: { call_uid: c.uid } });
  assert.deepEqual(r.body.linked.map((l: any) => [l.limited_partner_id, l.paid]), [[100, true], [200, false]]);
  assert.equal(fee(env, 100).status, 'paid');
  assert.equal(fee(env, 200).status, 'issued');
});

test('a link past what the call line owes is refused, and an LP with no line in the call is listed', async () => {
  const env = makeEnv();
  const small = await capitalCall(env, 300); // 200 and 100 cents: less than either fee
  env.__db.exec(`INSERT INTO limited_partners (id, fund_id, name, commitment_amount, status) VALUES (600, 1, 'LP D', 250000, 'committed')`);
  await call(env, GP, '/api/fund-fees/1/lps/600/admission', { method: 'PUT', body: { admitted_on: FEE_START, source: 'memo' } });
  await issued(env);
  const r = await call(env, GP, `/api/fund-fees/1/periods/${Q0}/funding-call`, { method: 'POST', body: { call_uid: small.uid } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.linked, []);
  assert.deepEqual(r.body.unlinked, [
    { limited_partner_id: 100, reason: 'exceeds_call_line' }, { limited_partner_id: 200, reason: 'exceeds_call_line' },
    { limited_partner_id: 600, reason: 'no_call_line' },
  ]);
  assert.deepEqual(q(env, 'SELECT capital_call_line_id FROM fund_fee_lines').map(l => l.capital_call_line_id), [null, null, null]);
  assert.equal((await call(env, GP, `/api/fund-fees/1/periods/${Q0}/funding-call`, { method: 'POST', body: { call_uid: 'nope' } })).status, 404);
});

test('a link is refused before issue', async () => {
  const env = makeEnv();
  const c = await capitalCall(env);
  await readyFund(env);
  await preview(env);
  assert.equal((await call(env, GP, `/api/fund-fees/1/periods/${Q0}/funding-call`, { method: 'POST', body: { call_uid: c.uid } })).status, 409);
});
