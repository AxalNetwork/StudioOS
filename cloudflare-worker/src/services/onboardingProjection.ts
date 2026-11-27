/**
 * Founder onboarding → project record projection.
 *
 * THE BUG. `OnboardingFounderPage` asks 11 questions and `OnboardingWizard`
 * PUTs them as one JSON blob into `onboarding_progress.data`. Exactly one query
 * in the worker reads that column back, serving exactly one consumer: the
 * wizard rehydrating itself so a refresh resumes mid-flow. The moment
 * `completed_at` is stamped the answers are unreachable — App.jsx's routing
 * gate reads only `flow` and `completed_at`, and nothing else in the product
 * touches `data` at all. A write-only sink.
 *
 * The visible symptom is being asked twice. A founder types "what problem are
 * you solving?", "how are you solving it?" and "why now?" into the wizard, and
 * is then handed to a surface that shows the same three questions as empty
 * textareas, backed by `projects.problem_statement / solution / why_now` —
 * columns that have existed since the base schema.
 *
 * WHAT THIS PROJECTS, AND WHAT IT DELIBERATELY DOES NOT.
 *
 *   company_name  → projects.name              (required; projects.name is NOT NULL)
 *   tagline       → projects.tagline           (migration 069)
 *   problem       → projects.problem_statement ┐
 *   solution      → projects.solution          ├ the three duplicated questions
 *   why_now       → projects.why_now           ┘
 *
 * NOT projected:
 *   - `stage`. The wizard offers Idea/Prototype/MVP/Revenue/Scaling, a
 *     vocabulary that appears nowhere else in the repo, and `stage` is one of
 *     the `privilegedFields` that only admin/partner may set on
 *     PUT /projects/:id — the Lab even tells founders "stage and status are
 *     set by your Axal VC partner". Writing a founder's self-report into it
 *     would mean inventing a mapping and contradicting that rule. The honest
 *     read is that the wizard should not be asking; that is a product call,
 *     not something to paper over here.
 *   - `full_name`, `linkedin`, `journey`, `primary_need`, `notes`. The first
 *     belongs to `founders`, which `ensureRoleProfile` already seeds from the
 *     user row; the rest have no column to land in, and inventing one to hold
 *     a value nothing reads would just relocate this same bug.
 *
 * NEVER CLOBBERS. On a founder who already has a project, only columns that
 * are currently null-or-blank get filled. Onboarding answers are the weakest
 * source of truth in the system — a founder who has since edited their project
 * must not have it reverted by a re-run.
 */
import type { Env, User } from '../types';

/** The subset of `projects` columns onboarding can speak to. */
export interface ProjectSeed {
  name: string;
  tagline: string | null;
  problem_statement: string | null;
  solution: string | null;
  why_now: string | null;
}

export type ProjectionOutcome =
  | { status: 'created'; projectId: number; fields: string[] }
  | { status: 'filled'; projectId: number; fields: string[] }
  | { status: 'noop'; projectId: number }
  | { status: 'skipped'; reason: string }
  | { status: 'error'; reason: string };

/** Columns that may be back-filled onto an EXISTING project. `name` is absent
 *  on purpose: it is NOT NULL, so an existing project always has one, and
 *  onboarding must never rename a venture. */
const FILLABLE = ['tagline', 'problem_statement', 'solution', 'why_now'] as const;

const isBlank = (v: unknown): boolean => v == null || String(v).trim() === '';
const text = (v: unknown): string | null => (isBlank(v) ? null : String(v).trim());

/**
 * Map a stored wizard blob onto project columns.
 *
 * Pure and total: returns null when there is nothing worth writing, which is
 * the case whenever `company_name` is missing. The wizard marks that field
 * required, but a row can predate the validation or be seeded by an admin, and
 * `projects.name` is NOT NULL — so a missing name is a skip, not a crash.
 */
export function projectSeedFromOnboarding(data: unknown): ProjectSeed | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  const name = text(d.company_name);
  if (!name) return null;
  return {
    name,
    tagline: text(d.tagline),
    problem_statement: text(d.problem),
    solution: text(d.solution),
    why_now: text(d.why_now),
  };
}

