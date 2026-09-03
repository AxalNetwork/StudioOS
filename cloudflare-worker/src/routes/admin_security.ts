/**
 * HQ · Security (Support Security · Super canvas, Y2; decision A4 renamed the
 * row from Governance).
 *
 * SUPER ADMIN ONLY, every route. This is the cross-tenant security desk: at
 * HQ scale the compliance officer and the security engineer are one headcount
 * and one page. A subsidiary admin has no security console by design (A5).
 *
 *   GET  /overview        one payload for the Security page
 *   POST /force-reauth    sign every active account out, everywhere, with a
 *                         typed reason; recorded in admin_audit_log
 *
 * WHAT IS REAL HERE. The admin action audit (`admin_audit_log`, every action,
 * newest first — the existing /monitoring/audit read allows two actions only);
 * impersonation sessions, live and recent; active sessions and MFA coverage
 * among admins; the KYC queue by status; data-subject deletion requests with
 * the statutory clock.
 *
 * WHAT IS NOT, AND IS NAMED RATHER THAN SAMPLED. A `security_events` ledger
 * (failed sign-ins, step-ups, permission grants, exports as one feed) — the
 * canvas calls it "the one real backend build" and it is not built; AI-safety
 * counters; a sanctions screen; backup and restore-drill status. Each comes
 * back `{ available: false, reason }` so the page says so in the zone the
 * canvas draws for it, instead of rendering the canvas's sample rows.
 *
 * FORCE RE-AUTH. `users.jwt_min_iat` is how sign-out-everywhere already works
 * per account (routes/settings.ts POST /sessions/revoke-all). Platform-wide
 * it is the same UPDATE over every active account — the caller included,
 * which the response says — behind the impersonation write bar: a TOTP
 * session, a recent step-up, then the elevation. The reason is required and
 * stored; a platform-wide sign-out with no stated cause is an incident that
 * cannot be reconstructed.
 *
 * Mounted at /api/admin/security BEFORE the catch-all /api/admin in index.ts.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireFactor, requireStepUp, requireSuperAdmin } from '../auth';

const r = new Hono<{ Bindings: Env }>();

const AUDIT_LIMIT = 50;
const IMPERSONATION_LIMIT = 25;
const SESSION_WINDOW_DAYS = 30;
/** GDPR Art. 12(3): one month from receipt. Counted from the request, not from triage. */
const DSR_CLOCK_DAYS = 30;
const MIN_REASON = 8;

type Absent = { available: false; reason: string };
const absent = (reason: string): Absent => ({ available: false, reason });

/** SQLite's `datetime('now')` is 'YYYY-MM-DD HH:MM:SS' (UTC, no zone). */
function parseSqlTs(s: string | null | undefined): number {
  if (!s) return NaN;
  const iso = s.includes('T') ? s : `${s.replace(' ', 'T')}Z`;
  return Date.parse(iso);
}

