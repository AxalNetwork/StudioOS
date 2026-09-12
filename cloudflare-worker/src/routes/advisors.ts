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
  isAdmin, isFounder, mapError, nowIso, newUid, jload, trimOrNull, role,
} from './_t13t14t15_helpers';
import {
  loadUserVectors,
  confidenceAdjustedAlignment,
  skillComplementarity,
  computeWatchOuts,
} from '../services/matchingVectors';
import { ensureAdvisorStoresSchema } from '../services/advisorStoresSchema';
import { ensureCohortGuidanceSchema } from '../services/cohortGuidanceSchema';
import {
  guidanceCounts, oldestOpenHours, collisions, withinDays,
  type GuidanceRow, type CalendarItem,
} from './_advisor_cohort_helpers';

const advisors = new Hono<{ Bindings: Env }>();

/**
 * THE SCHEMA SELF-HEAL RUNS FOR EVERY ADVISOR ROUTE, not just the ones that
 * remembered to ask for it — and that gap was a live 500, not a hypothetical.
 *
 * `ensureAdvisorStoresSchema` renames production's legacy `mentor_id` to
 * `advisor_id` on `advisor_office_hour_slots` and `advisor_bookings` (see that
 * service for why the rename cannot be a migration). Until this middleware it
 * was reached only through `requireMyAdvisor` — "the single door every store
 * endpoint BELOW goes through", and *below* was the whole problem. The seven
 * T13-era handlers registered above it call `myAdvisor` directly, so on any
 * isolate whose first advisor request hit one of them, the rename had never
 * run and the query named a column production does not have.
 *
 * SQLITE RESOLVES COLUMN NAMES WHEN IT PREPARES, so an empty table does not
 * save it: `GET /bookings/me` — a FOUNDER reading their own booked sessions —
 * threw "no such column: b.advisor_id" with zero bookings in the database.
 * That is why this is router-level rather than seven more call sites: the next
 * handler to touch these tables must not have to know any of the above.
 *
 * Cost is one bootstrap per isolate — the service latches on `READY` and every
 * later call is a Map lookup — and it never throws, so a route needing no
 * advisor store is unaffected either way.
 */
advisors.use('*', async (c, next) => {
  await ensureAdvisorStoresSchema(c.env);
  await next();
});

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
  // Migration 205. Declared here because `bookingDto` returns them: the two
  // were on the row and off the type, so nothing complained when the DTO
  // dropped them for a year.
  amount_cents: number | null; billing_state: string;
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
/**
 * The booking as BOTH parties may see it. Deliberately no money — see
 * `advisorMoney` below for the two columns that are the advisor's alone.
 */
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

/**
 * Migration 205's two columns, for the advisor's own reads only.
 *
 * THE BUG THIS EXISTS TO FIX. Migration 205 added `amount_cents` and
 * `billing_state` to `advisor_bookings`, and `PATCH /me/bookings/:id/billing`
 * named them in its own response — but `bookingDto`, which every LIST goes
 * through, is a whitelist and never did. `GET /me/bookings` selects `b.*`, so
 * both columns arrived at the DTO and were dropped on the way out.
 *
 * `pages/advisor/practice/SessionsZone.jsx` is the page built specifically to
 * show that money. With both fields undefined it rendered "Not recorded" on
 * every row including priced ones, an empty state pill, "Set a price" where it
 * should have said "Change", and an unpriced count that disagreed with
 * Earnings — and, worst, its editor opened blank over a stored price and
 * overwrote it on save. A whitelist that silently drops a column is
 * indistinguishable from a column nobody ever wrote.
 *
 * WHY THIS IS A SEPARATE FUNCTION RATHER THAN TWO MORE LINES IN `bookingDto`.
 * Three of the five DTO call sites answer the FOUNDER or either party:
 * `POST /slots/:id/book` replies to the founder who just booked,
 * `GET /bookings/me` is the founder's own list, and `transition()` answers
 * whichever side moved the booking. Migration 205's header is explicit that
 * `billing_state` is "the advisor's own bookkeeping note about their own
 * arrangement" — no invoice is issued and Axal takes no position on
 * collection — so `written_off` reaching the client would disclose that their
 * advisor gave up collecting from them. Restoring the field to the shared DTO
 * would have fixed a display bug by opening a leak, which is why the fix is
 * scoped to the audience instead. Call this from advisor-authenticated reads;
 * never from a founder-facing one.
 *
 * `billing_state` has a NOT NULL DEFAULT, so `?? 'unpriced'` only covers a row
 * read through a path that did not select it. `amount_cents` is genuinely
 * nullable and stays null — zero is a price an advisor may actually mean.
 */
