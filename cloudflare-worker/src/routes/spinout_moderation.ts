/**
 * Spin-Out Lab participant moderation — admin only.
 *
 *   GET  /api/admin/spinout-moderation           awaiting a decision, and sanctions in force
 *   GET  /api/admin/spinout-moderation/:userId   case history for one member
 *   POST /api/admin/spinout-moderation/:userId   apply an action
 *
 * Awaiting a decision is `MODERATION_AWAITING_SQL` (flagged, not closed).
 * That is the count the approvals lane reads. A suspension or an ejection
 * that has not been closed is a sanction in force and is listed apart from
 * it, so the console and the lane agree on a flag.
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
 * reinstating is a single flag away. Closing a case stamps resolved_at and
 * does not flip the flag, so a sanction can leave the list without reinstating.
 *
 * Revoking an issued graduation certificate is deliberately NOT wired in here.
 * A credential is a statement about what someone did, and withdrawing it in
 * public is a separate decision from closing their workspace — it stays an
 * explicit call on /api/spinout-lab/certificates/:id/revoke.
 *
 * The HQ-held Approvals landing does not link here. That door is Session 5's
 * (HeldApprovals). The branch Approvals board does link here.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { isSuperAdmin, requireAdmin, requireAuth, requireBranchNotSuspended } from '../auth';
import { bindingKey } from '../util/schemaBootstrap';
import { refuse } from '../util/refusal';
import { mapError } from './_t13t14t15_helpers';
import { logAdminAction } from '../services/adminAudit';
import { MODERATION_AWAITING_SQL, MODERATION_SANCTION_SQL } from '../services/moderationOpen';

const app = new Hono<{ Bindings: Env }>();

/**
 * Actions an admin can take, and the lab-access value each implies.
 * `close` stamps resolved_at and does not change Lab access.
 */
const ACTIONS: Record<string, { status: string; labAccess: number | null; verb: string; closeOnly: boolean }> = {
  flag:      { status: 'under_review', labAccess: null, verb: 'flagged for review', closeOnly: false },
  suspend:   { status: 'suspended',    labAccess: 0,    verb: 'suspended from', closeOnly: false },
  eject:     { status: 'ejected',      labAccess: 0,    verb: 'ejected from', closeOnly: false },
  reinstate: { status: 'active',       labAccess: 1,    verb: 'reinstated to', closeOnly: false },
  close:     { status: 'closed',       labAccess: null, verb: 'closed the case on', closeOnly: true },
};

const REASONS = new Set([
  'abuse', 'harassment', 'spam', 'fraudulent_application',
  'policy_violation', 'legal_compliance', 'inactivity', 'other',
]);
const SEVERITIES = new Set(['low', 'medium', 'high']);

const MIGRATED = new WeakMap<object, boolean>();
async function ensureTables(env: Env) {
  if (MIGRATED.get(bindingKey(env))) return;
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
  MIGRATED.set(bindingKey(env), true);
}

const CASE_COLS =
  'id, user_id, status, reason_code, severity, summary, details, ' +
  'lab_access_before, lab_access_after, opened_by, opened_at, resolved_by, resolved_at';

const LIST_HEAD =
  'SELECT m.id, m.user_id, m.status, m.reason_code, m.severity, m.summary, ' +
  'm.opened_at, m.created_at, ' +
  "COALESCE(NULLIF(u.name, ''), u.email, 'account ' || m.user_id) AS who " +
  'FROM spinout_moderation_cases m LEFT JOIN users u ON u.id = m.user_id WHERE ';

function finiteCount(raw: number | bigint | null | undefined): number | null {
  const n = typeof raw === 'bigint' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return n;
}

async function countWhere(env: Env, where: string): Promise<number | null> {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM spinout_moderation_cases WHERE ' + where,
  ).first<{ n: number | bigint }>();
  return finiteCount(row?.n);
}

async function listWhere(env: Env, where: string) {
  const rows = await env.DB.prepare(
    LIST_HEAD + where + ' ORDER BY m.created_at ASC LIMIT 200',
  ).all<any>();
  return rows.results || [];
}

function adminTargetRefusal(c: any) {
  return refuse(c, 403, {
    code: 'super_admin_required',
    message: 'Only a super admin can decide a moderation case on another admin.',
  });
}

app.get('/', async (c) => {
  const admin = await requireAuth(c);
  if (admin.role !== 'admin') {
    return refuse(c, 403, {
      code: 'admin_required',
      message: 'Only an admin can read open moderation cases.',
    });
  }
  await ensureTables(c.env);
  try {
    const openCount = await countWhere(c.env, MODERATION_AWAITING_SQL);
    const sanctionsCount = await countWhere(c.env, MODERATION_SANCTION_SQL);
    if (openCount === null || sanctionsCount === null) {
      return refuse(c, 500, {
        code: 'moderation_list_unreadable',
        message: 'Open moderation cases could not be read. Try again.',
      });
    }
    const cases = await listWhere(c.env, MODERATION_AWAITING_SQL);
    const sanctions = await listWhere(c.env, MODERATION_SANCTION_SQL);
    return c.json({
      cases,
      open_count: openCount,
      sanctions,
      sanctions_count: sanctionsCount,
    });
  } catch (e) {
    console.error('[spinout-moderation] open list', (e as Error).message);
    return refuse(c, 500, {
      code: 'moderation_list_unreadable',
      message: 'Open moderation cases could not be read. Try again.',
    });
  }
});

