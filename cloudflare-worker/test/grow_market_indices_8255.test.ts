/**
 * D8255 (#8255, Grow Markets) — the WGI and FATF indices on a market's record.
 *
 *   1  A country with WGI values shows them with the edition and its published day; a measured 0 is a value; the
 *      newest edition imported under the licence recorded now is the one read (a later one under another is not).
 *   2  FATF has no recorded licence, so it reads Not recorded with that reason even where a stored edition exists.
 *   3  A country the edition holds no figure for, and a market with no country, are Not recorded, never 0.
 *   4  A list source's edition that does not name the country says "not named" (checked with the EU list, whose
 *      licence is recorded).
 *   5  A failed read is `unreadable` for that source and for the read, never an empty value.
 *
 * Mutation checked (each broke a test below, then was restored): the licence match dropped from the edition query (1);
 *   the `licence === null` early return dropped (2); a missing figure returned as an empty ok line (3); the not-named
 *   branch returning not_recorded (4); a failed read swallowed into not_recorded (5).
 *
 * Every name and value is made up. The database is the baseline plus every migration, in memory.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/grow_market_indices_8255.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import cycleGrow from '../src/routes/cycle_grow.ts';
import { createCycleRecords } from '../src/routes/cycle_records.ts';
import { countryIndexLines, INDEX_SOURCES } from '../src/services/ventureScoring/countryIndex.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = ['fixture', 'key', 'for', 'market', 'indices', '8255'].join('-');
const FOUNDER = 10;
const A = 1;
const WGI = INDEX_SOURCES.wgi.licence as string;
const EU = INDEX_SOURCES.eu_high_risk.licence as string;

function edition(db: DatabaseSync, source: string, ed: string, licence: string, published: string, values: Array<[string, string, number]>) {
  db.prepare(`INSERT INTO country_index_editions (source, edition, licence, licence_decision, published_on, citation_url, value_count, imported_by, imported_at)
    VALUES (?, ?, ?, 'D1259', ?, 'https://example.test', ?, 1, '2026-01-01T00:00:00Z')`).run(source, ed, licence, published, values.length);
  for (const [country, indicator, value] of values) {
    db.prepare('INSERT INTO country_index_values (source, edition, licence, country, indicator, value, as_of) VALUES (?, ?, ?, ?, ?, ?, ?)').run(source, ed, licence, country, indicator, value, published);
  }
}

function fixture(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec('PRAGMA foreign_keys = ON');
  db.prepare('INSERT INTO founders (id, name, email) VALUES (?, ?, ?)').run(FOUNDER, 'Ana Wren', 'f10@example.test');
  db.prepare('INSERT INTO users (id, role, name, email, founder_id, is_active) VALUES (?, ?, ?, ?, ?, 1)').run(FOUNDER, 'founder', 'Ana Wren', 'u10@example.test', FOUNDER);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${A}, 'Harbour Lantern', ${FOUNDER})`);
  db.exec(`INSERT OR IGNORE INTO research_countries (code, name, region) VALUES ('PT', 'Portugal', 'Europe'), ('ES', 'Spain', 'Europe'), ('CL', 'Chile', 'Americas')`);
  db.exec(`INSERT INTO markets (id, uid, project_id, name, state, geography_ref, created_by) VALUES
    (1, 'mkp', ${A}, 'Portugal', 'considering', 'PT', ${FOUNDER}), (2, 'mks', ${A}, 'Spain', 'considering', 'ES', ${FOUNDER}),
    (4, 'mkn', ${A}, 'Nowhere', 'considering', NULL, ${FOUNDER})`);
  edition(db, 'wgi', '2023', WGI, '2024-09-30', [['PT', 'GE.PER.RNK', 70]]);
  edition(db, 'wgi', '2024', WGI, '2025-09-30', [['PT', 'GE.PER.RNK', 74.5], ['PT', 'RL.PER.RNK', 0], ['CL', 'GE.PER.RNK', 60]]);
  edition(db, 'wgi', '2025', 'Superseded licence', '2026-09-30', [['PT', 'GE.PER.RNK', 99]]);
  edition(db, 'fatf', 'Oct 2026', 'Unrecorded licence', '2026-10-24', [['PT', 'call_for_action', 100]]);
  return db;
}

const app = new Hono<any>();
app.route('/api/cycles/grow', cycleGrow);
app.route('/api/cycles', createCycleRecords());
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

async function rec(db: DatabaseSync, uid: string) {
  const token = await new SignJWT({ user_id: FOUNDER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await withThrownResponses(() => app.request(`/api/cycles/grow/modules/market-expansion/records/${uid}?project=${A}`,
      { headers: { Authorization: `Bearer ${token}` } }, { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' } as any));
    assert.equal(res.status, 200);
    return ((await res.json()) as any).parts.market.indices as Awaited<ReturnType<typeof countryIndexLines>>;
  } finally { [console.warn, console.error] = saved; }
}
const line = (r: Awaited<ReturnType<typeof rec>>, key: string) => r.lines.find((l) => l.key === key)!;

test('1: WGI values come with their edition and day; a measured 0 is a value; only the licence recorded now is read', async () => {
  const db = fixture();
  const w = line(await rec(db, 'mkp'), 'wgi');
  assert.equal(w.state, 'ok');
  assert.deepEqual([w.edition, w.as_of, w.licence], ['2024', '2025-09-30', WGI], 'the 2025 edition was imported under another licence');
  assert.deepEqual(w.values.map((v) => [v.indicator, v.value]), [['GE.PER.RNK', 74.5], ['RL.PER.RNK', 0]]);
  assert.match(w.values[0].label, /Government effectiveness/);
  assert.equal(w.citation_url, INDEX_SOURCES.wgi.citation_url);
});

test('2: FATF has no recorded licence, so it is Not recorded with that reason though an edition is stored', async () => {
  const db = fixture();
  const f = line(await rec(db, 'mkp'), 'fatf');
  assert.equal(f.state, 'not_recorded');
  assert.deepEqual(f.values, []);
  assert.match(f.reason ?? '', /no recorded licence/);
});

test('3: no figure for the country, and no country at all, are Not recorded, never 0', async () => {
  const db = fixture();
  const es = line(await rec(db, 'mks'), 'wgi');
  assert.equal(es.state, 'not_recorded'); assert.deepEqual(es.values, []); assert.equal(es.edition, '2024');
  const none = line(await rec(db, 'mkn'), 'wgi');
  assert.equal(none.state, 'not_recorded'); assert.match(none.reason ?? '', /No country is attached/);
  const empty = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true }); loadSchema(empty);
  assert.match(line(await countryIndexLines({ DB: d1Over(empty) } as any, 'PT'), 'wgi').reason ?? '', /No World Bank edition is imported/);
});

test('4: a list edition that does not name the country says so; one that names it shows the list', async () => {
  const db = fixture();
  edition(db, 'eu_high_risk', '2026-1', EU, '2026-06-01', [['CL', 'listed', 100]]);
  const read = (code: string) => countryIndexLines({ DB: d1Over(db) } as any, code, ['eu_high_risk']).then((r) => r.lines[0]);
  const pt = await read('PT');
  assert.deepEqual([pt.state, pt.edition, pt.as_of, pt.values], ['not_named', '2026-1', '2026-06-01', []]);
  const cl = await read('CL');
  assert.deepEqual([cl.state, cl.values.map((v) => v.indicator)], ['ok', ['listed']]);
});

test('5: a failed read is unreadable for that source and for the read, never a value', async () => {
  const db = fixture();
  db.exec('DROP TABLE country_index_values');
  const r = await rec(db, 'mkp');
  assert.equal(r.state, 'unreadable');
  const w = line(r, 'wgi');
  assert.equal(w.state, 'unreadable'); assert.deepEqual(w.values, []);
  assert.equal(line(r, 'fatf').state, 'not_recorded', 'FATF is not read at all, so its line does not fail');
});
