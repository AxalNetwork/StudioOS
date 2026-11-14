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
 * NOTHING RECORDED READS AS NULL. Review dates are recorded from migration 557
 * (D991) on, and a verdict given before it has none, so the verdict counts
 * stay `available: false` with the reason, never a zero.
 *
 * THE ENVELOPE (D993, part 4). Each row carries the state of the envelope its
 * first agreement went out in, joined from `esign_envelopes`, and the counts
 * read fills "envelopes out" from the same join. A profile with no agreement
 * or no envelope has `envelope: null`, which reads "Not sent".
 *
 * THE EXPLORING BOARD'S AGREEMENT (D1127). An Explorer's account carries the
 * binding agreement the Exploring board sent it (`user_role_review`, migration
 * 147): not sent, sent on a day, or signed. Every other account has none.
 *
 * EXPORT (D1127). `exportPartnerProfiles` answers the list's own filters, or
 * the chosen references, as a CSV of what the page draws, never the tax ID.
 * It refuses a set larger than EXPORT_MAX rather than cut it short.
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
 * D993 — the envelope a profile's first agreement went out in: the newest
 * signing envelope of the profile's `agreement_type` addressed to its account
 * or to its email, as the verify send's own idempotency check finds it
 * (routes/profiling.ts). None without an agreement on the profile.
 */
const ENVELOPE_ID_SQL = `(SELECT e.id FROM esign_envelopes e
      WHERE NULLIF(TRIM(p.agreement_type), '') IS NOT NULL AND e.document_type = p.agreement_type
        AND ((u.id IS NOT NULL AND e.user_id = u.id)
          OR EXISTS (SELECT 1 FROM esign_recipients er WHERE er.envelope_id = e.id AND LOWER(er.recipient_email) = LOWER(p.email)))
      ORDER BY julianday(e.created_at) DESC, e.id DESC LIMIT 1)`;

/**
 * D993 — the envelope's state in the page's words: out for signature, not
 * delivered (out, but the latest mail to the signer failed), signed, declined
 * or voided. A status this list does not know passes through as stored.
 */
const ENVELOPE_STATE_SQL = `CASE WHEN e.id IS NULL THEN NULL
      WHEN e.status = 'completed' THEN 'signed'
      WHEN e.status IN ('sent', 'partially_signed') THEN
        CASE WHEN (SELECT a.action FROM esign_audit_events a
                    WHERE a.envelope_id = e.id AND a.action IN ('email_sent', 'email_failed')
                    ORDER BY a.id DESC LIMIT 1) = 'email_failed' THEN 'not_delivered' ELSE 'out' END
      WHEN e.status = 'rejected' THEN 'declined'
      WHEN e.status IN ('void', 'voided') THEN 'void'
      ELSE e.status END`;

/** The envelope states' words. */
export const ENVELOPE_LABELS: Record<string, string> = {
  out: 'Out for signature', not_delivered: 'Not delivered', signed: 'Signed', declined: 'Declined', void: 'Voided',
};

/**
 * One row per profile with everything the list filters and draws. The account
 * is the profile's own `user_id`, else the account holding its email (as the
 * profile read does: an address can move to a later account).
 */
