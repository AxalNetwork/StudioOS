/**
 * #4707 — HQ licence routes: lifecycle: activation, suspend, reinstate, renew and terminate, with admin deprovisioning. Mounted by `admin_licences.ts` at
 * `/api/admin/licences`, in the order the routes were declared before the split;
 * moved unchanged, with their original comments.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import { notifyLicenceAdmins } from '../services/complianceLadder';
import { mapError, nowIso } from './_t13t14t15_helpers';
import { hashEmail } from '../util/hashEmail';
import { pushLicenceToBranch } from '../services/licencePush';
import { branchByCode } from '../services/branches';
import { mirrorBranchAction } from '../services/auditMirror';
import { str, byUid, logEvent, pushOutcome, transitionRefusal, activationBlockers } from '../services/licenceLedgerCore';
import type { LicenceRenewResult, LicenceSuspendResult, LicenceTransitionResult } from '../services/licenceContracts';

const r = new Hono<{ Bindings: Env }>();

// Step 5 — what blocks activation, before trying it.
r.get('/:uid/activation', async (c) => {
  try {
    await requireSuperAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const blockers = await activationBlockers(c.env, licence);
    return c.json({
      blockers,
      can_activate: blockers.length === 0,
      // The canvas is explicit that a pending signature is NOT a blocker, and
      // says so on the screen rather than leaving it to be inferred.
      notes: ['A pending signature does not block activation.'],
    });
  } catch (e) { return mapError(c, e); }
});

r.post('/:uid/activate', async (c) => {
  try {
    const admin = await requireSuperAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const blockers = await activationBlockers(c.env, licence);
    if (blockers.length) return c.json({ error: 'blocked', blockers }, 409);
    await c.env.DB.prepare(
      "UPDATE territory_licences SET status = 'active', status_note = NULL, suspended_at = NULL, updated_at = ? WHERE id = ?",
    ).bind(nowIso(), licence.id).run();
    const pushed = await pushLicenceToBranch(c.env, licence.id);
    await logEvent(c.env, licence.id, 'activated', admin.id, undefined, null,
      { before: { status: licence.status }, after: { status: 'active' } }, pushOutcome(pushed));
    return c.json({ ok: true, status: 'active', pushed } satisfies LicenceTransitionResult);
  } catch (e) { return mapError(c, e); }
});

r.post('/:uid/suspend', async (c) => {
  try {
    const admin = await requireSuperAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    // D139 — the state machine, on `reinstate`'s own 409 shape.
    const refusal = transitionRefusal(licence.status, 'suspend');
    if (refusal) return c.json({ error: 'bad_transition', message: refusal }, 409);
    const note = str(c.req.query('note') || (await c.req.json().catch(() => ({} as any)))?.note, 1000);
    if (!note) return c.json({ error: 'a suspension must record why' }, 400);
    // Territory rows are untouched on purpose: a suspended licence still holds
    // its countries. Releasing them is a termination, not a lapse.
    await c.env.DB.prepare(
      "UPDATE territory_licences SET status = 'suspended', status_note = ?, suspended_at = ?, updated_at = ? WHERE id = ?",
    ).bind(note, nowIso(), nowIso(), licence.id).run();
    // D135 — THIS FILE HAD ZERO `notify()` CALLS. Suspending a licence changed
    // four columns in HQ's ledger and told the holder nothing: they found out by
    // hitting a 423. "First admins get notified" is the ladder's first sentence,
    // so this is the missing half of the flow rather than an addition to it.
    await notifyLicenceAdmins(c.env, licence.id, {
      type: 'licence_suspended',
      title: 'Your licence has been suspended by HQ',
      body: `${note} Your territory is not released — suspension is not a lapse — and reading is unaffected.`,
      payload: { licence_uid: licence.uid },
    });
    // REPORTED, NEVER THROWN. The suspension is recorded at HQ whatever the
    // branch does; `pushed.ok === false` is a fact about the branch, and a 502
    // here would ask an operator to re-suspend something already suspended.
    const pushed = await pushLicenceToBranch(c.env, licence.id);
    await logEvent(c.env, licence.id, 'suspended', admin.id, null, note,
      { before: { status: licence.status }, after: { status: 'suspended' } }, pushOutcome(pushed));
    return c.json({ ok: true, status: 'suspended', territory_released: false, pushed } satisfies LicenceSuspendResult);
  } catch (e) { return mapError(c, e); }
});

r.post('/:uid/reinstate', async (c) => {
  try {
    const admin = await requireSuperAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    if (licence.status !== 'suspended') {
      return c.json({ error: 'only a suspended licence can be reinstated' }, 409);
    }
    await c.env.DB.prepare(
      "UPDATE territory_licences SET status = 'active', status_note = NULL, suspended_at = NULL, updated_at = ? WHERE id = ?",
    ).bind(nowIso(), licence.id).run();
    await notifyLicenceAdmins(c.env, licence.id, {
      type: 'licence_reinstated',
      title: 'Your licence is active again',
      body: 'HQ has reinstated it. Your account can make changes again.',
      payload: { licence_uid: licence.uid },
    });
    const pushed = await pushLicenceToBranch(c.env, licence.id);
    await logEvent(c.env, licence.id, 'reinstated', admin.id, undefined, null,
      { before: { status: 'suspended' }, after: { status: 'active' } }, pushOutcome(pushed));
    return c.json({ ok: true, status: 'active', pushed } satisfies LicenceTransitionResult);
  } catch (e) { return mapError(c, e); }
});

r.post('/:uid/renew', async (c) => {
  try {
    const admin = await requireSuperAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    // D139 — the state machine, on `reinstate`'s own 409 shape.
    const refusal = transitionRefusal(licence.status, 'renew');
    if (refusal) return c.json({ error: 'bad_transition', message: refusal }, 409);
    const b = await c.req.json().catch(() => ({} as any));
    // An explicit date wins. Otherwise push out by the term, from the CURRENT
    // renewal date rather than from today, so a late renewal does not silently
    // shorten the next period.
    let next = str(b?.renews_on, 32);
    if (!next) {
      const years = Number(licence.term_years) || 1;
      const base = licence.renews_on ? new Date(licence.renews_on) : new Date();
      if (Number.isNaN(base.getTime())) return c.json({ error: 'the current renewal date is unreadable — set one explicitly' }, 400);
      base.setFullYear(base.getFullYear() + years);
      next = base.toISOString().slice(0, 10);
    }
    await c.env.DB.prepare(
      'UPDATE territory_licences SET renews_on = ?, updated_at = ? WHERE id = ?',
    ).bind(next, nowIso(), licence.id).run();
    const pushed = await pushLicenceToBranch(c.env, licence.id);
    await logEvent(c.env, licence.id, 'renewed', admin.id, { renews_on: next }, null,
      { before: { renews_on: licence.renews_on ?? null }, after: { renews_on: next } }, pushOutcome(pushed));
    return c.json({ ok: true, renews_on: next, pushed } satisfies LicenceRenewResult);
  } catch (e) { return mapError(c, e); }
});

/**
 * What a termination does to the people who administered the licence (D145).
 *
 * WHAT WAS LEFT BEHIND. Terminate released the territory, set the status and —
 * since D139 — withdrew the licence's open compliance notices. It never touched
 * `users.role`, `licence_admins` or `is_active`, so afterwards the licence's
 * administrators still held `role = 'admin'` over a licence that no longer
 * exists: an unscoped admin, which is exactly the state D134's door was built
 * to make unreachable, arriving through the back.
 *
 * DEMOTE THEN DETACH, NEVER THE REVERSE, and that order is not a preference.
 * `DELETE /:uid/admins/:userId` refuses while the account still holds the role
 * precisely because detaching first leaves an admin bound to nothing. This
 * composes the two in the order D134 already enforces between them.
 *
 * ONE FLOOR, NOT TWO. A `super_admins` holder is skipped: the elevation sits ON
 * the admin role, so demoting its holder would leave it pointing at a
 * non-admin — the same reason `POST /users/:userId/demote-admin` refuses that
 * target. A "never demote the last active admin" floor was considered and NOT
 * added, because `admin.ts` already retired its own for the reason that applies
 * here unchanged: the caller has just passed `requireSuperAdmin`, is an active
 * admin, and cannot be one of this licence's administrators being demoted — so
 * at least one active admin always survives, by construction. A conjunct that
 * cannot be false is not a guard.
 *
 * TRUST OBLIGATIONS FOLLOW THE ROLE; THE EXPLORING REVIEW DOES NOT. Re-seeding
 * with `pruneStaleForRole` waives the admin-only obligations rather than
 * deleting them, so the audit survives — the same call the demote route makes.
 * `resetExploringReview` is deliberately NOT made: it is module-private to
 * `routes/admin.ts`, and more to the point these accounts are being
 * DEACTIVATED, so they are in no review queue to reset. Reactivating one is a
 * deliberate act that goes through the role route and its own bookkeeping.
 *
 * REPORTED, NEVER THROWN — D139's shape, on D111's precedent. A recorded
 * termination must not be undone by a failure in the cleanup after it, and a
 * partial result is returned per account with its reason rather than collapsed
 * into one boolean.
 */
