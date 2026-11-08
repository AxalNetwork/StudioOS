/**
 * D4657 (#4657) — the one way a Spin-Out Lab milestone is recorded, and the
 * reconciler that catches up what a closed tab or an interrupted request missed.
 *
 * ONE RECORDER. Four paths used to write `spinout_lab_milestones`, each with
 * its own gate, insert and credit: `POST /spinout-lab/milestone`, the advisor
 * (Eadwyn) write router, the paid incorporation order and the saved EIN. Each
 * treated a gate it could not read as "legacy, carry on", and the route paid
 * credits off a read taken before the insert. All four now call
 * `recordLabMilestone`, which in order:
 *   1. knows the key (catalog), and that it has a completion rule;
 *   2. asks the shared eligibility policy (`labEnrollment.ts`);
 *   3. requires the Lab to be on;
 *   4. applies the cohort calendar gate, read through the enrollment;
 *   5. checks the saved work (`labEvidence.ts`);
 *   6. inserts the milestone with that evidence, once (UNIQUE user, key);
 *   7. advances the week through the existing pure `recordMilestone`;
 *   8. pays the credit when, and only when, step 6 inserted the row.
 * A read in steps 2, 4 or 5 that fails answers 503 and records nothing.
 *
 * DURABLE. Step 8 can be lost (the isolate dies after the insert). It is not
 * lost for good: `reconcileLabProgress` pays, through the same idempotent
 * `creditLabMilestone` (source ref `lab:<user>:<key>`), every evidence-backed
 * milestone with no grant, and records every milestone whose saved work exists
 * but was never recorded (the page that would have called us closed). The cron
 * walks enrolled founders a few at a time (`runLabReconcileTick`); `/state`
 * schedules the caller's own pass at most every RECONCILE_EVERY_MS.
 *
 * Rows from before migration 202611071700 are `evidence_kind = 'legacy'`: the
 * reconciler neither re-checks nor pays them; D541's backfill still governs.
 */
import type { Env } from '../types';
import { getSQL } from '../db';
import { VALID_MILESTONE_KEYS, weekForKey } from './spinoutLabCatalog';
import { mayParticipate, refusal, resolveLabEligibility, type LabEnrollment } from './labEnrollment';
import { evidenceFor, MILESTONE_EVIDENCE, type Evidence } from './labEvidence';

export type RecordedBy = 'member' | 'advisor' | 'order' | 'ein' | 'reconcile';

export type RecordOutcome =
  | { ok: true; inserted: boolean; evidence: Evidence; state: unknown; milestone_credit: unknown; graduation_credit: unknown }
  | { ok: false; status: 400 | 403 | 409 | 423 | 503; code: string; body: Record<string, unknown> };

const fail = (status: 400 | 403 | 409 | 423 | 503, code: string, error: string, extra: Record<string, unknown> = {}):
  Extract<RecordOutcome, { ok: false }> => ({ ok: false, status, code, body: { error, code, ...extra } });

