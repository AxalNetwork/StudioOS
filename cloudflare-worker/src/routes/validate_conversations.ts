/**
 * D858 (#2503) — conversation analytics for Record a Session.
 *   GET /api/validate/sessions/:id/analytics?channel                     one session's figures
 *   GET /api/validate/conversations/analytics?project_id&from&to&channel  a venture's chats, aggregates only
 *
 * THE CHANNEL FILTER (D866, #2512). `channel` names one channel (`telegram`,
 * `whatsapp`, `recorder`, …; `channelOf`). On a venture it reads that
 * channel's sessions instead of its chats; on a session it answers 404 when
 * the session is of another channel, as a filtered list would leave it out.
 *
 * WHO READS. A signed-in member who may read the venture's board
 * (`canReadBoard`: the venture's own founder, or HQ staff, the same audience
 * as the interviews these figures come from). Anyone else gets a 404, as the
 * session routes answer (D685): another member learns nothing, not even that
 * the session or the venture exists.
 *
 * WHAT IS READ. `services/conversationAnalytics.ts` reads the stores; this file
 * checks the caller and the query. Nothing here calls a model or writes a row.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { canReadBoard, type ProjectRef } from './_founder_validate_helpers';
import {
  CHANNEL_NAME, THREAD_PROVIDER_SQL, channelOf, sessionAnalytics, ventureAnalytics, type AnalyticsSession,
} from '../services/conversationAnalytics';

const r = new Hono<{ Bindings: Env }>();

const ID = /^[1-9][0-9]{0,9}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A `YYYY-MM-DD` that is a real calendar day, else null. */
function day(raw: string | undefined): string | null | false {
  if (raw === undefined || raw === '') return null;
  if (!DAY.test(raw)) return false;
  const d = new Date(`${raw}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === raw ? raw : false;
}

/** D866: a `channel` filter, null when none is named, false when it names nothing a channel can be. */
function channelParam(raw: string | undefined): string | null | false {
  if (raw === undefined || raw === '') return null;
  return CHANNEL_NAME.test(raw) ? raw : false;
}

// GET /api/validate/sessions/:id/analytics?channel=
r.get('/sessions/:id/analytics', async (c) => {
  const raw = c.req.param('id');
  if (!ID.test(raw)) return c.json({ detail: 'Invalid session id' }, 400);
  const channel = channelParam(c.req.query('channel'));
  if (channel === false) return c.json({ detail: 'channel is a channel name, such as telegram' }, 400);
  const user = (await requireAuth(c)) as User;
  const row = await c.env.DB.prepare(
    `SELECT s.id, s.interview_id, s.project_id, s.channel, s.submitted_via, s.consent_status, s.active_ms, s.language,
            s.created_at, ${THREAD_PROVIDER_SQL}, p.founder_id
       FROM interview_sessions s JOIN projects p ON p.id = s.project_id WHERE s.id = ?`,
  ).bind(Number(raw)).first<AnalyticsSession & { founder_id: number | null }>();
  const project: ProjectRef | null = row ? { id: row.project_id, founder_id: row.founder_id } : null;
  if (!row || !project || !canReadBoard(project, user)) return c.json({ detail: 'Session not found' }, 404);
  if (channel && channelOf(row) !== channel) return c.json({ detail: 'Session not found' }, 404);
  const { founder_id: _founder, ...session } = row;
  return c.json({ ok: true, ...(await sessionAnalytics(c.env, session)) });
});

// GET /api/validate/conversations/analytics?project_id=&from=YYYY-MM-DD&to=YYYY-MM-DD&channel=
r.get('/conversations/analytics', async (c) => {
  const raw = c.req.query('project_id') ?? '';
  if (!ID.test(raw)) return c.json({ detail: 'project_id is required' }, 400);
  const from = day(c.req.query('from'));
  const to = day(c.req.query('to'));
  if (from === false || to === false) return c.json({ detail: 'from and to are dates, YYYY-MM-DD' }, 400);
  if (from && to && from > to) return c.json({ detail: 'from is after to' }, 400);
  const channel = channelParam(c.req.query('channel'));
  if (channel === false) return c.json({ detail: 'channel is a channel name, such as telegram' }, 400);
  const user = (await requireAuth(c)) as User;
  const project = await c.env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ?')
    .bind(Number(raw)).first<ProjectRef>();
  if (!project || !canReadBoard(project, user)) return c.json({ detail: 'Project not found' }, 404);
  return c.json({ ok: true, ...(await ventureAnalytics(c.env, project.id, { from, to, channel })) });
});

export default r;
