/**
 * Cohort Timing & Gating — admin controls. Mounted at /api/admin/cohort.
 * Every endpoint gates on requireAdmin.
 *
 *   GET  /timeline              → cycles + week windows + participant/status counts
 *   GET  /review?cycle_id=&week= → review queue: failed/grace rows + at-risk (incomplete, deadline pending)
 *   POST /grace                 → { user_id, cycle_id, week, hours, reason } — reason REQUIRED
 *   POST /override              → { user_id, cycle_id, week, decision: pass|fail, reason } — reason REQUIRED,
 *                                 logged to stage_transition_log with triggered_by='admin'
 *   GET  /impersonation-audit   → recent impersonation_sessions rows
 *
 * All admin decisions write stage_transition_log (audit) and notify the
 * founder instantly. Grace extensions defer the scheduler's decision until
 * grace_until; the cron's grace-expiry sweep finalizes them.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin, requireSuperAdmin, requireBranchNotSuspended } from '../auth';
import { hashEmail } from '../util/hashEmail';
import {
  ensureCohortTimingSchema,
  applyWeekDecision,
  evaluateWeekOutcome,
  sqliteUtcToMs,
} from '../services/cohortTiming';
import { MILESTONES } from '../services/spinoutLabCatalog';

const r = new Hono<{ Bindings: Env }>();

const isoNow = (): string => new Date().toISOString().replace('T', ' ').slice(0, 19);

async function logActivity(env: Env, adminEmail: string, adminId: number, action: string, details: string): Promise<void> {
  try {
    const actor = await hashEmail(adminEmail);
    await env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`,
    ).bind(action, details, actor, adminId).run();
  } catch (e) { console.warn('[admin/cohort] activity log failed', e); }
}

async function notifyFounderInstant(env: Env, userId: number, type: string, title: string, body: string): Promise<void> {
  try {
    const { notify } = await import('../services/notify');
    // No category → treated as critical: bypasses digest/quiet-hours.
    await notify(env, { userId, type, title, body, link: '/spinout-lab', channels: ['in_app', 'email'] });
  } catch (e) { console.warn('[admin/cohort] notify failed', e); }
}

r.get('/timeline', async (c) => {
  await requireAdmin(c);
  await ensureCohortTimingSchema(c.env);
  const cycles = await c.env.DB.prepare(
    `SELECT * FROM cohort_cycles ORDER BY year DESC, month DESC LIMIT 12`,
  ).all<Record<string, unknown>>();
  const out = [];
  for (const cy of cycles.results || []) {
    const windows = await c.env.DB.prepare(
      `SELECT week_number, unlock_at, deadline_at FROM week_windows WHERE cohort_cycle_id = ? ORDER BY week_number`,
    ).bind(cy.id).all<Record<string, unknown>>();
    const participants = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM users
        WHERE spinout_lab_active = 1 AND spinout_lab_started_at >= ? AND spinout_lab_started_at < ?`,
    ).bind(cy.start_at, cy.end_at).first<{ n: number }>();
    const statuses = await c.env.DB.prepare(
      `SELECT week_number, status, COUNT(*) AS n FROM company_week_status
        WHERE cohort_cycle_id = ? GROUP BY week_number, status`,
    ).bind(cy.id).all<{ week_number: number; status: string; n: number }>();
    out.push({
      ...cy,
      windows: windows.results || [],
      participant_count: participants?.n ?? 0,
      status_counts: statuses.results || [],
    });
  }
  return c.json({ cycles: out, server_time: new Date().toISOString() });
});

r.get('/review', async (c) => {
  await requireAdmin(c);
  await ensureCohortTimingSchema(c.env);
  const cycleId = parseInt(c.req.query('cycle_id') || '0') || null;

  // Decided/held rows needing attention: failed + grace.
  const decided = await c.env.DB.prepare(
    `SELECT s.*, u.name, u.email, c.year, c.month
       FROM company_week_status s
       JOIN users u ON u.id = s.user_id
       JOIN cohort_cycles c ON c.id = s.cohort_cycle_id
      WHERE s.status IN ('failed', 'grace') ${cycleId ? 'AND s.cohort_cycle_id = ?' : ''}
      ORDER BY s.decided_at DESC LIMIT 200`,
  ).bind(...(cycleId ? [cycleId] : [])).all<Record<string, unknown>>();

  // At-risk: active founders in a current cycle whose CURRENT week has
  // incomplete deliverables and a pending (future) deadline.
  const nowIso = isoNow();
  const windows = await c.env.DB.prepare(
    `SELECT w.*, c.start_at AS cycle_start, c.end_at AS cycle_end, c.year, c.month
       FROM week_windows w JOIN cohort_cycles c ON c.id = w.cohort_cycle_id
      WHERE w.unlock_at <= ? AND w.deadline_at > ? ${cycleId ? 'AND c.id = ?' : ''}`,
  ).bind(nowIso, nowIso, ...(cycleId ? [cycleId] : [])).all<Record<string, unknown>>();
  const atRisk: Array<Record<string, unknown>> = [];
  for (const w of windows.results || []) {
    const parts = await c.env.DB.prepare(
      `SELECT id, name, email FROM users
        WHERE spinout_lab_active = 1 AND spinout_lab_started_at >= ? AND spinout_lab_started_at < ?`,
    ).bind(w.cycle_start, w.cycle_end).all<{ id: number; name: string | null; email: string }>();
    for (const p of parts.results || []) {
      const done = await c.env.DB.prepare(
        `SELECT milestone_key, completed_at FROM spinout_lab_milestones WHERE user_id = ?`,
      ).bind(p.id).all<{ milestone_key: string; completed_at: string }>();
      const completed = (done.results || [])
        .map((row) => ({ key: row.milestone_key, completed_at_ms: sqliteUtcToMs(row.completed_at) ?? 0 }));
      const outcome = evaluateWeekOutcome(Number(w.week_number), completed, Date.now());
      if (!outcome.passed) {
        atRisk.push({
          user_id: p.id, name: p.name, email: p.email,
          cycle_id: w.cohort_cycle_id, week: w.week_number,
          deadline_at: w.deadline_at,
          missing: outcome.missing,
          done: outcome.doneCount, required: outcome.requiredCount,
        });
      }
    }
  }
  return c.json({ review: decided.results || [], at_risk: atRisk, server_time: new Date().toISOString() });
});

r.post('/grace', async (c) => {
  const adminUser = await requireAdmin(c);
  await ensureCohortTimingSchema(c.env);
  const body = await c.req.json().catch(() => ({}));
  const userId = parseInt(String(body.user_id ?? '')) || 0;
  const cycleId = parseInt(String(body.cycle_id ?? '')) || 0;
  const week = parseInt(String(body.week ?? '')) || 0;
  const hours = Math.min(168, Math.max(1, parseInt(String(body.hours ?? '')) || 0));
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!userId || !cycleId || !week || week > 4) return c.json({ error: 'user_id, cycle_id and week (1-4) are required' }, 400);
  if (!reason) return c.json({ error: 'A reason is required for grace extensions' }, 400);
  if (!body.hours) return c.json({ error: 'hours (1-168) is required' }, 400);

  const existing = await c.env.DB.prepare(
    `SELECT status FROM company_week_status WHERE user_id = ? AND cohort_cycle_id = ? AND week_number = ?`,
  ).bind(userId, cycleId, week).first<{ status: string }>();
  const graceUntil = new Date(Date.now() + hours * 3600_000).toISOString().replace('T', ' ').slice(0, 19);
  await applyWeekDecision(c.env, {
    userId, cycleId, week,
    toStatus: 'grace',
    fromStatus: existing?.status ?? 'pending',
    reason, triggeredBy: 'admin', adminUserId: adminUser.id,
    graceUntil, graceReason: reason,
  });
  await logActivity(c.env, adminUser.email, adminUser.id, 'cohort_grace_extension',
    `Grace extension for user_id=${userId} cycle=${cycleId} week=${week} until ${graceUntil} UTC. Reason: ${reason}`);
  await notifyFounderInstant(c.env, userId, 'cohort_grace_granted',
    `Grace extension granted — Week ${week}`,
    `An admin granted you a ${hours}-hour grace extension for your Week ${week} deliverables (new cutoff: ${graceUntil} UTC). Finish the remaining items before then to pass the week.`);
  return c.json({ ok: true, grace_until: graceUntil });
});

r.post('/override', async (c) => {
  const adminUser = await requireAdmin(c);
  await ensureCohortTimingSchema(c.env);
  const body = await c.req.json().catch(() => ({}));
  const userId = parseInt(String(body.user_id ?? '')) || 0;
  const cycleId = parseInt(String(body.cycle_id ?? '')) || 0;
  const week = parseInt(String(body.week ?? '')) || 0;
  const decision = body.decision === 'pass' ? 'passed' : body.decision === 'fail' ? 'failed' : null;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!userId || !cycleId || !week || week > 4) return c.json({ error: 'user_id, cycle_id and week (1-4) are required' }, 400);
  if (!decision) return c.json({ error: "decision must be 'pass' or 'fail'" }, 400);
  if (!reason) return c.json({ error: 'A reason is required for pass/fail overrides' }, 400);

  const existing = await c.env.DB.prepare(
    `SELECT status FROM company_week_status WHERE user_id = ? AND cohort_cycle_id = ? AND week_number = ?`,
  ).bind(userId, cycleId, week).first<{ status: string }>();
  await applyWeekDecision(c.env, {
    userId, cycleId, week,
    toStatus: decision,
    fromStatus: existing?.status ?? 'pending',
    reason, triggeredBy: 'admin', adminUserId: adminUser.id,
  });
  if (decision === 'passed' && week < 4) {
    // Force-pass unfreezes the founder into the next week if they're behind.
    await c.env.DB.prepare(
      `UPDATE users SET spinout_lab_week = MAX(COALESCE(spinout_lab_week, 1), ?) WHERE id = ?`,
    ).bind(week + 1, userId).run();
  }
  await logActivity(c.env, adminUser.email, adminUser.id, 'cohort_override',
    `Force-${body.decision} for user_id=${userId} cycle=${cycleId} week=${week}. Reason: ${reason}`);
  await notifyFounderInstant(c.env, userId, `cohort_week_${decision}`,
    decision === 'passed' ? `Week ${week} marked passed by admin review` : `Week ${week} marked failed by admin review`,
    decision === 'passed'
      ? `After review, your Week ${week} was marked as passed. ${week < 4 ? `Week ${week + 1} is open.` : ''}`
      : `After review, your Week ${week} was marked as failed. Your workspace is paused at Week ${week} — contact the team if you believe this is in error.`);
  return c.json({ ok: true, status: decision });
});

r.get('/impersonation-audit', async (c) => {
  // D133 — SUPER ADMIN. This is `impersonation_sessions` joined to `users`
  // TWICE, for the actor's name and the target's name and email: every admin's
  // support-session history, readable by every other admin. It is the same
  // query shape D132 raised on `/monitoring/analytics/{audit, audit/export.csv,
  // exports/recent}` and it was missed there, one file over, because that pass
  // went looking in `monitoring_analytics.ts` rather than for the join.
  //
  // The rule D132 wrote for its own file is the one being applied here: a route
  // that reaches another admin's activity is a cross-admin read whatever it
  // renders, and gating some of them is gating none of them.
  await requireSuperAdmin(c);
  await ensureCohortTimingSchema(c.env);
  const rows = await c.env.DB.prepare(
    `SELECT i.*, a.name AS admin_name, t.name AS target_name, t.email AS target_email
       FROM impersonation_sessions i
       LEFT JOIN users a ON a.id = i.admin_user_id
       LEFT JOIN users t ON t.id = i.target_user_id
      ORDER BY i.started_at DESC LIMIT 100`,
  ).all<Record<string, unknown>>();
  return c.json({ sessions: rows.results || [] });
});

// Milestone catalog echo so the admin UI can label missing deliverables.
r.get('/catalog', async (c) => {
  await requireAdmin(c);
  return c.json({ milestones: MILESTONES });
});

// ---------------------------------------------------------------------------
// Task #5 — Cohort application lifecycle admin console.
//   GET  /applications              → cycle overview (counts, thresholds,
//                                     countdowns) + per-cycle applicant list
//   POST /applications/settings     → { min_cohort_size?, max_cohort_size? }
//   POST /applications/:id/decide   → { status: approved|rejected|waitlisted, reason } — reason REQUIRED
//   POST /applications/cycles/:cycle_id/force-proceed → { reason } — reason REQUIRED
//   GET  /applications/notifications?cycle_id= → notification ledger
//   GET  /applications/events?cycle_id=        → cycle lifecycle audit
// ---------------------------------------------------------------------------

r.get('/applications', async (c) => {
  await requireAdmin(c);
  const { ensureCohortAppSchema, getCohortSizeSettings, monthLabel } = await import('../services/cohortApplications');
  await ensureCohortAppSchema(c.env);
  const settings = await getCohortSizeSettings(c.env);
  const cycles = await c.env.DB.prepare(
    `SELECT * FROM cohort_cycles ORDER BY year DESC, month DESC LIMIT 12`,
  ).all<Record<string, unknown>>();
  const out = [];
  for (const cy of cycles.results || []) {
    const counts = await c.env.DB.prepare(
      `SELECT status, COUNT(*) AS n FROM cohort_applicants WHERE cohort_cycle_id = ? GROUP BY status`,
    ).bind(cy.id).all<{ status: string; n: number }>();
    const byStatus: Record<string, number> = {};
    for (const row of counts.results || []) byStatus[row.status] = row.n;
    const applicants = await c.env.DB.prepare(
      `SELECT ca.id, ca.application_id, ca.user_id, ca.status, ca.rolled_from_cycle_id,
              ca.decided_at, ca.decided_by, ca.decision_reason, ca.created_at,
              u.name, u.email, a.company_name, a.idea, a.stage, a.jurisdiction
         FROM cohort_applicants ca
         JOIN users u ON u.id = ca.user_id
         LEFT JOIN spinout_applications a ON a.id = ca.application_id
        WHERE ca.cohort_cycle_id = ?
        ORDER BY CASE WHEN ca.status = 'pending' THEN 0 ELSE 1 END, ca.created_at DESC
        LIMIT 200`,
    ).bind(cy.id).all<Record<string, unknown>>();
    // D383 — each applicant's answers, applicant-facing note and live
    // interview, read separately so a database without migrations 315–316
    // still lists its applicants (with those fields null) instead of failing.
    const lifecycle = new Map<number, Record<string, unknown>>();
    try {
      const { parseStoredAnswers, parseStoredAsks } = await import('../services/applicationLifecycle');
      const lc = await c.env.DB.prepare(
        `SELECT ca.id AS applicant_id, a.answers_json, a.withdrawn_at, a.applicant_note,
                a.applicant_asks_json, a.applicant_note_at
           FROM cohort_applicants ca LEFT JOIN spinout_applications a ON a.id = ca.application_id
          WHERE ca.cohort_cycle_id = ?`,
      ).bind(cy.id).all<Record<string, unknown>>();
      for (const row of lc.results || []) {
        lifecycle.set(Number(row.applicant_id), {
          answers: parseStoredAnswers(row.answers_json),
          answers_recorded: typeof row.answers_json === 'string' && !!row.answers_json,
          withdrawn_at: row.withdrawn_at ?? null,
          applicant_note: row.applicant_note ?? null,
          applicant_asks: parseStoredAsks(row.applicant_asks_json),
          applicant_note_at: row.applicant_note_at ?? null,
          interview: null,
        });
      }
      const iv = await c.env.DB.prepare(
        `SELECT ca.id AS applicant_id, i.id, i.scheduled_at, i.duration_min, i.location, i.note, i.status,
                i.reschedule_requested_at, i.reschedule_reason
           FROM spinout_application_interviews i
           JOIN cohort_applicants ca ON ca.application_id = i.application_id
          WHERE ca.cohort_cycle_id = ?
          ORDER BY i.id ASC`,
      ).bind(cy.id).all<Record<string, unknown>>();
      for (const row of iv.results || []) {
        const entry = lifecycle.get(Number(row.applicant_id));
        if (entry) { const { applicant_id: _drop, ...rest } = row; entry.interview = rest; }
      }
    } catch { /* migrations 315–316 not applied here: lifecycle fields stay absent */ }
    out.push({
      ...cy,
      label: monthLabel(Number(cy.year), Number(cy.month)),
      applicant_counts: byStatus,
      meets_minimum: ((byStatus['approved'] ?? 0) + (byStatus['activated'] ?? 0)) >= settings.min,
      applicants: (applicants.results || []).map((a) => ({ ...a, ...(lifecycle.get(Number(a.id)) || {}) })),
    });
  }
  return c.json({ cycles: out, settings, server_time: new Date().toISOString() });
});

