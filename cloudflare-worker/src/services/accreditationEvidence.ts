/**
 * D6139 part 1 (#6139) — accreditation evidence: what may be uploaded, where it
 * is kept, how long, and how a stored row is shown.
 *
 * Owner answer A (2026-11-27): the only evidence is a verification letter from
 * a CPA, an attorney, a broker-dealer or a registered adviser. It is kept for
 * the 12-month accreditation period (`kyc_renewal_periods`, read through
 * `renewalPeriods`) plus the investor-record retention period that #5510 sets.
 * #5510 has not set that figure, so it is one named setting here,
 * `INVESTOR_RECORD_RETENTION_MONTHS`, and it is null: no keep-until date is
 * computed and nothing is swept until it is set.
 *
 * The routes are `routes/trust_accreditation.ts`. The file is a record
 * (`documentation/operations/R2_INVENTORY.json`, class
 * `files-accreditation-evidence`), written once through `putRecordOrThrow`.
 */

/** Who wrote the letter (owner answer A). The stored value and the words a reader sees. */
export const ACCREDITATION_BASES = {
  cpa_letter: 'Letter from a CPA',
  attorney_letter: 'Letter from an attorney',
  broker_dealer_letter: 'Letter from a broker-dealer',
  registered_adviser_letter: 'Letter from a registered adviser',
} as const;
export type AccreditationBasis = keyof typeof ACCREDITATION_BASES;
export const isAccreditationBasis = (v: unknown): v is AccreditationBasis =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(ACCREDITATION_BASES, v);

/** The R2 prefix of every letter: `accreditation-evidence/<user_id>/<uuid>.<ext>`. */
export const ACCREDITATION_EVIDENCE_PREFIX = 'accreditation-evidence/';

/** A letter is at most 10 MB. */
export const ACCREDITATION_LETTER_MAX_BYTES = 10 * 1024 * 1024;

/** A send-back reason is 10 to 500 characters; the member reads it as written. */
export const SEND_BACK_REASON_MIN = 10;
export const SEND_BACK_REASON_MAX = 500;

/**
 * THE ONE RETENTION SETTING. The months #5510 sets for investor records, kept
 * after a letter's accreditation period ends. Null until #5510 decides it:
 * then `letterKeptUntil` answers null and the page says the period is not set.
 * Do not put a number here without #5510's decision.
 */
export const INVESTOR_RECORD_RETENTION_MONTHS: number | null = null;

/** The types a letter may be, read from its first bytes, never from the name or the browser's type. */
export function sniffLetter(b: Uint8Array): { mime: 'application/pdf' | 'image/png' | 'image/jpeg'; ext: 'pdf' | 'png' | 'jpg' } | null {
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return { mime: 'application/pdf', ext: 'pdf' };
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return { mime: 'image/png', ext: 'png' };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  return null;
}

/** The SHA-256 of the letter, lower-case hex. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf)).map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** A file name safe to store and to send in a header: no path, quotes or line breaks, at most 200 characters. */
export function letterFileName(raw: unknown, ext: string): string {
  const name = String(raw ?? '').replace(/[\r\n"\\/]/g, '').trim().slice(0, 200);
  return name || `accreditation-letter.${ext}`;
}

/**
 * How long a letter is kept: until its accreditation period ends plus
 * `INVESTOR_RECORD_RETENTION_MONTHS`. Null while that setting is not set, and
 * for a letter with no accepted period (one still in review, or sent back).
 */
export function letterKeptUntil(expiresAt: string | null, months: number | null = INVESTOR_RECORD_RETENTION_MONTHS): string | null {
  if (months == null || !expiresAt) return null;
  const at = new Date(expiresAt);
  if (Number.isNaN(at.getTime())) return null;
  at.setUTCMonth(at.getUTCMonth() + months);
  return at.toISOString();
}

/**
 * The letter's state as a reader sees it. `expired` is not stored: an accepted
 * letter whose period has ended reads expired, computed in SQL with
 * `datetime(expires_at)` (see `EVIDENCE_COLUMNS`).
 */
export const EVIDENCE_STATES = ['submitted', 'in_review', 'accepted', 'sent_back', 'expired'] as const;

/** The columns every read selects. Never `file_key` or `sha256`: a list carries no file and no way to reach one. */
export const EVIDENCE_COLUMNS = `e.id, e.user_id, e.basis, e.file_name, e.content_type, e.size_bytes, e.uploaded_at,
  e.reviewed_at, e.review_reason, e.expires_at,
  CASE WHEN e.status = 'accepted' AND datetime(e.expires_at) <= datetime('now') THEN 'expired' ELSE e.status END AS state`;

export interface EvidenceRow {
  id: number; user_id: number; basis: string; file_name: string; content_type: string; size_bytes: number;
  uploaded_at: string; reviewed_at: string | null; review_reason: string | null; expires_at: string | null; state: string;
}

/** One letter for its owner: the basis, when it was uploaded, its state, and the decision's date, period and reason. */
export function memberEvidence(r: EvidenceRow) {
  return {
    id: Number(r.id),
    basis: r.basis,
    basis_label: ACCREDITATION_BASES[r.basis as AccreditationBasis] ?? r.basis,
    file_name: r.file_name,
    uploaded_at: r.uploaded_at,
    status: r.state,
    reviewed_at: r.reviewed_at ?? null,
    expires_at: r.expires_at ?? null,
    review_reason: r.state === 'sent_back' ? (r.review_reason ?? null) : null,
  };
}
