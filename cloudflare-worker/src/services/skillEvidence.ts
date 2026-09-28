/**
 * Skill evidence from platform tools — D318, Profiling v2 Session 9.
 *
 * A skill profile used to be only what a person SAID: the fit bank's
 * `skill_axis` answers and the Skills page both write `user_skills.self_level`.
 * This module adds what they DID. Every source below is a table that already
 * records one of the person's own actions, with the column that says it was
 * theirs and the column that dates it. Nothing here is invented: a candidate
 * the owner's brief listed and the schema cannot attribute to one person
 * (deal memos carry no author) is left out, and D318 says why.
 *
 * THE MAP IS ONE LIST. `EVIDENCE_SOURCES` is the whole of it: adding a source
 * is one entry — its key, the literal SQL that returns the caller's own rows,
 * the radar axes it is evidence for and the words its provenance line uses.
 * `documentation/architecture/PROFILING_V2.md` carries the same table for
 * people; a test holds the two in step.
 *
 * WHAT A ROW IS. Each query returns one row per action, `at` (its date) and,
 * where the axis depends on the row, `k` (a key the source maps to axes). It
 * never selects a title, a note or a body — counts and dates are all this
 * module stores or returns.
 *
 * OWN RECORDS ONLY. Every query takes the user id as its first bound
 * parameter and filters on the column that names the actor: `created_by`,
 * `signed_off_by`, `investor_user_id`, a project the user founded, a partner
 * or advisor profile the user holds. Another user's rows never count, and the
 * route that reads this only ever passes the caller's own id.
 *
 * AGEING (the handoff's proposal, confirmed by the owner for D318 pending
 * S7's spec): an action in the last 12 months counts 1; an older one fades
 * with a 12-month half-life. Lifetime totals are kept for display only.
 *
 * BLEND — "CORROBORATE" (owner's decision for D318, pending S7): evidence
 * confirms a self-rating, it never raises one and never creates one.
 *   - self and evidence, evidence ≥ self → blended = self ("corroborated");
 *   - self and evidence, evidence < self → blended moves half-way toward the
 *     evidence ("partly corroborated");
 *   - self only → blended = self ("self-rated only");
 *   - evidence only → no blended level ("evidence only — not self-rated");
 *   - neither → nothing, and the axis says so. It is never drawn as 0.
 */
import type { Env } from '../types';
import { RADAR_AXES, type RadarAxisSlug } from './skillsTaxonomySchema';

export const EVIDENCE_ENGINE_VERSION = 1;

/** An action this old or newer counts fully. */
export const WINDOW_DAYS = 365;
/** Past the window, an action's weight halves every this many days. */
export const HALF_LIFE_DAYS = 365;
/** Weighted actions at which the evidence score reaches ~63% of the scale. */
export const SATURATION = 3;
/** The radar scale. */
export const SCALE_MAX = 5;

const DAY_MS = 86_400_000;
const AXIS_SLUGS = RADAR_AXES.map((a) => a.slug) as RadarAxisSlug[];
const AXIS_SET = new Set<string>(AXIS_SLUGS);

type Role = 'founder' | 'investor' | 'partner' | 'advisor';

/** Where a source's axes come from. */
type AxisRule =
  | { fixed: RadarAxisSlug[] }
  /** Per row, from the row's `k`. An unknown key is no evidence. */
  | { byKey: Record<string, RadarAxisSlug[]> }
  /** The axes the person's own partner/advisor/expert profile names. */
  | { specialization: true };

export interface EvidenceSource {
  key: string;
  role: Role;
  /** Literal SQL; `?1` is the user id. Returns `at` and optionally `k`. */
  sql: string;
  axes: AxisRule;
  /** Provenance words: "3 pitch-deck versions saved". */
  one: string;
  many: string;
  /** Contribution per weighted action to the axis score. */
  weight?: number;
}

/**
 * The Spin-Out Lab milestones that are evidence of a skill. The rest
 * (`project_created`, `profiling_completed`, `office_hours_booked`, the
 * scoring milestones, meetings booked) record taking part, not doing the
 * work, so they are not listed.
 */
