/**
 * D7749 (#7749) — the fund directory's mandate filters: stage, where a fund
 * invests and its cheque, over D7743's served current statements, with
 * facets, coverage.mandate and a mandate block on each row; and the Capital
 * relationships match read through the same contract.
 *
 * Real SQLite through the real route: the directory (365, with 7744's
 * columns), 406's sources, 376's crosswalk, 229's markets, 7166's uid moves,
 * 7167's vehicle facts and 7743's store, run whole. Statements are written
 * with D7743's own writer. Every fund, list and wording is invented.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/research_fund_mandate_filters_7749.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import research from '../src/routes/research.ts';
import { matchRead } from '../src/services/capRelReads.ts';
import { observationStatements, STAGE_TERMS, type ObservationInput } from '../src/services/researchFundObservations.ts';
import { d1Over } from './_d1_sqlite.mjs';

const SECRET = 'test'.repeat(16);
const USER = 11;
const sql = (name: string) => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');
const ddl = (name: string) => sql(name).split(/;\s*\n/).map((s) => s.replace(/^\s*--.*$/gm, '').trim())
  .filter((s) => /^CREATE\s+(TABLE|INDEX)/i.test(s)).map((s) => `${s};`).join('\n');

const CITE = 'Harbour Lantern Fund Index';
const OPEN = 'Quill Meadow Investor Notes';
const DOWN = 'Slate Orchard Fund Sheet';

type Row = { uid: string; name: string; hq?: string; focus?: string; number?: string; kind?: string; size?: [number, string] };
const ROWS: Row[] = [
  { uid: 'harbour', name: 'Harbour Fund', number: 'Opp', hq: 'Berlin', focus: 'Fintech', kind: 'vehicle', size: [50_000_000, 'USD'] },
  { uid: 'lantern', name: 'Lantern Capital II', hq: 'Paris', kind: 'vehicle' },
  { uid: 'meadow', name: 'Meadow Ventures', hq: 'Berlin', kind: 'vehicle' },
  { uid: 'quill', name: 'Quill Fund IV', hq: 'London', kind: 'vehicle' },
  { uid: 'slate', name: 'Slate Fund V', hq: 'Paris', kind: 'vehicle' },
  { uid: 'pinecrest', name: 'Pinecrest Partners', hq: 'Berlin', kind: 'manager' },
  { uid: 'pinecrest-ii', name: 'Pinecrest Ventures II', hq: 'Berlin', kind: 'vehicle' },
  { uid: 'past', name: 'Past Fund VI', hq: 'Paris', kind: 'vehicle' },
  { uid: 'withheld', name: 'Withheld Row VII', hq: 'Paris', kind: 'vehicle' },
];

const S = (fund_uid: string, fact: ObservationInput['fact'], wording: string, extra: Partial<ObservationInput> = {}) =>
  ({ fund_uid, fact, wording, source_name: CITE, source_record_ref: `${fund_uid}-${fact}-${extra.source_name ?? CITE}`, ...extra });

const STATEMENTS: Partial<ObservationInput>[] = [
  // Stage: one source lists two stages; one row two sources call seed; one wording maps to no term.
  S('harbour', 'investment_stage', 'Pre-seed, Seed'),
  S('lantern', 'investment_stage', 'Seed'),
  S('lantern', 'investment_stage', 'seed stage', { source_name: OPEN }),
  S('meadow', 'investment_stage', 'Series A'),
  S('quill', 'investment_stage', 'Opportunistic'),
  S('pinecrest', 'investment_stage', 'Seed'),
  S('past', 'investment_stage', 'Seed', { period_start: '2019-01-01', period_end: '2021-12-31' }),
  S('withheld', 'investment_stage', 'Seed', { source_name: DOWN }),
  // Where it invests: a country, a region, a country where the HQ is elsewhere, wording that maps to nothing.
  S('harbour', 'investment_geography', 'Germany'),
  S('lantern', 'investment_geography', 'Europe'),
  S('meadow', 'investment_geography', 'France'),
  S('quill', 'investment_geography', 'Somewhere sunny'),
  S('withheld', 'investment_geography', 'Germany', { source_name: DOWN }),
  // Cheques.
  S('harbour', 'initial_cheque', 'USD 250k - 1m'),
  S('lantern', 'initial_cheque', 'from USD 100k'),
  S('meadow', 'initial_cheque', 'average first cheque USD 500k'),
  S('quill', 'initial_cheque', '$250k - $1m'),
  S('slate', 'initial_cheque', 'EUR 250k - 1m'),
  S('past', 'initial_cheque', 'USD 250k - 1m', { period_end: '2021-12-31' }),
  S('withheld', 'initial_cheque', 'USD 250k - 1m', { source_name: DOWN }),
  // Manager, description and a contact-class fact.
  S('quill', 'manager_name', 'Birchwick Partners'),
  S('harbour', 'description', 'An invented description seven seven four nine', { source_name: OPEN }),
  S('harbour', 'lead_preference', 'Write to the invented partner desk', { source_name: OPEN }),
];

function fixture(o: { store?: boolean; statements?: Partial<ObservationInput>[]; rows?: Row[] } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                               jwt_min_iat INTEGER, name TEXT, email TEXT, kyc_status TEXT);`);
  db.exec(ddl('365_research_eurotech_fund_directory.sql'));
  db.exec(sql('202611270508_7744_research_fund_size_currency_and_kind.sql'));
  db.exec(sql('406_research_fund_sources.sql'));
  db.exec(sql('376_research_taxonomy.sql'));
  db.exec(ddl('229_research_market_directory.sql'));
  if (o.store !== false) {
    db.exec(sql('202611180052_7166_research_fund_directory_vehicles.sql').match(/CREATE TABLE IF NOT EXISTS research_fund_directory_uid_moves \(.*?\);/s)![0]);
    db.exec(sql('202611180053_7167_research_fund_vehicle_facts.sql'));
    db.exec(sql('202611191932_7743_research_fund_observations.sql'));
  }
  db.prepare(`INSERT INTO users (id, role, name, email) VALUES (?, 'founder', 'Fin', 'fin@example.test')`).run(USER);
  db.exec(`INSERT INTO research_fund_sources (source_name,title,publisher,published_url,terms_status,terms_quote,evidence_url,evidence,verdict,verdict_reason,reviewed_on) VALUES
    ('${CITE}','Harbour Lantern','A publisher','https://list.example/hl','not found',NULL,NULL,'e','cite only','r','2026-11-01'),
    ('${OPEN}','Quill Meadow','A publisher','https://list.example/qm','found','Reuse is welcome.','https://list.example/qm/terms','e','republish allowed','r','2026-11-01'),
    ('${DOWN}','Slate Orchard','A publisher','https://list.example/so','not found',NULL,NULL,'e','not allowed','r','2026-11-01')`);
  const ins = db.prepare(`INSERT INTO research_fund_directory (uid, name, hq, fund_number, fund_size_cents, fund_size_currency, sector_focus,
      eif_flag, eifo_flag, source_name, source_url, as_of, record_kind) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 'https://repo.example/hl.csv', '2026-11-01', ?)`);
  for (const r of o.rows ?? ROWS) {
    ins.run(r.uid, r.name, r.hq ?? null, r.number ?? null, r.size ? r.size[0] * 100 : null, r.size ? r.size[1] : null, r.focus ?? null, CITE, r.kind ?? null);
  }
  const env = { JWT_SECRET: SECRET, ENVIRONMENT: 'production', DB: d1Over(db) } as any;
  return { db, env };
}

async function seeded(statements = STATEMENTS) {
  const f = fixture();
  const w = observationStatements(f.env.DB, statements.map((s) => ({ imported_on: '2026-11-19', method: 'rule', source_url: 'https://list.example/row', ...s }) as ObservationInput));
  await f.env.DB.batch(w.statements);
  return f;
}

const app = new Hono<any>();
app.route('/api/research', research);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

async function get(env: any, qs = '') {
  const token = await new SignJWT({ user_id: USER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const res = await app.request(`/api/research/fund-directory${qs}`, { headers: { Authorization: `Bearer ${token}` } }, env);
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) as any };
}
const uids = (b: any) => (b.items as any[]).map((i) => i.uid).sort();

test('the cheque wordings read as this test means them (D7743 readAmount)', async () => {
  const f = await seeded();
  const q = (uid: string) => f.db.prepare(`SELECT qualifier, currency, currency_basis FROM research_fund_observations WHERE fund_uid = ? AND fact = 'initial_cheque' AND period_end IS NULL`).get(uid) as any;
  assert.deepEqual({ ...q('harbour') }, { qualifier: 'range', currency: 'USD', currency_basis: 'stated' });
  assert.deepEqual({ ...q('lantern') }, { qualifier: 'lower_bound', currency: 'USD', currency_basis: 'stated' });
  assert.deepEqual({ ...q('meadow') }, { qualifier: 'average_first', currency: 'USD', currency_basis: 'stated' });
  assert.deepEqual({ ...q('quill') }, { qualifier: 'range', currency: null, currency_basis: 'symbol_only' });
  assert.deepEqual({ ...q('slate') }, { qualifier: 'range', currency: 'EUR', currency_basis: 'stated' });
});

test('stage: a served current term, a two-stage statement matches each, none, unmapped counted, unknown refused', async () => {
  const { env } = await seeded();
  const seed = await get(env, '?stage=seed');
  assert.equal(seed.status, 200, seed.text);
  assert.deepEqual(uids(seed.body), ['harbour', 'lantern', 'pinecrest'], 'no vehicle inherits its manager, no past or withheld statement');
  assert.equal(seed.body.total, 3);
  assert.deepEqual(uids((await get(env, '?stage=pre_seed')).body), ['harbour']);
  assert.deepEqual(uids((await get(env, '?stage=series_a')).body), ['meadow']);
  const none = await get(env, '?stage=none');
  assert.deepEqual(uids(none.body), ['past', 'pinecrest-ii', 'slate', 'withheld']);
  assert.ok(!uids(none.body).includes('quill') && !uids(seed.body).includes('quill'), 'unmapped wording is in neither');
  assert.equal(seed.body.facets_unmapped.stage, 1);
  const bad = await get(env, '?stage=round_z');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.field, 'stage');
  for (const t of STAGE_TERMS) assert.ok(bad.body.detail.includes(t), t);
});

test('each stage and invests_in facet count is the total picking it returns, counting rows not statements', async () => {
  const { env } = await seeded();
  const all = await get(env);
  const seed = all.body.facets.stage.find((v: any) => v.value === 'seed');
  assert.equal(seed.count, 3, 'lantern, called seed by two sources, counts once');
  for (const v of all.body.facets.stage) assert.equal((await get(env, `?stage=${v.value}`)).body.total, v.count, `stage ${v.value}`);
  for (const v of all.body.facets.invests_in) assert.equal((await get(env, `?invests_in=${encodeURIComponent(v.value)}`)).body.total, v.count, `invests_in ${v.value}`);
  // A facet leaves out its own filter only.
  const withStage = await get(env, '?stage=seed');
  assert.deepEqual(withStage.body.facets.stage.map((v: any) => v.value), all.body.facets.stage.map((v: any) => v.value));
  assert.equal(withStage.body.facets.invests_in.find((v: any) => v.value === 'DE').count, 1, 'invests_in counts under stage=seed');
  assert.equal(all.body.facets_unmapped.invests_in, 1);
});

test('invests_in is literal: a country is not a region, not the HQ, and the reverse', async () => {
  const { env } = await seeded();
  const de = await get(env, '?invests_in=de');
  assert.deepEqual(uids(de.body), ['harbour'], 'not meadow (based in Berlin), not lantern (Europe), not the withheld list');
  assert.deepEqual(uids((await get(env, '?invests_in=Europe')).body), ['lantern']);
  assert.deepEqual(uids((await get(env, '?invests_in=north-america')).body), []);
  assert.deepEqual(uids((await get(env, '?invests_in=FR')).body), ['meadow']);
  assert.deepEqual(uids((await get(env, '?invests_in=none')).body), ['past', 'pinecrest', 'pinecrest-ii', 'slate', 'withheld']);
  assert.match(de.body.mandate_basis, /that region only, never its countries/);
  const bad = await get(env, '?invests_in=Atlantis');
  assert.deepEqual([bad.status, bad.body.field], [400, 'invests_in']);
});

test('cheque: an amount in USD matches a USD range and a USD lower bound, never an average, a symbol or a EUR range', async () => {
  const { env } = await seeded();
  const r = await get(env, '?cheque=500000&cheque_currency=usd');
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(uids(r.body), ['harbour', 'lantern']);
  assert.equal(r.body.facets.cheque_not_comparable, 3, 'meadow, quill and slate');
  assert.deepEqual(uids((await get(env, '?cheque=50000&cheque_currency=USD')).body), [], 'below the range and the bound');
  assert.deepEqual(uids((await get(env, '?cheque=1000000&cheque_currency=USD')).body), ['harbour', 'lantern'], 'bounds are inclusive');
  assert.deepEqual(uids((await get(env, '?cheque=500000&cheque_currency=EUR')).body), ['slate']);
  assert.deepEqual(uids((await get(env, '?cheque=worded')).body), ['meadow', 'quill']);
  assert.deepEqual(uids((await get(env, '?cheque=none')).body), ['past', 'pinecrest', 'pinecrest-ii', 'withheld']);
  const all = await get(env);
  assert.deepEqual(all.body.facets.cheque.currencies.map((c: any) => [c.currency, c.count]), [['EUR', 1], ['USD', 2]]);
  assert.deepEqual([all.body.facets.cheque.worded, all.body.facets.cheque.none], [2, 4]);
  assert.equal((await get(env, '?cheque=worded')).body.total, all.body.facets.cheque.worded);
  assert.equal((await get(env, '?cheque=none')).body.total, all.body.facets.cheque.none);
  for (const [qs, field] of [['?cheque=500000', 'cheque_currency'], ['?cheque=500000&cheque_currency=US', 'cheque_currency'],
    ['?cheque=5e5&cheque_currency=USD', 'cheque'], ['?cheque=-1&cheque_currency=USD', 'cheque'], ['?cheque_currency=USD', 'cheque_currency']]) {
    const bad = await get(env, qs);
    assert.deepEqual([bad.status, bad.body.field], [400, field], qs);
  }
});

test('the mandate filters combine with hq_country, focus, size and kind', async () => {
  const { env } = await seeded();
  assert.deepEqual(uids((await get(env, '?stage=seed&hq_country=DE')).body), ['harbour', 'pinecrest']);
  assert.deepEqual(uids((await get(env, '?stage=seed&kind=manager')).body), ['pinecrest']);
  assert.deepEqual(uids((await get(env, '?stage=seed&focus=fintech')).body), ['harbour']);
  assert.deepEqual(uids((await get(env, '?stage=seed&size_currency=USD&size_min=10000000')).body), ['harbour']);
  assert.deepEqual(uids((await get(env, '?stage=seed&invests_in=Europe&cheque=500000&cheque_currency=USD')).body), ['lantern']);
});

test('q finds a row by its vehicle label, its name with the fund number, and its manager statement', async () => {
  const { env } = await seeded();
  assert.deepEqual(uids((await get(env, '?q=opp')).body), ['harbour']);
  assert.deepEqual(uids((await get(env, '?q=Harbour%20Fund%20Opp')).body), ['harbour']);
  assert.deepEqual(uids((await get(env, '?q=Birchwick')).body), ['quill']);
  assert.deepEqual(uids((await get(env, '?q=Lantern')).body), ['lantern'], 'the name still matches');
});

test('each row carries its mandate; no description or other fact reaches the answer', async () => {
  const { env } = await seeded();
  const r = await get(env, '?stage=seed');
  const by = new Map((r.body.items as any[]).map((i) => [i.uid, i.mandate]));
  const h = by.get('harbour');
  assert.equal(h.status, 'ok');
  assert.deepEqual([h.stage.status, h.stage.terms, h.stage.source_count], ['stated', ['pre_seed', 'seed'], 1]);
  assert.equal(h.stage.statements[0].wording, 'Pre-seed, Seed');
  assert.equal(h.stage.statements[0].provenance.source_name, CITE);
  assert.deepEqual(h.geography.terms, { countries: ['DE'], regions: [] });
  assert.deepEqual([h.cheque.status, h.cheque.terms, h.cheque.statements[0].qualifier, h.cheque.statements[0].comparable], ['comparable', ['USD'], 'range', true]);
  assert.equal(by.get('lantern').stage.source_count, 2);
  assert.equal(by.get('pinecrest').cheque.status, 'not_recorded');
  assert.equal(by.get('pinecrest').geography.status, 'not_recorded');
  const all = await get(env, '?q=quill');
  assert.equal(all.body.items[0].mandate.stage.status, 'unmapped');
  assert.equal(all.body.items[0].mandate.cheque.status, 'worded');
  for (const s of ['seven seven four nine', 'partner desk']) assert.ok(!r.text.includes(s) && !(await get(env)).text.includes(s), s);
});

test('a past statement and a withheld list match nothing and count nowhere', async () => {
  const { env } = await seeded();
  const all = await get(env);
  const by = new Map((all.body.items as any[]).map((i) => [i.uid, i.mandate]));
  for (const uid of ['past', 'withheld']) {
    assert.equal(by.get(uid).stage.status, 'not_recorded', uid);
    assert.equal(by.get(uid).cheque.status, 'not_recorded', uid);
  }
  assert.ok(!all.text.includes(DOWN + '"') || !JSON.stringify(by.get('withheld')).includes(DOWN));
  const cov = all.body.coverage.mandate;
  assert.deepEqual(cov, { status: 'ok', total: 9, stage: 5, geography: 4, cheque: 5, manager: 1, cheque_comparable: 3 });
});

test('coverage.fields keeps its keys; an empty store reads zeros and empty facets', async () => {
  const f = fixture();
  const r = await get(f.env);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(Object.keys(r.body.coverage.fields).sort(), ['fund_number', 'fund_year', 'hq', 'linkedin', 'notable_lps', 'sector_focus',
    'size_by_currency', 'size_eur', 'size_unknown_currency', 'size_usd', 'website']);
  assert.deepEqual(r.body.coverage.mandate, { status: 'ok', total: 9, stage: 0, geography: 0, cheque: 0, manager: 0, cheque_comparable: 0 });
  assert.deepEqual(r.body.facets.stage, [{ value: 'none', label: 'Stage not recorded', count: 9 }]);
  assert.deepEqual(r.body.facets.invests_in.map((v: any) => v.value), ['none']);
  assert.deepEqual(r.body.facets.cheque, { currencies: [], worded: 0, none: 9 });
  assert.equal((await get(f.env, '?stage=seed')).body.total, 0);
});

test('a missing store is not an empty one: the list answers, the mandate reads unavailable, a mandate filter is a 503', async () => {
  const f = fixture({ store: false });
  const r = await get(f.env);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.total, 9);
  assert.equal(r.body.mandate_status, 'unavailable');
  assert.equal(r.body.coverage.mandate.status, 'unavailable');
  assert.ok(r.body.items.every((i: any) => i.mandate.status === 'unavailable'));
  assert.deepEqual([r.body.facets.stage, r.body.facets.cheque, r.body.facets_unmapped.stage], [[], null, null]);
  assert.ok(r.body.facets.hq_country.length > 1, 'the other facets still answer');
  for (const qs of ['?stage=seed', '?invests_in=DE', '?cheque=500000&cheque_currency=USD', '?cheque=none']) {
    const refused = await get(f.env, qs);
    assert.equal(refused.status, 503, qs);
    assert.equal(refused.body.items, undefined, qs);
  }
  assert.equal((await get(f.env, '?q=Harbour')).body.total, 1, 'q still answers on names');
});

test('Capital relationships match read filters by stage and passes the mandate through', async () => {
  const { db, env } = await seeded();
  db.exec(`CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, sector TEXT);
           CREATE TABLE network_connections (id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, title TEXT, company TEXT);
           CREATE TABLE raise_prospects (id INTEGER PRIMARY KEY, project_id INTEGER, research_fund_uid TEXT);
           INSERT INTO projects (id, name, sector) VALUES (101, 'Fixture Venture', 'Fintech');`);
  const r = await matchRead(env, { projectId: 101, callerUserId: USER, get: (k) => ({ stage: 'seed' } as Record<string, string>)[k] });
  assert.deepEqual(r.items.map((i: any) => i.uid).sort(), ['harbour', 'lantern', 'pinecrest']);
  for (const i of r.items as any[]) {
    assert.equal(i.mandate.stage.status, 'stated');
    assert.ok(!('stage_reason' in i), 'the match read no longer says the directory records no stage');
  }
  assert.ok(!JSON.stringify(r).includes('records no stage'));
});