function advisorMoney(b: Partial<BookingRow>): { amount_cents: number | null; billing_state: string } {
  return {
    amount_cents: b.amount_cents ?? null,
    billing_state: b.billing_state ?? 'unpriced',
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
        ...advisorMoney(r),
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

/**
 * The two people on the booking, and nobody else.
 *
 * THIS READ HAD `requireAuth` AND NOTHING ELSE — any signed-in account could
 * name any booking id and read both sides' reviews of a session they had no
 * part in. A review carries a rating and free-text comment about a named
 * advisor by a named founder; the id is a small integer, so the whole table
 * was walkable.
 *
 * The predicate lives in the WHERE clause rather than in a branch, so "no such
 * booking" and "not yours" are the same 404 and a stranger cannot confirm a
 * booking exists. `requireOwnEngagement` answers the same way.
 */
advisors.get('/bookings/:id/reviews', async (c) => {
  try {
    const user = await requireAuth(c);
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ detail: 'Not found' }, 404);
    const mine = await c.env.DB.prepare(
      `SELECT b.id FROM advisor_bookings b
         LEFT JOIN advisors a ON a.id = b.advisor_id
        WHERE b.id = ? AND (b.founder_user_id = ? OR a.user_id = ?)`,
    ).bind(id, user.id, user.id).first<{ id: number }>();
    if (!mine && !isAdmin(user)) return c.json({ detail: 'Not found' }, 404);
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
    return c.json(bookingDto(fresh!, advisorMoney(fresh!)));
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
/**
 * Who may hold a cohort assignment, and therefore read a batch's founders.
 *
 * ONE PREDICATE, THREE CALLERS — the write that grants, the read that spends,
 * and the admin picker that offers. Three copies is how one of them drifts,
 * and the one that drifts is the one nobody notices.
 *
 * `advisor` ONLY. Not `admin`: an admin already has the Lab's own review and
 * impersonation surfaces, both audited, and letting them hold a founders-read
 * row would blur which of the two they used. Not `exploring` with an advisor
 * overlay, which is a suggestion rather than a grant.
 */
export function mayHoldCohortAssignment(u: { role: string } | null | undefined): boolean {
  return !!u && role(u) === 'advisor';
}

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
 * BOTH ARE NECESSARY, NEITHER IS SUFFICIENT — and that phrasing is deliberate,
 * because the sentence it replaces invited exactly the deletion that would
 * reopen the hole. It used to read "this returns 403 whatever the advisor's
 * role is", which reads as "the role check would be redundant". It is not.
 *
 * The ASSIGNMENT is the grant: an admin decided this person should see this
 * batch. The ROLE is the eligibility that grant presumes, and it must be
 * re-checked HERE rather than only where the row was written, because a
 * point-in-time check cannot see the future. `requireAuth` reloads the user
 * row on every request, so `user.role` is the CURRENT role — which makes this
 * check free and, more importantly, continuous. Without it an advisor who is
 * later demoted keeps an active row and keeps reading founder names and
 * emails indefinitely, with nothing anywhere recording that they still can.
 *
 * ONE COHORT AT A TIME, by cycle id, because a page must not show two batches
 * merged into one list. It reads `company_week_status`, which is the Lab's own
 * record of who is in a cycle, WITHOUT writing to it.
 */
advisors.get('/me/cohort/:cycleId/founders', async (c) => {
  try {
    const user = await requireAuth(c);
    await ensureAdvisorStoresSchema(c.env);
    // Eligibility first, then the grant. See the header.
    if (!mayHoldCohortAssignment(user)) {
      return c.json({ detail: 'Only an advisor can open a cohort batch' }, 403);
    }
    const cycleId = Number(c.req.param('cycleId'));
    // Fails closed today — a NaN bind matches no assignment — but through an
    // error path nobody has read. Say what is wrong instead.
    if (!Number.isInteger(cycleId)) {
      return c.json({ detail: 'cycleId must be a cohort cycle id' }, 400);
    }
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
 * The batch's week, as the Lab records it. READ ONLY, and Lab-sourced entirely.
 *
 * SAME TWO-PART GATE AS FOUNDERS — eligibility then grant. This returns the
 * same founders' progress, so it must be no easier to reach.
 *
 * ONE ROUTE FOR THE WEEK VIEW, not two. `current_week` has to be computed in
 * one place or two pages eventually disagree about which week it is, and
 * "which week is it" is the sort of thing that looks obviously derivable right
 * up until a cycle has no `week_windows` rows at all.
 *
 * `windows_recorded: false` IS THE HONEST ANSWER for such a cycle. 156 created
 * `week_windows` and older cycles predate it. Rendering "week 1" for a cycle
 * whose windows nobody recorded would be inventing the one fact this page is
 * for. The client must treat `available: false` as unavailable, never as
 * empty — the same rule as everywhere else in this bucket.
 *
 * NO ADVISOR SLOTS ARE JOINED IN HERE, deliberately. The Cohorts · Calendar
 * card says nothing joins the Lab's dates to the advisor's own availability,
 * and that is still true. Joining them here would make that card false and
 * commit us to building the calendar; keeping this strictly Lab-sourced keeps
 * the boundary honest.
 */
advisors.get('/me/cohort/:cycleId/weeks', async (c) => {
  try {
    const user = await requireAuth(c);
    await ensureAdvisorStoresSchema(c.env);
    if (!mayHoldCohortAssignment(user)) {
      return c.json({ detail: 'Only an advisor can open a cohort batch' }, 403);
    }
    const cycleId = Number(c.req.param('cycleId'));
    if (!Number.isInteger(cycleId)) {
      return c.json({ detail: 'cycleId must be a cohort cycle id' }, 400);
    }
    const assignment = await c.env.DB.prepare(
      `SELECT id FROM advisor_cohort_assignments
        WHERE advisor_user_id = ? AND cohort_cycle_id = ? AND is_active = 1`
    ).bind(user.id, cycleId).first<{ id: number }>();
    if (!assignment) {
      return c.json({ detail: 'You are not assigned to this cohort' }, 403);
    }

    // Lab tables. A missing one answers `available: false` rather than
    // throwing — the precedent `/spinout-lab/fund-metrics` sets — because an
    // advisor cannot act on a stack trace and an empty list would be a lie.
    try {
      const cycle = await c.env.DB.prepare(
        'SELECT year, month, start_at, end_at, status FROM cohort_cycles WHERE id = ?'
      ).bind(cycleId).first<{
        year: number; month: number; start_at: string; end_at: string; status: string;
      }>();
      if (!cycle) return c.json({ detail: 'No such cohort cycle' }, 404);

      const windows = await c.env.DB.prepare(
        `SELECT week_number, unlock_at, deadline_at FROM week_windows
          WHERE cohort_cycle_id = ? ORDER BY week_number ASC`
      ).bind(cycleId).all<{ week_number: number; unlock_at: string; deadline_at: string }>();
      const weeks = windows.results || [];

      const statuses = await c.env.DB.prepare(
        `SELECT w.user_id AS user_id, w.week_number AS week_number, w.status AS status,
                w.deliverables_done AS deliverables_done,
                w.deliverables_required AS deliverables_required,
                u.name AS name
           FROM company_week_status w
           LEFT JOIN users u ON u.id = w.user_id
          WHERE w.cohort_cycle_id = ?
          ORDER BY u.name ASC, w.week_number ASC
          LIMIT 1000`
      ).bind(cycleId).all<{
        user_id: number; week_number: number; status: string;
        deliverables_done: number; deliverables_required: number; name: string | null;
      }>();

      const byFounder = new Map<number, any>();
      for (const r of statuses.results || []) {
        if (!byFounder.has(r.user_id)) {
          byFounder.set(r.user_id, { user_id: r.user_id, name: r.name ?? null, weeks: {} });
        }
        byFounder.get(r.user_id).weeks[r.week_number] = {
          status: r.status,
          deliverables_done: r.deliverables_done,
          deliverables_required: r.deliverables_required,
        };
      }

      // Which week the batch is in, computed once, server-side, from the
      // windows the Lab actually recorded. `null` when there are none — see
      // the header.
      const now = Date.now();
      let currentWeek: number | null = null;
      for (const w of weeks) {
        if (new Date(w.unlock_at).getTime() <= now) currentWeek = w.week_number;
      }

      return c.json({
        available: true,
        cohort_cycle_id: cycleId,
        // Seam-marked on the wire, the way the founders read already is.
        source: 'spinout_lab',
        server_time: nowIso(),
        cycle,
        windows_recorded: weeks.length > 0,
        current_week: currentWeek,
        weeks,
        founders: [...byFounder.values()],
      });
    } catch (e) {
      console.error('[advisors] cohort weeks read failed:', (e as Error).message);
      return c.json({
        available: false,
        cohort_cycle_id: cycleId,
        detail: 'The Lab\u2019s week record could not be read.',
      });
    }
  } catch (e) { return mapError(c, e); }
});

/**
 * THE SAME TWO-PART GATE THE THREE ROUTES BELOW ALL USE.
 *
 * Extracted rather than repeated: eligibility (`mayHoldCohortAssignment`, the
 * CURRENT role, re-read by `requireAuth` on every request so a demoted advisor
 * loses access immediately) AND the active assignment row (an admin's grant).
 * The founders handler above explains at length why neither is sufficient
 * alone; three more copies of that reasoning would be three places to get it
 * wrong.
 */
async function requireOwnCohort(
  c: Context<{ Bindings: Env }>, user: User, cycleId: number,
): Promise<Response | null> {
  if (!mayHoldCohortAssignment(user)) {
    return c.json({ detail: 'Only an advisor can open a cohort batch' }, 403);
  }
  if (!Number.isInteger(cycleId)) {
    return c.json({ detail: 'cycleId must be a cohort cycle id' }, 400);
  }
  const assignment = await c.env.DB.prepare(
    `SELECT id FROM advisor_cohort_assignments
      WHERE advisor_user_id = ? AND cohort_cycle_id = ? AND is_active = 1`
  ).bind(user.id, cycleId).first<{ id: number }>();
  if (!assignment) return c.json({ detail: 'You are not assigned to this cohort' }, 403);
  return null;
}

/**
 * Cohorts · Guidance — what was said to the batch, and who acted on it.
 *
 * MIGRATION 212 IS THE ONLY NEW STORE IN THIS PASS, and this is the card it
 * answers: "nothing records a piece of guidance addressed to a batch, and
 * nothing records a founder acting on one."
 *
 * WHAT THE COUNTS DO NOT INCLUDE. There is no `overdue`. The canvas draws one
 * against "your 24h commitment"; nothing stores a commitment and no advisor has
 * been asked for one, so deriving 24h from a designer's example would report
 * someone as having broken a promise they never made. `oldest_open_hours` is
 * the fact underneath it — how long the longest-waiting question has actually
 * waited — and the page says the commitment is not recorded.
 *
 * `median_response_hours` is null when nothing has been answered, never 0. See
 * `_advisor_cohort_helpers.ts`.
 */
advisors.get('/me/cohort/:cycleId/guidance', async (c) => {
  try {
    const user = await requireAuth(c);
    await ensureAdvisorStoresSchema(c.env);
    await ensureCohortGuidanceSchema(c.env);
    const cycleId = Number(c.req.param('cycleId'));
    const refused = await requireOwnCohort(c, user as User, cycleId);
    if (refused) return refused;

    const rows = await c.env.DB.prepare(
      `SELECT id, uid, asked_by_user_id, body, answer, answered_at,
              week_number, posted_at, retired_at
         FROM cohort_guidance
        WHERE cohort_cycle_id = ? AND advisor_user_id = ?
        ORDER BY posted_at DESC, id DESC
        LIMIT 200`
    ).bind(cycleId, user.id).all<GuidanceRow & {
      uid: string; body: string; week_number: number | null;
    }>();
    const items = rows.results || [];

    // Who acted, by name — the card's second sentence. A count would answer
    // "how many" and lose "who", which is the thing an advisor with twelve
    // founders actually needs.
    const acks = await c.env.DB.prepare(
      `SELECT k.guidance_id AS guidance_id, k.founder_user_id AS founder_user_id,
              k.acted_at AS acted_at, u.name AS name
         FROM cohort_guidance_acks k
         JOIN cohort_guidance g ON g.id = k.guidance_id
         LEFT JOIN users u ON u.id = k.founder_user_id
        WHERE g.cohort_cycle_id = ? AND g.advisor_user_id = ?`
    ).bind(cycleId, user.id).all<{
      guidance_id: number; founder_user_id: number; acted_at: string; name: string | null;
    }>();
    const ackBy = new Map<number, Array<{ user_id: number; name: string | null; acted_at: string }>>();
    for (const a of acks.results || []) {
      if (!ackBy.has(a.guidance_id)) ackBy.set(a.guidance_id, []);
      ackBy.get(a.guidance_id)!.push({ user_id: a.founder_user_id, name: a.name, acted_at: a.acted_at });
    }

    return c.json({
      cohort_cycle_id: cycleId,
      counts: guidanceCounts(items),
      oldest_open_hours: oldestOpenHours(items, nowIso()),
      // Named so no reader mistakes its absence for zero.
      commitment_hours: null,
      items: items.map((r) => ({
        ...r,
        kind: r.asked_by_user_id == null ? 'broadcast' : 'question',
        acted_by: ackBy.get(r.id) || [],
      })),
    });
  } catch (e) { return mapError(c, e); }
});

advisors.post('/me/cohort/:cycleId/guidance', async (c) => {
  try {
    const user = await requireAuth(c);
    await ensureAdvisorStoresSchema(c.env);
    await ensureCohortGuidanceSchema(c.env);
    const cycleId = Number(c.req.param('cycleId'));
    const refused = await requireOwnCohort(c, user as User, cycleId);
    if (refused) return refused;

    const b = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const body = trimOrNull(b.body);
    if (!body) return c.json({ detail: 'Guidance needs something to say' }, 400);
    // A week is optional and stays NULL when unstated: guidance about the whole
    // programme has no week, and stamping one from `posted_at` would file a
    // general note under whichever week it happened to be typed in.
    const raw = Number(b.week_number);
    const week = Number.isInteger(raw) && raw >= 1 && raw <= 52 ? raw : null;

    const uid = newUid();
    await c.env.DB.prepare(
      `INSERT INTO cohort_guidance (uid, cohort_cycle_id, advisor_user_id, body, week_number)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(uid, cycleId, user.id, body, week).run();
    return c.json({ uid, body, week_number: week }, 201);
  } catch (e) { return mapError(c, e); }
});

advisors.patch('/me/guidance/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    await ensureAdvisorStoresSchema(c.env);
    await ensureCohortGuidanceSchema(c.env);
    const uid = String(c.req.param('uid') || '');
    // Ownership is the advisor column on the row itself — the assignment may
    // since have been withdrawn, and guidance already written must still be
    // editable by the person who wrote it and nobody else.
    const row = await c.env.DB.prepare(
      'SELECT id, cohort_cycle_id FROM cohort_guidance WHERE uid = ? AND advisor_user_id = ?'
    ).bind(uid, user.id).first<{ id: number; cohort_cycle_id: number }>();
    if (!row) return c.json({ detail: 'Guidance not found' }, 404);

    const b = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const body = trimOrNull(b.body);
    const answer = trimOrNull(b.answer);
    const retire = b.retired === true ? nowIso() : b.retired === false ? null : undefined;
    if (body === null && answer === null && retire === undefined) {
      return c.json({ detail: 'Nothing to change' }, 400);
    }
    if (body !== null) {
      await c.env.DB.prepare(
        "UPDATE cohort_guidance SET body = ?, updated_at = datetime('now') WHERE id = ?"
      ).bind(body, row.id).run();
    }
    if (answer !== null) {
      // `answered_at` is stamped with the answer and never separately: the
      // median response time is the gap between the two, so a stamp without a
      // reply would report an answer nobody wrote.
      await c.env.DB.prepare(
        "UPDATE cohort_guidance SET answer = ?, answered_at = ?, updated_at = datetime('now') WHERE id = ?"
      ).bind(answer, nowIso(), row.id).run();
    }
    if (retire !== undefined) {
      await c.env.DB.prepare(
        "UPDATE cohort_guidance SET retired_at = ?, updated_at = datetime('now') WHERE id = ?"
      ).bind(retire, row.id).run();
    }
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

/**
 * Cohorts · Calendar — the Lab's dates and the advisor's own slots, joined.
 *
 * THE CARD SAID "both halves exist and nothing joins them", AND IT WAS RIGHT.
 * This is the join, and it needs no migration: `week_windows` has held the
 * Lab's unlock/deadline pairs since migration 156, and the advisor's slots and
 * bookings have existed since T13.
 *
 * THE WEEKS ROUTE ABOVE DELIBERATELY DOES NOT DO THIS. Its comment says so —
 * "NO ADVISOR SLOTS ARE JOINED IN HERE, deliberately… joining them here would
 * make that card false". The join belongs on the zone the card is about, which
 * is this one, and the weeks route stays Lab-sourced entirely.
 *
 * MISSING PREP IS NOT COMPUTED. The canvas draws "Missing prep · session
 * without a brief"; nothing stores a brief, so the tile reads not-recorded
 * rather than counting every session as unprepared.
 */
advisors.get('/me/cohort/:cycleId/calendar', async (c) => {
  try {
    const user = await requireAuth(c);
    await ensureAdvisorStoresSchema(c.env);
    const cycleId = Number(c.req.param('cycleId'));
    const refused = await requireOwnCohort(c, user as User, cycleId);
    if (refused) return refused;

    const cycle = await c.env.DB.prepare(
      'SELECT year, month, start_at, end_at, status FROM cohort_cycles WHERE id = ?'
    ).bind(cycleId).first<{
      year: number; month: number; start_at: string; end_at: string; status: string;
    }>();
    if (!cycle) return c.json({ detail: 'No such cohort cycle' }, 404);

    const items: CalendarItem[] = [];

    // The Lab's half. A cycle predating migration 156 has no windows at all,
    // and `windows_recorded: false` is the honest answer for it — the same rule
    // the weeks route states. Rendering an empty calendar would say the batch
    // has no obligations, which is the one thing this page must not claim.
    const windows = await c.env.DB.prepare(
      `SELECT week_number, unlock_at, deadline_at FROM week_windows
        WHERE cohort_cycle_id = ? ORDER BY week_number ASC`
    ).bind(cycleId).all<{ week_number: number; unlock_at: string; deadline_at: string }>()
      .catch(() => ({ results: [] as Array<{ week_number: number; unlock_at: string; deadline_at: string }> }));
    const weekRows = windows.results || [];
    for (const w of weekRows) {
      items.push({
        kind: 'cohort', title: `Week ${w.week_number} opens`,
        starts_at: w.unlock_at, ends_at: null, ref: `week:${w.week_number}:unlock`,
      });
      items.push({
        kind: 'cohort', title: `Week ${w.week_number} deliverables due`,
        starts_at: w.deadline_at, ends_at: null, ref: `week:${w.week_number}:deadline`,
      });
    }
    if (cycle.end_at) {
      items.push({
        kind: 'demo_day', title: 'Demo Day', starts_at: cycle.end_at, ends_at: null,
        ref: `cycle:${cycleId}:end`,
      });
    }

    // The advisor's half — booked sessions only. An unbooked slot is
    // availability, not an obligation, and putting it on the same calendar as a
    // deadline would make a free afternoon look like a commitment.
    // `advisor_id`, not production's legacy `mentor_id`:
    // `ensureAdvisorStoresSchema` above renames it on first touch, so by the
    // time this runs the column has the name the whole repository uses. Writing
    // `mentor_id` here would be correct today and wrong the moment the rename
    // lands, and would fail `check-sqlite-columns` against the repo's own DDL.
    //
    // `advisors.id` is the owner, NOT `users.id`: slots are keyed on the
    // advisor PROFILE row, which is what `POST /me/slots` binds (`m.id` from
    // `myAdvisor`). Passing the user id would return an empty calendar for
    // every advisor whose two ids differ, which is all of them.
    const me = await myAdvisor(c.env, user as User);
    const booked = me ? await c.env.DB.prepare(
      `SELECT s.id AS slot_id, s.starts_at AS starts_at, s.ends_at AS ends_at,
              b.topic AS topic, u.name AS founder_name
         FROM advisor_bookings b
         JOIN advisor_office_hour_slots s ON s.id = b.slot_id
         LEFT JOIN users u ON u.id = b.founder_user_id
        WHERE s.advisor_id = ? AND s.is_cancelled = 0
          AND b.status IN ('pending', 'confirmed')
        ORDER BY s.starts_at ASC
        LIMIT 200`
    ).bind(me.id).all<{
      slot_id: number; starts_at: string; ends_at: string;
      topic: string | null; founder_name: string | null;
    }>() : { results: [] as Array<{
      slot_id: number; starts_at: string; ends_at: string;
      topic: string | null; founder_name: string | null;
    }> };
    for (const s of booked.results || []) {
      items.push({
        kind: 'client',
        title: s.topic || (s.founder_name ? `Session with ${s.founder_name}` : 'Booked session'),
        starts_at: s.starts_at, ends_at: s.ends_at, ref: `slot:${s.slot_id}`,
      });
    }

    const now = nowIso();
    const upcoming = withinDays(items, now, 14);
    const clashes = collisions(upcoming);
    return c.json({
      cohort_cycle_id: cycleId,
      windows_recorded: weekRows.length > 0,
      items: upcoming,
      collisions: clashes.map(([a, b]) => ({ a: upcoming[a].ref, b: upcoming[b].ref })),
      counts: {
        next_14_days: upcoming.length,
        cohort_obligations: upcoming.filter((i) => i.kind !== 'client').length,
        collisions: clashes.length,
        // Nothing stores a session brief, so this is not a zero.
        missing_prep: null,
      },
    });
  } catch (e) { return mapError(c, e); }
});

/**
 * Expertise · Thinking — what this advisor has published.
 *
 * THE CARD WAS WRONG AND IS REPLACED. It said `articles` "has no advisor owner,
 * no reach figure and no record of where a piece ran", and that listing them
 * "would require a join that does not exist". Checked against production:
 * `articles.author_user_id` is NOT NULL and `articles.views` is a real counter
 * incremented on every published read (`routes/articles.ts:320`), non-zero on
 * four published pieces today. Two of the three claims were false; only the
 * third — where a piece ran — is a genuine absence, and the zone states it.
 *
 * OWN DRAFTS ARE INCLUDED, which is why this is not just the public
 * `/articles/by-author/:user_id`. That endpoint filters `status = 'published'`
 * because it serves a public profile. An advisor looking at their own thinking
 * needs the drafts too, and only their own — hence the authenticated route with
 * `author_user_id = user.id` rather than a path parameter anyone could change.
 */
advisors.get('/me/thinking', async (c) => {
  try {
    const user = await requireAuth(c);
    if (role(user) !== 'advisor') {
      return c.json({ detail: 'Only an advisor has a thinking shelf' }, 403);
    }
    const rows = await c.env.DB.prepare(
      `SELECT id, slug, title, subtitle, status, published_at, word_count,
              read_minutes, views, sector, created_at, updated_at
         FROM articles
        WHERE author_user_id = ?
        ORDER BY COALESCE(published_at, created_at) DESC
        LIMIT 100`
    ).bind(user.id).all<{
      id: number; slug: string; title: string; subtitle: string | null;
      status: string; published_at: string | null; word_count: number;
      read_minutes: number; views: number; sector: string | null;
    }>().catch(() => ({ results: [] as any[] }));
    const items = rows.results || [];
    const published = items.filter((a) => a.status === 'published');
    const reach = published.map((a) => Number(a.views || 0));
    return c.json({
      items,
      counts: {
        published: published.length,
        drafts: items.filter((a) => a.status !== 'published').length,
        // Real reach, from a counter the product actually increments.
        best_reach: reach.length ? Math.max(...reach) : null,
        total_reach: reach.length ? reach.reduce((s, n) => s + n, 0) : null,
        // "Where it ran" — the one claim on the old card that WAS true.
        // Nothing records an external publication or a talk, so no number.
        talk_reach: null,
      },
    });
  } catch (e) { return mapError(c, e); }
});

/**
 * Admin: the users who may actually be assigned.
 *
 * Same predicate as the write, so the picker can only ever offer what the POST
 * will accept. Putting the eligibility rule in the UI instead would give two
 * answers to one question.
 */
advisors.get('/admin/cohort-assignments/assignable', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!isAdmin(user)) return c.json({ detail: 'Admin required' }, 403);
    await ensureAdvisorStoresSchema(c.env);
    const rows = await c.env.DB.prepare(
      `SELECT u.id AS id, u.name AS name, u.email AS email, a.id AS advisor_profile_id
         FROM users u
         LEFT JOIN advisors a ON a.user_id = u.id
        WHERE LOWER(u.role) = 'advisor'
        ORDER BY u.name ASC
        LIMIT 500`
    ).all<{ id: number; name: string | null; email: string | null; advisor_profile_id: number | null }>();
    return c.json({
      items: (rows.results || []).map((r) => ({
        id: r.id, name: r.name ?? null, email: r.email ?? null,
        // An advisor with no profile row can still hold an assignment — 206
        // keys on users(id) precisely so a newly created account is
        // assignable. Reported so an admin knows what they are looking at.
        has_advisor_profile: r.advisor_profile_id != null,
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
      // `advisor_role` is the target's CURRENT role, not the one they had when
      // the row was written. That is what turns this list from a log into
      // something that can answer "who has access who should not": a still
      // active row beside a role that is no longer advisor is exactly the case
      // the read now refuses, and an admin needs to see it to end it.
      `SELECT a.id AS id, a.uid AS uid, a.advisor_user_id AS advisor_user_id,
              a.cohort_cycle_id AS cohort_cycle_id, a.assigned_at AS assigned_at,
              a.unassigned_at AS unassigned_at, a.is_active AS is_active,
              a.note AS note, u.name AS advisor_name, u.email AS advisor_email,
              u.role AS advisor_role
         FROM advisor_cohort_assignments a
         LEFT JOIN users u ON u.id = a.advisor_user_id
        ORDER BY a.assigned_at DESC
        LIMIT 500`
    ).all<{
      id: number; uid: string; advisor_user_id: number; cohort_cycle_id: number;
      assigned_at: string; unassigned_at: string | null; is_active: number;
      note: string | null; advisor_name: string | null; advisor_email: string | null;
      advisor_role: string | null;
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
    // `role` was SELECTed here from the day this shipped and never read, so the
    // only check was that the id existed. The parameter is named
    // `advisor_user_id`; accepting any user made that name a lie, and removed
    // the one thing that would catch a mistyped id that happens to exist — a
    // typo becoming a grant of another cohort's founder names and emails.
    //
    // 400 rather than 403: the caller IS authorised — they are an admin. What
    // is wrong is the subject they named, which is a bad request, and matches
    // the 400 this handler already returns for a malformed id.
    if (!mayHoldCohortAssignment(target)) {
      return c.json({
        detail: 'Only a user with the advisor role can be assigned a cohort',
      }, 400);
    }
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

// ---------------------------------------------------------------------------
// 238 — Engagements. The contract behind the sessions, and whether it renewed.
//
// WHY THESE ARE FOUR VERBS AND NOT ONE PATCH. `advisor_engagements` carries
// three fields nothing else in the product has — `lane`, `cycles` and
// `outcome` — and the renewal rate is computed from the last two. A single
// merge-PATCH over all three would let a caller set `outcome = 'renewed'`
// without a cycle behind it, or clear a cycle without a decision, and the
// instrument the artboard calls "the number that judges a practice" would be
// whatever the last writer typed. So the descriptive columns merge freely
// through PATCH, and the two columns the rate reads move ONLY through
// `/advance` (a lane) and `/renewal` (a decision), each with its own rules.
//
// THE ONE TRANSITION THAT IS REFUSED is signed → ended through `/advance`.
// Ending a signed contract IS the renewal decision that did not go the
// advisor's way, and routing it through the lane verb would drop it out of
// the denominator — the exact failure the canvas names: "a rate that excludes
// its failures is not a rate." Ending an UNSIGNED row is allowed there and
// records no outcome, because an abandoned draft never had a renewal to lose.
// ---------------------------------------------------------------------------
export const ENGAGEMENT_LANES = ['drafting', 'proposed', 'signed', 'renewal_due', 'ended'];
export const ENGAGEMENT_SHAPES = ['retainer', 'sprint', 'equity', 'per_call'];
/** The two lanes that mean "under contract" — what the Active tile counts. */
const SIGNED_LANES = new Set(['signed', 'renewal_due']);

type EngagementRow = {
  id: number; uid: string; advisor_id: number;
  founder_user_id: number | null; client_name: string;
  lane: string; shape: string;
  scope_label: string | null; scope_includes: string | null; scope_excludes: string | null;
  amount_cents: number | null;
  proposed_at: string | null; started_at: string | null;
  term_ends_at: string | null; ended_at: string | null;
  cycles: number; outcome: string | null; renewal_note: string | null;
  created_at: string; updated_at: string;
};

function engagementDto(r: EngagementRow): any {
  return {
    id: r.id, uid: r.uid, advisor_id: r.advisor_id,
    // NULL means the client is not (or not yet) a platform user. The name is
    // what the board renders either way — see migration 238's header.
    founder_user_id: r.founder_user_id ?? null,
    client_name: r.client_name,
    lane: r.lane, shape: r.shape,
    scope_label: r.scope_label, scope_includes: r.scope_includes, scope_excludes: r.scope_excludes,
    // Not zero. An advisory relationship with no amount recorded has not been
    // declared free, and an equity engagement has no cents by its nature.
    amount_cents: r.amount_cents ?? null,
    proposed_at: r.proposed_at, started_at: r.started_at,
    term_ends_at: r.term_ends_at, ended_at: r.ended_at,
    cycles: Number(r.cycles || 0),
    // NULL until the row is signed. The fixture's placeholder 'Active' on an
    // unsent draft is the thing this deliberately does not reproduce.
    outcome: r.outcome ?? null,
    renewal_note: r.renewal_note,
    created_at: r.created_at, updated_at: r.updated_at,
  };
}

/** YYYY-MM-DD, or null. A malformed date is dropped rather than stored. */
function engagementDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) ? s : null;
}

/**
 * One engagement of the caller's own, or a thrown 404.
 *
 * NOT 403, and not "check the id then load it": the row is loaded by id and
 * the advisor is compared afterwards, so an engagement belonging to another
 * advisor is indistinguishable from one that does not exist. `mapError` passes
 * a thrown Response through untouched, which is why this can answer 404 from
 * inside a helper at all.
 */
async function requireOwnEngagement(
  c: Context<{ Bindings: Env }>, advisorId: number, id: number,
): Promise<EngagementRow> {
  const row = await c.env.DB.prepare('SELECT * FROM advisor_engagements WHERE id = ?')
    .bind(id).first<EngagementRow>();
  if (!row || row.advisor_id !== advisorId) {
    throw c.json({ detail: 'Engagement not found' }, 404);
  }
  return row;
}

/**
 * A client link — an account this advisor ALREADY HAS A RELATIONSHIP WITH, or
 * null.
 *
 * THIS USED TO ACCEPT ANY EXISTING `users.id`, and that was wrong in both
 * directions at once. An advisor has no way to learn another account's numeric
 * id, so the column was unusable by a human; and an advisor who guessed one
 * could attach a stranger's account to their own contract, then open a message
 * thread with them through Delivery's nudge. A write that is simultaneously
 * unreachable and over-trusting is not a link, it is a hole.
 *
 * THE RELATIONSHIP IS THE PERMISSION, and it is one of two facts the product
 * already records: the account has BOOKED this advisor, or it has OPENED A
 * RECORD to them (an active grant from migration 218). Either means the two
 * people have met in this product; neither can be manufactured by the advisor
 * alone. `DocumentShares` on the founder side settled this shape first —
 * "offering an address the API would refuse is how a control teaches the wrong
 * model" — so the picker on Engagements offers exactly this set.
 *
 * AN UNRELATED ACCOUNT RESOLVES TO NULL rather than erroring, which is the
 * behaviour a dangling id already had: the engagement keeps its client NAME and
 * simply stays unsendable. One rule, one outcome, and no new error path on the
 * two routes that call this.
 *
 * `m.user_id` IS NULLABLE, so the grant half is skipped rather than compared
 * against null — an advisor record with no account behind it has no grants by
 * definition, and `advisor_user_id = NULL` would match nothing while reading as
 * though it might.
 */
async function engagementClientUser(env: Env, m: AdvisorRow, v: unknown): Promise<number | null> {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) return null;
  const u = await env.DB.prepare(
    `SELECT u.id FROM users u
      WHERE u.id = ?
        AND (EXISTS (SELECT 1 FROM advisor_bookings b
                      WHERE b.advisor_id = ? AND b.founder_user_id = u.id)
          OR EXISTS (SELECT 1 FROM advisor_client_grants g
                      WHERE g.advisor_user_id = ? AND g.granted_by_user_id = u.id
                        AND g.status = 'active'
                        AND (g.expires_at IS NULL OR g.expires_at > datetime('now'))))`
  ).bind(n, m.id, m.user_id ?? -1).first<{ id: number }>();
  return u ? Number(u.id) : null;
}

advisors.get('/me/engagements', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const rows = await c.env.DB.prepare(
      `SELECT * FROM advisor_engagements WHERE advisor_id = ?
        ORDER BY updated_at DESC LIMIT 400`
    ).bind(m.id).all<EngagementRow>();
    const items = (rows.results || []).map(engagementDto);

    // THE RATE IS COMPUTED HERE RATHER THAN ON THE PAGE, because its
    // denominator is the whole argument. `decided` counts renewals that went
    // either way and nothing else: a signed contract still running has made no
    // decision, and an unsent draft never had one to make.
    const renewed = items.filter((e) => e.outcome === 'renewed').length;
    const ended = items.filter((e) => e.outcome === 'ended').length;
    const decided = renewed + ended;
    return c.json({
      items,
      totals: {
        // Lanes, not outcomes — the canvas is explicit that a draft never sent
        // and a proposal awaiting an answer are not engagements.
        active: items.filter((e) => SIGNED_LANES.has(e.lane)).length,
        renewal_due: items.filter((e) => e.lane === 'renewal_due').length,
        ended_lane: items.filter((e) => e.lane === 'ended').length,
        renewed, ended, decided,
        // Null, never 0%. A practice that has not yet reached a renewal has
        // not failed to renew, and 0% would say it had.
        renewal_rate: decided > 0 ? Math.round((renewed / decided) * 100) : null,
        // What the Active tile's breakdown note ("2 retainers, 1 sprint…")
        // reads from.
        by_shape: ENGAGEMENT_SHAPES.reduce((acc, s) => {
          acc[s] = items.filter((e) => SIGNED_LANES.has(e.lane) && e.shape === s).length;
          return acc;
        }, {} as Record<string, number>),
      },
    });
  } catch (e) { return mapError(c, e); }
});

advisors.post('/me/engagements', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const body = await c.req.json().catch(() => ({} as any));
    const clientName = String(body.client_name || '').trim().slice(0, 200);
    // The one required field. A contract board row with no client is a card
    // nobody can act on, and the column is NOT NULL for the same reason.
    if (!clientName) return c.json({ detail: 'An engagement needs a client name' }, 400);
    const shape = String(body.shape || 'retainer').trim();
    if (!ENGAGEMENT_SHAPES.includes(shape)) {
      return c.json({ detail: `shape must be one of: ${ENGAGEMENT_SHAPES.join(', ')}` }, 400);
    }
    // A row is BORN DRAFTING. Signing is a transition with its own stamps and
    // its own cycle, so letting a caller open one straight into 'signed' would
    // mean two code paths for the same event and one of them would drift.
    const now = nowIso();
    const uid = newUid();
    const r = await c.env.DB.prepare(
      `INSERT INTO advisor_engagements
         (uid, advisor_id, founder_user_id, client_name, lane, shape,
          scope_label, scope_includes, scope_excludes, amount_cents,
          term_ends_at, cycles, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'drafting', ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    ).bind(
      uid, m.id, await engagementClientUser(c.env, m, body.founder_user_id), clientName, shape,
      trimOrNull(body.scope_label, 200), trimOrNull(body.scope_includes, 2000),
      trimOrNull(body.scope_excludes, 2000), parsePriceCents(body.amount_cents),
      engagementDate(body.term_ends_at), now, now,
    ).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM advisor_engagements WHERE id = ?')
      .bind((r as any).meta?.last_row_id).first<EngagementRow>();
    return c.json(engagementDto(fresh!), 201);
  } catch (e) { return mapError(c, e); }
});

// PATCH — the descriptive columns only. `lane`, `cycles` and `outcome` are
// absent by design; see the block comment above.
advisors.patch('/me/engagements/:id', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const row = await requireOwnEngagement(c, m.id, Number(c.req.param('id')));
    const body = await c.req.json().catch(() => ({} as any));
    const shape = body.shape == null ? row.shape : String(body.shape).trim();
    if (!ENGAGEMENT_SHAPES.includes(shape)) {
      return c.json({ detail: `shape must be one of: ${ENGAGEMENT_SHAPES.join(', ')}` }, 400);
    }
    await c.env.DB.prepare(
      `UPDATE advisor_engagements
          SET client_name = ?, founder_user_id = ?, shape = ?, scope_label = ?,
              scope_includes = ?, scope_excludes = ?, amount_cents = ?,
              term_ends_at = ?, updated_at = ?
        WHERE id = ?`
    ).bind(
      // Merge, not replace: the board edits one field at a time, and an empty
      // client name would blank a card rather than rename it.
      String(body.client_name ?? '').trim().slice(0, 200) || row.client_name,
      'founder_user_id' in body
        ? await engagementClientUser(c.env, m, body.founder_user_id) : row.founder_user_id,
      shape,
      'scope_label' in body ? trimOrNull(body.scope_label, 200) : row.scope_label,
      'scope_includes' in body ? trimOrNull(body.scope_includes, 2000) : row.scope_includes,
      'scope_excludes' in body ? trimOrNull(body.scope_excludes, 2000) : row.scope_excludes,
      'amount_cents' in body ? parsePriceCents(body.amount_cents) : row.amount_cents,
      'term_ends_at' in body ? engagementDate(body.term_ends_at) : row.term_ends_at,
      nowIso(), row.id,
    ).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM advisor_engagements WHERE id = ?')
      .bind(row.id).first<EngagementRow>();
    return c.json(engagementDto(fresh!));
  } catch (e) { return mapError(c, e); }
});

/**
 * POST /me/engagements/:id/advance — move a card between lanes.
 *
 * A CONTROL RATHER THAN A DRAG, and the divergence is deliberate. The canvas
 * labels the board "By contract state · drag to advance"; a per-card control
 * is keyboard-reachable without a drag-and-drop implementation to make
 * accessible, and the state change it writes is identical.
 */
advisors.post('/me/engagements/:id/advance', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const row = await requireOwnEngagement(c, m.id, Number(c.req.param('id')));
    const body = await c.req.json().catch(() => ({} as any));
    const lane = String(body.lane || '').trim();
    if (!ENGAGEMENT_LANES.includes(lane)) {
      return c.json({ detail: `lane must be one of: ${ENGAGEMENT_LANES.join(', ')}` }, 400);
    }
    // Ended is terminal, the same rule `portfolio_support.ts` applies to a
    // delivered promise: re-opening one would let a recorded outcome be
    // quietly un-recorded, and the renewal rate is exactly what that would
    // falsify.
    if (row.lane === 'ended') {
      return c.json({ detail: 'an engagement that has ended cannot change lane' }, 409);
    }
    if (lane === 'ended' && SIGNED_LANES.has(row.lane)) {
      return c.json({
        detail: 'a signed engagement ends through a renewal decision — POST /me/engagements/:id/renewal with decision "ended"',
      }, 409);
    }

    const now = nowIso();
    const day = now.slice(0, 10);
    const signing = SIGNED_LANES.has(lane) && !SIGNED_LANES.has(row.lane);
    await c.env.DB.prepare(
      `UPDATE advisor_engagements
          SET lane = ?, proposed_at = ?, started_at = ?, ended_at = ?,
              cycles = ?, outcome = ?, updated_at = ?
        WHERE id = ?`
    ).bind(
      lane,
      lane === 'proposed' ? (engagementDate(body.proposed_at) || day) : row.proposed_at,
      signing ? (row.started_at || engagementDate(body.started_at) || day) : row.started_at,
      // Only an UNSIGNED row can reach 'ended' here — the signed case was
      // refused above — so this stamps an abandoned draft and nothing else.
      lane === 'ended' ? (row.ended_at || day) : row.ended_at,
      // The first term begins at signing. `max` rather than `+ 1` so a lane
      // correction (renewal_due → signed and back) cannot inflate the count.
      signing ? Math.max(Number(row.cycles || 0), 1) : row.cycles,
      // Signing is what gives a row an outcome to have. Ending an unsigned one
      // leaves it NULL, which is what keeps an abandoned draft out of the
      // renewal rate's denominator.
      signing ? (row.outcome || 'active') : row.outcome,
      now, row.id,
    ).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM advisor_engagements WHERE id = ?')
      .bind(row.id).first<EngagementRow>();
    return c.json(engagementDto(fresh!));
  } catch (e) { return mapError(c, e); }
});

/**
 * POST /me/engagements/:id/renewal — record the decision the practice is
 * judged on.
 *
 * This is the only writer of `outcome` after signing and the only thing that
 * moves `cycles` past 1, which is what makes the renewal rate mean something.
 * It refuses an unsigned row rather than inventing a decision for it.
 */
advisors.post('/me/engagements/:id/renewal', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const row = await requireOwnEngagement(c, m.id, Number(c.req.param('id')));
    const body = await c.req.json().catch(() => ({} as any));
    const decision = String(body.decision || '').trim();
    if (decision !== 'renewed' && decision !== 'ended') {
      return c.json({ detail: 'decision must be "renewed" or "ended"' }, 400);
    }
    if (!SIGNED_LANES.has(row.lane)) {
      return c.json({
        detail: row.lane === 'ended'
          ? 'this engagement has already ended'
          : 'only a signed engagement has a renewal to decide',
      }, 409);
    }

    const now = nowIso();
    const day = now.slice(0, 10);
    const renewed = decision === 'renewed';
    await c.env.DB.prepare(
      `UPDATE advisor_engagements
          SET lane = ?, cycles = ?, outcome = ?, renewal_note = ?,
              term_ends_at = ?, ended_at = ?, updated_at = ?
        WHERE id = ?`
    ).bind(
      renewed ? 'signed' : 'ended',
      // A renewal starts a term, so it adds one. Ending does not: the term
      // that just ran was already counted when it began.
      renewed ? Number(row.cycles || 0) + 1 : row.cycles,
      decision,
      // One note column, because the artboard draws one — migration 238's
      // header records why there is no separate end_reason beside it.
      'note' in body ? trimOrNull(body.note, 2000) : row.renewal_note,
      renewed ? engagementDate(body.term_ends_at) : row.term_ends_at,
      renewed ? row.ended_at : (row.ended_at || day),
      now, row.id,
    ).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM advisor_engagements WHERE id = ?')
      .bind(row.id).first<EngagementRow>();
    return c.json(engagementDto(fresh!));
  } catch (e) { return mapError(c, e); }
});

// ---------------------------------------------------------------------------
// 239 — Deliverables. What you sent a client, and whether they opened it.
//
// TWO INVARIANTS HOLD THIS WHOLE ZONE UP, and both are here rather than on the
// page, because a page can only report what the routes let it be told.
//
// ONE: NO ROUTE IN THIS FILE WRITES `opened_at`. Migration 208's header states
// the rule this store inherits — "Only the founder side can truthfully say a
// thing was read, so a partner-side write to either would be the firm reporting
// a metric about itself." The founder side writes it, through
// `routes/advisor_grants.ts`. A receipt the advisor can set is not a receipt,
// and three of the four tiles on this zone are receipts.
//
// TWO: SENDING REQUIRES A CLIENT WITH AN ACCOUNT. A version sent to a client
// who cannot sign in can never be opened by anyone, so it would sit in
// `Unopened` forever, inflate `Never opened`, and quietly bias `median to open`
// toward whichever clients happen to be linked. Creating and versioning stay
// open to any client — a draft needs no counterparty — and only the send
// demands one, with a 409 that names what is missing. Same shape as the
// engagement block above refusing signed → ended and naming the renewal route.
//
// STATE IS DERIVED AND THERE IS NO COLUMN FOR IT: `not_started` (nothing sent),
// `sent` (sent, unopened), `opened`. See 239's header for why storing it would
// reproduce D70's `investor_introductions` defect.
// ---------------------------------------------------------------------------
type DeliverableRow = {
  id: number; uid: string; advisor_id: number;
  engagement_id: number | null; client_name: string; title: string;
  created_at: string; updated_at: string;
};
type VersionRow = {
  id: number; uid: string; deliverable_id: number; version: number;
  label: string | null; summary: string | null; link_url: string | null;
  sent_at: string | null; opened_at: string | null; signed_off_at: string | null;
  created_at: string; updated_at: string;
};

/** `not_started` | `sent` | `opened`, from the stamps alone. */
export function deliverableState(versions: Pick<VersionRow, 'sent_at' | 'opened_at'>[]): string {
  if (versions.some((v) => v.opened_at)) return 'opened';
  if (versions.some((v) => v.sent_at)) return 'sent';
  return 'not_started';
}

function versionDto(r: VersionRow): any {
  return {
    uid: r.uid, version: Number(r.version), label: r.label, summary: r.summary,
    link_url: r.link_url,
    // All three are null until they happen. Never coalesced to a date.
    sent_at: r.sent_at, opened_at: r.opened_at, signed_off_at: r.signed_off_at,
    created_at: r.created_at, updated_at: r.updated_at,
  };
}

/**
 * One deliverable of the caller's own, or a thrown 404 — `requireOwnEngagement`
 * one table over, and 404 for the same reason: loading by id and comparing the
 * advisor afterwards makes someone else's row indistinguishable from one that
 * does not exist.
 */
async function requireOwnDeliverable(
  c: Context<{ Bindings: Env }>, advisorId: number, id: number,
): Promise<DeliverableRow> {
  const row = await c.env.DB.prepare('SELECT * FROM advisor_deliverables WHERE id = ?')
    .bind(id).first<DeliverableRow>();
  if (!row || row.advisor_id !== advisorId) {
    throw c.json({ detail: 'Deliverable not found' }, 404);
  }
  return row;
}

/** Hours between two stamps, or null if either is missing or unparseable. */
function hoursBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return (b - a) / 3600000;
}

