/**
 * D1229 (#3237, KYC part 1) — the people queue, one person's case, Needs
 * information and Expired, the re-check, several documents, the member's
 * notices and the figures, on the database the repo's schema story builds
 * (`buildFresh`: the baseline plus every later migration, 614 among them).
 *
 * The issue's four tests, and what holds them:
 *   - every read still logs: one `kyc_queue_access`, `kyc_figures_access` or
 *     `kyc_case_access` row per read, naming no identity value;
 *   - a decision without step-up is refused, and writes nothing;
 *   - paging and counts agree: the pages put together are the total, and the
 *     counts per status add up to it;
 *   - an expired check can be resubmitted.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/kyc_people_queue_d1229.test.ts
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import kyc from '../src/routes/kyc.ts';
import { expireDueArtifacts } from '../src/services/trust.ts';
import { median, noticeFor, parseQueueQuery, waitBand } from '../src/services/kycCase.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { buildFresh, postCutoffMigrations } from '../../scripts/check-baseline-drift.mjs';

const ROOT = process.cwd();
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const LATER = (postCutoffMigrations(ROOT) as Array<{ sql: string }>).map((m) => m.sql);
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const ADMIN = 1;
const OTHER_ADMIN = 2;
// Invented members. Identity values a log must never carry.
const ID_NUMBER = 'X9081726';
const DOB = '1985-03-04';
const SECRETS = [ID_NUMBER, DOB, '7 Hidden Lane'];

type Seed = { id: number; name: string; status: string; daysAgo: number | null; idType?: string; country?: string; pep?: boolean; fail?: boolean; doc?: boolean };
const SEEDS: Seed[] = [
  { id: 10, name: 'Alma Oldest', status: 'pending', daysAgo: 9, idType: 'passport', country: 'GB', doc: true },
  { id: 11, name: 'Bea Second', status: 'pending', daysAgo: 4, idType: 'national_id', country: 'FR', pep: true, doc: true },
  { id: 12, name: 'Cal Third', status: 'pending', daysAgo: 2, idType: 'passport', country: 'gb' },
  { id: 13, name: 'Dee Newest', status: 'pending', daysAgo: 0.2, idType: 'driver_license', country: 'US', doc: true },
  { id: 14, name: 'Eli Approved', status: 'approved', daysAgo: 30, idType: 'passport', country: 'GB', doc: true },
  { id: 15, name: 'Fay Rejected', status: 'rejected', daysAgo: 20, idType: 'passport', country: 'DE', fail: true },
  { id: 16, name: 'Gus Asked', status: 'needs_info', daysAgo: 5, idType: 'passport', country: 'GB', doc: true },
  { id: 17, name: 'Hal Never', status: 'not_started', daysAgo: null },
];

function freshDb() {
  const db = buildFresh(BASELINE, LATER, { dqs: true });
  db.exec('PRAGMA foreign_keys = OFF;');
  db.prepare("INSERT INTO users (id, role, name, email, is_active, kyc_status) VALUES (?, 'admin', 'Ada Admin', 'ada@hq.example', 1, 'not_started')").run(ADMIN);
  db.prepare("INSERT INTO users (id, role, name, email, is_active, kyc_status) VALUES (?, 'admin', 'Ozzie Other', 'ozzie@hq.example', 1, 'not_started')").run(OTHER_ADMIN);
  for (const s of SEEDS) {
    const data = s.status === 'not_started' ? null : JSON.stringify({
      legal_first_name: s.name.split(' ')[0], legal_last_name: s.name.split(' ')[1], date_of_birth: DOB,
      country: s.country, address_line1: '7 Hidden Lane', id_type: s.idType, id_number: ID_NUMBER,
      pep_self_disclosed: !!s.pep, id_document: s.doc ? { file_key: `kyc/${s.id}/a.png` } : null,
      provider_result: { result: s.fail ? 'fail' : 'review' },
    });
    db.prepare(
      `INSERT INTO users (id, role, name, email, is_active, kyc_status, kyc_data, kyc_submitted_at, kyc_reviewed_at, kyc_reviewed_by)
       VALUES (?, 'investor', ?, ?, 1, ?, ?, ?, ?, ?)`,
    ).run(s.id, s.name, `${s.name.split(' ')[0].toLowerCase()}@member.example`, s.status, data,
      s.daysAgo == null ? null : new Date(Date.now() - s.daysAgo * 86400000).toISOString().replace('T', ' ').slice(0, 19),
      ['approved', 'rejected', 'needs_info'].includes(s.status) ? '2026-10-01 10:00:00' : null,
      ['approved', 'rejected', 'needs_info'].includes(s.status) ? OTHER_ADMIN : null);
  }
  return db;
}

const app = (() => {
  const a = new Hono();
  a.route('/api/kyc', kyc as any);
  a.onError((err: any, c) => {
    const st = AUTH_ERROR_STATUSES[err?.message ?? ''];
    return st ? c.json({ detail: err.message }, st) : c.json({ detail: String(err?.message || 'Internal server error') }, 500);
  });
  return a;
})();

type DB = ReturnType<typeof freshDb>;

/** A TOTP session with a fresh step-up for `userId`, so a decision passes its gate. */
function stepUp(db: DB, userId: number) {
  db.prepare(`INSERT OR REPLACE INTO user_sessions (jti, user_id, factor, created_at, last_step_up_at) VALUES (?, ?, 'totp', datetime('now'), datetime('now'))`)
    .run(`totp-${userId}`, userId);
}

