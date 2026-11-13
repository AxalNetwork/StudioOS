/**
 * D4650 (#4650, part 2) — a course's structured metadata: who it is for, what
 * it teaches, what it assumes, who wrote and reviewed it, and what the learner
 * leaves with. One reader and one validator, shared by the authoring routes
 * (`routes/admin_learning.ts`) and the member's course read (`routes/learning.ts`).
 *
 * Nothing here is inferred. A field the author has not filled reads as not
 * recorded (null, or an empty list), and the learner view says so; the course's
 * summary and resources are separate and untouched.
 */

/** The journeys the Learning audit names (#4650): a course says which of them it serves. */
export const COURSE_AUDIENCES = ['founder', 'investor', 'advisor', 'partner'] as const;
export type CourseAudience = (typeof COURSE_AUDIENCES)[number];

export const META_LIMITS = Object.freeze({ stage: 120, sentence: 200, sentences: 8, person: 120, output: 300 });

/** The columns, in the order the routes select and patch them. */
export const COURSE_META_COLUMNS = ['audience_json', 'stage', 'outcomes_json', 'prerequisites_json', 'author_name', 'reviewer_name', 'reviewed_on', 'practical_output'] as const;
export const COURSE_META_SELECT = COURSE_META_COLUMNS.join(', ');

export type CourseMeta = {
  audience: CourseAudience[];
  stage: string | null;
  outcomes: string[];
  prerequisites: string[];
  author: string | null;
  reviewer: string | null;
  reviewed_on: string | null;
  practical_output: string | null;
};

export class MetaInvalid extends Error {
  code: string;
  reason: string;
  constructor(code: string, reason: string) { super(reason); this.code = code; this.reason = reason; }
}
const bad = (code: string, reason: string): never => { throw new MetaInvalid(code, reason); };

function line(v: unknown, max: number, field: string): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string') bad(`bad_${field}`, `${field} is text, up to ${max} characters.`);
  const t = (v as string).trim();
  if (t.length > max) bad(`bad_${field}`, `${field} is text, up to ${max} characters.`);
  return t || null;
}

function sentences(v: unknown, field: string): string | undefined {
  if (v === undefined) return undefined;
  if (v === null) return '[]';
  const message = `${field} is a list of up to ${META_LIMITS.sentences} lines, each up to ${META_LIMITS.sentence} characters.`;
  if (!Array.isArray(v) || v.length > META_LIMITS.sentences) bad(`bad_${field}`, message);
  const out: string[] = [];
  for (const x of v as unknown[]) {
    if (typeof x !== 'string') bad(`bad_${field}`, message);
    const t = (x as string).trim();
    if (t.length > META_LIMITS.sentence) bad(`bad_${field}`, message);
    if (t) out.push(t);
  }
  return JSON.stringify(out);
}

function isoDate(v: unknown, today: string): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const message = 'reviewed_on is a date, YYYY-MM-DD, not in the future.';
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) bad('bad_reviewed_on', message);
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v || v > today) bad('bad_reviewed_on', message);
  return v as string;
}

/**
 * The metadata a create or a patch writes, by column. A key the body leaves out
 * is undefined (not written); `null` or an empty list clears the field.
 */
export function courseMetaFields(b: any, today = new Date().toISOString().slice(0, 10)): Partial<Record<(typeof COURSE_META_COLUMNS)[number], string | null>> {
  let audience_json: string | undefined;
  if (b?.audience !== undefined) {
    const list = b.audience === null ? [] : b.audience;
    if (!Array.isArray(list) || list.some((x: unknown) => !(COURSE_AUDIENCES as readonly unknown[]).includes(x))) {
      bad('bad_audience', `audience is a list of ${COURSE_AUDIENCES.join(', ')}.`);
    }
    audience_json = JSON.stringify(COURSE_AUDIENCES.filter((a) => list.includes(a)));
  }
  return {
    audience_json,
    stage: line(b?.stage, META_LIMITS.stage, 'stage'),
    outcomes_json: sentences(b?.outcomes, 'outcomes'),
    prerequisites_json: sentences(b?.prerequisites, 'prerequisites'),
    author_name: line(b?.author, META_LIMITS.person, 'author'),
    reviewer_name: line(b?.reviewer, META_LIMITS.person, 'reviewer'),
    reviewed_on: isoDate(b?.reviewed_on, today),
    practical_output: line(b?.practical_output, META_LIMITS.output, 'practical_output'),
  };
}

function list(raw: unknown): string[] {
  try {
    const v = JSON.parse(typeof raw === 'string' ? raw : '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

/** What a course row says, as the API answers it. */
export function courseMetaView(row: Record<string, unknown>): CourseMeta {
  return {
    audience: list(row.audience_json).filter((a): a is CourseAudience => (COURSE_AUDIENCES as readonly string[]).includes(a)),
    stage: (row.stage as string | null) ?? null,
    outcomes: list(row.outcomes_json),
    prerequisites: list(row.prerequisites_json),
    author: (row.author_name as string | null) ?? null,
    reviewer: (row.reviewer_name as string | null) ?? null,
    reviewed_on: (row.reviewed_on as string | null) ?? null,
    practical_output: (row.practical_output as string | null) ?? null,
  };
}