/** The middle value, or null for an empty set — never 0. */
function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((x, y) => x - y);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

advisors.get('/me/deliverables', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const [rows, versions] = await Promise.all([
      // The client's ACCOUNT AND ADDRESS come through the engagement, and only
      // for a linked one. This is what lets the zone offer a nudge over exactly
      // the rows it can reach, rather than a bulk action that silently skips
      // some of them.
      c.env.DB.prepare(
        `SELECT d.*, e.founder_user_id AS client_user_id,
                u.name AS client_user_name, u.email AS client_user_email
           FROM advisor_deliverables d
           LEFT JOIN advisor_engagements e ON e.id = d.engagement_id
           LEFT JOIN users u ON u.id = e.founder_user_id
          WHERE d.advisor_id = ?
          ORDER BY d.updated_at DESC
          LIMIT 400`
      ).bind(m.id).all<DeliverableRow & {
        client_user_id: number | null; client_user_name: string | null; client_user_email: string | null;
      }>(),
      c.env.DB.prepare(
        `SELECT v.* FROM advisor_deliverable_versions v
           JOIN advisor_deliverables d ON d.id = v.deliverable_id
          WHERE d.advisor_id = ?
          ORDER BY v.deliverable_id, v.version DESC`
      ).bind(m.id).all<VersionRow>(),
    ]);

    const byDeliverable = new Map<number, VersionRow[]>();
    for (const v of versions.results || []) {
      const list = byDeliverable.get(Number(v.deliverable_id)) || [];
      list.push(v);
      byDeliverable.set(Number(v.deliverable_id), list);
    }

    const items = (rows.results || []).map((d) => {
      const vs = byDeliverable.get(Number(d.id)) || [];
      const latest = vs[0] || null;   // the SELECT orders version DESC
      return {
        id: d.id, uid: d.uid, advisor_id: d.advisor_id,
        engagement_id: d.engagement_id ?? null,
        client_name: d.client_name, title: d.title,
        // NULL means this client has no account, so nothing they are sent can
        // ever be opened. The zone says so rather than showing a stuck row.
        client_user_id: d.client_user_id ?? null,
        client_user_name: d.client_user_name ?? null,
        client_user_email: d.client_user_email ?? null,
        state: deliverableState(vs),
        version_count: vs.length,
        latest_version: latest ? versionDto(latest) : null,
        versions: vs.map(versionDto),
        created_at: d.created_at, updated_at: d.updated_at,
      };
    });

    const sent = items.filter((i) => i.state === 'sent' || i.state === 'opened');
    const unopened = items.filter((i) => i.state === 'sent');
    // THE MEASUREMENT, and unlike Opportunities' median this one is real: both
    // stamps exist, so there is no need to substitute a last-touched column.
    // Measured on the FIRST open of each deliverable, because a second version
    // read later says nothing about how fast the work reached its reader.
    const openHours = items
      .map((i) => {
        const opened = [...i.versions].reverse().find((v) => v.opened_at);
        return opened ? hoursBetween(opened.sent_at, opened.opened_at) : null;
      })
      .filter((h): h is number => h != null);
    const medianHours = median(openHours);
    // The oldest thing that went out and was never read by anyone — no
    // threshold, which is what keeps this from being an arbitrary rule.
    const neverOpened = unopened
      .map((i) => ({ title: i.title, client_name: i.client_name, sent_at: i.latest_version?.sent_at || null }))
      .sort((a, b) => String(a.sent_at || '').localeCompare(String(b.sent_at || '')));

    return c.json({
      items,
      totals: {
        work_products: items.length,
        clients: new Set(items.map((i) => i.client_name)).size,
        sent: sent.length,
        unopened: unopened.length,
        opened: items.filter((i) => i.state === 'opened').length,
        drafts: items.filter((i) => i.state === 'not_started').length,
        // Null, never 0. Nothing opened yet is not "opened instantly" (D56/D68).
        median_to_open_hours: medianHours == null ? null : Math.round(medianHours * 10) / 10,
        never_opened: neverOpened.length,
        oldest_never_opened: neverOpened[0] || null,
        // How many rows a nudge could actually reach. The zone reports the gap
        // rather than skipping rows quietly.
        addressable: unopened.filter((i) => i.client_user_email).length,
      },
    });
  } catch (e) { return mapError(c, e); }
});

