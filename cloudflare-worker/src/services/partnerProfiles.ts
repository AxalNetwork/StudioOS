/**
 * D990 (#2801) — Partner profiles part 1: the list read HQ's page draws, the
 * counts read for its tiles and weekly series, and the rules both share with
 * Approvals lane 7 (`approvalSources.ts`).
 *
 * A PROFILE IS NAMED BY ITS REFERENCE. `partner_profiles.ref` (migration 556,
 * such as `pp_7f3a21c04e`) is the address `/admin/partner-profiles/<ref>` and
 * the name in every log line. The email stays on the row the admin reads; it
 * never goes into an address or a log line.
 *
 * WHERE A PROFILE CAME FROM IS DERIVED, because none of the three writers
 * records it (one or more may hold for one row):
 *   · invitation — `invitation_id` is set (routes/partner_onboarding.ts);
 *   · chat       — `chat_history` holds a transcript (routes/profiling.ts);
 *   · eadwyn     — one of the columns only Eadwyn's partner questions write
 *     is set (`services_offered`, `dealflow_channels`, `conflicts_text`), or,
 *     on a row with no invitation, one it shares with the invitation form
 *     (`organization`, `role_title`, `motivation`). The shared three alone do
 *     not say Eadwyn on an invited row: the form wrote them.
 * Eadwyn's name-only row (`ensurePartnerProfile`: email, user_id, full_name)
 * has no source by this rule. It is a Draft, below.
 *
 * DRAFT. A row with no chat and no answers is not waiting on anyone. Its
 * status reads `draft` while `admin_status` is still `pending`, and neither
 * the queue nor lane 7's count includes it. Answers are every column a
 * partner's own words fill; `full_name` is not one, nor the keys and HQ's own
 * columns.
 *
 * NOTHING RECORDED READS AS NULL. Review dates arrive with part 2 and
 * envelope state with part 4; until then those blocks say `available: false`
 * with the reason, never a zero.
 */
import type { Env } from '../types';

/** A reference as migration 556 writes it. */
export const PROFILE_REF = /^pp_[0-9a-f]{10}$/;

/** Columns only Eadwyn's partner questions write (writeRouter's partnerMap). */
export const EADWYN_ONLY_COLUMNS = ['services_offered', 'dealflow_channels', 'conflicts_text'] as const;
/** partnerMap columns the invitation form also writes. */
export const EADWYN_SHARED_COLUMNS = ['organization', 'role_title', 'motivation'] as const;

/** Every column a partner's own words fill. A row with none of them and no chat is a Draft. */
export const ANSWER_COLUMNS = [
  'persona', 'legal_entity_name', 'entity_type', 'ein', 'signatory_name', 'signatory_title',
  'company_established', 'founder_track', 'current_stage', 'partnership_goal', 'existing_jurisdiction',
  'product_strategy', 'existing_investors', 'extracted_data',
  'organization', 'role_title', 'expertise', 'sectors', 'geography', 'capacity_per_month',
  'capital_capacity_usd', 'motivation', 'prior_deals', 'linkedin_url', 'raw_chat_json',
  'services_offered', 'dealflow_channels', 'conflicts_text', 'focus_text',
] as const;

/** A column holds something: not null, not blank, not an empty JSON value. */
const filled = (col: string) => `COALESCE(TRIM(p.${col}), '') NOT IN ('', '[]', '{}', 'null')`;
const anyFilled = (cols: readonly string[]) => '(' + cols.map(filled).join(' OR ') + ')';

/** SQL over alias `p`: the row has a chat transcript. */
export const HAS_CHAT_SQL = filled('chat_history');
/** SQL over alias `p`: the row is a Draft (no chat, no answers). */
export const IS_DRAFT_SQL = `(NOT ${HAS_CHAT_SQL} AND NOT ${anyFilled(ANSWER_COLUMNS)})`;
/** SQL over alias `p`: waiting on an admin — pending and not a Draft. Lane 7 counts this. */
export const IS_WAITING_SQL = `(p.admin_status = 'pending' AND NOT ${IS_DRAFT_SQL})`;