/** Record `rawKey` for `userId` if the policy, the calendar and the saved work all allow it. */
export async function recordLabMilestone(env: Env, userId: number, rawKey: string, by: RecordedBy, nowMs = Date.now()): Promise<RecordOutcome> {
  const key = String(rawKey ?? '').trim();
  if (!key) return fail(400, 'milestone_key_required', 'milestone_key is required');
  const week = weekForKey(key);
  if (!VALID_MILESTONE_KEYS.has(key) || !week) return fail(400, 'milestone_key_unknown', `Unknown milestone_key: ${key}`);
  if (!MILESTONE_EVIDENCE[key]) return fail(400, 'milestone_key_unknown', `Unknown milestone_key: ${key}`);

  const elig = await resolveLabEligibility(env, userId, nowMs);
  if (!mayParticipate(elig)) {
    const r = refusal(elig);
    return { ok: false, status: r.status, code: String(r.body.code), body: r.body };
  }
  const enrollment: LabEnrollment = elig.enrollment;

  let active: { spinout_lab_active: number | null } | null;
  try {
    active = await env.DB.prepare('SELECT spinout_lab_active FROM users WHERE id = ?').bind(userId).first();
  } catch { return fail(503, 'lab_state_unavailable', 'Your Lab state could not be read just now. Try again in a moment.', { retryable: true }); }
  if (!active || Number(active.spinout_lab_active) !== 1) return fail(409, 'lab_inactive', 'Spin-Out Lab is not active');

  let gate: import('./cohortTiming').CohortGate | null;
  try {
    const { getCohortGate } = await import('./cohortTiming');
    gate = await getCohortGate(env, userId, nowMs);
  } catch {
    console.warn('[lab-progress] gate unreadable');
    return fail(503, 'lab_gate_unavailable', 'Your cohort calendar could not be read just now. Try again in a moment.', { retryable: true });
  }
  if (gate?.frozen) {
    return fail(423, 'lab_week_frozen',
      `Your sprint is paused at Week ${gate.frozen_week} pending admin review — deliverables can't be recorded until an admin grants a grace extension or an override.`,
      { locked: true, max_week: gate.max_week });
  }
  if (gate && week > gate.max_week) {
    const at = gate.weeks.find((w) => w.week === week)?.unlock_at ?? 'its unlock time';
    return fail(423, 'lab_week_locked', `Week ${week} is locked. Week ${week} unlocks on schedule — it is locked until ${at} UTC.`,
      { locked: true, max_week: gate.max_week });
  }

  // D4659: project work counts only from the enrollment's venture. With
  // several projects and none chosen yet, no project counts (person-level
  // steps still do) and the founder is asked to choose.
  let evidence: Evidence | null;
  let venture: import('./labVenture').Venture;
  try {
    const { resolveVenture, evidenceProjectId } = await import('./labVenture');
    venture = await resolveVenture(env, userId);
    evidence = await evidenceFor({ env, userId, enrollmentProjectId: evidenceProjectId(venture) }, key);
  } catch {
    console.warn('[lab-progress] evidence unreadable', { key });
    return fail(503, 'lab_evidence_unavailable', 'The work behind this step could not be read just now. Try again in a moment.', { retryable: true });
  }
  if (!evidence) {
    if (venture.status === 'needs_choice' || venture.status === 'deleted') {
      return fail(409, 'lab_venture_choice_needed', 'Choose which of your projects is your Lab venture, then this step can be recorded.', { milestone_key: key });
    }
    return fail(409, 'milestone_evidence_missing', 'This step is recorded once its work is saved.', { milestone_key: key });
  }

  const ins = await env.DB.prepare(
    `INSERT INTO spinout_lab_milestones
       (user_id, week, milestone_key, evidence_kind, evidence_ref, evidence_project_id, enrollment_id, recorded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, milestone_key) DO NOTHING`,
  ).bind(userId, week, key, evidence.kind, evidence.ref, evidence.project_id, enrollment.id, by).run();
  const inserted = Number(ins.meta?.changes ?? 0) === 1;

  // The week advance (and week 4's close) stays in the route's pure function,
  // which the exact-statement harness pins. Its own INSERT OR IGNORE is a no-op.
  const { recordMilestone } = await import('../routes/spinout_lab');
  const sql = getSQL(env);
  let state: unknown;
  try {
    const r = await recordMilestone(sql, userId, key);
    if (!r.ok) return fail(r.status, 'lab_inactive', r.error);
    state = r.state;
  } finally { await sql.end(); }

  let milestoneCredit: unknown = null;
  let graduationCredit: unknown = null;
  if (inserted) {
    const { creditLabMilestone } = await import('./labMilestoneCredits');
    milestoneCredit = await creditLabMilestone(env, userId, key);
    // D4659: the credential and its bonus follow the one graduation rule
    // (every required step of weeks 1-4), whichever step completed it.
    graduationCredit = await issueIfGraduated(env, userId);
  }
  return { ok: true, inserted, evidence, state, milestone_credit: milestoneCredit, graduation_credit: graduationCredit };
}

/**
 * Issue the credential, and pay its bonus, when the founder meets the
 * graduation rule (view spinout_lab_graduates, by_rule) and holds none yet.
 * Idempotent and best-effort: the certificate backfill and the reconciler
 * catch up anything missed. Returns the bonus outcome, or null.
 */
