/**
 * T13 — Advisors + office-hour slots + bookings + reviews.
 * Mounted at /api/advisors. Port of backend/app/api/routes/advisors.py.
 *
 * Slot booking is race-safe via UNIQUE (slot_id, founder_user_id) +
 * an additional capacity check that re-counts confirmed/pending bookings
 * after the insert; if the count exceeds capacity we roll the insert back.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { ensureTier } from '../middleware/requireTier';
import {
  isAdmin, isFounder, mapError, nowIso, newUid, jload,
} from './_t13t14t15_helpers';
import {
  loadUserVectors,
  confidenceAdjustedAlignment,
  skillComplementarity,
  computeWatchOuts,
} from '../services/matchingVectors';

const advisors = new Hono<{ Bindings: Env }>();

/**
 * Normalises an advisor's free-text expertise onto the canonical radar-axis
 * slugs (services/skillsTaxonomySchema.ts::RADAR_AXES), so matching and the
 * /match `gap` / `focus` filters agree on what an expertise string means.
 * Anything unmapped falls through as its own lowercased value.
 *
 * Module scope on purpose: it used to be rebuilt inside the per-advisor scoring
 * loop, and the refinement filters below need the identical mapping — two
 * copies would drift.
 */
const EXPERTISE_AXIS: Record<string, string> = {
  product: 'product', engineering: 'engineering', design: 'design',
  sales: 'gtm_sales', marketing: 'marketing_brand', 'go-to-market': 'gtm_sales',
  gtm: 'gtm_sales', finance: 'finance_ops', ops: 'finance_ops', operations: 'finance_ops',
  legal: 'legal_compliance', compliance: 'legal_compliance', capital: 'capital_network',
  fundraising: 'capital_network', networking: 'capital_network', 'data science': 'engineering',
  ai_ml: 'engineering', 'ai / ml': 'engineering', growth: 'gtm_sales',
};

type AdvisorRow = {
  id: number; uid: string; user_id: number | null;
  display_name: string; email: string | null; bio: string | null;
  expertise_json: string; sectors_json: string;
  linkedin_url: string | null; hourly_rate_usd: number | null;
  is_active: number; created_at: string; updated_at: string;
};
type SlotRow = {
  id: number; uid: string; advisor_id: number;
  starts_at: string; ends_at: string; capacity: number;
  meeting_url: string | null; notes: string | null;
  is_cancelled: number; created_at: string;
};
type BookingRow = {
  id: number; uid: string; slot_id: number; advisor_id: number;
  founder_user_id: number; topic: string | null; notes: string | null;
  status: string; cancel_reason: string | null;
  created_at: string; updated_at: string;
};

function advisorDto(m: AdvisorRow): any {
  return {
    id: m.id, uid: m.uid, user_id: m.user_id,
    display_name: m.display_name, email: m.email, bio: m.bio,
    expertise: jload(m.expertise_json, [] as string[]),
    sectors: jload(m.sectors_json, [] as string[]),
    linkedin_url: m.linkedin_url, hourly_rate_usd: m.hourly_rate_usd,
    is_active: !!m.is_active,
    created_at: m.created_at, updated_at: m.updated_at,
  };
}
function slotDto(s: SlotRow, taken = 0): any {
  return {
    id: s.id, uid: s.uid, advisor_id: s.advisor_id,
    starts_at: s.starts_at, ends_at: s.ends_at,
    capacity: s.capacity, taken, available: Math.max(0, s.capacity - taken),
    meeting_url: s.meeting_url, notes: s.notes,
    is_cancelled: !!s.is_cancelled,
    created_at: s.created_at,
  };
}
function bookingDto(b: BookingRow, extras: any = {}): any {
  return {
    id: b.id, uid: b.uid, slot_id: b.slot_id, advisor_id: b.advisor_id,
    founder_user_id: b.founder_user_id,
    topic: b.topic, notes: b.notes, status: b.status,
    cancel_reason: b.cancel_reason,
    created_at: b.created_at, updated_at: b.updated_at,
    ...extras,
  };
}

