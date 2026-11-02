/**
 * #3983 (D1486 §d, source 5d of #3723): tasks and engagement milestones on
 * the calendar. Family `tasks`; all page only, all day on the due day, and
 * never in a staff scope (`PERSONAL_ONLY_KINDS`).
 *
 * Each reader shows only the member's own rows, by the rule of the route
 * that serves that table:
 *
 *   workflow_task         `workflow_tasks.due_date`. Assigned to the member
 *                         (`assignee_user_id`, the dashboard's "My tasks"
 *                         rule), or unassigned in a workflow the member owns
 *                         (`workflows.owner_user_id`).
 *   mvp_task              `mvp_tasks.due_date`, a card on the founder board
 *                         (`deal_id` is a projects.id). The board is read by
 *                         the venture's own founder or an active Lab member
 *                         on their own venture (`ownsVenture`), and by an
 *                         admin or partner (`canReadBoard`). A card shows when
 *                         it is assigned to the member and the member can read
 *                         the board, or unassigned on the member's own venture.
 *   contact_task          `contact_tasks.due_date`. Created by the member, on
 *                         a contact of the member's own venture (contacts'
 *                         `ownedProjectScope`). The item names the contact by
 *                         name, never by email.
 *   engagement_milestone  `engagement_milestones.due_at`, for the partner
 *                         firm the member works for (`users.partner_id` =
 *                         `engagements.partner_id`, the role a partner or an
 *                         admin, as `requirePartnerProfile`), on an engagement
 *                         that is not cancelled.
 *
 * A done, cancelled or archived task, a completed milestone, and a row whose
 * due date is empty or not a date are not shown.
 */
import type { Env } from '../../types';
import type { CalendarEvent } from '../calendar';

type Row = Record<string, any>;
export type TaskDateKind = 'workflow_task' | 'mvp_task' | 'contact_task' | 'engagement_milestone';

function results(value: { results?: Row[] }): Row[] {
  if (!Array.isArray(value.results)) throw new Error('calendar_source_unreadable');
  return value.results;
}