export async function issueIfGraduated(env: Env, userId: number): Promise<unknown> {
  try {
    const g = await env.DB.prepare('SELECT 1 AS x FROM spinout_lab_graduates WHERE user_id = ? AND by_rule = 1')
      .bind(userId).first();
    if (!g) return null;
    const { issueOnGraduation } = await import('./certificateIssuance');
    if ((await issueOnGraduation(env, userId)) !== 'issued') return null;
    const { creditLabGraduation } = await import('./labMilestoneCredits');
    return await creditLabGraduation(env, userId);
  } catch { console.warn('[lab-progress] graduation issue skipped'); return null; }
}

export type ReconcileResult = {
  status: 'done' | 'skipped' | 'unavailable';
  recorded: string[];
  credited: number;
  errors: number;
};

const ORDERED_KEYS = [...VALID_MILESTONE_KEYS].sort((a, b) => (weekForKey(a) ?? 9) - (weekForKey(b) ?? 9));

/**
 * One founder's pass: record what their saved work proves, then pay what an
 * interrupted request left unpaid. Never throws. Bounded: one evidence check
 * per unrecorded key, one ledger read, one credit call per unpaid row.
 */
export async function reconcileLabProgress(env: Env, userId: number, nowMs = Date.now()): Promise<ReconcileResult> {
  const out: ReconcileResult = { status: 'done', recorded: [], credited: 0, errors: 0 };
  try {
    const elig = await resolveLabEligibility(env, userId, nowMs);
    if (elig.status === 'unavailable') return { ...out, status: 'unavailable' };
    if (!mayParticipate(elig)) return { ...out, status: 'skipped' };
    const u = await env.DB.prepare('SELECT spinout_lab_active FROM users WHERE id = ?').bind(userId).first<{ spinout_lab_active: number | null }>();
    if (!u || Number(u.spinout_lab_active) !== 1) return { ...out, status: 'skipped' };

    const have = await env.DB.prepare('SELECT milestone_key FROM spinout_lab_milestones WHERE user_id = ?')
      .bind(userId).all<{ milestone_key: string }>();
    const recorded = new Set((have.results || []).map((r) => String(r.milestone_key)));
    const { getCohortGate } = await import('./cohortTiming');
    const gate = await getCohortGate(env, userId, nowMs);
    if (gate?.frozen) return { ...out, status: 'skipped' };
    const maxWeek = gate ? gate.max_week : 4;
    const { resolveVenture, evidenceProjectId } = await import('./labVenture');
    const ctx = { env, userId, enrollmentProjectId: evidenceProjectId(await resolveVenture(env, userId)) };
    for (const key of ORDERED_KEYS) {
      if (recorded.has(key) || (weekForKey(key) ?? 9) > maxWeek) continue;
      // One cheap check first; the full recorder re-checks everything.
      let ev: Evidence | null;
      try { ev = await evidenceFor(ctx, key); } catch { out.errors += 1; continue; }
      if (!ev) continue;
      const r = await recordLabMilestone(env, userId, key, 'reconcile', nowMs);
      if (r.ok && r.inserted) { out.recorded.push(key); recorded.add(key); }
      else if (!r.ok && r.status === 503) out.errors += 1;
      else if (!r.ok && r.code === 'lab_inactive') break; // the week-4 close turned the Lab off
    }

    // Evidence-backed rows whose grant is missing (an interrupted request).
    const unpaid = await env.DB.prepare(
      `SELECT m.milestone_key FROM spinout_lab_milestones m
        WHERE m.user_id = ? AND m.evidence_kind IN ('saved_work', 'paid_order', 'attested')
          AND NOT EXISTS (SELECT 1 FROM perk_credit_ledger g
                           WHERE g.user_id = m.user_id AND g.kind = 'grant'
                             AND g.source_ref = 'lab:' || m.user_id || ':' || m.milestone_key)
        ORDER BY m.id`,
    ).bind(userId).all<{ milestone_key: string }>();
    if ((unpaid.results || []).length) {
      const { creditLabMilestone } = await import('./labMilestoneCredits');
      for (const r of unpaid.results || []) {
        const c = await creditLabMilestone(env, userId, String(r.milestone_key));
        if (c.status === 'granted') out.credited += 1;
        else if (c.status === 'skipped' && c.reason === 'error') out.errors += 1;
      }
    }
    // D4659: a credential an interrupted request did not issue.
    await issueIfGraduated(env, userId);
    await env.DB.prepare(`UPDATE spinout_lab_enrollments SET reconciled_at = datetime('now') WHERE id = ?`)
      .bind(elig.enrollment.id).run();
    return out;
  } catch {
    console.warn('[lab-progress] reconcile failed');
    return { ...out, status: 'unavailable', errors: out.errors + 1 };
  }
}