async function loadAdvisorByUid(env: Env, uid: string): Promise<AdvisorRow | null> {
  return env.DB.prepare('SELECT * FROM advisors WHERE uid = ?').bind(uid).first<AdvisorRow>();
}
async function loadAdvisorById(env: Env, id: number): Promise<AdvisorRow | null> {
  return env.DB.prepare('SELECT * FROM advisors WHERE id = ?').bind(id).first<AdvisorRow>();
}
async function myAdvisor(env: Env, user: User): Promise<AdvisorRow | null> {
  if ((user as any).advisor_id) {
    const row = await env.DB.prepare('SELECT * FROM advisors WHERE id = ?')
      .bind((user as any).advisor_id).first<AdvisorRow>();
    if (row) return row;
  }
  return env.DB.prepare('SELECT * FROM advisors WHERE user_id = ?').bind(user.id).first<AdvisorRow>();
}

async function takenForSlot(env: Env, slotId: number): Promise<number> {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM advisor_bookings
     WHERE slot_id = ? AND status IN ('pending','confirmed','completed')`
  ).bind(slotId).first<{ c: number }>();
  return Number(r?.c || 0);
}

// ---------------------------------------------------------------------------
// Advisor profile CRUD
// ---------------------------------------------------------------------------
advisors.get('/', async (c) => {
  try {
    await requireAuth(c);
    const q = (c.req.query('q') || '').trim().toLowerCase();
    const sector = (c.req.query('sector') || '').trim().toLowerCase();
    const expertise = (c.req.query('expertise') || '').trim().toLowerCase();
    const rows = await c.env.DB.prepare(
      'SELECT * FROM advisors WHERE is_active = 1 ORDER BY display_name ASC'
    ).all<AdvisorRow>();
    let items = (rows.results || []).map(advisorDto);
    if (q) items = items.filter((m: any) =>
      (m.display_name || '').toLowerCase().includes(q) ||
      (m.bio || '').toLowerCase().includes(q));
    if (sector) items = items.filter((m: any) =>
      (m.sectors || []).map((s: string) => s.toLowerCase()).includes(sector));
    if (expertise) items = items.filter((m: any) =>
      (m.expertise || []).map((s: string) => s.toLowerCase()).includes(expertise));
    return c.json({ items });
  } catch (e) { return mapError(c, e); }
});

advisors.get('/me', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await myAdvisor(c.env, user);
    if (!m) return c.json(null);
    return c.json(advisorDto(m));
  } catch (e) { return mapError(c, e); }
});

advisors.post('/me', async (c) => {
  try {
    const user = await requireAuth(c);
    const body = await c.req.json().catch(() => ({} as any));
    const display_name = String(body.display_name || user.name || user.email).slice(0, 200);
    const bio = body.bio ? String(body.bio).slice(0, 4000) : null;
    const linkedin_url = body.linkedin_url ? String(body.linkedin_url).slice(0, 500) : null;
    const hourly_rate_usd = body.hourly_rate_usd != null ? Number(body.hourly_rate_usd) : null;
    const expertise_json = JSON.stringify(Array.isArray(body.expertise) ? body.expertise.slice(0, 32).map(String) : []);
    const sectors_json = JSON.stringify(Array.isArray(body.sectors) ? body.sectors.slice(0, 32).map(String) : []);

    const existing = await myAdvisor(c.env, user);
    const now = nowIso();
    if (existing) {
      await c.env.DB.prepare(
        `UPDATE advisors SET display_name = ?, email = ?, bio = ?,
           expertise_json = ?, sectors_json = ?, linkedin_url = ?,
           hourly_rate_usd = ?, updated_at = ?
         WHERE id = ?`
      ).bind(display_name, user.email, bio, expertise_json, sectors_json,
             linkedin_url, hourly_rate_usd, now, existing.id).run();
      const fresh = await loadAdvisorById(c.env, existing.id);
      return c.json(advisorDto(fresh!));
    }
    const uid = newUid();
    const r = await c.env.DB.prepare(
      `INSERT INTO advisors (uid, user_id, display_name, email, bio,
         expertise_json, sectors_json, linkedin_url, hourly_rate_usd,
         is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).bind(uid, user.id, display_name, user.email, bio,
           expertise_json, sectors_json, linkedin_url, hourly_rate_usd,
           now, now).run();
    const newId = (r as any).meta?.last_row_id as number;
    try {
      await c.env.DB.prepare('UPDATE users SET advisor_id = ? WHERE id = ?')
        .bind(newId, user.id).run();
    } catch { /* advisor_id column not yet migrated */ }
    const fresh = await loadAdvisorById(c.env, newId);
    return c.json(advisorDto(fresh!));
  } catch (e) { return mapError(c, e); }
});

