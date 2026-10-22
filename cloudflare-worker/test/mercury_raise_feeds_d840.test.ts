/**
 * D840 part 2 (#2347) — the founder's own Mercury feeds their Raise modules,
 * against part 1's fake MCP server (#2346). Real SQL on node:sqlite, real JWT
 * routes; nothing reaches the network.
 *
 *  1. The rules: full months, the runway from the cashflow summary, spend by
 *     category, the section a category suggests, what looks like investment,
 *     the prospect a credit settles, revenue credits and their growth.
 *  2. A sync calls only allowlisted read tools, writes the facts with their
 *     ledger rows, and writes every judgement as a pending proposal: no
 *     prospect, file, cap-table entry or mapping exists until Accept.
 *  3. Each row of the table lands on Accept, with its ledger row: a mapping
 *     (the proposed section or the founder's), a statement (NDA, seen by
 *     nobody), a SAFE (an Investors · SAFE entry), a credit (a match to a
 *     prospect, or a new investor at Committed).
 *  4. A re-sync: a deleted fact stays deleted, a dismissed or accepted
 *     proposal is never proposed again, a landed row deleted in its module
 *     reads as deleted, and a pending one is refreshed.
 *  5. Only the founder sees it: an admin who may read the module gets no
 *     `parts.mercury`; another founder, an admin and another company's
 *     context are refused the routes; one connection's proposal is not
 *     another's.
 *  6. No Mercury figure reaches a log row or the console.
 *
 * Each case names the mutations it was checked against.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/mercury_raise_feeds_d840.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import raise from '../src/routes/cycle_raise.ts';
import { MERCURY_READ_TOOLS } from '../src/services/mercury/mcp.ts';
import {
  MIN_INVESTMENT_CENTS, STATEMENT_ACCESS, fullMonths, looksLikeInvestment, matchProspect, revenueByMonth, revenueGrowth, runwayFact, spendByCategory, suggestSection, type RaiseLine,
} from '../src/services/mercury/raiseFeeds.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { FAKE_PDF, fakeTx } from './_mercury_mcp_fake.mjs';
import {
  TODAY, tx, LINES, CASHFLOW, mercury, fixture, call, sync, mod, accept, dismiss, proposal, withFake,
} from './_mercury_raise_fixture.ts';

// ───────────────────────────────────────────── 1. the rules

const line = (o: Partial<RaiseLine>): RaiseLine => ({
  id: 'x', amount_cents: 0, posted_on: '2026-09-01', kind: 'externalTransfer', counterparty: null, category: null, last_four: '4242',
  posted: true, internal: false, voided: false, ...o,
});

test('1. the rules: full months, runway, spend, sections, investment, matching and revenue', () => {
  // Mutations checked: the current month counted as full; the runway averaged over 2 months or with a missing
  // month; a credit counted as spend; an internal move counted; the $10,000 floor dropped; a card credit taken as a
  // wire; a passed prospect matched; a short name matched inside a word; growth over a zero month.
  assert.deepEqual(fullMonths(TODAY, 3), { from: '2026-07-01', to: '2026-09-30', list: ['2026-07', '2026-08', '2026-09'] });
  assert.equal(fullMonths('2026-01-15', 1).from, '2025-12-01');

  const months = CASHFLOW.months.map((m) => ({ month: m.month, incoming_cents: m.incomingCents, outgoing_cents: m.outgoingCents, cashflow_cents: m.cashflowCents }));
  const r = runwayFact(610000, months, TODAY);
  assert.deepEqual([r.burn_cents, r.months, r.label], [100000, 6.1, 'Runway: 6.1 months at the last 3 months’ burn']);
  assert.equal(runwayFact(610000, months.slice(1), TODAY).months, null, 'a missing month is Not recorded, never a guess');
  assert.match(runwayFact(610000, months.slice(1), TODAY).label, /Not recorded/);
  assert.match(runwayFact(null, months, TODAY).label, /no cash balance/);
  assert.match(runwayFact(1, months.map((m) => ({ ...m, cashflow_cents: 5 })), TODAY).label, /no net burn/);

  const spend = spendByCategory([
    line({ amount_cents: -500, category: 'Software', posted_on: '2026-09-03' }),
    line({ amount_cents: -100, category: null, posted_on: '2026-08-03' }),
    line({ amount_cents: 900, category: 'Software', posted_on: '2026-09-04' }),
    line({ amount_cents: -700, category: 'Software', internal: true }),
    line({ amount_cents: -800, category: 'Software', posted_on: '2026-10-02' }),
    line({ amount_cents: -1200, category: 'Advertising', posted_on: '2026-05-10' }),
  ], TODAY);
  assert.deepEqual(spend.filter((s) => s.months === 3), [{ months: 3, category: 'Software', cents: 500 }, { months: 3, category: 'Uncategorized', cents: 100 }]);
  assert.deepEqual(spend.filter((s) => s.months === 6).map((s) => s.category), ['Advertising', 'Software', 'Uncategorized']);

  assert.equal(suggestSection('Software'), 'infrastructure');
  assert.equal(suggestSection('Advertising'), 'go-to-market');
  assert.equal(suggestSection('Payroll'), 'product');
  assert.equal(suggestSection('Legal'), 'operations');
  assert.equal(suggestSection('Gardening'), null, 'no guess where the name suggests nothing');

  assert.equal(looksLikeInvestment(line({ amount_cents: MIN_INVESTMENT_CENTS, kind: 'incomingDomesticWire' })), true);
  assert.equal(looksLikeInvestment(line({ amount_cents: MIN_INVESTMENT_CENTS - 1, kind: 'incomingDomesticWire' })), false);
  assert.equal(looksLikeInvestment(line({ amount_cents: MIN_INVESTMENT_CENTS, kind: 'creditCardCredit' })), false);
  assert.equal(looksLikeInvestment(line({ amount_cents: MIN_INVESTMENT_CENTS, kind: 'incomingDomesticWire', posted: false })), false);

  const ps = [
    { id: 1, name: 'Harbour Angels', firm: null, amount: 10, stage: 'meeting' },
    { id: 2, name: 'Harbour Angels', firm: null, amount: 50000, stage: 'diligence' },
    { id: 3, name: 'Gone Capital', firm: null, amount: null, stage: 'passed' },
    { id: 4, name: 'Al', firm: null, amount: null, stage: 'meeting' },
  ];
  assert.equal(matchProspect('HARBOUR ANGELS, LLC', 5_000_000, ps)?.id, 2, 'the one at the credit’s amount');
  assert.equal(matchProspect('Harbour Angels', 1, ps)?.id, 1, 'else the first');
  assert.equal(matchProspect('Gone Capital', 1, ps), null, 'a passed prospect is never matched');
  assert.equal(matchProspect('Alpha Ventures', 1, ps), null, 'a short name is not matched inside a word');
  assert.equal(matchProspect(null, 1, ps), null);

  const rev = revenueByMonth([
    line({ id: 'a', amount_cents: 2000, posted_on: '2026-08-12' }), line({ id: 'b', amount_cents: 3000, posted_on: '2026-09-12' }),
    line({ id: 'c', amount_cents: 99999, posted_on: '2026-09-20' }), line({ id: 'd', amount_cents: 700, posted_on: '2026-09-21', internal: true }),
    line({ id: 'e', amount_cents: 800, posted_on: '2026-09-22', counterparty: 'Axal VC Management, LLC' }),
  ], TODAY, new Set(['c']));
  assert.deepEqual(rev.slice(-2), [{ month: '2026-08', cents: 2000 }, { month: '2026-09', cents: 3000 }]);
  assert.equal(rev.length, 6);
  assert.equal(revenueGrowth(rev), 50);
  assert.equal(revenueGrowth([{ cents: 0 }, { cents: 10 }]), null);
});

// ───────────────────────────────────────────── 2. a sync writes facts and proposes judgement

test('2. a sync calls only read tools, writes facts with their ledger rows, and writes no judgement', async () => {
  // Mutations checked: a write tool on the allowlist; a fact without its ledger row; a proposal landed by the sync
  // (a prospect, a file, a cap-table entry or a mapping written); an imported-as-revenue credit proposed.
  const f = await fixture();
  const r = await withFake(f, () => sync(f.env));
  assert.equal(r.status, 200, r.text);
  for (const t of f.fake.toolCalls()) assert.ok(MERCURY_READ_TOOLS.includes(t), t);
  assert.ok(f.fake.toolCalls().includes('getCashflowSummary') && f.fake.toolCalls().includes('getSafeRequests'));

  const runway = f.one(`SELECT * FROM mercury_raise_facts WHERE fact_key = 'runway'`);
  assert.deepEqual([runway.amount_cents, runway.burn_cents, runway.value], [610000, 100000, 6.1]);
  assert.equal(f.one(`SELECT amount_cents FROM mercury_raise_facts WHERE fact_key = 'spend:3:Software'`).amount_cents, 50000);
  assert.equal(f.one(`SELECT amount_cents FROM mercury_raise_facts WHERE fact_key = 'spend:6:Advertising'`).amount_cents, 120000);
  assert.equal(f.one(`SELECT amount_cents FROM mercury_raise_facts WHERE fact_key = 'revenue:2026-09'`).amount_cents, 300000, 'investment and internal moves are not revenue');
  assert.equal(f.one(`SELECT value FROM mercury_raise_facts WHERE fact_key = 'revenue:growth'`).value, 50);
  const facts = f.one('SELECT COUNT(*) AS n FROM mercury_raise_facts').n;
  const ledger = f.all(`SELECT module, kind, local_table, local_id FROM connector_fed_items WHERE integration_id = 41`);
  const revenue = f.one(`SELECT COUNT(*) AS n FROM mercury_raise_facts WHERE kind = 'revenue'`).n;
  assert.equal(ledger.length, facts + revenue, 'one ledger row per fact, and the deck’s own for each revenue fact');
  assert.ok(ledger.every((l) => l.local_table === 'mercury_raise_facts' && l.local_id != null));
  assert.deepEqual([...new Set(ledger.map((l) => l.module))].sort(), ['fundraising_readiness', 'investor_narrative', 'pitch_deck', 'use_of_funds']);
  assert.equal(ledger.filter((l) => l.module === 'pitch_deck').length, revenue);

  const kinds = f.all(`SELECT kind, source_key, target, status FROM mercury_raise_proposals ORDER BY kind, source_key`);
  assert.ok(kinds.every((k) => k.status === 'pending'));
  assert.deepEqual(kinds.filter((k) => k.kind === 'investor_credit').map((k) => [k.source_key, k.target]),
    [[fakeTx(6), 'prospect:501'], [fakeTx(7), 'new']], 'a wire to a prospect proposes the match; the other a new investor; the revenue one none');
  assert.deepEqual(kinds.filter((k) => k.kind === 'fund_mapping').map((k) => [k.source_key, k.target]),
    [['Advertising', 'go-to-market'], ['Gardening', null], ['Software', 'infrastructure']]);
  // The fake lists the same two statements for each account; a statement is proposed once by its id.
  assert.deepEqual(kinds.filter((k) => k.kind === 'statement').map((k) => k.source_key), ['stmt-2026-08', 'stmt-2026-09']);
  assert.equal(kinds.filter((k) => k.kind === 'safe').length, 1);

  // Nothing judged reached a module.
  assert.equal(f.one('SELECT COUNT(*) AS n FROM raise_prospects WHERE project_id = 101').n, 1);
  assert.equal(f.one(`SELECT stage FROM raise_prospects WHERE id = 501`).stage, 'diligence');
  assert.equal(f.one('SELECT COUNT(*) AS n FROM mercury_personal_matches').n, 0);
  assert.equal(f.one('SELECT COUNT(*) AS n FROM data_room_files').n, 0);
  assert.equal(f.one('SELECT COUNT(*) AS n FROM cap_table_scenarios').n, 0);
  assert.equal(f.all(`SELECT * FROM connector_fed_items WHERE local_table != 'mercury_raise_facts'`).length, 0);
});

// ───────────────────────────────────────────── 3. each row lands on Accept

test('3. Accept lands each row in its module, with its ledger row; Dismiss writes nothing', async () => {
  // Mutations checked: Accept without the claim (twice lands twice); the founder's section ignored; an invalid section
  // accepted; a statement stored open or invited; a SAFE written without its amount and cap; a match written without
  // committing the prospect; a new investor at another stage; the ledger row skipped.
  const f = await fixture();
  await withFake(f, () => sync(f.env));

  // Use of funds: the founder's section wins; an unknown one is refused and nothing is decided.
  const gardening = proposal(f, 'fund_mapping', 'Gardening');
  assert.equal((await accept(f.env, gardening.id)).status, 400, 'no section proposed and none chosen');
  assert.equal(proposal(f, 'fund_mapping', 'Gardening').status, 'pending', 'the claim is handed back');
  assert.equal((await accept(f.env, gardening.id, { section: 'yachts' })).status, 400);
  assert.equal((await accept(f.env, gardening.id, { section: 'operations' })).status, 200);
  assert.equal(proposal(f, 'fund_mapping', 'Gardening').target, 'operations');
  assert.equal((await accept(f.env, gardening.id, { section: 'operations' })).status, 409, 'decided once');
  // Software was proposed under Infrastructure; the founder counts it under Product.
  const software = proposal(f, 'fund_mapping', 'Software');
  assert.equal(software.target, 'infrastructure');
  assert.equal((await accept(f.env, software.id, { section: 'product' })).status, 200);
  const funds = (await mod(f.env, 'use-of-funds')).parts.mercury;
  assert.equal(funds.sections.find((s: any) => s.key === 'product').actual_cents[3], 50000, 'actuals beside the plan, through the accepted mapping');
  assert.equal(funds.sections.find((s: any) => s.key === 'infrastructure').actual_cents[3], 0);

  // Data room: a statement Mercury gives no bytes for writes nothing and stays pending.
  const stmt = proposal(f, 'statement', 'stmt-2026-08');
  const noPdf = await withFake(f, () => accept(f.env, stmt.id));
  assert.equal(noPdf.status, 404, 'no bytes, nothing written');
  assert.equal(proposal(f, 'statement', 'stmt-2026-08').status, 'pending');
  assert.equal(f.one('SELECT COUNT(*) AS n FROM data_room_files').n, 0);

  // Cap table: an Investors · SAFE entry at the SAFE's amount and cap. With no founder on the table, it is refused and handed back.
  const safe = f.one(`SELECT id FROM mercury_raise_proposals WHERE kind = 'safe'`);
  assert.equal((await accept(f.env, safe.id)).status, 400);
  assert.equal(f.one('SELECT status FROM mercury_raise_proposals WHERE id = ?', safe.id).status, 'pending');
  const founder = await call(f.env, '/api/cycles/raise/holders?project=101', 1, 'POST', { name: 'One', group: 'founders', instrument: 'common', shares: 1000000 });
  assert.equal(founder.status, 201, founder.text);
  const s = await accept(f.env, safe.id);
  assert.equal(s.status, 200, s.text);
  const inputs = JSON.parse(f.one('SELECT inputs_json FROM cap_table_scenarios WHERE project_id = 101').inputs_json);
  assert.deepEqual(inputs.safes.map((e: any) => [e.name, e.amount, e.cap]), [['Angel Fixture', 25000, 5000000]]);
  assert.equal(f.one(`SELECT local_table FROM connector_fed_items WHERE kind = 'safe'`).local_table, 'cap_table_scenarios');

  // Capital relationships: the match commits the prospect and records the receipt; the new investor is added at Committed.
  const match = proposal(f, 'investor_credit', fakeTx(6));
  assert.equal((await accept(f.env, match.id)).status, 200);
  assert.deepEqual({ ...f.one('SELECT stage, amount, commit_status FROM raise_prospects WHERE id = 501') }, { stage: 'committed', amount: 50000, commit_status: 'wired' });
  assert.equal(f.one(`SELECT state FROM mercury_personal_matches WHERE mercury_transaction_id = ?`, fakeTx(6)).state, 'confirmed');
  const fresh = proposal(f, 'investor_credit', fakeTx(7));
  assert.equal((await accept(f.env, fresh.id)).status, 200);
  const added = f.one(`SELECT id, name, stage, amount FROM raise_prospects WHERE project_id = 101 AND id != 501`);
  assert.deepEqual([added.name, added.stage, added.amount], ['New Fund LP', 'committed', 25000]);
  assert.equal(f.one(`SELECT local_id FROM connector_fed_items WHERE kind = 'investor_credit' AND external_id LIKE ?`, `%${fakeTx(7)}`).local_id, added.id);

  // Dismiss writes nothing and is once.
  const ad = proposal(f, 'fund_mapping', 'Advertising');
  assert.equal((await dismiss(f.env, ad.id)).status, 200);
  assert.equal((await dismiss(f.env, ad.id)).status, 409);
  assert.equal(f.one(`SELECT COUNT(*) AS n FROM connector_fed_items WHERE kind = 'fund_mapping'`).n, 2);
});

test('3b. an accepted statement is stored in the data room, NDA and seen by nobody, through part 1\'s statementPdf', async () => {
  // Mutations checked: the file stored open or `invited`; the bytes not stored; the checklist item dropped; the
  // statement's account not carried on its proposal (no read can find it).
  const f = await fixture();
  await withFake(f, () => sync(f.env));
  const stmt = proposal(f, 'statement', 'stmt-2026-09');
  assert.match(JSON.parse(stmt.payload_json).account_id, /^[0-9a-f-]{36}$/);
  const out = await withFake(f, () => accept(f.env, stmt.id));
  assert.equal(out.status, 200, out.text);
  assert.ok(f.fake.calls.some((c: any) => c.statement), 'the bytes were read from Mercury');
  const file = f.one('SELECT * FROM data_room_files');
  assert.deepEqual([file.visibility, file.access_tier, file.checklist_item, file.content_type], [STATEMENT_ACCESS.visibility, 'nobody', 'financial_statements', 'application/pdf']);
  assert.ok(file.r2_key.startsWith('data-room/p-101/'));
  assert.deepEqual([...f.env.FILES.objects.get(file.r2_key).bytes], [...FAKE_PDF]);
  assert.equal(f.one(`SELECT local_id FROM connector_fed_items WHERE kind = 'statement'`).local_id, file.id);
  const room = (await mod(f.env, 'data-room')).parts.mercury;
  assert.deepEqual(room.proposals.map((p: any) => p.month), ['2026-08'], 'the accepted one is no longer proposed');
  assert.ok(!('account_id' in room.proposals[0]), 'an account id is not shown');
  // Deleted from the data room, it is not brought back by a re-sync.
  f.db.prepare('DELETE FROM data_room_files WHERE id = ?').run(file.id);
  await withFake(f, () => sync(f.env));
  assert.equal(f.one('SELECT COUNT(*) AS n FROM data_room_files').n, 0);
  assert.equal(proposal(f, 'statement', 'stmt-2026-09').status, 'accepted');
  assert.equal(f.one(`SELECT local_id FROM connector_fed_items WHERE kind = 'statement'`).local_id, null);
});

// ───────────────────────────────────────────── 4. a re-sync

test('4. a re-sync keeps a deleted fact deleted, never re-proposes a decided proposal, and refreshes a pending one', async () => {
  // Mutations checked: the deleted-fact check dropped (the runway comes back); the PROPOSE upsert updating decided rows;
  // the unlink of a landed row deleted elsewhere dropped; a pending proposal left stale.
  const f = await fixture();
  await withFake(f, () => sync(f.env));
  const runway = f.one(`SELECT id FROM mercury_raise_facts WHERE fact_key = 'runway'`);
  assert.equal((await call(f.env, `/api/cycles/raise/mercury/facts/${runway.id}?project=101`, 1, 'DELETE')).status, 200);
  // A revenue fact is the narrative's and the deck's: deleting it unlinks both at once.
  const sept = f.one(`SELECT id FROM mercury_raise_facts WHERE fact_key = 'revenue:2026-09'`);
  assert.equal((await call(f.env, `/api/cycles/raise/mercury/facts/${sept.id}?project=101`, 1, 'DELETE')).status, 200);
  assert.deepEqual(f.all(`SELECT module, local_id FROM connector_fed_items WHERE external_id IN ('raise:101:revenue:2026-09', 'raise:101:deck:revenue:2026-09') ORDER BY module`),
    [{ module: 'investor_narrative', local_id: null }, { module: 'pitch_deck', local_id: null }]);
  assert.equal((await call(f.env, `/api/cycles/raise/mercury/facts/${sept.id}?project=101`, 2, 'DELETE')).status, 403, 'another founder deletes nothing here');
  const fresh = proposal(f, 'investor_credit', fakeTx(7));
  await accept(f.env, fresh.id);
  const added = f.one(`SELECT id FROM raise_prospects WHERE project_id = 101 AND id != 501`).id;
  f.db.prepare('DELETE FROM raise_prospects WHERE id = ?').run(added);
  const ad = proposal(f, 'fund_mapping', 'Advertising');
  await dismiss(f.env, ad.id);
  f.fake.state.data.transactions = [...LINES, tx(10, -50000, '2026-09-28', { kind: 'debitCardTransaction', mercuryCategory: 'Advertising' })];
  f.db.prepare(`UPDATE raise_prospects SET name = 'Harbour Angels' WHERE id = 501`).run();

  assert.equal((await withFake(f, () => sync(f.env))).status, 200);
  assert.equal(f.one(`SELECT COUNT(*) AS n FROM mercury_raise_facts WHERE fact_key = 'runway'`).n, 0, 'the deleted runway stays deleted');
  assert.equal(f.one(`SELECT COUNT(*) AS n FROM mercury_raise_facts WHERE fact_key = 'revenue:2026-09'`).n, 0, 'and the deleted month');
  assert.equal(f.one(`SELECT local_id FROM connector_fed_items WHERE external_id = 'raise:101:runway'`).local_id, null);
  assert.equal(proposal(f, 'fund_mapping', 'Advertising').status, 'dismissed', 'never proposed again');
  assert.equal(proposal(f, 'investor_credit', fakeTx(7)).status, 'accepted');
  assert.equal(f.one('SELECT COUNT(*) AS n FROM raise_prospects WHERE project_id = 101').n, 1, 'the investor deleted here is not brought back');
  assert.equal(f.one(`SELECT local_id FROM connector_fed_items WHERE external_id LIKE ?`, `%${fakeTx(7)}`).local_id, null, 'and reads as deleted');
  assert.equal(f.one(`SELECT amount_cents FROM mercury_raise_facts WHERE fact_key = 'spend:3:Advertising'`).amount_cents, 5000000, 'a fact is updated');
  const gardening = proposal(f, 'fund_mapping', 'Gardening');
  assert.equal(gardening.status, 'pending');
});

// ───────────────────────────────────────────── 5. only the founder, only their company

test('5. only the founder sees Mercury, in their own company, from their own connection', async () => {
  // Mutations checked: the founder check widened to canWrite (the admin reads it); the company check dropped; the
  // integration_id dropped from a proposal's lookup (another founder decides it); the part shown without a connection.
  const f = await fixture();
  await withFake(f, () => sync(f.env));
  const own = await mod(f.env, 'fundraising-readiness');
  assert.equal(own.parts.mercury.runway.label, 'Runway: 6.1 months at the last 3 months’ burn');
  assert.match(own.parts.mercury.runway.source, /^From Mercury, as of 2026-/);
  // The measured runway replaces one the founder recorded, and says which; Mercury's own snapshot is not one.
  assert.equal(own.parts.mercury.runway.replaces, null);
  f.db.prepare(`INSERT INTO project_metrics (project_id, snapshot_date, cash_balance, net_burn, source) VALUES (101, '2026-10-01', 1, 1, 'mercury')`).run();
  assert.equal((await mod(f.env, 'fundraising-readiness')).parts.mercury.runway.replaces, null);
  f.db.prepare(`INSERT INTO project_metrics (project_id, snapshot_date, cash_balance, net_burn, source) VALUES (101, '2026-08-01', 1, 1, NULL)`).run();
  assert.equal((await mod(f.env, 'fundraising-readiness')).parts.mercury.runway.replaces, 'Replaces the runway you recorded in the metrics snapshot of 2026-08-01');

  const admin = await call(f.env, '/api/cycles/raise/modules/fundraising-readiness?project=101', 30);
  assert.equal(admin.status, 200, 'the admin may read the module');
  assert.equal(admin.body.parts?.mercury, undefined, 'but never the founder’s Mercury');
  assert.doesNotMatch(admin.text, /610000|6\.1|Runway: /);
  assert.equal((await sync(f.env, 30)).status, 403);
  const elsewhere = await call(f.env, '/api/cycles/raise/modules/fundraising-readiness?project=101', 1, 'GET', undefined, '99');
  assert.equal(elsewhere.body.parts?.mercury, undefined, 'another company in context');
  assert.equal((await call(f.env, '/api/cycles/raise/mercury/sync?project=101', 1, 'POST', undefined, '99')).status, 403);

  // Another founder: no route on this project; their own connection holds no proposal of this one.
  assert.equal((await call(f.env, '/api/cycles/raise/mercury/sync?project=101', 2, 'POST')).status, 403);
  const p = proposal(f, 'investor_credit', fakeTx(7));
  assert.equal((await call(f.env, `/api/cycles/raise/mercury/proposals/${p.id}/accept?project=202`, 2, 'POST')).status, 404);
  assert.equal(proposal(f, 'investor_credit', fakeTx(7)).status, 'pending');

  // A sign-in holding more than read access is not read.
  const wide = await encryptCredentials(f.env, 'mc-one', { access_token: f.accessToken, token_type: 'Bearer', expires_at: null, scopes: ['read', 'write'], issuer: 'https://mcp.mercury.com', client_key: 'fixture-client' });
  const held = f.one('SELECT credentials_enc FROM integrations WHERE id = 41').credentials_enc;
  f.db.prepare('UPDATE integrations SET credentials_enc = ? WHERE id = 41').run(wide);
  const before = f.fake.toolCalls().length;
  const refused = await withFake(f, () => sync(f.env));
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error, 'write_scope_refused');
  assert.equal(f.fake.toolCalls().length, before, 'no tool was called');
  f.db.prepare('UPDATE integrations SET credentials_enc = ? WHERE id = 41').run(held);
  // A pasted token reaches no Raise feed.
  f.db.prepare(`UPDATE integrations SET auth_type = 'api_key' WHERE id = 41`).run();
  assert.equal((await withFake(f, () => sync(f.env))).body.error, 'mercury_sign_in_required');
  f.db.prepare(`UPDATE integrations SET auth_type = 'oauth_mcp' WHERE id = 41`).run();

  // No connection, no part.
  f.db.prepare(`UPDATE integrations SET status = 'revoked' WHERE id = 41`).run();
  // D882 (#2555): a connection no longer active reads "Connect Mercury", with no figure from it.
  const gone = (await mod(f.env, 'use-of-funds')).parts?.mercury;
  assert.equal(gone.state, 'not_connected');
  assert.equal(gone.connection.connect_href, '/account/connectors/mercury');
  assert.deepEqual(Object.keys(gone).sort(), ['connection', 'reason', 'state']);

  const figures = await (async () => { f.db.prepare(`UPDATE integrations SET status = 'active' WHERE id = 41`).run(); return (await mod(f.env, 'pitch-deck')).parts.mercury.figures; })();
  assert.deepEqual(figures.map((x: any) => x.key), ['revenue_last_month', 'revenue_growth', 'net_burn', 'runway']);
  assert.ok(figures.every((x: any) => /^From Mercury, as of /.test(x.source)));
});

// ───────────────────────────────────────────── 6. no figure in a log

test('6. a sync logs counts only: no amount, name or date reaches a log row or the console', async () => {
  // Mutations checked: the log summary given the payload; the console given an amount.
  const f = await fixture();
  const lines: string[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  for (const k of ['log', 'warn', 'error'] as const) (console as any)[k] = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
  try {
    await withFake(f, () => sync(f.env));
    f.fake.state.status = 500;
    assert.equal((await withFake(f, () => sync(f.env))).status, 502, 'Mercury unreadable');
    f.fake.state.status = null;
    // A store that fails mid-sync is a plain failure, with a code and no figure.
    f.db.exec('ALTER TABLE raise_prospects RENAME TO raise_prospects_gone');
    assert.equal((await withFake(f, () => sync(f.env))).status, 502);
  } finally { Object.assign(console, orig); }
  const logs = f.all('SELECT response_summary FROM integration_logs').map((r) => r.response_summary).join('\n');
  assert.match(logs, /runway=1/);
  for (const secret of ['6100', '500', '50000', 'Harbour', 'Software', '2026-09', 'Angel']) {
    assert.ok(!logs.includes(secret), `log row has ${secret}`);
    assert.ok(!lines.join('\n').includes(secret), `console has ${secret}`);
  }
});
