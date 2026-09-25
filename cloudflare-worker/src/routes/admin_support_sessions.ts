/**
 * HQ opens a support session on a branch (H4's "Start a support session", D120).
 *
 *   POST /api/admin/branches/:code/support-session   { target_user_id, reason }
 *   POST /api/admin/branches/:code/accounts/:userId/move   { destination_code, reason }
 *   POST /api/admin/branches/:code/admins/:userId/unbind   { reason }   (D262)
 *
 * THIS ROUTE IS WHERE THE THREE UNCROSSABLE CHECKS HAPPEN, and that is the
 * whole architecture of the feature in one sentence. `requireFactor(c,'totp')`,
 * `requireStepUp(c)` and the admin gate are facts about an HQ operator's
 * browser session. A branch Worker cannot see a session on another host — HQ's
 * JWT is signed with a different secret and does not decode there (D.4) — so
 * the branch cannot re-check any of them, and nothing in `branchOps.ts`
 * pretends to. They are enforced HERE, before the binding is touched, and the
 * branch's trust in that is bought by `HQ_RPC_SECRET` and nothing else.
 *
 * Saying that plainly matters more than it looks: a reader who assumed the
 * branch re-verified the operator's TOTP would think this route's gates were
 * belt-and-braces and could be relaxed. They are the only copy.
 *
 * THE ORDER IS `admin.ts:1440`'s ORDER, DELIBERATELY. TOTP specifically (not
 * SMS, not a recovery code), then a RECENT TOTP, then the role — the same
 * sequence the local support session has used since Task #6 and BLOCK-AUTH-03.
 * Two implementations of "may this person open a support session" that check
 * different things is how one of them quietly becomes the weaker door.
 *
 * WHY `requireSuperAdmin` WHERE `admin.ts` USES `requireAdmin`. The local flow
 * reaches accounts in HQ's own database, which every admin already administers.
 * This one reaches into a subsidiary's database across a tenancy boundary —
 * that is the franchisor acting as the franchisor, and it is the gate every
 * other HQ→branch write in this programme uses (`admin_escalations.ts`,
 * `admin_statements.ts`, `admin_deployments.ts`). A wider door here would be a
 * wider door into someone else's tenant.
 *
 * THE REASON IS CHECKED TWICE, ON PURPOSE. Here, so the operator gets a usable
 * 400 instead of an RPC exception; and again on the branch, because the branch
 * is where the row is written and a caller-side-only rule is a convention
 * rather than a control. `admin.ts` makes the same argument for enforcing it
 * server-side rather than in the dialog.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireFactor, requireStepUp, requireSuperAdmin } from '../auth';
import { hashEmail } from '../util/hashEmail';
import { mapError } from './_t13t14t15_helpers';
import { branchByCode } from '../services/branches';
import { mirrorBranchAction } from '../services/auditMirror';
import { BRANCH_CODE_RE } from '../util/branch';
import { SUPPORT_REASON_MIN, MOVE_REASON_MIN, UNBIND_REASON_MIN } from '../rpc/branchOps';
import { logAdminAction } from '../services/adminAudit';

const r = new Hono<{ Bindings: Env }>();

const str = (v: unknown, max = 500): string => String(v ?? '').trim().slice(0, max);

r.post('/branches/:code/support-session', async (c) => {
  try {
    // The three the branch cannot make. See the header.
    await requireFactor(c, 'totp');
    await requireStepUp(c);
    const admin = await requireSuperAdmin(c);

    const code = str(c.req.param('code'), 32).toLowerCase();
    if (!BRANCH_CODE_RE.test(code)) {
      return c.json({ error: 'bad_code', message: 'That is not a valid branch code.' }, 400);
    }

    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const reason = str(body?.reason, 200);
    if (reason.length < SUPPORT_REASON_MIN) {
      return c.json({
        error: 'support_reason_required',
        message: `A reason of at least ${SUPPORT_REASON_MIN} characters is required to open a support session.`,
      }, 400);
    }
    const targetUserId = Number(body?.target_user_id);
    if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
      return c.json({ error: 'bad_target', message: 'Name the account on that branch to support.' }, 400);
    }

    // THE SECRET IS REQUIRED BEFORE THE BINDING IS TOUCHED, and its absence is
    // its own answer rather than a generic failure. An HQ that has never been
    // given `HQ_RPC_SECRET` cannot open a session anywhere, and an operator
    // should read that as a credential to set (D.11) rather than as a branch
    // that is down.
    if (!c.env.HQ_RPC_SECRET) {
      return c.json({
        error: 'hq_rpc_secret_unset',
        message: 'HQ_RPC_SECRET is not set on this Worker, so a branch has no way to tell this call '
          + 'from any other Worker in the account. Set it from the value branch-provision.yml '
          + 'generated, then try again.',
      }, 409);
    }

    const binding = branchByCode(c.env, code);
    if (!binding) {
      mirrorBranchAction(c.env, 'support_session_opened', 'not_deployed', code);
      return c.json({
        error: 'branch_not_bound',
        message: `No branch Worker is bound for ${code}, so there is nothing to open a session on. `
          + 'A branch gets its binding when HQ redeploys after provisioning.',
      }, 409);
    }

    let offer;
    try {
      offer = await (binding.stub as any).openSupportSession(c.env.HQ_RPC_SECRET, {
        hq_actor_name: str((admin as { name?: string }).name, 200) || 'Axal VC HQ',
        // OPAQUE TEXT, and never joined on the branch. It exists so HQ's own
        // audit row and the branch's can be lined up afterwards; the branch
        // stores it and reads it back to nobody. `admin_escalations.ts:77-80`
        // states the rule this follows.
        hq_actor_ref: String(admin.id),
        target_user_id: targetUserId,
        reason,
      });
    } catch (e) {
      // The branch's refusals are the operator's business — a reason under ten
      // characters, an account that is not there, a `super_admins` row that
      // should not exist. Passing the message through beats a 500 that says
      // nothing, and these are all HQ-authored inputs rather than user content.
      mirrorBranchAction(c.env, 'support_session_opened', 'failed', code);
      return c.json({
        error: 'branch_refused',
        message: String((e as Error).message || e).replace(/^rpc: /, '').slice(0, 400),
      }, 409);
    }
    mirrorBranchAction(c.env, 'support_session_opened', 'ok', code);

    // HQ'S OWN ROW, WRITTEN HERE. The branch writes its own at authorisation
    // and again at redeem; neither database can read the other, so "audited on
    // both sides" means exactly this — two rows, each true where it lives.
    //
    // D259 — THROUGH `logAdminAction`, so the act reaches `admin_audit_log`
    // and Security's feed, which it never did (`hq_branch_support_session`
    // was on neither of the feed's arms). The account is named as
    // `branch_user_id` and NEVER as `target_user_id`: `targetUserIdOf` would
    // store this id as HQ's `viewed_user_id`, and an id from a branch database
    // joined against HQ's `users` names whoever happens to hold that id HERE —
    // a different person. The subject of this row lives on `branch`; HQ's
    // Target column stays blank rather than wrong. `logAdminAction` never
    // throws, which is the D111 rule the old try/catch kept.
    await logAdminAction(c.env, admin.id, admin.email, 'hq_branch_support_session', {
      branch: code,
      branch_user_id: targetUserId,
      target_email_present: Boolean(offer?.target?.email),
      reason,
      expires_at: offer?.expires_at ?? null,
    });

    return c.json({
      branch: code,
      target: offer?.target ?? null,
      expires_at: offer?.expires_at ?? null,
      // THE LINK IS BUILT HERE because HQ is the side that has to open it and
      // the side that knows the hostname convention. The code rides in the URL
      // and the TOKEN NEVER DOES: the branch's /api/auth/support/redeem swaps
      // one for the other, and the code is single-use and five minutes old at
      // most, so a URL that leaks into history or a Referer is worth nothing
      // by the time anyone reads it.
      open_url: `https://${code}.axal.vc${offer?.redeem_path ?? ''}`,
    });
  } catch (e) { return mapError(c, e); }
});

/**
 * POST /api/admin/branches/:code/accounts/:userId/move   { destination_code, reason }
 *
 * D.6 — moving an account to another branch (D121). The same gate stack as the
 * support session above, for the same reason: this reaches across a tenancy
 * boundary into two databases HQ's own console cannot read.
 *
 * THE TWO LEGS ARE REPORTED SEPARATELY AND THAT IS THE WHOLE SHAPE OF THIS
 * HANDLER. Closing the account on the source and inviting it on the destination
 * are two writes to two databases with no transaction between them — there
 * cannot be one, because they are different Workers (D.2). So:
 *
 *   - the source deactivation is performed first and reported as its own fact;
 *   - the destination invitation rides beside it in `invited`, never folded
 *     into the response's success.
 *
 * Collapsing them would make an unreachable destination look like a move that
 * never happened, and an operator would run it again — against an account that
 * is already closed, which `moveAccountOut` then correctly refuses, leaving
 * them with two refusals and no way to finish. This is D111's rule for the
 * promo ceiling and D112's for the escalation answer, and it is the third time
 * the same shape has been the right one.
 *
 * THE ORDER IS DELIBERATE, and the other order is worse. Inviting first would
 * leave an invitation on the destination for an account still live on the
 * source if the deactivation then failed — two active homes for one person,
 * which is exactly the state the tenancy model has no way to represent.
 * Closing first can leave someone with no home until the invitation lands, and
 * that state is visible, recoverable and honest: HQ sees `invited.ok = false`
 * with the reason, and the retry is `inviteAccount` alone.
 */
