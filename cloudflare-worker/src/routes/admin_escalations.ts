/**
 * HQ answers a branch (H1's escalation queue, H6's localisation lane — D112).
 *
 *   GET   /api/admin/escalations          the board, filterable by status/kind
 *   PATCH /api/admin/escalations/:uid     the decision, and the push that carries it
 *   POST  /api/admin/escalations/:uid/resend   send the stored decision again (D243)
 *
 * WHY THE ANSWER AND THE PUSH ARE TWO FACTS. HQ deciding and the branch
 * receiving are different events, and a route that reported them as one would
 * make an unreachable branch look like a decision that never happened — so an
 * operator would enter it again. The decision is stored unconditionally; the
 * push result rides beside it in `pushed`. HQ stores the latest attempt's
 * outcome, reason and time on that decision (migration 288). A resend keeps
 * its original text, status, author and decision time. HQ-tier requests use
 * the raiser's local bell instead and have no branch push.
 *
 * WHY THIS IS NOT IN `admin_hq.ts`. That endpoint builds H1's payload — one
 * read, computed per request, storing nothing. These are writes across a tier
 * boundary. The same separation D111 made for statements, for the same reason.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireSuperAdmin } from '../auth';
import { mapError } from './_t13t14t15_helpers';
import {
  answerEscalation, listEscalations, licenceKindsByCode, escalationKindsFor, type EscalationAnswer,
  ESCALATION_KINDS, ESCALATION_STATUSES, HQ_TIER_CODE,
} from '../rpc/hqOps';
import { withRequestView, isProgramRequestKind } from '../services/escalationRequests';
import { notifyRequestAnswer, type AnswerNotice } from '../services/escalationAnswerNotice';
import { branchByCode } from '../services/branches';
import { mirrorBranchAction } from '../services/auditMirror';

const r = new Hono<{ Bindings: Env }>();

const str = (v: unknown, max = 500): string => String(v ?? '').trim().slice(0, max);

type Pushed = { ok: boolean | null; reason?: string };

/**
 * Send a decision that is already stored. The payload is the caller's; this
 * does not read a new answer off a request (D243).
 */
