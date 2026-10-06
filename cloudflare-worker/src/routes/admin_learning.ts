/**
 * D557 (#1158) — authoring the Learning center. Mounted at /api/admin/learning.
 *
 * THE SUPER ADMIN ONLY. Every route calls `requireSuperAdmin`: a plain admin
 * (HQ or branch) reads the member side like anyone else and authors nothing.
 * Every write is recorded with `logAdminAction`, actor and subject.
 *
 *   GET    /items                     every item, drafts and archived included
 *   POST   /items                     create (a draft)
 *   GET    /items/:uid
 *   PATCH  /items/:uid
 *   POST   /items/:uid/publish | unpublish | archive
 *   GET    /courses
 *   POST   /courses                   create (a draft)
 *   GET    /courses/:uid              the course with its modules and lessons
 *   PATCH  /courses/:uid
 *   POST   /courses/:uid/publish | unpublish | archive
 *   POST   /courses/:uid/modules      add a module
 *   POST   /courses/:uid/modules/order   reorder, by a full list of module uids
 *   PATCH  /modules/:uid
 *   DELETE /modules/:uid              only an empty module
 *   POST   /modules/:uid/lessons      add a lesson
 *   POST   /modules/:uid/lessons/order   reorder, by a full list of lesson uids
 *   PATCH  /lessons/:uid
 *   DELETE /lessons/:uid
 *
 * A VIDEO IS A LINK ON THE ALLOW-LIST (`allowedVideoUrl`): https, and a host
 * from YouTube, Vimeo or Cloudflare Stream. An upload (`video_source = 'r2'`)
 * has no upload path yet and is refused rather than stored without a file.
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { requireSuperAdmin } from '../auth';
import { refuse } from '../util/refusal';
import { logAdminAction } from '../services/adminAudit';
import { mapError, newUid } from './_t13t14t15_helpers';
import {
  allowedVideoUrl, httpsUrl, parseResources, SLUG_RE,
  ITEM_KINDS, LESSON_KINDS, LEARNING_LEVELS, LEARNING_VISIBILITIES,
} from '../services/learningAccess';

const r = new Hono<{ Bindings: Env }>();

export type Admin = { id: number; email?: string | null };

export async function gate(c: Context<{ Bindings: Env }>): Promise<Admin | Response> {
  try { return (await requireSuperAdmin(c)) as any; } catch (e) { return mapError(c, e); }
}

export const record = (c: Context<{ Bindings: Env }>, admin: Admin, action: string, details: Record<string, unknown>) =>
  logAdminAction(c.env, Number(admin.id), String(admin.email || ''), action, details);

/** A trimmed string up to `max`, `null` for empty, `undefined` when absent. */
export function text(v: unknown, max: number): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

export class Invalid extends Error {
  code: string;
  reason: string;
  constructor(code: string, reason: string) { super(reason); this.code = code; this.reason = reason; }
}
export const bad = (code: string, reason: string): never => { throw new Invalid(code, reason); };

export function oneOf<T extends string>(v: unknown, set: readonly T[], field: string): T | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (!(set as readonly string[]).includes(String(v))) bad(`bad_${field}`, `${field} is one of ${set.join(', ')}.`);
  return v as T;
}

export function wholeOrNull(v: unknown, field: string): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) bad(`bad_${field}`, `${field} is a whole number, 0 or more.`);
  return n;
}

function urlOrNull(v: unknown, field: string): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  return httpsUrl(v) ?? bad(`bad_${field}`, `${field} must be an https URL.`);
}