r.post('/branches/:code/accounts/:userId/move', async (c) => {
  try {
    await requireFactor(c, 'totp');
    await requireStepUp(c);
    const admin = await requireSuperAdmin(c);

    const from = str(c.req.param('code'), 32).toLowerCase();
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const to = str(body?.destination_code, 32).toLowerCase();
    if (!BRANCH_CODE_RE.test(from) || !BRANCH_CODE_RE.test(to)) {
      return c.json({ error: 'bad_code', message: 'Both branch codes must be valid.' }, 400);
    }
    if (from === to) {
      return c.json({
        error: 'same_branch',
        message: 'That account already lives on that branch, so there is nothing to move.',
      }, 400);
    }

    const reason = str(body?.reason, 300);
    if (reason.length < MOVE_REASON_MIN) {
      return c.json({
        error: 'move_reason_required',
        message: `A reason of at least ${MOVE_REASON_MIN} characters is required to move an account. `
          + 'Moving an account moves which subsidiary earns revenue share on it.',
      }, 400);
    }

    const userId = Number(c.req.param('userId'));
    if (!Number.isInteger(userId) || userId <= 0) {
      return c.json({ error: 'bad_target', message: 'Name the account to move.' }, 400);
    }

    if (!c.env.HQ_RPC_SECRET) {
      return c.json({
        error: 'hq_rpc_secret_unset',
        message: 'HQ_RPC_SECRET is not set on this Worker, so neither branch can tell this call '
          + 'from any other Worker in the account. Set it, then try again.',
      }, 409);
    }

    // TWO CODES, RESOLVED THROUGH THE ONE RESOLVER TWICE. A move is the one
    // site that needs a pair, and composing `branchByCode` is what keeps the
    // matching rule identical at both ends: a source resolved one way and a
    // destination another is how a move half-completes.
    const source = branchByCode(c.env, from);
    const destination = branchByCode(c.env, to);
    // BOTH BINDINGS ARE CHECKED BEFORE EITHER IS CALLED. Closing an account on
    // the source when the destination is not even bound would be a move that
    // could not possibly complete — a refusal is better than half of it.
    if (!source || !destination) {
      const missing = [!source ? from : null, !destination ? to : null].filter(Boolean).join(' and ');
      // D163 — mirrored against WHICHEVER end is unbound, not against the move.
      // A move names two branches and only one of them may be the problem;
      // attributing it to both would invent an outage on a branch that is fine.
      if (!source) mirrorBranchAction(c.env, 'account_moved_out', 'not_deployed', from);
      if (!destination) mirrorBranchAction(c.env, 'account_invited', 'not_deployed', to);
      return c.json({
        error: 'branch_not_bound',
        message: `No branch Worker is bound for ${missing}, so this move cannot complete. `
          + 'A branch gets its binding when HQ redeploys after provisioning.',
      }, 409);
    }

    const actorName = str((admin as { name?: string }).name, 200) || 'Axal VC HQ';

    let movedOut;
    try {
      movedOut = await (source.stub as any).moveAccountOut(c.env.HQ_RPC_SECRET, {
        hq_actor_name: actorName,
        target_user_id: userId,
        reason,
        destination_code: to,
      });
    } catch (e) {
      // NOTHING HAS HAPPENED YET when this throws, so it is a clean refusal
      // rather than a partial move — the branch validates before it writes.
      mirrorBranchAction(c.env, 'account_moved_out', 'failed', from);
      return c.json({
        error: 'source_refused',
        message: String((e as Error).message || e).replace(/^rpc: /, '').slice(0, 400),
      }, 409);
    }
    mirrorBranchAction(c.env, 'account_moved_out', 'ok', from);

    // THE SECOND LEG, REPORTED AND NEVER THROWN. See the header.
    let invited: { ok: boolean; uid?: string; email_sent?: boolean; reason?: string };
    try {
      const inv = await (destination.stub as any).inviteAccount(c.env.HQ_RPC_SECRET, {
        hq_actor_name: actorName,
        email: movedOut?.target?.email ?? '',
        name: movedOut?.target?.name ?? null,
        role: movedOut?.target?.role ?? 'exploring',
        moved_from_code: from,
        reason,
      });
      invited = {
        ok: true,
        uid: inv?.uid,
        // NOT the same thing as `ok`. The invitation existing and the person
        // being told about it are two facts, and migration 236 already draws
        // that line: a branch with no mail sender records an invitation nobody
        // has heard of, and HQ has to see that to pass the link on by hand.
        email_sent: Boolean(inv?.email_sent),
        ...(inv?.email_reason ? { reason: inv.email_reason } : {}),
      };
      // The invitation LANDING is the branch answering; whether the mail left
      // is the branch's own business and migration 236's separate fact. The
      // mirror records the first, which is the one about reachability.
      mirrorBranchAction(c.env, 'account_invited', 'ok', to);
    } catch (e) {
      mirrorBranchAction(c.env, 'account_invited', 'failed', to);
      invited = {
        ok: false,
        reason: `The account was closed on ${from} and the invitation on ${to} did not land: `
          + `${String((e as Error).message || e).replace(/^rpc: /, '')}. `
          + `Retry the invitation alone — moving them out again would be refused, correctly.`,
      };
    }

    try {
      await c.env.DB.prepare(
        `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`,
      ).bind(
        'hq_account_moved',
        JSON.stringify({
          from, to, target_user_id: userId, reason,
          invited_ok: invited.ok, email_sent: invited.email_sent ?? false,
        }),
        await hashEmail(admin.email),
        admin.id,
      ).run();
    } catch (e) {
      console.warn('[admin:move] audit row failed', (e as Error).message);
    }

    return c.json({
      from,
      to,
      moved_out: true,
      target: movedOut?.target ?? null,
      invited,
      // STATED IN THE RESPONSE, not only in the docs: D.6 is a re-invite, not a
      // record migration, and an operator who assumed otherwise would tell the
      // person something false about where their work went.
      records_note: `Projects, deals and documents stay with ${from} and are readable by HQ. `
        + 'This is a re-invite, not a record migration.',
    });
  } catch (e) { return mapError(c, e); }
});

