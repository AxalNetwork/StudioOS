/**
 * Task #39 — Event engine: authenticated routes (design §8.1).
 *
 * Mounted at /api/events. Every handler is behind requireAuth (wrapped so a
 * missing session returns a clean 401 even when this router is exercised
 * outside the app's global onError, e.g. in unit tests). Host/admin-only
 * actions additionally check ownership via `canManage`.
 *
 * Scope note (Task #39): paid tickets are minimal hooks only — a paid, non-comp
 * registration lands as `payment_status='pending'` and the response carries
 * `needs_payment: true`; the Stripe PaymentIntent + webhook confirmation is a
 * downstream task. No charge is created here.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import type { User } from '../types';
import { requireAuth } from '../auth';
import { notify } from '../services/notify';
import { ensureEventsSchema } from '../services/eventsSchema';
import {
  classifyNewSeat,
  ensureCheckinCode,
  isCapacityFull,
  nextWaitlistPosition,
  promoteWaitlist,
  seatsTaken,
  SEAT_FREE_PREDICATE,
  type EventSeatRow,
} from '../services/eventCapacity';
import {
  evaluateCompEligibility,
  isPrincipalCompEligible,
  mintCompInvitations,
  parseAudienceRules,
  serializeAudienceRules,
  type AudienceRules,
} from '../services/eventAudience';
import {
  buildEventIcs,
  EVENT_TYPES,
  EVENT_VISIBILITIES,
  LOCATION_KINDS,
  ensureUniqueEventSlug,
  shapeAgendaItem,
  shapeEvent,
} from '../services/eventsCommon';

const events = new Hono<{ Bindings: Env }>();

const ACTIVE_REG = ['registered', 'confirmed', 'attended', 'waitlisted'];

async function auth(c: any): Promise<User | Response> {
  try {
    return await requireAuth(c);
  } catch {
    return c.json({ error: 'Unauthorized' }, 401);
  }
}

function canManage(event: any, user: User): boolean {
  return user.role === 'admin' || Number(event.host_user_id) === Number(user.id);
}

// Can this authenticated principal SEE this event? Managers (admin/host) always
// can. Otherwise the event must be in a viewable published state — unlisted is
// reachable by anyone holding the link; public only after an admin publishes it
// (§1.3) — or the caller must hold a non-revoked invitation. Gate EVERY read
// surface (detail, agenda, ics, eligibility) with this so a guessed event id
// can't leak a private/draft/pending event.
export async function canViewEvent(env: Env, event: any, user: User): Promise<boolean> {
  if (canManage(event, user)) return true;
  const published = event.status === 'published' && (
    event.visibility === 'unlisted' ||
    (event.visibility === 'public' && Number(event.admin_published) === 1)
  );
  if (published) return true;
  const inv = await env.DB.prepare(
    `SELECT id FROM event_invitations
       WHERE event_id = ? AND (invited_user_id = ? OR lower(invited_email) = lower(?))
         AND status != 'revoked' LIMIT 1`,
  ).bind(event.id, user.id, user.email).first();
  return !!inv;
}

async function loadEvent(env: Env, id: number): Promise<any | null> {
  return env.DB.prepare(`SELECT * FROM events WHERE id = ?`).bind(id).first();
}

function intParam(v: string | undefined): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

events.use('*', async (c, next) => {
  await ensureEventsSchema(c.env);
  await next();
});

// ── GET / — the caller's events (hosting + attending) ──────────────────────
events.get('/', async (c) => {
  const u = await auth(c);
  if (u instanceof Response) return u;
  const hosting = await c.env.DB.prepare(
    `SELECT * FROM events WHERE host_user_id = ? ORDER BY starts_at DESC`,
  ).bind(u.id).all();
  const attending = await c.env.DB.prepare(
    `SELECT e.*, r.status AS reg_status, r.waitlist_position AS reg_waitlist_position
       FROM events e
       JOIN event_registrations r ON r.event_id = e.id
      WHERE r.user_id = ? AND r.status IN ('registered','confirmed','attended','waitlisted')
      ORDER BY e.starts_at ASC`,
  ).bind(u.id).all();
  return c.json({
    hosting: (hosting.results || []).map((r) => shapeEvent(r, { includePrivate: true })),
    attending: (attending.results || []).map((r: any) => ({
      ...shapeEvent(r),
      reg_status: r.reg_status,
      reg_waitlist_position: r.reg_waitlist_position ?? null,
    })),
  });
});

// ── POST / — create a draft event ──────────────────────────────────────────
events.post('/', async (c) => {
  const u = await auth(c);
  if (u instanceof Response) return u;
  const body = await c.req.json().catch(() => ({} as any));
  const title = String(body.title || '').trim();
  if (!title) return c.json({ error: 'title_required' }, 400);
  if (!body.starts_at) return c.json({ error: 'starts_at_required' }, 400);

  const type = EVENT_TYPES.includes(body.type) ? body.type : 'meetup';
  const visibility = EVENT_VISIBILITIES.includes(body.visibility) ? body.visibility : 'private';
  const locationKind = LOCATION_KINDS.includes(body.location_kind) ? body.location_kind : 'virtual';
  const slug = await ensureUniqueEventSlug(c.env, title);
  const audienceRules = serializeAudienceRules(parseAudienceRules(
    body.audience_rules ? JSON.stringify(body.audience_rules) : null,
  ));

  const ins: any = await c.env.DB.prepare(
    `INSERT INTO events
       (slug, host_user_id, project_id, type, title, summary, description, cover_url,
        starts_at, ends_at, timezone, location_kind, location_text, location_url,
        capacity, waitlist_enabled, approval_required, visibility, status,
        audience_rules_json, price_cents, currency)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
  ).bind(
    slug,
    u.id,
    body.project_id ?? null,
    type,
    title,
    body.summary ?? null,
    body.description ?? null,
    body.cover_url ?? null,
    body.starts_at,
    body.ends_at ?? null,
    body.timezone ?? 'UTC',
    locationKind,
    body.location_text ?? null,
    body.location_url ?? null,
    body.capacity != null ? Number(body.capacity) : null,
    body.waitlist_enabled === false ? 0 : 1,
    body.approval_required ? 1 : 0,
    visibility,
    audienceRules,
    body.price_cents != null ? Number(body.price_cents) : 0,
    body.currency || 'usd',
  ).run();

  const created = await loadEvent(c.env, Number(ins?.meta?.last_row_id));
  return c.json({ event: shapeEvent(created, { includePrivate: true }) }, 201);
});

// ── GET /:id — event detail ────────────────────────────────────────────────
events.get('/:id', async (c) => {
  const u = await auth(c);
  if (u instanceof Response) return u;
  const id = intParam(c.req.param('id'));
  if (!id) return c.json({ error: 'not_found' }, 404);
  const event = await loadEvent(c.env, id);
  if (!event) return c.json({ error: 'not_found' }, 404);
  const manage = canManage(event, u);
  if (!(await canViewEvent(c.env, event, u))) return c.json({ error: 'forbidden' }, 403);
  const agenda = await c.env.DB.prepare(
    `SELECT * FROM event_agenda_items WHERE event_id = ? ORDER BY display_order ASC, id ASC`,
  ).bind(id).all();
  return c.json({
    event: shapeEvent(event, { includePrivate: manage }),
    agenda: (agenda.results || []).map(shapeAgendaItem),
  });
});

// ── PATCH /:id — update event fields (host/admin) ──────────────────────────
events.patch('/:id', async (c) => {
  const u = await auth(c);
  if (u instanceof Response) return u;
  const id = intParam(c.req.param('id'));
  if (!id) return c.json({ error: 'not_found' }, 404);
  const event = await loadEvent(c.env, id);
  if (!event) return c.json({ error: 'not_found' }, 404);
  if (!canManage(event, u)) return c.json({ error: 'forbidden' }, 403);

  const body = await c.req.json().catch(() => ({} as any));
  const sets: string[] = [];
  const binds: unknown[] = [];
  const str = (k: string) => { if (k in body) { sets.push(`${k} = ?`); binds.push(body[k] ?? null); } };
  const num = (k: string) => { if (k in body) { sets.push(`${k} = ?`); binds.push(body[k] != null ? Number(body[k]) : null); } };
  const bool = (k: string) => { if (k in body) { sets.push(`${k} = ?`); binds.push(body[k] ? 1 : 0); } };

  str('title'); str('summary'); str('description'); str('cover_url');
  str('starts_at'); str('ends_at'); str('timezone'); str('location_text'); str('location_url');
  if ('type' in body && EVENT_TYPES.includes(body.type)) { sets.push('type = ?'); binds.push(body.type); }
  if ('visibility' in body && EVENT_VISIBILITIES.includes(body.visibility)) { sets.push('visibility = ?'); binds.push(body.visibility); }
  if ('location_kind' in body && LOCATION_KINDS.includes(body.location_kind)) { sets.push('location_kind = ?'); binds.push(body.location_kind); }
  num('capacity'); num('price_cents'); num('project_id');
  if ('currency' in body) { sets.push('currency = ?'); binds.push(body.currency || 'usd'); }
  bool('waitlist_enabled'); bool('approval_required');
  if ('audience_rules' in body) {
    sets.push('audience_rules_json = ?');
    binds.push(serializeAudienceRules(parseAudienceRules(JSON.stringify(body.audience_rules))));
  }

  if (!sets.length) return c.json({ event: shapeEvent(event, { includePrivate: true }) });
  sets.push(`updated_at = datetime('now')`);
  binds.push(id);
  await c.env.DB.prepare(`UPDATE events SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();

  // Switching an already self-published event to `public` must re-enter the
  // admin review queue — it can never sit at status='published' without the
  // admin gate, which would bypass §1.3 for authenticated viewers.
  if ('visibility' in body && body.visibility === 'public') {
    const cur = await loadEvent(c.env, id);
    if (Number(cur.admin_published) !== 1 && cur.status === 'published') {
      await c.env.DB.prepare(
        `UPDATE events SET status = 'pending_review', updated_at = datetime('now') WHERE id = ?`,
      ).bind(id).run();
    }
  }

  // Raising capacity may free seats — drain the waitlist.
  const updated = await loadEvent(c.env, id);
  if ('capacity' in body || 'waitlist_enabled' in body) {
    const promoted = await promoteWaitlist(c.env, updated as EventSeatRow);
    for (const p of promoted) {
      if (p.user_id) {
        await notify(c.env, {
          userId: p.user_id, type: 'event_promoted', category: 'events',
          title: `You're off the waitlist: ${updated.title}`,
          link: `/events/${updated.slug}`, payload: { event_id: id },
        }).catch(() => {});
      }
    }
  }
  return c.json({ event: shapeEvent(await loadEvent(c.env, id), { includePrivate: true }) });
});

// ── POST /:id/submit-review — host publish action (design §1.2) ─────────────
// Public events go to the admin queue (pending_review). Unlisted/private
// events self-publish immediately.
events.post('/:id/submit-review', async (c) => {
  const u = await auth(c);
  if (u instanceof Response) return u;
  const id = intParam(c.req.param('id'));
  if (!id) return c.json({ error: 'not_found' }, 404);
  const event = await loadEvent(c.env, id);
  if (!event) return c.json({ error: 'not_found' }, 404);
  if (!canManage(event, u)) return c.json({ error: 'forbidden' }, 403);

  if (event.visibility === 'public') {
    await c.env.DB.prepare(
      `UPDATE events SET status = 'pending_review', updated_at = datetime('now') WHERE id = ?`,
    ).bind(id).run();
  } else {
    await c.env.DB.prepare(
      `UPDATE events SET status = 'published', updated_at = datetime('now') WHERE id = ?`,
    ).bind(id).run();
  }
  return c.json({ event: shapeEvent(await loadEvent(c.env, id), { includePrivate: true }) });
});

// ── POST /:id/invitations — send manual invites (+ mint comp) ──────────────
events.post('/:id/invitations', async (c) => {
  const u = await auth(c);
  if (u instanceof Response) return u;
  const id = intParam(c.req.param('id'));
  if (!id) return c.json({ error: 'not_found' }, 404);
  const event = await loadEvent(c.env, id);
  if (!event) return c.json({ error: 'not_found' }, 404);
  if (!canManage(event, u)) return c.json({ error: 'forbidden' }, 403);

  const body = await c.req.json().catch(() => ({} as any));
  const message = body.message ? String(body.message).slice(0, 2000) : null;
  const userIds: number[] = Array.isArray(body.user_ids) ? body.user_ids.map(Number).filter(Boolean) : [];
  const emails: Array<{ email: string; name?: string }> = Array.isArray(body.emails)
    ? body.emails.map((e: any) => (typeof e === 'string' ? { email: e } : e)).filter((e: any) => e && e.email)
    : [];

  let created = 0;
  const createInvite = async (
    invitedUserId: number | null, email: string | null, name: string | null,
  ) => {
    let exists: any = null;
    if (invitedUserId) {
      exists = await c.env.DB.prepare(
        `SELECT id FROM event_invitations WHERE event_id = ? AND invited_user_id = ? LIMIT 1`,
      ).bind(id, invitedUserId).first();
    }
    if (!exists && email) {
      exists = await c.env.DB.prepare(
        `SELECT id FROM event_invitations WHERE event_id = ? AND lower(invited_email) = lower(?) LIMIT 1`,
      ).bind(id, email).first();
    }
    if (exists) return;
    const token = crypto.randomUUID().replace(/-/g, '');
    await c.env.DB.prepare(
      `INSERT INTO event_invitations
         (event_id, token, invited_user_id, invited_email, invited_name, source, comp, status, personal_message, invited_by)
       VALUES (?, ?, ?, ?, ?, 'manual', 0, 'pending', ?, ?)`,
    ).bind(id, token, invitedUserId, email, name, message, u.id).run();
    created++;
    if (invitedUserId) {
      await notify(c.env, {
        userId: invitedUserId, type: 'event_invitation', category: 'events',
        title: `You're invited: ${event.title}`, body: message || undefined,
        link: `/events/${event.slug}`, payload: { event_id: id, token },
      }).catch(() => {});
    }
  };

  for (const uid of userIds) {
    const target: any = await c.env.DB.prepare(`SELECT id, email, name FROM users WHERE id = ?`).bind(uid).first();
    if (target) await createInvite(Number(target.id), target.email ?? null, target.name ?? null);
  }
  for (const e of emails) {
    const target: any = await c.env.DB.prepare(`SELECT id, name FROM users WHERE lower(email) = lower(?)`).bind(e.email).first();
    await createInvite(target ? Number(target.id) : null, e.email, e.name ?? target?.name ?? null);
  }

  // Auto-mint comp invites for partners/LPs per the event's audience rules
  // (design §7.3 — minted on the host's "send invites" action).
  const rules = parseAudienceRules(event.audience_rules_json);
  const comp = await mintCompInvitations(c.env, id, rules, event.host_user_id ?? null, u.id);

  return c.json({ created, comp_minted: comp.minted });
});

// ── GET /:id/roster — registrations + invitations (host/admin) ─────────────
events.get('/:id/roster', async (c) => {
  const u = await auth(c);
  if (u instanceof Response) return u;
  const id = intParam(c.req.param('id'));
  if (!id) return c.json({ error: 'not_found' }, 404);
  const event = await loadEvent(c.env, id);
  if (!event) return c.json({ error: 'not_found' }, 404);
  if (!canManage(event, u)) return c.json({ error: 'forbidden' }, 403);

  const regs = await c.env.DB.prepare(
    `SELECT r.*, ch.code AS checkin_code, ch.checked_in_at AS checked_in_at
       FROM event_registrations r
       LEFT JOIN event_checkins ch ON ch.registration_id = r.id
      WHERE r.event_id = ?
      ORDER BY CASE r.status WHEN 'waitlisted' THEN 1 ELSE 0 END, r.waitlist_position ASC, r.registered_at ASC`,
  ).bind(id).all();
  const invites = await c.env.DB.prepare(
    `SELECT id, invited_user_id, invited_email, invited_name, source, comp, status, created_at, responded_at
       FROM event_invitations WHERE event_id = ? ORDER BY created_at ASC`,
  ).bind(id).all();
  const taken = await seatsTaken(c.env, id);

  const registrations = (regs.results || []).map((r: any) => ({
    id: r.id,
    user_id: r.user_id ?? null,
    email: r.email ?? null,
    name: r.name ?? null,
    status: r.status,
    source: r.source,
    comp: r.comp === 1,
    waitlist_position: r.waitlist_position ?? null,
    payment_status: r.payment_status,
    amount_cents: Number(r.amount_cents || 0),
    checkin_code: r.checkin_code ?? null,
    checked_in_at: r.checked_in_at ?? null,
    registered_at: r.registered_at,
  }));

  return c.json({
    event: shapeEvent(event, { includePrivate: true }),
    registrations,
    invitations: (invites.results || []).map((r: any) => ({ ...r, comp: r.comp === 1 })),
    counts: {
      seats_taken: taken,
      capacity: event.capacity != null ? Number(event.capacity) : null,
      waitlisted: registrations.filter((r) => r.status === 'waitlisted').length,
      confirmed: registrations.filter((r) => r.status === 'confirmed').length,
      attended: registrations.filter((r) => r.status === 'attended').length,
    },
  });
});

// ── Host/admin registration actions ────────────────────────────────────────
async function loadReg(env: Env, eventId: number, regId: number): Promise<any | null> {
  return env.DB.prepare(`SELECT * FROM event_registrations WHERE id = ? AND event_id = ?`).bind(regId, eventId).first();
}

events.post('/:id/registrations/:rid/approve', async (c) => {
  const u = await auth(c);
  if (u instanceof Response) return u;
  const id = intParam(c.req.param('id'));
  const rid = intParam(c.req.param('rid'));
  if (!id || !rid) return c.json({ error: 'not_found' }, 404);
  const event = await loadEvent(c.env, id);
  if (!event) return c.json({ error: 'not_found' }, 404);
  if (!canManage(event, u)) return c.json({ error: 'forbidden' }, 403);
  const reg = await loadReg(c.env, id, rid);
  if (!reg) return c.json({ error: 'not_found' }, 404);

  if (reg.status === 'waitlisted') {
    // Promoting a waitlisted row adds a seat → capacity-guard it atomically.
    const cap = event.capacity != null ? Number(event.capacity) : null;
    const upd: any = await c.env.DB.prepare(
      `UPDATE event_registrations SET status = 'confirmed', waitlist_position = NULL, updated_at = datetime('now')
         WHERE id = ? AND status = 'waitlisted' AND ${SEAT_FREE_PREDICATE}`,
    ).bind(rid, cap, id, cap).run();
    if (!upd?.meta?.changes) return c.json({ error: 'full' }, 409);
  } else {
    // 'registered' already holds a seat (approval-pending) → no capacity change.
    await c.env.DB.prepare(
      `UPDATE event_registrations SET status = 'confirmed', waitlist_position = NULL, updated_at = datetime('now') WHERE id = ?`,
    ).bind(rid).run();
  }
  await ensureCheckinCode(c.env, id, rid);
  if (reg.user_id) {
    await notify(c.env, {
      userId: reg.user_id, type: 'event_confirmed', category: 'events',
      title: `You're confirmed: ${event.title}`, link: `/events/${event.slug}`, payload: { event_id: id },
    }).catch(() => {});
  }
  return c.json({ registration: { ...(await loadReg(c.env, id, rid)) } });
});

events.post('/:id/registrations/:rid/decline', async (c) => {
  const u = await auth(c);
  if (u instanceof Response) return u;
  const id = intParam(c.req.param('id'));
  const rid = intParam(c.req.param('rid'));
  if (!id || !rid) return c.json({ error: 'not_found' }, 404);
  const event = await loadEvent(c.env, id);
  if (!event) return c.json({ error: 'not_found' }, 404);
  if (!canManage(event, u)) return c.json({ error: 'forbidden' }, 403);
  const reg = await loadReg(c.env, id, rid);
  if (!reg) return c.json({ error: 'not_found' }, 404);

  const heldSeat = ['registered', 'confirmed', 'attended'].includes(reg.status);
  await c.env.DB.prepare(
    `UPDATE event_registrations SET status = 'declined', waitlist_position = NULL, updated_at = datetime('now') WHERE id = ?`,
  ).bind(rid).run();
  if (heldSeat) {
    const promoted = await promoteWaitlist(c.env, event as EventSeatRow);
    for (const p of promoted) {
      if (p.user_id) {
        await notify(c.env, {
          userId: p.user_id, type: 'event_promoted', category: 'events',
          title: `You're off the waitlist: ${event.title}`, link: `/events/${event.slug}`, payload: { event_id: id },
        }).catch(() => {});
      }
    }
  }
  if (reg.user_id) {
    await notify(c.env, {
      userId: reg.user_id, type: 'event_declined', category: 'events',
      title: `Registration update: ${event.title}`, link: `/events/${event.slug}`, payload: { event_id: id },
    }).catch(() => {});
  }
  return c.json({ registration: { ...(await loadReg(c.env, id, rid)) } });
});

events.post('/:id/registrations/:rid/promote', async (c) => {
  const u = await auth(c);
  if (u instanceof Response) return u;
  const id = intParam(c.req.param('id'));
  const rid = intParam(c.req.param('rid'));
  if (!id || !rid) return c.json({ error: 'not_found' }, 404);
  const event = await loadEvent(c.env, id);
  if (!event) return c.json({ error: 'not_found' }, 404);
  if (!canManage(event, u)) return c.json({ error: 'forbidden' }, 403);
  const reg = await loadReg(c.env, id, rid);
  if (!reg) return c.json({ error: 'not_found' }, 404);
  if (reg.status !== 'waitlisted') return c.json({ error: 'not_waitlisted' }, 400);

  const cap = event.capacity != null ? Number(event.capacity) : null;
  const target = (event.approval_required && !reg.comp) ? 'registered' : 'confirmed';
  // Capacity-guarded compare-and-set: 0 changes means the seat is gone (filled
  // concurrently) or the row was already promoted — either way, refuse.
  const upd: any = await c.env.DB.prepare(
    `UPDATE event_registrations SET status = ?, waitlist_position = NULL, updated_at = datetime('now')
       WHERE id = ? AND status = 'waitlisted' AND ${SEAT_FREE_PREDICATE}`,
  ).bind(target, rid, cap, id, cap).run();
  if (!upd?.meta?.changes) return c.json({ error: 'full' }, 409);
  await ensureCheckinCode(c.env, id, rid);
  if (reg.user_id) {
    await notify(c.env, {
      userId: reg.user_id, type: 'event_promoted', category: 'events',
      title: `You're off the waitlist: ${event.title}`, link: `/events/${event.slug}`, payload: { event_id: id },
    }).catch(() => {});
  }
  return c.json({ registration: { ...(await loadReg(c.env, id, rid)) } });
});

// ── GET /:id/eligibility — comp / capacity preview for the caller ──────────
events.get('/:id/eligibility', async (c) => {
  const u = await auth(c);
  if (u instanceof Response) return u;
  const id = intParam(c.req.param('id'));
  if (!id) return c.json({ error: 'not_found' }, 404);
  const event = await loadEvent(c.env, id);
  if (!event) return c.json({ error: 'not_found' }, 404);
  if (!(await canViewEvent(c.env, event, u))) return c.json({ error: 'forbidden' }, 403);
  const rules: AudienceRules = parseAudienceRules(event.audience_rules_json);
  const comp = await isPrincipalCompEligible(c.env, rules, { userId: u.id, email: u.email }, event.host_user_id ?? null);
  const taken = await seatsTaken(c.env, id);
  return c.json({
    comp_eligible: comp.eligible,
    comp_source: comp.source,
    price_cents: Number(event.price_cents || 0),
    currency: event.currency || 'usd',
    requires_approval: event.approval_required === 1,
    capacity: event.capacity != null ? Number(event.capacity) : null,
    seats_taken: taken,
    is_full: isCapacityFull(event as EventSeatRow, taken),
    waitlist_enabled: event.waitlist_enabled === 1,
  });
});

// ── POST /:id/register — the caller registers themselves ────────────────────
events.post('/:id/register', async (c) => {
  const u = await auth(c);
  if (u instanceof Response) return u;
  const id = intParam(c.req.param('id'));
  if (!id) return c.json({ error: 'not_found' }, 404);
  const event = await loadEvent(c.env, id);
  if (!event) return c.json({ error: 'not_found' }, 404);
  const manage = canManage(event, u);
  if (!manage) {
    if (event.status !== 'published') return c.json({ error: 'not_open' }, 400);
    // A public event isn't open for registration until an admin approves it (§1.3).
    if (event.visibility === 'public' && Number(event.admin_published) !== 1) {
      return c.json({ error: 'not_open' }, 400);
    }
  }

  // A (non-revoked) invitation for this principal — required for private
  // events, and carries a comp grant for any visibility.
  const invitation: any = await c.env.DB.prepare(
    `SELECT * FROM event_invitations
       WHERE event_id = ? AND (invited_user_id = ? OR lower(invited_email) = lower(?))
         AND status != 'revoked'
       ORDER BY id DESC LIMIT 1`,
  ).bind(id, u.id, u.email).first();
  if (event.visibility === 'private' && !manage && !invitation) {
    return c.json({ error: 'invite_required' }, 403);
  }

  const body = await c.req.json().catch(() => ({} as any));
  const rules: AudienceRules = parseAudienceRules(event.audience_rules_json);
  const compRule = await isPrincipalCompEligible(c.env, rules, { userId: u.id, email: u.email }, event.host_user_id ?? null);
  const comp = compRule.eligible || invitation?.comp === 1;
  const paid = Number(event.price_cents || 0) > 0 && !comp;

  return registerPrincipal(c, event, {
    userId: u.id, email: u.email, name: u.name,
    comp, paid, source: 'self', invitationId: invitation?.id ?? null,
    answers: body.answers ?? null,
  });
});

// ── DELETE /:id/registration — the caller cancels their seat ───────────────
events.delete('/:id/registration', async (c) => {
  const u = await auth(c);
  if (u instanceof Response) return u;
  const id = intParam(c.req.param('id'));
  if (!id) return c.json({ error: 'not_found' }, 404);
  const event = await loadEvent(c.env, id);
  if (!event) return c.json({ error: 'not_found' }, 404);
  const reg: any = await c.env.DB.prepare(
    `SELECT * FROM event_registrations WHERE event_id = ? AND user_id = ?`,
  ).bind(id, u.id).first();
  if (!reg) return c.json({ error: 'not_found' }, 404);
  const heldSeat = ['registered', 'confirmed', 'attended'].includes(reg.status);
  await c.env.DB.prepare(
    `UPDATE event_registrations SET status = 'cancelled', waitlist_position = NULL, updated_at = datetime('now') WHERE id = ?`,
  ).bind(reg.id).run();
  if (heldSeat) {
    const promoted = await promoteWaitlist(c.env, event as EventSeatRow);
    for (const p of promoted) {
      if (p.user_id) {
        await notify(c.env, {
          userId: p.user_id, type: 'event_promoted', category: 'events',
          title: `You're off the waitlist: ${event.title}`, link: `/events/${event.slug}`, payload: { event_id: id },
        }).catch(() => {});
      }
    }
  }
  return c.json({ ok: true });
});

// ── POST /:id/checkin/:code — scan a check-in code (host/admin) ─────────────
events.post('/:id/checkin/:code', async (c) => {
  const u = await auth(c);
  if (u instanceof Response) return u;
  const id = intParam(c.req.param('id'));
  if (!id) return c.json({ error: 'not_found' }, 404);
  const code = String(c.req.param('code') || '');
  const event = await loadEvent(c.env, id);
  if (!event) return c.json({ error: 'not_found' }, 404);
  if (!canManage(event, u)) return c.json({ error: 'forbidden' }, 403);
  const ch: any = await c.env.DB.prepare(
    `SELECT * FROM event_checkins WHERE event_id = ? AND code = ?`,
  ).bind(id, code).first();
  if (!ch) return c.json({ error: 'invalid_code' }, 404);

  const already = !!ch.checked_in_at;
  if (!already) {
    await c.env.DB.prepare(
      `UPDATE event_checkins SET checked_in_at = datetime('now'), checked_in_by = ? WHERE id = ?`,
    ).bind(u.id, ch.id).run();
    await c.env.DB.prepare(
      `UPDATE event_registrations SET status = 'attended', updated_at = datetime('now') WHERE id = ?`,
    ).bind(ch.registration_id).run();
  }
  const reg = await loadReg(c.env, id, Number(ch.registration_id));
  return c.json({ ok: true, already_checked_in: already, registration: reg });
});

// ── GET /:id/ics — calendar file for one event ─────────────────────────────
events.get('/:id/ics', async (c) => {
  const u = await auth(c);
  if (u instanceof Response) return u;
  const id = intParam(c.req.param('id'));
  if (!id) return c.json({ error: 'not_found' }, 404);
  const event = await loadEvent(c.env, id);
  if (!event) return c.json({ error: 'not_found' }, 404);
  if (!(await canViewEvent(c.env, event, u))) return c.json({ error: 'forbidden' }, 403);
  const ics = buildEventIcs(event);
  return new Response(ics, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `attachment; filename="${event.slug}.ics"`,
    },
  });
});

// ── GET /:id/export — roster CSV (host/admin) ──────────────────────────────
events.get('/:id/export', async (c) => {
  const u = await auth(c);
  if (u instanceof Response) return u;
  const id = intParam(c.req.param('id'));
  if (!id) return c.json({ error: 'not_found' }, 404);
  const event = await loadEvent(c.env, id);
  if (!event) return c.json({ error: 'not_found' }, 404);
  if (!canManage(event, u)) return c.json({ error: 'forbidden' }, 403);
  const regs = await c.env.DB.prepare(
    `SELECT name, email, status, comp, waitlist_position, payment_status, registered_at
       FROM event_registrations WHERE event_id = ? ORDER BY registered_at ASC`,
  ).bind(id).all();
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = 'name,email,status,comp,waitlist_position,payment_status,registered_at';
  const rows = (regs.results || []).map((r: any) =>
    [r.name, r.email, r.status, r.comp === 1 ? 'yes' : 'no', r.waitlist_position, r.payment_status, r.registered_at].map(esc).join(','));
  const csv = [header, ...rows].join('\n') + '\n';
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${event.slug}-roster.csv"`,
    },
  });
});

// ── Agenda CRUD (host/admin) ───────────────────────────────────────────────
events.get('/:id/agenda', async (c) => {
  const u = await auth(c);
  if (u instanceof Response) return u;
  const id = intParam(c.req.param('id'));
  if (!id) return c.json({ error: 'not_found' }, 404);
  const event = await loadEvent(c.env, id);
  if (!event) return c.json({ error: 'not_found' }, 404);
  if (!(await canViewEvent(c.env, event, u))) return c.json({ error: 'forbidden' }, 403);
  const rows = await c.env.DB.prepare(
    `SELECT * FROM event_agenda_items WHERE event_id = ? ORDER BY display_order ASC, id ASC`,
  ).bind(id).all();
  return c.json({ agenda: (rows.results || []).map(shapeAgendaItem) });
});

events.post('/:id/agenda', async (c) => {
  const u = await auth(c);
  if (u instanceof Response) return u;
  const id = intParam(c.req.param('id'));
  if (!id) return c.json({ error: 'not_found' }, 404);
  const event = await loadEvent(c.env, id);
  if (!event) return c.json({ error: 'not_found' }, 404);
  if (!canManage(event, u)) return c.json({ error: 'forbidden' }, 403);
  const body = await c.req.json().catch(() => ({} as any));
  const title = String(body.title || '').trim();
  if (!title) return c.json({ error: 'title_required' }, 400);
  const ins: any = await c.env.DB.prepare(
    `INSERT INTO event_agenda_items
       (event_id, slug, title, description, starts_at, ends_at, speaker_user_id, speaker_name, speaker_title, display_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, body.slug ?? null, title, body.description ?? null, body.starts_at ?? null, body.ends_at ?? null,
    body.speaker_user_id ?? null, body.speaker_name ?? null, body.speaker_title ?? null,
    body.display_order != null ? Number(body.display_order) : 0,
  ).run();
  const row = await c.env.DB.prepare(`SELECT * FROM event_agenda_items WHERE id = ?`).bind(Number(ins?.meta?.last_row_id)).first();
  return c.json({ item: shapeAgendaItem(row) }, 201);
});

events.patch('/:id/agenda/:aid', async (c) => {
  const u = await auth(c);
  if (u instanceof Response) return u;
  const id = intParam(c.req.param('id'));
  const aid = intParam(c.req.param('aid'));
  if (!id || !aid) return c.json({ error: 'not_found' }, 404);
  const event = await loadEvent(c.env, id);
  if (!event) return c.json({ error: 'not_found' }, 404);
  if (!canManage(event, u)) return c.json({ error: 'forbidden' }, 403);
  const body = await c.req.json().catch(() => ({} as any));
  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const k of ['slug', 'title', 'description', 'starts_at', 'ends_at', 'speaker_user_id', 'speaker_name', 'speaker_title', 'display_order']) {
    if (k in body) { sets.push(`${k} = ?`); binds.push(body[k] ?? null); }
  }
  if (!sets.length) return c.json({ error: 'no_fields' }, 400);
  sets.push(`updated_at = datetime('now')`);
  binds.push(aid, id);
  await c.env.DB.prepare(`UPDATE event_agenda_items SET ${sets.join(', ')} WHERE id = ? AND event_id = ?`).bind(...binds).run();
  const row = await c.env.DB.prepare(`SELECT * FROM event_agenda_items WHERE id = ?`).bind(aid).first();
  return c.json({ item: shapeAgendaItem(row) });
});

events.delete('/:id/agenda/:aid', async (c) => {
  const u = await auth(c);
  if (u instanceof Response) return u;
  const id = intParam(c.req.param('id'));
  const aid = intParam(c.req.param('aid'));
  if (!id || !aid) return c.json({ error: 'not_found' }, 404);
  const event = await loadEvent(c.env, id);
  if (!event) return c.json({ error: 'not_found' }, 404);
  if (!canManage(event, u)) return c.json({ error: 'forbidden' }, 403);
  await c.env.DB.prepare(`DELETE FROM event_agenda_items WHERE id = ? AND event_id = ?`).bind(aid, id).run();
  return c.json({ ok: true });
});

/**
 * Shared registration upsert used by self-register (here) and the public
 * invite-accept / public-register flows. Idempotent per (event, principal):
 * an already-active registration is returned unchanged.
 */