r.post('/applications/settings', async (c) => {
  const adminUser = await requireAdmin(c);
  const { ensureCohortAppSchema, logCycleEvent } = await import('../services/cohortApplications');
  await ensureCohortAppSchema(c.env);
  const body = (await c.req.json().catch(() => ({}))) as { min_cohort_size?: unknown; max_cohort_size?: unknown };
  const updates: Array<[string, number]> = [];
  for (const [key, raw] of [['min_cohort_size', body.min_cohort_size], ['max_cohort_size', body.max_cohort_size]] as const) {
    if (raw === undefined || raw === null) continue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 1000) return c.json({ error: `${key} must be an integer between 0 and 1000` }, 400);
    updates.push([key, n]);
  }
  if (updates.length === 0) return c.json({ error: 'Nothing to update' }, 400);
  for (const [key, n] of updates) {
    await c.env.DB.prepare(
      `INSERT INTO cohort_settings (key, value, updated_by) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now'), updated_by = excluded.updated_by`,
    ).bind(key, String(n), `admin:${adminUser.id}`).run();
  }
  const summary = updates.map(([k, n]) => `${k}=${n}`).join(', ');
  await logCycleEvent(c.env, null, 'settings_updated', summary, `admin:${adminUser.id}`);
  await logActivity(c.env, adminUser.email, adminUser.id, 'cohort_settings_updated', `Admin ${adminUser.name} set ${summary}`);
  return c.json({ ok: true });
});

