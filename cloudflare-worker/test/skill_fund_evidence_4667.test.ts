/**
 * D4667-p4 (#4667): one explicitly selected fund's recorded performance for a quarter, through the real
 * `fund.performance` reader on the real migrated schema, into the skill evidence boundary that gates
 * `lp-quarterly-letter-draft`. Synthetic funds, positions, marks, calls and distributions only; the model is a stub
 * and nothing is charged for real.
 *
 *   · the reader: no selection answers the funds the sponsor runs here and no figures; one selected fund answers the
 *     last whole quarter before `to`, D627's figures as of its end (point in time), each position's latest mark on or
 *     before it, and the calls issued and distributions paid in it, each with a stable reference and its date;
 *   · tenancy: only the GP of record, under the agent's company, on the institutional tier; another GP's fund and
 *     another company's fund are `not_found`; an admin, a professional-tier investor and an agent with no company
 *     are `withheld`;
 *   · the evidence boundary: complete is ready; an unmarked position, an uncomputable figure (unknown, never zero) or
 *     a cut record is conditional and named; a mark from before the quarter is stale; nothing recorded is empty;
 *     none selected and not found are not ready;
 *   · the manual run carries the figures it judged; one with no fund selected is refused before any charge;
 *   · the matrix: the need reads `fund.performance`, and a scheduled session cannot select a fund.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/skill_fund_evidence_4667.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { removeMigratedDatabases } from './_storage_schema.ts';
import { ADMIN, COMPANY, SPONSOR, STRANGER } from './_agent_engine_fixture.ts';
import { FUND, NO_COMPANY, OTHER_COMPANY, OTHER_GP, SCOPE, SLUG, count, ctx, fundInput, fundWorld, letter, manual, modelCalls, read } from './_skill_fund_fixture.ts';
import { READ_KEYS } from '../src/services/agents/catalogue.ts';
import { ReadPageError, quarterBefore, readOne, selectedFund } from '../src/services/agents/reads.ts';
import { FIRST_TEN, inputMatrix, pathsFor } from '../src/services/agents/skillInputs.ts';
import { fundOfRecord } from '../src/services/agents/skillEvidence.ts';
import { readFundPerformance } from '../src/services/fundPerformance.ts';

after(removeMigratedDatabases);

// ── The reader ──────────────────────────────────────────────────────────────

test('the quarter a read covers is the last whole one ending on or before `to`', () => {
  // Mutation checked: a date on a quarter end read as the quarter before → the 2026-09-30 case fails.
  assert.deepEqual(quarterBefore('2026-11-19'), { quarter: '2026-Q3', from: '2026-07-01', to: '2026-09-30' });
  assert.deepEqual(quarterBefore('2026-09-30'), { quarter: '2026-Q3', from: '2026-07-01', to: '2026-09-30' });
  assert.deepEqual(quarterBefore('2026-01-05'), { quarter: '2025-Q4', from: '2025-10-01', to: '2025-12-31' });
  assert.deepEqual(quarterBefore('2026-03-31'), { quarter: '2026-Q1', from: '2026-01-01', to: '2026-03-31' });
  assert.deepEqual([selectedFund('vc_fund:5'), selectedFund('5'), selectedFund('vc_fund:0'), selectedFund('fund:5'), selectedFund(5)], [5, 5, null, null, null]);
  assert.deepEqual([fundOfRecord('vc_fund:5'), fundOfRecord('5'), fundOfRecord('data_room_file:5')], ['vc_fund:5', null, null]);
});

test('fund.performance with no fund selected lists the funds the sponsor runs under this company, and no figures', async () => {
  const f = fundWorld();
  try {
    const r = await read(f.w);
    assert.deepEqual([r.fund_status, r.fund], ['not_selected', null]);
    // fundGpScope: the GP of record, under this company or none; never another GP's, never another company's.
    // Mutation checked: the company arm dropped from the scope → fund 9 is listed and counted.
    assert.deepEqual(r.funds.map((x: any) => x.ref), [`vc_fund:${FUND}`, `vc_fund:${NO_COMPANY}`]);
    assert.deepEqual(r.coverage, { returned: 2, total: 2, omitted: 0, complete: true });
    assert.ok(!JSON.stringify(r).includes('420000000') && !('performance' in r), 'an index carries no figures');
  } finally { f.w.close(); }
});

test('one selected fund: the quarter\'s figures as of its end, each mark with its valuation date, the quarter\'s calls and paid distributions, each referenced', async () => {
  const f = fundWorld();
  try {
    const r = await read(f.w, `vc_fund:${FUND}`);
    assert.equal(r.fund_status, 'read');
    assert.deepEqual(r.fund, { ref: `vc_fund:${FUND}`, name: 'Synthetic Fund I', vintage_year: 2025, status: 'investing' });
    assert.deepEqual(r.period, { quarter: '2026-Q3', from: '2026-07-01', to: '2026-09-30' });
    assert.equal(r.currency, null, 'no currency is recorded on a fund, so none is assumed');
    // The same formula fund performance and the benchmark offer read (D627), point in time at the quarter end (D1158).
    const want = await readFundPerformance(f.w.env, { id: FUND, name: 'Synthetic Fund I', vintage_year: 2025, status: 'investing' }, '2026-09-30', { pointInTime: true });
    assert.deepEqual([r.performance.nav, r.performance.paid_in, r.performance.distributed, r.performance.tvpi, r.performance.dpi, r.performance.irr],
      [want.nav_cents, want.paid_in_cents, want.distributed_cents, want.tvpi, want.dpi, want.irr]);
    // Mutation checked: read as of today, not the quarter end → the October call and mark are counted.
    assert.deepEqual([r.performance.nav, r.performance.paid_in, r.performance.distributed], [600_000_000, 550_100_050, 5_000_000]);
    assert.equal(r.performance.as_of, '2026-09-30');
    // Mutation checked: the mark taken as the latest of all (not on or before the quarter end) → the October mark is reported.
    assert.deepEqual(r.marks.map((m: any) => [m.ref, m.company, m.mark?.ref, m.mark?.value, m.mark?.valuation_date, m.mark?.unit]), [
      ['portfolio_position:pos-kestrel', 'Kestrel', 'fund_position_valuation:mark-kestrel-q3', 420_000_000, '2026-09-30', 'cents'],
      ['portfolio_position:pos-tidepool', 'Tidepool Health', 'fund_position_valuation:mark-tidepool-q3', 180_000_000, '2026-09-30', 'cents'],
    ]);
    // Mutation checked: the period's lower bound dropped → the 2025 call is listed as this quarter's.
    assert.deepEqual(r.capital_calls.map((c: any) => [c.ref, c.amount, c.at]), [
      ['capital_call:legacy-line-1', 100_050, '2026-07-10'],
      ['fund_capital_call:call-2026-2', 250_000_000, '2026-08-15'],
    ]);
    // Mutation checked: `status = 'paid'` dropped → the pending distribution is listed.
    assert.deepEqual(r.distributions.map((d: any) => [d.ref, d.amount, d.at]), [['fund_distribution:31', 5_000_000, '2026-09-01']]);
    for (const k of ['marks_coverage', 'capital_calls_coverage', 'distributions_coverage']) assert.equal(r[k].complete, true, k);
    assert.deepEqual(r.capital_calls_coverage, { returned: 2, total: 2, omitted: 0, complete: true });
    // An earlier `to` reads an earlier quarter; a bad selection is refused, never widened.
    assert.equal((await read(f.w, `vc_fund:${FUND}`, SCOPE, '2026-07-15')).period.quarter, '2026-Q2');
    await assert.rejects(() => readOne(f.w.env, 'fund.performance', ctx(f.w, 'fund-five')), (e: any) => e instanceof ReadPageError && e.code === 'invalid_page');
  } finally { f.w.close(); }
});

test('tenancy: the GP of record under this company only; another GP\'s or company\'s fund is not found; an admin, a lower tier or no company is withheld', async () => {
  const f = fundWorld();
  try {
    // Mutation checked: the scope clause dropped from the selected read → another GP's fund is read.
    assert.equal((await read(f.w, `vc_fund:${OTHER_GP}`)).fund_status, 'not_found');
    assert.equal((await read(f.w, `vc_fund:${OTHER_COMPANY}`)).fund_status, 'not_found');
    assert.equal((await read(f.w, 'vc_fund:404')).fund_status, 'not_found', 'the same answer as a fund that does not exist');
    assert.equal((await read(f.w, `vc_fund:${NO_COMPANY}`)).fund_status, 'read', 'a fund with no company is its GP\'s under every company');
    const loose = await read(f.w, `vc_fund:${FUND}`, { ...SCOPE, company_id: null });
    assert.equal(loose.withheld, true, 'an agent with no company reads no fund');
    // A company agent of the fund's company reads it the same way.
    const company = { kind: 'company', id: COMPANY, uid: 'co-1', name: 'Acme' } as any;
    assert.equal((await read(f.w, `vc_fund:${FUND}`, company)).fund_status, 'read');
    // Mutation checked: the tier check dropped → a professional-tier investor's agent reads the fund.
    f.w.db.prepare("UPDATE users SET investor_tier = 'professional' WHERE id = ?").run(SPONSOR);
    const lower = await read(f.w, `vc_fund:${FUND}`);
    assert.equal(lower.withheld, true);
    assert.ok(!JSON.stringify(lower).includes('Synthetic Fund'), 'none of the fund is carried');
  } finally { f.w.close(); }
  for (const who of [ADMIN, STRANGER]) {
    const g = fundWorld({ sponsor: who });
    try {
      const r = await read(g.w, `vc_fund:${FUND}`);
      // Mutation checked: the admin arm dropped → fundGpScope is unscoped for an admin and the fund is read.
      assert.equal(r.withheld ? 'withheld' : r.fund_status, who === ADMIN ? 'withheld' : 'not_found', `sponsor ${who}`);
    } finally { g.w.close(); }
  }
});

// ── The evidence boundary ───────────────────────────────────────────────────

test('preflight: a fund read whole is ready; none selected and not found are not ready', async () => {
  const f = fundWorld();
  try {
    const complete = await letter(f.w, `vc_fund:${FUND}`);
    assert.deepEqual([complete.state, fundInput(complete).status, complete.limits], ['ready', 'available', []]);
    const none = await letter(f.w, null);
    assert.deepEqual([none.state, fundInput(none).status, fundInput(none).reason], ['not_ready', 'missing', 'not_selected']);
    const other = await letter(f.w, `vc_fund:${OTHER_GP}`);
    assert.deepEqual([other.state, fundInput(other).status, fundInput(other).reason], ['not_ready', 'missing', 'not_found']);
    f.w.db.prepare("UPDATE users SET investor_tier = 'professional' WHERE id = ?").run(SPONSOR);
    assert.deepEqual([(await letter(f.w, `vc_fund:${FUND}`)).state, fundInput(await letter(f.w, `vc_fund:${FUND}`)).status], ['not_ready', 'withheld']);
  } finally { f.w.close(); }
});

test('preflight: an unmarked position, an uncomputable figure and a cut record are partial; an old mark is stale; nothing recorded is empty', async () => {
  const f = fundWorld();
  try {
    // A position held by the quarter end with no mark on or before it: "Not recorded", never its cost.
    f.w.db.exec("INSERT INTO portfolio_positions (id, uid, fund_id, project_id, round_name, invested_amount, position_date) VALUES (23, 'pos-unmarked', 5, 8, 'Seed', 5000000, '2026-08-01')");
    const r = await read(f.w, `vc_fund:${FUND}`);
    const unmarked = r.marks.find((m: any) => m.ref === 'portfolio_position:pos-unmarked');
    assert.equal(unmarked.mark, null);
    // D627: one position without a mark leaves the fund's NAV unknown, so NAV, RVPI and TVPI are null with their reasons, never 0.
    assert.equal(r.performance.nav, null);
    assert.ok('nav_cents' in r.performance.unavailable);
    const p = await letter(f.w, `vc_fund:${FUND}`);
    assert.deepEqual([p.state, fundInput(p).status], ['conditional', 'partial']);
    // Mutation checked: unmarked positions not counted → the limit no longer names the position.
    assert.match(p.limits[0], /1 position\(s\) have no mark on or before 2026-09-30: Tidepool Health/);
    assert.match(p.limits[0], /not recorded at the source: nav_cents, rvpi, tvpi, irr/);
    f.w.db.exec('DELETE FROM portfolio_positions WHERE id = 23');
    // Tidepool's only mark dated before the quarter: the figures compute, the mark is stale.
    f.w.db.exec("UPDATE fund_position_valuations SET valuation_date = '2026-06-30' WHERE uid = 'mark-tidepool-q3'");
    const s = await letter(f.w, `vc_fund:${FUND}`);
    // Mutation checked: `before_period` not set → the input reads available and the skill ready.
    assert.deepEqual([s.state, fundInput(s).status], ['conditional', 'stale']);
    assert.match(s.limits[0], /1 mark\(s\) are dated before the quarter began \(2026-07-01\): Tidepool Health 2026-06-30/);
    f.w.db.exec("UPDATE fund_position_valuations SET valuation_date = '2026-09-30' WHERE uid = 'mark-tidepool-q3'");
    // Many positions: the read is cut to whole rows for length, and says so.
    for (let i = 0; i < 60; i++) {
      f.w.db.prepare("INSERT INTO portfolio_positions (uid, fund_id, project_id, round_name, invested_amount, position_date) VALUES (?, 5, 8, 'Seed', 1, '2025-06-01')").run(`pos-many-${i}`);
      f.w.db.prepare("INSERT INTO fund_position_valuations (uid, position_id, valuation_date, value_cents, source, recorded_by) VALUES (?, last_insert_rowid(), '2026-09-30', 1, 'Synthetic', ?)").run(`mark-many-${i}`, SPONSOR);
    }
    const cut = await readOne(f.w.env, 'fund.performance', ctx(f.w, `vc_fund:${FUND}`));
    assert.equal(cut.truncated, true);
    assert.ok((cut.data as any).omitted_for_size.marks > 0, 'the rows left out are counted');
    const c = await letter(f.w, `vc_fund:${FUND}`);
    assert.deepEqual([c.state, fundInput(c).status], ['conditional', 'partial']);
    assert.match(c.limits[0], /part of the record was left out for length/);
  } finally { f.w.close(); }
  const g = fundWorld();
  try {
    // A fund with no position, call or distribution by the quarter end has nothing to write a letter from.
    const e = await letter(g.w, `vc_fund:${NO_COMPANY}`);
    assert.deepEqual([e.state, fundInput(e).status], ['not_ready', 'empty']);
    // Without the paid distribution, distributions are unknown (D627), not zero: DPI and TVPI are named, and partial.
    g.w.db.exec('DELETE FROM fund_distributions');
    const r = await read(g.w, `vc_fund:${FUND}`);
    assert.deepEqual([r.performance.distributed, r.performance.dpi, r.performance.tvpi], [null, null, null]);
    assert.deepEqual(r.distributions_coverage, { returned: 0, total: 0, omitted: 0, complete: true }, 'an empty, complete quarter of distributions');
    const p = await letter(g.w, `vc_fund:${FUND}`);
    assert.deepEqual([p.state, fundInput(p).status], ['conditional', 'partial']);
    assert.match(p.limits[0], /not recorded at the source: distributed_cents, dpi, tvpi, irr/);
  } finally { g.w.close(); }
});

test('manual: a run on a selected fund carries the figures it judged; one with no fund is refused before any charge', async () => {
  const f = fundWorld();
  try {
    const none: any = await manual(f.w);
    assert.deepEqual([none.ok, none.status, none.code], [false, 422, 'skill_not_ready'], JSON.stringify(none));
    assert.deepEqual(none.extra.inputs, [{ field: 'recorded fund performance with periods and valuation dates', read: 'fund.performance', status: 'missing', reason: 'not_selected' }]);
    // Mutation checked: the fund-specific words dropped → the refusal speaks of a document.
    assert.match(none.message, /no fund is selected for the run/);
    const other: any = await manual(f.w, { record: `vc_fund:${OTHER_GP}` });
    assert.match(other.message, /not one the sponsor runs under this company/);
    assert.equal(modelCalls(f.calls), 0);
    assert.equal(count(f.w, 'SELECT COUNT(*) AS n FROM ai_usage_logs'), 0);
    // Mutation checked: the record not passed as `fund` → the run is refused not_selected.
    const r: any = await manual(f.w, { record: `vc_fund:${FUND}` });
    assert.equal(r.ok, true, JSON.stringify(r));
    const turn = f.prompts.join('\n');
    assert.match(turn, /source=\\"read:fund\.performance\\" trust=\\"data\\"/);
    assert.ok(turn.includes('fund_position_valuation:mark-kestrel-q3') && turn.includes('fund_capital_call:call-2026-2'), 'the records the check read are the ones the run carries');
    assert.ok(!turn.includes('mark-kestrel-q4'), 'never a mark from after the quarter');
  } finally { f.w.close(); }
});

// ── The matrix ──────────────────────────────────────────────────────────────

test('the LP letter\'s need reads fund.performance, a grantable key, and runs only where a run selects its fund', () => {
  const need = FIRST_TEN.find((s) => s.slug === SLUG)!.needs[0];
  // Mutation checked: the need left on `raise.records` → the reader is `built_other_shape` and this fails.
  assert.deepEqual([need.read, need.expects, need.required], ['fund.performance', 'typed_record', true]);
  assert.ok((READ_KEYS as readonly string[]).includes('fund.performance'), 'a rule book may grant it');
  assert.equal(inputMatrix().find((s) => s.slug === SLUG)!.inputs[0].reader, 'built');
  // A session's target kinds have no fund, so neither the task context nor a schedule can select one.
  // Mutation checked: `MANUAL_SELECTION_ONLY` emptied → the scheduled path is claimed supported.
  assert.deepEqual(pathsFor(SLUG), { default_context: 'unsupported', scheduled: 'unsupported', manual: 'approved_tool_reads_not_exercised_here', selected_record: 'supported' });
  assert.deepEqual(pathsFor('board-meeting-brief')!.scheduled, 'supported', 'a skill that selects nothing is unchanged');
});
