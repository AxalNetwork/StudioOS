/**
 * D5457 (#5457, ADP-03) — the package's source adapters: resolve a manifest's items against their canonical stores,
 * page a source picker, read the intended recipients' existing access, and decide release and retrieval admission.
 * Contract: `documentation/architecture/decisions/D5457.md`.
 *
 * SCOPE. Every read is bound to the issuer's project (`deal_preparations.project_id`, D5454). An item that belongs
 * to another project resolves to `out_of_scope` with no name, version or date: one studio's package can neither
 * select nor reveal another's file. Selecting the company does not open every project it owns.
 *
 * THE STORE'S OWN RULES DECIDE. A data-room file keeps its Trash stamp, `access_tier`, expiry, NDA visibility and
 * grant folder scope (`dataRoomAccess.tierAdmits`); a Raise evidence item keeps its pinning and its founder-chosen
 * sharing (`private` and bank/quote values never leave). The administrator being able to read a source is not
 * permission to redistribute it, and a pinned version never preserves access after a revocation: admission is
 * decided from a fresh read at release and again at retrieval.
 *
 * BOUNDED. `resolveManifestSources` runs one statement per integrated kind present (at most three);
 * `pickSources` one per page; `readRecipientFacts` at most two. A failed read marks only its own kind or recipients
 * `unreadable`; it never becomes an empty, passed or "not found" answer. No AI call, no external call, no DDL, no
 * write. Logs carry codes and counts only.
 */
import type { Env } from '../types';
import { expiryMs, tierAdmits, type FolderScope } from './dataRoomAccess';
import {
  SOURCE_KINDS, type ItemPurpose, type ManifestItem, type ReleaseAudience, type SourceCategory, type SourceKind,
  canonicalJson, sha256Hex,
} from './dealPackageManifest';

export type SourceStatus =
  | 'available' | 'version_changed' | 'withdrawn' | 'expired' | 'restricted'
  | 'out_of_scope' | 'not_found' | 'unreadable' | 'unavailable';

/** How a store gates the item for an outside reader: `open`, behind an NDA, or only for a committed investor. */
export type SourceAccess = { visibility: 'open' | 'nda'; tier: 'invited' | 'committed'; folder_id: number | null; expires_at: string | null };

export type ResolvedItem = {
  kind: SourceKind; ref: string; version: number; purpose: ItemPurpose;
  status: SourceStatus;
  /** The source word, or null when the store records none (shown as Not recorded). */
  category: SourceCategory | null;
  /** The source's own date, or null when not recorded. Never the read time. */
  as_of: string | null;
  current_version: number | null;
  /** Internal name for the authoring and review views only. Null for anything outside the issuer's scope. */
  label: string | null;
  access: SourceAccess | null;
  /** A newer version exists while the pinned one is still readable (decks keep every version). */
  superseded: boolean;
};

const blank = (item: ManifestItem, status: SourceStatus): ResolvedItem => ({
  kind: item.kind, ref: item.ref, version: item.version, purpose: item.purpose, status,
  category: null, as_of: null, current_version: null, label: null, access: null, superseded: false,
});

const day = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const FILE_CATEGORIES: Record<string, SourceCategory> = { document: 'document', connector: 'connector', signed: 'signed' };
const EVIDENCE_CATEGORIES = new Set<SourceCategory>(['connector', 'document', 'recorded', 'signed', 'typed']);

// ---------------------------------------------------------------------------------------------------------------
// Per-kind resolvers: one statement each, every ref bound through json_each.
// ---------------------------------------------------------------------------------------------------------------

const FILE_SQL = `SELECT f.uid, f.project_id, f.name, f.folder_id, f.visibility, f.access_tier, f.access_expires_at,
    f.source_kind, f.updated_at, f.removed_at, fo.visibility AS folder_visibility,
    (SELECT COALESCE(MAX(v.version), 0) + 1 FROM data_room_file_versions v WHERE v.file_id = f.id) AS current_version
  FROM data_room_files f LEFT JOIN data_room_folders fo ON fo.id = f.folder_id
  WHERE f.uid IN (SELECT value FROM json_each(?))`;

