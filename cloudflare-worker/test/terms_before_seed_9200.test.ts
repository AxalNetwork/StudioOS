/**
 * D9200 (#9200): terms accepted before the obligation rows exist count.
 *
 * An account created without seeding (admin- or script-created, older paths)
 * could accept the terms through POST /api/auth/accept-terms while it had no
 * `legal_obligations` rows. The acceptance was recorded, nothing was satisfied,
 * the next seed (GET /api/trust/me self-heals) created the rows 'pending', and
 * /api/auth/me asked again. This runs that exact sequence through the real
 * routes over a real SQLite database, and the old-version case beside it.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/terms_before_seed_9200.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { d1Over } from './_d1_sqlite.mjs';
import authRoutes from '../src/routes/auth.ts';
import trustRoutes from '../src/routes/trust.ts';
import { LEGAL_DOCUMENT_VERSIONS } from '../src/services/trust.ts';

const SECRET = 'synthetic-9200-terms-secret';
const sql = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(sql('../sql/schema_baseline.sql'));
  db.exec(sql('../sql/migrations/245_legal_acceptances.sql'));
  db.exec(sql('../sql/migrations/583_legal_acceptance_version.sql'));
  db.exec(`INSERT INTO users(id,email,name,role,is_active) VALUES
    (9200,'unseeded@example.test','Synthetic unseeded founder','founder',1),
    (9201,'older@example.test','Synthetic older founder','founder',1),
    (9202,'stuck@example.test','Synthetic stuck founder','founder',1)`);
  for (const id of [9200, 9201, 9202]) db.prepare(`INSERT INTO user_sessions(user_id,jti,factor,assurance_level,last_step_up_at)
    VALUES (?,?,'totp','totp',datetime('now'))`).run(id, 'synthetic-' + id);
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' };
  const app = new Hono<any>();
  app.route('/api/auth', authRoutes).route('/api/trust', trustRoutes);
  return {
    db,
    async call(path: string, user: number, method = 'GET') {
      const token = await new SignJWT({ user_id: user, jti: 'synthetic-' + user })
        .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
        .sign(new TextEncoder().encode(SECRET));
      const pending: Promise<unknown>[] = [];
      const res = await app.request(path, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } },
        env, { waitUntil(p: Promise<unknown>) { pending.push(p); }, passThroughOnException() {} });
      await Promise.allSettled(pending);
      return { status: res.status, body: await res.json() as any };
    },
  };
}

const terms = (db: DatabaseSync, user: number) => Object.fromEntries(
  (db.prepare(`SELECT obligation_key, status, evidence_meta FROM legal_obligations
                WHERE user_id = ? AND obligation_key IN ('tos_v1','privacy_v1')`).all(user) as any[])
    .map((r) => [r.obligation_key, { status: r.status, meta: r.evidence_meta ? JSON.parse(r.evidence_meta) : null }]),
);
const acceptances = (db: DatabaseSync, user: number) =>
  Number((db.prepare('SELECT COUNT(*) AS n FROM legal_acceptances WHERE user_id = ?').get(user) as any).n);

test('accept-terms before any obligation row, then seeding, then /auth/me: not asked again', async () => {
  const f = fixture();
  try {
    assert.equal(Object.keys(terms(f.db, 9200)).length, 0, 'the account must start unseeded');
    const accept = await f.call('/api/auth/accept-terms', 9200, 'POST');
    assert.equal(accept.status, 200);
    assert.equal(accept.body.satisfied, 0, 'with no rows there is nothing to satisfy yet');
    assert.equal(acceptances(f.db, 9200), 2);

    const trust = await f.call('/api/trust/me', 9200);
    assert.equal(trust.status, 200);
    const rows = terms(f.db, 9200);
    assert.equal(rows.tos_v1?.status, 'satisfied', 'seeding ignored the recorded Terms acceptance');
    assert.equal(rows.privacy_v1?.status, 'satisfied', 'seeding ignored the recorded Privacy acceptance');
    assert.deepEqual(rows.tos_v1.meta && { source: rows.tos_v1.meta.source, surface: rows.tos_v1.meta.surface },
      { source: 'reacceptance_interstitial', surface: 'reacceptance_interstitial' });
    // Other obligations are untouched by the acceptance.
    const nda: any = f.db.prepare(`SELECT status FROM legal_obligations WHERE user_id = 9200 AND obligation_key = 'founder_nda_v1'`).get();
    assert.equal(nda?.status, 'pending');

    const me = await f.call('/api/auth/me', 9200);
    assert.equal(me.status, 200);
    assert.equal(me.body.terms_acceptance_pending, false, 'the person was asked to accept again');
    assert.equal(me.body.terms_acceptance_reason, null);
    // Seeding reads the person's acceptance; it never writes one.
    assert.equal(acceptances(f.db, 9200), 2, 'seeding wrote an acceptance');
  } finally { f.db.close(); }
});

test('an acceptance of an older document version does not satisfy the current one', async () => {
  const f = fixture();
  try {
    f.db.prepare(`INSERT INTO legal_acceptances (user_id, obligation_key, accepted_at, surface, document_version)
      VALUES (9201, 'tos_v1', '2026-01-01T00:00:00Z', 'onboarding_licence', '2026-01-01'),
             (9201, 'privacy_v1', '2026-01-01T00:00:00Z', 'onboarding_licence', ?)`).run(LEGAL_DOCUMENT_VERSIONS.privacy_v1);
    assert.ok(LEGAL_DOCUMENT_VERSIONS.tos_v1 > '2026-01-01');
    await f.call('/api/trust/me', 9201);
    const rows = terms(f.db, 9201);
    assert.equal(rows.tos_v1?.status, 'pending', 'an older Terms version counted as the current one');
    assert.equal(rows.privacy_v1?.status, 'satisfied');
    assert.deepEqual(rows.privacy_v1.meta?.source, 'signup_clickwrap');
    const me = await f.call('/api/auth/me', 9201);
    assert.equal(me.body.terms_acceptance_pending, true);
    assert.equal(me.body.terms_acceptance_reason, 'missing');
    // An acceptance with no recorded version is not the current one either.
    f.db.prepare(`INSERT INTO legal_acceptances (user_id, obligation_key, accepted_at, surface, document_version)
      VALUES (9201, 'tos_v1', '2026-02-01T00:00:00Z', 'onboarding_licence', NULL)`).run();
    await f.call('/api/trust/me', 9201);
    assert.equal(terms(f.db, 9201).tos_v1?.status, 'pending', 'an unversioned acceptance counted as the current one');
  } finally { f.db.close(); }
});

test('an account already seeded pending after accepting is healed; another account\'s acceptance never counts', async () => {
  const f = fixture();
  try {
    // The state the bug left behind: accepted the current version, then seeded pending.
    f.db.prepare(`INSERT INTO legal_acceptances (user_id, obligation_key, accepted_at, surface, document_version)
      VALUES (9202, 'tos_v1', '2026-11-27T00:00:00Z', 'reacceptance_interstitial', ?),
             (9202, 'privacy_v1', '2026-11-27T00:00:00Z', 'reacceptance_interstitial', ?)`)
      .run(LEGAL_DOCUMENT_VERSIONS.tos_v1, LEGAL_DOCUMENT_VERSIONS.privacy_v1);
    for (const u of [9201, 9202]) for (const k of ['tos_v1', 'privacy_v1']) {
      f.db.prepare(`INSERT INTO legal_obligations (user_id, obligation_key, required, status) VALUES (?, ?, 1, 'pending')`).run(u, k);
    }
    f.db.prepare(`UPDATE legal_obligations SET status = 'waived', required = 0 WHERE user_id = 9202 AND obligation_key = 'privacy_v1'`).run();
    await f.call('/api/trust/me', 9202);
    await f.call('/api/trust/me', 9201);
    assert.equal(terms(f.db, 9202).tos_v1.status, 'satisfied', 'a pending row stayed pending over the person\'s own acceptance');
    // A waived row is re-armed by the existing rule, not satisfied in the same step.
    assert.equal(terms(f.db, 9202).privacy_v1.status, 'pending');
    assert.equal(terms(f.db, 9201).tos_v1.status, 'pending', 'one account\'s acceptance reached another');
    // Never downgraded: a satisfied row with its own evidence keeps it.
    f.db.prepare(`UPDATE legal_obligations SET status = 'satisfied', evidence_meta = '{"source":"signup_clickwrap"}' WHERE user_id = 9201 AND obligation_key = 'tos_v1'`).run();
    await f.call('/api/trust/me', 9201);
    assert.deepEqual(terms(f.db, 9201).tos_v1, { status: 'satisfied', meta: { source: 'signup_clickwrap' } });
    // Nor is a satisfied row's evidence rewritten by a later seed, even with a current acceptance on file.
    f.db.prepare(`UPDATE legal_obligations SET evidence_meta = '{"source":"signup_clickwrap"}' WHERE user_id = 9202 AND obligation_key = 'tos_v1'`).run();
    await f.call('/api/trust/me', 9202);
    assert.deepEqual(terms(f.db, 9202).tos_v1, { status: 'satisfied', meta: { source: 'signup_clickwrap' } },
      'seeding rewrote the evidence of an already-satisfied row');
  } finally { f.db.close(); }
});
