/**
 * Task #19 WS5 — Consultation booking ("Book with Guillaume").
 *
 * A user requests a consultation; booking precomputes + stores a best-fit
 * report snapshot (axal_fit_reports) and links it on the booking row so the
 * admin has it ready regardless of the requester's paywall tier.
 *
 * Mounts:
 *   /api/consultations        → default `consultations` (user-facing)
 *   /api/admin/consultations  → `adminConsultations` (admin triage; admin-only)
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth, requireAdmin } from '../auth';
import { buildBestFitReport, persistBestFitReport } from '../services/bestFit';
import { ensureAxalFitSchema } from '../services/axalFitSchema';

const CONSULTATION_STATUSES = ['requested', 'confirmed', 'completed', 'cancelled'] as const;

const consultations = new Hono<{ Bindings: Env }>();

// POST /api/consultations/book — request a consultation. Precompute + persist a
// best-fit report; the booking still succeeds even if precompute fails.
consultations.post('/book', async (c) => {
  const user = await requireAuth(c);
  await ensureAxalFitSchema(c.env);
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const topic = typeof body.topic === 'string' ? body.topic.slice(0, 500) : null;
  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 2000) : null;
  const slotAt = typeof body.slot_at === 'string' ? body.slot_at : null;

  let reportId: number | null = null;
  try {
    const report = await buildBestFitReport(c.env, user.id);
    if (report) {
      const saved = await persistBestFitReport(c.env, user.id, report, null);
      reportId = saved?.id ?? null;
    }
  } catch (e) {
    // Non-fatal: the report can be regenerated live on admin fetch.
    console.error('[consultations] report precompute failed:', (e as Error).message);
  }

  const row = await c.env.DB.prepare(
    `INSERT INTO admin_consultation_bookings (user_id, slot_at, topic, notes, report_id, status)
     VALUES (?, ?, ?, ?, ?, 'requested')
     RETURNING id, uid, status, requested_at, slot_at, topic, report_id`,
  )
    .bind(user.id, slotAt, topic, notes, reportId)
    .first<Record<string, unknown>>();

  return c.json({ booking: row });
});

// GET /api/consultations/me — the caller's own consultation requests.
consultations.get('/me', async (c) => {
  const user = await requireAuth(c);
  await ensureAxalFitSchema(c.env);
  const res = await c.env.DB.prepare(
    `SELECT id, uid, status, requested_at, slot_at, topic, notes, created_at
       FROM admin_consultation_bookings
      WHERE user_id = ?
      ORDER BY created_at DESC`,
  ).bind(user.id).all<Record<string, unknown>>();
  return c.json(res.results || []);
});

export default consultations;

// --------- Admin triage (mounted at /api/admin/consultations) ---------

export const adminConsultations = new Hono<{ Bindings: Env }>();
adminConsultations.use('*', async (c, next) => {
  await requireAdmin(c);
  await next();
});

// GET /api/admin/consultations — list requests (optional ?status= filter).
adminConsultations.get('/', async (c) => {
  await ensureAxalFitSchema(c.env);
  const status = c.req.query('status');
  const filterStatus = status && (CONSULTATION_STATUSES as readonly string[]).includes(status)
    ? status
    : null;
  const where = filterStatus ? 'WHERE b.status = ?' : '';
  try {
    const stmt = c.env.DB.prepare(
      `SELECT b.id, b.uid, b.user_id, b.admin_id, b.requested_at, b.slot_at, b.status,
              b.topic, b.notes, b.report_id, b.created_at,
              u.name AS user_name, u.email AS user_email
         FROM admin_consultation_bookings b
         JOIN users u ON u.id = b.user_id
         ${where}
        ORDER BY b.created_at DESC`,
    );
    const res = await (filterStatus ? stmt.bind(filterStatus) : stmt).all<Record<string, unknown>>();
    return c.json(res.results || []);
  } catch (e) {
    // Cold/un-migrated D1 or a missing-table race: degrade to an empty queue
    // rather than surfacing the global 500 ("Internal server error").
    console.error('[consultations] admin list failed:', (e as Error).message);
    return c.json([]);
  }
});

// POST /api/admin/consultations/:id/status — update status; assign the acting
// admin on first triage and optionally set/confirm a slot.
adminConsultations.post('/:id/status', async (c) => {
  const admin = await requireAdmin(c);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'bad id' }, 400);

  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const status = String(body.status || '');
  if (!(CONSULTATION_STATUSES as readonly string[]).includes(status)) {
    return c.json({ error: 'invalid status' }, 400);
  }
  const slotAt = typeof body.slot_at === 'string' ? body.slot_at : null;

  await c.env.DB.prepare(
    `UPDATE admin_consultation_bookings
        SET status = ?,
            admin_id = COALESCE(admin_id, ?),
            slot_at = COALESCE(?, slot_at)
      WHERE id = ?`,
  ).bind(status, admin.id, slotAt, id).run();

  const row = await c.env.DB.prepare(
    `SELECT id, uid, user_id, admin_id, status, slot_at, report_id
       FROM admin_consultation_bookings WHERE id = ?`,
  ).bind(id).first<Record<string, unknown>>();
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json({ booking: row });
});
