/**
 * #4188 (K1 of D4155): HQ's deck reports queue names the founder, the deck,
 * the card, what was asked and the area before and after; takes model and
 * reason filters; counts the queue (null when unreadable, never 0); and a
 * resolution needs a note the founder can read, kept in the audit row with
 * the admin's name. Synthetic data, the mounted Worker routes and the real
 * migrated schema; nothing runs a model.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_reports_queue_d4155.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import decks from '../src/routes/decks.ts';
import { deckReports, hqDeckReports, RESOLUTION_NOTE_MIN } from '../src/routes/deck_reports.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { loadSchema } from './_schema_once.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'deck-d4155-'));
const seedPath = join(scratch, 'schema.sqlite');
const schema = new DatabaseSync(seedPath, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
loadSchema(schema); schema.close();
after(() => rmSync(scratch, { recursive: true, force: true }));
let n = 0;
const JWT_SECRET = 'synthetic-d4155-only-not-a-real-credential'.repeat(2);
const PAGE = 'Founder · Raise · Pitch deck';
const ADMIN = 1;
const FOUNDER = 2;
const OTHER = 4;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/;

const SLIDES = [
  { uid: 'c1', title: 'Synthetic Co' },
  { uid: 'c2', title: 'Problem' },
  { uid: 'c3', title: 'Solution' },
  { uid: 'c4', title: 'Traction' },
  { uid: 'c5', card: 'team', title: '' },
];

/** `failing`: SQL fragments whose statements throw, as a table that cannot be read. */
async function fixture(failing: string[] = []) {
  const file = join(scratch, `case-${++n}.sqlite`);
  copyFileSync(seedPath, file);
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const insert = db.prepare('INSERT INTO users(id, uid, role, founder_id, name, email, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)');
  insert.run(ADMIN, 'u-admin', 'admin', null, 'Synthetic Admin Ada', 'synthetic-admin@example.invalid');
  insert.run(FOUNDER, 'u-founder', 'founder', 100, 'Synthetic Founder Fay', 'synthetic-founder@example.invalid');
  insert.run(OTHER, 'u-other', 'founder', 400, 'Synthetic Founder Oz', 'synthetic-other@example.invalid');
  db.exec("INSERT INTO projects(id,name,founder_id) VALUES (1,'Synthetic venture',100),(4,'Synthetic other venture',400)");
  db.prepare("INSERT INTO pitch_decks(id, project_id, version, slides, title, is_current, created_by) VALUES (7, 1, 3, ?, 'Synthetic seed deck', 1, ?)").run(JSON.stringify(SLIDES), FOUNDER);
  const real = d1Over(db);
  const DB = failing.length
    ? new Proxy(real, { get: (t: any, k) => (k === 'prepare'
      ? (sql: string) => { if (failing.some((f) => sql.includes(f))) throw new Error('synthetic: no such table'); return t.prepare(sql); }
      : t[k]) })
    : real;
  const env: any = { DB, JWT_SECRET, ENVIRONMENT: 'development' };
  const app = new Hono<any>().route('/api/decks', deckReports).route('/api/admin/deck-reports', hqDeckReports).route('/api/decks', decks);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  return { db, env, app, close: () => db.close() };
}
type F = Awaited<ReturnType<typeof fixture>>;

async function call(f: F, who: number, method: string, path: string, json?: unknown) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await f.app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, ...(json === undefined ? {} : { body: JSON.stringify(json) }) }, f.env);
  const text = await res.text();
  let body: any; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, text };
}

function proposal(f: F, uid: string, o: { user?: number; option?: string; record?: string | null; payload?: unknown; model?: string | null } = {}) {
  f.db.prepare(`INSERT INTO ai_rail_proposals (uid, user_id, rail_page, rail_option, record_ref, kind, payload_json, model)
    VALUES (?, ?, ?, ?, ?, 'proposal', ?, ?)`).run(uid, o.user ?? FOUNDER, PAGE, o.option ?? 'deck:shorten', o.record === undefined ? 'deck:7' : o.record,
    JSON.stringify(o.payload ?? {}), o.model === undefined ? '@cf/synthetic/model-a' : o.model);
}

async function report(f: F, uid: string, reason: string, note?: string, who = FOUNDER) {
  const r = await call(f, who, 'POST', `/api/decks/proposals/${uid}/report`, note ? { reason, note } : { reason });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.report.uid as string;
}

