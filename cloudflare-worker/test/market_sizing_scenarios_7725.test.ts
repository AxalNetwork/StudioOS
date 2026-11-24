/**
 * D7725 (#7725) — labelled inputs, low/base/high scenarios, sensitivity, overrides with a reason, a
 * top-down check and superseded evidence, on real SQLite: the baseline plus every migration above
 * the cutoff (202611191932 and 202611232031 among them), `routes/market_sizing.ts` and
 * `routes/projects.ts` mounted on a bare Hono. Everyone and every figure here is synthetic.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/market_sizing_scenarios_7725.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { JWT_SECRET, token } from './_esign_harness.ts';
import projects from '../src/routes/projects.ts';
import marketSizing from '../src/routes/market_sizing.ts';
import { SCENARIO_REFUSALS, SIZING_LIMITATION, sensitivity, supersededSizingEvidence } from '../src/services/marketSizing.ts';

const FOUNDER = 1, OTHER = 3;
const ROLE: Record<number, string> = { [FOUNDER]: 'founder', [OTHER]: 'founder' };
/** BASE below gives TAM 741,600,000; SAM 103,824,000; SOM 1,360,800 (set by capacity), as in market_sizing_7704.test.ts. */
const BASE_7704 = {
  population: '41,200 firms', acv: '$18,000 / year', samPct: '14', winRate: '8',
  capacity: '4', horizonMonths: '24', salesCycleMonths: '3', retentionPct: '90', targetYear: '2027',
};
const TAM = 741_600_000, SAM = 103_824_000, SOM = 1_360_800;

const assume = (value: string, extra: Record<string, unknown> = {}) => ({ value, source: { kind: 'assumption', note: 'Founder estimate from twelve sales calls.' }, ...extra });
const Y = { reference_year: '2027' };
/** A complete, labelled input set; `over` replaces whole inputs. */
const inputs = (over: Record<string, unknown> = {}) => ({
  population: assume('41,200', Y),
  acv: { value: '18,000', currency: 'USD', ...Y, source: { kind: 'market_source', market_source_id: 7 } },
  samPct: assume('14'), winRate: assume('8'), capacity: assume('4', Y), horizonMonths: assume('24'),
  salesCycleMonths: assume('3'), retentionPct: assume('90'),
  ...over,
});
const labelled = (scenarios: Record<string, unknown> = { base: { inputs: inputs() } }, over: Record<string, unknown> = {}) => ({
  assumptions: { targetYear: '2027', geography: 'Europe' }, revenue_basis: 'annual', scenarios, ...over,
});
const THREE = () => ({
  low: { inputs: inputs({ capacity: assume('1', Y), retentionPct: assume('89'), samPct: assume('13') }) },
  base: { inputs: inputs() },
  high: { inputs: inputs({ capacity: assume('20', Y), retentionPct: assume('91'), samPct: assume('15') }) },
});

