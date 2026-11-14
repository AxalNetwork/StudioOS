/**
 * D6043 (#6043) — a Build module's records list as CSV: the page read's
 * columns, search, filters and sort, its access gate, Not recorded for an
 * empty cell, formula-safe RFC 4180 escaping, and the row cap.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/build_module_export_d6043.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import build, { EXPORT_ROW_CAP } from '../src/routes/cycle_build.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const FOUNDER = 10, OTHER = 20, ADMIN = 30;
const P = 1, P_OTHER = 2;
const BUILT = (() => { const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true }); loadSchema(db);
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string); })();

function seeded() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT) { try { db.exec(s); } catch { /* replayed out of order */ } }
  db.exec(`INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES
    (${FOUNDER}, 'founder', 'Ana Wren', 'ana@example.test', 1, 1001),
    (${OTHER}, 'founder', 'Other Founder', 'other@example.test', 1, 1002),
    (${ADMIN}, 'admin', 'Ada Admin', 'ada@example.test', 1, NULL)`);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Kestrel Works', 1001), (${P_OTHER}, 'Harbour Labs', 1002)`);
  db.exec(`INSERT INTO pain_groups (id, project_id, title) VALUES (1, ${P}, 'Manual reconciliation')`);
  // A title with a comma, a quote and a line break; one that starts a formula; one with no link.
  const f = db.prepare(`INSERT INTO mvp_features (id, project_id, title, added_value, effort, is_must_have, pain_group_id, sort_order) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`);
  f.run(1, P, 'Bank feed, "nightly"\nimport', 'High', 'S', 1, 1);
  f.run(2, P, '=HYPERLINK("x")', 'Low', 'M', null, 2);
  f.run(3, P, 'Exceptions queue', 'Medium', '', null, 3);
  f.run(4, P_OTHER, 'Their feature', 'High', 'S', null, 1);
  return db;
}

