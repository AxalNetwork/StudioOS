/**
 * D5454 (#5454, ADP-01 of #5453) — the private preparation boundary: the lifecycle vocabulary, the capability check,
 * the named projections, the issuer pair check, the scoped admin queue read and the reader guard every existing
 * `deals` reader uses. The contract is `documentation/architecture/decisions/D5454.md`; this file is its code.
 *
 * THREE INDEPENDENT DIMENSIONS. `preparation_state` (draft → in_review → changes_requested / approved) is the
 * editorial review of a working revision. `publication_state` (unreleased → published → withdrawn / archived) is
 * distribution of a released revision. `deals.status` stays the round stage (intake/screened/raising/funded/passed)
 * and is never read or written here. A working r2 coexists with a released r1: the pointers are separate columns.
 *
 * PRIVATE BY CONSTRUCTION. A preparation whose origin is `preparation` owns no `deals` row until a revision is
 * released (migration CHECK `dp_private_owns_no_deal`), so no existing deal reader can see a never-released draft.
 * The reader guard below is the second layer: it hides any deal whose preparation metadata is not positively
 * "released" (unknown, corrupt or unreleased values are hidden, never published), and hides withdrawn/archived
 * releases from discovery (lists, counts, search, feeds) while transactional reads by a related party survive.
 *
 * DISABLED. Creating a draft, editing, submitting, reviewing, publishing and withdrawing are ADP-02/ADP-04's.
 * `PREPARATION_MUTATIONS_ENABLED` is false for each and a test pins it; no route here writes a preparation.
 *
 * LOGS carry counts and outcome codes only, never a name, title or amount.
 */
import type { Env, User } from '../types';
import { branchOf } from '../util/branch';

export const D5454_CONTRACT_VERSION = 1 as const;

export const PREPARATION_STATES = ['draft', 'in_review', 'changes_requested', 'approved'] as const;
export const PUBLICATION_STATES = ['unreleased', 'published', 'withdrawn', 'archived'] as const;
export const PREPARATION_ORIGINS = ['preparation', 'legacy_attach'] as const;
export type PreparationState = typeof PREPARATION_STATES[number];
export type PublicationState = typeof PUBLICATION_STATES[number];

/** The explicit capabilities. No other name grants anything. */
export const PREPARATION_CAPABILITIES = ['read', 'create', 'edit', 'submit', 'review', 'publish', 'withdraw'] as const;
export type PreparationCapability = typeof PREPARATION_CAPABILITIES[number];

/**
 * Every mutation is off until its owning package enables it (ADP-02 create/edit/submit; ADP-04 review/publish/
 * withdraw). Enabling one is a code change reviewed against the reader inventory in D5454.md, never a setting.
 */
export const PREPARATION_MUTATIONS_ENABLED: Readonly<Record<Exclude<PreparationCapability, 'read'>, false>> = Object.freeze({
  create: false, edit: false, submit: false, review: false, publish: false, withdraw: false,
});

// ---------------------------------------------------------------------------------------------------------------
// Classification: what a deal's preparation metadata means for a reader.
// ---------------------------------------------------------------------------------------------------------------

/**
 *   legacy             no preparation row, or a legacy attachment that has not been released through preparation:
 *                      today's rules apply unchanged (the owner's legacy mapping decides any change)
 *   listed             a released revision under `published`
 *   unlisted_released  a released revision under `withdrawn` or `archived`
 *   private            anything else, including unknown or missing values: never shown
 */
export type PreparationClass = 'legacy' | 'listed' | 'unlisted_released' | 'private';

export type PreparationMeta = {
  origin?: unknown; publication_state?: unknown; released_revision_id?: unknown;
} | null | undefined;

export function classifyPreparation(row: PreparationMeta): PreparationClass {
  if (row == null) return 'legacy';
  const released = row.released_revision_id != null && Number.isSafeInteger(Number(row.released_revision_id)) && Number(row.released_revision_id) > 0;
  const pub = typeof row.publication_state === 'string' ? row.publication_state : null;
  if (released && pub === 'published') return 'listed';
  if (released && (pub === 'withdrawn' || pub === 'archived')) return 'unlisted_released';
  if (!released && row.origin === 'legacy_attach' && pub === 'unreleased') return 'legacy';
  return 'private';
}

export type ReaderMode = 'discovery' | 'transactional';