export async function deliverAnswer(
  env: Env, branchCode: string, answer: Omit<EscalationAnswer, 'pushed_at' | 'answered_at'> & { answered_at: string | null },
): Promise<Pushed & { push_at: string }> {
  let pushed: Pushed = {
    ok: false,
    reason: `No branch Worker is bound for ${branchCode}, so the decision is recorded `
      + 'at HQ and was not sent.',
  };
  const binding = branchByCode(env, branchCode);
  if (binding) {
    try {
      const res = await (binding.stub as any).applyEscalationAnswer({
        ...answer,
        pushed_at: new Date().toISOString(),
      });
      pushed = typeof res?.ok === 'boolean'
        ? { ok: res.ok, ...(typeof res.reason === 'string' ? { reason: res.reason } : {}) }
        : { ok: null, reason: 'The branch returned no delivery acknowledgement.' };
    } catch (e) {
      const detail = e instanceof Error ? e.message : '';
      pushed = { ok: null, reason: detail ? `The branch did not confirm receipt: ${detail}` : 'The branch did not confirm receipt.' };
    }
  }
  // A replacement decision clears its delivery fields. A late reply to the
  // previous decision may describe that attempt, but cannot mark the new one.
  const pushAt = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE hq_escalations SET push_ok = ?, push_reason = ?, push_at = ?, updated_at = ?
      WHERE uid = ? AND answered_at IS ? AND answer = ? AND status = ?
        AND COALESCE(NULLIF(answered_by_name, ''), 'Axal VC HQ') = ?`,
  ).bind(
    pushed.ok === null ? null : Number(pushed.ok),
    pushed.ok ? null : (pushed.reason || null),
    pushAt, pushAt,
    answer.hq_uid, answer.answered_at, answer.answer, answer.status, answer.answered_by_name || 'Axal VC HQ',
  ).run();
  mirrorBranchAction(
    env,
    'escalation_answered',
    !binding ? 'not_deployed' : (pushed.ok ? 'ok' : 'failed'),
    branchCode,
  );
  return { ...pushed, push_at: pushAt };
}

/**
 * D799 — an HQ-tier request has no branch to push to: its raiser is an HQ
 * user, told in the bell. The row's raiser id is read here rather than taken
 * from the caller, so the notice reaches whoever raised it and nobody else.
 */
export async function noticeHqTier(env: Env, uid: string): Promise<AnswerNotice> {
  const row = await env.DB.prepare(
    `SELECT uid, kind, subject, status, answer, raised_by_branch_user_id AS raised_by_user_id
       FROM hq_escalations WHERE uid = ? AND branch_code = ?`,
  ).bind(uid, HQ_TIER_CODE).first<{
    uid: string; kind: string; subject: string; status: string; answer: string | null; raised_by_user_id: number | null;
  }>();
  if (!row) return { ok: false, reason: 'The request is not on HQ\'s tier.' };
  return notifyRequestAnswer(env, row);
}

// GET /api/admin/escalations?status=&kind=
r.get('/escalations', async (c) => {
  try {
    await requireSuperAdmin(c);
    const status = str(c.req.query('status'), 20).toLowerCase();
    const kind = str(c.req.query('kind'), 20).toLowerCase();

    if (status && !(ESCALATION_STATUSES as readonly string[]).includes(status)) {
      return c.json({ error: 'bad_status', message: `status must be one of ${ESCALATION_STATUSES.join(', ')}` }, 400);
    }
    if (kind && !(ESCALATION_KINDS as readonly string[]).includes(kind)) {
      return c.json({ error: 'bad_kind', message: `kind must be one of ${ESCALATION_KINDS.join(', ')}` }, 400);
    }

    let items: Array<Record<string, unknown>> = [];
    let complete = true;
    let available = true;
    try {
      const listed = await listEscalations(c.env, { status, kind, limit: 100 });
      // D799 — a request's fields read out of `detail`, beside it.
      items = listed.items.map(withRequestView);
      complete = listed.complete;
    } catch { available = false; }

    // D267 — WAS THIS ROW ONE THE KIND GATE SHOULD HAVE REFUSED? D206 refuses a
    // white-label's `content` escalation at both ends, so such a row here can
    // only be a gate regression, a row inserted by hand, or one older than
    // D206 — and until now nothing on the lane would show it.
    //
    // ITS OWN TRY, AFTER THE LIST'S. The kind is a second read of a second
    // store; if it fails, the lane still answers and says its rows were not
    // checked, rather than a ledger fault blanking every submission.
    //
    // THE RULE IS REUSED, NOT RESTATED: a row is flagged when
    // `escalationKindsFor` hides ITS kind under its branch's licence kind, so
    // a white-label's moderation row is not flagged, and a kind the ledger
    // cannot name (an orphan deployment, a code with none) hides nothing.
    // `kind_gate_failed` is null when nothing was checked — not checked is not
    // "passed".
    let kindsAvailable = false;
    if (available) {
      let kinds: Map<string, string | null> | null = null;
      try {
        kinds = await licenceKindsByCode(c.env);
        kindsAvailable = true;
      } catch { kinds = null; }
      items = items.map((it) => {
        if (!kinds) return { ...it, licence_kind: null, kind_gate_failed: null };
        const licenceKind = kinds.get(String(it.branch_code ?? '')) ?? null;
        const hidden = escalationKindsFor(licenceKind).hidden;
        return {
          ...it,
          licence_kind: licenceKind,
          kind_gate_failed: hidden.some((h) => h.kind === it.kind),
        };
      });
    }

    return c.json({
      available,
      ...(available ? {} : {
        reason: 'The hq_escalations table could not be read on this database (migration 259).',
      }),
      items,
      ...(available ? { complete } : {}),
      ...(available ? {
        licence_kinds_available: kindsAvailable,
        ...(kindsAvailable ? {} : {
          licence_kinds_reason:
            'The licence ledger could not be read on this database (migrations 258 and 279), so no '
            + 'row here was checked against the kind of licence its branch runs under.',
        }),
      } : {}),
      kinds: ESCALATION_KINDS,
      statuses: ESCALATION_STATUSES,
    });
  } catch (e) { return mapError(c, e); }
});

// PATCH /api/admin/escalations/:uid  { answer, status? }
r.patch('/escalations/:uid', async (c) => {
  try {
    const admin = await requireSuperAdmin(c);
    const uid = str(c.req.param('uid'), 80);
    const b = await c.req.json().catch(() => ({} as any));

    // D983 — A PROGRAM REQUEST IS ANSWERED ON PROGRAM GRANTS, behind the
    // write bar and with a reason the licence's history keeps
    // (`routes/admin_program_requests.ts`). Answering it here would skip both.
    const kindRow = await c.env.DB.prepare('SELECT kind FROM hq_escalations WHERE uid = ?')
      .bind(uid).first<{ kind: string }>();
    if (kindRow && isProgramRequestKind(kindRow.kind)) {
      return c.json({
        error: 'answer_on_program_grants',
        message: 'A program request is answered on Program grants, under Requests. It needs your authenticator code and a reason.',
      }, 409);
    }

    let decided;
    try {
      decided = await answerEscalation(c.env, uid, {
        answer: str(b?.answer, 4000),
        status: str(b?.status, 20) || 'answered',
        answered_by_user_id: admin.id,
        // The NAME, because the branch cannot resolve an HQ user id — the two
        // id spaces collide (D104), so an id sent across would name whoever
        // happens to hold it there.
        answered_by_name: str((admin as { name?: string }).name, 200) || 'Axal VC HQ',
      });
    } catch (e) {
      const msg = String((e as Error).message || '');
      if (/is not an escalation/.test(msg)) return c.json({ error: 'not_found' }, 404);
      if (/a decision needs its reason/.test(msg)) {
        return c.json({ error: 'answer_required', message: msg }, 400);
      }
      if (/status must be one of|cannot stay open/.test(msg)) {
        return c.json({ error: 'bad_status', message: msg }, 400);
      }
      throw e;
    }

    // THE PUSH IS REPORTED, NEVER THROWN. See the header.
    //
    // D205 — THE REASON SAYS WHAT HAPPENED, NOT WHAT MIGHT. It used to end "and
    // will reach the branch when a binding exists". D243 stores the outcome and
    // a person can send the stored decision again; nothing sends it on its own.
    // The branch answers `{ok:false, reason}` when it holds no row for this
    // uid — a real state, not an exception.
    //
    // D799 — AN HQ-TIER REQUEST IS TOLD IN THE BELL, NOT PUSHED. Its raiser is
    // an HQ user on this database, so there is no branch Worker to call, and
    // `notified` says whether the notice was written.
    if (decided.row.branch_code === HQ_TIER_CODE) {
      const notified = await noticeHqTier(c.env, decided.row.uid);
      return c.json({ ...withRequestView(decided.row), notified });
    }
    const pushed = await deliverAnswer(c.env, decided.row.branch_code, decided.answer);

    return c.json({ ...withRequestView(decided.row), pushed });
  } catch (e) { return mapError(c, e); }
});

// POST /api/admin/escalations/:uid/resend
// The stored decision, again. The body is not an answer: a new decision is the
// PATCH, and this route must not become a second way to write one (D243).
r.post('/escalations/:uid/resend', async (c) => {
  try {
    await requireSuperAdmin(c);
    const uid = str(c.req.param('uid'), 80);
    const row = await c.env.DB.prepare(
      `SELECT uid, branch_code, kind, subject, status, answer, answered_by_name, answered_at
         FROM hq_escalations WHERE uid = ?`,
    ).bind(uid).first<{
      uid: string; branch_code: string; kind: string; subject: string; status: string;
      answer: string | null; answered_by_name: string | null; answered_at: string | null;
    }>();
    if (!row) return c.json({ error: 'not_found' }, 404);
    if (!row.answer || (row.status !== 'answered' && row.status !== 'declined')) {
      return c.json({
        error: 'no_decision',
        message: 'There is no stored decision to send again. Record one first.',
      }, 400);
    }
    // D799 — on HQ's tier, "send again" is the bell notice again.
    if (row.branch_code === HQ_TIER_CODE) {
      return c.json({ ...row, notified: await noticeHqTier(c.env, row.uid) });
    }
    const pushed = await deliverAnswer(c.env, row.branch_code, {
      hq_uid: row.uid,
      answer: row.answer,
      answered_by_name: row.answered_by_name || 'Axal VC HQ',
      answered_at: row.answered_at,
      status: row.status,
    });
    return c.json({ ...row, pushed });
  } catch (e) { return mapError(c, e); }
});

export default r;