r.post('/applications/:applicant_id/decide', async (c) => {
  const adminUser = await requireAdmin(c);
  // D107 — a suspended branch's queues are frozen: 423, after the admin gate.
  await requireBranchNotSuspended(c);
  const { ensureCohortAppSchema, logCycleEvent, notifyOnce, monthLabel } = await import('../services/cohortApplications');
  await ensureCohortAppSchema(c.env);
  const applicantId = parseInt(c.req.param('applicant_id'));
  if (!Number.isFinite(applicantId)) return c.json({ error: 'Invalid applicant id' }, 400);
  const body = (await c.req.json().catch(() => ({}))) as {
    status?: unknown; reason?: unknown; applicant_note?: unknown; applicant_asks?: unknown;
  };
  const status = (typeof body.status === 'string' ? body.status : '').trim().toLowerCase();
  const reason = (typeof body.reason === 'string' ? body.reason : '').trim().slice(0, 500);
  // D383 — what the APPLICANT is told, written for them. Optional, and kept
  // apart from `reason`, which is the admin's required note and never shown.
  const applicantNote = (typeof body.applicant_note === 'string' ? body.applicant_note : '').trim().slice(0, 2000);
  const { normaliseAsks } = await import('../services/applicationLifecycle');
  const applicantAsks = normaliseAsks(body.applicant_asks);
  if (!['approved', 'rejected', 'waitlisted'].includes(status)) {
    return c.json({ error: "status must be 'approved', 'rejected' or 'waitlisted'" }, 400);
  }
  if (!reason) return c.json({ error: 'A reason is required for every decision' }, 400);
  const row = await c.env.DB.prepare(
    `SELECT ca.*, cc.year, cc.month, cc.app_status, sa.company_name FROM cohort_applicants ca
       JOIN cohort_cycles cc ON cc.id = ca.cohort_cycle_id
       LEFT JOIN spinout_applications sa ON sa.id = ca.application_id WHERE ca.id = ?`,
  ).bind(applicantId).first<Record<string, unknown>>();
  if (!row) return c.json({ error: 'Applicant not found' }, 404);
  // D383 — a withdrawn applicant left the pool themselves; deciding them
  // would put back an application its owner took out.
  if (['activated', 'rolled_forward', 'withdrawn'].includes(String(row.status))) {
    return c.json({ error: `Applicant is already ${row.status}` }, 409);
  }
  await c.env.DB.prepare(
    `UPDATE cohort_applicants SET status = ?, decided_at = datetime('now'), decided_by = ?, decision_reason = ?
      WHERE id = ? AND status NOT IN ('activated', 'rolled_forward', 'withdrawn')`,
  ).bind(status, `admin:${adminUser.id}`, reason, applicantId).run();
  // Keep the legacy spinout_applications row in lockstep so /apply's
  // "one pending application" gate and the founder-side UI stay correct:
  //   rejected  → 'refused' (frees the founder to re-apply)
  //   approved/waitlisted → back to 'pending' if previously refused
  //     (still in play; activation flips approved → 'accepted' on the 1st)
  const appId = Number(row.application_id);
  if (status === 'rejected') {
    await c.env.DB.prepare(
      `UPDATE spinout_applications SET status = 'refused', decided_at = datetime('now') WHERE id = ? AND status = 'pending'`,
    ).bind(appId).run();
  } else {
    await c.env.DB.prepare(
      `UPDATE spinout_applications SET status = 'pending', decided_at = NULL WHERE id = ? AND status = 'refused'`,
    ).bind(appId).run();
  }
  // null when no note was sent; false when one was sent and did not save, so
  // the console can say the applicant was not told rather than assume it.
  let applicantNoteSaved: boolean | null = null;
  if (applicantNote) {
    applicantNoteSaved = false;
    try {
      await c.env.DB.prepare(
        `UPDATE spinout_applications
            SET applicant_note = ?, applicant_asks_json = ?, applicant_note_at = datetime('now')
          WHERE id = ?`,
      ).bind(applicantNote, applicantAsks.length ? JSON.stringify(applicantAsks) : null, appId).run();
      applicantNoteSaved = true;
    } catch (e) {
      console.error('[admin-cohort/decide] applicant note write failed', (e as Error)?.message);
    }
  }
  const label = monthLabel(Number(row.year), Number(row.month));
  const cycleId = Number(row.cohort_cycle_id);
  const userId = Number(row.user_id);
  // Templated admission-decision email (accepted → welcome link, refused →
  // re-apply link). The in-app notification below stays, but with email: false
  // for approved/rejected so candidates don't get two emails for one decision.
  let emailed = false;
  // True once the templated decision email is accounted for — either sent by
  // this call, or already claimed earlier (re-decide, retry, or the legacy
  // admin decide route which claims the same ledger key). notifyOnce below
  // must not email in either case, only when no decision email ever went out.
  let emailHandled = false;
  if (status === 'approved' || status === 'rejected') {
    try {
      // Idempotency: at most ONE decision email per (user, cycle, decision).
      const { claimDecisionEmail } = await import('../services/cohortApplications');
      const alreadyClaimed = !(await claimDecisionEmail(c.env, userId, cycleId, status));
      if (alreadyClaimed) emailHandled = true;
      const target = alreadyClaimed
        ? null
        : await c.env.DB.prepare(`SELECT email, name FROM users WHERE id = ?`)
            .bind(userId).first<{ email: string; name: string | null }>();
      if (target?.email) {
        const { send } = await import('../services/email/send');
        const appUrl = (c.env.APP_URL || 'https://axal.vc').replace(/\/+$/, '');
        if (status === 'approved') {
          const labUrl = `${appUrl}/spinout-lab`;
          const r = await send(c.env, 'spinout_admitted', target.email, {
            name: target.name || 'there',
            cohort_label: label,
            lab_url: labUrl,
          }, { userId, ctaUrl: labUrl });
          emailed = !!r?.ok;
          if (emailed) emailHandled = true;
        } else {
          const y = Number(row.year); const m = Number(row.month);
          const nextLabel = monthLabel(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1);
          const applyUrl = `${appUrl}/spinout-lab/apply`;
          const r = await send(c.env, 'spinout_refused', target.email, {
            name: target.name || 'there',
            company_name: String(row.company_name || 'your startup'),
            cohort_label: label,
            next_cohort_label: nextLabel,
            apply_url: applyUrl,
          }, { userId, ctaUrl: applyUrl });
          emailed = !!r?.ok;
          if (emailed) emailHandled = true;
        }
      }
    } catch (e) {
      console.error('[admin-cohort/decide] decision email failed', e);
    }
  }
  if (status === 'approved') {
    await notifyOnce(c.env, {
      userId, cycleId, notifType: 'decision_approved',
      title: `You're in — ${label} Spin-Out Lab cohort`,
      body: `Your application was approved for the ${label} cohort. Your workspace unlocks automatically when the cohort starts on the 1st.`,
      email: !emailHandled,
    });
  } else if (status === 'rejected') {
    await notifyOnce(c.env, {
      userId, cycleId, notifType: 'decision_rejected',
      title: `Spin-Out Lab ${label} cohort decision`,
      body: `Your application wasn't selected for the ${label} cohort this time. You're welcome to apply again for a future cohort.`,
      link: '/spinout-lab/apply',
      email: !emailHandled,
    });
  } else {
    await notifyOnce(c.env, {
      userId, cycleId, notifType: 'decision_waitlisted',
      title: `You're waitlisted for the ${label} cohort`,
      body: `Your application is on the waitlist for the ${label} cohort. If a spot opens — or the cohort rolls forward — you'll be moved automatically.`,
    });
  }
  await logCycleEvent(c.env, cycleId, `applicant_${status}`,
    `Applicant #${applicantId} (user_id=${userId}) ${status}: ${reason}`, `admin:${adminUser.id}`);
  await logActivity(c.env, adminUser.email, adminUser.id, `cohort_applicant_${status}`,
    `Admin ${adminUser.name} marked applicant #${applicantId} ${status} for ${label} (reason: ${reason})`);
  return c.json({ ok: true, status, emailed, applicant_note_saved: applicantNoteSaved });
});