async function call(db: DB, method: string, path: string, opts: { as?: number; body?: unknown; role?: string; env?: Record<string, unknown> } = {}) {
  const as = opts.as ?? ADMIN;
  // A signed-in session, made two days ago with a password: valid, but no step-up.
  db.prepare(`INSERT OR IGNORE INTO user_sessions (jti, user_id, factor, created_at) VALUES (?, ?, 'password', datetime('now', '-2 days'))`)
    .run(`totp-${as}`, as);
  const tok = await new SignJWT({ user_id: as, role: opts.role ?? (as <= 2 ? 'admin' : 'investor'), jti: `totp-${as}` })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${tok}` };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const logs: string[] = [];
  const silence = ['info', 'warn', 'error', 'log'].map((k) => mock.method(console, k as any, (...a: any[]) => { logs.push(a.map(String).join(' ')); }));
  try {
    const res = await app.fetch(new Request(`http://x/api${path}`, {
      method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }), { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), ...(opts.env || {}) } as any);
    const text = await res.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body, text, logs };
  } finally { silence.forEach((m) => m.mock.restore()); }
}

const actions = (db: DB, action: string) => db.prepare('SELECT details, user_id FROM activity_logs WHERE action = ? ORDER BY id').all(action) as any[];
const events = (db: DB, userId: number) => db.prepare('SELECT kind, actor_user_id, note, submitted_at FROM kyc_case_events WHERE user_id = ? ORDER BY id').all(userId) as any[];
const inbox = (db: DB, userId: number) => db.prepare('SELECT type, title, body, link FROM notifications_inbox WHERE user_id = ? ORDER BY id').all(userId) as any[];
const statusOf = (db: DB, userId: number) => (db.prepare('SELECT kyc_status FROM users WHERE id = ?').get(userId) as any)?.kyc_status;
function noSecret(s: string) { for (const v of SECRETS) assert.equal(s.includes(v), false, `${v} leaked into: ${s}`); }

// ── the queue ─────────────────────────────────────────────────────────────

test('the queue: oldest first by default, with the wait, ID type, country, flags and reviewer, and no identity value', async () => {
  const db = freshDb();
  const r = await call(db, 'GET', '/kyc/admin/people?status=pending');
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.rows.map((x: any) => x.id), [10, 11, 12, 13], 'oldest first');
  const alma = r.body.rows[0];
  assert.equal(alma.wait_days, 9);
  assert.equal(alma.id_type, 'passport');
  assert.equal(alma.country, 'GB');
  assert.deepEqual(r.body.rows[1].flags, ['pep']);
  assert.deepEqual(r.body.rows[2].flags, ['no_document']);
  assert.equal(r.body.rows[2].country, 'GB', 'a country reads upper-case');
  noSecret(r.text);
  const gus = (await call(db, 'GET', '/kyc/admin/people?status=needs_info')).body.rows[0];
  assert.deepEqual(gus.reviewer, { id: OTHER_ADMIN, name: 'Ozzie Other' });
  assert.equal(gus.wait_days, 5, 'Needs information still waits');
  const eli = (await call(db, 'GET', '/kyc/admin/people?status=approved')).body.rows[0];
  assert.equal(eli.wait_days, null, 'a decided case does not wait');
});