function resolveFile(item: ManifestItem, row: any, projectId: number, now: number): ResolvedItem {
  if (!row) return blank(item, 'not_found');
  if (Number(row.project_id) !== projectId) return blank(item, 'out_of_scope');
  const out = blank(item, 'available');
  out.label = typeof row.name === 'string' ? row.name.slice(0, 200) : null;
  out.category = FILE_CATEGORIES[String(row.source_kind)] ?? null;
  out.as_of = day(row.updated_at);
  out.current_version = Number(row.current_version) || null;
  const tier = row.access_tier == null || row.access_tier === '' ? 'invited' : String(row.access_tier);
  const vis = (v: unknown) => (v == null || v === 'open' ? 'open' : v === 'nda' ? 'nda' : null);
  const fileVis = vis(row.visibility);
  const folderVis = row.folder_id == null ? 'open' : vis(row.folder_visibility);
  if (row.removed_at != null) { out.status = 'withdrawn'; return out; }
  // `nobody`, an unknown tier or an unknown visibility admits no outside reader.
  if ((tier !== 'invited' && tier !== 'committed') || fileVis == null || folderVis == null) { out.status = 'restricted'; return out; }
  out.access = {
    visibility: fileVis === 'nda' || folderVis === 'nda' ? 'nda' : 'open', tier: tier as 'invited' | 'committed',
    folder_id: row.folder_id == null ? null : Number(row.folder_id), expires_at: row.access_expires_at ?? null,
  };
  if (row.access_expires_at != null && String(row.access_expires_at).trim() !== '') {
    const at = expiryMs(row.access_expires_at);
    if (at == null || at <= now) { out.status = 'expired'; return out; }
  }
  if (out.current_version !== item.version) out.status = 'version_changed';
  return out;
}

const EVIDENCE_SQL = `SELECT uid, project_id, kind, source_label, summary, visibility, private_reason, state, version, observed_on
  FROM raise_evidence_items WHERE uid IN (SELECT value FROM json_each(?))`;

function resolveEvidence(item: ManifestItem, row: any, projectId: number): ResolvedItem {
  if (!row) return blank(item, 'not_found');
  if (Number(row.project_id) !== projectId) return blank(item, 'out_of_scope');
  const out = blank(item, 'available');
  out.label = typeof row.summary === 'string' ? row.summary.slice(0, 200) : null;
  out.category = EVIDENCE_CATEGORIES.has(row.source_label) ? row.source_label : null;
  out.as_of = day(row.observed_on);
  out.current_version = Number(row.version) || null;
  if (row.state !== 'pinned') { out.status = 'withdrawn'; return out; }
  // A bank figure or a quote is private by the founder's rule (D1263), whatever its sharing says.
  if (row.private_reason != null || (row.visibility !== 'summary' && row.visibility !== 'after_nda')) { out.status = 'restricted'; return out; }
  out.access = { visibility: row.visibility === 'after_nda' ? 'nda' : 'open', tier: 'invited', folder_id: null, expires_at: null };
  if (out.current_version !== item.version) out.status = 'version_changed';
  return out;
}

const DECK_SQL = `SELECT id, project_id, version, title, is_current, created_at
  FROM pitch_decks WHERE id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`;

function resolveDeck(item: ManifestItem, row: any, projectId: number): ResolvedItem {
  if (!row) return blank(item, 'not_found');
  if (Number(row.project_id) !== projectId) return blank(item, 'out_of_scope');
  const out = blank(item, 'available');
  out.label = typeof row.title === 'string' ? row.title.slice(0, 200) : null;
  out.category = 'document';
  out.as_of = day(row.created_at);
  out.current_version = Number(row.version) || null;
  // A deck reaches an outside reader through the data room's rules here (D5457 §3): an open, invited-tier item.
  out.access = { visibility: 'open', tier: 'invited', folder_id: null, expires_at: null };
  if (out.current_version !== item.version) { out.status = 'version_changed'; return out; }
  out.superseded = Number(row.is_current) !== 1;
  return out;
}

