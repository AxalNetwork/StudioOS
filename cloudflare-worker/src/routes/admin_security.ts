/**
 * HQ · Security (Support Security · Super canvas, Y2; decision A4 renamed the
 * row from Governance).
 *
 * SUPER ADMIN ONLY, every route. This is the cross-tenant security desk: at
 * HQ scale the compliance officer and the security engineer are one headcount
 * and one page. A subsidiary admin has no security console by design (A5).
 *
 *   GET  /overview        one payload for the Security page
 *   GET  /governance      canvas H23's ledger (which completes H7's
 *                         privileged-action feed), unioned across the five
 *                         stores that actually record one
 *   POST /force-reauth    sign every active account on THIS deployment out,
 *                         with a typed reason; recorded in admin_audit_log.
 *                         D4669: branches are not reached, and the answer
 *                         lists each (services/emergencyScope.ts)
 *   POST /dsr/:userId/close   close a data-subject erasure request as
 *                         fulfilled or denied, with a typed reason (D168)
 *   GET  /sessions        D481 — active sessions and live support sessions,
 *                         the list the Sessions zone acts on
 *   POST /sessions/:id/revoke   revoke one session, with a typed reason
 *   POST /sessions/revoke       revoke the selected sessions, one reason,
 *                         one audit row per session
 *   POST /impersonations/:id/end   close a live support session's record
 *
 * WHAT IS REAL HERE. The admin action audit (`admin_audit_log`, every action,
 * newest first — the existing /monitoring/audit read allows two actions only);
 * impersonation sessions, live and recent; active sessions and MFA coverage
 * among admins; the KYC queue by status; data-subject deletion requests with
 * the statutory clock; and — since D152 — the AI guardrail counters, which
 * this page denied for months while `AiUsageTab` rendered them one click away.
 *
 * WHAT WAS NOT, AND WHAT D200 CHANGED. This header used to name three stated
 * absences: a `security_events` ledger, a sanctions screen, and backup /
 * restore-drill status. Measured, two of the three were refusals that denied
 * stores the platform has. The ledger is built now (migration 282,
 * services/securityEvents.ts) and is the fifth store /governance unions; the
 * sanctions card reads `sanctions_screenings`, which `screenUser` has written
 * since migration 035 — on request, never on a schedule, and the card says
 * so; the backup half of "Backup / DR" reads the heartbeat the nightly export
 * writes to R2. What is still genuinely absent — a restore-drill outcome the
 * platform can read, and the events the ledger deliberately does not count —
 * comes back as `{ available: false, reason }` or a `not_counted` list, so
 * the page says so in the zone the canvas draws for it instead of rendering
 * the canvas's sample rows. The AI-safety zone is the same mixed case the
 * D111 pattern produces: real figures beside a named list of what they
 * cannot say.
 *
 * FORCE RE-AUTH. `users.jwt_min_iat` is how sign-out-everywhere already works
 * per account (routes/settings.ts POST /sessions/revoke-all). Platform-wide
 * it is the same UPDATE over every active account — the caller included,
 * which the response says — behind the impersonation write bar: a TOTP
 * session, a recent step-up, then the elevation. The reason is required and
 * stored; a platform-wide sign-out with no stated cause is an incident that
 * cannot be reconstructed.
 *
 * D4708 (#4708) — THIS FILE ROUTES; THE READS LIVE IN `services/adminSecurity/`. Each handler here keeps its
 * gate, its request parsing and its refusals; what `/overview` and `/governance` return is built by
 * `overview.ts` and `governanceFeed.ts` (with `aiSafety.ts`, `feedQuery.ts`, `feedFormat.ts` and
 * `dataAccess.ts`), and the availability shape and status words are `frontend/src/lib/securityContract.js`,
 * which the Security page imports too. The write handlers below are unchanged in place.
 *
 * Mounted at /api/admin/security BEFORE the catch-all /api/admin in index.ts.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import {
  IMPERSONATION_EXPIRY_MINUTES, requireSuperAdmin, requireSuperAdminWriteBar, bumpJwtMinIat, selectJwt,
} from '../auth';
import {
  listActiveSessions, listLiveImpersonations, revokeUserSession, endImpersonation,
  SESSION_TOKEN_HOURS, SESSION_BULK_LIMIT, SESSION_LIST_LIMIT,
} from '../services/userSessions';
import { SESSION_STATUS_DEFINITIONS } from '../services/sessionStatus';
import { supportIdentity, type Identity } from '../services/securityIdentity';
import { logAdminAction } from '../services/adminAudit';
import { branchBindings } from '../services/branches';
import {
  emergencyScope, deploymentOutcomes, signOutOnBranches, type BranchSignOutTarget,
} from '../services/emergencyScope';
import { EMERGENCY_REASON_MIN, EMERGENCY_OP_KEY_RE } from '../rpc/branchOps';
import {
  HQ_DSR_OUTCOMES, isHqDsrOutcome, closeDsrRequest, DSR_CLOSE_KEY_RE,
} from '../services/dsrRequests';
import { ensureAdminAuditLogTable } from './admin';
import { absent, type Absent } from '../services/adminSecurity/contract';
import { loadSecurityOverview } from '../services/adminSecurity/overview';
import { parseFeedQuery } from '../services/adminSecurity/feedQuery';
import { feedFilterOf, loadGovernance } from '../services/adminSecurity/governanceFeed';
import { eraseAccountAgents } from '../agents/erasure';

/** D4708 — the ledger's query contract, still importable from the route that serves it. */
export {
  FEED_OUTCOMES, FEED_SOURCES, parseFeedQuery, trimToSecond, type FeedQuery,
} from '../services/adminSecurity/feedQuery';