const ROWS_SUBQUERY = `(
  SELECT l.*, e.status AS envelope_status, e.document_type AS envelope_document_type,
         e.created_at AS envelope_sent_at, e.completed_at AS envelope_completed_at,
         ${ENVELOPE_STATE_SQL} AS envelope_state
  FROM (
    SELECT p.rowid AS row_id, p.ref, p.email, p.created_at, p.user_id, p.invitation_id,
           p.full_name, p.organization, p.persona, p.legal_entity_name, p.entity_type,
           p.founder_track, p.company_established, p.partnership_goal, p.agreement_type,
           p.admin_status, p.reviewed_at, p.reviewed_by, p.changed_after_review_at,
           rv.name AS reviewer_name,
           ${STATUS_SQL} AS status,
           CASE WHEN ${SRC_INVITATION_SQL} THEN 1 ELSE 0 END AS src_invitation,
           CASE WHEN ${HAS_CHAT_SQL} THEN 1 ELSE 0 END AS src_chat,
           CASE WHEN ${SRC_EADWYN_SQL} THEN 1 ELSE 0 END AS src_eadwyn,
           u.id AS account_id, u.name AS user_name, u.role AS account_role, u.kyc_status,
           rr.suggested_role, rr.assigned_role, rr.assigned_at,
           rr.binding_sent_at, be.status AS binding_status, be.completed_at AS binding_completed_at,
           ${ENVELOPE_ID_SQL} AS envelope_id
    FROM partner_profiles p
    LEFT JOIN users u ON u.id = p.user_id OR (p.user_id IS NULL AND u.email = p.email)
    LEFT JOIN user_role_review rr ON rr.user_id = u.id
    LEFT JOIN esign_envelopes be ON be.id = rr.binding_envelope_id
    LEFT JOIN users rv ON rv.id = p.reviewed_by
  ) AS l
  LEFT JOIN esign_envelopes e ON e.id = l.envelope_id
) AS listed`;

/** Sort orders, by key. `reviewed` (D991): newest verdict first, unreviewed last. */
const ORDER_BY: Record<string, string> = {
  waiting: " ORDER BY (status = 'pending') DESC, julianday(created_at) ASC, row_id ASC",
  newest: ' ORDER BY julianday(created_at) DESC, row_id DESC',
  reviewed: ' ORDER BY (reviewed_at IS NULL) ASC, julianday(reviewed_at) DESC, row_id DESC',
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
  // D991 — who gave the current verdict, by account id; `not_recorded` is a
  // verdict whose reviewer nothing stored (every verdict before migration 557).
  const reviewedBy = one(query.reviewed_by);
  if (reviewedBy) {
    if (reviewedBy === 'not_recorded') where.push("status IN ('verified', 'rejected') AND reviewed_by IS NULL");
    else if (/^\d+$/.test(reviewedBy)) { where.push('reviewed_by = ?'); binds.push(Number(reviewedBy)); }
    else return { error: 'bad_filter', message: 'reviewed_by is an admin\'s account id, or not_recorded.' };
  }
  return { where, binds };
}

/** The derived sources of one row, in a fixed order. */
const sourcesOf = (r: any): string[] => [
  r.src_invitation ? 'invitation' : null, r.src_chat ? 'chat' : null, r.src_eadwyn ? 'eadwyn' : null,
].filter(Boolean) as string[];

/**
 * D1127 — the binding agreement the Exploring board sent an Explorer: signed
 * once its envelope completed, sent with its day, or not sent. A sent day the
 * board did not store is null, never a guess.
 */
function bindingOf(r: any): { state: 'not_sent' | 'sent' | 'signed'; sent_at: string | null; signed_at: string | null } {
  if (String(r.binding_status || '').toLowerCase() === 'completed') {
    return { state: 'signed', sent_at: r.binding_sent_at ?? null, signed_at: r.binding_completed_at ?? null };
  }
  if (r.binding_sent_at || r.binding_status) return { state: 'sent', sent_at: r.binding_sent_at ?? null, signed_at: null };
  return { state: 'not_sent', sent_at: null, signed_at: null };
}

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
    binding: r.account_role === 'exploring' ? bindingOf(r) : null,
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
    // D991 — the current verdict's date and reviewer, and the changed-after
    // flag PRF2 draws as the amber dot. Null where nothing recorded them.
    reviewed_at: r.reviewed_at ?? null,
    reviewed_by: r.reviewed_by == null ? null : { user_id: r.reviewed_by, name: r.reviewer_name ?? null },
    changed_after_review_at: r.changed_after_review_at ?? null,
    sources: sourcesOf(r),
    account,
    identity_check: kyc == null ? null : { state: kyc, label: IDENTITY_LABELS[kyc] ?? kyc },
    envelope: r.envelope_state == null ? null : {
      state: r.envelope_state,
      label: ENVELOPE_LABELS[r.envelope_state] ?? r.envelope_state,
      document_type: r.envelope_document_type ?? null,
      sent_at: r.envelope_sent_at ?? null,
      signed_at: r.envelope_state === 'signed' ? (r.envelope_completed_at ?? null) : null,
    },
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
  const orderBy = ORDER_BY[sort];
  if (!orderBy) return { error: 'bad_sort', message: 'Sort by waiting, newest, reviewed or name.' };
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, Math.floor(Number(query.page_size)) || PAGE_SIZE_DEFAULT));
  const page = Math.max(1, Math.floor(Number(query.page)) || 1);
  const whereSql = filters.where.length ? ' WHERE ' + filters.where.join(' AND ') : '';

  const totalsSql = 'SELECT COUNT(*) AS total,'
    + " COALESCE(SUM(status = 'draft'), 0) AS draft, COALESCE(SUM(status = 'pending'), 0) AS pending,"
    + " COALESCE(SUM(status = 'verified'), 0) AS verified, COALESCE(SUM(status = 'rejected'), 0) AS rejected,"
    + ' COALESCE(SUM(status IS NULL), 0) AS not_recorded FROM ' + ROWS_SUBQUERY + whereSql;
  const rowsSql = 'SELECT * FROM ' + ROWS_SUBQUERY + whereSql + orderBy + ' LIMIT ? OFFSET ?';

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

