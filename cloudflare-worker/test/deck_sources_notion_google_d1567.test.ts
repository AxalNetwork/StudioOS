/**
 * D1567 (#3814) — Notion and Google as deck sources, never graded Measured.
 *
 * The database is the baseline plus every migration, as deck_sources_d896
 * builds it. Neither adapter calls Notion or Google: they read what the
 * founder's own connection already landed, by the origin each writer stamps.
 *
 *   1. With nothing landed, every Notion and Google slot is Not recorded, with
 *      the module whose "From Notion" or "From Google" fills it; never 0.
 *   2. With rows landed: a page, a Doc or a Form answer is Sourced (Document);
 *      a database row or a Sheet cell is Stated (Typed). Another venture's rows,
 *      a draft session and a Form answer still to confirm are not counted.
 *   3. An interview whose only session came from a Notion page or a Google Doc
 *      no longer makes the interview count Measured.
 *   4. No Notion or Google slot can be Measured, whatever it reads.
 *
 * Every name and figure is synthetic.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import deckSources from '../src/routes/deck_sources.ts';
import { DECK_SOURCES, readSources, sourceAndGrade, type SourceItem } from '../src/services/decks/sources.ts';
import { CARD_CATALOGUE } from '../src/services/decks/newDeck.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

const JWT_SECRET = 'unit-test-jwt-secret-d1567-0123456789-abcdef'; // synthetic test fixture
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIGRATIONS = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
const FOUNDER = 10;
const P = 1, P_OTHER = 2;

const NEW_SLOTS = [
  'validate.notion_interviews', 'validate.notion_research', 'build.notion_design_notes', 'grow.notion_content',
  'validate.google_doc_interviews', 'validate.google_forms', 'build.google_design_notes', 'grow.google_sheets_days',
];

const FILES = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations);
const BUILT_DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE);
  for (const f of FILES.filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)').run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Kestrel Labs', 1001), (${P_OTHER}, 'Beta Works', 1002)`);
  return db;
}

/** Insert a row, filling any NOT NULL column the test does not care about. */
function put(db: DatabaseSync, table: string, row: Record<string, unknown>) {
  const full: Record<string, unknown> = { ...row };
  for (const c of db.prepare(`PRAGMA table_info(${table})`).all() as any[]) {
    if (c.notnull && !c.pk && c.dflt_value == null && !(c.name in full)) full[c.name] = /INT|REAL|NUM/.test(c.type) ? 1 : `synthetic-${Math.random().toString(16).slice(2)}`;
  }
  const keys = Object.keys(full);
  db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => full[k] as any));
}

let iv = 100;
function session(db: DatabaseSync, project: number, via: string | null, status = 'reviewed', at = '2026-10-02 09:00:00') {
  iv += 1;
  put(db, 'discovery_interviews', { id: iv, project_id: project, interviewee_name: `Person ${iv}`, interview_date: at.slice(0, 10), stage: 'done', created_at: at });
  put(db, 'interview_sessions', { uid: `s${iv}`, interview_id: iv, project_id: project, created_by_user_id: FOUNDER, channel: 'manual', status, consent_status: 'given', submitted_via: via, created_at: at });
}

function landed(db: DatabaseSync) {
  // Notion.
  session(db, P, 'notion', 'reviewed', '2026-10-02 09:00:00');
  session(db, P, 'notion', 'reviewed', '2026-10-05 09:00:00');
  session(db, P, 'notion', 'draft', '2026-10-20 09:00:00');
  session(db, P_OTHER, 'notion', 'reviewed', '2026-10-21 09:00:00');
  put(db, 'market_sources', { project_id: P, title: 'Synthetic research', url: 'https://example.test/r', kind: 'notion', created_at: '2026-10-03 10:00:00' });
  put(db, 'market_sources', { project_id: P, title: 'Typed link', url: 'https://example.test/t', kind: 'link', created_at: '2026-10-25 10:00:00' });
  put(db, 'market_sources', { project_id: P_OTHER, title: 'Other venture', url: 'https://example.test/o', kind: 'notion', created_at: '2026-10-26 10:00:00' });
  put(db, 'solution_design_notes', { project_id: P, title: 'Spec from Notion', body: 'Synthetic.', source_path: 'notion/abc', created_by: FOUNDER, created_at: '2026-10-04 10:00:00' });
  put(db, 'content_calendar_items', { uid: 'c1', project_id: P, title: 'Launch post', planned_on: '2026-11-10', status: 'planned', source: 'notion', updated_at: '2026-10-06 10:00:00' });
  put(db, 'content_calendar_items', { uid: 'c2', project_id: P, title: 'Typed post', planned_on: '2026-11-11', status: 'planned', source: 'manual', updated_at: '2026-10-27 10:00:00' });
  // Google.
  session(db, P, 'google_docs', 'reviewed', '2026-10-07 09:00:00');
  put(db, 'demand_signals', { project_id: P, kind: 'waitlist', who: 'Respondent A', status: 'confirmed', source_kind: 'google_forms', signal_date: '2026-10-08' });
  put(db, 'demand_signals', { project_id: P, kind: 'waitlist', who: 'Respondent B', status: 'to_confirm', source_kind: 'google_forms', signal_date: '2026-10-28' });
  put(db, 'solution_design_notes', { project_id: P, title: 'Spec from Docs', body: 'Synthetic.', source_path: 'google_docs/xyz', created_by: FOUNDER, created_at: '2026-10-09 10:00:00' });
  put(db, 'project_metrics', { project_id: P, snapshot_date: '2026-10-01', mrr: 1200, source: 'google_sheets' });
  put(db, 'project_metrics', { project_id: P, snapshot_date: '2026-10-10', mrr: 1300, source: 'google_sheets' });
  put(db, 'project_metrics', { project_id: P, snapshot_date: '2026-10-30', mrr: 1400, source: 'stripe' });
}

