/**
 * D557 (#1158) — the Learning center, member side. Mounted at /api/learning.
 *
 *   GET  /catalog      one list over everything a member can learn from:
 *                      courses, videos and readings (this store), published
 *                      articles, published publications and upcoming events.
 *                      `q` reaches a video's or reading's transcript too, and
 *                      such a row carries `match: { in, snippet, at_seconds }`;
 *                      `max_minutes` keeps what has a recorded length within it
 *                      (#4180).
 *   GET  /courses/:slug   a course, its modules and lessons, and the caller's progress
 *   GET  /items/:uid      one video or reading
 *   POST /progress     the caller's own progress on an item, lesson or course
 *   GET  /me           what the caller has started and finished
 *
 * EACH SOURCE ANSWERS ALONE. The catalog reads six kinds from four stores. A
 * store that cannot be read comes back `{status: 'unreadable', reason}` under
 * its kind, and the others still answer; a failed read is never an empty
 * list.
 *
 * VISIBILITY IS `canSeeLearning`. Every row this file returns from the
 * Learning store is passed through it; the SQL narrows with the same
 * predicate (`see`) so totals and pages agree with what is shown. Program
 * content (D558) is read with `enrolledSql`, selected `AS enrolled`, so the
 * check sees whether this caller is enrolled.
 */
import { COURSE_META_SELECT, courseMetaView } from '../services/learningCourseMeta';
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth, isSuperAdmin } from '../auth';
import { refuse } from '../util/refusal';
import { ASSESSED_LESSON_KINDS, refreshCourses } from '../services/learningCompletion';
import { clampLimit, parseOffset } from '../util/pagination';
import { mapError } from './_t13t14t15_helpers';
import {
  canSeeLearning, enrolledSql, LEARNING_LEVELS, PROGRESS_KINDS,
} from '../services/learningAccess';
import { streamUrl } from '../services/learningVideo';
import { LANGUAGE_RE, VTT_MAX_BYTES, signedPlayback, streamOf, streamState, type VideoStream } from '../services/learningStream';
import { COURSE_UID, courseCoverPrefix, readCover } from '../services/coverDraws';
import { getCurrentUser } from '../auth';

const r = new Hono<{ Bindings: Env }>();

export const CATALOG_KINDS = ['course', 'video', 'reading', 'article', 'publication', 'event'] as const;
type Kind = typeof CATALOG_KINDS[number];

/**
 * The member-visible predicate, as SQL. Mirrors `canSeeLearning` for a
 * non-Super Admin. Binds two values: whether the caller is the Super Admin
 * (`? = 1`: drafts are listed too, archived never), then the caller's id for
 * the enrolment check.
 */
const see = (kind: 'item' | 'course', uidExpr: string) =>
  "(? = 1 OR (status = 'published' AND (visibility = 'open' OR (visibility = 'program' AND "
  + enrolledSql(kind, uidExpr) + ")))) AND status != 'archived'";
const ITEM_ENROLLED = enrolledSql('item', 'learning_items.uid');
const COURSE_ENROLLED = enrolledSql('course', 'learning_courses.uid');
// #4180 (lr7): `q` reaches the transcript too; `max_minutes` keeps what has a recorded length within it.
const MATCH = "(? IS NULL OR topic = ?) AND (? IS NULL OR level = ?) AND (? IS NULL OR title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR transcript LIKE ? ESCAPE '\\')"
  + ' AND (? IS NULL OR (duration_seconds IS NOT NULL AND duration_seconds <= ? * 60))';

const ITEMS_SQL = 'SELECT uid, kind, title, summary, topic, level, duration_seconds, thumbnail_url, status, visibility, published_at, updated_at, '
  + 'CASE WHEN ? IS NULL THEN NULL ELSE transcript END AS transcript, '
  + ITEM_ENROLLED + ' AS enrolled FROM learning_items WHERE kind = ? AND ' + see('item', 'learning_items.uid') + ' AND ' + MATCH
  + ' ORDER BY COALESCE(published_at, updated_at) DESC, id DESC LIMIT ? OFFSET ?';
const ITEMS_COUNT = 'SELECT COUNT(*) AS n FROM learning_items WHERE kind = ? AND ' + see('item', 'learning_items.uid') + ' AND ' + MATCH;
// Courses carry a level but no topic.
const COURSE_MATCH = "(? IS NULL OR level = ?) AND (? IS NULL OR title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\')"
  + ' AND (? IS NULL OR (estimated_minutes IS NOT NULL AND estimated_minutes <= ?))';