const SRC_INVITATION_SQL = '(p.invitation_id IS NOT NULL)';
const SRC_EADWYN_SQL = `(${anyFilled(EADWYN_ONLY_COLUMNS)} OR (p.invitation_id IS NULL AND ${anyFilled(EADWYN_SHARED_COLUMNS)}))`;

/** The row's status: draft, pending, verified, rejected, or null when nothing was recorded. */
const STATUS_SQL = `CASE WHEN p.admin_status = 'pending' THEN (CASE WHEN ${IS_DRAFT_SQL} THEN 'draft' ELSE 'pending' END) ELSE p.admin_status END`;

/** KYC & KYB's words for the identity-check states (UsersConsole's KYC_LABELS). */
export const IDENTITY_LABELS: Record<string, string> = {
  not_started: 'Not started', pending: 'Pending', approved: 'Approved', rejected: 'Rejected',
};

export const SOURCES = ['invitation', 'chat', 'eadwyn', 'none'] as const;
export const STATUSES = ['draft', 'pending', 'verified', 'rejected'] as const;
export const SORTS = ['waiting', 'newest', 'reviewed', 'name'] as const;
export const PAGE_SIZE_DEFAULT = 25;
export const PAGE_SIZE_MAX = 100;

/**
 * One row per profile with everything the list filters and draws. The account
 * is the profile's own `user_id`, else the account holding its email (as the
 * profile read does: an address can move to a later account).
 */
const ROWS_CTE = `
  WITH rows AS (
    SELECT p.rowid AS row_id, p.ref, p.email, p.created_at, p.user_id, p.invitation_id,
           p.full_name, p.organization, p.persona, p.legal_entity_name, p.entity_type,
           p.founder_track, p.company_established, p.partnership_goal, p.agreement_type,
           p.admin_status,
           ${STATUS_SQL} AS status,
           CASE WHEN ${SRC_INVITATION_SQL} THEN 1 ELSE 0 END AS src_invitation,
           CASE WHEN ${HAS_CHAT_SQL} THEN 1 ELSE 0 END AS src_chat,
           CASE WHEN ${SRC_EADWYN_SQL} THEN 1 ELSE 0 END AS src_eadwyn,
           u.id AS account_id, u.name AS user_name, u.role AS account_role, u.kyc_status,
           rr.suggested_role, rr.assigned_role, rr.assigned_at
    FROM partner_profiles p
    LEFT JOIN users u ON u.id = p.user_id OR (p.user_id IS NULL AND u.email = p.email)
    LEFT JOIN user_role_review rr ON rr.user_id = u.id
  )`;

/** Sort orders, by key. `reviewed` waits for part 2's review dates. */
const ORDER_BY: Record<string, string> = {
  waiting: " ORDER BY (status = 'pending') DESC, julianday(created_at) ASC, row_id ASC",
  newest: ' ORDER BY julianday(created_at) DESC, row_id DESC',
  name: " ORDER BY LOWER(COALESCE(NULLIF(TRIM(full_name), ''), NULLIF(TRIM(user_name), ''), NULLIF(TRIM(legal_entity_name), ''), NULLIF(TRIM(organization), ''), email)) ASC, row_id ASC",
};

export interface ListQuery {
  q?: string; status?: string; source?: string; category?: string; founder_track?: string;
  entity_type?: string; agreement?: string; has_account?: string; identity?: string;
  captured_from?: string; captured_to?: string; reviewed_by?: string;
  sort?: string; page?: string; page_size?: string;
}

