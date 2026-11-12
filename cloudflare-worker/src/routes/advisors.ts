import { holdsLicence } from '../services/accountLicences';
import { actsForAdvisor, mayActAsAdvisor, ADVISOR_LICENCE_REQUIRED } from '../services/advisorAccess';
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { getCurrentUser, requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { PROFILE_LIMITS, boundedList, boundedText, hourlyRate } from '../services/advisorLimits';
import { railFor, refuseRun } from '../util/railContext';
import { AI_SURFACE } from '../services/aiSurfaces';
import { MATCH_DEPS, MatchRefused, matchRows } from '../services/ai/matchRows';
import { logAdminAction } from '../services/adminAudit';
import { logActorAct } from '../services/actorLog';
import { ensureTier } from '../middleware/requireTier';
import { isAdmin, isFounder, mapError, nowIso, newUid, jload, trimOrNull } from './_t13t14t15_helpers';
import { loadUserVectors, confidenceAdjustedAlignment, skillComplementarity, computeWatchOuts } from '../services/matchingVectors';
import { ensureAdvisorStoresSchema } from '../services/advisorStoresSchema';
import { ensureNetworkStatesSchema } from '../services/networkStatesSchema';
import { derivePayoutState } from '../services/advisorMoney';
import { loadPayoutAccount } from '../services/advisorConnect';
import { advisorVisibility } from '../services/advisorVisibility';
import { canonicalInstant, isBlocked, isPaidType, ruleRefusal, rulesFromRow, weekBounds } from '../services/advisorBookingRules';
import { pageFacts, pageWindow } from '../services/listPage';
import {
  type AdvisorRow, type BookingOffer, type BookingRow, advisorMoney, bookingDto, myAdvisor, parsePriceCents, requireMyAdvisor, sentRevision, validationRefusal,
} from '../services/advisorPractice';
import advisorServicesRoutes, { publishedAdvisorServices } from './advisors_services';
import advisorProofRoutes, { publishedAdvisorProof } from './advisors_proof';
import advisorMoneyRoutes from './advisors_money';
import advisorCohortsRoutes from './advisors_cohorts';
import advisorEngagementsRoutes from './advisors_engagements';
import advisorDeliverablesRoutes from './advisors_deliverables';

/** The request's execution context, or none where the runtime gives none (a test's request). */
const execCtx = (c: any) => { try { return c.executionCtx; } catch { return undefined; } };
const BOOKINGS_PAGE = 200;

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
  await ensureNetworkStatesSchema(c.env);
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
type SlotRow = {
  id: number; uid: string; advisor_id: number;
  starts_at: string; ends_at: string; capacity: number;
  meeting_url: string | null; notes: string | null;
  is_cancelled: number; created_at: string;
  /** Migration 240: set when the advisor withdrew the hour. A blocked slot is not cancelled and is not bookable (D4695). */
  blocked_reason?: string | null;
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
/**
 * #4715 — an advisor as the directory and the match list show them to another
 * member. The account's email is the advisor's own; the public profile
 * (`GET /:uid`) never carried it either. `id` and `user_id` stay: the pages key
 * advisors by `id`, and the trust badge and booking button read `user_id`.
 */
function directoryAdvisorDto(m: AdvisorRow): any {
  const { email: _email, ...listed } = advisorDto(m);
  return listed;
}
/**
 * #4715 — a slot as anyone but its advisor sees it. The meeting link and the
 * advisor's slot notes are for the advisor and for a founder whose booking on
 * the slot was confirmed; to everyone else a slot says only whether it has a
 * link (`has_meeting_link`), which is all the booking page shows.
 */
function publicSlotDto(s: SlotRow, taken = 0): any {
  const { meeting_url: _url, notes: _notes, ...shown } = slotDto(s, taken);
  return { ...shown, has_meeting_link: !!s.meeting_url };
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
export function offerSnapshot(t: {
  id: number; name: string; duration_minutes: number | null; cadence_note?: string | null;
  price_cents: number | null; is_free_intro: number | boolean; is_included?: number | boolean | null;
} | null): BookingOffer | null {
  if (!t) return null;
  const pricing = t.is_free_intro ? 'free' : t.is_included ? 'included' : t.price_cents == null ? 'unset' : 'price';
  return {
    session_type_id: t.id, name: t.name, duration_minutes: t.duration_minutes ?? null,
    pricing, price_cents: pricing === 'price' ? Number(t.price_cents) : null,
    cadence_note: t.cadence_note ?? null,
  };
}

async function loadAdvisorByUid(env: Env, uid: string): Promise<AdvisorRow | null> {
  return env.DB.prepare('SELECT * FROM advisors WHERE uid = ?').bind(uid).first<AdvisorRow>();
}
async function loadAdvisorById(env: Env, id: number): Promise<AdvisorRow | null> {
  return env.DB.prepare('SELECT * FROM advisors WHERE id = ?').bind(id).first<AdvisorRow>();
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
/** D976: true while an admin has paused this advisor in the network. */
async function advisorPaused(env: Env, advisorId: number): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS paused FROM advisors v JOIN network_member_states nms ON nms.user_id = v.user_id
      WHERE v.id = ? AND nms.paused_at IS NOT NULL LIMIT 1`
  ).bind(advisorId).first<{ paused: number }>();
  return !!row;
}

advisors.get('/', async (c) => {
  try {
    await requireAuth(c);
    const q = (c.req.query('q') || '').trim().toLowerCase();
    const sector = (c.req.query('sector') || '').trim().toLowerCase();
    const expertise = (c.req.query('expertise') || '').trim().toLowerCase();
    // D976: a paused advisor, or one an admin hid from the directory, is not listed.
    const rows = await c.env.DB.prepare(
      `SELECT * FROM advisors WHERE is_active = 1
         AND NOT EXISTS (SELECT 1 FROM network_member_states nms WHERE nms.user_id = advisors.user_id
           AND (nms.paused_at IS NOT NULL OR nms.directory_hidden_at IS NOT NULL))
       ORDER BY display_name ASC`
    ).all<AdvisorRow>();
    let items = (rows.results || []).map(directoryAdvisorDto);
    if (q) items = items.filter((m: any) =>
      (m.display_name || '').toLowerCase().includes(q) ||
      (m.bio || '').toLowerCase().includes(q));
    if (sector) items = items.filter((m: any) =>
      (m.sectors || []).map((s: string) => s.toLowerCase()).includes(sector));
    if (expertise) items = items.filter((m: any) =>
      (m.expertise || []).map((s: string) => s.toLowerCase()).includes(expertise));
    if (c.req.query('free_only') === '1') items = items.filter((m: any) => m.hourly_rate_usd === 0);
    const maxRate = c.req.query('max_rate');
    if (maxRate !== undefined) {
      if (!Number.isFinite(Number(maxRate)) || Number(maxRate) < 0) return c.json({ detail: 'Invalid maximum rate' }, 400);
      items = items.filter((m: any) => m.hourly_rate_usd != null && m.hourly_rate_usd <= Number(maxRate));
    }
    return c.json({ items });
  } catch (e) { return mapError(c, e); }
});

advisors.get('/me', async (c) => {
  try {
    const user = await requireAuth(c);
    // D4670: someone who holds no Advisor licence is refused, so "you may not"
    // never reads as "you have no profile yet" (null, below).
    if (!mayHoldAdvisorProfile(user)) return refuse(c, 403, ADVISOR_LICENCE_REQUIRED);
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
 * This is the one thing that must not be got wrong. Core profile fields and the expanded fields both preserve omissions.
 * Explicit null still clears nullable text and rates. The seven below are written by different surfaces at
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
    return boundedText(key, v, max);
  };
  const list = (key: string, col: keyof AdvisorRow): string | null => {
    if (!(key in body)) return (existing?.[col] as string | null) ?? null;
    const v = body[key];
    // Null clears the answer entirely; an empty array is a recorded empty
    // answer. Storing '[]' for both would lose which one the advisor meant.
    if (v == null) return null;
    return JSON.stringify(boundedList(key, v));
  };
  return {
    headline: text('headline', PROFILE_LIMITS.headline),
    stages_json: list('stages', 'stages_json'),
    languages_json: list('languages', 'languages_json'),
    country: text('country', PROFILE_LIMITS.country),
    timezone: text('timezone', PROFILE_LIMITS.timezone),
    availability_note: text('availability_note', PROFILE_LIMITS.availability_note),
    headshot_url: text('headshot_url', PROFILE_LIMITS.headshot_url),
  };
}

/**
 * D4670 (#4670): only an Advisor (a primary or an additional licence, D4472)
 * or an admin may create or change an advisor profile. Before, a founder's
 * POST created an active profile, because `myAdvisor` answered null for them
 * and null read as "make one".
 */
const mayHoldAdvisorProfile = mayActAsAdvisor;

advisors.post('/me', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!mayHoldAdvisorProfile(user)) return refuse(c, 403, ADVISOR_LICENCE_REQUIRED);
    await ensureAdvisorStoresSchema(c.env);
    const body = await c.req.json().catch(() => ({} as any));
    const existing = await myAdvisor(c.env, user);
    // D4674: every limit is checked on the value as sent, and a value over it is
    // refused with the field named; nothing is cut and reported as saved. Only
    // the keys the body names are written (below), so two edits to different
    // fields cannot overwrite one another, and a `revision` makes an edit to the
    // same record conditional on it not having moved since it was read.
    const has = (k: string) => k in body;
    const display_name = has('display_name') || !existing
      ? boundedText('display_name', body.display_name || user.name || user.email, PROFILE_LIMITS.display_name)
      : existing.display_name;
    if (!display_name) return refuse(c, 400, { code: 'display_name_required', message: 'A profile needs a display name.' });
    const bio = has('bio') ? boundedText('bio', body.bio, PROFILE_LIMITS.bio) : (existing?.bio ?? null);
    const linkedin_url = has('linkedin_url') ? boundedText('linkedin_url', body.linkedin_url, PROFILE_LIMITS.linkedin_url) : (existing?.linkedin_url ?? null);
    const hourly_rate_usd = has('hourly_rate_usd') ? hourlyRate(body.hourly_rate_usd) : (existing?.hourly_rate_usd ?? null);
    const expertise_json = has('expertise') ? JSON.stringify(boundedList('expertise', body.expertise)) : (existing?.expertise_json ?? '[]');
    const sectors_json = has('sectors') ? JSON.stringify(boundedList('sectors', body.sectors)) : (existing?.sectors_json ?? '[]');
    const p = mergeProfileFields(existing, body);
    const now = nowIso();
    if (existing) {
      const revision = sentRevision(body);
      const flag = (k: string) => (has(k) ? 1 : 0);
      const r = await c.env.DB.prepare(
        `UPDATE advisors SET
           display_name = CASE WHEN ? = 1 THEN ? ELSE display_name END, email = ?,
           bio = CASE WHEN ? = 1 THEN ? ELSE bio END,
           expertise_json = CASE WHEN ? = 1 THEN ? ELSE expertise_json END,
           sectors_json = CASE WHEN ? = 1 THEN ? ELSE sectors_json END,
           linkedin_url = CASE WHEN ? = 1 THEN ? ELSE linkedin_url END,
           hourly_rate_usd = CASE WHEN ? = 1 THEN ? ELSE hourly_rate_usd END,
           headline = CASE WHEN ? = 1 THEN ? ELSE headline END,
           stages_json = CASE WHEN ? = 1 THEN ? ELSE stages_json END,
           languages_json = CASE WHEN ? = 1 THEN ? ELSE languages_json END,
           country = CASE WHEN ? = 1 THEN ? ELSE country END,
           timezone = CASE WHEN ? = 1 THEN ? ELSE timezone END,
           availability_note = CASE WHEN ? = 1 THEN ? ELSE availability_note END,
           headshot_url = CASE WHEN ? = 1 THEN ? ELSE headshot_url END,
           updated_at = ?
         WHERE id = ? AND (? IS NULL OR updated_at = ?)`
      ).bind(
        flag('display_name'), display_name, user.email,
        flag('bio'), bio, flag('expertise'), expertise_json, flag('sectors'), sectors_json,
        flag('linkedin_url'), linkedin_url, flag('hourly_rate_usd'), hourly_rate_usd,
        flag('headline'), p.headline, flag('stages'), p.stages_json, flag('languages'), p.languages_json,
        flag('country'), p.country, flag('timezone'), p.timezone,
        flag('availability_note'), p.availability_note, flag('headshot_url'), p.headshot_url,
        now, existing.id, revision, revision,
      ).run();
      if (Number((r as any).meta?.changes ?? 1) === 0) {
        const current = await loadAdvisorById(c.env, existing.id);
        return c.json({
          error: 'revision_conflict',
          message: 'This profile was changed somewhere else after you opened it. It is shown as it now stands; nothing of yours was saved.',
          current: current ? advisorDto(current) : null,
        }, 409);
      }
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
  } catch (e) { return validationRefusal(c, e) ?? mapError(c, e); }
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

    // Load all active advisors the directory lists (D976: not paused, not hidden)
    const rows = await c.env.DB.prepare(
      `SELECT * FROM advisors WHERE is_active = 1
         AND NOT EXISTS (SELECT 1 FROM network_member_states nms WHERE nms.user_id = advisors.user_id
           AND (nms.paused_at IS NOT NULL OR nms.directory_hidden_at IS NOT NULL))
       ORDER BY display_name ASC`
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
        advisor: directoryAdvisorDto(m),
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

// #3938 part 4 (D1478 task 4, job NE1, the advisor surface): the founder's press
// orders the advisors `GET /match` answers (same query string, so the same
// directory, pause and refinement rules) by fit with a need they type: retrieve
// (bge-m3), rank (the reranker), one line each (`services/ai/matchRows.ts`). The
// text is the advisor's own profile, never an email. Nothing here books a call.
advisors.post('/match/rank', async (c) => {
  try {
    const user = await requireAuth(c);
    const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const query = typeof b?.query === 'string' ? b.query.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
    if (!query) return refuse(c, 422, { code: 'query_missing', message: 'Say what you need an advisor for.' });
    const match = await advisors.request(`/match${new URL(c.req.url).search}`, { headers: c.req.raw.headers }, c.env, execCtx(c));
    if (!match.ok) return match;
    const items = ((await match.json()) as { items?: any[] }).items || [];
    const candidates = items.map((it) => it?.advisor).filter((a) => a?.uid).map((a) => ({
      key: String(a.uid),
      text: [
        a.headline ? String(a.headline).slice(0, 200) : null,
        Array.isArray(a.expertise) && a.expertise.length ? `Expertise: ${a.expertise.slice(0, 12).join(', ')}` : null,
        Array.isArray(a.sectors) && a.sectors.length ? `Sectors: ${a.sectors.slice(0, 8).join(', ')}` : null,
        a.bio ? String(a.bio).slice(0, 400) : null,
      ].filter(Boolean).join('. '),
    }));
    const rail = railFor(c, { page: 'Founder · Build · Advisors', option: null });
    const deps = MATCH_DEPS.make(c.env, { userId: Number(user.id), surface: AI_SURFACE.advisorMatch, rail, guardText: query }, 'NE1');
    let res;
    try { res = await matchRows(query, candidates, deps, { top: 10 }); } catch (e) {
      if (e instanceof MatchRefused) return refuseRun(c, e.result)!;
      throw e;
    }
    return c.json({ job: 'NE1', steps: res.steps, rows: res.rows.map((r) => ({ uid: r.key, position: r.position, line: r.line })) });
  } catch (e) { return mapError(c, e); }
});

advisors.get('/:uid', async (c) => {
  try {
    const m = await loadAdvisorByUid(c.env, c.req.param('uid'));
    if (!m || !m.is_active) return c.json({ detail: 'Advisor not found' }, 404);
    const types = await c.env.DB.prepare(
      'SELECT * FROM advisor_session_types WHERE advisor_id = ? AND is_active = 1 ORDER BY sort_order, id'
    ).bind(m.id).all<SessionTypeRow>();
    const links = await c.env.DB.prepare(
      `SELECT * FROM advisor_booking_links WHERE advisor_id = ? AND is_active = 1 AND audience = 'public' ORDER BY id`
    ).bind(m.id).all<BookingLinkRow>();
    const { email: _email, user_id: _userId, id: _id, ...profile } = advisorDto(m);
    return c.json({ ...profile, session_types: (types.results || []).map(sessionTypeDto),
      booking_links: (links.results || []).map(bookingLinkDto), proof: await publishedAdvisorProof(c.env, m.id),
      services: await publishedAdvisorServices(c.env, m.id) });
  } catch (e) { return mapError(c, e); }
});

// D4687 (#4687): the owner's calendar is registered BEFORE `GET /:uid/slots`.
// Hono matches in registration order, so after it `GET /me/slots` was taken
// by `/:uid/slots` with uid='me' and answered 404 'Advisor not found'.
/**
 * THE OWNER'S VIEW OF A SLOT, and it exists because `GET /:uid/slots` must not
 * grow these three columns. That route is readable by ANY authenticated user —
 * it is how a founder browses an advisor's calendar — and `recording_state`,
 * `payment_state` and `blocked_reason` are the advisor's own operational
 * facts. A client who could see `held_unpaid` would learn that this advisor's
 * payout account is unverified, and one who could read `blocked_reason` would
 * read a private note about why an hour is not for sale. So `slotDto` stays
 * lean and this one carries the operational half.
 */
function ownSlotDto(s: SlotRow & {
  recording_state?: string; payment_state?: string; blocked_reason?: string | null;
}, taken = 0, pricing: BookedPricing = null): any {
  return {
    ...slotDto(s, taken),
    recording_state: s.recording_state ?? 'none',
    payment_state: s.payment_state ?? 'not_applicable',
    blocked_reason: s.blocked_reason ?? null,
    booked_pricing: pricing,
  };
}

/**
 * #4714 (D4714): what the active bookings on a slot were priced at, from
 * `advisor_bookings.amount_cents` (migration 205): a positive amount is
 * priced, an explicit 0 is free, NULL is unpriced. A slot whose bookings
 * disagree is 'mixed'; a slot nobody holds is null. The grid's "paid / free"
 * tile reads this, so an hour with no recorded price is never counted free.
 */
type BookedPricing = 'priced' | 'free' | 'unpriced' | 'mixed' | null;
async function bookedPricingBySlot(env: Env, advisorId: number, slotIds: number[]): Promise<Map<number, BookedPricing>> {
  const out = new Map<number, BookedPricing>();
  if (!slotIds.length) return out;
  const rows = await env.DB.prepare(
    `SELECT slot_id,
            SUM(CASE WHEN amount_cents > 0 THEN 1 ELSE 0 END) AS priced,
            SUM(CASE WHEN amount_cents = 0 THEN 1 ELSE 0 END) AS free,
            SUM(CASE WHEN amount_cents IS NULL THEN 1 ELSE 0 END) AS unpriced
       FROM advisor_bookings
      WHERE advisor_id = ? AND status IN ('pending','confirmed','completed')
        AND slot_id IN (SELECT value FROM json_each(?))
      GROUP BY slot_id`,
  ).bind(advisorId, JSON.stringify(slotIds)).all<{ slot_id: number; priced: number; free: number; unpriced: number }>();
  for (const r of rows.results || []) {
    const kinds = [r.priced > 0 && 'priced', r.free > 0 && 'free', r.unpriced > 0 && 'unpriced'].filter(Boolean) as BookedPricing[];
    out.set(Number(r.slot_id), kinds.length === 1 ? kinds[0] : kinds.length ? 'mixed' : null);
  }
  return out;
}

advisors.get('/me/slots', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    // The grid is two weeks forward by default, and the artboard's other three
    // views (Month, Past sessions, Unpaid held) are narrowings of a window
    // rather than different queries — so the window is the only parameter.
    const days = Math.min(370, Math.max(1, Number(c.req.query('days') || 14)));
    const from = c.req.query('from') || nowIso();
    const until = new Date(new Date(from).getTime() + days * 86_400_000).toISOString();
    const rows = await c.env.DB.prepare(
      `SELECT * FROM advisor_office_hour_slots
        WHERE advisor_id = ? AND starts_at >= ? AND starts_at < ?
        ORDER BY starts_at ASC LIMIT 500`
    ).bind(m.id, from, until).all<SlotRow>();
    const slots = (rows.results || []) as SlotRow[];
    const pricing = await bookedPricingBySlot(c.env, m.id, slots.map((s) => Number(s.id)));
    const items: any[] = [];
    for (const s of slots) {
      items.push(ownSlotDto(s as any, await takenForSlot(c.env, s.id), pricing.get(Number(s.id)) ?? null));
    }
    return c.json({ items, window: { from, until, days }, truncated: slots.length >= 500 });
  } catch (e) { return mapError(c, e); }
});

// ---------------------------------------------------------------------------
// Slots — owned by the advisor (`/me/slots`) or read for any advisor
// ---------------------------------------------------------------------------
/**
 * D4692: THE LIST AGREES WITH THE BOOKING. `POST /slots/:id/book` refuses a slot inside the advisor's minimum notice,
 * inside a blackout, too close to a session they already hold, and (for a paid session) in a week at its paid cap
 * (D4695). The list used to offer all of them and let the founder find out at the click. This answers the same
 * `ruleRefusal` for every slot in one pass, reading the rules once and the advisor's held sessions once.
 *
 *   unavailable_code   null, or 'min_notice' | 'blackout' | 'buffer' — what the booking would say for ANY session type
 *   paid_cap_reached   true when a paid session cannot be booked in that slot's week (a free or included one can)
 *
 * The slot is still listed (a founder can see why a time is gone); it is not hidden. The booking stays the decision.
 */
async function slotVerdicts(env: Env, advisorId: number, slots: SlotRow[]): Promise<Map<number, { unavailable_code: string | null; paid_cap_reached: boolean }>> {
  const out = new Map<number, { unavailable_code: string | null; paid_cap_reached: boolean }>();
  if (!slots.length) return out;
  const rules = rulesFromRow(await env.DB.prepare('SELECT * FROM advisor_availability_rules WHERE advisor_id = ?')
    .bind(advisorId).first<AvailabilityRow>());
  const starts = slots.map((s) => Date.parse(s.starts_at)).filter(Number.isFinite);
  const lo = new Date(Math.min(...starts) - 8 * 86_400_000).toISOString();
  const hi = new Date(Math.max(...starts) + 8 * 86_400_000).toISOString();
  const booked = (rules.buffer_minutes ?? 0) > 0 ? ((await env.DB.prepare(
    `SELECT s.id, s.starts_at, s.ends_at FROM advisor_office_hour_slots s
      WHERE s.advisor_id = ? AND s.is_cancelled = 0 AND s.starts_at >= ? AND s.starts_at < ?
        AND EXISTS (SELECT 1 FROM advisor_bookings b WHERE b.slot_id = s.id AND b.status IN ('pending','confirmed','completed'))`
  ).bind(advisorId, lo, hi).all<{ id: number; starts_at: string; ends_at: string }>()).results ?? []) : [];
  const paidStarts = rules.weekly_paid_cap != null ? ((await env.DB.prepare(
    `SELECT ps.starts_at FROM advisor_bookings pb
       JOIN advisor_office_hour_slots ps ON ps.id = pb.slot_id
       JOIN advisor_session_types pt ON pt.id = pb.session_type_id
      WHERE pb.advisor_id = ? AND pb.status IN ('pending','confirmed','completed')
        AND pt.price_cents > 0 AND pt.is_free_intro = 0 AND COALESCE(pt.is_included, 0) = 0
        AND ps.starts_at >= ? AND ps.starts_at < ?`
  ).bind(advisorId, lo, hi).all<{ starts_at: string }>()).results ?? []).map((r) => Date.parse(r.starts_at)) : [];
  const now = Date.now();
  for (const s of slots) {
    const start = Date.parse(s.starts_at);
    const week = Number.isFinite(start) ? weekBounds(start, rules.timezone) : null;
    const used = week ? paidStarts.filter((t) => t >= week.from && t < week.until).length : 0;
    const refused = ruleRefusal({
      slot: s, rules, now, paid: false, paidThisWeek: null,
      booked: booked.filter((o) => o.id !== s.id),
    });
    out.set(s.id, {
      unavailable_code: refused && refused.code !== 'slot_blocked' ? refused.code : null,
      paid_cap_reached: rules.weekly_paid_cap != null && used >= rules.weekly_paid_cap,
    });
  }
  return out;
}

advisors.get('/:uid/slots', async (c) => {
  try {
    const viewer = await requireAuth(c);
    const m = await loadAdvisorByUid(c.env, c.req.param('uid'));
    if (!m) return c.json({ detail: 'Advisor not found' }, 404);
    const upcoming = (c.req.query('upcoming_only') || 'true').toLowerCase() === 'true';
    const sql = upcoming
      ? `SELECT * FROM advisor_office_hour_slots WHERE advisor_id = ? AND is_cancelled = 0
          AND (blocked_reason IS NULL OR TRIM(blocked_reason) = '') AND ends_at >= ? ORDER BY starts_at ASC`
      : `SELECT * FROM advisor_office_hour_slots WHERE advisor_id = ?
          AND (blocked_reason IS NULL OR TRIM(blocked_reason) = '') ORDER BY starts_at DESC LIMIT 200`;
    const rows = upcoming
      ? await c.env.DB.prepare(sql).bind(m.id, nowIso()).all<SlotRow>()
      : await c.env.DB.prepare(sql).bind(m.id).all<SlotRow>();
    const slots = (rows.results || []) as SlotRow[];
    const verdicts = await slotVerdicts(c.env, m.id, slots);
    // #4715: the advisor (and an admin) see their own slots whole; a founder
    // sees the link and notes only on a slot they hold a confirmed booking on.
    // The booking verdicts ride on either shape: they name no link and no note.
    const whole = viewer.id === m.user_id || isAdmin(viewer);
    const held = new Set<number>();
    if (!whole) {
      const mine = await c.env.DB.prepare(
        `SELECT slot_id FROM advisor_bookings
          WHERE advisor_id = ? AND founder_user_id = ? AND status IN ('confirmed', 'completed')`,
      ).bind(m.id, viewer.id).all<{ slot_id: number }>();
      for (const r of mine.results || []) held.add(Number(r.slot_id));
    }
    const items: any[] = [];
    for (const s of slots) {
      const taken = await takenForSlot(c.env, s.id);
      const shown = whole || held.has(Number(s.id)) ? slotDto(s, taken) : publicSlotDto(s, taken);
      items.push({ ...shown, ...verdicts.get(s.id) });
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
    if (!String(body.starts_at || '').trim() || !String(body.ends_at || '').trim()) {
      return c.json({ detail: 'starts_at and ends_at required' }, 400);
    }
    // D4695: a slot's times are stored as the UTC instants they name, so the week, notice and buffer rules compare
    // like with like. A string that is not a date used to be stored and then never match anything.
    const starts = canonicalInstant(body.starts_at);
    const ends = canonicalInstant(body.ends_at);
    if (!starts || !ends) return c.json({ detail: 'starts_at and ends_at must be dates' }, 400);
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
    // Cancel any open bookings on this slot. D4703 (#4703): RETURNING names
    // exactly the bookings this statement cancelled, and each gets the same
    // calendar cleanup a one-at-a-time cancel does (`transition` below). The
    // bulk path used to change the status and leave every external copy in
    // the attendees' calendars.
    const cancelled = await c.env.DB.prepare(
      `UPDATE advisor_bookings SET status = 'cancelled', cancel_reason = COALESCE(cancel_reason, 'slot_cancelled'), cancelled_by = 'system', updated_at = ?
       WHERE slot_id = ? AND status IN ('pending','confirmed') RETURNING id`
    ).bind(nowIso(), id).all<{ id: number }>();
    const ids = (cancelled.results || []).map((r) => Number(r.id));
    if (ids.length) deferCalendarCancel(c, ids);
    return c.json({ ok: true, bookings_cancelled: ids.length });
  } catch (e) { return mapError(c, e); }
});

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------
async function usableBookingLink(c: Context<{ Bindings: Env }>, slug: unknown, user: User | null) {
  if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9/-]{1,98}[a-z0-9]$/.test(slug)) {
    throw c.json({ detail: 'Booking link not found' }, 404);
  }
  const link = await c.env.DB.prepare(
    'SELECT * FROM advisor_booking_links WHERE slug = ? AND is_active = 1'
  ).bind(slug).first<BookingLinkRow>();
  if (!link) throw c.json({ detail: 'Booking link not found' }, 404);
  if (link.audience === 'cohort') {
    // A cohort reference is an existing cycle ID, never a label matched loosely.
    const member = user && link.cohort_ref && /^[1-9]\d*$/.test(link.cohort_ref)
      ? await c.env.DB.prepare(
        'SELECT 1 AS present FROM company_week_status WHERE cohort_cycle_id = ? AND user_id = ? LIMIT 1'
      ).bind(Number(link.cohort_ref), user.id).first<{ present: number }>() : null;
    if (!member) throw c.json({ detail: 'Booking link not found' }, 404);
  } else if (!['public', 'private'].includes(link.audience)) {
    throw c.json({ detail: 'Booking link not found' }, 404);
  }
  const advisor = await loadAdvisorById(c.env, link.advisor_id);
  if (!advisor?.is_active) throw c.json({ detail: 'Booking link not found' }, 404);
  const type = await c.env.DB.prepare(
    'SELECT * FROM advisor_session_types WHERE id = ? AND advisor_id = ? AND is_active = 1'
  ).bind(link.session_type_id, advisor.id).first<SessionTypeRow>();
  if (!type || (!type.is_included && !type.is_free_intro && type.price_cents == null)) {
    throw c.json({ detail: 'This session type is not bookable' }, 409);
  }
  if (link.requires_payout_account) {
    const account = await loadPayoutAccount(c.env, advisor.id);
    if (!account || derivePayoutState(account) !== 'verified') {
      throw c.json({ detail: 'This booking link is waiting for a verified payout account' }, 409);
    }
  }
  return { link, advisor, type };
}

advisors.post('/booking-links/open', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({} as any));
    const user = await getCurrentUser(c);
    const { link, advisor, type } = await usableBookingLink(c, body.slug, user);
    await c.env.DB.prepare(
      'UPDATE advisor_booking_links SET opens_count = COALESCE(opens_count, 0) + 1 WHERE id = ? AND is_active = 1'
    ).bind(link.id).run();
    const { email: _email, user_id: _userId, id: _id, ...profile } = advisorDto(advisor);
    return c.json({ advisor: profile, session_type: sessionTypeDto(type),
      link: { slug: link.slug, session_type_id: link.session_type_id } });
  } catch (e) { return mapError(c, e); }
});

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
    if (!isFounder(user) && !isAdmin(user) && !isActiveLabExplorer) {
      return c.json({ detail: 'Founder role required' }, 403);
    }
    const slotId = Number(c.req.param('id'));
    const body = await c.req.json().catch(() => ({} as any));
    const slot = await c.env.DB.prepare('SELECT * FROM advisor_office_hour_slots WHERE id = ?').bind(slotId).first<SlotRow>();
    if (!slot || slot.is_cancelled) return c.json({ detail: 'Slot not available' }, 404);
    // D4695: a slot the advisor blocked is not open, whichever door the request came through. The reason is theirs and is not repeated here.
    if (isBlocked(slot)) return c.json({ detail: 'This slot is not available', code: 'slot_blocked' }, 409);
    // D976: an advisor an admin paused takes no new bookings; bookings already made stay.
    if (await advisorPaused(c.env, slot.advisor_id)) {
      return c.json({ detail: 'This advisor is not taking new bookings', code: 'advisor_paused' }, 409);
    }
    const context = body.booking_link_slug === undefined ? null
      : await usableBookingLink(c, body.booking_link_slug, user);
    if (context && context.advisor.id !== slot.advisor_id) {
      return c.json({ detail: 'Slot not available for this booking link' }, 404);
    }
    const typeId = context?.type.id ?? body.session_type_id ?? null;
    let type = context?.type ?? null;
    if (body.session_type_id != null && context && Number(body.session_type_id) !== context.type.id) {
      return c.json({ detail: 'Session type does not match the booking link' }, 400);
    }
    if (typeId != null && !type) {
      if (!Number.isSafeInteger(Number(typeId)) || Number(typeId) < 1) {
        return c.json({ detail: 'Session type not found' }, 404);
      }
      type = await c.env.DB.prepare(
        'SELECT * FROM advisor_session_types WHERE id = ? AND advisor_id = ? AND is_active = 1'
      ).bind(Number(typeId), slot.advisor_id).first<SessionTypeRow>();
      if (!type || (!type.is_included && !type.is_free_intro && type.price_cents == null)) {
        return c.json({ detail: 'This session type is not bookable' }, 409);
      }
    }
    if (!isActiveLabExplorer && context?.link.audience !== 'cohort') ensureTier(user, 'studio'); // D683: advisor booking is Raise + Grow
    if (type?.duration_minutes != null
      && (Date.parse(slot.ends_at) - Date.parse(slot.starts_at)) / 60000 !== type.duration_minutes) {
      return c.json({ detail: 'Slot length does not match this session type' }, 400);
    }
    if (type?.once_per_client) {
      const previous = await c.env.DB.prepare(
        `SELECT id FROM advisor_bookings WHERE session_type_id = ? AND founder_user_id = ? AND status != 'cancelled' LIMIT 1`
      ).bind(type.id, user.id).first<{ id: number }>();
      if (previous) return c.json({ detail: 'This session type is available once per client' }, 409);
    }
    if (new Date(slot.starts_at).getTime() < Date.now()) {
      return c.json({ detail: 'Slot is in the past' }, 400);
    }
    // D4695: a client who already holds this slot is told so, whatever its capacity (a full slot of one used to read
    // "Slot full" to the person sitting in it).
    const held = await c.env.DB.prepare('SELECT status FROM advisor_bookings WHERE slot_id = ? AND founder_user_id = ?')
      .bind(slotId, user.id).first<{ status: string }>();
    if (held && held.status !== 'cancelled') return c.json({ detail: 'Already booked this slot' }, 409);
    const taken = await takenForSlot(c.env, slotId);
    if (taken >= slot.capacity) return c.json({ detail: 'Slot full' }, 409);

    // D4695 — THE ADVISOR'S RULES, then the reservation. The rules are read here so the refusal can say which one
    // failed; the INSERT below repeats the ones that can change between this read and the write.
    const rules = rulesFromRow(await c.env.DB.prepare('SELECT * FROM advisor_availability_rules WHERE advisor_id = ?')
      .bind(slot.advisor_id).first<AvailabilityRow>());
    const paid = isPaidType(type);
    const slotStart = Date.parse(slot.starts_at);
    const week = weekBounds(slotStart, rules.timezone);
    const weekFrom = new Date(week.from).toISOString();
    const weekUntil = new Date(week.until).toISOString();
    const capped = paid && rules.weekly_paid_cap != null;
    const paidThisWeek = capped ? Number((await c.env.DB.prepare(
      `SELECT COUNT(*) AS c FROM advisor_bookings pb
         JOIN advisor_office_hour_slots ps ON ps.id = pb.slot_id
         JOIN advisor_session_types pt ON pt.id = pb.session_type_id
        WHERE pb.advisor_id = ? AND pb.status IN ('pending','confirmed','completed')
          AND pt.price_cents > 0 AND pt.is_free_intro = 0 AND COALESCE(pt.is_included, 0) = 0
          AND ps.starts_at >= ? AND ps.starts_at < ?`
    ).bind(slot.advisor_id, weekFrom, weekUntil).first<{ c: number }>())?.c ?? 0) : null;
    const nearFrom = new Date(slotStart - 2 * 86_400_000).toISOString();
    const nearUntil = new Date(Date.parse(slot.ends_at) + 2 * 86_400_000).toISOString();
    const booked = (rules.buffer_minutes ?? 0) > 0 ? ((await c.env.DB.prepare(
      `SELECT s.starts_at, s.ends_at FROM advisor_office_hour_slots s
        WHERE s.advisor_id = ? AND s.id != ? AND s.is_cancelled = 0 AND s.starts_at >= ? AND s.starts_at < ?
          AND EXISTS (SELECT 1 FROM advisor_bookings b WHERE b.slot_id = s.id AND b.status IN ('pending','confirmed','completed'))`
    ).bind(slot.advisor_id, slotId, nearFrom, nearUntil).all<{ starts_at: string; ends_at: string }>()).results ?? []) : [];
    const refused = ruleRefusal({ slot, rules, now: Date.now(), paid, paidThisWeek, booked });
    if (refused) return c.json({ detail: refused.detail, code: refused.code }, refused.status);

    // THE RESERVATION IS ONE STATEMENT. Whether the slot is still open, whether a seat is left, the weekly paid cap,
    // the session type, the link and the once-per-client rule are all decided inside the INSERT, so a block, a cancel
    // or a competing booking that lands after the reads above cannot be raced past. A client whose earlier booking
    // of this slot was cancelled takes that row over (the table is UNIQUE on slot and client), which also means a
    // client that lost a capacity contention is not left holding a cancelled row that blocks every later attempt.
    try {
      const r = await c.env.DB.prepare(
        `INSERT INTO advisor_bookings
          (uid, slot_id, advisor_id, founder_user_id, topic, notes, status, session_type_id, booking_link_id, offer_json, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM advisor_office_hour_slots s
                         WHERE s.id = ? AND s.is_cancelled = 0 AND (s.blocked_reason IS NULL OR TRIM(s.blocked_reason) = ''))
            AND (SELECT COUNT(*) FROM advisor_bookings x
                  WHERE x.slot_id = ? AND x.status IN ('pending','confirmed','completed'))
                < (SELECT capacity FROM advisor_office_hour_slots WHERE id = ?)
            AND (? IS NULL OR EXISTS (SELECT 1 FROM advisor_session_types
              WHERE id = ? AND advisor_id = ? AND is_active = 1
                AND (is_included = 1 OR is_free_intro = 1 OR price_cents IS NOT NULL)))
            AND (? IS NULL OR EXISTS (SELECT 1 FROM advisor_booking_links WHERE id = ? AND is_active = 1))
            AND (? = 0 OR NOT EXISTS (SELECT 1 FROM advisor_bookings
              WHERE session_type_id = ? AND founder_user_id = ? AND status != 'cancelled'))
            AND (? = 0 OR (SELECT COUNT(*) FROM advisor_bookings pb
                  JOIN advisor_office_hour_slots ps ON ps.id = pb.slot_id
                  JOIN advisor_session_types pt ON pt.id = pb.session_type_id
                 WHERE pb.advisor_id = ? AND pb.status IN ('pending','confirmed','completed')
                   AND pt.price_cents > 0 AND pt.is_free_intro = 0 AND COALESCE(pt.is_included, 0) = 0
                   AND ps.starts_at >= ? AND ps.starts_at < ?) < ?)
         ON CONFLICT (slot_id, founder_user_id) DO UPDATE SET
           status = 'pending', cancel_reason = NULL, topic = excluded.topic, notes = excluded.notes,
           session_type_id = excluded.session_type_id, booking_link_id = excluded.booking_link_id,
           offer_json = excluded.offer_json,
           amount_cents = NULL, billing_state = 'unpriced', created_at = excluded.created_at, updated_at = excluded.updated_at
           WHERE advisor_bookings.status = 'cancelled'`
      ).bind(newUid(), slotId, slot.advisor_id, user.id,
             (body.topic || '').toString().slice(0, 200),
             (body.notes || '').toString().slice(0, 2000),
             type?.id ?? null, context?.link.id ?? null,
             type ? JSON.stringify(offerSnapshot(type)) : null, nowIso(), nowIso(),
             slotId,
             slotId, slotId,
             type?.id ?? null, type?.id ?? null, slot.advisor_id,
             context?.link.id ?? null, context?.link.id ?? null,
             type?.once_per_client ?? 0, type?.id ?? null, user.id,
             capped ? 1 : 0, slot.advisor_id, weekFrom, weekUntil, rules.weekly_paid_cap ?? 0).run();
      if (!(r as any).meta?.changes) {
        // Nothing was written. Say which reason held, from the state as it is now.
        const mine = await c.env.DB.prepare('SELECT status FROM advisor_bookings WHERE slot_id = ? AND founder_user_id = ?')
          .bind(slotId, user.id).first<{ status: string }>();
        if (mine && mine.status !== 'cancelled') return c.json({ detail: 'Already booked this slot' }, 409);
        const now = await c.env.DB.prepare('SELECT * FROM advisor_office_hour_slots WHERE id = ?').bind(slotId).first<SlotRow>();
        if (!now || now.is_cancelled) return c.json({ detail: 'Slot not available' }, 404);
        if (isBlocked(now)) return c.json({ detail: 'This slot is not available', code: 'slot_blocked' }, 409);
        if ((await takenForSlot(c.env, slotId)) >= now.capacity) return c.json({ detail: 'Slot full' }, 409);
        if (capped) return c.json({ detail: 'This advisor has no paid sessions left that week', code: 'weekly_cap' }, 409);
        return c.json({ detail: 'The session type or booking link is no longer available' }, 409);
      }
      const b = await c.env.DB.prepare('SELECT * FROM advisor_bookings WHERE slot_id = ? AND founder_user_id = ?')
        .bind(slotId, user.id).first<BookingRow>();
      const uid = b!.uid;
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
      const rowId = Number(b!.id);
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
            // D4703 (#4703): the booking is still pending, so the external copy
            // is tentative until the advisor confirms (`/bookings/:id/confirm`
            // pushes it again as confirmed). It used to go out as a firm event.
            status: 'pending',
            ics_status: 'TENTATIVE' as const,
            location_kind: 'video',
            // #4715: the meeting link goes out with the confirmation
            // (deferCalendarConfirm), not with the request.
            location_uri: null,
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
          WHERE b.advisor_id = ? AND b.status = ? ORDER BY b.created_at DESC, b.id DESC LIMIT ? OFFSET ?`
      : `SELECT b.*, u.name AS founder_name, u.email AS founder_email,
                s.starts_at AS slot_starts_at, s.ends_at AS slot_ends_at
           FROM advisor_bookings b
           LEFT JOIN users u ON u.id = b.founder_user_id
           LEFT JOIN advisor_office_hour_slots s ON s.id = b.slot_id
          WHERE b.advisor_id = ? ORDER BY b.created_at DESC, b.id DESC LIMIT ? OFFSET ?`;
    // #4714 (D4714): a page (`?limit=&offset=`, default and most 200), with
    // `page.next_offset`, so a booking past the 200 newest can be reached.
    const w = pageWindow(c.req.query(), BOOKINGS_PAGE);
    const rows = status
      ? await c.env.DB.prepare(sql).bind(m.id, status, w.limit, w.offset).all<BookingRow>()
      : await c.env.DB.prepare(sql).bind(m.id, w.limit, w.offset).all<BookingRow>();
    // #4702: the list is the 200 newest; `total` is how many there are, so a
    // page can say "200 of 340" instead of presenting the window as the whole.
    const all = status
      ? await c.env.DB.prepare('SELECT COUNT(*) AS n FROM advisor_bookings WHERE advisor_id = ? AND status = ?').bind(m.id, status).first<{ n: number }>()
      : await c.env.DB.prepare('SELECT COUNT(*) AS n FROM advisor_bookings WHERE advisor_id = ?').bind(m.id).first<{ n: number }>();
    const totalN = Number(all?.n ?? (rows.results || []).length);
    return c.json({
      total: totalN,
      limit: w.limit,
      page: pageFacts(w, totalN, (rows.results || []).length),
      items: (rows.results || []).map((r: any) => bookingDto(r, {
        ...advisorMoney(r),
        founder_name: r.founder_name ?? null,
        founder_email: r.founder_email ?? null,
        client_user_id: r.founder_user_id,
        client_name: r.founder_name ?? null,
        client_email: r.founder_email ?? null,
        slot_starts_at: r.slot_starts_at ?? null,
        slot_ends_at: r.slot_ends_at ?? null,
        // #4702 (D4702): the advisor's own answer, and who cancelled. Null is "not
        // on record", never a guess; the acceptance rate counts only answers.
        advisor_decision: r.advisor_decision ?? null,
        advisor_decided_at: r.advisor_decided_at ?? null,
        cancelled_by: r.cancelled_by ?? null,
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

/**
 * D4703 (#4703): the calendar cleanup a cancel owes, for one booking or many,
 * deferred so the response returns at once. The slot delete and a single
 * cancel both come here, so the two cannot drift apart again.
 */
function deferCalendarCancel(c: Context<{ Bindings: Env }>, ids: number[]) {
  const p = (async () => {
    const { onAxalSessionCancelled } = await import('../services/calendar/sync');
    for (const bookingId of ids) {
      try { await onAxalSessionCancelled(c.env, 'advisor_booking', bookingId); }
      catch (e) { console.warn('[advisors] calendar cancel hook failed', e); }
    }
  })();
  if (c.executionCtx?.waitUntil) c.executionCtx.waitUntil(p);
}

/** D4703: push a confirmed booking's copy again, now firm (`ics_status: CONFIRMED`). */
function deferCalendarConfirm(c: Context<{ Bindings: Env }>, id: number) {
  const p = (async () => {
    try {
      const row = await c.env.DB.prepare(
        `SELECT b.id, b.uid, b.topic, b.notes, s.starts_at, s.ends_at, s.meeting_url,
                a.email AS advisor_email, a.display_name, u.email AS founder_email, u.name AS founder_name
           FROM advisor_bookings b
           JOIN advisor_office_hour_slots s ON s.id = b.slot_id
           JOIN advisors a ON a.id = b.advisor_id
           LEFT JOIN users u ON u.id = b.founder_user_id
          WHERE b.id = ? AND b.status = 'confirmed'`
      ).bind(id).first<any>();
      if (!row) return;
      const { onAxalSessionUpdated } = await import('../services/calendar/sync');
      await onAxalSessionUpdated(c.env, {
        id: `advisor_booking:${row.id}`, kind: 'advisor_booking', source_id: row.id, source_uid: row.uid,
        title: `Advisor session — ${row.display_name || ''}`.trim(),
        start_at: row.starts_at, end_at: row.ends_at, status: 'confirmed', ics_status: 'CONFIRMED',
        location_kind: 'video', location_uri: row.meeting_url || null, organizer_email: row.advisor_email || null,
        attendees: [
          { email: row.advisor_email || null, name: row.display_name || null, role: 'advisor' },
          { email: row.founder_email || null, name: row.founder_name || null, role: 'mentee' },
        ],
        notes: (row.topic || '') + (row.notes ? `\n\n${row.notes}` : ''),
      } as any);
    } catch (e) { console.warn('[advisors] calendar confirm hook failed', e); }
  })();
  if (c.executionCtx?.waitUntil) c.executionCtx.waitUntil(p);
}

async function transition(c: Context<{ Bindings: Env }>, id: number, opts: {
  allowed: string[]; nextStatus: string; whoCan: 'advisor' | 'founder' | 'either';
  reason?: string | null;
  /** #4702: the answer this transition records, if it is one. */
  decision?: 'accepted' | 'declined';
}) {
  const user = await requireAuth(c);
  const b = await c.env.DB.prepare('SELECT * FROM advisor_bookings WHERE id = ?').bind(id).first<BookingRow>();
  if (!b) return c.json({ detail: 'Booking not found' }, 404);
  // #4715: the advisor side is the policy's answer (licence today, owned row),
  // never the stored users.advisor_id pointer on its own.
  const isAdvisor = await actsForAdvisor(c.env, user, b.advisor_id);
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
  // D4703 (#4703): the status read above is the status this write expects.
  // Two presses at once (a cancel and a confirm, or two cancels) used to both
  // pass the check and both write; now the second changes nothing and says so.
  //
  // #4702 (D4702): the ANSWER is recorded apart from the status. Confirming is an
  // accept. A cancel by the advisor of a request still waiting is a decline. A
  // cancel by anyone of a session already accepted leaves the accept as it was,
  // and a client withdrawing a request before any answer records no answer, so
  // neither the client's cancellation nor an admin's changes the advisor's rate.
  const at = nowIso();
  const cancelledBy = opts.nextStatus === 'cancelled'
    ? (isAdvisor && !adm ? 'advisor' : isOwner && !adm ? 'client' : 'admin') : null;
  const decision = opts.decision
    ?? (opts.nextStatus === 'cancelled' && b.status === 'pending' && cancelledBy === 'advisor' ? 'declined' : null);
  const wrote = await c.env.DB.prepare(
    `UPDATE advisor_bookings SET status = ?, cancel_reason = COALESCE(?, cancel_reason),
            advisor_decision = COALESCE(?, advisor_decision),
            advisor_decided_at = CASE WHEN ? IS NOT NULL THEN ? ELSE advisor_decided_at END,
            cancelled_by = COALESCE(?, cancelled_by), updated_at = ?
      WHERE id = ? AND status = ?`
  ).bind(opts.nextStatus, opts.reason ?? null, decision, decision, at, cancelledBy, at, id, b.status).run();
  if (Number((wrote as any)?.meta?.changes ?? 0) === 0) {
    return c.json({ detail: 'This booking changed while you were looking at it. Reload it and try again.' }, 409);
  }
  // #4692: WHO closed the session, and when.
  //
  // The row carried the OUTCOME and not the hand: `status` says what happened,
  // `cancelled_by` says which side cancelled and `advisor_decision` holds the
  // answer, but none of them names the account that pressed the button, and
  // `updated_at` is the row's clock rather than an act. So a completed session
  // (which is what the advisor is paid on) and a cancel could not be traced to
  // a person at all — including a cancel an admin made on someone else's
  // booking, which reached no audit store.
  //
  // Recorded AFTER the conditional UPDATE changed a row, so the refused press
  // on a stale status above leaves no record of an act that did not happen.
  // Both writers are best effort by their own contract: the session has
  // already changed, and a lost line is better than an act undone by its own
  // record.
  //
  // An admin's press is the privileged one and goes to `logAdminAction`, which
  // reaches HQ's governance feed (D159); the advisor's and the client's own go
  // to `activity_logs` through `logActorAct` (D637). `adm` decides, exactly as
  // it decides `cancelled_by` above, so one press cannot be an admin to one
  // store and the advisor to the other. Ids and states only: `opts.reason` is
  // free text the person typed and stays out of both.
  const actorRole = adm ? 'admin' : isAdvisor ? 'advisor' : 'client';
  const act = {
    booking_id: id, advisor_id: b.advisor_id, slot_id: b.slot_id,
    from_status: b.status, to_status: opts.nextStatus,
    actor_role: actorRole, cancelled_by: cancelledBy, decision, at,
  };
  if (actorRole === 'admin') {
    await logAdminAction(c.env, user.id, String(user.email || ''),
      `advisor_booking_${opts.nextStatus}`, { ...act, target_user_id: b.founder_user_id });
  } else {
    await logActorAct(c.env, user, `advisor_booking_${opts.nextStatus}`, act);
  }
  // Task #52 — remove from external calendars on cancel/no-show.
  // Defer the dynamic import + provider DELETE work via waitUntil so
  // the cancel response returns immediately.
  if (opts.nextStatus === 'cancelled' || opts.nextStatus === 'no_show') deferCalendarCancel(c, [id]);
  // D4703: a confirmed booking's external copy stops being tentative.
  if (opts.nextStatus === 'confirmed') deferCalendarConfirm(c, id);
  const fresh = await c.env.DB.prepare('SELECT * FROM advisor_bookings WHERE id = ?')
    .bind(id).first<BookingRow>();
  return c.json(bookingDto(fresh!));
}

advisors.post('/bookings/:id/confirm', (c) => transition(c, Number(c.req.param('id')),
  { allowed: ['pending'], nextStatus: 'confirmed', whoCan: 'advisor', decision: 'accepted' }));
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

/**
 * #4702 (D4702): the advisor's review coverage over EVERY completed session, in
 * one read.
 *
 * The Delivery page read each held session's reviews one request at a time,
 * stopped at the first 20, and stored a failed read as "no reviews", so a page
 * with 30 held sessions reported "No review" for the last ten without having
 * asked, and for any session whose read failed. The counts here are database
 * aggregates over the whole population; `items` lists the 1,000 newest sessions
 * with their review count so a row can say reviewed, not reviewed, or (when this
 * route itself could not be read) nothing at all: the page treats a failed read
 * as unknown.
 */
advisors.get('/me/review-coverage', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const t = await c.env.DB.prepare(
      `SELECT COUNT(*) AS held,
              COALESCE(SUM(CASE WHEN x.n > 0 THEN 1 ELSE 0 END), 0) AS reviewed,
              COALESCE(SUM(x.n), 0) AS reviews,
              COALESCE(SUM(x.rating_sum), 0) AS rating_sum
         FROM advisor_bookings b
         LEFT JOIN (SELECT booking_id, COUNT(*) AS n, SUM(rating) AS rating_sum FROM advisor_reviews GROUP BY booking_id) x ON x.booking_id = b.id
        WHERE b.advisor_id = ? AND b.status = 'completed'`
    ).bind(m.id).first<{ held: number; reviewed: number; reviews: number; rating_sum: number }>();
    const rows = (await c.env.DB.prepare(
      `SELECT b.id AS booking_id, COALESCE(x.n, 0) AS reviews, COALESCE(x.advisor_filed, 0) AS advisor_filed, x.avg_rating AS avg_rating
         FROM advisor_bookings b
         LEFT JOIN (SELECT booking_id, COUNT(*) AS n, AVG(rating) AS avg_rating,
                           MAX(CASE WHEN reviewer_role = 'advisor' THEN 1 ELSE 0 END) AS advisor_filed
                      FROM advisor_reviews GROUP BY booking_id) x ON x.booking_id = b.id
        WHERE b.advisor_id = ? AND b.status = 'completed'
        ORDER BY b.id DESC LIMIT 1001`
    ).bind(m.id).all<any>()).results || [];
    const held = Number(t?.held ?? 0);
    const reviewed = Number(t?.reviewed ?? 0);
    return c.json({
      held, reviewed, awaiting: held - reviewed,
      ratings: { count: Number(t?.reviews ?? 0), sum: Number(t?.rating_sum ?? 0) },
      items: rows.slice(0, 1000).map((r: any) => ({ booking_id: Number(r.booking_id), reviews: Number(r.reviews), advisor_filed: Number(r.advisor_filed) === 1, rating: r.avg_rating == null ? null : Number(r.avg_rating) })),
      items_complete: rows.length <= 1000,
    });
  } catch (e) { return mapError(c, e); }
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
    const isAdvisor = await actsForAdvisor(c.env, user, b.advisor_id);
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

// Private roster notes. The owner comes only from authentication; a client ID
// is usable only if that person has booked this advisor. These are never added
// to the shared booking DTO or the founder's client brief.
async function requireRosterClient(c: Context<{ Bindings: Env }>) {
  const user = await requireAuth(c);
  if (!holdsLicence(user, 'advisor')) throw refuse(c, 403, ADVISOR_LICENCE_REQUIRED);
  const advisor = await requireMyAdvisor(c, user);
  if (advisor.user_id !== user.id) throw c.json({ detail: 'Your advisor profile is not attached to this account' }, 403);
  const clientId = Number(c.req.param('clientId'));
  if (!Number.isSafeInteger(clientId) || clientId <= 0) throw new Error('clientId must be a positive user ID');
  const booking = await c.env.DB.prepare(
    'SELECT id FROM advisor_bookings WHERE advisor_id = ? AND founder_user_id = ? LIMIT 1'
  ).bind(advisor.id, clientId).first<{ id: number }>();
  if (!booking) throw c.json({ detail: 'This client is not in your booking roster' }, 403);
  return { ownerId: user.id, clientId };
}

type ClientNoteRow = { uid: string; body: string; updated_at: string };
async function loadClientNote(env: Env, ownerId: number, clientId: number) {
  return env.DB.prepare(
    'SELECT uid, body, updated_at FROM advisor_client_notes WHERE advisor_user_id = ? AND client_user_id = ?'
  ).bind(ownerId, clientId).first<ClientNoteRow>();
}

advisors.get('/me/client-notes/:clientId', async (c) => {
  try {
    const { ownerId, clientId } = await requireRosterClient(c);
    return c.json({ client_user_id: clientId, note: await loadClientNote(c.env, ownerId, clientId) });
  } catch (e) { return mapError(c, e); }
});

advisors.put('/me/client-notes/:clientId', async (c) => {
  try {
    const { ownerId, clientId } = await requireRosterClient(c);
    const input = await c.req.json().catch(() => null);
    if (typeof input?.body !== 'string' || !input.body.trim() || input.body.length > 8000) {
      return c.json({ detail: 'A note needs 1–8000 characters. Use DELETE to remove it.' }, 400);
    }
    const now = nowIso();
    await c.env.DB.prepare(
      `INSERT INTO advisor_client_notes (uid, advisor_user_id, client_user_id, body, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (advisor_user_id, client_user_id) DO UPDATE SET
         body = excluded.body, updated_at = excluded.updated_at`
    ).bind(newUid(), ownerId, clientId, input.body.trim(), now, now).run();
    return c.json({ client_user_id: clientId, note: await loadClientNote(c.env, ownerId, clientId) });
  } catch (e) { return mapError(c, e); }
});

advisors.delete('/me/client-notes/:clientId', async (c) => {
  try {
    const { ownerId, clientId } = await requireRosterClient(c);
    await c.env.DB.prepare(
      'DELETE FROM advisor_client_notes WHERE advisor_user_id = ? AND client_user_id = ?'
    ).bind(ownerId, clientId).run();
    return c.json({ client_user_id: clientId, note: null });
  } catch (e) { return mapError(c, e); }
});

// #4715 (D4715): Services: what an advisor offers and charges (migration 203). — advisors_services.ts
advisors.route('/', advisorServicesRoutes);

// #4715 (D4715): Proof: what an advisor claims and who has confirmed it (migration 204). — advisors_proof.ts
advisors.route('/', advisorProofRoutes);

// #4715 (D4715): Money: what a session was worth, the take rate, payouts, earnings and tax (migrations 205 and 241). — advisors_money.ts
advisors.route('/', advisorMoneyRoutes);

// #4715 (D4715): Cohorts: an advisor's assigned batch and the founders who opt in or out (migration 206). — advisors_cohorts.ts
advisors.route('/', advisorCohortsRoutes);

// #4715 (D4715): Engagements: the contract behind the sessions, its lanes, renewals and corrections (migration 238). — advisors_engagements.ts
advisors.route('/', advisorEngagementsRoutes);

// #4715 (D4715): Deliverables: what an advisor sends a client and the client's receipt (migration 239). — advisors_deliverables.ts
advisors.route('/', advisorDeliverablesRoutes);

// ───────────────────────────── PR4 · Sessions — the rules, prices and links ──
//
// Migration 240's three stores plus the two new slot columns. The artboard
// (`Advisor Detail · Practice.dc.html` PR4, tagged FEED) draws a calendar and,
// beside it, the three things that decide what the calendar contains: the
// availability rules that generate slots, the session types that price them,
// and the booking links that fill them.
//
// NOTHING HERE CHARGES ANYONE. A `price_cents` is what the advisor asks for.
// Migration 241 adds the take-rate and the payout account; the Stripe Connect
// service leg lands after it in test mode behind a production flag. Until that
// flag flips, `payment_state` records why a booking could NOT be charged and
// never asserts that one was — which is why 'charged' is only ever written by
// the settlement path, never by a route in this block. D75.

type AvailabilityRow = {
  id: number; advisor_id: number;
  weekly_paid_cap: number | null; buffer_minutes: number | null;
  min_notice_hours: number | null; blackouts_json: string;
  timezone: string | null; created_at: string; updated_at: string;
};
type SessionTypeRow = {
  id: number; uid: string; advisor_id: number; name: string;
  duration_minutes: number | null; cadence_note: string | null;
  price_cents: number | null; is_free_intro: number; once_per_client: number;
  sort_order: number; is_active: number; created_at: string; updated_at: string;
  is_included?: number | null; booking_count?: number;
};
type BookingLinkRow = {
  id: number; uid: string; advisor_id: number; slug: string;
  session_type_id: number | null; audience: string; cohort_ref: string | null;
  requires_payout_account: number; note: string | null; is_active: number;
  created_at: string; updated_at: string;
  opens_count?: number | null; booking_count?: number;
};

const LINK_AUDIENCES = ['public', 'cohort', 'private'];

function availabilityDto(r: AvailabilityRow | null): any {
  // NULL is "not set", and it stays null all the way to the page. A cap the
  // advisor never chose must not render as a number they can be held to —
  // D56/D68, the same rule `renewal_rate` follows above.
  return {
    weekly_paid_cap: r?.weekly_paid_cap ?? null,
    buffer_minutes: r?.buffer_minutes ?? null,
    min_notice_hours: r?.min_notice_hours ?? null,
    blackouts: jload<any[]>(r?.blackouts_json, []),
    timezone: r?.timezone ?? null,
    // Lets the page tell "no rules configured" from "rules configured to
    // nothing", which read identically in the four fields above.
    configured: Boolean(r),
    // #4713 (D4713): the version of this rule set. A replacement that names the
    // revision it was edited from is refused when the rules have changed since
    // (another tab, another device). `''` is "no rules yet".
    revision: r?.updated_at ?? '',
  };
}

function sessionTypeDto(r: SessionTypeRow): any {
  return {
    id: r.id, uid: r.uid, name: r.name,
    duration_minutes: r.duration_minutes, cadence_note: r.cadence_note,
    price_cents: r.price_cents,
    is_free_intro: !!r.is_free_intro,
    is_included: r.is_included == null ? null : !!r.is_included,
    booking_count: r.booking_count ?? null,
    once_per_client: !!r.once_per_client,
    sort_order: r.sort_order, is_active: !!r.is_active,
  };
}

function bookingLinkDto(r: BookingLinkRow): any {
  return {
    id: r.id, uid: r.uid, slug: r.slug,
    session_type_id: r.session_type_id, audience: r.audience,
    cohort_ref: r.cohort_ref,
    requires_payout_account: !!r.requires_payout_account,
    note: r.note, is_active: !!r.is_active,
    opens_count: r.opens_count ?? null, booking_count: r.booking_count ?? null,
  };
}

/**
 * A blackout window is a CALENDAR DAY AND CLOCK TIME, never an instant.
 * `new Date('2026-11-04')` is midnight UTC, so a window stored as a timestamp
 * moves an hour twice a year and lands on the wrong side of a Friday for every
 * reader west of Greenwich. The shape is validated here so a malformed rule is
 * refused at the door rather than silently generating the wrong calendar.
 */
function parseBlackouts(v: unknown): string {
  if (v == null) return '[]';
  if (!Array.isArray(v)) throw new Error('blackouts must be an array');
  if (v.length > 50) throw new Error('blackouts is limited to 50 windows');
  const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
  const out = v.map((w: any) => {
    const day = String(w?.day || '').trim().toLowerCase();
    if (!DAYS.includes(day)) throw new Error(`blackout day must be one of: ${DAYS.join(', ')}`);
    const from = String(w?.from || '').trim();
    const to = String(w?.to || '').trim();
    if (!CLOCK.test(from) || !CLOCK.test(to)) throw new Error('blackout from/to must be HH:MM');
    if (from >= to) throw new Error('a blackout window must end after it starts');
    return { day, from, to };
  });
  return JSON.stringify(out);
}

function parseOptionalCount(v: unknown, label: string, max: number): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${label} must be a whole number, zero or more`);
  if (n > max) throw new Error(`${label} is implausibly large`);
  return n;
}

advisors.get('/me/availability', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const row = await c.env.DB.prepare(
      'SELECT * FROM advisor_availability_rules WHERE advisor_id = ?'
    ).bind(m.id).first<AvailabilityRow>();
    return c.json(availabilityDto(row));
  } catch (e) { return mapError(c, e); }
});

// PUT, not PATCH: one row per advisor, and the whole rule set is the unit an
// advisor edits. A partial update would let a cap and a blackout disagree
// about which edit won.
advisors.put('/me/availability', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const body = await c.req.json().catch(() => ({} as any));
    const cap = parseOptionalCount(body.weekly_paid_cap, 'weekly_paid_cap', 200);
    const buffer = parseOptionalCount(body.buffer_minutes, 'buffer_minutes', 24 * 60);
    const notice = parseOptionalCount(body.min_notice_hours, 'min_notice_hours', 24 * 365);
    const blackouts = parseBlackouts(body.blackouts);
    // #4713 (D4713): optional compare-and-set. A caller that sends the
    // `revision` it read replaces only that version of the rules: if another
    // tab changed them since, the write is refused (409 `rules_changed`) with
    // the current rules, and nothing is overwritten. Omitting it keeps the
    // unconditional replace the route always had.
    const expected = body.expected_revision !== undefined && body.expected_revision !== null ? String(body.expected_revision) : null;
    const rulesChanged = async () => {
      const row = await c.env.DB.prepare('SELECT * FROM advisor_availability_rules WHERE advisor_id = ?')
        .bind(m.id).first<AvailabilityRow>();
      return c.json({
        detail: 'Your availability rules changed somewhere else since you opened them. Nothing was saved; reload to see the current rules.',
        code: 'rules_changed', current: availabilityDto(row),
      }, 409);
    };
    if (expected !== null) {
      // The compare and the write are ONE statement, so two tabs saving from
      // the same revision cannot both win: the loser's UPDATE matches no row.
      const at = nowIso();
      const res = expected === ''
        ? await c.env.DB.prepare(
          `INSERT INTO advisor_availability_rules
             (advisor_id, weekly_paid_cap, buffer_minutes, min_notice_hours, blackouts_json, timezone, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(advisor_id) DO NOTHING`
        ).bind(m.id, cap, buffer, notice, blackouts, trimOrNull(body.timezone, 64), at, at).run()
        : await c.env.DB.prepare(
          `UPDATE advisor_availability_rules
              SET weekly_paid_cap = ?, buffer_minutes = ?, min_notice_hours = ?, blackouts_json = ?, timezone = ?, updated_at = ?
            WHERE advisor_id = ? AND updated_at = ?`
        ).bind(cap, buffer, notice, blackouts, trimOrNull(body.timezone, 64), at, m.id, expected).run();
      if (!Number((res as any).meta?.changes ?? 0)) return rulesChanged();
      const done = await c.env.DB.prepare('SELECT * FROM advisor_availability_rules WHERE advisor_id = ?')
        .bind(m.id).first<AvailabilityRow>();
      return c.json(availabilityDto(done));
    }
    const now = nowIso();
    await c.env.DB.prepare(
      `INSERT INTO advisor_availability_rules
         (advisor_id, weekly_paid_cap, buffer_minutes, min_notice_hours,
          blackouts_json, timezone, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(advisor_id) DO UPDATE SET
         weekly_paid_cap = excluded.weekly_paid_cap,
         buffer_minutes = excluded.buffer_minutes,
         min_notice_hours = excluded.min_notice_hours,
         blackouts_json = excluded.blackouts_json,
         timezone = excluded.timezone,
         updated_at = excluded.updated_at`
    ).bind(
      m.id, cap, buffer, notice, blackouts,
      trimOrNull(body.timezone, 64), now, now,
    ).run();
    const fresh = await c.env.DB.prepare(
      'SELECT * FROM advisor_availability_rules WHERE advisor_id = ?'
    ).bind(m.id).first<AvailabilityRow>();
    return c.json(availabilityDto(fresh));
  } catch (e) { return mapError(c, e); }
});

advisors.get('/me/session-types', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const rows = await c.env.DB.prepare(
      `SELECT t.*, (SELECT COUNT(*) FROM advisor_bookings b WHERE b.session_type_id = t.id
          AND b.status != 'cancelled') AS booking_count FROM advisor_session_types t WHERE advisor_id = ?
        ORDER BY sort_order ASC, id ASC LIMIT 100`
    ).bind(m.id).all<SessionTypeRow>();
    return c.json({ items: (rows.results || []).map(sessionTypeDto) });
  } catch (e) { return mapError(c, e); }
});

advisors.post('/me/session-types', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const body = await c.req.json().catch(() => ({} as any));
    const name = String(body.name || '').trim().slice(0, 200);
    if (!name) return c.json({ detail: 'A session type needs a name' }, 400);
    const isFreeIntro = body.is_free_intro ? 1 : 0;
    const included = body.is_included ? 1 : 0;
    const price = parsePriceCents(body.price_cents);
    if (included && (isFreeIntro || (price != null && price > 0))) {
      return c.json({ detail: 'Included sessions cannot also be priced or a free intro' }, 400);
    }
    const active = body.is_active === undefined ? (included || isFreeIntro || price != null ? 1 : 0) : body.is_active ? 1 : 0;
    if (active && !included && !isFreeIntro && price == null) {
      return c.json({ detail: 'Set a price, included or a free intro before making a type bookable' }, 400);
    }
    // FREE AND UNPRICED ARE DIFFERENT FACTS and the pair must not contradict.
    // A free intro carrying a price says two things at once, and the canvas
    // prices its intro at "Free" precisely so a reader can trust the word.
    if (isFreeIntro && price != null && price > 0) {
      return c.json({ detail: 'A free intro cannot carry a price' }, 400);
    }
    const now = nowIso();
    const uid = newUid();
    const r = await c.env.DB.prepare(
      `INSERT INTO advisor_session_types
         (uid, advisor_id, name, duration_minutes, cadence_note, price_cents,
          is_free_intro, once_per_client, sort_order, is_active, is_included, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      uid, m.id, name,
      parseOptionalCount(body.duration_minutes, 'duration_minutes', 24 * 60),
      trimOrNull(body.cadence_note, 200), price,
      isFreeIntro, body.once_per_client ? 1 : 0,
      parseOptionalCount(body.sort_order, 'sort_order', 999) ?? 0,
      active, included, now, now,
    ).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM advisor_session_types WHERE id = ?')
      .bind((r as any).meta?.last_row_id).first<SessionTypeRow>();
    return c.json(sessionTypeDto(fresh!), 201);
  } catch (e) { return mapError(c, e); }
});

advisors.patch('/me/session-types/:id', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const row = await c.env.DB.prepare(
      'SELECT * FROM advisor_session_types WHERE id = ? AND advisor_id = ?'
    ).bind(Number(c.req.param('id')), m.id).first<SessionTypeRow>();
    // 404, never 403: the scope is in the WHERE clause, so another advisor's
    // row is indistinguishable from one that does not exist.
    if (!row) return c.json({ detail: 'Session type not found' }, 404);
    const body = await c.req.json().catch(() => ({} as any));
    const name = body.name == null ? row.name : String(body.name).trim().slice(0, 200);
    if (!name) return c.json({ detail: 'A session type needs a name' }, 400);
    const isFreeIntro = body.is_free_intro == null ? row.is_free_intro : (body.is_free_intro ? 1 : 0);
    const price = body.price_cents === undefined ? row.price_cents : parsePriceCents(body.price_cents);
    const included = body.is_included === undefined ? row.is_included ?? null : body.is_included ? 1 : 0;
    const active = body.is_active === undefined ? row.is_active : body.is_active ? 1 : 0;
    if (included && (isFreeIntro || (price != null && price > 0))) {
      return c.json({ detail: 'Included sessions cannot also be priced or a free intro' }, 400);
    }
    if (active && !included && !isFreeIntro && price == null) {
      return c.json({ detail: 'Set a price, included or a free intro before making a type bookable' }, 400);
    }
    if (isFreeIntro && price != null && price > 0) {
      return c.json({ detail: 'A free intro cannot carry a price' }, 400);
    }
    await c.env.DB.prepare(
      `UPDATE advisor_session_types
          SET name = ?, duration_minutes = ?, cadence_note = ?, price_cents = ?,
              is_free_intro = ?, once_per_client = ?, sort_order = ?, is_active = ?, is_included = ?,
              updated_at = ?
        WHERE id = ? AND advisor_id = ?`
    ).bind(
      name,
      body.duration_minutes === undefined ? row.duration_minutes
        : parseOptionalCount(body.duration_minutes, 'duration_minutes', 24 * 60),
      body.cadence_note === undefined ? row.cadence_note : trimOrNull(body.cadence_note, 200),
      price, isFreeIntro,
      body.once_per_client == null ? row.once_per_client : (body.once_per_client ? 1 : 0),
      body.sort_order === undefined ? row.sort_order
        : (parseOptionalCount(body.sort_order, 'sort_order', 999) ?? 0),
      active, included,
      nowIso(), row.id, m.id,
    ).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM advisor_session_types WHERE id = ?')
      .bind(row.id).first<SessionTypeRow>();
    return c.json(sessionTypeDto(fresh!));
  } catch (e) { return mapError(c, e); }
});

// The artboard's "Block a date range" op. A blocked slot is NOT a cancelled
// one: cancelling undoes a booking and tells whoever held it, while blocking
// withdraws an hour that was never taken. Conflating them would send a
// cancellation notice for an hour nobody had.
advisors.post('/me/slots/block', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const body = await c.req.json().catch(() => ({} as any));
    const from = trimOrNull(body.from, 40);
    const until = trimOrNull(body.until, 40);
    if (!from || !until) return c.json({ detail: 'A block needs a start and an end' }, 400);
    if (!(from < until)) return c.json({ detail: 'A block must end after it starts' }, 400);
    const reason = trimOrNull(body.reason, 200);

    // A BOOKED SLOT IS NOT BLOCKABLE, and this is the whole care in the
    // handler. Blocking an hour someone already holds would take their session
    // away silently — they would keep the confirmation and lose the slot. Those
    // are reported back by count so the advisor learns the range was not
    // wholly applied, rather than assuming it was.
    const inRange = await c.env.DB.prepare(
      `SELECT id FROM advisor_office_hour_slots
        WHERE advisor_id = ? AND starts_at >= ? AND starts_at < ? AND is_cancelled = 0`
    ).bind(m.id, from, until).all<{ id: number }>();
    const ids = (inRange.results || []).map((r) => r.id);
    let blocked = 0;
    let skippedBooked = 0;
    for (const id of ids) {
      // D4695: the check and the write are one statement. A booking that lands between a count and an UPDATE used to
      // be blocked out from under its holder; now the UPDATE changes nothing if a seat is held at that moment.
      const wrote = await c.env.DB.prepare(
        `UPDATE advisor_office_hour_slots SET blocked_reason = ?
          WHERE id = ? AND advisor_id = ?
            AND NOT EXISTS (SELECT 1 FROM advisor_bookings b WHERE b.slot_id = ? AND b.status IN ('pending','confirmed','completed'))`
      ).bind(reason || 'Blocked', id, m.id, id).run();
      if (Number((wrote as any)?.meta?.changes ?? 0) === 1) blocked++; else skippedBooked++;
    }
    return c.json({ blocked, skipped_booked: skippedBooked, examined: ids.length });
  } catch (e) { return mapError(c, e); }
});

advisors.get('/me/booking-links', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const rows = await c.env.DB.prepare(
      `SELECT l.*, (SELECT COUNT(*) FROM advisor_bookings b WHERE b.booking_link_id = l.id
          AND b.status != 'cancelled') AS booking_count FROM advisor_booking_links l WHERE advisor_id = ?
        ORDER BY is_active DESC, id ASC LIMIT 100`
    ).bind(m.id).all<BookingLinkRow>();
    return c.json({ items: (rows.results || []).map(bookingLinkDto) });
  } catch (e) { return mapError(c, e); }
});

// D1597 (#3870): Advisor › Expertise › Visibility. Booking requests per link
// and opens of the advisor's writing, each from the store that records it;
// views and engagements are null with their sentences, and a failed read is
// null with `unreadable`, never a zero (services/advisorVisibility.ts).
advisors.get('/me/visibility', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!holdsLicence(user, 'advisor')) return refuse(c, 403, ADVISOR_LICENCE_REQUIRED);
    const m = await requireMyAdvisor(c, user);
    return c.json(await advisorVisibility(c.env, { advisorId: m.id, userId: user.id }, c.req.query('days'), Date.now(), { limit: c.req.query('limit'), offset: c.req.query('offset') }));
  } catch (e) { return mapError(c, e); }
});

