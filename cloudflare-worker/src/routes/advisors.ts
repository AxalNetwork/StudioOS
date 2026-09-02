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
  isAdmin, isFounder, mapError, nowIso, newUid, jload, trimOrNull,
} from './_t13t14t15_helpers';
import {
  loadUserVectors,
  confidenceAdjustedAlignment,
  skillComplementarity,
  computeWatchOuts,
} from '../services/matchingVectors';
import { ensureAdvisorStoresSchema } from '../services/advisorStoresSchema';

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
  // Migration 202. All nullable: each is a fact only the advisor holds, and an
  // unset one must read as absent rather than as an empty answer.
  headline?: string | null; stages_json?: string | null;
  languages_json?: string | null; country?: string | null;
  timezone?: string | null; availability_note?: string | null;
  headshot_url?: string | null;
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

/**
 * The 202 profile fields, kept separate from `advisorDto` on purpose.
 *
 * `stages` and `languages` return NULL — not `[]` — when the advisor has never
 * answered. The two are different facts and the product renders them
 * differently: an unanswered question shows "Not recorded", an answered one
 * that happens to be empty shows an empty list. `expertise` and `sectors`
 * above collapse both to `[]` because their columns default to '[]' and
 * predate that distinction; the new fields do not repeat it.
 */
function advisorProfileDto(m: AdvisorRow): any {
  return {
    headline: m.headline ?? null,
    stages: m.stages_json == null ? null : jload(m.stages_json, [] as string[]),
    languages: m.languages_json == null ? null : jload(m.languages_json, [] as string[]),
    country: m.country ?? null,
    timezone: m.timezone ?? null,
    availability_note: m.availability_note ?? null,
    headshot_url: m.headshot_url ?? null,
  };
}

function advisorDto(m: AdvisorRow): any {
  return {
    id: m.id, uid: m.uid, user_id: m.user_id,
    display_name: m.display_name, email: m.email, bio: m.bio,
    expertise: jload(m.expertise_json, [] as string[]),
    sectors: jload(m.sectors_json, [] as string[]),
    linkedin_url: m.linkedin_url, hourly_rate_usd: m.hourly_rate_usd,
    is_active: !!m.is_active,
    created_at: m.created_at, updated_at: m.updated_at,
    ...advisorProfileDto(m),
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
    topic: b.topic, notes: b.notes, questions: b.notes, client_message: b.notes, status: b.status,
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
    // The 202 columns are read straight out of the row below; heal a database
    // that was baselined after those ALTERs landed. See advisorStoresSchema.ts.
    await ensureAdvisorStoresSchema(c.env);
    const m = await myAdvisor(c.env, user);
    if (!m) return c.json(null);
    return c.json(advisorDto(m));
  } catch (e) { return mapError(c, e); }
});

/**
 * Resolve the 202 profile fields for a write, MERGING rather than replacing.
 *
 * This is the one thing that must not be got wrong. The six fields above
 * (display_name, bio, expertise, …) are full-replace, and every caller sends
 * all of them together. The seven below are written by different surfaces at
 * different times — `/office-hours`'s ProfileCard sends `headline` and
 * `timezone` and knows nothing about stages or languages — so replacing the
 * whole set on every POST would mean each surface silently blanked the fields
 * the other owns. A key that is absent from the body keeps whatever is stored.
 *
 * An EXPLICIT null still clears: `{"headshot_url": null}` removes the photo.
 * That is the difference between "I did not mention this" and "I am removing
 * this", and only checking key presence can tell them apart.
 */
function mergeProfileFields(existing: AdvisorRow | null, body: any) {
  const text = (key: string, max: number): string | null => {
    if (!(key in body)) return (existing?.[key as keyof AdvisorRow] as string | null) ?? null;
    const v = body[key];
    if (v == null) return null;
    const t = String(v).trim();
    return t ? t.slice(0, max) : null;
  };
  const list = (key: string, col: keyof AdvisorRow): string | null => {
    if (!(key in body)) return (existing?.[col] as string | null) ?? null;
    const v = body[key];
    // Null clears the answer entirely; an empty array is a recorded empty
    // answer. Storing '[]' for both would lose which one the advisor meant.
    if (v == null) return null;
    return JSON.stringify(Array.isArray(v) ? v.slice(0, 32).map(String) : []);
  };
  return {
    headline: text('headline', 200),
    stages_json: list('stages', 'stages_json'),
    languages_json: list('languages', 'languages_json'),
    country: text('country', 100),
    timezone: text('timezone', 100),
    availability_note: text('availability_note', 500),
    headshot_url: text('headshot_url', 1000),
  };
}