function fixture() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  db.exec(`INSERT INTO users(id,role,name,email,founder_id,is_active,subscription_tier) VALUES
      (1,'founder','Fay Founder','founder@example.com',11,1,'studio'),(3,'founder','Bo Other','other@example.com',33,1,'studio');
    INSERT INTO projects(id,uid,name,founder_id) VALUES (1,'synthetic-one','Synthetic venture',11),(2,'synthetic-two','Other venture',33);
    INSERT INTO market_sources(id,project_id,title,url,kind,added_by) VALUES
      (7,1,'Synthetic industry report 2026','https://example.com/report','Report',1),
      (8,2,'Another venture''s report','https://example.com/theirs','Report',3);
    INSERT INTO project_market_assumptions(id,project_id) VALUES (50,1);
    INSERT INTO fill_provenance(id,target_table,target_row_id,target_column,fill_class,proposed_value,written_value,edited,citation_json,task)
      VALUES (60,'project_market_assumptions',50,'acv','sourced','Annual contract value: $18,000 / year','Annual contract value: $18,000 / year',0,
        '{"kind":"research","task":"market_sizing_inputs","query":"Synthetic ACV benchmark 2027","source":"https://example.com/benchmark","quote":"Median ACV is $18,000."}',
        'market_sizing_inputs');
    INSERT INTO research_market_observations(id,source_id,metric_key,metric_label,geography_type,geography_code,period,value,unit,
        observation_status,retrieved_at,source_observation_key,vintage,currency,scale)
      VALUES (500,'world-bank','enterprises','Enterprises','country','FRA','2027',41.2,'enterprises','estimate','2026-11-01T00:00:00Z','syn:FRA:2027','v1',NULL,'thousands');`);
  const real = d1Over(db);
  const forced = { at: -1, sizes: [] as number[] };
  const DB = {
    ...real,
    async batch(stmts: any[]) {
      forced.sizes.push(stmts.length);
      const list = forced.at < 0 ? stmts : stmts.map((s, i) => (i === forced.at ? { runSync() { throw new Error('forced failure'); } } : s));
      return real.batch(list);
    },
  };
  const env: any = { DB, JWT_SECRET, ENVIRONMENT: 'development' };
  const app = new Hono<any>().route('/api/projects', projects).route('/api/market-sizing', marketSizing);
  app.onError((e: any, c: any) => (e instanceof Response ? e : c.json({ error: String(e?.message || '') }, e?.message === 'Unauthorized' ? 401 : 500)));
  const call = async (who: number, method: string, path: string, body?: unknown) => {
    const r = await app.request(path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token(who, ROLE[who])}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    return { status: r.status, body: await r.json().catch(() => null) as any };
  };
  const save = (body: unknown, who = FOUNDER, pid = 1) => call(who, 'POST', `/api/market-sizing/projects/${pid}/versions`, body);
  const read = (uid: string, pid = 1) => call(FOUNDER, 'GET', `/api/market-sizing/projects/${pid}/versions/${uid}`);
  const snapshot = () => JSON.stringify({
    projects: db.prepare('SELECT id, tam, sam, som FROM projects ORDER BY id').all(),
    figures: db.prepare('SELECT * FROM market_figures ORDER BY id').all(),
    versions: db.prepare('SELECT * FROM market_sizing_versions ORDER BY id').all(),
    inputs: db.prepare('SELECT * FROM market_sizing_version_inputs ORDER BY id').all(),
    scenarios: db.prepare('SELECT * FROM market_sizing_scenarios ORDER BY id').all(),
    estimates: db.prepare('SELECT * FROM market_sizing_input_estimates ORDER BY id').all(),
    assumptions: db.prepare('SELECT * FROM project_market_assumptions ORDER BY id').all(),
  });
  return { db, env, call, save, read, snapshot, forced };
}

const one = (db: DatabaseSync, sql: string, ...a: any[]) => db.prepare(sql).get(...a) as any;
const figs = (x: any) => [x.tam, x.sam, x.som];

test('three scenarios save together, each recomputes from its own stored inputs, and only base writes the project\'s figures', async () => {
  const { db, save, read } = fixture(); try {
    const r = await save(labelled(THREE()));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual(figs(r.body.scenarios.base), [TAM, SAM, SOM]);
    assert.deepEqual(figs(r.body.scenarios.low), [TAM, 96_408_000, 336_420]);
    assert.deepEqual(figs(r.body.scenarios.high), [TAM, 111_240_000, 6_879_600]);
    // Only base reaches the project and its figure rows.
    assert.deepEqual({ ...one(db, 'SELECT tam, sam, som FROM projects WHERE id = 1') }, { tam: TAM, sam: SAM, som: SOM });
    assert.deepEqual(db.prepare('SELECT figure, value FROM market_figures ORDER BY id').all().map((x: any) => x.value), [TAM, SAM, SOM]);
    const rows = db.prepare('SELECT scenario, tam, sam, som FROM market_sizing_scenarios ORDER BY scenario').all().map((x: any) => ({ ...x }));
    assert.deepEqual(rows, [{ scenario: 'high', tam: TAM, sam: 111_240_000, som: 6_879_600 }, { scenario: 'low', tam: TAM, sam: 96_408_000, som: 336_420 }]);
    assert.equal(one(db, 'SELECT COUNT(*) AS n FROM market_sizing_input_estimates').n, 24, 'eight inputs in each of three scenarios');
    const v = (await read(r.body.version.uid)).body.version;
    for (const s of ['low', 'base', 'high']) assert.equal(v.scenarios[s].recomputes, true, s);
    assert.deepEqual([v.scenarios.base.writes_project, v.scenarios.low.writes_project, v.scenarios.high.writes_project], [true, false, false]);
    // A low row that disagrees with its own inputs no longer recomputes (each scenario is checked against its own rows).
    db.exec('DROP TRIGGER market_sizing_input_estimates_append_only');
    db.exec("UPDATE market_sizing_input_estimates SET value = 2 WHERE scenario = 'low' AND input_key = 'capacity'");
    const again = (await read(r.body.version.uid)).body.version;
    assert.deepEqual([again.scenarios.low.recomputes, again.scenarios.base.recomputes, again.scenarios.high.recomputes], [false, true, true]);
  } finally { db.close(); }
});

