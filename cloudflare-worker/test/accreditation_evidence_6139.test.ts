/**
 * D6139 part 1 (#6139): accreditation evidence. The investor uploads a
 * verification letter (owner answer A), the fund team reviews it, and the
 * accept decision is the one writer of `accreditation_v1 = 'satisfied'`.
 *
 * Real schema (`loadSchema`, so migration 202611272256_6139 is applied), the
 * real routers mounted where `mount` puts them, synthetic fixtures and an
 * in-memory R2 that honours the write-once condition:
 *   SUPER     Super Admin, stepped up ('fresh') and not ('stale')
 *   ADMIN     admin, stepped up ('afresh')
 *   INVESTOR  asked for accreditation_v1 (pending)
 *   RENEWER   accreditation_v1 satisfied, uploading a renewal
 *   FOUNDER   not asked
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/accreditation_evidence_6139.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import { accreditationMember, accreditationReview, mount } from '../src/routes/trust_accreditation.ts';
import kyc from '../src/routes/kyc.ts';
import { ensureTrustSchema, monthsToMs } from '../src/services/trust.ts';
import { INVESTOR_RECORD_RETENTION_MONTHS, letterKeptUntil, sniffLetter } from '../src/services/accreditationEvidence.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-accreditation-6139';
const SUPER = 1, ADMIN = 2, INVESTOR = 3, RENEWER = 4, FOUNDER = 5;
const DAY = 86_400_000;
const PDF = new TextEncoder().encode('%PDF-1.7\nsynthetic verification letter\n%%EOF');

function fakeR2() {
  const objects = new Map<string, { bytes: Uint8Array; type: string }>();
  return {
    objects,
    async put(key: string, body: any, opts?: any) {
      if (opts?.onlyIf?.etagDoesNotMatch === '*' && objects.has(key)) return null;
      objects.set(key, { bytes: new Uint8Array(body), type: opts?.httpMetadata?.contentType ?? '' });
      return { key };
    },
    async get(key: string) { const o = objects.get(key); return o ? { body: o.bytes, httpMetadata: { contentType: o.type }, size: o.bytes.byteLength } : null; },
    async delete(keys: string | string[]) { for (const k of Array.isArray(keys) ? keys : [keys]) objects.delete(k); },
  };
}

async function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, ?)');
  u.run(SUPER, 'sue@axal.test', 'Sue Super', 'admin');
  u.run(ADMIN, 'ada@axal.test', 'Ada Admin', 'admin');
  u.run(INVESTOR, 'ivy@angel.test', 'Ivy Investor', 'investor');
  u.run(RENEWER, 'ren@angel.test', 'Ren Renewer', 'investor');
  u.run(FOUNDER, 'fay@found.test', 'Fay Founder', 'founder');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.exec(`INSERT INTO user_sessions (jti, user_id, factor, created_at, last_step_up_at) VALUES
    ('fresh', ${SUPER}, 'totp', datetime('now'), datetime('now')),
    ('stale', ${SUPER}, 'totp', datetime('now', '-90 minutes'), datetime('now', '-90 minutes')),
    ('afresh', ${ADMIN}, 'totp', datetime('now'), datetime('now'))`);
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), FILES: fakeR2() };
  await ensureTrustSchema(env);
  const o = db.prepare('INSERT INTO legal_obligations (user_id, obligation_key, required, status, expires_at) VALUES (?, ?, 1, ?, ?)');
  o.run(INVESTOR, 'accreditation_v1', 'pending', null);
  o.run(RENEWER, 'accreditation_v1', 'satisfied', new Date(Date.now() + 20 * DAY).toISOString()); // clock-ok: relative
  return { db, env };
}

const app = new Hono();
for (const m of mount) app.route(m.path, m.router as any);
app.route('/api/kyc', kyc as any);
app.onError((err: any, c) => {
  const st = AUTH_ERROR_STATUSES[err?.message ?? ''];
  return st ? c.json({ detail: err.message }, st) : c.json({ detail: String(err?.message || 'Internal server error') }, 500);
});

async function call(env: any, id: number | null, path: string, init: { method?: string; body?: unknown; form?: FormData; jti?: string } = {}) {
  const headers: Record<string, string> = {};
  if (!init.form && init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (id !== null) {
    headers.Authorization = 'Bearer ' + await new SignJWT({ user_id: id, ...(init.jti ? { jti: init.jti } : {}) })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  }
  const res = await app.fetch(new Request(`http://x/api${path}`, {
    method: init.method || 'GET', headers,
    ...(init.form ? { body: init.form } : init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  }), env);
  const buf = new Uint8Array(await res.arrayBuffer());
  const text = new TextDecoder().decode(buf);
  let body: any = null; try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body, text, bytes: buf, headers: res.headers };
}
const letter = (basis: string | null, bytes: Uint8Array = PDF, name = 'letter.pdf', type = 'application/pdf') => {
  const fd = new FormData();
  if (basis !== null) fd.append('basis', basis);
  fd.append('file', new File([bytes], name, { type }));
  return fd;
};
const upload = (env: any, id: number, fd: FormData) => call(env, id, '/trust/accreditation/evidence', { method: 'POST', form: fd });
const oblig = (db: DatabaseSync, id: number) => db.prepare("SELECT status, expires_at, evidence_meta FROM legal_obligations WHERE user_id = ? AND obligation_key = 'accreditation_v1'").get(id) as any;
const logs = (db: DatabaseSync, action: string) => db.prepare('SELECT details, user_id FROM activity_logs WHERE action = ? ORDER BY id').all(action) as any[];
const NO_FILE_FIELDS = ['file_key', 'sha256', 'bytes', 'data', 'url', 'href'];

test('the mounts: the member router on /api/trust/accreditation, the review ahead of kyc.ts', () => {
  assert.deepEqual(mount.map((m) => [m.path, m.router === accreditationMember ? 'member' : m.router === accreditationReview ? 'review' : '?', (m.before || []).includes(kyc)]),
    [['/api/trust/accreditation', 'member', false], ['/api/kyc', 'review', true]]);
});

test('an upload stores one letter in the private store and puts a pending requirement in review', async () => {
  // Mutation checked: the `status IN ('pending','expired')` guard dropped → the renewal test below sees in_review.
  const { db, env } = await fixture();
  try {
    const res = await upload(env, INVESTOR, letter('cpa_letter'));
    assert.equal(res.status, 201, res.text);
    assert.equal(res.body.item.status, 'submitted');
    assert.equal(res.body.item.basis, 'cpa_letter');
    for (const k of NO_FILE_FIELDS) assert.equal(k in res.body.item, false, `the upload answer carries ${k}`);
    const keys = [...env.FILES.objects.keys()];
    assert.equal(keys.length, 1);
    assert.match(keys[0], new RegExp(`^accreditation-evidence/${INVESTOR}/[0-9a-f-]{36}\\.pdf$`));
    const row = db.prepare('SELECT * FROM accreditation_evidence').get() as any;
    assert.equal(row.file_key, keys[0]);
    assert.equal(row.content_type, 'application/pdf');
    assert.equal(row.size_bytes, PDF.byteLength);
    assert.equal(row.sha256.length, 64);
    assert.equal(oblig(db, INVESTOR).status, 'in_review');
    assert.deepEqual(logs(db, 'accreditation_evidence_submitted').map((r) => r.user_id), [INVESTOR]);

    const again = await upload(env, INVESTOR, letter('attorney_letter'));
    assert.equal(again.status, 409);
    assert.equal(again.body.error, 'letter_open');
    assert.equal(env.FILES.objects.size, 1, 'a refused second letter stores nothing');
  } finally { db.close(); }
});

test('an upload is refused before anything is stored: wrong basis, no file, wrong bytes, too large, not asked', async () => {
  // Mutation checked: sniffLetter trusting the declared type → the text file is stored.
  const { db, env } = await fixture();
  try {
    const cases: Array<[number, FormData, number, string]> = [
      [INVESTOR, letter('tax_return'), 400, 'bad_basis'],
      [INVESTOR, letter(null), 400, 'bad_basis'],
      [INVESTOR, letter('cpa_letter', new Uint8Array(0)), 400, 'letter_required'],
      [INVESTOR, letter('cpa_letter', new TextEncoder().encode('plain text pretending'), 'letter.pdf', 'application/pdf'), 415, 'letter_type'],
      [INVESTOR, letter('cpa_letter', new Uint8Array(10 * 1024 * 1024 + 1)), 413, 'letter_too_large'],
      [FOUNDER, letter('cpa_letter'), 403, 'accreditation_not_asked'],
      [ADMIN, letter('cpa_letter'), 403, 'accreditation_not_asked'],
    ];
    for (const [id, fd, status, code] of cases) {
      const r = await upload(env, id, fd);
      assert.equal(r.status, status, `${code}: ${r.text}`);
      assert.equal(r.body.error, code);
    }
    const json = await call(env, INVESTOR, '/trust/accreditation/evidence', { method: 'POST', body: { basis: 'cpa_letter' } });
    assert.equal(json.status, 400);
    assert.equal((await call(env, null, '/trust/accreditation/evidence', { method: 'POST', form: letter('cpa_letter') })).status, 401);
    assert.equal(env.FILES.objects.size, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM accreditation_evidence').get()!.n, 0);
    assert.equal(oblig(db, INVESTOR).status, 'pending');
  } finally { db.close(); }
});

test('a row that cannot be written leaves no file behind', async () => {
  // Mutation checked: the eraseRecordObjects call dropped from the catch → the object stays.
  const { db, env } = await fixture();
  try {
    // The read before the upload works; the insert after it fails.
    db.exec("CREATE TRIGGER t_fail BEFORE INSERT ON accreditation_evidence BEGIN SELECT RAISE(ABORT, 'synthetic insert failure'); END;");
    let stored = 0;
    const put = env.FILES.put.bind(env.FILES);
    env.FILES.put = async (...a: any[]) => { stored += 1; return put(...a); };
    const r = await upload(env, INVESTOR, letter('cpa_letter'));
    assert.ok(r.status >= 400, r.text);
    assert.equal(stored, 1, 'the letter reached the store before the row failed');
    assert.equal(env.FILES.objects.size, 0, 'the orphan letter was erased');
    assert.equal(oblig(db, INVESTOR).status, 'pending', 'the batch rolled back');
  } finally { db.close(); }
});

test('GET /mine: the basis, uploaded date and status, and never the file', async () => {
  const { db, env } = await fixture();
  try {
    const empty = await call(env, INVESTOR, '/trust/accreditation/evidence/mine');
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body.items, []);
    assert.deepEqual(empty.body.obligation, { required: true, status: 'pending', expires_at: null });
    assert.deepEqual(empty.body.retention, { accreditation_months: 12, investor_record_months: null });
    await upload(env, INVESTOR, letter('broker_dealer_letter'));
    const mine = await call(env, INVESTOR, '/trust/accreditation/evidence/mine');
    assert.equal(mine.body.items.length, 1);
    const it = mine.body.items[0];
    assert.equal(it.basis, 'broker_dealer_letter');
    assert.equal(it.basis_label, 'Letter from a broker-dealer');
    assert.equal(it.status, 'submitted');
    assert.match(it.uploaded_at, /^\d{4}-\d{2}-\d{2}T/);
    for (const k of NO_FILE_FIELDS) assert.equal(k in it, false, `the list carries ${k}`);
    assert.doesNotMatch(mine.text, /accreditation-evidence\//, 'no key in the list');
    assert.equal(mine.body.obligation.status, 'in_review');
    // Someone else sees only their own (none).
    const other = await call(env, FOUNDER, '/trust/accreditation/evidence/mine');
    assert.deepEqual(other.body.items, []);
    assert.equal(other.body.obligation, null);
  } finally { db.close(); }
});

test('the review list and the file: admins only, each read logged, no file in the list', async () => {
  // Mutation checked: the list's logAction dropped → no accreditation_queue_access row.
  const { db, env } = await fixture();
  try {
    await upload(env, INVESTOR, letter('cpa_letter'));
    const id = (db.prepare('SELECT id FROM accreditation_evidence').get() as any).id;
    for (const who of [INVESTOR, FOUNDER]) {
      assert.equal((await call(env, who, '/kyc/admin/accreditation')).status, 403);
      assert.equal((await call(env, who, `/kyc/admin/accreditation/${id}/file`)).status, 403);
    }
    const list = await call(env, ADMIN, '/kyc/admin/accreditation');
    assert.equal(list.status, 200, list.text);
    assert.equal(list.body.items.length, 1);
    assert.deepEqual(list.body.items[0].member, { id: INVESTOR, name: 'Ivy Investor' });
    assert.equal(list.body.items[0].kept_until, null, 'no keep-until date while #5510 has not set the period');
    for (const k of NO_FILE_FIELDS) assert.equal(k in list.body.items[0], false, `the review list carries ${k}`);
    assert.equal((await call(env, ADMIN, '/kyc/admin/accreditation?status=bogus')).status, 400);
    assert.deepEqual(logs(db, 'accreditation_queue_access').map((r) => [r.details, r.user_id]), [['Accreditation letters read status=open count=1', ADMIN]]);

    const file = await call(env, ADMIN, `/kyc/admin/accreditation/${id}/file`);
    assert.equal(file.status, 200);
    assert.deepEqual([...file.bytes], [...PDF]);
    assert.equal(file.headers.get('cache-control'), 'private, no-store');
    assert.equal(file.headers.get('content-type'), 'application/pdf');
    assert.deepEqual(logs(db, 'accreditation_document_access').map((r) => [r.details, r.user_id]), [[`Admin viewed accreditation letter ${id} for user_id=${INVESTOR}`, ADMIN]]);
    assert.equal((await call(env, ADMIN, '/kyc/admin/accreditation/999/file')).body.error, 'letter_not_found');
    assert.equal((await call(env, ADMIN, '/kyc/admin/accreditation/abc/file')).status, 404);
  } finally { db.close(); }
});

test('send back: a stepped-up admin with a reason; the requirement is pending again and the member reads why', async () => {
  // Mutation checked: decisions without requireStepUp → the stale session decides.
  const { db, env } = await fixture();
  try {
    await upload(env, INVESTOR, letter('cpa_letter'));
    const id = (db.prepare('SELECT id FROM accreditation_evidence').get() as any).id;
    const path = `/kyc/admin/accreditation/${id}/decision`;
    assert.equal((await call(env, INVESTOR, path, { method: 'POST', body: { decision: 'accept' } })).status, 403);
    const stale = await call(env, SUPER, path, { method: 'POST', jti: 'stale', body: { decision: 'accept' } });
    assert.ok([401, 403].includes(stale.status), `stale step-up → ${stale.status}`);
    assert.equal((await call(env, ADMIN, path, { method: 'POST', jti: 'afresh', body: { decision: 'reject' } })).body.error, 'bad_decision');
    assert.equal((await call(env, ADMIN, path, { method: 'POST', jti: 'afresh', body: { decision: 'send_back', reason: 'short' } })).body.error, 'reason_required');
    assert.equal(oblig(db, INVESTOR).status, 'in_review', 'nothing refused changed the requirement');

    const started = await call(env, ADMIN, path, { method: 'POST', jti: 'afresh', body: { decision: 'in_review' } });
    assert.equal(started.status, 200, started.text);
    assert.equal((await call(env, INVESTOR, '/trust/accreditation/evidence/mine')).body.items[0].status, 'in_review');

    const reason = 'The letter is not signed by the CPA.';
    const back = await call(env, ADMIN, path, { method: 'POST', jti: 'afresh', body: { decision: 'send_back', reason } });
    assert.equal(back.status, 200, back.text);
    assert.equal(oblig(db, INVESTOR).status, 'pending');
    const mine = await call(env, INVESTOR, '/trust/accreditation/evidence/mine');
    assert.equal(mine.body.items[0].status, 'sent_back');
    assert.equal(mine.body.items[0].review_reason, reason);
    assert.equal((await call(env, ADMIN, path, { method: 'POST', jti: 'afresh', body: { decision: 'accept' } })).body.error, 'letter_decided');
    assert.equal(oblig(db, INVESTOR).status, 'pending', 'a sent-back letter is never accepted afterwards');
    assert.deepEqual(logs(db, 'accreditation_review_started').map((r) => r.user_id), [ADMIN]);
    assert.deepEqual(logs(db, 'accreditation_sent_back').map((r) => [r.details, r.user_id]), [[`Admin sent back accreditation letter ${id} for user_id=${INVESTOR}`, ADMIN]]);
    assert.doesNotMatch(JSON.stringify(logs(db, 'accreditation_sent_back')), /not signed/, 'the typed reason is not copied into the audit sentence');

    // A new letter can follow.
    assert.equal((await upload(env, INVESTOR, letter('attorney_letter'))).status, 201);
  } finally { db.close(); }
});

test('accept: the one writer of accreditation_v1 satisfied, for the period HQ sets', async () => {
  // Mutation checked: monthsToMs(12) hardcoded → the 18-month period below reads 12 months.
  const { db, env } = await fixture();
  try {
    db.prepare("INSERT INTO kyc_renewal_periods (obligation_key, months, updated_by, updated_at) VALUES ('accreditation_v1', 18, ?, datetime('now'))").run(SUPER);
    await upload(env, INVESTOR, letter('registered_adviser_letter'));
    const id = (db.prepare('SELECT id FROM accreditation_evidence').get() as any).id;
    const path = `/kyc/admin/accreditation/${id}/decision`;
    const before = Date.now(); // clock-ok: relative
    const ok = await call(env, ADMIN, path, { method: 'POST', jti: 'afresh', body: { decision: 'accept' } });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.body.period_months, 18);
    const o = oblig(db, INVESTOR);
    assert.equal(o.status, 'satisfied');
    assert.ok(Math.abs(Date.parse(o.expires_at) - (before + monthsToMs(18))) < 60_000, `expires ${o.expires_at}`);
    assert.deepEqual(JSON.parse(o.evidence_meta), { source: 'accreditation_evidence', evidence_id: id });
    const mine = await call(env, INVESTOR, '/trust/accreditation/evidence/mine');
    assert.equal(mine.body.items[0].status, 'accepted');
    assert.equal(mine.body.items[0].expires_at, o.expires_at);
    assert.equal(mine.body.items[0].review_reason, null);
    assert.equal((await call(env, ADMIN, path, { method: 'POST', jti: 'afresh', body: { decision: 'accept' } })).body.error, 'letter_decided');
    assert.deepEqual(logs(db, 'accreditation_accepted').map((r) => r.user_id), [ADMIN]);
    assert.match(logs(db, 'accreditation_accepted')[0].details, /for user_id=3 until \d{4}-\d{2}-\d{2}$/);
    // The /trust/me source line names the letter.
    const { obligationSource } = await import('../src/services/trust.ts');
    assert.equal(obligationSource({ evidence_meta: o.evidence_meta }), 'Accepted from your verification letter');
  } finally { db.close(); }
});

test('a reviewer never decides their own letter, and another admin\'s letter is the Super Admin\'s', async () => {
  // Mutation checked: the own-letter check dropped → ADMIN accepts their own letter.
  const { db, env } = await fixture();
  try {
    db.prepare("INSERT INTO legal_obligations (user_id, obligation_key, required, status) VALUES (?, 'accreditation_v1', 1, 'pending')").run(ADMIN);
    const at = new Date().toISOString(); // clock-ok: relative
    db.prepare(`INSERT INTO accreditation_evidence (id, user_id, basis, file_key, file_name, content_type, size_bytes, sha256, status, uploaded_at)
      VALUES (50, ?, 'cpa_letter', 'accreditation-evidence/2/x.pdf', 'x.pdf', 'application/pdf', 10, ?, 'submitted', ?)`).run(ADMIN, 'a'.repeat(64), at);
    const own = await call(env, ADMIN, '/kyc/admin/accreditation/50/decision', { method: 'POST', jti: 'afresh', body: { decision: 'accept' } });
    assert.equal(own.status, 404, 'a plain admin cannot reach an admin\'s letter at all');
    assert.equal((await call(env, ADMIN, '/kyc/admin/accreditation')).body.items.length, 0);
    assert.equal((await call(env, SUPER, '/kyc/admin/accreditation')).body.items.length, 1);
    // The Super Admin decides it; the Super Admin's own letter is refused to them.
    db.prepare("INSERT INTO legal_obligations (user_id, obligation_key, required, status) VALUES (?, 'accreditation_v1', 1, 'pending')").run(SUPER);
    db.prepare(`INSERT INTO accreditation_evidence (id, user_id, basis, file_key, file_name, content_type, size_bytes, sha256, status, uploaded_at)
      VALUES (51, ?, 'cpa_letter', 'accreditation-evidence/1/y.pdf', 'y.pdf', 'application/pdf', 10, ?, 'submitted', ?)`).run(SUPER, 'b'.repeat(64), at);
    const mine = await call(env, SUPER, '/kyc/admin/accreditation/51/decision', { method: 'POST', jti: 'fresh', body: { decision: 'accept' } });
    assert.equal(mine.status, 403);
    assert.equal(mine.body.error, 'own_letter');
    assert.equal((await call(env, SUPER, '/kyc/admin/accreditation/50/decision', { method: 'POST', jti: 'fresh', body: { decision: 'accept' } })).status, 200);
    assert.equal(oblig(db, SUPER).status, 'pending');
  } finally { db.close(); }
});

test('a renewal letter leaves a satisfied requirement satisfied until it is decided', async () => {
  const { db, env } = await fixture();
  try {
    const kept = oblig(db, RENEWER).expires_at;
    assert.equal((await upload(env, RENEWER, letter('cpa_letter'))).status, 201);
    assert.equal(oblig(db, RENEWER).status, 'satisfied');
    const id = (db.prepare('SELECT id FROM accreditation_evidence WHERE user_id = ?').get(RENEWER) as any).id;
    await call(env, ADMIN, `/kyc/admin/accreditation/${id}/decision`, { method: 'POST', jti: 'afresh', body: { decision: 'send_back', reason: 'The letter is dated last year.' } });
    assert.deepEqual([oblig(db, RENEWER).status, oblig(db, RENEWER).expires_at], ['satisfied', kept], 'a sent-back renewal keeps the period in force');
  } finally { db.close(); }
});

test('an accepted letter whose period has passed reads expired; the stored letter is frozen', async () => {
  // Mutation checked: EVIDENCE_COLUMNS comparing the bare column → the ISO date sorts above datetime('now') and reads accepted.
  const { db, env } = await fixture();
  try {
    // A minute ago, as an ISO string: on the same date it sorts ABOVE datetime('now') as text ('T' > ' ').
    const lapsed = new Date(Date.now() - 60_000).toISOString(); // clock-ok: relative
    db.prepare(`INSERT INTO accreditation_evidence (id, user_id, basis, file_key, file_name, content_type, size_bytes, sha256, status, uploaded_at, reviewed_by, reviewed_at, expires_at)
      VALUES (60, ?, 'cpa_letter', 'accreditation-evidence/3/z.pdf', 'z.pdf', 'application/pdf', 10, ?, 'accepted', '2025-01-01T00:00:00.000Z', ?, '2025-01-02T00:00:00.000Z', ?)`)
      .run(INVESTOR, 'c'.repeat(64), ADMIN, lapsed);
    const mine = await call(env, INVESTOR, '/trust/accreditation/evidence/mine');
    assert.equal(mine.body.items[0].status, 'expired');
    assert.equal(mine.body.items[0].expires_at, lapsed);
    assert.throws(() => db.prepare("UPDATE accreditation_evidence SET file_key = 'accreditation-evidence/3/other.pdf' WHERE id = 60").run(), /written once/);
    assert.throws(() => db.prepare("UPDATE accreditation_evidence SET status = 'in_review' WHERE id = 60").run(), /not reopened/);
  } finally { db.close(); }
});

test('the rules: letters by their bytes, and no keep-until date while #5510 has not set the period', () => {
  assert.equal(sniffLetter(PDF)?.mime, 'application/pdf');
  assert.equal(sniffLetter(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.ext, 'png');
  assert.equal(sniffLetter(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))?.ext, 'jpg');
  assert.equal(sniffLetter(new TextEncoder().encode('GIF89a')), null);
  assert.equal(INVESTOR_RECORD_RETENTION_MONTHS, null, 'a retention figure appeared without #5510 setting it');
  assert.equal(letterKeptUntil('2027-01-31T00:00:00.000Z'), null);
  assert.equal(letterKeptUntil('2027-01-31T00:00:00.000Z', 24), '2029-01-31T00:00:00.000Z');
  assert.equal(letterKeptUntil(null, 24), null);
});
