/**
 * HQ opens a support session on a branch (H4's "Start a support session", D120).
 *
 *   POST /api/admin/branches/:code/support-session   { target_user_id, reason }
 *   POST /api/admin/branches/:code/accounts/:userId/move   { destination_code, reason }
 *   POST /api/admin/branches/:code/admins/:userId/unbind   { reason }   (D262)
 *   GET  /api/admin/account-moves                          (D5043) open partial moves
 *   POST /api/admin/account-moves/:uid/retry-invitation    (D5043) no body
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
import type { Context } from 'hono';
import { rawText, refusalBody } from '../util/refusal';
import {
  MOVE_OP_RE, claimRetry, isDestinationActiveRefusal, listOpenMoves, publicMove, readMove,
  recordInviteOutcome, recordMoveStarted, recordMovedOut, recordSourceRefused,
  type MoveErrorCode, type MoveRow,
} from '../services/accountMoves';

/**
 * D278 — A BRANCH'S REFUSAL IS PASSED THROUGH; A TRANSPORT FAILURE IS NOT.
 *
 * Measured, not assumed: every refusal the support-session methods in
 * `rpc/branchOps.ts` throw is written `rpc: …` — a reason under ten
 * characters, an account that is not there, a `super_admins` row that should
 * not exist. Those are HQ-authored inputs answered in the branch's own words,
 * and `hq_unbind_admin_d262.test.ts` pins that they survive. Anything else
 * that reaches this catch — the binding unreachable, the RPC transport's own
 * error — has no `rpc: ` prefix and is not the branch talking, so it goes to
 * the log and the operator reads our sentence instead.
 */
function branchWords(e: unknown): string | null {
  const text = rawText(e);
  return text.startsWith('rpc: ') ? text.slice('rpc: '.length, 'rpc: '.length + 400) : null;
}

/** A transport failure's own text goes to the log; the sentence says only that. */
function logUnreachable(e: unknown): string {
  refusalBody({ code: 'branch_unreachable', message: '', raw: e });
  return 'the branch could not be reached';
}