r.get('/overview', async (c) => {
  await requireSuperAdmin(c);
  const env = c.env;

  const audit = await env.DB.prepare(
    `SELECT a.id, a.admin_user_id, u.email AS admin_email, u.name AS admin_name,
            a.action, a.report_type, a.format, a.filters_json, a.viewed_user_id, a.exported_at
       FROM admin_audit_log a
       LEFT JOIN users u ON u.id = a.admin_user_id
      ORDER BY a.exported_at DESC, a.id DESC
      LIMIT ?`,
  ).bind(AUDIT_LIMIT).all<Record<string, unknown>>();
  const auditTotal = await env.DB.prepare('SELECT COUNT(*) AS n FROM admin_audit_log').first<{ n: number }>();

  // Impersonation: the table is created lazily by services/cohortTiming.ts on
  // first use, so a database that has never impersonated has no table. That
  // is "no sessions", but reported as unreadable rather than guessed at.
  let impersonations: { available: true; active: number; recent: Record<string, unknown>[] } | Absent;
  try {
    const recent = await env.DB.prepare(
      `SELECT i.id, i.admin_user_id, i.target_user_id, i.context, i.started_at, i.ended_at,
              a.email AS admin_email, a.name AS admin_name, t.email AS target_email, t.name AS target_name
         FROM impersonation_sessions i
         LEFT JOIN users a ON a.id = i.admin_user_id
         LEFT JOIN users t ON t.id = i.target_user_id
        ORDER BY i.started_at DESC, i.id DESC
        LIMIT ?`,
    ).bind(IMPERSONATION_LIMIT).all<Record<string, unknown>>();
    const active = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM impersonation_sessions WHERE ended_at IS NULL',
    ).first<{ n: number }>();
    impersonations = { available: true, active: Number(active?.n) || 0, recent: recent.results || [] };
  } catch {
    impersonations = absent('The impersonation_sessions table could not be read on this database.');
  }

  // Sessions: one row per JWT mint (routes/settings.ts). "Active" is a row not
  // revoked and seen inside the window; a token's own expiry is not stored
  // here, so the window is the honest bound.
  let sessions: { available: true; active: number; window_days: number } | Absent;
  try {
    const active = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM user_sessions
        WHERE revoked_at IS NULL AND last_seen_at >= datetime('now', ?)`,
    ).bind(`-${SESSION_WINDOW_DAYS} days`).first<{ n: number }>();
    sessions = { available: true, active: Number(active?.n) || 0, window_days: SESSION_WINDOW_DAYS };
  } catch {
    sessions = absent('The user_sessions table could not be read on this database.');
  }

  const admins = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN tfa_methods IS NOT NULL AND tfa_methods <> '[]' THEN 1 ELSE 0 END) AS with_mfa
       FROM users WHERE LOWER(role) = 'admin' AND is_active = 1`,
  ).first<{ total: number; with_mfa: number }>();

  const kycRows = await env.DB.prepare(
    'SELECT kyc_status, COUNT(*) AS n FROM users WHERE is_active = 1 GROUP BY kyc_status',
  ).all<{ kyc_status: string | null; n: number }>();
  const kyc: Record<string, number> = {};
  for (const row of kycRows.results || []) kyc[String(row.kyc_status ?? 'not_started')] = Number(row.n) || 0;

  const dsrRows = await env.DB.prepare(
    `SELECT id, email, name, role, deletion_requested_at FROM users
      WHERE deletion_requested_at IS NOT NULL
      ORDER BY deletion_requested_at ASC`,
  ).all<{ id: number; email: string; name: string; role: string; deletion_requested_at: string }>();
  const now = Date.now();
  const dsr = (dsrRows.results || []).map((u) => {
    const requested = parseSqlTs(u.deletion_requested_at);
    const elapsedDays = Number.isNaN(requested) ? null : Math.floor((now - requested) / 86400000);
    return {
      id: u.id, email: u.email, name: u.name, role: u.role,
      requested_at: u.deletion_requested_at,
      // null when the timestamp cannot be parsed: an unknown clock is not a
      // clock at zero.
      days_left: elapsedDays === null ? null : DSR_CLOCK_DAYS - elapsedDays,
    };
  });

  return c.json({
    audit: { rows: audit.results || [], total: Number(auditTotal?.n) || 0, limit: AUDIT_LIMIT },
    impersonations,
    sessions,
    mfa: { admins_total: Number(admins?.total) || 0, admins_with_mfa: Number(admins?.with_mfa) || 0 },
    kyc,
    dsr: { clock_days: DSR_CLOCK_DAYS, rows: dsr },
    security_events: absent(
      'No security_events ledger exists. Failed sign-ins, step-ups, permission grants and exports are not '
      + 'collected into one feed; the admin action audit below is the only trail, and it records admin actions only.',
    ),
    ai_safety: absent('No guardrail-hit, flagged-output or token-anomaly counter is stored for the AI rails.'),
    sanctions: absent('No sanctions screening runs on the platform; KYC status is the only trust fact recorded.'),
    backup_dr: absent('No backup, restore-drill or failover record is kept where the platform can read it.'),
  });
});

r.post('/force-reauth', async (c) => {
  await requireFactor(c, 'totp');
  await requireStepUp(c);
  const actor = await requireSuperAdmin(c);

  let reason = '';
  try { reason = String((await c.req.json())?.reason ?? '').trim(); } catch { reason = ''; }
  if (reason.length < MIN_REASON) {
    return c.json({
      error: `A reason of at least ${MIN_REASON} characters is required. It is stored with the action.`,
      code: 'reason_required',
    }, 400);
  }

  // +1s so tokens issued in this same second are bounced too, exactly as the
  // per-account primitive does. Inactive accounts cannot sign in anyway.
  const nowSec = Math.floor(Date.now() / 1000) + 1;
  const result = await c.env.DB.prepare(
    'UPDATE users SET jwt_min_iat = ? WHERE is_active = 1',
  ).bind(nowSec).run();
  const affected = Number(result.meta?.changes ?? 0);

  await c.env.DB.prepare(
    'INSERT INTO admin_audit_log (admin_user_id, action, filters_json) VALUES (?, ?, ?)',
  ).bind(actor.id, 'security_force_reauth', JSON.stringify({ reason, affected, revoked_at: nowSec })).run();

  return c.json({
    ok: true,
    affected,
    revoked_at: nowSec,
    message: 'Every active account has been signed out everywhere, including yours. Sign in again with your authenticator.',
  });
});

export default r;