/** Parse the `data` TEXT column, tolerating null and malformed JSON. */
function parseStoredData(raw: unknown): unknown {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/**
 * Write the founder's stored onboarding answers onto their project record.
 *
 * Best-effort by contract: every failure path returns an outcome rather than
 * throwing, because the caller is `POST /onboarding/complete` and a founder
 * must never be trapped in the wizard by a projection problem.
 */
export async function applyFounderOnboarding(env: Env, user: User): Promise<ProjectionOutcome> {
  try {
    if (user.role !== 'founder') return { status: 'skipped', reason: 'not a founder' };

    const row = await env.DB.prepare(
      `SELECT data FROM onboarding_progress WHERE user_id = ?`,
    ).bind(user.id).first<{ data: string | null }>();
    const seed = projectSeedFromOnboarding(parseStoredData(row?.data));
    if (!seed) return { status: 'skipped', reason: 'no usable answers' };

    // The founders row may not exist yet — role is set at signup but the
    // profile row is created lazily. Without it there is no founder_id to own
    // the project.
    const { ensureRoleProfile } = await import('./ensureRoleProfile');
    const { founder_id: founderId } = await ensureRoleProfile(env, user);
    if (!founderId) return { status: 'skipped', reason: 'no founder profile' };

    // Same project the Lab shows: the founder's own, oldest first. Matches
    // `pickLabProject` in SpinoutLabStartupPage.jsx, so the record the founder
    // sees is the record we filled.
    const existing = await env.DB.prepare(
      `SELECT id, tagline, problem_statement, solution, why_now
         FROM projects
        WHERE founder_id = ? AND deleted_at IS NULL
        ORDER BY created_at ASC, id ASC
        LIMIT 1`,
    ).bind(founderId).first<Record<string, unknown>>();

    if (!existing) return await createProject(env, founderId, seed);

    const projectId = Number(existing.id);
    const fields = FILLABLE.filter((col) => isBlank(existing[col]) && !isBlank(seed[col]));
    if (fields.length === 0) return { status: 'noop', projectId };

    const set = fields.map((col) => `${col} = ?`).join(', ');
    await env.DB.prepare(
      `UPDATE projects SET ${set}, updated_at = datetime('now') WHERE id = ?`,
    ).bind(...fields.map((col) => seed[col]), projectId).run();
    return { status: 'filled', projectId, fields: [...fields] };
  } catch (e: any) {
    return { status: 'error', reason: String(e?.message || e) };
  }
}

/**
 * Insert the project. `tagline` arrived in migration 069, so a dev DB stopped
 * short of it would fail the whole insert and lose the three questions this
 * exists to carry — hence the one retry without it. Same degradation the
 * `assistant_enabled` flip in routes/onboarding.ts already does.
 */
async function createProject(env: Env, founderId: number, seed: ProjectSeed): Promise<ProjectionOutcome> {
  const withTagline = ['name', 'tagline', 'problem_statement', 'solution', 'why_now'] as const;
  const attempts: readonly (readonly (keyof ProjectSeed)[])[] = [
    withTagline,
    withTagline.filter((c) => c !== 'tagline'),
  ];
  let lastError = 'insert failed';
  for (const cols of attempts) {
    try {
      const inserted = await env.DB.prepare(
        `INSERT INTO projects (${cols.join(', ')}, founder_id)
         VALUES (${cols.map(() => '?').join(', ')}, ?)
         RETURNING id`,
      ).bind(...cols.map((c) => seed[c]), founderId).first<{ id: number }>();
      if (!inserted?.id) { lastError = 'insert returned no id'; continue; }
      return {
        status: 'created',
        projectId: Number(inserted.id),
        fields: cols.filter((c) => !isBlank(seed[c])) as string[],
      };
    } catch (e: any) {
      lastError = String(e?.message || e);
      if (!/no such column/i.test(lastError)) break;
    }
  }
  return { status: 'error', reason: lastError };
}
