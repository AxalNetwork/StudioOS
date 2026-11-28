/**
 * D7927 (#7927): the County Business Patterns importer and the ZIP reader, over every migration and real SQLite, with
 * no network. Every provider file here is invented: a few industries with made-up counts in the national file's
 * column layout (record layout 2018-2023, read 2026-11-26). No real Census value is committed.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import {
  cbpFlag, cbpIndustry, cbpParams, cbpRows, CBP_LIMITATIONS, fileUrl, ingestCensusCbp, LAST_VERIFIED_YEAR, SOURCE_ID,
} from '../src/services/marketObservations/censusCbp.ts';
import { IMPORTERS } from '../src/services/marketObservations/importers.ts';
import { crc32, readZipEntry, ZipReadError } from '../src/util/zipRead.ts';
import { buildZip } from '../src/util/zip.ts';

const NOW = Date.parse('2026-11-26T09:00:00Z');
const MODIFIED = 'Thu, 26 Jun 2025 12:00:29 GMT', REVISED = 'Tue, 14 Oct 2025 09:00:00 GMT';
const HEADER = '"uscode","naics","lfo","emp_nf","emp","qp1_nf","qp1","ap_nf","ap","est"';
const line = (naics: string, lfo: string, empNf: string, emp: number, apNf: string, ap: number, est: number) =>
  `"98","${naics}","${lfo}","${empNf}",${emp},"G",${ap / 4},"${apNf}",${ap},${est}`;
/** Invented national file. 5415 has an N payroll (set to zero by the provider), 541511 an undefined flag. */
const FILE = [
  HEADER,
  line('------', '-', 'G', 1000000, 'G', 50000000, 80000),
  line('------', 'C', 'G', 600000, 'G', 30000000, 20000),
  line('54----', '-', 'H', 90000, 'G', 9000000, 9000),
  line('54----', 'C', 'G', 50000, 'G', 5000000, 3000),
  line('5415//', '-', 'J', 30000, 'N', 0, 2500),
  line('541511', '-', 'X', 12000, 'G', 1500000, 0),
  line('541512', '-', 'G', 9000, 'G', 1000000, 800),
].join('\r\n') + '\r\n';
const ASK = { year: 2023, industries: ['all', '54', '5415', '541511', '5416'], metrics: ['establishments', 'employees', 'annual_payroll'] };

/** A one-entry ZIP whose entry is deflated (method 8), as the Census archives are. */
async function deflatedZip(name: string, text: string): Promise<Uint8Array> {
  const raw = new TextEncoder().encode(text);
  const packed = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  const nameBytes = new TextEncoder().encode(name);
  const local = new Uint8Array(30 + nameBytes.length), central = new Uint8Array(46 + nameBytes.length), end = new Uint8Array(22);
  const lv = new DataView(local.buffer), cv = new DataView(central.buffer), ev = new DataView(end.buffer);
  const crc = crc32(raw);
  lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(8, 8, true); lv.setUint32(14, crc, true);
  lv.setUint32(18, packed.length, true); lv.setUint32(22, raw.length, true); lv.setUint16(26, nameBytes.length, true); local.set(nameBytes, 30);
  cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(10, 8, true); cv.setUint32(16, crc, true);
  cv.setUint32(20, packed.length, true); cv.setUint32(24, raw.length, true); cv.setUint16(28, nameBytes.length, true); cv.setUint32(42, 0, true);
  central.set(nameBytes, 46);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, 1, true); ev.setUint16(10, 1, true); ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length + packed.length, true);
  const out = new Uint8Array(local.length + packed.length + central.length + end.length);
  out.set(local, 0); out.set(packed, local.length); out.set(central, local.length + packed.length); out.set(end, local.length + packed.length + central.length);
  return out;
}