test('a forced failure of any statement in a three-scenario save leaves no row anywhere', async () => {
  const { db, save, snapshot, forced } = fixture(); try {
    assert.equal((await save(labelled(THREE()))).status, 201);
    const size = forced.sizes.at(-1) as number;
    assert.ok(size >= 24 + 2 + 8, `one batch holds every write (got ${size})`);
    const before = snapshot();
    for (let i = 0; i < size; i += 1) {
      forced.at = i;
      const r = await save(labelled(THREE()));
      assert.equal(r.status, 500, `statement ${i}`);
      assert.equal(r.body.error, 'sizing_not_saved');
      assert.equal(snapshot(), before, `statement ${i} failing left a partial write`);
    }
  } finally { db.close(); }
});

test('a low result above base or a high one below it is saved with a flag, not refused', async () => {
  const { db, save } = fixture(); try {
    const r = await save(labelled({ ...THREE(), low: { inputs: inputs({ capacity: assume('10', Y) }) } }));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual(r.body.order_flags.map((f: any) => [f.scenario, f.figure]), [['low', 'som']]);
    assert.deepEqual(r.body.version.order_flags.map((f: any) => [f.scenario, f.figure]), [['low', 'som']]);
  } finally { db.close(); }
});

test('a labelled save with an unlabelled input is refused and writes nothing; a base-only save in #7704\'s shape reads its inputs as not labelled', async () => {
  const { db, save, read, snapshot } = fixture(); try {
    const before = snapshot();
    const bare = await save(labelled({ base: { inputs: inputs({ winRate: { value: '8' } }) } }));
    assert.deepEqual([bare.status, bare.body.error, bare.body.field, bare.body.scenario], [400, 'missing_input_source', 'winRate', 'base']);
    assert.equal(bare.body.message, SCENARIO_REFUSALS.missing_input_source);
    const inLow = await save(labelled({ ...THREE(), low: { inputs: inputs({ samPct: { value: '13' } }) } }));
    assert.deepEqual([inLow.body.error, inLow.body.scenario], ['missing_input_source', 'low']);
    const noNote = await save(labelled({ base: { inputs: inputs({ winRate: { value: '8', source: { kind: 'assumption' } } }) } }));
    assert.equal(noNote.body.error, 'missing_assumption_note');
    // A top-down check is the labelled shape too, so #7704's inputs beside it are refused.
    const topOnly = await save({ assumptions: BASE_7704, top_down: assume('800', { currency: 'USD', ...Y }) });
    assert.equal(topOnly.body.error, 'inputs_sent_twice');
    // Low and high are entered in full, never filled from base.
    const partial = await save(labelled({ ...THREE(), high: { inputs: { capacity: assume('20', Y) } } }));
    assert.deepEqual([partial.body.error, partial.body.scenario], ['missing_population', 'high']);
    const lowOnly = await save(labelled({ base: { inputs: inputs() }, low: { inputs: inputs() } }));
    assert.equal(lowOnly.body.error, 'invalid_scenarios');
    assert.equal(snapshot(), before, 'a refused labelled save wrote');

    const old = await save({ assumptions: BASE_7704 });
    assert.equal(old.status, 201, JSON.stringify(old.body));
    const v = (await read(old.body.version.uid)).body.version;
    assert.equal(v.inputs.length, 8);
    assert.ok(v.inputs.every((i: any) => i.source_kind === 'not_labelled'), JSON.stringify(v.inputs.map((i: any) => i.source_kind)));
    assert.ok(!v.inputs.some((i: any) => i.source_kind === 'assumption'));
    assert.equal(v.unlabelled_inputs, 8);
    assert.equal(v.revenue_basis, null);
  } finally { db.close(); }
});