/** The item fields a write may set, validated. `undefined` leaves a field as it is. */
function itemFields(b: any, creating: boolean) {
  const kind = creating ? oneOf(b?.kind, ITEM_KINDS, 'kind') : undefined;
  if (creating && !kind) bad('bad_kind', 'kind is video or reading.');
  const title = text(b?.title, 200);
  if (creating && !title) bad('bad_title', 'An item needs a title.');
  if (title === null) bad('bad_title', 'An item needs a title.');
  if (b?.video_source !== undefined && b.video_source !== null && b.video_source !== 'url') {
    // D561 — an uploaded video is attached by the upload route, which checks
    // the stored object; a field write cannot claim one.
    bad('video_source_by_upload', 'An uploaded video is attached through the upload routes, not set here.');
  }
  let video_url: string | null | undefined;
  if (b?.video_url !== undefined) {
    video_url = b.video_url === null || b.video_url === '' ? null
      : allowedVideoUrl(b.video_url) ?? bad('bad_video_url', 'A video link must be https, from YouTube, Vimeo or Cloudflare Stream.');
  }
  return {
    kind,
    title,
    summary: text(b?.summary, 1000),
    body: text(b?.body, 100_000),
    video_url,
    duration_seconds: wholeOrNull(b?.duration_seconds, 'duration_seconds'),
    thumbnail_url: urlOrNull(b?.thumbnail_url, 'thumbnail_url'),
    transcript: text(b?.transcript, 200_000),
    topic: text(b?.topic, 80),
    level: oneOf(b?.level, LEARNING_LEVELS, 'level'),
    visibility: oneOf(b?.visibility, LEARNING_VISIBILITIES, 'visibility'),
  };
}

function courseFields(b: any, creating: boolean) {
  const title = text(b?.title, 200);
  if ((creating && !title) || title === null) bad('bad_title', 'A course needs a title.');
  let slug: string | undefined;
  if (b?.slug !== undefined || creating) {
    slug = String(b?.slug ?? '').trim().toLowerCase();
    if (!SLUG_RE.test(slug)) bad('bad_slug', 'slug is lowercase letters, digits and hyphens, up to 80.');
  }
  let resources_json: string | undefined;
  if (b?.resources !== undefined) {
    const list = parseResources(b.resources);
    if (!list) bad('bad_resources', 'resources is a list of up to 50 {title, url}, each url https.');
    resources_json = JSON.stringify(list);
  }
  return {
    slug,
    title,
    summary: text(b?.summary, 1000),
    cover_url: urlOrNull(b?.cover_url, 'cover_url'),
    level: oneOf(b?.level, LEARNING_LEVELS, 'level'),
    estimated_minutes: wholeOrNull(b?.estimated_minutes, 'estimated_minutes'),
    resources_json,
    visibility: oneOf(b?.visibility, LEARNING_VISIBILITIES, 'visibility'),
  };
}

/** Run a handler body, turning a validation throw into its 400. */
export async function guarded(c: Context<{ Bindings: Env }>, fn: () => Promise<Response>): Promise<Response> {
  try { return await fn(); } catch (e) {
    if (e instanceof Invalid) return refuse(c, 400, { code: e.code, message: e.reason });
    throw e;
  }
}

const now = () => new Date().toISOString();

// Fixed column lists: an UPDATE names only columns from these, never a key from the body.
const ITEM_COLUMNS = ['title', 'summary', 'body', 'video_url', 'duration_seconds', 'thumbnail_url', 'transcript', 'topic', 'level', 'visibility'] as const;
const COURSE_COLUMNS = ['slug', 'title', 'summary', 'cover_url', 'level', 'estimated_minutes', 'resources_json', 'visibility'] as const;

const ITEM_SELECT = 'SELECT uid, kind, title, summary, body, video_source, video_url, duration_seconds, thumbnail_url, transcript, topic, level, visibility, status, created_by, created_at, updated_at, published_at FROM learning_items';
const COURSE_SELECT = 'SELECT id, uid, slug, title, summary, cover_url, level, estimated_minutes, resources_json, visibility, status, created_by, created_at, updated_at, published_at FROM learning_courses';

// ---- items ---------------------------------------------------------------------

r.get('/items', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  const res = await c.env.DB.prepare(ITEM_SELECT + ' ORDER BY updated_at DESC, id DESC LIMIT 500').all<any>();
  return c.json({ items: res.results || [] });
});

