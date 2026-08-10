/**
 * Spin-Out Lab · Studio Ops — the founder's weekly operating cadence and the
 * week's closeout review.
 *
 * WHAT THIS IS (AND IS NOT)
 * =========================
 * There are two unrelated things in this repo called "Studio Ops":
 *
 *   1. `routes/studioops.ts` — the STUDIO's operations console. Workflow
 *      templates across Strategic / Finance / HR / Legal / Compliance, a task
 *      kanban, an audit log. Admin-owned, portfolio-wide, and reached from
 *      Command Center's Operations tab.
 *   2. This module — the LAB FOUNDER's operating rhythm. One founder, one
 *      sprint week: the meetings they commit to, whether that rhythm is locked
 *      in, and what they write down at the end of the week.
 *
 * They share a name and nothing else, which is why the Lab surface gets its own
 * store rather than borrowing `workflows` / `workflow_tasks`. A founder's
 * Monday standup is not a studio workflow, and modelling it as one would put
 * founder rows in the admin console's queue.
 *
 * WHAT IS STORED HERE AND WHAT IS NOT
 * ===================================
 * Only the two things the founder authors: the cadence and the closeout.
 * Everything else the Studio Ops page shows is DERIVED from data that already
 * exists and is therefore not duplicated here:
 *
 *   weekly focus / objective   the week catalog (`spinoutLabCatalog`)
 *   commitments + progress     the week's real deliverables, marked done by
 *                              real `spinout_lab_milestones` rows
 *   execution health           computed from those, not stored
 *   blockers                   derived from which required deliverables are
 *                              still open and how much of the week is gone
 *
 * Storing a second copy of any of those would let the Studio Ops page disagree
 * with the workspace about the same founder's week.
 *
 * ROW GRAIN: one per (user_id, week)
 * ==================================
 * Cadence is per-week rather than one standing row per founder because the
 * commitment is per-week: "we will run this rhythm THIS week" is a thing you
 * re-affirm on Monday, and a locked Week 2 must stay locked in the record after
 * Week 3 starts. `seedCadence` carries the previous week's rhythm forward so
 * re-affirming is one click, not re-typing four meetings.
 */

/** A day the cadence can land on. Index order is render order. */
export const CADENCE_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export type CadenceDay = typeof CADENCE_DAYS[number];

/**
 * `Set` is a commitment; `Proposed` is a suggestion the founder has not
 * confirmed; `Optional` is deliberately not a commitment (the solo reflection
 * slot). Locking the cadence promotes every `Proposed` row to `Set` — that
 * promotion IS what "locking" means — and leaves `Optional` alone.
 */
export const CADENCE_TAGS = ['Set', 'Proposed', 'Optional'] as const;
export type CadenceTag = typeof CADENCE_TAGS[number];

export type CadenceItem = {
  id: string;
  day: CadenceDay;
  name: string;
  time: string;
  owner: string;
  agenda: string;
  tag: CadenceTag;
};

/**
 * The closeout prompts, in render order. Fixed rather than free-form because
 * the value of a weekly review is that it asks the same four questions every
 * week — a founder-editable prompt list would drift into a diary.
 */
export const REVIEW_FIELDS = ['shipped', 'slipped', 'changed', 'next'] as const;
export type ReviewField = typeof REVIEW_FIELDS[number];
export type StudioOpsReview = Record<ReviewField, string>;

export const REVIEW_LABELS: Record<ReviewField, string> = {
  shipped: 'What shipped',
  slipped: 'What slipped',
  changed: 'What changed',
  next: 'Rolls into next week',
};

export const MAX_CADENCE_ITEMS = 12;
const MAX_NAME = 80;
const MAX_OWNER = 60;
const MAX_AGENDA = 240;
const MAX_REVIEW = 600;

/**
 * The starter rhythm, offered when a founder opens Studio Ops for a week they
 * have never set up.
 *
 * Every row ships as `Proposed` (except the optional reflection): these are a
 * suggestion, and the page says so. Nothing here is presented as something the
 * founder already agreed to — that distinction is the whole point of the
 * Set/Proposed split, and it is why locking is an explicit action rather than
 * something that happens on first load.
 *
 * Owners are ROLES ('Both founders', 'With advisor'), never names. The page has
 * no way to know who a founder's co-founder is until Co-founder Match records
 * one, and inventing a second founder's name would be a lie rendered in their
 * own workspace.
 */