const RESOLVERS: Partial<Record<SourceKind, { sql: string; key: (row: any) => string; refs: (items: ManifestItem[]) => unknown[] }>> = {
  data_room_file: { sql: FILE_SQL, key: (r) => String(r.uid), refs: (items) => items.map((i) => i.ref) },
  raise_evidence_item: { sql: EVIDENCE_SQL, key: (r) => String(r.uid), refs: (items) => items.map((i) => i.ref) },
  // Deck refs are row ids; a ref that is not a whole number names no deck and is never bound as one.
  pitch_deck: { sql: DECK_SQL, key: (r) => String(r.id), refs: (items) => items.filter((i) => /^[1-9]\d{0,15}$/.test(i.ref)).map((i) => Number(i.ref)) },
};

/** Statements `resolveManifestSources` may run: one per integrated kind. */
export const RESOLVE_QUERY_MAX = Object.keys(RESOLVERS).length;

/**
 * Resolves every manifest item against its canonical store, in manifest order. Not-integrated kinds are
 * `unavailable` without a read. A kind whose read fails marks its own items `unreadable` and leaves the others.
 */
export async function resolveManifestSources(
  env: Env, projectId: number, items: readonly ManifestItem[], now: number = Date.now(),
): Promise<ResolvedItem[]> {
  const byKind = new Map<SourceKind, ManifestItem[]>();
  for (const it of items) byKind.set(it.kind, [...(byKind.get(it.kind) ?? []), it]);
  const rowsByKind = new Map<SourceKind, Map<string, any> | 'unreadable'>();
  await Promise.all([...byKind].map(async ([kind, list]) => {
    const r = RESOLVERS[kind];
    if (!SOURCE_KINDS[kind].integrated || !r) return;
    const refs = r.refs(list);
    if (refs.length === 0) { rowsByKind.set(kind, new Map()); return; }
    try {
      const res = await env.DB.prepare(r.sql).bind(JSON.stringify(refs)).all<any>();
      rowsByKind.set(kind, new Map((res.results || []).map((row) => [r.key(row), row])));
    } catch {
      console.warn('[deal_package] source read unreadable', kind, list.length);
      rowsByKind.set(kind, 'unreadable');
    }
  }));
  return items.map((it) => {
    if (!SOURCE_KINDS[it.kind].integrated) return blank(it, 'unavailable');
    const rows = rowsByKind.get(it.kind);
    if (rows === 'unreadable' || rows == null) return blank(it, 'unreadable');
    const row = rows.get(it.ref);
    if (it.kind === 'data_room_file') return resolveFile(it, row, projectId, now);
    if (it.kind === 'raise_evidence_item') return resolveEvidence(it, row, projectId);
    return resolveDeck(it, row, projectId);
  });
}

/**
 * The digest of what the sources were when checked: kind, ref, status, current version and as-of of each item. A
 * new document version, a revocation or an expiry changes it, so a preflight computed before is no longer current.
 */
export async function sourcesDigest(resolved: readonly ResolvedItem[]): Promise<string> {
  const rows = resolved.map((r) => [r.kind, r.ref, r.status, r.current_version, r.as_of, r.access]).sort((a, b) => (canonicalJson(a) < canonicalJson(b) ? -1 : 1));
  return sha256Hex(canonicalJson(rows));
}

// ---------------------------------------------------------------------------------------------------------------
// Release admission: may this audience receive this item at all?
// ---------------------------------------------------------------------------------------------------------------

export type AudienceAdmission = 'admitted' | 'not_available' | 'exceeds_audience';

/**
 * The release-level rule. Only an `available` item is ever admitted. A marketplace teaser carries no document: only
 * Raise evidence the founder shared as a summary. An invited audience receives open, invited-tier items; an NDA
 * audience also NDA items. A committed-only item belongs to closing, not to any release audience.
 */
