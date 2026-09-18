/**
 * The branch's "To HQ" lane (S3, D112).
 *
 *   GET  /api/branch/escalations   what this branch raised, and HQ's answers
 *   POST /api/branch/escalations   raise one
 *
 * NOT GATED ON SUSPENSION, AND THIS IS THE IMPORTANT ONE. Every other write on
 * a suspended branch answers 423 through `requireBranchNotSuspended` (D107) —
 * but the frozen-branch banner's stated appeal path *is* an escalation.
 *
 * D142 — that sentence used to credit PR 5 with shipping that banner. PR 5 did
 * not: the branch 423 carried no machine-readable `code` until D142, so nothing
 * client-side could key a banner on it, and `423` appeared nowhere in
 * `frontend/src` at all. The banner exists now (`components/BranchSuspendedBar`
 * and the Locked list on `/admin/my-licence`), which is what makes the rest of
 * this paragraph true rather than aspirational. Gating this route would lock the one door out of the freeze, and
 * it would do it silently: the banner would keep telling a branch admin to
 * appeal, and the appeal button would keep answering 423. So a suspended
 * branch can still raise, and the lane says its licence is suspended rather
 * than refusing.
 *
 * THE LOCAL ROW IS WRITTEN EVEN WHEN HQ CANNOT BE REACHED. A raise that could
 * not be delivered is still a thing a person did; dropping it because the
 * binding was down would lose work and teach people to distrust the button.
 * It is stored `undelivered` with the reason and can be retried. It is NOT
 * counted as an escalation HQ has — `hq_uid` is null, and every surface keys
 * off that rather than off the row existing.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { requireBranchTier } from '../util/branch';
import { mapError, nowIso } from './_t13t14t15_helpers';
import { branchEscalations } from '../rpc/branchOps';
import { ESCALATION_KINDS } from '../rpc/hqOps';

const r = new Hono<{ Bindings: Env }>();

const str = (v: unknown, max = 500): string => String(v ?? '').trim().slice(0, max);

// GET /api/branch/escalations
r.get('/escalations', async (c) => {
  try {
    await requireAdmin(c);
    requireBranchTier(c.env);

    let payload: unknown = null;
    let available = true;
    try {
      payload = await branchEscalations(c.env, 100);
    } catch { available = false; }

    return c.json({
      available,
      ...(available ? (payload as object) : {
        reason: 'The branch_escalations table could not be read on this branch (migration 261).',
      }),
      kinds: ESCALATION_KINDS,
      // SAID ON THE PAYLOAD, not left for each screen to remember: the answer
      // is one decision, so a surface must not draw a reply box.
      answer_shape: 'single_decision',
      answer_note:
        'HQ returns one decision with who made it and when. There is no reply thread — a message '
        + 'store does not exist, and a reply box here would write nowhere.',
    });
  } catch (e) { return mapError(c, e); }
});

// POST /api/branch/escalations  { kind, subject, subject_ref?, detail? }
r.post('/escalations', async (c) => {
  try {
    const admin = await requireAdmin(c);
    // The code is CAPTURED rather than re-derived below. `branchOf(c.env)!`
    // used to sit inside the HQ call with a non-null assertion whose only
    // justification was this gate five lines earlier — the assertion and the
    // check being in two places is how one of them survives the other's
    // deletion. `requireBranchTier` already returns the thing the assertion
    // was asserting.
    const code = requireBranchTier(c.env);

    const b = await c.req.json().catch(() => ({} as any));
    const kind = str(b?.kind, 20).toLowerCase();
    if (!(ESCALATION_KINDS as readonly string[]).includes(kind)) {
      return c.json({
        error: 'bad_kind',
        message: `kind must be one of ${ESCALATION_KINDS.join(', ')}. These are the four things a `
          + 'branch cannot decide for itself; a fifth is a product decision, not a new value.',
      }, 400);
    }
    const subject = str(b?.subject, 300);
    if (!subject) {
      return c.json({
        error: 'subject_required',
        message: 'An escalation needs a subject. It lands on a queue somebody else reads.',
      }, 400);
    }
    const subjectRef = str(b?.subject_ref, 300) || null;
    const detail = str(b?.detail, 4000) || null;
    const raisedBy = str((admin as { name?: string }).name, 200) || null;
    const now = nowIso();

    // HQ FIRST, so a successful raise carries HQ's own uid from the start and
    // the two rows are the same escalation. The local row is written either
    // way, which is the reason this order is safe: nothing is lost if the call
    // throws.
    let hqUid: string | null = null;
    let dueAt: string | null = null;
    let deliveryError: string | null = null;
    const hq = (c.env as { HQ?: { escalate?: (code: string, item: unknown) => Promise<unknown> } }).HQ;
    if (!hq || typeof hq.escalate !== 'function') {
      deliveryError =
        'This Worker has no HQ service binding, so the escalation is recorded here and has not '
        + 'reached HQ. A branch config generated by scripts/gen-branch-wrangler.mjs carries one.';
    } else {
      try {
        const res = await hq.escalate(code, {
          kind, subject, subject_ref: subjectRef, detail,
          raised_by_name: raisedBy, raised_by_branch_user_id: admin.id,
        }) as { uid?: string; due_at?: string };
        hqUid = str(res?.uid, 80) || null;
        dueAt = str(res?.due_at, 40) || null;
        if (!hqUid) deliveryError = 'HQ accepted the call but returned no escalation id.';
      } catch (e) {
        deliveryError = `HQ did not accept the escalation: ${(e as Error).message}`;
      }
    }

    const res = await c.env.DB.prepare(
      `INSERT INTO branch_escalations
         (hq_uid, kind, subject, subject_ref, detail, raised_by_user_id, raised_by_name,
          status, delivery_error, due_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      hqUid, kind, subject, subjectRef, detail, admin.id, raisedBy,
      hqUid ? 'open' : 'undelivered', deliveryError, dueAt, now, now,
    ).run();

    return c.json({
      id: Number((res as { meta?: { last_row_id?: number } })?.meta?.last_row_id ?? 0),
      hq_uid: hqUid,
      kind,
      subject,
      due_at: dueAt,
      status: hqUid ? 'open' : 'undelivered',
      ...(deliveryError ? { delivery_error: deliveryError } : {}),
    }, 201);
  } catch (e) { return mapError(c, e); }
});

export default r;
