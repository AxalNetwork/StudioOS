/**
 * D954 §10 (#2787) — EACH PROGRAM'S ACTIVITY: PG4's Recent activity and every
 * program's Activity tab, newest first, paged.
 *
 * THE ROWS ARE THE ADMIN AUDIT'S. A program's Activity lists the
 * `admin_audit_log` rows whose action is in that program's list below, plus
 * the registry and playbook writes made on that program. Refer & Earn's also
 * reads the timeline rows its admin review writes (`referral_submission_events`
 * with an admin as `actor_user_id`), so the review needs no audit row.
 *
 * NO PERSON IS NAMED. `by` is `hq` when the admin holds the Super Admin
 * elevation today, and `admin` otherwise (PG4's "by an admin", dc:376). What a
 * row concerns is named as the program's page names it: a Learning program by
 * its name, a program by its key, a referral by its uid and status, a mentor's
 * cohort access by its cohort cycle (never the mentor).
 *
 * A WRITE THAT IS NOT AUDITED YET IS SAID, never shown as an empty list.
 * `NOT_AUDITED_YET` names it per program with the part that adds its audit
 * rows; that part also adds its action names to `PROGRAM_ACTIVITY_ACTIONS`.
 *
 * ON LEARNING AN ADMIN READS ONLY THE PROGRAMS ASSIGNED TO THEM, as
 * `GET /api/learning/programs/mine` scopes them. A Super Admin reads every row.
 */
import type { Env } from '../types';
import { PROPOSAL_ACTIONS, REGISTRY_ACTIONS, type ProgramKey } from './programRegistry';

/** Mentor cohort access's audited writes (D960, `routes/advisors.ts`): giving a mentor a cohort, and ending it. */
export const MENTOR_ACCESS_ACTIONS = ['advisor_cohort.assigned', 'advisor_cohort.ended'] as const;

/** Learning's audited writes (`routes/admin_learning_programs.ts`). */
export const LEARNING_PROGRAM_ACTIONS = [
  'learning.program.create', 'learning.program.update', 'learning.program.contents',
  'learning.program.admin.assign', 'learning.program.admin.unassign',
  'learning.program.enrol', 'learning.program.unenrol',
] as const;

/**
 * Each program's own audited actions. The registry and playbook writes are
 * every program's, matched on the program's key, so they are not repeated here.
 */
export const PROGRAM_ACTIVITY_ACTIONS: Record<ProgramKey, readonly string[]> = {
  'spinout-lab': [],
  'ai-native-venture': [],
  'mentor-cohorts': MENTOR_ACCESS_ACTIONS,
  'investor-cohorts': [],
  'referral-partners': [],
  'refer-and-earn': [],
  perks: [],
  learning: LEARNING_PROGRAM_ACTIONS,
  'product-testing': [],
};

/** Writes on a program's page that the audit does not record yet, and who adds them. */
export const NOT_AUDITED_YET: Partial<Record<ProgramKey, string>> = {
  perks: 'Perk listing reviews are not written to the admin audit yet. Part 4 (#2790) adds them.',
};

export const ACTIVITY_LIMIT_MAX = 50;

// Matched on each row's program_key. D955 adds the decision on a proposal and New program,
// whose rows name the program they made; a send names none.
const REGISTRY_ACTION_LIST = [...Object.values(REGISTRY_ACTIONS), PROPOSAL_ACTIONS.decide, PROPOSAL_ACTIONS.create];
const SOURCES = ['a', 'r'] as const; // admin audit, referral review
type Source = typeof SOURCES[number];

export type ActivityCursor = { at: string; src: Source; id: number };

const CURSOR_RE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})~([ar]):(\d{1,15})$/;

export function parseActivityQuery(get: (k: string) => string | undefined):
  { ok: true; before: ActivityCursor | null; limit: number } | { ok: false; code: string; detail: string } {
  const rawLimit = get('limit');
  const limit = rawLimit === undefined || rawLimit === '' ? ACTIVITY_LIMIT_MAX : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > ACTIVITY_LIMIT_MAX || (rawLimit && String(limit) !== rawLimit)) {
    return { ok: false, code: 'bad_limit', detail: `limit is a whole number from 1 to ${ACTIVITY_LIMIT_MAX}.` };
  }
  const raw = get('before');
  if (raw === undefined || raw === '') return { ok: true, before: null, limit };
  const m = CURSOR_RE.exec(raw);
  if (!m) return { ok: false, code: 'bad_cursor', detail: 'before is the next_before value a previous page returned.' };
  return { ok: true, before: { at: m[1], src: m[2] as Source, id: Number(m[3]) }, limit };
}