app.get('/:userId', async (c) => {
  const admin = await requireAuth(c);
  if (admin.role !== 'admin') return c.json({ detail: 'Forbidden' }, 403);
  await ensureTables(c.env);
  const userId = Number(c.req.param('userId'));
  if (!Number.isFinite(userId) || userId <= 0) return c.json({ detail: 'Bad user id' }, 400);

  const target = await c.env.DB.prepare(
    'SELECT id, role FROM users WHERE id = ?',
  ).bind(userId).first<{ id: number; role: string }>();
  const own = userId === admin.id;
  if (!own && target && String(target.role).toLowerCase() === 'admin' && !isSuperAdmin(admin)) {
    return refuse(c, 403, {
      code: 'super_admin_required',
      message: 'Only a super admin can read another admin moderation history.',
    });
  }

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
  try {
    const admin = await requireAdmin(c);
    // D107 — a suspended branch's queues are frozen: 423, after the admin gate.
    // requireAdmin covers the HQ compliance freeze (D135). It does not cover
    // the branch licence freeze, so this call stays.
    await requireBranchNotSuspended(c);
    await ensureTables(c.env);

    const userId = Number(c.req.param('userId'));
    if (!Number.isFinite(userId) || userId <= 0) return c.json({ detail: 'Bad user id' }, 400);
    if (userId === admin.id) return c.json({ detail: 'You cannot moderate your own account' }, 400);

    const body = await c.req.json().catch(() => ({} as any));
    const action = String(body.action || '');
    const spec = ACTIONS[action];
    if (!spec) return c.json({ detail: `Unknown action. One of: ${Object.keys(ACTIONS).join(', ')}` }, 400);

    // A reason is mandatory on every action, reinstatement and close included —
    // an unexplained reversal is as hard to audit later as an unexplained ejection.
    const reason = String(body.reason_code || '');
    if (!REASONS.has(reason)) {
      return c.json({ detail: `reason_code must be one of: ${[...REASONS].join(', ')}` }, 400);
    }
    const severity = SEVERITIES.has(String(body.severity)) ? String(body.severity) : 'medium';

    const target = await c.env.DB.prepare(
      'SELECT id, name, role, spinout_lab_active FROM users WHERE id = ?',
    ).bind(userId).first<any>();
    if (!target) return c.json({ detail: 'Not found' }, 404);
    // D133 — an admin target is the Super Admin's. A plain admin reinstating
    // a peer is the defect this refuses.
    if (String(target.role).toLowerCase() === 'admin' && !isSuperAdmin(admin)) {
      return adminTargetRefusal(c);
    }

    const before = Number(target.spinout_lab_active ?? 0);

    if (spec.closeOnly) {
      const closed = await c.env.DB.prepare(
        `UPDATE spinout_moderation_cases
            SET resolved_by = ?, resolved_at = datetime('now'), updated_at = datetime('now')
          WHERE user_id = ? AND resolved_at IS NULL`,
      ).bind(admin.id, userId).run();
      const changes = Number((closed as { meta?: { changes?: number } })?.meta?.changes);
      if (!Number.isFinite(changes) || changes < 1) {
        return refuse(c, 400, {
          code: 'nothing_to_close',
          message: 'There is no unresolved case to close for this member.',
        });
      }
      await logAdminAction(c.env, admin.id, admin.email, 'spinout_moderation', {
        target_user_id: userId,
        moderation_action: action,
        reason_code: reason,
        severity,
      });
      const cases = await c.env.DB.prepare(
        `SELECT ${CASE_COLS} FROM spinout_moderation_cases
          WHERE user_id = ? ORDER BY opened_at DESC LIMIT 100`,
      ).bind(userId).all<any>();
      return c.json({
        cases: cases.results || [],
        lab_access: before === 1,
        account_deactivated: false,
      });
    }

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

    await logAdminAction(c.env, admin.id, admin.email, 'spinout_moderation', {
      target_user_id: userId,
      moderation_action: action,
      reason_code: reason,
      severity,
    });

    const cases = await c.env.DB.prepare(
      `SELECT ${CASE_COLS} FROM spinout_moderation_cases
        WHERE user_id = ? ORDER BY opened_at DESC LIMIT 100`,
    ).bind(userId).all<any>();

    return c.json({
      cases: cases.results || [],
      lab_access: after === 1,
      account_deactivated: false, // never, by construction — see the file header
    });
  } catch (e) {
    return mapError(c, e);
  }
});

export default app;