/** D1127 — an export holds at most this many profiles; a larger set is refused, never cut short. */
export const EXPORT_MAX = 5000;
/** D1127 — at most this many chosen references in one export. */
export const EXPORT_REFS_MAX = 100;

/** The CSV's columns: what the page draws. Never the tax ID, a note or the chat. */
export const EXPORT_HEADER = [
  'Reference', 'Name', 'Email', 'Status', 'Source', 'Onboarding category', 'Founder track', 'Entity', 'Entity type',
  'Agreement', 'Agreement envelope', 'Account', 'Binding agreement', 'Identity check', 'Reviewed at', 'Reviewed by',
  'Changed after review', 'Captured',
] as const;

const SOURCE_WORDS: Record<string, string> = { chat: 'Onboarding chat', invitation: 'Partner invitation', eadwyn: 'Eadwyn questions' };
const STATUS_WORDS: Record<string, string> = { draft: 'Draft', pending: 'Waiting', verified: 'Verified', rejected: 'Rejected' };

/**
 * A cell with a leading formula character neutralised (as insightsExport's
 * `cell`): names and entities are typed by members, and a spreadsheet must
 * read them as text.
 */
export function exportCell(v: unknown): string | null {
  if (v == null || v === '') return null;
  const s = String(v);
  return /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
}

/** One listed row as the CSV's cells. Unknown is an empty cell, never a zero. */
export function exportCells(row: ReturnType<typeof listRow>): (string | null)[] {
  const a = row.account;
  const binding = a?.binding;
  return [
    row.ref,
    row.user_name || row.full_name,
    row.email,
    row.status ? (STATUS_WORDS[row.status] ?? row.status) : 'Not recorded',
    row.sources.length ? row.sources.map((x) => SOURCE_WORDS[x] ?? x).join('; ') : 'None recorded',
    row.persona,
    row.founder_track,
    row.legal_entity_name,
    row.entity_type,
    row.agreement_type,
    row.envelope?.label ?? null,
    a ? (a.role ?? 'Not recorded') : 'No account yet',
    !binding ? null : binding.state === 'signed' ? 'Signed' : binding.state === 'sent' ? 'Sent' : 'Not sent',
    row.identity_check?.label ?? null,
    row.reviewed_at,
    row.reviewed_by ? (row.reviewed_by.name || `Account ${row.reviewed_by.user_id}`) : null,
    row.changed_after_review_at,
    row.created_at,
  ].map(exportCell);
}

/**
 * D1127 — the export: the list's filters and sort (the view on the page), or
 * the chosen references within them. Throws on a D1 error; the route answers
 * 503. A set past EXPORT_MAX is a refusal with the count, so the admin can
 * narrow it.
 */