advisors.get('/me/access-log', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!holdsLicence(user, 'advisor')) return refuse(c, 403, ADVISOR_LICENCE_REQUIRED);
    await requireMyAdvisor(c, user);
    const rows = await c.env.DB.prepare(
      `SELECT l.action, l.created_at, p.uid AS project_uid, p.name AS client,
              u.name AS advisor_name, d.uid AS document_uid
         FROM advisor_client_access_log l
         JOIN users u ON u.id = l.advisor_user_id
         LEFT JOIN projects p ON p.id = l.project_id
         LEFT JOIN research_documents d ON d.id = l.document_id
        WHERE l.advisor_user_id = ? ORDER BY l.created_at DESC, l.id DESC LIMIT 200`
    ).bind(user.id).all();
    return c.json({ items: rows.results || [] });
  } catch (e) { return mapError(c, e); }
});

advisors.patch('/me/booking-links/:id', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!holdsLicence(user, 'advisor')) return refuse(c, 403, ADVISOR_LICENCE_REQUIRED);
    const m = await requireMyAdvisor(c, user);
    const body = await c.req.json().catch(() => ({} as any));
    if (typeof body.is_active !== 'boolean') return c.json({ detail: 'is_active must be a boolean' }, 400);
    const row = await c.env.DB.prepare('SELECT id FROM advisor_booking_links WHERE id = ? AND advisor_id = ?')
      .bind(Number(c.req.param('id')), m.id).first<{ id: number }>();
    if (!row) return c.json({ detail: 'Booking link not found' }, 404);
    await c.env.DB.prepare('UPDATE advisor_booking_links SET is_active = ?, updated_at = ? WHERE id = ? AND advisor_id = ?')
      .bind(body.is_active ? 1 : 0, nowIso(), row.id, m.id).run();
    await logAdminAction(c.env, user.id, user.email, 'advisor_booking_link_updated', { link_id: row.id });
    const fresh = await c.env.DB.prepare('SELECT * FROM advisor_booking_links WHERE id = ? AND advisor_id = ?')
      .bind(row.id, m.id).first<BookingLinkRow>();
    return c.json(bookingLinkDto(fresh!));
  } catch (e) { return mapError(c, e); }
});

