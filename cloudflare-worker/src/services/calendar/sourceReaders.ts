/** D1208 (#3174): four personal, read-only Calendar sources. No provider calls. */
import type { Env } from '../../types';
import type { CalendarEvent } from '../calendar';

export const READ_ONLY_KINDS: ReadonlySet<string> = new Set(['interview_call', 'cohort_date', 'compliance_due', 'deal_closing']);
export type SourceKind = 'interview_call' | 'cohort_date' | 'compliance_due' | 'deal_closing';
export type SourceEvent = Omit<CalendarEvent, 'kind'> & { kind: SourceKind; all_day: boolean };
type Row = Record<string, any>;

function results(value: { results?: Row[] }): Row[] {
  if (!Array.isArray(value.results)) throw new Error('calendar_source_unreadable');
  return value.results;
}

function base(kind: SourceKind, id: number, uid: string, title: string): SourceEvent {
  return { id: `${kind}:${uid}`, kind, source_id: id, source_uid: uid, title,
    start_at: '', end_at: '', status: 'scheduled', all_day: false,
    location_kind: null, location_uri: null, organizer_email: null, attendees: [], notes: null };
}

/** Date-only values keep deadlines on their recorded day; the end is exclusive. */
function deadline(event: SourceEvent, value: string): SourceEvent {
  const day = String(value).slice(0, 10);
  const ms = Date.parse(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== day) {
    throw new Error('calendar_source_unreadable');
  }
  return { ...event, all_day: true, start_at: day, end_at: new Date(ms + 86_400_000).toISOString().slice(0, 10) };
}

/** The call's recorded owner alone; admin access never widens a personal read. */
export async function interviewCallEvents(env: Env, userId: number, from: string, to: string): Promise<SourceEvent[]> {
  const rows = results(await env.DB.prepare(
    `SELECT r.id, r.uid, r.provider, r.starts_at, r.ends_at, r.join_url, r.status,
            i.interviewee_name, p.id AS project_id
       FROM interview_channel_refs r
       JOIN discovery_interviews i ON i.id = r.interview_id
       JOIN projects p ON p.id = i.project_id AND p.deleted_at IS NULL
       JOIN users u ON u.id = r.user_id AND u.is_active = 1 AND u.deletion_requested_at IS NULL
      WHERE r.user_id = ? AND r.status <> 'cancelled' AND r.starts_at IS NOT NULL
        AND julianday(r.starts_at) >= julianday(?) AND julianday(r.starts_at) < julianday(?)
      ORDER BY julianday(r.starts_at), r.id`,
  ).bind(userId, from, to).all<Row>());
  return rows.map((r) => ({
    ...base('interview_call', Number(r.id), String(r.uid), `Interview · ${r.interviewee_name}`),
    start_at: String(r.starts_at), end_at: String(r.ends_at || r.starts_at), status: String(r.status),
    location_kind: 'video', location_uri: r.join_url || null, project_id: Number(r.project_id),
  }));
}

/** A founder's own ventures only; neither staff privileges nor team grants widen it. */
export async function complianceDueEvents(env: Env, userId: number, from: string, to: string): Promise<SourceEvent[]> {
  const rows = results(await env.DB.prepare(
    `SELECT e.id, e.uid, e.title, e.due_date, e.description, e.project_id
       FROM compliance_events e JOIN projects p ON p.id = e.project_id AND p.deleted_at IS NULL
       JOIN users u ON u.id = ? AND u.founder_id = p.founder_id AND u.role = 'founder'
        AND u.is_active = 1 AND u.deletion_requested_at IS NULL
      WHERE e.completion_status <> 'completed'
        AND julianday(date(e.due_date), '+1 day') > julianday(?)
        AND julianday(date(e.due_date)) < julianday(?)
      ORDER BY date(e.due_date), e.id`,
  ).bind(userId, from, to).all<Row>());
  return rows.map((r) => deadline({ ...base('compliance_due', Number(r.id), String(r.uid), String(r.title)),
    project_id: Number(r.project_id), notes: r.description || null }, String(r.due_date)));
}