const r = new Hono<{ Bindings: Env }>();

const MIN_REASON = 8;

r.get('/overview', async (c) => {
  await requireSuperAdmin(c);
  return c.json(await loadSecurityOverview(c.env));
});

r.get('/governance', async (c) => {
  await requireSuperAdmin(c);
  const asked = String(c.req.query('filter') || 'all');
  const filter = feedFilterOf(asked);
  const now = Date.now();
  // D4803 — the cursor and the server-side filters. A value out of shape is
  // refused with its field, never read as a wider list than was asked for.
  const parsed = parseFeedQuery((k) => c.req.query(k));
  if (!parsed.ok) return c.json({ error: parsed.message, code: 'invalid_filter', field: parsed.field }, 400);
  return c.json(await loadGovernance(c.env, filter, parsed.query, now));
});

// ── D481 · the Sessions zone acts ─────────────────────────────────────────
//
// The zone said "Revoke is recorded" and had no revoke. These four routes are
// the list it acts on and the three acts. Each write is behind the same bar as
// force re-auth, for the same reason that route's docblock gives: a revoke is
// what an attacker holding an admin session reaches for to lock the real
// holder out. Each revoke writes ONE `logAdminAction` row naming the account
// whose session it was (`target_user_id`), so the governance feed's join can
// say whose session ended — and a bulk revoke writes one per session, never
// one row for "some sessions".

/** A typed reason, or the refusal that says how long it must be. */
async function reasonOf(c: any): Promise<{ reason: string; body: Record<string, unknown> }> {
  let body: Record<string, unknown> = {};
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { body = {}; }
  return { reason: String(body?.reason ?? '').trim(), body };
}
const reasonRefusal = (c: any) => c.json({
  error: `A reason of at least ${MIN_REASON} characters is required. It is stored with the action.`,
  code: 'reason_required',
}, 400);

r.get('/sessions', async (c) => {
  await requireSuperAdmin(c);
  const sel = await selectJwt(c);
  const currentJti = typeof sel?.payload?.jti === 'string' ? (sel.payload.jti as string) : null;

  // UNREADABLE IS A 503, NOT AN EMPTY LIST. "Nobody is signed in" is the one
  // answer a security desk must never give by accident.
  // D4699 — `before_id` continues the list strictly below that session id (the last row's). Out of
  // shape is refused with its field, never read as the first page.
  const rawBefore = c.req.query('before_id');
  let beforeId: number | null = null;
  if (rawBefore !== undefined && rawBefore !== '') {
    if (!/^[1-9][0-9]{0,15}$/.test(rawBefore)) {
      return c.json({ error: 'The cursor is not a session id.', code: 'invalid_filter', field: 'before_id' }, 400);
    }
    beforeId = Number(rawBefore);
  }
  let list: Awaited<ReturnType<typeof listActiveSessions>>;
  try {
    list = await listActiveSessions(c.env, currentJti, SESSION_LIST_LIMIT, beforeId);
  } catch {
    return c.json({
      error: 'Unreadable — the user_sessions table could not be read on this database. This is not a claim '
        + 'that nobody is signed in.',
      code: 'sessions_unreadable',
    }, 503);
  }

  // The support sessions answer for themselves: a database that never
  // impersonated has no table, and that costs this half, not the list.
  let impersonations:
    | { available: true; rows: Array<Awaited<ReturnType<typeof listLiveImpersonations>>[number] & { actor: Identity }> }
    | Absent;
  try {
    const live = await listLiveImpersonations(c.env);
    impersonations = {
      available: true,
      rows: live.map((i) => ({
        ...i,
        actor: supportIdentity(
          { id: i.admin_user_id, name: i.admin_name, email: i.admin_email },
          { id: i.target_user_id, name: i.target_name, email: i.target_email },
        ),
      })),
    };
  } catch {
    impersonations = absent('The impersonation_sessions table could not be read on this database.');
  }

  return c.json({
    token_hours: SESSION_TOKEN_HOURS,
    total: list.total,
    rows: list.rows,
    // D4699 — Load more: the next page is `?before_id=<cursor.before_id>`; null when this is the last.
    cursor: list.next_before_id ? { before_id: list.next_before_id } : null,
    impersonations,
    expiry_minutes: IMPERSONATION_EXPIRY_MINUTES,
    // D4669 — every act on this list reaches this deployment only.
    scope: emergencyScope(c.env),
    // D4691 — the same definitions /overview's tiles are counted by.
    definitions: SESSION_STATUS_DEFINITIONS,
  });
});