test('a market source is copied from the venture\'s own row; another venture\'s is refused', async () => {
  const { db, save, snapshot } = fixture(); try {
    const r = await save(labelled());
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const acv = one(db, "SELECT source_kind, source_title, source_url, market_source_id FROM market_sizing_input_estimates WHERE input_key = 'acv'");
    assert.deepEqual({ ...acv }, { source_kind: 'market_source', source_title: 'Synthetic industry report 2026', source_url: 'https://example.com/report', market_source_id: 7 });
    // The D7704 input row carries the same copy.
    const base = one(db, "SELECT label, source_title, market_source_id FROM market_sizing_version_inputs WHERE input_key = 'acv'");
    assert.deepEqual({ ...base }, { label: 'entered', source_title: 'Synthetic industry report 2026', market_source_id: 7 });
    const before = snapshot();
    const theirs = await save(labelled({ base: { inputs: inputs({ acv: { value: '18,000', currency: 'USD', ...Y, source: { kind: 'market_source', market_source_id: 8 } } }) } }));
    assert.deepEqual([theirs.status, theirs.body.error, theirs.body.field], [400, 'invalid_input_market_source', 'acv']);
    assert.equal(snapshot(), before);
  } finally { db.close(); }
});

test('an input tied to an observation reads the same value, period and vintage after a newer row arrives, and is flagged superseded', async () => {
  const { db, env, call, save, read } = fixture(); try {
    const pop = { source: { kind: 'observation', observation_id: 500 } };
    const sent = await save(labelled({ base: { inputs: inputs({ population: { ...pop, value: '41,200' } }) } }));
    assert.equal(sent.body.error, 'value_comes_from_source', 'the value of an observation input is copied, never sent');
    const r = await save(labelled({ base: { inputs: inputs({ population: pop }) } }));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual(figs(r.body.version), [TAM, SAM, SOM], '41.2 thousands is 41,200');
    const first = (await read(r.body.version.uid)).body.version;
    const est = first.scenarios.base.estimates.find((e: any) => e.input_key === 'population');
    assert.deepEqual([est.value, est.evidence.value, est.evidence.period, est.evidence.vintage, est.source_name, est.superseded],
      [41_200, 41.2, '2027', 'v1', 'World Bank Open Data', false]);
    assert.equal(est.observation_id, 500);

    db.exec(`INSERT INTO research_market_observations(id,source_id,metric_key,metric_label,geography_type,geography_code,period,value,unit,
        observation_status,retrieved_at,source_observation_key,vintage,scale,supersedes_observation_id)
      VALUES (501,'world-bank','enterprises','Enterprises','country','FRA','2027',52.0,'enterprises','estimate','2026-11-20T00:00:00Z','syn:FRA:2027','v2','thousands',500)`);
    const later = (await read(r.body.version.uid)).body.version;
    const est2 = later.scenarios.base.estimates.find((e: any) => e.input_key === 'population');
    assert.deepEqual([est2.value, est2.evidence.value, est2.evidence.period, est2.evidence.vintage], [41_200, 41.2, '2027', 'v1']);
    assert.deepEqual(figs(later), [TAM, SAM, SOM], 'the saved figures do not move');
    assert.equal(later.recomputes, true);
    assert.equal(est2.superseded, true);
    assert.deepEqual([est2.superseded_by[0].newest_observation_id, est2.superseded_by[0].newest_vintage], [501, 'v2']);
    const listed = await call(FOUNDER, 'GET', '/api/market-sizing/projects/1/superseded');
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body.superseded.map((x: any) => [x.version_uid, x.input_key, x.observation_id, x.newest_vintage]),
      [[r.body.version.uid, 'population', 500, 'v2']]);
    // The exported read for #7726, across every venture.
    assert.equal((await supersededSizingEvidence(env, null)).length, 1);
    assert.equal(one(db, "SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'idx_market_sizing_estimates_observation'").n, 1);
  } finally { db.close(); }
});

