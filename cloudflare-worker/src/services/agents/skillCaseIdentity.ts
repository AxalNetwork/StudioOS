/**
 * D5336 (#5336): a skill case's identity, in one place. The CI gate's source
 * manifest, the store manifest, the reconciliation and the seed's skip rule
 * all read a case's identity through `caseIdentity` / `storedCaseIdentity`,
 * and #4531's evaluator fingerprint `caseSha` lives here beside them, so the
 * hashing cannot drift between readers.
 *
 * TWO KINDS OF IDENTITY.
 * - A case whose source gives one (`skills/scenarios/<slug>.json`, #4588)
 *   is `case_id` plus its integer `revision`; its key is `<case_id>:r<revision>`.
 *   A changed text is a bumped revision, so a new identity.
 * - A v1 golden case (`skills/cases/<slug>.json`) has none, and keeps the
 *   identity D4532 gave it, unchanged: `<slug>#<first 12 hex of sha256({input, expect})>`.
 *
 * `sha256` is always the content hash of what `checkCase` keeps of the case
 * (`input` and `expect`, D4532 §2), so the same case read from a source file
 * and from its stored row hashes the same.
 *
 * A stored row (`agent_skill_cases`) carries its source identity in
 * `source_case_id` / `source_revision` when the seed wrote it (D5336); a row
 * with neither (an older seed's, or an HQ admin's) is identified by content,
 * exactly as a v1 golden case is.
 */

export type CaseIdentity = {
  /** The source's `case_id`, or `<slug>#<sha12>` for a case without one. */
  case_id: string;
  /** The source's integer revision; null for a content-identified case. */
  revision: number | null;
  /** What two cases must differ on: `<case_id>:r<revision>`, or `case_id` alone without a revision. */
  key: string;
  /** SHA-256 hex of `{ input, expect }`. */
  sha256: string;
};

/** The golden case's name: the seed names a library case that has no `name` of its own this way. */
export const goldenName = (slug: string) => `${slug}: golden case`;

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The identity key: `<case_id>:r<revision>`, or the bare case id when there is no revision. */
export const identityKey = (caseId: string, revision: number | null | undefined): string =>
  revision == null ? caseId : `${caseId}:r${revision}`;

/** The content hash of a case (D4532 §2): of `{ input, expect }` as `checkCase` keeps them. */
export const caseContentSha = (input: unknown, expect: unknown): Promise<string> => sha256Hex(JSON.stringify({ input, expect }));

/**
 * A case's identity. Pass the CHECKED input and expect (`checkCase`'s output), so a
 * source case and its stored row agree. `case_id` and `revision` are the source's, when it gives them.
 */
export async function caseIdentity(
  slug: string,
  c: { case_id?: string | null; revision?: number | null; input: unknown; expect: unknown },
): Promise<CaseIdentity> {
  const sha256 = await caseContentSha(c.input, c.expect);
  if (typeof c.case_id === 'string' && c.case_id) {
    const revision = c.revision == null ? null : c.revision;
    return { case_id: c.case_id, revision, key: identityKey(c.case_id, revision), sha256 };
  }
  const case_id = `${slug}#${sha256.slice(0, 12)}`;
  return { case_id, revision: null, key: case_id, sha256 };
}

/** A stored `agent_skill_cases` row's identity: its recorded source identity, else its content. An unreadable row hashes as nulls. */
export async function storedCaseIdentity(
  slug: string,
  row: { input_json: string; expect_json: string; source_case_id?: string | null; source_revision?: number | null },
): Promise<CaseIdentity> {
  let input: unknown = null; let expect: unknown = null;
  try { input = JSON.parse(row.input_json); expect = JSON.parse(row.expect_json); } catch { input = null; expect = null; }
  return caseIdentity(slug, { case_id: row.source_case_id ?? null, revision: row.source_revision == null ? null : Number(row.source_revision), input, expect });
}

/**
 * D4531 slice 3: the fingerprint of a case as the evaluator ran it: its checked name, input and expectations
 * (`checkCase`'s output), so a starter case shipped with new text, or an HQ case under another uid, is a different
 * case to `skillEvalCompare`. One function for the draft and the published histories, so one case reads the same in
 * both. `skillLifecycle.ts` re-exports it.
 */
export const caseSha = (c: { name: string; input: unknown; expect: unknown }): Promise<string> =>
  sha256Hex(JSON.stringify([c.name, c.input, c.expect]));
