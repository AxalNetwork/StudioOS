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
import { requireAdmin } from '../auth';
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
  await requireAdmin(c);
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
    out.push({
      ...cy,
      label: monthLabel(Number(cy.year), Number(cy.month)),
      applicant_counts: byStatus,
      meets_minimum: ((byStatus['approved'] ?? 0) + (byStatus['activated'] ?? 0)) >= settings.min,
      applicants: applicants.results || [],
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
  const { ensureCohortAppSchema, logCycleEvent, notifyOnce, monthLabel } = await import('../services/cohortApplications');
  await ensureCohortAppSchema(c.env);
  const applicantId = parseInt(c.req.param('applicant_id'));
  if (!Number.isFinite(applicantId)) return c.json({ error: 'Invalid applicant id' }, 400);
  const body = (await c.req.json().catch(() => ({}))) as { status?: unknown; reason?: unknown };
  const status = (typeof body.status === 'string' ? body.status : '').trim().toLowerCase();
  const reason = (typeof body.reason === 'string' ? body.reason : '').trim().slice(0, 500);
  if (!['approved', 'rejected', 'waitlisted'].includes(status)) {
    return c.json({ error: "status must be 'approved', 'rejected' or 'waitlisted'" }, 400);
  }
  if (!reason) return c.json({ error: 'A reason is required for every decision' }, 400);
  const row = await c.env.DB.prepare(
    `SELECT ca.*, cc.year, cc.month, cc.app_status FROM cohort_applicants ca
       JOIN cohort_cycles cc ON cc.id = ca.cohort_cycle_id WHERE ca.id = ?`,
  ).bind(applicantId).first<Record<string, unknown>>();
  if (!row) return c.json({ error: 'Applicant not found' }, 404);
  if (['activated', 'rolled_forward'].includes(String(row.status))) {
    return c.json({ error: `Applicant is already ${row.status}` }, 409);
  }
  await c.env.DB.prepare(
    `UPDATE cohort_applicants SET status = ?, decided_at = datetime('now'), decided_by = ?, decision_reason = ?
      WHERE id = ? AND status NOT IN ('activated', 'rolled_forward')`,
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
  const label = monthLabel(Number(row.year), Number(row.month));
  const cycleId = Number(row.cohort_cycle_id);
  const userId = Number(row.user_id);
  if (status === 'approved') {
    await notifyOnce(c.env, {
      userId, cycleId, notifType: 'decision_approved',
      title: `You're in — ${label} Spin-Out Lab cohort`,
      body: `Your application was approved for the ${label} cohort. Your workspace unlocks automatically when the cohort starts on the 1st.`,
    });
  } else if (status === 'rejected') {
    await notifyOnce(c.env, {
      userId, cycleId, notifType: 'decision_rejected',
      title: `Spin-Out Lab ${label} cohort decision`,
      body: `Your application wasn't selected for the ${label} cohort this time. You're welcome to apply again for a future cohort.`,
      link: '/spinout-lab/apply',
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
  return c.json({ ok: true, status });
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