// ---------------------------------------------------------------------------
// Task #4 — Advisor matching (domain-radar overlap + values alignment)
// MUST be registered BEFORE /:uid so Hono does not shadow it.
// ---------------------------------------------------------------------------
advisors.get('/match', async (c) => {
  try {
    const user = await requireAuth(c);
    // ACTIVE Spin-Out Lab members (role `exploring` + spinout_lab_active) get
    // advisor matching too — it is a Week-3 lab deliverable and the result is
    // scoped to the caller's own vectors. Role alone is NOT enough: `exploring`
    // is also the pre-admission holding role, and those accounts must not get
    // the lab exception.
    const isActiveLabExplorer =
      user.role === 'exploring' && Number(user.spinout_lab_active ?? 0) === 1;
    if (!isFounder(user) && !isAdmin(user) && !isActiveLabExplorer) {
      return c.json({ detail: 'Founder role required' }, 403);
    }

    // Load all active advisors
    const rows = await c.env.DB.prepare(
      'SELECT * FROM advisors WHERE is_active = 1 ORDER BY display_name ASC'
    ).all<AdvisorRow>();
    const allAdvisors = (rows.results || []) as AdvisorRow[];

    // Load caller vectors
    const callerVectors = await loadUserVectors(c.env, user.id);

    // Batch-load advisor vectors
    const advisorIds = allAdvisors.map((m) => m.user_id).filter(Boolean) as number[];
    const advisorVectorsMap = new Map<number, Awaited<ReturnType<typeof loadUserVectors>>>();
    if (advisorIds.length) {
      const placeholders = advisorIds.map(() => '?').join(',');
      // Values
      const vRes = await c.env.DB.prepare(
        `SELECT uv.user_id, vd.slug, uv.score, uv.confidence
           FROM user_values uv
           JOIN value_dimensions vd ON vd.id = uv.dimension_id
          WHERE uv.user_id IN (${placeholders})`,
      ).bind(...advisorIds).all<{ user_id: number; slug: string; score: number; confidence: number }>();
      for (const r of vRes.results || []) {
        const m = advisorVectorsMap.get(r.user_id) || { values: {}, skills: {} };
        m.values[r.slug] = { score: Number(r.score) || 0, confidence: Number(r.confidence) || 0 };
        advisorVectorsMap.set(r.user_id, m);
      }
      // Skills
      const sRes = await c.env.DB.prepare(
        `SELECT us.user_id, sc.slug, MAX(us.self_level) AS level
           FROM user_skills us
           JOIN skills s ON s.id = us.skill_id
           JOIN skill_categories sc ON sc.slug = s.category_slug
          WHERE us.user_id IN (${placeholders})
          GROUP BY us.user_id, sc.slug`,
      ).bind(...advisorIds).all<{ user_id: number; slug: string; level: number }>();
      for (const r of sRes.results || []) {
        const m = advisorVectorsMap.get(r.user_id) || { values: {}, skills: {} };
        m.skills[r.slug] = Number(r.level) || 0;
        advisorVectorsMap.set(r.user_id, m);
      }
    }

    const scored = allAdvisors.map((m) => {
      const mVec = advisorVectorsMap.get(m.user_id || 0) || { values: {}, skills: {} };
      // 1. Domain overlap: does the advisor's expertise match the founder's skill gaps?
      const advisorExpertise = jload(m.expertise_json, [] as string[]);
      const founderAxes = Object.keys(callerVectors.skills);
      const gaps = founderAxes.filter((ax) => (callerVectors.skills[ax] || 0) < 2.5);
      const mappedExpertise = advisorExpertise.map((ex) => EXPERTISE_AXIS[ex.toLowerCase()] || ex.toLowerCase());
      const domainOverlap = mappedExpertise.filter((ex) => gaps.includes(ex));
      const domainScore = Math.min(40, domainOverlap.length * 10);

      // 2. Values alignment
      const val = confidenceAdjustedAlignment(callerVectors.values, mVec.values);
      const valScore = val.overlapCount > 0 ? Math.round(((val.score + 1) / 2) * 30) : 0;

      // 3. Skill complementarity
      const comp = skillComplementarity(callerVectors.skills, mVec.skills);
      const compScore = Math.min(30, comp.score);

      const total = Math.min(100, domainScore + valScore + compScore);
      const watchOuts = computeWatchOuts(
        callerVectors.values, mVec.values,
        callerVectors.skills, mVec.skills,
      );

      return {
        advisor: advisorDto(m),
        match_score: total,
        breakdown: { domain_overlap: domainScore, values_alignment: valScore, skill_complementarity: compScore },
        reasons: [
          ...(domainScore > 0 ? [`Fills ${domainOverlap.length} skill gap(s)`] : []),
          ...(valScore > 0 ? [`Values alignment: ${valScore}`] : []),
          ...(compScore > 0 ? [`Skill complementarity: ${compScore}`] : []),
        ].slice(0, 4),
        watch_outs: watchOuts.slice(0, 4),
      };
    });

    scored.sort((a, b) => b.match_score - a.match_score);

    // Optional refinement (the design's "Request another match"). Both filters
    // narrow the SAME scored set — the ranking rule is unchanged, so a refined
    // shortlist is always a subset of the unrefined one and the scores mean the
    // same thing. An unknown value is ignored rather than returning nothing.
    //
    // `gap`   — a radar-axis slug the founder still wants covered; keeps
    //           advisors whose (mapped) expertise includes it.
    // `focus` — 'specialist' | 'generalist', from how many distinct axes the
    //           advisor's own expertise spans. This is the advisor's declared
    //           expertise breadth, not a judgement about their seniority.
    const gapParam = String(c.req.query('gap') || '').trim().toLowerCase();
    const focusParam = String(c.req.query('focus') || '').trim().toLowerCase();
    let refined = scored;
    if (gapParam) {
      refined = refined.filter((s) => {
        const ex = (s.advisor.expertise || []) as string[];
        return ex.some((e) => (EXPERTISE_AXIS[e.toLowerCase()] || e.toLowerCase()) === gapParam);
      });
    }
    if (focusParam === 'specialist' || focusParam === 'generalist') {
      refined = refined.filter((s) => {
        const axes = new Set(
          ((s.advisor.expertise || []) as string[])
            .map((e) => EXPERTISE_AXIS[e.toLowerCase()] || e.toLowerCase()),
        );
        // 1-2 axes reads as a specialist; 3+ as a generalist. Advisors who
        // declared no expertise are excluded from both — we have no signal.
        if (axes.size === 0) return false;
        return focusParam === 'specialist' ? axes.size <= 2 : axes.size >= 3;
      });
    }

    return c.json({
      items: refined.slice(0, 20),
      // Stated so the client never has to guess whether a short list means
      // "no good matches" or "your filter excluded them".
      filters: { gap: gapParam || null, focus: focusParam || null },
      total_before_filters: scored.length,
    });
  } catch (e) { return mapError(c, e); }
});