advisors.post('/me', async (c) => {
  try {
    const user = await requireAuth(c);
    await ensureAdvisorStoresSchema(c.env);
    const body = await c.req.json().catch(() => ({} as any));
    const display_name = String(body.display_name || user.name || user.email).slice(0, 200);
    const bio = body.bio ? String(body.bio).slice(0, 4000) : null;
    const linkedin_url = body.linkedin_url ? String(body.linkedin_url).slice(0, 500) : null;
    const hourly_rate_usd = body.hourly_rate_usd != null ? Number(body.hourly_rate_usd) : null;
    const expertise_json = JSON.stringify(Array.isArray(body.expertise) ? body.expertise.slice(0, 32).map(String) : []);
    const sectors_json = JSON.stringify(Array.isArray(body.sectors) ? body.sectors.slice(0, 32).map(String) : []);

    const existing = await myAdvisor(c.env, user);
    const p = mergeProfileFields(existing, body);
    const now = nowIso();
    if (existing) {
      await c.env.DB.prepare(
        `UPDATE advisors SET display_name = ?, email = ?, bio = ?,
           expertise_json = ?, sectors_json = ?, linkedin_url = ?,
           hourly_rate_usd = ?, headline = ?, stages_json = ?,
           languages_json = ?, country = ?, timezone = ?,
           availability_note = ?, headshot_url = ?, updated_at = ?
         WHERE id = ?`
      ).bind(display_name, user.email, bio, expertise_json, sectors_json,
             linkedin_url, hourly_rate_usd, p.headline, p.stages_json,
             p.languages_json, p.country, p.timezone, p.availability_note,
             p.headshot_url, now, existing.id).run();
      const fresh = await loadAdvisorById(c.env, existing.id);
      return c.json(advisorDto(fresh!));
    }
    const uid = newUid();
    const r = await c.env.DB.prepare(
      `INSERT INTO advisors (uid, user_id, display_name, email, bio,
         expertise_json, sectors_json, linkedin_url, hourly_rate_usd,
         headline, stages_json, languages_json, country, timezone,
         availability_note, headshot_url,
         is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).bind(uid, user.id, display_name, user.email, bio,
           expertise_json, sectors_json, linkedin_url, hourly_rate_usd,
           p.headline, p.stages_json, p.languages_json, p.country, p.timezone,
           p.availability_note, p.headshot_url,
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
        client_user_id: r.founder_user_id,
        client_name: r.founder_name ?? null,
        client_email: r.founder_email ?? null,
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
    // The slot join is the mirror of `/me/bookings` above, and it closes a
    // hole rather than adding a nicety: the booking row carries no time of its
    // own — the window lives on the slot — so without this a founder's own
    // list could not say WHEN any of their sessions was. The frontend read
    // `b.scheduled_start` and rendered "Invalid Date" for every row.
    //
    // The counterparty is the ADVISOR here, not the founder, which is the one
    // asymmetry with `/me/bookings`. Both joins are LEFT: a deleted advisor or
    // a removed slot must not make the booking disappear from the list of the
    // person who made it.
    //
    // Additive keys only — every existing consumer of the bare booking shape
    // is unaffected.
    const sql = status
      ? `SELECT b.*, a.display_name AS advisor_name, a.uid AS advisor_uid,
                s.starts_at AS slot_starts_at, s.ends_at AS slot_ends_at
           FROM advisor_bookings b
           LEFT JOIN advisors a ON a.id = b.advisor_id
           LEFT JOIN advisor_office_hour_slots s ON s.id = b.slot_id
          WHERE b.founder_user_id = ? AND b.status = ? ORDER BY b.created_at DESC LIMIT 200`
      : `SELECT b.*, a.display_name AS advisor_name, a.uid AS advisor_uid,
                s.starts_at AS slot_starts_at, s.ends_at AS slot_ends_at
           FROM advisor_bookings b
           LEFT JOIN advisors a ON a.id = b.advisor_id
           LEFT JOIN advisor_office_hour_slots s ON s.id = b.slot_id
          WHERE b.founder_user_id = ? ORDER BY b.created_at DESC LIMIT 200`;
    const rows = status
      ? await c.env.DB.prepare(sql).bind(user.id, status).all<BookingRow>()
      : await c.env.DB.prepare(sql).bind(user.id).all<BookingRow>();
    return c.json({
      items: (rows.results || []).map((r: any) => bookingDto(r, {
        advisor_name: r.advisor_name ?? null,
        advisor_uid: r.advisor_uid ?? null,
        slot_starts_at: r.slot_starts_at ?? null,
        slot_ends_at: r.slot_ends_at ?? null,
      })),
    });
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
// ===========================================================================
// The advisor's own stores — migrations 203–206.
//
// EVERY READ IS SCOPED ON THE SIGNED-IN USER, never on a path parameter. The
// pattern is the one `routes/partnernet.ts:224` and `routes/introductions.ts:226`
// already use: resolve the caller's own row first, then filter by its id. An
// advisor cannot name someone else's practice because there is nowhere to put
// the name.
//
// NO MONEY MOVES THROUGH ANY OF THIS. Services carry a price and bookings carry
// an amount because an advisor needs to write down what they charge and what
// they were paid. Nothing here calls a payment provider, issues an invoice, or
// creates an obligation on Axal — see the header of migration 205.
// ===========================================================================

/**
 * The caller's own advisor row, or an error naming what is missing.
 *
 * Also the single door every store endpoint below goes through, which is where
 * the lazy schema bootstrap belongs — one call site rather than nine, and it
 * short-circuits on a database that already has the schema. See
 * `services/advisorStoresSchema.ts` for why a bootstrap is required at all.
 */
async function requireMyAdvisor(c: Context<{ Bindings: Env }>, user: User): Promise<AdvisorRow> {
  await ensureAdvisorStoresSchema(c.env);
  const m = await myAdvisor(c.env, user);
  if (!m) throw new Error('No advisor profile attached to your account');
  return m;
}

// ---------------------------------------------------------------------------
// 203 — Services. What an advisor offers, and what they charge for it.
// ---------------------------------------------------------------------------
type ServiceRow = {
  id: number; uid: string; advisor_id: number; title: string; kind: string;
  duration_note: string | null; price_cents: number | null; currency: string;
  scope: string | null; is_active: number; created_at: string; updated_at: string;
};

const SERVICE_KINDS = ['fixed', 'package', 'retainer'];

function serviceDto(r: ServiceRow, unitsSold: number | null = null): any {
  return {
    id: r.id, uid: r.uid, advisor_id: r.advisor_id,
    title: r.title, kind: r.kind, duration_note: r.duration_note,
    // NULL is not zero. An advisor who has not set a price has not said the
    // service is free, and the surface must render "Not recorded" rather than
    // a confident 0 — CLAUDE.md's absent-is-not-empty rule.
    price_cents: r.price_cents ?? null,
    currency: r.currency,
    scope: r.scope, is_active: !!r.is_active,
    units_sold: unitsSold,
    created_at: r.created_at, updated_at: r.updated_at,
  };
}

/**
 * Parse a price into integer cents, or throw.
 *
 * Takes `price_cents` only — deliberately NOT a dollars field. A route that
 * accepted both would need a rule for which wins when a caller sends both, and
 * every rounding decision that followed would be invisible at the boundary.
 * One unit, named after the column it lands in.
 */
function parsePriceCents(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error('price_cents must be a whole number of cents, zero or more');
  if (n > 100_000_000_00) throw new Error('price_cents is implausibly large');
  return n;
}

advisors.get('/me/services', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const rows = await c.env.DB.prepare(
      `SELECT * FROM advisor_services WHERE advisor_id = ?
        ORDER BY is_active DESC, created_at DESC LIMIT 200`
    ).bind(m.id).all<ServiceRow>();

    // `units_sold` STAYS NULL, and that is the honest answer rather than a
    // missing feature. Nothing links a booking to a service: `advisor_bookings`
    // has a free-text `topic`, not a service id. Counting bookings whose topic
    // string happens to equal a service title would produce a number that looks
    // like a fact and is a guess — the exact thing CLAUDE.md's absent-is-not-
    // empty rule forbids. The Services zone renders "Not recorded" until a
    // booking can name the service it delivered.
    return c.json({ items: (rows.results || []).map((r) => serviceDto(r, null)) });
  } catch (e) { return mapError(c, e); }
});

advisors.post('/me/services', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const body = await c.req.json().catch(() => ({} as any));
    const title = String(body.title || '').trim().slice(0, 200);
    if (!title) return c.json({ detail: 'A service needs a title' }, 400);
    const kind = String(body.kind || 'fixed').trim();
    if (!SERVICE_KINDS.includes(kind)) {
      return c.json({ detail: 'kind must be one of: fixed, package, retainer' }, 400);
    }
    const price_cents = parsePriceCents(body.price_cents);
    const now = nowIso();
    const uid = newUid();
    const r = await c.env.DB.prepare(
      `INSERT INTO advisor_services
         (uid, advisor_id, title, kind, duration_note, price_cents, currency,
          scope, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(uid, m.id, title, kind,
           trimOrNull(body.duration_note, 200), price_cents,
           String(body.currency || 'USD').trim().slice(0, 8).toUpperCase(),
           trimOrNull(body.scope, 2000),
           body.is_active === false ? 0 : 1, now, now).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM advisor_services WHERE id = ?')
      .bind((r as any).meta?.last_row_id).first<ServiceRow>();
    return c.json(serviceDto(fresh!));
  } catch (e) { return mapError(c, e); }
});

advisors.patch('/me/services/:id', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const row = await c.env.DB.prepare('SELECT * FROM advisor_services WHERE id = ?')
      .bind(Number(c.req.param('id'))).first<ServiceRow>();
    // Ownership is checked against the caller's own advisor id, not asserted
    // from the path. A service belonging to someone else is Not Found here.
    if (!row || row.advisor_id !== m.id) return c.json({ detail: 'Service not found' }, 404);
    const body = await c.req.json().catch(() => ({} as any));
    const kind = body.kind == null ? row.kind : String(body.kind).trim();
    if (!SERVICE_KINDS.includes(kind)) {
      return c.json({ detail: 'kind must be one of: fixed, package, retainer' }, 400);
    }
    // Merge, not replace: the Services zone edits one field at a time.
    const price_cents = 'price_cents' in body ? parsePriceCents(body.price_cents) : row.price_cents;
    await c.env.DB.prepare(
      `UPDATE advisor_services SET title = ?, kind = ?, duration_note = ?,
         price_cents = ?, currency = ?, scope = ?, is_active = ?, updated_at = ?
       WHERE id = ?`
    ).bind(
      body.title == null ? row.title : String(body.title).trim().slice(0, 200) || row.title,
      kind,
      'duration_note' in body ? trimOrNull(body.duration_note, 200) : row.duration_note,
      price_cents,
      body.currency == null ? row.currency : String(body.currency).trim().slice(0, 8).toUpperCase(),
      'scope' in body ? trimOrNull(body.scope, 2000) : row.scope,
      body.is_active == null ? row.is_active : (body.is_active ? 1 : 0),
      nowIso(), row.id,
    ).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM advisor_services WHERE id = ?')
      .bind(row.id).first<ServiceRow>();
    return c.json(serviceDto(fresh!));
  } catch (e) { return mapError(c, e); }
});

