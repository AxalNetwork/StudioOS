/**
 * D560 (#1161) — Learning webinars, member side. Mounted at /api/learning
 * beside `learning.ts`.
 *
 *   GET    /webinars?when=upcoming|past   published webinars (and cancelled ones), with counts; never a join link
 *   GET    /webinars/:uid                 one webinar, the caller's registration, and the join link inside its window
 *   POST   /webinars/:uid/registration    register, within capacity, before the end
 *   DELETE /webinars/:uid/registration    unregister, before the end
 *   GET    /webinars/:uid/calendar.ics    the event, for a calendar
 *
 * VISIBILITY IS `canSeeLearning`, as for every Learning subject. A cancelled
 * webinar is still shown, as cancelled, so a registered member learns it is
 * off; it offers no registration and no link.
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { requireAuth, isSuperAdmin } from '../auth';
import { refuse } from '../util/refusal';
import { mapError } from './_t13t14t15_helpers';
import { canSeeLearning } from '../services/learningAccess';
import { buildEventIcs } from '../services/eventsCommon';
import {
  WEBINAR_COLS, memberWebinar, recordingOf, registeredCounts, webinarPhase, type WebinarRow,
} from '../services/learningWebinars';

const r = new Hono<{ Bindings: Env }>();
type C = Context<{ Bindings: Env }>;

async function auth(c: C): Promise<any | Response> {
  try { return await requireAuth(c); } catch (e) { return mapError(c, e); }
}

/** A cancelled webinar is shown as one: `canSeeLearning` reads it as published. */
const seen = (user: any, w: WebinarRow) =>
  canSeeLearning(user, { status: w.status === 'cancelled' ? 'published' : w.status, visibility: w.visibility });

async function visible(c: C, user: any): Promise<WebinarRow | Response> {
  const w = await c.env.DB.prepare('SELECT ' + WEBINAR_COLS + ' FROM learning_webinars WHERE uid = ?')
    .bind(c.req.param('uid') ?? '').first<WebinarRow>();
  // Not found and not visible answer alike: a draft's uid is not confirmed to exist.
  if (!w || !seen(user, w)) return refuse(c, 404, { code: 'not_found', message: 'No such webinar.' });
  return w;
}

const registrationOf = (env: Env, webinarId: number, userId: number) =>
  env.DB.prepare('SELECT registered_at, attended FROM learning_webinar_registrations WHERE webinar_id = ? AND user_id = ?')
    .bind(webinarId, userId).first<{ registered_at: string; attended: number | null }>();

const registrationView = (reg: { registered_at: string; attended: number | null } | null) => reg
  ? { registered: true, registered_at: reg.registered_at, attended: reg.attended === null ? null : Number(reg.attended) === 1 }
  : { registered: false, registered_at: null, attended: null };

r.get('/webinars', async (c) => {
  const user = await auth(c); if (user instanceof Response) return user;
  const when = c.req.query('when') || 'upcoming';
  if (when !== 'upcoming' && when !== 'past') return refuse(c, 400, { code: 'bad_when', message: 'when is upcoming or past.' });
  const nowIso = new Date().toISOString();
  const sa = isSuperAdmin(user) ? 1 : 0;
  // Upcoming has not ended yet (live ones included), soonest first; past has, newest first.
  const res = await c.env.DB.prepare(
    'SELECT ' + WEBINAR_COLS + ` FROM learning_webinars
      WHERE status IN ('published', 'cancelled') AND (? = 1 OR visibility = 'open') AND starts_at IS NOT NULL AND ends_at IS NOT NULL
        AND ((? = 'upcoming' AND ends_at > ?) OR (? = 'past' AND ends_at <= ?))
      ORDER BY CASE WHEN ? = 'upcoming' THEN starts_at END ASC, CASE WHEN ? = 'past' THEN starts_at END DESC, id
      LIMIT 100`,
  ).bind(sa, when, nowIso, when, nowIso, when, when).all<WebinarRow>();
  const rows = (res.results || []).filter((w) => seen(user, w));
  const counts = await registeredCounts(c.env, rows.map((w) => w.id));
  const mine = new Set<number>();
  if (rows.length) {
    const ph = rows.map(() => '?').join(', ');
    const regs = await c.env.DB.prepare(
      `SELECT webinar_id FROM learning_webinar_registrations WHERE user_id = ? AND webinar_id IN (${ph})`,
    ).bind(user.id, ...rows.map((w) => w.id)).all<{ webinar_id: number }>();
    for (const x of regs.results || []) mine.add(Number(x.webinar_id));
  }
  const now = Date.now();
  const webinars = [];
  for (const w of rows) {
    // A list never carries the join link, whatever the window says.
    const { join_url: _j, ...shown } = memberWebinar(w, { registeredCount: counts.get(w.id) ?? 0, registered: mine.has(w.id), now });
    void _j;
    webinars.push({
      ...shown, registered: mine.has(w.id),
      recording: when === 'past' ? await recordingOf(c.env, w) : null,
    });
  }
  return c.json({ when, webinars });
});

