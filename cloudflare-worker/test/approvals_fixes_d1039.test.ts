// D1039 (#2887): Approvals part 1's fixes. The Perks queue holds only listings
// in review; co-marketing decisions are behind requireAdmin, and a decline
// needs a reason; the Exploring lane counts Explorers who signed. Real SQLite
// from the baseline and the whole migration chain; synthetic accounts only.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import perks from '../src/routes/perks.ts';
import comarketing, { DECLINE_REASON_MIN } from '../src/routes/comarketing.ts';
import { APPROVAL_SOURCES, approvalBoard, laneCounts } from '../src/services/approvalSources.ts';
import { queuePressure } from '../src/services/branchHome.ts';
import { studioGlance } from '../src/services/studioGlance.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';

const read = (p: string) => readFileSync(p, 'utf8');
const DIR = 'cloudflare-worker/sql/migrations';
const scratch = mkdtempSync(join(tmpdir(), 'approvals-d1039-'));
const seed = join(scratch, 'chain.sqlite');
{
  const db = new DatabaseSync(seed, { enableForeignKeyConstraints: false });
  db.exec(read('cloudflare-worker/sql/schema_baseline.sql'));
  for (const name of readdirSync(DIR).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort()) db.exec(read(`${DIR}/${name}`));
  db.close();
}
after(() => rmSync(scratch, { recursive: true, force: true }));

// A low-entropy signing key built at run time, so no literal reads as a credential.
const SECRET = 'x'.repeat(48);
const ADMIN = 1; const FROZEN = 2; const PARTNER = 3; const FOUNDER = 4;

let serial = 0;
function fixture() {
  const file = join(scratch, `${++serial}.sqlite`);
  copyFileSync(seed, file);
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false });
  db.exec(`
    INSERT INTO users (id, role, name, email, is_active, partner_id) VALUES
      (1, 'admin', 'Synthetic admin', 'admin@example.invalid', 1, NULL),
      (2, 'admin', 'Frozen admin', 'frozen@example.invalid', 1, NULL),
      (3, 'partner', 'Synthetic partner', 'partner@example.invalid', 1, 7),
      (4, 'founder', 'Synthetic founder', 'founder@example.invalid', 1, NULL);
    INSERT INTO partners (id, name, company, email) VALUES (7, 'Synthetic partner', 'Synthetic Agency', 'partner@example.invalid');
    INSERT INTO admin_notices (uid, user_id, kind, subject, body, respond_by, status)
      VALUES ('notice-1', 2, 'fees', 'Synthetic notice', 'Synthetic body', '2026-01-01 00:00:00', 'overdue');
  `);
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' };
  const app = new Hono<any>();
  app.route('/api/perks', perks);
  app.route('/api/comarketing', comarketing);
  app.onError((err: any, c) => c.json({ error: err.message }, (AUTH_ERROR_STATUSES[String(err?.message || '')] || 500) as any));
  return { db, env, app };
}
type F = ReturnType<typeof fixture>;

