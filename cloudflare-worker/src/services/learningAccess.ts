/**
 * D557 (#1158) — who may see a piece of Learning content, and what a Super
 * Admin may put in one.
 *
 * ONE FUNCTION DECIDES VISIBILITY. Every member read in `routes/learning.ts`
 * (the catalog, a course, an item, the progress write) asks
 * `canSeeLearning`, so the catalog cannot list what the item route then
 * refuses, and #1159 extends a single place when programs arrive.
 *
 *   - A draft or archived subject is the Super Admin's only.
 *   - Published `open` content is every signed-in member's.
 *   - Published `program` content is a member's when they are enrolled
 *     (D558, #1159): the route reads that fact with `enrolledSql` and hands it
 *     over as `subject.enrolled`, so this stays one synchronous check.
 */
import { isSuperAdmin } from '../auth';

export const LEARNING_STATUSES = ['draft', 'published', 'archived'] as const;
export const LEARNING_VISIBILITIES = ['open', 'program'] as const;
export const LEARNING_LEVELS = ['intro', 'intermediate', 'advanced'] as const;
export const ITEM_KINDS = ['video', 'reading'] as const;
export const LESSON_KINDS = ['video', 'reading', 'exercise', 'exam', 'webinar'] as const;
export const PROGRESS_KINDS = ['item', 'lesson', 'course'] as const;

/** `enrolled` is the `enrolledSql` column: 1 when the viewer may open this program content. */
export type LearningSubject = { status?: string | null; visibility?: string | null; enrolled?: unknown };

export function canSeeLearning(user: unknown, subject: LearningSubject | null | undefined): boolean {
  if (!subject) return false;
  if (user && isSuperAdmin(user as any)) return true;
  if (subject.status !== 'published') return false;
  if (subject.visibility === 'open') return true;
  return subject.visibility === 'program' && (subject.enrolled === true || Number(subject.enrolled) === 1);
}

// ---- programs (D558, #1159) -----------------------------------------------------------

export const PROGRAM_SUBJECT_KINDS = ['course', 'item', 'exam', 'exercise', 'webinar'] as const;
export type ProgramSubjectKind = 'course' | 'item' | 'exam' | 'exercise';

/** The lesson kinds through which a course carries a subject of each kind. */
const LESSON_KINDS_FOR: Record<Exclude<ProgramSubjectKind, 'course'>, string> = {
  item: "'video', 'reading'",
  exam: "'exam'",
  exercise: "'exercise'",
};

/**
 * A condition on `pc` (a `learning_program_contents` row): the program holds
 * the subject whose uid is the SQL expression `uidExpr`, either directly or as
 * the target of a lesson in a course it holds. Binds nothing itself.
 */
export function programHoldsSql(kind: ProgramSubjectKind, uidExpr: string): string {
  const direct = `(pc.subject_kind = '${kind}' AND pc.subject_uid = ${uidExpr})`;
  if (kind === 'course') return direct;
  return `(${direct} OR (pc.subject_kind = 'course' AND EXISTS (SELECT 1 FROM learning_courses hc
      JOIN learning_course_modules hm ON hm.course_id = hc.id
      JOIN learning_lessons hl ON hl.module_id = hm.id
     WHERE hc.uid = pc.subject_uid AND hl.ref_uid = ${uidExpr} AND hl.kind IN (${LESSON_KINDS_FOR[kind]}))))`;
}

/**
 * 1 when the user bound to its single `?` is actively enrolled in a published
 * program that holds the subject at `uidExpr`; select it `AS enrolled` and
 * pass the row to `canSeeLearning`.
 */
export function enrolledSql(kind: ProgramSubjectKind, uidExpr: string): string {
  return `EXISTS (SELECT 1 FROM learning_program_contents pc
      JOIN learning_programs pp ON pp.id = pc.program_id AND pp.status = 'published'
      JOIN learning_enrollments pe ON pe.program_id = pc.program_id AND pe.status = 'active' AND pe.user_id = ?
     WHERE ${programHoldsSql(kind, uidExpr)})`;
}

