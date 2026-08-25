/**
 * Referral submissions — the pipeline behind /referrals.
 *
 * This replaces the Stripe-Connect commission ledger. A referral is a tracked
 * object moving through review, not a payout waiting on a bank transfer:
 * someone submits a named person with context, a reviewer moves it through the
 * pipeline, and every transition appends to an immutable timeline the referrer
 * can read.
 *
 * Rewards are LABELS, not amounts (see migration 175 for why): the three
 * programmes settle differently and none of them move money through this
 * platform.
 */
import type { Env } from '../types';

export const CATEGORIES = ['startup', 'customer', 'strategic'] as const;
export type Category = (typeof CATEGORIES)[number];

/** Invite-only: submissions are refused unless access has been granted. */
export const INVITE_ONLY_CATEGORIES: ReadonlySet<string> = new Set(['strategic']);

export const STATUSES = [
  'draft', 'submitted', 'under_review', 'more_info_needed',
  'qualified', 'in_conversation', 'converted',
  'reward_eligible', 'reward_issued', 'rejected', 'closed',
] as const;
export type Status = (typeof STATUSES)[number];

/** Wire → display. Stored on each event row so relabelling later never
 *  rewrites history that has already been shown to a referrer. */
export const STATUS_LABELS: Record<Status, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_review: 'Under review',
  more_info_needed: 'More info needed',
  qualified: 'Qualified',
  in_conversation: 'In conversation',
  converted: 'Converted',
  reward_eligible: 'Reward eligible',
  reward_issued: 'Reward issued',
  rejected: 'Rejected',
  closed: 'Closed',
};

/** Statuses a referrer can no longer act on — the pipeline is done with them. */
export const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'reward_issued', 'rejected', 'closed',
]);

export const CATEGORY_META: Record<Category, {
  name: string; priority: string; access: string; qualifies: string; reward: string;
}> = {
  startup: {
    name: 'Startup / founder referrals',
    priority: 'Highest priority',
    access: 'Open',
    qualifies:
      'A founder actively building, with a specific problem and early evidence — a fit for the Spin-Out Lab.',
    reward: 'Milestone-based, on acceptance and formation.',
  },
  customer: {
    name: 'Platform user referrals',
    priority: 'Standard',
    access: 'Open',
    qualifies:
      'Advisors, service partners, or teams evaluating platform tools — anyone with a namable role and a clear next step.',
    reward: 'Platform credit, issued once matched and onboarded with a founder.',
  },
  strategic: {
    name: 'Strategic & capital introductions',
    priority: 'Selective',
    access: 'Invite-only',
    qualifies:
      'A named decision-maker who could shift platform reach or distribution, or an investor/LP with genuine thesis overlap introduced through a warm relationship.',
    reward: 'Invite-only economics, negotiated case by case.',
  },
};