// D383 — the partner interview. Schedule (or re-schedule: a new row, the
// previous one cancelled) and cancel. Frozen with the rest of the queue
// (D107): an interview is a step in an admission, and a suspended branch's
// admissions are closed.
function refusal(c: any, status: number, code: string, message: string) {
  return c.json({ error: code, message, detail: message }, status);
}

async function applicantForInterview(env: Env, applicantId: number) {
  return env.DB.prepare(
    `SELECT ca.id, ca.application_id, ca.user_id, ca.status FROM cohort_applicants ca WHERE ca.id = ?`,
  ).bind(applicantId).first<{ id: number; application_id: number; user_id: number; status: string }>();
}

r.post('/applications/:applicant_id/interview', async (c) => {
  const adminUser = await requireAdmin(c);
  await requireBranchNotSuspended(c);
  const applicantId = parseInt(c.req.param('applicant_id'));
  if (!Number.isFinite(applicantId)) return refusal(c, 400, 'invalid_applicant', 'That applicant id is not valid.');
  const body = (await c.req.json().catch(() => ({}))) as {
    scheduled_at?: unknown; duration_min?: unknown; location?: unknown; note?: unknown;
  };
  const when = typeof body.scheduled_at === 'string' ? new Date(body.scheduled_at) : null;
  if (!when || Number.isNaN(when.getTime())) {
    return refusal(c, 400, 'invalid_time', 'Give the interview a date and time.');
  }
  if (when.getTime() < Date.now()) {
    return refusal(c, 400, 'time_in_past', 'An interview cannot be scheduled in the past.');
  }
  const duration = Number(body.duration_min ?? 30);
  if (!Number.isInteger(duration) || duration < 10 || duration > 240) {
    return refusal(c, 400, 'invalid_duration', 'An interview lasts between 10 and 240 minutes.');
  }
  const location = (typeof body.location === 'string' ? body.location : '').trim().slice(0, 500) || null;
  const note = (typeof body.note === 'string' ? body.note : '').trim().slice(0, 2000) || null;
  const applicant = await applicantForInterview(c.env, applicantId);
  if (!applicant) return refusal(c, 404, 'applicant_not_found', 'That applicant does not exist.');
  if (!['pending', 'waitlisted'].includes(applicant.status)) {
    return refusal(c, 409, 'not_interviewable', `This applicant is ${applicant.status}; only an undecided application gets an interview.`);
  }
  // SQLite-comparable UTC text, like every other timestamp column here.
  const at = when.toISOString().replace('T', ' ').slice(0, 19);
  // One batch, so a failed insert cannot leave the old interview cancelled
  // and no new one in its place.
  const [, ins] = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE spinout_application_interviews SET status = 'cancelled', updated_at = datetime('now')
        WHERE application_id = ? AND status = 'scheduled'`,
    ).bind(applicant.application_id),
    c.env.DB.prepare(
      `INSERT INTO spinout_application_interviews
         (application_id, user_id, scheduled_at, duration_min, location, note, scheduled_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(applicant.application_id, applicant.user_id, at, duration, location, note, adminUser.id),
  ]);
  await logActivity(c.env, adminUser.email, adminUser.id, 'cohort_interview_scheduled',
    `Admin ${adminUser.name} scheduled an interview for applicant #${applicantId} at ${at} UTC (${duration} min)`);
  return c.json({ ok: true, interview_id: Number(ins.meta?.last_row_id ?? 0) || null, scheduled_at: at }, 201);
});

