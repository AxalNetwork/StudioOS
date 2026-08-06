/**
 * Spin-Out Lab graduation certificates — registry + public verification.
 *
 * Three authorization scopes, enforced here rather than in the UI:
 *
 *   ADMIN   POST   /api/spinout-lab/certificates          issue
 *           POST   /api/spinout-lab/certificates/:id/revoke
 *           GET    /api/spinout-lab/certificates          list (all graduates)
 *   OWNER   GET    /api/spinout-lab/certificates/mine     own credential only
 *   PUBLIC  GET    /api/public/verify/:token              public-safe payload
 *
 * The public route returns ONLY the public_* snapshot columns. It never joins
 * users or projects, so there is no path by which an internal id, an email, a
 * delivery state or an audit note can reach an unauthenticated caller — the
 * boundary is the SELECT list, not a serializer that could be edited later.
 *
 * The public URL keys on `public_token` (128-bit random), not on
 * credential_id. credential_id embeds the user id (AXL-SOL-C4-260731-0117),
 * so keying public verification on it would let anyone enumerate graduates by
 * walking that number.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';

const app = new Hono<{ Bindings: Env }>();

let _migrated = false;
async function ensureTables(env: Env) {
  if (_migrated) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS spinout_certificates (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      credential_id       TEXT UNIQUE NOT NULL,
      public_token        TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
      user_id             INTEGER NOT NULL,
      project_id          INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      public_name         TEXT NOT NULL,
      public_company      TEXT,
      public_cohort       TEXT,
      public_issued_on    TEXT NOT NULL,
      public_jurisdiction TEXT,
      public_program_days INTEGER,
      status              TEXT NOT NULL DEFAULT 'issued',
      revoked_at          TEXT,
      revocation_reason   TEXT,
      public_share_enabled INTEGER NOT NULL DEFAULT 1,
      issued_by_user_id   INTEGER,
      issued_at           TEXT NOT NULL DEFAULT (datetime('now')),
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_spinout_cert_user_issued
       ON spinout_certificates(user_id) WHERE status = 'issued'`,
    `CREATE INDEX IF NOT EXISTS idx_spinout_cert_token  ON spinout_certificates(public_token)`,
    `CREATE INDEX IF NOT EXISTS idx_spinout_cert_credid ON spinout_certificates(credential_id)`,
    `CREATE INDEX IF NOT EXISTS idx_spinout_cert_user   ON spinout_certificates(user_id)`,
  ];
  for (const s of stmts) {
    try { await env.DB.prepare(s).run(); } catch { /* already applied */ }
  }
  _migrated = true;
}

/** Owner/admin view: everything except other people's rows. */
const OWNER_COLS =
  'id, credential_id, public_token, user_id, project_id, public_name, public_company, ' +
  'public_cohort, public_issued_on, public_jurisdiction, public_program_days, status, ' +
  'revoked_at, revocation_reason, public_share_enabled, issued_at';

/**
 * Mirrors lib/graduationCertificate.js certificateRef() exactly. Kept in
 * lockstep deliberately: the frontend shows this reference before issuance,
 * and it must not change the moment the credential is persisted.
 */
export function credentialRefFor(cohortLabel: string | null, conferredAt: string, userId: number) {
  const m = String(cohortLabel || '').match(/(\d+)/);
  const cohortPart = m ? `C${Number(m[1])}` : 'X';
  const day = String(conferredAt || '').slice(0, 10);
  if (!day || !Number.isFinite(userId) || userId <= 0) return null;
  const datePart = day.replace(/-/g, '').slice(2);
  return `AXL-SOL-${cohortPart}-${datePart}-${String(userId).padStart(4, '0')}`;
}

