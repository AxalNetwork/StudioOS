// Best-Fit + consultations — mounted at /api/bestfit.
//   GET  /matches                 — the caller's range of matches (detail tier-gated)
//   POST /consult                 — request a consultation with the admin; precomputes the report
//   GET  /consultations           — admin: list consultation requests
//   POST /consultations/:id/status— admin: update a request's status
//   GET  /report/:userId          — admin: full best-fit report (never tier-gated)
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, requireAdmin } from '../auth';
import { userMeetsTier } from '../middleware/requireTier';
import { matchSummary, buildReport } from '../services/bestFit';
import type { FitPersona } from '../services/axalFit';

const bestfit = new Hono<{ Bindings: Env }>();

function personaOf(role: string | null | undefined): FitPersona {
  const r = String(role || '');
  return r === 'investor' || r === 'partner' || r === 'mentor' ? (r as FitPersona) : 'founder';
}

// GET /matches — counts always; candidate names + reasons require the studio
// tier (bypass roles see everything). The backend still computes the full set
// so admin reporting is unaffected by the user's tier.
bestfit.get('/matches', async (c) => {
  const user = await requireAuth(c);
  const summary = await matchSummary(c.env, user.id);
  const full = userMeetsTier(user as unknown as User, 'studio');
  const types = summary.types.map((t) => ({
    type: t.type,
    label: t.label,
    count: t.count,
    top: t.top.map((m, i) => (full || i === 0
      ? m
      : { ...m, name: 'Member', reasons: [], watch_outs: [], gaps: [], locked: true })),
    locked: !full && t.count > 1,
  }));
  return c.json({ viewer_ready: summary.viewerReady, full, types });
});

// POST /consult — user requests a consultation; we precompute + store the
// best-fit report so the admin has it ready.
bestfit.post('/consult', async (c) => {
  const user = await requireAuth(c);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const persona = personaOf(user.role);
  const topic = body.topic ? String(body.topic).slice(0, 200) : null;
  const notes = body.notes ? String(body.notes).slice(0, 2000) : null;
  const slotAt = body.slot_at ? String(body.slot_at).slice(0, 40) : null;

  let reportId: number | null = null;
  try {
    const report = await buildReport(c.env, user.id, persona);
    const ins = await c.env.DB.prepare(
      `INSERT INTO axal_fit_reports (user_id, persona, report_json, computed_by) VALUES (?, ?, ?, ?)`,
    ).bind(user.id, persona, JSON.stringify(report), user.id).run();
    reportId = Number((ins as { meta?: { last_row_id?: number } }).meta?.last_row_id || 0) || null;
  } catch { /* report best-effort */ }

  const booking = await c.env.DB.prepare(
    `INSERT INTO admin_consultation_bookings (user_id, slot_at, status, topic, notes, report_id)
     VALUES (?, ?, 'requested', ?, ?, ?) RETURNING uid`,
  ).bind(user.id, slotAt, topic, notes, reportId).first<{ uid: string }>();

  return c.json({ ok: true, booking_uid: booking?.uid ?? null, status: 'requested' });
});

// GET /consultations — admin queue.
bestfit.get('/consultations', async (c) => {
  await requireAdmin(c);
  const res = await c.env.DB.prepare(
    `SELECT b.id, b.uid, b.user_id, b.status, b.topic, b.slot_at, b.requested_at, b.report_id,
            u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM admin_consultation_bookings b JOIN users u ON u.id = b.user_id
      ORDER BY b.requested_at DESC LIMIT 100`,
  ).all();
  return c.json({ consultations: res.results ?? [] });
});

// POST /consultations/:id/status — admin updates status.
bestfit.post('/consultations/:id/status', async (c) => {
  const admin = await requireAdmin(c);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ detail: 'Invalid id' }, 400);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const status = String(body.status || '');
  if (!['requested', 'confirmed', 'completed', 'declined', 'cancelled'].includes(status)) {
    return c.json({ detail: 'Invalid status' }, 400);
  }
  await c.env.DB.prepare(
    `UPDATE admin_consultation_bookings SET status = ?, admin_id = COALESCE(admin_id, ?) WHERE id = ?`,
  ).bind(status, admin.id, id).run();
  return c.json({ ok: true, status });
});

// GET /report/:userId — admin best-fit report (fresh compute). Never tier-gated.
bestfit.get('/report/:userId', async (c) => {
  await requireAdmin(c);
  const userId = Number(c.req.param('userId'));
  if (!Number.isFinite(userId)) return c.json({ detail: 'Invalid user_id' }, 400);
  const target = await c.env.DB.prepare('SELECT id, name, role FROM users WHERE id = ?')
    .bind(userId).first<{ id: number; name: string; role: string }>();
  if (!target) return c.json({ detail: 'User not found' }, 404);
  const report = await buildReport(c.env, userId, personaOf(target.role));
  return c.json({ user: target, report });
});

export default bestfit;
