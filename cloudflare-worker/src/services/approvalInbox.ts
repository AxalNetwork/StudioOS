/**
 * D1132 (#3012) — what HQ's inbox read (D1040, `GET /api/admin/approvals`)
 * lacked for D1038 part 7's Inbox table: search, the lane, group, age and
 * assigned filters, the sort, each lane's split by age band, and the
 * one-item read behind `/admin/approvals/[id]`.
 *
 * ALL OF IT RUNS ON THE ROWS THE BOARD ALREADY READ (`approvalBoard`, every
 * lane to `INBOX_LANE_CAP`). Nothing the caller sends reaches SQL: a filter
 * is checked against the lists below, then applied in memory, so no new
 * statement exists to bind.
 *
 * THE GROUPS ARE THE CANVAS'S (APR1's chips): `frontend/src/pages/admin/
 * approvals/approvalsModel.js`'s `GROUPS` and each lane's `group`, plus
 * `hq` for HQ's own lanes. `approvals_inbox_d1132.test.ts` holds the two
 * lists equal, so a lane moved on one side fails the build.
 */
import type { ApprovalItem, ApprovalLaneKey, ApprovalSource } from './approvalSources';
import { isVisibleLane, type Assignee } from './approvalAssignments';

export const INBOX_GROUPS = ['people', 'programs', 'community', 'deals', 'hq'] as const;
export type InboxGroup = typeof INBOX_GROUPS[number];

/** Each lane's group, in the canvas's words (APR1). HQ's lanes are `hq`. */
export const LANE_GROUP: Record<ApprovalLaneKey, InboxGroup> = {
  kyc: 'people', kyb: 'people', partner_profiles: 'people', exploring: 'people', product_testers: 'people', lp: 'people',
  cohort: 'programs', lab_hosts: 'programs', moderation: 'programs', referrals: 'programs',
  strategic_access: 'programs', perk_listings: 'programs', best_fit: 'programs',
  events: 'community', jobs: 'community', wellbeing_experts: 'community', comarketing: 'community', articles: 'community',
  due_diligence: 'deals', score_flags: 'deals',
  testing_programs: 'hq', learning: 'hq', tickets: 'hq', payouts: 'hq', ai_runs: 'hq',
  notices: 'hq', support: 'hq', proposals: 'hq', grants: 'hq',
};

export const AGE_BANDS = ['ok', 'due_soon', 'past', 'unknown'] as const;
export const INBOX_SORTS = ['oldest', 'newest', 'lane', 'who'] as const;
/** Search starts at two characters, as the page's box does (D1038 §3). */
export const SEARCH_MIN = 2;
export const SEARCH_MAX = 100;

export type InboxQuery = {
  q: string;
  lane: ApprovalLaneKey | null;
  group: InboxGroup | null;
  age: typeof AGE_BANDS[number] | null;
  /** `me`, `none`, `any`, or one admin's id. */
  assigned: 'me' | 'none' | 'any' | number | null;
  sort: typeof INBOX_SORTS[number];
};

export const NO_FILTER: InboxQuery = { q: '', lane: null, group: null, age: null, assigned: null, sort: 'oldest' };

/** The query string, checked: the query, or the name of the parameter that is wrong. */
export function parseInboxQuery(get: (k: string) => string | undefined, sources: readonly ApprovalSource[]): InboxQuery | string {
  const raw = (k: string) => { const v = get(k); return v === undefined ? '' : String(v).trim(); };
  const q = raw('q');
  if (q.length > SEARCH_MAX) return 'q';
  const lane = raw('lane');
  // A lane the reader cannot see is refused as a bad value, never answered as an empty one.
  if (lane && !isVisibleLane(lane, sources)) return 'lane';
  const group = raw('group');
  if (group && !(INBOX_GROUPS as readonly string[]).includes(group)) return 'group';
  const age = raw('age');
  if (age && !(AGE_BANDS as readonly string[]).includes(age)) return 'age';
  const a = raw('assigned');
  let assigned: InboxQuery['assigned'] = null;
  if (a === 'me' || a === 'none' || a === 'any') assigned = a;
  else if (/^\d{1,9}$/.test(a) && Number(a) > 0) assigned = Number(a);
  else if (a) return 'assigned';
  const sort = raw('sort') || 'oldest';
  if (!(INBOX_SORTS as readonly string[]).includes(sort)) return 'sort';
  return {
    q: q.length >= SEARCH_MIN ? q.toLowerCase() : '',
    lane: (lane || null) as ApprovalLaneKey | null,
    group: (group || null) as InboxGroup | null,
    age: (age || null) as InboxQuery['age'],
    assigned,
    sort: sort as InboxQuery['sort'],
  };
}