/** Three reports: a Shorten on card 4, an instruction on card 5 (by uid), and one that recorded nothing. */
async function seeded(f: F) {
  proposal(f, 'rp-short', { payload: { deck_id: 7, card: 3, card_uid: 'c4', action: 'shorten', before: 'Synthetic long words about growth.', after: 'Synthetic growth.' } });
  proposal(f, 'rp-ask', { option: 'deck:rewrite', model: '@cf/synthetic/model-b', payload: { deck_id: 7, card: 0, card_uid: 'c5', action: 'ask', instruction: 'Make it warmer', before: 'Synthetic team.', after: 'Our synthetic team.' } });
  proposal(f, 'rp-bare', { user: OTHER, option: 'deck:area', record: null, model: null, payload: {} });
  return {
    short: await report(f, 'rp-short', 'poor_writing', 'Synthetic founder complaint.'),
    ask: await report(f, 'rp-ask', 'wrong_place'),
    bare: await report(f, 'rp-bare', 'other', undefined, OTHER),
  };
}

const byUid = (body: any) => new Map<string, any>((body.reports ?? []).map((r: any) => [r.uid, r]));

test('each report names the founder, deck, card, what was asked and the words before and after', async () => {
  const f = await fixture();
  try {
    const u = await seeded(f);
    const q = await call(f, ADMIN, 'GET', '/api/admin/deck-reports');
    assert.equal(q.status, 200, JSON.stringify(q.body));
    const rows = byUid(q.body);
    const s = rows.get(u.short);
    assert.deepEqual(s.founder, { uid: 'u-founder', name: 'Synthetic Founder Fay' });
    assert.deepEqual(s.deck, { uid: '7', title: 'Synthetic seed deck', version: 3 });
    assert.deepEqual(s.card, { index: 3, label: 'Card 4 · Traction' });
    assert.equal(s.asked, 'Shorten');
    assert.equal(s.before, 'Synthetic long words about growth.');
    assert.equal(s.after, 'Synthetic growth.');
    const a = rows.get(u.ask);
    // By uid first: the card moved to place 4 since the payload's place 0 was written; the catalogue names an untitled card.
    assert.deepEqual(a.card, { index: 4, label: 'Card 5 · Team' });
    assert.equal(a.asked, 'Instruction · “Make it warmer”');
    assert.deepEqual([a.before, a.after], ['Synthetic team.', 'Our synthetic team.']);
    // Nothing recorded reads null, never "" or 0.
    const b = rows.get(u.bare);
    assert.deepEqual(b.founder, { uid: 'u-other', name: 'Synthetic Founder Oz' });
    assert.deepEqual([b.deck, b.card, b.asked, b.before, b.after, b.model], [null, null, null, null, null, null]);
  } finally { f.close(); }
});

test('a press without a note recorded still reads its label; a new-deck run reads its option; a gone deck reads null', async () => {
  const f = await fixture();
  try {
    proposal(f, 'rp-tone', { payload: { deck_id: 7, card: 1, action: 'tone', tone: 'warm', before: 'x' } });
    proposal(f, 'rp-outline', { option: 'deck:outline', record: 'project:1', payload: { rows: [] } });
    proposal(f, 'rp-gone', { record: 'deck:99', payload: { deck_id: 99, card: 2, action: 'expand' } });
    proposal(f, 'rp-notes', { option: 'deck:notes', payload: { deck_id: 7, action: 'speaker_notes', cards: [{ card_uid: 'c2', index: 1, notes: { before: '', after: 'Synthetic notes.' } }] } });
    const u = { tone: await report(f, 'rp-tone', 'other'), outline: await report(f, 'rp-outline', 'other'), gone: await report(f, 'rp-gone', 'other'), notes: await report(f, 'rp-notes', 'other') };
    const rows = byUid((await call(f, ADMIN, 'GET', '/api/admin/deck-reports')).body);
    assert.deepEqual([rows.get(u.tone).asked, rows.get(u.tone).card, rows.get(u.tone).before, rows.get(u.tone).after], ['Change tone · warm', { index: 1, label: 'Card 2 · Problem' }, 'x', null]);
    assert.deepEqual([rows.get(u.outline).asked, rows.get(u.outline).deck, rows.get(u.outline).card], ['Outline', null, null]);
    assert.deepEqual([rows.get(u.gone).deck, rows.get(u.gone).card, rows.get(u.gone).asked], [null, { index: 2, label: 'Card 3' }, 'Expand']);
    assert.deepEqual([rows.get(u.notes).asked, rows.get(u.notes).card, rows.get(u.notes).before, rows.get(u.notes).after], ['Speaker notes', { index: 1, label: 'Card 2 · Problem' }, null, 'Synthetic notes.']);
  } finally { f.close(); }
});