const LAB_MILESTONE_AXES: Record<string, RadarAxisSlug[]> = {
  pitch_deck_drafted: ['marketing_brand', 'capital_network'],
  brand_basics_filled: ['marketing_brand', 'design'],
  landing_page_created: ['marketing_brand', 'design'],
  icp_defined: ['gtm_sales', 'product'],
  discovery_followups_mapped: ['gtm_sales', 'product'],
  market_research_shared: ['gtm_sales', 'product'],
  market_sizing_completed: ['gtm_sales', 'finance_ops'],
  mvp_scoped: ['product', 'engineering'],
  okrs_created: ['product'],
  incorporation_completed: ['legal_compliance'],
  ein_received: ['legal_compliance'],
  founder_stock_issued: ['legal_compliance'],
  section83b_filed: ['legal_compliance'],
  cofounder_agreement_signed: ['legal_compliance'],
  captable_locked: ['legal_compliance', 'finance_ops'],
  use_of_funds_filled: ['finance_ops'],
  revenue_summary_generated: ['finance_ops'],
  revenue_proof_added: ['finance_ops', 'gtm_sales'],
  fundraise_ask_locked: ['capital_network'],
  investor_intros_secured: ['capital_network'],
  data_room_built: ['capital_network'],
};

/** Due-diligence section → the skill signing it off exercises. */
const DD_SECTION_AXES: Record<string, RadarAxisSlug[]> = {
  corporate_legal: ['legal_compliance'],
  compliance_aml: ['legal_compliance'],
  kyb_entity: ['legal_compliance'],
  kyc_individual: ['legal_compliance'],
  accreditation: ['legal_compliance'],
  financial_health: ['finance_ops'],
  product_tech: ['engineering', 'product'],
  cyber_posture: ['engineering'],
  market_position: ['product'],
  market_traction: ['product', 'gtm_sales'],
  founder_integrity: ['capital_network'],
  reputation_press: ['capital_network'],
};

