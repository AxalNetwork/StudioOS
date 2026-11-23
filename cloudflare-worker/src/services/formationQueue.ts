/**
 * D6697 (#6697, H1 of #6680) — HQ's reads over formation cases: the queue and
 * its saved views, one case, the filings board, and each case's ages and bands.
 *
 * AGES. A case's age runs from its `created_at`; its stage age from
 * `stage_entered_at`. A PARTY'S CLOCK runs only while the case waits on that
 * party: it is the sum of the spans in `formation_case_waiting_log` (written by
 * triggers on every change of `waiting_on`, migration
 * 202611231601_6697) whose party is that one. So a case waiting on the founder
 * adds nothing to the partner's clock. A case's waiting history before that
 * migration is not recorded: its clocks start at the migration's row
 * (`clocks_from`, `clocks_complete: false`), never a guessed date.
 *
 * BANDS. `new` up to 2 days, `aging` up to 7, `late` past 7 (`AGE_BANDS`),
 * the same for the case, the stage and each party's clock. No per-partner
 * target is applied: none is agreed (#6680), so the thresholds are one set.
 *
 * PEOPLE AND DOCUMENTS. The queue carries neither. The case read carries the
 * founder's name and email, each request's asked-of person, the case's
 * documents and its recorded answers only for the case's assigned HQ owner and
 * Super Admins; any other admin gets counts. Each such read writes one
 * `formation_case_access_log` row per kind returned.
 */
import type { Env } from '../types';
import { STAGES } from './formationCase';

export const DAY_MS = 86_400_000;
export const AGE_BANDS = Object.freeze([
  { band: 'new', max_days: 2 },
  { band: 'aging', max_days: 7 },
  { band: 'late', max_days: null },
] as const);
export type Band = 'new' | 'aging' | 'late';
export const PARTIES = Object.freeze(['founder', 'hq', 'partner', 'counsel', 'registry'] as const);
export type ClockParty = typeof PARTIES[number];

/** The saved views of the queue. Each is a rule over one case and its clocks. */
export const VIEWS = Object.freeze([
  'all', 'unassigned', 'waiting_on_hq', 'screening_review', 'partner_late', 'with_registry',
  'registry_question', 'waiting_on_founder', 'closing',
] as const);
export type View = typeof VIEWS[number];
export const TRACKS = Object.freeze(['legacy_v1', 'v2'] as const);
export const ROUTES = Object.freeze(['simple', 'specialist'] as const);
/** Stages a case is closing in: registered, then its company is activated and handed off. */
export const CLOSING_STAGES = Object.freeze(['registered', 'activating', 'handed_off'] as const);

/** A stored SQLite or ISO timestamp as UTC milliseconds; a stamp with no zone is UTC. */
export function utcMs(v: unknown): number | null {
  if (typeof v !== 'string' || !v) return null;
  const k = v.includes('T') ? v : v.replace(' ', 'T');
  const ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(k) ? k : `${k}Z`);
  return Number.isFinite(ms) ? ms : null;
}

/** Whole days from `from` to `now`, or null when `from` is not a date. */
export function daysSince(from: unknown, now: number): number | null {
  const ms = utcMs(from);
  return ms == null ? null : Math.max(0, Math.floor((now - ms) / DAY_MS));
}

export function bandOf(days: number | null): Band | null {
  if (days == null) return null;
  for (const b of AGE_BANDS) if (b.max_days == null || days <= b.max_days) return b.band;
  return 'late';
}

export interface WaitingRow { party: string; at: string; source: string }
export interface Clocks {
  clocks_from: string | null;
  /** False when the history starts at the D6697 migration, not at the case's creation. */
  clocks_complete: boolean;
  /** Whole days each party has been waited on, over the recorded history. */
  days: Record<ClockParty, number | null>;
  bands: Record<ClockParty, Band | null>;
}

/**
 * Each party's clock from the waiting log: the spans between consecutive rows,
 * the last running to `now` (a closed case stops at `closedAt`). Rows are in
 * id order. With no row, no clock is recorded.
 */
export function partyClocks(rows: WaitingRow[], now: number, closedAt: string | null = null): Clocks {
  const empty = Object.fromEntries(PARTIES.map((p) => [p, null])) as Record<ClockParty, null>;
  if (!rows.length) return { clocks_from: null, clocks_complete: false, days: { ...empty }, bands: { ...empty } };
  const end = Math.min(now, utcMs(closedAt) ?? now);
  const ms = Object.fromEntries(PARTIES.map((p) => [p, 0])) as Record<ClockParty, number>;
  for (let i = 0; i < rows.length; i += 1) {
    const from = utcMs(rows[i].at);
    const to = i + 1 < rows.length ? utcMs(rows[i + 1].at) : end;
    if (from == null || to == null || to <= from) continue;
    const p = rows[i].party as ClockParty;
    if ((PARTIES as readonly string[]).includes(p)) ms[p] += to - from;
  }
  const days = Object.fromEntries(PARTIES.map((p) => [p, Math.floor(ms[p] / DAY_MS)])) as Record<ClockParty, number>;
  return {
    clocks_from: rows[0].at,
    clocks_complete: rows[0].source === 'created',
    days,
    bands: Object.fromEntries(PARTIES.map((p) => [p, bandOf(days[p])])) as Record<ClockParty, Band | null>,
  };
}