export async function deprovisionLicenceAdmins(
  env: Env,
  licenceId: number,
  actor: { id: number; name?: string | null; email: string },
  note: string,
): Promise<{
  ok: boolean;
  demoted: number;
  detached: number;
  deactivated: number;
  skipped: { user_id: number; reason: string }[];
  reason?: string;
}> {
  const out = { ok: true, demoted: 0, detached: 0, deactivated: 0, skipped: [] as { user_id: number; reason: string }[] };
  let admins: { user_id: number; email: string; name: string | null; role: string }[] = [];
  try {
    const res = await env.DB.prepare(
      `SELECT la.user_id, u.email, u.name, u.role
         FROM licence_admins la JOIN users u ON u.id = la.user_id
        WHERE la.licence_id = ?`,
    ).bind(licenceId).all<{ user_id: number; email: string; name: string | null; role: string }>();
    admins = res.results ?? [];
  } catch (e) {
    return {
      ...out,
      ok: false,
      reason: 'The licence\'s administrators could not be read, so none were deprovisioned and any '
        + 'of them may still hold the admin role. The termination itself is recorded: ' + (e as Error).message,
    };
  }
  if (!admins.length) return out;

  // The elevation holders, read once. Same lookup `routes/licence.ts` uses.
  let holders: Set<number>;
  try {
    const res = await env.DB.prepare('SELECT user_id FROM super_admins').all<{ user_id: number }>();
    holders = new Set((res.results || []).map((h) => Number(h.user_id)));
  } catch (e) {
    // UNREADABLE MEANS SKIP EVERYTHING, not demote everything. Failing closed
    // here costs a manual cleanup; failing open could strip the elevation's
    // holder of the role it sits on.
    return {
      ...out,
      ok: false,
      reason: 'The Super Admin holders could not be read, so no administrator was demoted — '
        + 'demoting the holder would leave the elevation pointing at a non-admin. '
        + 'The termination itself is recorded: ' + (e as Error).message,
    };
  }

  for (const a of admins) {
    if (holders.has(Number(a.user_id))) {
      out.skipped.push({
        user_id: a.user_id,
        reason: 'Holds the Super Admin elevation, which sits on the admin role — revoke or transfer it first.',
      });
      continue;
    }
    try {
      await env.DB.batch([
        env.DB.prepare("UPDATE users SET role = 'exploring', is_active = 0 WHERE id = ?").bind(a.user_id),
        env.DB.prepare('DELETE FROM licence_admins WHERE licence_id = ? AND user_id = ?').bind(licenceId, a.user_id),
      ]);
      out.demoted += 1;
      out.detached += 1;
      out.deactivated += 1;
    } catch (e) {
      out.ok = false;
      out.skipped.push({ user_id: a.user_id, reason: `Could not be deprovisioned: ${(e as Error).message}` });
      continue;
    }
    // Best-effort from here: the role is already revoked, and neither of these
    // failing leaves the account holding a power it should not have.
    try {
      const { seedObligations } = await import('../services/trust');
      await seedObligations(env, a.user_id, 'exploring', { pruneStaleForRole: true });
    } catch (e) { console.error('[licence/terminate] trust re-seed failed', (e as Error).message); }
    try {
      const actorHash = await hashEmail(actor.email);
      const targetHash = await hashEmail(a.email);
      await env.DB.batch([
        // `role_changed` / `your_role_changed`, not a new action name: both are
        // already in admin_security.ts's audit allowlist and ActivityPage's
        // label map, and a distinct action would be invisible in every reader.
        env.DB.prepare('INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?,?,?,?)')
          .bind('role_changed',
            `Super admin ${actor.name || actor.email} demoted ${a.name || a.email} from ${a.role} to exploring `
            + `and deactivated the account: the licence they administered was terminated. Reason: ${note}`,
            actorHash, actor.id),
        env.DB.prepare('INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?,?,?,?)')
          .bind('your_role_changed',
            `Your administrator role was removed and your account deactivated because the licence you `
            + `administered was terminated. Reason: ${note}`,
            targetHash, a.user_id),
      ]);
    } catch (e) { console.error('[licence/terminate] activity log failed', (e as Error).message); }
  }
  return out;
}

