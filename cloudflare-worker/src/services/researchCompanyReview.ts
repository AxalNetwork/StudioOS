/**
 * D7820 (#7820): the admin writer of the Research › Companies review ledger D7819 created, its checks and its list of
 * current holds. Admin routes only (`routes/research_company_reviews.ts`); nothing here is a member read.
 *
 * WRITES. `research_company_reviews` keeps one current row per uid and its triggers append every change to
 * `research_company_review_history`; no row is ever deleted (D7819's triggers refuse it). So "clear" is a review too:
 * it sets `admitted` with its own reason and proof, the record is reachable and counted again, and the history keeps
 * the hold and the clearing. A list applies all or nothing in one D1 batch. A check is appended to
 * `research_company_checks`, which is append-only, so a failed check never replaces an earlier good one.
 *
 * ONE DIRECT READ OF THE COMPANY TABLE. D7819's by-uid read returns no values for an excluded or withdrawn record and
 * answers the same whether its directory row exists or is gone, so it cannot say whether a uid exists or name a held
 * record on the admin list. `readDirectoryIdentityForAdmin` reads the physical table by uid for three things only,
 * whatever the review status: that the row exists, its stored name and its source name. It selects no other column and
 * writes nothing there. Only the admin routes call it (a test over `src` fails otherwise), and only the admin list
 * returns what it reads for an excluded or withdrawn record.
 *
 * A run is referenced, never registered: `run_reference` is opaque text (a #7742 run id where one exists, else a free
 * batch reference). No function here creates a run or attaches rows to one.
 */
import type { Env } from '../types';
import { COMPANY_REVIEW_REASONS } from './researchCompanyRead';

export const REVIEW_STATUSES = Object.freeze(['admitted', 'held', 'excluded', 'withdrawn'] as const);
/** The statuses the list of current holds returns. `admitted` (including a cleared hold) is not a hold. */
export const HOLD_STATUSES = Object.freeze(['held', 'excluded', 'withdrawn'] as const);
export const REASON_CODES = Object.freeze(Object.keys(COMPANY_REVIEW_REASONS));
export const CHECK_KINDS = Object.freeze(['website', 'registry_status', 'source_published'] as const);
export const CHECK_OUTCOMES = Object.freeze(['ok', 'failed', 'changed'] as const);

/** At most this many uids in one call: 11,000 held records take 55 calls. */
export const MAX_UIDS = 200;
export const PAGE_MAX = 100;
const UID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$/;
const HTTPS = /^https:\/\/[^\s<>"']{1,1990}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class ReviewInputError extends Error {
  code: string;
  detail: string;
  extra: Record<string, unknown>;
  constructor(code: string, detail: string, extra: Record<string, unknown> = {}) {
    super(code);
    this.code = code; this.detail = detail; this.extra = extra;
  }
}

/** The one statement on the physical company table: uid, stored name, source name, and nothing else. */
export const IDENTITY_SQL = `SELECT uid, name, source_name FROM research_company_directory
 WHERE uid IN (SELECT value FROM json_each(?))`;

/** Admin routes only: whether each uid has a directory row, with its stored name and source name. */
export async function readDirectoryIdentityForAdmin(env: Pick<Env, 'DB'>, uids: readonly string[]) {
  if (!uids.length) return new Map<string, { name: string | null; source_name: string | null }>();
  const rows = await env.DB.prepare(IDENTITY_SQL).bind(JSON.stringify([...new Set(uids)]))
    .all<{ uid: string; name: string | null; source_name: string | null }>();
  return new Map((rows.results || []).map((r) => [r.uid, { name: r.name ?? null, source_name: r.source_name ?? null }]));
}

const text = (v: unknown, max: number, field: string): string | null => {
  if (v == null || v === '') return null;
  if (typeof v !== 'string') throw new ReviewInputError('invalid_field', `${field} must be text.`, { field });
  const t = v.trim();
  if (!t) return null;
  if (t.length > max) throw new ReviewInputError('invalid_field', `${field} is longer than ${max} characters.`, { field });
  return t;
};
const proof = (v: unknown, required: boolean) => {
  if ((v == null || v === '') && !required) return null;
  if (typeof v !== 'string' || !HTTPS.test(v.trim())) throw new ReviewInputError('proof_url_required', 'A proof link starting with https:// is required.');
  return v.trim();
};
const day = (v: unknown, field: string) => {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || !DAY.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw new ReviewInputError('invalid_field', `${field} must be a date (YYYY-MM-DD).`, { field });
  return v;
};
const stamp = (now: Date) => now.toISOString().slice(0, 19).replace('T', ' ');