const app = new Hono<any>();
app.route('/api/cycles/build', build);
app.onError((e, c) => c.json({ error: e.message }, 500));
async function exportOf(db: DatabaseSync, slug: string, query = '', user = FOUNDER, project: number | null = P) {
  const token = await new SignJWT({ user_id: user, role: user === ADMIN ? 'admin' : 'founder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const r = await app.request(`/api/cycles/build/modules/${slug}/export?${project == null ? '' : `project=${project}`}${query}`,
    { headers: { Authorization: `Bearer ${token}` } }, { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' } as any);
  return { status: r.status, type: r.headers.get('Content-Type') || '', disposition: r.headers.get('Content-Disposition') || '', rows: r.headers.get('X-Export-Rows'), text: await r.text() };
}
/** RFC 4180 records (quoted fields may hold CRLF, LF and doubled quotes). */
function parse(csv: string): string[][] {
  const out: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (quoted) { if (ch === '"' && csv[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch; continue; }
    if (ch === '"') quoted = true; else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\r' && csv[i + 1] === '\n') { row.push(cell); out.push(row); row = []; cell = ''; i++; }
    else cell += ch;
  }
  row.push(cell); out.push(row);
  return out;
}

test('access: the page read\'s gate — no project 400, another founder 403, unknown module 404, the founder and an admin 200', async () => {
  const db = seeded();
  assert.equal((await exportOf(db, 'solution-design', '', FOUNDER, null)).status, 400);
  assert.equal((await exportOf(db, 'solution-design', '', OTHER)).status, 403);
  assert.equal((await exportOf(db, 'no-such-module')).status, 404);
  assert.equal((await exportOf(db, 'solution-design', '', ADMIN)).status, 200);
  const ok = await exportOf(db, 'solution-design');
  assert.equal(ok.status, 200);
  assert.match(ok.type, /^text\/csv/);
  assert.match(ok.disposition, /^attachment; filename="solution-design-1-\d{4}-\d{2}-\d{2}\.csv"$/);
  db.close();
});

test('columns and rows: the page\'s columns, only this venture\'s rows, its default sort, Not recorded for an empty cell', async () => {
  const db = seeded();
  const r = await exportOf(db, 'solution-design');
  const [head, ...body] = parse(r.text);
  assert.deepEqual(head, ['Feature', 'Pain theme', 'Hypothesis', 'Impact', 'Effort']);
  assert.equal(r.rows, '3');
  // Impact first (High, Medium, Low), as the page's default sort; the other venture's feature never appears.
  assert.deepEqual(body.map((row) => row[0]), ['Bank feed, "nightly"\nimport', 'Exceptions queue', "'=HYPERLINK(\"x\")"]);
  // The page's own words where it has them (Links to nothing), Not recorded where the cell is empty.
  assert.deepEqual(body[1], ['Exceptions queue', 'Links to nothing', 'Not recorded', 'Medium', 'Not recorded']);
  assert.equal(body[0][2], 'Not recorded');
  assert.equal(body[0][1], 'Manual reconciliation');
  assert.ok(!r.text.includes('Their feature'));
  db.close();
});

test('escaping: comma, quote and line break are quoted; a formula is defused; records end in CRLF', async () => {
  const db = seeded();
  const r = await exportOf(db, 'solution-design');
  assert.ok(r.text.includes('"Bank feed, ""nightly""\nimport"'));
  assert.ok(r.text.includes(`"'=HYPERLINK(""x"")"`));
  assert.equal(r.text.split('\r\n')[0], 'Feature,Pain theme,Hypothesis,Impact,Effort');
  db.close();
});

test('filters, search and sort: the export honours the page\'s query and never pages', async () => {
  const db = seeded();
  const high = parse((await exportOf(db, 'solution-design', '&filter=impact:high')).text).slice(1);
  assert.deepEqual(high.map((row) => row[3]), ['High']);
  const unlinked = parse((await exportOf(db, 'solution-design', '&filter=linked:no')).text).slice(1);
  assert.deepEqual(unlinked.map((row) => row[0]).sort(), ["'=HYPERLINK(\"x\")", 'Exceptions queue']);
  const searched = parse((await exportOf(db, 'solution-design', '&q=exceptions')).text).slice(1);
  assert.deepEqual(searched.map((row) => row[0]), ['Exceptions queue']);
  const reversed = parse((await exportOf(db, 'solution-design', '&sort=-impact')).text).slice(1);
  assert.deepEqual(reversed.map((row) => row[3]), ['Low', 'Medium', 'High']);
  // `page` is not the export's: page 2 of a 3-row list still writes all three.
  assert.equal(parse((await exportOf(db, 'solution-design', '&page=2')).text).length, 4);
  const none = await exportOf(db, 'solution-design', '&q=nothing-matches');
  assert.equal(none.text, 'Feature,Pain theme,Hypothesis,Impact,Effort');
  db.close();
});

test('every Build module exports its own columns', async () => {
  const db = seeded();
  const want: Record<string, string> = {
    'prototype-mvp': 'Must-have,Test,State,Owner,Due,Built,Tested',
    'product-roadmap': 'Item,Column,Moves,Owner,Date',
    'founding-team': 'Founder,Role,Equity,Vesting,Agreement',
    'company-creation': 'Filing,Jurisdiction,Due,State,Proof',
    'operating-systems': 'System,Provider,State,Last sync,Used by',
  };
  for (const [slug, head] of Object.entries(want)) {
    const r = await exportOf(db, slug);
    assert.equal(r.status, 200, slug);
    assert.equal(r.text.split('\r\n')[0], head, slug);
  }
  db.close();
});

test('cap: past EXPORT_ROW_CAP matching rows the export refuses with the count, never a short file; a filter brings it back', async () => {
  const db = seeded();
  const f = db.prepare(`INSERT INTO mvp_features (project_id, title, added_value, effort, is_must_have, sort_order) VALUES (${P}, ?, 'Low', 'S', 0, ?)`);
  db.exec('BEGIN');
  for (let i = 0; i < EXPORT_ROW_CAP; i++) f.run(`Bulk ${i}`, 100 + i);
  db.exec('COMMIT');
  const r = await exportOf(db, 'solution-design');
  assert.equal(r.status, 413);
  const body = JSON.parse(r.text);
  assert.equal(body.total, EXPORT_ROW_CAP + 3);
  assert.equal(body.cap, EXPORT_ROW_CAP);
  const narrowed = await exportOf(db, 'solution-design', '&filter=impact:high');
  assert.equal(narrowed.status, 200);
  assert.equal(narrowed.rows, '1');
  db.close();
});

test('an unreadable module is a 503, never an empty file', async () => {
  const db = seeded();
  db.exec('DROP TABLE mvp_features');
  const r = await exportOf(db, 'solution-design');
  assert.equal(r.status, 503);
  assert.match(JSON.parse(r.text).detail, /unreadable/);
  db.close();
});