/**
 * D262 — take the admin role off every administrator on the terminated
 * licence's BRANCH, whose accounts live in the branch's database.
 *
 * `deprovisionLicenceAdmins` above reads HQ's `licence_admins JOIN users`, so
 * it only ever reached accounts in HQ's own database. Termination pushes
 * `terminated`, which the branch stores, and the freeze reacts only to
 * `suspended` (D107), so a terminated branch's principal kept the admin role
 * and every gated write. This asks the branch, with no target, to unbind every
 * active administrator it holds (`unbindAdmin`).
 *
 * REPORTED, NEVER THROWN, D145's rule: a recorded termination must never be
 * undone by the cleanup after it. Every failure — no deployment, no secret,
 * no binding, a branch that refuses or does not answer — is a field with a
 * reason the operator can act on.
 */
export async function unbindBranchAdmins(
  env: Env,
  code: string | null | undefined,
  actorName: string,
  note: string,
): Promise<{ ok: boolean; code: string | null; unbound?: number; skipped?: { id: number; reason: string }[]; reason?: string }> {
  if (!code) {
    return { ok: false, code: null, reason: 'This licence has no branch deployment, so there is no branch administrator to unbind.' };
  }
  if (!env.HQ_RPC_SECRET) {
    return {
      ok: false, code,
      reason: 'HQ_RPC_SECRET is not set on this Worker, so the branch cannot tell this call from any '
        + `other; ${code}'s administrators still hold the role. Set it and unbind them from HQ · Team.`,
    };
  }
  const binding = branchByCode(env, code);
  if (!binding) {
    mirrorBranchAction(env, 'admin_unbound', 'not_deployed', code);
    return { ok: false, code, reason: `No branch Worker is bound for ${code}, so its administrators could not be reached.` };
  }
  try {
    const res = await (binding.stub as any).unbindAdmin(env.HQ_RPC_SECRET, {
      hq_actor_name: actorName,
      reason: `Licence terminated: ${note}`,
    });
    mirrorBranchAction(env, 'admin_unbound', 'ok', code);
    return {
      ok: true, code,
      unbound: Array.isArray(res?.unbound) ? res.unbound.length : 0,
      skipped: Array.isArray(res?.skipped) ? res.skipped : [],
    };
  } catch (e) {
    mirrorBranchAction(env, 'admin_unbound', 'failed', code);
    return {
      ok: false, code,
      reason: `The termination is recorded, and ${code} did not unbind its administrators: `
        + `${String((e as Error).message || e).replace(/^rpc: /, '').slice(0, 300)}. `
        + 'Unbind them from HQ · Team.',
    };
  }
}