const read = async (db: DatabaseSync) => (await readSources({ env: { DB: d1Over(db) } as any, projectId: P, today: '2026-10-31', mercury: null })).items;
const byKey = (items: SourceItem[]) => new Map(items.map((i) => [i.source_key, i]));

test('D1567: with nothing landed, every Notion and Google slot is Not recorded, with the module that fills it', async () => {
  const keys = DECK_SOURCES.flatMap((a) => a.slots.map((s) => s.key));
  for (const k of NEW_SLOTS) assert.ok(keys.includes(k), k);
  const app = new Hono<any>().route('/api/decks', deckSources);
  const token = await new SignJWT({ user_id: FOUNDER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await withThrownResponses(() => app.request(`/api/decks/sources?project_id=${P}`, { headers: { Authorization: `Bearer ${token}` } },
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(fixture()) } as any));
  assert.equal(res.status, 200);
  const m = byKey(((await res.json()) as any).items);
  const where: Record<string, [string, string]> = {
    'validate.notion_interviews': ['validate', '/validate/customer-research'],
    'validate.notion_research': ['validate', '/validate/market-intelligence'],
    'build.notion_design_notes': ['build', '/build/solution-design'],
    'grow.notion_content': ['grow', '/grow/distribution'],
    'validate.google_doc_interviews': ['validate', '/validate/customer-research'],
    'validate.google_forms': ['validate', '/validate/demand-signals'],
    'build.google_design_notes': ['build', '/build/solution-design'],
    'grow.google_sheets_days': ['grow', '/grow/revenue-and-traction'],
  };
  for (const k of NEW_SLOTS) {
    const it = m.get(k)!;
    assert.equal(it.state, 'not_recorded', k);
    assert.equal(it.value, null, k);
    assert.equal(it.grade, 'Not recorded', k);
    assert.equal(it.area, where[k][0], `${k} area`);
    assert.equal(it.href, `${where[k][1]}?project=${P}`, `${k} href`);
  }
});

test('D1567: landed rows read as Sourced or Stated with their date, this venture only', async () => {
  const db = fixture(); landed(db);
  const m = byKey(await read(db));
  const is = (key: string, value: number, source: string, grade: string, as_of: string) => {
    const it = m.get(key)!;
    assert.equal(it.state, 'recorded', key);
    assert.equal(it.value, value, `${key} value`);
    assert.equal(it.source, source, `${key} source`);
    assert.equal(it.grade, grade, `${key} grade`);
    assert.equal(it.as_of, as_of, `${key} as_of`);
    assert.match(String(it.snapshot_hash), /^[0-9a-f]{24}$/, key);
  };
  // Draft and other-venture sessions are left out.
  is('validate.notion_interviews', 2, 'Document', 'Sourced', '2026-10-05');
  is('validate.notion_research', 1, 'Document', 'Sourced', '2026-10-03');
  is('build.notion_design_notes', 1, 'Document', 'Sourced', '2026-10-04');
  is('grow.notion_content', 1, 'Typed', 'Stated', '2026-10-06');
  is('validate.google_doc_interviews', 1, 'Document', 'Sourced', '2026-10-07');
  // A response still to confirm is not counted.
  is('validate.google_forms', 1, 'Document', 'Sourced', '2026-10-08');
  is('build.google_design_notes', 1, 'Document', 'Sourced', '2026-10-09');
  is('grow.google_sheets_days', 2, 'Typed', 'Stated', '2026-10-10');
  for (const k of NEW_SLOTS) assert.notEqual(m.get(k)!.grade, 'Measured', k);
});

test('D1567: a Notion page or Google Doc session does not make the interview count Measured', async () => {
  const db = fixture();
  session(db, P, 'notion');
  session(db, P, 'google_docs');
  let it = byKey(await read(db)).get('validate.interviews')!;
  assert.equal(it.value, 2);
  assert.equal(it.grade, 'Sourced');
  // A recorded session alongside them still leaves one unrecorded interview: Sourced.
  session(db, P, null);
  it = byKey(await read(db)).get('validate.interviews')!;
  assert.equal(it.value, 3);
  assert.equal(it.grade, 'Sourced');
  // Recorded sessions only: Measured, as D896 grades it.
  const only = fixture();
  session(only, P, null);
  assert.equal(byKey(await read(only)).get('validate.interviews')!.grade, 'Measured');
});

test('D1567: the two document-suite origins are never Measured, and Market binds Notion research', () => {
  assert.deepEqual(sourceAndGrade('linked_document'), { source: 'Document', grade: 'Sourced' });
  assert.deepEqual(sourceAndGrade('linked_typed'), { source: 'Typed', grade: 'Stated' });
  const market = CARD_CATALOGUE.find((c) => c.card === 'market')!;
  assert.ok(market.sources.includes('validate.notion_research'));
});
