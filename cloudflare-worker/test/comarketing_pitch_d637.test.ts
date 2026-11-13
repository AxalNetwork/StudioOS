/**
 * D637 (#1395) — one co-marketing pitch on its own page: read by its owner or
 * an admin, edited only while Proposed, locked with a sentence once it is
 * not, and a visit recorded from the Published feed without storing the
 * viewer's address as a lead. Every write records its actor.
 *
 * Harness as `comarketing_founder_read.test.ts`: the real router on real
 * `node:sqlite`, tables from `schema_baseline.sql`.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/comarketing_pitch_d637.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import comarketing, { lockedPitchSentence } from '../src/routes/comarketing.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const PIA = 3;   // partner 7, owns the pitches
const QUO = 5;   // partner 8, owns none
const ADA = 4;   // admin
const FAY = 1;   // founder, reads the Published feed
const ROLE: Record<number, string> = { [FAY]: 'founder', [PIA]: 'partner', [QUO]: 'partner', [ADA]: 'admin' };

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const t of ['users', 'partners', 'comarketing_pitches', 'comarketing_attributions', 'user_company_links']) {
    db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  }
  db.exec(`CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, user_id INTEGER,
    action TEXT NOT NULL, details TEXT, actor TEXT)`);
  const u = db.prepare('INSERT INTO users (id, email, role, name, partner_id) VALUES (?,?,?,?,?)');
  u.run(FAY, 'fay@axal.example', 'founder', 'Fay Founder', null);
  u.run(PIA, 'pia@agency.example', 'partner', 'Pia Partner', 7);
  u.run(QUO, 'quo@other.example', 'partner', 'Quo Partner', 8);
  u.run(ADA, 'ada@axal.example', 'admin', 'Ada Admin', null);
  db.prepare(`INSERT INTO partners (id, name, company, email) VALUES (7, 'Pia Partner', 'Loud Agency', 'pia@agency.example')`).run();
  db.prepare(`INSERT INTO partners (id, name, company, email) VALUES (8, 'Quo Partner', 'Quiet Agency', 'quo@other.example')`).run();
  const p = db.prepare(`INSERT INTO comarketing_pitches (id, uid, partner_id, submitter_user_id, title, summary, asset_type, status, attribution_code, reviewed_at, angle, created_at, updated_at)
                        VALUES (?,?,7,?,?,?,?,?,?,?,?,?,?)`);
  p.run(1, 'pitch-proposed', PIA, 'Webinar on fintech', 'A long enough summary', 'webinar', 'proposed', null, null, 'One sharp line', '2026-09-01', '2026-09-01');
  p.run(2, 'pitch-approved', PIA, 'Approved blog', 'Another summary here', 'blog', 'approved', 'code-appr', '2026-10-12', null, '2026-09-02', '2026-09-02');
  p.run(3, 'pitch-published', PIA, 'Published podcast', 'A third summary', 'podcast', 'published', 'code-pub', '2026-10-01', null, '2026-09-03', '2026-09-03');
  p.run(4, 'pitch-rejected', PIA, 'Rejected', 'Rejected summary', 'event', 'rejected', null, '2026-10-02', null, '2026-09-04', '2026-09-04');
  return db;
}

async function call(db: InstanceType<typeof DatabaseSync>, as: number, method: string, path: string, body?: unknown) {
  const app = new Hono<any>();
  app.route('/api/comarketing', comarketing);
  app.onError((err: any, c) => {
    const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
    if (s) return c.json({ detail: err.message }, s);
    throw err;
  });
  const token = await new SignJWT({ user_id: as, role: ROLE[as] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(`/api/comarketing${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, { DB: d1Over(db), JWT_SECRET } as any);
  const text = await res.text();
  let out: any = {};
  try { out = JSON.parse(text); } catch { /* the status says it */ }
  return { status: res.status, body: out, text };
}
const logs = (db: InstanceType<typeof DatabaseSync>) => db.prepare('SELECT user_id, action, details, actor FROM activity_logs ORDER BY id').all() as any[];

test('D637: one pitch is read by its owner or an admin, and is a 404 to anyone else', async () => {
  const db = freshDb();
  const mine = await call(db, PIA, 'GET', '/me/pitches/pitch-proposed');
  assert.equal(mine.status, 200);
  assert.equal(mine.body.title, 'Webinar on fintech');
  assert.equal(mine.body.angle, 'One sharp line');
  assert.deepEqual(mine.body.attribution, { visit: 0, signup: 0, lead: 0, conversion: 0, total: 0 });
  assert.equal((await call(db, ADA, 'GET', '/me/pitches/pitch-proposed')).status, 200);
  const other = await call(db, QUO, 'GET', '/me/pitches/pitch-proposed');
  assert.equal(other.status, 404);
  assert.match(other.body.message, /does not exist, or it is not yours/);
  assert.equal((await call(db, ADA, 'GET', '/me/pitches/nope')).status, 404);
  assert.equal((await call(db, FAY, 'GET', '/me/pitches/pitch-proposed')).status, 403, 'a founder is not a partner');
});