/** One all-day item on its due day (`day` is SQLite's `date()` of it); the end is exclusive. */
function dayItem(kind: TaskDateKind, id: number, uid: string, title: string, day: unknown): CalendarEvent & { all_day: true } {
  const d = String(day ?? '');
  const ms = Date.parse(`${d}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(ms)) throw new Error('calendar_source_unreadable');
  return {
    id: `${kind}:${uid}`, kind, source_id: id, source_uid: uid, title,
    start_at: d, end_at: new Date(ms + 86_400_000).toISOString().slice(0, 10), status: 'scheduled', all_day: true,
    location_kind: null, location_uri: null, organizer_email: null, attendees: [], notes: null,
  } as CalendarEvent & { all_day: true };
}

const titled = (v: unknown, fallback: string) => String(v ?? '').trim() || fallback;

/** A workflow task assigned to the member, or unassigned in a workflow the member owns. */
export async function workflowTaskEvents(env: Env, userId: number, from: string, to: string): Promise<CalendarEvent[]> {
  const rows = results(await env.DB.prepare(
    `SELECT t.id, t.title, date(t.due_date) AS day, w.project_id
       FROM workflow_tasks t
       JOIN workflows w ON w.id = t.workflow_id
       JOIN users u ON u.id = ? AND u.is_active = 1 AND u.deletion_requested_at IS NULL
      WHERE (t.assignee_user_id = u.id OR (t.assignee_user_id IS NULL AND w.owner_user_id = u.id))
        AND lower(COALESCE(t.status, 'todo')) NOT IN ('done', 'cancelled', 'canceled', 'archived')
        AND date(t.due_date) IS NOT NULL
        AND julianday(date(t.due_date), '+1 day') > julianday(?)
        AND julianday(date(t.due_date)) < julianday(?)
      ORDER BY date(t.due_date), t.id`,
  ).bind(userId, from, to).all<Row>());
  return rows.map((r) => ({
    ...dayItem('workflow_task', Number(r.id), `wtask-${r.id}`, titled(r.title, 'Task'), r.day),
    project_id: r.project_id == null ? null : Number(r.project_id), url: '/dashboard',
  }));
}

/** A founder-board card: assigned to the member who can read the board, or unassigned on the member's own venture. */
export async function mvpTaskEvents(env: Env, userId: number, from: string, to: string): Promise<CalendarEvent[]> {
  const rows = results(await env.DB.prepare(
    `SELECT t.id, t.title, date(t.due_date) AS day, p.id AS project_id
       FROM mvp_tasks t
       JOIN projects p ON p.id = t.deal_id AND p.deleted_at IS NULL
       JOIN users u ON u.id = ? AND u.is_active = 1 AND u.deletion_requested_at IS NULL
      WHERE (
              (u.founder_id IS NOT NULL AND u.founder_id = p.founder_id
                AND (u.role = 'founder' OR COALESCE(u.spinout_lab_active, 0) = 1)
                AND (t.assigned_to = u.id OR t.assigned_to IS NULL))
           OR (t.assigned_to = u.id AND u.role IN ('admin', 'partner'))
            )
        AND lower(COALESCE(t.status, 'todo')) NOT IN ('done', 'cancelled', 'canceled', 'archived')
        AND date(t.due_date) IS NOT NULL
        AND julianday(date(t.due_date), '+1 day') > julianday(?)
        AND julianday(date(t.due_date)) < julianday(?)
      ORDER BY date(t.due_date), t.id`,
  ).bind(userId, from, to).all<Row>());
  return rows.map((r) => ({
    ...dayItem('mvp_task', Number(r.id), `mvp-${r.id}`, titled(r.title, 'Board card'), r.day),
    project_id: Number(r.project_id), url: '/build/board',
  }));
}

/** A contact task the member created, on a contact of the member's own venture; named by the contact's name. */
export async function contactTaskEvents(env: Env, userId: number, from: string, to: string): Promise<CalendarEvent[]> {
  const rows = results(await env.DB.prepare(
    `SELECT t.id, t.title, date(t.due_date) AS day, c.name AS contact_name, p.id AS project_id
       FROM contact_tasks t
       JOIN contacts c ON c.id = t.contact_id
       JOIN projects p ON p.id = c.project_id AND p.deleted_at IS NULL
       JOIN users u ON u.id = ? AND u.is_active = 1 AND u.deletion_requested_at IS NULL
      WHERE t.created_by = u.id
        AND u.founder_id IS NOT NULL AND u.founder_id = p.founder_id
        AND COALESCE(t.done, 0) = 0
        AND date(t.due_date) IS NOT NULL
        AND julianday(date(t.due_date), '+1 day') > julianday(?)
        AND julianday(date(t.due_date)) < julianday(?)
      ORDER BY date(t.due_date), t.id`,
  ).bind(userId, from, to).all<Row>());
  return rows.map((r) => {
    const who = String(r.contact_name ?? '').trim();
    const title = titled(r.title, 'Contact task');
    return {
      ...dayItem('contact_task', Number(r.id), `ctask-${r.id}`, who ? `${title} · ${who}` : title, r.day),
      project_id: Number(r.project_id), url: '/contacts',
    };
  });
}

/** An open milestone of an engagement held by the member's partner firm. */
export async function engagementMilestoneEvents(env: Env, userId: number, from: string, to: string): Promise<CalendarEvent[]> {
  const rows = results(await env.DB.prepare(
    `SELECT m.id, m.uid, m.title, date(m.due_at) AS day
       FROM engagement_milestones m
       JOIN engagements e ON e.id = m.engagement_id
       JOIN users u ON u.id = ? AND u.is_active = 1 AND u.deletion_requested_at IS NULL
      WHERE u.partner_id IS NOT NULL AND e.partner_id = u.partner_id
        AND u.role IN ('partner', 'admin')
        AND e.cancelled_at IS NULL AND lower(COALESCE(e.status, '')) NOT IN ('cancelled', 'canceled')
        AND m.completed_at IS NULL
        AND date(m.due_at) IS NOT NULL
        AND julianday(date(m.due_at), '+1 day') > julianday(?)
        AND julianday(date(m.due_at)) < julianday(?)
      ORDER BY date(m.due_at), m.id`,
  ).bind(userId, from, to).all<Row>());
  return rows.map((r) => ({
    ...dayItem('engagement_milestone', Number(r.id), String(r.uid ?? `milestone-${r.id}`), titled(r.title, 'Milestone'), r.day),
    url: '/partner/operations/engagements',
  }));
}
