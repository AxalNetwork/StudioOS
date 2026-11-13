/**
 * The Spin-Out Lab application's answers and the applicant's view of it —
 * the pure half (D383). No Hono, no D1: the routes call these, and the tests
 * call them directly.
 *
 * THE ANSWERS are steps 2–5 of the Apply & Status canvas (step 1, the venture
 * basics, is the existing company / idea / incorporated / stage / jurisdiction
 * columns). Every choice is an enum the canvas names, so a stored answer is
 * one of a closed set and the admin reads the same words the applicant chose.
 * Free text is clipped, never rejected for length: a long answer is still an
 * answer.
 *
 * WHAT AN APPLICANT MAY SEE. `applicantView` builds the `/state` block from
 * the application row, its pool row, the pool's cycle and the live interview.
 * It never reads `cohort_applicants.decision_reason`: that column is the
 * admin's required note and carries system text ("Legacy admin decision",
 * capacity roll-forwards). The applicant-facing reason is `applicant_note`,
 * which an admin writes for them on purpose.
 */

export const ORIGINS = ['university', 'corporate', 'independent'] as const;
export const TTO_STATUSES = ['not_disclosed', 'disclosed', 'negotiating', 'signed', 'not_applicable'] as const;
export const IP_FLAGS = [
  'patent_filed', 'patent_granted', 'inventors_identified', 'background_separated', 'publication_pending',
] as const;

export type Answers = {
  origin: (typeof ORIGINS)[number] | null;
  institution: string | null;
  research_group: string | null;
  tto_status: (typeof TTO_STATUSES)[number] | null;
  ip: Array<(typeof IP_FLAGS)[number]>;
  team_size: number | null;
  team_roles: string | null;
  commercial_lead: boolean | null;
  traction: string | null;
  why_axal: string | null;
};

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};
const oneOf = <T extends readonly string[]>(v: unknown, set: T): T[number] | null =>
  (typeof v === 'string' && (set as readonly string[]).includes(v) ? (v as T[number]) : null);

/**
 * Normalise whatever the client sent into the stored shape. Unknown keys are
 * dropped; unknown enum values become null (not recorded) rather than being
 * stored as typed. Never throws.
 */
export function normaliseAnswers(raw: unknown): Answers {
  const a = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const ip = Array.isArray(a.ip)
    ? [...new Set(a.ip.filter((x): x is (typeof IP_FLAGS)[number] =>
        typeof x === 'string' && (IP_FLAGS as readonly string[]).includes(x)))]
    : [];
  const size = Number(a.team_size);
  return {
    origin: oneOf(a.origin, ORIGINS),
    institution: text(a.institution, 200),
    research_group: text(a.research_group, 200),
    tto_status: oneOf(a.tto_status, TTO_STATUSES),
    ip,
    team_size: Number.isInteger(size) && size >= 1 && size <= 50 ? size : null,
    team_roles: text(a.team_roles, 2000),
    commercial_lead: typeof a.commercial_lead === 'boolean' ? a.commercial_lead : null,
    traction: text(a.traction, 4000),
    why_axal: text(a.why_axal, 4000),
  };
}

/**
 * What a SUBMITTED application must carry beyond step 1. Traction is optional
 * throughout (the canvas says so); origin, team and why-Axal are not. A TTO
 * status is required only when the origin is an institution — an independent
 * build has no transfer office to report on.
 */
export function missingForSubmit(a: Answers): string[] {
  const missing: string[] = [];
  if (!a.origin) missing.push('origin');
  if (a.origin && a.origin !== 'independent' && !a.tto_status) missing.push('tto_status');
  if (a.origin === 'university' && !a.institution) missing.push('institution');
  if (a.team_size == null) missing.push('team_size');
  if (!a.why_axal) missing.push('why_axal');
  return missing;
}

/** Parse a stored JSON column, null on anything that is not an object. */
export function parseStoredAnswers(json: unknown): Answers | null {
  if (typeof json !== 'string' || !json) return null;
  try {
    const v = JSON.parse(json);
    return v && typeof v === 'object' && !Array.isArray(v) ? normaliseAnswers(v) : null;
  } catch {
    return null;
  }
}

/** Up to three applicant-facing asks, each clipped; blanks dropped. */
export function normaliseAsks(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => text(x, 500)).filter((x): x is string => !!x).slice(0, 3);
}

export function parseStoredAsks(json: unknown): string[] {
  if (typeof json !== 'string' || !json) return [];
  try { return normaliseAsks(JSON.parse(json)); } catch { return []; }
}

export type ApplicationRowForView = {
  id: number;
  status: string;
  created_at: string | null;
  decided_at: string | null;
  withdrawn_at?: string | null;
  answers_json?: string | null;
  applicant_note?: string | null;
  applicant_asks_json?: string | null;
  applicant_note_at?: string | null;
};
export type PoolRowForView = {
  status: string;
  decided_at: string | null;
  cycle_label: string | null;
  cycle_app_status: string | null;
  cycle_start_at: string | null;
  cycle_close_at: string | null;
  // Deliberately absent: decision_reason. See the module comment.
} | null;
export type InterviewRowForView = {
  id: number;
  scheduled_at: string;
  duration_min: number;
  location: string | null;
  note: string | null;
  status: string;
  reschedule_requested_at: string | null;
} | null;

/** The applicant's own view of their application, for `/state`. */
export function applicantView(
  app: ApplicationRowForView | null,
  pool: PoolRowForView,
  interview: InterviewRowForView,
  reapply: { label: string; opens_at: string; closes_at: string } | null,
) {
  if (!app) return null;
  const declined = app.status === 'refused' || pool?.status === 'rejected';
  return {
    application_id: app.id,
    status: app.status,
    submitted_at: app.created_at,
    decided_at: app.decided_at,
    withdrawn_at: app.withdrawn_at ?? null,
    answers: parseStoredAnswers(app.answers_json),
    // NULL answers on an application made before migration 315 mean the
    // applicant was never asked, which the page says — not "left blank".
    answers_recorded: typeof app.answers_json === 'string' && !!app.answers_json,
    pool: pool
      ? {
          status: pool.status,
          decided_at: pool.decided_at,
          cycle: {
            label: pool.cycle_label,
            app_status: pool.cycle_app_status,
            start_at: pool.cycle_start_at,
            close_at: pool.cycle_close_at,
          },
        }
      : null,
    note: app.applicant_note
      ? { text: app.applicant_note, asks: parseStoredAsks(app.applicant_asks_json), at: app.applicant_note_at ?? null }
      : null,
    interview: interview && interview.status !== 'cancelled' ? interview : null,
    reapply: declined ? reapply : null,
  };
}
