/**
 * D1111 (#2991, part of #2434) — the Worker side of the Pitch deck gaps S1's
 * check confirmed on D894:
 *
 *   1. the records say "Used up" (D894 decision: "Part 1 puts used up in the
 *      records"), by the engagement read's own rule (D895, deckShareUse.ts);
 *   2. time on deck is served in the seconds the viewer reported, never
 *      rounded to whole minutes, and none reported is not "0 min";
 *   3. the HTML file's Sources appendix lists the figures a card is bound to
 *      (D896's bindings, as D897's New deck writes them).
 *
 * The database is the baseline plus every numbered migration above the
 * cutoff, schema only, as cycle_records_raise_d691.test.ts builds one. Every
 * person, venture and figure is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/pitch_deck_gaps_d1111.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import cycleRaise from '../src/routes/cycle_raise.ts';
import { createCycleRecords } from '../src/routes/cycle_records.ts';
import { timeOnDeck } from '../src/services/raiseCycle.ts';
import { deckShareMetrics, LEGACY_SHARE_NO_VIEW_LIMIT } from '../src/services/deckShareUse.ts';
import { deckShareMetrics as fromDecks } from '../src/routes/decks.ts';
import { NO_SOURCES, SOURCE_NOT_ON_STUDIOOS, sourceLines, writeOfflineDeck } from '../src/services/decks/offlineHtml.ts';
import { cardOf } from '../src/services/decks/newDeck.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import '../src/services/records/raise.ts';

const JWT_SECRET = 'unit-test-jwt-secret-d1111-0123456789-abcdef';
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIGRATIONS = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
const FOUNDER = 10;
const P = 1;

const FILES = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations);
const BUILT_DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE);
  for (const f of FILES.filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();

/**
 * One venture, two deck versions, and its links:
 *   71 live (a cap of 5, 2 views, 125 s read);
 *   72 used up by `used_at` alone (the claim set it; no cap);
 *   73 used up by its cap (3 of 3), on the older version;
 *   74 the old "unlimited" sentinel, opened 9 times: live;
 *   75 no cap at all (NULL), opened, no read time reported;
 *   76 withdrawn after it was used up: Revoked wins;
 *   77 expired with a view left.
 */