advisors.delete('/me/services/:id', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const row = await c.env.DB.prepare('SELECT * FROM advisor_services WHERE id = ?')
      .bind(Number(c.req.param('id'))).first<ServiceRow>();
    if (!row || row.advisor_id !== m.id) return c.json({ detail: 'Service not found' }, 404);
    await c.env.DB.prepare('DELETE FROM advisor_services WHERE id = ?').bind(row.id).run();
    return c.json({ ok: true, id: row.id });
  } catch (e) { return mapError(c, e); }
});

// ---------------------------------------------------------------------------
// 204 — Proof. What an advisor claims, and who has confirmed it.
// ---------------------------------------------------------------------------
type ProofRow = {
  id: number; uid: string; advisor_id: number; kind: string; title: string;
  detail: string | null; organization: string | null; period_note: string | null;
  is_public: number; created_at: string; updated_at: string;
};
type ConsentRow = {
  id: number; uid: string; proof_item_id: number;
  attester_name: string; attester_email: string | null; attester_role: string | null;
  relationship: string | null; requested_at: string | null; requested_by: number | null;
  request_token: string | null; consent_given: number; consent_given_at: string | null;
  consent_text: string | null; consent_captured_by: number | null;
  statement: string | null; withdrawn_at: string | null;
  created_at: string; updated_at: string;
};

