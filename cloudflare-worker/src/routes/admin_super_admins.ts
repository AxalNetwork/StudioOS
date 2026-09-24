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
 *                       the Super Admin is an elevation on admin, not a role;
 *                       with `?transfer=1` the holder hands the platform on,
 *                       both writes in one batch (D133), each conditioned on
 *                       the set at the write so a lost race moves nothing
 *                       (D240). Either way the body carries a typed `reason`
 *                       of ten characters or more (D221)
 *   DELETE /:userId     revoke — never yourself, never the last active holder
 *
 * Every write lands in admin_audit_log as `super_admin_grant` /
 * `super_admin_revoke` through `logAdminAction`, which sets `viewed_user_id`
 * from `target_user_id` — so HQ Security's feed NAMES the account the
 * elevation moved to or from, and carries the reason. Until D221 these rows
 * were a raw INSERT with the target buried in `filters_json`, and the feed,
 * which joins `viewed_user_id`, showed a transfer with no target at all.
 * Mounted at /api/admin/super-admins
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
import { logAdminAction } from '../services/adminAudit';

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

/**
 * One holder change, recorded through the shared writer (D159).
 *
 * `target_user_id` is the key `logAdminAction` reads into `viewed_user_id`,
 * which is the column the Security feed joins to name who an act was about.
 * The writer never throws: the elevation has already moved by the time this
 * runs, and a recorded act undone by its own audit — a 500 after a committed
 * batch — would be worse than the gap an audit exists to close.
 */
async function audit(
  env: Env, actor: { id: number; email: string }, action: string,
  target: { id: number; email: string }, extra: Record<string, unknown> = {},
) {
  await logAdminAction(env, actor.id, actor.email, action, {
    target_user_id: target.id, target_email: target.email, ...extra,
  });
}

/**
 * D221 — the reason a holder change is made, typed by the holder.
 *
 * Every other act H20 draws as HQ's takes one: opening a support session,
 * demoting an admin, overriding a binding agreement, appointing an admin
 * through a licence. The elevation that governs all of them was the one write
 * with no why, so the Security row for the most consequential act on the
 * platform said who and when and nothing else. Ten characters, the floor those
 * four share, so a keystroke gesture does not pass for a reason.
 */
export const HOLDER_REASON_MIN = 10;

async function readReason(c: any): Promise<string> {
  const body = await c.req.json().catch(() => ({}));
  return String(body?.reason ?? '').trim().slice(0, 500);
}