test('an input accepted from an Eadwyn fill reads the citation held for it', async () => {
  const { db, save, read, snapshot } = fixture(); try {
    const fill = { currency: 'USD', ...Y, source: { kind: 'eadwyn_fill' } };
    const r = await save(labelled({ base: { inputs: inputs({ acv: fill }) } }));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const est = (await read(r.body.version.uid)).body.version.scenarios.base.estimates.find((e: any) => e.input_key === 'acv');
    assert.deepEqual([est.source_kind, est.value, est.fill_provenance_id], ['eadwyn_fill', 18_000, 60]);
    assert.deepEqual(est.evidence.citation, { kind: 'research', task: 'market_sizing_inputs', query: 'Synthetic ACV benchmark 2027',
      source: 'https://example.com/benchmark', quote: 'Median ACV is $18,000.' });
    const before = snapshot();
    assert.equal((await save(labelled({ base: { inputs: inputs({ samPct: { source: { kind: 'eadwyn_fill' } } }) } }))).body.error, 'no_eadwyn_fill');
    assert.equal((await save(labelled({ base: { inputs: inputs({ acv: { ...fill, value: '99' } }) } }))).body.error, 'value_comes_from_source');
    // An undone fill is no longer an accepted one.
    db.exec("UPDATE fill_provenance SET undone_at = '2026-11-23' WHERE id = 60");
    assert.equal((await save(labelled({ base: { inputs: inputs({ acv: fill }) } }))).body.error, 'no_eadwyn_fill');
    assert.equal(snapshot(), before);
  } finally { db.close(); }
});

test('another currency needs a labelled conversion and another year an adjustment or a reason; both values are stored', async () => {
  const { db, save, snapshot } = fixture(); try {
    const before = snapshot();
    const eur = { value: '18,000', currency: 'EUR', ...Y, source: { kind: 'market_source', market_source_id: 7 } };
    const noRate = await save(labelled({ base: { inputs: inputs({ acv: eur }) } }));
    assert.deepEqual([noRate.status, noRate.body.error, noRate.body.field], [400, 'missing_currency_conversion', 'acv']);
    const noCurrency = await save(labelled({ base: { inputs: inputs({ acv: { ...eur, currency: undefined } }) } }));
    assert.equal(noCurrency.body.error, 'missing_input_currency');
    const unlabelledRate = await save(labelled({ base: { inputs: inputs({ acv: { ...eur, conversion: { rate: { value: '1.1' }, rate_date: '2026-11-20' } } }) } }));
    assert.equal(unlabelledRate.body.error, 'missing_input_source', 'the rate is itself a labelled input');
    const oldYear = await save(labelled({ base: { inputs: inputs({ population: assume('41,200', { reference_year: '2025' }) }) } }));
    assert.deepEqual([oldYear.body.error, oldYear.body.field], ['missing_year_adjustment', 'population']);
    const noReason = await save(labelled({ base: { inputs: inputs({ population: assume('41,200', { reference_year: '2025', adjustment: { unadjusted: true } }) }) } }));
    assert.equal(noReason.body.error, 'missing_year_adjustment');
    const noYear = await save(labelled({ base: { inputs: inputs({ population: assume('41,200') }) } }));
    assert.equal(noYear.body.error, 'missing_input_reference_year');
    assert.equal(snapshot(), before);

    const ok = await save(labelled({ base: { inputs: inputs({
      acv: { ...eur, conversion: { rate: assume('1.1'), rate_date: '2026-11-20' } },
      population: assume('41,200', { reference_year: '2025', adjustment: { unadjusted: true, reason: 'Firm counts move little in two years.' } }),
      capacity: assume('4', { reference_year: '2026', adjustment: { factor: assume('1') } }),
    }) } }));
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    const acv = one(db, "SELECT value, original_value, currency, conversion_json FROM market_sizing_input_estimates WHERE input_key = 'acv'");
    assert.equal(acv.original_value, 18_000);
    assert.ok(Math.abs(acv.value - 19_800) < 1e-6);
    assert.equal(acv.currency, 'EUR');
    assert.deepEqual([JSON.parse(acv.conversion_json).rate, JSON.parse(acv.conversion_json).source.source_kind], [1.1, 'assumption']);
    assert.equal(ok.body.version.tam, Math.round(41_200 * 18_000 * 1.1));
    const pop = one(db, "SELECT reference_year, adjustment_json FROM market_sizing_input_estimates WHERE input_key = 'population'");
    assert.deepEqual([pop.reference_year, JSON.parse(pop.adjustment_json).unadjusted, JSON.parse(pop.adjustment_json).reason],
      [2025, true, 'Firm counts move little in two years.']);
  } finally { db.close(); }
});

