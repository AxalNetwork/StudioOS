/** D6397 (#6397): real audited Fund Admin reads, no-model answers, source states and navigation only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import router from '../src/routes/fund_admin_ask.ts';
import { fundAdminAnswer, FUND_ADMIN_PROMPTS } from '../src/services/ai/fundAdminAnswers.ts';
import { fundAdminOverview } from '../src/services/fundAdminOverview.ts';
import { readFundCalls } from '../src/services/fundCallLedger.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { ADMIN, SUPER, FOUNDER, PARTNER, INVESTOR, ADVISOR, EXPLORING, envFor, freshDb, tokenFor } from './_mercury_fixture.ts';
const TODAY = '2026-11-14';
const app = new Hono<any>().route('/api/fund-admin/ask', router);
app.onError((error: any, c) => c.json({ error: error.message }, AUTH_ERROR_STATUSES[error.message] ?? 500));
function fixture() {
  const db = freshDb();
  db.exec(`INSERT INTO vc_funds (id,name,gp_user_id,fund_size_cents,carried_interest,management_fee,updated_at) VALUES (1,'Synthetic Fund',NULL,0,0,0,'2026-11-01'),(2,'Outside Fund',${FOUNDER},10000,0.2,0.02,'2026-10-01');
    INSERT INTO limited_partners(id,fund_id,name,commitment_amount,invested_amount,status) VALUES (10,1,'LP Alpha',1000,0,'active'),(11,1,'LP Beta',500,0,'active');
    INSERT INTO fund_capital_calls(id,uid,fund_id,call_number,amount_cents,due_date,line_count,issued_by) VALUES (1,'synthetic-call',1,7,60000,'2026-11-01',2,${SUPER});
    INSERT INTO capital_calls(id,limited_partner_id,amount,amount_cents,status,due_date,fund_call_id) VALUES (100,10,400,40000,'pending','2026-11-01',1),(101,11,200,20000,'pending','2026-11-01',1);`);
  let models = 0;
  const env = envFor(db, { AI: { run() { models++; throw new Error('unexpected model'); } } });
  return { db, env, get models() { return models; }, async read(prompt: string, options: { user?: number; fund?: string | null; support?: boolean; branch?: boolean } = {}) {
    const token = await tokenFor(options.user ?? ADMIN, { impersonated: options.support });
    const query = new URLSearchParams({ prompt });
    if (options.fund !== null) query.set('fund', options.fund ?? '1');
    const response = await app.request('/api/fund-admin/ask?' + query, { headers: { Authorization: 'Bearer ' + token } }, options.branch ? { ...env, BRANCH_CODE: 'fr' } : env).catch(error => { if (error instanceof Response) return error; throw error; });
    return { status: response.status, body: await response.json() as any };
  } };
}

test('five Fund Admin prompts read recorded figures/dates and navigate without a financial write or model', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1794657600000 });
  const f = fixture(); const fetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('unexpected external read'); };
  try {
    const before = f.db.prepare('SELECT * FROM capital_calls ORDER BY id').all();
    const outstanding = await f.read('explain:fund-outstanding');
    assert.equal(outstanding.status, 200, JSON.stringify(outstanding.body));
    assert.deepEqual(outstanding.body.lines, ['Synthetic Fund: committed $1,500.00, called $600.00, received $0.00, outstanding $600.00.']);
    const overdue = await f.read('identify:fund-overdue-lps');
    assert.deepEqual(overdue.body.lines, [
      'Synthetic Fund · Call 7 · due 2026-11-01: LP Alpha · $400.00 outstanding.',
      'Synthetic Fund · Call 7 · due 2026-11-01: LP Beta · $200.00 outstanding.',
    ]);
    assert.deepEqual(overdue.body.navigation, { to: '/admin/fund-admin/calls?fund=1', label: 'Open the 2 lines' });
    const matches = await f.read('summarize:fund-reconciliation');
    assert.equal(matches.status, 200);
    assert.deepEqual(matches.body.lines, ['Synthetic Fund: 0 proposed matches; 0 need review.']);
    const prepare = await f.read('prepare:fund-capital-call');
    assert.equal(prepare.status, 200);
    assert.deepEqual(prepare.body.navigation, { to: '/admin/fund-admin/calls?fund=1&new=1', label: 'Open New capital call preview' });
    assert.match(prepare.body.lines[0], /amount and due date are — Not recorded/);
    const setup = await f.read('identify:fund-incomplete-setup');
    assert.equal(setup.status, 200);
    assert.equal(setup.body.state, 'not_recorded');
    assert.equal(setup.body.lines[0], 'Synthetic Fund: GP of record, LPA document — Not recorded.');
    assert.match(setup.body.lines[1], /2026-11-01/);
    assert.deepEqual(setup.body.navigation, { to: '/admin/fund-admin/funds/1', label: 'Open fund setup' });
    for (const result of [outstanding, overdue, matches, prepare, setup]) {
      assert.equal(result.body.no_model, true);
      assert.equal(result.body.as_of, TODAY);
      assert.equal(result.body.note, 'Eadwyn prepares, explains and navigates. It never issues, records or moves money.');
      assert.ok(!JSON.stringify(result.body).includes('Outside Fund'));
    }
    assert.deepEqual(f.db.prepare('SELECT * FROM capital_calls ORDER BY id').all(), before);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM fund_capital_calls').get()!.n, 1);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM capital_call_receipts').get()!.n, 0);
    assert.equal(f.models, 0);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action='mercury_accounts_read'").get()!.n, 5);
  } finally { globalThis.fetch = fetch; f.db.close(); }
});

test('Fund Admin answers distinguish zero, no record, source failure and a truncated ledger', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1794657600000 });
  const f = fixture();
  try {
    f.db.exec('DELETE FROM capital_calls');
    const none = await f.read('identify:fund-overdue-lps');
    assert.equal(none.status, 200);
    assert.deepEqual(none.body.lines, ['Synthetic Fund: no overdue LP line as of 2026-11-14.']);
    assert.match((await f.read('explain:fund-outstanding')).body.lines[0], /outstanding \$0\.00/);
    const user = f.db.prepare('SELECT * FROM users WHERE id=?').get(ADMIN) as any;
    const facts = { overview: await fundAdminOverview(f.env, user, TODAY), ledgers: { 1: { ...await readFundCalls(f.env, 1, TODAY), truncated: true } }, funds: {} };
    for (const prompt of ['explain:fund-outstanding', 'identify:fund-overdue-lps'] as const) {
      const result = fundAdminAnswer(facts, prompt, 1, { acts: [] });
      assert.equal(result!.state, 'unreadable');
      assert.match(result!.lines.join(' '), /Unreadable · Retry/);
      assert.ok(!result!.lines.join(' ').includes('$0.00'));
    }
    f.db.exec('DROP TABLE mercury_matches');
    assert.equal((await f.read('summarize:fund-reconciliation')).status, 503);
    assert.equal((await f.read('explain:fund-outstanding')).status, 200, 'an independent failure does not blank the answer');
    f.db.exec('DROP TABLE capital_calls');
    const failed = await f.read('explain:fund-outstanding');
    assert.equal(failed.status, 503);
    assert.equal(failed.body.state, 'unreadable');
    assert.match(failed.body.lines[0], /not a zero/);
    f.db.exec('DELETE FROM vc_funds WHERE id=1');
    const missing = await f.read('identify:fund-overdue-lps', { fund: null });
    assert.equal(missing.status, 200);
    assert.equal(missing.body.state, 'not_recorded');
    assert.match(missing.body.lines[0], /No administered fund is recorded/);
    assert.equal(f.models, 0);
  } finally { f.db.close(); }
});

test('Fund Admin prompt reads refuse outsiders, support/branch sessions, guessed scope and failed audit before figures', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1794657600000 });
  const f = fixture();
  try {
    const anonymous = await app.request('/api/fund-admin/ask?prompt=explain:fund-outstanding', {}, f.env).catch(error => { if (error instanceof Response) return error; throw error; });
    assert.equal(anonymous.status, 401);
    for (const user of [FOUNDER, PARTNER, INVESTOR, ADVISOR, EXPLORING]) assert.equal((await f.read('explain:fund-outstanding', { user })).status, 403);
    assert.equal((await f.read('explain:fund-outstanding', { support: true })).status, 403);
    assert.equal((await f.read('explain:fund-outstanding', { user: SUPER, branch: true })).status, 403);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM admin_audit_log').get()!.n, 0);
    assert.equal((await f.read('identify:fund-incomplete-setup', { fund: '2' })).status, 404);
    for (const fund of ['0', '-1', '1x', '9007199254740992']) assert.equal((await f.read('explain:fund-outstanding', { fund })).status, 400);
    for (const prompt of ['', 'toString', 'issue:capital-call']) assert.equal((await f.read(prompt)).status, 400);
    const user = f.db.prepare('SELECT * FROM users WHERE id=?').get(ADMIN) as any;
    const facts = { overview: await fundAdminOverview(f.env, user, TODAY), ledgers: {}, funds: {} };
    const denied = fundAdminAnswer(facts, 'prepare:fund-capital-call', 1, { acts: [{ act: 'capital_call.preview', allowed: false, sentence: 'Preview is unavailable.' }] });
    assert.equal(denied!.lines[0], 'Preview is unavailable.');
    assert.equal(denied!.navigation.to, '/admin/fund-admin/calls?fund=1');
    assert.equal((await f.read('prepare:fund-capital-call', { user: SUPER })).status, 200);
    f.db.exec("CREATE TRIGGER no_read_audit BEFORE INSERT ON admin_audit_log BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END;");
    const unaudited = await f.read('explain:fund-outstanding');
    assert.equal(unaudited.status, 503);
    assert.equal(unaudited.body.state, 'unreadable');
    assert.ok(!JSON.stringify(unaudited.body).includes('$600'));
    assert.deepEqual(Object.values(FUND_ADMIN_PROMPTS), ['Explain outstanding capital','Identify overdue LPs','Summarize reconciliation exceptions','Prepare a capital call','Identify incomplete fund setup']);
  } finally { f.db.close(); }
});
