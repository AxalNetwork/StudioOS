/**
 * D914 (#2698), part 8 of #2454 — an admin reads the Investor narrative read
 * only, gives a reason first, and leaves notes the founder sees.
 *
 * The owner's answer to #2459 decision 3 for the narrative (2026-10-24):
 *   1. every narrative write of an admin is refused, 403 `admin_read_only`,
 *      on `/api/cycles/raise/*` and on the narrative's records, and changes
 *      nothing;
 *   2. an admin's narrative reads answer 403 `read_reason_required` until
 *      they give a reason, then for 8 hours; a read log that cannot be read
 *      keeps the narrative closed (503), never open;
 *   3. the founder reads every reason, with who gave it;
 *   4. the notes thread: an admin with a reason posts, the founder answers,
 *      nobody else reads it; each note and each reason writes one activity
 *      row that names neither's words.
 *
 * The real `cycle_raise.ts` and `cycle_records.ts` routers over HTTP, on
 * migrations 442, 459, 463, 544 and 545 over schema_baseline.sql.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/narrative_admin_d914.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import cycleRaise from '../src/routes/cycle_raise.ts';
import cycleRecords from '../src/routes/cycle_records.ts';
import { ADMIN_READ_ONLY, REASON_REQUIRED } from '../src/services/narrative/adminRead.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const sqlOf = (file: string) => readFileSync(resolve(process.cwd(), `cloudflare-worker/sql/migrations/${file}`), 'utf8');

const FOUNDER = 110, OTHER = 120, INVESTOR = 150, ADMIN = 30, HQ = 31;
const ROLE: Record<number, string> = { [FOUNDER]: 'founder', [OTHER]: 'founder', [INVESTOR]: 'investor', [ADMIN]: 'admin', [HQ]: 'admin' };
const P = 1;
// Invented words: no real venture, person or reason.
const REASON = 'Quarterly portfolio review';
const NOTE = 'Lead Traction with retention before revenue.';

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
    '459_cycle_activity_convention.sql', '463_raise_record_stores.sql', '544_narrative_sections.sql', '545_narrative_notes.sql']) db.exec(sqlOf(m));
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  u.run(OTHER, 'founder', 'Bo Other', 'bo@example.test', 1002);
  u.run(INVESTOR, 'investor', 'Ivy Investor', 'ivy@example.test', null);
  u.run(ADMIN, 'admin', 'Ada Admin', 'ada@example.test', null);
  u.run(HQ, 'admin', 'Hal Headquarters', 'hal@example.test', null);
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${HQ})`);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Kestrel Labs', 1001), (2, 'Osprey Works', 1002)`);
  db.prepare("INSERT INTO spinout_deck_overrides (project_id, field_key, value, version) VALUES (?, 'problem.framing', 'Finance teams close the month by hand.', 0)").run(P);
  return db;
}

const app = new Hono<any>();
app.route('/api/cycles/raise', cycleRaise);
app.route('/api/cycles', cycleRecords);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown, base = '/api/cycles/raise') {
  const token = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const sep = path.includes('?') ? '&' : '?';
    const res = await app.request(`${base}${path}${sep}project=${P}`, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
    const raw = await res.text();
    return { status: res.status, body: raw ? JSON.parse(raw) : null };
  } finally { [console.warn, console.error] = saved; }
}
const rec = (db: DatabaseSync, who: number, method: string, path: string, body?: unknown) => call(db, who, method, `/raise/modules/investor-narrative${path}`, body, '/api/cycles');
const logs = (db: DatabaseSync) => db.prepare(
  `SELECT action, details FROM activity_logs WHERE entity_type = 'raise.investor-narrative' ORDER BY id`,
).all().map((r) => ({ ...(r as any) }));
const count = (db: DatabaseSync, sql: string) => Number((db.prepare(sql).get() as any).n);

/** Version 1, saved by the founder. */
async function v1(db: DatabaseSync) {
  const r = await call(db, FOUNDER, 'POST', '/narrative-versions', { investor_type: 'seed_fund' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.version as number;
}

const openAsAdmin = async (db: DatabaseSync, who = ADMIN) => {
  const r = await call(db, who, 'POST', '/narrative/reads', { reason: REASON });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.read;
};

test('1. every narrative write of an admin is refused, with a reason or without, and changes nothing', async () => {
  // Mutation checked: `mode === 'write'` refusal removed → the version and section writes land; the records' writerAllowed line removed → the PATCH lands.
  const db = fixture();
  const v = await v1(db);
  await openAsAdmin(db);
  const before = { logs: logs(db).length, overrides: count(db, 'SELECT COUNT(*) AS n FROM spinout_deck_overrides'), sections: count(db, 'SELECT COUNT(*) AS n FROM narrative_sections') };
  const writes: Array<Promise<{ status: number; body: any }>> = [
    call(db, ADMIN, 'POST', '/narrative-versions', { investor_type: 'seed_fund' }),
    call(db, ADMIN, 'PATCH', `/narrative-versions/${v}`, { one_liner: 'Changed by an admin' }),
    call(db, ADMIN, 'PUT', '/narrative/positioning', { kind: 'one_liner', text: 'Changed by an admin' }),
    call(db, ADMIN, 'POST', '/narrative/positioning/draft', {}),
    call(db, ADMIN, 'POST', '/narrative/positioning/proposals/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {decision:'accept'}),
    call(db, HQ, 'POST', '/narrative/positioning/proposals/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {decision:'discard'}),
    call(db, ADMIN, 'PUT', `/narrative/${v}/sections/solution`, { body: 'Changed by an admin' }),
    rec(db, ADMIN, 'PATCH', `/records/${v}`, { one_liner: 'Changed by an admin' }),
    rec(db, HQ, 'PATCH', `/records/${v}`, { one_liner: 'Changed by HQ' }),
  ];
  for (const r of await Promise.all(writes)) {
    assert.equal(r.status, 403, JSON.stringify(r.body));
    assert.equal(r.body.code, 'admin_read_only');
    assert.equal(r.body.detail, ADMIN_READ_ONLY);
  }
  assert.deepEqual({ logs: logs(db).length, overrides: count(db, 'SELECT COUNT(*) AS n FROM spinout_deck_overrides'), sections: count(db, 'SELECT COUNT(*) AS n FROM narrative_sections') }, before);
  // The founder still writes.
  const own = await call(db, FOUNDER, 'PUT', `/narrative/${v}/sections/solution`, { body: 'An approval layer over the ledger.' });
  assert.equal(own.status, 200, JSON.stringify(own.body));
});

test('2. an admin reads nothing of the narrative until they give a reason; the rest of Raise is unchanged', async () => {
  // Mutation checked: the module read left on plain `scope` → its 200 fails; the records gate removed → form-options and the record answer 200.
  const db = fixture();
  const v = await v1(db);
  const reads = [
    call(db, ADMIN, 'GET', '/modules/investor-narrative'),
    call(db, ADMIN, 'GET', `/narrative/${v}`),
    call(db, ADMIN, 'GET', `/narrative/compare?a=0&b=${v}`),
    call(db, ADMIN, 'GET', '/narrative/positioning'),
    call(db, ADMIN, 'GET', '/narrative/positioning/draft'),
    call(db, ADMIN, 'GET', '/narrative/notes'),
    rec(db, ADMIN, 'GET', '/form-options'),
    rec(db, ADMIN, 'GET', `/records/${v}`),
    rec(db, ADMIN, 'GET', `/records/${v}/activity`),
  ];
  for (const r of await Promise.all(reads)) {
    assert.equal(r.status, 403, JSON.stringify(r.body));
    assert.equal(r.body.code, 'read_reason_required');
    assert.equal(r.body.detail, REASON_REQUIRED);
  }
  assert.equal((await call(db, ADMIN, 'GET', '/modules/data-room')).status, 200, 'another Raise module reads as before');
  assert.equal((await call(db, FOUNDER, 'GET', '/modules/investor-narrative')).status, 200, 'the founder needs no reason');
});

test('3. a reason opens the narrative read only for 8 hours; the founder reads it; a log that cannot be read keeps it closed', async () => {
  // Mutation checked: the expiry predicate dropped → the expired reason still opens it; the 503 branch returning null → the dropped table opens it.
  const db = fixture();
  const v = await v1(db);
  assert.equal((await call(db, ADMIN, 'POST', '/narrative/reads', { reason: 'ok' })).body.code, 'reason_required');
  assert.equal((await call(db, ADMIN, 'POST', '/narrative/reads', { reason: 'x'.repeat(201) })).body.code, 'reason_too_long');
  assert.equal((await call(db, FOUNDER, 'POST', '/narrative/reads', { reason: REASON })).status, 403, 'a founder gives no read reason');
  const read = await openAsAdmin(db);
  assert.equal(read.reason, REASON);
  assert.deepEqual(read.by, { name: 'Ada Admin', kind: 'admin' });
  const hours = (Date.parse(`${read.expires_at.replace(' ', 'T')}Z`) - Date.parse(`${read.created_at.replace(' ', 'T')}Z`)) / 3_600_000;
  assert.equal(hours, 8);

  for (const r of await Promise.all([call(db, ADMIN, 'GET', '/modules/investor-narrative'), call(db, ADMIN, 'GET', `/narrative/${v}`), rec(db, ADMIN, 'GET', '/form-options')])) {
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  const record = await rec(db, ADMIN, 'GET', `/records/${v}`);
  assert.equal(record.status, 200, JSON.stringify(record.body));
  assert.deepEqual(record.body.actions, [], 'an admin is offered no action on a version');
  assert.ok((await rec(db, FOUNDER, 'GET', `/records/${v}`)).body.actions.length > 0, 'the founder keeps them');

  const seen = await call(db, FOUNDER, 'GET', '/narrative/reads');
  assert.equal(seen.status, 200);
  assert.equal(seen.body.viewer, 'founder');
  assert.equal(seen.body.mine, null);
  assert.deepEqual(seen.body.reads.map((r: any) => [r.reason, r.by.name, r.by.kind]), [[REASON, 'Ada Admin', 'admin']]);
  const hq = await openAsAdmin(db, HQ);
  assert.equal(hq.by.kind, 'super_admin', 'HQ is named as HQ');
  const opened = logs(db).filter((l) => l.action === 'narrative_read_opened');
  assert.deepEqual(opened.map((l) => l.details), ['An admin opened the narrative to read it', 'HQ opened the narrative to read it']);
  assert.ok(!JSON.stringify(logs(db)).includes(REASON), 'the activity rows never carry the reason');

  db.exec("UPDATE narrative_read_reasons SET expires_at = datetime('now', '-1 minute') WHERE reader_user_id = " + ADMIN);
  assert.equal((await call(db, ADMIN, 'GET', `/narrative/${v}`)).body.code, 'read_reason_required', 'an expired reason opens nothing');

  db.exec('DROP TABLE narrative_read_reasons');
  const closed = await call(db, HQ, 'GET', `/narrative/${v}`);
  assert.equal(closed.status, 503);
  assert.equal(closed.body.code, 'read_log_unreadable');
});

test('4. the notes thread: an admin with a reason posts, the founder answers, nobody else reads it', async () => {
  // Mutation checked: the note route on plain `scope` → the admin posts without a reason; the version check removed → v0 and v99 are kept.
  const db = fixture();
  const v = await v1(db);
  assert.equal((await call(db, ADMIN, 'POST', '/narrative/notes', { body: NOTE })).body.code, 'read_reason_required');
  await openAsAdmin(db);
  const posted = await call(db, ADMIN, 'POST', '/narrative/notes', { body: NOTE, version: v });
  assert.equal(posted.status, 201, JSON.stringify(posted.body));
  assert.deepEqual([posted.body.note.version, posted.body.note.author], [v, { name: 'Ada Admin', kind: 'admin' }]);
  const answer = await call(db, FOUNDER, 'POST', '/narrative/notes', { body: 'Moved it up.' });
  assert.equal(answer.status, 201);
  assert.equal(answer.body.note.version, null);

  assert.equal((await call(db, ADMIN, 'POST', '/narrative/notes', { body: '   ' })).body.code, 'note_required');
  assert.equal((await call(db, ADMIN, 'POST', '/narrative/notes', { body: 'x'.repeat(2001) })).body.code, 'note_too_long');
  assert.equal((await call(db, ADMIN, 'POST', '/narrative/notes', { body: NOTE, version: 0 })).status, 400);
  assert.equal((await call(db, ADMIN, 'POST', '/narrative/notes', { body: NOTE, version: 99 })).status, 404);

  const thread = await call(db, FOUNDER, 'GET', '/narrative/notes');
  assert.equal(thread.status, 200);
  assert.deepEqual(thread.body.notes.map((n: any) => [n.body, n.author.kind]), [[NOTE, 'admin'], ['Moved it up.', 'founder']]);
  for (const who of [OTHER, INVESTOR]) {
    assert.equal((await call(db, who, 'GET', '/narrative/notes')).status, 403, String(who));
    assert.equal((await call(db, who, 'POST', '/narrative/notes', { body: NOTE })).status, 403, String(who));
  }
  assert.deepEqual(logs(db).filter((l) => l.action === 'narrative_note_posted').map((l) => l.details), [`Note posted on v${v}`, 'Note posted on the narrative']);
  assert.ok(!JSON.stringify(logs(db)).includes(NOTE), 'no activity row carries a note’s words');
});