advisors.get('/:uid', async (c) => {
  try {
    await requireAuth(c);
    const m = await loadAdvisorByUid(c.env, c.req.param('uid'));
    if (!m) return c.json({ detail: 'Advisor not found' }, 404);
    return c.json(advisorDto(m));
  } catch (e) { return mapError(c, e); }
});

// ---------------------------------------------------------------------------
// Slots — owned by the advisor (`/me/slots`) or read for any advisor
// ---------------------------------------------------------------------------
advisors.get('/:uid/slots', async (c) => {
  try {
    await requireAuth(c);
    const m = await loadAdvisorByUid(c.env, c.req.param('uid'));
    if (!m) return c.json({ detail: 'Advisor not found' }, 404);
    const upcoming = (c.req.query('upcoming_only') || 'true').toLowerCase() === 'true';
    const sql = upcoming
      ? 'SELECT * FROM advisor_office_hour_slots WHERE advisor_id = ? AND is_cancelled = 0 AND ends_at >= ? ORDER BY starts_at ASC'
      : 'SELECT * FROM advisor_office_hour_slots WHERE advisor_id = ? ORDER BY starts_at DESC LIMIT 200';
    const rows = upcoming
      ? await c.env.DB.prepare(sql).bind(m.id, nowIso()).all<SlotRow>()
      : await c.env.DB.prepare(sql).bind(m.id).all<SlotRow>();
    const items: any[] = [];
    for (const s of (rows.results || []) as SlotRow[]) {
      items.push(slotDto(s, await takenForSlot(c.env, s.id)));
    }
    return c.json({ items });
  } catch (e) { return mapError(c, e); }
});