const COURSES_SQL = 'SELECT uid, slug, title, summary, cover_url, level, estimated_minutes, status, visibility, published_at, updated_at, '
  + COURSE_ENROLLED + ' AS enrolled FROM learning_courses WHERE ' + see('course', 'learning_courses.uid') + ' AND ' + COURSE_MATCH
  + ' ORDER BY COALESCE(published_at, updated_at) DESC, id DESC LIMIT ? OFFSET ?';
const COURSES_COUNT = 'SELECT COUNT(*) AS n FROM learning_courses WHERE ' + see('course', 'learning_courses.uid') + ' AND ' + COURSE_MATCH;

const ARTICLES_WHERE = "a.status = 'published' AND (? IS NULL OR a.title LIKE ? ESCAPE '\\' OR a.subtitle LIKE ? ESCAPE '\\')";
const ARTICLES_SQL = 'SELECT a.slug, a.title, a.subtitle, a.excerpt, a.published_at, a.read_minutes, '
  + 'COALESCE(u.display_name, u.name) AS author_name, u.role AS author_role '
  + 'FROM articles a LEFT JOIN users u ON u.id = a.author_user_id WHERE ' + ARTICLES_WHERE
  + ' ORDER BY a.published_at DESC, a.id DESC LIMIT ? OFFSET ?';
const ARTICLES_COUNT = 'SELECT COUNT(*) AS n FROM articles a WHERE ' + ARTICLES_WHERE;

// Published and not internal: the same filter the public /insights index uses.
const PUBS_WHERE = "status = 'published' AND audience != 'internal' AND (? IS NULL OR title LIKE ? ESCAPE '\\' OR subtitle LIKE ? ESCAPE '\\')";
const PUBS_SQL = 'SELECT slug, title, subtitle, section, published_at FROM admin_publications WHERE ' + PUBS_WHERE
  + " ORDER BY COALESCE(published_at, '') DESC, id DESC LIMIT ? OFFSET ?";
const PUBS_COUNT = 'SELECT COUNT(*) AS n FROM admin_publications WHERE ' + PUBS_WHERE;

// Public, published, admin-approved and upcoming: the events feed's own filter.
const EVENTS_WHERE = "visibility = 'public' AND status = 'published' AND admin_published = 1 "
  + "AND datetime(starts_at) >= datetime(?) AND (? IS NULL OR title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\')";
const EVENTS_SQL = 'SELECT slug, title, summary, type, starts_at FROM events WHERE ' + EVENTS_WHERE
  + ' ORDER BY starts_at ASC, id ASC LIMIT ? OFFSET ?';
const EVENTS_COUNT = 'SELECT COUNT(*) AS n FROM events WHERE ' + EVENTS_WHERE;

export type CatalogRow = {
  kind: Kind; id: string; title: string; summary: string | null; href: string;
  date: string | null; source: 'learning' | 'articles' | 'publications' | 'events';
  [extra: string]: unknown;
};
type SourceState = { status: 'ready'; total: number } | { status: 'unreadable'; reason: string } | { status: 'filtered_out'; reason: string };

/**
 * #4180 (lr7): where a search term sits in an item's transcript, when the
 * title and summary do not hold it: up to 160 characters around it, and the
 * time of the nearest timestamp before it ("04:12", "[04:12]", or a WebVTT
 * cue's start) as seconds, or null when the transcript carries none. Null when
 * the term is in the title or summary, or not in the transcript.
 */
const STAMP = /(?:^|\n|\[)\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,]\d{1,3})?/g;
export function transcriptMatch(row: { title?: string | null; summary?: string | null; transcript?: string | null }, q: string) {
  const needle = q.toLowerCase();
  if (String(row.title ?? '').toLowerCase().includes(needle) || String(row.summary ?? '').toLowerCase().includes(needle)) return null;
  const text = String(row.transcript ?? '');
  const at = text.toLowerCase().indexOf(needle);
  if (at < 0) return null;
  let seconds: number | null = null;
  for (const m of text.slice(0, at + needle.length).matchAll(STAMP)) {
    if ((m.index ?? 0) > at) break;
    seconds = Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }
  const from = Math.max(0, at - 60);
  const to = Math.min(text.length, at + needle.length + 100);
  const snippet = `${from > 0 ? '…' : ''}${text.slice(from, to).replace(/\s+/g, ' ').trim()}${to < text.length ? '…' : ''}`;
  return { in: 'transcript' as const, snippet, at_seconds: seconds };
}