export function admitsAudience(item: ResolvedItem, audience: ReleaseAudience): AudienceAdmission {
  if (item.status !== 'available' || !item.access) return 'not_available';
  if (item.access.tier !== 'invited') return 'exceeds_audience';
  if (audience === 'marketplace_teaser') return item.kind === 'raise_evidence_item' && item.access.visibility === 'open' ? 'admitted' : 'exceeds_audience';
  if (audience === 'invited') return item.access.visibility === 'open' ? 'admitted' : 'exceeds_audience';
  if (audience === 'invited_nda') return 'admitted';
  return 'exceeds_audience';
}

// ---------------------------------------------------------------------------------------------------------------
// Recipients: their existing access to this project, read once for all of them.
// ---------------------------------------------------------------------------------------------------------------

export type RecipientFacts = {
  user_id: number;
  state: 'recorded' | 'not_found' | 'inactive' | 'unreadable';
  /** The newest live data-room grant's folder scope (null = every folder), or undefined when there is no grant. */
  grant?: { id: number; folders: FolderScope };
  nda_signed: boolean;
  committed: boolean;
};

const RECIPIENTS_SQL = `SELECT u.id, u.is_active,
    (SELECT g.id FROM data_room_grants g WHERE g.project_id = ? AND g.investor_user_id = u.id AND g.status = 'active'
       AND (g.expires_at IS NULL OR datetime(g.expires_at) > datetime('now')) ORDER BY g.id DESC LIMIT 1) AS grant_id,
    (SELECT g.folders_scoped FROM data_room_grants g WHERE g.project_id = ? AND g.investor_user_id = u.id AND g.status = 'active'
       AND (g.expires_at IS NULL OR datetime(g.expires_at) > datetime('now')) ORDER BY g.id DESC LIMIT 1) AS folders_scoped,
    EXISTS (SELECT 1 FROM raise_prospects rp WHERE rp.project_id = ? AND rp.stage = 'committed'
       AND rp.email IS NOT NULL AND u.email IS NOT NULL AND LOWER(rp.email) = LOWER(u.email)) AS committed,
    EXISTS (SELECT 1 FROM pairwise_ndas n JOIN users owner ON owner.id = n.party_a_user_id
       JOIN projects p ON p.founder_id = owner.founder_id
       WHERE p.id = ? AND COALESCE(owner.is_active, 1) = 1 AND n.party_b_user_id = u.id AND n.status = 'active'
         AND (n.valid_until IS NULL OR datetime(n.valid_until) > datetime('now'))) AS nda_signed
  FROM users u WHERE u.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`;

const SCOPE_SQL = `WITH RECURSIVE tree(grant_id, id) AS (
    SELECT gf.grant_id, f.id FROM data_room_grant_folders gf
      JOIN data_room_folders f ON f.id = gf.folder_id AND f.project_id = ?
     WHERE gf.grant_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
    UNION
    SELECT t.grant_id, f.id FROM data_room_folders f JOIN tree t ON f.parent_id = t.id WHERE f.project_id = ?
  ) SELECT grant_id, id FROM tree`;

export const RECIPIENT_QUERY_MAX = 2;

/**
 * Each intended recipient's existing standing on the issuer's project: active account, live grant and its folder
 * scope, an active NDA with the venture's founder, a committed prospect row. These are the same facts the investor
 * data room reads (`raiseEvidence.readableRoomFiles`). Nothing here creates a grant. A failed read makes every
 * recipient `unreadable`; a scoped grant whose folders cannot be read opens no folder.
 */