async function call(f: F, who: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const res = await f.app.request(path, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, f.env);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const one = (f: F, sql: string, ...a: any[]) => f.db.prepare(sql).get(...a) as any;

/* ------------------------------------------------------------------ Perks */

function perk(f: F, uid: string, status: string, created: string) {
  f.db.prepare(`INSERT INTO perks (uid, partner_user_id, partner_name, category, offer, kind, credits, fulfilment, status, created_at, updated_at)
    VALUES (?, 3, 'Synthetic partner', 'Other', ?, 'credits', 10, 'code', ?, ?, ?)`).run(uid, `Offer ${uid}`, status, created, created);
}

test('the Perks queue holds only listings in review: a draft is nobody\'s to review', async () => {
  const f = fixture();
  f.db.exec('DELETE FROM perks'); // the chain seeds a live catalogue; this test holds its own rows
  perk(f, 'p-review-old', 'in_review', '2026-10-01 00:00:00');
  perk(f, 'p-draft', 'draft', '2026-09-01 00:00:00');
  perk(f, 'p-review-new', 'in_review', '2026-10-05 00:00:00');
  perk(f, 'p-live', 'live', '2026-08-01 00:00:00');
  const q = await call(f, ADMIN, 'GET', '/api/perks/admin/queue');
  assert.equal(q.status, 200);
  assert.deepEqual(q.body.items.map((p: any) => p.uid), ['p-review-old', 'p-review-new'], 'in review only, oldest first');
  const drafts = await call(f, ADMIN, 'GET', '/api/perks/admin/listings?status=draft');
  assert.deepEqual(drafts.body.items.map((p: any) => p.uid), ['p-draft'], 'Listings still shows a draft under its own status');
  assert.ok([401, 403].includes((await call(f, PARTNER, 'GET', '/api/perks/admin/queue')).status));
});

/* ----------------------------------------------------------- Co-marketing */

function pitch(f: F, id: number, uid: string, status: string, created: string) {
  f.db.prepare(`INSERT INTO comarketing_pitches (id, uid, partner_id, submitter_user_id, title, summary, asset_type, status, created_at, updated_at)
    VALUES (?, ?, 7, 3, ?, 'A synthetic summary', 'webinar', ?, ?, ?)`).run(id, uid, `Pitch ${uid}`, status, created, created);
}

test('co-marketing decisions are behind requireAdmin: the HQ freeze refuses a frozen admin\'s decision, never a read', async () => {
  const f = fixture();
  pitch(f, 1, 'pitch-a', 'proposed', '2026-10-01 00:00:00');
  assert.equal((await call(f, FROZEN, 'GET', '/api/comarketing/admin/queue')).status, 200, 'a read is never frozen');
  const frozen = await call(f, FROZEN, 'POST', '/api/comarketing/admin/pitches/pitch-a/approve', {});
  assert.equal(frozen.status, 423, 'the freeze refuses the decision');
  assert.equal(one(f, "SELECT status FROM comarketing_pitches WHERE uid = 'pitch-a'").status, 'proposed', 'nothing changed');
  for (const who of [PARTNER, FOUNDER]) {
    assert.equal((await call(f, who, 'GET', '/api/comarketing/admin/queue')).status, 403);
    assert.equal((await call(f, who, 'POST', '/api/comarketing/admin/pitches/pitch-a/approve', {})).status, 403);
  }
  const ok = await call(f, ADMIN, 'POST', '/api/comarketing/admin/pitches/pitch-a/approve', {});
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, 'approved');
});

test('a decline needs a reason of at least 10 characters, refused with a code; the partner reads the reason', async () => {
  const f = fixture();
  pitch(f, 1, 'pitch-b', 'proposed', '2026-10-01 00:00:00');
  assert.equal(DECLINE_REASON_MIN, 10);
  for (const notes of [undefined, '', '   ', 'too short', '  nine ch  ']) {
    const r = await call(f, ADMIN, 'POST', '/api/comarketing/admin/pitches/pitch-b/reject', notes === undefined ? {} : { notes });
    assert.equal(r.status, 400, `${JSON.stringify(notes)} is refused`);
    assert.equal(r.body.error, 'reason_required');
    assert.match(r.body.message || r.body.detail || '', /at least 10 characters/);
  }
  assert.equal(one(f, "SELECT status FROM comarketing_pitches WHERE uid = 'pitch-b'").status, 'proposed', 'nothing was declined');
  const declined = await call(f, ADMIN, 'POST', '/api/comarketing/admin/pitches/pitch-b/reject', { notes: '  Not a fit for this quarter.  ' });
  assert.equal(declined.status, 200);
  assert.equal(declined.body.status, 'rejected');
  assert.equal(one(f, "SELECT review_notes FROM comarketing_pitches WHERE uid = 'pitch-b'").review_notes, 'Not a fit for this quarter.', 'stored trimmed');
  const mine = await call(f, PARTNER, 'GET', '/api/comarketing/me/pitches/pitch-b');
  assert.equal(mine.status, 200);
  assert.equal(mine.body.review_notes, 'Not a fit for this quarter.', 'the partner sees why');
  // Approve and publish take an optional note, as before.
  pitch(f, 2, 'pitch-c', 'proposed', '2026-10-02 00:00:00');
  assert.equal((await call(f, ADMIN, 'POST', '/api/comarketing/admin/pitches/pitch-c/approve', {})).status, 200);
});

/* ------------------------------------------------------------ Exploring */

