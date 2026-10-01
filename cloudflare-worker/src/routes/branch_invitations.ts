/**
 * Accepting a move onto this branch (D121, D441).
 *
 *   GET  /api/branch/invitations/preview?token=
 *   POST /api/branch/invitations/accept   { token }
 *
 * THE LINK CANNOT BE /invite/:token. That path is the events RSVP page, and
 * the Worker's only /invite/:token handler is the public events router. A
 * move invitation sent there asks someone to respond to an event that does
 * not exist. The link is /join/:token, and this is the route behind it.
 *
 * UNAUTHENTICATED ON PURPOSE. The person has no active account on this
 * branch — that is why they were invited — so there is no session to require.
 * The token is the credential. It is stored as a SHA-256 digest (migration
 * 263); a read of the table cannot accept an invitation.
 *
 * IT DOES NOT SIGN THEM IN, AND IT DOES NOT MOVE THEIR RECORDS. D121 is a
 * re-invite: the account is created or reactivated here, and projects, deals
 * and documents stay on the branch they left. They sign in again at /login.
 *
 * AN ACTIVE ACCOUNT IS NOT REWRITTEN. inviteAccount already refuses an email
 * that is active here. If one appears between the invite and the click — they
 * registered, or a second invitation raced — the invitation is spent and the
 * row is left as it is. A forwarded link must not change someone's role.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireBranchTier } from '../util/branch';
import { refuse } from '../util/refusal';
import { sha256Hex } from '../rpc/secret';
import { mapError } from './_t13t14t15_helpers';

const r = new Hono<{ Bindings: Env }>();

/** `invt_` plus the 64 hex characters inviteAccount issues. Anything else is not a token. */
export const INVITATION_TOKEN = /^invt_[0-9a-f]{64}$/;

/**
 * Roles an invitation may grant. A row that names anything else — including a
 * word that would read as an elevation — becomes `exploring`, and the response
 * says so. `super_admins` is a side table this route never writes.
 */
const GRANTED_ROLES = new Set([
  'exploring', 'founder', 'investor', 'advisor', 'partner', 'admin', 'operator', 'service_provider',
]);

type Refusal = { status: 400 | 404 | 410; code: string; message: string };

type Claimed = { id: number; email: string; name: string | null; role: string };

function readToken(raw: unknown): string | null {
  const token = String(raw ?? '').trim();
  return INVITATION_TOKEN.test(token) ? token : null;
}

function grantedRole(raw: unknown): { role: string; note: string | null } {
  const asked = String(raw ?? '').trim().toLowerCase();
  if (!asked || asked === 'exploring') return { role: 'exploring', note: null };
  if (GRANTED_ROLES.has(asked)) return { role: asked, note: null };
  return {
    role: 'exploring',
    note: 'The invitation named a role this branch does not grant, so the account is exploring.',
  };
}

function displayName(email: string, name: string | null): string {
  const given = String(name ?? '').trim().slice(0, 200);
  if (given) return given;
  const local = email.split('@')[0] || email;
  return local.slice(0, 200);
}

async function userByEmail(env: Env, email: string) {
  return env.DB.prepare(
    'SELECT id, role, is_active FROM users WHERE lower(trim(email)) = ?',
  ).bind(email).first<{ id: number; role: string; is_active: number }>();
}

/**
 * Create the account, or turn a deactivated one back on.
 *
 * The role is applied only on those two writes. An account that is already
 * active is returned as it stands.
 */
async function ensureAccount(env: Env, row: Claimed): Promise<{
  userId: number;
  account: 'created' | 'reactivated' | 'already_active';
  role: string;
  role_note: string | null;
}> {
  const { role, note } = grantedRole(row.role);
  const email = String(row.email);
  const name = displayName(email, row.name);
  const existing = await userByEmail(env, email);
  if (existing && Number(existing.is_active) !== 0) {
    return {
      userId: Number(existing.id),
      account: 'already_active',
      role: String(existing.role || 'exploring'),
      role_note: null,
    };
  }
  if (existing) {
    const upd = await env.DB.prepare(
      `UPDATE users
          SET is_active = 1, email_verified = 1, role = ?,
              name = COALESCE(NULLIF(?, ''), name)
        WHERE id = ? AND is_active = 0`,
    ).bind(role, name, existing.id).run();
    if (Number(upd?.meta?.changes ?? 0) === 1) {
      return { userId: Number(existing.id), account: 'reactivated', role, role_note: note };
    }
    const again = await userByEmail(env, email);
    if (again && Number(again.is_active) !== 0) {
      return {
        userId: Number(again.id),
        account: 'already_active',
        role: String(again.role || 'exploring'),
        role_note: null,
      };
    }
    throw new Error('branch invitation: the deactivated account could not be restored');
  }
  try {
    const inserted = await env.DB.prepare(
      `INSERT INTO users (email, name, role, email_verified, is_active)
       VALUES (?, ?, ?, 1, 1)
       RETURNING id`,
    ).bind(email, name, role).first<{ id: number }>();
    if (!inserted?.id) throw new Error('branch invitation: the account was not created');
    return { userId: Number(inserted.id), account: 'created', role, role_note: note };
  } catch (e) {
    // A second invitation for the same email can lose the insert. If the
    // account is now active, the outcome the invitation asked for holds,
    // and this path does not rewrite it.
    const raced = await userByEmail(env, email).catch(() => null);
    if (raced && Number(raced.is_active) !== 0) {
      return {
        userId: Number(raced.id),
        account: 'already_active',
        role: String(raced.role || 'exploring'),
        role_note: null,
      };
    }
    throw e;
  }
}