const PROOF_KINDS = ['engagement', 'outcome', 'role', 'credential'];

/**
 * The consent as the ADVISOR may see it. `request_token` is never included:
 * it is the attester's credential for answering, and an advisor who could read
 * it could answer on the attester's behalf — which would make every
 * attestation in the table self-issued and worth nothing.
 */
function consentDto(r: ConsentRow): any {
  return {
    id: r.id, uid: r.uid, proof_item_id: r.proof_item_id,
    attester_name: r.attester_name, attester_email: r.attester_email,
    attester_role: r.attester_role, relationship: r.relationship,
    requested_at: r.requested_at,
    consent_given: !!r.consent_given,
    consent_given_at: r.consent_given_at,
    statement: r.statement,
    withdrawn_at: r.withdrawn_at,
    created_at: r.created_at,
  };
}

/**
 * Attested is DERIVED from the consent rows, never stored on the item — see
 * migration 204's header. `withdrawn_at` disqualifies a row even when
 * `consent_given` was never cleared, so a withdrawal cannot be undone by
 * forgetting to update one of two columns.
 */
function proofDto(r: ProofRow, consents: ConsentRow[]): any {
  const live = consents.filter((x) => x.consent_given === 1 && !x.withdrawn_at);
  return {
    id: r.id, uid: r.uid, advisor_id: r.advisor_id,
    kind: r.kind, title: r.title, detail: r.detail,
    organization: r.organization, period_note: r.period_note,
    is_public: !!r.is_public,
    attested: live.length > 0,
    // "Self-stated" is a claim with no confirmation behind it. Saying so is the
    // point of the zone: the advisor's own word and someone else's word are
    // different evidence and must never render identically.
    status: live.length > 0 ? 'attested' : 'self_stated',
    consents: consents.map(consentDto),
    created_at: r.created_at, updated_at: r.updated_at,
  };
}

async function loadProofConsents(env: Env, itemIds: number[]): Promise<Map<number, ConsentRow[]>> {
  const out = new Map<number, ConsentRow[]>();
  if (!itemIds.length) return out;
  // No interpolated IN list: `check-sql-prepare` treats a `${}` inside
  // DB.prepare as an injection site, and D1 has no array binding. One
  // statement per item is a handful of round trips over a table that holds a
  // few rows per advisor.
  for (const id of itemIds) {
    const rows = await env.DB.prepare(
      'SELECT * FROM advisor_proof_consents WHERE proof_item_id = ? ORDER BY created_at ASC'
    ).bind(id).all<ConsentRow>();
    out.set(id, rows.results || []);
  }
  return out;
}

