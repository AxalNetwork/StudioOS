// Task #1 (Spin-Out Teams Collaboration) — shared project membership + access.
//
// A Spin-Out project was single-founder via projects.founder_id. This module
// adds an ADDITIVE membership layer (see sql/migrations/119_project_membership.sql)
// and the single source-of-truth access predicate that unions:
//   - founder_id ownership (the original owner), AND
//   - accepted project_members rows (co-founders + advisors).
//
// Access rules (prod / Worker):
//   - admin + partner   → studio staff, full read + write (unchanged).
//   - investor          → NO access here; their ONLY path is the fail-closed,
//                         NDA-gated maskFounderForInvestor view. Never granted
//                         membership-based read/write.
//   - founder owner     → read + write (founder_id match).
//   - cofounder member  → read + write of project DATA (not privileged
//                         stage/status/playbook_week fields).
//   - advisor member    → read + advisory access; NOT a project-data editor.
//
// Member MANAGEMENT (invite/add/remove) is owner + admin/partner only — a
// co-founder or advisor can never alter the roster.

import type { Env, User } from '../types';
import { getSQL } from '../db';

// New founders (Spin-Out Lab active, pre-incorporation) cannot manage
// co-founders/advisors until they reach this lab week. Existing founders
// (lab inactive) are unlocked immediately. One knob, referenced everywhere.
export const TEAM_BUILDING_MIN_LAB_WEEK = 2;

export type MemberRole = 'owner' | 'cofounder' | 'advisor';

// Lazy bootstrap — keyed per-DB via a WeakMap so a reload-during-dev re-runs
// cleanly. Mirrors the ensureProject*Columns pattern in routes/projects.ts.
const _membershipReady = new WeakMap<object, true>();