/**
 * POST /api/admin/branches/:code/admins/:userId/unbind   { reason }
 *
 * D262 — HQ takes the admin role off an account that lives on a branch
 * database. HQ's demote, toggle-active and licence termination only ever
 * reached HQ's own database, so a branch's administrator could not be reached
 * at all: `moveAccountOut` refuses one ("unbound at HQ, not moved out"), and
 * HQ had nothing to unbind with.
 *
 * THE SAME THREE GATES AS THE SUPPORT SESSION, in the same order, for the
 * same reason: TOTP, a recent step-up and the elevation are facts about this
 * operator's session that the branch cannot see, so they are checked here,
 * before the binding is touched. The branch checks the rest (`unbindAdmin`):
 * the secret, the reason, an active administrator, no `super_admins` row.
 *
 * NO NUMERIC `target_user_id` IN HQ'S AUDIT ROW, D259's rule: the id belongs
 * to the branch's database, and HQ's `viewed_user_id` would name whoever holds
 * that id at HQ. It travels as `branch_user_id`.
 */
r.post('/branches/:code/admins/:userId/unbind', async (c) => {
  try {
    await requireFactor(c, 'totp');
    await requireStepUp(c);
    const admin = await requireSuperAdmin(c);

    const code = str(c.req.param('code'), 32).toLowerCase();
    if (!BRANCH_CODE_RE.test(code)) {
      return c.json({ error: 'bad_code', message: 'That is not a valid branch code.' }, 400);
    }
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const reason = str(body?.reason, 300);
    if (reason.length < UNBIND_REASON_MIN) {
      return c.json({
        error: 'unbind_reason_required',
        message: `A reason of at least ${UNBIND_REASON_MIN} characters is required to unbind an administrator.`,
      }, 400);
    }
    const userId = Number(c.req.param('userId'));
    if (!Number.isInteger(userId) || userId <= 0) {
      return c.json({ error: 'bad_target', message: 'Name the administrator to unbind.' }, 400);
    }
    if (!c.env.HQ_RPC_SECRET) {
      return c.json({
        error: 'hq_rpc_secret_unset',
        message: 'HQ_RPC_SECRET is not set on this Worker, so a branch has no way to tell this call '
          + 'from any other Worker in the account. Set it, then try again.',
      }, 409);
    }
    const binding = branchByCode(c.env, code);
    if (!binding) {
      mirrorBranchAction(c.env, 'admin_unbound', 'not_deployed', code);
      return c.json({
        error: 'branch_not_bound',
        message: `No branch Worker is bound for ${code}, so there is no administrator to reach there.`,
      }, 409);
    }

    let res;
    try {
      res = await (binding.stub as any).unbindAdmin(c.env.HQ_RPC_SECRET, {
        hq_actor_name: str((admin as { name?: string }).name, 200) || 'Axal VC HQ',
        target_user_id: userId,
        reason,
      });
    } catch (e) {
      // Nothing happened on the branch: it validates before it writes. Its
      // refusal (not an admin, already inactive, a super_admins row) is the
      // operator's business, passed through as words.
      mirrorBranchAction(c.env, 'admin_unbound', 'failed', code);
      return c.json({
        error: 'branch_refused',
        message: String((e as Error).message || e).replace(/^rpc: /, '').slice(0, 400),
      }, 409);
    }
    mirrorBranchAction(c.env, 'admin_unbound', 'ok', code);

    await logAdminAction(c.env, admin.id, admin.email, 'hq_branch_admin_unbound', {
      branch: code,
      branch_user_id: userId,
      reason,
      unbound: Array.isArray(res?.unbound) ? res.unbound.length : null,
    });

    return c.json({
      branch: code,
      unbound: res?.unbound ?? [],
      skipped: res?.skipped ?? [],
    });
  } catch (e) { return mapError(c, e); }
});

export default r;