advisors.get('/me/proof', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const rows = await c.env.DB.prepare(
      'SELECT * FROM advisor_proof_items WHERE advisor_id = ? ORDER BY created_at DESC LIMIT 200'
    ).bind(m.id).all<ProofRow>();
    const items = rows.results || [];
    const consents = await loadProofConsents(c.env, items.map((r) => r.id));
    return c.json({ items: items.map((r) => proofDto(r, consents.get(r.id) || [])) });
  } catch (e) { return mapError(c, e); }
});

advisors.post('/me/proof', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const body = await c.req.json().catch(() => ({} as any));
    const title = String(body.title || '').trim().slice(0, 300);
    if (!title) return c.json({ detail: 'A proof item needs a title' }, 400);
    const kind = String(body.kind || 'engagement').trim();
    if (!PROOF_KINDS.includes(kind)) {
      return c.json({ detail: 'kind must be one of: engagement, outcome, role, credential' }, 400);
    }
    const now = nowIso();
    const r = await c.env.DB.prepare(
      `INSERT INTO advisor_proof_items
         (uid, advisor_id, kind, title, detail, organization, period_note,
          is_public, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(newUid(), m.id, kind, title,
           trimOrNull(body.detail, 4000), trimOrNull(body.organization, 200),
           trimOrNull(body.period_note, 100),
           body.is_public ? 1 : 0, now, now).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM advisor_proof_items WHERE id = ?')
      .bind((r as any).meta?.last_row_id).first<ProofRow>();
    return c.json(proofDto(fresh!, []));
  } catch (e) { return mapError(c, e); }
});

advisors.delete('/me/proof/:id', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const row = await c.env.DB.prepare('SELECT * FROM advisor_proof_items WHERE id = ?')
      .bind(Number(c.req.param('id'))).first<ProofRow>();
    if (!row || row.advisor_id !== m.id) return c.json({ detail: 'Proof item not found' }, 404);
    // The consents go with the item they attest to. A consent row whose subject
    // no longer exists attests to nothing, and leaving it would leave a
    // stranger's name and email in the database with no claim attached to it.
    await c.env.DB.prepare('DELETE FROM advisor_proof_consents WHERE proof_item_id = ?')
      .bind(row.id).run();
    await c.env.DB.prepare('DELETE FROM advisor_proof_items WHERE id = ?').bind(row.id).run();
    return c.json({ ok: true, id: row.id });
  } catch (e) { return mapError(c, e); }
});

/**
 * Ask a named person to confirm a claim.
 *
 * This RECORDS the request; it does not send it. Who delivers the ask — mail,
 * a link the advisor copies, something else — is a separate decision, and a
 * route that quietly sent mail to an address a user typed would be making it.
 * The token is returned to the ADVISOR once here so a link can be handed over
 * by whatever channel they already have with the person; it is never included
 * in any subsequent read.
 */
advisors.post('/me/proof/:id/consent-request', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const item = await c.env.DB.prepare('SELECT * FROM advisor_proof_items WHERE id = ?')
      .bind(Number(c.req.param('id'))).first<ProofRow>();
    if (!item || item.advisor_id !== m.id) return c.json({ detail: 'Proof item not found' }, 404);
    const body = await c.req.json().catch(() => ({} as any));
    const attester_name = String(body.attester_name || '').trim().slice(0, 200);
    if (!attester_name) return c.json({ detail: 'Name the person being asked to confirm' }, 400);
    const token = newUid();
    const now = nowIso();
    const r = await c.env.DB.prepare(
      `INSERT INTO advisor_proof_consents
         (uid, proof_item_id, attester_name, attester_email, attester_role,
          relationship, requested_at, requested_by, request_token,
          consent_given, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    ).bind(newUid(), item.id, attester_name,
           trimOrNull(body.attester_email, 300), trimOrNull(body.attester_role, 200),
           trimOrNull(body.relationship, 200), now, user.id, token, now, now).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM advisor_proof_consents WHERE id = ?')
      .bind((r as any).meta?.last_row_id).first<ConsentRow>();
    return c.json({ ...consentDto(fresh!), request_token: token, delivered: false });
  } catch (e) { return mapError(c, e); }
});

/**
 * The attester answers. Token-authenticated, and NOT advisor-scoped — the whole
 * value of an attestation is that the subject cannot record it for themselves.
 *
 * `requireAuth` is deliberately absent: an attester is usually not a user of
 * this product, and requiring an account would mean the only confirmable claims
 * are the ones a colleague already inside Axal can vouch for.
 */