advisors.post('/me/deliverables', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const body = await c.req.json().catch(() => ({} as any));
    const title = String(body.title || '').trim().slice(0, 200);
    if (!title) return c.json({ detail: 'A work product needs a title' }, 400);

    // The client comes from the engagement when one is named, so the two cannot
    // disagree about who this is for; otherwise it is typed.
    let clientName = String(body.client_name || '').trim().slice(0, 200);
    let engagementId: number | null = null;
    if (body.engagement_id != null && body.engagement_id !== '') {
      const eng = await requireOwnEngagement(c, m.id, Number(body.engagement_id));
      engagementId = eng.id;
      clientName = eng.client_name;
    }
    if (!clientName) return c.json({ detail: 'A work product needs a client' }, 400);

    const now = nowIso();
    const uid = newUid();
    const r = await c.env.DB.prepare(
      `INSERT INTO advisor_deliverables
         (uid, advisor_id, engagement_id, client_name, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(uid, m.id, engagementId, clientName, title, now, now).run();
    const id = Number((r as any).meta?.last_row_id);
    // VERSION 1 COMES WITH IT. A work product with no version is a title, and
    // every read here assumes at least one row to be the latest.
    await c.env.DB.prepare(
      `INSERT INTO advisor_deliverable_versions
         (uid, deliverable_id, version, label, summary, link_url, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?)`
    ).bind(newUid(), id, trimOrNull(body.label, 60), trimOrNull(body.summary, 2000),
           trimOrNull(body.link_url, 2000), now, now).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM advisor_deliverables WHERE id = ?')
      .bind(id).first<DeliverableRow>();
    return c.json({ ...fresh, state: 'not_started', version_count: 1 }, 201);
  } catch (e) { return mapError(c, e); }
});

advisors.patch('/me/deliverables/:id', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const row = await requireOwnDeliverable(c, m.id, Number(c.req.param('id')));
    const body = await c.req.json().catch(() => ({} as any));
    let engagementId = row.engagement_id;
    let clientName = row.client_name;
    if ('engagement_id' in body) {
      if (body.engagement_id == null || body.engagement_id === '') engagementId = null;
      else {
        const eng = await requireOwnEngagement(c, m.id, Number(body.engagement_id));
        engagementId = eng.id;
        clientName = eng.client_name;
      }
    }
    if ('client_name' in body && engagementId == null) {
      clientName = String(body.client_name ?? '').trim().slice(0, 200) || row.client_name;
    }
    await c.env.DB.prepare(
      `UPDATE advisor_deliverables
          SET title = ?, engagement_id = ?, client_name = ?, updated_at = ?
        WHERE id = ?`
    ).bind(
      String(body.title ?? '').trim().slice(0, 200) || row.title,
      engagementId, clientName, nowIso(), row.id,
    ).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM advisor_deliverables WHERE id = ?')
      .bind(row.id).first<DeliverableRow>();
    return c.json(fresh);
  } catch (e) { return mapError(c, e); }
});

/**
 * POST /me/deliverables/:id/versions — the next version of a work product.
 *
 * The ordinal is `MAX(version) + 1` read inside the same request, and the
 * table's `UNIQUE (deliverable_id, version)` is what turns a lost race into an
 * error rather than two rows both calling themselves v3.
 */
advisors.post('/me/deliverables/:id/versions', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const row = await requireOwnDeliverable(c, m.id, Number(c.req.param('id')));
    const body = await c.req.json().catch(() => ({} as any));
    const top = await c.env.DB.prepare(
      'SELECT MAX(version) AS v FROM advisor_deliverable_versions WHERE deliverable_id = ?'
    ).bind(row.id).first<{ v: number | null }>();
    const next = Number(top?.v || 0) + 1;
    const now = nowIso();
    const uid = newUid();
    await c.env.DB.prepare(
      `INSERT INTO advisor_deliverable_versions
         (uid, deliverable_id, version, label, summary, link_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(uid, row.id, next, trimOrNull(body.label, 60), trimOrNull(body.summary, 2000),
           trimOrNull(body.link_url, 2000), now, now).run();
    await c.env.DB.prepare('UPDATE advisor_deliverables SET updated_at = ? WHERE id = ?')
      .bind(now, row.id).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM advisor_deliverable_versions WHERE uid = ?')
      .bind(uid).first<VersionRow>();
    return c.json(versionDto(fresh!), 201);
  } catch (e) { return mapError(c, e); }
});