test('paging and counts agree: the pages make the total, and the counts add up to it', async () => {
  const db = freshDb();
  const seen: number[] = [];
  let total = -1;
  let counts: Record<string, number> = {};
  for (let page = 1; page <= 4; page += 1) {
    const r = await call(db, 'GET', `/kyc/admin/people?page_size=2&page=${page}`);
    assert.equal(r.status, 200, r.text);
    assert.ok(r.body.rows.length <= 2);
    seen.push(...r.body.rows.map((x: any) => x.id));
    total = r.body.total;
    counts = r.body.counts;
  }
  assert.equal(total, 7, '"all" is every opened case: Hal has not started');
  assert.equal(seen.length, total, 'the pages put together are the total');
  assert.equal(new Set(seen).size, total, 'no row on two pages');
  assert.equal(seen.includes(17), false);
  assert.deepEqual(counts, { not_started: 3, pending: 4, needs_info: 1, approved: 1, rejected: 1, expired: 0 },
    'the two admins count as not started under their own status');
  const opened = Object.entries(counts).filter(([k]) => k !== 'not_started').reduce((n, [, v]) => n + v, 0);
  assert.equal(opened, total, 'the counts add up to the total');
  // A filter narrows the total and the counts together.
  const gb = await call(db, 'GET', '/kyc/admin/people?country=gb');
  assert.equal(gb.body.total, 4);
  assert.equal(gb.body.counts.pending + gb.body.counts.approved + gb.body.counts.needs_info, 4);
});

test('search, the filters and the sort', async () => {
  const db = freshDb();
  const ids = async (qs: string) => (await call(db, 'GET', `/kyc/admin/people?${qs}`)).body.rows.map((x: any) => x.id);
  assert.deepEqual(await ids('q=bea'), [11]);
  assert.deepEqual(await ids('q=MEMBER.example&status=rejected'), [15], 'email, any case');
  assert.deepEqual(await ids('q=%25'), [], 'a wildcard in the search is text, not a pattern');
  assert.deepEqual(await ids('id_type=passport&status=pending'), [10, 12]);
  assert.deepEqual(await ids('flag=pep'), [11]);
  assert.deepEqual(await ids('flag=auto_failed'), [15]);
  assert.deepEqual(await ids('flag=no_document'), [15, 12], 'oldest first: 15 waited since 20 days ago');
  assert.deepEqual(await ids('status=pending&sort=submitted&dir=desc'), [13, 12, 11, 10]);
  assert.deepEqual(await ids('status=pending&sort=name&dir=desc'), [13, 12, 11, 10]);
  assert.deepEqual(await ids('status=pending&sort=nonsense&dir=sideways'), [10, 11, 12, 13], 'an unknown sort falls back');
  assert.deepEqual(await ids('status=bogus'), await ids('status=all'), 'an unknown status reads as all');
  db.prepare('UPDATE users SET kyc_assignee_id = ? WHERE id IN (10, 13)').run(ADMIN);
  db.prepare('UPDATE users SET kyc_assignee_id = ? WHERE id = 11').run(OTHER_ADMIN);
  assert.deepEqual(await ids('status=pending&assignee=me'), [10, 13]);
  assert.deepEqual(await ids(`status=pending&assignee=${OTHER_ADMIN}`), [11]);
  assert.deepEqual(await ids('status=pending&assignee=none'), [12]);
  const row = (await call(db, 'GET', '/kyc/admin/people?status=pending&assignee=me')).body.rows[0];
  assert.deepEqual(row.assignee, { id: ADMIN, name: 'Ada Admin' });
});

test('every read still logs: one row per read, with counts and no identity value', async () => {
  const db = freshDb();
  await call(db, 'GET', '/kyc/admin/people?status=pending&page_size=3');
  await call(db, 'GET', '/kyc/admin/people?q=bea');
  const q = actions(db, 'kyc_queue_access');
  assert.equal(q.length, 2);
  assert.match(q[0].details, /count=3 total=4 page=1/);
  await call(db, 'GET', '/kyc/admin/figures');
  assert.equal(actions(db, 'kyc_figures_access').length, 1);
  await call(db, 'GET', '/kyc/admin/10/case');
  assert.equal(actions(db, 'kyc_case_access').length, 1);
  // The older queue keeps its own row, as before.
  await call(db, 'GET', '/kyc/admin/queue?status=pending');
  assert.equal(actions(db, 'kyc_queue_access').length, 3);
  const all = db.prepare('SELECT details FROM activity_logs').all() as any[];
  for (const a of all) noSecret(String(a.details));
  // A member is refused, and nothing is read for them.
  const member = await call(db, 'GET', '/kyc/admin/people', { as: 10 });
  assert.equal(member.status, 403);
  assert.equal(actions(db, 'kyc_queue_access').length, 3);
});