advisors.post('/me/slots', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await myAdvisor(c.env, user);
    if (!m) return c.json({ detail: 'Set up your advisor profile first' }, 400);
    const body = await c.req.json().catch(() => ({} as any));
    const starts = String(body.starts_at || '').trim();
    const ends = String(body.ends_at || '').trim();
    if (!starts || !ends) return c.json({ detail: 'starts_at and ends_at required' }, 400);
    if (new Date(ends).getTime() <= new Date(starts).getTime()) {
      return c.json({ detail: 'ends_at must be after starts_at' }, 400);
    }
    const capacity = Math.max(1, Math.min(20, Number(body.capacity || 1)));
    const meeting_url = body.meeting_url ? String(body.meeting_url).slice(0, 500) : null;
    const notes = body.notes ? String(body.notes).slice(0, 1000) : null;
    const uid = newUid();
    const r = await c.env.DB.prepare(
      `INSERT INTO advisor_office_hour_slots
        (uid, advisor_id, starts_at, ends_at, capacity, meeting_url, notes, is_cancelled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
    ).bind(uid, m.id, starts, ends, capacity, meeting_url, notes, nowIso()).run();
    const slot = await c.env.DB.prepare('SELECT * FROM advisor_office_hour_slots WHERE id = ?')
      .bind((r as any).meta?.last_row_id).first<SlotRow>();
    return c.json(slotDto(slot!));
  } catch (e) { return mapError(c, e); }
});

advisors.delete('/me/slots/:id', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await myAdvisor(c.env, user);
    if (!m) return c.json({ detail: 'Advisor profile required' }, 403);
    const id = Number(c.req.param('id'));
    const slot = await c.env.DB.prepare('SELECT * FROM advisor_office_hour_slots WHERE id = ?').bind(id).first<SlotRow>();
    if (!slot || slot.advisor_id !== m.id) return c.json({ detail: 'Slot not found' }, 404);
    await c.env.DB.prepare('UPDATE advisor_office_hour_slots SET is_cancelled = 1 WHERE id = ?').bind(id).run();
    // Cancel any open bookings on this slot.
    await c.env.DB.prepare(
      `UPDATE advisor_bookings SET status = 'cancelled', cancel_reason = COALESCE(cancel_reason, 'slot_cancelled'), updated_at = ?
       WHERE slot_id = ? AND status IN ('pending','confirmed')`
    ).bind(nowIso(), id).run();
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------
advisors.post('/slots/:id/book', async (c) => {
  try {
    const user = await requireAuth(c);
    // Task #6 — advisor booking is Growth-tier for founders. Exception:
    // ACTIVE Spin-Out Lab members (role `exploring` + spinout_lab_active)
    // book advisor intros without a subscription — `advisor_meeting_booked`
    // is a Week-3 lab deliverable (mirrors the scoring sandbox exception).
    // Role alone is NOT enough: `exploring` is also the pre-admission holding
    // role, and those accounts get neither the tier skip nor booking access.
    const isActiveLabExplorer =
      user.role === 'exploring' && Number(user.spinout_lab_active ?? 0) === 1;
    if (!isActiveLabExplorer) {
      ensureTier(user, 'growth');
    }
    if (!isFounder(user) && !isAdmin(user) && !isActiveLabExplorer) {
      return c.json({ detail: 'Founder role required' }, 403);
    }
    const slotId = Number(c.req.param('id'));
    const body = await c.req.json().catch(() => ({} as any));
    const slot = await c.env.DB.prepare('SELECT * FROM advisor_office_hour_slots WHERE id = ?').bind(slotId).first<SlotRow>();
    if (!slot || slot.is_cancelled) return c.json({ detail: 'Slot not available' }, 404);
    if (new Date(slot.starts_at).getTime() < Date.now()) {
      return c.json({ detail: 'Slot is in the past' }, 400);
    }
    const taken = await takenForSlot(c.env, slotId);
    if (taken >= slot.capacity) return c.json({ detail: 'Slot full' }, 409);
    const uid = newUid();
    try {
      const r = await c.env.DB.prepare(
        `INSERT INTO advisor_bookings
          (uid, slot_id, advisor_id, founder_user_id, topic, notes, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
      ).bind(uid, slotId, slot.advisor_id, user.id,
             (body.topic || '').toString().slice(0, 200),
             (body.notes || '').toString().slice(0, 2000),
             nowIso(), nowIso()).run();
      // Re-check capacity after insert (D1 has no SELECT-FOR-UPDATE).
      const after = await takenForSlot(c.env, slotId);
      if (after > slot.capacity) {
        await c.env.DB.prepare(
          `UPDATE advisor_bookings SET status = 'cancelled', cancel_reason = 'capacity_race', updated_at = ?
           WHERE id = ?`
        ).bind(nowIso(), (r as any).meta?.last_row_id).run();
        return c.json({ detail: 'Slot full (race)' }, 409);
      }
      const b = await c.env.DB.prepare('SELECT * FROM advisor_bookings WHERE id = ?')
        .bind((r as any).meta?.last_row_id).first<BookingRow>();
      // Task #1 (Slack, 2026-05-10) — notify the advisor that a founder
      // has booked one of their slots. Best-effort; never blocks the booking.
      try {
        const advisorRow = await c.env.DB.prepare(
          'SELECT user_id, display_name FROM advisors WHERE id = ?'
        ).bind(slot.advisor_id).first<{ user_id: number | null; display_name: string | null }>();
        if (advisorRow?.user_id) {
          const { notify } = await import('../services/notify');
          await notify(c.env, {
            userId: advisorRow.user_id,
            type: 'advisor_session_booked',
            title: `New office-hours booking`,
            body: `${user.name || user.email} booked your slot starting ${slot.starts_at}.`,
            link: '/advisors',
            payload: { booking_uid: uid, slot_id: slotId },
            channels: ['in_app', 'email', 'slack'],
            category: 'advisor_session_booked',
          });
        }
      } catch (e) { console.warn('[advisors] notify advisor_session_booked failed', e); }
      // Task #52 — fire-and-forget two-way calendar sync. The booking
      // appears on Axal /calendar via advisor_bookings join AND on both
      // attendees' connected Google/Outlook calendars within ~seconds.
      // ALL prep (dynamic import + user/advisor lookups + event assembly)
      // happens inside the waitUntil closure so the HTTP response
      // returns immediately — no DB hop on the booking critical path.
      const rowId = Number((r as any).meta?.last_row_id);
      const syncPromise = (async () => {
        try {
          const founderRow = await c.env.DB.prepare('SELECT email, name FROM users WHERE id = ?')
            .bind(user.id).first<{ email: string; name: string | null }>();
          const advisorMeta = await c.env.DB.prepare('SELECT email, display_name, user_id FROM advisors WHERE id = ?')
            .bind(slot.advisor_id).first<{ email: string | null; display_name: string; user_id: number | null }>();
          const ev = {
            id: `advisor_booking:${rowId}`,
            kind: 'advisor_booking' as const,
            source_id: rowId,
            source_uid: uid,
            title: `Advisor session — ${advisorMeta?.display_name || ''}`.trim(),
            start_at: slot.starts_at,
            end_at: slot.ends_at,
            status: 'confirmed',
            location_kind: 'video',
            location_uri: slot.meeting_url || null,
            organizer_email: advisorMeta?.email || null,
            attendees: [
              { email: advisorMeta?.email || null, name: advisorMeta?.display_name || null, role: 'advisor' },
              { email: founderRow?.email || null, name: founderRow?.name || null, role: 'mentee' },
            ],
            notes: (body.topic || '') + (body.notes ? `\n\n${body.notes}` : ''),
          };
          const { onAxalSessionCreated } = await import('../services/calendar/sync');
          await onAxalSessionCreated(c.env, ev);
        } catch (e) { console.warn('[advisors] calendar sync hook failed', e); }
      })();
      if (c.executionCtx?.waitUntil) c.executionCtx.waitUntil(syncPromise);
      return c.json(bookingDto(b!));
    } catch (e: any) {
      if (String(e?.message || e).includes('UNIQUE')) {
        return c.json({ detail: 'Already booked this slot' }, 409);
      }
      throw e;
    }
  } catch (e) { return mapError(c, e); }
});

