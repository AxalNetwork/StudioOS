/**
 * D1538 (#3787, deck v2 B11) — typed figures, the table block, the
 * market_circles and projection charts, and the one-click rules.
 *
 *  · `/api/decks/:id/typed-values`: read by whoever reads the deck, written
 *    by whoever writes it, never by a support session; every value Stated,
 *    "Typed by <name>"; a key nobody typed is absent, never 0;
 *  · the `table` block: 8 × 12, text, binding or check cells;
 *  · `chartTypeFor`: TAM/SAM/SOM that nest → market circles, a month past
 *    today → projection, from the data alone (fixtures);
 *  · every Worker export writes a table's rows;
 *  · a typed number is counted by the evidence check.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_typed_values_d1538.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import typedRoutes from '../src/routes/deck_typed_values.ts';
import { CHART_TYPES, LIBRARY_CHART_TYPES, bindingOf, TABLE_COLS, TABLE_ROWS, TYPED_CHART_TYPES, modelProblems, sanitizeModel, tableLines } from '../src/services/decks/slideModel.ts';
import { chartTypeFor, marketShape } from '../src/services/decks/visuals.ts';
import { fitProblems, TABLE_ROWS_PER_GRID_ROW } from '../src/services/decks/designSystem.ts';
import { writeOfflineDeck } from '../src/services/decks/offlineHtml.ts';
import { blockParas } from '../src/services/decks/odp.ts';
import { blockParagraphs } from '../src/services/decks/pptxEditable.ts';
import { cardText, deck } from '../src/services/raiseClaims.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

const url = (u: string | null | undefined) => (typeof u === 'string' && u.startsWith('https://') ? u : null);
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
const BASELINE_SQL = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIGRATIONS = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
const BUILT_DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE_SQL);
  for (const f of readdirSync(MIGRATIONS).filter((n) => /^\d+_.*\.sql$/.test(n)).sort(compareMigrations).filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();
const FOUNDER = 10, OTHER = 20, P = 1, Q = 2;

function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  const add = db.prepare('INSERT INTO users (id, role, name, display_name, email, is_active, founder_id) VALUES (?, ?, ?, ?, ?, 1, ?)');
  add.run(FOUNDER, 'founder', 'Fay Founder', 'Avery Stone', 'fay@example.test', 1001);
  add.run(OTHER, 'founder', 'Oz Other', null, 'oz@example.test', 1002);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Kestrel Labs', 1001), (${Q}, 'Other Co', 1002)`);
  const ins = db.prepare('INSERT INTO pitch_decks (id, project_id, version, title, slides, is_current) VALUES (?, ?, ?, ?, ?, ?)');
  ins.run(1, P, 1, 'Seed v1', '[]', 0);
  ins.run(2, P, 2, 'Seed v2', '[]', 1);
  ins.run(3, Q, 1, 'Other deck', '[]', 1);
  return db;
}

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown, extra: Record<string, unknown> = {}) {
  const app = new Hono<any>();
  app.route('/api/decks', typedRoutes);
  const token = await new SignJWT({ user_id: who, role: 'founder', ...extra }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await withThrownResponses(() => app.request(path, {
    method, headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any));
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

// 1 ───────────────────────────────────────────────────────────────────────────
test('typed values: Stated and "Typed by", shared by every version, absent until typed, never 0', async () => {
  // Mutations checked: the grade not Stated → the grade assert fails; keyed by deck_id instead of the venture →
  // v1 reads nothing; value_num ?? 0 for a text figure → the text figure reads 0.
  const db = world();
  let r = await call(db, FOUNDER, 'GET', '/api/decks/2/typed-values');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { deck_id: 2, values: [] }, 'nothing typed is absent, never a 0');

  r = await call(db, FOUNDER, 'PUT', '/api/decks/2/typed-values/customers', { label: 'Customers', value: 42, unit: 'count' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.value.value, 42);
  assert.equal(r.body.value.grade, 'Stated');
  assert.deepEqual(r.body.value.typed_by, { id: FOUNDER, name: 'Avery Stone' }, 'the display name, as pd24 draws "Typed by [Avery Stone]"');
  r = await call(db, FOUNDER, 'PUT', '/api/decks/2/typed-values/market_note', { label: 'Market', value: 'Mid-market fintech', unit: 'text' });
  assert.equal(r.body.value.value, 'Mid-market fintech');

  r = await call(db, FOUNDER, 'GET', '/api/decks/1/typed-values');
  assert.deepEqual(r.body.values.map((v: any) => [v.key, v.value, v.unit, v.grade]), [['customers', 42, 'count', 'Stated'], ['market_note', 'Mid-market fintech', 'text', 'Stated']],
    'a typed figure is the venture\'s: the older version reads it too');

  r = await call(db, FOUNDER, 'PUT', '/api/decks/2/typed-values/customers', { label: 'Customers', value: '45', unit: 'count' });
  assert.equal(r.body.value.value, 45, 'a second PUT replaces the figure');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM deck_typed_values').get()!.n, 2);

  r = await call(db, FOUNDER, 'DELETE', '/api/decks/2/typed-values/customers');
  assert.deepEqual(r.body, { deleted: true });
  r = await call(db, FOUNDER, 'DELETE', '/api/decks/2/typed-values/customers');
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'not_found');
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('typed values: another venture cannot read or write; a support session cannot type; bad input is refused in words', async () => {
  // Mutations checked: projectOwned without { write: true } on PUT → still 403 for OTHER (read is owner-only too), so the
  // support-session check is the write guard asserted; the support-session check removed → 200 instead of 403.
  const db = world();
  assert.equal((await call(db, OTHER, 'GET', '/api/decks/2/typed-values')).status, 403);
  assert.equal((await call(db, OTHER, 'PUT', '/api/decks/2/typed-values/x', { label: 'X', value: 1, unit: 'count' })).status, 403);
  assert.equal((await call(db, OTHER, 'DELETE', '/api/decks/2/typed-values/x')).status, 403);
  assert.equal((await call(db, FOUNDER, 'GET', '/api/decks/99/typed-values')).status, 404);
  const support = await call(db, FOUNDER, 'PUT', '/api/decks/2/typed-values/x', { label: 'X', value: 1, unit: 'count' }, { impersonated_by: 1 });
  assert.equal(support.status, 403);
  assert.equal(support.body.error, 'support_session_refused');
  const bad: Array<[string, unknown, string]> = [
    ['/api/decks/2/typed-values/Bad-Key', { label: 'X', value: 1, unit: 'count' }, 'invalid_key'],
    ['/api/decks/2/typed-values/x', { label: '', value: 1, unit: 'count' }, 'label_required'],
    ['/api/decks/2/typed-values/x', { label: 'X', value: 1, unit: 'euros' }, 'invalid_unit'],
    ['/api/decks/2/typed-values/x', { label: 'X', value: 'lots', unit: 'count' }, 'invalid_value'],
    ['/api/decks/2/typed-values/x', { label: 'X', value: '', unit: 'text' }, 'value_required'],
    ['/api/decks/2/typed-values/x', { label: 'X', value: 5000, unit: 'percent' }, 'invalid_value'],
  ];
  for (const [path, body, code] of bad) {
    const r = await call(db, FOUNDER, 'PUT', path, body);
    assert.equal(r.status, 400, `${code} ${JSON.stringify(r.body)}`);
    assert.equal(r.body.error, code);
    assert.ok(typeof r.body.message === 'string' && r.body.message.length > 5);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM deck_typed_values').get()!.n, 0, 'nothing refused was written');
  const src = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/deck_typed_values.ts'), 'utf8');
  assert.doesNotMatch(src, /prepare\(\s*`[^`]*\$\{/, 'every statement is a bound literal');
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('the table block: up to 8 × 12, text, binding or check cells; squared rows; no block binding', () => {
  // Mutations checked: TABLE_COLS 9 → the width assert fails; a binding cell kept as text → the binding assert fails;
  // the empty-table null removed → the "no cell" problem disappears.
  assert.equal(TABLE_COLS, 8);
  assert.equal(TABLE_ROWS, 12);
  const binding = bindingOf({ source_key: 'grow.mrr', record_ref: 'project_metrics:1', as_of: '2026-10-01', grade: 'Measured', snapshot_hash: 'a'.repeat(64) });
  assert.ok(binding, 'a D896 binding');
  const rows = Array.from({ length: 14 }, (_, r) => Array.from({ length: 10 }, (_, c) => ({ text: `r${r}c${c}` })));
  rows[1][1] = { binding } as any;
  rows[1][2] = { check: true } as any;
  rows[2] = [{ text: 'short' }] as any;
  const out: any = sanitizeModel({ blocks: [{ id: 't', kind: 'table', grid: { c1: 1, c2: 12, r1: 2, r2: 6 }, rows, binding }] }, url);
  const t = out.blocks[0];
  assert.equal(t.kind, 'table');
  assert.equal(t.rows.length, 12);
  assert.ok(t.rows.every((r: any[]) => r.length === 8), 'every row squared to the widest, at most 8');
  assert.deepEqual(t.rows[1][1], { binding });
  assert.deepEqual(t.rows[1][2], { check: true });
  assert.deepEqual(t.rows[2].slice(0, 2), [{ text: 'short' }, { text: '' }], 'a short row is padded with empty cells, never 0');
  assert.equal(t.header, true);
  assert.equal(t.binding, undefined, 'a table binds per cell, never as a block');
  assert.deepEqual(modelProblems([{ blocks: [{ kind: 'table', grid: { c1: 1, c2: 6, r1: 1, r2: 2 }, rows: [] }] }], url), ['Card 1, block 1: a table needs at least one row and one cell.']);
  assert.deepEqual(modelProblems([{ blocks: [{ kind: 'table', grid: { c1: 1, c2: 6, r1: 1, r2: 2 }, rows }] }], url), ['Card 1, block 1: a table holds at most 8 columns and 12 rows.']);
  assert.deepEqual(tableLines({ rows: [[{ text: 'Plan' }, { text: 'Price' }], [{ text: 'Pro' }, { check: false }], [{ text: '' }, { text: '' }]] }), ['Plan · Price', 'Pro · ✗'], 'an empty row is not a line');
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('one-click chart rules: nested TAM/SAM/SOM is market circles, a month past today is a projection, from the data alone', () => {
  // Mutations checked: the SOM ≤ SAM ≤ TAM check dropped → the out-of-order fixture reads as circles; the projection
  // rule after the line rule → a 12-point forecast reads as a line; today's month counted as future → the current month projects.
  const today = '2026-11-01';
  const rec = (points: Array<{ x: string; y: number }>, extra: Record<string, unknown> = {}) => ({ state: 'recorded', points, cadence: 'monthly', unit: 'usd', ...extra }) as any;
  const market = [{ x: 'TAM', y: 40e9 }, { x: 'SAM', y: 6e9 }, { x: 'SOM', y: 120e6 }];
  assert.equal(chartTypeFor(rec(market), today), 'market_circles');
  assert.deepEqual(marketShape(market), { tam: 40e9, sam: 6e9, som: 120e6 });
  assert.equal(marketShape([{ x: 'TAM', y: 1e6 }, { x: 'SAM', y: 6e9 }, { x: 'SOM', y: 1 }]), null, 'a SAM larger than its TAM does not nest');
  assert.notEqual(chartTypeFor(rec([{ x: 'TAM', y: 1e6 }, { x: 'SAM', y: 6e9 }, { x: 'SOM', y: 1 }]), today), 'market_circles');
  assert.equal(marketShape([{ x: 'TAM', y: 3 }, { x: 'TAM', y: 2 }, { x: 'SOM', y: 1 }]), null, 'a part named twice is not a market');
  assert.equal(marketShape([{ x: 'TAM', y: 3 }, { x: 'SAM', y: 0 }, { x: 'SOM', y: 0 }]), null, 'a zero part is not drawn as a circle');
  const months = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ x: `2026-${String(from + i).padStart(2, '0')}`, y: 1000 * (i + 1) }));
  assert.equal(chartTypeFor(rec(months(1, 12)), today), 'projection', 'January to December 2026 reaches past November');
  assert.equal(chartTypeFor(rec(months(1, 11)), today), 'line', 'up to this month is a result, not a projection');
  assert.equal(chartTypeFor(rec(months(9, 3)), today), 'columns');
  assert.equal(chartTypeFor(rec(months(1, 1)), today), null);
  assert.equal(chartTypeFor(rec(market, { state: 'not_recorded' }), today), null);
  assert.deepEqual([...TYPED_CHART_TYPES], ['market_circles', 'projection']);
  assert.ok(TYPED_CHART_TYPES.every((t) => (CHART_TYPES as readonly string[]).includes(t)));
  assert.equal(LIBRARY_CHART_TYPES.length, 12, 'the library keeps pd6\'s twelve tiles');
  const kept: any = sanitizeModel({ blocks: [{ kind: 'chart', grid: { c1: 1, c2: 8, r1: 2, r2: 6 }, chart_type: 'market_circles', series: [{ label: 'Market', points: market }] }] }, url);
  assert.equal(kept.blocks[0].chart_type, 'market_circles', 'the type is stored, not reset to line');
});

// 5 ───────────────────────────────────────────────────────────────────────────
test('every Worker export writes a table\'s rows, and names the two chart types', async () => {
  // Mutations checked: the table case removed from each writer → that writer's assert fails.
  const table = { id: 't', kind: 'table', grid: { c1: 1, c2: 12, r1: 2, r2: 5 }, header: true, rows: [[{ text: 'Plan' }, { text: 'Seats' }], [{ text: 'Pro' }, { text: '40' }]] };
  const html = await writeOfflineDeck({ title: 'Seed', version: 2, slides: [{ title: 'Pricing', blocks: [table] }], images: new Map(), footer: null, watermark: null, notes: false, sources: false });
  assert.match(html, /<table class="typed"><tr><th>Plan<\/th><th>Seats<\/th><\/tr><tr><td>Pro<\/td><td>40<\/td><\/tr><\/table>/);
  assert.deepEqual(blockParas(table)!.map((p) => [p.style, p.text]), [['M', 'Plan · Seats'], ['B', 'Pro · 40']]);
  const pptx = blockParagraphs(table)!.join('');
  assert.match(pptx, /Plan · Seats/);
  assert.match(pptx, /Pro · 40/);
  assert.match(pptx, /b="1"[^>]*>[\s\S]*?Plan · Seats/, 'the header row in bold');
  const chart = (t: string) => ({ id: 'c', kind: 'chart', grid: { c1: 1, c2: 8, r1: 2, r2: 6 }, chart_type: t, series: [] });
  const html2 = await writeOfflineDeck({ title: 'Seed', version: 2, slides: [{ title: 'Market', blocks: [chart('market_circles')] }, { title: 'Plan', blocks: [chart('projection')] }], images: new Map(), footer: null, watermark: null, notes: false, sources: false });
  assert.match(html2, /Market circles chart/);
  assert.match(html2, /Projection chart/);
});

// 6 ───────────────────────────────────────────────────────────────────────────
test('a typed number is counted by the evidence check: a table row and a typed figure each become a claim', async () => {
  // Mutations checked: cardText back to slideText → the table row's MRR is not read; the typed-figure loop removed →
  // the typed claim disappears; figureLines with one order only ("label: value") → "42 paying customers" is missed.
  const db = world();
  db.prepare('INSERT INTO deck_typed_values (project_id, deck_id, key, label, value_num, value_text, unit, typed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(P, 2, 'customers', 'paying customers', 42, null, 'count', FOUNDER);
  const slides = [{ title: 'Traction', blocks: [{ id: 't', kind: 'table', grid: { c1: 1, c2: 12, r1: 2, r2: 4 }, rows: [[{ text: 'Metric' }, { text: 'Value' }], [{ text: 'MRR' }, { text: '$12,000' }]] }] }];
  assert.deepEqual(cardText(slides[0]).slice(-2), ['MRR: $12,000', '$12,000 MRR']);
  const s = await deck({ DB: d1Over(db) } as any, P, [], new Map(), { id: 2, version: 2, slides: JSON.stringify(slides) });
  assert.equal(s.state, 'recorded');
  const got = s.claims.map((c) => [c.field_key, c.claim_kind, c.stated_value]);
  assert.deepEqual(got, [['slide:1#mrr', 'mrr', '12000'], ['typed:customers#paying_customers', 'paying_customers', '42']]);
});

// 7 ───────────────────────────────────────────────────────────────────────────
test('a table taller than its block is a fit problem, so a one-click deck with one fails its zero-fit gate', () => {
  // Mutation checked: the table branch removed from fitProblems → no problem is reported.
  assert.equal(TABLE_ROWS_PER_GRID_ROW, 2);
  const rows = Array.from({ length: 5 }, () => [{ text: 'a' }, { text: 'b' }]);
  const fits = fitProblems([{ blocks: [{ id: 't', kind: 'table', grid: { c1: 1, c2: 12, r1: 2, r2: 3 }, rows }] }]);
  assert.deepEqual(fits.map((f: any) => [f.kind, f.over]), [['too_many_rows', 1]]);
  assert.deepEqual(fitProblems([{ blocks: [{ id: 't', kind: 'table', grid: { c1: 1, c2: 12, r1: 2, r2: 4 }, rows }] }]), []);
});