export interface QueueCase {
  id: number; uid: string; track: string; intent: string; path: string | null; stage: string;
  stage_entered_at: string; waiting_on: string; hold_reason: string | null; form_key: string | null;
  partner_id: number | null; hq_owner_user_id: number | null; closed_at: string | null;
  close_reason: string | null; created_at: string; updated_at: string; country: string | null;
}

/** Whether a case is in a saved view. */
export function inView(view: View, c: QueueCase, clocks: Clocks): boolean {
  const open = c.closed_at == null;
  switch (view) {
    case 'all': return true;
    case 'unassigned': return open && c.hq_owner_user_id == null;
    case 'waiting_on_hq': return open && c.waiting_on === 'hq';
    case 'screening_review': return open && c.stage === 'structure_review';
    case 'partner_late': return open && c.waiting_on === 'partner' && clocks.bands.partner === 'late';
    case 'with_registry': return open && c.stage === 'submitted';
    case 'registry_question': return open && c.stage === 'registry_query';
    case 'waiting_on_founder': return open && c.waiting_on === 'founder';
    case 'closing': return open && (CLOSING_STAGES as readonly string[]).includes(c.stage);
    default: return false;
  }
}

/** The queue row: no people, no documents. */
export function queueRow(c: QueueCase, clocks: Clocks, viewerId: number, now: number) {
  const age = daysSince(c.created_at, now);
  const stageAge = daysSince(c.stage_entered_at, now);
  return {
    uid: c.uid,
    legacy: c.track === 'legacy_v1',
    track: c.track,
    intent: c.intent,
    route: c.path,
    stage: c.stage,
    stage_index: STAGES.indexOf(c.stage as any),
    waiting_on: c.waiting_on,
    on_hold: c.hold_reason != null,
    form_key: c.form_key,
    country: c.country,
    partner_id: c.partner_id,
    assigned: c.hq_owner_user_id != null,
    mine: c.hq_owner_user_id != null && Number(c.hq_owner_user_id) === Number(viewerId),
    closed: c.closed_at != null,
    close_reason: c.close_reason,
    age_days: age, age_band: bandOf(age),
    stage_age_days: stageAge, stage_age_band: bandOf(stageAge),
    clocks,
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
}

// ---- reads -----------------------------------------------------------------------

/** Read at most this many cases for one queue answer; past it the answer says so. */
export const QUEUE_READ_CAP = 2000;

const CASE_COLUMNS =
  'c.id, c.uid, c.track, c.intent, c.path, c.stage, c.stage_entered_at, c.waiting_on, c.hold_reason, c.form_key, '
  + 'c.partner_id, c.hq_owner_user_id, c.closed_at, c.close_reason, c.created_at, c.updated_at, '
  + '(SELECT j.country FROM formation_entity_forms f JOIN formation_jurisdictions j ON j.id = f.jurisdiction_id '
  + '  WHERE f.version_id = c.catalogue_version_id AND f.form_key = c.form_key LIMIT 1) AS country';
const QUEUE_SQL = 'SELECT ' + CASE_COLUMNS + ' FROM formation_cases c ORDER BY c.created_at, c.id LIMIT ?';
const CASE_BY_UID_SQL = 'SELECT ' + CASE_COLUMNS + ', c.user_id, c.project_id, c.company_id, c.structure_gate, c.catalogue_version_id, c.revision '
  + 'FROM formation_cases c WHERE c.uid = ?';
const WAITING_SQL =
  'SELECT case_id, party, at, source FROM formation_case_waiting_log WHERE case_id IN (SELECT value FROM json_each(?)) ORDER BY case_id, id';

export async function readQueueCases(env: Env): Promise<{ cases: QueueCase[]; truncated: boolean }> {
  const r = await env.DB.prepare(QUEUE_SQL).bind(QUEUE_READ_CAP + 1).all<QueueCase>();
  const rows = r.results || [];
  return { cases: rows.slice(0, QUEUE_READ_CAP), truncated: rows.length > QUEUE_READ_CAP };
}

export async function readWaiting(env: Env, caseIds: number[]): Promise<Map<number, WaitingRow[]>> {
  const out = new Map<number, WaitingRow[]>();
  if (!caseIds.length) return out;
  const r = await env.DB.prepare(WAITING_SQL).bind(JSON.stringify(caseIds)).all<WaitingRow & { case_id: number }>();
  for (const row of r.results || []) {
    const list = out.get(Number(row.case_id)) ?? [];
    list.push({ party: row.party, at: row.at, source: row.source });
    out.set(Number(row.case_id), list);
  }
  return out;
}

export async function readCaseByUid(env: Env, uid: string) {
  return env.DB.prepare(CASE_BY_UID_SQL).bind(uid).first<QueueCase & {
    user_id: number; project_id: number | null; company_id: number | null; structure_gate: string | null;
    catalogue_version_id: number | null; revision: number;
  }>();
}