/** Whether a viewer is an admin assigned to this program (by id). The Super Admin is not "assigned"; check that first. */
export async function isAssignedAdmin(env: any, viewer: any, programId: number): Promise<boolean> {
  if (!viewer || String(viewer.role ?? '').toLowerCase() !== 'admin') return false;
  const row = await env.DB.prepare('SELECT 1 AS ok FROM learning_program_admins WHERE program_id = ? AND user_id = ?')
    .bind(programId, Number(viewer.id)).first();
  return Boolean(row);
}

/**
 * The hosts a video may be linked from. Exact names, plus Cloudflare Stream's
 * customer subdomains. Anything else, or any non-https URL, is refused: the
 * player embeds this URL, so it is the one place a write could point a
 * member's browser somewhere unvetted.
 */
export const VIDEO_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be',
  'vimeo.com', 'www.vimeo.com', 'player.vimeo.com', 'videodelivery.net'] as const;

export function allowedVideoUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  const ok = (VIDEO_HOSTS as readonly string[]).includes(host)
    || (host.endsWith('.cloudflarestream.com') && host.length > '.cloudflarestream.com'.length);
  return ok ? u.toString() : null;
}

/** An https URL of any host, for covers, thumbnails and course resources. */
export function httpsUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  return u.toString();
}

/** A course resource list: up to 50 `{title, url}`, each url https. Null when invalid. */
export function parseResources(raw: unknown): Array<{ title: string; url: string }> | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 50) return null;
  const out: Array<{ title: string; url: string }> = [];
  for (const r of raw) {
    const title = typeof r?.title === 'string' ? r.title.trim().slice(0, 200) : '';
    const url = httpsUrl(r?.url);
    if (!title || !url) return null;
    out.push({ title, url });
  }
  return out;
}

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

/**
 * D559 (#1160) — who may read a learner's exercise submissions and exam
 * attempts, read-only (epic call 1A).
 *
 * The Super Admin, and (D558, #1159) an admin assigned to a program that
 * holds the subject and in which the learner is actively enrolled. Every
 * route that serves a learner's work asks this function, per row.
 */
export async function canReadLearnerWork(
  env: any, viewer: unknown, learnerUserId: number, subject: { kind: 'exercise' | 'exam'; uid: string },
): Promise<boolean> {
  if (!viewer) return false;
  if (isSuperAdmin(viewer as any)) return true;
  if (String((viewer as any).role ?? '').toLowerCase() !== 'admin') return false;
  const row = await env.DB.prepare(
    `SELECT 1 AS ok FROM learning_program_contents pc
       JOIN learning_programs pp ON pp.id = pc.program_id AND pp.status != 'archived'
       JOIN learning_program_admins pa ON pa.program_id = pc.program_id AND pa.user_id = ?
       JOIN learning_enrollments pe ON pe.program_id = pc.program_id AND pe.user_id = ? AND pe.status = 'active'
      WHERE ${programHoldsSql(subject.kind, '?')} LIMIT 1`,
  ).bind(Number((viewer as any).id), learnerUserId, ...holdsArgs(subject)).first();
  return Boolean(row);
}

/**
 * Whether a viewer may open the review of one exercise or exam at all: the
 * Super Admin, or an admin assigned to a program that holds the subject. The
 * rows inside are then filtered by `canReadLearnerWork`.
 */
export async function canReviewLearning(
  env: any, viewer: unknown, subject: { kind: 'exercise' | 'exam'; uid: string },
): Promise<boolean> {
  if (!viewer) return false;
  if (isSuperAdmin(viewer as any)) return true;
  if (String((viewer as any).role ?? '').toLowerCase() !== 'admin') return false;
  const row = await env.DB.prepare(
    `SELECT 1 AS ok FROM learning_program_contents pc
       JOIN learning_programs pp ON pp.id = pc.program_id AND pp.status != 'archived'
       JOIN learning_program_admins pa ON pa.program_id = pc.program_id AND pa.user_id = ?
      WHERE ${programHoldsSql(subject.kind, '?')} LIMIT 1`,
  ).bind(Number((viewer as any).id), ...holdsArgs(subject)).first();
  return Boolean(row);
}

/** The binds `programHoldsSql(kind, '?')` needs: the uid once directly, once through a course. */
function holdsArgs(subject: { kind: ProgramSubjectKind; uid: string }): string[] {
  return subject.kind === 'course' ? [subject.uid] : [subject.uid, subject.uid];
}
