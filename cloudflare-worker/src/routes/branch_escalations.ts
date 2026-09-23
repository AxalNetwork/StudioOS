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
 *
 * D206 — A KIND THE LICENCE HIDES IS REFUSED AT BOTH ENDS, AND NEITHER WRITES A
 * ROW. A white-label's admins have no HQ brand desk, so `content` is a kind
 * they could raise and nobody could answer (canvas H30). This route refuses it
 * before calling HQ, from the branch's own licence copy; HQ refuses it again
 * from its ledger, because a copy can be stale or missing. Either refusal is a
 * 400 with the reason — never an `undelivered` row, which is what a throw from
 * HQ becomes, and which reads as retryable. A refusal is a decision; sending it
 * again would be refused again.
 *
 * D208 — A CONTENT ESCALATION NAMES WHAT IT CONCERNS, IN THE BRANCH'S OWN
 * WORDS. The GET carries `concerns`: every item a content raise can name — HQ's
 * template library as pushed here, and this branch's own articles — each with
 * the label `services/escalationConcerns.ts` builds. The POST takes a pick as
 * `concerns: { type, id }`, reads that row again, and sends its label as
 * `subject_ref`: to HQ, to the local row, and back in the 201. The label is a
 * name, not a link — HQ cannot open this database — and the payload says so.
 * A content raise names its item only by picking it: a typed `subject_ref` is
 * refused, so there is one label format, not the list's and a typed one. Every
 * other kind keeps the free-text passthrough migration 259 gave it. Naming is
 * optional, and all of it happens before HQ is called, so a pick that no longer
 * resolves sends nothing and stores nothing.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { requireBranchTier } from '../util/branch';
import { mapError, nowIso } from './_t13t14t15_helpers';
import { branchEscalations, branchLicenceKind } from '../rpc/branchOps';
import { ESCALATION_KINDS, escalationKindsFor } from '../rpc/hqOps';
import {
  CONCERN_KIND, BAD_CONCERN, listConcerns, parseConcern, resolveConcern,
} from '../services/escalationConcerns';

const r = new Hono<{ Bindings: Env }>();

const str = (v: unknown, max = 500): string => String(v ?? '').trim().slice(0, max);

/**
 * What `HQ.escalate` answers: the recorded escalation, or HQ's refusal of its
 * kind (D206). Typed as optional fields because it crosses a service binding
 * and is read defensively, like every answer from another Worker.
 */
type HqEscalateAnswer = {
  uid?: string;
  due_at?: string;
  refused?: string;
  reason?: string;
  licence_kind?: string | null;
};

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

    // D206 — which kinds this licence offers. `kinds` stays the whole
    // vocabulary, because it is what a raise is validated against; the three
    // fields beside it say which of those this branch can use, and why not.
    const gate = escalationKindsFor(await branchLicenceKind(c.env));

    // D208 — what a content escalation can name. OUTSIDE the lane's own try,
    // and it cannot throw: each source answers for itself, so a branch that
    // cannot read its templates or its articles still reads its lane, and the
    // lane's `available` stays about the lane.
    const concerns = await listConcerns(c.env);

    return c.json({
      available,
      ...(available ? (payload as object) : {
        reason: 'The branch_escalations table could not be read on this branch (migration 261).',
      }),
      kinds: ESCALATION_KINDS,
      licence_kind: gate.licence_kind,
      // Whether the copy named a kind the rule knows. Sent rather than left
      // for the page to infer from `licence_kind`, because an unrecognised
      // string is carried through as itself and would read as known.
      licence_kind_known: gate.known,
      kinds_available: gate.available,
      kinds_hidden: gate.hidden,
      kind_basis: gate.known
        ? 'Read from the licence copy HQ pushed to this branch.'
        : 'This branch\'s licence copy does not say which kind of licence it runs under, so every '
          + 'kind is offered here and HQ, which holds the licence, decides.',
      concerns,
      // SAID ON THE PAYLOAD, not left for each screen to remember: the answer
      // is one decision, so a surface must not draw a reply box.
      answer_shape: 'single_decision',
      answer_note:
        'HQ returns one decision with who made it and when. There is no reply thread — a message '
        + 'store does not exist, and a reply box here would write nowhere.',
    });
  } catch (e) { return mapError(c, e); }
});