// Three segments, first one literal: `/:uid/book` two segments up cannot
// shadow it, and neither can any future single-segment route.
advisors.post('/proof-consents/:token/respond', async (c) => {
  try {
    const token = String(c.req.param('token') || '');
    const row = await c.env.DB.prepare(
      'SELECT * FROM advisor_proof_consents WHERE request_token = ?'
    ).bind(token).first<ConsentRow>();
    if (!row) return c.json({ detail: 'Consent request not found' }, 404);
    const body = await c.req.json().catch(() => ({} as any));
    const now = nowIso();
    if (body.consent_given === false) {
      // Declining and withdrawing are the same shape: the row stays, and says
      // so. Deleting it would erase the fact that the ask was ever made.
      await c.env.DB.prepare(
        `UPDATE advisor_proof_consents
            SET consent_given = 0, withdrawn_at = ?, updated_at = ? WHERE id = ?`
      ).bind(now, now, row.id).run();
    } else {
      const consent_text = String(body.consent_text || '').trim();
      if (!consent_text) {
        return c.json({ detail: 'consent_text must record what was agreed to' }, 400);
      }
      await c.env.DB.prepare(
        `UPDATE advisor_proof_consents
            SET consent_given = 1, consent_given_at = ?, consent_text = ?,
                statement = ?, withdrawn_at = NULL, updated_at = ?
          WHERE id = ?`
      ).bind(now, consent_text.slice(0, 2000), trimOrNull(body.statement, 2000),
             now, row.id).run();
    }
    const fresh = await c.env.DB.prepare('SELECT * FROM advisor_proof_consents WHERE id = ?')
      .bind(row.id).first<ConsentRow>();
    return c.json(consentDto(fresh!));
  } catch (e) { return mapError(c, e); }
});

// ---------------------------------------------------------------------------
// 205 — What a session was worth. Recording only; no money moves.
// ---------------------------------------------------------------------------
const BILLING_STATES = ['unpriced', 'billed', 'collected', 'written_off'];

/**
 * Price a session, or record what happened to that money.
 *
 * WHAT THIS IS NOT. No invoice is issued, no payment provider is called, no
 * obligation is created on Axal, and nothing is owed to anyone as a result of
 * this write. `billing_state` is the advisor's own note about their own
 * arrangement with their own client — see migration 205's header. Naming it
 * `billing_state` rather than `payment_status` is deliberate for that reason.
 *
 * ONLY THE ADVISOR ON THE BOOKING MAY WRITE IT. Not the founder, and not an
 * admin: what an advisor charged is theirs to state. An admin who needs to
 * correct it has the same route available under impersonation, which leaves an
 * audit trail — that is the difference between fixing a record and quietly
 * changing someone's books.
 */
advisors.patch('/me/bookings/:id/billing', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const row = await c.env.DB.prepare('SELECT * FROM advisor_bookings WHERE id = ?')
      .bind(Number(c.req.param('id'))).first<BookingRow & {
        amount_cents: number | null; billing_state: string;
      }>();
    if (!row || row.advisor_id !== m.id) return c.json({ detail: 'Booking not found' }, 404);
    const body = await c.req.json().catch(() => ({} as any));

    const amount_cents = 'amount_cents' in body
      ? parsePriceCents(body.amount_cents)
      : (row.amount_cents ?? null);

    let billing_state = body.billing_state == null
      ? row.billing_state
      : String(body.billing_state).trim();
    if (!BILLING_STATES.includes(billing_state)) {
      return c.json({ detail: 'billing_state must be one of: unpriced, billed, collected, written_off' }, 400);
    }
    // A session with no amount cannot be billed, collected or written off —
    // there is no figure for any of those words to refer to. Rejecting rather
    // than silently coercing to 0, which would assert the session was free.
    if (amount_cents == null && billing_state !== 'unpriced') {
      return c.json({ detail: 'Set amount_cents before recording a billing state' }, 400);
    }
    // Naming an amount without saying anything about it means the session now
    // has a price and nothing has happened to it yet.
    if (amount_cents != null && billing_state === 'unpriced' && body.billing_state == null) {
      billing_state = 'billed';
    }

    await c.env.DB.prepare(
      'UPDATE advisor_bookings SET amount_cents = ?, billing_state = ?, updated_at = ? WHERE id = ?'
    ).bind(amount_cents, billing_state, nowIso(), row.id).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM advisor_bookings WHERE id = ?')
      .bind(row.id).first<BookingRow & { amount_cents: number | null; billing_state: string }>();
    return c.json(bookingDto(fresh!, {
      amount_cents: fresh!.amount_cents ?? null,
      billing_state: fresh!.billing_state,
    }));
  } catch (e) { return mapError(c, e); }
});

/**
 * Earnings, rolled up from the bookings themselves.
 *
 * Every figure here is a SUM over rows an advisor entered, in cents, with no
 * estimate anywhere. `unpriced_count` is reported rather than hidden: an
 * earnings total that quietly ignored the sessions nobody has priced would be
 * a smaller number presented as a complete one.
 */
advisors.get('/me/earnings', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const rows = await c.env.DB.prepare(
      `SELECT billing_state AS billing_state,
              COUNT(*) AS bookings,
              SUM(COALESCE(amount_cents, 0)) AS total_cents
         FROM advisor_bookings
        WHERE advisor_id = ?
        GROUP BY billing_state`
    ).bind(m.id).all<{ billing_state: string; bookings: number; total_cents: number }>();
    const by = new Map((rows.results || []).map((r) => [r.billing_state, r]));
    const cents = (k: string) => Number(by.get(k)?.total_cents || 0);
    const count = (k: string) => Number(by.get(k)?.bookings || 0);
    return c.json({
      currency: 'USD',
      billed_cents: cents('billed'),
      collected_cents: cents('collected'),
      written_off_cents: cents('written_off'),
      outstanding_cents: cents('billed'),
      unpriced_count: count('unpriced'),
      by_state: BILLING_STATES.map((state) => ({
        state, bookings: count(state), total_cents: cents(state),
      })),
      // Said out loud because a page showing money must not imply a rail
      // behind it: Axal records these figures and settles nothing.
      settlement: 'none',
    });
  } catch (e) { return mapError(c, e); }
});

