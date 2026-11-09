/**
 * D4811 (#4811) part 2 — Corporate Governance's attention view: the record set
 * each Axal entity is expected to hold, the state of each expected record, each
 * entity's facts, and the group structure. Pure: the route
 * (`routes/admin_governance.ts`, `GET /api/admin/governance`) reads the rows
 * and this file says what they mean. Nothing here is a score.
 *
 * EXPECTED RECORDS (board CT-92 "Expected records"). Each entity expects one
 * record per D4563 category, under the name that entity uses for it. A record
 * marked `conditional` reads "Not recorded — add if applicable" when absent;
 * any other reads "Missing — expected". The canvas draws more record types
 * than D4563 has categories (IP ownership, intercompany agreements,
 * fund-formation approvals and others); those need a category, which is a
 * CHECK rebuild of `governance_documents`, and are not expected here yet.
 *
 * RECORD STATE, from the category's documents that are not archived:
 *   - none at all                                  → Missing — expected / Not recorded — add if applicable
 *   - none this viewer may open (all confidential) → Restricted
 *   - one in review, or a draft that has a file    → Review required
 *   - one with no file yet (not executed)          → Incomplete
 *   - otherwise one approved or executed           → Current
 * A Super Admin sees the real state of a confidential record; `restricted`
 * is still true on it, so both viewers count the same restricted records.
 *
 * GROUP STRUCTURE. Never hard-coded: read from the Super Admin's ownership
 * rows (`governance_entity_profiles`) whose holder is another Axal entity's
 * legal name. Only those intercompany rows leave this file; a row naming any
 * other holder (a beneficial owner) is never returned to anyone here.
 */
import { GOVERNANCE_ENTITIES, entityName, type DocRow, type GovernanceCategory, type GovernanceEntity } from './governance';

export const RECORD_STATES = ['current', 'review_required', 'missing', 'not_recorded', 'restricted', 'incomplete'] as const;
export type RecordState = typeof RECORD_STATES[number];

type Expected = { category: GovernanceCategory; label: string; conditional: boolean };
const expect = (...records: Expected[]): readonly Expected[] => Object.freeze(records);

/** What each entity is expected to hold. Single-member LLCs keep a member register only if they choose to. */
export const EXPECTED_RECORDS: Readonly<Record<GovernanceEntity, readonly Expected[]>> = Object.freeze({
  holdings: expect(
    { category: 'operating_agreement', label: 'Operating Agreement', conditional: false },
    { category: 'formation_certificate', label: 'Certificate of Formation', conditional: false },
    { category: 'member_register', label: 'Member Register', conditional: false },
    { category: 'resolution', label: 'Written Consents', conditional: false },
    { category: 'signing_authority', label: 'Signing authority', conditional: false },
  ),
  management: expect(
    { category: 'operating_agreement', label: 'Sole-Member Operating Agreement', conditional: false },
    { category: 'formation_certificate', label: 'Certificate of Formation', conditional: false },
    { category: 'member_register', label: 'Member Register', conditional: true },
    { category: 'resolution', label: 'Sole-Member Consents', conditional: false },
    { category: 'signing_authority', label: 'Delegation of Authority', conditional: false },
  ),
  gp: expect(
    { category: 'operating_agreement', label: 'GP LLC Operating Agreement', conditional: false },
    { category: 'formation_certificate', label: 'Certificate of Formation', conditional: false },
    { category: 'member_register', label: 'Member Register', conditional: true },
    { category: 'resolution', label: 'Parent Member Consent and GP resolutions', conditional: false },
    { category: 'signing_authority', label: 'Authorized signatories', conditional: false },
  ),
});

export type DocFacts = { row: DocRow; versions: number; latestVersion: number | null };

const RANK: Record<string, number> = { executed: 4, approved: 3, review: 2, draft: 1 };
const byStanding = (a: DocFacts, b: DocFacts) =>
  (RANK[b.row.status] ?? 0) - (RANK[a.row.status] ?? 0)
  || String(b.row.effective_date ?? '').localeCompare(String(a.row.effective_date ?? ''))
  || Number(b.row.id) - Number(a.row.id);

const brief = (d: DocFacts | undefined) => d ? {
  uid: d.row.uid, title: d.row.title, status: d.row.status, effective_date: d.row.effective_date,
  version: d.latestVersion, versions: d.versions, confidential: !!Number(d.row.confidential),
} : null;

