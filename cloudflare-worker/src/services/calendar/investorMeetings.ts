/**
 * D1190 (#3124) — "Investor meeting" in the unified calendar: a meeting or a
 * call on a prospect's timeline in Capital relationships that has a start
 * (`raise_prospect_events.starts_at`, migration 607).
 *
 * WHOSE CALENDAR. The venture's founder: the member whose `users.founder_id` is
 * the project's `founder_id`. Nobody else's calendar carries it, admins
 * included (#2420's "Mine": a personal calendar never inherits a wider read).
 * Co-founders join when part 3 (D1191) settles who they are.
 *
 * NOBODY IS INVITED. The item carries no attendees and no organiser, so a sync
 * to Google or Outlook writes a private copy on the founder's own calendar and
 * never mails the investor.
 *
 * NO INVENTED HOUR. The step records a start and no end, so the end is the
 * start, as `buildEventIcs` and D1033 write an event with no end.
 *
 * Its id is the step's `calendar_item_uid`, kept from the moment it was logged,
 * so a provider copy stays the same item.
 */
import type { Env } from '../../types';
import type { CalendarEvent } from '../calendar';

type Row = Record<string, any>;

function isMissingSchema(e: unknown): boolean {
  const msg = String((e as Error)?.message || e || '').toLowerCase();
  return msg.includes('no such table') || msg.includes('no such column') || msg.includes('does not exist');
}

const KIND_WORD: Record<string, string> = { meeting: 'Meeting', call: 'Call' };

/** The founder's meetings and calls with an investor that start in the window. */
export async function investorMeetingEvents(env: Env, userId: number, fromIso: string, toIso: string): Promise<CalendarEvent[]> {
  try {
    const res = await env.DB.prepare(
      `SELECT ev.id, ev.kind, ev.note, ev.starts_at, ev.calendar_item_uid,
              p.id AS prospect_id, p.name AS prospect_name, p.firm AS prospect_firm, pr.id AS project_id, pr.name AS project_name
         FROM raise_prospect_events ev
         JOIN raise_prospects p ON p.id = ev.prospect_id
         JOIN projects pr ON pr.id = p.project_id
         JOIN users u ON u.id = ? AND u.founder_id IS NOT NULL AND u.founder_id = pr.founder_id
        WHERE ev.kind IN ('meeting', 'call') AND ev.starts_at IS NOT NULL AND ev.calendar_item_uid IS NOT NULL
          AND ev.starts_at >= ? AND ev.starts_at <= ?
        ORDER BY ev.starts_at ASC, ev.id ASC`,
    ).bind(userId, fromIso, toIso).all<Row>();
    return (res.results || []).map((r) => {
      const who = String(r.prospect_firm || r.prospect_name || '').trim() || 'an investor';
      const notes = [`${KIND_WORD[r.kind]} with ${who}, logged in Capital relationships${r.project_name ? ` for ${r.project_name}` : ''}.`, r.note ? String(r.note) : '']
        .filter(Boolean).join('\n\n');
      return {
        id: `investor_meeting:${r.id}`,
        kind: 'investor_meeting',
        source_id: Number(r.id),
        source_uid: String(r.calendar_item_uid),
        title: `Investor ${KIND_WORD[r.kind].toLowerCase()} · ${who}`,
        start_at: String(r.starts_at),
        end_at: String(r.starts_at),
        status: 'scheduled',
        location_kind: null,
        location_uri: null,
        organizer_email: null,
        attendees: [],
        notes,
        project_id: Number(r.project_id),
      } satisfies CalendarEvent;
    });
  } catch (e) {
    if (isMissingSchema(e)) return [];
    throw e;
  }
}