r.post('/sessions/:id/revoke', async (c) => {
  const actor = await requireSuperAdminWriteBar(c);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'A numeric session id is required.', code: 'invalid_target' }, 400);
  }
  const { reason } = await reasonOf(c);
  if (reason.length < MIN_REASON) return reasonRefusal(c);

  // YOUR OWN CURRENT SESSION IS NOT REVOKED FROM HERE. The row is labelled
  // Current and offers no Revoke; a request that names it anyway is refused,
  // because the act would sign the operator out mid-incident with nothing
  // recorded about why the desk went dark. Sign out is the door for that.
  const sel = await selectJwt(c);
  const currentJti = typeof sel?.payload?.jti === 'string' ? (sel.payload.jti as string) : null;
  if (currentJti) {
    const own = await c.env.DB.prepare(
      'SELECT id FROM user_sessions WHERE jti = ?',
    ).bind(currentJti).first<{ id: number }>();
    if (own && Number(own.id) === id) {
      return c.json({
        error: 'That is the session you are using. Sign out to end it; it is not revoked from this list.',
        code: 'own_current_session',
      }, 409);
    }
  }

  const out = await revokeUserSession(c.env, id);
  if (out.outcome === 'not_found') {
    return c.json({ error: 'No session holds that id.', code: 'session_not_found' }, 404);
  }
  if (out.outcome === 'already_revoked') {
    return c.json({
      error: `That session was already revoked${out.revoked_at ? ` at ${out.revoked_at}` : ''}. Nothing was changed.`,
      code: 'already_revoked',
    }, 409);
  }
  // `target_user_id`, never `user_id` — D159's guard, and the key the
  // governance feed's LEFT JOIN names the account by.
  await logAdminAction(c.env, actor.id, actor.email, 'security_session_revoked', {
    reason,
    target_user_id: out.user_id,
    session_id: id,
    revoked_at: out.revoked_at,
  });
  return c.json({
    ok: true,
    session_id: id,
    user_id: out.user_id,
    revoked_at: out.revoked_at,
    message: 'Revoked. That session\'s token is refused from its next request; the account\'s other sessions '
      + 'are untouched.',
    scope: emergencyScope(c.env),
  });
});

r.post('/sessions/revoke', async (c) => {
  const actor = await requireSuperAdminWriteBar(c);
  const { reason, body } = await reasonOf(c);
  const raw = Array.isArray(body?.ids) ? (body.ids as unknown[]) : null;
  if (!raw || raw.length === 0) {
    return c.json({ error: 'Select at least one session.', code: 'no_sessions' }, 400);
  }
  if (raw.length > SESSION_BULK_LIMIT) {
    return c.json({
      error: `At most ${SESSION_BULK_LIMIT} sessions can be revoked in one request.`,
      code: 'too_many_sessions',
    }, 400);
  }
  const ids = [...new Set(raw.map((v) => Number(v)))];
  if (ids.some((v) => !Number.isInteger(v) || v <= 0)) {
    return c.json({ error: 'Every session id must be a positive number.', code: 'invalid_target' }, 400);
  }
  if (reason.length < MIN_REASON) return reasonRefusal(c);

  const sel = await selectJwt(c);
  const currentJti = typeof sel?.payload?.jti === 'string' ? (sel.payload.jti as string) : null;
  const own = currentJti
    ? await c.env.DB.prepare('SELECT id FROM user_sessions WHERE jti = ?').bind(currentJti).first<{ id: number }>()
    : null;
  if (own && ids.includes(Number(own.id))) {
    return c.json({
      error: 'The selection includes the session you are using. Deselect it; sign out to end it.',
      code: 'own_current_session',
    }, 409);
  }

  // One at a time, each audited as it lands. A batch would be atomic, but the
  // audit writer is not part of it — and an act recorded for sessions that a
  // failed batch never revoked is worse than a partial result reported row by
  // row, which is what this returns.
  const results: Array<{ id: number; outcome: string }> = [];
  for (const id of ids) {
    const out = await revokeUserSession(c.env, id);
    if (out.outcome === 'revoked') {
      await logAdminAction(c.env, actor.id, actor.email, 'security_session_revoked', {
        reason,
        target_user_id: out.user_id,
        session_id: id,
        revoked_at: out.revoked_at,
        bulk: true,
      });
    }
    results.push({ id, outcome: out.outcome });
  }
  const revoked = results.filter((x) => x.outcome === 'revoked').length;
  return c.json({
    ok: true,
    revoked,
    results,
    message: revoked === results.length
      ? `Revoked ${revoked} session${revoked === 1 ? '' : 's'}.`
      : `Revoked ${revoked} of ${results.length}. The rest were already revoked or no longer exist; each is listed.`,
    scope: emergencyScope(c.env),
  });
});