export function isCategory(v: unknown): v is Category {
  return typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v);
}
export function isStatus(v: unknown): v is Status {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

let _ready = false;

/**
 * Dev/preview only. Production D1 owns this schema via migration 175 — running
 * DDL from a request path is what contended with cold traffic and contributed
 * to the apex 504s, so production short-circuits and trusts the migration.
 */
export async function ensureReferralSubmissionsSchema(env: Env): Promise<void> {
  if (_ready) return;
  if (env.ENVIRONMENT === 'production') { _ready = true; return; }
  const stmts = [
    `CREATE TABLE IF NOT EXISTS referral_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid TEXT NOT NULL UNIQUE,
      referrer_user_id INTEGER NOT NULL,
      category TEXT NOT NULL DEFAULT 'startup',
      referred_name TEXT NOT NULL,
      referred_org TEXT,
      referred_contact TEXT,
      your_role TEXT,
      context TEXT,
      status TEXT NOT NULL DEFAULT 'submitted',
      reward_label TEXT,
      next_step TEXT,
      fit_notes TEXT,
      source TEXT NOT NULL DEFAULT 'form',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_referral_submissions_referrer
       ON referral_submissions(referrer_user_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_referral_submissions_status
       ON referral_submissions(status, created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS referral_submission_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submission_id INTEGER NOT NULL,
      label TEXT NOT NULL,
      status TEXT,
      note TEXT,
      actor_user_id INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_referral_submission_events_submission
       ON referral_submission_events(submission_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS referral_strategic_access (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'requested',
      decided_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
  ];
  for (const s of stmts) {
    try { await env.DB.prepare(s).run(); } catch { /* idempotent */ }
  }
  _ready = true;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SubmissionRow {
  id: number;
  uid: string;
  referrer_user_id: number;
  category: Category;
  referred_name: string;
  referred_org: string | null;
  referred_contact: string | null;
  your_role: string | null;
  context: string | null;
  status: Status;
  reward_label: string | null;
  next_step: string | null;
  fit_notes: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface SubmissionEvent {
  label: string;
  status: string | null;
  note: string | null;
  created_at: string;
}

export interface CreateInput {
  category: Category;
  referredName: string;
  referredOrg?: string | null;
  referredContact?: string | null;
  yourRole?: string | null;
  context?: string | null;
  source?: 'form' | 'csv';
}

const MAX_LEN = {
  referredName: 160,
  referredOrg: 200,
  referredContact: 200,
  yourRole: 160,
  context: 4000,
  note: 2000,
};

/** Trim, collapse whitespace, cap length, and normalise empty → null. */
function clean(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.slice(0, max);
}

function newUid(): string {
  return `rs_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listForReferrer(
  env: Env,
  userId: number,
  opts: { status?: string; category?: string; limit?: number } = {},
): Promise<SubmissionRow[]> {
  const where: string[] = ['referrer_user_id = ?'];
  const binds: unknown[] = [userId];
  if (opts.status && isStatus(opts.status)) { where.push('status = ?'); binds.push(opts.status); }
  if (opts.category && isCategory(opts.category)) { where.push('category = ?'); binds.push(opts.category); }
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  const res = await env.DB.prepare(
    `SELECT * FROM referral_submissions
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT ${limit}`,
  ).bind(...binds).all<SubmissionRow>();
  return res.results || [];
}

/**
 * Fetch by uid. `userId` scopes the read to the owner — pass null ONLY from an
 * admin-guarded route. Ownership is enforced here rather than at the call site
 * so a new caller cannot forget it.
 */
export async function getByUid(
  env: Env,
  uid: string,
  userId: number | null,
): Promise<SubmissionRow | null> {
  const sql = userId === null
    ? 'SELECT * FROM referral_submissions WHERE uid = ?'
    : 'SELECT * FROM referral_submissions WHERE uid = ? AND referrer_user_id = ?';
  const binds = userId === null ? [uid] : [uid, userId];
  return (await env.DB.prepare(sql).bind(...binds).first<SubmissionRow>()) || null;
}

export async function listEvents(env: Env, submissionId: number): Promise<SubmissionEvent[]> {
  const res = await env.DB.prepare(
    `SELECT label, status, note, created_at
       FROM referral_submission_events
      WHERE submission_id = ?
      ORDER BY created_at ASC, id ASC`,
  ).bind(submissionId).all<SubmissionEvent>();
  return res.results || [];
}

/** Counts by status for the referrer's summary tiles. */
export async function countsForReferrer(
  env: Env,
  userId: number,
): Promise<{ total: number; byStatus: Record<string, number>; converted: number; rewardIssued: number }> {
  const res = await env.DB.prepare(
    `SELECT status, COUNT(*) AS n
       FROM referral_submissions
      WHERE referrer_user_id = ?
      GROUP BY status`,
  ).bind(userId).all<{ status: string; n: number }>();
  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const r of res.results || []) {
    byStatus[r.status] = r.n;
    total += r.n;
  }
  // "Converted" is the outcome the referrer cares about, and it is cumulative:
  // anything that reached conversion counts, including rows that have since
  // moved on to reward states. Counting only status='converted' would make the
  // number go DOWN when a referral succeeds further, which reads as a bug.
  const converted =
    (byStatus.converted || 0) +
    (byStatus.reward_eligible || 0) +
    (byStatus.reward_issued || 0);
  return { total, byStatus, converted, rewardIssued: byStatus.reward_issued || 0 };
}

export async function hasStrategicAccess(env: Env, userId: number): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT status FROM referral_strategic_access WHERE user_id = ?`,
  ).bind(userId).first<{ status: string }>();
  return row?.status === 'granted';
}

export async function strategicAccessState(
  env: Env,
  userId: number,
): Promise<'none' | 'requested' | 'granted' | 'declined'> {
  const row = await env.DB.prepare(
    `SELECT status FROM referral_strategic_access WHERE user_id = ?`,
  ).bind(userId).first<{ status: string }>();
  if (!row) return 'none';
  return (row.status as 'requested' | 'granted' | 'declined') || 'none';
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export class ReferralError extends Error {
  // Fields are declared and assigned explicitly rather than via TypeScript
  // parameter properties: the worker test suite runs under Node's strip-only
  // type stripping, which rejects `constructor(public code: string)`.
  code: string;
  httpStatus: number;

  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.name = 'ReferralError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/**
 * Create one submission plus its opening timeline event.
 *
 * Self-referral is blocked at the route layer (it needs the caller's email);
 * this layer enforces the invite-only gate and field validity.
 */
export async function createSubmission(
  env: Env,
  userId: number,
  input: CreateInput,
): Promise<SubmissionRow> {
  if (!isCategory(input.category)) {
    throw new ReferralError('bad_category', 'Unknown referral category.');
  }
  const referredName = clean(input.referredName, MAX_LEN.referredName);
  if (!referredName) {
    throw new ReferralError('missing_name', 'A referral needs a name.');
  }
  if (INVITE_ONLY_CATEGORIES.has(input.category) && !(await hasStrategicAccess(env, userId))) {
    throw new ReferralError(
      'invite_only',
      'Strategic and capital introductions are invite-only. Request access first.',
      403,
    );
  }

  const uid = newUid();
  const source = input.source === 'csv' ? 'csv' : 'form';
  await env.DB.prepare(
    `INSERT INTO referral_submissions
       (uid, referrer_user_id, category, referred_name, referred_org,
        referred_contact, your_role, context, status, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?)`,
  ).bind(
    uid, userId, input.category, referredName,
    clean(input.referredOrg, MAX_LEN.referredOrg),
    clean(input.referredContact, MAX_LEN.referredContact),
    clean(input.yourRole, MAX_LEN.yourRole),
    clean(input.context, MAX_LEN.context),
    source,
  ).run();

  const row = await env.DB.prepare(
    `SELECT * FROM referral_submissions WHERE uid = ?`,
  ).bind(uid).first<SubmissionRow>();
  if (!row) throw new ReferralError('insert_failed', 'Could not save the referral.', 500);

  await appendEvent(env, row.id, 'submitted', null, null);
  return row;
}

/** Append a timeline row. Label is derived from the status so the timeline and
 *  the status chip can never disagree. */
export async function appendEvent(
  env: Env,
  submissionId: number,
  status: Status | null,
  note: string | null,
  actorUserId: number | null,
): Promise<void> {
  const label = status ? STATUS_LABELS[status] : 'Updated';
  await env.DB.prepare(
    `INSERT INTO referral_submission_events (submission_id, label, status, note, actor_user_id)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(submissionId, label, status, clean(note, MAX_LEN.note), actorUserId).run();
}

/**
 * Admin review action: move status and optionally set the reviewer-facing
 * fields. Appends to the timeline in the same call so a status can never
 * change without a history row.
 */
export async function reviewSubmission(
  env: Env,
  uid: string,
  actorUserId: number,
  patch: {
    status?: string;
    note?: string | null;
    rewardLabel?: string | null;
    nextStep?: string | null;
    fitNotes?: string | null;
  },
): Promise<SubmissionRow> {
  const row = await getByUid(env, uid, null);
  if (!row) throw new ReferralError('not_found', 'No such referral.', 404);

  const sets: string[] = [];
  const binds: unknown[] = [];
  let nextStatus: Status | null = null;

  if (patch.status !== undefined) {
    if (!isStatus(patch.status)) throw new ReferralError('bad_status', 'Unknown status.');
    nextStatus = patch.status;
    sets.push('status = ?');
    binds.push(nextStatus);
  }
  if (patch.rewardLabel !== undefined) { sets.push('reward_label = ?'); binds.push(clean(patch.rewardLabel, 120)); }
  if (patch.nextStep !== undefined) { sets.push('next_step = ?'); binds.push(clean(patch.nextStep, 240)); }
  if (patch.fitNotes !== undefined) { sets.push('fit_notes = ?'); binds.push(clean(patch.fitNotes, 2000)); }

  if (sets.length) {
    sets.push('updated_at = CURRENT_TIMESTAMP');
    binds.push(row.id);
    await env.DB.prepare(
      `UPDATE referral_submissions SET ${sets.join(', ')} WHERE id = ?`,
    ).bind(...binds).run();
  }

  // A note with no status change is still worth recording (a reviewer asking
  // for more detail), so append whenever either is present.
  if (nextStatus || patch.note) {
    await appendEvent(env, row.id, nextStatus, patch.note ?? null, actorUserId);
  }

  const fresh = await getByUid(env, uid, null);
  return fresh || row;
}

/**
 * Referrer-side update, allowed only while the pipeline is still open and only
 * on the context field — the reviewer's response to "More info needed".
 */
export async function addReferrerContext(
  env: Env,
  uid: string,
  userId: number,
  note: string,
): Promise<SubmissionRow> {
  const row = await getByUid(env, uid, userId);
  if (!row) throw new ReferralError('not_found', 'No such referral.', 404);
  if (TERMINAL_STATUSES.has(row.status)) {
    throw new ReferralError('closed', 'This referral is closed.', 409);
  }
  const cleaned = clean(note, MAX_LEN.note);
  if (!cleaned) throw new ReferralError('empty_note', 'Add some detail first.');

  await env.DB.prepare(
    `UPDATE referral_submissions
        SET context = CASE WHEN context IS NULL OR context = '' THEN ?
                           ELSE context || char(10) || char(10) || ? END,
            status = CASE WHEN status = 'more_info_needed' THEN 'under_review' ELSE status END,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
  ).bind(cleaned, cleaned, row.id).run();

  await appendEvent(
    env,
    row.id,
    row.status === 'more_info_needed' ? 'under_review' : null,
    cleaned,
    userId,
  );
  return (await getByUid(env, uid, userId)) as SubmissionRow;
}

/**
 * Parse a pasted CSV of `name, org, context`. Tolerates a header row, quoted
 * cells, and CRLF. Returns rows only — the caller creates them, so per-row
 * validation and the invite-only gate run through the same path as the form.
 */
export function parseCsv(text: string): Array<{ name: string; org: string; context: string }> {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const splitLine = (l: string) => l.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
  let rows = lines.map(splitLine);
  const header = rows[0].map((h) => h.toLowerCase());
  if (header.indexOf('name') > -1) rows = rows.slice(1);
  return rows
    .filter((r) => r[0])
    .map((r) => ({ name: r[0] || '', org: r[1] || '', context: r[2] || '' }));
}

export const CSV_IMPORT_LIMIT = 50;

export async function requestStrategicAccess(
  env: Env,
  userId: number,
  note: string | null,
): Promise<'requested' | 'granted' | 'declined'> {
  const existing = await strategicAccessState(env, userId);
  if (existing === 'granted' || existing === 'declined') return existing;
  await env.DB.prepare(
    `INSERT INTO referral_strategic_access (user_id, note, status)
     VALUES (?, ?, 'requested')
     ON CONFLICT(user_id) DO UPDATE SET note = excluded.note`,
  ).bind(userId, clean(note, MAX_LEN.note)).run();
  return 'requested';
}

/** Wire shape for the UI: the row plus its display labels. */
export function toWire(row: SubmissionRow, events?: SubmissionEvent[]) {
  return {
    uid: row.uid,
    category: row.category,
    category_name: CATEGORY_META[row.category]?.name ?? row.category,
    referred_name: row.referred_name,
    referred_org: row.referred_org,
    referred_contact: row.referred_contact,
    your_role: row.your_role,
    context: row.context,
    status: row.status,
    status_label: STATUS_LABELS[row.status] ?? row.status,
    reward_label: row.reward_label,
    next_step: row.next_step,
    fit_notes: row.fit_notes,
    source: row.source,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...(events ? { history: events } : {}),
  };
}