async function world(t: TestContext, { enabled = true } = {}) {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS); loadSchema(db); t.after(() => db.close());
  db.exec('PRAGMA foreign_keys=ON');
  if (enabled) db.exec(`UPDATE research_market_sources SET enabled=1 WHERE id='${SOURCE_ID}'`);
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const env = { ENVIRONMENT: 'development', DB: d1Over(db) } as any;
  let reply: () => Promise<Response> = async () => new Response(await deflatedZip('cbp23us.txt', FILE), { headers: { 'last-modified': MODIFIED } });
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: any) => { calls.push(String(input)); return reply(); });
  const stored = () => db.prepare('SELECT * FROM research_market_observations ORDER BY id').all() as any[];
  const runs = () => db.prepare('SELECT * FROM research_market_ingestion_runs ORDER BY id').all() as any[];
  return { db, env, calls, stored, runs, serve: (fn: () => Promise<Response>) => { reply = fn; } };
}

test('the importer is registered under its own source and asks for exactly the national file of the year', () => {
  assert.deepEqual(Object.keys(IMPORTERS), ['world-bank', 'eurostat-sbs', 'census-cbp', 'bls-ce']);
  assert.equal(IMPORTERS['census-cbp'].source_id, 'census-cbp');
  assert.equal(fileUrl(2023), 'https://www2.census.gov/programs-surveys/cbp/datasets/2023/cbp23us.zip');
  assert.equal(fileUrl(2018), 'https://www2.census.gov/programs-surveys/cbp/datasets/2018/cbp18us.zip');
});

test('a batch is one verified year, up to ten industries and known metrics; anything else is refused before any request', () => {
  assert.deepEqual(cbpParams({ year: 2023, industries: ['54'] }), { year: 2023, industries: ['54'], metrics: ['establishments', 'employees', 'annual_payroll'] });
  for (const bad of [
    { year: 2017, industries: ['54'] }, { year: LAST_VERIFIED_YEAR + 1, industries: ['54'] }, { year: '2023', industries: ['54'] },
    { year: 2023, industries: [] }, { year: 2023, industries: ['5'] }, { year: 2023, industries: ['5415//'] }, { year: 2023, industries: ['54', '54'] },
    { year: 2023, industries: Array.from({ length: 11 }, (_, i) => String(10 + i)) }, { year: 2023, industries: ['54'], metrics: ['revenue'] },
    { year: 2023, industries: ['54'], metrics: [] }, { year: 2023, industries: ['54'], size_classes: ['<5'] }, null, [],
  ]) assert.throws(() => cbpParams(bad), (e: any) => e.code === 'invalid_cbp_parameters', JSON.stringify(bad));
});

test('the migration adds one disabled census-cbp source and its three metrics, and a disabled source runs nothing', async t => {
  const w = await world(t, { enabled: false });
  const src = w.db.prepare("SELECT * FROM research_market_sources WHERE id='census-cbp'").get() as any;
  assert.equal(src.enabled, 0, 'no live activation is authorised (#7927)');
  assert.equal(src.export_allowed, null); assert.equal(src.refresh_policy, 'annual');
  assert.match(src.license_or_usage_note, /CC0 1\.0/); assert.match(src.license_or_usage_note, /not endorsed or certified by the Census Bureau/);
  const metrics = w.db.prepare("SELECT metric_key, unit FROM research_market_metrics WHERE source_id='census-cbp' ORDER BY metric_key").all() as any[];
  assert.deepEqual(metrics.map(m => [m.metric_key, m.unit]), [['cbp_annual_payroll', 'USD'], ['cbp_employees', 'persons'], ['cbp_establishments', 'establishments']]);
  await assert.rejects(ingestCensusCbp(w.env, ASK), (e: any) => e.code === 'source_disabled');
  assert.equal(w.calls.length, 0); assert.equal(w.runs().length, 0); assert.equal(w.stored().length, 0);
});