function reasonRefusal(c: any) {
  return c.json({
    error: `Say why the elevation is changing hands — at least ${HOLDER_REASON_MIN} characters. It is recorded in Security beside the change.`,
    code: 'reason_too_short',
  }, 400);
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
  // D221 — A DEACTIVATED ACCOUNT CANNOT RECEIVE THE ELEVATION. Nothing checked
  // this, and it was the one transfer that cannot be undone from inside the
  // product: the INSERT below filters on role, not on `is_active`, so the
  // holder could hand the elevation to an account that cannot sign in
  // (`getCurrentUser` refuses an inactive user). The old holder has then given
  // it up, the new one can never use it, and re-activating an administrator is
  // itself the holder's act alone (D133) — so the platform would have no
  // Super Admin and no route back except SQL. The picker offered such accounts,
  // because the Team payload lists every admin with its state. It is refused
  // here, before the reason is asked for, because it is a real obstacle and
  // not the price of a write.
  if (Number(target.is_active) !== 1) {
    return c.json({
      error: 'This administrator\'s account is deactivated, so it cannot sign in to use the elevation. '
        + 'Reactivate the account first, then hand the elevation on.',
      code: 'not_active',
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
  // possible and still deliberate — as ONE act, `?transfer=1`, for the reason
  // the next comment gives: with one holder, "revoke, then grant" is not a
  // path that exists.
  const held = (await holders(c.env)).filter((h) => Number(h.is_active) === 1);
  // D221 — THERE IS NO PLAIN GRANT, AND THERE HAS BEEN NONE SINCE D133. Only a
  // holder passes the write bar, so the set this reads always holds the caller
  // and a grant is always a transfer. The branch that followed this block —
  // an unconditional grant for an empty set — could never run, and D221's
  // mutation run proved it: removing the reason check D221 had put on it, and
  // its audit call, both passed every test. It is gone rather than decorative.
  // What stays is the one way the set CAN read empty here: a race, in which the
  // elevation leaves between the gate and this read. That refuses and moves
  // nothing, where the old branch would have granted into the gap.
  if (held.length === 0) {
    return c.json({
      error: 'Nobody holds the elevation at this moment — it changed while this request was in flight — so there is nothing to hand on. Nothing was moved; reload before trying again.',
      code: 'no_active_holder',
    }, 409);
  }
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
  // THE CALLER IS THE HOLDER HERE — FOR ONE REQUEST AT A TIME. A first draft
  // read `held[0].id === actor.id` and a mutation could not kill it: the write
  // bar has already proved the caller is a super admin, and reaching this line
  // proves `held.length === 1`, so for a request running alone the one active
  // holder IS the caller. A database that predates this ceiling and carries
  // TWO holders fails the length test and gets the 409 — which is the right
  // answer, since it should be reduced to one before anything is handed on.
  //
  // D221 CORRECTED THE CLAIM THIS COMMENT USED TO MAKE, that the caller is the
  // holder "necessarily". It is not under two OVERLAPPING transfers: the gate
  // and `holders()` are separate reads, and the batch below is a third, so a
  // second transfer by the same holder can pass both reads before the first
  // one lands. Re-adding the id conjunct here would narrow that and not close
  // it (both requests can read the set before either writes), so it is not
  // re-added.
  //
  // D240 — THE WRITE NOW ENFORCES THE CEILING. The batch below grants only
  // while the caller still holds the elevation AT THE WRITE, and gives the
  // caller's row up only when the successor holds; a request that lost the
  // race moves nothing and is told so (`holder_changed`). The reads above
  // remain what they are — early, legible refusals — and are no longer what
  // keeps the set at one.
  const wantsTransfer = String(c.req.query('transfer') || '') === '1';
  if (!(wantsTransfer && held.length === 1)) {
    return c.json({
      error: 'A super admin already holds the platform, and there is only ever one. '
        + 'The holder transfers it with ?transfer=1, naming their successor.',
      code: 'super_admin_exists',
      holder: { id: held[0].id, email: held[0].email },
    }, 409);
  }
  // THE REASON IS CHECKED LAST, after every refusal, because it is the price
  // of a write rather than a condition on asking: a request the ceiling or
  // the role check would refuse anyway answers with THAT refusal, which names
  // the real obstacle, instead of a demand for a sentence that would change
  // nothing.
  const reason = await readReason(c);
  if (reason.length < HOLDER_REASON_MIN) return reasonRefusal(c);
  // D240 — BOTH WRITES ARE CONDITIONED ON THE SET AS IT IS AT THE WRITE.
  //
  //   1. The grant happens only while the caller still holds the elevation.
  //      A second transfer that passed the reads before a first one landed
  //      finds the caller gone here and grants nobody.
  //   2. The caller's row goes only when the successor now holds. A batch is
  //      one transaction whose statements run in order, so this one reads the
  //      table after the grant — but it cannot branch on the grant's RESULT,
  //      so it re-derives it from the table. Without the condition, a grant
  //      that did not happen (the caller already gone, or the successor no
  //      longer an admin) would still take the caller's row, and a lost race
  //      would empty the set instead of moving nothing.
  //
  // The two therefore move together or not at all, and `meta.changes` says
  // which: 1 and 1 is a transfer, 0 and 0 is a request the set outran.
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO super_admins (user_id, granted_by_user_id, note)
       SELECT id, ?, ? FROM users
        WHERE id = ? AND LOWER(role) = 'admin'
          AND EXISTS (SELECT 1 FROM super_admins WHERE user_id = ?)`,
    ).bind(actor.id, `Transferred from user ${actor.id} through /api/admin/super-admins.`, id, actor.id),
    c.env.DB.prepare(
      `DELETE FROM super_admins
        WHERE user_id = ?
          AND EXISTS (SELECT 1 FROM super_admins WHERE user_id = ?)`,
    ).bind(actor.id, id),
  ]);
  const granted = Number(results?.[0]?.meta?.changes ?? NaN);
  const released = Number(results?.[1]?.meta?.changes ?? NaN);
  if (!(granted === 1 && released === 1)) {
    // NOTHING IS RECORDED ON THIS PATH. An audit row says the elevation moved;
    // here it did not, so the rows are written only after the check above.
    const now = await holders(c.env);
    const callerHolds = now.some((h) => h.id === actor.id);
    const successorHolds = now.some((h) => h.id === id);
    // THE DOUBLE-CLICK, ANSWERED ON PURPOSE. The same transfer sent twice: the
    // second finds the caller gone and the successor holding, which is the end
    // state the operator asked for. It gets the same answer as a transfer to
    // someone who already holds, not a 409 that would read as a failure of an
    // act that succeeded.
    if (granted === 0 && released === 0 && !callerHolds && successorHolds) {
      const holder = await userById(c.env, id);
      return c.json({ ok: true, already: true, holder });
    }
    // THE HOLDER DID NOT CHANGE, THE SUCCESSOR DID. The caller still holds and
    // nothing was granted: the successor stopped being an administrator between
    // the checks above and the write. It is the case that proves the DELETE's
    // condition — without it the caller's row would have gone and the set would
    // be empty — and it gets its own code, because "the holder changed" would
    // be untrue.
    if (granted === 0 && released === 0 && callerHolds) {
      return c.json({
        error: 'The administrator you named stopped being eligible while this request was in flight, so nothing was moved. You still hold the elevation.',
        code: 'successor_changed',
        holders: now.map((h) => h.id),
      }, 409);
    }
    return c.json({
      error: granted === 0 && released === 0
        ? 'The elevation changed hands while this request was in flight, so nothing was moved. Reload to see who holds it now.'
        : 'The elevation changed hands while this request was in flight. Reload to see who holds it now.',
      code: 'holder_changed',
      holders: now.map((h) => h.id),
    }, 409);
  }
  await audit(c.env, actor, 'super_admin_grant', target, { reason, transfer: true });
  await audit(c.env, actor, 'super_admin_revoke', actor, { reason, transfer: true, transferred_to: target.id });
  return c.json({
    ok: true, transferred_from: actor.id,
    holder: { ...target, is_super_admin: 1, granted_by_user_id: actor.id },
  });
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
  // No reason is asked here, and the omission is deliberate rather than
  // forgotten: with the one-holder ceiling this route refuses three ways
  // (`cannot_revoke_self`, `last_super_admin`, nobody else to ask), so it is
  // reachable only on a database that predates D133 and carries two holders.
  // A reason field on a control nobody can reach would be decoration.
  await audit(c.env, actor, 'super_admin_revoke', target);
  return c.json({ ok: true });
});

export default r;
