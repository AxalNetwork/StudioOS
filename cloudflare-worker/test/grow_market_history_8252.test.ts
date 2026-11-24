/**
 * D8252 (#8252, Grow Markets) — History says what changed.
 *
 *   1  A one-field edit writes `Market updated: Regulation score 2 → 4` into the market's own activity line.
 *   2  A multi-field edit lists every changed field with its old and new value, a field that did not change is
 *      not listed, and a value that was never set reads Not recorded.
 *   3  A legacy `Market updated` line is read back unchanged, and an edit that changed nothing says so.
 *   4  A long list ends in `and N more` inside the log's 500-character cap instead of being cut mid-value.
 *
 * Mutation checked (each broke a test below, then was restored): the diff always listing a field (2); `Not recorded` →
 *   `null` for an unset old value (2); the 500-character cap ignored (4); the writer logging the bare `Market updated` (1).
 *
 * Every name and value is made up. The database is the baseline plus every migration, in memory.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/grow_market_history_8252.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import cycleGrow from '../src/routes/cycle_grow.ts';
import { createCycleRecords } from '../src/routes/cycle_records.ts';
import { marketChanges, marketUpdatedSummary } from '../src/services/growWriters.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = ['fixture', 'key', 'for', 'market', 'history', '8252'].join('-');
const FOUNDER = 10;
const A = 1;

function fixture(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec('PRAGMA foreign_keys = ON');
  db.prepare('INSERT INTO founders (id, name, email) VALUES (?, ?, ?)').run(FOUNDER, 'Ana Wren', 'f10@example.test');
  db.prepare('INSERT INTO users (id, role, name, email, founder_id, is_active) VALUES (?, ?, ?, ?, ?, 1)').run(FOUNDER, 'founder', 'Ana Wren', 'u10@example.test', FOUNDER);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${A}, 'Harbour Lantern', ${FOUNDER})`);
  db.exec(`INSERT OR IGNORE INTO research_countries (code, name, region) VALUES ('PT', 'Portugal', 'Europe')`);
  db.exec(`INSERT INTO markets (id, uid, project_id, name, state, demand_score, demand_source, regulation_score, regulation_source, created_by) VALUES
    (1, 'mka1', ${A}, 'Portugal', 'considering', 8, 'Twelve calls', 2, 'Licence memo', ${FOUNDER})`);
  return db;
}

const app = new Hono<any>();
app.route('/api/cycles/grow', cycleGrow);
app.route('/api/cycles', createCycleRecords());
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

async function call(db: DatabaseSync, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: FOUNDER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await withThrownResponses(() => app.request(path, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    }, { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' } as any));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}
const edit = (db: DatabaseSync, body: Record<string, unknown>) => call(db, 'PATCH', '/api/cycles/grow/markets/mka1', { project: A, ...body });
const lines = (db: DatabaseSync) => (db.prepare("SELECT details FROM activity_logs WHERE entity_id = 'mka1' AND action = 'grow_market_updated' ORDER BY id").all() as any[]).map((r) => r.details as string);
const history = (db: DatabaseSync) => call(db, 'GET', `/api/cycles/grow/modules/market-expansion/records/mka1/activity?project=${A}`);

test('1: a one-field edit records that field with its old and new value', async () => {
  const db = fixture();
  assert.equal((await edit(db, { regulation_score: 4 })).status, 200);
  assert.deepEqual(lines(db), ['Market updated: Regulation score 2 → 4']);
  const h = await history(db);
  assert.equal(h.status, 200, JSON.stringify(h.body));
  assert.ok(h.body.items.some((i: any) => String(i.a).includes('Regulation score 2 → 4')), JSON.stringify(h.body.items));
});

test('2: a multi-field edit lists each change, skips what did not change, and names an unset old value Not recorded', async () => {
  const db = fixture();
  const r = await edit(db, { state: 'entering', decision: 'enter', demand_score: 8, partners_score: 6, partners_source: 'Two resellers', geography_ref: 'pt' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const [line] = lines(db);
  assert.equal(line, 'Market updated: State Considering → Entering; Decision Not decided → Enter; Partners score Not recorded → 6; Partners source Not recorded → Two resellers; Country Not recorded → PT');
  assert.ok(!/Demand/.test(line), 'an unchanged score is not listed');
});

test('3: a legacy line keeps its text, and an edit that changed nothing says so', async () => {
  const db = fixture();
  db.prepare("INSERT INTO activity_logs (project_id, entity_type, entity_id, action, details, actor) VALUES (?, 'grow.market-expansion', 'mka1', 'grow_market_updated', 'Market updated', 'user:10')").run(A);
  assert.equal((await edit(db, { demand_score: 8 })).status, 200);
  assert.deepEqual(lines(db), ['Market updated', 'Market updated: no field changed']);
});

test('4: a long list ends in "and N more" inside the 500-character cap', () => {
  const many = Array.from({ length: 30 }, (_, i) => `Field ${i} Not recorded → ${'x'.repeat(40)}`);
  const s = marketUpdatedSummary(many);
  assert.ok(s.length <= 500, String(s.length));
  assert.match(s, /; and \d+ more$/);
  const shown = (s.match(/Field \d+/g) ?? []).length;
  assert.equal(shown + Number(/and (\d+) more$/.exec(s)![1]), 30);
  assert.deepEqual(marketChanges({ size_cents: 5000, size_currency: 'usd' }, { size_cents: 7500, size_currency: 'usd' }), ['Size 50.00 USD → 75.00 USD']);
  // D5373: the currency's own decimals, not a bare factor of 100.
  assert.deepEqual(marketChanges({ size_cents: 5000, size_currency: 'JPY' }, { size_cents: 5000, size_currency: 'KWD' }), ['Size 5000 JPY → 5.000 KWD']);
  assert.deepEqual(marketChanges({ size_cents: null, size_currency: null }, { size_cents: 7500, size_currency: null }), ['Size Not recorded → 7500 in minor units, currency not recorded']);
});