// ── decisions and step-up ─────────────────────────────────────────────────

test('a decision without step-up is refused, and writes nothing', async () => {
  const db = freshDb();
  for (const [path, body] of [
    ['/kyc/admin/10/needs-info', { message: 'Send the back of the card' }],
    ['/kyc/admin/14/recheck', { message: 'The document has since expired' }],
    ['/kyc/admin/10/approve', { note: 'Looks right' }],
    ['/kyc/admin/10/reject', { reason: 'The photo is unreadable' }],
  ] as const) {
    const r = await call(db, 'PATCH', path, { body });
    assert.equal(r.status, 403, `${path}: ${r.text}`);
    assert.equal(r.body.detail, 'step_up_required');
  }
  assert.equal(statusOf(db, 10), 'pending');
  assert.equal(statusOf(db, 14), 'approved');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM kyc_case_events').get() as any).n, 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM notifications_inbox').get() as any).n, 0);
});

test('Needs information: a waiting case goes back with the question, recorded and told', async () => {
  const db = freshDb();
  stepUp(db, ADMIN);
  const r = await call(db, 'PATCH', '/kyc/admin/10/needs-info', { body: { message: 'Send the back of the card, please' } });
  assert.equal(r.status, 200, r.text);
  assert.equal(statusOf(db, 10), 'needs_info');
  const ev = events(db, 10);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].kind, 'needs_info');
  assert.equal(ev[0].actor_user_id, ADMIN);
  assert.ok(ev[0].submitted_at, 'the submission it answers');
  const n = inbox(db, 10);
  assert.equal(n.length, 1);
  assert.equal(n[0].type, 'kyc_needs_info');
  assert.match(n[0].body, /Send the back of the card, please/);
  assert.equal(n[0].link, '/kyc');
  assert.equal(actions(db, 'kyc_needs_info_by_admin').length, 1);
  noSecret(JSON.stringify(actions(db, 'kyc_needs_info_by_admin')));
  // The member reads what was asked.
  const st = await call(db, 'GET', '/kyc/status', { as: 10 });
  assert.equal(st.body.kyc_status, 'needs_info');
  assert.equal(st.body.info_request, 'Send the back of the card, please');
  // Only a waiting case; a short message is refused.
  assert.equal((await call(db, 'PATCH', '/kyc/admin/14/needs-info', { body: { message: 'Something else' } })).status, 409);
  assert.equal((await call(db, 'PATCH', '/kyc/admin/11/needs-info', { body: { message: 'no' } })).status, 400);
  assert.equal(statusOf(db, 11), 'pending');
});

test('re-check: an approved person verifies again, and is told so', async () => {
  const db = freshDb();
  stepUp(db, ADMIN);
  const r = await call(db, 'PATCH', '/kyc/admin/14/recheck', { body: { message: 'Your passport on file has expired' } });
  assert.equal(r.status, 200, r.text);
  assert.equal(statusOf(db, 14), 'needs_info', 'full access waits for the new check');
  assert.equal(events(db, 14)[0].kind, 'recheck');
  assert.equal(inbox(db, 14)[0].type, 'kyc_recheck');
  assert.equal((await call(db, 'PATCH', '/kyc/admin/10/recheck', { body: { message: 'Nothing to re-check' } })).status, 409, 'a waiting case is not re-checked');
});