/** How often a founder's own `/state` read schedules their pass. */
export const RECONCILE_EVERY_MS = 30 * 60_000;
export const RECONCILE_TICK_LIMIT = 3;

/** True when this enrollment has not been reconciled for RECONCILE_EVERY_MS. Never throws. */
export async function reconcileDue(env: Env, userId: number, nowMs = Date.now()): Promise<boolean> {
  try {
    const r = await env.DB.prepare(
      `SELECT reconciled_at FROM spinout_lab_enrollments WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
    ).bind(userId).first<{ reconciled_at: string | null }>();
    if (!r) return false;
    if (!r.reconciled_at) return true;
    const ms = Date.parse(String(r.reconciled_at).replace(' ', 'T') + 'Z');
    return !Number.isFinite(ms) || nowMs - ms >= RECONCILE_EVERY_MS;
  } catch { return false; }
}

/**
 * The cron's walk: the next `limit` founders with the Lab on, in user-id
 * order after the stored cursor, wrapping to the start. Each founder's pass is
 * independent; a failure is counted and the walk goes on.
 */
export async function runLabReconcileTick(env: Env, opts: { limit?: number; nowMs?: number } = {}): Promise<{ walked: number; recorded: number; credited: number; errors: number }> {
  const limit = Math.max(1, Math.min(10, opts.limit ?? RECONCILE_TICK_LIMIT));
  const nowMs = opts.nowMs ?? Date.now();
  const cur = await env.DB.prepare('SELECT after_user_id FROM spinout_lab_reconcile_cursor WHERE id = 1')
    .first<{ after_user_id: number }>();
  const after = Number(cur?.after_user_id ?? 0);
  const pick = (from: number) => env.DB.prepare(
    `SELECT DISTINCT e.user_id FROM spinout_lab_enrollments e JOIN users u ON u.id = e.user_id
      WHERE u.spinout_lab_active = 1 AND e.user_id > ? ORDER BY e.user_id LIMIT ?`,
  ).bind(from, limit).all<{ user_id: number }>();
  let rows = (await pick(after)).results || [];
  if (rows.length === 0 && after > 0) rows = (await pick(0)).results || [];
  const tally = { walked: 0, recorded: 0, credited: 0, errors: 0 };
  for (const r of rows) {
    const res = await reconcileLabProgress(env, Number(r.user_id), nowMs);
    tally.walked += 1; tally.recorded += res.recorded.length; tally.credited += res.credited; tally.errors += res.errors;
  }
  const next = rows.length ? Number(rows[rows.length - 1].user_id) : 0;
  await env.DB.prepare(
    `INSERT INTO spinout_lab_reconcile_cursor (id, after_user_id, updated_at) VALUES (1, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET after_user_id = excluded.after_user_id, updated_at = excluded.updated_at`,
  ).bind(next).run();
  return tally;
}

/** The short reason a side-effect caller (order webhook, EIN save, advisor) reports for a refusal. */
export function outcomeReason(r: Extract<RecordOutcome, { ok: false }>):
  'not_paid' | 'week_locked' | 'frozen' | 'lab_inactive' | 'ineligible' | 'unavailable' | 'error' {
  if (r.status === 503) return 'unavailable';
  if (r.code === 'lab_week_frozen') return 'frozen';
  if (r.code === 'lab_week_locked') return 'week_locked';
  if (r.code === 'lab_inactive') return 'lab_inactive';
  if (r.code === 'milestone_evidence_missing') return 'not_paid';
  if (r.status === 403 || r.code === 'lab_graduated' || r.code === 'lab_cohort_not_started') return 'ineligible';
  return 'error';
}