r.post('/impersonations/:id/end', async (c) => {
  const actor = await requireSuperAdminWriteBar(c);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'A numeric session id is required.', code: 'invalid_target' }, 400);
  }
  const { reason } = await reasonOf(c);
  if (reason.length < MIN_REASON) return reasonRefusal(c);

  let out: Awaited<ReturnType<typeof endImpersonation>>;
  try {
    out = await endImpersonation(c.env, id);
  } catch {
    return c.json({
      error: 'Unreadable — the impersonation_sessions table could not be read, so nothing was changed.',
      code: 'impersonations_unreadable',
    }, 503);
  }
  if (out.outcome === 'not_found') {
    return c.json({ error: 'No support session holds that id.', code: 'session_not_found' }, 404);
  }
  if (out.outcome === 'already_ended') {
    return c.json({ error: 'That support session has already ended. Nothing was changed.', code: 'already_ended' }, 409);
  }
  if (out.outcome === 'past_ceiling') {
    return c.json({
      error: 'That record is older than the support-session ceiling, so no token for it can still be valid. '
        + 'Ending it now would stamp a time it did not end at; it stays recorded as not closed.',
      code: 'past_ceiling',
    }, 409);
  }
  await logAdminAction(c.env, actor.id, actor.email, 'security_impersonation_ended', {
    reason,
    target_user_id: out.row.target_user_id,
    impersonation_session_id: id,
    support_admin_user_id: out.row.admin_user_id,
    started_at: out.row.started_at,
  });
  return c.json({
    ok: true,
    impersonation_session_id: id,
    target_user_id: out.row.target_user_id,
    // D4669 — ENDING NOW ENDS THE ACCESS. The support token names this
    // record and every request re-reads it (auth.ts `sessionStanding`), so the
    // message no longer has to explain a token outliving its session.
    message: 'The support session is ended. Its token is refused from its next request, and it can no longer '
      + 'be extended. The account holder\'s own sessions are untouched.',
    scope: emergencyScope(c.env),
  });
});

/**
 * POST /api/admin/security/branch-sign-out
 *
 * D4669 part 2 (#4669) — the owner's option B: HQ's emergency sign-out may
 * reach branch deployments, ON REQUEST, and each branch reports its own
 * outcome. The ordinary acts above are unchanged and still write this
 * deployment only; this is the separate act an operator chooses when an
 * incident spans branches.
 *
 * Body: `{ branches: 'all' | string[], target, reason, op_key }`, where
 * `target` is `{ kind: 'all' }` (every account on each branch named),
 * `{ kind: 'account', email }` (the person's account on each branch named, by
 * email, because HQ's ids mean nothing in another database) or
 * `{ kind: 'account', user_id }` (one account HQ found on ONE branch).
 *
 * THE SAME BAR AS SIGNING EVERYONE OUT HERE (TOTP, a recent step-up, the
 * elevation), checked before any binding is touched. The branch checks the
 * caller is HQ, the reason, the operator's name and the key itself.
 *
 * EACH BRANCH IS ITS OWN ROW, and only an answer counts:
 *   done         the branch said it acted (with how many accounts, and
 *                `replayed` when this act was already on its record);
 *   failed       the branch refused before writing: nothing changed there;
 *   unreachable  not bound, or no answer in time: whether it acted is not
 *                known, and it NEVER counts as done.
 * The act is `done` only when every branch named said done, `failed` when none
 * did, and `partial` otherwise — said as partial, never rounded either way.
 *
 * ONE KEY PER OPERATOR REQUEST. The page makes it when the dialog opens and
 * resends it on Try again, and each branch answers a key it already holds
 * with that record. So retrying a branch that timed out cannot sign anyone
 * out twice or write a second audit row there.
 *
 * GATES THAT STAY: `HQ_RPC_SECRET` must be set (409 otherwise, as for every
 * secret-carrying branch call), and a branch without a binding is reported,
 * not skipped.
 */
