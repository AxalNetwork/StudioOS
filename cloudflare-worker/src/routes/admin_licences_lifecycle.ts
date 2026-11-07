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
import { pushLicenceToBranch, deploymentCodeFor } from '../services/licencePush';
import { branchByCode } from '../services/branches';
import { mirrorBranchAction } from '../services/auditMirror';
import { str, byUid, logEvent, pushOutcome, transitionRefusal, activationBlockers } from '../services/licenceLedgerCore';
import type { LicenceRow } from '../services/licenceLedgerCore';
import type { TerminationOps } from '../services/licenceSyncView';
import type { LicenceRenewResult, LicenceSuspendResult, LicenceTransitionResult, LicenceTerminateResult, TerminationRun, TerminationStep } from '../services/licenceContracts';

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
    // #4686 — THE ROLE CHANGE, THE DETACH AND THE TWO ACTIVITY ROWS ARE ONE
    // BATCH. The audit rows used to be written after it in a try/catch that only
    // logged, so a failure between the two left a deactivated administrator with
    // no record of who removed them, and the binding the retry would have found
    // them through was already gone. The hashes are computed first so the batch
    // itself can only fail as a whole.
    let actorHash: string;
    let targetHash: string;
    try {
      actorHash = await hashEmail(actor.email);
      targetHash = await hashEmail(a.email);
    } catch (e) {
      out.ok = false;
      out.skipped.push({ user_id: a.user_id, reason: `Could not be deprovisioned: ${(e as Error).message}` });
      continue;
    }
    try {
      await env.DB.batch([
        env.DB.prepare("UPDATE users SET role = 'exploring', is_active = 0 WHERE id = ?").bind(a.user_id),
        env.DB.prepare('DELETE FROM licence_admins WHERE licence_id = ? AND user_id = ?').bind(licenceId, a.user_id),
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
      out.demoted += 1;
      out.detached += 1;
      out.deactivated += 1;
    } catch (e) {
      out.ok = false;
      out.skipped.push({ user_id: a.user_id, reason: `Could not be deprovisioned: ${(e as Error).message}` });
      continue;
    }
    // Best-effort from here: the role is already revoked, and this failing
    // leaves the account holding no power it should not have. It is idempotent
    // (`pruneStaleForRole`), so a resumed termination does not repeat it only
    // because the binding it was found through is gone — recorded in D4686.
    try {
      const { seedObligations } = await import('../services/trust');
      await seedObligations(env, a.user_id, 'exploring', { pruneStaleForRole: true });
    } catch (e) { console.error('[licence/terminate] trust re-seed failed', (e as Error).message); }
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

/**
 * #4686 — THE DURABLE INTENT OF ONE TERMINATION.
 *
 * Terminate used to commit the status and then run five consequences (withdraw
 * the notices, tell the administrators, deprovision them at HQ, push the branch
 * its copy, unbind the branch's administrators) in the request, with nothing
 * recording that they were owed. A failure between the commit and the last of
 * them left a terminated licence whose administrators were still bound, and a
 * repeat request was refused because the licence was already terminated.
 *
 * Now the status, the territory release, the single `terminated` event, a
 * revision bump, a pending-push row and `licence_termination_ops` (one row per
 * licence, one state per consequence) commit in ONE batch. The consequences then
 * run one at a time, each persisting its own state; a failure is a recorded
 * state, never a lost one. A repeat request on a terminated licence RESUMES
 * whatever is not `done`, under a lease so two requests do not interleave, and
 * writes no second event — the event insert is guarded on the licence not yet
 * being terminated, so even two requests racing the first commit write one.
 *
 * Every consequence is idempotent: the notice update touches only open notices,
 * the notification runs once (its state is recorded), HQ deprovisioning reads
 * the bindings still left, the push carries a fresh revision, and the branch
 * unbind (no target) finds only administrators that are still active.
 */
type StepState = 'pending' | 'done' | 'failed';
/** A claim on the operation lasts this long; a crashed run frees it by expiry. */
const TERMINATION_LEASE_MS = 5 * 60_000;

const isMissingTable = (e: unknown) => /no such table|no such column/i.test(String((e as Error)?.message ?? e));

async function persistTermination(
  env: Env, licenceId: number, st: Record<string, StepState>,
  failure: { step: string; code: string } | null,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE licence_termination_ops
        SET notices_state = ?, notify_state = ?, admins_state = ?, push_state = ?, unbind_state = ?,
            failure_step = ?, failure_code = ?, updated_at = ?
      WHERE licence_id = ?`,
  ).bind(st.notices, st.notify, st.admins, st.push, st.unbind,
    failure?.step ?? null, failure?.code ?? null, nowIso(), licenceId).run();
}

async function finishTermination(env: Env, licenceId: number, complete: boolean): Promise<void> {
  const at = nowIso();
  await env.DB.prepare(
    `UPDATE licence_termination_ops
        SET status = ?, completed_at = ?, lease_until = NULL, updated_at = ?
      WHERE licence_id = ?`,
  ).bind(complete ? 'complete' : 'incomplete', complete ? at : null, at, licenceId).run();
}

export async function runTerminationConsequences(
  env: Env,
  licence: LicenceRow,
  ops: TerminationOps,
  actor: { id: number; name?: string | null; email: string },
): Promise<TerminationRun> {
  const st: Record<string, StepState> = {
    notices: ops.notices_state, notify: ops.notify_state, admins: ops.admins_state,
    push: ops.push_state, unbind: ops.unbind_state,
  };
  const note = ops.note;
  let released: string[] = [];
  try { released = JSON.parse(ops.released_json || '[]'); } catch { released = []; }
  const done = { ok: true, already_done: true };
  let failure: { step: string; code: string } | null = null;
  const fail = (step: string, code: string) => { if (!failure) failure = { step, code }; };
  const notYet = { ok: false, not_attempted: true, reason: 'Not attempted yet; resume the termination.' };
  const out: Omit<TerminationRun, 'operation'> = {
    notices_withdrawn: st.notices === 'done' ? done : notYet,
    admins_deprovisioned: st.admins === 'done' ? done : notYet,
    pushed: st.push === 'done' ? done : notYet,
    branch_admins_unbound: st.unbind === 'done' ? done : notYet,
  };
  let pushedCode: string | null | undefined;

  try {
    // D139 — THE LADDER WOULD OTHERWISE GO ON FREEZING PEOPLE OVER A LICENCE
    // THAT NO LONGER EXISTS. `auth.ts`'s compliance gate reads `admin_notices`
    // by `user_id` and never consults the licence's status, so an `overdue` or
    // `rejected` notice keeps an administrator's account frozen after HQ has
    // terminated the very licence the notice is about — and answering it cannot
    // help, because there is nothing left to comply with. Migration 264 already
    // has the word for a notice HQ is no longer pressing: `withdrawn`.
    //
    // A DATABASE THAT HAS NOT APPLIED 264 has no `admin_notices` table and no
    // notices to withdraw, so that is "done" with a stated reason; any other
    // failure is a recorded, resumable one. `accepted` and `withdrawn` are left
    // alone — already closed, and rewriting a closed row would lose which way
    // it closed.
    if (st.notices !== 'done') {
      try {
        const res = await env.DB.prepare(
          `UPDATE admin_notices
              SET status = 'withdrawn', updated_at = ?
            WHERE licence_id = ? AND status IN ('issued', 'overdue', 'responded', 'rejected')`,
        ).bind(nowIso(), licence.id).run();
        out.notices_withdrawn = { ok: true, count: Number(res?.meta?.changes) || 0 };
        st.notices = 'done';
      } catch (e) {
        out.notices_withdrawn = {
          ok: false,
          reason: 'The compliance notices against this licence could not be withdrawn, so an '
            + 'administrator frozen by one may still be frozen. The termination itself is recorded: '
            + (e as Error).message,
        };
        if (isMissingTable(e)) st.notices = 'done';
        else { st.notices = 'failed'; fail('notices', 'notices_unwithdrawn'); }
      }
      await persistTermination(env, licence.id, st, failure);
    }

    // Told BEFORE the administrators are detached, because the lookup finds them
    // through their binding; deprovisioning first would send the "your licence
    // has been terminated" mail to nobody. Recorded as done so a resume does not
    // send it twice.
    if (st.notify !== 'done') {
      try {
        await notifyLicenceAdmins(env, licence.id, {
          type: 'licence_terminated',
          title: 'Your licence has been terminated',
          body: `${note} ${released.length ? `The ${released.length === 1 ? 'territory' : `${released.length} territories`} it held ${released.length === 1 ? 'has' : 'have'} been released.` : ''}`.trim(),
          payload: { licence_uid: licence.uid, released },
        });
        st.notify = 'done';
      } catch (e) {
        console.error('[licence/terminate] notify failed', (e as Error).message);
        st.notify = 'failed'; fail('notify', 'notify_failed');
      }
      await persistTermination(env, licence.id, st, failure);
    }

    // D145 — only once the notification is out (see above). Reported as its own
    // field, never thrown. "Done" means every administrator that CAN be
    // deprovisioned was; a Super Admin holder is skipped with its reason and is a
    // manual act, so it does not hold the operation open for ever.
    if (st.admins !== 'done' && st.notify === 'done') {
      const res = await deprovisionLicenceAdmins(env, licence.id, actor, note);
      out.admins_deprovisioned = res;
      if (res.ok) st.admins = 'done'; else { st.admins = 'failed'; fail('admins', 'admins_not_deprovisioned'); }
      await persistTermination(env, licence.id, st, failure);
    }

    // Pushed AFTER the territory release, so the copy the branch receives
    // reports the same empty territory the ledger now holds. A push that did not
    // land has already left its own pending row (bound to its revision).
    if (st.push !== 'done') {
      const pushed = await pushLicenceToBranch(env, licence.id);
      out.pushed = pushed;
      pushedCode = pushed.code ?? null;
      if (pushed.ok || pushed.no_deployment) st.push = 'done';
      else { st.push = 'failed'; fail('push', pushed.failure_code ?? 'push_failed'); }
      await persistTermination(env, licence.id, st, failure);
    }

    // D262 — AFTER the push, so the branch already holds `terminated` when its
    // administrators lose the role. Its own field, never thrown. The branch's
    // own unbind has no target, so a repeat finds only administrators still
    // active and unbinding twice is a no-op.
    if (st.unbind !== 'done') {
      let code: string | null | undefined = pushedCode;
      let lookupFailed = false;
      if (code === undefined) {
        try { code = await deploymentCodeFor(env, licence.uid); } catch { lookupFailed = true; }
      }
      if (lookupFailed) {
        out.branch_admins_unbound = {
          ok: false, code: null,
          reason: 'HQ could not read which branch this licence deploys to, so its administrators were not unbound. Resume the termination to try again.',
        };
        st.unbind = 'failed'; fail('unbind', 'deployment_unreadable');
      } else if (!code) {
        // Cleanly no deployment: there is no branch administrator to unbind.
        out.branch_admins_unbound = await unbindBranchAdmins(env, null, '', note);
        st.unbind = 'done';
      } else {
        const res = await unbindBranchAdmins(
          env, code, String(actor.name || '').trim().slice(0, 200) || 'Axal VC HQ', note,
        );
        out.branch_admins_unbound = res;
        if (res.ok) st.unbind = 'done'; else { st.unbind = 'failed'; fail('unbind', 'unbind_failed'); }
      }
      await persistTermination(env, licence.id, st, failure);
    }
  } finally {
    // Whatever happened, the claim is released: an operation that ended early is
    // resumable at once, not after the lease expires.
    const complete = Object.values(st).every((v) => v === 'done');
    try { await finishTermination(env, licence.id, complete); }
    catch (e) { console.error('[licence/terminate] could not close the operation', (e as Error).message); }
  }
  const complete = Object.values(st).every((v) => v === 'done');
  return {
    ...out,
    operation: {
      status: complete ? 'complete' : 'incomplete',
      steps: st as Record<TerminationStep, StepState>,
      failure_step: complete ? null : (failure as { step: TerminationStep } | null)?.step ?? null,
      failure_code: complete ? null : (failure as { code: string } | null)?.code ?? null,
    },
  };
}

/** The follow-up broke off after the termination was recorded: say so, and how to finish it. */
function interruptedTermination(c: any, e: unknown) {
  console.error('[licence/terminate] follow-up interrupted', (e as Error)?.message);
  return c.json({
    error: 'termination_interrupted',
    message: 'The termination is recorded, but its follow-up was interrupted. Repeat the request to resume it.',
  }, 503);
}

async function resumeTermination(
  c: any, licence: LicenceRow, actor: { id: number; name?: string | null; email: string },
) {
  const env = c.env as Env;
  const refusal = transitionRefusal(licence.status, 'terminate') as string;
  let ops: TerminationOps | null = null;
  try {
    ops = await env.DB.prepare('SELECT * FROM licence_termination_ops WHERE licence_id = ?')
      .bind(licence.id).first<TerminationOps>();
  } catch (e) {
    console.warn('[licence/terminate] termination ledger unreadable', (e as Error).message);
  }
  // No ledger row: a licence terminated before this existed, or a database
  // without the migration. There is nothing recorded to resume, and the old
  // answer stands.
  if (!ops) return c.json({ error: 'bad_transition', message: refusal }, 409);
  if (ops.status === 'complete') {
    return c.json({
      error: 'bad_transition',
      message: `${refusal} Every consequence of the termination has already completed, so there is nothing to resume.`,
    }, 409);
  }
  const now = nowIso();
  const until = new Date(Date.now() + TERMINATION_LEASE_MS).toISOString();
  const claim = await env.DB.prepare(
    `UPDATE licence_termination_ops
        SET lease_until = ?, attempts = attempts + 1, updated_at = ?
      WHERE licence_id = ? AND status = 'incomplete' AND (lease_until IS NULL OR lease_until < ?)`,
  ).bind(until, now, licence.id, now).run();
  if (Number(claim?.meta?.changes ?? 0) !== 1) {
    return c.json({
      error: 'operation_in_progress',
      message: 'This termination is being completed by another request. Wait a moment and read the licence again.',
    }, 409);
  }
  const fresh = await env.DB.prepare('SELECT * FROM licence_termination_ops WHERE licence_id = ?')
    .bind(licence.id).first<TerminationOps>();
  if (!fresh) return c.json({ error: 'bad_transition', message: refusal }, 409);
  let result: TerminationRun;
  try { result = await runTerminationConsequences(env, licence, fresh, actor); }
  catch (e) { return interruptedTermination(c, e); }
  let released: string[] = [];
  try { released = JSON.parse(fresh.released_json || '[]'); } catch { released = []; }
  return c.json({ ok: true, status: 'terminated', resumed: true, released, ...result, pushed: result.pushed } satisfies LicenceTerminateResult);
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
    const actor = { id: admin.id, name: (admin as any).name, email: admin.email };
    // #4686 — a repeat request on a terminated licence resumes what is left.
    if (licence.status === 'terminated') return await resumeTermination(c, licence, actor);
    // D139 — the state machine, on `reinstate`'s own 409 shape.
    const refusal = transitionRefusal(licence.status, 'terminate');
    if (refusal) return c.json({ error: 'bad_transition', message: refusal }, 409);
    const note = str((await c.req.json().catch(() => ({} as any)))?.note, 1000);
    if (!note) return c.json({ error: 'a termination must record why' }, 400);
    const released = await c.env.DB.prepare(
      'SELECT country_code FROM licence_territories WHERE licence_id = ? ORDER BY country_code',
    ).bind(licence.id).all<{ country_code: string }>();
    const codes = (released.results || []).map((x) => x.country_code);
    const at = nowIso();
    const lease = new Date(Date.now() + TERMINATION_LEASE_MS).toISOString();
    // ONE BATCH: the transition, its audit event and the durable intent. Every
    // write that must happen exactly once is guarded on the licence not yet being
    // terminated (or on no ledger row existing yet), so a second request racing
    // this one cannot write a second event or a second revision.
    // Termination is the ONLY thing that releases territory.
    let results: any[];
    try {
    results = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO licence_events (licence_id, event, detail_json, note, actor_user_id, created_at,
                                     before_json, after_json, outcome)
         SELECT ?, 'terminated', ?, ?, ?, ?, ?, ?, 'committed'
          WHERE EXISTS (SELECT 1 FROM territory_licences WHERE id = ? AND status <> 'terminated')`,
      ).bind(licence.id, JSON.stringify({ released: codes }), note, admin.id, at,
        JSON.stringify({ status: licence.status, countries: codes }),
        JSON.stringify({ status: 'terminated', countries: [] }), licence.id),
      c.env.DB.prepare(
        `DELETE FROM licence_territories WHERE licence_id = ?
            AND EXISTS (SELECT 1 FROM territory_licences WHERE id = ? AND status <> 'terminated')`,
      ).bind(licence.id, licence.id),
      c.env.DB.prepare(
        "UPDATE territory_licences SET status = 'terminated', status_note = ?, terminated_at = ?, updated_at = ? WHERE id = ? AND status <> 'terminated'",
      ).bind(note, at, at, licence.id),
      c.env.DB.prepare(
        `INSERT INTO licence_sync_state (licence_id, hq_revision)
         SELECT ?, 1 WHERE NOT EXISTS (SELECT 1 FROM licence_termination_ops WHERE licence_id = ?)
         ON CONFLICT(licence_id) DO UPDATE SET hq_revision = licence_sync_state.hq_revision + 1,
                                               updated_at = datetime('now')`,
      ).bind(licence.id, licence.id),
      c.env.DB.prepare(
        `INSERT INTO licence_push_pending
           (licence_id, code, reason, attempts, first_failed_at, last_attempt_at, revision, failure_code)
         SELECT ?, COALESCE((SELECT code FROM licence_deployments WHERE licence_uid = ?), ''), NULL, 0, ?, ?,
                COALESCE((SELECT hq_revision FROM licence_sync_state WHERE licence_id = ?), 0), 'termination'
          WHERE NOT EXISTS (SELECT 1 FROM licence_termination_ops WHERE licence_id = ?)
         ON CONFLICT(licence_id) DO UPDATE SET
           revision = MAX(licence_push_pending.revision, excluded.revision),
           failure_code = 'termination', last_attempt_at = excluded.last_attempt_at`,
      ).bind(licence.id, licence.uid, at, at, licence.id, licence.id),
      c.env.DB.prepare(
        `INSERT INTO licence_termination_ops
           (licence_id, status, actor_user_id, note, released_json, revision, lease_until, created_at, updated_at)
         VALUES (?, 'incomplete', ?, ?, ?, (SELECT hq_revision FROM licence_sync_state WHERE licence_id = ?), ?, ?, ?)
         ON CONFLICT(licence_id) DO NOTHING`,
      ).bind(licence.id, admin.id, note, JSON.stringify(codes), licence.id, lease, at, at),
    ]);
    } catch (e) {
      // All or nothing: the batch rolled back, so the licence is exactly as it
      // was. The cause is logged, never returned.
      console.error('[licence/terminate] the transition did not commit', (e as Error).message);
      return c.json({
        error: 'termination_not_recorded',
        message: 'The termination could not be recorded, so nothing was changed. Try again.',
      }, 503);
    }
    // Exactly one request changes the status. A loser found the licence already
    // terminated by the time its batch ran: it wrote nothing, and resumes.
    if (Number(results?.[2]?.meta?.changes ?? 0) !== 1) {
      const now = await byUid(c.env, licence.uid);
      return await resumeTermination(c, (now ?? licence) as LicenceRow, actor);
    }

    const ops: TerminationOps = {
      licence_id: licence.id, status: 'incomplete', actor_user_id: admin.id, note,
      released_json: JSON.stringify(codes), revision: null,
      notices_state: 'pending', notify_state: 'pending', admins_state: 'pending',
      push_state: 'pending', unbind_state: 'pending', failure_step: null, failure_code: null,
      attempts: 1, lease_until: lease, created_at: at, updated_at: at, completed_at: null,
    };
    let result: TerminationRun;
    try { result = await runTerminationConsequences(c.env, licence, ops, actor); }
    catch (e) { return interruptedTermination(c, e); }
    return c.json({ ok: true, status: 'terminated', released: codes, ...result, pushed: result.pushed } satisfies LicenceTerminateResult);
  } catch (e) { return mapError(c, e); }
});

export default r;