test('whether revenue is annual or cumulative is stored, returned and read by the formula', async () => {
  const { db, call, save, read, snapshot } = fixture(); try {
    const before = snapshot();
    const { revenue_basis: _drop, ...noBasis } = labelled();
    assert.equal((await save(noBasis)).body.error, 'missing_revenue_basis');
    assert.equal((await save(labelled(undefined, { revenue_basis: 'monthly' }))).body.error, 'invalid_revenue_basis');
    assert.equal(snapshot(), before);
    // $36,000 over a 24-month horizon is $18,000 a year: the same figures as annual $18,000.
    const r = await save(labelled({ base: { inputs: inputs({ acv: { value: '36,000', currency: 'USD', ...Y, source: { kind: 'market_source', market_source_id: 7 } } }) } },
      { revenue_basis: 'cumulative' }));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual(figs(r.body.version), [TAM, SAM, SOM]);
    assert.equal(one(db, 'SELECT revenue_basis FROM market_sizing_versions').revenue_basis, 'cumulative');
    const v = (await read(r.body.version.uid)).body.version;
    assert.deepEqual([v.revenue_basis, v.recomputes], ['cumulative', true]);
    assert.match(v.formula[0], /over the time horizon \(\$36,000\) × 12 ÷ 24 months = \$18,000/);
    const annual = await save(labelled());
    assert.equal(annual.body.version.revenue_basis, 'annual');
    const list = await call(FOUNDER, 'GET', '/api/market-sizing/projects/1/versions');
    assert.deepEqual(list.body.versions.map((x: any) => x.revenue_basis), ['annual', 'cumulative']);
  } finally { db.close(); }
});

test('sensitivity ranks a planted dominant input first, and says not available on a base-only version', async () => {
  const { db, call, save } = fixture(); try {
    const three = await save(labelled(THREE()));
    const s = await call(FOUNDER, 'GET', `/api/market-sizing/projects/1/versions/${three.body.version.uid}/sensitivity`);
    assert.equal(s.status, 200);
    assert.equal(s.body.sensitivity.available, true);
    const ranked = s.body.sensitivity.ranked;
    assert.equal(ranked[0].input_key, 'capacity', JSON.stringify(ranked));
    assert.deepEqual([ranked[0].som_at_low, ranked[0].som_at_high, ranked[0].effect], [340_200, 6_804_000, 6_463_800]);
    assert.equal(ranked[1].input_key, 'retentionPct');
    assert.ok(ranked[0].effect > ranked[1].effect && ranked[1].effect >= ranked[2].effect);
    assert.equal(ranked.find((x: any) => x.input_key === 'population').effect, 0);
    const baseOnly = await save(labelled());
    const none = await call(FOUNDER, 'GET', `/api/market-sizing/projects/1/versions/${baseOnly.body.version.uid}/sensitivity`);
    assert.equal(none.body.sensitivity.available, false);
    assert.match(none.body.sensitivity.reason, /base scenario only/);
    assert.ok(!('ranked' in none.body.sensitivity), 'not available is never a list of zeros');
    // The pure form agrees.
    assert.equal(sensitivity({ base: { inputs: [], tamOverrideReason: null } }, { targetYear: '2027', revenueBasis: 'annual' }).available, false);
  } finally { db.close(); }
});