export async function readRecipientFacts(env: Env, projectId: number, recipients: readonly number[]): Promise<RecipientFacts[]> {
  if (recipients.length === 0) return [];
  const unreadable = () => recipients.map((id) => ({ user_id: id, state: 'unreadable' as const, nda_signed: false, committed: false }));
  let rows: any[];
  try {
    rows = (await env.DB.prepare(RECIPIENTS_SQL).bind(projectId, projectId, projectId, projectId, JSON.stringify(recipients)).all<any>()).results || [];
  } catch {
    console.warn('[deal_package] recipient facts unreadable', recipients.length);
    return unreadable();
  }
  const scoped = rows.filter((r) => r.grant_id != null && Number(r.folders_scoped) === 1).map((r) => Number(r.grant_id));
  const scopes = new Map<number, Set<number>>(scoped.map((g) => [g, new Set<number>()]));
  if (scoped.length > 0) {
    try {
      const res = await env.DB.prepare(SCOPE_SQL).bind(projectId, JSON.stringify(scoped), projectId).all<{ grant_id: number; id: number }>();
      for (const r of res.results || []) scopes.get(Number(r.grant_id))?.add(Number(r.id));
    } catch {
      // Fail closed: each scoped grant keeps its empty set, which opens nothing.
      console.warn('[deal_package] grant folder scope unreadable', scoped.length);
    }
  }
  const byId = new Map(rows.map((r) => [Number(r.id), r]));
  return recipients.map((id) => {
    const r = byId.get(id);
    if (!r) return { user_id: id, state: 'not_found', nda_signed: false, committed: false };
    if (Number(r.is_active) !== 1) return { user_id: id, state: 'inactive', nda_signed: false, committed: false };
    const grant = r.grant_id == null ? undefined : { id: Number(r.grant_id), folders: Number(r.folders_scoped) === 1 ? (scopes.get(Number(r.grant_id)) ?? new Set<number>()) : null };
    return { user_id: id, state: 'recorded', ...(grant ? { grant } : {}), nda_signed: Number(r.nda_signed) === 1, committed: Number(r.committed) === 1 };
  });
}

/**
 * Whether one recipient may receive one item now. Called at release for the readiness view and again, with a fresh
 * resolution and fresh facts, when the investor retrieves the package (ADP-04): a snapshot never outlives the
 * store's own revocation, expiry or NDA rule.
 */
export function retrievalDecision(item: ResolvedItem, audience: ReleaseAudience, r: RecipientFacts, now: number = Date.now()): 'deliver' | 'withhold' {
  if (admitsAudience(item, audience) !== 'admitted' || !item.access) return 'withhold';
  if (r.state !== 'recorded') return 'withhold';
  if (item.access.visibility === 'nda' && !r.nda_signed) return 'withhold';
  if (item.kind === 'raise_evidence_item') return r.grant || r.committed ? 'deliver' : 'withhold';
  // Files and decks follow the data room: a live grant, its tier, expiry and folder scope (D691, D1103).
  if (!r.grant) return 'withhold';
  const folders = item.kind === 'pitch_deck' ? null : r.grant.folders;
  return tierAdmits({ access_tier: item.access.tier, access_expires_at: item.access.expires_at, folder_id: item.access.folder_id }, r.committed, now, folders)
    ? 'deliver' : 'withhold';
}

// ---------------------------------------------------------------------------------------------------------------
// What an investor's view of the manifest may say.
// ---------------------------------------------------------------------------------------------------------------

export type InvestorManifestEntry = { kind: SourceKind; category: string | null; as_of: string | null; purpose: ItemPurpose };

/**
 * The investor-visible manifest: only items this recipient may receive now, each as kind, source word, date and
 * purpose. No ref, no file or deck name, no version, no internal label; a withheld item is counted, never named.
 */
export function investorManifestView(
  resolved: readonly ResolvedItem[], audience: ReleaseAudience, r: RecipientFacts, now: number = Date.now(),
): { items: InvestorManifestEntry[]; withheld: number } {
  const items: InvestorManifestEntry[] = [];
  let withheld = 0;
  for (const it of resolved) {
    if (retrievalDecision(it, audience, r, now) !== 'deliver') { withheld += 1; continue; }
    items.push({ kind: it.kind, category: it.category, as_of: it.as_of, purpose: it.purpose });
  }
  return { items, withheld };
}