const cursorOf = (r: { at: string; src: Source; id: number }) => `${r.at}~${r.src}:${r.id}`;

/**
 * The rows of `src` strictly after the cursor in (at, src, id) descending
 * order: an earlier `at`, or the same `at` and a lower id within a source that
 * the order puts at or after the cursor's.
 */
function bounds(before: ActivityCursor | null, src: Source): [string, number] {
  if (!before) return ['9999-12-31 23:59:59', Number.MAX_SAFE_INTEGER];
  const tie = src < before.src ? Number.MAX_SAFE_INTEGER : src === before.src ? before.id : 0;
  return [before.at, tie];
}

type Row = { src: Source; id: number; at: string; kind: string; by: 'hq' | 'admin'; concerns: Record<string, unknown> };

function detailsOf(raw: unknown): Record<string, unknown> {
  try {
    const v = JSON.parse(String(raw ?? '{}'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

async function auditRows(env: Env, key: string, before: ActivityCursor | null, limit: number, learningScope: string[] | null) {
  // A program an approval or New program added (D955) has no actions of its own yet.
  const own = (PROGRAM_ACTIVITY_ACTIONS as Record<string, readonly string[] | undefined>)[key] ?? [];
  const [at, tie] = bounds(before, 'a');
  // `json_valid` first: a row whose details are not JSON is skipped by the
  // match rather than failing the whole read.
  const res = await env.DB.prepare(
    `SELECT a.id, datetime(a.exported_at) AS at, a.action, a.filters_json,
            CASE WHEN EXISTS (SELECT 1 FROM super_admins s WHERE s.user_id = a.admin_user_id) THEN 'hq' ELSE 'admin' END AS by_who
       FROM admin_audit_log a
      WHERE ((a.action IN (SELECT value FROM json_each(?))
              AND json_valid(a.filters_json) AND json_extract(a.filters_json, '$.program_key') = ?)
          OR (a.action IN (SELECT value FROM json_each(?))
              AND (? IS NULL OR (json_valid(a.filters_json)
                                 AND json_extract(a.filters_json, '$.uid') IN (SELECT value FROM json_each(?))))))
        AND (datetime(a.exported_at) < datetime(?) OR (datetime(a.exported_at) = datetime(?) AND a.id < ?))
      ORDER BY datetime(a.exported_at) DESC, a.id DESC
      LIMIT ?`,
  ).bind(
    JSON.stringify(REGISTRY_ACTION_LIST), key,
    JSON.stringify(own), learningScope ? 1 : null, JSON.stringify(learningScope ?? []),
    at, at, tie, limit,
  ).all<{ id: number; at: string; action: string; filters_json: string | null; by_who: 'hq' | 'admin' }>();
  return (res.results || []).map((r): Row & { details: Record<string, unknown> } => ({
    src: 'a', id: Number(r.id), at: r.at, kind: r.action, by: r.by_who === 'hq' ? 'hq' : 'admin',
    concerns: {}, details: detailsOf(r.filters_json),
  }));
}

async function referralReviewRows(env: Env, before: ActivityCursor | null, limit: number): Promise<Row[]> {
  const [at, tie] = bounds(before, 'r');
  // An admin's review, never the referrer's own submission or added context.
  const res = await env.DB.prepare(
    `SELECT e.id, datetime(e.created_at) AS at, e.status, s.uid AS submission_uid, s.category,
            CASE WHEN EXISTS (SELECT 1 FROM super_admins sa WHERE sa.user_id = e.actor_user_id) THEN 'hq' ELSE 'admin' END AS by_who
       FROM referral_submission_events e
       JOIN referral_submissions s ON s.id = e.submission_id
       JOIN users u ON u.id = e.actor_user_id
      WHERE e.actor_user_id <> s.referrer_user_id AND lower(u.role) = 'admin'
        AND (datetime(e.created_at) < datetime(?) OR (datetime(e.created_at) = datetime(?) AND e.id < ?))
      ORDER BY datetime(e.created_at) DESC, e.id DESC
      LIMIT ?`,
  ).bind(at, at, tie, limit).all<{ id: number; at: string; status: string | null; submission_uid: string; category: string; by_who: string }>();
  return (res.results || []).map((r) => ({
    src: 'r', id: Number(r.id), at: r.at, kind: 'referral.review', by: r.by_who === 'hq' ? 'hq' : 'admin',
    concerns: { referral: r.submission_uid, category: r.category, status: r.status ?? null },
  }));
}

/** Learning programs by uid, for naming the rows. Names only, never a person. */
async function learningNames(env: Env, uids: string[]): Promise<Map<string, string>> {
  if (!uids.length) return new Map();
  const res = await env.DB.prepare('SELECT uid, name FROM learning_programs WHERE uid IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify([...new Set(uids)])).all<{ uid: string; name: string }>();
  return new Map((res.results || []).map((r) => [r.uid, r.name]));
}

/** The uids of the Learning programs an Admin is assigned to follow. */
export async function assignedLearningUids(env: Env, userId: number): Promise<string[]> {
  const res = await env.DB.prepare(
    `SELECT p.uid FROM learning_programs p
      WHERE p.id IN (SELECT program_id FROM learning_program_admins WHERE user_id = ?)`,
  ).bind(userId).all<{ uid: string }>();
  return (res.results || []).map((r) => r.uid);
}

/**
 * GET /api/admin/programs/:key/activity — one page, newest first, with the
 * cursor for the next. `viewer.superAdmin` lifts Learning's assigned scope.
 */
export async function programActivity(
  env: Env, key: string, viewer: { id: number; superAdmin: boolean },
  q: { before: ActivityCursor | null; limit: number },
) {
  const scope = key === 'learning' && !viewer.superAdmin ? await assignedLearningUids(env, viewer.id) : null;
  const [audit, reviews] = await Promise.all([
    auditRows(env, key, q.before, q.limit + 1, scope),
    key === 'refer-and-earn' ? referralReviewRows(env, q.before, q.limit + 1) : Promise.resolve([] as Row[]),
  ]);
  const merged: Array<Row & { details?: Record<string, unknown> }> = [...audit, ...reviews]
    .sort((x, y) => (x.at === y.at ? (x.src === y.src ? y.id - x.id : (x.src < y.src ? 1 : -1)) : (x.at < y.at ? 1 : -1)));
  const page = merged.slice(0, q.limit);
  const names = await learningNames(env, page.map((r) => String(r.details?.uid ?? '')).filter(Boolean));
  const rows = page.map((r) => {
    let concerns = r.concerns;
    if (r.src === 'a') {
      const d = r.details ?? {};
      if (typeof d.program_key === 'string') {
        concerns = {
          program: d.program_key,
          ...(typeof d.section === 'string' ? { section: d.section } : {}),
          ...(typeof d.version === 'number' ? { version: d.version } : {}),
          ...(typeof d.outcome === 'string' ? { outcome: d.outcome } : {}),
          ...(Array.isArray(d.fields) ? { fields: d.fields.filter((x) => typeof x === 'string') } : {}),
        };
      } else if (typeof d.uid === 'string') {
        concerns = { learning_program: { uid: d.uid, name: names.get(d.uid) ?? null } };
      } else if (typeof d.cohort_cycle_id === 'number') {
        // D960's rows name the cohort; the mentor in `target_user_id` is a person, so is never named.
        concerns = { cohort_cycle_id: d.cohort_cycle_id };
      }
    }
    return { at: r.at, kind: r.kind, by: r.by, concerns };
  });
  const more = merged.length > q.limit;
  const not = (NOT_AUDITED_YET as Record<string, string | undefined>)[key];
  return {
    program: key,
    rows,
    next_before: more && page.length ? cursorOf(page[page.length - 1]) : null,
    not_audited: not ? { recorded: false as const, reason: not } : null,
    ...(scope ? { scope: 'assigned' as const } : {}),
  };
}