r.post('/:uid/terminate', async (c) => {
  try {
    // D262 — THE WRITE BAR, where every other lifecycle move keeps the plain
    // elevation. Terminate is the one that takes the admin role off accounts:
    // HQ's since D145, and the branch's own since D262. Every other act that
    // removes an admin role (demote-admin, DELETE /:uid/admins, the branch
    // unbind) already asks for TOTP and a fresh step-up.
    const admin = await requireSuperAdminWriteBar(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    // D139 — the state machine, on `reinstate`'s own 409 shape.
    const refusal = transitionRefusal(licence.status, 'terminate');
    if (refusal) return c.json({ error: 'bad_transition', message: refusal }, 409);
    const note = str((await c.req.json().catch(() => ({} as any)))?.note, 1000);
    if (!note) return c.json({ error: 'a termination must record why' }, 400);
    const released = await c.env.DB.prepare(
      'SELECT country_code FROM licence_territories WHERE licence_id = ? ORDER BY country_code',
    ).bind(licence.id).all<{ country_code: string }>();
    const codes = (released.results || []).map((x) => x.country_code);
    // Termination is the ONLY thing that releases territory.
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM licence_territories WHERE licence_id = ?').bind(licence.id),
      c.env.DB.prepare(
        "UPDATE territory_licences SET status = 'terminated', status_note = ?, terminated_at = ?, updated_at = ? WHERE id = ?",
      ).bind(note, nowIso(), nowIso(), licence.id),
    ]);
    await logEvent(c.env, licence.id, 'terminated', admin.id, { released: codes }, note,
      { before: { status: licence.status, countries: codes }, after: { status: 'terminated', countries: [] } });

    // D139 — THE LADDER WOULD OTHERWISE GO ON FREEZING PEOPLE OVER A LICENCE
    // THAT NO LONGER EXISTS. `auth.ts`'s compliance gate reads `admin_notices`
    // by `user_id` and never consults the licence's status, so an `overdue` or
    // `rejected` notice keeps an administrator's account frozen after HQ has
    // terminated the very licence the notice is about — and answering it cannot
    // help, because there is nothing left to comply with. Migration 264 already
    // has the word for a notice HQ is no longer pressing: `withdrawn`.
    //
    // OUTSIDE THE BATCH, ON PURPOSE. A database that has not applied 264 has no
    // `admin_notices` table and no notices to withdraw; putting this in the
    // batch would make its absence fail the termination itself. So it is
    // reported the way `pushed` is (the D111 precedent): the termination is
    // recorded whatever happens here, and what happened here is its own field.
    //
    // `accepted` and `withdrawn` are left alone — they are already closed, and
    // rewriting a closed row would lose which way it closed.
    let noticesWithdrawn: { ok: boolean; count?: number; reason?: string };
    try {
      const res = await c.env.DB.prepare(
        `UPDATE admin_notices
            SET status = 'withdrawn', updated_at = ?
          WHERE licence_id = ? AND status IN ('issued', 'overdue', 'responded', 'rejected')`,
      ).bind(nowIso(), licence.id).run();
      noticesWithdrawn = { ok: true, count: Number(res?.meta?.changes) || 0 };
    } catch (e) {
      noticesWithdrawn = {
        ok: false,
        reason: 'The compliance notices against this licence could not be withdrawn, so an '
          + 'administrator frozen by one may still be frozen. The termination itself is recorded: '
          + (e as Error).message,
      };
    }

    // Told LAST, after the batch, because a notification about a termination
    // that then failed to apply is worse than a late one. The administrators
    // are still bound at this point — D134's detach is a separate act — so the
    // lookup still finds them.
    await notifyLicenceAdmins(c.env, licence.id, {
      type: 'licence_terminated',
      title: 'Your licence has been terminated',
      body: `${note} ${codes.length ? `The ${codes.length === 1 ? 'territory' : `${codes.length} territories`} it held ${codes.length === 1 ? 'has' : 'have'} been released.` : ''}`.trim(),
      payload: { licence_uid: licence.uid, released: codes },
    });
    // D145 — AFTER the notification, and that ordering is load-bearing. The
    // comment above says the administrators are still bound at that point so
    // the lookup finds them; deprovisioning first would send the "your licence
    // has been terminated" mail to nobody. Reported as its own field, never
    // thrown, exactly as `notices_withdrawn` above.
    const adminsDeprovisioned = await deprovisionLicenceAdmins(
      c.env, licence.id, { id: admin.id, name: (admin as any).name, email: admin.email }, note,
    );
    // Pushed AFTER the territory release, so the copy the branch receives
    // reports the same empty territory the ledger now holds.
    const pushed = await pushLicenceToBranch(c.env, licence.id);
    // D262 — AFTER the push, so the branch already holds `terminated` when its
    // administrators lose the role. Its own field, never thrown.
    const branchAdminsUnbound = await unbindBranchAdmins(
      c.env, pushed?.code ?? null,
      String((admin as { name?: string }).name || '').trim().slice(0, 200) || 'Axal VC HQ', note,
    );
    return c.json({
      ok: true, status: 'terminated', released: codes, pushed,
      notices_withdrawn: noticesWithdrawn,
      admins_deprovisioned: adminsDeprovisioned,
      branch_admins_unbound: branchAdminsUnbound,
    });
  } catch (e) { return mapError(c, e); }
});

export default r;