advisors.get('/me/bookings', async (c) => {
  try {
    const user = await requireAuth(c);
    const status = c.req.query('status');
    const m = await myAdvisor(c.env, user);
    if (!m) return c.json({ items: [] });
    // Wave 1b — the advisor's own Advisory workspace groups these by client
    // and shows the slot time, so the list carries the counterparty's name and
    // the slot window rather than making the UI fetch per row. All additive
    // keys; existing consumers reading the bare booking shape are unaffected.
    // LEFT JOINs on purpose: a deleted user or slot must not hide the booking.
    const sql = status
      ? `SELECT b.*, u.name AS founder_name, u.email AS founder_email,
                s.starts_at AS slot_starts_at, s.ends_at AS slot_ends_at
           FROM advisor_bookings b
           LEFT JOIN users u ON u.id = b.founder_user_id
           LEFT JOIN advisor_office_hour_slots s ON s.id = b.slot_id
          WHERE b.advisor_id = ? AND b.status = ? ORDER BY b.created_at DESC LIMIT 200`
      : `SELECT b.*, u.name AS founder_name, u.email AS founder_email,
                s.starts_at AS slot_starts_at, s.ends_at AS slot_ends_at
           FROM advisor_bookings b
           LEFT JOIN users u ON u.id = b.founder_user_id
           LEFT JOIN advisor_office_hour_slots s ON s.id = b.slot_id
          WHERE b.advisor_id = ? ORDER BY b.created_at DESC LIMIT 200`;
    const rows = status
      ? await c.env.DB.prepare(sql).bind(m.id, status).all<BookingRow>()
      : await c.env.DB.prepare(sql).bind(m.id).all<BookingRow>();
    return c.json({
      items: (rows.results || []).map((r: any) => bookingDto(r, {
        founder_name: r.founder_name ?? null,
        founder_email: r.founder_email ?? null,
        slot_starts_at: r.slot_starts_at ?? null,
        slot_ends_at: r.slot_ends_at ?? null,
      })),
    });
  } catch (e) { return mapError(c, e); }
});