/** Discovery = lists, counts, search, feeds, notifications, exports, AI context. Transactional = by-id reads/writes. */
export function hiddenFor(mode: ReaderMode, cls: PreparationClass): boolean {
  if (cls === 'private') return true;
  return mode === 'discovery' && cls === 'unlisted_released';
}

/**
 * The SQL twin of `classifyPreparation`, for the hidden set. Every comparison uses `IS`, which is never NULL, so an
 * unknown or NULL value makes the row hidden rather than letting three-valued logic drop it from the NOT.
 */
const HIDDEN_DISCOVERY_SQL = `SELECT deal_id FROM deal_preparations
  WHERE deal_id IS NOT NULL AND NOT (
    (released_revision_id IS NOT NULL AND publication_state IS 'published')
    OR (released_revision_id IS NULL AND origin IS 'legacy_attach' AND publication_state IS 'unreleased'))
  ORDER BY deal_id LIMIT ?`;
const HIDDEN_TRANSACTIONAL_SQL = `SELECT deal_id FROM deal_preparations
  WHERE deal_id IS NOT NULL AND NOT (
    (released_revision_id IS NOT NULL AND (publication_state IS 'published' OR publication_state IS 'withdrawn' OR publication_state IS 'archived'))
    OR (released_revision_id IS NULL AND origin IS 'legacy_attach' AND publication_state IS 'unreleased'))
  ORDER BY deal_id LIMIT ?`;
const ONE_PREPARATION_SQL = 'SELECT origin, publication_state, released_revision_id FROM deal_preparations WHERE deal_id = ? LIMIT 1';

/**
 * The most hidden deal ids one read returns. Beyond it the read refuses (fails closed) instead of truncating a
 * privacy filter; D5454.md records the bound and its query cost.
 */
export const HIDDEN_SET_MAX = 5000;

/** A database that has not applied the migration holds no preparation, so nothing is private there. */
export function isMissingPreparationTable(err: unknown): boolean {
  return /no such table:\s*deal_preparations\b/i.test(String((err as any)?.message ?? err ?? ''));
}

/**
 * The deal ids a reader in `mode` must not return. One bound statement. Any error other than the missing table
 * throws, so the caller's request fails rather than serving an unfiltered list.
 */
export async function hiddenDealIds(env: Env, mode: ReaderMode): Promise<Set<number>> {
  let rows: Array<{ deal_id: number }> = [];
  try {
    const res = await env.DB.prepare(mode === 'discovery' ? HIDDEN_DISCOVERY_SQL : HIDDEN_TRANSACTIONAL_SQL)
      .bind(HIDDEN_SET_MAX + 1).all<{ deal_id: number }>();
    rows = res.results || [];
  } catch (err) {
    if (isMissingPreparationTable(err)) return new Set();
    throw err;
  }
  if (rows.length > HIDDEN_SET_MAX) {
    console.warn('[deal-preparation] hidden set over bound', { mode, over: true });
    throw new Error('deal_preparation_hidden_set_over_bound');
  }
  return new Set(rows.map((r) => Number(r.deal_id)));
}

/** Whether one deal is hidden from a reader in `mode`. Same failure rule as `hiddenDealIds`. */
export async function dealHiddenFrom(env: Env, dealId: number, mode: ReaderMode): Promise<boolean> {
  if (!Number.isSafeInteger(dealId) || dealId <= 0) return false;
  let row: PreparationMeta = null;
  try {
    row = await env.DB.prepare(ONE_PREPARATION_SQL).bind(dealId).first<any>();
  } catch (err) {
    if (isMissingPreparationTable(err)) return false;
    throw err;
  }
  return hiddenFor(mode, classifyPreparation(row));
}

/** Whether a deal's editorial terms are owned by a preparation (any preparation row, legacy attachments included). */
export async function preparationManagesDeal(env: Env, dealId: number): Promise<boolean> {
  if (!Number.isSafeInteger(dealId) || dealId <= 0) return false;
  try {
    return !!(await env.DB.prepare('SELECT 1 AS managed FROM deal_preparations WHERE deal_id = ? LIMIT 1').bind(dealId).first());
  } catch (err) {
    if (isMissingPreparationTable(err)) return false;
    throw err;
  }
}

/** Drops rows whose id is in the hidden set. `idOf` reads the row's deal id. */
export function withoutHidden<T>(rows: readonly T[], hidden: ReadonlySet<number>, idOf: (row: T) => unknown): T[] {
  if (!hidden.size) return [...rows];
  return rows.filter((r) => !hidden.has(Number(idOf(r))));
}