export function parseUids(v: unknown): string[] {
  if (!Array.isArray(v) || !v.length) throw new ReviewInputError('uids_required', 'Name at least one company uid.');
  if (v.length > MAX_UIDS) throw new ReviewInputError('too_many_uids', `At most ${MAX_UIDS} uids in one call.`, { max: MAX_UIDS });
  const bad = v.filter((u) => typeof u !== 'string' || !UID.test(u));
  if (bad.length) throw new ReviewInputError('invalid_uids', 'A uid is not in the directory’s form.', { count: bad.length });
  return [...new Set(v as string[])];
}

export type ReviewInput = {
  uids: string[]; status: (typeof REVIEW_STATUSES)[number]; reason_code: string; proof_url: string;
  admin_note: string | null; next_action: string | null; next_review_on: string | null; withdrawn_on: string | null; run_reference: string | null;
};

export function parseReview(body: any): ReviewInput {
  const status = body?.status;
  if (!REVIEW_STATUSES.includes(status)) throw new ReviewInputError('invalid_status', 'status must be admitted, held, excluded or withdrawn.');
  if (!REASON_CODES.includes(body?.reason_code)) throw new ReviewInputError('invalid_reason_code', 'reason_code is not one of the recorded reasons.', { allowed: REASON_CODES });
  const withdrawnOn = day(body?.withdrawn_on, 'withdrawn_on');
  if (withdrawnOn && status !== 'withdrawn') throw new ReviewInputError('invalid_field', 'withdrawn_on is only for a withdrawn record.', { field: 'withdrawn_on' });
  return {
    uids: parseUids(body?.uids),
    status,
    reason_code: body.reason_code,
    proof_url: proof(body?.proof_url, true) as string,
    admin_note: text(body?.admin_note, 10000, 'admin_note'),
    next_action: text(body?.next_action, 1000, 'next_action'),
    next_review_on: day(body?.next_review_on, 'next_review_on'),
    withdrawn_on: withdrawnOn,
    run_reference: text(body?.run_reference, 200, 'run_reference'),
  };
}

/**
 * Place, change or clear (`admitted`) a status for every uid, all or nothing. A uid with neither a directory row nor
 * a review row is refused by name and nothing changes; a uid whose directory row is gone but whose review remains can
 * still be changed or cleared.
 */