// POST /api/branch/escalations  { kind, subject, subject_ref?, concerns?, detail? }
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
    // D206 — THE LOCAL GATE, BEFORE HQ IS CALLED. A kind this licence hides
    // is refused here, with nothing sent and nothing stored.
    const gate = escalationKindsFor(await branchLicenceKind(c.env));
    const hiddenHere = gate.hidden.find((h) => h.kind === kind);
    if (hiddenHere) {
      return c.json({
        error: 'kind_not_available',
        message: hiddenHere.reason,
        kind,
        licence_kind: gate.licence_kind,
      }, 400);
    }

    // D208 — WHAT THIS ESCALATION CONCERNS, settled before HQ is called.
    //
    // CONTENT NAMES ITS ITEM ONLY BY PICKING IT. The label is built from the
    // row this branch holds, by the one function that also built the list the
    // drawer showed, so the words picked are the words HQ reads. A typed
    // `subject_ref` on content is REFUSED rather than ignored: a field dropped
    // in silence reads as stored, and a typed label would be a second format
    // beside the listed one. Every other kind keeps the free-text passthrough.
    //
    // A PICK THAT NO LONGER RESOLVES SENDS NOTHING AND STORES NOTHING — the
    // D206 rule for a refusal, applied to a lookup. An unreadable source is a
    // 503, because it says nothing about the item; a missing row is a 400.
    const typedRef = str(b?.subject_ref, 300);
    const namesItem = b?.concerns !== undefined && b?.concerns !== null;
    let subjectRef: string | null;
    if (kind === CONCERN_KIND) {
      if (typedRef) {
        return c.json({
          error: 'subject_ref_not_accepted',
          message: 'A content escalation names its item by picking it from the list, so the label is '
            + 'the one this branch holds. Pick the item, or put what it concerns in the subject.',
        }, 400);
      }
      if (namesItem) {
        const parsed = parseConcern(b.concerns);
        if (!parsed) return c.json({ error: 'bad_concern', message: BAD_CONCERN }, 400);
        const resolved = await resolveConcern(c.env, parsed);
        if (!resolved.ok) {
          return c.json(
            { error: resolved.error, message: resolved.message },
            resolved.error === 'concerns_unreadable' ? 503 : 400,
          );
        }
        subjectRef = resolved.label;
      } else {
        subjectRef = null;
      }
    } else {
      if (namesItem) {
        return c.json({
          error: 'concerns_not_for_kind',
          message: 'Only a content escalation names an item from the list. Describe what this '
            + 'concerns in the subject instead.',
          kind,
        }, 400);
      }
      subjectRef = typedRef || null;
    }

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
      let res: HqEscalateAnswer | null = null;
      try {
        res = await hq.escalate(code, {
          kind, subject, subject_ref: subjectRef, detail,
          raised_by_name: raisedBy, raised_by_branch_user_id: admin.id,
        }) as HqEscalateAnswer | null;
      } catch (e) {
        deliveryError = `HQ did not accept the escalation: ${(e as Error).message}`;
      }
      // D206 — HQ REFUSED THE KIND, FROM ITS OWN LEDGER. Same answer as the
      // local gate and the same rule for the row: none. HQ recorded nothing, and
      // an `undelivered` row here would invite a retry HQ would refuse again.
      if (res && res.refused === 'kind_not_available') {
        return c.json({
          error: 'kind_not_available',
          message: str(res.reason, 300) || 'HQ does not take this kind of escalation from this branch.',
          kind,
          licence_kind: res.licence_kind ?? null,
        }, 400);
      }
      if (!deliveryError) {
        hqUid = str(res?.uid, 80) || null;
        dueAt = str(res?.due_at, 40) || null;
        if (!hqUid) deliveryError = 'HQ accepted the call but returned no escalation id.';
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
      subject_ref: subjectRef,
      due_at: dueAt,
      status: hqUid ? 'open' : 'undelivered',
      ...(deliveryError ? { delivery_error: deliveryError } : {}),
    }, 201);
  } catch (e) { return mapError(c, e); }
});

export default r;