/** The hidden set as a bound JSON array, for `d.id NOT IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`. */
export const hiddenJson = (hidden: ReadonlySet<number>) => JSON.stringify([...hidden]);

/**
 * The deal columns a preparation owns once it manages a deal: written only by a reviewed release (ADP-04), never by
 * a stage move, `PUT /api/deals/:id` or a CRM/import pull.
 */
export const EDITORIAL_DEAL_COLUMNS = [
  'amount', 'target_raise', 'minimum_check', 'valuation_cap', 'carry_pct', 'management_fee_pct',
  'instrument', 'spv_jurisdiction', 'closing_deadline', 'website', 'description',
] as const;

export const PREPARATION_MANAGED_TERMS = {
  status: 409 as const,
  body: {
    error: 'preparation_managed_terms',
    detail: 'This deal’s terms are set by its reviewed release. Change them in a new preparation revision. Nothing in this request was saved.',
  },
};

export function editorialKeys(data: Record<string, unknown> | null | undefined): string[] {
  if (!data || typeof data !== 'object') return [];
  return EDITORIAL_DEAL_COLUMNS.filter((k) => Object.hasOwn(data, k) && (data as any)[k] !== undefined);
}

export function withoutEditorial<T extends Record<string, unknown>>(fields: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) if (!(EDITORIAL_DEAL_COLUMNS as readonly string[]).includes(k)) out[k] = v;
  return out as T;
}

// ---------------------------------------------------------------------------------------------------------------
// Capability: who may do what to a preparation.
// ---------------------------------------------------------------------------------------------------------------

/** The deployment this Worker serves, as stored in `deal_preparations.scope_code`. */
export const deploymentScope = (env: Pick<Env, 'BRANCH_CODE'>) => branchOf(env) || 'hq';

export type CapabilityContext = {
  /** Whether `requireAdmin` would refuse this admin's writes (D135): `adminWritesFrozen`. */
  writesFrozen: boolean;
  /** A client-side persona preview. It never adds authority; it is accepted only to prove that. */
  previewMode?: boolean;
};

export type PreparationScopeRow = { scope_code?: unknown } | null | undefined;

/**
 * The capabilities this caller holds on a preparation in this deployment.
 *
 * Authority is the platform admin (`role = 'admin'`, already MFA-gated by `requireAdmin` at the route), outside a
 * support session, on the row's own deployment. Nothing else grants anything: not the partner licence (pipeline
 * read/move access is not preparation access), not the investor or founder licence, not preview mode. A frozen
 * admin keeps `read` (D135 never gates a read) and loses every write. Mutations are further gated by
 * `PREPARATION_MUTATIONS_ENABLED`, so today the most anyone holds is `read`.
 */