r.post('/branch-sign-out', async (c) => {
  const actor = await requireSuperAdminWriteBar(c);
  const { reason, body } = await reasonOf(c);
  if (reason.length < EMERGENCY_REASON_MIN) {
    return c.json({
      error: `A reason of at least ${EMERGENCY_REASON_MIN} characters is required. It is stored here and on every branch reached.`,
      code: 'reason_required',
    }, 400);
  }
  const opKey = String(body?.op_key ?? '');
  if (!EMERGENCY_OP_KEY_RE.test(opKey)) {
    return c.json({ error: 'The request carries no operation key, so a retry could not be recognised. Reopen the dialog.', code: 'op_key_required' }, 400);
  }

  const t = (body?.target ?? {}) as Record<string, unknown>;
  let target: BranchSignOutTarget;
  if (t.kind === 'all') {
    target = { kind: 'all' };
  } else if (t.kind === 'account' && typeof t.email === 'string' && t.email.includes('@')) {
    target = { kind: 'account', email: t.email.trim().toLowerCase().slice(0, 320) };
  } else if (t.kind === 'account' && Number.isInteger(Number(t.user_id)) && Number(t.user_id) > 0) {
    target = { kind: 'account', user_id: Number(t.user_id) };
  } else {
    return c.json({ error: 'Name the target: every account, or one account by email (or by its id on one branch).', code: 'invalid_target' }, 400);
  }

  const bound = (() => { try { return branchBindings(c.env).map((b) => b.code); } catch { return null; } })();
  if (bound === null) {
    return c.json({ error: 'Which branches are bound could not be read, so no branch was asked. Nothing changed.', code: 'branches_unreadable' }, 503);
  }
  let codes: string[];
  if (body?.branches === 'all') {
    codes = bound;
  } else if (Array.isArray(body?.branches)) {
    codes = [...new Set((body.branches as unknown[]).map((x) => String(x ?? '').trim().toLowerCase()).filter(Boolean))];
  } else {
    return c.json({ error: 'Name the branches: every bound branch, or a list of branch codes.', code: 'invalid_branches' }, 400);
  }
  if (codes.length === 0) {
    return c.json({ error: 'No branch is bound here, so there is no branch to reach. Nothing changed.', code: 'no_branch' }, 409);
  }
  if ('user_id' in target && codes.length !== 1) {
    return c.json({ error: 'An account id belongs to one branch. Name that one branch, or name the person by email.', code: 'invalid_target' }, 400);
  }
  if (!c.env.HQ_RPC_SECRET) {
    return c.json({
      error: 'HQ_RPC_SECRET is not set on this Worker, so a branch cannot tell this call from any other Worker in the account. '
        + 'Set it, then try again. No branch was asked.',
      code: 'hq_rpc_secret_unset',
    }, 409);
  }

  const result = await signOutOnBranches(c.env, codes, {
    secret: c.env.HQ_RPC_SECRET,
    hq_actor_name: String((actor as { name?: string }).name || actor.email || 'Axal VC HQ').slice(0, 200),
    reason,
    op_key: opKey,
    target,
  });

  // HQ's record of the act, after the outcome is known and whatever it is: an
  // operator's request to sign people out of other deployments is recorded
  // even when no branch answered. `logAdminAction` never throws, so its
  // failure never turns a reported outcome into an error.
  await logAdminAction(c.env, actor.id, actor.email, 'security_branch_sign_out', {
    reason,
    op_key: opKey,
    target_kind: target.kind,
    ...('email' in target ? { target_email: target.email } : {}),
    ...('user_id' in target ? { branch_user_id: target.user_id } : {}),
    outcome: result.outcome,
    branches: result.outcomes.map((o) => ({ code: o.deployment, outcome: o.outcome, affected: o.affected ?? null })),
  });

  const done = result.outcomes.filter((o) => o.outcome === 'done').length;
  const message = result.outcome === 'done'
    ? `Every branch asked (${done}) answered that it signed the ${target.kind === 'all' ? 'accounts' : 'account'} out.`
    : result.outcome === 'partial'
      ? `${done} of ${result.outcomes.length} branches answered that they acted. The others are listed with what is known; a branch that did not answer is not counted as done.`
      : 'No branch answered that it acted. Each is listed with what is known.';
  return c.json({
    ok: result.outcome === 'done',
    outcome: result.outcome,
    op_key: opKey,
    message,
    outcomes: result.outcomes,
    scope: emergencyScope(c.env),
  });
});

