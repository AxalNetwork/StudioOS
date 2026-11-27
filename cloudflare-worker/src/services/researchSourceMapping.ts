/**
 * D7746 (#7746) — Research imports: what each staged source record is, the decision taken on it, and the derived
 * five-outcome reconciliation, over #7742's staging store and the served fund catalogue. Routes:
 * `routes/research_source_mappings.ts`.
 *
 * What lives here:
 *   · the exported lists — kinds, decisions, what each kind may take, target types, grounds, reason codes, flags,
 *     outcomes — checked in code, never as CHECKs, so the Companies plan can add a kind or a target without a rebuild;
 *   · candidates for a record, each with its ground, never applied: served catalogue rows by D7326's rule (name key,
 *     manager plus fund number, bare website host) and a retired uid in `research_fund_directory_uid_moves`; and other
 *     staged records in any source with the same name key or host. Only the columns whose role (#7742's column rules)
 *     is `name` or `website` are read for this; prose and every other cell are never read outside the one full read;
 *   · the shared-website mark: a host used by more than one staged record or more than one served row, or a hosting or
 *     social platform on `PLATFORM_HOSTS`. It is never the only ground for a link, and a list naming such a record is
 *     refused whole;
 *   · decide one, preview and apply a list (one D1 batch, fenced on the whole state read for the request, so a decision
 *     or a record landing in between writes nothing), the same list twice writing nothing, history included;
 *   · `markPromoted`, the only writer of the promotion mark, for #7751;
 *   · the outcome, derived on every read and never stored: created, linked, retained privately, rejected, unresolved
 *     (no decision, or decided and awaiting promotion).
 *
 * Nothing here writes a catalogue, statement or company table. No log line, refusal or audit row carries a field
 * value or a note: refusals name codes, source keys, record ids and uids; the history holds ids, codes, the actor and
 * the time; the one audit row a full read writes holds the stored record id.
 */
import type { Env } from '../types';
import { adminAuditStatement } from './adminAudit';
import { SERVED_FUNDS } from './researchFundDirectory';
import { SQL as STORE_SQL, sha256Hex, type Manifest } from './researchSourceRecords';

/* ------------------------------------------------------------------ the lists (exported, checked here) */

/** What a staged record is. The staged kinds are this issue's; a catalogue row's kinds are #7744's. */
export const KINDS = Object.freeze(['manager', 'vehicle', 'accelerator', 'resource', 'company', 'funding_round', 'individual'] as const);
export type Kind = typeof KINDS[number];
export const DECISIONS = Object.freeze(['create', 'link', 'retain_private', 'reject'] as const);
export type Decision = typeof DECISIONS[number];

/** What each kind may take here. A company, a funding round and an individual are only kept privately or rejected. */
export const KIND_DECISIONS: Readonly<Record<Kind, readonly Decision[]>> = Object.freeze({
  manager: DECISIONS, vehicle: DECISIONS, accelerator: DECISIONS, resource: DECISIONS,
  company: ['retain_private', 'reject'], funding_round: ['retain_private', 'reject'], individual: ['retain_private', 'reject'],
});

/** What a `link` points at: a served catalogue uid, or another staged record that carries `create`. */
export const TARGET_TYPES = Object.freeze(['catalogue_fund', 'staged_record'] as const);
export type TargetType = typeof TARGET_TYPES[number];

/** Why two records are one. The first four are offered as candidates; `operator_verified` is a person's check. */
export const GROUNDS = Object.freeze(['name_key', 'manager_fund_number', 'website_host', 'retired_uid', 'operator_verified'] as const);
export type Ground = typeof GROUNDS[number];
const CANDIDATE_GROUNDS: ReadonlySet<string> = new Set(['name_key', 'manager_fund_number', 'website_host', 'retired_uid']);

/** Why a record is kept privately or rejected, or why a person verified a link. */
export const REASON_CODES = Object.freeze([
  'not_an_investor', 'duplicate_in_source', 'out_of_scope', 'insufficient_evidence', 'about_a_person', 'closed_or_defunct',
  'verified_by_operator', 'other',
] as const);
const NEEDS_REASON: ReadonlySet<Decision> = new Set(['retain_private', 'reject']);

/** Outcomes, derived on every read. `unresolved` splits into `no_decision` and `awaiting_promotion`. */
export const OUTCOMES = Object.freeze(['created', 'linked', 'retained_private', 'rejected', 'unresolved'] as const);
export type Outcome = typeof OUTCOMES[number];
export const UNRESOLVED_KINDS = Object.freeze(['no_decision', 'awaiting_promotion'] as const);

/** The flag this file computes. Flags supplied with the package (#7742's store) are listed beside it as supplied. */
export const SHARED_WEBSITE = 'shared_website';

/** Hosting and social platforms: a host on, or under, one of these never identifies one entity. */
export const PLATFORM_HOSTS = Object.freeze([
  'linkedin.com', 'facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'youtube.com', 'tiktok.com', 'medium.com',
  'substack.com', 'github.com', 'github.io', 'gitlab.io', 'notion.site', 'notion.so', 'wixsite.com', 'wix.com',
  'squarespace.com', 'webflow.io', 'carrd.co', 'linktr.ee', 'sites.google.com', 'google.com', 'angel.co', 'wellfound.com',
  'crunchbase.com', 'f6s.com', 'typeform.com', 'wordpress.com', 'blogspot.com', 'tumblr.com', 'about.me', 'gust.com',
  'eventbrite.com', 'calendly.com', 'bit.ly', 'framer.website', 'super.site', 'vercel.app', 'netlify.app', 'herokuapp.com',
]);

/** Tested bounds. */
export const MAPPING_LIMITS = Object.freeze({
  /** Entries one list may carry (preview or apply). */
  MAX_LIST: 500,
  /** A list request's body, refused before it is parsed. */
  MAX_LIST_BYTES: 400_000,
  /** One decision's body. */
  MAX_DECIDE_BYTES: 4_000,
  NOTE_CHARS: 280,
  /** Rows a list page returns; per-record lines a report page returns. */
  PAGE: 100,
  REPORT_LINES: 1_000,
  /** Candidates and history rows a full read returns. */
  CANDIDATES: 50,
  HISTORY: 200,
});

export const AUDIT_ACTIONS = Object.freeze({
  read: 'research_source_mapping_record_read',
  decided: 'research_source_mapping_decided',
  promoted: 'research_source_mapping_promoted',
});

