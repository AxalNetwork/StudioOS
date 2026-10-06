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
 *   - `program` content stays hidden from everyone but the Super Admin until
 *     #1159 adds enrolled members to this check.
 *   - Everything else that is published and `open` is every signed-in member's.
 */
import { isSuperAdmin } from '../auth';

export const LEARNING_STATUSES = ['draft', 'published', 'archived'] as const;
export const LEARNING_VISIBILITIES = ['open', 'program'] as const;
export const LEARNING_LEVELS = ['intro', 'intermediate', 'advanced'] as const;
export const ITEM_KINDS = ['video', 'reading'] as const;
export const LESSON_KINDS = ['video', 'reading', 'exercise', 'exam', 'webinar'] as const;
export const PROGRESS_KINDS = ['item', 'lesson', 'course'] as const;

export type LearningSubject = { status?: string | null; visibility?: string | null };

export function canSeeLearning(user: unknown, subject: LearningSubject | null | undefined): boolean {
  if (!subject) return false;
  if (user && isSuperAdmin(user as any)) return true;
  return subject.status === 'published' && subject.visibility === 'open';
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