export async function registerPrincipal(
  c: any,
  event: any,
  p: {
    userId: number | null;
    email: string | null;
    name: string | null;
    comp: boolean;
    paid: boolean;
    source: string;
    invitationId: number | null;
    answers: unknown;
  },
): Promise<Response> {
  const env: Env = c.env;
  const eventId = Number(event.id);

  // Idempotency: find an existing registration for this principal.
  let existing: any = null;
  if (p.userId) {
    existing = await env.DB.prepare(`SELECT * FROM event_registrations WHERE event_id = ? AND user_id = ?`).bind(eventId, p.userId).first();
  }
  if (!existing && p.email) {
    existing = await env.DB.prepare(`SELECT * FROM event_registrations WHERE event_id = ? AND lower(email) = lower(?)`).bind(eventId, p.email).first();
  }
  if (existing && ACTIVE_REG.includes(existing.status)) {
    const code = ['registered', 'confirmed', 'attended'].includes(existing.status)
      ? await ensureCheckinCode(env, eventId, Number(existing.id)) : null;
    return c.json({ already_registered: true, registration: existing, checkin_code: code, comp: existing.comp === 1 });
  }

  const decision = await classifyNewSeat(env, event as EventSeatRow, { comp: p.comp });
  if ('full' in decision) return c.json({ error: 'full', full: true }, 409);

  const paymentStatus = p.paid ? 'pending' : 'none';
  const amountCents = p.paid ? Number(event.price_cents || 0) : 0;
  const answersJson = p.answers ? JSON.stringify(p.answers) : '{}';
  const cap = event.capacity != null ? Number(event.capacity) : null;

  // classifyNewSeat read the seat count a moment ago; the actual seat claim is
  // capacity-guarded in the SAME statement (SEAT_FREE_PREDICATE) so two
  // concurrent registrations can't both land a seat on a capacity-1 event. If
  // the seat vanished under us, fall back to the waitlist (or refuse, §3).
  let landed: 'registered' | 'confirmed' | 'waitlisted' = decision.status;
  let waitlistPosition: number | null = decision.waitlistPosition;
  let regId = existing ? Number(existing.id) : 0;

  if (landed !== 'waitlisted') {
    if (existing) {
      const upd: any = await env.DB.prepare(
        `UPDATE event_registrations
            SET status = ?, comp = ?, source = ?, invitation_id = ?, waitlist_position = NULL,
                payment_status = ?, amount_cents = ?, answers_json = ?, updated_at = datetime('now')
          WHERE id = ? AND ${SEAT_FREE_PREDICATE}`,
      ).bind(landed, p.comp ? 1 : 0, p.source, p.invitationId, paymentStatus, amountCents, answersJson, existing.id, cap, eventId, cap).run();
      if (!upd?.meta?.changes) { landed = 'waitlisted'; waitlistPosition = await nextWaitlistPosition(env, eventId); }
    } else {
      const ins: any = await env.DB.prepare(
        `INSERT INTO event_registrations
           (event_id, user_id, email, name, status, source, comp, invitation_id, waitlist_position,
            payment_status, amount_cents, answers_json)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?
          WHERE ${SEAT_FREE_PREDICATE}`,
      ).bind(eventId, p.userId, p.email, p.name, landed, p.source, p.comp ? 1 : 0, p.invitationId, paymentStatus, amountCents, answersJson, cap, eventId, cap).run();
      if (ins?.meta?.changes) regId = Number(ins?.meta?.last_row_id);
      else { landed = 'waitlisted'; waitlistPosition = await nextWaitlistPosition(env, eventId); }
    }
  }

  if (landed === 'waitlisted') {
    // No free seat: waitlist if enabled, otherwise refuse (race-safe path too).
    if (!event.waitlist_enabled) return c.json({ error: 'full', full: true }, 409);
    if (existing) {
      await env.DB.prepare(
        `UPDATE event_registrations
            SET status = 'waitlisted', comp = ?, source = ?, invitation_id = ?, waitlist_position = ?,
                payment_status = ?, amount_cents = ?, answers_json = ?, updated_at = datetime('now')
          WHERE id = ?`,
      ).bind(p.comp ? 1 : 0, p.source, p.invitationId, waitlistPosition, paymentStatus, amountCents, answersJson, existing.id).run();
    } else {
      const ins: any = await env.DB.prepare(
        `INSERT INTO event_registrations
           (event_id, user_id, email, name, status, source, comp, invitation_id, waitlist_position,
            payment_status, amount_cents, answers_json)
         VALUES (?, ?, ?, ?, 'waitlisted', ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(eventId, p.userId, p.email, p.name, p.source, p.comp ? 1 : 0, p.invitationId, waitlistPosition, paymentStatus, amountCents, answersJson).run();
      regId = Number(ins?.meta?.last_row_id);
    }
  }

  let code: string | null = null;
  if (landed !== 'waitlisted') code = await ensureCheckinCode(env, eventId, regId);
  const reg = await env.DB.prepare(`SELECT * FROM event_registrations WHERE id = ?`).bind(regId).first();
  return c.json({
    registration: reg,
    status: landed,
    waitlisted: landed === 'waitlisted',
    waitlist_position: landed === 'waitlisted' ? waitlistPosition : null,
    comp: p.comp,
    needs_payment: p.paid,
    checkin_code: code,
  }, 201);
}

export default events;