/**
 * POST /me/deliverables/:id/versions/:version/send — it went to the client.
 *
 * REFUSES A CLIENT WITH NO ACCOUNT, with a 409 that names the link. See the
 * block comment at the top of this section: a version nobody can open would
 * poison three of this zone's four tiles, and the alternative — letting the
 * advisor claim it was opened — is the one thing this store exists to prevent.
 */
advisors.post('/me/deliverables/:id/versions/:version/send', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const row = await requireOwnDeliverable(c, m.id, Number(c.req.param('id')));
    const version = Number(c.req.param('version'));
    const v = await c.env.DB.prepare(
      'SELECT * FROM advisor_deliverable_versions WHERE deliverable_id = ? AND version = ?'
    ).bind(row.id, version).first<VersionRow>();
    if (!v) return c.json({ detail: 'Version not found' }, 404);
    if (v.sent_at) return c.json({ detail: 'That version has already been sent' }, 409);

    const client = row.engagement_id == null ? null : await c.env.DB.prepare(
      `SELECT u.id FROM advisor_engagements e
         JOIN users u ON u.id = e.founder_user_id
        WHERE e.id = ? AND e.advisor_id = ?`
    ).bind(row.engagement_id, m.id).first<{ id: number }>();
    if (!client) {
      return c.json({
        detail: 'Link this work product to an engagement whose client has an Axal account before sending — nothing an unlinked client is sent can ever be recorded as opened',
      }, 409);
    }

    const now = nowIso();
    await c.env.DB.prepare(
      'UPDATE advisor_deliverable_versions SET sent_at = ?, updated_at = ? WHERE id = ?'
    ).bind(now, now, v.id).run();
    await c.env.DB.prepare('UPDATE advisor_deliverables SET updated_at = ? WHERE id = ?')
      .bind(now, row.id).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM advisor_deliverable_versions WHERE id = ?')
      .bind(v.id).first<VersionRow>();
    return c.json(versionDto(fresh!));
  } catch (e) { return mapError(c, e); }
});