test('no email anywhere in the queue or a resolution, and no founder note in the audit', async () => {
  const f = await fixture();
  try {
    const u = await seeded(f);
    const q = await call(f, ADMIN, 'GET', '/api/admin/deck-reports?status=all');
    const done = await call(f, ADMIN, 'POST', `/api/admin/deck-reports/${u.short}/resolve`, { outcome: 'addressed', note: 'Synthetic fix shipped to the rewrite prompt.' });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    for (const r of [q, done]) {
      assert.ok(!EMAIL.test(r.text), r.text);
      assert.ok(!r.text.includes('example.invalid'));
    }
    assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM admin_audit_log').all()).includes('Synthetic founder complaint'));
  } finally { f.close(); }
});

test('a resolution needs a note of at least 10 characters, and the founder reads it on their report', async () => {
  const f = await fixture();
  try {
    const u = await seeded(f);
    const path = `/api/admin/deck-reports/${u.short}/resolve`;
    for (const note of [undefined, '', '   ', 'too short', `  ${'x'.repeat(RESOLUTION_NOTE_MIN - 1)}  `]) {
      const r = await call(f, ADMIN, 'POST', path, note === undefined ? { outcome: 'addressed' } : { outcome: 'addressed', note });
      assert.equal(r.status, 400, String(note));
      assert.equal(r.body.error, 'note_required');
    }
    assert.equal((f.db.prepare('SELECT status FROM deck_proposal_reports WHERE uid = ?').get(u.short) as any).status, 'open', 'nothing was resolved');
    const ok = await call(f, ADMIN, 'POST', path, { outcome: 'no_fault', note: ` ${'y'.repeat(RESOLUTION_NOTE_MIN)} ` });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.report.resolution_note, 'y'.repeat(RESOLUTION_NOTE_MIN));
    // The founder's own read of their report (the 409 that answers a second report) carries the note.
    const again = await call(f, FOUNDER, 'POST', '/api/decks/proposals/rp-short/report', { reason: 'other' });
    assert.equal(again.status, 409);
    assert.equal(again.body.report.resolution_note, 'y'.repeat(RESOLUTION_NOTE_MIN));
  } finally { f.close(); }
});

test('the audit row keeps the note and names the admin', async () => {
  const f = await fixture();
  try {
    const u = await seeded(f);
    await call(f, ADMIN, 'POST', `/api/admin/deck-reports/${u.ask}/resolve`, { outcome: 'addressed', note: 'Synthetic placement rule fixed.' });
    const row = f.db.prepare("SELECT admin_user_id, filters_json FROM admin_audit_log WHERE action = 'deck_report_resolved'").get() as any;
    assert.equal(row.admin_user_id, ADMIN);
    const d = JSON.parse(row.filters_json);
    assert.equal(d.note, 'Synthetic placement rule fixed.');
    assert.deepEqual(d.admin, { uid: 'u-admin', name: 'Synthetic Admin Ada' });
    assert.equal(d.report_uid, u.ask);
    assert.ok(!EMAIL.test(row.filters_json));
  } finally { f.close(); }
});

test('model and reason filter the queue by exact value; an unknown reason or an overlong model is refused', async () => {
  const f = await fixture();
  try {
    const u = await seeded(f);
    const uids = async (qs: string) => {
      const r = await call(f, ADMIN, 'GET', `/api/admin/deck-reports?${qs}`);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return r.body.reports.map((x: any) => x.uid).sort();
    };
    assert.deepEqual(await uids('model=%40cf%2Fsynthetic%2Fmodel-b'), [u.ask]);
    assert.deepEqual(await uids('model=%40cf%2Fsynthetic'), [], 'exact, not a prefix');
    assert.deepEqual(await uids('reason=poor_writing'), [u.short]);
    assert.deepEqual(await uids('reason=wrong_place&model=%40cf%2Fsynthetic%2Fmodel-a'), []);
    assert.deepEqual(await uids('reason=&model='), [u.short, u.ask, u.bare].sort(), 'empty filters are no filter');
    const bad = await call(f, ADMIN, 'GET', '/api/admin/deck-reports?reason=made_up');
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'invalid_reason');
    const long = await call(f, ADMIN, 'GET', `/api/admin/deck-reports?model=${'m'.repeat(201)}`);
    assert.equal(long.status, 400);
    assert.equal(long.body.error, 'invalid_model');
  } finally { f.close(); }
});