// ---------------------------------------------------------------------------
// 206 — Cohorts. An advisor's assigned batch, beside the Lab.
//
// NOTHING HERE TOUCHES THE SPIN-OUT LAB. It reads `cohort_cycles` through a
// foreign key and writes only `advisor_cohort_assignments`, a table this
// migration set introduced. No Lab table is written, no Lab route is changed,
// and no Lab surface is edited — the Lab keeps sole authority over cohorts,
// weeks, admission and graduation.
//
// ADMIN ASSIGNS, THE ADVISOR READS. An advisor cannot grant themselves a
// batch, because founder data in a cohort is not theirs to open. That matches
// how every other Lab decision is made.
// ---------------------------------------------------------------------------
type CohortAssignmentRow = {
  id: number; uid: string; advisor_user_id: number; cohort_cycle_id: number;
  assigned_by_admin_id: number | null; assigned_at: string;
  unassigned_at: string | null; note: string | null; is_active: number;
  created_at: string; updated_at: string;
};

advisors.get('/me/cohort', async (c) => {
  try {
    const user = await requireAuth(c);
    await ensureAdvisorStoresSchema(c.env);
    // Scoped on the SIGNED-IN USER, not on an advisor profile id and not on a
    // path parameter. 206 keys assignments on `users(id)` precisely so an
    // advisor with no profile row yet is still assignable — see its header.
    const rows = await c.env.DB.prepare(
      `SELECT a.id AS id, a.uid AS uid, a.cohort_cycle_id AS cohort_cycle_id,
              a.assigned_at AS assigned_at, a.note AS note,
              a.is_active AS is_active,
              c.year AS year, c.month AS month,
              c.start_at AS start_at, c.end_at AS end_at, c.status AS status
         FROM advisor_cohort_assignments a
         JOIN cohort_cycles c ON c.id = a.cohort_cycle_id
        WHERE a.advisor_user_id = ? AND a.is_active = 1
        ORDER BY c.start_at DESC
        LIMIT 50`
    ).bind(user.id).all<{
      id: number; uid: string; cohort_cycle_id: number; assigned_at: string;
      note: string | null; is_active: number; year: number; month: number;
      start_at: string; end_at: string; status: string;
    }>();
    return c.json({
      items: (rows.results || []).map((r) => ({
        id: r.id, uid: r.uid,
        cohort_cycle_id: r.cohort_cycle_id,
        assigned_at: r.assigned_at, note: r.note,
        cohort: {
          year: r.year, month: r.month,
          start_at: r.start_at, end_at: r.end_at, status: r.status,
        },
      })),
    });
  } catch (e) { return mapError(c, e); }
});

/**
 * The founders in a cohort this advisor was assigned to.
 *
 * THE ASSIGNMENT IS THE AUTHORISATION. Without a row in
 * `advisor_cohort_assignments` this returns 403, whatever the advisor's role
 * is — reading a role is not the same as being given a batch.
 *
 * ONE COHORT AT A TIME, by cycle id, because a page must not show two batches
 * merged into one list. It reads `company_week_status`, which is the Lab's own
 * record of who is in a cycle, WITHOUT writing to it.
 */
advisors.get('/me/cohort/:cycleId/founders', async (c) => {
  try {
    const user = await requireAuth(c);
    await ensureAdvisorStoresSchema(c.env);
    const cycleId = Number(c.req.param('cycleId'));
    const assignment = await c.env.DB.prepare(
      `SELECT id FROM advisor_cohort_assignments
        WHERE advisor_user_id = ? AND cohort_cycle_id = ? AND is_active = 1`
    ).bind(user.id, cycleId).first<{ id: number }>();
    if (!assignment) {
      return c.json({ detail: 'You are not assigned to this cohort' }, 403);
    }
    const rows = await c.env.DB.prepare(
      `SELECT DISTINCT w.user_id AS user_id, u.name AS name, u.email AS email
         FROM company_week_status w
         LEFT JOIN users u ON u.id = w.user_id
        WHERE w.cohort_cycle_id = ?
        ORDER BY u.name ASC
        LIMIT 200`
    ).bind(cycleId).all<{ user_id: number; name: string | null; email: string | null }>();
    return c.json({
      cohort_cycle_id: cycleId,
      // Seam-marked: this is the founder's own record, shown to an advisor an
      // admin put in front of it. It is not the practice's data.
      source: 'spinout_lab',
      items: (rows.results || []).map((r) => ({
        user_id: r.user_id, name: r.name ?? null, email: r.email ?? null,
      })),
    });
  } catch (e) { return mapError(c, e); }
});

