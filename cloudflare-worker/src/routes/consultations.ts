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
type ConsultationStatus = typeof CONSULTATION_STATUSES[number];
export const CONSULTATION_TRANSITIONS: Readonly<Record<ConsultationStatus, readonly ConsultationStatus[]>> = Object.freeze({
  requested: ['confirmed', 'cancelled'],
  confirmed: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
});

/** #6394: accept an ISO date-time (including datetime-local), never a rolled-over calendar date. */
function validSlotAt(value: string): boolean {
  const parts = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (!parts || Number(parts[2]) > 23 || Number(parts[3]) > 59 || Number(parts[4] || 0) > 59 || !Number.isFinite(Date.parse(value))) return false;
  const day = new Date(`${parts[1]}T00:00:00Z`);
  return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === parts[1];
}

const ADMIN_BOOKING_SELECT = `SELECT b.id, b.uid, b.user_id, b.admin_id, b.requested_at, b.slot_at, b.status,
  b.topic, b.notes, b.report_id, b.created_at, b.version,
  u.name AS user_name, u.email AS user_email
  FROM admin_consultation_bookings b JOIN users u ON u.id = b.user_id`;

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
    const stmt = c.env.DB.prepare(`${ADMIN_BOOKING_SELECT} ${where} ORDER BY b.created_at DESC`);
    const res = await (filterStatus ? stmt.bind(filterStatus) : stmt).all<Record<string, unknown>>();
    return c.json(res.results || []);
  } catch (e) {
    console.error('[consultations] admin list failed:', (e as Error).message);
    return c.json({
      code: 'consultations_unreadable',
      message: 'Best-Fit consultations could not be read. This is not a claim that nobody is waiting.',
    }, 503);
  }
});

// POST /api/admin/consultations/:id/status — update status; assign the acting
// admin on first triage and optionally set/confirm a slot.
adminConsultations.post('/:id/status', async (c) => {
  const admin = await requireAdmin(c);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'bad id' }, 400);

  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const status = String(body.status || '') as ConsultationStatus;
  if (!(CONSULTATION_STATUSES as readonly string[]).includes(status)) {
    return c.json({ code: 'invalid_status', message: 'status is requested, confirmed, completed or cancelled.' }, 400);
  }
  const expectedVersion = body.expected_version;
  if (!(typeof expectedVersion === 'number' && Number.isSafeInteger(expectedVersion) && expectedVersion >= 1)) {
    return c.json({ code: 'expected_version_required', message: 'Name the version you read in expected_version.' }, 400);
  }
  const slotAt = typeof body.slot_at === 'string' ? body.slot_at.trim() || null : null;
  if ((body.slot_at != null && typeof body.slot_at !== 'string') || (slotAt && !validSlotAt(slotAt))) {
    return c.json({ code: 'invalid_slot_at', message: 'slot_at must be a valid date-time or left blank to keep the booked time.' }, 400);
  }

  const read = () => c.env.DB.prepare(`${ADMIN_BOOKING_SELECT} WHERE b.id = ?`).bind(id).first<Record<string, unknown>>();
  const before = await read();
  if (!before) return c.json({ code: 'not_found', message: 'That consultation does not exist.' }, 404);
  if (Number(before.version) !== expectedVersion) {
    return c.json({ code: 'version_conflict', message: 'This consultation changed after you read it.', current: before }, 409);
  }
  const from = String(before.status) as ConsultationStatus;
  if (!CONSULTATION_TRANSITIONS[from]?.includes(status)) {
    return c.json({ code: 'illegal_transition', message: `A consultation cannot move from ${from} to ${status}.`, current: before }, 409);
  }

  const nextVersion = expectedVersion + 1;
  const [updated] = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE admin_consultation_bookings
          SET status = ?, admin_id = COALESCE(admin_id, ?), slot_at = COALESCE(?, slot_at), version = version + 1
        WHERE id = ? AND version = ? AND status = ?`,
    ).bind(status, admin.id, slotAt, id, expectedVersion, from),
    c.env.DB.prepare(
      `INSERT INTO admin_consultation_booking_events (booking_id, from_status, to_status, version, actor_user_id)
       SELECT id, ?, ?, version, ? FROM admin_consultation_bookings
       WHERE id = ? AND version = ? AND status = ?
       ON CONFLICT DO NOTHING`,
    ).bind(from, status, admin.id, id, nextVersion, status),
  ]);

  const row = await read();
  if (!row) return c.json({ error: 'not found' }, 404);
  if (Number(updated.meta?.changes ?? 0) !== 1) {
    return c.json({ code: 'version_conflict', message: 'This consultation changed after you read it.', current: row }, 409);
  }
  return c.json({ booking: row });
});