export type Refusal = { error: string; message: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const one = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** The WHERE clauses and their bound values; each clause is a fixed string. */
export function listFilters(query: ListQuery): { where: string[]; binds: unknown[] } | Refusal {
  const where: string[] = [];
  const binds: unknown[] = [];
  const q = one(query.q).slice(0, 120);
  if (q) {
    const like = '%' + q.toLowerCase().replace(/[\\%_]/g, (m) => '\\' + m) + '%';
    where.push("(LOWER(COALESCE(full_name, '')) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(user_name, '')) LIKE ? ESCAPE '\\'"
      + " OR LOWER(email) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(legal_entity_name, '')) LIKE ? ESCAPE '\\'"
      + " OR LOWER(COALESCE(organization, '')) LIKE ? ESCAPE '\\')");
    binds.push(like, like, like, like, like);
  }
  const status = one(query.status);
  if (status) {
    if (status === 'not_recorded') where.push('status IS NULL');
    else if ((STATUSES as readonly string[]).includes(status)) { where.push('status = ?'); binds.push(status); }
    else return { error: 'bad_filter', message: 'That status is not one this list knows.' };
  }
  const source = one(query.source);
  if (source) {
    if (source === 'invitation') where.push('src_invitation = 1');
    else if (source === 'chat') where.push('src_chat = 1');
    else if (source === 'eadwyn') where.push('src_eadwyn = 1');
    else if (source === 'none') where.push('src_invitation = 0 AND src_chat = 0 AND src_eadwyn = 0');
    else return { error: 'bad_filter', message: 'That source is not one this list knows.' };
  }
  for (const [param, col] of [['category', 'persona'], ['founder_track', 'founder_track'], ['entity_type', 'entity_type'], ['agreement', 'agreement_type']] as const) {
    const v = one(query[param]).slice(0, 120);
    if (!v) continue;
    if (v === 'not_recorded') where.push(`NULLIF(TRIM(${col}), '') IS NULL`);
    else { where.push(`${col} = ?`); binds.push(v); }
  }
  const hasAccount = one(query.has_account);
  if (hasAccount === 'yes') where.push('account_id IS NOT NULL');
  else if (hasAccount === 'no') where.push('account_id IS NULL');
  else if (hasAccount) return { error: 'bad_filter', message: 'has_account is yes or no.' };
  const identity = one(query.identity);
  if (identity) {
    if (identity === 'no_account') where.push('account_id IS NULL');
    else if (identity === 'not_started') where.push("account_id IS NOT NULL AND COALESCE(kyc_status, 'not_started') = 'not_started'");
    else if (identity in IDENTITY_LABELS) { where.push('kyc_status = ?'); binds.push(identity); }
    else return { error: 'bad_filter', message: 'That identity-check state is not one KYC & KYB records.' };
  }
  const from = one(query.captured_from), to = one(query.captured_to);
  if (from) {
    if (!DATE.test(from)) return { error: 'bad_filter', message: 'captured_from is a date, YYYY-MM-DD.' };
    where.push('julianday(created_at) >= julianday(?)'); binds.push(from);
  }
  if (to) {
    if (!DATE.test(to)) return { error: 'bad_filter', message: 'captured_to is a date, YYYY-MM-DD.' };
    where.push("julianday(created_at) < julianday(?, '+1 day')"); binds.push(to);
  }
  if (one(query.reviewed_by)) {
    return { error: 'not_recorded', message: 'Who reviewed a profile is recorded from Partner profiles part 2; this filter waits for it.' };
  }
  return { where, binds };
}

/** The derived sources of one row, in a fixed order. */
const sourcesOf = (r: any): string[] => [
  r.src_invitation ? 'invitation' : null, r.src_chat ? 'chat' : null, r.src_eadwyn ? 'eadwyn' : null,
].filter(Boolean) as string[];

/** A row as the list returns it. */
export function listRow(r: any) {
  const account = r.account_id == null ? null : {
    user_id: r.account_id,
    name: r.user_name ?? null,
    role: r.account_role ?? null,
    exploring: r.account_role === 'exploring',
    suggested_role: r.suggested_role ?? null,
    assigned_role: r.assigned_role ?? null,
    assigned_at: r.assigned_at ?? null,
  };
  const kyc = r.account_id == null ? null : (r.kyc_status || 'not_started');
  return {
    ref: r.ref,
    email: r.email,
    created_at: r.created_at ?? null,
    user_id: r.user_id ?? null,
    invitation_id: r.invitation_id ?? null,
    full_name: r.full_name ?? null,
    organization: r.organization ?? null,
    user_name: r.user_name ?? null,
    persona: r.persona ?? null,
    legal_entity_name: r.legal_entity_name ?? null,
    entity_type: r.entity_type ?? null,
    founder_track: r.founder_track ?? null,
    company_established: r.company_established ?? null,
    partnership_goal: r.partnership_goal ?? null,
    agreement_type: r.agreement_type ?? null,
    admin_status: r.admin_status ?? null,
    status: r.status ?? null,
    sources: sourcesOf(r),
    account,
    identity_check: kyc == null ? null : { state: kyc, label: IDENTITY_LABELS[kyc] ?? kyc },
  };
}

export interface ListResult {
  rows: ReturnType<typeof listRow>[];
  page: number; page_size: number; sort: string;
  totals: { total: number; draft: number; pending: number; verified: number; rejected: number; not_recorded: number };
}

/** The list read. Throws on a D1 error; the route answers 503. */
export async function listPartnerProfiles(env: Env, query: ListQuery): Promise<ListResult | Refusal> {
  const filters = listFilters(query);
  if ('error' in filters) return filters;
  const sort = one(query.sort) || 'waiting';
  if (sort === 'reviewed') {
    return { error: 'not_recorded', message: 'Review dates are recorded from Partner profiles part 2; this sort waits for them.' };
  }
  const orderBy = ORDER_BY[sort];
  if (!orderBy) return { error: 'bad_sort', message: 'Sort by waiting, newest or name.' };
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, Math.floor(Number(query.page_size)) || PAGE_SIZE_DEFAULT));
  const page = Math.max(1, Math.floor(Number(query.page)) || 1);
  const whereSql = filters.where.length ? ' WHERE ' + filters.where.join(' AND ') : '';

  const totalsSql = ROWS_CTE + ' SELECT COUNT(*) AS total,'
    + " COALESCE(SUM(status = 'draft'), 0) AS draft, COALESCE(SUM(status = 'pending'), 0) AS pending,"
    + " COALESCE(SUM(status = 'verified'), 0) AS verified, COALESCE(SUM(status = 'rejected'), 0) AS rejected,"
    + ' COALESCE(SUM(status IS NULL), 0) AS not_recorded FROM rows' + whereSql;
  const rowsSql = ROWS_CTE + ' SELECT * FROM rows' + whereSql + orderBy + ' LIMIT ? OFFSET ?';

  const totals = await env.DB.prepare(totalsSql).bind(...filters.binds).first<any>();
  const result = await env.DB.prepare(rowsSql).bind(...filters.binds, pageSize, (page - 1) * pageSize).all<any>();
  return {
    rows: (result.results || []).map(listRow),
    page, page_size: pageSize, sort,
    totals: {
      total: Number(totals?.total ?? 0), draft: Number(totals?.draft ?? 0), pending: Number(totals?.pending ?? 0),
      verified: Number(totals?.verified ?? 0), rejected: Number(totals?.rejected ?? 0), not_recorded: Number(totals?.not_recorded ?? 0),
    },
  };
}