export function defaultCadence(): CadenceItem[] {
  return [
    {
      id: 'standup',
      day: 'Mon',
      name: 'Async standup',
      time: '09:00',
      owner: 'Both founders',
      agenda: 'Written check-in: yesterday, today, blockers.',
      tag: 'Proposed',
    },
    {
      id: 'build-review',
      day: 'Wed',
      name: 'Build review',
      time: '15:00',
      owner: 'With advisor',
      agenda: 'Demo progress against this week’s scope.',
      tag: 'Proposed',
    },
    {
      id: 'metrics-review',
      day: 'Fri',
      name: 'Metrics review',
      time: '16:00',
      owner: 'Both founders',
      agenda: 'OKR + traction check against 90-day targets.',
      tag: 'Proposed',
    },
    {
      id: 'reflection',
      day: 'Fri',
      name: 'Founder reflection',
      time: '17:00',
      owner: 'Solo · optional',
      agenda: 'What worked, what to change next week.',
      tag: 'Optional',
    },
  ];
}

export function emptyReview(): StudioOpsReview {
  return { shipped: '', slipped: '', changed: '', next: '' };
}

/**
 * Cadence to offer for `week`, given whatever the founder last saved.
 *
 * Carrying the previous week forward keeps a locked rhythm stable across the
 * sprint; `Set` rows are demoted back to `Proposed` so the new week is an
 * explicit re-commitment rather than one inherited silently from a week that
 * has already closed.
 */
export function seedCadence(previous: CadenceItem[] | null | undefined): CadenceItem[] {
  if (!previous || previous.length === 0) return defaultCadence();
  return previous.map((it) => ({ ...it, tag: it.tag === 'Set' ? 'Proposed' : it.tag }));
}

/** Locking promotes every proposal to a commitment; optional rows stay optional. */
export function lockCadence(items: CadenceItem[]): CadenceItem[] {
  return items.map((it) => ({ ...it, tag: it.tag === 'Proposed' ? 'Set' : it.tag }));
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/**
 * A cadence time is display text, not a scheduling primitive — nothing fires
 * off it. Accept 24h `HH:MM` and normalise, reject anything else to '' rather
 * than storing a string the UI cannot align in its tabular-numeral column.
 */
function normalizeTime(v: unknown): string {
  const raw = typeof v === 'string' ? v.trim() : '';
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(raw);
  if (!m) return '';
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isInteger(h) || h < 0 || h > 23) return '';
  if (!Number.isInteger(min) || min < 0 || min > 59) return '';
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export type CadenceParse =
  | { ok: true; value: CadenceItem[] }
  | { ok: false; error: string };

/**
 * Validate a cadence submission.
 *
 * Rejects rather than silently repairs on the two things a caller could get
 * wrong in a way that loses their work — an unparseable payload and too many
 * rows — and normalises everything else (unknown day → Mon, unknown tag →
 * Proposed, over-long text → truncated), because dropping a whole save because
 * one agenda ran 3 characters long would be worse than storing the first 240.
 *
 * Ids are re-derived from the row index. They exist for React keys only; taking
 * client ids would let a caller collide two rows onto one key.
 */
export function parseCadence(input: unknown): CadenceParse {
  if (!Array.isArray(input)) return { ok: false, error: 'cadence must be an array' };
  if (input.length > MAX_CADENCE_ITEMS) {
    return { ok: false, error: `cadence is limited to ${MAX_CADENCE_ITEMS} entries` };
  }
  const value: CadenceItem[] = [];
  for (let i = 0; i < input.length; i++) {
    const raw = (input[i] ?? {}) as Record<string, unknown>;
    const name = str(raw.name, MAX_NAME);
    // A nameless row renders as an empty line the founder cannot click or
    // remove, so drop it instead of storing it.
    if (!name) continue;
    const day = CADENCE_DAYS.includes(raw.day as CadenceDay) ? (raw.day as CadenceDay) : 'Mon';
    const tag = CADENCE_TAGS.includes(raw.tag as CadenceTag) ? (raw.tag as CadenceTag) : 'Proposed';
    value.push({
      id: `c${i}`,
      day,
      name,
      time: normalizeTime(raw.time),
      owner: str(raw.owner, MAX_OWNER),
      agenda: str(raw.agenda, MAX_AGENDA),
      tag,
    });
  }
  return { ok: true, value };
}

/** Coerce any input to the four known review fields; unknown keys are dropped. */
export function parseReview(input: unknown): StudioOpsReview {
  const raw = (input ?? {}) as Record<string, unknown>;
  const out = emptyReview();
  for (const f of REVIEW_FIELDS) out[f] = str(raw[f], MAX_REVIEW);
  return out;
}

/** Read a stored JSON column back, falling back to `fallback` on any damage. */
export function readJsonColumn<T>(text: unknown, fallback: T): T {
  if (typeof text !== 'string' || !text) return fallback;
  try {
    const parsed = JSON.parse(text);
    return parsed == null ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

/** True when the founder has written anything at all in the closeout. */
export function reviewHasContent(review: StudioOpsReview): boolean {
  return REVIEW_FIELDS.some((f) => Boolean(review[f]));
}