test('approve with a note, and reject: each recorded on the history and told to the member', async () => {
  const db = freshDb();
  stepUp(db, ADMIN);
  const a = await call(db, 'PATCH', '/kyc/admin/10/approve', { body: { note: 'Matched the passport chip' } });
  assert.equal(a.status, 200, a.text);
  const ev = events(db, 10);
  assert.deepEqual(ev.map((e) => e.kind), ['approved']);
  assert.equal(ev[0].note, 'Matched the passport chip');
  assert.ok(ev[0].submitted_at);
  assert.equal(inbox(db, 10)[0].type, 'kyc_approved');
  assert.equal(inbox(db, 10)[0].body.includes('Matched the passport chip'), false, 'the approval note is HQ\'s, not the member\'s');
  // An approval with no note still works.
  assert.equal((await call(db, 'PATCH', '/kyc/admin/11/approve')).status, 200);
  // Reject purges the case's listed documents and keeps when.
  db.prepare("INSERT INTO kyc_documents (user_id, kind, file_key, content_type, size_bytes) VALUES (12, 'id_front', 'kyc/12/f.png', 'image/png', 10)").run();
  const rj = await call(db, 'PATCH', '/kyc/admin/12/reject', { body: { reason: 'The photo is unreadable' } });
  assert.equal(rj.status, 200, rj.text);
  assert.equal(events(db, 12)[0].kind, 'rejected');
  assert.equal(inbox(db, 12)[0].type, 'kyc_rejected');
  assert.match(inbox(db, 12)[0].body, /The photo is unreadable/);
  assert.ok((db.prepare('SELECT removed_at FROM kyc_documents WHERE user_id = 12').get() as any).removed_at, 'the row keeps when its bytes went');
});

// ── resubmission and expiry ───────────────────────────────────────────────

const SUBMISSION = {
  legal_first_name: 'Gus', legal_last_name: 'Asked', date_of_birth: DOB, country: 'GB', address_line1: '7 Hidden Lane',
  city: 'Leeds', postal_code: 'LS1 1AA', id_type: 'passport', id_number: ID_NUMBER,
  id_document_base64: 'data:image/png;base64,iVBORw0KGgo=',
};

test('submit accepts a resubmission from Needs information and Expired, never while waiting', async () => {
  const db = freshDb();
  const again = await call(db, 'POST', '/kyc/submit', { as: 16, body: SUBMISSION });
  assert.equal(again.status, 200, again.text);
  assert.equal(statusOf(db, 16), 'pending');
  assert.equal(events(db, 16).at(-1).kind, 'submitted');
  const waiting = await call(db, 'POST', '/kyc/submit', { as: 10, body: SUBMISSION });
  assert.equal(waiting.status, 409, 'a waiting case is not submitted twice');
  db.prepare("UPDATE users SET kyc_status = 'expired' WHERE id = 14").run();
  assert.equal((await call(db, 'POST', '/kyc/submit', { as: 14, body: SUBMISSION })).status, 200, 'an expired check can be resubmitted');
  assert.equal(statusOf(db, 14), 'pending');
});

test('several documents: each with a kind, stored to R2 only, refused without a bucket', async () => {
  const db = freshDb();
  const docs = { ...SUBMISSION, id_document_base64: undefined, documents: [
    { kind: 'id_front', data_uri: 'data:image/png;base64,iVBORw0KGgo=' },
    { kind: 'proof_of_address', data_uri: 'data:application/pdf;base64,JVBERi0=' },
  ] };
  const none = await call(db, 'POST', '/kyc/submit', { as: 16, body: docs });
  assert.equal(none.status, 503, 'no bucket, nowhere to keep them');
  assert.equal(statusOf(db, 16), 'needs_info', 'nothing changed');
  const bad = await call(db, 'POST', '/kyc/submit', { as: 16, body: { ...docs, documents: [{ kind: 'passport_scan', data_uri: 'data:image/png;base64,AA==' }] } });
  assert.equal(bad.status, 400, 'a kind outside the list');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM kyc_documents').get().n, 0);

  // With a bucket: each document lands under kyc/, one row each, and HQ streams one back, logged.
  const objects = new Map<string, { bytes: Uint8Array; type: string }>();
  const FILES = {
    async put(k: string, bytes: Uint8Array, o: any) { objects.set(k, { bytes, type: o?.httpMetadata?.contentType }); },
    async get(k: string) { const o = objects.get(k); return o ? { body: o.bytes, size: o.bytes.byteLength, httpMetadata: { contentType: o.type } } : null; },
    async delete(k: string) { objects.delete(k); },
  };
  const ok = await call(db, 'POST', '/kyc/submit', { as: 16, body: docs, env: { FILES } });
  assert.equal(ok.status, 200, ok.text);
  const rows = db.prepare('SELECT id, kind, file_key, content_type FROM kyc_documents WHERE user_id = 16 ORDER BY id').all() as any[];
  assert.deepEqual(rows.map((r) => [r.kind, r.content_type]), [['id_front', 'image/png'], ['proof_of_address', 'application/pdf']]);
  assert.ok(rows.every((r) => r.file_key.startsWith('kyc/16/') && objects.has(r.file_key)), 'R2 keys only, under kyc/');
  const kase = await call(db, 'GET', '/kyc/admin/16/case');
  assert.deepEqual(kase.body.documents.map((d: any) => d.kind), ['id_front', 'proof_of_address']);
  assert.equal('file_key' in kase.body.documents[0], false, 'the key stays on the server');
  const one = await call(db, 'GET', `/kyc/admin/16/documents/${rows[1].id}`, { env: { FILES } });
  assert.equal(one.status, 200);
  assert.equal(actions(db, 'kyc_document_access').length, 1);
  assert.equal((await call(db, 'GET', `/kyc/admin/15/documents/${rows[1].id}`, { env: { FILES } })).status, 404, 'another person\'s document is not theirs');
});