// ---------------------------------------------------------------------------
// 239, the client's half — the receipt an advisor cannot write
// ---------------------------------------------------------------------------
/**
 * THE WHOLE POINT OF THESE TWO ROUTES is that `opened_at` has no advisor-side
 * writer and never will. Migration 208's header, inherited by 239, states the
 * rule: `opened_at` and `signed_off_at` are the CLIENT's to set, because only
 * the founder side can truthfully say a thing was read — an advisor-side write
 * would be the practice reporting a metric about itself. `/me/deliverables`
 * reports three tiles that stay null until a founder acts here.
 *
 * THEY SIT IN THIS FILE RATHER THAN `advisor_grants.ts`, AND THE SCHEMA IS WHY:
 * no grant is involved. The relationship that carries a deliverable is the
 * ENGAGEMENT, so a grant-scoped route would hide every work product from a
 * founder who never opened a record — which is most of them. This router already
 * holds the founder-facing half of the advisor surface (`/`, `/match`, `/:uid`,
 * `/:uid/slots`, `/slots/:id/book`, `/bookings/:id/*`), all `requireAuth` with
 * no advisor profile, and these join it.
 */

/**
 * GET /received/deliverables — what my advisors have sent me.
 *
 * SENT VERSIONS ONLY, and that is a privacy rule rather than a filter. A version
 * with no `sent_at` is the advisor's draft: they created it, they have not handed
 * it over, and a client who could see it would be reading work in progress. A
 * deliverable whose every version is unsent does not appear at all.
 */
