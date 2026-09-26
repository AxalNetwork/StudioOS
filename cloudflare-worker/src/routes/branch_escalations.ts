/**
 * The branch's "To HQ" lane (S3, D112).
 *
 *   GET  /api/branch/escalations          what this branch raised, and HQ's answers
 *   POST /api/branch/escalations          raise one
 *   POST /api/branch/escalations/:id/retry   send an undelivered row again (D243)
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
 *
 * D275 — A PICK SAYS WHAT THE SUBMISSION IS TO IT. The coordinator's decision:
 * "A content escalation that names an item records an explicit relation,
 * `localises` or `changes`, and the relation is required whenever an item is
 * picked." The POST takes it as `relation`, a TOP-LEVEL sibling of `concerns`
 * and never inside it: the concern says which item, the relation says what the
 * submission is to it. It is validated after the pick resolves and before HQ
 * is called — required with a pick, one of the two values, refused with no
 * pick and on any other kind — and each refusal is a 400 that sends nothing
 * and stores nothing. The resolved relation is stored on the local row, sent
 * to HQ, and re-sent exactly by the retry.
 *
 * D275 — EVERY HQ REFUSAL IS A REFUSAL. The POST and the retry used to
 * recognise only `kind_not_available`, so any other code HQ returned read as
 * a delivery with no uid. Any `refused` now reaches the branch as a 400 with
 * no row (POST), or leaves the row undelivered with HQ's reason (retry).
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
  parseRelation, RELATION_REQUIRED, BAD_RELATION, RELATION_NEEDS_ITEM, RELATION_NOT_FOR_KIND,
} from '../services/escalationConcerns';
import { rawText, refusalBody } from '../util/refusal';

/**
 * D278 — HQ'S OWN REFUSAL IN HQ'S WORDS; A TRANSPORT FAILURE IN OURS.
 * `rpc/hqOps.ts` writes every refusal it throws as `escalate: …` or `rpc: …`.
 * Anything else reaching the catch is the transport, not HQ: its text goes to
 * the log and the stored `delivery_error` says only that HQ was not reached.
 */
function hqWords(e: unknown): string {
  const text = rawText(e);
  const m = /^(?:escalate|rpc): ([\s\S]*)$/.exec(text);
  if (m) return m[1].slice(0, 400);
  refusalBody({ code: 'hq_unreachable', message: '', raw: e });
  return 'HQ could not be reached. Send it again.';
}


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

/**
 * The sentence for an HQ refusal that came back without one. The kind's own
 * sentence is kept for the kind's refusal (the drawer's fallback quotes it);
 * any other code — D275's relation refusals, or one this build does not know —
 * gets the general one, which still says nothing was recorded.
 */
function hqRefusalFallback(code: string): string {
  return code === 'kind_not_available'
    ? 'HQ does not take this kind of escalation from this branch.'
    : 'HQ refused this escalation and recorded nothing.';
}

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

// POST /api/branch/escalations  { kind, subject, subject_ref?, concerns?, relation?, detail? }
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

    // D275 — WHAT THE SUBMISSION IS TO THE ITEM IT NAMES, settled after the
    // pick resolves and before HQ is called. Required with a pick; refused
    // without one and on every other kind. `parseRelation` answers undefined
    // for "none sent" and null for "sent, and not one of the two".
    const relationIn = parseRelation(b?.relation);
    if (relationIn === null) {
      return c.json({ error: 'bad_relation', message: BAD_RELATION }, 400);
    }
    if (kind !== CONCERN_KIND && relationIn !== undefined) {
      return c.json({ error: 'relation_not_for_kind', message: RELATION_NOT_FOR_KIND, kind }, 400);
    }
    if (kind === CONCERN_KIND && namesItem && relationIn === undefined) {
      return c.json({ error: 'relation_required', message: RELATION_REQUIRED }, 400);
    }
    if (kind === CONCERN_KIND && !namesItem && relationIn !== undefined) {
      return c.json({ error: 'relation_needs_item', message: RELATION_NEEDS_ITEM }, 400);
    }
    const relation = relationIn ?? null;

    const detail = str(b?.detail, 4000) || null;
    const raisedBy = str((admin as { name?: string }).name, 200) || null;
    const now = nowIso();
    // D243 — BEFORE THE CALL, so a lost response retries as the same raise.
    const raiseKey = crypto.randomUUID();

    // HQ FIRST, so a successful raise carries HQ's own uid from the start and
    // the two rows are the same escalation. The local row is written either
    // way, which is the reason this order is safe: nothing is lost if the call
    // throws. The key is on that row either way.
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
          kind, subject, subject_ref: subjectRef, relation, detail,
          raised_by_name: raisedBy, raised_by_branch_user_id: admin.id,
          raise_key: raiseKey,
        }) as HqEscalateAnswer | null;
      } catch (e) {
        deliveryError = `HQ did not accept the escalation: ${hqWords(e)}`;
      }
      // D206 — HQ REFUSED, FROM ITS OWN LEDGER OR ITS OWN CHECKS. Same answer as
      // a local refusal and the same rule for the row: none. HQ recorded
      // nothing, and an `undelivered` row here would invite a retry HQ would
      // refuse again. D275 — ANY refusal code, not only the kind's: a code this
      // build does not know is still HQ saying no.
      const refused = res ? str(res.refused, 60) : '';
      if (refused) {
        return c.json({
          error: refused,
          message: str(res?.reason, 300) || hqRefusalFallback(refused),
          kind,
          ...(refused === 'kind_not_available' ? { licence_kind: res?.licence_kind ?? null } : {}),
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
         (hq_uid, kind, subject, subject_ref, relation, detail, raised_by_user_id, raised_by_name,
          status, delivery_error, due_at, created_at, updated_at, raise_key)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      hqUid, kind, subject, subjectRef, relation, detail, admin.id, raisedBy,
      hqUid ? 'open' : 'undelivered', deliveryError, dueAt, now, now, raiseKey,
    ).run();

    return c.json({
      id: Number((res as { meta?: { last_row_id?: number } })?.meta?.last_row_id ?? 0),
      hq_uid: hqUid,
      kind,
      subject,
      subject_ref: subjectRef,
      relation,
      due_at: dueAt,
      status: hqUid ? 'open' : 'undelivered',
      ...(deliveryError ? { delivery_error: deliveryError } : {}),
    }, 201);
  } catch (e) { return mapError(c, e); }
});