advisors.get('/bookings/me', async (c) => {
  try {
    const user = await requireAuth(c);
    const status = c.req.query('status');
    const sql = status
      ? 'SELECT * FROM advisor_bookings WHERE founder_user_id = ? AND status = ? ORDER BY created_at DESC LIMIT 200'
      : 'SELECT * FROM advisor_bookings WHERE founder_user_id = ? ORDER BY created_at DESC LIMIT 200';
    const rows = status
      ? await c.env.DB.prepare(sql).bind(user.id, status).all<BookingRow>()
      : await c.env.DB.prepare(sql).bind(user.id).all<BookingRow>();
    return c.json({ items: (rows.results || []).map((r) => bookingDto(r)) });
  } catch (e) { return mapError(c, e); }
});

async function transition(c: Context<{ Bindings: Env }>, id: number, opts: {
  allowed: string[]; nextStatus: string; whoCan: 'advisor' | 'founder' | 'either';
  reason?: string | null;
}) {
  const user = await requireAuth(c);
  const b = await c.env.DB.prepare('SELECT * FROM advisor_bookings WHERE id = ?').bind(id).first<BookingRow>();
  if (!b) return c.json({ detail: 'Booking not found' }, 404);
  const m = b.advisor_id;
  const isAdvisor = !!(user as any).advisor_id && (user as any).advisor_id === m;
  const isOwner = b.founder_user_id === user.id;
  const adm = isAdmin(user);
  let allowed = adm;
  if (opts.whoCan === 'advisor') allowed = allowed || isAdvisor;
  if (opts.whoCan === 'founder') allowed = allowed || isOwner;
  if (opts.whoCan === 'either') allowed = allowed || isAdvisor || isOwner;
  if (!allowed) return c.json({ detail: 'Forbidden' }, 403);
  if (!opts.allowed.includes(b.status)) {
    return c.json({ detail: `Cannot transition from ${b.status}` }, 409);
  }
  await c.env.DB.prepare(
    'UPDATE advisor_bookings SET status = ?, cancel_reason = COALESCE(?, cancel_reason), updated_at = ? WHERE id = ?'
  ).bind(opts.nextStatus, opts.reason ?? null, nowIso(), id).run();
  // Task #52 — remove from external calendars on cancel/no-show.
  // Defer the dynamic import + provider DELETE work via waitUntil so
  // the cancel response returns immediately.
  if (opts.nextStatus === 'cancelled' || opts.nextStatus === 'no_show') {
    const p = (async () => {
      try {
        const { onAxalSessionCancelled } = await import('../services/calendar/sync');
        await onAxalSessionCancelled(c.env, 'advisor_booking', id);
      } catch (e) { console.warn('[advisors] calendar cancel hook failed', e); }
    })();
    if (c.executionCtx?.waitUntil) c.executionCtx.waitUntil(p);
  }
  const fresh = await c.env.DB.prepare('SELECT * FROM advisor_bookings WHERE id = ?')
    .bind(id).first<BookingRow>();
  return c.json(bookingDto(fresh!));
}

