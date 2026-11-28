/**
 * D5457 (#5457, ADP-03 of #5453) — the deal package manifest: which canonical sources a private revision selects, for
 * which purpose and audience, and the candidate digest that pins them. The contract is
 * `documentation/architecture/decisions/D5457.md`; this file is its vocabulary and parser.
 *
 * WHERE IT LIVES. A manifest is two keys of a D5454 revision's content (`REVISION_CONTENT_KEYS`): `evidence_refs`
 * (the selected items) and `audience_manifest` (the intended audience). Revisions are written by ADP-02 (#5456),
 * which is disabled (`PREPARATION_MUTATIONS_ENABLED`); this file only reads and validates what a revision holds.
 *
 * FAIL CLOSED. `parseManifest` refuses the whole manifest on any unknown kind, purpose or audience, a forbidden
 * source (bank figures, investor-private notes, another firm's records), a duplicate, a malformed ref or version, a
 * free-text note, or more items or recipients than the bounds allow. A refused manifest is never read as "empty".
 *
 * NOT A GRANT. An audience here names who the package is intended for. It grants nothing: every source is re-checked
 * against its own store's rules at release and again at retrieval (`dealPackageSources.ts`).
 */

export const D5457_CONTRACT_VERSION = 1 as const;
/** The readiness policy the evaluator applies. A change to the matrix or a check is a new version. */
export const PACKAGE_POLICY_VERSION = 'd5457.1' as const;

/** The platform's existing source words (raise_evidence_items.source_label, D1261). Not confidence grades. */
export const SOURCE_CATEGORIES = ['connector', 'document', 'recorded', 'signed', 'typed'] as const;
export type SourceCategory = typeof SOURCE_CATEGORIES[number];
export const SOURCE_CATEGORY_LABEL: Readonly<Record<SourceCategory, string>> = Object.freeze({
  connector: 'Connector', document: 'Document', recorded: 'Recorded', signed: 'Signed', typed: 'Typed',
});

/** Why an item is in the package (owner addendum, 2026-11-10). Inclusion is not measurement. */
export const ITEM_PURPOSES = [
  'claim_support', 'counterevidence', 'risk_assessment', 'control_test', 'valuation', 'publication_attachment',
] as const;
export type ItemPurpose = typeof ITEM_PURPOSES[number];

/**
 * The audiences a release may name. A narrowly invited audience comes first; the marketplace teaser needs an approved
 * distribution policy, which does not exist yet, so readiness blocks it. There is no public or mass audience.
 */
export const RELEASE_AUDIENCES = ['invited', 'invited_nda', 'marketplace_teaser'] as const;
export type ReleaseAudience = typeof RELEASE_AUDIENCES[number];

/**
 * Every source kind a manifest may name, with the canonical store it resolves against. `integrated: false` kinds are
 * real platform records the package does not read yet: they resolve to `unavailable`, never to a guessed status.
 */
export const SOURCE_KINDS = {
  data_room_file: { integrated: true, store: 'data_room_files', label: 'Data-room document' },
  raise_evidence_item: { integrated: true, store: 'raise_evidence_items', label: 'Raise evidence' },
  pitch_deck: { integrated: true, store: 'pitch_decks', label: 'Pitch deck version' },
  venture_scorecard: { integrated: false, store: 'venture_scorecards', label: 'Scorecard scope' },
  deck_derivative: { integrated: false, store: 'deck_derivatives', label: 'Teaser or memo output' },
  dd_summary: { integrated: false, store: 'dd_cases', label: 'Diligence summary' },
  contract_reference: { integrated: false, store: 'contracts', label: 'Contract or template' },
} as const;
export type SourceKind = keyof typeof SOURCE_KINDS;
export const isSourceKind = (v: unknown): v is SourceKind => typeof v === 'string' && Object.hasOwn(SOURCE_KINDS, v);

/** Never a source for a distributed package (#5457 "Package manifest"). Named so a refusal says why. */
export const FORBIDDEN_SOURCE_KINDS = ['bank_balance', 'mercury_fact', 'investor_private_note', 'other_firm_record'] as const;

export const MANIFEST_ITEMS_MAX = 100;
export const RECIPIENTS_MAX = 25;
const ITEM_KEYS = new Set(['kind', 'ref', 'version', 'purpose']);
const AUDIENCE_KEYS = new Set(['audience', 'recipients']);
const REF_RE = /^[A-Za-z0-9_-]{1,64}$/;

export type ManifestItem = { kind: SourceKind; ref: string; version: number; purpose: ItemPurpose };
export type AudienceManifest = { audience: ReleaseAudience; recipients: number[] };
export type Manifest = { items: ManifestItem[]; audience: AudienceManifest | null };

export type ManifestRefusal =
  | 'manifest_not_list' | 'manifest_over_bound' | 'item_not_object' | 'item_unknown_field' | 'kind_forbidden'
  | 'kind_unknown' | 'ref_invalid' | 'version_invalid' | 'purpose_unknown' | 'item_duplicate'
  | 'audience_not_object' | 'audience_unknown_field' | 'audience_unknown' | 'recipients_invalid'
  | 'recipients_over_bound' | 'recipients_on_teaser' | 'recipient_duplicate';
