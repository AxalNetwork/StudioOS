/**
 * Spin-Out Lab participant moderation — admin only.
 *
 *   GET  /api/admin/spinout-moderation/:userId   case history for one member
 *   POST /api/admin/spinout-moderation/:userId   apply an action
 *
 * WHAT THIS DOES NOT DO
 * =====================
 * It never touches `users.is_active`. That flag is the platform-wide account
 * lockout behind admin.ts `toggle-active`, and using it for cohort moderation
 * would sign the person out of StudioOS entirely — including any investor,
 * partner or advisor role they hold that has nothing to do with the Lab.
 *
 * Cohort access is `users.spinout_lab_active`, granted on acceptance by
 * services/cohortApplications.ts and read by services/projectAccess.ts and by
 * labRoles() in the SPA. Ejecting flips THAT to 0: the Lab workspace closes,
 * the account, projects, documents and any issued credential survive, and
 * reinstating is a single flag away.
 *
 * Revoking an issued graduation certificate is deliberately NOT wired in here.
 * A credential is a statement about what someone did, and withdrawing it in
 * public is a separate decision from closing their workspace — it stays an
 * explicit call on /api/spinout-lab/certificates/:id/revoke.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';

const app = new Hono<{ Bindings: Env }>();

/** Actions an admin can take, and the lab-access value each implies. */
const ACTIONS: Record<string, { status: string; labAccess: number | null; verb: string }> = {
  flag:      { status: 'under_review', labAccess: null, verb: 'flagged for review' },
  suspend:   { status: 'suspended',    labAccess: 0,    verb: 'suspended from' },
  eject:     { status: 'ejected',      labAccess: 0,    verb: 'ejected from' },
  reinstate: { status: 'active',       labAccess: 1,    verb: 'reinstated to' },
};

const REASONS = new Set([
  'abuse', 'harassment', 'spam', 'fraudulent_application',
  'policy_violation', 'legal_compliance', 'inactivity', 'other',
]);
const SEVERITIES = new Set(['low', 'medium', 'high']);