/** Only the investor's actual deal-room memberships, never staff-wide deal access. */
export async function dealClosingEvents(env: Env, userId: number, from: string, to: string): Promise<SourceEvent[]> {
  const rows = results(await env.DB.prepare(
    `SELECT d.id, d.uid, d.closing_deadline, d.project_id, p.name AS project_name
       FROM deals d JOIN projects p ON p.id = d.project_id AND p.deleted_at IS NULL
       JOIN users u ON u.id = ? AND u.role = 'investor' AND u.is_active = 1 AND u.deletion_requested_at IS NULL
      WHERE d.closing_deadline IS NOT NULL
        AND EXISTS (SELECT 1 FROM investor_dealroom_members m WHERE m.deal_id = d.id AND m.investor_user_id = u.id)
        AND julianday(date(d.closing_deadline), '+1 day') > julianday(?)
        AND julianday(date(d.closing_deadline)) < julianday(?)
      ORDER BY date(d.closing_deadline), d.id`,
  ).bind(userId, from, to).all<Row>());
  return rows.map((r) => deadline({ ...base('deal_closing', Number(r.id), String(r.uid), `Closing · ${r.project_name}`),
    project_id: Number(r.project_id), deal_id: Number(r.id), url: `/deals/${r.id}` }, String(r.closing_deadline)));
}

/** Own Lab cohort (the gate's start-time rule), or a current advisor assignment. */
export async function cohortDateEvents(env: Env, userId: number, from: string, to: string): Promise<SourceEvent[]> {
  const rows = results(await env.DB.prepare(
    `SELECT c.id, c.year, c.month, c.end_at, w.id AS window_id, w.week_number, w.unlock_at, w.deadline_at
       FROM cohort_cycles c LEFT JOIN week_windows w ON w.cohort_cycle_id = c.id
       JOIN users u ON u.id = ? AND u.is_active = 1 AND u.deletion_requested_at IS NULL
      WHERE ((u.spinout_lab_active = 1 AND u.founder_id IS NOT NULL
              AND julianday(u.spinout_lab_started_at) >= julianday(c.start_at)
              AND julianday(u.spinout_lab_started_at) < julianday(c.end_at))
          OR (u.role = 'advisor' AND EXISTS (SELECT 1 FROM advisor_cohort_assignments a
               WHERE a.advisor_user_id = u.id AND a.cohort_cycle_id = c.id AND a.is_active = 1)))
        AND ((julianday(date(c.end_at), '+1 day') > julianday(?) AND julianday(date(c.end_at)) < julianday(?))
          OR (julianday(date(w.unlock_at), '+1 day') > julianday(?) AND julianday(date(w.unlock_at)) < julianday(?))
          OR (julianday(date(w.deadline_at), '+1 day') > julianday(?) AND julianday(date(w.deadline_at)) < julianday(?)))
      ORDER BY c.id, w.week_number`,
  ).bind(userId, from, to, from, to, from, to).all<Row>());
  const events = new Map<string, SourceEvent>();
  const add = (r: Row, suffix: string, title: string, value: unknown) => {
    if (!value) return;
    const uid = `cycle-${r.id}-${suffix}`;
    const event = deadline(base('cohort_date', Number(r.id), uid, title), String(value));
    if (Date.parse(`${event.end_at}T00:00:00Z`) > Date.parse(from) && Date.parse(`${event.start_at}T00:00:00Z`) < Date.parse(to)) events.set(uid, event);
  };
  for (const r of rows) {
    const cohort = `${r.year}-${String(r.month).padStart(2, '0')}`;
    add(r, 'end', `Cohort ${cohort} ends`, r.end_at);
    if (r.window_id != null) {
      add(r, `week-${r.week_number}-opens`, `Cohort ${cohort} · Week ${r.week_number} opens`, r.unlock_at);
      add(r, `week-${r.week_number}-due`, `Cohort ${cohort} · Week ${r.week_number} due`, r.deadline_at);
    }
  }
  return [...events.values()].sort((a, b) => a.start_at.localeCompare(b.start_at) || a.id.localeCompare(b.id));
}
