/**
 * Task #39 — Event engine: public routes (design §8.2). No auth.
 *
 * Mounted at /api/public (alongside the other public facades) so it sits
 * OUTSIDE the auth layer and the /api/admin CF-Access perimeter. Read endpoints
 * are open; write endpoints (public register, invite response) are Turnstile-
 * gated exactly like routes/contact.ts (fails OPEN in dev/preview, closed in
 * prod when the secret is set).
 *
 * Public feed predicate (design §1.3): visibility='public' AND status=
 * 'published' AND admin_published=1. Unlisted events are reachable by direct
 * slug/invite token only (never listed). Private events are invite-only.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { verifyTurnstile } from '../services/turnstile';
import { ensureEventsSchema } from '../services/eventsSchema';
import { isPrincipalCompEligible, parseAudienceRules } from '../services/eventAudience';
import { isCapacityFull, seatsTaken, type EventSeatRow } from '../services/eventCapacity';
import { buildEventsIcs, shapeAgendaItem, shapeEvent } from '../services/eventsCommon';
import { registerPrincipal } from './events';

const eventsPublic = new Hono<{ Bindings: Env }>();

eventsPublic.use('*', async (c, next) => {
  await ensureEventsSchema(c.env);
  await next();
});

const FEED_PREDICATE = `visibility = 'public' AND status = 'published' AND admin_published = 1`;

function clampInt(v: string | null, def: number, max: number): number {
  // NB: Number(null) === 0, so an absent query param must short-circuit to the
  // default — otherwise the feed would silently run with LIMIT 0 (no rows).
  if (v === null || v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return def;
  return Math.min(Math.floor(n), max);
}

async function resolveUserIdByEmail(env: Env, email: string): Promise<number | null> {
  const r: any = await env.DB.prepare(`SELECT id FROM users WHERE lower(email) = lower(?)`).bind(email).first();
  return r ? Number(r.id) : null;
}

// ── GET /events — public feed ──────────────────────────────────────────────
eventsPublic.get('/events', async (c) => {
  const limit = clampInt(c.req.query('limit') ?? null, 20, 100);
  const offset = clampInt(c.req.query('offset') ?? null, 0, 100000);
  const type = c.req.query('type');
  const from = c.req.query('from');
  const to = c.req.query('to');
  const q = c.req.query('q');
  const includePast = c.req.query('past') === '1';

  const where: string[] = [FEED_PREDICATE];
  const binds: unknown[] = [];
  if (type) { where.push('type = ?'); binds.push(type); }
  if (from) { where.push('starts_at >= ?'); binds.push(from); }
  if (to) { where.push('starts_at <= ?'); binds.push(to); }
  if (!from && !to && !includePast) { where.push(`starts_at >= datetime('now')`); }
  if (q) { where.push('(title LIKE ? OR summary LIKE ?)'); binds.push(`%${q}%`, `%${q}%`); }

  const rows = await c.env.DB.prepare(
    `SELECT * FROM events WHERE ${where.join(' AND ')} ORDER BY starts_at ASC LIMIT ? OFFSET ?`,
  ).bind(...binds, limit, offset).all();
  return c.json({ events: (rows.results || []).map((r) => shapeEvent(r)) });
});

// ── GET /events.ics — public calendar feed ─────────────────────────────────
eventsPublic.get('/events.ics', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT * FROM events WHERE ${FEED_PREDICATE} AND starts_at >= datetime('now','-1 day')
       ORDER BY starts_at ASC LIMIT 200`,
  ).all();
  const ics = buildEventsIcs(rows.results || []);
  return new Response(ics, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'attachment; filename="axal-events.ics"',
    },
  });
});

// ── GET /events/:slug — public detail (public + unlisted) ──────────────────
eventsPublic.get('/events/:slug', async (c) => {
  const slug = c.req.param('slug');
  const event: any = await c.env.DB.prepare(
    `SELECT * FROM events
       WHERE slug = ? AND status = 'published'
         AND ((visibility = 'public' AND admin_published = 1) OR visibility = 'unlisted')`,
  ).bind(slug).first();
  if (!event) return c.json({ error: 'not_found' }, 404);
  const agenda = await c.env.DB.prepare(
    `SELECT * FROM event_agenda_items WHERE event_id = ? ORDER BY display_order ASC, id ASC`,
  ).bind(event.id).all();
  const taken = await seatsTaken(c.env, Number(event.id));
  return c.json({
    event: shapeEvent(event),
    agenda: (agenda.results || []).map(shapeAgendaItem),
    seats_taken: taken,
    is_full: isCapacityFull(event as EventSeatRow, taken),
  });
});

// ── GET /events/:slug/ics — single-event ICS download ──────────────────────
eventsPublic.get('/events/:slug/ics', async (c) => {
  const slug = c.req.param('slug');
  const event: any = await c.env.DB.prepare(
    `SELECT * FROM events
       WHERE slug = ? AND status = 'published'
         AND ((visibility = 'public' AND admin_published = 1) OR visibility = 'unlisted')`,
  ).bind(slug).first();
  if (!event) return c.json({ error: 'not_found' }, 404);
  // Lazy import to avoid circular reference if eventsCommon.ts is already loaded
  const { buildEventIcs } = await import('../services/eventsCommon');
  const ics = buildEventIcs(event);
  return new Response(ics, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `attachment; filename="${event.slug}.ics"`,
    },
  });
});

// ── POST /events/:slug/register — public register (Turnstile) ──────────────
eventsPublic.post('/events/:slug/register', async (c) => {
  const slug = c.req.param('slug');
  const body = await c.req.json().catch(() => ({} as any));
  const clientIp = c.req.header('cf-connecting-ip') || undefined;
  const ok = await verifyTurnstile(c.env, String(body.turnstile_token || body.turnstileToken || ''), clientIp);
  if (!ok) return c.json({ error: 'turnstile_failed', code: 'turnstile_failed' }, 403);

  const email = String(body.email || '').trim().toLowerCase();
  const name = body.name ? String(body.name).trim() : null;
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return c.json({ error: 'invalid_email' }, 400);

  const event: any = await c.env.DB.prepare(
    `SELECT * FROM events
       WHERE slug = ? AND status = 'published'
         AND ((visibility = 'public' AND admin_published = 1) OR visibility = 'unlisted')`,
  ).bind(slug).first();
  if (!event) return c.json({ error: 'not_found' }, 404);

  const rules = parseAudienceRules(event.audience_rules_json);
  const compRule = await isPrincipalCompEligible(c.env, rules, { email }, event.host_user_id ?? null);
  // A pending comp invitation for this email also grants comp.
  const compInvite: any = await c.env.DB.prepare(
    `SELECT comp FROM event_invitations WHERE event_id = ? AND lower(invited_email) = lower(?) AND comp = 1 AND status != 'revoked' LIMIT 1`,
  ).bind(event.id, email).first();
  const comp = compRule.eligible || !!compInvite;
  const paid = Number(event.price_cents || 0) > 0 && !comp;
  const userId = await resolveUserIdByEmail(c.env, email);

  return registerPrincipal(c, event, {
    userId, email, name, comp, paid, source: 'public', invitationId: null, answers: body.answers ?? null,
  });
});

// ── GET /invite/:token — read an invitation + its event ────────────────────
eventsPublic.get('/invite/:token', async (c) => {
  const token = c.req.param('token');
  const inv: any = await c.env.DB.prepare(
    `SELECT * FROM event_invitations WHERE token = ?`,
  ).bind(token).first();
  if (!inv) return c.json({ error: 'not_found' }, 404);
  // A revoked invite must not keep disclosing a (possibly private) event (design §2).
  if (inv.status === 'revoked') return c.json({ error: 'invite_revoked' }, 409);
  const event: any = await c.env.DB.prepare(`SELECT * FROM events WHERE id = ?`).bind(inv.event_id).first();
  if (!event) return c.json({ error: 'not_found' }, 404);
  const agenda = await c.env.DB.prepare(
    `SELECT * FROM event_agenda_items WHERE event_id = ? ORDER BY display_order ASC, id ASC`,
  ).bind(event.id).all();
  return c.json({
    invitation: {
      token: inv.token,
      status: inv.status,
      comp: inv.comp === 1,
      invited_name: inv.invited_name ?? null,
      invited_email: inv.invited_email ?? null,
      personal_message: inv.personal_message ?? null,
    },
    event: shapeEvent(event),
    agenda: (agenda.results || []).map(shapeAgendaItem),
  });
});

// ── POST /invite/:token/respond — accept / decline (Turnstile) ─────────────
eventsPublic.post('/invite/:token/respond', async (c) => {
  const token = c.req.param('token');
  const body = await c.req.json().catch(() => ({} as any));
  const clientIp = c.req.header('cf-connecting-ip') || undefined;
  const ok = await verifyTurnstile(c.env, String(body.turnstile_token || body.turnstileToken || ''), clientIp);
  if (!ok) return c.json({ error: 'turnstile_failed', code: 'turnstile_failed' }, 403);

  const action = String(body.action || '').toLowerCase();
  if (action !== 'accept' && action !== 'decline') return c.json({ error: 'invalid_action' }, 400);

  const inv: any = await c.env.DB.prepare(`SELECT * FROM event_invitations WHERE token = ?`).bind(token).first();
  if (!inv) return c.json({ error: 'not_found' }, 404);
  // A host-revoked invite can no longer be acted on (design §2).
  if (inv.status === 'revoked') return c.json({ error: 'invite_revoked' }, 409);
  const event: any = await c.env.DB.prepare(`SELECT * FROM events WHERE id = ?`).bind(inv.event_id).first();
  if (!event) return c.json({ error: 'not_found' }, 404);

  if (action === 'decline') {
    await c.env.DB.prepare(
      `UPDATE event_invitations SET status = 'declined', responded_at = datetime('now') WHERE id = ?`,
    ).bind(inv.id).run();
    return c.json({ ok: true, status: 'declined' });
  }

  // Accepting creates a registration — the event must actually be open.
  if (event.status !== 'published') return c.json({ error: 'not_open' }, 400);

  await c.env.DB.prepare(
    `UPDATE event_invitations SET status = 'accepted', responded_at = datetime('now') WHERE id = ?`,
  ).bind(inv.id).run();

  const email = inv.invited_email ? String(inv.invited_email).toLowerCase() : null;
  const name = body.name ? String(body.name).trim() : (inv.invited_name ?? null);
  let userId: number | null = inv.invited_user_id != null ? Number(inv.invited_user_id) : null;
  if (!userId && email) userId = await resolveUserIdByEmail(c.env, email);
  const comp = inv.comp === 1;
  const paid = Number(event.price_cents || 0) > 0 && !comp;

  return registerPrincipal(c, event, {
    userId, email, name, comp, paid, source: 'invite', invitationId: Number(inv.id), answers: body.answers ?? null,
  });
});

export default eventsPublic;