let _migrated = false;
async function ensureTables(env: Env) {
  if (_migrated) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS spinout_moderation_cases (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL,
      status        TEXT NOT NULL,
      reason_code   TEXT NOT NULL,
      severity      TEXT NOT NULL DEFAULT 'medium',
      summary       TEXT,
      details       TEXT,
      lab_access_before INTEGER,
      lab_access_after  INTEGER,
      opened_by     INTEGER NOT NULL,
      opened_at     TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_by   INTEGER,
      resolved_at   TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_spinout_mod_user   ON spinout_moderation_cases(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_spinout_mod_status ON spinout_moderation_cases(status)`,
    `CREATE INDEX IF NOT EXISTS idx_spinout_mod_open   ON spinout_moderation_cases(user_id, resolved_at)`,
  ];
  for (const s of stmts) {
    try { await env.DB.prepare(s).run(); } catch { /* already applied */ }
  }
  _migrated = true;
}

const CASE_COLS =
  'id, user_id, status, reason_code, severity, summary, details, ' +
  'lab_access_before, lab_access_after, opened_by, opened_at, resolved_by, resolved_at';

app.get('/:userId', async (c) => {
  const admin = await requireAuth(c);
  if (admin.role !== 'admin') return c.json({ detail: 'Forbidden' }, 403);
  await ensureTables(c.env);
  const userId = Number(c.req.param('userId'));
  if (!Number.isFinite(userId) || userId <= 0) return c.json({ detail: 'Bad user id' }, 400);

  const rows = await c.env.DB.prepare(
    `SELECT ${CASE_COLS} FROM spinout_moderation_cases
      WHERE user_id = ? ORDER BY opened_at DESC LIMIT 100`,
  ).bind(userId).all<any>();

  const current = await c.env.DB.prepare(
    'SELECT spinout_lab_active FROM users WHERE id = ?',
  ).bind(userId).first<any>();

  const open = (rows.results || []).find((r: any) => !r.resolved_at) || null;
  return c.json({
    cases: rows.results || [],
    open_case: open,
    lab_access: Number(current?.spinout_lab_active ?? 0) === 1,
    // Deliberately surfaced so the console can say plainly that ejection did
    // not deactivate the account.
    moderation_scope: 'spinout_lab_active',
  });
});

app.post('/:userId', async (c) => {
  const admin = await requireAuth(c);
  if (admin.role !== 'admin') return c.json({ detail: 'Forbidden' }, 403);
  await ensureTables(c.env);

  const userId = Number(c.req.param('userId'));
  if (!Number.isFinite(userId) || userId <= 0) return c.json({ detail: 'Bad user id' }, 400);
  if (userId === admin.id) return c.json({ detail: 'You cannot moderate your own account' }, 400);

  const body = await c.req.json().catch(() => ({} as any));
  const action = String(body.action || '');
  const spec = ACTIONS[action];
  if (!spec) return c.json({ detail: `Unknown action. One of: ${Object.keys(ACTIONS).join(', ')}` }, 400);

  // A reason is mandatory on every action, reinstatement included — an
  // unexplained reversal is as hard to audit later as an unexplained ejection.
  const reason = String(body.reason_code || '');
  if (!REASONS.has(reason)) {
    return c.json({ detail: `reason_code must be one of: ${[...REASONS].join(', ')}` }, 400);
  }
  const severity = SEVERITIES.has(String(body.severity)) ? String(body.severity) : 'medium';

  const target = await c.env.DB.prepare(
    'SELECT id, name, spinout_lab_active FROM users WHERE id = ?',
  ).bind(userId).first<any>();
  if (!target) return c.json({ detail: 'Not found' }, 404);

  const before = Number(target.spinout_lab_active ?? 0);
  const after = spec.labAccess === null ? before : spec.labAccess;

  // Close any open case first — one open case per member at a time.
  await c.env.DB.prepare(
    `UPDATE spinout_moderation_cases
        SET resolved_by = ?, resolved_at = datetime('now'), updated_at = datetime('now')
      WHERE user_id = ? AND resolved_at IS NULL`,
  ).bind(admin.id, userId).run();

  await c.env.DB.prepare(
    `INSERT INTO spinout_moderation_cases
       (user_id, status, reason_code, severity, summary, details,
        lab_access_before, lab_access_after, opened_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    userId, spec.status, reason, severity,
    body.summary ?? null, body.details ?? null,
    before, after, admin.id,
  ).run();

  // Reinstating resolves immediately — it opens nothing to follow up.
  if (spec.status === 'active') {
    await c.env.DB.prepare(
      `UPDATE spinout_moderation_cases
          SET resolved_by = ?, resolved_at = datetime('now')
        WHERE user_id = ? AND resolved_at IS NULL`,
    ).bind(admin.id, userId).run();
  }

  // ONLY the Lab flag. users.is_active is never written here.
  if (after !== before) {
    await c.env.DB.prepare(
      'UPDATE users SET spinout_lab_active = ? WHERE id = ?',
    ).bind(after, userId).run();
  }

  // Human-readable audit, same table and shape admin.ts already uses.
  try {
    await c.env.DB.prepare(
      `INSERT INTO activity_logs (action, details, user_id)
       VALUES ('spinout_moderation', ?, ?)`,
    ).bind(
      `Admin ${admin.name || admin.id} ${spec.verb} the Spin-Out Lab (${reason}, ${severity})`,
      userId,
    ).run();
  } catch { /* activity_logs is advisory here; the case row is the record */ }

  const cases = await c.env.DB.prepare(
    `SELECT ${CASE_COLS} FROM spinout_moderation_cases
      WHERE user_id = ? ORDER BY opened_at DESC LIMIT 100`,
  ).bind(userId).all<any>();

  return c.json({
    cases: cases.results || [],
    lab_access: after === 1,
    account_deactivated: false, // never, by construction — see the file header
  });
});

export default app;