export async function applyReviews(env: Pick<Env, 'DB'>, input: ReviewInput, reviewer: number, now = new Date()) {
  const identity = await readDirectoryIdentityForAdmin(env, input.uids);
  const reviewed = await env.DB.prepare('SELECT uid FROM research_company_reviews WHERE uid IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(input.uids)).all<{ uid: string }>();
  const known = new Set([...(reviewed.results || []).map((r) => r.uid), ...identity.keys()]);
  const unknown = input.uids.filter((u) => !known.has(u));
  if (unknown.length) throw new ReviewInputError('unknown_uids', 'Nothing changed: these uids have no directory row and no review.', { unknown });
  const at = stamp(now);
  const withdrawnOn = input.status === 'withdrawn' ? (input.withdrawn_on ? `${input.withdrawn_on} 00:00:00` : at) : null;
  const write = env.DB.prepare(
    `INSERT INTO research_company_reviews (uid,status,reason_code,admin_note,proof_url,reviewer,reviewed_on,next_action,next_review_on,withdrawn_on,run_reference)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(uid) DO UPDATE SET status=excluded.status, reason_code=excluded.reason_code, admin_note=excluded.admin_note,
       proof_url=excluded.proof_url, reviewer=excluded.reviewer, reviewed_on=excluded.reviewed_on, next_action=excluded.next_action,
       next_review_on=excluded.next_review_on, withdrawn_on=excluded.withdrawn_on, run_reference=excluded.run_reference`,
  );
  await env.DB.batch(input.uids.map((uid) => write.bind(uid, input.status, input.reason_code, input.admin_note, input.proof_url, reviewer, at,
    input.next_action, input.next_review_on, withdrawnOn, input.run_reference)));
  return { count: input.uids.length, status: input.status, reviewed_on: at };
}

export type CheckInput = { uid: string; kind: string; outcome: string; what_changed: string | null; proof_url: string; checked_at: string | null };

export function parseCheck(body: any): CheckInput {
  const [uid] = parseUids([body?.uid]);
  if (!CHECK_KINDS.includes(body?.kind)) throw new ReviewInputError('invalid_kind', 'kind must be website, registry_status or source_published.');
  if (!CHECK_OUTCOMES.includes(body?.outcome)) throw new ReviewInputError('invalid_outcome', 'outcome must be ok, failed or changed.');
  const checkedAt = body?.checked_at == null || body.checked_at === '' ? null : String(body.checked_at);
  if (checkedAt && Number.isNaN(Date.parse(checkedAt))) throw new ReviewInputError('invalid_field', 'checked_at must be a date and time.', { field: 'checked_at' });
  return { uid, kind: body.kind, outcome: body.outcome, what_changed: text(body?.what_changed, 2000, 'what_changed'), proof_url: proof(body?.proof_url, true) as string, checked_at: checkedAt };
}

/** Append one check. The table is append-only: a failed check sits beside, never over, the last good one. */
export async function recordCheck(env: Pick<Env, 'DB'>, input: CheckInput, now = new Date()) {
  const identity = await readDirectoryIdentityForAdmin(env, [input.uid]);
  const review = await env.DB.prepare('SELECT 1 AS x FROM research_company_reviews WHERE uid = ?').bind(input.uid).first();
  if (!identity.has(input.uid) && !review) throw new ReviewInputError('unknown_uids', 'Nothing changed: this uid has no directory row and no review.', { unknown: [input.uid] });
  const at = input.checked_at ? stamp(new Date(input.checked_at)) : stamp(now);
  await env.DB.prepare('INSERT INTO research_company_checks (uid,kind,checked_at,outcome,what_changed,proof_url) VALUES (?,?,?,?,?,?)')
    .bind(input.uid, input.kind, at, input.outcome, input.what_changed, input.proof_url).run();
  const last = await env.DB.prepare(
    `SELECT kind,checked_at,outcome FROM research_company_checks WHERE uid = ? AND kind = ? AND outcome <> 'failed'
      ORDER BY datetime(checked_at) DESC, id DESC LIMIT 1`,
  ).bind(input.uid, input.kind).first<any>();
  return { recorded: { uid: input.uid, kind: input.kind, outcome: input.outcome, checked_at: at }, last_good: last ?? null };
}

/**
 * Current held, excluded and withdrawn records, paged, with decision, reason, proof and identity. Where the directory
 * row is gone, `name` and `source_name` are null: never guessed.
 */
export async function listHolds(env: Pick<Env, 'DB'>, q: { status?: string | null; page?: number; page_size?: number }) {
  const statuses = q.status ? [q.status] : [...HOLD_STATUSES];
  if (q.status && !HOLD_STATUSES.includes(q.status as any)) throw new ReviewInputError('invalid_status', 'status must be held, excluded or withdrawn.');
  const size = Math.min(Math.max(Math.trunc(Number(q.page_size) || 50), 1), PAGE_MAX);
  const page = Math.max(Math.trunc(Number(q.page) || 1), 1);
  const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM research_company_reviews WHERE status IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(statuses)).first<{ n: number }>();
  const rows = await env.DB.prepare(
    `SELECT uid,status,reason_code,proof_url,reviewer,reviewed_on,next_action,next_review_on,withdrawn_on,run_reference
       FROM research_company_reviews WHERE status IN (SELECT value FROM json_each(?)) ORDER BY uid LIMIT ? OFFSET ?`,
  ).bind(JSON.stringify(statuses), size, (page - 1) * size).all<any>();
  const items = rows.results || [];
  const identity = await readDirectoryIdentityForAdmin(env, items.map((r: any) => r.uid));
  return {
    items: items.map((r: any) => {
      const id = identity.get(r.uid);
      return {
        uid: r.uid, status: r.status, reason_code: r.reason_code,
        reason: COMPANY_REVIEW_REASONS[r.reason_code as keyof typeof COMPANY_REVIEW_REASONS] ?? null,
        proof_url: r.proof_url ?? null, reviewer: r.reviewer, reviewed_on: r.reviewed_on, next_action: r.next_action ?? null,
        next_review_on: r.next_review_on ?? null, withdrawn_on: r.withdrawn_on ?? null, run_reference: r.run_reference ?? null,
        directory_row: !!id, name: id?.name ?? null, source_name: id?.source_name ?? null,
      };
    }),
    page, page_size: size, total: Number(total?.n) || 0,
  };
}

/** One uid's history (every change, oldest first) and its checks. */
export async function reviewHistory(env: Pick<Env, 'DB'>, uid: string) {
  const [one] = parseUids([uid]);
  const history = await env.DB.prepare(
    `SELECT status,reason_code,admin_note,proof_url,reviewer,reviewed_on,next_action,next_review_on,withdrawn_on,run_reference,operation,recorded_at
       FROM research_company_review_history WHERE uid = ? ORDER BY id`,
  ).bind(one).all<any>();
  const checks = await env.DB.prepare('SELECT kind,checked_at,outcome,what_changed,proof_url FROM research_company_checks WHERE uid = ? ORDER BY datetime(checked_at), id')
    .bind(one).all<any>();
  return { uid: one, history: history.results || [], checks: checks.results || [] };
}