/**
 * ONE ACCOUNT, which is the whole point: until D165 the only revoke HQ had was
 * the platform-wide one below, so signing out a single compromised admin meant
 * signing out EVERY account on every tenant — and in a real incident the safe
 * action is then the one nobody is willing to take.
 *
 * The primitive was already per-account. `bumpJwtMinIat` writes one row and
 * `getCurrentUser` re-reads that row's floor on every request, so one bump
 * invalidates exactly that account's tokens. What was missing was a door.
 *
 * SAME BAR AS THE BULK ROUTE, and deliberately not a lower one. Signing one
 * admin out is a smaller act than signing everyone out, so a cheaper gate would
 * be defensible — and it would be wrong: this is the route an attacker who has
 * an admin session would reach for to lock the real holder out. `requireFactor`
 * + `requireStepUp` is what makes a stolen session unable to use it.
 */
r.post('/force-reauth/:userId', async (c) => {
  const actor = await requireSuperAdminWriteBar(c);

  const uid = Number(c.req.param('userId'));
  if (!Number.isFinite(uid) || uid <= 0) {
    return c.json({ error: 'A numeric user id is required.', code: 'invalid_target' }, 400);
  }

  let reason = '';
  try { reason = String((await c.req.json())?.reason ?? '').trim(); } catch { reason = ''; }
  if (reason.length < MIN_REASON) {
    return c.json({
      error: `A reason of at least ${MIN_REASON} characters is required. It is stored with the action.`,
      code: 'reason_required',
    }, 400);
  }

  // REFUSE AN ABSENT TARGET rather than reporting a revoke of nobody. The UPDATE
  // would succeed with `changes: 0` and the audit row would name a user id that
  // joins to no one, which reads in HQ's feed as an act against a person who
  // does not exist.
  const target = await c.env.DB.prepare(
    'SELECT id, email, name FROM users WHERE id = ?',
  ).bind(uid).first<{ id: number; email: string; name: string | null }>();
  if (!target) {
    return c.json({ error: 'No account holds that id.', code: 'user_not_found' }, 404);
  }

  // D4669 — A FAILED WRITE IS SAID, NOT THROWN. The floor is the whole act;
  // if it could not be raised nothing changed, and the operator must know
  // that rather than meet a generic error mid-incident.
  let revokedAt: number;
  try {
    revokedAt = await bumpJwtMinIat(c.env, uid);
  } catch (e) {
    console.error('[admin_security] force-reauth/:userId failed', (e as Error).message);
    return c.json({
      error: 'The sign-out could not be written, so nothing was changed: the account\'s sessions are still valid. '
        + 'Try again; if it keeps failing, revoke its sessions one by one.',
      code: 'sign_out_failed',
      outcomes: deploymentOutcomes(c.env, { outcome: 'failed' }),
      scope: emergencyScope(c.env),
    }, 503);
  }

  // `target_user_id` is the key `logAdminAction` reads for `viewed_user_id`, and
  // it is what lets the governance feed's LEFT JOIN name WHO was signed out.
  // Spelt `user_id` it would record the act with a blank Target, silently —
  // which is why D159's guard refuses that spelling at every call site.
  await logAdminAction(c.env, actor.id, actor.email, 'security_force_reauth_user', {
    reason,
    target_user_id: uid,
    revoked_at: revokedAt,
  });

  return c.json({
    ok: true,
    user_id: uid,
    email: target.email,
    revoked_at: revokedAt,
    // D4669 — "every session" on THIS deployment. An account of the same
    // person on a branch is a different account in a different database.
    message: `${target.name || target.email} has been signed out of every session on this deployment, including `
      + 'any support session opened as them. They will need to sign in again.',
    outcomes: deploymentOutcomes(c.env, { outcome: 'done', affected: 1 }),
    scope: emergencyScope(c.env),
  });
});

