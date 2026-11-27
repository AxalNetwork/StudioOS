/**
 * D4811 (#4811) part 6 — the high-risk governance moves (boards CT-12, CT-16,
 * CT-92 "High-risk actions" and "Execution evidence"): marking a record
 * executed and archiving it. Pure: the route (`routes/admin_governance.ts`,
 * `PATCH /documents/:uid`) reads the rows, and this file says whether the
 * request may go ahead.
 *
 * WHAT A HIGH-RISK MOVE NEEDS, checked on the server, never only on the page:
 *   - a reason, 10 to 500 characters, kept in the audit row;
 *   - the typed confirmation word, EXECUTED or ARCHIVE;
 *   - a recent step-up (`requireStepUp`, the route's job), so a session
 *     that only signed in long ago cannot do it;
 *   - for executed, the evidence chosen explicitly (CT-12): a version of this
 *     record uploaded as the signed copy, or the completed envelope it links.
 *     The server no longer picks one, and a version that is not a signed
 *     copy, or an envelope that has not completed, is refused by name.
 */

export const HIGH_RISK_MOVES = Object.freeze({ executed: 'EXECUTED', archived: 'ARCHIVE' } as const);
export type HighRiskMove = keyof typeof HIGH_RISK_MOVES;
export const REASON_MIN = 10;
export const REASON_MAX = 500;

export const isHighRisk = (to: unknown): to is HighRiskMove => to === 'executed' || to === 'archived';

type Refusal = { status: 409 | 422; code: string; message: string };

/** The reason and confirmation a high-risk move carries, or the refusal. */
export function confirmationOf(to: HighRiskMove, body: any): { ok: true; reason: string } | { ok: false; refusal: Refusal } {
  return confirmationFor(HIGH_RISK_MOVES[to], body);
}

/**
 * D4811 part 13: the same check for any high-risk action named by its typed
 * word (template publication is PUBLISH, CT-16): a reason of 10 to 500
 * characters and the exact word.
 */
export function confirmationFor(word: string, body: any): { ok: true; reason: string } | { ok: false; refusal: Refusal } {
  const reason = typeof body?.reason === 'string' ? body.reason.trim().replace(/\s+/g, ' ') : '';
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) {
    return { ok: false, refusal: { status: 422, code: 'reason_required', message: `Say why, in ${REASON_MIN} to ${REASON_MAX} characters. It is kept with the record's history. Nothing was saved.` } };
  }
  if (body?.confirm !== word) {
    return { ok: false, refusal: { status: 422, code: 'confirmation_required', message: `Type ${word} to confirm. Nothing was saved.` } };
  }
  return { ok: true, reason };
}

export type EvidenceVersion = { version: number; signed: number | boolean };
export type ChosenEvidence = { version: number; envelope: null } | { version: null; envelope: number };

/**
 * The execution evidence the admin chose (CT-12), checked against what the
 * record holds. `envelopeCompleted` is whether the linked envelope (the one
 * the request links, or the one already linked) has completed.
 */
export function evidenceOf(raw: any, versions: readonly EvidenceVersion[], envelopeId: number | null, envelopeCompleted: boolean): { ok: true; evidence: ChosenEvidence } | { ok: false; refusal: Refusal } {
  if (raw?.kind === 'version') {
    const n = Number(raw.version);
    const v = Number.isSafeInteger(n) ? versions.find((x) => Number(x.version) === n) : undefined;
    if (!v) return { ok: false, refusal: { status: 422, code: 'evidence_invalid', message: 'Choose a version of this record. Nothing was saved.' } };
    if (!(v.signed === true || Number(v.signed) === 1)) {
      return { ok: false, refusal: { status: 409, code: 'evidence_not_signed', message: `v${n} was not uploaded as the signed copy, so it cannot show this record was executed. Upload the signed copy as a new version, or choose the completed envelope. Nothing was saved.` } };
    }
    return { ok: true, evidence: { version: n, envelope: null } };
  }
  if (raw?.kind === 'envelope') {
    if (envelopeId == null) return { ok: false, refusal: { status: 422, code: 'evidence_invalid', message: 'No envelope is linked to this record. Link the completed envelope first. Nothing was saved.' } };
    if (!envelopeCompleted) return { ok: false, refusal: { status: 409, code: 'evidence_not_signed', message: `Envelope #${envelopeId} has not completed, so it cannot show this record was executed. Nothing was saved.` } };
    return { ok: true, evidence: { version: null, envelope: envelopeId } };
  }
  return { ok: false, refusal: { status: 422, code: 'evidence_required', message: 'Choose the execution evidence: the signed copy uploaded as a version, or the completed envelope. Nothing was saved.' } };
}