test('an import stores each asked cell with its unit, scale, classification and noise note; N and unknown flags store nothing; a re-run adds nothing', async t => {
  const w = await world(t);
  const r = await ingestCensusCbp(w.env, ASK);
  assert.deepEqual(w.calls, ['https://www2.census.gov/programs-surveys/cbp/datasets/2023/cbp23us.zip']);
  assert.equal(r.status, 'succeeded');
  assert.deepEqual(r.skipped, { not_available: 1, unknown_flag: 1, not_published: 3 });
  const rows = w.stored();
  assert.equal(rows.length, 15 - 5);
  const by = (key: string) => rows.find(x => x.source_observation_key === key);
  const est = by('cbp:us:2023:54:est'), emp = by('cbp:us:2023:54:emp'), ap = by('cbp:us:2023:54:ap'), total = by('cbp:us:2023:all:est');
  assert.deepEqual([est.value, est.unit, est.scale, est.statistical_unit, est.industry_scheme, est.industry_code, est.size_band, est.geography_code, est.period],
    [9000, 'establishments', 'units', 'establishment', 'naics_2017', '54', 'all_sizes', 'USA', '2023']);
  assert.deepEqual([ap.value, ap.unit, ap.scale, ap.currency, ap.price_basis], [9000000, 'USD', 'thousands', 'USD', 'current_prices'], 'payroll as published, in $1,000');
  assert.equal(emp.observation_status, 'unspecified');
  assert.equal(est.limitations, CBP_LIMITATIONS, 'establishments carry no noise flag');
  assert.match(emp.limitations, /noise flag H: .*2 to less than 5 percent/);
  assert.match(by('cbp:us:2023:5415:emp').limitations, /noise flag J/);
  assert.equal(by('cbp:us:2023:5415:ap'), undefined, 'N: the provider set the field to zero; nothing is stored, never 0');
  assert.equal(by('cbp:us:2023:541511:emp'), undefined, 'an undefined flag is skipped, never guessed');
  assert.equal(by('cbp:us:2023:541511:est').value, 0, 'a published zero count is stored as 0');
  assert.deepEqual([total.industry_scheme, total.industry_code, total.value], [null, null, 80000], 'the all-industries total has no code');
  assert.ok(rows.every(x => x.published_at === '2025-06-26T12:00:29.000Z' && x.vintage === '2025-06-26T12:00:29.000Z'));
  assert.ok(!rows.some(x => x.source_observation_key.includes('541512')), 'an industry not asked for is not stored');
  assert.ok(!rows.some(x => x.value === 600000), 'a legal-form row (C) is never read as all establishments');
  const again = await ingestCensusCbp(w.env, ASK);
  assert.deepEqual([again.status, again.rows_inserted, again.rows_unchanged], ['succeeded', 0, 10]);
  assert.equal(w.stored().length, 10);
});

test('a revised file adds one revision for a changed value and none for an unchanged one', async t => {
  const w = await world(t);
  await ingestCensusCbp(w.env, { year: 2023, industries: ['54'], metrics: ['establishments', 'employees'] });
  const revised = FILE.replace(line('54----', '-', 'H', 90000, 'G', 9000000, 9000), line('54----', '-', 'H', 90000, 'G', 9000000, 9100));
  w.serve(async () => new Response(await deflatedZip('cbp23us.txt', revised), { headers: { 'last-modified': REVISED } }));
  const r = await ingestCensusCbp(w.env, { year: 2023, industries: ['54'], metrics: ['establishments', 'employees'] });
  assert.deepEqual([r.rows_inserted, r.rows_unchanged], [1, 1]);
  const est = w.stored().filter(x => x.source_observation_key === 'cbp:us:2023:54:est');
  assert.deepEqual(est.map(x => x.value), [9000, 9100]);
});

test('a provider failure records a failed run with only its class and keeps every earlier row', async t => {
  const w = await world(t);
  await ingestCensusCbp(w.env, { year: 2023, industries: ['54'] });
  const kept = w.stored().length;
  for (const [reply, failure] of [
    [async () => new Response('gone', { status: 404 }), 'provider_http HTTP 404'],
    [async () => new Response('not a zip', { headers: { 'last-modified': MODIFIED } }), 'provider_payload'],
    [async () => new Response(await deflatedZip('cbp22us.txt', FILE)), 'provider_payload'],
    [async () => new Response(await deflatedZip('cbp23us.txt', '"naics","lfo","est"\r\n"54----","-",9000\r\n')), 'provider_payload'],
    [async () => new Response(await deflatedZip('cbp23us.txt', FILE.replace(',9000\r\n', ',9e3\r\n'))), 'provider_payload'],
    [async () => new Response('x', { headers: { 'content-length': String(5_000_000) } }), 'provider_payload HTTP 200'],
  ] as const) {
    w.serve(reply);
    const r = await ingestCensusCbp(w.env, { year: 2023, industries: ['54'] });
    assert.deepEqual([r.status, r.failure, r.rows_inserted, r.skipped], ['failed', failure, 0, { not_available: 0, unknown_flag: 0, not_published: 0 }]);
  }
  assert.equal(w.stored().length, kept, 'last good values are kept');
});

