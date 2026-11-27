/**
 * D4672 (#4672) — who may confirm a firm's proof, about which revision of it.
 *
 * D4670's model for advisors, applied to Offers · Proof, reusing its code, hash
 * and mask helpers rather than a second copy of them.
 *
 * THE LINK IS AN INVITATION, NOT A CREDENTIAL. The firm hands the client a link;
 * holding it lets someone read the claim it is about. Every answer (confirm,
 * decline, withdraw) needs a six-digit code that Axal emails, on the client's
 * own request, to the address the firm named, which cannot be one of the
 * firm's own. So the firm, which holds the link, cannot answer for the client.
 *
 * THE CLAIM IS PINNED TO A REVISION. A request records the claim exactly as it
 * read (kind, title, detail, outcome, engagement) and its SHA-256. A material
 * edit moves the item to a new revision; a confirmation counts only while the
 * item still reads as it pinned, and otherwise stays attached to the revision
 * it was about, shown as superseded. A request asked about an older revision
 * cannot confirm the newer one.
 *
 * CLOSED STAYS CLOSED. A decline or a withdrawal closes the request: no code,
 * old or new, reopens it. Asking again is a new request, on the record.
 *
 * Nothing here logs an address, a code or a claim.
 */
import type { Env } from '../types';
import { isSuppressed } from './newsletter';
import { sendNotificationEmail, escapeHtml } from './email';
import { sha256Hex } from './advisorProofAttestation';

export { CODE_MAX_ATTEMPTS, CODE_TTL_MS, CODES_PER_HOUR, emailOf, maskEmail, newCode, sha256Hex } from './advisorProofAttestation';

/** How long a request's link answers: long enough to reach a client's counsel, not a standing key. */
export const LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type ProofClaim = {
  kind: string; title: string; detail: string | null; outcome_note: string | null; engagement_id: number | null;
};

/** The claim as it is pinned: a fixed key order, so the same claim always hashes the same. */
export function proofClaimJson(item: ProofClaim): string {
  return JSON.stringify({
    kind: item.kind,
    title: item.title,
    detail: item.detail ?? null,
    outcome_note: item.outcome_note ?? null,
    engagement_id: item.engagement_id == null ? null : Number(item.engagement_id),
  });
}

export const proofClaimSha256 = (item: ProofClaim) => sha256Hex(proofClaimJson(item));

/** Bound to its consent and to Offers, so a hash leaked from one row answers no other, nor an advisor's. */
export const proofCodeHash = (consentId: number, code: string) => sha256Hex(`partner-proof:${consentId}:${code}`);

/**
 * How the code is mailed. An object, so a test swaps `send` and reads the code
 * it would have sent; production sends through the platform's mail path, which
 * honours the suppression list.
 */
export const proofConsentMailer = {
  async send(env: Env, to: string, firmName: string, code: string): Promise<boolean> {
    if (await isSuppressed(env, to, 'security')) return false;
    const subject = 'Your Axal confirmation code';
    const body = `Your code to answer ${firmName}'s request on Axal is ${code}. It lasts 15 minutes. If you did not ask for it, ignore this email: nothing is recorded without the code.`;
    const html = `<p style="font-family:sans-serif;font-size:14px;color:#111;">Your code to answer ${escapeHtml(firmName)}’s request on Axal is</p>`
      + `<p style="font-family:monospace;font-size:24px;letter-spacing:4px;color:#111;"><b>${code}</b></p>`
      + '<p style="font-family:sans-serif;font-size:12px;color:#6b7280;">It lasts 15 minutes. If you did not ask for it, ignore this email: nothing is recorded without the code.</p>';
    return sendNotificationEmail(env, to, subject, body, { html });
  },
};

/**
 * What a consent row says, as the firm and the client both read it.
 *
 *   requested   asked, unanswered, link still live, about the current revision
 *   confirmed   agreed, about the claim as it reads now
 *   declined    said no before ever agreeing
 *   withdrawn   agreed, then took it back
 *   superseded  about a revision the item no longer reads as: an edit after the
 *               ask or the answer, or a confirmation recorded before D4672
 *               (never pinned to any revision)
 *   expired     asked, never answered, and the link has lapsed
 */
export type ProofConsentState = 'requested' | 'confirmed' | 'declined' | 'withdrawn' | 'superseded' | 'expired';

export type ProofConsentRowLike = {
  consent_given: number; consent_given_at: string | null; withdrawn_at: string | null;
  claim_sha256: string | null; expires_at: string | null;
};

export function proofConsentState(row: ProofConsentRowLike, currentSha: string, nowMs: number = Date.now()): ProofConsentState {
  if (row.withdrawn_at) return row.consent_given_at ? 'withdrawn' : 'declined';
  if (!row.claim_sha256 || row.claim_sha256 !== currentSha) return 'superseded';
  if (Number(row.consent_given) === 1) return 'confirmed';
  if (row.expires_at && Date.parse(row.expires_at) <= nowMs) return 'expired';
  return 'requested';
}