r.post('/items', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  return guarded(c, async () => {
    const f = itemFields(await c.req.json().catch(() => ({})), true);
    const uid = newUid();
    const t = now();
    await c.env.DB.prepare(
      `INSERT INTO learning_items (uid, kind, title, summary, body, video_source, video_url, duration_seconds, thumbnail_url,
         transcript, topic, level, visibility, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
    ).bind(uid, f.kind, f.title, f.summary ?? null, f.body ?? null, f.video_url ? 'url' : null, f.video_url ?? null,
      f.duration_seconds ?? null, f.thumbnail_url ?? null, f.transcript ?? null, f.topic ?? null, f.level ?? null,
      f.visibility ?? 'open', admin.id, t, t).run();
    await record(c, admin, 'learning.item.create', { uid, kind: f.kind });
    return c.json({ item: await c.env.DB.prepare(ITEM_SELECT + ' WHERE uid = ?').bind(uid).first() }, 201);
  });
});

r.get('/items/:uid', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  const item = await c.env.DB.prepare(ITEM_SELECT + ' WHERE uid = ?').bind(c.req.param('uid')).first();
  return item ? c.json({ item }) : refuse(c, 404, { code: 'not_found', message: 'No such item.' });
});

/** Apply the defined fields of `f` to one row, by a fixed column list. */
async function patchRow(env: Env, table: 'learning_items' | 'learning_courses', columns: readonly string[], uid: string, f: Record<string, unknown>) {
  const set: string[] = [];
  const vals: unknown[] = [];
  for (const col of columns) {
    if (f[col] !== undefined) { set.push(col + ' = ?'); vals.push(f[col]); }
  }
  if (!set.length) return 0;
  set.push('updated_at = ?');
  vals.push(now());
  const sql = 'UPDATE ' + table + ' SET ' + set.join(', ') + ' WHERE uid = ?';
  const res = await env.DB.prepare(sql).bind(...vals, uid).run();
  return Number(res?.meta?.changes ?? 0);
}

r.patch('/items/:uid', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  return guarded(c, async () => {
    const uid = c.req.param('uid');
    const before = await c.env.DB.prepare('SELECT kind FROM learning_items WHERE uid = ?').bind(uid).first<{ kind: string }>();
    if (!before) return refuse(c, 404, { code: 'not_found', message: 'No such item.' });
    const f = itemFields(await c.req.json().catch(() => ({})), false);
    const changed = await patchRow(c.env, 'learning_items', ITEM_COLUMNS, uid, f);
    // A link replaces an uploaded video (the daily sweep removes the object);
    // clearing the link leaves an uploaded video where it is (D561).
    if (f.video_url) {
      await c.env.DB.prepare(`UPDATE learning_items SET video_source = 'url', r2_key = NULL WHERE uid = ?`).bind(uid).run();
    } else if (f.video_url === null) {
      await c.env.DB.prepare(`UPDATE learning_items SET video_source = NULL WHERE uid = ? AND video_source = 'url'`).bind(uid).run();
    }
    await record(c, admin, 'learning.item.update', { uid, fields: ITEM_COLUMNS.filter((k) => (f as any)[k] !== undefined) });
    void changed;
    return c.json({ item: await c.env.DB.prepare(ITEM_SELECT + ' WHERE uid = ?').bind(uid).first() });
  });
});

export const NEXT_STATUS: Record<string, 'published' | 'draft' | 'archived'> = { publish: 'published', unpublish: 'draft', archive: 'archived' };

async function setItemStatus(c: Context<{ Bindings: Env }>, action: 'publish' | 'unpublish' | 'archive') {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  const uid = c.req.param('uid') as string;
  const item = await c.env.DB.prepare('SELECT kind, title, body, video_url, video_source, r2_key FROM learning_items WHERE uid = ?').bind(uid).first<any>();
  if (!item) return refuse(c, 404, { code: 'not_found', message: 'No such item.' });
  if (action === 'publish') {
    // D561 — a video has its link or an uploaded file.
    const hasVideo = !!item.video_url || (item.video_source === 'r2' && !!item.r2_key);
    if (item.kind === 'video' && !hasVideo) return refuse(c, 409, { code: 'no_video', message: 'A video needs its link or an uploaded file before it is published.' });
    if (item.kind === 'reading' && !item.body) return refuse(c, 409, { code: 'no_body', message: 'A reading needs its text before it is published.' });
  }
  const t = now();
  await c.env.DB.prepare(
    `UPDATE learning_items SET status = ?, updated_at = ?, published_at = CASE WHEN ? = 'published' THEN COALESCE(published_at, ?) ELSE published_at END WHERE uid = ?`,
  ).bind(NEXT_STATUS[action], t, NEXT_STATUS[action], t, uid).run();
  await record(c, admin, `learning.item.${action}`, { uid });
  return c.json({ item: await c.env.DB.prepare(ITEM_SELECT + ' WHERE uid = ?').bind(uid).first() });
}
r.post('/items/:uid/publish', (c) => setItemStatus(c, 'publish'));
r.post('/items/:uid/unpublish', (c) => setItemStatus(c, 'unpublish'));
r.post('/items/:uid/archive', (c) => setItemStatus(c, 'archive'));

// ---- courses -------------------------------------------------------------------

r.get('/courses', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  const res = await c.env.DB.prepare(COURSE_SELECT + ' ORDER BY updated_at DESC, id DESC LIMIT 500').all<any>();
  return c.json({ courses: (res.results || []).map(({ id: _id, ...x }) => x) });
});

async function slugTaken(env: Env, slug: string, exceptUid: string | null) {
  const row = await env.DB.prepare('SELECT uid FROM learning_courses WHERE slug = ?').bind(slug).first<{ uid: string }>();
  return !!row && row.uid !== exceptUid;
}

r.post('/courses', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  return guarded(c, async () => {
    const f = courseFields(await c.req.json().catch(() => ({})), true);
    if (await slugTaken(c.env, f.slug as string, null)) return refuse(c, 409, { code: 'slug_taken', message: 'Another course already has that slug.' });
    const uid = newUid();
    const t = now();
    await c.env.DB.prepare(
      `INSERT INTO learning_courses (uid, slug, title, summary, cover_url, level, estimated_minutes, resources_json, visibility, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
    ).bind(uid, f.slug, f.title, f.summary ?? null, f.cover_url ?? null, f.level ?? null, f.estimated_minutes ?? null,
      f.resources_json ?? '[]', f.visibility ?? 'open', admin.id, t, t).run();
    await record(c, admin, 'learning.course.create', { uid, slug: f.slug });
    return c.json({ course: await courseTree(c.env, uid) }, 201);
  });
});