test('an override without a reason is refused; with one the version returns both values and the project\'s figure is the override, typed', async () => {
  const { db, save, read, snapshot } = fixture(); try {
    const before = snapshot();
    const over = { tamOverride: assume('500', { currency: 'USD', ...Y }) };
    const bare = await save(labelled({ base: { inputs: inputs(over) } }));
    assert.deepEqual([bare.status, bare.body.error, bare.body.scenario], [400, 'missing_tam_override_reason', 'base']);
    assert.equal(snapshot(), before);
    const r = await save(labelled({ base: { inputs: inputs(over), tam_override_reason: 'Analyst consensus' } }));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const v = (await read(r.body.version.uid)).body.version;
    assert.deepEqual([v.tam_override, v.computed_tam, v.tam, v.tam_override_reason], [500_000_000, TAM, 500_000_000, 'Analyst consensus']);
    assert.equal(one(db, 'SELECT tam FROM projects WHERE id = 1').tam, 500_000_000);
    assert.deepEqual(db.prepare('SELECT method FROM market_figures').all().map((x: any) => x.method), ['typed', 'typed', 'typed']);
    assert.equal(one(db, 'SELECT tam_override_reason FROM project_market_assumptions WHERE project_id = 1').tam_override_reason, 'Analyst consensus');
  } finally { db.close(); }
});

test('an input with two estimates computes from the one marked as used, with its reason', async () => {
  const { db, save, read, snapshot } = fixture(); try {
    const two = (extra: Record<string, unknown> = {}) => ({ estimates: [
      assume('41,200', Y),
      { value: '50,000', ...Y, source: { kind: 'market_source', market_source_id: 7 }, used: true },
    ], ...extra });
    const before = snapshot();
    assert.equal((await save(labelled({ base: { inputs: inputs({ population: two() }) } }))).body.error, 'missing_used_estimate');
    const both = { estimates: [{ ...assume('41,200', Y), used: true }, { value: '50,000', ...Y, source: { kind: 'market_source', market_source_id: 7 }, used: true }], used_reason: 'x' };
    assert.equal((await save(labelled({ base: { inputs: inputs({ population: both }) } }))).body.error, 'missing_used_estimate');
    assert.equal(snapshot(), before);
    const r = await save(labelled({ base: { inputs: inputs({ population: two({ used_reason: 'The report counts registered firms; the founder count is a guess.' }) }) } }));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.version.tam, 50_000 * 18_000);
    const ests = (await read(r.body.version.uid)).body.version.scenarios.base.estimates.filter((e: any) => e.input_key === 'population');
    assert.deepEqual(ests.map((e: any) => [e.estimate_no, e.value, e.used, e.source_kind]), [[1, 41_200, false, 'assumption'], [2, 50_000, true, 'market_source']]);
    assert.equal(ests[1].used_reason, 'The report counts registered firms; the founder count is a guess.');
    assert.equal(one(db, "SELECT value FROM market_sizing_version_inputs WHERE input_key = 'population'").value, 50_000);
  } finally { db.close(); }
});

test('a top-down check is stored with its gap and changes no project figure', async () => {
  const { db, save, read } = fixture(); try {
    const r = await save(labelled(undefined, { top_down: assume('800', { currency: 'USD', ...Y }) }));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual(r.body.top_down, { tam: 800_000_000, gap: 800_000_000 - TAM });
    const v = (await read(r.body.version.uid)).body.version;
    assert.deepEqual([v.top_down.tam, v.top_down.bottom_up_tam, v.top_down.gap, v.tam], [800_000_000, TAM, 58_400_000, TAM]);
    assert.equal(v.top_down.estimates[0].source_kind, 'assumption');
    assert.ok(!v.scenarios.base.estimates.some((e: any) => e.input_key === 'topDownTotal'), 'the check is not an input of the formula');
    assert.deepEqual({ ...one(db, 'SELECT tam, sam, som FROM projects WHERE id = 1') }, { tam: TAM, sam: SAM, som: SOM });
    assert.ok(db.prepare('SELECT value FROM market_figures').all().every((x: any) => x.value !== 800_000_000));
    const unlabelled = await save(labelled(undefined, { top_down: { value: '800', currency: 'USD', ...Y } }));
    assert.deepEqual([unlabelled.body.error, unlabelled.body.scenario], ['missing_input_source', 'top_down']);
  } finally { db.close(); }
});