export const EVIDENCE_SOURCES: EvidenceSource[] = [
  // ── Founder ──────────────────────────────────────────────────────────
  {
    key: 'deck_version', role: 'founder',
    sql: 'SELECT created_at AS at FROM pitch_decks WHERE created_by = ?1',
    axes: { fixed: ['marketing_brand', 'capital_network'] },
    one: 'pitch-deck version saved', many: 'pitch-deck versions saved',
  },
  {
    key: 'brand_site', role: 'founder',
    sql: `SELECT b.created_at AS at FROM brand_sites b WHERE b.project_id IN (
      SELECT p.id FROM projects p JOIN users u ON u.founder_id = p.founder_id WHERE u.id = ?1 AND p.deleted_at IS NULL)`,
    axes: { fixed: ['marketing_brand', 'design'] },
    one: 'brand site built', many: 'brand sites built',
  },
  {
    key: 'discovery_interview', role: 'founder',
    sql: `SELECT COALESCE(d.interview_date, d.created_at) AS at FROM discovery_interviews d WHERE d.project_id IN (
      SELECT p.id FROM projects p JOIN users u ON u.founder_id = p.founder_id WHERE u.id = ?1 AND p.deleted_at IS NULL)`,
    axes: { fixed: ['gtm_sales', 'product'] },
    one: 'discovery interview logged', many: 'discovery interviews logged',
  },
  {
    key: 'okr_shipped', role: 'founder',
    sql: `SELECT o.updated_at AS at FROM roadmap_okrs o WHERE o.kanban_status = 'done' AND o.project_id IN (
      SELECT p.id FROM projects p JOIN users u ON u.founder_id = p.founder_id WHERE u.id = ?1 AND p.deleted_at IS NULL)`,
    axes: { fixed: ['product', 'engineering'] },
    one: 'roadmap objective shipped', many: 'roadmap objectives shipped',
  },
  {
    key: 'financial_model', role: 'founder',
    sql: 'SELECT updated_at AS at FROM financial_models WHERE updated_by = ?1',
    axes: { fixed: ['finance_ops'] },
    one: 'financial model kept', many: 'financial models kept',
  },
  {
    key: 'cap_table_security', role: 'founder',
    sql: 'SELECT created_at AS at FROM cap_table_securities WHERE user_id = ?1',
    axes: { fixed: ['legal_compliance', 'finance_ops'] },
    one: 'cap-table security recorded', many: 'cap-table securities recorded',
  },
  {
    key: 'esign_sent_completed', role: 'founder',
    sql: `SELECT completed_at AS at FROM esign_envelopes WHERE created_by = ?1 AND status = 'completed' AND completed_at IS NOT NULL`,
    axes: { fixed: ['legal_compliance'] },
    one: 'document sent and fully signed', many: 'documents sent and fully signed',
  },
  {
    key: 'esign_signed', role: 'founder',
    sql: 'SELECT signed_at AS at FROM esign_recipients WHERE user_id = ?1 AND signed_at IS NOT NULL',
    axes: { fixed: ['legal_compliance'] },
    one: 'document signed', many: 'documents signed',
    weight: 0.5,
  },
  {
    key: 'lab_milestone', role: 'founder',
    sql: 'SELECT completed_at AS at, milestone_key AS k FROM spinout_lab_milestones WHERE user_id = ?1 AND completed_at IS NOT NULL',
    axes: { byKey: LAB_MILESTONE_AXES },
    one: 'Spin-Out Lab milestone completed', many: 'Spin-Out Lab milestones completed',
    weight: 0.5,
  },
  // ── Investor ─────────────────────────────────────────────────────────
  {
    key: 'dd_section_signed_off', role: 'investor',
    sql: 'SELECT completed_at AS at, section_key AS k FROM dd_sections WHERE signed_off_by = ?1 AND completed_at IS NOT NULL',
    axes: { byKey: DD_SECTION_AXES },
    one: 'due-diligence section signed off', many: 'due-diligence sections signed off',
  },
  {
    key: 'commitment', role: 'investor',
    sql: `SELECT created_at AS at FROM commitments WHERE investor_user_id = ?1 AND status IN ('pending', 'confirmed')`,
    axes: { fixed: ['capital_network', 'finance_ops'] },
    one: 'commitment made', many: 'commitments made',
  },
  {
    key: 'deal_worked', role: 'investor',
    sql: 'SELECT MAX(created_at) AS at FROM deal_stage_events WHERE actor_user_id = ?1 GROUP BY deal_id',
    axes: { fixed: ['capital_network'] },
    one: 'deal moved through the pipeline', many: 'deals moved through the pipeline',
    weight: 0.5,
  },
  // ── Partner ──────────────────────────────────────────────────────────
  {
    key: 'office_hours_completed', role: 'partner',
    sql: `SELECT b.updated_at AS at FROM partner_bookings b JOIN users u ON u.partner_id = b.partner_id
      WHERE u.id = ?1 AND b.status = 'completed'`,
    axes: { specialization: true },
    one: 'office-hour session held', many: 'office-hour sessions held',
  },
  {
    key: 'office_hours_rated_well', role: 'partner',
    sql: `SELECT r.created_at AS at FROM partner_booking_ratings r JOIN users u ON u.partner_id = r.partner_id
      WHERE u.id = ?1 AND r.rating >= 4`,
    axes: { specialization: true },
    one: 'session rated 4★ or more', many: 'sessions rated 4★ or more',
    weight: 0.5,
  },
  {
    key: 'office_hours_action_closed', role: 'partner',
    sql: `SELECT a.done_at AS at FROM partner_booking_action_items a JOIN partner_bookings b ON b.id = a.booking_id
      JOIN users u ON u.partner_id = b.partner_id WHERE u.id = ?1 AND a.done_at IS NOT NULL`,
    axes: { specialization: true },
    one: 'session action item closed', many: 'session action items closed',
    weight: 0.5,
  },
  {
    key: 'engagement_milestone', role: 'partner',
    sql: `SELECT m.completed_at AS at FROM engagement_milestones m JOIN engagements e ON e.id = m.engagement_id
      JOIN users u ON u.partner_id = e.partner_id WHERE u.id = ?1 AND m.completed_at IS NOT NULL`,
    axes: { specialization: true },
    one: 'engagement milestone delivered', many: 'engagement milestones delivered',
  },
  {
    key: 'perk_redeemed', role: 'partner',
    sql: `SELECT c.redeemed_at AS at FROM perk_claims c JOIN perks p ON p.id = c.perk_id
      WHERE p.partner_user_id = ?1 AND c.status = 'redeemed' AND c.redeemed_at IS NOT NULL`,
    axes: { specialization: true },
    one: 'perk redeemed by a founder', many: 'perks redeemed by founders',
    weight: 0.5,
  },
  // ── Advisor / coach ──────────────────────────────────────────────────
  {
    key: 'advisor_engagement', role: 'advisor',
    sql: `SELECT e.started_at AS at FROM advisor_engagements e JOIN advisors a ON a.id = e.advisor_id
      WHERE a.user_id = ?1 AND e.started_at IS NOT NULL`,
    axes: { specialization: true },
    one: 'advisory engagement started', many: 'advisory engagements started',
  },
  {
    key: 'expert_session_completed', role: 'advisor',
    sql: `SELECT b.scheduled_at AS at FROM expert_bookings b JOIN experts x ON x.id = b.expert_id
      WHERE x.user_id = ?1 AND b.status = 'completed'`,
    axes: { specialization: true },
    one: 'session held', many: 'sessions held',
  },
  {
    key: 'expert_rated_well', role: 'advisor',
    sql: `SELECT r.created_at AS at FROM expert_ratings r JOIN experts x ON x.id = r.expert_id
      WHERE x.user_id = ?1 AND r.stars >= 4`,
    axes: { specialization: true },
    one: 'session rated 4★ or more', many: 'sessions rated 4★ or more',
    weight: 0.5,
  },
  {
    key: 'guidance_answered', role: 'advisor',
    sql: `SELECT answered_at AS at FROM cohort_guidance WHERE advisor_user_id = ?1 AND answered_at IS NOT NULL AND retired_at IS NULL`,
    axes: { specialization: true },
    one: 'cohort question answered', many: 'cohort questions answered',
    weight: 0.5,
  },
];

