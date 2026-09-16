/**
 * Super Admin holders — who may franchise the platform.
 *
 * The elevation is a row in `super_admins` (migration 199 — a side table,
 * because `users` sits at D1's 100-column ceiling), narrowed to a single named
 * holder by 207. Until this router, the only way to change it was SQL against
 * production — which is also what `routes/admin.ts` says about the admin role
 * itself, and for the same reason: a compromised admin session must not be
 * able to mint more admins. The Super Admin is the one exception where a
 * console makes sense, because the holder set is tiny, the act is rare, and
 * the alternative is an ops workflow that interpolated an email into a SQL
 * string.
 *
 * SUPER ADMIN ONLY, and the writes carry the same bar as impersonation
 * (`routes/admin.ts` POST /impersonate): a TOTP-minted session, a RECENT
 * step-up, then the elevation. Reads need the elevation alone.
 *
 * That bar was written here and now lives in `auth.ts` as
 * `requireSuperAdminWriteBar` (D134), because promoting and demoting an admin
 * want the same three checks in the same order and a third hand-written copy
 * is how one of them comes to check only two.
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
 * Every row this router returns carries `is_super_admin` DERIVED from the
 * side table (`CASE WHEN s.user_id IS NULL`), never read from `users`: a
 * database that applied the first version of 199 still has a column of that
 * name, and it says every admin is elevated.
 *
 * Errors from the gates propagate to the global handler, which maps
 * 'Super admin required', 'TOTP required' and 'step_up_required' to 403 —
 * a gate that works and reports a 500 is a gate nobody can act on.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';

const r = new Hono<{ Bindings: Env }>();

type HolderRow = {
  id: number; email: string; name: string; role: string;
  is_active: number; is_super_admin: number;
  granted_at: string | null; granted_by_user_id: number | null;
};

// The same projection in both reads, written out twice rather than shared
// through a template constant: check-sql-prepare treats any `${…}` inside a
// prepared statement as text no binding protects, and a guard with a baseline
// entry for "this one is fine" is a guard people learn to baseline.
async function holders(env: Env): Promise<HolderRow[]> {
  const res = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.is_active,
            1 AS is_super_admin, s.granted_at, s.granted_by_user_id
       FROM super_admins s
       JOIN users u ON u.id = s.user_id
      WHERE LOWER(u.role) = 'admin'
      ORDER BY u.id`,
  ).all<HolderRow>();
  return res.results ?? [];
}

async function userById(env: Env, id: number): Promise<HolderRow | null> {
  return await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.is_active,
            CASE WHEN s.user_id IS NULL THEN 0 ELSE 1 END AS is_super_admin,
            s.granted_at, s.granted_by_user_id
       FROM users u
       LEFT JOIN super_admins s ON s.user_id = u.id
      WHERE u.id = ?`,
  ).bind(id).first<HolderRow>();
}

async function audit(env: Env, actorId: number, action: string, target: HolderRow) {
  await env.DB.prepare(
    'INSERT INTO admin_audit_log (admin_user_id, action, filters_json) VALUES (?, ?, ?)',
  ).bind(actorId, action, JSON.stringify({ target_user_id: target.id, target_email: target.email })).run();
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
  const actor = await requireSuperAdminWriteBar(c);
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
  // D133 — ONE HOLDER, ENFORCED. "Only one super admin profile exists" was a
  // migration that already ran and a sentence in a React component, not a
  // constraint: 207's `DELETE` is a one-shot, the table's only rule is
  // `user_id PRIMARY KEY` — which says an admin holds it at most ONCE, not that
  // at most one admin holds it — and nothing here counted. A holder could
  // elevate a second, a third, an nth.
  //
  // THE CEILING BELONGS BESIDE THE FLOOR. `DELETE /:userId` already refuses to
  // leave the set empty (`last_super_admin`); this is the same rule read from
  // the other end, and keeping them in one file is what stops one of them
  // being changed without the other. Transferring the elevation is still
  // possible and still deliberate: revoke, then grant — two audited acts,
  // each behind TOTP and a step-up, rather than a silent second holder.
  const held = (await holders(c.env)).filter((h) => Number(h.is_active) === 1);
  if (held.length > 0) {
    // A TRANSFER IS ONE ACT, NOT TWO, AND THE CEILING WOULD OTHERWISE BE A WALL.
    // This was caught by a mutation rather than by reading: with exactly one
    // holder, `DELETE /:userId` refuses THREE ways — `cannot_revoke_self` for
    // the holder's own row, `last_super_admin` for the only row, and there is
    // nobody else to ask. So "revoke first, then grant" is not a path that
    // exists, and a bare ceiling would have frozen the elevation on whoever
    // held it, permanently.
    //
    // The escape is explicit and atomic: the holder names their successor and
    // says `transfer`, and the two writes go in one `batch` so the set moves
    // from {holder} to {successor} without ever being two or empty. Anything
    // less deliberate — a silent upgrade of a plain grant — would be the
    // second-holder hole wearing a different name.
    // THE CALLER IS NECESSARILY THE HOLDER HERE, so this does not re-check it.
    // A first draft read `held[0].id === actor.id` and a mutation could not kill
    // it: the write bar has already proved the caller is a super admin, and
    // reaching this line proves `held.length === 1`, so the one active holder IS
    // the caller. A database that predates this ceiling and carries TWO holders
    // fails the length test and gets the 409 — which is the right answer, since
    // it should be reduced to one before anything is handed on. A conjunct that
    // cannot be false is not a guard, so it is gone rather than decorative.
    const wantsTransfer = String(c.req.query('transfer') || '') === '1';
    if (!(wantsTransfer && held.length === 1)) {
      return c.json({
        error: 'A super admin already holds the platform, and there is only ever one. '
          + 'The holder transfers it with ?transfer=1, naming their successor.',
        code: 'super_admin_exists',
        holder: { id: held[0].id, email: held[0].email },
      }, 409);
    }
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO super_admins (user_id, granted_by_user_id, note)
         SELECT id, ?, ? FROM users WHERE id = ? AND LOWER(role) = 'admin'`,
      ).bind(actor.id, `Transferred from user ${actor.id} through /api/admin/super-admins.`, id),
      c.env.DB.prepare('DELETE FROM super_admins WHERE user_id = ?').bind(actor.id),
    ]);
    await audit(c.env, actor.id, 'super_admin_grant', target);
    await audit(c.env, actor.id, 'super_admin_revoke', { ...actor, is_super_admin: 1 } as any);
    return c.json({
      ok: true, transferred_from: actor.id,
      holder: { ...target, is_super_admin: 1, granted_by_user_id: actor.id },
    });
  }
  // The INSERT re-checks the role itself: a role change between the read above
  // and this write must not leave a non-admin holding the franchise.
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO super_admins (user_id, granted_by_user_id, note)
     SELECT id, ?, ? FROM users WHERE id = ? AND LOWER(role) = 'admin'`,
  ).bind(actor.id, `Granted through /api/admin/super-admins by user ${actor.id}.`, id).run();
  await audit(c.env, actor.id, 'super_admin_grant', target);
  return c.json({ ok: true, holder: { ...target, is_super_admin: 1, granted_by_user_id: actor.id } });
});

r.delete('/:userId', async (c) => {
  const actor = await requireSuperAdminWriteBar(c);
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
  await c.env.DB.prepare('DELETE FROM super_admins WHERE user_id = ?').bind(id).run();
  await audit(c.env, actor.id, 'super_admin_revoke', target);
  return c.json({ ok: true });
});

export default r;