r.post('/force-reauth', async (c) => {
  // D165 — three hand-rolled gates became the shared bar. `requireSuperAdminWriteBar`
  // composes requireFactor('totp') -> requireStepUp -> requireSuperAdmin in that
  // order, with the argument for the order in its own docblock; this route was the
  // fourth copy of those three lines, and three copies is how one of them comes to
  // check only two. The order is now pinned where it is DEFINED rather than in each
  // copy, which is the stronger place for it.
  const actor = await requireSuperAdminWriteBar(c);

  let reason = '';
  try { reason = String((await c.req.json())?.reason ?? '').trim(); } catch { reason = ''; }
  if (reason.length < MIN_REASON) {
    return c.json({
      error: `A reason of at least ${MIN_REASON} characters is required. It is stored with the action.`,
      code: 'reason_required',
    }, 400);
  }

  // +1s so tokens issued in this same second are bounced too, exactly as the
  // per-account primitive does. Inactive accounts cannot sign in anyway.
  const nowSec = Math.floor(Date.now() / 1000) + 1;
  let affected: number;
  try {
    const result = await c.env.DB.prepare(
      'UPDATE users SET jwt_min_iat = ? WHERE is_active = 1',
    ).bind(nowSec).run();
    affected = Number(result.meta?.changes ?? 0);
  } catch (e) {
    // D4669 — one statement, so a failure changed nothing. Said, with the
    // per-deployment answer, rather than a generic 500.
    console.error('[admin_security] force-reauth failed', (e as Error).message);
    return c.json({
      error: 'The sign-out could not be written, so nothing was changed: every session is still valid. Try again.',
      code: 'sign_out_failed',
      outcomes: deploymentOutcomes(c.env, { outcome: 'failed' }),
      scope: emergencyScope(c.env),
    }, 503);
  }

  // D165 — was a raw INSERT into admin_audit_log, which is the third copy D159
  // set out to end and missed. `filters_json` carries the same payload, so the
  // governance row is unchanged; what the shared writer adds is the `activity_logs`
  // row D159 requires of every privileged action, and what it REMOVES is a way for
  // this handler to fail after the fact: a bare `await ...run()` throws, so a failed
  // audit write turned a completed platform-wide sign-out into a 500 and told the
  // operator their act had not happened. `logAdminAction` warns and continues,
  // because a recorded act must never be undone by its own telemetry.
  await logAdminAction(c.env, actor.id, actor.email, 'security_force_reauth', {
    reason, affected, revoked_at: nowSec,
  });

  return c.json({
    ok: true,
    affected,
    revoked_at: nowSec,
    // D4669 — THIS DEPLOYMENT, and the answer says which branches it did not
    // reach. The old sentence ("everywhere") read as platform-wide while the
    // write touched one database.
    message: 'Every active account on this deployment has been signed out, including yours. Branch deployments '
      + 'are not reached by this action; each is listed. Sign in again with your authenticator.',
    outcomes: deploymentOutcomes(c.env, { outcome: 'done', affected }),
    scope: emergencyScope(c.env),
  });
});

/**
 * D168 — CLOSE A DATA-SUBJECT REQUEST.
 *
 * THE DEFECT THIS EXISTS FOR. Before this route, `users.deletion_requested_at`
 * was written only by the subject (routes/settings.ts request and cancel),
 * read here against a statutory 30-day clock, and rendered by SecurityPage in
 * amber with an overdue count — and this file declared four handlers, none of
 * which could act on one. HQ watched a legal deadline it had no way to stop.
 *
 * SAME BAR AS FORCE RE-AUTH, and for a reason of its own rather than by
 * symmetry: closing a request stops a statutory clock and writes the record
 * a regulator would read.
 *
 * D4675 — THE REVIEWED REQUEST, ONCE. The body names the request the operator
 * reviewed (`requested_at`, and `request_id` when the list had one) and a
 * `close_key` the page made once for this close. The service applies the
 * close only to that request while it is still open, writes the decision, the
 * subject's notice and both audit rows in one batch, and answers a retry of
 * the same key with the record it already made. Every answer says what is on
 * record: closed, already closed by this act, nothing written because the
 * request changed or was closed first, or unconfirmed.
 */
