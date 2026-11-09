/**
 * D4811 (#4811) part 8 — related documents of a Corporate Governance record
 * (board CT-11, migration 202611091201): which documents a record governs,
 * which of them "may require review" since the record's last approved or
 * executed version, and the banner. Pure: `routes/admin_governance.ts` reads
 * and writes the rows, this says what they mean. Nothing here, or anywhere,
 * rewrites a dependant: a flag asks a person to check it.
 */

export const RELATION_KINDS = Object.freeze(['governance', 'template'] as const);
export type RelationKind = (typeof RELATION_KINDS)[number];
export const isRelationKind = (k: unknown): k is RelationKind => typeof k === 'string' && (RELATION_KINDS as readonly string[]).includes(k);

export const NOTE_MAX = 500;

export type RelationRow = {
  id: number; governing_uid: string; dependent_kind: string; dependent_ref: string;
  flag_version: number | null; flagged_at: string | null;
  reviewed_version: number | null; reviewed_by: number | null; reviewed_at: string | null; review_note: string | null;
  created_at?: string | null;
};

/**
 * The governing version a status move raises flags at, or null when the move
 * raises none. Only Approved and Executed do (CT-92): Executed names its signed
 * version when one is recorded; otherwise the latest file's number, and 0 when
 * the record has no file yet.
 */
export function triggerVersion(status: string, executedVersion: number | null | undefined, latestVersion: number | null | undefined): number | null {
  const latest = Number.isSafeInteger(Number(latestVersion)) && Number(latestVersion) > 0 ? Number(latestVersion) : 0;
  if (status === 'executed') return Number.isSafeInteger(Number(executedVersion)) && Number(executedVersion) > 0 ? Number(executedVersion) : latest;
  if (status === 'approved') return latest;
  return null;
}

/** The version a new link starts as checked against: the record's current approved or executed one, so linking alone flags nothing. */
export const baselineVersion = (status: string, executedVersion: number | null | undefined, latestVersion: number | null | undefined) =>
  triggerVersion(status, executedVersion, latestVersion);

/** A dependant's state: may require review, reviewed (against the version that raised it), or not affected. */
export function flagOf(r: Pick<RelationRow, 'flag_version' | 'reviewed_version'>): 'review_suggested' | 'reviewed' | 'not_affected' {
  if (r.flag_version == null) return 'not_affected';
  if (r.reviewed_version == null || r.reviewed_version < r.flag_version) return 'review_suggested';
  return 'reviewed';
}

/** The banner for one admin: how many dependants may require review, at which version, and whether this admin dismissed it. */
export function bannerOf(rows: Pick<RelationRow, 'flag_version' | 'reviewed_version'>[], dismissedVersion: number | null | undefined) {
  const flagged = rows.filter((r) => flagOf(r) === 'review_suggested');
  const version = flagged.reduce<number | null>((m, r) => (m == null || Number(r.flag_version) > m ? Number(r.flag_version) : m), null);
  const dismissed = version != null && dismissedVersion != null && Number(dismissedVersion) >= version;
  return { affected: flagged.length, version, dismissed };
}

/** The optional note marking a dependant reviewed: trimmed, at most 500 characters, null when empty; false when it is not text. */
export function noteOf(raw: unknown): string | null | false {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') return false;
  const t = raw.trim();
  if (!t) return null;
  return t.length > NOTE_MAX ? false : t;
}