export async function exportPartnerProfiles(env: Env, query: ListQuery & { refs?: string }) {
  const filters = listFilters(query);
  if ('error' in filters) return filters;
  const sort = one(query.sort) || 'newest';
  const orderBy = ORDER_BY[sort];
  if (!orderBy) return { error: 'bad_sort', message: 'Sort by waiting, newest, reviewed or name.' };
  const refsRaw = one(query.refs);
  const refs = refsRaw ? [...new Set(refsRaw.split(',').map((x) => x.trim()).filter(Boolean))] : [];
  if (refs.length > EXPORT_REFS_MAX) return { error: 'too_many_refs', message: `Choose at most ${EXPORT_REFS_MAX} profiles to export at once.` };
  if (refs.some((x) => !PROFILE_REF.test(x))) return { error: 'bad_ref', message: 'A chosen profile is not a reference this list knows.' };
  const where = [...filters.where];
  const binds = [...filters.binds];
  if (refs.length) { where.push('ref IN (' + refs.map(() => '?').join(', ') + ')'); binds.push(...refs); }
  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const countSql = 'SELECT COUNT(*) AS n FROM ' + ROWS_SUBQUERY + whereSql;
  const total = Number((await env.DB.prepare(countSql).bind(...binds).first<any>())?.n ?? 0);
  if (total > EXPORT_MAX) {
    return { error: 'export_too_large', message: `This view holds ${total.toLocaleString('en-US')} profiles; an export holds at most ${EXPORT_MAX.toLocaleString('en-US')}. Narrow it with a filter.` };
  }
  const rowsSql = 'SELECT * FROM ' + ROWS_SUBQUERY + whereSql + orderBy + ' LIMIT ?';
  const result = await env.DB.prepare(rowsSql).bind(...binds, EXPORT_MAX).all<any>();
  const rows = (result.results || []).map(listRow);
  return { header: EXPORT_HEADER, rows: rows.map(exportCells), count: rows.length, chosen: refs.length };
}

/** One profile as the list draws it, by reference; null when none has it. */
export async function listedByRef(env: Env, ref: string) {
  const row = await env.DB.prepare(ROW_BY_REF_SQL).bind(ref).first<any>();
  return row ? listRow(row) : null;
}
const ROW_BY_REF_SQL = 'SELECT * FROM ' + ROWS_SUBQUERY + ' WHERE ref = ?';

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
  // D991 / D1127 — the admins who gave a current verdict, for the Reviewed by filter.
  const reviewers = await env.DB.prepare(
    'SELECT DISTINCT p.reviewed_by AS id, u.name AS name FROM partner_profiles p JOIN users u ON u.id = p.reviewed_by'
    + ' WHERE p.reviewed_by IS NOT NULL ORDER BY LOWER(COALESCE(u.name, \'\')), p.reviewed_by',
  ).all<any>();
  return {
    reviewed_by: (reviewers.results || []).map((x: any) => ({ id: Number(x.id), name: x.name ?? null })),
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

/** D993 — profiles whose first agreement is out for signature, and how many of those were not delivered. */
const ENVELOPES_OUT_SQL = "SELECT COALESCE(SUM(envelope_state IN ('out', 'not_delivered')), 0) AS out_n,"
  + " COALESCE(SUM(envelope_state = 'not_delivered'), 0) AS undelivered FROM " + ROWS_SUBQUERY;

export const WEEKS = 12;
const PART2 = 'Verification and rejection dates are recorded only from 24 Oct 2026 (D991); a verdict given before has none, so this count would be short.';

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

  let envelopesOut: Record<string, unknown>;
  try {
    const o = await env.DB.prepare(ENVELOPES_OUT_SQL).first<any>();
    envelopesOut = { available: true, reason: null, count: Number(o?.out_n ?? 0), not_delivered: Number(o?.undelivered ?? 0) };
  } catch {
    envelopesOut = { available: false, reason: 'The signing envelopes could not be read.', count: null, not_delivered: null };
  }

  return {
    as_of: now.toISOString(),
    waiting,
    verified_30d: { available: false, reason: PART2, count: null },
    envelopes_out: envelopesOut,
    weekly,
  };
}