export type ManifestResult = { ok: true; manifest: Manifest } | { ok: false; code: ManifestRefusal; index?: number };

const isPlainObject = (v: unknown): v is Record<string, unknown> => v != null && typeof v === 'object' && !Array.isArray(v);
const positiveInt = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null);

/**
 * Reads `evidence_refs` and `audience_manifest` from a revision's content. A missing key is an empty selection
 * (`items: []`) or no audience yet (`audience: null`), which readiness reports as incomplete; anything malformed
 * refuses the whole manifest.
 */
export function parseManifest(content: Record<string, unknown> | null | undefined): ManifestResult {
  const rawItems = content?.evidence_refs;
  const items: ManifestItem[] = [];
  if (rawItems != null) {
    if (!Array.isArray(rawItems)) return { ok: false, code: 'manifest_not_list' };
    if (rawItems.length > MANIFEST_ITEMS_MAX) return { ok: false, code: 'manifest_over_bound' };
    const seen = new Set<string>();
    for (let i = 0; i < rawItems.length; i += 1) {
      const raw = rawItems[i];
      if (!isPlainObject(raw)) return { ok: false, code: 'item_not_object', index: i };
      // No free-text note: internal comments belong in the revision's `internal_notes`, which no audience projects.
      if (Object.keys(raw).some((k) => !ITEM_KEYS.has(k))) return { ok: false, code: 'item_unknown_field', index: i };
      if ((FORBIDDEN_SOURCE_KINDS as readonly unknown[]).includes(raw.kind)) return { ok: false, code: 'kind_forbidden', index: i };
      if (!isSourceKind(raw.kind)) return { ok: false, code: 'kind_unknown', index: i };
      if (typeof raw.ref !== 'string' || !REF_RE.test(raw.ref)) return { ok: false, code: 'ref_invalid', index: i };
      const version = positiveInt(raw.version);
      if (version == null) return { ok: false, code: 'version_invalid', index: i };
      if (!(ITEM_PURPOSES as readonly unknown[]).includes(raw.purpose)) return { ok: false, code: 'purpose_unknown', index: i };
      const key = `${raw.kind}:${raw.ref}`;
      if (seen.has(key)) return { ok: false, code: 'item_duplicate', index: i };
      seen.add(key);
      items.push({ kind: raw.kind, ref: raw.ref, version, purpose: raw.purpose as ItemPurpose });
    }
  }
  const rawAudience = content?.audience_manifest;
  if (rawAudience == null) return { ok: true, manifest: { items, audience: null } };
  if (!isPlainObject(rawAudience)) return { ok: false, code: 'audience_not_object' };
  if (Object.keys(rawAudience).some((k) => !AUDIENCE_KEYS.has(k))) return { ok: false, code: 'audience_unknown_field' };
  if (!(RELEASE_AUDIENCES as readonly unknown[]).includes(rawAudience.audience)) return { ok: false, code: 'audience_unknown' };
  const audience = rawAudience.audience as ReleaseAudience;
  const rawRecipients = rawAudience.recipients ?? [];
  if (!Array.isArray(rawRecipients)) return { ok: false, code: 'recipients_invalid' };
  // A teaser names no one: no targeting list rides on a marketplace audience.
  if (audience === 'marketplace_teaser' && rawRecipients.length > 0) return { ok: false, code: 'recipients_on_teaser' };
  if (rawRecipients.length > RECIPIENTS_MAX) return { ok: false, code: 'recipients_over_bound' };
  const recipients: number[] = [];
  for (const r of rawRecipients) {
    const id = positiveInt(r);
    if (id == null) return { ok: false, code: 'recipients_invalid' };
    if (recipients.includes(id)) return { ok: false, code: 'recipient_duplicate' };
    recipients.push(id);
  }
  return { ok: true, manifest: { items, audience: { audience, recipients } } };
}

// ---------------------------------------------------------------------------------------------------------------
// Digests: what the candidate is, and what its sources were when it was checked.
// ---------------------------------------------------------------------------------------------------------------

/** Canonical JSON: object keys sorted at every depth, so equal values always hash equally. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (isPlainObject(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type CandidateIdentity = {
  preparation_uid: string;
  revision_id: number;
  content_sha256: string;
  company_id: number;
  project_id: number;
  manifest: Manifest;
};

/**
 * The digest of the exact candidate a preflight or an approval is about: the revision and its content digest, the
 * pinned issuer pair, the manifest (items in a fixed order, recipients sorted) and the policy version. Editing the
 * manifest, a pinned version, the terms (through `content_sha256`), the audience or the issuer changes it.
 */
export async function candidateDigest(c: CandidateIdentity, policyVersion: string = PACKAGE_POLICY_VERSION): Promise<string> {
  const items = [...c.manifest.items].sort((a, b) => (a.kind === b.kind ? (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0) : a.kind < b.kind ? -1 : 1));
  const audience = c.manifest.audience ? { audience: c.manifest.audience.audience, recipients: [...c.manifest.audience.recipients].sort((a, b) => a - b) } : null;
  return sha256Hex(canonicalJson({
    contract: D5457_CONTRACT_VERSION, policy: policyVersion, preparation: c.preparation_uid, revision: c.revision_id,
    content: c.content_sha256, issuer: [c.company_id, c.project_id], items, audience,
  }));
}