export async function ensureProjectMembershipSchema(env: Env): Promise<void> {
  if (_membershipReady.has(env)) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS project_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'cofounder',
      status TEXT NOT NULL DEFAULT 'accepted',
      source TEXT,
      invitation_id INTEGER,
      cofounder_connection_id INTEGER,
      added_by_user_id INTEGER,
      accepted_at TEXT,
      removed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_project_members_pair ON project_members (project_id, user_id)`,
    `CREATE INDEX IF NOT EXISTS ix_project_members_user ON project_members (user_id, status)`,
    `CREATE INDEX IF NOT EXISTS ix_project_members_project ON project_members (project_id, status)`,
    `CREATE TABLE IF NOT EXISTS project_member_invitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'cofounder',
      status TEXT NOT NULL DEFAULT 'pending',
      source TEXT,
      invitee_user_id INTEGER,
      invitee_email TEXT,
      token_hash TEXT,
      cofounder_connection_id INTEGER,
      invited_by_user_id INTEGER,
      accepted_by_user_id INTEGER,
      expires_at TEXT,
      accepted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_pmi_token ON project_member_invitations (token_hash)`,
    `CREATE INDEX IF NOT EXISTS ix_pmi_project ON project_member_invitations (project_id, status)`,
    `CREATE INDEX IF NOT EXISTS ix_pmi_invitee_user ON project_member_invitations (invitee_user_id, status)`,
    `CREATE INDEX IF NOT EXISTS ix_pmi_invitee_email ON project_member_invitations (invitee_email, status)`,
  ];
  for (const s of stmts) {
    try { await env.DB.exec(s.replace(/\s+/g, ' ').trim()); } catch (_e) { /* idempotent */ }
  }
  _membershipReady.set(env, true);
}

/** SHA-256 hex of a raw token. Link/email invitations store only the hash. */
export async function hashInviteToken(token: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Normalize an email for matching/storage: trim + lowercase. */
export function normalizeEmail(email: string | null | undefined): string {
  return String(email || '').trim().toLowerCase();
}

/** The accepted membership role for a user on a project, or null. */
export async function getProjectMembershipRole(
  env: Env,
  projectId: number,
  userId: number,
): Promise<MemberRole | null> {
  await ensureProjectMembershipSchema(env);
  const sql = getSQL(env);
  try {
    const rows = await sql`SELECT role FROM project_members WHERE project_id = ${projectId} AND user_id = ${userId} AND status = 'accepted' LIMIT 1`;
    return rows.length ? (rows[0].role as MemberRole) : null;
  } finally {
    await sql.end();
  }
}

/** Project ids where the user is an accepted member (any role). */
export async function getMemberProjectIds(env: Env, userId: number): Promise<number[]> {
  await ensureProjectMembershipSchema(env);
  const sql = getSQL(env);
  try {
    const rows = await sql`SELECT project_id FROM project_members WHERE user_id = ${userId} AND status = 'accepted'`;
    return rows.map((r: any) => Number(r.project_id));
  } finally {
    await sql.end();
  }
}

/**
 * Single source-of-truth access predicate. `write=true` additionally requires
 * data-editor rights (owner or co-founder; advisors are read-only on data).
 *
 * Investors are ALWAYS denied here — their only project view is the masked,
 * NDA-gated fallback in GET /api/projects/:id.
 */
export async function canAccessProject(
  env: Env,
  user: Pick<User, 'id' | 'role' | 'founder_id'>,
  project: { id: number; founder_id: number | null },
  opts: { write?: boolean } = {},
): Promise<boolean> {
  if (user.role === 'admin' || user.role === 'partner') return true;
  if (user.role === 'investor') return false;
  if (user.role === 'founder' && !!user.founder_id && project.founder_id === user.founder_id) return true;
  const role = await getProjectMembershipRole(env, project.id, user.id);
  if (!role) return false;
  if (opts.write && role === 'advisor') return false;
  return true;
}

/** True iff the user may MANAGE the roster (invite/add/remove): owner or staff. */
export function isProjectManager(
  user: Pick<User, 'role' | 'founder_id'>,
  project: { founder_id: number | null },
): boolean {
  if (user.role === 'admin' || user.role === 'partner') return true;
  return user.role === 'founder' && !!user.founder_id && project.founder_id === user.founder_id;
}

/**
 * Stage gate for member management. A NEW founder (Spin-Out Lab active and not
 * yet incorporated) cannot build a team until they reach TEAM_BUILDING_MIN_LAB_WEEK;
 * EXISTING founders (lab inactive) and studio staff are unlocked immediately.
 *
 * `user` is the calling MANAGER (owner). Staff bypass the gate entirely.
 */
export function evaluateTeamGate(user: {
  role: string;
  spinout_lab_active?: number | null;
  spinout_lab_week?: number | null;
  is_incorporated?: number | null;
}): { locked: boolean; reason: string | null; unlock_week: number } {
  if (user.role === 'admin' || user.role === 'partner') {
    return { locked: false, reason: null, unlock_week: TEAM_BUILDING_MIN_LAB_WEEK };
  }
  const labActive = Number(user.spinout_lab_active ?? 0) === 1;
  const incorporated = Number(user.is_incorporated ?? 0) === 1;
  // Existing founder (or graduate): unlocked.
  if (!labActive || incorporated) {
    return { locked: false, reason: null, unlock_week: TEAM_BUILDING_MIN_LAB_WEEK };
  }
  const week = Number(user.spinout_lab_week ?? 1);
  if (week >= TEAM_BUILDING_MIN_LAB_WEEK) {
    return { locked: false, reason: null, unlock_week: TEAM_BUILDING_MIN_LAB_WEEK };
  }
  return {
    locked: true,
    reason: `Co-founder and advisor invites unlock in Week ${TEAM_BUILDING_MIN_LAB_WEEK} of the Spin-Out Lab. Keep going — you're in Week ${week}.`,
    unlock_week: TEAM_BUILDING_MIN_LAB_WEEK,
  };
}