/** One profile as the list draws it, by reference; null when none has it. */
export async function listedByRef(env: Env, ref: string) {
  const row = await env.DB.prepare(ROW_BY_REF_SQL).bind(ref).first<any>();
  return row ? listRow(row) : null;
}
const ROW_BY_REF_SQL = ROWS_CTE + ' SELECT * FROM rows WHERE ref = ?';

/** The distinct values the page's free-text filters can offer. */
export async function listOptions(env: Env) {
  const distinct = async (col: 'persona' | 'founder_track' | 'entity_type' | 'agreement_type') => {
    const sql = {
      persona: "SELECT DISTINCT persona AS v FROM partner_profiles WHERE NULLIF(TRIM(persona), '') IS NOT NULL ORDER BY v",
      founder_track: "SELECT DISTINCT founder_track AS v FROM partner_profiles WHERE NULLIF(TRIM(founder_track), '') IS NOT NULL ORDER BY v",
      entity_type: "SELECT DISTINCT entity_type AS v FROM partner_profiles WHERE NULLIF(TRIM(entity_type), '') IS NOT NULL ORDER BY v",
      agreement_type: "SELECT DISTINCT agreement_type AS v FROM partner_profiles WHERE NULLIF(TRIM(agreement_type), '') IS NOT NULL ORDER BY v",
    }[col];
    const r = await env.DB.prepare(sql).all<any>();
    return (r.results || []).map((x: any) => String(x.v));
  };
  return {
    category: await distinct('persona'),
    founder_track: await distinct('founder_track'),
    entity_type: await distinct('entity_type'),
    agreement: await distinct('agreement_type'),
  };
}