// ---------------------------------------------------------------------------------------------------------------
// The source picker: server-side search and keyset pages, one statement a page.
// ---------------------------------------------------------------------------------------------------------------

export const PICKER_PAGE_MAX = 50;
export type PickerRow = { ref: string; version: number | null; label: string | null; as_of: string | null };
export type PickerPage =
  | { state: 'recorded'; kind: SourceKind; rows: PickerRow[]; next_cursor: string | null; read_at: string }
  | { state: 'unavailable' | 'unreadable'; kind: SourceKind; rows: null; next_cursor: null; read_at: string };

const PICKER_SQL: Partial<Record<SourceKind, string>> = {
  data_room_file: `SELECT f.id AS k, f.uid AS ref, f.name AS label, f.updated_at AS as_of,
      (SELECT COALESCE(MAX(v.version), 0) + 1 FROM data_room_file_versions v WHERE v.file_id = f.id) AS version
    FROM data_room_files f
    WHERE f.project_id = ? AND f.removed_at IS NULL AND COALESCE(f.access_tier, 'invited') <> 'nobody'
      AND (? IS NULL OR instr(lower(f.name), lower(?)) > 0) AND (? IS NULL OR f.id < ?)
    ORDER BY f.id DESC LIMIT ?`,
  raise_evidence_item: `SELECT id AS k, uid AS ref, summary AS label, observed_on AS as_of, version
    FROM raise_evidence_items
    WHERE project_id = ? AND state = 'pinned' AND private_reason IS NULL AND visibility IN ('summary', 'after_nda')
      AND (? IS NULL OR instr(lower(summary), lower(?)) > 0) AND (? IS NULL OR id < ?)
    ORDER BY id DESC LIMIT ?`,
  pitch_deck: `SELECT id AS k, CAST(id AS TEXT) AS ref, title AS label, created_at AS as_of, version
    FROM pitch_decks
    WHERE project_id = ? AND (? IS NULL OR instr(lower(COALESCE(title, '')), lower(?)) > 0) AND (? IS NULL OR id < ?)
    ORDER BY id DESC LIMIT ?`,
};

/**
 * One page of the issuer project's selectable sources of a kind, newest first. Only items a release could carry are
 * offered (no Trash, no `nobody` file, no private or unpinned evidence). `cursor` is the previous page's
 * `next_cursor`. A not-integrated kind answers `unavailable`, a failed read `unreadable`: never an empty page.
 * `read_at` lets a client drop a stale response; the release re-resolves every pick regardless.
 */
export async function pickSources(
  env: Env, projectId: number, kind: SourceKind, opts: { cursor?: unknown; limit?: unknown; q?: unknown } = {},
): Promise<PickerPage> {
  const read_at = new Date().toISOString();
  const sql = PICKER_SQL[kind];
  if (!SOURCE_KINDS[kind].integrated || !sql) return { state: 'unavailable', kind, rows: null, next_cursor: null, read_at };
  const limit = Math.min(PICKER_PAGE_MAX, Math.max(1, Math.trunc(Number(opts.limit) || 20)));
  const cursor = typeof opts.cursor === 'string' && /^[1-9]\d{0,15}$/.test(opts.cursor) ? Number(opts.cursor) : null;
  const q = typeof opts.q === 'string' && opts.q.trim() ? opts.q.trim().slice(0, 80) : null;
  try {
    const res = await env.DB.prepare(sql).bind(projectId, q, q, cursor, cursor, limit + 1).all<any>();
    const rows = res.results || [];
    const page = rows.slice(0, limit);
    return {
      state: 'recorded', kind, read_at,
      rows: page.map((r) => ({ ref: String(r.ref), version: Number(r.version) || null, label: typeof r.label === 'string' ? r.label.slice(0, 200) : null, as_of: day(r.as_of) })),
      next_cursor: rows.length > limit ? String(page[page.length - 1].k) : null,
    };
  } catch {
    console.warn('[deal_package] picker unreadable', kind);
    return { state: 'unreadable', kind, rows: null, next_cursor: null, read_at };
  }
}