test('flags and industry codes read as the record layout defines them', () => {
  assert.deepEqual(cbpFlag(null), { note: null });
  for (const f of ['G', 'H', 'J']) assert.match((cbpFlag(f) as any).note, new RegExp(`noise flag ${f}`));
  assert.equal(cbpFlag('N'), 'not_available');
  for (const f of ['', 'g', 'D', 'S', 'X']) assert.equal(cbpFlag(f), 'unknown_flag', f);
  assert.deepEqual(['------', '54----', '541///', '5415//', '54151/', '541511'].map(cbpIndustry), ['all', '54', '541', '5415', '54151', '541511']);
  for (const bad of ['54', '54-1--', 'ab----', '5415///', '------x']) assert.equal(cbpIndustry(bad), null, bad);
});

test('a duplicated industry row or a short line fails the batch instead of picking one', async () => {
  const skipped = { not_available: 0, unknown_flag: 0, not_published: 0 };
  const p = cbpParams({ year: 2023, industries: ['54'] });
  await assert.rejects(cbpRows(FILE + line('54----', '-', 'G', 1, 'G', 1, 1) + '\r\n', p, null, skipped), (e: any) => e.kind === 'provider_payload');
  await assert.rejects(cbpRows(FILE + '"98","54----","-"\r\n', p, null, skipped), (e: any) => e.kind === 'provider_payload');
  const noDate = await cbpRows(FILE, p, null, skipped);
  assert.ok(noDate.rows.every(r => r.published_at === null && /^content-sha256:[0-9a-f]{64}$/.test(r.vintage)), 'no Last-Modified: a content vintage');
});

test('the ZIP reader returns a stored or deflated entry and refuses a missing, ambiguous, oversized or corrupted one', async () => {
  const stored = buildZip([{ name: 'cbp23us.txt', content: FILE }]);
  assert.equal(new TextDecoder().decode((await readZipEntry(stored, /^cbp23us\.txt$/, 1e6)).bytes), FILE);
  const deflated = await deflatedZip('cbp23us.txt', FILE);
  assert.ok(deflated.length < stored.length, 'the deflated fixture really is compressed');
  assert.equal(new TextDecoder().decode((await readZipEntry(deflated, /^cbp23us\.txt$/i, 1e6)).bytes), FILE);
  const reason = async (bytes: Uint8Array, re = /^cbp23us\.txt$/, max = 1e6) =>
    readZipEntry(bytes, re, max).then(() => 'read', (e: any) => (e instanceof ZipReadError ? e.message : 'other'));
  assert.equal(await reason(new TextEncoder().encode('not a zip at all, just text')), 'not_a_zip');
  assert.equal(await reason(stored, /^cbp22us\.txt$/), 'entry_missing');
  assert.equal(await reason(buildZip([{ name: 'cbp23us.txt', content: 'a' }, { name: 'CBP23US.TXT', content: 'b' }]), /^cbp23us\.txt$/i), 'ambiguous_entry');
  assert.equal(await reason(stored, /^cbp23us\.txt$/, 10), 'entry_too_large');
  assert.equal(await reason(deflated, /^cbp23us\.txt$/, 10), 'entry_too_large');
  // An archive that under-declares its entry's size is still stopped while inflating, not after.
  const lying = deflated.slice(), lv = new DataView(lying.buffer), cd = lv.getUint32(lying.length - 6, true);
  lv.setUint32(cd + 24, 10, true);
  assert.equal(await reason(lying, /^cbp23us\.txt$/, 20), 'entry_too_large');
  const flipped = stored.slice(); flipped[60] ^= 0xff;
  assert.equal(await reason(flipped), 'checksum_mismatch');
});