/** Escape a LIKE term; null when there is no search. */
function likeTerm(q: string | null): string | null {
  if (!q) return null;
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

const UNREADABLE: Record<Kind, string> = {
  course: 'The course store could not be read, so this is not a claim that there are no courses.',
  video: 'The video store could not be read, so this is not a claim that there are no videos.',
  reading: 'The reading store could not be read, so this is not a claim that there are no readings.',
  article: 'The article store could not be read, so this is not a claim that there are no articles.',
  publication: 'The publication store could not be read, so this is not a claim that there are no publications.',
  event: 'The event store could not be read, so this is not a claim that there are no upcoming events.',
};

async function readKind(env: Env, user: unknown, kind: Kind, f: {
  q: string | null; topic: string | null; level: string | null; limit: number; offset: number; now: string; maxMinutes?: number | null;
}): Promise<{ rows: CatalogRow[]; state: SourceState }> {
  const like = likeTerm(f.q);
  const sa = user && isSuperAdmin(user as any) ? 1 : 0;
  const me = Number((user as any)?.id ?? 0);
  // A source without the field a filter names is left out, not listed
  // unfiltered: only videos and readings have a topic, and articles,
  // publications and events have no level.
  const hasTopic = kind === 'video' || kind === 'reading';
  const hasLevel = hasTopic || kind === 'course';
  // #4180: only videos, readings and courses have a length, so a length filter leaves the others out.
  const max = f.maxMinutes ?? null;
  if (max != null && !hasLevel) {
    return { rows: [], state: { status: 'filtered_out', reason: 'This source has no length, so a length filter leaves it out.' } };
  }
  if ((f.topic && !hasTopic) || (f.level && !hasLevel)) {
    return { rows: [], state: { status: 'filtered_out', reason: f.topic && !hasTopic
      ? 'This source has no topic, so a topic filter leaves it out.'
      : 'This source has no level, so a level filter leaves it out.' } };
  }
  try {
    if (kind === 'video' || kind === 'reading') {
      const args = [kind, sa, me, f.topic, f.topic, f.level, f.level, like, like, like, like, max, max];
      const [res, cnt] = await Promise.all([
        env.DB.prepare(ITEMS_SQL).bind(like, me, ...args, f.limit, f.offset).all<any>(),
        env.DB.prepare(ITEMS_COUNT).bind(...args).first<{ n: number }>(),
      ]);
      const rows = (res.results || []).filter((x) => canSeeLearning(user, x)).map((x): CatalogRow => ({
        kind, id: x.uid, title: x.title, summary: x.summary ?? null, href: `/learning/items/${x.uid}`,
        date: x.published_at ?? null, source: 'learning', topic: x.topic ?? null, level: x.level ?? null,
        duration_seconds: x.duration_seconds ?? null, thumbnail_url: x.thumbnail_url ?? null, status: x.status,
        // #4180: found only in the transcript — the words around it, and their time when the transcript gives one.
        match: f.q ? transcriptMatch(x, f.q) : null,
      }));
      return { rows, state: { status: 'ready', total: Number(cnt?.n ?? 0) } };
    }
    if (kind === 'course') {
      const args = [sa, me, f.level, f.level, like, like, like, max, max];
      const [res, cnt] = await Promise.all([
        env.DB.prepare(COURSES_SQL).bind(me, ...args, f.limit, f.offset).all<any>(),
        env.DB.prepare(COURSES_COUNT).bind(...args).first<{ n: number }>(),
      ]);
      const rows = (res.results || []).filter((x) => canSeeLearning(user, x)).map((x): CatalogRow => ({
        kind, id: x.slug, title: x.title, summary: x.summary ?? null, href: `/learning/courses/${x.slug}`,
        date: x.published_at ?? null, source: 'learning', level: x.level ?? null,
        estimated_minutes: x.estimated_minutes ?? null, cover_url: x.cover_url ?? null, status: x.status,
      }));
      return { rows, state: { status: 'ready', total: Number(cnt?.n ?? 0) } };
    }
    if (kind === 'article') {
      const args = [like, like, like];
      const [res, cnt] = await Promise.all([
        env.DB.prepare(ARTICLES_SQL).bind(...args, f.limit, f.offset).all<any>(),
        env.DB.prepare(ARTICLES_COUNT).bind(...args).first<{ n: number }>(),
      ]);
      const rows = (res.results || []).map((x): CatalogRow => ({
        kind, id: x.slug, title: x.title, summary: x.excerpt ?? x.subtitle ?? null, href: `/articles/${x.slug}`,
        date: x.published_at ?? null, source: 'articles',
        // The canvas's article row: author, role, reading time. A 0 read time
        // was never computed, so it is not a "0 min read".
        author: { name: x.author_name ?? null, role: x.author_role ?? null },
        read_minutes: Number(x.read_minutes) > 0 ? Number(x.read_minutes) : null,
      }));
      return { rows, state: { status: 'ready', total: Number(cnt?.n ?? 0) } };
    }
    if (kind === 'publication') {
      const args = [like, like, like];
      const [res, cnt] = await Promise.all([
        env.DB.prepare(PUBS_SQL).bind(...args, f.limit, f.offset).all<any>(),
        env.DB.prepare(PUBS_COUNT).bind(...args).first<{ n: number }>(),
      ]);
      const rows = (res.results || []).map((x): CatalogRow => ({
        kind, id: x.slug, title: x.title, summary: x.subtitle ?? null, href: `/insights/public/${x.slug}`,
        date: x.published_at ?? null, source: 'publications', section: x.section ?? null,
        // The canvas draws a PDF and its size; the publication store holds no file.
        file: { recorded: false, reason: 'Publications are read on the page; the store holds no PDF.' },
      }));
      return { rows, state: { status: 'ready', total: Number(cnt?.n ?? 0) } };
    }
    const args = [f.now, like, like, like];
    const [res, cnt] = await Promise.all([
      env.DB.prepare(EVENTS_SQL).bind(...args, f.limit, f.offset).all<any>(),
      env.DB.prepare(EVENTS_COUNT).bind(...args).first<{ n: number }>(),
    ]);
    const rows = (res.results || []).map((x): CatalogRow => ({
      kind, id: x.slug, title: x.title, summary: x.summary ?? null, href: `/events/${x.slug}`,
      date: x.starts_at ?? null, source: 'events', event_type: x.type ?? null,
    }));
    return { rows, state: { status: 'ready', total: Number(cnt?.n ?? 0) } };
  } catch (e) {
    console.warn('[learning] catalog source unreadable', kind, (e as Error).message);
    return { rows: [], state: { status: 'unreadable', reason: UNREADABLE[kind] } };
  }
}

r.get('/catalog', async (c) => {
  let user;
  try { user = await requireAuth(c); } catch (e) { return mapError(c, e); }
  const kind = c.req.query('kind') || null;
  if (kind && !(CATALOG_KINDS as readonly string[]).includes(kind)) {
    return refuse(c, 400, { code: 'bad_kind', message: `kind is one of ${CATALOG_KINDS.join(', ')}.` });
  }
  const level = c.req.query('level') || null;
  if (level && !(LEARNING_LEVELS as readonly string[]).includes(level)) {
    return refuse(c, 400, { code: 'bad_level', message: `level is one of ${LEARNING_LEVELS.join(', ')}.` });
  }
  const topic = (c.req.query('topic') || '').trim().slice(0, 80) || null;
  const q = (c.req.query('q') || '').trim().slice(0, 120) || null;
  const rawMax = c.req.query('max_minutes');
  const maxMinutes = rawMax == null || rawMax === '' ? null : Number(rawMax);
  if (maxMinutes != null && !(Number.isInteger(maxMinutes) && maxMinutes > 0 && maxMinutes <= 1440)) {
    return refuse(c, 400, { code: 'bad_max_minutes', message: 'max_minutes is a whole number of minutes from 1 to 1440.' });
  }
  const limit = clampLimit(c.req.query('limit'), 24, 100);
  // Without a kind the catalog is the newest `limit` rows across every
  // source; paging (`offset`) walks one kind at a time.
  const offset = kind ? parseOffset(c.req.query('offset')) : 0;
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const kinds = (kind ? [kind] : [...CATALOG_KINDS]) as Kind[];
  const results = await Promise.all(kinds.map((k) => readKind(c.env, user, k, { q, topic, level, limit, offset, now, maxMinutes })));
  const sources: Record<string, SourceState> = {};
  const rows: CatalogRow[] = [];
  kinds.forEach((k, i) => { sources[k] = results[i].state; rows.push(...results[i].rows); });
  if (!kind) {
    // Upcoming events sort by their own date; everything else is newest first.
    rows.sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
  }
  return c.json({ items: rows.slice(0, limit), sources, limit, offset });
});

const COURSE_SQL = 'SELECT id, uid, slug, title, summary, cover_url, level, estimated_minutes, resources_json, status, visibility, published_at, updated_at, ' + COURSE_META_SELECT + ', '
  + COURSE_ENROLLED + ' AS enrolled FROM learning_courses WHERE slug = ?';

r.get('/courses/:slug', async (c) => {
  let user: any;
  try { user = await requireAuth(c); } catch (e) { return mapError(c, e); }
  const course = await c.env.DB.prepare(COURSE_SQL).bind(user.id, c.req.param('slug')).first<any>();
  // Not found and not visible answer alike: a draft's slug is not confirmed to exist.
  if (!course || !canSeeLearning(user, course)) return refuse(c, 404, { code: 'not_found', message: 'No such course.' });
  const [mods, lessons, progress] = await Promise.all([
    c.env.DB.prepare('SELECT id, uid, title, position FROM learning_course_modules WHERE course_id = ? ORDER BY position, id').bind(course.id).all<any>(),
    // #4180 (lr3): a video or reading lesson's length is its item's; any other lesson, or an item with none, is null.
    c.env.DB.prepare(`SELECT l.uid, l.module_id, l.title, l.position, l.kind, l.ref_uid, l.required, i.duration_seconds
                        FROM learning_lessons l JOIN learning_course_modules m ON m.id = l.module_id
                        LEFT JOIN learning_items i ON l.kind IN ('video', 'reading') AND i.uid = l.ref_uid
                       WHERE m.course_id = ? ORDER BY l.position, l.id`).bind(course.id).all<any>(),
    c.env.DB.prepare(`SELECT subject_kind, subject_uid, status, percent, position_seconds, started_at, completed_at
                        FROM learning_progress WHERE user_id = ? AND (subject_kind = 'lesson' OR (subject_kind = 'course' AND subject_uid = ?))`)
      .bind(user.id, course.uid).all<any>(),
  ]);
  const mine = new Map((progress.results || []).filter((p) => p.subject_kind === 'lesson').map((p) => [p.subject_uid, p]));
  const allLessons = lessons.results || [];
  const required = allLessons.filter((l) => Number(l.required) === 1);
  const done = required.filter((l) => mine.get(l.uid)?.status === 'completed').length;
  let resources: unknown = [];
  try { resources = JSON.parse(course.resources_json || '[]'); } catch { resources = []; }
  return c.json({
    course: {
      uid: course.uid, slug: course.slug, title: course.title, summary: course.summary, cover_url: course.cover_url,
      level: course.level, estimated_minutes: course.estimated_minutes, resources, status: course.status, published_at: course.published_at,
      // D4650 (#4650, part 2): what the author recorded; a field not filled is null or an empty list.
      meta: courseMetaView(course),
    },
    modules: (mods.results || []).map((m) => ({
      uid: m.uid, title: m.title, position: m.position,
      lessons: allLessons.filter((l) => l.module_id === m.id).map((l) => ({
        uid: l.uid, title: l.title, position: l.position, kind: l.kind, ref_uid: l.ref_uid, required: Number(l.required) === 1,
        duration_seconds: l.duration_seconds == null ? null : Number(l.duration_seconds),
        progress: mine.get(l.uid) ? { status: mine.get(l.uid).status, percent: mine.get(l.uid).percent, completed_at: mine.get(l.uid).completed_at } : null,
      })),
    })),
    // Measured over required lessons; a course with none has no percentage.
    progress: { required: required.length, completed: done, percent: required.length ? Math.round((100 * done) / required.length) : null },
  });
});

const ITEM_SQL = 'SELECT uid, kind, title, summary, body, video_source, video_url, duration_seconds, thumbnail_url, transcript, topic, level, status, visibility, published_at, updated_at, '
  + ITEM_ENROLLED + ' AS enrolled FROM learning_items WHERE uid = ?';

r.get('/items/:uid', async (c) => {
  let user: any;
  try { user = await requireAuth(c); } catch (e) { return mapError(c, e); }
  const item = await c.env.DB.prepare(ITEM_SQL).bind(user.id, c.req.param('uid')).first<any>();
  if (!item || !canSeeLearning(user, item)) return refuse(c, 404, { code: 'not_found', message: 'No such item.' });
  const p = await c.env.DB.prepare(
    `SELECT status, percent, position_seconds, completed_at FROM learning_progress WHERE user_id = ? AND subject_kind = 'item' AND subject_uid = ?`,
  ).bind(user.id, item.uid).first<any>();
  const { visibility: _v, enrolled: _e, ...shown } = item;
  void _v; void _e;
  // D561 (#1250) — the key is read here only to version the stream address;
  // it is hashed, and never sent.
  let videoStreamUrl: string | null = null;
  if (item.video_source === 'r2') {
    const k = await c.env.DB.prepare('SELECT r2_key FROM learning_items WHERE uid = ?').bind(item.uid).first<{ r2_key: string | null }>();
    if (k?.r2_key) videoStreamUrl = await streamUrl(item.uid, k.r2_key);
  }
  // #4176 (D4176): a ready Stream video plays first. Its URLs are signed here, only after the visibility check
  // above, and never cached or logged. Without the binding the item plays as before.
  const s = await streamState(c.env, item.uid);
  const binding = streamOf(c.env);
  let videoStream: VideoStream = null;
  if (s.ready && binding) {
    try { videoStream = await signedPlayback(c.env, binding, s.ready); } catch { videoStream = null; }
  } else if (s.pending) videoStream = { state: s.pending };
  return c.json({
    item: {
      ...shown,
      transcript: item.transcript ?? null,
      video_stream: videoStream,
      chapters: s.chapters,
      // D561 — an uploaded video plays from the gated stream route; the
      // bucket key is never sent. Null when the item plays a link or nothing,
      // or has no object recorded (the stream route would answer 404). The
      // `?v=` changes with each upload (#1250), so the hour-long cache never
      // serves a replaced file.
      video_stream_url: videoStreamUrl,
    },
    // The player's transcript panel says why it is empty rather than drawing nothing.
    transcript_recorded: item.transcript != null && item.transcript !== '',
    progress: p ?? null,
  });
});

// #4178 (D4178): one ready caption of the item's Stream video, { language, vtt } (WebVTT text), so the player can time its
// transcript cues (click-to-seek). Asked the same question as the item read, before anything is fetched.
// Stream's binding has no caption read, so the file comes from Stream's API with STREAM_API_TOKEN; the
// token is never sent or logged. 503 `stream_captions_unavailable` without the binding or the token;
// 404 for an item the member cannot see, a video not ready on Stream, or a language with no ready caption.
r.get('/items/:uid/captions/:lang', async (c) => {
  let user: any;
  try { user = await requireAuth(c); } catch (e) { return mapError(c, e); }
  const lang = c.req.param('lang') ?? '';
  if (!LANGUAGE_RE.test(lang)) return refuse(c, 400, { code: 'bad_language', message: 'A caption language is a tag such as en or pt-BR.' });
  const item = await c.env.DB.prepare('SELECT uid, kind, status, visibility, ' + ITEM_ENROLLED + ' AS enrolled FROM learning_items WHERE uid = ?')
    .bind(user.id, c.req.param('uid')).first<any>();
  if (!item || !canSeeLearning(user, item)) return refuse(c, 404, { code: 'not_found', message: 'No such item.' });
  const token = (c.env as any).STREAM_API_TOKEN as string | undefined;
  const account = c.env.CLOUDFLARE_ACCOUNT_ID;
  if (!streamOf(c.env) || !token || !account) {
    return refuse(c, 503, { code: 'stream_captions_unavailable', message: 'Caption files cannot be read until Stream is set up.' });
  }
  const s = await streamState(c.env, item.uid);
  if (!s.ready) return refuse(c, 404, { code: 'not_found', message: 'This video has no ready captions.' });
  const ready = await c.env.DB.prepare(
    `SELECT 1 AS ok FROM learning_stream_captions WHERE stream_video_id = ? AND language = ? AND state = 'ready'`,
  ).bind(s.ready.id, lang).first<{ ok: number }>();
  if (!ready) return refuse(c, 404, { code: 'not_found', message: 'No ready caption in that language.' });
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/stream/${encodeURIComponent(s.ready.stream_uid)}/captions/${encodeURIComponent(lang)}/vtt`,
    { headers: { Authorization: `Bearer ${token}` } },
  ).catch(() => null);
  const vtt = res && res.ok ? await res.text() : null;
  if (vtt == null || !/^\uFEFF?WEBVTT/.test(vtt) || new TextEncoder().encode(vtt).length > VTT_MAX_BYTES) {
    return refuse(c, 502, { code: 'caption_unreadable', message: 'Stream did not send the caption file.' });
  }
  return c.json({ language: lang, vtt }, 200, { 'Cache-Control': 'private, no-store' });
});

/** The subject a progress write names, or null when it does not exist or the caller cannot see it. */
async function visibleSubject(env: Env, user: any, kind: string, uid: string): Promise<boolean> {
  if (kind === 'item') {
    const row = await env.DB.prepare('SELECT status, visibility, ' + ITEM_ENROLLED + ' AS enrolled FROM learning_items WHERE uid = ?')
      .bind(user.id, uid).first<any>();
    return canSeeLearning(user, row);
  }
  if (kind === 'course') {
    const row = await env.DB.prepare('SELECT status, visibility, ' + COURSE_ENROLLED + ' AS enrolled FROM learning_courses WHERE uid = ?')
      .bind(user.id, uid).first<any>();
    return canSeeLearning(user, row);
  }
  // A lesson is as visible as its course.
  const row = await env.DB.prepare(
    `SELECT c.status, c.visibility, ${enrolledSql('course', 'c.uid')} AS enrolled FROM learning_lessons l
       JOIN learning_course_modules m ON m.id = l.module_id
       JOIN learning_courses c ON c.id = m.course_id WHERE l.uid = ?`,
  ).bind(user.id, uid).first<any>();
  return canSeeLearning(user, row);
}

r.post('/progress', async (c) => {
  let user: any;
  try { user = await requireAuth(c); } catch (e) { return mapError(c, e); }
  const b = await c.req.json().catch(() => ({} as any));
  const kind = String(b?.subject_kind ?? '');
  const uid = typeof b?.subject_uid === 'string' ? b.subject_uid.trim() : '';
  const status = String(b?.status ?? '');
  if (!(PROGRESS_KINDS as readonly string[]).includes(kind) || !uid || uid.length > 64) {
    return refuse(c, 400, { code: 'bad_subject', message: 'subject_kind is item, lesson or course, and subject_uid names one.' });
  }
  if (status !== 'started' && status !== 'completed') {
    return refuse(c, 400, { code: 'bad_status', message: 'status is started or completed.' });
  }
  const pct = b?.percent === undefined || b?.percent === null ? null : Number(b.percent);
  if (pct !== null && !(Number.isInteger(pct) && pct >= 0 && pct <= 100)) {
    return refuse(c, 400, { code: 'bad_percent', message: 'percent is a whole number from 0 to 100.' });
  }
  const pos = b?.position_seconds === undefined || b?.position_seconds === null ? null : Number(b.position_seconds);
  if (pos !== null && !(Number.isInteger(pos) && pos >= 0)) {
    return refuse(c, 400, { code: 'bad_position', message: 'position_seconds is a whole number of seconds.' });
  }
  if (!(await visibleSubject(c.env, user, kind, uid))) {
    return refuse(c, 404, { code: 'not_found', message: 'No such item, lesson or course.' });
  }
  const now = new Date().toISOString();
  // D4643 (#4643): completion is authoritative. A course's row is derived from its required lessons
  // (`refreshCourses`), whatever is posted for it; an exercise or exam lesson completes only by its result.
  if (kind === 'course') {
    const course = await c.env.DB.prepare('SELECT id FROM learning_courses WHERE uid = ?').bind(uid).first<{ id: number }>();
    if (course) await refreshCourses(c.env, Number(user.id), [Number(course.id)], now);
    const row = await c.env.DB.prepare(
      `SELECT subject_kind, subject_uid, status, percent, position_seconds, started_at, completed_at FROM learning_progress
        WHERE user_id = ? AND subject_kind = 'course' AND subject_uid = ?`,
    ).bind(user.id, uid).first<any>();
    return c.json({ progress: row });
  }
  let lessonCourse: number | null = null;
  if (kind === 'lesson') {
    const lesson = await c.env.DB.prepare(
      'SELECT l.kind, m.course_id FROM learning_lessons l JOIN learning_course_modules m ON m.id = l.module_id WHERE l.uid = ?',
    ).bind(uid).first<{ kind: string; course_id: number }>();
    if (lesson && status === 'completed' && ASSESSED_LESSON_KINDS.includes(lesson.kind)) {
      return refuse(c, 409, {
        code: 'completed_by_result',
        message: lesson.kind === 'exam' ? 'This lesson is complete when one of your attempts passes the exam.' : 'This lesson is complete when a reviewer accepts your exercise.',
      });
    }
    lessonCourse = lesson ? Number(lesson.course_id) : null;
  }
  // Always the caller's own row: the user id comes from the session, never the body.
  // A completed subject stays completed, and the percent never goes backwards.
  await c.env.DB.prepare(
    `INSERT INTO learning_progress (user_id, subject_kind, subject_uid, status, percent, position_seconds, started_at, completed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, subject_kind, subject_uid) DO UPDATE SET
       status = CASE WHEN learning_progress.status = 'completed' THEN 'completed' ELSE excluded.status END,
       percent = CASE WHEN excluded.percent IS NULL THEN learning_progress.percent
                      WHEN learning_progress.percent IS NULL OR excluded.percent > learning_progress.percent THEN excluded.percent
                      ELSE learning_progress.percent END,
       position_seconds = COALESCE(excluded.position_seconds, learning_progress.position_seconds),
       completed_at = COALESCE(learning_progress.completed_at, excluded.completed_at),
       updated_at = excluded.updated_at`,
  ).bind(user.id, kind, uid, status, pct, pos, now, status === 'completed' ? now : null, now).run();
  // A completed lesson moves its course's derived row with it.
  if (kind === 'lesson' && status === 'completed' && lessonCourse != null) await refreshCourses(c.env, Number(user.id), [lessonCourse], now);
  const row = await c.env.DB.prepare(
    `SELECT subject_kind, subject_uid, status, percent, position_seconds, started_at, completed_at FROM learning_progress
      WHERE user_id = ? AND subject_kind = ? AND subject_uid = ?`,
  ).bind(user.id, kind, uid).first<any>();
  return c.json({ progress: row });
});

r.get('/me', async (c) => {
  let user: any;
  try { user = await requireAuth(c); } catch (e) { return mapError(c, e); }
  const rows = await c.env.DB.prepare(
    `SELECT p.subject_kind, p.subject_uid, p.status, p.percent, p.started_at, p.completed_at, p.updated_at,
            COALESCE(i.title, cr.title, l.title) AS title, i.kind AS item_kind, cr.slug AS course_slug
       FROM learning_progress p
       LEFT JOIN learning_items i ON p.subject_kind = 'item' AND i.uid = p.subject_uid
       LEFT JOIN learning_courses cr ON p.subject_kind = 'course' AND cr.uid = p.subject_uid
       LEFT JOIN learning_lessons l ON p.subject_kind = 'lesson' AND l.uid = p.subject_uid
      WHERE p.user_id = ?
      ORDER BY p.updated_at DESC, p.id DESC LIMIT 500`,
  ).bind(user.id).all<any>();
  const list = rows.results || [];
  return c.json({
    in_progress: list.filter((x) => x.status === 'started'),
    completed: list.filter((x) => x.status === 'completed'),
  });
});

// #3935 (LE8): a course's drawn cover. A published course's cover is public; a
// draft's is the Super Admin's only (they drew it in the Studio).
r.get('/courses/:uid/cover/:filename', async (c) => {
  const uid = String(c.req.param('uid') || '');
  if (!COURSE_UID.test(uid)) return c.json({ error: 'not_found' }, 404);
  const course = await c.env.DB.prepare('SELECT status FROM learning_courses WHERE uid = ?').bind(uid).first<{ status: string }>();
  if (!course) return c.json({ error: 'not_found' }, 404);
  const published = course.status === 'published';
  if (!published) {
    const u = await getCurrentUser(c).catch(() => null);
    if (!u || !isSuperAdmin(u)) return c.json({ error: 'not_found' }, 404);
  }
  const cover = await readCover(c.env, courseCoverPrefix(uid), String(c.req.param('filename') || ''));
  if (!cover) return c.json({ error: 'not_found' }, 404);
  return new Response(cover.body, { headers: { 'content-type': cover.mime, 'cache-control': published ? 'public, max-age=86400' : 'private, no-store', 'x-content-type-options': 'nosniff' } });
});

export default r;