async function courseTree(env: Env, uid: string) {
  const course = await env.DB.prepare(COURSE_SELECT + ' WHERE uid = ?').bind(uid).first<any>();
  if (!course) return null;
  const [mods, lessons] = await Promise.all([
    env.DB.prepare('SELECT id, uid, title, position FROM learning_course_modules WHERE course_id = ? ORDER BY position, id').bind(course.id).all<any>(),
    env.DB.prepare(`SELECT l.uid, l.module_id, l.title, l.position, l.kind, l.ref_uid, l.required FROM learning_lessons l
                      JOIN learning_course_modules m ON m.id = l.module_id WHERE m.course_id = ? ORDER BY l.position, l.id`).bind(course.id).all<any>(),
  ]);
  const { id: _id, resources_json, ...rest } = course;
  let resources: unknown = [];
  try { resources = JSON.parse(resources_json || '[]'); } catch { resources = []; }
  return {
    ...rest, resources,
    modules: (mods.results || []).map((m) => ({
      uid: m.uid, title: m.title, position: m.position,
      lessons: (lessons.results || []).filter((l) => l.module_id === m.id)
        .map(({ module_id: _m, ...l }) => ({ ...l, required: Number(l.required) === 1 })),
    })),
  };
}

r.get('/courses/:uid', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  const course = await courseTree(c.env, c.req.param('uid'));
  return course ? c.json({ course }) : refuse(c, 404, { code: 'not_found', message: 'No such course.' });
});