advisors.post('/bookings/:id/confirm', (c) => transition(c, Number(c.req.param('id')),
  { allowed: ['pending'], nextStatus: 'confirmed', whoCan: 'advisor' }));
advisors.post('/bookings/:id/cancel', async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  return transition(c, Number(c.req.param('id')),
    { allowed: ['pending', 'confirmed'], nextStatus: 'cancelled', whoCan: 'either', reason: body.reason || null });
});
advisors.post('/bookings/:id/complete', (c) => transition(c, Number(c.req.param('id')),
  { allowed: ['pending', 'confirmed'], nextStatus: 'completed', whoCan: 'advisor' }));
advisors.post('/bookings/:id/no-show', async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  return transition(c, Number(c.req.param('id')),
    { allowed: ['pending', 'confirmed'], nextStatus: 'no_show', whoCan: 'advisor', reason: body.reason || null });
});

// ---------------------------------------------------------------------------
// Reviews — both founder and advisor can review the other after completion
// ---------------------------------------------------------------------------
advisors.post('/bookings/:id/review', async (c) => {
  try {
    const user = await requireAuth(c);
    const id = Number(c.req.param('id'));
    const body = await c.req.json().catch(() => ({} as any));
    const rating = Math.max(1, Math.min(5, Number(body.rating || 0)));
    if (!rating) return c.json({ detail: 'rating must be 1..5' }, 400);
    const b = await c.env.DB.prepare('SELECT * FROM advisor_bookings WHERE id = ?').bind(id).first<BookingRow>();
    if (!b) return c.json({ detail: 'Booking not found' }, 404);
    if (b.status !== 'completed') return c.json({ detail: 'Can only review completed bookings' }, 409);
    const isAdvisor = !!(user as any).advisor_id && (user as any).advisor_id === b.advisor_id;
    const isOwner = b.founder_user_id === user.id;
    if (!isAdvisor && !isOwner && !isAdmin(user)) return c.json({ detail: 'Forbidden' }, 403);
    const reviewer_role = isAdvisor && !isOwner ? 'advisor' : 'founder';
    const uid = newUid();
    try {
      await c.env.DB.prepare(
        `INSERT INTO advisor_reviews
          (uid, booking_id, reviewer_user_id, reviewer_role, rating, comment, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(uid, id, user.id, reviewer_role, rating,
             (body.comment || '').toString().slice(0, 2000), nowIso()).run();
    } catch (e: any) {
      if (String(e?.message || e).includes('UNIQUE')) {
        return c.json({ detail: 'You already reviewed this booking' }, 409);
      }
      throw e;
    }
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

advisors.get('/bookings/:id/reviews', async (c) => {
  try {
    await requireAuth(c);
    const id = Number(c.req.param('id'));
    const rows = await c.env.DB.prepare(
      'SELECT * FROM advisor_reviews WHERE booking_id = ? ORDER BY created_at ASC'
    ).bind(id).all<any>();
    return c.json({ items: rows.results || [] });
  } catch (e) { return mapError(c, e); }
});

// Task #1 (AG) — spec-contract alias. POST /:uid/book maps the advisor's user
// uid + a slot id (in body) to the existing /slots/:id/book handler.
advisors.post('/:uid/book', async (c) => {
  const body = await c.req.text();
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(body || '{}'); } catch { /* noop */ }
  const slotId = Number(parsed?.slot_id);
  if (!Number.isFinite(slotId)) return c.json({ detail: 'slot_id required in body' }, 400);
  const url = new URL(c.req.url);
  url.pathname = `/api/advisors/slots/${slotId}/book`;
  return advisors.fetch(new Request(url, { method: 'POST', headers: c.req.raw.headers, body }), c.env, c.executionCtx);
});
export default advisors;