// ---------------------------------------------------------------- ADMIN ----
app.post('/certificates', async (c) => {
  const user = await requireAuth(c);
  if (user.role !== 'admin') return c.json({ detail: 'Forbidden' }, 403);
  await ensureTables(c.env);

  const body = await c.req.json().catch(() => ({} as any));
  const userId = Number(body.user_id);
  const conferredAt = String(body.conferred_at || '').slice(0, 10);
  const name = String(body.public_name || '').trim();
  if (!Number.isFinite(userId) || userId <= 0) return c.json({ detail: 'user_id is required' }, 400);
  if (!conferredAt) return c.json({ detail: 'conferred_at is required' }, 400);
  if (!name) return c.json({ detail: 'public_name is required' }, 400);

  const credentialId = credentialRefFor(body.public_cohort ?? null, conferredAt, userId);
  if (!credentialId) return c.json({ detail: 'Could not derive a credential id' }, 400);

  const existing = await c.env.DB
    .prepare(`SELECT ${OWNER_COLS} FROM spinout_certificates WHERE user_id = ? AND status = 'issued'`)
    .bind(userId).first<any>();
  if (existing) return c.json({ certificate: existing, already_issued: true });

  await c.env.DB.prepare(
    `INSERT INTO spinout_certificates
       (credential_id, user_id, project_id, public_name, public_company, public_cohort,
        public_issued_on, public_jurisdiction, public_program_days, issued_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    credentialId, userId, body.project_id ?? null, name,
    body.public_company ?? null, body.public_cohort ?? null, conferredAt,
    body.public_jurisdiction ?? null,
    Number.isFinite(Number(body.public_program_days)) ? Number(body.public_program_days) : null,
    user.id,
  ).run();

  const row = await c.env.DB
    .prepare(`SELECT ${OWNER_COLS} FROM spinout_certificates WHERE credential_id = ?`)
    .bind(credentialId).first<any>();
  return c.json({ certificate: row }, 201);
});

app.get('/certificates', async (c) => {
  const user = await requireAuth(c);
  if (user.role !== 'admin') return c.json({ detail: 'Forbidden' }, 403);
  await ensureTables(c.env);
  const rows = await c.env.DB
    .prepare(`SELECT ${OWNER_COLS} FROM spinout_certificates ORDER BY issued_at DESC LIMIT 500`)
    .all<any>();
  return c.json({ certificates: rows.results || [] });
});

app.post('/certificates/:id/revoke', async (c) => {
  const user = await requireAuth(c);
  if (user.role !== 'admin') return c.json({ detail: 'Forbidden' }, 403);
  await ensureTables(c.env);
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({} as any));
  const reason = String(body.reason || '').trim() || null;
  await c.env.DB.prepare(
    `UPDATE spinout_certificates
        SET status = 'revoked', revoked_at = datetime('now'),
            revocation_reason = ?, updated_at = datetime('now')
      WHERE id = ? AND status = 'issued'`,
  ).bind(reason, id).run();
  const row = await c.env.DB
    .prepare(`SELECT ${OWNER_COLS} FROM spinout_certificates WHERE id = ?`)
    .bind(id).first<any>();
  if (!row) return c.json({ detail: 'Not found' }, 404);
  return c.json({ certificate: row });
});

/**
 * Catch-up issuance for graduates who finished before auto-issuance existed.
 *
 * Admin-only and idempotent: it runs the same per-founder path the live
 * graduation hook does, so it can never mint a credential that path wouldn't,
 * and re-running it does nothing. Bounded per call — it reports `remaining`
 * rather than pretending one call drained the queue.
 */
app.post('/certificates/backfill', async (c) => {
  const user = await requireAuth(c);
  if (user.role !== 'admin') return c.json({ detail: 'Forbidden' }, 403);
  await ensureTables(c.env);
  const body = (await c.req.json().catch(() => ({}))) as { limit?: unknown };
  const { backfillCertificates } = await import('../services/certificateIssuance');
  const result = await backfillCertificates(c.env, Number(body.limit) || 100);
  return c.json(result);
});

// ---------------------------------------------------------------- OWNER ----
app.get('/certificates/mine', async (c) => {
  const user = await requireAuth(c);
  await ensureTables(c.env);
  // Bound to the caller's own id — there is no path to another graduate's row.
  const row = await c.env.DB
    .prepare(`SELECT ${OWNER_COLS} FROM spinout_certificates
               WHERE user_id = ? ORDER BY (status = 'issued') DESC, issued_at DESC LIMIT 1`)
    .bind(user.id).first<any>();
  return c.json({ certificate: row || null });
});

/** Holder controls whether their own credential is publicly verifiable. */
app.post('/certificates/mine/sharing', async (c) => {
  const user = await requireAuth(c);
  await ensureTables(c.env);
  const body = await c.req.json().catch(() => ({} as any));
  const on = body.public_share_enabled ? 1 : 0;
  await c.env.DB.prepare(
    `UPDATE spinout_certificates SET public_share_enabled = ?, updated_at = datetime('now')
      WHERE user_id = ? AND status = 'issued'`,
  ).bind(on, user.id).run();
  const row = await c.env.DB
    .prepare(`SELECT ${OWNER_COLS} FROM spinout_certificates WHERE user_id = ? AND status = 'issued'`)
    .bind(user.id).first<any>();
  return c.json({ certificate: row || null });
});

export default app;

// --------------------------------------------------------------- PUBLIC ----
/**
 * Mounted separately under /api/public. Unauthenticated.
 *
 * The SELECT list IS the privacy boundary: only public_* columns plus the
 * credential id and lifecycle state. No user_id, no project_id, no
 * public_token echo, no joins.
 */
export const publicCertificateRoutes = new Hono<{ Bindings: Env }>();

publicCertificateRoutes.get('/verify/:token', async (c) => {
  await ensureTables(c.env);
  const token = String(c.req.param('token') || '').trim().toLowerCase();
  if (!token) return c.json({ detail: 'Not found' }, 404);

  const row = await c.env.DB.prepare(
    `SELECT credential_id, public_name, public_company, public_cohort,
            public_issued_on, public_jurisdiction, public_program_days,
            status, revoked_at, public_share_enabled
       FROM spinout_certificates WHERE lower(public_token) = ?`,
  ).bind(token).first<any>();

  // Sharing off is reported as not-found rather than "exists but hidden", so
  // the endpoint cannot be used to confirm a credential the holder has closed.
  if (!row || !row.public_share_enabled) return c.json({ detail: 'Not found' }, 404);

  return c.json({
    verified: row.status === 'issued',
    status: row.status,
    revoked_at: row.status === 'revoked' ? row.revoked_at : null,
    credential_id: row.credential_id,
    name: row.public_name,
    company: row.public_company,
    cohort: row.public_cohort,
    issued_on: row.public_issued_on,
    jurisdiction: row.public_jurisdiction,
    program_days: row.public_program_days,
  });
});
