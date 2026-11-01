/**
 * #3983 (D1486 §d): the dated task stores on the calendar, family `tasks`,
 * page only, every due date an all-day item. Each reader shows the rows the
 * member owns, by the rule the store's own route reads them by:
 *
 *   workflow_task         `workflow_tasks.due_date`, assigned to the member
 *                         (`assignee_user_id`, the dashboard's "My tasks").
 *   mvp_task              `mvp_tasks.due_date`, assigned to the member
 *                         (`assigned_to`, a user id on the founder board),
 *                         in a venture that is not deleted.
 *   contact_task          `contact_tasks.due_date`, on a contact of a venture
 *                         the member founded (`ownedProjectScope`: the
 *                         project's `founder_id` is the member's).
 *   engagement_milestone  `engagement_milestones.due_at`, for the partner
 *                         delivering the engagement (`requireOwnEngagement`:
 *                         `engagements.partner_id` is the member's). Only the
 *                         partner reads milestones today; the founder does not.
 *                         Its module reads "Engagements › Milestones": a bare
 *                         "Engagements" is a table name, which D1484 refuses.
 *
 * Done and cancelled rows are hidden: a workflow task or MVP card whose status
 * is done or cancelled (and archived for a card, the board's `NOT_IN_FLIGHT`),
 * a contact task marked done, a milestone with `completed_at`, or any
 * milestone of a cancelled engagement. A due date SQLite cannot read as a day
 * is left out by `date()` rather than guessed at.
 */
import type { Env } from '../../types';
import type { CalendarEvent } from '../calendar';
import { dayItem } from './raiseDates';

type Row = Record<string, any>;
export type TaskDateKind = 'workflow_task' | 'mvp_task' | 'contact_task' | 'engagement_milestone';

function results(value: { results?: Row[] }): Row[] {
  if (!Array.isArray(value.results)) throw new Error('calendar_source_unreadable');
  return value.results;
}

// Every reader joins the member (active, not leaving) first, and keeps a due day
// whose whole day overlaps [from, to). The SQL is written out in full: the
// guard (check-sql-prepare) reads every statement as one literal.

const titled = (title: unknown, fallback: string) => String(title ?? '').trim() || fallback;

/** A workflow task assigned to the member. */
export async function workflowTaskEvents(env: Env, userId: number, from: string, to: string): Promise<CalendarEvent[]> {
  const rows = results(await env.DB.prepare(
    `SELECT t.id, t.title, date(t.due_date) AS day
       FROM workflow_tasks t
       JOIN workflows w ON w.id = t.workflow_id
       JOIN users u ON u.id = ? AND u.is_active = 1 AND u.deletion_requested_at IS NULL
      WHERE t.assignee_user_id = u.id
        AND lower(COALESCE(t.status, 'todo')) NOT IN ('done', 'cancelled')
        AND date(t.due_date) IS NOT NULL AND julianday(date(t.due_date), '+1 day') > julianday(?) AND julianday(date(t.due_date)) < julianday(?)
      ORDER BY day, t.id`,
  ).bind(userId, from, to).all<Row>());
  return rows.map((r) => dayItem('workflow_task', Number(r.id), `workflow-task-${r.id}`, `Due · ${titled(r.title, 'Workflow task')}`, r.day));
}

/** A founder-board card assigned to the member, in a venture that still exists. */
export async function mvpTaskEvents(env: Env, userId: number, from: string, to: string): Promise<CalendarEvent[]> {
  const rows = results(await env.DB.prepare(
    `SELECT t.id, t.title, date(t.due_date) AS day, p.id AS project_id
       FROM mvp_tasks t
       JOIN projects p ON p.id = t.deal_id AND p.deleted_at IS NULL
       JOIN users u ON u.id = ? AND u.is_active = 1 AND u.deletion_requested_at IS NULL
      WHERE t.assigned_to = u.id
        AND lower(COALESCE(t.status, 'todo')) NOT IN ('done', 'cancelled', 'archived')
        AND date(t.due_date) IS NOT NULL AND julianday(date(t.due_date), '+1 day') > julianday(?) AND julianday(date(t.due_date)) < julianday(?)
      ORDER BY day, t.id`,
  ).bind(userId, from, to).all<Row>());
  return rows.map((r) => ({
    ...dayItem('mvp_task', Number(r.id), `mvp-task-${r.id}`, `Due · ${titled(r.title, 'Build task')}`, r.day),
    project_id: Number(r.project_id),
  }));
}

/** A follow-up on a contact of a venture the member founded. */
export async function contactTaskEvents(env: Env, userId: number, from: string, to: string): Promise<CalendarEvent[]> {
  const rows = results(await env.DB.prepare(
    `SELECT t.id, t.title, date(t.due_date) AS day, p.id AS project_id
       FROM contact_tasks t
       JOIN contacts c ON c.id = t.contact_id
       JOIN projects p ON p.id = c.project_id AND p.deleted_at IS NULL
       JOIN users u ON u.id = ? AND u.is_active = 1 AND u.deletion_requested_at IS NULL
      WHERE u.founder_id IS NOT NULL AND p.founder_id = u.founder_id
        AND COALESCE(t.done, 0) = 0
        AND date(t.due_date) IS NOT NULL AND julianday(date(t.due_date), '+1 day') > julianday(?) AND julianday(date(t.due_date)) < julianday(?)
      ORDER BY day, t.id`,
  ).bind(userId, from, to).all<Row>());
  return rows.map((r) => ({
    ...dayItem('contact_task', Number(r.id), `contact-task-${r.id}`, `Follow up · ${titled(r.title, 'Contact task')}`, r.day),
    project_id: Number(r.project_id),
  }));
}

/** An open milestone of an engagement the member's partner profile delivers. */
export async function engagementMilestoneEvents(env: Env, userId: number, from: string, to: string): Promise<CalendarEvent[]> {
  const rows = results(await env.DB.prepare(
    `SELECT m.id, m.uid, m.title, date(m.due_at) AS day, e.project_id
       FROM engagement_milestones m
       JOIN engagements e ON e.id = m.engagement_id
       JOIN users u ON u.id = ? AND u.is_active = 1 AND u.deletion_requested_at IS NULL
      WHERE u.partner_id IS NOT NULL AND e.partner_id = u.partner_id
        AND m.completed_at IS NULL
        AND e.cancelled_at IS NULL AND lower(COALESCE(e.status, '')) <> 'cancelled'
        AND date(m.due_at) IS NOT NULL AND julianday(date(m.due_at), '+1 day') > julianday(?) AND julianday(date(m.due_at)) < julianday(?)
      ORDER BY day, m.id`,
  ).bind(userId, from, to).all<Row>());
  return rows.map((r) => dayItem('engagement_milestone', Number(r.id), String(r.uid), `Milestone · ${titled(r.title, 'Engagement milestone')}`, r.day));
}