r.get('/webinars/:uid', async (c) => {
  const user = await auth(c); if (user instanceof Response) return user;
  const w = await visible(c, user); if (w instanceof Response) return w;
  const [reg, counts] = await Promise.all([registrationOf(c.env, w.id, user.id), registeredCounts(c.env, [w.id])]);
  const now = Date.now();
  return c.json({
    webinar: memberWebinar(w, { registeredCount: counts.get(w.id) ?? 0, registered: Boolean(reg), now }),
    registration: registrationView(reg ?? null),
    recording: webinarPhase(w, now) === 'past' ? await recordingOf(c.env, w) : null,
    ics_href: `/api/learning/webinars/${w.uid}/calendar.ics`,
  });
});

r.post('/webinars/:uid/registration', async (c) => {
  const user = await auth(c); if (user instanceof Response) return user;
  const w = await visible(c, user); if (w instanceof Response) return w;
  if (w.status !== 'published') return refuse(c, 409, { code: 'cancelled', message: 'This webinar was cancelled.' });
  if (webinarPhase(w, Date.now()) === 'past') return refuse(c, 409, { code: 'ended', message: 'This webinar has ended.' });
  const existing = await registrationOf(c.env, w.id, user.id);
  if (existing) return c.json({ registration: registrationView(existing) });
  const t = new Date().toISOString();
  // One statement checks the capacity and inserts, so two members cannot both take the last seat.
  const res = await c.env.DB.prepare(
    `INSERT INTO learning_webinar_registrations (webinar_id, user_id, registered_at)
     SELECT ?, ?, ? WHERE ? IS NULL OR (SELECT COUNT(*) FROM learning_webinar_registrations WHERE webinar_id = ?) < ?
     ON CONFLICT (webinar_id, user_id) DO NOTHING`,
  ).bind(w.id, user.id, t, w.capacity, w.id, w.capacity).run();
  if (!Number((res as any)?.meta?.changes ?? 0)) {
    const again = await registrationOf(c.env, w.id, user.id);
    if (again) return c.json({ registration: registrationView(again) });
    return refuse(c, 409, { code: 'full', message: 'This webinar is full.' });
  }
  return c.json({ registration: registrationView(await registrationOf(c.env, w.id, user.id)) }, 201);
});

r.delete('/webinars/:uid/registration', async (c) => {
  const user = await auth(c); if (user instanceof Response) return user;
  const w = await visible(c, user); if (w instanceof Response) return w;
  if (webinarPhase(w, Date.now()) === 'past') {
    return refuse(c, 409, { code: 'ended', message: 'This webinar has ended; its registrations are its attendance record.' });
  }
  const res = await c.env.DB.prepare('DELETE FROM learning_webinar_registrations WHERE webinar_id = ? AND user_id = ?')
    .bind(w.id, user.id).run();
  if (!Number((res as any)?.meta?.changes ?? 0)) return refuse(c, 404, { code: 'not_registered', message: 'You are not registered.' });
  return c.json({ registration: registrationView(null) });
});

r.get('/webinars/:uid/calendar.ics', async (c) => {
  const user = await auth(c); if (user instanceof Response) return user;
  const w = await visible(c, user); if (w instanceof Response) return w;
  if (!w.starts_at || !w.ends_at) return refuse(c, 409, { code: 'no_time', message: 'This webinar has no time recorded yet.' });
  const base = new URL(c.req.url).origin;
  // The calendar entry links to the webinar's page, never to the join link.
  const ics = buildEventIcs(
    { title: w.title, summary: w.abstract, starts_at: w.starts_at, ends_at: w.ends_at, updated_at: w.updated_at, location_text: 'Online' },
    base, { uid: `webinar-${w.uid}@axal.vc`, url: `${base}/learning/webinars/${w.uid}` },
  );
  return new Response(ics, {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `attachment; filename="webinar-${w.uid}.ics"` },
  });
});

export default r;