advisors.get('/received/deliverables', async (c) => {
  try {
    const user = await requireAuth(c);
    await ensureAdvisorStoresSchema(c.env);
    const rows = await c.env.DB.prepare(
      `SELECT d.id, d.uid, d.title, d.client_name, d.created_at, d.updated_at,
              a.display_name AS advisor_name, a.uid AS advisor_uid
         FROM advisor_deliverables d
         JOIN advisor_engagements e ON e.id = d.engagement_id
         JOIN advisors a ON a.id = d.advisor_id
        WHERE e.founder_user_id = ?
          AND EXISTS (SELECT 1 FROM advisor_deliverable_versions v
                       WHERE v.deliverable_id = d.id AND v.sent_at IS NOT NULL)
        ORDER BY d.updated_at DESC LIMIT 200`
    ).bind(user.id).all<any>();

    const items = [] as any[];
    for (const d of rows.results || []) {
      const vs = await c.env.DB.prepare(
        `SELECT * FROM advisor_deliverable_versions
          WHERE deliverable_id = ? AND sent_at IS NOT NULL
          ORDER BY version DESC`
      ).bind(d.id).all<VersionRow>();
      const versions = (vs.results || []).map(versionDto);
      items.push({
        uid: d.uid, title: d.title,
        advisor_name: d.advisor_name, advisor_uid: d.advisor_uid,
        // DERIVED BY THE SAME FUNCTION THE ADVISOR'S PAGE READS, so the two
        // sides can never disagree about what "opened" means. `not_started` is
        // unreachable here by construction — every row has a sent version — and
        // that is worth leaving to the shared helper rather than re-deriving a
        // two-state version of it that would drift.
        state: deliverableState(versions),
        version_count: versions.length,
        versions,
        updated_at: d.updated_at,
      });
    }
    return c.json({
      items,
      totals: {
        work_products: items.length,
        unread: items.filter((i) => i.state === 'sent').length,
        advisors: new Set(items.map((i) => i.advisor_uid)).size,
      },
    });
  } catch (e) { return mapError(c, e); }
});