/** A refusal: an HTTP status, a code and names (codes, source keys, record ids, uids), never a value or a note. */
export class MappingRefusal extends Error {
  status: number;
  code: string;
  detail: Record<string, unknown>;
  constructor(status: number, code: string, detail: Record<string, unknown> = {}) {
    super(code);
    this.name = 'MappingRefusal';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

/* ------------------------------------------------------------------ keys (D7326's rule) */

const SEP = '\u001f';
const keyOf = (s: string, i: string) => `${s}${SEP}${i}`;
const SOURCE_KEY = /^[a-z][a-z0-9_.-]{0,99}$/;
const CODE = /^[a-z][a-z0-9_]{0,79}$/;

/** D7326's name key: lower case, without spaces, `.`, `,`, `-`, `_`, quotes, `&`, brackets, tabs or line breaks. */
export function nameKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const key = value.toLowerCase().replace(/[ .,\-_'’&()\t\n\r]/g, '');
  return key || null;
}

/** D7326's bare host: no scheme, path, query, fragment, port, trailing dot or leading `www.`. Similar hosts differ. */
export function bareHost(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let web = value.trim().toLowerCase();
  const scheme = web.indexOf('://');
  if (scheme >= 0) web = web.slice(scheme + 3);
  const end = [web.indexOf('/'), web.indexOf('?'), web.indexOf('#')].filter((i) => i >= 0);
  if (end.length) web = web.slice(0, Math.min(...end));
  const colon = web.indexOf(':');
  if (colon >= 0) web = web.slice(0, colon);
  web = web.replace(/\.+$/, '');
  if (web.startsWith('www.')) web = web.slice(4);
  return web.includes('.') && !/\s/.test(web) ? web : null;
}

export const isPlatformHost = (host: string) => PLATFORM_HOSTS.some((p) => host === p || host.endsWith(`.${p}`));

/* ------------------------------------------------------------------ SQL (constants) */

export const SQL = Object.freeze({
  // Each staged record's current version, with only the cells of its source's `name` and `website` role columns.
  staged: `SELECT r.id, r.source_key, r.provider_record_id,
      (SELECT json_extract(c.value, '$[1]') FROM json_each(r.body_json) c WHERE json_extract(c.value, '$[0]') =
        (SELECT cr.column_name FROM research_source_column_rules cr WHERE cr.source_key = r.source_key AND cr.role = 'name'
          AND cr.class <> 'contact' ORDER BY cr.column_order LIMIT 1) LIMIT 1) AS name_cell,
      (SELECT json_extract(c.value, '$[1]') FROM json_each(r.body_json) c WHERE json_extract(c.value, '$[0]') =
        (SELECT cr.column_name FROM research_source_column_rules cr WHERE cr.source_key = r.source_key AND cr.role = 'website'
          AND cr.class <> 'contact' ORDER BY cr.column_order LIMIT 1) LIMIT 1) AS website_cell
    FROM research_source_records r
    WHERE r.id = (SELECT MAX(r2.id) FROM research_source_records r2 WHERE r2.source_key = r.source_key
      AND r2.provider_record_id = r.provider_record_id)
    ORDER BY r.source_key, r.provider_record_id`,
  // Every link, without its note.
  links: `SELECT source_key, provider_record_id, kind, decision, ground_code, target_type, target_source_key, target_id,
      reason_code, decided_by_user_id, decided_at, revision, promoted_uid, promoted_at
    FROM research_source_record_links`,
  flags: `SELECT record_id, flag_code FROM research_source_flags`,
  // The served catalogue (D597): read once per request. SERVED_FUNDS is a literal of researchFundDirectory.ts.
  served: `SELECT f.uid, f.name, f.fund_number, f.website FROM ${SERVED_FUNDS} AS f`,
  moves: `SELECT old_uid, new_uid FROM research_fund_directory_uid_moves`,
  // The whole state this request read: any decision, promotion or stored record since makes the fence fail.
  fence: `SELECT (SELECT COALESCE(MAX(id), 0) FROM research_source_link_history) AS history,
      (SELECT COUNT(*) || ':' || COALESCE(MAX(id), 0) FROM research_source_records) AS records`,
  // One history row per changed entry, only while the state is the one read (?3 history, ?4 records).
  insertHistory: `INSERT INTO research_source_link_history (batch_uid, event, source_key, provider_record_id, revision, kind,
      decision, ground_code, target_type, target_source_key, target_id, reason_code, actor_user_id, at)
    SELECT ?2, 'decided', json_extract(e.value, '$.s'), json_extract(e.value, '$.i'), json_extract(e.value, '$.rev') + 1,
      json_extract(e.value, '$.k'), json_extract(e.value, '$.d'), json_extract(e.value, '$.g'), json_extract(e.value, '$.tt'),
      json_extract(e.value, '$.ts'), json_extract(e.value, '$.ti'), json_extract(e.value, '$.r'), ?5, ?6
    FROM json_each(?1) e
    WHERE (SELECT COALESCE(MAX(id), 0) FROM research_source_link_history) = ?3
      AND (SELECT COUNT(*) || ':' || COALESCE(MAX(id), 0) FROM research_source_records) = ?4`,
  // The link rows, from this batch's history rows only: a fenced-out batch writes neither.
  upsertLinks: `INSERT INTO research_source_record_links (source_key, provider_record_id, kind, decision, ground_code, target_type,
      target_source_key, target_id, reason_code, note, decided_by_user_id, decided_at, revision)
    SELECT h.source_key, h.provider_record_id, h.kind, h.decision, h.ground_code, h.target_type, h.target_source_key, h.target_id,
      h.reason_code, (SELECT json_extract(e.value, '$.n') FROM json_each(?1) e WHERE json_extract(e.value, '$.s') = h.source_key
        AND json_extract(e.value, '$.i') = h.provider_record_id), h.actor_user_id, h.at, h.revision
    FROM research_source_link_history h WHERE h.batch_uid = ?2 AND h.event = 'decided'
    ON CONFLICT (source_key, provider_record_id) DO UPDATE SET kind = excluded.kind, decision = excluded.decision,
      ground_code = excluded.ground_code, target_type = excluded.target_type, target_source_key = excluded.target_source_key,
      target_id = excluded.target_id, reason_code = excluded.reason_code, note = excluded.note,
      decided_by_user_id = excluded.decided_by_user_id, decided_at = excluded.decided_at, revision = excluded.revision`,
  // The promotion mark: one history row and the mark, both only while the link is the `create` read at its revision.
  insertPromotion: `INSERT INTO research_source_link_history (batch_uid, event, source_key, provider_record_id, revision, kind,
      decision, ground_code, target_type, target_source_key, target_id, reason_code, promoted_uid, actor_user_id, at)
    SELECT ?1, 'promoted', source_key, provider_record_id, revision + 1, kind, decision, ground_code, target_type,
      target_source_key, target_id, reason_code, ?4, ?5, ?6
    FROM research_source_record_links WHERE source_key = ?2 AND provider_record_id = ?3 AND decision = 'create'
      AND promoted_uid IS NULL AND revision = ?7`,
  markPromoted: `UPDATE research_source_record_links SET promoted_uid = ?3, promoted_at = ?4, revision = revision + 1
    WHERE source_key = ?1 AND provider_record_id = ?2 AND decision = 'create' AND promoted_uid IS NULL AND revision = ?5
      AND EXISTS (SELECT 1 FROM research_source_link_history WHERE batch_uid = ?6)`,
  // The one full read.
  recordVersions: `SELECT id, stated_row_hash, body_sha256, hash_checked, captured_at, first_run_uid
    FROM research_source_records WHERE source_key = ?1 AND provider_record_id = ?2 ORDER BY id`,
  recordBody: `SELECT body_json FROM research_source_records WHERE id = ?1`,
  recordFlags: `SELECT column_name, flag_code, detail, rule_version FROM research_source_flags WHERE record_id = ?1 ORDER BY id`,
  notes: `SELECT source_key, provider_record_id, note FROM research_source_record_links
    WHERE (source_key || char(31) || provider_record_id) IN (SELECT value FROM json_each(?1))`,
  linkWithNote: `SELECT note FROM research_source_record_links WHERE source_key = ?1 AND provider_record_id = ?2`,
  history: `SELECT id, batch_uid, event, revision, kind, decision, ground_code, target_type, target_source_key, target_id,
      reason_code, promoted_uid, actor_user_id, at
    FROM research_source_link_history WHERE source_key = ?1 AND provider_record_id = ?2 ORDER BY id LIMIT ?3`,
  // The report's manifest side: every run's manifest and counts, newest first.
  runs: `SELECT uid, status, manifest_json, counts_json, started_at FROM research_source_runs ORDER BY started_at DESC, uid`,
});

/* ------------------------------------------------------------------ the state one request reads */

interface StagedRow { id: number; source_key: string; provider_record_id: string; name_cell: unknown; website_cell: unknown }
export interface LinkRow {
  source_key: string; provider_record_id: string; kind: string; decision: string; ground_code: string | null;
  target_type: string | null; target_source_key: string | null; target_id: string | null; reason_code: string | null;
  decided_by_user_id: number | null; decided_at: string; revision: number; promoted_uid: string | null; promoted_at: string | null;
}
interface ServedRow { uid: string; name: string | null; fund_number: string | null; website: string | null }

export interface Staged {
  key: string; record_id: number; source_key: string; provider_record_id: string;
  label: string | null; name_key: string | null; host: string | null; flags: string[];
}
export interface Candidate {
  target_type: TargetType; target_id: string; target_source_key: string | null; ground: Ground;
  shared_website: boolean; retired: boolean; moved_to: string | null;
}

export interface State {
  staged: Map<string, Staged>;
  links: Map<string, LinkRow>;
  served: Map<string, ServedRow & { name_key: string | null; host: string | null }>;
  moves: Map<string, string>;
  sharedHosts: Set<string>;
  byNameKey: Map<string, string[]>;
  byHost: Map<string, string[]>;
  servedByNameKey: Map<string, string[]>;
  servedByManagerKey: Map<string, string[]>;
  servedByHost: Map<string, string[]>;
  fence: { history: number; records: string };
}

const push = (m: Map<string, string[]>, k: string | null, v: string) => { if (k) { const l = m.get(k); if (l) l.push(v); else m.set(k, [v]); } };

/** Everything a decision or a report needs, in six reads, whatever the store holds. Served rows are read once. */
export async function loadState(db: D1Database): Promise<State> {
  const fence = await db.prepare(SQL.fence).first<{ history: number; records: string }>();
  const [stagedRows, linkRows, flagRows, servedRows, moveRows] = await Promise.all([
    db.prepare(SQL.staged).all<StagedRow>(),
    db.prepare(SQL.links).all<LinkRow>(),
    db.prepare(SQL.flags).all<{ record_id: number; flag_code: string }>(),
    db.prepare(SQL.served).all<ServedRow>(),
    db.prepare(SQL.moves).all<{ old_uid: string; new_uid: string }>(),
  ]);
  const flagsById = new Map<number, Set<string>>();
  for (const f of flagRows.results ?? []) {
    const set = flagsById.get(Number(f.record_id)) ?? new Set<string>();
    set.add(f.flag_code);
    flagsById.set(Number(f.record_id), set);
  }
  const state: State = {
    staged: new Map(), links: new Map(), served: new Map(), moves: new Map(), sharedHosts: new Set(),
    byNameKey: new Map(), byHost: new Map(), servedByNameKey: new Map(), servedByManagerKey: new Map(), servedByHost: new Map(),
    fence: { history: Number(fence?.history ?? 0), records: String(fence?.records ?? '0:0') },
  };
  for (const r of stagedRows.results ?? []) {
    const key = keyOf(r.source_key, r.provider_record_id);
    const label = typeof r.name_cell === 'string' && r.name_cell.trim() ? r.name_cell : null;
    const s: Staged = {
      key, record_id: Number(r.id), source_key: r.source_key, provider_record_id: r.provider_record_id, label,
      name_key: nameKey(label), host: bareHost(r.website_cell), flags: [...(flagsById.get(Number(r.id)) ?? [])].sort(),
    };
    state.staged.set(key, s);
    push(state.byNameKey, s.name_key, key);
    push(state.byHost, s.host, key);
  }
  for (const l of linkRows.results ?? []) state.links.set(keyOf(l.source_key, l.provider_record_id), { ...l, revision: Number(l.revision) });
  for (const m of moveRows.results ?? []) state.moves.set(m.old_uid, m.new_uid);
  for (const f of servedRows.results ?? []) {
    const row = { ...f, name_key: nameKey(f.name), host: bareHost(f.website) };
    state.served.set(f.uid, row);
    push(state.servedByNameKey, row.name_key, f.uid);
    push(state.servedByNameKey, nameKey(f.uid), f.uid);
    push(state.servedByHost, row.host, f.uid);
    // A vehicle row named manager + fund number (optionally "fund" between) offers itself to the manager's key.
    const fnk = nameKey(f.fund_number);
    if (fnk && row.name_key && row.name_key.length > fnk.length && row.name_key.endsWith(fnk)) {
      const manager = row.name_key.slice(0, -fnk.length);
      push(state.servedByManagerKey, manager, f.uid);
      if (manager.endsWith('fund') && manager.length > 4) push(state.servedByManagerKey, manager.slice(0, -4), f.uid);
    }
  }
  for (const [host, keys] of state.byHost) if (keys.length > 1 || isPlatformHost(host)) state.sharedHosts.add(host);
  for (const [host, uids] of state.servedByHost) if (new Set(uids).size > 1 || isPlatformHost(host)) state.sharedHosts.add(host);
  for (const s of state.staged.values()) {
    if (s.host && state.sharedHosts.has(s.host) && !s.flags.includes(SHARED_WEBSITE)) s.flags = [...s.flags, SHARED_WEBSITE].sort();
  }
  return state;
}

export const isSharedWebsite = (state: State, s: Staged) => !!s.host && state.sharedHosts.has(s.host);

/** The candidates for one record, each with its ground. Offered, never applied. */
export function candidatesFor(state: State, s: Staged): Candidate[] {
  const out = new Map<string, Candidate>();
  const add = (c: Omit<Candidate, 'shared_website' | 'retired' | 'moved_to'> & Partial<Candidate>) => {
    const k = `${c.target_type}${SEP}${c.target_source_key ?? ''}${SEP}${c.target_id}${SEP}${c.ground}`;
    if (!out.has(k)) out.set(k, { shared_website: false, retired: false, moved_to: null, ...c });
  };
  const sharedHost = !!s.host && state.sharedHosts.has(s.host);
  if (s.name_key) {
    for (const uid of state.servedByNameKey.get(s.name_key) ?? []) add({ target_type: 'catalogue_fund', target_id: uid, target_source_key: null, ground: 'name_key' });
    for (const uid of state.servedByManagerKey.get(s.name_key) ?? []) add({ target_type: 'catalogue_fund', target_id: uid, target_source_key: null, ground: 'manager_fund_number' });
    const moved = state.moves.get(s.name_key);
    if (moved) add({ target_type: 'catalogue_fund', target_id: s.name_key, target_source_key: null, ground: 'retired_uid', retired: true, moved_to: moved });
    for (const k of state.byNameKey.get(s.name_key) ?? []) {
      if (k === s.key) continue;
      const o = state.staged.get(k)!;
      add({ target_type: 'staged_record', target_id: o.provider_record_id, target_source_key: o.source_key, ground: 'name_key' });
    }
  }
  if (s.host) {
    for (const uid of state.servedByHost.get(s.host) ?? []) add({ target_type: 'catalogue_fund', target_id: uid, target_source_key: null, ground: 'website_host', shared_website: sharedHost });
    for (const k of state.byHost.get(s.host) ?? []) {
      if (k === s.key) continue;
      const o = state.staged.get(k)!;
      add({ target_type: 'staged_record', target_id: o.provider_record_id, target_source_key: o.source_key, ground: 'website_host', shared_website: sharedHost });
    }
  }
  return [...out.values()];
}

/** The number of distinct targets offered. */
export const candidateCount = (state: State, s: Staged) =>
  new Set(candidatesFor(state, s).map((c) => `${c.target_type}${SEP}${c.target_source_key ?? ''}${SEP}${c.target_id}`)).size;

/* ------------------------------------------------------------------ the outcome (derived, never stored) */

export interface Derived { outcome: Outcome; unresolved: typeof UNRESOLVED_KINDS[number] | null; resolved_uid: string | null }

export function outcomeOf(state: State, key: string): Derived {
  const link = state.links.get(key);
  if (!link) return { outcome: 'unresolved', unresolved: 'no_decision', resolved_uid: null };
  const waiting: Derived = { outcome: 'unresolved', unresolved: 'awaiting_promotion', resolved_uid: null };
  switch (link.decision) {
    case 'create':
      return link.promoted_uid ? { outcome: 'created', unresolved: null, resolved_uid: link.promoted_uid } : waiting;
    case 'link': {
      if (link.target_type === 'catalogue_fund' && link.target_id && state.served.has(link.target_id)) {
        return { outcome: 'linked', unresolved: null, resolved_uid: link.target_id };
      }
      if (link.target_type === 'staged_record' && link.target_source_key && link.target_id) {
        const target = state.links.get(keyOf(link.target_source_key, link.target_id));
        if (target?.decision === 'create' && target.promoted_uid && state.served.has(target.promoted_uid)) {
          return { outcome: 'linked', unresolved: null, resolved_uid: target.promoted_uid };
        }
      }
      return waiting;
    }
    case 'retain_private': return { outcome: 'retained_private', unresolved: null, resolved_uid: null };
    case 'reject': return { outcome: 'rejected', unresolved: null, resolved_uid: null };
    default: return waiting;
  }
}

/* ------------------------------------------------------------------ checking a decision */

/** A decision as sent: by (source key, provider record id). */
export interface DecisionInput {
  source_key?: unknown; provider_record_id?: unknown; kind?: unknown; decision?: unknown; ground?: unknown;
  target?: { type?: unknown; id?: unknown; source_key?: unknown } | null; reason?: unknown; note?: unknown;
}
/** A decision once checked, in the link row's shape. */
export interface Checked {
  key: string; source_key: string; provider_record_id: string; kind: Kind; decision: Decision; ground_code: Ground | null;
  target_type: TargetType | null; target_source_key: string | null; target_id: string | null; reason_code: string | null;
  note: string | null;
}

const str = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max;

/** Shape only: codes are on their lists, the note is short, a target is whole. Never echoes the note. */
export function shapeOf(input: DecisionInput, index?: number): Checked {
  const at = index === undefined ? {} : { index };
  if (!input || typeof input !== 'object') throw new MappingRefusal(400, 'decision_invalid', at);
  if (!str(input.source_key, 100) || !SOURCE_KEY.test(input.source_key as string)) throw new MappingRefusal(400, 'source_key_invalid', at);
  if (!str(input.provider_record_id, 200)) throw new MappingRefusal(400, 'provider_record_id_required', at);
  const ref = { ...at, source: input.source_key as string, provider_record_id: input.provider_record_id as string };
  if (!(KINDS as readonly unknown[]).includes(input.kind)) throw new MappingRefusal(400, 'kind_invalid', ref);
  if (!(DECISIONS as readonly unknown[]).includes(input.decision)) throw new MappingRefusal(400, 'decision_invalid', ref);
  const kind = input.kind as Kind;
  const decision = input.decision as Decision;
  if (!KIND_DECISIONS[kind].includes(decision)) throw new MappingRefusal(422, 'decision_not_allowed_for_kind', { ...ref, kind, decision });
  const ground = input.ground ?? null;
  if (ground !== null && !(GROUNDS as readonly unknown[]).includes(ground)) throw new MappingRefusal(400, 'ground_invalid', ref);
  const reason = input.reason ?? null;
  if (reason !== null && !(REASON_CODES as readonly unknown[]).includes(reason)) throw new MappingRefusal(400, 'reason_invalid', ref);
  const note = input.note ?? null;
  if (note !== null && (typeof note !== 'string' || note.length > MAPPING_LIMITS.NOTE_CHARS)) throw new MappingRefusal(400, 'note_invalid', ref);
  const target = input.target ?? null;
  let targetType: TargetType | null = null; let targetId: string | null = null; let targetSource: string | null = null;
  if (target !== null) {
    if (typeof target !== 'object' || !(TARGET_TYPES as readonly unknown[]).includes(target.type) || !str(target.id, 200)) {
      throw new MappingRefusal(400, 'target_invalid', ref);
    }
    targetType = target.type as TargetType;
    targetId = target.id as string;
    if (targetType === 'staged_record') {
      if (!str(target.source_key, 100) || !SOURCE_KEY.test(target.source_key as string)) throw new MappingRefusal(400, 'target_invalid', ref);
      targetSource = target.source_key as string;
    } else if (target.source_key !== undefined && target.source_key !== null) {
      throw new MappingRefusal(400, 'target_invalid', ref);
    }
  }
  if (decision === 'link') {
    if (!targetType) throw new MappingRefusal(400, 'target_required', ref);
    if (!ground) throw new MappingRefusal(400, 'ground_required', ref);
  } else if (targetType || ground) {
    throw new MappingRefusal(400, 'target_not_allowed', ref);
  }
  if (NEEDS_REASON.has(decision) && !reason) throw new MappingRefusal(400, 'reason_required', ref);
  if (ground === 'operator_verified' && !reason) throw new MappingRefusal(400, 'reason_required', ref);
  return {
    key: keyOf(input.source_key as string, input.provider_record_id as string), source_key: input.source_key as string,
    provider_record_id: input.provider_record_id as string, kind, decision, ground_code: ground as Ground | null,
    target_type: targetType, target_source_key: targetSource, target_id: targetId, reason_code: reason as string | null,
    note: note === '' ? null : note as string | null,
  };
}

/** Whether a checked decision is exactly what stands (the note compared through the read that holds it). */
function sameAsLink(c: Checked, l: LinkRow | undefined, note: string | null | undefined): boolean {
  return !!l && l.kind === c.kind && l.decision === c.decision && (l.ground_code ?? null) === c.ground_code &&
    (l.target_type ?? null) === c.target_type && (l.target_source_key ?? null) === c.target_source_key &&
    (l.target_id ?? null) === c.target_id && (l.reason_code ?? null) === c.reason_code && (note ?? null) === c.note;
}

/**
 * The rules against the state with the list laid over it, so a list may carry a `create` and the links to it together.
 * Refuses the whole list on the first breach, naming the record and the code.
 */
export function checkAgainstState(state: State, list: Checked[], notes: Map<string, string | null>): { changed: Checked[]; unchanged: Checked[] } {
  const effective = new Map(state.links);
  for (const c of list) {
    if (!state.staged.has(c.key)) throw new MappingRefusal(404, 'unknown_record', { source: c.source_key, provider_record_id: c.provider_record_id });
  }
  const changed: Checked[] = []; const unchanged: Checked[] = [];
  for (const c of list) {
    const current = state.links.get(c.key);
    if (sameAsLink(c, current, notes.get(c.key))) { unchanged.push(c); continue; }
    if (current?.promoted_uid) throw new MappingRefusal(409, 'record_promoted', { source: c.source_key, provider_record_id: c.provider_record_id, promoted_uid: current.promoted_uid });
    changed.push(c);
    effective.set(c.key, { ...(current ?? { decided_by_user_id: null, decided_at: '', revision: 0, promoted_uid: null, promoted_at: null }),
      source_key: c.source_key, provider_record_id: c.provider_record_id, kind: c.kind, decision: c.decision, ground_code: c.ground_code,
      target_type: c.target_type, target_source_key: c.target_source_key, target_id: c.target_id, reason_code: c.reason_code } as LinkRow);
  }
  for (const c of changed) {
    const ref = { source: c.source_key, provider_record_id: c.provider_record_id };
    const s = state.staged.get(c.key)!;
    if (c.decision === 'link') {
      if (c.target_type === 'catalogue_fund') {
        const moved = state.moves.get(c.target_id!);
        if (moved && !state.served.has(c.target_id!)) throw new MappingRefusal(422, 'target_uid_retired', { ...ref, uid: c.target_id, moved_to: moved });
        if (!state.served.has(c.target_id!)) throw new MappingRefusal(422, 'target_not_served', { ...ref, uid: c.target_id });
      } else {
        const tk = keyOf(c.target_source_key!, c.target_id!);
        if (tk === c.key) throw new MappingRefusal(422, 'self_link', ref);
        if (!state.staged.has(tk)) throw new MappingRefusal(404, 'target_unknown_record', { ...ref, target_source: c.target_source_key, target_record_id: c.target_id });
        const t = effective.get(tk);
        if (t?.decision !== 'create') throw new MappingRefusal(422, 'link_target_not_create', { ...ref, target_source: c.target_source_key, target_record_id: c.target_id });
        if (t.kind !== c.kind) throw new MappingRefusal(422, 'link_kind_mismatch', { ...ref, kind: c.kind, target_kind: t.kind });
      }
      const targetShared = c.target_type === 'catalogue_fund'
        ? !!state.served.get(c.target_id!)?.host && state.sharedHosts.has(state.served.get(c.target_id!)!.host!)
        : (() => { const t = state.staged.get(keyOf(c.target_source_key!, c.target_id!)); return !!t && isSharedWebsite(state, t); })();
      if (c.ground_code === 'website_host' && (isSharedWebsite(state, s) || targetShared)) throw new MappingRefusal(422, 'shared_website_ground', ref);
      if (CANDIDATE_GROUNDS.has(c.ground_code!)) {
        const offered = candidatesFor(state, s).some((k) => k.ground === c.ground_code && k.target_type === c.target_type &&
          k.target_id === c.target_id && (k.target_source_key ?? null) === c.target_source_key && !k.retired);
        // A retired uid is offered under its old uid; the link names where it moved to on the same ground.
        const viaMove = c.ground_code === 'retired_uid' && candidatesFor(state, s).some((k) => k.retired && k.moved_to === c.target_id);
        if (!offered && !viaMove) throw new MappingRefusal(422, 'ground_not_supported', { ...ref, ground: c.ground_code });
      }
    }
    // No chain: a record others link to stays a `create` of their kind.
    if (c.decision !== 'create' || state.links.get(c.key)?.kind !== c.kind) {
      for (const [k, l] of effective) {
        if (k === c.key || l.decision !== 'link' || l.target_type !== 'staged_record') continue;
        if (keyOf(l.target_source_key ?? '', l.target_id ?? '') !== c.key) continue;
        if (c.decision !== 'create') throw new MappingRefusal(409, 'record_is_link_target', { ...ref, linked_from_source: l.source_key, linked_from_record_id: l.provider_record_id });
        if (l.kind !== c.kind) throw new MappingRefusal(422, 'link_kind_mismatch', { ...ref, kind: l.kind, target_kind: c.kind });
      }
    }
  }
  return { changed, unchanged };
}

/* ------------------------------------------------------------------ writing decisions */

/** The standing notes of the named records, read through one bound JSON value. Compared, never returned. */
async function notesFor(db: D1Database, list: Checked[]): Promise<Map<string, string | null>> {
  const rows = (await db.prepare(SQL.notes).bind(JSON.stringify(list.map((c) => c.key)))
    .all<{ source_key: string; provider_record_id: string; note: string | null }>()).results ?? [];
  return new Map(rows.map((r) => [keyOf(r.source_key, r.provider_record_id), r.note ?? null]));
}

/** The preview digest: the list as checked, and each named record's revision and current version. */
async function listDigest(state: State, list: Checked[]): Promise<string> {
  const lines = [...list].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).map((c) => [
    c.source_key, c.provider_record_id, c.kind, c.decision, c.ground_code, c.target_type, c.target_source_key, c.target_id,
    c.reason_code, c.note, state.links.get(c.key)?.revision ?? 0, state.staged.get(c.key)?.record_id ?? 0,
  ]);
  return sha256Hex(JSON.stringify(lines));
}

async function writeChanges(db: D1Database, env: Env, state: State, changed: Checked[], actorId: number, now: Date, audit: Record<string, unknown>) {
  if (!changed.length) return { written: 0, batch_uid: null as string | null };
  const batchUid = crypto.randomUUID();
  const value = JSON.stringify(changed.map((c) => ({
    s: c.source_key, i: c.provider_record_id, k: c.kind, d: c.decision, g: c.ground_code, tt: c.target_type, ts: c.target_source_key,
    ti: c.target_id, r: c.reason_code, n: c.note, rev: state.links.get(c.key)?.revision ?? 0,
  })));
  const res = await db.batch([
    db.prepare(SQL.insertHistory).bind(value, batchUid, state.fence.history, state.fence.records, actorId, now.toISOString()),
    db.prepare(SQL.upsertLinks).bind(value, batchUid),
    adminAuditStatement(env, actorId, AUDIT_ACTIONS.decided, { batch_uid: batchUid, decisions: changed.length, ...audit }, { onlyIfChanged: true }),
  ]);
  const written = Number(res?.[0]?.meta?.changes ?? 0);
  if (written !== changed.length) throw new MappingRefusal(409, 'state_changed');
  return { written, batch_uid: batchUid };
}

/** Decide one record. A shared-website record may be decided here, on a ground other than its host. */
export async function decideOne(db: D1Database, env: Env, actorId: number, input: DecisionInput, now: Date) {
  const c = shapeOf(input);
  const state = await loadState(db);
  const { changed } = checkAgainstState(state, [c], await notesFor(db, [c]));
  const out = await writeChanges(db, env, state, changed, actorId, now, { mode: 'one' });
  const after = await loadState(db);
  return { ...out, unchanged: changed.length === 0, record: rowFor(after, after.staged.get(c.key)!) };
}

function checkList(body: { entries?: unknown }): Checked[] {
  const entries = body?.entries;
  if (!Array.isArray(entries) || entries.length === 0) throw new MappingRefusal(400, 'entries_required');
  if (entries.length > MAPPING_LIMITS.MAX_LIST) throw new MappingRefusal(413, 'list_too_long', { entries: entries.length, max: MAPPING_LIMITS.MAX_LIST });
  const seen = new Set<string>();
  return entries.map((e, index) => {
    const c = shapeOf(e as DecisionInput, index);
    if (seen.has(c.key)) throw new MappingRefusal(400, 'duplicate_entry', { index, source: c.source_key, provider_record_id: c.provider_record_id });
    seen.add(c.key);
    return c;
  });
}

/** A list may not name a shared-website record, as an entry or as a staged target: the whole list is refused. */
function refuseShared(state: State, list: Checked[]) {
  for (const c of list) {
    const named = [state.staged.get(c.key)];
    if (c.target_type === 'staged_record') named.push(state.staged.get(keyOf(c.target_source_key!, c.target_id!)));
    for (const s of named) {
      if (s && isSharedWebsite(state, s)) throw new MappingRefusal(422, 'shared_website_in_list', { source: s.source_key, provider_record_id: s.provider_record_id });
    }
  }
}

/** Preview a list: writes nothing, refuses the whole list on any breach, and answers the digest the apply must name. */
export async function previewList(db: D1Database, body: { entries?: unknown }) {
  const list = checkList(body);
  const state = await loadState(db);
  for (const c of list) if (!state.staged.has(c.key)) throw new MappingRefusal(404, 'unknown_record', { source: c.source_key, provider_record_id: c.provider_record_id });
  refuseShared(state, list);
  const { changed, unchanged } = checkAgainstState(state, list, await notesFor(db, list));
  return { writes: 'none', entries: list.length, would_change: changed.length, unchanged: unchanged.length, preview_digest: await listDigest(state, list) };
}

/** Apply a previewed list in one batch. A stale digest is refused unless the list already stands whole (then nothing is written). */
export async function applyList(db: D1Database, env: Env, actorId: number, body: { entries?: unknown; preview_digest?: unknown }, now: Date) {
  if (typeof body?.preview_digest !== 'string' || !/^[0-9a-f]{64}$/.test(body.preview_digest)) throw new MappingRefusal(400, 'preview_digest_required');
  const list = checkList(body);
  const state = await loadState(db);
  for (const c of list) if (!state.staged.has(c.key)) throw new MappingRefusal(404, 'unknown_record', { source: c.source_key, provider_record_id: c.provider_record_id });
  refuseShared(state, list);
  const { changed, unchanged } = checkAgainstState(state, list, await notesFor(db, list));
  if (changed.length === 0) return { written: 0, unchanged: unchanged.length, batch_uid: null };
  if (await listDigest(state, list) !== body.preview_digest) throw new MappingRefusal(409, 'preview_stale');
  const out = await writeChanges(db, env, state, changed, actorId, now, { mode: 'list', entries: list.length });
  return { ...out, unchanged: unchanged.length };
}

/**
 * The promotion mark, for #7751 only: a `create` that a promotion turned into a served catalogue row. Sets the mark
 * once; the same uid again is a no-op, another uid is refused. Writes one history row in the same batch.
 */
export async function markPromoted(db: D1Database, input: { sourceKey: string; providerRecordId: string; uid: string; actorUserId: number | null; now: Date }) {
  const state = await loadState(db);
  const key = keyOf(input.sourceKey, input.providerRecordId);
  const link = state.links.get(key);
  const ref = { source: input.sourceKey, provider_record_id: input.providerRecordId };
  if (!link) throw new MappingRefusal(404, 'no_decision', ref);
  if (link.decision !== 'create') throw new MappingRefusal(409, 'not_create', ref);
  if (link.promoted_uid) {
    if (link.promoted_uid === input.uid) return { promoted_uid: link.promoted_uid, written: false };
    throw new MappingRefusal(409, 'already_promoted', { ...ref, promoted_uid: link.promoted_uid });
  }
  if (typeof input.uid !== 'string' || !state.served.has(input.uid)) throw new MappingRefusal(422, 'target_not_served', { ...ref, uid: String(input.uid) });
  const batchUid = crypto.randomUUID();
  const at = input.now.toISOString();
  const res = await db.batch([
    db.prepare(SQL.insertPromotion).bind(batchUid, input.sourceKey, input.providerRecordId, input.uid, input.actorUserId ?? null, at, link.revision),
    db.prepare(SQL.markPromoted).bind(input.sourceKey, input.providerRecordId, input.uid, at, link.revision, batchUid),
  ]);
  if (!Number(res?.[1]?.meta?.changes ?? 0)) throw new MappingRefusal(409, 'state_changed', ref);
  return { promoted_uid: input.uid, written: true };
}

/* ------------------------------------------------------------------ reads */

/** One list row: ids, kind, decision, outcome, flag codes, candidate count and the name-role label. No other value. */
export function rowFor(state: State, s: Staged) {
  const link = state.links.get(s.key);
  const d = outcomeOf(state, s.key);
  return {
    source_key: s.source_key, provider_record_id: s.provider_record_id, record_id: s.record_id, label: s.label,
    kind: link?.kind ?? null, decision: link?.decision ?? null, outcome: d.outcome, unresolved: d.unresolved,
    resolved_uid: d.resolved_uid, flags: s.flags, candidates: candidateCount(state, s), revision: link?.revision ?? 0,
  };
}

export interface ListFilters { source?: string; kind?: string; decision?: string; outcome?: string; flag?: string; offset?: number }

/** Validated filters from a query: codes only. No free-text parameter exists. */
export function filtersFrom(q: Record<string, string | undefined>): ListFilters {
  const out: ListFilters = {};
  if (q.source !== undefined) { if (!SOURCE_KEY.test(q.source)) throw new MappingRefusal(400, 'filter_invalid', { filter: 'source' }); out.source = q.source; }
  if (q.kind !== undefined) { if (!([...KINDS, 'unclassified'] as string[]).includes(q.kind)) throw new MappingRefusal(400, 'filter_invalid', { filter: 'kind' }); out.kind = q.kind; }
  if (q.decision !== undefined) { if (!([...DECISIONS, 'none'] as string[]).includes(q.decision)) throw new MappingRefusal(400, 'filter_invalid', { filter: 'decision' }); out.decision = q.decision; }
  if (q.outcome !== undefined) {
    if (!([...OUTCOMES, ...UNRESOLVED_KINDS] as string[]).includes(q.outcome)) throw new MappingRefusal(400, 'filter_invalid', { filter: 'outcome' });
    out.outcome = q.outcome;
  }
  if (q.flag !== undefined) { if (!CODE.test(q.flag)) throw new MappingRefusal(400, 'filter_invalid', { filter: 'flag' }); out.flag = q.flag; }
  if (q.offset !== undefined) {
    const n = Number(q.offset);
    if (!Number.isSafeInteger(n) || n < 0) throw new MappingRefusal(400, 'filter_invalid', { filter: 'offset' });
    out.offset = n;
  }
  return out;
}

export async function listRecords(db: D1Database, f: ListFilters) {
  const state = await loadState(db);
  const rows = [...state.staged.values()].map((s) => rowFor(state, s)).filter((r) =>
    (!f.source || r.source_key === f.source) &&
    (!f.kind || (r.kind ?? 'unclassified') === f.kind) &&
    (!f.decision || (r.decision ?? 'none') === f.decision) &&
    (!f.outcome || r.outcome === f.outcome || r.unresolved === f.outcome) &&
    (!f.flag || r.flags.includes(f.flag)));
  const start = f.offset ?? 0;
  return {
    records: rows.slice(start, start + MAPPING_LIMITS.PAGE), total: rows.length, offset: start,
    next_offset: start + MAPPING_LIMITS.PAGE < rows.length ? start + MAPPING_LIMITS.PAGE : null,
  };
}

/**
 * The one read that returns field values (#7739 Q2 A: Super Admins only): the current version's stored cells, the
 * versions by id and hash, the supplied flags, the decision with its note, the candidates and the history. Writes one
 * audit row naming the stored record id, in the same call.
 */
export async function readRecord(db: D1Database, env: Env, actorId: number, body: { source_key?: unknown; provider_record_id?: unknown }) {
  if (!str(body?.source_key, 100) || !SOURCE_KEY.test(body.source_key as string)) throw new MappingRefusal(400, 'source_key_invalid');
  if (!str(body?.provider_record_id, 200)) throw new MappingRefusal(400, 'provider_record_id_required');
  const sourceKey = body.source_key as string; const id = body.provider_record_id as string;
  const state = await loadState(db);
  const s = state.staged.get(keyOf(sourceKey, id));
  if (!s) throw new MappingRefusal(404, 'unknown_record', { source: sourceKey, provider_record_id: id });
  await adminAuditStatement(env, actorId, AUDIT_ACTIONS.read, { record_id: s.record_id }).run();
  const [versions, body_, flags, note, history] = await Promise.all([
    db.prepare(SQL.recordVersions).bind(sourceKey, id).all(),
    db.prepare(SQL.recordBody).bind(s.record_id).first<{ body_json: string }>(),
    db.prepare(SQL.recordFlags).bind(s.record_id).all(),
    db.prepare(SQL.linkWithNote).bind(sourceKey, id).first<{ note: string | null }>(),
    db.prepare(SQL.history).bind(sourceKey, id, MAPPING_LIMITS.HISTORY).all(),
  ]);
  const rules = (await db.prepare(STORE_SQL.rulesFor).bind(JSON.stringify([sourceKey])).all<{ column_name: string; class: string; role: string | null }>()).results ?? [];
  let cells: unknown = null;
  try { cells = body_?.body_json ? JSON.parse(body_.body_json) : null; } catch { cells = null; }
  const link = state.links.get(s.key);
  return {
    record: { ...rowFor(state, s), shared_website: isSharedWebsite(state, s) },
    columns: rules.map((r) => ({ column: r.column_name, class: r.class, role: r.role })),
    cells,
    versions: versions.results ?? [],
    supplied_flags: flags.results ?? [],
    decision: link ? { ...link, note: note?.note ?? null } : null,
    candidates: candidatesFor(state, s).slice(0, MAPPING_LIMITS.CANDIDATES),
    history: history.results ?? [],
  };
}

/* ------------------------------------------------------------------ the reconciliation report */

type Tally = { staged: number; created: number; linked: number; retained_private: number; rejected: number; unresolved: number; no_decision: number; awaiting_promotion: number };
const emptyTally = (): Tally => ({ staged: 0, created: 0, linked: 0, retained_private: 0, rejected: 0, unresolved: 0, no_decision: 0, awaiting_promotion: 0 });

/**
 * Per source and kind, the five outcome counts (each staged record in exactly one, summing to the staged total) and
 * the two unresolved sub-counts; then per source the stored record, column and cell counts against the newest
 * manifest that names it, read through the store's own SQL. The summary is counts only and is the only part that may
 * be quoted; the per-record lines are for the gated caller.
 */
export async function reconciliation(db: D1Database, offset = 0) {
  const state = await loadState(db);
  const bySource = new Map<string, Map<string, Tally>>();
  const lines: Array<Record<string, unknown>> = [];
  for (const s of state.staged.values()) {
    const link = state.links.get(s.key);
    const kind = link?.kind ?? 'unclassified';
    const d = outcomeOf(state, s.key);
    const kinds = bySource.get(s.source_key) ?? new Map<string, Tally>();
    bySource.set(s.source_key, kinds);
    const t = kinds.get(kind) ?? emptyTally();
    kinds.set(kind, t);
    t.staged++;
    t[d.outcome]++;
    if (d.unresolved) t[d.unresolved]++;
    lines.push({ source_key: s.source_key, provider_record_id: s.provider_record_id, kind: link?.kind ?? null, decision: link?.decision ?? null,
      outcome: d.outcome, unresolved: d.unresolved, resolved_uid: d.resolved_uid });
  }
  const orphanLinks = [...state.links.keys()].filter((k) => !state.staged.has(k)).length;

  const runs = (await db.prepare(SQL.runs).all<{ uid: string; status: string; manifest_json: string; counts_json: string; started_at: string }>()).results ?? [];
  const newest = new Map<string, { run_uid: string; status: string; source: Manifest['sources'][0]; cells: number | null }>();
  for (const r of runs) {
    let manifest: Manifest | null = null; let counts: { cells?: Record<string, Record<string, { stored: number; withheld: number; blank: number }>> } = {};
    try { manifest = JSON.parse(r.manifest_json); counts = JSON.parse(r.counts_json || '{}'); } catch { continue; }
    for (const src of manifest?.sources ?? []) {
      if (newest.has(src.source_key)) continue;
      const per = counts.cells?.[src.source_key];
      const cells = per ? Object.values(per).reduce((n, c) => n + Number(c.stored) + Number(c.withheld) + Number(c.blank), 0) : null;
      newest.set(src.source_key, { run_uid: r.uid, status: r.status, source: src, cells });
    }
  }
  const sourceKeys = [...new Set([...bySource.keys(), ...newest.keys()])].sort();
  const rules = (await db.prepare(STORE_SQL.rulesFor).bind(JSON.stringify(sourceKeys)).all<{ source_key: string }>()).results ?? [];
  const sources = [];
  for (const key of sourceKeys) {
    const kinds = bySource.get(key) ?? new Map<string, Tally>();
    const total = emptyTally();
    for (const t of kinds.values()) for (const k of Object.keys(total) as Array<keyof Tally>) total[k] += t[k];
    const stored = await db.prepare(STORE_SQL.countRecord).bind(key, null).first<{ records: number }>();
    const m = newest.get(key);
    const columns = rules.filter((r) => r.source_key === key).length;
    sources.push({
      source_key: key,
      records: total,
      kinds: Object.fromEntries([...kinds.entries()].sort(([a], [b]) => (a < b ? -1 : 1))),
      manifest: m ? {
        run_uid: m.run_uid, run_status: m.status,
        records: { expected: m.source.expected_records, staged: total.staged, stored_versions: Number(stored?.records ?? 0), matches: total.staged === m.source.expected_records },
        columns: { expected: m.source.columns.length, stored: columns, matches: columns === m.source.columns.length },
        // The run's own cell count (stored + withheld + blank), as the store recorded it; null when it recorded none.
        cells: { expected: m.source.expected_cells, counted: m.cells, matches: m.cells === null ? null : m.cells === m.source.expected_cells },
      } : null,
    });
  }
  const start = Number.isSafeInteger(offset) && offset > 0 ? offset : 0;
  return {
    summary: {
      unit: 'records',
      sources: sources.map((s) => ({ source_key: s.source_key, records: s.records, kinds: s.kinds, manifest: s.manifest })),
      links_without_staged_record: orphanLinks,
    },
    lines: lines.slice(start, start + MAPPING_LIMITS.REPORT_LINES),
    lines_total: lines.length,
    offset: start,
    next_offset: start + MAPPING_LIMITS.REPORT_LINES < lines.length ? start + MAPPING_LIMITS.REPORT_LINES : null,
  };
}