r.patch('/courses/:uid', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  return guarded(c, async () => {
    const uid = c.req.param('uid');
    const exists = await c.env.DB.prepare('SELECT uid FROM learning_courses WHERE uid = ?').bind(uid).first();
    if (!exists) return refuse(c, 404, { code: 'not_found', message: 'No such course.' });
    const f = courseFields(await c.req.json().catch(() => ({})), false);
    if (f.slug !== undefined && await slugTaken(c.env, f.slug, uid)) {
      return refuse(c, 409, { code: 'slug_taken', message: 'Another course already has that slug.' });
    }
    await patchRow(c.env, 'learning_courses', COURSE_COLUMNS, uid, f);
    await record(c, admin, 'learning.course.update', { uid, fields: COURSE_COLUMNS.filter((k) => (f as any)[k] !== undefined) });
    return c.json({ course: await courseTree(c.env, uid) });
  });
});

async function setCourseStatus(c: Context<{ Bindings: Env }>, action: 'publish' | 'unpublish' | 'archive') {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  const uid = c.req.param('uid') as string;
  const course = await c.env.DB.prepare('SELECT id FROM learning_courses WHERE uid = ?').bind(uid).first<{ id: number }>();
  if (!course) return refuse(c, 404, { code: 'not_found', message: 'No such course.' });
  if (action === 'publish') {
    const n = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM learning_lessons l JOIN learning_course_modules m ON m.id = l.module_id WHERE m.course_id = ?',
    ).bind(course.id).first<{ n: number }>();
    if (!Number(n?.n)) return refuse(c, 409, { code: 'no_lessons', message: 'A course needs at least one lesson before it is published.' });
  }
  const t = now();
  await c.env.DB.prepare(
    `UPDATE learning_courses SET status = ?, updated_at = ?, published_at = CASE WHEN ? = 'published' THEN COALESCE(published_at, ?) ELSE published_at END WHERE uid = ?`,
  ).bind(NEXT_STATUS[action], t, NEXT_STATUS[action], t, uid).run();
  await record(c, admin, `learning.course.${action}`, { uid });
  return c.json({ course: await courseTree(c.env, uid) });
}
r.post('/courses/:uid/publish', (c) => setCourseStatus(c, 'publish'));
r.post('/courses/:uid/unpublish', (c) => setCourseStatus(c, 'unpublish'));
r.post('/courses/:uid/archive', (c) => setCourseStatus(c, 'archive'));

// ---- modules and lessons ---------------------------------------------------------

r.post('/courses/:uid/modules', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  const course = await c.env.DB.prepare('SELECT id, uid FROM learning_courses WHERE uid = ?').bind(c.req.param('uid')).first<any>();
  if (!course) return refuse(c, 404, { code: 'not_found', message: 'No such course.' });
  const title = text((await c.req.json().catch(() => ({})))?.title, 200);
  if (!title) return refuse(c, 400, { code: 'bad_title', message: 'A module needs a title.' });
  const uid = newUid();
  // Appended after the last module, in one statement, so two adds cannot share a position.
  await c.env.DB.prepare(
    `INSERT INTO learning_course_modules (uid, course_id, title, position)
     SELECT ?, ?, ?, COALESCE(MAX(position), -1) + 1 FROM learning_course_modules WHERE course_id = ?`,
  ).bind(uid, course.id, title, course.id).run();
  await record(c, admin, 'learning.module.create', { uid, course_uid: course.uid });
  return c.json({ course: await courseTree(c.env, course.uid) }, 201);
});

/** Reorder a parent's children by a complete list of their uids. */
async function reorder(c: Context<{ Bindings: Env }>, table: 'learning_course_modules' | 'learning_lessons',
  parentCol: 'course_id' | 'module_id', parentId: number) {
  const order = (await c.req.json().catch(() => ({})))?.order;
  const sel = table === 'learning_course_modules'
    ? 'SELECT uid FROM learning_course_modules WHERE course_id = ?'
    : 'SELECT uid FROM learning_lessons WHERE module_id = ?';
  void parentCol;
  const current = ((await c.env.DB.prepare(sel).bind(parentId).all<{ uid: string }>()).results || []).map((x) => x.uid);
  if (!Array.isArray(order) || order.length !== current.length || new Set(order).size !== order.length
      || !order.every((u) => current.includes(u))) {
    return refuse(c, 400, { code: 'bad_order', message: 'order lists every child exactly once.' });
  }
  const upd = table === 'learning_course_modules'
    ? 'UPDATE learning_course_modules SET position = ?, updated_at = ? WHERE uid = ? AND course_id = ?'
    : 'UPDATE learning_lessons SET position = ?, updated_at = ? WHERE uid = ? AND module_id = ?';
  const t = now();
  await c.env.DB.batch(order.map((u: string, i: number) => c.env.DB.prepare(upd).bind(i, t, u, parentId)));
  return null;
}