function explorer(f: F, id: number, opts: { envelope?: { status: string; owner?: number } | null; onboarded?: string } = {}) {
  f.db.prepare("INSERT INTO users (id, role, name, email, is_active, created_at) VALUES (?, 'exploring', ?, ?, 1, '2026-09-01 00:00:00')")
    .run(id, `Explorer ${id}`, `explorer${id}@example.invalid`);
  let envId: number | null = null;
  if (opts.envelope) {
    envId = Number(f.db.prepare(`INSERT INTO esign_envelopes (envelope_uuid, user_id, document_type, document_title, document_body, body_sha256, status, created_by)
      VALUES (?, ?, 'binding_agreement', 'Binding agreement', 'Synthetic', 'synthetic', ?, 1)`).run(`env-${id}`, opts.envelope.owner ?? id, opts.envelope.status).lastInsertRowid);
  }
  f.db.prepare('INSERT INTO user_role_review (user_id, suggested_role, onboarded_at, binding_envelope_id) VALUES (?, ?, ?, ?)')
    .run(id, 'investor', opts.onboarded ?? '2026-10-01 00:00:00', envId);
}

test('the Exploring lane counts Explorers who signed and have no role yet; the unsent are its sub-count', async () => {
  const f = fixture();
  explorer(f, 10, { envelope: { status: 'completed' }, onboarded: '2026-10-03 00:00:00' }); // signed: counts
  explorer(f, 11, { envelope: { status: 'COMPLETED' }, onboarded: '2026-10-02 00:00:00' }); // signed, any case: counts
  explorer(f, 12, { envelope: { status: 'sent' } });                                        // sent, not signed
  explorer(f, 13, { envelope: null });                                                     // no agreement sent
  explorer(f, 14, { envelope: null });                                                     // no agreement sent
  explorer(f, 15, { envelope: { status: 'completed', owner: ADMIN } });                    // someone else's envelope
  // A signed account that already has its role has left the queue.
  f.db.prepare("INSERT INTO users (id, role, name, email, is_active) VALUES (16, 'investor', 'Has a role', 'role@example.invalid', 1)").run();
  const env16 = Number(f.db.prepare(`INSERT INTO esign_envelopes (envelope_uuid, user_id, document_type, document_title, document_body, body_sha256, status, created_by)
    VALUES ('env-16', 16, 'binding_agreement', 'B', 'S', 's', 'completed', 1)`).run().lastInsertRowid);
  f.db.prepare('INSERT INTO user_role_review (user_id, binding_envelope_id) VALUES (16, ?)').run(env16);

  const lane = (await laneCounts(f.env)).find((l) => l.key === 'exploring')!;
  assert.equal(lane.count, 2, 'only 10 and 11');
  assert.equal(lane.oldest_at, '2026-10-02 00:00:00', 'the oldest of the signed');
  assert.deepEqual(lane.sub, { holding: 6, no_agreement_sent: 2 }, 'every account in the holding role, and those never sent an agreement');
  const board = await approvalBoard(f.env, 100);
  assert.deepEqual(board.items.filter((i: any) => i.lane === 'exploring').map((i: any) => i.id).sort(), [10, 11], 'the rows match the count');
  const pressure = (await queuePressure(f.env)).queue_pressure.find((l) => l.key === 'exploring')!;
  assert.deepEqual(pressure.sub, { holding: 6, no_agreement_sent: 2 }, 'the sub-count reaches the glance');
  assert.ok(APPROVAL_SOURCES.filter((s) => s.subSql).every((s) => s.key === 'exploring'), 'only the Exploring lane has one');
});

test("HQ's Accounts tile still counts every account in the holding role", async () => {
  const f = fixture();
  explorer(f, 10, { envelope: { status: 'completed' } });
  explorer(f, 13, { envelope: null });
  explorer(f, 14, { envelope: null });
  const g: any = await studioGlance(f.env);
  assert.equal(g.tier, 'hq');
  assert.equal(g.accounts.exploring, 3, 'all three are in the holding role');
  assert.equal(g.approvals.lanes.find((l: any) => l.key === 'exploring').count, 1, 'one is ready for a role');
});

test('a failed sub-count is null and leaves the lane counted; a failed lane reads null, never zero', async () => {
  const f = fixture();
  explorer(f, 10, { envelope: { status: 'completed' } });
  const sub = APPROVAL_SOURCES.find((s) => s.key === 'exploring')!.subSql!;
  const original = f.env.DB;
  f.env.DB = { ...original, prepare(sql: string) {
    if (sql === sub) throw new Error('synthetic sub-count failure');
    return original.prepare(sql);
  } };
  const lane = (await laneCounts(f.env)).find((l) => l.key === 'exploring')!;
  assert.equal(lane.count, 1);
  assert.equal(lane.sub, null);
  f.env.DB = original;
  f.db.exec('DROP TABLE esign_envelopes');
  const unread = (await laneCounts(f.env)).find((l) => l.key === 'exploring')!;
  assert.equal(unread.count, null, 'unreadable, never 0');
});