advisors.post('/me/booking-links', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const body = await c.req.json().catch(() => ({} as any));
    // The slug is resolved from the URL alone, so it has to be URL-safe and it
    // has to be unique across every advisor — hence the refusal below rather
    // than a silent rewrite: a link the advisor did not type is a link they
    // cannot give out from memory.
    // Validated BEFORE any normalising, so 'Ada/Intro' is a 400 and not a
    // quiet rewrite to 'ada/intro'. A lowercasing step here would hand back a
    // link the advisor did not type, which is the one thing a link they read
    // aloud or retype from memory cannot survive. The test for this caught the
    // route doing exactly that.
    const slug = String(body.slug || '').trim();
    if (!/^[a-z0-9][a-z0-9/-]{1,98}[a-z0-9]$/.test(slug)) {
      return c.json({ detail: 'A slug may use lowercase letters, digits, hyphens and slashes' }, 400);
    }
    const audience = String(body.audience || 'public').trim();
    if (!LINK_AUDIENCES.includes(audience)) {
      return c.json({ detail: `audience must be one of: ${LINK_AUDIENCES.join(', ')}` }, 400);
    }
    // A cohort link with no cohort admits everyone, which is the opposite of
    // what it claims. Refuse rather than quietly widening the audience.
    const cohortRef = trimOrNull(body.cohort_ref, 100);
    if (audience === 'cohort' && !cohortRef) {
      return c.json({ detail: 'A cohort link needs the cohort it admits' }, 400);
    }
    let sessionTypeId: number | null = null;
    if (body.session_type_id != null && body.session_type_id !== '') {
      const t = await c.env.DB.prepare(
        'SELECT id FROM advisor_session_types WHERE id = ? AND advisor_id = ?'
      ).bind(Number(body.session_type_id), m.id).first<{ id: number }>();
      // Someone else's session type is not an option this advisor may sell.
      if (!t) return c.json({ detail: 'Session type not found' }, 404);
      sessionTypeId = t.id;
    }
    const now = nowIso();
    const uid = newUid();
    const existing = await c.env.DB.prepare('SELECT id FROM advisor_booking_links WHERE slug = ?')
      .bind(slug).first<{ id: number }>();
    if (existing) return c.json({ detail: 'That link is already taken' }, 409);
    const r = await c.env.DB.prepare(
      `INSERT INTO advisor_booking_links
         (uid, advisor_id, slug, session_type_id, audience, cohort_ref,
          requires_payout_account, note, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).bind(
      uid, m.id, slug, sessionTypeId, audience, cohortRef,
      body.requires_payout_account ? 1 : 0, trimOrNull(body.note, 300), now, now,
    ).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM advisor_booking_links WHERE id = ?')
      .bind((r as any).meta?.last_row_id).first<BookingLinkRow>();
    return c.json(bookingLinkDto(fresh!), 201);
  } catch (e) { return mapError(c, e); }
});

export default advisors;

// #4715: these moved to services/advisorPractice.ts and are exported here still.
export { type BookingOffer } from '../services/advisorPractice';
export { BOOKING_PAYABLE_STATUSES, type LedgerLine, ledgerAggregate } from './advisors_money';
export { mayHoldCohortAssignment } from './advisors_cohorts';
export { ENGAGEMENT_LANES, ENGAGEMENT_SHAPES, ENGAGEMENT_GRAPH, ENGAGEMENT_TERMS, termChanges } from './advisors_engagements';
export { deliverableState } from './advisors_deliverables';