/**
 * POST /received/deliverables/:uid/open — the receipt, stamped once.
 *
 * FIRST OPEN WINS, AND THE SQL IS WHAT ENFORCES IT: `WHERE opened_at IS NULL`
 * on the UPDATE, not a read-then-write in the handler. A founder reloading the
 * page cannot move the stamp, and two concurrent opens cannot race one past the
 * other. The second call is not an error — reading something twice never is — so
 * it returns the row with the original stamp intact.
 *
 * A DRAFT CANNOT BE OPENED. `sent_at IS NOT NULL` is in the scope query, so a
 * version the advisor never sent answers 404 like anyone else's: without it a
 * founder could stamp a deliverable nobody handed them, and `median_to_open` on
 * the advisor's page would be measuring an interval that never happened.
 *
 * 404, NEVER 403, for a version belonging to someone else's engagement — the
 * `requireOwnDeliverable` reasoning from PR3a, one table further out. Comparing
 * after the load is what makes another client's row indistinguishable from one
 * that does not exist.
 */
advisors.post('/received/deliverables/:uid/open', async (c) => {
  try {
    const user = await requireAuth(c);
    await ensureAdvisorStoresSchema(c.env);
    const v = await c.env.DB.prepare(
      `SELECT v.* FROM advisor_deliverable_versions v
         JOIN advisor_deliverables d ON d.id = v.deliverable_id
         JOIN advisor_engagements e ON e.id = d.engagement_id
        WHERE v.uid = ? AND e.founder_user_id = ? AND v.sent_at IS NOT NULL`
    ).bind(c.req.param('uid'), user.id).first<VersionRow>();
    if (!v) return c.json({ detail: 'Work product not found' }, 404);

    const now = nowIso();
    await c.env.DB.prepare(
      'UPDATE advisor_deliverable_versions SET opened_at = ?, updated_at = ? WHERE id = ? AND opened_at IS NULL'
    ).bind(now, now, v.id).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM advisor_deliverable_versions WHERE id = ?')
      .bind(v.id).first<VersionRow>();
    return c.json(versionDto(fresh!));
  } catch (e) { return mapError(c, e); }
});

export default advisors;