r.post('/courses/:uid/modules/order', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  const course = await c.env.DB.prepare('SELECT id, uid FROM learning_courses WHERE uid = ?').bind(c.req.param('uid')).first<any>();
  if (!course) return refuse(c, 404, { code: 'not_found', message: 'No such course.' });
  const refused = await reorder(c, 'learning_course_modules', 'course_id', course.id);
  if (refused) return refused;
  await record(c, admin, 'learning.module.reorder', { course_uid: course.uid });
  return c.json({ course: await courseTree(c.env, course.uid) });
});

async function moduleOf(env: Env, uid: string) {
  return env.DB.prepare(
    `SELECT m.id, m.uid, c.uid AS course_uid FROM learning_course_modules m JOIN learning_courses c ON c.id = m.course_id WHERE m.uid = ?`,
  ).bind(uid).first<{ id: number; uid: string; course_uid: string }>();
}

r.patch('/modules/:uid', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  const mod = await moduleOf(c.env, c.req.param('uid'));
  if (!mod) return refuse(c, 404, { code: 'not_found', message: 'No such module.' });
  const title = text((await c.req.json().catch(() => ({})))?.title, 200);
  if (!title) return refuse(c, 400, { code: 'bad_title', message: 'A module needs a title.' });
  await c.env.DB.prepare('UPDATE learning_course_modules SET title = ?, updated_at = ? WHERE id = ?').bind(title, now(), mod.id).run();
  await record(c, admin, 'learning.module.update', { uid: mod.uid });
  return c.json({ course: await courseTree(c.env, mod.course_uid) });
});

r.delete('/modules/:uid', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  const mod = await moduleOf(c.env, c.req.param('uid'));
  if (!mod) return refuse(c, 404, { code: 'not_found', message: 'No such module.' });
  // Only an empty module goes, in one statement, so a lesson added meanwhile keeps it.
  const res = await c.env.DB.prepare(
    'DELETE FROM learning_course_modules WHERE id = ? AND NOT EXISTS (SELECT 1 FROM learning_lessons WHERE module_id = ?)',
  ).bind(mod.id, mod.id).run();
  if (!Number(res?.meta?.changes ?? 0)) return refuse(c, 409, { code: 'module_not_empty', message: 'Remove the module’s lessons first.' });
  await record(c, admin, 'learning.module.delete', { uid: mod.uid });
  return c.json({ course: await courseTree(c.env, mod.course_uid) });
});

/** What a lesson of each kind may point at. */
async function checkRef(env: Env, kind: string, ref: unknown): Promise<string> {
  const uid = typeof ref === 'string' ? ref.trim() : '';
  if (!uid) bad('bad_ref', 'A lesson names what it opens: ref_uid.');
  // D559 (#1160): an exercise or exam lesson names one of its own kind.
  if (kind === 'exercise' || kind === 'exam') {
    const found = kind === 'exercise'
      ? await env.DB.prepare('SELECT id FROM learning_exercises WHERE uid = ?').bind(uid).first()
      : await env.DB.prepare('SELECT id FROM learning_exams WHERE uid = ?').bind(uid).first();
    if (!found) bad('bad_ref', `An ${kind} lesson names an ${kind}.`);
    return uid;
  }
  if (kind === 'webinar') {
    const ev = await env.DB.prepare('SELECT id FROM events WHERE slug = ?').bind(uid).first();
    if (!ev) bad('bad_ref', 'A webinar lesson names an event by its slug.');
    return uid;
  }
  const item = await env.DB.prepare('SELECT kind FROM learning_items WHERE uid = ?').bind(uid).first<{ kind: string }>();
  if (!item || item.kind !== kind) bad('bad_ref', `A ${kind} lesson names a ${kind} item.`);
  return uid;
}