test('an expired kyc_v1 moves its person to Expired, re-opens the obligation, and tells them; then they resubmit', async () => {
  const db = freshDb();
  db.prepare("INSERT INTO legal_obligations (user_id, obligation_key, required, status, expires_at) VALUES (14, 'kyc_v1', 1, 'satisfied', datetime('now', '-1 day'))").run();
  // A person whose kyc_v1 is still in force stays approved.
  db.prepare("UPDATE users SET kyc_status = 'approved' WHERE id = 11").run();
  db.prepare("INSERT INTO legal_obligations (user_id, obligation_key, required, status, expires_at) VALUES (11, 'kyc_v1', 1, 'satisfied', datetime('now', '+300 days'))").run();
  const silence = ['info', 'warn', 'error', 'log'].map((k) => mock.method(console, k as any, () => {}));
  let r: any;
  try { r = await expireDueArtifacts({ DB: d1Over(db) } as any); } finally { silence.forEach((m) => m.mock.restore()); }
  assert.equal(r.kyc_expired, 1);
  assert.equal(statusOf(db, 14), 'expired');
  assert.equal(statusOf(db, 11), 'approved');
  assert.equal((db.prepare("SELECT status FROM legal_obligations WHERE user_id = 14 AND obligation_key = 'kyc_v1'").get() as any).status, 'pending',
    'the nightly reconciliation satisfies it again once a new check is approved');
  assert.equal(events(db, 14).at(-1).kind, 'expired');
  assert.equal(inbox(db, 14)[0].type, 'kyc_expired');
  // Idempotent: a second night moves nobody.
  const again = await expireDueArtifacts({ DB: d1Over(db) } as any);
  assert.equal(again.kyc_expired, 0);
  assert.equal(inbox(db, 14).length, 1);
  assert.equal((await call(db, 'POST', '/kyc/submit', { as: 14, body: SUBMISSION })).status, 200, 'an expired check can be resubmitted');
});

// ── the case, assignment and notes ────────────────────────────────────────