/**
 * Words in a partner's specialization, an advisor's expertise or an expert's
 * categories that name a radar axis. Matched on whole words, case-insensitive.
 * A profile that names none gives specialization sources no axis, and the
 * route says so rather than guessing.
 */
const SPECIALIZATION_WORDS: Record<RadarAxisSlug, string[]> = {
  product: ['product', 'pm', 'roadmap', 'ux research'],
  engineering: ['engineering', 'engineer', 'technical', 'tech', 'software', 'developer', 'cto', 'ai', 'ml', 'data', 'security', 'cyber'],
  design: ['design', 'designer', 'ux', 'ui'],
  gtm_sales: ['sales', 'gtm', 'go-to-market', 'growth', 'business development', 'bd', 'partnerships', 'revenue'],
  marketing_brand: ['marketing', 'brand', 'branding', 'content', 'pr', 'communications', 'seo', 'social'],
  finance_ops: ['finance', 'financial', 'accounting', 'operations', 'ops', 'cfo', 'tax', 'fp&a', 'hr', 'people'],
  legal_compliance: ['legal', 'law', 'lawyer', 'counsel', 'compliance', 'regulatory', 'ip', 'privacy', 'gdpr'],
  capital_network: ['fundraising', 'capital', 'investing', 'investment', 'investor', 'vc', 'venture', 'network', 'recruiting', 'talent'],
};

export function specializationAxes(texts: Array<string | null | undefined>): RadarAxisSlug[] {
  const words = texts
    .filter((t): t is string => typeof t === 'string' && t.length > 0)
    .map((t) => {
      // expertise_json / categories_json are JSON arrays of strings.
      try {
        const v = JSON.parse(t);
        if (Array.isArray(v)) return v.map(String).join(' , ');
      } catch { /* plain text */ }
      return t;
    })
    .join(' , ')
    .toLowerCase();
  const padded = ` ${words.replace(/[^a-z0-9&\- ]+/g, ' ')} `;
  const out: RadarAxisSlug[] = [];
  for (const axis of AXIS_SLUGS) {
    const hit = SPECIALIZATION_WORDS[axis].some((w) => padded.includes(` ${w} `))
      || RADAR_AXES.find((a) => a.slug === axis)!.legacy.some((l) => padded.includes(` ${l.toLowerCase()} `));
    if (hit) out.push(axis);
  }
  return out;
}

