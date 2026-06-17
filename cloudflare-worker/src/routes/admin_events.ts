/**
 * Task #39 — Event engine: admin routes (design §8.3).
 *
 * Mounted at /api/admin/events, BEFORE the catch-all /api/admin router (same
 * mount-before-catch-all precedence as admin_news / admin_articles). Every
 * handler is requireAdmin; mutating actions append to admin_audit_log with
 * report_type='events' (the audit writer mirrors admin_telegram.ts, tolerating
 * the optional `actor` column).
 *
 * The public-feed publish gate (design §1.3) is enforced here: only an admin
 * `approve` flips a pending_review event to status='published' +
 * admin_published=1, which is what the public feed predicate requires.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { notify } from '../services/notify';
import { ensureEventsSchema } from '../services/eventsSchema';
import { shapeEvent } from '../services/eventsCommon';
import { mintCompInvitations, parseAudienceRules } from '../services/eventAudience';
import { deliverEventInvite } from '../services/eventMessaging';
import { promoteWaitlist, type EventSeatRow } from '../services/eventCapacity';

const adminEvents = new Hono<{ Bindings: Env }>();

adminEvents.use('*', async (c, next) => {
  await ensureEventsSchema(c.env);
  await next();
});

async function admin(c: any) {
  try {
    return await requireAdmin(c);
  } catch (e) {
    const msg = (e as Error)?.message;
    return c.json({ error: msg || 'Admin required' }, msg === 'Unauthorized' ? 401 : 403);
  }
}

// admin_audit_log writer (report_type='events'). Tolerates the optional `actor`
// column the same way admin_telegram.ts / admin_publications.ts do.
let _auditHasActor: boolean | null = null;
async function auditHasActor(env: Env): Promise<boolean> {
  if (_auditHasActor !== null) return _auditHasActor;
  try {
    const r: any = await env.DB.prepare("PRAGMA table_info('admin_audit_log')").all();
    _auditHasActor = (r.results || []).some((col: any) => String(col.name) === 'actor');
  } catch {
    _auditHasActor = false;
  }
  return _auditHasActor === true;
}

async function hashEmail(email: string): Promise<string> {
  try {
    const data = new TextEncoder().encode(email.toLowerCase());
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return '';
  }
}

async function writeAudit(
  env: Env,
  opts: { adminId: number; adminEmail: string; action: string; eventId?: number; extra?: Record<string, unknown> },
) {
  try {
    const filters = JSON.stringify({ event_id: opts.eventId, ...(opts.extra || {}) });
    if (await auditHasActor(env)) {
      const actor = await hashEmail(opts.adminEmail);
      await env.DB.prepare(
        `INSERT INTO admin_audit_log (admin_user_id, action, report_type, filters_json, actor) VALUES (?, ?, 'events', ?, ?)`,
      ).bind(opts.adminId, opts.action, filters, actor).run();
    } else {
      await env.DB.prepare(
        `INSERT INTO admin_audit_log (admin_user_id, action, report_type, filters_json) VALUES (?, ?, 'events', ?)`,
      ).bind(opts.adminId, opts.action, filters).run();
    }
  } catch (e) {
    console.warn('[admin_events] audit write failed:', (e as Error).message);
  }
}

async function loadEvent(env: Env, id: number): Promise<any | null> {
  return env.DB.prepare(`SELECT * FROM events WHERE id = ?`).bind(id).first();
}

function intParam(v: string | undefined): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ── GET / — admin event queue / list ───────────────────────────────────────
adminEvents.get('/', async (c) => {
  const a = await admin(c);
  if (a instanceof Response) return a;
  const status = c.req.query('status');
  const limit = Math.min(Number(c.req.query('limit') || 50) || 50, 200);
  const offset = Math.max(Number(c.req.query('offset') || 0) || 0, 0);
  const where: string[] = [];
  const binds: unknown[] = [];
  if (status) { where.push('status = ?'); binds.push(status); }
  const rows = await c.env.DB.prepare(
    `SELECT * FROM events ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  ).bind(...binds, limit, offset).all();
  return c.json({ events: (rows.results || []).map((r) => shapeEvent(r, { includePrivate: true })) });
});

// ── GET /analytics — portfolio-wide event metrics ──────────────────────────
// MUST stay registered before GET /:id (a numeric :id guard would 404 the
// word "analytics", but Hono matches in registration order regardless).
adminEvents.get('/analytics', async (c) => {
  const a = await admin(c);
  if (a instanceof Response) return a;

  const round2 = (n: number) => Math.round(n * 100) / 100;

  let summary = {
    total_events: 0, published: 0, pending_review: 0, draft: 0, cancelled: 0,
    total_registrations: 0, total_attended: 0, total_waitlisted: 0,
  };
  try {
    const ev: any = await c.env.DB.prepare(
      `SELECT
         COUNT(*) AS total_events,
         COUNT(CASE WHEN status='published' THEN 1 END) AS published,
         COUNT(CASE WHEN status='pending_review' THEN 1 END) AS pending_review,
         COUNT(CASE WHEN status='draft' THEN 1 END) AS draft,
         COUNT(CASE WHEN status='cancelled' THEN 1 END) AS cancelled
       FROM events`,
    ).first();
    const reg: any = await c.env.DB.prepare(
      `SELECT
         COUNT(CASE WHEN status IN ('registered','confirmed','attended') THEN 1 END) AS registrations,
         COUNT(CASE WHEN status='attended' THEN 1 END) AS attended,
         COUNT(CASE WHEN status='waitlisted' THEN 1 END) AS waitlisted
       FROM event_registrations`,
    ).first();
    summary = {
      total_events: Number(ev?.total_events || 0),
      published: Number(ev?.published || 0),
      pending_review: Number(ev?.pending_review || 0),
      draft: Number(ev?.draft || 0),
      cancelled: Number(ev?.cancelled || 0),
      total_registrations: Number(reg?.registrations || 0),
      total_attended: Number(reg?.attended || 0),
      total_waitlisted: Number(reg?.waitlisted || 0),
    };
  } catch (e) {
    console.warn('[admin_events] analytics summary failed:', (e as Error).message);
  }

  let events: any[] = [];
  try {
    const rows = await c.env.DB.prepare(
      `SELECT e.id, e.slug, e.title, e.status, e.starts_at, e.capacity, e.featured,
              COUNT(CASE WHEN r.status IN ('registered','confirmed','attended') THEN 1 END) AS registrations,
              COUNT(CASE WHEN r.status='attended' THEN 1 END) AS attended,
              COUNT(CASE WHEN r.status='waitlisted' THEN 1 END) AS waitlisted,
              COUNT(CASE WHEN r.status='cancelled' THEN 1 END) AS cancelled
         FROM events e
         LEFT JOIN event_registrations r ON r.event_id = e.id
        GROUP BY e.id
        ORDER BY e.starts_at DESC
        LIMIT 200`,
    ).all();
    events = ((rows.results || []) as any[]).map((r) => {
      const registrations = Number(r.registrations || 0);
      const attended = Number(r.attended || 0);
      const capacity = r.capacity != null ? Number(r.capacity) : null;
      return {
        id: Number(r.id),
        slug: r.slug,
        title: r.title,
        status: r.status,
        starts_at: r.starts_at,
        featured: !!r.featured,
        capacity,
        registrations,
        attended,
        waitlisted: Number(r.waitlisted || 0),
        cancelled: Number(r.cancelled || 0),
        capacity_util: capacity && capacity > 0 ? round2(registrations / capacity) : null,
        conversion: registrations > 0 ? round2(attended / registrations) : null,
      };
    });
  } catch (e) {
    console.warn('[admin_events] analytics rows failed:', (e as Error).message);
  }

  return c.json({ summary, events });
});

// ── GET /:id — admin event detail ──────────────────────────────────────────
adminEvents.get('/:id', async (c) => {
  const a = await admin(c);
  if (a instanceof Response) return a;
  const id = intParam(c.req.param('id'));
  if (!id) return c.json({ error: 'not_found' }, 404);
  const event = await loadEvent(c.env, id);
  if (!event) return c.json({ error: 'not_found' }, 404);
  return c.json({ event: shapeEvent(event, { includePrivate: true }) });
});

// ── POST /:id/approve — publish to the public feed ─────────────────────────
adminEvents.post('/:id/approve', async (c) => {
  const a = await admin(c);
  if (a instanceof Response) return a;
  const id = intParam(c.req.param('id'));
  if (!id) return c.json({ error: 'not_found' }, 404);
  const event = await loadEvent(c.env, id);
  if (!event) return c.json({ error: 'not_found' }, 404);
  await c.env.DB.prepare(
    `UPDATE events SET status = 'published', admin_published = 1, updated_at = datetime('now') WHERE id = ?`,
  ).bind(id).run();
  await writeAudit(c.env, { adminId: a.id, adminEmail: a.email, action: 'event_approved', eventId: id });
  const fresh = await loadEvent(c.env, id);
  if (event.host_user_id) {
    await notify(c.env, {
      userId: event.host_user_id, type: 'event_approved', category: 'events',
      title: `Your event is live: ${event.title}`, link: `/events/${event.slug}`, payload: { event_id: id },
    }).catch(() => {});
  }
  // Comp-on-publish (design §7.3): auto-mint comp invites for the event's
  // configured partner/LP audiences, then deliver ONLY the newly minted ones
  // (inbox + email-with-.ics). A re-approve mints nothing new, so nobody is
  // re-mailed.
  try {
    const rules = parseAudienceRules(event.audience_rules_json);
    if (Object.keys(rules).length > 0) {
      const comp = await mintCompInvitations(c.env, id, rules, event.host_user_id ?? null, a.id);
      for (const inv of comp.created) {
        await deliverEventInvite(c.env, fresh, {
          userId: inv.invited_user_id, email: inv.invited_email,
          name: inv.invited_name, token: inv.token, comp: true,
        }).catch(() => {});
      }
    }
  } catch (e) {
    console.warn('[admin_events] comp mint/deliver failed:', (e as Error).message);
  }
  return c.json({ event: shapeEvent(fresh, { includePrivate: true }) });
});

// ── POST /:id/reject — bounce back from the review queue ────────────────────
adminEvents.post('/:id/reject', async (c) => {
  const a = await admin(c);
  if (a instanceof Response) return a;
  const id = intParam(c.req.param('id'));
  if (!id) return c.json({ error: 'not_found' }, 404);
  const event = await loadEvent(c.env, id);
  if (!event) return c.json({ error: 'not_found' }, 404);
  const body = await c.req.json().catch(() => ({} as any));
  const reason = body.reason ? String(body.reason).slice(0, 1000) : null;
  await c.env.DB.prepare(
    `UPDATE events SET status = 'rejected', admin_published = 0, updated_at = datetime('now') WHERE id = ?`,
  ).bind(id).run();
  await writeAudit(c.env, { adminId: a.id, adminEmail: a.email, action: 'event_rejected', eventId: id, extra: { reason } });
  if (event.host_user_id) {
    await notify(c.env, {
      userId: event.host_user_id, type: 'event_rejected', category: 'events',
      title: `Event needs changes: ${event.title}`, body: reason || undefined,
      link: `/events/${event.slug}`, payload: { event_id: id },
    }).catch(() => {});
  }
  return c.json({ event: shapeEvent(await loadEvent(c.env, id), { includePrivate: true }) });
});

// ── POST /:id/unpublish — pull from the public feed ────────────────────────
adminEvents.post('/:id/unpublish', async (c) => {
  const a = await admin(c);
  if (a instanceof Response) return a;
  const id = intParam(c.req.param('id'));
  if (!id) return c.json({ error: 'not_found' }, 404);
  const event = await loadEvent(c.env, id);
  if (!event) return c.json({ error: 'not_found' }, 404);
  await c.env.DB.prepare(
    `UPDATE events SET admin_published = 0, status = 'draft', updated_at = datetime('now') WHERE id = ?`,
  ).bind(id).run();
  await writeAudit(c.env, { adminId: a.id, adminEmail: a.email, action: 'event_unpublished', eventId: id });
  return c.json({ event: shapeEvent(await loadEvent(c.env, id), { includePrivate: true }) });
});

// ── POST /:id/feature — toggle the featured flag (admin curation) ──────────
adminEvents.post('/:id/feature', async (c) => {
  const a = await admin(c);
  if (a instanceof Response) return a;
  const id = intParam(c.req.param('id'));
  if (!id) return c.json({ error: 'not_found' }, 404);
  const event = await loadEvent(c.env, id);
  if (!event) return c.json({ error: 'not_found' }, 404);
  const body = await c.req.json().catch(() => ({} as any));
  const featured = body.featured ? 1 : 0;
  await c.env.DB.prepare(
    `UPDATE events SET featured = ?, updated_at = datetime('now') WHERE id = ?`,
  ).bind(featured, id).run();
  await writeAudit(c.env, { adminId: a.id, adminEmail: a.email, action: 'event_featured', eventId: id, extra: { featured: !!featured } });
  return c.json({ event: shapeEvent(await loadEvent(c.env, id), { includePrivate: true }) });
});

// ── POST /:id/cancel — admin cancels an event ──────────────────────────────
adminEvents.post('/:id/cancel', async (c) => {
  const a = await admin(c);
  if (a instanceof Response) return a;
  const id = intParam(c.req.param('id'));
  if (!id) return c.json({ error: 'not_found' }, 404);
  const event = await loadEvent(c.env, id);
  if (!event) return c.json({ error: 'not_found' }, 404);
  await c.env.DB.prepare(
    `UPDATE events SET status = 'cancelled', admin_published = 0, updated_at = datetime('now') WHERE id = ?`,
  ).bind(id).run();
  await writeAudit(c.env, { adminId: a.id, adminEmail: a.email, action: 'event_cancelled', eventId: id });
  // Notify seated registrants (best-effort).
  const seated = await c.env.DB.prepare(
    `SELECT DISTINCT user_id FROM event_registrations
       WHERE event_id = ? AND user_id IS NOT NULL AND status IN ('registered','confirmed','attended','waitlisted')`,
  ).bind(id).all();
  for (const r of (seated.results || []) as any[]) {
    await notify(c.env, {
      userId: Number(r.user_id), type: 'event_cancelled', category: 'events',
      title: `Event cancelled: ${event.title}`, link: `/events/${event.slug}`, payload: { event_id: id },
    }).catch(() => {});
  }
  return c.json({ event: shapeEvent(await loadEvent(c.env, id), { includePrivate: true }) });
});

// ── POST /:id/capacity — admin capacity override ───────────────────────────
// Body: { capacity: int>=0 | null }. null clears the cap (unlimited). Raising
// or clearing the cap can free seats, so we promote the waitlist + notify the
// promoted registrants.
adminEvents.post('/:id/capacity', async (c) => {
  const a = await admin(c);
  if (a instanceof Response) return a;
  const id = intParam(c.req.param('id'));
  if (!id) return c.json({ error: 'not_found' }, 404);
  const event = await loadEvent(c.env, id);
  if (!event) return c.json({ error: 'not_found' }, 404);

  const body = await c.req.json().catch(() => ({} as any));
  let capacity: number | null;
  if (body.capacity === null || body.capacity === undefined || body.capacity === '') {
    capacity = null;
  } else {
    const n = Number(body.capacity);
    if (!Number.isInteger(n) || n < 0) return c.json({ error: 'invalid_capacity' }, 400);
    capacity = n;
  }

  await c.env.DB.prepare(
    `UPDATE events SET capacity = ?, updated_at = datetime('now') WHERE id = ?`,
  ).bind(capacity, id).run();
  await writeAudit(c.env, {
    adminId: a.id, adminEmail: a.email, action: 'event_capacity_override', eventId: id,
    extra: { capacity },
  });

  let promoted: Array<{ user_id: number | null }> = [];
  try {
    const fresh = await loadEvent(c.env, id);
    promoted = await promoteWaitlist(c.env, fresh as EventSeatRow);
    for (const p of promoted) {
      if (p.user_id != null) {
        await notify(c.env, {
          userId: Number(p.user_id), type: 'event_waitlist_promoted', category: 'events',
          title: `You're off the waitlist: ${event.title}`,
          link: `/events/${event.slug}`, payload: { event_id: id },
        }).catch(() => {});
      }
    }
  } catch (e) {
    console.warn('[admin_events] capacity waitlist promote failed:', (e as Error).message);
  }

  return c.json({
    event: shapeEvent(await loadEvent(c.env, id), { includePrivate: true }),
    promoted: promoted.length,
  });
});

export default adminEvents;