/** `YYYY-MM-DD HH:MM:SS`, D1's own stamp shape, in UTC. */
const stamp = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
/** The Monday on or before `d`, as `YYYY-MM-DD`. */
function mondayOf(d: Date): string {
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}

/** Waiting, and how many of those have waited 24 hours and 72 hours. */
const WAITING_SQL = 'SELECT COUNT(*) AS n,'
  + ' COALESCE(SUM(julianday(p.created_at) <= julianday(?) - 1), 0) AS over_24h,'
  + ' COALESCE(SUM(julianday(p.created_at) <= julianday(?) - 3), 0) AS over_72h,'
  + ' MIN(p.created_at) AS oldest FROM partner_profiles p WHERE ' + IS_WAITING_SQL;
/** Pending rows that are Drafts, so the page can say how many it leaves out. */
const DRAFTS_SQL = "SELECT COUNT(*) AS n FROM partner_profiles p WHERE p.admin_status = 'pending' AND " + IS_DRAFT_SQL;
/** Profiles captured per week (Monday start, UTC), Drafts left out. */
const WEEKLY_SQL = "SELECT date(p.created_at, '-6 days', 'weekday 1') AS week_start, COUNT(*) AS n FROM partner_profiles p"
  + ' WHERE julianday(p.created_at) >= julianday(?) AND julianday(p.created_at) <= julianday(?) AND NOT ' + IS_DRAFT_SQL
  + ' GROUP BY week_start';

export const WEEKS = 12;
const PART2 = 'Verification and rejection dates are recorded from Partner profiles part 2.';
const PART4 = 'Envelope state is read from Partner profiles part 4.';

/**
 * The tiles and the weekly series. Each block carries `available` and
 * `reason`; one block failing to read does not cost the others.
 */
export async function partnerProfileCounts(env: Env, now = new Date()) {
  const at = stamp(now);
  let waiting: Record<string, unknown>;
  try {
    const w = await env.DB.prepare(WAITING_SQL).bind(at, at).first<any>();
    const d = await env.DB.prepare(DRAFTS_SQL).first<any>();
    waiting = {
      available: true, reason: null,
      count: Number(w?.n ?? 0), over_24h: Number(w?.over_24h ?? 0), over_72h: Number(w?.over_72h ?? 0),
      oldest_at: w?.oldest ?? null, drafts: Number(d?.n ?? 0),
    };
  } catch {
    waiting = { available: false, reason: 'The partner profiles could not be read.', count: null, over_24h: null, over_72h: null, oldest_at: null, drafts: null };
  }

  const firstWeek = new Date(`${mondayOf(now)}T00:00:00Z`);
  firstWeek.setUTCDate(firstWeek.getUTCDate() - 7 * (WEEKS - 1));
  const weekStarts = Array.from({ length: WEEKS }, (_, i) => {
    const d = new Date(firstWeek); d.setUTCDate(d.getUTCDate() + 7 * i); return d.toISOString().slice(0, 10);
  });
  let weekly: Record<string, unknown>;
  try {
    const r = await env.DB.prepare(WEEKLY_SQL).bind(weekStarts[0], at).all<any>();
    const byWeek = new Map((r.results || []).map((x: any) => [String(x.week_start), Number(x.n)]));
    weekly = {
      available: true, reason: null,
      verified_available: false, verified_reason: PART2,
      weeks: weekStarts.map((week_start) => ({ week_start, captured: byWeek.get(week_start) ?? 0, verified: null, rejected: null })),
    };
  } catch {
    weekly = { available: false, reason: 'The partner profiles could not be read.', verified_available: false, verified_reason: PART2, weeks: [] };
  }

  return {
    as_of: now.toISOString(),
    waiting,
    verified_30d: { available: false, reason: PART2, count: null },
    envelopes_out: { available: false, reason: PART4, count: null },
    weekly,
  };
}