r.post('/dsr/:userId/close', async (c) => {
  const actor = await requireSuperAdminWriteBar(c);

  const uid = Number(c.req.param('userId'));
  if (!Number.isFinite(uid) || uid <= 0) {
    return c.json({ error: 'A numeric user id is required.', code: 'invalid_target' }, 400);
  }

  let body: Record<string, unknown> = {};
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { body = {}; }
  const outcome = String(body?.outcome ?? '').trim();
  const reason = String(body?.reason ?? '').trim();
  const requestedAt = typeof body?.requested_at === 'string' ? body.requested_at : '';
  const rawId = body?.request_id;
  const requestId = rawId === null || rawId === undefined ? null : Number(rawId);
  const closeKey = typeof body?.close_key === 'string' ? body.close_key : '';

  if (!isHqDsrOutcome(outcome)) {
    return c.json({
      error: `Outcome must be one of ${HQ_DSR_OUTCOMES.join(' or ')}. A withdrawal is the subject's own act and `
        + 'is recorded when they cancel, not by HQ.',
      code: 'invalid_outcome',
    }, 400);
  }
  if (reason.length < MIN_REASON) {
    return c.json({
      error: `A reason of at least ${MIN_REASON} characters is required. It is stored with the action.`,
      code: 'reason_required',
    }, 400);
  }
  if (!requestedAt || !DSR_CLOSE_KEY_RE.test(closeKey)
      || (requestId !== null && (!Number.isInteger(requestId) || requestId <= 0))) {
    return c.json({
      error: 'This close does not say which request was reviewed. Reload the Security page and close it again.',
      code: 'review_required',
    }, 400);
  }

  // REFUSE AN ABSENT TARGET rather than reporting a close of nobody: the
  // audit row would name a subject who does not exist against a statutory act.
  const target = await c.env.DB.prepare(
    'SELECT id, email, name FROM users WHERE id = ?',
  ).bind(uid).first<{ id: number; email: string; name: string | null }>();
  if (!target) {
    return c.json({ error: 'No account holds that id.', code: 'user_not_found' }, 404);
  }

  const subject = target.name || target.email;
  let result;
  try {
    await ensureAdminAuditLogTable(c.env);
    // `target_user_id: uid` is how the audit row names the subject (D159);
    // the service writes it in the same batch as the decision.
    result = await closeDsrRequest(c.env, {
      userId: uid, actorUserId: actor.id, actorEmail: actor.email, outcome, reason,
      requestedAt, requestId, closeKey,
      // D9046: `fulfilled` runs the platform's own erasure before it records.
      erase: () => eraseAccountAgents(c.env, uid),
    });
  } catch (e) {
    return c.json({
      error: 'The close could not be confirmed. As far as this server can tell nothing was recorded and the '
        + 'request is still open; repeating it records it at most once. '
        + `Migration 272 creates \`dsr_requests\`. (${(e as Error).message})`,
      code: 'ledger_unavailable',
    }, 503);
  }

  if (result.status === 'erasure_failed') {
    return c.json({
      error: 'Nothing was recorded. The platform’s erasure of this account’s agent data (runtime, memory notes, '
        + 'run summaries and queued tasks) did not complete, so the request is still open and its clock still '
        + 'runs. Close it again: the erasure is safe to repeat.',
      code: 'erasure_step_failed',
    }, 503);
  }
  if (result.status === 'unconfirmed') {
    return c.json({
      ok: false,
      code: 'outcome_unconfirmed',
      error: 'The close was sent, but whether it was recorded could not be read back. Try again: repeating '
        + 'this close records it at most once.',
    }, 202);
  }
  if (result.status === 'key_conflict') {
    return c.json({
      error: 'This close carries a key already used for a different close. Reload the page and close it again.',
      code: 'idempotency_key_conflict',
    }, 409);
  }
  if (result.status === 'stale') {
    return c.json({
      error: 'Nothing was recorded. The request you reviewed is no longer the open one: the subject withdrew it '
        + 'and asked again. Reload to review the current request.',
      code: 'stale_request',
      current_requested_at: result.current_requested_at,
    }, 409);
  }
  if (result.status === 'not_open') {
    return c.json({
      error: 'Nothing was recorded. That account has no open erasure request: it was closed first, or the '
        + 'subject cancelled it themselves.',
      code: 'no_open_request',
      last_outcome: result.last?.outcome ?? null,
      last_outcome_at: result.last?.closed_at ?? null,
    }, 409);
  }

  return c.json({
    ok: true,
    replayed: result.replayed,
    user_id: uid,
    request_id: result.row.id,
    email: target.email,
    outcome,
    requested_at: result.row.requested_at,
    // THE RESPONSE SAYS WHAT WAS AND WAS NOT DONE. `fulfilled` ran the one
    // erasure the platform has (D9046: the account's agent data) and records
    // that the rest of the manual erasure happened; a message implying the
    // platform erased more would be the false claim the outcome list exists to
    // avoid.
    message: (result.replayed ? 'Already on record from your earlier attempt. ' : '') + (outcome === 'fulfilled'
      ? `Recorded: ${subject}'s erasure request was fulfilled. This stops the statutory clock and records who `
        + 'closed it and why. The platform erased the agent data this account holds (its agents’ runtime, memory '
        + 'notes, run summaries and queued tasks); it erases nothing else — the rest is the manual act you are recording.'
      : `Recorded: ${subject}'s erasure request was denied, with your reason stored against it. The statutory `
        + 'clock has stopped; they can make a new request.'),
  });
});

export default r;