test('a person who cannot save sizing for the venture is refused on every new route, with nothing written', async () => {
  const { db, call, save, snapshot } = fixture(); try {
    const mine = await save(labelled(THREE()));
    assert.equal(mine.status, 201);
    const before = snapshot();
    for (const [method, path, body] of [
      ['POST', '/api/market-sizing/projects/1/versions', labelled(THREE())],
      ['POST', '/api/market-sizing/projects/1/preview', labelled(THREE())],
      ['GET', `/api/market-sizing/projects/1/versions/${mine.body.version.uid}/sensitivity`, undefined],
      ['GET', '/api/market-sizing/projects/1/superseded', undefined],
    ] as const) {
      const r = await call(OTHER, method, path, body);
      assert.equal(r.status, 403, `${method} ${path}`);
      assert.equal(r.body.error, 'not_project_editor');
      assert.ok(!JSON.stringify(r.body).includes(String(TAM)), 'a refusal leaks no figure');
    }
    assert.equal(snapshot(), before);
    // The labelled preview computes and stores nothing.
    const preview = await call(FOUNDER, 'POST', '/api/market-sizing/projects/1/preview', labelled(THREE()));
    assert.deepEqual([preview.status, preview.body.scenarios.high.som, preview.body.saved], [200, 6_879_600, false]);
    assert.equal(snapshot(), before);
  } finally { db.close(); }
});

test('a version saved before this change recomputes to the same figures and reads as it did, with the limitation stated', async () => {
  const { db, read } = fixture(); try {
    // Written exactly as #7704's route wrote it, naming none of D7725's columns.
    db.exec(`INSERT INTO market_sizing_versions (uid, project_id, version_number, formula_version, scenario, computed_tam,
        tam_override, tam_override_reason, tam, sam, som, som_limit, currency, reference_year, horizon_months, author_id)
      VALUES ('pre-7725', 1, 1, 2, 'base', ${TAM}, NULL, NULL, ${TAM}, ${SAM}, ${SOM}, 'capacity', 'USD', 2027, 24, 1);
      INSERT INTO market_sizing_version_inputs (version_id, input_key, value, typed_text, unit, label, note)
      SELECT id, k, v, NULL, u, 'entered', NULL FROM market_sizing_versions,
        (SELECT 'population' AS k, 41200 AS v, 'accounts' AS u UNION ALL SELECT 'acv', 18000, 'USD per year' UNION ALL SELECT 'samPct', 14, 'percent'
         UNION ALL SELECT 'winRate', 8, 'percent' UNION ALL SELECT 'capacity', 4, 'deals per month' UNION ALL SELECT 'horizonMonths', 24, 'months'
         UNION ALL SELECT 'salesCycleMonths', 3, 'months' UNION ALL SELECT 'retentionPct', 90, 'percent')
       WHERE uid = 'pre-7725';`);
    const v = (await read('pre-7725')).body.version;
    assert.deepEqual([v.recomputes, v.scenarios.base.recomputes, ...figs(v)], [true, true, TAM, SAM, SOM]);
    assert.equal(v.revenue_basis, null);
    assert.deepEqual([v.top_down, v.unlabelled_inputs, v.sensitivity.available], [null, 8, false]);
    assert.match(v.formula.join(' '), /SOM is set by sales capacity/);
    assert.equal(v.limitation, SIZING_LIMITATION);
    assert.match(v.limitation, /overlapping segments or organisations with several locations/);
  } finally { db.close(); }
});

test('the new tables and columns are append-only, and every refusal code has its own sentence', async () => {
  const { db, save } = fixture(); try {
    assert.equal((await save(labelled(THREE(), { top_down: assume('800', { currency: 'USD', ...Y }) }))).status, 201);
    assert.throws(() => db.exec("UPDATE market_sizing_scenarios SET som = 1 WHERE scenario = 'low'"), /append-only/);
    assert.throws(() => db.exec('UPDATE market_sizing_input_estimates SET value = 1'), /append-only/);
    assert.throws(() => db.exec("UPDATE market_sizing_input_estimates SET source_kind = 'assumption', note = 'x'"), /append-only/);
    assert.throws(() => db.exec('UPDATE market_sizing_versions SET top_down_gap = 0'), /append-only/);
    assert.throws(() => db.exec("UPDATE market_sizing_versions SET revenue_basis = 'cumulative'"), /append-only/);
    db.exec('UPDATE market_sizing_input_estimates SET market_source_id = NULL');
    const sentences = Object.values(SCENARIO_REFUSALS);
    assert.equal(new Set(sentences).size, sentences.length, 'no two codes share a sentence');
  } finally { db.close(); }
});