/**
 * Admin: who is assigned to which cohort.
 *
 * Registered under `/admin/...` — two segments with a literal first — so the
 * single-segment `/:uid` route far above cannot shadow it. `/match` carries the
 * same warning in its own comment.
 */
advisors.get('/admin/cohort-assignments', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!isAdmin(user)) return c.json({ detail: 'Admin required' }, 403);
    await ensureAdvisorStoresSchema(c.env);
    const rows = await c.env.DB.prepare(
      `SELECT a.id AS id, a.uid AS uid, a.advisor_user_id AS advisor_user_id,
              a.cohort_cycle_id AS cohort_cycle_id, a.assigned_at AS assigned_at,
              a.unassigned_at AS unassigned_at, a.is_active AS is_active,
              a.note AS note, u.name AS advisor_name, u.email AS advisor_email
         FROM advisor_cohort_assignments a
         LEFT JOIN users u ON u.id = a.advisor_user_id
        ORDER BY a.assigned_at DESC
        LIMIT 500`
    ).all<{
      id: number; uid: string; advisor_user_id: number; cohort_cycle_id: number;
      assigned_at: string; unassigned_at: string | null; is_active: number;
      note: string | null; advisor_name: string | null; advisor_email: string | null;
    }>();
    return c.json({
      items: (rows.results || []).map((r) => ({
        ...r, is_active: !!r.is_active,
      })),
    });
  } catch (e) { return mapError(c, e); }
});

advisors.post('/admin/cohort-assignments', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!isAdmin(user)) return c.json({ detail: 'Admin required' }, 403);
    await ensureAdvisorStoresSchema(c.env);
    const body = await c.req.json().catch(() => ({} as any));
    const advisorUserId = Number(body.advisor_user_id);
    const cycleId = Number(body.cohort_cycle_id);
    if (!Number.isInteger(advisorUserId) || !Number.isInteger(cycleId)) {
      return c.json({ detail: 'advisor_user_id and cohort_cycle_id are required' }, 400);
    }
    // Both ends are checked before the write so a bad id fails with a sentence
    // rather than a foreign-key error nobody can read.
    const target = await c.env.DB.prepare('SELECT id, role FROM users WHERE id = ?')
      .bind(advisorUserId).first<{ id: number; role: string }>();
    if (!target) return c.json({ detail: 'No such user' }, 404);
    const cycle = await c.env.DB.prepare('SELECT id FROM cohort_cycles WHERE id = ?')
      .bind(cycleId).first<{ id: number }>();
    if (!cycle) return c.json({ detail: 'No such cohort cycle' }, 404);

    const now = nowIso();
    // UNIQUE (advisor_user_id, cohort_cycle_id) — reassigning the same pair
    // REACTIVATES the existing row rather than stacking a second one that
    // every read would then have to de-duplicate. See 206's header.
    await c.env.DB.prepare(
      `INSERT INTO advisor_cohort_assignments
         (uid, advisor_user_id, cohort_cycle_id, assigned_by_admin_id,
          assigned_at, note, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT (advisor_user_id, cohort_cycle_id) DO UPDATE SET
         is_active = 1, unassigned_at = NULL, assigned_by_admin_id = excluded.assigned_by_admin_id,
         assigned_at = excluded.assigned_at, note = excluded.note, updated_at = excluded.updated_at`
    ).bind(newUid(), advisorUserId, cycleId, user.id, now,
           trimOrNull(body.note, 1000), now, now).run();
    const fresh = await c.env.DB.prepare(
      'SELECT * FROM advisor_cohort_assignments WHERE advisor_user_id = ? AND cohort_cycle_id = ?'
    ).bind(advisorUserId, cycleId).first<CohortAssignmentRow>();
    return c.json({ ...fresh!, is_active: !!fresh!.is_active });
  } catch (e) { return mapError(c, e); }
});

/**
 * End an assignment. The row stays and says when it ended — see 206's header.
 * A record that vanishes cannot answer who had access to a cohort's founders
 * and when, which is the question an access record exists to answer.
 */
advisors.delete('/admin/cohort-assignments/:id', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!isAdmin(user)) return c.json({ detail: 'Admin required' }, 403);
    await ensureAdvisorStoresSchema(c.env);
    const row = await c.env.DB.prepare('SELECT * FROM advisor_cohort_assignments WHERE id = ?')
      .bind(Number(c.req.param('id'))).first<CohortAssignmentRow>();
    if (!row) return c.json({ detail: 'Assignment not found' }, 404);
    const now = nowIso();
    await c.env.DB.prepare(
      'UPDATE advisor_cohort_assignments SET is_active = 0, unassigned_at = ?, updated_at = ? WHERE id = ?'
    ).bind(now, now, row.id).run();
    return c.json({ ok: true, id: row.id, is_active: false, unassigned_at: now });
  } catch (e) { return mapError(c, e); }
});

export default advisors;