test('assignment and notes: only an admin holds a case, and a note never reaches a log', async () => {
  const db = freshDb();
  const r = await call(db, 'PATCH', '/kyc/admin/10/assign', { body: { assignee_id: OTHER_ADMIN } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.changed, true);
  assert.equal((await call(db, 'PATCH', '/kyc/admin/10/assign', { body: { assignee_id: 11 } })).status, 400, 'a member cannot hold a case');
  assert.equal((await call(db, 'PATCH', '/kyc/admin/10/assign', { body: { assignee_id: OTHER_ADMIN } })).body.changed, false);
  const note = 'Called the issuing office; the number checks out';
  assert.equal((await call(db, 'POST', '/kyc/admin/10/notes', { body: { body: note } })).status, 201);
  assert.equal((await call(db, 'POST', '/kyc/admin/10/notes', { body: { body: '   ' } })).status, 400);
  const c = await call(db, 'GET', '/kyc/admin/10/case');
  assert.equal(c.status, 200, c.text);
  assert.deepEqual(c.body.assignee, { id: OTHER_ADMIN, name: 'Ozzie Other' });
  assert.ok(c.body.assigned_at);
  assert.equal(c.body.notes[0].body, note);
  assert.deepEqual(c.body.events.map((e: any) => e.kind), ['assigned']);
  const unassign = await call(db, 'PATCH', '/kyc/admin/10/assign', { body: { assignee_id: null } });
  assert.equal(unassign.body.assignee_id, null);
  assert.equal((db.prepare('SELECT kyc_assigned_at FROM users WHERE id = 10').get() as any).kyc_assigned_at, null);
  const logs = db.prepare('SELECT details FROM activity_logs').all() as any[];
  assert.equal(logs.some((l) => String(l.details).includes('issuing office')), false, 'the note stays out of the log');
  // The history and the notes refuse to be rewritten.
  assert.throws(() => db.prepare("UPDATE kyc_notes SET body = 'changed'").run(), /append-only/);
  assert.throws(() => db.prepare("UPDATE kyc_case_events SET note = 'changed'").run(), /append-only/);
});

// ── the figures ───────────────────────────────────────────────────────────

test('the figures: decisions per week, the median time to a decision, the wait bands', async () => {
  const db = freshDb();
  // Three decisions two days ago, 2, 6 and 24 hours after their submissions; one 100 days ago, outside both windows.
  const ins = db.prepare(`INSERT INTO kyc_case_events (user_id, kind, actor_user_id, submitted_at, created_at)
    VALUES (?, ?, 1, datetime('now', '-3 days'), datetime('now', '-3 days', ?))`);
  ins.run(14, 'approved', '+2 hours');
  ins.run(15, 'rejected', '+6 hours');
  ins.run(16, 'needs_info', '+24 hours');
  db.prepare(`INSERT INTO kyc_case_events (user_id, kind, actor_user_id, submitted_at, created_at)
    VALUES (12, 'approved', 1, datetime('now', '-101 days'), datetime('now', '-100 days'))`).run();
  const empty = freshDb();
  const none = await call(empty, 'GET', '/kyc/admin/figures');
  assert.equal(none.body.median_hours_to_decision, null, 'no decision recorded is not a zero');
  assert.match(none.body.median_reason, /No decision/);
  const r = await call(db, 'GET', '/kyc/admin/figures');
  assert.equal(r.status, 200, r.text);
  const total = r.body.weeks.reduce((n: number, w: any) => n + w.approved + w.rejected + w.needs_info, 0);
  assert.equal(total, 3, 'the decision 100 days ago is outside the eight weeks');
  assert.equal(r.body.median_hours_to_decision, 6);
  assert.equal(r.body.decisions_measured, 3);
  assert.equal(r.body.median_reason, null);
  assert.deepEqual(r.body.wait_bands, { under_1_day: 1, '1_to_3_days': 1, '3_to_7_days': 1, over_7_days: 1, not_recorded: 0 });
  assert.equal(median([2, 6, 24]), 6);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
  assert.equal(waitBand(null), 'not_recorded');
  assert.equal(waitBand(0.5), 'under_1_day');
  assert.equal(waitBand(7), 'over_7_days');
});

// ── the pure parts ────────────────────────────────────────────────────────

test('the query falls back on anything unknown, and pages stay bounded', () => {
  const q = parseQueueQuery({ status: 'x', sort: 'y', dir: 'z', page: '-3', page_size: '1000', assignee: "1 OR 1=1", country: 'gbr', flag: 'zz' }, 7);
  assert.equal(q.status, 'all');
  assert.equal(q.sort, 'submitted');
  assert.equal(q.dir, 'asc');
  assert.equal(q.page, 1);
  assert.equal(q.pageSize, 100);
  assert.equal(q.assignee, null, 'an assignee that is not an id, "me" or "none" is ignored');
  assert.equal(q.country, 'GBR');
  assert.equal(q.flag, null);
  assert.equal(parseQueueQuery({ assignee: 'me' }, 7).assignee, '7');
  assert.equal(parseQueueQuery({ sort: 'reviewed' }, 7).dir, 'desc', 'the newest decision first');
  for (const k of ['approved', 'rejected', 'needs_info', 'recheck', 'expired'] as const) {
    const n = noticeFor(k, 'a reason');
    assert.ok(n.title && n.body && n.type.startsWith('kyc_'), k);
  }
  assert.match(noticeFor('rejected', '').body, /Not recorded/, 'a missing reason is said, never blank');
});