export function preparationCapabilities(
  env: Pick<Env, 'BRANCH_CODE'>, user: User | null | undefined, row: PreparationScopeRow, ctx: CapabilityContext,
): Set<PreparationCapability> {
  const out = new Set<PreparationCapability>();
  if (!user || user.role !== 'admin') return out;
  if ((user as any).support_session) return out;
  if (row != null && row.scope_code !== deploymentScope(env)) return out;
  out.add('read');
  if (ctx.writesFrozen) return out;
  for (const cap of PREPARATION_CAPABILITIES) {
    if (cap === 'read') continue;
    if ((PREPARATION_MUTATIONS_ENABLED as Record<string, boolean>)[cap]) out.add(cap);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Issuer: the company and project pair, checked on the server.
// ---------------------------------------------------------------------------------------------------------------

export type IssuerRefusal = 'invalid_pair' | 'project_not_found' | 'project_has_no_company' | 'company_mismatch' | 'company_not_found' | 'company_archived';
export type IssuerResult = { ok: true; company_id: number; project_id: number } | { ok: false; code: IssuerRefusal };

/**
 * The issuing company of a formal deal is the project's own `projects.company_id` (migration 189). The caller's
 * active company, an investor firm, a broker or a GP operator never substitutes for it: the pair is accepted only
 * when the named company IS the project's company, the project is live, and the company exists and is not archived.
 * A project with no company is refused: pre-company preparation is not a deal.
 */
export async function resolveIssuerPair(env: Env, input: { company_id: unknown; project_id: unknown }): Promise<IssuerResult> {
  const companyId = Number(input.company_id);
  const projectId = Number(input.project_id);
  if (!Number.isSafeInteger(companyId) || companyId <= 0 || !Number.isSafeInteger(projectId) || projectId <= 0) return { ok: false, code: 'invalid_pair' };
  const project = await env.DB.prepare('SELECT id, company_id FROM projects WHERE id = ? AND deleted_at IS NULL')
    .bind(projectId).first<{ id: number; company_id: number | null }>();
  if (!project) return { ok: false, code: 'project_not_found' };
  if (project.company_id == null) return { ok: false, code: 'project_has_no_company' };
  if (Number(project.company_id) !== companyId) return { ok: false, code: 'company_mismatch' };
  const company = await env.DB.prepare('SELECT id, archived_at FROM company_profiles WHERE id = ?')
    .bind(companyId).first<{ id: number; archived_at: string | null }>();
  if (!company) return { ok: false, code: 'company_not_found' };
  if (company.archived_at) return { ok: false, code: 'company_archived' };
  return { ok: true, company_id: companyId, project_id: projectId };
}

/**
 * Whether a released/reviewed revision's pinned issuer still matches the project's current company. A mismatch
 * (the project moved) invalidates a working approval and is surfaced for reconciliation; it never rewrites the
 * revision, a contract or a commitment.
 */
export function issuerDrift(pinned: { company_id: unknown; project_id: unknown }, current: { company_id: unknown } | null): 'same' | 'moved' | 'detached' {
  if (!current || current.company_id == null) return 'detached';
  return Number(current.company_id) === Number(pinned.company_id) ? 'same' : 'moved';
}

// ---------------------------------------------------------------------------------------------------------------
// Projections: named allowlists. Nothing is serialised whole and trimmed afterwards.
// ---------------------------------------------------------------------------------------------------------------

/** The content keys a revision may hold (ADP-02 validates values; unknown keys are never projected). */
export const REVISION_CONTENT_KEYS = [
  'title', 'summary', 'description', 'sector', 'website', 'instrument', 'target_raise', 'minimum_check',
  'valuation_cap', 'carry_pct', 'management_fee_pct', 'spv_jurisdiction', 'closing_deadline', 'currency',
  'internal_notes', 'evidence_refs', 'audience_manifest',
  // D5456 §9 (owner answer A): the nine brief sections and #6196's proposed terms.
  'brief_executive_summary', 'brief_investment_thesis', 'brief_problem_product', 'brief_market', 'brief_team',
  'brief_traction', 'brief_use_of_funds', 'brief_risks_mitigations', 'brief_open_questions',
  'discount_pct', 'pro_rata', 'information_rights', 'information_rights_note', 'board_seat', 'board_seat_count',
] as const;

export const PROJECTIONS = {
  /** The authoring admin: the working revision, everything. */
  authoring: { meta: ['uid', 'preparation_state', 'publication_state', 'company_id', 'project_id', 'deal_id', 'lock_version', 'updated_at'], content: REVISION_CONTENT_KEYS },
  /** The reviewer: the submitted revision, no internal notes. */
  review: { meta: ['uid', 'preparation_state', 'company_id', 'project_id', 'updated_at'], content: REVISION_CONTENT_KEYS.filter((k) => k !== 'internal_notes') },
  /** An eligible marketplace reader: the released revision's teaser, no terms beyond the headline. */
  marketplace_teaser: { meta: ['deal_id'], content: ['title', 'summary', 'sector', 'instrument', 'currency'] },
  /** An invited or NDA-authorised investor: the released revision's offering material, no internal or audience fields. */
  investor: { meta: ['deal_id'], content: ['title', 'summary', 'description', 'sector', 'website', 'instrument', 'target_raise', 'minimum_check', 'valuation_cap', 'carry_pct', 'management_fee_pct', 'spv_jurisdiction', 'closing_deadline', 'currency', 'evidence_refs'] },
} as const satisfies Record<string, { meta: readonly string[]; content: readonly string[] }>;
export type ProjectionName = keyof typeof PROJECTIONS;

/** Which revision pointer each projection reads. Audience projections read only the released revision. */
export const PROJECTION_REVISION: Record<ProjectionName, 'working_revision_id' | 'submitted_revision_id' | 'released_revision_id'> = {
  authoring: 'working_revision_id', review: 'submitted_revision_id', marketplace_teaser: 'released_revision_id', investor: 'released_revision_id',
};

/**
 * Builds a projection by copying allowlisted keys only. An audience projection of a preparation that is not
 * `listed` is null: the caller answers as it would for a deal that does not exist.
 */
export function project(name: ProjectionName, prep: Record<string, unknown>, revision: { id?: unknown; content: Record<string, unknown> } | null): Record<string, unknown> | null {
  const spec = PROJECTIONS[name];
  const pointer = PROJECTION_REVISION[name];
  if (!revision || revision.id == null || Number(revision.id) !== Number(prep[pointer])) return null;
  if ((name === 'marketplace_teaser' || name === 'investor') && classifyPreparation(prep as PreparationMeta) !== 'listed') return null;
  const out: Record<string, unknown> = {};
  for (const k of spec.meta) if (Object.hasOwn(prep, k)) out[k] = prep[k];
  const content: Record<string, unknown> = {};
  for (const k of spec.content) if (Object.hasOwn(revision.content, k)) content[k] = revision.content[k];
  out.content = content;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The admin queue read: scoped, paginated, counted over the same population.
// ---------------------------------------------------------------------------------------------------------------

export const QUEUE_PAGE_MAX = 100;
export const QUEUE_QUERY_COUNT = 2;

export type QueueCursor = { updated_at: string; id: number };
export function encodeCursor(c: QueueCursor): string { return btoa(JSON.stringify([c.updated_at, c.id])); }
export function decodeCursor(raw: unknown): QueueCursor | null {
  if (typeof raw !== 'string' || !raw || raw.length > 200) return null;
  try {
    const [u, id] = JSON.parse(atob(raw));
    if (typeof u !== 'string' || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(u) || !Number.isSafeInteger(id) || id <= 0) return null;
    return { updated_at: u, id };
  } catch { return null; }
}

/** One literal page statement and one literal count; every value is bound (no text is built from a request). */
const QUEUE_PAGE_SQL = `SELECT uid, scope_code, company_id, project_id, deal_id, origin, preparation_state, publication_state,
    working_revision_id, submitted_revision_id, approved_revision_id, released_revision_id, lock_version, updated_at, id
  FROM deal_preparations
  WHERE scope_code = ? AND (? IS NULL OR preparation_state = ?)
    AND (? IS NULL OR updated_at < ? OR (updated_at = ? AND id < ?))
  ORDER BY updated_at DESC, id DESC LIMIT ?`;
const QUEUE_COUNT_SQL = `SELECT COUNT(*) AS n FROM deal_preparations WHERE scope_code = ? AND (? IS NULL OR preparation_state = ?)`;

/**
 * One page of this deployment's preparations, newest edit first with `id` as the tie-breaker, and the total of the
 * same filtered population. Exactly `QUEUE_QUERY_COUNT` statements, each bound. Metadata only: no revision content
 * is read, so a queue page cannot carry a title or an amount. Refuses (returns null) for a caller without `read`.
 */
export async function readPreparationQueue(
  env: Env, user: User, ctx: CapabilityContext,
  opts: { preparation_state?: unknown; limit?: unknown; cursor?: unknown } = {},
): Promise<{ items: any[]; total: number; next_cursor: string | null } | null> {
  if (!preparationCapabilities(env, user, null, ctx).has('read')) return null;
  const scope = deploymentScope(env);
  const state = typeof opts.preparation_state === 'string' && (PREPARATION_STATES as readonly string[]).includes(opts.preparation_state) ? opts.preparation_state : null;
  const n = Number(opts.limit);
  const limit = Number.isSafeInteger(n) && n > 0 ? Math.min(n, QUEUE_PAGE_MAX) : 25;
  const cursor = decodeCursor(opts.cursor);
  const cu = cursor?.updated_at ?? null;
  const page = await env.DB.prepare(QUEUE_PAGE_SQL)
    .bind(scope, state, state, cu, cu, cu, cursor?.id ?? null, limit + 1).all<any>();
  const total = await env.DB.prepare(QUEUE_COUNT_SQL).bind(scope, state, state).first<{ n: number }>();
  const rows = page.results || [];
  const more = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return {
    items: items.map(({ id: _id, scope_code: _s, ...rest }) => rest),
    total: Number(total?.n ?? 0),
    next_cursor: more && last ? encodeCursor({ updated_at: String(last.updated_at), id: Number(last.id) }) : null,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Legacy: a read-only, schema-and-aggregate inventory and a classifier for the documented outcomes.
// ---------------------------------------------------------------------------------------------------------------

export type LegacyFacts = {
  has_preparation: boolean;
  project_deleted: boolean;
  project_company_id: number | null;
  invitations: number;
  commitments: number;
  confirmed_commitments: number;
  signed_documents: number;
  status: string | null;
};

/**
 * The outcome codes D5454.md documents for a deal with no preparation row. None records a review or an approval,
 * and none changes visibility: the visible-deal mapping is the owner's decision (D5454.md, owner question Q1).
 *
 *   legacy_transactional_preserved  invited, committed, funded or signed history: existing access survives as is
 *   legacy_visible_unreviewed       listed today with no relationship: kept as today, marked unreviewed, pending Q1
 *   legacy_no_issuer                the project has no company: cannot become a preparation without a reviewed link
 *   legacy_archived                 the venture is deleted/archived: stays out of every reader, history kept
 *   legacy_unknown_exposure         a status this contract does not recognise: owner review, nothing inferred
 *   preparation_managed             already has a preparation row: classified by `classifyPreparation` instead
 */
export type LegacyOutcome = 'legacy_transactional_preserved' | 'legacy_visible_unreviewed' | 'legacy_no_issuer'
  | 'legacy_archived' | 'legacy_unknown_exposure' | 'preparation_managed';

const KNOWN_STATUSES = new Set(['applied', 'scored', 'active', 'funded', 'rejected']);

export function classifyLegacyDeal(f: LegacyFacts): LegacyOutcome {
  if (f.has_preparation) return 'preparation_managed';
  if (f.project_deleted) return 'legacy_archived';
  if (f.status == null || !KNOWN_STATUSES.has(f.status)) return 'legacy_unknown_exposure';
  if (f.invitations > 0 || f.commitments > 0 || f.confirmed_commitments > 0 || f.signed_documents > 0 || f.status === 'funded') return 'legacy_transactional_preserved';
  if (f.project_company_id == null) return 'legacy_no_issuer';
  return 'legacy_visible_unreviewed';
}

/**
 * The read-only inventory query: one row of COUNTS per outcome class, no id, name, title or amount. Run against a
 * copy only with the owner's approval; this code never runs it against production (AGENTS.md "Production D1").
 */
export const LEGACY_INVENTORY_SQL = `SELECT
    SUM(CASE WHEN p.deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS archived,
    SUM(CASE WHEN p.deleted_at IS NULL AND d.status NOT IN ('applied','scored','active','funded','rejected') THEN 1 ELSE 0 END) AS unknown_exposure,
    SUM(CASE WHEN p.deleted_at IS NULL AND d.status IN ('applied','scored','active','funded','rejected')
              AND (d.status = 'funded' OR EXISTS (SELECT 1 FROM deal_invitations i WHERE i.deal_id = d.id)
                   OR EXISTS (SELECT 1 FROM commitments k WHERE k.deal_id = d.id)
                   OR EXISTS (SELECT 1 FROM legal_documents ld WHERE ld.deal_id = d.id AND ld.status = 'signed')) THEN 1 ELSE 0 END) AS transactional,
    SUM(CASE WHEN p.deleted_at IS NULL AND d.status IN ('applied','scored','active','rejected')
              AND NOT EXISTS (SELECT 1 FROM deal_invitations i WHERE i.deal_id = d.id)
              AND NOT EXISTS (SELECT 1 FROM commitments k WHERE k.deal_id = d.id)
              AND NOT EXISTS (SELECT 1 FROM legal_documents ld WHERE ld.deal_id = d.id AND ld.status = 'signed')
              AND p.company_id IS NULL THEN 1 ELSE 0 END) AS no_issuer,
    SUM(CASE WHEN p.deleted_at IS NULL AND d.status IN ('applied','scored','active','rejected')
              AND NOT EXISTS (SELECT 1 FROM deal_invitations i WHERE i.deal_id = d.id)
              AND NOT EXISTS (SELECT 1 FROM commitments k WHERE k.deal_id = d.id)
              AND NOT EXISTS (SELECT 1 FROM legal_documents ld WHERE ld.deal_id = d.id AND ld.status = 'signed')
              AND p.company_id IS NOT NULL THEN 1 ELSE 0 END) AS visible_unreviewed
  FROM deals d JOIN projects p ON p.id = d.project_id
  WHERE NOT EXISTS (SELECT 1 FROM deal_preparations dp WHERE dp.deal_id = d.id)`;