/** True when the query narrows the rows at all (the sort alone does not). */
export const isFiltered = (q: InboxQuery) => !!(q.q || q.lane || q.group || q.age || q.assigned !== null);

type Row = ApprovalItem & { assignee?: Assignee | null };

/**
 * The rows the query keeps, in its order. An assigned filter needs the
 * assignment record; when it could not be read (`assignmentsReadable`
 * false) the caller refuses the filter rather than answering it as "nobody".
 */
export function filterInbox<T extends Row>(items: T[], query: InboxQuery, callerId: number): T[] {
  const kept = items.filter((it) =>
    (!query.lane || it.lane === query.lane)
    && (!query.group || LANE_GROUP[it.lane] === query.group)
    && (!query.age || it.sla === query.age)
    && (query.assigned === null
      || (query.assigned === 'any' ? !!it.assignee
        : query.assigned === 'none' ? !it.assignee
          : query.assigned === 'me' ? it.assignee?.user_id === callerId
            : it.assignee?.user_id === query.assigned))
    && (!query.q || [it.who, it.what, it.lane_label].some((v) => String(v ?? '').toLowerCase().includes(query.q))));
  if (query.sort === 'oldest') return kept; // the board's own order: oldest first, an unknown age last
  const byAge = (a: T, b: T) => {
    // An unknown age sorts last in either direction: it is never the newest or the oldest.
    if (a.age_hours === null) return b.age_hours === null ? 0 : 1;
    if (b.age_hours === null) return -1;
    return a.age_hours - b.age_hours;
  };
  const text = (k: 'lane_label' | 'who') => (a: T, b: T) =>
    String(a[k] ?? '').localeCompare(String(b[k] ?? ''), 'en', { sensitivity: 'base' });
  const sorted = [...kept];
  if (query.sort === 'newest') sorted.sort(byAge);
  // Within a lane or a person, the oldest still comes first: the sort is stable,
  // so the board's own order is the tie-break.
  else sorted.sort(text(query.sort === 'lane' ? 'lane_label' : 'who'));
  return sorted;
}

export type LaneBands = { ok: number; due_soon: number; past: number; unknown: number };

/**
 * Each lane's open items split by age band (APR1's chart). A lane that could
 * not be read, or was cut at the cap, has no split: `null`, with the reason.
 */
export function laneBands(
  lanes: Array<{ key: ApprovalLaneKey; label: string; count: number | null }>,
  items: ApprovalItem[],
  cap: number,
): Array<{ key: ApprovalLaneKey; label: string; group: InboxGroup; count: number | null; bands: LaneBands | null; bands_reason?: string }> {
  return lanes.map((l) => {
    const group = LANE_GROUP[l.key];
    if (l.count === null) return { ...l, group, bands: null, bands_reason: `${l.label} could not be read, so its ages are not known.` };
    if (l.count >= cap) return { ...l, group, bands: null, bands_reason: `${l.label} has more open items than this read takes, so its split by age is not shown.` };
    const bands: LaneBands = { ok: 0, due_soon: 0, past: 0, unknown: 0 };
    for (const it of items) if (it.lane === l.key) bands[it.sla] += 1;
    return { ...l, group, bands };
  });
}