r.post('/applications/:applicant_id/interview/cancel', async (c) => {
  const adminUser = await requireAdmin(c);
  await requireBranchNotSuspended(c);
  const applicantId = parseInt(c.req.param('applicant_id'));
  if (!Number.isFinite(applicantId)) return refusal(c, 400, 'invalid_applicant', 'That applicant id is not valid.');
  const applicant = await applicantForInterview(c.env, applicantId);
  if (!applicant) return refusal(c, 404, 'applicant_not_found', 'That applicant does not exist.');
  const upd = await c.env.DB.prepare(
    `UPDATE spinout_application_interviews SET status = 'cancelled', updated_at = datetime('now')
      WHERE application_id = ? AND status = 'scheduled'`,
  ).bind(applicant.application_id).run();
  if ((upd.meta?.changes ?? 0) === 0) return refusal(c, 409, 'no_scheduled_interview', 'There is no scheduled interview to cancel.');
  await logActivity(c.env, adminUser.email, adminUser.id, 'cohort_interview_cancelled',
    `Admin ${adminUser.name} cancelled the interview for applicant #${applicantId}`);
  return c.json({ ok: true });
});

r.post('/applications/cycles/:cycle_id/force-proceed', async (c) => {
  const adminUser = await requireAdmin(c);
  const { ensureCohortAppSchema, logCycleEvent, monthLabel } = await import('../services/cohortApplications');
  await ensureCohortAppSchema(c.env);
  const cycleId = parseInt(c.req.param('cycle_id'));
  if (!Number.isFinite(cycleId)) return c.json({ error: 'Invalid cycle id' }, 400);
  const body = (await c.req.json().catch(() => ({}))) as { reason?: unknown };
  const reason = (typeof body.reason === 'string' ? body.reason : '').trim().slice(0, 500);
  if (!reason) return c.json({ error: 'A reason is required to force-proceed' }, 400);
  const cyc = await c.env.DB.prepare(`SELECT * FROM cohort_cycles WHERE id = ?`).bind(cycleId).first<Record<string, unknown>>();
  if (!cyc) return c.json({ error: 'Cycle not found' }, 404);
  if (!['open', 'reviewing'].includes(String(cyc.app_status))) {
    return c.json({ error: `Cycle is already ${cyc.app_status} — force-proceed only applies before activation` }, 409);
  }
  await c.env.DB.prepare(`UPDATE cohort_cycles SET force_proceed = 1 WHERE id = ?`).bind(cycleId).run();
  const label = monthLabel(Number(cyc.year), Number(cyc.month));
  await logCycleEvent(c.env, cycleId, 'force_proceed', `Force-proceed set: ${reason}`, `admin:${adminUser.id}`);
  await logActivity(c.env, adminUser.email, adminUser.id, 'cohort_force_proceed',
    `Admin ${adminUser.name} set force-proceed on the ${label} cohort (reason: ${reason})`);
  return c.json({ ok: true });
});

