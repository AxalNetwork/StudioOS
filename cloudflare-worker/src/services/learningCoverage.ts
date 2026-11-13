/**
 * D4650 (#4650, part 4) — the curriculum coverage record: how far the live course catalogue covers
 * the founder, investor, advisor and partner journeys, read from each course's title, status,
 * visibility and part 2's audience and stage (`learningCourseMeta.ts`). No learner data is read.
 *
 * Each journey gets one state, and the courses behind it:
 *
 *   published     at least one published, open course names the journey.
 *   inaccessible  courses name it, but none a member can reach: each is a draft, archived, or
 *                 published for program members only.
 *   unknown       no course names it, but some course records no audience, so it may serve the
 *                 journey. A course without an audience is never counted as missing material.
 *   missing       every course in the catalogue records an audience, and none names the journey.
 *
 * A published, open course with no audience outranks an inaccessible tag: it may be the published
 * material, so the journey reads unknown, not inaccessible. When the catalogue is larger than the
 * read's cap (`truncated`), a journey is never called missing.
 */
import type { Env } from '../types';
import { COURSE_AUDIENCES, type CourseAudience } from './learningCourseMeta';

export const COVERAGE_STATES = ['published', 'inaccessible', 'unknown', 'missing'] as const;
export type CoverageState = (typeof COVERAGE_STATES)[number];

/** Why a course that names a journey does not reach its members. */
export type Inaccessible = 'draft' | 'archived' | 'program_only';

/** The most courses one read takes. One more is asked for, to tell a full catalogue from a cut one. */
export const COVERAGE_CAP = 5000;

export type CoverageRow = {
  uid: string; slug: string; title: string; status: string; visibility: string;
  audience_json?: unknown; stage?: string | null;
};

export type CoverageCourse = {
  uid: string; slug: string; title: string; status: string; visibility: string;
  stage: string | null; reason?: Inaccessible;
};

export type JourneyCoverage = {
  journey: CourseAudience;
  state: CoverageState;
  published: CoverageCourse[];
  inaccessible: CoverageCourse[];
  /** Courses that record no audience, so may or may not serve this journey. */
  unknown: number;
  /** The stages the published courses record, once each, and how many record none. */
  stages: string[];
  stage_not_recorded: number;
};

export type Coverage = {
  journeys: JourneyCoverage[];
  courses: number;
  audience_not_recorded: CoverageCourse[];
  /** False when the catalogue has no audience column yet (before migration 202611071012). */
  audience_recorded: boolean;
  truncated: boolean;
};

/** The journeys a stored audience names; anything unparseable or outside the list names none. */
function audienceOf(raw: unknown): CourseAudience[] {
  try {
    const v = JSON.parse(typeof raw === 'string' ? raw : '[]');
    return Array.isArray(v) ? COURSE_AUDIENCES.filter((a) => v.includes(a)) : [];
  } catch { return []; }
}

const reachable = (r: CoverageRow) => r.status === 'published' && r.visibility === 'open';

function reasonOf(r: CoverageRow): Inaccessible {
  if (r.status === 'draft') return 'draft';
  if (r.status === 'archived') return 'archived';
  return 'program_only';
}

function courseOf(r: CoverageRow, reason?: Inaccessible): CoverageCourse {
  const out: CoverageCourse = {
    uid: r.uid, slug: r.slug, title: r.title, status: r.status, visibility: r.visibility,
    stage: typeof r.stage === 'string' && r.stage.trim() ? r.stage.trim() : null,
  };
  if (reason) out.reason = reason;
  return out;
}

/** The record, from the catalogue's rows. Pure: the route reads, this classifies. */
export function courseCoverage(rows: CoverageRow[], opts: { audienceRecorded?: boolean; truncated?: boolean } = {}): Coverage {
  const audienceRecorded = opts.audienceRecorded !== false;
  const truncated = opts.truncated === true;
  const tagged = rows.map((r) => ({ r, audience: audienceRecorded ? audienceOf(r.audience_json) : [] }));
  const untagged = tagged.filter((t) => t.audience.length === 0).map((t) => t.r);
  const untaggedReachable = untagged.some(reachable);

  const journeys = COURSE_AUDIENCES.map((journey): JourneyCoverage => {
    const mine = tagged.filter((t) => t.audience.includes(journey)).map((t) => t.r);
    const published = mine.filter(reachable).map((r) => courseOf(r));
    const inaccessible = mine.filter((r) => !reachable(r)).map((r) => courseOf(r, reasonOf(r)));
    let state: CoverageState;
    if (published.length) state = 'published';
    else if (untaggedReachable) state = 'unknown';
    else if (inaccessible.length) state = 'inaccessible';
    else if (untagged.length || truncated) state = 'unknown';
    else state = 'missing';
    const stages = [...new Set(published.map((p) => p.stage).filter((s): s is string => s !== null))];
    return {
      journey, state, published, inaccessible, unknown: untagged.length,
      stages, stage_not_recorded: published.filter((p) => p.stage === null).length,
    };
  });

  return {
    journeys,
    courses: rows.length,
    audience_not_recorded: untagged.map((r) => courseOf(r)),
    audience_recorded: audienceRecorded,
    truncated,
  };
}

const MISSING_COLUMN = /no such column|has no column/i;

const COVERAGE_SQL = 'SELECT uid, slug, title, status, visibility, audience_json, stage FROM learning_courses ORDER BY title COLLATE NOCASE, id LIMIT ?';
const COVERAGE_SQL_NO_META = 'SELECT uid, slug, title, status, visibility FROM learning_courses ORDER BY title COLLATE NOCASE, id LIMIT ?';

/**
 * Reads the catalogue and classifies it. Throws when the catalogue cannot be read: the route
 * answers that as Unreadable, never as an empty catalogue. A schema from before the audience
 * column reads every course as recording no audience.
 */
export async function readCoverage(env: Env): Promise<Coverage> {
  let rows: CoverageRow[];
  let audienceRecorded = true;
  try {
    rows = ((await env.DB.prepare(COVERAGE_SQL).bind(COVERAGE_CAP + 1).all<CoverageRow>()).results || []) as CoverageRow[];
  } catch (e) {
    if (!MISSING_COLUMN.test(String((e as Error)?.message ?? e))) throw e;
    audienceRecorded = false;
    rows = ((await env.DB.prepare(COVERAGE_SQL_NO_META).bind(COVERAGE_CAP + 1).all<CoverageRow>()).results || []) as CoverageRow[];
  }
  const truncated = rows.length > COVERAGE_CAP;
  return courseCoverage(truncated ? rows.slice(0, COVERAGE_CAP) : rows, { audienceRecorded, truncated });
}
