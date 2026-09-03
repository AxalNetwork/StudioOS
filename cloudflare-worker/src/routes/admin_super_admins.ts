/**
 * Super Admin holders — who may franchise the platform.
 *
 * The elevation is a column on `users` (migration 199), narrowed to a single
 * named holder by 207. Until this router, the only way to change it was SQL
 * against production — which is also what `routes/admin.ts` says about the
 * admin role itself, and for the same reason: a compromised admin session must
 * not be able to mint more admins. The Super Admin is the one exception where
 * a console makes sense, because the holder set is tiny, the act is rare, and
 * the alternative is an ops workflow that interpolated an email into a SQL
 * string.
 *
 * SUPER ADMIN ONLY, and the writes carry the same bar as impersonation
 * (`routes/admin.ts` POST /impersonate): a TOTP-minted session, a RECENT
 * step-up, then the elevation. Reads need the elevation alone.
 *
 *   GET    /            every holder
 *   POST   /:userId     grant — the target must already be an admin, because
 *                       the Super Admin is an elevation on admin, not a role
 *   DELETE /:userId     revoke — never yourself, never the last active holder
 *
 * Every write lands in admin_audit_log as `super_admin_grant` /
 * `super_admin_revoke`, naming the target. Mounted at /api/admin/super-admins
 * BEFORE the catch-all /api/admin in index.ts, the same precedence trick
 * admin_licences uses.
 *
 * Errors from the gates propagate to the global handler, which maps
 * 'Super admin required', 'TOTP required' and 'step_up_required' to 403 —
 * a gate that works and reports a 500 is a gate nobody can act on.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireFactor, requireStepUp, requireSuperAdmin } from '../auth';

const r = new Hono<{ Bindings: Env }>();

type HolderRow = {
  id: number; email: string; name: string; role: string;
  is_active: number; is_super_admin: number;
};

// The same six columns in both reads, written out twice rather than shared
// through a template constant: check-sql-prepare treats any `${…}` inside a
// prepared statement as text no binding protects, and a guard with a baseline
// entry for "this one is fine" is a guard people learn to baseline.
async function holders(env: Env): Promise<HolderRow[]> {
  const res = await env.DB.prepare(
    `SELECT id, email, name, role, is_active, is_super_admin FROM users
      WHERE is_super_admin = 1 AND LOWER(role) = 'admin'
      ORDER BY id`,
  ).all<HolderRow>();
  return res.results ?? [];
}

async function userById(env: Env, id: number): Promise<HolderRow | null> {
  return await env.DB.prepare(
    'SELECT id, email, name, role, is_active, is_super_admin FROM users WHERE id = ?',
  ).bind(id).first<HolderRow>();
}

async function audit(env: Env, actorId: number, action: string, target: HolderRow) {
  await env.DB.prepare(
    'INSERT INTO admin_audit_log (admin_user_id, action, filters_json) VALUES (?, ?, ?)',
  ).bind(actorId, action, JSON.stringify({ target_user_id: target.id, target_email: target.email })).run();
}

/** The write bar, in the order impersonation checks it. */
async function requireWriteBar(c: Parameters<typeof requireSuperAdmin>[0]) {
  await requireFactor(c, 'totp');
  await requireStepUp(c);
  return await requireSuperAdmin(c);
}

function parseUserId(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

r.get('/', async (c) => {
  await requireSuperAdmin(c);
  return c.json({ holders: await holders(c.env) });
});

r.post('/:userId', async (c) => {
  const actor = await requireWriteBar(c);
  const id = parseUserId(c.req.param('userId'));
  if (id === null) return c.json({ error: 'Invalid user id' }, 400);
  const target = await userById(c.env, id);
  if (!target) return c.json({ error: 'User not found' }, 404);
  if (String(target.role).toLowerCase() !== 'admin') {
    return c.json({
      error: 'Only an existing admin can be elevated: the Super Admin is an elevation on admin, not a role.',
      code: 'not_an_admin',
    }, 409);
  }
  if (Number(target.is_super_admin) === 1) {
    return c.json({ ok: true, already: true, holder: target });
  }
  await c.env.DB.prepare(
    "UPDATE users SET is_super_admin = 1 WHERE id = ? AND LOWER(role) = 'admin'",
  ).bind(id).run();
  await audit(c.env, actor.id, 'super_admin_grant', target);
  return c.json({ ok: true, holder: { ...target, is_super_admin: 1 } });
});

r.delete('/:userId', async (c) => {
  const actor = await requireWriteBar(c);
  const id = parseUserId(c.req.param('userId'));
  if (id === null) return c.json({ error: 'Invalid user id' }, 400);
  if (id === actor.id) {
    return c.json({
      error: 'You cannot revoke your own Super Admin elevation; another holder has to.',
      code: 'cannot_revoke_self',
    }, 409);
  }
  const target = await userById(c.env, id);
  if (!target) return c.json({ error: 'User not found' }, 404);
  if (Number(target.is_super_admin) !== 1) {
    return c.json({ ok: true, already: true });
  }
  const remaining = (await holders(c.env)).filter((h) => h.id !== id && Number(h.is_active) === 1);
  if (remaining.length === 0) {
    return c.json({
      error: 'This is the last active Super Admin; revoking it would leave nobody able to franchise. Elevate another admin first.',
      code: 'last_super_admin',
    }, 409);
  }
  await c.env.DB.prepare('UPDATE users SET is_super_admin = 0 WHERE id = ?').bind(id).run();
  await audit(c.env, actor.id, 'super_admin_revoke', target);
  return c.json({ ok: true });
});

export default r;