/**
 * SQLite `datetime()` text ("2026-08-01 10:00:00"), a bare date or ISO → epoch
 * ms, read as UTC when no zone is given; null when unreadable.
 */
export function parseAt(v: unknown): number | null {
  if (v == null) return null;
  let s = String(v).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s)) {
    s = s.replace(' ', 'T');
    if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) s += 'Z';
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

/** 1 inside the window; past it, halves every HALF_LIFE_DAYS. */
export function ageWeight(atMs: number, nowMs: number): number {
  const days = Math.max(0, (nowMs - atMs) / DAY_MS);
  if (days <= WINDOW_DAYS) return 1;
  return Math.pow(0.5, (days - WINDOW_DAYS) / HALF_LIFE_DAYS);
}

export interface EvidenceRow {
  axis: RadarAxisSlug;
  source: string;
  count_lifetime: number;
  count_window: number;
  weighted: number;
  first_at: string;
  last_at: string;
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * The caller's evidence, freshly read. One query per source plus one for the
 * profile words; every query is bound to `userId`.
 */
export async function collectEvidence(env: Env, userId: number, now: Date = new Date()):
  Promise<{ rows: EvidenceRow[]; unmapped: Array<{ source: string; count: number }> }> {
  const nowMs = now.getTime();
  const spec = await env.DB.prepare(
    `SELECT
       (SELECT p.specialization FROM partners p JOIN users u ON u.partner_id = p.id WHERE u.id = ?1) AS partner_spec,
       (SELECT a.expertise_json FROM advisors a WHERE a.user_id = ?1 ORDER BY a.id LIMIT 1) AS advisor_expertise,
       (SELECT x.categories_json FROM experts x WHERE x.user_id = ?1 ORDER BY x.id LIMIT 1) AS expert_categories`,
  ).bind(userId).first<{ partner_spec: string | null; advisor_expertise: string | null; expert_categories: string | null }>();
  const specAxes = specializationAxes([spec?.partner_spec, spec?.advisor_expertise, spec?.expert_categories]);

  const acc = new Map<string, { axis: RadarAxisSlug; source: string; n: number; win: number; w: number; first: number; last: number }>();
  const unmapped: Array<{ source: string; count: number }> = [];
  for (const src of EVIDENCE_SOURCES) {
    const res = await env.DB.prepare(src.sql).bind(userId).all<{ at: unknown; k?: unknown }>();
    let noAxis = 0;
    for (const r of res.results || []) {
      const at = parseAt(r.at);
      if (at == null) continue;
      const axes: RadarAxisSlug[] = 'fixed' in src.axes ? src.axes.fixed
        : 'byKey' in src.axes ? (src.axes.byKey[String(r.k ?? '')] || [])
        : specAxes;
      if (axes.length === 0) { noAxis += 1; continue; }
      const w = ageWeight(at, nowMs);
      const inWin = (nowMs - at) / DAY_MS <= WINDOW_DAYS ? 1 : 0;
      for (const axis of axes) {
        const id = `${axis}|${src.key}`;
        const e = acc.get(id) || { axis, source: src.key, n: 0, win: 0, w: 0, first: at, last: at };
        e.n += 1; e.win += inWin; e.w += w;
        e.first = Math.min(e.first, at); e.last = Math.max(e.last, at);
        acc.set(id, e);
      }
    }
    // Only specialization sources can have rows with no axis worth reporting:
    // a lab milestone or DD section with no skill mapping is not evidence.
    if (noAxis > 0 && 'specialization' in src.axes) unmapped.push({ source: src.key, count: noAxis });
  }
  const rows: EvidenceRow[] = [...acc.values()]
    .map((e) => ({
      axis: e.axis, source: e.source, count_lifetime: e.n, count_window: e.win,
      weighted: round(e.w, 4),
      first_at: new Date(e.first).toISOString(), last_at: new Date(e.last).toISOString(),
    }))
    .sort((a, b) => (a.axis === b.axis ? a.source.localeCompare(b.source) : a.axis.localeCompare(b.axis)));
  return { rows, unmapped };
}

/** 0..SCALE_MAX from the axis's weighted actions; null when there are none. */
export function evidenceScore(rows: EvidenceRow[]): number | null {
  if (rows.length === 0) return null;
  const weightOf = new Map(EVIDENCE_SOURCES.map((s) => [s.key, s.weight ?? 1]));
  const W = rows.reduce((s, r) => s + r.weighted * (weightOf.get(r.source) ?? 1), 0);
  return round(SCALE_MAX * (1 - Math.exp(-W / SATURATION)), 2);
}

export type BlendBasis = 'none' | 'self_rated_only' | 'evidence_only' | 'corroborated' | 'partly_corroborated';

/** The owner's "corroborate" rule (D318). */
export function blend(self: number | null, evidence: number | null): { blended: number | null; basis: BlendBasis } {
  if (self == null && evidence == null) return { blended: null, basis: 'none' };
  if (self == null) return { blended: null, basis: 'evidence_only' };
  if (evidence == null) return { blended: self, basis: 'self_rated_only' };
  if (evidence >= self) return { blended: self, basis: 'corroborated' };
  return { blended: round(self - 0.5 * (self - evidence), 2), basis: 'partly_corroborated' };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "3 pitch-deck versions saved, last in August 2026 (1 in the last 12 months)". */
export function provenanceLine(row: EvidenceRow): string {
  const src = EVIDENCE_SOURCES.find((s) => s.key === row.source);
  const noun = src ? (row.count_lifetime === 1 ? src.one : src.many) : row.source;
  const last = new Date(row.last_at);
  let line = `${row.count_lifetime} ${noun}, last in ${MONTHS[last.getUTCMonth()]} ${last.getUTCFullYear()}`;
  if (row.count_window < row.count_lifetime) line += ` (${row.count_window} in the last 12 months)`;
  return line;
}

/** The caller's self-rating per axis: the highest level among their skills on it. */
export async function selfLevels(env: Env, userId: number): Promise<Map<string, number>> {
  const res = await env.DB.prepare(
    `SELECT s.category_slug AS axis, MAX(us.self_level) AS lvl
     FROM user_skills us JOIN skills s ON s.id = us.skill_id
     WHERE us.user_id = ?1 AND us.self_level > 0
     GROUP BY s.category_slug`,
  ).bind(userId).all<{ axis: string; lvl: number }>();
  const out = new Map<string, number>();
  for (const r of res.results || []) if (AXIS_SET.has(r.axis)) out.set(r.axis, Number(r.lvl));
  return out;
}

export interface AxisEvidence {
  axis: RadarAxisSlug;
  label: string;
  self_level: number | null;
  evidence: number | null;
  blended: number | null;
  basis: BlendBasis;
  provenance: string[];
  lifetime_actions: number;
}

/** What GET /api/skills/me/evidence returns: every axis, absent drawn as absent. */
export async function evidenceReport(env: Env, userId: number, now: Date = new Date()) {
  const [{ rows, unmapped }, self] = await Promise.all([collectEvidence(env, userId, now), selfLevels(env, userId)]);
  const axes: AxisEvidence[] = RADAR_AXES.map((a) => {
    const mine = rows.filter((r) => r.axis === a.slug);
    const evidence = evidenceScore(mine);
    const s = self.has(a.slug) ? self.get(a.slug)! : null;
    const { blended, basis } = blend(s, evidence);
    return {
      axis: a.slug, label: a.label, self_level: s, evidence, blended, basis,
      provenance: [...mine].sort((x, y) => y.last_at.localeCompare(x.last_at)).map(provenanceLine),
      lifetime_actions: mine.reduce((n, r) => n + r.count_lifetime, 0),
    };
  });
  return {
    engine_version: EVIDENCE_ENGINE_VERSION,
    window_days: WINDOW_DAYS,
    half_life_days: HALF_LIFE_DAYS,
    computed_at: now.toISOString(),
    axes,
    unmapped: unmapped.map((u) => ({ ...u, note: `${u.count} not counted: your profile's specialization names no radar axis` })),
  };
}

/**
 * Write one user's evidence to `skill_evidence`. Rows are rewritten only when
 * their figures change, and rows for evidence that no longer exists are
 * removed, so running it twice at the same moment changes nothing.
 * Returns the number of rows inserted, updated or deleted.
 */
export async function recomputeUserEvidence(env: Env, userId: number, now: Date = new Date()): Promise<number> {
  const { rows } = await collectEvidence(env, userId, now);
  const existing = await env.DB.prepare(
    `SELECT axis, source, count_lifetime, count_window, weighted, first_at, last_at
     FROM skill_evidence WHERE user_id = ?1`,
  ).bind(userId).all<EvidenceRow>();
  const before = new Map((existing.results || []).map((r) => [`${r.axis}|${r.source}`, r]));
  const at = now.toISOString();
  let changed = 0;
  for (const r of rows) {
    const id = `${r.axis}|${r.source}`;
    const old = before.get(id);
    before.delete(id);
    if (old && Number(old.count_lifetime) === r.count_lifetime && Number(old.count_window) === r.count_window
      && round(Number(old.weighted), 4) === r.weighted && old.first_at === r.first_at && old.last_at === r.last_at) continue;
    await env.DB.prepare(
      `INSERT INTO skill_evidence (user_id, axis, source, count_lifetime, count_window, weighted, first_at, last_at, computed_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
       ON CONFLICT (user_id, axis, source) DO UPDATE SET
         count_lifetime = excluded.count_lifetime, count_window = excluded.count_window,
         weighted = excluded.weighted, first_at = excluded.first_at, last_at = excluded.last_at,
         computed_at = excluded.computed_at`,
    ).bind(userId, r.axis, r.source, r.count_lifetime, r.count_window, r.weighted, r.first_at, r.last_at, at).run();
    changed += 1;
  }
  for (const gone of before.values()) {
    await env.DB.prepare('DELETE FROM skill_evidence WHERE user_id = ?1 AND axis = ?2 AND source = ?3')
      .bind(userId, gone.axis, gone.source).run();
    changed += 1;
  }
  return changed;
}

/**
 * The batch entry point S14's nightly job calls. Walks users in id order from
 * the stored cursor, at most `limit` per run, and saves where it stopped; a
 * run that reaches the last user resets the cursor so the next run starts a
 * new pass. Safe to call again at any time: a user already current is left
 * untouched.
 */
export async function recomputeEvidenceBatch(env: Env, opts: { limit?: number; now?: Date } = {}) {
  const limit = Math.max(1, Math.min(200, Math.floor(opts.limit ?? 25)));
  const now = opts.now ?? new Date();
  const cur = await env.DB.prepare('SELECT last_user_id, pass_started_at FROM skill_evidence_cursor WHERE id = 1')
    .first<{ last_user_id: number; pass_started_at: string | null }>();
  const after = Number(cur?.last_user_id || 0);
  const users = await env.DB.prepare('SELECT id FROM users WHERE id > ?1 ORDER BY id LIMIT ?2')
    .bind(after, limit).all<{ id: number }>();
  const ids = (users.results || []).map((u) => Number(u.id));
  let changed = 0;
  for (const id of ids) changed += await recomputeUserEvidence(env, id, now);
  const passComplete = ids.length < limit;
  const nextCursor = passComplete ? 0 : ids[ids.length - 1];
  const passStarted = after === 0 ? now.toISOString() : (cur?.pass_started_at ?? now.toISOString());
  await env.DB.prepare(
    `INSERT INTO skill_evidence_cursor (id, last_user_id, pass_started_at, updated_at) VALUES (1, ?1, ?2, ?3)
     ON CONFLICT (id) DO UPDATE SET last_user_id = excluded.last_user_id,
       pass_started_at = excluded.pass_started_at, updated_at = excluded.updated_at`,
  ).bind(nextCursor, passStarted, now.toISOString()).run();
  return { processed: ids.length, changed, next_cursor: nextCursor, pass_complete: passComplete };
}