test('counts: open now and resolved this week, whatever the filters', async () => {
  const f = await fixture();
  try {
    const u = await seeded(f);
    await call(f, ADMIN, 'POST', `/api/admin/deck-reports/${u.short}/resolve`, { outcome: 'addressed', note: 'Synthetic fix shipped.' });
    await call(f, ADMIN, 'POST', `/api/admin/deck-reports/${u.bare}/resolve`, { outcome: 'no_fault', note: 'Synthetic: nothing wrong.' });
    // One resolved long ago does not count this week.
    f.db.prepare("UPDATE deck_proposal_reports SET resolved_at = datetime('now', '-30 days') WHERE uid = ?").run(u.bare);
    const q = await call(f, ADMIN, 'GET', '/api/admin/deck-reports?reason=other');
    assert.deepEqual(q.body.counts, { open: 1, resolved_this_week: 1 });
    await call(f, ADMIN, 'POST', `/api/admin/deck-reports/${u.ask}/resolve`, { outcome: 'addressed', note: 'Synthetic fix shipped.' });
    assert.deepEqual((await call(f, ADMIN, 'GET', '/api/admin/deck-reports')).body.counts, { open: 0, resolved_this_week: 2 }, 'a read 0 is a real 0');
  } finally { f.close(); }
});

test('a count that cannot be read is null, never 0, and the queue still answers', async () => {
  const f = await fixture(['COUNT(*) AS n FROM deck_proposal_reports']);
  try {
    await seeded(f);
    const q = await call(f, ADMIN, 'GET', '/api/admin/deck-reports');
    assert.equal(q.status, 200, JSON.stringify(q.body));
    assert.equal(q.body.reports.length, 3);
    assert.deepEqual(q.body.counts, { open: null, resolved_this_week: null });
  } finally { f.close(); }
  // Each count on its own: one failing read nulls only its own count.
  const g = await fixture(["WHERE status = 'resolved' AND resolved_at"]);
  try {
    await seeded(g);
    assert.deepEqual((await call(g, ADMIN, 'GET', '/api/admin/deck-reports')).body.counts, { open: 3, resolved_this_week: null });
  } finally { g.close(); }
  // The deck versions unreadable: the rows' decks read null, the queue still answers.
  const h = await fixture(['FROM pitch_decks WHERE id IN']);
  try {
    const u = await seeded(h);
    const q = await call(h, ADMIN, 'GET', '/api/admin/deck-reports');
    assert.equal(q.status, 200);
    const s = byUid(q.body).get(u.short);
    assert.deepEqual([s.deck, s.card], [null, { index: 3, label: 'Card 4' }]);
  } finally { h.close(); }
});

test('requireHqAdmin: a founder and a branch admin are refused the queue and the resolve', async () => {
  const f = await fixture();
  try {
    const u = await seeded(f);
    const note = { outcome: 'addressed', note: 'Synthetic fix shipped.' };
    assert.equal((await call(f, FOUNDER, 'GET', '/api/admin/deck-reports')).status, 403);
    assert.equal((await call(f, FOUNDER, 'POST', `/api/admin/deck-reports/${u.short}/resolve`, note)).status, 403);
    f.env.BRANCH_CODE = 'syn';
    assert.equal((await call(f, ADMIN, 'GET', '/api/admin/deck-reports')).status, 403, 'a branch admin cannot read');
    assert.equal((await call(f, ADMIN, 'POST', `/api/admin/deck-reports/${u.short}/resolve`, note)).status, 403, 'a branch admin cannot resolve');
    assert.equal((f.db.prepare('SELECT status FROM deck_proposal_reports WHERE uid = ?').get(u.short) as any).status, 'open');
  } finally { f.close(); }
});

test('every statement in deck_reports.ts is bound, never interpolated', () => {
  const src = readFileSync(new URL('../src/routes/deck_reports.ts', import.meta.url), 'utf8');
  assert.ok(!/prepare\(\s*`[^`]*\$\{/.test(src));
});
