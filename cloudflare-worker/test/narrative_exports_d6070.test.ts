/**
 * D6070 (#6070) — the Investor narrative's export log (`routes/narrative_exports.ts`).
 *
 *   1. the founder's PDF is recorded once, naming the version and the format and never the words;
 *   2. an admin needs a live read reason, copies the text only (owner pick A on #6067), and the copy names the read;
 *   3. version 0, another venture's narrative, an unknown version and a bad format are refused and write nothing;
 *   4. a log that cannot be written or read is a 503, never a 201 or an empty list.
 *
 * The real `cycle_raise.ts` router makes the version and the admin's reason; the export router is mounted beside it.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/narrative_exports_d6070.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import cycleRaise from '../src/routes/cycle_raise.ts';
import narrativeExports, { mount } from '../src/routes/narrative_exports.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { raiseEvidenceTables } from './_raise_evidence_fixture.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const sqlOf = (file: string) => readFileSync(resolve(process.cwd(), `cloudflare-worker/sql/migrations/${file}`), 'utf8');

const FOUNDER = 110, OTHER = 120, INVESTOR = 150, ADMIN = 30;
const ROLE: Record<number, string> = { [FOUNDER]: 'founder', [OTHER]: 'founder', [INVESTOR]: 'investor', [ADMIN]: 'admin' };
const P = 1;
// Invented words: no real venture, person or reason.
const REASON = 'Quarterly portfolio review';

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of [
    'users', 'projects', 'activity_logs', 'super_admins', 'cap_table_scenarios', 'cap_table_holders', 'cap_table_vesting', 'raise_prospects', 'raise_rounds',
    'spinout_deck_overrides', 'pitch_decks', 'pitch_deck_share_tokens', 'deck_share_views', 'data_room_folders', 'data_room_files',
    'dd_cases', 'dd_requests', 'contacts', 'pain_groups', 'hypotheses', 'mvp_features', 'roadmap_okrs',
  ]) db.exec(tableFromBaseline(BASELINE, t));
  const cols = (t: string) => new Set((db.prepare(`SELECT name FROM pragma_table_info('${t}')`).all() as any[]).map((r) => r.name));
  if (!cols('pitch_deck_share_tokens').has('revoked_at')) db.exec(sqlOf('248_deck_share_revoked_at.sql'));
  for (const m of ['129_captable_one_canonical_per_project.sql', '249_project_metrics.sql', '410_safe_issuances.sql', '442_raise_cycle_stores.sql',
    '459_cycle_activity_convention.sql', '463_raise_record_stores.sql', '544_narrative_sections.sql', '202611082100_narrative_version_revision.sql', '545_narrative_notes.sql', '761_narrative_read_end.sql']) db.exec(sqlOf(m));
  raiseEvidenceTables(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  u.run(OTHER, 'founder', 'Bo Other', 'bo@example.test', 1002);
  u.run(INVESTOR, 'investor', 'Ivy Investor', 'ivy@example.test', null);
  u.run(ADMIN, 'admin', 'Ada Admin', 'ada@example.test', null);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Kestrel Labs', 1001), (2, 'Osprey Works', 1002)`);
  db.prepare("INSERT INTO spinout_deck_overrides (project_id, field_key, value, version) VALUES (?, 'problem.framing', 'Finance teams close the month by hand.', 0)").run(P);
  return db;
}

const app = new Hono<any>();
app.route('/api/cycles/raise', cycleRaise);
app.route(mount.path, narrativeExports);

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const sep = path.includes('?') ? '&' : '?';
    const res = await app.request(`${path}${sep}project=${P}`, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
    const raw = await res.text();
    return { status: res.status, body: raw ? JSON.parse(raw) : null };
  } finally { [console.warn, console.error] = saved; }
}
const exportsLog = (db: DatabaseSync) => db.prepare(
  `SELECT action, details, entity_id, user_id FROM activity_logs WHERE action LIKE 'narrative_%' AND action IN ('narrative_exported_pdf', 'narrative_copied_text') ORDER BY id`,
).all().map((r) => ({ ...(r as any) }));

async function v1(db: DatabaseSync) {
  const r = await call(db, FOUNDER, 'POST', '/api/cycles/raise/narrative-versions', { investor_type: 'seed_fund' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.version as number;
}

test('1. the founder’s PDF is recorded once, with the version and the format and no words, and the log lists it', async () => {
  const db = fixture();
  const v = await v1(db);
  const r = await call(db, FOUNDER, 'POST', '/api/narrative-exports', { version: v, format: 'pdf' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual({ ...r.body.export, id: 0, created_at: '' }, { id: 0, version: v, format: 'pdf', by: 'founder', created_at: '' });
  assert.deepEqual(exportsLog(db), [{ action: 'narrative_exported_pdf', details: `Exported v${v} as PDF`, entity_id: String(v), user_id: FOUNDER }]);
  const log = await call(db, FOUNDER, 'GET', '/api/narrative-exports');
  assert.equal(log.status, 200);
  assert.deepEqual(log.body.exports.map((e: any) => [e.version, e.format, e.by]), [[v, 'pdf', 'founder']]);
  // Each export is its own row: a second PDF is a second line.
  await call(db, FOUNDER, 'POST', '/api/narrative-exports', { version: String(v), format: 'pdf' });
  assert.equal(exportsLog(db).length, 2);
});

test('2. an admin needs a live reason, copies the text only, and the copy names the read, never its words', async () => {
  const db = fixture();
  const v = await v1(db);
  const closed = await call(db, ADMIN, 'POST', '/api/narrative-exports', { version: v, format: 'text' });
  assert.equal(closed.status, 403);
  assert.equal(closed.body.code, 'read_reason_required');
  assert.equal((await call(db, ADMIN, 'GET', '/api/narrative-exports')).status, 403);
  const read = await call(db, ADMIN, 'POST', '/api/cycles/raise/narrative/reads', { reason: REASON });
  assert.equal(read.status, 201, JSON.stringify(read.body));
  const pdf = await call(db, ADMIN, 'POST', '/api/narrative-exports', { version: v, format: 'pdf' });
  assert.equal(pdf.status, 403);
  assert.equal(pdf.body.error, 'admin_copy_only');
  assert.deepEqual(exportsLog(db), []);
  const copy = await call(db, ADMIN, 'POST', '/api/narrative-exports', { version: v, format: 'text' });
  assert.equal(copy.status, 201, JSON.stringify(copy.body));
  assert.equal(copy.body.export.by, 'admin');
  const [row] = exportsLog(db);
  assert.equal(row.details, `An admin copied v${v} as text under read ${read.body.read.id}`);
  assert.ok(!row.details.includes(REASON));
  // The founder reads the admin's copy in the log.
  assert.deepEqual((await call(db, FOUNDER, 'GET', '/api/narrative-exports')).body.exports.map((e: any) => [e.format, e.by]), [['text', 'admin']]);
});

test('3. version 0, an unknown version, a bad format and another venture are refused and write nothing', async () => {
  const db = fixture();
  const v = await v1(db);
  const cases: Array<[number, unknown, number, string]> = [
    [FOUNDER, { version: 0, format: 'pdf' }, 409, 'live_deck_not_exported'],
    [FOUNDER, { version: 99, format: 'pdf' }, 404, 'version_not_found'],
    [FOUNDER, { version: v, format: 'docx' }, 400, 'invalid_export'],
    [FOUNDER, { version: v }, 400, 'invalid_export'],
    [OTHER, { version: v, format: 'pdf' }, 403, 'forbidden'],
    [INVESTOR, { version: v, format: 'pdf' }, 403, 'forbidden'],
  ];
  for (const [who, body, status, code] of cases) {
    const r = await call(db, who, 'POST', '/api/narrative-exports', body);
    assert.equal(r.status, status, `${JSON.stringify(body)} as ${who}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.error, code);
  }
  assert.equal((await call(db, OTHER, 'GET', '/api/narrative-exports')).status, 403);
  assert.deepEqual(exportsLog(db), []);
});

test('4. a log that cannot be written is a 503 and no record; one that cannot be read is a 503, never an empty list', async () => {
  const db = fixture();
  const v = await v1(db);
  db.exec('ALTER TABLE activity_logs RENAME TO activity_logs_gone');
  const r = await call(db, FOUNDER, 'POST', '/api/narrative-exports', { version: v, format: 'pdf' });
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'export_not_recorded');
  const log = await call(db, FOUNDER, 'GET', '/api/narrative-exports');
  assert.equal(log.status, 503);
  assert.equal(log.body.error, 'export_log_unreadable');
  assert.equal(log.body.exports, undefined);
});
