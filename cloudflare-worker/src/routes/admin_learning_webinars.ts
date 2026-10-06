/**
 * D560 (#1161) — authoring webinars. Mounted at /api/admin/learning beside
 * `admin_learning.ts`.
 *
 * THE SUPER ADMIN ONLY, and every write recorded with `logAdminAction`
 * (`learning.webinar.*`), actor and subject.
 *
 *   GET   /webinars
 *   POST  /webinars                          create (a draft)
 *   GET   /webinars/:uid                     with its registrations (name and uid, never email)
 *   PATCH /webinars/:uid                     title, abstract, host_name, starts_at, ends_at, timezone, join_url, capacity, visibility
 *   POST  /webinars/:uid/publish | unpublish | cancel
 *   PUT   /webinars/:uid/recording           {item_uid} a video item, or null to detach
 *   PATCH /webinars/:uid/registrations/:userUid   {attended: true | false | null}
 *
 * Times are stored as UTC ISO instants, so they compare as text. A join link
 * must be https. A capacity below the current registrations is refused rather
 * than leaving a webinar over its own limit.
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { refuse } from '../util/refusal';
import { newUid } from './_t13t14t15_helpers';
import { gate, record, text, oneOf, guarded, bad, type Admin } from './admin_learning';
import { httpsUrl, LEARNING_VISIBILITIES } from '../services/learningAccess';
import { WEBINAR_COLS, registeredCounts, type WebinarRow } from '../services/learningWebinars';

const r = new Hono<{ Bindings: Env }>();
type C = Context<{ Bindings: Env }>;

const now = () => new Date().toISOString();

const byUid = (env: Env, uid: string) =>
  env.DB.prepare('SELECT ' + WEBINAR_COLS + ' FROM learning_webinars WHERE uid = ?').bind(uid).first<WebinarRow>();

async function webinarOr404(c: C): Promise<WebinarRow | Response> {
  const w = await byUid(c.env, c.req.param('uid') ?? '');
  return w ?? refuse(c, 404, { code: 'not_found', message: 'No such webinar.' });
}

function instant(v: unknown, field: string): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  if (!Number.isFinite(t)) bad(`bad_${field}`, `${field} is an ISO 8601 date and time.`);
  return new Date(t).toISOString();
}

function zone(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  try {
    new Intl.DateTimeFormat('en', { timeZone: String(v) });
    return String(v);
  } catch {
    return bad('bad_timezone', 'timezone is an IANA zone, such as Europe/Paris.');
  }
}

function fields(b: any, creating: boolean) {
  const title = text(b?.title, 200);
  if ((creating && !title) || title === null) bad('bad_title', 'A webinar needs a title.');
  let join_url: string | null | undefined;
  if (b?.join_url !== undefined) {
    join_url = b.join_url === null || b.join_url === '' ? null : httpsUrl(b.join_url) ?? bad('bad_join_url', 'A join link must be an https URL.');
  }
  let capacity: number | null | undefined;
  if (b?.capacity !== undefined) {
    capacity = b.capacity === null || b.capacity === '' ? null : Number(b.capacity);
    if (capacity !== null && !(Number.isInteger(capacity) && capacity > 0)) bad('bad_capacity', 'capacity is a whole number above 0, or empty for no limit.');
  }
  return {
    title,
    abstract: text(b?.abstract, 5000),
    host_name: text(b?.host_name, 200),
    starts_at: instant(b?.starts_at, 'starts_at'),
    ends_at: instant(b?.ends_at, 'ends_at'),
    timezone: zone(b?.timezone),
    join_url,
    capacity,
    visibility: oneOf(b?.visibility, LEARNING_VISIBILITIES, 'visibility'),
  };
}

async function detail(env: Env, w: WebinarRow) {
  const regs = await env.DB.prepare(
    `SELECT u.uid, COALESCE(u.display_name, u.name) AS name, rg.registered_at, rg.attended
       FROM learning_webinar_registrations rg JOIN users u ON u.id = rg.user_id WHERE rg.webinar_id = ? ORDER BY rg.id`,
  ).bind(w.id).all<any>();
  const { id: _id, ...shown } = w;
  void _id;
  return {
    webinar: { ...shown, registered_count: (regs.results || []).length },
    registrations: (regs.results || []).map((x) => ({ ...x, attended: x.attended === null ? null : Number(x.attended) === 1 })),
  };
}

r.get('/webinars', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  const res = await c.env.DB.prepare('SELECT ' + WEBINAR_COLS + ' FROM learning_webinars ORDER BY COALESCE(starts_at, created_at) DESC, id DESC LIMIT 500').all<WebinarRow>();
  const rows = res.results || [];
  const counts = await registeredCounts(c.env, rows.map((w) => w.id));
  return c.json({ webinars: rows.map(({ id, ...w }) => ({ ...w, registered_count: counts.get(id) ?? 0 })) });
});

r.post('/webinars', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  return guarded(c, async () => {
    const f = fields(await c.req.json().catch(() => ({})), true);
    if (f.starts_at && f.ends_at && f.ends_at <= f.starts_at) bad('bad_ends_at', 'A webinar ends after it starts.');
    const uid = newUid();
    const t = now();
    await c.env.DB.prepare(
      `INSERT INTO learning_webinars (uid, title, abstract, host_name, starts_at, ends_at, timezone, join_url, capacity, visibility, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
    ).bind(uid, f.title, f.abstract ?? null, f.host_name ?? null, f.starts_at ?? null, f.ends_at ?? null, f.timezone ?? null,
      f.join_url ?? null, f.capacity ?? null, f.visibility ?? 'open', admin.id, t, t).run();
    await record(c, admin, 'learning.webinar.create', { uid });
    return c.json(await detail(c.env, (await byUid(c.env, uid)) as WebinarRow), 201);
  });
});

r.get('/webinars/:uid', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  const w = await webinarOr404(c); if (w instanceof Response) return w;
  return c.json(await detail(c.env, w));
});

const COLUMNS = ['title', 'abstract', 'host_name', 'starts_at', 'ends_at', 'timezone', 'join_url', 'capacity', 'visibility'] as const;

r.patch('/webinars/:uid', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  const w = await webinarOr404(c); if (w instanceof Response) return w;
  return guarded(c, async () => {
    const f = fields(await c.req.json().catch(() => ({})), false) as Record<string, unknown>;
    if (f.visibility === null) bad('bad_visibility', 'visibility is open or program.');
    const starts = f.starts_at !== undefined ? f.starts_at : w.starts_at;
    const ends = f.ends_at !== undefined ? f.ends_at : w.ends_at;
    if (starts && ends && String(ends) <= String(starts)) bad('bad_ends_at', 'A webinar ends after it starts.');
    if (w.status === 'published' && (!starts || !ends)) bad('needs_time', 'A published webinar keeps its start and end.');
    if (typeof f.capacity === 'number') {
      const n = (await registeredCounts(c.env, [w.id])).get(w.id) ?? 0;
      if (f.capacity < n) bad('capacity_below_registrations', `${n} members are registered; the capacity cannot be lower.`);
    }
    const set: string[] = [];
    const vals: unknown[] = [];
    for (const col of COLUMNS) if (f[col] !== undefined) { set.push(col + ' = ?'); vals.push(f[col]); }
    if (!set.length) bad('nothing_to_change', `Send at least one of ${COLUMNS.join(', ')}.`);
    await c.env.DB.prepare(`UPDATE learning_webinars SET ${set.join(', ')}, updated_at = ? WHERE id = ?`).bind(...vals, now(), w.id).run();
    await record(c, admin, 'learning.webinar.update', { uid: w.uid, fields: COLUMNS.filter((k) => f[k] !== undefined) });
    return c.json(await detail(c.env, (await byUid(c.env, w.uid)) as WebinarRow));
  });
});

async function setStatus(c: C, action: 'publish' | 'unpublish' | 'cancel') {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  const w = await webinarOr404(c); if (w instanceof Response) return w;
  if (action === 'publish' && (!w.starts_at || !w.ends_at)) {
    return refuse(c, 400, { code: 'needs_time', message: 'A webinar needs its start and end before it is published.' });
  }
  if (action === 'cancel' && w.status !== 'published') {
    return refuse(c, 409, { code: 'not_published', message: 'Only a published webinar is cancelled; unpublish a draft instead.' });
  }
  const next = action === 'publish' ? 'published' : action === 'cancel' ? 'cancelled' : 'draft';
  const t = now();
  await c.env.DB.prepare(
    `UPDATE learning_webinars SET status = ?, updated_at = ?, published_at = CASE WHEN ? = 'published' THEN COALESCE(published_at, ?) ELSE published_at END WHERE id = ?`,
  ).bind(next, t, next, t, w.id).run();
  await record(c, admin as Admin, `learning.webinar.${action}`, { uid: w.uid });
  return c.json(await detail(c.env, (await byUid(c.env, w.uid)) as WebinarRow));
}
r.post('/webinars/:uid/publish', (c) => setStatus(c, 'publish'));
r.post('/webinars/:uid/unpublish', (c) => setStatus(c, 'unpublish'));
r.post('/webinars/:uid/cancel', (c) => setStatus(c, 'cancel'));

r.put('/webinars/:uid/recording', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  const w = await webinarOr404(c); if (w instanceof Response) return w;
  const b = await c.req.json().catch(() => ({} as any));
  const itemUid = b?.item_uid === null ? null : typeof b?.item_uid === 'string' ? b.item_uid.trim() : undefined;
  if (itemUid === undefined || itemUid === '') return refuse(c, 400, { code: 'bad_item', message: 'item_uid names a video item, or is null to detach.' });
  if (itemUid !== null) {
    const item = await c.env.DB.prepare('SELECT kind FROM learning_items WHERE uid = ?').bind(itemUid).first<{ kind: string }>();
    if (!item) return refuse(c, 404, { code: 'no_such_item', message: 'No item has that uid.' });
    if (item.kind !== 'video') return refuse(c, 400, { code: 'not_a_video', message: 'A recording is a video item.' });
  }
  await c.env.DB.prepare('UPDATE learning_webinars SET recording_item_uid = ?, updated_at = ? WHERE id = ?').bind(itemUid, now(), w.id).run();
  await record(c, admin, itemUid ? 'learning.webinar.recording.attach' : 'learning.webinar.recording.detach', { uid: w.uid, item_uid: itemUid });
  return c.json(await detail(c.env, (await byUid(c.env, w.uid)) as WebinarRow));
});

r.patch('/webinars/:uid/registrations/:userUid', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  const w = await webinarOr404(c); if (w instanceof Response) return w;
  const b = await c.req.json().catch(() => ({} as any));
  if (!(b?.attended === true || b?.attended === false || b?.attended === null)) {
    return refuse(c, 400, { code: 'bad_attended', message: 'attended is true, false, or null for not recorded.' });
  }
  const res = await c.env.DB.prepare(
    `UPDATE learning_webinar_registrations SET attended = ?
      WHERE webinar_id = ? AND user_id = (SELECT id FROM users WHERE uid = ?)`,
  ).bind(b.attended === null ? null : b.attended ? 1 : 0, w.id, c.req.param('userUid') ?? '').run();
  if (!Number((res as any)?.meta?.changes ?? 0)) return refuse(c, 404, { code: 'not_registered', message: 'That user is not registered.' });
  await record(c, admin, 'learning.webinar.attendance', { uid: w.uid, user_uid: c.req.param('userUid'), attended: b.attended });
  return c.json(await detail(c.env, w));
});

export default r;