r.get('/applications/notifications', async (c) => {
  await requireAdmin(c);
  const { ensureCohortAppSchema } = await import('../services/cohortApplications');
  await ensureCohortAppSchema(c.env);
  const cycleId = parseInt(c.req.query('cycle_id') || '');
  const base = `SELECT l.id, l.user_id, l.cohort_cycle_id, l.notif_type, l.status, l.sent_at, u.name, u.email
                  FROM cohort_app_notification_ledger l LEFT JOIN users u ON u.id = l.user_id`;
  const rs = Number.isFinite(cycleId)
    ? await c.env.DB.prepare(`${base} WHERE l.cohort_cycle_id = ? ORDER BY l.sent_at DESC LIMIT 300`).bind(cycleId).all()
    : await c.env.DB.prepare(`${base} ORDER BY l.sent_at DESC LIMIT 300`).all();
  return c.json({ notifications: rs.results || [] });
});

r.get('/applications/events', async (c) => {
  await requireAdmin(c);
  const { ensureCohortAppSchema } = await import('../services/cohortApplications');
  await ensureCohortAppSchema(c.env);
  const cycleId = parseInt(c.req.query('cycle_id') || '');
  const rs = Number.isFinite(cycleId)
    ? await c.env.DB.prepare(`SELECT * FROM cohort_cycle_events WHERE cohort_cycle_id = ? ORDER BY created_at DESC LIMIT 300`).bind(cycleId).all()
    : await c.env.DB.prepare(`SELECT * FROM cohort_cycle_events ORDER BY created_at DESC LIMIT 300`).all();
  return c.json({ events: rs.results || [] });
});

export default r;
