/**
 * D1614 W4 (#3972) — "Work items" on the calendar: the open tasks of every
 * project the member can read (owner revision, 2026-11-01: the items of the
 * projects the caller can read), page only.
 *
 *   A task with a time block (`scheduled_start` / `scheduled_end`, migration
 *   202611022205) shows in that block. One without shows all day on its due
 *   date. One with neither is not on the calendar.
 *
 * WHO READS WHICH PROJECT. The project's founder-owner (`projects.founder_id`
 * is the member's `founder_id`) and its accepted members (`project_members`),
 * as the project's own Work board reads it (`canAccessProject`). A deleted
 * project is never shown. Done and cancelled tasks are hidden.
 *
 * Agents' scheduled sessions are not Work items. #3957 (PR #4238) put them on
 * the calendar as their own kind, `agent_session` in the "AI agents" family
 * (`services/agents/sessions.ts` `sessionEvents`), with their state and the
 * proposals waiting; listing them here too would show each slot twice. They
 * join the project's workload (`projectAgentSessions` in
 * `services/agents/workWorkload.ts`), not this source.
 */
import type { Env } from '../../types';
import type { CalendarEvent } from '../calendar';
import { dayItem } from './raiseDates';

type Row = Record<string, any>;
const iso = (sqlTime: string) => {
  const ms = Date.parse(`${String(sqlTime).replace(' ', 'T')}Z`);
  if (!Number.isFinite(ms)) throw new Error('calendar_source_unreadable');
  return new Date(ms).toISOString();
};

export async function workItemEvents(env: Env, userId: number, from: string, to: string): Promise<CalendarEvent[]> {
  const res = await env.DB.prepare(
    `SELECT t.id, t.uid, t.title, t.scheduled_start, t.scheduled_end, date(t.due_at) AS day, p.id AS project_id
       FROM scope_tasks t
       JOIN projects p ON p.id = t.project_id AND p.deleted_at IS NULL
       JOIN users u ON u.id = ? AND u.is_active = 1 AND u.deletion_requested_at IS NULL
      WHERE t.scope_kind = 'project' AND t.status NOT IN ('done', 'cancelled')
        AND ((u.founder_id IS NOT NULL AND p.founder_id = u.founder_id)
          OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = u.id AND m.status = 'accepted'))
        AND (
          (t.scheduled_start IS NOT NULL AND julianday(t.scheduled_end) > julianday(?) AND julianday(t.scheduled_start) < julianday(?))
          OR (t.scheduled_start IS NULL AND date(t.due_at) IS NOT NULL
            AND julianday(date(t.due_at), '+1 day') > julianday(?) AND julianday(date(t.due_at)) < julianday(?))
        )
      ORDER BY COALESCE(t.scheduled_start, t.due_at), t.id`,
  ).bind(userId, from, to, from, to).all<Row>();
  if (!Array.isArray(res?.results)) throw new Error('calendar_source_unreadable');
  return res.results.map((r) => {
    const title = `Work · ${String(r.title ?? '').trim() || 'Task'}`;
    if (r.scheduled_start) {
      return {
        id: `work_item:${r.uid}`, kind: 'work_item' as const, source_id: Number(r.id), source_uid: String(r.uid), title,
        start_at: iso(r.scheduled_start), end_at: iso(r.scheduled_end), status: 'scheduled', all_day: false,
        location_kind: null, location_uri: null, organizer_email: null, attendees: [], notes: null,
        project_id: Number(r.project_id),
      } as CalendarEvent;
    }
    return { ...dayItem('work_item', Number(r.id), String(r.uid), title, r.day), project_id: Number(r.project_id) };
  });
}