function branchRefusal(c: Context<any>, e: unknown, code = 'branch_refused'): Response {
  const words = branchWords(e);
  if (words !== null) return c.json({ error: code, message: words }, 409);
  return c.json(refusalBody({
    code: 'branch_unreachable',
    message: 'The branch could not be reached, so nothing was done there. Try again in a moment.',
    raw: e,
  }), 502);
}


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
      return branchRefusal(c, e);
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
      // D530 — WHETHER THE BRANCH'S NOTICE WAS STORED, exactly as the branch
      // reported it (D441): `true` when its security notice reached the
      // person's inbox there, `false` when it could not be stored (the session
      // is authorised all the same). Anything else is `null`, "not reported":
      // a branch Worker built before D441 sends no such field. It is never
      // defaulted to true, because "told" is a fact only the branch holds,
      // and the HQ Team form says what this field says and no more.
      target_notified: typeof offer?.target_notified === 'boolean' ? offer.target_notified : null,
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

    // D5043 — THE MOVE IS RECORDED BEFORE THE SOURCE IS CALLED. The record is
    // what "Retry invitation" reads if the second leg fails, so a move HQ
    // cannot record is refused here, with nothing done on either branch.
    let operation: string;
    try {
      operation = await recordMoveStarted(c.env, {
        from, to, branchUserId: userId, reason, actorUserId: admin.id, actorName,
      });
    } catch (e) {
      return c.json(refusalBody({
        code: 'move_not_recorded',
        message: 'HQ could not record this move, so it was not started: nothing was done on either branch. '
          + 'Try again in a moment.',
        raw: e,
      }), 503);
    }

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
      await recordSourceRefused(c.env, operation, branchWords(e) ?? 'the source could not be reached');
      return branchRefusal(c, e, 'source_refused');
    }
    mirrorBranchAction(c.env, 'account_moved_out', 'ok', from);
    // The proof the retry needs: the source answered that it closed the account.
    const recoverable = await recordMovedOut(c.env, operation, {
      email: movedOut?.target?.email ?? null,
      name: movedOut?.target?.name ?? null,
      role: movedOut?.target?.role ?? null,
    });

    // THE SECOND LEG, REPORTED AND NEVER THROWN. See the header.
    let invited: {
      ok: boolean; stored?: boolean; uid?: string; email_sent?: boolean; reason?: string;
      invite_link?: string; reused?: boolean; code?: MoveErrorCode;
    };
    try {
      const inv = await (destination.stub as any).inviteAccount(c.env.HQ_RPC_SECRET, {
        hq_actor_name: actorName,
        email: movedOut?.target?.email ?? '',
        name: movedOut?.target?.name ?? null,
        role: movedOut?.target?.role ?? 'exploring',
        moved_from_code: from,
        reason,
        // D5043 — the destination keeps one invitation per move under this.
        move_ref: operation,
      });
      invited = {
        ok: true,
        // D5043 — STORED and SENT are two facts, and the reply names both.
        stored: true,
        uid: inv?.uid,
        // NOT the same thing as `ok`. The invitation existing and the person
        // being told about it are two facts, and migration 236 already draws
        // that line: a branch with no mail sender records an invitation nobody
        // has heard of, and HQ has to see that to pass the link on by hand.
        email_sent: Boolean(inv?.email_sent),
        ...(inv?.email_reason ? { reason: inv.email_reason } : {}),
        // The branch hands the link over only when its message did not leave
        // (`InviteResult.invite_link`), so the operator can pass it on by hand.
        ...(!inv?.email_sent && typeof inv?.invite_link === 'string' ? { invite_link: inv.invite_link } : {}),
      };
      // The invitation LANDING is the branch answering; whether the mail left
      // is the branch's own business and migration 236's separate fact. The
      // mirror records the first, which is the one about reachability.
      mirrorBranchAction(c.env, 'account_invited', 'ok', to);
    } catch (e) {
      mirrorBranchAction(c.env, 'account_invited', 'failed', to);
      const words = branchWords(e);
      invited = {
        ok: false,
        code: isDestinationActiveRefusal(words) ? 'destination_active'
          : words !== null ? 'destination_refused' : 'destination_unreachable',
        reason: `The account was closed on ${from} and the invitation on ${to} did not land: `
          + `${words ?? logUnreachable(e)}. `
          + `Retry the invitation alone — moving them out again would be refused, correctly.`,
      };
    }
    if (recoverable) {
      await recordInviteOutcome(c.env, operation, invited.ok
        ? { ok: true, invite_uid: invited.uid ?? null, email_sent: Boolean(invited.email_sent), email_reason: invited.reason ?? null }
        : { ok: false, code: invited.code ?? 'destination_unreachable', message: invited.reason ?? '' });
    }

    try {
      await c.env.DB.prepare(
        `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`,
      ).bind(
        'hq_account_moved',
        JSON.stringify({
          from, to, target_user_id: userId, reason, operation,
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
      // D5043 — the move's HQ record. `recoverable` is false only when HQ could
      // not stamp the source's answer, and then Retry invitation is not offered.
      operation: { uid: operation, recoverable },
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
      return branchRefusal(c, e);
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

/**
 * GET /api/admin/account-moves
 *
 * D5043 — the moves HQ Team still has to finish or follow up, read from HQ's
 * own record (`hq_account_moves`), so a refresh or a later visit finds a
 * partial move instead of losing it with the reply it arrived in. Super Admin,
 * as every move is. It reads HQ's database only; no branch is called.
 */
r.get('/account-moves', async (c) => {
  try {
    await requireSuperAdmin(c);
    const rows = await listOpenMoves(c.env);
    return c.json({ items: rows.map(publicMove) });
  } catch (e) { return mapError(c, e); }
});

/**
 * POST /api/admin/account-moves/:uid/retry-invitation   (no body)
 *
 * D5043 — finish a move whose destination invitation did not land. The ONE
 * input is the operation uid. Email, name and role are what the source
 * answered when it closed the account, the destination is the move's, and the
 * reason is the move's: nothing the browser sends reaches the invitation, so
 * this cannot be used to invite an arbitrary person onto a branch.
 *
 * The move's own bar, in the move's order: TOTP, a recent step-up, Super Admin.
 * Then the record must prove the source closed the account (`moved_out_at`);
 * a move whose invitation already landed answers what landed and calls no
 * branch (`retried: false`); a claim on the row lets one retry run at a time;
 * and the destination's `move_ref` lookup answers an invitation it already
 * stored for this move instead of writing a second one. Every attempt and
 * outcome is audited, after the outcome is recorded: an audit write that
 * fails never undoes an invitation that landed (`logAdminAction` never throws).
 */
r.post('/account-moves/:uid/retry-invitation', async (c) => {
  try {
    await requireFactor(c, 'totp');
    await requireStepUp(c);
    const admin = await requireSuperAdmin(c);

    const uid = str(c.req.param('uid'), 40);
    if (!MOVE_OP_RE.test(uid)) {
      return c.json({ error: 'bad_operation', message: 'That is not a move operation id.' }, 400);
    }
    const row = await readMove(c.env, uid);
    if (!row) {
      return c.json({
        error: 'move_not_found',
        message: 'HQ has no move recorded under that id, so there is nothing to retry.',
      }, 404);
    }

    const audit = (outcome: string, extra: Record<string, unknown> = {}) =>
      logAdminAction(c.env, admin.id, admin.email, 'hq_account_move_invite_retried', {
        operation: uid, branch: row.to_code, from: row.from_code, branch_user_id: row.branch_user_id,
        outcome, ...extra,
      });

    // PROOF FIRST. No stamp means the source never answered that it closed
    // the account, and inviting the person could give them two homes.
    if (!row.moved_out_at) {
      await audit('refused_not_moved_out');
      return c.json({
        error: 'move_out_not_proven',
        message: row.status === 'source_refused'
          ? `${row.from_code} refused this move, so the account was never closed and there is no invitation to retry.`
          : `HQ has no record that ${row.from_code} closed this account, so no invitation is sent. `
            + 'Search for the account on that branch before doing anything else.',
        operation: publicMove(row),
      }, 409);
    }

    const landed = (r0: MoveRow) => ({
      ok: true,
      stored: true,
      uid: r0.invite_uid ?? undefined,
      email_sent: r0.invite_email_sent === 1,
      ...(r0.invite_email_reason ? { reason: r0.invite_email_reason } : {}),
    });

    // ALREADY FINISHED: answer what landed, call no branch.
    if (row.status === 'invited') {
      await audit('already_invited', { invite_uid: row.invite_uid });
      return c.json({ operation: publicMove(row), retried: false, invited: landed(row) });
    }
    if (!row.target_email) {
      await audit('refused_no_email');
      return c.json({
        error: 'move_target_unrecorded',
        message: `${row.from_code} did not report an email for this account when it closed it, so there is no `
          + 'address to invite. Ask the branch for it; HQ will not invite an address it did not record.',
        operation: publicMove(row),
      }, 409);
    }
    if (!c.env.HQ_RPC_SECRET) {
      return c.json({
        error: 'hq_rpc_secret_unset',
        message: 'HQ_RPC_SECRET is not set on this Worker, so the destination cannot tell this call '
          + 'from any other Worker in the account. Set it, then try again.',
      }, 409);
    }

    if (!(await claimRetry(c.env, uid))) {
      const now = (await readMove(c.env, uid)) ?? row;
      if (now.status === 'invited') {
        await audit('already_invited', { invite_uid: now.invite_uid });
        return c.json({ operation: publicMove(now), retried: false, invited: landed(now) });
      }
      await audit('refused_in_progress');
      return c.json({
        error: 'retry_in_progress',
        message: 'This invitation is being asked for already. Wait a moment and read the move again.',
        operation: publicMove(now),
      }, 409);
    }

    const fail = async (code: MoveErrorCode, message: string, status: 409 | 502) => {
      await recordInviteOutcome(c.env, uid, { ok: false, code, message });
      await audit(code);
      const after: MoveRow = { ...row, status: 'invite_failed', last_error_code: code, last_error: message,
        attempts: Number(row.attempts ?? 0) + 1 };
      return c.json({ error: code, message, operation: publicMove(after), retried: true }, status);
    };

    const destination = branchByCode(c.env, row.to_code);
    if (!destination) {
      mirrorBranchAction(c.env, 'account_invited', 'not_deployed', row.to_code);
      return fail('destination_not_bound',
        `No branch Worker is bound for ${row.to_code}, so the invitation cannot be sent yet. `
        + 'The account stays closed on ' + row.from_code + '.', 409);
    }

    let inv;
    try {
      inv = await (destination.stub as any).inviteAccount(c.env.HQ_RPC_SECRET, {
        hq_actor_name: str((admin as { name?: string }).name, 200) || 'Axal VC HQ',
        email: row.target_email,
        name: row.target_name,
        role: row.target_role ?? 'exploring',
        moved_from_code: row.from_code,
        reason: row.reason,
        move_ref: uid,
      });
    } catch (e) {
      mirrorBranchAction(c.env, 'account_invited', 'failed', row.to_code);
      const words = branchWords(e);
      if (isDestinationActiveRefusal(words)) {
        return fail('destination_active',
          `${row.to_code} already has an active account for this person, so no invitation was created. `
          + `If they registered there themselves, nothing more is needed; their account on ${row.from_code} stays closed.`,
          409);
      }
      if (words !== null) {
        return fail('destination_refused', `${row.to_code} refused the invitation: ${words}`, 409);
      }
      return fail('destination_unreachable',
        `${row.to_code} ${logUnreachable(e)}, so no invitation is known to have been created. `
        + 'Retry again in a moment; a retry cannot create a second invitation for this move.', 502);
    }
    mirrorBranchAction(c.env, 'account_invited', 'ok', row.to_code);

    const emailSent = Boolean(inv?.email_sent);
    const emailReason = inv?.email_reason ? String(inv.email_reason) : null;
    // The outcome is recorded FIRST; the audit after it. Neither can undo the
    // invitation, which already exists on the destination.
    const recorded = await recordInviteOutcome(c.env, uid, {
      ok: true, invite_uid: inv?.uid ?? null, email_sent: emailSent, email_reason: emailReason,
    });
    await audit('invited', { invite_uid: inv?.uid ?? null, email_sent: emailSent, reused: Boolean(inv?.reused) });

    const after: MoveRow = {
      ...row, status: 'invited', invite_uid: inv?.uid ?? null, invite_email_sent: emailSent ? 1 : 0,
      invite_email_reason: emailReason, last_error_code: null, last_error: null,
      attempts: Number(row.attempts ?? 0) + 1,
    };
    return c.json({
      operation: publicMove(after),
      retried: true,
      recorded,
      invited: {
        ok: true,
        stored: true,
        uid: inv?.uid,
        email_sent: emailSent,
        ...(emailReason ? { reason: emailReason } : {}),
        ...(!emailSent && typeof inv?.invite_link === 'string' ? { invite_link: inv.invite_link } : {}),
        ...(inv?.reused ? { reused: true } : {}),
        ...(inv?.accepted ? { accepted: true } : {}),
      },
    });
  } catch (e) { return mapError(c, e); }
});

export default r;
