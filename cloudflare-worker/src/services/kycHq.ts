/**
 * D1230 (#3238) — KYC part 2: sanctions screening on submission, and a case
 * sent to HQ (migration 615).
 *
 * - `screenOnSubmission` screens the person when they submit. A screening
 *   that could not run writes an `unreadable` attempt and no screening row,
 *   so the case never reads it as clear. A match raises `sanctions_match`.
 * - `raiseReferral` sends the case to HQ: `pep` and `sanctions_match` on the
 *   Worker's own, `admin` with an admin's note. While one is undecided only a
 *   Super Admin decides the case (routes/kyc.ts).
 * - `caseScreening` and `caseReferrals` are the case read's two blocks. A
 *   read that fails is `unreadable`, never "clear" and never "not with HQ".
 *
 * Logs hold codes and counts only: no name, list text, note or match.
 */
import type { Env } from '../types';
import { IncompleteSanctionsScreeningError, screenUser } from './sanctions';

export const HQ_REASONS = ['pep', 'sanctions_match', 'admin'] as const;
export type HqReason = typeof HQ_REASONS[number];
export const NOTE_MIN = 5;
export const NOTE_MAX = 1000;

type Person = { id: number; name: string | null } | null;

/** Whether a stamp from the Worker's D1 (`YYYY-MM-DD HH:MM:SS`, UTC) is after another. */
function after(a: string | null | undefined, b: string | null | undefined): boolean {
  const t = (s: string | null | undefined) => (s ? Date.parse(`${String(s).replace(' ', 'T')}${/[zZ]|[+-]\d\d:?\d\d$/.test(String(s)) ? '' : 'Z'}`) : NaN);
  const ta = t(a);
  const tb = t(b);
  if (Number.isNaN(ta)) return false;
  if (Number.isNaN(tb)) return true;
  return ta > tb;
}

async function recordAttempt(env: Env, userId: number, outcome: 'screened' | 'unreadable', reason: string | null, screeningId: number | null) {
  try {
    await env.DB.prepare('INSERT INTO kyc_screening_attempts (user_id, outcome, reason, screening_id) VALUES (?, ?, ?, ?)')
      .bind(userId, outcome, reason, screeningId).run();
  } catch (e) {
    console.error('[kyc-hq] attempt not recorded', outcome, (e as Error)?.name);
  }
}

/**
 * Send a case to HQ. One undecided row per person and reason: a second raise
 * of the same reason is a no-op that answers `already: true`.
 */
export async function raiseReferral(
  env: Env,
  r: { userId: number; reason: HqReason; note?: string | null; raisedBy?: number | null; screeningId?: number | null },
): Promise<{ id: number | null; already: boolean }> {
  const ins: any = await env.DB.prepare(
    `INSERT INTO kyc_hq_referrals (user_id, reason, note, screening_id, raised_by)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id, reason) WHERE decided_at IS NULL DO NOTHING
     RETURNING id`,
  ).bind(r.userId, r.reason, r.note ?? null, r.screeningId ?? null, r.raisedBy ?? null).first();
  return ins?.id ? { id: Number(ins.id), already: false } : { id: null, already: true };
}

export type SubmissionScreening =
  | { state: 'screened'; screening_id: number; hit: boolean; severity: string; match_count: number }
  | { state: 'unreadable'; reason: 'lists_unavailable' | 'not_recorded' | 'error' };

/**
 * Screen a person on submission, from what they submitted. Never throws: a
 * run that could not finish is recorded as `unreadable` and the submission
 * stands. A match sends the case to HQ.
 */
export async function screenOnSubmission(
  env: Env,
  userId: number,
  person: { legal_first_name?: string; legal_last_name?: string; date_of_birth?: string | null; nationality?: string | null; country?: string | null },
): Promise<SubmissionScreening> {
  const full = `${person.legal_first_name || ''} ${person.legal_last_name || ''}`.trim();
  let r: Awaited<ReturnType<typeof screenUser>>;
  try {
    r = await screenUser(env, userId, {
      full_legal_name: full,
      date_of_birth: person.date_of_birth || null,
      nationality: person.nationality || person.country || null,
    }, { reason: 'kyc_submission' });
  } catch (e) {
    const reason = e instanceof IncompleteSanctionsScreeningError ? 'lists_unavailable' : 'error';
    console.error('[kyc-hq] submission screening not completed', reason);
    await recordAttempt(env, userId, 'unreadable', reason, null);
    return { state: 'unreadable', reason };
  }
  // `screenUser` answers id 0 when its own row could not be written: no
  // record means no result, so it is not clear either.
  if (!r.id) {
    await recordAttempt(env, userId, 'unreadable', 'not_recorded', null);
    return { state: 'unreadable', reason: 'not_recorded' };
  }
  await recordAttempt(env, userId, 'screened', null, r.id);
  if (r.hit) {
    try {
      await raiseReferral(env, {
        userId,
        reason: 'sanctions_match',
        screeningId: r.id,
        note: `Screening #${r.id} found ${r.matches.length} possible match${r.matches.length === 1 ? '' : 'es'} (severity: ${r.severity}).`,
      });
    } catch (e) {
      console.error('[kyc-hq] match referral not raised', (e as Error)?.name);
    }
  }
  return { state: 'screened', screening_id: r.id, hit: r.hit, severity: r.severity, match_count: r.matches.length };
}

