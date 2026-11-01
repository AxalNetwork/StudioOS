/**
 * #3982 (D1486 §c, source 5c of #3723): Raise's dated stores on the calendar,
 * both page only and all day.
 *
 *   round_close  `raise_rounds.close_date` of an active round, for the
 *                venture's own members: its founder (`users.founder_id`) and
 *                its accepted owners and co-founders (`project_members`), the
 *                rule Capital relationships reads the round by
 *                (`ownedProjectScope`, `capitalMemberProjectIds`). The investor
 *                side is D1208's `deal_closing`.
 *   nda_expiry   `pairwise_ndas.valid_until` of an active, unvoided NDA, for its
 *                two parties only. The item says "NDA with <name> expires" by
 *                the other party's name, never an email, and nothing else
 *                about the NDA.
 *
 * Investor-update cadence is not built: it has no store (owner question F).
 */
import type { Env } from '../../types';
import type { CalendarEvent } from '../calendar';

type Row = Record<string, any>;
export type RaiseDateKind = 'round_close' | 'nda_expiry';

function results(value: { results?: Row[] }): Row[] {
  if (!Array.isArray(value.results)) throw new Error('calendar_source_unreadable');
  return value.results;
}

/** One all-day item on its recorded day; the end is exclusive. #3983's task readers share it. */
export function dayItem(kind: CalendarEvent['kind'], id: number, uid: string, title: string, value: unknown): CalendarEvent & { all_day: true } {
  const day = String(value ?? '').slice(0, 10);
  const ms = Date.parse(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== day) {
    throw new Error('calendar_source_unreadable');
  }
  return {
    id: `${kind}:${uid}`, kind, source_id: id, source_uid: uid, title,
    start_at: day, end_at: new Date(ms + 86_400_000).toISOString().slice(0, 10), status: 'scheduled', all_day: true,
    location_kind: null, location_uri: null, organizer_email: null, attendees: [], notes: null,
  } as CalendarEvent & { all_day: true };
}

/** An active round's close date, for its venture's founder and accepted owners and co-founders. */
export async function roundCloseEvents(env: Env, userId: number, from: string, to: string): Promise<CalendarEvent[]> {
  const rows = results(await env.DB.prepare(
    `SELECT r.id, r.uid, r.name, r.close_date, p.id AS project_id, p.name AS project_name
       FROM raise_rounds r
       JOIN projects p ON p.id = r.project_id AND p.deleted_at IS NULL
       JOIN users u ON u.id = ? AND u.is_active = 1 AND u.deletion_requested_at IS NULL
      WHERE r.status = 'active' AND r.close_date IS NOT NULL
        AND ((u.founder_id IS NOT NULL AND u.founder_id = p.founder_id)
          OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = u.id
                      AND m.status = 'accepted' AND m.role IN ('owner', 'cofounder')))
        AND julianday(date(r.close_date), '+1 day') > julianday(?)
        AND julianday(date(r.close_date)) < julianday(?)
      ORDER BY date(r.close_date), r.id`,
  ).bind(userId, from, to).all<Row>());
  return rows.map((r) => {
    const round = String(r.name ?? '').trim();
    return {
      ...dayItem('round_close', Number(r.id), String(r.uid), `Round closes · ${round || String(r.project_name)}`, r.close_date),
      project_id: Number(r.project_id), url: '/raise/capital-relationships',
    };
  });
}

/** An active NDA's expiry, for its two parties only, by the other party's name. */
export async function ndaExpiryEvents(env: Env, userId: number, from: string, to: string): Promise<CalendarEvent[]> {
  const rows = results(await env.DB.prepare(
    `SELECT n.id, n.valid_until, other.name AS other_name
       FROM pairwise_ndas n
       JOIN users u ON u.id = ? AND u.is_active = 1 AND u.deletion_requested_at IS NULL
       JOIN users other ON other.id = CASE WHEN n.party_a_user_id = u.id THEN n.party_b_user_id ELSE n.party_a_user_id END
      WHERE (n.party_a_user_id = u.id OR n.party_b_user_id = u.id)
        AND n.status = 'active' AND n.voided_at IS NULL AND n.valid_until IS NOT NULL
        AND julianday(date(n.valid_until), '+1 day') > julianday(?)
        AND julianday(date(n.valid_until)) < julianday(?)
      ORDER BY date(n.valid_until), n.id`,
  ).bind(userId, from, to).all<Row>());
  return rows.map((r) => {
    const name = String(r.other_name ?? '').trim();
    return dayItem('nda_expiry', Number(r.id), `nda-${r.id}`, `NDA with ${name || 'the other party'} expires`, r.valid_until);
  });
}