// POST /api/branch/escalations/:id/retry
// An undelivered row, again, with the key it already holds. Not suspension
// gated: escalating is how a frozen branch gets out (D107, D112). The body is
// not a new raise — the stored row is what is sent.
r.post('/escalations/:id/retry', async (c) => {
  try {
    await requireAdmin(c);
    const code = requireBranchTier(c.env);
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id < 1) {
      return c.json({ error: 'bad_id', message: 'An escalation id is required.' }, 400);
    }
    const row = await c.env.DB.prepare(
      `SELECT id, kind, subject, subject_ref, relation, detail, raised_by_user_id, raised_by_name,
              status, raise_key
         FROM branch_escalations WHERE id = ?`,
    ).bind(id).first<{
      id: number; kind: string; subject: string; subject_ref: string | null; relation: string | null;
      detail: string | null; raised_by_user_id: number | null; raised_by_name: string | null;
      status: string; raise_key: string | null;
    }>();
    if (!row) return c.json({ error: 'not_found' }, 404);
    if (row.status !== 'undelivered') {
      return c.json({
        error: 'not_undelivered',
        message: 'Only a raise that has not reached HQ can be sent again.',
      }, 409);
    }
    let raiseKey = row.raise_key;
    if (!raiseKey) {
      raiseKey = crypto.randomUUID();
      await c.env.DB.prepare(
        `UPDATE branch_escalations SET raise_key = ?, updated_at = ? WHERE id = ? AND raise_key IS NULL`,
      ).bind(raiseKey, nowIso(), id).run();
    }
    const hq = (c.env as { HQ?: { escalate?: (code: string, item: unknown) => Promise<unknown> } }).HQ;
    let deliveryError: string | null = null;
    let res: HqEscalateAnswer | null = null;
    if (!hq || typeof hq.escalate !== 'function') {
      deliveryError =
        'This Worker has no HQ service binding, so the escalation is recorded here and has not reached HQ.';
    } else {
      try {
        res = await hq.escalate(code, {
          kind: row.kind,
          subject: row.subject,
          subject_ref: row.subject_ref,
          // D275 — the stored relation, exactly: NULL on a row raised before
          // migration 296, which HQ records as not recorded.
          relation: row.relation,
          detail: row.detail,
          raised_by_name: row.raised_by_name,
          raised_by_branch_user_id: row.raised_by_user_id,
          raise_key: raiseKey,
        }) as HqEscalateAnswer | null;
      } catch (e) {
        deliveryError = `HQ did not accept the escalation: ${hqWords(e)}`;
      }
      // D275 — ANY refusal leaves the row undelivered WITH HQ's reason, so the
      // lane says why rather than showing the last transport error.
      const refused = res ? str(res.refused, 60) : '';
      if (refused) {
        const reason = str(res?.reason, 300) || hqRefusalFallback(refused);
        await c.env.DB.prepare(
          `UPDATE branch_escalations SET delivery_error = ?, updated_at = ? WHERE id = ? AND status = 'undelivered'`,
        ).bind(`HQ refused it: ${reason}`, nowIso(), id).run();
        return c.json({
          error: refused,
          message: reason,
          kind: row.kind,
          id,
          status: 'undelivered',
        }, 400);
      }
      if (!deliveryError) {
        const hqUid = str(res?.uid, 80) || null;
        if (!hqUid) deliveryError = 'HQ accepted the call but returned no escalation id.';
        else {
          const dueAt = str(res?.due_at, 40) || null;
          const now = nowIso();
          await c.env.DB.prepare(
            `UPDATE branch_escalations
                SET hq_uid = ?, status = 'open', delivery_error = NULL, due_at = ?, updated_at = ?
              WHERE id = ? AND status = 'undelivered'`,
          ).bind(hqUid, dueAt, now, id).run();
          return c.json({ id, hq_uid: hqUid, status: 'open', due_at: dueAt });
        }
      }
    }
    await c.env.DB.prepare(
      `UPDATE branch_escalations SET delivery_error = ?, updated_at = ? WHERE id = ? AND status = 'undelivered'`,
    ).bind(deliveryError, nowIso(), id).run();
    return c.json({
      error: 'undelivered',
      message: deliveryError,
      id,
      status: 'undelivered',
      delivery_error: deliveryError,
    }, 502);
  } catch (e) { return mapError(c, e); }
});

export default r;