function seeded() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)').run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Kestrel Labs', 1001)`);
  db.exec(`INSERT INTO pitch_decks (id, project_id, version, slides, is_current) VALUES (5, ${P}, 2, '[]', 1), (4, ${P}, 1, '[]', 0)`);
  db.exec(`INSERT INTO pitch_deck_share_tokens (id, deck_id, token_hash, expires_at, revoked_at, used_at, view_limit, view_count, last_viewed_at, created_at, investor_label) VALUES
    (71, 5, 'h71', '2999-01-01 00:00:00', NULL, NULL, 5, 2, '2026-10-20 10:00:00', '2026-10-01 10:00:00', 'Fund Live'),
    (72, 5, 'h72', '2999-01-01 00:00:00', NULL, '2026-10-19 10:00:00', NULL, 1, '2026-10-19 10:00:00', '2026-10-02 10:00:00', 'Fund Claimed'),
    (73, 4, 'h73', '2999-01-01 00:00:00', NULL, NULL, 3, 3, '2026-10-18 10:00:00', '2026-10-03 10:00:00', 'Fund Capped'),
    (74, 5, 'h74', '2999-01-01 00:00:00', NULL, NULL, ${LEGACY_SHARE_NO_VIEW_LIMIT}, 9, '2026-10-17 10:00:00', '2026-10-04 10:00:00', 'Fund Legacy'),
    (75, 5, 'h75', '2999-01-01 00:00:00', NULL, NULL, NULL, 1, '2026-10-16 10:00:00', '2026-10-05 10:00:00', 'Fund Uncapped'),
    (76, 5, 'h76', '2999-01-01 00:00:00', '2026-10-21 10:00:00', '2026-10-15 10:00:00', 1, 1, '2026-10-15 10:00:00', '2026-10-06 10:00:00', 'Fund Withdrawn'),
    (77, 5, 'h77', '2026-01-01 00:00:00', NULL, NULL, 5, 1, '2025-12-20 10:00:00', '2025-12-01 10:00:00', 'Fund Expired')`);
  db.exec(`INSERT INTO deck_share_views (id, deck_id, share_token_id, read_seconds, created_at) VALUES
    (1, 5, 71, 66, '2026-10-12 10:00:00'), (2, 5, 71, 59, '2026-10-13 10:00:00'),
    (3, 5, 75, 0, '2026-10-16 10:00:00'), (4, 4, 73, 30, '2026-10-18 10:00:00')`);
  return db;
}

const app = new Hono<any>();
app.route('/api/cycles/raise', cycleRaise);
app.route('/api/cycles', createCycleRecords());
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

async function get(db: DatabaseSync, path: string) {
  const token = await new SignJWT({ user_id: FOUNDER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await app.request(path, { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}
const list = (db: DatabaseSync, qs = '') => get(db, `/api/cycles/raise/modules/pitch-deck?project=${P}&sort=newest${qs}`);
const record = (db: DatabaseSync, id: number) => get(db, `/api/cycles/raise/modules/pitch-deck/records/${id}?project=${P}`);
const byId = (rows: any[]) => Object.fromEntries(rows.map((r) => [Number(r.id), r.cells]));

test('1. the records say Used up, for every version\'s links, by the engagement read\'s own rule', async () => {
  // Mutation checked: `used_at` dropped from the rule → 72 reads live; the sentinel read as a cap → 74 reads Used up;
  // `count >= limit` as `>` → 73 reads live; the used-up branch before revoked → 76 reads Used up.
  const db = seeded();
  const r = await list(db);
  assert.equal(r.status, 200);
  const cells = byId(r.body.records.rows);
  assert.deepEqual(Object.fromEntries(Object.entries(cells).map(([id, c]: any) => [id, c.expires])), {
    71: { text: '2999-01-01', tone: 'ok' },
    72: { text: 'Used up', tone: 'muted' },
    73: { text: 'Used up', tone: 'muted' },
    74: { text: '2999-01-01', tone: 'ok' },
    75: { text: '2999-01-01', tone: 'ok' },
    76: { text: 'Revoked', tone: 'muted' },
    77: { text: 'Expired', tone: 'muted' },
  });
  // The filter offers it, and keeps only those links.
  const state = r.body.records.filters.find((f: any) => f.key === 'status');
  assert.deepEqual(state.options.map((o: any) => o.value), ['active', 'used_up', 'expired', 'revoked']);
  const used = await list(db, '&filter=status:used_up');
  assert.deepEqual(used.body.records.rows.map((x: any) => Number(x.id)).sort(), [72, 73]);
  const active = await list(db, '&filter=status:active');
  assert.deepEqual(active.body.records.rows.map((x: any) => Number(x.id)).sort(), [71, 74, 75], 'a used-up link is filtered as active');
  // One rule: the engagement read's helper is the same function.
  assert.equal(fromDecks, deckShareMetrics);
});

test('2. a link\'s own record says Used up in its pill', async () => {
  // Mutation checked: the record page left on the old three states → 73 reads Active.
  const db = seeded();
  assert.deepEqual((await record(db, 73)).body.pills, [{ text: 'Used up', tone: 'grey' }]);
  assert.deepEqual((await record(db, 72)).body.pills, [{ text: 'Used up', tone: 'grey' }]);
  assert.deepEqual((await record(db, 71)).body.pills, [{ text: 'Active', tone: 'ok' }]);
  assert.deepEqual((await record(db, 76)).body.pills, [{ text: 'Revoked', tone: 'bad' }], 'withdrawn wins over used up');
});

test('3. time on deck is served in seconds: m:ss and the seconds themselves, never "0 min"', async () => {
  // Mutation checked: back to Math.round(seconds / 60) → 71 reads "2 min"; 0 seconds served as 0:00 → 75 is not null;
  // the per-view line rounded → the views section fails.
  const db = seeded();
  const cells = byId((await list(db)).body.records.rows);
  assert.deepEqual(cells[71].time, { text: '2:05', seconds: 125 }, 'two views, 66 s and 59 s');
  assert.deepEqual(cells[73].time, { text: '0:30', seconds: 30 }, 'a link on the older version keeps its seconds');
  assert.equal(cells[75].time, null, 'an opened link that reported no read time is Not recorded, not 0');
  assert.equal(cells[72].time, null, 'a link nobody read for a second');
  const one = (await record(db, 71)).body;
  assert.deepEqual(one.facts.find((f: any) => f.label === 'Time on deck').value, '2:05');
  const views = one.main.find((x: any) => x.key === 'views').rows.map((v: any) => v.b);
  assert.deepEqual(views, ['0:59', '1:06']);
  const none = (await record(db, 75)).body;
  const fact = none.facts.find((f: any) => f.label === 'Time on deck');
  assert.equal(fact.value, null);
  assert.equal(fact.reason, 'No read time recorded');
  assert.deepEqual(none.main.find((x: any) => x.key === 'views').rows.map((v: any) => v.b), ['No read time recorded']);
  // The helper itself.
  assert.deepEqual([timeOnDeck(0), timeOnDeck(null), timeOnDeck('x'), timeOnDeck(-4)], [null, null, null, null]);
  assert.deepEqual(timeOnDeck(3600), { text: '60:00', seconds: 3600 });
  assert.deepEqual(timeOnDeck(29), { text: '0:29', seconds: 29 }, 'under half a minute is not rounded away');
});

// ---------------------------------------------------------------- 3. Sources

const item = (key: string, label: string, module: string, extra: Record<string, unknown> = {}) => ({
  source_key: key, area: key.split('.')[0], module, label, unit: 'count', href: '/x', value: null, as_of: null,
  grade: 'Not recorded', source: null, record_ref: null, snapshot_hash: null, state: 'not_recorded', ...extra,
});
const ITEMS: any[] = [
  item('validate.interviews', 'Interviews', 'Validate › Customer research',
    { value: 14, as_of: '2026-10-12', grade: 'Measured', source: 'Recorded', record_ref: 'interviews:14', snapshot_hash: 'a'.repeat(24), state: 'recorded' }),
  item('validate.strong_fit', 'Strong fit', 'Validate › Customer research'),
];

test('4. the HTML Sources appendix lists each bound figure: card, figure, module, grade and day', async () => {
  // Mutation checked: the appendix left on NO_SOURCES → the list check fails; no de-duplication → Interviews is listed twice;
  // a Not recorded binding drawn with a grade → the gap line fails.
  const card = cardOf({ card: 'validation', title: 'Validation', purpose: '' }, ITEMS, { headline: 'Customers told us', body: null }, 'Kestrel Labs');
  const slides = [{ title: 'Kestrel Labs', fields: [{ key: 't', kind: 'title', value: 'Kestrel Labs' }] }, card];
  assert.deepEqual(sourceLines(slides), [
    { card: 2, title: 'Validation', figure: 'Interviews', line: 'Validate › Customer research · Measured · as of 2026-10-12' },
    { card: 2, title: 'Validation', figure: 'Strong fit', line: SOURCE_NOT_ON_STUDIOOS },
    { card: 2, title: 'Validation', figure: 'Letters of intent', line: SOURCE_NOT_ON_STUDIOOS },
    { card: 2, title: 'Validation', figure: 'Claims validated', line: SOURCE_NOT_ON_STUDIOOS },
  ], 'each slot the card shows, once, the ones nothing filled included');
  const html = await writeOfflineDeck({ title: 'Seed', version: 2, slides, images: new Map(), footer: null, watermark: null, notes: false, sources: true });
  const appendix = html.slice(html.indexOf('id="sources"'));
  assert.ok(!appendix.includes(NO_SOURCES), 'a version with bound figures says it records no source');
  assert.ok(appendix.includes('<dt>Card 2 (Validation) · Interviews</dt><dd>Validate › Customer research · Measured · as of 2026-10-12</dd>'));
  assert.ok(appendix.includes(`<dt>Card 2 (Validation) · Strong fit</dt><dd>${SOURCE_NOT_ON_STUDIOOS}</dd>`));
  assert.ok(appendix.includes('Written with AI help: card 2 (Validation).'), 'the AI line stays');
  // A binding the slots do not name is still listed, by its key; a date not recorded says so.
  assert.deepEqual(sourceLines([{ title: 'X', blocks: [{ kind: 'metric', binding: { source_key: 'grow.gone', grade: 'Stated' } }] }]),
    [{ card: 1, title: 'X', figure: 'grow.gone', line: 'StudioOS · Stated · date not recorded' }]);
  // A version with no binding keeps the sentence.
  const bare = await writeOfflineDeck({ title: 'Old', version: 1, slides: [{ title: 'Problem', body: 'Words' }], images: new Map(), footer: null, watermark: null, notes: false, sources: true });
  assert.ok(bare.includes(`<p>${NO_SOURCES}</p>`));
  // Titles and keys are escaped.
  assert.ok(!(await writeOfflineDeck({ title: 'T', version: 1, slides: [{ title: '<b>x</b>', binding: { source_key: 'grow.mrr', grade: 'Measured' } }], images: new Map(), footer: null, watermark: null, notes: false, sources: true })).includes('<b>x</b>'));
});