test('D637: a proposed pitch is edited, and the edit records its actor and fields', async () => {
  const db = freshDb();
  const r = await call(db, PIA, 'PATCH', '/me/pitches/pitch-proposed', { title: 'Webinar on payments', angle: 'Sharper line' });
  assert.equal(r.status, 200);
  assert.equal(r.body.title, 'Webinar on payments');
  assert.equal(r.body.angle, 'Sharper line');
  const [row] = logs(db);
  assert.equal(row.action, 'comarketing_pitch_edited');
  assert.equal(row.user_id, PIA);
  assert.deepEqual(JSON.parse(row.details), { pitch_uid: 'pitch-proposed', fields: ['title', 'angle'] });
  assert.ok(!row.details.includes('payments'), 'no typed text in the log line');
});

test('D637: an edit cannot empty what create requires', async () => {
  const db = freshDb();
  const t = await call(db, PIA, 'PATCH', '/me/pitches/pitch-proposed', { title: 'ab' });
  assert.equal(t.status, 400);
  assert.equal(t.body.message, 'Give the pitch a title of at least 3 characters.');
  const s = await call(db, PIA, 'PATCH', '/me/pitches/pitch-proposed', { summary: 'short' });
  assert.equal(s.status, 400);
  assert.match(s.body.message, /at least 10 characters/);
  const a = await call(db, PIA, 'PATCH', '/me/pitches/pitch-proposed', { asset_type: 'tiktok' });
  assert.match(a.body.message, /webinar, blog post, podcast/);
  assert.equal((await call(db, PIA, 'GET', '/me/pitches/pitch-proposed')).body.title, 'Webinar on fintech');
  assert.equal(logs(db).length, 0);
});

test('D637: a pitch that is not Proposed is locked, with its sentence', async () => {
  const db = freshDb();
  for (const [uid, status] of [['pitch-approved', 'approved'], ['pitch-published', 'published'], ['pitch-rejected', 'rejected']]) {
    const r = await call(db, PIA, 'PATCH', `/me/pitches/${uid}`, { title: 'Changed title' });
    assert.equal(r.status, 409, uid);
    assert.equal(r.body.error, 'pitch_locked');
    assert.equal(r.body.status, status);
    assert.equal(r.body.message, lockedPitchSentence(status));
  }
  assert.match(lockedPitchSentence('approved'), /withdraw it and propose again/);
  assert.match(lockedPitchSentence('withdrawn'), /Propose a new one/);
  assert.equal((await call(db, PIA, 'GET', '/me/pitches/pitch-approved')).body.title, 'Approved blog');
});

test('D637: withdrawing records its actor; a published pitch says why it cannot be', async () => {
  const db = freshDb();
  const ok = await call(db, PIA, 'POST', '/me/pitches/pitch-approved/withdraw');
  assert.equal(ok.body.status, 'withdrawn');
  assert.deepEqual(logs(db).map((r) => [r.action, JSON.parse(r.details).from_status]), [['comarketing_pitch_withdrawn', 'approved']]);
  const no = await call(db, PIA, 'POST', '/me/pitches/pitch-published/withdraw');
  assert.equal(no.status, 409);
  assert.match(no.body.message, /published, so it can no longer be withdrawn/);
});

test('D637: a visit from the Published feed is counted on the pitch, and does not store the viewer as a lead', async () => {
  const db = freshDb();
  const v = await call(db, FAY, 'POST', '/track', { code: 'code-pub', event_kind: 'visit', landing_path: '/comarketing' });
  assert.equal(v.status, 200);
  const row = db.prepare('SELECT user_id, event_kind, lead_email FROM comarketing_attributions').get() as any;
  assert.deepEqual({ ...row }, { user_id: FAY, event_kind: 'visit', lead_email: null });
  assert.equal((await call(db, PIA, 'GET', '/me/pitches/pitch-published')).body.attribution.visit, 1);

  await call(db, FAY, 'POST', '/track', { code: 'code-pub', event_kind: 'lead' });
  const lead = db.prepare(`SELECT lead_email FROM comarketing_attributions WHERE event_kind = 'lead'`).get() as any;
  assert.equal(lead.lead_email, 'fay@axal.example', 'a lead still records who');

  const dead = await call(db, FAY, 'POST', '/track', { code: 'nope' });
  assert.equal(dead.status, 404);
  assert.match(dead.body.message, /No pitch carries/);
  db.prepare(`UPDATE comarketing_pitches SET attribution_code = 'code-rej' WHERE uid = 'pitch-rejected'`).run();
  const off = await call(db, FAY, 'POST', '/track', { code: 'code-rej' });
  assert.equal(off.status, 409);
  assert.match(off.body.message, /not live/);
});

test('D637: a failed log line never undoes the edit', async () => {
  const db = freshDb();
  db.exec('DROP TABLE activity_logs');
  const r = await call(db, PIA, 'PATCH', '/me/pitches/pitch-proposed', { title: 'Still saved' });
  assert.equal(r.status, 200);
  assert.equal(r.body.title, 'Still saved');
});