async function claim(env: Env, hash: string): Promise<Claimed | null> {
  return env.DB.prepare(
    `UPDATE branch_invitations
        SET status = 'accepted', accepted_at = datetime('now'), updated_at = datetime('now')
      WHERE token_hash = ?
        AND status = 'pending'
        AND datetime(expires_at) > datetime('now')
      RETURNING id, email, name, role`,
  ).bind(hash).first<Claimed>();
}

async function revertClaim(env: Env, id: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE branch_invitations
        SET status = 'pending', accepted_at = NULL, updated_at = datetime('now')
      WHERE id = ? AND status = 'accepted'`,
  ).bind(id).run();
}

async function explainUnclaimed(env: Env, hash: string): Promise<Refusal> {
  const row = await env.DB.prepare(
    `SELECT id, status,
            CASE WHEN datetime(expires_at) <= datetime('now') THEN 1 ELSE 0 END AS past
       FROM branch_invitations WHERE token_hash = ?`,
  ).bind(hash).first<{ id: number; status: string; past: number }>();
  if (!row) {
    return { status: 404, code: 'invitation_not_found', message: 'This invitation was not found.' };
  }
  if (row.status === 'accepted') {
    return {
      status: 410,
      code: 'invitation_used',
      message: 'This invitation has already been used. Sign in with the email it was sent to.',
    };
  }
  if (row.status === 'revoked') {
    return { status: 410, code: 'invitation_revoked', message: 'This invitation was withdrawn.' };
  }
  if (row.status === 'expired' || Number(row.past) === 1) {
    if (row.status === 'pending') {
      await env.DB.prepare(
        `UPDATE branch_invitations SET status = 'expired', updated_at = datetime('now')
          WHERE id = ? AND status = 'pending'`,
      ).bind(row.id).run();
    }
    return {
      status: 410,
      code: 'invitation_expired',
      message: 'This invitation has expired. Ask the person who invited you to send another.',
    };
  }
  return { status: 410, code: 'invitation_closed', message: 'This invitation is no longer open.' };
}

function badToken(): Refusal {
  return { status: 400, code: 'invitation_token_invalid', message: 'This link is not a branch invitation.' };
}

// GET /api/branch/invitations/preview — show the invitation. Does not spend it.
r.get('/invitations/preview', async (c) => {
  try {
    const branch = requireBranchTier(c.env);
    const token = readToken(c.req.query('token'));
    if (!token) return refuse(c, 400, badToken());
    const hash = await sha256Hex(token);
    const row = await c.env.DB.prepare(
      `SELECT email, name, role, status, invited_by_name, moved_from_code,
              CASE WHEN datetime(expires_at) <= datetime('now') THEN 1 ELSE 0 END AS past
         FROM branch_invitations WHERE token_hash = ?`,
    ).bind(hash).first<{
      email: string; name: string | null; role: string; status: string;
      invited_by_name: string; moved_from_code: string | null; past: number;
    }>();
    if (!row) return refuse(c, 404, {
      code: 'invitation_not_found',
      message: 'This invitation was not found.',
    });
    return c.json({
      email: row.email,
      name: row.name,
      invited_by_name: row.invited_by_name,
      moved_from_code: row.moved_from_code,
      status: row.status,
      expired: row.status === 'expired' || Number(row.past) === 1,
      branch,
    });
  } catch (e) { return mapError(c, e); }
});

// POST /api/branch/invitations/accept — create or reactivate, then they sign in.
r.post('/invitations/accept', async (c) => {
  let claimed: Claimed | null = null;
  try {
    const branch = requireBranchTier(c.env);
    const body = await c.req.json().catch(() => ({} as { token?: unknown }));
    const token = readToken(body?.token);
    if (!token) return refuse(c, 400, badToken());
    const hash = await sha256Hex(token);
    claimed = await claim(c.env, hash);
    if (!claimed) {
      const why = await explainUnclaimed(c.env, hash);
      return refuse(c, why.status, { code: why.code, message: why.message });
    }
    const account = await ensureAccount(c.env, claimed);
    try {
      await c.env.DB.prepare(
        'INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)',
      ).bind(
        'branch_invitation_accepted',
        JSON.stringify({
          account: account.account,
          role: account.role,
          branch,
        }),
        'invitation',
        account.userId,
      ).run();
    } catch (e) {
      console.warn('[branch-invitations] audit row failed', (e as Error).message);
    }
    return c.json({
      ok: true,
      email: claimed.email,
      account: account.account,
      role: account.role,
      role_note: account.role_note,
      sign_in_path: '/login',
      branch,
    });
  } catch (e) {
    // A failure after the claim must not leave an accepted invitation with
    // no account. The database's own text stays in the log.
    if (claimed) {
      try {
        await revertClaim(c.env, claimed.id);
      } catch (rev) {
        console.warn('[branch-invitations] revert failed', (rev as Error).message);
      }
      console.error('[branch-invitations] accept failed', (e as Error).message);
      return refuse(c, 500, {
        code: 'invitation_not_completed',
        message: 'The invitation could not be completed, so it is still open. Try again.',
      });
    }
    return mapError(c, e);
  }
});

export default r;
