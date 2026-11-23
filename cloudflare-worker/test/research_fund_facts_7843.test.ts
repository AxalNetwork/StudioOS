/**
 * D7843 (#7843) — the reviewed-manifest writer: scripts/import-fund-facts.mjs compiles a manifest
 * into SQL that fills research_fund_observations and research_fund_observation_terms (D7743).
 *
 * Real SQLite with foreign keys ON, built as D7743's test builds it (migrations 406, 378, 7166,
 * 7167 and 7743), then the fixture's review rows and its compiled SQL. Every list, fund and
 * wording is invented (fixtures/fund_facts_7843/).
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/research_fund_facts_7843.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { d1Over } from './_d1_sqlite.mjs';
import {
  normaliseGeography, normaliseStage, readAmount, readFundStatements,
} from '../src/services/researchFundObservations.ts';
// @ts-ignore — a plain ES module script
import {
  COMPILED_METHOD, ManifestError, compileManifest, ledgerOf, reviewedSources,
} from '../../scripts/import-fund-facts.mjs';

const FIX = fileURLToPath(new URL('./fixtures/fund_facts_7843/', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../../scripts/import-fund-facts.mjs', import.meta.url));
const sql = (name: string) => readFileSync(new URL(`../sql/${name}`, import.meta.url), 'utf8');
const MANIFEST = JSON.parse(readFileSync(join(FIX, 'manifest.json'), 'utf8'));
const COMPILED = readFileSync(join(FIX, 'compiled.sql'), 'utf8');
const REVIEWS = reviewedSources(FIX);
// The behaviour below runs on a fresh compile; the first test proves the committed file equals it.
const FRESH = (await compileManifest(MANIFEST, { reviews: REVIEWS })).sql as string;

const CITE = 'Harbour Lantern Fund Index';
const OPEN = 'Quill Meadow Investor Notes';
const DOWN = 'Slate Orchard Fund Sheet';

function store() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  db.exec(sql('migrations/406_research_fund_sources.sql').match(/CREATE TABLE IF NOT EXISTS research_fund_sources \([\s\S]*?\n\);/)![0]);
  const m378 = sql('migrations/378_research_fund_directory_rebuild.sql');
  db.exec(m378.match(/CREATE TABLE IF NOT EXISTS research_fund_directory \(.*?\);/)![0]);
  db.exec(m378.match(/CREATE TABLE IF NOT EXISTS research_fund_directory_reports \(.*?\);/)![0]);
  db.exec(sql('migrations/202611180052_7166_research_fund_directory_vehicles.sql').match(/CREATE TABLE IF NOT EXISTS research_fund_directory_uid_moves \(.*?\);/)![0]);
  db.exec(sql('migrations/202611180053_7167_research_fund_vehicle_facts.sql'));
  db.exec(sql('migrations/202611191932_7743_research_fund_observations.sql'));
  assert.equal((db.prepare('PRAGMA foreign_keys').get() as any).foreign_keys, 1);
  db.exec(readFileSync(join(FIX, 'reviews.sql'), 'utf8'));
  // A manager row and one of its vehicles; a fund whose uid moved; a fund under the cite-only list.
  db.exec(`INSERT INTO research_fund_directory (uid,name,source_name,source_url,as_of) VALUES
    ('tidewater-partners','Tidewater Partners','${CITE}','https://repo.example/hl.csv','2026-11-01'),
    ('tidewater-fund-ii','Tidewater Fund II','${CITE}','https://repo.example/hl.csv','2026-11-01'),
    ('pinecrest-ii','Pinecrest Ventures II','${CITE}','https://repo.example/hl.csv','2026-11-01'),
    ('marrow-i','Marrow Bay Capital I','${CITE}','https://repo.example/hl.csv','2026-11-01')`);
  db.exec(`INSERT INTO research_fund_directory_uid_moves (old_uid, new_uid, moved_on) VALUES ('pinecrest-old','pinecrest-ii','2026-11-18')`);
  return { db, env: { DB: d1Over(db) } as any };
}
const rows = (db: DatabaseSync, where = '1=1') =>
  db.prepare(`SELECT * FROM research_fund_observations WHERE ${where} ORDER BY id`).all() as any[];
const terms = (db: DatabaseSync, ref: string) =>
  (db.prepare(`SELECT t.vocabulary, t.term FROM research_fund_observation_terms t JOIN research_fund_observations o ON o.id = t.observation_id
                WHERE o.source_record_ref = ? ORDER BY t.vocabulary, t.term`).all(ref) as any[]).map((t) => `${t.vocabulary}:${t.term}`);
const row = (k: string) => MANIFEST.rows.find((r: any) => r.key === k);
const counts = (db: DatabaseSync) => [
  (db.prepare('SELECT COUNT(*) AS n FROM research_fund_observations').get() as any).n,
  (db.prepare('SELECT COUNT(*) AS n FROM research_fund_observation_terms').get() as any).n,
];

test('the committed compile is what the manifest compiles to now', async () => {
  assert.equal(FRESH, COMPILED);
});

test('the compiled manifest fills both tables, and the served read returns wording, qualifier, terms and source', async () => {
  const f = store();
  f.db.exec(FRESH);
  const served = await readFundStatements(f.env, ['tidewater-partners']);
  const tw = served.get('tidewater-partners')!.current.filter((s) => s.origin === 'statement');
  assert.deepEqual(tw.map((s) => s.fact).sort(), ['initial_cheque', 'investment_geography', 'investment_stage', 'manager_name']);
  const stage = tw.find((s) => s.fact === 'investment_stage')!;
  assert.equal(stage.wording, 'Pre-seed to Series A');
  assert.equal(stage.source_name, OPEN);
  assert.equal(stage.source_url, 'https://tidewater.example/approach');
  assert.deepEqual(stage.terms.map((t) => t.term), ['pre_seed', 'seed', 'series_a']);
  const cheque = tw.find((s) => s.fact === 'initial_cheque')!;
  assert.equal(cheque.qualifier, 'range');
  for (const r of rows(f.db)) {
    assert.equal(r.promoted_by_user_id, null);
    assert.equal(r.promoted_at, null);
    assert.equal(r.method, COMPILED_METHOD);
    assert.equal(r.imported_on, '2026-11-21');
    assert.equal(r.period_start, null);
  }
});

test("a manager's statement is not returned for its vehicle's uid", async () => {
  const f = store();
  f.db.exec(FRESH);
  const served = await readFundStatements(f.env, ['tidewater-fund-ii']);
  assert.equal(served.get('tidewater-fund-ii')?.current.length ?? 0, 0);
  assert.equal(rows(f.db, "fund_uid = 'tidewater-fund-ii'").length, 0);
});

test('every money shape passes the CHECKs as compiled and equals what readAmount returns for the wording', () => {
  const f = store();
  f.db.exec(FRESH);
  const shapes = new Map<string, string>();
  for (const key of ['tw-cheque', 'pc-cheque', 'pc-cheque-sheet', 'mb-cheque', 'mb-capital']) {
    const m = row(key);
    const want = readAmount(m.fact, m.wording, m.heading);
    const [got] = rows(f.db, `source_record_ref = '${key}'`);
    assert.ok(got, `${key} is in the store`);
    assert.deepEqual(
      [got.qualifier, got.min_cents, got.max_cents, got.point_cents, got.currency, got.currency_basis, got.review_flags],
      [want.qualifier, want.min_cents ?? null, want.max_cents ?? null, want.point_cents ?? null, want.currency ?? null,
        want.currency_basis, want.review_flags ? JSON.stringify(want.review_flags) : null], key);
    shapes.set(key, `${got.qualifier}/${got.currency_basis}`);
  }
  // The four shapes the issue names: a range, a typical amount, a lower bound, an amount with a symbol only.
  assert.equal(shapes.get('tw-cheque'), 'range/stated');
  assert.equal(shapes.get('pc-cheque'), 'typical/stated');
  assert.equal(shapes.get('mb-cheque'), 'lower_bound/symbol_only');
  assert.equal(shapes.get('mb-capital'), 'exact/symbol_only');
  // A code only in the column heading gives no currency (D7743).
  assert.equal(shapes.get('pc-cheque-sheet'), 'exact/heading_only');
});

test('every compiled term equals what normaliseStage and normaliseGeography return for the same wording', () => {
  const f = store();
  f.db.exec(FRESH);
  assert.deepEqual(terms(f.db, 'tw-stage'), normaliseStage(row('tw-stage').wording).terms.map((t) => `stage:${t}`));
  const g = normaliseGeography(row('tw-geo').wording);
  assert.deepEqual(terms(f.db, 'tw-geo'), [...g.countries.map((t) => `country:${t}`), ...g.regions.map((t) => `region:${t}`)].sort());
  assert.ok(g.unmatched.length > 0, 'the Nordics stay text with no term');
  assert.deepEqual(terms(f.db, 'mb-lead'), [], 'a text fact gets no term');
});

test('nothing is written for a uid the directory does not serve or under a not-allowed list; a moved uid is followed', () => {
  const f = store();
  f.db.exec(FRESH);
  assert.equal(rows(f.db, "source_record_ref = 'gh-desc'").length, 0);
  assert.equal(rows(f.db, `source_name = '${DOWN}'`).length, 0);
  const [moved] = rows(f.db, "source_record_ref = 'pc-cheque'");
  assert.equal(moved.fund_uid, 'pinecrest-ii');
  // A list that serves no fund leaves its rows unserved too: take the whole cite-only list down.
  const g = store();
  g.db.exec(`UPDATE research_fund_sources SET verdict = 'not allowed' WHERE source_name = '${CITE}'`);
  g.db.exec(FRESH);
  assert.equal(rows(g.db).length, 0, "no directory row is served, so nothing is written");
});

test('a replay writes nothing', () => {
  const f = store();
  f.db.exec(FRESH);
  const once = counts(f.db);
  const before = JSON.stringify(rows(f.db));
  f.db.exec(FRESH);
  assert.deepEqual(counts(f.db), once);
  assert.equal(JSON.stringify(rows(f.db)), before);
});

test('a changed value closes the earlier row with period_end, and the read returns it as past', async () => {
  const f = store();
  f.db.exec(FRESH);
  const [old] = rows(f.db, "source_record_ref = 'mb-sector-1'");
  assert.equal(old.period_end, '2026-09-01');
  const served = (await readFundStatements(f.env, ['marrow-i'])).get('marrow-i')!;
  assert.deepEqual(served.past.filter((s) => s.fact === 'sector_focus').map((s) => s.wording), ['Climate software']);
  assert.deepEqual(served.current.filter((s) => s.fact === 'sector_focus').map((s) => s.wording), ['Climate software and industrial automation']);
});

test('no row is written to research_fund_vehicle_facts and no table is created', () => {
  const f = store();
  const tables = () => (f.db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','trigger','index') ORDER BY name").all() as any[]).map((t) => t.name);
  const before = tables();
  f.db.exec(FRESH);
  assert.deepEqual(tables(), before);
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM research_fund_vehicle_facts').get() as any).n, 0);
  assert.doesNotMatch(FRESH, /research_fund_vehicle_facts|CREATE\s|DROP\s|ALTER\s/i);
});

// ---------------------------------------------------------------------------
// Refusals at compile time, each with its own code.
// ---------------------------------------------------------------------------

const PLANT = 'zq-planted-value-7843';
const one = (over: Record<string, unknown>) => ({
  name: 'refusal', imported_on: '2026-11-21',
  rows: [{ key: 'r-1', fund_uid: 'marrow-i', fact: 'interests', wording: `Grid storage ${PLANT}`, source_name: CITE,
    source_url: 'https://marrow.example/news', reported_on: '2026-10-02', ...over }],
});
async function refused(manifest: any, code: string, opts: any = {}) {
  await assert.rejects(compileManifest(manifest, { reviews: REVIEWS, ...opts }), (e: any) => {
    assert.ok(e instanceof ManifestError, String(e));
    assert.equal(e.code, code);
    assert.ok(!e.message.includes(PLANT) && !e.message.includes('@'), 'a refusal names no value');
    return true;
  });
}

test('a row with no source link, or no reported date, or a manifest with no import date, is refused', async () => {
  await refused(one({ source_url: undefined }), 'source_link_missing');
  await refused(one({ source_url: 'http://marrow.example/news' }), 'source_link_missing');
  await refused(one({ reported_on: undefined }), 'dates_missing');
  await refused({ ...one({}), imported_on: undefined }, 'imported_on_missing');
});

test("a fact outside D7743's list is refused, and the three follow-up facts each by name", async () => {
  await refused(one({ fact: 'thesis' }), 'fact_unknown');
  await refused(one({ fact: 'follow_on_cheque' }), 'fact_follow_on_cheque_not_written');
  await refused(one({ fact: 'deployment_status' }), 'fact_deployment_status_not_written');
  await refused(one({ fact: 'submission_route' }), 'fact_submission_route_not_written');
});

test('a list with no review row is refused; the committed migrations hold no review for the invented lists', async () => {
  await refused(one({ source_name: 'Unreviewed Invented List' }), 'source_unreviewed');
  const committed = reviewedSources();
  assert.ok(committed.size > 0, 'the committed migrations write review rows');
  for (const name of [CITE, OPEN, DOWN]) assert.ok(!committed.has(name), name);
  await refused(MANIFEST, 'source_unreviewed', { reviews: committed });
});

test('a value shaped like an email address, a phone number or a personal profile link is refused', async () => {
  await refused(one({ wording: `Write to partner@marrow.example ${PLANT}` }), 'value_email');
  await refused(one({ wording: `Call +44 20 7946 0000 ${PLANT}` }), 'value_phone');
  await refused(one({ wording: `Call 555-010-0199 ${PLANT}` }), 'value_phone');
  await refused(one({ source_url: 'https://www.linkedin.com/in/invented-person' }), 'value_profile_link');
  await refused(one({ source_url: 'https://x.com/invented_person' }), 'value_profile_link');
  // Money and dates are not phone numbers.
  await compileManifest(one({ fact: 'initial_cheque', wording: '€250,000 to €1,000,000' }), { reviews: REVIEWS });
});

test('a changed value under a row key an earlier compile used is refused; a new key that replaces it is not', async () => {
  const ledger = ledgerOf(FIX);
  assert.ok(ledger.has('mb-lead'));
  const changed = { ...one({ key: 'mb-lead', fact: 'lead_preference', wording: 'Follows only' }) };
  await refused(changed, 'changed_value_same_key', { ledger });
  // The same row again under its own key is not a change.
  await compileManifest({ name: 'again', imported_on: '2026-11-22', rows: [row('mb-lead')] }, { reviews: REVIEWS, ledger });
  await compileManifest({ name: 'replace', imported_on: '2026-11-22',
    rows: [{ ...row('mb-lead'), key: 'mb-lead-2', wording: 'Follows only', reported_on: '2026-11-20', replaces: 'mb-lead' }] },
  { reviews: REVIEWS, ledger });
  await refused({ name: 'dup', imported_on: '2026-11-22', rows: [row('mb-lead'), { ...row('mb-lead'), wording: 'Other' }] }, 'changed_value_same_key');
  await refused(one({ replaces: 'no-such-key' }), 'replaces_unknown', { ledger });
  await refused({ name: 'twice', imported_on: '2026-11-22', rows: [row('mb-lead'), row('mb-lead')] }, 'duplicate_key');
});

test('--check fails when the committed SQL differs from a fresh compile', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fund-facts-7843-'));
  try {
    const out = join(dir, 'compiled.sql');
    copyFileSync(join(FIX, 'compiled.sql'), out);
    const run = () => spawnSync(process.execPath, [SCRIPT, '--manifest', join(FIX, 'manifest.json'), '--out', out,
      '--reviews', FIX, '--ledger', dir, '--check'], { encoding: 'utf8' });
    assert.equal(run().status, 0, run().stderr);
    writeFileSync(out, COMPILED.replace("'Leads or co-leads seed rounds'", "'Leads seed rounds'"));
    const r = run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /is not what .* compiles to/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
