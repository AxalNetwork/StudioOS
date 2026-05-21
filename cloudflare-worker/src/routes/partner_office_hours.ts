/**
 * T13 — Partner office hours.
 * Mounted at /api/partner-office-hours. Mirrors mentors.ts but keyed on
 * `partner_id` instead of `mentor_id`. Booking semantics are identical.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import {
  isAdmin, isFounder, mapError, nowIso, newUid, requirePartnerProfile,
} from './_t13t14t15_helpers';

const r = new Hono<{ Bindings: Env }>();

type SlotRow = {
  id: number; uid: string; partner_id: number;
  starts_at: string; ends_at: string; capacity: number;
  meeting_url: string | null; notes: string | null;
  is_cancelled: number; created_at: string;
};
type BookingRow = {
  id: number; uid: string; slot_id: number; partner_id: number;
  founder_user_id: number; topic: string | null; notes: string | null;
  status: string; cancel_reason: string | null;
  created_at: string; updated_at: string;
};

function slotDto(s: SlotRow, taken = 0): any {
  return {
    id: s.id, uid: s.uid, partner_id: s.partner_id,
    starts_at: s.starts_at, ends_at: s.ends_at,
    capacity: s.capacity, taken, available: Math.max(0, s.capacity - taken),
    meeting_url: s.meeting_url, notes: s.notes,
    is_cancelled: !!s.is_cancelled, created_at: s.created_at,
  };
}
function bookingDto(b: BookingRow): any {
  return { ...b, is_cancelled: undefined };
}

async function takenForSlot(env: Env, slotId: number): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) c FROM partner_bookings
     WHERE slot_id = ? AND status IN ('pending','confirmed','completed')`
  ).bind(slotId).first<{ c: number }>();
  return Number(row?.c || 0);
}

async function partnerById(env: Env, id: number) {
  return env.DB.prepare('SELECT * FROM partners WHERE id = ?').bind(id).first<any>();
}
async function partnerByUid(env: Env, uid: string) {
  return env.DB.prepare('SELECT * FROM partners WHERE uid = ?').bind(uid).first<any>();
}

// Slot management for the calling partner --------------------------------
r.post('/me/slots', async (c) => {
  try {
    const user = await requireAuth(c);
    const partner = await requirePartnerProfile(c.env, user);
    const body = await c.req.json().catch(() => ({} as any));
    const starts = String(body.starts_at || '').trim();
    const ends = String(body.ends_at || '').trim();
    if (!starts || !ends) return c.json({ detail: 'starts_at and ends_at required' }, 400);
    if (new Date(ends).getTime() <= new Date(starts).getTime()) {
      return c.json({ detail: 'ends_at must be after starts_at' }, 400);
    }
    const capacity = Math.max(1, Math.min(20, Number(body.capacity || 1)));
    const uid = newUid();
    const ins = await c.env.DB.prepare(
      `INSERT INTO partner_office_hour_slots
        (uid, partner_id, starts_at, ends_at, capacity, meeting_url, notes, is_cancelled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
    ).bind(uid, partner.id, starts, ends, capacity,
           body.meeting_url ? String(body.meeting_url).slice(0, 500) : null,
           body.notes ? String(body.notes).slice(0, 1000) : null,
           nowIso()).run();
    const slot = await c.env.DB.prepare('SELECT * FROM partner_office_hour_slots WHERE id = ?')
      .bind((ins as any).meta?.last_row_id).first<SlotRow>();
    return c.json(slotDto(slot!));
  } catch (e) { return mapError(c, e); }
});

r.get('/me/slots', async (c) => {
  try {
    const user = await requireAuth(c);
    const partner = await requirePartnerProfile(c.env, user);
    const upcoming = (c.req.query('upcoming_only') || 'true').toLowerCase() === 'true';
    const sql = upcoming
      ? 'SELECT * FROM partner_office_hour_slots WHERE partner_id = ? AND is_cancelled = 0 AND ends_at >= ? ORDER BY starts_at ASC'
      : 'SELECT * FROM partner_office_hour_slots WHERE partner_id = ? ORDER BY starts_at DESC LIMIT 200';
    const rows = upcoming
      ? await c.env.DB.prepare(sql).bind(partner.id, nowIso()).all<SlotRow>()
      : await c.env.DB.prepare(sql).bind(partner.id).all<SlotRow>();
    const items: any[] = [];
    for (const s of (rows.results || []) as SlotRow[]) {
      items.push(slotDto(s, await takenForSlot(c.env, s.id)));
    }
    return c.json({ items });
  } catch (e) { return mapError(c, e); }
});

r.get('/partners/:uid/slots', async (c) => {
  try {
    await requireAuth(c);
    const partner = await partnerByUid(c.env, c.req.param('uid'));
    if (!partner) return c.json({ detail: 'Partner not found' }, 404);
    const upcoming = (c.req.query('upcoming_only') || 'true').toLowerCase() === 'true';
    const sql = upcoming
      ? 'SELECT * FROM partner_office_hour_slots WHERE partner_id = ? AND is_cancelled = 0 AND ends_at >= ? ORDER BY starts_at ASC'
      : 'SELECT * FROM partner_office_hour_slots WHERE partner_id = ? ORDER BY starts_at DESC LIMIT 200';
    const rows = upcoming
      ? await c.env.DB.prepare(sql).bind(partner.id, nowIso()).all<SlotRow>()
      : await c.env.DB.prepare(sql).bind(partner.id).all<SlotRow>();
    const items: any[] = [];
    for (const s of (rows.results || []) as SlotRow[]) {
      items.push(slotDto(s, await takenForSlot(c.env, s.id)));
    }
    return c.json({ items });
  } catch (e) { return mapError(c, e); }
});

r.delete('/me/slots/:id', async (c) => {
  try {
    const user = await requireAuth(c);
    const partner = await requirePartnerProfile(c.env, user);
    const id = Number(c.req.param('id'));
    const slot = await c.env.DB.prepare('SELECT * FROM partner_office_hour_slots WHERE id = ?').bind(id).first<SlotRow>();
    if (!slot || slot.partner_id !== partner.id) return c.json({ detail: 'Slot not found' }, 404);
    await c.env.DB.prepare('UPDATE partner_office_hour_slots SET is_cancelled = 1 WHERE id = ?').bind(id).run();
    await c.env.DB.prepare(
      `UPDATE partner_bookings SET status='cancelled', cancel_reason=COALESCE(cancel_reason,'slot_cancelled'), updated_at=?
       WHERE slot_id = ? AND status IN ('pending','confirmed')`
    ).bind(nowIso(), id).run();
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

// Booking ------------------------------------------------------------------
r.post('/slots/:id/book', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!isFounder(user) && !isAdmin(user)) return c.json({ detail: 'Founder role required' }, 403);
    const slotId = Number(c.req.param('id'));
    const body = await c.req.json().catch(() => ({} as any));
    const slot = await c.env.DB.prepare('SELECT * FROM partner_office_hour_slots WHERE id = ?').bind(slotId).first<SlotRow>();
    if (!slot || slot.is_cancelled) return c.json({ detail: 'Slot not available' }, 404);
    if (new Date(slot.starts_at).getTime() < Date.now()) {
      return c.json({ detail: 'Slot is in the past' }, 400);
    }
    const taken = await takenForSlot(c.env, slotId);
    if (taken >= slot.capacity) return c.json({ detail: 'Slot full' }, 409);
    const uid = newUid();
    try {
      const ins = await c.env.DB.prepare(
        `INSERT INTO partner_bookings
          (uid, slot_id, partner_id, founder_user_id, topic, notes, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
      ).bind(uid, slotId, slot.partner_id, user.id,
             (body.topic || '').toString().slice(0, 200),
             (body.notes || '').toString().slice(0, 2000),
             nowIso(), nowIso()).run();
      const after = await takenForSlot(c.env, slotId);
      if (after > slot.capacity) {
        await c.env.DB.prepare(
          `UPDATE partner_bookings SET status='cancelled', cancel_reason='capacity_race', updated_at=? WHERE id = ?`
        ).bind(nowIso(), (ins as any).meta?.last_row_id).run();
        return c.json({ detail: 'Slot full (race)' }, 409);
      }
      const b = await c.env.DB.prepare('SELECT * FROM partner_bookings WHERE id = ?')
        .bind((ins as any).meta?.last_row_id).first<BookingRow>();
      // Task #52 — push partner office-hour booking to attendees' external
      // calendars. All prep happens inside the waitUntil closure so the
      // HTTP response returns immediately.
      const rowId = Number((ins as any).meta?.last_row_id);
      const slotStart = slot.starts_at;
      const slotEnd = slot.ends_at;
      const meetingUrl = slot.meeting_url || null;
      const topic = (body.topic || '').toString().slice(0, 200);
      const notes = (body.notes || '').toString().slice(0, 2000);
      const syncP = (async () => {
        try {
          const founderRow = await c.env.DB.prepare('SELECT email, name FROM users WHERE id = ?')
            .bind(user.id).first<{ email: string; name: string | null }>();
          const partnerRow = await c.env.DB.prepare(
            'SELECT contact_email, organization, user_id FROM partners WHERE id = ?'
          ).bind(slot.partner_id).first<{ contact_email: string | null; organization: string | null; user_id: number | null }>();
          const partnerOwnerEmail = partnerRow?.user_id
            ? ((await c.env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(partnerRow.user_id).first<{ email: string }>())?.email || null)
            : null;
          const ev = {
            id: `partner_office_hour:${rowId}`,
            kind: 'partner_office_hour' as const,
            source_id: rowId,
            source_uid: uid,
            title: `Partner office hours${partnerRow?.organization ? ' — ' + partnerRow.organization : ''}`,
            start_at: slotStart,
            end_at: slotEnd,
            status: 'confirmed',
            location_kind: 'video',
            location_uri: meetingUrl,
            organizer_email: partnerRow?.contact_email || partnerOwnerEmail,
            attendees: [
              { email: partnerRow?.contact_email || partnerOwnerEmail, name: partnerRow?.organization || null, role: 'partner' },
              { email: founderRow?.email || null, name: founderRow?.name || null, role: 'founder' },
            ],
            notes: topic + (notes ? `\n\n${notes}` : ''),
          };
          const { onAxalSessionCreated } = await import('../services/calendar/sync');
          await onAxalSessionCreated(c.env, ev);
        } catch (e) { console.warn('[partner_oh] calendar sync hook failed', e); }
      })();
      if (c.executionCtx?.waitUntil) c.executionCtx.waitUntil(syncP);
      return c.json(bookingDto(b!));
    } catch (e: any) {
      if (String(e?.message || e).includes('UNIQUE')) {
        return c.json({ detail: 'Already booked this slot' }, 409);
      }
      throw e;
    }
  } catch (e) { return mapError(c, e); }
});

r.get('/me/bookings', async (c) => {
  try {
    const user = await requireAuth(c);
    const partner = await requirePartnerProfile(c.env, user);
    const status = c.req.query('status');
    const sql = status
      ? 'SELECT * FROM partner_bookings WHERE partner_id = ? AND status = ? ORDER BY created_at DESC LIMIT 200'
      : 'SELECT * FROM partner_bookings WHERE partner_id = ? ORDER BY created_at DESC LIMIT 200';
    const rows = status
      ? await c.env.DB.prepare(sql).bind(partner.id, status).all<BookingRow>()
      : await c.env.DB.prepare(sql).bind(partner.id).all<BookingRow>();
    return c.json({ items: (rows.results || []).map(bookingDto) });
  } catch (e) { return mapError(c, e); }
});

r.get('/bookings/me', async (c) => {
  try {
    const user = await requireAuth(c);
    const status = c.req.query('status');
    const sql = status
      ? 'SELECT * FROM partner_bookings WHERE founder_user_id = ? AND status = ? ORDER BY created_at DESC LIMIT 200'
      : 'SELECT * FROM partner_bookings WHERE founder_user_id = ? ORDER BY created_at DESC LIMIT 200';
    const rows = status
      ? await c.env.DB.prepare(sql).bind(user.id, status).all<BookingRow>()
      : await c.env.DB.prepare(sql).bind(user.id).all<BookingRow>();
    return c.json({ items: (rows.results || []).map(bookingDto) });
  } catch (e) { return mapError(c, e); }
});

async function transition(c: Context<{ Bindings: Env }>, id: number, opts: {
  allowed: string[]; nextStatus: string; whoCan: 'partner' | 'founder' | 'either';
  reason?: string | null;
}) {
  const user = await requireAuth(c);
  const b = await c.env.DB.prepare('SELECT * FROM partner_bookings WHERE id = ?').bind(id).first<BookingRow>();
  if (!b) return c.json({ detail: 'Booking not found' }, 404);
  let isMatchingPartner = false;
  if (user.partner_id) isMatchingPartner = user.partner_id === b.partner_id;
  const isOwner = b.founder_user_id === user.id;
  let allowed = isAdmin(user);
  if (opts.whoCan === 'partner') allowed = allowed || isMatchingPartner;
  if (opts.whoCan === 'founder') allowed = allowed || isOwner;
  if (opts.whoCan === 'either') allowed = allowed || isMatchingPartner || isOwner;
  if (!allowed) return c.json({ detail: 'Forbidden' }, 403);
  if (!opts.allowed.includes(b.status)) {
    return c.json({ detail: `Cannot transition from ${b.status}` }, 409);
  }
  await c.env.DB.prepare(
    'UPDATE partner_bookings SET status=?, cancel_reason=COALESCE(?, cancel_reason), updated_at=? WHERE id = ?'
  ).bind(opts.nextStatus, opts.reason ?? null, nowIso(), id).run();
  // Task #52 — remove from external calendars on cancel/no-show (deferred).
  if (opts.nextStatus === 'cancelled' || opts.nextStatus === 'no_show') {
    const p = (async () => {
      try {
        const { onAxalSessionCancelled } = await import('../services/calendar/sync');
        await onAxalSessionCancelled(c.env, 'partner_office_hour', id);
      } catch (e) { console.warn('[partner_oh] calendar cancel hook failed', e); }
    })();
    if (c.executionCtx?.waitUntil) c.executionCtx.waitUntil(p);
  }
  const fresh = await c.env.DB.prepare('SELECT * FROM partner_bookings WHERE id = ?').bind(id).first<BookingRow>();
  return c.json(bookingDto(fresh!));
}

r.post('/bookings/:id/confirm', (c) => transition(c, Number(c.req.param('id')),
  { allowed: ['pending'], nextStatus: 'confirmed', whoCan: 'partner' }));
r.post('/bookings/:id/cancel', async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  return transition(c, Number(c.req.param('id')),
    { allowed: ['pending', 'confirmed'], nextStatus: 'cancelled', whoCan: 'either', reason: body.reason || null });
});
r.post('/bookings/:id/complete', (c) => transition(c, Number(c.req.param('id')),
  { allowed: ['pending', 'confirmed'], nextStatus: 'completed', whoCan: 'partner' }));
r.post('/bookings/:id/no-show', async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  return transition(c, Number(c.req.param('id')),
    { allowed: ['pending', 'confirmed'], nextStatus: 'no_show', whoCan: 'partner', reason: body.reason || null });
});

// Task #1 (AG) — spec-contract alias. POST /:uid/book maps the partner uid +
// slot_id (body) to the existing /slots/:id/book handler.
r.post('/:uid/book', async (c) => {
  const body = await c.req.text();
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(body || '{}'); } catch { /* noop */ }
  const slotId = Number(parsed?.slot_id);
  if (!Number.isFinite(slotId)) return c.json({ detail: 'slot_id required in body' }, 400);
  const url = new URL(c.req.url);
  url.pathname = `/api/partner-office-hours/slots/${slotId}/book`;
  return r.fetch(new Request(url, { method: 'POST', headers: c.req.raw.headers, body }), c.env, c.executionCtx);
});

export default r;