export type CaseScreening =
  | { state: 'not_run' }
  | { state: 'unreadable'; reason: string; at: string | null }
  | {
    state: 'clear' | 'match';
    id: number;
    run_at: string;
    severity: string;
    match_count: number;
    reviewed: null | { by: Person; at: string; notes: string | null };
  };

/**
 * The case's screening: the latest run, or why there is none. An attempt
 * that could not run, with no screening after it, is `unreadable`; so is a
 * read that fails. Neither is ever `clear`.
 */
export async function caseScreening(env: Env, userId: number): Promise<CaseScreening> {
  try {
    const s: any = await env.DB.prepare(
      `SELECT s.id, s.run_at, s.hit, s.severity, s.match_count, s.reviewed_by, s.reviewed_at, s.review_notes, u.name AS reviewer_name
         FROM sanctions_screenings s LEFT JOIN users u ON u.id = s.reviewed_by
        WHERE s.user_id = ? ORDER BY s.id DESC LIMIT 1`,
    ).bind(userId).first();
    const a: any = await env.DB.prepare(
      'SELECT outcome, reason, attempted_at FROM kyc_screening_attempts WHERE user_id = ? ORDER BY id DESC LIMIT 1',
    ).bind(userId).first();
    if (a?.outcome === 'unreadable' && (!s || !after(s.run_at, a.attempted_at))) {
      return { state: 'unreadable', reason: a.reason || 'error', at: a.attempted_at || null };
    }
    if (!s) return { state: 'not_run' };
    return {
      state: Number(s.hit) === 1 ? 'match' : 'clear',
      id: Number(s.id),
      run_at: s.run_at,
      severity: s.severity,
      match_count: Number(s.match_count) || 0,
      reviewed: s.reviewed_at
        ? { by: s.reviewed_by ? { id: Number(s.reviewed_by), name: s.reviewer_name || null } : null, at: s.reviewed_at, notes: s.review_notes || null }
        : null,
    };
  } catch (e) {
    console.error('[kyc-hq] screening read failed', (e as Error)?.name);
    return { state: 'unreadable', reason: 'read_failed', at: null };
  }
}

export type Referral = {
  id: number;
  reason: HqReason;
  note: string | null;
  screening_id: number | null;
  raised_by: Person;
  raised_at: string;
  decided_by: Person;
  decided_at: string | null;
  decision: 'approved' | 'rejected' | null;
  decision_note: string | null;
};

/** Every referral for a person, newest first; `open` the undecided ones. Throws when the store cannot be read. */
export async function referralsFor(env: Env, userId: number): Promise<{ open: Referral[]; decided: Referral[] }> {
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.reason, r.note, r.screening_id, r.raised_by, r.raised_at, r.decided_by, r.decided_at, r.decision, r.decision_note,
            ru.name AS raised_name, du.name AS decided_name
       FROM kyc_hq_referrals r
       LEFT JOIN users ru ON ru.id = r.raised_by
       LEFT JOIN users du ON du.id = r.decided_by
      WHERE r.user_id = ? ORDER BY r.id DESC LIMIT 50`,
  ).bind(userId).all<any>();
  const rows: Referral[] = (results || []).map((r: any) => ({
    id: Number(r.id),
    reason: r.reason,
    note: r.note || null,
    screening_id: r.screening_id == null ? null : Number(r.screening_id),
    raised_by: r.raised_by ? { id: Number(r.raised_by), name: r.raised_name || null } : null,
    raised_at: r.raised_at,
    decided_by: r.decided_by ? { id: Number(r.decided_by), name: r.decided_name || null } : null,
    decided_at: r.decided_at || null,
    decision: r.decision || null,
    decision_note: r.decision_note || null,
  }));
  return { open: rows.filter((r) => !r.decided_at), decided: rows.filter((r) => r.decided_at) };
}

/** The case read's HQ block: a failed read says so, never "not with HQ". */
export async function caseReferrals(env: Env, userId: number) {
  try {
    const { open, decided } = await referralsFor(env, userId);
    return { state: 'ready' as const, with_hq: open.length > 0, open, decided };
  } catch (e) {
    console.error('[kyc-hq] referral read failed', (e as Error)?.name);
    return { state: 'unreadable' as const };
  }
}

/** Close every undecided referral for a person with HQ's verdict. */
export async function closeReferrals(env: Env, userId: number, by: number, decision: 'approved' | 'rejected', note: string | null) {
  await env.DB.prepare(
    `UPDATE kyc_hq_referrals SET decided_by = ?, decided_at = CURRENT_TIMESTAMP, decision = ?, decision_note = ?
      WHERE user_id = ? AND decided_at IS NULL`,
  ).bind(by, decision, note, userId).run();
}

/** A note an admin writes: trimmed, NOTE_MIN to NOTE_MAX characters, or null. */
export function noteOf(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length >= NOTE_MIN && s.length <= NOTE_MAX ? s : null;
}