/** One expected record's state, from the documents of its category (archived ones excluded by the caller or here). */
export function recordOf(expected: Expected, docs: readonly DocFacts[], superAdmin: boolean) {
  const live = docs.filter((d) => d.row.category === expected.category && d.row.status !== 'archived');
  const visible = live.filter((d) => superAdmin || Number(d.row.confidential) !== 1).sort(byStanding);
  const restricted = live.length > 0 && live.every((d) => Number(d.row.confidential) === 1);
  const inReview = visible.find((d) => d.row.status === 'review' || (d.row.status === 'draft' && d.versions > 0));
  const noFile = visible.find((d) => d.versions === 0 && d.row.status !== 'executed');
  const standing = visible.find((d) => d.row.status === 'executed' || d.row.status === 'approved');
  let state: RecordState;
  let attention: DocFacts | undefined;
  if (live.length === 0) state = expected.conditional ? 'not_recorded' : 'missing';
  else if (visible.length === 0) state = 'restricted';
  else if (inReview) { state = 'review_required'; attention = inReview; }
  else if (noFile) { state = 'incomplete'; attention = noFile; }
  else if (standing) state = 'current';
  else { state = 'review_required'; attention = visible[0]; }
  return {
    category: expected.category, label: expected.label, conditional: expected.conditional, state, restricted,
    // Counts and the record itself only where this viewer may open it; a restricted record says nothing more.
    recorded: visible.length,
    current: brief(standing ?? visible[0]),
    attention: brief(attention),
  };
}
export type ExpectedRecord = ReturnType<typeof recordOf>;

/** The four facts an entity carries (board CT-04 to CT-06). "Last review" waits on the legal-review store (D4811 question C). */
export function factsOf(records: readonly ExpectedRecord[], docs: readonly DocFacts[], superAdmin: boolean) {
  const executed = docs.filter((d) => d.row.status === 'executed' && (superAdmin || Number(d.row.confidential) !== 1)).sort(byStanding)[0];
  const missing = records.find((r) => r.state === 'missing');
  const incomplete = records.find((r) => r.state === 'incomplete');
  const review = records.find((r) => r.state === 'review_required');
  const issue = missing ? { kind: 'missing', category: missing.category, label: missing.label, uid: null }
    : incomplete ? { kind: 'incomplete', category: incomplete.category, label: incomplete.label, uid: incomplete.attention?.uid ?? null, title: incomplete.attention?.title ?? null }
      : null;
  const next = missing ? { kind: 'add', category: missing.category, label: missing.label, uid: null, title: null }
    : incomplete ? { kind: 'upload', category: incomplete.category, label: incomplete.label, uid: incomplete.attention?.uid ?? null, title: incomplete.attention?.title ?? null }
      : review ? { kind: 'review', category: review.category, label: review.label, uid: review.attention?.uid ?? null, title: review.attention?.title ?? null }
        : null;
  return { latest_executed: brief(executed), last_review: null, outstanding_issue: issue, next_action: next };
}

export function countsOf(records: readonly ExpectedRecord[]) {
  const c = { review_required: 0, missing: 0, not_recorded: 0, restricted: 0, incomplete: 0, current: 0 };
  for (const r of records) {
    c[r.state] += 1;
    if (r.restricted && r.state !== 'restricted') c.restricted += 1;
  }
  return c;
}

/** The attention view of one entity. */
export function entityAttention(key: GovernanceEntity, docs: readonly DocFacts[], superAdmin: boolean) {
  const mine = docs.filter((d) => d.row.entity_key === key);
  const records = EXPECTED_RECORDS[key].map((e) => recordOf(e, mine, superAdmin));
  return { records, counts: countsOf(records), facts: factsOf(records, mine, superAdmin) };
}

const norm = (s: unknown) => (typeof s === 'string' ? s.trim().replace(/\s+/g, ' ').toLowerCase() : '');

/**
 * The group structure: for each entity, the Axal entities its ownership rows
 * name as holders, with the recorded percent (null when none was entered,
 * never 0). Rows naming anyone else are dropped here.
 */
export function groupOf(profiles: ReadonlyArray<{ entity_key: string; ownership_json: string }>) {
  const names = new Map(GOVERNANCE_ENTITIES.map((k) => [norm(entityName(k)), k]));
  const links: { parent: GovernanceEntity; child: GovernanceEntity; percent: number | null }[] = [];
  for (const child of GOVERNANCE_ENTITIES) {
    const p = profiles.find((x) => x.entity_key === child);
    if (!p) continue;
    let rows: any[] = [];
    try { const parsed = JSON.parse(p.ownership_json); rows = Array.isArray(parsed) ? parsed : []; } catch { rows = []; }
    for (const r of rows) {
      const parent = names.get(norm(r?.holder));
      if (!parent || parent === child) continue;
      const percent = r?.percent == null || r.percent === '' || !Number.isFinite(Number(r.percent)) ? null : Number(r.percent);
      links.push({ parent, child, percent });
    }
  }
  return { links };
}