r.post('/modules/:uid/lessons', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  return guarded(c, async () => {
    const mod = await moduleOf(c.env, c.req.param('uid'));
    if (!mod) return refuse(c, 404, { code: 'not_found', message: 'No such module.' });
    const b = await c.req.json().catch(() => ({} as any));
    const kind = oneOf(b?.kind, LESSON_KINDS, 'kind');
    if (!kind) bad('bad_kind', `kind is one of ${LESSON_KINDS.join(', ')}.`);
    const title = text(b?.title, 200);
    if (!title) bad('bad_title', 'A lesson needs a title.');
    const ref = await checkRef(c.env, kind as string, b?.ref_uid);
    const uid = newUid();
    await c.env.DB.prepare(
      `INSERT INTO learning_lessons (uid, module_id, title, position, kind, ref_uid, required)
       SELECT ?, ?, ?, COALESCE(MAX(position), -1) + 1, ?, ?, ? FROM learning_lessons WHERE module_id = ?`,
    ).bind(uid, mod.id, title, kind, ref, b?.required === false ? 0 : 1, mod.id).run();
    await record(c, admin, 'learning.lesson.create', { uid, module_uid: mod.uid, kind });
    return c.json({ course: await courseTree(c.env, mod.course_uid) }, 201);
  });
});

r.post('/modules/:uid/lessons/order', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  const mod = await moduleOf(c.env, c.req.param('uid'));
  if (!mod) return refuse(c, 404, { code: 'not_found', message: 'No such module.' });
  const refused = await reorder(c, 'learning_lessons', 'module_id', mod.id);
  if (refused) return refused;
  await record(c, admin, 'learning.lesson.reorder', { module_uid: mod.uid });
  return c.json({ course: await courseTree(c.env, mod.course_uid) });
});

async function lessonOf(env: Env, uid: string) {
  return env.DB.prepare(
    `SELECT l.id, l.uid, l.kind, c.uid AS course_uid FROM learning_lessons l
       JOIN learning_course_modules m ON m.id = l.module_id JOIN learning_courses c ON c.id = m.course_id WHERE l.uid = ?`,
  ).bind(uid).first<{ id: number; uid: string; kind: string; course_uid: string }>();
}

r.patch('/lessons/:uid', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  return guarded(c, async () => {
    const lesson = await lessonOf(c.env, c.req.param('uid'));
    if (!lesson) return refuse(c, 404, { code: 'not_found', message: 'No such lesson.' });
    const b = await c.req.json().catch(() => ({} as any));
    const title = text(b?.title, 200);
    if (title === null) bad('bad_title', 'A lesson needs a title.');
    const ref = b?.ref_uid === undefined ? undefined : await checkRef(c.env, lesson.kind, b.ref_uid);
    const required = b?.required === undefined ? undefined : (b.required ? 1 : 0);
    await c.env.DB.prepare(
      `UPDATE learning_lessons SET title = COALESCE(?, title), ref_uid = COALESCE(?, ref_uid),
         required = COALESCE(?, required), updated_at = ? WHERE id = ?`,
    ).bind(title ?? null, ref ?? null, required ?? null, now(), lesson.id).run();
    await record(c, admin, 'learning.lesson.update', { uid: lesson.uid });
    return c.json({ course: await courseTree(c.env, lesson.course_uid) });
  });
});

r.delete('/lessons/:uid', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  const lesson = await lessonOf(c.env, c.req.param('uid'));
  if (!lesson) return refuse(c, 404, { code: 'not_found', message: 'No such lesson.' });
  await c.env.DB.prepare('DELETE FROM learning_lessons WHERE id = ?').bind(lesson.id).run();
  await record(c, admin, 'learning.lesson.delete', { uid: lesson.uid });
  return c.json({ course: await courseTree(c.env, lesson.course_uid) });
});

export default r;
