/**
 * D1486 §b (#3981, source 5b of #3723) — Grow's two dated stores on the
 * calendar, page only.
 *
 *   publish_send     Publish's sends (`642_publish_core.sql`): a scheduled send
 *                    on its `scheduled_for`, a sent one on its `sent_at`. The
 *                    word "Sent" (status `sent`) only for `status = 'sent'`.
 *                    Retracted and removed sends are not on the calendar.
 *   content_planned  Grow › Distribution's planned pieces
 *                    (`587_content_calendar_items.sql`, D1090): an all-day item
 *                    on `planned_on`. A dropped piece is not on the calendar.
 *
 * WHO. Publish's own rule (`routes/publish.ts` `team` → `isTeamViewer`): the
 * venture's founder, or a member of the venture's company. A send is also the
 * member's own: the person who confirmed it (`confirmed_by`). A planned piece
 * is every team member's. Admin access never widens either read.
 */
import type { Env } from '../../types';
import type { CalendarEvent } from '../calendar';
import { PUBLISH_MODULES } from '../../integrations/publishSources';

type Row = Record<string, any>;

function results(value: { results?: Row[] }): Row[] {
  if (!Array.isArray(value.results)) throw new Error('calendar_source_unreadable');
  return value.results;
}

/*
 * Publish's team rule as a join, written out in each query below rather than
 * interpolated: the founder's venture, or a venture of a company the user is
 * linked to. Literal SQL lets the schema guard (check-sqlite-columns) read every
 * column; an interpolated fragment would be skipped unread.
 */
/** The page a send opens: its Grow module, `overview` being Grow itself. */
export function publishHref(module: unknown): string {
  const m = String(module || '');
  if (!(PUBLISH_MODULES as readonly string[]).includes(m) || m === 'overview') return '/grow';
  return `/grow/${m}`;
}

const SEND_STATUS: Readonly<Record<string, string>> = {
  ready: 'scheduled', sending: 'sending', sent: 'sent', failed: 'failed', unknown: 'unknown',
};

export async function publishSendEvents(env: Env, userId: number, from: string, to: string): Promise<CalendarEvent[]> {
  const rows = results(await env.DB.prepare(
    `SELECT s.id, s.uid, s.module, s.destination_label, s.audience_label, s.status, s.project_id,
            strftime('%Y-%m-%dT%H:%M:%fZ', CASE WHEN s.status = 'sent' THEN COALESCE(s.sent_at, s.scheduled_for) ELSE s.scheduled_for END) AS at
       FROM publish_sends s
       JOIN projects p ON p.id = s.project_id AND p.deleted_at IS NULL
       JOIN users u ON u.id = ? AND u.is_active = 1 AND u.deletion_requested_at IS NULL
        AND ((u.founder_id IS NOT NULL AND u.founder_id = p.founder_id)
          OR (p.company_id IS NOT NULL AND EXISTS (SELECT 1 FROM user_company_links l WHERE l.company_id = p.company_id AND l.user_id = u.id)))
      WHERE s.confirmed_by = u.id
        AND s.status IN ('ready', 'sending', 'sent', 'failed', 'unknown')
        AND (CASE WHEN s.status = 'sent' THEN COALESCE(s.sent_at, s.scheduled_for) ELSE s.scheduled_for END) IS NOT NULL
        AND julianday(CASE WHEN s.status = 'sent' THEN COALESCE(s.sent_at, s.scheduled_for) ELSE s.scheduled_for END) >= julianday(?)
        AND julianday(CASE WHEN s.status = 'sent' THEN COALESCE(s.sent_at, s.scheduled_for) ELSE s.scheduled_for END) < julianday(?)
      ORDER BY at, s.id`,
  ).bind(userId, from, to).all<Row>());
  return rows.map((r) => {
    if (!r.at) throw new Error('calendar_source_unreadable');
    const where = String(r.destination_label || '').trim() || 'Publish';
    const audience = String(r.audience_label || '').trim();
    return {
      id: `publish_send:${r.uid}`, kind: 'publish_send' as const, source_id: Number(r.id), source_uid: String(r.uid),
      title: `${r.status === 'sent' ? 'Sent' : 'Scheduled'} · ${where}`,
      start_at: String(r.at), end_at: String(r.at), status: SEND_STATUS[String(r.status)] || 'scheduled',
      location_kind: null, location_uri: null, organizer_email: null, attendees: [],
      notes: audience ? `To ${audience}` : null, project_id: Number(r.project_id), url: publishHref(r.module),
    };
  });
}

export async function contentPlannedEvents(env: Env, userId: number, from: string, to: string): Promise<CalendarEvent[]> {
  const rows = results(await env.DB.prepare(
    `SELECT c.id, c.uid, c.title, c.status, c.project_id, date(c.planned_on) AS day
       FROM content_calendar_items c
       JOIN projects p ON p.id = c.project_id AND p.deleted_at IS NULL
       JOIN users u ON u.id = ? AND u.is_active = 1 AND u.deletion_requested_at IS NULL
        AND ((u.founder_id IS NOT NULL AND u.founder_id = p.founder_id)
          OR (p.company_id IS NOT NULL AND EXISTS (SELECT 1 FROM user_company_links l WHERE l.company_id = p.company_id AND l.user_id = u.id)))
      WHERE c.planned_on IS NOT NULL AND c.status <> 'dropped'
        AND julianday(date(c.planned_on), '+1 day') > julianday(?)
        AND julianday(date(c.planned_on)) < julianday(?)
      ORDER BY date(c.planned_on), c.id`,
  ).bind(userId, from, to).all<Row>());
  return rows.map((r) => {
    const day = String(r.day || '');
    const ms = Date.parse(`${day}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(ms)) throw new Error('calendar_source_unreadable');
    return {
      id: `content_planned:${r.uid}`, kind: 'content_planned' as const, source_id: Number(r.id), source_uid: String(r.uid),
      // All day: a bare date, end exclusive, as D1208's deadlines (`isAllDay`).
      title: String(r.title), start_at: day, end_at: new Date(ms + 86_400_000).toISOString().slice(0, 10),
      status: String(r.status), location_kind: null, location_uri: null, organizer_email: null, attendees: [],
      notes: null, project_id: Number(r.project_id), url: '/grow/distribution',
    };
  });
}
